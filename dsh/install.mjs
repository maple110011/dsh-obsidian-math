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
 *
 * `--force` is an OWNERSHIP flag only. `<profile>/cordis.patch.yml` (the profile's own
 * patch layer) and `<profile>/package.json` (its own manifest, incl. `dsh.profile.bundles`)
 * are the user's; this installer creates them when absent and never replaces one that
 * exists (`ensurePosture` / `ensureProfileManifest`), on any channel and under any flag.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
import { PROFILE_SCAFFOLD_FILES, POSTURE_SHARED_FILES } from "./preset/profile-contract.mjs";
// A′ S4 (2026-09-26): the offline channel can now install a REAL bundle package instead of only
// flattening files. `local-bundle.mjs` is the pure materializer (S1); the closure collector is the same
// authority the client half uses, so the package's module list cannot drift from the repo layout.
import {
  LOCAL_BUNDLE_DIR,
  LOCAL_BUNDLE_PKG,
  localBundleSourceFiles,
  materializeLocalBundle,
  removeLocalBundle,
  localBundleInstalledIn
} from "./profile/local-bundle.mjs";
import { collectDshImportClosure } from "./client-panel/install-into-profile.mjs";
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

export function parseArgs(argv) {
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
  // An unrecognised flag used to be dropped in silence, and that caused a real, documented
  // mistake: `docs/installation.md` told users to run `install --native`, which does not exist —
  // the flag vanished, `--profile` fell back to its default `notes-assistant`, and the command
  // quietly installed the panel's client half into the SIDEBAR profile while `web` still had no
  // panel. Nothing warned (found 2026-09-26 while auditing the docs).
  //
  // Collect first, report once: a typo'd flag plus its stray value should produce one actionable
  // message, not one error per token.
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "install" || arg === "status" || arg === "uninstall") options.command = arg;
    else if (arg === "--direct") options.direct = true;
  // A′ S4 (A1 ①): the offline channel tries to install a REAL local bundle first and falls back to the
  // flat copy. `--flat` forces the old shape for anyone who wants the pre-A′ behaviour on purpose.
  else if (arg === "--flat") options.flat = true;
    else if (arg === "--vault" || arg === "-v") options.vault = argv[++index] ?? "";
    else if (arg === "--dsh-home") options.dshHome = argv[++index] ?? "";
    else if (arg === "--profile") options.profile = argv[++index] ?? PROFILE_NAME;
    else if (arg === "--force" || arg === "-f") options.force = true;
  // Escape hatch for the harness-home guard (see assertHarnessHome): sandboxes and probes legitimately
  // point at a temporary directory, which the guard would otherwise refuse when a real ~/.dsh exists.
  else if (arg === "--any-home") options.anyHome = true;
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
  --force             take over an other-channel-owned preset/profile. It does NOT
                      rewrite the profile's own cordis.patch.yml or package.json:
                      those two files are the user's own layer and manifest, and are
                      only ever created, never replaced
  --any-home          allow a non-harness home (sandboxes/probes); also DSH_ALLOW_ANY_HOME=1
  --flat              do not try to install a local bundle; use the flat copy (pre-A′ behaviour)
  --dry-run           print planned writes without touching the filesystem
  --purge             uninstall: also remove scaffold templates (vault)
  --purge-data        uninstall: also remove memory CONTENT (requires --confirm)
  --confirm <phrase>  exact phrase for --purge-data ("${PURGE_DATA_CONFIRM}")
  --yes               uninstall: execute (default is a dry-run)

Exit codes:
  0  success / --help
  1  the command failed (ownership conflict, missing dsh, write refused)
  2  an unrecognised argument (a typo is reported, never silently ignored)`);
      process.exit(0);
    }
    else unknown.push(arg);
  }
  if (unknown.length > 0) {
    return { ...options, unknown };
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
  // The dry run must apply the SAME keep/overwrite rule as the real run, in the same
  // order. It used to print "would copy" for every target unconditionally, so on a vault
  // that already had `profile.md` / `notation.md` (user content, copied with
  // overwrite=false) the preview promised an overwrite that the real run would skip —
  // i.e. the one mode whose whole purpose is to let a user check for data loss LIED about
  // the only files where data loss was possible. Measured 2026-10-01: dry run said
  // `would copy … profile.md`, real run said `[skip] exists, preserving user edits`, file
  // byte-identical afterwards.
  if (!overwrite && existsSync(target)) {
    log(options, `${options.dryRun ? "[dry-run] would skip" : "[skip]"} exists, preserving user edits: ${target}`);
    return false;
  }
  if (options.dryRun) {
    log(options, `[dry-run] would copy ${source} -> ${target}`);
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

/**
 * Refuse to treat the OS home (or a directory that merely CONTAINS the harness home) as the harness
 * home.
 *
 * WHY (2026-09-26, measured — the disaster-prevention handoff in the sibling workspace, sections 2/4
 * and its gap 8)
 * ----------------------------------------------------------------------------------------------------
 * Two of the four harness-home loss incidents have their `installedAt` timestamps coinciding to the
 * MILLISECOND with a `install.mjs --direct` write, and the artefact they left is unmistakable: the
 * profile was written to `<user-home>/profiles/notes-assistant` and a skin to
 * `<user-home>/skins/orca-link` — i.e. **the home path was missing its final `.dsh` segment**. The
 * documented root cause is a swallowed assignment in a shell where the home variable is read-only, so
 * it silently kept the user's profile directory and the installer wrote one level too high.
 *
 * What this guard is and is NOT:
 *   · It IS a defence against **writing into the user's home one level too high** — creating stray
 *     `~\profiles`, `~\skins` and a manifest that names the wrong profile (which is exactly what the
 *     incident documents record). Such writes are ugly and confusing, and they are what the object
 *     audit had to add extra ACEs for (`~\profiles`, `~\skins`).
 *   · It is NOT a defence against deletion. It does not need to be: no code path in this installer
 *     deletes the home — every removal target is a specific file or a plugin-owned directory (see the
 *     five `remove()` call sites in `commandUninstall`), and `remove()` deletes only the exact path it
 *     is handed. Saying otherwise would overstate this guard.
 *
 * Two shapes are refused, because both are the documented failure:
 *   1. the resolved path EQUALS the OS home directory;
 *   2. the resolved path CONTAINS the harness home as a child (`<raw>/.dsh` exists) — here the caller's
 *      value is the parent of a real harness home, which is the "missing one segment" case.
 *
 * An explicit value is still trusted: passing `--dsh-home` / `$DSH_HOME` is an intentional act, and the
 * escape hatch (`--any-home` / `DSH_ALLOW_ANY_HOME=1`) exists for sandboxes and probes that
 * legitimately use a temporary directory. Without the hatch, `shape 2` would fire for any test that
 * points at a temp dir while the real `~/.dsh` happens to exist.
 *
 * @throws when the resolved path looks like a mistake. The message names the actual paths, because the
 *   whole failure mode is "the operator believed a different path was in use".
 */
/**
 * Exported so a test can exercise the branch directly. The OS-home branch is NOT reachable through the
 * default path (the default is `join(homedir(), ".dsh")`, which can never EQUAL the OS home) — it only
 * fires when `DSH_HOME`/`--dsh-home` is set to a home directory itself, which is exactly the shell
 * accident this guard exists for. Leaving it unexported would mean shipping an unverified branch.
 */
export function assertHarnessHome(raw, anyHome) {
  if (anyHome) return;
  const resolved = resolve(raw);
  const osHome = resolve(homedir());
  if (resolved === osHome) {
    throw new Error(
      `refusing to use the OS home directory as the harness home: ${resolved}\n` +
      `  pass --dsh-home <dir> (or set DSH_HOME) to point at the harness home — normally ${join(osHome, ".dsh")}.\n` +
      `  If a temporary directory really is intended, say so explicitly with --any-home.`
    );
  }
  if (existsSync(join(resolved, ".dsh"))) {
    throw new Error(
      `refusing to use ${resolved} as the harness home: it CONTAINS a harness home (${join(resolved, ".dsh")}).\n` +
      `  This is the "path missing its last segment" shape that wrote profiles into the user's home on\n` +
      `  2026-09-26. Use ${join(resolved, ".dsh")} instead, or pass --any-home to override deliberately.`
    );
  }
}

function resolveDshHome(options) {
  const raw = options.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh");
  assertHarnessHome(raw, options.anyHome === true || process.env.DSH_ALLOW_ANY_HOME === "1");
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
 *
 * ⚠️ THE FLAT LAYOUT IS ONLY ONE OF THE TWO CHANNELS (fixed 2026-09-26). The BUNDLE channel
 * (`dsh plugin add`) never stages these files into the profile directory — its declaration names the
 * preset entry as a SUBPATH OF THE INSTALLED PACKAGE (`dsh-math-memory/dsh/preset/math-memory.mjs`),
 * so the modules live under `node_modules/`. Reporting the flat list unconditionally therefore told
 * every healthy native install `[missing 4/4: …]`, i.e. it made a working profile look broken and
 * invited people to "fix" it.
 *
 * So ask the profile what it actually NEEDS: if its own patch layer carries the FLAT declaration
 * (`./name` rows), the flat files must be there; if the declaration is the bundle form, the flat
 * layout is simply not this channel's shape and saying "missing" is wrong.
 *
 * @param {string} profileRoot
 * @returns {string} a one-line description for `status`.
 */
function describePresetBody(profileRoot) {
  const flat = PRESET_BODY_FILES.filter((name) => !existsSync(join(profileRoot, name)));
  if (flat.length === 0) return "[present]";

  // Ask the question that actually decides health: does the preset ENTRY the composition declares
  // resolve? The two channels name it differently, and the declaration does not necessarily live in
  // the profile's OWN patch layer — for the bundle channel it is inside the PACKAGE's patch
  // (`<pkg>/dsh/cordis.patch.yml`, i.e. `dsh-math-memory/dsh/preset/math-memory.mjs`). Grepping only
  // the profile's own file therefore missed it, which is why every healthy native install was told
  // `[missing 4/4: …]` (measured 2026-09-26) — a working profile reported as broken.
  //
  // The entry name is taken from `PRESET_BODY_FILES` (the contract's own list), not re-typed.
  const entry = PRESET_BODY_FILES[0];
  if (entry !== undefined) {
    const asPackage = join(profileRoot, "node_modules", "dsh-math-memory", "dsh", "preset", entry);
    if (existsSync(asPackage)) {
      return "[via bundle] (the installed package provides the preset modules; no flat copy is expected)";
    }
  }

  return `[missing ${flat.length}/${PRESET_BODY_FILES.length}: ${flat.join(", ")}]`;
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
  // 2026-10-01 (0.2.0 adaptation): a profile installed BEFORE A1b still carries the retired row id
  // `agent-presets`. Neither 0.1.7 nor 0.2.0 has such a row, and a patch that matches no row is only
  // WARNED about and skipped — so "default preset = notes-assistant" is silently gone and nothing fails.
  // Repair it independently of the generated block (the two live in different places).
  const migrated = migrateRetiredPresetRow(target);
  const source = readFileSync(scaffold, "utf8");
  const begin = DECLARATION_BEGIN;
  const end = DECLARATION_END;
  const start = source.indexOf(begin);
  const stop = source.indexOf(end);
  if (start < 0 || stop <= start) return migrated;
  const block = source.slice(start, stop + end.length);
  const current = readFileSync(target, "utf8");
  const eol = lineEndingOf(current);
  const from = current.indexOf(begin);
  const to = current.indexOf(end);
  if (from >= 0 && to > from) {
    if (current.slice(from, to + end.length).trim() === block.trim()) return migrated;
    // The block comes from the SCAFFOLD; the target may be terminated differently. Re-terminate it,
    // or this splice writes a mixed-ending file (see `lineEndingOf`).
    writeFileSync(target, current.slice(0, from) + withLineEnding(block, eol) + current.slice(to + end.length), "utf8");
    return true;
  }
  // No block at all. If the id is declared some other way by hand, leave that alone — the user may have
  // arranged it deliberately, and guessing would be worse than the gate reporting a stale declaration.
  if (/- id:\s*["']?preset-notes-assistant["']?\s*$/m.test(current)) return migrated;
  // `replace(/\s*$/, eol)` collapses the trailing run to exactly one terminator; the extra `eol` opens the
  // blank line the block is separated by. For an LF file this is byte-for-byte the old expression.
  writeFileSync(target,
    current.replace(/\s*$/, "") + eol + eol + withLineEnding(block, eol) + eol, "utf8");
  return true;
}

/**
 * Rename the RETIRED preset-registry row id in a profile patch layer.
 *
 * WHY (2026-10-01): `agent-presets` was the 0.1.5-era loader row id. 0.1.7 renamed the shipped row to
 * `agent-preset-registry` (and 0.2.0 has no `agent-presets` at all — verified: zero hits across every
 * bundled package). A patch whose id matches no row is **only warned about and skipped**, so an install
 * from before A1b keeps a dead entry and silently loses `default: notes-assistant` — the same class of
 * silent failure A1b itself was about. The generated declaration block is repaired elsewhere; this row
 * lives outside it, which is why the block repair never saw it.
 *
 * The migration is deliberately NARROW, because this edits a user-owned file:
 *   · only a TOP-LEVEL sequence entry whose id is exactly `agent-presets` (never `agent-presets-*`);
 *   · `includeUserRoot` is dropped — it is not a field of the current schema and would be discarded
 *     anyway, but leaving it in invites the reader to believe it still does something;
 *   · everything else in the entry (and the file's line endings) is preserved byte-for-byte;
 *   · idempotent: after the rename the pattern no longer matches.
 *
 * @param {string} patchPath - the profile's `cordis.patch.yml`.
 * @returns {boolean} true when the file changed.
 */
export function migrateRetiredPresetRow(patchPath) {
  if (!existsSync(patchPath)) return false;
  const text = readFileSync(patchPath, "utf8");
  const lines = text.split(/(?<=\n)/); // keep terminators attached, so the untouched lines are byte-exact
  // Match on the line BODY (terminator stripped). Anchoring `$` directly on a line that still carries its
  // `\n` is a trap in JS: without the `m` flag `$` also matches just BEFORE a trailing newline, so the
  // `(\r?\n)?` group can stay unset and `replace` silently swallows the terminator — measured here as
  // "two lines vanished instead of one" while the assertion detail still said "renamed".
  const body = (line) => line.replace(/\r?\n$/, "");
  const terminatorOf = (line) => /\r?\n$/.exec(line)?.[0] ?? "";
  const idBody = /^(\s*)-\s*id:\s*['"]?agent-presets['"]?[ \t]*$/;
  const start = lines.findIndex((line) => idBody.test(body(line)));
  if (start < 0) return false;
  // The entry ends at the next sequence item at any indentation, or at the first line that is neither
  // blank, a comment, nor indented (a top-level sibling of the whole list).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[ \t]*-[ \t]/.test(line)) { end = i; break; }
    if (/^[^\s#]/.test(line)) { end = i; break; }
  }
  const entry = lines.slice(start, end);
  const renamed = body(entry[0]).replace(idBody, "$1- id: agent-preset-registry") + terminatorOf(entry[0]);
  const kept = [];
  for (let i = 1; i < entry.length; i += 1) {
    const lineBody = body(entry[i]);
    const key = /^(\s*)includeUserRoot:\s*(\S*)[ \t]*$/.exec(lineBody);
    if (key === null) { kept.push(entry[i]); continue; }
    // A bare `includeUserRoot:` may open a nested block; drop that block too, or a dangling mapping
    // would be left behind and the file would no longer parse.
    if (key[2] === "") {
      while (i + 1 < entry.length && (/^\s*#/.test(entry[i + 1]) || /^\s+\S/.test(entry[i + 1]))) i += 1;
    }
  }
  writeFileSync(patchPath, [...lines.slice(0, start), renamed, ...kept, ...lines.slice(end)].join(""), "utf8");
  return true;
}

const DECL_BEGIN = DECLARATION_BEGIN;
const DECL_END = DECLARATION_END;

/**
 * The line ending a patch layer is written in.
 *
 * WHY THIS EXISTS (2026-09-27, CI red on a `no drift` assertion — and it was NOT the change that pushed it):
 * both declaration repairs below used to hardcode `"\n"`. On a CRLF file that is not cosmetic:
 * `stripPresetDeclaration`'s blank-run collapse (`/\n{3,}/`) cannot match `\r\n\r\n\r\n`, and the append
 * path glued an LF block onto a CRLF document — measured on the shipped scaffold: `9849 → 9726` chars with
 * **mixed** endings (79 CRLF + 123 LF). The installer therefore rewrote a user's own `cordis.patch.yml`
 * with mangled line endings, and `test-installer`'s `no drift` pair (`<profile>/cordis.patch.yml` must be
 * byte-identical to the repo scaffold) went red in every FRESH clone while staying green in a working copy
 * that happened to hold the file as LF. That asymmetry is the trap: `core.autocrlf=true` normalizes BOTH
 * sides for `git status`, so the working copy looked clean while its bytes differed from the blob.
 *
 * Rule: never assume the terminator. Detect it from the file being edited, and never mix the two.
 */
function lineEndingOf(text) {
  const total = (text.match(/\n/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  return crlf > total - crlf ? "\r\n" : "\n";
}

/** Re-terminate `text` with `eol`, so a block taken from one file can be spliced into another. */
function withLineEnding(text, eol) {
  const lf = text.replace(/\r\n/g, "\n");
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}

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
  // Collapse the blank run the block leaves behind, IN THE FILE'S OWN TERMINATOR: `/\n{3,}/` can never
  // match a CRLF run (`\r\n\r\n\r\n` has an `\r` between every pair), which is how a CRLF file came back
  // with one blank line too many (see `lineEndingOf`).
  const eol = lineEndingOf(current);
  const stripped = (current.slice(0, bounds.from) + current.slice(bounds.to))
    .replace(/(?:\r?\n){3,}/g, eol + eol);
  writeFileSync(target, stripped, "utf8");
  return true;
}

/**
 * Put the posture scaffold into a profile — but ONLY when that profile has none.
 *
 * WHY THIS EXISTS (2026-09-27, measured twice on a real machine).
 * `<profile>/cordis.patch.yml` is the profile's OWN, user-editable dsh patch layer. Four call sites
 * passed `!existsSync(target) || options.force` as `copyFile`'s overwrite flag, so ANY
 * `install --force` replaced the WHOLE file — even though `--force` exists for CHANNEL-OWNERSHIP
 * takeover (`assertChannelOwnership`), which has nothing to do with this file. Measured cost: on
 * 2026-09-27 15:13:18 the `web` profile's layer went 988 B → 3738 B and the user's custom model
 * provider block (`llm-pi-ai` / `agent-default-model`) vanished with it; the `notes-assistant`
 * profile lost its layer the same way at 14:27:45. Both were reproduced byte-for-byte against this
 * installer's own output — see the sibling workspace's
 * `.dsh-snapshots/PRESERVE-20260927-1513-overlay-clobber/INCIDENT-REPORT.md`.
 *
 * The contract this restores is one WE ALREADY WROTE DOWN — in the comment the client-half installer
 * plants inside that very file (`dsh/client-panel/install-into-profile.mjs`): "这一层是 profile
 * 自己的 patch 层" and this installer will not rewrite it again. (That comment used to add "没有任何人
 * 会重写它" — corrected 2026-10-01: dsh's OWN settings panel does rewrite it, via
 * `@deepseek-ai/dsh-config-editor`, so the claim is false about everyone but us. It is precisely why
 * `cordis.patch.yml` is now a SHARED posture file and no longer hash-frozen.)
 *
 * So: absent ⇒ copy the scaffold. Present ⇒ keep it, loudly, and let the caller's declaration repair
 * (`stripPresetDeclaration` / `ensurePresetDeclaration`) make the only edits this installer is
 * entitled to make — both are already row-preserving and carry their own assertions.
 *
 * KNOWN GAP (recorded, not hidden): keeping a file means the installer no longer refreshes its own
 * NON-declaration rows in it (e.g. an older `sandbox-policy` / `permission` posture stays as written).
 * That is a staleness cost, deliberately chosen over silent data loss.
 *
 * @returns true when the scaffold was copied, i.e. the profile had no posture at all.
 */
export function ensurePosture(options, profileRoot) {
  const target = join(profileRoot, "cordis.patch.yml");
  if (existsSync(target)) {
    // Loud on purpose: "the installer kept a file it used to rewrite" must be visible in the log of
    // the run that did it, or the next person re-derives this whole incident from scratch.
    log(options, `[keep] posture exists — preserving the user's own patch layer: ${target}`);
    return false;
  }
  // `overwrite: false` even though the target is absent: if it appeared between the check and the
  // copy, skipping is the right outcome for a file we do not own.
  return copyFile(options, join(PROFILE_DIR, "cordis.patch.yml"), target, false);
}

/**
 * Put the profile scaffold manifest in place — but ONLY when the profile has none.
 *
 * WHY THIS EXISTS (2026-09-27; same class as `ensurePosture`, and the LAST instance of it).
 * `<profile>/package.json` is the profile's own manifest: `dsh.profile.bundles` is where a user adds a
 * bundle, and the file also carries their `dependencies`, `scripts` and whatever else they put in it.
 * `repairProfileManifest` below already calls it "the one file a user may have edited by hand" and guards
 * `--dry-run` for it, and the uninstall path refuses to delete a hand-edited posture file — but three call
 * sites passed `firstRun || options.force` as `copyFile`'s overwrite flag, so `install --force` (an
 * OWNERSHIP flag, see `assertChannelOwnership`) replaced the whole file. Measured: a profile carrying
 * `bundles: […, user-custom-bundle]`, a `dependencies` entry, a `scripts` key and a custom key came back
 * with **all four gone**.
 *
 * The template copy is also UNNECESSARY once the profile exists: measured on a profile whose copy is
 * already skipped today (no `--force`), the real bundle channel still registers `dsh-math-memory` into
 * `dsh.profile.bundles` and still keeps the user's own bundle entry.
 *
 * `name` is derived from the profile DIRECTORY when we do create the file — the same rule
 * `repairProfileManifest` uses for a missing name — instead of the scaffold's hardcoded
 * `dsh-profile-notes-assistant`, which is only right for one of the profiles we install into (a fresh
 * install into `web` used to produce a manifest calling itself the notes-assistant profile).
 *
 * @returns true when the scaffold was copied, i.e. the profile had no manifest at all.
 */
export function ensureProfileManifest(options, profileRoot) {
  const target = join(profileRoot, "package.json");
  if (existsSync(target)) {
    log(options, `[keep] package.json exists — preserving the user's own manifest: ${target}`);
    return false;
  }
  // `overwrite: false` even though the target is absent — see `ensurePosture`. Under `--dry-run`
  // `copyFile` writes nothing and returns false, so the rename below cannot fire either.
  if (!copyFile(options, join(PROFILE_DIR, "package.json"), target, false)) return false;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    const derived = `dsh-profile-${basename(profileRoot) || "profile"}`;
    if (parsed.name !== derived) {
      parsed.name = derived;
      writeFileSync(target, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    }
  } catch {
    // A scaffold we cannot parse is not worth guessing at; `repairProfileManifest` fills a missing name.
  }
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

export function writeManifest(options, profileRoot, channel, postureFiles, vaults, extras = {}) {
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
    vaults,
    // A′ S4/A4 ① (2026-09-26): a local bundle keeps `owner: npm` (it really is installed through
    // `dsh plugin add`) and records WHERE it came from. `staging` is also the cleanup list that
    // `commandUninstall` uses, so removal stays symmetric with installation (A6 ② — the staging
    // directory and the registered package used to be left behind).
    ...extras
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
 * ⚠️ EXCLUDES the shared posture files (`POSTURE_SHARED_FILES`). Those are seeded once and then written
 * by someone else too (dsh's plugin manager, dsh's config editor, the user), so a digest of them would
 * be a promise we cannot keep — see the contract's WHY block, and `verifyPostureDigests` for what the
 * gate does instead. The file still stays in `manifest.posture` (the uninstall table); it just is not
 * hash-frozen.
 *
 * @param profileRoot - profile directory holding the flat files.
 * @param files - posture file names (relative to `profileRoot`).
 * @returns `{ [name]: sha256 }` for the installer-owned files that are present.
 */
export function postureDigests(profileRoot, files) {
  const out = {};
  for (const name of files) {
    if (isPostureShared(name)) continue;
    const digest = fileDigest(join(profileRoot, name));
    if (digest !== undefined) out[name] = digest;
  }
  return out;
}

/** Whether a posture file is co-owned by someone other than this installer (see POSTURE_SHARED_FILES). */
export function isPostureShared(name) {
  return POSTURE_SHARED_FILES.includes(name);
}

/**
 * Compare a manifest's recorded digests with what is on disk right now.
 *
 * This is the part that can be a HARD check: a profile whose installer-owned files no longer match the
 * manifest that claims to have written them has been hand-edited, half-written, or clobbered by a stale
 * plugin. (Whether the profile still matches the REPO is a different question — lag is normal until the
 * next install — so gates report that as a notice.)
 *
 * `shared` is the fourth bucket and it is NOT a failure: those files are written by dsh and by the user
 * as well, so "the bytes moved" carries no information about our install. It is reported separately so a
 * gate can print it as a note instead of either failing or silently dropping it. Manifests written before
 * the split still record digests for them (this machine's does); those entries are reclassified into
 * `shared` rather than reported as drift, so the fix does not require a reinstall to go green.
 *
 * @param profileRoot - profile directory.
 * @param manifest - parsed `.install-manifest.json` (may be an old one without digests).
 * @returns `{ checked, drifted, missing, shared, unrecorded }`.
 */
export function verifyPostureDigests(profileRoot, manifest) {
  const recorded = manifest?.postureDigests;
  // Posture entries that are shared but have NO recorded digest (the post-split shape) are still worth
  // reporting: the caller can say "this one is yours, we do not track its bytes".
  const shared = [];
  for (const name of Array.isArray(manifest?.posture) ? manifest.posture : []) {
    if (isPostureShared(name) && existsSync(join(profileRoot, name))) shared.push(name);
  }
  if (recorded === null || typeof recorded !== "object") {
    return { checked: 0, drifted: [], missing: [], shared, unrecorded: true };
  }
  const drifted = [];
  const missing = [];
  const names = Object.keys(recorded);
  let checked = 0;
  for (const name of names) {
    const now = fileDigest(join(profileRoot, name));
    // A pre-split manifest froze a shared file. Reclassify instead of failing: the current writer already
    // refuses to record these, so the only way to see one here is a manifest from before the split.
    if (isPostureShared(name)) {
      if (now !== undefined && !shared.includes(name)) shared.push(name);
      continue;
    }
    checked += 1;
    if (now === undefined) missing.push(name);
    else if (now !== recorded[name]) drifted.push(name);
  }
  return { checked, drifted, missing, shared, unrecorded: false };
}

// ── native install ───────────────────────────────────────────────────────────

function nativeInstall(options, dshHome) {
  // Write the profile scaffold first: package.json lists the IN-BOX bundles
  // (dsh-base + dsh-web-app), which resolve from the dsh installation — never
  // from pnpm. cordis.yml is the empty root; pnpm-workspace.yaml pins the
  // hoisted linker so `dsh plugin add` (pnpm) can run in the profile dir.
  const profileRoot = join(dshHome, "profiles", options.profile);
  // ⚠️ Only an ABSENT manifest is written: it is the user's own file, and `--force` is an ownership
  // flag. `firstRun` therefore means "we had to create it" — exactly what the scaffold copies below want.
  const firstRun = ensureProfileManifest(options, profileRoot);
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
  if (!options.dryRun) ensurePosture(options, profileRoot);

  // The bundle delivers the ENGINE + the panel's HOST routes, but the panel's CLIENT half is
  // a separate locally staged package — and this path used to skip it entirely, which is why
  // the main `dsh web` (3080) had no memory panel even after a native install (2026-09-26).
  // `installClientIntoProfile` picks the patch layer the target profile's boot actually reads
  // (the notes-assistant overlay, or the profile's own `cordis.patch.yml` for e.g. `web`).
  return stageClientHalf(options, profileRoot);
}

/**
 * Stage the memory panel's CLIENT half and report whether it really landed.
 *
 * WHY THIS IS ONE FUNCTION WITH A POSTCONDITION (M3, 2026-09-26). This is the user-visible half of
 * the feature — without it there is no memory panel and dragging a note into the composer does
 * nothing — yet BOTH install routes used to `try { … } catch { log(…) }` and then report success.
 * The command therefore printed `Done` and exited 0 while the panel was simply absent, which is the
 * exact shape the repo keeps being bitten by: success by exit code instead of by structure
 * (trap 44 "写完就当成功", trap 89 "包装进了 node_modules 却没有任何 loader 挂载它").
 *
 * Returning a boolean — instead of only logging — makes both callers able to fail. `ok:true` is not
 * taken on trust either: the staged package must actually carry `client.js` next to its manifest,
 * which is the file the row's bundle resolves.
 *
 * @returns {boolean} true when staged (or legitimately skipped under --dry-run), false on failure.
 */
function stageClientHalf(options, profileRoot) {
  if (options.dryRun) {
    log(options, `[dry-run] 会安装客户端半个到 ${profileRoot}`);
    return true;
  }
  let client = null;
  try {
    client = installClientIntoProfile(profileRoot, { quiet: true });
  } catch (error) {
    log(options, `[client] 客户端半个安装异常：${String(error)}`);
    return false;
  }
  if (client === null || !client.ok) {
    log(options, `[client] 客户端半个安装失败：${client?.error ?? "unknown"}`);
    return false;
  }
  // Postcondition: the row's package must exist with its entry file. A row that points at a package
  // whose `client.js` is missing loads nothing, and the panel silently never appears.
  const entry = join(client.pkgDir, "client.js");
  if (!existsSync(entry)) {
    log(options, `[client] 行已挂载但入口缺失：${entry}（面板不会出现）`);
    return false;
  }
  log(options, `[client] 客户端半个已装（${client.inserted ? "新插入行" : "行已在"}：${client.rowLayer ?? "?"}）`);
  return true;
}

// ── direct (offline) install — the flat copy into the PROFILE directory ─────
//
// The retired `$DSH_HOME/.agent-presets/<id>/` copy is NOT written any more
// (2026-09-26): dsh >= 0.1.7 reads nothing there, and the preset is declared in
// the `--patch` overlay instead. Ownership moved to the profile manifest, which
// `directInstallProfile` writes. `commandUninstall` still CLEANS UP a directory a
// pre-2026-09-26 install left behind.

/**
 * Remove the marker-delimited block from the plugin-owned overlay text (A′ S3/S4, 2026-09-26).
 *
 * The two markers are literal YAML comments in `dsh/profile/notes-assistant.patch.yml`; this function
 * is the installer half of the pair the Obsidian template also carries (`stripBundleOwnedRows` there —
 * they cannot share a module: the template is evaluated as a bundle and cannot `import`).
 *
 * FAILS SAFE: missing or inverted markers return the text UNCHANGED (the flat rows stay, which is the
 * correct pre-S3 behaviour). A half-stripped file would lose one row and keep the other — still a
 * duplicate declaration, but now looking deliberate.
 *
 * ⚠️ Trap 102: the reason this exists is NOT "dsh hard-fails on a repeated route prefix" — that premise
 * was measured and did not reproduce on this machine. The real reason is that the bundle and the overlay
 * would otherwise BOTH declare the same rows (dead or double-mounted depending on whether the flat files
 * happen to be staged), and the composed tree should declare each row once.
 */
const BUNDLE_ROWS_BEGIN = "# >>> bundle-owned rows (see buildNotesAssistantPatch) >>>";
const BUNDLE_ROWS_END = "# <<< bundle-owned rows <<<";

function stripBundleOwnedRows(text) {
  const begin = text.indexOf(BUNDLE_ROWS_BEGIN);
  const end = text.indexOf(BUNDLE_ROWS_END);
  if (begin < 0 || end < 0 || end < begin) return text;
  return text.slice(0, begin) + text.slice(end + BUNDLE_ROWS_END.length);
}

/**
 * True when THIS profile lists our package as a registered bundle.
 *
 * This is the FILE-SYSTEM verdict the plan requires: the package directory AND the
 * `dsh.profile.bundles` entry, never "the child process exited 0". Trap 89 is the precedent — a
 * substring/exit-code check once reported success while nothing had been installed.
 */
function bundleRegisteredIn(profileRoot) {
  const pkgJsonPath = join(profileRoot, "node_modules", LOCAL_BUNDLE_PKG, "package.json");
  if (!existsSync(pkgJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(join(profileRoot, "package.json"), "utf8"));
    const bundles = parsed?.dsh?.profile?.bundles;
    return Array.isArray(bundles) && bundles.includes(LOCAL_BUNDLE_PKG);
  } catch {
    return false;
  }
}

/**
 * A′ S4: opportunistically install this plugin as a REAL bundle for the offline channel.
 *
 * Returns `{ staged: boolean, reason?: string }`. `staged: false` is NOT a failure of the install — the
 * caller falls back to the flat channel and says so. That is the whole point of A1 ① ("机会式包化"):
 * the offline path must keep working on a machine with no dsh/no pnpm, and it must never silently
 * pretend the bundle route succeeded.
 *
 * ORDER (deliberate, and S5 depends on it):
 *   1. the minimal scaffold pnpm needs (package.json / cordis.yml / pnpm-workspace.yaml);
 *   2. materialize the package into `<profile>/.dsh-math-memory/`;
 *   3. `dsh plugin --profile <id> add file:<abs>` — OFFLINE (a `file:` spec never touches the registry);
 *   4. VERIFY on the file system (directory + bundles entry), ignoring the exit code;
 *   5. only THEN flip the manifest to `npm` + `bundleSource: local`, and rewrite the overlay.
 *
 * Step 5 last means an interruption leaves `owner: direct` with the package registered — a shape the
 * next run recovers from (S5), rather than a profile that claims `npm` while nothing is installed.
 */
function tryBundleInstall(options, dshHome, profileRoot) {
  if (options.dryRun) {
    log(options, `[dry-run] would materialize ${join(profileRoot, LOCAL_BUNDLE_DIR)} and run: dsh plugin --profile ${options.profile} add file:<abs>`);
    return { staged: false, reason: "dry-run" };
  }
  if (options.flat) return { staged: false, reason: "--flat" };

  // 1. minimal scaffold — `dsh plugin add` runs pnpm in the profile dir and needs a workspace file.
  const firstRun = ensureProfileManifest(options, profileRoot);
  if (repairProfileManifest(profileRoot, options)) log(options, `[manifest] 补上缺失的 name/version：${join(profileRoot, "package.json")}`);
  copyFile(options, join(PROFILE_DIR, "cordis.yml"), join(profileRoot, "cordis.yml"), true);
  copyFile(options, join(PROFILE_DIR, "pnpm-workspace.yaml"), join(profileRoot, "pnpm-workspace.yaml"), firstRun);

  // 2. materialize. A missing source throws in the materializer — caught here so a broken repo copy
  //    falls back to flat rather than aborting the install.
  try {
    const rootPkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    const result = materializeLocalBundle({
      profileDir: profileRoot,
      files: localBundleSourceFiles({
        repoRoot: PACKAGE_ROOT,
        collectClosure: collectDshImportClosure,
        presetBodyFiles: PRESET_BODY_FILES
      }),
      read: (rel) => {
        try { return readFileSync(join(PACKAGE_ROOT, ...rel.split("/"))); } catch { return null; }
      },
      meta: {
        name: rootPkg.name,
        version: rootPkg.version,
        description: rootPkg.description,
        dshEngine: rootPkg.peerDependencies?.["@deepseek-ai/dsh"] ?? rootPkg.dsh?.engines?.dsh
      }
    });
    log(options, `[bundle] 物化本地包：${result.written.length} 个文件 → ${join(profileRoot, LOCAL_BUNDLE_DIR)}`);
  } catch (error) {
    return { staged: false, reason: `materialize: ${error instanceof Error ? error.message : String(error)}` };
  }

  // 3. install it through dsh, offline.
  const args = ["plugin", "--profile", options.profile, "add", `file:${join(profileRoot, LOCAL_BUNDLE_DIR).split("\\").join("/")}`];
  log(options, `[run] dsh ${args.join(" ")}`);
  const result = spawnSync("dsh", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DSH_HOME: dshHome }
  });
  // ⚠️ THE SEAM IS EVALUATED BEFORE THE SPAWN VERDICT, ON PURPOSE (2026-09-27).
  // `spawnSync` reports a missing toolchain DIFFERENTLY per platform: with `shell: false` (Linux) it
  // returns `result.error` (ENOENT), while with `shell: true` (Windows) cmd starts fine and only the
  // STATUS is non-zero. The old order returned the environment reason first, so on any machine without
  // `dsh` the seam below was never reached — the mutation it exists to prove was silently NOT exercised,
  // and `test-installer`'s `S4 fallback: it SAYS it fell back, with the reason` was the one red check on
  // ubuntu-latest while green on windows-latest. A test seam that only works on one OS is exactly the
  // vacuous pass this repo keeps deleting (AGENTS.md §6: 没有用例走到的分支，不算被测过).
  const forcedUnregistered = process.env.DSH_TEST_UNREGISTER_BUNDLE === "1";
  if (result.error && !forcedUnregistered) {
    const hint = result.error.code === "ENOENT" ? "dsh not found on PATH" : String(result.error);
    return { staged: false, reason: hint };
  }
  // 4. the verdict comes from the FILE SYSTEM, not from `result.status` (trap 89).
  //
  // TEST SEAM (S4 mutation check, 2026-09-26): `DSH_TEST_UNREGISTER_BUNDLE=1` makes the verification
  // answer "not registered" even though `dsh plugin add` really succeeded. That is how the plan's
  // required mutation — "walk the verdict back to `exit code == 0`" — is exercised without having to
  // fake a child process: with the verdict forced false, the fallback must happen and the manifest must
  // stay `direct`; if the check were absent, the install would report bundle success while the package
  // is not registered. OFF unless set. (Declared above, before the spawn verdict — see the note there.)
  if (forcedUnregistered || !bundleRegisteredIn(profileRoot)) {
    const detail = forcedUnregistered
      ? "verification was forced to fail (DSH_TEST_UNREGISTER_BUNDLE=1)"
      : `dsh plugin add exited ${result.status} but ${LOCAL_BUNDLE_PKG} is not registered in ${options.profile}`;
    return { staged: false, reason: detail };
  }
  if (result.status !== 0) {
    log(options, `[bundle] 注意：dsh plugin add 退出码 ${result.status}，但文件系统核验通过 —— 以文件系统为准`);
  }

  // 5a. the profile's own patch layer (posture). A BUNDLE profile must not carry the FLAT preset
  //     declaration: the package's own patch declares the same id with a package subpath, and the
  //     native path learned this the hard way (two rows, one id ⇒ `broken` preset, measured
  //     2026-09-26). It is also a hard prerequisite of the client half, which refuses to stage without
  //     `<profile>/cordis.patch.yml`.
  //
  //     ⚠️ `ensurePosture` writes it ONLY when absent. It is the user's own layer; `--force` is an
  //     ownership flag and must not reach it (2026-09-27: `|| options.force` here is what deleted a
  //     real user's model provider block — see the function's own note).
  ensurePosture(options, profileRoot);
  stripPresetDeclaration(profileRoot);

  // 5b. overlay: drop the rows the package now provides (the client-panel row stays).
  const overlayPath = join(profileRoot, "notes-assistant.patch.yml");
  const flatOverlay = readFileSync(join(PROFILE_DIR, "notes-assistant.patch.yml"), "utf8");
  const bundledOverlay = stripBundleOwnedRows(flatOverlay);
  write(options, overlayPath, bundledOverlay);
  if (bundledOverlay === flatOverlay) {
    // Not fatal — but it means the strip silently did nothing, which is worth a line.
    log(options, "[bundle] 警告：overlay 里没找到成对标记，未剥掉包已提供的行（它们可能成为重复声明）");
  }

  // 5c. Ownership is written by the CALLER, last of all — see the note in `directInstallProfile`.
  // Recording digests here would be recording a profile that is not finished yet: `stageClientHalf`
  // runs after this function returns and rewrites `package.json` (it declares the client package),
  // so a baseline taken now would report this very install as drifted. That is precisely the false
  // signal the baseline exists to avoid (found by installing into a real profile, 2026-09-27).
  log(options, `[bundle] ${LOCAL_BUNDLE_PKG} 已作为本地 bundle 装进 ${options.profile}（owner=npm, bundleSource=local）`);
  return { staged: true, manifestExtras: { bundleSource: "local", staging: LOCAL_BUNDLE_DIR } };
}

async function directInstallProfile(options, dshHome) {
  const profileRoot = join(dshHome, "profiles", options.profile);
  const conflict = assertChannelOwnership(options, { profileDir: profileRoot, home: dshHome, presetId: PRESET_ID }, "direct");
  if (conflict !== null) {
    log(options, `[conflict] profile ${options.profile} is ${conflict}`);
    return false;
  }

  // A′ S4: try the bundle route first; fall back to the flat channel loudly (A1 ①, `--flat` forces the
  // old shape). `assertChannelOwnership` above already refused a profile owned by another channel, so an
  // EXISTING `npm` install is not silently converted here — that direction belongs to `--force`.
  if (!options.flat) {
    const attempt = tryBundleInstall(options, dshHome, profileRoot);
    if (attempt.staged) {
      // The client half is still installed separately: it is NOT part of the bundle's patch.
      const clientStaged = stageClientHalf(options, profileRoot);
      if (!clientStaged) {
        log(options, `[client] 客户端半个没装上 —— 记忆面板在 ${options.profile} 里不会出现（面板的其余部分已写入）`);
        return false;
      }
      // ⚠️ OWNERSHIP AND THE INTEGRITY BASELINE ARE WRITTEN HERE, AFTER EVERY OTHER WRITE.
      // `stageClientHalf` above rewrites `package.json` (to declare the client package), so a manifest
      // written before it records a file that no longer exists on disk — and the profile then reports
      // its OWN fresh install as "drifted" forever. Measured 2026-09-27 on a real profile: the recorded
      // digest did not match byte-for-byte immediately after `install --direct` returned.
      //
      // The posture list is likewise the files that ACTUALLY exist. The bundle channel does not stage
      // the flat module set at all (the package carries them, and dsh resolves them inside it), so
      // writing `DIRECT_PROFILE_FILES` here made the manifest claim 13 files of which 8 were never
      // written — a manifest that lies, which is the one thing this file must never do. Verified: the
      // flat path already has a hard postcondition for exactly this; the bundle path needed the same
      // treatment applied to its own, smaller set.
      const bundlePosture = DIRECT_PROFILE_FILES.filter((name) => existsSync(join(profileRoot, name)));
      writeManifest(options, profileRoot, "npm", bundlePosture, [], attempt.manifestExtras ?? {});
      return true;
    }
    log(options, `[fallback] 本地包化未成功（${attempt.reason}）⇒ 回落到平铺通道（--direct 形态）。`);
  } else {
    log(options, "[flat] --flat 指定：跳过本地包化，使用平铺通道。");
  }

  const firstRun = ensureProfileManifest(options, profileRoot);
  // Repair an EXISTING manifest: `ensureProfileManifest` deliberately leaves a present file alone, and a
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
  // Only an ABSENT posture is written. A present one is the user's own layer and survives even
  // `--force` — the declaration repair below is the only edit this installer may make to it
  // (2026-09-27 real-machine data loss; see `ensurePosture`).
  ensurePosture(options, profileRoot);
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
  const clientStaged = stageClientHalf(options, profileRoot);
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
  // A missing client half means the memory panel is absent from the UI — report it as a failure
  // rather than printing `Done`. (Everything above has already been written; the point is that the
  // exit code must not claim success, so a script or a user can tell.)
  if (!clientStaged) {
    log(options, `[client] 客户端半个没装上 —— 记忆面板在 ${options.profile} 里不会出现（面板的其余部分已写入）`);
    return false;
  }
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
  // Only an ABSENT posture is written; a present one is the user's own layer (see `ensurePosture`).
  ensurePosture(options, profileRoot);
  // Same rule applied to the file just written: on this channel the BUNDLE layer is the only declarer
  // (the copied scaffold carries the flat declaration, which belongs to the `--direct`/Obsidian
  // channel). Without this the native install produced two rows with one id and the preset came out
  // `broken` (measured 2026-09-26). `copyFile` already honoured --dry-run; so must this.
  if (!options.dryRun) stripPresetDeclaration(profileRoot);
  // A′ S5 (2026-09-26): if a LOCAL bundle was staged by the direct path and the user now installs
  // through the native (registry) channel, the staging directory would be left behind as a second copy
  // of the same package. The registry bundle supersedes it; remove the staging tree so the profile has
  // exactly one source for this plugin. (`removeLocalBundle` is idempotent.)
  if (!options.dryRun && existsSync(join(profileRoot, LOCAL_BUNDLE_DIR))) {
    if (removeLocalBundle(profileRoot)) {
      log(options, `[bundle] 已移除直接通道留下的本地暂存包：${join(profileRoot, LOCAL_BUNDLE_DIR)}（改用 registry 包）`);
    }
  }
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
    // A′ S4: report WHICH channel actually ended up in force. Printing "Done (direct)" for a profile
    // that is now a registered bundle would be exactly the kind of misleading summary this repo keeps
    // removing — and A1 ① promises `status` is the single truth about the current channel, so the
    // message must not contradict it.
    const bundled = bundleRegisteredIn(join(dshHome, "profiles", options.profile));
    if (bundled) {
      log(options, `Done (direct → local bundle). ${LOCAL_BUNDLE_PKG} is registered in "${options.profile}" and shows up in dsh's plugin manager. Start with:`);
      log(options, `  dsh --profile ${options.profile} --patch "${join(dshHome, "profiles", options.profile, "notes-assistant.patch.yml")}"`);
    } else {
      log(options, `Done (direct, flat). Local bundling was not used${options.flat ? " (--flat)" : ""} — this channel only flattens files, so it does NOT appear in dsh's plugin manager. Start with:`);
      log(options, `  dsh --profile ${options.profile} --patch "${join(dshHome, "profiles", options.profile, "notes-assistant.patch.yml")}"`);
    }
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

  // 1b. A′ S4/A6 ② (2026-09-26): the LOCAL STAGING package. `dsh plugin remove` above removes the
  //     registration and the `node_modules` entry, but it knows nothing about our staging directory —
  //     so without this the profile kept a full second copy of the package after "uninstall"
  //     (asymmetric, and it confuses every later reader of the tree).
  const stagingRoot = join(profileRoot, LOCAL_BUNDLE_DIR);
  if (existsSync(stagingRoot)) {
    if (localBundleInstalledIn(profileRoot) || options.force) {
      remove(options, stagingRoot, true);
    } else {
      log(options, `[keep] ${stagingRoot} does not look like a bundle we staged (no usable package.json) — leaving it.`);
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
  //    ⚠️ DELETE ONLY WHAT IS OURS TO DELETE (2026-09-26, extended 2026-10-01). `posture` is not a
  //    list of "ours, safe to delete":
  //      · SHARED files (`POSTURE_SHARED_FILES`) are written by dsh and by the user as well — on a
  //        `web` profile `cordis.patch.yml` holds the user's providers and default model, and
  //        `package.json` holds the bundles THEY added. Deleting either on our uninstall silently
  //        destroys configuration we never wrote, so they are kept unconditionally.
  //      · For the installer-owned rest, a file that no longer matches our record was hand-edited or
  //        clobbered, so it is left in place with a reason.
  const manifest = readMarker(join(profileRoot, CHANNEL_MANIFEST));
  if (manifest !== null && Array.isArray(manifest.posture)) {
    const digestCheck = verifyPostureDigests(profileRoot, manifest);
    const drifted = new Set(digestCheck.drifted);
    for (const rel of manifest.posture) {
      const path = join(profileRoot, rel);
      if (!existsSync(path)) continue;
      if (isPostureShared(rel)) {
        log(options, `[keep] ${path} 是你自己的 dsh 层（dsh 与设置页也会写它）——不删。`);
        continue;
      }
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
      // DERIVED FROM THE MANIFEST, not hand-written (M6, 2026-09-26).
      //
      // These used to be a second copy of `dsh/templates-manifest.json` — which AGENTS.md §3.2
      // forbids ("安装器与插件引导都按清单遍历，所以只需改清单、不要另加硬编码列表") — and they happened
      // to cover exactly that day's entries. So a NEW template would be seeded on install and then
      // silently SURVIVE `--purge-data`: "I deleted my memory" would be false, and nothing would fail.
      //
      // Now every template the manifest names is cleaned, minus the ones restored deliberately
      // (skeletons are `--purge`'s business). That covers a template added ANYWHERE, including a
      // future card layer — not just the ones someone remembered to list.
      const isSkeletonTarget = (rel) => rel.endsWith("index.md")
        || (rel.split("/").pop() ?? "").startsWith("_README");
      // Read the manifest here rather than reusing a variable from the block above: the two work on
      // different guarantees, and an implicit reliance on an outer name is exactly how this landed as
      // `rel.endsWith is not a function` on the first run (measured 2026-09-26).
      const templateTargets = Object.values(JSON.parse(readFileSync(MANIFEST_FILE, "utf8")))
        .filter((rel) => typeof rel === "string");
      const contentRel = templateTargets.filter((rel) => !isSkeletonTarget(rel));
      // Parent DIRECTORIES of every manifest target, plus the card layers a vault may hold beyond
      // what the manifest names (`archive` is never seeded, so it only ever holds user data).
      //
      // This is derived too, on purpose: my first attempt kept a hand-written `containers` list, and a
      // planted future layer's own directory survived the purge while its named file was deleted — the
      // exact half-deletion this defect is about (measured 2026-09-26). Taking the manifest's parent
      // dirs means a new layer cannot be missed.
      const containers = new Set([".deepseek/archive"]);
      for (const rel of templateTargets) {
        const parts = rel.split("/");
        parts.pop();
        if (parts.length > 0) containers.add(parts.join("/"));
      }
      for (const rel of contentRel) {
        const path = join(vault, ...rel.split("/"));
        if (!existsSync(path)) continue;
        // Recurse for directories (a card layer may hold nested files); ask the filesystem which it is
        // rather than maintaining a third list classifying them.
        remove(options, path, statSync(path).isDirectory());
      }
      for (const rel of containers) {
        const path = join(vault, ...rel.split("/"));
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
  // Fail LOUDLY on an unrecognised flag instead of silently doing something else. See parseArgs
  // for the `--native` incident this prevents.
  if (Array.isArray(options.unknown) && options.unknown.length > 0) {
    console.error(`dsh-math-memory: 无法识别的参数：${options.unknown.map((a) => `"${a}"`).join(', ')}`);
    console.error('是拼错了吗？看帮助：node dsh/install.mjs --help');
    process.exit(2);
  }
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
