/**
 * check-plugin-id — the Obsidian plugin id (manifest.json `id`) must equal the
 * installed plugin DIRECTORY name used everywhere (deploy-local.mjs pluginDir,
 * main.template.js debug.log path). Obsidian loads plugins by directory name,
 * so a mismatched id silently unloads the plugin (it "disappears").
 *
 * The id is a STABLE identifier — renaming it is a breaking change for every
 * existing install. This guard keeps the id and the directory references from
 * drifting apart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const id = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).id;
if (typeof id !== "string" || id === "") {
  console.error("manifest.json `id` is missing or empty");
  process.exit(1);
}

// deploy-local.mjs is a machine-specific helper (gitignored); it is absent in
// CI / fresh clones, so its drift check is best-effort and skipped when missing.
let deploy = "";
try {
  deploy = readFileSync(join(root, "scripts", "deploy-local.mjs"), "utf8");
} catch {
  // not present in this checkout — skip the deploy-local drift check below
}
const template = readFileSync(join(root, "obsidian", "main.template.js"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");

let failed = 0;
const check = (label, ok) => { if (!ok) { console.log(`[STALE] ${label}`); failed += 1; } };

if (deploy !== "") {
  check(`deploy-local.mjs pluginDir uses id '${id}'`, deploy.includes(`'plugins', '${id}'`));
} else {
  console.log('plugin-id check: (skipping deploy-local.mjs drift check — file absent in this checkout)');
}
check(`main.template.js debug.log path uses id '${id}'`, template.includes(`'plugins', '${id}'`));
check(`README plugin dir uses id '${id}'`, readme.includes(`plugins/${id}/`));

if (failed > 0) {
  console.log("\nObsidian loads plugins by directory name — the manifest `id` MUST equal the installed plugin directory everywhere. Renaming the id is a breaking change.");
  process.exit(1);
}
console.log(`plugin-id check: ok (id '${id}' matches the installed directory everywhere)`);
