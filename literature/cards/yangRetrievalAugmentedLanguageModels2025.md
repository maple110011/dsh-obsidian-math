---
citekey: yangRetrievalAugmentedLanguageModels2025
title: "Retrieval-Augmented Language Models are Mimetic Theorem Provers"
authors: "Yang, Wenjie; Huang, Ruiyuan; Guo, Jiaxing; Lyu, Zicheng; Xu, Tongshan; Zhang, Shengzhong; Du, Lun; Zheng, Da; Huang, Zengfeng"
year: 2025
status: distilled
doi: "10.18653/v1/2025.findings-emnlp.1162"
url: "https://aclanthology.org/2025.findings-emnlp.1162/"
tags: [theorem-proving, dual-rag, query-augmentation, technique-retrieval]
full_text: .raw/yangRetrievalAugmentedLanguageModels2025/full.md
pdf: .raw/yangRetrievalAugmentedLanguageModels2025/source.pdf
---

# Retrieval-Augmented Language Models are Mimetic Theorem Provers

> **一句话**：LLM 配上检索到的**证明**（而不只是定理陈述）就能当「拟态定理证明器」——从非结构化上下文里迁移证明技巧；Dual RAG 用 LLM 同时增强查询（挑战分析 + 证明草图）与文档（定理应用 + 技巧提取），把「语义远但策略近」的定理拉近，检索覆盖率最高 +34.19%。

## 摘要

Large language models have demonstrated considerable capabilities in various mathematical tasks, yet they often fall short in rigorous, proof-based reasoning essential for research-level mathematics. Retrieval-augmented generation presents a promising direction for enhancing these capabilities. This paper systematically explores RAG for natural language theorem proving, revealing that LLMs, when augmented with retrieved proofs rather than just theorems, can function as potent mimetic theorem provers: these models can effectively generalize proof techniques found in unstructured retrieved contexts to construct correct proofs for novel theorems. Building upon this finding, we introduce Dual RAG, a simple yet effective RAG framework. Dual RAG employs LLMs to identify underlying reasoning challenges within theorems, augmenting both queries and document contexts to improve retrieval performance. Our experiments show that Dual RAG achieves substantial improvements in retrieval performance, with gains of up to 34.19%. Expert evaluations further confirm that these retrieval enhancements directly translate into higher quality proof generation. Notably, when integrated with the arXiv API, Dual RAG demonstrates the ability to prove research-level theorems in theoretical machine learning, highlighting its strong potential as a foundational element for a practical mathematical copilot.

## 核心机制 / 方法

- 定位：RAG for 自然语言定理证明；核心发现 = **mimetic theorem proving**——LLM 迁移检索到的证明技巧（不是只引用定理陈述），即使目标定理与检索定理不完全相同。
- **Dual augmentation（核心）**：
  - Query 侧：LLM 分析目标定理的「底层挑战」并生成初步证明草图，作为检索查询。
  - Document 侧：LLM 为已知定理提「潜在应用」+ 提取证明「技巧」。
  - 两者在 embedding 空间对齐——「语义远但策略近」的定理被拉近。
- LLM-based chunking：按「定理 + 证明 + 例子 + 备注」逻辑单元切分（保留逻辑流，不用固定长度）。
- LLM rerank：按「对证明目标定理的用处」排序，避免「语义相似但无关」。
- 结果：Coverage@K +10.62~34.19%；**Technique 子集增益更大**（+21.09~37.75，K=8 达 100%）；消融：augmentation 最重要，其次 rerank，再次 chunking；研究级案例——用 arXiv API 证明了一个理论 ML 开放问题（带图反馈 bandit）。

## 与我的工作 / 记忆的映射

- **这是 assessment.md 第 2 轮引用的 Dual RAG 原文**，把 P0-1 从「方向」坐实为「规格」，并确认了当时诊断的缺口：我们已有的 `hook.techniques` / `applications` 就是 document-side augmentation 的落地；**缺 query-side augmentation**——「问题蒸馏」只靠 AGENTS.md prompt 自觉，蒸馏结果不参与任何索引/打分。
- 可落地：note_recall 的「挑战描述 + 候选技巧」蒸馏结果应**进入检索打分**（而非只是 prompt 纪律）；records/templates 卡的 `applications` 应写成「这条卡能解哪类题/用在哪类挑战」（与 query 侧挑战对齐），`techniques` 应显式列出证明技巧。
- 我们的 theorem-index（定理）+ templates（题型/解法↔定理）正是「定理 + 技巧」双检索的雏形；但 theorem-index 只存定理陈述，**缺「技巧」维**。
- 不适用：Dual RAG 依赖 embedding + LLM rerank；隐私约束下我们仍走 BM25 + hook 字段，但「双增强」的语义（query 挑战 ↔ card 应用）可以照搬进我们的字段契约。

## 研读状态

- 状态：distilled
- 研读日志：reading/yangRetrievalAugmentedLanguageModels2025.md（已创建）

## 原文

- [MinerU 全文](.raw/yangRetrievalAugmentedLanguageModels2025/full.md)
- [PDF](.raw/yangRetrievalAugmentedLanguageModels2025/source.pdf)
