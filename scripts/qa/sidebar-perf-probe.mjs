// scripts/qa/sidebar-perf-probe.mjs — 侧栏交互性能探针（**按需运行**，不进 `npm test` / `npm run qa`）。
//
// WHY THIS EXISTS. 「Obsidian 里的 dsh 面板卡顿」排查过程中，第一轮凭静态资源推断
// （皮肤 CSS 的毛玻璃）改错了地方；第二轮改用可复现的测量才定位到真因——皮肤
// `orca-link` 的客户端脚本 `hooks.mjs`（约 14 个 subtree MutationObserver、一个约
// 5 次/秒改状态角色内联样式的循环、一个跟着侧栏动画每帧触发的 ResizeObserver）。
// 这个脚本就是那把尺子：把当时临时写的 CDP 探针固化下来，供以后（换皮肤、升 dsh、
// 换机器）复测。完整结论见 docs/memory/sidebar-performance.md。
//
// 它驱动的是**真实 dsh + 真实前端 + 真实皮肤**：起一个真实实例 →（可选）把插件的
// 回环反代 `DshWebProxy` 挡在前面 → headless Chromium 用 CDP 打开 → 用**真实鼠标
// 事件**点侧栏开合按钮 → 采集帧间隔 / 长动画帧(LoAF) / Task·Layout·RecalcStyle。
//
// 用法：
//   node scripts/qa/sidebar-perf-probe.mjs                          # 直连（皮肤原样）
//   node scripts/qa/sidebar-perf-probe.mjs --via-proxy              # 经已发布的反代（默认开性能模式）
//   node scripts/qa/sidebar-perf-probe.mjs --via-proxy --skin-scripts=off   # 性能模式 + 关皮肤装饰
//   node scripts/qa/sidebar-perf-probe.mjs --via-proxy --perf=off   # 反代在，但性能模式关（对照）
//   node scripts/qa/sidebar-perf-probe.mjs --mutations              # 只统计 DOM 改动流（谁在空转）
//
// 环境：本机需有 Chrome/Edge、真实 dsh 安装与一份 vault（见下）。默认值取自本机；
// 换机器时用参数覆盖：
//   --dsh-bin=<path>  --dsh-home=<path>  --vault=<path>  --chrome=<path>
//   --profile=<name>  --cycles=<n>       --label=<text>
//
// 判读（同轮内比较，不要跨轮比绝对值——基线曾测到最差帧 344ms）：
//   帧 >50ms 的数量、最差帧、RecalcStyleDuration/Count、LoAF 条数。改动检索或皮肤
//   相关行为后，这四项不应变差。
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
const CYCLES = Number(arg('cycles', '3'));
const LABEL = arg('label', '');
const VIA_PROXY = process.argv.includes('--via-proxy');
const PERF = arg('perf', 'on') === 'on';
const SKIN_SCRIPTS = arg('skin-scripts', 'on') === 'on';
const MUTATIONS_ONLY = process.argv.includes('--mutations');
const DEBUG_PORT = Number(arg('debug-port', '9340'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (url) => new Promise((resolvePromise, reject) => {
  http.get(url, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
  }).on('error', reject);
});

/** Reuse the SHIPPED proxy class (extracted the same way test-panel-proxy.mjs does). */
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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
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
      }
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(30);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}

const TOGGLE_JS = `(() => {
  const btn = [...document.querySelectorAll('button, [role="button"]')]
    .find((el) => /sidebar|侧/i.test((el.getAttribute('aria-label') || el.getAttribute('title') || '')));
  const r = btn?.getBoundingClientRect();
  return r && r.width > 0 ? JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.getAttribute('aria-label') || btn.getAttribute('title') }) : null;
})()`;

if (!VAULT) {
  console.error('sidebar-perf-probe: 需要 --vault=<vault 路径>（或设 DSH_OBSIDIAN_VAULT）');
  process.exit(2);
}
if (!process.env.USERPROFILE && !process.argv.some((a) => a.startsWith('--dsh-home='))) {
  console.error('sidebar-perf-probe: 需要 --dsh-home=<DSH_HOME>');
  process.exit(2);
}

let child = null;
let chrome = null;
let proxy = null;
let userData = null;
try {
  const patchFile = join(DSH_HOME, 'profiles', PROFILE, `${PROFILE}.patch.yml`);
  const dshArgs = [DSH_BIN, '--profile', PROFILE, '--no-open', '--port', '0'];
  try {
    readFileSync(patchFile);
    dshArgs.splice(3, 0, '--patch', patchFile);
  } catch { /* profile has no patch file */ }
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
  if (launchUrl === null) {
    console.error('sidebar-perf-probe: dsh 没有输出启动地址：\n' + stdout.slice(-600));
    process.exit(1);
  }

  let entryUrl = launchUrl;
  if (VIA_PROXY) {
    const DshWebProxy = shippedProxyClass();
    proxy = new DshWebProxy({ settings: { sidebarPerformanceMode: PERF, sidebarSkinScripts: SKIN_SCRIPTS } });
    proxy.upstreamPort = Number(new URL(launchUrl).port);
    await proxy.listen(0);
    if (!await proxy.redeem(launchUrl)) throw new Error('代理无法兑换启动 token');
    entryUrl = proxy.baseUrl;
  }

  userData = mkdtempSync(join(tmpdir(), 'dsh-sidebar-probe-'));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
  let target = null;
  let lastError = '';
  for (let i = 0; i < 100 && target === null; i += 1) {
    await sleep(400);
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json/list`));
      target = list.find((t) => t.type === 'page') ?? null;
      if (target === null) lastError = 'frames: ' + list.map((t) => t.type).join(',');
    } catch (error) { lastError = String(error?.message ?? error); }
  }
  if (target === null) throw new Error('Chromium 没有暴露 page target（' + lastError + '）');

  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Page.navigate', { url: entryUrl });
  await sleep(9000);

  const state = await cdp.eval(`(() => ({
    skin: document.documentElement.dataset.dshSkin ?? null,
    sceneNodes: document.querySelectorAll('[class*="orca-ch-"]').length,
    perfStyle: !!document.getElementById('dsh-obsidian-sidebar-perf'),
    elements: document.querySelectorAll('*').length
  }))()`);

  if (MUTATIONS_ONLY) {
    const tally = await cdp.eval(`(async () => {
      const stats = { batches: 0, records: 0, byAttr: {}, byTarget: {} };
      const obs = new MutationObserver((records) => {
        stats.batches += 1;
        stats.records += records.length;
        for (const r of records) {
          if (r.type === 'attributes') {
            stats.byAttr[r.attributeName] = (stats.byAttr[r.attributeName] || 0) + 1;
            const cls = (r.target.getAttribute?.('class') || '').split(/\\s+/).filter((c) => c.startsWith('orca')).slice(0, 2).join(' ');
            const key = r.target.tagName + (cls ? '.' + cls : '');
            stats.byTarget[key] = (stats.byTarget[key] || 0) + 1;
          }
        }
      });
      obs.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      await new Promise((r) => setTimeout(r, 4000));
      obs.disconnect();
      return stats;
    })()`);
    console.log(`${LABEL || 'mutations'} | page=${JSON.stringify(state)}`);
    console.log(`4s 内 DOM 改动：${tally.records} 条 / ${tally.batches} 批`);
    console.log('  按属性: ' + JSON.stringify(Object.entries(tally.byAttr).sort((a, b) => b[1] - a[1]).slice(0, 6)));
    console.log('  按目标: ' + JSON.stringify(Object.entries(tally.byTarget).sort((a, b) => b[1] - a[1]).slice(0, 6)));
  } else {
    const first = JSON.parse(await cdp.eval(TOGGLE_JS) ?? 'null');
    if (first === null) throw new Error('页面上找不到侧栏开合按钮');
    await cdp.eval(`(() => {
      window.__probeFrames = []; window.__probeLoaf = [];
      let last = performance.now();
      const loop = (t) => { window.__probeFrames.push(t - last); last = t; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__probeLoaf.push(Math.round(e.duration)); }).observe({ type: 'long-animation-frame' }); } catch {}
      return true;
    })()`);
    const before = await cdp.send('Performance.getMetrics');
    const labels = [];
    for (let i = 0; i < CYCLES * 2; i += 1) {
      // Re-locate the button every time: a collapsed sidebar moves it.
      const at = JSON.parse(await cdp.eval(TOGGLE_JS) ?? 'null');
      if (at === null) break;
      await cdp.click(at.x, at.y);
      await sleep(1200);
      const after = JSON.parse(await cdp.eval(TOGGLE_JS) ?? 'null');
      labels.push(after?.label ?? 'gone');
    }
    const metrics = await cdp.send('Performance.getMetrics');
    const probe = await cdp.eval('({ frames: window.__probeFrames, loaf: window.__probeLoaf })');
    const pick = (m, n) => (m.metrics.find((x) => x.name === n) || {}).value ?? 0;
    const frames = probe.frames.filter((f) => f > 0);
    const worst = [...frames].sort((a, b) => b - a).slice(0, 5).map((f) => f.toFixed(0));
    const tag = LABEL || (VIA_PROXY ? `proxy(perf=${PERF},skinScripts=${SKIN_SCRIPTS})` : 'direct');
    console.log(`\n=== ${tag} — ${labels.length} 次真实点击，每轮间隔 1.2s`);
    console.log(`page=${JSON.stringify(state)}`);
    console.log(`frames ${frames.length} | >33ms ${frames.filter((f) => f > 33).length} | >50ms ${frames.filter((f) => f > 50).length} | worst ${worst.join(',')}ms`);
    console.log(`Task ${((pick(metrics, 'TaskDuration') - pick(before, 'TaskDuration')) * 1000).toFixed(0)}ms | Script ${((pick(metrics, 'ScriptDuration') - pick(before, 'ScriptDuration')) * 1000).toFixed(0)}ms | Layout ${((pick(metrics, 'LayoutDuration') - pick(before, 'LayoutDuration')) * 1000).toFixed(0)}ms | RecalcStyle ${((pick(metrics, 'RecalcStyleDuration') - pick(before, 'RecalcStyleDuration')) * 1000).toFixed(0)}ms (${pick(metrics, 'RecalcStyleCount') - pick(before, 'RecalcStyleCount')} ops)`);
    console.log(`LoAF ${probe.loaf.length} [${probe.loaf.slice(0, 8).join(',')}]`);
    console.log('判读：同轮内比较；帧 >50ms 与最差帧是最贴近"手感"的两个数。');
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
