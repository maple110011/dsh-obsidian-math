// scripts/qa/sidebar-newchat-probe.mjs — 按需探针（不进 npm test / npm run qa）。
//
// 回答两个问题（用户 2026-09-14 报告）：
//   1. 「侧栏里的“新建对话”按钮点了没反应」——经由插件的回环反代时，点它到底发生了什么？
//      （找按钮 → 真实鼠标点 → 记录 URL / DOM / 新会话是否出现 / 控制台错误 / 失败请求）
//   2. 「Obsidian 刚启动时不卡，用久了才卡」——侧栏开合成本是否随文档规模增长？
//      （同一页面上，先测空会话基线，再往会话里塞 N 个节点复测，对比 RecalcStyle / 帧）
//
// 用法：
//   node scripts/qa/sidebar-newchat-probe.mjs --vault="D:\Obsidian笔记数据库"
//   node scripts/qa/sidebar-newchat-probe.mjs --vault=... --no-proxy        # 直连（对照）
//   node scripts/qa/sidebar-newchat-probe.mjs --vault=... --bloat=4000      # 只做规模对照
//
// 也可以直接打在**正在运行的实例**上（例如 Obsidian 反代）：--entry=http://127.0.0.1:3180/
//
// ⚠️ 两条测量纪律（2026-09-14 实测踩出来的，别重犯）：
//   1. **不要在这个页面上 patch `window.fetch` 去"记录一切"**。dsh 客户端用流式响应维持
//      会话控制流，`res.clone().text()` 会把那条流消耗掉，页面随即永久停在
//      「自动重连中...」/`phase=connecting`——那是**仪器制造的故障**，不是被测对象的问题。
//      （第一次据此得出"服务连不上"的结论是错的。）
//   2. **服务端 `ok:true` ≠ 用户界面有反应**。判断「新建会话能不能用」必须同时看会话列表
//      行数有没有增加 + 有没有跳到新会话，而不是只看 `/api/session/create` 的返回。
//      dsh 的语义是：新建 = 创建一个空白会话并**选中**它，界面留在 hero 页等第一条输入；
//      它**不会**打开一个对话视图。所以"点完停在首页"是设计行为，不是故障。
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
const DSH_BIN = arg('dsh-bin', join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
const DSH_HOME = arg('dsh-home', join(process.env.USERPROFILE ?? '', '.dsh'));
const VAULT = arg('vault', process.env.DSH_OBSIDIAN_VAULT ?? '');
const CHROME = arg('chrome', process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const PROFILE = arg('profile', 'notes-assistant');
const DEBUG_PORT = Number(arg('debug-port', '9341'));
const BLOAT = Number(arg('bloat', '0'));
const SESSION = arg('session', '');
/** 直接打一个已经在跑的实例（如 Obsidian 反代 3180），跳过自己启动 dsh。 */
const ENTRY = arg('entry', '');
const VIA_PROXY = !process.argv.includes('--no-proxy');
const SKIN_SCRIPTS = arg('skin-scripts', 'on') === 'on';
const PERF = arg('perf', 'on') === 'on';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (url) => new Promise((res, rej) => {
  http.get(url, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
  }).on('error', rej);
});

/** Reuse the SHIPPED proxy class (same extraction as test-panel-proxy.mjs). */
function shippedProxyClass() {
  const template = readFileSync(join(repo, 'obsidian', 'main.template.js'), 'utf8');
  const start = template.indexOf('class DshWebProxy {');
  if (start < 0) throw new Error('DshWebProxy not found in obsidian/main.template.js');
  const braceStart = template.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < template.length; i += 1) {
    if (template[i] === '{') depth += 1;
    else if (template[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const source = template.slice(start, i + 1);
        return new Function('createServer', 'httpRequest', 'URL', 'sleep', `${source}\nreturn DshWebProxy;`)(createServer, httpRequest, URL, sleep);
      }
    }
  }
  throw new Error('unbalanced braces for DshWebProxy');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && cdp.pending.has(msg.id)) {
        const { resolve: res, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else res(msg.result);
        return;
      }
      if (msg.method !== undefined) cdp.events.push(msg);
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 60000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}

// Locate the "new session" control: dsh's own aria-label first, then the skin's
// icon fingerprint (skin hooks redraw the host glyph but keep the outer button).
const NEW_SESSION_JS = `(() => {
  const NEW = /新(建)?(的)?(对话|会话)|new (chat|session|conversation)|start (a )?new/i;
  const buttons = [...document.querySelectorAll('button, [role="button"], a')];
  const scored = [];
  for (const el of buttons) {
    const label = (el.getAttribute('aria-label') || '') + ' | ' + (el.getAttribute('title') || '') + ' | ' + (el.textContent || '').slice(0, 40);
    const rect = el.getBoundingClientRect();
    const svg = el.querySelector('svg');
    const iconArt = el.querySelector('[data-orca-link-icon-art]')?.getAttribute('data-orca-link-icon-art') ?? '';
    const pathD = [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') || '').join(' ').slice(0, 80);
    const isNew = NEW.test(label) || iconArt === 'new-session' || /M8\\.00003 0\\.3237/.test(pathD);
    if (isNew) scored.push({
      label, iconArt, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2),
      w: Math.round(rect.width), h: Math.round(rect.height), disabled: el.disabled === true,
      cls: (el.className || '').toString().slice(0, 80), tag: el.tagName,
      parentCls: (el.parentElement?.className || '').toString().slice(0, 80),
      inSidebar: el.closest("[data-slot='sidebar']") !== null,
      pointerEvents: getComputedStyle(el).pointerEvents,
      inertAncestor: el.closest('[inert]') !== null
    });
  }
  return JSON.stringify(scored);
})()`;

/** Toggle the dsh sidebar (the only cheap "does layout cost scale?" action). */
const TOGGLE_JS = `(() => {
  const btn = [...document.querySelectorAll('button, [role="button"]')]
    .find((el) => /sidebar|侧/i.test((el.getAttribute('aria-label') || el.getAttribute('title') || '')));
  const r = btn?.getBoundingClientRect();
  return r && r.width > 0 ? JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.getAttribute('aria-label') || btn.getAttribute('title') }) : null;
})()`;

const metricsOf = async (cdp) => {
  const m = await cdp.send('Performance.getMetrics');
  const pick = (n) => (m.metrics.find((x) => x.name === n) || {}).value ?? 0;
  return { task: pick('TaskDuration'), script: pick('ScriptDuration'), layout: pick('LayoutDuration'), recalc: pick('RecalcStyleDuration'), recalcCount: pick('RecalcStyleCount'), nodes: pick('Nodes'), jsHeap: pick('JSHeapUsedSize') };
};
const diff = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, +(b[k] - a[k]).toFixed(4)]));

/** 6 real sidebar toggles; returns frame stats + perf deltas + element count. */
async function toggleMeasurement(cdp, cycles = 3) {
  const elements = await cdp.eval('document.querySelectorAll("*").length');
  await cdp.eval(`(() => { window.__f = []; window.__loaf = []; let last = performance.now();
    const loop = (t) => { window.__f.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push(Math.round(e.duration)); }).observe({ type: 'long-animation-frame' }); } catch {}
    return true; })()`);
  const before = await metricsOf(cdp);
  let clicks = 0;
  for (let i = 0; i < cycles * 2; i += 1) {
    const at = JSON.parse(await cdp.eval(TOGGLE_JS) ?? 'null');
    if (at === null) break;
    await cdp.click(at.x, at.y);
    clicks += 1;
    await sleep(1200);
  }
  const after = await metricsOf(cdp);
  const probe = await cdp.eval('({ frames: window.__f, loaf: window.__loaf })');
  const frames = probe.frames.filter((f) => f > 0);
  const d = diff(before, after);
  return {
    clicks,
    elements,
    frames: frames.length,
    over33: frames.filter((f) => f > 33).length,
    over50: frames.filter((f) => f > 50).length,
    worst: frames.length ? Math.round(Math.max(...frames)) : 0,
    loaf: probe.loaf.length,
    // 每次重算的平均成本（ms/op）——跨文档规模比较用这个，不要用总量。
    recalcMsPerOp: d.recalcCount > 0 ? +(d.recalc * 1000 / d.recalcCount).toFixed(2) : 0,
    delta: d
  };
}

/** 打开侧栏里某个真实会话（点它的行），用来把"长会话"真的加载进渲染树。 */
const openSessionJs = (title) => `(() => {
  const root = document.querySelector("[data-slot='sidebar']");
  if (root === null) return 'no-sidebar';
  const rows = [...root.querySelectorAll('*')].filter((el) => el.children.length === 0 && (el.textContent || '').includes(${JSON.stringify(title)}));
  const leaf = rows[0];
  if (leaf === undefined) return 'no-row';
  let target = leaf;
  while (target !== null && !(target instanceof HTMLElement && target.getAttribute('role') === 'button') && target.tagName !== 'BUTTON' && target.getAttribute('data-session-id') === null) {
    target = target.parentElement;
    if (target === root) break;
  }
  const clickable = target ?? leaf;
  clickable.click();
  return 'clicked:' + clickable.tagName + '.' + String(clickable.className || '').slice(0, 40);
})()`;

if (!VAULT && ENTRY === '') {
  console.error('sidebar-newchat-probe: 需要 --vault=<vault 路径>（或设 DSH_OBSIDIAN_VAULT），或用 --entry=<已在运行的实例 URL>');
  process.exit(2);
}

let child = null;
let chrome = null;
let proxy = null;
let userData = null;
try {
  // --entry：直接打一个已经在跑的实例（例如 Obsidian 反代 http://127.0.0.1:3180/），
  // 不自己启动 dsh、也不套代理。判断"用户侧到底怎么了"时用这个，别用自建实例的结论代替。
  let entryUrl = ENTRY;
  if (ENTRY === '') {
  const patchFile = join(DSH_HOME, 'profiles', PROFILE, `${PROFILE}.patch.yml`);
  const dshArgs = [DSH_BIN, '--profile', PROFILE, '--no-open', '--port', '0'];
  try { readFileSync(patchFile); dshArgs.splice(3, 0, '--patch', patchFile); } catch { /* no patch */ }
  child = spawn(process.execPath, dshArgs, {
    env: { ...process.env, DSH_HOME, DSH_WORKSPACE_ROOT: VAULT, DSH_OBSIDIAN_VAULT: VAULT },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += String(c); });
  child.stderr.on('data', (c) => { stdout += String(c); });
  let launchUrl = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && launchUrl === null) {
    const m = stdout.match(/https?:\/\/127\.0\.0\.1:(\d+)\/\?token=[^\s]+/);
    if (m) launchUrl = m[0]; else await sleep(300);
  }
  if (launchUrl === null) { console.error('dsh 没有输出启动地址：\n' + stdout.slice(-800)); process.exit(1); }

  entryUrl = launchUrl;
  if (VIA_PROXY) {
    const DshWebProxy = shippedProxyClass();
    proxy = new DshWebProxy({ settings: { sidebarPerformanceMode: PERF, sidebarSkinScripts: SKIN_SCRIPTS } });
    proxy.upstreamPort = Number(new URL(launchUrl).port);
    await proxy.listen(0);
    if (!await proxy.redeem(launchUrl)) throw new Error('代理无法兑换启动 token');
    entryUrl = proxy.baseUrl;
  }
  }

  userData = mkdtempSync(join(tmpdir(), 'dsh-newchat-probe-'));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
  let target = null;
  for (let i = 0; i < 100 && target === null; i += 1) {
    await sleep(400);
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json/list`));
      target = list.find((t) => t.type === 'page') ?? null;
    } catch { /* keep waiting */ }
  }
  if (target === null) throw new Error('Chromium 没有暴露 page target');

  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.navigate', { url: entryUrl });
  await sleep(10000);

  const page = await cdp.eval(`(() => {
    const boot = (typeof window.__DSH_BOOT__ === 'object' && window.__DSH_BOOT__ !== null) ? window.__DSH_BOOT__ : {};
    let modules = null;
    const raw = JSON.stringify(boot);
    const found = raw.match(/@deepseek-ai\\/[a-z0-9-]+|@linxin666\\/[a-z0-9-]+|@dsh-math-memory\\/[a-z0-9-]+/g);
    if (found !== null) modules = [...new Set(found)].sort();
    return {
      url: location.href, skin: document.documentElement.dataset.dshSkin ?? null,
      elements: document.querySelectorAll('*').length,
      perfStyle: !!document.getElementById('dsh-obsidian-sidebar-perf'),
      buttons: document.querySelectorAll('button').length,
      bootKeys: Object.keys(boot),
      modules,
      workspaceSlot: document.querySelector("[data-slot='sidebar']")?.querySelectorAll('[role="treeitem"]').length ?? 0,
      storage: Object.keys(localStorage),
      sidebarTop: (document.querySelector("[data-slot='sidebar']")?.innerText ?? '').split('\\n').slice(0, 14)
    };
  })()`);
  console.log('=== 页面状态 ===');
  console.log(JSON.stringify(page, null, 2));

  // 侧栏里的会话行：找出"选中/展开"等会改变点击路径的状态。
  const rows = await cdp.eval(`(() => {
    const root = document.querySelector("[data-slot='sidebar']");
    if (root === null) return null;
    const out = [];
    root.querySelectorAll('*').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t.length === 0 || t.length > 60) return;
      if (/分钟|小时|天|刚刚/.test(t) === false && /会话|新建/.test(t) === false) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 44), text: t.slice(0, 30), sel: el.getAttribute('aria-selected'), y: Math.round(rect.y), h: Math.round(rect.height), role: el.getAttribute('role'), hasHandlerHint: el.onclick !== null, sessionId: el.getAttribute('data-session-id') || el.closest('[data-session-id]')?.getAttribute('data-session-id') || '' });
    });
    return JSON.stringify(out.slice(0, 12));
  })()`);
  console.log('\n=== 侧栏行（含选中态的原始属性） ===\n' + rows);

  const found = JSON.parse(await cdp.eval(NEW_SESSION_JS) ?? '[]');
  console.log('\n=== 候选「新建对话」控件 ===');
  console.log(found.length ? JSON.stringify(found, null, 2) : '(没找到：aria-label / skin 图标都没匹配上)');

  if (found.length > 0) {
    // 记录 /api/session/create 的请求头与请求体：这是"新建会话"真正的接口契约，
    // 有了它就能在没有浏览器的回归测试里直接复现（见 scripts/test-agent-preset.mjs）。
    const captured = [];
    const onReq = (msg) => {
      if (msg.method !== 'Network.requestWillBeSent') return;
      if (!/session\/create|session%2Fcreate/.test(msg.params.request.url)) return;
      captured.push({ url: msg.params.request.url, method: msg.params.request.method, headers: msg.params.request.headers, postData: msg.params.request.postData ?? null });
    };
    const originalPush = cdp.events.push.bind(cdp.events);
    cdp.events.push = (e) => {
      try { onReq(e); } catch { /* ignore */ }
      return originalPush(e);
    };
    const stateJs = `(() => ({
      url: location.href,
      sidebar: document.querySelector("[data-slot='sidebar']")?.innerText ?? '',
      links: document.querySelectorAll("[data-slot='sidebar'] a[href]").length,
      phase: document.querySelector('[data-phase]')?.dataset.phase ?? null,
      toast: (document.querySelector('[class*="otice"], [role="alert"]')?.textContent ?? '').slice(0, 200)
    }))()`;
    // Prefer the sidebar's own "new session" row; the brand button also matches
    // the label but is decorative (skin sets pointer-events: none on it).
    const at = found.find((f) => !f.disabled && /newSession/.test(f.cls) && f.w > 0 && f.h > 0)
      ?? found.find((f) => !f.disabled && f.w > 0 && f.h > 0)
      ?? found[0];
    const before = await cdp.eval(stateJs);
    const rowsBefore = await cdp.eval(`document.querySelectorAll('[role="treeitem"]').length`);
    cdp.events.length = 0;
    // 命中测试：这个坐标最上层到底是谁？（皮肤/宿主可能在按钮上盖了装饰层）
    const hit = await cdp.eval(`(() => {
      const el = document.elementFromPoint(${at.x}, ${at.y});
      if (el === null) return null;
      const chain = [];
      for (let n = el; n !== null && chain.length < 6; n = n.parentElement) chain.push(n.tagName + '.' + String(n.className || '').slice(0, 40));
      const btn = document.querySelector('button.hHd-Xa_newSession');
      const r = btn?.getBoundingClientRect();
      return JSON.stringify({ top: chain[0], chain, covered: btn !== null && !btn.contains(el) && el !== btn, pointerEvents: getComputedStyle(el).pointerEvents, rect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null });
    })()`);
    console.log('\n=== 命中测试 (x,y) ===\n' + hit);
    // 谁在处理这个按钮？React 的合成事件挂在 root，但"谁注册了监听器/处理器是谁"
    // 只有 CDP 的 DOMDebugger 说得清。
    try {
      const described = await cdp.send('DOM.describeNode', { objectId: (await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("button.hHd-Xa_newSession")' })).result.objectId });
      const objId = described.node.backendNodeId;
      const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: (await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("button.hHd-Xa_newSession")' })).result.objectId, depth: 0, pierce: true });
      const direct = (listeners.listeners ?? []).map((l) => ({ type: l.type, useCapture: l.useCapture, scriptId: l.scriptId, line: l.lineNumber, column: l.columnNumber, passive: l.passive }));
      // 合成事件在 root：把祖先链上的监听器也列一遍，找 React 的宿主 root。
      const chainIds = await cdp.eval(`(() => {
        const out = []; let n = document.querySelector('button.hHd-Xa_newSession');
        while (n !== null && out.length < 8) { n.setAttribute('data-probe-chain', String(out.length)); out.push(out.length); n = n.parentElement; }
        return JSON.stringify(out);
      })()`);
      const rootListeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: (await cdp.send('Runtime.evaluate', { expression: 'document.getElementById("root") ?? document.body' })).result.objectId, depth: 3, pierce: true });
      const rootDirect = (rootListeners.listeners ?? []).filter((l) => l.type === 'click').map((l) => ({ type: l.type, useCapture: l.useCapture, scriptId: l.scriptId, line: l.lineNumber, column: l.columnNumber }));
      console.log(`\n=== 按钮自身的 click 监听器 ===\n${JSON.stringify(direct)}\n=== root 上的 click 监听器（前 6） ===\n${JSON.stringify(rootDirect.slice(0, 6))}`);
      void described; void objId; void chainIds;
    } catch (error) { console.log('listener probe failed: ' + String(error.message ?? error)); }
    console.log(`\n=== 真实点击 (${at.x},${at.y}) cls="${at.cls}" label="${at.label}" pointerEvents=${at.pointerEvents} ===`);
    await cdp.click(at.x, at.y);
    await sleep(4000);
    const after = await cdp.eval(stateJs);
    console.log('before.sidebar: ' + JSON.stringify(before.sidebar.replace(/\n/g, ' / ')));
    console.log('after .sidebar: ' + JSON.stringify(after.sidebar.replace(/\n/g, ' / ')));
    console.log('before: ' + JSON.stringify({ url: before.url, links: before.links, phase: before.phase }));
    console.log('after : ' + JSON.stringify({ url: after.url, links: after.links, phase: after.phase, toast: after.toast }));
    // 判据：点「新建会话」**必须**让侧栏的会话行数增加（那一刻服务端真的建了一个空白会话）。
    // 只看 phase 会误判——dsh 的新建语义就是"建一个空白会话并选中它"，界面留在 hero 页等输入。
    console.log(`点击前后会话行数: ${rowsBefore} → ${await cdp.eval(`document.querySelectorAll('[role="treeitem"]').length`)}（增加 = 新建成功；phase 停在 hero 是设计行为）`);

    const failures = cdp.events.filter((e) => e.method === 'Network.loadingFailed').map((e) => e.params.errorText + ' ' + (e.params.type ?? ''));
    const responses = cdp.events.filter((e) => e.method === 'Network.responseReceived').map((e) => `${e.params.response.status} ${e.params.response.url}`).filter((s) => !/\.(js|css|woff2?|ttf|png|webp|svg|ico|jpg)/.test(s));
    const consoleErrs = cdp.events.filter((e) => e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level))
      .map((e) => `[${e.params.entry.level}] ${e.params.entry.text} ${e.params.entry.url ?? ''}`.slice(0, 240));
    const consoleAll = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled')
      .map((e) => `[${e.params.type}] ` + e.params.args.map((a) => String(a.value ?? a.description ?? a.type)).join(' ').slice(0, 200));
    const wsCreated = cdp.events.filter((e) => e.method === 'Network.webSocketCreated').map((e) => e.params.url);
    const wsSent = cdp.events.filter((e) => e.method === 'Network.webSocketFrameSent').map((e) => String(e.params.response?.payloadData ?? '').slice(0, 200));
    const wsRecv = cdp.events.filter((e) => e.method === 'Network.webSocketFrameReceived').map((e) => String(e.params.response?.payloadData ?? '').slice(0, 200));
    const wsErr = cdp.events.filter((e) => e.method === 'Network.webSocketFrameError' || e.method === 'Network.webSocketClosed')
      .map((e) => e.method + ' ' + JSON.stringify(e.params).slice(0, 200));
    console.log('\n--- 网络失败 ---\n' + (failures.length ? failures.join('\n') : '(无)'));
    console.log('\n--- 非静态响应 ---\n' + (responses.length ? responses.slice(-25).join('\n') : '(无)'));
    console.log('\n--- WebSocket 建立 ---\n' + (wsCreated.length ? wsCreated.join('\n') : '(无)'));
    console.log('\n--- WS 发送(前 8) ---\n' + (wsSent.length ? wsSent.slice(0, 8).join('\n') : '(无)'));
    console.log('\n--- WS 接收(前 8) ---\n' + (wsRecv.length ? wsRecv.slice(0, 8).join('\n') : '(无)'));
    console.log('\n--- WS 错误/关闭 ---\n' + (wsErr.length ? wsErr.join('\n') : '(无)'));
    console.log('\n--- 控制台全部(前 20) ---\n' + (consoleAll.length ? consoleAll.slice(0, 20).join('\n') : '(无)'));
    console.log('\n--- 控制台 error/warning ---\n' + (consoleErrs.length ? consoleErrs.slice(0, 20).join('\n') : '(无)'));
    for (const e of cdp.events.filter((x) => x.method === 'Network.responseReceived' && /session|api\//.test(x.params.response.url))) {
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: e.params.requestId });
        console.log(`\n--- 响应体 ${e.params.response.status} ${e.params.response.url} ---\n` + String(body.body ?? '').slice(0, 600));
      } catch (error) { console.log('(响应体读取失败: ' + String(error.message ?? error) + ')'); }
    }

    // 直接派发 click()：绕开命中测试（皮肤/宿主可能在按钮上方盖了一层装饰）。
    // 它回答的是「按钮的处理器本身还活着吗」，与上面的真实鼠标点击互补。
    console.log('\n=== 直接 el.click() 再试一次 ===');
    cdp.events.length = 0;
    const direct = await cdp.eval(`(() => {
      const btn = document.querySelector('button.hHd-Xa_newSession')
        ?? [...document.querySelectorAll('button')].find((b) => /新建会话/.test(b.getAttribute('aria-label') || b.textContent || '') && /newSession/.test(b.className));
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked:' + (btn.className || '');
    })()`);
    console.log('dispatch: ' + direct);
    await sleep(4000);
    const afterDirect = await cdp.eval(stateJs);
    console.log('after direct: ' + JSON.stringify({ url: afterDirect.url, phase: afterDirect.phase, toast: afterDirect.toast, sidebar: afterDirect.sidebar.replace(/\n/g, ' / ').slice(0, 300) }));
    for (const e of cdp.events.filter((x) => x.method === 'Network.responseReceived' && /api\//.test(x.params.response.url))) {
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: e.params.requestId });
        console.log(`\n--- [direct] 响应体 ${e.params.response.status} ${e.params.response.url} ---\n` + String(body.body ?? '').slice(0, 700));
      } catch { /* ignore */ }
    }
    const directConsole = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled')
      .map((e) => `[${e.params.type}] ` + e.params.args.map((a) => String(a.value ?? a.description ?? a.type)).join(' ').slice(0, 300));
    console.log('\n--- [direct] 控制台 ---\n' + (directConsole.length ? directConsole.slice(0, 10).join('\n') : '(无)'));
    console.log('\n=== 捕获到的 /api/session/create 请求 ===\n' + (captured.length ? JSON.stringify(captured, null, 2).slice(0, 3000) : '(本次点击没有发出该请求)'));
    const apiReqs = cdp.events.filter((e) => e.method === 'Network.requestWillBeSent' && /\/api\//.test(e.params.request.url))
      .map((e) => `${e.params.request.method} ${e.params.request.url}\n      headers=${JSON.stringify(e.params.request.headers)}\n      postData=${String(e.params.request.postData ?? '').slice(0, 300)}`);
    console.log('\n=== 本次所有 /api/ 请求 ===\n' + (apiReqs.length ? apiReqs.slice(-12).join('\n') : '(无)'));

    // 用 CDP 的真实鼠标事件点「在“<当前工作区>”中新建会话」——侧栏行内那个按钮。
    // 它比顶部那个按钮多一条线索：工作区是按钮自己带的，不依赖"当前上下文"状态。
    const rowBtn = found.find((f) => /新建会话/.test(f.label) && f.w === 0);
    if (rowBtn !== undefined) {
      const info = await cdp.eval(`(() => {
        const root = document.querySelector("[data-slot='sidebar']");
        const rows = [...root.querySelectorAll('button')].filter((b) => /新建会话/.test(b.getAttribute('aria-label') || ''));
        return JSON.stringify(rows.map((b) => ({ label: b.getAttribute('aria-label'), rect: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(), cls: (b.className || '').toString().slice(0, 60), pe: getComputedStyle(b).pointerEvents })));
      })()`);
      console.log('\n=== 行内「新建会话」按钮（hover 前/后） ===\n' + info);
    }
  }

  const baseline = await toggleMeasurement(cdp);
  console.log('\n=== 侧栏开合成本：基线（当前会话） ===');
  console.log(JSON.stringify(baseline));

  // 打开一个真实的长会话，再测一次：卡顿是否随"渲染树规模"增长，用真实会话回答。
  if (SESSION !== '') {
    const opened = await cdp.eval(openSessionJs(SESSION));
    console.log(`\n=== 打开会话「${SESSION}」 → ${opened} ===`);
    await sleep(6000);
    const state = await cdp.eval(`(() => ({ phase: document.querySelector('[data-phase]')?.dataset.phase ?? null, elements: document.querySelectorAll('*').length, flowRows: document.querySelectorAll('[data-chat-flow] > *').length }))()`);
    console.log('加载后：' + JSON.stringify(state));
    const longSession = await toggleMeasurement(cdp);
    console.log('\n=== 侧栏开合成本：长会话加载后 ===');
    console.log(JSON.stringify(longSession));
    const ratio = baseline.recalcMsPerOp > 0 ? +(longSession.recalcMsPerOp / baseline.recalcMsPerOp).toFixed(2) : 0;
    console.log(`\n判读：元素 ${baseline.elements} → ${longSession.elements}；每次重算 ${baseline.recalcMsPerOp}ms → ${longSession.recalcMsPerOp}ms（${ratio}×）；最差帧 ${baseline.worst}ms → ${longSession.worst}ms`);
  }

  if (BLOAT > 0) {
    console.log('\n[synthetic bloat] 段已删除：靠注入 div 造出来的数字没有解释力（2026-09-14 结论）。');
    console.log('要看真实长会话的成本，请用 --entry 打开你自己的实例，再点侧栏开合。');
  }

  await cdp.send('Browser.close').catch(() => {});
} finally {
  try { await proxy?.close(); } catch { /* ignore */ }
  chrome?.kill();
  child?.kill();
  await sleep(400);
  if (userData !== null) rmSync(userData, { recursive: true, force: true });
}
process.exit(0);
