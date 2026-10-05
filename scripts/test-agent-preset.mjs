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
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, openSync, closeSync, copyFileSync, writeFileSync } from 'node:fs';
import { pruneWorkspaces } from './lib/workspace-registry.mjs';
import { seedIsolatedHome, removeIsolatedHome } from './lib/isolated-dsh-home.mjs';
import { buildPresetDeclarationBlock } from './lib/preset-declaration.mjs';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyPostureDigests } from '../dsh/install.mjs';

/** Repo root — derived, so this gate does not depend on the caller's cwd. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

// ── ⓪ dsh 0.1.7：preset 必须被「声明」，而不是放进目录 ──────────────────────
// 0.1.7 起 `$DSH_HOME/.agent-presets/` 不再被读取（`.agent-presets` / `preset.yml`
// / `includeUserRoot` 在全库 0 命中），preset 变成一条普通的 Cordis 行
// `name: '@deepseek-ai/dsh-agent-preset'`。这条声明由
// `scripts/build-preset-declaration.mjs` 从 `agent.cordis.yml` + `preset.yml`
// **生成**并写进两个通道的 patch 文件；这里断言生成物没有漂移，并断言它真的
// 出现在 profile 的 patch 层里（声明缺失 = 会话直接建不起来）。
const presetYmlText = readFileSync(join('dsh', 'preset', 'preset.yml'), 'utf8');
const profileLayerPatch = readFileSync(join('dsh', 'profile', 'cordis.patch.yml'), 'utf8');
const overlayPatch = readFileSync(join('dsh', 'profile', 'notes-assistant.patch.yml'), 'utf8');
const bundlePatch = readFileSync(join('dsh', 'cordis.patch.yml'), 'utf8');
const packageName = JSON.parse(readFileSync('package.json', 'utf8')).name;

// ONE composition, TWO name forms (scripts/lib/preset-declaration.mjs):
//   · the flat channel's declaration lives in the PROFILE'S OWN layer (`cordis.patch.yml`,
//     generated from `dsh/profile/cordis.patch.yml`) and names the body as `./math-memory.mjs`,
//     because dsh resolves those names against the profile directory;
//   · a bundle row cannot stage anything in time on a cold first boot, so it names the module as a
//     subpath of the INSTALLED PACKAGE.
// `check-preset-body-lists.mjs` pins both; these assertions keep the "generated from the
// composition" property visible here too — and pin the 2026-09-26 MOVE: the overlay the plugin
// rewrites at every service start must NOT carry the declaration any more (two copies of one preset
// id in two applied layers is a hard failure).
const profileLayerDeclaration = buildPresetDeclarationBlock({
  id: 'notes-assistant',
  compositionText: presetYml,
  presetYmlText
});
const bundleDeclaration = buildPresetDeclarationBlock({
  id: 'notes-assistant',
  compositionText: presetYml,
  presetYmlText,
  localPrefix: `${packageName}/dsh/preset`
});
check('profile 层带相对形态的声明（Obsidian / --direct；启动真正读的是这一层）',
  profileLayerPatch.includes(profileLayerDeclaration.trim()) && profileLayerPatch.includes('./math-memory.mjs'),
  'run: node scripts/build-preset-declaration.mjs');
check('overlay 不再带声明（它每次起服务都被重写；两处同 id 会让 profile 起不来）',
  !overlayPatch.includes('preset-notes-assistant'),
  'the declaration must live in the profile layer, not in the rewritten overlay');
check('bundle 通道带包内 specifier 形态的声明（npm 安装路径）',
  bundlePatch.includes(bundleDeclaration.trim()) && bundlePatch.includes(`${packageName}/dsh/preset/math-memory.mjs`),
  `${packageName}/dsh/preset`);
check('bundle 通道不含相对形态（冷启动时没人来得及铺那些文件）',
  !bundlePatch.includes('name: ./math-memory.mjs'),
  'a relative row here means the first boot after install fails with agent-preset/invalid');

// 真实 home：**只读**，用来判断"这套装好了没"以及给下面对照源码漂移。
const realDshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const installDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh');
const binJs = join(installDir, 'lib', 'bin.js');
const realPatch = join(realDshHome, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');
// The retired `.agent-presets/notes-assistant/agent.cordis.yml` used to gate this
// SKIP; nothing writes that path for a healthy 0.1.7 install any more, so
// requiring it would have hidden the dynamic half in exactly the case this gate
// exists for. The profile overlay is the right precondition.
if (!existsSync(binJs) || !existsSync(realPatch)) {
  console.log('__SKIP__ agent-preset-e2e (needs an installed dsh + a notes-assistant profile)');
  console.log('  binJs: ' + binJs + ' (' + existsSync(binJs) + ')');
  console.log('  patch: ' + realPatch + ' (' + existsSync(realPatch) + ')');
  console.log(`__CHECKS__ ${passed}/${total}`);
  process.exit(0);
}

// ── static sanity of the DEPLOYED profile (2026-09-26, real-machine lesson) ──
//
// Everything below this gate's dynamic half only creates a SESSION — it never sends a
// turn. Request-preparation failures therefore stay invisible to it, which is exactly how
// the 2026-09-26 outage passed a green 50/50 at the same time the sidebar failed EVERY
// reply with "DeepSeek request extension preparation failed". Two preconditions are
// checkable statically, so they are checked here:
//
//   1. The profile manifest must declare non-empty `name` AND `version`. dsh's default-on
//      `plugin-package-inventory-deepseek` request extension resolves the owning manifest
//      of every ACTIVE row; for a RELATIVE row (`./math-memory.mjs` — what the offline
//      channel installs) that walk lands on this very file, where `identityFromManifest`
//      throws when a manifest has a name but no version. (A manifest with NO name is a
//      loose module and passes — which is why the scaffold's missing `version` was fatal
//      while dsh's own version-less profile scaffolds are not.)
//   2. Every RELATIVE row in the deployed overlay must have its file in the profile
//      directory: "row present, file absent" is the sibling failure (dsh prints nothing
//      at boot and `session/create` answers `agent-preset/invalid`).
const realProfileDir = dirname(realPatch);
const realManifestPath = join(realProfileDir, 'package.json');
if (existsSync(realManifestPath)) {
  const manifest = JSON.parse(readFileSync(realManifestPath, 'utf8'));
  check('已部署 profile 的清单声明了非空 name（相对行的归属清单判据）',
    typeof manifest.name === 'string' && manifest.name.length > 0, String(manifest.name));
  check('已部署 profile 的清单声明了非空 version（缺它 = 每轮回复都失败）',
    typeof manifest.version === 'string' && manifest.version.length > 0, String(manifest.version));
} else {
  check('已部署 profile 有 package.json（相对行的归属清单）', false, realManifestPath);
}
{
  const overlayText = readFileSync(realPatch, 'utf8');
  const relativeRows = [...overlayText.matchAll(/^\s*name:\s*['"]?(\.\/[^'"\s]+)['"]?\s*$/gm)].map((m) => m[1]);
  const missingFiles = relativeRows.filter((rel) => !existsSync(join(realProfileDir, rel)));
  // A BUNDLE profile is SUPPOSED to have zero relative rows: the package carries the modules and dsh
  // resolves them inside it (that is what "package-ized" means). Requiring `relativeRows.length > 0`
  // therefore failed the correct shape — measured 2026-09-27 on a profile installed as a local bundle,
  // where the real check (`missingFiles.length === 0`) was satisfied and only the vacuity guard tripped.
  // The guard still matters for the FLAT channel, so it is asserted only there.
  const deployedBundles = (() => {
    try { return JSON.parse(readFileSync(realManifestPath, 'utf8')).dsh?.profile?.bundles ?? []; } catch { return []; }
  })();
  const deployedIsBundle = deployedBundles.includes('dsh-math-memory');
  check('已部署 overlay 的每个相对行都有对应文件（行在文件不在 = 会话建不起来）',
    missingFiles.length === 0 && (relativeRows.length > 0 || deployedIsBundle),
    missingFiles.length === 0
      ? (relativeRows.length > 0 ? `${relativeRows.length} 个相对行` : '0 个相对行（bundle 通道，符合预期）')
      : `缺 ${missingFiles.join(', ')}`);
}

// ── 第三份（装好后的平铺文件）：完整性基线 + 落后提示（B0, 2026-09-26）──────────
//
// docs/decoupling-assessment-2026-09-26.md §2.3 实测过：现场 12 项里有 4 项与仓库不一致，
// 而**没有任何门禁会红**。这里分两件事，因为它们该有不同的严格度：
//   · **硬检查**：磁盘上的文件必须与 manifest 记录的摘要一致 —— 不一致说明有人绕过安装器
//     改了 profile、或写入被截断/被旧插件覆盖（这是"第三份"能立刻抓到的真故障）。
//   · **提示行**：profile 的**代码文件**与仓库当前源码的差异逐项打印。滞后是**正常的**
//     （改动要等下一次安装/引导才落盘），把它做成硬失败会让每个没重装的用户永久飘红 ——
//     所以只提示。比较对象**派生**自仓库布局（只比 `dsh/preset|host` 下的同名文件），
//     不新增第四份文件名清单（坑 96 的病根）。
{
  const manifestPath = join(realProfileDir, '.install-manifest.json');
  if (!existsSync(manifestPath)) {
    check('已部署 profile 有 .install-manifest.json（归属锚点）', false, manifestPath);
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const integrity = verifyPostureDigests(realProfileDir, manifest);
    if (integrity.unrecorded) {
      console.log('[note] 已部署 profile 的 manifest 没有 postureDigests（旧版本写的）：重新安装/引导一次即可获得完整性基线');
    } else {
      // 2026-10-01（0.2.0 适配）: shared posture files are reported, not failed. `cordis.patch.yml` /
      // `cordis.yml` / `package.json` are also written by dsh (its plugin manager and config editor) and
      // by the user — freezing their bytes called a legitimate settings save a fault, permanently. The
      // split lives in `dsh/preset/profile-contract.mjs`; see its WHY block.
      if (integrity.shared.length > 0) {
        console.log(`[note] 以下 posture 文件是 dsh/用户也会写的（不做哈希校验，只列出）：${integrity.shared.join(', ')}`);
      }
      // Vacuity guard: without it, "all installer-owned files agree" would also be printed when there are
      // NO installer-owned files left to compare — the 0/0-assertions shape AGENTS.md §4 warns about.
      check('已部署 profile 的文件与 manifest 记录的摘要一致（第三份完整性基线）',
        integrity.checked > 0 && integrity.drifted.length === 0 && integrity.missing.length === 0,
        JSON.stringify({ checked: integrity.checked, drifted: integrity.drifted, missing: integrity.missing, shared: integrity.shared.length }));
    }
    const lagging = [];
    // Iterate the POSTURE list, not the digest keys: an older manifest has no digests at
    // all, and iterating those keys would compare nothing while printing "consistent" —
    // a vacuous green, which is worse than no check.
    for (const name of manifest.posture ?? []) {
      for (const dir of ['preset', 'host']) {
        const source = join(repoRoot, 'dsh', dir, name);
        if (!existsSync(source)) continue;
        const onDisk = join(realProfileDir, name);
        if (!existsSync(onDisk)) break;
        const a = createHash('sha256').update(readFileSync(onDisk)).digest('hex');
        const b = createHash('sha256').update(readFileSync(source)).digest('hex');
        if (a !== b) lagging.push(`${name} (dsh/${dir})`);
        break;
      }
    }
    const compared = (manifest.posture ?? []).filter((name) =>
      ['preset', 'host'].some((dir) => existsSync(join(repoRoot, 'dsh', dir, name)))).length;
    check('已部署 profile 的代码文件与仓库当前源码的差异（滞后只提示，不算失败）',
      compared > 0,
      compared === 0
        ? '没有可比较的代码文件（profile 形态变了？）'
        : lagging.length === 0
          ? `全部一致（比较了 ${compared} 个）`
          : `落后 ${lagging.length}/${compared} 个：${lagging.join(', ')} —— 重新安装/引导一次即可追上`);
  }
}

// 本次会话**真正用来启动 dsh** 的 home：临时目录里种一份副本（见 isolated-dsh-home.mjs 的 WHY）。
// 这样 `session/create` 登记工作区时写的是副本，用户侧栏不会被探针塞垃圾 —— 而"用完摘掉登记"
// 那条清理仍然保留（双保险）。
//
// ⚠️ `seedIsolatedHome` 只种"启动要点"（profile 目录 + 一层文件 + node_modules 链接），
// **不**递归复制任何可能含 junction 的目录：`cpSync(recursive)` 会**跟着链接递归**，
// 实测直接把进程打成 `exit=-1073740791`（栈溢出）。它也不再种退役的 `.agent-presets/<profile>/`
// （那个目录 2026-09-26 起不再被写入，探针也不需要）。
const dshHome = mkdtempSync(join(tmpdir(), 'dsh-preset-home-'));
seedIsolatedHome(dshHome, realDshHome, {});
const patch = join(dshHome, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');

// Stage what dsh 0.1.7 actually needs, into the PROFILE directory: the preset
// body files (the registry resolves `./math-memory.mjs` against the profile
// baseUrl — see dsh/preset/preset-deploy.mjs) and the generated declaration in
// the profile's OWN patch layer (`cordis.patch.yml`). Doing it here keeps this gate independent of
// which channel deployed the real profile, and it is exactly the shape both channels must produce.
//
// ONLY the profile layer gets the declaration (2026-09-26, B3): the overlay is rewritten by the
// plugin at every service start, so a declaration living there is erased by any stale plugin — and
// staging it in BOTH files would rely on dsh tolerating the same preset id twice.
const isolatedProfile = join(dshHome, 'profiles', 'notes-assistant');
for (const name of ['math-memory.mjs', 'note-tools.mjs', 'hook-frontmatter.mjs']) {
  copyFileSync(join('dsh', 'preset', name), join(isolatedProfile, name));
}
{
  const layerPath = join(isolatedProfile, 'cordis.patch.yml');
  const current = readFileSync(layerPath, 'utf8');
  if (!current.includes(profileLayerDeclaration.trim())) {
    writeFileSync(layerPath, current.replace(/\s*$/, '') + '\n\n' + profileLayerDeclaration, 'utf8');
  }
}
check('探针 home 的 profile 里已铺 preset 体文件（0.1.7 的解析锚点）',
  ['math-memory.mjs', 'note-tools.mjs', 'hook-frontmatter.mjs'].every((n) => existsSync(join(isolatedProfile, n))));
check('探针 home 的 profile 层带着相对形态的声明（这是启动真正读的那一层）',
  readFileSync(join(isolatedProfile, 'cordis.patch.yml'), 'utf8').includes(profileLayerDeclaration.trim()));
check('探针 home 的 overlay 里没有声明（两处同 id 会让整个 profile 起不来）',
  !readFileSync(join(isolatedProfile, 'notes-assistant.patch.yml'), 'utf8').includes('preset-notes-assistant'));

// What the machine actually has. The preset body is no longer part of this
// check: the bundle channel does not stage it at all (it names the modules as
// package subpaths), and the offline channels stage it before boot.
//
// 2026-09-26 (B3): the declaration's home is the DEPLOYED profile's own `cordis.patch.yml`. The
// deployed overlay is NOT the anchor any more — it is rewritten from the plugin's embedded copy at
// every service start, which is exactly how a stale plugin erased the declaration before.
const deployedLayer = join(realProfileDir, 'cordis.patch.yml');
// WHICH LAYER OWNS THE DECLARATION DEPENDS ON THE CHANNEL — and asserting only the flat one failed a
// correct bundle install (measured 2026-09-27). On the FLAT channel (`owner: direct`) the profile's own
// `cordis.patch.yml` is the only declarer. On the BUNDLE channel the declaration belongs to the
// PACKAGE's patch (`dsh/cordis.patch.yml`, subpath form) and the profile layer must NOT repeat it — two
// rows with one id is the composition failure B3 moved the declaration to prevent. So: assert the
// declaration exists in exactly one place, chosen by the channel the manifest records.
{
  const bundlePatchPath = join(realProfileDir, 'node_modules', 'dsh-math-memory', 'dsh', 'cordis.patch.yml');
  const packageOwnsIt = existsSync(bundlePatchPath)
    && readFileSync(bundlePatchPath, 'utf8').includes('id: preset-notes-assistant');
  const profileOwnsIt = readFileSync(deployedLayer, 'utf8').includes(profileLayerDeclaration.trim());
  check('已部署 profile 的 preset 声明恰好在一处（bundle ⇒ 包内；平铺 ⇒ profile 自己那层）',
    packageOwnsIt ? !profileOwnsIt || deployedIsBundle : profileOwnsIt,
    packageOwnsIt
      ? `包内 patch 声明；profile 层${profileOwnsIt ? '也声明了（bundle 通道应为空）' : '未声明（bundle 通道正确）'}`
      : 'profile 层没有声明 ⇒ 侧栏会报 agent-preset/not-found');
}
check('已部署的 overlay 里没有声明（有的话就是两份同 id，会让 profile 起不来）',
  !readFileSync(realPatch, 'utf8').includes('preset-notes-assistant'),
  'overlay 是每次起服务都被重写的那份，声明不该住在那里');

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
  // ⚠️ **先读登记表，再删目录**。这里曾经把删除放在前面，于是"摘掉登记"那条断言读的是一个
  // 已经被删掉的文件 ⇒ catch 分支返回 0 ⇒ **它永远是绿的**（又一条不会失败的断言）。
  // 另外一条重要纪律：路径比较必须**归一化**。`dsh` 写进表里的是反斜杠路径（且大小写随系统），
  // 直接拿正斜杠前缀去 `startsWith` 会**一条都匹配不到** —— 那是它曾经"永远绿"的第二个原因
  // （第一个是删目录在前）。归一化做法与 `pruneWorkspaces` 一致。
  const norm = (p) => String(p ?? '').replaceAll('\\', '/').toLowerCase();
  const leftovers = (() => {
    try {
      const parsed = JSON.parse(readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8'));
      const want = norm(PROBE_WORKSPACE);
      return Object.values(parsed?.tables?.workspaces ?? {}).filter((v) => norm(v?.path).startsWith(want)).length;
    } catch { return 0; }
  })();
  const userLeftovers = (() => {
    try {
      const parsed = JSON.parse(readFileSync(join(realDshHome, 'storages', 'workspace.json'), 'utf8'));
      const tmp = norm(tmpdir()).replace(/\/+$/u, '');
      return Object.values(parsed?.tables?.workspaces ?? {}).filter((v) => {
        const p = norm(v?.path);
        return p === tmp || p.startsWith(tmp + '/');
      }).length;
    } catch { return 0; }
  })();
  const stripped = probeRegistered;
  check('探针工作区已从 dsh 的工作区登记表里摘掉（不留痕）', leftovers === 0, leftovers === 0 ? `摘掉 ${stripped} 条` : `仍残留 ${leftovers} 条`);
  check('用户真实 $DSH_HOME 的工作区表里没有临时目录登记（探针不该碰它）', userLeftovers === 0, `残留 ${userLeftovers} 条`);

  // 最后才删：临时 home（含 junction，用 removeIsolatedHome 先摘链接）与探针工作区。
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  if (logDir !== null) { try { rmSync(logDir, { recursive: true, force: true }); } catch { /* ignore */ } }
  const homeGone = removeIsolatedHome(dshHome);
  check('临时 home 已删净（含 node_modules junction）', homeGone, dshHome);
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
