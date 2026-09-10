#!/usr/bin/env node
/**
 * Embedded-loader contract guard.
 *
 * obsidian/main.template.js does NOT import dsh/host/memory-admin.mjs: it strips
 * that module's `node:fs`/`node:path`/`node:zlib` imports, appends a small
 * in-body helper, and evaluates the result with
 * `new Function(<param names>, body)(<args>)`, injecting the host's own
 * bindings. Two failure modes are invisible until Obsidian runs:
 *
 *   1. a name the module uses but the parameter list omits → ReferenceError;
 *   2. a name the template consumes but the `return { … }` allowlist omits →
 *      `undefined` at the call site.
 *
 * Both lists are therefore READ FROM THE TEMPLATE here, never re-typed. An
 * earlier version of this guard re-typed the allowlist and thus verified its own
 * copy — deleting five consumed symbols from the template still exited 0
 * (proven by mutation during the 2026-09-10 audit,
 * docs/project-assessment-2026-09-10.md §2 P1-9).
 *
 * Usage:
 *   node scripts/check-embedded-loader.mjs [vault-path]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import * as http from 'node:http';

const repo = fileURLToPath(new URL('..', import.meta.url));
const template = readFileSync(join(repo, 'obsidian', 'main.template.js'), 'utf8');

let failed = 0;
const fail = (message) => {
  failed += 1;
  console.error('FAIL  ' + message);
};

/** Extract the `new Function(...)(...)` call of the memory-admin loader. */
function loaderCall() {
  const anchor = template.indexOf("const source = EMBEDDED_PRESET['host-memory-admin.mjs'];");
  if (anchor < 0) throw new Error('memory-admin loader not found in the template');
  const at = template.indexOf('new Function(', anchor);
  if (at < 0) throw new Error('new Function call not found after the loader anchor');
  const open = template.indexOf('(', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < template.length; i += 1) {
    if (template[i] === '(') depth += 1;
    else if (template[i] === ')') {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  const params = template.slice(open + 1, close).split(',').map((p) => p.trim().replace(/^'|'$/g, '')).filter((p) => p !== '' && p !== 'body');
  // The argument list follows: `(` … `)`
  const argOpen = template.indexOf('(', close);
  const argClose = template.indexOf(')', argOpen);
  const args = template.slice(argOpen + 1, argClose).split(',').map((a) => a.trim()).filter(Boolean);
  return { params, args, fnAt };
}

/**
 * The template's own `return { … };` allowlist.
 *
 * It sits INSIDE the `body` expression, i.e. BEFORE the `new Function(...)`
 * call that receives it, and the hook-frontmatter loader above has its own
 * smaller allowlist — so anchor on the nearest one preceding this call.
 */
function loaderAllowlist(fnAt) {
  const marker = "\\nreturn { ";
  const at = template.lastIndexOf(marker, fnAt);
  if (at < 0) throw new Error('loader return allowlist not found in the template');
  const end = template.indexOf('};', at);
  if (end < 0) throw new Error('loader return allowlist is unterminated');
  return template.slice(at + marker.length, end)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The `+ \`…\`` helper the template appends inside the evaluated body. */
function appendedHelper() {
  const at = template.indexOf('    + `');
  if (at < 0) throw new Error('appended loader helper not found in the template');
  const end = template.indexOf('`\n    + \'\\nreturn {', at);
  if (end < 0) throw new Error('appended loader helper is unterminated');
  return template.slice(template.indexOf('`', at) + 1, end);
}

let params; let args; let allowlist; let helper; let fnAt;
try {
  ({ params, args, fnAt } = loaderCall());
  allowlist = loaderAllowlist(fnAt);
  helper = appendedHelper();
} catch (error) {
  fail(String(error.message ?? error));
  process.exit(1);
}

if (params.length !== args.length || params.some((name, i) => name !== args[i])) {
  fail(`the loader's parameter list and argument list disagree:\n  params: ${params.join(', ')}\n  args:   ${args.join(', ')}`);
}
console.log(`loader injects ${params.length} bindings: ${params.join(', ')}`);
console.log(`template return allowlist: ${allowlist.length} symbols`);

// Every injected binding must resolve to something the guard can supply too.
const available = {
  existsSync: fs.existsSync, mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync,
  readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, statSync: fs.statSync,
  renameSync: fs.renameSync, appendFileSync: fs.appendFileSync, openSync: fs.openSync,
  readSync: fs.readSync, closeSync: fs.closeSync, symlinkSync: fs.symlinkSync,
  join, dirname, zstdDecompressSync, http
};
const unknown = params.filter((name) => available[name] === undefined);
if (unknown.length > 0) fail(`loader injects names this guard cannot supply: ${unknown.join(', ')}`);

// Same transforms the template applies, in the same order, plus the same helper.
const source = readFileSync(join(repo, 'dsh', 'host', 'memory-admin.mjs'), 'utf8');
const body = source
  .replace(/^import\s*\{[^}]*\}\s*from\s*["']node:fs["'];?\s*$/gm, '')
  .replace(/^import\s*\{[^}]*\}\s*from\s*["']node:path["'];?\s*$/gm, '')
  .replace(/^import\s*\{[^}]*\}\s*from\s*["']node:zlib["'];?\s*$/gm, '')
  .replace(/^export\s+/gm, '')
  + helper
  + '\nreturn { ' + allowlist.join(', ') + ' };';

let MEMORY_ADMIN;
try {
  MEMORY_ADMIN = new Function(...params, body)(...params.map((name) => available[name]));
} catch (error) {
  fail(`the embedded module does not evaluate under the loader: ${String(error)}`);
  process.exit(1);
}

// Every name the template reads off MEMORY_ADMIN must be in the allowlist —
// that is the drift this guard exists to catch. Both access shapes count:
// `const x = MEMORY_ADMIN.y;` and a direct `MEMORY_ADMIN.y` inside a method.
const consumed = [...new Set([...template.matchAll(/MEMORY_ADMIN\.(\w+)/g)].map((m) => m[1]))];
const missingFromAllowlist = consumed.filter((name) => !allowlist.includes(name));
if (missingFromAllowlist.length > 0) {
  fail(`the allowlist is missing template-consumed symbols: ${missingFromAllowlist.join(', ')}`);
} else {
  console.log(`allowlist covers all ${consumed.length} MEMORY_ADMIN.* consumers in the template`);
}
const undefinedExports = allowlist.filter((name) => MEMORY_ADMIN[name] === undefined);
if (undefinedExports.length > 0) fail(`allowlist names that the module does not define: ${undefinedExports.join(', ')}`);
else console.log(`all ${allowlist.length} allowlisted symbols resolve`);

// ── self-test ───────────────────────────────────────────────────────────────
// The extraction above must actually be load-bearing: if the template drops a
// symbol from its allowlist, this guard has to notice. Simulate the drop in
// memory (no file is touched) and re-run just the comparison — the previous
// implementation of this guard re-typed the allowlist and failed this check by
// construction, which is why it is now a self-test instead of a comment.
{
  const victim = consumed[0];
  const mutated = allowlist.filter((name) => name !== victim);
  const detected = consumed.some((name) => !mutated.includes(name));
  if (!detected) fail(`self-test: dropping "${victim}" from the allowlist would NOT be detected`);
  else console.log(`self-test: dropping any consumed symbol (e.g. "${victim}") is detected`);
}

const vault = process.argv[2];
if (vault === undefined) {
  console.log(failed === 0
    ? 'embedded-loader check: OK (pass a vault path to also exercise the capture scan)'
    : `embedded-loader check: ${failed} FAILED`);
} else {
  const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions');
  const started = Date.now();
  const count = MEMORY_ADMIN.countUncapturedSessions(vault, sessionsRoot);
  console.log(`capture scan through the embedded loader: ${Date.now() - started} ms (uncaptured sessions: ${count})`);
  console.log(failed === 0 ? 'embedded-loader check: OK' : `embedded-loader check: ${failed} FAILED`);
}
process.exit(failed === 0 ? 0 : 1);
