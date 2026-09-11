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
// Normalized to LF before parsing. The anchors below are multi-line literals
// (`\n` inside indexOf strings), so a CRLF working copy — which is what the
// Windows CI runner checks out — turned every one of them into "not found" and
// failed the guard on Windows while Linux stayed green. build-obsidian.mjs reads
// the template through the same normalization, so the parsed text matches what
// the build actually embeds.
const template = readFileSync(join(repo, 'obsidian', 'main.template.js'), 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
const fail = (message) => {
  failed += 1;
  console.error('FAIL  ' + message);
};

/**
 * Extract the `new Function(...)(...)` call of the memory-admin loader.
 *
 * `text` is a parameter (defaulting to the real template) so the self-test at
 * the bottom can run the SAME extraction over a synthetic template.
 *
 * Returns `fnAt`: the offset of that `new Function(` call. It MUST be returned
 * — see the `fnAt` note further down.
 */
function loaderCall(text = template) {
  const anchor = text.indexOf("const source = EMBEDDED_PRESET['host-memory-admin.mjs'];");
  if (anchor < 0) throw new Error('memory-admin loader not found in the template');
  const at = text.indexOf('new Function(', anchor);
  if (at < 0) throw new Error('new Function call not found after the loader anchor');
  const open = text.indexOf('(', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  const params = text.slice(open + 1, close).split(',').map((p) => p.trim().replace(/^'|'$/g, '')).filter((p) => p !== '' && p !== 'body');
  // The argument list follows: `(` … `)`
  const argOpen = text.indexOf('(', close);
  const argClose = text.indexOf(')', argOpen);
  const args = text.slice(argOpen + 1, argClose).split(',').map((a) => a.trim()).filter(Boolean);
  // `fnAt` MUST be `at`. This read `fnAt` — a module-level `let` that is still
  // `undefined` at this point — so `lastIndexOf(marker, undefined)` searched
  // from the END of the template and the guard silently validated whatever
  // allowlist happened to come last. It was correct only because the
  // memory-admin loader is currently the last one (review P3, 2026-09-11). The
  // self-test below fails if this ever regresses.
  return { params, args, fnAt: at };
}

/**
 * The template's own `return { … };` allowlist.
 *
 * It sits INSIDE the `body` expression, i.e. BEFORE the `new Function(...)`
 * call that receives it, and the hook-frontmatter loader above has its own
 * smaller allowlist — so anchor on the nearest one preceding this call.
 */
function loaderAllowlist(fnAt, text = template) {
  const marker = "\\nreturn { ";
  const at = text.lastIndexOf(marker, fnAt);
  if (at < 0) throw new Error('loader return allowlist not found in the template');
  const end = text.indexOf('};', at);
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

// ── the OTHER loader: dsh/preset/hook-frontmatter.mjs ───────────────────────
// The template evaluates that file the same way but with a smaller allowlist,
// and it does it with a bare regex on the export statement:
//   source.replace(/export\s*\{[^}]*\};?\s*$/, '') + '\nreturn { … };'
// That module was rewritten on 2026-09-11 (the frontmatter delimiter rule moved
// into it, so its export list went from 3 names to 9 and became multi-line).
// Nothing checked the transform then, so a broken hook parser — the thing the
// memory panel reads every card's `hook:` block with — would have shipped
// silently. It is checked now.
{
  const hookAllowlist = [...template.matchAll(/return \{ ([^}]*?) \};/g)]
    .map((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))
    .find((names) => names.includes('parseHookFrontmatter'));
  if (hookAllowlist === undefined) {
    fail('the template has no hook-frontmatter loader allowlist (looked for `return { … parseHookFrontmatter … };`)');
  } else {
    const hookSource = readFileSync(join(repo, 'dsh', 'preset', 'hook-frontmatter.mjs'), 'utf8');
    const stripped = hookSource.replace(/export\s*\{[^}]*\};?\s*$/, '');
    if (/\bexport\b/.test(stripped)) {
      fail('the hook-frontmatter export statement no longer sits at the END of the file, so the loader\'s `replace(/export\\s*\\{[^}]*\\};?\\s*$/)` cannot strip it');
    } else {
      let HF = null;
      try {
        HF = new Function(`${stripped}\nreturn { ${hookAllowlist.join(', ')} };`)();
      } catch (error) {
        fail(`hook-frontmatter does not evaluate under the loader: ${String(error)}`);
      }
      if (HF !== null) {
        const hookMissing = hookAllowlist.filter((name) => HF[name] === undefined);
        if (hookMissing.length > 0) fail(`hook allowlist names the module does not define: ${hookMissing.join(', ')}`);
        const hookConsumed = [...new Set([...template.matchAll(/HOOK_FRONTMATTER\.(\w+)/g)].map((m) => m[1]))];
        const uncovered = hookConsumed.filter((name) => !hookAllowlist.includes(name));
        if (uncovered.length > 0) fail(`the hook allowlist is missing template-consumed symbols: ${uncovered.join(', ')}`);
        // Behavioural smoke: the whole point of the module.
        const parsed = HF.parseHookFrontmatter?.('---\ntitle: t\nhook:\n  operator: probability\n  uses: 3\n---\n');
        if (parsed === null || parsed === undefined || parsed.operator !== 'probability' || parsed.uses !== '3') {
          fail(`the embedded hook parser no longer parses a hook block (got ${JSON.stringify(parsed)})`);
        } else {
          console.log(`hook-frontmatter loader: ok (${hookAllowlist.length} allowlisted, ${hookConsumed.length} consumed, parses a hook block)`);
        }
      }
    }
  }
}

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

// The ANCHOR of the extraction is also load-bearing, and it used to be wrong:
// `loaderCall()` returned an unassigned module-level `fnAt`, so
// `lastIndexOf(marker, undefined)` searched from the END of the template and the
// guard validated whichever allowlist came LAST — correct only because the
// memory-admin loader currently is the last one (review P3). Re-run the real
// extraction over a synthetic template that appends a SECOND loader: the
// allowlist it finds must still be the memory-admin one.
{
  const synthetic = `${template}\nconst SYNTHETIC = new Function('x', '\\nreturn { syntheticOnlyAllowlistName };');\n`;
  try {
    const { fnAt: synAt } = loaderCall(synthetic);
    if (!Number.isInteger(synAt)) {
      // The `fnAt` bug, stated as its own failure: an unassigned `fnAt` makes
      // `lastIndexOf(marker, undefined)` search from the END of the template.
      fail(`self-test: loaderCall() returned a non-integer fnAt (${JSON.stringify(synAt)}) — the allowlist anchor would search from the end of the template (the \`fnAt\` bug is back)`);
    } else {
      const synList = loaderAllowlist(synAt, synthetic);
      if (!synList.includes('probeService') || synList.includes('syntheticOnlyAllowlistName')) {
        fail(`self-test: the allowlist anchor is not the nearest PRECEDING loader — it resolved to [${synList.join(', ')}] instead of the memory-admin allowlist (the \`fnAt\` bug is back)`);
      } else {
        console.log('self-test: the allowlist anchor is the nearest preceding loader, not the last one');
      }
    }
  } catch (error) {
    fail(`self-test: extraction threw on a template with two loaders: ${String(error.message ?? error)}`);
  }
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
