/**
 * math-memory — cross-session memory injection for the `obsidian` dsh
 * agent preset. It also applies the sibling note-tools.mjs plugin on the
 * same context, which registers note_recall / note_search / note_create / note_links.
 *
 * What it does, on every system-prompt assembly for this agent:
 *   1. Reads the vault's durable memory files (`.deepseek/memory/*` and a
 *      one-line digest of `.deepseek/inbox/*`). These are maintained BY THE
 *      MODEL through the ordinary file tools, per the vault's AGENTS.md.
 *   2. Distills a small dialogue index from this machine's past dsh session
 *      logs (`session.jsonl.zstd`, plus the V3 `session.v3.jsonl.zstd` files
 *      dsh >= 0.1.5 writes when it migrates a session) under
 *      `$DSH_HOME/sessions/` — recent user questions plus short assistant
 *      conclusions — so a brand-new session no longer starts from zero.
 *   3. Runs a deterministic memory health check (memory v2, informed by
 *      arXiv:2606.31191 ISM): scans records/templates/inbox frontmatter and
 *      hook fields at most once per day per vault, writes
 *      `<vault>/.deepseek/cache/memory-audit.json`, syncs usage statistics
 *      back into the cards' hook.uses / hook.last_used (block-style hook
 *      blocks only), and injects a bounded audit section into the prompt.
 *   4. Appends one bounded "dsh-math:memory" section to the assembled system
 *      prompt.
 *
 * It never calls the model. Its only user-file mutation is the deterministic
 * hook-stats sync described above (opt-out via auditMaintainHookStats: false);
 * its own cache files live at `<vault>/.deepseek/cache/*`.
 *
 * Session logs are concatenated Zstandard frames (one JSONL batch per frame) —
 * unchanged between the V2 and V3 session data formats introduced by dsh
 * 0.1.5, so the frame scanner and event readers below work on both. Node >=
 * 22.5 provides zstd through node:zlib; on older runtimes the dialogue index is
 * skipped and only vault memory files are injected.
 */

import * as zlib from "node:zlib";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
// The single implementation of the frontmatter DELIMITER rule (see that file's
// header). This module used to carry 12 copies of the regex literal, which is
// how "where does the block end" drifted between readers (2026-09-11 review,
// P1-6; handoff.md traps 21/22/43).
import {
  frontmatterSpan,
  frontmatterBlock,
  readFrontmatter,
  stripFrontmatter,
  replaceFrontmatterBlock
} from "./hook-frontmatter.mjs";

export const name = "math-memory";
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
// Slimmed static budgets (retrieval v3 S5): the injected layers are navigation
// only — a topic/records/templates/episodes map that tells the agent what
// exists. Relevant CONTENT is pulled on demand through note_recall instead of
// being pushed into every prompt.
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
// Memory-v2 audit pass (arXiv:2606.31191 ISM, localized): deterministic scan of
// card frontmatter + hook fields, at most once per vault per auditIntervalMs.
const AUDIT_FILE = join(CACHE_DIR, "memory-audit.json");
const RETRIEVAL_STATS_FILE = join(CACHE_DIR, "retrieval-stats.json");
const DEFAULT_AUDIT_INTERVAL_MS = 86400000; // 24h
const MAX_AUDIT_CHARS = 1200;
// Bumped whenever the audit JSON's shape changes in a way a reader (the memory
// panels, memory-admin.mjs) must know about. 1 = flat `report` string only;
// 2 = structured `counts/decisions/thresholds/sections/structural` + the
// checklist/human split. Readers must treat a missing/older version as
// "text only" instead of guessing at absent fields.
export const AUDIT_SCHEMA_VERSION = 2;
// Hard total cap for the assembled memory section — a final safety bound on
// top of the per-layer budgets above (which sum to ~14.6K content chars plus
// fixed headers/instructions). Keeps the injected section bounded even when
// every layer is full; the per-layer budgets still govern normal sizing.
export const MAX_TOTAL_MEMORY_CHARS = 18000;
const AUDIT_CARD_DIRS = [join(MEMORY_DIR, "memory", "records"), join(MEMORY_DIR, "memory", "templates"), join(MEMORY_DIR, "strategy")];
const AUDIT_UNUSED_DAYS = 30;
const AUDIT_UNVERIFIED_DAYS = 60;
const AUDIT_WEAK_USES = 3;
const AUDIT_WEAK_RATE = 0.4;
const AUDIT_STRONG_RATE = 0.8;
const AUDIT_DUP_JACCARD = 0.7;
const AUDIT_CARD_SCAFFOLD = new Set(["index.md", "_README.md"]);
// Self-correction thresholds (self-correction.md P3/P5b).
const AUTO_ARCHIVE_UNUSED_DAYS = 90;
const PROMOTE_USES = 3;
const PROMOTE_RATE = 0.6;

/**
 * Deterministic net-gain verdict for a card, in [-1, 1], or 0 for "no verdict".
 *
 * WHY this exists (MSCE, arXiv:2607.16621 §4.2 Eq. 1): `uses` counts how often a
 * card was RETRIEVED, not whether it HELPED. A card retrieved 20 times and
 * discarded 18 times looked identical to a card that solved 20 problems, so the
 * ranking rewarded being mentioned. MSCE's answer is a signed gain, and it also
 * anchors the negative side when evidence is thin (its `N_0`/`b` shrinkage) rather
 * than letting a single case swing the value.
 *
 * We cannot ask a model for a value (this plugin calls none), so the verdict is
 * built ONLY from explicit outcomes the user produced. Deliberately two signals,
 * both unambiguous:
 *   - the user marked the card wrong (❌ ⇒ `harmed` / `needs_review`), and
 *   - the user confirmed it (✅ ⇒ `verified_by: user`).
 *
 * NOT used: "the user asked a follow-up question". That can mean curiosity rather
 * than failure, and a noisy negative would be worse than no negative at all.
 * "Card was superseded" is also excluded: that says the card became obsolete, which
 * is not the same as "using it made things worse".
 *
 * Absent (0) is the neutral verdict and must stay the majority case — most cards
 * never receive explicit feedback, and inventing a value for them would be exactly
 * the "looks measured" trap that `success_rate` already warns about.
 */
function cardGain({ harmed, needsReview, verifiedBy }) {
  const wrong = harmed > 0 || needsReview === true;
  const confirmed = verifiedBy === "user";
  if (wrong && confirmed) return 0;   // conflicting verdicts: stay neutral
  if (wrong) return -1;
  if (confirmed) return 1;
  return 0;
}
// Dialogue capture (obelisk-comparison.md): deterministically persist the full
// conversation (user + assistant text, no reasoning) into the episodes layer.
const CAPTURE_FILE = join(CACHE_DIR, "captured-sessions.json");
const CAPTURE_SCHEMA_VERSION = 1;
const CAPTURE_USER_CLIP = 4000;
const CAPTURE_ASSISTANT_CLIP = 4000;
const CAPTURE_MAX_SESSION_CHARS = 24000;
const CAPTURE_THROTTLE_MS = 60000;
// Scan ALL session logs for capture (unlike the dialogue index's 20-file
// window): the per-session marker keeps each run cheap — only sessions whose
// fingerprint changed get decoded and written, so scanning the full history is
// just a metadata walk. A high bound covers any realistic personal history.
const CAPTURE_SCAN_LIMIT = 100000;

// ── zstd session-log decoding ───────────────────────────────────────────────

/** Locate every complete Zstandard frame in a concatenated-frame file. */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return frames;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`math-memory: bad zstd frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return frames; // torn header after magic
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`math-memory: reserved zstd frame-header bit at byte ${offset - 1}`);
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
      if (blockType === 3) throw new Error(`math-memory: reserved zstd block type at byte ${offset - 3}`);
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

/**
 * Bytes read from the head of a session log to reach its header frame. The
 * harness writes a small checksummed header frame first, so the opening 64 KiB
 * always holds the whole `{type:"session", id, cwd, …}` line. Reading every
 * header in a 389-log store costs ~0.6 s, against ~34 s to decode every log —
 * and decoding them is what made a memory-panel open freeze the whole app.
 */
const SESSION_HEAD_BYTES = 65536;
/** Bound on the per-revision header verdict cache (see isVaultSessionLog). */
const SESSION_HEADER_CACHE_MAX = 4096;

/**
 * Read ONE session log's header line without decoding the whole file.
 *
 * Only `{ type, id, cwd }` is needed to decide whether a log belongs to this
 * vault. Decoding every log just to learn that threw away ~98% of the work on a
 * real store (the vault owned 40 of 389 logs). Returns null when the head holds
 * no complete frame, the first line is not JSON, or the file is unreadable.
 */
function readSessionHeader(path) {
  let fd;
  try {
    if (typeof zlib.zstdDecompressSync !== "function") return null;
    fd = openSync(path, "r");
    const size = statSync(path).size;
    const want = Math.min(SESSION_HEAD_BYTES, size);
    if (want <= 0) return null;
    const head = Buffer.allocUnsafe(want);
    const read = readSync(fd, head, 0, want, 0);
    const bounds = scanZstdFrames(head.subarray(0, read));
    if (bounds.length === 0) return null;
    const text = zlib.zstdDecompressSync(head.subarray(bounds[0][0], bounds[0][1])).toString("utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const parsed = JSON.parse(line);
      return parsed !== null && typeof parsed === "object" ? parsed : null;
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
 * Memoised "does this log belong to `root`" verdict, keyed by file revision
 * (`path|mtimeMs|size`). The map lives for the process lifetime, which is what
 * keeps the per-turn cost a Map hit instead of a store walk; a grown log has a
 * new key and is re-read.
 */
const sessionHeaderCache = new Map();

function isVaultSessionLog(root, log) {
  if (root === "") return true;
  const key = `${log.path}|${log.mtimeMs}|${log.size}`;
  const cached = sessionHeaderCache.get(key);
  if (cached !== undefined) return cached;
  const header = readSessionHeader(log.path);
  const cwd = header !== null && header.type === "session" && typeof header.cwd === "string" ? header.cwd : null;
  if (sessionHeaderCache.size >= SESSION_HEADER_CACHE_MAX) sessionHeaderCache.clear();
  const verdict = cwd !== null && pathInside(root, cwd);
  sessionHeaderCache.set(key, verdict);
  return verdict;
}

/**
 * The newest session logs belonging to `vaultRoot`, newest first.
 *
 * The vault filter is applied BEFORE the `maxFiles` slice. Selecting the newest
 * `maxFiles` logs across every project and filtering afterwards (the previous
 * behaviour) both decoded other workspaces' conversations and could leave the
 * index empty whenever a busier project owned the newest files.
 */
function vaultSessionLogs(sessionsRoot, vaultRoot, maxFiles) {
  const all = findSessionLogs(sessionsRoot, CAPTURE_SCAN_LIMIT);
  if (vaultRoot === "") return all.slice(0, maxFiles);
  const kept = [];
  for (const log of all) {
    if (!isVaultSessionLog(vaultRoot, log)) continue;
    kept.push(log);
    if (kept.length >= maxFiles) break;
  }
  return kept;
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
 * `{ id, title, cwd, createdAt, messages: [{ role, text, time, seq }] }`.
 * Plugin-injected user messages (runtime-context snapshots, approval notices)
 * are skipped; only real human turns (`source.kind === "user"`) count.
 * Reasoning blocks are excluded via `contentText` (it only keeps `text` blocks).
 * `opts.userClip`/`opts.assistantClip` let the dialogue index keep its tight
 * budgets while the capture pass keeps a much larger per-message budget.
 */
export function distillSession(events, { userClip = 500, assistantClip = 320 } = {}) {
  const entry = { id: undefined, title: undefined, cwd: undefined, createdAt: undefined, origin: undefined, isSubagent: false, messages: [] };
  for (const event of events) {
    if (event?.type === "session" && typeof event.id === "string") {
      entry.id = event.id;
      entry.cwd = typeof event.cwd === "string" ? event.cwd : entry.cwd;
      entry.createdAt = typeof event.createdAt === "number" ? event.createdAt : entry.createdAt;
      // V3-only onboarding fields. They are what makes "this conversation is a
      // delegated child" decidable at all — a V2 header has neither, so a V2
      // subagent session stays indistinguishable and is kept.
      entry.origin = typeof event.origin === "string" ? event.origin : entry.origin;
      entry.isSubagent = event.origin === "subagent"
        || (Number.isFinite(event.delegationDepth) && event.delegationDepth > 0);
    } else if (event?.type === "session/title" && typeof event.data?.title === "string") {
      entry.title = event.data.title;
    } else if (event?.type === "user/message" && event.data?.source?.kind === "user") {
      const text = contentText(event.data.content);
      if (text !== "") {
        entry.messages.push({ role: "user", text: clip(text, userClip), time: event.time ?? 0, seq: event.seq });
      }
    } else if (event?.type === "assistant/message") {
      const text = contentText(event.data?.message?.content);
      if (text !== "") {
        entry.messages.push({ role: "assistant", text: clip(text, assistantClip), time: event.time ?? 0, seq: event.seq });
      }
    }
  }
  return entry;
}

// ── session root walking ────────────────────────────────────────────────────

/**
 * The identity of the session an artifact belongs to.
 *
 * Since dsh 0.1.5 (session data format V3) ONE session can own two artifacts in
 * the same directory: the V2 original `session.jsonl.zstd` and the migrated
 * `session.v3.jsonl.zstd`. The migration generates the new file while KEEPING
 * the old one (upstream: "版本迁移生成新版日志并保留原文件"), so the pair is a
 * durable state, not a transition — and both names end in `.jsonl.zstd`, so the
 * walker below would otherwise treat one conversation as two.
 *
 * Real layout: `<sessionsRoot>/<projectKey>/<session-id>/session[.v3].jsonl.zstd`
 * — the file name is the constant, the session directory carries the identity.
 * So the key is the first ancestor directory above the file that is not the
 * generic root itself. In a flat `<id>.jsonl.zstd` store (tests, hand-made
 * fixtures) there is no such ancestor and the file stem serves as the key.
 *
 * Deriving the key from the PATH — never from file contents — is deliberate:
 * the walker must stay able to reject other workspaces without decoding a
 * single log (see the header-read note above).
 */
export function sessionLogKey(path) {
  const segments = String(path).split(/[\\/]/).filter((s) => s !== "");
  const stem = (name) => {
    let value = String(name);
    while (value.includes(".")) {
      const next = value.replace(/\.[^.]+$/, "");
      if (next === value) break;
      value = next;
    }
    return value;
  };
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const candidate = segments[i];
    if (/^sessions?$/i.test(candidate)) break; // the generic root: stop looking
    const key = stem(candidate);
    if (key !== "") return key;
  }
  const file = segments[segments.length - 1];
  return file === undefined ? "" : stem(file);
}

/**
 * Collapse same-session artifacts to ONE authoritative log each.
 *
 * Two discriminators, in order:
 *   1. the `.v3.` variant label — the migrated artifact is the live one, and it
 *      is the authoritative version even when its mtime ties with the original
 *      (the migration can write both inside one filesystem timestamp tick);
 *   2. mtime, newest first — the only signal available when a session directory
 *      somehow holds two artifacts of the same flavour.
 *
 * The result stays mtime-descending, which is what every caller's `maxFiles`
 * window assumes. Dedup happens BEFORE any slice, so `maxFiles` keeps meaning
 * "at most N sessions".
 */
export function selectAuthoritativeLogs(logs) {
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

/** True when `candidate` should replace `incumbent` as the authoritative artifact. */
function isNewerArtifact(candidate, incumbent) {
  const candidateV3 = /\.v3\./.test(candidate.path);
  const incumbentV3 = /\.v3\./.test(incumbent.path);
  if (candidateV3 !== incumbentV3) return candidateV3;
  return candidate.mtimeMs > incumbent.mtimeMs;
}

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
  // One session = one artifact (see selectAuthoritativeLogs), which also
  // returns the list mtime-descending for the `maxFiles` window.
  return selectAuthoritativeLogs(found).slice(0, maxFiles);
}

/**
 * Build the dialogue index used by the memory section: recent user turns and
 * the assistant texts that followed, flattened in time order.
 */
export function buildDialogueIndex(sessionsRoot, maxEntries, maxChars, maxFiles = MAX_LOG_FILES, vaultRoot = "") {
  const sources = [];
  const sessions = [];
  // Vault-filtered BEFORE decoding (and before the maxFiles slice): decoding
  // every project's logs to discard ~98% of them was the single most expensive
  // thing on the prompt-assembly path.
  for (const log of vaultSessionLogs(sessionsRoot, vaultRoot, maxFiles)) {
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
      if (vaultRoot !== "" && !pathInside(vaultRoot, entry.cwd ?? "")) continue;
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

// ── dialogue capture (obelisk-comparison.md) ─────────────────────────────────
// Deterministically persist the full conversation (user + assistant text, no
// reasoning) of each finished session into the episodes evidence layer, so the
// durable memory no longer relies on the model's self-disciplined three-write.
// Incremental: a per-session `lastSeq` marker means only the delta since the
// last capture is appended — which also handles the user resuming an old
// session (the log grows, we append just the new tail).

/** Date (local YYYY-MM-DD) from a millisecond timestamp; today when invalid. */
export function localDateFromMs(ms) {
  const d = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Decide what (if anything) to append for one session. Pure — no IO.
 * Returns `{ delta, lastSeq }` where `delta` is the messages with seq strictly
 * greater than the prior `lastSeq`, or null when there is nothing new.
 */
export function planSessionDelta(entry, prior) {
  const messages = [...(entry?.messages ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (messages.length === 0) return null;
  const lastSeq = Number.isFinite(prior?.lastSeq) ? prior.lastSeq : -1;
  const delta = messages.filter((m) => (m.seq ?? 0) > lastSeq);
  if (delta.length === 0) return null;
  return { delta, lastSeq: delta[delta.length - 1].seq ?? 0 };
}

/**
 * Render a conversation, keeping the TAIL within `maxChars` (drop the earliest
 * messages first — later discussion is closer to what the user wants). Returns
 * `null` when nothing fits.
 */
export function renderConversationTail(messages, maxChars) {
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const line = `${messages[i].role === "user" ? "用户" : "助手"}：${messages[i].text ?? ""}`;
    if (used + line.length > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.length === 0 ? null : kept.reverse().join("\n");
}

/** Load the capture marker (best-effort); a missing/corrupt/stale file is fresh. */
function readCaptureState(root) {
  const path = join(root, CAPTURE_FILE);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed !== null && typeof parsed === "object" &&
        parsed.schemaVersion === CAPTURE_SCHEMA_VERSION &&
        parsed.sessions !== null && typeof parsed.sessions === "object") {
      return parsed;
    }
  } catch {
    // missing/corrupt: start fresh
  }
  return { schemaVersion: CAPTURE_SCHEMA_VERSION, sessions: {} };
}

/**
 * Deterministically persist finished sessions into episodes. Walks the session
 * logs, compares each against the capture marker (by file fingerprint), and
 * only decodes/appends sessions that grew or are new. Vault containment filter
 * keeps other workspaces out. Best-effort: a failure on one session must not
 * stop the rest. Returns `{ captured, state, warnings }`; writes the marker itself.
 *
 * `warnings` exists because every write on this path used to fail SILENTLY: a
 * vault whose episode writes kept failing looked exactly like a vault with
 * nothing to capture (`captured: []` either way). Trap 44 names "treating a
 * write as done because no error surfaced" as the most recurrent defect shape in
 * this repo, and an empty catch block is where it breeds (2026-09-11 review, P2-7).
 */
export function runSessionCapture(root, sessionsRoot, state = undefined, opts = {}) {
  const { captureSubagents = false } = opts;
  const next = state !== undefined && state !== null && typeof state === "object" && state.schemaVersion === CAPTURE_SCHEMA_VERSION
    ? { schemaVersion: state.schemaVersion, sessions: { ...(state.sessions ?? {}) }, scanned: { ...(state.scanned ?? {}) } }
    : { schemaVersion: CAPTURE_SCHEMA_VERSION, sessions: {}, scanned: {} };
  const captured = [];
  const warnings = [];
  // Per-log scan cache: `scanned[logPath] = { fp, inVault, pending }` at the
  // given `path|mtimeMs|size` revision. A log is decoded only when it is new,
  // has grown, or is known to still hold an unwritten delta — so another
  // workspace's conversations are read once and then never again, instead of
  // being fully decompressed on every capture pass.
  const scanned = next.scanned;
  let dirty = false;
  for (const log of findSessionLogs(sessionsRoot, CAPTURE_SCAN_LIMIT)) {
    const fingerprint = `${log.path}|${log.mtimeMs}|${log.size}`;
    const record = scanned[log.path];
    if (record !== undefined && record.fp === fingerprint && !(record.inVault === true && record.pending === true)) continue;
    // Cheap gate: only this vault's sessions are ever captured.
    const header = readSessionHeader(log.path);
    if (header !== null && (header.type !== "session" || typeof header.id !== "string" || !pathInside(root, header.cwd ?? ""))) {
      scanned[log.path] = { fp: fingerprint, inVault: false, pending: false };
      dirty = true;
      continue;
    }
    let events;
    try {
      events = decodeZstdSessionLog(readFileSync(log.path));
    } catch {
      continue;
    }
    const entry = distillSession(events, { userClip: CAPTURE_USER_CLIP, assistantClip: CAPTURE_ASSISTANT_CLIP });
    if (entry.id === undefined || entry.messages.length === 0 || !pathInside(root, entry.cwd ?? "")) {
      scanned[log.path] = { fp: fingerprint, inVault: false, pending: false };
      dirty = true;
      continue;
    }
    // A delegated child replays its parent's prefix: capturing it would store
    // the same conversation again under a second id. Marked scanned so the
    // decision is not re-derived on every pass.
    if (entry.isSubagent && captureSubagents !== true) {
      scanned[log.path] = { fp: fingerprint, inVault: false, pending: false };
      dirty = true;
      continue;
    }
    const prior = next.sessions[entry.id];
    const plan = planSessionDelta(entry, prior);
    if (plan === null) {
      next.sessions[entry.id] = { lastSeq: prior?.lastSeq ?? -1, fingerprint, file: prior?.file ?? "" };
      scanned[log.path] = { fp: fingerprint, inVault: true, pending: false };
      dirty = true;
      continue;
    }
    const body = renderConversationTail(plan.delta, CAPTURE_MAX_SESSION_CHARS);
    if (body === null) {
      next.sessions[entry.id] = { lastSeq: plan.lastSeq, fingerprint, file: prior?.file ?? "" };
      scanned[log.path] = { fp: fingerprint, inVault: true, pending: false };
      dirty = true;
      continue;
    }
    const date = localDateFromMs(entry.createdAt);
    const stem = `${date}-${entry.id}`;
    const rel = join(MEMORY_DIR, "memory", "episodes", `${stem}.md`);
    const abs = join(root, rel);
    try {
      const isNew = prior?.file === undefined || prior.file === "";
      if (isNew) {
        mkdirSync(dirname(abs), { recursive: true });
        const header = [
          `# ${entry.title ?? entry.id}`,
          "",
          `> sessionId: ${entry.id} · 自动保存对话 · ${date}`,
          "",
          "## 对话（不含思考）",
          ""
        ].join("\n");
        writeFileSync(abs, `${header}${body}\n`, "utf8");
      } else {
        // Append only the delta; never rewrite the whole file.
        const existing = existsSync(abs) ? readFileSync(abs, "utf8") : "";
        const sep = existing.endsWith("\n") ? "" : "\n";
        writeFileSync(abs, `${existing}${sep}${body}\n`, "utf8");
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
  if (dirty) {
    try {
      mkdirSync(join(root, CACHE_DIR), { recursive: true });
      writeFileSync(join(root, CAPTURE_FILE), JSON.stringify(next, null, 2), "utf8");
    } catch (error) {
      // The marker is what stops the next pass from re-appending the same deltas,
      // so failing to write it risks duplicated episodes — worth a warning, not
      // worth failing the capture.
      warnings.push(`捕获 marker 写入失败，下次可能重复捕获同一批会话：${String(error?.message ?? error)}`);
    }
  }
  return { captured, state: next, warnings };
}

/**
 * Add a capture file to episodes/index.md (idempotent, one line per session).
 * Returns `false` when the write could not be confirmed, so the caller can
 * report it (see `runSessionCapture`); the check is a read-back, not just "no
 * throw" — trap 44.
 */
function appendEpisodeIndex(root, stem, title) {
  const indexPath = join(root, MEMORY_DIR, "memory", "episodes", "index.md");
  const line = `- [[${stem}|${title}]]`;
  try {
    let text = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
    if (text.includes(`[[${stem}`)) return true; // already indexed
    if (text !== "" && !text.endsWith("\n")) text += "\n";
    writeFileSync(indexPath, `${text}${line}\n`, "utf8");
    return readFileSync(indexPath, "utf8").includes(`[[${stem}`);
  } catch {
    return false;
  }
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
  const inner = readFrontmatter(text ?? "");
  if (inner !== "") {
    for (const line of inner.split(/\r?\n/)) {
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
// One gate per memory layer, so the user never has to reason about which
// "three-write step" a given file belongs to (see docs/memory/control-panel.md
// §2.4). `structure` was added after the layers grew: topics / theorems /
// templates / strategy are index-and-structure writes, and gating them behind
// the content gates (`fact`/`preference`) made the ask-mode prompt fire for
// "add one line to an index". Default `auto` = the behaviour before this field
// existed, so an untouched vault does not start asking more often.
const DEFAULT_CAPTURE_POLICY = { idea: "ask", fact: "ask", preference: "ask", structure: "auto" };

/**
 * Parse the vault's user-maintained capture policy
 * (.deepseek/capture-policy.md frontmatter): idea / fact / preference /
 * structure × auto / ask / off. Missing file, missing fields, or unknown values
 * fall back to the defaults.
 */
export function parseCapturePolicy(text) {
  const policy = { ...DEFAULT_CAPTURE_POLICY };
  if (typeof text !== "string" || text === "") return policy;
  const inner = readFrontmatter(text);
  if (inner === "") return policy;
  for (const line of inner.split(/\r?\n/)) {
    const pair = /^(idea|fact|preference|structure):\s*([A-Za-z_-]+)\s*$/.exec(line.trim());
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

// ── standalone memory settings (host-agnostic config file) ─────────────────

const MEMORY_CONFIG_FILE = join(MEMORY_DIR, "config.md");

/**
 * Parse the workspace's standalone memory settings (.deepseek/config.md
 * frontmatter): enabled / dialogueIndex / reminders / audit. Host-agnostic
 * settings surface — editable without Obsidian or dsh web, and each
 * workspace (vault/folder) can carry its own overrides. A missing file/field
 * returns null so the preset config (agent.cordis.yml) applies.
 */
export function parseMemoryConfig(text) {
  if (typeof text !== "string" || text === "") return null;
  const inner = readFrontmatter(text);
  if (inner === "") return null;
  const config = {};
  for (const line of inner.split(/\r?\n/)) {
    const pair = /^(enabled|dialogueIndex|reminders|audit|autoArchive|sessionCapture|captureSubagents):\s*(true|false)\s*$/i.exec(line.trim());
    if (pair !== null) config[pair[1]] = pair[2].toLowerCase() === "true";
  }
  return Object.keys(config).length === 0 ? null : config;
}

export function memoryConfigText(root) {
  const path = join(root, MEMORY_CONFIG_FILE);
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
export function memoDigest(root, maxChars, query = "", helpers = undefined, includeReminders = true) {
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
  // helpers is optional (see the `canScore` guard above); only tokenize when
  // relevance scoring can actually run, so a caller without helpers (e.g. the
  // buildMemorySection fallback) still lists memos instead of crashing.
  const tokenizedDocs = canScore ? memoDocs.map((doc) => helpers.tokenize((doc.file + " " + stripFrontmatter(doc.text).slice(0, 1500)))) : [];
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

  if (includeReminders) {
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
function rewriteHookStats(frontmatterText, uses, lastUsed, gain = 0) {
  const lines = frontmatterText.split(/\r?\n/);
  const hookIdx = lines.findIndex((line) => /^hook:\s*$/.test(line));
  if (hookIdx === -1) return null;
  let endIdx = hookIdx + 1;
  while (endIdx < lines.length && (lines[endIdx].trim() === "" || /^\s/.test(lines[endIdx]))) endIdx += 1;
  const block = lines.slice(hookIdx + 1, endIdx);
  let usesSeen = false;
  let lastUsedSeen = false;
  let gainSeen = false;
  // `null` means "leave that line exactly as it is" — used when only the gain
  // verdict is being persisted and usage statistics are not being maintained.
  const touchUses = uses !== null && uses !== undefined;
  const touchLastUsed = lastUsed !== null && lastUsed !== undefined;
  const updated = [];
  for (const line of block) {
    const match = /^(\s*)(uses|last_used|gain):\s*(.*)$/.exec(line);
    if (match !== null && match[2] === "uses") {
      if (!touchUses) { usesSeen = true; updated.push(line); continue; }
      usesSeen = true; updated.push(`${match[1]}uses: ${uses}`); continue;
    }
    // An empty lastUsed means "never used": leave any existing value as the
    // user/model wrote it and never invent a date.
    if (match !== null && match[2] === "last_used") {
      if (touchLastUsed && lastUsed !== "") { lastUsedSeen = true; updated.push(`${match[1]}last_used: ${lastUsed}`); continue; }
      lastUsedSeen = true; updated.push(line); continue;
    }
    if (match !== null && match[2] === "gain") {
      // `gain` is machine-owned, so it is rewritten when it has a value and
      // REMOVED when it falls back to zero: leaving a stale `gain: 0` (or a
      // `gain: -1` that a later ✅ has resolved) would be a claim the system no
      // longer stands behind. Absent means "no verdict yet" — the neutral case.
      if (gain !== 0) { gainSeen = true; updated.push(`${match[1]}gain: ${gain}`); }
      continue;
    }
    updated.push(line);
  }
  if (!usesSeen && touchUses) updated.push(`  uses: ${uses}`);
  if (!lastUsedSeen && touchLastUsed && lastUsed !== "") updated.push(`  last_used: ${lastUsed}`);
  if (!gainSeen && gain !== 0) updated.push(`  gain: ${gain}`);
  return [...lines.slice(0, hookIdx + 1), ...updated, ...lines.slice(endIdx)].join(frontmatterText.includes("\r\n") ? "\r\n" : "\n");
}

/**
 * Best-effort deterministic sync of usage statistics into a card's hook block.
 * Only touches `uses` / `last_used` lines; any parse surprise leaves the
 * file untouched. The agent itself never maintains these two fields.
 *
 * @returns `true` when the file now carries `uses: <effectiveUses>` (including
 *   "nothing to change"), `false` when the write could not be performed. The
 *   audit counts the `false`s: a silently failed sync used to look identical to
 *   a successful one (design-intake §1 item 5).
 */
function syncHookStatsToCard(filePath, effectiveUses, lastUsed, gain = 0) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  const block = frontmatterBlock(text);
  if (block === null) return false;
  const rewritten = rewriteHookStats(block, effectiveUses, lastUsed, gain);
  if (rewritten === null) return false;
  if (rewritten === block) return verifyUsesWritten(text, effectiveUses, true);
  try {
    const next = replaceFrontmatterBlock(text, rewritten);
    writeFileSync(filePath, next, "utf8");
    // Post-condition, not an assumption: read back what we just claimed to write.
    return verifyUsesWritten(next, effectiveUses, true);
  } catch {
    return false;
  }
}

/**
 * True when `text` declares `uses: <expected>` somewhere in its leading
 * frontmatter (inside the hook block for hook cards, at the top level for
 * strategy cards).
 */
function verifyUsesWritten(text, expected, anyIndent) {
  const block = frontmatterBlock(text);
  if (block === null) return false;
  const pattern = anyIndent ? /^\s*uses:\s*(-?\d+)\s*$/m : /^uses:\s*(-?\d+)\s*$/m;
  const found = pattern.exec(block);
  return found !== null && Number(found[1]) === Number(expected);
}

/**
 * Set a top-level (non-indented) frontmatter field, appending when absent.
 * Mirrors memory-admin.mjs setTopField so the preset stays dependency-free.
 */
function setTopFieldText(frontmatterText, field, value) {
  const lines = frontmatterText.split(/\r?\n/);
  let seen = false;
  const pattern = new RegExp("^" + field + ":");
  const updated = lines.map((line) => {
    if (!/^\s/.test(line) && pattern.test(line)) { seen = true; return field + ": " + value; }
    return line;
  });
  if (!seen) updated.push(field + ": " + value);
  return updated.join(frontmatterText.includes("\r\n") ? "\r\n" : "\n");
}

/**
 * Splice a rewritten frontmatter block back into a file BY OFFSET.
 *
 * The obvious `text.replace(block, rewritten)` is wrong here in two ways, both
 * reachable from agent-authored cards:
 *   1. the second argument is a REPLACEMENT STRING, so `$$`/`$&`/`$'`/`` $` ``
 *      inside the frontmatter get expanded (`title: 关于 $$ 的表示` would lose a
 *      `$`; `$&` would inject the entire matched block). memory-admin.mjs had the
 *      same defect, fixed there; a math vault is exactly where `$$` shows up in
 *      a title.
 *   2. a string needle replaces the first occurrence ANYWHERE in the file, not
 *      necessarily the leading block.
 * Offsets remove both hazards. The implementation moved to the shared
 * frontmatter module (`hook-frontmatter.mjs`) on 2026-09-11; the property is
 * asserted directly in `scripts/test-memory.mjs` because it is invisible until
 * it corrupts a real card.
 */

/**
 * Best-effort sync of usage stats into a strategy card's TOP-LEVEL frontmatter
 * (strategy cards carry uses/last_used at the top level, not in a hook block).
 * @returns `true` on success (or nothing to change), `false` when the write did
 *   not land — see {@link syncHookStatsToCard}.
 */
function syncTopLevelStatsToCard(filePath, effectiveUses, lastUsed) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  const span = frontmatterSpan(text);
  if (span === null) return false;
  // `span.block` INCLUDES both `---` delimiters, so appending a field to it puts
  // the line AFTER the closing delimiter — i.e. in the BODY. That is exactly how
  // `strategy/strat-ot-structure-proof.md` ended up with two stray `uses: 0`
  // lines outside its frontmatter: the first audit appended one, the next added
  // another, and every reader (which parses the frontmatter) ignored them. The
  // read-back verification in this function's caller is what finally exposed
  // it; `span.text` is the body INSIDE the delimiters, so build the block from
  // that and splice it back by offset.
  const crlf = span.block.includes("\r\n");
  const sep = crlf ? "\r\n" : "\n";
  let body = setTopFieldText(span.text, "uses", String(effectiveUses));
  if (lastUsed !== "") body = setTopFieldText(body, "last_used", lastUsed);
  const fm = `---${sep}${body}${sep}---`;
  if (fm === span.block) return verifyUsesWritten(text, effectiveUses, false);
  try {
    const next = replaceFrontmatterBlock(text, fm);
    writeFileSync(filePath, next, "utf8");
    return verifyUsesWritten(next, effectiveUses, false);
  } catch {
    return false;
  }
}

/**
 * Move low-utility cards into `.deepseek/archive/<layer>/` (move, never delete)
 * and rewrite that layer's index links so provenance survives. Returns the moved
 * entries. Best-effort: a failure on one card must not stop the rest.
 *
 * The destination and the rewritten index follow the card's OWN layer. Both used
 * to be hardcoded to `records` (written when records were the only archivable
 * layer): a strategy card was filed under `archive/records/` and its line in
 * `strategy/index.md` was never touched, leaving a dangling link — found in the
 * 2026-09-10 design-iteration audit.
 */
function moveCardsToArchive(root, targets) {
  const moved = [];
  for (const card of targets) {
    if (typeof card?.filePath !== "string" || !existsSync(card.filePath)) continue;
    const rel = String(card.rel ?? "");
    const stem = rel.split("/").at(-1).replace(/\.md$/, "");
    if (stem === "") continue;
    const segments = rel.split("/");
    const layer = segments[0] === MEMORY_DIR && segments[1] === "memory" ? segments[2] : segments[1];
    if (typeof layer !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(layer)) continue;
    const archiveDir = join(root, MEMORY_DIR, "archive", layer);
    try {
      mkdirSync(archiveDir, { recursive: true });
      let dest = join(archiveDir, `${stem}.md`);
      let suffix = 1;
      while (existsSync(dest)) { suffix += 1; dest = join(archiveDir, `${stem}-${suffix}.md`); }
      renameSync(card.filePath, dest);
      moved.push({ rel, layer, stem, archivedStem: suffix === 1 ? stem : `${stem}-${suffix}` });
    } catch {
      // leave in place on any maintenance failure
    }
  }
  // Rewrite each affected layer's index once, with only its own moves.
  for (const layer of new Set(moved.map((item) => item.layer))) {
    const indexPath = layer === "strategy"
      ? join(root, MEMORY_DIR, "strategy", "index.md")
      : join(root, MEMORY_DIR, "memory", layer, "index.md");
    if (!existsSync(indexPath)) continue;
    try {
      let indexText = readFileSync(indexPath, "utf8");
      for (const item of moved.filter((entry) => entry.layer === layer)) {
        indexText = indexText.replaceAll(`[[${item.stem}|`, `[[archive/${item.archivedStem}|`);
        indexText = indexText.replaceAll(`[[${item.stem}]]`, `[[archive/${item.archivedStem}]]`);
      }
      writeFileSync(indexPath, indexText, "utf8");
    } catch {
      // index update is best-effort
    }
  }
  return moved;
}

/**
 * Scan every memory card once, merge the note_recall hit statistics, and
 * classify cards into ISM-style buckets: strong / weak / unused / duplicate
 * candidates / unverified. Pure function of the vault's files — no model.
 */
export function buildAuditReport(root, helpers) {
  const stats = readRetrievalStats(root);
  // Passive retrieval signal recorded by note_recall under "__meta__":
  // total calls and empty-result calls. Reuse-rate ("hit but not cited") is
  // not deterministically observable here — the agent reports it per AGENTS.md.
  const recallMeta = stats["__meta__"] ?? {};
  const recallCalls = Number.isFinite(recallMeta.calls) ? Math.max(0, Math.trunc(recallMeta.calls)) : 0;
  const recallEmpty = Number.isFinite(recallMeta.empty) ? Math.max(0, Math.trunc(recallMeta.empty)) : 0;
  const passive = { calls: recallCalls, empty: recallEmpty, emptyRate: recallCalls > 0 ? Number((recallEmpty / recallCalls).toFixed(2)) : null };
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
      const inner = readFrontmatter(text);
      const hook = inner === "" ? null : (helpers.parseHookFrontmatter?.(inner) ?? null);
      const rel = join(dir, file).replace(/\\/g, "/");
      const statEntry = stats[rel] ?? {};
      const statUses = Number.isFinite(statEntry.uses) ? statEntry.uses : 0;
      // Strategy cards carry verified/success_rate/uses at the TOP level (no
      // hook block); records/templates carry them inside hook. Read both so the
      // audit and promote work uniformly across card types (self-correction P5).
      const baseUses = Number.isFinite(Number(hook?.uses)) ? Number(hook.uses)
        : (Number.isFinite(Number(meta.uses)) ? Number(meta.uses) : 0);
      const uses = Math.max(0, Math.trunc(baseUses + statUses));
      const lastUsed = typeof statEntry.last_used === "string" && statEntry.last_used !== ""
        ? statEntry.last_used
        : (typeof hook?.last_used === "string" ? hook.last_used : (typeof meta.last_used === "string" ? meta.last_used : ""));
      const successRate = Number.isFinite(Number(hook?.success_rate)) ? Number(hook.success_rate)
        : (Number.isFinite(Number(meta.success_rate)) ? Number(meta.success_rate) : null);
      // Negative-transfer accounting (R1 `usage.harmed`, design-intake §1 item 2):
      // how often this card was used and made things WORSE. `uses`/`success_rate`
      // cannot express "used a lot and misled a lot"; this counter can.
      const harmed = Math.max(0, Math.trunc(
        Number.isFinite(Number(hook?.harmed)) ? Number(hook.harmed)
          : (Number.isFinite(Number(meta.harmed)) ? Number(meta.harmed) : 0)
      ));
      // Provenance witness (R1 ladder, item 3): the ONLY deterministic path that
      // may raise `verified` above single-source is a user confirmation, which
      // writes `verified_by: user`. A card claiming a higher level without that
      // witness was promoted by the agent itself — flag it, never auto-fix it.
      const verifiedBy = typeof hook?.verified_by === "string" ? hook.verified_by
        : (typeof meta.verified_by === "string" ? meta.verified_by : "");
      const days = daysSinceLocal(meta.updated ?? "");
      cards.push({
        rel,
        filePath,
        title: meta.title ?? file.replace(/\.md$/, ""),
        type: meta.type ?? "unknown",
        status: meta.status ?? "active",
        hook,
        uses,
        effectiveUses: uses,
        harmed,
        verifiedBy,
        lastUsed,
        successRate,
        verified: typeof hook?.verified === "string" ? hook.verified
          : (typeof meta.verified === "string" ? meta.verified : null),
        days,
        updated: meta.updated ?? "",
        source: meta.source ?? "",
        related: meta.related ?? "",
        needsReview: String(meta.needs_review ?? "").toLowerCase() === "true",
        lastWrong: meta.last_wrong ?? "",
        duplicateOf: meta.duplicate_of ?? "",
        // Directional provenance (`[[card]]` list): what this card is BUILT ON.
        // Distinct from `related`, which is an undirected "see also" — the audit
        // needs the direction to know which cards break when this one does.
        dependsOn: meta.depends_on ?? "",
        gain: cardGain({
          harmed,
          needsReview: String(meta.needs_review ?? "").toLowerCase() === "true",
          verifiedBy: verifiedBy
        })
      });
    }
  }

  // Deterministic hook-stats sync (opt-out via auditMaintainHookStats: false).
  // FIX(B1): after merging the note_recall hit counts into hook.uses, the
  // stats entries are zeroed — otherwise every daily audit re-adds the same
  // hits and uses grows without bound.
  //
  // Every write here is a CLAIM, so each one is verified by reading the file
  // back (design-intake §1 item 5: "report degraded instead of silent success").
  const postconditions = { statsWrites: 0, statsFailures: [], unmergeableStats: [], statsResetFailed: false, hookHistoryWritten: true };
  // The net-gain verdict is an OUTCOME, not a usage counter: it comes from explicit
  // ✅/❌ feedback and must be persisted even when hook-stat maintenance is switched
  // off (`auditMaintainHookStats: false`). Coupling it to that switch would make the
  // ranking depend on whether usage statistics happen to be maintained, and would
  // silently drop the verdict of a user who just rejected a card.
  //
  // Runs AFTER the stats pass so it writes the post-merge `uses`/`last_used`; when
  // that pass is off it only touches the `gain` line (passing `null` leaves the
  // other two exactly as the file already has them).
  const writeGain = (withStats) => {
    for (const card of cards) {
      if (card.hook === null) continue;
      try {
        const text = readFileSync(card.filePath, "utf8");
        const block = frontmatterBlock(text);
        if (block === null) continue;
        // Declared gain, read the same way the structural checks read `uses`:
        // `frontmatterBlock` has already stripped the `---` fences, so this must
        // NOT be handed to the frontmatter parser (which expects them).
        const declaredGain = /^\s*gain:\s*(-?\d+)\s*$/m.exec(block);
        const hasGain = declaredGain !== null && Number(declaredGain[1]) !== 0;
        const wantsGain = card.gain !== 0;
        if (!withStats && !wantsGain && !hasGain) continue; // nothing to add or drop
        const rewritten = rewriteHookStats(
          block,
          withStats ? card.uses : null,
          withStats ? card.lastUsed : null,
          card.gain
        );
        if (rewritten !== null && rewritten !== block) writeFileSync(card.filePath, replaceFrontmatterBlock(text, rewritten), "utf8");
      } catch {
        // best-effort: the audit reports usage sync failures; a missed verdict is
        // retried on the next run because `gain` is recomputed from the card itself.
      }
    }
  };
  if (helpers.maintainHookStats !== false) {
    let mergedAny = false;
    for (const card of cards) {
      const statEntry = stats[card.rel] ?? {};
      const hasStat = Number.isFinite(statEntry.uses) && statEntry.uses > 0;
      if (card.hook === null) {
        // Strategy cards carry uses/last_used at the top level (no hook block).
        if (card.type === "strategy") {
          if (hasStat) mergedAny = true;
          postconditions.statsWrites += 1;
          if (!syncTopLevelStatsToCard(card.filePath, card.uses, card.lastUsed)) postconditions.statsFailures.push(card.rel);
        } else if (hasStat) {
          // A card with neither a hook block nor top-level strategy stats has
          // nowhere to record the hits — and the reset below would zero them.
          // Say so instead of dropping them silently.
          mergedAny = true;
          postconditions.unmergeableStats.push(card.rel);
        }
        continue;
      }
      if (hasStat) mergedAny = true;
      postconditions.statsWrites += 1;
      // `gain` is deliberately NOT passed here: the verdict has its own write pass
      // (see `writeGain` below) so that persisting it never depends on whether
      // usage statistics are being maintained. Passing it here too would rewrite
      // the same file twice per run.
      if (!syncHookStatsToCard(card.filePath, card.uses, card.lastUsed)) postconditions.statsFailures.push(card.rel);
    }
    // Reset the per-period counters (card hits AND the passive "__meta__"
    // signal) whenever there is anything to consume. Merged-or-not, the meta
    // must not carry over into the next audit window.
    if (mergedAny || passive.calls > 0) {
      const cleaned = {};
      for (const [rel, entry] of Object.entries(stats)) {
        if (rel === "__meta__") continue;
        cleaned[rel] = { uses: 0, last_used: typeof entry?.last_used === "string" ? entry.last_used : "" };
      }
      cleaned["__meta__"] = { calls: 0, empty: 0 };
      try {
        writeFileSync(join(root, RETRIEVAL_STATS_FILE), JSON.stringify(cleaned, null, 2), "utf8");
        const check = JSON.parse(readFileSync(join(root, RETRIEVAL_STATS_FILE), "utf8"));
        postconditions.statsResetFailed = Number(check?.__meta__?.calls ?? -1) !== 0;
      } catch {
        // best-effort; a failed reset only re-inflates counts, never breaks boot
        postconditions.statsResetFailed = true;
      }
    }
    // Persist the verdicts last, so they are written against the POST-merge
    // `uses`/`last_used` rather than the pre-merge values.
    writeGain(true);
  } else {
    // Statistics are not being maintained, but an explicit user verdict still has
    // to reach the card — otherwise a ❌ would be invisible to ranking until
    // someone switches stats back on.
    writeGain(false);
  }

  // Hook usage history (panel trend): one snapshot per day per hook card, with
  // the merged uses — trends must reflect the final post-merge numbers.
  postconditions.hookHistoryWritten = writeHookHistory(root, cards);

  // ── structural integrity checks (retrieval v3 S6) ──────────────────────────
  // The three-write protocol is model-executed; these deterministic checks give
  // the daily audit a structural backstop: records without source, provenance
  // links pointing at nothing, and cards missing from the records index.
  const structural = { missingSource: [], brokenLinks: [], notInIndex: [], unjustifiedUpgrade: [], usesMismatch: [] };
  const extractLinks = (raw) => {
    const links = [];
    const expression = /\[\[([^\[\]|#]+)(?:#[^\]\[]*)?(?:\|[^\]\[]*)?\]\]/g;
    for (const field of [String(raw?.source ?? ""), String(raw?.related ?? "")]) {
      let match;
      expression.lastIndex = 0;
      while ((match = expression.exec(field)) !== null) links.push(match[1].trim().replace(/\.md$/i, ""));
    }
    return links;
  };
  const linkExists = (target) => {
    const candidates = [
      `${target}.md`,
      join(MEMORY_DIR, "memory", "episodes", `${target}.md`),
      join(MEMORY_DIR, "memory", "records", `${target}.md`),
      join(MEMORY_DIR, "memory", "topics", `${target}.md`),
      join(MEMORY_DIR, "memory", "templates", `${target}.md`),
      join(MEMORY_DIR, "inbox", `${target}.md`),
      target
    ];
    return candidates.some((candidate) => existsSync(join(root, candidate)));
  };
  const recordsIndexText = (() => {
    try {
      return readFileSync(join(root, MEMORY_DIR, "memory", "records", "index.md"), "utf8");
    } catch {
      return "";
    }
  })();
  for (const card of cards) {
    // Provenance ladder (machine-checkable, design-intake §1 item 3): AGENTS.md
    // says the agent may only write `single-source`; every higher level needs a
    // user confirmation, which is the only writer of `verified_by: user`.
    if (card.verified !== null && card.verified !== "single-source" && card.verifiedBy !== "user") {
      structural.unjustifiedUpgrade.push(`${card.title}(${card.verified})`);
    }
    if (!card.rel.includes("/records/")) continue; // source discipline applies to record cards
    if (card.source.trim() === "") structural.missingSource.push(card.title);
    for (const target of extractLinks(card)) {
      if (!linkExists(target)) structural.brokenLinks.push(`${card.title}→[[${target}]]`);
    }
    const stem = card.rel.split("/").at(-1).replace(/\.md$/, "");
    if (recordsIndexText !== "" && !recordsIndexText.includes(`[[${stem}`)) structural.notInIndex.push(card.title);
  }

  // Post-condition on the stats sync: a card we claimed to update must now
  // DECLARE the merged value. A leftover mismatch means the write did not land
  // (read-only file, concurrent editor, parse surprise) — reported, never
  // auto-retried, because silently "fixing" a user's file is worse than saying
  // so. This is the declared-vs-effective reconciliation of design-intake §1
  // item 4; the panel shows the same effective number (declared + pending).
  for (const card of cards) {
    let text = "";
    try {
      text = readFileSync(card.filePath, "utf8");
    } catch {
      structural.usesMismatch.push(card.rel);
      continue;
    }
    const fm = readFrontmatter(text);
    const declared = /^\s*uses:\s*(-?\d+)\s*$/m.exec(fm);
    const value = declared === null ? 0 : Number(declared[1]);
    if (!Number.isFinite(value) || value !== card.uses) structural.usesMismatch.push(card.rel);
  }

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
    for (let i = 0; i < bucket.length; i += 1) {
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
  // Order matters more than the cap (MemForest, arXiv:2609.08273): its ablation
  // shows merging the LEAST similar pair (89.0%) is worse than merging a random
  // pair (91.7%), while merging the MOST similar pair wins at 96.0% — and its
  // Eq. 15 gives the reason (the more similar the two nodes, the higher the
  // lower bound on the survivor's query similarity). So the report must lead
  // with the most-similar pair instead of whichever pair bucket order surfaced
  // first. Sorting AFTER collecting is what makes that true globally: the old
  // `duplicates.length < 3` guard stopped the scan early, so "top 3" was "first
  // 3 found".
  duplicates.sort((x, y) => y.jaccard - x.jaccard);

  // ── structural hubs: never propose a well-referenced card as the redundant side
  // Count INCOMING references (how many cards link to this one) — zero cost, the
  // links are already parsed below for the broken-link check. A hub carries the
  // shared premise that other cards hang off, so rewriting or superseding it has
  // the widest blast radius. MemForest encodes the same judgement by down-weighting
  // high-degree nodes in its merge order, "nodes with higher degrees are usually
  // central ... and therefore should not be merged prematurely". Hubs are reported
  // separately and shown WITHOUT merge advice rather than silently dropped.
  const HUB_BACKLINKS = 2;
  const backlinkCount = new Map();
  {
    const stemOf = (card) => String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "");
    const knownStems = new Set(cards.map(stemOf));
    for (const card of cards) {
      for (const target of extractLinks({ source: card.source, related: card.related })) {
        if (target === stemOf(card)) continue; // a self-link is not a reference
        if (!knownStems.has(target)) continue;
        backlinkCount.set(target, (backlinkCount.get(target) ?? 0) + 1);
      }
    }
  }
  const hubCards = cards.filter((card) => (backlinkCount.get(String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "")) ?? 0) >= HUB_BACKLINKS);

  // ── dependency cascade: when a card stops being true, say what hung off it ───
  // `depends_on` records the DIRECTION of provenance (this card is built on that
  // one). That direction is the whole point: `related` is undirected, so it cannot
  // answer "which of my cards are now standing on something that moved?" — the
  // question you actually have when a card is superseded, marked wrong, or demoted.
  //
  // Three independent sources point at this gap: Danus stores every verified fact
  // WITH its incoming dependency edges and makes the fact graph cascade-revocable;
  // MSCE requires each skill to keep evidence anchors so a claim can be traced back;
  // MemForest refuses to merge high-degree nodes early for the same reason (blast
  // radius). See literature/notes/improvement-details-2026-09-17.md item 2.
  //
  // Reported, never auto-repaired: a downstream card may well survive its premise
  // being reworded, and only a reader can decide that. This mirrors the
  // `usesMismatch` stance ("reported, never auto-retried").
  const changedReason = (card) => {
    if (String(card.status ?? "").toLowerCase() === "superseded") return "已被取代(superseded)";
    if (card.needsReview === true) return "被标为待重审(needs_review)";
    return "";
  };
  const dependents = new Map();
  for (const card of cards) {
    for (const target of extractLinks({ source: "", related: card.dependsOn })) {
      const list = dependents.get(target) ?? [];
      list.push(card);
      dependents.set(target, list);
    }
  }
  const downstreamReview = [];
  for (const card of cards) {
    const reason = changedReason(card);
    if (reason === "") continue;
    const stem = String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "");
    for (const dependent of dependents.get(stem) ?? []) {
      if (dependent.rel === card.rel) continue; // a self-dependency is not a cascade
      downstreamReview.push({ card: dependent, via: card, reason });
    }
  }

  // Deterministic duplicate_of marking (self-correction.md P4): the redundant
  // side of a duplicate pair gets a top-level `duplicate_of` link so retrieval
  // can de-duplicate. Content merge stays the model's job (keep the richer
  // evidence/source), so we never auto-supersede here.
  const keptStems = new Set();
  for (const pair of duplicates) {
    const pickRedundant = (x, y) => {
      if (x.uses !== y.uses) return x.uses < y.uses ? x : y;
      if ((x.updated ?? "") !== (y.updated ?? "")) return (x.updated ?? "") < (y.updated ?? "") ? x : y;
      return x.rel > y.rel ? x : y;
    };
    const redundant = pickRedundant(pair.a, pair.b);
    const kept = redundant === pair.a ? pair.b : pair.a;
    keptStems.add(kept.rel);
    if (redundant.duplicateOf !== "") continue; // already marked
    try {
      const text = readFileSync(redundant.filePath, "utf8");
      const block = frontmatterBlock(text);
      if (block === null) continue;
      const keptStem = kept.rel.split("/").at(-1).replace(/\.md$/, "");
      const rewritten = setTopFieldText(block, "duplicate_of", `[[${keptStem}]]`);
      if (rewritten !== block) writeFileSync(redundant.filePath, replaceFrontmatterBlock(text, rewritten), "utf8");
    } catch {
      // best-effort; never break the audit
    }
  }

  // ── heat/utility + antipatterns (memory-review 2026-08) ────────────────────
  // Heat-based utility (MACLA prune × MemoryOS heat × ISM promote/demote):
  // 0.5 × verified strength + 0.3 × usage frequency + 0.2 × recency (90-day).
  const verifiedStrength = { "user-confirmed": 1, "cross-referenced": 0.66, "single-source": 0.33 };
  const utilityOf = (card) => {
    const v = verifiedStrength[card.verified] ?? 0.33;
    const freq = Math.min(card.uses / 10, 1);
    const recency = card.days === null ? 0.5 : Math.max(0, 1 - card.days / 90);
    return 0.5 * v + 0.3 * freq + 0.2 * recency;
  };
  const archiveCandidates = cards
    .filter((card) => card.status === "active" && card.verified !== "user-confirmed")
    .map((card) => ({ card, utility: Number(utilityOf(card).toFixed(3)) }))
    .sort((a, b) => a.utility - b.utility)
    .slice(0, 3);

  // Antipatterns: weak cards (failure signal) + artifact cards explicitly
  // marked as counterexamples / failures / mistakes-to-avoid.
  const antipatterns = cards.filter((card) =>
    card.status === "active" &&
    ((card.successRate !== null && card.successRate <= AUDIT_WEAK_RATE && card.uses >= AUDIT_WEAK_USES) ||
     (card.type === "artifact" && /反例|障碍|失败|mistake|antipattern|avoid/i.test(card.title))));

  // Pending re-review (self-correction.md P2): cards flagged by a ❌ feedback.
  // Key on needs_review ONLY — it is the actionable flag the model clears after
  // re-verifying; last_wrong is an informational timestamp that must NOT keep a
  // card in the list forever. Detection only; the model performs the actual
  // re-verification per AGENTS.md by reading the source chain.
  const pendingReview = cards.filter((card) => card.needsReview === true);

  // Auto-archive targets (self-correction.md P3): the strict safe subset —
  // active, never user-confirmed, zero-use, long-stale, not the kept side of a
  // duplicate. Detection always runs; the move happens only when
  // helpers.autoArchive is true (off by default).
  const autoArchiveTargets = cards.filter((card) =>
    card.status === "active" &&
    card.verified !== "user-confirmed" &&
    card.uses === 0 &&
    card.days !== null && card.days > AUTO_ARCHIVE_UNUSED_DAYS &&
    !keptStems.has(card.rel));
  let archived = [];
  if (helpers.autoArchive === true && autoArchiveTargets.length > 0) {
    archived = moveCardsToArchive(root, autoArchiveTargets);
  }

  // Deterministic promote (self-correction.md P5b): a candidate strategy card
  // that has been used enough and succeeds often enough becomes active.
  for (const card of cards) {
    if (card.status !== "candidate" || card.type !== "strategy") continue;
    if (card.uses < PROMOTE_USES || card.successRate === null || card.successRate < PROMOTE_RATE) continue;
    try {
      const text = readFileSync(card.filePath, "utf8");
      const block = frontmatterBlock(text);
      if (block === null) continue;
      const rewritten = setTopFieldText(block, "status", "active");
      if (rewritten !== block) writeFileSync(card.filePath, replaceFrontmatterBlock(text, rewritten), "utf8");
    } catch {
      // best-effort
    }
  }

  // ── two registers, one source of truth ───────────────────────────────────
  // The audit used to produce ONE string that was (a) injected into the model's
  // prompt, (b) written to cache/memory-audit.json, and (c) rendered verbatim in
  // both memory panels. It reads as an imperative checklist addressed to the
  // agent, so the human saw "——按 AGENTS.md 补 source、修断链、补索引行。" next to
  // raw `[[.deepseek/...|title]]` and a 0-1 "utility" scalar (user report:
  // 「几乎就是 dsh 的输出记录，令人不知所云」).
  //
  // Now: `sections` carries the structured facts (so any surface renders from
  // data, not by re-parsing prose), `checklist` is the terse model-facing block,
  // and `human` is what a person reads. All three are derived from the same
  // arrays, so they cannot drift.
  // `archived` is produced by the move above, so every list built here must
  // exclude the cards that just left the vault — otherwise the report tells the
  // user to archive a card it has already archived (the file is gone; the row
  // would be dead). One set, applied to all sections and to `decisions`.
  const archivedRels = new Set(archived.map((item) => item.rel));
  const live = (card) => !archivedRels.has(card.rel);
  // `gain` rides along on every card ref: it is the machine-owned verdict on
  // whether using this card helped, and both the panels and the tests need to see
  // it without re-reading the files.
  const cardRef = (card) => ({ rel: card.rel, title: card.title, gain: card.gain ?? 0 });
  const liveArchiveCandidates = archiveCandidates.filter(({ card }) => live(card));
  const livePendingReview = pendingReview.filter(live);
  const liveDuplicates = duplicates.filter(({ a, b }) => live(a) && live(b));
  // A pair touching a hub is still reported (the overlap is real evidence) but it
  // is flagged so the reader sees WHY it is not an ordinary merge: rewriting the
  // hub side would ripple through everything that references it.
  const isHub = (card) => hubCards.some((hub) => hub.rel === card.rel);
  const hubName = (card) => `${card.title}(${backlinkCount.get(String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "")) ?? 0} 处引用)`;
  const sections = {
    strong: strong.filter(live).map(cardRef),
    weak: weak.filter(live).map(cardRef),
    unused: unused.filter(live).map((card) => ({ ...cardRef(card), days: card.days ?? null })),
    unverified: unverified.filter(live).map(cardRef),
    // Most-similar pair first (see the sort above); `jaccard` is carried so the
    // checklist can state WHY this pair is at the top.
    duplicates: liveDuplicates.slice(0, 3).map(({ a, b, jaccard }) => ({
      a: cardRef(a),
      b: cardRef(b),
      jaccard,
      hub: isHub(a) ? hubName(a) : (isHub(b) ? hubName(b) : "")
    })),
    // Cards other cards hang off. Reported so a merge/rewrite of the shared
    // premise is a deliberate decision instead of an accident.
    hubs: hubCards.filter(live).map((card) => ({
      ...cardRef(card),
      backlinks: backlinkCount.get(String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "")) ?? 0
    })),
    pendingReview: livePendingReview.map((card) => ({ ...cardRef(card), lastWrong: card.lastWrong ?? "" })),
    archiveCandidates: liveArchiveCandidates.map(({ card, utility }) => ({ ...cardRef(card), utility })),
    antipatterns: antipatterns.filter(live).map(cardRef),
    // Negative-transfer accounting: cards that were used and made things worse.
    harmed: cards.filter((card) => live(card) && card.harmed > 0)
      .map((card) => ({ ...cardRef(card), harmed: card.harmed, uses: card.uses })),
    autoArchiveTargets: autoArchiveTargets.map((card) => ({ ...cardRef(card), filePath: card.filePath })),
    // Cards standing on a premise that has moved. Each entry names BOTH ends so the
    // reader can judge whether the dependent still holds.
    downstreamReview: downstreamReview
      .filter(({ card, via }) => live(card) && live(via))
      .map(({ card, via, reason }) => ({ ...cardRef(card), via: cardRef(via), reason })),
    archived: archived.map((item) => ({ rel: item.rel, stem: item.stem }))
  };
  const thresholds = {
    unusedDays: AUDIT_UNUSED_DAYS,
    unverifiedDays: AUDIT_UNVERIFIED_DAYS,
    weakUses: AUDIT_WEAK_USES,
    weakRate: AUDIT_WEAK_RATE,
    strongRate: AUDIT_STRONG_RATE,
    duplicateJaccard: AUDIT_DUP_JACCARD,
    autoArchiveUnusedDays: AUTO_ARCHIVE_UNUSED_DAYS
  };

  // What needs a HUMAN decision (the panel's headline number). Downstream review
  // counts as one decision PER DEPENDENT CARD: each is a separate judgement, and
  // collapsing them would hide how far a single wrong premise reached.
  const liveDownstreamReview = sections.downstreamReview;
  const decisions = {
    reviewCards: livePendingReview.length,
    cleanupCards: liveArchiveCandidates.length + liveDuplicates.length,
    downstreamCards: liveDownstreamReview.length,
    total: livePendingReview.length + liveArchiveCandidates.length + liveDuplicates.length + liveDownstreamReview.length
  };

  // `counts` keeps its v1 key set (readers written against 0.7.x must not break)
  // but now counts only cards that are still in the vault.
  const counts = {
    cards: cards.length - archivedRels.size,
    strong: sections.strong.length,
    weak: sections.weak.length,
    unused: sections.unused.length,
    duplicates: sections.duplicates.length,
    unverified: sections.unverified.length,
    antipatterns: sections.antipatterns.length,
    archiveCandidates: sections.archiveCandidates.length,
    pendingReview: sections.pendingReview.length,
    harmed: sections.harmed.length,
    autoArchived: sections.archived.length
  };

  // Degraded instead of silent success (R2 `status:"degraded"`, design-intake §1
  // item 5). The audit performs deterministic writes; when one of them cannot be
  // confirmed, the report says so rather than reporting a clean run. Four of the
  // bugs fixed on 2026-09-10 were exactly this shape.
  const warnings = [];
  if (postconditions.statsFailures.length > 0) {
    warnings.push(`${postconditions.statsFailures.length}/${postconditions.statsWrites} 张卡的 uses 回写未确认：${postconditions.statsFailures.slice(0, 3).join("、")}`);
  }
  if (postconditions.statsResetFailed) warnings.push("检索统计的重置未确认（下一轮体检可能重复计入同一批命中）");
  if (postconditions.unmergeableStats.length > 0) {
    warnings.push(`${postconditions.unmergeableStats.length} 张卡的命中无处可写（既无 hook 块也不是策略卡），这批 hits 会在重置时丢失：${postconditions.unmergeableStats.slice(0, 3).join("、")}`);
  }
  if (!postconditions.hookHistoryWritten) warnings.push("hook 历史快照写入未确认（面板趋势可能停在上一轮）");
  if (structural.usesMismatch.length > 0) {
    warnings.push(`${structural.usesMismatch.length} 张卡的声明 uses 与合并值不一致：${structural.usesMismatch.slice(0, 3).join("、")}`);
  }
  const status = warnings.length === 0 ? "ok" : "degraded";

  /** Model-facing checklist: terse, imperative, paths and thresholds included. */
  const checklistLines = [];
  if (cards.length > 0) {
    checklistLines.push(`记忆体检（${today}，共 ${cards.length} 张卡）${status === "degraded" ? "［DEGRADED］" : ""}`);
    if (status === "degraded") checklistLines.push(`- ⚠️ 未确认项：${warnings.join("；")}`);
    if (sections.harmed.length > 0) {
      checklistLines.push(`- 负反馈（用过但结果更差）: ${sections.harmed.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]](${card.harmed}/${card.uses})`).join("、")}`);
    }
    if (structural.unjustifiedUpgrade.length > 0) {
      checklistLines.push(`- 越权升级（verified 高于 single-source 但不是用户确认写入的）: ${structural.unjustifiedUpgrade.slice(0, 3).join("、")}`);
    }
    if (structural.missingSource.length + structural.brokenLinks.length + structural.notInIndex.length > 0) {
      const structuralParts = [];
      if (structural.missingSource.length > 0) structuralParts.push(`缺 source: ${structural.missingSource.length} 张（${structural.missingSource.slice(0, 3).join("、")}）`);
      if (structural.brokenLinks.length > 0) structuralParts.push(`断链: ${structural.brokenLinks.length} 处（${structural.brokenLinks.slice(0, 2).join("；")}）`);
      if (structural.notInIndex.length > 0) structuralParts.push(`未入索引: ${structural.notInIndex.length} 张（${structural.notInIndex.slice(0, 3).join("、")}）`);
      checklistLines.push(`- 结构校验：${structuralParts.join("；")}`);
    }
    if (passive.calls > 0) {
      const emptyPct = Math.round((passive.empty / passive.calls) * 100);
      checklistLines.push(`- 检索健康：上次体检以来 ${passive.calls} 次检索，空结果 ${passive.empty} 次（${emptyPct}%）`);
    }
    const listOf = (items, limit = 3, withDays = false) => items.slice(0, limit)
      .map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]${withDays && card.days !== null ? `(${card.days}天)` : ""}`)
      .join("、");
    if (sections.antipatterns.length > 0) checklistLines.push(`- 反模式: ${listOf(sections.antipatterns)}`);
    if (sections.pendingReview.length > 0) checklistLines.push(`- 待重审: ${listOf(sections.pendingReview)}`);
    if (sections.archiveCandidates.length > 0) {
      checklistLines.push(`- 低效用归档候选: ${sections.archiveCandidates.map((c) => `[[${c.rel.replace(/\.md$/, "")}|${c.title}]](${c.utility})`).join("、")}`);
    }
    if (sections.archived.length > 0) checklistLines.push(`- 已自动归档 ${sections.archived.length} 张: ${sections.archived.slice(0, 3).map((a) => a.stem).join("、")}`);
    for (const [label, items] of [["strong", sections.strong], ["weak", sections.weak], ["unused", sections.unused], ["unverified", sections.unverified]]) {
      if (items.length === 0) continue;
      checklistLines.push(`- ${label}: ${listOf(items, 3, label === "unused")}`);
    }
    if (sections.duplicates.length > 0) {
      // Ordered by similarity (highest first) and annotated with the score, so the
      // reader can tell evidence strength apart instead of seeing an undifferentiated
      // list. A pair that touches a hub carries that fact inline, because the merge
      // instruction differs: do NOT overwrite the hub side.
      const pairs = sections.duplicates.map(({ a, b, jaccard, hub }) =>
        `[[${a.rel.replace(/\.md$/, "")}|${a.title}]] ↔ [[${b.rel.replace(/\.md$/, "")}|${b.title}]](${jaccard.toFixed(2)}${hub === "" ? "" : `，含枢纽 ${hub}，不要覆盖枢纽那一侧`})`);
      checklistLines.push(`- 疑似重复（按相似度降序，先处理第一对）: ${pairs.join("；")}`);
    }
    if (sections.hubs.length > 0) {
      checklistLines.push(`- 结构枢纽（被多张卡引用，改动影响面最大——合并/改写前先确认）: ${sections.hubs.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]](${card.backlinks} 处引用)`).join("、")}`);
    }
    if (sections.downstreamReview.length > 0) {
      // Name both ends: the reader has to judge whether the DEPENDENT still holds
      // once its premise moved, and that needs the reason the premise moved.
      const rows = sections.downstreamReview.slice(0, 3).map((item) =>
        `[[${item.rel.replace(/\.md$/, "")}|${item.title}]] ← 依赖 [[${item.via.rel.replace(/\.md$/, "")}|${item.via.title}]]（${item.reason}）`);
      checklistLines.push(`- 下游待复查（依据已变动，逐条读后判断是否仍成立）: ${rows.join("；")}${sections.downstreamReview.length > 3 ? ` … 共 ${sections.downstreamReview.length} 张` : ""}`);
    }
  } else {
    checklistLines.push("（尚无记忆卡，无可体检内容）");
  }

  /**
   * Human-facing summary: answers "how is my memory, and what needs me?".
   * Counts-only headline (no invented 0-100 score), then one line per thing the
   * user can act on. Identifiers (note_recall / success_rate / needs_review /
   * Jaccard) and `.deepseek/...` paths are deliberately absent.
   */
  const humanLines = [];
  if (cards.length > 0) {
    const reliable = counts.strong;
    const headline = [
      `记忆体检 ${today}`,
      // Scoped on purpose: the audit only maintains records/templates/strategy
      // (they carry hook statistics and a lifecycle). topics/theorems are
      // navigation cards and are never "low-utility → archive", so the panel's
      // per-layer counts and this number legitimately differ — say which cards
      // this counts instead of leaving the reader to wonder.
      `${counts.cards} 张卡（记录/模板/策略）`,
      `${reliable} 张可靠`,
      counts.weak > 0 ? `${counts.weak} 张待改写` : "",
      counts.unused > 0 ? `${counts.unused} 张长期没用` : "",
      decisions.total > 0 ? `需要你决定 ${decisions.total} 件` : "暂无需要你决定的事"
    ].filter((part) => part !== "");
    humanLines.push(headline.join(" · "));
    if (status === "degraded") {
      humanLines.push(`⚠️ 本次体检有未确认项（不是"全部正常"）：${warnings.join("；")}。`);
    }
    if (sections.harmed.length > 0) {
      const names = sections.harmed.slice(0, 3).map((c) => `「${c.title}」`).join("、");
      humanLines.push(`🧨 ${sections.harmed.length} 张卡"用过但结果更差"：${names}${sections.harmed.length > 3 ? " …" : ""}——它们不是"内容错"，而是"用了反而误导"，值得改写适用边界或归档。`);
    }
    if (structural.unjustifiedUpgrade.length > 0) {
      humanLines.push(`🔓 ${structural.unjustifiedUpgrade.length} 张卡的验证等级高于"单源"，但不是由你的确认写入的——按规则升级只能来自你的 ✅；助手会重判或降回。`);
    }
    if (decisions.reviewCards > 0) {
      humanLines.push(`✍️ ${decisions.reviewCards} 张卡被你标过「错」，助手会在相关讨论时读来源证据链重判；你也可以直接在下面点 ✅ 或 ❌。`);
    }
    if (counts.weak > 0) {
      humanLines.push(`🩹 ${counts.weak} 张用过但成功率偏低，助手会在相关讨论时改写它们的内容或适用边界。`);
    }
    if (counts.unused > 0) {
      const names = sections.unused.slice(0, 3).map((c) => `「${c.title}」${c.days === null ? "" : `（${c.days} 天）`}`).join("、");
      humanLines.push(`🕸 ${counts.unused} 张超过 ${thresholds.unusedDays} 天没被用到：${names}${counts.unused > 3 ? " …" : ""}。可以点「归档」把它们移进 archive（移动而非删除，可逆）。`);
    }
    if (counts.duplicates > 0) {
      humanLines.push(`🔁 ${counts.duplicates} 组疑似重复，助手会合并成一张（先处理最像的一对）：${sections.duplicates.slice(0, 2).map(({ a, b, hub }) => `「${a.title}」↔「${b.title}」${hub === "" ? "" : "（含被多张卡引用的枢纽，会保留枢纽那一侧）"}`).join("；")}`);
    }
    if (sections.hubs.length > 0) {
      // Say what a hub IS in user terms, not "degree" — the point is that these
      // cards are load-bearing, so changing them is a bigger decision.
      const names = sections.hubs.slice(0, 3).map((card) => `「${card.title}」（${card.backlinks} 张卡引用它）`).join("、");
      humanLines.push(`🧱 ${sections.hubs.length} 张卡是别的东西的依据：${names}${sections.hubs.length > 3 ? " …" : ""}——改它们之前值得多想一步。`);
    }
    if (sections.downstreamReview.length > 0) {
      // User-facing phrasing: the point is "the ground moved under these", not the
      // mechanism. Naming the premise tells them what to re-read.
      const names = sections.downstreamReview.slice(0, 3).map((item) => `「${item.title}」（依据是「${item.via.title}」）`).join("、");
      humanLines.push(`⛓ ${sections.downstreamReview.length} 张卡建立在一张已经变动的卡上：${names}${sections.downstreamReview.length > 3 ? " …" : ""}——助手会逐条读后告诉你它们是否还成立。`);
    }
    if (counts.unverified > 0) {
      humanLines.push(`❓ ${counts.unverified} 张仍是单一来源、且已超过 ${thresholds.unverifiedDays} 天没有互证——用到它们时请留意。`);
    }
    if (passive.calls > 0) {
      const emptyPct = Math.round((passive.empty / passive.calls) * 100);
      humanLines.push(`🔍 上次体检以来检索 ${passive.calls} 次，其中 ${passive.empty} 次没找到内容（${emptyPct}%）${emptyPct >= 30 ? "——偏高，助手会先改进检索用词。" : "。"}`);
    }
    if (sections.archived.length > 0) {
      humanLines.push(`📦 本次体检自动归档了 ${sections.archived.length} 张低效用卡（在 .deepseek/archive/ 下按层存放，可找回）。`);
    }
    if (decisions.total === 0 && counts.weak === 0) humanLines.push("（没有需要你处理的项目。）");
  } else {
    humanLines.push("（还没有记忆卡，暂时没有可体检的内容。）");
  }

  // `report` stays for backward compatibility with anything reading the old
  // field, but it is now the CHECKLIST (what the model consumes), not the text a
  // panel should show.
  const checklist = clip(checklistLines.join("\n"), MAX_AUDIT_CHARS);
  const human = humanLines.join("\n");

  return {
    generatedAt: Date.now(),
    schemaVersion: AUDIT_SCHEMA_VERSION,
    today,
    // "ok" | "degraded": every deterministic write in this pass is verified by
    // reading it back; `warnings` names the ones that could not be confirmed.
    status,
    warnings,
    postconditions,
    counts,
    decisions,
    thresholds,
    sections,
    structural: {
      missingSource: structural.missingSource.length,
      brokenLinks: structural.brokenLinks.length,
      notInIndex: structural.notInIndex.length,
      unjustifiedUpgrade: structural.unjustifiedUpgrade.length,
      usesMismatch: structural.usesMismatch.length,
      hubs: hubCards.length,
      downstream: sections.downstreamReview.length
    },
    // The names behind the structural counts (the checklist quotes a few; the
    // panels/CLI can list them all without re-running the scan).
    structuralDetail: {
      unjustifiedUpgrade: structural.unjustifiedUpgrade.slice(0, 20),
      usesMismatch: structural.usesMismatch.slice(0, 20),
      hubs: hubCards.slice(0, 20).map((card) => ({
        ...cardRef(card),
        backlinks: backlinkCount.get(String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "")) ?? 0
      })),
      // The authoritative gain verdict per card, including the zeros. Kept flat and
      // separate from the sections because a card with a verdict may appear in no
      // section at all (a healthy, unused card), and the panels need the full list.
      gains: cards.filter(live).map((card) => ({ rel: card.rel, gain: card.gain ?? 0 }))
    },
    // Legacy flat fields (audit schema v1 readers: dsh/host/memory-admin.mjs and
    // older panels). Same arrays as `sections`, minus the archived ones.
    antipatterns: sections.antipatterns.map((card) => card.rel),
    archiveCandidates: sections.archiveCandidates.map((card) => ({ rel: card.rel, title: card.title, utility: card.utility })),
    pendingReview: sections.pendingReview.map((card) => card.rel),
    autoArchiveTargets: sections.autoArchiveTargets.map((card) => ({ rel: card.rel, filePath: card.filePath, title: card.title })),
    archived: sections.archived.map((item) => item.rel),
    passive,
    checklist,
    human,
    checklistChars: checklist.length,
    checklistTruncated: !checklistLines.join("\n").startsWith(checklist.replace(/ …$/, "")),
    humanChars: human.length,
    report: checklist
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

/**
 * Persist the panel's trend snapshots.
 * @returns `true` when the file was written (or reparsed to the intended
 *   content), `false` on any failure — the audit reports the latter instead of
 *   assuming success.
 */
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
    const target = join(root, HOOK_HISTORY_FILE);
    writeFileSync(target, JSON.stringify(next, null, 2), "utf8");
    // Post-condition: the file we just wrote parses and has the same snapshot count.
    const check = JSON.parse(readFileSync(target, "utf8"));
    return Object.keys(check?.snapshots ?? {}).length === Object.keys(next?.snapshots ?? {}).length;
  } catch {
    return false;
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
function pathInside(root, child) {
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
export function buildMemorySection({ vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs }, currentSessionId, dialogueIndex, auditReport, memoText) {
  const profile = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "profile.md"), MAX_PROFILE_CHARS);
  const topics = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "topics", "index.md"), MAX_TOPIC_INDEX_CHARS);
  const records = recordIndexDigest(vaultRoot, MAX_RECORD_INDEX_CHARS);
  const templates = templateIndexDigest(vaultRoot, MAX_TEMPLATE_INDEX_CHARS);
  const episodes = episodeIndexDigest(vaultRoot, MAX_EPISODE_INDEX_CHARS);
  const memos = memoText ?? memoDigest(vaultRoot, MAX_INBOX_CHARS);

  const lines = [
    "## 分层长期记忆（由 math-memory 自动注入；导航层在此，证据层在磁盘）",
    "",
    "记忆按 arXiv:2606.24775 与 arXiv:2607.05794 的原则组织为五层：profile=语义层，topics=导航层，" +
    "records=类型化原子记录层，episodes=原始证据层，inbox=想法层；另有三个在五层之后长出来的检索面：" +
    "theorems=定理索引（个人 Matlas）、templates=问题模板库、strategy=策略层（方法卡：困难 → 策略 → 检索目标）。" +
    "以下内容用于“知道去哪找”，不要当作完整证据。回答细节问题时必须按路由规则读文件：",
    "- 精确事实 / 用户原话 / 日期数字 → 先 grep `.deepseek/memory/episodes/` 再读命中文件；",
    "- 类型化原子事实（fact/event/instruction/preference）→ 先看 `.deepseek/memory/records/index.md`，再 grep/读具体记录，记录里的 source 可回原始证据；",
    "- 相关定理 / 命题 / 引理 → 先看 `.deepseek/memory/theorems/index.md`，再 grep 笔记全文并核对适用性；",
    "- 同类题型 / 解法模式 → `memory/templates/index.md` 与关联定理（去重聚合）；",
    "- 方法 / 策略类问题（证明、构造）→ 先用 `note_strategy` 取方法卡（困难 → 策略 → 检索目标），再按 move→retrieve 清单走 `note_recall`；",
    "- 主题来龙去脉 → 先读 `.deepseek/memory/topics/index.md` 定位，再读 `topics/<slug>.md` 或相关笔记；",
    "- “当前最新状态” → 比较 frontmatter `updated` 或最新 episode 时间戳；",
    "- 检索不到就明说没有，不要编造。"
  ];

  // 记忆适用性（AdaptiveMem / MemTrapBench 本土化）：记忆是候选不是指令，防止
  // 推理固定（旧策略惯性 / 负反馈泛化 / 跨任务残留）与信念扭曲（错误记忆覆盖客观真值）。
  lines.push(
    "",
    "记忆是候选，不是指令：「已记录 + 相关 + 已验证」≠「适用于当前问题」。使用任何命中卡/笔记前先做适用性判断：",
    "- 任务边界：只锚定最新 query 真实在问什么，不沿用上一任务的范围/格式/记号/结论；",
    "- 认知偏差：历史反复成功的技巧对新问题可能不适用，不要因「✅ 高成功率」就惯性沿用，先从当前条件重新判断；",
    "- 创伤：某卡被标过 ❌ 或某技巧在特定场景失败，不等于新场景也不能用，负面反馈不覆盖正确性；",
    "- 信念扭曲：记忆里的定义/结论若与公认数学定义或客观事实冲突，以公认定义为准并提示用户。",
    "冲突时优先「客观真值 + 当前 query + 最小上下文」，其次才是记忆；拿不准时从当前问题本身推理，不要被记忆带偏。"
  );

  // When the Obsidian plugin provides its loopback link server, tell the
  // agent to render note references in replies as clickable links so the
  // user can jump straight into Obsidian from the sidebar iframe. The same
  // server's /open and /feedback endpoints are guarded by a CSRF token that
  // the plugin passes as DSH_MATH_MEMORY_FEEDBACK_TOKEN (legacy
  // DSH_OBSIDIAN_FEEDBACK_TOKEN accepted as a fallback; the host panel reads the
  // same pair in the same order — docs/env-vars.md) — the rendered link
  // templates MUST carry it as t= or the click is rejected with 403.
  const linkBaseUrl = (process.env.DSH_MATH_MEMORY_LINK_URL ?? process.env.DSH_OBSIDIAN_LINK_URL)?.trim() ?? "";
  if (linkBaseUrl !== "") {
    const linkToken = (process.env.DSH_MATH_MEMORY_FEEDBACK_TOKEN ?? process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN)?.trim() ?? "";
    const tokenSuffix = linkToken === "" ? "" : `&t=${linkToken}`;
    lines.push(
      `- 回复正文中引用笔记时，使用可点击链接：[标题](${linkBaseUrl}/open?path=<vault 相对路径，原样放入>${tokenSuffix})；`,
      "  点击即可在 Obsidian 中打开对应笔记。笔记文件内部仍写 [[wikilink]]，两者不要混用。",
      `- 引用记忆卡时标注验证等级徽标：✅用户确认（hook.verified=user-confirmed）/ ⚖️互证（cross-referenced）/ ❓单源（single-source 或缺失）。`,
      "  两个徽标都是「这张卡本身可信吗」的信号，不是你这一轮用得对不对。",
      // One line PER CARD, and the card's title must be in the line: the old row
      // emitted N identical `[✅ 这条对]` links whose only difference was the
      // path inside the URL, and 「这条」 read as "this answer was right" while
      // the action is a permanent per-card verdict. The third link (🔁 不适用)
      // is gone: it wrote `last_not_applicable`, which nothing in the system
      // reads (verified by grep), so it looked like ❌ but changed nothing —
      // "memory is a candidate, not an instruction" is enforced at inference
      // time by the applicability discipline above instead. Legacy links in old
      // transcripts still work: the host keeps the action.
      `- 本回复依据了记忆卡时，在末尾**每张实际用到的卡各给一行**反馈链接（path 为该卡 vault 相对路径，原样放入；标题用该卡的标题，便于用户确认是哪一张）：`,
      `  依据的记忆：<卡标题> — [✅ 这条对](${linkBaseUrl}/feedback?path=<卡路径>&action=confirm${tokenSuffix}) [❌ 这张卡有错](${linkBaseUrl}/feedback?path=<卡路径>&action=wrong${tokenSuffix})`,
      "  点击后由 Obsidian 插件直接改写该卡的验证等级与成功率，无需你代劳。只给本轮真正用到的卡，不要为凑反馈而引用没用到的卡。"
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
    `- 💡 想法 idea: ${capturePolicy.idea} · 事实 fact（事实/事件/指令/工作产物）: ${capturePolicy.fact} · 偏好 preference（画像/记号）: ${capturePolicy.preference} · 结构 structure（主题/定理索引/问题模板/策略卡）: ${capturePolicy.structure}`,
    "- auto=按三写协议直接写入；ask=先经 ask_user 征得同意再写；off=不主动捕获（用户明确要求时除外）。",
    "- **每个档位管哪些层**（照此执行，不要再按「第几步」推断）：idea→inbox 想法；fact→records 的 fact/event/instruction/artifact；preference→profile.md 与 notation.md；structure→topics/、theorems/index.md、templates/、strategy/ 的索引与结构行。事件层（episodes）由确定性会话捕获写入，不受本表管辖（开关是 config.md 的 sessionCapture）。",
    captureText === "" ? "- （策略文件缺失，按默认档位 idea=ask / fact=ask / preference=ask / structure=auto 执行——写入记录内容前一律先征得同意；结构层只补索引。）" : "- 用户口头指令优先于策略文件。"
  );

  if (profile !== "") {
    lines.push("", "### 用户画像与稳定偏好（.deepseek/memory/profile.md）", "", profile);
  } else {
    lines.push("", "### 用户画像与稳定偏好", "", "（尚未建立。按 AGENTS.md 在首次对话后创建 .deepseek/memory/profile.md。）");
  }

  // Notation system: always relevant (like the profile), injected bounded.
  // The full ledger lives at .deepseek/memory/notation.md; maintenance rules
  // are in AGENTS.md (收集→统一→维护).
  const notation = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "notation.md"), 800);
  if (notation !== "") {
    lines.push("", "### 记号体系（.deepseek/memory/notation.md；收集→统一→维护，回复时遵循已采纳记号，发现不一致按 AGENTS.md 提议统一）", "", notation);
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

  // (retrieval v3 S5: no per-request recall section — the static navigation
  // layers above are the map; relevant content is pulled via note_recall.)

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
    lines.push("", "### 记忆体检（math-memory 确定性扫描，见 .deepseek/cache/memory-audit.json）", "", auditReport.report,
      "", "体检清单按 AGENTS.md 处理：weak → 读卡改写内容或适用边界（success_rate 由插件自动重估，不要动它；同一张卡改 3 次仍弱则建议归档）；疑似重复 → 合并为一张、旧卡标 superseded（保留证据与 source 链）；unused → 在回复末尾一行向用户建议处置，不自行删除；strong → 相关讨论中把新技巧追加进 techniques；unverified → 保持单源引用，未经用户确认不得提升验证等级。");
  }

  // Working memory (strategy layer §5): a transient scratch draft, injected
  // only when non-empty; the whole file is bounded ≤500 chars (its frontmatter
  // is a single "updated" line). It is a draft, not long-term memory.
  const working = readMemoryFile(vaultRoot, join(MEMORY_DIR, "working.md"), 500);
  if (working !== "") {
    lines.push("", "### 工作记忆（.deepseek/working.md，草稿，非长期记忆）", "", working,
      "", "这是上一轮未闭合线程的进度草稿，可被本轮推翻；有产出时在本轮末覆写它、闭环则清空（经验缓冲在轮末流入 strategy 层/records，不留在草稿里）。");
  }

  return clip(lines.join("\n"), MAX_TOTAL_MEMORY_CHARS);
}

// ── engine with per-process caching ─────────────────────────────────────────

function defaultSessionsRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "sessions");
}

function normalizeConfig(config) {
  // vaultRoot is resolved per agent (config → env → session cwd) by the shared
  // resolveWorkspaceRoot helper from note-tools.mjs, so the preset stays
  // portable across machines and vaults.
  const vaultRoot = (config.vaultRoot ?? "").trim();
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
  const dialogueIndexEnabled = config.dialogueIndex !== false;
  const remindersEnabled = config.reminders !== false;
  const auditMaintainHookStats = config.auditMaintainHookStats !== false;
  const autoArchive = config.autoArchive === true;
  // Dialogue capture is opt-in: OFF unless explicitly enabled. The default is
  // no longer true so the assistant never silently archives whole conversations.
  const sessionCapture = config.sessionCapture === true;
  // Subagent sessions (delegated children) replay their parent's prefix, so
  // capturing them stores the same conversation several times and dilutes the
  // injected budget. They are skipped by default; `captureSubagents: true`
  // opts back in.
  const captureSubagents = config.captureSubagents === true;
  const auditIntervalMs = Number.isFinite(config.auditIntervalMs) && config.auditIntervalMs >= 0
    ? config.auditIntervalMs
    : DEFAULT_AUDIT_INTERVAL_MS;
  if (!isAbsolute(sessionsRoot)) throw new TypeError("math-memory: sessionsRoot must be an absolute path");
  return { vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs, auditEnabled, dialogueIndexEnabled, remindersEnabled, auditMaintainHookStats, autoArchive, sessionCapture, captureSubagents, auditIntervalMs };
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
  #lastCaptureAt = 0;
  // Per-workspace override for dialogue capture, set by sectionForAgent from
  // `.deepseek/config.md` sessionCapture (undefined = preset config applies).
  #sessionCaptureOverride = undefined;

  constructor(config, helpers = {}) {
    this.#config = normalizeConfig(config);
    this.#helpers = helpers;
  }

  /**
   * Fire-and-forget dialogue capture (obelisk-comparison.md §5): persist
   * finished sessions into the episodes layer. Throttled so the assemble-path
   * trigger never does real work more than once a minute, and the marker makes
   * each call a cheap metadata scan unless a session actually grew. Never
   * throws — a capture failure must not break boot or prompt assembly.
   */
  captureNow(enabled) {
    const config = this.#config;
    // `enabled` (per-workspace config.md) > latest per-workspace override
    // (also from config.md via sectionForAgent) > preset agent.cordis.yml.
    if (!(enabled ?? this.#sessionCaptureOverride ?? config.sessionCapture)) return;
    const now = Date.now();
    if (now - this.#lastCaptureAt < CAPTURE_THROTTLE_MS) return;
    this.#lastCaptureAt = now;
    try {
      const vaultRoot = this.#helpers.resolveWorkspaceRoot
        ? this.#helpers.resolveWorkspaceRoot(config.vaultRoot, process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT, "")
        : "";
      if (vaultRoot === "") return;
      const state = readCaptureState(vaultRoot);
      runSessionCapture(vaultRoot, config.sessionsRoot, state, { captureSubagents: config.captureSubagents });
    } catch {
      // advisory; never break the prompt
    }
  }

  cachePathFor(vaultRoot) {
    return join(vaultRoot, CACHE_FILE);
  }

  /** Return the current dialogue index, rebuilding it only when sources changed. */
  getDialogueIndex(vaultRoot, force = false) {
    const config = this.#config;
    // Fingerprint the SAME vault-filtered selection the index is built from,
    // otherwise a change in another workspace (or in this vault's older logs)
    // could fail to invalidate the cache.
    const logs = vaultSessionLogs(config.sessionsRoot, vaultRoot, MAX_LOG_FILES);
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
  auditReportFor(vaultRoot, enabled = this.#config.auditEnabled, autoArchive = this.#config.autoArchive) {
    const config = this.#config;
    if (!enabled) return undefined;
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
      report = buildAuditReport(vaultRoot, { ...this.#helpers, maintainHookStats: config.auditMaintainHookStats, autoArchive });
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

  async sectionForAgent(agent) {
    const config = this.#config;
    try {
      const sessionCwd = agent?.session?.header?.cwd ?? agent?.session?.cwd;
      const vaultRoot = this.#helpers.resolveWorkspaceRoot
        ? this.#helpers.resolveWorkspaceRoot(config.vaultRoot, process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT, sessionCwd)
        : "";
      if (vaultRoot === "") {
        return "## 长期记忆（math-memory 未配置）\n\n" +
          "当前会话没有可用的 vault 工作目录；设置 DSH_WORKSPACE_ROOT（或 DSH_OBSIDIAN_VAULT）或在 preset 配置 vaultRoot。";
      }
      // Per-workspace standalone settings (.deepseek/config.md) override the
      // preset config, so each vault/folder can carry its own switches.
      const ws = parseMemoryConfig(memoryConfigText(vaultRoot)) ?? {};
      if (ws.enabled === false) {
        return "## 长期记忆（本工作区已停用）\n\n" +
          "当前工作区的 .deepseek/config.md 里 enabled: false；如需开启，把该项改为 true（或删除该文件）。";
      }
      // Wire the per-workspace sessionCapture toggle into the capture trigger
      // (config.md override, preset default as fallback). This is what makes
      // the Obsidian/panel「自动保存对话」开关 actually gate runSessionCapture.
      this.#sessionCaptureOverride = ws.sessionCapture ?? config.sessionCapture;
      const currentSessionId = agent?.session?.id;
      const dialogueIndex = (ws.dialogueIndex ?? config.dialogueIndexEnabled) ? this.getDialogueIndex(vaultRoot) : { sources: [], entries: [] };
      const auditReport = this.auditReportFor(vaultRoot, ws.audit ?? config.auditEnabled, ws.autoArchive ?? config.autoArchive);
      const query = latestUserText(agent);
      const memoText = memoDigest(vaultRoot, MAX_INBOX_CHARS, query, this.#helpers, ws.reminders ?? config.remindersEnabled);
      return buildMemorySection({ ...config, vaultRoot }, currentSessionId, dialogueIndex, auditReport, memoText);
    } catch (error) {
      return `## 长期记忆（math-memory 暂不可用）\n\n${String(error)}`;
    }
  }
}

// ── Cordis plugin entry ─────────────────────────────────────────────────────

export async function apply(ctx, config) {
  // Import the sibling first so the audit pass can reuse its hook parser and
  // tokenizer (memory v2). The note tools are applied on the same context.
  const notes = await import("./note-tools.mjs");
  if (config?.enabled === false) {
    // Master switch: memory system fully off (no injection / audit / dialogue
    // index). Files and caches are preserved. Note tools still apply below.
    await notes.apply(ctx, config?.notes ?? {});
    return;
  }
  const engine = new MemoryEngine(config ?? {}, {
    parseHookFrontmatter: notes.parseHookFrontmatter,
    tokenize: notes.tokenize,
    weightedOverlap: notes.weightedOverlap,
    computeDocFreq: notes.computeDocFreq,
    bm25Score: notes.bm25Score,
    computeCorpusStats: notes.computeCorpusStats,
    resolveWorkspaceRoot: notes.resolveWorkspaceRoot
  });
  ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    const assembled = await next();
    if (context?.agent === undefined) return assembled;
    const text = await engine.sectionForAgent(context.agent);
    // Dialogue capture (obelisk-comparison.md §5): fire-and-forget, throttled,
    // marker-idempotent. Runs off the assemble path so it never blocks the
    // prompt; the per-session lastSeq marker keeps it a cheap no-op most times.
    setTimeout(() => engine.captureNow(), 0);
    if (text === "") return assembled;
    return {
      ...assembled,
      sections: [...assembled.sections, { name: "dsh-math:memory", text }]
    };
  });

  // Startup sweep: persist any sessions left over from the previous process
  // (the assemble trigger only fires once a session actually starts).
  setTimeout(() => engine.captureNow(), 0);

  // Apply the dedicated note tools (note_search / note_create / note_links /
  // note_recall) on the same context — reuse the module imported above.
  // This file is always refreshed on upgrade, so existing installations pick
  // the tools up even though agent.cordis.yml preserves user edits. The
  // sibling module resolves `defineTool` through the harness loader, so it
  // works from any $DSH_HOME location.
  await notes.apply(ctx, config?.notes ?? {});
}
