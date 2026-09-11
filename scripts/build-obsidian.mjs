/**
 * Build the single-file Obsidian plugin (repo-root main.js) from
 * obsidian/main.template.js plus the shared dsh preset/template files.
 *
 * Run after changing any shared file:
 *   node scripts/build-obsidian.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
/**
 * Read with CRLF→LF normalization: Windows checkouts (core.autocrlf) present
 * CRLF working-tree files, and embedding the raw text would bake \r\n escape
 * sequences into main.js. CI checks out LF and rebuilds, so the embedded
 * content must be line-ending-independent for the rebuild-diff gate to pass.
 */
const readNormalized = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/**
 * Embedded sources: bundle key → repo-relative path.
 *
 * Declared as DATA rather than as a list of `readNormalized` calls so the
 * completeness gate below can ask whether a file in these directories SHOULD be
 * embedded. The keys are the names the template materializes, so they are flat
 * and must stay unique per basename.
 */
const EMBEDDED_SOURCES = {
  "preset.yml": "dsh/preset/preset.yml",
  "agent.cordis.yml": "dsh/preset/agent.cordis.yml",
  "math-memory.mjs": "dsh/preset/math-memory.mjs",
  "note-tools.mjs": "dsh/preset/note-tools.mjs",
  "hook-frontmatter.mjs": "dsh/preset/hook-frontmatter.mjs",
  "profile-package.json": "dsh/profile/package.json",
  "profile-cordis.yml": "dsh/profile/cordis.yml",
  "profile-cordis.patch.yml": "dsh/profile/cordis.patch.yml",
  "profile-pnpm-workspace.yaml": "dsh/profile/pnpm-workspace.yaml",
  "profile-math-memory-workspace.mjs": "dsh/profile/math-memory-workspace.mjs",
  "profile-notes-assistant.patch.yml": "dsh/profile/notes-assistant.patch.yml",
  "host-memory-admin.mjs": "dsh/host/memory-admin.mjs",
  "host-math-memory-panel.mjs": "dsh/host/math-memory-panel.mjs"
};

/**
 * Files under the embedded directories that deliberately stay OUT of the
 * bundle, each with the reason. Anything else that appears there fails the
 * build until it is embedded or declared — adding a module that the embedded
 * code imports, and forgetting to embed it, used to produce a bundle that was
 * silently missing a file (no gate looked at the list at all).
 */
const NOT_EMBEDDED = {
  "dsh/host/index.mjs": "npm package entry (`main`); loads the host plugin from the installed package layout, never inside the Obsidian bundle",
  "dsh/host/preset-sync.mjs": "syncs the preset into ~/.dsh/.agent-presets; runs from the installer/package, not from the plugin",
  "dsh/host/hook-frontmatter.mjs": "re-export shim for the node_modules layout; the bundle already embeds the canonical parser (dsh/preset/hook-frontmatter.mjs) under the same key, so embedding this too would collide on materialization"
};

/** Extensions that belong in the bundle when they live in an embedded dir. */
const EMBEDDABLE = /\.(mjs|ya?ml|json)$/;

/**
 * Assemble the plugin bundle and return it as text.
 *
 * Exported so `scripts/check-bundle-freshness.mjs` can compare the COMMITTED
 * main.js against a fresh one. CI gets that check from
 * `git diff --exit-code main.js`, but locally nothing covered it: the existing
 * embedded-source guard only compared `memory-admin.mjs`, so a stale
 * `math-memory.mjs` / `note-tools.mjs` / template in main.js passed `npm test`
 * (docs/maintainability-review-2026-09-11.md P2-10). This function also runs the
 * completeness gates, so importing it reports a bad embed list too.
 */
export function buildMain() {
  const template = readNormalized(join(root, "obsidian", "main.template.js"));

  // Single source of truth for the vault template set: source filename → vault-
  // relative target. build / install / plugin bootstrap all derive from this.
  const templatesManifest = JSON.parse(readNormalized(join(root, "dsh", "templates-manifest.json")));

  const preset = {};
  for (const [key, rel] of Object.entries(EMBEDDED_SOURCES)) {
    preset[key] = readNormalized(join(root, rel));
  }

  // Completeness gate 1: every embeddable file in the embedded directories is
  // either embedded or explicitly excused.
  const embeddedPaths = new Set(Object.values(EMBEDDED_SOURCES));
  for (const dir of ["dsh/preset", "dsh/profile", "dsh/host"]) {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (!EMBEDDABLE.test(entry)) continue;
      if (embeddedPaths.has(rel) || rel in NOT_EMBEDDED) continue;
      throw new Error(
        `${rel} is neither embedded in main.js nor declared in NOT_EMBEDDED (scripts/build-obsidian.mjs). ` +
        `Add it to EMBEDDED_SOURCES, or record why it must stay out.`
      );
    }
  }

  // Completeness gate 2: the template materializes these keys flat, so two
  // sources sharing a basename would overwrite each other.
  const byBasename = new Map();
  for (const rel of Object.values(EMBEDDED_SOURCES)) {
    const base = rel.split("/").pop();
    if (byBasename.has(base)) {
      throw new Error(`embedded sources ${byBasename.get(base)} and ${rel} share the basename "${base}" — they would collide when materialized`);
    }
    byBasename.set(base, rel);
  }

  const templates = {};
  for (const source of Object.keys(templatesManifest)) {
    templates[source] = readNormalized(join(root, "dsh", "templates", source));
  }

  // Completeness gate 3: every .md under dsh/templates/ must be listed in the
  // manifest, otherwise a newly added template would silently never be embedded
  // or installed (the drift the CI rebuild-gate cannot catch on its own).
  for (const entry of readdirSync(join(root, "dsh", "templates"))) {
    if (entry.endsWith(".md") && !(entry in templatesManifest)) {
      throw new Error(`dsh/templates/${entry} is missing from dsh/templates-manifest.json`);
    }
  }

  return template
    // Use replacement functions, not replacement strings: the embedded files
    // contain sequences like `$&` / `` $` `` that String.replace would otherwise
    // interpret as match-substitution patterns and corrupt the bundle.
    .replace('"__PRESET_JSON__"', () => JSON.stringify(JSON.stringify(preset)))
    .replace('"__TEMPLATE_JSON__"', () => JSON.stringify(JSON.stringify(templates)))
    .replace('"__TEMPLATE_MANIFEST_JSON__"', () => JSON.stringify(JSON.stringify(templatesManifest)));
}

// CLI: `node scripts/build-obsidian.mjs`.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const main = buildMain();
  const target = join(root, "main.js");
  writeFileSync(target, main, "utf8");
  // Report BYTES, not `main.length` (UTF-16 code units): the embedded Chinese
  // text made the logged number ~10% below the real file size, and the CI gate
  // compares bytes.
  console.log(`built ${target} (${Buffer.byteLength(main, "utf8")} bytes, ${Object.keys(EMBEDDED_SOURCES).length} embedded sources)`);
}
