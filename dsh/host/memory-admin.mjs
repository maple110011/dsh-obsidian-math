// dsh/host/memory-admin.mjs — host-agnostic memory administration core.
// Deterministic file operations + panel data collection for the math-memory
// system. Pure node:fs/path, no Obsidian import; both the Obsidian plugin
// (via the embedded loader) and the future dsh host web route consume this.
// Generated from obsidian/main.template.js (single source of truth).

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync
} from "node:fs";
import { join, dirname } from "node:path";
import { zstdDecompressSync } from "node:zlib";

export const FEEDBACK_MESSAGES = {
  confirm: '已确认 ✅ 该记忆升级为 user-confirmed（成功率提至 ≥0.9）',
  wrong: '已记录 ❌ 该记忆成功率减半，明日体检将重新评估',
  inapplicable: '已记录 🔁 该记忆在此上下文不适用（不降成功率，保留原验证等级）',
  stale: '已标记 superseded（保留证据，不删除）',
  forget: '已归档到 .deepseek/archive/records/'
};

export function pathInside(root, child) {
  const norm = (p) => {
    const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? n.toLowerCase() : n;
  };
  const r = norm(root);
  const c = norm(child);
  return c === r || c.startsWith(r + '/');
}

/**
 * Set `field: value` inside a block-style hook block (appends the line when
 * absent). Returns the new frontmatter text, or null when there is no
 * block-style hook (flow-style `hook: { ... }` is left untouched).
 */
export function setHookField(frontmatterText, field, value) {
  const lines = frontmatterText.split(/\r?\n/);
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
  return [...lines.slice(0, hookIdx + 1), ...updated, ...lines.slice(endIdx)]
    .join(frontmatterText.includes('\r\n') ? '\r\n' : '\n');
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
  return updated.join(frontmatterText.includes('\r\n') ? '\r\n' : '\n');
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
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fmMatch === null) throw new Error('capture-policy.md 没有 frontmatter');
  let frontmatter = setTopField(fmMatch[1], field, mode);
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  frontmatter = setTopField(frontmatter, 'updated', today);
  writeFileSync(policyPath, text.replace(fmMatch[1], frontmatter), 'utf8');
}

/** Apply one feedback action to a card file (in place, minimal diff). */
export function applyFeedback(filePath, action) {
  const text = readFileSync(filePath, 'utf8');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fmMatch === null) return { ok: false, message: '该文件没有 frontmatter' };
  let frontmatter = fmMatch[1];
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
  } else if (action === 'wrong') {
    // Demote (self-correction.md P1b): a ❌ means the card's CONTENT is wrong
    // (unlike `inapplicable`, which is context-only). Halve success_rate but
    // cap it below the weak threshold (0.4) so the next audit actually
    // re-evaluates; downgrade the verification level one step so a
    // user-confirmed card does not keep its ✅ badge; and flag needs_review
    // for the deterministic re-review list (self-correction.md P2).
    const rateMatch = /^(\s*)success_rate:\s*([0-9.]+)\s*$/m.exec(frontmatter);
    const current = rateMatch === null ? 0.5 : parseFloat(rateMatch[2]);
    const base = Number.isFinite(current) ? current : 0.5;
    const next = Math.min(Math.max(0.05, Math.round(base * 0.5 * 100) / 100), 0.35);
    const rated = setHookField(frontmatter, 'success_rate', String(next));
    if (rated === null) return { ok: false, message: '该卡片没有 hook 块' };
    frontmatter = rated;
    const verifiedMatch = /^(\s*)verified:\s*["']?(user-confirmed|cross-referenced|single-source)["']?\s*$/m.exec(frontmatter);
    if (verifiedMatch !== null && verifiedMatch[2] === 'user-confirmed') {
      frontmatter = frontmatter.replace(verifiedMatch[0], `${verifiedMatch[1]}verified: cross-referenced`);
    } else if (verifiedMatch !== null && verifiedMatch[2] === 'cross-referenced') {
      frontmatter = frontmatter.replace(verifiedMatch[0], `${verifiedMatch[1]}verified: single-source`);
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    frontmatter = setTopField(frontmatter, 'last_wrong', today);
    frontmatter = setTopField(frontmatter, 'needs_review', 'true');
  } else if (action === 'inapplicable') {
    // "Not applicable to this context" is NOT evidence the card is wrong:
    // leave success_rate/verified/status untouched so a correct technique is
    // not degraded by a single misapplication (MemTrapBench "Trauma" trap).
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    frontmatter = setTopField(frontmatter, 'last_not_applicable', today);
  } else if (action === 'stale') {
    frontmatter = setTopField(frontmatter, 'status', 'superseded');
  }
  const updated = text.replace(fmMatch[1], frontmatter);
  if (updated !== text) writeFileSync(filePath, updated, 'utf8');
  return { ok: true, message: FEEDBACK_MESSAGES[action] };
}

/** Move a memory file into the vault archive (never a hard delete). */
export function archiveMemoryFile(vaultPath, relParts) {
  const archiveDir = join(vaultPath, '.deepseek', 'archive', 'records');
  mkdirSync(archiveDir, { recursive: true });
  const fileName = relParts[relParts.length - 1];
  const stem = fileName.replace(/\.md$/i, '');
  let target = join(archiveDir, fileName);
  let suffix = 1;
  while (existsSync(target)) {
    target = join(archiveDir, stem + '-' + suffix + '.md');
    suffix += 1;
  }
  renameSync(join(vaultPath, ...relParts), target);
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
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '');
  if (match === null) return { meta: {}, hook: null };
  const meta = {};
  let inHook = false;
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!inHook) {
      if (/^hook:\s*$/.test(trimmed)) { inHook = true; continue; }
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
      if (pair !== null) meta[pair[1]] = pair[2].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (line !== '' && !/^\s/.test(line)) { inHook = false; continue; }
  }
  return { meta, hook: hookParser(match[1]) };
}

export function titleOf(text, fallback) {
  const metaTitle = /^title:\s*(.+)$/m.exec(text ?? '')?.[1]?.trim();
  if (metaTitle !== undefined && metaTitle !== '') return metaTitle.replace(/^['"]|['"]$/g, '');
  const heading = /^#\s+(.+)$/m.exec(text ?? '')?.[1]?.trim();
  return heading ?? fallback;
}

export function daysSinceText(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr ?? '');
  if (match === null) return '';
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const days = Math.floor((Date.now() - day.getTime()) / 86400000);
  return days > 0 ? `${days} 天前` : '今天';
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
      return {
        rel: rel(dir, name),
        name,
        title: titleOf(text, name.replace(/\.md$/, '')),
        type: meta.type ?? '',
        status: meta.status ?? 'active',
        updated: meta.updated ?? '',
        topic: meta.topic ?? '',
        hook,
        uses: Number.isFinite(Number(hook?.uses)) ? Number(hook.uses) : 0,
        successRate: Number.isFinite(Number(hook?.success_rate)) ? Number(hook.success_rate) : null,
        lastUsed: typeof hook?.last_used === 'string' ? hook.last_used : '',
        verified: typeof hook?.verified === 'string' ? hook.verified : null,
        operator: typeof hook?.operator === 'string' ? hook.operator : '',
        history: hookHistory.get(`${dir}/${name}`) ?? []
      };
    })
    .filter((entry) => entry !== null);
  const matches = (entry) => filter === '' ||
    `${entry.title} ${entry.operator} ${entry.type} ${entry.topic}`.toLowerCase().includes(filter);
  const records = cardEntries('.deepseek/memory/records').filter(matches);
  const templates = cardEntries('.deepseek/memory/templates').filter(matches);
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
        status: meta.status ?? 'inbox',
        updated: meta.updated ?? '',
        topic: meta.topic ?? ''
      };
    })
    .filter((entry) => entry !== null && (filter === '' || `${entry.title} ${entry.topic}`.toLowerCase().includes(filter)));
  const episodes = [];
  try {
    episodes.push(...readdirSync(join(vaultPath, '.deepseek', 'memory', 'episodes'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md' && !entry.name.startsWith('_'))
      .map((entry) => {
        const filePath = join(vaultPath, '.deepseek', 'memory', 'episodes', entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(filePath).mtimeMs;
        } catch {
          // keep 0
        }
        return { rel: rel('.deepseek/memory/episodes', entry.name), name: entry.name, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs));
  } catch {
    // episodes dir missing: stay empty
  }
  const profile = existsSync(join(vaultPath, '.deepseek', 'memory', 'profile.md'));
  const auditText = readAuditText(join(vaultPath, '.deepseek', 'cache', 'memory-audit.json'));
  const capturePolicy = (() => {
    try {
      const raw = readFileSync(join(vaultPath, '.deepseek', 'capture-policy.md'), 'utf8');
      const { meta } = parseMemoryFrontmatter(raw, hookParser);
      const mode = (value, fallback) => typeof value === 'string' && ['auto', 'ask', 'off'].includes(value) ? value : fallback;
      return { idea: mode(meta.idea, 'ask'), fact: mode(meta.fact, 'auto'), preference: mode(meta.preference, 'auto') };
    } catch {
      return { idea: 'ask', fact: 'auto', preference: 'auto' };
    }
  })();
  return { records, templates, memos, episodes, profile, auditText, capturePolicy };
}

export function readAuditText(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed?.report === 'string' && parsed.report !== '') return parsed.report;
  } catch {
    // no report yet
  }
  return '';
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
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, maxFiles);
}

function distillSession(events, { userClip = 500, assistantClip = 320 } = {}) {
  const entry = { id: undefined, title: undefined, cwd: undefined, createdAt: undefined, messages: [] };
  for (const event of events) {
    if (event?.type === 'session' && typeof event.id === 'string') {
      entry.id = event.id;
      entry.cwd = typeof event.cwd === 'string' ? event.cwd : entry.cwd;
      entry.createdAt = typeof event.createdAt === 'number' ? event.createdAt : entry.createdAt;
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

function appendEpisodeIndex(root, stem, title) {
  const indexPath = join(root, MEMORY_DIR, 'memory', 'episodes', 'index.md');
  const line = `- [[${stem}|${title}]]`;
  try {
    let text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
    if (text.includes(`[[${stem}`)) return;
    if (text !== '' && !text.endsWith('\n')) text += '\n';
    writeFileSync(indexPath, `${text}${line}\n`, 'utf8');
  } catch {
    // best-effort
  }
}

export function runSessionCapture(root, sessionsRoot, state = undefined) {
  const next = state !== undefined && state !== null && typeof state === 'object' && state.schemaVersion === CAPTURE_SCHEMA_VERSION
    ? { schemaVersion: state.schemaVersion, sessions: { ...(state.sessions ?? {}) } }
    : { schemaVersion: CAPTURE_SCHEMA_VERSION, sessions: {} };
  const captured = [];
  for (const log of findSessionLogs(sessionsRoot, CAPTURE_SCAN_LIMIT)) {
    let events;
    try {
      events = decodeSessionLog(readFileSync(log.path));
    } catch {
      continue;
    }
    const entry = distillSession(events, { userClip: CAPTURE_USER_CLIP, assistantClip: CAPTURE_ASSISTANT_CLIP });
    if (entry.id === undefined || entry.messages.length === 0) continue;
    if (!pathInside(root, entry.cwd ?? '')) continue;
    const fingerprint = `${log.path}|${log.mtimeMs}|${log.size}`;
    const prior = next.sessions[entry.id];
    if (prior !== undefined && prior.fingerprint === fingerprint) continue;
    const plan = planSessionDelta(entry, prior);
    if (plan === null) {
      next.sessions[entry.id] = { lastSeq: prior?.lastSeq ?? -1, fingerprint, file: prior?.file ?? '' };
      continue;
    }
    const body = renderConversationTail(plan.delta, CAPTURE_MAX_SESSION_CHARS);
    if (body === null) {
      next.sessions[entry.id] = { lastSeq: plan.lastSeq, fingerprint, file: prior?.file ?? '' };
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
        const header = [
          `# ${entry.title ?? entry.id}`,
          '',
          `> sessionId: ${entry.id} · 自动保存对话 · ${date}`,
          '',
          '## 对话（不含思考）',
          ''
        ].join('\n');
        writeFileSync(abs, `${header}${body}\n`, 'utf8');
      } else {
        const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
        const sep = existing.endsWith('\n') ? '' : '\n';
        writeFileSync(abs, `${existing}${sep}${body}\n`, 'utf8');
      }
      appendEpisodeIndex(root, stem, entry.title ?? entry.id);
      captured.push({ id: entry.id, rel, lastSeq: plan.lastSeq });
      next.sessions[entry.id] = { lastSeq: plan.lastSeq, fingerprint, file: rel };
    } catch {
      // best-effort; leave the marker untouched so it retries next time
    }
  }
  try {
    mkdirSync(join(root, MEMORY_DIR, 'cache'), { recursive: true });
    writeFileSync(join(root, CAPTURE_FILE), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // marker persistence is best-effort
  }
  return { captured, state: next };
}

/** Count in-vault sessions that still have uncaptured messages (for the panel badge). */
export function countUncapturedSessions(root, sessionsRoot) {
  const state = readCaptureState(root);
  let count = 0;
  for (const log of findSessionLogs(sessionsRoot, CAPTURE_SCAN_LIMIT)) {
    let events;
    try {
      events = decodeSessionLog(readFileSync(log.path));
    } catch {
      continue;
    }
    const entry = distillSession(events, { userClip: CAPTURE_USER_CLIP, assistantClip: CAPTURE_ASSISTANT_CLIP });
    if (entry.id === undefined || entry.messages.length === 0) continue;
    if (!pathInside(root, entry.cwd ?? '')) continue;
    const fingerprint = `${log.path}|${log.mtimeMs}|${log.size}`;
    const prior = state.sessions[entry.id];
    if (prior !== undefined && prior.fingerprint === fingerprint) continue;
    if (planSessionDelta(entry, prior) === null) continue;
    count += 1;
  }
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
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fmMatch === null) throw new Error('config.md 没有 frontmatter');
  let frontmatter = setTopField(fmMatch[1], 'sessionCapture', enabled ? 'true' : 'false');
  writeFileSync(configPath, text.replace(fmMatch[1], frontmatter), 'utf8');
}

/** Read whether session capture is enabled (missing config → default on). */
export function readSessionCaptureEnabled(root) {
  const configPath = join(root, MEMORY_DIR, 'config.md');
  try {
    const raw = readFileSync(configPath, 'utf8');
    const { meta } = parseMemoryFrontmatter(raw, () => null);
    return meta.sessionCapture !== 'false';
  } catch {
    return true;
  }
}
