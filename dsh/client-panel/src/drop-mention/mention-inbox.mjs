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

/** 诊断上报的 meta 名（与 `mention-stream` 同一个注入点，见 `DshWebProxy.mentionChannelMeta`）。 */
export const MENTION_REPORT_META = 'dsh-math-memory-mention-report';

/** 把库内路径写成一次合成 paste 所需的文本（与拖拽那条路完全一致）。 */
export function mentionTextFor(rel) {
  const path = parseObsidianDragText(`obsidian://open?vault=x&file=${encodeURIComponent(String(rel ?? ''))}`);
  if (path === null) return null;
  const mention = formatMention(path);
  return mention === '' ? null : `${mention} `;
}

/**
 * 落笔**为什么**失败（自述诊断）。
 *
 * WHY 需要它：`insertMentionText` 的每一处失败都只能返回 `false`（它是个"递出去没有"的布尔契约），
 * 于是"拖进去没反应"在现场**没有任何线索** —— 2026-09-21 就是这样查了一轮：SSE 通道在进程层面
 * 实测完全正常（POST 204 → `data: "路径"`），页面也确实订阅着（39217 上有来自渲染进程的 ESTABLISHED
 * 连接），但草稿始终为空，而日志里一个字节都没有。**静默的失败分支必须自述。**
 *
 * 只在"路径拿在手里之后"调用（解析失败那条有确定答案，不需要现场信息）。
 * 返回的字段都是**定长/定类**的：调用方会把它们拼上报 URL，所以不放路径原文（避免路径里的特殊字符
 * 破坏上报；路径本身在服务端那条 POST 日志里已经有了）。
 */
export function describeMentionInsert(rel, opts = {}) {
  const doc = opts.document ?? (typeof document === 'undefined' ? null : document);
  const win = opts.window ?? (typeof window === 'undefined' ? null : window);
  const out = { step: 'start', ok: false, hadDocument: doc !== null, hadWindow: win !== null, textLen: 0, editable: 'not-queried', target: 'none', error: '' };
  if (doc === null || win === null) { out.step = 'no-global'; return out; }
  const text = mentionTextFor(rel);
  out.textLen = text === null ? 0 : text.length;
  if (text === null) { out.step = 'no-text'; return out; }
  let all = null;
  try {
    all = doc.querySelectorAll('[contenteditable="true"]');
    out.editable = String(all.length);
  } catch (error) {
    out.editable = 'query-threw';
    out.error = String(error?.message ?? error).slice(0, 60);
    out.step = 'query';
    return out;
  }
  const el = all.length === 0 ? null : all[0];
  if (el === null) { out.step = 'no-element'; return out; }
  try {
    out.target = String(el.tagName ?? '?').toLowerCase() + '.' + String(el.className ?? '').split(' ').filter((x) => x !== '').slice(0, 2).join('.');
  } catch { out.target = 'unknown'; }
  try {
    el.focus?.();
    const dt = new win.DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    out.step = 'dispatched';
    out.ok = true;
    return out;
  } catch (error) {
    out.step = 'dispatch-threw';
    out.error = String(error?.message ?? error).slice(0, 60);
    return out;
  }
}

/**
 * 把一次落笔的结果发回 Obsidian 那侧，写进插件日志（fire-and-forget）。
 *
 * 走 `fetch(..., { mode: 'no-cors' })`：这是跨源写、且我们**不需要**读响应 —— `no-cors` 下响应是
 * opaque，但请求照发，省掉一切 preflight/凭据纠缠。上报失败**绝不能**影响插入本身。
 */
export function reportMentionDiagnostic(diagnostic, opts = {}) {
  const doc = opts.document ?? (typeof document === 'undefined' ? null : document);
  const win = opts.window ?? (typeof window === 'undefined' ? null : window);
  if (doc === null || win === null || typeof win.fetch !== 'function') return false;
  const base = typeof opts.reportUrl === 'string' && opts.reportUrl !== '' ? opts.reportUrl : mentionReportUrlFromDocument(doc);
  if (base === '') return false;
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(diagnostic ?? {})) {
    if (value === undefined || value === null) continue;
    q.set(key, String(value).slice(0, 120));
  }
  try {
    win.fetch(`${base}${base.includes('?') ? '&' : '?'}${q.toString()}`, { mode: 'no-cors', cache: 'no-store', keepalive: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** 从页面里读诊断上报地址（插件注入；没有就不上报）。 */
export function mentionReportUrlFromDocument(doc) {
  try {
    const meta = doc?.querySelector?.(`meta[name="${MENTION_REPORT_META}"]`);
    const content = meta === null || meta === undefined ? '' : (meta.getAttribute('content') ?? '');
    return typeof content === 'string' ? content.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 把一段文本落进草稿：交给 composer 自己的 paste 处理器（插到光标处）。
 *
 * @param rel - 库内相对路径。
 * @param opts.document/opts.window - 覆写（测试用）。
 * @returns true 表示已经递出去（不代表宿主一定接受了；那由端到端探针保证）。
 */
export function insertMentionText(rel, opts = {}) {
  return describeMentionInsert(rel, opts).ok;
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

  // 自述诊断（只有真的跑起来才知道落笔死在哪一步，见 `describeMentionInsert` 的注释）。
  //
  // **每一次都上报**，成功与失败都报。为什么不"只在失败时报"：那要先判断返回值，而
  // "处理器到底有没有被调用"本身正是最容易丢的那一环 —— 2026-09-21 现场就是"页面收到了消息、落笔
  // 入口也在、直调也成功，但入口一次都没被调用"，而那种形状旧实现**一个字节都不会记**。
  // 每一次落笔最多一行日志，换掉一整轮盲查是划算的。
  let attemptNo = 0;
  const attempt = (rel, via) => {
    attemptNo += 1;
    const diagnostic = describeMentionInsert(rel, { document: doc, window: win });
    reportMentionDiagnostic({ ...diagnostic, via, n: attemptNo, rel }, { document: doc, window: win, reportUrl: opts.reportUrl });
    return diagnostic.ok;
  };

  // ① 直插入口：Obsidian 那侧调这个函数。装成 window 上的一等函数，方便那边一行调用。
  const insert = (rel) => attempt(rel, 'direct');
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
        if (rel !== null) attempt(rel, 'stream');
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
