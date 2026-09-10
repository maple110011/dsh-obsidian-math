// Regression for the loopback reverse proxy that carries the dsh web UI.
//
// WHY: dsh >= 0.1.5 mints a `SameSite=Strict` session cookie named after the
// request authority. Obsidian's sidebar iframe is cross-site (app://obsidian.md
// → http://127.0.0.1:3180), so the browser neither stores nor sends that cookie
// and the panel showed dsh's "authentication required" page even after the
// plugin captured the launch token (docs/dsh-0.1.5-adaptation.md §3.7 follow-up).
//
// The proxy in the plugin's main process is immune: it redeems the token once,
// keeps the cookie and injects it into every forwarded request — which requires
// it to own the public port, with dsh moved to an internal one.
//
// The class under test is EXTRACTED FROM the shipped template (not re-typed) and
// run against a stub upstream that reproduces dsh's authority + cookie rules.
//
// It also covers 侧栏性能模式: the proxy rewrites the HTML document it serves (the
// only way to reach the cross-origin sidebar frame), which is why the stub serves
// a realistic `</head>` document, a bare one, a gzip one and header echoes.
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

const template = readFileSync('obsidian/main.template.js', 'utf8');

/** Assertions in this suite; the tail prints it so docs can be anchored. */
const EXPECTED_CHECKS = 31;

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

/** Cut a whole `class X { … }` out of the template by brace matching. */
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

/** One GET through the proxy, returning the raw response. */
function get(path, headers = {}) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port: PUBLIC_PORT, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }));
    req.end();
  });
}

const cookieNameFor = (authority) =>
  'dsh-auth-' + createHash('sha256').update(authority).digest('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

// ── stub upstream: exactly dsh's rules (authority-named cookie, 401 without) ─
const LAUNCH_TOKEN = 'stub-launch-token_ABC-123';
const SHELL = '<!doctype html><html><head><title>dsh</title></head><body><script>window.__DSH_BOOT__={}</script></body></html>';
// Shape of the real skin's hook module around the two loops the perf mode slows
// down (orca-link hooks.mjs, verbatim excerpts).
const SKIN_HOOKS = [
  'export function apply(ctx) {',
  '  const sidebarSyncDisposer = (() => {',
  '    const resizeObserver = typeof ResizeObserver === \'undefined\' ? undefined : new ResizeObserver(() => {',
  '          if (observedSidebar) syncObservedSidebar(observedSidebar)',
  '        })',
  '  })()',
  '  const scheduleTick = () => {',
  '    timeout = setTimeout(tick, statusFrameDuration(status, sequenceIndex))',
  '  }',
  '}'
].join('\n');
let upstreamPort = 0;
const upstream = createServer((req, res) => {
  const authority = req.headers.host;
  const cookie = req.headers.cookie ?? '';
  const url = new URL(req.url ?? '/', 'http://stub');
  if (url.pathname === '/' && url.searchParams.get('token') === LAUNCH_TOKEN && authority !== undefined) {
    res.writeHead(303, {
      location: '/',
      'set-cookie': `${cookieNameFor(authority)}=v1.stub.sig; Path=/; HttpOnly; SameSite=Strict`
    });
    res.end();
    return;
  }
  if (cookie.includes(`${cookieNameFor(authority ?? '')}=`)) {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(SHELL);
      return;
    }
    // A document without </head>: the injection point does not exist, and the
    // response must still arrive whole.
    if (url.pathname === '/bare') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><body>bare');
      return;
    }
    // The skin's client hook module — the file 侧栏性能模式 rewrites. It answers
    // gzip whenever the client advertises it, exactly like dsh does, so the
    // rewrite path is only reachable when the proxy strips accept-encoding.
    if (url.pathname === '/api/skin-center/v2/skins/orca-link/hooks.mjs') {
      const body = Buffer.from(SKIN_HOOKS, 'utf8');
      if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
        const gz = gzipSync(body);
        res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip', 'content-length': String(gz.length) });
        res.end(gz);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(body);
      return;
    }
    // A skin whose hook module changed shape: the anchors are gone, so the proxy
    // must serve it untouched instead of guessing.
    if (url.pathname === '/api/skin-center/v2/skins/other/hooks.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('export function apply() { /* rewritten upstream */ }\n');
      return;
    }
    // Always gzip, whatever the client advertised: the proxy must pass it through
    // instead of injecting into compressed bytes.
    if (url.pathname === '/gz') {
      const body = gzipSync(SHELL);
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': String(body.length) });
      res.end(body);
      return;
    }
    if (url.pathname === '/headers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sawAcceptEncoding: req.headers['accept-encoding'] ?? null }));
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end('/*bundle*/'.repeat(200));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sawAuthority: authority, sawCookie: true }));
    return;
  }
  res.writeHead(401, { 'content-type': 'text/plain' });
  res.end('dsh web authentication required; reopen the URL printed by dsh web.\n');
});
upstream.on('upgrade', (req, socket) => {
  const authority = req.headers.host;
  const cookie = req.headers.cookie ?? '';
  if (!cookie.includes(`${cookieNameFor(authority ?? '')}=`)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
  socket.on('data', (chunk) => socket.write(chunk));
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
upstreamPort = upstream.address().port;

// ── instantiate the template's real proxy ───────────────────────────────────
const DshWebProxy = new Function(
  'createServer', 'httpRequest', 'URL', 'sleep',
  `${classSource('DshWebProxy')}\nreturn DshWebProxy;`
)(createServer, httpRequest, URL, sleep);

const PUBLIC_PORT = 3220;
const proxy = new DshWebProxy();
proxy.upstreamPort = upstreamPort;
await proxy.listen(PUBLIC_PORT);
const at = (p) => `http://127.0.0.1:${PUBLIC_PORT}${p}`;
check('proxy listens on the configured port', proxy.port === PUBLIC_PORT && proxy.running, `port=${proxy.port}`);

// 1. before redeeming, the 401 must pass through untouched
const before = await fetch(at('/'), { redirect: 'manual' });
check('before redemption the upstream 401 passes through', before.status === 401, `status=${before.status}`);

// 2. redeem the launch token AS THE PUBLIC AUTHORITY
const redeemed = await proxy.redeem(`http://127.0.0.1:${upstreamPort}/?token=${LAUNCH_TOKEN}`);
check('redeem() succeeds against the upstream token URL', redeemed === true);
check('the stored cookie is named for the PUBLIC authority (not the upstream one)',
  proxy.cookie.startsWith(cookieNameFor(`127.0.0.1:${PUBLIC_PORT}`)),
  proxy.cookie.split('=')[0]);

// 3. the UI now arrives through the proxy
const index = await fetch(at('/'), { redirect: 'manual' });
const html = await index.text();
check('proxy serves the app shell (no 401)', index.status === 200 && html.includes('__DSH_BOOT__'), `status=${index.status}`);
const asset = await fetch(at('/assets/index-x.js'), { redirect: 'manual' });
check('proxy serves static assets', asset.status === 200 && (await asset.text()).length > 500);

// 3b. 侧栏性能模式: the injected stylesheet is what reaches the cross-origin frame
const nav = { accept: 'text/html,application/xhtml+xml' };
const injected = await get('/', nav);
const injectedText = injected.body.toString('utf8');
check('perf: the HTML document is injected before </head>',
  injectedText.includes(`<style id="${proxy.perfStyleId}">`) && injectedText.indexOf(proxy.perfStyleId) < injectedText.indexOf('</head>'),
  `status=${injected.status}`);
check('perf: the sheet neutralizes the cross-frame backdrop blur and the endless animations',
  injectedText.includes('backdrop-filter: none !important') && injectedText.includes('animation-iteration-count: 1 !important'),
  `bytes=${injected.body.length}`);
check('perf: the shell itself is unchanged around the injection',
  injectedText.includes('__DSH_BOOT__') && injectedText.startsWith('<!doctype html>') && injectedText.includes('</body></html>'));
check('perf: a navigation asks the upstream for an uncompressed body to inject into',
  (await get('/headers', { ...nav, 'accept-encoding': 'br' })).body.toString('utf8').includes('"sawAcceptEncoding":null'));
check('perf: a non-navigation keeps its accept-encoding (assets stay compressed)',
  (await get('/headers', { accept: '*/*', 'accept-encoding': 'br' })).body.toString('utf8').includes('"sawAcceptEncoding":"br"'));
const assetBody = await get('/assets/index-x.js', nav);
check('perf: non-HTML responses are never rewritten',
  !assetBody.body.toString('utf8').includes(proxy.perfStyleId) && assetBody.body.toString('utf8').startsWith('/*bundle*/'));
const bare = await get('/bare', nav);
check('perf: a document without </head> passes through whole',
  bare.body.toString('utf8') === '<!doctype html><body>bare', bare.body.toString('utf8').slice(0, 40));
const gz = await get('/gz', nav);
let gzText = '';
try {
  gzText = gunzipSync(gz.body).toString('utf8');
} catch {
  gzText = '(not gzip)';
}
check('perf: a gzip document passes through byte-identical (never injected into compressed bytes)',
  gz.headers['content-encoding'] === 'gzip' && gzText === SHELL, `encoding=${gz.headers['content-encoding']}`);
proxy.plugin = { settings: { sidebarPerformanceMode: false } };
const off = await get('/', nav);
check('perf: switching 侧栏性能模式 off leaves the document exactly as dsh served it',
  off.body.toString('utf8') === SHELL, `bytes=${off.body.length}`);
proxy.plugin = { settings: { sidebarPerformanceMode: true } };

// 3c. 侧栏性能模式 also rewrites the skin's client hook module: that JS is the
// measured cause of the sidebar stutter (the CSS effects are not), so the proxy
// slows its two per-frame/per-second loops while keeping the skin's look.
const hooks = await get('/api/skin-center/v2/skins/orca-link/hooks.mjs', { accept: '*/*' });
const hooksText = hooks.body.toString('utf8');
check('perf: the skin hook module arrives uncompressed and rewritten (debounced sidebar sync)',
  hooksText.includes('__dshSidebarSyncRo') && hooksText.includes('setTimeout(() => syncObservedSidebar(observedSidebar), 180)'),
  `bytes=${hooks.body.length} encoding=${hooks.headers['content-encoding'] ?? 'none'}`);
check('perf: the character loop is floored at 1s instead of running ~5x/s',
  hooksText.includes('Math.max(1000, statusFrameDuration(status, sequenceIndex))'));
check('perf: the module is otherwise byte-identical to what the skin shipped',
  hooksText.replace('new ResizeObserver(() => { if (observedSidebar) { clearTimeout(window.__dshSidebarSyncRo); window.__dshSidebarSyncRo = setTimeout(() => syncObservedSidebar(observedSidebar), 180) } })', 'new ResizeObserver(() => {\n          if (observedSidebar) syncObservedSidebar(observedSidebar)\n        })')
    .replace('timeout = setTimeout(tick, Math.max(1000, statusFrameDuration(status, sequenceIndex)))', 'timeout = setTimeout(tick, statusFrameDuration(status, sequenceIndex))') === SKIN_HOOKS);
const otherHooks = await get('/api/skin-center/v2/skins/other/hooks.mjs', { accept: '*/*' });
check('perf: a skin whose anchors changed is served UNTOUCHED (a stale patch never breaks the skin)',
  otherHooks.body.toString('utf8') === 'export function apply() { /* rewritten upstream */ }\n');
proxy.plugin = { settings: { sidebarPerformanceMode: false } };
const hooksOff = await get('/api/skin-center/v2/skins/orca-link/hooks.mjs', { accept: '*/*', 'accept-encoding': 'gzip' });
const hooksOffText = hooksOff.headers['content-encoding'] === 'gzip'
  ? gunzipSync(hooksOff.body).toString('utf8')
  : hooksOff.body.toString('utf8');
check('perf: with the mode off the hook module is passed through compressed and unpatched',
  hooksOff.headers['content-encoding'] === 'gzip' && hooksOffText === SKIN_HOOKS && !hooksOffText.includes('__dshSidebarSyncRo'),
  `encoding=${hooksOff.headers['content-encoding'] ?? 'none'}`);
// The stronger, opt-in tier: the sidebar loads a no-op hooks module instead of the
// skin's. Measured best (zero frames > 50 ms), at the cost of the decorations.
proxy.plugin = { settings: { sidebarPerformanceMode: true, sidebarSkinScripts: false } };
const stubbed = await get('/api/skin-center/v2/skins/orca-link/hooks.mjs', { accept: '*/*', 'accept-encoding': 'gzip' });
const stubbedText = stubbed.body.toString('utf8');
check('perf: with 侧栏加载皮肤动态装饰 off the module is replaced by a no-op that keeps the contract',
  stubbedText.includes('export default function defineSkinHooks()') && stubbedText.includes('apply() {}')
  && !stubbedText.includes('syncObservedSidebar'),
  `bytes=${stubbed.body.length}`);
check('perf: the no-op module still answers 200 with a script content-type',
  stubbed.status === 200 && /javascript/i.test(String(stubbed.headers['content-type'] ?? '')));
proxy.plugin = { settings: { sidebarPerformanceMode: true } };

// 4. the upstream must see the public authority (that is what keeps the cookie valid)
const api = await fetch(at('/api'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const payload = await api.json();
check('proxy presents the PUBLIC authority upstream', payload.sawAuthority === `127.0.0.1:${PUBLIC_PORT}`, `saw=${payload.sawAuthority}`);
check('proxy injects the session cookie upstream', payload.sawCookie === true);

// 5. websocket upgrade on the mux path
const wsOk = await new Promise((resolve) => {
  const req = httpRequest({ host: '127.0.0.1', port: PUBLIC_PORT, path: '/api/remote.mux', headers: {
    connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
    'sec-websocket-version': '13', host: `127.0.0.1:${PUBLIC_PORT}`
  } });
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; resolve(v); } };
  req.on('upgrade', (res) => { done(`upgraded ${res.statusCode}`); req.destroy(); });
  req.on('response', (res) => done(`response ${res.statusCode}`));
  req.on('error', (e) => done('error ' + e.code));
  req.end();
  setTimeout(() => done('timeout'), 5000);
});
check('proxy forwards the websocket upgrade (/api/remote.mux)', wsOk.startsWith('upgraded'), wsOk);

// 6. a non-mux upgrade must not be tunnelled
const otherUpgrade = await new Promise((resolve) => {
  const req = httpRequest({ host: '127.0.0.1', port: PUBLIC_PORT, path: '/not-mux', headers: {
    connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
    'sec-websocket-version': '13'
  } });
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; resolve(v); } };
  req.on('upgrade', () => done('upgraded'));
  req.on('response', (res) => done('response ' + res.statusCode));
  req.on('error', (e) => done('error ' + e.code));
  req.end();
  setTimeout(() => done('timeout'), 5000);
});
check('proxy refuses an unknown upgrade path', otherUpgrade !== 'upgraded', otherUpgrade);

// 7. close() must free the port and drop the cookie
await proxy.close();
check('close() releases the port and forgets the cookie', proxy.running === false && proxy.cookie === '');

// 8. wiring: the rest of the plugin must actually use the proxy
check('wiring: iframeSrc prefers the proxy', /get iframeSrc\(\) \{\s*\n\s*if \(this\.proxy\.running\) return this\.proxy\.baseUrl;/.test(template));
check('wiring: dsh is spawned with an OS-assigned internal port',
  template.includes("'--no-open', '--port', '0'"), 'expected --port 0 in the spawn args');
check('wiring: readiness is judged through the proxy, not the raw port',
  /const through = await probeServiceStatus\(this\.proxy\.port/.test(template));
check('wiring: stop() closes the proxy', /await this\.proxy\.close\(\);/.test(template));
check('wiring: the launch line is parsed for the INTERNAL port',
  /this\.internalPort = port;/.test(template));

// Tear everything down: the proxy first (it holds upstream sockets), then the
// stub. Without this the process waits on idle keep-alive sockets and the npm
// test chain stalls until the harness timeout.
await proxy.close();
upstream.closeAllConnections?.();
await new Promise((resolve) => {
  upstream.close(() => resolve());
  setTimeout(resolve, 500).unref?.();
});
console.log(`__CHECKS__ ${EXPECTED_CHECKS - failed}/${EXPECTED_CHECKS}`);
console.log(failed === 0 ? '\nproxy: OK' : `\nproxy: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
