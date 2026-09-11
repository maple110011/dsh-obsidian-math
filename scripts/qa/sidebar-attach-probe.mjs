// scripts/qa/sidebar-attach-probe.mjs — 侧栏交互性能探针的「附着模式」（**按需运行**，
// 不进 `npm test` / `npm run qa`）。
//
// 与 sidebar-perf-probe.mjs 的分工：
//   sidebar-perf-probe.mjs   自己起 dsh + 自己起 headless Chromium，测的是**独立浏览器页**
//                            里的 dsh 侧栏（可重复、无需人工点击，但看不到 Obsidian）。
//   本脚本（attach 模式）      附着到**你正在用的 Obsidian**，因此能测**宿主侧**——面板
//                            开合、iframe 重排/合成、Obsidian 自身的渲染成本。
//
// 为什么需要它（2026-09-11）：此前的结论全部来自独立浏览器页，而用户报告的动作是
// 「在 Obsidian 里展开侧栏」。那一层从未被测量过。第一次补测又发现两件事必须写进工具：
//
//   1. **窗口被遮挡/最小化时 rAF 根本不来**（`frames=0`）——那不是"零掉帧"，是"没在画"。
//      本脚本**先等 `document.visibilityState === 'visible'`** 才开始记录，并在结果里
//      报告 `visibilityEnd`；两次实测都因此避免了拿零帧当结论。
//   2. **两侧必须并发采样**。第一版按顺序测（宿主 0–60s，之后 iframe 60–150s），于是宿主
//      的窗口里根本没有用户的点击，"两侧对比"是错的。现在两侧并发、各自返回
//      `epochAtStart`，分析时按**绝对时间**取共同窗口。
//
// 用法：
//   1) 彻底退出 Obsidian，然后（PowerShell）：
//        & '<Obsidian 安装目录>\Obsidian.exe' --remote-debugging-port=9222
//      （Obsidian 是单实例：已经开着的话，再启动一次只会把旧窗口切到前台、开关被忽略。）
//   2) 确认端口在听：浏览器打开 http://127.0.0.1:9222/json/version
//   3) 让 Obsidian 保持**前台可见**，然后：
//        node scripts/qa/sidebar-attach-probe.mjs                 # 记录 90s
//        node scripts/qa/sidebar-attach-probe.mjs --seconds=120
//        node scripts/qa/sidebar-attach-probe.mjs --port=9222 --out=<path>
//      记录期间**点几下 dsh 侧栏的收起/展开**，并（可选）收放 Obsidian 的整个右侧栏。
//
// **只读承诺**：本脚本只发送 `Runtime.evaluate`（安装 rAF 采样器 / LoAF observer /
// 两个**只观察**的 observer）与 `Performance.getMetrics`。**不派发任何 Input 事件，
// 不修改 DOM**。
//
// 已知限制：
//   - 宿主侧的 observer 是「iframe 元素的 ResizeObserver」，它在 observe 时会**立刻**
//     回调一次（那不是用户操作）；若收起右侧栏时 Obsidian 直接把 leaf 卸载/移除，
//     该元素消失、后续不会再回调——此时宿主侧就只有那一次初始回调，**不能据此推断
//     "用户没点"**。
//   - 两侧的 `Performance.getMetrics` 是各自 target 的累计值，差值只在**各自窗口**内有效。
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
const PORT = Number(arg('port', '9222'));
const RECORD_SEC = Number(arg('seconds', '90'));
const WAIT_VISIBLE_SEC = Number(arg('wait-visible', '240'));
const OUT = arg('out', join(tmpdir(), 'sidebar-attach-raw.json'));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const targets = [
  ['host', list.find((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md'))],
  ['iframe', list.find((t) => t.type === 'iframe' && t.url.includes('127.0.0.1:3180'))]
];
for (const [side, t] of targets) {
  if (!t) { console.log(`attach: ${side} target 不存在（Obsidian 没开调试端口？侧栏里没打开 dsh 面板？）`); process.exit(1); }
}

const sampler = (side) => `(async () => {
  const WAIT_V_MS = ${WAIT_VISIBLE_SEC * 1000}, REC_MS = ${RECORD_SEC * 1000};
  const tw = performance.now();
  while (document.visibilityState !== 'visible' && performance.now() - tw < WAIT_V_MS) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (document.visibilityState !== 'visible') return JSON.stringify({ side: '${side}', error: 'window hidden for ' + (WAIT_V_MS / 1000) + 's — nothing measured' });

  const epochAtStart = Date.now();
  const t0 = performance.now();
  const frames = []; let last = t0;
  const loop = (t) => { frames.push([t - t0, t - last]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push([e.startTime - t0, e.duration]); })
    .observe({ type: 'long-animation-frame' }); } catch {}
  const events = [];
  try {
    if ('${side}' === 'iframe') {
      const b = document.body;
      new MutationObserver(() => events.push([performance.now() - t0, 'dsh-sidebar-wide=' + b.getAttribute('data-orca-sidebar-wide')]))
        .observe(b, { attributes: true, attributeFilter: ['data-orca-sidebar-wide'] });
    } else {
      const f = document.querySelector('iframe.dsh-math-assistant-iframe');
      if (f) new ResizeObserver(() => events.push([performance.now() - t0, 'panel=' + f.clientWidth + 'x' + f.clientHeight])).observe(f);
    }
  } catch (err) { events.push([0, 'observer-failed: ' + String(err)]); }

  const tSample = performance.now();
  while (performance.now() - tSample < REC_MS) await new Promise((r) => setTimeout(r, 250));
  return JSON.stringify({ side: '${side}', epochAtStart, visibilityEnd: document.visibilityState,
    recordedMs: Math.round(performance.now() - t0), frames, loaf, events });
})()`;

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('connect timeout')); }, 20000);
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    ws.onopen = () => { clearTimeout(timer); resolve({ call(method, params = {}) { const my = ++id; return new Promise((res) => { pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); }); }, close() { try { ws.close(); } catch {} } }); };
  });
}

async function sampleSide(side, target) {
  const c = await connect(target);
  await c.call('Performance.enable');
  const metricsOf = async () => { const m = await c.call('Performance.getMetrics'); const o = {}; for (const x of m.result.metrics) o[x.name] = x.value; return o; };
  const before = await metricsOf();
  const r = await c.call('Runtime.evaluate', { expression: sampler(side), awaitPromise: true, returnByValue: true });
  const after = await metricsOf();
  c.close();
  const value = r.result?.result?.value;
  if (!value) return { side, error: 'no result: ' + JSON.stringify(r.result?.exceptionDetails ?? r).slice(0, 200) };
  const d = JSON.parse(value);
  d.metrics = {
    task: after.TaskDuration - before.TaskDuration, script: after.ScriptDuration - before.ScriptDuration,
    layout: after.LayoutDuration - before.LayoutDuration, recalc: after.RecalcStyleDuration - before.RecalcStyleDuration,
    recalcCount: after.RecalcStyleCount - before.RecalcStyleCount, layoutCount: after.LayoutCount - before.LayoutCount
  };
  return d;
}

console.log(`sidebar-attach: 两侧【并发】记录 ${RECORD_SEC}s（等可见 ≤${WAIT_VISIBLE_SEC}s）。请让 Obsidian 留在前台，并在此期间点几下 dsh 侧栏的收起/展开。`);

const settled = await Promise.all(targets.map(([side, target]) =>
  sampleSide(side, target).catch((err) => ({ side, error: String(err.message ?? err) }))
));
const raw = {};
for (const d of settled) raw[d.side] = d;
writeFileSync(OUT, JSON.stringify(raw, null, 1), 'utf8');   // RAW BEFORE ANALYSIS
for (const [side] of targets) {
  const d = raw[side];
  console.log(`${side}: ${d.error ? 'ERROR ' + d.error : `recorded ${d.recordedMs}ms frames=${d.frames.length} events=${d.events.length} visibilityEnd=${d.visibilityEnd}`}`);
}

const starts = targets.map(([side]) => raw[side]?.epochAtStart).filter(Number.isFinite);
if (starts.length === 0) { console.log('两个 target 都没有有效数据；见 ' + OUT); process.exit(1); }
const commonStart = Math.max(...starts);
console.log(`\n共同窗口起点 epoch=${commonStart}（两侧起点偏差 ${commonStart - Math.min(...starts)}ms）`);

/** 每侧在共同窗口内的汇总 + 逐秒分桶（秒号按各自 t0，便于与 events 对齐）。 */
for (const [side] of targets) {
  const d = raw[side];
  if (!d || d.error) { console.log(`--- ${side}: ${d?.error ?? 'n/a'}`); continue; }
  const skipMs = Math.max(0, commonStart - d.epochAtStart);
  const fr = d.frames.filter(([t, x]) => Number.isFinite(t) && Number.isFinite(x) && t >= skipMs);
  const dt = fr.map(([, x]) => x);
  const loaf = d.loaf.filter(([t]) => Number.isFinite(t) && t >= skipMs);
  console.log(`--- ${side} (visibilityEnd=${d.visibilityEnd}) ---`);
  console.log(`  frames=${dt.length} >33ms=${dt.filter((x) => x > 33).length} >50ms=${dt.filter((x) => x > 50).length} worst=${dt.length ? Math.round(Math.max(...dt)) : 0}ms  LoAF=${loaf.length} worstLoAF=${loaf.length ? Math.round(Math.max(...loaf.map(([, x]) => x))) : 0}ms`);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  console.log(`  Task=${r3(d.metrics.task)}s Script=${r3(d.metrics.script)}s Layout=${r3(d.metrics.layout)}s(${r3(d.metrics.layoutCount)}) RecalcStyle=${r3(d.metrics.recalc)}s(${r3(d.metrics.recalcCount)})`);
  if (d.events.length) {
    console.log(`  events: ` + JSON.stringify(d.events.map(([t, e]) => [Math.round(t - skipMs), e]).slice(0, 30)));
  } else {
    console.log('  events: (none)');
  }
  const buckets = new Map();
  for (const [t, x] of fr) {
    const sec = Math.max(0, Math.floor(t / 1000));
    if (!buckets.has(sec)) buckets.set(sec, { f: 0, o33: 0, o50: 0, worst: 0, loaf: 0 });
    const b = buckets.get(sec);
    b.f += 1; if (x > 33) b.o33 += 1; if (x > 50) b.o50 += 1; b.worst = Math.max(b.worst, Math.round(x));
  }
  for (const [t] of loaf) { const sec = Math.max(0, Math.floor(t / 1000)); if (buckets.has(sec)) buckets.get(sec).loaf += 1; }
  console.log('  per-second sec:frames,>33,>50,worst,loaf →');
  console.log('    ' + [...buckets.entries()].filter(([, b]) => b.f > 0).map(([k, b]) => `${k}:${b.f},${b.o33},${b.o50},${b.worst},${b.loaf}`).join('  '));
}
console.log(`\nraw JSON: ${OUT}`);
