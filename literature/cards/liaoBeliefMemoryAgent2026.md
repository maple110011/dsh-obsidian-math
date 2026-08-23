---
citekey: liaoBeliefMemoryAgent2026
title: "Belief Memory: Agent Memory Under Partial Observability"
shorttitle: "Belief Memory"
authors: "Liao, Junfeng; Wang, Qizhou; Zhu, Jianing; Du, Bo; Yan, Rui; Chen, Xiuying"
year: 2026
status: distilled
doi: "10.48550/arXiv.2605.05583"
url: "http://arxiv.org/abs/2605.05583"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Computation and Language"
tags: []
full_text: .raw/liaoBeliefMemoryAgent2026/full.md
pdf: .raw/liaoBeliefMemoryAgent2026/source.pdf
---

# Belief Memory: Agent Memory Under Partial Observability

> **一句话**：记忆应存信念分布而非点估计：每个属性保留多个候选结论及概率，检索返回完整信念，避免自我强化式错误。

## 摘要

LLM agents that operate over long context depend on external memory to accumulate knowledge over time. However, existing methods typically store each observation as a single deterministic conclusion (e.g., inferring "API textasciitildeX failed" from temporary errors), even though such observations are inherently partial and potentially ambiguous. By committing to one conclusion and discarding uncertainty, these methods introduce self-reinforcing error: the agent acts on the stored conclusion, never revisits alternatives, and reinforces the conclusion over time. To address this issue, we propose BeliefMem, which shifts the memory paradigm from committing to a single conclusion per observation to retaining multiple candidate conclusions with their probabilities. Concretely, BeliefMem stores the candidate conclusions as separate memory entries, each carrying a probability that is updated via Noisy-OR rules as new observations arrive. At retrieval, all candidates surface together with their probabilities, keeping alternatives visible to the agent. Since each conclusion in memory retains its probability, BeliefMem preserves the uncertainty that the deterministic paradigm discards, enabling the agent to act with high confidence on well-evidenced knowledge while retaining the capacity to update its confidence when new evidence arrives. Empirical evaluations on LoCoMo and ALFWorld benchmarks show that, even with limited data, BeliefMem achieves the best average performance, remarkably outperforming well-known baselines. More broadly, such probabilistic memory produces substantial gains and explores a new direction for agent memory in partially observable environments.

## 核心机制 / 方法

- 记忆 = {属性 → {候选结论 → 证据概率}}，替代「每属性只存一个结论」的点估计。
- Add：新属性存候选（概率夹在 [pmin, pmax]）；Merge：noisy-OR 证据合并（上限 0.99，竞争候选降到 0.25）。
- 检索分 = 语义相似 × 时间衰减 λ^τ；返回完整信念（所有候选 + 概率）供决策。
- 归档旧版本支持时间推理；只用 16.67% 记忆库即超 5/6 基线。

## 与我的工作 / 记忆的映射

- 点估计风险 → 改造：fact/preference 卡通常只存当前结论，可对可修订属性存候选 + 置信。
- wrong 反馈降权 → 采纳：feedback wrong 已减 success_rate，可补「保留被否结论为备选」。
- 时间衰减 → 改造：memo 已有 recency，records 检索可加 staleness 项。
- 归档历史 → 采纳：superseded 已有，语义对齐。
- 概率门控 → 改造：verified 三级是粗粒度替代，可加 confidence 字段。

## 研读状态

- 状态：distilled
- 研读日志：reading/liaoBeliefMemoryAgent2026.md（按需创建）

## 原文

- [MinerU 全文](.raw/liaoBeliefMemoryAgent2026/full.md)
- [PDF](.raw/liaoBeliefMemoryAgent2026/source.pdf)
