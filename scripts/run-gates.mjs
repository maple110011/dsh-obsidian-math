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
// THREE STATES, NOT TWO (2026-09-26). A gate that can only compare when the
// machine happens to have something — an installed dsh, a deployed profile —
// prints `__SKIP__ <reason>` and exits 0, so a fresh clone and CI stay green.
// That is fine; counting it as PASSED is not. `test: deployed profile accepts a
// session` reported "45/45 gates passed" while running **0 assertions**, and the
// three activation shapes that were actually broken had no coverage at all. The
// summary now states how many gates were skipped and names them, so "all green"
// can be read for what it is.
//
// Usage:
//   node scripts/run-gates.mjs              # everything
//   node scripts/run-gates.mjs --only auth  # gates whose name matches a string
//   node scripts/run-gates.mjs --list       # names only
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runNode } from './run-node.mjs';
// The gate list lives in its own module so that "how many gates are there" has a
// single source of truth: `scripts/check-doc-counts.mjs` imports the same list
// instead of parsing this file or trusting a number written in prose.
import { GATES } from './lib/gates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

/**
 * `__SKIP__ <reason>` is a suite declaring that it could not compare anything
 * here (`exit 0`). Distinct from a pass on purpose: see the header.
 */
const skipOf = (output) => {
  const m = /__SKIP__\s*([^\n]*)/.exec(output);
  return m === null ? null : m[1].trim();
};

const started = Date.now();
const failures = [];
const skips = [];
let passed = 0;

selected.forEach((gate, i) => {
  const label = `[${String(i + 1).padStart(2)}/${selected.length}]`;
  const r = runNode(gate.args, { cwd: root });
  const count = countOf(r.output);
  const skip = skipOf(r.output);
  // A spawn that never happened is an ENVIRONMENT result. Report it distinctly
  // so nobody reads it as a code failure (see scripts/run-node.mjs).
  const spawnFailed = r.spawnError !== null && r.spawnError !== undefined;
  const ok = !spawnFailed && r.status === 0;
  if (ok && skip !== null) {
    skips.push({ gate, reason: skip, count });
    console.log(`${label} SKIP ${gate.name}${count === null ? '' : `  (${count} static)`}  — ${skip}`);
  } else if (ok) {
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
console.log(`${passed}/${selected.length} gates passed${skips.length === 0 ? '' : `, ${skips.length} skipped`} in ${seconds}s`);
if (skips.length > 0) {
  // Named, not just counted: a SKIP is the one outcome that looks identical to a
  // pass in the summary line, and the whole point of this change is that it must
  // not.
  for (const { gate, reason } of skips) console.log(`  skipped: ${gate.name} — ${reason}`);
  console.log('  (a skipped gate compared nothing here; it is not evidence of correctness)');
}

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
    // Report the FAILING ASSERTIONS first, then the tail. Printing only the last 25 lines hid the one
    // failing assertion behind ~470 passing ones (2026-09-27: three Ubuntu runs in a row said only
    // "installer: 1 check(s) failed" while the actual `[FAIL] …` line was structurally invisible —
    // including to the CI annotation, which can only show what reached stdout). A failure report that
    // cannot name the failure is the defect, not the truncation.
    const failLines = lines.filter((l) => l.includes('[FAIL]') || /(^|\s)FAIL(\s|$)/.test(l));
    const shown = new Set(failLines);
    if (failLines.length > 0) {
      console.log(`  ${failLines.length} failing assertion line(s):`);
      for (const l of failLines.slice(0, 40)) console.log('  ' + l);
      if (failLines.length > 40) console.log(`  … and ${failLines.length - 40} more failing lines`);
    }
    const omitted = lines.filter((l) => !shown.has(l));
    const rest = omitted.slice(-25);
    if (failLines.length > 0) console.log('  … tail:');
    if (omitted.length > rest.length) console.log(`  … ${omitted.length - rest.length} earlier lines omitted`);
    for (const l of rest) console.log('  ' + l);
  }
  process.exitCode = 1;
}
