#!/usr/bin/env node
/**
 * Version-consistency guard.
 *
 * The project ships TWO artifacts off ONE version number:
 *   - the Obsidian plugin as a GitHub Release (main.js / manifest.json / styles.css),
 *     which Obsidian's installer fetches by the tag that equals `manifest.json`'s version;
 *   - the npm package `dsh-math-memory` (preset/profile/installer), published by
 *     npm-publish.yml from `package.json`.
 *
 * Nothing enforced that they agree, and they had drifted: package.json 0.7.3,
 * manifest.json 0.7.4, CHANGELOG heading 0.7.4, npm `latest` 0.7.1 — i.e. the
 * Obsidian side and the npm side advertised different builds, and neither matched
 * what was actually published (docs/project-assessment-2026-09-10.md §2 P1-14).
 *
 * Usage:
 *   node scripts/check-version-consistency.mjs            # local / CI (push)
 *   node scripts/check-version-consistency.mjs --tag 0.7.5  # release (tag push)
 *
 * With `--tag` the tag itself must equal the version, because a mismatch there
 * publishes a release whose assets disagree with its name.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? (args[tagIndex + 1] ?? '') : '';

let failed = 0;
const fail = (message) => { failed += 1; console.error('FAIL  ' + message); };
const ok = (message) => console.log('OK    ' + message);

/** Semver without a prerelease/build suffix — the only shape Obsidian accepts. */
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

const packageVersion = readJson('package.json').version;
const manifestVersion = readJson('manifest.json').version;
const lockVersion = existsSync(join(root, 'package-lock.json')) ? readJson('package-lock.json').version : undefined;
// `versions.json` is the version → minAppVersion map Obsidian reads when it
// decides which release a user may update to. A version that is absent from it
// is, for the installer, a version that does not exist — the exact failure mode
// this whole guard exists for.
const versionsMap = existsSync(join(root, 'versions.json')) ? readJson('versions.json') : undefined;

/** Newest version heading in CHANGELOG.md, skipping [Unreleased]. */
function newestChangelogVersion() {
  for (const line of read('CHANGELOG.md').split('\n')) {
    const m = /^## \[([^\]]+)\]/.exec(line);
    if (m === null) continue;
    if (m[1].toLowerCase() === 'unreleased') continue;
    return m[1];
  }
  return undefined;
}
const changelogVersion = newestChangelogVersion();

console.log(`package.json    ${packageVersion}`);
console.log(`manifest.json   ${manifestVersion}`);
console.log(`package-lock    ${lockVersion ?? '(absent)'}`);
console.log(`versions.json   ${versionsMap === undefined ? '(absent)' : Object.keys(versionsMap).join(', ') || '(empty)'}`);
console.log(`CHANGELOG.md    ${changelogVersion ?? '(no version heading)'}`);
if (tag !== '') console.log(`git tag         ${tag}`);
console.log('');

if (packageVersion !== manifestVersion) {
  fail(`package.json (${packageVersion}) and manifest.json (${manifestVersion}) disagree — the npm package and the Obsidian release would ship different builds`);
}
if (lockVersion !== undefined && lockVersion !== packageVersion) {
  fail(`package-lock.json (${lockVersion}) disagrees with package.json (${packageVersion}) — run npm install to refresh the lock`);
}
if (versionsMap === undefined) {
  fail('versions.json is missing — Obsidian\'s installer reads it to decide which release a user may update to');
} else if (typeof versionsMap[packageVersion] !== 'string' || versionsMap[packageVersion] === '') {
  fail(`versions.json has no "${packageVersion}" entry — add {"${packageVersion}": "<minAppVersion>"} (keep the older entries)`);
}
if (changelogVersion !== packageVersion) {
  fail(`CHANGELOG.md's newest version heading is ${changelogVersion ?? '(none)'}, package.json says ${packageVersion} — add a "## [${packageVersion}]" section`);
}
for (const [name, version] of [['package.json', packageVersion], ['manifest.json', manifestVersion]]) {
  if (!RELEASE_VERSION.test(String(version))) {
    fail(`${name} version "${version}" is not a plain x.y.z release version (Obsidian's community-plugin registry rejects prerelease tags)`);
  }
}
if (tag !== '' && tag !== packageVersion) {
  fail(`the pushed tag "${tag}" does not equal package.json version "${packageVersion}" — the release's own name would contradict its assets`);
}

/**
 * Living documents must declare the version they describe, as an exact line:
 *
 *     > 当前版本：0.7.5
 *
 * A prose version banner decays silently: `handoff.md` advertised 0.7.2 while
 * the repo was at 0.7.5, and `design.md` still said "v0.6.x 实现规格", so neither
 * a human nor an agent could tell the document was releases behind the code
 * (docs/maintainability-review-2026-09-11.md P1-2/P2-4). The exact marker keeps
 * this guard from mistaking a historical reference — "0.1.5 adaptation",
 * "0.7.2 时…" — for a claim about the present.
 */
const VERSION_BANNER = /^>\s*当前版本：(\d+\.\d+\.\d+)\s*$/m;
const bannerDocs = ['docs/handoff.md', 'docs/memory/design.md'];
for (const rel of bannerDocs) {
  const banner = VERSION_BANNER.exec(read(rel));
  if (banner === null) {
    fail(`${rel}: no "> 当前版本：${packageVersion}" banner — a living doc must declare the version it describes`);
  } else if (banner[1] !== packageVersion) {
    fail(`${rel}: declares 当前版本 ${banner[1]} but the repo is at ${packageVersion}`);
  } else {
    ok(`${rel}: 当前版本 ${banner[1]}`);
  }
}

/**
 * README 的版本声明。两个 README 都是**从代码里取真值**的活文档，不是历史记录：
 * `## Development & quality` 末尾那行 `- Version: **x.y.z**` 是读者（人和 agent）
 * 判断"这个包/插件现在是什么版本"的第一处，而它当时落在 0.7.5，仓库已经是 0.7.7
 * —— 五处版本号一致的门禁管不到 README，于是它腐烂了两个版本（0.7.6 / 0.7.7）。
 * 这里把它按与 `bannerDocs` 相同的精确标记比对，中英两侧都要写、且必须一致。
 */
for (const [rel, re] of [
  ['README.md', /^-\s*Version:\s*\*\*(\d+\.\d+\.\d+)\*\*/m],
  ['README.zh.md', /^-\s*版本：\s*\*\*(\d+\.\d+\.\d+)\*\*/m],
]) {
  const m = re.exec(read(rel));
  if (m === null) {
    fail(`${rel}: no "- Version/版本: **${packageVersion}**" line — the README is a living document and must state the version it describes`);
  } else if (m[1] !== packageVersion) {
    fail(`${rel}: declares version ${m[1]} but the repo is at ${packageVersion}`);
  } else {
    ok(`${rel}: version ${m[1]}`);
  }
}

if (failed === 0) {
  console.log(`\nversion-consistency: all artifacts agree on ${packageVersion}${tag === '' ? '' : ` and tag ${tag}`}`);
}
process.exit(failed === 0 ? 0 : 1);
