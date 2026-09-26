#!/usr/bin/env node
/**
 * dsh-math-memory — install / status / uninstall for the Obsidian math-memory
 * plugin's dsh side.
 *
 * Commands:
 *   install [--direct] [--vault <dir>] [--dsh-home <dir>] [--profile <name>] [--force] [--quiet] [--dry-run]
 *     native (default): writes the profile scaffold (in-box bundles dsh-base +
 *                       dsh-web-app) then `dsh plugin add dsh-math-memory`
 *                       (the bundle deploys the preset body at dsh boot), then
 *                       writes the profile posture + owner markers + vault
 *                       templates.
 *     --direct:         legacy flat copy of the preset/profile/host files
 *                       (offline / no pnpm / no registry), plus the same markers.
 *   status [--dsh-home <dir>] [--profile <name>]
 *   uninstall [--vault <dir>] [--purge] [--purge-data --confirm <phrase>] [--yes] [--dsh-home <dir>] [--profile <name>]
 *
 * WHERE THE PRESET LIVES (dsh >= 0.1.7). The preset is a DECLARED row (see
 * dsh/cordis.patch.yml), and the modules its relative row names point at must sit
 * in the PROFILE DIRECTORY. This installer therefore deploys the body through
 * `dsh/preset/preset-deploy.mjs` — the same call and the same file list the npm
 * host plugin uses — instead of keeping a third copy of that list. Missing those
 * files is silent: dsh prints nothing at boot and `session/create` answers
 * `agent-preset/invalid` ("math-memory (./math-memory.mjs): never started").
 *
 * Owner markers make install/uninstall symmetric and conflict-safe:
 *   <home>/profiles/<name>/.install-manifest.json        (THE CHANNEL ANCHOR —
 *                                                        `readChannelOwner` reads
 *                                                        this first — plus the
 *                                                        posture + body file list)
 *   <home>/.agent-presets/notes-assistant/.owner.json    (RETIRED 2026-09-26: no
 *                                                        longer written; still
 *                                                        READ as a fallback for
 *                                                        installs made before that,
 *                                                        and cleaned up by
 *                                                        `uninstall`. The directory
 *                                                        is not a preset lookup path
 *                                                        on 0.1.7+ — relying on it
 *                                                        alone meant deleting that
 *                                                        dead directory silently
 *                                                        disabled the guard)
 * A native (bundle) install owns the profile as "npm"; a --direct install owns it
 * as "direct". Install refuses to overwrite a profile owned by the other channel
 * unless --force.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { installClientIntoProfile } from "./client-panel/install-into-profile.mjs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  PRESET_BODY_FILES,
  deployPresetBody,
  presetReaderFromDir
} from "./preset/preset-deploy.mjs";
// 2026-09-26 (B2): the profile contract is the ONE statement of what gets staged. `preset-deploy.mjs`
// re-exports its `PRESET_BODY_FILES`; the scaffold half is read straight from here.
import { PROFILE_SCAFFOLD_FILES } from "./preset/profile-contract.mjs";
// The marker FILENAMES come from the module that owns their semantics — a second
// literal here is how the two anchors could drift apart silently.
import {
  CHANNEL_MANIFEST,
  LEGACY_PRESET_DIR,
  OWNER_MARKER,
  readChannelOwner
} from "./host/channel-owner.mjs";
// The generated declaration's BEGIN/END markers come from the generator that emits them. A second
// literal here is not a harmless duplication: this file carried a TRUNCATED copy of the END marker
// (`…declaration` without the trailing ` <<<`), so `stripPresetDeclaration` sliced the block one
// ` <<<` short and wrote the remainder back as a bare root-level YAML token. Measured 2026-09-26:
// a second `install --direct` turned the END marker into `…declaration` plus an orphaned `<<<` line,
// and `scripts/test-installer.mjs`'s byte-identity assertion failed on `cordis.patch.yml`. Import
// them, never re-type them.
import { DECLARATION_BEGIN, DECLARATION_END } from "../scripts/lib/preset-declaration.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PRESET_DIR = join(PACKAGE_ROOT, "dsh", "preset");
const PROFILE_DIR = join(PACKAGE_ROOT, "dsh", "profile");
const HOST_DIR = join(PACKAGE_ROOT, "dsh", "host");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "dsh", "templates");
const MANIFEST_FILE = join(PACKAGE_ROOT, "dsh", "templates-manifest.json");

const PROFILE_NAME = "notes-assistant";
const PRESET_ID = "notes-assistant";
const PURGE_DATA_CONFIRM = "DELETE MY MATH MEMORY";
// Only dsh-math-memory is an out-of-tree bundle (pnpm-installed). The in-box
// bundles (@deepseek-ai/dsh-base + dsh-web-app) ship WITH the dsh installation
// and are listed in the profile scaffold's package.json — they must NOT be
// pnpm-added (no registry copy to fetch; a mirror 404s on their deps).
const NATIVE_BUNDLES = ["dsh-math-memory"];
// Files the --direct (legacy flat) install writes into the profile dir; the
// install manifest records them so uninstall can remove them symmetrically.
// 2026-09-26 (B2): the scaffold half of this list now comes from the profile contract, so this file is
// no longer a fourth hand-written copy of "what a profile needs". The preset body half already came
// from `preset-deploy.mjs`, which re-exports that same contract.
const DIRECT_PROFILE_BASE = [...PROFILE_SCAFFOLD_FILES];
// dsh >= 0.1.7: the agent preset's own modules must live IN THE PROFILE
// DIRECTORY (the registry resolves a relative row `name:` against it). They come
// from preset-deploy.mjs's ONE list rather than a fourth hand-written copy —
// this list used to be missing them, which is why `install --direct` produced a
// profile where every session failed with `agent-preset/invalid`.
const DIRECT_PROFILE_FILES = [
  ...DIRECT_PROFILE_BASE,
  ...PRESET_BODY_FILES.filter((name) => !DIRECT_PROFILE_BASE.includes(name))
];
/** Exported for `scripts/check-preset-body-lists.mjs` (import the real array). */
export { DIRECT_PROFILE_FILES };

function parseArgs(argv) {
  const options = {
    command: "install",
    direct: false,
    vault: "",
    dshHome: "",
    profile: PROFILE_NAME,
    force: false,
    quiet: false,
    dryRun: false,
    yes: false,
    purge: false,
    purgeData: false,
    confirm: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "install" || arg === "status" || arg === "uninstall") options.command = arg;
    else if (arg === "--direct") options.direct = true;
    else if (arg === "--vault" || arg === "-v") options.vault = argv[++index] ?? "";
    else if (arg === "--dsh-home") options.dshHome = argv[++index] ?? "";
    else if (arg === "--profile") options.profile = argv[++index] ?? PROFILE_NAME;
    else if (arg === "--force" || arg === "-f") options.force = true;
    else if (arg === "--quiet" || arg === "-q") options.quiet = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--purge") options.purge = true;
    else if (arg === "--purge-data") options.purgeData = true;
    else if (arg === "--confirm") options.confirm = argv[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log(`dsh-math-memory — DeepSeek Harness plugin installer

Usage:
  dsh-math-memory install [--direct] [--vault <dir>] [--dsh-home <dir>] [--profile <name>] [--force]
  dsh-math-memory status [--dsh-home <dir>] [--profile <name>]
  dsh-math-memory uninstall [--vault <dir>] [--purge] [--purge-data --confirm <phrase>] [--yes]

Modes:
  install             native: writes profile scaffold (in-box dsh-web-app) + dsh plugin add dsh-math-memory
  install --direct    offline flat copy of the shipped preset/profile files (no pnpm)

Options:
  --vault <dir>       also seed the vault memory templates (.deepseek/..., AGENTS.md)
  --dsh-home <dir>    harness home (default: $DSH_HOME or ~/.dsh)
  --profile <name>    profile name (default: notes-assistant)
  --force             take over an other-channel-owned preset/profile
  --dry-run           print planned writes without touching the filesystem
  --purge             uninstall: also remove scaffold templates (vault)
  --purge-data        uninstall: also remove memory CONTENT (requires --confirm)
  --confirm <phrase>  exact phrase for --purge-data ("${PURGE_DATA_CONFIRM}")
  --yes               uninstall: execute (default is a dry-run)`);
      process.exit(0);
    }
  }
  return options;
}

const log = (options, message) => {
  if (!options.quiet) console.log(message);
};

function write(options, target, content, overwrite = true) {
  if (options.dryRun) {
    log(options, `[dry-run] would write ${target}`);
    return false;
  }
  if (!overwrite && existsSync(target)) {
    log(options, `[skip] exists, preserving user edits: ${target}`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  log(options, `[write] ${target}`);
  return true;
}

function copyFile(options, source, target, overwrite = true) {
  if (options.dryRun) {
    log(options, `[dry-run] would copy ${source} -> ${target}`);
    return false;
  }
  if (!overwrite && existsSync(target)) {
    log(options, `[skip] exists, preserving user edits: ${target}`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  log(options, `[write] ${target}`);
  return true;
}

function remove(options, target, recursive = false) {
  if (options.dryRun) {
    log(options, `[dry-run] would remove ${target}`);
    return;
  }
  if (existsSync(target)) {
    rmSync(target, { recursive, force: true });
    log(options, `[remove] ${target}`);
  }
}

function resolveDshHome(options) {
  const raw = options.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh");
  return resolve(raw);
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readMarker(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * `[present]` when every preset body file sits in the profile directory, else a
 * `[missing n/N: …]` line naming which ones. `status` must ask THIS, not the
 * retired `.agent-presets/` directory (see the module docblock).
 */
function describePresetBody(profileRoot) {
  const missing = PRESET_BODY_FILES.filter((name) => !existsSync(join(profileRoot, name)));
  if (missing.length === 0) return "[present]";
  return `[missing ${missing.length}/${PRESET_BODY_FILES.length}: ${missing.join(", ")}]`;
}

/**
 * Make the profile's OWN patch layer carry the CURRENT generated preset declaration.
 *
 * WHY (2026-09-26, B3): the declaration used to live in the overlay the plugin rewrites at every
 * service start, so a plugin older than the profile erased it and every reply failed. It lives in
 * `<profile>/cordis.patch.yml` now — a USER-EDITABLE posture file the installers deliberately do not
 * clobber — so an existing profile would otherwise be left with no declaration at all (the new overlay
 * carries none either). Two repairs, both surgical:
 *   · declaration missing ⇒ append the generated block;
 *   · declaration STALE ⇒ replace only the marker-delimited block, so anything the user added around
 *     it survives.
 *
 * That second case was found while preparing the 2026-09-26 release: `preset.yml`'s description is
 * part of the block, so an append-only repair meant an upgraded install kept the OLD description
 * forever (and `test: agent preset mounts` says so at deploy time).
 *
 * @returns true when the file changed.
 */
export function ensurePresetDeclaration(profileRoot) {
  const target = join(profileRoot, "cordis.patch.yml");
  const scaffold = join(PROFILE_DIR, "cordis.patch.yml");
  if (!existsSync(target) || !existsSync(scaffold)) return false;
  const source = readFileSync(scaffold, "utf8");
  const begin = DECLARATION_BEGIN;
  const end = DECLARATION_END;
  const start = source.indexOf(begin);
  const stop = source.indexOf(end);
  if (start < 0 || stop <= start) return false;
  const block = source.slice(start, stop + end.length);
  const current = readFileSync(target, "utf8");
  const from = current.indexOf(begin);
  const to = current.indexOf(end);
  if (from >= 0 && to > from) {
    if (current.slice(from, to + end.length).trim() === block.trim()) return false;
    writeFileSync(target, current.slice(0, from) + block + current.slice(to + end.length), "utf8");
    return true;
  }
  // No block at all. If the id is declared some other way by hand, leave that alone — the user may have
  // arranged it deliberately, and guessing would be worse than the gate reporting a stale declaration.
  if (/- id:\s*["']?preset-notes-assistant["']?\s*$/m.test(current)) return false;
  writeFileSync(target, current.replace(/\s*$/, "\n") + "\n" + block + "\n", "utf8");
  return true;
}

const DECL_BEGIN = DECLARATION_BEGIN;
const DECL_END = DECLARATION_END;

/** One place for the block's bounds, so the two channel repairs cannot drift apart. */
function declarationBounds(source) {
  const from = source.indexOf(DECL_BEGIN);
  const to = source.indexOf(DECL_END);
  return from >= 0 && to > from ? { from, to: to + DECL_END.length } : null;
}

/**
 * Repair for the BUNDLE channel (2026-09-26): a profile whose bundle layer already declares
 * `preset-notes-assistant` must NOT also carry the flat declaration in its own patch layer — two rows
 * with one id break the composition. Measured on the native path:
 *
 *   broken: "math-memory (./math-memory.mjs): never started"
 *
 * The native installer copies `dsh/profile/cordis.patch.yml` as the profile's posture, and B3 moved the
 * declaration INTO that file, so the duplicate appeared exactly there. This removes the generated block
 * (and nothing else, so a user's own rows survive) and repairs profiles an earlier build wrote that way.
 *
 * @returns true when the file changed.
 */
export function stripPresetDeclaration(profileRoot) {
  const target = join(profileRoot, "cordis.patch.yml");
  if (!existsSync(target)) return false;
  const current = readFileSync(target, "utf8");
  const bounds = declarationBounds(current);
  if (bounds === null) return false;
  const stripped = (current.slice(0, bounds.from) + current.slice(bounds.to)).replace(/\n{3,}/g, "\n\n");
  writeFileSync(target, stripped, "utf8");
  return true;
}

/**
 * Ensure a profile manifest declares non-empty `name` AND `version`.
 *
 * WHY (2026-09-26, real-machine failure). dsh's default-on request extension
 * `@deepseek-ai/dsh-plugin-package-inventory-deepseek` resolves the owning manifest of
 * every ACTIVE loader row. For a RELATIVE row (`./math-memory.mjs` — what the offline
 * channel uses) `nearestManifest()` walks up and finds the PROFILE's own
 * `package.json`, then dsh's `identityFromManifest(path, allowAnonymous = true)` runs:
 *
 *   if (allowAnonymous && manifest.name === undefined) return undefined;      // loose module: fine
 *   if (!name || !version) throw new Error('… must declare non-empty name and version');
 *
 * So a manifest with a `name` but NO `version` THROWS — and because that extension runs
 * during request PREPARATION, EVERY reply in such a profile failed with
 * "DeepSeek request extension preparation failed" (the request was never sent). The
 * `web` profile never hit it because all of its rows are bare package names, so the
 * `nearestManifest` walk never happens.
 *
 * A private profile manifest needs no meaningful version; `0.0.0` satisfies the rule.
 *
 * @returns true when the file was repaired.
 */
export function repairProfileManifest(profileRoot, options = undefined) {
  const manifestPath = join(profileRoot, "package.json");
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return false; // no manifest yet: the scaffold copy that follows provides one
  }
  if (parsed === null || typeof parsed !== "object") return false;
  const missingName = typeof parsed.name !== "string" || parsed.name.length === 0;
  const missingVersion = typeof parsed.version !== "string" || parsed.version.length === 0;
  if (!missingVersion && !missingName) return false;
  // `--dry-run` promises "print planned writes without touching the filesystem" (see --help). This
  // function used to write unconditionally, so `install --dry-run` silently rewrote an EXISTING
  // profile's package.json — the one file a user may have edited by hand. Every other writer in this
  // file honours the flag; this one did not (found 2026-09-26).
  if (options !== undefined && options.dryRun) return false;
  const next = { ...parsed };
  if (missingVersion) next.version = "0.0.0";
  if (missingName) next.name = `dsh-profile-${basename(profileRoot) || "profile"}`;
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return true;
}

/**
 * Conflict string when the OTHER channel owns this profile, else null. The anchor
 * is the profile's `CHANNEL_MANIFEST` with the legacy `.agent-presets` marker as
 * a fallback — see `readChannelOwner` in ./host/channel-owner.mjs for why that
 * order is load-bearing (a `--direct` install made before 2026-09-26 has only
 * the legacy marker, and treating it as unowned lets the other channel take over
 * silently).
 */
function assertChannelOwnership(options, { profileDir, home, presetId }, channel) {
  const owner = readChannelOwner({ profileDir, home, presetId });
  if (owner === null) return null;
  if (owner.owner === channel || options.force) return null;
  return `owned by "${owner.owner}" (${owner.source}, v${owner.version ?? "?"}) — pass --force to take over as "${channel}"`;
}

export function writeManifest(options, profileRoot, channel, postureFiles, vaults) {
  const manifestPath = join(profileRoot, CHANNEL_MANIFEST);
  const payload = {
    owner: channel,
    version: packageVersion(),
    installedAt: new Date().toISOString(),
    profile: options.profile,
    posture: postureFiles,
    // The integrity baseline for the "third copy" (docs/decoupling-assessment-2026-09-26.md §2.3):
    // the flat profile files are written by an installer that ran some time ago, and until now
    // NOTHING could tell whether what is on disk is still what was written. A live profile
    // legitimately LAGS the repo between deployments (that is reported as a notice, not a
    // failure), but it must never silently DIVERGE from its own record.
    postureDigests: postureDigests(profileRoot, postureFiles),
    vaults
  };
  write(options, manifestPath, JSON.stringify(payload, null, 2) + "\n");
}

/** sha256 of one file, or undefined when it is not readable. */
function fileDigest(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Record one sha256 per posture file that exists — the manifest's integrity baseline.
 *
 * @param profileRoot - profile directory holding the flat files.
 * @param files - posture file names (relative to `profileRoot`).
 * @returns `{ [name]: sha256 }` for the files that are present.
 */
export function postureDigests(profileRoot, files) {
  const out = {};
  for (const name of files) {
    const digest = fileDigest(join(profileRoot, name));
    if (digest !== undefined) out[name] = digest;
  }
  return out;
}

/**
 * Compare a manifest's recorded digests with what is on disk right now.
 *
 * This is the part that can be a HARD check: a profile whose files no longer match the
 * manifest that claims to have written them has been hand-edited, half-written, or
 * clobbered by a stale plugin. (Whether the profile still matches the REPO is a different
 * question — lag is normal until the next install — so gates report that as a notice.)
 *
 * @param profileRoot - profile directory.
 * @param manifest - parsed `.install-manifest.json` (may be an old one without digests).
 * @returns `{ checked, drifted, missing, unrecorded }`.
 */
export function verifyPostureDigests(profileRoot, manifest) {
  const recorded = manifest?.postureDigests;
  if (recorded === null || typeof recorded !== "object") {
    return { checked: 0, drifted: [], missing: [], unrecorded: true };
  }
  const drifted = [];
  const missing = [];
  const names = Object.keys(recorded);
  for (const name of names) {
    const now = fileDigest(join(profileRoot, name));
    if (now === undefined) missing.push(name);
    else if (now !== recorded[name]) drifted.push(name);
  }
  return { checked: names.length, drifted, missing, unrecorded: false };
}

// ── native install ───────────────────────────────────────────────────────────

function nativeInstall(options, dshHome) {
  // Write the profile scaffold first: package.json lists the IN-BOX bundles
  // (dsh-base + dsh-web-app), which resolve from the dsh installation — never
  // from pnpm. cordis.yml is the empty root; pnpm-workspace.yaml pins the
  // hoisted linker so `dsh plugin add` (pnpm) can run in the profile dir.
  const profileRoot = join(dshHome, "profiles", options.profile);
  const firstRun = !existsSync(join(profileRoot, "package.json"));
  copyFile(options, join(PROFILE_DIR, "package.json"), join(profileRoot, "package.json"), firstRun || options.force);
  // A profile manifest that names itself but declares no `version` makes dsh's
  // default-on plugin-inventory request extension throw during EVERY request
  // preparation (see repairProfileManifest) — repair both fresh and existing ones.
  if (repairProfileManifest(profileRoot, options)) log(options, `[manifest] 补上缺失的 name/version：${join(profileRoot, "package.json")}`);
  else if (options.dryRun) log(options, `[dry-run] 会补上缺失的 name/version：${join(profileRoot, "package.json")}`);
  copyFile(options, join(PROFILE_DIR, "cordis.yml"), join(profileRoot, "cordis.yml"), true);
  copyFile(options, join(PROFILE_DIR, "pnpm-workspace.yaml"), join(profileRoot, "pnpm-workspace.yaml"), firstRun);

  const args = ["plugin", "--profile", options.profile, "add", ...NATIVE_BUNDLES];
  log(options, `[run] dsh ${args.join(" ")}`);
  if (options.dryRun) return true;
  const result = spawnSync("dsh", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DSH_HOME: dshHome }
  });
  if (result.error) {
    const hint = result.error.code === "ENOENT"
      ? "dsh not found on PATH — install DeepSeek Harness first."
      : String(result.error);
    log(options, `[error] native install failed: ${hint}`);
    return false;
  }
  if (result.status !== 0) {
    log(options, `[error] dsh plugin add exited ${result.status}. Use --direct for an offline flat copy.`);
    return false;
  }

  // Anchor ownership IN THE PROFILE BEFORE anything reads it (every channel writes this file;
  // `dsh/host/index.mjs` reads it to decide whether to activate the host half, and
  // `installClientIntoProfile` below REQUIRES the profile's own `cordis.patch.yml` to exist).
  // Without it the read side fell back to the home-level retired marker — which is keyed by PRESET,
  // so a profile that never had a direct install (e.g. `web`) was misread as "direct" and silently
  // skipped bundle activation. Measured 2026-09-26: the memory panel in 3080 answered 404 with an
  // empty body, and the client showed it as `SyntaxError: Unexpected end of JSON input`.
  // `write()` honours --dry-run.
  //
  // ORDER MATTERS (fixed 2026-09-26, second pass): this used to run in `commandInstall` AFTER
  // `nativeInstall` had already tried to stage the client half. A COLD native install therefore had no
  // `cordis.patch.yml` yet, `installClientIntoProfile` returned early (`没有 cordis.patch.yml`), and
  // the panel's client half was silently never installed — the command still printed `Done (native)`
  // and exited 0, and only a SECOND install fixed it. Creating the anchor first removes the
  // prerequisite instead of documenting it.
  writeManifest(options, profileRoot, "npm", ["cordis.patch.yml"], []);
  if (!options.dryRun) {
    copyFile(options, join(PROFILE_DIR, "cordis.patch.yml"), join(profileRoot, "cordis.patch.yml"),
      !existsSync(join(profileRoot, "cordis.patch.yml")) || options.force);
  }

  // The bundle delivers the ENGINE + the panel's HOST routes, but the panel's CLIENT half is
  // a separate locally staged package — and this path used to skip it entirely, which is why
  // the main `dsh web` (3080) had no memory panel even after a native install (2026-09-26).
  // `installClientIntoProfile` picks the patch layer the target profile's boot actually reads
  // (the notes-assistant overlay, or the profile's own `cordis.patch.yml` for e.g. `web`).
  try {
    const client = installClientIntoProfile(profileRoot, { quiet: true });
    if (!client.ok) log(options, `[client] 客户端半个安装失败：${client.error ?? "unknown"}`);
    else log(options, `[client] 客户端半个已装（${client.inserted ? "新插入行" : "行已在"}：${client.rowLayer ?? "?"}）`);
  } catch (error) {
    log(options, `[client] 客户端半个安装异常：${String(error)}`);
  }
  return true;
}

// ── direct (offline) install — the flat copy into the PROFILE directory ─────
//
// The retired `$DSH_HOME/.agent-presets/<id>/` copy is NOT written any more
// (2026-09-26): dsh >= 0.1.7 reads nothing there, and the preset is declared in
// the `--patch` overlay instead. Ownership moved to the profile manifest, which
// `directInstallProfile` writes. `commandUninstall` still CLEANS UP a directory a
// pre-2026-09-26 install left behind.

async function directInstallProfile(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", options.profile);
  const conflict = assertChannelOwnership(options, { profileDir: profileRoot, home: dshHome, presetId: PRESET_ID }, "direct");
  if (conflict !== null) {
    log(options, `[conflict] profile ${options.profile} is ${conflict}`);
    return false;
  }
  const firstRun = !existsSync(join(profileRoot, "package.json"));
  copyFile(options, join(PROFILE_DIR, "package.json"), join(profileRoot, "package.json"), firstRun || options.force);
  // Repair an EXISTING manifest: `copyFile` above skips it unless forced, and a
  // profile manifest that names itself but declares no `version` makes dsh's
  // default-on plugin-inventory request extension throw during EVERY request
  // preparation (see repairProfileManifest).
  if (repairProfileManifest(profileRoot, options)) log(options, `[manifest] 补上缺失的 name/version：${join(profileRoot, "package.json")}`);
  else if (options.dryRun) log(options, `[dry-run] 会补上缺失的 name/version：${join(profileRoot, "package.json")}`);
  // The BUNDLE channel declares the preset from the package's own patch (sub-path form), so this
  // profile's layer must stay declaration-free: two rows with one id break the composition (measured
  // 2026-09-26). Repair profiles an earlier build wrote the other way round — and never write anything
  // under `--dry-run` (bug audit F5: the repair used to ignore the flag).
  if (!options.dryRun && stripPresetDeclaration(profileRoot)) {
    log(options, `[preset] 已从 profile 的 patch 层撤掉扁平声明（bundle 层已经在声明同一个 id）：${join(profileRoot, "cordis.patch.yml")}`);
  }
  copyFile(options, join(PROFILE_DIR, "cordis.yml"), join(profileRoot, "cordis.yml"), true);
  const postureExists = existsSync(join(profileRoot, "cordis.patch.yml"));
  copyFile(options, join(PROFILE_DIR, "cordis.patch.yml"), join(profileRoot, "cordis.patch.yml"), !postureExists || options.force);
  // This is the channel that DOES need the flat declaration: there is no bundle layer here, the preset
  // body is staged flat, and `copyFile` above skips an existing posture file — so a profile whose
  // posture predates B3 would otherwise be left with no declaration at all and every reply would fail
  // with `agent-preset/not-found`. (B3 wired this repair into the NATIVE path by mistake, which is the
  // opposite channel: there the bundle layer already declares the id, so the repair actively created a
  // duplicate row and broke the composition.) Audit F5: honour --dry-run.
  if (!options.dryRun && ensurePresetDeclaration(profileRoot)) {
    log(options, `[preset] 已把 preset 声明补进 profile 自己的 patch 层：${join(profileRoot, "cordis.patch.yml")}`);
  }
  copyFile(options, join(PROFILE_DIR, "pnpm-workspace.yaml"), join(profileRoot, "pnpm-workspace.yaml"), firstRun);
  copyFile(options, join(PROFILE_DIR, "math-memory-workspace.mjs"), join(profileRoot, "math-memory-workspace.mjs"), true);
  copyFile(options, join(PROFILE_DIR, "notes-assistant.patch.yml"), join(profileRoot, "notes-assistant.patch.yml"), true);
  copyFile(options, join(HOST_DIR, "memory-admin.mjs"), join(profileRoot, "memory-admin.mjs"), true);
  copyFile(options, join(HOST_DIR, "math-memory-panel.mjs"), join(profileRoot, "math-memory-panel.mjs"), true);
  copyFile(options, join(PRESET_DIR, "hook-frontmatter.mjs"), join(profileRoot, "hook-frontmatter.mjs"), true);
  // The profile contract itself. It is listed in the contract's own scaffold set, and the postcondition
  // below makes sure a listed-but-unwritten file can never pass silently again (2026-09-26: this
  // installer once reported success while `profile-contract.mjs` was missing from disk, because the
  // scaffold list only fed the MANIFEST while the writes were hand-written `copyFile` calls).
  copyFile(options, join(PRESET_DIR, "profile-contract.mjs"), join(profileRoot, "profile-contract.mjs"), true);
  // The agent preset's OWN modules, through the one list in preset-deploy.mjs.
  // Without this the profile declares `name: ./math-memory.mjs` and has no such
  // file: dsh prints nothing at boot, and `session/create` answers
  // `agent-preset/invalid` (measured 2026-09-26).
  const body = deployPresetBody({
    home: dshHome,
    read: presetReaderFromDir(PRESET_DIR),
    profile: options.profile,
    dryRun: options.dryRun
  });
  for (const name of body.planned) {
    log(options, options.dryRun
      ? `[dry-run] would write ${join(body.root, name)}`
      : `[write] ${join(body.root, name)}`);
  }
  // 客户端半个（记忆面板的 Settings 面板 + **拖拽引用**）。以前只有 `web` profile 装它，于是
  // Obsidian 侧栏（notes-assistant）里"从文件树拖一篇笔记进输入框"根本不加载 —— 代码对、也测过，
  // 但没被装上（2026-09-21 发现）。这一步让安装路径自己负责，而不是靠手工跑另一个脚本。
  try {
    const { installClientIntoProfile } = await import("./client-panel/install-into-profile.mjs");
    // `--dry-run` must not stage the client package either: it copies into `node_modules/`, writes the
    // `.dsh-client-panel/` staging dir, adds a `dependencies` entry and may insert a patch row. It has
    // no dry-run mode of its own, so the only correct thing to do under the flag is not to call it.
    if (options.dryRun) {
      log(options, `[dry-run] 会安装客户端半个到 ${profileRoot}`);
    } else {
      const res = installClientIntoProfile(profileRoot, { quiet: true });
      if (!res.ok) log(options, `[client] 客户端半个安装失败：${res.error ?? "unknown"}`);
      else log(options, `[client] 客户端半个已装（${res.inserted ? "新插入 patch" : "patch 已包含"}）`);
    }
  } catch (error) {
    log(options, `[client] 客户端半个安装异常：${String(error)}`);
  }
  // Postcondition: everything the manifest is about to claim must exist on disk.
  //
  // WHY (2026-09-26, B2 experiment): this installer reported `Done (direct)` while
  // `profile-contract.mjs` — listed in the contract, and therefore in the manifest it wrote — was
  // never written, because the scaffold half of `DIRECT_PROFILE_FILES` only fed the MANIFEST while
  // the writes above were hand-written `copyFile` calls. A profile whose own manifest lies is worse
  // than a loud failure: the drift is invisible to every later check.
  if (!options.dryRun) {
    const neverWritten = DIRECT_PROFILE_FILES.filter((name) => !existsSync(join(profileRoot, name)));
    if (neverWritten.length > 0) {
      throw new Error(`direct install: planned but never written: ${neverWritten.join(", ")} — the manifest would claim files that do not exist`);
    }
  }
  writeManifest(options, profileRoot, "direct", DIRECT_PROFILE_FILES, []);
  return true;
}

// ── posture (native mode) ────────────────────────────────────────────────────

function writePosture(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", options.profile);
  const conflict = assertChannelOwnership(options, { profileDir: profileRoot, home: dshHome, presetId: PRESET_ID }, "npm");
  if (conflict !== null) {
    log(options, `[conflict] profile ${options.profile} is ${conflict}`);
    return false;
  }
  const posturePath = join(profileRoot, "cordis.patch.yml");
  copyFile(options, join(PROFILE_DIR, "cordis.patch.yml"), posturePath, !existsSync(posturePath) || options.force);
  // Same rule applied to the file just written: on this channel the BUNDLE layer is the only declarer
  // (the copied scaffold carries the flat declaration, which belongs to the `--direct`/Obsidian
  // channel). Without this the native install produced two rows with one id and the preset came out
  // `broken` (measured 2026-09-26). `copyFile` already honoured --dry-run; so must this.
  if (!options.dryRun) stripPresetDeclaration(profileRoot);
  writeManifest(options, profileRoot, "npm", ["cordis.patch.yml"], []);
  return true;
}

// ── vault templates ─────────────────────────────────────────────────────────

function seedVaultTemplates(options) {
  if (options.vault === "") return [];
  const vault = resolve(options.vault);
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
  for (const [source, relTarget] of Object.entries(manifest)) {
    const target = join(vault, ...relTarget.split("/"));
    copyFile(options, join(TEMPLATES_DIR, source), target, false);
  }
  return Object.values(manifest);
}

// ── commands ────────────────────────────────────────────────────────────────

async function commandInstall(options) {
  const dshHome = resolveDshHome(options);
  log(options, `dsh-math-memory: installing into ${dshHome} (${options.direct ? "direct" : "native"})`);

  if (options.direct) {
    // No `directInstallPreset` step any more: the retired `.agent-presets/<id>/`
    // copy is gone (see the section comment above). Ownership lands in the profile
    // manifest, written by `directInstallProfile`.
    if (!(await directInstallProfile(options, dshHome))) return 1;
  } else {
    // Check ownership conflicts BEFORE mutating: `dsh plugin add` writes into
    // the profile, so a foreign-owned profile/preset must be refused up front
    // (detecting it only after the add would leave a half-installed state).
    //
    // ONE lookup, not two: the profile manifest and the legacy `.agent-presets`
    // marker answer the same question ("which channel owns this profile"), and
    // `readChannelOwner` already prefers the manifest with the marker as a
    // fallback. Asking both separately is how the two could disagree silently.
    const conflict = assertChannelOwnership(options, {
      profileDir: join(dshHome, "profiles", options.profile),
      home: dshHome,
      presetId: PRESET_ID
    }, "npm");
    if (conflict !== null) {
      log(options, `[conflict] profile ${options.profile} is ${conflict}`);
      return 1;
    }

    if (!nativeInstall(options, dshHome)) return 1;
    if (!writePosture(options, dshHome)) return 1;

    // No legacy-marker write any more (2026-09-26): the profile manifest written
    // by `writePosture` is the anchor, and `readChannelOwner` prefers it. A stale
    // legacy marker saying "direct" is therefore harmless — it is only consulted
    // when the manifest is absent.
  }
  seedVaultTemplates(options);

  log(options, "");
  if (options.direct) {
    log(options, "Done (direct). Start with:");
    log(options, `  dsh --profile ${options.profile} --patch "${join(dshHome, "profiles", options.profile, "notes-assistant.patch.yml")}"`);
  } else {
    log(options, "Done (native). The preset appears in the agent picker after the next dsh boot.");
    log(options, `  dsh --profile ${options.profile}`);
  }
  return 0;
}

function commandStatus(options) {
  const dshHome = resolveDshHome(options);
  console.log(`DSH_HOME: ${dshHome}`);
  console.log(`profile:  ${options.profile}`);

  const profileRoot = join(dshHome, "profiles", options.profile);
  // dsh >= 0.1.7: the preset is a DECLARED row and its modules live in the
  // profile directory; `.agent-presets/` only carries the LEGACY channel marker.
  // Asking the old directory (`agent.cordis.yml` there) reported "[missing]" for
  // every healthy install, because preset-deploy.mjs never writes that file.
  const owner = readChannelOwner({ profileDir: profileRoot, home: dshHome, presetId: PRESET_ID });
  const ownerText = owner === null
    ? "(no owner marker)"
    : `(owner=${owner.owner} v${owner.version ?? "?"}, via ${owner.source})`;
  console.log(`preset:   ${describePresetBody(profileRoot)} ${ownerText}`);
  // Surface leftover state instead of letting it sit there invisibly: this
  // directory is not read by anything any more (see the module docblock), so its
  // only remaining meaning is "a pre-2026-09-26 install left this here".
  const retiredDir = join(dshHome, LEGACY_PRESET_DIR, PRESET_ID);
  if (existsSync(retiredDir)) {
    console.log(`retired:  [present] ${retiredDir} — leftover from a pre-2026-09-26 install; nothing reads it, \`uninstall\` removes it`);
  }

  let bundles = [];
  try {
    bundles = JSON.parse(readFileSync(join(profileRoot, "package.json"), "utf8")).dsh?.profile?.bundles ?? [];
  } catch {
    // no profile package.json yet
  }
  console.log(`bundle:   ${bundles.includes("dsh-math-memory") ? "[registered]" : "[not registered]"} (${bundles.join(", ") || "none"})`);

  const manifest = readMarker(join(profileRoot, CHANNEL_MANIFEST));
  console.log(`posture:  ${existsSync(join(profileRoot, "cordis.patch.yml")) ? "[present]" : "[missing]"} ${manifest ? `(owner=${manifest.owner} v${manifest.version})` : "(no install manifest)"}`);

  if (options.vault !== "") {
    const vault = resolve(options.vault);
    const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
    const found = [];
    for (const relTarget of Object.values(manifest)) {
      if (existsSync(join(vault, ...relTarget.split("/")))) found.push(relTarget);
    }
    console.log(`vault:    ${found.length}/${Object.keys(manifest).length} templates present`);
  }
  return 0;
}

function commandUninstall(options) {
  if (options.purgeData && options.confirm !== PURGE_DATA_CONFIRM) {
    console.error(`--purge-data requires --confirm "${PURGE_DATA_CONFIRM}" (exact match) to delete memory content.`);
    return 1;
  }
  if (!options.yes) {
    log(options, "[dry-run] pass --yes to execute (default is a plan only).");
    options.dryRun = true;
  }

  const dshHome = resolveDshHome(options);
  const presetRoot = join(dshHome, LEGACY_PRESET_DIR, PRESET_ID);
  const profileRoot = join(dshHome, "profiles", options.profile);
  // The legacy marker is read for one purpose only here: deciding whether to
  // delete the retired directory. WHICH CHANNEL owns the install comes from the
  // unified anchor (profile manifest first).
  const presetMarker = readMarker(join(presetRoot, OWNER_MARKER));
  const channelOwner = readChannelOwner({ profileDir: profileRoot, home: dshHome, presetId: PRESET_ID });

  // 1. bundle (native channel) — remove via dsh plugin remove when possible.
  const nativeOwned = channelOwner !== null && channelOwner.owner === "npm";
  if (nativeOwned) {
    const args = ["plugin", "--profile", options.profile, "remove", "dsh-math-memory"];
    log(options, `[run] dsh ${args.join(" ")}`);
    if (!options.dryRun) {
      const result = spawnSync("dsh", args, {
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, DSH_HOME: dshHome }
      });
      if (result.error && result.error.code === "ENOENT") {
        log(options, "[note] dsh not found — remove the bundle registration manually (or ignore).");
      } else if (result.status !== 0) {
        log(options, `[note] dsh plugin remove exited ${result.status} — the bundle may still be registered; remove it manually.`);
      }
    }
  }

  // 2. MIGRATION CLEANUP: the retired `.agent-presets/<id>/` copy. Nothing writes
  //    it any more (2026-09-26); an install made before that has one, and this is
  //    where it goes. Ownership is NOT decided here — that is `channelOwner`
  //    above — so a missing marker just means "nothing we own to clean up".
  if (!existsSync(presetRoot)) {
    // nothing to clean up
  } else if (presetMarker === null) {
    log(options, `[keep] retired preset dir ${presetRoot} has no owner marker — leaving it.`);
  } else if (presetMarker.owner === "npm" || presetMarker.owner === "direct" || options.force) {
    remove(options, presetRoot, true);
  }

  // 3. posture files we wrote (manifest-owned). `manifest` here is the PROFILE's
  //    manifest — the same file `readChannelOwner` just used as the anchor.
  //
  //    ⚠️ DELETE ONLY WHAT STILL MATCHES OUR RECORD (2026-09-26). `posture` is not a list of
  //    "ours, safe to delete": for a native install it is exactly `cordis.patch.yml`, which on a
  //    `web` profile is the USER'S OWN dsh patch layer — their settings (providers, default model,
  //    etc.) live there, and dsh's config editor writes it too. Deleting it wholesale on uninstall
  //    silently destroys configuration we never wrote. `verifyPostureDigests` exists for precisely
  //    this ("a profile whose files no longer match the manifest that claims to have written them
  //    has been hand-edited"), so consult it: a drifted file is left in place with a reason.
  const manifest = readMarker(join(profileRoot, CHANNEL_MANIFEST));
  if (manifest !== null && Array.isArray(manifest.posture)) {
    const digestCheck = verifyPostureDigests(profileRoot, manifest);
    const drifted = new Set(digestCheck.drifted);
    for (const rel of manifest.posture) {
      const path = join(profileRoot, rel);
      if (!existsSync(path)) continue;
      if (drifted.has(rel)) {
        log(options, `[keep] ${path} 已被手工或 dsh 自己改过（与安装时的记录不一致）——不删。确认不需要时请手动删除。`);
        continue;
      }
      remove(options, path);
    }
    remove(options, join(profileRoot, CHANNEL_MANIFEST));
  }

  // 4. profile directory (only after node_modules is gone; --purge removes the rest).
  if (options.purge) {
    if (existsSync(profileRoot)) {
      const left = readdirSync(profileRoot).filter((n) => n !== "node_modules");
      if (left.length === 0) remove(options, profileRoot, true);
      else log(options, `[keep] profile dir still has: ${left.join(", ")}`);
    }
  } else {
    log(options, `[keep] profile dir ${profileRoot} (use --purge to remove)`);
  }

  // 5. vault: cache always; regenerable skeletons (index/_README) with --purge;
  //    everything carrying user/agent content with --purge-data.
  if (options.vault !== "") {
    const vault = resolve(options.vault);
    remove(options, join(vault, ".deepseek", "cache"), true);

    if (options.purge || options.purgeData) {
      const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
      for (const relTarget of Object.values(manifest)) {
        const isSkeleton = relTarget.endsWith("index.md") || relTarget.split("/").pop()?.startsWith("_README");
        if (isSkeleton) {
          const path = join(vault, ...relTarget.split("/"));
          if (existsSync(path)) remove(options, path);
        }
      }
    } else {
      log(options, "[keep] vault skeletons (use --purge): .deepseek/**/index.md, _README.md");
    }

    if (options.purgeData) {
      const contentFiles = [
        "AGENTS.md", ".deepseek/memory/profile.md", ".deepseek/memory/notation.md",
        ".deepseek/capture-policy.md", ".deepseek/config.md", ".deepseek/working.md"
      ];
      for (const rel of contentFiles) {
        const path = join(vault, ...rel.split("/"));
        if (existsSync(path)) remove(options, path);
      }
      const contentDirs = [
        ".deepseek/memory/records", ".deepseek/memory/topics", ".deepseek/memory/theorems",
        ".deepseek/memory/templates", ".deepseek/memory/episodes", ".deepseek/strategy",
        ".deepseek/inbox", ".deepseek/archive"
      ];
      for (const rel of contentDirs) {
        const path = join(vault, rel);
        if (existsSync(path)) remove(options, path, true);
      }
      log(options, "[note] memory content removed with --purge-data. Restore from a backup if needed.");
    } else {
      log(options, "[keep] memory content (use --purge-data): AGENTS.md, profile.md, notation.md, cards, inbox, archive, ...");
    }
  }

  log(options, "");
  // Always state the memory disposition so the user never has to guess
  // whether their notes/memories were touched.
  if (options.vault === "") {
    log(options, "[memory] --vault not specified: your .deepseek/** files were NOT touched.");
  } else if (options.purgeData) {
    log(options, "[memory] DELETED your memory content (--purge-data). Restore from a backup if you have one.");
  } else {
    log(options, "[memory] KEPT — memory cards/inbox/archive under .deepseek/ were left untouched. Use --purge-data to delete them.");
  }
  log(options, "Obsidian plugin: disable/uninstall it from Obsidian's own settings.");
  return 0;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const code =
    options.command === "status" ? commandStatus(options) :
    options.command === "uninstall" ? commandUninstall(options) :
    await commandInstall(options);
  process.exit(code);
}

// Only run as a CLI. `scripts/check-preset-body-lists.mjs` imports this module
// for DIRECT_PROFILE_FILES, and running main() there would parse the guard's own
// argv and exit.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
