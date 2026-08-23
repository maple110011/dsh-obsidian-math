---
citekey: weiEvoMemoryBenchmarkingLLM2026
title: "Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory"
shorttitle: "Evo-Memory"
authors: "Wei, Tianxin; Sachdeva, Noveen; Coleman, Benjamin; He, Zhankui; Bei, Yuanchen; Ning, Xuying; Ai, Mengting; Li, Yunzhe; He, Jingrui; Chi, Ed H.; Wang, Chi; Chen, Shuo; Pereira, Fernando; Kang, Wang-Cheng; Cheng, Derek Zhiyuan"
year: 2026
status: distilled
doi: "10.48550/arXiv.2511.20857"
url: "http://arxiv.org/abs/2511.20857"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Computation and Language"
tags: []
full_text: .raw/weiEvoMemoryBenchmarkingLLM2026/full.md
pdf: .raw/weiEvoMemoryBenchmarkingLLM2026/source.pdf
---

# Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory

> **一句话**：把静态数据集转成流式任务序列评测自演化记忆；ExpRAG 检索聚合经验，ReMem 用 Think/Act/Refine 把记忆精化作为显式动作。

## 摘要

Statefulness is essential for large language model (LLM) agents to perform long-term planning and problem-solving. This makes memory a critical component, yet its management and evolution remain largely underexplored. Existing evaluations mostly focus on static conversational settings, where memory is passively retrieved from dialogue to answer queries, overlooking the dynamic ability to accumulate and reuse experience across evolving task streams. In real-world environments such as interactive problem assistants or embodied agents, LLMs are required to handle continuous task streams, yet often fail to learn from accumulated interactions, losing valuable contextual insights, a limitation that calls for test-time evolution, where LLMs retrieve, integrate, and update memory continuously during deployment. To bridge this gap, we introduce Evo-Memory, a comprehensive streaming benchmark and framework for evaluating self-evolving memory in LLM agents. Evo-Memory structures datasets into sequential task streams, requiring LLMs to search, adapt, and evolve memory after each interaction. We unify and implement over ten representative memory modules and evaluate them across 10 diverse multi-turn goal-oriented and single-turn reasoning and QA datasets. To better benchmark experience reuse, we provide a baseline method, ExpRAG, for retrieving and utilizing prior experience, and further propose ReMem, an action-think-memory refine pipeline that tightly integrates reasoning, task actions, and memory updates to achieve continual improvement.

## 核心机制 / 方法

- 记忆 M_t 随历史演化；经验条目 = {输入, 输出, 反馈}。
- ExpRAG：任务级经验直接 append + top-k 相似检索注入。
- ReMem：Think 分解 / Act 执行 / Refine 记忆元推理（利用有用经验、剪噪声、重组）。
- 失败经验不精化直接积累会带来噪声；反馈 f_t 区分成功/失败。
- 任务相似度与增益相关（r≈0.72）；Hard→Easy 迁移最好。

## 与我的工作 / 记忆的映射

- ExpRAG → 采纳：等价 note_recall 检索相似经验 + 模板卡。
- ReMem Refine → 改造：我们有三写 + 每日体检，缺每轮显式记忆精化步。
- 失败感知 → 改造：artifact 反例已有，antipattern 待强化。
- 反馈 → 采纳：feedback 闭环已有，可把 outcome 写进 records。
- 效率 → 采纳：ReMem 更省步，提示记忆用对能省 token。

## 研读状态

- 状态：distilled
- 研读日志：reading/weiEvoMemoryBenchmarkingLLM2026.md（按需创建）

## 原文

- [MinerU 全文](.raw/weiEvoMemoryBenchmarkingLLM2026/full.md)
- [PDF](.raw/weiEvoMemoryBenchmarkingLLM2026/source.pdf)
