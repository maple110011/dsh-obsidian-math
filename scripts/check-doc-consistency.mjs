#!/usr/bin/env node
// Doc-consistency guard: keep easily-drifting numbers in the docs aligned with
// the code's actual value.
//
// The single source of truth is the RUNTIME count printed by each suite, not a
// regex over its source. Counting `check(` call sites undercounts any assertion
// built inside a loop or a fixture matrix (this guard itself was caught doing
// exactly that: 152 call sites vs 155 executed) and cannot see an early exit.
// Each suite therefore prints `__CHECKS__ <passed>/<total>`, and this guard runs
// them, parses that line, and compares the docs against the number that really
// ran. Exits non-zero on any divergence.
//
// THREE outcomes per suite, and they must stay distinct:
//   * a real count            -> anchors are compared against it
//   * a declared SKIP         -> anchors are reported as skipped
//   * the suite could not run -> anchors are reported as skipped, NOT compared
// The third case is why this file no longer uses `execFileSync`: with piped
// stdio the child could not start at all in a restricted environment, the count
// read as 0, and the guard announced 18 "docs drifted" failures (docs claimed
// 232 checks, "actual" 0) when the docs were right all along. The obvious
// repair for an agent reading that output is to "fix" the correct docs, which
// is the actual damage. See scripts/run-node.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runNode } from './run-node.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let ok = true;
const fail = (msg) => { console.error('FAIL  ' + msg); ok = false; process.exitCode = 1; };

/**
 * Run one suite and return its executed assertion count from `__CHECKS__`.
 *
 * Returns null — meaning "no conclusion available" — for a declared SKIP or for
 * a suite the environment would not let us start. Returns the real total when
 * the suite ran. Reports a failure only when the suite ran and contradicted
 * itself or its docs.
 */
function runSuite(rel, { optional = false } = {}) {
  const r = runNode([join(root, rel)], { cwd: root });
  if (r.spawnError !== null) {
    console.log(`SKIP  ${rel}: could not start it here (${r.spawnError.code ?? r.spawnError.message}) — environment, not docs`);
    return null;
  }
  const stdout = r.output;
  const m = /__CHECKS__ (\d+)\/(\d+)/.exec(stdout);
  if (m === null) {
    if (optional && /\bSKIP\b/.test(stdout)) {
      console.log(`SKIP  ${rel}: ${(/^.*\bSKIP\b.*$/m.exec(stdout) ?? [''])[0].trim()}`);
      return null;
    }
    fail(`${rel}: no __CHECKS__ line in its output`);
    return 0;
  }
  if (m[1] !== m[2]) fail(`${rel}: ${m[1]}/${m[2]} assertions passed — fix the suite before trusting the docs`);
  return Number(m[2]);
}

const actual = runSuite('scripts/test-memory.mjs');
console.log(`actual executed checks in scripts/test-memory.mjs: ${actual}`);

const actualRoutes = runSuite('scripts/test-panel-routes.mjs');
console.log(`actual executed checks in scripts/test-panel-routes.mjs: ${actualRoutes}`);

const actualAuth = runSuite('scripts/test-panel-auth.mjs', { optional: true });
console.log(`actual executed checks in scripts/test-panel-auth.mjs: ${actualAuth === null ? 'skipped (no local dsh / environment)' : actualAuth}`);

const actualProxy = runSuite('scripts/test-panel-proxy.mjs');
console.log(`actual executed checks in scripts/test-panel-proxy.mjs: ${actualProxy}`);

/**
 * Compare every anchor against the suite's real count.
 *
 * `actual === null` means nothing can be concluded (the suite did not run
 * here). The anchor is then REPORTED as skipped rather than compared against an
 * invented 0, so an environment restriction can never masquerade as doc drift.
 */
function compareAnchors(list, actual, { label = 'anchor', what = 'checks' } = {}) {
  const suffix = what === '' ? '' : ' ' + what;
  for (const [file, re] of list) {
    const text = read(file);
    const m = text.match(re);
    if (!m) {
      fail(`${file}: ${label} not found`);
      continue;
    }
    const claimed = Number(m[1]);
    if (actual === null) {
      console.log(`SKIP  ${file}: claims ${claimed}${suffix} (that suite did not run here)`);
      continue;
    }
    if (claimed !== actual) {
      fail(`${file}: claims ${claimed}${suffix}, actual ${actual}`);
    } else {
      console.log(`OK    ${file}: ${claimed}${suffix}`);
    }
  }
}

// [file, regex] — the regex must capture the doc's claimed number.
const anchors = [
  ['README.md', /npm test\s+# syntax \+ (\d+) zero-token regression/],
  ['README.zh.md', /npm test\s+# 语法 \+ (\d+) 项零 token 回归/],
  ['ARCHITECTURE.md', /零 token 回归（(\d+) 断言，进 `npm test`）/],
  // The route number here is deliberately NOT pinned: this anchor exists for the
  // memory count, and hard-coding the route count in the regex made the guard
  // fail with "anchor not found" every time the route suite grew (the route
  // count has its own anchors below). The same lesson applies to the segments
  // BETWEEN the two pinned numbers: new suites get inserted there (authenticated
  // handshake, loopback proxy), so they are matched as "anything up to the
  // installer e2e".
  ['ARCHITECTURE.md', /npm test\s+# 语法 \+ (\d+) 项回归 \+ \d+ 项路由回归 \+ [^\n]*安装器 e2e/],
  ['docs/memory/README.md', /✅ (\d+) 项零 token 回归/],
  ['docs/handoff.md', /零 token 记忆回归（(\d+) 项断言，进 `npm test`）/],
  ['docs/handoff.md', /npm test\s+# (\d+) 项零 token 回归/],
];

// The route-suite number, anchored separately so the two suites cannot silently
// borrow each other's total.
const routeAnchors = [
  ['README.md', /\+ (\d+) route-level checks/],
  ['README.zh.md', /路由回归（(\d+) 项路由断言）/],
  ['ARCHITECTURE.md', /路由信任边界回归（(\d+) 断言/],
  ['docs/handoff.md', /路由信任边界回归（(\d+) 项断言/],
];

const authAnchors = [
  ['README.md', /\+ (\d+) real-dsh handshake checks/],
  ['README.zh.md', /侧栏认证握手回归（(\d+) 项/],
];

const proxyAnchors = [
  ['README.md', /\+ (\d+) loopback-proxy checks/],
  ['README.zh.md', /侧栏反代回归（(\d+) 项）/],
];

compareAnchors(anchors, actual, { what: '' });
compareAnchors(routeAnchors, actualRoutes, { label: 'route anchor', what: 'route checks' });
compareAnchors(authAnchors, actualAuth, { label: 'auth anchor', what: 'auth checks' });
compareAnchors(proxyAnchors, actualProxy, { label: 'proxy anchor', what: 'proxy checks' });

if (ok) {
  const authText = actualAuth === null ? `${authAnchors.length} auth anchors skipped (suite did not run here)` : `${actualAuth} auth`;
  console.log(`doc-consistency: all ${anchors.length + routeAnchors.length + proxyAnchors.length} comparable anchors match (${actual} memory + ${actualRoutes} route + ${actualProxy} proxy + ${authText})`);
}
