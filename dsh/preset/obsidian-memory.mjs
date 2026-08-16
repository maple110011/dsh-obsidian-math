/**
 * obsidian-memory — cross-session memory injection for the `obsidian` dsh
 * agent preset. It also applies the sibling obsidian-notes.mjs plugin on the
 * same context, which registers note_search / note_create / note_links.
 *
 * What it does, on every system-prompt assembly for this agent:
 *   1. Reads the vault's durable memory files (`.deepseek/memory/*` and a
 *      one-line digest of `.deepseek/inbox/*`). These are maintained BY THE
 *      MODEL through the ordinary file tools, per the vault's AGENTS.md.
 *   2. Distills a small dialogue index from this machine's past dsh session
 *      logs (session.jsonl.zstd files under `$DSH_HOME/sessions/`) — recent user
 *      questions plus short assistant conclusions — so a brand-new session
 *      no longer starts from zero.
 *   3. Runs a deterministic memory health check (memory v2, informed by
 *      arXiv:2606.31191 ISM): scans records/templates/inbox frontmatter and
 *      hook fields at most once per day per vault, writes
 *      `<vault>/.deepseek/cache/memory-audit.json`, syncs usage statistics
 *      back into the cards' hook.uses / hook.last_used (block-style hook
 *      blocks only), and injects a bounded audit section into the prompt.
 *   4. Appends one bounded "obsidian:memory" section to the assembled system
 *      prompt.
 *
 * It never calls the model. Its only user-file mutation is the deterministic
 * hook-stats sync described above (opt-out via auditMaintainHookStats: false);
 * its own cache files live at `<vault>/.deepseek/cache/*`.
 *
 * Session logs are concatenated Zstandard frames (one JSONL batch per frame).
 * Node >= 22.5 provides zstd through node:zlib; on older runtimes the
 * dialogue index is skipped and only vault memory files are injected.
 */

import * as zlib from "node:zlib";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export const name = "obsidian-memory";
export const inject = ["tools", "fs", "systemPrompt", "loader"];

const ZSTD_MAGIC = 4247762216; // little-endian 28 B5 2F FD
const MEMORY_DIR = ".deepseek";
const CACHE_DIR = join(MEMORY_DIR, "cache");
const CACHE_FILE = join(CACHE_DIR, "dialogue-index.json");
// Semantic version of the dialogue index. Bump whenever the index builder's
// semantics change (e.g. the vault-containment filter added in 0.4.0): the
// on-disk cache is only reused when its version matches, so a stale cache
// written by older code can never leak cross-workspace content again.
const DIALOGUE_INDEX_VERSION = 2;
const LOG_SUFFIX = ".jsonl.zstd";
const MAX_LOG_FILES = 20;
// Layered injection budget (arXiv:2606.24775): the prompt carries navigation
// layers only; raw evidence lives on disk and is reached via grep/read.
// Slimmed static budgets (memory v2 recall injection): indexes are now
// navigation-only; the per-request recall section carries the top-k relevant
// content, so static layers no longer need to be exhaustive.
const MAX_PROFILE_CHARS = 4000;
const MAX_TOPIC_INDEX_CHARS = 1800;
const MAX_RECORD_INDEX_CHARS = 800;
const MAX_TEMPLATE_INDEX_CHARS = 600;
const MAX_EPISODE_INDEX_CHARS = 1200;
const MAX_INBOX_CHARS = 1200;
const MAX_DIALOGUE_PAIRS = 6;
const MAX_DIALOGUE_CHARS = 3000;
const DEFAULT_MAX_HISTORY_ENTRIES = 40;
const DEFAULT_MAX_HISTORY_CHARS = 6000;
const DEFAULT_RECALL_TOP_K = 6;
const DEFAULT_RECALL_MAX_CHARS = 2200;
// Memory-v2 audit pass (arXiv:2606.31191 ISM, localized): deterministic scan of
// card frontmatter + hook fields, at most once per vault per auditIntervalMs.
const AUDIT_FILE = join(CACHE_DIR, "memory-audit.json");
const RETRIEVAL_STATS_FILE = join(CACHE_DIR, "retrieval-stats.json");
const DEFAULT_AUDIT_INTERVAL_MS = 86400000; // 24h
const MAX_AUDIT_CHARS = 1200;
const AUDIT_CARD_DIRS = [join(MEMORY_DIR, "memory", "records"), join(MEMORY_DIR, "memory", "templates")];
const AUDIT_UNUSED_DAYS = 30;
const AUDIT_UNVERIFIED_DAYS = 60;
const AUDIT_WEAK_USES = 3;
const AUDIT_WEAK_RATE = 0.4;
const AUDIT_STRONG_RATE = 0.8;
const AUDIT_DUP_JACCARD = 0.7;
const AUDIT_CARD_SCAFFOLD = new Set(["index.md", "_README.md"]);

// ── zstd session-log decoding ───────────────────────────────────────────────

/** Locate every complete Zstandard frame in a concatenated-frame file. */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return frames;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`obsidian-memory: bad zstd frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return frames; // torn header after magic
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`obsidian-memory: reserved zstd frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const hasChecksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return frames; // torn header
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames; // torn block header
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`obsidian-memory: reserved zstd block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames; // torn payload
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (hasChecksum) {
      if (buffer.length - offset < 4) return frames; // torn checksum
      offset += 4;
    }
    frames.push([start, offset]);
  }
  return frames;
}

/** Decode one full session artifact into its JSONL event objects. */
export function decodeZstdSessionLog(buffer) {
  const events = [];
  if (typeof zlib.zstdDecompressSync !== "function") return events;
  for (const [start, end] of scanZstdFrames(buffer)) {
    let text;
    try {
      text = zlib.zstdDecompressSync(buffer.subarray(start, end)).toString("utf8");
    } catch {
      continue; // tolerate a torn/foreign final frame; keep committed frames
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore malformed individual lines; the durable log is append-only.
      }
    }
  }
  return events;
}

// ── text extraction ─────────────────────────────────────────────────────────

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function clip(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).replace(/\s+\S*$/, "")} …`;
}

/**
 * Walk one decoded session into a compact entry:
 * `{ id, title, cwd, messages: [{ role, text, time }] }`.
 * Plugin-injected user messages (runtime-context snapshots, approval notices)
 * are skipped; only real human turns (`source.kind === "user"`) count.
 */
export function distillSession(events) {
  const entry = { id: undefined, title: undefined, cwd: undefined, messages: [] };
  for (const event of events) {
    if (event?.type === "session" && typeof event.id === "string") {
      entry.id = event.id;
      entry.cwd = typeof event.cwd === "string" ? event.cwd : entry.cwd;
    } else if (event?.type === "session/title" && typeof event.data?.title === "string") {
      entry.title = event.data.title;
    } else if (event?.type === "user/message" && event.data?.source?.kind === "user") {
      const text = contentText(event.data.content);
      if (text !== "") {
        entry.messages.push({ role: "user", text: clip(text, 500), time: event.time ?? 0 });
      }
    } else if (event?.type === "assistant/message") {
      const text = contentText(event.data?.message?.content);
      if (text !== "") {
        entry.messages.push({ role: "assistant", text: clip(text, 320), time: event.time ?? 0 });
      }
    }
  }
  return entry;
}

// ── session root walking ────────────────────────────────────────────────────

/** Recursively list session artifacts, newest first, bounded by `maxFiles`. */
export function findSessionLogs(sessionsRoot, maxFiles = MAX_LOG_FILES) {
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
      else if (child.isFile() && child.name.endsWith(LOG_SUFFIX)) {
        try {
          const stats = statSync(path);
          found.push({ path, mtimeMs: stats.mtimeMs, size: stats.size });
        } catch {
          // Gone while walking; skip.
        }
      }
    }
  };
  walk(sessionsRoot);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, maxFiles);
}

/**
 * Build the dialogue index used by the memory section: recent user turns and
 * the assistant texts that followed, flattened in time order.
 */
export function buildDialogueIndex(sessionsRoot, maxEntries, maxChars, maxFiles = MAX_LOG_FILES, vaultRoot = "") {
  const sources = [];
  const sessions = [];
  for (const log of findSessionLogs(sessionsRoot, maxFiles)) {
    let buffer;
    try {
      buffer = readFileSync(log.path);
    } catch {
      continue;
    }
    let events = [];
    try {
      events = decodeZstdSessionLog(buffer);
    } catch {
      continue;
    }
    const entry = distillSession(events);
    if (entry.id !== undefined && entry.messages.length > 0) {
      // Only sessions that ran inside this vault join the index: coding
      // sessions from other workspaces must not leak into the math assistant.
      if (vaultRoot !== "" && !pathIsInside(vaultRoot, entry.cwd ?? "")) continue;
      sources.push({ path: log.path, mtimeMs: log.mtimeMs, size: log.size });
      sessions.push(entry);
    }
  }

  // Turn each real user message into a Q/A pair: the question plus the FINAL
  // assistant reply of that turn (the last assistant message before the next
  // user message; the old first-message pairing often captured "让我查一下"
  // openers instead of conclusions).
  const threads = [];
  for (const session of sessions) {
    for (const pair of pairMessages(session.messages)) {
      threads.push({ sessionId: session.id, title: session.title, cwd: session.cwd, time: pair.time, user: pair.user, assistant: pair.assistant });
    }
  }
  threads.sort((a, b) => a.time - b.time);

  const entries = [];
  let used = 0;
  for (const thread of threads.slice(-maxEntries).reverse()) {
    const question = thread.user.text;
    const answer = thread.assistant?.text ?? "";
    const questionBudget = Math.min(question.length, 400);
    const answerBudget = Math.min(answer.length, 240);
    if (used + questionBudget + answerBudget > maxChars) break;
    entries.push({
      sessionId: thread.sessionId,
      title: typeof thread.title === "string" ? thread.title : undefined,
      role: "user",
      text: question.slice(0, questionBudget),
      time: thread.time
    });
    used += questionBudget;
    if (answerBudget > 0) {
      entries.push({
        sessionId: thread.sessionId,
        title: typeof thread.title === "string" ? thread.title : undefined,
        role: "assistant",
        text: answer.slice(0, answerBudget),
        time: thread.time
      });
      used += answerBudget;
    }
  }
  return {
    schemaVersion: DIALOGUE_INDEX_VERSION,
    generatedAt: Date.now(),
    sources,
    entries
  };
}

// ── durable vault memory files ──────────────────────────────────────────────

function readMemoryFile(root, relativePath, maxChars) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return "";
  try {
    return clip(readFileSync(path, "utf8").trim(), maxChars);
  } catch {
    return "";
  }
}

/** Files that are memo-library scaffolding, not memos. */
const MEMO_SCAFFOLD = new Set(["index.md", "_README.md"]);
const MEMO_STATES = new Set(["inbox", "polishing", "done"]);
const MEMO_STALE_INBOX_DAYS = 7;
const MEMO_STALE_POLISHING_DAYS = 3;

/** Parse the YAML-ish frontmatter of one memo plus its first `#` title. */
export function parseMemoFrontmatter(text) {
  const meta = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? "");
  if (match !== null) {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
      if (pair !== null) meta[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const title = /^#\s+(.+)$/m.exec(text ?? "")?.[1]?.trim();
  if (title !== undefined && meta.title === undefined) meta.title = title;
  return meta;
}

// ── capture policy (control surface 1c) ────────────────────────────────────

const CAPTURE_POLICY_FILE = join(MEMORY_DIR, "capture-policy.md");
const CAPTURE_MODES = new Set(["auto", "ask", "off"]);
const DEFAULT_CAPTURE_POLICY = { idea: "ask", fact: "auto", preference: "auto" };

/**
 * Parse the vault's user-maintained capture policy
 * (.deepseek/capture-policy.md frontmatter): idea / fact / preference ×
 * auto / ask / off. Missing file, missing fields, or unknown values fall
 * back to the defaults — which reproduce the pre-policy behavior (ideas ask,
 * facts and preferences auto per the three-write protocol).
 */
export function parseCapturePolicy(text) {
  const policy = { ...DEFAULT_CAPTURE_POLICY };
  if (typeof text !== "string" || text === "") return policy;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return policy;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^(idea|fact|preference):\s*([A-Za-z_-]+)\s*$/.exec(line.trim());
    if (pair !== null && CAPTURE_MODES.has(pair[2])) policy[pair[1]] = pair[2];
  }
  return policy;
}

function capturePolicyText(root) {
  const path = join(root, CAPTURE_POLICY_FILE);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseLocalDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (match === null) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function daysSinceLocal(value) {
  const day = parseLocalDay(value);
  if (day === null) return null;
  return Math.floor((Date.now() - day.getTime()) / 86400000);
}

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Memo status digest: group live memos by lifecycle state and surface the
 * top reminder candidates. Candidates are now BOTH time-stale (inbox >= 7
 * days, polishing >= 3 days) AND relevance-scored against the current user
 * message — a memo being actively discussed surfaces even before it goes
 * stale. Ranking: 0.7 × relevance + 0.3 × recency (days/30, capped at 1).
 */
export function memoDigest(root, maxChars, query = "", helpers = undefined) {
  const memoDir = join(root, MEMORY_DIR, "inbox");
  if (!existsSync(memoDir)) return "";
  let files = [];
  try {
    files = readdirSync(memoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !MEMO_SCAFFOLD.has(entry.name) && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
  } catch {
    return "";
  }
  if (files.length === 0) return "";

  const groups = { inbox: [], polishing: [], done: [] };
  const today = localDateString();
  // Relevance scores: one doc per memo (title + body head), IDF over memos.
  const canScore = query !== "" && typeof helpers?.tokenize === "function" && typeof helpers?.weightedOverlap === "function";
  const queryTokens = canScore ? helpers.tokenize(query) : [];
  const memoDocs = [];
  for (const file of files) {
    let text = "";
    try {
      text = readFileSync(join(memoDir, file), "utf8");
    } catch {
      // keep empty; the memo still lists, just scores 0
    }
    memoDocs.push({ file, text });
  }
  const tokenizedDocs = memoDocs.map((doc) => helpers.tokenize((doc.file + " " + doc.text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").slice(0, 1500))));
  const docFreq = canScore ? helpers.computeDocFreq(tokenizedDocs) : null;

  for (let i = 0; i < memoDocs.length; i += 1) {
    const file = memoDocs[i].file;
    let meta;
    try {
      meta = parseMemoFrontmatter(memoDocs[i].text);
    } catch {
      continue;
    }
    const slug = file.replace(/\.md$/, "");
    const status = MEMO_STATES.has(meta.status) ? meta.status : "inbox";
    const updated = meta.updated ?? "";
    const days = daysSinceLocal(updated);
    const relevance = canScore && queryTokens.length > 0 ? helpers.weightedOverlap(queryTokens, tokenizedDocs[i], docFreq) : 0;
    const item = {
      slug,
      title: meta.title || slug,
      topic: meta.topic || "未归类",
      updated,
      days,
      stale: days !== null && days >= (status === "polishing" ? MEMO_STALE_POLISHING_DAYS : MEMO_STALE_INBOX_DAYS),
      alreadyReminded: meta.last_reminded === today,
      relevance
    };
    groups[status].push(item);
  }

  const stateLabel = { inbox: "待打磨", polishing: "打磨中", done: "已完成" };
  const lines = [];
  for (const status of ["inbox", "polishing", "done"]) {
    const members = groups[status].sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
    if (members.length === 0) continue;
    lines.push(`- ${stateLabel[status]}（${status}）· ${members.length} 条`);
    for (const memo of members) {
      const parts = [`[[${memo.slug}|${memo.title}]]`, `主题:${memo.topic}`];
      if (memo.updated !== "") parts.push(`updated:${memo.updated}`);
      lines.push(`  - ${parts.join(" · ")}`);
    }
  }

  const candidates = [...groups.inbox, ...groups.polishing]
    .filter((memo) => !memo.alreadyReminded && (memo.stale || memo.relevance >= 0.15))
    .map((memo) => ({
      ...memo,
      rank: 0.7 * memo.relevance + 0.3 * Math.min(1, (memo.days ?? 0) / 30)
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3);
  if (candidates.length > 0) {
    lines.push("- 🔔 提醒候选（陈旧或与当前讨论相关，按相关性×新鲜度排序）");
    for (const memo of candidates) {
      const reason = memo.stale ? `${memo.days} 天未更新` : "与当前讨论相关";
      lines.push(`  - [[${memo.slug}|${memo.title}]]：${reason}（相关度 ${memo.relevance.toFixed(2)}），可在相关讨论时建议打磨`);
    }
  }

  return clip(lines.join("\n"), maxChars);
}

// ── memory v2: deterministic audit pass (ISM Self-Audit, localized) ─────────

/** Load the retrieval-stats cache written by note_recall (best-effort). */
function readRetrievalStats(root) {
  const path = join(root, RETRIEVAL_STATS_FILE);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Rewrite a block-style hook's uses/last_used lines inside the frontmatter
 * text; returns the new frontmatter or null when there is no block-style hook
 * (flow-style `hook: { ... }` is deliberately left untouched).
 */
function rewriteHookStats(frontmatterText, uses, lastUsed) {
  const lines = frontmatterText.split(/\r?\n/);
  const hookIdx = lines.findIndex((line) => /^hook:\s*$/.test(line));
  if (hookIdx === -1) return null;
  let endIdx = hookIdx + 1;
  while (endIdx < lines.length && (lines[endIdx].trim() === "" || /^\s/.test(lines[endIdx]))) endIdx += 1;
  const block = lines.slice(hookIdx + 1, endIdx);
  let usesSeen = false;
  let lastUsedSeen = false;
  const updated = block.map((line) => {
    const match = /^(\s*)(uses|last_used):\s*(.*)$/.exec(line);
    if (match !== null && match[2] === "uses") { usesSeen = true; return `${match[1]}uses: ${uses}`; }
    // An empty lastUsed means "never used": leave any existing value as the
    // user/model wrote it and never invent a date.
    if (match !== null && match[2] === "last_used" && lastUsed !== "") { lastUsedSeen = true; return `${match[1]}last_used: ${lastUsed}`; }
    return line;
  });
  if (!usesSeen) updated.push(`  uses: ${uses}`);
  if (!lastUsedSeen && lastUsed !== "") updated.push(`  last_used: ${lastUsed}`);
  return [...lines.slice(0, hookIdx + 1), ...updated, ...lines.slice(endIdx)].join(frontmatterText.includes("\r\n") ? "\r\n" : "\n");
}

/**
 * Best-effort deterministic sync of usage statistics into a card's hook block.
 * Only touches `uses` / `last_used` lines; any parse surprise leaves the
 * file untouched. The agent itself never maintains these two fields.
 */
function syncHookStatsToCard(filePath, effectiveUses, lastUsed) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const fmMatch = /^(---\r?\n[\s\S]*?\r?\n---)/.exec(text);
  if (fmMatch === null) return;
  const rewritten = rewriteHookStats(fmMatch[1], effectiveUses, lastUsed);
  if (rewritten === null || rewritten === fmMatch[1]) return;
  try {
    writeFileSync(filePath, text.replace(fmMatch[1], rewritten), "utf8");
  } catch {
    // Stats sync is advisory; never let it break the prompt.
  }
}

/**
 * Scan every memory card once, merge the note_recall hit statistics, and
 * classify cards into ISM-style buckets: strong / weak / unused / duplicate
 * candidates / unverified. Pure function of the vault's files — no model.
 */
export function buildAuditReport(root, helpers) {
  const stats = readRetrievalStats(root);
  const today = localDateString();
  const cards = [];

  for (const dir of AUDIT_CARD_DIRS) {
    const absDir = join(root, dir);
    let files = [];
    try {
      files = readdirSync(absDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !AUDIT_CARD_SCAFFOLD.has(entry.name) && !entry.name.startsWith("_"))
        .map((entry) => entry.name);
    } catch {
      continue; // directory missing: nothing to audit there yet
    }
    for (const file of files) {
      const filePath = join(absDir, file);
      let text;
      try {
        text = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const meta = parseMemoFrontmatter(text);
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const hook = fmMatch === null ? null : (helpers.parseHookFrontmatter?.(fmMatch[1]) ?? null);
      const rel = join(dir, file).replace(/\\/g, "/");
      const statEntry = stats[rel] ?? {};
      const statUses = Number.isFinite(statEntry.uses) ? statEntry.uses : 0;
      const baseUses = Number.isFinite(Number(hook?.uses)) ? Number(hook.uses) : 0;
      const uses = Math.max(0, Math.trunc(baseUses + statUses));
      const lastUsed = typeof statEntry.last_used === "string" && statEntry.last_used !== ""
        ? statEntry.last_used
        : (typeof hook?.last_used === "string" ? hook.last_used : "");
      const successRate = Number.isFinite(Number(hook?.success_rate)) ? Number(hook.success_rate) : null;
      const days = daysSinceLocal(meta.updated ?? "");
      cards.push({
        rel,
        filePath,
        title: meta.title ?? file.replace(/\.md$/, ""),
        type: meta.type ?? "unknown",
        status: meta.status ?? "active",
        hook,
        uses,
        lastUsed,
        successRate,
        verified: typeof hook?.verified === "string" ? hook.verified : null,
        days,
        updated: meta.updated ?? ""
      });
    }
  }

  // Deterministic hook-stats sync (opt-out via auditMaintainHookStats: false).
  // FIX(B1): after merging the note_recall hit counts into hook.uses, the
  // stats entries are zeroed — otherwise every daily audit re-adds the same
  // hits and uses grows without bound.
  if (helpers.maintainHookStats !== false) {
    let mergedAny = false;
    for (const card of cards) {
      if (card.hook === null) continue; // no block-style hook: nothing to sync
      const statEntry = stats[card.rel] ?? {};
      if (Number.isFinite(statEntry.uses) && statEntry.uses > 0) mergedAny = true;
      syncHookStatsToCard(card.filePath, card.uses, card.lastUsed);
    }
    if (mergedAny) {
      const cleaned = {};
      for (const [rel, entry] of Object.entries(stats)) {
        cleaned[rel] = { uses: 0, last_used: typeof entry?.last_used === "string" ? entry.last_used : "" };
      }
      try {
        writeFileSync(join(root, RETRIEVAL_STATS_FILE), JSON.stringify(cleaned, null, 2), "utf8");
      } catch {
        // best-effort; a failed reset only re-inflates counts, never breaks boot
      }
    }
  }

  // Hook usage history (panel trend): one snapshot per day per hook card, with
  // the merged uses — trends must reflect the final post-merge numbers.
  writeHookHistory(root, cards);

  const strong = cards.filter((card) => card.successRate !== null && card.successRate >= AUDIT_STRONG_RATE && card.uses >= 1);
  const weak = cards.filter((card) => card.successRate !== null && card.successRate <= AUDIT_WEAK_RATE && card.uses >= AUDIT_WEAK_USES);
  const unused = cards.filter((card) => card.uses === 0 && card.status === "active" && (card.days === null || card.days > AUDIT_UNUSED_DAYS));
  const unverified = cards.filter((card) =>
    (card.verified === null || card.verified === "single-source") &&
    card.status === "active" &&
    (card.days === null || card.days > AUDIT_UNVERIFIED_DAYS));

  // Duplicate candidates: same operator, Jaccard(pattern+techniques) >= 0.7.
  const tokenize = helpers.tokenize ?? ((text) => String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const byOperator = new Map();
  for (const card of cards) {
    const operator = normalizeOperatorText(card.hook?.operator);
    if (operator === "") continue;
    const bucket = byOperator.get(operator) ?? [];
    bucket.push(card);
    byOperator.set(operator, bucket);
  }
  const duplicates = [];
  const seenPairs = new Set();
  for (const bucket of byOperator.values()) {
    for (let i = 0; i < bucket.length && duplicates.length < 3; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        const aTokens = new Set(tokenize(`${hookText(a.hook, "pattern")} ${hookText(a.hook, "techniques")}`));
        const bTokens = new Set(tokenize(`${hookText(b.hook, "pattern")} ${hookText(b.hook, "techniques")}`));
        const union = new Set([...aTokens, ...bTokens]);
        const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
        if (union.size === 0) continue;
        const jaccard = intersection / union.size;
        if (jaccard >= AUDIT_DUP_JACCARD) {
          const pairKey = [a.rel, b.rel].sort().join("|");
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          duplicates.push({ a, b, jaccard: Number(jaccard.toFixed(2)) });
        }
      }
    }
  }

  const lines = [];
  const counts = { cards: cards.length, strong: strong.length, weak: weak.length, unused: unused.length, duplicates: duplicates.length, unverified: unverified.length };
  if (cards.length > 0) {
    lines.push(`记忆体检（${today}，共 ${cards.length} 张卡）`);
    for (const [label, items, formatter] of [
      ["strong（可 reinforce）", strong.slice(0, 3), (card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]`],
      ["weak（建议改写并重置成功率）", weak.slice(0, 3), (card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]`],
      ["unused（>30 天零使用）", unused.slice(0, 3), (card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]`],
      ["unverified（单一来源 >60 天）", unverified.slice(0, 3), (card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]`]
    ]) {
      if (items.length === 0) continue;
      lines.push(`- ${label}: ${items.map(formatter).join("、")}`);
    }
    if (duplicates.length > 0) {
      lines.push(`- 疑似重复（同算子、pattern+techniques Jaccard ≥ ${AUDIT_DUP_JACCARD}）: ${duplicates.map(({ a, b }) => `[[${a.rel.replace(/\.md$/, "")}|${a.title}]] ↔ [[${b.rel.replace(/\.md$/, "")}|${b.title}]]`).join("；")}`);
    }
  } else {
    lines.push("（尚无记忆卡，无可体检内容）");
  }

  return {
    generatedAt: Date.now(),
    counts,
    report: clip(lines.join("\n"), MAX_AUDIT_CHARS)
  };
}

// ── hook usage history (panel trend visualization, handoff item 3) ───────

const HOOK_HISTORY_FILE = join(CACHE_DIR, "hook-history.json");
const HOOK_HISTORY_MAX_POINTS = 30;
const HOOK_HISTORY_MAX_CARDS = 500;

/**
 * Pure daily-snapshot builder for the panel trend view: one point per card
 * per day ({date, uses, successRate}); same-day audits update the last point
 * in place instead of appending. Per-card and global bounds keep the file
 * small. Cards without a block-style hook are skipped (nothing to trend).
 */
export function buildHookHistory(existing, cards, today, maxPoints = HOOK_HISTORY_MAX_POINTS, maxCards = HOOK_HISTORY_MAX_CARDS) {
  const prev = existing !== null && typeof existing === "object" && existing.snapshots !== null && typeof existing.snapshots === "object"
    ? existing.snapshots
    : {};
  const snapshots = {};
  for (const card of cards) {
    if (card.hook === null) continue;
    const list = Array.isArray(prev[card.rel]) ? prev[card.rel].slice(0, Math.max(0, maxPoints - 1)) : [];
    const point = { date: today, uses: card.uses, successRate: card.successRate };
    const last = list[list.length - 1];
    if (last !== undefined && last.date === today) list[list.length - 1] = point;
    else list.push(point);
    snapshots[card.rel] = list;
  }
  const keys = Object.keys(snapshots);
  if (keys.length > maxCards) {
    keys.sort((a, b) => (snapshots[b].at(-1)?.date ?? "").localeCompare(snapshots[a].at(-1)?.date ?? ""));
    for (const key of keys.slice(maxCards)) delete snapshots[key];
  }
  return { generatedAt: Date.now(), maxPoints, snapshots };
}

function writeHookHistory(root, cards) {
  let existing = {};
  try {
    const raw = JSON.parse(readFileSync(join(root, HOOK_HISTORY_FILE), "utf8"));
    if (raw !== null && typeof raw === "object") existing = raw;
  } catch {
    // missing/corrupt history: start fresh
  }
  try {
    const next = buildHookHistory(existing, cards, localDateString());
    mkdirSync(join(root, CACHE_DIR), { recursive: true });
    writeFileSync(join(root, HOOK_HISTORY_FILE), JSON.stringify(next, null, 2), "utf8");
  } catch {
    // history is advisory; a failed write must never break the audit
  }
}

function hookText(hook, key) {
  const value = hook?.[key];
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" ? value : "";
}

function normalizeOperatorText(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Pair each user message with the FINAL assistant reply of its turn (the last
 * assistant message before the next user message; falls back to the first
 * assistant after it when the turn had no reply).
 */
export function pairMessages(messages) {
  const sorted = [...messages].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const threads = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const message = sorted[index];
    if (message.role !== "user") continue;
    const nextUser = sorted.findIndex((candidate, j) => j > index && candidate.role === "user");
    const end = nextUser === -1 ? sorted.length : nextUser;
    const turn = sorted.slice(index + 1, end).filter((candidate) => candidate.role === "assistant");
    const answer = turn.length > 0 ? turn[turn.length - 1] : sorted.slice(index + 1).find((candidate) => candidate.role === "assistant");
    threads.push({ time: message.time, user: message, assistant: answer });
  }
  return threads;
}

/** Case/separator-robust prefix containment (win32 lowercases). */
function pathIsInside(root, child) {
  if (typeof root !== "string" || typeof child !== "string" || root === "" || child === "") return false;
  const norm = (value) => {
    const n = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? n.toLowerCase() : n;
  };
  const r = norm(root);
  const c = norm(child);
  return c === r || c.startsWith(r + "/");
}

// ── memory v2: per-request recall injection ────────────────────────────────

/** Last real user message text from the live session, or "" when unavailable. */
export function latestUserText(agent) {
  const session = agent?.session;
  if (session === undefined || session === null) return "";
  const events = Array.isArray(session.log) ? session.log : Array.isArray(session.messages) ? session.messages : null;
  if (events === null) return "";
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === "user/message" && event?.data?.source?.kind === "user") {
      const text = contentText(event.data.content);
      if (text !== "") return clip(text, 400);
    }
  }
  return "";
}

function titleOfMemoryFile(text, fallback) {
  const meta = parseMemoFrontmatter(text);
  if (typeof meta.title === "string" && meta.title !== "") return meta.title;
  const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  return heading ?? fallback;
}

/**
 * Build the recall corpus: one lightweight doc per memory card / memo /
 * topic-index line / recent episode line. Rebuilt only when the memory
 * directories' mtimes change (see MemoryEngine.#recallCache).
 */
export function buildRecallIndex(root, helpers) {
  const docs = [];
  const push = (kind, rel, title, text) => {
    const flat = String(text ?? "").replace(/\s+/g, " ").trim();
    if (flat === "") return;
    docs.push({ kind, rel, title, text: flat });
  };
  for (const dir of [join(MEMORY_DIR, "memory", "records"), join(MEMORY_DIR, "memory", "templates")]) {
    let names = [];
    try {
      names = readdirSync(join(root, dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !AUDIT_CARD_SCAFFOLD.has(entry.name) && !entry.name.startsWith("_"))
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of names) {
      let text;
      try {
        text = readFileSync(join(root, dir, name), "utf8");
      } catch {
        continue;
      }
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const hook = fmMatch === null ? null : (helpers.parseHookFrontmatter?.(fmMatch[1]) ?? null);
      const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").slice(0, 2000);
      const hookText = [hook?.operator, hook?.pattern, hook?.techniques, hook?.applications, hook?.heuristics]
        .filter((part) => Array.isArray(part) ? part.length > 0 : typeof part === "string" && part !== "")
        .flat()
        .join(" ");
      const rel = join(dir, name).replace(/\\/g, "/");
      push("card", rel, titleOfMemoryFile(text, name.replace(/\.md$/, "")), (name + " " + hookText + " " + body).slice(0, 2600));
    }
  }
  const inboxDir = join(MEMORY_DIR, "inbox");
  try {
    for (const entry of readdirSync(join(root, inboxDir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || MEMO_SCAFFOLD.has(entry.name) || entry.name.startsWith("_")) continue;
      let text;
      try {
        text = readFileSync(join(root, inboxDir, entry.name), "utf8");
      } catch {
        continue;
      }
      const rel = join(inboxDir, entry.name).replace(/\\/g, "/");
      push("memo", rel, titleOfMemoryFile(text, entry.name.replace(/\.md$/, "")), text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").slice(0, 1500));
    }
  } catch {
    // inbox missing: nothing to recall from there
  }
  for (const line of readMemoryFile(root, join(MEMORY_DIR, "memory", "topics", "index.md"), 4000).split("\n")) {
    const clean = line.trim();
    if (clean.startsWith("-")) push("topic", "topics/index.md", "主题", clean);
  }
  for (const line of episodeIndexDigest(root, 1200).split("\n")) {
    const clean = line.trim();
    if (clean.startsWith("-")) push("episode", "episodes/index.md", "事件", clean);
  }
  return docs;
}

/** Rank the recall corpus against the query; returns a bounded markdown list. */
export function rankRecall(docs, queryText, helpers, topK, maxChars) {
  const queryTokens = helpers.tokenize(queryText);
  if (queryTokens.length === 0 || docs.length === 0) return "";
  const tokenized = docs.map((doc) => helpers.tokenize(doc.text));
  // memory v3 S2: BM25 replaces the overlap coefficient for recall ranking.
  const stats = typeof helpers.computeCorpusStats === "function"
    ? helpers.computeCorpusStats(tokenized)
    : null;
  const scored = docs.map((doc, i) => ({
    doc,
    score: stats !== null && typeof helpers.bm25Score === "function"
      ? helpers.bm25Score(queryTokens, tokenized[i], stats)
      : helpers.weightedOverlap(queryTokens, tokenized[i], helpers.computeDocFreq(tokenized))
  }));
  scored.sort((a, b) => b.score - a.score);
  const lines = [];
  let used = 0;
  for (const { doc, score } of scored) {
    if (score <= 0) continue;
    const label = doc.kind === "card" ? "记忆卡" : doc.kind === "memo" ? "备忘录" : doc.kind === "topic" ? "主题" : "事件";
    const stem = doc.rel.replace(/\.md$/, "");
    const line = `- [[${stem}|${doc.title}]]（${label}，score ${score.toFixed(2)}）· ${clip(doc.text, 150)}`;
    if (used + line.length + 1 > maxChars) break;
    if (lines.length >= topK) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Episode timeline: keep the newest lines (list items only) within budget. */
function episodeIndexDigest(root, maxChars) {
  const path = join(root, MEMORY_DIR, "memory", "episodes", "index.md");
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text === "") return "";
    const items = text.split("\n").filter((line) => line.trim().startsWith("-"));
    if (items.length === 0) return clip(text, maxChars);
    // Index lines are append-only, newest at the bottom: keep the tail.
    const kept = [];
    let used = 0;
    for (const line of items.reverse()) {
      const clean = clip(line.trim(), maxChars);
      if (used + clean.length > maxChars) break;
      kept.push(clean);
      used += clean.length + 1;
    }
    return kept.reverse().join("\n");
  } catch {
    return "";
  }
}

/** Typed atomic-record digest: keep the index's list lines within budget. */
function recordIndexDigest(root, maxChars) {
  const path = join(root, MEMORY_DIR, "memory", "records", "index.md");
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text === "") return "";
    const items = text.split("\n").filter((line) => line.trim().startsWith("-"));
    if (items.length === 0) return clip(text, maxChars);
    return clip(items.map((line) => line.trim()).join("\n"), maxChars);
  } catch {
    return "";
  }
}

/** Problem-template index digest (personal template-theorems graph). */
function templateIndexDigest(root, maxChars) {
  const path = join(root, MEMORY_DIR, "memory", "templates", "index.md");
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text === "") return "";
    const items = text.split("\n").filter((line) => line.trim().startsWith("-"));
    if (items.length === 0) return clip(text, maxChars);
    return clip(items.map((line) => line.trim()).join("\n"), maxChars);
  } catch {
    return "";
  }
}

// ── the section composer ────────────────────────────────────────────────────
/**
 * Render the layered memory section for one agent.
 *
 * Layout follows the paper's routing philosophy: stable semantics + topic
 * navigation + inbox/episode timelines are always injected (coarse layers);
 * raw episodic evidence is left on disk for grep/read (fine layer). Past
 * dialogue cues are capped at a few Q/A pairs to keep the prompt bounded.
 * `context.agent` supplies the current session id so the live conversation is
 * never duplicated into the "past dialogue" index.
 */
export function buildMemorySection({ vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs }, currentSessionId, dialogueIndex, auditReport, recallText, memoText) {
  const profile = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "profile.md"), MAX_PROFILE_CHARS);
  const topics = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "topics", "index.md"), MAX_TOPIC_INDEX_CHARS);
  const records = recordIndexDigest(vaultRoot, MAX_RECORD_INDEX_CHARS);
  const templates = templateIndexDigest(vaultRoot, MAX_TEMPLATE_INDEX_CHARS);
  const episodes = episodeIndexDigest(vaultRoot, MAX_EPISODE_INDEX_CHARS);
  const memos = memoText ?? memoDigest(vaultRoot, MAX_INBOX_CHARS);

  const lines = [
    "## 分层长期记忆（由 obsidian-memory 自动注入；导航层在此，证据层在磁盘）",
    "",
    "记忆按 arXiv:2606.24775 与 arXiv:2607.05794 的原则组织为五层：profile=语义层，topics=导航层，" +
    "records=类型化原子记录层，episodes=原始证据层，inbox=想法层。以下内容用于“知道去哪找”，不要当作完整证据。" +
    "回答细节问题时必须按路由规则读文件：",
    "- 精确事实 / 用户原话 / 日期数字 → 先 grep `.deepseek/memory/episodes/` 再读命中文件；",
    "- 类型化原子事实（fact/event/instruction/preference）→ 先看 `.deepseek/memory/records/index.md`，再 grep/读具体记录，记录里的 source 可回原始证据；",
    "- 相关定理 / 命题 / 引理 → 先看 `.deepseek/memory/theorems/index.md`，再 grep 笔记全文并核对适用性；",
    "- 主题来龙去脉 → 先读 `.deepseek/memory/topics/index.md` 定位，再读 `topics/<slug>.md` 或相关笔记；",
    "- “当前最新状态” → 比较 frontmatter `updated` 或最新 episode 时间戳；",
    "- 检索不到就明说没有，不要编造。"
  ];

  // When the Obsidian plugin provides its loopback link server, tell the
  // agent to render note references in replies as clickable links so the
  // user can jump straight into Obsidian from the sidebar iframe. The same
  // server's /open and /feedback endpoints are guarded by a CSRF token that
  // the plugin passes via DSH_OBSIDIAN_FEEDBACK_TOKEN — the rendered link
  // templates MUST carry it as t= or the click is rejected with 403.
  const linkBaseUrl = process.env.DSH_OBSIDIAN_LINK_URL?.trim() ?? "";
  if (linkBaseUrl !== "") {
    const linkToken = process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN?.trim() ?? "";
    const tokenSuffix = linkToken === "" ? "" : `&t=${linkToken}`;
    lines.push(
      `- 回复正文中引用笔记时，使用可点击链接：[标题](${linkBaseUrl}/open?path=<vault 相对路径，需 URL 编码>${tokenSuffix})；`,
      "  点击即可在 Obsidian 中打开对应笔记。笔记文件内部仍写 [[wikilink]]，两者不要混用。",
      `- 引用记忆卡时标注验证等级徽标：✅用户确认（hook.verified=user-confirmed）/ ⚖️互证（cross-referenced）/ ❓单源（single-source 或缺失）。`,
      `- 本回复依据了记忆卡时，在末尾给反馈链接（path 为该卡 vault 相对路径，需 URL 编码）：[✅ 这条对](${linkBaseUrl}/feedback?path=<卡路径>&action=confirm${tokenSuffix}) [❌ 这条错](${linkBaseUrl}/feedback?path=<卡路径>&action=wrong${tokenSuffix})；用户点击后由 Obsidian 插件直接改写验证等级与成功率，无需你代劳。`
    );
  }

  // Capture policy (control surface 1c): the user-maintained policy file gates
  // how the agent may write NEW memory. Deterministic surfacing + model
  // execution, consistent with the rest of the protocol.
  const captureText = capturePolicyText(vaultRoot);
  const capturePolicy = parseCapturePolicy(captureText);
  lines.push(
    "",
    "### 捕获策略（.deepseek/capture-policy.md，用户维护，模型不得修改）",
    "",
    `- 💡 想法 idea: ${capturePolicy.idea} · 事实 fact（事实/事件/指令）: ${capturePolicy.fact} · 偏好 preference: ${capturePolicy.preference}`,
    "- auto=按三写协议直接写入；ask=先经 ask_user 征得同意再写；off=不主动捕获（用户明确要求时除外）。",
    captureText === "" ? "- （策略文件缺失，按默认档位 ask/auto/auto 执行。）" : "- 用户口头指令优先于策略文件。"
  );

  if (profile !== "") {
    lines.push("", "### 用户画像与稳定偏好（.deepseek/memory/profile.md）", "", profile);
  } else {
    lines.push("", "### 用户画像与稳定偏好", "", "（尚未建立。按 AGENTS.md 在首次对话后创建 .deepseek/memory/profile.md。）");
  }

  if (topics !== "") {
    lines.push("", "### 研究主题索引（.deepseek/memory/topics/index.md）", "", topics);
  } else {
    lines.push("", "### 研究主题索引", "", "（尚未建立。按 AGENTS.md 在 .deepseek/memory/topics/index.md 维护主题条目。）");
  }

  if (records !== "") {
    lines.push("", "### 记忆记录摘要（.deepseek/memory/records/index.md，类型化原子事实）", "", records);
  } else {
    lines.push("", "### 记忆记录摘要", "", "（尚无原子记录。每轮收尾时按 AGENTS.md 三写协议，从 episode 提炼 fact/event/instruction/preference 记录。）");
  }

  if (templates !== "") {
    lines.push("", "### 问题模板索引（.deepseek/memory/templates/index.md，题型/解法 ↔ 定理关联）", "", templates,
      "", "遇到新问题先做“问题蒸馏”（抽象成模板表达）再查这里；命中则读模板卡与关联定理并去重聚合。");
  }

  if (recallText !== undefined && recallText !== "") {
    lines.push("", "### 本轮记忆召回（按当前消息相关性 top-k；只是线索，细节仍按路由规则读文件）", "", recallText);
  }

  if (episodes !== "") {
    lines.push("", "### 近期事件时间线（.deepseek/memory/episodes/index.md，最新在前）", "", episodes);
  } else {
    lines.push("", "### 近期事件时间线", "", "（尚无事件记录。每轮对话收尾时按 AGENTS.md 双写 episodes。）");
  }

  if (memos !== "") {
    lines.push("", "### 备忘录状态与提醒候选（.deepseek/inbox/，AI 维护）", "", memos,
      "", "当本轮讨论与上述某条 memo 明显相关（新证据、新反例、可推进其“待打磨”清单）时，",
      "按 AGENTS.md 第 6 节在回复末尾给出“🔔 备忘录提醒”并用 ask_user_question 询问是否现在打磨；",
      "每条 memo 每天最多提醒一次，提醒后把它的 last_reminded 更新为当天日期。");
  } else {
    lines.push("", "### 备忘录状态与提醒候选", "", "（.deepseek/inbox/ 尚无 memo。捕捉到新想法并经用户同意后，按 AGENTS.md 第 6 节创建。）");
  }

  // Past-dialogue cues: newest first, at most MAX_DIALOGUE_PAIRS Q/A pairs.
  const recent = (dialogueIndex?.entries ?? []).filter((entry) => entry.sessionId !== currentSessionId);
  if (recent.length > 0) {
    const cues = [];
    let pairs = 0;
    let used = 0;
    for (const entry of recent) {
      const text = entry.text.replace(/\n+/g, " ");
      const budget = entry.role === "user" ? Math.min(text.length, 320) : Math.min(text.length, 220);
      if (used + budget > MAX_DIALOGUE_CHARS) break;
      if (entry.role === "user") {
        if (pairs >= MAX_DIALOGUE_PAIRS) break;
        pairs += 1;
      } else if (pairs === 0) {
        continue; // never start with an orphaned assistant cue
      }
      cues.push({ ...entry, text: text.slice(0, budget) });
      used += budget;
    }
    if (cues.length > 0) {
      lines.push("", "### 近期跨会话问答线索（最多 6 组，细节请 grep episodes）", "");
      let lastSessionId;
      for (const entry of cues) {
        if (entry.sessionId !== lastSessionId) {
          lines.push(`- 会话${entry.title !== undefined ? `《${entry.title}》` : ""}（${new Date(entry.time).toLocaleString("zh-CN", { hour12: false })}）`);
          lastSessionId = entry.sessionId;
        }
        const label = entry.role === "user" ? "问" : "答";
        lines.push(`  - ${label}: ${entry.text}`);
      }
    }
  }

  if (auditReport?.report !== undefined && auditReport.report !== "") {
    lines.push("", "### 记忆体检（obsidian-memory 确定性扫描，见 .deepseek/cache/memory-audit.json）", "", auditReport.report,
      "", "体检清单按 AGENTS.md 处理：weak → 读卡改写内容并清空 success_rate 重估（3 次仍弱则建议归档）；疑似重复 → 合并为一张、旧卡标 superseded（保留证据与 source 链）；unused → 在回复末尾一行向用户建议处置，不自行删除；strong → 相关讨论中把新技巧追加进 techniques；unverified → 保持单源引用，未经用户确认不得提升验证等级。");
  }

  return lines.join("\n");
}

// ── engine with per-process caching ─────────────────────────────────────────

function defaultSessionsRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "sessions");
}

function normalizeConfig(config) {
  const vaultRaw = (process.env.DSH_OBSIDIAN_VAULT ?? config.vaultRoot ?? "").trim();
  // Empty vaultRoot means "the agent's session cwd" — resolved per agent so the
  // same preset is portable across machines and vaults.
  const vaultRoot = vaultRaw === "" ? "" : resolve(vaultRaw);
  const sessionsRaw = (process.env.DSH_SESSIONS_ROOT ?? config.sessionsRoot ?? "").trim();
  const sessionsRoot = resolve(sessionsRaw === "" ? defaultSessionsRoot() : sessionsRaw);
  const maxHistoryEntries = Number.isInteger(config.maxHistoryEntries) && config.maxHistoryEntries > 0
    ? config.maxHistoryEntries
    : DEFAULT_MAX_HISTORY_ENTRIES;
  const maxHistoryChars = Number.isInteger(config.maxHistoryChars) && config.maxHistoryChars > 0
    ? config.maxHistoryChars
    : DEFAULT_MAX_HISTORY_CHARS;
  const cacheTtlMs = Number.isFinite(config.cacheTtlMs) && config.cacheTtlMs >= 0 ? config.cacheTtlMs : 0;
  const auditEnabled = config.auditEnabled !== false;
  const auditMaintainHookStats = config.auditMaintainHookStats !== false;
  const auditIntervalMs = Number.isFinite(config.auditIntervalMs) && config.auditIntervalMs >= 0
    ? config.auditIntervalMs
    : DEFAULT_AUDIT_INTERVAL_MS;
  const recallEnabled = config.recallEnabled !== false;
  const recallTopK = Number.isInteger(config.recallTopK) && config.recallTopK > 0 ? config.recallTopK : DEFAULT_RECALL_TOP_K;
  const recallMaxChars = Number.isInteger(config.recallMaxChars) && config.recallMaxChars > 0 ? config.recallMaxChars : DEFAULT_RECALL_MAX_CHARS;
  if (!isAbsolute(sessionsRoot)) throw new TypeError("obsidian-memory: sessionsRoot must be an absolute path");
  return { vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs, auditEnabled, auditMaintainHookStats, auditIntervalMs, recallEnabled, recallTopK, recallMaxChars };
}

function resolveVaultRoot(config, agent) {
  if (config.vaultRoot !== "") return config.vaultRoot;
  const cwd = agent?.session?.header?.cwd ?? agent?.session?.cwd;
  if (typeof cwd === "string" && cwd !== "" && isAbsolute(cwd)) return cwd;
  return "";
}

function fingerprint(logs) {
  return logs.map((log) => `${log.path}|${log.mtimeMs}|${log.size}`).join("\n");
}

/** True when a parsed dialogue-index cache is structurally valid AND written by
 * the current index semantics (schemaVersion gate). Exported for the zero-token
 * regression check. */
export function cacheIndexValid(cached) {
  return cached !== null && typeof cached === "object" &&
    cached.schemaVersion === DIALOGUE_INDEX_VERSION &&
    Array.isArray(cached.entries) && Array.isArray(cached.sources);
}

function readCachedIndex(cachePath) {
  try {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (cacheIndexValid(cached)) return cached;
    // A cache without (or with an older) schemaVersion was written by pre-filter
    // code: never reuse it, rebuild under the current semantics.
  } catch {
    // Cache missing/corrupt: rebuild.
  }
  return undefined;
}

function writeCachedIndex(cachePath, index) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const staging = `${cachePath}.tmp-${process.pid}`;
    writeFileSync(staging, JSON.stringify(index));
    renameSync(staging, cachePath);
  } catch {
    // A cache write failure must never break the prompt.
  }
}

class MemoryEngine {
  #config;
  #helpers;
  #cachedIndex;
  #fingerprint = "";
  #builtAt = 0;
  #auditCache = new Map();
  #recallCache = new Map();

  constructor(config, helpers = {}) {
    this.#config = normalizeConfig(config);
    this.#helpers = helpers;
  }

  cachePathFor(vaultRoot) {
    return join(vaultRoot, CACHE_FILE);
  }

  /** Return the current dialogue index, rebuilding it only when sources changed. */
  getDialogueIndex(vaultRoot, force = false) {
    const config = this.#config;
    const logs = findSessionLogs(config.sessionsRoot, MAX_LOG_FILES);
    const current = fingerprint(logs);
    const stale = force ||
      this.#cachedIndex === undefined ||
      current !== this.#fingerprint ||
      (config.cacheTtlMs > 0 && Date.now() - this.#builtAt > config.cacheTtlMs);
    if (!stale) return this.#cachedIndex;

    // Reuse the on-disk cache when its source fingerprint still matches.
    if (this.#cachedIndex === undefined) {
      const disk = readCachedIndex(this.cachePathFor(vaultRoot));
      if (disk !== undefined && fingerprint(disk.sources ?? []) === current) {
        this.#cachedIndex = disk;
        this.#fingerprint = current;
        this.#builtAt = disk.generatedAt ?? Date.now();
        return this.#cachedIndex;
      }
    }

    const index = buildDialogueIndex(
      config.sessionsRoot,
      config.maxHistoryEntries,
      config.maxHistoryChars,
      MAX_LOG_FILES,
      vaultRoot
    );
    this.#cachedIndex = index;
    this.#fingerprint = current;
    this.#builtAt = Date.now();
    writeCachedIndex(this.cachePathFor(vaultRoot), index);
    return index;
  }

  /**
   * Deterministic memory health report for one vault, at most once per
   * auditIntervalMs (default 24h). Reuses the on-disk report when fresh.
   */
  auditReportFor(vaultRoot) {
    const config = this.#config;
    if (!config.auditEnabled) return undefined;
    const cached = this.#auditCache.get(vaultRoot);
    if (cached !== undefined && Date.now() - cached.generatedAt < config.auditIntervalMs) return cached;
    if (cached === undefined) {
      try {
        const disk = JSON.parse(readFileSync(join(vaultRoot, AUDIT_FILE), "utf8"));
        if (Number.isFinite(disk?.generatedAt) && Date.now() - disk.generatedAt < config.auditIntervalMs) {
          this.#auditCache.set(vaultRoot, disk);
          return disk;
        }
      } catch {
        // Missing/corrupt report: rebuild below.
      }
    }
    let report;
    try {
      report = buildAuditReport(vaultRoot, { ...this.#helpers, maintainHookStats: config.auditMaintainHookStats });
    } catch {
      return cached; // a failed audit must never break prompt assembly
    }
    try {
      mkdirSync(join(vaultRoot, CACHE_DIR), { recursive: true });
      writeFileSync(join(vaultRoot, AUDIT_FILE), JSON.stringify(report, null, 2), "utf8");
    } catch {
      // Report persistence is best-effort.
    }
    this.#auditCache.set(vaultRoot, report);
    return report;
  }

  /** Recall corpus per vault, rebuilt only when the memory dirs' mtimes change. */
  recallDocsFor(vaultRoot) {
    const fingerprint = (() => {
      const parts = [];
      for (const dir of [join(vaultRoot, MEMORY_DIR, "memory", "records"), join(vaultRoot, MEMORY_DIR, "memory", "templates"), join(vaultRoot, MEMORY_DIR, "inbox")]) {
        let entries = [];
        try {
          entries = readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
            .map((entry) => entry.name);
        } catch {
          continue;
        }
        for (const name of entries) {
          try {
            const stats = statSync(join(dir, name));
            parts.push(`${dir}/${name}|${stats.mtimeMs}|${stats.size}`);
          } catch {
            // gone while walking
          }
        }
      }
      for (const file of [join(vaultRoot, MEMORY_DIR, "memory", "topics", "index.md"), join(vaultRoot, MEMORY_DIR, "memory", "episodes", "index.md")]) {
        try {
          const stats = statSync(file);
          parts.push(`${file}|${stats.mtimeMs}|${stats.size}`);
        } catch {
          // index not created yet
        }
      }
      return parts.join("\n");
    })();
    const cached = this.#recallCache.get(vaultRoot);
    if (cached !== undefined && cached.fingerprint === fingerprint) return cached.docs;
    const docs = buildRecallIndex(vaultRoot, this.#helpers);
    this.#recallCache.set(vaultRoot, { fingerprint, docs });
    return docs;
  }

  recallTextFor(vaultRoot, query) {
    const config = this.#config;
    if (query === "" || !config.recallEnabled) return "";
    try {
      const docs = this.recallDocsFor(vaultRoot);
      return rankRecall(docs, query, this.#helpers, config.recallTopK, config.recallMaxChars);
    } catch {
      return ""; // a failed recall must never break prompt assembly
    }
  }

  async sectionForAgent(agent) {
    const config = this.#config;
    try {
      const vaultRoot = resolveVaultRoot(config, agent);
      if (vaultRoot === "") {
        return "## 长期记忆（obsidian-memory 未配置）\n\n" +
          "当前会话没有可用的 vault 工作目录；设置 DSH_OBSIDIAN_VAULT 或在 preset 配置 vaultRoot。";
      }
      const currentSessionId = agent?.session?.id;
      const dialogueIndex = this.getDialogueIndex(vaultRoot);
      const auditReport = this.auditReportFor(vaultRoot);
      const query = latestUserText(agent);
      const recallText = this.recallTextFor(vaultRoot, query);
      const memoText = memoDigest(vaultRoot, MAX_INBOX_CHARS, query, this.#helpers);
      return buildMemorySection({ ...config, vaultRoot }, currentSessionId, dialogueIndex, auditReport, recallText, memoText);
    } catch (error) {
      return `## 长期记忆（obsidian-memory 暂不可用）\n\n${String(error)}`;
    }
  }
}

// ── Cordis plugin entry ─────────────────────────────────────────────────────

export async function apply(ctx, config) {
  // Import the sibling first so the audit pass can reuse its hook parser and
  // tokenizer (memory v2). The note tools are applied on the same context.
  const notes = await import("./obsidian-notes.mjs");
  const engine = new MemoryEngine(config ?? {}, {
    parseHookFrontmatter: notes.parseHookFrontmatter,
    tokenize: notes.tokenize,
    weightedOverlap: notes.weightedOverlap,
    computeDocFreq: notes.computeDocFreq,
    bm25Score: notes.bm25Score,
    computeCorpusStats: notes.computeCorpusStats
  });
  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const assembled = await next();
    if (context?.agent === undefined) return assembled;
    const text = await engine.sectionForAgent(context.agent);
    if (text === "") return assembled;
    return {
      ...assembled,
      sections: [...assembled.sections, { name: "obsidian:memory", text }]
    };
  });

  // Apply the dedicated note tools (note_search / note_create / note_links /
  // note_recall) on the same context — reuse the module imported above.
  // This file is always refreshed on upgrade, so existing installations pick
  // the tools up even though agent.cordis.yml preserves user edits. The
  // sibling module resolves `defineTool` through the harness loader, so it
  // works from any $DSH_HOME location.
  await notes.apply(ctx, config?.notes ?? {});
}
