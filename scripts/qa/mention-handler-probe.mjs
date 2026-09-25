// scripts/qa/mention-handler-probe.mjs — 收到 SSE 消息那一刻，处理器到底调没调落笔？调用结果是什么？
//
// WHY THIS EXISTS。2026-09-21 排查到最后一步：真页面上
//   · `window.__dshMentionInsert` **存在**，直接调它 → 草稿真的出现 `@路径`（`mention-insert-live-probe.mjs` 7/7）；
//   · `/mention-stream` **订阅成功**（errors:0），服务端推一条，页面 **message 事件确实收到** `"路径"`；
//   · 可草稿还是空的（`mention-stream-delivery-probe.mjs` 6/7）。
// 三者放在一起只留下一个可能：**消息处理器那一行**没走到落笔、或走到了但结果不同。这个探针把
// `__dshMentionInsert` 包一层记录**每一次调用及其返回值**，于是那一行变成可见事实。
//
// 用法：node scripts/qa/mention-handler-probe.mjs --url=<带 token 的启动地址> [--debug-port=9235]
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
const DEBUG_PORT = Number(arg('debug-port', '9235'));
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
  if (launchUrl === '') { console.log('mention-handler-probe: 需要 --url=<带 token 的启动地址>'); process.exit(2); }
  if (!existsSync(CHROME)) { console.log(`SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }

  work = mkdtempSync(join(tmpdir(), 'dsh-handler-probe-'));
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

  // 装一个"在页面脚本之前跑"的钩子：
  //   ① 页面自己的 apply() 装 __dshMentionInsert 时立刻把它包起来（用 defineProperty 捕获赋值）；
  //   ② 同时包住 EventSource 的 message 监听注册，记录"message 事件真的到了"以及它到达的顺序。
  // 两者放在一起才能区分"消息没到"与"到了但处理器没调落笔" —— 这两种在日志里长得一模一样。
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__insertCalls = [];
      window.__esLog = [];
      let current = undefined;
      try {
        Object.defineProperty(window, '__dshMentionInsert', {
          configurable: true,
          get() { return current; },
          set(fn) {
            if (typeof fn !== 'function') { current = fn; return; }
            current = function (rel) {
              const entry = { rel: String(rel).slice(0, 80), at: Date.now() };
              try {
                const out = fn.apply(this, arguments);
                entry.returned = out;
              } catch (e) { entry.threw = String(e && e.message || e); }
              entry.draftAfter = (() => { try { return String(document.querySelector('[contenteditable="true"]').textContent).slice(0, 80); } catch { return '(none)'; } })();
              window.__insertCalls.push(entry);
              return entry.returned;
            };
          }
        });
      } catch (e) { window.__insertHookError = String(e && e.message || e); }
      const Native = window.EventSource;
      if (typeof Native === 'function') {
        window.EventSource = function (url, config) {
          const rec = { url: String(url), handled: false, addListenerCalls: 0 };
          window.__esLog.push(rec);
          const real = new Native(url, config);
          const origAdd = real.addEventListener.bind(real);
          real.addEventListener = function (type, listener, opts) {
            rec.addListenerCalls += 1;
            if (type === 'message') {
              rec.handled = true;
              // 外层先挂一个"只旁观"的监听（不改数据、不阻止传播），再原样挂上调用方的监听。
              // 这样即使调用方的监听抛错/被移除，我们也能知道"事件到底有没有送达这个 EventSource"。
              origAdd(type, (e) => {
                rec.sawEvent = true;
                rec.phases = (rec.phases ?? []).concat([e.eventPhase]);
                rec.data = String(e && e.data).slice(0, 120);
              });
            }
            return origAdd(type, listener, opts);
          };
          return real;
        };
        window.EventSource.prototype = Native.prototype;
        window.EventSource.CONNECTING = Native.CONNECTING;
        window.EventSource.OPEN = Native.OPEN;
        window.EventSource.CLOSED = Native.CLOSED;
      }
    })();`
  });

  await cdp.send('Page.navigate', { url: launchUrl });
  await sleep(2500);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
    await sleep(500);
  }
  check('composer 渲染出来了', (await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true);
  const hookError = await ev('window.__insertHookError ?? null');
  check('落笔入口被我们包住了（没有 hook 错误）', hookError === null, String(hookError));

  // 先放半句话 + 聚焦 composer（真实用户拖之前就是聚焦状态）。
  await ev(`(() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, '前半句');
    el.focus();
    return true;
  })()`);
  await sleep(400);
  const before = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  check('准备：草稿里有半句话且 composer 聚焦', String(before).includes('前半句'), JSON.stringify(before));

  const streamUrl = await ev(`(() => { const m = document.querySelector('meta[name="dsh-math-memory-mention-stream"]'); return m === null ? '' : m.getAttribute('content'); })()`);
  if (streamUrl === '') throw new Error('页面上没有 mention-stream meta：这台实例不是走插件代理的');
  const u = new URL(streamUrl);
  const rel = '探针/事件投递.md';
  const body = Buffer.from(rel, 'utf8');
  const code = await new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: u.hostname, port: u.port, path: `/mention${u.search}`, method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length, connection: 'close' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', (e) => resolve('error: ' + String(e)));
      req.end(body);
    });
  });
  check('服务端接受了推送（204）', code === 204, String(code));
  await sleep(1500);

  const calls = JSON.parse(await ev('JSON.stringify(window.__insertCalls)'));
  const esLog = JSON.parse(await ev('JSON.stringify(window.__esLog)'));
  console.log('  EventSource 记录:', JSON.stringify(esLog, null, 2));
  console.log('  落笔入口的调用记录:', JSON.stringify(calls, null, 2));
  const streamEs = esLog.find((e) => String(e.url).includes('/mention-stream')) ?? null;
  check('页面订阅了 /mention-stream', streamEs !== null, streamEs === null ? esLog.map((e) => e.url).join(', ') : streamEs.url);
  if (streamEs !== null) {
    check('调用方确实注册了 message 监听', streamEs.handled === true, JSON.stringify(streamEs));
    check('message 事件真的送达了这个 EventSource', streamEs.sawEvent === true, JSON.stringify(streamEs));
  }
  check('消息处理器**调用了**落笔入口', calls.length >= 1, `calls=${calls.length}`);
  if (calls.length >= 1) {
    check('调用返回 true（递出去了）', calls[0].returned === true, JSON.stringify(calls[0]));
    check('调用后草稿里出现了 @路径', String(calls[0].draftAfter).includes('@' + rel), JSON.stringify(calls[0].draftAfter));
  }
  const draft = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  console.log('  最终草稿:', JSON.stringify(draft));
  check('最终草稿包含 @路径', String(draft).includes('@' + rel), JSON.stringify(draft));

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
