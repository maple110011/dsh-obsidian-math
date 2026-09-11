/**
 * hook-frontmatter — the shared frontmatter primitives + hook-block parser
 * (single source of truth).
 *
 * TWO things live here:
 *   1. the frontmatter DELIMITER rule (`frontmatterSpan` and friends) — see below;
 *   2. the `hook:` block parser, imported by note-tools.mjs (ESM) and loaded into
 *      the Obsidian plugin through the embedded source loader in main.template.js.
 * Keep this file free of imports so the same source evaluates in both module
 * systems.
 */

// Bump whenever the hook block's schema changes (new fields / changed value
// semantics). Any consumer that persists or caches hook-derived data must key
// on this version so a stale cache can never leak old-schema values.
const HOOK_SCHEMA_VERSION = 1;

// ── frontmatter delimiters: THE single implementation ───────────────────────
// Before 2026-09-11 the rule "a file's metadata is a leading `---`\n…\n`---`
// block" was re-typed as a regex literal in **15** places across 6 parsers in 3
// files (`math-memory.mjs`, `note-tools.mjs`, `memory-admin.mjs`). Every severe
// data-corruption incident in this repo traces back to one of those copies
// judging the boundary differently — traps 21/22/43 all end with a card whose
// closing `---` landed mid-file. The rule now lives here, and
// `scripts/check-frontmatter-source.mjs` refuses the literal repo-wide so a
// seventh copy cannot be added by habit.
//
// The host tree canNOT import this file: the Obsidian loader injects bindings
// into the evaluated body instead of resolving imports
// (see scripts/check-embedded-loader.mjs). So `memory-admin.mjs` keeps ONE copy
// of `frontmatterSpan`/`replaceFrontmatter`, and the guard asserts the two are
// behaviourally identical on a fixture set — a checked duplicate instead of a
// comment promising they match.

/**
 * Locate a file's leading frontmatter block.
 *
 * @param {string} raw file text
 * @returns `{ start, end, blockEnd, text, block }` or null when there is no
 *   block. `text` is the BODY between the delimiters (`raw.slice(start, end)`);
 *   `block` is the whole thing including both `---` lines, with no trailing
 *   newline (`raw.slice(0, blockEnd)`).
 */
function frontmatterSpan(raw) {
  if (typeof raw !== "string") return null;
  const open = /^---[ \t]*\r?\n/.exec(raw);
  if (open === null) return null;
  const start = open[0].length;
  // The lookahead keeps `close[0]` free of the trailing newline, so `blockEnd`
  // is exactly the offset just past the closing `---`.
  const close = /\r?\n---[ \t]*(?=\r?\n|$)/.exec(raw.slice(start));
  if (close === null) return null;
  const end = start + close.index;
  const blockEnd = end + close[0].length;
  return { start, end, blockEnd, text: raw.slice(start, end), block: raw.slice(0, blockEnd) };
}

/** The frontmatter BODY (between the delimiters); `""` when there is none. */
function readFrontmatter(raw) {
  const span = frontmatterSpan(raw);
  return span === null ? "" : span.text;
}

/** The whole leading block including both `---` lines; null when there is none. */
function frontmatterBlock(raw) {
  const span = frontmatterSpan(raw);
  return span === null ? null : span.block;
}

/**
 * `raw` without its leading frontmatter block — the body, INCLUDING the newline
 * that followed the closing `---` (this matches the `.replace(BLOCK_RE, "")`
 * form it replaced, byte for byte; callers that want no leading blank line
 * `.trim()` it themselves).
 */
function stripFrontmatter(raw) {
  const span = frontmatterSpan(raw);
  if (span === null) return typeof raw === "string" ? raw : "";
  return raw.slice(span.blockEnd);
}

/**
 * Splice a new frontmatter BODY (between the delimiters) into `raw` by offset.
 * Returns null when `raw` has no block.
 *
 * BY OFFSET, never `raw.replace(oldText, newText)`: the second argument of
 * `String.replace` is a REPLACEMENT STRING, so `$$`/`$&` inside agent-authored
 * frontmatter get expanded (`title: 关于 $$ 的表示` silently loses a `$`), and an
 * EMPTY body would insert at offset 0 instead of replacing. A math vault is
 * exactly where `$$` appears in a title.
 */
function replaceFrontmatter(raw, innerText) {
  const span = frontmatterSpan(raw);
  if (span === null) return null;
  return raw.slice(0, span.start) + innerText + raw.slice(span.end);
}

/** Splice a whole new block (delimiters included) into `raw` by offset. */
function replaceFrontmatterBlock(raw, blockText) {
  const span = frontmatterSpan(raw);
  if (span === null) return null;
  return blockText + raw.slice(span.blockEnd);
}

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function parseHookFrontmatter(text) {
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

export {
  parseHookFrontmatter,
  stripQuotes,
  HOOK_SCHEMA_VERSION,
  frontmatterSpan,
  frontmatterBlock,
  readFrontmatter,
  stripFrontmatter,
  replaceFrontmatter,
  replaceFrontmatterBlock
};
