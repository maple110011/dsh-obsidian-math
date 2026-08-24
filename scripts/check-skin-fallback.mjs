/**
 * check-skin-fallback — the base notes-assistant profile must not hard-mount
 * any @linxin666 UI package in `cordis.patch.yml`.
 *
 * Why: those packages resolve only by mirroring from a `web` profile. The
 * optional skin center (settings.enableSkinCenter) mounts them dynamically
 * into `notes-assistant.patch.yml` only when the web profile (and the two
 * skin-center packages) actually exist; the degrade block in main.template.js
 * disables, at runtime, whatever skins the global skin manager wrote into
 * $DSH_HOME/cordis.patch.yml when the web profile is absent. A hard mount in
 * the base profile would make a web-profile-less boot die with
 * ERR_MODULE_NOT_FOUND.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cordis = readFileSync(join(root, "dsh", "profile", "cordis.patch.yml"), "utf8");

// Mounted @linxin666 ids: `- id: X` immediately followed by `name: '@linxin666/…'`.
const mountRe = /-\s*id:\s*(\S+)\s*\n\s*name:\s*['"]@linxin666\//g;
const mounts = [...cordis.matchAll(mountRe)].map((m) => m[1]);

if (mounts.length > 0) {
  console.error(`\n${mounts.length} @linxin666 mount(s) in cordis.patch.yml: ${mounts.join(', ')}`);
  console.error('The base notes-assistant profile must stay @linxin666-free — mount skins only via the optional skin center (settings.enableSkinCenter).');
  process.exit(1);
}
console.log(`skin-fallback check: ok (0 @linxin666 mounts in cordis.patch.yml — base profile is @linxin666-free)`);
