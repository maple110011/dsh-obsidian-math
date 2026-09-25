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
 *   <home>/.agent-presets/notes-assistant/.owner.json    (LEGACY anchor, read only
 *                                                        as a fallback; the
 *                                                        directory is not a preset
 *                                                        lookup path on 0.1.7+, and
 *                                                        relying on it alone meant
 *                                                        deleting that dead
 *                                                        directory silently disabled
 *                                                        the npm-vs-direct guard)
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
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  PRESET_BODY_FILES,
  deployPresetBody,
  presetReaderFromDir
} from "./preset/preset-deploy.mjs";
// The marker FILENAMES come from the module that owns their semantics — a second
// literal here is how the two anchors could drift apart silently.
import {
  CHANNEL_MANIFEST,
  LEGACY_PRESET_DIR,
  OWNER_MARKER,
  readChannelOwner
} from "./host/preset-sync.mjs";

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
const DIRECT_PROFILE_BASE = [
  "package.json",
  "cordis.yml",
  "cordis.patch.yml",
  "pnpm-workspace.yaml",
  "math-memory-workspace.mjs",
  "notes-assistant.patch.yml",
  "memory-admin.mjs",
  "math-memory-panel.mjs",
  "hook-frontmatter.mjs"
];
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
 * Conflict string when the OTHER channel owns this profile, else null. The anchor
 * is the profile's `CHANNEL_MANIFEST` with the legacy `.agent-presets` marker as
 * a fallback — see `readChannelOwner` in ./host/preset-sync.mjs for why that
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

function writeOwnerMarker(options, markerPath, channel) {
  const payload = { owner: channel, version: packageVersion(), installedAt: new Date().toISOString() };
  write(options, markerPath, JSON.stringify(payload, null, 2) + "\n");
}

function writeManifest(options, profileRoot, channel, postureFiles, vaults) {
  const manifestPath = join(profileRoot, CHANNEL_MANIFEST);
  const payload = {
    owner: channel,
    version: packageVersion(),
    installedAt: new Date().toISOString(),
    profile: options.profile,
    posture: postureFiles,
    vaults
  };
  write(options, manifestPath, JSON.stringify(payload, null, 2) + "\n");
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
  return true;
}

// ── direct (offline) install — the legacy flat copy ─────────────────────────

function directInstallPreset(options, dshHome) {
  const presetRoot = join(dshHome, LEGACY_PRESET_DIR, PRESET_ID);
  const markerPath = join(presetRoot, OWNER_MARKER);
  const conflict = assertChannelOwnership(options, {
    profileDir: join(dshHome, "profiles", options.profile),
    home: dshHome,
    presetId: PRESET_ID
  }, "direct");
  if (conflict !== null) {
    log(options, `[conflict] preset ${PRESET_ID} is ${conflict}`);
    return false;
  }
  copyFile(options, join(PRESET_DIR, "math-memory.mjs"), join(presetRoot, "math-memory.mjs"), true);
  copyFile(options, join(PRESET_DIR, "note-tools.mjs"), join(presetRoot, "note-tools.mjs"), true);
  copyFile(options, join(PRESET_DIR, "hook-frontmatter.mjs"), join(presetRoot, "hook-frontmatter.mjs"), true);
  copyFile(options, join(PRESET_DIR, "preset.yml"), join(presetRoot, "preset.yml"), options.force);
  copyFile(options, join(PRESET_DIR, "agent.cordis.yml"), join(presetRoot, "agent.cordis.yml"), options.force);
  writeOwnerMarker(options, markerPath, "direct");
  return true;
}

async function directInstallProfile(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", options.profile);
  const conflict = assertChannelOwnership(options, { profileDir: profileRoot, home: dshHome, presetId: PRESET_ID }, "direct");
  if (conflict !== null) {
    log(options, `[conflict] profile ${options.profile} is ${conflict}`);
    return false;
  }
  const firstRun = !existsSync(join(profileRoot, "package.json"));
  copyFile(options, join(PROFILE_DIR, "package.json"), join(profileRoot, "package.json"), firstRun || options.force);
  copyFile(options, join(PROFILE_DIR, "cordis.yml"), join(profileRoot, "cordis.yml"), true);
  const postureExists = existsSync(join(profileRoot, "cordis.patch.yml"));
  copyFile(options, join(PROFILE_DIR, "cordis.patch.yml"), join(profileRoot, "cordis.patch.yml"), !postureExists || options.force);
  copyFile(options, join(PROFILE_DIR, "pnpm-workspace.yaml"), join(profileRoot, "pnpm-workspace.yaml"), firstRun);
  copyFile(options, join(PROFILE_DIR, "math-memory-workspace.mjs"), join(profileRoot, "math-memory-workspace.mjs"), true);
  copyFile(options, join(PROFILE_DIR, "notes-assistant.patch.yml"), join(profileRoot, "notes-assistant.patch.yml"), true);
  copyFile(options, join(HOST_DIR, "memory-admin.mjs"), join(profileRoot, "memory-admin.mjs"), true);
  copyFile(options, join(HOST_DIR, "math-memory-panel.mjs"), join(profileRoot, "math-memory-panel.mjs"), true);
  copyFile(options, join(PRESET_DIR, "hook-frontmatter.mjs"), join(profileRoot, "hook-frontmatter.mjs"), true);
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
    const res = installClientIntoProfile(profileRoot, { quiet: true });
    if (!res.ok) log(options, `[client] 客户端半个安装失败：${res.error ?? "unknown"}`);
    else log(options, `[client] 客户端半个已装（${res.inserted ? "新插入 patch" : "patch 已包含"}）`);
  } catch (error) {
    log(options, `[client] 客户端半个安装异常：${String(error)}`);
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
    if (!directInstallPreset(options, dshHome)) return 1;
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

    // Native --force claims the LEGACY marker too, so a `--direct` install from
    // before 2026-09-26 (which only has that marker) does not make the bundle
    // skip at the next boot.
    if (options.force) {
      writeOwnerMarker(options, join(dshHome, LEGACY_PRESET_DIR, PRESET_ID, OWNER_MARKER), "npm");
    }
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

  // 2. preset directory — only when we own it (or --force). This is the CHANNEL
  //    marker (the npm-vs-direct guard), not the preset lookup path any more; the
  //    deployed body files under profiles/<name>/ are listed in the posture
  //    manifest and are removed by step 3 below.
  if (presetMarker === null) {
    log(options, `[keep] preset ${presetRoot} has no owner marker — leaving it.`);
  } else if (presetMarker.owner === "npm" || presetMarker.owner === "direct" || options.force) {
    remove(options, presetRoot, true);
  }

  // 3. posture files we wrote (manifest-owned). `manifest` here is the PROFILE's
  //    manifest — the same file `readChannelOwner` just used as the anchor.
  const manifest = readMarker(join(profileRoot, CHANNEL_MANIFEST));
  if (manifest !== null && Array.isArray(manifest.posture)) {
    for (const rel of manifest.posture) {
      const path = join(profileRoot, rel);
      if (existsSync(path)) remove(options, path);
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
