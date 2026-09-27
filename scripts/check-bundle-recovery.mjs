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
import { createHash } from 'node:crypto';
import * as acorn from 'acorn';
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
const EMBEDDED_PRESET = embeddedPresetMap();

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
const writeNotesAssistantPatch = sliceFunction(main, 'writeNotesAssistantPatch');
const ensureProfileDeclaration = sliceFunction(main, 'ensureProfileDeclaration');
const repairProfileManifestFile = sliceFunction(main, 'repairProfileManifestFile');
const bootstrapDshConfig = sliceFunction(main, 'bootstrapDshConfig');

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
  '  const out = {};',
  '  for (const name of files) {',
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
  "function mathMemoryBundled(home) { return profileBundles(home).includes('dsh-math-memory'); }"
].join('\n');

const harness = new Function(
  'existsSync', 'mkdirSync', 'writeFileSync', 'readFileSync', 'createHash', 'join', 'dirname',
  'EMBEDDED_PRESET', 'PRESET_NAME', 'PROFILE_CONTRACT_JSON',
  [
    HARNESS_PRELUDE,
    buildNotesAssistantPatch,
    writeNotesAssistantPatch,
    ensureProfileDeclaration,
    repairProfileManifestFile,
    bootstrapDshConfig,
    'return { bootstrapDshConfig, DIRECT_PROFILE_FILES };'
  ].join('\n')
);
const { bootstrapDshConfig: bootstrap, DIRECT_PROFILE_FILES } = harness(
  existsSync, mkdirSync, writeFileSync, readFileSync, createHash, join, dirname,
  EMBEDDED_PRESET, PRESET_NAME, CONTRACT_JSON
);
check('the shipped bootstrap was extracted and is callable', typeof bootstrap === 'function');
check('the extracted write list matches the injected contract (the single source)',
  DIRECT_PROFILE_FILES.length === new Set(DIRECT_PROFILE_FILES).size && DIRECT_PROFILE_FILES.length > 8,
  `${DIRECT_PROFILE_FILES.length} names`);

const fakePlugin = (home, version = '0.7.8') => ({
  service: { location: () => ({ home }) },
  manifest: { version }
});

// ── 1. the wipe itself: NOTHING exists under $DSH_HOME ─────────────────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'wipe-empty-'));
  rmSync(home, { recursive: true, force: true }); // genuinely absent, as after a wipe
  try {
    const res = bootstrap(fakePlugin(home), false);
    check('an ABSENT $DSH_HOME is recovered (no throw)', res.home === home, res.home);
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

console.log(failed === 0
  ? `\nbundle-recovery: OK (${total}/${total} — the plugin rebuilds a wiped $DSH_HOME from its embedded copy)`
  : `\nbundle-recovery: ${failed} FAILED of ${total}`);
process.exit(failed === 0 ? 0 : 1);
