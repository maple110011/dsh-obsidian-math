// scripts/probe-vault.mjs — 检索 v3 验收探针（本机 vault，零 token）。
// 用法: node scripts/probe-vault.mjs
// 12 组 ground-truth 断言: 换说法/连字符变体/读取半径/无答案弱信号。
// ground truth 与本机 vault 绑定（vault 路径见下）；vault 内容变化时需同步维护此文件。
// 不提交 git（机器特定，与 deploy-local 同类）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  tokenize, bm25Score, computeCorpusStats, cjkCharOverlap, queryCoverage,
  classifyVaultDoc, composePassage, parseHookFrontmatter
} from "../../dsh/preset/obsidian-notes.mjs";

const vault = process.env.DSH_OBSIDIAN_VAULT || "D:/Obsidian笔记数据库";
const splitFrontmatter = (raw) => {
  if (!raw.startsWith("---")) return { frontmatter: null, body: raw };
  const close = raw.indexOf("\n---", 3);
  if (close < 0) return { frontmatter: null, body: raw };
  return { frontmatter: raw.slice(3, close), body: raw.slice(close + 4) };
};
const exclude = new Set([".obsidian", ".trash", ".git", "node_modules", "deploy-backup-20260816"]);
const files = [];
const walk = (dir, rel) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (exclude.has(e.name)) continue; walk(join(dir, e.name), rel === "" ? e.name : rel + "/" + e.name); }
    else if (e.name.toLowerCase().endsWith(".md")) files.push(rel === "" ? e.name : rel + "/" + e.name);
  }
};
walk(vault, "");
const docs = [];
for (const rel of files) {
  const kind = classifyVaultDoc(rel);
  if (kind === "skip") continue;
  let raw; try { raw = readFileSync(join(vault, rel), "utf8"); } catch { continue; }
  const { frontmatter, body } = splitFrontmatter(raw);
  const metaOf = (key) => { if (frontmatter === null) return undefined; const m = new RegExp("^" + key + ":\\s*(.*)$", "m").exec(frontmatter); return m ? m[1].trim() : undefined; };
  const h = /^#\s+(.+)$/m.exec(body);
  docs.push({ kind, rel, title: metaOf("title") ?? h?.[1]?.trim() ?? rel.replace(/\.md$/i, ""), topic: metaOf("topic") ?? "", hook: frontmatter === null ? null : parseHookFrontmatter(frontmatter), body });
}
const rank = (query, limit = 8) => {
  const qTokens = tokenize(query);
  const passages = docs.map((d) => composePassage(d.kind, d));
  const stats = computeCorpusStats(passages.map((x) => tokenize(x)));
  const docTokens = passages.map((x) => tokenize(x));
  const raw = docs.map((d, i) => bm25Score(qTokens, docTokens[i], stats));
  const max = Math.max(1e-9, ...raw);
  const cjk = docs.map((d, i) => cjkCharOverlap(query, passages[i]));
  return docs.map((d, i) => ({ d, score: 0.85 * (raw[i] / max) + 0.10 * cjk[i], coverage: queryCoverage(qTokens, docTokens[i]) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
};
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
    const weak = top.length === 0 || top[0].coverage < 0.4;
    console.log(weak ? "[PASS]" : "[FAIL]", label, "→ top1:", top.length > 0 ? top[0].d.title.slice(0, 24) + " score " + top[0].score.toFixed(2) + " coverage " + top[0].coverage.toFixed(2) : "empty");
    weak ? pass++ : fail++;
    continue;
  }
  const hitIdx = top.findIndex((x) => x.d.rel.includes(expected));
  const ok = hitIdx >= 0 && hitIdx < minRank;
  console.log(ok ? "[PASS]" : "[FAIL]", label, "→ at rank", hitIdx + 1, "(need <=" + minRank + ")");
  if (!ok) for (const { d, score, coverage } of top.slice(0, 5)) console.log("      ", String(score.toFixed(3)).padStart(6), "cov", coverage.toFixed(2), d.kind.padEnd(12), d.rel.slice(0, 50));
  ok ? pass++ : fail++;
}
console.log("\nprobe result: " + pass + "/" + (pass + fail) + " PASS");
process.exit(fail === 0 ? 0 : 1);
