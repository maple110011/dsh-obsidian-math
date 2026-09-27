import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// Aliased: this file already has a local `writeManifest` helper (a fixture that writes an owner marker).
import { verifyPostureDigests, ensurePresetDeclaration, stripPresetDeclaration, ensurePosture, assertHarnessHome, writeManifest as writeInstallManifest } from '../dsh/install.mjs';
// The contract is the source for "what a profile needs" — assertions below derive from it instead of
// hardcoding counts that rot the moment a file is added (2026-09-26).
import { PROFILE_SCAFFOLD_FILES, PRESET_BODY_FILES } from '../dsh/preset/profile-contract.mjs';
// The declaration markers come from the generator that emits them. The fixture below used to hardcode
// a TRUNCATED END copy, which silently made `staleBlock` one ` <<<` shorter than the real block — so
// once `install.mjs` stopped truncating, this fixture reported a false failure ("returned false").
// Import them: a marker literal in a test can drift exactly like one in production code.
import { DECLARATION_BEGIN, DECLARATION_END } from './lib/preset-declaration.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'dsh-home-test-'));
const vault = mkdtempSync(join(tmpdir(), 'dsh-vault-test-'));
const installer = join(repo, 'dsh', 'install.mjs');
// Inherit stdio instead of piping: sandboxed CI environments may forbid
// capturing a child process's output through anonymous pipes.
const run = (args) => spawnSync(process.execPath, [installer, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
// Same, but capturing stdout — used by the argument-rejection assertions, which need the message.
const runCapture = (args) => spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8' });

let failed = 0;
const check = (label, cond, detail = '') => {
  console.log((cond ? '[ok]' : '[FAIL]'), label + (detail === '' || cond ? '' : ` | ${detail}`));
  if (!cond) failed += 1;
};

// 0. an unrecognised flag must FAIL LOUDLY, never be dropped in silence.
//
// This is not hypothetical: `docs/installation.md` told users to run `install --native`, which has
// never existed. The parser ignored it, `--profile` fell back to `notes-assistant`, and the command
// quietly installed the panel's client half into the SIDEBAR profile while `web` stayed without a
// panel — with no warning at all (found 2026-09-26 while auditing the docs).
//
// Asserted through the real CLI (not by importing parseArgs) because what matters is the exit code a
// user or a script sees.
{
  const rejected = runCapture(['install', '--native']);
  check('an unknown flag exits non-zero (2) instead of silently installing somewhere else',
    rejected.status === 2, `status=${rejected.status}`);
  check('the rejection names the offending flag',
    `${rejected.stdout ?? ''}${rejected.stderr ?? ''}`.includes('--native'),
    `${(rejected.stderr ?? '').split('\n')[0]}`);
  // A valid command must still succeed — otherwise "reject unknown flags" could be satisfied by
  // rejecting everything.
  const accepted = runCapture(['status', '--dsh-home', home, '--quiet']);
  check('a valid command is still accepted (the stricter parser did not reject everything)',
    accepted.status === 0, `status=${accepted.status}`);
  const help = runCapture(['--help']);
  check('--help still exits 0', help.status === 0, `status=${help.status}`);
}

// 0b. `status` must describe a profile by the shape that channel ACTUALLY uses.
//
// `describePresetBody` used to ask only "are the four flat body files in the profile directory?".
// The bundle channel never stages them (its declaration names a package subpath instead), so every
// healthy native install was told `[missing 4/4: …]` — a working profile reported as broken, which
// invites people to "fix" it (measured 2026-09-26). The check now asks whether the entry the
// composition declares actually resolves, in whichever layout applies.
{
  const shapeHome = mkdtempSync(join(tmpdir(), 'dsh-status-shape-'));
  const directHome = mkdtempSync(join(tmpdir(), 'dsh-status-direct-'));
  try {
    // The bundle shape, built the way the package really is (installed under node_modules).
    const webProfile = join(shapeHome, 'profiles', 'web');
    mkdirSync(join(webProfile, 'node_modules', 'dsh-math-memory', 'dsh', 'preset'), { recursive: true });
    for (const name of ['math-memory.mjs', 'note-tools.mjs', 'hook-frontmatter.mjs', 'engine-shared.mjs']) {
      writeFileSync(join(webProfile, 'node_modules', 'dsh-math-memory', 'dsh', 'preset', name), '// stub\n', 'utf8');
    }
    const native = runCapture(['status', '--profile', 'web', '--dsh-home', shapeHome]);
    check('status on a bundle-shaped profile does NOT claim the flat body is missing',
      /^preset:\s+\[via bundle\]/m.test(native.stdout ?? ''),
      (String(native.stdout ?? '').match(/^preset:.*$/m) ?? [''])[0].slice(0, 90));

    // Anti-constant: remove the very entry the declaration resolves, and status must say so again.
    rmSync(join(webProfile, 'node_modules', 'dsh-math-memory', 'dsh', 'preset', 'math-memory.mjs'), { force: true });
    const broken = runCapture(['status', '--profile', 'web', '--dsh-home', shapeHome]);
    check('...but it still reports missing once that entry is gone (not a blanket "healthy")',
      /^preset:\s+\[missing/m.test(broken.stdout ?? ''),
      (String(broken.stdout ?? '').match(/^preset:.*$/m) ?? [''])[0].slice(0, 90));

    // The flat shape must keep reporting honestly too. `--flat` because since A′ S4 the DEFAULT for
    // `install --direct` is "try a local bundle first, fall back to flat" — this case is specifically
    // about the flat channel's own reporting, so it asks for that channel explicitly.
    run(['install', '--direct', '--flat', '--dsh-home', directHome, '--quiet']);
    const flatOk = runCapture(['status', '--dsh-home', directHome, '--quiet']);
    check('status on a flat (--direct) profile still reports [present]',
      /^preset:\s+\[present\]/m.test(flatOk.stdout ?? ''),
      (String(flatOk.stdout ?? '').match(/^preset:.*$/m) ?? [''])[0].slice(0, 90));
  } finally {
    rmSync(shapeHome, { recursive: true, force: true });
    rmSync(directHome, { recursive: true, force: true });
  }
}

// 0c. A missing CLIENT half must not be reported as success.
//
// The client half is the user-visible part (the memory panel; the receiver that turns a dragged
// note into an `@reference`). Both install routes used to `try { … } catch { log(…) }` and then print
// `Done` with exit 0, so the panel could be absent while every signal said the install worked — the
// repo's recurring "success by exit code instead of by structure" (traps 44 / 89).
//
// The failure is injected through the hook that `install-into-profile.mjs` exposes for exactly this
// purpose, so this suite needs no dsh, pnpm or network:
//   DSH_TEST_FORCE_CLIENT_FAIL=1  =>  installClientIntoProfile reports `ok:false`.
{
  const forceHome = mkdtempSync(join(tmpdir(), 'dsh-client-fail-'));
  try {
    const forced = spawnSync(process.execPath, [installer, 'install', '--direct', '--flat', '--dsh-home', forceHome],
      { encoding: 'utf8', env: { ...process.env, DSH_TEST_FORCE_CLIENT_FAIL: '1' } });
    const forcedOut = `${forced.stdout ?? ''}${forced.stderr ?? ''}`;
    check('a client-half failure makes the direct install exit non-zero (no more silent Done)',
      forced.status !== 0, `status=${forced.status}`);
    check('...and it says the panel will not appear',
      /没装上/.test(forcedOut) && /记忆面板/.test(forcedOut),
      (forcedOut.split('\n').find((l) => l.includes('没装上')) ?? '').trim().slice(0, 90));
    check('...and it does not print the success banner',
      !/Done \(direct/.test(forcedOut));

    // Anti-constant: the same command WITHOUT the hook must still succeed, so the assertions above
    // cannot be satisfied by "this command always fails".
    const okHome = mkdtempSync(join(tmpdir(), 'dsh-client-ok-'));
    try {
      const fine = spawnSync(process.execPath, [installer, 'install', '--direct', '--flat', '--dsh-home', okHome],
        { encoding: 'utf8' });
      check('without the failure the same install still exits 0',
        fine.status === 0, `status=${fine.status}`);
    } finally {
      rmSync(okHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(forceHome, { recursive: true, force: true });
  }
}

// 0d. the harness-home guard (S0, 2026-09-26).
//
// WHY THIS EXISTS. Two of the four `.dsh` incidents have `installedAt` timestamps coinciding to the
// MILLISECOND with a `install.mjs --direct` write, and the artefact is the tell: the profile landed at
// `~\profiles\notes-assistant` and the skin at `~\skins\orca-link` — the home path was missing its
// final `\.dsh`. Root cause (documented): a swallowed assignment where `$HOME` is read-only, leaving
// the variable at `C:\Users\<user>`.
//
// The guard must catch that shape and NOTHING ELSE — it must not fire for a legitimate temp dir (every
// install in this file uses one) and it must always yield to an explicit override.
{
  // (a) the incident shape: the given path is the PARENT of a real harness home.
  const parent = mkdtempSync(join(tmpdir(), 'dsh-home-parent-'));
  try {
    mkdirSync(join(parent, '.dsh', 'profiles'), { recursive: true });
    const refused = runCapture(['install', '--direct', '--dsh-home', parent, '--quiet']);
    const output = `${refused.stdout}${refused.stderr}`;
    check('a home that CONTAINS a harness home is refused (the "missing a segment" shape)',
      refused.status !== 0 && /CONTAINS a harness home/.test(output), `status=${refused.status}`);
    check('...and the refusal names both the wrong path and the right one',
      output.includes(parent) && output.includes(join(parent, '.dsh')));
    // The decisive part: nothing may have been written into the wrong (parent) directory.
    check('...and nothing was written beside the real harness home',
      !existsSync(join(parent, 'profiles')) && !existsSync(join(parent, 'skins')));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }

  // (b) the explicit escape hatch still works — otherwise every sandbox/probe would be blocked.
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-home-hatch-'));
  try {
    mkdirSync(join(sandbox, '.dsh'), { recursive: true });
    const allowed = runCapture(['install', '--direct', '--dsh-home', sandbox, '--any-home', '--quiet']);
    check('--any-home overrides the guard deliberately',
      allowed.status === 0, `status=${allowed.status} ${`${allowed.stdout}${allowed.stderr}`.slice(-80)}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  // (c) a plain temp dir (no `.dsh` child) is NOT refused — this is what keeps every other case in
  // this file working, so it is asserted rather than assumed.
  const plain = mkdtempSync(join(tmpdir(), 'dsh-home-plain-'));
  try {
    const ok = runCapture(['status', '--dsh-home', plain, '--quiet']);
    check('an ordinary directory is not refused (the guard is narrow on purpose)',
      ok.status === 0, `status=${ok.status}`);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }

  // (d) the OS-home branch, exercised DIRECTLY because the default path cannot reach it: the default is
  // `join(homedir(), ".dsh")`, which never EQUALS the OS home. It only fires when a caller sets
  // `DSH_HOME` (or `--dsh-home`) to a home directory itself — the shell accident this guard targets.
  {
    let osHomeRefusal = null;
    try { assertHarnessHome(homedir(), false); } catch (error) { osHomeRefusal = error; }
    check('using the OS home directory itself as the harness home is refused',
      osHomeRefusal !== null && /OS home directory/.test(String(osHomeRefusal.message)),
      String(osHomeRefusal?.message ?? 'NO THROW').split('\n')[0]);
    // ...and the hatch releases it, so the guard cannot become an unconditional blocker.
    let hatchThrew = null;
    try { assertHarnessHome(homedir(), true); } catch (error) { hatchThrew = error; }
    check('...while the explicit override releases it', hatchThrew === null, String(hatchThrew?.message ?? ''));
  }
}

// 0e. A′ S4 (2026-09-26): the offline channel's THREE outcomes — bundle / fallback / --flat.
//
// The default `install --direct` now first tries to install a REAL local bundle and falls back to the
// flat copy when it cannot. All three paths must be observable and honest:
//   · bundle succeeds  ⇒ owner=npm + bundleSource=local, the package is registered, the flat rows are
//                        stripped from the overlay, the client-panel row SURVIVES;
//   · bundle fails     ⇒ the manifest must NOT claim npm, and the log must SAY it fell back;
//   · `--flat`         ⇒ the flat channel, unchanged, and the bundle is not attempted.
//
// This also pins the plan's required mutation: the verdict must come from the FILE SYSTEM, not from the
// child process's exit code (trap 89). `DSH_TEST_UNREGISTER_BUNDLE=1` makes the verification fail while
// `dsh plugin add` really succeeded — if the check were walked back to `status === 0`, the run below
// would claim bundle success on a profile where nothing was registered.
{
  const overlayPathFor = (h) => join(h, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');
  const manifestFor = (h) => join(h, 'profiles', 'notes-assistant', '.install-manifest.json');
  const readManifest = (h) => {
    try { return JSON.parse(readFileSync(manifestFor(h), 'utf8')); } catch { return null; }
  };
  const runInstall = (h, env = {}, extra = []) => spawnSync(
    process.execPath,
    [installer, 'install', '--direct', '--dsh-home', h, ...extra],
    { encoding: 'utf8', env: { ...process.env, ...env } }
  );

  // (a) `--flat`: the pre-A′ shape, requested explicitly.
  {
    const flatHome = mkdtempSync(join(tmpdir(), 'dsh-s4-flat-'));
    try {
      const res = runInstall(flatHome, {}, ['--flat']);
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
      check('S4 --flat: exits 0', res.status === 0, `status=${res.status}`);
      check('S4 --flat: says it skipped bundling on purpose', /--flat 指定：跳过本地包化/.test(out));
      check('S4 --flat: the manifest stays on the direct channel',
        readManifest(flatHome)?.owner === 'direct', String(readManifest(flatHome)?.owner));
      check('S4 --flat: no local bundle is materialized',
        !existsSync(join(flatHome, 'profiles', 'notes-assistant', '.dsh-math-memory')));
      check('S4 --flat: the overlay KEEPS the flat rows it needs',
        readFileSync(overlayPathFor(flatHome), 'utf8').includes('name: ./math-memory-panel.mjs'));
    } finally {
      rmSync(flatHome, { recursive: true, force: true });
    }
  }

  // (b) the bundle attempt fails its FILE-SYSTEM verdict ⇒ fall back, and do not claim npm.
  {
    const fbHome = mkdtempSync(join(tmpdir(), 'dsh-s4-fallback-'));
    try {
      const res = runInstall(fbHome, { DSH_TEST_UNREGISTER_BUNDLE: '1' });
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
      check('S4 fallback: still exits 0 (falling back is not a failure)',
        res.status === 0, `status=${res.status}`);
      check('S4 fallback: it SAYS it fell back, with the reason',
        /\[fallback\] 本地包化未成功/.test(out) && /DSH_TEST_UNREGISTER_BUNDLE|not registered/.test(out),
        (out.split('\n').find((l) => l.includes('[fallback]')) ?? '').trim().slice(0, 120));
      // THE assertion for the mutation: a bundle attempt that failed verification must not flip the
      // channel. If the verdict were `status === 0`, this install WOULD have written owner=npm while the
      // package was never registered.
      check('S4 fallback: the manifest does NOT claim the npm channel',
        readManifest(fbHome)?.owner === 'direct', String(readManifest(fbHome)?.owner));
      check('S4 fallback: the flat channel was really written',
        readFileSync(overlayPathFor(fbHome), 'utf8').includes('name: ./math-memory-panel.mjs'));
    } finally {
      rmSync(fbHome, { recursive: true, force: true });
    }
  }

  // (c) the real bundle route — only when this machine actually has dsh AND pnpm.
  {
    const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    const haveToolchain = !probe.error && probe.status === 0;
    if (!haveToolchain) {
      check('S4 bundle: skipped (no pnpm on this machine — the fallback case above covers that shape)',
        true);
    } else {
      const bHome = mkdtempSync(join(tmpdir(), 'dsh-s4-bundle-'));
      try {
        const res = runInstall(bHome);
        const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
        const manifest = readManifest(bHome);
        const overlay = readFileSync(overlayPathFor(bHome), 'utf8');
        const profilePkg = JSON.parse(readFileSync(join(bHome, 'profiles', 'notes-assistant', 'package.json'), 'utf8'));
        check('S4 bundle: exits 0', res.status === 0, `status=${res.status}`);
        check('S4 bundle: the package really is registered as a bundle',
          (profilePkg.dsh?.profile?.bundles ?? []).includes('dsh-math-memory'),
          (profilePkg.dsh?.profile?.bundles ?? []).join(', '));
        check('S4 bundle: the manifest records owner=npm + bundleSource=local (A4 ①)',
          manifest?.owner === 'npm' && manifest?.bundleSource === 'local',
          `owner=${manifest?.owner} source=${manifest?.bundleSource}`);
        check('S4 bundle: the staging directory is recorded for cleanup (A6 ②)',
          manifest?.staging === '.dsh-math-memory', String(manifest?.staging));
        check('S4 bundle: the rows the package provides are stripped from the overlay',
          !overlay.includes('name: ./math-memory-panel.mjs') && !overlay.includes('name: ./math-memory-workspace.mjs'));
        check('S4 bundle: the client-panel row SURVIVES (nothing else declares it)',
          overlay.includes('client-ui-memory-panel'));
        check('S4 bundle: the success line says which channel won (no misleading "Done (direct)")',
          /Done \(direct → local bundle\)/.test(out));
        // THE INTEGRITY BASELINE MUST DESCRIBE THE FINISHED PROFILE (bug found 2026-09-27 by installing
        // into a real profile). `stageClientHalf` rewrites `package.json` AFTER the bundle install, so a
        // manifest written before it recorded a stale digest — and the profile then reported its OWN
        // fresh install as "drifted" forever. The posture list also used to claim the flat module set,
        // 8 files of which the bundle channel never writes (a manifest that lies).
        const bundleProfile = join(bHome, 'profiles', 'notes-assistant');
        const recorded = manifest?.postureDigests ?? {};
        const driftedNames = Object.entries(recorded)
          .filter(([name, digest]) => {
            try { return createHash('sha256').update(readFileSync(join(bundleProfile, name))).digest('hex') !== digest; }
            catch { return true; }
          })
          .map(([name]) => name);
        check('S4 bundle: the recorded digests match the files on disk (no self-reported drift)',
          Object.keys(recorded).length > 0 && driftedNames.length === 0,
          driftedNames.length ? driftedNames.join(', ') : `${Object.keys(recorded).length} digests`);
        const claimedMissing = (manifest?.posture ?? []).filter((name) => !existsSync(join(bundleProfile, name)));
        check('S4 bundle: the manifest claims no file that was never written',
          claimedMissing.length === 0, claimedMissing.join(', ') || `${(manifest?.posture ?? []).length} claimed`);
      } finally {
        rmSync(bHome, { recursive: true, force: true });
      }
    }
  }
}

// 0f. A′ S5 (2026-09-26): migration and mid-crash recovery.
//
// The plan's acceptance for S5 is "an already-installed user (owner=direct + flat files) ends up with
// owner / bundles / overlay pairwise consistent", plus "an interruption BETWEEN `dsh plugin add` and
// the manifest write heals on the next start". The second one is the interesting one, because the write
// ORDER in `tryBundleInstall` is what makes it work: ownership is flipped LAST, so an interrupted run
// leaves `owner: direct` with the package registered — and the next run simply completes the flip.
{
  const s5Manifest = (h) => {
    try { return JSON.parse(readFileSync(join(h, 'profiles', 'notes-assistant', '.install-manifest.json'), 'utf8')); } catch { return null; }
  };
  const s5Bundles = (h) => {
    try { return JSON.parse(readFileSync(join(h, 'profiles', 'notes-assistant', 'package.json'), 'utf8')).dsh?.profile?.bundles ?? []; } catch { return []; }
  };
  const s5Overlay = (h) => readFileSync(join(h, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml'), 'utf8');

  const probePnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const haveToolchain = !probePnpm.error && probePnpm.status === 0;

  // (a) an EXISTING flat install (the pre-A′ shape) can be upgraded in place.
  {
    const upHome = mkdtempSync(join(tmpdir(), 'dsh-s5-upgrade-'));
    try {
      const runIt = (extra = [], env = {}) => spawnSync(process.execPath,
        [installer, 'install', '--direct', '--dsh-home', upHome, ...extra],
        { encoding: 'utf8', env: { ...process.env, ...env } });

      const flat = runIt(['--flat']);
      check('S5 upgrade fixture: the flat install itself succeeds', flat.status === 0, `status=${flat.status}`);
      check('S5 upgrade fixture: it starts as the direct channel',
        s5Manifest(upHome)?.owner === 'direct', String(s5Manifest(upHome)?.owner));

      if (!haveToolchain) {
        check('S5 upgrade: skipped (no pnpm — the fallback path keeps it on direct, already covered)', true);
      } else {
        const up = runIt();
        const manifest = s5Manifest(upHome);
        const bundles = s5Bundles(upHome);
        const overlay = s5Overlay(upHome);
        check('S5 upgrade: exits 0', up.status === 0, `status=${up.status}`);
        // THE invariant: the three records must agree with each other.
        const ownerSaysBundle = manifest?.owner === 'npm' && manifest?.bundleSource === 'local';
        const bundlesSayYes = bundles.includes('dsh-math-memory');
        const overlaySaysNo = !overlay.includes('name: ./math-memory-panel.mjs');
        check('S5 upgrade: owner / bundles / overlay are pairwise consistent',
          ownerSaysBundle && bundlesSayYes && overlaySaysNo,
          `owner=${manifest?.owner}/${manifest?.bundleSource} bundles=${bundlesSayYes} overlayStripped=${overlaySaysNo}`);
        check('S5 upgrade: the pre-existing flat files are left in place (not deleted)',
          existsSync(join(upHome, 'profiles', 'notes-assistant', 'math-memory.mjs')));
      }
    } finally {
      rmSync(upHome, { recursive: true, force: true });
    }
  }

  // (b) mid-crash recovery: force the run to stop at the moment the DECISION to bundle has been made but
  // ownership has not been flipped. `DSH_TEST_UNREGISTER_BUNDLE=1` does exactly that — the package is
  // really added, then verification is forced to fail, so the run falls back and leaves `direct`.
  // Re-running WITHOUT the seam must then complete the migration (that is the self-healing property).
  if (haveToolchain) {
    const healHome = mkdtempSync(join(tmpdir(), 'dsh-s5-heal-'));
    try {
      const interrupted = spawnSync(process.execPath,
        [installer, 'install', '--direct', '--dsh-home', healHome],
        { encoding: 'utf8', env: { ...process.env, DSH_TEST_UNREGISTER_BUNDLE: '1' } });
      check('S5 recovery: the interrupted run still exits 0', interrupted.status === 0, `status=${interrupted.status}`);
      check('S5 recovery: it left the profile on the direct channel (ownership flipped last)',
        s5Manifest(healHome)?.owner === 'direct', String(s5Manifest(healHome)?.owner));

      const healed = spawnSync(process.execPath,
        [installer, 'install', '--direct', '--dsh-home', healHome], { encoding: 'utf8' });
      check('S5 recovery: the next run exits 0', healed.status === 0, `status=${healed.status}`);
      check('S5 recovery: the next run COMPLETES the migration to the bundle channel',
        s5Manifest(healHome)?.owner === 'npm' && s5Bundles(healHome).includes('dsh-math-memory'),
        `owner=${s5Manifest(healHome)?.owner}`);
      check('S5 recovery: the overlay ends up stripped as well (no half-migrated state)',
        !s5Overlay(healHome).includes('name: ./math-memory-panel.mjs'));
    } finally {
      rmSync(healHome, { recursive: true, force: true });
    }
  }

  // (c) the reverse direction: switching a LOCAL-bundle profile to the registry channel must not leave
  // the staging copy behind (otherwise the same package exists twice in one profile).
  if (haveToolchain) {
    const flipHome = mkdtempSync(join(tmpdir(), 'dsh-s5-flip-'));
    try {
      spawnSync(process.execPath, [installer, 'install', '--direct', '--dsh-home', flipHome], { encoding: 'utf8' });
      const staging = join(flipHome, 'profiles', 'notes-assistant', '.dsh-math-memory');
      check('S5 flip fixture: the local staging exists before the switch', existsSync(staging));
      // `install` without --direct is the native/registry channel; it must take over with --force.
      const native = spawnSync(process.execPath, [installer, 'install', '--profile', 'notes-assistant', '--dsh-home', flipHome, '--force'],
        { encoding: 'utf8' });
      check('S5 flip: the native install exits 0', native.status === 0, `status=${native.status}`);
      check('S5 flip: the local staging copy is removed (one package per profile)',
        !existsSync(staging), existsSync(staging) ? 'staging still present' : '');
    } finally {
      rmSync(flipHome, { recursive: true, force: true });
    }
  }
}

// 1. install --direct --flat (fresh, FLAT channel)
//
// `--flat` is passed on purpose from here on: since A′ S4 the default `install --direct` first tries to
// install a REAL local bundle (and falls back to flat when dsh/pnpm are unavailable). The cases in
// sections 1–6 assert the FLAT channel's files, manifest and uninstall behaviour, so they ask for that
// channel explicitly and stay deterministic on machines WITH and WITHOUT dsh. The bundle route, the
// fallback and the default itself are covered by their own section (0e) below.
const installArgs = ['install', '--direct', '--flat', '--dsh-home', home, '--vault', vault];
let r = run(installArgs);
check('direct install exit 0', r.status === 0 && !r.error);

const presetRoot = join(home, '.agent-presets', 'notes-assistant');
const profileRoot = join(home, 'profiles', 'notes-assistant');
// ⚠️ RETIRED 2026-09-26: `.agent-presets/<id>/` is no longer WRITTEN by any
// channel (dsh >= 0.1.7 reads nothing there; the preset is declared in the
// overlay and its modules live in the profile directory). `uninstall` still
// CLEANS UP a directory a pre-2026-09-26 install left behind — asserted in step 6.
check('the retired .agent-presets directory is NOT created by --direct', !existsSync(presetRoot));

// ── the "third copy" integrity baseline (B0, 2026-09-26) ─────────────────────
//
// docs/decoupling-assessment-2026-09-26.md §2.3 measured the problem: the flat profile
// files are written by an installer that ran some time ago, and NOTHING could tell whether
// what is on disk is still what was written (4 of 12 files had already drifted, and no gate
// red). The manifest now records one sha256 per posture file, and this block proves the
// verifier — reused by the real-deployed-profile gate — actually notices a change.
{
  const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
  const present = manifest.posture.filter((n) => existsSync(join(profileRoot, n)));
  const recorded = Object.keys(manifest.postureDigests ?? {});
  check('manifest records a digest for every posture file present on disk',
    recorded.length === present.length && present.every((n) => typeof manifest.postureDigests[n] === 'string'),
    `${recorded.length}/${present.length}`);

  const clean = verifyPostureDigests(profileRoot, manifest);
  check('the digests verify against a freshly installed profile',
    clean.unrecorded === false && clean.drifted.length === 0 && clean.missing.length === 0,
    JSON.stringify({ drifted: clean.drifted, missing: clean.missing }));

  // self-mutation: the verifier must notice a byte changed behind the manifest's back,
  // and must go quiet again once the file is restored.
  const victim = join(profileRoot, 'cordis.patch.yml');
  const original = readFileSync(victim, 'utf8');
  writeFileSync(victim, original + '\n# tampered\n', 'utf8');
  const dirty = verifyPostureDigests(profileRoot, manifest);
  writeFileSync(victim, original, 'utf8');
  check('a tampered posture file is reported as drifted (and restoring it clears the report)',
    dirty.drifted.includes('cordis.patch.yml') && verifyPostureDigests(profileRoot, manifest).drifted.length === 0,
    JSON.stringify(dirty.drifted));

  check('a manifest from before this change is reported as unrecorded, NOT as clean',
    verifyPostureDigests(profileRoot, { owner: 'direct', posture: ['cordis.patch.yml'] }).unrecorded === true);
}

// ── the profile manifest must declare name AND version ───────────────────────
//
// 2026-09-26 real-machine failure: every reply in this profile failed with
// "DeepSeek request extension preparation failed" and NO request was ever sent.
// Cause: dsh's default-on `plugin-package-inventory-deepseek` request extension
// resolves the owning manifest of every ACTIVE row, and for our RELATIVE rows
// (`./math-memory.mjs`) that walk lands on the profile's own `package.json`, where
// dsh's identityFromManifest rejects a manifest that has a `name` but no `version`.
// (A manifest with NO name is treated as a loose module and passes.) The shipped
// scaffold lacked `version`, and `copyFile` preserves an existing user-editable file
// — so both the scaffold and the repair path are asserted here.
{
  const shipped = JSON.parse(readFileSync(new URL('../dsh/profile/package.json', import.meta.url), 'utf8'));
  check('shipped profile scaffold declares a non-empty name', typeof shipped.name === 'string' && shipped.name.length > 0, String(shipped.name));
  check('shipped profile scaffold declares a non-empty version', typeof shipped.version === 'string' && shipped.version.length > 0, String(shipped.version));

  const manifestPath = join(profileRoot, 'package.json');
  const installed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check('installed profile manifest has name + version', typeof installed.name === 'string' && installed.name.length > 0 && typeof installed.version === 'string' && installed.version.length > 0,
    JSON.stringify({ name: installed.name, version: installed.version }));

  // Mutation-style precondition: strip `version`, re-run the installer, expect repair.
  const { version: _dropped, ...withoutVersion } = installed;
  writeFileSync(manifestPath, JSON.stringify(withoutVersion, null, 2) + '\n', 'utf8');
  const rerun = run(installArgs);
  const repaired = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check('re-installing REPAIRS a version-less profile manifest',
    typeof repaired.version === 'string' && repaired.version.length > 0,
    `exit=${rerun.status} version=${String(repaired.version)}`);
  check('the repair keeps the existing bundles and dependencies', JSON.stringify(repaired.dsh) === JSON.stringify(installed.dsh)
    && JSON.stringify(repaired.dependencies) === JSON.stringify(installed.dependencies));
}

// `--dry-run` promises "print planned writes without touching the filesystem" (its own --help text).
//
// It did NOT, twice over (found 2026-09-26):
//   · `repairProfileManifest()` wrote unconditionally, so on a profile whose manifest had been hand-edited
//     (no `version`) a DRY RUN rewrote `package.json` — the one file a user is most likely to have edited;
//   · the direct channel called `installClientIntoProfile()` for real, which stages the client package into
//     `node_modules/`, writes `.dsh-client-panel/` and adds a `dependencies` entry.
// Assert on the whole tree's bytes, not on one file: the defect was exactly "something else changed".
{
  const snapshot = (dir) => {
    const out = new Map();
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.set(full, createHash('sha256').update(readFileSync(full)).digest('hex'));
      }
    };
    walk(dir);
    return out;
  };
  // Give the dry run something it WOULD have repaired, so a no-op cannot pass vacuously.
  const manifestPath = join(profileRoot, 'package.json');
  const before = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { version: _v, ...withoutVersion } = before;
  writeFileSync(manifestPath, JSON.stringify(withoutVersion, null, 2) + '\n', 'utf8');
  const preDryRun = snapshot(profileRoot);
  const dry = run([...installArgs, '--dry-run']);
  const postDryRun = snapshot(profileRoot);
  const changed = [...postDryRun.keys()].filter((k) => preDryRun.get(k) !== postDryRun.get(k));
  const added = [...postDryRun.keys()].filter((k) => !preDryRun.has(k));
  check('--dry-run on an existing profile exits 0', dry.status === 0, `exit=${dry.status}`);
  check('--dry-run changes no file and creates none (it must not even repair the manifest)',
    changed.length === 0 && added.length === 0,
    `changed=${changed.length} added=${added.length}${changed.length ? ' first=' + changed[0] : ''}${added.length ? ' firstAdded=' + added[0] : ''}`);
  check('and the manifest it would have repaired is still version-less (proof the fixture could fail)',
    JSON.parse(readFileSync(manifestPath, 'utf8')).version === undefined);
  // Restore for the assertions below, which expect a healthy profile.
  writeFileSync(manifestPath, JSON.stringify(before, null, 2) + '\n', 'utf8');
}
const files = [
  join(profileRoot, 'package.json'),
  join(profileRoot, 'cordis.yml'),
  join(profileRoot, 'cordis.patch.yml'),
  join(profileRoot, 'pnpm-workspace.yaml'),
  join(profileRoot, 'math-memory-workspace.mjs'),
  join(profileRoot, 'notes-assistant.patch.yml'),
  join(profileRoot, 'memory-admin.mjs'),
  join(profileRoot, 'math-memory-panel.mjs'),
  // Shared engine helpers: `math-memory.mjs` and `memory-admin.mjs` both import
  // `./engine-shared.mjs`, which must be a SIBLING here (the offline layout has no
  // node_modules, so the package-layout re-export shim is not what gets staged).
  join(profileRoot, 'engine-shared.mjs'),
  // ⚠️ THE PRESET BODY must be in the PROFILE DIRECTORY: the overlay declares
  // `name: ./math-memory.mjs`, and the registry resolves that against the
  // profile dir. This assertion is what `--direct` was missing — it shipped a
  // profile that answered `agent-preset/invalid` for every session while this
  // suite stayed green (it only checked the retired `.agent-presets/` copy).
  join(profileRoot, 'math-memory.mjs'),
  join(profileRoot, 'note-tools.mjs'),
  join(profileRoot, 'hook-frontmatter.mjs'),
  join(vault, 'AGENTS.md'),
  join(vault, '.deepseek', 'memory', 'profile.md'),
  join(vault, '.deepseek', 'memory', 'records', 'index.md')
];
for (const path of files) check('exists ' + path, existsSync(path));

// ownership: the PROFILE manifest is the anchor (`readChannelOwner` reads it first)
const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
check('manifest owner=direct', manifest.owner === 'direct');
check('no legacy .owner.json is written any more', !existsSync(join(presetRoot, '.owner.json')));
// Derived, not hardcoded: this assertion used to say `=== 12` and went red the moment the profile
// contract grew a file. The property worth asserting is "the manifest lists exactly what the contract
// says a profile needs" — anchor on that, not on a number that rots (AGENTS.md §6).
const expectedPosture = [...new Set([...PROFILE_SCAFFOLD_FILES, ...PRESET_BODY_FILES])];
check('manifest posture = every file the contract says a profile needs',
  Array.isArray(manifest.posture) && expectedPosture.every((name) => manifest.posture.includes(name)),
  Array.isArray(manifest.posture) ? String(manifest.posture.length) : 'not an array');
check('manifest posture covers the preset body (so uninstall removes it)',
  ['math-memory.mjs', 'note-tools.mjs'].every((n) => manifest.posture.includes(n)),
  manifest.posture.join(','));

// drift detection (always-refresh files must match repo sources)
//
// `cordis.patch.yml` is no longer an exception: since the client-half loader row moved into the
// authoritative overlay (`notes-assistant.patch.yml`) the installer does not append to ANY patch
// file, so every shipped profile file must install byte-identically. The exception this comment
// used to document ("repo content is a prefix") is exactly what hid the 2026-09-21 failure.
//
// ⚠️ THE `cordis.patch.yml` PAIR WAS RED ON 2026-09-26 AND THAT WAS A REAL DEFECT, not fixture noise:
// the second `--direct` install below strips and re-adds the generated preset declaration, and
// `dsh/install.mjs` hardcoded a TRUNCATED END marker (`…declaration`, missing the trailing ` <<<`),
// so the strip cut the block one ` <<<` short and wrote the remainder back as a bare root-level YAML
// token (`…declaration` followed by an orphaned `<<<` line). Both sides now import
// `DECLARATION_BEGIN`/`DECLARATION_END` from `scripts/lib/preset-declaration.mjs`. Tempting-but-wrong
// fix to remember: "relax the assertion to a prefix match" would re-hide exactly this class.
const driftPairs = [
  // The deployed body is what dsh actually imports for this channel.
  [join(profileRoot, 'math-memory.mjs'), join(repo, 'dsh', 'preset', 'math-memory.mjs')],
  [join(profileRoot, 'note-tools.mjs'), join(repo, 'dsh', 'preset', 'note-tools.mjs')],
  [join(profileRoot, 'hook-frontmatter.mjs'), join(repo, 'dsh', 'preset', 'hook-frontmatter.mjs')],
  [join(profileRoot, 'notes-assistant.patch.yml'), join(repo, 'dsh', 'profile', 'notes-assistant.patch.yml')],
  [join(profileRoot, 'memory-admin.mjs'), join(repo, 'dsh', 'host', 'memory-admin.mjs')],
  [join(profileRoot, 'cordis.patch.yml'), join(repo, 'dsh', 'profile', 'cordis.patch.yml')],
  [join(profileRoot, 'math-memory-panel.mjs'), join(repo, 'dsh', 'host', 'math-memory-panel.mjs')],
  [join(vault, 'AGENTS.md'), join(repo, 'dsh', 'templates', 'vault-AGENTS.md')]
];
for (const [installed, source] of driftPairs) {
  check('no drift ' + installed, readFileSync(installed, 'utf8') === readFileSync(source, 'utf8'));
}
// The memory panel's BROWSER half (drag-to-mention) must be mounted by the
// authoritative overlay, and its package must be installed. 2026-09-21 real
// failure: the installer only APPENDED the loader row at install time, but the
// plugin regenerates `notes-assistant.patch.yml` from its embedded copy at every
// service start — so the row was gone by the next boot, the sidebar received the
// drop, POSTed the path, got 204, and nothing was listening. The row now lives in
// `dsh/profile/notes-assistant.patch.yml` (asserted above as byte-identical) and
// the installer is only allowed to INSTALL THE PACKAGE.
{
  const overlay = readFileSync(join(profileRoot, 'notes-assistant.patch.yml'), 'utf8');
  const rowRe = /^\s*-\s*id:\s*['"]?math-memory-client-panel['"]?\s*$/mu;
  check('notes-assistant.patch.yml: mounts the client half (math-memory-client-panel)', rowRe.test(overlay));
  // The id must differ from the host half's — the same day, an identical id made
  // cordis refuse to boot the whole profile ("duplicate loader entry id").
  const ids = [...overlay.matchAll(/^\s*-\s*id:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/gmu)].map((m) => m[1]);
  check('notes-assistant.patch.yml: row ids are unique', new Set(ids).size === ids.length, ids.join(','));
  check('notes-assistant.patch.yml: host half row still present alongside the client row',
    ids.includes('math-memory-panel') && ids.includes('math-memory-workspace'), ids.join(','));
  const pkg = join(profileRoot, 'node_modules', '@dsh-math-memory', 'client-ui-memory-panel');
  // The host entry lives at host/index.mjs (its own relative imports need that
  // depth); a package whose entry cannot be imported is the 2026-09-26 defect.
  check('client half package installed', existsSync(join(pkg, 'client.js')) && existsSync(join(pkg, 'host', 'index.mjs')));
  check('client half package.json points ./client at client.js',
    JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).exports['./client'] === './client.js');
  // The id must appear EXACTLY once in the whole profile: cordis treats a repeated loader
  // entry id as a hard failure of the profile, and the row must not be reachable twice
  // (e.g. once from the overlay and once appended to cordis.patch.yml).
  const occurrences = [...readdirSync(profileRoot).filter((n) => n.endsWith('.yml'))]
    .map((name) => readFileSync(join(profileRoot, name), 'utf8'))
    .join('\n')
    .match(/^\s*-\s*id:\s*['"]?math-memory-client-panel['"]?\s*$/gmu) ?? [];
  check('client row appears exactly once across the profile patch files', occurrences.length === 1, `count=${occurrences.length}`);
}

// 2. idempotent second run
r = run(installArgs);
check('idempotent second run exit 0', r.status === 0);

// 3. cross-channel conflict. The AUTHORITATIVE anchor is the PROFILE manifest; the
//    retired `.agent-presets` marker is only a fallback, kept so an install made
//    before 2026-09-26 is recognised instead of silently taken over. Both are
//    exercised, because "which one wins" is exactly what silently broke when the
//    anchor was the retired directory (see dsh/host/channel-owner.mjs).
const manifestPath = join(profileRoot, '.install-manifest.json');
const legacyDir = join(home, '.agent-presets', 'notes-assistant');
const legacyMarkerPath = join(legacyDir, '.owner.json');
const writeManifest = (owner) => writeFileSync(manifestPath, JSON.stringify(
  { owner, version: '9.9.9', installedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
const writeLegacy = (owner) => {
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(legacyMarkerPath, JSON.stringify(
    { owner, version: '0.7.0', installedAt: new Date().toISOString() }), 'utf8');
};

// 3a. legacy-only install (no profile manifest): the migration path must still refuse.
rmSync(manifestPath, { force: true });
writeLegacy('npm');
r = run(installArgs);
check('conflict (legacy anchor only): direct install refuses an npm-owned profile (exit 1)', r.status === 1);

// 3b. both anchors present and DISAGREEING: the profile manifest wins.
writeManifest('npm');
writeLegacy('direct');
r = run(installArgs);
check('conflict (manifest is authoritative): direct install still refuses (exit 1)', r.status === 1);

// 4. --force takes over: the manifest becomes the authoritative "direct".
r = run([...installArgs, '--force']);
check('--force takeover exit 0', r.status === 0);
check('--force rewrites the profile manifest to owner=direct',
  JSON.parse(readFileSync(manifestPath, 'utf8')).owner === 'direct');

// 5. uninstall dry-run (no --yes) leaves files in place
r = run(['uninstall', '--dsh-home', home, '--vault', vault]);
check('uninstall dry-run exit 0', r.status === 0);
check('dry-run keeps the deployed preset body', existsSync(join(profileRoot, 'math-memory.mjs')));
check('dry-run keeps the retired directory it found', existsSync(legacyMarkerPath));

// 5a. …and it must be a DELIBERATE no-op for EVERY action, not just the ones asserted above.
//
// `uninstall` defaults to dry-run, so this is the mode a user gets from a bare `uninstall` — and it was
// audited only for "keeps the preset body". Comparing the whole tree BEFORE/AFTER is the cheap way to
// cover the rest: `--purge --purge-data` exercises every branch (retired dir, posture, manifest, vault
// skeletons, vault cache, memory content), and any future writer that forgets `options.dryRun` shows up
// as a byte difference here.
{
  const digestTree = (dir) => {
    const out = new Map();
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.set(full, createHash('sha256').update(readFileSync(full)).digest('hex'));
      }
    };
    walk(dir);
    return out;
  };
  // Give the purge branches something to remove, so a no-op cannot pass vacuously.
  mkdirSync(join(vault, '.deepseek', 'cache'), { recursive: true });
  writeFileSync(join(vault, '.deepseek', 'cache', 'probe.json'), '{}', 'utf8');
  const beforeProfile = digestTree(profileRoot);
  const beforeVault = digestTree(vault);
  const dryPurge = run(['uninstall', '--purge', '--purge-data', '--confirm', 'DELETE MY MATH MEMORY',
    '--dsh-home', home, '--vault', vault]);
  check('uninstall --purge --purge-data without --yes exits 0', dryPurge.status === 0, `status=${dryPurge.status}`);
  const afterProfile = digestTree(profileRoot);
  const afterVault = digestTree(vault);
  const diff = (a, b) => {
    const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
    const added = [...b.keys()].filter((k) => !a.has(k));
    const removed = [...a.keys()].filter((k) => !b.has(k));
    return { changed, added, removed };
  };
  const dP = diff(beforeProfile, afterProfile);
  const dV = diff(beforeVault, afterVault);
  check('dry-run uninstall does not touch the PROFILE (no change/add/remove)',
    dP.changed.length === 0 && dP.added.length === 0 && dP.removed.length === 0,
    `changed=${dP.changed.length} added=${dP.added.length} removed=${dP.removed.length}`);
  check('dry-run uninstall does not touch the VAULT (no change/add/remove)',
    dV.changed.length === 0 && dV.added.length === 0 && dV.removed.length === 0,
    `changed=${dV.changed.length} added=${dV.added.length} removed=${dV.removed.length}`);
}

// 5b. uninstall must NOT delete a posture file the user (or dsh itself) has since edited.
//
// `manifest.posture` is not "ours, safe to delete": a native install records exactly
// `cordis.patch.yml`, and on a `web` profile that file is the user's OWN dsh patch layer — their
// providers and default model live in it, and dsh's config editor rewrites it too. Before the
// 2026-09-26 fix, every path listed there was deleted unconditionally, so uninstalling our plugin
// could silently destroy unrelated dsh configuration. `verifyPostureDigests` already existed to
// detect exactly this drift and was simply never consulted.
{
  const editedHome = mkdtempSync(join(tmpdir(), 'dsh-home-edited-'));
  const editedProfile = join(editedHome, 'profiles', 'notes-assistant');
  mkdirSync(editedProfile, { recursive: true });
  const posture = 'cordis.patch.yml';
  const originalPosture = '- insert:\n    - id: ours\n      name: ./ours.mjs\n';
  writeFileSync(join(editedProfile, posture), originalPosture, 'utf8');
  // Record the digest of what we "wrote", exactly as an install would.
  writeInstallManifest({ dryRun: false, quiet: true }, editedProfile, 'npm', [posture], []);
  check('fixture: the install manifest records a digest for the posture file',
    typeof JSON.parse(readFileSync(join(editedProfile, '.install-manifest.json'), 'utf8')).postureDigests?.[posture] === 'string');
  // Now the user edits it (this is the dsh-config-editor shape).
  const userEdited = originalPosture + '\n# my own dsh settings\n- insert:\n    - id: user-llm\n      name: ./my-llm.mjs\n';
  writeFileSync(join(editedProfile, posture), userEdited, 'utf8');
  const beforeUninstall = verifyPostureDigests(editedProfile, JSON.parse(readFileSync(join(editedProfile, '.install-manifest.json'), 'utf8')));
  check('fixture: the edit is detected as drift (so the assertion below can fail)',
    beforeUninstall.drifted.includes(posture), JSON.stringify(beforeUninstall.drifted));

  const editedRun = run(['uninstall', '--yes', '--force', '--dsh-home', editedHome]);
  const survived = existsSync(join(editedProfile, posture));
  check('uninstall KEEPS a hand-edited posture file instead of deleting the user\'s settings',
    survived && readFileSync(join(editedProfile, posture), 'utf8').includes('user-llm'),
    `exit=${editedRun.status} survived=${survived}`);
  rmSync(editedHome, { recursive: true, force: true });
}

// 6. full uninstall
// The cache directory only exists once the plugin or the capture path has run,
// and the installer never creates it — so the "vault cache removed" check below
// used to pass VACUOUSLY (review P3: an assertion that could not fail). Create
// what a real vault would have, so `--purge` removing it is actually tested.
mkdirSync(join(vault, '.deepseek', 'cache'), { recursive: true });
writeFileSync(join(vault, '.deepseek', 'cache', 'captured-sessions.json'), '{}', 'utf8');
check('fixture: the vault cache exists before uninstall', existsSync(join(vault, '.deepseek', 'cache')));
r = run(['uninstall', '--purge', '--purge-data', '--yes', '--confirm', 'DELETE MY MATH MEMORY', '--dsh-home', home, '--vault', vault]);
check('full uninstall exit 0', r.status === 0);
check('retired .agent-presets directory removed (migration cleanup)', !existsSync(legacyDir));
check('deployed preset body removed from the profile dir', !existsSync(join(profileRoot, 'math-memory.mjs'))
  && !existsSync(join(profileRoot, 'note-tools.mjs')));
check('posture removed', !existsSync(join(profileRoot, 'cordis.patch.yml')));
check('manifest removed', !existsSync(join(profileRoot, '.install-manifest.json')));
check('vault AGENTS.md removed', !existsSync(join(vault, 'AGENTS.md')));
check('vault cache removed', !existsSync(join(vault, '.deepseek', 'cache')));
// `--purge-data` must remove EVERY content file the manifest names — derived, not a second hand-written
// list (M6, 2026-09-26). The lists used to be a copy of `templates-manifest.json` that happened to cover
// exactly that day's entries, so a new template would be seeded on install and then silently SURVIVE the
// purge: "I deleted my memory" would be false and nothing would fail.
//
// ⚠️ A first version of this assertion only checked that the manifest's own targets were gone — and that
// passed EVEN WITH the hand-written list restored, because the recursive container pass removes those
// same files. A guard that cannot fail is decoration (trap 68/81), so this one plants a content file at a
// **top-level, manifest-named** target in a THROWAWAY vault of its own, where only the derived per-file
// list can reach it, and asserts it is removed. Then it asserts a non-manifest file in the same
// directory SURVIVES (so the check cannot be satisfied by "delete the whole vault").
{
  const pv = mkdtempSync(join(tmpdir(), 'dsh-purge-manifest-'));
  const pvVault = mkdtempSync(join(tmpdir(), 'dsh-purge-vault-'));
  try {
    const install = run(['install', '--direct', '--flat', '--dsh-home', pv, '--vault', pvVault, '--quiet']);
    check('purge fixture: seeded install exit 0', install.status === 0, `status=${install.status}`);
    // A manifest-named target at the vault ROOT: no container directory covers it.
    writeFileSync(join(pvVault, 'AGENTS.md'), '# content\n', 'utf8');
    // A file the manifest does NOT name, in the same directory: it must survive, proving the purge is
    // driven by the manifest rather than by "remove everything".
    writeFileSync(join(pvVault, 'not-a-template.md'), '# mine\n', 'utf8');
    const purged = run(['uninstall', '--purge-data', '--yes', '--confirm', 'DELETE MY MATH MEMORY',
      '--dsh-home', pv, '--vault', pvVault]);
    check('purge fixture: uninstall exit 0', purged.status === 0, `status=${purged.status}`);
    check('a manifest-named content file at the vault root is removed (the list is derived, not remembered)',
      !existsSync(join(pvVault, 'AGENTS.md')));
    check('...while a file the manifest does not name is left alone (the purge is manifest-driven)',
      existsSync(join(pvVault, 'not-a-template.md')));
  } finally {
    rmSync(pv, { recursive: true, force: true });
    rmSync(pvVault, { recursive: true, force: true });
  }
}
// Every manifest target should be gone from the main fixture vault too (skeletons were removed by
// `--purge`, content by `--purge-data`) — a cheap end-to-end sweep.
{
  const manifest = JSON.parse(readFileSync(join(repo, 'dsh', 'templates-manifest.json'), 'utf8'));
  const survivors = Object.values(manifest)
    .filter((rel) => typeof rel === 'string')
    .filter((rel) => existsSync(join(vault, ...rel.split('/'))));
  check('--purge --purge-data left no manifest-seeded file behind at all',
    survivors.length === 0, survivors.join(', ') || 'none left');
}

rmSync(home, { recursive: true, force: true });
rmSync(vault, { recursive: true, force: true });
// The declaration must be REFRESHED when stale, not merely appended into place.
//
// Found 2026-09-26 while shortening `preset.yml`'s description for release: that description is part of
// the GENERATED block, and B3's repair was append-only — so an upgraded install kept the OLD
// description forever (and `test: agent preset mounts` failed at deploy time). The fix replaces only
// the marker-delimited block, which is what these assertions pin.
{
  const refreshHome = mkdtempSync(join(tmpdir(), 'dsh-decl-refresh-'));
  const refreshProfile = join(refreshHome, 'profiles', 'notes-assistant');
  mkdirSync(refreshProfile, { recursive: true });
  const scaffold = readFileSync(join(repo, 'dsh', 'profile', 'cordis.patch.yml'), 'utf8');
  const begin = DECLARATION_BEGIN;
  const end = DECLARATION_END;
  const currentBlock = scaffold.slice(scaffold.indexOf(begin), scaffold.indexOf(end) + end.length);
  const staleBlock = currentBlock.replace(/description: [^\n]+/, 'description: STALE-DESCRIPTION');
  writeFileSync(join(refreshProfile, 'cordis.patch.yml'),
    `# a row of the user's own\n- insert:\n    - id: user-thing\n      name: ./user.mjs\n\n${staleBlock}\n`, 'utf8');
  const refreshed = ensurePresetDeclaration(refreshProfile);
  const after = readFileSync(join(refreshProfile, 'cordis.patch.yml'), 'utf8');
  check('declaration: a STALE generated block is refreshed (append-only would keep the old text forever)',
    refreshed === true && !after.includes('STALE-DESCRIPTION') && after.includes('面向数学类笔记的最小 agent'),
    refreshed ? 'refreshed' : 'returned false');
  check("declaration: the user's own rows outside the block survive the refresh",
    after.includes('id: user-thing'));
  check('declaration: a second run is a no-op (idempotent)', ensurePresetDeclaration(refreshProfile) === false);
  rmSync(refreshHome, { recursive: true, force: true });
}

// Two channels, two shapes for the SAME generated block — the 2026-09-26 install audit measured what
// happens when they are confused: the native (bundle) path copied the flat declaration into a profile
// whose bundle layer already declared the same id, and the preset came out
// `broken: "math-memory (./math-memory.mjs): never started"`. The scaffold in the repo is the FLAT
// channel's source, so it must carry the block; the bundle channel must strip it.
{
  const channelHome = mkdtempSync(join(tmpdir(), 'dsh-decl-channel-'));
  const channelProfile = join(channelHome, 'profiles', 'notes-assistant');
  mkdirSync(channelProfile, { recursive: true });
  const scaffold = readFileSync(join(repo, 'dsh', 'profile', 'cordis.patch.yml'), 'utf8');
  const begin = DECLARATION_BEGIN;
  check('channels: the repo scaffold carries the flat declaration (the --direct/Obsidian source)',
    scaffold.includes(begin) && scaffold.includes('- id: preset-notes-assistant'));
  // A native-style profile: the scaffold as copied, plus a row of the user's own.
  const target = join(channelProfile, 'cordis.patch.yml');
  writeFileSync(target, `- insert:\n    - id: user-thing\n      name: ./user.mjs\n\n${scaffold}\n`, 'utf8');
  const stripped = stripPresetDeclaration(channelProfile);
  const after = readFileSync(target, 'utf8');
  check('channels: the bundle-channel repair removes the flat declaration',
    stripped === true && !after.includes(begin) && !after.includes('- id: preset-notes-assistant'),
    stripped ? 'stripped' : 'returned false');
  check("channels: that repair keeps the user's own rows", after.includes('id: user-thing'));
  check('channels: and a second run is a no-op', stripPresetDeclaration(channelProfile) === false);
  rmSync(channelHome, { recursive: true, force: true });
}

// 12. `--force` must NEVER eat the profile's own patch layer (2026-09-27 real-machine data loss).
//
// `<profile>/cordis.patch.yml` is the profile's OWN user-editable dsh patch layer — it is where a
// user puts things like a custom model provider. Four call sites passed
// `!existsSync(target) || options.force` as `copyFile`'s overwrite flag, so `install --force`
// (an OWNERSHIP flag, per `assertChannelOwnership`) replaced the whole file. Measured on a real
// machine: the `web` profile's layer went 988 B → 3738 B at 15:13:18 and the user's `llm-pi-ai`
// provider block vanished; the `notes-assistant` profile lost its layer the same way at 14:27:45.
// Evidence: `../.dsh-snapshots/PRESERVE-20260927-1513-overlay-clobber/INCIDENT-REPORT.md`.
//
// MUTATION: put `|| options.force` back into any call site, or make `ensurePosture` copy when the
// target exists, and the "keeps"/"byte-intact" checks below go red (verified by doing exactly that).
{
  const postureHome = mkdtempSync(join(tmpdir(), 'dsh-posture-keep-'));
  const postureProfile = join(postureHome, 'profiles', 'web');
  try {
    mkdirSync(postureProfile, { recursive: true });
    const target = join(postureProfile, 'cordis.patch.yml');
    const userLayer = [
      '# Your patch layer for this dsh profile, applied after every bundle layer:',
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      penguin:',
      '        apiKeyEnv: PENGUIN_API_KEY',
      '        baseURL: https://go.penguin.ooo/api',
      '- id: agent-default-model',
      '  config:',
      '    provider: penguin',
      ''
    ].join('\n');
    writeFileSync(target, userLayer, 'utf8');

    // (a) the helper must refuse to touch it, even with force
    const copied = ensurePosture({ dryRun: false, quiet: true, force: true }, postureProfile);
    check('posture: --force does not replace an existing profile patch layer', copied === false);
    check("posture: the user's own rows survive byte-intact",
      readFileSync(target, 'utf8') === userLayer);

    // (a2) and keeping it must be LOUD — silent preservation is how this class hides next time
    const printed = [];
    const realLog = console.log;
    console.log = (...a) => printed.push(a.join(' '));
    let keptLoud = false;
    try {
      keptLoud = ensurePosture({ dryRun: false, quiet: false, force: true }, postureProfile) === false;
    } finally {
      console.log = realLog;
    }
    check('posture: keeping the file is announced ([keep] … cordis.patch.yml)',
      keptLoud && printed.some((l) => l.includes('[keep]') && l.includes('cordis.patch.yml')),
      printed.join(' | ').slice(0, 120));

    // (b) the real CLI must agree, on the deterministic flat channel (no pnpm, no network).
    //     `--profile web` is load-bearing: without it the installer defaults to `notes-assistant`
    //     and never touches the fixture (which is how this check first passed vacuously-ish).
    const cli = run(['install', '--direct', '--flat', '--force', '--profile', 'web', '--dsh-home', postureHome, '--quiet']);
    const afterCli = readFileSync(target, 'utf8');
    check('posture: CLI `install --force` exits 0', cli.status === 0, `status=${cli.status}`);
    check("posture: CLI `install --force` keeps the user's provider block",
      afterCli.includes('id: llm-pi-ai') && afterCli.includes('go.penguin.ooo/api'),
      `${afterCli.split('\n').length} lines`);
    check("posture: ...and the flat channel's generated declaration was still applied (the install is not a no-op)",
      afterCli.includes(DECLARATION_BEGIN) && afterCli.includes('- id: preset-notes-assistant'));

    // (c) an ABSENT layer is still created, verbatim — the fresh-install path must not regress into
    //     "never writes it", which would break every first-time install.
    const freshProfile = join(postureHome, 'profiles', 'fresh');
    mkdirSync(freshProfile, { recursive: true });
    check('posture: an ABSENT layer is still created',
      ensurePosture({ dryRun: false, quiet: true, force: false }, freshProfile) === true);
    check('posture: and it is the shipped scaffold verbatim',
      readFileSync(join(freshProfile, 'cordis.patch.yml'), 'utf8') ===
        readFileSync(join(repo, 'dsh', 'profile', 'cordis.patch.yml'), 'utf8'));

    // (d) --dry-run still writes nothing
    const dryProfile = join(postureHome, 'profiles', 'dry');
    mkdirSync(dryProfile, { recursive: true });
    ensurePosture({ dryRun: true, quiet: true, force: true }, dryProfile);
    check('posture: --dry-run creates no file', !existsSync(join(dryProfile, 'cordis.patch.yml')));

    // (e) structural pin: no call site may copy the scaffold over an existing layer. This catches a
    //     FUTURE fifth call site, which the two runtime channels above cannot.
    const installSrc = readFileSync(join(repo, 'dsh', 'install.mjs'), 'utf8');
    const clobberSites = installSrc.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes('PROFILE_DIR, "cordis.patch.yml"') && line.includes('options.force'))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    check('posture: no source line copies the scaffold under options.force',
      clobberSites.length === 0, clobberSites.join(' | '));
    check('posture: all four channel call sites go through ensurePosture',
      (installSrc.match(/ensurePosture\(options, profileRoot\);/g) ?? []).length === 4,
      String((installSrc.match(/ensurePosture\(options, profileRoot\);/g) ?? []).length));
  } finally {
    rmSync(postureHome, { recursive: true, force: true });
  }
}

console.log(failed === 0 ? 'installer: all checks passed' : `installer: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
