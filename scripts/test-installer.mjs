import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'dsh-home-test-'));
const vault = mkdtempSync(join(tmpdir(), 'dsh-vault-test-'));
// Inherit stdio instead of piping: sandboxed CI environments may forbid
// capturing a child process's output through anonymous pipes.
const run = spawnSync(process.execPath, [join(repo, 'dsh', 'install.mjs'), 'install', '--dsh-home', home, '--vault', vault], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('installer exit:', run.status, run.error ? String(run.error) : '');
if (run.error) process.exit(1);

const checks = [
  join(home, '.agent-presets', 'notes-assistant', 'preset.yml'),
  join(home, '.agent-presets', 'notes-assistant', 'agent.cordis.yml'),
  join(home, '.agent-presets', 'notes-assistant', 'math-memory.mjs'),
  join(home, '.agent-presets', 'notes-assistant', 'note-tools.mjs'),
  join(home, '.agent-presets', 'notes-assistant', 'hook-frontmatter.mjs'),
  join(home, 'profiles', 'notes-assistant', 'package.json'),
  join(home, 'profiles', 'notes-assistant', 'cordis.yml'),
  join(home, 'profiles', 'notes-assistant', 'cordis.patch.yml'),
  join(home, 'profiles', 'notes-assistant', 'pnpm-workspace.yaml'),
  join(home, 'profiles', 'notes-assistant', 'math-memory-workspace.mjs'),
  join(home, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml'),
  join(vault, 'AGENTS.md'),
  join(vault, '.deepseek', 'memory', 'profile.md'),
  join(vault, '.deepseek', 'memory', 'topics', 'index.md'),
  join(vault, '.deepseek', 'memory', 'records', 'index.md'),
  join(vault, '.deepseek', 'memory', 'theorems', 'index.md'),
  join(vault, '.deepseek', 'memory', 'templates', 'index.md'),
  join(vault, '.deepseek', 'memory', 'episodes', 'index.md'),
  join(vault, '.deepseek', 'inbox', 'index.md'),
  join(vault, '.deepseek', 'capture-policy.md'),
  join(vault, '.deepseek', 'memory', 'notation.md')
];
let failed = 0;
for (const path of checks) {
  const ok = existsSync(path);
  console.log(ok ? '[ok]' : '[MISSING]', path);
  if (!ok) failed += 1;
}
const cordis = readFileSync(join(home, 'profiles', 'notes-assistant', 'cordis.patch.yml'), 'utf8');
console.log('patch portable:', cordis.includes('process.env.DSH_OBSIDIAN_VAULT') && cordis.includes('process.cwd()'));
// Drift detection: the always-refresh files written on the first run must be
// byte-identical to the repo sources — a stale embedded copy in install.mjs
// or main.js would otherwise ship silently.
const driftPairs = [
  [join(home, '.agent-presets', 'notes-assistant', 'math-memory.mjs'), join(repo, 'dsh', 'preset', 'math-memory.mjs')],
  [join(home, '.agent-presets', 'notes-assistant', 'note-tools.mjs'), join(repo, 'dsh', 'preset', 'note-tools.mjs')],
  [join(home, '.agent-presets', 'notes-assistant', 'hook-frontmatter.mjs'), join(repo, 'dsh', 'preset', 'hook-frontmatter.mjs')],
  [join(home, '.agent-presets', 'notes-assistant', 'preset.yml'), join(repo, 'dsh', 'preset', 'preset.yml')],
  [join(home, '.agent-presets', 'notes-assistant', 'agent.cordis.yml'), join(repo, 'dsh', 'preset', 'agent.cordis.yml')],
  [join(home, 'profiles', 'notes-assistant', 'package.json'), join(repo, 'dsh', 'profile', 'package.json')],
  [join(home, 'profiles', 'notes-assistant', 'cordis.yml'), join(repo, 'dsh', 'profile', 'cordis.yml')],
  [join(home, 'profiles', 'notes-assistant', 'cordis.patch.yml'), join(repo, 'dsh', 'profile', 'cordis.patch.yml')],
  [join(home, 'profiles', 'notes-assistant', 'pnpm-workspace.yaml'), join(repo, 'dsh', 'profile', 'pnpm-workspace.yaml')],
  [join(home, 'profiles', 'notes-assistant', 'math-memory-workspace.mjs'), join(repo, 'dsh', 'profile', 'math-memory-workspace.mjs')],
  [join(home, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml'), join(repo, 'dsh', 'profile', 'notes-assistant.patch.yml')],
  [join(vault, 'AGENTS.md'), join(repo, 'dsh', 'templates', 'AGENTS.md')]
];
for (const [installed, source] of driftPairs) {
  const same = readFileSync(installed, 'utf8') === readFileSync(source, 'utf8');
  console.log(same ? '[ok]' : '[DRIFT]', installed, 'vs', source);
  if (!same) failed += 1;
}
console.log('idempotent second run:');
const again = spawnSync(process.execPath, [join(repo, 'dsh', 'install.mjs'), 'install', '--dsh-home', home, '--vault', vault], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('second run exit:', again.status);
rmSync(home, { recursive: true, force: true });
rmSync(vault, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
