#!/usr/bin/env node
// scripts/check-bundle-freshness.mjs — the committed main.js must equal a fresh build.
//
// WHY. `main.js` is what Obsidian actually loads, and it embeds `dsh/**` plus
// every vault template. CI catches a stale bundle with
// `git diff --exit-code main.js`, but LOCALLY nothing did: the existing guard
// (check-embedded-writers.mjs) only compared the embedded `memory-admin.mjs`, so
// editing `math-memory.mjs`, `note-tools.mjs`, `math-memory-panel.mjs`, a profile
// file or any template and forgetting to rebuild still passed `npm test`
// (docs/maintainability-review-2026-09-11.md P2-10). This closes that locally,
// with the same single source of truth: `buildMain()` from build-obsidian.mjs.
//
// Line endings are normalized before comparing: a Windows checkout with
// core.autocrlf presents main.js as CRLF while the build emits LF, and comparing
// raw bytes there reported "stale bundle" on a correct tree (handoff.md trap 57).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMain } from './build-obsidian.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'main.js');
const lf = (s) => s.replace(/\r\n/g, '\n');

const results = [];
function check(name, condition, detail = '') {
  results.push(Boolean(condition));
  console.log((condition ? '[ok] ' : '[FAIL] ') + name + (detail ? ' ' + detail : ''));
}

check('main.js exists', existsSync(target));
const committed = existsSync(target) ? lf(readFileSync(target, 'utf8')) : '';

// A fresh build also runs the embed-list completeness gates, so this reports a
// bad embed list as well as a stale bundle.
let fresh = null;
let buildError = null;
try {
  fresh = lf(buildMain());
} catch (error) {
  buildError = String(error?.message ?? error).split('\n')[0];
}

if (buildError !== null) {
  check('a fresh build succeeds', false, buildError);
} else {
  const same = committed === fresh;
  check('the committed main.js is byte-identical to a fresh build', same,
    same ? '' : 'run `node scripts/build-obsidian.mjs` and commit main.js');
  if (!same) {
    console.log(`     committed ${Buffer.byteLength(committed, 'utf8')} bytes vs fresh ${Buffer.byteLength(fresh, 'utf8')} bytes`);
    // Point at WHICH embedded source differs — a bare length mismatch leaves the
    // maintainer (or agent) bisecting by hand.
    const firstDiff = (() => {
      const n = Math.min(committed.length, fresh.length);
      for (let i = 0; i < n; i += 1) if (committed[i] !== fresh[i]) return i;
      return n;
    })();
    const context = (s) => JSON.stringify(s.slice(Math.max(0, firstDiff - 60), firstDiff + 60));
    console.log(`     first difference at offset ${firstDiff}`);
    console.log(`     committed: ${context(committed)}`);
    console.log(`     fresh:     ${context(fresh)}`);
  }
}

const failed = results.filter((r) => !r).length;
console.log('');
console.log(failed === 0 ? 'bundle-freshness: OK' : `bundle-freshness: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
