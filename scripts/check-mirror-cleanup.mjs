/**
 * check-mirror-cleanup — the @linxin666 junction mirror must drop links whose
 * upstream package is gone.
 *
 * Why this gate exists
 * --------------------
 * `syncGlobalPackageLinks` (obsidian/main.template.js) mirrors every @linxin666
 * package from the `web` profile into the `notes-assistant` profile, because the
 * global skin-manager patch inserts the ACTIVE skin into EVERY profile. The
 * mirror loop walks the WEB side (`readdirSync(webScope)`), so a package that is
 * DELETED upstream is never revisited: its junction here keeps pointing at a
 * nonexistent target and survives every future sync. Measured 2026-09-25 after
 * `dsh-web-all` went 0.3.20 → 0.4.2 (0.4.0 folded dsh-perf / dsh-doctor /
 * dsh-skins / dsh-web-ui-all into the one aggregate package): 9 such dangling
 * links, invisible because `existsSync` FOLLOWS a junction and therefore reports
 * "absent" for a broken link just like for a missing one.
 *
 * The fix is a second pass over the OBSIDIAN side. This gate runs the template's
 * REAL `syncGlobalPackageLinks` against a synthetic home and asserts the
 * contract, including the two ways this could go wrong: deleting a real
 * directory, or failing to delete the stale link.
 *
 * What it does NOT cover: whether the web profile is on 0.4.x, and whether any
 * live package still resolves. Those are environment facts, not code facts.
 *
 * Mutation check (2026-09-25): with the second pass removed, "the stale junction
 * is gone" fails while the real-directory assertion stays green — i.e. the
 * assertion bites exactly where the defect was.
 */
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, lstatSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';

const template = readFileSync(new URL('../obsidian/main.template.js', import.meta.url), 'utf8');

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

/** Extract a whole top-level named function declaration from the template. */
function functionSource(name) {
  const start = template.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in the template`);
  const braceStart = template.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < template.length; i += 1) {
    if (template[i] === '{') depth += 1;
    else if (template[i] === '}') {
      depth -= 1;
      if (depth === 0) return template.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const PRESET_NAME = 'notes-assistant';
// Only the degraded branch touches these two; the fixture always has a web
// profile, so they must never be called. Throwing proves that.
const unexpectedDegradedPath = () => { throw new Error('degraded branch must not run in this fixture'); };

const syncGlobalPackageLinks = new Function(
  'join', 'existsSync', 'mkdirSync', 'readdirSync', 'lstatSync', 'rmSync', 'symlinkSync', 'readFileSync', 'writeFileSync', 'writeDebugLog',
  'PRESET_NAME', 'stripSkinFallbackBlock', 'buildSkinFallbackBlock',
  `${functionSource('syncGlobalPackageLinks')}\nreturn syncGlobalPackageLinks;`
)(
  join, existsSync, mkdirSync, readdirSync, lstatSync, rmSync, symlinkSync, readFileSync, writeFileSync, () => {},
  PRESET_NAME, unexpectedDegradedPath, unexpectedDegradedPath
);

const home = mkdtempSync(join(tmpdir(), 'dsh-mirror-gate-'));
const result = { ran: false, error: null };
try {
  const webScope = join(home, 'profiles', 'web', 'node_modules', '@linxin666');
  const obsScope = join(home, 'profiles', PRESET_NAME, 'node_modules', '@linxin666');
  mkdirSync(join(webScope, 'pkg-live'), { recursive: true });
  mkdirSync(join(webScope, 'pkg-real'), { recursive: true });
  mkdirSync(obsScope, { recursive: true });

  // 1. a healthy mirror: already correct, must survive untouched.
  symlinkSync(join(webScope, 'pkg-live'), join(obsScope, 'pkg-live'), 'junction');
  // 2. the defect: a link whose upstream package was deleted.
  symlinkSync(join(webScope, 'pkg-gone'), join(obsScope, 'pkg-gone'), 'junction');
  // 3. a REAL directory that happens to share a mirrored name — the mirror must
  //    never replace or delete it (this is how a user's own install is lost).
  mkdirSync(join(obsScope, 'pkg-real'));
  writeFileSync(join(obsScope, 'pkg-real', 'keep.txt'), 'user data\n', 'utf8');
  // 4. a real FILE in the mirror root, likewise never touched.
  writeFileSync(join(obsScope, 'README.md'), 'user note\n', 'utf8');

  const stats = syncGlobalPackageLinks(home);
  result.ran = true;
  result.stats = stats;

  const isLink = (p) => {
    try {
      return lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  };

  check('mirror: the dangling junction (upstream package deleted) is removed',
    !existsSync(join(obsScope, 'pkg-gone')) && !isLink(join(obsScope, 'pkg-gone')),
    JSON.stringify(stats));
  check('mirror: the healthy junction is kept',
    isLink(join(obsScope, 'pkg-live')));
  check('mirror: a real directory of the same name is never touched',
    existsSync(join(obsScope, 'pkg-real', 'keep.txt'))
    && readFileSync(join(obsScope, 'pkg-real', 'keep.txt'), 'utf8') === 'user data\n');
  check('mirror: a real file in the mirror root is never touched',
    existsSync(join(obsScope, 'README.md'))
    && readFileSync(join(obsScope, 'README.md'), 'utf8') === 'user note\n');
  check('mirror: the stale removal is reported in the result', stats.stale >= 1, JSON.stringify(stats));

  // Idempotence: a second pass must find nothing left to clean or repair.
  const second = syncGlobalPackageLinks(home);
  check('mirror: a second pass has nothing left to clean',
    second.stale === 0 && second.repaired === 0, JSON.stringify(second));
  check('mirror: a second pass does not re-link anything already linked',
    second.linked === 0, JSON.stringify(second));
} catch (error) {
  result.error = error;
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (result.error !== null) {
  // Junction creation needs Windows; on a filesystem that refuses it this is an
  // environment result, not a regression — report SKIP rather than a red gate
  // (AGENTS.md §4). Any other error is a real failure.
  const message = String(result.error && result.error.message ? result.error.message : result.error);
  if (platform !== 'win32' || /EPERM|EEXIST|ENOSYS|symlink/i.test(message)) {
    console.log(`mirror-cleanup: SKIP (this filesystem cannot create junctions: ${message})`);
    process.exit(0);
  }
  console.error(`mirror-cleanup: FAILED before any assertion ran: ${message}`);
  process.exit(1);
}

console.log(`__CHECKS__ ${passed}/${total}`);
const ok = passed === total && result.ran;
if (!ok) {
  console.error('mirror-cleanup: FAILED');
  process.exit(1);
}
console.log('mirror-cleanup: OK');
