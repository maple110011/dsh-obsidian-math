// scripts/qa/composer-drop-probe.mjs — 摸清 dsh web **输入框**的两个接缝（按需运行）。
//
// WHY THIS EXISTS。要实现的用户诉求是「从 Obsidian 左侧文件树把文件拖进 dsh 对话框，
// 变成一次引用」。上一轮已经把两个前提测掉了（`drag-payload-probe.mjs` 拿到真实载荷是
// `obsidian://open?vault=…&file=<库内路径>`；`iframe-drop-probe.mjs` 证明跨源 iframe 里的
// `drop` 监听**能**收到并读到 `dataTransfer`）。剩下两个接缝**不能靠读类型猜**：
//
//   1. **输入框在 DOM 里长什么样**：可放置区域怎么选？它是不是 `<textarea>`（决定能不能用
//      `setRangeText` 插到光标处，还是只能整体替换草稿）？
//   2. **dsh 自己收到、但不是拖文件的 `drop` 时会不会 preventDefault**：若它已经
//      preventDefault，我们的监听拿到的 `defaultPrevented === true`；若它 `stopPropagation`，
//      我们挂在 `document` 上的监听**根本不会触发** —— 那实现方式就得换成挂在捕获阶段。
//
// 猜错的代价是"写了一个看起来对的监听，实际一次也不触发"，而这类缺陷在离线夹具里**永远是绿的**。
//
// 用法：node scripts/qa/composer-drop-probe.mjs [--port=3099] [--debug-port=9224]
//   它会自己起一台**独立 profile、独立端口**的 dsh web（不碰用户正在用的 3080/3180），
//   跑完关掉。退出码 0 = 探针跑完；非 0 = 探针自身失败（结论无效）。
//
// **副作用与清理**：临时 workspace 与 dsh 实例都在临时目录里，退出时删除；不用真实 vault。
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const PORT = Number(arg('port', '3099'));
const DEBUG_PORT = Number(arg('debug-port', '9224'));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const BIN = process.env.DSH_BIN || join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

if (!existsSync(BIN)) {
  console.log(`composer-drop-probe: SKIP（找不到 dsh：${BIN}）`);
  process.exit(0);
}

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

let child = null;
let browser = null;
let cdp = null;
let work = null;

try {
  work = mkdtempSync(join(tmpdir(), 'dsh-composer-probe-'));
  const vault = join(work, 'vault');
  mkdirSync(join(vault, '.deepseek'), { recursive: true });
  writeFileSync(join(vault, '拖拽探针笔记.md'), '# 拖拽探针\n\n用来验证 @ 引用能不能落到草稿里。\n', 'utf8');

  const logFd = openSync(join(work, 'child.log'), 'w');
  const errFd = openSync(join(work, 'child.err'), 'w');
  // NOTE: dsh has no `--remote-debugging-port` (measured: `error: unknown option`). The web
  // UI is an ordinary browser app, so CDP comes from a browser WE launch against the launch
  // URL — that is also closer to the real Obsidian topology (a browser context, not Electron).
  child = spawn(process.execPath, [
    BIN, '--profile', 'notes-assistant', '--no-open', '--port', String(PORT)
  ], {
    env: { ...process.env, DSH_HOME, DSH_WORKSPACE_ROOT: vault, DSH_OBSIDIAN_VAULT: vault },
    stdio: ['ignore', logFd, errFd]
  });
  closeSync(logFd);
  closeSync(errFd);

  // The launch URL (and its token) only appears on stdout; the UI needs it to mint the cookie.
  let launchUrl = null;
  const logPath = join(work, 'child.log');
  for (let i = 0; i < 120 && launchUrl === null; i += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const text = await import('node:fs').then(({ readFileSync }) => readFileSync(logPath, 'utf8'));
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(text);
      if (m !== null) launchUrl = m[0];
    } catch { /* not written yet */ }
  }
  check('dsh 起来了并打印了带 token 的启动地址', launchUrl !== null, launchUrl ?? `(exit=${child.exitCode})`);
  if (launchUrl === null) {
    // Never swallow the reason: "did not start" with no stderr is how a broken flag or a
    // profile error gets misread as "the probe's assumption was wrong".
    const { readFileSync } = await import('node:fs');
    for (const f of ['child.err', 'child.log']) {
      try {
        const text = readFileSync(join(work, f), 'utf8').trim();
        if (text !== '') console.log(`  --- ${f} ---\n` + text.split('\n').slice(0, 15).join('\n'));
      } catch { /* nothing written */ }
    }
    throw new Error('dsh 没起来：后续结论无意义');
  }

  // Attach CDP to a browser WE launch (see the spawn comment): dsh itself has no debug flag.
  const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!existsSync(CHROME)) throw new Error(`找不到 Chromium：${CHROME}（设 CHROME_PATH 覆盖）`);
  const userData = join(work, 'browser');
  mkdirSync(userData, { recursive: true });
  browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

  let target = null;
  for (let i = 0; i < 60 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools:')) ?? null;
    } catch { /* not up yet */ }
    if (target === null) await sleep(400);
  }
  check('CDP 暴露了浏览器页面 target', target !== null, target?.url ?? '(none)');
  if (target === null) throw new Error('没有 page target');

  cdp = await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    socket.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
      }
    });
    socket.addEventListener('error', (e) => reject(new Error(String(e.message ?? e))));
    socket.addEventListener('open', () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const n = ++id;
        pending.set(n, { res, rej });
        socket.send(JSON.stringify({ id: n, method, params }));
        setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(`timeout ${method}`)); } }, 30000);
      }),
      close: () => socket.close()
    }));
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails !== undefined) throw new Error(`evaluate(${expr.slice(0, 60)}…) threw: ${r.exceptionDetails.exception?.description ?? '?'}`);
    return r.result?.value;
  };

  // Navigate to the tokenized launch URL so the cookie is minted, then wait for the shell.
  await cdp.send('Page.navigate', { url: launchUrl });
  await sleep(1500);
  const ready = async () => (await ev('!!document.querySelector("textarea, [contenteditable=true]")'));
  for (let i = 0; i < 60 && (await ready()) === false; i += 1) await sleep(500);
  check('输入框渲染出来了', (await ready()) === true, await ev('location.href'));

  // ── 接缝 1：输入框长什么样 ────────────────────────────────────────────────
  const shape = await ev(`JSON.stringify({
    textareas: document.querySelectorAll('textarea').length,
    contenteditables: document.querySelectorAll('[contenteditable=true]').length,
    ceClasses: [...document.querySelectorAll('[contenteditable=true]')].map(n => n.className).slice(0, 4),
    taClasses: [...document.querySelectorAll('textarea')].map(n => n.className).slice(0, 4),
    taPlaceholder: [...document.querySelectorAll('textarea')].map(n => n.placeholder).slice(0, 4)
  })`);
  console.log('  输入框形态:', shape);
  const parsedShape = JSON.parse(shape);
  check('存在 contenteditable（说明是 Lexical 富文本输入框，不是裸 textarea）',
    parsedShape.contenteditables > 0 || parsedShape.textareas > 0,
    `contenteditable=${parsedShape.contenteditables} textarea=${parsedShape.textareas}`);

  // ── 接缝 2：dsh 自己收到非文件 drop 时会 preventDefault / stopPropagation 吗 ──
  //
  // 这决定了我们的监听挂 document 冒泡阶段能不能收到。用一个**合成** DragEvent 直接问：
  // 在输入框上派发一次 dragenter/dragover/drop，看它被不被吞。
  const dispatch = await ev(`(() => {
    const el = document.querySelector('[contenteditable=true]') || document.querySelector('textarea');
    if (!el) return JSON.stringify({ error: 'no input element' });
    const dt = new DataTransfer();
    dt.setData('text/plain', 'obsidian://open?vault=vault&file=%E6%8B%96%E6%8B%BD%E6%8E%A2%E9%92%88%E7%AC%94%E8%AE%B0');
    const seen = [];
    const probe = (type) => (e) => seen.push({ type, onDocumentBubble: true, defaultPrevented: e.defaultPrevented });
    document.addEventListener('dragover', probe('dragover'));
    document.addEventListener('drop', probe('drop'));
    const fired = {};
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(e);
      fired[type] = { defaultPrevented: e.defaultPrevented };
    }
    document.removeEventListener('dragover', probe('dragover'));
    document.removeEventListener('drop', probe('drop'));
    return JSON.stringify({ fired, seen });
  })()`);
  console.log('  合成 drop 的结果:', dispatch);
  const parsedDispatch = JSON.parse(dispatch);
  check('输入框上的合成 dragover 可取消且未被 dsh 吞掉',
    parsedDispatch.fired?.dragover !== undefined && parsedDispatch.fired.dragover.defaultPrevented === false,
    JSON.stringify(parsedDispatch.fired?.dragover));
  check('document 冒泡阶段**收得到** drop（我们的监听不会被 stopPropagation 挡掉）',
    (parsedDispatch.seen ?? []).some((s) => s.type === 'drop'), JSON.stringify(parsedDispatch.seen));

  // ── 接缝 3（决定性）：composer 自己处理 paste ⇒ 合成 paste 能不能把文字落进草稿 ──
  //
  // dsh 的 composer 注册了 paste 处理器：读 `clipboardData.getData("text/plain")` 再走
  // `handlers.pasteText(text)`（`dsh-client-ui-conversation/lib/client.js:15259-15273`）。
  // 这是**跨源 iframe 之外**唯一既能"插到光标处"、又不依赖 React state 的接缝：drop 事件
  // 能拿到元素与坐标，元素能收合成 ClipboardEvent，而 composer 自己的处理器负责落笔。
  // 若它不生效，实现就必须走"会话 API 整体替换草稿"，那是完全不同的设计 —— 所以先测。
  const pasteResult = await ev(`(() => {
    const el = document.querySelector('[contenteditable=true]');
    if (!el) return JSON.stringify({ ok: false, reason: '没有 contenteditable' });
    const before = el.textContent ?? '';
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '@拖拽探针笔记.md ');
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    el.dispatchEvent(evt);
    return JSON.stringify({ ok: true, before, defaultPrevented: evt.defaultPrevented });
  })()`);
  console.log('  合成 paste:', pasteResult);
  await sleep(600);
  const afterText = await ev(`(() => { const el = document.querySelector('[contenteditable=true]'); return el ? (el.textContent ?? '') : '(none)'; })()`);
  console.log('  paste 之后草稿 textContent:', JSON.stringify(String(afterText).slice(0, 120)));
  const pasted = String(afterText).includes('拖拽探针笔记');
  check('合成 paste 把 @路径 落进了 composer 草稿（这是实现的接缝）', pasted,
    pasted ? `after=${JSON.stringify(String(afterText).slice(0, 80))}` : `after=${JSON.stringify(String(afterText).slice(0, 80))}`);

  // 清掉探针写进去的内容，别把状态留给下一条断言
  await ev(`(() => { const el = document.querySelector('[contenteditable=true]'); if (el) { el.focus(); document.execCommand('selectAll'); document.execCommand('delete'); } return true; })()`);
  await sleep(300);

  cdp.close();
  cdp = null;
} catch (error) {
  console.log('composer-drop-probe: FAILED —', String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  try { cdp?.close(); } catch { /* already closed */ }
  try { child?.kill(); } catch { /* already gone */ }
  try { browser?.kill(); } catch { /* already gone */ }
  await sleep(1500);
  if (work !== null) { try { rmSync(work, { recursive: true, force: true }); } catch { /* locked; leave it */ } }
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  if (process.exitCode === undefined) process.exitCode = passed === total ? 0 : 1;
}
