#!/usr/bin/env node
/**
 * check-profile-contract — "谁往 profile 里放了什么"只有一处说法，且那份说法与现实一致。
 *
 * 为什么需要它（2026-09-26，解耦第 2 步 / `docs/decoupling-assessment-2026-09-26.md` §5 方案 A）：
 * `docs/decoupling-assessment-2026-09-26.md` §3.7 把 46 起跨边界事故归了簇，其中 **10 起**是
 * "契约/枚举未同步"——一侧改了形状，另一侧的清单没跟上。而"哪些文件要铺进 profile"这件事原本**手写在四处**
 * （仓库 deployer、CLI 安装器、Obsidian 引导、面板路由链），实测本机出现过其中一处少两个名字就让
 * `--direct` 装出来的 profile 每一轮会话都失败。现在有 `dsh/preset/profile-contract.mjs` 作为唯一陈述。
 *
 * 本门禁做两类事，并**明说每一条属于哪类**（否则"契约化"会退化成多一份文档）：
 *   READ   —— 代码**真的读**契约的地方，断言读到的就是契约（漂移在结构上不可能）；
 *   PINNED —— 代码**还没读**契约的地方，从源码里提取事实与契约比对（漂移会被这条抓住）。
 *
 * 变异验证（见 docs/changelog.md 当天 B2 节）：
 *   ① 从契约删一个 presetBodyFiles 项 ⇒ READ-1 与 PINNED-1 红；
 *   ② 给契约加一个不存在的文件名 ⇒ PINNED-2 红（**这条正是实测中静默跳过的那一类**）；
 *   ③ 只改面板源码里一条路由 ⇒ PINNED-3 红；
 *   ④ 只改模板里的文件清单 ⇒ PINNED-4 红。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_BODY_FILES } from '../dsh/preset/preset-deploy.mjs';
import { PRESET_BODY_FILES as CONTRACT_BODY, PROFILE_SCAFFOLD_FILES, OVERLAY_ROWS, PANEL_ROUTES, OWN_ROW_ID_PATTERN } from '../dsh/preset/profile-contract.mjs';
import { DIRECT_PROFILE_FILES } from '../dsh/install.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`[ok] ${label}${detail === '' ? '' : ` | ${detail}`}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${label}${detail === '' ? '' : ` | ${detail}`}`);
  }
};
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

// ── PINNED-1 / READ-1: the preset body list ─────────────────────────────────
check('READ-1 preset-deploy 再导出的 body 清单就是契约里那份',
  sameSet(PRESET_BODY_FILES, CONTRACT_BODY), PRESET_BODY_FILES.join(', '));
check('PINNED-1 CLI 安装器的 staged 集合 = 契约的 body ∪ scaffold',
  sameSet(DIRECT_PROFILE_FILES, [...CONTRACT_BODY, ...PROFILE_SCAFFOLD_FILES]),
  `installer=${DIRECT_PROFILE_FILES.length} contract=${CONTRACT_BODY.length + PROFILE_SCAFFOLD_FILES.length}`);

// ── PINNED-2: every contracted file must actually be stageable ──────────────
//
// 2026-09-26 实测：把 `profile-contract.mjs` 写进 scaffold 清单之后，安装器**一声不响地跳过了它**
// （它的 name→source 映射只认自己知道的名字）。于是"契约里写了、实际没铺"这种最危险的漂移可以完全静默。
// 这条从**两个安装源目录**里核实每个名字都有源文件，并单独核实 CLI 确实会写它。
const presetDir = join(root, 'dsh', 'preset');
const hostDir = join(root, 'dsh', 'host');
const profileDir = join(root, 'dsh', 'profile');
const sourceOf = (name) => [
  join(profileDir, name),
  join(presetDir, name),
  join(hostDir, name),
  join(profileDir, name.replace(/^profile-/, ''))
].find((p) => existsSync(p));
const unstaged = [...CONTRACT_BODY, ...PROFILE_SCAFFOLD_FILES].filter((name) => sourceOf(name) === undefined);
check('PINNED-2 契约里每个文件都能在仓库里找到源（找不到 = 安装器会静默跳过）',
  unstaged.length === 0, unstaged.join(', '));
const notActuallyStaged = [...CONTRACT_BODY, ...PROFILE_SCAFFOLD_FILES].filter((name) => !DIRECT_PROFILE_FILES.includes(name));
check('PINNED-2b 契约里每个文件都在 CLI 安装器的写入清单里（清单之外 = 契约说谎）',
  notActuallyStaged.length === 0, notActuallyStaged.join(', '));

// ── PINNED-3: the overlay row ids ───────────────────────────────────────────
//
// All THREE layers are scanned: the package patch (bundle channel), the profile's own patch layer
// (offline channel; the declaration's home since B3) and the overlay (`--patch`). The posture ids
// (persona / tool-fs / sandbox-policy …) belong to dsh-base, so "no extras" is scoped to ids that
// this plugin's naming rule claims (`OWN_ROW_ID_PATTERN`) — an extra `math-memory-*` row must not
// be possible to add without declaring it.
const rowIdsIn = (text) => [...text.matchAll(/^\s*-\s*id:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/gm)].map((m) => m[1]);
const allRowIds = [
  ...rowIdsIn(read('dsh/cordis.patch.yml')),
  ...rowIdsIn(read('dsh/profile/cordis.patch.yml')),
  ...rowIdsIn(read('dsh/profile/notes-assistant.patch.yml'))
];
const missingRows = OVERLAY_ROWS.filter((id) => !allRowIds.includes(id));
const ownRowPattern = new RegExp(OWN_ROW_ID_PATTERN);
const undeclaredRows = [...new Set(allRowIds)].filter((id) => ownRowPattern.test(id) && !OVERLAY_ROWS.includes(id));
check('PINNED-3 契约里的行 id 都在三个 patch 层里真实出现',
  missingRows.length === 0, `missing=${missingRows.join(',') || '-'}`);
check('PINNED-3b 三个 patch 层里没有"自家但没在契约里声明"的行 id',
  undeclaredRows.length === 0, `undeclared=${undeclaredRows.join(',') || '-'}`);

// ── PINNED-4: the panel routes ──────────────────────────────────────────────
const panelSource = read('dsh/host/math-memory-panel.mjs');
const servedRoutes = [...new Set([...panelSource.matchAll(/pathname === ["'](\/memory-panel\/[^"']+)["']/g)].map((m) => m[1]))];
const missingRoutes = PANEL_ROUTES.filter((route) => !servedRoutes.includes(route));
const undeclaredRoutes = servedRoutes.filter((route) => !PANEL_ROUTES.includes(route));
check('PINNED-4 契约里的路由与面板实际服务的路径互为子集（两侧都不许有多的）',
  missingRoutes.length === 0 && undeclaredRoutes.length === 0,
  `missing=${missingRoutes.join(',') || '-'} undeclared=${undeclaredRoutes.join(',') || '-'}`);

// ── READ-2: the Obsidian bootstrap now READS the contract (build-time injection) ──────────────
//
// Until 2026-09-26 this list was a hand-written literal inside the template — the fourth copy, and the
// one that actually broke `--direct` by missing two names. The bootstrap cannot import the contract
// (it must know the file list BEFORE it stages anything), so `scripts/build-obsidian.mjs` injects it
// through the same placeholder mechanism the preset JSON uses.
const template = read('obsidian/main.template.js');
check('READ-2 引导的 staging 清单来自构建期注入的契约（模板里不许再手写清单）',
  template.includes('JSON.parse("__PROFILE_CONTRACT_JSON__")') && !/const DIRECT_PROFILE_FILES = \[\s*'/.test(template),
  template.includes('JSON.parse("__PROFILE_CONTRACT_JSON__")') ? 'placeholder present' : 'placeholder MISSING');
const injected = JSON.stringify({
  presetBodyFiles: CONTRACT_BODY,
  profileScaffoldFiles: PROFILE_SCAFFOLD_FILES,
  overlayRows: OVERLAY_ROWS,
  panelRoutes: PANEL_ROUTES
});
check('READ-2b 生成物 main.js 里注入的契约与当前契约逐字节一致（改了契约没重建 ⇒ 红）',
  read('main.js').includes(JSON.stringify(injected)), `expects ${JSON.stringify(injected).length} chars`);

// ── PINNED-6: every contracted file must have a WRITE mechanism in BOTH writers ────────────────
//
// The 2026-09-26 experiment, in one sentence: `DIRECT_PROFILE_FILES` fed only the MANIFEST in both
// writers while the actual writes were hand-written calls, so a name added to the contract and not to
// those calls produced a profile whose own manifest claimed a file that was never written — and the
// installer still printed "Done". Both writers now throw at runtime (postcondition); this assertion
// catches the same class at PR time, before any install runs.
const installerSource = read('dsh/install.mjs');
const installerMentions = new Set([...installerSource.matchAll(/join\(profileRoot,\s*"([^"]+)"\)/g)].map((m) => m[1]));
// The preset body half goes through `deployPresetBody`, which writes every name it is handed.
const installerWrites = new Set([...installerMentions, ...(installerSource.includes('deployPresetBody(') ? CONTRACT_BODY : [])]);
const bootstrapWrites = new Set([...template.matchAll(/ensureFile\(join\(profileRoot,\s*'([^']+)'\)/g)].map((m) => m[1]));
// `notes-assistant.patch.yml` is GENERATED by `writeNotesAssistantPatch()` (its content embeds the
// plugin's own rows) rather than copied verbatim, so name that mechanism explicitly — this also pins
// the call itself: deleting it turns this assertion red instead of silently un-staging the overlay.
if (/writeNotesAssistantPatch\(plugin,\s*home\)/.test(template)) bootstrapWrites.add('notes-assistant.patch.yml');
const allContractFiles = [...CONTRACT_BODY, ...PROFILE_SCAFFOLD_FILES];
const missingWrite = {
  installer: allContractFiles.filter((name) => !installerWrites.has(name)),
  bootstrap: allContractFiles.filter((name) => !bootstrapWrites.has(name))
};
check('PINNED-6 契约里每个文件在两个写入方都有一条写入路径（列了不写 = manifest 说谎）',
  missingWrite.installer.length === 0 && missingWrite.bootstrap.length === 0,
  `installer=${missingWrite.installer.join(',') || '-'} bootstrap=${missingWrite.bootstrap.join(',') || '-'}`);

if (failed > 0) {
  console.error(`\nprofile-contract: ${failed} failed`);
  process.exit(1);
}
console.log(`profile-contract: ok (3 read + 7 pinned assertions; contract = dsh/preset/profile-contract.mjs)`);
