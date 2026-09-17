// scripts/qa/seed-probe.mjs — 基准套 A：零 token 检索探针（跑在仿真 vault 上）。
// 用法: node scripts/qa/seed-probe.mjs [--vault <path>]
// 默认 vault = scripts/qa/benchmark-vault（冻结 ground truth，见 docs/memory/benchmark.md）。
// 测两类检索：note_recall（统一语料）+ note_strategy（策略层），外加无答案弱信号。
//
// 打分**不再**在这里复刻：调用 dsh/preset/note-tools.mjs 的
// buildRecallDoc / rankRecallDocuments / rankStrategyCards，也就是产品自己用的
// 那条管线。旧版这里手抄了 `0.85*BM25 + 0.10*cjk`，与产品的
// `0.75*BM25 + 0.10*cjk + 0.15*hookPrior` 静默分叉（见
// docs/project-assessment-2026-09-10.md §2 P1-4）。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecallDoc, rankRecallDocuments, rankStrategyCards } from "../../dsh/preset/note-tools.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const vaultArg = process.argv.indexOf("--vault");
const vault = (vaultArg >= 0 && process.argv[vaultArg + 1]) || process.env.BENCHMARK_VAULT || join(root, "scripts", "qa", "benchmark-vault");

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
  let raw; try { raw = readFileSync(join(vault, rel), "utf8"); } catch { continue; }
  const doc = buildRecallDoc(rel, raw);
  if (doc !== null) docs.push(doc);
}

const rankRecall = (query, limit = 8) => rankRecallDocuments(docs, query, { limit }).matches
  .map((match) => ({ rel: match.path, kind: match.kind, score: match.score, coverage: match.coverage }));
// Both buckets, merged back into one ranked list, because this probe asks "can the
// technique be found at all?" — that is a retrieval question, and a `candidate`
// strategy card is still a legitimate find (it is a lead, not an established
// technique). Reading only `matches` made this probe report a false regression the
// moment note_strategy started splitting candidates out, because the seed vault's
// definition-proof card is itself a candidate. Ranking order is preserved by score
// so the expected rank still means what it says.
const rankStrategy = (query, limit = 5) => {
  const ranked = rankStrategyCards(docs, query, { limit });
  return [...ranked.matches, ...ranked.candidates]
    .sort((a, b) => b.score - a.score)
    .map((match) => ({ rel: match.path, kind: "strategy", score: match.score, coverage: null }));
};

/** See engine-probe.mjs: navigation indices always show raw coverage for CJK. */
const isNavigationIndex = (kind) => kind === "episode-index" || kind === "theorem-index";

let pass = 0, fail = 0;
const run = (label, top, expected, minRank) => {
  if (expected === "__WEAK__") {
    const content = top.find((x) => !isNavigationIndex(x.kind));
    const weak = content === undefined || content.coverage < 0.35;
    console.log(weak ? "[PASS]" : "[FAIL]", label, "→ best content hit:", content === undefined ? "none (only navigation indices)" : content.rel.slice(0, 40) + " cov " + content.coverage.toFixed(2));
    weak ? pass++ : fail++;
    return;
  }
  const hit = top.findIndex((x) => x.rel.includes(expected));
  const ok = hit >= 0 && hit < minRank;
  console.log(ok ? "[PASS]" : "[FAIL]", label, "→ at rank", hit + 1, "(need <=" + minRank + ")");
  if (!ok) for (const { rel, kind, score } of top.slice(0, 5)) console.log("      ", score.toFixed(3), kind.padEnd(12), rel.slice(0, 50));
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
