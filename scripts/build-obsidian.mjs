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
/**
 * Read with CRLF→LF normalization: Windows checkouts (core.autocrlf) present
 * CRLF working-tree files, and embedding the raw text would bake \r\n escape
 * sequences into main.js. CI checks out LF and rebuilds, so the embedded
 * content must be line-ending-independent for the rebuild-diff gate to pass.
 */
const readNormalized = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const template = readNormalized(join(root, "obsidian", "main.template.js"));

const preset = {
  "preset.yml": readNormalized(join(root, "dsh", "preset", "preset.yml")),
  "agent.cordis.yml": readNormalized(join(root, "dsh", "preset", "agent.cordis.yml")),
  "obsidian-memory.mjs": readNormalized(join(root, "dsh", "preset", "obsidian-memory.mjs")),
  "obsidian-notes.mjs": readNormalized(join(root, "dsh", "preset", "obsidian-notes.mjs")),
  "profile-package.json": readNormalized(join(root, "dsh", "profile", "package.json")),
  "profile-cordis.yml": readNormalized(join(root, "dsh", "profile", "cordis.yml")),
  "profile-cordis.patch.yml": readNormalized(join(root, "dsh", "profile", "cordis.patch.yml")),
  "profile-pnpm-workspace.yaml": readNormalized(join(root, "dsh", "profile", "pnpm-workspace.yaml")),
  "profile-obsidian-workspace.mjs": readNormalized(join(root, "dsh", "profile", "obsidian-workspace.mjs")),
  "profile-obsidian.patch.yml": readNormalized(join(root, "dsh", "profile", "obsidian.patch.yml"))
};

const templates = {
  "AGENTS.md": readNormalized(join(root, "dsh", "templates", "AGENTS.md")),
  "profile.md": readNormalized(join(root, "dsh", "templates", "profile.md")),
  "topics-index.md": readNormalized(join(root, "dsh", "templates", "topics-index.md")),
  "records-readme.md": readNormalized(join(root, "dsh", "templates", "records-readme.md")),
  "records-index.md": readNormalized(join(root, "dsh", "templates", "records-index.md")),
  "theorems-readme.md": readNormalized(join(root, "dsh", "templates", "theorems-readme.md")),
  "theorems-index.md": readNormalized(join(root, "dsh", "templates", "theorems-index.md")),
  "templates-readme.md": readNormalized(join(root, "dsh", "templates", "templates-readme.md")),
  "templates-index.md": readNormalized(join(root, "dsh", "templates", "templates-index.md")),
  "episodes-readme.md": readNormalized(join(root, "dsh", "templates", "episodes-readme.md")),
  "episodes-index.md": readNormalized(join(root, "dsh", "templates", "episodes-index.md")),
  "inbox-readme.md": readNormalized(join(root, "dsh", "templates", "inbox-readme.md")),
  "inbox-index.md": readNormalized(join(root, "dsh", "templates", "inbox-index.md")),
  "capture-policy.md": readNormalized(join(root, "dsh", "templates", "capture-policy.md")),
  "notation.md": readNormalized(join(root, "dsh", "templates", "notation.md"))
};

const main = template
  // Use replacement functions, not replacement strings: the embedded files
  // contain sequences like `$&` / `` $` `` that String.replace would otherwise
  // interpret as match-substitution patterns and corrupt the bundle.
  .replace('"__PRESET_JSON__"', () => JSON.stringify(JSON.stringify(preset)))
  .replace('"__TEMPLATE_JSON__"', () => JSON.stringify(JSON.stringify(templates)));

const target = join(root, "main.js");
writeFileSync(target, main, "utf8");
console.log(`built ${target} (${main.length} bytes)`);
