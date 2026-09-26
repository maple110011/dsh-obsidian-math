import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPostureDigests } from '../dsh/install.mjs';
// The contract is the source for "what a profile needs" — assertions below derive from it instead of
// hardcoding counts that rot the moment a file is added (2026-09-26).
import { PROFILE_SCAFFOLD_FILES, PRESET_BODY_FILES } from '../dsh/preset/profile-contract.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'dsh-home-test-'));
const vault = mkdtempSync(join(tmpdir(), 'dsh-vault-test-'));
const installer = join(repo, 'dsh', 'install.mjs');
// Inherit stdio instead of piping: sandboxed CI environments may forbid
// capturing a child process's output through anonymous pipes.
const run = (args) => spawnSync(process.execPath, [installer, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

let failed = 0;
const check = (label, cond, detail = '') => {
  console.log((cond ? '[ok]' : '[FAIL]'), label + (detail === '' || cond ? '' : ` | ${detail}`));
  if (!cond) failed += 1;
};

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
console.log(failed === 0 ? 'installer: all checks passed' : `installer: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
