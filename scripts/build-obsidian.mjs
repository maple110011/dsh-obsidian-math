/**
 * Build the single-file Obsidian plugin (repo-root main.js) from
 * obsidian/main.template.js plus the shared dsh preset/template files.
 *
 * Run after changing any shared file:
 *   node scripts/build-obsidian.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const template = readFileSync(join(root, "obsidian", "main.template.js"), "utf8");

const preset = {
  "preset.yml": readFileSync(join(root, "dsh", "preset", "preset.yml"), "utf8"),
  "agent.cordis.yml": readFileSync(join(root, "dsh", "preset", "agent.cordis.yml"), "utf8"),
  "obsidian-memory.mjs": readFileSync(join(root, "dsh", "preset", "obsidian-memory.mjs"), "utf8"),
  "profile-package.json": readFileSync(join(root, "dsh", "profile", "package.json"), "utf8"),
  "profile-cordis.yml": readFileSync(join(root, "dsh", "profile", "cordis.yml"), "utf8"),
  "profile-cordis.patch.yml": readFileSync(join(root, "dsh", "profile", "cordis.patch.yml"), "utf8"),
  "profile-pnpm-workspace.yaml": readFileSync(join(root, "dsh", "profile", "pnpm-workspace.yaml"), "utf8")
};

const templates = {
  "AGENTS.md": readFileSync(join(root, "dsh", "templates", "AGENTS.md"), "utf8"),
  "profile.md": readFileSync(join(root, "dsh", "templates", "profile.md"), "utf8"),
  "topics-index.md": readFileSync(join(root, "dsh", "templates", "topics-index.md"), "utf8"),
  "episodes-readme.md": readFileSync(join(root, "dsh", "templates", "episodes-readme.md"), "utf8"),
  "episodes-index.md": readFileSync(join(root, "dsh", "templates", "episodes-index.md"), "utf8"),
  "inbox-readme.md": readFileSync(join(root, "dsh", "templates", "inbox-readme.md"), "utf8"),
  "inbox-index.md": readFileSync(join(root, "dsh", "templates", "inbox-index.md"), "utf8")
};

const main = template
  .replace('"__PRESET_JSON__"', JSON.stringify(JSON.stringify(preset)))
  .replace('"__TEMPLATE_JSON__"', JSON.stringify(JSON.stringify(templates)));

const target = join(root, "main.js");
writeFileSync(target, main, "utf8");
console.log(`built ${target} (${main.length} bytes)`);
