/**
 * Build the single-file Obsidian plugin (repo-root main.js) from
 * obsidian/main.template.js plus the shared dsh preset/template files.
 *
 * Run after changing any shared file:
 *   node scripts/build-obsidian.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
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

// Single source of truth for the vault template set: source filename → vault-
// relative target. build / install / plugin bootstrap all derive from this.
const templatesManifest = JSON.parse(readNormalized(join(root, "dsh", "templates-manifest.json")));

const preset = {
  "preset.yml": readNormalized(join(root, "dsh", "preset", "preset.yml")),
  "agent.cordis.yml": readNormalized(join(root, "dsh", "preset", "agent.cordis.yml")),
  "math-memory.mjs": readNormalized(join(root, "dsh", "preset", "math-memory.mjs")),
  "note-tools.mjs": readNormalized(join(root, "dsh", "preset", "note-tools.mjs")),
  "hook-frontmatter.mjs": readNormalized(join(root, "dsh", "preset", "hook-frontmatter.mjs")),
  "profile-package.json": readNormalized(join(root, "dsh", "profile", "package.json")),
  "profile-cordis.yml": readNormalized(join(root, "dsh", "profile", "cordis.yml")),
  "profile-cordis.patch.yml": readNormalized(join(root, "dsh", "profile", "cordis.patch.yml")),
  "profile-pnpm-workspace.yaml": readNormalized(join(root, "dsh", "profile", "pnpm-workspace.yaml")),
  "profile-math-memory-workspace.mjs": readNormalized(join(root, "dsh", "profile", "math-memory-workspace.mjs")),
  "profile-notes-assistant.patch.yml": readNormalized(join(root, "dsh", "profile", "notes-assistant.patch.yml"))
};

const templates = {};
for (const source of Object.keys(templatesManifest)) {
  templates[source] = readNormalized(join(root, "dsh", "templates", source));
}

// Completeness gate: every .md under dsh/templates/ must be listed in the
// manifest, otherwise a newly added template would silently never be embedded
// or installed (the drift the CI rebuild-gate cannot catch on its own).
for (const entry of readdirSync(join(root, "dsh", "templates"))) {
  if (entry.endsWith(".md") && !(entry in templatesManifest)) {
    throw new Error(`dsh/templates/${entry} is missing from dsh/templates-manifest.json`);
  }
}

const main = template
  // Use replacement functions, not replacement strings: the embedded files
  // contain sequences like `$&` / `` $` `` that String.replace would otherwise
  // interpret as match-substitution patterns and corrupt the bundle.
  .replace('"__PRESET_JSON__"', () => JSON.stringify(JSON.stringify(preset)))
  .replace('"__TEMPLATE_JSON__"', () => JSON.stringify(JSON.stringify(templates)))
  .replace('"__TEMPLATE_MANIFEST_JSON__"', () => JSON.stringify(JSON.stringify(templatesManifest)));

const target = join(root, "main.js");
writeFileSync(target, main, "utf8");
console.log(`built ${target} (${main.length} bytes)`);
