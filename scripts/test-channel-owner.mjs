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
//
// ⚠️ The retired marker lives at `$DSH_HOME/.agent-presets/<presetId>/.owner.json` — keyed by
// PRESET, not by profile. Since 2026-09-26 it is consulted ONLY when the profile being asked
// about IS that preset's profile (same directory name); otherwise every other profile in the
// home would inherit its verdict. Measured consequence of ignoring that: the `web` profile saw
// the retired `direct` marker, silently skipped bundle activation, never registered
// `/memory-panel/*`, and the memory panel in 3080 answered 404 with an empty body — which the
// client reported as `SyntaxError: Unexpected end of JSON input`.
const legacyProfileDir = join(home, 'profiles', 'notes-assistant');
mkdirSync(legacyProfileDir, { recursive: true });
const ownerLegacyShaped = () => readChannelOwner({ profileDir: legacyProfileDir, home, presetId: 'notes-assistant' });

check('owner: nothing anywhere reads as unowned', owner() === null);
writeFileSync(legacyMarkerPath, JSON.stringify({ owner: 'direct', version: '0.7.0' }), 'utf8');
check('owner: the retired marker is IGNORED for a differently-named profile (the 3080 false positive is gone)',
  owner() === null, JSON.stringify(owner()));
check('owner: a legacy-only install is still recognised for the profile it belongs to (the fallback is load-bearing)',
  ownerLegacyShaped()?.owner === 'direct' && ownerLegacyShaped()?.source === 'legacy');
writeFileSync(manifestPath, JSON.stringify({ owner: 'npm', version: '1.0.0' }), 'utf8');
check('owner: the profile manifest WINS when the two disagree',
  owner()?.owner === 'npm' && owner()?.source === 'manifest');
rmSync(manifestPath, { force: true });
check('owner: falls back to the legacy marker when the manifest is absent',
  ownerLegacyShaped()?.source === 'legacy' && ownerLegacyShaped()?.owner === 'direct');
writeFileSync(manifestPath, '{ this is not json', 'utf8');
check('owner: a malformed manifest is skipped, not fatal', ownerLegacyShaped()?.source === 'legacy');
writeFileSync(manifestPath, JSON.stringify({ version: '1.0.0' }), 'utf8');
check('owner: a manifest without an owner does not count as owned',
  owner() === null && ownerLegacyShaped()?.source === 'legacy');
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
  // Case C — the 3080 shape (2026-09-26): a DIFFERENTLY-NAMED profile whose only anchor is the
  // retired home-level marker. It must NOT be skipped — being skipped is what left the memory
  // panel answering 404 with an empty body ("Unexpected end of JSON input").
  const webProfileDir = join(home, 'profiles', 'web');
  mkdirSync(webProfileDir, { recursive: true });
  writeFileSync(legacyMarkerPath, JSON.stringify({ owner: 'direct', version: '0.7.8' }), 'utf8');
  const warnsC = [];
  const { apply: applyC } = await import(`../dsh/host/index.mjs?case=c-${Date.now()}`);
  await applyC({
    baseUrl: pathToFileURL(webProfileDir).href + '/',
    logger: { warn: (m) => warnsC.push(String(m)), info: () => {} }
  }, {});
  check('runtime guard: a differently-named profile does NOT inherit the retired marker (the 3080 bug)',
    !warnsC.some((m) => /skipping bundle activation/.test(m)), warnsC.join(' | ').slice(0, 200));
  check('runtime guard: it goes on to attempt the panel routes for that profile (routes get registered)',
    warnsC.some((m) => /panel routes failed/.test(m)), warnsC.join(' | ').slice(0, 200));

  // Case D — S3 (2026-09-26): the marker says `direct`, but the profile DOES register our package as a
  // bundle. Before S3 the guard accepted only `owner === "npm"`, so this exact shape was treated as a
  // foreign channel and skipped — which is what a LOCAL bundle install (A′: `dsh plugin add file:…`)
  // looks like when an older marker survives. Skipping it means the panel routes and the workspace
  // registration never mount while every other signal says the install succeeded.
  rmSync(legacyMarkerPath, { force: true });
  writeFileSync(manifestPath, JSON.stringify({ owner: 'direct', version: '0.7.8' }), 'utf8');
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-p', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-math-memory'] } }
  }), 'utf8');
  const warnsD = [];
  const { apply: applyD } = await import(`../dsh/host/index.mjs?case=d-${Date.now()}`);
  await applyD(fakeCtx(warnsD), {});
  check('runtime guard: a registered bundle is NOT skipped just because the marker says "direct" (S3)',
    !warnsD.some((m) => /skipping bundle activation/.test(m)), warnsD.join(' | ').slice(0, 200));
  check('...it says why it activated anyway (the disagreement is visible at runtime)',
    warnsD.some((m) => /registers dsh-math-memory as a bundle/.test(m)), warnsD.join(' | ').slice(0, 200));
  check('...and it really goes on to mount (panel routes attempted)',
    warnsD.some((m) => /panel routes failed/.test(m)), warnsD.join(' | ').slice(0, 200));

  // Case E — the CONTROL for case D, on its OWN PROFILE DIRECTORY.
  //
  // Two earlier versions of this control were broken, and the way they were broken is worth keeping:
  //   1st: it re-imported `index.mjs` and asserted "no bundle ⇒ still skips". Mutating the predicate to
  //        `return true` did NOT turn it red.
  //   2nd: it drove two fresh instances over the SHARED profile dir from the cases above. Still green
  //        under the same mutation.
  // The instrumented run showed why: both shared `warnsE`-style arrays with the earlier cases, and the
  // `skipping bundle activation` warning from case A was still in the array — so the assertion matched a
  // STALE message rather than this run's behaviour. A control that cannot attribute a warning to its own
  // run is not a control (trap 68), so this one gets a private profile directory and a private home
  // marker state, and asserts BOTH directions in the same pair:
  //   · no bundle registered + `direct` marker   → must skip;
  //   · bundle registered     + `direct` marker   → must NOT skip.
  // The only difference between the two runs is `dsh.profile.bundles`, so the pair pins the predicate.
  {
    const controlDir = join(home, 'profiles', 'control-profile');
    mkdirSync(controlDir, { recursive: true });
    const controlCtx = (warns) => ({
      baseUrl: pathToFileURL(controlDir).href + '/',
      logger: { warn: (m) => warns.push(String(m)), info: () => {} }
    });
    const controlManifest = join(controlDir, '.install-manifest.json');
    writeFileSync(controlManifest, JSON.stringify({ owner: 'direct', version: '0.7.8' }), 'utf8');

    rmSync(join(controlDir, 'package.json'), { force: true });
    const warnsNoBundle = [];
    const { apply: applyNoBundle } = await import(`../dsh/host/index.mjs?case=e1-${Date.now()}`);
    await applyNoBundle(controlCtx(warnsNoBundle), {});
    check('control: with NO bundle registered the "direct" marker skips',
      warnsNoBundle.some((m) => /skipping bundle activation/.test(m)),
      warnsNoBundle.join(' | ').slice(0, 200));

    writeFileSync(join(controlDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-control', private: true,
      dsh: { profile: { bundles: ['dsh-math-memory'] } }
    }), 'utf8');
    const warnsWithBundle = [];
    const { apply: applyWithBundle } = await import(`../dsh/host/index.mjs?case=e2-${Date.now()}`);
    await applyWithBundle(controlCtx(warnsWithBundle), {});
    check('control: the SAME marker stops skipping once the bundle is registered',
      !warnsWithBundle.some((m) => /skipping bundle activation/.test(m)),
      warnsWithBundle.join(' | ').slice(0, 200));

    // Third control, and the one that actually pins the PREDICATE: a package.json that EXISTS and
    // parses, but does NOT list our package. The predicate must answer false here, so the guard must
    // SKIP. This is what makes an unconditional `return true` inside the predicate detectable: the
    // earlier "delete package.json" form did NOT catch it (measured 2026-09-26) because a missing file
    // returns early, before the branch a `return true` mutation would live in.
    writeFileSync(join(controlDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-control', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }
    }), 'utf8');
    const warnsOtherBundles = [];
    const { apply: applyOtherBundles } = await import(`../dsh/host/index.mjs?case=e3-${Date.now()}`);
    await applyOtherBundles(controlCtx(warnsOtherBundles), {});
    check('control: a readable manifest WITHOUT our bundle is "not registered" (so the guard skips)',
      warnsOtherBundles.some((m) => /skipping bundle activation/.test(m)),
      warnsOtherBundles.join(' | ').slice(0, 200));

    // Fourth: the file exists but is NOT valid JSON — the catch branch must also answer "not registered".
    writeFileSync(join(controlDir, 'package.json'), '{ not json', 'utf8');
    const warnsBroken = [];
    const { apply: applyBroken } = await import(`../dsh/host/index.mjs?case=e4-${Date.now()}`);
    await applyBroken(controlCtx(warnsBroken), {});
    check('control: a manifest that cannot be parsed is "not registered" (guard skips, never throws)',
      warnsBroken.some((m) => /skipping bundle activation/.test(m)),
      warnsBroken.join(' | ').slice(0, 200));
  }
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
}

rmSync(root, { recursive: true, force: true });
console.log(`channel-owner: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
