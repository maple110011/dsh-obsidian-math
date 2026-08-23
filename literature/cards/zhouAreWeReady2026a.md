---
citekey: zhouAreWeReady2026a
title: "Are We Ready For An Agent-Native Memory System?"
authors: "Zhou, Wei; Zhou, Xuanhe; Han, Shaokun; Xu, Hongming; Li, Guoliang; Li, Zhiyu; Xiong, Feiyu; Wu, Fan"
year: 2026
status: distilled
doi: "10.48550/arXiv.2606.24775"
url: "http://arxiv.org/abs/2606.24775"
keywords: "Computer Science - Computation and Language, Computer Science - Databases, Computer Science - Information Retrieval"
tags: []
full_text: .raw/zhouAreWeReady2026a/full.md
pdf: .raw/zhouAreWeReady2026a/source.pdf
---

# Are We Ready For An Agent-Native Memory System?

> **一句话**：从数据管理视角系统评测 agent 记忆：拆成表示/存储、提取、检索路由、维护四模块，逐模块消融给出最有效做法。

## 摘要

Memory for large language model (LLM) agents has rapidly evolved from simple retrieval-augmented mechanisms into a data management system that supports persistent information storage, retrieval, update, consolidation, and dynamic lifecycle governance throughout agent execution. Despite this evolution, existing evaluations still benchmark agent memory mainly through end-to-end task success metrics (e.g., F1, BLEU), while treating the underlying system as a monolithic black box. As a result, critical system-level concerns, including operational costs, architectural trade-offs across memory modules, and robustness under dynamic knowledge updates, remain insufficiently explored. In this paper, we present a systematic experimental study of agent memory from a data management perspective. We propose an analytical framework that decomposes agent memory into four core modules: memory representation and storage, extraction, retrieval and routing, and maintenance. Under this framework, we evaluate 12 representative memory systems and two reference baselines across five benchmark workloads spanning 11 datasets. Our extensive end-to-end evaluation shows that no single architecture dominates across all scenarios; instead, effectiveness depends heavily on how well the memory structure aligns with the workload bottleneck. Furthermore, through fine-grained ablation studies, we quantify their individual effects on representation fidelity, retrieval precision, update correctness, and long-horizon stability. Finally, we reveal cost-performance trade-offs under realistic workloads, showing localized maintenance is more cost-efficient than global reorganization. Based on these findings, we identify promising directions towards building truly agent-native memory systems. The code is publicly available at https://github.com/OpenDataBox/MemoryData.

## 核心机制 / 方法

- 表示：token 序列 / 图-树 / 异构复合；存储：瞬态 / 单引擎 / 多引擎。
- 提取：raw / schema-free / schema-constrained；检索：注意力 / 稠密 / 子图 / agentic / 多阶段混合。
- 维护：多版本 / 容量淘汰 / LLM 语义合并 / 参数优化。
- 核心发现 O8-O11：原文>压缩>摘要；写时晚过滤；规划+均衡融合最有效、加反思无益；保守合并优于延迟 flush。

## 与我的工作 / 记忆的映射

- O8 内容保真 → 采纳：episodes append-only 已对，records 抽象克制。
- O9 晚过滤 → 采纳：三写「原文只在 episodes」已对，警惕过度抽象。
- O10 规划与融合 → 改造：蒸馏查询已有；纯 BM25 可补稠密做 hybrid。
- O11 保守合并 → 采纳：merge/supersede 阈值保守化。
- 差距：纯稀疏无稠密、无显式容量淘汰、检索无均衡融合。

## 研读状态

- 状态：distilled
- 研读日志：reading/zhouAreWeReady2026a.md（按需创建）

## 原文

- [MinerU 全文](.raw/zhouAreWeReady2026a/full.md)
- [PDF](.raw/zhouAreWeReady2026a/source.pdf)
