/**
 * Locate dsh's OWN tool-output JSON-Schema validator, wherever this machine happens to keep it.
 *
 * WHY THIS EXISTS (2026-10-01, found while auditing the 0.2.0-rc.2 adaptation)
 * ---------------------------------------------------------------------------
 * Both tool suites (`test-tool-schemas.mjs` ② and `test-tool-shape.mjs` ②b) gate their ONLY
 * dsh-validator assertions on `<DSH_HOME>/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js`.
 * That path does not exist on a machine whose dsh came from `npm i -g`: the bundled packages live
 * INSIDE the global install (`<npm-global>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/…`).
 * Measured here 2026-10-01: that hardcoded path was absent, so both blocks printed `[skip]` — while the
 * gate summary still read `ok … (9/9 checks)`. So the repo's claim "tool schemas are validated against
 * dsh's own validator" was TRUE OF THE CODE and FALSE OF THE RUN: a vacuous green, the exact shape
 * `AGENTS.md` §4 warns about (a green that covers fewer assertions than it appears to).
 *
 * It matters more than usual right now: validating our `output.schema` against the validator that ships
 * with the host IS the adaptation evidence for a host upgrade. A check that silently skips cannot
 * testify about 0.2.0-rc.2.
 *
 * The candidate order mirrors the convention already used by `check-client-package-layout.mjs` and
 * `check-plugin-manifest-meta.mjs`; `DSH_TOOLS_PATH` overrides everything for a non-standard layout or
 * for pointing the suites at another version deliberately.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REL = ['lib', 'index.js'];

/** Every place this repo expects to find a bundled dsh package, most specific first. */
export function dshToolsCandidates() {
  const out = [];
  const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE ?? '', '.dsh');
  // The layout this repo originally assumed: hoisted next to the profiles.
  out.push(join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', ...REL));
  // Also check the profile our plugin installs into — a profile-local (non-hoisted) install.
  for (const profile of ['notes-assistant', 'web', 'tui']) {
    out.push(join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-tools', ...REL));
  }
  // The npm-global install: the bundled siblings live under the dsh package's own node_modules.
  // Uses `homedir()` rather than reading the POSIX home variable directly — that would add a second
  // undocumented platform variable to `docs/env-vars.md`, and the repo standardizes on `homedir()`.
  const npmGlobal = process.env.APPDATA
    ? join(process.env.APPDATA, 'npm', 'node_modules')
    : join(homedir(), '.npm-global', 'lib', 'node_modules');
  out.push(join(npmGlobal, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', ...REL));
  // A dsh installed as a project dependency (or a source checkout linked into one).
  out.push(join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-tools', ...REL));
  return out;
}

/**
 * The validator to use, or `null`.
 *
 * `DSH_TOOLS_PATH` is a HARD override, not the first candidate: when it is set, it is the answer.
 * If it is set and does not exist we return `null` rather than falling through to some other copy —
 * because the entire point of setting it is "validate against THIS version", and quietly testing a
 * different one while reporting success is the same silent-substitution class this module exists to
 * remove. (Verified 2026-10-01: with the override unset, 7 candidates are tried and the npm-global
 * 0.2.0-rc.2 copy is found.)
 *
 * `null` means "we could not find the validator the caller asked for" — callers must then SKIP loudly
 * and name the paths they tried, rather than reporting the assertion as passed.
 */
export function findDshToolsValidator() {
  const override = process.env.DSH_TOOLS_PATH;
  if (typeof override === 'string' && override !== '') {
    return existsSync(override) ? override : null;
  }
  for (const candidate of dshToolsCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** A one-line explanation of the search, for a SKIP message that a reader can act on. */
export function dshToolsSearchHint() {
  const override = process.env.DSH_TOOLS_PATH;
  if (typeof override === 'string' && override !== '') {
    return `DSH_TOOLS_PATH is set to "${override}" but nothing is there — unset it to search, or fix the path`;
  }
  return `tried: ${dshToolsCandidates().join(' , ')} (set DSH_TOOLS_PATH to override)`;
}
