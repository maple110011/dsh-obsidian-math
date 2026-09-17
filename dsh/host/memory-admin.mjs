// dsh/host/memory-admin.mjs — host-agnostic memory administration core.
// Deterministic file operations + panel data collection for the math-memory
// system. Pure node:fs/path, no Obsidian import; both the Obsidian plugin
// (via the embedded loader) and the future dsh host web route consume this.
// Generated from obsidian/main.template.js (single source of truth).

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync,
  openSync, readSync, closeSync
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";

// Receipts shown AFTER a feedback action. They state the object ("this card")
// and the consequence, in the user's language — the old strings said
// "成功率减半" even on a card that had no success_rate (so the number went from
// nothing to 0.25, not "half"), and named internal fields (user-confirmed,
// superseded) the panel never explains. `applyFeedback` returns a message built
// from what it ACTUALLY did; these are the fallbacks for callers that only have
// the action name.
export const FEEDBACK_MESSAGES = {
  confirm: '已确认 ✅ 这张卡的验证等级升为「用户确认」，检索时会排得更靠前。',
  wrong: '已记录 ❌ 这张卡会被降级并在下次体检时重审；文件不会被删除。',
  inapplicable: '已记录 🔁 这张卡在本次场景不适用（不影响它的可信度）。',
  stale: '已标记「已过期」：不再参与检索，文件仍然保留。',
  forget: '已归档：文件移到了 .deepseek/archive/（移动而非删除，可找回）。'
};

/**
 * Case/separator-robust prefix containment (win32 lowercases).
 *
 * This is the same function as the preset's `pathInside`
 * (`dsh/preset/math-memory.mjs`). The two were named differently there
 * (`pathIsInside`), so the engine-sync guard could not see the pair at all —
 * a silent naming divergence on a *security-relevant* helper. Renamed
 * 2026-09-11 so the guard covers them. The type guard was preset-only, which
 * meant this copy threw on a null/absent `child` instead of answering `false`.
 */
export function pathInside(root, child) {
  if (typeof root !== "string" || typeof child !== "string" || root === "" || child === "") return false;
  const norm = (value) => {
    const n = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? n.toLowerCase() : n;
  };
  const r = norm(root);
  const c = norm(child);
  return c === r || c.startsWith(r + "/");
}

/** Join frontmatter lines, dropping the blank line an EMPTY body would leave. */
function joinFrontmatterLines(lines, useCrlf) {
  while (lines.length > 0 && lines[0] === '') lines.shift();
  return lines.join(useCrlf ? '\r\n' : '\n');
}

/**
 * The `not_applicable_when` boundary phrases a rejected query justifies appending.
 *
 * WHY (MSCE, arXiv:2607.16621 §4.3 lifecycle): a user rejection should SHRINK the
 * applicability boundary, not merely halve a success rate. Today a card the user
 * just rejected is still retrievable next time, only ranked lower — recording the
 * context makes the existing boundary gate exclude it outright and *say why*.
 *
 * The context comes from `cache/retrieval-stats.json`'s `last_query`, written by
 * `note_recall`. The link the user clicks carries only a path and an action, so the
 * query has to have been remembered at hit time.
 *
 * Only fragments that are ALREADY IN THE CARD are proposed: those are the words
 * that matched it, which is precisely the context the card is being told it does
 * not cover. Fragments must obey the boundary grammar (`boundarySegments`: 2–12
 * chars, no punctuation) or the gate cannot parse them back — a boundary written as
 * prose gets shredded into fragments and stops working (records/_README.md warns
 * about exactly this). Returns `[]` when there is nothing defensible to add.
 */
function boundaryPhrasesFromQuery(root, filePath) {
  if (typeof root !== 'string' || root === '') return [];
  let query = '';
  try {
    const rel = relative(root, filePath).replace(/\\/g, '/');
    const stats = JSON.parse(readFileSync(join(root, '.deepseek', 'cache', 'retrieval-stats.json'), 'utf8')) ?? {};
    query = String(stats?.[rel]?.last_query ?? '');
  } catch {
    return []; // no cache, no query: there is no context to name
  }
  if (query === '') return [];
  let cardText = '';
  try {
    cardText = readFileSync(filePath, 'utf8').toLowerCase();
  } catch {
    return [];
  }
  const out = [];
  for (const chunk of query.split(/[\s、，,；;。()（）\[\]【】/]+/)) {
    const phrase = chunk.trim();
    if (phrase.length < 2 || phrase.length > 12) continue;
    if (!cardText.includes(phrase.toLowerCase())) continue;
    if (out.includes(phrase)) continue;
    out.push(phrase);
    if (out.length >= 2) break; // keep the boundary short and decidable
  }
  return out;
}

/**
 * Set `field: value` inside a block-style hook block (appends the line when
 * absent). Returns the new frontmatter text, or null when there is no
 * block-style hook (flow-style `hook: { ... }` is left untouched).
 */
export function setHookField(frontmatterText, field, value) {  const lines = frontmatterText.split(/\r?\n/);
  const hookIdx = lines.findIndex((line) => /^hook:\s*$/.test(line));
  if (hookIdx === -1) return null;
  let endIdx = hookIdx + 1;
  while (endIdx < lines.length && (lines[endIdx].trim() === '' || /^\s/.test(lines[endIdx]))) endIdx += 1;
  const block = lines.slice(hookIdx + 1, endIdx);
  let seen = false;
  const pattern = new RegExp('^(\\s*)' + field + ':', '');
  const updated = block.map((line) => {
    const match = pattern.exec(line);
    if (match !== null) { seen = true; return match[1] + field + ': ' + value; }
    return line;
  });
  if (!seen) updated.push('  ' + field + ': ' + value);
  return joinFrontmatterLines(
    [...lines.slice(0, hookIdx + 1), ...updated, ...lines.slice(endIdx)],
    frontmatterText.includes('\r\n')
  );
}

/** Set a top-level (non-indented) frontmatter field, appending when absent. */
export function setTopField(frontmatterText, field, value) {
  const lines = frontmatterText.split(/\r?\n/);
  let seen = false;
  const pattern = new RegExp('^' + field + ':');
  const updated = lines.map((line) => {
    if (!/^\s/.test(line) && pattern.test(line)) { seen = true; return field + ': ' + value; }
    return line;
  });
  if (!seen) updated.push(field + ': ' + value);
  return joinFrontmatterLines(updated, frontmatterText.includes('\r\n'));
}

/**
 * Byte span of a file's leading `---\n…\n---` frontmatter block.
 * @returns `{ start, end, text }` where `text` is `raw.slice(start, end)`, or
 *   null when the file has no frontmatter block.
 */
export function frontmatterSpan(raw) {
  const open = /^---[ \t]*\r?\n/.exec(raw);
  if (open === null) return null;
  const start = open[0].length;
  const close = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw.slice(start));
  if (close === null) return null;
  const end = start + close.index;
  return { start, end, text: raw.slice(start, end) };
}

/**
 * Replace a file's frontmatter with `replacementText`, leaving the rest of the
 * file byte-identical.
 *
 * Splices by the span's offsets instead of `String.replace(spanText, newText)`.
 * Two defects made the replace form wrong here, and both are reachable from the
 * memory panel's ✅/❌ buttons:
 *   1. `String.replace` treats its second argument as a REPLACEMENT STRING, so
 *      `$$`/`$&`/`` $` ``/`$'` inside agent-authored frontmatter are expanded
 *      (`title: 关于 $$ 的表示` became `title: 关于 $ 的表示`; `$&` injected the
 *      whole matched block). A math vault is exactly where `$$` display math
 *      appears in a title. `scripts/build-obsidian.mjs` already documents this
 *      hazard for its own replacements — "Use replacement functions, not
 *      replacement strings".
 *   2. An EMPTY frontmatter body makes the search string `""`, and
 *      `replace("", x)` inserts at offset 0 instead of replacing — the closing
 *      `---` then lands mid-file and the card becomes unparseable, while the
 *      caller is told the write succeeded.
 *
 * The empty body is legitimate (`---\n\n---\nbody`), and `setTopField("")`
 * appends the new key, so the result stays well-formed.
 */
export function replaceFrontmatter(raw, replacementText) {
  const span = frontmatterSpan(raw);
  if (span === null) return null;
  return raw.slice(0, span.start) + replacementText + raw.slice(span.end);
}

/**
 * Update one capture-policy mode in the vault's .deepseek/capture-policy.md
 * (host side, minimal frontmatter diff; also refreshes the updated date).
 * The settings page dropdowns call this so policy edits never need a text
 * editor; the model is still forbidden from touching the file.
 */
export function setCapturePolicyMode(vault, field, mode, fallbackTemplate = '') {
  const policyPath = join(vault, '.deepseek', 'capture-policy.md');
  let text;
  if (existsSync(policyPath)) {
    text = readFileSync(policyPath, 'utf8');
  } else {
    text = fallbackTemplate;
    if (text === '') throw new Error('capture policy template missing');
  }
  const span = frontmatterSpan(text);
  if (span === null) throw new Error('capture-policy.md 没有 frontmatter');
  let frontmatter = setTopField(span.text, field, mode);
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  frontmatter = setTopField(frontmatter, 'updated', today);
  const updated = replaceFrontmatter(text, frontmatter);
  if (updated === null) throw new Error('capture-policy.md 没有 frontmatter');
  writeFileSync(policyPath, updated, 'utf8');
}

/**
 * Append an empty block-style `hook:` block when the card has none, so the
 * feedback actions (which all write hook fields) work on every card.
 *
 * Before this, ✅/❌ on a card without a `hook:` block failed with
 * 「该卡片没有 hook 块」 — and the panels hid the buttons entirely, so the
 * least-evidenced cards were also the only ones that could never be corrected
 * (docs/handoff.md listed it as an open item). Returns null for the
 * flow-style `hook: { … }` form, which we refuse to rewrite blindly.
 */
function ensureHookBlock(frontmatterText) {
  if (/^hook:[ \t]*$/m.test(frontmatterText)) return frontmatterText;
  if (/^hook:[ \t]*\S/m.test(frontmatterText)) return null;
  const sep = frontmatterText.includes('\r\n') ? '\r\n' : '\n';
  const trimmed = frontmatterText.replace(/[\r\n]+$/, '');
  return trimmed === '' ? 'hook:' : `${trimmed}${sep}hook:`;
}

/**
 * Apply one feedback action to a card file (in place, minimal diff).
 * @returns `{ ok, message, action, changed }` — `message` is the receipt the UI
 *   shows, built from what the write actually did.
 */
export function applyFeedback(filePath, action, root = '') {
  const text = readFileSync(filePath, 'utf8');
  const span = frontmatterSpan(text);
  if (span === null) return { ok: false, message: '该文件没有 frontmatter' };
  let frontmatter = span.text;
  // Only the actions that write hook fields need a hook block; `inapplicable`
  // and `stale` write top-level fields and must not restructure the card.
  if (action === 'confirm' || action === 'wrong') {
    const withHook = ensureHookBlock(frontmatter);
    if (withHook === null) return { ok: false, message: '该卡片的 hook 是行内写法，暂不支持自动改写，请手动编辑' };
    frontmatter = withHook;
  }
  const today = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  const notes = [];
  if (action === 'confirm') {
    const verified = setHookField(frontmatter, 'verified', 'user-confirmed');
    if (verified === null) return { ok: false, message: '该卡片没有 hook 块，无法写入验证等级' };
    frontmatter = verified;
    const rateMatch = /^(\s*)success_rate:\s*([0-9.]+)\s*$/m.exec(frontmatter);
    const current = rateMatch === null ? 0 : parseFloat(rateMatch[2]);
    const next = Math.max(Number.isFinite(current) ? current : 0, 0.9);
    const rated = setHookField(frontmatter, 'success_rate', String(next));
    if (rated !== null) frontmatter = rated;
    // A ✅ confirm resolves any prior ❌: clear the re-review flag so the card
    // leaves the pending-review list (self-correction.md P2).
    frontmatter = setTopField(frontmatter, 'needs_review', 'false');
    // Provenance witness (docs/design-intake-2026-09-10.md §1 item 3): raising
    // `verified` above single-source is only legitimate through a user
    // confirmation, and this is the ONE writer of the witness the daily audit
    // checks for. The agent is forbidden to write this field (AGENTS.md).
    const witnessed = setHookField(frontmatter, 'verified_by', 'user');
    if (witnessed !== null) frontmatter = witnessed;
    notes.push(FEEDBACK_MESSAGES.confirm);
  } else if (action === 'wrong') {
    // Demote (self-correction.md P1b): a ❌ means the card's CONTENT is wrong
    // (unlike `inapplicable`, which is context-only). Halve success_rate but
    // cap it below the weak threshold (0.4) so the next audit actually
    // re-evaluates; downgrade the verification level one step so a
    // user-confirmed card does not keep its ✅ badge; and flag needs_review
    // for the deterministic re-review list (self-correction.md P2).
    //
    // success_rate is only touched when the card ALREADY has one: inventing
    // 0.25 for an unrated card turned "no rating" into "a rating that looks
    // measured" (the old receipt then called that "减半"). The demotion and the
    // re-review flag carry the signal for unrated cards.
    const rateMatch = /^(\s*)success_rate:\s*([0-9.]+)\s*$/m.exec(frontmatter);
    if (rateMatch !== null) {
      const base = parseFloat(rateMatch[2]);
      const next = Math.min(Math.max(0.05, Math.round((Number.isFinite(base) ? base : 0.5) * 0.5 * 100) / 100), 0.35);
      const rated = setHookField(frontmatter, 'success_rate', String(next));
      if (rated !== null) frontmatter = rated;
    }
    const verifiedMatch = /^(\s*)verified:\s*["']?(user-confirmed|cross-referenced|single-source)["']?\s*$/m.exec(frontmatter);
    if (verifiedMatch === null) {
      const marked = setHookField(frontmatter, 'verified', 'single-source');
      if (marked !== null) frontmatter = marked;
    } else if (verifiedMatch[2] === 'user-confirmed') {
      frontmatter = frontmatter.replace(verifiedMatch[0], `${verifiedMatch[1]}verified: cross-referenced`);
    } else if (verifiedMatch[2] === 'cross-referenced') {
      frontmatter = frontmatter.replace(verifiedMatch[0], `${verifiedMatch[1]}verified: single-source`);
    }
    // If the level stays above single-source (user-confirmed → cross-referenced)
    // the user's witness no longer covers it: invalidate it so the audit asks for
    // a fresh confirmation instead of silently trusting the old one.
    const levelNow = /^\s*verified:\s*["']?(user-confirmed|cross-referenced|single-source)["']?\s*$/m.exec(frontmatter)?.[1];
    if (levelNow !== undefined && levelNow !== 'single-source') {
      const cleared = setHookField(frontmatter, 'verified_by', 'none');
      if (cleared !== null) frontmatter = cleared;
    }
    // Negative-transfer accounting (docs/design-intake-2026-09-10.md §1 item 2):
    // ❌ is the one signal that says "this was used and it misled". `uses` and
    // `success_rate` cannot express that on their own, and a card that is often
    // used AND often wrong is exactly the one worth rewriting.
    const harmedNow = Number(/^\s*harmed:\s*(\d+)\s*$/m.exec(frontmatter)?.[1] ?? 0);
    const harmed = setHookField(frontmatter, 'harmed', String((Number.isFinite(harmedNow) ? harmedNow : 0) + 1));
    if (harmed !== null) frontmatter = harmed;
    frontmatter = setTopField(frontmatter, 'last_wrong', today);
    frontmatter = setTopField(frontmatter, 'needs_review', 'true');
    notes.push(FEEDBACK_MESSAGES.wrong);
  } else if (action === 'inapplicable') {
    // "Not applicable to this context" is NOT evidence the card is wrong:
    // leave success_rate/verified/status untouched so a correct technique is
    // not degraded by a single misapplication (MemTrapBench "Trauma" trap).
    frontmatter = setTopField(frontmatter, 'last_not_applicable', today);
    // …but it IS evidence about the BOUNDARY, so narrow it (MSCE `shrink`). The
    // narrowing hangs off `inapplicable` and NOT off `wrong`: `wrong` says the
    // content is bad (demote it), while `inapplicable` says the content is fine but
    // this situation is outside its scope — which is exactly what the boundary
    // records. Narrowing on `wrong` would silently rewrite the scope of a card
    // whose scope was never the complaint.
    const phrases = boundaryPhrasesFromQuery(root, filePath);
    if (phrases.length > 0) {
      const declared = /^\s*not_applicable_when:\s*(.*)$/m.exec(frontmatter)?.[1] ?? '';
      const segments = declared.split(/[、，,；;]/).map((part) => part.trim()).filter(Boolean);
      const added = phrases.filter((phrase) => !segments.includes(phrase));
      if (added.length > 0) {
        const next = [...segments, ...added].join('、');
        const inHook = setHookField(frontmatter, 'not_applicable_when', next);
        frontmatter = inHook ?? setTopField(frontmatter, 'not_applicable_when', next);
        notes.push(`适用边界已收窄：+${added.join('、')}（下次这类查询会直接排除这张卡并说明原因）`);
      }
    }
    notes.push(FEEDBACK_MESSAGES.inapplicable);
  } else if (action === 'stale') {
    frontmatter = setTopField(frontmatter, 'status', 'superseded');
    notes.push(FEEDBACK_MESSAGES.stale);
  } else {
    return { ok: false, message: `未知的反馈动作：${String(action)}` };
  }
  const updated = replaceFrontmatter(text, frontmatter);
  if (updated === null) return { ok: false, message: '该文件没有 frontmatter' };
  const changed = updated !== text;
  if (changed) writeFileSync(filePath, updated, 'utf8');
  return { ok: true, action, changed, message: notes.join(' ') };
}

/**
 * Move a memory file into the vault archive (never a hard delete).
 *
 * The source is validated, not assumed: every caller passes a path that came
 * from a request or a scan, and this function is the last gate before a rename.
 * Without the checks below it happily archived a plain user note, renamed a
 * whole `.deepseek/memory/records/` directory into the archive, and even tried
 * to rename the vault root (`rel = ["."]`) — all confirmed against temp
 * fixtures during the 2026-09-10 audit.
 *
 * @returns the archive path, or throws when the source is not an archivable
 *   memory file.
 */
export function archiveMemoryFile(vaultPath, relParts) {
  const parts = Array.isArray(relParts) ? relParts.filter((part) => typeof part === 'string' && part !== '') : [];
  const fileName = parts[parts.length - 1] ?? '';
  const reject = (reason) => { throw new Error(`archiveMemoryFile: refuse to archive (${reason})`); };
  if (parts.length < 3) reject('path must live under .deepseek/<layer>/');
  if (parts.some((part) => part === '.' || part === '..' || part.includes(':') || part.includes('\\'))) reject('illegal path segment');
  // Only the memory tree is archivable: `.deepseek/<layer>/…`. Capture policy,
  // config.md and working.md are configuration, not cards.
  if (parts[0] !== '.deepseek' || parts[1] === 'archive' || parts[1] === 'cache') reject('not a memory path');
  if (!/\.md$/i.test(fileName)) reject('not a markdown file');
  const source = join(vaultPath, ...parts);
  if (!pathInside(vaultPath, source)) reject('outside the vault');
  let stats;
  try {
    stats = statSync(source); // follows symlinks: a link to a file is fine
  } catch {
    reject('source does not exist');
  }
  if (!stats.isFile()) reject('source is not a regular file');
  // Archive under the layer the card came FROM. Every card used to land in
  // `archive/records/` whatever its layer, because that directory was written
  // when records were the only archivable layer — so archiving a strategy or
  // topics card both misfiled it and made the receipt name the wrong folder.
  // `.deepseek/memory/<layer>/x.md` and `.deepseek/<layer>/x.md` both keep their
  // own name; records maps to `records`, exactly as before (existing archives in
  // `.deepseek/archive/records/` stay valid).
  const layer = parts[1] === 'memory' ? parts[2] : parts[1];
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(layer)) reject('unrecognized layer');
  // Create the archive directory only AFTER the source is known good: doing it
  // first littered the vault with an empty `.deepseek/archive/records/` on every
  // refused request (observed live during the 2026-09-10 acceptance run).
  const archiveDir = join(vaultPath, '.deepseek', 'archive', layer);
  mkdirSync(archiveDir, { recursive: true });
  const stem = fileName.replace(/\.md$/i, '');
  let target = join(archiveDir, fileName);
  let suffix = 1;
  while (existsSync(target)) {
    target = join(archiveDir, stem + '-' + suffix + '.md');
    suffix += 1;
  }
  renameSync(source, target);
  return target;
}

export function archiveOldEpisodes(vault, maxDays = 90) {
  const episodesDir = join(vault, '.deepseek', 'memory', 'episodes');
  if (!existsSync(episodesDir)) return { moved: 0 };
  const archiveDir = join(episodesDir, 'archive');
  const cutoff = Date.now() - maxDays * 86400000;
  const moved = [];
  let entries;
  try {
    entries = readdirSync(episodesDir, { withFileTypes: true });
  } catch {
    return { moved: 0 };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md' || entry.name.startsWith('_')) continue;
    const source = join(episodesDir, entry.name);
    let stats;
    try {
      stats = statSync(source);
    } catch {
      continue;
    }
    if (stats.mtimeMs >= cutoff) continue;
    try {
      mkdirSync(archiveDir, { recursive: true });
      let target = join(archiveDir, entry.name);
      let suffix = 1;
      while (existsSync(target)) {
        suffix += 1;
        target = join(archiveDir, entry.name.replace(/\.md$/, `-${suffix}.md`));
      }
      renameSync(source, target);
      // Obsidian wikilinks always use forward slashes, even on Windows.
      const archivedName = suffix === 1 ? entry.name : entry.name.replace(/\.md$/, `-${suffix}.md`);
      moved.push({ name: entry.name, linkName: `archive/${archivedName}` });
    } catch {
      // Leave the file in place on any maintenance failure.
    }
  }
  if (moved.length > 0) {
    const indexPath = join(episodesDir, 'index.md');
    if (existsSync(indexPath)) {
      try {
        let indexText = readFileSync(indexPath, 'utf8');
        for (const item of moved) {
          const oldStem = item.name.replace(/\.md$/, '');
          const newStem = item.linkName.replace(/\.md$/, '');
          indexText = indexText.replaceAll(`[[${oldStem}|`, `[[${newStem}|`);
          indexText = indexText.replaceAll(`[[${oldStem}]]`, `[[${newStem}]]`);
        }
        writeFileSync(indexPath, indexText, 'utf8');
      } catch {
        // Index update is best-effort; moved files are already safe.
      }
    }
    // Keep record cards' source links pointing at the archived episode so
    // provenance chains survive the move (best-effort, never a hard fail).
    const recordsDir = join(vault, '.deepseek', 'memory', 'records');
    if (existsSync(recordsDir)) {
      for (const entry of readdirSync(recordsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md' || entry.name.startsWith('_')) continue;
        const recordPath = join(recordsDir, entry.name);
        try {
          const before = readFileSync(recordPath, 'utf8');
          let after = before;
          for (const item of moved) {
            const oldStem = item.name.replace(/\.md$/, '');
            const newStem = item.linkName.replace(/\.md$/, '');
            after = after.replaceAll(`[[${oldStem}|`, `[[${newStem}|`);
            after = after.replaceAll(`[[${oldStem}]]`, `[[${newStem}]]`);
          }
          if (after !== before) writeFileSync(recordPath, after, 'utf8');
        } catch {
          // A single unreadable card must not block the maintenance pass.
        }
      }
    }
  }
  return { moved: moved.length };
}

export function parseMemoryFrontmatter(text, hookParser) {
  // The delimiter rule comes from `frontmatterSpan` (this file's copy — the
  // Obsidian loader injects bindings rather than resolving imports, so the host
  // tree cannot import the canonical `dsh/preset/hook-frontmatter.mjs`; a guard
  // asserts the two are behaviourally identical, see
  // scripts/check-frontmatter-source.mjs).
  const span = frontmatterSpan(text ?? '');
  if (span === null) return { meta: {}, hook: null };
  const meta = {};
  let inHook = false;
  for (const line of span.text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!inHook) {
      if (/^hook:\s*$/.test(trimmed)) { inHook = true; continue; }
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
      if (pair !== null) meta[pair[1]] = pair[2].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (line !== '' && !/^\s/.test(line)) { inHook = false; continue; }
  }
  return { meta, hook: hookParser(span.text) };
}

export function titleOf(text, fallback) {
  const metaTitle = /^title:\s*(.+)$/m.exec(text ?? '')?.[1]?.trim();
  if (metaTitle !== undefined && metaTitle !== '') return metaTitle.replace(/^['"]|['"]$/g, '');
  const heading = /^#\s+(.+)$/m.exec(text ?? '')?.[1]?.trim();
  return heading ?? fallback;
}

/** Trim to `max` characters on a word-ish boundary, appending `…`. */
function clipText(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A summary that ends in `：` reads like a truncated sentence (a card whose
 *  first body line is a lead-in such as `抄书笔记系列，主线：`), so drop the
 *  dangling punctuation. */
function tidySummary(value, max = 90) {
  return clipText(String(value ?? '').replace(/[\s：:，,、；;（(]+$/, ''), max);
}

/**
 * One line that answers "what IS this card?" for a panel row.
 *
 * A card's title is often a full mathematical statement (30-40 CJK characters,
 * LaTeX included), so a list of titles alone does not tell the user what the
 * memory contains — reported as 「各条记忆的名称显示可能让人无法 get 到内容」.
 * Preference order: an explicit `summary`/`description` frontmatter field → the
 * first real body paragraph → `hook.pattern` (the retrieval feature block's own
 * one-liner).
 */
export function summaryOf(text, meta = {}, hook = null) {
  for (const key of ['summary', 'description', 'abstract', 'one_liner']) {
    const value = meta?.[key];
    if (typeof value === 'string' && value.trim() !== '') return tidySummary(value);
  }
  const lines = String(text ?? '').split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i += 1;
    i += 1;
  }
  for (; i < lines.length; i += 1) {
    // A leading bullet marker is not content either: the navigation layer keeps
    // its bookkeeping as `- 标签：…` / `- 状态：…` bullets.
    const line = lines[i].trim().replace(/^[-*+]\s+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('>') || line.startsWith('|')) continue;
    if (line.startsWith('```') || line.startsWith('<!--') || /^[-=_*]{3,}$/.test(line)) continue;
    // Metadata-looking lines are not content: a stray `uses: 0` left OUTSIDE the
    // frontmatter (present in the wild, in a real strategy card) and the topics
    // layer's leading `标签：#…` line both made useless summaries.
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*\S/.test(line)) continue;
    if (/^(标签|关键词|关键字|来源|出处|相关|关联|状态|类型|主题|日期|创建|更新|最新状态[^：:]{0,8}|核心笔记|tags?|related|source|created|updated)\s*[:：]/.test(line)) continue;
    const cleaned = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
    if (cleaned === '') continue;
    return tidySummary(cleaned);
  }
  // Strategy cards put the answer in the frontmatter's `abstraction:` block; the
  // `principle` line is the portable statement, `concrete` the one-off instance.
  for (const key of ['principle', 'generalize', 'concrete']) {
    const value = new RegExp(`^\\s{2}${key}:\\s*["']?(.+?)["']?\\s*$`, 'm').exec(String(text ?? ''))?.[1];
    if (typeof value === 'string' && value.trim() !== '') return tidySummary(value);
  }
  const pattern = hook?.pattern;
  if (typeof pattern === 'string' && pattern.trim() !== '') return tidySummary(pattern);
  return '';
}

export function daysSinceText(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr ?? '');
  if (match === null) return '';
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const days = Math.floor((Date.now() - day.getTime()) / 86400000);
  return days > 0 ? `${days} 天前` : '今天';
}

/**
 * Parse `memory/episodes/index.md` into `stem → { title, topic }`.
 *
 * The index line format is `- [[stem|human title]] — topicA、topicB`. The
 * episode FILE name is machine-made (`YYYY-MM-DD-session-<uuid>.md`) and its
 * mtime is just the capture time, so the index is the only place carrying what
 * the conversation was about. The panel used to print the file name + mtime,
 * which is why 30 identical-looking rows separated the cards from the report.
 * Exported for tests.
 */
export function parseEpisodeIndex(text) {
  const map = new Map();
  // `[ \t]` (NOT `\s`) around the separator: `\s` matches the newline, so
  // `- [[stem]]` followed by `- [[other|title]] — topic` parsed as ONE line and
  // moved the next episode's link text into this entry's `topic` (caught by
  // scripts/test-memory.mjs §30).
  const re = /^[ \t]*[-*][ \t]*\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\](?:[ \t]*[—–-][ \t]*(.*))?[ \t]*$/gm;
  let match = re.exec(text ?? '');
  while (match !== null) {
    const stem = (match[1] ?? '').trim().replace(/^archive\//, '');
    if (stem !== '') {
      map.set(stem, {
        title: (match[2] ?? '').trim(),
        topic: (match[3] ?? '').trim().replace(/[。.]+$/, '')
      });
    }
    match = re.exec(text ?? '');
  }
  return map;
}

/** `YYYY-MM-DD` from an episode file name, or '' when it has none. */
export function episodeDateOf(name) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(name ?? ''));
  return match === null ? '' : match[1];
}

/**
 * Audit-report schema versions this build can render. Keep in step with the
 * WRITER's `AUDIT_SCHEMA_VERSION` (`dsh/preset/math-memory.mjs`):
 *
 *   v1  no `schemaVersion` field at all — the pre-split format, a model-facing
 *       `report` string plus a few structured leftovers; rendered through
 *       `legacyAuditSummary` / `normalizeAuditForPanel`.
 *   v2  split into `checklist` (model) + `human` (user) + `counts` / `decisions`
 *       / `thresholds` / `sections` / `structural`.
 *
 * Until 2026-09-11 NOTHING on the read side looked at `schemaVersion`, so the
 * writer's constant guarded nothing: a cache written by a NEWER engine was
 * parsed as if this build understood its shape. That is not hypothetical —
 * `handoff.md` trap 38 is a real v1-cache/v2-reader incident (the panels had to
 * synthesize a summary from v1's leftovers). Declaring the range on the read
 * side makes the mismatch a deliberate, tested decision instead of an accident.
 */
export const AUDIT_SCHEMA_VERSION_MIN = 1;
export const AUDIT_SCHEMA_VERSION_MAX = 2;

/** The schema version a parsed audit claims; a missing field means the v1 format. */
export function auditSchemaVersionOf(audit) {
  const raw = audit?.schemaVersion;
  return Number.isInteger(raw) && raw > 0 ? raw : AUDIT_SCHEMA_VERSION_MIN;
}

/** Read `.deepseek/cache/memory-audit.json` and return the parsed object, or null. */
export function readAuditReport(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const version = auditSchemaVersionOf(parsed);
    // Outside the declared range the shape is unknown (a newer engine wrote it,
    // or the file was hand-edited). Report "no usable report" rather than let the
    // panels render a half-understood one; the next audit rewrites the file.
    if (version < AUDIT_SCHEMA_VERSION_MIN || version > AUDIT_SCHEMA_VERSION_MAX) return null;
    return parsed;
  } catch {
    // no report yet
  }
  return null;
}

/**
 * Build a human summary from a PRE-SPLIT (schema v1) audit JSON, which has no
 * `human` field — only the model-facing `report` string.
 *
 * The panels must not show that string (it is the log dump the user complained
 * about: raw `[[.deepseek/…|title]]`, a bare 0-1 utility scalar and imperatives
 * addressed to the agent), and must not claim there is no report either. Schema
 * v1 still carries `counts` / `pendingReview` / `archiveCandidates` / `passive`,
 * which is enough for the sentences below. The next audit rewrites the file in
 * the new format and this fallback stops being used.
 */
export function legacyAuditSummary(audit) {
  const counts = audit?.counts ?? {};
  const ms = Number(audit?.generatedAt);
  const day = Number.isFinite(ms) && ms > 0
    ? (() => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()
    : '';
  const lines = [`记忆体检${day === '' ? '' : ` ${day}`}（旧版报告，下次对话后会自动更新为摘要版）`];
  const bits = [];
  if (Number.isFinite(counts.cards)) bits.push(`${counts.cards} 张卡`);
  if (Number.isFinite(counts.strong)) bits.push(`${counts.strong} 张可靠`);
  if (Number.isFinite(counts.weak) && counts.weak > 0) bits.push(`${counts.weak} 张待改写`);
  if (Number.isFinite(counts.unused) && counts.unused > 0) bits.push(`${counts.unused} 张长期没用`);
  if (bits.length > 0) lines.push(`· ${bits.join(' · ')}`);
  const pending = Array.isArray(audit?.pendingReview) ? audit.pendingReview : [];
  if (pending.length > 0) lines.push(`✍️ ${pending.length} 张卡被你标过「错」，助手会在相关讨论时读来源证据链重判。`);
  const candidates = Array.isArray(audit?.archiveCandidates) ? audit.archiveCandidates : [];
  if (candidates.length > 0) {
    const names = candidates.slice(0, 3)
      .map((item) => (typeof item === 'string' ? item : (item?.title ?? '')))
      .filter((name) => name !== '')
      .map((name) => `「${name}」`)
      .join('、');
    lines.push(`⚠️ ${candidates.length} 张长期没被用到，建议归档${names === '' ? '' : `：${names}`}（移动而非删除，可在下面直接点「归档」）。`);
  }
  const passive = audit?.passive;
  if (passive !== null && typeof passive === 'object' && Number.isFinite(passive.calls) && passive.calls > 0) {
    const pct = Math.round((passive.empty / passive.calls) * 100);
    lines.push(`🔍 上次体检以来检索 ${passive.calls} 次，其中 ${passive.empty} 次没找到内容（${pct}%）。`);
  }
  if (lines.length === 1) lines.push('（旧版报告里没有可读的结构化信息，下次对话后会重新生成。）');
  return lines.join('\n');
}

/** Card layers the panels browse. `.deepseek/memory/records` is the records
 * layer; the other four are real (strategy cards exist in the wild) but were
 * never collected, so a vault whose memory lived in topics/theorems looked
 * empty to both panels. */
export const CARD_LAYERS = [
  { key: 'records', dir: '.deepseek/memory/records', label: '记录' },
  { key: 'templates', dir: '.deepseek/memory/templates', label: '模板' },
  { key: 'topics', dir: '.deepseek/memory/topics', label: '主题' },
  { key: 'theorems', dir: '.deepseek/memory/theorems', label: '定理' },
  { key: 'strategy', dir: '.deepseek/strategy', label: '策略' }
];

/**
 * Normalize an audit JSON for the panels, including PRE-SPLIT (schema v1) files.
 *
 * v1 has no `sections` / `decisions` — it has top-level `pendingReview` (rel
 * strings) and `archiveCandidates` (`{rel,title,utility}`). The panels render
 * the ⚠️ 待处理 block from `sections` + `decisions`, so without this they showed
 * nothing at all for an old cache, even when the report was recommending two
 * archives. Titles for the rel-only entries come from the cards we just scanned.
 */
export function normalizeAuditForPanel(audit, titleByRel = new Map()) {
  if (audit === null || typeof audit !== 'object') return audit;
  const sections = audit.sections !== null && typeof audit.sections === 'object' ? { ...audit.sections } : {};
  const asRef = (item) => {
    if (typeof item === 'string') {
      return { rel: item, title: titleByRel.get(item) ?? item.split('/').at(-1).replace(/\.md$/, '') };
    }
    if (item !== null && typeof item === 'object' && typeof item.rel === 'string') {
      return { ...item, title: item.title ?? titleByRel.get(item.rel) ?? item.rel.split('/').at(-1).replace(/\.md$/, '') };
    }
    return null;
  };
  if (!Array.isArray(sections.pendingReview)) {
    sections.pendingReview = (Array.isArray(audit.pendingReview) ? audit.pendingReview : []).map(asRef).filter((item) => item !== null);
  }
  if (!Array.isArray(sections.archiveCandidates)) {
    sections.archiveCandidates = (Array.isArray(audit.archiveCandidates) ? audit.archiveCandidates : []).map(asRef).filter((item) => item !== null);
  }
  if (!Array.isArray(sections.duplicates)) sections.duplicates = [];
  if (!Array.isArray(sections.unused)) sections.unused = [];
  const decisions = audit.decisions !== null && typeof audit.decisions === 'object' && Number.isFinite(Number(audit.decisions.total))
    ? audit.decisions
    : {
        reviewCards: sections.pendingReview.length,
        cleanupCards: sections.archiveCandidates.length + sections.duplicates.length,
        total: sections.pendingReview.length + sections.archiveCandidates.length + sections.duplicates.length
      };
  const normalized = { ...audit, sections, decisions };
  // v1 has no `today` (only `generatedAt`), and the panels show 「上次体检 <today>」.
  if (typeof normalized.today !== 'string' || normalized.today === '') {
    const ms = Number(audit.generatedAt);
    if (Number.isFinite(ms) && ms > 0) {
      const d = new Date(ms);
      normalized.today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return normalized;
}

/** Collect every memory-layer file under the vault for the panel. */
export function collectMemoryState(vaultPath, filter, hookParser) {
  const rel = (dir, name) => `${dir}/${name}`.replace(/\\/g, '/');
  const listDir = (dir) => {
    try {
      return readdirSync(join(vaultPath, dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  // Pending retrieval hits recorded by note_recall since the last audit. The
  // audit MERGES these into the cards' frontmatter and then zeroes them, so the
  // file is a DELTA, not a total: showing only the frontmatter value makes the
  // panel under-report between audits, and showing only the delta makes it look
  // like the counts were lost. The panel shows declared + pending, and labels a
  // card whose declared value still disagrees after the audit
  // (docs/design-intake-2026-09-10.md §1 item 4).
  const pendingUses = (() => {
    const map = new Map();
    try {
      const parsed = JSON.parse(readFileSync(join(vaultPath, '.deepseek', 'cache', 'retrieval-stats.json'), 'utf8'));
      if (parsed !== null && typeof parsed === 'object') {
        for (const [key, entry] of Object.entries(parsed)) {
          if (key === '__meta__') continue;
          const uses = Number(entry?.uses);
          if (Number.isFinite(uses) && uses > 0) map.set(key, Math.trunc(uses));
        }
      }
    } catch {
      // no stats yet
    }
    return map;
  })();
  const hookHistory = (() => {
    const map = new Map();
    try {
      const parsed = JSON.parse(readFileSync(join(vaultPath, '.deepseek', 'cache', 'hook-history.json'), 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && parsed.snapshots !== null && typeof parsed.snapshots === 'object') {
        for (const [rel, points] of Object.entries(parsed.snapshots)) {
          if (Array.isArray(points)) map.set(rel, points);
        }
      }
    } catch {
      // no history yet
    }
    return map;
  })();
  const cardEntries = (dir) => listDir(dir)
    .filter((name) => name !== 'index.md' && !name.startsWith('_'))
    .map((name) => {
      const filePath = join(vaultPath, dir, name);
      let text = '';
      try {
        text = readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
      const { meta, hook } = parseMemoryFrontmatter(text, hookParser);
      const key = `${dir}/${name}`;
      const usesDeclared = Number.isFinite(Number(hook?.uses)) ? Number(hook.uses)
        : (Number.isFinite(Number(meta.uses)) ? Number(meta.uses) : 0);
      const usesPending = pendingUses.get(key) ?? 0;
      return {
        rel: rel(dir, name),
        name,
        title: titleOf(text, name.replace(/\.md$/, '')),
        summary: summaryOf(text, meta, hook),
        type: meta.type ?? '',
        status: meta.status ?? 'active',
        updated: meta.updated ?? '',
        topic: meta.topic ?? '',
        hook,
        // `uses` is the EFFECTIVE count (declared + not-yet-merged hits);
        // `usesDeclared` is what the file says, `usesPending` the delta.
        uses: usesDeclared + usesPending,
        usesDeclared,
        usesPending,
        // Negative-transfer counter: used AND it made things worse.
        harmed: Math.max(0, Math.trunc(
          Number.isFinite(Number(hook?.harmed)) ? Number(hook.harmed)
            : (Number.isFinite(Number(meta.harmed)) ? Number(meta.harmed) : 0)
        )),
        verifiedBy: typeof hook?.verified_by === 'string' ? hook.verified_by
          : (typeof meta.verified_by === 'string' ? meta.verified_by : ''),
        successRate: Number.isFinite(Number(hook?.success_rate)) ? Number(hook.success_rate) : null,
        lastUsed: typeof hook?.last_used === 'string' ? hook.last_used : '',
        verified: typeof hook?.verified === 'string' ? hook.verified : null,
        operator: typeof hook?.operator === 'string' ? hook.operator : '',
        // Applicability boundary: shown as a hint on the row, and used by
        // note_recall to withhold a card whose boundary the query matches.
        boundary: typeof meta.not_applicable_when === 'string' ? meta.not_applicable_when
          : (typeof hook?.not_applicable_when === 'string' ? hook.not_applicable_when : ''),
        history: hookHistory.get(key) ?? []
      };
    })
    .filter((entry) => entry !== null);
  // The haystack is lowercased but the needle used to be compared verbatim, so
  // any query with an uppercase letter ("De Finetti") matched nothing.
  const needle = String(filter ?? '').trim().toLowerCase();
  const matches = (entry) => needle === '' ||
    `${entry.title} ${entry.operator} ${entry.type} ${entry.topic}`.toLowerCase().includes(needle);
  const layers = {};
  for (const layer of CARD_LAYERS) {
    layers[layer.key] = {
      label: layer.label,
      dir: layer.dir,
      cards: cardEntries(layer.dir).filter(matches).map((card) => ({ ...card, layer: layer.key }))
    };
  }
  const records = layers.records.cards;
  const templates = layers.templates.cards;
  const memos = listDir('.deepseek/inbox')
    .filter((name) => name !== 'index.md' && !name.startsWith('_'))
    .map((name) => {
      const filePath = join(vaultPath, '.deepseek', 'inbox', name);
      let text = '';
      try {
        text = readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
      const { meta } = parseMemoryFrontmatter(text, hookParser);
      return {
        rel: rel('.deepseek/inbox', name),
        name,
        title: titleOf(text, name.replace(/\.md$/, '')),
        summary: summaryOf(text, meta, null),
        status: meta.status ?? 'inbox',
        updated: meta.updated ?? '',
        topic: meta.topic ?? ''
      };
    })
    .filter((entry) => entry !== null && (needle === '' || `${entry.title} ${entry.topic}`.toLowerCase().includes(needle)));
  // Episodes carry their meaning in `episodes/index.md`, not in the file name
  // or the mtime (every episode written by one capture shares a timestamp).
  const episodeIndex = (() => {
    try {
      return parseEpisodeIndex(readFileSync(join(vaultPath, '.deepseek', 'memory', 'episodes', 'index.md'), 'utf8'));
    } catch {
      return new Map();
    }
  })();
  const episodes = [];
  try {
    episodes.push(...readdirSync(join(vaultPath, '.deepseek', 'memory', 'episodes'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md' && !entry.name.startsWith('_'))
      .map((entry) => {
        const filePath = join(vaultPath, '.deepseek', 'memory', 'episodes', entry.name);
        const stem = entry.name.replace(/\.md$/, '');
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(filePath).mtimeMs;
        } catch {
          // keep 0
        }
        const indexed = episodeIndex.get(stem) ?? {};
        return {
          rel: rel('.deepseek/memory/episodes', entry.name),
          name: entry.name,
          stem,
          mtimeMs,
          date: episodeDateOf(entry.name),
          title: indexed.title !== undefined && indexed.title !== '' ? indexed.title : stem,
          topic: indexed.topic ?? ''
        };
      })
      .filter((entry) => needle === '' || `${entry.title} ${entry.topic} ${entry.stem}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.date === b.date ? b.mtimeMs - a.mtimeMs : (a.date < b.date ? 1 : -1))));
  } catch {
    // episodes dir missing: stay empty
  }
  const profile = existsSync(join(vaultPath, '.deepseek', 'memory', 'profile.md'));
  const auditPath = join(vaultPath, '.deepseek', 'cache', 'memory-audit.json');
  const titleByRel = new Map();
  for (const layer of Object.values(layers)) {
    for (const card of layer.cards) titleByRel.set(card.rel, card.title);
  }
  const audit = normalizeAuditForPanel(readAuditReport(auditPath), titleByRel);
  const capturePolicy = (() => {
    const fallback = { idea: 'ask', fact: 'ask', preference: 'ask', structure: 'auto' };
    try {
      const raw = readFileSync(join(vaultPath, '.deepseek', 'capture-policy.md'), 'utf8');
      const { meta } = parseMemoryFrontmatter(raw, hookParser);
      const mode = (value, fallbackMode) => typeof value === 'string' && ['auto', 'ask', 'off'].includes(value) ? value : fallbackMode;
      return {
        idea: mode(meta.idea, fallback.idea),
        fact: mode(meta.fact, fallback.fact),
        preference: mode(meta.preference, fallback.preference),
        // `structure` postdates the other three fields: an existing policy file
        // has no such line, and its absence must mean "as before" (auto), not
        // "ask" — otherwise upgrading would silently make the agent interrupt
        // the user for every index row.
        structure: mode(meta.structure, fallback.structure)
      };
    } catch {
      return fallback;
    }
  })();
  return {
    // Kept flat for readers written against 0.7.x (`records`, `templates`).
    records,
    templates,
    // Every browsable card layer, so a vault whose memory lives in topics /
    // theorems / strategy is no longer reported as empty.
    layers,
    memos,
    episodes,
    profile,
    // `auditText` is the MODEL-facing checklist, kept for back-compat only; the
    // panels must render `audit` (structured) or `auditHuman` (plain language),
    // never the checklist — that string is why the panel looked like a log dump.
    auditText: typeof audit?.report === 'string' ? audit.report : '',
    audit,
    // A `memory-audit.json` written before the checklist/human split (schema v1)
    // has only `report`. Showing nothing while a report exists is worse than
    // deriving a summary from its structured leftovers (see legacyAuditSummary);
    // the next audit regenerates the file in the new format.
    auditHuman: typeof audit?.human === 'string' && audit.human !== ''
      ? audit.human
      : (audit === null ? '' : legacyAuditSummary(audit)),
    capturePolicy
  };
}

/** Legacy accessor: the model-facing checklist string from the audit JSON. */
export function readAuditText(path) {
  const parsed = readAuditReport(path);
  return typeof parsed?.report === 'string' ? parsed.report : '';
}

// ── dialogue capture (obelisk-comparison.md §5) ──────────────────────────────
// Host-agnostic session-capture core so the UI (Obsidian panel / dsh web panel)
// can "save this conversation now" and show "N unsaved". Mirrors the same logic
// inside dsh/preset/math-memory.mjs runSessionCapture (the auto-capture path);
// keep the two in sync. Self-contained: only node:fs/path/zlib.

const MEMORY_DIR = '.deepseek';
const CAPTURE_FILE = join(MEMORY_DIR, 'cache', 'captured-sessions.json');
const CAPTURE_SCHEMA_VERSION = 1;
const CAPTURE_USER_CLIP = 4000;
const CAPTURE_ASSISTANT_CLIP = 4000;
const CAPTURE_MAX_SESSION_CHARS = 24000;
const CAPTURE_SCAN_LIMIT = 100000;
/**
 * Bytes read from the head of a session log to reach its header frame. The
 * harness writes a small checksummed header frame first (see
 * `dsh-session-persistence-jsonl`), so the opening 64 KiB always holds the
 * whole `{type:"session", id, cwd, …}` line. Measured on a real 389-log /
 * 367 MB store: reading every header costs ~0.6 s, whereas decoding every log
 * costs ~34 s — the difference between a usable panel and a frozen app.
 */
const CAPTURE_HEAD_BYTES = 65536;
const ZSTD_MAGIC = 4247762216; // little-endian 28 B5 2F FD

function captureClip(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).replace(/\s+\S*$/, '')} …`;
}

function captureContentText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return frames;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`session-capture: bad zstd frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return frames;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`session-capture: reserved zstd frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const hasChecksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return frames;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`session-capture: reserved zstd block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (hasChecksum) {
      if (buffer.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push([start, offset]);
  }
  return frames;
}

function decodeSessionLog(buffer) {
  const events = [];
  for (const [start, end] of scanZstdFrames(buffer)) {
    let text;
    try {
      text = zstdDecompressSync(buffer.subarray(start, end)).toString('utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // ignore malformed lines
      }
    }
  }
  return events;
}

/**
 * Read ONE session log's header line without decoding the whole file.
 *
 * The scan only needs `{ id, cwd }` to decide whether a log belongs to this
 * vault. Decoding every log to learn that is what made the panel freeze: on a
 * real store the vault owned 40 of 389 logs (6.6 MB of 367 MB), so ~98% of the
 * decoding was thrown away. Reading just the first frame makes the same
 * decision for ~1/60th of the cost.
 *
 * Returns the parsed header object, or null when the file is unreadable, the
 * head holds no complete zstd frame, or the first line is not JSON.
 */
function readSessionHeader(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = statSync(path).size;
    const want = Math.min(CAPTURE_HEAD_BYTES, size);
    if (want <= 0) return null;
    const head = Buffer.allocUnsafe(want);
    const read = readSync(fd, head, 0, want, 0);
    const bounds = scanZstdFrames(head.subarray(0, read));
    if (bounds.length === 0) return null;
    const text = zstdDecompressSync(head.subarray(bounds[0][0], bounds[0][1])).toString('utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const parsed = JSON.parse(line);
      return parsed !== null && typeof parsed === 'object' ? parsed : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

/**
 * The identity of the session an artifact belongs to.
 *
 * Since dsh 0.1.5 (session data format V3) ONE session can own two artifacts in
 * the same directory: the V2 original `session.jsonl.zstd` and the migrated
 * `session.v3.jsonl.zstd`. The migration generates the new file while KEEPING
 * the old one, so both names end in `.jsonl.zstd` and the walker below would
 * otherwise count one conversation twice. The key is the first ancestor
 * directory that is not the generic `sessions` root (the session directory in
 * the harness layout); a flat `<id>.jsonl.zstd` store falls back to the file
 * stem. Mirrors `sessionLogKey` in `dsh/preset/math-memory.mjs`.
 */
function sessionLogKey(path) {
  const segments = String(path).split(/[\\/]/).filter((s) => s !== '');
  const stem = (name) => {
    let value = String(name);
    while (value.includes('.')) {
      const next = value.replace(/\.[^.]+$/, '');
      if (next === value) break;
      value = next;
    }
    return value;
  };
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const candidate = segments[i];
    if (/^sessions?$/i.test(candidate)) break; // the generic root: stop looking
    const key = stem(candidate);
    if (key !== '') return key;
  }
  const file = segments[segments.length - 1];
  return file === undefined ? '' : stem(file);
}

/**
 * Collapse same-session artifacts to ONE authoritative log each.
 *
 * The `.v3.` variant label decides first — the migrated artifact is the live
 * and authoritative one even when its mtime ties with the original (the
 * migration can write both inside one filesystem timestamp tick); mtime decides
 * second. The result stays mtime-descending for the caller's `maxFiles` window.
 * Mirrors `selectAuthoritativeLogs` in `dsh/preset/math-memory.mjs`.
 */
function selectAuthoritativeLogs(logs) {
  const best = new Map();
  const flat = [];
  for (const log of logs) {
    const key = sessionLogKey(log.path);
    if (!key) {
      flat.push(log);
      continue;
    }
    const current = best.get(key);
    if (current === undefined || isNewerArtifact(log, current)) best.set(key, log);
  }
  return [...flat, ...best.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function isNewerArtifact(candidate, incumbent) {
  const candidateV3 = /\.v3\./.test(candidate.path);
  const incumbentV3 = /\.v3\./.test(incumbent.path);
  if (candidateV3 !== incumbentV3) return candidateV3;
  return candidate.mtimeMs > incumbent.mtimeMs;
}

function findSessionLogs(sessionsRoot, maxFiles) {
  const found = [];
  const walk = (dir) => {
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      const path = join(dir, child.name);
      if (child.isDirectory()) walk(path);
      else if (child.isFile() && child.name.endsWith('.jsonl.zstd')) {
        try {
          const stats = statSync(path);
          found.push({ path, mtimeMs: stats.mtimeMs, size: stats.size });
        } catch {
          // gone while walking
        }
      }
    }
  };
  walk(sessionsRoot);
  // Dedup BEFORE the slice so `maxFiles` still means "at most N sessions".
  return selectAuthoritativeLogs(found).slice(0, maxFiles);
}

function distillSession(events, { userClip = 500, assistantClip = 320 } = {}) {
  const entry = { id: undefined, title: undefined, cwd: undefined, createdAt: undefined, isSubagent: false, messages: [] };
  for (const event of events) {
    if (event?.type === 'session' && typeof event.id === 'string') {
      entry.id = event.id;
      entry.cwd = typeof event.cwd === 'string' ? event.cwd : entry.cwd;
      entry.createdAt = typeof event.createdAt === 'number' ? event.createdAt : entry.createdAt;
      // V3 headers mark delegated children (`origin` / `delegationDepth`); V2
      // headers have neither, so a V2 subagent stays indistinguishable.
      entry.isSubagent = event.origin === 'subagent'
        || (Number.isFinite(event.delegationDepth) && event.delegationDepth > 0);
    } else if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
      entry.title = event.data.title;
    } else if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      const text = captureContentText(event.data.content);
      if (text !== '') entry.messages.push({ role: 'user', text: captureClip(text, userClip), time: event.time ?? 0, seq: event.seq });
    } else if (event?.type === 'assistant/message') {
      const text = captureContentText(event.data?.message?.content);
      if (text !== '') entry.messages.push({ role: 'assistant', text: captureClip(text, assistantClip), time: event.time ?? 0, seq: event.seq });
    }
  }
  return entry;
}

function localDateFromMs(ms) {
  const d = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function planSessionDelta(entry, prior) {
  const messages = [...(entry?.messages ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (messages.length === 0) return null;
  const lastSeq = Number.isFinite(prior?.lastSeq) ? prior.lastSeq : -1;
  const delta = messages.filter((m) => (m.seq ?? 0) > lastSeq);
  if (delta.length === 0) return null;
  return { delta, lastSeq: delta[delta.length - 1].seq ?? 0 };
}

function renderConversationTail(messages, maxChars) {
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const line = `${messages[i].role === 'user' ? '用户' : '助手'}：${messages[i].text ?? ''}`;
    if (used + line.length > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.length === 0 ? null : kept.reverse().join('\n');
}

export function readCaptureState(root) {
  const path = join(root, CAPTURE_FILE);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' &&
        parsed.schemaVersion === CAPTURE_SCHEMA_VERSION &&
        parsed.sessions !== null && typeof parsed.sessions === 'object') {
      return parsed;
    }
  } catch {
    // missing/corrupt: fresh
  }
  return { schemaVersion: CAPTURE_SCHEMA_VERSION, sessions: {} };
}

/**
 * Add a capture file to episodes/index.md (idempotent, one line per session).
 * Returns `false` when the write could not be confirmed, so the caller can
 * report it (see `runSessionCapture`); the check is a read-back, not just "no
 * throw" — trap 44.
 */
function appendEpisodeIndex(root, stem, title) {
  const indexPath = join(root, MEMORY_DIR, 'memory', 'episodes', 'index.md');
  const line = `- [[${stem}|${title}]]`;
  try {
    let text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
    if (text.includes(`[[${stem}`)) return true;
    if (text !== '' && !text.endsWith('\n')) text += '\n';
    writeFileSync(indexPath, `${text}${line}\n`, 'utf8');
    return readFileSync(indexPath, 'utf8').includes(`[[${stem}`);
  } catch {
    return false;
  }
}

/**
 * The per-log scan cache persisted next to the capture marker under `scanned`.
 *
 * It maps a session-log absolute path to what the last examination learned at
 * that exact file revision:
 *
 *   { fp, inVault, pending }
 *
 * - `fp` is the same `path|mtimeMs|size` fingerprint the capture marker uses,
 *   so a log that grew invalidates its own record and is re-examined.
 * - `inVault` is false for logs belonging to other workspaces. Those are
 *   characterised once (one cheap header read) and then skipped forever.
 *   Before this cache existed they were read and fully zstd-decoded on EVERY
 *   scan only to be discarded by the vault containment filter.
 * - `pending` is true when the session has messages not yet written into
 *   episodes, i.e. it is still waiting for a capture.
 *
 * Two callers share it: the count path (panel badge) never mutates episodes but
 * may cache "irrelevant" and "pending" verdicts; the capture path also writes
 * the deltas. Caching a `pending` verdict is what lets the badge re-render
 * without re-decoding, and it stays correct because the capture path treats a
 * cached `pending` record as "still needs work" and decodes it anyway.
 */
function scanSessionCapture(root, sessionsRoot, next, capture) {
  const scanned = { ...(next.scanned ?? {}) };
  const captured = [];
  // Anything this pass could not confirm. Returned rather than swallowed: a vault
  // whose episode writes keep failing used to look exactly like an idle one
  // (`captured: []` either way) — trap 44 / 2026-09-11 review P2-7.
  const warnings = [];
  let count = 0;
  // Only rewrite the marker when this pass actually learned something, so a
  // badge refresh on a quiet vault performs no vault write at all.
  let dirty = false;
  for (const log of findSessionLogs(sessionsRoot, CAPTURE_SCAN_LIMIT)) {
    const fingerprint = `${log.path}|${log.mtimeMs}|${log.size}`;
    const record = scanned[log.path];
    if (record !== undefined && record.fp === fingerprint) {
      // Characterised at this exact revision: never read the log again.
      if (record.inVault !== true || record.pending !== true) continue;
      if (capture !== true) {
        count += 1;
        continue;
      }
      // A capture must append the delta, which needs the decoded messages.
    }
    // Cheap gate first: only this vault's sessions are ever captured. Reading
    // the header costs ~1.5 ms against ~90 ms to decode a whole log. The
    // `type` test matches distillSession exactly, so anything the decoder would
    // reject is rejected here, before the file is ever decompressed.
    const header = readSessionHeader(log.path);
    // A null header means the head held no complete frame (an unusually large
    // first frame, or a torn file). Do NOT cache an "irrelevant" verdict we
    // cannot justify: a miscached log would be hidden from capture forever.
    // Fall through to the full decode, which decides relevance authoritatively.
    if (header !== null && (header.type !== 'session' || typeof header.id !== 'string' || !pathInside(root, header.cwd ?? ''))) {
      scanned[log.path] = { fp: fingerprint, inVault: false, pending: false };
      dirty = true;
      continue;
    }
    let events;
    try {
      events = decodeSessionLog(readFileSync(log.path));
    } catch {
      continue;
    }
    const entry = distillSession(events, { userClip: CAPTURE_USER_CLIP, assistantClip: CAPTURE_ASSISTANT_CLIP });
    if (entry.id === undefined || entry.messages.length === 0 || !pathInside(root, entry.cwd ?? '')) {
      scanned[log.path] = { fp: fingerprint, inVault: false, pending: false };
      dirty = true;
      continue;
    }
    // Delegated child sessions replay their parent prefix; the preset's capture
    // path skips them unless `captureSubagents` is on, so the badge must use the
    // same rule or it would report work that capturing will never do.
    if (entry.isSubagent === true) {
      scanned[log.path] = { fp: fingerprint, inVault: false, pending: false };
      dirty = true;
      continue;
    }
    const prior = next.sessions[entry.id];
    const plan = planSessionDelta(entry, prior);
    if (plan === null) {
      next.sessions[entry.id] = { lastSeq: prior?.lastSeq ?? -1, fingerprint, file: prior?.file ?? '' };
      scanned[log.path] = { fp: fingerprint, inVault: true, pending: false };
      dirty = true;
      continue;
    }
    if (capture !== true) {
      scanned[log.path] = { fp: fingerprint, inVault: true, pending: true };
      dirty = true;
      count += 1;
      continue;
    }
    const body = renderConversationTail(plan.delta, CAPTURE_MAX_SESSION_CHARS);
    if (body === null) {
      next.sessions[entry.id] = { lastSeq: plan.lastSeq, fingerprint, file: prior?.file ?? '' };
      scanned[log.path] = { fp: fingerprint, inVault: true, pending: false };
      dirty = true;
      continue;
    }
    const date = localDateFromMs(entry.createdAt);
    const stem = `${date}-${entry.id}`;
    const rel = join(MEMORY_DIR, 'memory', 'episodes', `${stem}.md`);
    const abs = join(root, rel);
    try {
      const isNew = prior?.file === undefined || prior.file === '';
      if (isNew) {
        mkdirSync(dirname(abs), { recursive: true });
        const header2 = [
          `# ${entry.title ?? entry.id}`,
          '',
          `> sessionId: ${entry.id} · 自动保存对话 · ${date}`,
          '',
          '## 对话（不含思考）',
          ''
        ].join('\n');
        writeFileSync(abs, `${header2}${body}\n`, 'utf8');
      } else {
        const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
        const sep = existing.endsWith('\n') ? '' : '\n';
        writeFileSync(abs, `${existing}${sep}${body}\n`, 'utf8');
      }
      // A failed index line no longer aborts the session: the episode body IS
      // persisted, and un-advancing the marker would re-append that same delta
      // on the next pass (duplicated content). Report it instead.
      if (appendEpisodeIndex(root, stem, entry.title ?? entry.id) === false) {
        warnings.push(`episodes/index.md 未补上 ${stem}（正文已写入，面板时间线可能漏这一条）`);
      }
      captured.push({ id: entry.id, rel, lastSeq: plan.lastSeq });
      next.sessions[entry.id] = { lastSeq: plan.lastSeq, fingerprint, file: rel };
      scanned[log.path] = { fp: fingerprint, inVault: true, pending: false };
      dirty = true;
    } catch (error) {
      // Leave the marker untouched so the next pass retries — but say so: a vault
      // that keeps failing here is otherwise indistinguishable from an idle one.
      warnings.push(`会话 ${entry.id} 落盘失败，本次未捕获（下次重试）：${String(error?.message ?? error)}`);
    }
  }
  next.scanned = scanned;
  return { captured, count, dirty, warnings };
}

/**
 * Persist the capture marker plus its scan cache (best-effort).
 *
 * Returns `false` when the write could not be confirmed. The marker is what
 * stops the next pass from re-appending the same deltas, so losing it risks
 * duplicated episodes — the caller reports that instead of silently retrying.
 *
 * `keepDiskSessions` is for the count path. Obsidian and the dsh host route can
 * both write this file, and `sessions` (the per-session `lastSeq` marker) is the
 * state whose loss would re-append a conversation tail into an episode. The
 * count path only ever *adds* `scanned` observations, so it re-reads the marker
 * and lets an on-disk `sessions` win over the copy its scan started from.
 */
function persistCaptureState(root, next, keepDiskSessions = false) {
  try {
    mkdirSync(join(root, MEMORY_DIR, 'cache'), { recursive: true });
    let payload = next;
    if (keepDiskSessions) {
      const onDisk = readCaptureState(root);
      payload = {
        schemaVersion: CAPTURE_SCHEMA_VERSION,
        sessions: { ...next.sessions, ...(onDisk.sessions ?? {}) },
        scanned: { ...(onDisk.scanned ?? {}), ...next.scanned }
      };
    }
    writeFileSync(join(root, CAPTURE_FILE), JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch {
    // Best-effort, but not silent: the caller turns `false` into a warning.
    return false;
  }
}

/**
 * Capture this vault's uncaptured conversation deltas into episodes.
 *
 * Returns `{ captured, state, warnings }`: `warnings` names every write this pass
 * could not confirm (per-session落盘, index line, marker) so a persistently
 * failing vault is distinguishable from an idle one. Shares its shape with the
 * preset's `runSessionCapture` (see check-engine-sync.mjs).
 */
export function runSessionCapture(root, sessionsRoot, state = undefined) {
  const next = state !== undefined && state !== null && typeof state === 'object' && state.schemaVersion === CAPTURE_SCHEMA_VERSION
    ? { schemaVersion: state.schemaVersion, sessions: { ...(state.sessions ?? {}) }, scanned: { ...(state.scanned ?? {}) } }
    : { schemaVersion: CAPTURE_SCHEMA_VERSION, sessions: {}, scanned: {} };
  const { captured, dirty, warnings } = scanSessionCapture(root, sessionsRoot, next, true);
  if (dirty && persistCaptureState(root, next) === false) {
    warnings.push('捕获 marker 写入失败，下次可能重复捕获同一批会话');
  }
  return { captured, state: next, warnings };
}

/**
 * Count in-vault sessions that still have uncaptured messages (panel badge).
 *
 * Reads no log that the scan cache already characterised, which is what keeps
 * this callable from a view's `onOpen` on the renderer main thread. It does
 * write the scan cache back (a pure function of the session logs), so repeated
 * calls converge on a stat-only pass instead of re-reading the store.
 */
export function countUncapturedSessions(root, sessionsRoot) {
  const state = readCaptureState(root);
  const next = { schemaVersion: CAPTURE_SCHEMA_VERSION, sessions: { ...(state.sessions ?? {}) }, scanned: { ...(state.scanned ?? {}) } };
  const { count, dirty } = scanSessionCapture(root, sessionsRoot, next, false);
  if (dirty) persistCaptureState(root, next, true);
  return count;
}

/**
 * Toggle `.deepseek/config.md` `sessionCapture` (host side, minimal frontmatter
 * diff; also refreshes nothing else). The panel switches call this.
 */
export function setSessionCapture(root, enabled, fallbackTemplate = '') {
  const configPath = join(root, MEMORY_DIR, 'config.md');
  let text;
  if (existsSync(configPath)) {
    text = readFileSync(configPath, 'utf8');
  } else {
    text = fallbackTemplate;
    if (text === '') throw new Error('config template missing');
  }
  const span = frontmatterSpan(text);
  if (span === null) throw new Error('config.md 没有 frontmatter');
  let frontmatter = setTopField(span.text, 'sessionCapture', enabled ? 'true' : 'false');
  const updated = replaceFrontmatter(text, frontmatter);
  if (updated === null) throw new Error('config.md 没有 frontmatter');
  writeFileSync(configPath, updated, 'utf8');
}

/**
 * Write `.deepseek/config.md` `budget` (injection-budget tier), applied by the preset.
 *
 * WHY the VAULT file rather than the plugin's own settings (changelog 2026-09-17,
 * 「注入预算档位」): the budget is PRESET-layer configuration and `agent.cordis.yml` is a
 * bootstrap-time build artifact with no channel from the plugin, so a settings toggle
 * that only wrote `data.json` would write somewhere nothing reads. This file already
 * carries per-vault overrides of preset settings (`sessionCapture`, `audit`, …) and
 * already establishes the "vault overrides preset, field by field" convention — so the
 * tier goes here and the settings page becomes a thin writer over it.
 *
 * Mirrors `setSessionCapture`: minimal frontmatter diff, creates the file from the
 * template when absent, and refuses to guess when there is no frontmatter to edit.
 */
export function setMemoryBudget(root, tier, fallbackTemplate = '') {
  const configPath = join(root, MEMORY_DIR, 'config.md');
  let text;
  if (existsSync(configPath)) {
    text = readFileSync(configPath, 'utf8');
  } else {
    text = fallbackTemplate;
    if (text === '') throw new Error('config template missing');
  }
  const span = frontmatterSpan(text);
  if (span === null) throw new Error('config.md 没有 frontmatter');
  const frontmatter = setTopField(span.text, 'budget', String(tier));
  const updated = replaceFrontmatter(text, frontmatter);
  if (updated === null) throw new Error('config.md 没有 frontmatter');
  writeFileSync(configPath, updated, 'utf8');
}

/** Read whether session capture is enabled (missing config → default off). */
export function readSessionCaptureEnabled(root) {
  const configPath = join(root, MEMORY_DIR, 'config.md');
  try {
    const raw = readFileSync(configPath, 'utf8');
    const { meta } = parseMemoryFrontmatter(raw, () => null);
    return meta.sessionCapture === 'true';
  } catch {
    return false;
  }
}
