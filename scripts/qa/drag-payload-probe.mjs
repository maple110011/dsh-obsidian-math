// scripts/qa/drag-payload-probe.mjs — **实测 Obsidian 拖拽时 `dataTransfer` 到底是什么**。
//
// WHY THIS EXISTS（2026-09-21）。用户问「能不能把 Obsidian 笔记拖进侧栏的 dsh 里引用」。
// 取证（`docs/design-intake-2026-09-21.md` §1.1）把结论收在**一个未验证的前提**上：
// 拖拽时 `dataTransfer` 里有没有 vault 相对路径？是哪个 MIME？——本仓库**没有这项数据**，
// 而整个实现路径（在 dsh 客户端插件里挂 drop 监听 → 解析路径 → `setDraft('@path')`）
// 都建在它上面。凭推断写一个 drop 解析器，就是坑 85「夹具在证明一个不存在的场景是对的」
// 的同族：解析器会对着一份想象出来的 payload 写，然后一路绿。
//
// 所以本探针**不猜**：它启动一个**隔离**的 Obsidian（独立 `--user-data-dir` + 临时 vault，
// 不碰用户正在用的实例），用 CDP 的 `Input.setInterceptDrags` 拦下 Chromium **真实**的
// 拖拽载荷 —— 那是页面在 `dragstart` 里 `setData()` 之后、投递之前的**真值**，
// 而不是我们伪造的 DataTransfer。
//
// 用法：node scripts/qa/drag-payload-probe.mjs [--keep] [--exe=<Obsidian.exe>]
//   退出码 0 = 探针跑完（无论结论是什么）；非 0 = 探针自身失败（没起来 / 找不到 DOM）。
//
// **只读承诺**：临时 vault 与临时 profile 都是本脚本自己建的、退出时删除；不启动 dsh、
// 不读写用户 vault、不派发任何会修改用户数据的操作。
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const KEEP = process.argv.includes('--keep');
const EXE = arg('exe', 'E:\\software\\Obsidian\\Obsidian.exe');
const PORT = Number(arg('port', '9223'));

if (!existsSync(EXE)) {
  console.log(`drag-probe: SKIP（找不到 Obsidian：${EXE}）`);
  process.exit(0);
}

const work = join(tmpdir(), 'obs-drag-probe');
let child = null;
let ws = null;

/** Minimal CDP client: send(), and a promise for one named event. */
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
        if (m.error) p.rej(new Error(`${JSON.stringify(m.error)}`)); else p.res(m.result);
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
      once: (method, ms = 15000) => new Promise((res) => {
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

async function firstPageTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page !== undefined) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return null;
}

try {
  rmSync(work, { recursive: true, force: true });
  const udd = join(work, 'udd');
  const vault = join(work, 'vault');
  mkdirSync(join(vault, '.obsidian'), { recursive: true });
  mkdirSync(join(vault, '数学'), { recursive: true });
  mkdirSync(udd, { recursive: true });
  writeFileSync(join(vault, '根笔记.md'), '# 根笔记\n\n拖拽载荷探针用。\n', 'utf8');
  writeFileSync(join(vault, '数学', '随便.md'), '# 随便\n\n拖拽载荷探针用。\n', 'utf8');
  // A folder item too: dragging a folder is a different payload from dragging a file.
  mkdirSync(join(vault, '收集箱'), { recursive: true });
  writeFileSync(join(vault, '收集箱', '临时.md'), '# 临时\n', 'utf8');
  writeFileSync(join(vault, '.obsidian', 'app.json'), '{"alwaysUpdateLinks":false}\n', 'utf8');

  // Make the instance open OUR vault instead of the Starter screen. Two registrations
  // are needed and both were found the hard way (a vault passed as a positional argv did
  // NOT open): `obsidian.json` lists the vaults Obsidian knows, and the per-profile
  // `app.json` names the CURRENT one by id. Without the second, Obsidian still boots to
  // the vault chooser and every DOM lookup below silently finds zero items.
  const vaultId = 'dragprobe0000001';
  writeFileSync(join(udd, 'obsidian.json'),
    JSON.stringify({ vaults: { [vaultId]: { path: vault, ts: Date.now(), open: true } } }), 'utf8');
  writeFileSync(join(udd, 'app.json'), JSON.stringify({ vault: vaultId }), 'utf8');

  // Open our vault directly. `--user-data-dir` isolates this instance from the user's
  // running Obsidian (separate process singleton + separate obsidian.json + app.json).
  child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`], {
    stdio: ['ignore', 'ignore', 'ignore'], detached: false
  });
  child.on('error', () => { /* reported by the target search timing out */ });

  const target = await firstPageTarget();
  if (target === null) throw new Error(`Obsidian 没有在 ${PORT} 上暴露 page target`);
  console.log('target:', target.url, '|', target.title);

  const cdp = await connect(target.webSocketDebuggerUrl);
  ws = cdp;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(3000); // let the vault load + the file explorer render

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails !== undefined) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)}`);
    return r.result?.value;
  };

  console.log('vault loaded  :', await evaluate('typeof app !== "undefined" && app.vault.getName ? app.vault.getName() : "(no app)"'));
  console.log('body text head:', JSON.stringify(String(await evaluate('document.body.innerText')).slice(0, 120)));
  console.log('file items    :', await evaluate('document.querySelectorAll(".nav-file-title, .nav-folder-title").length'));
  console.log('item sample   :', await evaluate('[...document.querySelectorAll(".nav-file-title, .nav-folder-title")].map(n => n.className + " :: " + (n.getAttribute("data-path") || n.innerText)).join(" || ")'));

  // Try to reach a deterministic file-explorer state: reveal our known note.
  await evaluate(`(async () => {
    const f = app.vault.getAbstractFileByPath('根笔记.md');
    if (f) await app.workspace.getLeaf(true).openFile(f);
    return true;
  })()`);
  await sleep(1500);

  /**
   * Drag from one element using Chromium's REAL drag stack, intercepting the payload.
   * `findExpr` is a JS expression evaluating to the element (not a CSS selector: the
   * file rows carry no stable `data-path` and several dodge selectors don't accept
   * `:has()`), so lookups stay readable and render-proof.
   */
  async function captureDrag(findExpr, label) {
    const box = await evaluate(`(() => {
      const el = (${findExpr});
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    if (box === null) return { label, ok: false, reason: `element not found: ${findExpr}` };
    await cdp.send('Input.setInterceptDrags', { enabled: true });
    const intercepted = cdp.once('Input.dragIntercepted');
    const base = { x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    // Several small moves: Chromium only promotes a press to a drag after real motion.
    for (const dx of [4, 12, 24, 40]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, x: box.x + dx, y: box.y + 6 });
      await sleep(70);
    }
    const data = await intercepted;
    // A drag that started must be ended, or the app stays in drag state.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
    await cdp.send('Input.setInterceptDrags', { enabled: false });
    // Let the app settle: an immediate next drag re-renders the tree and makes the
    // following lookup race the DOM (this is why the folder row "did not start" first run).
    await sleep(600);
    if (data === null) return { label, ok: false, reason: '拖拽没有开始（Chromium 没有发出 dragIntercepted）', box };
    return { label, ok: true, box, items: data.data?.items ?? [], dragOperationsMask: data.data?.dragOperationsMask };
  }

  /** Real click via CDP (page-side `.click()` does not reliably drive Obsidian's own handlers). */
  async function realClick(findExpr) {
    const box = await evaluate(`(() => {
      const el = (${findExpr});
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (box === null) return false;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    return true;
  }

  const results = [];
  results.push(await captureDrag('[...document.querySelectorAll(".nav-file-title")].find(n => n.innerText.includes("根笔记"))', '文件树：根笔记.md'));
  // Folders start collapsed, so a nested file exists in the vault but not in the DOM
  // until its parent is expanded. Clicking the folder row is what expands it — poking
  // `f.expanded` from the outside changed nothing (one file row before AND after).
  for (const name of ['数学', '收集箱']) {
    await realClick(`[...document.querySelectorAll(".nav-folder-title")].find(n => n.innerText.includes(${JSON.stringify(name)}))`);
    await sleep(700);
  }
  console.log('after expand  :', await evaluate('document.querySelectorAll(".nav-file-title").length'), 'file rows; sample:', await evaluate('[...document.querySelectorAll(".nav-file-title")].map(n => n.innerText).join(" | ")'));
  results.push(await captureDrag('[...document.querySelectorAll(".nav-file-title")].find(n => n.innerText.includes("随便"))', '文件树：数学/随便.md（嵌套）'));
  results.push(await captureDrag('[...document.querySelectorAll(".nav-folder-title")].find(n => n.innerText.includes("收集箱"))', '文件树：文件夹 收集箱'));

  // Dragging from the EDITOR (selected text) is a different code path and a different
  // payload from dragging a file-tree row — the feature needs both. The selection must be
  // made with REAL mouse events: a scripted `Selection` gives the editor no drag source,
  // so this row silently reported "drag did not start" on the first attempt.
  await evaluate(`(async () => {
    const f = app.vault.getAbstractFileByPath('根笔记.md');
    await app.workspace.getLeaf(true).openFile(f);
    return true;
  })()`);
  await sleep(1500);
  const editorBox = await evaluate(`(() => {
    const cm = document.querySelector('.cm-content');
    if (!cm) return null;
    const r = cm.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  if (editorBox === null) {
    results.push({ label: '编辑器：选中文字', ok: false, reason: '找不到 .cm-content（笔记没打开？）' });
  } else {
    const y = editorBox.y + 40;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: editorBox.x + 8, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: editorBox.x + 8 + i * 18, y, button: 'left', buttons: 1 });
      await sleep(40);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editorBox.x + 8 + 8 * 18, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
    console.log('editor selection:', JSON.stringify(String(await evaluate('String(window.getSelection())')).slice(0, 60)));
    results.push(await captureDrag('[...document.querySelectorAll(".cm-content")][0]', '编辑器：选中文字'));
  }

  console.log('\n=== 拦截到的拖拽载荷 ===');
  const report = { target: target.url, obsidian: await evaluate('app.vault.getName ? app.vault.getName() : null'), results };
  for (const r of results) {
    if (!r.ok) { console.log(`- ${r.label}: 失败 —— ${r.reason}`); continue; }
    console.log(`- ${r.label}  (box ${r.box.w}x${r.box.h} @ ${r.box.x},${r.box.y})`);
    console.log(`    dragOperationsMask: ${r.dragOperationsMask}`);
    if (r.items.length === 0) console.log('    (没有任何 item —— 说明这次拖拽不是由页面 dragstart 建立的)');
    for (const it of r.items) {
      console.log(`    mime=${JSON.stringify(it.mimeType)}  baseURL=${JSON.stringify(it.baseURL ?? '')}`);
      console.log(`      title=${JSON.stringify(it.title ?? '')}`);
      console.log(`      data=${JSON.stringify(it.data ?? '')}`);
    }
  }

  // What Obsidian's own dragstart handler is registered on, for the write-up.
  results.push({ probe: 'dragstart listener presence', value: await evaluate(`(() => {
    const el = document.querySelector('.nav-file-title[data-path="根笔记.md"]');
    if (!el) return 'no element';
    return 'found element, draggable=' + el.getAttribute('draggable');
  })()`) });

  const out = join(tmpdir(), 'drag-payload-probe.json');
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nJSON: ${out}`);
  cdp.close();
} catch (error) {
  console.log('drag-probe: FAILED —', String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  try { child?.kill(); } catch { /* already gone */ }
  await sleep(1500);
  if (!KEEP) { try { rmSync(work, { recursive: true, force: true }); } catch { /* locked; leave it */ } }
  else console.log(`kept: ${work}`);
}
