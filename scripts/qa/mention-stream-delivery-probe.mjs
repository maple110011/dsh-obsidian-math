// scripts/qa/mention-stream-delivery-probe.mjs — 页面里那个 EventSource 到底收到了什么？
//
// WHY THIS EXISTS。2026-09-21 排查把范围收到了最后一步：进程层面 `/mention` POST 回 204 → SSE 实测
// 收得到 `data: "路径"`；真产物在真页面里 `describeMentionInsert` 也是 `step:dispatched` 且草稿真的
// 出现了 `@路径`（`mention-insert-probe.mjs`）。所以剩下的唯一可能是**页面那个订阅者没收到消息**
// （或者根本没建 / 建了但连的是别处）。
//
// 这个探针把 `window.EventSource` 换成记录器：记下每个 `new EventSource(url)` 以及每条 `message`，
// 同时**真的**转发给原生 EventSource，这样功能照常工作、我们只是旁听。
//
// 用法：node scripts/qa/mention-stream-delivery-probe.mjs --url=<带 token 的启动地址>
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const DEBUG_PORT = Number(arg('debug-port', '9233'));
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

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
  if (launchUrl === '') { console.log('mention-stream-delivery-probe: 需要 --url=<带 token 的启动地址>'); process.exit(2); }
  const pageOrigin = new URL(launchUrl).origin;
  if (!existsSync(CHROME)) { console.log(`SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }

  work = mkdtempSync(join(tmpdir(), 'dsh-stream-probe-'));
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

  // 先装监听器，再导航：这样页面自己的 apply() 建 EventSource 时我们已经在看着了。
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__streamLog = [];
      const Native = window.EventSource;
      if (typeof Native !== 'function') { window.__streamLog.push({ kind: 'no-native-eventsource' }); return; }
      window.EventSource = function (url, config) {
        const entry = { kind: 'open', url: String(url), messages: [], errors: 0, readyState: -1 };
        window.__streamLog.push(entry);
        const real = new Native(url, config);
        const forward = (type) => real.addEventListener(type, (e) => {
          if (type === 'message') entry.messages.push(String(e && e.data).slice(0, 120));
          if (type === 'error') entry.errors += 1;
          if (type === 'open') entry.readyState = 1;
        });
        ['open', 'message', 'error'].forEach(forward);
        return real;
      };
      window.EventSource.prototype = Native.prototype;
      window.EventSource.CONNECTING = Native.CONNECTING;
      window.EventSource.OPEN = Native.OPEN;
      window.EventSource.CLOSED = Native.CLOSED;
    })();`
  });

  await cdp.send('Page.navigate', { url: launchUrl });
  await sleep(2500);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
    await sleep(500);
  }
  check('composer 渲染出来了', (await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true);

  const opened = JSON.parse(await ev('JSON.stringify(window.__streamLog)'));
  console.log('  页面里的 EventSource 记录:', JSON.stringify(opened, null, 2));
  check('页面自己建了 EventSource（apply() 真的跑了）', opened.some((e) => e.kind === 'open'), `${opened.length} 个`);
  // ⚠️ 页面里还有 dsh 自己的 `/plugins/events`（插件图热更新流），**不能取第一个** —— 这里必须按
  // URL 里是否含 `/mention-stream` 挑，否则拿到的是别人家的流，探针会得出"订阅地址不对"的假结论。
  const source = opened.find((e) => e.kind === 'open' && String(e.url).includes('/mention-stream')) ?? null;
  check('页面订阅了 LinkServer 的 /mention-stream', source !== null, source === null ? `只有 ${opened.map((e) => e.url).join(', ')}` : source.url);
  if (source === null) throw new Error('没有 /mention-stream 订阅者：后续投递结论无意义');

  // 从服务端推一条，看页面收不收得到 —— 这就是"拖拽之后那一步"的等价物。
  const target2 = source === null ? null : new URL(source.url);
  if (target2 !== null) {
    const rel = '探针/推送投递.md';
    const query = target2.search;
    const postBody = Buffer.from(rel, 'utf8');
    const postResult = await new Promise((resolve) => {
      import('node:http').then(({ request }) => {
        const req = request({
          host: target2.hostname, port: target2.port, path: `/mention${query}`, method: 'POST',
          headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': postBody.length, connection: 'close', origin: pageOrigin }
        }, (res) => { res.resume(); resolve(res.statusCode); });
        req.on('error', (e) => resolve('error: ' + String(e)));
        req.end(postBody);
      });
    });
    check('服务端接受了这次推送（204）', postResult === 204, String(postResult));
    await sleep(1200);
    const after = JSON.parse(await ev('JSON.stringify(window.__streamLog)'));
    const src2 = after.find((e) => e.kind === 'open') ?? null;
    console.log('  推送后记录:', JSON.stringify(after, null, 2));
    check('页面收到了 SSE 消息', src2 !== null && src2.messages.length >= 1, JSON.stringify(src2));
    const draft = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
    console.log('  草稿:', JSON.stringify(draft));
    check('草稿里出现了被推送的 @路径', String(draft).includes('@' + rel), JSON.stringify(draft));
  }

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
