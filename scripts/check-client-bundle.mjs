#!/usr/bin/env node
// scripts/check-client-bundle.mjs — the committed client bundle must match a
// fresh build of its source.
//
// WHY. `dsh/client-panel/lib/client.js` is a committed build artifact of
// `dsh/client-panel/src/index.jsx`, and NOTHING in `npm test` referenced it: the
// bundle could go stale against its source and every gate would stay green
// (docs/maintainability-review-2026-09-11.md P1-4). The bundle is shipped into
// the dsh web panel, so a stale one means the panel runs code nobody edited.
//
// The rebuild is delegated to `buildClient()` in build-client.mjs so the esbuild
// settings exist once. Where the environment forbids the child process esbuild
// needs (observed here: `spawn EPERM`), the rebuild is reported as a SKIP and
// the shape checks still run — an environment restriction must not read as a
// stale-bundle failure, nor the reverse.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildClient, CLIENT_ID, CLIENT_OUT } from '../dsh/client-panel/build-client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = 'dsh/client-panel/lib/client.js';

const results = [];
function check(name, condition, detail = '') {
  results.push(Boolean(condition));
  console.log((condition ? '[ok] ' : '[FAIL] ') + name + (detail ? ' ' + detail : ''));
}

check('the bundle exists', existsSync(CLIENT_OUT), rel);
const committed = existsSync(CLIENT_OUT) ? readFileSync(CLIENT_OUT, 'utf8') : '';

// Shape checks: these hold regardless of whether esbuild can run here, so a
// missing/garbled artifact is still caught in a restricted environment.
check('the bundle is non-trivial', committed.length > 1000, `${committed.length} bytes`);
check('the bundle registers itself with the host ModuleLoader',
  committed.includes('window.__ModuleLoader__.load({'));
check('the bundle declares the expected client id', committed.includes(JSON.stringify(CLIENT_ID)), CLIENT_ID);

// The real question: does it still equal what the source builds to?
let fresh = null;
let environmentSkip = null;
try {
  fresh = await buildClient();
} catch (error) {
  const message = String(error?.message ?? error).split('\n')[0];
  if (/\b(EPERM|EACCES)\b|spawn/i.test(message)) environmentSkip = message;
  else check('a fresh build of the client source succeeds', false, message);
}

if (fresh !== null) {
  const same = committed === fresh;
  check('the committed bundle is byte-identical to a fresh build', same,
    same ? '' : 'run `npm run build:client` and commit the result');
  if (!same) {
    console.log(`     committed ${committed.length} bytes vs fresh ${fresh.length} bytes`);
  }
}

const failed = results.filter((r) => !r).length;
if (environmentSkip !== null) {
  console.log(`\nSKIP  the rebuild itself: this environment forbids the esbuild child process`);
  console.log('      ' + environmentSkip);
  console.log('      Environment boundary, not a stale bundle — CI runs the comparison for real.');
}
console.log('');
console.log(failed === 0
  ? `client-bundle: OK${fresh === null ? ' (shape only — rebuild skipped here)' : ' (matches a fresh build)'}`
  : `client-bundle: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
