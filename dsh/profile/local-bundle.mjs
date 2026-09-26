/**
 * local-bundle — materialize this plugin as a REAL dsh bundle package for the OFFLINE channels.
 *
 * WHY THIS EXISTS (A′ / decoupling step 3 — see `docs/bundle-channel-plan-2026-09-26.md`)
 * --------------------------------------------------------------------------------------
 * The offline channels (Obsidian bootstrap, `install --direct`) only FLATTENED files into the
 * profile: no `dsh.profile.bundles` entry, no `dependencies` entry, no package. dsh's plugin-manager
 * computes its candidate list as
 *
 *     names = dsh.profile.bundles ∪ profile.dependencies ∪ installation.dependencies
 *
 * and only shows a name that declares `dsh.bundle.patch` — so a flattened install is *invisible* in
 * dsh's 插件管理 page and cannot be enabled/disabled/removed there. That is a documented consequence
 * (`docs/installation.md`), and this module is how the offline channel stops having it.
 *
 * This module is PURE: no spawning, no network, no dsh, no filesystem layout assumptions beyond its
 * arguments. Whether to install the result, running `dsh plugin add`, and rewriting the profile
 * overlay belong to the callers (the plan's S3/S4).
 *
 * TWO CONSTRAINTS THAT LOOK COSMETIC AND ARE NOT
 * ----------------------------------------------
 * 1. **The tree mirrors the REPO layout under `dsh/`** (`dsh/host/…`, `dsh/preset/…`, `dsh/profile/…`)
 *    and must not be flattened: `dsh/host/index.mjs` imports `../profile/math-memory-workspace.mjs`,
 *    so flattening breaks that specifier at runtime — and dsh reports a module that fails to resolve
 *    only as `never started`, with nothing in the boot log (trap 93).
 * 2. **No hand-written file list.** Sources and their contents are INJECTED (`files` + `read`), the
 *    same shape as `preset-deploy.mjs`'s `deployPresetBody({ read })`. The list itself is assembled by
 *    the caller from the authorities that already exist — the host entry's relative-import closure
 *    (`collectDshImportClosure`) and the contract's `PRESET_BODY_FILES`. A list written here would be
 *    yet another copy of the same inventory (trap 96).
 *
 * The generated `package.json` is deliberately MINIMAL: no `scripts` (pnpm may try to run them, and
 * dsh's build-approval path then demands `allowBuilds`), no `devDependencies`. It keeps
 * `peerDependencies["@deepseek-ai/dsh"]` because that is the ONLY input to dsh's compatibility gate
 * (`evaluatePluginCompatibility`); `peerDependenciesMeta.optional` is added for the same reason as the
 * root manifest — dsh is a global CLI and cannot resolve from inside a profile.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Where the materialized package lives, relative to the profile directory. */
export const LOCAL_BUNDLE_DIR = '.dsh-math-memory';

/** The package name dsh will know it by (must equal the root `package.json` name). */
export const LOCAL_BUNDLE_PKG = 'dsh-math-memory';

/**
 * Package files that are NOT derivable from an import closure or the contract, each with its reason.
 * Everything else comes from the caller, so this stays the only hand-written part and is small enough
 * to audit — and a gate asserts these all exist.
 */
export const LOCAL_BUNDLE_EXTRA_FILES = [
  // dsh resolves the bundle's rows from this file; without it the package is not a bundle at all.
  'dsh/cordis.patch.yml',
  // `math-memory-panel.mjs`'s configScaffold() reads this template (falling back to a literal).
  'dsh/templates/config.md',
  // The plugin-management card needs all three, read by dsh's own readPluginMeta.
  'icon.svg',
  'locale/en.json',
  'locale/zh.json'
];

/** Absolute path of the materialized package for a profile directory. */
export function localBundleDirIn(profileDir) {
  return join(profileDir, LOCAL_BUNDLE_DIR);
}

/**
 * Assemble the full source list for a materialized bundle from the existing authorities.
 *
 * @param {object} options
 * @param {string} options.repoRoot - repository root.
 * @param {(entryRel: string, repoRoot: string) => string[]} options.collectClosure - the closure
 *   collector (`collectDshImportClosure`); injected so gates can point it elsewhere.
 * @param {string} [options.hostEntry] - host entry, repo-relative.
 * @param {string[]} options.presetBodyFiles - the contract's body-file basenames.
 * @returns {string[]} sorted, de-duplicated repo-relative paths.
 */
export function localBundleSourceFiles({
  repoRoot,
  collectClosure,
  hostEntry = 'dsh/host/index.mjs',
  presetBodyFiles
}) {
  // ⚠️ NORMALIZE SEPARATORS. `collectDshImportClosure` builds its paths with `path.join`, so on Windows
  // it returns `dsh\host\…` while the contract-derived names are `dsh/preset/…`. Mixing the two made the
  // de-duplication below fail (the same file appeared twice under two spellings) and produced a list
  // that would not match on another platform. Measured 2026-09-26: 18 entries where 12 are real.
  const norm = (rel) => rel.split('\\').join('/').replace(/^\.\//, '');
  const closure = collectClosure(hostEntry, repoRoot).map(norm);
  const fromContract = presetBodyFiles.map((name) => `dsh/preset/${norm(name)}`);
  return [...new Set([...closure, ...fromContract, ...LOCAL_BUNDLE_EXTRA_FILES.map(norm)])].sort();
}

/**
 * The `package.json` the materialized package carries.
 *
 * @param {object} meta - `{ name, version, description, dshEngine }`, all taken from the ROOT
 *   `package.json` by the caller, so this is never a second version/description source.
 * @returns {object} the manifest to write.
 */
export function localBundleManifest(meta) {
  const manifest = {
    name: meta.name,
    version: meta.version,
    type: 'module',
    main: './dsh/host/index.mjs',
    icon: 'icon.svg',
    dsh: { bundle: { patch: './dsh/cordis.patch.yml' } }
  };
  if (typeof meta.description === 'string' && meta.description !== '') {
    manifest.description = meta.description;
  }
  if (typeof meta.dshEngine === 'string' && meta.dshEngine !== '') {
    manifest.dsh.engines = { dsh: meta.dshEngine };
    manifest.peerDependencies = { '@deepseek-ai/dsh': meta.dshEngine };
    manifest.peerDependenciesMeta = { '@deepseek-ai/dsh': { optional: true } };
  }
  return manifest;
}

/**
 * Write the materialized bundle package into `<profileDir>/.dsh-math-memory/`.
 *
 * @param {object} options
 * @param {string} options.profileDir - profile directory to materialize into.
 * @param {string[]} options.files - repo-relative source paths (see {@link localBundleSourceFiles}).
 * @param {(rel: string) => string|null} options.read - resolves a repo-relative path to its content.
 * @param {object} options.meta - see {@link localBundleManifest}.
 * @param {boolean} [options.dryRun] - plan only, write nothing.
 * @returns {{root: string, written: string[], planned: string[], dryRun: boolean}}
 * @throws when a source file is unavailable — a package that silently lacks a module is precisely the
 *   failure this module exists to prevent.
 */
export function materializeLocalBundle({ profileDir, files, read, meta, dryRun = false }) {
  const root = localBundleDirIn(profileDir);
  const planned = [...files, 'package.json'];
  if (dryRun) return { root, written: [], planned, dryRun: true };

  const written = [];
  for (const rel of files) {
    const content = read(rel);
    if (content === null || content === undefined) {
      throw new Error(`local bundle: source unavailable: ${rel}`);
    }
    const target = join(root, ...rel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'binary');
    written.push(rel);
  }
  const manifestPath = join(root, 'package.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(localBundleManifest(meta), null, 2)}\n`, 'utf8');
  written.push('package.json');

  return { root, written, planned, dryRun: false };
}

/**
 * True when a profile already carries a USABLE materialized bundle.
 *
 * "Usable" is deliberately structural (trap 89): the manifest must be present, must declare the name
 * dsh looks for, and the patch file it points at must exist. A directory that merely exists is exactly
 * the half-state that yields "bundle registered, nothing mounted".
 *
 * @param {string} profileDir
 * @returns {boolean}
 */
export function localBundleInstalledIn(profileDir) {
  const root = localBundleDirIn(profileDir);
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) return false;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return false;
  }
  if (manifest === null || typeof manifest !== 'object') return false;
  if (manifest.name !== LOCAL_BUNDLE_PKG) return false;
  const patch = manifest.dsh?.bundle?.patch;
  if (typeof patch !== 'string' || patch === '') return false;
  return existsSync(join(root, ...patch.replace(/^\.\//, '').split('/')));
}

/**
 * Remove a materialized bundle. Idempotent.
 * @param {string} profileDir
 * @returns {boolean} true when something was removed.
 */
export function removeLocalBundle(profileDir) {
  const root = localBundleDirIn(profileDir);
  if (!existsSync(root)) return false;
  rmSync(root, { recursive: true, force: true });
  return true;
}

/**
 * The argv dsh needs to install this package into a profile.
 *
 * `file:` with an ABSOLUTE path is required: dsh resolves a `.`/`..` spec against the CALLER's cwd, and
 * the Obsidian process's cwd has nothing to do with the profile (plan §2.4).
 *
 * @param {{profileDir: string, profile: string}} options
 * @returns {string[]} args for the `dsh` executable.
 */
export function localBundleAddArgs({ profileDir, profile }) {
  const abs = localBundleDirIn(profileDir).replace(/\\/g, '/');
  return ['plugin', '--profile', profile, 'add', `file:${abs}`];
}

/**
 * Every file the materialized tree contains, profile-relative. Used by cleanup manifests and gates
 * (they should not each re-walk the tree).
 * @param {string} profileDir
 * @returns {string[]} sorted profile-relative paths.
 */
export function localBundleTreeFiles(profileDir) {
  const root = localBundleDirIn(profileDir);
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(relative(profileDir, full).split(sep).join('/'));
    }
  };
  if (!existsSync(root)) return found;
  walk(root);
  return found.sort();
}
