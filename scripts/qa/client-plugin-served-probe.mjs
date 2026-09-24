// scripts/qa/client-plugin-served-probe.mjs — **宿主到底有没有把我们的客户端半个送进浏览器**。
//
// WHY。用户实测："从文件列表拖动笔记到 dsh 里，还是不会自动把路径搞进去"。前面几轮我把
// "profile 里装了客户端半个" 当成"功能可用"，但那是**推论**：装进 node_modules 与 patch 之后，
// 还要宿主真的把它**编进 boot manifest 并服务**给浏览器。这条链上任何一环断了，症状都一样：
// 拖进去没反应，而所有离线断言仍然全绿。
//
// 本探针不问"装没装"，直接问宿主：
//   ① `/plugins/<包名>/client.js` 是否可服务（404 = 宿主没认出这个客户端插件）；
//   ② 返回的内容是不是我们那份产物（含我们写进去的字符串）；
//   ③ 页面加载后 `apply()` 有没有真的跑（`window.__dshMathMemoryDropMention` 是否出现），
//      以及控制台有没有我们的报错。
//
// 用**真实 profile**（默认 notes-assistant）起一台独立端口的 dsh，不碰用户正在用的那台；
// 临时 workspace 在临时目录里，退出时清理。
//
// 用法：node scripts/qa/client-plugin-served-probe.mjs [--profile=notes-assistant] [--port=3097]
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const PROFILE = arg('profile', 'notes-assistant');
const PORT = Number(arg('port', '3097'));
const DEBUG_PORT = Number(arg('debug-port', '9226'));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const BIN = process.env.DSH_BIN || join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CLIENT_ID = '@dsh-math-memory/client-ui-memory-panel';

if (!existsSync(BIN)) { console.log(`client-plugin-probe: SKIP（找不到 dsh：${BIN}）`); process.exit(0); }

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

let child = null;
let browser = null;
let cdp = null;
let work = null;

try {
  work = mkdtempSync(join(tmpdir(), 'dsh-client-probe-'));
  const vault = join(work, 'vault');
  mkdirSync(join(vault, '.deepseek'), { recursive: true });
  writeFileSync(join(vault, '探针.md'), '# 探针\n', 'utf8');

  const logFd = openSync(join(work, 'dsh.log'), 'w');
  const errFd = openSync(join(work, 'dsh.err'), 'w');
  const patch = join(DSH_HOME, 'profiles', PROFILE, 'notes-assistant.patch.yml');
  // 参数顺序照抄 Obsidian 插件（`obsidian/main.template.js:1329-1331`）：`--patch` 属于**启动器**的
  // 旗标，必须与 `--profile` 放在一起。放到 `--port` 之后，它会被当成"启动器之后的参数"透传给
  // 应用，而应用不认识它 —— 报的是 `error: unknown option '--patch'`，看起来像"dsh 不支持 --patch"。
  const patchArgs = existsSync(patch) ? ['--patch', patch] : [];
  const args = [BIN, '--profile', PROFILE, ...patchArgs, '--no-open', '--port', String(PORT)];
  child = spawn(process.execPath, args, {
    env: { ...process.env, DSH_HOME, DSH_WORKSPACE_ROOT: vault, DSH_OBSIDIAN_VAULT: vault },
    stdio: ['ignore', logFd, errFd]
  });
  closeSync(logFd);
  closeSync(errFd);

  let launchUrl = null;
  const logPath = join(work, 'dsh.log');
  for (let i = 0; i < 120 && launchUrl === null; i += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]{8,})/.exec(readFileSync(logPath, 'utf8'));
      if (m !== null) launchUrl = m[0];
    } catch { /* not written yet */ }
  }
  check(`profile ${PROFILE} 起得来`, launchUrl !== null, launchUrl ?? `(exit=${child.exitCode})`);
  if (launchUrl === null) {
    try { const t = readFileSync(join(work, 'dsh.err'), 'utf8').trim(); if (t) console.log(t.split('\n').slice(0, 10).join('\n')); } catch { /* nothing */ }
    throw new Error('dsh 没起来');
  }

  // 兑换启动 token 拿到 cookie（与插件反代同一套）。
  const port = new URL(launchUrl).port;
  const cookie = await new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: '127.0.0.1', port, path: new URL(launchUrl).pathname + new URL(launchUrl).search, method: 'GET', headers: { host: `127.0.0.1:${port}`, connection: 'close' }, setHost: false }, (res) => {
        res.resume();
        resolve((res.headers['set-cookie'] ?? []).map((c) => String(c).split(';')[0]).join('; '));
      });
      req.on('error', () => resolve(''));
      req.end();
    });
  });
  check('拿到鉴权 cookie', cookie !== '', cookie === '' ? '(no set-cookie)' : '');

  const httpGet = (path) => new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host: `127.0.0.1:${port}`, connection: 'close', ...(cookie === '' ? {} : { cookie }) }, setHost: false }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', (e) => resolve({ status: 0, body: String(e) }));
      req.end();
    });
  });

  // ② 宿主是否服务我们的客户端包。
  //
  // ⚠️ 不能凭"包名"猜 URL。实测（同一台 profile）：按 `/plugins/<包名>/client.js` 取是 **404**，
  // 而页面里 `apply()` **确实跑过** —— 也就是说包被服务了，只是**入口 id 与包名不同**（宿主按
  // loader 行的 id 编 URL）。所以判据改成"拿页面里的真实状态说话"：先读 boot 网络，再看 apply 效果。
  // 猜 URL 会给出一个**假红**，而假红和真缺陷一样浪费时间。下面仍然保留一次探测，但只报告不判定。
  const guessed = await httpGet(`/plugins/${CLIENT_ID}/client.js`);
  console.log(`  参考：/plugins/${CLIENT_ID}/client.js → status=${guessed.status}（入口 id 与包名不一定相同）`);

  // ③ 页面里 apply() 有没有真的跑。
  //
  // 这一条**是必需的**，不是可选的：整个探针的意义就是"宿主启动时有没有把客户端半个编进 boot
  // manifest 并执行它"，而那只能从页面里看。没有浏览器就直接 SKIP 并**非零退出**，否则一个
  // 什么都没比的探针会以 0 退出，和"真的比过"长得一模一样（坑 69 的同族）。
  if (!existsSync(CHROME)) {
    console.log(`[SKIP] 浏览器验证（找不到 ${CHROME}）：无法判定 apply() 是否执行 —— 探针未完成`);
    process.exitCode = 1;
    throw new Error('没有 Chromium，无法完成判定');
  }
  {
    const userData = join(work, 'browser');
    mkdirSync(userData, { recursive: true });
    browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
    let target = null;
    for (let i = 0; i < 60 && target === null; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools:')) ?? null;
      } catch { /* not up */ }
      if (target === null) await sleep(400);
    }
    if (target === null) throw new Error('没有 page target');
    cdp = await new Promise((resolve, reject) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      const pending = new Map();
      const consoleLines = [];
      let id = 0;
      socket.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== undefined && pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
          return;
        }
        if (m.method === 'Runtime.consoleAPICalled') {
          consoleLines.push((m.params.args ?? []).map((a) => String(a.value ?? a.description ?? '')).join(' '));
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
        consoleLines,
        close: () => socket.close()
      }));
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: launchUrl });
    await sleep(2000);
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.exceptionDetails === undefined ? r.result?.value : `(threw: ${r.exceptionDetails.exception?.description ?? '?'})`;
    };
    for (let i = 0; i < 60; i += 1) {
      if ((await ev('!!document.querySelector(\'[contenteditable="true"]\')')) === true) break;
      await sleep(500);
    }
    const marker = await ev('typeof window.__dshMathMemoryDropMention');
    check('页面里 apply() 真的跑过（幂等标记已出现）', marker === 'function', `typeof = ${String(marker)}`);
    // 这一条把"装了"与"真的在页面里生效"区分开：装进 node_modules 与 patch 只是前提，
    // 宿主还得**在启动时**把它编进 boot manifest 并执行 apply()。两者之间隔着"重启服务"。
    const handlers = await ev('(() => { const h = window.__dshMathMemoryDropMention; return h && h.__handlers ? Object.keys(h.__handlers).join(",") : ""; })()');
    check('drop 处理器已挂上（dragover/dragenter/dragleave/dragend/drop）',
      String(handlers).split(',').length === 5, String(handlers));
    const ours = (cdp.consoleLines ?? []).filter((l) => l.includes('dsh-math-memory'));
    check('控制台没有我们自己的报错', ours.length === 0, ours.slice(0, 3).join(' | '));
    cdp.close();
    cdp = null;
  }
} catch (error) {
  console.log('client-plugin-served-probe: FAILED —', String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  try { cdp?.close(); } catch { /* closed */ }
  try { child?.kill(); } catch { /* gone */ }
  try { browser?.kill(); } catch { /* gone */ }
  await sleep(1500);
  if (work !== null) { try { rmSync(work, { recursive: true, force: true }); } catch { /* locked */ } }
  console.log(`\n__CHECKS__ ${passed}/${total}`);
  if (process.exitCode === undefined) process.exitCode = passed === total ? 0 : 1;
}
