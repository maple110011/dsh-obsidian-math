// Execute the Obsidian plugin's REAL `bootstrapDshConfig` — the self-heal path that runs on every
// service start — against an EMPTY `$DSH_HOME` and against a wiped profile.
//
// WHY THIS GATE EXISTS (2026-09-26)
// ---------------------------------
// The user's `$DSH_HOME` was destroyed four times during field work (`docs/handoff.md` trap 56/59:
// the shared home is what the field tests consume, and once it was gone "the deployed profile" the
// other gates started from was gone with it). The plugin is expected to rebuild the profile from its
// embedded copy on the next start — but until now **nothing executed that function**. Every existing
// guard covered a different half:
//   · `check-embedded-writers.mjs` evaluates the embedded `memory-admin.mjs`, not the bootstrap;
//   · `check-profile-contract.mjs` asserts the WRITE LIST is derived, not that the writes happen;
//   · `test: self-provisioned profile accepts a session` provisions a profile ITSELF, bypassing the
//     plugin's bootstrap entirely.
// So "the plugin recovers after a wipe" was an assumption. This gate turns it into a measurement, by
// extracting the shipped function out of the generated `main.js` (so the code that SHIPS is what runs,
// not a copy) and calling it.
//
// Scope honesty: this asserts the bootstrap WRITES a complete, self-consistent profile from nothing.
// It does NOT start dsh on the result — `test: self-provisioned profile accepts a session` owns
// "does a bundle-shaped profile cold-start", and `test-installer` owns the CLI's flat shape.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as acorn from 'acorn';
import { collectDshImportClosure } from '../dsh/client-panel/install-into-profile.mjs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

const main = readFileSync('main.js', 'utf8');

let failed = 0;
let total = 0;
const check = (name, condition, detail = '') => {
  total += 1;
  if (!condition) failed += 1;
  console.log((condition ? '[ok] ' : '[FAIL] ') + name + (detail === '' ? '' : ' | ' + detail));
};

// ── extract the embedded preset map (same technique as check-embedded-writers.mjs) ──────────────
function embeddedJsonLiteral(marker) {
  const at = main.indexOf(marker);
  if (at < 0) throw new Error(`cannot locate ${marker.trim()} in main.js`);
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
const embeddedPresetMap = () => embeddedJsonLiteral('const EMBEDDED_PRESET = JSON.parse("');
const EMBEDDED_PRESET = embeddedPresetMap();
// A′ S4 (Obsidian half): the two-part local-bundle plan. Read from the bundle, never re-derived here,
// so this gate exercises the SAME bytes the plugin ships.
const BUNDLE_PLAN = embeddedJsonLiteral('const EMBEDDED_BUNDLE_PAYLOAD = JSON.parse("');

/**
 * Slice a top-level `function NAME(…)` out of a source text, using a REAL PARSER.
 *
 * The first version of this counter counted braces by hand and got `ensureProfileDeclaration` wrong
 * (18471 chars / 411 lines instead of 2088 / 41 — a mis-slice that produced `Unexpected token ')'`).
 * A brace counter has to re-implement string, template-literal, comment AND regex handling; the
 * template code contains all four, and a wrong slice here means this gate would test a corrupted copy
 * instead of the shipped function. `acorn` is already a devDependency (used by the size measurement),
 * and its node offsets are exact. Trap 82's lesson: do not hand-roll a parser.
 */
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

// ── rebuild the loader scope the template uses ──────────────────────────────────────────────────
const PRESET_NAME = 'notes-assistant';
// ── extract the injected profile contract ───────────────────────────────────────────────────────
//
// `main.js` carries it as a DOUBLE-escaped JS string literal (`JSON.parse("{\"presetBodyFiles\":…}")`,
// the same shape as the embedded preset map), so the raw literal must be unescaped once before it can
// be parsed. Scanning for the closing quote by regex is wrong for exactly that reason — the literal is
// full of `\"`. Scan it escape-aware, like `embeddedPresetMap()` does.
function embeddedContractText() {
  const marker = 'const PROFILE_CONTRACT = JSON.parse("';
  const at = main.indexOf(marker);
  if (at < 0) throw new Error('cannot locate the injected profile contract in main.js');
  let i = at + marker.length;
  let out = '';
  while (i < main.length) {
    const ch = main[i];
    if (ch === '\\') { out += ch + main[i + 1]; i += 2; continue; }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  // The build injects the contract as JSON TEXT, and the template puts that text inside a JS string
  // literal — so the raw literal carries one extra level of backslashes (`{\"presetBodyFiles\":…}`).
  // Undo exactly that one JS level with `JSON.parse` on a quoted copy, then the result is the JSON
  // TEXT to parse. (Two stages, mirroring `embeddedPresetMap()`; a single `JSON.parse` fails with
  // `Expected property name or '}'` because it sees the backslashes.)
  return JSON.parse('"' + out + '"');
}
const CONTRACT_JSON = embeddedContractText();
const buildNotesAssistantPatch = sliceFunction(main, 'buildNotesAssistantPatch');
const stripBundleOwnedRows = sliceFunction(main, 'stripBundleOwnedRows');
const writeNotesAssistantPatch = sliceFunction(main, 'writeNotesAssistantPatch');
const ensureProfileDeclaration = sliceFunction(main, 'ensureProfileDeclaration');
const repairProfileManifestFile = sliceFunction(main, 'repairProfileManifestFile');
const bootstrapDshConfig = sliceFunction(main, 'bootstrapDshConfig');
// A′ S4 (Obsidian half): the three helpers the bootstrap's bundle attempt calls. Sliced (not
// re-implemented) for the same reason as everything else here — this gate must exercise the SHIPPED
// code, and a local re-implementation would happily agree with itself.
const localBundleFiles = sliceFunction(main, 'localBundleFiles');
const localBundleRead = sliceFunction(main, 'localBundleRead');
const localBundleManifestText = sliceFunction(main, 'localBundleManifestText');
const bundleRegisteredIn = sliceFunction(main, 'bundleRegisteredIn');

// ⚠️ The body is built by CONCATENATION, not as one template literal: the extracted functions contain
// backticks and `${` of their own (12 and 44+2 respectively, measured), which would terminate a
// template literal and produce `missing ) after argument list`. String concatenation has no such
// interaction with the injected source.
const HARNESS_PRELUDE = [
  'function ensureFile(target, content, overwrite = false) {',
  '  if (!overwrite && existsSync(target)) return false;',
  '  mkdirSync(dirname(target), { recursive: true });',
  "  writeFileSync(target, content, 'utf8');",
  '  return true;',
  '}',
  'function postureDigestsOf(profileRoot, files) {',
  // Must mirror the template's `postureDigestsOf` exactly: shared posture files (dsh and the user write
  // them too) are deliberately NOT hash-frozen, and the list comes from the contract, not a second
  // hand-written copy. `scripts/check-profile-contract.mjs` PINNED-7 compares the two implementations
  // behaviourally on the same fixture.
  '  const shared = PROFILE_CONTRACT.postureSharedFiles ?? [];',
  '  const out = {};',
  '  for (const name of files) {',
  '    if (shared.includes(name)) continue;',
  '    const p = join(profileRoot, name);',
  '    if (!existsSync(p)) continue;',
  "    out[name] = createHash('sha256').update(readFileSync(p)).digest('hex');",
  '  }',
  '  return out;',
  '}',
  'const PROFILE_CONTRACT = JSON.parse(PROFILE_CONTRACT_JSON);',
  'const DIRECT_PROFILE_FILES = [...PROFILE_CONTRACT.presetBodyFiles, ...PROFILE_CONTRACT.profileScaffoldFiles]',
  '  .filter((name, index, all) => all.indexOf(name) === index);',
  "const OWNER_MARKER = '.owner.json';",
  "const INSTALL_MANIFEST = '.install-manifest.json';",
  "const OWNER_CHANNEL = 'direct';",
  'function readOwnerMarker(path) {',
  "  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }",
  '}',
  '// STUB, deliberately. The real `skinCenterMountable` chains into skin-center detection',
  '// (`skinCenterInstalled` / `skinCenterBundled` / `packagesPresent`) — an OPTIONAL third-party skin',
  '// package this gate does not test. It only decides whether the notes-assistant overlay ALSO mirrors',
  '// @linxin666 packages; it does not touch any file this gate asserts on (the call site in',
  '// main.template.js treats that block as purely additive). On a WIPED home the real function returns',
  '// false as well (nothing is installed), so `false` is the faithful value here, not a convenient one.',
  '// If recovery ever starts depending on it, the file-set assertions below stop being sufficient —',
  '// hence this note.',
  'function skinCenterMountable() { return false; }',
  '// Same reasoning: on a home where nothing is installed, `readGlobalSkinIds` finds no ids and the',
  '// real function returns the empty string (main.template.js:1766-1771). Stubbed to that value so the',
  '// skin-center surface (`readGlobalSkinIds`, `SKIN_FALLBACK_*`) is not re-implemented here.',
  "function buildSkinFallbackBlock() { return ''; }",
  '// S3 (2026-09-26): the overlay composition now asks whether this profile registers our package as a',
  '// bundle, so the bootstrap reaches `mathMemoryBundled` -> `profileBundles`. Both are pure filesystem',
  '// reads of `<profile>/package.json`; on a WIPED home there is no package.json at all, so the honest',
  '// value is "not bundled" (flat channel) — which is exactly what the real pair returns here. Kept as',
  '// the real read rather than a constant so this harness still follows the shipped logic.',
  'function profileBundles(home) {',
  "  try {",
  "    const parsed = JSON.parse(readFileSync(join(home, 'profiles', PRESET_NAME, 'package.json'), 'utf8'));",
  '    const bundles = parsed?.dsh?.profile?.bundles;',
  '    return Array.isArray(bundles) ? bundles : [];',
  '  } catch {',
  '    return [];',
  '  }',
  '}',
  "function mathMemoryBundled(home) { return profileBundles(home).includes('dsh-math-memory'); }",
  // S3's overlay strip. `writeNotesAssistantPatch` -> `buildNotesAssistantPatch` -> this, so the
  // bootstrap cannot complete without it. Sliced from the shipped bundle rather than re-implemented —
  // a copy here could agree with itself while the real one drifted.
  stripBundleOwnedRows,
  "const BUNDLE_ROWS_BEGIN = '# >>> bundle-owned rows (see buildNotesAssistantPatch) >>>';",
  "const BUNDLE_ROWS_END = '# <<< bundle-owned rows <<<';"
].join('\n');

const harness = new Function(
  'existsSync', 'mkdirSync', 'writeFileSync', 'readFileSync', 'createHash', 'join', 'dirname',
  'EMBEDDED_PRESET', 'PRESET_NAME', 'PROFILE_CONTRACT_JSON',
  // A′ S4 (Obsidian half): the bootstrap now also tries to materialize + register a REAL local bundle,
  // so its scope reaches `spawnSync`, `rmSync`, `dirname` and the injected payload plan. They must be
  // provided here for the same reason as the rest: this harness runs the SHIPPED function, not a copy.
  'spawnSync', 'process', 'EMBEDDED_BUNDLE_PAYLOAD',
  [
    HARNESS_PRELUDE,
    buildNotesAssistantPatch,
    writeNotesAssistantPatch,
    ensureProfileDeclaration,
    repairProfileManifestFile,
    // The constants the bundle attempt reads (they live at template scope, outside the sliced functions).
    "const LOCAL_BUNDLE_DIR = '.dsh-math-memory';",
    "const LOCAL_BUNDLE_PKG = 'dsh-math-memory';",
    "const LOCAL_BUNDLE_ENTRY = 'dsh/host/index.mjs';",
    localBundleRead,
    localBundleFiles,
    localBundleManifestText,
    bundleRegisteredIn,
    bootstrapDshConfig,
    'return { bootstrapDshConfig, DIRECT_PROFILE_FILES, localBundleFiles, localBundleRead, bundleRegisteredIn };'
  ].join('\n')
);
// `shipped*` names: the module already binds `localBundleClosure` etc. to the EXTRACTED source text,
// so re-using those names here would shadow them (SyntaxError: already declared).
const {
  bootstrapDshConfig: bootstrap,
  DIRECT_PROFILE_FILES,
  localBundleFiles: shippedBundleFiles,
  localBundleRead: shippedBundleRead,
  bundleRegisteredIn: shippedBundleRegisteredIn
} = harness(
  existsSync, mkdirSync, writeFileSync, readFileSync, createHash, join, dirname,
  EMBEDDED_PRESET, PRESET_NAME, CONTRACT_JSON,
  spawnSync, process, BUNDLE_PLAN
);
check('the shipped bootstrap was extracted and is callable', typeof bootstrap === 'function');
// ── The materializer must agree with the SHIPPED module (A′ S4, Obsidian half) ────────────────────
//
// The template cannot `import` (it is evaluated with `new Function`), so it carries its own copy of the
// package plan. Two implementations of one rule is exactly how this repo has been burned before, so the
// agreement is asserted over the REAL injected plan rather than spot-checked.
{
  const plan = shippedBundleFiles();
  const shippedClosure = collectDshImportClosure('dsh/host/index.mjs', process.cwd()).map((r) => r.split('\\').join('/'));
  // ASSERT THE TRAP DIRECTLY (found by this gate's own first run, 2026-09-26): the plan must be the
  // LIST, not just the import closure. When it was the closure, the seven files nothing imports —
  // `dsh/cordis.patch.yml` above all — were silently absent, and `dsh plugin add` failed with
  // "failed to read overlay …/dsh/cordis.patch.yml: ENOENT" and rolled the install back.
  check('the plan contains files that no module imports (the ones an import-walk would drop)',
    plan.some((rel) => !shippedClosure.includes(rel)),
    `${plan.length} planned vs ${shippedClosure.length} imported`);
  check('...specifically the bundle patch dsh reads at install time',
    plan.includes('dsh/cordis.patch.yml'));
  check('every planned file has bytes the plugin can supply',
    plan.every((rel) => { try { return typeof shippedBundleRead(rel) === 'string' && shippedBundleRead(rel) !== ''; } catch { return false; } }),
    plan.filter((rel) => { try { return typeof shippedBundleRead(rel) !== 'string'; } catch { return true; } }).join(', ') || 'all supplied');
  check('the plan covers the shipped import closure (nothing it imports is unplanned)',
    shippedClosure.every((rel) => plan.includes(rel)),
    shippedClosure.filter((rel) => !plan.includes(rel)).join(', ') || 'complete');
  // The two files that exist under BOTH dsh/host/ and dsh/preset/ are why the plan is split in two.
  // Pin that they resolve to the SHIM (host) and the CANONICAL file (preset), not one file twice.
  check('the colliding basenames resolve to the host shim and the preset original, not one file twice',
    shippedBundleRead('dsh/host/hook-frontmatter.mjs') !== shippedBundleRead('dsh/preset/hook-frontmatter.mjs')
    && shippedBundleRead('dsh/host/engine-shared.mjs') !== shippedBundleRead('dsh/preset/engine-shared.mjs'));
}

check('the extracted write list matches the injected contract (the single source)',
  DIRECT_PROFILE_FILES.length === new Set(DIRECT_PROFILE_FILES).size && DIRECT_PROFILE_FILES.length > 8,
  `${DIRECT_PROFILE_FILES.length} names`);

// The opt-out is a DOCUMENTED user-facing feature (both CHANGELOG.md and
// docs/user-visible-changes-2026-09-26.md tell the user to turn it off in the settings). A setting that
// is READ but never DECLARED has no default and no UI: it silently does nothing and the documentation
// quietly becomes false — which is exactly the state this assertion was written to catch (2026-09-26,
// the toggle was documented before it existed). No other gate touches the settings surface.
check('the bundle opt-out is declared in DEFAULT_SETTINGS (so it has a default and persists)',
  /^\s*bundleInstall:\s*(?:true|false),/mu.test(main), 'bundleInstall missing from DEFAULT_SETTINGS');
check('...and a settings toggle actually writes it (the documented way to reach it)',
  /settings\.bundleInstall\s*!==\s*false\)\.onChange/u.test(main) && /settings\.bundleInstall\s*=\s*value/u.test(main),
  'no settings toggle writes settings.bundleInstall');

/**
 * A plugin stand-in.
 *
 * `bundleInstall: false` is the DEFAULT here (A′ S4, 2026-09-26): this gate is about the FLAT recovery
 * path — "does the plugin rebuild a wiped `$DSH_HOME` from its embedded copy" — and on a machine that
 * happens to have dsh + pnpm the bootstrap would otherwise bundle instead and change every assertion
 * below into a statement about the other channel. The bundle route has its own case further down.
 * (The CLI's tests make the same split with `--flat`.)
 */
const fakePlugin = (home, version = '0.7.8', settings = { bundleInstall: false }) => ({
  service: { location: () => ({ home }) },
  manifest: { version },
  settings
});

// ── 1. the wipe itself: NOTHING exists under $DSH_HOME ─────────────────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'wipe-empty-'));
  rmSync(home, { recursive: true, force: true }); // genuinely absent, as after a wipe
  try {
    const res = bootstrap(fakePlugin(home), false);
    check('an ABSENT $DSH_HOME is recovered (no throw)', res.home === home, res.home);
    // ── The plugin MANAGER honesty contract (2026-09-26) ─────────────────────────────────────────
    //
    // This bootstrap writes the flat layout, which dsh's plugin page cannot list. A user looking for
    // their plugin naturally looks there, so the bootstrap must SAY that and point at the alternative
    // — instead of leaving them to conclude the install failed. Asserted here (rather than only in a
    // doc) because it is a user-visible promise that is easy to delete by accident.
    check('bootstrap reports whether this profile registers the package as a bundle',
      res.bundled === false, `bundled=${res.bundled}`);
    check('bootstrap says the flat layout will NOT appear in dsh\'s plugin page',
      typeof res.notice === 'string' && /不会出现在 dsh 的「插件」页/.test(res.notice),
      String(res.notice).slice(0, 80));
    check('...and it gives the REASON it fell back, rather than a silent success',
      typeof res.bundleReason === 'string' && res.bundleReason !== '', String(res.bundleReason));
    check('...and it names the alternative that DOES make it visible',
      typeof res.notice === 'string' && /install --direct/.test(res.notice));
    const profileRoot = join(home, 'profiles', PRESET_NAME);
    const missing = DIRECT_PROFILE_FILES.filter((n) => !existsSync(join(profileRoot, n)));
    check('every contracted profile file exists after recovery from nothing',
      missing.length === 0, missing.join(', ') || 'none missing');
    const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
    check('the recovery manifest records owner "direct"', manifest.owner === 'direct', String(manifest.owner));
    check('the recovery manifest lists the files it claims',
      Array.isArray(manifest.posture) && manifest.posture.length === DIRECT_PROFILE_FILES.length,
      `${manifest.posture?.length} vs ${DIRECT_PROFILE_FILES.length}`);
    // The manifest must not LIE: every file it claims must be on disk (the postcondition the function
    // throws on — asserted here from the outside so a future refactor that drops the throw still fails).
    const claimedMissing = manifest.posture.filter((n) => !existsSync(join(profileRoot, n)));
    check('no file the manifest claims is missing (the manifest does not lie)',
      claimedMissing.length === 0, claimedMissing.join(', ') || 'none');
    // Digests must describe the files actually present.
    const digests = manifest.postureDigests ?? {};
    const wrong = Object.entries(digests).filter(([n, d]) => {
      const p = join(profileRoot, n);
      if (!existsSync(p)) return true;
      return createHash('sha256').update(readFileSync(p)).digest('hex') !== d;
    });
    check('every recorded posture digest matches the file on disk', wrong.length === 0, wrong.map(([n]) => n).join(', '));
  } catch (error) {
    check('an ABSENT $DSH_HOME is recovered (no throw)', false, String(error?.message ?? error));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── 2. a HALF-wiped profile (manifest survives, its files do not) ──────────────────────────────
//
// This is the nastier shape: the ownership anchor is intact, so the conflict guard lets us through,
// but the body is gone. Recovery must rebuild the body AND leave digests that describe the result
// rather than the pre-wipe state.
{
  const home = mkdtempSync(join(tmpdir(), 'wipe-half-'));
  try {
    bootstrap(fakePlugin(home), false);
    const profileRoot = join(home, 'profiles', PRESET_NAME);
    const before = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
    // Delete the body but keep the manifest, then corrupt one file to differ from its digest.
    for (const n of ['math-memory.mjs', 'note-tools.mjs', 'engine-shared.mjs']) {
      rmSync(join(profileRoot, n), { force: true });
    }
    writeFileSync(join(profileRoot, 'hook-frontmatter.mjs'), '// hand-edited\n', 'utf8');
    const res = bootstrap(fakePlugin(home), false);
    const missing = DIRECT_PROFILE_FILES.filter((n) => !existsSync(join(profileRoot, n)));
    check('a half-wiped profile is fully rebuilt', missing.length === 0, missing.join(', ') || 'none missing');
    const after = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
    check('recovery reported what it wrote', Array.isArray(res.written) && res.written.length > 0,
      `${res.written?.length} entries`);
    // ⚠️ `hook-frontmatter.mjs` is written with overwrite=true (it is code, not user config), so the
    // hand edit must be gone and the digest must describe the RESTORED file.
    const restored = readFileSync(join(profileRoot, 'hook-frontmatter.mjs'), 'utf8');
    check('a hand-edited CODE file is restored to the shipped content (not left drifted)',
      restored !== '// hand-edited\n' && restored.includes('frontmatter'),
      restored.slice(0, 40).replace(/\n/g, '\\n'));
    check('the digest baseline was re-recorded for the restored file',
      after.postureDigests['hook-frontmatter.mjs'] !== undefined
      && after.postureDigests['hook-frontmatter.mjs'] === createHash('sha256').update(restored).digest('hex'));
    // ⚠️ NOT "the digests changed". The first version of this line asserted that the baseline must
    // DIFFER from the pre-wipe record, and it failed — correctly: the bootstrap restores the SHIPPED
    // bytes, so every digest legitimately returns to the same value it had before the wipe. Recovery
    // is deterministic; a changed digest would mean it produced something else. What must hold is that
    // the baseline describes the CURRENT disk state (so a real hand-edit is still detectable), and the
    // pre-wipe corruption is gone.
    check('the pre-wipe corruption is gone from disk (the hand edit did not survive)',
      !readFileSync(join(profileRoot, 'hook-frontmatter.mjs'), 'utf8').includes('hand-edited'));
    const baselineStale = Object.entries(after.postureDigests).filter(([n, d]) => {
      const p = join(profileRoot, n);
      if (!existsSync(p)) return true;
      return createHash('sha256').update(readFileSync(p)).digest('hex') !== d;
    });
    check('the re-recorded baseline describes the post-recovery disk state exactly',
      baselineStale.length === 0, baselineStale.map(([n]) => n).join(', ') || 'none stale');
    // The baseline DID move for the file whose content actually changed before recovery… except that
    // recovery RESTORES it, so equality with the original digest is the correct outcome. Assert that
    // explicitly, so a future change that "helpfully" keeps the drifted copy is caught.
    check('recovery restores the shipped content byte-for-byte (digest returns to the original)',
      after.postureDigests['hook-frontmatter.mjs'] === before.postureDigests['hook-frontmatter.mjs'],
      `after=${String(after.postureDigests['hook-frontmatter.mjs']).slice(0, 12)} before=${String(before.postureDigests['hook-frontmatter.mjs']).slice(0, 12)}`);
  } catch (error) {
    check('a half-wiped profile is fully rebuilt', false, String(error?.message ?? error));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── 3. idempotency: a second start must not rewrite user-editable files ─────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'wipe-idem-'));
  try {
    bootstrap(fakePlugin(home), false);
    const profileRoot = join(home, 'profiles', PRESET_NAME);
    // A user-editable file (overwrite=false) must survive a second bootstrap untouched.
    const userFile = join(profileRoot, 'cordis.patch.yml');
    const userContent = readFileSync(userFile, 'utf8') + '\n# user edit\n';
    writeFileSync(userFile, userContent, 'utf8');
    const second = bootstrap(fakePlugin(home), false);
    check('a second bootstrap preserves a user-edited file written with overwrite=false',
      readFileSync(userFile, 'utf8') === userContent,
      readFileSync(userFile, 'utf8') === userContent ? '' : 'CLOBBERED');
    check('a second bootstrap still reports the code files it refreshes',
      second.written.some((w) => w.includes('math-memory.mjs')), second.written.join(', '));
  } catch (error) {
    check('idempotency case did not throw', false, String(error?.message ?? error));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── 4. the conflict guard still protects another channel's install ─────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'wipe-owner-'));
  try {
    const profileRoot = join(home, 'profiles', PRESET_NAME);
    mkdirSync(profileRoot, { recursive: true });
    writeFileSync(join(profileRoot, '.install-manifest.json'),
      JSON.stringify({ owner: 'npm', version: '0.7.8' }), 'utf8');
    let threw = null;
    try { bootstrap(fakePlugin(home), false); } catch (error) { threw = error; }
    check('an npm-owned profile is NOT clobbered by the plugin bootstrap',
      threw !== null && /npm/.test(String(threw.message)), String(threw?.message ?? 'NO THROW').slice(0, 80));
    // …but --force (the settings button) takes over, as the message promises.
    const forced = bootstrap(fakePlugin(home), true);
    const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
    check('forcing takes ownership (the message\'s promise is real)',
      forced.home === home && manifest.owner === 'direct', String(manifest.owner));
  } catch (error) {
    check('the conflict-guard case did not throw unexpectedly', false, String(error?.message ?? error));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── 7. A′ S4, Obsidian half: the bootstrap really does install a local bundle ─────────────────────
//
// This is the feature's acceptance test, and it is deliberately END-TO-END: it runs the shipped
// `bootstrapDshConfig` with the shipped materializer against a real `dsh plugin add`. A gate that only
// inspected the payload would have passed while the package was missing `dsh/cordis.patch.yml` — which
// is exactly what happened on the first run of this section.
//
// Skipped (loudly) when this machine has no dsh/pnpm: the fallback shape is covered by section 1–6 with
// `bundleInstall:false`, so a skip here is not a silent pass of the same claim.
{
  const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const haveToolchain = !probe.error && probe.status === 0;
  if (!haveToolchain) {
    check('S4 (Obsidian) bundle route: SKIPPED — no pnpm on this machine; the flat fallback is covered above', true);
  } else {
    const home = mkdtempSync(join(tmpdir(), 'wipe-bundle-'));
    try {
      const res = bootstrap(fakePlugin(home, '0.7.8', { bundleInstall: true }), false);
      const profileRoot = join(home, 'profiles', PRESET_NAME);
      const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
      const bundles = JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8')).dsh?.profile?.bundles ?? [];
      const overlay = readFileSync(join(profileRoot, 'notes-assistant.patch.yml'), 'utf8');

      check('S4 (Obsidian): the bootstrap reports the package as registered', res.bundled === true,
        `bundled=${res.bundled} reason=${res.bundleReason}`);
      check('S4 (Obsidian): the profile lists dsh-math-memory as a bundle',
        bundles.includes('dsh-math-memory'), bundles.join(', '));
      check('S4 (Obsidian): ownership flipped to npm + bundleSource=local (same shape as the CLI)',
        manifest.owner === 'npm' && manifest.bundleSource === 'local',
        `owner=${manifest.owner} source=${manifest.bundleSource}`);
      // The whole plan must be on disk — the seven non-imported files included.
      const planned = shippedBundleFiles();
      const missing = planned.filter((rel) => !existsSync(join(profileRoot, '.dsh-math-memory', ...rel.split('/'))));
      check('S4 (Obsidian): every planned file was materialized', missing.length === 0,
        missing.join(', ') || `${planned.length} files`);
      check('S4 (Obsidian): the install-time bundle patch is there (the file dsh reads first)',
        existsSync(join(profileRoot, '.dsh-math-memory', 'dsh', 'cordis.patch.yml')));
      check('S4 (Obsidian): the rows the package provides are stripped from the overlay',
        !overlay.includes('name: ./math-memory-panel.mjs') && !overlay.includes('name: ./math-memory-workspace.mjs'));
      check('S4 (Obsidian): the client-panel row SURVIVES (nothing else declares it)',
        overlay.includes('client-ui-memory-panel'));
      check('S4 (Obsidian): the notice says the plugin WILL appear in dsh\'s plugin page',
        typeof res.notice === 'string' && /会出现在 dsh 的「插件」页/.test(res.notice));
    } catch (error) {
      check('S4 (Obsidian): the bundle bootstrap did not throw', false, String(error?.message ?? error));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }

    // The VERDICT half: `dsh plugin add` really runs and really succeeds, but the verification is
    // forced negative. The bootstrap must then treat it as NOT installed — fall back to flat, and not
    // claim the npm channel. This is the assertion that would catch a verdict weakened to "exit code 0".
    const vHome = mkdtempSync(join(tmpdir(), 'wipe-verdict-'));
    try {
      const prev = process.env.DSH_TEST_UNREGISTER_BUNDLE;
      process.env.DSH_TEST_UNREGISTER_BUNDLE = '1';
      let res;
      try {
        res = bootstrap(fakePlugin(vHome, '0.7.8', { bundleInstall: true }), false);
      } finally {
        if (prev === undefined) delete process.env.DSH_TEST_UNREGISTER_BUNDLE;
        else process.env.DSH_TEST_UNREGISTER_BUNDLE = prev;
      }
      const profileRoot = join(vHome, 'profiles', PRESET_NAME);
      const manifest = JSON.parse(readFileSync(join(profileRoot, '.install-manifest.json'), 'utf8'));
      const overlay = readFileSync(join(profileRoot, 'notes-assistant.patch.yml'), 'utf8');
      check('S4 (Obsidian) verdict: a failed verification does NOT report the package as registered',
        res.bundled === false, `bundled=${res.bundled}`);
      check('S4 (Obsidian) verdict: ...and the manifest does NOT claim the npm channel',
        manifest.owner === 'direct', String(manifest.owner));
      check('S4 (Obsidian) verdict: ...and the flat layout is written instead (overlay keeps its rows)',
        overlay.includes('name: ./math-memory-panel.mjs') && overlay.includes('name: ./math-memory-workspace.mjs'));
      check('S4 (Obsidian) verdict: the reason names the unregistered package',
        /未被登记/.test(String(res.bundleReason)), String(res.bundleReason).slice(0, 90));
    } finally {
      rmSync(vHome, { recursive: true, force: true });
    }
  }
}

console.log(failed === 0
  ? `\nbundle-recovery: OK (${total}/${total} — the plugin rebuilds a wiped $DSH_HOME from its embedded copy)`
  : `\nbundle-recovery: ${failed} FAILED of ${total}`);
process.exit(failed === 0 ? 0 : 1);
