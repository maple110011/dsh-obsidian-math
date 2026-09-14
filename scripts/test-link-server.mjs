// scripts/test-link-server.mjs — 链接跳转服务（LinkServer）的端口与令牌必须**跨加载稳定**。
//
// WHY THIS EXISTS（2026-09-14，用户实测）。模型的系统提示里被写进了
// `http://127.0.0.1:<LinkServer 端口>/open?path=…&t=<令牌>`。原先端口是 `listen(0)` 随机
// 分配、令牌每次插件加载重新生成 ⇒ **插件一重载，此前所有回复里的笔记链接立刻失效**
// （端口没人听，或令牌对不上 403）。用户看到的正是"回复里的双链点了没反应"。
// 实测证据：会话日志里模型生成的链接指向 `127.0.0.1:52269`，而该端口早已不存在。
//
// 这个套件用**真起的服务器**验证三件事（不碰 Obsidian、不碰 dsh）：
//   ① 配置了端口就绑在配置端口上（而不是随机端口）；
//   ② 令牌首次生成后写回 settings，第二次构造复用**同一个**令牌；
//   ③ 端口被占时回落随机端口，且**不抛异常**（宁可不稳定也不能起不来）。
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync as read } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(join(root, 'obsidian', 'main.template.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

/** 按大括号配平切出一个 `class X { … }`。 */
function classSource(name) {
  const start = template.indexOf(`class ${name} {`);
  if (start < 0) throw new Error(`class ${name} not found`);
  const braceStart = template.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < template.length; i += 1) {
    if (template[i] === '{') depth += 1;
    else if (template[i] === '}') {
      depth -= 1;
      if (depth === 0) return template.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const constants = {
  FEEDBACK_ACTIONS: new Set(['confirm', 'wrong', 'inapplicable', 'stale', 'forget']),
  resolve: (base, ...rest) => [base, ...rest].join('/'),
  existsSync: () => true,
  pathInside: () => true,
  existsSyncNode: existsSync
};
const LinkServer = new Function(
  'createServer', 'randomBytes', 'resolve', 'existsSync', 'pathInside', 'FEEDBACK_ACTIONS', 'openNote',
  `${classSource('LinkServer')}\nreturn LinkServer;`
)(createServer, randomBytes, constants.resolve, constants.existsSync, constants.pathInside, constants.FEEDBACK_ACTIONS, () => {});

/** 最小插件替身：只需要 settings / saveSettings / service.appendLog / app。 */
function makePlugin(settings) {
  const saved = [];
  return {
    settings,
    savedCount: () => saved.length,
    saveSettings: async () => { saved.push({ ...settings }); },
    service: { appendLog: () => {} },
    app: { vault: { adapter: { getBasePath: () => root } } }
  };
}

// ① 配置了端口 → 绑在配置端口上。
const freePort = 39301;
const pluginA = makePlugin({ linkServerPort: freePort, linkServerToken: '' });
const a = new LinkServer(pluginA);
a.start();
await sleep(400);
check('① 绑在配置的固定端口上', a.port === freePort, `port=${a.port} wanted=${freePort}`);
check('① 首次启动生成并持久化令牌', pluginA.settings.linkServerToken.length >= 16 && pluginA.savedCount() > 0, `token=${pluginA.settings.linkServerToken.slice(0, 8)}… saves=${pluginA.savedCount()}`);
await a.stop();

// ② 第二次构造（模拟插件重载）→ 同一个端口 + 同一个令牌。
const pluginB = makePlugin({ linkServerPort: freePort, linkServerToken: pluginA.settings.linkServerToken });
const b = new LinkServer(pluginB);
b.start();
await sleep(400);
check('② 重载后端口不变（旧链接还活着）', b.port === freePort, `port=${b.port}`);
check('② 重载后令牌不变（旧链接不会被 403）', b.token === a.token, `token=${b.token.slice(0, 8)}…`);
check('② 复用令牌时不再重复写 settings', pluginB.savedCount() === 0, `saves=${pluginB.savedCount()}`);
await b.stop();

// ③ 端口被占 → 回落随机端口，且不抛。
const blocker = createServer(() => {});
await new Promise((resolve) => blocker.listen(freePort, '127.0.0.1', resolve));
const pluginC = makePlugin({ linkServerPort: freePort, linkServerToken: 'x'.repeat(32) });
const c = new LinkServer(pluginC);
let threw = null;
try { c.start(); } catch (error) { threw = error; }
await sleep(600);
check('③ 端口被占时不抛异常', threw === null, threw === null ? '' : String(threw));
check('③ 端口被占时回落到另一个端口', c.port > 0 && c.port !== freePort, `port=${c.port}`);
await c.stop();
await new Promise((resolve) => blocker.close(resolve));

// ④ 两个端点都受令牌保护（CSRF），且各自的状态码符合契约。
const pluginD = makePlugin({ linkServerPort: 39302, linkServerToken: 'abc123' });
const openedWith = [];
pluginD.app.workspace = { openLinkText: (path, source, newLeaf) => { openedWith.push({ path, source, newLeaf }); } };
const d = new LinkServer(pluginD);
d.start();
await sleep(400);
const get = (path) => new Promise((resolve) => {
  import('node:http').then(({ get: httpGet }) => {
    const req = httpGet({ host: '127.0.0.1', port: d.port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
});
const openNoToken = await get('/open?path=' + encodeURIComponent('数学/随便.md'));
check('④ /open 缺令牌 → 403（CSRF 防护，与 /feedback 一致）', openNoToken.status === 403, `status=${openNoToken.status}`);
const openBadToken = await get('/open?path=' + encodeURIComponent('数学/随便.md') + '&t=wrong');
check('④ /open 令牌不对 → 403', openBadToken.status === 403, `status=${openBadToken.status}`);
const openOk = await get('/open?path=' + encodeURIComponent('数学/随便.md') + '&t=abc123');
check('④ /open 令牌正确 → 204 且**空响应体**（不再有中转页）', openOk.status === 204 && openOk.body === '', `status=${openOk.status} bodyLen=${openOk.body.length}`);
check('④ 打开笔记时 newLeaf=true（不顶掉用户当前页）', openedWith.length === 1 && openedWith[0].newLeaf === true, JSON.stringify(openedWith[0] ?? null));
const openCurrent = await get('/open?path=' + encodeURIComponent('数学/随便.md') + '&t=abc123&pane=current');
check('④ pane=current 时 newLeaf=false（可回退旧行为）', openedWith.length === 2 && openedWith[1].newLeaf === false, JSON.stringify(openedWith[1] ?? null));
const feedbackBadToken = await get('/feedback?path=.deepseek/memory/records/a.md&action=confirm&t=wrong');
check('④ /feedback 令牌不对 → 403', feedbackBadToken.status === 403, `status=${feedbackBadToken.status}`);
const feedbackTraversal = await get('/feedback?path=' + encodeURIComponent('.deepseek/../secret.md') + '&action=confirm&t=abc123');
check('④ /feedback 路径穿越 → 400/403', feedbackTraversal.status === 400 || feedbackTraversal.status === 403, `status=${feedbackTraversal.status}`);
await d.stop();

// ⑤ 注入的点击拦截脚本：点笔记链接**不能**把 iframe 导航走（否则 SPA 被卸载重载），
//    也不能留下 `target="_blank"`（那会在事件分派之外开新窗口 ⇒ Electron 交给系统浏览器，
//    就是用户看到的"外部网页"）。用真浏览器（headless Chromium）+ CDP 验证，因为这是页内行为。
//
// ⚠️ 提取方法的坑（我自己先踩了两次）：
//   ① 按"从方法名切到第一个 `\n  }`"取源码 ⇒ 撞上方法体内的内嵌函数声明，脚本被**截断**；
//   ② 取出 `return \`…\`` 之间的**源码文本**（还带着 `` ` + `` 拼接符号与 `\`` 转义）
//      当作字符串用 ⇒ 浏览器里 `SyntaxError: Unexpected token 'if'`，拦截器根本没跑，
//      而现象（target 还在）会把人引向"代码没生效"这个错误结论。
//   正确做法：按配平大括号取出方法体，**求值 `return` 那段源码**，拿到真正的字符串。
const interceptor = (() => {
  const at = template.indexOf('noteLinkInterceptor() {');
  if (at < 0) throw new Error('noteLinkInterceptor not found in the template');
  const braceStart = template.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < template.length; i += 1) {
    if (template[i] === '{') depth += 1;
    else if (template[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = template.slice(braceStart, end + 1);
  const start = body.indexOf('return ');
  const stop = body.lastIndexOf(';');
  if (start < 0 || stop < 0) throw new Error('noteLinkInterceptor: return statement not found');
  // eslint-disable-next-line no-new-func -- 源码是本仓库的；这里只是让 JS 自己解析模板字面量
  return new Function(body.slice(start, stop + 1))();
})();
check('⑤ 拦截脚本提取完整且是真字符串（含 candidate/strip/MutationObserver/click）',
  typeof interceptor === 'string' && !interceptor.includes('` +')
  && interceptor.includes('function candidate') && interceptor.includes('function strip')
  && interceptor.includes('MutationObserver') && interceptor.includes('addEventListener("click"'),
  `${typeof interceptor === 'string' ? interceptor.length : 'n/a'} 字节`);

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(CHROME)) {
  console.log('[skip] ⑤ 真浏览器验证 | 找不到 Chromium（' + CHROME + '）');
} else {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, rmSync: rm } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const hits = [];
  const page = createServer((req, res) => {
    if (req.url.startsWith('/open')) { hits.push(req.url); res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    // 关键：dsh 的 markdown 渲染器会给这些链接加 `target="_blank" rel="noopener noreferrer"`，
    // 而 `_blank` 的新窗口请求发生在事件分派**之外**（preventDefault 拦不住）——夹具必须带上它，
    // 否则这条回归测不到真问题。
    res.end('<!doctype html><html><head>' + interceptor + '</head><body><div id="marker">dsh-app-mounted</div>'
      + '<a id="note" href="/open?path=' + encodeURIComponent('数学/随便.md') + '&t=abc123" target="_blank" rel="noopener noreferrer">笔记</a>'
      + '<a id="outside" href="http://example.com/x" target="_blank">外部</a>'
      + '<div id="late"></div></body></html>');
  });
  await new Promise((resolve) => page.listen(0, '127.0.0.1', resolve));
  const pagePort = page.address().port;
  const userData = mkdtempSync(join(tmpdir(), 'dsh-link-'));
  const debugPort = 9371;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
  let target = null;
  for (let i = 0; i < 60 && target === null; i += 1) {
    await sleep(400);
    try {
      const list = await new Promise((resolve, reject) => {
        import('node:http').then(({ get }) => get(`http://127.0.0.1:${debugPort}/json/list`, (r) => {
          const c = [];
          r.on('data', (d) => c.push(d));
          r.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString('utf8'))));
        }).on('error', reject));
      });
      target = list.find((t) => t.type === 'page') ?? null;
    } catch { /* wait */ }
  }
  if (target === null) {
    check('⑤ 真浏览器验证', false, 'Chromium 没有暴露 page target');
  } else {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    });
    const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error('timeout ' + method)); } }, 30000); });
    const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${pagePort}/` });
    await sleep(1200);
    check('⑤ 初始化时就去掉了 target/rel（否则 _blank 会开外部窗口）',
      (await evalJs('document.getElementById("note").getAttribute("target")')) === null
      && (await evalJs('document.getElementById("note").getAttribute("rel")')) === null,
      'target=' + String(await evalJs('document.getElementById("note").getAttribute("target")')));
    // 渲染器会不断重建链接 ⇒ 后续插入的链接也必须被清掉（MutationObserver）。
    await evalJs(`(() => {
      const a = document.createElement('a');
      a.id = 'lateLink';
      a.setAttribute('href', '/open?path=x.md&t=abc123');
      a.setAttribute('target', '_blank');
      a.textContent = '晚到的链接';
      document.getElementById('late').appendChild(a);
    })()`);
    await sleep(300);
    check('⑤ 运行中新插入的链接也被清掉 target（渲染器会重建）', (await evalJs('document.getElementById("lateLink").getAttribute("target")')) === null);
    await evalJs('document.getElementById("note").click()');
    await sleep(700);
    check('⑤ 点笔记链接后页面没有被导航走（marker 还在）', await evalJs('!!document.getElementById("marker")') === true);
    check('⑤ 点笔记链接确实发出了 /open 请求', hits.length === 1, `hits=${hits.join(',') || '(none)'}`);
    // 外部链接必须**不被**拦截。判据不能看 location（点完页面已经导航走了，读到的就是
    // example.com，我第一版就写错了）：直接在**窗口级捕获**里记录 defaultPrevented——
    // 窗口监听先于 document 监听执行，此时读到的就是拦截器是否调用过 preventDefault。
    const outsidePrevented = await evalJs(`(() => {
      let prevented = null;
      const spy = (event) => { prevented = event.defaultPrevented; };
      window.addEventListener('click', spy, true);
      document.getElementById('outside').click();
      window.removeEventListener('click', spy, true);
      return prevented;
    })()`);
    check('⑤ 外部链接不被拦截（defaultPrevented 为 false）', outsidePrevented === false, `defaultPrevented=${String(outsidePrevented)}`);
    check('⑤ 外部链接没有产生 /open 请求', hits.length === 1, `hits=${hits.length}`);
    ws.close();
  }
  chrome.kill();
  await new Promise((resolve) => page.close(resolve));
  // Chromium 的 profile 目录在 kill 之后仍可能被锁住（Windows 上频繁 EPERM）；
  // 删不掉只是留下一个临时目录，绝不能因此把整套测试判红。
  try { rm(userData, { recursive: true, force: true }); } catch { /* 留给系统清理 */ }
}

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
