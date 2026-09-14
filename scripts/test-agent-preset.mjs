// scripts/test-agent-preset.mjs — 「新建会话」能不能真的建出来（**零 token**）。
//
// WHY THIS EXISTS（2026-09-14 真实故障）。Obsidian 侧栏里的 dsh 突然「点新建对话没反应」，
// 界面没有任何提示。真因不在按钮、不在反代、也不在插件 UI：
//
//   agent-presets: preset "notes-assistant" failed to mount:
//     failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid config:
//       - $.prefix missing required value (at prefix) (…/.agent-presets/notes-assistant/agent.cordis.yml)
//
// 即 preset 里 persona 行写的是旧字段 `text`，而 dsh-persona ≥0.1.5-rc.1 的 Config 里
// `prefix` 是**必填**。preset 挂载失败 ⇒ 每一次「新建会话」都失败（`/api/session/create`
// 返回 HTTP 200 但体内 `ok:false`，所以按钮看起来"点了没反应"）。
//
// 这个套件钉住两件事：
//   ① 仓库里的 preset 与 dsh 的 schema 对得上（persona 用 `prefix`，不是 `text`）；
//   ② 真的用**已安装的 dsh** 建一个会话，并且 `ok:true`（挂载失败会在这里当场现形）。
//
// 零 token：只创建会话，不发消息。需要本机已安装 dsh + notes-assistant profile，
// 否则按设计 SKIP 并 exit 0（与 scripts/test-panel-auth.mjs 同一约定）。
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { pruneWorkspaces } from './lib/workspace-registry.mjs';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

const presetYml = readFileSync(join('dsh', 'preset', 'agent.cordis.yml'), 'utf8');

// ── ① 静态：preset 的 persona 行必须用 dsh-persona 的当前字段 ────────────────
const personaBlock = presetYml.slice(presetYml.indexOf('- id: persona'), presetYml.indexOf('- id: agent-instructions'));
check('preset 里有 persona 行', personaBlock.length > 0);
check('persona 用 `prefix:`（dsh-persona ≥0.1.5-rc.1 的必填字段）', /^\s{4}prefix:\s*>-/m.test(personaBlock), personaBlock.match(/^\s{4}\w+:/m)?.[0]?.trim() ?? '(none)');
check('persona 不再用旧字段 `text:`（旧写法会让 preset 挂载失败）', !/^\s{4}text:/m.test(personaBlock));

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const installDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh');
const binJs = join(installDir, 'lib', 'bin.js');
const patch = join(dshHome, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');
const installedPreset = join(dshHome, '.agent-presets', 'notes-assistant', 'agent.cordis.yml');
if (!existsSync(binJs) || !existsSync(patch) || !existsSync(installedPreset)) {
  console.log('agent-preset-e2e: SKIP (needs an installed dsh + notes-assistant profile; 零 token 部分已跑)');
  console.log(`  binJs: ${binJs} (${existsSync(binJs)})`);
  console.log(`  patch: ${patch} (${existsSync(patch)})`);
  console.log(`  installed preset: ${installedPreset} (${existsSync(installedPreset)})`);
  console.log(`__CHECKS__ ${passed}/${total}`);
  process.exit(0);
}

/** Deployed copy vs repo source: the installed preset is what dsh actually reads. */
const deployed = readFileSync(installedPreset, 'utf8');
const deployedPersona = deployed.slice(deployed.indexOf('- id: persona'), deployed.indexOf('- id: agent-instructions'));
check('已安装的 preset 也用 `prefix:`（插件不会强制刷新它，必须与仓库一致）', /^\s{4}prefix:\s*>-/m.test(deployedPersona));
check('已安装的 preset 不再用 `text:`', !/^\s{4}text:/m.test(deployedPersona));

// ── ② 动态：真的建一个会话 ──────────────────────────────────────────────────
//
// ⚠️ 本套件会向 dsh **注册一个工作区**（`session/create` 的副作用），而工作区登记是
// **持久**的：它写在 `$DSH_HOME/storages/workspace.json` 里，会出现在用户侧栏的
// 「工作区」列表里。第一版用 `mkdtempSync('dsh-preset-ws-')`（每次新目录）⇒ 每次
// `npm test` 都在用户侧栏留下一个 `dsh-preset-ws-XXXXXX`（2026-09-14 实际发生了 8 个）。
//
// 现在的规矩：**固定路径 + 用完即删 + 无论如何都要把登记项从 workspace.json 里摘掉**。
// 只删目录是不够的——登记项留在 json 里，侧栏照样显示。
const PROBE_WORKSPACE = join(tmpdir(), 'dsh-math-memory-preset-probe');

/** 把探针工作区从 dsh 的工作区登记表里摘掉（按 `path` 匹配，不按 id）。 */
function unregisterProbeWorkspace() {
  // 大小写不敏感由 pruneWorkspaces 负责：`os.tmpdir()` 在 Windows 上给 `C:\WINDOWS\TEMP`，
  // 而 dsh 写的是 `C:\Windows\Temp`——逐字符比较会漏掉全部条目（第一版就是这么漏的）。
  const wanted = PROBE_WORKSPACE.replaceAll('\\', '/').toLowerCase();
  return pruneWorkspaces(dshHome, (normalized) => normalized.startsWith(wanted));
}

let child = null;
let logDir = null;
let workspace = null;
let probeRegistered = 0;
try {
  logDir = mkdtempSync(join(tmpdir(), 'dsh-preset-'));
  workspace = PROBE_WORKSPACE;
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  const logFd = openSync(join(logDir, 'child.log'), 'w');
  let spawnError = null;
  child = spawn(process.execPath, [binJs, '--profile', 'notes-assistant', '--patch', patch, '--no-open', '--port', '0'], {
    env: { ...process.env, DSH_HOME: dshHome, DSH_WORKSPACE_ROOT: workspace, DSH_OBSIDIAN_VAULT: workspace },
    stdio: ['ignore', logFd, logFd]
  });
  child.on('error', (error) => { spawnError = error; });
  closeSync(logFd);

  const logPath = join(logDir, 'child.log');
  let launch = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && launch === null) {
    await sleep(300);
    if (spawnError !== null) break;
    try {
      const text = readFileSync(logPath, 'utf8');
      const m = text.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/);
      if (m) launch = { port: Number(m[1]), url: m[0] };
    } catch { /* not written yet */ }
  }
  check('dsh 启动并打印了带 token 的启动地址', launch !== null, spawnError === null ? '' : String(spawnError));

  if (launch !== null) {
    // 兑换 token 拿 cookie（与插件的反代同一套：请求方必须是"公共权威"）。
    const authority = `127.0.0.1:${launch.port}`;
    const cookie = await new Promise((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port: launch.port, path: new URL(launch.url).pathname + new URL(launch.url).search, method: 'GET', headers: { host: authority, connection: 'close' }, setHost: false }, (res) => {
        res.resume();
        resolve((res.headers['set-cookie'] ?? []).map((c) => String(c).split(';')[0]).join('; '));
      });
      req.on('error', () => resolve(''));
      req.end();
    });
    check('启动了会话接口所需的鉴权 cookie', cookie !== '', cookie === '' ? '(no set-cookie)' : '');

    const rpc = (method, payload) => new Promise((resolve) => {
      const body = JSON.stringify({ type: 'client-request', rpcId: `probe-${method.replace('/', '-')}`, method, payload });
      const req = httpRequest({
        host: '127.0.0.1', port: launch.port, path: `/api/${method}`, method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          host: `127.0.0.1:${launch.port}`,
          ...(cookie === '' ? {} : { cookie })
        },
        setHost: false
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', (error) => resolve({ status: 0, text: String(error) }));
      req.write(body);
      req.end();
    });

    // 兑换 token 拿 cookie 已在上面完成（`cookie`）。
    const created = await rpc('session/create', {
      args: {
        request: {
          sessionId: `session-probe-${Date.now()}`,
          cwd: workspace,
          agentPreset: 'notes-assistant'
        }
      }
    });
    const ok = /"ok"\s*:\s*true/.test(created.text);
    check('session/create 返回 ok:true（preset 能挂载）', ok, created.text.slice(0, 400));
    check('失败原因不是 preset 挂载错误', !/failed to mount|invalid config|missing required value/.test(created.text), created.text.slice(0, 400));
  }
} catch (error) {
  check('套件自身未抛异常', false, String(error?.message ?? error));
} finally {
  child?.kill();
  // 等子进程真的退出：它在退出路径上还会写一次 workspace.json，先摘登记项会被它覆盖回去。
  for (let i = 0; i < 40 && child !== null && child.exitCode === null && child.signalCode === null; i += 1) await sleep(250);
  await sleep(500);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let removed = null;
    try { removed = unregisterProbeWorkspace(); } catch { /* registry unreadable: nothing to undo */ }
    if (removed !== null && removed > 0) { probeRegistered = removed; break; }
    await sleep(500);
  }
  for (const dir of [logDir, workspace]) {
    if (dir !== null) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
  // 探针留下的痕迹必须为零：否则用户的侧栏会出现一个他从未创建过的「工作区」。
  const leftovers = (() => {
    try {
      const parsed = JSON.parse(readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8'));
      return Object.values(parsed?.tables?.workspaces ?? {}).filter((v) => typeof v?.path === 'string' && v.path.startsWith(PROBE_WORKSPACE)).length;
    } catch { return 0; }
  })();
  const stripped = probeRegistered;
  check('探针工作区已从 dsh 的工作区登记表里摘掉（不留痕）', leftovers === 0, leftovers === 0 ? `摘掉 ${stripped} 条` : `仍残留 ${leftovers} 条`);
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
