// scripts/qa/mention-insert-live-probe.mjs — 只读地看**真实页面**里落笔入口的状态，并调用它一次。
//
// WHY THIS EXISTS。上一轮已经实测到：真实页面订阅了 `/mention-stream`、也确实收到了消息
// （`mention-stream-delivery-probe.mjs`），可草稿仍然是空的。所以问题就在"收到之后调用落笔"这一段。
// 这个探针把那段拆成可见的事实：
//   ① `window.__dshMentionInsert` 存在吗？是什么类型？
//   ② 页面里 `[contenteditable="true"]` 有几个、是不是 composer？
//   ③ 直接调它一次，草稿变了吗？
// **它不改产品代码、不注入产物** —— 只观察与调用，因此它的结论就是现场本身。
//
// 用法：node scripts/qa/mention-insert-live-probe.mjs --url=<带 token 的启动地址> [--debug-port=9234]
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const DEBUG_PORT = Number(arg('debug-port', '9234'));
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

let browser = null;
let work = null;

try {
  const launchUrl = arg('url', '');
  if (launchUrl === '') { console.log('mention-insert-live-probe: 需要 --url=<带 token 的启动地址>'); process.exit(2); }
  if (!existsSync(CHROME)) { console.log(`SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }

  work = mkdtempSync(join(tmpdir(), 'dsh-live-probe-'));
  const userData = join(work, 'browser');
  mkdirSync(userData, { recursive: true });
  browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

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

  const cdp = await new Promise((resolve, reject) => {
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
  await sleep(2500);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
    await sleep(500);
  }

  const state = JSON.parse(await ev(`(() => {
    const fn = window.__dshMentionInsert;
    const all = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    return JSON.stringify({
      insertType: typeof fn,
      insertKeys: fn === undefined || fn === null ? [] : Object.keys(fn),
      editableCount: all.length,
      firstEditable: all.length === 0 ? null : (all[0].className || all[0].tagName),
      hasMeta: document.querySelector('meta[name="dsh-math-memory-mention-stream"]') !== null,
      hasDropHandle: typeof window.__dshMathMemoryDropMention === 'function'
    });
  })()`));
  console.log('  现场状态:', JSON.stringify(state, null, 2));
  check('页面里有 window.__dshMentionInsert（apply() 装了它）', state.insertType === 'function', state.insertType);
  check('页面里只有一个可编辑元素（composer）', state.editableCount === 1, `count=${state.editableCount}`);
  check('drop 句柄也在（说明 drop-mention 与 mention-inbox 都装上了）', state.hasDropHandle === true, String(state.hasDropHandle));

  // 先放半句话，再直接调用落笔入口 —— 这是"SSE 收到之后"那一行的等价物。
  const REL = '探针/直调落笔.md';
  await ev(`(() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, '前半句');
    return true;
  })()`);
  await sleep(400);
  const before = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  check('准备：草稿里打进了半句话', String(before).includes('前半句'), JSON.stringify(before));

  const called = await ev(`(() => {
    try { return JSON.stringify({ returned: window.__dshMentionInsert(${JSON.stringify(REL)}) }); }
    catch (e) { return JSON.stringify({ threw: String(e && e.message || e) }); }
  })()`);
  console.log('  直调结果:', called);
  await sleep(500);
  const after = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  console.log('  直调后草稿:', JSON.stringify(after));
  check('调用 __dshMentionInsert 后草稿里出现 @路径', String(after).includes('@' + REL), JSON.stringify(after));
  check('原有半句话没被替换', String(after).includes('前半句'), JSON.stringify(after));

  console.log(`\n__CHECKS__ ${passed}/${total}`);
  process.exitCode = passed === total ? 0 : 1;
} catch (error) {
  console.log('[FAIL] 探针异常: ' + String(error?.message ?? error));
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  process.exitCode = 1;
} finally {
  try { browser?.kill(); } catch { /* ignore */ }
  if (work !== null) { try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } }
}
