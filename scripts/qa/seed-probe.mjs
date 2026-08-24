// scripts/qa/seed-probe.mjs — 基准套 A：零 token 检索探针（跑在仿真 vault 上）。
// 用法: node scripts/qa/seed-probe.mjs [--vault <path>]
// 默认 vault = scripts/qa/benchmark-vault（冻结 ground truth，见 docs/memory/benchmark.md）。
// 测两类检索：note_recall（统一语料）+ note_strategy（策略层），外加无答案弱信号。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tokenize, bm25Score, computeCorpusStats, cjkCharOverlap, queryCoverage,
  classifyVaultDoc, composePassage, parseHookFrontmatter, strategySurface
} from "../../dsh/preset/note-tools.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const vaultArg = process.argv.indexOf("--vault");
const vault = (vaultArg >= 0 && process.argv[vaultArg + 1]) || process.env.BENCHMARK_VAULT || join(root, "scripts", "qa", "benchmark-vault");

const splitFrontmatter = (raw) => {
  if (!raw.startsWith("---")) return { frontmatter: null, body: raw };
  const close = raw.indexOf("\n---", 3);
  if (close < 0) return { frontmatter: null, body: raw };
  return { frontmatter: raw.slice(3, close), body: raw.slice(close + 4) };
};
const metaOf = (fm, key) => { if (fm === null) return undefined; const m = new RegExp("^" + key + ":\\s*(.*)$", "m").exec(fm); return m ? m[1].trim() : undefined; };

const files = [];
const walk = (dir, rel) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name.startsWith(".") && e.name !== ".deepseek") continue; walk(join(dir, e.name), rel === "" ? e.name : rel + "/" + e.name); }
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
  const h = /^#\s+(.+)$/m.exec(body);
  docs.push({ kind, rel, title: metaOf(frontmatter, "title") ?? h?.[1]?.trim() ?? rel.replace(/\.md$/i, ""), topic: metaOf(frontmatter, "topic") ?? "", hook: frontmatter === null ? null : parseHookFrontmatter(frontmatter), strategy: kind === "strategy" ? strategySurface(frontmatter) : "", body });
}

// note_recall 打分（与 note-tools 同构）
const rankRecall = (query, limit = 8) => {
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

// note_strategy 打分（与 note-tools 的 note_strategy 同构：只扫 strategy 卡，BM25 对 surface）
const rankStrategy = (query, limit = 5) => {
  const qTokens = tokenize(query);
  const strat = docs.filter((d) => d.kind === "strategy");
  const surfaces = strat.map((d) => d.strategy);
  const stats = computeCorpusStats(surfaces.map((s) => tokenize(s)));
  return strat.map((d, i) => ({ d, score: bm25Score(qTokens, tokenize(surfaces[i]), stats) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
};

let pass = 0, fail = 0;
const run = (label, top, expected, minRank) => {
  if (expected === "__WEAK__") {
    const weak = top.length === 0 || top[0].coverage < 0.35;
    console.log(weak ? "[PASS]" : "[FAIL]", label, "→ top1:", top.length > 0 ? top[0].d.rel.slice(0, 40) + " cov " + top[0].coverage.toFixed(2) : "empty");
    weak ? pass++ : fail++;
    return;
  }
  const hit = top.findIndex((x) => x.d.rel.includes(expected));
  const ok = hit >= 0 && hit < minRank;
  console.log(ok ? "[PASS]" : "[FAIL]", label, "→ at rank", hit + 1, "(need <=" + minRank + ")");
  if (!ok) for (const { d, score } of top.slice(0, 5)) console.log("      ", score.toFixed(3), d.kind.padEnd(12), d.rel.slice(0, 50));
  ok ? pass++ : fail++;
};

console.log("seed-probe vault:", vault);
console.log("== note_recall（统一语料）==");
for (const [label, query, expected, minRank] of [
  ["换说法: 依测度→a.s. 加强", "从依测度收敛出发，怎么加强到几乎处处收敛？", ".deepseek/memory/records/rec-convergence-strengthening.md", 3],
  ["抽象层级: 子列论证", "子列论证 加强 收敛", ".deepseek/memory/records/rec-convergence-strengthening.md", 3],
  ["定理索引命中", "Borel-Cantelli 第一引理 事件列 概率和有限", ".deepseek/memory/theorems/index.md", 3],
  ["stub 换说法", "交换积分次序 条件 Fubini", "数学/实分析/交换积分次序.md", 3],
  ["噪声下仍命中", "子列 加强 收敛 谱半径 代数几何", ".deepseek/memory/records/rec-convergence-strengthening.md", 5],
  ["无答案弱信号", "黎曼几何 曲率张量 测地线", "__WEAK__", -1]
]) run(label, rankRecall(query), expected, minRank);

console.log("== note_strategy（策略层）==");
for (const [label, query, expected, minRank] of [
  ["策略召回: 收敛加强", "收敛加强 依测度 几乎处处", ".deepseek/strategy/strat-convergence-strengthening.md", 1],
  ["策略召回: 定义层证明", "定义层证明 冗长 等价刻画", ".deepseek/strategy/strat-definition-proof.md", 1]
]) run(label, rankStrategy(query), expected, minRank);

console.log("\nseed-probe result: " + pass + "/" + (pass + fail) + " PASS");
process.exit(fail === 0 ? 0 : 1);
