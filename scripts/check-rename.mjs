/**
 * check-rename — two rename guards:
 *
 * 1. fails if a stale `obsidian` PROFILE-NAME reference remains in the live
 *    source. The preset/profile id is `notes-assistant` now.
 * 2. fails if the retired product/plugin name `dsh web ui` / `dsh-web-ui`
 *    reappears in **live** files. The product is `dsh web`; the plugin family is
 *    published as the `@linxin666/dsh-web-all` aggregate over
 *    `dsh-client-ui-*` packages (the old `dsh-web-ui-all` aggregate was replaced
 *    in 0.3.20 — that exact retired PACKAGE name stays legal, because release
 *    notes and the adaptation doc must be able to name it).
 *
 * Legitimate `obsidian` usages are NOT flagged: the Obsidian API
 * (`require('obsidian')`), the source dir (`obsidian/`), file names
 * (`math-memory.mjs` …), legacy env vars (`DSH_OBSIDIAN_*`), and the
 * legacy-migration warning in install.mjs (separate string args).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const roots = ["dsh", "obsidian", "scripts"];
const pattern = /--profile\s+["']?obsidian\b|default:\s*obsidian\b|agentPreset:\s*["']obsidian["']|PRESET_NAME\s*=\s*['"]obsidian['"]|PROFILE_NAME\s*=\s*["']obsidian["']/;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git"].includes(entry.name)) walk(path);
    } else {
      files.push(path);
    }
  }
};
for (const r of roots) walk(join(root, r));
// Rule 2 also covers the docs and the root-level markdown (README first).
walk(join(root, "docs"));
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(root, entry.name));
}

let failed = 0;
for (const file of files) {
  if (!/\.(js|mjs|yml|yaml|json)$/.test(file)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      console.log(`[STALE] ${file}:${i + 1}: ${lines[i].trim()}`);
      failed += 1;
    }
  }
}
if (failed > 0) {
  console.log(`\n${failed} stale \`obsidian\` profile-name reference(s) found — rename them to \`notes-assistant\`.`);
  process.exit(1);
}

// ── rule 2: the retired product / plugin-family name ────────────────────────
// `dsh-web-ui-all` is a REAL retired package name that release notes and the
// 0.1.5 adaptation doc legitimately quote, so the negative lookahead keeps it
// legal while still catching the product/family wording.
const staleProduct = /dsh[ -][Ww]eb[ -][Uu][Ii](?!-)/;

// Files whose whole point is to record the past: the OLD name is a fact inside
// them, and "fixing" it would erase how the rename happened.
const HISTORICAL = new Map([
  ["CHANGELOG.md", "released sections are historical records"],
  ["main.js", "generated artifact — its sources are what this guard scans"],
  ["scripts/check-rename.mjs", "this guard must be able to NAME what it forbids"],
  ["REFACTOR-PLAN.md", "retired archive (status banner is corrected separately)"],
  ["推文-0.7.1.md", "release announcement archive"],
  ["docs/memory/changelog.md", "dated maintenance ledger"],
  ["docs/handoff.md", "names the old spelling when explaining the rename (trap 60)"],
  ["docs/maintainability-review-2026-09-11.md", "read-only audit snapshot"],
  ["docs/maintainability-fixes-2026-09-11.md", "ledger: describes the drift it fixed"],
  ["docs/project-assessment-2026-09-10.md", "dated audit snapshot"],
  ["docs/dsh-0.1.5-adaptation.md", "records the upstream rename itself"],
  ["docs/dsh-panel-research.md", "dated research snapshot, carries a correction note"]
]);

// Directories that are frozen snapshots. `scripts/qa/benchmark-vault/` is a
// whole synthetic vault used as the benchmark corpus: rewording it changes what
// the benchmark measures, so it is refreshed deliberately (with a new baseline),
// never by a rename sweep. Note it also still says 0.6.x on purpose.
const HISTORICAL_PREFIXES = [
  ["scripts/qa/benchmark-vault/", "frozen benchmark fixture vault (corpus — a rename must not perturb it)"]
];

let stale = 0;
for (const file of files) {
  if (!/\.(mjs|js|ts|yml|yaml|json|md)$/.test(file)) continue;
  // `root` carries a trailing separator, so slice it off rather than adding 1.
  const rel = file.slice(root.length).replace(/^[\\/]/, "").replace(/\\/g, "/");
  if (HISTORICAL.has(rel)) continue;
  if (HISTORICAL_PREFIXES.some(([prefix]) => rel.startsWith(prefix))) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!staleProduct.test(lines[i])) continue;
    console.log(`[RENAMED] ${rel}:${i + 1}: ${lines[i].trim()}`);
    stale += 1;
  }
}
if (stale > 0) {
  console.log(`\n${stale} stale \`dsh web ui\` reference(s) — the product is \`dsh web\`; the plugin family is the`);
  console.log("`@linxin666/dsh-web-all` aggregate over `dsh-client-ui-*`. If the file is a historical record,");
  console.log("add it to HISTORICAL in this guard with a reason instead of rewording it.");
  process.exit(1);
}

// ── rule 3: a MOVED file's old path ─────────────────────────────────────────
// `docs/memory/handoff.md` became `docs/handoff.md` on 2026-09-11: it is the
// REPO-WIDE handoff (entry map, traps, the authoritative not-done list), and
// filing it under `docs/memory/` claimed it was memory-subsystem documentation —
// which is exactly how a reader decides not to open it. A path that no longer
// exists is the most common form of dead link, so it is checked like a rename.
const movedPath = /docs\/memory\/handoff\.md/;
const MOVED_ALLOW = new Set(["scripts/check-rename.mjs"]); // must be able to name it
let dead = 0;
for (const file of files) {
  if (!/\.(mjs|js|ts|yml|yaml|json|md)$/.test(file)) continue;
  const rel = file.slice(root.length).replace(/^[\\/]/, "").replace(/\\/g, "/");
  if (rel === "main.js" || MOVED_ALLOW.has(rel)) continue; // main.js is generated from dsh/**
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!movedPath.test(lines[i])) continue;
    console.log(`[MOVED] ${rel}:${i + 1}: ${lines[i].trim()}`);
    dead += 1;
  }
}
if (dead > 0) {
  console.log(`\n${dead} reference(s) to the OLD path \`docs/memory/handoff.md\` — the handoff is now \`docs/handoff.md\`.`);
  console.log("It is the repo-wide handoff, not memory-subsystem documentation (2026-09-11).");
  process.exit(1);
}

console.log(`rename check: ok (no stale \`obsidian\` profile-name, no stale \`dsh web ui\`, no dead \`docs/memory/handoff.md\` in ${files.length} scanned files)`);
