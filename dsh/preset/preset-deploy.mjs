/**
 * dsh-math-memory — deploy the bundled `notes-assistant` agent preset body into
 * a PROFILE DIRECTORY, for the channels that cannot reach the package instead.
 *
 * WHY THIS MODULE EXISTS AT ALL (dsh >= 0.1.7)
 * -------------------------------------------
 * dsh 0.1.7 removed directory-based presets: `$DSH_HOME/.agent-presets/<id>/` is
 * no longer read by anything, and a preset is now an ordinary Cordis row
 * (`name: '@deepseek-ai/dsh-agent-preset'`) whose `config.plugins` holds the
 * preset's composition (`dsh-agent-preset/lib/index.js`, 29 lines).
 *
 * The registry anchors a preset's row names at the PROFILE DIRECTORY, so a row
 * written as `name: ./math-memory.mjs` only resolves if that file is physically
 * in `$DSH_HOME/profiles/<profile>/`. Whether that is the right shape depends on
 * the channel — see `scripts/lib/preset-declaration.mjs` for the full comparison:
 *
 *   · npm bundle channel: names the module as a SUBPATH OF THE INSTALLED PACKAGE
 *     (`dsh-math-memory/dsh/preset/math-memory.mjs`). Nothing to stage, and that
 *     is the point: a bundle row cannot stage files early enough on a cold first
 *     boot (the registry mounts the preset while the host row is still
 *     importing — measured 2026-09-26).
 *   · Obsidian bootstrap + `install --direct`: stage these files into the profile
 *     directory BEFORE dsh boots. That is what this module does.
 *
 * A module that fails to resolve does NOT raise `ERR_MODULE_NOT_FOUND` where
 * anyone can see it: the loader logs it and returns without creating a fiber, so
 * the preset audit only reports `math-memory (./math-memory.mjs): never started`
 * and `session/create` answers `agent-preset/invalid`, with nothing in the boot
 * log. Never diagnose this by error text.
 *
 * The declaration block itself is GENERATED (see `scripts/lib/preset-declaration.mjs`)
 * and shipped inside the patch files; this module is the runtime half that puts
 * the files on disk for the channels that need it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Profile name this package owns. */
export const PRESET_ID = 'notes-assistant';

/**
 * Files from `dsh/preset/` that a relative-form preset needs beside the profile's
 * patch layer. `preset.yml` / `agent.cordis.yml` are NOT copied: their content is
 * compiled into the generated declaration, so a stale copy could only mislead.
 *
 * THIS LIST IS NOW A RE-EXPORT (2026-09-26, B2): the single source of truth moved to
 * `dsh/preset/profile-contract.mjs`, so the CLI installer, the Obsidian bootstrap and the gates can
 * all point at ONE statement instead of three copies. The name is kept so the four existing import
 * sites stay untouched; `scripts/check-profile-contract.mjs` asserts this stays identical to the
 * contract, and `scripts/check-preset-body-lists.mjs` still asserts the contract equals the
 * relative-import closure of `dsh/preset/math-memory.mjs` — the 2026-09-26 `--direct` break was one
 * of those copies missing two names.
 */
import { PRESET_BODY_FILES } from './profile-contract.mjs';

export { PRESET_BODY_FILES };

/** `$DSH_HOME/profiles/<profile>` for an absolute `$DSH_HOME`. */
export function profileRootOf(home, profile = PRESET_ID) {
  return join(home, 'profiles', profile);
}

/**
 * Write the preset body into a profile directory.
 *
 * `force` semantics are gone on purpose: these are code files, not user
 * settings, and every release must land (the historical "preserve user edits"
 * default is exactly how a stale `agent.cordis.yml` survived a dsh upgrade and
 * kept every "new session" failing — see docs/handoff.md trap 70).
 *
 * @param {object} options
 * @param {string} options.home - `$DSH_HOME`.
 * @param {(name: string) => string|null} options.read - resolves a preset source
 *   file by basename (the npm package reads from disk, the Obsidian plugin from
 *   its embedded map).
 * @param {string} [options.profile] - profile name to deploy into.
 * @param {boolean} [options.dryRun] - plan only, write nothing.
 * @returns {{root: string, written: string[], planned: string[], dryRun: boolean}}
 */
export function deployPresetBody({ home, read, profile = PRESET_ID, dryRun = false }) {
  const root = profileRootOf(home, profile);
  const written = [];
  const planned = [];
  if (!dryRun) mkdirSync(root, { recursive: true });
  for (const name of PRESET_BODY_FILES) {
    const text = read(name);
    if (text === null || text === undefined) {
      throw new Error(`preset body file is unavailable: ${name}`);
    }
    planned.push(name);
    if (dryRun) continue;
    writeFileSync(join(root, name), text, 'utf8');
    written.push(name);
  }
  return { root, written, planned, dryRun };
}

/**
 * True when a directory already carries the deployed preset body. Used by
 * installers/`status` to distinguish "installed" from "you still have the
 * pre-0.1.7 layout, which dsh no longer reads".
 */
export function presetBodyDeployedIn(profileDir) {
  return PRESET_BODY_FILES.every((name) => existsSync(join(profileDir, name)));
}

/** {@link presetBodyDeployedIn} addressed by `$DSH_HOME` + profile name. */
export function presetBodyDeployed(home, profile = PRESET_ID) {
  return presetBodyDeployedIn(profileRootOf(home, profile));
}

/**
 * Filesystem-backed `read` for {@link deployPresetBody}: resolves a preset body
 * file from a package's `dsh/preset/` directory. The installer and the npm host
 * plugin use this; the Obsidian plugin passes its embedded map instead.
 */
export function presetReaderFromDir(dir) {
  return (name) => {
    try {
      return readFileSync(join(dir, name), 'utf8');
    } catch {
      return null;
    }
  };
}
