#!/usr/bin/env node
/**
 * dsh-obsidian-math — install the Obsidian math-memory plugin into a
 * DeepSeek Harness installation.
 *
 * Usage:
 *   dsh-obsidian-math install [--vault <vaultDir>] [--dsh-home <dir>] [--force]
 *   dsh-obsidian-math status
 *
 * What it writes (idempotent; existing user edits are preserved unless
 * --force is given):
 *   $DSH_HOME/.agent-presets/obsidian/   agent preset (files-only tools + memory plugin)
 *   $DSH_HOME/profiles/obsidian/         the `dsh --profile obsidian` profile
 *   <vault>/.deepseek/...                optional vault memory templates (when --vault is given)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PRESET_DIR = join(PACKAGE_ROOT, "dsh", "preset");
const PROFILE_DIR = join(PACKAGE_ROOT, "dsh", "profile");
const TEMPLATES_DIR = join(PACKAGE_ROOT, "dsh", "templates");
// The Obsidian companion plugin and the shipped preset hard-code this name;
// keeping it fixed in the CLI avoids the two drifting apart.
const PROFILE_NAME = "obsidian";

function parseArgs(argv) {
  const options = {
    command: "install",
    vault: "",
    dshHome: "",
    force: false,
    quiet: false,
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "install" || arg === "status" || arg === "update") {
      options.command = arg;
    } else if (arg === "--vault" || arg === "-v") options.vault = argv[++index] ?? "";
    else if (arg === "--dsh-home") options.dshHome = argv[++index] ?? "";
    else if (arg === "--force" || arg === "-f") options.force = true;
    else if (arg === "--quiet" || arg === "-q") options.quiet = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`dsh-obsidian-math — DeepSeek Harness plugin installer

Usage:
  dsh-obsidian-math install [--vault <vaultDir>] [--dsh-home <dir>] [--force]
  dsh-obsidian-math status [--dsh-home <dir>]

Options:
  --vault <dir>    also create the vault memory templates (.deepseek/..., AGENTS.md)
  --dsh-home <dir> harness home (default: $DSH_HOME or ~/.dsh)
  --force          overwrite preset/profile config files (preserves user edits otherwise)
  --dry-run        print planned writes without touching the filesystem`);
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

function copyTemplate(options, templateName, target, overwrite = true) {
  const source = join(TEMPLATES_DIR, templateName);
  const content = readFileSync(source, "utf8");
  return write(options, target, content, overwrite);
}

function copyFile(options, source, target, overwrite = true) {
  return write(options, target, readFileSync(source, "utf8"), overwrite);
}

function resolveDshHome(options) {
  const raw = options.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh");
  return resolve(raw);
}

function installPreset(options, dshHome) {
  const presetRoot = join(dshHome, ".agent-presets", PROFILE_NAME);
  // Code always updates (bug fixes); user-editable metadata is preserved.
  copyFile(options, join(PRESET_DIR, "obsidian-memory.mjs"), join(presetRoot, "obsidian-memory.mjs"), true);
  copyFile(options, join(PRESET_DIR, "preset.yml"), join(presetRoot, "preset.yml"), options.force);
  copyFile(options, join(PRESET_DIR, "agent.cordis.yml"), join(presetRoot, "agent.cordis.yml"), options.force);
}

function installProfile(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", PROFILE_NAME);
  copyFile(options, join(PROFILE_DIR, "package.json"), join(profileRoot, "package.json"), !existsSync(join(profileRoot, "package.json")) || options.force);
  copyFile(options, join(PROFILE_DIR, "cordis.yml"), join(profileRoot, "cordis.yml"), true);
  copyFile(options, join(PROFILE_DIR, "cordis.patch.yml"), join(profileRoot, "cordis.patch.yml"), !existsSync(join(profileRoot, "cordis.patch.yml")) || options.force);
  copyFile(options, join(PROFILE_DIR, "pnpm-workspace.yaml"), join(profileRoot, "pnpm-workspace.yaml"), !existsSync(join(profileRoot, "pnpm-workspace.yaml")));
}

/** Warn when the global home patch references skin bundles the minimal profile does not mount. */
function warnAboutHomePatch(options, dshHome) {
  const patchPath = join(dshHome, "cordis.patch.yml");
  let content;
  try {
    content = readFileSync(patchPath, "utf8");
  } catch {
    return;
  }
  if (/linxin666|dsh-skins|ui-skin/i.test(content)) {
    log(options, "");
    log(options, "NOTE: $DSH_HOME/cordis.patch.yml references dsh skin bundles (@linxin666/...).");
    log(options, "The generated obsidian profile only mounts dsh-base + dsh-web-app, so those");
    log(options, "skin patch entries will fail to apply. Either remove the skin entries from the");
    log(options, "global patch or add the skin bundles to $DSH_HOME/profiles/obsidian/package.json.");
  }
}

function installVaultTemplates(options) {
  if (options.vault === "") return;
  const vault = resolve(options.vault);
  const templates = [
    ["AGENTS.md", "AGENTS.md"],
    ["profile.md", join(".deepseek", "memory", "profile.md")],
    ["topics-index.md", join(".deepseek", "memory", "topics", "index.md")],
    ["records-readme.md", join(".deepseek", "memory", "records", "_README.md")],
    ["records-index.md", join(".deepseek", "memory", "records", "index.md")],
    ["theorems-readme.md", join(".deepseek", "memory", "theorems", "_README.md")],
    ["theorems-index.md", join(".deepseek", "memory", "theorems", "index.md")],
    ["templates-readme.md", join(".deepseek", "memory", "templates", "_README.md")],
    ["templates-index.md", join(".deepseek", "memory", "templates", "index.md")],
    ["episodes-readme.md", join(".deepseek", "memory", "episodes", "_README.md")],
    ["episodes-index.md", join(".deepseek", "memory", "episodes", "index.md")],
    ["inbox-readme.md", join(".deepseek", "inbox", "_README.md")],
    ["inbox-index.md", join(".deepseek", "inbox", "index.md")]
  ];
  for (const [source, target] of templates) {
    copyTemplate(options, source, join(vault, target), false);
  }
}

function statusCommand(options, dshHome) {
  console.log(`DSH_HOME: ${dshHome}`);
  for (const relative of [
    join(".agent-presets", PROFILE_NAME, "agent.cordis.yml"),
    join("profiles", PROFILE_NAME, "package.json"),
    join("profiles", PROFILE_NAME, "cordis.patch.yml")
  ]) {
    const path = join(dshHome, relative);
    console.log(`${existsSync(path) ? "[ok]" : "[missing]"} ${path}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dshHome = resolveDshHome(options);
  if (options.command === "status") {
    statusCommand(options, dshHome);
    return;
  }
  if (options.command === "update") options.force = false;
  log(options, `dsh-obsidian-math: installing into ${dshHome}`);
  installPreset(options, dshHome);
  installProfile(options, dshHome);
  installVaultTemplates(options);
  warnAboutHomePatch(options, dshHome);
  log(options, "");
  log(options, "Done. Start the Obsidian mode with:");
  log(options, `  dsh --profile ${PROFILE_NAME} --port 3180`);
  log(options, "Or install the companion Obsidian community plugin: it starts this service automatically.");
}

main();
