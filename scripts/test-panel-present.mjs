/**
 * test-panel-present — the presentation layer's PURE decisions, tested.
 *
 * Why this file exists
 * --------------------
 * `main.js` is the file every user actually installs, and its presentation layer
 * had *zero* automated tests: the badge/meta composition, the "⚠️ 待处理" block's
 * counting rule and the layer fallback were verified by hand only (review P1-3).
 * The data layer below it is covered (`test-memory.mjs` §30/§31), but "the panel
 * shows the wrong thing" was untestable.
 *
 * Two things make it testable without Obsidian:
 *   1. `MemoryView` keeps its decisions in four methods that take plain data and
 *      return plain data/strings — `layerEntries`, `pendingItems`, `cardMeta`,
 *      `trendText`. Everything DOM-shaped lives in the *callers* of these.
 *   2. This file reads those methods out of the REAL template source and
 *      evaluates them. Not a copy: if someone renames or moves them the
 *      extraction fails loudly, which is the point — a test that silently stops
 *      testing is worse than no test.
 *
 * It does NOT test the DOM calls (`createDiv`/`createEl`), the Obsidian API, or
 * `daysSinceText`'s date arithmetic (that lives in `memory-admin.mjs` and is
 * covered by the memory suite). What it covers is the part that can be wrong
 * while everything else is right: which parts get shown, in what order, and when
 * a segment must be omitted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { daysSinceText as realDaysSinceText } from '../dsh/host/memory-admin.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: ok === true });
  console.log(`[${ok === true ? 'ok' : 'FAIL'}] ${name}${detail === '' ? '' : ' ' + detail}`);
};

// ── extract the real source of the four pure methods ────────────────────────
const template = readFileSync(`${root}obsidian/main.template.js`, 'utf8');
const lines = template.split(/\r?\n/);

/**
 * The template formats every class method at exactly two-space indentation, so a
 * method runs until the next two-space `name(...) {` line. We slice that way
 * instead of counting braces, then verify the slice really is balanced — if the
 * formatting changes, this throws instead of testing half a method.
 */
function extractMethod(name) {
  const head = new RegExp(`^  ${name}\\([^)]*\\)\\s*\\{$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) throw new Error(`MemoryView.${name} not found — the presentation seam moved; update this test`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [A-Za-z_$][\w$]*\([^)]*\)\s*\{$/.test(lines[i])) { end = i; break; }
    if (/^}/.test(lines[i])) { end = i; break; }
  }
  const text = lines.slice(start, end).join('\n').replace(/,\s*$/, '');
  const opens = (text.match(/\{/g) ?? []).length;
  const closes = (text.match(/\}/g) ?? []).length;
  if (opens !== closes) throw new Error(`extracted MemoryView.${name} is unbalanced (${opens} { vs ${closes} }) — the slice is wrong`);
  return text;
}

function extractConst(name) {
  const start = lines.findIndex((l) => new RegExp(`^const ${name} = \\{`).test(l));
  if (start < 0) throw new Error(`const ${name} not found in the template`);
  // Single-line AND multi-line object literals both occur here
  // (`CARD_STATUS_TEXT` is one line, `VERIFIED_BADGES` is several), so balance
  // the braces as they accumulate rather than looking for a `};` line.
  let text = '';
  for (let i = start; i < lines.length; i += 1) {
    text += (i === start ? '' : '\n') + lines[i];
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    if (opens > 0 && opens === closes) return text.replace(/;\s*$/, '');
  }
  throw new Error(`const ${name} is unterminated`);
}

const METHODS = ['layerEntries', 'pendingItems', 'cardMeta', 'trendText'];

let view = null;
try {
  const body = METHODS.map(extractMethod).join(',\n');
  // `daysSinceText` is injected EXACTLY as the template aliases it
  // (`const daysSinceText = MEMORY_ADMIN.daysSinceText`, line ~1727), so the
  // wiring is exercised, not mocked away.
  const factory = new Function(
    'VERIFIED_BADGES', 'CARD_STATUS_TEXT', 'daysSinceText',
    `return {\n${body}\n};`
  );
  view = factory(
    new Function(`${extractConst('VERIFIED_BADGES')}\nreturn VERIFIED_BADGES;`)(),
    new Function(`${extractConst('CARD_STATUS_TEXT')}\nreturn CARD_STATUS_TEXT;`)(),
    realDaysSinceText
  );
} catch (error) {
  console.log(`[FAIL] could not extract the presentation seam: ${String(error.message ?? error)}`);
  process.exit(1);
}
for (const name of METHODS) {
  if (typeof view[name] !== 'function') {
    console.log(`[FAIL] extracted seam is missing ${name}`);
    process.exit(1);
  }
}
check('present: the four pure decisions are reachable from the real template source', true);

// ── layerEntries: which layers the panel renders ────────────────────────────
{
  const five = view.layerEntries({
    layers: {
      records: { label: '记录', dir: '.deepseek/memory/records', cards: [{ rel: 'a' }] },
      topics: { label: '主题', dir: '.deepseek/memory/topics', cards: [] },
      theorems: { label: '定理', dir: '', cards: [] },
      templates: { label: '模板', dir: '', cards: [] },
      strategy: { label: '策略', dir: '', cards: [] }
    }
  });
  check('present: all five card layers are rendered when the data layer provides them',
    five.length === 5 && five[0].key === 'records' && five[2].key === 'theorems' && five[4].key === 'strategy',
    JSON.stringify(five.map((l) => l.key)));

  const malformed = view.layerEntries({ layers: { records: null, topics: 'nope' } });
  check('present: a malformed layer entry degrades to key-only instead of throwing',
    malformed.every((l) => typeof l.label === 'string' && l.label !== '' && Array.isArray(l.cards)),
    JSON.stringify(malformed));

  const legacy = view.layerEntries({ records: [{ rel: 'r' }] });
  check('present: without a `layers` map the panel falls back to records + templates',
    legacy.length === 2 && legacy[0].key === 'records' && legacy[1].key === 'templates'
    && legacy[0].cards.length === 1 && legacy[0].label === '记录',
    JSON.stringify(legacy.map((l) => l.key)));

  const empty = view.layerEntries({ layers: {}, records: 'not-an-array' });
  check('present: an empty `layers` map also falls back, and a non-array card list becomes []',
    empty.length === 2 && empty[0].cards.length === 0 && empty[1].cards.length === 0);
}

// ── pendingItems: the "⚠️ 待处理" counting rule ──────────────────────────────
{
  const none = view.pendingItems(null);
  check('present: a null audit yields no pending block at all',
    none.total === 0 && none.pendingReview.length === 0 && none.archiveCandidates.length === 0);

  const listed = view.pendingItems({
    sections: { pendingReview: [{ rel: 'a' }], archiveCandidates: [{ rel: 'b' }, { rel: 'c' }] }
  });
  check('present: without a declared total, the listed rows are the total',
    listed.total === 3 && listed.pendingReview.length === 1 && listed.archiveCandidates.length === 2);

  const declaredWins = view.pendingItems({
    sections: { pendingReview: [{ rel: 'a' }] },
    decisions: { total: 5 }
  });
  check('present: `decisions.total` wins when it is larger (it also counts unlisted duplicates)',
    declaredWins.total === 5);

  const staleTotal = view.pendingItems({
    sections: { pendingReview: [{ rel: 'a' }, { rel: 'b' }] },
    decisions: { total: 1 }
  });
  check('present: a STALE smaller total never hides a listed row',
    staleTotal.total === 2, `total=${staleTotal.total}`);

  const sectionsGone = view.pendingItems({ decisions: { total: 4 } });
  check('present: a report whose sections are missing shows no block (total 0), even with a declared total',
    sectionsGone.total === 0, `total=${sectionsGone.total}`);
}

// ── cardMeta: which segments appear, in what order ──────────────────────────
{
  const full = view.cardMeta.call(view, {
    type: 'theorem', operator: 'probability', topic: '集中不等式', verified: 'user-confirmed',
    status: 'candidate', uses: 4, harmed: 2, successRate: 0.8, lastUsed: '2026-09-01',
    updated: '', history: []
  });
  check('present: a full card renders type · operator · #topic · badge · status · uses · harmed · rate · lastUsed',
    full === 'theorem · probability · #集中不等式 · ✅ · 候选 · 用过 4 次 · ⚠️ 倒忙 2 次 · 成功率 0.8 · 上次 2026-09-01',
    full);

  const bare = view.cardMeta.call(view, {
    type: '', operator: '', topic: '', verified: '', status: 'active', uses: 0, updated: '', history: []
  });
  check('present: a card with nothing but defaults still shows a badge and "从未用过"',
    bare === '❓ · 从未用过', bare);

  // The presenter must survive a PARTIAL card. Before this test existed the
  // guards were `!== ''`, which lets `undefined` through and rendered the
  // literal text `上次 undefined`.
  const partial = view.cardMeta.call(view, { uses: 1 });
  check('present: missing optional fields never render the text "undefined"',
    partial === '❓ · 用过 1 次' && !partial.includes('undefined'), partial);

  const clean = view.cardMeta.call(view, {
    type: 'fact', operator: '', topic: '', verified: 'single-source', status: 'active',
    uses: 1, harmed: 0, successRate: null, lastUsed: '', updated: '', history: []
  });
  check('present: `harmed: 0` and a null success rate add NO segment (a permanent "倒忙 0 次" would read as data)',
    clean === 'fact · ❓ · 用过 1 次', clean);

  const superseded = view.cardMeta.call(view, {
    type: '', operator: '', topic: '', verified: 'cross-referenced', status: 'superseded',
    uses: 0, updated: '', history: []
  });
  check('present: a non-active status is spelled out in Chinese, an active one is omitted',
    superseded.includes('已过期') && !superseded.includes('active'), superseded);
}

// ── trendText: no trend unless there is real history ────────────────────────
{
  check('present: fewer than two history points means no trend',
    view.trendText.call(view, { history: [{ uses: 1 }] }) === '');
  check('present: an all-zero history means no trend (a bare 📈 0→0 says nothing)',
    view.trendText.call(view, { history: [{ uses: 0 }, { uses: 0 }, { uses: 0 }] }) === '');
  const trend = view.trendText.call(view, {
    history: [{ uses: 0 }, { uses: 1, successRate: 0.5 }, { uses: 2 }, { uses: 3 }, { uses: 4 }, { uses: 5 }]
  });
  check('present: the trend keeps the LAST five points only, and marks success rates with @',
    trend === '📈 1@0.5→2→3→4→5', trend);
  check('present: non-object history entries are ignored instead of throwing',
    view.trendText.call(view, { history: [null, 'x', { uses: 1 }, { uses: 2 }] }) === '📈 1→2');
}

// ── the wiring this test relies on is real ──────────────────────────────────
check('present: `daysSinceText` really is exported by the embedded host module (the template aliases it)',
  typeof realDaysSinceText === 'function');

const failed = results.filter((r) => !r.ok).length;
console.log(`__CHECKS__ ${results.length - failed}/${results.length}`);
process.exit(failed === 0 ? 0 : 1);
