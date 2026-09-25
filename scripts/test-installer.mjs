import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'dsh-home-test-'));
const vault = mkdtempSync(join(tmpdir(), 'dsh-vault-test-'));
const installer = join(repo, 'dsh', 'install.mjs');
// Inherit stdio instead of piping: sandboxed CI environments may forbid
// capturing a child process's output through anonymous pipes.
const run = (args) => spawnSync(process.execPath, [installer, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

let failed = 0;
const check = (label, cond) => {
  console.log((cond ? '[ok]' : '[FAIL]'), label);
  if (!cond) failed += 1;
};

// 1. install --direct (fresh)
const installArgs = ['install', '--direct', '--dsh-home', home, '--vault', vault];
let r = run(installArgs);
check('direct install exit 0', r.status === 0 && !r.error);

const presetRoot = join(home, '.agent-presets', 'notes-assistant');
const profileRoot = join(home, 'profiles', 'notes-assistant');
const files = [
  // The channel marker + the retired directory's contents (still written by
  // `--direct`; the marker is the npm-vs-direct guard's only anchor).
  join(presetRoot, 'preset.yml'),
  join(presetRoot, 'agent.cordis.yml'),
  join(presetRoot, 'math-memory.mjs'),
  join(presetRoot, 'note-tools.mjs'),
  join(presetRoot, 'hook-frontmatter.mjs'),
  join(profileRoot, 'package.json'),
  join(profileRoot, 'cordis.yml'),
  join(profileRoot, 'cordis.patch.yml'),
  join(profileRoot, 'pnpm-workspace.yaml'),
  join(profileRoot, 'math-memory-workspace.mjs'),
  join(profileRoot, 'notes-assistant.patch.yml'),
  join(profileRoot, 'memory-admin.mjs'),
  join(profileRoot, 'math-memory-panel.mjs'),
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

// owner markers
const presetMarker = JSON.parse(readFileSync(join(presetRoot, '.owner.json'), 'utf8'));
check('preset owner=direct', presetMarker.owner === 'direct');
const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
check('manifest owner=direct', manifest.owner === 'direct');
check('manifest posture=11 files', Array.isArray(manifest.posture) && manifest.posture.length === 11,
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
  [join(presetRoot, 'math-memory.mjs'), join(repo, 'dsh', 'preset', 'math-memory.mjs')],
  [join(presetRoot, 'note-tools.mjs'), join(repo, 'dsh', 'preset', 'note-tools.mjs')],
  [join(presetRoot, 'hook-frontmatter.mjs'), join(repo, 'dsh', 'preset', 'hook-frontmatter.mjs')],
  // The deployed body is what dsh actually imports for this channel.
  [join(profileRoot, 'math-memory.mjs'), join(repo, 'dsh', 'preset', 'math-memory.mjs')],
  [join(profileRoot, 'note-tools.mjs'), join(repo, 'dsh', 'preset', 'note-tools.mjs')],
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

// 3. cross-channel conflict: simulate an npm-owned preset, direct install must refuse
writeFileSync(join(presetRoot, '.owner.json'), JSON.stringify({ owner: 'npm', version: '9.9.9', installedAt: new Date().toISOString() }), 'utf8');
r = run(installArgs);
check('conflict: direct install refuses npm-owned preset (exit 1)', r.status === 1);

// 4. --force takes over
r = run([...installArgs, '--force']);
check('--force takeover exit 0', r.status === 0);
check('--force rewrites owner=direct', JSON.parse(readFileSync(join(presetRoot, '.owner.json'), 'utf8')).owner === 'direct');

// 5. uninstall dry-run (no --yes) leaves files in place
r = run(['uninstall', '--dsh-home', home, '--vault', vault]);
check('uninstall dry-run exit 0', r.status === 0);
check('dry-run keeps preset', existsSync(join(presetRoot, 'agent.cordis.yml')));

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
check('preset removed', !existsSync(presetRoot));
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
