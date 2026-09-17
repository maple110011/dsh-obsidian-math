/**
 * scripts/test-lit-import.mjs — gate for the literature index's status/staleness logic.
 *
 * WHY this is a gate: `literature/index.md`'s status column is GENERATED, and it used
 * to come from the entry's machine default (`unread`, stamped when a card was first
 * created) while `cards/*.md` are PRESERVED across imports. So every card in this
 * library was in fact distilled while the index said 未读 for all of them.
 * `docs/literature.md` recorded that mismatch as a known phenomenon, and nothing
 * failed when it happened — nothing would fail if it came back either.
 *
 * The logic lives in `scripts/lib/lit-index.mjs` and is imported here, so this suite
 * runs IN-PROCESS: no child process, no fixture vault, no source directory. That is
 * deliberate — this repo's sandbox forbids capturing a subprocess's piped output
 * (spawn/exec → EPERM), so a gate that shelled out to the importer could not run here
 * at all. An earlier version of this file did exactly that and failed with EPERM.
 *
 * Mutation verification (AGENTS.md §6):
 *   - make `cardProgress` return `{ status: null, days: null }` unconditionally
 *     → "the card status is read" and "the index renders the real status" fail;
 *   - make `isStalled` return false always
 *     → the two staleness checks fail;
 *   - drop the `cardText.includes` style date guard (return a day count when no date
 *     matched) → "a card with no date is NOT flagged" fails.
 */
import { cardProgress, renderIndexBlock, statusCell, statusLabel, isStalled, STALE_DAYS } from './lib/lit-index.mjs';

let failed = 0;
let total = 0;
const check = (label, cond, detail = '') => {
  total += 1;
  if (cond) { console.log(`[ok] ${label}${detail ? ' | ' + detail : ''}`); return; }
  failed += 1;
  console.log(`[FAIL] ${label}${detail ? ' | ' + detail : ''}`);
};

const card = (fields) => ['---', ...fields, '---', '', '## 研读状态', ''].join('\n');
const OLD = '2020-01-01';

// ── the status must come from the CARD, not the entry's machine default ──────
const distilled = cardProgress(card(['status: distilled', '- 状态：distilled', `- 状态更新：${OLD}`]));
check('status: the card status is read, not the machine default',
  distilled.status === 'distilled', JSON.stringify(distilled));
check('status: the label maps a known status to Chinese',
  statusLabel('distilled') === '已蒸馏' && statusLabel('reading') === '研读中',
  statusLabel('distilled'));

// ── staleness: flagged when genuinely old, and never invented ───────────────
const reading = cardProgress(card(['status: reading', '- 状态：reading', `- 状态更新：${OLD}`]));
check('stale: a long-stalled in-progress card is flagged',
  isStalled(reading.status, reading.days) && statusCell(reading.status, reading.days).includes('已停'),
  statusCell(reading.status, reading.days));

const undated = cardProgress(card(['status: unread', '- 状态：unread']));
check('stale: a card with NO progress date is not flagged (no invented reminder)',
  undated.days === null && !isStalled(undated.status, undated.days) && statusCell(undated.status, undated.days) === '未读',
  JSON.stringify(undated));

const fresh = cardProgress(card(['status: unread', `- 状态更新：${new Date().toISOString().slice(0, 10)}`]));
check('stale: a card touched today is not flagged',
  !isStalled(fresh.status, fresh.days), JSON.stringify(fresh));
check('stale: the two thresholds differ by whether the reading has started',
  STALE_DAYS.unstarted === 7 && STALE_DAYS.inProgress === 30
  && !isStalled('unread', STALE_DAYS.unstarted - 1) && isStalled('unread', STALE_DAYS.unstarted)
  && !isStalled('reading', STALE_DAYS.inProgress - 1) && isStalled('reading', STALE_DAYS.inProgress),
  JSON.stringify(STALE_DAYS));

// ── a fresh import keeps the machine default ────────────────────────────────
check('fresh: a missing card leaves the machine default intact',
  JSON.stringify(cardProgress('')) === JSON.stringify({ status: null, days: null })
  && JSON.stringify(cardProgress(undefined)) === JSON.stringify({ status: null, days: null }),
  JSON.stringify(cardProgress('')));

// ── the rendered block ─────────────────────────────────────────────────────
const block = renderIndexBlock([
  { citekey: 'a', title: 'T1', authors: ['甲'], year: '2026', keywords: 'k', status: 'distilled', days: distilled.days },
  { citekey: 'b', title: 'T2', authors: ['乙', '丙'], year: '2026', keywords: 'k', status: reading.status, days: reading.days }
]);
check('index: the real status and the staleness stamp both reach the table',
  block.includes('已蒸馏') && block.includes('已停') && block.includes('cards/a.md'),
  block.split('\n')[2] || '');
check('index: the staleness note appears only when something stalled',
  block.includes('陈旧提醒')
  && !renderIndexBlock([{ citekey: 'c', title: 'T3', authors: ['丁'], year: '2026', keywords: 'k', status: 'distilled', days: fresh.days }]).includes('陈旧提醒'),
  block.split('\n').filter((l) => l.includes('陈旧提醒')).join(' / '));
check('index: an author list of more than one gets the 等 suffix',
  block.includes('乙 等'), block.split('\n')[3] || '');

if (failed > 0) {
  console.log(`\n${failed}/${total} checks failed`);
  process.exit(1);
}
console.log(`\n__CHECKS__ ${total}/${total}`);
console.log(`${total}/${total} checks passed`);
