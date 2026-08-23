/**
 * check-skin-fallback — verify every `@linxin666` UI package mounted by
 * cordis.patch.yml's `insert:` is also disabled by the SKIN_FALLBACK degrade
 * block in main.template.js.
 *
 * Why: those packages resolve only by mirroring from a `web` profile. When the
 * profile has no `web` (degrade mode), any mount left enabled is imported and
 * dies with ERR_MODULE_NOT_FOUND. This guard makes the degrade block keep in
 * sync with the mount list automatically.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cordis = readFileSync(join(root, "dsh", "profile", "cordis.patch.yml"), "utf8");
const template = readFileSync(join(root, "obsidian", "main.template.js"), "utf8");

// Mounted @linxin666 ids: `- id: X` immediately followed by `name: '@linxin666/…'`.
const mountIds = [];
const mountRe = /-\s*id:\s*(\S+)\s*\n\s*name:\s*['"]@linxin666\//g;
for (const m of cordis.matchAll(mountRe)) mountIds.push(m[1]);

// Disabled ids in the degrade block: `'- id: X',` immediately followed by `'  disabled: true',`.
const disabledIds = new Set();
const disableRe = /-\s*id:\s*([^']+?)\s*',\s*\n\s*'\s*disabled:\s*true\s*',/g;
for (const m of template.matchAll(disableRe)) disabledIds.add(m[1].trim());

let failed = 0;
for (const id of mountIds) {
  if (!disabledIds.has(id)) {
    console.log(`[STALE] skin-fallback: @linxin666 mount '${id}' is not disabled in the degrade block`);
    failed += 1;
  }
}
if (failed > 0) {
  console.log(`\n${failed} @linxin666 mount(s) missing from the SKIN_FALLBACK degrade block — add '- id: <id>' + '  disabled: true' so a web-profile-less boot survives.`);
  process.exit(1);
}
console.log(`skin-fallback check: ok (${mountIds.length} @linxin666 mount(s) all disabled in the degrade block)`);
