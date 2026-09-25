/**
 * dsh-math-memory host plugin (the package's `main` export, referenced by the
 * bundle patch's insert row by package name). A single host-plane entry that
 * on startup:
 *   1. registers the /memory-panel routes (reusing math-memory-panel.mjs),
 *   2. auto-registers the vault workspace (reusing math-memory-workspace.mjs).
 *
 * IT DOES NOT DEPLOY THE PRESET BODY, on purpose. It used to (and that was the
 * 2026-09-26 bug): the bundle channel's preset declares its modules as subpaths
 * of this installed package, so nothing has to be staged — and staging here was
 * one boot too late anyway, because the agent-preset registry mounts the preset
 * while this row is still being imported. See `scripts/lib/preset-declaration.mjs`
 * ("TWO NAME FORMS, ONE COMPOSITION") and `dsh/preset/preset-deploy.mjs`.
 *
 * No browser half of its own, no agent tools — the preset provides the tools.
 * The capability is hot-pluggable: it is mounted by the bundle patch
 * (dsh/cordis.patch.yml) with no dsh source changes.
 *
 * `$DSH_HOME/.agent-presets/<id>/` is not a deploy target any more (dsh reads
 * nothing there); it survives only as the ownership marker both install channels
 * write, which is why it is still named below.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OWNER_MARKER } from "./preset-sync.mjs";
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

// Guard against double-apply across a re-mount (module-level: this plugin is
// host-plane and mounted once per profile roster).
let mounted = false;

export async function apply(ctx, config) {
  if (mounted) return;
  mounted = true;

  // Conflict guard: a `--direct` (Obsidian/offline) install owns the profile as
  // "direct". This bundle owns it as "npm". Never clobber the other channel —
  // and skip panel/workspace too, because the direct install already mounts
  // them via its --patch overlay (double-mounting would collide).
  //
  // The marker still lives under `.agent-presets/<id>/` even though dsh >= 0.1.7
  // no longer reads that directory for presets: it is an ownership record
  // written by both channels, not a preset lookup path. Moving it would orphan
  // every existing install's marker and defeat the guard.
  const ownershipRoot = join(dshHome(), ".agent-presets", PRESET_ID);
  const existingOwner = readOwnerMarker(join(ownershipRoot, OWNER_MARKER));
  if (existingOwner !== null && existingOwner.owner !== "npm") {
    ctx.logger?.warn?.(
      `dsh-math-memory: preset ${PRESET_ID} is owned by "${existingOwner.owner}" — ` +
      `skipping bundle activation. Run \`dsh-math-memory uninstall\` to remove the direct copy, ` +
      `or \`dsh-math-memory install --force\` to switch to the npm bundle channel.`
    );
    return;
  }

  // 1. memory-panel routes
  try {
    applyPanel(ctx);
  } catch (error) {
    ctx.logger?.warn?.(`dsh-math-memory: panel routes failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. auto-register the vault workspace (best-effort)
  try {
    await applyWorkspace(ctx, config);
  } catch (error) {
    ctx.logger?.warn?.(`dsh-math-memory: workspace auto-register failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
