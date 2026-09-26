// scripts/test-real-profile-accept.mjs — can a session actually be created on a
// profile that was set up the way the OFFICIAL plugin management sets one up?
//
// WHY THIS IS PROVISIONED FROM SCRATCH (2026-09-26)
// -------------------------------------------------
// This gate used to boot a COPY of whatever profile was deployed on the machine
// (`$DSH_HOME/profiles/notes-assistant`) and it earned its keep once: 2026-09-25
// it caught a declaration that was in `cordis.patch.yml` but missing from the
// `--patch` overlay, while every repo-side gate stayed green.
//
// Then the machine's `$DSH_HOME` was lost (17,027 files — see docs/handoff.md),
// and the gate degraded into `SKIP … 0/0 checks`: it exited 0 without comparing
// anything, so "45/45 gates passed" contained a gate that never ran. Worse, the
// shape it tested was the one that happened to work. Measured on 2026-09-26,
// THREE of the four activation shapes were broken and none of them was covered:
//
//   · `dsh plugin --profile web add dsh-math-memory` (the shape
//     `docs/installation.md` recommends): the host staged the preset body into
//     `profiles/notes-assistant/` — a hardcoded name — while the declaration was
//     live in `profiles/web/` ⇒ `agent-preset/invalid`.
//   · `dsh plugin add` on a COLD profile: the registry mounts the preset while
//     the host row is still importing, so a body staged by that row is one boot
//     too late ⇒ broken on the first boot, fine on the second.
//   · `install --direct`: staged nothing at all (see test-installer.mjs).
//
// So the gate owns its profile now. It builds the BUNDLE shape offline (copy the
// package into the profile's `node_modules` and list it in `dsh.profile.bundles`
// — no pnpm, no registry, no network), gives it a profile name that is NOT
// `notes-assistant` on purpose, and boots it once. That single boot covers the
// cold-start ordering, the deploy target, and the declaration pipeline — the
// three things that were each silently wrong.
//
// Zero tokens. Runs in an isolated `$DSH_HOME` so it cannot pollute the user's
// workspace table (docs/handoff.md trap 91).
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { removeIsolatedHome } from './lib/isolated-dsh-home.mjs';

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log(`${cond ? '[ok] ' : '[FAIL] '}${name}${detail === '' ? '' : ' | ' + detail}`);
};

const repo = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const realHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const binJs = join(
  process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'
);

if (!existsSync(binJs)) {
  console.log('__SKIP__ real-profile-accept (needs an installed dsh)');
  console.log(`  binJs: ${binJs} (${existsSync(binJs)})`);
  console.log(`__CHECKS__ ${passed}/${total}`);
  process.exit(0);
}

const PRESET_ID = 'notes-assistant';
// NOT the preset's own name: the point of the gate is that the profile name and
// the preset name have nothing to do with each other.
const PROFILE = 'bundle-accept-probe';

const home = mkdtempSync(join(tmpdir(), 'dsh-accept-'));
const workspace = join(tmpdir(), 'dsh-accept-workspace');
let child = null;
let logDir = null;

/** Build the profile the way `dsh plugin add` leaves it (minus pnpm). */
function provisionProfile() {
  const profileDir = join(home, 'profiles', PROFILE);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'cordis.yml'), '# composed from patches\n[]\n', 'utf8');
  // ⚠️ NOT the repo's flat posture file. Since 2026-09-26 that file ALSO carries the FLAT channel's
  // generated preset declaration (`name: ./math-memory.mjs`), and this probe builds the BUNDLE shape:
  // nothing stages those flat modules here, so inheriting the declaration makes the composition fail
  // with `math-memory (./math-memory.mjs): never started`. The bundle's own patch declares the preset
  // with package subpaths. The flat posture itself is covered by `check: shipped yaml parses` and
  // `test: installer e2e`; what THIS gate must prove is the bundle launch shape.
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# bundle-shape probe: the package declares the preset\n[]\n', 'utf8');
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-math-memory'] } }
  }, null, 2) + '\n', 'utf8');

  // The installed package, copied — `dsh plugin add` would fetch exactly this.
  const pkgDir = join(profileDir, 'node_modules', 'dsh-math-memory');
  mkdirSync(pkgDir, { recursive: true });
  cpSync(join(repo, 'package.json'), join(pkgDir, 'package.json'));
  cpSync(join(repo, 'dsh'), join(pkgDir, 'dsh'), { recursive: true });
  return profileDir;
}

try {
  const profileDir = provisionProfile();

  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  logDir = mkdtempSync(join(tmpdir(), 'dsh-accept-log-'));
  const logPath = join(logDir, 'child.log');
  const logFd = openSync(logPath, 'w');

  // The BUNDLE launch shape: no `--patch` overlay (that is the Obsidian channel).
  child = spawn(process.execPath, [binJs, '--profile', PROFILE, '--no-open', '--port', '0'], {
    env: { ...process.env, DSH_HOME: home, DSH_WORKSPACE_ROOT: workspace, DSH_OBSIDIAN_VAULT: workspace },
    stdio: ['ignore', logFd, logFd]
  });
  closeSync(logFd);

  // A cold boot must NOT need a second run: nothing has staged the preset body,
  // and nothing should have to (the declaration names the installed package).
  check('the profile starts with no preset body staged', !existsSync(join(profileDir, 'math-memory.mjs')));

  let launch = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && launch === null) {
    await sleep(300);
    try {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(readFileSync(logPath, 'utf8'));
      if (m) launch = { port: Number(m[1]), path: new URL(m[0]).pathname + new URL(m[0]).search };
    } catch { /* not written yet */ }
  }
  check('dsh boots on the provisioned profile and prints a token address', launch !== null);

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
    check('the auth handshake yields a cookie (same path the plugin proxy uses)', cookie !== '');

    const rpc = (method, payload) => new Promise((resolve) => {
      const body = JSON.stringify({ type: 'client-request', rpcId: `accept-${method.replace(/\W/g, '-')}-${Date.now()}`, method, payload });
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
    check(`the roster lists "${PRESET_ID}" — on a profile named "${PROFILE}"`,
      roster.includes(`"${PRESET_ID}"`), roster.slice(0, 240));
    check('no preset row is broken (the whole composition mounted)',
      !/"broken"/.test(roster), roster.slice(0, 240));

    const created = await rpc('session/create', {
      args: { request: { sessionId: `session-accept-${Date.now()}`, cwd: workspace, agentPreset: PRESET_ID } }
    });
    check('session/create returns ok:true', /"ok"\s*:\s*true/.test(created), created.slice(0, 300));

    // THE REGRESSION THIS GATE WAS WRITTEN FOR: a hardcoded profile name made
    // the host stage the body into `profiles/notes-assistant/` while the
    // declaration was live in the booting profile.
    check('nothing was deployed to a hardcoded "notes-assistant" profile dir',
      !existsSync(join(home, 'profiles', PRESET_ID)));

    const logs = readFileSync(logPath, 'utf8');
    check('the boot log carries no preset/patch diagnostics',
      !/never started|agent-preset\/|patch: entry/i.test(logs), logs.slice(-300));
  }
} catch (error) {
  check('the suite itself did not throw', false, String(error?.message ?? error));
} finally {
  if (child !== null) { try { child.kill(); } catch { /* ignore */ } }
  for (let i = 0; i < 40 && child !== null && child.exitCode === null && child.signalCode === null; i += 1) await sleep(250);
  await sleep(400);
  // The real workspace table must not have gained a temp row (trap 91).
  const realLeftovers = (() => {
    try {
      const parsed = JSON.parse(readFileSync(join(realHome, 'storages', 'workspace.json'), 'utf8'));
      const tmp = (tmpdir()).replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
      return Object.values(parsed?.tables?.workspaces ?? {})
        .filter((v) => String(v?.path ?? '').replaceAll('\\', '/').toLowerCase().startsWith(tmp)).length;
    } catch { return 0; }
  })();
  check('the user\'s real workspace table has no temp-dir rows', realLeftovers === 0, `leftovers=${realLeftovers}`);
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  if (logDir !== null) { try { rmSync(logDir, { recursive: true, force: true }); } catch { /* ignore */ } }
  check('the isolated home is gone', removeIsolatedHome(home), home);
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
