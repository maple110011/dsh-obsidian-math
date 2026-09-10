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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let ok = true;
const fail = (msg) => { console.error('FAIL  ' + msg); ok = false; process.exitCode = 1; };

/** Run one suite and return its executed assertion count from `__CHECKS__`. */
function runSuite(rel) {
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [join(root, rel)], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    // A failing suite still reports its count; only a hard crash loses it.
    stdout = String(error.stdout ?? '');
    if (stdout === '') {
      fail(`${rel}: suite did not run (${String(error.message).split('\n')[0]})`);
      return 0;
    }
  }
  const m = /__CHECKS__ (\d+)\/(\d+)/.exec(stdout);
  if (m === null) {
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

const actualAuth = runSuite('scripts/test-panel-auth.mjs');
console.log(`actual executed checks in scripts/test-panel-auth.mjs: ${actualAuth}`);

const actualProxy = runSuite('scripts/test-panel-proxy.mjs');
console.log(`actual executed checks in scripts/test-panel-proxy.mjs: ${actualProxy}`);

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
  ['docs/memory/handoff.md', /零 token 记忆回归（(\d+) 项断言，进 `npm test`）/],
  ['docs/memory/handoff.md', /npm test\s+# (\d+) 项零 token 回归/],
];

for (const [file, re] of anchors) {
  const text = read(file);
  const m = text.match(re);
  if (!m) {
    fail(`${file}: anchor not found`);
    continue;
  }
  const claimed = Number(m[1]);
  if (claimed !== actual) {
    fail(`${file}: claims ${claimed}, actual ${actual}`);
  } else {
    console.log(`OK    ${file}: ${claimed}`);
  }
}

// [file, regex] — the route-suite number, anchored separately so the two suites
// cannot silently borrow each other's total.
const routeAnchors = [
  ['README.md', /\+ (\d+) route-level checks/],
  ['README.zh.md', /路由回归（(\d+) 项路由断言）/],
  ['ARCHITECTURE.md', /路由信任边界回归（(\d+) 断言/],
  ['docs/memory/handoff.md', /路由信任边界回归（(\d+) 项断言/],
];

const authAnchors = [
  ['README.md', /\+ (\d+) real-dsh handshake checks/],
  ['README.zh.md', /侧栏认证握手回归（(\d+) 项/],
];

const proxyAnchors = [
  ['README.md', /\+ (\d+) loopback-proxy checks/],
  ['README.zh.md', /侧栏反代回归（(\d+) 项）/],
];

for (const [file, re] of routeAnchors) {
  const text = read(file);
  const m = text.match(re);
  if (!m) {
    fail(`${file}: route anchor not found`);
    continue;
  }
  const claimed = Number(m[1]);
  if (claimed !== actualRoutes) {
    fail(`${file}: claims ${claimed} route checks, actual ${actualRoutes}`);
  } else {
    console.log(`OK    ${file}: ${claimed} route checks`);
  }
}

for (const [file, re] of authAnchors) {
  const text = read(file);
  const m = text.match(re);
  if (!m) {
    fail(`${file}: auth anchor not found`);
    continue;
  }
  const claimed = Number(m[1]);
  if (claimed !== actualAuth) {
    fail(`${file}: claims ${claimed} auth checks, actual ${actualAuth}`);
  } else {
    console.log(`OK    ${file}: ${claimed} auth checks`);
  }
}

for (const [file, re] of proxyAnchors) {
  const text = read(file);
  const m = text.match(re);
  if (!m) {
    fail(`${file}: proxy anchor not found`);
    continue;
  }
  const claimed = Number(m[1]);
  if (claimed !== actualProxy) {
    fail(`${file}: claims ${claimed} proxy checks, actual ${actualProxy}`);
  } else {
    console.log(`OK    ${file}: ${claimed} proxy checks`);
  }
}

if (ok) {
  console.log(`doc-consistency: all ${anchors.length + routeAnchors.length + authAnchors.length + proxyAnchors.length} anchors match (${actual} memory + ${actualRoutes} route + ${actualAuth} auth + ${actualProxy} proxy)`);
}
