#!/usr/bin/env node
// scripts/run-gates.mjs — the `npm test` entry point: run EVERY gate, then print
// one summary.
//
// WHY NOT A `&&` CHAIN. With `a && b && c`, the first failure silently skips
// every later gate. The 2026-09-11 review measured what that costs: one gate
// failing for an ENVIRONMENT reason (pipe stdio forbidden -> `spawn EPERM`) hid
// 16 further gates, so "npm test failed" carried no information about whether
// the rest of the repo was sound, and there was no way to tell "not run" from
// "passed". This runner executes all gates unconditionally, reports per-gate
// status plus the suite's own `__CHECKS__` count, and prints the tail of each
// failure so one red run is enough to diagnose.
//
// Usage:
//   node scripts/run-gates.mjs              # everything
//   node scripts/run-gates.mjs --only auth  # gates whose name matches a string
//   node scripts/run-gates.mjs --list       # names only
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runNode } from './run-node.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors the historical `&&` order so results stay comparable run to run.
// `kind: 'syntax'` gates are `node --check`; everything else is a suite/guard.
const GATES = [
  { name: 'syntax: dsh/install.mjs', args: ['--check', 'dsh/install.mjs'] },
  { name: 'syntax: dsh/preset/note-tools.mjs', args: ['--check', 'dsh/preset/note-tools.mjs'] },
  { name: 'syntax: dsh/preset/math-memory.mjs', args: ['--check', 'dsh/preset/math-memory.mjs'] },
  { name: 'syntax: dsh/profile/math-memory-workspace.mjs', args: ['--check', 'dsh/profile/math-memory-workspace.mjs'] },
  { name: 'syntax: main.js (generated bundle)', args: ['--check', 'main.js'] },
  { name: 'preset: imports and exposes its name', args: ['-e', "import('./dsh/preset/math-memory.mjs').then(m=>console.log('preset ok:', m.name))"] },
  { name: 'test: memory regression', args: ['scripts/test-memory.mjs'] },
  { name: 'test: panel routes', args: ['scripts/test-panel-routes.mjs'] },
  { name: 'test: panel auth e2e (real dsh)', args: ['scripts/test-panel-auth.mjs'] },
  { name: 'test: panel loopback proxy', args: ['scripts/test-panel-proxy.mjs'] },
  { name: 'test: panel presentation layer', args: ['scripts/test-panel-present.mjs'] },
  { name: 'test: installer e2e', args: ['scripts/test-installer.mjs'] },
  { name: 'check: rename', args: ['scripts/check-rename.mjs'] },
  { name: 'check: skin fallback', args: ['scripts/check-skin-fallback.mjs'] },
  { name: 'check: plugin id', args: ['scripts/check-plugin-id.mjs'] },
  { name: 'check: version consistency', args: ['scripts/check-version-consistency.mjs'] },
  { name: 'check: doc consistency', args: ['scripts/check-doc-consistency.mjs'] },
  { name: 'check: embedded loader', args: ['scripts/check-embedded-loader.mjs'] },
  { name: 'check: embedded writers', args: ['scripts/check-embedded-writers.mjs'] },
  { name: 'check: engine sync (preset vs host)', args: ['scripts/check-engine-sync.mjs'] },
  { name: 'check: frontmatter single source', args: ['scripts/check-frontmatter-source.mjs'] },
  { name: 'check: env vars vs docs/env-vars.md', args: ['scripts/check-env-vars.mjs'] },
  { name: 'check: doc constants (tools/papers)', args: ['scripts/check-doc-constants.mjs'] },
  { name: 'check: release artifact paths', args: ['scripts/check-release-paths.mjs'] },
  { name: 'check: client bundle freshness', args: ['scripts/check-client-bundle.mjs'] },
  { name: 'check: main.js bundle freshness', args: ['scripts/check-bundle-freshness.mjs'] },
  { name: 'syntax: scripts/lit-import.mjs', args: ['--check', 'scripts/lit-import.mjs'] },
  { name: 'syntax: dsh/host/memory-admin.mjs', args: ['--check', 'dsh/host/memory-admin.mjs'] },
  { name: 'syntax: dsh/host/math-memory-panel.mjs', args: ['--check', 'dsh/host/math-memory-panel.mjs'] },
  { name: 'syntax: dsh/host/index.mjs', args: ['--check', 'dsh/host/index.mjs'] },
  { name: 'syntax: dsh/host/preset-sync.mjs', args: ['--check', 'dsh/host/preset-sync.mjs'] },
  { name: 'syntax: dsh/host/hook-frontmatter.mjs', args: ['--check', 'dsh/host/hook-frontmatter.mjs'] },
  { name: 'test: preset sync', args: ['scripts/test-preset-sync.mjs'] }
];

const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf('--only');
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : null;
const selected = only === null ? GATES : GATES.filter((g) => g.name.includes(only));

if (argv.includes('--list')) {
  for (const g of selected) console.log(g.name);
  process.exit(0);
}

if (selected.length === 0) {
  console.error(`no gate matches --only ${JSON.stringify(only)}`);
  process.exit(2);
}

/** `__CHECKS__ n/m` is the suite's own runtime count; absent for syntax gates. */
const countOf = (output) => {
  const m = /__CHECKS__ (\d+)\/(\d+)/.exec(output);
  return m === null ? null : `${m[1]}/${m[2]} checks`;
};

const started = Date.now();
const failures = [];
let passed = 0;

selected.forEach((gate, i) => {
  const label = `[${String(i + 1).padStart(2)}/${selected.length}]`;
  const r = runNode(gate.args, { cwd: root });
  const count = countOf(r.output);
  // A spawn that never happened is an ENVIRONMENT result. Report it distinctly
  // so nobody reads it as a code failure (see scripts/run-node.mjs).
  const spawnFailed = r.spawnError !== null && r.spawnError !== undefined;
  const ok = !spawnFailed && r.status === 0;
  if (ok) {
    passed += 1;
    console.log(`${label} ok   ${gate.name}${count === null ? '' : `  (${count})`}`);
  } else {
    const why = spawnFailed
      ? `could not start the child process: ${r.spawnError.code ?? r.spawnError.message}`
      : `exit ${r.status}`;
    failures.push({ gate, r, why, spawnFailed });
    console.log(`${label} FAIL ${gate.name}  (${why})`);
  }
});

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('');
console.log('─'.repeat(72));
console.log(`${passed}/${selected.length} gates passed in ${seconds}s`);

if (failures.length > 0) {
  for (const { gate, r, why, spawnFailed } of failures) {
    console.log('');
    console.log(`── FAILED: ${gate.name} (${why}) ${'─'.repeat(Math.max(0, 30 - gate.name.length))}`);
    if (spawnFailed) {
      console.log('  The child process never started. This is an environment restriction,');
      console.log('  NOT a failure of the code under test. Re-run this gate alone; if it');
      console.log('  fails the same way outside the sandbox, then treat it as a defect.');
      continue;
    }
    const lines = r.output.split('\n').filter((l) => l !== '');
    const tail = lines.slice(-25);
    if (lines.length > tail.length) console.log(`  … ${lines.length - tail.length} earlier lines omitted`);
    for (const l of tail) console.log('  ' + l);
  }
  process.exitCode = 1;
}
