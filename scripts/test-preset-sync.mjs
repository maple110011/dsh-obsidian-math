import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  syncPresetTree,
  OWNER_MARKER,
  CHANNEL_MANIFEST,
  LEGACY_PRESET_DIR,
  readChannelOwner,
  profileDirFromCtx
} from '../dsh/host/preset-sync.mjs';

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed += 1; console.log('  ok  ' + label); }
  else { failed += 1; console.log('  FAIL ' + label); }
}

const root = mkdtempSync(join(tmpdir(), 'preset-sync-test-'));
const src = join(root, 'src');
const dst = join(root, 'dst');

const files = {
  'agent.cordis.yml': '# agent composition\n- id: persona\n',
  'preset.yml': 'name: test\n',
  'math-memory.mjs': 'export const name = "math-memory";\n',
  'note-tools.mjs': 'export const name = "note-tools";\n',
  'hook-frontmatter.mjs': 'export const parseHookFrontmatter = () => null;\n'
};
mkdirSync(src, { recursive: true });
for (const [rel, content] of Object.entries(files)) writeFileSync(join(src, rel), content, 'utf8');

const meta = { owner: 'npm', version: '0.8.0' };

// 1. fresh sync
let r = syncPresetTree(src, dst, meta);
check('fresh sync: changed', r.changed === true);
check('fresh sync: no failure', r.failed === null);
check('fresh sync: 5 files', r.files === 5);
check('fresh sync: owner marker written', existsSync(join(dst, OWNER_MARKER)));
const marker = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8'));
check('marker owner=npm', marker.owner === 'npm');
check('marker version=0.8.0', marker.version === '0.8.0');
check('marker has installedAt', typeof marker.installedAt === 'string');
check('agent.cordis.yml copied', readFileSync(join(dst, 'agent.cordis.yml'), 'utf8') === files['agent.cordis.yml']);

// 2. idempotent re-sync (byte-identical)
r = syncPresetTree(src, dst, meta);
check('re-sync: unchanged', r.changed === false);
check('re-sync: no failure', r.failed === null);
const marker2 = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8'));
check('re-sync: installedAt preserved', marker2.installedAt === marker.installedAt);

// 3. prune stray file, preserve marker
writeFileSync(join(dst, 'STRAY.txt'), 'stray\n', 'utf8');
r = syncPresetTree(src, dst, meta);
check('prune: changed', r.changed === true);
check('prune: 1 pruned', r.pruned === 1);
check('prune: stray removed', !existsSync(join(dst, 'STRAY.txt')));
check('prune: marker preserved', existsSync(join(dst, OWNER_MARKER)));

// 4. source change propagates
writeFileSync(join(src, 'note-tools.mjs'), 'export const name = "note-tools-v2";\n', 'utf8');
r = syncPresetTree(src, dst, meta);
check('update: changed', r.changed === true);
check('update: content propagated', readFileSync(join(dst, 'note-tools.mjs'), 'utf8') === 'export const name = "note-tools-v2";\n');

// 5. version bump rewrites marker + resets installedAt
const firstInstalled = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8')).installedAt;
syncPresetTree(src, dst, { owner: 'npm', version: '0.9.0' });
const marker3 = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8'));
check('version bump: version=0.9.0', marker3.version === '0.9.0');
check('version bump: installedAt reset', marker3.installedAt !== firstInstalled);

// 6. missing agent.cordis.yml → reported failed
rmSync(join(src, 'agent.cordis.yml'), { force: true });
r = syncPresetTree(src, dst, meta);
check('validation: failed set', typeof r.failed === 'string');

// 7. the CHANNEL ANCHOR: profile manifest first, legacy `.agent-presets` marker as
//    a fallback. This is the guard that must not die when the retired directory is
//    removed — hence a test that removes it.
const home = join(root, 'home');
const profileDir = join(home, 'profiles', 'probe-profile');
const legacyDir = join(home, LEGACY_PRESET_DIR, 'notes-assistant');
mkdirSync(profileDir, { recursive: true });
mkdirSync(legacyDir, { recursive: true });
const manifestPath = join(profileDir, CHANNEL_MANIFEST);
const legacyMarkerPath = join(legacyDir, OWNER_MARKER);
const owner = () => readChannelOwner({ profileDir, home, presetId: 'notes-assistant' });

check('owner: nothing anywhere reads as unowned', owner() === null);
writeFileSync(legacyMarkerPath, JSON.stringify({ owner: 'direct', version: '0.7.0' }), 'utf8');
check('owner: a legacy-only install is still recognised (the fallback is load-bearing)',
  owner()?.owner === 'direct' && owner()?.source === 'legacy');
writeFileSync(manifestPath, JSON.stringify({ owner: 'npm', version: '1.0.0' }), 'utf8');
check('owner: the profile manifest WINS when the two disagree',
  owner()?.owner === 'npm' && owner()?.source === 'manifest');
rmSync(manifestPath, { force: true });
check('owner: falls back to the legacy marker when the manifest is absent',
  owner()?.source === 'legacy' && owner()?.owner === 'direct');
writeFileSync(manifestPath, '{ this is not json', 'utf8');
check('owner: a malformed manifest is skipped, not fatal', owner()?.source === 'legacy');
writeFileSync(manifestPath, JSON.stringify({ version: '1.0.0' }), 'utf8');
check('owner: a manifest without an owner does not count as owned', owner()?.source === 'legacy');
check('owner: no anchors passed at all ⇒ unowned, not a guess',
  readChannelOwner({ presetId: 'notes-assistant' }) === null);
check('owner: an owner-less manifest with no legacy fallback ⇒ unowned',
  readChannelOwner({ profileDir, presetId: 'notes-assistant' }) === null);

// 8. profileDirFromCtx — the measured anchor for "which profile is booting".
const fromCtx = profileDirFromCtx({ baseUrl: 'file:///C:/x/profiles/p/' });
check('profileDirFromCtx: yields a directory usable with join (no trailing separator)',
  typeof fromCtx === 'string' && !/[\\/]$/.test(fromCtx)
  && join(fromCtx, 'math-memory.mjs').endsWith('math-memory.mjs'));
check('profileDirFromCtx: the directory is the baseUrl\'s', /profiles[\\/]p$/.test(fromCtx), String(fromCtx));
check('profileDirFromCtx: null when the anchor is missing or not a URL',
  profileDirFromCtx(null) === null && profileDirFromCtx({}) === null
  && profileDirFromCtx({ baseUrl: '' }) === null && profileDirFromCtx({ baseUrl: 'profiles/p' }) === null);

// 9. the RUNTIME half: `dsh/host/index.mjs` must consult the SAME anchor.
//    Called in-process with a fake ctx — `apply` needs only `baseUrl` + `logger`,
//    and its two sub-calls fail harmlessly on a fake ctx (both are wrapped in
//    try/catch), which is how we observe whether they were attempted at all.
//    Each case imports a FRESH module instance (cache-busting query) because
//    `apply` sets a module-level `mounted` flag on its first call.
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
try {
  const fakeCtx = (warns) => ({
    baseUrl: pathToFileURL(profileDir).href + '/',
    logger: { warn: (m) => warns.push(String(m)), info: () => {} }
  });

  // Case A — the two anchors DISAGREE: manifest says direct, legacy says npm.
  writeFileSync(manifestPath, JSON.stringify({ owner: 'direct', version: '1.0.0' }), 'utf8');
  writeFileSync(legacyMarkerPath, JSON.stringify({ owner: 'npm', version: '1.0.0' }), 'utf8');
  const warnsA = [];
  const { apply: applyA } = await import(`../dsh/host/index.mjs?case=a-${Date.now()}`);
  await applyA(fakeCtx(warnsA), {});
  check('runtime guard: skips, and names the PROFILE MANIFEST as the deciding anchor',
    warnsA.some((m) => /owned by "direct" \(profile \.install-manifest\.json\)/.test(m)),
    warnsA.join(' | ').slice(0, 160));
  check('runtime guard: a skip really skips (panel/workspace never attempted)',
    !warnsA.some((m) => /panel routes failed|workspace auto-register failed/.test(m)),
    warnsA.join(' | ').slice(0, 160));

  // Case B — no anchors at all: the bundle channel activates normally.
  rmSync(manifestPath, { force: true });
  rmSync(legacyMarkerPath, { force: true });
  const warnsB = [];
  const { apply: applyB } = await import(`../dsh/host/index.mjs?case=b-${Date.now()}`);
  await applyB(fakeCtx(warnsB), {});
  check('runtime guard: an unowned profile is NOT skipped',
    !warnsB.some((m) => /skipping bundle activation/.test(m)), warnsB.join(' | ').slice(0, 160));
  check('runtime guard: it goes on to attempt the panel routes (fake ctx cannot provide ctx.effect)',
    warnsB.some((m) => /panel routes failed/.test(m)), warnsB.join(' | ').slice(0, 160));
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
}

rmSync(root, { recursive: true, force: true });
console.log(`preset-sync: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
