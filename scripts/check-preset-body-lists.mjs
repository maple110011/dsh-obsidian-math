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
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
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
const templateListMatch = /const DIRECT_PROFILE_FILES = \[([\s\S]*?)\];/.exec(template);
check('obsidian/main.template.js still declares DIRECT_PROFILE_FILES (the guard\'s anchor)',
  templateListMatch !== null, 'reformatting the array means updating this guard, not losing it');
if (templateListMatch !== null) {
  // Strip `//` comments BEFORE pulling quoted strings: the array's own comment
  // contains an apostrophe ("preset's modules live…"), which made a naive
  // /'([^']+)'/ scan swallow the two entries after it and report them missing.
  const body = templateListMatch[1].replace(/\/\/[^\n]*/g, '');
  const templateList = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missing = PRESET_BODY_FILES.filter((name) => !templateList.includes(name));
  check('obsidian/main.template.js DIRECT_PROFILE_FILES covers the body', missing.length === 0,
    missing.length === 0 ? `${templateList.length} entries` : `missing ${missing.join(', ')}`);
}
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

const overlayBlock = blockOf('dsh/profile/notes-assistant.patch.yml');
check('dsh/profile/notes-assistant.patch.yml still carries a generated declaration block', overlayBlock !== null);
if (overlayBlock !== null) {
  const relative = [...overlayBlock.matchAll(/^\s*name:\s*\.\/(\S+)\s*$/gm)].map((m) => m[1]);
  const stray = relative.filter((name) => !PRESET_BODY_FILES.includes(name));
  check('overlay channel keeps the RELATIVE form for the preset entry',
    relative.includes('math-memory.mjs'), relative.join(', '));
  check('every relative name inside the overlay block is a known body file', stray.length === 0, stray.join(', '));
  check('overlay channel does NOT reference the installed package for the preset body',
    !overlayBlock.includes(`${specifierPrefix}/`));
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
