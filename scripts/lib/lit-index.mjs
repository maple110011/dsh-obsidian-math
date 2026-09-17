/**
 * scripts/lib/lit-index.mjs — the literature index's status/staleness logic.
 *
 * WHY this is a module rather than inline in `lit-import.mjs`: it is the part of the
 * importer that can be WRONG in a way nobody notices. `literature/index.md`'s status
 * column is generated, and it used to come from the entry's machine default
 * (`unread`, stamped when a card was first created) while `cards/*.md` are PRESERVED
 * across imports — so every card in this library was in fact distilled while the
 * index said 未读 for all of them. `docs/literature.md` recorded that mismatch as a
 * known phenomenon, and nothing failed when it happened.
 *
 * Keeping the logic here lets a gate import it IN-PROCESS. That matters: this
 * repository's sandbox forbids capturing a child process's output (spawn/exec with
 * piped stdio → EPERM), so a wrapper that shells out to `lit-import.mjs --self-test`
 * cannot run as a gate here. An importable module has no such limitation.
 */

/** Human label for a card status. */
export function statusLabel(status) {
  const map = { 'to-process': '待转换', 'unread': '未读', 'reading': '研读中', 'distilled': '已蒸馏', 'archived': '已归档' };
  return map[status] || status;
}

/**
 * The reading status a card ACTUALLY declares, plus how long it has been there.
 *
 * Reads the card, not the index entry: cards survive re-import, so the machine
 * default written at first import is not the truth about any card the user has since
 * worked on.
 *
 * The date comes from the card's own `研读状态` section (`- 状态更新：YYYY-MM-DD`),
 * a HUMAN-maintained field rather than a machine one. File mtime would report on git
 * checkouts, and `.raw/` is gitignored and regenerated, so neither can date a piece
 * of reading — and inventing a date would manufacture a reminder.
 *
 * `{ status: null, days: null }` when the card is absent, so the caller keeps the
 * machine default for a fresh import.
 */
export function cardProgress(cardText, today = new Date()) {
  if (typeof cardText !== 'string' || cardText === '') return { status: null, days: null };
  const status = /^status:\s*["']?([a-z-]+)["']?\s*$/m.exec(cardText)?.[1] ?? null;
  const date = /^\s*-\s*状态更新：\s*(\d{4})-(\d{2})-(\d{2})\s*$/m.exec(cardText);
  let days = null;
  if (date !== null) {
    const then = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    days = Math.floor((today.getTime() - then.getTime()) / 86400000);
  }
  return { status, days };
}

/** Days after which a card counts as stalled, by status. */
export const STALE_DAYS = { unstarted: 7, inProgress: 30 };

/** Whether a card has sat in its status long enough to be worth a reminder. */
export function isStalled(status, days) {
  if (days === null || days === undefined || !Number.isFinite(days)) return false;
  const unstarted = status === 'unread' || status === 'to-process';
  return days >= (unstarted ? STALE_DAYS.unstarted : STALE_DAYS.inProgress);
}

/** Status cell: the real status, stamped in place when it has stalled. */
export function statusCell(status, days) {
  const label = statusLabel(status);
  return isStalled(status, days) ? label + '（已停 ' + days + ' 天）' : label;
}

/** Render the generated index table (plus a staleness note when anything stalled). */
export function renderIndexBlock(rows) {
  const L = [];
  L.push('| 状态 | 文献 | 作者 | 年份 | 关键词 |');
  L.push('|---|---|---|---|---|');
  for (const r of rows) {
    const a = (r.authors[0] || '') + (r.authors.length > 1 ? ' 等' : '');
    const tags = (r.keywords ? r.keywords.split(/[,;]/)[0] : '') || '—';
    L.push('| ' + statusCell(r.status, r.days ?? null) + ' | [' + r.title + '](cards/' + r.citekey + '.md) | ' + a + ' | ' + r.year + ' | ' + tags + ' |');
  }
  const stalled = rows.filter((r) => isStalled(r.status, r.days ?? null));
  if (stalled.length > 0) {
    L.push('');
    L.push('**陈旧提醒**（' + stalled.length + ' 篇）：按状态分别以 ' + STALE_DAYS.unstarted + ' 天（未读/待转换）或 '
      + STALE_DAYS.inProgress + ' 天（研读中）为界，说明它们已经停在那里很久。'
      + '处置建议：继续读（更新 `- 状态更新：`）、降级为略读、或补完笔记后置为已蒸馏。');
  }
  return L.join('\n');
}
