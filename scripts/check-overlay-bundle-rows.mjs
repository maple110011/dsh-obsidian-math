// S3 gate: the overlay state machine — when the PACKAGE is a registered bundle of the profile, the
// plugin-owned overlay must NOT also declare the rows that package already registers.
//
// WHY THIS IS A CORRECTNESS GATE AND NOT A TIDINESS ONE (2026-09-26)
// ------------------------------------------------------------------
// `dsh-math-memory`'s entry (`dsh/host/index.mjs`) registers `/memory-panel/*` AND auto-registers the
// vault workspace. The overlay's `math-memory-workspace` / `math-memory-panel` rows do the same two
// things. With both live, dsh refuses the WHOLE profile:
//
//     dsh: plugin tree failed to load: … duplicate prefix route "/memory-panel"
//
// i.e. the sidebar stops starting at all — the same class of outage as the 2026-09-21 duplicate-loader
// -id incident (trap 89). So the strip in `buildNotesAssistantPatch` is load-bearing, and this gate
// runs the SHIPPED functions out of the generated `main.js` (not a re-implementation) to prove:
//   · with no bundle  → the overlay is byte-identical to the embedded copy (nothing stripped);
//   · with the bundle → the two rows are gone, and everything else is unchanged;
//   · the `math-memory-client-panel` row SURVIVES in both cases (the client package is installed
//     separately and is not part of the bundle's patch — dropping it would silently kill drag-to-mention);
//   · the result still parses as YAML in both cases;
//   · missing/out-of-order markers FAIL SAFE (text returned unchanged) rather than half-stripping.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { load as yamlLoad } from 'js-yaml';

/**
 * !!js <expr> is dsh's own scalar tag, not standard YAML, so a plain load fails on a perfectly valid
 * file. Same treatment as check-patch-yaml.mjs: strip the tag, keep its value. Structure is what this
 * gate is about, and structure survives the substitution.
 */
const stripCustomTags = (source) => source.replace(/!!js(?![A-Za-z0-9_-])/gu, '');

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const repo = fileURLToPath(new URL('..', import.meta.url));

let failed = 0;
let total = 0;
const check = (name, condition, detail = '') => {
  total += 1;
  if (!condition) failed += 1;
  console.log(`${condition ? '[ok] ' : '[FAIL] '}${name}${detail === '' ? '' : ' | ' + detail}`);
};

/** The embedded preset map, scanned escape-aware (a regex mis-slices on the first `");`). */
function embeddedPresetMap() {
  const marker = 'const EMBEDDED_PRESET = JSON.parse("';
  const at = main.indexOf(marker);
  if (at < 0) throw new Error('cannot locate the embedded preset map in main.js');
  let i = at + marker.length;
  let out = '';
  while (i < main.length) {
    const ch = main[i];
    if (ch === '\\') { out += ch + main[i + 1]; i += 2; continue; }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return JSON.parse(JSON.parse('"' + out + '"'));
}

/** Slice a top-level `function NAME(` … matching `}` using a real parser (never hand-counted braces). */
function sliceFunction(src, name) {
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
  catch { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); }
  let node = null;
  const walk = (n) => {
    if (node !== null || !n || typeof n !== 'object') return;
    if (n.type === 'FunctionDeclaration' && n.id?.name === name) { node = n; return; }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const value = n[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object' && value.type) walk(value);
    }
  };
  walk(ast);
  if (node === null) throw new Error(`cannot find function ${name} in main.js`);
  return src.slice(node.start, node.end);
}

const EMBEDDED_PRESET = embeddedPresetMap();
const overlaySource = EMBEDDED_PRESET['profile-notes-assistant.patch.yml'];
check('the overlay is embedded in main.js', typeof overlaySource === 'string' && overlaySource.length > 0);

// The marker constants must be taken from the SHIPPED text, so a rename cannot pass this gate by
// being re-typed here.
const beginMatch = main.match(/const BUNDLE_ROWS_BEGIN = '([^']*)';/);
const endMatch = main.match(/const BUNDLE_ROWS_END = '([^']*)';/);
check('both marker constants are present in the shipped bundle',
  beginMatch !== null && endMatch !== null);
const BUNDLE_ROWS_BEGIN = beginMatch?.[1] ?? '';
const BUNDLE_ROWS_END = endMatch?.[1] ?? '';
check('the markers really appear in the embedded overlay (not just as constants)',
  overlaySource.includes(BUNDLE_ROWS_BEGIN) && overlaySource.includes(BUNDLE_ROWS_END));

// Build a harness out of the SHIPPED functions. `buildNotesAssistantPatch` also consults skin-center
// helpers, so those are stubbed to the "nothing installed" answer — they are a separate concern and
// are covered by their own gate. `profileBundles` is read from a temp profile dir we control.
const harness = new Function(
  'readFileSync', 'join', 'EMBEDDED_PRESET', 'BUNDLE_ROWS_BEGIN', 'BUNDLE_ROWS_END', 'bundles',
  [
    `const SKIN_CENTER_INSERT = '# skin-center (stub)';`,
    `function skinCenterMountable() { return false; }`,
    `function profileBundles() { return bundles; }`,
    sliceFunction(main, 'stripBundleOwnedRows'),
    sliceFunction(main, 'mathMemoryBundled'),
    sliceFunction(main, 'buildNotesAssistantPatch'),
    `return { buildNotesAssistantPatch, stripBundleOwnedRows };`
  ].join('\n')
);

const buildWith = (bundles) => harness(
  readFileSync, (...parts) => parts.join('/'), EMBEDDED_PRESET, BUNDLE_ROWS_BEGIN, BUNDLE_ROWS_END, bundles
).buildNotesAssistantPatch;

const withBundle = buildWith(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-math-memory'])({}, '/tmp/probe');
const withoutBundle = buildWith(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])({}, '/tmp/probe');

// ── 1. no bundle: nothing may change ────────────────────────────────────────────────────────────
check('with NO bundle registered the overlay is byte-identical to the embedded copy',
  withoutBundle === overlaySource,
  withoutBundle === overlaySource ? '' : `len ${withoutBundle.length} vs ${overlaySource.length}`);
check('...and it still declares the flat workspace + panel rows',
  withoutBundle.includes('name: ./math-memory-workspace.mjs')
  && withoutBundle.includes('name: ./math-memory-panel.mjs'));

// ── 2. bundle registered: the two package-owned rows must be gone ───────────────────────────────
check('with the bundle registered the flat workspace row is REMOVED',
  !withBundle.includes('name: ./math-memory-workspace.mjs'));
check('with the bundle registered the flat panel row is REMOVED',
  !withBundle.includes('name: ./math-memory-panel.mjs'));
check('...and the markers themselves are removed too (no dangling comments)',
  !withBundle.includes(BUNDLE_ROWS_BEGIN) && !withBundle.includes(BUNDLE_ROWS_END));

// ── 3. what must SURVIVE, because nothing else declares it ──────────────────────────────────────
check('the client-panel row SURVIVES (its package is installed separately, not by the bundle)',
  withBundle.includes("name: '@dsh-math-memory/client-ui-memory-panel'"),
  withBundle.includes('math-memory-client-panel') ? '' : 'ROW LOST — drag-to-mention would break');
check('...and it is still inside an `insert:` list',
  /- insert:/.test(withBundle) && withBundle.includes('math-memory-client-panel'));

// ── 4. both forms must remain valid YAML (a strip that breaks the document would kill the boot) ──
for (const [label, text] of [['without bundle', withoutBundle], ['with bundle', withBundle]]) {
  let parsed = null;
  let error = null;
  try { parsed = yamlLoad(stripCustomTags(text)); } catch (e) { error = e; }
  const rows = Array.isArray(parsed) ? parsed[0]?.insert : undefined;
  const ids = Array.isArray(rows) ? rows.map((r) => r?.id) : [];
  check(`the ${label} overlay parses as YAML`, error === null, String(error?.message ?? '').slice(0, 90));
  check(`the ${label} overlay yields exactly ONE root node with an insert list`,
    Array.isArray(parsed) && parsed.length === 1 && Array.isArray(rows), `nodes=${parsed?.length}`);
  if (label === 'with bundle') {
    check('...whose only remaining row is the client panel',
      ids.length === 1 && ids[0] === 'math-memory-client-panel', ids.join(', '));
  } else {
    check('...which lists all three rows in the flat case',
      ids.length === 3 && ids.includes('math-memory-workspace')
      && ids.includes('math-memory-panel') && ids.includes('math-memory-client-panel'),
      ids.join(', '));
  }
}

// ── 5. FAIL SAFE: a missing or inverted marker must not half-strip ──────────────────────────────
{
  const strip = harness(
    readFileSync, (...parts) => parts.join('/'), EMBEDDED_PRESET, BUNDLE_ROWS_BEGIN, BUNDLE_ROWS_END, []
  ).stripBundleOwnedRows;
  const noEnd = overlaySource.replace(BUNDLE_ROWS_END, '# marker misplaced');
  check('a missing END marker leaves the text UNCHANGED (fail safe, not half-stripped)',
    strip(noEnd) === noEnd);
  const noBegin = overlaySource.replace(BUNDLE_ROWS_BEGIN, '# marker misplaced');
  check('a missing BEGIN marker leaves the text UNCHANGED', strip(noBegin) === noBegin);
  const inverted = `${BUNDLE_ROWS_END}\nx\n${BUNDLE_ROWS_BEGIN}`;
  check('inverted markers leave the text UNCHANGED', strip(inverted) === inverted);
  check('a normal strip removes the block (control: the happy path still works)',
    !strip(overlaySource).includes(BUNDLE_ROWS_BEGIN));
}

// ── 6. the marker pair must be duplicated in the repo's overlay SOURCE too ──────────────────────
//
// `main.js` is generated; the marker also exists as literal YAML in the source overlay. If only one
// side is renamed, the embedded copy and the source file disagree and the failure shows up as "the
// strip silently stopped working" on the next rebuild.
{
  const source = readFileSync(`${repo}/dsh/profile/notes-assistant.patch.yml`, 'utf8');
  check('the repo overlay SOURCE carries the same marker pair (they are duplicated by design)',
    source.includes(BUNDLE_ROWS_BEGIN) && source.includes(BUNDLE_ROWS_END),
    'main.template.js cannot import, so the strings are duplicated — a rename must touch both');
  const parsed = yamlLoad(stripCustomTags(source));
  check('the repo overlay source parses as YAML', parsed !== null && parsed !== undefined);
}

console.log(failed === 0
  ? `\noverlay-bundle-rows: ok (${total}/${total} — the overlay drops exactly the rows the bundle owns)`
  : `\noverlay-bundle-rows: ${failed} FAILED of ${total}`);
process.exit(failed === 0 ? 0 : 1);
