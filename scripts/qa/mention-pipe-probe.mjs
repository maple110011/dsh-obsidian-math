// scripts/qa/mention-pipe-probe.mjs — 整条链路：Obsidian 侧 POST → SSE → 页面订阅者 → 落进草稿。
//
// WHY THIS EXISTS。2026-09-21 排查时所有探针都是**分段**的：进程层面测过 SSE（POST 204 → 收到
// `data:`）、页面层面测过落笔（`__dshMentionInsert` 直调成功）、订阅层面测过连接（EventSource 建了、
// 收到了 message）—— 但**没有一条探针把这三段接起来**。于是"每一段都绿、整条链却不通"的状态可以
// 长期存在，而用户的现场正是这样。
//
// 这个探针自己搭出"插件那一侧"：一个桩 LinkServer（`/mention` + `/mention-stream` + `/mention-report`）
// 加一个把 `<meta name="dsh-math-memory-mention-stream">` 注入 HTML 的反代（照抄 `DshWebProxy` 的做法），
// 然后起真 dsh、用真浏览器打开**反代那个地址**（与 Obsidian 侧栏同形态），最后从桩服务端推一条路径，
// 断言草稿里真的出现 `@路径`，并要求页面的自述诊断到达桩服务端。
//
// 用法：node scripts/qa/mention-pipe-probe.mjs [--port=3405] [--debug-port=9236]
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const DSH_PORT = Number(arg('port', '3405'));
const DEBUG_PORT = Number(arg('debug-port', '9236'));
const STUB_PORT = DSH_PORT + 100;
const PROXY_PORT = DSH_PORT + 200;
const TOKEN = 'probe-token-0123456789';
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const BIN = process.env.DSH_BIN || join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

let child = null;
let browser = null;
let work = null;
let stub = null;
let proxy = null;

const stubState = { clients: new Set(), reports: [], posts: [] };

try {
  if (!existsSync(BIN)) { console.log(`mention-pipe-probe: SKIP（找不到 dsh：${BIN}）`); process.exit(0); }
  if (!existsSync(CHROME)) { console.log(`mention-pipe-probe: SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }

  work = mkdtempSync(join(tmpdir(), 'dsh-pipe-probe-'));
  // vault 目录用**唯一名字**：dsh 的工作区选择器按目录名显示，多个探针都叫 `vault` 就没法确定性点中
  // （而且会在用户的全局工作区表里堆一串同名垃圾）。
  const vaultName = `probe-vault-${Math.random().toString(16).slice(2, 10)}`;
  const vault = join(work, vaultName);
  mkdirSync(join(vault, '.deepseek'), { recursive: true });

  // ── 桩 LinkServer：与 obsidian/main.template.js 的 LinkServer 同一套形状（/mention、/mention-stream、
  //    /mention-report，token 走 `?t=`） ──────────────────────────────────────────────────────────
  stub = createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    if (u.pathname === '/mention-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      const client = { res };
      stubState.clients.add(client);
      req.on('close', () => stubState.clients.delete(client));
      for (const pending of stubState.pending ?? []) res.write(`data: ${JSON.stringify(pending)}\n\n`);
      stubState.pending = [];
      return;
    }
    if (u.pathname === '/mention-report') {
      const entry = Object.fromEntries(u.searchParams.entries());
      stubState.reports.push(entry);
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return;
    }
    if (u.pathname === '/mention') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rel = Buffer.concat(chunks).toString('utf8').trim();
        stubState.posts.push(rel);
        const frame = `data: ${JSON.stringify(rel)}\n\n`;
        if (stubState.clients.size === 0) (stubState.pending ??= []).push(rel);
        for (const c of [...stubState.clients]) { try { c.res.write(frame); } catch { stubState.clients.delete(c); } }
        res.writeHead(204, { 'access-control-allow-origin': '*' });
        res.end();
      });
      return;
    }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));
  check('桩 LinkServer 起来了', stub.listening === true, `port=${STUB_PORT}`);

  // ── 起真 dsh ───────────────────────────────────────────────────────────────
  const logFd = openSync(join(work, 'dsh.log'), 'w');
  const errFd = openSync(join(work, 'dsh.err'), 'w');
  const patch = join(DSH_HOME, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');
  const patchArgs = existsSync(patch) ? ['--patch', patch] : [];
  child = spawn(process.execPath, [BIN, '--profile', 'notes-assistant', ...patchArgs, '--no-open', '--port', String(DSH_PORT)], {
    env: { ...process.env, DSH_HOME, DSH_WORKSPACE_ROOT: vault, DSH_OBSIDIAN_VAULT: vault },
    stdio: ['ignore', logFd, errFd]
  });
  closeSync(logFd);
  closeSync(errFd);
  let upstream = '';
  const logPath = join(work, 'dsh.log');
  for (let i = 0; i < 120 && upstream === ''; i += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(readFileSync(logPath, 'utf8'));
      if (m !== null) upstream = `http://127.0.0.1:${m[1]}`;
    } catch { /* not yet */ }
  }
  check('真 dsh 起来了', upstream !== '', upstream || `(exit=${child.exitCode})`);
  if (upstream === '') throw new Error('dsh 没起来：后续结论无意义');
  const upstreamOrigin = new URL(upstream).origin;

  // ── 反代：照抄 DshWebProxy 的关键两步 —— ① 用 ?token= 兑换 cookie；② 往导航 HTML 注入 meta ─────
  //
  // ⚠️ 少了 ①，上游会给一个未授权的空壳，页面根本渲染不出 composer —— 探针会看起来像"功能坏了"。
  // 这正是本仓库反复踩到的那类坑：**夹具自己缺件造成的假红**。
  let cookie = '';
  {
    const path = /http:\/\/127\.0\.0\.1:\d+(\/\?token=[A-Za-z0-9_-]+)/.exec(readFileSync(logPath, 'utf8'));
    if (path !== null) {
      cookie = await new Promise((resolve) => {
        const req = httpRequest({ host: '127.0.0.1', port: DSH_PORT, path: path[1], method: 'GET', headers: { host: `127.0.0.1:${DSH_PORT}`, connection: 'close' } }, (res) => {
          res.resume();
          resolve((res.headers['set-cookie'] ?? []).map((c) => String(c).split(';')[0]).join('; '));
        });
        req.on('error', () => resolve(''));
        req.end();
      });
    }
  }
  check('拿到上游鉴权 cookie（反代的前提）', cookie !== '', cookie === '' ? '(no set-cookie)' : 'ok');
  const inject = (html) => {
    if (!html.includes('</head>')) return html;
    const meta = `<meta name="dsh-math-memory-mention-stream" content="http://127.0.0.1:${STUB_PORT}/mention-stream?t=${TOKEN}">`
      + `<meta name="dsh-math-memory-mention-report" content="http://127.0.0.1:${STUB_PORT}/mention-report?t=${TOKEN}">`;
    return html.replace('</head>', meta + '</head>');
  };
  proxy = createServer((req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${DSH_PORT}` };
    if (cookie !== '') headers.cookie = cookie;
    // ⚠️ 改写正文的代理必须**禁掉上游压缩**（与 `DshWebProxy` 同一条纪律）：带着
    // `accept-encoding` 转发 ⇒ 上游返回 gzip ⇒ 我们解压后用纯文本改写正文，却仍带着
    // `content-encoding: gzip` 发出去 ⇒ 浏览器 gunzip 纯文本失败，页面**永远停在 loading**。
    // 用 curl/node 自测时不会带这个头，所以这个坑只有真浏览器才会暴露。
    delete headers['accept-encoding'];    const upstreamReq = httpRequest({ host: '127.0.0.1', port: DSH_PORT, path: req.url, method: req.method, headers }, (up) => {      const isHtml = String(up.headers['content-type'] ?? '').includes('text/html');
      if (!isHtml) { res.writeHead(up.statusCode, up.headers); up.pipe(res); return; }
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const body = inject(Buffer.concat(chunks).toString('utf8'));
        const headers = { ...up.headers };
        // ⚠️ 逐跳头必须剥掉。上游是 chunked（`transfer-encoding: chunked`），而我们改写正文后要用
        // content-length；两个都发出去会让浏览器认为响应永远没收完 —— 表现是 `readyState` 卡在
        // `loading`、`document.body` 为空，看起来像"页面根本没渲染"，其实是夹具自己发的坏响应。
        for (const h of ['transfer-encoding', 'content-length', 'connection', 'keep-alive']) delete headers[h];
        headers['content-length'] = Buffer.byteLength(body);
        res.writeHead(up.statusCode, headers);
        res.end(body);
      });
    });
    upstreamReq.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* ignore */ } });
    req.pipe(upstreamReq);
  });
  await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
  // ⚠️ 反代还必须**升级 WebSocket**。dsh 的前端靠一条 ws 连接拿会话/工作区状态；不代理 upgrade
  // 时页面会停在"重新连接中… / 选择工作区"，输入框根本不出现 —— 看起来像"拖拽坏了"，其实是夹具缺件。
  proxy.on('upgrade', (req, socket, head) => {
    socket.on('error', () => { /* ignore */ });
    // 浏览器的 Origin 是代理端口，而上游只认它自己的端口 —— 照抄 DshWebProxy 的做法改写来源。
    const headers = { ...req.headers, host: `127.0.0.1:${DSH_PORT}`, origin: `http://127.0.0.1:${DSH_PORT}` };
    if (cookie !== '') headers.cookie = cookie;    const up = httpRequest({ host: '127.0.0.1', port: DSH_PORT, path: req.url, method: req.method, headers });
    up.on('error', () => { try { socket.destroy(); } catch { /* ignore */ } });
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
      for (const [k, v] of Object.entries(upRes.headers)) lines.push(`${k}: ${v}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (upHead !== undefined && upHead.length > 0) socket.unshift(upHead);
      if (head !== undefined && head.length > 0) upSocket.write(head);
      upSocket.on('error', () => { /* ignore */ });
      upSocket.pipe(socket);
      socket.pipe(upSocket);
    });
    up.end();
  });
  check('反代（注入 meta）起来了', proxy.listening === true, `port=${PROXY_PORT}`);

  // ── 真浏览器打开**反代**那个地址（与 Obsidian 侧栏同形态） ─────────────────────────
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

  // 代理不兑换 cookie（探针已在上面兑换过一次）；把带 token 的启动路径透传给页面。
  // ── 关键：把"插件注入的那个 meta"交给页面 ────────────────────────────────────
  //
  // 有两条路都能做到这一点，`--via=proxy` 切换：
  //   · `inject`（默认）：**直连** dsh，在页面脚本之前把两个 meta 塞进 DOM。直连时 dsh 的会话/工作区
  //     走原生 ws，页面能正常渲染出输入框 —— 这是**可靠**的那条路。
  //   · `proxy`：自己起一个反代改写导航 HTML（照抄 DshWebProxy）。更接近真实形态，但 dsh 在反代
  //     背后对"工作区要显式选中"这件事很敏感（页面停在选择器上），夹具很容易因此假红。
  // 两条路测的是同一件事：**客户端拿到 Stream/Report 地址之后，整条投递链通不通**。
  const VIA = arg('via', 'inject');
  const metaScript = `(() => {
    const URLS = {
      'dsh-math-memory-mention-stream': 'http://127.0.0.1:${STUB_PORT}/mention-stream?t=${TOKEN}',
      'dsh-math-memory-mention-report': 'http://127.0.0.1:${STUB_PORT}/mention-report?t=${TOKEN}'
    };
    // 旁听 EventSource：记录每个实例的 URL 与它收到的 message。用来区分
    // "消息没到" 与 "到了但处理器没落笔" —— 这两种在只看草稿时长得一模一样。
    window.__pipeProbe = { streams: [], insertCalls: [] };
    // 同时包住落笔入口（用 defineProperty 在赋值那一刻捕获）：记录**每一次调用及其返回值**。
    // 这是"处理器有没有走到落笔"的直接证据，比任何推断都硬。
    let currentInsert;
    try {
      Object.defineProperty(window, '__dshMentionInsert', {
        configurable: true,
        get() { return currentInsert; },
        set(fn) {
          if (typeof fn !== 'function') { currentInsert = fn; return; }
          currentInsert = function (rel) {
            const entry = { rel: String(rel).slice(0, 80) };
            try { entry.returned = fn.apply(this, arguments); } catch (e) { entry.threw = String(e && e.message || e); }
            try { entry.draftAfter = String(document.querySelector('[contenteditable="true"]').textContent).slice(0, 80); } catch { entry.draftAfter = '(none)'; }
            window.__pipeProbe.insertCalls.push(entry);
            return entry.returned;
          };
        }
      });
    } catch { /* 已被占用则跳过（只影响观察，不影响功能） */ }
    const Native = window.EventSource;
    if (typeof Native === 'function') {
      window.EventSource = function (url, config) {
        const rec = { id: window.__pipeProbe.streams.length, url: String(url), messages: [], listenerRegistered: false, listenerCalls: 0, monitorCalls: 0, hasOnmessage: false };
        window.__pipeProbe.streams.push(rec);
        const real = new Native(url, config);
        const origAdd = real.addEventListener.bind(real);
        real.addEventListener = function (type, listener, opts) {
          if (type === 'message') {
            rec.listenerRegistered = true;
            origAdd(type, (e) => { rec.monitorCalls += 1; rec.messages.push(String(e && e.data).slice(0, 120)); });
            // 包住**调用方的**监听器：它若在调用落笔之前抛错，我们就看得到（否则只能看到"入口零调用"，
            // 而"零调用"与"调了但没效果"在外部观察上完全一样）。
            const wrapped = function (event) {
              rec.listenerCalls += 1;
              try { return listener.call(this, event); }
              catch (err) {
                rec.listenerThrew = String(err && err.message || err);
                window.__pipeProbe.listenerErrors = (window.__pipeProbe.listenerErrors ?? []).concat([rec.listenerThrew]);
                throw err;
              }
            };
            return origAdd(type, wrapped, opts);
          }
          return origAdd(type, listener, opts);
        };
        try {
          Object.defineProperty(real, 'onmessage', {
            configurable: true,
            get() { return rec.onmessageValue ?? null; },
            set(v) { rec.hasOnmessage = true; rec.onmessageValue = v; }
          });
        } catch { /* ignore */ }
        return real;
      };
      window.EventSource.prototype = Native.prototype;
      window.EventSource.CONNECTING = Native.CONNECTING;
      window.EventSource.OPEN = Native.OPEN;
      window.EventSource.CLOSED = Native.CLOSED;
    }
    let done = false;
    const install = () => {
      if (done || document.head === null || document.head === undefined) return false;
      for (const [name, content] of Object.entries(URLS)) {
        if (document.querySelector('meta[name="' + name + '"]') !== null) continue;
        const m = document.createElement('meta');
        m.setAttribute('name', name);
        m.setAttribute('content', content);
        document.head.appendChild(m);
      }
      done = true;
      return true;
    };
    // 这段脚本跑在**文档还没有节点**的时候（before documentElement），所以不能直接 appendChild ——
    // 必须等 <head> 出现。用 MutationObserver 盯住文档级的变化，出现就立刻注入，保证赶在
    // 客户端脚本读 meta 之前。
    if (!install()) {
      const obs = new MutationObserver(() => { if (install()) obs.disconnect(); });
      obs.observe(document, { childList: true, subtree: true });
    }
  })();`;
  if (VIA !== 'proxy') {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: metaScript });
    console.log('  交付方式: 直连 + 页面脚本前注入 meta');
  }

  const launchPath = /http:\/\/127\.0\.0\.1:\d+(\/\?token=[A-Za-z0-9_-]+)/.exec(readFileSync(logPath, 'utf8'));
  const pageUrl = VIA === 'proxy'
    ? `http://127.0.0.1:${PROXY_PORT}${launchPath === null ? '/' : launchPath[1]}`
    : `${upstream}${launchPath === null ? '/' : launchPath[1]}`;
  console.log('  页面地址:', pageUrl);
  await cdp.send('Page.navigate', { url: pageUrl });
  await sleep(3000);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
    await sleep(500);
  }
  const scene = await ev(`JSON.stringify({
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyLen: document.body === null ? -1 : document.body.innerHTML.length,
    htmlLen: document.documentElement === null ? -1 : document.documentElement.outerHTML.length,
    htmlHead: document.documentElement === null ? "" : document.documentElement.outerHTML.slice(0, 300),
    metas: Array.from(document.querySelectorAll("meta[name^='dsh-math-memory']")).map((m) => m.name + "=" + m.getAttribute("content")),
    scripts: document.scripts.length,
    boot: typeof window.__DSH_BOOT__
  })`);
  console.log('  页面现场:', scene);
  // 工作区选择：这台实例的 DSH_HOME 里有别的已登记工作区，dsh 因此先给选择器而不是输入框
  // （用户那台只有 vault，通常会直接进会话）。**必须真的选中**，否则页面停在
  // 「选择一个工作区开始」、输入框不存在，探针会误判成"功能坏了"。
  if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) !== true) {
    const clicked = await ev(`(() => {
      const all = Array.from(document.querySelectorAll('button, li, [role="button"], [role="option"], a, div'));
      const target = all.find((el) => {
        const t = (el.textContent ?? '').trim();
        if (t !== ${JSON.stringify(vaultName)}) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 120;
      });
      if (target === undefined) return 'not-found';
      target.click();
      return 'clicked';
    })()`);
    console.log('  选择工作区:', clicked);
    for (let i = 0; i < 40; i += 1) {
      if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
      await sleep(500);
    }
  }
  check('composer 渲染出来了（经反代）', (await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true, scene);
  if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) !== true) {
    const why = await ev(`JSON.stringify({
      bodyText: document.body === null ? "" : document.body.innerText.slice(0, 300),
      rootHtml: (document.getElementById("root") ?? document.body).innerHTML.slice(0, 400),
      editableAll: document.querySelectorAll("[contenteditable]").length,
      errors: (window.__probeErrors ?? []).slice(0, 5)
    })`);
    console.log('  为什么没有输入框:', why);
  }
  check('注入的 meta 在页面里可见', (await ev(`document.querySelector('meta[name="dsh-math-memory-mention-stream"]') !== null`)) === true);
  check('页面装了落笔入口 __dshMentionInsert', (await ev('typeof window.__dshMentionInsert')) === 'function');

  // 等订阅者连上桩 SSE（这正是"Obsidian 那侧推一条"的前提）。
  for (let i = 0; i < 40 && stubState.clients.size === 0; i += 1) await sleep(250);
  check('页面订阅到了桩 LinkServer 的 /mention-stream', stubState.clients.size >= 1, `clients=${stubState.clients.size}`);

  // 先确保有一个**真实会话**：这台实例是全新的，没有会话时 composer 虽然渲染出来，但宿主不会接受
  // 程序化写入（新会话按钮在侧栏顶部）。点一下「新会话」，等输入框真正可用。
  {
    const started = await ev(`(() => {
      const el = document.querySelector('[contenteditable="true"]');
      if (el !== null) { el.focus(); document.execCommand('insertText', false, 'x'); const ok = String(el.textContent).includes('x'); document.execCommand('selectAll'); document.execCommand('delete'); if (ok) return 'already-live'; }
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a, div'));
      const hit = btns.find((b) => {
        const t = (b.textContent ?? '').trim();
        const r = b.getBoundingClientRect();
        return (t === '新会话' || t === 'New session') && r.width > 0 && r.height > 0;
      });
      if (hit === undefined) return 'no-new-session-button';
      hit.click();
      return 'clicked-new-session';
    })()`);
    console.log('  会话准备:', started);
    if (started === 'clicked-new-session') {
      await sleep(2500);
      for (let i = 0; i < 40; i += 1) {
        if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
        await sleep(500);
      }
    }
  }

  // 草稿里先放半句话：落笔应当插在光标处，而不是整体替换。
  //
  // ⚠️ 用 CDP 的 `Input.insertText`（**可信输入**）而不是 `document.execCommand('insertText')`：
  // Lexical 这类编辑器会忽略不可信的合成输入，于是"准备草稿"这一步会静默失败，草稿始终为空 ——
  // 探针随后会把"草稿为空"误读成"落笔没生效"。夹具必须用与真人等价的输入方式。
  const prepared = await (async () => {
    await ev(`(() => { const el = document.querySelector('[contenteditable="true"]'); if (el !== null) el.focus(); return true; })()`);
    await sleep(200);
    await cdp.send('Input.insertText', { text: '前半句' });
    await sleep(600);
    return ev(`document.querySelector('[contenteditable="true"]') === null ? '(no-composer)' : String(document.querySelector('[contenteditable="true"]').textContent)`);
  })();
  check('准备：草稿里有半句话（用可信输入打进去）', String(prepared).includes('前半句'), JSON.stringify(prepared));

  // ── 关键一步：从"Obsidian 那侧"POST 一条路径 ─────────────────────────────────
  const REL = '抄书/最优传输/最优传输3';
  const body = Buffer.from(REL, 'utf8');
  const code = await new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port: STUB_PORT, path: `/mention?t=${TOKEN}`, method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length, connection: 'close' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', (e) => resolve('error: ' + String(e)));
    req.end(body);
  });
  check('桩 LinkServer 接受了 POST（204）', code === 204, String(code));
  await sleep(1500);

  const draft = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  console.log('  草稿:', JSON.stringify(draft));
  const streams = JSON.parse(await ev('JSON.stringify(window.__pipeProbe ?? { streams: [] })'));
  console.log('  页面 EventSource 记录:', JSON.stringify(streams, null, 2));
  const pageStream = (streams.streams ?? []).find((s) => String(s.url).includes('/mention-stream')) ?? null;
  check('页面订阅了桩 /mention-stream', pageStream !== null, JSON.stringify((streams.streams ?? []).map((s) => s.url)));
  if (pageStream !== null) check('客户端在它上面注册了 message 监听', pageStream.listenerRegistered === true, JSON.stringify(pageStream));
  // 把**仓库里那份产物**的导出表拉出来（截 ModuleLoader 的 load 回调），直接调它的解析函数。
  // "入口零调用"既可能是上报发不出去、也可能是**解析返回了 null** —— 上报通道已单独验证过，
  // 所以这里必须单独验证解析，否则两种解释都活着。
  {
    const parsed = await ev(`(() => {
      const orig = window.__ModuleLoader__ && window.__ModuleLoader__.load;
      if (typeof orig !== 'function') return JSON.stringify({ reason: 'no-loader' });
      let mod = null;
      window.__ModuleLoader__.load = function (spec) {
        if (spec && spec.id === '@dsh-math-memory/client-ui-memory-panel') { try { mod = spec.factory(() => ({})); } catch (e) { mod = { __threw: String(e && e.message || e) }; } }
        return orig.apply(this, arguments);
      };
      const s = document.createElement('script');
      s.src = 'http://127.0.0.1:${DSH_PORT}/plugins/??@dsh-math-memory/client-ui-memory-panel/client.js&rev=probe';
      document.head.appendChild(s);
      const out = { hasMod: mod !== null && mod !== undefined, keys: mod === null || mod === undefined ? [] : Object.keys(mod) };
      if (out.hasMod && typeof mod.parseMentionSseLine === 'function') {
        out.parsed = mod.parseMentionSseLine('data: "抄书/最优传输/最优传输3"');
        out.parsedPlain = mod.parseMentionSseLine('data: 抄书/最优传输/最优传输3');
      }
      return JSON.stringify(out);
    })()`);
    console.log('  产物解析探测:', parsed);
    const p = JSON.parse(parsed);
    check('产物导出了 parseMentionSseLine', (p.keys ?? []).includes('parseMentionSseLine'), JSON.stringify(p));
    if ((p.keys ?? []).includes('parseMentionSseLine')) {
      check('解析 JSON 形态的 SSE 数据行能拿到路径', p.parsed === '抄书/最优传输/最优传输3', JSON.stringify(p.parsed));
    }
  }

  if (pageStream !== null) check('message 事件真的到达了页面', pageStream.messages.length >= 1, JSON.stringify(pageStream.messages));

  // 直接把产物的两个函数拉出来单独验证：**上报通道可用吗？解析可用吗？**
  // 不这么做的话，"入口零调用"既可能是解析为 null、也可能是上报本身发不出去 —— 两种解释都成立。
  {
    const probeExports = await ev(`(() => {
      const out = { ok: false };
      try {
        const orig = window.__ModuleLoader__ && window.__ModuleLoader__.load;
        if (typeof orig !== 'function') { out.reason = 'no-loader'; return JSON.stringify(out); }
        let mod = null;
        const saved = window.__ModuleLoader__.load;
        window.__ModuleLoader__.load = function (spec) {
          if (spec && spec.id === '@dsh-math-memory/client-ui-memory-panel') { try { mod = spec.factory(() => ({})); } catch (e) { out.factoryThrew = String(e && e.message || e); } }
          return saved.apply(this, arguments);
        };
        // 重新求值一份产物（同一文件、同一份代码），只为拿到它的导出表。
        const s = document.createElement('script');
        s.src = '/plugins/??@dsh-math-memory/client-ui-memory-panel/client.js';
        document.head.appendChild(s);
        out.queued = true;
        out.mod = mod;
        return JSON.stringify({ ok: mod !== null, queued: true });
      } catch (e) { out.reason = String(e && e.message || e); return JSON.stringify(out); }
    })()`);
    console.log('  产物导出探测:', probeExports);
  }
  const reportPath = await ev(`(() => {
    // 直接构造一次上报，看它到底有没有发出去（桩服务端会记下来）。
    try {
      const meta = document.querySelector('meta[name="dsh-math-memory-mention-report"]');
      if (meta === null) return 'no-report-meta';
      const url = meta.getAttribute('content');
      fetch(url + (url.includes('?') ? '&' : '?') + 'step=manual-probe&ok=true', { mode: 'no-cors', cache: 'no-store' });
      return 'sent';
    } catch (e) { return 'threw:' + String(e && e.message || e); }
  })()`);
  await sleep(600);
  console.log('  手动上报:', reportPath, ' 桩收到:', stubState.reports.length, '条');
  check('上报通道可用（手动发一条，桩服务端收得到）', stubState.reports.length >= 1, `reports=${stubState.reports.length}`);
  const insertCalls = (streams.insertCalls ?? []);
  console.log('  落笔入口调用记录:', JSON.stringify(insertCalls, null, 2));
  if ((streams.listenerErrors ?? []).length > 0) console.log('  监听器异常:', JSON.stringify(streams.listenerErrors));
  check('客户端的 message 监听器没有抛错', (streams.listenerErrors ?? []).length === 0, JSON.stringify(streams.listenerErrors ?? []));
  check('消息处理器**调用了**落笔入口', insertCalls.length >= 1, `calls=${insertCalls.length}`);
  check('★ 整条链路通了：草稿里出现了 @路径', String(draft).includes('@' + REL), JSON.stringify(draft));
  check('原有半句话没被替换（插在光标处）', String(draft).includes('前半句'), JSON.stringify(draft));

  console.log('  页面自述诊断:', JSON.stringify(stubState.reports, null, 2));
  check('页面的自述诊断到达了桩服务端（说明它真的执行了落笔）', stubState.reports.length >= 1, `${stubState.reports.length} 条`);
  const last = stubState.reports[stubState.reports.length - 1] ?? null;
  if (last !== null) {
    check('诊断说落笔走到了 dispatched 且 ok', last.step === 'dispatched' && last.ok === 'true', JSON.stringify(last));
    check('诊断说这条路是 stream（SSE 推来的）', last.via === 'stream', String(last.via));
  }

  console.log(`\n__CHECKS__ ${passed}/${total}`);
  process.exitCode = passed === total ? 0 : 1;
} catch (error) {
  console.log('[FAIL] 探针异常: ' + String(error?.message ?? error));
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  process.exitCode = 1;
} finally {
  try { browser?.kill(); } catch { /* ignore */ }
  try { child?.kill(); } catch { /* ignore */ }
  try { stub?.close(); } catch { /* ignore */ }
  try { proxy?.close(); } catch { /* ignore */ }
  if (work !== null) { try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } }
}
