// scripts/test-drop-mention.mjs — 「从 Obsidian 文件树拖一篇笔记进输入框」的零 token 回归。
//
// WHY THIS SUITE IS SHAPED LIKE THIS。这个功能有两块，风险完全不同：
//
//   · **解析拖拽载荷**：载荷是宿主格式（`obsidian://open?vault=…&file=…`），最可能变，
//     而且每条拒绝条件的错法都很难看 —— 猜错就会往提示词塞一个指向**库外**的 `@` 引用
//     （`@` 是接受绝对路径的）。这里逐条钉住。
//   · **接线**：`dragover` 该不该 preventDefault、`drop` 什么时候放行、落点怎么选、
//     disposer 有没有真的摘干净、重复安装会不会留下孤儿监听。这些错了的表现是
//     "拖进去没反应"（静默），离线根本看不出来。
//
// **它跑的是真正的产物**：`dsh/client-panel/lib/client.js` 用宿主那套 ModuleLoader 协议
// 求值（`window.__ModuleLoader__.load({id, factory})`），再调它的 `apply()`。所以
// "改了源码忘了重建 bundle" 会在这里红，而不是等用户发现功能不存在。
//
// 事件处理器通过安装结果的 `__handlers` 拿到 —— 那是安装器专门为测试留的接缝，
// 目的是让断言驱动**真源码里的真处理器**，而不是测试自己重写一遍行为（重写的那份一旦
// 与产品漂移，测的就是测试自己的实现，坑 29 同族）。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(root, 'dsh', 'client-panel', 'lib', 'client.js');

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

// ── 一个够用的假 DOM ─────────────────────────────────────────────────────────
class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, init);
    this.type = type;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

/** `DataTransfer` 替身。`setData` 的类型校验照抄真实规则（带空格的类型必须抛）。 */
class FakeDataTransfer {
  constructor(values = {}) { this._values = { ...values }; }
  get types() { return Object.keys(this._values); }
  getData(type) { return Object.prototype.hasOwnProperty.call(this._values, type) ? this._values[type] : ''; }
  setData(type, value) {
    if (typeof type !== 'string' || type.includes(' ')) throw new Error('invalid type');
    this._values[type] = String(value);
  }
}

class FakeElement {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.tagName = String(tagName).toUpperCase();
    this.className = '';
    this.textContent = '';
    this.parentNode = null;
    this.childNodes = [];
    this._attrs = {};
    this.pastes = [];
  }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name); }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  matches(selector) {
    if (selector === '[contenteditable="true"]') return this.getAttribute('contenteditable') === 'true';
    return false;
  }
  focus() { this.focused = true; }
  /** `paste` 被记录下来而不是真的改文本：测试断言的是「我们递了什么」。 */
  dispatchEvent(event) {
    if (event.type === 'paste') this.pastes.push(event);
    return true;
  }
}

function makeDom() {
  const document = {
    listeners: [],
    elements: [],
    createElement(tagName) {
      const el = new FakeElement(document, tagName);
      document.elements.push(el);
      return el;
    },
    querySelector(selector) {
      if (selector !== '[contenteditable="true"]') return null;
      return document.elements.find((el) => el.matches(selector)) ?? null;
    },
    // 落笔路径用 `querySelectorAll` 来数"页面上有几个可编辑元素"（诊断的一部分：真页面里
    // `[contenteditable="true"]` 未必唯一，取第一个可能不是输入框）。假 DOM 必须提供它，
    // 否则诊断会走 `query-threw` 分支 —— 那是"假 DOM 缺件"造成的假红，不是产品缺陷。
    querySelectorAll(selector) {
      if (selector !== '[contenteditable="true"]') return [];
      return document.elements.filter((el) => el.matches(selector));
    },
    addEventListener(type, handler, capture) { document.listeners.push({ type, handler, capture: capture === true }); },
    removeEventListener(type, handler, capture) {
      const i = document.listeners.findIndex((l) => l.type === type && l.handler === handler && l.capture === (capture === true));
      if (i >= 0) document.listeners.splice(i, 1);
    }
  };
  document.body = new FakeElement(document, 'body');
  document.documentElement = new FakeElement(document, 'html');
  const window = { DataTransfer: FakeDataTransfer, ClipboardEvent: FakeEvent };
  // 幂等标记用 `in` 判断（安装器知道它会留下一个 undefined 的键），所以假 window 必须
  // **预制**这个键 —— 否则 `in` 为假，安装器每次都当"没装过"，测试也就拿不到句柄。
  window.__dshMathMemoryDropMention = undefined;
  return { document, window };
}

// ── 用宿主协议加载**真产物** ────────────────────────────────────────────────
if (!existsSync(BUNDLE)) {
  console.log(`[FAIL] 客户端产物存在 | ${BUNDLE} 缺失（先跑 npm run build:client）`);
  console.log('__CHECKS__ 0/1');
  process.exit(1);
}
const source = readFileSync(BUNDLE, 'utf8');

let exports = null;
let loadError = null;
try {
  const win = {
    __ModuleLoader__: {
      load({ id, factory }) {
        // 与宿主同形：`factory(require)` 内部自建 module/exports 再返回。
        const req = (name) => {
          if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: null };
          if (name === 'react') {
            return {
              useEffect: () => {},
              useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
              memo: (c) => c
            };
          }
          throw new Error(`unexpected require(${name})`);
        };
        exports = { id, module: factory(req) };
      }
    }
  };
  // eslint-disable-next-line no-new-func -- 求值的是本仓库自己的构建产物
  new Function('window', source)(win);
} catch (error) {
  loadError = error;
}
check('产物能用宿主的 ModuleLoader 协议求值', loadError === null, loadError === null ? '' : String(loadError?.message ?? loadError));
check('产物导出了 apply（插件的装配入口）', typeof exports?.module?.apply === 'function');

// ── 装配：apply(ctx) 必须装上 drop 行为，并跟随 fiber 清理 ───────────────────
//
// 安装器从产物里**导出**（`index.jsx` 再导出它），所以这个套件可以直接注入假 DOM ——
// 不需要去改写 Node 的全局 `document`/`window`。这一点是被一次真实的失败逼出来的：
// 早先的版本靠 `globalThis.window = fake` 让安装器走缺省回退，结果安装器把句柄写到了
// 一个**与测试所读并不是同一个**对象上，测试只能看到 `undefined`。把依赖显式化之后，
// 这类"看得见却拿不到"的状态不可能再出现。
const { document: doc, window: win } = makeDom();
const composer = doc.createElement('div');
composer.setAttribute('contenteditable', 'true');
const install = exports.module.installComposerDropMention;
check('产物导出了 installComposerDropMention（测试与装配共用同一实现）', typeof install === 'function');

const dispose = install({ document: doc, window: win });
const handlers = dispose.__handlers ?? win.__dshMathMemoryDropMention?.__handlers;
check('安装器返回带测试接缝的 disposer',
  handlers !== undefined && typeof handlers.onDrop === 'function',
  handlers === undefined ? '(none)' : Object.keys(handlers).join(','));

// 真实装配路径也要走通：apply(ctx) 自己会装一次，并注册可清理的 effect。
const effects = [];
const fakeCtx = {
  effect: (fn, name) => { effects.push({ fn, name }); },
  inject: () => {}
};
let installError = null;
try {
  exports.module.apply(fakeCtx);
} catch (error) {
  installError = error;
}
check('apply() 没有抛异常', installError === null, installError === null ? '' : String(installError?.message ?? installError));
check('apply() 注册了两个可清理的 effect（drop-mention + mention-inbox）',
  effects.length === 2 && effects.map((e) => e.name).join(',') === 'drop-mention,mention-inbox',
  JSON.stringify(effects.map((e) => e.name)));
check('重复安装复用同一份监听（幂等：不会留下孤儿监听）',
  doc.listeners.length === 5, `listeners=${doc.listeners.length}`);

check('五个监听都挂上了（dragover/dragenter/dragleave/dragend/drop）',
  doc.listeners.length === 5 && ['dragover', 'dragenter', 'dragleave', 'dragend', 'drop'].every((t) => doc.listeners.some((l) => l.type === t)),
  doc.listeners.map((l) => l.type).join(','));
check('监听挂在冒泡阶段（实测 dsh 不吞，无需抢捕获）',
  doc.listeners.every((l) => l.capture === false), JSON.stringify(doc.listeners.map((l) => l.capture)));

const OBS = (file) => `obsidian://open?vault=%E6%95%B0%E5%AD%A6%E7%AC%94%E8%AE%B0&file=${encodeURIComponent(file)}`;
/**
 * 一次 drop：把 text/plain 装进 DataTransfer，调真处理器，返回事件与**这一次**递出去的文本。
 *
 * 必须按"这次有没有新增 paste"判断，不能让"最后一次 paste"兜底 —— 早先那个写法在**拒绝**
 * 的用例上会回退到上一条成功用例的 paste，于是所有拒绝断言都"看到"了上一次的文本，
 * 红得莫名其妙（而产品其实是对的）。
 */
function dropWith(textValue, { withTextPlain = true, target = composer } = {}) {
  const dt = new FakeDataTransfer(withTextPlain ? { 'text/plain': textValue } : {});
  const event = new FakeEvent('drop', { dataTransfer: dt, target });
  const countBefore = composer.pastes.length;
  handlers.onDrop(event);
  const added = composer.pastes.length > countBefore;
  return {
    event,
    pasted: added ? composer.pastes[composer.pastes.length - 1].clipboardData.getData('text/plain') : null
  };
}

// ── 1. 正常载荷 ─────────────────────────────────────────────────────────────
{
  const { event, pasted } = dropWith(OBS('数学/随便.md'));
  check('正常载荷：草稿里拿到 @库内路径 + 尾随空格', pasted === '@数学/随便.md ', JSON.stringify(pasted));
  check('正常载荷：事件被拦截（不再让宿主处理同一次 drop）',
    event.defaultPrevented === true && event.propagationStopped === true);
  check('正常载荷：递出去的是可取消、会冒泡的合成 paste',
    composer.pastes[0]?.bubbles === true && composer.pastes[0]?.cancelable === true);
  check('正常载荷：落笔前先 focus 了 composer（合成事件没有用户手势）', composer.focused === true);
  check('正常载荷：只递了一次 paste（没有重复插入）', composer.pastes.length === 1, String(composer.pastes.length));
}

// ── 2. 边角：空格 / 中文 / `&` / `#` / 全角括号 ──────────────────────────────
{
  const cases = [
    ['带空格的路径要加引号（否则 @ 只吃到第一个词）', '数学/实分析/一致收敛 与 逐点收敛.md', '@"数学/实分析/一致收敛 与 逐点收敛.md" '],
    ['全角括号与中文正常', '笔记/（草稿）拓扑.md', '@笔记/（草稿）拓扑.md '],
    ['文件名里的 & 与 # 能解出来', '笔记/a&b#c.md', '@笔记/a&b#c.md '],
    ['嵌套目录', '数学/概率论/胎紧与弱收敛.md', '@数学/概率论/胎紧与弱收敛.md ']
  ];
  for (const [name, file, want] of cases) {
    const { pasted } = dropWith(OBS(file));
    check(`载荷：${name}`, pasted === want, `want=${JSON.stringify(want)} got=${JSON.stringify(pasted)}`);
  }
  // `file` 必须是**最后一个**参数：前面带未编码 `&` 的参数不能把 file 吃掉
  const tricky = `obsidian://open?vault=v&x=1&y=2&file=${encodeURIComponent('笔记/引用&测试.md')}`;
  const { pasted: trickyPasted } = dropWith(tricky);
  check('载荷：`file=` 取的是最后一个参数（前面的 & 不吃掉它）',
    trickyPasted === '@笔记/引用&测试.md ', JSON.stringify(trickyPasted));
}

// ── 3. 必须拒绝的载荷（每条都对应源码里的一个判断） ──────────────────────────
{
  const rejects = [
    ['不是 obsidian scheme', 'https://example.com/x.md'],
    ['是 obsidian 但不是 open 动作', 'obsidian://search?vault=v&query=x'],
    ['没有 file 参数', 'obsidian://open?vault=v'],
    ['file 为空', 'obsidian://open?vault=v&file='],
    ['绝对路径（@ 会接受它，绝不能塞进去）', 'obsidian://open?vault=v&file=%2Fetc%2Fpasswd'],
    ['Windows 盘符', 'obsidian://open?vault=v&file=' + encodeURIComponent('C:\\Windows\\win.ini')],
    ['反斜杠分隔符', 'obsidian://open?vault=v&file=' + encodeURIComponent('数学\\随便.md')],
    ['路径穿越 ..', 'obsidian://open?vault=v&file=' + encodeURIComponent('../secret.md')],
    ['当前目录 . 段', 'obsidian://open?vault=v&file=' + encodeURIComponent('a/./b.md')],
    ['空段 //', 'obsidian://open?vault=v&file=' + encodeURIComponent('a//b.md')],
    ['坏掉的百分号编码', 'obsidian://open?vault=v&file=%E4%B8'],
    ['多行（多选拖拽暂不支持）', 'obsidian://open?vault=v&file=a.md\nobsidian://open?vault=v&file=b.md'],
    ['纯文本（不是 URI）', '随便一句普通文字'],
    ['空/空白', '   ']
  ];
  for (const [name, payload] of rejects) {
    const { event, pasted } = dropWith(payload);
    check(`拒绝：${name}`, pasted === null && event.defaultPrevented === false,
      `pasted=${JSON.stringify(pasted)} defaultPrevented=${event.defaultPrevented}`);
  }
  // 超长路径（与 /open、/feedback 的 2000 字符上限一致）
  const tooLong = 'obsidian://open?vault=v&file=' + encodeURIComponent('a'.repeat(2001) + '.md');
  const { pasted: longPasted } = dropWith(tooLong);
  check('拒绝：路径超过 2000 字符', longPasted === null, JSON.stringify(String(longPasted).slice(0, 40)));
}

// ── 4. 真文件拖拽（Files）必须放行给 dsh 自己的附件通道 ──────────────────────
{
  const dt = new FakeDataTransfer({ Files: '' });
  const event = new FakeEvent('drop', { dataTransfer: dt, target: composer });
  const before = composer.pastes.length;
  handlers.onDrop(event);
  check('Files 拖拽：不插入 mention、不拦截（归 dsh 的附件通道）',
    composer.pastes.length === before && event.defaultPrevented === false);
  const fileOver = new FakeEvent('dragover', { dataTransfer: new FakeDataTransfer({ Files: '' }) });
  handlers.onDragOver(fileOver);
  check('dragover：Files 时不 preventDefault（把落点让给 dsh）', fileOver.defaultPrevented === false);
  const textOver = new FakeEvent('dragover', { dataTransfer: new FakeDataTransfer({ 'text/plain': OBS('a.md') }) });
  handlers.onDragOver(textOver);
  check('dragover：非 Files + text/plain 时 preventDefault（否则收不到 drop）', textOver.defaultPrevented === true);
  const junkOver = new FakeEvent('dragover', { dataTransfer: new FakeDataTransfer({ 'text/html': '<b>x</b>' }) });
  handlers.onDragOver(junkOver);
  check('dragover：既没 Files 也没 text/plain 时不 preventDefault', junkOver.defaultPrevented === false);
}

// ── 5. 落点与提示 ───────────────────────────────────────────────────────────
{
  const outside = doc.createElement('div');
  const { pasted } = dropWith(OBS('笔记/任意.md'), { target: outside });
  check('落点：不在输入框内时退回页面上的 composer', pasted === '@笔记/任意.md ', JSON.stringify(pasted));

  // 注意取的是**最后一个**提示节点：收掉提示只是把它从 DOM 上摘下来，节点对象仍在
  // `doc.elements` 里，`find()` 会一直返回那个已经摘掉的旧节点 —— 那样断言就永远看到
  // "上一次的提示"，与产品行为无关。
  const hint = () => [...doc.elements].reverse().find((el) => el.className === 'dsh-math-memory-drop-hint');
  const hintShown = () => { const h = hint(); return h !== undefined && h.parentNode !== null; };
  const enter = () => handlers.onDragEnter(new FakeEvent('dragenter', { dataTransfer: new FakeDataTransfer({ 'text/plain': OBS('a.md') }) }));
  enter();
  check('提示：拖动进入时出现', hintShown());
  handlers.onDragLeave(new FakeEvent('dragleave', { relatedTarget: null }));
  check('提示：真的离开文档时收掉', hintShown() === false);
  // 跨子元素的 dragleave 不能收掉提示，否则提示会一闪一闪
  enter();
  const shown = hint();
  handlers.onDragLeave(new FakeEvent('dragleave', { relatedTarget: composer }));
  check('提示：跨子元素时不收（否则会一闪一闪）',
    shown !== undefined && shown.parentNode !== null && hintShown(), `shown=${hintShown()}`);
  handlers.onDragEnd();
  check('提示：拖动被取消（dragend）时也收掉——不会永久留在屏幕上', hintShown() === false);
}

// ── 7. 「Obsidian 侧推来」的入口（mention-inbox）────────────────────────────
//
// WHY 这一节存在（2026-09-21 实测）：**在真实 Obsidian 里，从文件列表拖到侧栏时，拖拽事件
// 根本不会进入那个跨源 iframe**（用户连"可放置提示"都看不到）。所以真正让侧栏能用的不是上面的
// drop 监听，而是"Obsidian 那侧接住、再把库内路径送进来"这条通道。它有两个入口：
//   ① 直插：Obsidian 的 webview 跨源执行一小段脚本，调 `window.__dshMentionInsert(rel)`；
//   ② 推送：Obsidian POST 给 LinkServer，页面用 EventSource 订阅 `/mention-stream`。
{
  const { document: d3, window: w3 } = makeDom();
  const composer3 = d3.createElement('div');
  composer3.setAttribute('contenteditable', 'true');
  const installInbox = exports.module.installMentionInbox;
  const insertMentionText = exports.module.insertMentionText;
  const parseMentionSseLine = exports.module.parseMentionSseLine;
  check('产物导出了 mention-inbox 的入口与纯函数',
    typeof installInbox === 'function' && typeof insertMentionText === 'function' && typeof parseMentionSseLine === 'function');

  const disposeInbox = installInbox({ document: d3, window: w3, url: '' });
  check('直插入口挂在 window 上（Obsidian 那侧一行就能调）', typeof w3.__dshMentionInsert === 'function');
  const okInsert = w3.__dshMentionInsert('数学/随便.md');
  const pasted = composer3.pastes.length === 0 ? null : composer3.pastes[0].clipboardData.getData('text/plain');
  check('直插：把 @库内路径 递给了 composer 的 paste 处理器', okInsert === true && pasted === '@数学/随便.md ',
    `ok=${String(okInsert)} pasted=${JSON.stringify(pasted)}`);
  // 与拖拽那条路共用同一套校验：非法路径一样要被拒。
  const beforeCount = composer3.pastes.length;
  check('直插：非法路径被拒（不往草稿里塞越界内容）',
    w3.__dshMentionInsert('../secret.md') === false && composer3.pastes.length === beforeCount);
  check('直插：带空格的路径加引号', w3.__dshMentionInsert('笔记/一 致 收敛.md') === true
    && composer3.pastes[composer3.pastes.length - 1].clipboardData.getData('text/plain') === '@"笔记/一 致 收敛.md" ',
    JSON.stringify(composer3.pastes[composer3.pastes.length - 1]?.clipboardData.getData('text/plain')));

  // SSE 数据行解析：正常/带引号的 JSON/裸串/非数据行。
  check('SSE 行：`data: "路径"` 解析成路径', parseMentionSseLine('data: "数学/随便.md"') === '数学/随便.md');
  check('SSE 行：非 JSON 的裸串按原样用（容错）', parseMentionSseLine('data: 数学/随便.md') === '数学/随便.md');
  check('SSE 行：心跳/空行/其它字段都返回 null',
    parseMentionSseLine(': keep-alive') === null && parseMentionSseLine('') === null && parseMentionSseLine('event: x') === null);

  disposeInbox();
  check('mention-inbox 清理后直插入口也摘掉', w3.__dshMentionInsert === undefined);
}

// ── 6. 清理与幂等 ───────────────────────────────────────────────────────────
{
  const before = doc.listeners.length;
  dispose();
  check('disposer 摘掉自己装的监听', doc.listeners.length === 0 && before === 5, `${before} → ${doc.listeners.length}`);
  check('清理后幂等标记回到"已预制但未安装"（允许重新安装）', win.__dshMathMemoryDropMention === undefined);
  dispose();
  check('disposer 可重复调用（再调一次不抛、也不破坏状态）', doc.listeners.length === 0);
  // 重新安装能恢复工作（不是一次性）
  const again = install({ document: doc, window: win });
  check('清理后可以重新安装', doc.listeners.length === 5 && typeof again.__handlers?.onDrop === 'function');
  again();
}

// ── 8. Obsidian 侧落点的**静态契约**（CSS 自锁 + 监听挂载点）─────────────────
//
// WHY 这一节（2026-09-21 真实故障）：落点原来写的是 `display: none`，而 `display: none` 的元素
// **不参与命中测试** ⇒ 永远收不到 `dragenter` ⇒ 而"拖动时才显示"正是靠 `dragenter` 打开的
// ⇒ **自锁**：功能静默失效，日志里只有"落点已安装"，别的什么都没有。同类还有第二个自锁：
// `visibility: hidden` 的元素**也不接收事件**，所以检测必须挂在 `document` 上而不是落点自己。
//
// 这两条都是"看一眼就知道、跑起来才发现"的形态，所以直接对**真源码**断言（本仓库既有的
// 手法：`test-panel-present.mjs` 从模板源码里取方法求值）。
{
  const template = readFileSync(new URL('../obsidian/main.template.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  const zoneRule = /\.dsh-math-assistant-dropzone\s*\{([\s\S]*?)\}/u.exec(css);
  check('CSS：落点的基础规则存在', zoneRule !== null);
  const base = zoneRule === null ? '' : zoneRule[1];
  check('CSS：落点基础态**不**用 display:none（那会让它不参与命中测试 ⇒ 自锁）',
    !/display\s*:\s*none/u.test(base), base.replace(/\s+/g, ' ').slice(0, 80));
  check('CSS：落点基础态用 visibility+pointer-events 保持"看不见但不挡鼠标"',
    /visibility\s*:\s*hidden/u.test(base) && /pointer-events\s*:\s*none/u.test(base));
  const visibleRule = /\.dsh-math-assistant-dropzone\[data-visible='true'\]\s*\{([\s\S]*?)\}/u.exec(css);
  check('CSS：拖动期间接管事件（pointer-events:auto）',
    visibleRule !== null && /pointer-events\s*:\s*auto/u.test(visibleRule[1]));

  // 检测必须挂在 `document` 上：落点自己（隐藏时）收不到事件。
  //
  // ⚠️ 这里曾经用 `/installDropZone\(\)\s*\{([\s\S]*?)\n  \}\n/` 取方法体，那是**配平错误的**：
  // 它停在体内第一个"两个空格缩进的 `}`"，于是切出来的不是整个方法。方法体一长到出现这种缩进的
  // 花括号，四条源码断言就**一起变红**——而它们此前"绿"过，是因为那时方法还短、恰好没撞上。
  // （同族：handoff §4 陷阱 88/92 —— "是合法文本"不等于"是那段代码"。）改为**按花括号配平**提取。
  const methodBody = (source, marker) => {
    const at = source.indexOf(marker);
    if (at < 0) return null;
    const open = source.indexOf('{', at);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      const c = source[i];
      if (c === "'" || c === '"' || c === '`') {
        // 跳过字符串/模板串（处理转义；模板串里的 ${} 不参与配平，够用且不会误判）
        for (i += 1; i < source.length; i += 1) {
          if (source[i] === '\\') { i += 1; continue; }
          if (source[i] === c) break;
        }
        continue;
      }
      if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
      if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; if (i <= 0) return null; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) return source.slice(open + 1, i); }
    }
    return null;
  };
  const body = methodBody(template, 'installDropZone()');
  check('源码：installDropZone 存在（按花括号配平取到方法体）', body !== null,
    body === null ? '未取到方法体 —— 提取器坏了，下面四条断言会全部无意义' : `${body.length} 字符`);
  const zoneBody = body ?? '';
  check('源码：在 document 上挂拖拽检测（落点隐藏时收不到事件）',
    /registerDomEvent\(document,\s*'dragstart'/u.test(zoneBody) && /registerDomEvent\(document,\s*'dragenter'/u.test(zoneBody));
  check('源码：文件拖拽（Files）不被抢',
    /includes\('Files'\)/u.test(zoneBody));
  check('源码：认不出载荷时放行（不 preventDefault）',
    /if \(rel === null\) return;/u.test(zoneBody));
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
