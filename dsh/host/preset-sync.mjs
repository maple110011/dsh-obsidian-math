/**
 * preset-sync — idempotent sync of the bundled `notes-assistant` agent preset
 * from this package into the harness agent-presets root (~/.dsh/.agent-presets).
 *
 * Ported from @linxin666/dsh-liangshen's src/sync.ts (MIT) and simplified for a
 * single preset: byte-identical files are skipped, files the source no longer
 * has are pruned, and an owner marker (.owner.json) is written so install /
 * uninstall / conflict resolution can determine who owns the preset directory.
 * The source directory is authoritative; the target directory is never touched
 * outside the sync, and sibling user presets are never visited.
 *
 * The owner marker is only rewritten when its owner/version identity changes,
 * so the original installedAt is preserved across idempotent re-syncs.
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

const MTIME_TOLERANCE_MS = 1000;
export const OWNER_MARKER = ".owner.json";

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
