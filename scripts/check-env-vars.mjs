/**
 * check-env-vars — `docs/env-vars.md` and the code must agree, in BOTH directions.
 *
 * Why this guard exists
 * ---------------------
 * Before 2026-09-11 the environment variables this repo reads existed only in the
 * code: 11 `DSH_*` names spread over 9 files, three ALIAS PAIRS (each read twice,
 * new-name-first), and one switch that was described in a plan document but read
 * by NOTHING (`DSH_MATH_MEMORY_ENABLED`). A maintainer asking "what does this do,
 * which name wins, can I delete it" had to grep, and grep answers only the
 * question you already thought to ask.
 *
 * Three rules
 * -----------
 * 1. every `process.env.X` the repo reads is documented in a table row of
 *    `docs/env-vars.md`;
 * 2. every documented row that is NOT marked dead is actually read somewhere
 *    (otherwise the doc rots into a list of things that no longer exist);
 * 3. every row MARKED dead is read nowhere (so "implementing" the dead switch
 *    fails here first, forcing the doc to be updated in the same change).
 *
 * The comparison is against the real filesystem walk, not `grep` — hidden
 * directories (`.deepseek/`, `.github/`) are exactly where the last drift hid
 * (see `handoff.md` trap 67).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Code roots. `main.js` is excluded: it is a generated bundle of `dsh/**` +
// `obsidian/main.template.js`, so scanning it would only duplicate findings.
// `scripts/qa/runs/` holds archived probe output, not code.
const SCAN_ROOTS = ["dsh", "obsidian", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".raw", "runs"]);

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path);
    } else if (/\.(mjs|js|ts|yml|yaml|json)$/.test(entry.name)) {
      files.push(path);
    }
  }
};
for (const r of SCAN_ROOTS) walk(join(root, r));

// ── what the code reads ─────────────────────────────────────────────────────
// This guard's own source is skipped: it must be able to write the PATTERN
// (`process.env.X` appears in the doc comment above) without that counting as a
// read. Same reason `check-rename.mjs` exempts itself.
const SELF = "scripts/check-env-vars.mjs";
const READS = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const read = new Map(); // name -> [relPath, …]
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (rel === SELF) continue;
  for (const m of readFileSync(file, "utf8").matchAll(READS)) {
    const name = m[1];
    if (!read.has(name)) read.set(name, []);
    const where = read.get(name);
    if (where.length < 6 && !where.includes(rel)) where.push(rel);
  }
}

// ── what the doc claims ─────────────────────────────────────────────────────
// Only TABLE ROWS count. Prose may mention a name (the dead-switch section
// explains why it is not implemented) without claiming it is live.
const doc = readFileSync(join(root, "docs", "env-vars.md"), "utf8");
const documented = new Map(); // name -> { dead, line }
const ROW = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|(.*)$/;
doc.split(/\r?\n/).forEach((line, i) => {
  const m = ROW.exec(line);
  if (m === null) return;
  // A row is "dead" when its cells say so; §3 is the dead-switch table, so the
  // marker there is the zero-read claim itself.
  documented.set(m[1], { dead: /零读取|死开关|read by NOTHING|never implemented/i.test(m[2]), line: i + 1 });
});

const fail = (msg) => { console.log(`[FAIL] ${msg}`); failed += 1; };
let failed = 0;

// rule 1
const undocumented = [...read.keys()].filter((name) => !documented.has(name)).sort();
for (const name of undocumented) {
  fail(`\`${name}\` is read by ${read.get(name).join(", ")} but has no row in docs/env-vars.md`);
}

// rules 2 and 3
for (const [name, meta] of [...documented].sort()) {
  const sites = read.get(name);
  if (meta.dead) {
    if (sites !== undefined) {
      fail(`\`${name}\` is documented as a dead switch (docs/env-vars.md:${meta.line}) but is now read by ${sites.join(", ")} — either remove the read or update the doc`);
    }
  } else if (sites === undefined) {
    fail(`\`${name}\` is documented (docs/env-vars.md:${meta.line}) but no code reads it — the doc has rotted, or the read was deleted`);
  }
}

// Self-checks: a guard that cannot see anything "passes" for the wrong reason.
if (read.size === 0) fail("extracted 0 env reads — the extractor is broken, not the docs");
if (documented.size === 0) fail("parsed 0 documented env rows — the table format or path changed");
if (![...documented.values()].some((m) => m.dead)) {
  fail("no row is marked as a dead switch — the dead-switch rule is untested by this repo's own doc");
}

if (failed > 0) {
  console.log(`\n${failed} env-var inconsistency(ies). docs/env-vars.md is the single reference; keep it in step with the code.`);
  console.log("Run `node scripts/check-env-vars.mjs --list` to see every variable with its reading sites.");
  process.exit(1);
}

// `--list` prints the derived inventory. docs/env-vars.md deliberately does NOT
// enumerate call sites (that list rots); this is where to get them from.
if (process.argv.includes("--list")) {
  console.log(`\nderived inventory (${read.size} names, ${files.length} files scanned):`);
  for (const [name, where] of [...read].sort()) {
    const dead = documented.get(name)?.dead === true ? " [documented dead]" : "";
    console.log(`  ${name}${dead}\n      ${where.join("\n      ")}`);
  }
  const unread = [...documented.keys()].filter((name) => !read.has(name));
  if (unread.length > 0) console.log(`  (documented, no reads: ${unread.join(", ")})`);
}

console.log(`env-vars: ok (${read.size} names read in ${files.length} files, all documented; ${[...documented.values()].filter((m) => m.dead).length} dead switch documented as unread)`);
