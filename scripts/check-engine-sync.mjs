// scripts/check-engine-sync.mjs — guard the two copies of the memory engine.
//
// WHY. The capture/distillation engine exists twice, because the two artifacts
// cannot share an import: `dsh/preset/math-memory.mjs` (156 top-level
// declarations) runs as a dsh preset, and `dsh/host/memory-admin.mjs` (62) runs
// inside the Obsidian plugin bundle, where it receives `fs`/`zlib` through the
// embedded loader instead of importing them (see check-embedded-loader.mjs).
// 23 top-level symbols are declared in BOTH files. The only sync mechanism was
// a comment in one of them ("keep the two in sync"), so a fix applied to one
// copy and forgotten in the other produced two different engines — each fully
// tested, neither test able to notice the other had drifted.
//
// WHAT IT ASSERTS.
// 1. BY NAME — every shared symbol is either the same code, or a divergence
//    somebody wrote down on purpose:
//      * identical / equivalent (comments, quote style, `export`, whitespace) -> ok
//      * divergent and listed in KNOWN_DIVERGENT with a reason               -> ok, reported
//      * divergent and NOT listed                                             -> FAIL
//      * listed but no longer divergent                                       -> FAIL (remove it;
//        a stale exemption list silently becomes a blanket permission to drift)
//      * the set of shared names changed                                      -> FAIL (decide
//        deliberately: share it, or rename it so the two are independent)
// 2. BY SHAPE (the name-blind sweep) — two declarations under DIFFERENT names
//    that are the same code. Name matching cannot see a renamed duplicate: the
//    `pathIsInside`/`pathInside` pair hid a shared security-relevant helper for
//    months (trap 64), and three more such pairs were found by hand on
//    2026-09-26. So every preset declaration is compared against every host
//    declaration whatever it is called, and any pair above ESCAPE_THRESHOLD must
//    be acknowledged in KNOWN_ESCAPES — with the same stale-entry rule, so that
//    deduping a pair forces the exemption to be removed rather than lingering.
//
// The comparison is a token stream, not raw bytes: quote style, comments, and
// the `export` keyword carry no meaning, and treating them as drift made most of
// the shared symbols look divergent when they are the same code.
//
// `node scripts/check-engine-sync.mjs --sweep` prints the highest-scoring
// cross-name pairs and the threshold, without failing — that is how the
// threshold was chosen and how to re-tune it after a refactor.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRESET = 'dsh/preset/math-memory.mjs';
const HOST = 'dsh/host/memory-admin.mjs';
/** Helpers merged into ONE implementation, imported by both engines (see its header). */
const SHARED_MODULE = 'dsh/preset/engine-shared.mjs';

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

/**
 * The same normalization as `tokenStream`, but as a token ARRAY — needed by the
 * name-blind sweep below, which compares token n-grams rather than strings.
 * String/template literals stay one token (their contents are part of what makes
 * two copies "the same code"); comments are gone.
 */
function tokenList(span) {
  const text = stripComments(span).replace(/^\s*export\s+/, '');
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const j = skipString(text, i);
      out.push(text.slice(i, j).replace(/\s+/g, ' '));
      i = j;
      continue;
    }
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j += 1;
      out.push(text.slice(i, j));
      i = j;
      continue;
    }
    // Multi-character operators would otherwise split into unrelated bigrams.
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    if (['===', '!==', '**=', '...', '>>>'].includes(three)) { out.push(three); i += 3; continue; }
    if (['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '+=', '-=', '*=', '/=', '%=', '++', '--', '**', '<<', '>>'].includes(two)) {
      out.push(two); i += 2; continue;
    }
    out.push(c);
    i += 1;
  }
  return out;
}

/** Adjacent-token pairs, as a set — the local shape of a piece of code. */
function bigrams(tokens) {
  const out = new Set();
  for (let i = 0; i + 1 < tokens.length; i += 1) out.add(tokens[i] + '\u0000' + tokens[i + 1]);
  return out;
}

/** Sørensen–Dice overlap of two token-bigram sets: 1 = same local shape. */
function dice(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const gram of a) if (b.has(gram)) hits += 1;
  return (2 * hits) / (a.size + b.size);
}

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
  // Added 2026-09-25 (dsh 0.1.7 / session format V4): the authority rule moved
  // from a single `.v3.` label to a generation number, so the parser is a real
  // shared helper. Pinned on purpose — the V3-era bug was a rule that knew only
  // one filename, and the earlier `pathIsInside`/`pathInside` split showed that
  // a renamed duplicate is invisible to this guard (trap 64).
  'artifactGeneration',
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

// ── the name-blind sweep ────────────────────────────────────────────────────
//
// WHY THIS EXISTS. Every verdict above pairs declarations BY NAME, so a duplicate
// that was renamed is invisible: `pathIsInside`/`pathInside` hid a shared
// security-relevant helper for months (trap 64). This sweep compares the local
// token shape of EVERY preset declaration against EVERY host declaration
// regardless of name, so "the same code under two names" shows up as a pair with
// a high score.
//
// It is deliberately a SHAPE comparison, not an equality test: near-duplicates
// that differ in a few identifiers (exactly what a rename looks like) score close
// to 1, while unrelated functions land far lower. Each pair found above the
// threshold must be acknowledged in KNOWN_ESCAPES with a reason — the same
// discipline as KNOWN_DIVERGENT, so it cannot silently become a blanket
// permission to drift, and a stale entry is itself a failure.

/**
 * Token-shape overlap at which two differently-named declarations are considered
 * the same code. MEASURED with `--sweep` (3537 cross-name pairs): the four
 * acknowledged pairs score 0.792–0.844, and the next candidate down is 0.662
 * (`parseLocalDay` ↔ `daysSinceText` — two short date helpers that merely share a
 * shape). 0.70 sits inside that gap, so the guard reports real duplicates without
 * asking anyone to acknowledge coincidences.
 */
const ESCAPE_THRESHOLD = 0.7;

/** Ignore short declarations: below this many tokens, everything looks like everything. */
const MIN_ESCAPE_TOKENS = 30;

/**
 * Renamed duplicates, and what to do about each. `action` is either 'dedup' (the
 * pair is on the P2-B list to collapse into one implementation) or 'structural'
 * (the host copy is a split/re-shaped version, so the real bodies are compared
 * here rather than by the name-based verdict).
 */
const KNOWN_ESCAPES = [
  {
    preset: 'decodeZstdSessionLog',
    host: 'decodeSessionLog',
    action: 'dedup',
    reason: 'the same zstd-frame decoder over the loader-injected decompressor (the same divergence KNOWN_DIVERGENT records for readSessionHeader) — merging it means PARAMETERIZING the decompressor, not copying one side'
  },
  {
    preset: 'runSessionCapture',
    host: 'scanSessionCapture',
    action: 'structural',
    reason: 'the host split the capture loop out of runSessionCapture (a 10-line wrapper + a 112-line loop), so the real bodies are compared HERE and not by the name-based verdict — which is exactly why that loop body could drift unnoticed'
  }
];

const shapeCache = new Map();
const shapeOf = (path, name, decl) => {
  const key = `${path}\u0000${name}`;
  if (!shapeCache.has(key)) {
    const tokens = tokenList(decl.span);
    shapeCache.set(key, { tokens, grams: bigrams(tokens) });
  }
  return shapeCache.get(key);
};

/** Every cross-name pair (`hostName !== presetName`) with a token-shape score. */
const crossNamePairs = [];
for (const [presetName, presetDecl] of preset) {
  const a = shapeOf(PRESET, presetName, presetDecl);
  if (a.tokens.length < MIN_ESCAPE_TOKENS) continue;
  for (const [hostName, hostDecl] of host) {
    if (hostName === presetName) continue; // owned by the name-based verdict
    const b = shapeOf(HOST, hostName, hostDecl);
    if (b.tokens.length < MIN_ESCAPE_TOKENS) continue;
    crossNamePairs.push({ presetName, hostName, score: dice(a.grams, b.grams), presetLine: presetDecl.line, hostLine: hostDecl.line });
  }
}
crossNamePairs.sort((x, y) => y.score - x.score);

// ── a shared helper must not be re-declared inside either engine ─────────────
//
// Since 2026-09-26 some duplicate helpers were MERGED into
// `dsh/preset/engine-shared.mjs` (one implementation, imported by both engines
// through the flat-sibling/shim pair). That closes one hole and opens another:
// copying such a helper back into ONE engine re-creates the duplicate WITHOUT
// producing an engine-to-engine pair, so the sweep above would not see it. Compare
// the shared module against both engines, any name, and fail on any hit — there is
// no exemption table here on purpose: a hit means "this helper now exists twice".
const sharedDecls = declarations(SHARED_MODULE);
const reappeared = [];
for (const [sharedName, sharedDecl] of sharedDecls) {
  const a = shapeOf(SHARED_MODULE, sharedName, sharedDecl);
  if (a.tokens.length < MIN_ESCAPE_TOKENS) continue;
  for (const [engineLabel, engine] of [['preset', preset], ['host', host]]) {
    for (const [engineName, engineDecl] of engine) {
      const b = shapeOf(engineLabel, engineName, engineDecl);
      if (b.tokens.length < MIN_ESCAPE_TOKENS) continue;
      const score = dice(a.grams, b.grams);
      if (score >= ESCAPE_THRESHOLD) {
        reappeared.push({ sharedName, engineName, engineLabel, score, sharedLine: sharedDecl.line, engineLine: engineDecl.line });
      }
    }
  }
}
reappeared.sort((x, y) => y.score - x.score);

if (process.argv.includes('--sweep')) {
  // A debugging affordance, like `run-gates --list`: show what the sweep sees and
  // where the threshold sits, without failing on it.
  console.log(`sweep: threshold ${ESCAPE_THRESHOLD}, min tokens ${MIN_ESCAPE_TOKENS}, ${crossNamePairs.length} cross-name engine pairs, ${sharedDecls.size} shared-module declarations`);
  for (const row of crossNamePairs.slice(0, 20)) {
    console.log(`  ${row.score.toFixed(3)}  ${row.presetName} (preset:${row.presetLine}) ↔ ${row.hostName} (host:${row.hostLine})`);
  }
  for (const row of reappeared) {
    console.log(`  ${row.score.toFixed(3)}  ${row.sharedName} (${SHARED_MODULE}:${row.sharedLine}) ↔ ${row.engineName} (${row.engineLabel}:${row.engineLine})   [re-declared shared helper]`);
  }
  process.exit(0);
}

for (const row of reappeared) {
  check(`shared helper re-declared: ${row.sharedName} (${SHARED_MODULE}) ↔ ${row.engineName} (${row.engineLabel})`, false,
    `score ${row.score.toFixed(3)}`);
  console.log(`     ${SHARED_MODULE}:${row.sharedLine} vs ${row.engineLabel === 'preset' ? PRESET : HOST}:${row.engineLine}`);
  console.log('     Import it from ./engine-shared.mjs instead of copying it back — the copy is invisible to the engine-to-engine sweep.');
}

const escapeTable = new Map(KNOWN_ESCAPES.map((e) => [`${e.preset}\u0000${e.host}`, e]));
const matchedEscapes = new Set();
let escapesFound = 0;
for (const hit of crossNamePairs) {
  if (hit.score < ESCAPE_THRESHOLD) break;
  const key = `${hit.presetName}\u0000${hit.hostName}`;
  matchedEscapes.add(key);
  const where = `${PRESET}:${hit.presetLine} vs ${HOST}:${hit.hostLine}`;
  const entry = escapeTable.get(key);
  if (entry === undefined) {
    check(`renamed duplicate (${hit.score.toFixed(3)}): ${hit.presetName} (preset) ↔ ${hit.hostName} (host)`, false, '');
    console.log(`     ${where}`);
    console.log('     Two differently-named declarations are the same code. Either share one implementation, or record the pair in KNOWN_ESCAPES with the reason it must stay separate.');
  } else {
    escapesFound += 1;
    console.log(`[ok] known escape (${entry.action}, ${hit.score.toFixed(3)}) ${hit.presetName} ↔ ${hit.hostName} — ${entry.reason}`);
    console.log(`     ${where}`);
  }
}

let staleEscapes = 0;
for (const entry of KNOWN_ESCAPES) {
  if (matchedEscapes.has(`${entry.preset}\u0000${entry.host}`)) continue;
  staleEscapes += 1;
  check(`KNOWN_ESCAPES entry ${entry.preset} ↔ ${entry.host} no longer looks like the same code`, false,
    `score fell below ${ESCAPE_THRESHOLD} — if it was deduped, remove the entry and say so in docs/changelog.md`);
}

const failed = results.filter((r) => !r).length;
console.log('');
console.log(failed === 0
  ? `engine-sync: OK (${shared.length} shared symbols: ${same} in step, ${documented} documented divergences; ${escapesFound}/${KNOWN_ESCAPES.length} renamed duplicates acknowledged, ${staleEscapes} stale, none new)`
  : `engine-sync: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
