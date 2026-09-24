// scripts/qa/iframe-drop-probe.mjs — **跨源 iframe 里的 drop 监听到底能不能收到数据**。
//
// WHY THIS EXISTS。拖拽引用的实现路径在 `docs/design-intake-2026-09-21.md` §1.1 里有两条，
// 选哪条取决于一个**宿主行为**问题：侧栏那个 iframe 是**跨源**的（顶层 `app://obsidian.md`，
// 框架 `http://127.0.0.1:<port>`，见 `obsidian/main.template.js:541-542`）。那么：
//
//   · 若 iframe 内的 `drop` 监听**能**收到 `dataTransfer` ⇒ 路径 A 可行：
//     在 dsh 客户端插件里挂 drop 监听，读路径、`setDraft('@path')`。
//   · 若**收不到** ⇒ 只能走路径 B：在 iframe 上层盖一个透明遮罩当 drop 目标，
//     父页面读数据后再想办法送进去。
//
// 这个问题**不能靠推理定**，而夹具又极易自欺，所以本探针把三个坑都钉在代码里：
//
//   1. **同源夹具会证明一个不存在的场景是对的** —— 源、宿主、目标 iframe 必须是**三个
//      不同端口**（真跨源），否则测的是同源行为。
//   2. **一次拖拽只能在一个 CDP target 的输入管线里完成** —— 第一版把"源"放在另一个
//      tab 里，结果连**同源对照**都没收到 drop（跨 target 的鼠标事件到不了另一页）。
//      现在三方都在同一页上，对照与实验共享同一条输入流。
//   3. **父页面读不到跨源 iframe 的内部状态**（`SecurityError`）—— 目标 iframe 用
//      `postMessage` 把结果报给父页面，而不是让父页面去读它的 `window`。
//
// 源 iframe 只负责"按真实 Obsidian 的形态产出拖拽载荷"，父页面用 CDP 的
// `Input.setInterceptDrags` 把 Chromium 的**真实** `DragData` 读出来作为证据。
//
// 用法：node scripts/qa/iframe-drop-probe.mjs
// 退出码 0 = 对照成立且结论已定；非 0 = 探针自身失败（对照没跑起来 ⇒ 结论无效）。
//
// **只读承诺**：只起三个临时 HTTP 服务 + 一个 headless Chromium，退出时全部关闭。
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(CHROME)) {
  console.log(`iframe-drop-probe: SKIP（找不到 Chromium：${CHROME}）`);
  process.exit(0);
}

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

// The payload the target must receive. Mirrors the REAL one measured in Obsidian this
// session (`obsidian://open?vault=…&file=…` in both `text/plain` and `text/uri-list`),
// so the probe answers the question with the shape the feature will actually see.
const OBSIDIAN_URI = 'obsidian://open?vault=vault&file=%E6%A0%B9%E7%AC%94%E8%AE%B0';

/** The drag SOURCE: a draggable element carrying the real Obsidian payload. */
const sourceHtml = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<div id="note" draggable="true" style="width:260px;height:40px;background:#ddd">根笔记.md</div>
<script>
  window.__source = { dragstart: 0, dragend: 0 };
  const el = document.getElementById('note');
  el.addEventListener('dragstart', (e) => {
    window.__source.dragstart += 1;
    e.dataTransfer.setData('text/plain', ${JSON.stringify(OBSIDIAN_URI)});
    e.dataTransfer.setData('text/uri-list', ${JSON.stringify(OBSIDIAN_URI)});
    e.dataTransfer.effectAllowed = 'all';
  });
  el.addEventListener('dragend', () => { window.__source.dragend += 1; });
</script></body>`;

/** The cross-origin TARGET — the "dsh 侧栏 iframe" stand-in. Reports via postMessage. */
const childHtml = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#ffe">
<div id="childzone" style="width:100%;height:100%">child (cross-origin iframe)</div>
<script>
  const send = (payload) => { try { parent.postMessage(payload, '*'); } catch (_) {} };
  let drops = 0, dragovers = 0;
  document.addEventListener('dragover', (e) => { dragovers += 1; e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    drops += 1;
    let types = null, text = null, error = null;
    try {
      types = [...e.dataTransfer.types];
      text = e.dataTransfer.getData('text/plain');
    } catch (err) { error = String(err); }
    if (drops === 1) window.__first = { drops, dragovers, types, text, error };
    send({ kind: 'child-drop', drops, dragovers, types, text, error });
    e.preventDefault();
  });
</script></body>`;

/**
 * The TOP document: source and target are SIBLINGS (a cross-origin frame's state cannot be
 * read from the parent at all — nesting the source under the target made even the source's
 * coordinates unreadable, `SecurityError`), plus a same-origin control zone.
 */
const hostHtml = (sourcePort, childPort) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
<div id="hostzone" style="position:absolute;left:20px;top:20px;width:260px;height:60px;background:#eef">host zone (same-origin control)</div>
<iframe id="srcframe" src="http://127.0.0.1:${sourcePort}/" style="position:absolute;left:20px;top:110px;width:260px;height:120px;border:1px solid #999"></iframe>
<iframe id="frame" src="http://127.0.0.1:${childPort}/" style="position:absolute;left:320px;top:110px;width:260px;height:120px;border:1px solid #999"></iframe>
<div id="log" style="position:absolute;left:20px;top:260px"></div>
<script>
  window.__host = { drops: 0, dragovers: 0, lastTypes: null, lastText: null };
  window.__childMsgs = [];
  window.addEventListener('message', (e) => { if (e.data && e.data.kind === 'child-drop') window.__childMsgs.push(e.data); });
  // BOTH dragenter and dragover need preventDefault for an element to become a drop
  // target. The first version only did dragover and the control silently stayed "not a
  // drop target" — exactly the kind of fixture error that would make a NULL result look
  // like a real finding about cross-origin frames.
  document.addEventListener('dragenter', (e) => { window.__host.dragovers += 1; e.preventDefault(); });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    window.__host.drops += 1;
    try { window.__host.lastTypes = [...e.dataTransfer.types]; window.__host.lastText = e.dataTransfer.getData('text/plain'); } catch (_) {}
  });
</script></body>`;

const listen = (handler) => new Promise((resolve) => {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port, html: null }));
});
const serve = (html) => (req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };

const source = await listen(null); source.html = sourceHtml;
const child = await listen(null); child.html = childHtml;
const host = await listen(null); host.html = hostHtml(source.port, child.port);
for (const s of [source, child, host]) s.server.removeAllListeners('request'), s.server.on('request', serve(s.html));

const userData = mkdtempSync(join(tmpdir(), 'dsh-iframedrop-'));
const debugPort = 9381;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const waiters = new Map();
    let id = 0;
    socket.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
        return;
      }
      if (m.method !== undefined && waiters.has(m.method)) {
        for (const w of waiters.get(m.method)) w(m.params);
        waiters.delete(m.method);
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
      once: (method, ms = 20000) => new Promise((res) => {
        const list = waiters.get(method) ?? [];
        let done = false;
        list.push((params) => { if (done) return; done = true; res(params); });
        waiters.set(method, list);
        setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
      }),
      close: () => socket.close()
    }));
  });
}

try {
  let boot = null;
  for (let i = 0; i < 60 && boot === null; i += 1) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      boot = list.find((t) => t.type === 'page') ?? null;
    } catch { /* not up yet */ }
  }
  if (boot === null) throw new Error('headless Chromium 没有暴露 page target');

  const tab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${host.port}/`)}`, { method: 'PUT' })).json();
  const cdp = await connect(tab.webSocketDebuggerUrl);
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    // Surface exceptions: a swallowed TypeError reads exactly like "the frame is
    // inaccessible", which is the very thing under test.
    if (r.exceptionDetails !== undefined) throw new Error(`evaluate(${expr}) threw: ${r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  };
  await cdp.send('Runtime.enable');
  await sleep(2000);

  check('三个角色确实不同源（源 ≠ 宿主 ≠ 目标 iframe，真跨源）',
    source.port !== host.port && child.port !== host.port && source.port !== child.port,
    `source=${source.port} host=${host.port} child=${child.port}`);

  /** Absolute (top-viewport) coordinates of a point inside the source iframe. */
  const absPoint = async (selector, dx = 0, dy = 0) => {
    const box = await ev(`(() => {
      const f = document.getElementById('srcframe').getBoundingClientRect();
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(f.left + r.left + r.width / 2 + ${dx}), y: Math.round(f.top + r.top + r.height / 2 + ${dy}) });
    })()`);
    return JSON.parse(box);
  };
  // The source iframe's own document IS same-origin with… nobody: it is a third origin.
  // So its element rect must be read from the source server's own page — which we cannot
  // navigate to without leaving the host page. Instead the source exposes a fixed layout
  // (see sourceHtml: the note is at margin 0, 40px tall), and we derive the point from the
  // iframe box. Keeping that derivation here, in one place, is what the comment is for.
  const srcBox = JSON.parse(await ev(`(() => { const f = document.getElementById('srcframe').getBoundingClientRect(); return JSON.stringify({ left: Math.round(f.left), top: Math.round(f.top) }); })()`));
  const notePoint = { x: srcBox.left + 130, y: srcBox.top + 20 };
  void absPoint;

  // ── drag sessions, all inside this target's input pipeline ───────────────────
  //
  // The drag is SYNTHESIZED rather than captured. Two reasons, both learned the hard way:
  //   · `Input.setInterceptDrags` does not "observe and pass through" — it PAUSES the drag
  //     at dragstart until `Input.dispatchDragEvent` resumes it, and re-capturing a second
  //     drag in the same session proved unreliable (the control got zero events, then the
  //     iframe did). Chaining interception into a multi-destination comparison is fragile.
  //   · The question here is *host behaviour* — "does a cross-origin frame's document get
  //     the drop and the data" — and that does not depend on where the payload was born.
  // The mime types and the value are the ones `drag-payload-probe.mjs` measured from real
  // Obsidian, so this exercises the shape the feature will actually see.
  const dragData = {
    items: [
      { mimeType: 'text/plain', data: OBSIDIAN_URI },
      { mimeType: 'text/uri-list', data: OBSIDIAN_URI }
    ],
    dragOperationsMask: 1,
    files: []
  };

  /** Drag onto a point and release there. */
  const dropAt = async (point) => {
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: point.x, y: point.y, data: dragData });
    for (const offset of [0, 3, 6]) {
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: point.x + offset, y: point.y + offset, data: dragData });
      await sleep(120);
    }
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: point.x + 6, y: point.y + 6, data: dragData });
    await sleep(500);
  };

  // Control first: a same-origin point that NO iframe covers. If this fails, a failure on
  // the iframe says nothing about cross-origin — it just means drags are not delivered here.
  const hz = { x: 40, y: 320 };
  await dropAt(hz);
  const hostDrops = await ev('window.__host.drops');
  check('对照：宿主文档（自己就是 drop 目标）收到了 drop', hostDrops >= 1,
    `hostDrops=${hostDrops} dragenters=${await ev('window.__host.dragovers')}`);

  // The real question: release over the CROSS-ORIGIN iframe.
  const frameBox = JSON.parse(await ev(`(() => { const r = document.getElementById('frame').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`));
  await dropAt(frameBox);
  await sleep(900);

  const msgs = await ev('JSON.stringify(window.__childMsgs)');
  const parsed = JSON.parse(msgs);
  const last = parsed.length > 0 ? parsed[parsed.length - 1] : null;
  console.log('\n=== 结果 ===');
  console.log('host drops      :', hostDrops, JSON.stringify(await ev('JSON.stringify(window.__host.lastTypes)')));
  console.log('child 报回的消息 :', msgs);

  const childGotDrop = last !== null && last.drops >= 1;
  check('跨源 iframe 的 drop 监听收到了 drop 事件（路径 A 可行的前提）', childGotDrop,
    childGotDrop ? `drops=${last.drops} types=${JSON.stringify(last.types)} text=${JSON.stringify(last.text)}`
      : '目标 iframe 一次 drop 都没收到');
  const childGotData = childGotDrop && typeof last.text === 'string' && last.text.includes('obsidian://');
  check('跨源 iframe 能读到 dataTransfer 的内容（能拿到 vault/file 参数）', childGotData,
    childGotData ? `text=${JSON.stringify(last.text)}` : `text=${JSON.stringify(last?.text ?? null)} error=${JSON.stringify(last?.error ?? null)}`);

  console.log(`\n结论：${childGotData ? '路径 A 可行 —— 在 dsh 客户端插件里挂 document 级 drop 监听即可，不需要遮罩。'
    : childGotDrop ? 'drop 事件能到达，但读不到内容 —— 需要遮罩方案（父页面读数据再送进去）。'
      : '跨源 iframe 收不到 drop —— 必须走遮罩方案（父页面当 drop 目标）。'}`);
  cdp.close();
} catch (error) {
  console.log('iframe-drop-probe: FAILED —', String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  chrome.kill();
  for (const s of [host, source, child]) { try { await new Promise((r) => s.server.close(r)); } catch { /* already closed */ } }
  try { rmSync(userData, { recursive: true, force: true }); } catch { /* locked; leave it */ }
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  if (process.exitCode === undefined) process.exitCode = passed === total ? 0 : 1;
}
