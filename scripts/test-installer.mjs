import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// Aliased: this file already has a local `writeManifest` helper (a fixture that writes an owner marker).
import { verifyPostureDigests, ensurePresetDeclaration, stripPresetDeclaration, writeManifest as writeInstallManifest } from '../dsh/install.mjs';
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

    // The flat shape must keep reporting honestly too.
    run(['install', '--direct', '--dsh-home', directHome, '--quiet']);
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
    const forced = spawnSync(process.execPath, [installer, 'install', '--direct', '--dsh-home', forceHome],
      { encoding: 'utf8', env: { ...process.env, DSH_TEST_FORCE_CLIENT_FAIL: '1' } });
    const forcedOut = `${forced.stdout ?? ''}${forced.stderr ?? ''}`;
    check('a client-half failure makes the direct install exit non-zero (no more silent Done)',
      forced.status !== 0, `status=${forced.status}`);
    check('...and it says the panel will not appear',
      /没装上/.test(forcedOut) && /记忆面板/.test(forcedOut),
      (forcedOut.split('\n').find((l) => l.includes('没装上')) ?? '').trim().slice(0, 90));
    check('...and it does not print the success banner',
      !/Done \(direct\)/.test(forcedOut));

    // Anti-constant: the same command WITHOUT the hook must still succeed, so the assertions above
    // cannot be satisfied by "this command always fails".
    const okHome = mkdtempSync(join(tmpdir(), 'dsh-client-ok-'));
    try {
      const fine = spawnSync(process.execPath, [installer, 'install', '--direct', '--dsh-home', okHome],
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

// 1. install --direct (fresh)
const installArgs = ['install', '--direct', '--dsh-home', home, '--vault', vault];
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

console.log(failed === 0 ? 'installer: all checks passed' : `installer: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
