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

const deploy = readFileSync(join(root, "scripts", "deploy-local.mjs"), "utf8");
const template = readFileSync(join(root, "obsidian", "main.template.js"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");

let failed = 0;
const check = (label, ok) => { if (!ok) { console.log(`[STALE] ${label}`); failed += 1; } };

check(`deploy-local.mjs pluginDir uses id '${id}'`, deploy.includes(`'plugins', '${id}'`));
check(`main.template.js debug.log path uses id '${id}'`, template.includes(`'plugins', '${id}'`));
check(`README plugin dir uses id '${id}'`, readme.includes(`plugins/${id}/`));

if (failed > 0) {
  console.log("\nObsidian loads plugins by directory name — the manifest `id` MUST equal the installed plugin directory everywhere. Renaming the id is a breaking change.");
  process.exit(1);
}
console.log(`plugin-id check: ok (id '${id}' matches the installed directory everywhere)`);
