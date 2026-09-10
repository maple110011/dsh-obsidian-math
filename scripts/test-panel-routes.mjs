// Route-level regression for the /memory-panel/* host routes.
//
// The 2026-09-10 audit found that NOTHING in the suite ever called a route, and
// that the routes were unauthenticated with a caller-chosen confinement root —
// a web page could move a user's note. These checks boot the real handler with
// a stub webServer and drive it with synthetic requests, so the trust boundary
// itself is asserted instead of assumed.
//
// The handler is injection-based (apply(ctx) registers one prefix handler), so
// no socket is needed and nothing on this machine is touched.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply as applyPanel } from '../dsh/host/math-memory-panel.mjs';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log((condition ? '[ok]' : '[FAIL]'), name, detail);
}

// ── harness: capture the registered handler, then drive it ──────────────────
let handler = null;
const ctx = {
  workspaceRegistry: { list: () => [{ id: 'w1', path: 'D:/notes', title: 'notes' }] },
  logger: { warn: () => {} },
  effect: (fn) => { fn(); },
  webServer: { register: (route) => { handler = route.handler; } }
};
applyPanel(ctx);
check('routes: the /memory-panel prefix handler is registered', typeof handler === 'function');

/** One synthetic request; returns { status, body, json }. */
async function call({ method = 'GET', path = '/memory-panel/state', body, headers = {}, peer = '127.0.0.1' }) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    url: path,
    headers: { ...(payload === '' ? {} : { 'content-type': 'application/json' }), ...headers },
    socket: { remoteAddress: peer },
    async *[Symbol.asyncIterator]() { if (payload !== '') yield Buffer.from(payload, 'utf8'); }
  };
  let status = 0;
  let text = '';
  const res = {
    writeHead: (code) => { status = code; return res; },
    end: (chunk) => { if (chunk !== undefined) text += String(chunk); return res; }
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status, body: text, json };
}

// ── fixtures ────────────────────────────────────────────────────────────────
const vault = mkdtempSync(join(tmpdir(), 'dsh-routes-vault-'));
const other = mkdtempSync(join(tmpdir(), 'dsh-routes-other-'));
mkdirSync(join(vault, '.deepseek', 'memory', 'records'), { recursive: true });
mkdirSync(join(vault, '.deepseek', 'memory', 'topics'), { recursive: true });
mkdirSync(join(vault, '.deepseek', 'memory', 'episodes'), { recursive: true });
writeFileSync(join(vault, 'IMPORTANT-NOTE.md'), '# user note\n', 'utf8');
writeFileSync(join(vault, '.deepseek', 'memory', 'records', 'card.md'), '---\ntitle: t\n---\nbody\n', 'utf8');
writeFileSync(join(vault, '.deepseek', 'memory', 'topics', 'topic-one.md'), '---\ntitle: 主题卡\n---\nbody\n', 'utf8');
writeFileSync(join(vault, '.deepseek', 'memory', 'episodes', '2026-09-01-ep.md'), '# 事件\n', 'utf8');
writeFileSync(join(vault, '.deepseek', 'memory', 'episodes', 'index.md'), '- [[2026-09-01-ep|被索引的事件]] — 主题甲\n', 'utf8');
writeFileSync(join(other, 'NOT-MINE.md'), '# other\n', 'utf8');

const savedEnv = {
  token: process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN,
  vaultEnv: process.env.DSH_OBSIDIAN_VAULT,
  wsEnv: process.env.DSH_WORKSPACE_ROOT
};
const setEnv = (token, root) => {
  if (token === undefined) delete process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN; else process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN = token;
  if (root === undefined) delete process.env.DSH_OBSIDIAN_VAULT; else process.env.DSH_OBSIDIAN_VAULT = root;
  delete process.env.DSH_WORKSPACE_ROOT;
};

try {
  // ── 1. cross-origin POST is refused before anything else ──────────────────
  setEnv(undefined, vault);
  const xo = await call({
    method: 'POST', path: '/memory-panel/archive',
    headers: { origin: 'https://evil.example' },
    body: { root: vault, rel: 'IMPORTANT-NOTE.md' }
  });
  check('routes: a foreign Origin is refused (the drive-by CSRF vector)',
    xo.status === 403 && existsSync(join(vault, 'IMPORTANT-NOTE.md')));
  const xoNull = await call({
    method: 'POST', path: '/memory-panel/archive',
    headers: { origin: 'null' },
    body: { root: vault, rel: 'IMPORTANT-NOTE.md' }
  });
  check('routes: `Origin: null` (sandboxed iframe / file://) is refused too',
    xoNull.status === 403 && existsSync(join(vault, 'IMPORTANT-NOTE.md')));
  const okOrigin = await call({
    method: 'GET', path: '/memory-panel/state',
    headers: { origin: 'http://127.0.0.1:3080' }
  });
  check('routes: a loopback Origin is accepted', okOrigin.status === 200 && okOrigin.json?.ok === true);

  // The state payload IS the panel's contract. Two regressions it must catch:
  // (a) only records/templates were collected, so a vault whose memory lived in
  // topics/theorems/strategy rendered as empty; (b) episodes arrived as bare
  // file names + capture mtime, so the "timeline" had neither title nor date.
  const stateful = await call({ method: 'GET', path: '/memory-panel/state' });
  const st = stateful.json?.state ?? {};
  check('routes: /state delivers every card layer the panels browse',
    Object.keys(st.layers ?? {}).join(',') === 'records,templates,topics,theorems,strategy'
    && st.layers.topics.cards.length === 1
    && st.records.length === st.layers.records.cards.length
    && st.records[0].rel === st.layers.records.cards[0].rel,
    JSON.stringify({ keys: Object.keys(st.layers ?? {}), topics: st.layers?.topics?.cards?.length }));
  check('routes: /state episodes carry the index title/topic/date, not just a filename',
    st.episodes?.[0]?.title === '被索引的事件' && st.episodes?.[0]?.topic === '主题甲'
    && st.episodes?.[0]?.date === '2026-09-01',
    JSON.stringify(st.episodes?.[0]));
  check('routes: /state degrades gracefully with no audit file (audit=null, auditHuman="")',
    st.audit === null && st.auditHuman === '' && st.auditText === '');

  // The web panel renders its checkbox from `enabled === true`, so the route's
  // value IS the UI. It used to render `enabled !== false`, which showed
  // 「自动保存对话 ✓」 while the engine captured nothing — a config without the
  // key means OFF (`readSessionCaptureEnabled` returns false).
  const capture = await call({ method: 'GET', path: '/memory-panel/session-capture' });
  check('routes: session-capture reports OFF for a config without the key (the panel must not show it as ON)',
    capture.json?.ok === true && capture.json.enabled === false, JSON.stringify(capture.json));
  writeFileSync(join(vault, '.deepseek', 'config.md'), '---\nenabled: true\nsessionCapture: true\n---\n', 'utf8');
  const captureOn = await call({ method: 'GET', path: '/memory-panel/session-capture' });
  check('routes: session-capture reports ON when config.md says so',
    captureOn.json?.enabled === true, JSON.stringify(captureOn.json));
  rmSync(join(vault, '.deepseek', 'config.md'), { force: true });

  // ── 2. the caller may not CHOOSE the confinement root ────────────────────
  const foreign = await call({
    method: 'POST', path: '/memory-panel/archive',
    body: { root: other, rel: 'NOT-MINE.md' }
  });
  check('routes: a root outside the configured vault is refused',
    foreign.status === 403 && existsSync(join(other, 'NOT-MINE.md')));
  const spoof1 = await call({ method: 'POST', path: '/memory-panel/archive', body: { root: other, rel: 'NOT-MINE.md' } });
  check('routes: the foreign root stays untouched after the refusal',
    spoof1.status === 403 && existsSync(join(other, 'NOT-MINE.md')));
  const escaping = await call({
    method: 'POST', path: '/memory-panel/archive',
    body: { root: vault, rel: '../' + 'dsh-routes-other-' + other.split('dsh-routes-other-')[1] + '/NOT-MINE.md' }
  });
  check('routes: a `..` escape in rel cannot reach outside the vault',
    escaping.status >= 400 && existsSync(join(other, 'NOT-MINE.md')));

  // ── 3. non-memory targets are refused by archiveMemoryFile through the route
  const note = await call({ method: 'POST', path: '/memory-panel/archive', body: { root: vault, rel: 'IMPORTANT-NOTE.md' } });
  check('routes: archiving a plain note is refused (500 from the guard)',
    note.status === 500 && existsSync(join(vault, 'IMPORTANT-NOTE.md')));
  const dir = await call({ method: 'POST', path: '/memory-panel/archive', body: { root: vault, rel: '.deepseek/memory/records' } });
  check('routes: archiving a whole directory is refused',
    dir.status === 500 && existsSync(join(vault, '.deepseek', 'memory', 'records')));
  check('routes: a refused archive leaves no archive directory behind',
    !existsSync(join(vault, '.deepseek', 'archive')));
  const legit = await call({ method: 'POST', path: '/memory-panel/archive', body: { root: vault, rel: '.deepseek/memory/records/card.md' } });
  check('routes: a real memory card still archives',
    legit.status === 200 && !existsSync(join(vault, '.deepseek', 'memory', 'records', 'card.md')));

  // ── 4. token, when configured, is required and compared in constant time ──
  setEnv('s3cret-token', vault);
  const noToken = await call({ method: 'GET', path: '/memory-panel/state' });
  check('routes: a configured token is required (no token -> 403)', noToken.status === 403 && noToken.json?.ok === false);
  const badToken = await call({ method: 'GET', path: '/memory-panel/state', headers: { 'x-dsh-token': 'wrong' } });
  check('routes: a wrong token is refused', badToken.status === 403);
  const headerToken = await call({ method: 'GET', path: '/memory-panel/state', headers: { 'x-dsh-token': 's3cret-token' } });
  check('routes: the right token in a header is accepted', headerToken.status === 200 && headerToken.json?.ok === true);
  const queryToken = await call({ method: 'GET', path: '/memory-panel/state?t=s3cret-token' });
  check('routes: the right token in `?t=` is accepted', queryToken.status === 200);
  const foreignWithToken = await call({
    method: 'POST', path: '/memory-panel/archive', headers: { origin: 'https://evil.example' },
    body: { root: vault, rel: '.deepseek/memory/records/card.md', token: 's3cret-token' }
  });
  check('routes: a valid token does NOT re-open the cross-origin path', foreignWithToken.status === 403);
  setEnv(undefined, vault);

  // ── 5. workspaces needs no root (the panel fetches it bare) ──────────────
  const ws = await call({ method: 'GET', path: '/memory-panel/workspaces' });
  check('routes: /workspaces answers WITHOUT ?root= (dropdown can populate)',
    ws.status === 200 && Array.isArray(ws.json?.workspaces) && ws.json.workspaces[0]?.path === 'D:/notes');
  const wsForeign = await call({ method: 'GET', path: '/memory-panel/workspaces', headers: { origin: 'https://evil.example' } });
  check('routes: /workspaces is still closed to a foreign Origin', wsForeign.status === 403);

  // ── 6. field/mode validation at the capture-policy route ────────────────
  writeFileSync(join(vault, '.deepseek', 'capture-policy.md'), '---\nidea: off\n' + 'fact: off\n' + 'preference: off\n' + 'aXc: keep\n---\n', 'utf8');
  const badField = await call({ method: 'POST', path: '/memory-panel/capture-policy', body: { root: vault, field: 'a.c', mode: 'ask' } });
  check('routes: a regex-metachar field is refused (400)', badField.status === 400);
  const badField2 = await call({ method: 'POST', path: '/memory-panel/capture-policy', body: { root: vault, field: 'idea\nfact', mode: 'ask' } });
  check('routes: a newline-bearing field is refused (400)', badField2.status === 400);
  const badMode = await call({ method: 'POST', path: '/memory-panel/capture-policy', body: { root: vault, field: 'fact', mode: 'yes please' } });
  check('routes: a non-token mode is refused (400)', badMode.status === 400);
  const policyBefore = readFileSync(join(vault, '.deepseek', 'capture-policy.md'), 'utf8');
  check('routes: the refused policy writes changed nothing', policyBefore.includes('aXc: keep') && policyBefore.includes('fact: off'));
  const goodField = await call({ method: 'POST', path: '/memory-panel/capture-policy', body: { root: vault, field: 'fact', mode: 'ask' } });
  const policyAfter = readFileSync(join(vault, '.deepseek', 'capture-policy.md'), 'utf8');
  check('routes: a valid field/mode still writes',
    goodField.status === 200 && policyAfter.includes('fact: ask') && policyAfter.includes('aXc: keep'));

  // ── 7. non-loopback peers (structural, unchanged but now asserted) ───────
  const far = await call({ method: 'GET', path: '/memory-panel/state', peer: '192.168.1.50' });
  check('routes: a non-loopback peer is refused', far.status === 403 && /loopback/.test(far.body));

  // ── 8. an unknown route is a 404, not a crash ───────────────────────────
  const unknown = await call({ method: 'GET', path: '/memory-panel/nope' });
  check('routes: an unknown path answers 404', unknown.status === 404 && unknown.json?.ok === false);
} finally {
  if (savedEnv.token === undefined) delete process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN; else process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN = savedEnv.token;
  if (savedEnv.vaultEnv === undefined) delete process.env.DSH_OBSIDIAN_VAULT; else process.env.DSH_OBSIDIAN_VAULT = savedEnv.vaultEnv;
  if (savedEnv.wsEnv === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = savedEnv.wsEnv;
  rmSync(vault, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`__CHECKS__ ${results.length - failed}/${results.length}`);
console.log(`\npanel-routes: ${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
