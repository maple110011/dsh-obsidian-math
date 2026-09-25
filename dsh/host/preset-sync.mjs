/**
 * preset-sync — CHANNEL OWNERSHIP for this profile, plus the (now retired) tree
 * sync this module was originally written for.
 *
 * WHAT IT OWNS TODAY
 * ------------------
 * `readChannelOwner()` + `profileDirFromCtx()` answer one question: **which
 * install channel owns the profile that is booting** (`npm` bundle / `direct`)?
 * Both the runtime conflict guard (`dsh/host/index.mjs`) and the installer's
 * pre-flight refusal depend on that answer, and getting it wrong means two
 * channels overwrite each other's files with no warning.
 *
 * The anchor used to be `$DSH_HOME/.agent-presets/<id>/.owner.json` only — a
 * directory dsh >= 0.1.7 no longer reads. That made the guard depend on a
 * directory that looks deletable: "clean up the dead directory" silently
 * disabled the guard. All three channels already write
 * `<profile>/.install-manifest.json` with an `owner` field, so that is the
 * anchor now, with the legacy marker kept as a FALLBACK (an install made before
 * the change has only the legacy marker; treating it as unowned is exactly the
 * silent-takeover this function exists to prevent). See docs/handoff.md §7.
 *
 * WHAT IT NO LONGER OWNS
 * ----------------------
 * `syncPresetTree()` is a leftover from the pre-0.1.7 layout: the preset is now
 * declared in the bundle patch and its modules are reached through the installed
 * package, so NOTHING in production syncs a preset directory any more. It is kept
 * only because `scripts/test-preset-sync.mjs` still exercises it; the next step
 * retires both together (see docs/handoff.md §7).
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MTIME_TOLERANCE_MS = 1000;
export const OWNER_MARKER = ".owner.json";

/** The profile-dir ownership manifest every channel writes. */
export const CHANNEL_MANIFEST = ".install-manifest.json";

/** The retired preset directory; still read as a fallback and still what `--direct` writes. */
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

/** Recursively list every file under `root` (never directories). */
function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(root);
  return out;
}

/**
 * File identity is bytes. Size and mtime are only a fast negative check: a
 * size mismatch or an mtime gap beyond the tolerance proves the pair cannot be
 * byte-identical without reading both, but an equal size and close mtime still
 * fall through to a byte comparison so content differences are never missed.
 */
function sameFile(a, b) {
  const sourceStat = statSync(a);
  const targetStat = statSync(b);
  if (sourceStat.size !== targetStat.size) return false;
  if (Math.abs(sourceStat.mtimeMs - targetStat.mtimeMs) > MTIME_TOLERANCE_MS) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/**
 * Remove files not in `keep` (relative paths), then remove only the
 * directories those removals left empty — still strictly inside `root`.
 * Returns the number of files pruned.
 */
function pruneExtras(root, keep) {
  const parents = new Set();
  let pruned = 0;
  for (const file of filesUnder(root)) {
    if (!keep.has(relative(root, file))) {
      parents.add(dirname(file));
      rmSync(file, { force: true });
      pruned += 1;
    }
  }
  for (const start of [...parents]) {
    let dir = start;
    while (dir !== undefined && relative(root, dir) !== "" && relative(root, dir) !== "..") {
      if (existsSync(dir) && readdirSync(dir).length === 0) {
        rmSync(dir, { recursive: true, force: true });
        dir = dirname(dir);
      } else {
        dir = undefined;
      }
    }
  }
  return pruned;
}

/**
 * Sync `sourceDir` (a preset tree holding agent.cordis.yml) into `targetDir`.
 *
 * @param {string} sourceDir absolute source preset directory
 * @param {string} targetDir absolute target preset directory
 * @param {{owner?: string, version?: string, installedAt?: string}|null} [meta]
 *        owner-marker payload; omit/null to skip writing the marker.
 * @returns {{changed: boolean, files: number, pruned: number, failed: string|null}}
 */
export function syncPresetTree(sourceDir, targetDir, meta = null) {
  const result = { changed: false, files: 0, pruned: 0, failed: null };
  try {
    mkdirSync(targetDir, { recursive: true });
    const sourceFiles = filesUnder(sourceDir);
    const keep = new Set([OWNER_MARKER]);
    for (const file of sourceFiles) {
      const rel = relative(sourceDir, file);
      keep.add(rel);
      result.files += 1;
      const targetFile = join(targetDir, rel);
      if (!existsSync(targetFile) || !sameFile(file, targetFile)) {
        mkdirSync(dirname(targetFile), { recursive: true });
        copyFileSync(file, targetFile);
        const stat = statSync(file);
        utimesSync(targetFile, stat.atime, stat.mtime);
        result.changed = true;
      }
    }
    const pruned = pruneExtras(targetDir, keep);
    if (pruned > 0) {
      result.pruned = pruned;
      result.changed = true;
    }

    // Minimal structural validation: the preset must carry a non-empty
    // agent.cordis.yml. (dsh-liangshen runs a full schema check here; this
    // package keeps the check dependency-free and fail-visible instead.)
    const agentFile = join(targetDir, "agent.cordis.yml");
    if (!existsSync(agentFile) || readFileSync(agentFile, "utf8").trim() === "") {
      result.failed = "agent.cordis.yml missing or empty after sync";
      return result;
    }

    if (meta !== null && meta !== undefined) {
      const markerPath = join(targetDir, OWNER_MARKER);
      const now = new Date().toISOString();
      let existing = null;
      if (existsSync(markerPath)) {
        try {
          existing = JSON.parse(readFileSync(markerPath, "utf8"));
        } catch {
          existing = null;
        }
      }
      const sameIdentity =
        existing !== null &&
        existing.owner === meta.owner &&
        existing.version === meta.version;
      const marker = {
        ...meta,
        installedAt: sameIdentity && existing?.installedAt ? existing.installedAt : (meta.installedAt ?? now)
      };
      if (!sameIdentity) {
        writeFileSync(markerPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
      }
    }
  } catch (error) {
    result.failed = error instanceof Error ? error.message : String(error);
  }
  return result;
}
