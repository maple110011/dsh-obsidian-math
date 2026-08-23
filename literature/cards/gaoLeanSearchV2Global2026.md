---
citekey: gaoLeanSearchV2Global2026
title: "LeanSearch v2: Global Premise Retrieval for Lean 4 Theorem Proving"
shorttitle: "LeanSearch v2"
authors: "Gao, Guoxiong; Sun, Zeming; Jiang, Jiedong; Wang, Yutong; Xu, Jingda; Wu, Peihao; Dai, Bryan; Dong, Bin"
year: 2026
status: distilled
doi: "10.48550/arXiv.2605.13137"
url: "http://arxiv.org/abs/2605.13137"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Information Retrieval"
tags: []
full_text: .raw/gaoLeanSearchV2Global2026/full.md
pdf: .raw/gaoLeanSearchV2Global2026/source.pdf
---

# LeanSearch v2: Global Premise Retrieval for Lean 4 Theorem Proving

> **一句话**：LeanSearch v2 以「标准检索（层级非形式化语料 + 嵌入-重排）作基座、推理模式以 sketch-retrieve-reflect 迭代组装」，解决全局前提检索——一次找回整条定理证明所需的一组库引理，且不依赖领域微调。

## 摘要

Proving theorems in Lean 4 often requires identifying a scattered set of library lemmas whose joint use enables a concise proof -- a task we call global premise retrieval. Existing tools address adjacent problems: semantic search engines find individual declarations matching a query, while premise-selection systems predict useful lemmas one tactic step at a time. Neither recovers the full premise set an entire theorem requires. We present LeanSearch v2, a two-mode retrieval system for this task. Its standard mode applies a hierarchy-informalized Mathlib corpus with an embedding-reranker pipeline, achieving state-of-the-art single-query retrieval without domain-specific fine-tuning (nDCG@10 of 0.62 vs. 0.53 for the next-best system). Its reasoning mode builds on standard mode as its retrieval substrate, targeting global premise retrieval through iterative sketch-retrieve-reflect cycles. On a 69-query benchmark of research-level Mathlib theorems, reasoning mode recovers 46.1% of ground-truth premise groups within 10 retrieved candidates, outperforming strong reasoning retrieval systems (38.0%) and premise-selection baselines (9.3%) on the same benchmark. In a controlled downstream evaluation with a fixed prover loop, replacing alternative retrievers with LeanSearch v2 yields the highest proof success (20% vs. 16% for the next-best system and 4% without retrieval), confirming that retrieval quality propagates to proof generation. We have open-sourced all code, data, and benchmarks. Code and data: https://github.com/frenzymath/LeanSearch-v2 . The standard mode is publicly available with API access at https://leansearch.net/ .

## 核心机制 / 方法

- 任务重定义：全局前提检索 = 找回整条定理证明所需的一组分散库引理（非单条匹配、非局部一步），引理靠证明策略的逻辑架构相连而非共享词汇。
- 标准模式：Jixia 抽取 declaration + 依赖图（DAG），拓扑序自底向上非形式化（用已非形式化的依赖作上下文接地）；Qwen3-Embedding-8B 编码 kind-aware passage，top-50 用 Qwen3-Reranker-8B 重排，全程无领域微调。
- 推理模式（sketch-retrieve-reflect）：把定理拆成子查询（只写证明策略、不写引理名）→ 标准模式当黑盒检索 → filter 逐条判相关/不相关（可返回空集）→ judge 二值判定 + 结构化反馈 → reviser 改写重试，≤3 轮、2 并行分支。
- 空信号语义：filter 显式区分「检索到但无用」与「没检索到」，避免 top-k 阈值把两种情形混为一谈。
- rank-only 聚合：跨子查询丢弃原始分（不可比），用 1/log2(i+2) 位置折扣求和去重。
- 评测：MathlibQR（200 声明/946 查询，6 种 query style）+ MathlibMPR（69 定理，premise group + alternative routing）；nDCG@10 0.623、Recall(group)@10 46.1%、下游证明成功率 20% 均领先。

## 与我的工作 / 记忆的映射

- 可借鉴：把「用户问题 → 一组联合支撑答案的记录」当集合级检索，用「完整证据路线全命中（Covered）」作被动质量信号，补足我们只算总 coverage 的不足。
- 可借鉴：精读协议升级为 sketch-retrieve-reflect——filter 显式空集 + judge 结构化反馈，强化 coverage<0.35 判词面巧合与「仍无则明说没有」。
- 可借鉴：rank-only 聚合（1/log2(i+2)）用于多子查询改写场景；kind-aware passage 按 record 类型定制并验证收益。
- 可借鉴：duplicate-candidates 升级为「等价记录组」（组内任一条命中即算），对应 premise group。
- 可借鉴：依赖接地写描述——写卡/记录时把关联概念作上下文（topics 链），不孤立写。
- 不适用：Lean 形式化、prover loop、Jixia 抽取、嵌入语料构建——我们无大库语义检索需求，须保持零模型依赖的确定性主路。
- 关系：与 hook 块 verified/uses、records 的 source/superseded 同构（唯一名/类型化/版本化），可把 kind-aware 提示与每日体检审计打通。

## 研读状态

- 状态：distilled
- 研读日志：reading/gaoLeanSearchV2Global2026.md（按需创建）

## 原文

- [MinerU 全文](.raw/gaoLeanSearchV2Global2026/full.md)
- [PDF](.raw/gaoLeanSearchV2Global2026/source.pdf)
