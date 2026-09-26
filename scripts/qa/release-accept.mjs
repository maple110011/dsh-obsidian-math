#!/usr/bin/env node
/**
 * release-accept — 用 **dsh 推荐的方式**（`dsh plugin add`，它是 pnpm 的薄封装）真装一遍，
 * 再起 dsh、查 preset、建会话、卸载、看残留。全部在**临时 `DSH_HOME`** 里做，不碰用户的真实环境。
 *
 * 为什么要有它：`scripts/test-real-profile-accept.mjs` 是**离线**复刻 bundle 形态（把包拷进
 * `node_modules`），它证明的是"包内的东西对不对"；而"推荐路径本身"（pnpm 装完 profile 的
 * `bundles`/`dependencies`/`dsh.bundle.patch` 是否闭合、起得来、preset 挂得上、卸载干不干净）
 * 没有别的门禁覆盖。这两件事互补，不是重复。
 *
 * 用法：`node scripts/qa/release-accept.mjs`（可选 `--keep` 保留临时目录以便事后翻看）。
 * 退出码：0 = 全部通过；1 = 有失败（逐条打印）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { openSync, closeSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const PACKAGE = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).name;
// ⚠️ The profile NAME matters: `dsh plugin add` initializes a profile with dsh's default bundle set,
// and this plugin's host half needs `webServer` + `workspaceRegistry` (i.e. the web stack) while the
// preset row needs `agentPresets`. A profile dsh did not create for web (`--profile somethingelse`)
// ends up with "2 entries did not activate … pending (waiting for services: webServer,
// workspaceRegistry)" and a boot that never prints a token. The documented command uses `web`, so the
// probe uses the same name — that is the path users are told to take.
const PROFILE = 'web';
const PRESET_ID = 'notes-assistant';
const keep = process.argv.includes('--keep');

const binJs = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
if (!existsSync(binJs)) {
  console.log(`release-accept: SKIP — dsh not found at ${binJs}`);
  process.exit(0);
}

let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`[ok] ${label}${detail === '' ? '' : ` | ${detail}`}`);
  else {
    failed += 1;
    console.log(`[FAIL] ${label}${detail === '' ? '' : ` | ${detail}`}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = mkdtempSync(join(tmpdir(), 'dsh-release-accept-'));
const workspace = join(home, 'workspace');
mkdirSync(workspace, { recursive: true });
const env = { ...process.env, DSH_HOME: home, DSH_WORKSPACE_ROOT: workspace, DSH_OBSIDIAN_VAULT: workspace };
const profileDir = join(home, 'profiles', PROFILE);
const spec = `file:${repo.replace(/\\/g, '/')}`;
let child = null;

try {
  // ── 1. 推荐路径：dsh plugin add（= pnpm add，写进 profile 的 manifest 与 node_modules）──
  const add = spawnSync(process.execPath, [binJs, 'plugin', '--profile', PROFILE, 'add', spec], { env, encoding: 'utf8' });
  console.log('--- dsh plugin add 输出（末尾 12 行）');
  console.log(String(add.stdout ?? '').split('\n').slice(-12).join('\n'));
  if (String(add.stderr ?? '').trim() !== '') console.log(`--- stderr: ${String(add.stderr).trim().split('\n').slice(-6).join('\n')}`);
  check('dsh plugin add exits 0 (the recommended path accepts this package)', add.status === 0, `status=${add.status}`);

  const manifestPath = join(profileDir, 'package.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  check('the profile registers the package as a bundle (dsh.profile.bundles)',
    bundles.includes(PACKAGE), JSON.stringify(bundles));
  check('the profile also declares it as a dependency (resolvable node_modules entry)',
    typeof manifest?.dependencies?.[PACKAGE] === 'string', JSON.stringify(manifest?.dependencies ?? {}));
  const installed = join(profileDir, 'node_modules', PACKAGE);
  check('the package really landed in the profile node_modules', existsSync(join(installed, 'package.json')));
  const pkg = existsSync(join(installed, 'package.json')) ? JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')) : {};
  check('the installed copy declares dsh.bundle.patch (the bundle channel needs it)',
    typeof pkg?.dsh?.bundle?.patch === 'string', String(pkg?.dsh?.bundle?.patch));
  check('the installed copy carries the plugin-manager card fields (icon + locale)',
    typeof pkg.icon === 'string' && existsSync(join(installed, 'locale', 'zh.json')) && existsSync(join(installed, 'locale', 'en.json')));

  // ── 2. 起 dsh：冷启动不该需要任何"先铺文件"的步骤 ──
  const logPath = join(home, 'boot.log');
  const logFd = openSync(logPath, 'w');
  child = spawn(process.execPath, [binJs, '--profile', PROFILE, '--no-open', '--port', '0'], { env, stdio: ['ignore', logFd, logFd] });
  closeSync(logFd);

  let launch = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && launch === null) {
    await sleep(400);
    try {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(readFileSync(logPath, 'utf8'));
      if (m) launch = { port: Number(m[1]), path: new URL(m[0]).pathname + new URL(m[0]).search };
    } catch { /* not written yet */ }
  }
  check('dsh boots on a profile that was installed the recommended way', launch !== null);
  if (launch === null) {
    console.log('--- boot.log 末尾 20 行');
    console.log(readFileSync(logPath, 'utf8').split('\n').slice(-20).join('\n'));
  }

  if (launch !== null) {
    const authority = `127.0.0.1:${launch.port}`;
    const cookie = await new Promise((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port: launch.port, path: launch.path, method: 'GET', headers: { host: authority, connection: 'close' }, setHost: false }, (res) => {
        res.resume();
        resolve((res.headers['set-cookie'] ?? []).map((c) => String(c).split(';')[0]).join('; '));
      });
      req.on('error', () => resolve(''));
      req.end();
    });
    check('the auth handshake yields a cookie', cookie !== '');
    const rpc = (method, payload) => new Promise((resolve) => {
      const body = JSON.stringify({ type: 'client-request', rpcId: `release-${method.replace(/\W/g, '-')}-${Date.now()}`, method, payload });
      const req = httpRequest({
        host: '127.0.0.1', port: launch.port, path: `/api/${method}`, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), host: authority, ...(cookie === '' ? {} : { cookie }) },
        setHost: false
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', (e) => resolve(String(e)));
      req.write(body);
      req.end();
    });

    const roster = await rpc('agentPresets/list', { args: {} });
    check('the preset roster lists this preset', roster.includes(`"${PRESET_ID}"`), roster.slice(0, 200));
    check('no preset row is broken (the composition mounted)', !/"broken"/.test(roster), roster.slice(0, 200));
    const created = await rpc('session/create', {
      args: { request: { sessionId: `session-release-${Date.now()}`, cwd: workspace, agentPreset: PRESET_ID } }
    });
    check('session/create returns ok:true (the preset is usable, not just listed)',
      /"ok"\s*:\s*true/.test(created), created.slice(0, 240));
  }

  // ── 3. 卸载：推荐路径的 rm，然后看残留 ──
  if (child !== null) {
    child.kill();
    await sleep(1500);
  }
  const remove = spawnSync(process.execPath, [binJs, 'plugin', '--profile', PROFILE, 'rm', PACKAGE], { env, encoding: 'utf8' });
  check('dsh plugin rm exits 0', remove.status === 0, `status=${remove.status}`);
  const afterManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  check('the bundle row is gone from the profile manifest',
    !(afterManifest?.dsh?.profile?.bundles ?? []).includes(PACKAGE));
  const leftovers = [];
  for (const rel of ['node_modules/' + PACKAGE, 'cordis.patch.yml', 'notes-assistant.patch.yml', 'cordis.yml', 'package.json', 'math-memory.mjs', '.install-manifest.json']) {
    if (existsSync(join(profileDir, rel))) leftovers.push(rel);
  }
  console.log(`--- 卸载后 profile 里仍然存在的条目：${leftovers.join(', ') || '（无）'}`);
} catch (error) {
  failed += 1;
  console.log(`[FAIL] release-accept crashed: ${String(error?.stack ?? error)}`);
} finally {
  if (child !== null) child.kill();
  if (keep) console.log(`--- 临时目录保留：${home}`);
  else rmSync(home, { recursive: true, force: true });
}

console.log(failed === 0 ? 'release-accept: all checks passed' : `release-accept: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
