/**
 * check-skin-fallback — the base notes-assistant profile must not hard-mount
 * any @linxin666 UI package in `cordis.patch.yml`.
 *
 * Why: the base profile must boot with NO web profile present and NO @linxin666
 * package installed. Skins are opt-in and are mounted only by the plugin-owned
 * `notes-assistant.patch.yml` overlay, and only when the user has explicitly
 * installed the two packages into this profile (settings page → 安装到侧栏).
 * A hard mount here would make a web-profile-less boot die with
 * ERR_MODULE_NOT_FOUND.
 *
 * (Until 2026-09-26 the plugin made those packages resolvable by mirroring the
 * web profile's @linxin666 scope in with directory junctions; that mirror is
 * gone — the packages must now really be installed, and `main.template.js`
 * additionally disables any skin id the machine-level patch still references.)
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

// ── the plugin must never create directory links again ──────────────────────
//
// The optional skin center used to be mounted whenever the WEB profile had the
// packages, because the plugin made them resolvable HERE by mirroring the whole
// @linxin666 scope in with directory junctions. On 2026-09-26 that mirror was
// removed (its premise — a global skin insert into every profile — died with
// skin-center 0.4.x, which stopped rewriting cordis.patch.yml) and installing is
// now an explicit settings action. The invariant this file guards:
//
//   1. the mount decision is a filesystem check on THIS profile's scope, and
//   2. no link-creating call exists anywhere in the plugin source.
//
// (2) is a machine-level policy, not a style preference: this machine lost its
// entire harness home once, with a directory junction as the suspected vector, and
// a global guard now denies link creation for agent shell tools — a `symlinkSync`
// from the Obsidian renderer is invisible to that guard, so the plugin must not
// be the one component still doing it.
const templatePath = join(root, 'obsidian', 'main.template.js');
const template = readFileSync(templatePath, 'utf8');
const problems = [];

const mountStart = template.indexOf('function skinCenterMountable');
const mountEnd = template.indexOf('function skinCenterInstallable');
const mountBody = mountStart >= 0 && mountEnd > mountStart ? template.slice(mountStart, mountEnd) : '';
if (mountBody === '') {
  problems.push('skinCenterMountable / skinCenterInstallable not found in obsidian/main.template.js');
} else {
  if (!/obsidianSkinScope\(home\)/.test(mountBody)) {
    problems.push('skinCenterMountable no longer checks THIS profile\'s scope (@linxin666 must be installed here before the row is appended, or the profile cannot boot)');
  }
  if (/webSkinScope\(home\)/.test(mountBody)) {
    problems.push('skinCenterMountable went back to checking the WEB profile\'s scope — that is the mirror-era condition');
  }
}
if (!/function installSkinCenterPackages/.test(template)) {
  problems.push('installSkinCenterPackages is missing — there must be an explicit way to get the packages into this profile');
}
// Prose in this repo mentions both names (the comments above explain why they are
// gone), so match CALLS and quoted link types, not bare words.
const banned = [
  [/\bsymlinkSync\s*\(/, 'symlinkSync(...)'],
  [/['"]junction['"]/, "'junction' as a link type"]
];
for (const [re, label] of banned) {
  if (re.test(template)) {
    problems.push(`obsidian/main.template.js calls ${label} — this plugin must not create directory links (see docs/changelog.md 2026-09-26 P2-D)`);
  }
}

if (problems.length > 0) {
  console.error('\n' + problems.map((p) => ' - ' + p).join('\n'));
  console.error('\nSee docs/changelog.md 2026-09-26 (P2-D) for why the mirror was retired.');
  process.exit(1);
}

console.log('skin-fallback check: ok (0 @linxin666 mounts in cordis.patch.yml; mount decision is this-profile-scoped; no link creation in the plugin source)');
