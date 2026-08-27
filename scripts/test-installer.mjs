import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
check('manifest posture=9 files', Array.isArray(manifest.posture) && manifest.posture.length === 9);

// drift detection (always-refresh files must match repo sources)
const driftPairs = [
  [join(presetRoot, 'math-memory.mjs'), join(repo, 'dsh', 'preset', 'math-memory.mjs')],
  [join(presetRoot, 'note-tools.mjs'), join(repo, 'dsh', 'preset', 'note-tools.mjs')],
  [join(presetRoot, 'hook-frontmatter.mjs'), join(repo, 'dsh', 'preset', 'hook-frontmatter.mjs')],
  [join(profileRoot, 'cordis.patch.yml'), join(repo, 'dsh', 'profile', 'cordis.patch.yml')],
  [join(profileRoot, 'notes-assistant.patch.yml'), join(repo, 'dsh', 'profile', 'notes-assistant.patch.yml')],
  [join(profileRoot, 'memory-admin.mjs'), join(repo, 'dsh', 'host', 'memory-admin.mjs')],
  [join(profileRoot, 'math-memory-panel.mjs'), join(repo, 'dsh', 'host', 'math-memory-panel.mjs')],
  [join(vault, 'AGENTS.md'), join(repo, 'dsh', 'templates', 'AGENTS.md')]
];
for (const [installed, source] of driftPairs) {
  check('no drift ' + installed, readFileSync(installed, 'utf8') === readFileSync(source, 'utf8'));
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
r = run(['uninstall', '--purge', '--purge-data', '--yes', '--confirm', 'DELETE MY MATH MEMORY', '--dsh-home', home, '--vault', vault]);
check('full uninstall exit 0', r.status === 0);
check('preset removed', !existsSync(presetRoot));
check('posture removed', !existsSync(join(profileRoot, 'cordis.patch.yml')));
check('manifest removed', !existsSync(join(profileRoot, '.install-manifest.json')));
check('vault AGENTS.md removed', !existsSync(join(vault, 'AGENTS.md')));
check('vault cache removed', !existsSync(join(vault, '.deepseek', 'cache')));

rmSync(home, { recursive: true, force: true });
rmSync(vault, { recursive: true, force: true });
console.log(failed === 0 ? 'installer: all checks passed' : `installer: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
