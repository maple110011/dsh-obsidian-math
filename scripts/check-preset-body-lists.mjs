/**
 * check-preset-body-lists — ONE file list for the agent-preset body, and every
 * channel that mentions it must agree.
 *
 * WHY THIS GUARD EXISTS (2026-09-26)
 * ----------------------------------
 * On dsh >= 0.1.7 the `notes-assistant` preset is a declared row, and the
 * modules its row names point at have to be reachable. That created the same
 * list in four places, and three of them were wrong at some point:
 *
 *   · `dsh/preset/preset-deploy.mjs`  PRESET_BODY_FILES      (authoritative)
 *   · `dsh/install.mjs`               DIRECT_PROFILE_FILES   (was MISSING two —
 *     the whole reason `install --direct` produced a profile where every
 *     `session/create` answered `agent-preset/invalid` while `npm test` stayed
 *     green: the installer gate asserted the RETIRED `.agent-presets/` layout)
 *   · `obsidian/main.template.js`     DIRECT_PROFILE_FILES + one `ensureFile`
 *     per file (the only copy that was right, so nothing caught the others)
 *   · the generated declaration's relative `name:` rows
 *   · the preset body's own relative imports (`math-memory.mjs` →
 *     `./note-tools.mjs` → `./hook-frontmatter.mjs`)
 *
 * The list is now derived from the relative-import CLOSURE of the preset entry,
 * and this guard asserts every other mention covers it. It also RUNS
 * `deployPresetBody` into a temp dir, so a broken export in that module cannot
 * hide behind "no caller" again (`presetBodyDeployed()` shipped with an
 * unimported `existsSync` and threw a ReferenceError if anyone called it).
 *
 * The two NAME FORMS are pinned too, because they are load-bearing and the
 * failure is silent: the npm bundle patch must reach the modules through the
 * installed package (`<pkg>/dsh/preset/…`), while the Obsidian/`--direct`
 * overlay keeps `./…` rows and the caller stages the files. See
 * `scripts/lib/preset-declaration.mjs` for the measurement behind that split.
 */
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PRESET_BODY_FILES,
  deployPresetBody,
  presetBodyDeployedIn,
  presetReaderFromDir
} from '../dsh/preset/preset-deploy.mjs';
import { DIRECT_PROFILE_FILES } from '../dsh/install.mjs';
import { collectDshImportClosure } from '../dsh/client-panel/install-into-profile.mjs';
// A′ (offline package-ization): the materialized bundle's source list is derived from the two
// authorities above, so this gate is where "did the derivation stay honest" belongs.
import { localBundleSourceFiles, localBundleManifest, LOCAL_BUNDLE_EXTRA_FILES } from '../dsh/profile/local-bundle.mjs';
import { DECLARATION_BEGIN, DECLARATION_END } from './lib/preset-declaration.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? '[ok] ' : '[FAIL] '}${name}${detail === '' ? '' : ` | ${detail}`}`);
};
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const pkgName = JSON.parse(read('package.json')).name;
const specifierPrefix = `${pkgName}/dsh/preset`;

// ── 1. the authoritative list IS the preset entry's import closure ──────────
const closure = collectDshImportClosure('dsh/preset/math-memory.mjs', root)
  .map((rel) => rel.replaceAll('\\', '/').replace(/^dsh\/preset\//, ''));
check('the preset body list equals the entry module\'s relative-import closure',
  sameSet(closure, PRESET_BODY_FILES),
  `closure=[${closure.join(', ')}] list=[${PRESET_BODY_FILES.join(', ')}]`);

// ── 1b. A′ (offline package-ization): the materialized bundle's list is DERIVED, and its only
// hand-written part is a short, auditable list of extras.
//
// Why this assertion has to exist before the module has a caller: the materialized package is the
// fifth consumer of this same inventory (deployer / CLI installer / Obsidian bootstrap / client-half
// closure / now the bundle). A module dropped from the materialized tree produces a package that
// installs, is listed in dsh's plugin manager, and then **silently mounts nothing** — dsh reports a
// module that fails to resolve only as `never started`, with nothing in the boot log (trap 93).
// Trap 95 is the sibling: an export nothing executes rots unnoticed, which is why this ran before S4.
{
  const bundleClosure = collectDshImportClosure('dsh/host/index.mjs', root).map((rel) => rel.replaceAll('\\', '/'));
  const derived = localBundleSourceFiles({ repoRoot: root, collectClosure: collectDshImportClosure, presetBodyFiles: PRESET_BODY_FILES });
  const expected = [...new Set([...bundleClosure, ...PRESET_BODY_FILES.map((n) => `dsh/preset/${n}`), ...LOCAL_BUNDLE_EXTRA_FILES])].sort();
  // ⚠️ Compare as SETS, not with `sameSet`. `sameSet` is duplicate-TOLERANT (`a.length === b.length &&
  // every(x => b.includes(x))`), so an entry listed twice in the same array satisfies it. Measured
  // 2026-09-26: a deliberately duplicated extra ("dsh/host/index.mjs" appended to the extras) PASSED
  // this assertion until the comparison was switched to sets. `sameSet` remains fine for the older
  // assertions — those compare a list with itself-derived forms — but a list whose whole point is
  // "derived and de-duplicated" needs a comparison that can see a duplicate.
  const derivedSet = new Set(derived);
  const expectedSet = new Set(expected);
  const sameAsSets = derivedSet.size === expectedSet.size && [...expectedSet].every((x) => derivedSet.has(x));
  check('the local bundle\'s source list == host entry closure ∪ preset body ∪ declared extras (as SETS: duplicates fail)',
    sameAsSets,
    `derived=${derived.length} (unique ${derivedSet.size}) expected=${expected.length} (unique ${expectedSet.size})`);
  check('the local bundle\'s source list contains no duplicate entry',
    derived.length === derivedSet.size,
    `${derived.length} entries, ${derivedSet.size} unique`);
  // Every EXTRA must be a real file: this list is the only hand-written part, so a typo here would ship
  // a package missing a card asset or the bundle patch itself.
  const missingExtra = LOCAL_BUNDLE_EXTRA_FILES.filter((rel) => !existsSync(join(root, ...rel.split('/'))));
  check('every declared local-bundle extra file exists on disk', missingExtra.length === 0, missingExtra.join(', '));
  // And the extras must not be doing work the closure/contract already covers — that would be the
  // "second list" smell this repo keeps deleting.
  const redundant = LOCAL_BUNDLE_EXTRA_FILES.filter((rel) => bundleClosure.includes(rel) || PRESET_BODY_FILES.includes(rel.replace(/^dsh\/preset\//, '')));
  check('no declared extra duplicates the closure or the contract', redundant.length === 0, redundant.join(', '));

  // The assertion above compares two things derived from the SAME call, so it is true by construction
  // and cannot notice a needed file being dropped from the extras (measured: removing `icon.svg`
  // passed). What actually matters is that the MANIFEST this module GENERATES only points at files the
  // list carries — because the generated `package.json` is what dsh reads:
  //   · `icon`          — the plugin-management card silently keeps the default artwork without it;
  //   · `dsh.bundle.patch` — without the patch file the package is not a bundle and never appears.
  const manifest = localBundleManifest({ name: 'dsh-math-memory', version: '0.0.0', description: 'x', dshEngine: '>=0.0.0' });
  for (const [field, rel] of [['icon', manifest.icon], ['dsh.bundle.patch', manifest.dsh?.bundle?.patch]]) {
    const clean = String(rel ?? '').replace(/^\.\//, '');
    check(`the generated bundle manifest's \`${field}\` is carried by the source list`,
      clean !== '' && derived.includes(clean), `${field}=${rel} present=${derived.includes(clean)}`);
  }
  // `main` must also be carried, or dsh loads the bundle row and finds no module.
  const mainRel = String(manifest.main ?? '').replace(/^\.\//, '');
  check('the generated bundle manifest\'s `main` entry is carried by the source list',
    mainRel !== '' && derived.includes(mainRel), `main=${manifest.main} present=${derived.includes(mainRel)}`);
}

// ── 2. the deployer actually works (a dead export cannot hide here) ────────
const tmp = mkdtempSync(join(tmpdir(), 'preset-body-lists-'));
try {
  const res = deployPresetBody({ home: tmp, read: presetReaderFromDir(join(root, 'dsh', 'preset')) });
  check('deployPresetBody writes every body file', sameSet(res.written, PRESET_BODY_FILES), res.written.join(','));
  check('deployPresetBody targets <home>/profiles/<id>', res.root === join(tmp, 'profiles', 'notes-assistant'), res.root);
  check('presetBodyDeployedIn sees the deployed body', presetBodyDeployedIn(res.root));
  const empty = join(tmp, 'empty');
  mkdirSync(empty);
  check('presetBodyDeployedIn is false for a directory without the body', !presetBodyDeployedIn(empty));
  const dry = deployPresetBody({
    home: join(tmp, 'dry'),
    read: presetReaderFromDir(join(root, 'dsh', 'preset')),
    dryRun: true
  });
  check('dryRun plans the same files and writes none',
    sameSet(dry.planned, PRESET_BODY_FILES) && dry.written.length === 0
    && !presetBodyDeployedIn(dry.root));
} catch (error) {
  check('deployPresetBody is callable and does not throw', false, String(error?.message ?? error));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 3. every other list covers it ──────────────────────────────────────────
const missingFromInstaller = PRESET_BODY_FILES.filter((name) => !DIRECT_PROFILE_FILES.includes(name));
check('dsh/install.mjs DIRECT_PROFILE_FILES covers the body', missingFromInstaller.length === 0,
  missingFromInstaller.length === 0 ? `${DIRECT_PROFILE_FILES.length} entries` : `missing ${missingFromInstaller.join(', ')}`);

const template = read('obsidian/main.template.js');
// 2026-09-26 (A′): the template no longer holds a list at all — it derives it from the contract that
// `scripts/build-obsidian.mjs` injects through `__PROFILE_CONTRACT_JSON__`. So this gate now proves the
// DERIVATION exists (a hand-written list cannot come back without this going red); that the generated
// bundle carries exactly the current contract, byte for byte, is proved by
// `scripts/check-profile-contract.mjs` READ-2b.
const derivesFromContract = /const DIRECT_PROFILE_FILES = \[\.\.\.PROFILE_CONTRACT\.presetBodyFiles/.test(template);
check('obsidian/main.template.js derives DIRECT_PROFILE_FILES from the injected contract (no hand-written list)',
  template.includes('JSON.parse("__PROFILE_CONTRACT_JSON__")') && derivesFromContract,
  'reformatting the derivation means updating this guard, not losing it');
const ensureNames = new Set([...template.matchAll(/ensureFile\(join\(profileRoot, '([^']+)'\)/g)].map((m) => m[1]));
const notWritten = PRESET_BODY_FILES.filter((name) => !ensureNames.has(name));
check('obsidian/main.template.js writes every body file into the profile dir', notWritten.length === 0,
  notWritten.length === 0 ? `${ensureNames.size} ensureFile targets` : `never written: ${notWritten.join(', ')}`);

// ── 4. each channel carries the RIGHT name form ────────────────────────────
/** The generated block of a patch file, or null when the markers are gone. */
function blockOf(rel) {
  const text = read(rel);
  const start = text.indexOf(DECLARATION_BEGIN);
  const end = text.indexOf(DECLARATION_END);
  return start >= 0 && end > start ? text.slice(start, end) : null;
}

const bundleBlock = blockOf('dsh/cordis.patch.yml');
check('dsh/cordis.patch.yml still carries a generated declaration block', bundleBlock !== null);
if (bundleBlock !== null) {
  check('bundle channel reaches the preset entry through the INSTALLED PACKAGE',
    bundleBlock.includes(`name: ${specifierPrefix}/math-memory.mjs`), specifierPrefix);
  const relativeInBundle = [...bundleBlock.matchAll(/^\s*name:\s*\.\/(\S+)\s*$/gm)].map((m) => m[1]);
  check('bundle channel carries NO relative preset row (it cannot be staged in time)',
    relativeInBundle.length === 0, relativeInBundle.join(', '));
  const stray = relativeInBundle.filter((name) => !PRESET_BODY_FILES.includes(name));
  check('every relative name inside the bundle block is a known body file', stray.length === 0, stray.join(', '));
}

// ── 4b. the flat channel's declaration home (moved 2026-09-26, B3) ─────────
//
// It used to sit in `notes-assistant.patch.yml` — the overlay the plugin REWRITES from its embedded
// copy at every service start — so a plugin older than the profile erased it and every reply failed.
// It now lives in the profile's own `cordis.patch.yml`, which nothing rewrites. TWO assertions, and
// both matter: the new home must carry it, and the old home must NOT (the same preset id in two
// applied layers is a hard failure: `duplicate loader entry id`).
const profileLayerBlock = blockOf('dsh/profile/cordis.patch.yml');
check("dsh/profile/cordis.patch.yml carries the generated declaration block (the profile's own layer)",
  profileLayerBlock !== null);
check('dsh/profile/notes-assistant.patch.yml carries NO declaration any more (its home moved)',
  blockOf('dsh/profile/notes-assistant.patch.yml') === null);
if (profileLayerBlock !== null) {
  const relative = [...profileLayerBlock.matchAll(/^\s*name:\s*\.\/(\S+)\s*$/gm)].map((m) => m[1]);
  const stray = relative.filter((name) => !PRESET_BODY_FILES.includes(name));
  check('the flat channel keeps the RELATIVE form for the preset entry',
    relative.includes('math-memory.mjs'), relative.join(', '));
  check('every relative name inside the profile-layer block is a known body file', stray.length === 0, stray.join(', '));
  check('the flat channel does NOT reference the installed package for the preset body',
    !profileLayerBlock.includes(`${specifierPrefix}/`));
}

// ── 5. the composition's own relative rows are body files ──────────────────
const composition = read('dsh/preset/agent.cordis.yml');
const compositionRelative = [...composition.matchAll(/^\s*name:\s*\.\/(\S+)\s*$/gm)].map((m) => m[1]);
const compositionStray = compositionRelative.filter((name) => !PRESET_BODY_FILES.includes(name));
check('every relative row in agent.cordis.yml is a known body file', compositionStray.length === 0,
  compositionRelative.join(', ') || '(none)');

if (failed > 0) {
  console.log('\nPreset body lists disagree. The authoritative list is PRESET_BODY_FILES in');
  console.log('dsh/preset/preset-deploy.mjs; regenerate declarations with');
  console.log('`node scripts/build-preset-declaration.mjs`.');
  process.exit(1);
}
console.log('preset-body-lists: ok (closure == list, deployer runs, 3 channels agree, both name forms pinned)');
