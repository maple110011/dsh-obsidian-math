/**
 * obsidian-memory — cross-session memory injection for the `obsidian` dsh
 * agent preset.
 *
 * What it does, on every system-prompt assembly for this agent:
 *   1. Reads the vault's durable memory files (`.deepseek/memory/*` and a
 *      one-line digest of `.deepseek/inbox/*`). These are maintained BY THE
 *      MODEL through the ordinary file tools, per the vault's AGENTS.md.
 *   2. Distills a small dialogue index from this machine's past dsh session
 *      logs (session.jsonl.zstd files under `$DSH_HOME/sessions/`) — recent user
 *      questions plus short assistant conclusions — so a brand-new session
 *      no longer starts from zero.
 *   3. Appends one bounded "obsidian:memory" section to the assembled system
 *      prompt.
 *
 * It never calls the model and never mutates any user note. The only file it
 * writes is its own cache at `<vault>/.deepseek/cache/dialogue-index.json`.
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
export const inject = ["systemPrompt"];

const ZSTD_MAGIC = 4247762216; // little-endian 28 B5 2F FD
const MEMORY_DIR = ".deepseek";
const CACHE_DIR = join(MEMORY_DIR, "cache");
const CACHE_FILE = join(CACHE_DIR, "dialogue-index.json");
const LOG_SUFFIX = ".jsonl.zstd";
const MAX_LOG_FILES = 20;
// Layered injection budget (arXiv:2606.24775): the prompt carries navigation
// layers only; raw evidence lives on disk and is reached via grep/read.
const MAX_PROFILE_CHARS = 4000;
const MAX_TOPIC_INDEX_CHARS = 4000;
const MAX_RECORD_INDEX_CHARS = 2000;
const MAX_TEMPLATE_INDEX_CHARS = 1500;
const MAX_EPISODE_INDEX_CHARS = 2500;
const MAX_INBOX_CHARS = 2200;
const MAX_DIALOGUE_PAIRS = 6;
const MAX_DIALOGUE_CHARS = 3000;
const DEFAULT_MAX_HISTORY_ENTRIES = 40;
const DEFAULT_MAX_HISTORY_CHARS = 6000;

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
export function buildDialogueIndex(sessionsRoot, maxEntries, maxChars, maxFiles = MAX_LOG_FILES) {
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
      sources.push({ path: log.path, mtimeMs: log.mtimeMs, size: log.size });
      sessions.push(entry);
    }
  }

  // Turn each real user message into a Q/A pair: the question plus the first
  // assistant text that followed it in the same session. Newest pairs first.
  const threads = [];
  for (const session of sessions) {
    const messages = [...session.messages].sort((a, b) => a.time - b.time);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== "user") continue;
      const answer = messages.slice(index + 1).find((candidate) => candidate.role === "assistant");
      threads.push({
        sessionId: session.id,
        title: session.title,
        cwd: session.cwd,
        time: message.time,
        user: message,
        assistant: answer
      });
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
 * top stale candidates (inbox >= 7 days, polishing >= 3 days, and not yet
 * reminded today) for the agent's proactive review prompts.
 */
export function memoDigest(root, maxChars) {
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
  for (const file of files) {
    let meta;
    try {
      meta = parseMemoFrontmatter(readFileSync(join(memoDir, file), "utf8"));
    } catch {
      continue;
    }
    const slug = file.replace(/\.md$/, "");
    const status = MEMO_STATES.has(meta.status) ? meta.status : "inbox";
    const updated = meta.updated ?? "";
    const days = daysSinceLocal(updated);
    const item = {
      slug,
      title: meta.title || slug,
      topic: meta.topic || "未归类",
      updated,
      days,
      stale: days !== null && days >= (status === "polishing" ? MEMO_STALE_POLISHING_DAYS : MEMO_STALE_INBOX_DAYS),
      alreadyReminded: meta.last_reminded === today
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
    .filter((memo) => memo.stale && !memo.alreadyReminded)
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
    .slice(0, 3);
  if (candidates.length > 0) {
    lines.push("- 🔔 提醒候选（久未更新）");
    for (const memo of candidates) {
      lines.push(`  - [[${memo.slug}|${memo.title}]]：${memo.days} 天未更新，可在相关讨论时建议打磨`);
    }
  }

  return clip(lines.join("\n"), maxChars);
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
export function buildMemorySection({ vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs }, currentSessionId, dialogueIndex) {
  const profile = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "profile.md"), MAX_PROFILE_CHARS);
  const topics = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "topics", "index.md"), MAX_TOPIC_INDEX_CHARS);
  const records = recordIndexDigest(vaultRoot, MAX_RECORD_INDEX_CHARS);
  const templates = templateIndexDigest(vaultRoot, MAX_TEMPLATE_INDEX_CHARS);
  const episodes = episodeIndexDigest(vaultRoot, MAX_EPISODE_INDEX_CHARS);
  const memos = memoDigest(vaultRoot, MAX_INBOX_CHARS);

  const lines = [
    "## 分层长期记忆（由 obsidian-memory 自动注入；导航层在此，证据层在磁盘）",
    "",
    "记忆按 arXiv:2606.24775 与 arXiv:2607.05794 的原则组织为五层：profile=语义层，topics=导航层，" +
    "records=类型化原子记录层，episodes=原始证据层，inbox=想法层。以下内容用于“知道去哪找”，不要当作完整证据。" +
    "回答细节问题时必须按路由规则读文件：",
    "- 精确事实 / 用户原话 / 日期数字 → 先 grep `.deepseek/memory/episodes/` 再读命中文件；",
    "- 类型化原子事实（fact/event/instruction/preference）→ 先看 `.deepseek/memory/records/index.md`，再 grep/读具体记录，记录里的 source 可回原始证据；",
    "- 主题来龙去脉 → 先读 `.deepseek/memory/topics/index.md` 定位，再读 `topics/<slug>.md` 或相关笔记；",
    "- “当前最新状态” → 比较 frontmatter `updated` 或最新 episode 时间戳；",
    "- 检索不到就明说没有，不要编造。"
  ];

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
  if (!isAbsolute(sessionsRoot)) throw new TypeError("obsidian-memory: sessionsRoot must be an absolute path");
  return { vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs };
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

function readCachedIndex(cachePath) {
  try {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (Array.isArray(cached?.entries) && Array.isArray(cached?.sources)) return cached;
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
  #cachedIndex;
  #fingerprint = "";
  #builtAt = 0;

  constructor(config) {
    this.#config = normalizeConfig(config);
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
      MAX_LOG_FILES
    );
    this.#cachedIndex = index;
    this.#fingerprint = current;
    this.#builtAt = Date.now();
    writeCachedIndex(this.cachePathFor(vaultRoot), index);
    return index;
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
      return buildMemorySection({ ...config, vaultRoot }, currentSessionId, dialogueIndex);
    } catch (error) {
      return `## 长期记忆（obsidian-memory 暂不可用）\n\n${String(error)}`;
    }
  }
}

// ── Cordis plugin entry ─────────────────────────────────────────────────────

export function apply(ctx, config) {
  const engine = new MemoryEngine(config);
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
}
