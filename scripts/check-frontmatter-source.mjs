/**
 * check-frontmatter-source — the frontmatter DELIMITER rule has one home.
 *
 * Why this guard exists
 * ---------------------
 * "A file's metadata is a leading `---`\n…\n`---` block" was re-typed as a regex
 * literal in 15 places across 6 parsers in 3 files. Each copy judged the
 * boundary slightly differently, and the three worst data-corruption incidents
 * in this repo's history (`handoff.md` traps 21 / 22 / 43) are all the same
 * shape: a writer's idea of "inside the block" disagreed with every reader's, so
 * the closing `---` ended up mid-file. A comment saying "keep these in sync" did
 * not stop a seventh copy from being typed by habit — a gate does.
 *
 * Two checks
 * ----------
 * 1. **No copies.** The delimiter literal may appear only in the canonical
 *    implementation (`dsh/preset/hook-frontmatter.mjs`) and in the one host copy
 *    that cannot import it (see below). Anywhere else **in executable code** is a
 *    failure. Prose is not a copy: this file's own header and the docs that
 *    quote the regex to explain the rule are skipped (a `.md` file cannot
 *    disagree with a reader at runtime), and comment-only lines are ignored so a
 *    guard can describe what it forbids.
 * 2. **The one permitted copy is identical in BEHAVIOUR.** The preset's
 *    `dsh/preset/hook-frontmatter.mjs` is importable from the preset tree, but
 *    `dsh/host/memory-admin.mjs` CANNOT import it: the Obsidian plugin evaluates
 *    that file through `new Function(...)` with injected bindings instead of
 *    resolving imports (see scripts/check-embedded-loader.mjs). So the host keeps
 *    its own `frontmatterSpan`/`replaceFrontmatter`, and this guard runs both
 *    over a fixture set and requires equal results. That is deliberately
 *    stronger than comparing tokens: the two are allowed to differ in comments
 *    and style, but not in what they consider a block.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  frontmatterSpan as sharedSpan,
  replaceFrontmatter as sharedReplace
} from "../dsh/preset/hook-frontmatter.mjs";
import {
  frontmatterSpan as hostSpan,
  replaceFrontmatter as hostReplace
} from "../dsh/host/memory-admin.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// The rule, in the shapes it has actually been written in. The `---\r?\n` body
// capture is the give-away; `frontmatterSpan` itself uses the tolerant
// `/^---[ \t]*\r?\n/` opener, which is why the two canonical files below are
// matched by path and not by this pattern.
const FORBIDDEN = /\/\^---(?:\\r\?\\n|\[|\\n)|\(\?:\^---|replace\(\s*\/\^---/;

// The only files allowed to contain the delimiter literal, with the reason.
const CANONICAL = new Map([
  ["dsh/preset/hook-frontmatter.mjs", "the single source: frontmatterSpan + friends"],
  ["dsh/host/memory-admin.mjs", "host copy — the Obsidian loader injects bindings instead of resolving imports, so it cannot import the preset file; check 2 below proves it equivalent"]
]);

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git", ".raw"].includes(entry.name)) walk(path);
    } else if (/\.(mjs|js|ts)$/.test(entry.name)) {
      // Code only. `.md` files are allowed to quote the regex — they explain the
      // rule and cannot disagree with a reader at runtime.
      files.push(path);
    }
  }
};
for (const r of ["dsh", "obsidian", "scripts"]) walk(join(root, r));

/** Comment-only lines may name what is forbidden (this guard does, at length). */
const isProse = (line) => {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

let failed = 0;
let scanned = 0;
for (const file of files) {
  const rel = file.slice(root.length).replace(/\\/g, "/");
  if (CANONICAL.has(rel)) continue;
  scanned += 1;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (isProse(lines[i]) || !FORBIDDEN.test(lines[i])) continue;
    console.log(`[COPY] ${rel}:${i + 1}: ${lines[i].trim()}`);
    console.log("       → use frontmatterSpan / readFrontmatter / replaceFrontmatter from dsh/preset/hook-frontmatter.mjs");
    failed += 1;
  }
}
if (failed > 0) {
  console.log(`\n${failed} re-typed frontmatter delimiter(s) found. The rule has ONE home (2026-09-11 review, P1-6).`);
  process.exit(1);
}

// ── check 2: the host copy behaves identically to the shared one ────────────
const fixtures = [
  "---\ntitle: a\n---\nbody\n",
  "---\ntitle: a\nhook:\n  uses: 1\n---\nbody\n",
  "---\r\ntitle: a\r\n---\r\nbody\r\n",
  "---\n\n---\nbody\n",                                  // empty body
  "---   \ntitle: a\n---   \nbody\n",                    // tolerated padding
  "---\ntitle: a\n---\n",                                // no trailing newline
  "---\ntitle: 关于 $$ 的表示 与 $& 的含义\n---\nbody\n",   // replacement-string hazard
  "no frontmatter\n---\nx\n---\n",                       // block not leading
  "---\nunterminated\ntitle: a\n",                       // no closing delimiter
  "plain body\n",
  "",
  "---\n---\n",                                          // empty everything
  "---\ntitle: a\n---body\n"                             // no newline after ---
];

// The CONTRACT both implementations must share. The preset's span also returns
// `block`/`blockEnd` (the whole block including delimiters) because its callers
// splice whole blocks; the host returns only these three. Compare the part that
// means the same thing in both, and let `replaceFrontmatter` below cover the
// splice — a difference in the shared triple is exactly "they disagree about
// where the block is".
const core = (span) => span === null ? null : { start: span.start, end: span.end, text: span.text };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffs = [];
for (const raw of fixtures) {
  const shared = core(sharedSpan(raw));
  const host = core(hostSpan(raw));
  if (!same(shared, host)) {
    diffs.push(`frontmatterSpan(${JSON.stringify(raw)}) shared=${JSON.stringify(shared)} host=${JSON.stringify(host)}`);
  }
  const inner = "fields: 1\n";
  if (sharedReplace(raw, inner) !== hostReplace(raw, inner)) diffs.push(`replaceFrontmatter(${JSON.stringify(raw)})`);
}
// The fixture set is only meaningful if it actually exercises both outcomes.
if (!fixtures.some((raw) => sharedSpan(raw) === null)) {
  console.log("[FAIL] the fixture set has no block-less case — it cannot detect a span that matches everything");
  process.exit(1);
}
if (!fixtures.some((raw) => sharedSpan(raw) !== null)) {
  console.log("[FAIL] the fixture set has no block-bearing case — it cannot detect a span that matches nothing");
  process.exit(1);
}
if (diffs.length > 0) {
  console.log(`[FAIL] the shared and host frontmatter implementations disagree on ${diffs.length} case(s):`);
  for (const d of diffs) console.log(`       ${d}`);
  process.exit(1);
}

console.log(`frontmatter-source: ok (${scanned} code files scanned, no re-typed delimiters; host copy agrees with the shared one on ${fixtures.length} fixtures)`);
