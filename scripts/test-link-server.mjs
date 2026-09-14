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
pluginD.app.workspace = { openLinkText: () => { pluginD.opened = true; } };
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
check('④ /open 令牌正确 → 200 且真的调用了 openLinkText', openOk.status === 200 && pluginD.opened === true, `status=${openOk.status} opened=${pluginD.opened === true}`);
const feedbackBadToken = await get('/feedback?path=.deepseek/memory/records/a.md&action=confirm&t=wrong');
check('④ /feedback 令牌不对 → 403', feedbackBadToken.status === 403, `status=${feedbackBadToken.status}`);
const feedbackTraversal = await get('/feedback?path=' + encodeURIComponent('.deepseek/../secret.md') + '&action=confirm&t=abc123');
check('④ /feedback 路径穿越 → 400/403', feedbackTraversal.status === 400 || feedbackTraversal.status === 403, `status=${feedbackTraversal.status}`);
await d.stop();

console.log(`__CHECKS__ ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
