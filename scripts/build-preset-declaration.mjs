/**
 * scripts/build-preset-declaration.mjs — regenerate the generated agent-preset
 * declaration blocks inside the two patch files that ship them:
 *
 *   dsh/cordis.patch.yml                    (npm bundle channel — SUBPATH form)
 *   dsh/profile/notes-assistant.patch.yml   (Obsidian `--patch` channel — ./ form)
 *
 * Between the markers below. Run it after touching
 * `dsh/preset/agent.cordis.yml` or `dsh/preset/preset.yml`.
 *
 * WHY THE TWO FORMS DIFFER
 * ------------------------
 * dsh resolves a preset's row names against the PROFILE DIRECTORY:
 *
 *   · The Obsidian overlay is copied into the profile directory and passed as
 *     `--patch`, and the plugin's bootstrap stages the preset body there before
 *     launching dsh ⇒ `name: ./math-memory.mjs` resolves.
 *   · A bundle row has no "before": the registry mounts the preset while the
 *     host row is still being imported, so a staged body is one boot too late
 *     (measured 2026-09-26: cold first boot = `broken: "math-memory
 *     (./math-memory.mjs): never started"`, second boot = fine). Naming the
 *     module as a SUBPATH OF THE INSTALLED PACKAGE
 *     (`dsh-math-memory/dsh/preset/math-memory.mjs`) needs nothing staged at all.
 *
 * Both forms come from the ONE composition; `--check` (registered as the gate
 * `check: preset declaration is current`) fails when either file drifts, and
 * `scripts/check-preset-body-lists.mjs` pins which form each file must carry.
 *
 *   node scripts/build-preset-declaration.mjs
 *   node scripts/build-preset-declaration.mjs --check   # verify only, exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPresetDeclarationBlock, DECLARATION_BEGIN, DECLARATION_END } from './lib/preset-declaration.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PRESET_ID = 'notes-assistant';

/** Where the generated block lives, in every file that carries it. */
const BEGIN_MARKER = DECLARATION_BEGIN;
const END_MARKER = DECLARATION_END;

/**
 * The package specifier prefix the bundle channel must use for preset modules.
 * Read from `package.json` so a rename cannot leave the declaration pointing at
 * a package that no longer exists (asserted by check-preset-body-lists.mjs).
 */
const PACKAGE_NAME = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
const LOCAL_PREFIX = `${PACKAGE_NAME}/dsh/preset`;

const TARGETS = [
  { rel: 'dsh/cordis.patch.yml', localPrefix: LOCAL_PREFIX },
  // The flat/offline channel's declaration belongs in the PROFILE'S OWN layer, NOT in the overlay
  // the plugin rewrites on every service start. Before 2026-09-26 it lived in
  // `dsh/profile/notes-assistant.patch.yml`, which `buildNotesAssistantPatch()` overwrites from the
  // plugin's embedded copy at every service start — so a plugin older than the profile erased the
  // declaration and EVERY reply failed (`agent-preset/not-found`, then the request-extension
  // outage). `cordis.patch.yml` is the profile's own layer: the installers write it only when it is
  // absent (the bootstrap likewise), and nothing rewrites it afterwards.
  //
  // The row names stay in `./` form either way: dsh resolves a preset's row names against the
  // PROFILE DIRECTORY, and this layer is applied from the profile directory too.
  { rel: 'dsh/profile/cordis.patch.yml', localPrefix: null }
];

/**
 * Homes a declaration must NOT linger in.
 *
 * Moving a declaration is not a copy: the SAME preset id declared in two applied layers is a hard
 * failure (`duplicate loader entry id`), so the old home has to be cleaned in the same pass — which
 * is also why this move cannot be split across two commits.
 */
const RETIRED_TARGETS = ['dsh/profile/notes-assistant.patch.yml'];

function readSources() {
  return {
    id: PRESET_ID,
    compositionText: readFileSync(join(root, 'dsh', 'preset', 'agent.cordis.yml'), 'utf8'),
    presetYmlText: readFileSync(join(root, 'dsh', 'preset', 'preset.yml'), 'utf8')
  };
}

/**
 * Replace the marker-delimited region, or append one when the file has none.
 * Returns the new text and whether anything actually changed.
 */
function withDeclarationBlock(text, block) {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(BEGIN_MARKER);
  const end = normalized.indexOf(END_MARKER);
  const wrapped = `${BEGIN_MARKER}\n${block}${END_MARKER}\n`;
  if (start >= 0 && end > start) {
    const updated = normalized.slice(0, start) + wrapped + normalized.slice(end + END_MARKER.length + 1);
    return { text: updated, changed: updated !== normalized };
  }
  const base = normalized.replace(/\s*$/, '');
  return { text: `${base}\n\n${wrapped}`, changed: true };
}

/**
 * Remove a marker-delimited declaration block, if present (idempotent).
 */
function withoutDeclarationBlock(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(BEGIN_MARKER);
  const end = normalized.indexOf(END_MARKER);
  if (start < 0 || end <= start) return { text: normalized, changed: false };
  const kept = (normalized.slice(0, start) + normalized.slice(end + END_MARKER.length + 1))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*$/, '\n');
  return { text: kept, changed: kept !== normalized };
}

const checkOnly = process.argv.includes('--check');
const sources = readSources();

let drifted = 0;
for (const { rel, localPrefix } of TARGETS) {
  const block = buildPresetDeclarationBlock({ ...sources, localPrefix });
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const { text } = withDeclarationBlock(before, block);
  const wanted = text.replace(/\r\n/g, '\n');
  const actual = before.replace(/\r\n/g, '\n');
  if (wanted === actual) {
    console.log(`preset-declaration: ${rel} is up to date (${localPrefix === null ? './ form' : `${localPrefix} form`})`);
    continue;
  }
  drifted += 1;
  if (checkOnly) {
    console.error(`preset-declaration: ${rel} is STALE — run: node scripts/build-preset-declaration.mjs`);
  } else {
    writeFileSync(path, wanted, 'utf8');
    console.log(`preset-declaration: updated ${rel}`);
  }
}

for (const rel of RETIRED_TARGETS) {
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const { text, changed } = withoutDeclarationBlock(before);
  if (!changed) {
    console.log(`preset-declaration: ${rel} carries no declaration (its home is the profile layer now)`);
    continue;
  }
  drifted += 1;
  if (checkOnly) {
    console.error(`preset-declaration: ${rel} still carries a declaration block — its home is dsh/profile/cordis.patch.yml now (two copies of one preset id is a hard failure)`);
  } else {
    writeFileSync(path, text, 'utf8');
    console.log(`preset-declaration: removed the retired declaration block from ${rel}`);
  }
}

if (checkOnly && drifted > 0) process.exit(1);
if (checkOnly) console.log('preset-declaration: ok (each channel declares the preset exactly once, in its own layer)');
