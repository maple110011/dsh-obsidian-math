/**
 * channel-owner — WHO OWNS THIS PROFILE: the `npm` bundle channel, or an offline
 * `--direct` / Obsidian install?
 *
 * Both the runtime conflict guard (`dsh/host/index.mjs`) and the installer's
 * pre-flight refusal depend on that answer, and getting it wrong means two
 * channels overwrite each other's files with no warning.
 *
 * THE ANCHOR (2026-09-26)
 * -----------------------
 * It used to be `$DSH_HOME/.agent-presets/<id>/.owner.json` ONLY — a directory
 * dsh >= 0.1.7 no longer reads for anything. That made the guard depend on a
 * directory that looks deletable, so "clean up the dead directory" silently
 * disabled it. All three channels already write
 * `<profile>/.install-manifest.json` with an `owner` field, so THAT is the anchor
 * now, and the legacy marker is kept as a FALLBACK: an install made before the
 * change has only the legacy marker, and treating it as unowned is exactly the
 * silent takeover this module exists to prevent. (Writes to the legacy directory
 * stopped in the same round; see docs/handoff.md §7.)
 *
 * WHAT THIS MODULE USED TO BE
 * ---------------------------
 * It was `preset-sync.mjs`: it synced a preset tree from the package into
 * `$DSH_HOME/.agent-presets/<id>/` (ported from @linxin666/dsh-liangshen's
 * src/sync.ts, MIT). dsh 0.1.7 replaced directory presets with a declarative row
 * in the bundle patch, so that tree sync had no production caller and was deleted
 * along with its two gates — the preset's modules are now resolved either as a
 * subpath of the installed package (npm channel) or as `./name` files staged into
 * the profile directory (offline channels). See
 * `scripts/lib/preset-declaration.mjs`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The legacy per-preset owner marker (retired: read-only, for old installs). */
export const OWNER_MARKER = ".owner.json";

/** The profile-dir ownership manifest every channel writes. */
export const CHANNEL_MANIFEST = ".install-manifest.json";

/** The retired preset directory. */
export const LEGACY_PRESET_DIR = ".agent-presets";

/**
 * Absolute directory of the profile that is CURRENTLY BOOTING, read from the
 * plugin context. Returns null when the anchor is unavailable (callers then fall
 * back and say so).
 *
 * MEASURED on dsh 0.1.7-rc.2 (2026-09-26): `ctx.baseUrl` is
 * `file:///…/profiles/<the booting profile>/`, even for a row that came from a
 * bundle patch inside a package. `process.cwd()` is the caller's shell, and the
 * `DSH_PROFILE` environment variable is whatever the PARENT environment had —
 * measured reading `"web"` while the process was booting `myvaultprofile`, so it
 * is not an anchor. (Spelled without the `process.env.` prefix on purpose:
 * `check-env-vars.mjs` greps for that literal to decide which variables the code
 * READS, and a name mentioned in prose is not a read.)
 */
export function profileDirFromCtx(ctx) {
  const baseUrl = ctx?.baseUrl;
  if (typeof baseUrl !== "string" || baseUrl === "") return null;
  let dir = null;
  try {
    dir = fileURLToPath(baseUrl);
  } catch {
    return null;
  }
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed === "" ? dir : trimmed;
}

/**
 * Which channel owns this profile. Profile manifest first, legacy marker as a
 * fallback (see the module header for why that order is load-bearing).
 *
 * @param {{profileDir?: string|null, home?: string|null, presetId: string}} what
 * @returns {{owner: string, version?: string, source: 'manifest'|'legacy', installedAt?: string}|null}
 */
export function readChannelOwner({ profileDir = null, home = null, presetId }) {
  const candidates = [];
  if (typeof profileDir === "string" && profileDir !== "") {
    candidates.push({ path: join(profileDir, CHANNEL_MANIFEST), source: "manifest" });
  }
  if (typeof home === "string" && home !== "" && typeof presetId === "string" && presetId !== "") {
    candidates.push({ path: join(home, LEGACY_PRESET_DIR, presetId, OWNER_MARKER), source: "legacy" });
  }
  for (const candidate of candidates) {
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(candidate.path, "utf8"));
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    if (typeof parsed.owner !== "string" || parsed.owner === "") continue;
    return { ...parsed, source: candidate.source };
  }
  return null;
}
