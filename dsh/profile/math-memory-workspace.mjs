/**
 * math-memory-workspace — registers the Obsidian vault as a dsh workspace at
 * profile boot, so the sidebar workspace picker has the vault ready to choose
 * and the web UI does not need to open a directory-selection flow.
 *
 * Host-plane plugin: it injects `workspaceRegistry` from the dsh web app and
 * only creates/reuses a workspace. It never writes user notes.
 */
import { resolve } from "node:path";

export const name = "math-memory-workspace";
export const inject = ["workspaceRegistry"];

export async function apply(ctx, config) {
  const raw = String(config?.vaultPath ?? process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT ?? "").trim();
  if (raw === "") return;

  let vaultPath;
  try {
    vaultPath = resolve(raw);
  } catch (error) {
    ctx.logger?.warn(`math-memory-workspace: cannot resolve vault path ${JSON.stringify(raw)}: ${String(error)}`);
    return;
  }

  try {
    const existing = await ctx.workspaceRegistry.resolveByPath(vaultPath);
    if (existing !== undefined) return;
    await ctx.workspaceRegistry.create(vaultPath);
  } catch (error) {
    // Keep profile boot alive: a workspace-creation failure must not take the
    // whole service down; the user can still add the workspace manually.
    ctx.logger?.warn(`math-memory-workspace: could not auto-register vault ${JSON.stringify(vaultPath)}: ${String(error)}`);
  }
}
