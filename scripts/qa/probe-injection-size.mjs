// scripts/qa/probe-injection-size.mjs — 注入体积探针（**零 token、只读**）。
//
// 回答"注入预算档位到底有没有实际作用"：对同一个 vault，把三档（compact / standard / rich）各跑一次
// `buildMemorySection`，报各自字符数与到硬上限（`MAX_TOTAL_MEMORY_CHARS`）的余量，再报每层原始长度
// 与预算的对比 —— 这样"档位无差别"或"某一层被截断"都能直接看出来。
//
// 为什么要它：`docs/handoff.md` §7「预算档位对注入体积的实际影响」曾把一组**绝对数字**写死在文档里，
// 而那组数字随库内容漂移（2026-09-17 的 7864/8250/8890 → 2026-09-26 实测 9318/10213/11252，差从 1026
// 变 1934）。文档现在指向本探针，而不是再钉一组迟早腐烂的数字。
//
// 用法（**不写任何文件**，只读 vault）：
//   node scripts/qa/probe-injection-size.mjs [--vault <路径>]
//   默认 vault 取 `DSH_WORKSPACE_ROOT` / `DSH_OBSIDIAN_VAULT`，都没有则报错退出（不猜路径）。
//
// 数字取自**源码**（`BUDGET_TIERS` 与 `MAX_*` 从 `math-memory.mjs` 文本里提取），所以探针不会与引擎
// 各自的字面量漂移。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildMemorySection, MAX_TOTAL_MEMORY_CHARS } from '../../dsh/preset/math-memory.mjs';

const args = process.argv.slice(2);
const vaultArgIndex = args.indexOf('--vault');
const vault = vaultArgIndex >= 0
  ? args[vaultArgIndex + 1]
  : (process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT ?? '');

if (typeof vault !== 'string' || vault === '') {
  console.error('probe-injection-size: 需要 --vault <路径>，或设置 DSH_WORKSPACE_ROOT / DSH_OBSIDIAN_VAULT');
  console.error('（刻意不给默认路径：写死维护者的私有 vault 会让这个探针在别的机器上静默测错东西）');
  process.exit(2);
}

const sourcePath = fileURLToPath(new URL('../../dsh/preset/math-memory.mjs', import.meta.url));
const src = readFileSync(sourcePath, 'utf8');

const constants = {};
for (const match of src.matchAll(/^const (MAX_[A-Z_]+) = (\d+);$/gm)) constants[match[1]] = Number(match[2]);
const tierMatch = src.match(/const BUDGET_TIERS = (\{[\s\S]*?\n\});/);
if (tierMatch === null) throw new Error('cannot locate BUDGET_TIERS in the preset source');
const names = Object.keys(constants);
const BUDGET_TIERS = new Function(...names, `return (${tierMatch[1]});`)(...names.map((n) => constants[n]));

console.log(`vault: ${vault}`);
console.log(`hard cap (MAX_TOTAL_MEMORY_CHARS) = ${MAX_TOTAL_MEMORY_CHARS}`);
console.log('');
const lengths = [];
for (const tier of Object.keys(BUDGET_TIERS)) {
  const section = buildMemorySection({
    vaultRoot: vault,
    sessionsRoot: '',
    maxHistoryEntries: 0,
    maxHistoryChars: 0,
    cacheTtlMs: 0,
    budgets: BUDGET_TIERS[tier]
  }, undefined, null, null, null);
  lengths.push(section.length);
  console.log(`${tier.padEnd(9)} injected ${String(section.length).padStart(6)} chars` +
    `   headroom: ${String(MAX_TOTAL_MEMORY_CHARS - section.length).padStart(6)}`);
}
console.log('');
console.log(`spread (max - min) = ${Math.max(...lengths) - Math.min(...lengths)} chars`);
const overCap = lengths.filter((l) => l >= MAX_TOTAL_MEMORY_CHARS);
console.log(overCap.length === 0
  ? 'no tier is at the cap (the cap is not what is shaping the section today)'
  : `⚠️ ${overCap.length} tier(s) are AT the cap — the cap is shaping the section`);

console.log('');
console.log('per-layer raw length vs standard budget:');
for (const [label, rel, key] of [
  ['episodes/index.md', '.deepseek/memory/episodes/index.md', 'episodes'],
  ['records/index.md', '.deepseek/memory/records/index.md', 'records'],
  ['topics/index.md', '.deepseek/memory/topics/index.md', 'topics'],
  ['profile.md', '.deepseek/memory/profile.md', 'profile'],
  ['templates/index.md', '.deepseek/memory/templates/index.md', 'templates']
]) {
  let raw = -1;
  try { raw = readFileSync(`${vault}\\${rel.split('/').join('\\')}`, 'utf8').length; } catch { raw = -1; }
  const budget = BUDGET_TIERS.standard[key];
  const verdict = raw < 0 ? 'missing' : (raw > budget ? `TRUNCATED (over by ${raw - budget})` : 'fits');
  console.log(`  ${label.padEnd(20)} raw ${String(raw).padStart(6)}   budget ${String(budget).padStart(5)}   ${verdict}`);
}
