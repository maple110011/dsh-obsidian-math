// scripts/check-patch-yaml.mjs — every shipped `*.patch.yml` must actually PARSE.
//
// WHY THIS EXISTS（2026-09-21, found by accident). `dsh/profile/cordis.patch.yml` shipped
// with its FIRST entry on the same line as a comment:
//
//     # …plus the cross-session memory plugin.- id: agent-presets
//
// which comments the row out. The top-level sequence therefore never opens, and the next
// bare `- id:` is a hard YAML error — `dsh` refuses to boot the whole `notes-assistant`
// profile:
//
//     failed to parse overlay …/cordis.patch.yml: YAMLException: end of the stream or a
//     document separator is expected (16:1)
//
// **Nothing in the suite caught it.** The preset gate caught it only because it boots a
// real dsh — and that gate is the one that needs a writable `$DSH_HOME`, so in a confined
// environment it fails for an unrelated reason and the YAML error stays invisible. Every
// other check reads these files as TEXT (that is how `test-preset-sync.mjs` compares
// copies byte-wise), and a mangled line is still perfectly good text.
//
// So this check does the one thing none of them did: **parse the file**. It runs without a
// dsh, without a subprocess, and without any writable state — i.e. it stays honest in the
// environments where the boot gate cannot run.
//
// WHAT IT ASSERTS. For every shipped patch overlay: it parses as YAML, it is a top-level
// SEQUENCE (a patch file is a list of patch ops, never a mapping), and every entry is a
// mapping with a recognizable key (`id` for a row override, `insert` for an insertion).
// A commented-out first row and an unparsable file both fail here.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

/**
 * `!!js <expr>` is dsh's own scalar tag, not standard YAML, so a plain `load` would fail on
 * a perfectly valid file. Rather than registering a custom tag (the installed js-yaml's
 * schema API differs between majors — `lookupSequenceTag is not a function`), strip the tag
 * and keep its value. Structure is what broke, and structure survives this substitution.
 */
const stripCustomTags = (source) => source.replace(/!!js(?![A-Za-z0-9_-])/gu, '');
const SCHEMA = undefined;

/**
 * Every YAML the repo ships in an agent-plane directory. NOT all of them are patch
 * overlays: `preset.yml` is a metadata mapping, so the "must be a list of ops" assertion
 * applies only to `*.patch.yml` and `*.cordis.yml` (see `isPatchOverlay` below).
 */
const candidates = [];
for (const dir of [join(root, 'dsh', 'profile'), join(root, 'dsh', 'preset')]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.yml')) candidates.push(join(dir, name));
  }
}
check('there is at least one shipped YAML to check', candidates.length > 0, `${candidates.length} files`);

const rel = (p) => p.slice(root.length + 1).replace(/\\/g, '/');
/** An overlay lists patch ops; anything else (e.g. `preset.yml`) is a plain document. */
const isPatchOverlay = (name) => name.endsWith('.patch.yml') || name.endsWith('.cordis.yml');

for (const file of candidates) {
  const name = rel(file);
  const overlay = isPatchOverlay(name);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    check(`${name}: readable`, false, String(error));
    continue;
  }
  // CRLF is what a Windows checkout produces; normalize so the parse is about structure.
  const source = text.replace(/\r\n/g, '\n');
  let parsed;
  try {
    parsed = load(stripCustomTags(source), SCHEMA === undefined ? undefined : { schema: SCHEMA });
  } catch (error) {
    check(`${name}: parses as YAML`, false, String(error?.message ?? error).split('\n')[0]);
    continue;
  }
  check(`${name}: parses as YAML`, true);
  // A metadata document (`preset.yml`) is done after parsing; the op-shape assertions below
  // only make sense for an overlay.
  if (!overlay) continue;
  check(`${name}: is a top-level sequence of patch ops`, Array.isArray(parsed),
    Array.isArray(parsed)
      ? `${parsed.length} entries`
      : `got ${parsed === null ? 'null' : typeof parsed} — a patch overlay is a LIST ("- id: …" / "- insert:")`);
  if (!Array.isArray(parsed)) continue;
  // Every entry must be a mapping carrying a recognizable op key. This is what catches the
  // original defect shape: with the first row commented out, js-yaml still returned a LIST
  // of the LATER rows, so "parses" and "is a list" both passed while the file was broken.
  const bad = parsed
    .map((entry, i) => [i, entry])
    .filter(([, entry]) => entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || (!Object.prototype.hasOwnProperty.call(entry, 'id') && !Object.prototype.hasOwnProperty.call(entry, 'insert')));
  check(`${name}: every entry is a patch op (has \`id\` or \`insert\`)`, bad.length === 0,
    bad.length === 0 ? `${parsed.length} ops` : `entry #${bad[0][0]} = ${JSON.stringify(bad[0][1]).slice(0, 80)}`);

  // The specific trap, asserted directly. A comment line must never END with a bare row
  // fragment like `…plugin.- id: agent-presets`: such a line is still a comment, the row it
  // names vanishes, and the file only fails later (or not at all, if another row follows).
  //
  // The match is deliberately narrow — an UNQUOTED, un-backticked `.- id:` at end of line.
  // This very file's warning comment quotes the bad form, and a detector that flagged its
  // own documentation would be noise the next reader learns to ignore.
  const smuggled = source.split('\n').filter((line) => /^#.*\.-\s*id:\s*[A-Za-z0-9_-]+\s*$/u.test(line) && !/[`'"]/u.test(line));
  check(`${name}: no row is commented out on a comment line`, smuggled.length === 0,
    smuggled.length === 0 ? '' : smuggled[0].slice(-60));

  // Row ids must be unique WITHIN a file: cordis treats a duplicate loader entry id as a hard
  // failure of the whole profile, not as "last one wins".
  const seenIds = new Map();
  const dupes = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object') continue;
    const ids = [];
    if (typeof entry.id === 'string') ids.push(entry.id);
    if (Array.isArray(entry.insert)) for (const row of entry.insert) if (row !== null && typeof row === 'object' && typeof row.id === 'string') ids.push(row.id);
    for (const id of ids) {
      if (seenIds.has(id)) dupes.push(`${id}（${seenIds.get(id)} 与本次）`);
      else seenIds.set(id, name);
    }
  }
  check(`${name}: no duplicate row id inside the file`, dupes.length === 0, dupes.join(' / '));
}

// ── 跨文件：客户端半个的插入 id 不能撞上任何已发布的行 id ─────────────────────
//
// WHY。2026-09-21 真实故障：`install-into-profile.mjs` 用 `math-memory-panel` 作插入 id，而
// `dsh/profile/notes-assistant.patch.yml` 里**已经**有一个同 id 的宿主半个。两个 patch 层
// （`--patch notes-assistant.patch.yml` 与 profile 自己的 `cordis.patch.yml`）各插一个同 id 条目
// ⇒ cordis 拒绝启动整个 profile：`duplicate loader entry id: math-memory-panel`，用户的
// Obsidian 侧栏**完全起不来**。这条门禁把"两个文件各自的 id 集合必须不相交"钉住。
{
  const { CLIENT_INSERT_ID } = await import('../dsh/client-panel/install-into-profile.mjs');
  const rowIds = new Set();
  const collect = (parsedFile) => {
    for (const entry of parsedFile) {
      if (entry === null || typeof entry !== 'object') continue;
      if (typeof entry.id === 'string') rowIds.add(entry.id);
      if (Array.isArray(entry.insert)) for (const row of entry.insert) if (row !== null && typeof row === 'object' && typeof row.id === 'string') rowIds.add(row.id);
    }
  };
  for (const file of candidates) {
    try {
      const parsedFile = load(stripCustomTags(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')));
      if (Array.isArray(parsedFile)) collect(parsedFile);
    } catch { /* 已在上面报过 */ }
  }
  check('客户端半个的插入 id 不与任何已发布的行 id 冲突', !rowIds.has(CLIENT_INSERT_ID),
    rowIds.has(CLIENT_INSERT_ID) ? `"${CLIENT_INSERT_ID}" 已被占用（会导致 duplicate loader entry id，整个 profile 起不来）` : CLIENT_INSERT_ID);
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
