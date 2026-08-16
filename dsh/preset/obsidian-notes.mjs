/**
 * obsidian-notes — dedicated Obsidian note tools for the `obsidian` dsh agent
 * preset:
 *   - note_search    full-text / tag-filtered search across vault notes
 *   - note_create    create a new note; refuses to overwrite an existing one
 *   - note_links     backlink (wikilink) queries
 *   - note_retrieve  memory-v2 two-stage strategy retrieval over cards that
 *                    carry a "hook:" frontmatter block (ISM-style feature hook:
 *                    operator hard filter + weighted soft scoring), with a
 *                    full-text token-ranking fallback; records hits into the
 *                    plugin-owned cache at .deepseek/cache/retrieval-stats.json
 *
 * Registered through `defineTool` from @deepseek-ai/dsh-tools, following the
 * same pattern as the dsh-obsidian-assistant reference plugin. Every touch of
 * a USER NOTE goes through the harness `ctx.fs` service so the profile's
 * workspace-write sandbox and fail-closed approval stay authoritative. The
 * only raw Node fs usage below is the plugin-owned retrieval-stats cache
 * under .deepseek/cache/ (the same convention as obsidian-memory.mjs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const name = "obsidian-notes";
export const inject = ["tools", "fs", "systemPrompt", "loader"];

/**
 * Load `defineTool` without a static bare import. A local agent-preset plugin
 * lives under `$DSH_HOME/.agent-presets/obsidian/`, where Node's ordinary ESM
 * resolution cannot see the harness's `node_modules`; static
 * `import "@deepseek-ai/dsh-tools"` would fail for almost every user. The
 * harness loader resolves bare specifiers from the host composition instead
 * (the same mechanism preset rows like `@deepseek-ai/dsh-tool-fs` use), so we
 * ask it for the module once at apply time.
 */
async function loadDefineTool(ctx) {
  const internal = ctx.loader?.internal;
  if (typeof internal?.import === "function") {
    // The profile directory is the correct resolution anchor: app-boot heals
    // `$DSH_HOME/profiles/node_modules` with links to every dsh package, while
    // `ctx.loader.ctx.baseUrl` points at the preset directory and cannot see
    // `@deepseek-ai/dsh-tools`.
    const base = ctx.root?.baseUrl ?? ctx.loader?.ctx?.baseUrl ?? ctx.baseUrl;
    if (base === undefined) {
      throw new Error("obsidian-notes: cannot resolve the harness module base (ctx.root.baseUrl is unset)");
    }
    const module = await internal.import("@deepseek-ai/dsh-tools", base, {});
    if (typeof module.defineTool !== "function") {
      throw new Error("obsidian-notes: @deepseek-ai/dsh-tools did not export defineTool");
    }
    return module.defineTool;
  }
  // Bare-Node fallback (smoke tests): normal resolution from this file.
  const module = await import("@deepseek-ai/dsh-tools");
  if (typeof module.defineTool !== "function") {
    throw new Error("obsidian-notes: @deepseek-ai/dsh-tools did not export defineTool");
  }
  return module.defineTool;
}

const DEFAULT_MAX_RESULTS = 50;
const HARD_MAX_RESULTS = 200;
const DEFAULT_MAX_NOTE_BYTES = 1024 * 1024;
const DEFAULT_EXCLUDE_PATTERNS = [".obsidian", ".trash", ".git", "node_modules"];

function positiveInteger(value, fallback, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`obsidian-notes: ${label} must be a positive integer`);
  }
  return number;
}

function normalizeConfig(config) {
  const raw = config ?? {};
  return {
    vaultRoot: typeof raw.vaultRoot === "string" ? raw.vaultRoot.trim() : "",
    maxSearchResults: positiveInteger(raw.maxSearchResults, DEFAULT_MAX_RESULTS, "maxSearchResults"),
    maxNoteBytes: positiveInteger(raw.maxNoteBytes, DEFAULT_MAX_NOTE_BYTES, "maxNoteBytes"),
    excludePatterns: Array.isArray(raw.excludePatterns)
      ? raw.excludePatterns.filter((pattern) => typeof pattern === "string" && pattern.trim() !== "").map((pattern) => pattern.trim())
      : DEFAULT_EXCLUDE_PATTERNS
  };
}

// ── vault resolution ────────────────────────────────────────────────────────

/** Resolve the vault the tools act on: preset config, DSH_OBSIDIAN_VAULT, session cwd. */
function vaultRootFor(exec, config) {
  const fromConfig = config.vaultRoot;
  const fromEnv = (process.env.DSH_OBSIDIAN_VAULT ?? "").trim();
  const session = exec?.agent?.session;
  const cwd = typeof session?.header?.cwd === "string"
    ? session.header.cwd
    : typeof session?.cwd === "string" ? session.cwd : "";
  const raw = fromConfig || fromEnv || cwd;
  if (raw === "") {
    throw new Error("obsidian-notes: cannot determine the vault directory; set DSH_OBSIDIAN_VAULT or configure vaultRoot in the preset.");
  }
  if (!isAbsolute(raw)) {
    throw new Error(`obsidian-notes: vaultRoot must be an absolute path, got ${JSON.stringify(raw)}`);
  }
  return resolve(raw);
}

async function resolveVault(ctx, exec, config) {
  const rootPath = vaultRootFor(exec, config);
  const rootTarget = await ctx.fs.resolve(rootPath, { signal: exec?.signal });
  const info = await ctx.fs.stat(rootTarget, exec?.signal);
  if (info === undefined) throw new Error(`obsidian-notes: vault root not found: ${rootPath}`);
  if (info.type !== "directory") throw new Error(`obsidian-notes: vault root is not a directory: ${rootPath}`);
  return { rootPath, rootTarget };
}

function requireInsideVault(ctx, rootTarget, target) {
  if (!ctx.fs.contains(rootTarget, target)) {
    throw new Error(`obsidian-notes: path escapes the vault: ${target.displayPath}`);
  }
}

// ── exclusion glob (simple `*` wildcard, like the reference plugin) ──────────

function globMatch(pattern, value) {
  const pat = pattern.replace(/\\/g, "/");
  const val = value.replace(/\\/g, "/");
  if (!pat.includes("*")) return val === pat || val.startsWith(`${pat}/`);
  const expression = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${expression}$`).test(val);
}

function isExcluded(name, relDir, patterns) {
  const full = relDir === "" ? name : `${relDir}/${name}`;
  return patterns.some((pattern) => globMatch(pattern, name) || globMatch(pattern, full));
}

// ── note discovery / parsing ────────────────────────────────────────────────

async function listNotes(ctx, rootTarget, signal, excludePatterns, extraExcludeDirs = []) {
  const notes = [];
  const seenDirectories = new Set();

  async function walk(target, relDir) {
    if (seenDirectories.has(target.targetKey)) return; // symlink-cycle guard
    seenDirectories.add(target.targetKey);
    const entries = await ctx.fs.listDir(target, signal);
    for (const entry of entries) {
      if (entry.type === "directory") {
        if (isExcluded(entry.name, relDir, excludePatterns)) continue;
        if (extraExcludeDirs.includes(entry.name)) continue;
        if (!ctx.fs.contains(rootTarget, entry.target)) continue;
        await walk(entry.target, relDir === "" ? entry.name : `${relDir}/${entry.name}`);
      } else if (entry.type === "file" && entry.name.toLowerCase().endsWith(".md")) {
        if (isExcluded(entry.name, relDir, excludePatterns)) continue;
        if (!ctx.fs.contains(rootTarget, entry.target)) continue;
        const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
        notes.push({ path: rel, name: rel.slice(0, -3), target: entry.target });
      }
    }
  }

  await walk(rootTarget, "");
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes;
}

/** Split leading YAML frontmatter from the note body. */
function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { frontmatter: null, body: raw };
  const close = raw.indexOf("\n---", 3);
  if (close < 0) return { frontmatter: null, body: raw };
  const frontmatter = raw.slice(3, close).replace(/^\r?\n/, "");
  const body = raw.slice(close + 4).replace(/^\r?\n/, "");
  return { frontmatter, body };
}

// ── memory v2: feature-hook parsing (informed by arXiv:2606.31191, ISM) ─────

/**
 * Parse a card's optional `hook:` frontmatter block into retrieval features.
 * Block style only (flow-style `hook: { ... }` is ignored; the audit pass in
 * obsidian-memory.mjs writes uses/last_used back in block style).
 *
 *   hook:
 *     operator: number-theory
 *     pattern: subsequence_argument
 *     heuristics:
 *       - decompose
 *     quantity: sum-of-independent-rvs
 *     techniques:
 *       - borel-cantelli
 *     applications: 证明 a.s. 收敛类问题
 *     uses: 7
 *     success_rate: 0.86
 *     last_used: 2026-08-16
 *     verified: user-confirmed
 */
export function parseHookFrontmatter(text) {
  if (typeof text !== "string" || text === "") return null;
  const lines = text.split(/\r?\n/);
  const hook = {};
  let inHook = false;
  let lastListKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inHook) {
      if (/^hook:\s*$/.test(trimmed)) { inHook = true; lastListKey = null; }
      continue;
    }
    if (line !== "" && !/^\s/.test(line)) break; // left the hook block
    if (trimmed === "") continue;
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (pair !== null) {
      const key = pair[1];
      const value = pair[2].trim();
      if (value === "") { hook[key] = []; lastListKey = key; }
      else if (value.startsWith("[") && value.endsWith("]")) {
        hook[key] = value.slice(1, -1).split(",").map((part) => stripQuotes(part.trim())).filter((part) => part !== "");
        lastListKey = null;
      } else { hook[key] = stripQuotes(value); lastListKey = null; }
    } else if (trimmed.startsWith("- ") && lastListKey !== null) {
      if (!Array.isArray(hook[lastListKey])) hook[lastListKey] = [];
      hook[lastListKey].push(stripQuotes(trimmed.slice(2).trim()));
    }
  }
  return Object.keys(hook).length === 0 ? null : hook;
}

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

// ── incremental note-text cache (memory v2 perf, D) ─────────────────────────
// note_search / note_links previously read every .md on every call. This cache
// reuses the raw text while a file's mtime+size stay unchanged: per call the
// cost drops to a metadata stat plus reading only files that actually changed.
const NOTE_CACHE_LIMIT = 5000;
const noteReadCache = new Map(); // rootPath -> Map<relPath, {mtimeMs, size, raw}>

export function cacheEntryFresh(entry, mtimeMs, size) {
  return entry !== undefined && entry !== null && entry.mtimeMs === mtimeMs && entry.size === size;
}

async function readNoteTextCached(ctx, rootPath, note, signal) {
  let cache = noteReadCache.get(rootPath);
  if (cache === undefined) {
    cache = new Map();
    noteReadCache.set(rootPath, cache);
  }
  let info;
  try {
    info = await ctx.fs.stat(note.target, signal);
  } catch {
    return null;
  }
  if (info === undefined) return null;
  const mtimeMs = typeof info.mtimeMs === "number" ? info.mtimeMs : (info.mtime instanceof Date ? info.mtime.getTime() : 0);
  const size = typeof info.size === "number" ? info.size : -1;
  const hit = cache.get(note.path);
  if (cacheEntryFresh(hit, mtimeMs, size)) return hit.raw;
  let raw;
  try {
    raw = await ctx.fs.readText(note.target, signal);
  } catch {
    return null;
  }
  cache.set(note.path, { mtimeMs, size, raw });
  if (cache.size > NOTE_CACHE_LIMIT) noteReadCache.delete(rootPath); // rebuild lazily on a huge vault
  return raw;
}

function cleanTagToken(token) {
  return token.trim().replace(/^['"]|['"]$/g, "").replace(/^#+/, "");
}

/** Extract `tags:` from YAML-ish frontmatter (inline list, flow list, or `-` list). */
function frontmatterTags(text) {
  if (text === null) return [];
  const tags = [];
  const lines = text.split(/\r?\n/);
  let inTagList = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (inTagList) {
      const item = /^\s+-\s+(.+)$/.exec(line);
      if (item !== null) {
        tags.push(cleanTagToken(item[1]));
        continue;
      }
      inTagList = false;
    }
    const key = /^tags:\s*(.*)$/.exec(line);
    if (key === null) continue;
    const value = key[1].trim();
    if (value === "") {
      inTagList = true;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      for (const item of value.slice(1, -1).split(",")) {
        const token = cleanTagToken(item);
        if (token !== "") tags.push(token);
      }
    } else {
      for (const item of value.split(/[\s,]+/)) {
        const token = cleanTagToken(item);
        if (token !== "") tags.push(token);
      }
    }
  }
  return tags;
}

/** Extract inline `#tag` occurrences (never `# heading`). */
function inlineTags(body) {
  const tags = [];
  const expression = /(?:^|[\s([{])#([A-Za-z0-9_\-/]+)/g;
  let match;
  while ((match = expression.exec(body)) !== null) tags.push(match[1]);
  return tags;
}

function noteTags(note) {
  const seen = new Set();
  const tags = [];
  for (const raw of [...frontmatterTags(note.frontmatter), ...inlineTags(note.body)]) {
    const tag = raw.replace(/^#+/, "");
    const key = tag.toLowerCase();
    if (tag === "" || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function normalizeTagFilter(raw) {
  return String(raw ?? "").trim().replace(/^#+/, "").toLowerCase().replace(/^\/+|\/+$/g, "");
}

function matchesTagFilter(tags, filter) {
  return tags.some((tag) => {
    const normalized = tag.toLowerCase();
    return normalized === filter || normalized.endsWith(`/${filter}`);
  });
}

function makeSnippet(haystack, index, matchLength) {
  const start = Math.max(0, index - 60);
  const end = Math.min(haystack.length, index + matchLength + 120);
  return `${start > 0 ? "…" : ""}${haystack.slice(start, end).replace(/\s+/g, " ").trim()}${end < haystack.length ? "…" : ""}`;
}

/** Wikilinks, including embeds and heading/anchor suffixes. */
function extractWikiLinks(raw) {
  const links = new Set();
  const expression = /!?\[\[([^\[\]|#]+)(?:#[^\]\[]*)?(?:\|[^\]\[]*)?\]\]/g;
  let match;
  while ((match = expression.exec(raw)) !== null) {
    const target = match[1].trim().replace(/\.md$/i, "");
    if (target !== "") links.add(target);
  }
  return [...links];
}

function normalizeNoteRelPath(input) {
  const rawInput = String(input).trim();
  if (rawInput.includes("\u0000")) throw new Error("obsidian-notes: note path contains a NUL byte");
  if (isAbsolute(rawInput) || /^[A-Za-z]:[\\/]/.test(rawInput)) {
    throw new Error(`obsidian-notes: note path must be vault-relative, got ${JSON.stringify(rawInput)}`);
  }
  let rel = rawInput.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (rel.startsWith("/")) rel = rel.replace(/^\/+/, "");
  if (rel === "" || rel === "." || rel.endsWith("/")) {
    throw new Error(`obsidian-notes: invalid note path ${JSON.stringify(rawInput)}`);
  }
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.includes(":"))) {
    throw new Error(`obsidian-notes: note path escapes the vault or is invalid: ${JSON.stringify(rawInput)}`);
  }
  if (!rel.toLowerCase().endsWith(".md")) rel += ".md";
  return rel;
}

const OVERWRITE_REFUSAL = (rel) => `note_create: note already exists (${rel}); refusing to overwrite. Read it and use edit/write only when the user explicitly asks to change the existing note.`;

// ── memory v2: two-stage strategy retrieval (ISM scoring + Dual RAG query) ──

const RECALL_DEFAULT_MAX_RESULTS = 15;
const RECALL_HARD_MAX_RESULTS = 50;

/** Known operator vocabulary (hard-filter key, stage 1). */
const HOOK_OPERATORS = new Set([
  "algebra", "number-theory", "geometry", "combinatorics", "probability",
  "analysis", "statistics", "calculus", "linear-algebra", "topology", "logic"
]);

function normalizeOperator(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

/** ASCII words plus CJK bigrams (with the full run as a fallback token). */
export function tokenize(text) {
  const tokens = [];
  if (typeof text !== "string") return tokens;
  // Unicode dash normalization: Borel–Cantelli / Borel—Cantelli / a-b must
  // all tokenize identically to borel-cantelli, otherwise hyphen/en-dash
  // variants of the same named technique never match each other.
  const normalized = text.toLowerCase().replace(/[\u2013\u2014\u2212]/g, "-");
  for (const token of normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? []) tokens.push(token);
  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) { tokens.push(run); continue; }
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
    tokens.push(run);
  }
  return tokens;
}

function tokenFrequencies(tokens) {
  const freq = new Map();
  for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1);
  return freq;
}

/**
 * IDF-weighted overlap coefficient in [0,1]: how much of the query's token
 * mass is covered by the card, down-weighting tokens that appear everywhere
 * (the dependency-free stand-in for ISM's embedding similarity term).
 */
export function weightedOverlap(queryTokens, cardTokens, docFreq) {
  if (queryTokens.length === 0 || cardTokens.length === 0) return 0;
  const qFreq = tokenFrequencies(queryTokens);
  const cFreq = tokenFrequencies(cardTokens);
  const docCount = Math.max(1, docFreq.docCount);
  let matched = 0;
  let total = 0;
  for (const [token, qCount] of qFreq) {
    const df = docFreq.map.get(token) ?? 0;
    const idf = Math.log(1 + docCount / Math.max(1, df + 1));
    total += qCount * idf;
    matched += Math.min(qCount, cFreq.get(token) ?? 0) * idf;
  }
  return total === 0 ? 0 : matched / total;
}

export function computeDocFreq(tokenLists) {
  const map = new Map();
  for (const tokens of tokenLists) {
    for (const token of new Set(tokens)) map.set(token, (map.get(token) ?? 0) + 1);
  }
  return { docCount: tokenLists.length, map };
}

// ── memory v3: BM25 scorer (retrieval-v3.md S2) ──────────────────────────────

/**
 * Corpus statistics for BM25: document count, average length, term df table.
 * Independent of the overlap coefficient's { docCount, map } shape so the
 * two scorers stay interchangeable during the transition.
 */
export function computeCorpusStats(tokenizedDocs) {
  const docFreq = new Map();
  let totalLen = 0;
  for (const tokens of tokenizedDocs) {
    totalLen += tokens.length;
    for (const token of new Set(tokens)) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }
  return {
    docCount: tokenizedDocs.length,
    avgLen: tokenizedDocs.length > 0 ? totalLen / tokenizedDocs.length : 1,
    docFreq
  };
}

/**
 * Standard BM25 (k1=1.2, b=0.75): term-frequency saturation, inverse document
 * frequency, and document-length normalization. Strong classic lexical
 * baseline — strictly better than the overlap coefficient for ranking.
 * Query repetition is honored (each query occurrence adds its own term),
 * document repetition saturates.
 */
export function bm25Score(queryTokens, docTokens, stats, k1 = 1.2, b = 0.75) {
  if (queryTokens.length === 0 || docTokens.length === 0 || stats.docCount === 0) return 0;
  const qFreq = tokenFrequencies(queryTokens);
  const dFreq = tokenFrequencies(docTokens);
  const docLen = docTokens.length;
  const lengthNorm = 1 - b + b * (docLen / Math.max(1, stats.avgLen));
  let score = 0;
  for (const [token, qCount] of qFreq) {
    const df = stats.docFreq.get(token) ?? 0;
    if (df === 0) continue; // unseen terms carry no BM25 signal
    const tf = dFreq.get(token) ?? 0;
    if (tf === 0) continue;
    const idf = Math.log(1 + (stats.docCount - df + 0.5) / (df + 0.5));
    score += qCount * idf * (tf * (k1 + 1)) / (tf + k1 * lengthNorm);
  }
  return score;
}

/**
 * Rank documents with BM25, returning sorted [score, index] pairs (desc).
 */
export function rankBm25(queryTokens, tokenizedDocs, stats) {
  const scored = tokenizedDocs.map((docTokens, index) => ({ index, score: bm25Score(queryTokens, docTokens, stats) }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * CJK character containment in [0,1]: how many DISTINCT Chinese characters of
 * the query appear in the doc. Bridges short-vs-long word mismatch (子列 vs
 * 子序列) that bigram tokenization cannot see; zero for non-CJK queries.
 */
/**
 * Fraction of DISTINCT query tokens covered by the doc (BM25-token level).
 * A high ranking score with low coverage is a lexical coincidence: the
 * relative max-normalization hides it, so the tool exposes this as a
 * weak-signal indicator (retrieval v3 probe finding).
 */
export function queryCoverage(queryTokens, docTokens) {
  const distinct = new Set(queryTokens);
  if (distinct.size === 0) return 1;
  const docSet = new Set(docTokens);
  let hit = 0;
  for (const token of distinct) if (docSet.has(token)) hit += 1;
  return hit / distinct.size;
}

export function cjkCharOverlap(queryText, docText) {
  const chars = (value) => {
    const set = new Set();
    for (const ch of String(value ?? "")) if (/[\u4e00-\u9fff]/.test(ch)) set.add(ch);
    return set;
  };
  const q = chars(queryText);
  if (q.size < 2) return 0; // single char is noise; require a real CJK query
  const d = chars(docText);
  let hit = 0;
  for (const ch of q) if (d.has(ch)) hit += 1;
  return hit / q.size;
}

// ── memory v3 S1: unified recall corpus (retrieval-v3.md) ───────────────────

const MEMORY_SCAFFOLD_FILES = new Set(["index.md", "_README.md"]);

/**
 * Classify a vault-relative path into the unified corpus kinds. Scaffold and
 * machine files return "skip"; raw episode bodies are skipped too (evidence
 * is reached via grep/read — only their index lines join the corpus).
 */
export function classifyVaultDoc(rel) {
  if (rel === "AGENTS.md") return "skip";
  if (rel === ".deepseek/capture-policy.md" || rel === ".deepseek/memory/profile.md") return "skip";
  if (rel.startsWith(".deepseek/cache")) return "skip";
  if (rel.startsWith(".deepseek/memory/episodes/")) {
    return rel.endsWith("/index.md") ? "episode-index" : "skip";
  }
  const memoryDir = (dir) => {
    const stem = rel.slice(dir.length);
    if (stem === "index.md" || stem.startsWith("_")) return "skip";
    return rel.endsWith(".md") ? "ok" : "skip";
  };
  if (rel.startsWith(".deepseek/memory/records/")) return memoryDir(".deepseek/memory/records/") === "ok" ? "record" : "skip";
  if (rel.startsWith(".deepseek/memory/templates/")) return memoryDir(".deepseek/memory/templates/") === "ok" ? "template" : "skip";
  if (rel.startsWith(".deepseek/inbox/")) return memoryDir(".deepseek/inbox/") === "ok" ? "memo" : "skip";
  if (rel.startsWith(".deepseek/memory/topics/")) return memoryDir(".deepseek/memory/topics/") === "ok" ? "topic" : "skip";
  if (rel === ".deepseek/memory/theorems/index.md") return "theorem-index";
  return "note";
}

/**
 * Kind-aware retrieval passage (LeanSearch kind-aware passages, localized):
 * hook cards emphasize hook fields, memos/notes emphasize body heads, index
 * kinds keep their line-based content. Frontmatter is excluded.
 */
export function composePassage(kind, doc) {
  const hookText = [doc.hook?.operator, doc.hook?.pattern, doc.hook?.techniques, doc.hook?.applications, doc.hook?.heuristics, doc.hook?.quantity]
    .filter((part) => Array.isArray(part) ? part.length > 0 : typeof part === "string" && part !== "")
    .flat()
    .join(" ");
  const body = String(doc.body ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---/, "").trim();
  const title = String(doc.title ?? "");
  const topic = String(doc.topic ?? "");
  const join = (...parts) => parts.filter((part) => part !== "").join(" ");
  switch (kind) {
    case "record":
    case "template":
      return join(title, hookText, topic, body.slice(0, 800));
    case "memo":
      return join(title, topic, body.slice(0, 1500));
    case "topic":
      return join(title, body.slice(0, 2000));
    case "episode-index":
    case "theorem-index":
      return join(title, body.slice(0, 2000));
    default:
      return join(title, (doc.tags ?? []).join(" "), body.slice(0, 1500));
  }
}

/** Extract a scalar from YAML-ish frontmatter text (no dependency on the memory module). */
function metaScalar(frontmatter, key) {
  if (frontmatter === null) return undefined;
  const match = new RegExp("^" + key + ":\\s*(.*)$", "m").exec(frontmatter);
  if (match === null) return undefined;
  const value = match[1].trim().replace(/^['\"]|['\"]$/g, "");
  return value === "" ? undefined : value;
}

/** Title for a corpus doc: frontmatter title → first heading → filename stem. */
function titleFromDoc(frontmatter, body, fallback) {
  const meta = metaScalar(frontmatter, "title");
  if (meta !== undefined) return meta;
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return heading ?? fallback.replace(/\.md$/i, "");
}

/** One-line snippet around the first query-token occurrence (or passage head). */
function snippetForPassage(passage, queryTokens, maxLen = 140) {
  const lower = passage.toLowerCase();
  let index = -1;
  for (const token of queryTokens) {
    if (token.length < 2) continue;
    const at = lower.indexOf(token.toLowerCase());
    if (at >= 0) { index = at; break; }
  }
  if (index < 0) return passage.slice(0, maxLen);
  return makeSnippet(passage, index, 2);
}

function hookNumber(hook, key, fallback) {
  const value = Number(hook?.[key]);
  return Number.isFinite(value) ? value : fallback;
}



function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Serialize stats writes: note_recall declares itself concurrency-safe,
// so two concurrent hits could otherwise interleave read-modify-write and
// lose a count. A module-level promise queue makes the update atomic.
let statsWriteQueue = Promise.resolve();

function recordRetrievalStatsNow(vaultPath, cardPaths) {
  const statsPath = join(vaultPath, ".deepseek", "cache", "retrieval-stats.json");
  let stats = {};
  try {
    if (existsSync(statsPath)) stats = JSON.parse(readFileSync(statsPath, "utf8")) ?? {};
  } catch {
    stats = {};
  }
  const today = localDateString();
  for (const rel of cardPaths) {
    const entry = stats[rel] ?? {};
    entry.uses = (Number.isFinite(entry.uses) ? entry.uses : 0) + 1;
    entry.last_used = today;
    stats[rel] = entry;
  }
  try {
    mkdirSync(dirname(statsPath), { recursive: true });
    writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf8");
  } catch {
    // Stats are advisory; ignore write failures.
  }
}

/**
 * Best-effort hit accounting into the plugin-owned stats cache
 * (.deepseek/cache/retrieval-stats.json). The audit pass in
 * obsidian-memory.mjs merges this into the cards' hook.uses / last_used and
 * then zeroes the entries (no double counting). Never throws: a stats write
 * failure must not fail the retrieval itself.
 */
function recordRetrievalStats(vaultPath, cardPaths) {
  if (typeof vaultPath !== "string" || vaultPath === "" || cardPaths.length === 0) return;
  statsWriteQueue = statsWriteQueue
    .then(() => recordRetrievalStatsNow(vaultPath, cardPaths))
    .catch(() => {});
}

// ── cordis plugin ────────────────────────────────────────────────────────────

export async function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  const defineTool = await loadDefineTool(ctx);

  ctx.systemPrompt.section({
    name: "tool:obsidian-notes",
    order: 103,
    text:
      "Use the dedicated Obsidian note tools for note-level operations: " +
      "note_recall (PRIMARY entry — unified relevance-ranked search over user notes AND all memory layers with BM25 + hook signals; use it whenever you need to find relevant content, then read the top 2-3 matches in full before using them; an empty result is a signal to reformulate the query), " +
      "note_search (text and/or tag filter over user notes only), " +
      "note_create (new note only — it refuses to overwrite an existing note), and note_links (which notes link to a note). " +
      "For ordinary file read/write/edit/glob/grep inside the vault keep using the generic file tools."
  });

  // ── note_search ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_search",
    description: `Search the Obsidian vault for markdown notes whose title or body contains a query string, optionally filtered by a tag. Returns up to ${DEFAULT_MAX_RESULTS} matches by default, each with vault-relative path, title, tags, and a text snippet. Prefer this over raw grep when the user asks to find notes by topic, keyword, or tag. The hidden .deepseek memory tree is excluded — use grep/read for memory files.`,
    parameters: {
      query: { type: "string", description: "Case-insensitive substring matched against note titles and bodies. Omit to search by tag only." },
      tag: { type: "string", description: "Optional tag filter without leading '#' (e.g. \"analysis\" also matches nested tag \"math/analysis\")." },
      maxResults: { type: "integer", description: `Optional cap on matches; defaults to ${DEFAULT_MAX_RESULTS}, maximum ${HARD_MAX_RESULTS}.` }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", required: true },
                title: { type: "string", required: true },
                snippet: { type: "string", required: true },
                tags: { type: "array", required: true, items: { type: "string" } }
              }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.matches.length === 0
          ? "No matching notes found."
          : value.matches.map((match) => `- ${match.title} (${match.path})${match.tags.length > 0 ? ` [${match.tags.join(", ")}]` : ""}\n  ${match.snippet}`).join("\n")
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { rootPath, rootTarget } = await resolveVault(ctx, exec, cfg);
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const tag = normalizeTagFilter(args.tag);
      if (query === "" && tag === "") {
        throw new Error("note_search: provide query, tag, or both");
      }
      const requested = Number(args.maxResults ?? cfg.maxSearchResults);
      if (!Number.isInteger(requested) || requested < 1) {
        throw new Error(`note_search: maxResults must be a positive integer`);
      }
      const limit = Math.min(requested, HARD_MAX_RESULTS);

      // note_search is user-note scoped: the hidden .deepseek memory tree is
      // excluded (memory files are reached via grep/read per the routing rules).
      const notes = await listNotes(ctx, rootTarget, exec?.signal, cfg.excludePatterns, [".deepseek"]);
      const matches = [];
      for (const note of notes) {
        if (matches.length >= limit) break;
        const raw = await readNoteTextCached(ctx, rootPath, note, exec?.signal);
        if (raw === null) continue; // unreadable note is skipped, not a search failure
        const { frontmatter, body } = splitFrontmatter(raw);
        const tags = noteTags({ frontmatter, body });
        if (tag !== "" && !matchesTagFilter(tags, tag)) continue;
        if (query !== "") {
          const haystack = `${note.name}\n${raw}`;
          const lower = haystack.toLowerCase();
          const index = lower.indexOf(query);
          if (index < 0) continue;
          matches.push({
            path: note.path,
            title: note.name,
            snippet: makeSnippet(haystack, index, query.length),
            tags
          });
        } else {
          matches.push({
            path: note.path,
            title: note.name,
            snippet: makeSnippet(body, 0, 0),
            tags
          });
        }
      }
      return { matches };
    },
    presentCall: (args) => ({ card: "generic", title: "Search notes", kind: "search", rawInput: args.query ?? args.tag })
  }));

  // ── note_create ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_create",
    description: `Create a new markdown note in the Obsidian vault at the given vault-relative path. The full markdown (including any frontmatter) is written exactly as provided. This tool refuses to overwrite an existing note and has no overwrite flag; to change an existing note, use read + edit/write after the user asks for it.`,
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative path for the new note, with or without the \".md\" extension." },
      content: { type: "string", required: true, description: "Full markdown content of the note, including any YAML frontmatter you want at the top." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          operation: { type: "string", required: true, enum: ["create"] }
        }
      },
      render: (_args, value) => [{ type: "text", text: `Created note: ${value.path}` }]
    },
    async execute(args, exec) {
      const { rootPath, rootTarget } = await resolveVault(ctx, exec, cfg);
      const rel = normalizeNoteRelPath(args.path);
      const bytes = Buffer.byteLength(args.content, "utf8");
      if (bytes > cfg.maxNoteBytes) {
        throw new Error(`note_create: note is ${bytes} bytes; maximum is ${cfg.maxNoteBytes} bytes`);
      }
      const target = await ctx.fs.resolve(join(rootPath, ...rel.split("/")), { signal: exec?.signal });
      requireInsideVault(ctx, rootTarget, target);

      const existing = await ctx.fs.stat(target, exec?.signal);
      if (existing !== undefined) throw new Error(OVERWRITE_REFUSAL(rel));

      let outcome;
      try {
        outcome = await ctx.fs.writeText(target, args.content, { kind: "createIfAbsent" }, exec?.signal);
      } catch (error) {
        if (error?.code === "FS_NOT_OBSERVED") throw new Error(OVERWRITE_REFUSAL(rel));
        throw error;
      }
      ctx.emit("fs/observed", target, { kind: "present", version: outcome.version }, exec);
      return { path: rel, operation: "create" };
    },
    presentCall: (args) => ({
      card: "diff",
      title: `Create note ${args.path}`,
      diffs: [{ path: args.path, oldText: null, newText: args.content }]
    })
  }));

  // ── note_links ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_links",
    description: `Query wikilink backlinks in the Obsidian vault: which notes link TO a note. Pass a note name (with or without the ".md" extension) to see only its incoming links; omit the argument to return the full note-name -> linking-notes map.`,
    parameters: {
      note: { type: "string", description: "Optional note name or vault-relative path (extension optional) to filter backlinks to." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          queried: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          exists: { type: "boolean", required: true },
          backlinks: { type: "json", required: true },
          total: { type: "integer", required: true }
        }
      },
      render: (_args, value) => {
        const entries = Object.entries(value.backlinks ?? {});
        const lines = entries.map(([target, sources]) => `- ${target} ← ${sources.join(", ")}`);
        if (value.queried !== null) {
          if (!value.exists) return [{ type: "text", text: `No note found: ${value.queried}` }];
          return [{
            type: "text",
            text: `Backlinks for ${value.queried} (${value.total}):\n${lines.join("\n") || "（none）"}`
          }];
        }
        return [{
          type: "text",
          text: `Backlink map across vault (${value.total} links):\n${lines.join("\n") || "（none）"}`
        }];
      }
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { rootPath, rootTarget } = await resolveVault(ctx, exec, cfg);
      const notes = await listNotes(ctx, rootTarget, exec?.signal, cfg.excludePatterns);

      const backlinks = new Map();
      const noteNames = new Map();
      const notePaths = new Map();
      for (const note of notes) {
        noteNames.set(note.name.toLowerCase(), note.name);
        notePaths.set(note.path.toLowerCase().replace(/\.md$/i, ""), note.name);
      }
      for (const note of notes) {
        const raw = await readNoteTextCached(ctx, rootPath, note, exec?.signal);
        if (raw === null) continue;
        for (const target of extractWikiLinks(raw)) {
          const sources = backlinks.get(target) ?? [];
          if (!sources.some((source) => source.toLowerCase() === note.name.toLowerCase())) sources.push(note.name);
          backlinks.set(target, sources);
        }
      }
      for (const sources of backlinks.values()) sources.sort((a, b) => a.localeCompare(b));

      const requested = typeof args.note === "string" ? args.note.trim().replace(/\.md$/i, "") : "";
      if (requested === "") {
        const all = Object.fromEntries([...backlinks.entries()].sort(([a], [b]) => a.localeCompare(b)));
        const total = Object.values(all).reduce((sum, sources) => sum + sources.length, 0);
        return { queried: null, exists: true, backlinks: all, total };
      }

      const requestedLower = requested.toLowerCase();
      const exactKey = [...backlinks.keys()].find((key) => key.toLowerCase() === requestedLower);
      const suffixKey = [...backlinks.keys()].find((key) => key.toLowerCase().endsWith(`/${requestedLower}`));
      const key = exactKey ?? suffixKey;
      const noteName = notePaths.get(requestedLower) ?? noteNames.get(requestedLower);
      if (key !== undefined) {
        const sources = backlinks.get(key) ?? [];
        return { queried: key, exists: true, backlinks: { [key]: sources }, total: sources.length };
      }
      if (noteName !== undefined) {
        return { queried: noteName, exists: true, backlinks: { [noteName]: [] }, total: 0 };
      }
      return { queried: requested, exists: false, backlinks: { [requested]: [] }, total: 0 };
    },
    presentCall: (args) => ({ card: "generic", title: "Query backlinks", kind: "search", rawInput: args.note ?? "(all)" })
  }));

  // ── note_recall (memory v3 S1: unified entry) ─────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_recall",
    description: `Unified relevance-ranked search across the WHOLE vault: user notes AND the memory layers (records/templates cards with hook weighting, memos, topic files, theorem index, episode index). BM25 ranking + hook-field signals + success-rate prior. This is the PRIMARY retrieval entry — prefer it over grep and over per-layer routes whenever you need to find relevant content; it answers in one call what previously took several. Returns a compact top-k with kind, title, one-line snippet, verification level, uses/success_rate, score and coverage (fraction of query tokens matched — coverage below 0.35 marks a weak, likely lexical-coincidence hit even when the score looks high). Then READ the top 2-3 matches in full before using them. An empty result is a signal: reformulate the query (different challenge wording or technique keywords) or change approach — never force-fit unrelated cards.`,
    parameters: {
      query: { type: "string", required: true, description: "Distilled search query: the reasoning challenge plus candidate technique keywords, e.g. '证明独立随机变量和 a.s. 收敛 子序列 Borel-Cantelli'." },
      operator: { type: "string", description: `Optional stage-1 hard filter, one of ${[...HOOK_OPERATORS].join("/")}. Only hook cards with a matching operator are scored; when none matches, all docs are scored and mode reports the fallback.` },
      tag: { type: "string", description: "Optional tag filter (user notes only), without leading '#'." },
      maxResults: { type: "integer", description: `Optional cap on matches; defaults to ${RECALL_DEFAULT_MAX_RESULTS}, maximum ${RECALL_HARD_MAX_RESULTS}.` }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", required: true },
          mode: { type: "string", required: true, enum: ["unified", "fallback"] },
          operator: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", required: true },
                kind: { type: "string", required: true },
                title: { type: "string", required: true },
                snippet: { type: "string", required: true },
                verified: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
                hookOperator: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
                uses: { type: "integer", required: true },
                successRate: { oneOf: [{ type: "number" }, { type: "null" }], required: true },
                score: { type: "number", required: true },
                coverage: { type: "number", required: true }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        if (value.matches.length === 0) return [{ type: "text", text: "No relevant content found — treat this as a signal to reformulate the query or change approach." }];
        const kindLabel = { note: "笔记", record: "记忆卡", template: "模板", memo: "备忘录", topic: "主题", "episode-index": "事件", "theorem-index": "定理" };
        const lines = value.matches.map((match) => {
          const extra = [
            match.verified === null ? "" : { "user-confirmed": "✅", "cross-referenced": "⚖️", "single-source": "❓" }[match.verified] ?? match.verified,
            match.hookOperator === null ? "" : `算子:${match.hookOperator}`,
            `uses:${match.uses}`,
            match.successRate === null ? "" : `成功率:${match.successRate}`,
            `覆盖:${match.coverage}`
          ].filter((part) => part !== "").join(" · ");
          return `- [${kindLabel[match.kind] ?? match.kind}] ${match.title} (${match.path}) score ${match.score.toFixed(3)}${extra === "" ? "" : " · " + extra}\n  ${match.snippet}`;
        });
        const weak = value.matches.filter((match) => match.coverage < 0.35).length;
        return [{ type: "text", text: `${value.matches.length} 条候选（读前 2-3 条全文核实后再使用；${weak} 条 coverage<0.35 属弱信号，多为词面巧合）:\n${lines.join("\n")}` }];
      }
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { rootPath, rootTarget } = await resolveVault(ctx, exec, cfg);
      const query = String(args.query ?? "").trim();
      const tag = normalizeTagFilter(args.tag);
      if (query === "" && tag === "") {
        throw new Error("note_recall: provide query, tag, or both");
      }
      const operator = args.operator === undefined || args.operator === null || String(args.operator).trim() === ""
        ? null
        : normalizeOperator(args.operator);
      const requested = Number(args.maxResults ?? RECALL_DEFAULT_MAX_RESULTS);
      if (!Number.isInteger(requested) || requested < 1) {
        throw new Error(`note_recall: maxResults must be a positive integer`);
      }
      const limit = Math.min(requested, RECALL_HARD_MAX_RESULTS);
      const queryTokens = tokenize(query);

      // One walk covers notes AND memory (no .deepseek exclusion here).
      const notes = await listNotes(ctx, rootTarget, exec?.signal, cfg.excludePatterns);
      const docs = [];
      for (const note of notes) {
        const kind = classifyVaultDoc(note.path);
        if (kind === "skip") continue;
        const raw = await readNoteTextCached(ctx, rootPath, note, exec?.signal);
        if (raw === null) continue;
        const { frontmatter, body } = splitFrontmatter(raw);
        const doc = {
          kind,
          rel: note.path,
          title: titleFromDoc(frontmatter, body, note.name),
          tags: kind === "note" ? noteTags({ frontmatter, body }) : [],
          topic: metaScalar(frontmatter, "topic") ?? "",
          hook: frontmatter === null ? null : parseHookFrontmatter(frontmatter),
          body
        };
        if (tag !== "" && !matchesTagFilter(doc.tags, tag)) continue;
        docs.push(doc);
      }

      const passages = docs.map((doc) => composePassage(doc.kind, doc));
      const corpusStats = computeCorpusStats(passages.map((passage) => tokenize(passage)));
      const docTokenSets = passages.map((passage) => new Set(tokenize(passage)));
      const rawScores = docs.map((doc, i) => bm25Score(queryTokens, tokenize(passages[i]), corpusStats));
      const maxScore = Math.max(1e-9, ...rawScores);
      const priorOf = (doc) => doc.hook === null
        ? 0.5
        : 0.5 * hookNumber(doc.hook, "success_rate", 0.5) + 0.5 * Math.min(hookNumber(doc.hook, "uses", 0) / 10, 1);
      const operatorMatch = (doc) => operator === null || (doc.hook !== null && normalizeOperator(doc.hook.operator) === operator);
      // 0.85 BM25 + 0.10 CJK char containment (bridges 子列/子序列-class
      // word-form gaps) + 0.05 success/uses prior.
      const cjkBonus = docs.map((doc, i) => cjkCharOverlap(query, passages[i]));
      const scored = docs.map((doc, i) => ({
        doc,
        i,
        score: 0.85 * (rawScores[i] / maxScore) + 0.10 * cjkBonus[i] + 0.05 * priorOf(doc),
        operatorMatch: operatorMatch(doc)
      }));

      let pool = scored;
      let operatorFallback = false;
      if (operator !== null) {
        if (scored.some((entry) => entry.operatorMatch)) pool = scored.filter((entry) => entry.operatorMatch);
        else operatorFallback = true;
      }
      pool.sort((a, b) => b.score - a.score);
      const top = pool.slice(0, limit);

      // Hook stats migration (memory v3): the unified entry records hits for
      // hook cards; the daily audit merges them back into uses/last_used.
      recordRetrievalStats(rootPath, top.filter((entry) => entry.doc.hook !== null).map((entry) => entry.doc.rel));

      return {
        query,
        mode: operatorFallback ? "fallback" : "unified",
        operator,
        matches: top.map(({ doc, score, i }) => ({
          path: doc.rel,
          kind: doc.kind,
          title: doc.title,
          snippet: snippetForPassage(passages[i], queryTokens),
          verified: typeof doc.hook?.verified === "string" ? doc.hook.verified : null,
          hookOperator: typeof doc.hook?.operator === "string" ? doc.hook.operator : null,
          uses: Math.max(0, Math.trunc(hookNumber(doc.hook, "uses", 0))),
          successRate: Number.isFinite(Number(doc.hook?.success_rate)) ? Number(doc.hook.success_rate) : null,
          score: Number(score.toFixed(4)),
          coverage: Number(queryCoverage(queryTokens, docTokenSets[i]).toFixed(2))
        }))
      };
    },
    presentCall: (args) => ({ card: "generic", title: "Recall vault content", kind: "search", rawInput: args.query })
  }));
}
