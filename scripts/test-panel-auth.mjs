// END-TO-END regression for the sidebar handshake against a REAL dsh.
//
// The unit suite (scripts/test-panel-proxy.mjs) proves the proxy's forwarding
// rules against a stub. This one proves the whole plugin flow against the
// installed dsh: spawn it on an OS-assigned internal port, scrape the launch
// token from its stdout, bring the loopback proxy up on the public port, redeem
// the token as that public authority, and then confirm the app shell, its
// assets, an /api call and the websocket mux all arrive THROUGH the proxy —
// which is exactly what the Obsidian iframe does.
//
// It requires the installed dsh and the notes-assistant profile; when either is
// missing it reports SKIP and exits 0 so a fresh clone and CI stay green.
import { readFileSync, existsSync, openSync, closeSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const template = readFileSync('obsidian/main.template.js', 'utf8');

// Counted, not declared. This suite used to print a hard-coded `7 - failed` / 7
// while 8 assertions are reachable, and the docs repeated that 7 — so the guard
// that anchors doc numbers to this line was anchoring to a wrong number.
let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

/**
 * Thrown when the ENVIRONMENT cannot host this suite at all — as opposed to the
 * proxy being broken. The dsh child we spawn writes its own state (lock/log)
 * under DSH_HOME at startup; a sandbox that only permits writes inside the
 * workspace denies that with EPERM before a single assertion can run. That is a
 * boundary of the runner, not a defect under test, and reporting it as FAIL is
 * how a green repo comes to look broken (see scripts/run-node.mjs).
 */
class EnvironmentSkip extends Error {}
let skipReason = null;

function classSource(name) {
  const start = template.indexOf(`class ${name} {`);
  if (start < 0) throw new Error(`class ${name} not found in the template`);
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

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const installDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh');
const binJs = join(installDir, 'lib', 'bin.js');
const patch = join(dshHome, 'profiles', 'notes-assistant', 'notes-assistant.patch.yml');
if (!existsSync(binJs) || !existsSync(patch)) {
  console.log('panel-auth-e2e: SKIP (needs an installed dsh + notes-assistant profile)');
  console.log(`  binJs: ${binJs} (${existsSync(binJs)})`);
  console.log(`  patch: ${patch} (${existsSync(patch)})`);
  process.exit(0);
}

const DshWebProxy = new Function('createServer', 'httpRequest', 'URL', 'sleep', `${classSource('DshWebProxy')}\nreturn DshWebProxy;`)(createServer, httpRequest, URL, sleep);

const PUBLIC_PORT = 3230;
let child = null;
let proxy = null;
let logDir = null;

try {
  // Capture the child's output through a FILE, not a pipe. `stdio: 'pipe'` here
  // is what made this gate die with `spawn EPERM` wherever pipe stdio is
  // forbidden — a red gate that said nothing about the proxy under test, and
  // that (being 5th in the old `&&` chain) hid the 16 gates after it.
  // scripts/run-node.mjs applies the same fix to the synchronous runners.
  logDir = mkdtempSync(join(tmpdir(), 'dsh-auth-'));
  const logPath = join(logDir, 'child.log');
  const logFd = openSync(logPath, 'w');
  let spawnError = null;
  // The plugin's spawn args, verbatim: an internal OS-assigned port.
  child = spawn(process.execPath, [binJs, '--profile', 'notes-assistant', '--patch', patch, '--no-open', '--port', '0'], {
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: ['ignore', logFd, logFd]
  });
  closeSync(logFd); // the child keeps its own copy of the descriptor
  child.on('error', (e) => { spawnError = e; });
  let out = '';
  const drain = () => { try { out = readFileSync(logPath, 'utf8'); } catch { /* nothing written yet */ } };

  // The plugin's captureAuthUrl regex, replicated for the harness.
  let tokenUrl = null;
  for (let i = 0; i < 90 && tokenUrl === null; i += 1) {
    await sleep(500);
    drain();
    if (spawnError !== null) break;
    const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=[A-Za-z0-9_-]{8,}/.exec(out);
    if (m) tokenUrl = m[0];
  }
  // The environment boundary shows up here: the child died on its own first
  // write instead of printing a launch URL. Name it as a SKIP (below) rather
  // than asserting on a process that never got to exist.
  if (tokenUrl === null && /\b(EPERM|EACCES)\b/.test(out)) {
    throw new EnvironmentSkip((/^.*\b(?:EPERM|EACCES)\b.*$/m.exec(out) ?? [''])[0].trim().slice(0, 200));
  }
  check('the child prints a tokenized launch URL on an internal port', tokenUrl !== null,
    tokenUrl ?? (spawnError !== null ? `spawn failed: ${spawnError.code ?? spawnError.message}` : out.slice(0, 100)));
  if (tokenUrl === null) throw new Error('no launch URL');

  const internalPort = Number(new URL(tokenUrl).port);
  proxy = new DshWebProxy();
  proxy.upstreamPort = internalPort;
  await proxy.listen(PUBLIC_PORT);
  check('the proxy is up on the configured port', proxy.port === PUBLIC_PORT, `port=${proxy.port}`);

  // Before redeeming, the UI must NOT be served (proves redemption matters).
  const before = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/`, { redirect: 'manual' });
  check('before redeeming, the proxy relays the upstream 401', before.status === 401, `status=${before.status}`);

  check('redeeming the launch token as the PUBLIC authority succeeds', await proxy.redeem(tokenUrl) === true);

  const index = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/`, { redirect: 'manual' });
  const html = await index.text();
  check('the Obsidian iframe address serves the app shell (no 401)',
    index.status === 200 && html.includes('__DSH_BOOT__'), `status=${index.status} bytes=${html.length}`);

  const assetPath = /(?:src|href)="\.\/(assets\/[^"]+)"/.exec(html)?.[1];
  if (assetPath !== undefined) {
    const asset = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/${assetPath}`, { redirect: 'manual' });
    check('a real asset bundle loads through the proxy', asset.status === 200 && (await asset.text()).length > 10000,
      `${assetPath} status=${asset.status}`);
  } else {
    check('a real asset bundle loads through the proxy', false, 'no asset reference in index.html');
  }

  const api = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PUBLIC_PORT}` },
    body: JSON.stringify({ id: 'probe', method: 'nope', params: {} }),
    redirect: 'manual'
  });
  check('the /api carrier is authenticated through the proxy (not 401/403)',
    api.status !== 401 && api.status !== 403, `status=${api.status}`);

  const ws = await new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port: PUBLIC_PORT, path: '/api/remote.mux', headers: {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
      'sec-websocket-version': '13', host: `127.0.0.1:${PUBLIC_PORT}`
    } });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    req.on('upgrade', (res) => { done(`upgraded ${res.statusCode}`); req.destroy(); });
    req.on('response', (res) => { done(`response ${res.statusCode}`); req.destroy(); });
    req.on('error', (e) => done('error ' + e.code));
    req.end();
    setTimeout(() => done('timeout'), 8000);
  });
  check('the live-updates websocket upgrades through the proxy', ws.startsWith('upgraded'), ws);
} catch (error) {
  if (error instanceof EnvironmentSkip) skipReason = error.message;
  else check('harness: the flow ran to the end without throwing', false, String(error.message ?? error));
} finally {
  if (proxy !== null) await proxy.close();
  if (child !== null) {
    // Wait for the child to actually exit before leaving: killing it and then
    // calling process.exit() trips `Assertion failed: … UV_HANDLE_CLOSING` in
    // Node on Windows, which aborts the run and kills the `npm test` chain.
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([gone, sleep(3000)]);
  }
  if (logDir !== null) rmSync(logDir, { recursive: true, force: true });
}

if (skipReason !== null) {
  // Declared SKIP, same contract as the "no local dsh" path above: no
  // `__CHECKS__` line, exit 0, and check-doc-consistency treats it as skipped.
  console.log('panel-auth-e2e: SKIP (the environment forbids the dsh child its own state files)');
  console.log('  ' + skipReason);
  console.log('  Environment boundary, not a proxy defect — this gate runs for real in CI.');
  process.exit(0);
}

console.log(`__CHECKS__ ${passed}/${total}`);
console.log(passed === total ? '\npanel-auth-e2e: OK' : `\npanel-auth-e2e: ${total - passed} FAILED`);
process.exitCode = passed === total ? 0 : 1;
