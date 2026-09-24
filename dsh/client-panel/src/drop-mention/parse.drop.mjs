// dsh/client-panel/src/drop-mention/parse.drop.mjs
//
// 把一次**拖拽载荷**变成一条 `@路径` 引用文本 —— 或者明确地说"这不是我们能处理的"。
//
// WHY A SEPARATE, PURE MODULE。拖拽载荷是**宿主格式**（Obsidian 的 `obsidian://open?…`），
// 是这个功能里最可能变、也最难在浏览器里断言的一块。把它做成纯函数，就得到三件事：
//   · 载荷形状变化时**当场**有红灯，而不是等用户报"拖进去没反应"；
//   · 每个拒绝条件都能单独变异验证（把某条去掉，必须有断言红）；
//   · 不需要浏览器、不需要 dsh，能进 `npm test`。
//
// 实测依据（`scripts/qa/drag-payload-probe.mjs`，CDP `Input.setInterceptDrags` 拦真值）：
// 从 Obsidian 文件树拖一篇笔记时，`text/plain` 与 `text/uri-list` 是**同值**的
//   `obsidian://open?vault=<库名>&file=<URL 编码的库内路径>`
// 见 `docs/drag-drop-design-2026-09-21.md` §0。

/** vault 相对路径的长度上限（与 `/open`、`/feedback` 的既有 2000 字符上限一致）。 */
export const MAX_MENTION_PATH_CHARS = 2000;

/**
 * `@` mention 的写法由 dsh 的语法决定（`@deepseek-ai/dsh-file-reference/grammar`）：
 * 路径含空格要用 `@"path"`，否则 `@path`。**空格不转义、不引号**就会被切成两个词。
 */
export function formatMention(path) {
  if (typeof path !== 'string' || path === '') return '';
  // 控制字符与引号是 dsh 语法明确拒绝的（`formatFileMention` 返回 undefined）；
  // 这类路径我们直接不认，而不是造一个宿主解析不了的 mention。
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return '';
  return / /.test(path) ? `@"${path}"` : `@${path}`;
}

/**
 * 从一段 `text/plain` 里取出**唯一**的库内路径，取不到就返回 null。
 *
 * 只认 Obsidian 的 `obsidian://open?vault=…&file=…`。刻意保守：
 * 任何一条不合规就整体拒绝（**不猜**），因为猜错的代价是往提示词里塞一个
 * 指向库外路径的 `@` 引用 —— 而 `@` 是接受绝对路径的。
 */
export function parseObsidianDragText(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const trimmed = text.trim();

  // 多行（含多选拖拽）不认：本轮只做单篇。见 design §5。
  if (/\r?\n/u.test(trimmed)) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'obsidian:') return null;
  // `obsidian://open?...` 的 host 是 `open`；别的动作（search/new 等）不是"拖一篇笔记"。
  if (url.hostname !== 'open') return null;

  // ⚠️ 必须取**最后一个** `file=`：`file` 的值是 URL 编码过的，所以它内部不可能有未编码的
  // `&`；但 `file` 之前的参数里可能出现未编码的 `&`（Obsidian 不保证参数顺序），
  // 于是 `file` 永远是"从最后一个 `&file=` 到结尾"这一段。用 searchParams 也可以，
  // 但这条正则更直白地表达了"最后一段"这个事实。
  const match = /[?&]file=([^&]*)$/u.exec(url.search);
  if (match === null) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    // 坏掉的百分号编码：不认（而不是把 `%E4` 当字面量塞进去）。
    return null;
  }
  if (decoded.trim() === '') return null;

  const path = decoded.trim().replace(/\\/gu, '\u0000'); // 反斜杠标记为非法，下面统一拒绝
  // 拒绝清单（每条都在 test-drop-mention.mjs 里有对应断言）：
  if (path.includes('\u0000')) return null;              // 反斜杠分隔符：跨平台歧义
  if (/^[/\\]/u.test(path) || /^[A-Za-z]:/u.test(path) || path.startsWith('//')) return null; // 绝对路径
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) return null;                  // 越界
  if (path.includes('//')) return null;                  // 空段（UNC 或损坏）
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return null;                                 // 控制字符/引号
  if (path.length > MAX_MENTION_PATH_CHARS) return null;
  return path;
}

/**
 * 从 `DataTransfer` 形态的对象里取出可用的 mention 文本（含尾部空格），否则 null。
 *
 * 只读 `text/plain`：那是实测里存在的两个 MIME 之一，且是 **drop 侧唯一保证可读** 的
 * （Chromium 对 `text/uri-list` 在跨源 document 上的可读性没有同等保证）。
 * `types` 里出现 `Files` 时**直接不认**：那是真文件拖拽，归 dsh 自己的附件通道
 * （`dsh-client-ui-attachment` 只处理 `Files`），我们不该截胡。
 */
export function mentionFromDataTransfer(dataTransfer) {
  if (dataTransfer === null || dataTransfer === undefined) return null;
  let types = [];
  let text = '';
  try {
    types = Array.from(dataTransfer.types ?? []);
    if (types.includes('Files')) return null;
    text = dataTransfer.getData('text/plain');
  } catch {
    return null;
  }
  const path = parseObsidianDragText(text);
  if (path === null) return null;
  const mention = formatMention(path);
  return mention === '' ? null : `${mention} `;
}
