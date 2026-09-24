// dsh/client-panel/src/drop-mention/composer-drop.mjs
//
// 把「从 Obsidian 拖一篇笔记进来」接到 dsh 的输入框上。
//
// WHY THIS SHAPE（每一条都有实测依据，见 docs/drag-drop-design-2026-09-21.md §1）：
//
//   · 挂在 `document` 的**冒泡阶段**。实测 dsh 对非文件 drop 既不 preventDefault 也不
//     stopPropagation（`scripts/qa/composer-drop-probe.mjs`），所以冒泡阶段收得到；
//     换捕获阶段没坏处但也没必要。
//
//   · 递文本用**一次合成 `paste` 事件**，而不是会话 API `setDraft`。理由具体：
//     `setDraft` 需要会话作用域的 ctx 或会话 id（客户端根上下文里没有"当前会话"的公开读法），
//     而且它**整体替换**草稿 —— 用户拖进来时草稿里往往已经有半句话。
//     dsh 的 composer 自己注册了 paste 处理器（读 `clipboardData.getData("text/plain")` 再走
//     `pasteText`，`dsh-client-ui-conversation/lib/client.js:15259-15273`），所以"把文本递给宿主、
//     让宿主决定插到哪儿"是最小改动面。代价是它**不是公开契约** ⇒ 由端到端探针钉住。
//
//   · `dragover` 只在"非 Files + 有 text/plain"时 preventDefault：真文件拖拽仍归
//     `dsh-client-ui-attachment`（它只认 `Files`），我们不该截胡。
//
// 安装是幂等的，返回 disposer。所有 DOM 访问都走 `opts` 覆写的 `document`/`window`，
// 于是接线本身也能在无浏览器环境里回归（`scripts/test-drop-mention.mjs`）。
import { mentionFromDataTransfer } from './parse.drop.mjs';

/** 幂等标记：重复安装只保留一份监听。 */
const INSTALL_KEY = '__dshMathMemoryDropMention';
const HINT_CLASS = 'dsh-math-memory-drop-hint';

/** 拖动期间的可见提示。位置固定，不参与布局，所以不会挡住输入框。 */
const HINT_TEXT = '松手即可引用这篇笔记';

/**
 * 这个 DataTransfer 看起来是不是"一篇 Obsidian 笔记"？
 * 只看 `types`，不解析内容 —— `dragover` 期间读不到 data，而这里只需要知道"能不能接"。
 */
function looksLikeObsidianItem(dataTransfer) {
  if (dataTransfer === null || dataTransfer === undefined) return false;
  try {
    const types = Array.from(dataTransfer.types ?? []);
    if (types.includes('Files')) return false;
    return types.includes('text/plain');
  } catch {
    return false;
  }
}

/**
 * 安装拖拽 → `@引用` 的行为。
 *
 * @param opts.document - DOM document（默认全局 `document`）。
 * @param opts.window - window（默认全局 `window`）；用于幂等标记。
 * @returns disposer：摘掉全部监听与提示；可重复调用。
 */
export function installComposerDropMention(opts = {}) {
  const doc = opts.document ?? (typeof document === 'undefined' ? null : document);
  const win = opts.window ?? (typeof window === 'undefined' ? null : window);
  if (doc === null || typeof doc.addEventListener !== 'function') {
    return () => {}; // 没有 DOM：静默不装（宿主可能在没有 document 的环境里求值本模块）
  }
  if (win !== null && win[INSTALL_KEY] !== undefined) {
    // 已经装过：返回那个 disposer，避免"装两次、摘一次"留下孤儿监听。
    return win[INSTALL_KEY];
  }

  let hint = null;

  const hideHint = () => {
    if (hint === null) return;
    try {
      hint.parentNode?.removeChild?.(hint);
    } catch { /* 节点已经不在：忽略 */ }
    hint = null;
  };

  const showHint = () => {
    if (hint !== null) return;
    try {
      const el = doc.createElement('div');
      el.className = HINT_CLASS;
      el.textContent = HINT_TEXT;
      el.setAttribute('style', [
        'position:fixed',
        'right:18px',
        'bottom:96px',
        'z-index:2147483000',
        'padding:6px 12px',
        'border-radius:999px',
        'font-size:12px',
        'line-height:18px',
        'pointer-events:none',
        'background:var(--dsw-alias-bg-mask-1, rgba(0,0,0,.72))',
        'color:var(--dsw-alias-label-primary, #fff)',
        'box-shadow:0 4px 16px rgba(0,0,0,.25)'
      ].join(';'));
      (doc.body ?? doc.documentElement)?.appendChild?.(el);
      hint = el;
    } catch {
      hint = null; // 提示是装饰，失败不能影响引用本身
    }
  };

  /** 落点：从 drop 的元素往上找 composer；找不到就退回页面上唯一的那个。 */
  const composerFor = (target) => {
    let node = target ?? null;
    for (let depth = 0; node !== null && depth < 40; depth += 1) {
      if (typeof node.matches === 'function' && node.matches('[contenteditable="true"]')) return node;
      node = node.parentNode ?? null;
    }
    try {
      return doc.querySelector('[contenteditable="true"]');
    } catch {
      return null;
    }
  };

  /**
   * 把 mention 文本交给 composer 自己的 paste 处理器。
   *
   * `el.focus()` 先执行：paste 处理器走的是编辑器现有选区，焦点不在上面时
   * Lexical 可能把插入落在陈旧的位置。合成事件不携带用户手势，所以这里必须自己保证前置状态。
   */
  const insertViaPaste = (el, text) => {
    try {
      el.focus?.();
      const dt = new win.DataTransfer();
      dt.setData('text/plain', text);
      const event = new win.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      el.dispatchEvent(event);
      return true;
    } catch {
      return false;
    }
  };

  const onDragOver = (event) => {
    if (!looksLikeObsidianItem(event.dataTransfer)) return;
    // 只有 preventDefault 过的目标才会收到 drop。
    event.preventDefault();
  };

  const onDragEnter = (event) => {
    if (!looksLikeObsidianItem(event.dataTransfer)) return;
    showHint();
  };

  const onDragLeave = (event) => {
    // dragleave 在跨子元素时也会触发；只有真的离开文档（relatedTarget 为空）才收提示，
    // 否则提示会一闪一闪。
    if (event.relatedTarget !== null && event.relatedTarget !== undefined) return;
    hideHint();
  };

  const onDragEnd = () => {
    // 拖动被取消（Esc / 拖回原处）时不会有 drop，只能靠 dragend 收尾。
    // 少了这一条，提示会永久留在屏幕上 —— 与坑 55（挂起必须能自愈）同族。
    hideHint();
  };

  const onDrop = (event) => {
    const mention = mentionFromDataTransfer(event.dataTransfer);
    hideHint();
    if (mention === null) return; // 不是我们的载荷：放行，让宿主自己处理
    const el = composerFor(event.target);
    if (el === null) return;
    event.preventDefault();
    // 不让别处再处理同一次 drop（宿主对非 Files 本来就不处理，这里只是把意图写明确）。
    event.stopPropagation?.();
    insertViaPaste(el, mention);
  };

  // 冒泡阶段（第三个参数 false）：实测 dsh 对非文件 drop 既不 preventDefault 也不
  // stopPropagation，所以冒泡阶段收得到；用捕获阶段也可以，但没必要抢在宿主之前。
  doc.addEventListener('dragover', onDragOver, false);
  doc.addEventListener('dragenter', onDragEnter, false);
  doc.addEventListener('dragleave', onDragLeave, false);
  doc.addEventListener('dragend', onDragEnd, false);
  doc.addEventListener('drop', onDrop, false);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('dragover', onDragOver, false);
    doc.removeEventListener('dragenter', onDragEnter, false);
    doc.removeEventListener('dragleave', onDragLeave, false);
    doc.removeEventListener('dragend', onDragEnd, false);
    doc.removeEventListener('drop', onDrop, false);
    hideHint();
    if (win !== null && win[INSTALL_KEY] === dispose) delete win[INSTALL_KEY];
  };
  // 测试接缝：把内部处理器挂在 disposer 上，让回归能驱动**真源码里的真处理器**
  // （`scripts/test-drop-mention.mjs`）。替代方案是让测试自己重写一遍行为 —— 那份重写
  // 一旦与产品漂移，测的就是测试自己的实现（坑 29 同族）。生产代码不读这个字段。
  dispose.__handlers = { onDragOver, onDragEnter, onDragLeave, onDragEnd, onDrop };
  if (win !== null) {
    // 幂等标记**同时**是外部可取的句柄：第二次安装复用同一份，而不是装两套监听。
    win[INSTALL_KEY] = dispose;
  }
  return dispose;
}
