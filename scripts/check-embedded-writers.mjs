// Evaluate the plugin's EMBEDDED copy of memory-admin.mjs exactly the way
// obsidian/main.template.js does, then exercise the fixed writers through THAT
// copy.
//
// Why this check exists: the embedded half is what actually runs inside
// Obsidian, and the 2026-09-10 audit found the existing embedded-loader guard
// compares its own symbol list against itself (proven by mutation). This script
// instead rebuilds the loader's environment from the generated main.js and
// calls real functions, so "the code that ships runs" is asserted, not assumed.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, openSync, readSync, closeSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import * as http from 'node:http';

const main = readFileSync('main.js', 'utf8');

let failed = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failed += 1;
  console.log((condition ? '[ok] ' : '[FAIL] ') + name + (detail === '' ? '' : ' ' + detail));
};

/**
 * The embedded preset map: `JSON.parse("<json-encoded object>")`.
 * Scan the string literal properly (escapes included) instead of guessing where
 * it ends — a regex gets it wrong on the first `");` inside an embedded file.
 */
function embeddedPresetMap() {
  const marker = 'const EMBEDDED_PRESET = JSON.parse("';
  const at = main.indexOf(marker);
  if (at < 0) throw new Error('cannot locate the embedded preset map in main.js');
  let i = at + marker.length;
  let out = '';
  while (i < main.length) {
    const ch = main[i];
    if (ch === '\\') { out += ch + main[i + 1]; i += 2; continue; }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return JSON.parse(JSON.parse('"' + out + '"'));
}

// The embedded source must BE the shipped source, byte for byte. Editors of
// `dsh/host/memory-admin.mjs` who forget `node scripts/build-obsidian.mjs` would
// otherwise ship a bundle whose embedded half silently differs from the file
// every other test exercises — the exact class of drift the old
// check-embedded-loader.mjs could not see.
{
  const shipped = readFileSync('dsh/host/memory-admin.mjs', 'utf8');
  const okEmbedded = embeddedPresetMap()['host-memory-admin.mjs'] === shipped;
  check('main.js embeds the current dsh/host/memory-admin.mjs (no stale bundle)',
    okEmbedded,
    okEmbedded ? '' : 'run: node scripts/build-obsidian.mjs');
}

// Reproduce the plugin's own scope: EMBEDDED_PRESET + MEMORY_ADMIN, evaluated
// with the same injected bindings the template passes.
const start = main.indexOf('const EMBEDDED_PRESET = JSON.parse(');
const endMarker = 'const DEFAULT_SETTINGS';
const end = main.indexOf(endMarker);
if (start < 0 || end < 0) throw new Error('cannot locate the embedded block in main.js');
const prologue = main.slice(start, end);

// Keep the injected binding list in sync with the template's loader params; the
// loader guard (check-embedded-loader.mjs) reads the template's real list and
// fails loudly if the two ever disagree.
const factory = new Function(
  'existsSync', 'mkdirSync', 'writeFileSync', 'readFileSync', 'readdirSync', 'statSync', 'renameSync',
  'join', 'dirname', 'zstdDecompressSync', 'openSync', 'readSync', 'closeSync', 'http',
  prologue + '\nreturn MEMORY_ADMIN;'
);
const ADMIN = factory(existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, join, dirname, zstdDecompressSync, openSync, readSync, closeSync, http);

check('embedded loader materializes a MEMORY_ADMIN object', ADMIN !== null && typeof ADMIN === 'object');
const required = ['applyFeedback', 'archiveMemoryFile', 'setCapturePolicyMode', 'setSessionCapture', 'frontmatterSpan', 'replaceFrontmatter', 'pathInside', 'runSessionCapture'];
const missing = required.filter((k) => typeof ADMIN?.[k] !== 'function');
check('embedded loader exposes every writer the template consumes', missing.length === 0, missing.join(','));

const root = mkdtempSync(join(tmpdir(), 'dsh-embedded-'));
mkdirSync(join(root, '.deepseek', 'memory', 'records'), { recursive: true });

const card = join(root, '.deepseek', 'memory', 'records', 'c.md');
writeFileSync(card, '---\ntitle: 关于 $$ 的表示\nhook:\n  verified: single-source\n---\nbody\n', 'utf8');
const res = ADMIN.applyFeedback(card, 'confirm');
const after = readFileSync(card, 'utf8');
check('embedded applyFeedback preserves `$$` frontmatter (no $-expansion)',
  res.ok === true && after.includes('title: 关于 $$ 的表示') && after.includes('verified: user-confirmed'));

const empty = join(root, '.deepseek', 'memory', 'records', 'e.md');
writeFileSync(empty, '---\n\n---\nbody\n', 'utf8');
ADMIN.applyFeedback(empty, 'inapplicable');
const afterEmpty = readFileSync(empty, 'utf8');
check('embedded applyFeedback keeps an EMPTY frontmatter block well-formed',
  afterEmpty.startsWith('---\nlast_not_applicable: ') && afterEmpty.split('\n').filter((l) => l === '---').length === 2,
  JSON.stringify(afterEmpty));

writeFileSync(join(root, 'NOTE.md'), 'x\n', 'utf8');
const threw = (() => { try { ADMIN.archiveMemoryFile(root, ['NOTE.md']); return false; } catch { return true; } })();
check('embedded archiveMemoryFile refuses a plain note', threw && existsSync(join(root, 'NOTE.md')));

rmSync(root, { recursive: true, force: true });
console.log(failed === 0 ? '\nembedded-writers: OK' : `\nembedded-writers: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
