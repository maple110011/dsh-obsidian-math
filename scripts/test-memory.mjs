// Zero-cost deterministic regression check for the memory v2 pipeline.
// This is NOT a benchmark: it never calls a model and spends no tokens.
// It builds a tiny synthetic vault in a temp directory, runs the same pure
// functions the preset uses (hook parsing, two-stage retrieval scoring, and
// the daily audit pass), and asserts their observable behavior. Real-world
// quality is tracked through passive usage signals instead (see
// docs/memory/v2-proposal.md §6).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

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
  composePassageViews,
  cjkCharOverlap,
  queryCoverage,
  hookPrior,
  recordRetrievalStats,
  strategyGuidance,
  resolveWorkspaceRoot,
  strategySurface,
  strategyMoves,
  strategyRetrieve,
  strategyAbstraction,
  isRecallEligible,
  buildRecallDoc,
  rankRecallDocuments,  rankStrategyCards,
  boundarySegments,
  boundaryHits
} from '../dsh/preset/note-tools.mjs';
import { HOOK_SCHEMA_VERSION } from '../dsh/preset/hook-frontmatter.mjs';
import {
  buildAuditReport,
  resolveBudgetTier,
  BUDGET_TIERS,
  budgetsFor,
  memoDigest,
  latestUserText,
  pairMessages,
  cacheIndexValid,
  buildMemorySection,
  parseCapturePolicy,
  parseMemoryConfig,
  memoryConfigText,
  buildHookHistory,
  MAX_TOTAL_MEMORY_CHARS,
  distillSession,
  planSessionDelta,
  renderConversationTail,
  localDateFromMs,
  runSessionCapture,
  findSessionLogs,
  sessionLogKey,
  selectAuthoritativeLogs,
  decodeZstdSessionLog,
  inconsistentWeakCards,
  indexDescriptionIssue,
  clip,
  AUDIT_SCHEMA_VERSION
} from '../dsh/preset/math-memory.mjs';
// The shared frontmatter primitives: `frontmatterBlock`/`replaceFrontmatterBlock`
// are the canonical implementations the preset now uses everywhere, and the
// "identical to the host's copy" property is asserted in
// scripts/check-frontmatter-source.mjs.
import { frontmatterBlock, replaceFrontmatterBlock, stripFrontmatter, readFrontmatter } from '../dsh/preset/hook-frontmatter.mjs';
import { applyFeedback, setSessionCapture, readSessionCaptureEnabled, countUncapturedSessions, archiveMemoryFile, setCapturePolicyMode, setMemoryBudget, frontmatterSpan, replaceFrontmatter, collectMemoryState, parseEpisodeIndex, readAuditReport, auditSchemaVersionOf, AUDIT_SCHEMA_VERSION_MIN, AUDIT_SCHEMA_VERSION_MAX, summaryOf } from '../dsh/host/memory-admin.mjs';
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

// The plugin-owned stats fields arrive as text out of a user-editable file, so
// they are untrusted input: a hand-edit must not be able to push the prior off
// the [0,1] scale that the BM25 blend assumes. Conditions are constructed here
// (not read from the vault) so the assertion stays anchored on code behaviour.
const inScale = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
check('prior: out-of-range success_rate stays in [0,1]',
  inScale(hookPrior({ verified: 'user-confirmed', success_rate: '5', uses: '3' }))
  && inScale(hookPrior({ verified: 'user-confirmed', success_rate: '-2', uses: '3' })),
  'high=' + hookPrior({ verified: 'user-confirmed', success_rate: '5', uses: '3' })
  + ' neg=' + hookPrior({ verified: 'user-confirmed', success_rate: '-2', uses: '3' }));
check('prior: a negative uses count cannot subtract from the prior',
  hookPrior({ verified: 'user-confirmed', success_rate: '0.9', uses: '-50' })
  >= hookPrior({ verified: 'user-confirmed', success_rate: '0.9', uses: '0' }),
  'neg=' + hookPrior({ verified: 'user-confirmed', success_rate: '0.9', uses: '-50' })
  + ' zero=' + hookPrior({ verified: 'user-confirmed', success_rate: '0.9', uses: '0' }));
check('prior: malformed plugin-owned values fall back to neutral, not NaN',
  inScale(hookPrior({ verified: 'user-confirmed', success_rate: 'abc', uses: '', last_used: 'not-a-date' })),
  String(hookPrior({ verified: 'user-confirmed', success_rate: 'abc', uses: '', last_used: 'not-a-date' })));

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
// Layers added AFTER the injected header was first written (theorems / templates /
// strategy) used to be missing from it, so the model was told the memory was
// "五层" with no strategy layer at all (2026-09-10 iteration audit).
check('nav: the injected header and routes cover the layers added later',
  navSection.includes('theorems') && navSection.includes('templates') && navSection.includes('strategy')
  && navSection.includes('note_strategy') && navSection.includes('memory/templates/index.md')
  && navSection.includes('五个在五层之后长出来的检索面') === false
  && navSection.includes('三个在五层之后长出来的检索面'));

// working memory (strategy layer §5): injected only when non-empty.
writeFileSync(join(root, '.deepseek', 'working.md'), '---\nupdated: 2026-08-24\n---\n\n# 工作记忆（草稿）\n\n- 下一步：查反证法\n');
const navWorking = buildMemorySection(
  { vaultRoot: root, sessionsRoot: join(root, 'no-sessions'), maxHistoryEntries: 1, maxHistoryChars: 1, cacheTtlMs: 0 },
  'live-session', { sources: [], entries: [] }, undefined, '');
check('nav: working memory injected when non-empty', navWorking.includes('工作记忆') && navWorking.includes('查反证法'));

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
check('classify: strategy kind + working.md skip',
  classifyVaultDoc('.deepseek/strategy/definition-proof.md') === 'strategy' &&
  classifyVaultDoc('.deepseek/strategy/index.md') === 'skip' &&
  classifyVaultDoc('.deepseek/strategy/_README.md') === 'skip' &&
  classifyVaultDoc('.deepseek/working.md') === 'skip');
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
check('policy: defaults when missing/empty (all ask)',
  parseCapturePolicy('').idea === 'ask' && parseCapturePolicy('').fact === 'ask' && parseCapturePolicy('').preference === 'ask');
check('policy: parses valid modes',
  (() => { const pol = parseCapturePolicy('---\nidea: ask\nfact: ask\npreference: off\n---'); return pol.fact === 'ask' && pol.preference === 'off'; })());
check('policy: invalid values keep defaults',
  (() => { const pol = parseCapturePolicy('---\nidea: auto\nfact: maybe\npreference: off\n---'); return pol.idea === 'auto' && pol.fact === 'ask' && pol.preference === 'off'; })());
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
  policySection.includes('想法 idea: ask') && policySection.includes('事实 fact（事实/事件/指令/工作产物）: ask')
  && policySection.includes('偏好 preference（画像/记号）: off')
  && policySection.includes('结构 structure（主题/定理索引/问题模板/策略卡）: auto'));
check('policy: the section names which layers each gate owns',
  policySection.includes('fact→records') && policySection.includes('structure→topics/'));
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

// ── 21. strategy layer (strategy-layer.md) ─────────────────────────────────
const stratFm = [
  'difficulty: definition-level-proof',
  'domain: [analysis, probability]',
  'problem_type: proof',
  'strategies:',
  '  - move: 等价刻画',
  '    retrieve: [similar-problem, theorem]',
  '  - move: 反证法',
  '    retrieve: [similar-problem, proven-path]',
  'abstraction:',
  '  concrete: "定义层证明 → 等价刻画"',
  '  principle: "定义难证时先找等价刻画"',
  '  generalize: "任何逐点展开繁琐的场景"',
  'verified: single-source'
].join('\n');
check('strategy: surface carries difficulty + moves + abstraction',
  (() => { const s = strategySurface(stratFm);
    return s.includes('definition-level-proof') && s.includes('等价刻画') && s.includes('反证法') && s.includes('定义难证时先找等价刻画'); })());
check('strategy: moves + retrieve + abstraction parsed',
  (() => { const m = strategyMoves(stratFm); const r = strategyRetrieve(stratFm); const a = strategyAbstraction(stratFm);
    return m.length === 2 && m[0] === '等价刻画' && r.includes('similar-problem') && r.includes('proven-path') && a.includes('定义层证明 → 等价刻画'); })());
check('strategy: composePassage uses strategy surface',
  (() => { const p = composePassage('strategy', { title: '定义层证明破局', strategy: strategySurface(stratFm), body: '# 一句话' });
    return p.includes('定义层证明破局') && p.includes('等价刻画'); })());

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

// ── 21b. boundary narrowing: a rejection must SHRINK the scope (item 8) ──────
//
// MSCE's `shrink`: a user rejection narrows the applicability boundary rather than
// only lowering a success rate. Hanging it off `inapplicable` (not `wrong`) is the
// semantic line: `wrong` means the content is bad, `inapplicable` means the content
// is fine but this context is outside its scope — which is what a boundary records.
{
  const narrowRoot = mkdtempSync(join(tmpdir(), 'dsh-shrink-'));
  const relPath = '.deepseek/memory/records/shrink-me.md';
  const abs = join(narrowRoot, ...relPath.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  mkdirSync(join(narrowRoot, '.deepseek', 'cache'), { recursive: true });
  writeFileSync(abs, [
    '---', 'title: 可收窄卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    "source: '[[ep-1]]'", 'hook:', '  operator: analysis', '  verified: single-source',
    '---', '', '# 可收窄卡', '', '正文讨论 谱半径 与 紧算子 的关系。', ''
  ].join('\n'), 'utf8');
  // A recent retrieval told us which query surfaced this card. Fragments are taken
  // from it only when they already appear in the card.
  writeFileSync(join(narrowRoot, '.deepseek', 'cache', 'retrieval-stats.json'), JSON.stringify({
    [relPath]: { uses: 1, last_used: '2026-09-10', last_query: '谱半径 与 无关词' }
  }), 'utf8');

  const beforeNarrow = readFileSync(abs, 'utf8');
  const narrowed = applyFeedback(abs, 'inapplicable', narrowRoot);
  const afterNarrow = readFileSync(abs, 'utf8');
  check('shrink: an inapplicable verdict appends the rejected context to not_applicable_when',
    afterNarrow.includes('谱半径') && /not_applicable_when:/.test(afterNarrow) && !/not_applicable_when:/.test(beforeNarrow),
    JSON.stringify(afterNarrow.split('\n').filter((l) => l.includes('not_applicable_when'))));
  check('shrink: words absent from the card are NOT invented into its boundary',
    !afterNarrow.includes('无关词'),
    JSON.stringify(afterNarrow.split('\n').filter((l) => l.includes('not_applicable_when'))));
  check('shrink: the receipt names what was added, so the user sees the scope change',
    narrowed.ok === true && String(narrowed.message ?? '').includes('收窄'),
    JSON.stringify(narrowed));

  // And the narrowed boundary must actually gate: the very query that was rejected
  // now withholds the card and says why (that is the point of narrowing at all).
  const shrinkDoc = buildRecallDoc(relPath, readFileSync(abs, 'utf8'));
  const gatedByBoundary = rankRecallDocuments([shrinkDoc], '谱半径 的问题', {});
  check('shrink: the rejected query is now WITHHELD by the boundary, with the matched phrase',
    gatedByBoundary.matches.length === 0
    && gatedByBoundary.excluded.length === 1
    && gatedByBoundary.excluded[0].boundaryHits.includes('谱半径'),
    JSON.stringify({ matches: gatedByBoundary.matches.length, excluded: gatedByBoundary.excluded }));

  // `wrong` must NOT move the boundary: it is a verdict about content, not scope.
  // Probed on a CLEAN card (no prior narrowing), because re-running it on the card
  // that `inapplicable` already narrowed proves nothing: the phrase is already in
  // the boundary, so "do not duplicate" would hide a wrongly-placed shrink. An
  // earlier version of this assertion did exactly that and survived the mutation.
  const wrongOnlyPath = '.deepseek/memory/records/shrink-wrong-only.md';
  const wrongOnlyAbs = join(narrowRoot, ...wrongOnlyPath.split('/'));
  writeFileSync(wrongOnlyAbs, [
    '---', 'title: 只判错卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    "source: '[[ep-1]]'", 'hook:', '  operator: analysis', '  verified: single-source',
    '---', '', '# 只判错卡', '', '正文也谈 谱半径。', ''
  ].join('\n'), 'utf8');
  writeFileSync(join(narrowRoot, '.deepseek', 'cache', 'retrieval-stats.json'), JSON.stringify({
    [wrongOnlyPath]: { uses: 1, last_used: '2026-09-10', last_query: '谱半径 与 无关词' }
  }), 'utf8');
  applyFeedback(wrongOnlyAbs, 'wrong', narrowRoot);
  check('shrink: a `wrong` verdict on a CLEAN card leaves the boundary untouched',
    !/not_applicable_when:/.test(readFileSync(wrongOnlyAbs, 'utf8')),
    JSON.stringify(readFileSync(wrongOnlyAbs, 'utf8').split('\n').filter((l) => l.includes('not_applicable_when'))));

  // ── the QUOTED boundary form the template actually recommends ─────────────
  // Found 2026-09-17 by probing `not_applicable_when: "…"` (templates write it with
  // quotes): the old code split the raw line, so the opening quote stayed attached to
  // the first segment and the value became `"等价刻画…时"、谱半径`. The gate matches by
  // substring, so a quoted segment almost never fires — the boundary would silently
  // stop working while looking healthy.
  {
    const quotedRoot = mkdtempSync(join(tmpdir(), 'dsh-quoted-'));
    const quotedRel = '.deepseek/memory/records/quoted.md';
    const quotedAbs = join(quotedRoot, ...quotedRel.split('/'));
    mkdirSync(join(quotedAbs, '..'), { recursive: true });
    mkdirSync(join(quotedRoot, '.deepseek', 'cache'), { recursive: true });
    writeFileSync(quotedAbs, [
      '---', 'title: 带引号边界的卡', 'type: fact', 'status: active', "source: '[[ep-1]]'",
      'hook:', '  operator: analysis', '  verified: single-source',
      '  not_applicable_when: "等价刻画不存在或更繁时"',
      '---', '', '# 带引号边界的卡', '', '正文谈 谱半径。', ''
    ].join('\n'), 'utf8');
    writeFileSync(join(quotedRoot, '.deepseek', 'cache', 'retrieval-stats.json'), JSON.stringify({
      [quotedRel]: { uses: 1, last_used: '2026-09-10', last_query: '谱半径 与 无关词' }
    }), 'utf8');
    applyFeedback(quotedAbs, 'inapplicable', quotedRoot);
    const quotedText = readFileSync(quotedAbs, 'utf8');
    const quotedValue = /^\s*not_applicable_when:\s*(.*)$/m.exec(quotedText)?.[1] ?? '';
    check('shrink: a QUOTED boundary is unwrapped, not turned into a quoted segment',
      !quotedValue.includes('"') && quotedValue.includes('等价刻画不存在或更繁时') && quotedValue.includes('谱半径'),
      JSON.stringify(quotedValue));
    const quotedDoc = buildRecallDoc(quotedRel, quotedText);
    check('shrink: both the pre-existing boundary and the added one actually gate',
      rankRecallDocuments([quotedDoc], '谱半径 的问题', {}).excluded.length === 1
      && rankRecallDocuments([quotedDoc], '等价刻画不存在 的情况', {}).excluded.length === 1,
      JSON.stringify({
        added: rankRecallDocuments([quotedDoc], '谱半径 的问题', {}).excluded.length,
        original: rankRecallDocuments([quotedDoc], '等价刻画不存在 的情况', {}).excluded.length
      }));
    rmSync(quotedRoot, { recursive: true, force: true });
  }

  // The recording side, asserted directly. Without this the write could be deleted
  // and every other assertion would still pass (it did — that is why the function
  // is exported).
  recordRetrievalStats(narrowRoot, [relPath], '谱半径 上下文查询');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const recorded = JSON.parse(readFileSync(join(narrowRoot, '.deepseek', 'cache', 'retrieval-stats.json'), 'utf8'));
  check('shrink: a retrieval records the query as last_query, so a later rejection can name the context',
    recorded[relPath]?.last_query === '谱半径 上下文查询',
    JSON.stringify(recorded[relPath]));
  rmSync(narrowRoot, { recursive: true, force: true });
}

// ── 22. self-correction (P1a/P1b/P2/P3/P4/P5) ───────────────────────────────
// P1a/P4: superseded and duplicate_of cards are evidence only, not candidates.
check('eligible: superseded card excluded', isRecallEligible('superseded', '') === false);
check('eligible: duplicate_of card excluded', isRecallEligible('active', '[[rec-b]]') === false);
check('eligible: normal card eligible', isRecallEligible('active', '') === true && isRecallEligible('', '') === true);
check('classify: archive tree skipped', classifyVaultDoc('.deepseek/archive/records/rec-x.md') === 'skip');

// P4: duplicate_of written deterministically on the redundant side (rec-c is
// the lower-uses side of the rec-b/rec-c pair detected in section 4).
const recCAfter = readFileSync(join(recordsDir, 'rec-c.md'), 'utf8');
check('audit: duplicate_of written on redundant card', recCAfter.includes('duplicate_of:') && recCAfter.includes('rec-b'));

// P1b: wrong feedback demotes harder and flags re-review.
const wrongCard = join(recordsDir, 'wrong-card.md');
writeFileSync(wrongCard, card([
  '---',
  'id: wrong-card',
  'type: fact',
  'status: active',
  'updated: 2026-08-10',
  'title: 待重审错误卡',
  'hook:',
  '  operator: probability',
  '  success_rate: 0.9',
  '  verified: user-confirmed',
  '---',
  '',
  '# 待重审错误卡'
]));
const wrongRes = applyFeedback(wrongCard, 'wrong');
const wrongAfter = readFileSync(wrongCard, 'utf8');
check('feedback: wrong caps success_rate at 0.35', wrongRes.ok === true && /success_rate:\s*0.35/.test(wrongAfter));
check('feedback: wrong downgrades verified one level', /verified:\s*cross-referenced/.test(wrongAfter) && !/verified:\s*user-confirmed/.test(wrongAfter));
check('feedback: wrong flags needs_review + last_wrong', wrongAfter.includes('needs_review: true') && wrongAfter.includes('last_wrong:'));

// P2: pending-re-review list in the audit.
const p2Report = buildAuditReport(root, { parseHookFrontmatter, tokenize, maintainHookStats: false });
check('audit: pending review lists needs_review card', (p2Report.pendingReview ?? []).includes('.deepseek/memory/records/wrong-card.md'));
check('audit: report carries 待重审 line', p2Report.report.includes('待重审'));
// confirm resolves a prior ❌ (clears the re-review flag).
const confirmRes = applyFeedback(wrongCard, 'confirm');
const confirmAfter = readFileSync(wrongCard, 'utf8');
check('feedback: confirm clears needs_review', confirmRes.ok === true && /needs_review:\s*false/.test(confirmAfter));

// P5: strategy cards read top-level uses/success_rate and get promoted. `source` is
// present because promotion now also requires traceable evidence (grounding gate):
// a candidate that met the usage bar but has no provenance stays a candidate.
mkdirSync(join(root, '.deepseek', 'strategy'), { recursive: true });
writeFileSync(join(root, '.deepseek', 'strategy', 'strat-x.md'), card([
  '---',
  'type: strategy',
  'status: candidate',
  'difficulty: definition-level-proof',
  'domain: [analysis]',
  'provenance: agent',
  'source: \'[[2026-08-01-episode-proof]]\'',
  'verified: single-source',
  'uses: 5',
  'success_rate: 0.8',
  'updated: 2026-08-10',
  '---',
  '',
  '# 定义层证明破局'
]));
buildAuditReport(root, { parseHookFrontmatter, tokenize, maintainHookStats: false });
const stratXAfter = readFileSync(join(root, '.deepseek', 'strategy', 'strat-x.md'), 'utf8');
check('strategy: candidate promoted to active at uses>=3 + rate>=0.6', /^status:\s*active/m.test(stratXAfter));

// P3: auto-archive moves the strict safe subset (off unless autoArchive:true).
const archCard = join(recordsDir, 'arch-card.md');
writeFileSync(archCard, card([
  '---',
  'id: arch-card',
  'type: fact',
  'status: active',
  'updated: 2026-01-01',
  'title: 应归档卡',
  'hook:',
  '  operator: number-theory',
  '  uses: 0',
  '---',
  '',
  '# 应归档卡'
]));
const p3Report = buildAuditReport(root, { parseHookFrontmatter, tokenize, maintainHookStats: false, autoArchive: true });
check('auto-archive: target detected in report', (p3Report.autoArchiveTargets ?? []).some((t) => t.rel.includes('arch-card.md')));
check('auto-archive: card moved out of records/', !existsSync(archCard) && existsSync(join(root, '.deepseek', 'archive', 'records', 'arch-card.md')));

// ── 23. dialogue capture (obelisk-comparison.md) ────────────────────────────
// Pure helpers first.
const fakeEvents = [
  { type: 'session', id: 's1', cwd: root, createdAt: 1787600000000 },
  { type: 'user/message', seq: 1, time: 1000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Q1' }] } },
  { type: 'assistant/message', seq: 2, time: 2000, data: { message: { content: [{ type: 'reasoning', text: '思考' }, { type: 'text', text: 'A1' }] } } },
  { type: 'user/message', seq: 3, time: 3000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Q2' }] } },
  { type: 'assistant/message', seq: 4, time: 4000, data: { message: { content: [{ type: 'text', text: 'A2' }] } } }
];
const capEntry = distillSession(fakeEvents, { userClip: 4000, assistantClip: 4000 });
check('capture: distill keeps full conversation, drops reasoning, carries seq',
  capEntry.messages.length === 4 && !capEntry.messages.map((m) => m.text).join('|').includes('思考') && capEntry.messages.every((m) => Number.isFinite(m.seq)) && capEntry.createdAt === 1787600000000);
check('capture: planSessionDelta returns only seq > lastSeq', (() => {
  const p = planSessionDelta(capEntry, { lastSeq: 2 });
  return p !== null && p.delta.length === 2 && p.delta[0].seq === 3 && p.lastSeq === 4;
})());
check('capture: planSessionDelta null when nothing new', planSessionDelta(capEntry, { lastSeq: 4 }) === null);
check('capture: renderConversationTail keeps the tail', (() => {
  const t = renderConversationTail([{ role: 'user', text: '早' }, { role: 'assistant', text: '中' }, { role: 'user', text: '晚' }], 10);
  return t !== null && t.includes('晚') && t.includes('中') && !t.includes('早');
})());
check('capture: localDateFromMs formats local date', /^\d{4}-\d{2}-\d{2}$/.test(localDateFromMs(1787600000000)));

// End-to-end: real zstd session logs → episode files + marker.
// Artifacts live in their own `<session-id>` directory, matching the harness
// layout (and the V2/V3 pairing rule the selection logic in §25 relies on).
const sessionsDir = join(root, 'sessions');
mkdirSync(join(sessionsDir, 's1'), { recursive: true });
mkdirSync(join(sessionsDir, 's2'), { recursive: true });
const mkLog = (id, cwd, events) => zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'));
const captureBase = (id) => ({ type: 'session', id, cwd: root, createdAt: Date.now() - 86400000 });
writeFileSync(join(sessionsDir, 's1', 'session.jsonl.zstd'), mkLog('session-cap-1', root, [
  captureBase('session-cap-1'),
  { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '如何从依测度收敛到 a.s.' }] } },
  { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'reasoning', text: '内部思考' }, { type: 'text', text: '用子列论证' }] } } }
]));
writeFileSync(join(sessionsDir, 's2', 'session.jsonl.zstd'), mkLog('session-cap-2', join(root, '..'), [
  { type: 'session', id: 'session-cap-2', cwd: join(root, '..'), createdAt: Date.now() },
  { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '不该进来的会话' }] } }
]));

const capResult = runSessionCapture(root, sessionsDir);
const capState = JSON.parse(readFileSync(join(root, '.deepseek', 'cache', 'captured-sessions.json'), 'utf8'));
const epDir = join(root, '.deepseek', 'memory', 'episodes');
const epFiles = readdirSync(epDir).filter((f) => f.includes('session-cap-1'));
check('capture: in-vault session persisted to its own episode file', epFiles.length === 1);
check('capture: full conversation stored, reasoning excluded', (() => {
  const t = epFiles.length === 1 ? readFileSync(join(epDir, epFiles[0]), 'utf8') : '';
  return t.includes('依测度收敛') && t.includes('子列论证') && !t.includes('内部思考');
})());
check('capture: marker records lastSeq', capState.sessions?.['session-cap-1']?.lastSeq === 2);
check('capture: outside-vault session skipped', !('session-cap-2' in (capState.sessions ?? {})) && !capResult.captured.some((c) => c.id === 'session-cap-2'));

// Resume: same session grows → only the delta is appended.
writeFileSync(join(sessionsDir, 's1', 'session.jsonl.zstd'), mkLog('session-cap-1', root, [
  captureBase('session-cap-1'),
  { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '如何从依测度收敛到 a.s.' }] } },
  { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '用子列论证' }] } } },
  { type: 'user/message', seq: 3, time: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再问：反例呢？' }] } },
  { type: 'assistant/message', seq: 4, time: 4, data: { message: { content: [{ type: 'text', text: '反例见测度收敛不蕴含 a.s.' }] } } }
]));
const capResult2 = runSessionCapture(root, sessionsDir);
const capState2 = JSON.parse(readFileSync(join(root, '.deepseek', 'cache', 'captured-sessions.json'), 'utf8'));
const epText2 = readFileSync(join(epDir, epFiles[0]), 'utf8');
check('capture: resume appends only the delta', capState2.sessions?.['session-cap-1']?.lastSeq === 4 && capResult2.captured.length === 1);
check('capture: resume adds new turn without duplicating old', epText2.includes('反例见测度收敛') && epText2.split('用子列论证').length === 2);

// ── 23b. session-capture scan cache (the fix for the frozen-panel bug) ──────
// The capture pass and the panel badge used to fully zstd-decode EVERY session
// log before consulting the marker that would have skipped it, on Obsidian's
// renderer main thread: on a real 389-log / 367 MB store that froze the whole
// UI for ~48 s on every panel open. The scan now (a) reads only a log's 64 KiB
// header frame to decide whether it belongs to this vault, and (b) memoises the
// verdict per file revision, so an unchanged log is never read again.
const scanKey1 = join(sessionsDir, 's1', 'session.jsonl.zstd');
const scanKey2 = join(sessionsDir, 's2', 'session.jsonl.zstd');
const scanStat1 = statSync(scanKey1);
check('capture-scan: cache records a verdict for every scanned session',
  Object.keys(capState2.scanned ?? {}).length === 2);
check('capture-scan: foreign-workspace log cached as irrelevant (never decoded again)',
  capState2.scanned?.[scanKey2]?.inVault === false && capState2.scanned?.[scanKey2]?.pending === false);
check('capture-scan: captured log cached as settled',
  capState2.scanned?.[scanKey1]?.inVault === true && capState2.scanned?.[scanKey1]?.pending === false);
check('capture-scan: cache is keyed by the exact file revision',
  capState2.scanned?.[scanKey1]?.fp === `${scanKey1}|${scanStat1.mtimeMs}|${scanStat1.size}`);
check('capture-scan: unchanged store stays settled', countUncapturedSessions(root, sessionsDir) === 0);

// A grown log must invalidate its own record and re-enter the pending state.
writeFileSync(scanKey1, mkLog('session-cap-1', root, [
  captureBase('session-cap-1'),
  { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '如何从依测度收敛到 a.s.' }] } },
  { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '用子列论证' }] } } },
  { type: 'user/message', seq: 3, time: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再问：反例呢？' }] } },
  { type: 'assistant/message', seq: 4, time: 4, data: { message: { content: [{ type: 'text', text: '反例见测度收敛不蕴含 a.s.' }] } } },
  { type: 'user/message', seq: 5, time: 5, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第三轮追问' }] } },
  { type: 'assistant/message', seq: 6, time: 6, data: { message: { content: [{ type: 'text', text: '第三轮回答' }] } } }
]));
check('capture-scan: a grown log re-enters the pending state',
  countUncapturedSessions(root, sessionsDir) === 1);
check('capture-scan: growth is captured as a delta',
  runSessionCapture(root, sessionsDir).captured.length === 1
  && readFileSync(join(epDir, epFiles[0]), 'utf8').includes('第三轮回答'));

// A log whose FIRST frame exceeds the 64 KiB head cannot be judged from its
// header. It must fall back to a full decode, not be cached as "irrelevant" —
// a wrong cached verdict would hide that session from capture forever.
mkdirSync(join(sessionsDir, 's3'), { recursive: true });
writeFileSync(join(sessionsDir, 's3', 'session.jsonl.zstd'), zstdCompressSync(Buffer.from([
  JSON.stringify({
    type: 'session', id: 'session-cap-big', cwd: root, createdAt: Date.now() - 3600000,
    // High-entropy padding: defeats compression, so the first frame really is
    // larger than the header window.
    pad: Array.from({ length: 70000 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 94))).join('')
  }),
  JSON.stringify({ type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '大帧提问' }] } }),
  JSON.stringify({ type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '大帧回答' }] } } })
].join('\n') + '\n', 'utf8')));
const bigCapture = runSessionCapture(root, sessionsDir);
const bigState = JSON.parse(readFileSync(join(root, '.deepseek', 'cache', 'captured-sessions.json'), 'utf8'));
check('capture-scan: oversized first frame is still captured, not skipped',
  bigCapture.captured.some((c) => c.id === 'session-cap-big')
  && bigState.scanned?.[join(sessionsDir, 's3', 'session.jsonl.zstd')]?.inVault === true);

// ── 24. session-capture toggle (UI round-trip through config.md) ────────────
check('capture-toggle: defaults off when field absent', readSessionCaptureEnabled(root) === false);
setSessionCapture(root, false);
check('capture-toggle: writes false', readSessionCaptureEnabled(root) === false && readFileSync(join(root, '.deepseek', 'config.md'), 'utf8').includes('sessionCapture: false'));
setSessionCapture(root, true);
check('capture-toggle: writes true back', readSessionCaptureEnabled(root) === true);

// ── 25. dsh 0.1.5 session data format V3 (docs/dsh-0.1.5-adaptation.md) ──────
// The V3 migration writes `session.v3.jsonl.zstd` NEXT TO the V2 original it
// reaps, and keeps the original — so one session owns two artifacts whose names
// both end in `.jsonl.zstd`. Everything that walks the store must therefore
// count SESSIONS, not files, or a single conversation enters the dialogue index
// and the capture marker twice. The pure selection helpers are asserted first,
// then the real capture pass.
check('v3: sessionLogKey keys on the session directory, not the artifact name',
  sessionLogKey('C:\\s\\sessions\\proj-a\\session-abc\\session.v3.jsonl.zstd') === 'session-abc'
  && sessionLogKey('/home/u/.dsh/sessions/proj-a/session-abc/session.jsonl.zstd') === 'session-abc'
  // The V2 and V3 artifacts of one session must agree — that is the whole point.
  && sessionLogKey('C:\\s\\sessions\\proj-a\\session-abc\\session.v3.jsonl.zstd')
     === sessionLogKey('C:\\s\\sessions\\proj-a\\session-abc\\session.jsonl.zstd'));

check('v3: a V2/V3 pair collapses to the newest artifact (the migrated V3 file)', (() => {
  const kept = selectAuthoritativeLogs([
    { path: join(sessionsDir, 'p', 'session-abc', 'session.v3.jsonl.zstd'), mtimeMs: 200 },
    { path: join(sessionsDir, 'p', 'session-abc', 'session.jsonl.zstd'), mtimeMs: 100 }
  ]);
  return kept.length === 1 && kept[0].path.endsWith('session.v3.jsonl.zstd');
})());
check('v3: distinct sessions both survive the collapse', (() => {
  const kept = selectAuthoritativeLogs([
    { path: join(sessionsDir, 'p', 'session-a', 'session.v3.jsonl.zstd'), mtimeMs: 200 },
    { path: join(sessionsDir, 'p', 'session-b', 'session.jsonl.zstd'), mtimeMs: 100 }
  ]);
  return kept.length === 2;
})());

// Real store: the migrated V3 file is authoritative and only ONE artifact per
// session is ever returned, both under a loose and a tight `maxFiles`.
const v3Root = join(root, 'sessions-v3');
mkdirSync(join(v3Root, 'v3proj', 'session-v3-1'), { recursive: true });
const v2Path = join(v3Root, 'v3proj', 'session-v3-1', 'session.jsonl.zstd');
const v3Path = join(v3Root, 'v3proj', 'session-v3-1', 'session.v3.jsonl.zstd');
writeFileSync(v2Path, zstdCompressSync(Buffer.from([
  JSON.stringify({ type: 'session', version: 2, id: 'session-v3-1', cwd: root, createdAt: Date.now() - 7200000 }),
  JSON.stringify({ type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'V2 原件里的旧提问' }] } }),
  JSON.stringify({ type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: 'V2 旧回答' }] } } })
].join('\n') + '\n', 'utf8')));
writeFileSync(v3Path, zstdCompressSync(Buffer.from([
  JSON.stringify({ type: 'session', version: 3, id: 'session-v3-1', cwd: root, createdAt: Date.now() - 7200000, isSeeded: false, delegationDepth: 0, agentPreset: 'notes-assistant' }),
  // V3-only surface: the system prompt became a message, and per-token chunk
  // events are gone (they live in assistant/message.data.stream[]).
  JSON.stringify({ type: 'system/message', seq: 1, time: 1, data: { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, content: [] }, surfaceOp: 'append' }),
  JSON.stringify({ type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'V2 原件里的旧提问' }] }, surfaceOp: 'append' }),
  JSON.stringify({ type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'reasoning', text: '内部思考' }, { type: 'text', text: 'V2 旧回答' }] }, stream: [] }, surfaceOp: 'append' }),
  JSON.stringify({ type: 'user/message', seq: 4, time: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'V3 迁移后的新提问' }] }, surfaceOp: 'append' }),
  JSON.stringify({ type: 'assistant/message', seq: 5, time: 5, data: { message: { content: [{ type: 'text', text: 'V3 新回答' }] }, stream: [] }, surfaceOp: 'append' })
].join('\n') + '\n', 'utf8')));

const v3Logs = findSessionLogs(v3Root, 20);
check('v3: one session pair yields exactly one log', v3Logs.length === 1);
check('v3: the migrated V3 file is the one selected', v3Logs[0]?.path === v3Path);
check('v3: maxFiles counts sessions, not files', findSessionLogs(v3Root, 1).length === 1);

// The V2 original is decoded only when its V3 successor is gone. Deleting the
// successor is the sharpest proof that the pair really collapsed to one entry
// instead of the V2 file merely being skipped for another reason.
const v3Decoded = decodeZstdSessionLog(readFileSync(v3Path));
check('v3: V3 log decodes across frames (header + appended frames)',
  v3Decoded.length >= 6 && v3Decoded[0]?.version === 3);
const v3Entry = distillSession(v3Decoded, { userClip: 4000, assistantClip: 4000 });
check('v3: distill reads V3 events (title/source/reasoning rules unchanged)',
  v3Entry.id === 'session-v3-1' && v3Entry.cwd === root
  && v3Entry.messages.length === 4
  && v3Entry.messages[1].text === 'V2 旧回答'
  && !v3Entry.messages.map((m) => m.text).join('|').includes('内部思考'));

const v3Captured = runSessionCapture(root, v3Root);
check('v3: capture takes the migrated artifact as authoritative',
  v3Captured.captured.some((c) => c.id === 'session-v3-1')
  && v3Captured.captured.find((c) => c.id === 'session-v3-1')?.lastSeq === 5);
check('v3: the migrated conversation lands in episode order (old turn, then new)', (() => {
  const files = readdirSync(epDir).filter((f) => f.includes('session-v3-1'));
  if (files.length !== 1) return false;
  const t = readFileSync(join(epDir, files[0]), 'utf8');
  return t.includes('V2 旧回答') && t.includes('V3 迁移后的新提问') && t.includes('V3 新回答')
    && !t.includes('内部思考')
    && t.indexOf('V2 旧回答') < t.indexOf('V3 新回答');
})());
check('v3: the session pair is scanned once, so nothing stays pending',
  countUncapturedSessions(root, v3Root) === 0);

rmSync(v3Path, { force: true });
check('v3: with the successor gone the V2 original is read again',
  findSessionLogs(v3Root, 20)[0]?.path === v2Path
  && runSessionCapture(root, v3Root).captured.some((c) => c.id === 'session-v3-1'));

// ── 26. frontmatter writers: offsets, not replacement strings ───────────────
// The 2026-09-10 audit found two silent-corruption modes in the writers that
// back the panel's ✅/❌ buttons (docs/project-assessment-2026-09-10.md §2 P0):
//   (a) `text.replace(spanText, newText)` treats newText as a REPLACEMENT
//       STRING, so `$$`/`$&`/`$'`/`` $` `` in AGENT-AUTHORED frontmatter are
//       expanded — a math vault is exactly where `$$` appears in a title;
//   (b) an EMPTY frontmatter body makes the search string "", and
//       `replace("", x)` inserts at offset 0, pushing the closing `---` into the
//       middle of the file while the caller is told the write succeeded.
// Both are asserted here against a matrix of degenerate shapes.
const fmRoot = join(root, 'fm-writers');
mkdirSync(join(fmRoot, '.deepseek', 'memory', 'records'), { recursive: true });
const cardPath = (name) => join(fmRoot, '.deepseek', 'memory', 'records', name);
const CARD_TEMPLATE = (fm) => `---\n${fm}---\nbody line\n`;
const HOOK_SECTION = 'title: t\nhook:\n  verified: single-source\n';

for (const dollar of ['$$', '$&', "$'", '$`']) {
  const rel = `dollar-${dollar.replace(/[^a-z$&'`]/gi, '_')}.md`;
  const abs = cardPath(rel);
  const original = CARD_TEMPLATE(`title: 关于 ${dollar} 的表示\n${HOOK_SECTION}`);
  writeFileSync(abs, original, 'utf8');
  const res = applyFeedback(abs, 'confirm');
  const after = readFileSync(abs, 'utf8');
  check(`writers: frontmatter containing ${JSON.stringify(dollar)} survives a ✅ (no $-expansion)`,
    res.ok === true
    && after.includes(`title: 关于 ${dollar} 的表示`)
    && after.includes('verified: user-confirmed')
    && after.split('\n').filter((l) => l === '---').length === 2
    && after.trimEnd().endsWith('body line'));
}

// Empty frontmatter body: still a valid file, and the write lands INSIDE the
// block instead of before it.
{
  const abs = cardPath('empty-fm.md');
  writeFileSync(abs, '---\n\n---\nbody\n', 'utf8');
  const res = applyFeedback(abs, 'inapplicable');
  const after = readFileSync(abs, 'utf8');
  const lines = after.split('\n');
  check('writers: an EMPTY frontmatter block stays well-formed after a write',
    res.ok === true
    && lines[0] === '---'
    && lines[1].startsWith('last_not_applicable: ')
    && lines[2] === '---'
    && lines.slice(3).join('\n').includes('body'));
}
{
  // capture-policy.md goes through the same helper (setCapturePolicyMode also
  // refreshes `updated`, so assert the block shape rather than one exact line).
  const policyDir = join(fmRoot, 'policy-empty');
  mkdirSync(join(policyDir, '.deepseek'), { recursive: true });
  writeFileSync(join(policyDir, '.deepseek', 'capture-policy.md'), '---\n\n---\n# 捕获策略\n', 'utf8');
  setCapturePolicyMode(policyDir, 'fact', 'ask', '');
  const after = readFileSync(join(policyDir, '.deepseek', 'capture-policy.md'), 'utf8');
  const block = after.split('\n').slice(0, after.split('\n').indexOf('---', 1) + 1).join('\n');
  check('writers: empty-frontmatter capture-policy stays well-formed',
    after.startsWith('---\n')
    && block.includes('fact: ask')
    && block.includes('updated: ')
    && after.split('\n').filter((l) => l === '---').length === 2
    && after.includes('# 捕获策略'));
}

// CRLF and a frontmatter-free file: the span helper must not be fooled by
// either, and a file without frontmatter is refused rather than mangled.
{
  const abs = cardPath('crlf.md');
  writeFileSync(abs, '---\r\ntitle: t\r\nhook:\r\n  verified: single-source\r\n---\r\nbody\r\n', 'utf8');
  const res = applyFeedback(abs, 'confirm');
  const after = readFileSync(abs, 'utf8');
  check('writers: CRLF frontmatter keeps CRLF and only changes the target keys',
    res.ok === true && after.includes('\r\n') && after.includes('verified: user-confirmed') && !after.includes('\n\n'));
}
check('writers: a file with no frontmatter is refused, not rewritten', (() => {
  const abs = cardPath('no-fm.md');
  writeFileSync(abs, 'plain note\n', 'utf8');
  const res = applyFeedback(abs, 'confirm');
  return res.ok === false && readFileSync(abs, 'utf8') === 'plain note\n';
})());
check('writers: replaceFrontmatter returns null without frontmatter',
  replaceFrontmatter('plain\n', 'x') === null && frontmatterSpan('plain\n') === null);
check('writers: frontmatterSpan covers exactly the block body', (() => {
  const raw = '---\na: 1\n---\nbody\n';
  const span = frontmatterSpan(raw);
  return span !== null && span.text === 'a: 1' && raw.slice(span.start, span.end) === 'a: 1';
})());

// ── 27. archiveMemoryFile validates its source ─────────────────────────────
// It used to move whatever it was handed: a plain note, a whole directory, even
// the vault root. The route is loopback-reachable, so this is the last gate.
const archRoot = join(root, 'archive-guard');
mkdirSync(join(archRoot, '.deepseek', 'memory', 'records'), { recursive: true });
mkdirSync(join(archRoot, '.deepseek', 'archive'), { recursive: true });
writeFileSync(join(archRoot, 'IMPORTANT-NOTE.md'), '# user note\n', 'utf8');
writeFileSync(join(archRoot, '.deepseek', 'capture-policy.md'), '---\nfact: ask\n---\n', 'utf8');
writeFileSync(join(archRoot, '.deepseek', 'memory', 'records', 'card.md'), '---\n---\n', 'utf8');
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
check('archive: a note outside the memory tree is refused',
  throws(() => archiveMemoryFile(archRoot, ['IMPORTANT-NOTE.md']))
  && existsSync(join(archRoot, 'IMPORTANT-NOTE.md')));
check('archive: a directory is refused',
  throws(() => archiveMemoryFile(archRoot, ['.deepseek', 'memory', 'records']))
  && existsSync(join(archRoot, '.deepseek', 'memory', 'records')));
check('archive: the vault root (".") is refused', throws(() => archiveMemoryFile(archRoot, ['.'])));
check('archive: config/capture-policy.md is refused (not a card)',
  throws(() => archiveMemoryFile(archRoot, ['.deepseek', 'capture-policy.md'])));
check('archive: a non-markdown target is refused',
  throws(() => archiveMemoryFile(archRoot, ['.deepseek', 'memory', 'records', 'x.txt'])));
check('archive: ".." segments are refused',
  throws(() => archiveMemoryFile(archRoot, ['.deepseek', 'memory', '..', '..', 'IMPORTANT-NOTE.md'])));
check('archive: a real memory card is still archived',
  archiveMemoryFile(archRoot, ['.deepseek', 'memory', 'records', 'card.md']).replace(/\\/g, '/')
    .endsWith('.deepseek/archive/records/card.md')
  && !existsSync(join(archRoot, '.deepseek', 'memory', 'records', 'card.md')));

// ── 28. the PRESET's own frontmatter writers (same $-expansion class) ───────
// dsh/preset/math-memory.mjs writes cards too: the daily audit syncs hook usage
// stats, marks duplicates and promotes strategy cards, and all four sites used
// `text.replace(fmMatch[1], rewritten)` — the same replacement-string hazard
// fixed in memory-admin.mjs. The audit scans records/ templates/ strategy/, so
// the fixture needs a real card in records/ (index.md is scaffold, skipped) and
// an ISOLATED vault: nesting it under the shared test root makes the audit walk
// that root's cards as well.
{
  const presetRoot = mkdtempSync(join(tmpdir(), 'dsh-preset-writers-'));
  for (const dir of ['.deepseek/memory/records', '.deepseek/memory/templates', '.deepseek/strategy', '.deepseek/memory/episodes']) {
    mkdirSync(join(presetRoot, dir), { recursive: true });
  }
  writeFileSync(join(presetRoot, '.deepseek', 'memory', 'profile.md'), '---\ntitle: p\n---\n', 'utf8');
  for (const scaffold of ['.deepseek/memory/records/index.md', '.deepseek/memory/templates/index.md', '.deepseek/memory/episodes/index.md']) {
    writeFileSync(join(presetRoot, scaffold), '# 索引\n', 'utf8');
  }

  const cardAbs = join(presetRoot, '.deepseek', 'memory', 'records', 'dollar-card.md');
  const original = [
    '---',
    'title: 关于 $$ 的表示 与 $& 的含义',
    'type: fact',
    'status: active',
    'verified: single-source',
    'updated: 2026-01-01',
    'source: 讨论',
    'hook:',
    '  operator: probability',
    '  pattern: exchangeable_sequence',
    // `uses: 0` makes the sync rewrite the block, which is what exercises the
    // offset splice (with a non-zero value the rewrite can be a no-op).
    '  uses: 0',
    '---',
    'body',
    ''
  ].join('\n');
  writeFileSync(cardAbs, original, 'utf8');

  const report = buildAuditReport(presetRoot, { parseHookFrontmatter, tokenize, maintainHookStats: true });
  const after = readFileSync(cardAbs, 'utf8');
  check('preset writers: the audit actually saw the card',
    report?.counts?.cards === 1, `cards=${report?.counts?.cards}`);
  check('preset writers: a $$/$& title survives the audit stats sync',
    after.includes('title: 关于 $$ 的表示 与 $& 的含义'));
  check('preset writers: the file keeps exactly one frontmatter block',
    after.split('\n').filter((l) => l === '---').length === 2 && after.trimEnd().endsWith('body'));

  // The pathological case, asserted directly: the OLD formulation
  // (`text.replace(matched, rewritten)`) expands `$`-patterns inside the
  // rewritten frontmatter, the new one splices by offset. Compare both so the
  // property is explicit rather than incidental.
  const pathological = [
    '---',
    'title: 关于 $$ 的表示 与 $& 的含义',
    'hook:',
    '  uses: 0',
    '---',
    'body',
    ''
  ].join('\n');
  // The block now comes from the shared `frontmatterBlock` helper rather than a
  // literal regex: since 2026-09-11 that literal may not appear anywhere outside
  // the canonical implementation (scripts/check-frontmatter-source.mjs).
  const matched = frontmatterBlock(pathological);
  const rewrittenBlock = matched.replace('uses: 0', 'uses: 3');
  const oldWay = pathological.replace(matched, rewrittenBlock);
  const newWay = replaceFrontmatterBlock(pathological, rewrittenBlock);
  // oldWay becomes `title: 关于 $ 的表示 与 <the matched block> 的含义` with
  // `uses: 0` restored and `uses: 3` appended: `$$` lost a `$`, `$&` injected
  // the block, and the file GROWS. Those three are the corruption.
  // The corruption is observable as a broken TITLE LINE plus a block leak:
  //   oldWay[1] === 'title: 关于 $ 的表示 与 ---'   (the `$&` expansion inserted
  //   the matched block, so the original title text now sits on a new line and
  //   the block appears twice). `$$` still occurs somewhere inside that leaked
  //   copy, so it is NOT a usable signal — assert the leak instead.
  check('preset writers: the old replace() form really did corrupt `$$`/`$&` (control)',
    oldWay !== pathological
    && oldWay.split('\n')[1] === 'title: 关于 $ 的表示 与 ---'
    && oldWay.split('---').length > pathological.split('---').length,
    `bytes ${pathological.length} -> ${oldWay.length}; title ${JSON.stringify(oldWay.split('\n')[1])}`);
  check('preset writers: the offset splice preserves the title AND lands the change',
    newWay.includes('title: 关于 $$ 的表示 与 $& 的含义') && newWay.includes('uses: 3')
    && newWay.split('\n').filter((l) => l === '---').length === 2,
    JSON.stringify(newWay.split('\n').slice(0, 4)));
  rmSync(presetRoot, { recursive: true, force: true });
}

// ── 29. delegated child sessions are skipped by default ────────────────────
// A subagent session replays its parent's prefix, so capturing it stores the
// same conversation again under a second id. V3 headers mark it (`origin`,
// `delegationDepth`), which is what makes the decision possible at all; a V2
// header carries neither and stays indistinguishable (kept).
{
  const subRoot = mkdtempSync(join(tmpdir(), 'dsh-subagent-'));
  const sessions = join(subRoot, 'sessions');
  const parentDir = join(sessions, 'proj', 'session-parent-1');
  const childDir = join(sessions, 'proj', 'session-child-1');
  mkdirSync(parentDir, { recursive: true });
  mkdirSync(childDir, { recursive: true });
  const log = (events) => zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'));
  const turns = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '父会话提问' }] } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '父会话回答' }] } } }
  ];
  writeFileSync(join(parentDir, 'session.v3.jsonl.zstd'), log([
    { type: 'session', version: 3, id: 'session-parent-1', cwd: subRoot, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 },
    { type: 'session/title', seq: 1, time: 1, data: { title: '父会话' } },
    ...turns
  ]));
  writeFileSync(join(childDir, 'session.v3.jsonl.zstd'), log([
    { type: 'session', version: 3, id: 'session-child-1', cwd: subRoot, createdAt: Date.now(), isSeeded: true, origin: 'subagent', delegationDepth: 1, parentSession: 'session-parent-1' },
    { type: 'session/title', seq: 1, time: 1, data: { title: '子代理' } },
    ...turns
  ]));

  const entryParent = distillSession(decodeZstdSessionLog(readFileSync(join(parentDir, 'session.v3.jsonl.zstd'))));
  const entryChild = distillSession(decodeZstdSessionLog(readFileSync(join(childDir, 'session.v3.jsonl.zstd'))));
  check('subagent: a V3 header marks a delegated child',
    entryChild.isSubagent === true && entryChild.origin === 'subagent' && entryParent.isSubagent === false);

  const firstPass = runSessionCapture(subRoot, sessions);
  check('subagent: the parent is captured and the child is not',
    firstPass.captured.some((c) => c.id === 'session-parent-1')
    && !firstPass.captured.some((c) => c.id === 'session-child-1'),
    JSON.stringify(firstPass.captured.map((c) => c.id)));

  const episodes = readdirSync(join(subRoot, '.deepseek', 'memory', 'episodes')).filter((f) => f.endsWith('.md'));
  check('subagent: no episode file is written for the child',
    episodes.some((f) => f.includes('session-parent-1')) && !episodes.some((f) => f.includes('session-child-1')),
    episodes.join(','));

  // Opt-in path: captureSubagents: true stores it after all.
  const optedIn = runSessionCapture(subRoot, sessions, undefined, { captureSubagents: true });
  check('subagent: `captureSubagents: true` opts the child back in',
    optedIn.captured.some((c) => c.id === 'session-child-1'),
    JSON.stringify(optedIn.captured.map((c) => c.id)));

  // Host-side badge must use the SAME rule, or it reports work capture never does.
  check('subagent: countUncapturedSessions ignores the child too',
    countUncapturedSessions(subRoot, sessions) === 0);
  rmSync(subRoot, { recursive: true, force: true });
}

// ── 29b. capture failures are REPORTED, not swallowed ──────────────────────
// Every write on the capture path used to fail silently, so a vault whose
// episode writes kept failing looked exactly like a vault with nothing to
// capture (`captured: []` either way). Trap 44 names "treating a write as done
// because no error surfaced" as this repo's most recurrent defect shape
// (2026-09-11 review, P2-7). These checks drive REAL write failures.
{
  const warnRoot = mkdtempSync(join(tmpdir(), 'dsh-capture-warn-'));
  const sessions = join(warnRoot, 'sessions');
  const logDir = join(sessions, 'proj', 'session-warn-1');
  mkdirSync(logDir, { recursive: true });
  const log = (events) => zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'));
  writeFileSync(join(logDir, 'session.v3.jsonl.zstd'), log([
    { type: 'session', version: 3, id: 'session-warn-1', cwd: warnRoot, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 },
    { type: 'session/title', seq: 1, time: 1, data: { title: '会写失败的会话' } },
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '提问' }] } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '回答' }] } } }
  ]));

  // (a) A clean vault must produce NO warnings — otherwise the signal is noise.
  const clean = runSessionCapture(warnRoot, sessions);
  check('capture warnings: a successful capture reports none',
    clean.warnings.length === 0 && clean.captured.length === 1,
    JSON.stringify({ warnings: clean.warnings, captured: clean.captured.length }));

  // (b) Index row unwritable (index.md replaced by a directory): the episode body
  // IS written, so the session must still count as captured — aborting would
  // re-append the same delta on the next pass and duplicate its content.
  const episodeRel = join('.deepseek', 'memory', 'episodes');
  const episodeStem = clean.captured[0].rel.split(/[\\/]/).pop().replace(/\.md$/, '');
  const indexPath = join(warnRoot, episodeRel, 'index.md');
  rmSync(indexPath, { force: true });
  rmSync(join(sessions, 'proj', 'session-warn-1', 'session.v3.jsonl.zstd'), { force: true });
  mkdirSync(indexPath, { recursive: true });
  const logDir2 = join(sessions, 'proj', 'session-warn-2');
  mkdirSync(logDir2, { recursive: true });
  writeFileSync(join(logDir2, 'session.v3.jsonl.zstd'), log([
    { type: 'session', version: 3, id: 'session-warn-2', cwd: warnRoot, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 },
    { type: 'session/title', seq: 1, time: 1, data: { title: '索引写不进去' } },
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '提问' }] } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '回答' }] } } }
  ]));
  const indexFail = runSessionCapture(warnRoot, sessions);
  check('capture warnings: an unconfirmable index line is reported, and the session still counts',
    indexFail.warnings.some((w) => w.includes('index.md'))
    && indexFail.captured.some((c) => c.id === 'session-warn-2')
    && existsSync(join(warnRoot, episodeRel, `${indexFail.captured.find((c) => c.id === 'session-warn-2').rel.split(/[\\/]/).pop()}`)),
    JSON.stringify({ warnings: indexFail.warnings }));
  rmSync(indexPath, { recursive: true, force: true });

  // (c) Marker unwritable (`.deepseek/cache` replaced by a file): the episodes are
  // on disk but capture cannot record that it happened, so the next pass would
  // re-append them. That must be a warning, not silence.
  const cacheDir = join(warnRoot, '.deepseek', 'cache');
  rmSync(cacheDir, { recursive: true, force: true });
  writeFileSync(cacheDir, 'not a directory\n', 'utf8');
  const logDir3 = join(sessions, 'proj', 'session-warn-3');
  mkdirSync(logDir3, { recursive: true });
  writeFileSync(join(logDir3, 'session.v3.jsonl.zstd'), log([
    { type: 'session', version: 3, id: 'session-warn-3', cwd: warnRoot, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 },
    { type: 'session/title', seq: 1, time: 1, data: { title: 'marker 写不进去' } },
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '提问' }] } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '回答' }] } } }
  ]));
  const markerFail = runSessionCapture(warnRoot, sessions);
  check('capture warnings: an unconfirmable marker is reported (duplicate-risk, not silence)',
    markerFail.warnings.some((w) => w.includes('marker')) && markerFail.captured.some((c) => c.id === 'session-warn-3'),
    JSON.stringify({ warnings: markerFail.warnings }));
  rmSync(warnRoot, { recursive: true, force: true });
}

// ── 30. panel data layer: what the memory panels actually render ────────────
// The panels showed a different subset of this JSON each, and neither showed
// the layers the docs promise (topics/theorems/strategy) or the human title of
// an episode. These checks pin the data layer the two panels share.
{
  const panelRoot = mkdtempSync(join(tmpdir(), 'dsh-panel-state-'));
  const write = (rel, text) => {
    const abs = join(panelRoot, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };
  write('.deepseek/memory/records/index.md', '# 索引\n');
  write('.deepseek/memory/records/rec-one.md', [
    '---', 'title: 记录一', 'type: fact', 'status: active', 'updated: 2026-09-01', 'topic: 概率论',
    'hook:', '  operator: probability', '  verified: single-source', '  uses: 2', '---', '',
    '# 记录一', '', '第一行正文就是它的说明。', ''
  ].join('\n'));
  write('.deepseek/memory/topics/opt.md', [
    '---', 'title: 最优传输', 'type: topic', 'updated: 2026-08-30', '---', '', '# 最优传输', '',
    '- 标签：#最优传输 #概率论', '- 状态：活跃', '',
    '## 概述', '', '抄书笔记系列，主线是存在性与结构定理。', ''
  ].join('\n'));
  write('.deepseek/strategy/strat-one.md', '---\ntitle: 结构证明策略\ntype: strategy\nstatus: candidate\nupdated: 2026-08-29\n---\n\n# 结构证明策略\n');
  write('.deepseek/capture-policy.md', '---\nidea: ask\nfact: ask\npreference: ask\n---\n\n# 捕获策略\n');
  write('.deepseek/memory/episodes/2026-09-07-definetti.md', '# 事件\n');
  write('.deepseek/memory/episodes/2026-09-07-other.md', '# 事件\n');
  write('.deepseek/memory/episodes/index.md', [
    '# 事件时间索引', '',
    '- [[2026-09-07-definetti|De Finetti 表示定理：可交换 ⇔ 条件 IID]] — 可交换性、概率论',
    '- [[2026-09-07-other]]'
  ].join('\n'));
  write('.deepseek/inbox/memo-one.md', '---\ntitle: 一个想法\nstatus: inbox\ntopic: 方法论\nupdated: 2026-09-02\n---\n\n# 一个想法\n');
  write('.deepseek/memory/profile.md', '# 画像\n');
  write('.deepseek/cache/memory-audit.json', JSON.stringify({
    schemaVersion: 2, generatedAt: Date.now(), today: '2026-09-09',
    counts: { cards: 1 }, decisions: { total: 0 },
    sections: { pendingReview: [], archiveCandidates: [] },
    human: '记忆体检 2026-09-09 · 1 张卡', report: '记忆体检（2026-09-09，共 1 张卡）'
  }));

  const indexed = parseEpisodeIndex([
    '- [[2026-09-07-definetti|De Finetti 表示定理]] — 可交换性、概率论',
    '* [[2026-09-07-other]]',
    '- [[archive/2026-01-01-old|旧事件]] — 归档主题'
  ].join('\n'));
  check('panel: episodes/index.md parsing keeps title and topic',
    indexed.get('2026-09-07-definetti')?.title === 'De Finetti 表示定理'
    && indexed.get('2026-09-07-definetti')?.topic === '可交换性、概率论',
    JSON.stringify([...indexed.entries()]));
  check('panel: an index line without a title/topic does not fabricate them',
    indexed.get('2026-09-07-other')?.title === '' && indexed.get('2026-09-07-other')?.topic === '');
  check('panel: archived episodes are keyed by stem, not by `archive/…`',
    indexed.get('2026-01-01-old')?.title === '旧事件');

  const state = collectMemoryState(panelRoot, '', parseHookFrontmatter);
  check('panel: every card layer is collected (records/templates/topics/theorems/strategy)',
    Object.keys(state.layers).join(',') === 'records,templates,topics,theorems,strategy',
    Object.keys(state.layers).join(','));
  check('panel: a topics-layer card is reachable (the old collector returned 2 layers only)',
    state.layers.topics.cards.length === 1 && state.layers.strategy.cards.length === 1
    && state.layers.topics.cards[0].title === '最优传输'
    && state.layers.topics.cards[0].layer === 'topics');
  check('panel: back-compat `records`/`templates` still point at the same arrays',
    state.records.length === 1 && state.records === state.layers.records.cards);
  check('panel: topic is exported for the card row', state.records[0].topic === '概率论');
  check('panel: every card carries a one-line summary (titles alone say too little)',
    state.records[0].summary === '第一行正文就是它的说明。'
    && state.layers.topics.cards[0].summary === '抄书笔记系列，主线是存在性与结构定理。',
    JSON.stringify({ record: state.records[0].summary, topic: state.layers.topics.cards[0].summary }));
  check('panel: bookkeeping lines (标签/状态) are never used as a card summary',
    !state.layers.topics.cards[0].summary.includes('标签') && !state.layers.topics.cards[0].summary.includes('状态'));
  check('panel: a frontmatter `summary:` wins over the body',
    summaryOf('---\nsummary: 一句话说明\n---\n\n# 标题\n\n正文第一行\n', { summary: '一句话说明' }, null) === '一句话说明');
  check('panel: a body-less card yields an empty summary instead of a stray field',
    summaryOf('---\ntitle: x\n---\n\n# x\n', { title: 'x' }, null) === '');
  check('panel: a frontmatter-shaped line left in the body is skipped',
    summaryOf('---\ntitle: x\n---\n\nuses: 0\n\n真正的说明\n', { title: 'x' }, null) === '真正的说明');
  check('panel: the capture policy exposes one gate per layer, with `structure` defaulting to auto',
    state.capturePolicy.structure === 'auto' && state.capturePolicy.idea === 'ask'
    && parseCapturePolicy('---\nidea: auto\nstructure: ask\n---\n')?.structure === 'ask',
    JSON.stringify(state.capturePolicy));

  const definetti = state.episodes.find((e) => e.stem === '2026-09-07-definetti');
  check('panel: an episode carries its human title, topic and date',
    definetti?.title === 'De Finetti 表示定理：可交换 ⇔ 条件 IID'
    && definetti?.topic === '可交换性、概率论'
    && definetti?.date === '2026-09-07',
    JSON.stringify(definetti));
  check('panel: an unindexed episode falls back to its stem, never an empty title',
    state.episodes.find((e) => e.stem === '2026-09-07-other')?.title === '2026-09-07-other');
  check('panel: the search filter reaches episodes by title (case-insensitively)',
    collectMemoryState(panelRoot, 'finetti 表示', parseHookFrontmatter).episodes.length === 1
    && collectMemoryState(panelRoot, 'Finetti 表示', parseHookFrontmatter).episodes.length === 1
    && collectMemoryState(panelRoot, '不存在的词', parseHookFrontmatter).episodes.length === 0);

  check('panel: the structured audit object reaches the client',
    state.audit?.today === '2026-09-09' && state.auditHuman.includes('记忆体检')
    && state.auditText.includes('记忆体检'),
    JSON.stringify({ audit: state.audit?.today, human: state.auditHuman }));
  check('panel: auditText stays the MODEL checklist, auditHuman the human one',
    state.auditText === state.audit.report && state.auditText !== state.auditHuman);
  // A pre-split (schema v1) audit file has only `report`. The panel must not
  // claim there is no report at all, must not dump the model checklist, and
  // must say the text is the old format.
  write('.deepseek/cache/memory-audit.json', JSON.stringify({
    generatedAt: Date.parse('2026-09-09T10:00:00'),
    counts: { cards: 3, strong: 1, weak: 0, unused: 2, pendingReview: 0, archiveCandidates: 2 },
    pendingReview: [],
    archiveCandidates: [{ rel: '.deepseek/memory/records/a.md', title: '低效用卡', utility: 0.33 }],
    passive: { calls: 3, empty: 2, emptyRate: 0.67 },
    report: '- 低效用归档候选: [[.deepseek/memory/records/a|低效用卡]](0.33)——向用户建议处置，不自行删除。'
  }));
  const legacy = collectMemoryState(panelRoot, '', parseHookFrontmatter);
  check('panel: a v1 audit file is summarized instead of dumped (never "no report")',
    legacy.auditHuman.includes('旧版报告') && legacy.auditHuman.includes('3 张卡')
    && legacy.auditHuman.includes('低效用卡') && legacy.auditHuman.includes('检索 3 次')
    && !legacy.auditHuman.includes('[[.deepseek/') && !legacy.auditHuman.includes('0.33'),
    JSON.stringify(legacy.auditHuman));
  check('panel: the v1 summary still routes the user to the archive button',
    legacy.auditHuman.includes('归档'));
  check('panel: a v1 audit cache still feeds the ⚠️ 待处理 block (sections + decisions synthesized)',
    legacy.audit.sections.archiveCandidates.length === 1
    && legacy.audit.sections.archiveCandidates[0].title === '低效用卡'
    && legacy.audit.sections.pendingReview.length === 0
    && legacy.audit.decisions.total === 1
    && legacy.audit.today === '2026-09-09',
    JSON.stringify({ sections: legacy.audit.sections, today: legacy.audit.today }));
  check('panel: a missing audit file yields audit=null instead of throwing',
    collectMemoryState(join(panelRoot, 'nope'), '', parseHookFrontmatter).audit === null);
  check('panel: readAuditReport returns the parsed object (readAuditText keeps the string)',
    readAuditReport(join(panelRoot, '.deepseek', 'cache', 'memory-audit.json'))?.counts?.cards === 3
    && readAuditReport(join(panelRoot, 'missing.json')) === null);

  // The audit schema version used to be written and never read, so the constant
  // guarded nothing (2026-09-11 review, P2-5). These pin the read-side gate.
  const auditSchemaDir = mkdtempSync(join(tmpdir(), 'dsh-audit-schema-'));
  const writeAudit = (name, obj) => {
    const p = join(auditSchemaDir, name);
    writeFileSync(p, JSON.stringify(obj), 'utf8');
    return p;
  };
  check('audit schema: a report with no schemaVersion is read as v1',
    auditSchemaVersionOf({}) === 1 && readAuditReport(writeAudit('v1.json', { report: 'x' }))?.report === 'x');
  check('audit schema: the declared range matches the WRITER constant',
    AUDIT_SCHEMA_VERSION_MIN === 1 && AUDIT_SCHEMA_VERSION_MAX === AUDIT_SCHEMA_VERSION,
    JSON.stringify({ min: AUDIT_SCHEMA_VERSION_MIN, max: AUDIT_SCHEMA_VERSION_MAX, writer: AUDIT_SCHEMA_VERSION }));
  check('audit schema: a current-version report is accepted',
    readAuditReport(writeAudit('v2.json', { schemaVersion: AUDIT_SCHEMA_VERSION, human: 'ok' }))?.human === 'ok');
  check('audit schema: a NEWER report is refused instead of half-parsed (trap 38 in reverse)',
    readAuditReport(writeAudit('v99.json', { schemaVersion: 99, human: 'from the future' })) === null);
  check('audit schema: a malformed version falls back to v1 rather than crashing',
    auditSchemaVersionOf({ schemaVersion: 'two' }) === 1 && auditSchemaVersionOf(null) === 1);
  rmSync(auditSchemaDir, { recursive: true, force: true });

  // Feedback on a card with NO hook block: the panels used to hide the buttons,
  // so the least-evidenced cards were the only ones that could never be fixed.
  const bare = write('.deepseek/memory/records/bare.md', '---\ntitle: 无 hook 卡\ntype: fact\n---\n\n# 无 hook 卡\n');
  const confirmed = applyFeedback(bare, 'confirm');
  const afterConfirm = readFileSync(bare, 'utf8');
  check('panel: ✅ on a hookless card appends a hook block instead of failing',
    confirmed.ok === true && /hook:\n(\s+.*\n)*\s+verified: user-confirmed/.test(afterConfirm)
    && afterConfirm.includes('success_rate: 0.9')
    && afterConfirm.split('\n').filter((l) => l === '---').length === 2,
    JSON.stringify(afterConfirm.split('\n').slice(0, 8)));
  check('panel: the ✅ receipt names the consequence, not an internal field',
    confirmed.message.includes('用户确认') && !confirmed.message.includes('success_rate'));

  const bare2 = write('.deepseek/memory/records/bare2.md', '---\ntitle: 无 hook 卡 2\ntype: fact\n---\n\n# 无 hook 卡 2\n');
  const wronged = applyFeedback(bare2, 'wrong');
  const afterWrong = readFileSync(bare2, 'utf8');
  check('panel: ❌ on an UNRATED card does not invent a success_rate',
    wronged.ok === true && !afterWrong.includes('success_rate')
    && afterWrong.includes('needs_review: true') && afterWrong.includes('verified: single-source')
    && wronged.message.includes('重审'),
    JSON.stringify(afterWrong.split('\n').slice(0, 8)));
  const rated = write('.deepseek/memory/records/rated.md', '---\ntitle: 有评级卡\nhook:\n  verified: user-confirmed\n  success_rate: 0.9\n---\n\n# 有评级卡\n');
  applyFeedback(rated, 'wrong');
  const afterRated = readFileSync(rated, 'utf8');
  check('panel: ❌ on a RATED card halves it under the weak threshold and demotes one step',
    afterRated.includes('success_rate: 0.35') && afterRated.includes('verified: cross-referenced'),
    JSON.stringify(afterRated.split('\n').slice(0, 8)));
  check('panel: an unknown feedback action is refused, not silently ignored',
    applyFeedback(rated, 'nonsense').ok === false);

  rmSync(panelRoot, { recursive: true, force: true });
}

// ── 31. the audit never recommends archiving what it just archived ──────────
{
  const archRoot = mkdtempSync(join(tmpdir(), 'dsh-audit-archive-'));
  const dir = join(archRoot, '.deepseek', 'memory', 'records');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), '# 索引\n');
  // Zero uses + very old + not user-confirmed ⇒ an auto-archive target AND a
  // low-utility archive candidate at the same time.
  writeFileSync(join(dir, 'stale-card.md'), [
    '---', 'title: 陈旧卡', 'type: fact', 'status: active', 'updated: 2020-01-01',
    'hook:', '  operator: analysis', '  verified: single-source', '  uses: 0', '---', '', '# 陈旧卡', ''
  ].join('\n'));
  writeFileSync(join(dir, 'kept-card.md'), [
    '---', 'title: 保留卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  verified: user-confirmed', '  uses: 4', '  success_rate: 0.9', '---', '', '# 保留卡', ''
  ].join('\n'));
  const moved = buildAuditReport(archRoot, { parseHookFrontmatter, tokenize, maintainHookStats: true, autoArchive: true });
  check('audit: auto-archive really moved the stale card',
    moved.counts.autoArchived === 1 && moved.archived.includes('.deepseek/memory/records/stale-card.md'),
    JSON.stringify(moved.archived));
  check('audit: an archived card is no longer listed as an archive candidate',
    !moved.sections.archiveCandidates.some((c) => c.rel.includes('stale-card'))
    && !moved.archiveCandidates.some((c) => c.rel.includes('stale-card')),
    JSON.stringify(moved.archiveCandidates));
  check('audit: an archived card is no longer counted as a live card',
    moved.counts.cards === 1 && !moved.sections.strong.some((c) => c.rel.includes('stale-card')));
  check('audit: decisions never point at a card that is already gone',
    moved.decisions.total === moved.sections.pendingReview.length + moved.sections.archiveCandidates.length + moved.sections.duplicates.length);
  check('audit: the human summary and the model checklist are both present and different',
    moved.human.includes('记忆体检') && moved.checklist.includes('记忆体检') && moved.human !== moved.checklist);
  check('audit: schemaVersion is declared (a reader can detect the split)',
    moved.schemaVersion === 2 && moved.decisions !== undefined && moved.thresholds !== undefined);
  rmSync(archRoot, { recursive: true, force: true });
}

// ── 32. archiving keeps the card's OWN layer (iteration-audit finding) ──────
// Both archive paths were written when records were the only archivable layer:
// the destination and the rewritten index were hardcoded to `records`, so a
// strategy/topics/templates card was filed under `archive/records/` and its line
// in its own index was never updated (leaving a dangling link).
{
  const layerRoot = mkdtempSync(join(tmpdir(), 'dsh-archive-layer-'));
  const write = (rel, text) => {
    const abs = join(layerRoot, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };
  const card = (title) => `---\ntitle: ${title}\ntype: strategy\nstatus: candidate\n---\n\n# ${title}\n`;

  // (a) the panel path
  write('.deepseek/strategy/panel-card.md', card('面板归档卡'));
  const target = archiveMemoryFile(layerRoot, ['.deepseek', 'strategy', 'panel-card.md']);
  check('archive: a strategy card is filed under its OWN layer, not archive/records/',
    target.replace(/\\/g, '/').endsWith('.deepseek/archive/strategy/panel-card.md')
    && existsSync(join(layerRoot, '.deepseek', 'archive', 'strategy', 'panel-card.md'))
    && !existsSync(join(layerRoot, '.deepseek', 'archive', 'records')),
    target);
  write('.deepseek/memory/topics/panel-topic.md', card('面板主题卡'));
  const topicTarget = archiveMemoryFile(layerRoot, ['.deepseek', 'memory', 'topics', 'panel-topic.md']);
  check('archive: a topics card keeps the same rule (memory/<layer> → archive/<layer>)',
    topicTarget.replace(/\\/g, '/').endsWith('.deepseek/archive/topics/panel-topic.md'), topicTarget);
  write('.deepseek/memory/records/panel-rec.md', card('面板记录卡'));
  const recTarget = archiveMemoryFile(layerRoot, ['.deepseek', 'memory', 'records', 'panel-rec.md']);
  check('archive: records still land in archive/records/ (existing archives stay valid)',
    recTarget.replace(/\\/g, '/').endsWith('.deepseek/archive/records/panel-rec.md'), recTarget);

  // (b) the audit path, including the index rewrite
  write('.deepseek/strategy/index.md', '# 策略索引\n\n- [[stale-strategy|陈旧策略卡]]\n- [[live-strategy|在用策略卡]]\n');
  write('.deepseek/strategy/stale-strategy.md', [
    '---', 'title: 陈旧策略卡', 'type: strategy', 'status: active', 'updated: 2020-01-01',
    'hook:', '  operator: analysis', '  verified: single-source', '  uses: 0', '---', '', '# 陈旧策略卡', ''
  ].join('\n'));
  write('.deepseek/strategy/live-strategy.md', [
    '---', 'title: 在用策略卡', 'type: strategy', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  verified: user-confirmed', '  uses: 5', '  success_rate: 0.9', '---', '', '# 在用策略卡', ''
  ].join('\n'));
  const audit = buildAuditReport(layerRoot, { parseHookFrontmatter, tokenize, maintainHookStats: true, autoArchive: true });
  const strategyIndex = readFileSync(join(layerRoot, '.deepseek', 'strategy', 'index.md'), 'utf8');
  check('audit: auto-archived strategy card goes to archive/strategy/',
    audit.counts.autoArchived === 1
    && existsSync(join(layerRoot, '.deepseek', 'archive', 'strategy', 'stale-strategy.md')),
    JSON.stringify(audit.archived));
  check('audit: the strategy index link is rewritten to the archive path (no dangling link)',
    strategyIndex.includes('[[archive/stale-strategy|') && strategyIndex.includes('[[live-strategy|'),
    JSON.stringify(strategyIndex));
  check('audit: the archived notice no longer promises a hard-coded records subdirectory',
    !audit.human.includes('archive/records/'), audit.human.split('\n').filter((l) => l.includes('📦')).join(''));
  rmSync(layerRoot, { recursive: true, force: true });
}

// ── 33. design-intake items (docs/design-intake-2026-09-10.md §1) ───────────
// Five mechanisms absorbed from two external projects; each is deterministic and
// model-free, so each gets a direct assertion here.
{
  const intakeRoot = mkdtempSync(join(tmpdir(), 'dsh-intake-'));
  const write = (rel, text) => {
    const abs = join(intakeRoot, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };

  // ── item 1: applicability boundary gate (R1 anti_conditions) ──────────────
  write('.deepseek/strategy/bounded.md', [
    '---', 'title: 结构定理证明链', 'type: strategy', 'status: active',
    'difficulty: 结构定理 循环单调 内积化 证明',
    'not_applicable_when: "成本非二次（无内积化）或 μ 非绝对连续（映射形式不成立）时，第 3-4 格需改"',
    'strategies:', '  - move: 先证存在性（紧性 + 下半连续）', '    retrieve: [theorem]',
    'abstraction:', '  principle: "结构定理分两层：先建立弱性质，再升级成显式形式"',
    '---', '', '# 结构定理证明链', '', '正文说明循环单调与内积化的关系。', ''
  ].join('\n'));
  write('.deepseek/strategy/open.md', [
    '---', 'title: 通用策略', 'type: strategy', 'status: active', 'difficulty: 通用 结构定理 证明',
    'strategies:', '  - move: 通用 结构定理 证明 走法', '    retrieve: [theorem]',
    'abstraction:', '  principle: "通用 结构定理 证明 原则"',
    '---', '', '# 通用策略', '', '正文。', ''
  ].join('\n'));

  const boundedDoc = buildRecallDoc('.deepseek/strategy/bounded.md', readFileSync(join(intakeRoot, '.deepseek', 'strategy', 'bounded.md'), 'utf8'));
  check('intake1: the boundary is read from the card (top-level not_applicable_when)',
    boundedDoc.boundary.includes('非绝对连续'), JSON.stringify(boundedDoc.boundary));
  check('intake1: boundary segments keep the short discriminative phrases only',
    boundarySegments(boundedDoc.boundary).includes('μ 非绝对连续')
    && boundarySegments(boundedDoc.boundary).every((s) => s.length <= 12),
    JSON.stringify(boundarySegments(boundedDoc.boundary)));
  check('intake1: the gate fires on the boundary phrase and not on an unrelated query',
    boundaryHits('证明 μ 非绝对连续 时的结构定理', boundedDoc.boundary).length === 1
    && boundaryHits('证明 a.s. 收敛 子列技巧', boundedDoc.boundary).length === 0);
  const gated = rankRecallDocuments([boundedDoc], 'μ 非绝对连续 的结构定理 证明', {});
  check('intake1: an excluded card is withheld WITH its matched boundary, not silently dropped',
    gated.matches.length === 0 && gated.excluded.length === 1
    && gated.excluded[0].boundaryHits.includes('μ 非绝对连续'),
    JSON.stringify(gated.excluded));
  const openNow = rankRecallDocuments([boundedDoc], '结构定理 证明 循环单调', {});
  check('intake1: a card with no boundary is never excluded (no false positive)',
    openNow.excluded.length === 0, JSON.stringify(openNow.excluded));
  const strategyRanked = rankStrategyCards([boundedDoc], 'μ 非绝对连续 结构定理 证明', {});
  check('intake1: note_strategy applies the same gate',
    strategyRanked.matches.length === 0 && strategyRanked.excluded.length === 1);

  // ── status is a permission, not a label (improvement-details item 4) ───────
  // `status: candidate` means the audit has not promoted the card yet (it needs
  // uses >= 3 and success_rate >= 0.6), so it must not be presented as an
  // established technique. Both cards below say the SAME thing; only the status
  // differs, so the assertion isolates the status rule and nothing else.
  const sameSurface = (status) => [
    '---', `title: 换元路线(${status})`, 'type: strategy', `status: ${status}`,
    'difficulty: 换元 结构定理 证明',
    'strategies:', '  - move: 换元 结构定理 证明 走法', '    retrieve: [theorem]',
    'abstraction:', '  principle: "换元 结构定理 证明 原则"',
    '---', '', '# 换元路线', '', '正文。', ''
  ].join('\n');
  write('.deepseek/strategy/promoted.md', sameSurface('active'));
  write('.deepseek/strategy/unpromoted.md', sameSurface('candidate'));
  const statusDocs = [
    buildRecallDoc('.deepseek/strategy/promoted.md', readFileSync(join(intakeRoot, '.deepseek', 'strategy', 'promoted.md'), 'utf8')),
    buildRecallDoc('.deepseek/strategy/unpromoted.md', readFileSync(join(intakeRoot, '.deepseek', 'strategy', 'unpromoted.md'), 'utf8'))
  ];
  const statusRanked = rankStrategyCards(statusDocs, '换元 结构定理 证明', {});
  const inMatches = statusRanked.matches.some((m) => m.path.endsWith('promoted.md'));
  const candidateInMatches = statusRanked.matches.some((m) => m.path.endsWith('unpromoted.md'));
  const inCandidates = statusRanked.candidates.some((m) => m.path.endsWith('unpromoted.md'));
  check('status: a promoted card lands in matches, a candidate does not',
    inMatches && !candidateInMatches && inCandidates,
    JSON.stringify({ matches: statusRanked.matches.map((m) => [m.path, m.status]), candidates: statusRanked.candidates.map((m) => [m.path, m.status]) }));
  // Both buckets must carry `status`, otherwise the model cannot tell WHY a card
  // is only a lead (the pre-2026-09-17 shape carried no status at all).
  check('status: matches carry their status for the agent to read',
    statusRanked.matches.every((m) => typeof m.status === 'string' && m.status !== '')
    && statusRanked.candidates.every((m) => m.status === 'candidate'));
  // An UNSPECIFIED status must keep the old behaviour (stays in matches): the
  // daily audit reads it as `meta.status ?? "active"`, and silently demoting
  // older hand-written cards would narrow what the model may rely on.
  write('.deepseek/strategy/unstated.md', sameSurface('active').replace('status: active\n', ''));
  const unstatedDoc = buildRecallDoc('.deepseek/strategy/unstated.md', readFileSync(join(intakeRoot, '.deepseek', 'strategy', 'unstated.md'), 'utf8'));
  const unstatedRanked = rankStrategyCards([unstatedDoc], '换元 结构定理 证明', {});
  check('status: a card with no status field keeps its old place in matches',
    unstatedRanked.matches.length === 1 && unstatedRanked.candidates.length === 0,
    JSON.stringify({ matches: unstatedRanked.matches.map((m) => m.status), candidates: unstatedRanked.candidates.length }));

  // ── item 2: negative-transfer counter (R1 usage.harmed) ───────────────────
  const harmedCard = write('.deepseek/memory/records/harmed.md', [
    '---', 'title: 会误导的卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  verified: single-source', '  uses: 4', '---', '', '# 会误导的卡', ''
  ].join('\n'));
  applyFeedback(harmedCard, 'wrong');
  const afterOne = readFileSync(harmedCard, 'utf8');
  applyFeedback(harmedCard, 'wrong');
  const afterTwo = readFileSync(harmedCard, 'utf8');
  check('intake2: ❌ increments hook.harmed (0 → 1 → 2)',
    /harmed: 1/.test(afterOne) && /harmed: 2/.test(afterTwo.split('needs_review')[0]),
    JSON.stringify(afterTwo.split('\n').slice(0, 10)));

  // ── item 3: provenance witness (R1 ladder) ────────────────────────────────
  const witnessCard = write('.deepseek/memory/records/witness.md', [
    '---', 'title: 待确认卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  verified: single-source', '---', '', '# 待确认卡', ''
  ].join('\n'));
  applyFeedback(witnessCard, 'confirm');
  check('intake3: ✅ writes the provenance witness `verified_by: user`',
    /verified_by: user/.test(readFileSync(witnessCard, 'utf8')));
  applyFeedback(witnessCard, 'wrong');
  const demoted = readFileSync(witnessCard, 'utf8');
  check('intake3: ❌ on a confirmed card demotes one step AND invalidates the witness',
    /verified: cross-referenced/.test(demoted) && /verified_by: none/.test(demoted),
    JSON.stringify(demoted.split('\n').slice(0, 10)));

  // ── items 3 + 4 (audit side): witness check + declared/effective state ────
  write('.deepseek/memory/records/index.md', '# 索引\n');
  write('.deepseek/memory/records/unjustified.md', [
    '---', 'title: 越权升级卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  verified: cross-referenced', '  uses: 0', '---', '', '# 越权升级卡', ''
  ].join('\n'));
  write('.deepseek/memory/records/legit.md', [
    '---', 'title: 合法升级卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  verified: user-confirmed', '  verified_by: user', '  uses: 0', '---', '', '# 合法升级卡', ''
  ].join('\n'));
  const auditNoSync = buildAuditReport(intakeRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  check('intake3: a level above single-source without the witness is flagged (never auto-fixed)',
    auditNoSync.structural.unjustifiedUpgrade >= 1
    && auditNoSync.structuralDetail.unjustifiedUpgrade.some((t) => t.includes('越权升级卡'))
    && auditNoSync.human.includes('验证等级高于'),
    JSON.stringify(auditNoSync.structuralDetail.unjustifiedUpgrade));
  check('intake3: a witnessed user-confirmed card is NOT flagged, and ❌ invalidates the witness',
    !auditNoSync.structuralDetail.unjustifiedUpgrade.some((t) => t.includes('合法升级卡'))
    && auditNoSync.structuralDetail.unjustifiedUpgrade.some((t) => t.includes('待确认卡')));

  // ── item 4: declared vs effective uses ───────────────────────────────────
  write('.deepseek/cache/retrieval-stats.json', JSON.stringify({
    '.deepseek/memory/records/harmed.md': { uses: 2, last_used: '2026-09-10' },
    '__meta__': { calls: 1, empty: 0 }
  }, null, 2));
  const stateWithPending = collectMemoryState(intakeRoot, '', parseHookFrontmatter);
  const harmedEntry = stateWithPending.records.find((card) => card.rel.endsWith('harmed.md'));
  check('intake4: the panel shows the EFFECTIVE uses (declared + not-yet-merged hits)',
    harmedEntry.uses === harmedEntry.usesDeclared + harmedEntry.usesPending
    && harmedEntry.usesPending === 2,
    JSON.stringify({ uses: harmedEntry.uses, declared: harmedEntry.usesDeclared, pending: harmedEntry.usesPending }));
  // Recomputed AFTER the pending stats exist: this is the no-sync pass that sees
  // the declared value disagreeing with the merged one.
  const auditWithPending = buildAuditReport(intakeRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  check('intake4: the audit reports the mismatch instead of pretending it is consistent',
    auditWithPending.status === 'degraded'
    && auditWithPending.warnings.some((w) => w.includes('uses'))
    && auditWithPending.structural.usesMismatch >= 1,
    JSON.stringify({ status: auditWithPending.status, warnings: auditWithPending.warnings }));

  // ── item 5: degraded instead of silent success ───────────────────────────
  const synced = buildAuditReport(intakeRoot, { parseHookFrontmatter, tokenize, maintainHookStats: true });
  const harmedAfterSync = readFileSync(join(intakeRoot, '.deepseek', 'memory', 'records', 'harmed.md'), 'utf8');
  check('intake5: the stats sync is verified by reading the file back (declared = merged value)',
    synced.postconditions.statsWrites > 0 && synced.postconditions.statsFailures.length === 0
    && /uses: 6/.test(harmedAfterSync) && synced.structural.usesMismatch === 0,
    JSON.stringify({ post: synced.postconditions, file: harmedAfterSync.split('\n').slice(0, 10), mismatch: synced.structural.usesMismatch }));
  check('intake5: after a successful sync the report is `ok`, with no leftover mismatch',
    synced.status === 'ok' && synced.warnings.length === 0 && synced.structural.usesMismatch === 0,
    JSON.stringify({ status: synced.status, warnings: synced.warnings, mismatch: synced.structural.usesMismatch }));
  check('intake5: a card file that disappears mid-audit degrades the report instead of claiming success', (() => {
    const probeRoot = mkdtempSync(join(tmpdir(), 'dsh-degraded-'));
    const dir = join(probeRoot, '.deepseek', 'memory', 'records');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.md'), '# 索引\n');
    // A card with pending hits but nowhere to write them (no hook block, not a
    // strategy card): the old code zeroed the delta silently; now it must warn.
    writeFileSync(join(dir, 'gone.md'), ['---', 'title: 无 hook 卡', 'type: fact', 'updated: 2026-09-01', '---', '', '# x', ''].join('\n'), 'utf8');
    mkdirSync(join(probeRoot, '.deepseek', 'cache'), { recursive: true });
    writeFileSync(join(probeRoot, '.deepseek', 'cache', 'retrieval-stats.json'), JSON.stringify({
      '.deepseek/memory/records/gone.md': { uses: 3, last_used: '2026-09-10' }, '__meta__': { calls: 1, empty: 0 }
    }), 'utf8');
    const report = buildAuditReport(probeRoot, { parseHookFrontmatter, tokenize, maintainHookStats: true });
    rmSync(probeRoot, { recursive: true, force: true });
    return report.status === 'degraded'
      && report.postconditions.unmergeableStats.length === 1
      && report.warnings.some((w) => w.includes('无处可写'));
  })());
  const harmedCount = synced.counts.harmed;
  check('intake2: the audit counts cards with negative transfer',
    harmedCount === 2 && synced.sections.harmed.some((card) => card.title === '会误导的卡' && card.harmed === 2),
    JSON.stringify(synced.sections.harmed));

  // ── net gain: the audit must decide it from EXPLICIT outcomes only, and write
  // it back into the machine-owned `gain` line (improvement-details item 1).
  // The assertion is on the audit's own output, so it cannot pass by the ranking
  // and the verdict drifting apart.
  {
    const gainRoot = mkdtempSync(join(tmpdir(), 'dsh-gain-'));
    const gainWrite = (rel, text) => {
      const abs = join(gainRoot, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text, 'utf8');
      return abs;
    };
    mkdirSync(join(gainRoot, '.deepseek', 'memory', 'records'), { recursive: true });
    writeFileSync(join(gainRoot, '.deepseek', 'memory', 'records', 'index.md'), '# 索引\n', 'utf8');
    const hookCard = (title) => [
      '---', `title: ${title}`, 'type: fact', 'status: active', 'updated: 2026-09-01',
      `source: '[[ep-1]]'`, 'hook:', '  operator: analysis', '  verified: single-source', '---', '', `# ${title}`, ''
    ].join('\n');
    const wrongAbs = gainWrite('.deepseek/memory/records/gain-wrong.md', hookCard('被否定的卡'));
    const okAbs = gainWrite('.deepseek/memory/records/gain-ok.md', hookCard('被确认的卡'));
    const plainAbs = gainWrite('.deepseek/memory/records/gain-plain.md', hookCard('没有反馈的卡'));

    applyFeedback(wrongAbs, 'wrong');
    applyFeedback(okAbs, 'confirm');
    const gainReport = buildAuditReport(gainRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
    // Read the verdicts off the audit's own output. `structuralDetail.gains` is the
    // authoritative per-card list (it includes the zeros), so the assertion cannot
    // pass while the file and the verdict drift apart.
    const verdictOf = (rel) => gainReport.structuralDetail.gains.find((entry) => entry.rel === rel)?.gain;
    const WRONG = '.deepseek/memory/records/gain-wrong.md';
    const OK = '.deepseek/memory/records/gain-ok.md';
    const PLAIN = '.deepseek/memory/records/gain-plain.md';
    check('gain: ❌ ⇒ −1, ✅ ⇒ +1, and a card with no feedback stays at the neutral 0',
      verdictOf(WRONG) === -1 && verdictOf(OK) === 1 && verdictOf(PLAIN) === 0,
      JSON.stringify({ wrong: verdictOf(WRONG), ok: verdictOf(OK), plain: verdictOf(PLAIN) }));
    const wrongText = readFileSync(wrongAbs, 'utf8');
    const okText = readFileSync(okAbs, 'utf8');
    const plainText = readFileSync(plainAbs, 'utf8');
    check('gain: the audit writes the machine-owned verdict into the hook block',
      /gain:\s*-1/.test(wrongText) && /gain:\s*1/.test(okText),
      JSON.stringify({ wrong: wrongText.split('\n').filter((l) => l.includes('gain')), ok: okText.split('\n').filter((l) => l.includes('gain')) }));
    check('gain: a card with no outcome feedback carries no gain line at all',
      !/gain:/.test(plainText),
      JSON.stringify(plainText.split('\n').filter((l) => l.includes('gain'))));
    // A ✅ resolving a earlier ❌ must clear the verdict again, not leave a stale one.
    applyFeedback(okAbs, 'wrong');
    applyFeedback(okAbs, 'confirm');
    const resolved = readFileSync(okAbs, 'utf8');
    check('gain: a later ✅ clears a stale negative verdict instead of leaving it behind',
      !/gain:\s*-1/.test(resolved),
      JSON.stringify(resolved.split('\n').filter((l) => l.includes('gain'))));
    // Ranking must actually consume it, and a negative verdict must fall BELOW an
    // unrated card — otherwise the field is decoration.
    const negative = hookPrior({ verified: 'single-source', gain: '-1' });
    const neutral = hookPrior({ verified: 'single-source' });
    const positive = hookPrior({ verified: 'single-source', gain: '1' });
    check('gain: ranking consumes it, and a rejected card ranks below an unrated one',
      negative < neutral && positive > neutral && inScale(negative) && inScale(positive),
      JSON.stringify({ negative, neutral, positive }));
    check('gain: an out-of-range hand-edited gain cannot escape the [0,1] scale',
      inScale(hookPrior({ verified: 'single-source', gain: '99' }))
      && inScale(hookPrior({ verified: 'single-source', gain: '-99' })),
      'clamped');
    rmSync(gainRoot, { recursive: true, force: true });
  }

  rmSync(intakeRoot, { recursive: true, force: true });
}

// ── 33b. duplicate ordering + structural hubs (improvement-details item 13) ──
//
// Two decisions lifted from MemForest (arXiv:2609.08273):
//   1. order matters more than the cap — it shows merging the LEAST similar pair
//      (89.0%) is worse than a random pair (91.7%), while the most similar pair
//      wins (96.0%), and its Eq. 15 explains why. So the report must lead with the
//      highest-Jaccard pair, not with whichever pair the scan happened to reach.
//   2. a high-degree node is a hub and must not be merged early — MemForest
//      down-weights high-degree nodes in its edge score for exactly this reason.
// Both are asserted on a vault built here, so the assertions stay anchored on code
// behaviour instead of on whatever the real vault happens to contain.
{
  const dupRoot = mkdtempSync(join(tmpdir(), 'dsh-dup-'));
  const writeCard = (rel, text) => {
    const abs = join(dupRoot, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };
  const cardText = (title, operator, pattern, techniques, related = '[]') => [
    '---', `title: ${title}`, 'type: fact', 'status: active', 'updated: 2026-09-01',
    `source: '[[ep-1]]'`, `related: ${related}`, 'hook:',
    `  operator: ${operator}`, `  pattern: ${pattern}`,
    `  techniques: [${techniques}]`, '  verified: single-source', '---', '', `# ${title}`, ''
  ].join('\n');

  // Three DISJOINT pairs in ONE operator bucket. The FILE NAMES are what set the
  // scan order (cards are collected by directory read), and they are deliberately
  // assigned so the WEAKER reported pair is scanned FIRST:
  //   dup-b*.md holds group C (0.75), dup-c*.md holds group B (1.00).
  // That is what makes the ordering assertion falsifiable — with the sort removed
  // the report leads with 0.75 and the assertion fails. An earlier version wrote
  // the strong pair to the earlier filenames, so the scan order was already
  // descending and the assertion PASSED with the sort removed: it was not testing
  // the sort at all.
  //
  // Crafted scores, each MEASURED against the real tokenizer and the 0.7
  // `AUDIT_DUP_JACCARD` threshold rather than reasoned about. Five hand-computed
  // attempts were wrong before measuring — the fixture, never the code, was at
  // fault each time. Two traps: `pattern` contributes ONE token whatever it says,
  // and a Jaccard of 0.75 needs three tokens per side (2 shared / 1 distinct), not
  // two shared tokens:
  //   B: {patb,va,vb} vs {patb,va,vb}    = 3/3 = 1.000 -> reported
  //   C: {patc,m,n}   vs {patc,m,n,o}    = 3/4 = 0.750 -> reported
  //   A: {pata,pa}    vs {pata,pa,pb}    = 2/3 = 0.667 -> BELOW 0.7, not reported
  // A is kept as a below-threshold control: it proves the list is a threshold
  // result, not "every pair in the bucket". Distinct patterns keep every
  // cross-group pair at 0.000.
  const group = (tag, ta, tb) => ({
    a: cardText(`${tag}甲`, 'duptest', `pat${tag}`, ta),
    b: cardText(`${tag}乙`, 'duptest', `pat${tag}`, tb)
  });
  const [ga, gb, gc] = [
    group('A', 'pa', 'pa, pb'),
    group('B', 'va, vb', 'va, vb'),
    group('C', 'm, n', 'm, n, o')
  ];
  writeCard('.deepseek/memory/records/dup-b1.md', gc.a);
  writeCard('.deepseek/memory/records/dup-b2.md', gc.b);
  writeCard('.deepseek/memory/records/dup-c1.md', gb.a);
  writeCard('.deepseek/memory/records/dup-c2.md', gb.b);
  writeCard('.deepseek/memory/records/dup-a1.md', ga.a);
  writeCard('.deepseek/memory/records/dup-a2.md', ga.b);

  // A hub: two other cards hang off it. Own operator bucket so it cannot itself
  // form a duplicate pair and confound the ordering assertion.
  writeCard('.deepseek/memory/records/hub-card.md',
    cardText('枢纽依据', 'hubtest', 'hubpat', 'hubtech'));
  writeCard('.deepseek/memory/records/dep-one.md',
    cardText('依赖一', 'depone', 'p1', 't9', '[[hub-card]]'));
  writeCard('.deepseek/memory/records/dep-two.md',
    cardText('依赖二', 'deptwo', 'p2', 't8', '[[hub-card]]'));

  const dupReport = buildAuditReport(dupRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  const pairs = dupReport.sections.duplicates;
  check('dup: pairs are ordered by similarity, highest first (and the sub-threshold pair is absent)',
    pairs.length === 2 && pairs.map((p) => p.jaccard).join(',') === '1,0.75'
    && !pairs.some((p) => p.a.title === 'A甲' || p.b.title === 'A甲'),
    JSON.stringify(pairs.map((p) => [p.a.title, p.b.title, p.jaccard])));
  check('dup: the most similar pair leads even though a weaker one is scanned first',
    pairs[0].jaccard === 1
    && [pairs[0].a.title, pairs[0].b.title].sort().join('|') === ['B甲', 'B乙'].sort().join('|'),
    JSON.stringify(pairs.map((p) => [p.a.title, p.b.title, p.jaccard])));
  check('dup: the similarity score is carried into the report, not just used for sorting',
    pairs.every((p) => typeof p.jaccard === 'number'),
    JSON.stringify(pairs.map((p) => p.jaccard)));
  check('hub: a card other cards link to is reported as a structural hub with its backlink count',
    dupReport.structural.hubs === 1
    && dupReport.sections.hubs[0].title === '枢纽依据'
    && dupReport.sections.hubs[0].backlinks === 2,
    JSON.stringify(dupReport.sections.hubs));
  check('hub: a card with no incoming links is NOT reported as a hub',
    !dupReport.sections.hubs.some((card) => card.title === 'B甲'),
    JSON.stringify(dupReport.sections.hubs.map((c) => c.title)));
  check('hub: the checklist names the hub so a merge of the shared premise is a deliberate act',
    dupReport.report.includes('结构枢纽') && dupReport.report.includes('枢纽依据'),
    dupReport.report.split('\n').filter((l) => l.includes('枢纽')).join(' / '));
  rmSync(dupRoot, { recursive: true, force: true });
}

// ── 33c. dependency direction + cascade (improvement-details item 2) ─────────
//
// `related` is undirected, so it cannot answer "what is standing on this card?".
// `depends_on` records the direction. The audit must then name the dependents of a
// premise that moved (superseded, or flagged needs_review) — and must NOT invent a
// cascade from undirected `related`, or the list fills with noise.
{
  const depRoot = mkdtempSync(join(tmpdir(), 'dsh-dep-'));
  const writeDep = (rel, text) => {
    const abs = join(depRoot, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };
  const depCard = (title, extra = []) => [
    '---', `title: ${title}`, 'type: fact', 'status: active', 'updated: 2026-09-01',
    `source: '[[ep-1]]'`, ...extra, '---', '', `# ${title}`, ''
  ].join('\n');

  // A ← B ← C : B says it is built on A, C says it is built on B.
  writeDep('.deepseek/memory/records/chain-a.md', depCard('链条甲'));
  writeDep('.deepseek/memory/records/chain-b.md', depCard('链条乙', ["depends_on: ['[[chain-a]]']"]));
  writeDep('.deepseek/memory/records/chain-c.md', depCard('链条丙', ["depends_on: ['[[chain-b]]']"]));
  // Control: D merely "sees also" A. An undirected link must not cascade.
  writeDep('.deepseek/memory/records/chain-d.md', depCard('仅相关丁', ["related: ['[[chain-a]]']"]));

  const before = buildAuditReport(depRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  check('dep: nothing is reported for review while every premise is still active',
    before.sections.downstreamReview.length === 0,
    JSON.stringify(before.sections.downstreamReview));

  // The premise moves. Rewrite A as superseded: B (and only B) now stands on
  // something that changed. C is two hops away and stays quiet — we deliberately
  // do not chase transitive chains (that would need a confidence propagation
  // model, and reporting every descendant is noise for a human to act on).
  writeDep('.deepseek/memory/records/chain-a.md', depCard('链条甲').replace('status: active', 'status: superseded'));
  const after = buildAuditReport(depRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  const rows = after.sections.downstreamReview;
  check('dep: superseding a premise names its direct dependent',
    rows.length === 1 && rows[0].title === '链条乙' && rows[0].via.title === '链条甲',
    JSON.stringify(rows.map((r) => [r.title, r.via.title, r.reason])));
  check('dep: the reason is stated, so the reader knows what moved',
    rows.length === 1 && String(rows[0].reason).includes('取代'),
    JSON.stringify(rows.map((r) => r.reason)));
  check('dep: an undirected `related` link is NOT treated as a dependency',
    !rows.some((r) => r.title === '仅相关丁'),
    JSON.stringify(rows.map((r) => r.title)));
  check('dep: a superseded card is not reported as depending on itself',
    !rows.some((r) => r.title === '链条甲'),
    JSON.stringify(rows.map((r) => r.title)));
  check('dep: the cascade counts as a decision for the panel headline',
    after.decisions.downstreamCards === 1 && after.decisions.total >= 1,
    JSON.stringify(after.decisions));
  check('dep: the checklist names both ends of the dependency',
    after.report.includes('下游待复查') && after.report.includes('链条乙') && after.report.includes('链条甲'),
    after.report.split('\n').filter((l) => l.includes('下游待复查')).join(' / '));

  // The other way a premise moves: the user marked it wrong. Same cascade, and the
  // reason must reflect it (a reader acts differently on "wrong" vs "replaced").
  writeDep('.deepseek/memory/records/chain-a.md', depCard('链条甲'));
  writeDep('.deepseek/memory/records/chain-b.md', depCard('链条乙', ["depends_on: ['[[chain-a]]']", 'needs_review: true']));
  const flagged = buildAuditReport(depRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  check('dep: a needs_review premise also cascades, with its own reason',
    flagged.sections.downstreamReview.length === 1
    && flagged.sections.downstreamReview[0].title === '链条丙'
    && String(flagged.sections.downstreamReview[0].reason).includes('重审'),
    JSON.stringify(flagged.sections.downstreamReview.map((r) => [r.title, r.reason])));
  rmSync(depRoot, { recursive: true, force: true });
}

// ── 33d. cross-occasion support (improvement-details item 6) ─────────────────
//
// MSCE refuses to induce a policy until the same signature has evidence from
// `n_min` DISTINCT episodes. The approved plan assumed a strategy card records
// which episodes exercised its moves; it does not, so this reads the link that
// exists (records.hook.techniques + records.source) and counts distinct OCCASIONS,
// where episodes a few days apart are one occasion and undated evidence never
// merges with anything.
{
  const occRoot = mkdtempSync(join(tmpdir(), 'dsh-occ-'));
  const occWrite = (rel, text) => {
    const abs = join(occRoot, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };
  const occCard = (title, episode, techniques) => [
    '---', `title: ${title}`, 'type: fact', 'status: active', 'updated: 2026-09-01',
    `source: '[[${episode}]]'`, 'hook:', '  operator: analysis',
    `  techniques: [${techniques}]`, '  verified: single-source', '---', '', `# ${title}`, ''
  ].join('\n');
  mkdirSync(join(occRoot, '.deepseek', 'memory', 'records'), { recursive: true });
  writeFileSync(join(occRoot, '.deepseek', 'memory', 'records', 'index.md'), '# 索引\n', 'utf8');

  // `widely` appears on two episodes 10 days apart -> two occasions.
  occWrite('.deepseek/memory/records/occ-1.md', occCard('宽用甲', '2026-08-01-a', 'widely'));
  occWrite('.deepseek/memory/records/occ-2.md', occCard('宽用乙', '2026-08-11-b', 'widely'));
  // `sameday` appears on two episodes the same day -> ONE occasion.
  occWrite('.deepseek/memory/records/occ-3.md', occCard('同日甲', '2026-08-02-a', 'sameday'));
  occWrite('.deepseek/memory/records/occ-4.md', occCard('同日乙', '2026-08-02-b', 'sameday'));
  // `nearby` appears 2 days apart -> still ONE occasion (inside the window).
  occWrite('.deepseek/memory/records/occ-5.md', occCard('邻近甲', '2026-08-03-a', 'nearby'));
  occWrite('.deepseek/memory/records/occ-6.md', occCard('邻近乙', '2026-08-05-b', 'nearby'));
  // `once` appears once -> an anecdote, never listed.
  occWrite('.deepseek/memory/records/occ-7.md', occCard('单次', '2026-08-06-a', 'once'));
  // `orphan` has NO `source` but names the SAME technique as a card that does. Its
  // empty source must not be counted as an episode of its own: if the provenance
  // guard is removed, `once` gains a second "occasion" and gets listed — which is
  // what makes the guard's assertion falsifiable (a first version used a technique
  // name unique to this card, so dropping the guard changed nothing observable).
  occWrite('.deepseek/memory/records/occ-8.md', [
    '---', 'title: 无源卡', 'type: fact', 'status: active', 'updated: 2026-09-01',
    'hook:', '  operator: analysis', '  techniques: [once]', '  verified: single-source',
    '---', '', '# 无源卡', ''
  ].join('\n'));

  const occReport = buildAuditReport(occRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  const rows = new Map(occReport.sections.independentTechniques.map((entry) => [entry.techniques, entry.occasions]));
  check('occasion: two episodes far apart count as two occasions and are listed',
    rows.get('widely') === 2, JSON.stringify([...rows]));
  check('occasion: the same day is ONE occasion, not two',
    !rows.has('sameday'), JSON.stringify([...rows]));
  check('occasion: evidence a couple of days apart is still ONE occasion (window)',
    !rows.has('nearby'), JSON.stringify([...rows]));
  check('occasion: a technique seen once is an anecdote, never listed',
    !rows.has('once'), JSON.stringify([...rows]));
  check('occasion: evidence with no usable source cannot manufacture a second occasion',
    !rows.has('once'), JSON.stringify([...rows]));
  check('occasion: the checklist explains the distinction instead of dumping every technique',
    occReport.report.includes('跨场合验证过的技巧') && occReport.report.includes('widely'),
    occReport.report.split('\n').filter((l) => l.includes('跨场合')).join(' / '));
  rmSync(occRoot, { recursive: true, force: true });
}

// ── 33f. injection budget tiers (batch 3: item 11) ──────────────────────────
//
// MemForest treats its compression ratio as an explicit dial and reads its
// accuracy/cost curve off that dial, instead of leaving the size a hidden side effect
// of the implementation. Same idea here: the memory section's size becomes a knob.
//
// The load-bearing property is the NEGATIVE one: `standard` must be byte-for-byte the
// values that existed before tiers did, or merely offering a choice would change
// behaviour for everyone who does not make one.
{
  const OLD_CONSTANTS = { profile: 4000, topics: 1800, records: 800, templates: 600, episodes: 1200, inbox: 1200, dialogue: 3000 };
  check('budget: `standard` is exactly the values that predate tiers',
    JSON.stringify(BUDGET_TIERS.standard) === JSON.stringify(OLD_CONSTANTS),
    JSON.stringify(BUDGET_TIERS.standard));
  const keys = Object.keys(OLD_CONSTANTS);
  check('budget: all three tiers cover the same seven keys',
    ['compact', 'standard', 'rich'].every((t) => keys.every((k) => Number.isFinite(BUDGET_TIERS[t][k]))),
    JSON.stringify(Object.keys(BUDGET_TIERS)));
  check('budget: compact < standard < rich on every key (the dial actually turns)',
    keys.every((k) => BUDGET_TIERS.compact[k] < BUDGET_TIERS.standard[k] && BUDGET_TIERS.standard[k] < BUDGET_TIERS.rich[k]),
    JSON.stringify(keys.map((k) => [k, BUDGET_TIERS.compact[k], BUDGET_TIERS.standard[k], BUDGET_TIERS.rich[k]])));
  check('budget: an unset or unknown tier resolves to standard, it does not throw',
    resolveBudgetTier(undefined) === 'standard'
    && resolveBudgetTier('') === 'standard'
    && resolveBudgetTier('nonsense') === 'standard'
    && resolveBudgetTier('compact') === 'compact'
    && resolveBudgetTier('rich') === 'rich'
    && resolveBudgetTier(null) === 'standard',
    JSON.stringify([resolveBudgetTier(undefined), resolveBudgetTier('nonsense'), resolveBudgetTier('compact')]));

  // The dial must actually turn the section size, or the tiers are just a data
  // structure. The fixture has to be LARGER than the biggest tier's profile budget:
  // an earlier version of this check used a fixture of ~350 chars, so BOTH `compact`
  // (2500) and `rich` (6000) could hold it whole and the lengths came out identical.
  // I first recorded that as "some unknown mechanism shortens the profile" — wrong,
  // and measuring the profile block against a spread of budgets (100 → 354 chars,
  // 2500 → 2453, 99999 → 2453) showed the cap working all along. A fixture that does
  // not exceed the cap cannot test the cap.
  const budgetRoot = mkdtempSync(join(tmpdir(), 'dsh-budget-'));
  mkdirSync(join(budgetRoot, '.deepseek', 'memory'), { recursive: true });
  writeFileSync(join(budgetRoot, '.deepseek', 'memory', 'profile.md'),
    '# 偏好\n' + '这条偏好很长，用来把注入预算撑满，必须长过最大档位的 6000 字。'.repeat(300), 'utf8');
  const sectionFor = (tier) => buildMemorySection(
    { vaultRoot: budgetRoot, sessionsRoot: budgetRoot, maxHistoryEntries: 0, maxHistoryChars: 0, cacheTtlMs: 0, budgets: BUDGET_TIERS[tier] },
    'session-x', null, null, ''
  );
  const compactSection = sectionFor('compact');
  const standardSection = sectionFor('standard');
  const richSection = sectionFor('rich');
  check('budget: a bigger tier really does inject more when the content exceeds the cap',
    compactSection.length < standardSection.length && standardSection.length < richSection.length,
    JSON.stringify({ compact: compactSection.length, standard: standardSection.length, rich: richSection.length }));
  // And the cap is enforced, not merely approached: rich must stay bounded well below
  // the raw file size, or "budget" would be a suggestion.
  const rawProfile = readFileSync(join(budgetRoot, '.deepseek', 'memory', 'profile.md'), 'utf8').length;
  check('budget: the cap is enforced rather than merely approached',
    richSection.length < rawProfile,
    JSON.stringify({ richSection: richSection.length, rawProfile }));
  rmSync(budgetRoot, { recursive: true, force: true });

  // ── the vault-side channel for the tier (settings page → .deepseek/config.md) ──
  // Precedence is the property here that is invisible at a glance and easy to break by
  // "simplifying": explicit preset config > vault config.md > standard.
  const budgetCfgRoot = mkdtempSync(join(tmpdir(), 'dsh-budgetcfg-'));
  const cfgText = (value) => ['---', `budget: ${value}`, '---', '', '# config', ''].join('\n');
  check('budget: the tier written into .deepseek/config.md is read back',
    parseMemoryConfig(cfgText('rich'))?.budget === 'rich',
    JSON.stringify(parseMemoryConfig(cfgText('rich'))));
  check('budget: the vault tier decides the budgets when the preset says nothing',
    JSON.stringify(budgetsFor({}, { budget: 'rich' })) === JSON.stringify(BUDGET_TIERS.rich)
    && JSON.stringify(budgetsFor({}, {})) === JSON.stringify(BUDGET_TIERS.standard),
    JSON.stringify({ vault: budgetsFor({}, { budget: 'rich' }).profile, none: budgetsFor({}, {}).profile }));
  check('budget: an EXPLICIT preset setting beats the vault choice',
    JSON.stringify(budgetsFor({ budgetExplicit: true, budgetTier: 'compact' }, { budget: 'rich' })) === JSON.stringify(BUDGET_TIERS.compact),
    JSON.stringify(budgetsFor({ budgetExplicit: true, budgetTier: 'compact' }, { budget: 'rich' }).profile));
  check('budget: an unknown tier in config.md is ignored rather than pinned to standard',
    parseMemoryConfig(['---', 'budget: enormous', '---', ''].join('\n')) === null,
    JSON.stringify(parseMemoryConfig(['---', 'budget: enormous', '---', ''].join('\n'))));
  // The settings page writes through this; it must create the file when absent and
  // leave unrelated fields alone when present.
  const budgetWriteRoot = mkdtempSync(join(tmpdir(), 'dsh-budgetwrite-'));
  mkdirSync(join(budgetWriteRoot, '.deepseek'), { recursive: true });
  setMemoryBudget(budgetWriteRoot, 'compact', ['---', 'sessionCapture: true', '---', '', '# config', ''].join('\n'));
  const writtenCfg = readFileSync(join(budgetWriteRoot, '.deepseek', 'config.md'), 'utf8');
  check('budget: the writer adds `budget` and preserves the fields already there',
    /budget:\s*compact/.test(writtenCfg) && /sessionCapture:\s*true/.test(writtenCfg),
    JSON.stringify(writtenCfg.split('\n').slice(0, 6)));
  rmSync(budgetCfgRoot, { recursive: true, force: true });
  rmSync(budgetWriteRoot, { recursive: true, force: true });
}

// ── 33d-2. paired decision guidance (item 8, second half) ───────────────────
//
// MSCE keeps `D = (context, a⁺, a⁻, evidence, reliability)`: "what to do" alone does
// not carry the lesson, so a strategy card records the pair. Asserted on the real
// extractor only — no vault needed, and the wire shape is already covered by
// test-tool-shape (which fails on any declared-but-missing field).
{
  const guidanceFm = [
    'title: 有对比指导的策略卡', 'type: strategy', 'status: active',
    'difficulty: 换元 结构定理 证明',
    'strategies:', '  - move: 换元 结构定理 证明 走法', '    retrieve: [theorem]',
    'abstraction:', '  principle: "换元原则"',
    'decision_guidance:',
    '  prefer: "先试等价刻画；必要时换元"',
    '  avoid: "别直接展开定义"',
    '---', '', '# 有对比指导的策略卡', ''
  ].join('\n');
  const guidance = strategyGuidance(guidanceFm);
  check('guidance: prefer/avoid are read from the card as a pair',
    guidance.prefer === '先试等价刻画；必要时换元' && guidance.avoid === '别直接展开定义',
    JSON.stringify(guidance));
  check('guidance: a card with no decision_guidance yields empty strings, not undefined',
    JSON.stringify(strategyGuidance('title: x\ntype: strategy\n')) === JSON.stringify({ prefer: '', avoid: '' }),
    JSON.stringify(strategyGuidance('title: x\ntype: strategy\n')));
}

// ── 33e. the grounding gate on promotion (improvement-details item 7, part 1) ──
//
// MSCE promotes a policy to a skill only when it still retains evidence. The
// deterministic half of that available here is provenance: a candidate that met the
// usage/success bar but has no traceable `source` must stay a candidate, and must be
// NAMED so "why is this still a candidate?" has an answer. The gate may only block
// when provenance is absent — never demand more — or honest cards become un-promotable.
{
  const gateRoot = mkdtempSync(join(tmpdir(), 'dsh-gate-'));
  const strategyCard = (withSource) => [
    '---', 'title: 缺证据候选', 'type: strategy', 'status: candidate',
    'difficulty: definition-level-proof', 'provenance: agent',
    ...(withSource ? ["source: '[[2026-08-01-episode-proof]]'"] : []),
    'verified: single-source', 'uses: 5', 'success_rate: 0.8', 'updated: 2026-08-10',
    '---', '', '# 缺证据候选', ''
  ].join('\n');
  mkdirSync(join(gateRoot, '.deepseek', 'strategy'), { recursive: true });
  const gatePath = join(gateRoot, '.deepseek', 'strategy', 'gate-candidate.md');
  writeFileSync(gatePath, strategyCard(false), 'utf8');

  const blocked = buildAuditReport(gateRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  const blockedText = readFileSync(gatePath, 'utf8');
  check('gate: a candidate that clears uses+rate but has no source is NOT promoted',
    /^status:\s*candidate/m.test(blockedText),
    blockedText.split('\n').slice(0, 9).join('|'));
  check('gate: the blocked candidate is named, with the reason',
    blocked.structuralDetail.promoteBlocked.length === 1
    && blocked.structuralDetail.promoteBlocked[0].title === '缺证据候选'
    && String(blocked.structuralDetail.promoteBlocked[0].reason).includes('source'),
    JSON.stringify(blocked.structuralDetail.promoteBlocked));
  check('gate: the checklist explains that adding the source will self-promote it',
    blocked.report.includes('暂不晋升') && blocked.report.includes('缺证据候选'),
    blocked.report.split('\n').filter((l) => l.includes('晋升')).join(' / '));

  // Now give it provenance: the very same card must promote on the next audit.
  writeFileSync(gatePath, strategyCard(true), 'utf8');
  const promoted = buildAuditReport(gateRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  const promotedText = readFileSync(gatePath, 'utf8');
  check('gate: adding the source lets the same card promote (the gate blocks, it does not punish)',
    /^status:\s*active/m.test(promotedText) && promoted.structuralDetail.promoteBlocked.length === 0,
    JSON.stringify({ status: promotedText.split('\n').slice(0, 9).join('|'), blocked: promoted.structuralDetail.promoteBlocked }));
  rmSync(gateRoot, { recursive: true, force: true });
}

// §34 multi-view pooling (GraphMemix intake, docs/memory/retrieval-v3.md §7.2).
//
// The product default stays the single bag; the max-pool exists so the QA probe
// can A/B it. What MUST hold either way: the views carry exactly the bag's
// fields, the default is unchanged, empty views never throw, and the boundary
// gate keeps working under both poolings.
{
  const card = {
    kind: 'record',
    rel: '.deepseek/memory/records/rec-multiview.md',
    title: '唯一标题词',
    topic: '主题词',
    tags: [],
    hook: { operator: 'probability', techniques: ['技巧词'], success_rate: 1, uses: 2, verified: 'user-confirmed' },
    boundary: '',
    status: '',
    duplicateOf: '',
    difficulty: '',
    updated: '2026-09-10',
    body: '正文词 '.repeat(20)
  };
  const views = composePassageViews('record', card);
  check('multiview: a record splits into title / keywords / body',
    views.length === 3 && views.map((v) => v.name).join(',') === 'title,keywords,body',
    JSON.stringify(views.map((v) => v.name)));
  check('multiview: the views carry the same fields as the bag (title + topic + hook + body)',
    views[0].text === card.title
    && views[1].text.includes('主题词')
    && views[2].text.includes('技巧词')
    && views[2].text.includes('正文词'),
    JSON.stringify(views.map((v) => v.text.slice(0, 20))));
  check('multiview: every bag token still exists somewhere in the views (no evidence dropped)', (() => {
    const bag = new Set(tokenize(composePassage('record', card)));
    const pooled = new Set(views.flatMap((view) => tokenize(view.text)));
    const missing = [...bag].filter((token) => !pooled.has(token));
    return missing.length === 0;
  })(), JSON.stringify(views.map((v) => v.text.length)));

  const docs = [
    buildRecallDoc('.deepseek/memory/records/rec-multiview.md', [
      '---', 'title: 唯一标题词', 'type: fact', 'topic: 主题词', 'updated: 2026-09-10',
      'hook:', '  operator: probability', '  techniques: [技巧词]', '  verified: user-confirmed', '---', '', '正文词 正文词 正文词'
    ].join('\n')),
    buildRecallDoc('数学/普通笔记.md', ['---', 'tags: [analysis]', '---', '', '正文词 '.repeat(50)].join('\n'))
  ].filter((doc) => doc !== null);
  const bagRanking = rankRecallDocuments(docs, '唯一标题词', { limit: 5 });
  const maxRanking = rankRecallDocuments(docs, '唯一标题词', { limit: 5, viewPool: 'max' });
  check('multiview: the default pooling is still the single bag',
    bagRanking.viewPool === 'bag' && maxRanking.viewPool === 'max',
    `${bagRanking.viewPool} / ${maxRanking.viewPool}`);
  check('multiview: a request for max-pooling never has to be assumed (the answer reports it)',
    rankRecallDocuments(docs, '唯一标题词', { limit: 5, viewPool: 'nonsense' }).viewPool === 'bag');
  check('multiview: both poolings put the exact-title card first',
    bagRanking.matches[0]?.path === '.deepseek/memory/records/rec-multiview.md'
    && maxRanking.matches[0]?.path === '.deepseek/memory/records/rec-multiview.md',
    JSON.stringify([bagRanking.matches[0]?.score, maxRanking.matches[0]?.score]));
  check('multiview: a document with an empty title/keywords view is scored, not skipped',
    maxRanking.matches.some((m) => m.path === '数学/普通笔记.md'));
  check('multiview: the boundary gate still excludes under max-pooling', (() => {
    const bounded = docs.map((doc) => (doc.rel.endsWith('rec-multiview.md') ? { ...doc, boundary: '成本非二次、非绝对连续' } : doc));
    const gated = rankRecallDocuments(bounded, '非绝对连续 唯一标题词', { limit: 5, viewPool: 'max' });
    return gated.matches.every((m) => m.path !== '.deepseek/memory/records/rec-multiview.md')
      && gated.excluded.some((entry) => entry.path === '.deepseek/memory/records/rec-multiview.md' && entry.boundaryHits.includes('非绝对连续'));
  })());
}

// ── the audit ledger: a cross-run record, not a second report ───────────────
// WikiSkill (arXiv:2608.27454 §3.2.4; spec docs/memory/design.md §8.1). The point
// of the ledger is that "flagged for eleven days" must not read like "new today",
// so these assertions are about the IDENTITY of a recommendation across runs.
{
  const ledgerRoot = mkdtempSync(join(tmpdir(), 'dsh-ledger-'));
  const ledgerCache = join(ledgerRoot, '.deepseek', 'cache');
  const ledgerRecords = join(ledgerRoot, '.deepseek', 'memory', 'records');
  mkdirSync(ledgerRecords, { recursive: true });
  mkdirSync(ledgerCache, { recursive: true });
  writeFileSync(join(ledgerRecords, 'weak-card.md'), card([
    '---',
    'title: 弱卡',
    'type: artifact',
    'status: active',
    'updated: 2026-01-01',
    'hook:',
    '  operator: probability',
    '  pattern: weak_pattern',
    '  uses: 4',
    '  success_rate: 0.2',
    '  verified: single-source',
    '---',
    '',
    '# 弱卡'
  ]));
  const ledgerHelpers = { parseHookFrontmatter, tokenize, maintainHookStats: false };
  const ledgerPath = join(ledgerCache, 'audit-ledger.jsonl');
  const readLedger = () => readFileSync(ledgerPath, 'utf8').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));

  const first = buildAuditReport(ledgerRoot, ledgerHelpers);
  const firstLines = readLedger();
  check('ledger: the first audit records its recommendations',
    first.ledger.newCount >= 1 && firstLines.length === first.ledger.written && firstLines.length >= 1,
    JSON.stringify(first.ledger));
  check('ledger: a recommendation carries object+action+criterion+firstSeen+count',
    firstLines.every((entry) => typeof entry.object === 'string' && typeof entry.action === 'string'
      && typeof entry.criterion === 'string' && typeof entry.firstSeen === 'string' && entry.count >= 1),
    JSON.stringify(firstLines[0]));
  // Identity must EXCLUDE the evidence numbers: a changed `uses` count is the SAME
  // recommendation. This is asserted through observable behaviour, NOT by inspecting
  // the signature array — an earlier version of this assertion looked at the
  // signature's first three elements, so a mutation that appended `evidence` to the
  // signature passed it unchanged (a guard that could not fail, found by mutation
  // verification). Identity is asserted through OBSERVABLE behaviour in the
  // "changing only the evidence numbers" case below.
  // Same day, second audit: still "new today" (nothing has had time to carry over).
  const again = buildAuditReport(ledgerRoot, ledgerHelpers);
  check('ledger: a second same-day audit still reports the item as new, not carried over',
    again.ledger.newCount === first.ledger.newCount && again.ledger.carriedCount === 0,
    JSON.stringify(again.ledger));
  check('ledger: a same-day re-run does not grow the file',
    readLedger().length === firstLines.length,
    `${readLedger().length} vs ${firstLines.length}`);

  // Simulate an earlier day by backdating the file (the audit stamps `today` from
  // the local clock; the ledger's own `today` field is what the reader trusts).
  writeFileSync(ledgerPath, readLedger().map((entry) => JSON.stringify({ ...entry, today: '2026-01-01', firstSeen: '2026-01-01' })).join('\n') + '\n', 'utf8');
  const nextDay = buildAuditReport(ledgerRoot, ledgerHelpers);
  check('ledger: a recommendation already on the ledger is reported as carried over, not new',
    nextDay.ledger.newCount === 0 && nextDay.ledger.carriedCount >= 1,
    JSON.stringify(nextDay.ledger));
  check('ledger: the carried-over item keeps its original firstSeen (the point of the ledger)',
    nextDay.ledger.firstSeenMin === '2026-01-01' && nextDay.report.includes('此前已在账'),
    `${nextDay.ledger.firstSeenMin}`);
  check('ledger: the model checklist states it is not a new problem',
    nextDay.report.includes('不是新问题'), nextDay.report.slice(0, 200));

  // The identity property, through observable behaviour: rewrite the card so the
  // EVIDENCE numbers change while (object, action, criterion) stay the same. The
  // recommendation must remain a carry-over — this is what a signature that included
  // `evidence` would break, which is exactly the mutation the old assertion missed.
  writeFileSync(join(ledgerRecords, 'weak-card.md'), card([
    '---', 'title: 弱卡', 'type: artifact', 'status: active', 'updated: 2026-01-01',
    'hook:', '  operator: probability', '  pattern: weak_pattern',
    '  uses: 6', '  success_rate: 0.35', '  verified: single-source', '---', '', '# 弱卡'
  ]), 'utf8');
  const evidenceChanged = buildAuditReport(ledgerRoot, ledgerHelpers);
  check('ledger: changing only the evidence numbers keeps the item carried over (a changed uses count is not a new problem)',
    evidenceChanged.ledger.newCount === 0 && evidenceChanged.ledger.carriedCount >= 1
    && evidenceChanged.ledger.firstSeenMin === nextDay.ledger.firstSeenMin,
    `${JSON.stringify(evidenceChanged.ledger)} vs firstSeen ${nextDay.ledger.firstSeenMin}`);

  // The off switch must be a real switch, and it must NOT consume history: with the
  // ledger disabled the audit still reports the same carried-over facts (they come
  // from reading the file, not from the write path), writes nothing, and a later
  // enabled run still sees the item as carried over.
  const disabled = buildAuditReport(ledgerRoot, { ...ledgerHelpers, maintainLedger: false });
  check('ledger: maintainLedger:false reports the same judgements but writes nothing',
    disabled.ledger.disabled === true && disabled.ledger.written === 0
    && disabled.ledger.carriedCount === nextDay.ledger.carriedCount
    && disabled.ledger.newCount === nextDay.ledger.newCount,
    JSON.stringify(disabled.ledger));
  const afterDisabled = buildAuditReport(ledgerRoot, ledgerHelpers);
  check('ledger: a disabled run did not consume the history (the next enabled run still sees it carried)',
    afterDisabled.ledger.carriedCount === nextDay.ledger.carriedCount && afterDisabled.ledger.newCount === 0,
    JSON.stringify(afterDisabled.ledger));
  check('ledger: the disabled notice reaches the model checklist',
    disabled.report.includes('台账已关闭'), disabled.report.slice(0, 160));
  rmSync(ledgerRoot, { recursive: true, force: true });
}

// ── the weak-section self-check must be able to FAIL ────────────────────────
// Extracted so it can be fed the inconsistent shape the audit's own filter cannot
// produce: `weak` is built from `uses >= 3 && rate <= 0.4`, so an inline check had
// no reachable failing input.
{
  check('audit self-check: a weak card with uses below the threshold is reported as inconsistent',
    inconsistentWeakCards([{ rel: 'a.md', uses: 0, successRate: 0.1 }]).join(',') === 'a.md');
  check('audit self-check: a weak card above the rate threshold is reported as inconsistent',
    inconsistentWeakCards([{ rel: 'b.md', uses: 5, successRate: 0.9 }]).join(',') === 'b.md');
  check('audit self-check: a genuinely weak card is not flagged (the check does not cry wolf)',
    inconsistentWeakCards([{ rel: 'c.md', uses: 5, successRate: 0.2 }]).length === 0);
}

// ── index-line descriptions: "in the index" is not enough ───────────────────
// WikiSkill (arXiv:2608.27454 Appendix E.2) calls the index line the most important
// part of the knowledge base: it is what decides whether a reader opens the card.
// The floor is about LENGTH (a machine cannot judge whether a sentence explains WHY).
{
  check('index lint: a bare link with no description is an empty description',
    indexDescriptionIssue('- [[rec-a]]') === 'empty-description');
  check('index lint: a link with an empty piped summary is an empty description',
    indexDescriptionIssue('- [[rec-a|]] · topic · updated: 2026-01-01') === 'empty-description');
  check('index lint: a one-character summary is too short to judge relevance by',
    indexDescriptionIssue('- [[rec-a|?]] · topic') === 'short-description');
  check('index lint: a summary that states the method passes',
    indexDescriptionIssue('- [[rec-a|用 Borel-Cantelli 子列法证 a.s. 收敛]] · probability') === null);
  check('index lint: the README line that documents the format is not itself an entry',
    indexDescriptionIssue('> 格式：`- [[rec-slug|一句话]] · topic · updated: YYYY-MM-DD`') === 'not-an-entry');
  check('index lint: prose and headings are not entries',
    indexDescriptionIssue('## fact（事实）') === 'not-an-entry' && indexDescriptionIssue('- 暂无') === 'not-an-entry');

  // End to end: a card listed with a useless one-liner must be reported as a weak
  // index line — and NOT also as "missing from the index" (one finding per card).
  const idxRoot = mkdtempSync(join(tmpdir(), 'dsh-indexlint-'));
  mkdirSync(join(idxRoot, '.deepseek', 'memory', 'records'), { recursive: true });
  writeFileSync(join(idxRoot, '.deepseek', 'memory', 'records', 'rec-thin.md'), card([
    '---', 'title: 说明过短的卡', 'type: fact', 'status: active', 'updated: 2026-01-01',
    'source: "[[2026-01-01-ep]]"', '---', '', '# 说明过短的卡'
  ]));
  writeFileSync(join(idxRoot, '.deepseek', 'memory', 'records', 'index.md'), card([
    '# 记忆记录索引（按类型分组）',
    '',
    '> AI 维护：每条记录一行；格式：`- [[rec-slug|一句话]] · topic · updated: YYYY-MM-DD`',
    '',
    '## fact（事实）',
    '',
    '- [[rec-thin|?]] · 数论 · updated: 2026-01-01',
    ''
  ]));
  const idxReport = buildAuditReport(idxRoot, { parseHookFrontmatter, tokenize, maintainHookStats: false });
  check('index lint: the audit reports a card whose index line says nothing',
    idxReport.structural.indexWeak === 1 && idxReport.sections.indexWeak[0]?.rel === '.deepseek/memory/records/rec-thin.md',
    JSON.stringify(idxReport.structural));
  check('index lint: that card is NOT also reported as missing from the index',
    idxReport.structural.notInIndex === 0, JSON.stringify(idxReport.structural));
  check('index lint: the model checklist names the problem and how to fix it',
    idxReport.report.includes('索引行说明过弱') && idxReport.report.includes('什么困难'), idxReport.report.slice(0, 240));
  check('index lint: the finding enters the audit ledger like any other recommendation',
    idxReport.ledger.newCount >= 1
    && readFileSync(join(idxRoot, '.deepseek', 'cache', 'audit-ledger.jsonl'), 'utf8').includes('improve-index-line'),
    JSON.stringify(idxReport.ledger));
  rmSync(idxRoot, { recursive: true, force: true });
}

// ── a budget cut must be announced, not silent ───────────────────────────────
// The trailing `…` alone cannot carry this: prose legitimately ends with an ellipsis
// (the audit's own human lines do), so "ends with …" cannot distinguish "budget cut
// this" from "the text is like that". WikiSkill (arXiv:2608.27454 Appendix C) caps
// every injected log at 15,000 characters and writes an explicit truncation marker.
{
  const short = 'y'.repeat(100);
  const long = `论证 ${'z'.repeat(400)}`;
  check('clip: text within the budget is returned byte-for-byte unchanged',
    clip(short, 140) === short);
  check('clip: a cut is announced, with the ORIGINAL length (not just "something was cut")',
    clip(long, 140).includes(`截断：全文 ${long.length} 字符`), clip(long, 140).slice(-40));
  check('clip: the kept CONTENT stays within the budget (only the marker is added)',
    clip(long, 140).length - ' ……［截断：全文 403 字符，此处非全文，用 read/grep 取原文件］'.length <= 140,
    `${clip(long, 140).length} vs budget 140 + fixed marker`);
  check('clip: the ellipsis convention is preserved for existing readers',
    clip(long, 140).includes(' …'), clip(long, 140).slice(-60));

  // End to end: a card body larger than the injected tier budget must carry the
  // marker in the assembled memory section — a rejected budget silently pretending
  // to be the whole document is the failure this guards.
  const clipRoot = mkdtempSync(join(tmpdir(), 'dsh-clip-'));
  mkdirSync(join(clipRoot, '.deepseek', 'memory', 'topics'), { recursive: true });
  writeFileSync(join(clipRoot, '.deepseek', 'memory', 'topics', 'index.md'),
    `# 主题索引\n\n${'主题正文 '.repeat(1200)}\n`, 'utf8');
  const section = buildMemorySection({ vaultRoot: clipRoot, sessionsRoot: join(clipRoot, 'sessions') }, null, null, undefined, undefined);
  check('clip: the assembled memory section announces that a layer was truncated',
    section.includes('截断：全文'), section.slice(-120));
  rmSync(clipRoot, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`__CHECKS__ ${results.length - failed}/${results.length}`);
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);