/**
 * math-memory — cross-session memory injection for the `obsidian` dsh
 * agent preset. It also applies the sibling note-tools.mjs plugin on the
 * same context, which registers note_recall / note_strategy / note_create / note_links.
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
// Helpers both copies of this engine use. The canonical file is staged flat beside
// this one for the offline channel and re-exported by `dsh/host/engine-shared.mjs`
// inside the package — see that file's header, and scripts/check-engine-sync.mjs for
// what may and may not move here.
import { contentText, setTopField } from "./engine-shared.mjs";

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
// layers only; raw evidence lives on disk and is reached through note_recall
// (discovery) plus read/grep (precision, see the routing lines below).
// Slimmed static budgets (retrieval v3 S5): the injected layers are navigation
// only — a topic/records/templates/episodes map that tells the agent what
// exists. Relevant CONTENT is pulled on demand through note_recall instead of
// being pushed into every prompt.
const MAX_PROFILE_CHARS = 4000;
const MAX_NOTATION_CHARS = 800;
const MAX_TOPIC_INDEX_CHARS = 1800;
const MAX_RECORD_INDEX_CHARS = 800;
const MAX_TEMPLATE_INDEX_CHARS = 600;
const MAX_EPISODE_INDEX_CHARS = 1200;
const MAX_INBOX_CHARS = 1200;
const MAX_DIALOGUE_PAIRS = 6;
const MAX_DIALOGUE_CHARS = 3000;
const DEFAULT_MAX_HISTORY_ENTRIES = 40;
const DEFAULT_MAX_HISTORY_CHARS = 6000;

/**
 * Injection budgets by tier, so the size of the memory section is a knob instead of a
 * set of constants buried in the code (MemForest, arXiv:2609.08273: its compression
 * ratio is an explicit dial — 30/50/70% — and its accuracy/cost curve is read off that
 * dial, rather than being an undocumented side effect of the implementation).
 *
 * `standard` is BYTE-FOR-BYTE the previous values: choosing a tier must never change
 * behaviour for anyone who does not choose one. `compact` suits a small context window
 * or a slow sidebar; `rich` suits a large window where more navigation is affordable.
 * These are navigation-layer budgets only — evidence still lives on disk and is pulled
 * with note_recall, so raising them costs prompt space, never accuracy of the store.
 *
 * `notation` was the one layer missing from this table (it was a hard-coded 800 at its
 * read site), so the dial silently did not cover it — a tier that claims to size "the
 * memory section" while one section ignores it is the kind of half-true knob this table
 * exists to prevent. It joins here with `standard: 800`, which is exactly the value it
 * had, so nothing changes for anyone who does not pick a tier.
 */
const BUDGET_TIERS = {
  compact: { profile: 2500, notation: 500, topics: 1200, records: 500, templates: 400, episodes: 800, inbox: 800, dialogue: 2000 },
  standard: { profile: MAX_PROFILE_CHARS, notation: MAX_NOTATION_CHARS, topics: MAX_TOPIC_INDEX_CHARS, records: MAX_RECORD_INDEX_CHARS, templates: MAX_TEMPLATE_INDEX_CHARS, episodes: MAX_EPISODE_INDEX_CHARS, inbox: MAX_INBOX_CHARS, dialogue: MAX_DIALOGUE_CHARS },
  rich: { profile: 6000, notation: 1200, topics: 2600, records: 1200, templates: 900, episodes: 1800, inbox: 1800, dialogue: 4000 }
};

/**
 * Resolve a configured tier name, defaulting to `standard`.
 *
 * An unrecognised value falls back rather than throwing: a typo in a config file must
 * not take the whole preset down, and the safe direction is "the behaviour that existed
 * before tiers did". Exported so the regression suite can assert that fallback — it is
 * the property most likely to rot into a crash.
 */
export function resolveBudgetTier(raw) {
  return Object.prototype.hasOwnProperty.call(BUDGET_TIERS, String(raw)) ? String(raw) : "standard";
}

/**
 * The budget set that actually applies for one vault, honouring precedence:
 * explicit preset config > vault `config.md` > `standard`.
 *
 * Exported so the regression suite can assert the precedence directly — it is the one
 * property here that is invisible at a glance and easy to break by "simplifying".
 */
export function budgetsFor(config = {}, ws = null) {
  // Precedence: an EXPLICIT preset setting wins, else the vault's own choice (written
  // by the settings page into .deepseek/config.md), else standard.
  if (config.budgetExplicit === true) return BUDGET_TIERS[config.budgetTier] ?? BUDGET_TIERS.standard;
  const fromVault = ws?.budget;
  return BUDGET_TIERS[Object.prototype.hasOwnProperty.call(BUDGET_TIERS, String(fromVault)) ? String(fromVault) : "standard"];
}
export { BUDGET_TIERS };
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
// Cross-occasion support (MSCE `n_min`, arXiv:2607.16621 §4.2): how many DISTINCT
// episodes must show the same technique before it counts as a method rather than an
// anecdote, and how close two episodes may be and still count as ONE occasion
// (MemForest §3.2 treats semantic similarity plus temporal contiguity as one event).
const OCCASION_MIN = 2;
const OCCASION_WINDOW_DAYS = 3;
// Audit ledger (WikiSkill, arXiv:2608.27454 §3.2.4; spec: docs/memory/design.md
// §8.1). The audit re-derives the same recommendations from the same files every
// day; without a cross-run record, "this card has been flagged for eleven days"
// is indistinguishable from "this is new today". The ledger is APPEND-ONLY, written
// only by the audit, and stores one line per (object, action, criterion) — NOT the
// evidence numbers, so a changing `uses` count does not manufacture fake new items.
const AUDIT_LEDGER_FILE = join(CACHE_DIR, "audit-ledger.jsonl");
const AUDIT_LEDGER_SCHEMA_VERSION = 1;
const AUDIT_LEDGER_MAX_WRITES = 200; // per audit run
const AUDIT_LEDGER_MAX_LINES = 2000; // whole file; oldest lines are dropped first
// ── card ORIGIN (C7/N1, 2026-10-01; docs/pending-decisions-2026-09-26.md §3.1) ──
// WHO wrote this card, as opposed to HOW WELL verified it is (`hook.verified`). The
// literature this comes from (Louck, arXiv:2606.34591, machine-checked T1/T3) shows that
// a trust signal derived from CONTENT or from content-derivable lineage can be
// whitewashed; what it requires instead is that the source is bound at WRITE time by a
// party the content cannot impersonate. `hook.verified` is a label anyone can type, so
// it was never that party. This ledger is: it is written only by the audit, records what
// the HOST itself could see (`firstSeen`, and the card's `updated` at that moment), and
// is never re-derived from the card's prose.
//
// The field itself lives in the card frontmatter (`origin`), because a user asked for it
// there and because a card must carry its own provenance when it is copied out of the
// vault — but the frontmatter is the MIRROR, not the authority. `origin` is deliberately
// NOT part of `hook` (it describes the FILE, not the technique) and is deliberately NOT
// in the vocabulary {user, agent, imported} for the audit's own writes: every card this
// audit can see lives under `.deepseek/memory/**`, i.e. a layer the protocol reserves for
// the agent, so `cardOriginFromPath` can only ever conclude `agent`. That is the point —
// the audit never ACCUSES the user of writing its own cards, and it never certifies
// "the user said this" either (`user` would be a claim no channel in this vault can
// authenticate; see the `unauthorizedOrigin` check).
const CARD_ORIGIN_FILE = join(CACHE_DIR, "card-origin.jsonl");
const CARD_ORIGIN_SCHEMA_VERSION = 1;
const CARD_ORIGIN_VALUES = new Set(["user", "agent", "imported"]);
const CARD_ORIGIN_MAX_LINES = 5000; // whole file; oldest lines are dropped first
// Minimum characters in an index line's one-sentence summary. Deliberately a FLOOR,
// not a style rule: see `indexDescriptionIssue` (WikiSkill Appendix E.2).
const AUDIT_INDEX_DESC_MIN = 8;
// Card-body and move-count ceilings. "原子化、不要整段对话总结" was unenforceable advice
// until it had a number; these are the numbers, and they are deliberately GENEROUS
// against the measured corpus (records bodies ran 7–8 non-empty lines, strategy cards
// 2–6, at most 3 moves) so the check flags hoarding rather than normal writing.
// Rationale from WikiSkill (arXiv:2608.27454 Appendix E.2): pattern pages are capped
// at 10–30 lines because a knowledge page that grows into an essay stops being usable.
const AUDIT_BODY_MAX_LINES = 20;
const AUDIT_MAX_MOVES = 5;
// ── note-scope audit (2026-09-18) ────────────────────────────────────────────
// The card audit above covers records/templates/strategy — the layers the AGENT
// writes. The user's own notes and `theorems/index.md` were covered by NOTHING,
// which is backwards: they are the only writers with no verifier at all. The scan
// below is READ-ONLY and reports one thing above all: an index line that claims a
// theorem is proved while its carrier note says otherwise. The real instance that
// motivated it: `theorems/index.md` labelled Cramér–Rao 已证 while the carrier note
// said "written by AI from a dictated outline, not my draft" and carried an explicit
// "do not treat as proved" marker inside the body. In-note honesty did not stop the
// index from being used downstream.
//
// Deliberately no score and no threshold on "carrier looks like a stub" beyond a
// length floor: the taxonomy study measured that a 2,059-char note with a full proof
// was misjudged as a stub by a length filter, so the length floor is only ever used
// to name a SUSPICION ("疑似存根"), never as a claim of fact.
const AUDIT_NOTE_STUB_CHARS = 120;
const AUDIT_NOTE_MAX_ITEMS = 12;
const AUDIT_THEOREM_INDEX = join(MEMORY_DIR, "memory", "theorems", "index.md");
// Index statuses that assert the content is settled. `引用` is deliberately absent:
// "cited from elsewhere" makes no claim about the vault's own proof, so it is not a
// contradiction to find a 待核对 marker there.
const AUDIT_PROVED_TOKENS = ["已证"];
// Markers meaning the carrier itself declines to vouch for the content. Matched in
// the note body, not in the index line.
const AUDIT_OPEN_MARKERS = ["待核对", "待补", "AI 补全", "待证明", "存疑"];
// Directories a note scan must skip. `.deepseek` holds the memory tree (audited
// separately) and `deploy-backup-…` is a COPY of it: resolving wikilinks by basename
// against a backup manufactures phantom duplicate targets, which is how a real vault
// pollutes this check.
const NOTE_SCAN_SKIP_DIRS = new Set([".obsidian", ".git", ".trash", "node_modules", ".deepseek"]);
const NOTE_SCAN_SKIP_PREFIXES = ["deploy-backup-"];


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

/**
 * Truncate to a budget — and SAY SO.
 *
 * The trailing `…` this function used to add is not a signal a reader can rely on:
 * prose legitimately ends with an ellipsis (the audit's own human lines do, e.g.
 * `names}${count > 3 ? " …" : ""}`), so "ends with …" cannot distinguish "budget cut
 * this" from "the text is like that". A fragment mistaken for complete evidence is
 * worse than no evidence, which is why WikiSkill writes an explicit
 * `[TRUNCATED: …]` marker instead of relying on an ellipsis.
 *
 * The marker states the ORIGINAL length, so the reader knows how much is missing
 * rather than just that something is.
 */
/**
 * Truncate to a budget by keeping BOTH ENDS — and say exactly what was dropped.
 *
 * Why both ends (2026-09-21). This used to keep only the head. That is wrong for
 * every file this section injects, and wrong in a way no existing test could see:
 * the fixture vaults are all far below every budget, so `clip` never fired
 * (measured on `scripts/qa/benchmark-vault`: the whole section is 4088 chars and
 * nothing is truncated). Reconstructed with a growth-shaped fixture, the head-only
 * rule dropped the NEWEST entries first — `records/index.md` kept `rec-1` and lost
 * `rec-40`; a 5033-char `topics/index.md` kept `alpha` at the top and lost `omega`
 * at the bottom.
 *
 * Both directions matter and neither dominates:
 *   · head — profile/notation open with the definitions (identity, symbols) that
 *     everything after them depends on;
 *   · tail — these files are append-only with the newest material at the bottom
 *     (see the notebook write protocol in `vault-AGENTS.md`), so the tail is the
 *     part that changed since the last read.
 * Keeping one end is therefore always a silent loss of the other. The marker names
 * the elided count as well, because "全文 N 字符" alone still left the reader unable
 * to tell how much was missing.
 */
/**
 * Exported so the truncation contract can be asserted directly: the property at
 * stake ("a cut is always announced") is invisible in the assembled prompt when it
 * is broken, because a silently truncated section still looks like a section.
 */
export function clip(text, maxChars) {
  if (text.length <= maxChars) return text;
  // Split the budget evenly so neither end starves; `Math.max(0, …)` keeps a
  // nonsensical (negative) budget from slicing backwards.
  const forContent = Math.max(0, maxChars);
  const headChars = Math.ceil(forContent / 2);
  const tailChars = Math.floor(forContent / 2);
  // Trim to a word boundary, but ONLY when the boundary is ASCII. A math vault's
  // text is overwhelmingly CJK, which has no word boundaries — trimming there
  // would silently eat characters out of the middle of a token, i.e. exactly the
  // "fragment that reads as intact evidence" this marker exists to prevent.
  const trimHead = (s) => (s === "" || s.charCodeAt(s.length - 1) > 127 ? s : s.replace(/\s+\S*$/, ""));
  const trimTail = (s) => (s === "" || s.charCodeAt(0) > 127 ? s : s.replace(/^\S*\s+/, ""));
  const head = trimHead(text.slice(0, headChars));
  const tail = tailChars === 0 ? "" : trimTail(text.slice(text.length - tailChars));
  return `${head} … ……［截断：省略 ${text.length - head.length - tail.length} 字符，全文 ${text.length} 字符，此处非全文，用 read/grep 取原文件］${tail}`;
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

/**
 * Generation number of a session artifact's filename: `session.jsonl.zstd` = 0,
 * `session.v3.jsonl.zstd` = 3, `session.v4.jsonl.zstd` = 4. The untagged V2
 * name is generation 0, which is also the convention the old `.v3.`-only rule
 * silently implemented.
 */
function artifactGeneration(path) {
  const match = /\.v(\d+)\./.exec(path);
  return match === null ? 0 : Number(match[1]);
}

/**
 * True when `candidate` should replace `incumbent` as the authoritative artifact.
 *
 * The generation NUMBER decides first: each migration preserves the older
 * generation beside its successor, so the successor is authoritative even when
 * its mtime is older (measured: two session directories on this machine carry
 * v3+v4 with V4 newer). mtime is only the tie-break, for the case where one
 * directory somehow holds two artifacts of the same generation.
 */
function isNewerArtifact(candidate, incumbent) {
  const candidateGeneration = artifactGeneration(candidate.path);
  const incumbentGeneration = artifactGeneration(incumbent.path);
  if (candidateGeneration !== incumbentGeneration) return candidateGeneration > incumbentGeneration;
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
 * frontmatter): enabled / dialogueIndex / reminders / audit / budget. Host-agnostic
 * settings surface — editable without Obsidian or dsh web, and each
 * workspace (vault/folder) can carry its own overrides. A missing file/field
 * returns null so the preset config (agent.cordis.yml) applies.
 *
 * `budget` is the injection-budget tier and is the one field the Obsidian settings page
 * writes (changelog 2026-09-17, "注入预算档位"): preset config is a bootstrap-time build
 * artifact with no channel from the plugin, so the vault file is the channel — and this
 * file already establishes the "vault overrides preset, field by field" convention.
 */
export function parseMemoryConfig(text) {
  if (typeof text !== "string" || text === "") return null;
  const inner = readFrontmatter(text);
  if (inner === "") return null;
  const config = {};
  for (const line of inner.split(/\r?\n/)) {
    const pair = /^(enabled|dialogueIndex|reminders|audit|autoArchive|sessionCapture|captureSubagents):\s*(true|false)\s*$/i.exec(line.trim());
    if (pair !== null) config[pair[1]] = pair[2].toLowerCase() === "true";
    const budget = /^budget:\s*["']?([A-Za-z-]+)["']?\s*$/i.exec(line.trim());
    // Only a KNOWN tier is recorded; an unrecognised value leaves the field absent so
    // the preset config still applies rather than silently pinning `standard`.
    if (budget !== null && Object.prototype.hasOwnProperty.call(BUDGET_TIERS, budget[1])) config.budget = budget[1];
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

// ── card origin ledger (C7/N1) ──────────────────────────────────────────────

/**
 * What the host can SEE about who wrote a card, from the card's path alone.
 *
 * Every directory `buildAuditReport` scans is a layer the write protocol reserves for
 * the agent (the user's own notes are deliberately NOT audited here — see the note-scope
 * audit), so the observation is "the model wrote this".
 *
 * @returns `{ origin, evidence }`; `origin === null` means "the host has no observation",
 *   which is reported as 来源未知 and never guessed at. Deliberately no `imported`
 *   branch: nothing in this vault distinguishes a clipped article from the user's own
 *   prose, and inventing that distinction would be exactly the "trust derived from
 *   content" move this field exists to avoid.
 */
function cardOriginFromPath(rel) {
  const normalized = String(rel ?? "").replace(/\\/g, "/");
  if (AUDIT_CARD_DIRS.some((dir) => normalized.startsWith(dir.replace(/\\/g, "/") + "/"))) {
    return { origin: "agent", evidence: "memory-layer-path" };
  }
  return { origin: null, evidence: "" };
}

/**
 * Read the origin ledger: path -> `{ firstSeen, origin, evidence, updated }`.
 *
 * The ledger is a cache of host OBSERVATIONS, not user data, so it lives under `cache/`
 * like the audit ledger and the retrieval stats. One record per path (a card that moves
 * gets a new record; the old one is simply never matched again). Malformed lines are
 * skipped rather than failing the pass — a corrupt cache must not block the audit.
 */
function readOriginLedger(root) {
  const known = new Map();
  try {
    const raw = readFileSync(join(root, CARD_ORIGIN_FILE), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry === null || typeof entry !== "object" || typeof entry.rel !== "string" || entry.rel === "") continue;
      known.set(entry.rel, {
        firstSeen: typeof entry.firstSeen === "string" ? entry.firstSeen : "",
        origin: typeof entry.origin === "string" ? entry.origin : "",
        evidence: typeof entry.evidence === "string" ? entry.evidence : "",
        updated: typeof entry.updated === "string" ? entry.updated : ""
      });
    }
  } catch {
    // missing/corrupt ledger: the pass starts from "the host has seen nothing", which is
    // the fail-closed direction (every declaration then reports as unsupported).
  }
  return known;
}

/**
 * Merge host observations into the ledger. Returns the number of records written, or
 * `null` when the write could not be confirmed by reading the file back — the audit
 * reports the latter as `degraded` instead of assuming success.
 *
 * `known` preserves the file's existing order (oldest first), so the bounded growth
 * drops the OLDEST observations first.
 */
function writeOriginLedger(root, known, records, maxLines = CARD_ORIGIN_MAX_LINES) {
  if (records.length === 0) return 0;
  const merged = new Map(known);
  for (const record of records) {
    const previous = merged.get(record.rel);
    merged.set(record.rel, {
      firstSeen: previous?.firstSeen !== undefined && previous.firstSeen !== "" ? previous.firstSeen : record.firstSeen,
      origin: record.origin,
      evidence: record.evidence,
      updated: record.updated
    });
  }
  const entries = [...merged.entries()];
  if (entries.length > maxLines) {
    // Drop the oldest by firstSeen (then by path, so the truncation is deterministic).
    entries.sort((a, b) => (a[1].firstSeen === b[1].firstSeen
      ? a[0].localeCompare(b[0])
      : a[1].firstSeen.localeCompare(b[1].firstSeen)));
    entries.splice(0, entries.length - maxLines);
  }
  try {
    const path = join(root, CARD_ORIGIN_FILE);
    mkdirSync(dirname(path), { recursive: true });
    const text = entries
      .map(([rel, entry]) => JSON.stringify({ v: CARD_ORIGIN_SCHEMA_VERSION, rel, firstSeen: entry.firstSeen, origin: entry.origin, evidence: entry.evidence, updated: entry.updated }))
      .join("\n");
    writeFileSync(path, text === "" ? "" : text + "\n", "utf8");
    // Post-condition (not an assumption): read back every record we claim to have written.
    const reread = readOriginLedger(root);
    return records.every((record) => reread.get(record.rel)?.origin === record.origin) ? records.length : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite a card's top-level `origin` line (create the line when absent).
 *
 * Only the one line is touched, and the splice goes through the shared frontmatter
 * primitives (`frontmatterSpan` / `replaceFrontmatterBlock`), so a card the user edited
 * elsewhere keeps every other byte. Returns the new file text, or null when there is no
 * frontmatter to write into. Deliberately NOT `raw.replace(old, new)`: the replacement
 * STRING would expand `$$`/`$&` inside agent-authored frontmatter and a math vault is
 * exactly where `$$` appears (trap 65's family).
 */
function setCardOrigin(text, origin) {
  const span = frontmatterSpan(text);
  if (span === null) return null;
  const body = span.text;
  const pattern = /^[ \t]*origin:[ \t]*(.*)$/m;
  const match = pattern.exec(body);
  const withLine = match === null
    ? `${body}${body === "" || body.endsWith("\n") ? "" : "\n"}origin: ${origin}\n`
    : body.replace(pattern, `origin: ${origin}`);
  return `${text.slice(0, span.start)}${withLine}${text.slice(span.end)}`;
}

/**
 * Rewrite a block-style hook's uses/last_used lines inside the frontmatter
 * text; returns the new frontmatter or null when there is no block-style hook
 * (flow-style `hook: { ... }` is deliberately left untouched).
 */
function rewriteHookStats(frontmatterText, uses, lastUsed, gain = 0, verification = null) {
  const lines = frontmatterText.split(/\r?\n/);
  const hookIdx = lines.findIndex((line) => /^hook:\s*$/.test(line));
  if (hookIdx === -1) return null;
  let endIdx = hookIdx + 1;
  while (endIdx < lines.length && (lines[endIdx].trim() === "" || /^\s/.test(lines[endIdx]))) endIdx += 1;
  const block = lines.slice(hookIdx + 1, endIdx);
  let usesSeen = false;
  let lastUsedSeen = false;
  let gainSeen = false;
  let verifiedSeen = false;
  let witnessSeen = false;
  // `null` means "leave that line exactly as it is" — used when only the gain
  // verdict is being persisted and usage statistics are not being maintained.
  const touchUses = uses !== null && uses !== undefined;
  const touchLastUsed = lastUsed !== null && lastUsed !== undefined;
  const touchVerified = verification !== null && verification !== undefined;
  const updated = [];
  for (const line of block) {
    // The verification pair is rewritten in the SAME pass as the statistics so the
    // card is never left half-updated, and so a corroboration upgrade produces a
    // one-line diff (verified + its witness) rather than a restructured block.
    const verifyMatch = /^(\s*)(verified|verified_by):\s*(.*)$/.exec(line);
    if (verifyMatch !== null && touchVerified) {
      if (verifyMatch[2] === "verified") { verifiedSeen = true; updated.push(`${verifyMatch[1]}verified: ${verification.verified}`); continue; }
      witnessSeen = true; updated.push(`${verifyMatch[1]}verified_by: ${verification.verifiedBy}`); continue;
    }
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
  if (touchVerified) {
    if (!verifiedSeen) updated.push(`  verified: ${verification.verified}`);
    if (!witnessSeen) updated.push(`  verified_by: ${verification.verifiedBy}`);
  }
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
function syncHookStatsToCard(filePath, effectiveUses, lastUsed, gain = 0, verification = null) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  const block = frontmatterBlock(text);
  if (block === null) return false;
  const rewritten = rewriteHookStats(block, effectiveUses, lastUsed, gain, verification);
  if (rewritten === null) return false;
  const touchUses = effectiveUses !== null && effectiveUses !== undefined;
  if (rewritten === block) return touchUses ? verifyUsesWritten(text, effectiveUses, true) : true;
  try {
    const next = replaceFrontmatterBlock(text, rewritten);
    writeFileSync(filePath, next, "utf8");
    // Post-condition, not an assumption: read back what we just claimed to write.
    // When a corroboration upgrade rode along, the witness must be on disk too —
    // otherwise the audit would mint exactly the "upgraded without a witness" state
    // its own `unjustifiedUpgrade` check exists to catch.
    if (verification !== null && verification !== undefined) {
      const reread = (() => { try { return readFileSync(filePath, "utf8"); } catch { return ""; } })();
      if (!new RegExp(`^\\s*verified:\\s*${verification.verified}\\s*$`, "m").test(reread)) return false;
      if (!new RegExp(`^\\s*verified_by:\\s*${verification.verifiedBy}\\s*$`, "m").test(reread)) return false;
    }
    // Only assert the `uses` postcondition when this call was asked to touch `uses`.
    // A corroboration-only call passes `null` (leave the line alone), and demanding
    // `uses: null` would fail every time — which it did, so the level landed on disk
    // while the report said nothing had happened (caught by the gate assertions).
    if (!touchUses) return true;
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
  let body = setTopField(span.text, "uses", String(effectiveUses));
  if (lastUsed !== "") body = setTopField(body, "last_used", lastUsed);
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
/**
 * Write a file so that a failure leaves the previous content in place.
 *
 * WHY (WikiSkill, arXiv:2608.27454; its checkpoint/staging design): a destructive
 * update written in place has no way back if the process dies mid-write, and the
 * user's vault IS the only copy. This is the small version of that idea: write a
 * sibling temp file, verify it reads back, keep a `.bak` of the old content, then
 * replace. On any failure the original file is left untouched and the caller is told.
 *
 * `renameSync` gives the atomic swap; `writeFileSync` to `<path>.tmp` means a crash
 * mid-write costs the temp file, never the original.
 */
export function writeFileAtomic(path, content) {
  const temp = `${path}.tmp`;
  const backup = `${path}.bak`;
  try {
    writeFileSync(temp, content, "utf8");
    // Read back before touching the original: a full disk or a read-only mount
    // surfaces here, while the original is still intact.
    if (readFileSync(temp, "utf8") !== content) throw new Error("temp read-back mismatch");
    if (existsSync(path)) writeFileSync(backup, readFileSync(path, "utf8"), "utf8");
    renameSync(temp, path);
    if (readFileSync(path, "utf8") !== content) throw new Error("post-replace read-back mismatch");
    return { ok: true, backup };
  } catch (error) {
    try { if (existsSync(temp)) rmSync(temp, { force: true }); } catch { /* best effort */ }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Move stale cards into `archive/<layer>/` and keep each layer's index in step.
 *
 * Returns `{ moved, failures }`. `failures` is the point: the old version swallowed
 * every error (`catch { /* leave in place *\/ }`), so a rename that failed on a
 * locked file, or an index rewrite that could not land, produced a report that said
 * "archived N cards" while the vault disagreed. Reporting a degraded run is the
 * contract this repo already uses for the stats sync (`postconditions`).
 */
function moveCardsToArchive(root, targets) {
  const moved = [];
  const failures = [];
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
    } catch (error) {
      failures.push(`${rel}（移动失败：${error instanceof Error ? error.message : String(error)}）`);
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
      // Atomic + verified: a half-written index is a dangling-link generator, and the
      // card has already moved by now, so the message matters as much as the rollback.
      const result = writeFileAtomic(indexPath, indexText);
      if (!result.ok) failures.push(`${indexPath}（索引改写失败：${result.reason}；卡片已移动，可据 .bak 修复）`);
    } catch (error) {
      failures.push(`${indexPath}（索引改写失败：${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  return { moved, failures };
}

// ── audit ledger: the cross-run record of what was recommended, and when ────

const LEDGER_FIELDS = ["object", "action", "criterion", "firstSeen", "count"];

/**
 * Structural validation for one ledger line. Returns null instead of throwing:
 * the ledger is a user-editable text file, so a hand-broken line must degrade to
 * "ignore it", never crash the audit (a crashed audit is worse than no ledger).
 */
function ledgerEntryOf(raw) {
  if (raw === null || typeof raw !== "object") return null;
  for (const field of LEDGER_FIELDS) {
    const value = raw[field];
    const ok = field === "count" ? Number.isFinite(value) && value >= 1 : typeof value === "string" && value !== "";
    if (!ok) return null;
  }
  return {
    at: typeof raw.at === "string" ? raw.at : "",
    today: typeof raw.today === "string" ? raw.today : "",
    object: raw.object,
    action: raw.action,
    criterion: raw.criterion,
    evidence: typeof raw.evidence === "string" ? raw.evidence : "",
    firstSeen: raw.firstSeen,
    count: Math.trunc(raw.count)
  };
}

/**
 * Identity of a ledger event: which object, which action, which criterion.
 *
 * `evidence` is deliberately EXCLUDED. Including it would make every change in a
 * number (uses, a similarity score, days) look like a brand-new recommendation.
 */
function ledgerSignature(entry) {
  return JSON.stringify([entry.object, entry.action, entry.criterion]);
}

/** Read the whole ledger, newest last. Unreadable/missing file → empty history. */
function readAuditLedger(root) {
  let text;
  try {
    text = readFileSync(join(root, AUDIT_LEDGER_FILE), "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a hand-broken line is skipped, not fatal
    }
    const entry = ledgerEntryOf(parsed);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/**
 * Append this run's recommendations and report what is new versus carried over.
 *
 * Mutates nothing outside the ledger file, and verifies the write by reading the
 * file back (the same "no silent success" contract the rest of the audit uses).
 */
function recordAuditLedger(root, entries, today, { enabled = true } = {}) {
  const history = readAuditLedger(root);
  // Carry-over state is read from `firstSeen`/`count`, NOT from "rows written on an
  // earlier day". Same-day rows must be included: a row that carried over today has
  // `firstSeen` = the day it was first raised and `today` = the day it was rewritten,
  // so excluding same-day rows would make the SECOND run on a day forget the history
  // again (found by the "a disabled run did not consume the history" assertion).
  // `firstSeen` takes the EARLIEST value and `count` the LARGEST, because both a
  // rewritten carry-over row and a fresh row can exist for the same signature.
  const priorBySignature = new Map();
  for (const entry of history) {
    const key = ledgerSignature(entry);
    const prior = priorBySignature.get(key);
    if (prior === undefined) {
      priorBySignature.set(key, { firstSeen: entry.firstSeen, count: entry.count });
      continue;
    }
    if (entry.firstSeen !== "" && (prior.firstSeen === "" || entry.firstSeen < prior.firstSeen)) prior.firstSeen = entry.firstSeen;
    if (entry.count > prior.count) prior.count = entry.count;
  }
  const fresh = [];
  const carried = [];
  const failures = [];
  const dated = entries.map((entry) => {
    const prior = priorBySignature.get(ledgerSignature(entry));
    return {
      ...entry,
      firstSeen: prior === undefined || prior.firstSeen === "" ? today : prior.firstSeen,
      // `prior.count + 1` counts THIS run. Re-running the audit on the same day
      // therefore inflates the counter — acceptable, because the only thing `count`
      // is used for is "is this new today?"; it is never read as a precision number.
      count: (prior?.count ?? 0) + 1
    };
  });
  const unique = [];
  const seenToday = new Set();
  for (const entry of dated) {
    const key = ledgerSignature(entry);
    if (seenToday.has(key)) continue;
    seenToday.add(key);
    unique.push(entry);
  }
  const toWrite = unique.slice(0, AUDIT_LEDGER_MAX_WRITES);
  const truncated = Math.max(0, unique.length - toWrite.length);
  const writtenIds = new Set();
  // Disabled: report the same shape (so callers never branch on undefined) but
  // write nothing. This is the switch that lets a test prove the ledger is what
  // produces the carried-over lines, rather than an always-on side effect.
  if (!enabled) {
    for (const entry of unique) (entry.firstSeen === today ? fresh : carried).push(entry);
    return { path: AUDIT_LEDGER_FILE, todayNew: fresh.length, carried: carried.length, historyTotal: history.length, truncated, written: 0, failures, disabled: true, fresh, carriedEntries: carried };
  }
  if (toWrite.length > 0) {
    try {
      const path = join(root, AUDIT_LEDGER_FILE);
      mkdirSync(join(root, CACHE_DIR), { recursive: true });
      // One row per (object, action, criterion): rewriting the whole file each run
      // collapses the run's own row into the existing one, so a same-day re-run does
      // not append a second copy. Only the newest AUDIT_LEDGER_MAX_LINES rows are
      // kept — the ledger must not grow into a second unbounded knowledge store
      // (WikiSkill's self-reported gap is exactly "no pruning mechanism for the wiki").
      const byRow = new Map();
      for (const entry of history) byRow.set(ledgerSignature(entry), JSON.stringify({ v: AUDIT_LEDGER_SCHEMA_VERSION, ...entry }));
      for (const entry of toWrite) {
        byRow.set(ledgerSignature(entry), JSON.stringify({ v: AUDIT_LEDGER_SCHEMA_VERSION, at: new Date().toISOString(), today, ...entry }));
      }
      const lines = [...byRow.values()];
      writeFileSync(path, lines.slice(Math.max(0, lines.length - AUDIT_LEDGER_MAX_LINES)).join("\n") + "\n", "utf8");
      const back = readAuditLedger(root);
      const written = new Set(back.map((entry) => ledgerSignature(entry)));
      for (const entry of toWrite) {
        const key = ledgerSignature(entry);
        if (written.has(key)) writtenIds.add(key);
        else failures.push(entry.object);
      }
    } catch {
      for (const entry of toWrite) failures.push(entry.object);
    }
  }
  for (const entry of unique) {
    if (entry.firstSeen === today) fresh.push(entry);
    else carried.push(entry);
  }
  return { path: AUDIT_LEDGER_FILE, todayNew: fresh.length, carried: carried.length, historyTotal: history.length, truncated, written: writtenIds.size, failures, disabled: false, fresh, carriedEntries: carried };
}

/**
 * The recommendations the audit wants remembered, in a fixed order.
 *
 * Only sections that carry an ACTION belong here: `strong` / `harmed` /
 * `independentTechniques` describe state, not something to do, and remembering
 * them would drown the ledger in non-events.
 */
function actionableAuditEntries(sections, hintFor) {
  const out = [];
  const push = (object, action, criterion, evidence, hint) => {
    if (hint !== undefined) hintFor.set(`${object}|${action}|${criterion}`, hint);
    out.push({ object, action, criterion, evidence });
  };
  for (const card of sections.weak) push(card.rel, "rewrite-or-archive", "weak-usage", `uses=${card.uses},success_rate=${card.successRate ?? "none"}`, `${card.title}（${card.uses} 次使用、成功率 ${card.successRate ?? "无"}）`);
  for (const card of sections.unused) push(card.rel, "review-or-archive", "unused-days", `days=${card.days ?? "unknown"}`, `${card.title}（${card.days ?? "?"} 天未用）`);
  for (const card of sections.unverified) push(card.rel, "seek-corroboration", "unverified-days", `verified=single-source`, `${card.title}（单一来源）`);
  for (const card of sections.pendingReview) push(card.rel, "re-review", "needs-review", `last_wrong=${card.lastWrong ?? ""}`, `${card.title}（待重审）`);
  for (const card of sections.archiveCandidates) push(card.rel, "archive-proposal", "low-utility", `utility=${card.utility}`, `${card.title}（低效用）`);
  for (const card of sections.antipatterns) push(card.rel, "keep-as-counterexample", "antipattern", `gain=${card.gain ?? 0}`, `${card.title}（反模式）`);
  for (const pair of sections.duplicates) {
    const object = `${pair.a.rel}|${pair.b.rel}`;
    push(object, "merge-or-differentiate", "duplicate-similarity", `jaccard=${pair.jaccard.toFixed(2)}`, `${pair.a.title} ↔ ${pair.b.title}`);
  }
  for (const card of sections.hubs) push(card.rel, "protect-before-edit", "structural-hub", `backlinks=${card.backlinks}`, `${card.title}（${card.backlinks} 处引用）`);
  for (const item of sections.indexWeak) push(item.rel, "improve-index-line", "index-description", `issue=${item.issue}`, `${item.title}（索引行说明过弱）`);
  for (const item of sections.indexNotAnEntry) push(item.rel, "fix-index-line-format", "index-format", `issue=${item.issue}`, `${item.title}（索引行不合契约）`);
  for (const card of sections.tooLong) push(card.rel, "split-card", "over-length", `lines=${card.lines}`, `${card.title}（${card.lines} 行，超过 ${AUDIT_BODY_MAX_LINES} 行）`);
  for (const card of sections.tooManyMoves) push(card.rel, "split-or-prioritize-moves", "too-many-moves", `moves=${card.moves}`, `${card.title}（${card.moves} 个 move，超过 ${AUDIT_MAX_MOVES}）`);
  for (const item of sections.downstreamReview) {
    const object = `${item.rel}|${item.via.rel}`;
    push(object, "re-verify-dependent", "premise-moved", `reason=${item.reason}`, `${item.title} ← ${item.via.title}`);
  }
  // Note scope: a mislabelled theorem in the index is a recommendation like any
  // other, so it enters the ledger too — otherwise "the same wrong 已证 has been
  // reported for eleven days" would be invisible exactly where it matters most.
  for (const item of sections.noteClaims ?? []) {
    push(item.carrier, "relabel-theorem-index", "index-claims-proved", `reason=${item.reason}`, `${item.name}（${item.reason}）`);
  }
  for (const item of sections.noteIndexUnresolved ?? []) {
    push(AUDIT_THEOREM_INDEX, "fix-index-target", "index-target-unresolved", `target=${item.target}`, `${item.name} → [[${item.target}]]`);
  }
  // A failed corroboration write is a recommendation ("this card's level is one grade
  // too low and the write did not land"), not a silent no-op.
  for (const rel of sections.corroborationFailures ?? []) {
    push(rel, "retry-corroboration-write", "corroboration-write-failed", "verified=single-source", rel);
  }
  // Methodology that hardened into the record layer: a recommendation to re-route it
  // (to `inbox/`) or to bind it to the problem it came from.
  for (const item of sections.methodologyInRecords ?? []) {
    push(item.rel, "reroute-to-idea-layer", "methodology-in-records", `reason=${item.reason}`, `${item.title}（${item.reason}）`);
  }
  return out;
}

/**
 * The audit's own two sources of truth for "this card is weak" must agree.
 *
 * `weak` is DEFINED as `successRate <= AUDIT_WEAK_RATE && uses >= AUDIT_WEAK_USES`,
 * so a weak card with `uses === 0` is a contradiction — the shape trap 59
 * ("documents say 232, reality says 0") is made of. Extracted and exported so the
 * self-check has a name and can be exercised with an inconsistent input: left
 * inline, every assertion about it would be vacuous, because the filter that
 * builds the list cannot produce the case the check exists to catch.
 */
export function inconsistentWeakCards(weakCards) {
  return weakCards
    .filter((card) => card.uses < AUDIT_WEAK_USES || (card.successRate ?? 1) > AUDIT_WEAK_RATE)
    .map((card) => card.rel);
}

/**
 * Index-line description floor (WikiSkill, arXiv:2608.27454 Appendix E.2).
 *
 * WikiSkill calls its per-pattern index line "the MOST IMPORTANT part of the wiki"
 * because it is what decides whether a reader opens the full page — and it requires
 * each line to carry PROBLEM + ROOT CAUSE + FIX. Our index lines already embed a
 * one-line summary (`- [[stem|一句话]] · difficulty · updated: …`), but nothing checks
 * that the summary says anything: `- [[x]]` and `- [[x|]]` satisfy the "card is in
 * the index" check while telling a reader nothing.
 *
 * The floor is deliberately about LENGTH, not semantics. A machine cannot judge
 * whether a sentence explains WHY; it can judge that a description is empty or a few
 * characters long, and that is the only claim this lint makes. Judging the wording
 * is the model's job (hence: report, never auto-rewrite).
 */
export function indexDescriptionIssue(line, minChars = 8) {
  const text = String(line ?? "").trim();
  // Blockquotes are README prose by convention (`> 格式：- [[stem|一句话]] · …`),
  // not entries — without this, the README that documents the format would fail it.
  if (text === "" || text.startsWith(">")) return "not-an-entry";
  const link = /\[\[([^\[\]|#]+)(?:[#|][^\]\[]*)?\]\]/.exec(text);
  if (link === null) return "not-an-entry";
  // The description is the link's display text ONLY. Counting what follows the link
  // would let the trailing metadata (`· topic · updated: 2026-01-01`) satisfy the
  // floor, which is exactly how `- [[rec-thin|?]] · 数论 · updated: …` first slipped
  // through. A link with no `|` has no description at all.
  const inner = link[0].replace(/^\[\[|\]\]$/g, "");
  const pipe = inner.indexOf("|");
  const summary = pipe === -1 ? "" : inner.slice(pipe + 1);
  const cleaned = summary
    .replace(/\[\[[^\]\[]*\]\]/g, "") // nested links are not a description
    .replace(/[\]\|]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (cleaned === "") return "empty-description";
  if (cleaned.length < minChars) return "short-description";
  return null;
}

/**
 * Key `object` values are file paths (≤200 chars), so a `|` separator shifts
 * nothing; the plain fallback keeps any exotic key from silently dropping a row.
 */
function ledgerHint(hintFor, object, action, criterion, fallback = "") {
  return hintFor.get(`${object}|${action}|${criterion}`) ?? fallback;
}

/** Strip an Obsidian wikilink target down to a vault-relative candidate path. */
function noteLinkTarget(raw) {
  return String(raw ?? "").trim().replace(/^\.\//, "").replace(/\.md$/i, "");
}

/**
 * Walk the vault's OWN notes (never the memory tree) and return relative paths.
 *
 * Bounded and skip-listed on purpose: this runs once per day on somebody's real
 * vault, so it must not descend into `.git`, `.obsidian`, `node_modules`, the
 * memory tree (audited separately), or a `deploy-backup-…` copy of it.
 */
function listVaultNotes(root, maxFiles = 4000) {
  const out = [];
  // Protocol/scaffold files are not the user's notes: `AGENTS.md` documents the marker
  // vocabulary (it writes 待补 in backticks as an INSTRUCTION), so scanning it produced
  // a phantom "gap" in the vault's own protocol file — caught by running the scan on the
  // real vault before shipping. Same exclusion as `classifyVaultDoc`.
  const SKIP_FILES = new Set(["AGENTS.md", "vault-AGENTS.md"]);
  const walk = (rel) => {
    if (out.length >= maxFiles) return;
    const absolute = rel === "" ? root : join(root, rel);
    let entries = [];
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (NOTE_SCAN_SKIP_DIRS.has(name)) continue;
        if (NOTE_SCAN_SKIP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
        if (name.startsWith(".")) continue;
        walk(rel === "" ? name : rel + "/" + name);
      } else if (entry.isFile() && name.toLowerCase().endsWith(".md")) {
        if (SKIP_FILES.has(name)) continue;
        out.push(rel === "" ? name : rel + "/" + name);
      }
    }
  };
  walk("");
  return out;
}

/**
 * `[[wikilink]]` targets in a card's provenance fields. Top-level module scope (it used
 * to be a closure inside `buildAuditReport`) so the corroboration judgement below and the
 * audit's structural checks share ONE extraction — the closure version was why
 * `findCorroboration`'s link accessor silently dropped `depends_on` (the helper it was
 * handed only looked at `source`/`related`).
 *
 * The regex is byte-identical to the one it replaced; `#`/`|` suffixes are stripped.
 */
function extractLinks(raw) {
  const links = [];
  const expression = /\[\[([^\[\]|#]+)(?:#[^\]\[]*)?(?:\|[^\]\[]*)?\]\]/g;
  for (const field of [String(raw?.source ?? ""), String(raw?.related ?? ""), String(raw?.depends_on ?? raw?.dependsOn ?? "")]) {
    let match;
    expression.lastIndex = 0;
    while ((match = expression.exec(field)) !== null) links.push(match[1].trim().replace(/\.md$/i, ""));
  }
  return links;
}

/**
 * A candidate document's own declared provenance, read through the shared memo parser.
 *
 * This exists because of a bug the independence rule would otherwise have had: the
 * evidence pool was built as `{ rel, text }`, so passing `other.source` into the link
 * accessor always produced `""` — the shared-upstream judgement could only ever see the
 * CARD's links and never the document's, i.e. it would have been structurally incapable of
 * finding a shared source and would have passed its own test. (Same failure family the
 * repo keeps hitting: a guard that cannot see its own input.)
 *
 * @returns `{ source, related, dependsOn }` — the field names are the link accessor's.
 */
function provenanceOfDocument(text) {
  const meta = parseMemoFrontmatter(text);
  return {
    source: meta.source ?? "",
    related: meta.related ?? "",
    dependsOn: meta.depends_on ?? ""
  };
}

/**
 * Find the card's corroborating counterpart, if it has one. DETERMINISTIC, and the
 * one legitimate path by which the plugin may raise `verified` to `cross-referenced`.
 *
 * WHY this exists (2026-09-18): `cross-referenced` means "somewhere else in this vault
 * says the same thing", which is a FACT ABOUT FILES, not a matter of taste — so making
 * the user click ✅ for it was asking them to do bookkeeping. The cost of that mistake
 * was structural: every new card starts at `single-source`, nothing could ever raise it
 * without a human click, so the "single-source for over 60 days" list reported the same
 * cards forever and the only exit was one click per card. (Measured 2026-09-10: every
 * such field in the real vault was 0 — the mechanism was never used.)
 *
 * The judgement this does NOT replace: `user-confirmed` still requires the user, and a
 * ❌ still downgrades one level. This only fills in the middle grade, with evidence.
 *
 * What counts as corroboration (deliberately narrow, and the reason is asserted):
 *   ANOTHER CARD cannot vouch for this one. The evidence must be one of the USER'S OWN
 *   NOTES (`listVaultNotes`) that this card links to (`related` / `depends_on` /
 *   `source`) and that mentions this card's hook signature — its `pattern` or one of its
 *   `techniques` — in its own text. A shared topic is not enough, and neither is another
 *   agent-authored card agreeing: two guesses agreeing would mint a "cross-referenced"
 *   grade out of nothing, which is precisely how a store gets more wrong as it grows.
 *   Scaffold files (`_README.md`, `index.md`) are excluded: the layer READMEs document
 *   an EXAMPLE hook (`pattern: subsequence_argument`) and would otherwise "corroborate"
 *   every card that links to them.
 *
 * INDEPENDENCE (2026-10-01, C8/N4; docs/pending-decisions-2026-09-26.md §3.1): a document
 * that shares an UPSTREAM with the card is not a second witness, it is the same witness
 * seen twice — restating one source in two files is exactly what Louck's L-c
 * ("manufactured corroboration") and Dash's Salience fragility ("repeated ≥3 times ⇒ read
 * as important") describe, and both are trivially manufacturable by the agent itself.
 * So when a matching document ALSO shares a `source` / `depends_on` target with the card,
 * it is reported as `related-repetition` and does NOT upgrade the level. Crucially the
 * search CONTINUES: if one linked document is contaminated, a later independent one can
 * still corroborate (first version stopped at the first name-match, so one shared source
 * would have been enough to veto an otherwise valid upgrade).
 *
 * WHAT THIS DOES NOT PROVE: two documents with no shared link are assumed independent.
 * The vault carries no authenticated channel, so independence is INFERRED from declared
 * links, not established (Louck's assumption A1 does not hold here — see
 * `literature/notes/memory-fidelity-papers-2026-10-01.md` §5.2).
 *
 * @returns `{ origin, evidence, sharedWith }` where `origin` is `"note"` (no shared
 *   upstream), `"related-repetition"` (matched, but shares an upstream) or `null`.
 */
function findCorroboration(card, candidates, links) {
  const signatures = [
    String(card.hook?.pattern ?? ""),
    ...(Array.isArray(card.hook?.techniques) ? card.hook.techniques : [])
  ].map((value) => String(value).trim().toLowerCase()).filter((value) => value.length >= 6);
  if (signatures.length === 0) return { origin: null, evidence: null, sharedWith: [] };
  const cardUpstream = new Set(links(card));
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let sharedWith = [];
  for (const target of links(card)) {
    const key = String(target).replace(/\.md$/i, "");
    const other = candidates.get(key) ?? candidates.get(key.split("/").at(-1));
    if (other === undefined) continue;
    const haystack = other.text.toLowerCase();
    if (!signatures.some((signature) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(signature)}([^\\p{L}\\p{N}_]|$)`, "u").test(haystack))) continue;
    // Independence is observed on the DOCUMENT's own declared links, not on the fact
    // that the card linked to it — linking is how the pair was found in the first place.
    const upstream = links({ source: other.source, related: other.related, depends_on: other.dependsOn });
    const shared = upstream.filter((value) => cardUpstream.has(value));
    if (shared.length === 0) return { origin: "note", evidence: other.rel, sharedWith: [] };
    sharedWith = [...new Set([...sharedWith, ...shared])];
  }
  if (sharedWith.length > 0) return { origin: "related-repetition", evidence: null, sharedWith };
  return { origin: null, evidence: null, sharedWith: [] };
}

/**
 * Card-level contradictions (P5-A, 2026-09-26): two cards with the SAME signature — the same
 * `hook.pattern` / `hook.techniques` `findCorroboration` already uses, ≥6 chars — whose one-line
 * conclusions carry OPPOSITE polarity.
 *
 * WHY this narrow rule (docs/note-noise-and-memory-fidelity-2026-09-26.md §4 P5): a broader "the
 * texts disagree" heuristic cries wolf — this repo already refused exactly that for notation
 * conflicts — and the plugin must not call a model (`docs/memory/design.md` §10 red line). So:
 * same signature + exactly ONE side negated + at least THREE shared 2-grams, which stops unrelated
 * one-liners in the same signature group from pairing up.
 *
 * WHY three (2026-09-26, measured): a 3-character Chinese word yields exactly two bigrams, so "two
 * shared bigrams" means "they share ONE word" — "不要用洛必达处理不定式" and "先用洛必达化简再求极限" share
 * 洛必+必达 and are NOT a contradiction; requiring three makes it "two shared words or a longer shared
 * phrase". The injection test fails on the looser bar, which is how this number was chosen.
 *
 * REPORT ONLY. Nothing here rewrites or re-ranks a card — which is why this ships WITHOUT the
 * "single-source ageing" half of P5: that one moves retrieval order, so it has to be validated
 * against the engine-probe thresholds first (retrieval-v3 §7.5), and it is a separate decision.
 *
 * NOTE: the P5 write-up said "same topic"; cards carry no `topic` field (that one is a memo field),
 * so the signature is the anchor. Narrower is what this needs.
 */
export function findContradictions(cards) {
  const NEGATED = /(?:不要|不用|别|避免|禁止|不能|不应|不得|并非|不是)/;
  const MIN_SHARED_TOKENS = 3;
  const bigrams = (text) => {
    const source = String(text ?? "").toLowerCase();
    const out = new Set();
    for (const run of source.match(/[\p{Script=Han}]+/gu) ?? []) {
      for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
    }
    for (const word of source.match(/[a-z0-9_]{3,}/g) ?? []) out.add(word);
    return out;
  };
  const signaturesOf = (card) => [
    String(card.hook?.pattern ?? ""),
    ...(Array.isArray(card.hook?.techniques) ? card.hook.techniques : [])
  ].map((value) => String(value).trim().toLowerCase()).filter((value) => value.length >= 6);

  const live = cards.filter((card) => String(card.status ?? "active") !== "archived");
  const pairs = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      const aSignatures = signaturesOf(a);
      const shared = aSignatures.filter((signature) => signaturesOf(b).includes(signature));
      if (shared.length === 0) continue;
      if (NEGATED.test(String(a.title ?? "")) === NEGATED.test(String(b.title ?? ""))) continue;
      const bBigrams = bigrams(b.title);
      const sharedTokens = [...bigrams(a.title)].filter((token) => bBigrams.has(token));
      if (sharedTokens.length < MIN_SHARED_TOKENS) continue;
      pairs.push({ a: a.rel, b: b.rel, signature: shared[0] });
    }
  }
  return pairs;
}

/**
 * Collect the notation a vault actually uses, from the DEFINITION SENTENCES in the
 * user's own notes. Returns `[{ symbol, name, note }]`, deduplicated.
 *
 * WHY this shape (2026-09-18): `notation.md` has been an empty template since it was
 * created — every row still reads 「（示例）」 — because the order was wrong: the user was
 * asked to fill a table FIRST so that a checker would have input. Observed reality says
 * nobody does that. This inverts it: the plugin watches how the notes are actually
 * written, and the user is only asked a question when the same NAME turns up under more
 * than one symbol.
 *
 * KNOWN LIMITS of this first version (measured on the real vault, deliberately left
 * visible rather than papered over):
 *   1. a definition whose right-hand side starts with math gets truncated at the first
 *      space (`称 $L_k$ 为 $k$ 阶…` → `$k`), because there is no LaTeX parser here;
 *   2. coverage is partial: the vault's dominant notation (`\leadsto`, 37 uses) is NOT
 *      recovered, because it is introduced in a different sentence shape;
 *   3. descriptive prose can be misread as a definition
 *      (`$X_i$ 表示某指定区域的年降雨量`).
 * The point of shipping it is to find out, from real use, whether "definition sentences"
 * is even the right entry point.
 */
export function collectNotation(notes) {
  const PATTERNS = [
    /记\s*\$([^$]{1,30})\$\s*(?:为|表示|记作)\s*([^\n]{1,40})/g,
    /(?:称|把)\s*\$([^$]{1,30})\$\s*(?:为|叫作|称为)\s*([^\n]{1,40})/g,
    /\$([^$]{1,30})\$\s*(?:表示|代表|记作|称为)\s*([^\n]{1,40})/g,
    /(?:用|以)\s*\$([^$]{1,30})\$\s*(?:表示|记|代表)\s*([^\n]{1,40})/g
  ];
  const out = [];
  const seen = new Set();
  for (const { rel, text } of notes) {
    const body = String(text);
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(body)) !== null) {
        const symbol = match[1].trim();
        // The right-hand side is a Chinese phrase naming the object. Cut at the first
        // delimiter, then drop markup. See limit (1) above: a math-led name survives
        // only as its first token.
        const name = match[2]
          .split(/[，。；、,.;:：!?！？(（\[【]/)[0]
          .replace(/[*`_>#]/g, "")
          .replace(/[）)】\]]+$/, "")
          .trim();
        if (symbol === "" || symbol.length > 30) continue;
        // A "name" with no Chinese in it is a fragment of the formula, not a name.
        if (name === "" || name.length > 24) continue;
        if (!/[\u4e00-\u9fff]/.test(name)) continue;
        const key = symbol + "|" + name;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ symbol, name, note: rel });
        if (out.length >= 200) return out;
      }
    }
  }
  return out;
}

/** Render the generated block of `notation.md` (grouped by NAME, conflicts flagged). */
export function renderNotationBlock(entries, today = localDateString()) {
  const byName = new Map();
  for (const entry of entries) {
    const list = byName.get(entry.name) ?? [];
    list.push(entry);
    byName.set(entry.name, list);
  }
  const L = [];
  L.push(`> 本块由体检自动生成（${today}）：扫你笔记里的定义句（记/称/用 … 为/表示/记作 …）得到`);
  L.push("> 「记号 → 名字」配对。**只报告，不改你的笔记**；上面的手工表不会被它覆盖。");
  L.push("> ⚠️ 这是**观察版**：抽取规则会漏（定义句形态很多）、也可能误读（描述句被当成定义）。");
  L.push("> 若某个名字下确实有多套记号且你要统一，把决定写进上面的「已采纳」表即可，本块下次仍会如实列出。");
  if (entries.length === 0) {
    // Silence would be the worst outcome: "the feature is broken", "there is nothing to
    // collect" and "the switch is off" would look identical. Say which one it is.
    L.push(">");
    L.push("> **本次没有抽到任何记号**——要么你的笔记还没出现「记/称/用 … 为/表示/记作 …」这类定义句，");
    L.push("> 要么抽取规则漏了（观察版已知会漏）。若你觉得自己写过定义句却没被收到，请把那一句发给助手，");
    L.push("> 这是改进抽取规则最直接的输入。");
    return L.join("\n");
  }
  L.push("");
  L.push("| 记号 | 名字 | 出处 | 备注 |");
  L.push("|---|---|---|---|");
  const names = [...byName.keys()].sort((a, b) => a.localeCompare(b, "zh"));
  for (const name of names) {
    const list = byName.get(name);
    const symbols = [...new Set(list.map((item) => item.symbol))];
    const notes = [...new Set(list.map((item) => item.note))];
    if (symbols.length > 1) {
      L.push(`| ${symbols.join(" / ")} | ${name} | ${notes.join("、")} | **同名多记号（${symbols.length} 套）——需确认是"混用"还是"有意区分语境"** |`);
    } else {
      L.push(`| ${symbols[0]} | ${name} | ${notes.join("、")} |  |`);
    }
  }
  return L.join("\n");
}

/**
 * Notation hygiene + gap markers, in ONE read-only pass over the user's notes.
 *
 *   `gaps`      — notes carrying 待补/待核对/TODO markers, with counts. Measured on the
 *                 real vault: 14 hits, all genuine (it admits two unproven steps and
 *                 carries 22 markers inside one long AI-drafted file).
 *   `notation`  — `[{ symbol, name, note }]` from `collectNotation`.
 *   `conflicts` — names carrying MORE THAN ONE symbol. This is the only thing reported
 *                 as a conflict: one SYMBOL under two meanings is not reported (that
 *                 needs semantics and would cry wolf — the vault's three convergence
 *                 arrows are plausibly deliberate context distinctions).
 */
export function scanNoteHygiene(root) {
  const notes = [];
  for (const rel of listVaultNotes(root)) {
    try {
      notes.push({ rel, text: readFileSync(join(root, rel), "utf8") });
    } catch {
      // unreadable note: skip, not an error
    }
  }
  const gaps = [];
  const aiMarked = [];
  for (const note of notes) {
    // TWO marker families, reported separately (N-a, 2026-10-01):
    //   * "unfinished business" the USER wrote down for themselves (待补/待核对/TODO…);
    //   * "this part was written by the AI" — `<!-- AI 补全 -->`, the marker the vault
    //     protocol already REQUIRES (`dsh/templates/vault-AGENTS.md` §2.2) and which this
    //     scan used to MISS entirely: the regex here never listed it, so a note that
    //     honestly marked its AI-written sections was absent from the gap report even
    //     though `scanNoteClaims` (a different, narrower consumer of that vocabulary) knew
    //     the marker. Reported separately because the consequence differs: an unfinished
    //     step is work to do, whereas an AI-written passage is a passage that must not be
    //     quoted back as the user's own words.
    const matches = note.text.match(/待补|待核对|待证明|TODO|待完成/g) ?? [];
    if (matches.length > 0) gaps.push({ rel: note.rel, count: matches.length });
    // ONE regex for both spellings so a literal `<!-- AI 补全 -->` counts once: the
    // alternation puts the comment first (longest form wins at any position), and
    // occurrences outside any comment still match the bare phrase.
    const ai = note.text.match(/<!--\s*AI\s*补全\s*-->|AI\s*补全/g) ?? [];
    if (ai.length > 0) aiMarked.push({ rel: note.rel, count: ai.length });
  }
  gaps.sort((a, b) => b.count - a.count);
  aiMarked.sort((a, b) => b.count - a.count);
  const notation = collectNotation(notes);
  const byName = new Map();
  for (const entry of notation) {
    const list = byName.get(entry.name) ?? [];
    list.push(entry);
    byName.set(entry.name, list);
  }
  const conflicts = [...byName.entries()]
    .map(([name, list]) => ({ name, symbols: [...new Set(list.map((item) => item.symbol))], notes: [...new Set(list.map((item) => item.note))] }))
    .filter((entry) => entry.symbols.length > 1)
    .sort((a, b) => b.symbols.length - a.symbols.length);
  return {
    gaps: gaps.slice(0, AUDIT_NOTE_MAX_ITEMS),
    gapTotal: gaps.reduce((sum, item) => sum + item.count, 0),
    aiMarked: aiMarked.slice(0, AUDIT_NOTE_MAX_ITEMS),
    aiMarkedTotal: aiMarked.reduce((sum, item) => sum + item.count, 0),
    notation,
    conflicts: conflicts.slice(0, AUDIT_NOTE_MAX_ITEMS)
  };
}

/**
 * Write the generated notation block into `notation.md`, between BEGIN/END markers.
 *
 * Preserves everything written by hand — the block is appended if absent, replaced in
 * place if present. The target is the file `AGENTS.md` §2 already declares as the
 * notation system's home, so this adds no new layer.
 *
 * @returns `{ ok, reason }`; never throws into the audit.
 */
function syncNotationBlock(root, entries, today, enabled = true) {
  const path = join(root, MEMORY_DIR, "memory", "notation.md");
  const block = renderNotationBlock(entries, today);
  const BEGIN = "<!-- BEGIN AUTO-NOTATION (体检生成，勿手改本块) -->";
  const END = "<!-- END AUTO-NOTATION -->";
  if (enabled !== true) return { ok: true, reason: "disabled" };
  try {
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      text = "---\ntype: memory/notation\nupdated: " + today + "\n---\n\n# 记号体系（notation system）\n\n## 已采纳（adopted）\n\n| 记号 | 含义 | 领域 | 出处 | 备注 |\n|---|---|---|---|---|\n\n## 候选 / 讨论中（candidates）\n\n## 已否决（rejected）\n\n## 修订历史\n\n- " + today + " 创建\n";
    }
    const wrapped = BEGIN + "\n" + block + "\n" + END;
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END);
    const next = start >= 0 && end > start
      ? text.slice(0, start) + wrapped + text.slice(end + END.length)
      : text.replace(/\s*$/, "") + "\n\n## 自动收集（体检生成，勿手改本块）\n\n" + wrapped + "\n";
    if (next === text) return { ok: true, reason: "unchanged" };
    writeFileSync(path, next, "utf8");
    // Read back, not assume — the same postcondition discipline as the stats sync.
    return readFileSync(path, "utf8").includes(BEGIN) ? { ok: true } : { ok: false, reason: "读回校验失败" };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

/**
 * Records that carry GENERAL METHODOLOGY rather than a problem-bound product.
 *
 * WHY this exists (2026-09-18): the protocol gives the same kind of content two homes.
 * `AGENTS.md` §2 routes "一般性数学思路/方法/技巧/观点" to `inbox/` (the idea layer,
 * whose injection is labelled 待打磨), while §4 routes "构造的例子、反例、分解计划、
 * 障碍、**提取到的证明模式**" to `records/` (type `artifact`) — and "提取到的证明模式"
 * and "一般性方法" are the same thing. Where such a card lands decides whether it is
 * treated as SETTLED (records: injected with no provisional marker, citable as memory)
 * or as a DRAFT (inbox: labelled 待打磨). Both are legal, so nothing ever caught the
 * difference — and the user's worry is exactly this: an agent's own methodological
 * gloss, possibly slightly off, hardening into "fact" and being reused and re-derived
 * from there.
 *
 * Shape being detected: the user's own observation records are problem-bound (they link
 * the note or the question they came from) and concrete. A card that names no user note,
 * and whose body contains no formula or number at all, reads as pure talk.
 *
 * Deliberately TWO conditions together, and only for `artifact`: reporting every
 * note-less record would cry wolf on ordinary observations, and a check that cries wolf
 * gets ignored. Reported, never moved — the model decides whether a card belongs in
 * `inbox/` or should instead be tied to the problem it served.
 *
 * @returns array of `{ title, rel, reason }`.
 */
export function methodologyInRecordLayer(records, linkTargetsOf) {
  const out = [];
  for (const card of records) {
    if (card.type !== "artifact") continue;
    const links = linkTargetsOf(card);
    // A link to a USER NOTE is the binding that makes a card problem-bound (`[[笔记/…]]`
    // or a note stem). Links to episodes/cards do not count.
    const boundToNote = links.some((target) => {
      const text = String(target);
      if (text.startsWith(".deepseek/") || text.startsWith("rec-") || text.startsWith("tpl-") || text.startsWith("strat-")) return false;
      return !/^\d{4}-\d{2}-\d{2}/.test(text); // episode files are date-stamped
    });
    if (boundToNote) continue;
    const body = String(card.body ?? "");
    // `$` is END-OF-LINE in a regex, so it must be escaped to mean "LaTeX delimiter";
    // without the backslash a body containing any `$…$` was still caught by the other
    // alternatives, but the intent would have been lost silently.
    const hasConcrete = /\$|\\[a-zA-Z]+|[0-9]|≤|≥|≠|→|⟹|⟸|⇔/.test(body);
    if (hasConcrete) continue;
    out.push({ title: card.title, rel: card.rel, reason: "既未关联任何笔记，正文也没有公式或数字" });
  }
  return out.slice(0, 8);
}

/**
 * READ-ONLY audit of `theorems/index.md` (the personal Matlas) and the notes it
 * points at. Returns findings; writes nothing, ever.
 *
 * Two findings, both deterministic:
 *   1. `contradictions` — an index line that says a theorem is proved (已证) while
 *      its carrier note declines to vouch for the content (a 待核对-style marker in
 *      the body, or a carrier short enough to be a stub). This is the highest-value
 *      check in the whole audit: the index is what a reader (human or agent) trusts
 *      when deciding whether to rely on a result, so a wrong label here reaches
 *      everything downstream. Real instance: Cramér–Rao, see the constants above.
 *   2. `unresolved` — the index points at a note that does not resolve. The existing
 *      broken-link check only ever ran on `records/` cards, so a dangling carrier
 *      link was invisible.
 *
 * Exported so the regression suite can exercise it directly (`scripts/test-memory.mjs`)
 * and, more importantly, so the "no finding" case can be asserted too (a check that
 * never fires and a check that fires wrongly are equally useless).
 */
export function scanNoteClaims(root) {
  const result = {
    indexPresent: false,
    total: 0,
    resolved: 0,
    stubCarriers: 0,
    contradictions: [],
    unresolved: []
  };
  let text = "";
  try {
    text = readFileSync(join(root, AUDIT_THEOREM_INDEX), "utf8");
  } catch {
    return result; // no theorem index yet: nothing to audit, and not an error
  }
  result.indexPresent = true;

  const notes = listVaultNotes(root);
  const byBasename = new Map();
  for (const rel of notes) {
    const base = rel.split("/").at(-1).replace(/\.md$/i, "");
    if (!byBasename.has(base)) byBasename.set(base, rel);
  }
  const exists = (target) => {
    const clean = noteLinkTarget(target);
    if (clean === "") return null;
    const direct = clean + ".md";
    if (existsSync(join(root, direct))) return direct;
    const base = clean.split("/").at(-1);
    return byBasename.get(base) ?? null;
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(">") || trimmed.startsWith("#")) continue;
    const link = /\[\[([^\[\]|#]+)(?:#[^\]\[]*)?(?:\|[^\]\[]*)?\]\]/.exec(trimmed);
    if (link === null) continue;
    result.total += 1;
    const target = link[1];
    // The theorem's NAME is the line's label, not the link target: the index format
    // is `- <定理名> · 领域:… · 状态:… · 讨论载体:[[载体]]`, so the label is what
    // precedes the first metadata separator. Taking the link's display text (which
    // these lines usually omit) or the target path would name the finding after the
    // CARRIER instead of the theorem — useless to a reader.
    const display = (() => {
      const head = trimmed.replace(/^[-*+]\s*/, "").split(/\s*·\s*/)[0].trim();
      if (head !== "" && !head.includes("[[")) return head;
      const inner = link[0].replace(/^\[\[|\]\]$/g, "");
      const pipe = inner.indexOf("|");
      return (pipe === -1 ? inner : inner.slice(pipe + 1)).replace(/^#+\s*/, "").trim();
    })();
    const carrier = exists(target);
    if (carrier === null) {
      result.unresolved.push({ target: noteLinkTarget(target), name: display, line: trimmed.slice(0, 80) });
      continue;
    }
    result.resolved += 1;
    const claimsProved = AUDIT_PROVED_TOKENS.some((token) => trimmed.includes(token));
    if (!claimsProved) continue;
    let body = "";
    try {
      body = readFileSync(join(root, carrier), "utf8");
    } catch {
      continue;
    }
    const marker = AUDIT_OPEN_MARKERS.find((m) => body.includes(m));
    const bodyChars = body.replace(/\s+/g, "").length;
    if (marker !== undefined) {
      result.contradictions.push({ name: display, carrier, reason: `载体含「${marker}」`, detail: "index-claims-proved" });
      result.stubCarriers += 1;
    } else if (bodyChars < AUDIT_NOTE_STUB_CHARS) {
      result.contradictions.push({ name: display, carrier, reason: `载体仅 ${bodyChars} 字（疑似存根）`, detail: "index-claims-proved" });
      result.stubCarriers += 1;
    }
  }
  result.contradictions = result.contradictions.slice(0, AUDIT_NOTE_MAX_ITEMS);
  result.unresolved = result.unresolved.slice(0, AUDIT_NOTE_MAX_ITEMS);
  return result;
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

  // ── card ORIGIN: who wrote it, bound by the HOST (C7/N1, 2026-10-01) ────────
  // Runs as its own pass over the cards just parsed, so it is not entangled with any
  // statistics write and so a `maintainOrigin: false` caller still gets the findings.
  //
  // `declared` is whatever the frontmatter says — untrusted input, because the model can
  // type it and so can the user. `expected` is what the host can see for itself. The two
  // are reported separately and the host only writes when the card carries no valid
  // declaration: it never overwrites a value the user typed (the repo-wide "never
  // silently rewrite what the user wrote" rule; same shape as trap 48 for `verified_by`).
  // What it writes is bound to the one fact neither the model nor the file can
  // manufacture — `firstSeen`, the audit's own date, recorded in an append-only ledger.
  const originLedger = readOriginLedger(root);
  const originBlocked = [];
  const originRecords = [];
  const recordOrigin = (card, origin, evidence) => {
    const previous = originLedger.get(card.rel);
    const settled = previous?.origin === origin && previous?.updated === card.updated;
    // Re-recording must be a NO-OP when nothing changed. `firstSeen` is the host's own
    // observation date and is preserved; `updated` only moves when the card itself moved.
    // Writing `today` unconditionally made the ledger churn on every daily pass, which
    // would make "did this change?" unanswerable from the file (the same reason the audit
    // ledger keys identity WITHOUT the evidence numbers).
    originRecords.push({
      rel: card.rel,
      firstSeen: settled ? previous.firstSeen : today,
      origin,
      evidence: settled ? previous.evidence : evidence,
      updated: card.updated
    });
  };
  /**
   * A declaration that DISAGREES with what the host can observe is reported, never fixed
   * (auto-correcting would overwrite whatever the user typed — trap 48's rule). Agreement
   * is recorded as `declared`: the host can see that the value is on disk now, not who
   * typed it.
   */
  const assertOnOriginMatches = (card, declared, expected) => {
    if (expected.origin === null || declared === expected.origin) return true;
    card.originAuthorized = false;
    originBlocked.push(`${card.rel}（声明 origin: ${declared}，宿主观测为 ${expected.origin}）`);
    return false;
  };
  const assignOrigin = (card, declaredRaw) => {
    const declared = String(declaredRaw ?? "").trim();
    const expected = cardOriginFromPath(card.rel);
    card.originDeclared = declared;
    // `user` is never a host-observed origin in this vault: nothing authenticates "the
    // user wrote this" (the vault is plain editable markdown, and the only attested
    // writer is the agent working through the session). A card claiming it is reported,
    // never believed — the same asymmetry the `verified` ladder uses for `user-confirmed`.
    if (declared !== "" && (!CARD_ORIGIN_VALUES.has(declared) || declared === "user")) {
      card.origin = declared;
      card.originAuthorized = false;
      originBlocked.push(`${card.rel}（声明 origin: ${declared}；宿主观测不到这个来源）`);
      return;
    }
    if (declared !== "") {
      card.origin = declared;
      card.originAuthorized = assertOnOriginMatches(card, declared, expected);
      recordOrigin(card, declared, card.originAuthorized ? "declared" : "external-edit");
      return;
    }
    if (expected.origin !== null) {
      card.origin = expected.origin;
      card.originAuthorized = true;
      recordOrigin(card, expected.origin, expected.evidence);
      const observation = originLedger.get(card.rel);
      if (observation !== undefined && observation.origin !== "" && observation.origin !== expected.origin) {
        // The host's own record contradicts the disk: the line was changed outside the
        // audit. Same family as `unjustifiedUpgrade` — report it, never auto-fix it.
        card.originAuthorized = false;
        originBlocked.push(`${card.rel}（宿主记录 ${observation.origin}，磁盘是 ${expected.origin} → 行被外部改动过）`);
      }
      return;
    }
    // No valid declaration and no host observation. Say "未知" instead of guessing: an
    // old card the host has never seen is not evidence that the user wrote it.
    card.origin = "unknown";
    card.originAuthorized = true;
  };
  for (const card of cards) {
    let observed = "";
    try {
      // Through the shared primitives, never a second frontmatter regex (trap 65).
      observed = parseMemoFrontmatter(readFileSync(card.filePath, "utf8")).origin ?? "";
    } catch {
      observed = "";
    }
    assignOrigin(card, observed);
  }
  const originWritable = helpers.maintainOrigin !== false;
  let originLedgerWritten = 0;
  let originLedgerFailed = false;
  if (originWritable && originRecords.length > 0) {
    const result = writeOriginLedger(root, originLedger, originRecords);
    if (result === null) originLedgerFailed = true;
    else originLedgerWritten = result;
  }
  // The field only exists on disk when the host wrote it or the user declared it. Writing
  // is its own postcondition: a card that claims an origin is a CLAIM, and a claim whose
  // ledger row could not be confirmed is a `degraded` run, not a silent success.
  const originWriteFailures = [];
  if (originWritable) {
    for (const card of cards) {
      // Write when the host's conclusion is not already stated on the card: `agent` (the
      // common case) and `unknown` (nothing wrote it and the path is no observation
      // either). An unauthorized declaration is deliberately NOT touched — rewriting it
      // would overwrite what the user typed, which is worse than reporting it.
      if (!card.originAuthorized || card.originDeclared === card.origin) continue;
      try {
        const text = readFileSync(card.filePath, "utf8");
        const next = setCardOrigin(text, card.origin);
        if (next === null) continue;
        if (next !== text) writeFileSync(card.filePath, next, "utf8");
        // Read back the byte-level claim instead of assuming the write landed.
        if ((parseMemoFrontmatter(readFileSync(card.filePath, "utf8")).origin ?? "") !== card.origin) {
          originWriteFailures.push(card.rel);
        }
      } catch {
        originWriteFailures.push(card.rel);
      }
    }
  }

  // Deterministic hook-stats sync (opt-out via auditMaintainHookStats: false).
  // FIX(B1): after merging the note_recall hit counts into hook.uses, the
  // stats entries are zeroed — otherwise every daily audit re-adds the same
  // hits and uses grows without bound.
  //
  // Every write here is a CLAIM, so each one is verified by reading the file
  // back (design-intake §1 item 5: "report degraded instead of silent success").
  const postconditions = { statsWrites: 0, statsFailures: [], unmergeableStats: [], statsResetFailed: false, hookHistoryWritten: true, ledgerFailures: [], archiveFailures: [] };
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
  const structural = { missingSource: [], brokenLinks: [], notInIndex: [], unjustifiedUpgrade: [], usesMismatch: [], tooLong: [], tooLongRels: new Map(), tooManyMoves: [], tooManyMovesRels: new Map(), unauthorizedOrigin: originBlocked };
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
  // Index descriptions (WikiSkill Appendix E.2): the index line is what decides
  // whether a reader opens the card, so an empty or one-word summary is a real
  // defect, not cosmetics. Checked per layer, matching the `- [[stem|一句话]]` form
  // the READMEs prescribe. A card whose description is WEAK must not be reported as
  // "not in the index" — one finding per card, not a cascade.
  const indexTextFor = (layer) => {
    try {
      return readFileSync(join(root, MEMORY_DIR, "memory", layer, "index.md"), "utf8");
    } catch {
      return "";
    }
  };
  const strategyIndexText = (() => {
    try {
      return readFileSync(join(root, MEMORY_DIR, "strategy", "index.md"), "utf8");
    } catch {
      return "";
    }
  })();
  const recordsIndexText = indexTextFor("records");
  // One derivation, two consumers: the per-layer index issue map feeds BOTH the
  // card loop's findings and the published `sections`. Splitting them is how the
  // checklist and the report drift apart.
  const indexKeyOfCard = (rel) => {
    const layer = rel.includes("/strategy/") ? "strategy" : (rel.includes("/records/") ? "records" : "templates");
    return `${layer}/${String(rel).split("/").at(-1).replace(/\.md$/, "")}`;
  };
  const indexIssues = new Map();
  for (const [text, layer] of [[recordsIndexText, "records"], [indexTextFor("templates"), "templates"], [strategyIndexText, "strategy"]]) {
    if (text === "") continue;
    for (const line of text.split(/\r?\n/)) {
      const stem = /\[\[([^\[\]|#]+)/.exec(line)?.[1]?.trim().replace(/\.md$/i, "");
      if (stem === undefined || stem === "") continue;
      const issue = indexDescriptionIssue(line, AUDIT_INDEX_DESC_MIN);
      if (issue === null) continue;
      indexIssues.set(`${layer}/${stem}`, issue);
    }
  }
  for (const card of cards) {
    // Provenance ladder (machine-checkable, design-intake §1 item 3): AGENTS.md
    // says the agent may only write `single-source`; every higher level needs a
    // user confirmation, which is the only writer of `verified_by: user`.
    if (card.verified !== null && card.verified !== "single-source" && card.verifiedBy !== "user") {
      structural.unjustifiedUpgrade.push(`${card.title}(${card.verified})`);
    }
    const stem = card.rel.split("/").at(-1).replace(/\.md$/, "");
    // Size ceilings (see AUDIT_BODY_MAX_LINES / AUDIT_MAX_MOVES). Counted from the
    // file rather than from the card object because the card object carries parsed
    // fields, not the prose — and the prose is what grows.
    try {
      const rawText = readFileSync(card.filePath, "utf8");
      const body = stripFrontmatter(rawText);
      // Kept on the card: the methodology-in-record-layer check needs the PROSE (the
      // parsed card object carries fields, not the body).
      card.body = body;
      const bodyLines = body.split(/\r?\n/).filter((line) => line.trim() !== "").length;
      if (bodyLines > AUDIT_BODY_MAX_LINES) {
        structural.tooLong.push(`${card.title}(${bodyLines} 行 > ${AUDIT_BODY_MAX_LINES})`);
        structural.tooLongRels.set(card.rel, bodyLines);
      }
      if (card.type === "strategy") {
        // Counted from the RAW file, not the stripped body: `strategies:` sits in the
        // frontmatter, so the moves live in the block `stripFrontmatter` removes.
        // (First implementation counted from the body and therefore never fired.)
        const moves = (rawText.match(/^\s*-\s*move:/gm) ?? []).length;
        if (moves > AUDIT_MAX_MOVES) {
          structural.tooManyMoves.push(`${card.title}(${moves} 个 move > ${AUDIT_MAX_MOVES})`);
          structural.tooManyMovesRels.set(card.rel, moves);
        }
      }
    } catch {
      // An unreadable card is already reported by the uses-mismatch pass; do not
      // turn a size lint into a second, louder failure.
    }
    // `layer`/`stem` are only needed for the index lookup below; the index findings
    // themselves are derived once, after this loop, into `indexIssueByRel`.
    if (!card.rel.includes("/records/")) continue; // source discipline applies to record cards
    if (card.source.trim() === "") structural.missingSource.push(card.title);
    for (const target of extractLinks(card)) {
      if (!linkExists(target)) structural.brokenLinks.push(`${card.title}→[[${target}]]`);
    }
    // Only a card with NO index line at all counts as missing; a card that IS listed
    // with a weak description is reported once, as a description problem.
    if (recordsIndexText !== "" && !recordsIndexText.includes(`[[${stem}`)) structural.notInIndex.push(card.title);
  }

  // Rel-level views of the index findings, so the published `sections` are built
  // from the same derivation the checklist uses (one source of truth per finding).
  const indexIssueByRel = new Map();
  for (const card of cards) {
    const issue = indexIssues.get(indexKeyOfCard(card.rel));
    if (issue !== undefined) indexIssueByRel.set(card.rel, issue);
  }
  const indexWeakRels = new Set([...indexIssueByRel].filter(([, issue]) => issue !== "not-an-entry").map(([rel]) => rel));
  const indexNotAnEntryRels = new Set([...indexIssueByRel].filter(([, issue]) => issue === "not-an-entry").map(([rel]) => rel));

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

  // ── cross-occasion support: one sighting is an anecdote, several are a method ─
  // MSCE (arXiv:2607.16621 §4.2) refuses to induce a policy until the same signature
  // bucket holds evidence from at least `n_min` DISTINCT episodes, on the stated
  // ground that a single long trajectory would otherwise mint an over-specific rule.
  // MemForest (arXiv:2609.08273 §3.2) defines "the same event" as semantic similarity
  // plus temporal contiguity, weighting semantics 0.8 / time 0.2.
  //
  // The approved plan assumed a strategy card records which episodes exercised its
  // moves. It does not: `card.uses` counts RETRIEVALS, so it cannot answer "did this
  // technique work in more than one situation?". This reads the link that DOES exist
  // — a record's `hook.techniques` and its `source` episode — and counts the distinct
  // occasions a technique was seen in. Reported only: it backs the promote gate below
  // without silently changing any card's status on this pass.
  //
  // "Same occasion" = same episode bucket, where episodes within OCCASION_WINDOW_DAYS
  // of each other are one bucket (a derivation done across consecutive days is one
  // episode of use, not several). Undated evidence counts as its own occasion
  // (`unknown`), never merged with other undated evidence — inventing proximity would
  // manufacture support.
  const OCCASION_LOCAL_WINDOW = OCCASION_WINDOW_DAYS;
  const occasionsOf = (episodeKeys) => {
    const days = [];
    const unknown = [];
    for (const key of episodeKeys) {
      const day = parseLocalDay(key);
      if (day === null) unknown.push(key);
      else days.push(Math.floor(day.getTime() / 86400000));
    }
    days.sort((x, y) => x - y);
    let buckets = 0;
    let previous = null;
    for (const day of days) {
      if (previous === null || day - previous > OCCASION_LOCAL_WINDOW) buckets += 1;
      previous = day;
    }
    return buckets + unknown.length;
  };
  const techniqueEvidence = new Map();
  for (const card of cards) {
    if (!card.rel.includes("/records/")) continue; // evidence lives on record cards
    const episode = extractLinks({ source: card.source, related: "" })[0] ?? "";
    if (episode === "") continue; // no provenance: cannot claim an occasion
    const techniques = card.hook === null ? [] : String(hookText(card.hook, "techniques")).split(/\s+/).filter(Boolean);
    for (const technique of new Set(techniques)) {
      const entry = techniqueEvidence.get(technique) ?? { techniques: technique, episodes: new Set() };
      entry.episodes.add(episode);
      techniqueEvidence.set(technique, entry);
    }
  }
  const crossOccasion = [...techniqueEvidence.values()]
    .map(({ techniques, episodes }) => ({ techniques, occasions: occasionsOf([...episodes]) }))
    .filter((entry) => entry.occasions >= 1)
    .sort((x, y) => (y.occasions - x.occasions) || x.techniques.localeCompare(y.techniques));
  const independentTechniques = crossOccasion.filter((entry) => entry.occasions >= OCCASION_MIN);

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
      const rewritten = setTopField(block, "duplicate_of", `[[${keptStem}]]`);
      if (rewritten !== block) writeFileSync(redundant.filePath, replaceFrontmatterBlock(text, rewritten), "utf8");
    } catch {
      // best-effort; never break the audit
    }
  }

  // ── deterministic corroboration upgrade (`cross-referenced`, 2026-09-18) ────
  // `cross-referenced` means "somewhere else in this vault names the same pattern or
  // technique" — a fact about files, not a matter of taste. Requiring a user click for
  // it asked the user to do bookkeeping, and the cost was structural: every card starts
  // at `single-source`, nothing could raise it, so the "single-source for 60+ days" list
  // reported the same cards forever. This fills in the MIDDLE grade only:
  // `user-confirmed` still requires the user, and a ❌ still demotes one level.
  //
  // The witness (`verified_by: corroboration`) is written in the SAME edit as the level,
  // and the write is verified by reading the file back — otherwise the audit would mint
  // the exact "level raised with no witness" state its own `unjustifiedUpgrade` check
  // exists to catch.
  // Evidence pool for the corroboration pass: the USER'S OWN NOTES ONLY.
  //
  // Why not memory cards too (first version included them, and that was wrong): the
  // point of this pass is "the user's own material already says this". A *card* is
  // usually something the agent wrote, so allowing cards as evidence would let one
  // agent-authored note confirm another — two guesses agreeing would mint a
  // `cross-referenced` grade out of nothing, which is exactly the "it gets more wrong
  // as it accumulates" failure. Cards can still LINK to each other; what they cannot
  // do is vouch for each other.
  const corroborationDocs = new Map();
  {
    for (const rel of listVaultNotes(root)) {
      const stem = String(rel).split("/").at(-1).replace(/\.md$/i, "");
      const key = String(rel).replace(/\.md$/i, "");
      if (corroborationDocs.has(key)) continue;
      let text;
      try {
        text = readFileSync(join(root, key + ".md"), "utf8");
      } catch {
        continue; // unreadable candidate: simply not evidence
      }
      const entry = { rel: key + ".md", text, ...provenanceOfDocument(text) };
      corroborationDocs.set(key, entry);
      if (!corroborationDocs.has(stem)) corroborationDocs.set(stem, entry);
    }
  }
  const corroborated = [];
  const corroborationFailures = [];
  const corroborationRepetitions = [];
  for (const card of cards) {
    if (card.verified !== "single-source") continue;
    if (card.status !== "active") continue;
    const judgement = findCorroboration(card, corroborationDocs, (c) => extractLinks(c));
    // Matched, but the matching document shares an upstream with the card ⇒ the same
    // source seen twice. REPORTED (C8, 2026-10-01) and deliberately not counted: this is
    // the "manufactured corroboration" shape, and the card stays `single-source`.
    if (judgement.origin === "related-repetition") {
      corroborationRepetitions.push({ rel: card.rel, title: card.title, sharedWith: judgement.sharedWith });
      continue;
    }
    if (judgement.origin !== "note") continue;
    const via = judgement.evidence;
    const ok = syncHookStatsToCard(card.filePath, null, null, 0, { verified: "cross-referenced", verifiedBy: "corroboration" });
    if (!ok) {
      corroborationFailures.push(card.rel);
      continue;
    }
    // Mutate the in-memory card so the REST of this pass (utility, archive
    // candidates, the unverified list) sees what is now on disk. Without this the
    // report would describe a state the files no longer have.
    card.verified = "cross-referenced";
    card.verifiedBy = "corroboration";
    corroborated.push({ rel: card.rel, title: card.title, via });
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
  let archiveFailures = [];
  if (helpers.autoArchive === true && autoArchiveTargets.length > 0) {
    const archiveResult = moveCardsToArchive(root, autoArchiveTargets);
    archived = archiveResult.moved;
    archiveFailures = archiveResult.failures;
  }

  // Deterministic promote (self-correction.md P5b): a candidate strategy card
  // that has been used enough and succeeds often enough becomes active.
  //
  // Third gate — evidence grounding (MSCE, arXiv:2607.16621 §4.3): a skill is only
  // crystallized when it retains its evidence AND recent evidence still fits the
  // current trigger/procedure. The deterministic part of that, available here, is
  // provenance: a candidate with no traceable `source` has no evidence to promote
  // on, so it stays a candidate. The gate can ONLY block when provenance is absent —
  // it never demands more than the template already asks for, because a gate that
  // requires fields honest cards may lack would mark them never-promotable.
  //
  // Deliberately NOT gated here: cross-occasion support (`n_min` distinct episodes).
  // The audit does compute it, but only for RECORD techniques — records carry the
  // hook and the episode link, while a strategy card's moves point at retrieve
  // targets, not at episodes. Turning that count into a promotion gate would change
  // promotion for every candidate on the strength of data that does not describe the
  // card. The audit reports the blocked candidates instead, and the reader decides.
  const PROMOTE_BLOCKERS = [];
  for (const card of cards) {
    if (card.status !== "candidate" || card.type !== "strategy") continue;
    if (card.uses < PROMOTE_USES || card.successRate === null || card.successRate < PROMOTE_RATE) continue;
    if (String(card.source ?? "").trim() === "") {
      // `cardRef` is declared further down (TDZ), and it only renames these two
      // fields, so build the entry directly.
      PROMOTE_BLOCKERS.push({ rel: card.rel, title: card.title, gain: card.gain ?? 0, reason: "缺 source（无可回溯证据）" });
      continue;
    }
    try {
      const text = readFileSync(card.filePath, "utf8");
      const block = frontmatterBlock(text);
      if (block === null) continue;
      const rewritten = setTopField(block, "status", "active");
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
  //
  // `uses`/`successRate` ride along for the same reason and were added 2026-09-18:
  // without them the WEAK section's own self-check could not read the numbers its
  // criterion is defined on (it saw `undefined`, so it fired on every weak card and
  // the ledger wrote `uses=undefined`). A guard that cannot see its own inputs is
  // the "assertion passes under mutation" failure mode this repo keeps hitting.
  const cardRef = (card) => ({
    rel: card.rel,
    title: card.title,
    gain: card.gain ?? 0,
    uses: card.uses,
    successRate: card.successRate,
    // Carried so a reader can tell WHICH grade the report is talking about — the
    // corroboration list is meaningless without it.
    verified: card.verified ?? null,
    // WHO wrote it, kept separate from the verification grade on purpose (C7): "the agent
    // wrote this" and "this was verified" are two different facts, and collapsing them is
    // what let an agent gloss read as a settled fact.
    origin: card.origin ?? "unknown"
  });
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
    // General methodology that landed in the RECORD layer (see
    // `methodologyInRecordLayer`): it reads as settled here, while the same content in
    // `inbox/` would be injected as 待打磨. Reported so the routing can be corrected.
    methodologyInRecords: methodologyInRecordLayer(
      cards.filter(live),
      (card) => extractLinks({ source: "", related: card.related, depends_on: card.dependsOn })
    ),
    // Most-similar pair first (see the sort above); `jaccard` is carried so the
    // checklist can state WHY this pair is at the top.
    duplicates: liveDuplicates.slice(0, 3).map(({ a, b, jaccard }) => ({
      a: cardRef(a),
      b: cardRef(b),
      jaccard,
      hub: isHub(a) ? hubName(a) : (isHub(b) ? hubName(b) : "")
    })),
    // P5-A (2026-09-26): cards whose one-line conclusions contradict each other. REPORT ONLY — this
    // section never rewrites or re-ranks anything (the "single-source ageing" half of P5 would move
    // retrieval order and has to clear the engine-probe thresholds first; that is a separate call).
    conflicting: findContradictions(cards.filter(live)).slice(0, 10).map((pair) => {
      const of = (rel) => cards.find((card) => card.rel === rel) ?? { rel, title: rel };
      return { a: cardRef(of(pair.a)), b: cardRef(of(pair.b)), signature: pair.signature };
    }),
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
    // Index-line quality (WikiSkill Appendix E.2). Two distinct findings: a
    // description too weak to judge relevance by, and a line that is not the
    // `- [[stem|一句话]]` form the layer READMEs prescribe (readers and older parsers
    // resolve the stem from the link, so a malformed line makes the card unfindable
    // by name even though it is "in the index").
    indexWeak: cards.filter((card) => live(card) && indexWeakRels.has(card.rel))
      .map((card) => ({ ...cardRef(card), issue: indexIssueByRel.get(card.rel) })),
    indexNotAnEntry: cards.filter((card) => live(card) && indexNotAnEntryRels.has(card.rel))
      .map((card) => ({ ...cardRef(card), issue: indexIssueByRel.get(card.rel) })),
    // Size ceilings (WikiSkill Appendix E.2): a card that grew into an essay is a
    // card nobody re-reads. Advisory — reported, never auto-split.
    tooLong: cards.filter((card) => live(card) && structural.tooLongRels.has(card.rel))
      .map((card) => ({ ...cardRef(card), lines: structural.tooLongRels.get(card.rel) })),
    tooManyMoves: cards.filter((card) => live(card) && structural.tooManyMovesRels.has(card.rel))
      .map((card) => ({ ...cardRef(card), moves: structural.tooManyMovesRels.get(card.rel) })),
    autoArchiveTargets: autoArchiveTargets.map((card) => ({ ...cardRef(card), filePath: card.filePath })),
    // Cards standing on a premise that has moved. Each entry names BOTH ends so the
    // reader can judge whether the dependent still holds.
    downstreamReview: downstreamReview
      .filter(({ card, via }) => live(card) && live(via))
      .map(({ card, via, reason }) => ({ ...cardRef(card), via: cardRef(via), reason })),
    // Techniques seen in >= OCCASION_MIN independent episodes: the deterministic
    // answer to "is this a method or a one-off?". Informational for now.
    independentTechniques: independentTechniques.map(({ techniques, occasions }) => ({ techniques, occasions })),
    // Cards the audit itself raised to `cross-referenced` this pass, each with the
    // document that corroborated it (the evidence is reported, not written into the
    // card: a stored pointer would need re-verification on every rename, and the
    // witness `verified_by: corroboration` is what the unjustifiedUpgrade check reads).
    corroborated: corroborated.slice(0, 5).map((item) => ({ rel: item.rel, title: item.title, via: item.via })),
    // Matched a document that shares an upstream with the card ⇒ related repetition, not
    // independent corroboration, so the level is NOT raised (C8/N4, 2026-10-01). Reported
    // so a real repetition is visible instead of silently doing nothing.
    corroborationRepetitions: corroborationRepetitions.slice(0, 5)
      .map((item) => ({ rel: item.rel, title: item.title, sharedWith: item.sharedWith })),
    // Cards whose `origin` the host could not pin down (nothing wrote the field and the
    // path is no observation either). Reported, never silently downgraded — an old card
    // keeps whatever it has and is shown as 来源未知 rather than assumed the user's.
    originUnknown: cards.filter((card) => live(card) && card.origin === "unknown").map(cardRef),
    archived: archived.map((item) => ({ rel: item.rel, stem: item.stem }))
  };
  // An origin declaration the host cannot back with its own observation (C7). Kept as
  // plain strings like `unjustifiedUpgrade`, because the checklist quotes them verbatim
  // and the panel shows the same list. Assigned AFTER `sections` exists on purpose: the
  // first version assigned it before the origin pass had filled `originBlocked`, so both
  // the section and the count silently read an empty array (a guard that cannot see its
  // own input — the failure mode this repo keeps hitting).
  sections.originUnauthorized = structural.unauthorizedOrigin.slice(0, 20);
  const thresholds = {
    unusedDays: AUDIT_UNUSED_DAYS,
    unverifiedDays: AUDIT_UNVERIFIED_DAYS,
    weakUses: AUDIT_WEAK_USES,
    weakRate: AUDIT_WEAK_RATE,
    strongRate: AUDIT_STRONG_RATE,
    duplicateJaccard: AUDIT_DUP_JACCARD,
    autoArchiveUnusedDays: AUTO_ARCHIVE_UNUSED_DAYS
  };

  // Two sources of truth for the same verdict must be checked against each other
  // (agent-repo-maintenance.md §3: "verification signals must be trustworthy").
  // Report it as `degraded` instead of asking a reader to notice the contradiction.
  const weakInconsistent = inconsistentWeakCards(sections.weak);

  // The cross-run record. Built from the SAME section arrays the report publishes,
  // so the ledger can never describe a recommendation the reader cannot see.
  const ledgerHints = new Map();
  const ledgerResult = recordAuditLedger(
    root,
    actionableAuditEntries(sections, ledgerHints),
    today,
    { enabled: helpers.maintainLedger !== false }
  );
  postconditions.ledgerFailures = ledgerResult.failures;
  const ledgerSummary = {
    today: today,
    newCount: ledgerResult.todayNew,
    carriedCount: ledgerResult.carried,
    written: ledgerResult.written,
    truncated: ledgerResult.truncated,
    disabled: ledgerResult.disabled === true,
    path: ledgerResult.path,
    newHints: (ledgerResult.fresh ?? []).slice(0, 3)
      .map((entry) => ledgerHint(ledgerHints, entry.object, entry.action, entry.criterion, entry.object)),
    carriedHints: (ledgerResult.carriedEntries ?? []).slice(0, 3)
      .map((entry) => `${ledgerHint(ledgerHints, entry.object, entry.action, entry.criterion, entry.object)}（首次 ${entry.firstSeen}，第 ${entry.count} 次）`)
  };

  // What needs a HUMAN decision (the panel's headline number). Downstream review
  // counts as one decision PER DEPENDENT CARD: each is a separate judgement, and
  // collapsing them would hide how far a single wrong premise reached.
  const liveDownstreamReview = sections.downstreamReview;
  const noteClaims = scanNoteClaims(root);
  // Note hygiene (gap markers + notation) is a second read-only pass over the same
  // notes. Its one write is the generated notation block, whose target is the file the
  // protocol already designates — no new layer, and hand-written rows are preserved.
  const noteHygiene = scanNoteHygiene(root);
  // The notation sync has its OWN kill switch (`auditMaintainNotation`), independent of
  // whether the scan runs: a user who does not want the audit writing into
  // `notation.md` should still get the findings reported, and vice versa.
  const notationSync = syncNotationBlock(root, noteHygiene.notation, today, helpers.maintainNotation !== false);
  // NOT pushed here: `warnings` is declared further down, and pushing before it exists
  // throws "Cannot access 'warnings' before initialization" — the same trap the
  // corroboration-failure warning hit. It is pushed inside the warnings block below.
  // Publish the note findings on `sections` right away, so every consumer (ledger,
  // checklist, human summary, panel) reads ONE derivation instead of re-scanning.
  sections.noteClaims = noteClaims.contradictions;
  sections.noteIndexUnresolved = noteClaims.unresolved;
  sections.noteIndexTotal = noteClaims.total;
  sections.noteGaps = noteHygiene.gaps;
  // Notes that marked their own AI-written passages (N-a). Deliberately its own section,
  // not folded into `noteGaps`: "unfinished business" and "not written by you" are
  // different findings with different actions, and merging them would let the second
  // disappear inside the first (the count that matters here is not a count of TODOs).
  sections.noteAiCompletions = noteHygiene.aiMarked;
  sections.notationConflicts = noteHygiene.conflicts;
  sections.notationCollected = noteHygiene.notation.length;
  // The corroboration pass already published `sections.corroborated`; mirror the
  // failures here. The warning itself is pushed further down, INSIDE the `warnings`
  // block — `warnings` is declared after this point (first version pushed here and
  // threw "Cannot access 'warnings' before initialization").
  sections.corroborationFailures = corroborationFailures.slice(0, 5);
  const decisions = {
    reviewCards: livePendingReview.length,
    cleanupCards: liveArchiveCandidates.length + liveDuplicates.length,
    downstreamCards: liveDownstreamReview.length,
    // A wrong label in `theorems/index.md` is the one finding that is BOTH
    // deterministic to detect AND read by everything downstream, so it is counted
    // as a decision rather than buried in a list.
    noteClaimCards: sections.noteClaims.length + sections.noteIndexUnresolved.length,
    total: livePendingReview.length + liveArchiveCandidates.length + liveDuplicates.length + liveDownstreamReview.length
      + sections.noteClaims.length + sections.noteIndexUnresolved.length
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
    autoArchived: sections.archived.length,
    noteClaims: sections.noteClaims.length,
    noteIndexUnresolved: sections.noteIndexUnresolved.length,
    corroborated: sections.corroborated.length,
    // Related repetition: a name-match that shares an upstream, so it did NOT raise the
    // level (C8). Counted separately from `corroborated` — the two are opposite outcomes
    // and a reader who saw them merged would think the upgrade happened.
    corroborationRepetitions: sections.corroborationRepetitions.length,
    originUnknown: sections.originUnknown.length,
    originUnauthorized: structural.unauthorizedOrigin.length,
    methodologyInRecords: sections.methodologyInRecords.length,
    noteGaps: sections.noteGaps.length,
    noteAiCompletions: sections.noteAiCompletions.length,
    notationConflicts: sections.notationConflicts.length,
    notationCollected: sections.notationCollected
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
  if (postconditions.ledgerFailures.length > 0) {
    warnings.push(`体检台账 ${postconditions.ledgerFailures.length} 条未确认写入：${postconditions.ledgerFailures.slice(0, 3).join("、")}`);
  }
  if (archiveFailures.length > 0) {
    warnings.push(`自动归档有 ${archiveFailures.length} 项未完成：${archiveFailures.slice(0, 3).join("；")}`);
  }
  postconditions.archiveFailures = archiveFailures;
  if (weakInconsistent.length > 0) {
    warnings.push(`weak 段自检不一致（weak 判据是 uses ≥ ${AUDIT_WEAK_USES} 且成功率 ≤ ${AUDIT_WEAK_RATE}，这些卡不满足）：${weakInconsistent.slice(0, 3).join("、")}`);
  }
  if (structural.usesMismatch.length > 0) {
    warnings.push(`${structural.usesMismatch.length} 张卡的声明 uses 与合并值不一致：${structural.usesMismatch.slice(0, 3).join("、")}`);
  }
  // A corroboration write that could not be confirmed belongs in `warnings` for the
  // same reason an archive failure does: the audit claimed to raise a card's level, and
  // the claim must be falsifiable. Pushed HERE (after `warnings` exists), not at the
  // point the failures were collected.
  if (corroborationFailures.length > 0) {
    warnings.push(`${corroborationFailures.length} 张卡找到互证依据但等级写入未确认：${corroborationFailures.slice(0, 3).join("、")}`);
  }
  // Card-origin writes are claims too (C7): the frontmatter says `origin: agent` and the
  // ledger says WHEN the host saw it. Either half failing makes the claim unverifiable, so
  // the run is reported as degraded rather than looking clean.
  if (originLedgerFailed) {
    warnings.push(`卡来源台账（${CARD_ORIGIN_FILE}）写入未确认：本轮"宿主何时见到这张卡"没有落盘，来源字段的凭据不完整`);
  }
  if (originWriteFailures.length > 0) {
    warnings.push(`${originWriteFailures.length} 张卡的 origin 字段回写未确认：${originWriteFailures.slice(0, 3).join("、")}`);
  }
  // A generated notation block that could not be confirmed is the same kind of claim as
  // an archive that "succeeded": the audit says it recorded the notation, and the claim
  // has to be falsifiable.
  if (!notationSync.ok) {
    warnings.push(`notation.md 自动块未确认写入：${notationSync.reason}`);
  }
  const status = warnings.length === 0 ? "ok" : "degraded";

  // The names behind the structural counts. Lifted out of the return object so the
  // checklist can quote the same arrays it publishes (the panels/CLI read them
  // without re-running the scan).
  const structuralDetail = {
    unjustifiedUpgrade: structural.unjustifiedUpgrade.slice(0, 20),
    usesMismatch: structural.usesMismatch.slice(0, 20),
    // Origin declarations the host cannot back with its own observation. Same "report,
    // never auto-fix" family as `unjustifiedUpgrade`: auto-correcting would overwrite
    // whatever the user typed.
    unauthorizedOrigin: structural.unauthorizedOrigin.slice(0, 20),
    hubs: hubCards.slice(0, 20).map((card) => ({
      ...cardRef(card),
      backlinks: backlinkCount.get(String(card.rel ?? "").split("/").at(-1).replace(/\.md$/, "")) ?? 0
    })),
    // The authoritative gain verdict per card, including the zeros. Kept flat and
    // separate from the sections because a card with a verdict may appear in no
    // section at all (a healthy, unused card), and the panels need the full list.
    gains: cards.filter(live).map((card) => ({ rel: card.rel, gain: card.gain ?? 0 })),
    // Candidates that met the usage/success bar but were held back by the grounding
    // gate. Named so "why is this still a candidate?" has an answer.
    promoteBlocked: PROMOTE_BLOCKERS.filter((entry) => !archivedRels.has(entry.rel))
  };

  /** Model-facing checklist: terse, imperative, paths and thresholds included. */
  const checklistLines = [];
  const listOf = (items, limit = 3, withDays = false) => items.slice(0, limit)
    .map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]${withDays && card.days !== null ? `(${card.days}天)` : ""}`)
    .join("、");
  if (cards.length > 0) {
    checklistLines.push(`记忆体检（${today}，共 ${cards.length} 张卡）${status === "degraded" ? "［DEGRADED］" : ""}`);
    if (status === "degraded") checklistLines.push(`- ⚠️ 未确认项：${warnings.join("；")}`);
    if (sections.harmed.length > 0) {
      checklistLines.push(`- 负反馈（用过但结果更差）: ${sections.harmed.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]](${card.harmed}/${card.uses})`).join("、")}`);
    }
    // Evidence findings come FIRST, immediately after 负反馈 — before every improvement list.
    // WHY (2026-09-26, P3 of docs/note-noise-and-memory-fidelity-2026-09-26.md): the checklist is
    // truncated at MAX_AUDIT_CHARS, and `unverified` used to be the LAST evidence list, so once a
    // vault grew it was silently eaten — the one section that prevents MISTAKEN BELIEF (a
    // single-source card of unknown age, a card awaiting re-review), while 强/弱/未用 are
    // improvements. Trap 81: proving this needs a fixture that CROSSES the threshold.
    if (sections.unverified.length > 0) checklistLines.push(`- unverified: ${listOf(sections.unverified)}`);
    if (sections.pendingReview.length > 0) checklistLines.push(`- 待重审: ${listOf(sections.pendingReview)}`);
    // Same family as unverified / 待重审: it is about not mis-believing what is injected, not about
    // polishing a card — so it sits up here with them, before every improvement list.
    if (sections.conflicting.length > 0) {
      const pairs = sections.conflicting.slice(0, 3)
        .map((pair) => `[[${pair.a.rel.replace(/\.md$/, "")}]] ↔ [[${pair.b.rel.replace(/\.md$/, "")}]]`);
      checklistLines.push(`- 互相矛盾（只报不改，需你判断信哪条）: ${pairs.join("、")}`);
    }
    // The ledger line states a FACT, never an instruction: a carried-over item is
    // not a new problem. Without this split, a card flagged for eleven days reads
    // exactly like a card flagged today.
    if (ledgerSummary.disabled) {
      checklistLines.push("- 台账已关闭（auditMaintainLedger: false）：本轮判定不落盘，跨次判定史不可用");
    } else if (ledgerSummary.newCount > 0 || ledgerSummary.carriedCount > 0) {
      const parts = [`本次新动作 ${ledgerSummary.newCount} 条`];
      if (ledgerSummary.carriedCount > 0) parts.push(`此前已在账、今日仍成立 ${ledgerSummary.carriedCount} 条（不是新问题）`);
      if (ledgerSummary.truncated > 0) parts.push(`另有 ${ledgerSummary.truncated} 条未入账（单次上限 ${AUDIT_LEDGER_MAX_WRITES}）`);
      checklistLines.push(`- 台账（${ledgerSummary.path}）: ${parts.join("；")}`);
      if (ledgerSummary.carriedHints.length > 0) {
        checklistLines.push(`  - 长期未处理（只报事实、不要求动作，除非你判断该升级处置）: ${ledgerSummary.carriedHints.join("；")}`);
      }
    }
    if (structural.unjustifiedUpgrade.length > 0) {
      checklistLines.push(`- 越权升级（verified 高于 single-source 但不是用户确认写入的）: ${structural.unjustifiedUpgrade.slice(0, 3).join("、")}`);
    }
    // Card provenance (C7). Sits with the evidence findings rather than with the
    // polish lists: "who said this" decides whether a card may be quoted as the user's
    // own words at all, which is the same class of mistake as believing an unverified
    // grade. The user-facing explanation of WHY lives in the human summary below.
    if (sections.originUnauthorized.length > 0) {
      const rows = sections.originUnauthorized.slice(0, 3).join("、");
      checklistLines.push(`- 来源声明越权（宿主观测不到该来源：本地 vault 没有认证通道，` +
        `origin: user 无法被证实，等级不得高于观测值）: ${rows}`);
    }
    if (sections.originUnknown.length > 0) {
      const rows = sections.originUnknown.slice(0, 3)
        .map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]`).join("、");
      checklistLines.push(`- 来源未知（${sections.originUnknown.length} 张；旧卡在宿主首次观测前就存在）: ${rows}` +
        `——引用时按"来源不明"处理，不得当作已核实事实，也不得声称是用户原话。`);
    }
    if (structural.missingSource.length + structural.brokenLinks.length + structural.notInIndex.length > 0) {
      const structuralParts = [];
      if (structural.missingSource.length > 0) structuralParts.push(`缺 source: ${structural.missingSource.length} 张（${structural.missingSource.slice(0, 3).join("、")}）`);
      if (structural.brokenLinks.length > 0) structuralParts.push(`断链: ${structural.brokenLinks.length} 处（${structural.brokenLinks.slice(0, 2).join("；")}）`);
      if (structural.notInIndex.length > 0) structuralParts.push(`未入索引: ${structural.notInIndex.length} 张（${structural.notInIndex.slice(0, 3).join("、")}）`);
      checklistLines.push(`- 结构校验：${structuralParts.join("；")}`);
    }
    if (sections.indexNotAnEntry.length > 0) {
      const rows = sections.indexNotAnEntry.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]（${card.issue}）`);
      checklistLines.push(`- 索引行不合契约（不是 \`- [[stem|一句话]]\` 形式，读者与旧解析器认不出）: ${rows.join("、")}`);
    }
    if (sections.indexWeak.length > 0) {
      const rows = sections.indexWeak.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]]（${card.issue}）`);
      checklistLines.push(`- 索引行说明过弱（读者靠这一行决定要不要打开卡片；写清「什么困难 + 为什么有效 + 具体怎么做」，见本层 _README）: ${rows.join("、")}`);
    }
    if (sections.tooLong.length > 0) {
      const rows = sections.tooLong.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]](${card.lines} 行)`);
      checklistLines.push(`- 卡片过长（正文超过 ${AUDIT_BODY_MAX_LINES} 行；拆成一到两张可复用的原子卡，或把过程挪进 episode）: ${rows.join("、")}`);
    }
    if (sections.tooManyMoves.length > 0) {
      const rows = sections.tooManyMoves.slice(0, 3).map((card) => `[[${card.rel.replace(/\.md$/, "")}|${card.title}]](${card.moves} 个 move)`);
      checklistLines.push(`- 策略卡 move 过多（超过 ${AUDIT_MAX_MOVES} 个：先按触发条件排序，把总是同时出现、或从不触发的移出/另立一张）: ${rows.join("、")}`);
    }
    if (passive.calls > 0) {
      const emptyPct = Math.round((passive.empty / passive.calls) * 100);
      checklistLines.push(`- 检索健康：上次体检以来 ${passive.calls} 次检索，空结果 ${passive.empty} 次（${emptyPct}%）`);
    }
    if (sections.antipatterns.length > 0) checklistLines.push(`- 反模式: ${listOf(sections.antipatterns)}`);
    if (sections.archiveCandidates.length > 0) {
      checklistLines.push(`- 低效用归档候选: ${sections.archiveCandidates.map((c) => `[[${c.rel.replace(/\.md$/, "")}|${c.title}]](${c.utility})`).join("、")}`);
    }
    if (sections.archived.length > 0) checklistLines.push(`- 已自动归档 ${sections.archived.length} 张: ${sections.archived.slice(0, 3).map((a) => a.stem).join("、")}`);
    for (const [label, items] of [["strong", sections.strong], ["weak", sections.weak], ["unused", sections.unused]]) {
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
    if (sections.independentTechniques.length > 0) {
      // Only the techniques that cleared the bar: listing every one-off would be a
      // dump, and the interesting fact is which ones are cross-occasion supported.
      const rows = sections.independentTechniques.slice(0, 5).map((entry) => `${entry.techniques}(${entry.occasions} 个场合)`);
      checklistLines.push(`- 跨场合验证过的技巧（≥${OCCASION_MIN} 个独立场合；这些可以当方法用，一次性的只能当线索）: ${rows.join("、")}`);
    }
    if (structuralDetail.promoteBlocked.length > 0) {
      const rows = structuralDetail.promoteBlocked.map((entry) => `[[${entry.rel.replace(/\.md$/, "")}|${entry.title}]]（${entry.reason}）`);
      checklistLines.push(`- 够格但缺证据、暂不晋升的候选策略卡（补上 source 后会自行晋升）: ${rows.join("；")}`);
    }
  } else {
    checklistLines.push("（尚无记忆卡，无可体检内容）");
  }

  // The routing finding. Stated with the ACTION, because the fix is a decision the
  // model can make from the card's content: move it to the idea layer, or tie it to
  // the problem it actually came from. Outside the `cards.length > 0` branch for the
  // same reason as the note findings below — it is about records, not about the layers
  // that carry statistics.
  // (One line only: an earlier version ALSO pushed this inside the cards branch, so the
  // finding was printed twice — caught by the fixture output, not by an assertion.)
  if (sections.methodologyInRecords.length > 0) {
    const rows = sections.methodologyInRecords.slice(0, 3).map((item) => `[[${item.rel.replace(/\.md$/, "")}|${item.title}]]（${item.reason}）`);
    checklistLines.push(`- 一般性梳理落在了记录层（记录层的内容会被当"已沉淀"引用，而同类内容放 inbox 才会带"待打磨"标记）: ${rows.join("；")}${sections.methodologyInRecords.length > 3 ? ` … 共 ${sections.methodologyInRecords.length} 条` : ""}——逐条判断：它本该是一条 idea（移进 inbox/），还是确实服务于某道题（那就补上它关联的笔记）？`);
  }

  // ── note scope ───────────────────────────────────────────────────────────────
  // Rendered OUTSIDE the `cards.length > 0` branch on purpose. The theorem index is
  // the user's own artifact and predates (or outlives) any memory card, so gating
  // these findings behind "has cards" would hide exactly the case they exist for: a
  // fresh vault whose index already mislabels a theorem. (Caught by the gate below —
  // the first version of this code did gate them, and the assertion for it failed.)
  //
  // `noteClaims` is stated before `noteIndexUnresolved` because its reach is wider:
  // the index is what both the reader and the agent trust when deciding whether a
  // result may be relied on.
  if (sections.noteClaims.length > 0) {
    const rows = sections.noteClaims.slice(0, 3).map((item) => `${item.name} → [[${item.carrier.replace(/\.md$/, "")}]]（${item.reason}）`);
    checklistLines.push(`- 定理索引与载体矛盾（索引写"已证"，载体自己没认可，逐条读后改索引或补证明）: ${rows.join("；")}${sections.noteClaims.length > 3 ? ` … 共 ${sections.noteClaims.length} 条` : ""}`);
  }
  if (sections.noteIndexUnresolved.length > 0) {
    const rows = sections.noteIndexUnresolved.slice(0, 3).map((item) => `${item.name} → [[${item.target}]]`);
    checklistLines.push(`- 定理索引指向不存在的笔记（读者与 agent 都按名字找，指错了就等于找不到）: ${rows.join("；")}${sections.noteIndexUnresolved.length > 3 ? ` … 共 ${sections.noteIndexUnresolved.length} 条` : ""}`);
  }
  // The routing finding. Stated with the ACTION, because the fix is a decision the
  // model can make from the card's content: move it to the idea layer, or tie it to
  // the problem it actually came from. Outside the `cards.length > 0` branch for the
  // same reason as the note findings below — it is about records, not about the layers
  // that carry statistics.
  if (sections.methodologyInRecords.length > 0) {
    const rows = sections.methodologyInRecords.slice(0, 3).map((item) => `[[${item.rel.replace(/\.md$/, "")}|${item.title}]]（${item.reason}）`);
    checklistLines.push(`- 一般性梳理落在了记录层（记录层的内容会被当"已沉淀"引用，而同类内容放 inbox 才会带"待打磨"标记）: ${rows.join("；")}${sections.methodologyInRecords.length > 3 ? ` … 共 ${sections.methodologyInRecords.length} 条` : ""}——逐条判断：它本该是一条 idea（移进 inbox/），还是确实服务于某道题（那就补上它关联的笔记）？`);
  }

  // Gap markers and notation conflicts (see `scanNoteHygiene`). Both are properties of
  // the user's OWN notes, so they render outside the cards branch like the other note
  // findings.
  if (sections.noteGaps.length > 0) {
    const rows = sections.noteGaps.slice(0, 3).map((item) => `[[${item.rel.replace(/\.md$/, "")}]](${item.count} 处)`);
    checklistLines.push(`- 笔记里自报的未闭合处（待补/待核对）：${rows.join("、")}${sections.noteGaps.length > 3 ? ` … 共 ${sections.noteGaps.length} 篇` : ""}——相关讨论时读原文，能补的补上；补不了就把"未闭合"写在结论旁边，不要让它悄悄变成已证。`);
  }
  // Notes that marked AI-written passages (N-a, C7 的笔记侧对应物). The rule is stated with
  // the finding because this is the one place a model can be told it in-band: a passage under
  // this marker is NOT the user's own statement, so it may be quoted as "the note says" but
  // never as "you wrote/you prefer". Without it the marked and unmarked halves of a mixed
  // note are indistinguishable in the retrieval result (they were until 2026-10-01).
  if (sections.noteAiCompletions.length > 0) {
    const rows = sections.noteAiCompletions.slice(0, 3).map((item) => `[[${item.rel.replace(/\.md$/, "")}]](${item.count} 处)`);
    checklistLines.push(`- 笔记里标记了 AI 补全段落（${rows.join("、")}${sections.noteAiCompletions.length > 3 ? ` … 共 ${sections.noteAiCompletions.length} 篇` : ""}）：标记覆盖的段落**不是用户本人写的**，引用时只能说"笔记里记着"，**不得当作用户原话或已核实结论**；也不要提议把整篇笔记当作可信来源。`);
  }
  if (sections.notationConflicts.length > 0) {
    const rows = sections.notationConflicts.slice(0, 3).map((item) => `「${item.name}」：${item.symbols.join(" / ")}`);
    checklistLines.push(`- 记号同名多套（自动收集自你笔记里的定义句）: ${rows.join("；")}${sections.notationConflicts.length > 3 ? ` … 共 ${sections.notationConflicts.length} 组` : ""}——**只报告不判定**：这可能是混用，也可能是有意按语境区分。在相关讨论时问一次用户，得到答复后写进 profile/notation 的已采纳表；不要自己改用户的记号。`);
  }

  // ── what the audit decided BY ITSELF this pass ───────────────────────────────
  // Stated explicitly, not silently applied: a level change the user did not ask for
  // must be visible, together with the evidence, so it can be disputed.
  if (sections.corroborated.length > 0) {
    const rows = sections.corroborated.slice(0, 5).map((item) => `[[${item.rel.replace(/\.md$/, "")}|${item.title}]]（依据：[[${item.via.replace(/\.md$/, "")}]]）`);
    checklistLines.push(`- 本次由插件升为「与他处互证」（cross-referenced；判定依据是另一份文档里出现了同一 pattern/技巧，证据随行，仍未获用户确认）: ${rows.join("；")}`);
  }
  // The OTHER outcome of the same comparison (C8, 2026-10-01): a name-match whose document
  // shares an upstream with the card is one source restated twice, so it does NOT count as
  // a second witness. Stated explicitly because "nothing happened" and "we deliberately
  // refused to count it" must not look the same to a reader.
  if (sections.corroborationRepetitions.length > 0) {
    const rows = sections.corroborationRepetitions.slice(0, 5).map((item) =>
      `[[${item.rel.replace(/\.md$/, "")}|${item.title}]]（同源：${item.sharedWith.slice(0, 2).join("、")}）`);
    checklistLines.push(`- 相关重复、不计票（匹配到的文档与本卡共享上游，属同一来源的复述，不构成独立共证，` +
      `因此**不**升级）：${rows.join("；")}——要有第二票，需要一份不共享上游的来源。`);
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
    if (!ledgerSummary.disabled && ledgerSummary.carriedCount > 0) {
      // Plain language, no identifiers: the fact the user needs is "this is not new".
      const oldest = (ledgerResult.carriedEntries ?? []).reduce((min, entry) => (min === "" || entry.firstSeen < min ? entry.firstSeen : min), "");
      humanLines.push(`🗂 有 ${ledgerSummary.carriedCount} 项体检建议此前就已经提出、今天仍然成立${oldest === "" ? "" : `（最早 ${oldest}）`}——助手不会再把它们当新问题报一遍。`);
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
  } else if (sections.noteClaims.length === 0 && sections.noteIndexUnresolved.length === 0) {
    humanLines.push("（还没有记忆卡，暂时没有可体检的内容。）");
  }

  // Note scope, outside the card branch for the same reason as the checklist: the
  // theorem index is the user's own artifact and must be audited whether or not any
  // memory card exists yet.
  if (sections.noteClaims.length > 0) {
    const names = sections.noteClaims.slice(0, 3).map((item) => `「${item.name}」（${item.reason}）`).join("、");
    humanLines.push(`🧾 定理索引里有 ${sections.noteClaims.length} 条写着"已证"，但它们指向的笔记自己并不认可：${names}${sections.noteClaims.length > 3 ? " …" : ""}——索引是你和助手判断"这条能不能用"的入口，盖错章会被下游一直沿用。`);
  }
  if (sections.noteIndexUnresolved.length > 0) {
    const names = sections.noteIndexUnresolved.slice(0, 3).map((item) => `「${item.name}」→ ${item.target}`).join("、");
    humanLines.push(`🔗 定理索引里有 ${sections.noteIndexUnresolved.length} 条指向不存在的笔记：${names}——按名字找不到就等于这条定理没登记。`);
  }
  if (sections.methodologyInRecords.length > 0) {
    const names = sections.methodologyInRecords.slice(0, 3).map((item) => `「${item.title}」`).join("、");
    humanLines.push(`📥 有 ${sections.methodologyInRecords.length} 条"一般性梳理"被记进了**记录层**（会以"已沉淀的事实"身份被引用）：${names}${sections.methodologyInRecords.length > 3 ? " …" : ""}——同类内容放进想法层时系统会标注"待打磨"，放这里则不会。助手会在相关讨论时判断它们该移进想法层，还是确实服务于某道题（那就补上关联的笔记）。`);
  }
  if (sections.noteGaps.length > 0) {
    const names = sections.noteGaps.slice(0, 3).map((item) => `「${item.rel.split("/").pop().replace(/\.md$/, "")}」(${item.count} 处)`).join("、");
    humanLines.push(`🚧 你笔记里有 ${sections.noteGaps.length} 篇标着"待补/待核对"（共 ${noteHygiene.gapTotal} 处）：${names}${sections.noteGaps.length > 3 ? " …" : ""}——这些是你自己记下的未闭合处，助手在相关讨论时会先看它们。`);
  }
  if (sections.noteAiCompletions.length > 0) {
    const names = sections.noteAiCompletions.slice(0, 3).map((item) => `「${item.rel.split("/").pop().replace(/\.md$/, "")}」(${item.count} 处)`).join("、");
    humanLines.push(`🤖 有 ${sections.noteAiCompletions.length} 篇笔记标出了 AI 补全的段落（共 ${noteHygiene.aiMarkedTotal} 处）：${names}${sections.noteAiCompletions.length > 3 ? " …" : ""}——这些段落**不是你自己写的**，助手会按"笔记里的说法"引用，不会说成"你说过"；你复核过之后可以把标记去掉（去掉就等于认可）。`);
  }
  if (sections.notationConflicts.length > 0) {
    const names = sections.notationConflicts.slice(0, 3).map((item) => `「${item.name}」(${item.symbols.join(" / ")})`).join("、");
    humanLines.push(`🔤 自动收集到 ${sections.notationCollected} 条记号定义，其中 ${sections.notationConflicts.length} 组**同名多套记号**：${names}${sections.notationConflicts.length > 3 ? " …" : ""}——可能是有意按语境区分，也可能是混用，只有你知道；已写进 \`.deepseek/memory/notation.md\` 的自动块，你回一句就定案。`);
  }
  // What the plugin upgraded on its own. Reported so the user can dispute it — an
  // automatic level change that shows up nowhere would be exactly the "the system
  // decided something about my notes and never said so" failure.
  if (sections.corroborated.length > 0) {
    const names = sections.corroborated.slice(0, 3).map((item) => `「${item.title}」（依据 ${item.via}）`).join("、");
    humanLines.push(`⚖️ 本次把 ${sections.corroborated.length} 张卡从"单次来源"升为"与他处互证"：${names}${sections.corroborated.length > 3 ? " …" : ""}——依据是另一份文档里出现了同一个模式或技巧；这只是自动比对的结果，仍不等于你确认过，随时可以点 ❌ 推翻。`);
  }
  // Card provenance (C7). Two things the user cannot learn from anywhere else: a card
  // claiming to be their own words (which this vault has no way to authenticate), and a
  // card whose writer is simply unknown. Stated in plain language, with the consequence
  // spelled out, because the consequence is the whole point of the field.
  if (structural.unauthorizedOrigin.length > 0) {
    const names = structural.unauthorizedOrigin.slice(0, 3).map((item) => `「${item.split("（")[0].split("/").pop().replace(/\.md$/, "")}」`).join("、");
    humanLines.push(`🏷 有 ${structural.unauthorizedOrigin.length} 张卡把自己的来源写成了一个系统无法证实的值（例如"你说过"）：${names}${structural.unauthorizedOrigin.length > 3 ? " …" : ""}——本地笔记库是纯文本、没有认证通道，所以"这是用户原话"这种声明只能由你本人确认，助手不会把它当事实引用。`);
  }
  if (sections.originUnknown.length > 0) {
    const names = sections.originUnknown.slice(0, 3).map((card) => `「${card.title}」`).join("、");
    humanLines.push(`❔ 还有 ${sections.originUnknown.length} 张卡身份的来源没有记录（多数是插件开始登记来源之前就存在的卡）：${names}${sections.originUnknown.length > 3 ? " …" : ""}——助手引用它们时会按"来源不明"处理：可以说"笔记里记着"，不会说"你说过"。`);
  }
  // The other outcome of the same comparison (C8): not counting a match is a decision, and
  // a decision the user cannot see is indistinguishable from a bug.
  if (sections.corroborationRepetitions.length > 0) {
    const names = sections.corroborationRepetitions.slice(0, 3).map((item) => `「${item.title}」`).join("、");
    humanLines.push(`🔁 另有 ${sections.corroborationRepetitions.length} 张卡虽然"别处也提到了同一个模式"，但那两处共用同一个出处，属于同一来源的复述，所以没有算作"互证"：${names}${sections.corroborationRepetitions.length > 3 ? " …" : ""}——重复出现不等于独立佐证。`);
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
      indexWeak: indexWeakRels.size,
      indexNotAnEntry: indexNotAnEntryRels.size,
      tooLong: structural.tooLong.length,
      tooManyMoves: structural.tooManyMoves.length,
      unjustifiedUpgrade: structural.unjustifiedUpgrade.length,
      usesMismatch: structural.usesMismatch.length,
      // Card provenance (C7): declarations the host cannot back, and cards whose writer it
      // could not pin down at all. Both are counts of CARDS, so a panel can show them
      // beside `unjustifiedUpgrade`.
      unauthorizedOrigin: structural.unauthorizedOrigin.length,
      originUnknown: sections.originUnknown.length,
      hubs: hubCards.length,
      downstream: sections.downstreamReview.length
    },
    // The names behind the structural counts (the checklist quotes a few; the
    // panels/CLI can list them all without re-running the scan).
    structuralDetail,
    // Legacy flat fields (audit schema v1 readers: dsh/host/memory-admin.mjs and
    // older panels). Same arrays as `sections`, minus the archived ones.
    antipatterns: sections.antipatterns.map((card) => card.rel),
    archiveCandidates: sections.archiveCandidates.map((card) => ({ rel: card.rel, title: card.title, utility: card.utility })),
    pendingReview: sections.pendingReview.map((card) => card.rel),
    autoArchiveTargets: sections.autoArchiveTargets.map((card) => ({ rel: card.rel, filePath: card.filePath, title: card.title })),
    archived: sections.archived.map((item) => item.rel),
    passive,
    // Cross-run recommendation record (docs/memory/design.md §8.1). Deliberately
    // carries counts and the path only — the panels render their own text.
    ledger: {
      path: ledgerSummary.path,
      today: ledgerSummary.today,
      newCount: ledgerSummary.newCount,
      carriedCount: ledgerSummary.carriedCount,
      written: ledgerSummary.written,
      truncated: ledgerSummary.truncated,
      disabled: ledgerSummary.disabled,
      firstSeenMin: (ledgerResult.carriedEntries ?? []).reduce((min, entry) => (min === "" || entry.firstSeen < min ? entry.firstSeen : min), "")
    },
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

/**
 * Digest an append-only `index.md` by keeping the NEWEST list lines within budget.
 *
 * Why the tail, and why one helper (2026-09-21). The three layer indexes
 * (`records/`, `templates/`, `episodes/`) are written the same way — a new line is
 * appended when a card is created — so "what exists and what changed" is at the
 * BOTTOM. `episodeIndexDigest` had always kept the tail for exactly this reason,
 * but `recordIndexDigest` and `templateIndexDigest` clipped the joined lines
 * head-first, so once a layer outgrew its budget the newest cards vanished from the
 * injected map while the oldest ones stayed. Measured on a growth-shaped fixture:
 * 40 record lines against a budget of 800 kept `rec-1` and dropped `rec-40`.
 *
 * Three copies of one rule is how the two diverged in the first place, so the rule
 * lives here once.
 */
/** Evidence marker per level — the SAME vocabulary the panel renders (`VERIFIED_BADGES` in index.jsx). */
const INDEX_EVIDENCE_MARK = { "user-confirmed": "✅", "cross-referenced": "⚖️", "single-source": "❓" };

/**
 * stem → card file for one layer. Cards may sit in type subdirectories, so walk the layer
 * once instead of guessing `<stem>.md` at its root (a wrong guess would mark everything ❓).
 */
function cardFilesByStem(dir) {
  const map = new Map();
  const walk = (current) => {
    let items = [];
    try {
      items = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      if (!item.name.endsWith(".md") || item.name === "index.md" || item.name === "_README.md") continue;
      const stem = item.name.slice(0, -3);
      if (!map.has(stem)) map.set(stem, full);
    }
  };
  walk(dir);
  return map;
}

/**
 * Card metadata for one injected index line: the evidence level (P2) plus what contradiction
 * detection needs (P5-A) — the line's own one-liner and the card's hook signature.
 *
 * WHY one reader for both (2026-09-26): the digest reads the card file once per line; paying for a
 * second pass just to get `hook.pattern` would double the file reads for every injected line. The
 * FAIL-CLOSED rule of P2 still lives in `evidenceMarkOf`: missing / unreadable / unrecognized
 * `verified` ⇒ ❓, because the least evidenced item must never look cleanest.
 */
function indexLineCardInfo(stemFiles, line) {
  const hit = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(line);
  if (hit === null) return null;
  const stem = hit[1].trim();
  const title = (hit[2] ?? stem).trim();
  const file = stemFiles.get(stem) ?? stemFiles.get(stem.split("/").pop());
  let verified = null;
  let hook = { pattern: "", techniques: [] };
  if (file !== undefined) {
    try {
      const front = readFrontmatter(readFileSync(file, "utf8"));
      const found = /(?:^|\n)\s*verified:\s*["']?(user-confirmed|cross-referenced|single-source)["']?/.exec(front ?? "");
      verified = found === null ? null : found[1];
      // ⚠️ No `$` here without the `m` flag: `$` would then mean "end of the whole frontmatter", so a
      // `pattern:` line in the middle silently matched nothing (caught by the injection test).
      const pattern = /(?:^|\n)\s*pattern:\s*["']?([^"'\n]+?)["']?\s*(?:\n|$)/.exec(front ?? "");
      // `techniques` is parsed inside its own block only, so a `related:`/`source:` bullet list cannot
      // masquerade as a signature (a false signature would invent contradictions).
      const block = /(?:^|\n)\s*techniques:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/.exec(front ?? "");
      const techniques = block === null
        ? []
        : [...block[1].matchAll(/-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((m) => m[1].trim());
      hook = { pattern: pattern === null ? "" : pattern[1].trim(), techniques };
    } catch {
      verified = null;
      hook = { pattern: "", techniques: [] };
    }
  }
  return { stem, title, verified, hook };
}

/** The panel's evidence vocabulary, fail-closed (see `indexLineCardInfo`). */
function evidenceMarkOf(info) {
  if (info === null) return "";
  return " " + (INDEX_EVIDENCE_MARK[info.verified] ?? "❓");
}

/**
 * Section-level provenance note for the WHOLE-FILE layers (profile / notation / topics).
 *
 * Those files are injected as one block, so they cannot carry the per-card ✅/⚖️/❓ marks that
 * index lines get (P2). The honest fallback is a statement in the section title: if the file
 * carries no user-confirmation trace at all, say so — otherwise the model reads a file full of
 * AI summaries as if it were the user's own settled position.
 */
function unconfirmedSectionNote(text) {
  const confirmed = /(?:^|\n)\s*(?:verified:\s*["']?user-confirmed|verified_by:\s*["']?user["']?)/.test(text);
  return confirmed ? "" : "；其中含 AI 归纳，未经你逐条确认，按\"笔记里的说法\"引用";
}

function appendOnlyIndexDigest(root, relativePath, maxChars, withEvidenceMarks = false) {
  const path = join(root, ...relativePath);
  const stemFiles = withEvidenceMarks ? cardFilesByStem(dirname(path)) : null;
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text === "") return "";
    const items = text.split("\n").filter((line) => line.trim().startsWith("-"));
    if (items.length === 0) return clip(text, maxChars);
    // Newest at the bottom: walk backwards, stop when the next line would not fit.
    const kept = [];
    let used = 0;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const base = clip(items[i].trim(), maxChars);
      const info = stemFiles === null ? null : indexLineCardInfo(stemFiles, base);
      // The marker is PART of the line's budget: it is injected text, not metadata.
      const clean = base + evidenceMarkOf(info);
      if (used + clean.length > maxChars) break;
      kept.push({ clean, info });
      used += clean.length + 1;
    }
    if (kept.length === 0) {
      const last = clip(items[items.length - 1].trim(), maxChars);
      return last + evidenceMarkOf(stemFiles === null ? null : indexLineCardInfo(stemFiles, last));
    }
    kept.reverse();
    // P5-A: mark contradictions BETWEEN the kept lines, so the model is told "these two disagree"
    // instead of being handed both as if both were true. The mark is added AFTER the budget walk,
    // because a pair is only knowable once every kept line is — so a conflicting line may exceed its
    // tier by ~15 characters. That is deliberate: the hard cap (MAX_TOTAL_MEMORY_CHARS) is nowhere near
    // (measured 4088/18000), pairs are capped at 10, and trap 47 says boundary gating must SPEAK
    // rather than drop something quietly.
    if (stemFiles !== null && kept.length > 1) {
      const cards = kept.filter((entry) => entry.info !== null).map((entry) => ({
        rel: entry.info.stem,
        title: entry.info.title,
        status: "active",
        hook: entry.info.hook
      }));
      for (const pair of findContradictions(cards)) {
        for (const entry of kept) {
          if (entry.info === null) continue;
          if (entry.info.stem === pair.a) entry.clean += ` ⚠️与[[${pair.b}]]矛盾`;
          else if (entry.info.stem === pair.b) entry.clean += ` ⚠️与[[${pair.a}]]矛盾`;
        }
      }
    }
    return kept.map((entry) => entry.clean).join("\n");
  } catch {
    return "";
  }
}

/** Episode timeline: keep the newest lines (list items only) within budget. */
function episodeIndexDigest(root, maxChars) {
  return appendOnlyIndexDigest(root, [MEMORY_DIR, "memory", "episodes", "index.md"], maxChars);
}

/** Typed atomic-record digest: keep the newest index lines within budget, each with its evidence mark. */
function recordIndexDigest(root, maxChars) {
  return appendOnlyIndexDigest(root, [MEMORY_DIR, "memory", "records", "index.md"], maxChars, true);
}

/** Problem-template index digest (personal template-theorems graph), each line with its evidence mark. */
function templateIndexDigest(root, maxChars) {
  return appendOnlyIndexDigest(root, [MEMORY_DIR, "memory", "templates", "index.md"], maxChars, true);
}

// ── the section composer ────────────────────────────────────────────────────
/**
 * Render the layered memory section for one agent.
 *
 * Layout follows the paper's routing philosophy: stable semantics + topic
 * navigation + inbox/episode timelines are always injected (coarse layers);
 * raw episodic evidence is left on disk for note_recall discovery and targeted
 * grep/read verification (fine layer). Past
 * dialogue cues are capped at a few Q/A pairs to keep the prompt bounded.
 * `context.agent` supplies the current session id so the live conversation is
 * never duplicated into the "past dialogue" index.
 */
export function buildMemorySection({ vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs, budgets = BUDGET_TIERS.standard }, currentSessionId, dialogueIndex, auditReport, memoText) {
  const profile = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "profile.md"), budgets.profile);
  const topics = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "topics", "index.md"), budgets.topics);
  const records = recordIndexDigest(vaultRoot, budgets.records);
  const templates = templateIndexDigest(vaultRoot, budgets.templates);
  const episodes = episodeIndexDigest(vaultRoot, budgets.episodes);
  const memos = memoText ?? memoDigest(vaultRoot, budgets.inbox);

  const lines = [
    "## 分层长期记忆（由 math-memory 自动注入；导航层在此，证据层在磁盘）",
    "",
    "记忆按 arXiv:2606.24775 与 arXiv:2607.05794 的原则组织为五层：profile=语义层，topics=导航层，" +
    "records=类型化原子记录层，episodes=原始证据层，inbox=想法层；另有三个在五层之后长出来的检索面：" +
    "theorems=定理索引（个人 Matlas）、templates=问题模板库、strategy=策略层（方法卡：困难 → 策略 → 检索目标）。" +
    "以下内容用于“知道去哪找”，不要当作完整证据。回答细节问题时必须按路由规则读文件：",
    "- 找内容一律先用 `note_recall`（内容发现的唯一入口），命中后读前 2-3 篇全文核实；`grep` **不是检索器**，只在「已经知道是哪个文件、要核对原话/字面字符串/行号」时用，不得用它对 vault 或 `.deepseek` 做全库扫描找内容；",
    "- 精确事实 / 用户原话 / 日期数字 → `note_recall` 先定位（记忆卡 / episode 索引 / 主题），再读命中文件；确认某文件里是否真有这句话时才在该文件上 grep；",
    "- 类型化记忆记录（fact/event/instruction/preference；索引行尾带证据分级 ✅/⚖️/❓，**❓ 的按\"笔记里的说法\"引用，不得当作已核实事实**）→ 先看 `.deepseek/memory/records/index.md`，再 `note_recall`（或读）具体记录，记录里的 source 可回原始证据；",
    "- 相关定理 / 命题 / 引理 → 先看 `.deepseek/memory/theorems/index.md`，再 `note_recall` 命中相关笔记并核对适用性；",
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
      // Memory cards need an OPEN template too (2026-09-21). The note template above
      // only ever covered notes, so a model that referenced a card either wrote a bare
      // path (unclickable) or generalised the note rule into
      // `/open?path=.deepseek/…` (silently dead: the vault index excludes dot-folders,
      // so openLinkText cannot resolve it). The plugin now routes `.deepseek/` to its
      // in-panel preview, and this line is what makes the model actually emit it.
      `- 引用记忆卡时，**卡标题同样写成可点击链接**：[卡标题](${linkBaseUrl}/open?path=<卡路径>${tokenSuffix})（与笔记同一种写法）；点击会在 Obsidian 里用记忆预览打开该卡。`,
      "  末尾的反馈行也请用它：把「依据的记忆：」后面的卡标题写成上面那个链接，而不是纯文本路径——纯文本在回复里点不开，用户只能自己去找。",
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
    // 固化闸门（2026-10-01，用户拍板；证据 Zhang et al. arXiv:2605.12978 Table 5）。
    // 放在 INJECTED 文本里而不是只写在 vault 的 AGENTS.md 里，是因为那份协议是**安装进
    // 用户 vault 的副本**：老 vault 不重装就吃不到新规则，而这条规则管的是**每轮**行为。
    // 同一句话也写在 `dsh/templates/vault-AGENTS.md`（给新安装的库），两处由
    // `scripts/test-memory.mjs` 的断言钉住（改一处忘另一处会红）。
    "- **⚠️ 固化是显式动作，不是每轮例行动作**：没有用户同意，**不要**把本轮内容固化成 records/topics/templates/strategy 的卡或行。默认执行方式＝**先问**（与上面的捕获提问**合并成一次**，不增加弹窗）；只有 ① 用户当场明确要求记录/整理，或 ② 捕获档位/profile 给过长期授权，才可直接写。**「没写」不是失败**——整场对话原文由确定性会话捕获进 episodes，跳过固化的代价只是「这次没有新增抽象」。文献实测：每轮固化会让记忆越写越差（就地改写旧条目最伤、写新内容时旧抽象可见是最大一跳），所以固化应当被**请求**，而不是例行触发。",
    captureText === "" ? "- （策略文件缺失，按默认档位 idea=ask / fact=ask / preference=ask / structure=auto 执行——写入记录内容前一律先征得同意；结构层只补索引。）" : "- 用户口头指令优先于策略文件。"
  );

  if (profile !== "") {
    lines.push("", `### 用户画像与偏好（.deepseek/memory/profile.md；**是笔记里的说法，不是事实**${unconfirmedSectionNote(profile)}）`, "", profile);
  } else {
    lines.push("", "### 用户画像与偏好", "", "（尚未建立。按 AGENTS.md 在首次对话后创建 .deepseek/memory/profile.md。）");
  }

  // Notation system: always relevant (like the profile), injected bounded.
  // The full ledger lives at .deepseek/memory/notation.md; maintenance rules
  // are in AGENTS.md (收集→统一→维护).
  const notation = readMemoryFile(vaultRoot, join(MEMORY_DIR, "memory", "notation.md"), budgets.notation);
  if (notation !== "") {
    lines.push("", `### 记号体系（.deepseek/memory/notation.md；**是笔记里采纳的记号，不是外部事实**；收集→统一→维护，回复时遵循已采纳记号，发现不一致按 AGENTS.md 提议统一${unconfirmedSectionNote(notation)}）`, "", notation);
  }

  if (topics !== "") {
    lines.push("", `### 研究主题索引（.deepseek/memory/topics/index.md；**是笔记里的说法，不是事实**${unconfirmedSectionNote(topics)}）`, "", topics);
  } else {
    lines.push("", "### 研究主题索引", "", "（尚未建立。按 AGENTS.md 在 .deepseek/memory/topics/index.md 维护主题条目。）");
  }

  if (records !== "") {
    lines.push("", "### 记忆记录摘要（.deepseek/memory/records/index.md；每行尾的 ✅ 你确认过 / ⚖️ 与他处互证 / ❓ 单次来源是你的证据分级，**❓ 的条目按\"笔记里的说法\"引用，不得当作已核实事实**）", "", records);
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
      if (used + budget > budgets.dialogue) break;
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
      lines.push("", "### 近期跨会话问答线索（最多 6 组，细节请 note_recall 定位后读文件，必要时再 grep 该文件）", "");
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
  // The checklist has always PRINTED "台账已关闭（auditMaintainLedger: false）" — but nothing ever
  // set that switch: the audit read `helpers.maintainLedger`, which only tests inject, so the
  // documented config field was inert and the disabled branch was unreachable from config
  // (docs/note-noise-and-memory-fidelity-2026-09-26.md P3; trap 80: a documented promise with no
  // execution point). Same shape as `auditMaintainHookStats` beside it: config → helpers.
  const auditMaintainLedger = config.auditMaintainLedger !== false;
  // Card origin (C7/N1): writing `origin` into the card and recording the host's
  // first-sight row in `cache/card-origin.jsonl` is one behaviour, so it has one switch.
  // Same shape as `auditMaintainHookStats`/`auditMaintainLedger` above: config → helpers.
  const auditMaintainOrigin = config.auditMaintainOrigin !== false;
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
  // Injection budget tier. An unrecognised value falls back to `standard` rather than
  // throwing: a typo in a config file must not take the whole preset down, and the
  // safe direction here is "the behaviour that existed before tiers did".
  // Injection budget tier. Precedence matters and is the whole reason this is not
  // resolved here: an EXPLICIT `budget` in the preset config wins, otherwise the tier
  // comes from the vault's `.deepseek/memory/config.md` (written by the settings page),
  // otherwise `standard`. The vault read needs the vault root, which is per-agent and
  // not known yet at plugin-construction time, so we only record whether the config
  // was explicit and let `budgetsFor` finish the job.
  const budgetExplicit = Object.prototype.hasOwnProperty.call(BUDGET_TIERS, String(config.budget));
  const budgetTier = budgetExplicit ? String(config.budget) : "standard";
  const budgets = BUDGET_TIERS[budgetTier];
  if (!isAbsolute(sessionsRoot)) throw new TypeError("math-memory: sessionsRoot must be an absolute path");
  return { vaultRoot, sessionsRoot, maxHistoryEntries, maxHistoryChars, cacheTtlMs, auditEnabled, dialogueIndexEnabled, remindersEnabled, auditMaintainHookStats, auditMaintainLedger, auditMaintainOrigin, autoArchive, sessionCapture, captureSubagents, auditIntervalMs, budgetTier, budgetExplicit, budgets };
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
      report = buildAuditReport(vaultRoot, { ...this.#helpers, maintainHookStats: config.auditMaintainHookStats, maintainLedger: config.auditMaintainLedger, maintainOrigin: config.auditMaintainOrigin, autoArchive });
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
      const memoText = memoDigest(vaultRoot, budgetsFor(config, ws).inbox, query, this.#helpers, ws.reminders ?? config.remindersEnabled);
      return buildMemorySection({ ...config, vaultRoot, budgets: budgetsFor(config, ws) }, currentSessionId, dialogueIndex, auditReport, memoText);
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

  // Apply the dedicated note tools (note_recall / note_strategy / note_create /
  // note_links) on the same context — reuse the module imported above.
  // This file is always refreshed on upgrade, so existing installations pick
  // the tools up even though agent.cordis.yml preserves user edits. The
  // sibling module resolves `defineTool` through the harness loader, so it
  // works from any $DSH_HOME location.
  await notes.apply(ctx, config?.notes ?? {});
}
