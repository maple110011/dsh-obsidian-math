#!/usr/bin/env node
// Doc-consistency guard: keep easily-drifting numbers in the docs aligned with
// the code's actual value. Single source of truth = scripts/test-memory.mjs
// (the check() invocation count). Exits non-zero on any divergence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let ok = true;
const fail = (msg) => { console.error('FAIL  ' + msg); ok = false; process.exitCode = 1; };

// Actual assertion count: every check('...') invocation in test-memory.mjs.
const testSrc = read('scripts/test-memory.mjs');
const actual = (testSrc.match(/check\(\s*['"`]/g) || []).length;
console.log(`actual check() count in scripts/test-memory.mjs: ${actual}`);

// [file, regex] — the regex must capture the doc's claimed number.
const anchors = [
  ['README.md', /npm test\s+# syntax \+ (\d+) zero-token regression/],
  ['README.zh.md', /npm test\s+# 语法 \+ (\d+) 项零 token 回归/],
  ['ARCHITECTURE.md', /零 token 回归（(\d+) 断言，进 `npm test`）/],
  ['ARCHITECTURE.md', /npm test\s+# 语法 \+ (\d+) 项回归 \+ 安装器 e2e/],
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

if (ok) {
  console.log(`doc-consistency: all ${anchors.length} anchors match ${actual}`);
}
