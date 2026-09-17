#!/usr/bin/env node
// scripts/check-readme-pair.mjs — 双语文档配对守卫（README.md ↔ README.zh.md）。
//
// WHY. README.md 与 README.zh.md 是同一个产品的两个门面：npm 包主页、Obsidian
// 插件页、GitHub 首屏。此前它们靠"记得同步"维护，于是 2026-09 出现了三类真实漂移：
//   ① zh 侧把「设置 → 第三方插件 → 搜索插件名安装」写成**可用**的安装方式，而
//      `dsh-math-assistant` 不在 `community-plugins.json` 里（docs/project-assessment
//      -2026-09-10.md 第 16 条判为 HIGH：文档声明了不存在的安装方式）；en 侧已改成
//      「尚未上架」并给了 BRAT 退路，zh 侧没有跟上；
//   ② 两侧的 `- Version:` 行都停在 0.7.5，仓库已在 0.7.7（0.7.6/0.7.7 两个版本的
//      落地清单都写着"README 中英同步"，但没有任何机器判定它）；
//   ③ 结构性缺口（zh 侧少掉的条目、少掉的设置项说明、层级不一致）只能靠人读出来。
//
// 守卫只判**当前内容**，不看历史，做五件事：
//   1. 一致性记录 `README.i18n.yaml`：两侧各自的 git blob hash。任一被改而未重新
//      记录 ⇒ 红，并**指出是哪一侧被编辑**——"哪一侧最近被改"就是"哪一侧是本次的源"，
//      这是仓库的既有约定（AGENTS.md §5 / ARCHITECTURE.md 落地清单：改一侧必须同步
//      另一侧）。记录把这个约定变成可核对的字节，而**不**引入第三份"权威原文"。
//   2. 结构签名：节数与顺序、各节的层级、每节的一级条目数、表格列数、一级条目总数。
//   3. 语言切换行（en 指 zh、zh 指回 en）。
//   4. 两侧的相对文档链接集合必须相同。本仓库**没有**第二语言文档语料（`docs/**`
//      与 `literature/**` 都只有中文一份），所以两侧指向同一批文件；"`.md` 对
//      `.zh.md`"那条规则属于真有双语语料的仓库，不适用于这里。
//   5. 围栏代码块的**代码骨架**：去掉行尾注释后逐行的首个 token（命令名 / 路径）必须
//      一致，`<…>` 占位符按语言各自本地化。注释的本地化是仓库的既定做法——
//      `check-doc-consistency.mjs` 正是锚在中文那一份的注释措辞上，所以"逐字节一致"
//      在这里会是错的规则。
//
// 守卫**不判断**语义、术语与语体——那是评审的另一半（dsh 仓库 docs/i18n 的同一分工：
// "门禁绿只等于这一组内容被确认过，不等于确认得对"）。
//
// 用法：
//   node scripts/check-readme-pair.mjs            # 校验（进 npm test）
//   node scripts/check-readme-pair.mjs --write    # 确认一致并重新记录两侧 hash
//   node scripts/check-readme-pair.mjs --json     # 机器可读输出
//   node scripts/check-readme-pair.mjs --selftest # 变异验证（见文件末尾）
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// 静态导入而不是在 CLI 分支里 `await import()`：本文件在 import 期就会执行到底部的
// CLI 分支，动态 import 与调用方之间会形成循环依赖，Node 直接报
// "Detected unsettled top-level await"（退出码 13）。
import { runSelfTest } from './qa/mutate-readme-pair.mjs';

export const EN = 'README.md';
export const ZH = 'README.zh.md';
export const RECORD = 'README.i18n.yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `git hash-object` 的等价实现：对文件字节做 `blob <len>\0<content>` 的 SHA-1。
 * 自己算而**不**调 git：未提交的文件同样能算（记录的意义就在于此），而且不产生子进程
 * ——受限环境里子进程可能根本起不来（scripts/run-node.mjs 与 handoff 坑 59）。
 *
 * **先把 CRLF 归一成 LF**：本仓库没有 `.gitattributes`，工作树里的换行取决于检出设置
 * （`README.zh.md` 在这台机器上是 CRLF、`README.md` 是 LF）。若按原样做 hash，同一份
 * 已提交内容在 Windows 与 Linux 上会算出不同的记录值 ⇒ 记录会在 CI 上假红。配对记录的
 * 语义是"两侧在**这些内容**上被确认过"，而换行不是内容。
 */
export const gitBlob = (text) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(text.replace(/\r\n/g, '\n'))}\0${text.replace(/\r\n/g, '\n')}`, 'utf8')
    .digest('hex');

/** 记录文件的形状与 dsh 仓库 docs/i18n 一致：`<文件>: <40 位 hash>`，可夹注释行。 */
export function parseRecord(text) {
  if (text === null) return null;
  const out = {};
  for (const m of text.matchAll(/^([\w.\-]+\.md):\s*([0-9a-f]{40})\s*$/gm)) out[m[1]] = m[2];
  return out;
}

/** 生成记录文件的内容（注释说明了记录语义与重新记录的命令）。 */
export function renderRecord(hashes) {
  return [
    '# README.md ↔ README.zh.md 一致性记录：两侧在上一次被确认「说同样的话」时的 git blob hash。',
    '# 两种语言同权：任何一侧被编辑后，请在同一次改动里补齐另一侧，然后运行',
    '#   node scripts/check-readme-pair.mjs --write',
    '# 重新记录。记录只说明"在这些字节上被确认过"，措辞与术语仍由评审负责。',
    `${EN}: ${hashes[EN]}`,
    `${ZH}: ${hashes[ZH]}`,
    '',
  ].join('\n');
}

// ── 结构 ────────────────────────────────────────────────────────────────────────
function emptyBlock() {
  return { heading: null, depth: 0, items: [], fences: [], tables: [], fenceBody: [] };
}

/** 拆出节、条目、围栏、表格。只认行首结构，不解析行内 markdown。 */
export function outline(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = { intro: emptyBlock(), sections: [] };
  let current = out.intro;
  let fence = null;
  let inTable = false;
  for (const line of lines) {
    if (fence !== null) {
      current.fenceBody.push(line);
      if (line.trim() === fence) {
        current.fences.push(current.fenceBody.join('\n'));
        fence = null;
        current.fenceBody = [];
      }
      continue;
    }
    const open = /^(```+|~~~+)/.exec(line);
    if (open) {
      fence = open[1];
      current.fenceBody = [line];
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      current = emptyBlock();
      current.heading = h[2].trim();
      current.depth = h[1].length;
      out.sections.push(current);
      inTable = false;
      continue;
    }
    if (/^\|/.test(line)) {
      if (!inTable) { current.tables.push(0); inTable = true; }
      current.tables[current.tables.length - 1] += 1;
      continue;
    }
    inTable = false;
    if (/^[-*+]\s+/.test(line)) current.items.push(line.replace(/^[-*+]\s+/, '').trim());
    else if (/^\d+\.\s+/.test(line)) current.items.push(line.trim());
  }
  return out;
}

/**
 * 代码骨架：去掉行尾注释后逐行的首个 token（命令名 / 路径），`<…>` 占位符归一成 `<>`。
 * 目录树行的行尾说明与命令行的行尾注释都是有意本地化的，不参与比较；命令与路径参与。
 */
export const skeleton = (fence) =>
  fence
    .split('\n')
    .slice(1, -1)
    .map((l) => l.replace(/\s+#.*$/, '').trim())
    .filter((l) => l !== '')
    .map((l) => l.split(/\s+/)[0].replace(/<[^>]*>/g, '<>'));

const relLinks = (text) =>
  [...text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((l) => l !== EN && l !== ZH)
    .sort();

/**
 * 纯函数：给定两侧文本与记录文本，返回问题清单与事实。
 * 不做任何 IO，也不 `process.exit` —— 变异验证（`--selftest`）要在同一进程里反复调用它。
 */
export function checkPair({ enText, zhText, recordText }) {
  const problems = [];
  const fail = (msg) => problems.push(msg);

  const en = outline(enText);
  const zh = outline(zhText);
  const headingLine = (o, i) => o.sections[i]?.heading ?? '(缺)';
  const enFences = en.sections.flatMap((s) => s.fences);
  const zhFences = zh.sections.flatMap((s) => s.fences);
  const enTables = en.sections.flatMap((s) => s.tables);
  const zhTables = zh.sections.flatMap((s) => s.tables);
  const enItems = en.sections.reduce((n, s) => n + s.items.length, 0) + en.intro.items.length;
  const zhItems = zh.sections.reduce((n, s) => n + s.items.length, 0) + zh.intro.items.length;

  if (en.sections.length !== zh.sections.length) {
    fail(`节数不同：${EN} ${en.sections.length} 节 vs ${ZH} ${zh.sections.length} 节`);
  } else {
    for (let i = 0; i < en.sections.length; i++) {
      if (en.sections[i].depth !== zh.sections[i].depth) {
        fail(`第 ${i + 1} 节的层级不同（同一节必须在两侧处于同一层级）：${EN}「${headingLine(en, i)}」h${en.sections[i].depth} vs ${ZH}「${headingLine(zh, i)}」h${zh.sections[i].depth}`);
        continue;
      }
      const a = en.sections[i].items.length;
      const b = zh.sections[i].items.length;
      if (a !== b) fail(`[${headingLine(en, i)}] 一级条目数不同：${EN} ${a} vs ${ZH} ${b}`);
    }
  }
  if (enItems !== zhItems) fail(`一级条目总数不同：${EN} ${enItems} vs ${ZH} ${zhItems}`);
  if (enFences.length !== zhFences.length) {
    fail(`围栏代码块数不同：${EN} ${enFences.length} vs ${ZH} ${zhFences.length}`);
  } else {
    const a = enFences.map(skeleton);
    const b = zhFences.map(skeleton);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      const where = a.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(b[i]));
      fail(`第 ${where + 1} 个围栏代码块的**代码骨架**不同（注释可以本地化，命令与路径不可以）：${EN} ${JSON.stringify(a[where])} vs ${ZH} ${JSON.stringify(b[where])}`);
    }
  }
  if (JSON.stringify(enTables) !== JSON.stringify(zhTables)) {
    fail(`表格行列数不同：${EN} ${JSON.stringify(enTables)} vs ${ZH} ${JSON.stringify(zhTables)}`);
  }

  const EN_SWITCH = '[简体中文](README.zh.md)';
  const ZH_SWITCH = '[English](README.md)';
  if (!enText.includes(EN_SWITCH)) fail(`${EN}: 顶部缺少语言切换行 ${EN_SWITCH}`);
  if (!zhText.includes(ZH_SWITCH)) fail(`${ZH}: 顶部缺少语言切换行 ${ZH_SWITCH}`);

  const enLinks = relLinks(enText);
  const zhLinks = relLinks(zhText);
  if (JSON.stringify(enLinks) !== JSON.stringify(zhLinks)) {
    const onlyEn = enLinks.filter((l) => !zhLinks.includes(l));
    const onlyZh = zhLinks.filter((l) => !enLinks.includes(l));
    fail(`两侧的相对链接集合不同：仅 ${EN} 有 ${JSON.stringify(onlyEn)}；仅 ${ZH} 有 ${JSON.stringify(onlyZh)}`);
  }

  const hashes = { [EN]: gitBlob(enText), [ZH]: gitBlob(zhText) };
  const record = parseRecord(recordText);
  let driftedSide = null;
  if (record === null) {
    fail(`缺少 ${RECORD} —— 首次建立配对时运行：node scripts/check-readme-pair.mjs --write`);
  } else {
    const changed = [EN, ZH].filter((side) => record[side] && record[side] !== hashes[side]);
    for (const side of [EN, ZH]) if (!record[side]) fail(`${RECORD}: 缺少 ${side} 的记录行`);
    if (changed.length > 0) {
      driftedSide = changed;
      const other = changed.length === 1 ? (changed[0] === EN ? ZH : EN) : null;
      fail(
        `${changed.join('、')} 与 ${RECORD} 的记录不一致 —— ` +
          (other === null
            ? '两侧都被改过，请确认它们说同样的话，然后重新记录'
            : `**${changed[0]} 是被编辑的一侧**，请在同一次改动里把 ${other} 补齐（措辞与术语按评审），然后运行 node scripts/check-readme-pair.mjs --write`),
      );
    }
  }

  return {
    problems,
    hashes,
    record,
    driftedSide,
    en: { sections: en.sections.length, items: enItems, fences: enFences.length, tables: enTables },
    zh: { sections: zh.sections.length, items: zhItems, fences: zhFences.length, tables: zhTables },
  };
}

/** 从磁盘读三份文件并跑一次 checkPair。 */
export function checkFromDisk(baseDir = root) {
  const read = (rel) => readFileSync(join(baseDir, rel), 'utf8');
  const recordRel = join(baseDir, RECORD);
  return checkPair({
    enText: read(EN),
    zhText: read(ZH),
    recordText: existsSync(recordRel) ? readFileSync(recordRel, 'utf8') : null,
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
// 只有在被**直接执行**时才跑 CLI：被 import 时必须保持无副作用，否则 `--selftest`
// 与任何想复用 `checkPair`/`outline` 的调用方都会顺带跑一次真实校验并打印。
const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === join(process.argv[1]);
const args = invokedDirectly ? process.argv.slice(2) : [];
const write = args.includes('--write');
const asJson = args.includes('--json');

if (!invokedDirectly) {
  // 作为模块被导入：到此为止。
} else if (args.includes('--selftest')) {
  const r = runSelfTest({ enText: readFileSync(join(root, EN), 'utf8'), zhText: readFileSync(join(root, ZH), 'utf8') });
  for (const line of r.lines) console.log(line);
  process.exit(r.ok ? 0 : 1);
} else if (write) {
  const result = checkFromDisk();
  // `--write` 只重新记录 hash；结构问题仍然报出来（记录的是"已确认一致"这个动作，
  // 不该被用来掩盖结构缺口）。
  writeFileSync(join(root, RECORD), renderRecord(result.hashes), 'utf8');
  for (const p of result.problems.filter((x) => !x.startsWith(`${EN} 与`) && !x.includes('记录不一致') && !x.startsWith('缺少 ' + RECORD))) {
    console.error('FAIL  ' + p);
  }
  console.log(`readme-pair: 已记录 ${EN} ${result.hashes[EN].slice(0, 12)} / ${ZH} ${result.hashes[ZH].slice(0, 12)} → ${RECORD}`);
  process.exit(0);
} else {
  const result = checkFromDisk();
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`readme-pair: ${EN} ${result.en.sections} 节 / ${result.en.items} 条目 / ${result.en.fences} 围栏；${ZH} ${result.zh.sections} 节 / ${result.zh.items} 条目 / ${result.zh.fences} 围栏`);
    if (result.problems.length === 0) console.log('readme-pair: 两侧结构对应、记录一致、切换行与链接正确');
    for (const p of result.problems) console.error('FAIL  ' + p);
  }
  process.exit(result.problems.length ? 1 : 0);
}
