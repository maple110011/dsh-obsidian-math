// scripts/qa/drop-to-mention-e2e.mjs — 端到端：**真的**把拖拽载荷投进 dsh 输入框，草稿里要有 `@路径`。
//
// WHY THIS EXISTS。`scripts/test-drop-mention.mjs` 用的是假 DOM，它证明的是"我们的逻辑对"；
// 它**证明不了**两件只有真宿主才知道的事：
//
//   1. dsh 的 composer 自己会消费 `paste`（我们的实现靠它落笔）—— 这是宿主行为，不是契约；
//   2. 真实 `drop` 事件真的会到达我们挂在 `document` 上的监听（而不是被别处 stopPropagation）。
//
// 所以这个探针起一台**独立 profile、独立端口**的 dsh（不碰用户正在用的 3080/3180），
// 在一个我们自己的 headless 浏览器里打开它，用 CDP 的 `Input.dispatchDragEvent` 投递
// **与实测一致的载荷**（`obsidian://open?vault=…&file=…`，由 drag-payload-probe 实测得到），
// 然后断言输入框里出现了 `@库内路径`。
//
// 它把**仓库里那份构建产物**（`dsh/client-panel/lib/client.js`）注入页面并调用它的安装器 ——
// 于是这条断言覆盖的是"用户真的要跑的那段代码"，而不是探针里另写一份。
//
// 用法：node scripts/qa/drop-to-mention-e2e.mjs [--port=3098] [--debug-port=9225] [--keep]
// 退出码 0 = 通过；非 0 = 失败（探针自身起不来 vs 功能不工作，输出里会区分）。
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { extractDropMentionProbeSource } from '../lib/extract-bundle-function.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const PORT = Number(arg('port', '3098'));
const DEBUG_PORT = Number(arg('debug-port', '9225'));
const KEEP = process.argv.includes('--keep');
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const BIN = process.env.DSH_BIN || join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BUNDLE = join(root, 'dsh', 'client-panel', 'lib', 'client.js');

if (!existsSync(BIN)) { console.log(`drop-to-mention-e2e: SKIP（找不到 dsh：${BIN}）`); process.exit(0); }
if (!existsSync(CHROME)) { console.log(`drop-to-mention-e2e: SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }
if (!existsSync(BUNDLE)) { console.log(`drop-to-mention-e2e: SKIP（客户端产物缺失，先跑 npm run build:client）`); process.exit(1); }

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

const NOTE = '拖拽端到端探针.md';
const OBSIDIAN_URI = `obsidian://open?vault=%E6%8E%A2%E9%92%88%E5%BA%93&file=${encodeURIComponent(NOTE)}`;
const EXPECTED_MENTION = `@${NOTE}`;

let child = null;
let browser = null;
let cdp = null;
let work = null;

try {
  work = mkdtempSync(join(tmpdir(), 'dsh-drop-e2e-'));
  const vault = join(work, 'vault');
  mkdirSync(join(vault, '.deepseek'), { recursive: true });
  writeFileSync(join(vault, NOTE), '# 拖拽端到端探针\n\n用来验证「拖进来 → 草稿出现 @路径」。\n', 'utf8');

  // ── 起 dsh（独立 profile：临时 vault + 每进程独立的端口） ──────────────────
  const logFd = openSync(join(work, 'dsh.log'), 'w');
  const errFd = openSync(join(work, 'dsh.err'), 'w');
  child = spawn(process.execPath, [BIN, '--profile', 'notes-assistant', '--no-open', '--port', String(PORT)], {
    env: { ...process.env, DSH_HOME, DSH_WORKSPACE_ROOT: vault, DSH_OBSIDIAN_VAULT: vault },
    stdio: ['ignore', logFd, errFd]
  });
  closeSync(logFd);
  closeSync(errFd);

  let launchUrl = null;
  const logPath = join(work, 'dsh.log');
  for (let i = 0; i < 120 && launchUrl === null; i += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(readFileSync(logPath, 'utf8'));
      if (m !== null) launchUrl = m[0];
    } catch { /* not written yet */ }
  }
  check('dsh 起来了并打印了带 token 的启动地址', launchUrl !== null, launchUrl ?? `(exit=${child.exitCode})`);
  if (launchUrl === null) {
    for (const f of ['dsh.err', 'dsh.log']) {
      try {
        const text = readFileSync(join(work, f), 'utf8').trim();
        if (text !== '') console.log(`  --- ${f} ---\n` + text.split('\n').slice(0, 12).join('\n'));
      } catch { /* nothing */ }
    }
    throw new Error('dsh 没起来：后续结论无意义');
  }

  // ── 自己的 headless 浏览器（dsh 本身没有调试开关，实测 --remote-debugging-port 会报 unknown option） ──
  const userData = join(work, 'browser');
  mkdirSync(userData, { recursive: true });
  browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', `--window-size=1280,900`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

  let target = null;
  for (let i = 0; i < 60 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools:')) ?? null;
    } catch { /* not up yet */ }
    if (target === null) await sleep(400);
  }
  check('CDP 暴露了页面 target', target !== null, target?.url ?? '(none)');
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
    if (r.exceptionDetails !== undefined) throw new Error(`evaluate threw: ${r.exceptionDetails.exception?.description ?? '?'}`);
    return r.result?.value;
  };

  await cdp.send('Page.navigate', { url: launchUrl });
  await sleep(1500);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
    await sleep(500);
  }
  check('输入框渲染出来了', (await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true, await ev('location.href'));

  // ── 注入**仓库里那份产物**的实现并装上 ─────────────────────────────────────
  //
  // 不调 `apply()`：那个 id 已经在别处注册过（这个 profile 开机时装了这个包），再注册会冲突。
  // 也不走 ModuleLoader —— `factory(require)` 需要 react，而宿主没有公开的读取通道
  // （实测 `window.__ModuleLoader__` 上只有 create/load）。所以按 AST 从产物里**切出**
  // drop→mention 那几个片段单独求值：跑的是同一份编译产物，只是绕开了模块系统的依赖。
  // 切片逻辑与踩过的坑见 `scripts/lib/extract-bundle-function.mjs`。
  const bundle = readFileSync(BUNDLE, 'utf8');
  const extraction = (() => {
    try {
      const { source } = extractDropMentionProbeSource(bundle);
      return { ok: true, source };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  })();
  check('能从产物里切出 drop→mention 的实现', extraction.ok === true, extraction.ok ? `${extraction.source.length} 字符` : extraction.error);
  if (extraction.ok !== true) throw new Error(`切片失败：${extraction.error}`);

  const injected = await ev(`(() => {
    let mod = null;
    try {
      mod = (new Function(${JSON.stringify(extraction.source)}))();
    } catch (e) { return JSON.stringify({ ok: false, stage: 'eval', error: String(e) }); }
    if (typeof mod.install !== 'function') return JSON.stringify({ ok: false, stage: 'export', keys: Object.keys(mod) });
    const dispose = mod.install({ document, window });
    if (typeof dispose !== 'function') return JSON.stringify({ ok: false, stage: 'install' });
    window.__dropDispose = dispose;
    return JSON.stringify({ ok: true, handlers: Object.keys(dispose.__handlers ?? {}).length });
  })()`);
  console.log('  注入实现:', injected);
  const install = JSON.parse(injected);
  check('产物里的安装器装上了 drop 行为', install.ok === true, JSON.stringify(install));

  // ── 真实拖拽：CDP 投递与实测一致的载荷 ──────────────────────────────────────
  await ev(`(() => { const el = document.querySelector('[contenteditable="true"]'); el.focus(); return true; })()`);
  const box = JSON.parse(await ev(`(() => {
    const r = document.querySelector('[contenteditable="true"]').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`));

  const dragData = {
    items: [
      { mimeType: 'text/plain', data: OBSIDIAN_URI },
      { mimeType: 'text/uri-list', data: OBSIDIAN_URI }
    ],
    dragOperationsMask: 1,
    files: []
  };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data: dragData });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data: dragData });
  await sleep(150);
  const hintDuringDrag = await ev(`!!document.querySelector('.dsh-math-memory-drop-hint')`);
  check('拖动经过输入框时出现可见提示', hintDuringDrag === true, `hint=${hintDuringDrag}`);
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data: dragData });
  await sleep(700);

  const draft = await ev(`(() => { const el = document.querySelector('[contenteditable="true"]'); return el ? (el.textContent ?? '') : '(none)'; })()`);
  console.log('  拖拽后的草稿:', JSON.stringify(String(draft).slice(0, 120)));
  check('拖进去之后草稿里出现了 @库内路径', String(draft).includes(EXPECTED_MENTION),
    `draft=${JSON.stringify(String(draft).slice(0, 80))} want包含=${JSON.stringify(EXPECTED_MENTION)}`);
  const hintAfterDrop = await ev(`!!document.querySelector('.dsh-math-memory-drop-hint')`);
  check('松手之后提示自己收掉了（不会留在屏幕上）', hintAfterDrop === false);

  // 载荷不被认（别的来源的拖拽）时必须**什么都不做**
  await ev(`(() => { const el = document.querySelector('[contenteditable="true"]'); el.focus(); return true; })()`);
  const junkData = { items: [{ mimeType: 'text/plain', data: '随便一段普通文字' }], dragOperationsMask: 1, files: [] };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data: junkData });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data: junkData });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data: junkData });
  await sleep(500);
  const draftAfterJunk = await ev(`(() => { const el = document.querySelector('[contenteditable="true"]'); return el ? (el.textContent ?? '') : '(none)'; })()`);
  check('不认识的载荷：草稿没有被追加垃圾文本', !String(draftAfterJunk).includes('随便一段普通文字'),
    JSON.stringify(String(draftAfterJunk).slice(0, 120)));

  cdp.close();
  cdp = null;
} catch (error) {
  console.log('drop-to-mention-e2e: FAILED —', String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  try { cdp?.close(); } catch { /* already closed */ }
  try { child?.kill(); } catch { /* already gone */ }
  try { browser?.kill(); } catch { /* already gone */ }
  await sleep(1500);
  if (work !== null && !KEEP) { try { rmSync(work, { recursive: true, force: true }); } catch { /* locked; leave it */ } }
  else if (work !== null) console.log(`kept: ${work}`);
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  if (process.exitCode === undefined) process.exitCode = passed === total ? 0 : 1;
}
