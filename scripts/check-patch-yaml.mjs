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
// other check reads these files as TEXT (that is how `test-installer.mjs` compares
// installed copies byte-wise), and a mangled line is still perfectly good text.
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
// A′ S6 (2026-09-26): `dsh/cordis.patch.yml` — the BUNDLE's own patch — was never checked here, and it
// is the file the whole npm/local bundle channel boots from. A syntax error in it breaks the bundle
// outright while every other gate stays green, which is exactly the coverage hole this loop had (it
// only walked `dsh/profile/` and `dsh/preset/`). It lives one level up, so it is added explicitly
// rather than by widening the walk (which would also sweep in unrelated YAML).
candidates.push(join(root, 'dsh', 'cordis.patch.yml'));
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

// ── 跨文件：客户端半个的 loader 行必须**恰好挂一次**，且挂对包 ─────────────────
//
// WHY。2026-09-21 两个真实故障，方向相反：
//   · **重复**：`install-into-profile.mjs` 曾用 `math-memory-panel` 作插入 id，而
//     `dsh/profile/notes-assistant.patch.yml` 里已有一个同 id 的宿主半个 ⇒ 两个 patch 层各插
//     一个同 id 条目 ⇒ `duplicate loader entry id: math-memory-panel`，用户的 Obsidian 侧栏
//     **完全起不来**。
//   · **缺失（更隐蔽）**：修好重复之后，安装器改为把行追加到 `cordis.patch.yml`，但插件每次启动
//     都用内嵌副本重写 `notes-assistant.patch.yml`，而 `cordis.patch.yml` 不参与 `--patch` 启动
//     路径 ⇒ 包在 `node_modules` 里、却没有任何 loader 挂载它：拖拽接住了、`/mention` 回 204，
//     页面里却没有接收方，路径静默丢失。
// 所以这里钉的性质是"**恰好一次**"：零次是静默失效，两次是启动硬失败。
{
  const { CLIENT_INSERT_ID, CLIENT_PKG, OVERLAY_FILE } = await import('../dsh/client-panel/install-into-profile.mjs');
  let occurrences = 0;
  for (const file of candidates) {
    try {
      const parsedFile = load(stripCustomTags(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')));
      if (Array.isArray(parsedFile)) {
        const countIn = (parsed) => parsed.reduce((n, entry) => {
          if (entry === null || typeof entry !== 'object') return n;
          let k = entry.id === CLIENT_INSERT_ID ? 1 : 0;
          if (Array.isArray(entry.insert)) k += entry.insert.filter((row) => row !== null && typeof row === 'object' && row.id === CLIENT_INSERT_ID).length;
          return n + k;
        }, 0);
        occurrences += countIn(parsedFile);
      }
    } catch { /* 已在上面报过 */ }
  }

  // ⚠️ 这条断言 2026-09-21 被**替换**过，别把旧的加回来。
  //
  // 旧断言是"客户端半个的 id 不能出现在任何已发布的行里"。它建立在"这一行由安装器在安装时插入"
  // 的架构上 —— 而那个架构本身就是那个真实故障：安装器把行追加到 `cordis.patch.yml`，可 Obsidian
  // 插件在**每次启动服务时**都用内嵌副本重写 `notes-assistant.patch.yml`（`buildNotesAssistantPatch`），
  // 而 `cordis.patch.yml` 根本不参与 `--patch` 那条启动路径。于是包躺在 `node_modules` 里、
  // **界面里没有任何 loader 挂载它**：拖拽被接住、`/mention` 回 204，但页面既没有
  // `window.__dshMentionInsert`、也没人订阅 `/mention-stream`，路径全部掉进队列后消失。
  //
  // 修法是把这一行写进**权威 overlay 源文件**（`dsh/profile/${OVERLAY_FILE}`，由 build 内嵌进
  // `main.js`，每次启动重写时自然带上），安装器只剩"装包 + 校验行在"。所以现在正确的性质不是
  // "不能冲突"，而是 —— **恰好出现一次**：挂在权威 overlay 上、且没有任何第二层再挂一遍。
  // 重复 id 是 cordis 的硬失败（`duplicate loader entry id`，整个 profile 起不来），
  // 而"零次"就是上面那个静默失效的形状。
  check(`客户端半个的 loader 行在所有 patch 层里恰好出现一次（id=${CLIENT_INSERT_ID}）`,
    occurrences === 1,
    occurrences === 0
      ? '一次都没有 —— 拖拽引用在页面里将没有接收方（包会被装进 node_modules，但无人挂载）'
      : occurrences > 1
        ? `出现 ${occurrences} 次 —— 会导致 duplicate loader entry id，整个 profile 起不来`
        : `挂在 dsh/profile/${OVERLAY_FILE}`);

  // 行指向的包名必须是安装器真正会装的包（写错包名 ⇒ 启动时 ERR_MODULE_NOT_FOUND）。
  const overlayPath = join(root, 'dsh', 'profile', OVERLAY_FILE);
  let overlayText = '';
  try { overlayText = readFileSync(overlayPath, 'utf8'); } catch { /* 下面按"没有"处理 */ }
  const clientRow = new RegExp(`-\\s*id:\\s*['"]?${CLIENT_INSERT_ID}['"]?\\s*\\r?\\n\\s*name:\\s*['"]?([^'"\\s]+)`, 'm').exec(overlayText);
  check('客户端半行的 name 指向安装器会装的包', clientRow !== null && clientRow[1] === CLIENT_PKG,
    clientRow === null ? `在 dsh/profile/${OVERLAY_FILE} 里没找到 name 行` : `name=${clientRow[1]} 期望=${CLIENT_PKG}`);
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
