// Zero-cost deterministic regression check for the memory v2 pipeline.
// This is NOT a benchmark: it never calls a model and spends no tokens.
// It builds a tiny synthetic vault in a temp directory, runs the same pure
// functions the preset uses (hook parsing, two-stage retrieval scoring, and
// the daily audit pass), and asserts their observable behavior. Real-world
// quality is tracked through passive usage signals instead (see
// docs/memory/v2-proposal.md §6).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  parseHookFrontmatter,
  tokenize,
  computeDocFreq,
  weightedOverlap,
  cacheEntryFresh,
  bm25Score,
  computeCorpusStats,
  classifyVaultDoc,
  composePassage,
  cjkCharOverlap,
  queryCoverage,
  hookPrior,
  resolveWorkspaceRoot
} from '../dsh/preset/note-tools.mjs';
import { HOOK_SCHEMA_VERSION } from '../dsh/preset/hook-frontmatter.mjs';
import {
  buildAuditReport,
  memoDigest,
  latestUserText,
  pairMessages,
  cacheIndexValid,
  buildMemorySection,
  parseCapturePolicy,
  parseMemoryConfig,
  memoryConfigText,
  buildHookHistory,
  MAX_TOTAL_MEMORY_CHARS
} from '../dsh/preset/math-memory.mjs';
import { applyFeedback } from '../dsh/host/memory-admin.mjs';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log((condition ? '[ok]' : '[FAIL]'), name, detail);
}

// ── fixture vault ───────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'dsh-memory-test-'));
const recordsDir = join(root, '.deepseek', 'memory', 'records');
const templatesDir = join(root, '.deepseek', 'memory', 'templates');
const cacheDir = join(root, '.deepseek', 'cache');
mkdirSync(recordsDir, { recursive: true });
mkdirSync(templatesDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const card = (lines) => lines.join('\n') + '\n';
writeFileSync(join(recordsDir, 'rec-a.md'), card([
  '---',
  'id: rec-a',
  'type: artifact',
  'status: active',
  'updated: 2026-01-01',
  'title: 子序列证明模式',
  'hook:',
  '  operator: probability',
  '  pattern: subsequence_argument',
  '  techniques:',
  '    - borel-cantelli',
  '    - subsequence-trick',
  '  applications: 证明 a.s. 收敛类问题',
  '  uses: 0',
  '  verified: single-source',
  '---',
  '',
  '# 子序列证明模式',
  '内容……'
]));
writeFileSync(join(recordsDir, 'rec-b.md'), card([
  '---',
  'id: rec-b',
  'type: artifact',
  'status: active',
  'updated: 2026-08-10',
  'title: 另一张子序列卡',
  'hook:',
  '  operator: probability',
  '  pattern: subsequence_argument',
  '  techniques:',
  '    - borel-cantelli',
  '  uses: 5',
  '  success_rate: 0.9',
  '  verified: user-confirmed',
  '---',
  '',
  '# 另一张子序列卡'
]));
writeFileSync(join(recordsDir, 'rec-c.md'), card([
  '---',
  'id: rec-c',
  'type: artifact',
  'status: active',
  'updated: 2026-08-11',
  'title: 又一张子序列卡',
  'hook:',
  '  operator: probability',
  '  pattern: subsequence_argument',
  '  techniques:',
  '    - borel-cantelli',
  '  uses: 3',
  '  success_rate: 0.3',
  '  verified: cross-referenced',
  '---',
  '',
  '# 又一张子序列卡'
]));
writeFileSync(join(recordsDir, 'rec-d.md'), card([
  '---',
  'id: rec-d',
  'type: fact',
  'status: active',
  'updated: 2026-01-01',
  'title: 数论小事实',
  'hook:',
  '  operator: number-theory',
  '  pattern: divisibility',
  '  uses: 0',
  '---',
  '',
  '# 数论小事实'
]));
writeFileSync(join(templatesDir, 'tpl-solution.md'), card([
  '---',
  'title: 子序列解法模板',
  'type: solution',
  'status: active',
  'updated: 2026-08-12',
  'hook:',
  '  operator: probability',
  '  pattern: subsequence_argument',
  '  techniques:',
  '    - borel-cantelli',
  '    - subsequence-trick',
  '  uses: 1',
  '  success_rate: 0.6',
  '  verified: single-source',
  '---',
  '',
  '# 子序列解法模板'
]));
writeFileSync(join(cacheDir, 'retrieval-stats.json'), JSON.stringify({
  '.deepseek/memory/records/rec-a.md': { uses: 1, last_used: '2026-08-16' },
  '__meta__': { calls: 5, empty: 1 }
}));

// ── 1. hook parsing ─────────────────────────────────────────────────────────
const fm = [
  'hook:',
  '  operator: probability',
  '  heuristics:',
  '    - decompose',
  '    - work_backwards',
  '  techniques: [borel-cantelli, subsequence-trick]',
  '  uses: 7',
  '  success_rate: 0.86'
].join('\n');
const hook = parseHookFrontmatter(fm);
check('parseHookFrontmatter: scalars', hook?.operator === 'probability' && hook?.uses === '7' && hook?.success_rate === '0.86');
check('parseHookFrontmatter: block list', Array.isArray(hook?.heuristics) && hook.heuristics.length === 2 && hook.heuristics[1] === 'work_backwards');
check('parseHookFrontmatter: flow list', Array.isArray(hook?.techniques) && hook.techniques.length === 2);
check('parseHookFrontmatter: non-hook text → null', parseHookFrontmatter('type: fact') === null);

// ── 2. tokenization ─────────────────────────────────────────────────────────
const tokens = tokenize('证明独立随机变量和 a.s. 收敛 子序列 Borel-Cantelli');
check('tokenize: ascii words', tokens.includes('borel-cantelli') && tokens.includes('a') && tokens.includes('s'));
check('tokenize: cjk bigram', tokens.includes('子序') && tokens.includes('子序列'));

// ── 3. scoring ──────────────────────────────────────────────────────────────
const query = tokenize('证明独立随机变量和 a.s. 收敛 子序列 Borel-Cantelli');
const relevantText = tokenize('子序列证明模式 subsequence_argument borel-cantelli subsequence-trick 证明 a.s. 收敛类问题 概率');
const irrelevantText = tokenize('矩阵谱半径估计 spectral_radius gelfand 分析');
const docFreq = computeDocFreq([relevantText, irrelevantText]);
const rel = weightedOverlap(query, relevantText, docFreq);
const irr = weightedOverlap(query, irrelevantText, docFreq);
check('scoring: relevant beats irrelevant', rel > irr && irr === 0, `rel=${rel.toFixed(3)} irr=${irr.toFixed(3)}`);

// ── 3b. hook prior (promote/demote) ──────────────────────────────────────
const priorHigh = hookPrior({ verified: 'user-confirmed', success_rate: '0.9', uses: '8' });
const priorLow = hookPrior({ verified: 'single-source', success_rate: '0.2', uses: '1' });
check('prior: confirmed+strong beats single+weak', priorHigh > priorLow, 'high=' + priorHigh.toFixed(3) + ' low=' + priorLow.toFixed(3));
check('prior: non-hook is neutral 0.5', hookPrior(null) === 0.5);
check('prior: fresh beats stale (recency)', hookPrior({ verified: 'user-confirmed', success_rate: '0.8', uses: '5' }, '2026-08-20') > hookPrior({ verified: 'user-confirmed', success_rate: '0.8', uses: '5' }, '2020-01-01'));

// ── 4. audit pass ───────────────────────────────────────────────────────────
const report = buildAuditReport(root, {
  parseHookFrontmatter,
  tokenize,
  maintainHookStats: true
});
check('audit: counts all 5 cards', report.counts.cards === 5, JSON.stringify(report.counts));
check('audit: strong detected', report.counts.strong >= 1);
check('audit: weak detected', report.counts.weak >= 1);
check('audit: unused detected', report.counts.unused >= 1);
check('audit: duplicate pair detected', report.counts.duplicates >= 1);
check('audit: unverified detected', report.counts.unverified >= 1);
check('audit: report bounded', report.report.length <= 1200, `len=${report.report.length}`);

check('audit: antipatterns detected (weak card)', report.counts.antipatterns >= 1);
check('audit: archive candidates detected', report.counts.archiveCandidates >= 1);
check('audit: passive recall signal read', report.passive.calls === 5 && report.passive.empty === 1 && report.passive.emptyRate === 0.2, JSON.stringify(report.passive));
check('audit: report carries heat+antipattern+passive lines', report.report.includes('检索健康') && report.report.includes('反模式') && report.report.includes('归档候选'));

// ── 5. deterministic hook-stats sync ────────────────────────────────────────
const recA = readFileSync(join(recordsDir, 'rec-a.md'), 'utf8');
check('sync: stats merged into hook.uses', /uses:\s*1/.test(recA), recA.match(/uses:\s*\d+/)?.[0] ?? 'none');
check('sync: last_used from stats', recA.includes('last_used: 2026-08-16'));
const recD = readFileSync(join(recordsDir, 'rec-d.md'), 'utf8');
check('sync: never-used card gets no invented last_used', !recD.includes('last_used'));

// ── 6. navigation-only injection (retrieval v3 S5) ──────────────────────────
writeFileSync(join(root, '.deepseek', 'memory', 'notation.md'), card([
  '---',
  'type: memory/notation',
  '---',
  '# 记号体系',
  '',
  '## 已采纳',
  '',
  '| $W_p$ | Wasserstein 距离 |'
]) + '\n');
const navSection = buildMemorySection(
  { vaultRoot: root, sessionsRoot: join(root, 'no-sessions'), maxHistoryEntries: 1, maxHistoryChars: 1, cacheTtlMs: 0 },
  'live-session', { sources: [], entries: [] }, undefined, '');
check('nav: static navigation layers present',
  navSection.includes('用户画像与稳定偏好') && navSection.includes('研究主题索引') && navSection.includes('记忆记录摘要') && navSection.includes('近期事件时间线'));
check('nav: notation system injected', navSection.includes('记号体系') && navSection.includes('Wasserstein 距离'));
check('nav: no per-request recall section', !navSection.includes('本轮记忆召回'));
check('nav: total memory section is bounded', navSection.length <= MAX_TOTAL_MEMORY_CHARS, `len=${navSection.length}`);
check('nav: adaptive-mem applicability guard injected', navSection.includes('记忆是候选') && navSection.includes('任务边界') && navSection.includes('信念扭曲'));

// ── 6b. resolveWorkspaceRoot priority (config > env > cwd) ─────────────────
check('workspace: config wins over env and cwd', resolveWorkspaceRoot('/cfg', '/env', '/cwd') === resolve('/cfg'));
check('workspace: env wins over cwd', resolveWorkspaceRoot('', '/env', '/cwd') === resolve('/env'));
check('workspace: cwd fallback', resolveWorkspaceRoot('', '', '/cwd') === resolve('/cwd'));
check('workspace: empty when nothing set', resolveWorkspaceRoot('', '', '') === '');
check('workspace: relative config rejected', resolveWorkspaceRoot('relative/path', '/env', '/cwd') === '');

// ── 6c. hook-frontmatter dual-load parity (ESM import vs embedded loader) ──
// The Obsidian plugin loads hook-frontmatter.mjs by evaluating its source after
// stripping the trailing `export {…}` — verify that path yields the identical
// parser the preset uses via ESM import.
const hfSource = readFileSync(new URL('../dsh/preset/hook-frontmatter.mjs', import.meta.url), 'utf8');
const hfBody = hfSource.replace(/export\s*\{[^}]*\};?\s*$/, '') + '\nreturn { parseHookFrontmatter, stripQuotes };';
const hfLoaded = new Function(hfBody)();
const hfFixture = 'hook:\n  techniques:\n    - borel-cantelli\n  verified: single-source\n  uses: 3';
check('hook: embedded loader matches ESM import', JSON.stringify(hfLoaded.parseHookFrontmatter(hfFixture)) === JSON.stringify(parseHookFrontmatter(hfFixture)));
check('hook: embedded loader parses scalar', hfLoaded.parseHookFrontmatter('hook:\n  operator: number-theory').operator === 'number-theory');
check('hook: schema version is a positive integer', Number.isInteger(HOOK_SCHEMA_VERSION) && HOOK_SCHEMA_VERSION > 0);

const recallHelpers = { tokenize, weightedOverlap, computeDocFreq, bm25Score, computeCorpusStats };

// ── 7. latestUserText / pairMessages (C) ───────────────────────────────────
const fakeAgent = { session: { log: [
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '答一' }] } } },
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '最终问题' }] } },
  { type: 'user/message', data: { source: { kind: 'runtime' }, content: [{ type: 'text', text: '注入快照' }] } }
] } };
check('latestUserText: last real user message', latestUserText(fakeAgent) === '最终问题');
const pairs = pairMessages([
  { role: 'user', text: 'u1', time: 1 },
  { role: 'assistant', text: '让我查一下', time: 2 },
  { role: 'assistant', text: '最终结论', time: 3 },
  { role: 'user', text: 'u2', time: 4 }
]);
check('pairMessages: final-assistant pairing', pairs.length === 2 && pairs[0].assistant?.text === '最终结论' && pairs[1].assistant === undefined);

// ── 8. memo relevance reminders (E) ────────────────────────────────────────
const inboxDir = join(root, '.deepseek', 'inbox');
mkdirSync(inboxDir, { recursive: true });
const todayIso = new Date().toISOString().slice(0, 10);
writeFileSync(join(inboxDir, 'optimal-transport.md'), [
  '---',
  'status: inbox',
  'updated: ' + todayIso,
  'title: 最优传输想法',
  '---',
  '',
  '# 最优传输想法',
  '',
  '## 想法',
  '用熵正则化处理最优传输问题，Sinkhorn 算法可以快速近似求解。'
].join('\n'));
const digest = memoDigest(root, 2200, '最优传输 Sinkhorn 熵正则', recallHelpers);
check('memo: fresh-but-relevant memo surfaces', digest.includes('最优传输想法') && digest.includes('提醒候选'));
check('memo: reminders off hides reminder candidates', !memoDigest(root, 2200, '最优传输 Sinkhorn 熵正则', recallHelpers, false).includes('提醒候选'));
// M1 regression: memoDigest must tolerate a missing helpers object (the
// buildMemorySection fallback calls it with no helpers/query).
check('memo: no-helpers fallback lists memos without crashing', (() => {
  const noHelpers = memoDigest(root, 2200);
  return noHelpers.includes('最优传输想法');
})());

// ── 9. B1: stats zeroed after merge ─────────────────────────────────────────
const statsAfter = JSON.parse(readFileSync(join(cacheDir, 'retrieval-stats.json'), 'utf8'));
check('B1: stats zeroed after merge', statsAfter['.deepseek/memory/records/rec-a.md']?.uses === 0);

// ── 10. D: cache freshness helper ───────────────────────────────────────────
check('cacheEntryFresh', cacheEntryFresh({ mtimeMs: 1, size: 2, raw: 'x' }, 1, 2) === true && cacheEntryFresh({ mtimeMs: 1, size: 2, raw: 'x' }, 1, 3) === false);

// ── 15. BM25 scorer (memory v3 S2) ─────────────────────────────────────────
const bmDocs = [
  tokenize('子序列证明模式 subsequence_argument borel-cantelli subsequence-trick 证明 a.s. 收敛类问题 概率'),
  tokenize('矩阵谱半径估计 spectral_radius gelfand 分析'),
  tokenize('子序列 subsequence subsequence subsequence subsequence subsequence')
];
const bmStats = computeCorpusStats(bmDocs);
const bmQuery = tokenize('证明独立随机变量和 a.s. 收敛 子序列 Borel-Cantelli');
check('bm25: relevant beats irrelevant', bm25Score(bmQuery, bmDocs[0], bmStats) > bm25Score(bmQuery, bmDocs[1], bmStats));
check('bm25: idf favors rare terms', (() => {
  const stats = computeCorpusStats([tokenize('rare rare'), tokenize('common common'), tokenize('common')]);
  return bm25Score(tokenize('rare'), tokenize('rare'), stats) > bm25Score(tokenize('common'), tokenize('common'), stats);
})());
check('bm25: tf saturates (10x tf < 10x score)', (() => {
  const stats = computeCorpusStats([tokenize('t'), tokenize('t t t t t t t t t t'), tokenize('x')]);
  const s2 = bm25Score(tokenize('t'), tokenize('t t'), stats);
  const s10 = bm25Score(tokenize('t'), tokenize('t t t t t t t t t t'), stats);
  return s10 > s2 && s10 < s2 * 10;
})());
check('bm25: length norm penalizes long docs at equal tf', (() => {
  const stats = computeCorpusStats([tokenize('a b c d e f'), tokenize('a b'), tokenize('q')]);
  return bm25Score(tokenize('a'), tokenize('a b'), stats) > bm25Score(tokenize('a'), tokenize('a b c d e f'), stats);
})());
check('bm25: unseen term contributes zero', bm25Score(tokenize('nope'), tokenize('a b'), bmStats) === 0);

// ── 16. unified recall corpus (memory v3 S1) ───────────────────────────────
check('classify: memory kinds',
  classifyVaultDoc('.deepseek/memory/records/rec-a.md') === 'record' &&
  classifyVaultDoc('.deepseek/memory/templates/tpl.md') === 'template' &&
  classifyVaultDoc('.deepseek/inbox/memo.md') === 'memo' &&
  classifyVaultDoc('.deepseek/memory/topics/ot.md') === 'topic' &&
  classifyVaultDoc('.deepseek/memory/theorems/index.md') === 'theorem-index' &&
  classifyVaultDoc('.deepseek/memory/episodes/index.md') === 'episode-index' &&
  classifyVaultDoc('数学/实分析.md') === 'note');
check('classify: skip scaffolding and machine files',
  classifyVaultDoc('AGENTS.md') === 'skip' &&
  classifyVaultDoc('.deepseek/cache/dialogue-index.json') === 'skip' &&
  classifyVaultDoc('.deepseek/memory/records/index.md') === 'skip' &&
  classifyVaultDoc('.deepseek/memory/records/_README.md') === 'skip' &&
  classifyVaultDoc('.deepseek/memory/episodes/2026-08-15-selftest.md') === 'skip' &&
  classifyVaultDoc('.deepseek/capture-policy.md') === 'skip');
check('passage: hook card emphasizes hook fields and strips frontmatter',
  (() => { const passage = composePassage('record', { title: '子序列卡', hook: { operator: 'probability', techniques: ['borel-cantelli'] }, body: '---\ntitle: x\n---\n正文……' });
    return passage.includes('borel-cantelli') && passage.includes('probability') && !passage.includes('title: x') && passage.includes('正文……'); })());
check('passage: note includes tags and body head',
  (() => { const passage = composePassage('note', { title: '某笔记', tags: ['analysis'], body: '这是正文' + '长'.repeat(100) });
    return passage.includes('analysis') && passage.includes('这是正文'); })());
check('passage: index kinds keep line content',
  composePassage('theorem-index', { title: 't', body: '- [[A|定理A]] · 关键词:x' }).includes('定理A'));

// ── 17. dash normalization + CJK char containment (probe-driven) ───────────
check('tokenize: unicode dashes normalize to hyphen',
  JSON.stringify(tokenize('Borel–Cantelli a.s.')).includes('borel-cantelli') && JSON.stringify(tokenize('X—Y − Z')).includes('x-y') && JSON.stringify(tokenize('x−z')).includes('x-z'));
check('cjk: containment bridges 子列/子序列', cjkCharOverlap('子序列 收敛', '子列选取三步模板 收敛性') === 0.8);
check('cjk: no overlap → 0', cjkCharOverlap('子序列', '矩阵谱半径') === 0);
check('cjk: short query returns 0 (noise guard)', cjkCharOverlap('子', '子列') === 0);

// ── 18. audit structural integrity (retrieval v3 S6) ───────────────────────
mkdirSync(join(root, '.deepseek', 'memory', 'episodes'), { recursive: true });
writeFileSync(join(root, '.deepseek', 'memory', 'episodes', '2026-08-15-selftest.md'), '# 2026-08-15 事件卡\n\n内容……\n');
const recAPath = join(recordsDir, 'rec-a.md');
writeFileSync(recAPath, readFileSync(recAPath, 'utf8').replace('\n---\n', '\nsource: \'[[2026-08-15-selftest]]\'\n---\n'), 'utf8');
const recBPath = join(recordsDir, 'rec-b.md');
writeFileSync(recBPath, readFileSync(recBPath, 'utf8').replace('\n---\n', '\nsource: \'[[nonexistent-episode]]\'\n---\n'), 'utf8');
writeFileSync(join(recordsDir, 'index.md'), '- [[rec-a|子序列证明模式]]\n');
const s6Report = buildAuditReport(root, { parseHookFrontmatter, tokenize, maintainHookStats: true });
check('s6: missing source detected', s6Report.structural?.missingSource >= 2, JSON.stringify(s6Report.structural));
check('s6: broken link detected', s6Report.structural?.brokenLinks >= 1);
check('s6: not-in-index detected', s6Report.structural?.notInIndex >= 3);
check('s6: report carries 结构校验 line', s6Report.report.includes('结构校验'));

// ── 19. query coverage weak-signal indicator (probe finding) ───────────────
check('coverage: full hit = 1', queryCoverage(tokenize('子列 收敛'), tokenize('子列选取 收敛性')) === 1);
check('coverage: partial hit', (() => { const q = tokenize('谱半径 gelfand 估计'); const d = tokenize('矩阵 估计 杂想'); const cov = queryCoverage(q, d); return cov > 0 && cov < 0.5; })());
check('coverage: no hit = 0', queryCoverage(tokenize('gelfand'), tokenize('矩阵')) === 0);

// ── 11. dialogue-index cache schema gate (pre-filter caches must rebuild) ──
check('cacheIndexValid: current version accepted', cacheIndexValid({ schemaVersion: 2, generatedAt: 1, sources: [], entries: [] }) === true);
check('cacheIndexValid: pre-filter cache (no version) rejected', cacheIndexValid({ generatedAt: 1, sources: [], entries: [] }) === false);
check('cacheIndexValid: older version rejected', cacheIndexValid({ schemaVersion: 1, generatedAt: 1, sources: [], entries: [] }) === false);
check('cacheIndexValid: malformed rejected', cacheIndexValid(null) === false && cacheIndexValid({ schemaVersion: 2 }) === false);

// ── 12. loopback link templates carry the CSRF token ───────────────────────
const prevLinkUrl = process.env.DSH_OBSIDIAN_LINK_URL;
const prevFeedbackToken = process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN;
process.env.DSH_OBSIDIAN_LINK_URL = 'http://127.0.0.1:39999';
process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN = 'test-token-42';
const linkSection = buildMemorySection(
  { vaultRoot: root, sessionsRoot: join(root, 'no-sessions'), maxHistoryEntries: 1, maxHistoryChars: 1, cacheTtlMs: 0 },
  'live-session', { sources: [], entries: [] }, undefined, '', '');
check('links: /open template carries t=', linkSection.includes('/open?path=<vault 相对路径，原样放入>&t=test-token-42)'));
check('links: /feedback confirm carries t=', linkSection.includes('action=confirm&t=test-token-42)'));
check('links: /feedback wrong carries t=', linkSection.includes('action=wrong&t=test-token-42)'));
if (prevLinkUrl === undefined) delete process.env.DSH_OBSIDIAN_LINK_URL; else process.env.DSH_OBSIDIAN_LINK_URL = prevLinkUrl;
if (prevFeedbackToken === undefined) delete process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN; else process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN = prevFeedbackToken;

// ── 13. capture policy (control surface 1c) ────────────────────────────────
check('policy: defaults when missing/empty',
  parseCapturePolicy('').idea === 'ask' && parseCapturePolicy('').fact === 'auto' && parseCapturePolicy('').preference === 'auto');
check('policy: parses valid modes',
  (() => { const pol = parseCapturePolicy('---\nidea: ask\nfact: ask\npreference: off\n---'); return pol.fact === 'ask' && pol.preference === 'off'; })());
check('policy: invalid values keep defaults',
  (() => { const pol = parseCapturePolicy('---\nidea: auto\nfact: maybe\npreference: off\n---'); return pol.idea === 'auto' && pol.fact === 'auto' && pol.preference === 'off'; })());
check('config: parses standalone settings', (() => { const c = parseMemoryConfig('---\nenabled: false\ndialogueIndex: false\n---'); return c.enabled === false && c.dialogueIndex === false; })());
check('config: missing/empty → null', parseMemoryConfig('') === null && parseMemoryConfig('no frontmatter') === null);
writeFileSync(join(root, '.deepseek', 'config.md'), '---\nenabled: false\nreminders: false\n---\n# 说明\n');
check('config: reads workspace config.md and disables', (() => { const c = parseMemoryConfig(memoryConfigText(root)); return c !== null && c.enabled === false && c.reminders === false; })());
writeFileSync(join(root, '.deepseek', 'capture-policy.md'), card([
  '---',
  'idea: ask',
  'fact: ask',
  'preference: off',
  '---',
  '# 捕获策略'
]));
const policySection = buildMemorySection(
  { vaultRoot: root, sessionsRoot: join(root, 'no-sessions'), maxHistoryEntries: 1, maxHistoryChars: 1, cacheTtlMs: 0 },
  'live-session', { sources: [], entries: [] }, undefined, '', '');
check('policy: section injected with modes',
  policySection.includes('想法 idea: ask') && policySection.includes('事实 fact（事实/事件/指令）: ask') && policySection.includes('偏好 preference: off'));
check('policy: file present → no missing-file hint', !policySection.includes('策略文件缺失'));

// ── 14. hook usage history (panel trend, handoff item 3) ───────────────────
const hookCards = [
  { rel: '.deepseek/memory/records/rec-a.md', hook: { uses: '1' }, uses: 4, successRate: 0.8 },
  { rel: '.deepseek/memory/records/rec-b.md', hook: { uses: '5' }, uses: 6, successRate: 0.9 },
  { rel: '.deepseek/memory/records/no-hook.md', hook: null, uses: 1, successRate: null }
];
const h1 = buildHookHistory({}, hookCards, '2026-08-15');
check('history: appends one point per hook card', h1.snapshots['.deepseek/memory/records/rec-a.md']?.length === 1 && h1.snapshots['.deepseek/memory/records/no-hook.md'] === undefined);
const h2 = buildHookHistory(h1, hookCards, '2026-08-16');
check('history: new day appends', h2.snapshots['.deepseek/memory/records/rec-a.md']?.length === 2);
const h3 = buildHookHistory(h2, hookCards, '2026-08-16');
check('history: same day updates in place', h3.snapshots['.deepseek/memory/records/rec-a.md']?.length === 2 && h3.snapshots['.deepseek/memory/records/rec-a.md'][1].date === '2026-08-16');
const h4 = buildHookHistory(h3, hookCards, '2026-08-17', 3);
check('history: per-card cap respected', h4.snapshots['.deepseek/memory/records/rec-a.md']?.length <= 3);

// ── 20. feedback: inapplicable must not degrade the card (MemTrapBench Trauma) ─
const fbCard = join(recordsDir, 'fb-card.md');
writeFileSync(fbCard, card([
  '---',
  'id: fb-card',
  'type: artifact',
  'status: active',
  'updated: 2026-08-01',
  'title: 反馈测试卡',
  'hook:',
  '  operator: probability',
  '  success_rate: 0.8',
  '  verified: user-confirmed',
  '---',
  '',
  '# 反馈测试卡'
]));
const fbResult = applyFeedback(fbCard, 'inapplicable');
const fbAfter = readFileSync(fbCard, 'utf8');
check('feedback: inapplicable marks context but keeps success_rate/verified',
  fbResult.ok === true && /success_rate:\s*0.8/.test(fbAfter) && /verified:\s*user-confirmed/.test(fbAfter) && fbAfter.includes('last_not_applicable'));

rmSync(root, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);