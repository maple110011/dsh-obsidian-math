// scripts/qa/mention-insert-probe.mjs — 在**真 dsh 页面**里调真产物的落笔函数，看它到底死在哪一步。
//
// WHY THIS EXISTS。`insertMentionText` 的契约是布尔：插进去了 true，否则 false，**没有"为什么"**。
// 2026-09-21 排查"拖进去没反应"时因此卡了一轮：SSE 在进程层面实测完全正常（POST 204 → `data: "路径"`）、
// 页面也确实订阅着（39217 上有来自渲染进程的 ESTABLISHED 连接）、composer 是页面上**唯一**的
// `[contenteditable="true"]`（`composer-selector-probe.mjs` 量过）—— 但草稿始终为空，而日志里一个字节都没有。
//
// 这个探针把"死在哪一步"变成可复现的数字：把**仓库里那份构建产物**（`dsh/client-panel/lib/client.js`）
// 注入真页面，截住 `__ModuleLoader__.load` 拿到真 `module.exports`，直接调 `describeMentionInsert()`，
// 并把结果与草稿前后文一起报出来。它不依赖 Obsidian、不依赖用户操作。
//
// 用法：node scripts/qa/mention-insert-probe.mjs [--url=<带 token 的启动地址>] [--port=3403] [--debug-port=9232]
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
const PORT = Number(arg('port', '3403'));
const DEBUG_PORT = Number(arg('debug-port', '9232'));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const BIN = process.env.DSH_BIN || join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BUNDLE = join(root, 'dsh', 'client-panel', 'lib', 'client.js');

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
  if (!existsSync(BUNDLE)) { console.log('mention-insert-probe: SKIP（先跑 npm run build:client）'); process.exit(0); }
  let launchUrl = arg('url', '');
  if (launchUrl === '') {
    if (!existsSync(BIN)) { console.log(`mention-insert-probe: SKIP（找不到 dsh：${BIN}）`); process.exit(0); }
    work = mkdtempSync(join(tmpdir(), 'dsh-mention-probe-'));
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

  if (!existsSync(CHROME)) { console.log(`mention-insert-probe: SKIP（找不到 Chromium：${CHROME}）`); process.exit(0); }
  const userData = join(work === null ? mkdtempSync(join(tmpdir(), 'dsh-mention-probe-')) : work, 'browser');
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
  check('composer 渲染出来了', (await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true);

  // 截住 ModuleLoader：产物是 `window.__ModuleLoader__.load({ id, factory })`。
  // 拿到真 factory ⇒ 拿真 module.exports ⇒ 调真函数（不是重写一份实现）。
  const captured = await ev(`(() => {
    if (window.__mentionProbe !== undefined) return 'already';
    window.__mentionProbe = { mod: null };
    const orig = window.__ModuleLoader__ && window.__ModuleLoader__.load;
    if (typeof orig !== 'function') return 'no-loader';
    window.__ModuleLoader__.load = function (spec) {
      if (spec && spec.id === '@dsh-math-memory/client-ui-memory-panel') {
        const stubRequire = () => ({});
        try { window.__mentionProbe.mod = spec.factory(stubRequire); }
        catch (e) { window.__mentionProbe.error = String(e && e.message || e); }
      }
      return orig.apply(this, arguments);
    };
    return 'hooked';
  })()`);
  check('截住了 ModuleLoader（能取到真产物）', captured === 'hooked' || captured === 'already', captured);

  const injected = await ev(`(() => {
    const s = document.createElement('script');
    s.textContent = ${JSON.stringify(readFileSync(BUNDLE, 'utf8'))};
    document.head.appendChild(s);
    s.remove();
    const p = window.__mentionProbe;
    return JSON.stringify({
      hasMod: p.mod !== null && p.mod !== undefined,
      error: p.error ?? null,
      keys: p.mod === null || p.mod === undefined ? [] : Object.keys(p.mod)
    });
  })()`);
  const inj = JSON.parse(injected);
  check('真产物求值出 module.exports', inj.hasMod === true, injected);
  if (inj.hasMod !== true) throw new Error('取不到产物导出：后续结论无意义');
  check('产物导出了 describeMentionInsert（诊断入口）', inj.keys.includes('describeMentionInsert'), inj.keys.join(','));
  check('产物导出了 insertMentionText（落笔入口）', inj.keys.includes('insertMentionText'), inj.keys.join(','));

  // 草稿里先放半句话，落笔应当**插在光标处**而不是整体替换。
  const REL = '抄书/最优传输/最优传输3';
  await ev(`(() => {
    const el = document.querySelector('[contenteditable="true"]');
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, '前面的话 后面的话');
    return true;
  })()`);
  await sleep(400);
  const before = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  check('准备：草稿里打进了半句话', String(before).includes('前面的话'), JSON.stringify(before));

  const diagnostic = JSON.parse(await ev(`(() => {
    const m = window.__mentionProbe.mod;
    try { return JSON.stringify(m.describeMentionInsert(${JSON.stringify(REL)}, { document, window })); }
    catch (e) { return JSON.stringify({ threw: String(e && e.message || e) }); }
  })()`));
  console.log('  诊断:', JSON.stringify(diagnostic));
  check('落笔成功（describeMentionInsert.ok === true）', diagnostic.ok === true, JSON.stringify(diagnostic));
  check('诊断指出落笔走到了 dispatched（而不是在某个静默分支返回 false）', diagnostic.step === 'dispatched', String(diagnostic.step));

  await sleep(400);
  const after = await ev(`document.querySelector('[contenteditable="true"]').textContent`);
  console.log('  落笔后草稿:', JSON.stringify(after));
  check('草稿里真的出现了 @库内路径', String(after).includes('@' + REL), JSON.stringify(after));
  check('原有半句话没被替换掉（插在光标处）', String(after).includes('前面的话') && String(after).includes('后面的话'), JSON.stringify(after));

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
