---
citekey: yuanMemSearcherIterativeMemory2026
title: "MemSearcher: Iterative Memory Integration for Search Agent via End-to-End Reinforcement Learning"
shorttitle: "MemSearcher"
authors: "Yuan, Qianhao; Lou, Jie; Li, Zichao; Chen, Jiawei; Lu, Yaojie; Lin, Hongyu; Sun, Le; Zhang, Debing; Han, Xianpei"
year: 2026
status: distilled
doi: "10.18653/v1/2026.findings-acl.736"
url: "https://aclanthology.org/2026.findings-acl.736/"
tags: [memory-compaction, context-management, grpo, search-agent]
full_text: .raw/yuanMemSearcherIterativeMemory2026/full.md
pdf: .raw/yuanMemSearcherIterativeMemory2026/source.pdf
---

# MemSearcher: Iterative Memory Integration for Search Agent via End-to-End Reinforcement Learning

> **一句话**：搜索 agent 不再把完整交互史拼进上下文（ReAct 的 O(n) 线性增长），而是每轮用 LLM 当「记忆管理器」把历史压成 ≤1K token 的紧凑记忆、只留与问题相关的信息；multi-context GRPO 端到端训练，上下文稳定在 O(1)。

## 摘要

LLM-based search agents often concatenate the full interaction history into the context, producing long and noisy inputs, and increasing compute cost and GPU memory overhead. To address this issue, we propose MemSearcher, an agent framework that maintains a compact memory during multi-turn interactions, retaining only question-relevant information and thereby keeping the context length stable across turns. Training MemSearcher is challenging because each trajectory spans multiple turns under different LLM contexts, making each turn an independent optimization target in reinforcement learning. We introduce multi-context GRPO, which propagates trajectory-level advantages to all turns for end-to-end optimization. Experiments demonstrate that MemSearcher outperforms strong history-concatenation (ReAct-style) baselines on a range of public datasets while maintaining nearly constant token counts across multi-turn interactions. The code and models will be publicly available at https://github.com/icip-cas/MemSearcher.

## 核心机制 / 方法

- 问题：ReAct 把完整交互史（thought/action/observation）拼进上下文，O(n) 线性增长；搜索 agent 的 observation 是检索 passage，噪声多、成本/显存高。
- **MemSearcher**：每轮输入 = (question, memory_prev)（memory 初始为空）；LLM 生成 thought + action；环境返回 observation 后，LLM 把 (memory_prev + observation) 整合成新 memory（≤1024 token，只留与问题相关的信息）。context O(1)、FLOPs/turn O(1)。
- **multi-context GRPO**：一条轨迹含多轮、每轮不同 context，把轨迹级 advantage 传播到每轮、逐轮独立优化（解决 RL 训练问题）；loss mask 屏蔽搜索引擎 token。
- 结果：MemSearcher 3B 平均 43.8 超过 7B baselines；7B 48.9 超过 ReSearch 32B；context <4K token；**RL >> SFT**（记忆中间态难标注）；memory 长度 256（简单任务饱和）~1024（复杂任务更好）为最优。

## 与我的工作 / 记忆的映射

- 我们的「三写」（episode 全量 → records 原子化）本质就是「把历史压成紧凑记忆」，方向一致；但靠 prompt 自律（无 RL），且 records 是「永久沉淀」而非「每轮迭代丢弃无关信息」。
- 可借鉴：dialogue index 已经做「压缩最近会话问答线索」；可进一步做成「**每轮迭代更新的紧凑 working memory**」（类似 MemSearcher 的 m：question + 上一轮记忆 → 本轮记忆），而非只注入静态问答对。
- **「记忆长度有最优值、过度冗余有害」印证我们的注入预算（≤18000 字符）+ 「读前 2-3 条」纪律**。
- 不适用：RL 训练（我们 frozen model、无训练管线）；「每轮丢弃」与我们「持久化、可回溯」的记忆哲学冲突——我们应「压缩注入、保留证据」，而非「丢弃」。

## 研读状态

- 状态：distilled
- 研读日志：reading/yuanMemSearcherIterativeMemory2026.md（已创建）

## 原文

- [MinerU 全文](.raw/yuanMemSearcherIterativeMemory2026/full.md)
- [PDF](.raw/yuanMemSearcherIterativeMemory2026/source.pdf)
