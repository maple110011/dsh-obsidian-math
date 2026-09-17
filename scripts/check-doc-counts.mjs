/**
 * check-doc-counts — hand-written counts must not rot, and must be checkable.
 *
 * Why this guard exists
 * ---------------------
 * Two counts live in prose on the FIRST-READ PATH (`AGENTS.md` is the file the
 * agent harness injects automatically), and both rotted:
 *
 *   - "这个仓库有多少条历史陷阱" said **69** while `docs/handoff.md` §4 had
 *     grown to **81**;
 *   - "有多少条门禁" said **34/34** while `scripts/run-gates.mjs` was running
 *     **41**.
 *
 * A reader (human or agent) with no way to count cannot tell which of two
 * documents to believe. Same failure mode as the semantic constants in
 * `check-doc-constants.mjs` (note tools, papers) — so the same treatment: give
 * each count a machine-readable source of truth and compare every claim.
 *
 * The two sources of truth
 * ------------------------
 * 1. **Traps** — the numbered entries of `docs/handoff.md` §4, declared by that
 *    section's own marker line `> 陷阱条数：N`.
 * 2. **Gates** — the exported `GATES` list in `scripts/lib/gates.mjs`, which is
 *    the same array `run-gates.mjs` executes. Importing it (rather than parsing
 *    the runner, or counting `--list` output) keeps this guard free of child
 *    processes, which sandboxes forbid.
 *
 * What is asserted beyond the totals: **the trap numbering must be 1..N with no
 * repeats and no gaps.** A duplicated number makes "see trap 62" ambiguous while
 * the total still looks right, so a total-only check would miss it.
 *
 * A claim site that stops matching FAILS rather than being skipped: an anchor
 * that quietly matches nothing is how a guard becomes decoration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATES } from "./lib/gates.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = 0;
const fail = (msg) => { console.log(`[FAIL] ${msg}`); failed += 1; };

const read = (rel) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

const agents = read("AGENTS.md");

// ── 1. traps: count the numbered entries of handoff §4 ─────────────────────
const handoff = read("docs/handoff.md");
const section = (() => {
  const start = /^## 4\. .*$/m.exec(handoff);
  if (start === null) return null;
  const rest = handoff.slice(start.index + start[0].length);
  const end = /^## 5\. /m.exec(rest);
  return end === null ? rest : rest.slice(0, end.index);
})();

if (section === null) {
  fail("docs/handoff.md has no `## 4. ` section — the trap list is where the counts come from");
}

let traps = [];
if (section !== null) {
  // Top-level `N. ` items only: sub-bullets are indented, and the prose inside a
  // trap may quote numbers, so both must be excluded.
  traps = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
}

if (traps.length === 0) {
  fail("docs/handoff.md §4 has no `N. ` entries — the extractor is broken, or the section was reformatted");
} else {
  const seen = new Map();
  for (const n of traps) seen.set(n, (seen.get(n) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);
  const max = Math.max(...traps);
  const missing = [];
  for (let i = 1; i <= max; i += 1) if (!seen.has(i)) missing.push(i);
  if (duplicates.length > 0) fail(`docs/handoff.md §4 repeats trap number(s): ${duplicates.join(", ")}`);
  if (missing.length > 0) fail(`docs/handoff.md §4 skips trap number(s): ${missing.join(", ")}`);
}

const declared = section === null ? null : /^> 陷阱条数：(\d+)$/m.exec(section);
if (declared === null) {
  fail("docs/handoff.md §4 must declare its own size in a marker line `> 陷阱条数：N` right under the heading — without it every reference is a hand-written number");
} else if (traps.length > 0 && Number(declared[1]) !== traps.length) {
  fail(`docs/handoff.md §4 declares ${declared[1]} traps but holds ${traps.length} numbered entries`);
}

const TRAP_CLAIMS = [
  ["AGENTS.md §1 table", /\*\*(\d+) 条历史陷阱\*\*/],
  ["AGENTS.md §6 bullet", /`docs\/handoff\.md` §4（\*\*(\d+) 条\*\*/]
];
for (const [what, pattern] of TRAP_CLAIMS) {
  const m = pattern.exec(agents);
  if (m === null) {
    fail(`${what}: no trap-count claim matching ${pattern} — the wording changed, so update this guard rather than losing the anchor`);
    continue;
  }
  if (traps.length > 0 && Number(m[1]) !== traps.length) {
    fail(`${what} claims ${m[1]} traps, but docs/handoff.md §4 holds ${traps.length}`);
  }
}

// ── 2. gates: the registered total from the single source of truth ─────────
// Deliberately the TOTAL, not "how many passed here": the passing count is an
// environment result (sandboxes SKIP suites, this machine reds two of them), and
// pinning that to a doc would make the guard fail for the wrong reason.
const gates = GATES.length;
if (gates === 0) fail("scripts/lib/gates.mjs exports an empty GATES list");

const GATE_CLAIMS = [
  // `本机当前 34/34` — the old hand-written form this guard replaces.
  ["AGENTS.md §4 gate count", /本机当前 \*\*(\d+)\*\* 条门禁/]
];
for (const [what, pattern] of GATE_CLAIMS) {
  const m = pattern.exec(agents);
  if (m === null) {
    fail(`${what}: no gate-count claim matching ${pattern} — the wording changed, so update this guard rather than losing the anchor`);
    continue;
  }
  if (gates > 0 && Number(m[1]) !== gates) {
    fail(`${what} claims ${m[1]} gates, but scripts/lib/gates.mjs registers ${gates}`);
  }
}

if (failed > 0) {
  console.log("\nDoc-count mismatch. The sources of truth are docs/handoff.md §4 (marker line)");
  console.log("and scripts/lib/gates.mjs; every claim site that disagrees is listed above.");
  process.exit(1);
}
console.log(`doc-counts: ok (${traps.length} traps — numbering 1..${traps.length}, marker + ${TRAP_CLAIMS.length} AGENTS.md claims agree; ${gates} gates from scripts/lib/gates.mjs + ${GATE_CLAIMS.length} AGENTS.md claim agree)`);
