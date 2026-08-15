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
  join(home, '.agent-presets', 'obsidian', 'preset.yml'),
  join(home, '.agent-presets', 'obsidian', 'agent.cordis.yml'),
  join(home, '.agent-presets', 'obsidian', 'obsidian-memory.mjs'),
  join(home, '.agent-presets', 'obsidian', 'obsidian-notes.mjs'),
  join(home, 'profiles', 'obsidian', 'package.json'),
  join(home, 'profiles', 'obsidian', 'cordis.yml'),
  join(home, 'profiles', 'obsidian', 'cordis.patch.yml'),
  join(home, 'profiles', 'obsidian', 'pnpm-workspace.yaml'),
  join(vault, 'AGENTS.md'),
  join(vault, '.deepseek', 'memory', 'profile.md'),
  join(vault, '.deepseek', 'memory', 'topics', 'index.md'),
  join(vault, '.deepseek', 'memory', 'records', 'index.md'),
  join(vault, '.deepseek', 'memory', 'theorems', 'index.md'),
  join(vault, '.deepseek', 'memory', 'templates', 'index.md'),
  join(vault, '.deepseek', 'memory', 'episodes', 'index.md'),
  join(vault, '.deepseek', 'inbox', 'index.md')
];
let failed = 0;
for (const path of checks) {
  const ok = existsSync(path);
  console.log(ok ? '[ok]' : '[MISSING]', path);
  if (!ok) failed += 1;
}
const cordis = readFileSync(join(home, 'profiles', 'obsidian', 'cordis.patch.yml'), 'utf8');
console.log('patch portable:', cordis.includes('process.env.DSH_OBSIDIAN_VAULT') && cordis.includes('process.cwd()'));
console.log('idempotent second run:');
const again = spawnSync(process.execPath, [join(repo, 'dsh', 'install.mjs'), 'install', '--dsh-home', home, '--vault', vault], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('second run exit:', again.status);
rmSync(home, { recursive: true, force: true });
rmSync(vault, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
