#!/usr/bin/env node
/**
 * note-interference-probe — 只读探针：**某一篇笔记在检索里到底怎么"干扰"**。
 *
 * 起因（2026-10-01）：用户报告「有一篇脏记忆笔记一直干扰」（`1备忘录合集/高等数理统计随笔2
 * ——充分统计量主线.md`：61K 字符、11 处 AI 补全、10 处待核对、逐次追加型）。这是真实失败
 * episode，比合成夹具更有价值，所以先**量出来**它怎么干扰，再谈改法。
 *
 * 用法（只读、零 token、不写任何文件）：
 *   DSH_WORKSPACE_ROOT=<vault> node scripts/qa/note-interference-probe.mjs [--target <笔记相对路径>]
 *
 * 它报告四件事（对应四类不同的"干扰"）：
 *   ① **占位**：一组**相关**查询里它排第几、分多高。
 *   ② **无关侵入**：一组**不相关**查询里它是否仍然进 top-k（"哪次检索都能看见它"）。
 *   ③ **返回体积**：它命中时返回的 passage 有多大（token 预算被它吃掉多少）。
 *   ④ **不确定内容密度**：片段里含多少待核对/AI 补全标记（被当"已沉淀"引用时的风险面）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildRecallDoc, rankRecallDocuments, composePassage } from '../../dsh/preset/note-tools.mjs';

const arg = (name, fallback = undefined) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};

const vault = resolve(String(arg('vault', process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT ?? '')));
const target = String(arg('target', '1备忘录合集/高等数理统计随笔2——充分统计量主线.md'));
if (!vault || vault === resolve('') || !readFileSync) {
  console.error('note-interference-probe: 需要 --vault 或 DSH_WORKSPACE_ROOT / DSH_OBSIDIAN_VAULT');
  process.exit(2);
}

const exclude = new Set(['.obsidian', '.trash', '.git', 'node_modules', 'deploy-backup-20260816']);
const files = [];
const walk = (dir, rel) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (exclude.has(entry.name)) continue;
      walk(join(dir, entry.name), rel === '' ? entry.name : rel + '/' + entry.name);
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      files.push(rel === '' ? entry.name : rel + '/' + entry.name);
    }
  }
};
walk(vault, '');

const docs = [];
for (const rel of files) {
  let raw;
  try {
    raw = readFileSync(join(vault, rel), 'utf8');
  } catch {
    continue;
  }
  const doc = buildRecallDoc(rel, raw, {});
  if (doc !== null) docs.push(doc);
}

const targets = {
  related: [
    '为什么完备性能跟极小充分搭配上得到 Basu 定理',
    'Fisher 信息 KL 信息 充分统计量 为什么 Fisher 更常用',
    '曲指数族 开集条件 自然参数',
    '充分统计量 是一一映射 商结构',
    'Bhattacharyya 界 高阶导 下界'
  ],
  // 刻意取这个库里**应当有别的答案**、且与充分统计量无关的主题。
  unrelated: [
    'Borel-Cantelli 子列 a.e. 收敛',
    'Wasserstein 距离 耦合 上界',
    '矩阵 打洞 谱半径',
    'Picard Banach 不动点',
    '数学归纳法 降维'
  ]
};

const tally = (query, limit = 8) => {
  const ranked = rankRecallDocuments(docs, query, { limit });
  const hits = ranked.matches.map((match, index) => ({ ...match, rank: index + 1 }));
  const targetHit = hits.find((hit) => hit.path === target) ?? null;
  return { hits, targetHit };
};

const MARKER_RE = /待核对|待补|AI 补全|待证明|存疑/g;
const markerCount = (text) => (String(text).match(MARKER_RE) ?? []).length;

console.log(`note-interference-probe（只读、零 token）`);
console.log(`vault : ${vault}`);
console.log(`target: ${target}`);
const targetDoc = docs.find((doc) => doc.rel === target);
if (targetDoc === undefined) {
  console.error('target 不在检索语料里（路径写错，或它被 classifyVaultDoc 跳过）');
  process.exit(3);
}
const passage = composePassage(targetDoc.kind, targetDoc);
console.log(`语料  : ${docs.length} 篇 · target kind=${targetDoc.kind} · passage ${passage.length} 字符 · 正文 ${String(targetDoc.body ?? '').length} 字符`);
console.log(`标记  : 待核对/AI补全 等共 ${markerCount(targetDoc.body)} 处（正文）`);
console.log('');

const report = { related: [], unrelated: [] };
console.log('① 相关查询里的占位（它是否把别的内容挤下去）');
for (const query of targets.related) {
  const { hits, targetHit } = tally(query);
  report.related.push({ query, rank: targetHit?.rank ?? null, score: targetHit?.score ?? null, coverage: targetHit?.coverage ?? null, snippetChars: targetHit?.snippet?.length ?? 0, snippetMarkers: targetHit === null ? 0 : markerCount(targetHit.snippet) });
  const top3 = hits.slice(0, 3).map((hit) => `${hit.rank}.${hit.path}(${hit.score.toFixed(2)})`).join('  ');
  console.log(`  ${targetHit === null ? '[不在 top-8]' : `[rank ${targetHit.rank}] score ${targetHit.score.toFixed(2)} cov ${targetHit.coverage.toFixed(2)} 片段 ${targetHit.snippet.length} 字符 / 含标记 ${targetHit === null ? 0 : markerCount(targetHit.snippet)} 处`}  ← ${query}`);
  console.log(`      top3: ${top3}`);
}
console.log('');
console.log('② 无关查询里的侵入（"哪次检索都能看见它"）');
for (const query of targets.unrelated) {
  const { hits, targetHit } = tally(query);
  report.unrelated.push({ query, rank: targetHit?.rank ?? null, score: targetHit?.score ?? null });
  console.log(`  ${targetHit === null ? '未侵入 top-8' : `⚠️ 侵入 rank ${targetHit.rank}（score ${targetHit.score.toFixed(2)}）`}  ← ${query}`);
  if (hits[0] !== undefined) console.log(`      top1: ${hits[0].path}(${hits[0].score.toFixed(2)})`);
}

const inRelated = report.related.filter((row) => row.rank !== null).length;
const inUnrelated = report.unrelated.filter((row) => row.rank !== null).length;
console.log('');
console.log('结论口径：');
console.log(`  相关查询命中 ${inRelated}/${report.related.length} · 无关查询侵入 ${inUnrelated}/${report.unrelated.length}`);
console.log('  相关命中高＝它确实是这个主题的正主（不一定是坏事）；**无关也命中**才是"干扰"，');
console.log('  因为那时它把别的笔记挤出了 top-k，而模型会拿它当依据。');
if (arg('json', false) === true) console.log(JSON.stringify({ target, docs: docs.length, passage: passage.length, bodyMarkers: markerCount(targetDoc.body), ...report }, null, 2));
