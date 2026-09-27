/**
 * Build the single-file Obsidian plugin (repo-root main.js) from
 * obsidian/main.template.js plus the shared dsh preset/template files.
 *
 * Run after changing any shared file:
 *   node scripts/build-obsidian.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
// The ONE statement of what goes into a profile. Injected into the template below so the Obsidian
// bootstrap stops hand-writing its own copy (2026-09-26, A′/B2).
import { PRESET_BODY_FILES, PROFILE_SCAFFOLD_FILES, OVERLAY_ROWS, PANEL_ROUTES } from "../dsh/preset/profile-contract.mjs";
// The ONE statement of what a materialized local bundle contains. The payload below is derived from it
// so the plugin cannot materialize a package that differs from the one the CLI builds (A′ S4 Obsidian
// half, 2026-09-26).
import { localBundleSourceFiles } from "../dsh/profile/local-bundle.mjs";
import { collectDshImportClosure } from "../dsh/client-panel/install-into-profile.mjs";
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
  "engine-shared.mjs": "dsh/preset/engine-shared.mjs",
  "preset-deploy.mjs": "dsh/preset/preset-deploy.mjs",
  // The profile contract (2026-09-26, B2). Embedded because the modules that consume it are embedded
  // too: it is materialized flat beside them as `./profile-contract.mjs` and imported by that name.
  "profile-contract.mjs": "dsh/preset/profile-contract.mjs",
  "profile-package.json": "dsh/profile/package.json",
  "profile-cordis.yml": "dsh/profile/cordis.yml",
  "profile-cordis.patch.yml": "dsh/profile/cordis.patch.yml",
  "profile-pnpm-workspace.yaml": "dsh/profile/pnpm-workspace.yaml",
  "profile-math-memory-workspace.mjs": "dsh/profile/math-memory-workspace.mjs",
  // A′ (offline channel package-ization, docs/bundle-channel-plan-2026-09-26.md S1). The Obsidian
  // bootstrap cannot import from `dsh/`, so the module that materializes the local bundle is embedded
  // and loaded the same way the other injected modules are. It has no caller yet — that is why the
  // syntax gate below exists (trap 95: a zero-caller export rots silently).
  "profile-local-bundle.mjs": "dsh/profile/local-bundle.mjs",
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
  "dsh/host/channel-owner.mjs": "channel-ownership anchor (profile manifest + legacy fallback); runs from the installer/host package, not from the plugin — the Obsidian bootstrap has its own inline copy of the same precedence",
  "dsh/host/hook-frontmatter.mjs": "re-export shim for the node_modules layout; the bundle already embeds the canonical parser (dsh/preset/hook-frontmatter.mjs) under the same key, so embedding this too would collide on materialization",
  "dsh/host/engine-shared.mjs": "re-export shim for the node_modules layout (same trick as hook-frontmatter): the offline layout stages the canonical dsh/preset/engine-shared.mjs as a flat sibling, and embedding the shim too would collide with it on materialization"
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

  // ── The local-bundle PAYLOAD (A′ S4, Obsidian half) ────────────────────────────────────────────
  //
  // The Obsidian bootstrap must be able to materialize a REAL package (so the offline channel also
  // shows up in dsh's plugin manager). It cannot walk `dsh/` at runtime — the plugin ships as this one
  // file — so the bytes are injected here.
  //
  // ⚠️ ONLY THE FILES THAT ARE ABSENT FROM `preset` GO IN HERE. Every other payload file is one an
  // existing key already holds under its own basename, and the template resolves those through a
  // basename→package-path map instead. Embedding them twice would add ~440 KB of duplicated source to
  // a single-file plugin for nothing (measured: 780 KB → 1.28 MB before this split; 806 KB after).
  //
  // The two shims are the only entries not read from disk: each is a one-line re-export, and generating
  // them keeps the payload in step with whatever the canonical file exports.
  const SHIM_SOURCES = {
    "dsh/host/hook-frontmatter.mjs":
      '// Generated by scripts/build-obsidian.mjs for the materialized local bundle.\n' +
      '// Same role as the file the published package ships: let `dsh/host/*` resolve the shared\n' +
      '// helper as a flat sibling. The canonical file lives in `dsh/preset/`.\n' +
      'export { parseHookFrontmatter, stripQuotes } from "../preset/hook-frontmatter.mjs";\n',
    "dsh/host/engine-shared.mjs":
      '// Generated by scripts/build-obsidian.mjs for the materialized local bundle.\n' +
      '// Same role as the file the published package ships: let `dsh/host/*` resolve the shared\n' +
      '// helpers as a flat sibling. The canonical file lives in `dsh/preset/`.\n' +
      'export { contentText, joinFrontmatterLines, setTopField } from "../preset/engine-shared.mjs";\n'
  };
  // Existing keys, indexed by the basename of the SOURCE FILE each key holds. A key like
  // `host-memory-admin.mjs` holds `dsh/host/memory-admin.mjs`, so indexing by the KEY's own name would
  // never match the payload's `memory-admin.mjs` — that mistake put ~100 KB of already-embedded source
  // into the payload a second time (measured: 780 KB → 917 KB; correct value below).
  const keyByBasename = {};
  for (const [key, rel] of Object.entries(EMBEDDED_SOURCES)) keyByBasename[rel.split("/").pop()] = key;

  const payload = {};
  const fromPreset = {};
  for (const rel of localBundleSourceFiles({
    repoRoot: root,
    collectClosure: collectDshImportClosure,
    presetBodyFiles: PRESET_BODY_FILES
  })) {
    // The shims come FIRST: those two destinations are precisely the ones a basename lookup would get
    // wrong (they share a basename with the canonical `dsh/preset/` file).
    if (SHIM_SOURCES[rel] !== undefined) { payload[rel] = SHIM_SOURCES[rel]; continue; }
    const key = keyByBasename[rel.split("/").pop()];
    // Reuse an existing key only when it holds THIS file. Comparing the bytes is what makes that safe
    // for the two colliding basenames, both of which are shims and were already handled above.
    if (key !== undefined && preset[key] === readNormalized(join(root, rel))) {
      fromPreset[rel] = key;
      continue;
    }
    payload[rel] = readNormalized(join(root, rel));
  }
  // Completeness gate 4: the payload (plus the basename map it delegates to) must satisfy its own
  // import graph. Without this the plugin would materialize a package missing a module and only fail
  // at dsh boot, far from here — and the walker below refuses to leave `dsh/`, exactly like the
  // shipped `collectDshImportClosure`.
  {
    const specifier = /\bfrom\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]/g;
    const read = (rel) => (rel in payload ? payload[rel] : preset[fromPreset[rel]]);
    const missing = [];
    for (const rel of Object.keys({ ...payload, ...fromPreset })) {
      const text = read(rel);
      if (typeof text !== "string") { missing.push(`${rel} (no source)`); continue; }
      for (const m of text.matchAll(specifier)) {
        const spec = m[1] ?? m[2];
        const target = join(rel, "..", spec).replace(/\\/g, "/").replace(/^\.\//, "");
        if (!(target in payload) && !(target in fromPreset)) missing.push(`${rel} -> ${spec}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `local bundle payload is incomplete (its own imports cannot be resolved): ${missing.join(", ")}. ` +
        `Add the file to EMBEDDED_SOURCES, or generate it in SHIM_SOURCES.`
      );
    }
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
    // The local-bundle materialization plan, in TWO parts (see the block above):
    //   `payload`    — package-relative path → bytes, for the files no existing key holds;
    //   `fromPreset` — package-relative path → existing basename key, for the rest.
    // Together they are the package, and together they are derived from `localBundleSourceFiles()`.
    .replace('"__BUNDLE_PAYLOAD_JSON__"', () => JSON.stringify(JSON.stringify({ payload, fromPreset })))
    .replace('"__TEMPLATE_JSON__"', () => JSON.stringify(JSON.stringify(templates)))
    .replace('"__TEMPLATE_MANIFEST_JSON__"', () => JSON.stringify(JSON.stringify(templatesManifest)))
    // The profile contract (2026-09-26, A′/B2): the Obsidian bootstrap must not hand-write the
    // staging list any more. A hand-written copy is exactly how the 2026-09-26 `--direct` break
    // happened, and the embedded loader cannot import the contract itself (the bootstrap has to know
    // the file list BEFORE it stages anything), so the contract is injected here at build time.
    .replace('"__PROFILE_CONTRACT_JSON__"', () => JSON.stringify(JSON.stringify({
      presetBodyFiles: PRESET_BODY_FILES,
      profileScaffoldFiles: PROFILE_SCAFFOLD_FILES,
      overlayRows: OVERLAY_ROWS,
      panelRoutes: PANEL_ROUTES
    })));
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
