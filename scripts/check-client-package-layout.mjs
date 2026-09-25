/**
 * check-client-package-layout — the memory-panel client package must be
 * IMPORTABLE, in both of the shapes `install-into-profile.mjs` can produce.
 *
 * WHY THIS GUARD EXISTS (2026-09-26)
 * ----------------------------------
 * The installer builds a throwaway package in the profile's `node_modules` whose
 * host entry is the client half's carrier. It used to copy `dsh/host/index.mjs`
 * to the package ROOT and hand-pick four siblings; when 0.1.7 gave
 * `host/index.mjs` a new relative import (`../preset/preset-deploy.mjs`), nobody
 * updated that list, and the package became un-importable:
 *
 *   ERR_MODULE_NOT_FOUND  …/@dsh-math-memory/preset/preset-deploy.mjs
 *
 * Nothing caught it: the installer printed "包已就位", and the failure only
 * appears at dsh boot (as a warning, on an optional row). So this guard builds
 * the package for real and `import()`s it — the same judgement the manual
 * diagnosis used. It also pins the two branches, because they are different
 * products: a profile WITHOUT its own host half gets the real host entry, and a
 * profile WITH one (`notes-assistant`) must get an EMPTY host half (two host
 * halves would register the `/memory-panel` prefix twice and dsh refuses to boot
 * the profile — 2026-09-21).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLIENT_PKG,
  CLIENT_ENTRY_REL,
  CLIENT_INSERT_ID,
  collectDshImportClosure,
  installClientIntoProfile
} from '../dsh/client-panel/install-into-profile.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? '[ok] ' : '[fail] '}${name}${detail === '' ? '' : ` | ${detail}`}`);
};

const OVERLAY_ROW = `- insert:\n    - id: ${CLIENT_INSERT_ID}\n      name: '${CLIENT_PKG}'\n`;

/** A minimal profile dir that satisfies the installer's preconditions. */
function makeProfile(home, { standaloneHost }) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'cordis.patch.yml'), '[]\n', 'utf8');
  writeFileSync(join(home, 'notes-assistant.patch.yml'), OVERLAY_ROW, 'utf8');
  if (standaloneHost) writeFileSync(join(home, 'math-memory-panel.mjs'), 'export function apply() {}\n', 'utf8');
}

/** Load the built package's entry and report what it is. */
async function loadEntry(pkgDir) {
  const entry = join(pkgDir, ...CLIENT_ENTRY_REL.replace(/^dsh\//, '').split('/'));
  const mod = await import(pathToFileURL(entry).href);
  return { entry, mod };
}

// ── branch 1: profile WITHOUT its own host half (the `web` profile shape) ────
const homeA = mkdtempSync(join(tmpdir(), 'client-pkg-a-'));
try {
  makeProfile(homeA, { standaloneHost: false });
  const res = installClientIntoProfile(homeA, { quiet: true });
  check('installer reports success without a standalone host half', res.ok === true, res.error ?? '');
  const pkgDir = res.pkgDir;

  const closure = collectDshImportClosure(CLIENT_ENTRY_REL, root).map((rel) => rel.replaceAll('\\', '/').replace(/^dsh\//, ''));
  const missing = closure.filter((rel) => !existsSync(join(pkgDir, ...rel.split('/'))));
  // ⚠️ NOT load-bearing on its own: it re-uses the same walker the installer
  // copies with, so a mutation INSIDE the walker makes this assertion pass
  // vacuously. The import below is the independent judge (mutation-verified
  // 2026-09-26: truncating the walker to its first entry reds the import, not
  // this line).
  check('every module in the entry\'s import closure is inside the package',
    missing.length === 0, missing.length === 0 ? `${closure.length} modules` : `missing ${missing.join(', ')}`);

  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const entryRel = CLIENT_ENTRY_REL.replace(/^dsh\//, '');
  check('package.json main points at the entry', manifest.main === entryRel, String(manifest.main));
  check('package.json exports["."] points at the entry', manifest.exports['.'] === `./${entryRel}`);
  check('package.json exports["./client"] stays ./client.js', manifest.exports['./client'] === './client.js');
  check('client.js is shipped next to package.json', existsSync(join(pkgDir, 'client.js')));
  check('no stale root index.mjs is left behind', !existsSync(join(pkgDir, 'index.mjs')));

  const loaded = await loadEntry(pkgDir);
  check('the built package IMPORTS', loaded.mod.name === 'math-memory-host', String(loaded.mod.name));
  check('the built package exposes apply()', typeof loaded.mod.apply === 'function');

  // The inject names are package-name dependency edges; if the installed tree is
  // discoverable, they must actually exist there.
  const nm = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai');
  if (existsSync(nm)) {
    const absent = manifest.dsh.client.inject.filter((name) => !existsSync(join(nm, name.replace(/^@deepseek-ai\//, ''))));
    check('every dsh.client.inject package exists in the installed dsh tree',
      absent.length === 0, absent.length === 0 ? `${manifest.dsh.client.inject.length} names` : `absent ${absent.join(', ')}`);
    check('dsh.client.platform is "web"', manifest.dsh.client.platform === 'web');
  } else {
    console.log('[skip] installed dsh tree not found — inject-name existence not checked');
  }
} catch (error) {
  check('branch 1 did not throw', false, String(error?.message ?? error));
} finally {
  rmSync(homeA, { recursive: true, force: true });
}

// ── branch 2: profile WITH its own host half (the `notes-assistant` shape) ────
const homeB = mkdtempSync(join(tmpdir(), 'client-pkg-b-'));
try {
  makeProfile(homeB, { standaloneHost: true });
  const res = installClientIntoProfile(homeB, { quiet: true });
  check('installer reports success with a standalone host half', res.ok === true, res.error ?? '');
  const loaded = await loadEntry(res.pkgDir);
  check('with a standalone host half the package host is the EMPTY implementation',
    loaded.mod.name === 'math-memory-client-panel', String(loaded.mod.name));
  check('the empty host half applies nothing',
    typeof loaded.mod.apply === 'function' && loaded.mod.apply() === undefined);
  check('the client half is still shipped', existsSync(join(res.pkgDir, 'client.js')));
} catch (error) {
  check('branch 2 did not throw', false, String(error?.message ?? error));
} finally {
  rmSync(homeB, { recursive: true, force: true });
}

if (failed > 0) {
  console.log('\nThe client package is not loadable. The copy list comes from');
  console.log('collectDshImportClosure() in dsh/client-panel/install-into-profile.mjs —');
  console.log('do not replace it with a hand-written file list.');
  process.exit(1);
}
console.log('client-package-layout: ok (closure copied, entry imports, both host-half branches correct)');
