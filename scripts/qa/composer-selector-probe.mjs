// scripts/qa/composer-selector-probe.mjs — 真页面里到底有几个 `[contenteditable="true"]`，第一个是不是输入框？
//
// WHY THIS EXISTS。落笔的实现取的是 `document.querySelector('[contenteditable="true"]')` —— 也就是
// **文档顺序里第一个**可编辑元素。在有多个可编辑元素的页面上，"第一个"未必是 composer，而这时
// `insertMentionText` 只会静默返回 `false`（它的契约是布尔，没有"插到哪儿去了"的返回值）。
// 2026-09-21 排查"拖进去没反应"时，SSE 通道在进程层面完全正常、页面也确实订阅着，唯独没有量过
// 这件事 —— 而这个探针把它变成一个可以随时重跑的数字，不再靠猜。
//
// 用法：node scripts/qa/composer-selector-probe.mjs [--url=<带 token 的启动地址>] [--debug-port=9231]
//   --url 省略时从 --port 起一台独立 dsh（照抄插件的启动参数，含 --patch）。
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
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
const PORT = Number(arg('port', '3402'));
const DEBUG_PORT = Number(arg('debug-port', '9231'));
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

try {
  let launchUrl = arg('url', '');
  if (launchUrl === '') {
    if (!existsSync(BIN)) { console.log(`composer-selector-probe: SKIP（找不到 dsh：${BIN}）`); process.exit(0); }
    work = mkdtempSync(join(tmpdir(), 'dsh-composer-probe-'));
    const vault = join(work, 'vault');
    mkdirSync(join(vault, '.deepseek'), { recursive: true });
    const logFd = openSync(join(work, 'dsh.log'), 'w');
    const errFd = openSync(join(work, 'dsh.err'), 'w');
    const patch = join(DSH_HOME, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');
    const patchArgs = existsSync(patch) ? ['--patch', patch] : [];
    child = spawn(process.execPath, [BIN, '--profile', 'notes-assistant', ...patchArgs, '--no-open', '--port', String(PORT)], {
      env: { ...process.env, DSH_HOME, DSH_WORKSPACE_ROOT: vault, DSH_OBSIDIAN_VAULT: vault },
      stdio: ['ignore', logFd, errFd]
    });
    closeSync(logFd);
    closeSync(errFd);
    const logPath = join(work, 'dsh.log');
    for (let i = 0; i < 120 && launchUrl === ''; i += 1) {
      await sleep(500);
      if (child.exitCode !== null) break;
      try {
        const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(readFileSync(logPath, 'utf8'));
        if (m !== null) launchUrl = m[0];
      } catch { /* not written yet */ }
    }
  }
  check('dsh 起来了并拿到带 token 的启动地址', launchUrl !== '', launchUrl || '(none)');
  if (launchUrl === '') throw new Error('dsh 没起来：后续结论无意义');

  if (!existsSync(CHROME)) { console.log(`composer-selector-probe: SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }
  const userData = join(work === null ? mkdtempSync(join(tmpdir(), 'dsh-composer-probe-')) : work, 'browser');
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
  await sleep(2000);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
    await sleep(500);
  }

  const survey = JSON.parse(await ev(`(() => {
    const all = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    const first = all[0] ?? null;
    const describe = (el) => el === null ? null : ({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className ?? "").slice(0, 80),
      role: el.getAttribute?.("role") ?? null,
      aria: el.getAttribute?.("aria-label") ?? null,
      lex: el.hasAttribute?.("data-lexical-editor") === true,
      placeholder: el.getAttribute?.("data-placeholder") ?? null,
      text: String(el.textContent ?? "").slice(0, 40),
      rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })()
    });
    return JSON.stringify({
      count: all.length,
      first: describe(first),
      all: all.slice(0, 6).map(describe),
      inComposer: (() => {
        // composer 的判据：在文档靠下的位置、且有一个不小的矩形（输入框在页面底部）。
        const r = first === null ? null : first.getBoundingClientRect();
        return r === null ? null : { width: Math.round(r.width), height: Math.round(r.height) };
      })(),
      hasReportMeta: document.querySelector('meta[name="dsh-math-memory-mention-report"]') !== null,
      hasStreamMeta: document.querySelector('meta[name="dsh-math-memory-mention-stream"]') !== null
    });
  })()`));

  console.log('  可编辑元素调查:', JSON.stringify(survey, null, 2));
  check('页面上至少有一个 [contenteditable="true"]', survey.count >= 1, `count=${survey.count}`);
  check('第一个 [contenteditable="true"] 就是 composer（这就是落笔取的那个）',
    survey.first !== null && survey.first.tag === 'div' && survey.first.lex === true,
    JSON.stringify(survey.first));
  check('没有多个"看起来都像输入框"的可编辑元素（取第一个会不会取错）',
    survey.count === 1 || (survey.first !== null && survey.first.lex === true),
    `count=${survey.count}`);

  console.log(`\n__CHECKS__ ${passed}/${total}`);
  process.exitCode = passed === total ? 0 : 1;
} catch (error) {
  console.log('[FAIL] 探针异常: ' + String(error?.message ?? error));
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  process.exitCode = 1;
} finally {
  try { browser?.kill(); } catch { /* ignore */ }
  try { child?.kill(); } catch { /* ignore */ }
  if (work !== null) { try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } }
}
