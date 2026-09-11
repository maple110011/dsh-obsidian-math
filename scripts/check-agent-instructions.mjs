/**
 * check-agent-instructions — exactly ONE auto-discovered instruction file, and it
 * is the repo-maintenance protocol.
 *
 * Why this guard exists
 * ---------------------
 * Agent harnesses auto-discover instruction files by NAME and LOCATION
 * (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`,
 * …) and inject their contents as if a human had typed them. So a file that was
 * written for a DIFFERENT audience silently becomes an instruction to whoever
 * maintains the repo. Two real incidents here:
 *
 *   1. `dsh/templates/AGENTS.md` — the teaching protocol that gets installed
 *      into a USER's vault — was auto-injected into the maintainer's context
 *      (~200 lines, including hard constraints that conflict with maintaining
 *      this repo). Fixed by renaming the source to `vault-AGENTS.md` and keeping
 *      the installed name via `templates-manifest.json`.
 *   2. `scripts/qa/benchmark-vault/AGENTS.md` — the SYNTHETIC benchmark vault's
 *      protocol — was auto-injected whenever anything under that fixture was
 *      touched. Fixed by renaming it to `vault-AGENTS.md` (2026-09-11); the
 *      harness then reported "Instructions removed: …", which is the proof.
 *
 * The rule this guard enforces: **one** auto-discovered file, at the repo root,
 * holding the maintenance protocol. A second one is almost always a document
 * written for someone else, and the fix is to rename the SOURCE (never the
 * installed name) or to move the file out of an auto-discovered location.
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Names a harness may pick up on its own. Kept deliberately broad: a false
// positive here is a cheap conversation, a missed injection is a wrong order
// executed by an agent.
const AUTO_DISCOVERED = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  'copilot-instructions.md'
];

// The only permitted location, with the reason it is permitted.
const ALLOWED = new Map([
  ['AGENTS.md', 'the repository-maintenance protocol (what this repo wants an agent to do)']
]);

const files = [];
const walk = (d) => {
  for (const entry of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const p = join(d, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (AUTO_DISCOVERED.includes(entry.name)) files.push(p);
  }
};
walk(root);

let failed = 0;
const found = files.map((f) => relative(root, f).replace(/\\/g, '/')).sort();

for (const rel of found) {
  const base = rel.split('/').pop();
  const isRoot = !rel.includes('/');
  if (!ALLOWED.has(base)) {
    console.log(`[INJECTED] ${rel}`);
    console.log(`           \`${base}\` is auto-discovered by agent harnesses but is not a permitted instruction file.`);
    console.log('           Fix: rename the SOURCE (keep any installed name via a manifest) or move it out of the');
    console.log('           auto-discovered location — do not leave a document for another audience where a');
    console.log('           harness will read it as an instruction to maintain THIS repo.');
    failed += 1;
  } else if (!isRoot) {
    console.log(`[INJECTED] ${rel}`);
    console.log(`           \`${base}\` is permitted only at the repository ROOT, not in a subdirectory.`);
    failed += 1;
  }
}

// A guard that finds nothing must not report success — if the walk breaks, the
// one file that SHOULD exist disappears and this check would pass vacuously.
if (found.length === 0) {
  console.log('[FAIL] found no auto-discovered instruction file at all — the walk is broken, or the root AGENTS.md is missing');
  failed += 1;
} else if (failed === 0) {
  console.log(`agent-instructions: ok (${found.length} auto-discovered file: ${found.join(', ')} — the maintenance protocol)`);
}

if (failed > 0) {
  console.log(`\n${failed} auto-discovered instruction file(s) that should not be there.`);
  process.exit(1);
}
