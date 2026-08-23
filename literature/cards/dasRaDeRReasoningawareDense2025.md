---
citekey: dasRaDeRReasoningawareDense2025
title: "RaDeR: Reasoning-aware Dense Retrieval Models"
shorttitle: "RaDeR"
authors: "Das, Debrup; Nuallain, Sam O'; Rahimi, Razieh"
year: 2025
status: distilled
doi: "10.48550/arXiv.2505.18405"
url: "http://arxiv.org/abs/2505.18405"
keywords: "Computer Science - Computation and Language, Computer Science - Information Retrieval"
tags: []
full_text: .raw/dasRaDeRReasoningawareDense2025/full.md
pdf: .raw/dasRaDeRReasoningawareDense2025/source.pdf
---

# RaDeR: Reasoning-aware Dense Retrieval Models

> **一句话**：用检索增强 MCTS 的数学解题轨迹 + 自反思相关性评估合成推理型检索训练数据，训练出首个在 CoT 推理步骤作查询时超过 BM25 的一阶段 dense 检索/重排器，且仅用同类工作 2.5% 的训练数据。

## 摘要

We propose RaDeR, a set of reasoning-based dense retrieval models trained with data derived from mathematical problem solving using large language models (LLMs). Our method leverages retrieval-augmented reasoning trajectories of an LLM and self-reflective relevance evaluation, enabling the creation of both diverse and hard-negative samples for reasoning-intensive relevance. RaDeR retrievers, trained for mathematical reasoning, effectively generalize to diverse reasoning tasks in the BRIGHT and RAR-b benchmarks, consistently outperforming strong baselines in overall performance. Notably, RaDeR achieves significantly higher performance than baselines on the Math and Coding splits. In addition, RaDeR presents the first dense retriever that outperforms BM25 when queries are Chain-of-Thought reasoning steps, underscoring the critical role of reasoning-based retrieval to augment reasoning language models. Furthermore, RaDeR achieves comparable or superior performance while using only 2.5% of the training data used by the concurrent work REASONIR, highlighting the quality of our synthesized training data.

## 核心机制 / 方法

1. 定位：推理密集检索中查询与相关文档（如定理）词面/语义重叠极低，现有 dense 不如 BM25，且缺一阶段推理检索器与难负样本训练数据。
2. 数据合成：检索增强 MCTS（rStar 扩展）解题，动作集 OST/CRS/QG/RT；检索到的定理经自反思（relevant/non-relevant + 理由）过滤后入树、经自摘要压缩融入后续推理；奖励 = 终态答案对错（R=1/0）。
3. 采样：每题 16 次 rollouts，只取含检索节点的高奖励轨迹；正例 = 被检索且判相关的定理，难负例 = 同查询下被判 non-relevant 的定理。
4. 四类查询平衡推理与词面：q_CoT（部分解）、q_llmq（低重叠推理查询）、q_question（原题）、q_lexical（round-trip：BM25 top-20 命中正例才保留）。
5. 训练：bi-encoder InfoNCE + 12 hard negatives + in-batch negatives；pointwise reranker 直接给相关分，无 test-time compute。
6. 结果：BRIGHT avg nDCG@10 25.5（超最强基线 ≥2 点）、TheoQ +12、Leet +8；首个 CoT 查询超 BM25 的 dense 检索器；43,120 条 ≈ REASONIR 的 2.5%。
7. 可迁移：把「定理↔应用场景」对齐入索引、自反思相关性 + 理由、难负例池、round-trip 一致性体检、推理+词面混合检索。

## 与我的工作 / 记忆的映射

1. 可借鉴：为 theorems 索引补「典型应用场景/触发特征」字段，弥补推理查询与定理之间的词面鸿沟（人工版 q_CoT）。
2. 可借鉴：模型选卡后自评相关性并给理由（relevant/non-relevant + 理由），不相关命中沉淀为负例池。
3. 可借鉴：把命中卡压缩成一句话摘要（自摘要），与现有 kind-aware passage 互补。
4. 可借鉴：round-trip 一致性（BM25 top-20 能否找回正例）作为查询质量/索引完整性的每日体检项。
5. 可借鉴：数学任务「最终解对错」作相关记录/定理的确定性加权信号（对齐现有 ✅/❌ 反馈闭环）。
6. 不适用：一阶段 dense 推理检索器 + MCTS 离线数据合成，与全 markdown/无数据库架构不符。
7. 与现有关系：保持 BM25 词面 + 推理感知混合；奖励只信终态会带噪 → 重要记忆升级仍需用户确认（verified 三级）。

## 研读状态

- 状态：distilled
- 研读日志：reading/dasRaDeRReasoningawareDense2025.md（按需创建）

## 原文

- [MinerU 全文](.raw/dasRaDeRReasoningawareDense2025/full.md)
- [PDF](.raw/dasRaDeRReasoningawareDense2025/source.pdf)
