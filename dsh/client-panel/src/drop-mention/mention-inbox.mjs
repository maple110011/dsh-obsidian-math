// dsh/client-panel/src/drop-mention/mention-inbox.mjs
//
// 接收**从 Obsidian 侧推来**的引用（拖拽的落点在 Obsidian 文档里，不在这个 iframe 里 —— 见
// `docs/drag-drop-design-2026-09-21.md` §6 的实测结论），并把它落进草稿。
//
// 为什么需要这条通道：实测"从文件列表往侧栏拖"时，**拖拽事件根本没有进入这个跨源 iframe**
// （用户连"可放置提示"都看不到），所以接住拖拽的必须是 Obsidian 那侧；那边解析出库内路径后，
// 用下面两条路之一送进来：
//
//   ① **直插**（首选）：Obsidian 的 `<webview>` 允许跨源执行一小段脚本，于是它直接调本模块
//      挂在 window 上的 `__dshMentionInsert(rel)`。路最短、没有轮询、同一帧内可见。
//   ② **推送**（兜底）：宿主没有那个 API 时，Obsidian 把路径 POST 到它自己的 LinkServer，
//      本模块用 EventSource 订阅 `/mention-stream` 收回来。
//
// 两条路都只是"把文本递到落笔那一步"，而落笔本身仍走 `composer-drop.mjs` 里那条**已经实测过**
// 的合成 paste（插到光标处、不覆盖已有草稿）—— 落笔只有一份实现。
import { formatMention, parseObsidianDragText } from './parse.drop.mjs';
import { installComposerDropMention } from './composer-drop.mjs';

/** 把库内路径写成一次合成 paste 所需的文本（与拖拽那条路完全一致）。 */
export function mentionTextFor(rel) {
  const path = parseObsidianDragText(`obsidian://open?vault=x&file=${encodeURIComponent(String(rel ?? ''))}`);
  if (path === null) return null;
  const mention = formatMention(path);
  return mention === '' ? null : `${mention} `;
}

/**
 * 把一段文本落进草稿：交给 composer 自己的 paste 处理器（插到光标处）。
 *
 * @param rel - 库内相对路径。
 * @param opts.document/opts.window - 覆写（测试用）。
 * @returns true 表示已经递出去（不代表宿主一定接受了；那由端到端探针保证）。
 */
export function insertMentionText(rel, opts = {}) {
  const doc = opts.document ?? (typeof document === 'undefined' ? null : document);
  const win = opts.window ?? (typeof window === 'undefined' ? null : window);
  if (doc === null || win === null) return false;
  const text = mentionTextFor(rel);
  if (text === null) return false;
  let el = null;
  try {
    el = doc.querySelector('[contenteditable="true"]');
  } catch {
    el = null;
  }
  if (el === null) return false;
  try {
    el.focus?.();
    const dt = new win.DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    return true;
  } catch {
    return false;
  }
}

/** 解析 LinkServer 的 SSE 数据行：`data: "<库内路径>"` → 路径（其他行返回 null）。 */
export function parseMentionSseLine(line) {
  const text = String(line ?? '').trim();
  if (!text.startsWith('data:')) return null;
  const raw = text.slice('data:'.length).trim();
  if (raw === '') return null;
  try {
    const value = JSON.parse(raw);
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return raw; // 不是 JSON 就按原样用（容错：推送端格式变了也不至于完全断掉）
  }
}

/**
 * 从页面里读"拖拽引用通道"的地址。
 *
 * Obsidian 插件在改写导航 HTML 时注入 `<meta name="dsh-math-memory-mention-stream" content="…">`
 * （`DshWebProxy.mentionChannelMeta`）。页面**无从知道** LinkServer 的端口与令牌，所以必须由
 * 插件把它交出来；没有这个 meta 就只保留直插那条路。
 */
export function mentionStreamUrlFromDocument(doc) {
  try {
    const meta = doc?.querySelector?.('meta[name="dsh-math-memory-mention-stream"]');
    const content = meta === null || meta === undefined ? '' : (meta.getAttribute('content') ?? '');
    return typeof content === 'string' ? content.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 安装推送通道（兜底那条）。
 *
 * @param opts.url - LinkServer 的 `/mention-stream` 完整地址；没有就只保留直插那条路。
 * @param opts.document/opts.window - 覆写（测试用）。
 * @returns disposer。
 */
export function installMentionInbox(opts = {}) {
  const win = opts.window ?? (typeof window === 'undefined' ? null : window);
  const doc = opts.document ?? (typeof document === 'undefined' ? null : document);
  if (win === null || doc === null) return () => {};

  // ① 直插入口：Obsidian 那侧调这个函数。装成 window 上的一等函数，方便那边一行调用。
  const insert = (rel) => insertMentionText(rel, { document: doc, window: win });
  try { win.__dshMentionInsert = insert; } catch { /* window 被冻结：只剩推送那条路 */ }

  // ② 推送通道：地址优先取显式传参，其次取插件注入的 meta。
  let source = null;
  const explicit = typeof opts.url === 'string' ? opts.url.trim() : '';
  const url = explicit !== '' ? explicit : mentionStreamUrlFromDocument(doc);
  if (url !== '' && typeof win.EventSource === 'function') {
    try {
      source = new win.EventSource(url);
      source.addEventListener('message', (event) => {
        const rel = parseMentionSseLine(event?.data);
        if (rel !== null) insert(rel);
      });
      // 断线由 EventSource 自己重连；这里只留痕，便于排查"推送不通"。
      source.addEventListener('error', () => {
        try { win.console?.debug?.('[dsh-math-memory] mention-stream 断开，等待自动重连'); } catch { /* ignore */ }
      });
    } catch {
      source = null;
    }
  }

  return () => {
    try { if (source !== null) source.close(); } catch { /* already closed */ }
    try { if (win.__dshMentionInsert === insert) delete win.__dshMentionInsert; } catch { /* ignore */ }
  };
}

/** 两条路一起装：直插 +（可选）推送。返回 disposer。 */
export function installMentionInboxWithDrop(opts = {}) {
  const disposeDrop = installComposerDropMention(opts);
  const disposeInbox = installMentionInbox(opts);
  return () => { disposeInbox(); disposeDrop(); };
}
