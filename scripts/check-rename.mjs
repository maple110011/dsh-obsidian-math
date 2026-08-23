/**
 * check-rename — fails if a stale `obsidian` PROFILE-NAME reference remains in
 * the live source. The preset/profile id is `notes-assistant` now.
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
console.log("rename check: ok (no stale `obsidian` profile-name references)");
