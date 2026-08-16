// Zero-cost deterministic regression check for the memory v2 pipeline.
// This is NOT a benchmark: it never calls a model and spends no tokens.
// It builds a tiny synthetic vault in a temp directory, runs the same pure
// functions the preset uses (hook parsing, two-stage retrieval scoring, and
// the daily audit pass), and asserts their observable behavior. Real-world
// quality is tracked through passive usage signals instead (see
// docs/memory/v2-proposal.md §6).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseHookFrontmatter,
  tokenize,
  computeDocFreq,
  weightedOverlap,
  cacheEntryFresh
} from '../dsh/preset/obsidian-notes.mjs';
import {
  buildAuditReport,
  buildRecallIndex,
  rankRecall,
  memoDigest,
  latestUserText,
  pairMessages,
  cacheIndexValid,
  buildMemorySection,
  parseCapturePolicy
} from '../dsh/preset/obsidian-memory.mjs';

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
  '.deepseek/memory/records/rec-a.md': { uses: 1, last_used: '2026-08-16' }
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

// ── 5. deterministic hook-stats sync ────────────────────────────────────────
const recA = readFileSync(join(recordsDir, 'rec-a.md'), 'utf8');
check('sync: stats merged into hook.uses', /uses:\s*1/.test(recA), recA.match(/uses:\s*\d+/)?.[0] ?? 'none');
check('sync: last_used from stats', recA.includes('last_used: 2026-08-16'));
const recD = readFileSync(join(recordsDir, 'rec-d.md'), 'utf8');
check('sync: never-used card gets no invented last_used', !recD.includes('last_used'));

// ── 6. memory v2 recall injection (B) ──────────────────────────────────────
const recallHelpers = { tokenize, weightedOverlap, computeDocFreq };
const recallDocs = buildRecallIndex(root, { parseHookFrontmatter, tokenize });
check('recall: index contains cards', recallDocs.some((doc) => doc.kind === 'card' && doc.rel.includes('rec-a')));
const recallText = rankRecall(recallDocs, '证明独立随机变量和 a.s. 收敛 子序列 Borel-Cantelli', recallHelpers, 6, 2200);
check('recall: relevant card ranked', recallText.includes('rec-a'));
check('recall: bounded by maxChars', recallText.length <= 2200);
const capped = rankRecall(recallDocs, '证明 a.s. 收敛', recallHelpers, 2, 200);
check('recall: topK respected', capped.length <= 240);

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

// ── 9. B1: stats zeroed after merge ─────────────────────────────────────────
const statsAfter = JSON.parse(readFileSync(join(cacheDir, 'retrieval-stats.json'), 'utf8'));
check('B1: stats zeroed after merge', statsAfter['.deepseek/memory/records/rec-a.md']?.uses === 0);

// ── 10. D: cache freshness helper ───────────────────────────────────────────
check('cacheEntryFresh', cacheEntryFresh({ mtimeMs: 1, size: 2, raw: 'x' }, 1, 2) === true && cacheEntryFresh({ mtimeMs: 1, size: 2, raw: 'x' }, 1, 3) === false);

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
check('links: /open template carries t=', linkSection.includes('/open?path=<vault 相对路径，需 URL 编码>&t=test-token-42)'));
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

rmSync(root, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);