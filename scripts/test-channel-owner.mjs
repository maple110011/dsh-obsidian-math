/**
 * test-channel-owner — who owns a profile, and does the runtime guard act on it?
 *
 * The anchor is the profile's `.install-manifest.json`, with the retired
 * `.agent-presets/<id>/.owner.json` as a fallback. That precedence is the whole
 * point: when the guard anchored on the retired directory only, deleting a
 * directory "nothing reads" silently disabled it (see dsh/host/channel-owner.mjs).
 *
 * The last section calls the REAL `dsh/host/index.mjs` in-process with a fake
 * ctx — no dsh boot — using cache-busting query specifiers, because `apply` sets a
 * module-level `mounted` flag on its first call and one process can therefore only
 * exercise one scenario per module instance.
 *
 * (The tree-sync this suite was written for was deleted on 2026-09-26: dsh 0.1.7
 * declares presets in the bundle patch, so `syncPresetTree` had no caller left.)
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  OWNER_MARKER,
  CHANNEL_MANIFEST,
  LEGACY_PRESET_DIR,
  readChannelOwner,
  profileDirFromCtx
} from '../dsh/host/channel-owner.mjs';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed += 1; console.log('  ok  ' + label); }
  else { failed += 1; console.log('  FAIL ' + label + (detail === '' ? '' : ' | ' + detail)); }
}

const root = mkdtempSync(join(tmpdir(), 'channel-owner-test-'));
const home = join(root, 'home');
const profileDir = join(home, 'profiles', 'probe-profile');
const legacyDir = join(home, LEGACY_PRESET_DIR, 'notes-assistant');
mkdirSync(profileDir, { recursive: true });
mkdirSync(legacyDir, { recursive: true });
const manifestPath = join(profileDir, CHANNEL_MANIFEST);
const legacyMarkerPath = join(legacyDir, OWNER_MARKER);
const owner = () => readChannelOwner({ profileDir, home, presetId: 'notes-assistant' });

// ── 1. the anchor and its precedence ────────────────────────────────────────
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

// ── 2. profileDirFromCtx — the measured anchor for "which profile is booting" ─
const fromCtx = profileDirFromCtx({ baseUrl: 'file:///C:/x/profiles/p/' });
check('profileDirFromCtx: yields a directory usable with join (no trailing separator)',
  typeof fromCtx === 'string' && !/[\\/]$/.test(fromCtx)
  && join(fromCtx, 'math-memory.mjs').endsWith('math-memory.mjs'));
check('profileDirFromCtx: the directory is the baseUrl\'s', /profiles[\\/]p$/.test(fromCtx), String(fromCtx));
check('profileDirFromCtx: null when the anchor is missing or not a URL',
  profileDirFromCtx(null) === null && profileDirFromCtx({}) === null
  && profileDirFromCtx({ baseUrl: '' }) === null && profileDirFromCtx({ baseUrl: 'profiles/p' }) === null);

// ── 3. the RUNTIME half: `dsh/host/index.mjs` must consult the same anchor ───
// `apply` needs only `baseUrl` + `logger`; its two sub-calls fail harmlessly on a
// fake ctx (both are wrapped in try/catch), which is how we observe whether they
// were attempted at all.
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
console.log(`channel-owner: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
