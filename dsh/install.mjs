#!/usr/bin/env node
/**
 * dsh-math-memory — install / status / uninstall for the Obsidian math-memory
 * plugin's dsh side.
 *
 * Commands:
 *   install [--direct] [--vault <dir>] [--dsh-home <dir>] [--profile <name>] [--force] [--quiet] [--dry-run]
 *     native (default): writes the profile scaffold (in-box bundles dsh-base +
 *                       dsh-web-app) then `dsh plugin add dsh-math-memory`
 *                       (the bundle syncs the preset at dsh boot), then writes
 *                       the profile posture + owner markers + vault templates.
 *     --direct:         legacy flat copy of the preset/profile/host files
 *                       (offline / no pnpm / no registry), plus the same markers.
 *   status [--dsh-home <dir>] [--profile <name>]
 *   uninstall [--vault <dir>] [--purge] [--purge-data --confirm <phrase>] [--yes] [--dsh-home <dir>] [--profile <name>]
 *
 * Owner markers make install/uninstall symmetric and conflict-safe:
 *   <home>/.agent-presets/notes-assistant/.owner.json   (preset ownership)
 *   <home>/profiles/<name>/.install-manifest.json        (posture ownership)
 * A native (bundle) install owns the preset as "npm" (written by the bundle's
 * preset-sync at dsh boot); a --direct install owns it as "direct". Install
 * refuses to overwrite a preset owned by the other channel unless --force.
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

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PRESET_DIR = join(PACKAGE_ROOT, "dsh", "preset");
const PROFILE_DIR = join(PACKAGE_ROOT, "dsh", "profile");
const HOST_DIR = join(PACKAGE_ROOT, "dsh", "host");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "dsh", "templates");
const MANIFEST_FILE = join(PACKAGE_ROOT, "dsh", "templates-manifest.json");

const PROFILE_NAME = "notes-assistant";
const PRESET_ID = "notes-assistant";
const OWNER_MARKER = ".owner.json";
const INSTALL_MANIFEST = ".install-manifest.json";
const PURGE_DATA_CONFIRM = "DELETE MY MATH MEMORY";
// Only dsh-math-memory is an out-of-tree bundle (pnpm-installed). The in-box
// bundles (@deepseek-ai/dsh-base + dsh-web-app) ship WITH the dsh installation
// and are listed in the profile scaffold's package.json — they must NOT be
// pnpm-added (no registry copy to fetch; a mirror 404s on their deps).
const NATIVE_BUNDLES = ["dsh-math-memory"];
// Files the --direct (legacy flat) install writes into the profile dir; the
// install manifest records them so uninstall can remove them symmetrically.
const DIRECT_PROFILE_FILES = [
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
 * Assert (or with --force, take over) ownership of a marker-governed target.
 * Returns null when writing may proceed; a non-empty conflict string otherwise.
 */
function assertOwnership(options, markerPath, channel) {
  const existing = readMarker(markerPath);
  if (existing === null) return null;
  if (existing.owner === channel || options.force) return null;
  return `owned by "${existing.owner}" (v${existing.version ?? "?"}) — pass --force to take over as "${channel}"`;
}

function writeOwnerMarker(options, markerPath, channel) {
  const payload = { owner: channel, version: packageVersion(), installedAt: new Date().toISOString() };
  write(options, markerPath, JSON.stringify(payload, null, 2) + "\n");
}

function writeManifest(options, profileRoot, channel, postureFiles, vaults) {
  const manifestPath = join(profileRoot, INSTALL_MANIFEST);
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
  const presetRoot = join(dshHome, ".agent-presets", PRESET_ID);
  const markerPath = join(presetRoot, OWNER_MARKER);
  const conflict = assertOwnership(options, markerPath, "direct");
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

function directInstallProfile(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", options.profile);
  const markerPath = join(profileRoot, INSTALL_MANIFEST);
  const conflict = assertOwnership(options, markerPath, "direct");
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
  writeManifest(options, profileRoot, "direct", DIRECT_PROFILE_FILES, []);
  return true;
}

// ── posture (native mode) ────────────────────────────────────────────────────

function writePosture(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", options.profile);
  const markerPath = join(profileRoot, INSTALL_MANIFEST);
  const conflict = assertOwnership(options, markerPath, "npm");
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

function commandInstall(options) {
  const dshHome = resolveDshHome(options);
  log(options, `dsh-math-memory: installing into ${dshHome} (${options.direct ? "direct" : "native"})`);

  if (options.direct) {
    if (!directInstallPreset(options, dshHome)) return 1;
    if (!directInstallProfile(options, dshHome)) return 1;
  } else {
    // Check ownership conflicts BEFORE mutating: `dsh plugin add` writes into
    // the profile, so a foreign-owned profile/preset must be refused up front
    // (detecting it only after the add would leave a half-installed state).
    if (!options.force) {
      const profileOwner = readMarker(join(dshHome, "profiles", options.profile, INSTALL_MANIFEST));
      if (profileOwner !== null && profileOwner.owner !== "npm") {
        log(options, `[conflict] profile ${options.profile} is owned by "${profileOwner.owner}" — pass --force to take over as "npm".`);
        return 1;
      }
      const presetOwner = readMarker(join(dshHome, ".agent-presets", PRESET_ID, OWNER_MARKER));
      if (presetOwner !== null && presetOwner.owner !== "npm") {
        log(options, `[conflict] preset ${PRESET_ID} is owned by "${presetOwner.owner}" — pass --force to take over as "npm".`);
        return 1;
      }
    }

    if (!nativeInstall(options, dshHome)) return 1;
    if (!writePosture(options, dshHome)) return 1;

    // Native --force claims the preset marker so the bundle syncs it at the
    // next boot (otherwise a direct-owned marker would make the bundle skip).
    if (options.force) {
      writeOwnerMarker(options, join(dshHome, ".agent-presets", PRESET_ID, OWNER_MARKER), "npm");
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

  const presetRoot = join(dshHome, ".agent-presets", PRESET_ID);
  const presetMarker = readMarker(join(presetRoot, OWNER_MARKER));
  console.log(`preset:   ${existsSync(join(presetRoot, "agent.cordis.yml")) ? "[present]" : "[missing]"} ${presetMarker ? `(owner=${presetMarker.owner} v${presetMarker.version})` : "(no owner marker)"}`);

  const profileRoot = join(dshHome, "profiles", options.profile);
  let bundles = [];
  try {
    bundles = JSON.parse(readFileSync(join(profileRoot, "package.json"), "utf8")).dsh?.profile?.bundles ?? [];
  } catch {
    // no profile package.json yet
  }
  console.log(`bundle:   ${bundles.includes("dsh-math-memory") ? "[registered]" : "[not registered]"} (${bundles.join(", ") || "none"})`);

  const manifest = readMarker(join(profileRoot, INSTALL_MANIFEST));
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
  const presetRoot = join(dshHome, ".agent-presets", PRESET_ID);
  const profileRoot = join(dshHome, "profiles", options.profile);
  const presetMarker = readMarker(join(presetRoot, OWNER_MARKER));
  const manifest = readMarker(join(profileRoot, INSTALL_MANIFEST));

  // 1. bundle (native channel) — remove via dsh plugin remove when possible.
  const nativeOwned = presetMarker?.owner === "npm" || manifest?.owner === "npm";
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

  // 2. preset directory — only when we own it (or --force).
  if (presetMarker === null) {
    log(options, `[keep] preset ${presetRoot} has no owner marker — leaving it.`);
  } else if (presetMarker.owner === "npm" || presetMarker.owner === "direct" || options.force) {
    remove(options, presetRoot, true);
  }

  // 3. posture files we wrote (manifest-owned).
  if (manifest !== null && Array.isArray(manifest.posture)) {
    for (const rel of manifest.posture) {
      const path = join(profileRoot, rel);
      if (existsSync(path)) remove(options, path);
    }
    remove(options, join(profileRoot, INSTALL_MANIFEST));
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const code =
    options.command === "status" ? commandStatus(options) :
    options.command === "uninstall" ? commandUninstall(options) :
    commandInstall(options);
  process.exit(code);
}

main();
