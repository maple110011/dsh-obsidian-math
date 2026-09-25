/**
 * check-plugin-manifest-meta — the plugin-management card must get a localized
 * title, a description and an icon, from the SAME reader the card uses.
 *
 * WHY THIS GUARD EXISTS (2026-09-26)
 * ----------------------------------
 * dsh 0.1.7 shows a plugin in the management page using exactly three things
 * beyond its package name: `package.json.icon`, and `meta.title` /
 * `meta.description` from `<pkg>/locale/<lang>.json` (`dsh-app-boot`'s
 * `readPluginMeta`). Before this guard the plugin declared NONE of them, so its
 * card read `dsh-math-memory` with no artwork — and nothing in the repo could
 * tell, because the failure is a silent fallback rather than an error.
 *
 * Three ways to get it wrong that a "does the file exist" check would miss:
 *   · `locale/zh.json` misspelled or missing ⇒ dsh falls back to English and the
 *     card looks fine to a reader who does not notice the title is not Chinese;
 *   · a `meta` field that is not a non-empty string ⇒ hard error for that read,
 *     rendered as a `metadataError` line in the UI;
 *   · an icon that is absolute, outside the package, >256 KiB or not a real file
 *     ⇒ dsh rejects it and silently keeps the default artwork.
 * So this gate runs the REAL reader over a throwaway package and asserts the
 * result, instead of restating the rules.
 *
 * Skips when no installed dsh is available (`__SKIP__`), like the other
 * real-dsh gates.
 */
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? '[ok] ' : '[fail] '}${name}${detail === '' ? '' : ` | ${detail}`}`);
};
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));
const appBoot = join(
  process.env.APPDATA || join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'
);

// ── static: the manifest points at things that exist and are publishable ────
const iconRel = pkg.icon;
check('package.json declares an icon', typeof iconRel === 'string' && iconRel !== '');
if (typeof iconRel === 'string' && iconRel !== '') {
  check('the icon path is relative (dsh rejects absolute and scheme paths)',
    !/^[A-Za-z]:[\\/]/.test(iconRel) && !iconRel.startsWith('/') && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(iconRel),
    iconRel);
  const iconPath = join(root, iconRel);
  let bytes = 0;
  try { bytes = statSync(iconPath).size; } catch { bytes = -1; }
  check('the icon is a real file inside the package', bytes > 0, `${bytes} bytes`);
  // `bytes > 0` matters: without it a MISSING icon passes this bound vacuously.
  check('the icon is ≤ 256 KiB (dsh\'s limit)', bytes > 0 && bytes <= 256 * 1024, `${bytes} bytes`);
  check('the icon uses an accepted extension (.svg/.png/.jpg/.jpeg/.webp)',
    /\.(svg|png|jpe?g|webp)$/i.test(iconRel), iconRel);
}

const localeDir = join(root, 'locale');
let localeFiles = [];
try { localeFiles = readdirSync(localeDir).filter((n) => n.endsWith('.json')); } catch { localeFiles = []; }
check('locale/ exists and carries at least en.json', localeFiles.includes('en.json'), localeFiles.join(', '));
for (const name of localeFiles) {
  check(`locale/${name} uses a language id as its filename`,
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*\.json$/.test(name), name);
  let meta = null;
  try { meta = JSON.parse(read(`locale/${name}`)).meta; } catch { meta = null; }
  check(`locale/${name} has non-empty meta.title and meta.description`,
    meta !== null && typeof meta.title === 'string' && meta.title !== ''
    && typeof meta.description === 'string' && meta.description !== '',
    meta === null ? 'unparsable' : JSON.stringify(meta).slice(0, 80));
}

const files = pkg.files ?? [];
for (const rel of ['locale/', iconRel]) {
  if (typeof rel === 'string') check(`package.json \`files\` ships ${rel}`, files.includes(rel), files.join(', '));
}

// ── dynamic: the REAL reader, over a throwaway install ─────────────────────
if (!existingFile(appBoot)) {
  console.log('__SKIP__ plugin-manifest-meta (no installed dsh-app-boot to read the metadata with)');
  console.log(`  ${appBoot}`);
  console.log(failed === 0 ? 'plugin-manifest-meta: static checks only' : 'plugin-manifest-meta: static checks FAILED');
  process.exit(failed === 0 ? 0 : 1);
}
function existingFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

const tmp = mkdtempSync(join(tmpdir(), 'plugin-meta-'));
const iconUsable = typeof iconRel === 'string' && existingFile(join(root, iconRel));
try {
  const pkgDir = join(tmp, 'node_modules', 'dsh-math-memory');
  mkdirSync(pkgDir, { recursive: true });
  copyFileSync(join(root, 'package.json'), join(pkgDir, 'package.json'));
  if (iconUsable) copyFileSync(join(root, iconRel), join(pkgDir, iconRel));
  cpSync(localeDir, join(pkgDir, 'locale'), { recursive: true });

  const { readPluginMeta } = await import(pathToFileURL(appBoot).href);
  const meta = await readPluginMeta(pkg.name, pathToFileURL(join(tmp, 'caller.js')).href);

  check('dsh reads the metadata without error', meta?.error === undefined, String(meta?.error ?? ''));
  const title = meta?.title;
  const description = meta?.description;
  check('the card gets a title for en AND a DIFFERENT one for zh (proves locale/zh.json was read)',
    typeof title?.en === 'string' && title.en !== ''
    && typeof title?.zh === 'string' && title.zh !== '' && title.zh !== title.en,
    JSON.stringify(title));
  check('the card gets descriptions for both locales',
    typeof description?.en === 'string' && description.en !== ''
    && typeof description?.zh === 'string' && description.zh !== '',
    JSON.stringify(description).slice(0, 120));

  if (iconUsable) {
    const expectedIcon = 'data:image/svg+xml;base64,' + readFileSync(join(root, iconRel)).toString('base64');
    check('dsh turns the icon into a data URL with our exact bytes', meta?.icon === expectedIcon,
      typeof meta?.icon === 'string' ? meta.icon.slice(0, 40) : String(meta?.icon));
  } else {
    console.log('[skip] no usable icon file — the data-URL comparison is not meaningful');
  }
} catch (error) {
  check('the reader ran without throwing', false, String(error?.message ?? error));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.log('\nThe plugin-management card cannot render this plugin properly. The reader is');
  console.log("dsh-app-boot's readPluginMeta; see its rules in the guard header.");
  process.exit(1);
}
console.log('plugin-manifest-meta: ok (localized title/description + icon accepted by the real reader)');
