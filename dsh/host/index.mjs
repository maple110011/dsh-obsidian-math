/**
 * dsh-math-memory host plugin (the package's `main` export, referenced by the
 * bundle patch's insert row by package name). A single host-plane entry that
 * on startup:
 *   1. syncs the bundled `notes-assistant` preset into ~/.dsh/.agent-presets
 *      (idempotent byte-compare + owner marker, see ./preset-sync.mjs),
 *   2. registers the /memory-panel routes (reusing math-memory-panel.mjs),
 *   3. auto-registers the vault workspace (reusing math-memory-workspace.mjs).
 *
 * No browser half, no routes of its own, no agent tools — the preset itself
 * provides the tools. The capability is hot-pluggable: it is mounted by the
 * bundle patch (dsh/cordis.patch.yml) with no dsh source changes.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncPresetTree, OWNER_MARKER } from "./preset-sync.mjs";
import { apply as applyPanel } from "./math-memory-panel.mjs";
import { apply as applyWorkspace } from "../profile/math-memory-workspace.mjs";

export const name = "math-memory-host";
export const inject = ["webServer", "workspaceRegistry"];

const PRESET_ID = "notes-assistant";

function readOwnerMarker(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Harness home: $DSH_HOME, else ~/.dsh. */
function dshHome() {
  const raw = process.env.DSH_HOME;
  return raw && raw.trim() !== "" ? raw : join(homedir(), ".dsh");
}

/** Absolute path of the bundled preset tree inside this package. */
function bundledPresetDir() {
  return fileURLToPath(new URL("../preset/", import.meta.url));
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Guard against double-apply across a re-mount (module-level: this plugin is
// host-plane and mounted once per profile roster).
let mounted = false;

export async function apply(ctx, config) {
  if (mounted) return;
  mounted = true;

  const targetPresetDir = join(dshHome(), ".agent-presets", PRESET_ID);

  // Conflict guard: a `--direct` (Obsidian/offline) install owns the preset as
  // "direct". This bundle owns it as "npm". Never clobber the other channel —
  // and skip panel/workspace too, because the direct install already mounts
  // them via its --patch overlay (double-mounting would collide).
  const existingOwner = readOwnerMarker(join(targetPresetDir, OWNER_MARKER));
  if (existingOwner !== null && existingOwner.owner !== "npm") {
    ctx.logger?.warn?.(
      `dsh-math-memory: preset ${PRESET_ID} is owned by "${existingOwner.owner}" — ` +
      `skipping bundle activation. Run \`dsh-math-memory uninstall\` to remove the direct copy, ` +
      `or \`dsh-math-memory install --force\` to switch to the npm bundle channel.`
    );
    return;
  }

  // 1. sync the preset into the harness agent-presets root
  try {
    mkdirSync(dshHome(), { recursive: true });
    const result = syncPresetTree(bundledPresetDir(), targetPresetDir, {
      owner: "npm",
      version: packageVersion()
    });
    if (result.failed) {
      ctx.logger?.warn?.(`dsh-math-memory: preset ${PRESET_ID} sync failed: ${result.failed}`);
    } else if (result.changed) {
      ctx.logger?.info?.(`dsh-math-memory: preset ${PRESET_ID} synced (${result.files} files)`);
    }
  } catch (error) {
    ctx.logger?.warn?.(`dsh-math-memory: preset sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. memory-panel routes
  try {
    applyPanel(ctx);
  } catch (error) {
    ctx.logger?.warn?.(`dsh-math-memory: panel routes failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 3. auto-register the vault workspace (best-effort)
  try {
    await applyWorkspace(ctx, config);
  } catch (error) {
    ctx.logger?.warn?.(`dsh-math-memory: workspace auto-register failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
