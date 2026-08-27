import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncPresetTree, OWNER_MARKER } from '../dsh/host/preset-sync.mjs';

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed += 1; console.log('  ok  ' + label); }
  else { failed += 1; console.log('  FAIL ' + label); }
}

const root = mkdtempSync(join(tmpdir(), 'preset-sync-test-'));
const src = join(root, 'src');
const dst = join(root, 'dst');

const files = {
  'agent.cordis.yml': '# agent composition\n- id: persona\n',
  'preset.yml': 'name: test\n',
  'math-memory.mjs': 'export const name = "math-memory";\n',
  'note-tools.mjs': 'export const name = "note-tools";\n',
  'hook-frontmatter.mjs': 'export const parseHookFrontmatter = () => null;\n'
};
mkdirSync(src, { recursive: true });
for (const [rel, content] of Object.entries(files)) writeFileSync(join(src, rel), content, 'utf8');

const meta = { owner: 'npm', version: '0.8.0' };

// 1. fresh sync
let r = syncPresetTree(src, dst, meta);
check('fresh sync: changed', r.changed === true);
check('fresh sync: no failure', r.failed === null);
check('fresh sync: 5 files', r.files === 5);
check('fresh sync: owner marker written', existsSync(join(dst, OWNER_MARKER)));
const marker = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8'));
check('marker owner=npm', marker.owner === 'npm');
check('marker version=0.8.0', marker.version === '0.8.0');
check('marker has installedAt', typeof marker.installedAt === 'string');
check('agent.cordis.yml copied', readFileSync(join(dst, 'agent.cordis.yml'), 'utf8') === files['agent.cordis.yml']);

// 2. idempotent re-sync (byte-identical)
r = syncPresetTree(src, dst, meta);
check('re-sync: unchanged', r.changed === false);
check('re-sync: no failure', r.failed === null);
const marker2 = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8'));
check('re-sync: installedAt preserved', marker2.installedAt === marker.installedAt);

// 3. prune stray file, preserve marker
writeFileSync(join(dst, 'STRAY.txt'), 'stray\n', 'utf8');
r = syncPresetTree(src, dst, meta);
check('prune: changed', r.changed === true);
check('prune: 1 pruned', r.pruned === 1);
check('prune: stray removed', !existsSync(join(dst, 'STRAY.txt')));
check('prune: marker preserved', existsSync(join(dst, OWNER_MARKER)));

// 4. source change propagates
writeFileSync(join(src, 'note-tools.mjs'), 'export const name = "note-tools-v2";\n', 'utf8');
r = syncPresetTree(src, dst, meta);
check('update: changed', r.changed === true);
check('update: content propagated', readFileSync(join(dst, 'note-tools.mjs'), 'utf8') === 'export const name = "note-tools-v2";\n');

// 5. version bump rewrites marker + resets installedAt
const firstInstalled = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8')).installedAt;
syncPresetTree(src, dst, { owner: 'npm', version: '0.9.0' });
const marker3 = JSON.parse(readFileSync(join(dst, OWNER_MARKER), 'utf8'));
check('version bump: version=0.9.0', marker3.version === '0.9.0');
check('version bump: installedAt reset', marker3.installedAt !== firstInstalled);

// 6. missing agent.cordis.yml → reported failed
rmSync(join(src, 'agent.cordis.yml'), { force: true });
r = syncPresetTree(src, dst, meta);
check('validation: failed set', typeof r.failed === 'string');

rmSync(root, { recursive: true, force: true });
console.log(`preset-sync: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
