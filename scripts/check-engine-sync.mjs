// scripts/check-engine-sync.mjs — guard the two copies of the memory engine.
//
// WHY. The capture/distillation engine exists twice, because the two artifacts
// cannot share an import: `dsh/preset/math-memory.mjs` (115 top-level
// declarations) runs as a dsh preset, and `dsh/host/memory-admin.mjs` (56) runs
// inside the Obsidian plugin bundle, where it receives `fs`/`zlib` through the
// embedded loader instead of importing them (see check-embedded-loader.mjs).
// 22 top-level symbols are declared in BOTH files. The only sync mechanism was
// a comment in one of them ("keep the two in sync"), so a fix applied to one
// copy and forgotten in the other produced two different engines — each fully
// tested, neither test able to notice the other had drifted.
//
// WHAT IT ASSERTS. That every shared symbol is either the same code, or a
// divergence somebody wrote down on purpose:
//   * identical / equivalent (comments, quote style, `export`, whitespace) -> ok
//   * divergent and listed in KNOWN_DIVERGENT with a reason               -> ok, reported
//   * divergent and NOT listed                                             -> FAIL
//   * listed but no longer divergent                                       -> FAIL (remove it;
//     a stale exemption list silently becomes a blanket permission to drift)
//   * the set of shared names changed                                      -> FAIL (decide
//     deliberately: share it, or rename it so the two are independent)
//
// The comparison is a token stream, not raw bytes: quote style, comments, and
// the `export` keyword carry no meaning, and treating them as drift made most of
// the shared symbols look divergent when they are the same code.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRESET = 'dsh/preset/math-memory.mjs';
const HOST = 'dsh/host/memory-admin.mjs';

const results = [];
function check(name, condition, detail = '') {
  results.push(Boolean(condition));
  console.log((condition ? '[ok] ' : '[FAIL] ') + name + (detail ? ' ' + detail : ''));
}

// ── extractor ───────────────────────────────────────────────────────────────

/** Index just past the string/template literal whose quote is at `i`. */
function skipString(text, i) {
  const quote = text[i];
  i += 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Index just past the comment at `i`, or -1 when none starts there. */
function skipComment(text, i) {
  if (text[i] === '/' && text[i + 1] === '/') {
    const nl = text.indexOf('\n', i);
    return nl === -1 ? text.length : nl + 1;
  }
  if (text[i] === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return -1;
}

/**
 * Span one declaration: from `start` to the end of its statement.
 *
 * The body brace is the first `{` at paren/bracket depth 0. A `{` inside the
 * parameter list must NOT count — `f(a, { x = 1 } = {}) {` would otherwise end
 * its own span at the destructuring default, which is a real bug this guard hit
 * while being written (and is covered by the self-test below).
 */
function spanOf(text, start) {
  let i = start;
  let bodyOpen = -1;
  let paren = 0;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i) - 1; continue; }
    const after = skipComment(text, i);
    if (after !== -1) { i = after - 1; continue; }
    if (c === '(' || c === '[') { paren += 1; continue; }
    if (c === ')' || c === ']') { paren -= 1; continue; }
    if (c === '{' && paren === 0) { bodyOpen = i; break; }
    if (c === ';' && paren === 0) return text.slice(start, i + 1);
  }
  if (bodyOpen === -1) return text.slice(start);
  let depth = 0;
  for (i = bodyOpen; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i) - 1; continue; }
    const after = skipComment(text, i);
    if (after !== -1) { i = after - 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        // Consume a trailing `;` / `,` but NOT a newline: swallowing newlines
        // made a span depend on whether the next line was blank, so two
        // identical functions could compare unequal.
        let j = i + 1;
        while (j < text.length && (text[j] === ';' || text[j] === ',' || text[j] === ' ' || text[j] === '\t')) j += 1;
        return text.slice(start, j);
      }
    }
  }
  return text.slice(start);
}

/** `name -> { kind, span, line }` for every top-level declaration. */
function declarations(path) {
  const text = readFileSync(join(root, path), 'utf8');
  const out = new Map();
  const re = /^(?:export\s+)?(?:async\s+)?(function|class|const|let)\s+([A-Za-z0-9_$]+)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.set(m[2], { kind: m[1], span: spanOf(text, m.index), line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Strip comments, leaving string contents untouched. */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const j = skipString(text, i);
      out += text.slice(i, j);
      i = j;
      continue;
    }
    const after = skipComment(text, i);
    if (after !== -1) { i = after; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/** The token stream that remains once formatting and comments are removed. */
const tokenStream = (s) => stripComments(s)
  .replace(/^\s*export\s+/, '')
  .replace(/["'`]/g, '"')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{}()[\],;:=+\-*/<>!&|?.])\s*/g, '$1')
  .trim();

// ── self-test: the extractor must be right, or every verdict below is noise ──
{
  const fixture = 'function f(a, { x = 1 } = {}) {\n  return a;\n}\nconst ONE = "v";\n';
  const bodySpan = spanOf(fixture, 0);
  check('self-test: a destructuring default does not end the span early',
    bodySpan === 'function f(a, { x = 1 } = {}) {\n  return a;\n}', JSON.stringify(bodySpan.slice(0, 40)));
  const constStart = fixture.indexOf('const ONE');
  check('self-test: a one-line const ends at its own semicolon',
    spanOf(fixture, constStart) === 'const ONE = "v";');
  check('self-test: quote style and comments are not treated as drift',
    tokenStream('const a = "x"; // c\n') === tokenStream("const a = 'x';\n"));
}

// ── the inventory ───────────────────────────────────────────────────────────

/**
 * Shared top-level names, pinned. A change here is a decision, not an accident:
 * either the new symbol is genuinely shared (add it and keep the two in step), or
 * it is local to one side and should be named so that it is.
 */
const EXPECTED_SHARED = [
  'CAPTURE_ASSISTANT_CLIP', 'CAPTURE_FILE', 'CAPTURE_MAX_SESSION_CHARS', 'CAPTURE_SCAN_LIMIT',
  'CAPTURE_SCHEMA_VERSION', 'CAPTURE_USER_CLIP', 'MEMORY_DIR', 'ZSTD_MAGIC',
  'appendEpisodeIndex', 'distillSession', 'findSessionLogs', 'isNewerArtifact', 'localDateFromMs',
  // Added 2026-09-11: both copies had this path-containment helper, but the preset
  // side was named `pathIsInside`, so the pair was INVISIBLE to this guard — a
  // naming divergence on a security-relevant function (it backs the vault
  // confinement checks). Renamed to a single name on both sides.
  'pathInside', 'planSessionDelta', 'readCaptureState', 'readSessionHeader',
  'renderConversationTail', 'runSessionCapture', 'scanZstdFrames', 'selectAuthoritativeLogs',
  'sessionLogKey'
];

/**
 * Shared symbols whose two copies are NOT the same code, each with the reason it
 * is allowed to differ. Anything divergent that is missing here fails the guard.
 */
const KNOWN_DIVERGENT = {
  CAPTURE_FILE: 'the same path, built from a different constant in each copy (`join(CACHE_DIR, …)` vs `join(MEMORY_DIR, "cache", …)`) — keep the constants in step',
  distillSession: 'the preset keeps a larger per-message budget than the host copy',
  findSessionLogs: 'the host copy takes no `maxFiles` default and matches the log suffix by literal instead of by constant',
  readSessionHeader: 'the host copy decompresses through the loader-injected `zstdDecompressSync`; the preset calls `zlib.zstdDecompressSync` directly (see check-embedded-loader.mjs)',
  runSessionCapture: 'the preset holds the full 103-line implementation; the host copy wraps `scanSessionCapture` + `persistCaptureState`',
  scanZstdFrames: 'identical logic; only the error-message prefix (`math-memory:` vs `session-capture:`) differs'
};

// ── the verdict ─────────────────────────────────────────────────────────────

const preset = declarations(PRESET);
const host = declarations(HOST);
check(`${PRESET} declares top-level symbols`, preset.size > 0, `(${preset.size})`);
check(`${HOST} declares top-level symbols`, host.size > 0, `(${host.size})`);

const shared = [...preset.keys()].filter((k) => host.has(k)).sort();
const expected = [...EXPECTED_SHARED].sort();
const added = shared.filter((n) => !expected.includes(n));
const removed = expected.filter((n) => !shared.includes(n));
check(`the shared-symbol inventory is unchanged (${expected.length} names)`,
  added.length === 0 && removed.length === 0,
  added.length === 0 && removed.length === 0
    ? ''
    : `added: [${added.join(', ')}] removed: [${removed.join(', ')}]`);

let undocumented = 0;
let documented = 0;
let same = 0;

for (const name of shared) {
  const a = preset.get(name);
  const b = host.get(name);
  const identical = a.span === b.span;
  const equivalent = !identical && tokenStream(a.span) === tokenStream(b.span);

  if (identical || equivalent) {
    same += 1;
    if (name in KNOWN_DIVERGENT) {
      check(`${name}: listed as divergent but the copies now agree`, false,
        `— remove it from KNOWN_DIVERGENT (${PRESET}:${a.line} vs ${HOST}:${b.line})`);
    }
    continue;
  }

  if (name in KNOWN_DIVERGENT) {
    documented += 1;
    console.log(`[ok] ${name}: known divergence — ${KNOWN_DIVERGENT[name]}`);
    console.log(`     ${PRESET}:${a.line} (${a.span.split('\n').length} lines) vs ${HOST}:${b.line} (${b.span.split('\n').length} lines)`);
    continue;
  }

  undocumented += 1;
  check(`${name}: the two copies have drifted apart`, false, '');
  console.log(`     ${PRESET}:${a.line} (${a.span.split('\n').length} lines) vs ${HOST}:${b.line} (${b.span.split('\n').length} lines)`);
  console.log(`     Apply the change to BOTH, or record why they differ in KNOWN_DIVERGENT.`);
}

if (undocumented === 0) {
  check(`every shared symbol is in step or documented (${same} identical/equivalent, ${documented} documented divergence)`, true);
}

const failed = results.filter((r) => !r).length;
console.log('');
console.log(failed === 0
  ? `engine-sync: OK (${shared.length} shared symbols: ${same} in step, ${documented} documented divergences)`
  : `engine-sync: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
