// scripts/qa/engine-probe.mjs — 检索 v3 验收探针（本机 vault，零 token）。
// 用法: node scripts/qa/engine-probe.mjs
// 12 组 ground-truth 断言: 换说法/连字符变体/读取半径/无答案弱信号。
// ground truth 与本机 vault 绑定（vault 路径见下）；vault 内容变化时需同步维护此文件。
//
// 打分**不再**在这里复刻：本文件调用 dsh/preset/note-tools.mjs 导出的
// buildRecallDoc + rankRecallDocuments，也就是 note_recall 真正使用的那条管线。
// （旧版这里自己算 `0.85*BM25 + 0.10*cjk`，与产品的
// `0.75*BM25 + 0.10*cjk + 0.15*hookPrior` 静默分叉，导致 hook prior 与
// superseded/duplicate 排除完全没有回归覆盖——见
// docs/project-assessment-2026-09-10.md §2 P1-4。）
//
// §2 是 GraphMemix 式的**可达性分层 + 有符号净恢复 Δ**测量（docs/memory/retrieval-v3.md
// §7）：把每条 ground truth 的目标分成 Direct / Recoverable / No access 三层，
// 并对「单袋 vs 多视图 max-pool」两种池化做 A/B，报告净得失。它只测量、不改产品行为。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecallDoc, rankRecallDocuments } from "../../dsh/preset/note-tools.mjs";

const vault = process.env.DSH_OBSIDIAN_VAULT || process.env.DSH_WORKSPACE_ROOT || "";
if (!vault) { console.error("engine-probe: 需要 DSH_OBSIDIAN_VAULT 或 DSH_WORKSPACE_ROOT 指定 vault 路径"); process.exit(2); }
const exclude = new Set([".obsidian", ".trash", ".git", "node_modules", "deploy-backup-20260816"]);
const files = [];
const walk = (dir, rel) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (exclude.has(e.name)) continue; walk(join(dir, e.name), rel === "" ? e.name : rel + "/" + e.name); }
    else if (e.name.toLowerCase().endsWith(".md")) files.push(rel === "" ? e.name : rel + "/" + e.name);
  }
};
walk(vault, "");

// Same corpus construction note_recall performs (its walk includes .deepseek).
const docs = [];
for (const rel of files) {
  let raw; try { raw = readFileSync(join(vault, rel), "utf8"); } catch { continue; }
  const doc = buildRecallDoc(rel, raw);
  if (doc !== null) docs.push(doc);
}

const rank = (query, limit = 8) => rankRecallDocuments(docs, query, { limit }).matches
  .map((match) => ({ rel: match.path, kind: match.kind, title: match.title, score: match.score, coverage: match.coverage }));

/**
 * The weak-signal control asks "does the LIBRARY have an answer?" — that is a
 * property of the CONTENT documents. Navigation indices (episode/theorem index)
 * list every entry's title, so they always show high raw coverage for an
 * arbitrary CJK query; letting them stand in for an answer would turn the
 * control into a false alarm. They are demoted in the ranking already; here the
 * verdict simply ignores them.
 */
const isNavigationIndex = (kind) => kind === "episode-index" || kind === "theorem-index";

const cases = [
  ["换说法: 依测度收敛→a.e. 加强", "从依测度收敛出发，怎么加强到几乎处处收敛？", ".deepseek/inbox/subsequence-selection.md", 5],
  ["子列选取模板", "子列选取 紧性 加强 收敛", ".deepseek/inbox/subsequence-selection.md", 1],
  ["Wasserstein 上界技巧", "Wasserstein 距离 上界技巧 耦合", ".deepseek/memory/topics/optimal-transport.md", 1],
  ["密度分解 memo", "密度分解 全变差 耦合构造", ".deepseek/inbox/density-decomposition.md", 3],
  ["BDL/SGLD 笔记", "贝叶斯深度学习 SGLD 变分推断", "1备忘录合集/BDL探索记录.md", 1],
  ["定理索引命中", "Borel-Cantelli 快速子列 a.e. 收敛", ".deepseek/memory/theorems/index.md", 3],
  ["连字符变体 (en-dash)", "Borel–Cantelli 依测度收敛 子列", ".deepseek/inbox/subsequence-selection.md", 5],
  ["Picard-Banach", "Picard Banach 不动点 压缩映射", "数学/Picard-Banach定理.md", 1],
  ["Fubini-Tonelli (连字符)", "Fubini-Tonelli 交换积分次序", "数学/Fubini-Tonelli定理.md", 1],
  ["Helly 引理 (读取半径内)", "Helly 引理 缺陷分布函数 胎紧", "统计学/概率论/Helly引理.md", 3],
  ["子序列 记法变体", "证明独立随机变量和 a.s. 收敛 子序列 Borel-Cantelli", ".deepseek/inbox/subsequence-selection.md", 5],
  ["谱半径 (库中无, 应弱信号)", "矩阵谱半径 Gelfand 估计", "__WEAK__", -1]
];
let pass = 0, fail = 0;
for (const [label, query, expected, minRank] of cases) {
  const top = rank(query);
  if (expected === "__WEAK__") {
    const content = top.find((x) => !isNavigationIndex(x.kind));
    const weak = content === undefined || content.coverage < 0.35;
    console.log(weak ? "[PASS]" : "[FAIL]", label, "→ best content hit:",
      content === undefined
        ? "none (only navigation indices surfaced)"
        : content.title.slice(0, 24) + " score " + content.score.toFixed(2) + " coverage " + content.coverage.toFixed(2));
    weak ? pass++ : fail++;
    continue;
  }
  const hitIdx = top.findIndex((x) => x.rel.includes(expected));
  const ok = hitIdx >= 0 && hitIdx < minRank;
  console.log(ok ? "[PASS]" : "[FAIL]", label, "→ at rank", hitIdx + 1, "(need <=" + minRank + ")");
  if (!ok) for (const { rel, kind, score, coverage } of top.slice(0, 5)) console.log("      ", String(score.toFixed(3)).padStart(6), "cov", coverage.toFixed(2), kind.padEnd(12), rel.slice(0, 50));
  ok ? pass++ : fail++;
}
console.log("\nprobe result: " + pass + "/" + (pass + fail) + " PASS");

// ── §2 可达性分层 + 有符号净恢复 Δ（GraphMemix 式测量，零 token）─────────────
//
// WHY: 只看「目标是否进 top-k」会把两种失败混为一谈——「检索器没找到」和「检索器
// 找到了邻居、顺着 related/source 一步就能到」。GraphMemix 用 Direct / Recoverable
// / No access 三层 + 有符号净恢复 Δ 区分它们，我们也得先量再改：这一步只报告，
// 不改变 note_recall 的行为。
//
// Recoverable 的定义（一步）：目标不在 top-K 内，但与某个 top-K 命中之间存在
// related/source/wikilink 边（任一方向）。边从 vault 原文抽取，且只认**能解析到
// 语料内文档**的链接——断链不算可达（顺链读到空文件不是恢复）。
const K = 8;

/** rel → Set(邻居 rel)：frontmatter 的 related/source + 正文 wikilink。 */
const links = new Map();
const basenameIndex = new Map();
for (const doc of docs) {
  const base = (doc.rel.split("/").at(-1) ?? "").replace(/\.md$/u, "");
  if (base !== "" && !basenameIndex.has(base)) basenameIndex.set(base, doc.rel);
}
const resolveLink = (target) => {
  const clean = String(target).split("#")[0].split("|")[0].trim();
  if (clean === "") return null;
  if (clean.endsWith(".md") && docs.some((d) => d.rel === clean)) return clean;
  const base = (clean.split("/").at(-1) ?? "").replace(/\.md$/u, "");
  return basenameIndex.get(base) ?? null;
};
for (const doc of docs) {
  const neighbours = new Set();
  const text = `${doc.rawFrontmatter}\n${doc.body}`;
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const rel = resolveLink(m[1]);
    if (rel !== null && rel !== doc.rel) neighbours.add(rel);
  }
  for (const m of doc.rawFrontmatter.matchAll(/^\s*(?:-\s*)?(?:related|source)\s*:\s*(.+)$/gmu)) {
    for (const part of m[1].split(/[,、]/u)) {
      const rel = resolveLink(part);
      if (rel !== null && rel !== doc.rel) neighbours.add(rel);
    }
  }
  links.set(doc.rel, neighbours);
}
const neighboursOf = (rel) => {
  const out = new Set(links.get(rel) ?? []);
  for (const [from, to] of links) if (to.has(rel)) out.add(from);
  return out;
};

/** Direct / Recoverable / No access for one case under one pooling mode. */
const layerOf = (query, expected, viewPool) => {
  const top = rankRecallDocuments(docs, query, { limit: K, viewPool }).matches;
  const direct = top.findIndex((m) => m.path.includes(expected));
  if (direct >= 0) return { layer: "Direct", rank: direct + 1 };
  const adjacent = new Set();
  for (const hit of top) for (const rel of neighboursOf(hit.path)) adjacent.add(rel);
  for (const rel of adjacent) if (rel.includes(expected)) return { layer: "Recoverable", rank: 0 };
  return { layer: "NoAccess", rank: 0 };
};

const rankable = cases.filter(([, , expected]) => expected !== "__WEAK__");
const rows = [];
for (const [label, query, expected] of rankable) {
  const bag = layerOf(query, expected, "bag");
  const max = layerOf(query, expected, "max");
  rows.push({ label, bag: bag.layer, max: max.layer, bagRank: bag.rank, maxRank: max.rank });
}
const score = (layer) => (layer === "Direct" ? 2 : layer === "Recoverable" ? 1 : 0);
const gained = rows.filter((r) => score(r.max) > score(r.bag)).length;
const lost = rows.filter((r) => score(r.max) < score(r.bag)).length;
const net = gained - lost;
console.log(`\n§2 reachability layering (top-${K}, ${rows.length} ground-truth cases)`);
for (const r of rows) {
  const mark = score(r.max) > score(r.bag) ? "  ↑" : score(r.max) < score(r.bag) ? "  ↓" : "   ";
  const ranks = r.bagRank > 0 || r.maxRank > 0 ? `  rank ${r.bagRank || "-"} → ${r.maxRank || "-"}` : "";
  console.log(`  ${mark} ${r.bag.padEnd(12)} → ${r.max.padEnd(12)} ${r.label}${ranks}`);
}
const counts = (key) => ["Direct", "Recoverable", "NoAccess"].map((l) => `${l} ${rows.filter((r) => r[key] === l).length}`).join(" / ");
console.log(`  bag: ${counts("bag")}`);
console.log(`  max: ${counts("max")}`);
console.log(`  signed net recovery Δ(max − bag) = +${gained} − ${lost} = ${net >= 0 ? "+" : ""}${net}`);
// Layer changes are coarse: when every target is already Direct the layering is
// blind to a ranking shift, so the target RANK is compared as well.
const both = rows.filter((r) => r.bagRank > 0 && r.maxRank > 0);
const better = both.filter((r) => r.maxRank < r.bagRank).length;
const worse = both.filter((r) => r.maxRank > r.bagRank).length;
const mean = (list) => (list.length === 0 ? 0 : list.reduce((sum, r) => sum + r[1], 0) / list.length);
const bagMean = mean(both.map((r) => [r, r.bagRank]));
const maxMean = mean(both.map((r) => [r, r.maxRank]));
console.log(`  target rank (${both.length} cases): bag mean ${bagMean.toFixed(2)} → max mean ${maxMean.toFixed(2)}；improved ${better} / worsened ${worse}`);
console.log("  决策口径：Δ>0 且 Direct 数不降才考虑把 viewPool 默认改为 max；Δ<=0 就保持 bag（见 docs/memory/retrieval-v3.md §7）。");
process.exit(fail === 0 ? 0 : 1);

