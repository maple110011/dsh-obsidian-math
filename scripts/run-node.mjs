// scripts/run-node.mjs — run a Node child process and capture its output WITHOUT
// using a pipe.
//
// WHY THIS EXISTS. `spawnSync(node, args)` captures stdout/stderr through pipes.
// In environments that forbid pipe stdio for child processes the child never
// starts: the call fails with `spawn EPERM`, `stdout` comes back empty, and the
// failure is indistinguishable from a real crash of the thing being tested.
// Measured consequences (2026-09-11 maintainability review):
//
//   * `npm test` aborted its `&&` chain at the 5th gate and silently skipped the
//     16 gates after it, so one red run said nothing about the other 16.
//   * `check-doc-consistency.mjs` got no output from any suite, read the count as
//     0, and reported 18 phantom "docs drifted" errors (docs claimed 232 checks,
//     "actual" 0) — while the docs were in fact correct. The natural next move
//     for an agent is to "fix" the correct docs, which is the real damage.
//
// Redirecting the CHILD's stdio into real file descriptors is not a pipe, so it
// works in both restricted and normal environments and still captures
// everything. Verified directly in the restricted sandbox:
//   pipe    -> status=null error=EPERM stdout=undefined
//   file fd -> status=0    stdout="__CHECKS__ 5/5\n"
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @param args   argv passed to `process.execPath`
 * @param opts.cwd      working directory (suites read repo-relative paths)
 * @param opts.env      environment for the child
 * @param opts.echo     pass output straight to our own stdio instead of capturing
 * @param opts.timeoutMs kill the child after this long
 * @returns {{ status: number|null, output: string, stdout: string, spawnError: Error|null }}
 *   `spawnError` non-null means the child could not be started at all — which is
 *   an ENVIRONMENT result, not a test result, and callers must not report it as
 *   a failure of the code under test.
 */
export function runNode(args, { cwd = process.cwd(), env = process.env, echo = false, timeoutMs = 0 } = {}) {
  if (echo) {
    const r = spawnSync(process.execPath, args, {
      cwd, env, stdio: ['ignore', 'inherit', 'inherit'], timeout: timeoutMs || undefined
    });
    return { status: r.status, output: '', stdout: '', spawnError: r.error ?? null };
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-node-'));
  const logPath = join(dir, 'output.log');
  const fd = openSync(logPath, 'w');
  let r;
  try {
    // One file for both streams on purpose: a suite prints its checks to stdout
    // and the reason it died usually lands on stderr, so they must stay
    // interleaved in the order they happened.
    r = spawnSync(process.execPath, args, {
      cwd, env, stdio: ['ignore', fd, fd], timeout: timeoutMs || undefined
    });
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
  }

  let output = '';
  try { output = readFileSync(logPath, 'utf8'); } catch { /* the child wrote nothing */ }
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, output, stdout: output, spawnError: r.error ?? null };
}
