---
citekey: vakeBridgingQuestionAnswerGap2025
title: "Bridging the Question-Answer Gap in Retrieval-Augmented Generation: Hypothetical Prompt Embeddings"
shorttitle: "Bridging the Question-Answer Gap in Retrieval-Augmented Generation"
authors: "Vake, Domen; Vičič, Jernej; Tošić, Aleksandar"
year: 2025
status: distilled
doi: "10.1109/ACCESS.2025.3589499"
url: "http://arxiv.org/abs/2607.29402"
keywords: "Computer Science - Computation and Language, Computer Science - Information Retrieval"
tags: [index-time-augmentation, hyde, question-question-matching, retrieval]
full_text: .raw/vakeBridgingQuestionAnswerGap2025/full.md
pdf: .raw/vakeBridgingQuestionAnswerGap2025/source.pdf
---

# Bridging the Question-Answer Gap in Retrieval-Augmented Generation: Hypothetical Prompt Embeddings

> **一句话**：把 query↔document 的风格对齐从查询期（HyDE 运行时生成答案）搬到**索引期**——为每个 chunk 预计算多个「假设问题」并嵌入问题（而非原文），检索变成 question-question 匹配，零查询延迟。

## 摘要

Retrieval-Augmented Generation (RAG) systems synergize retrieval mechanisms with generative language models to enhance the accuracy and relevance of responses. However, bridging the style gap between user queries and relevant information in document text remains a persistent challenge in retrieval-augmented systems, often addressed by runtime solutions (e.g., Hypothetical Document Embeddings (HyDE)) that attempt to improve alignment but introduce extra computational overhead at query time. To address these challenges, we propose Hypothetical Prompt Embeddings (HyPE), a framework that shifts the generation of hypothetical content from query time to the indexing phase. By precomputing multiple hypothetical prompts for each data chunk and embedding the chunk in place of the prompt, HyPE transforms retrieval into a question-question matching task, bypassing the need for runtime synthetic answer generation. This approach does not introduce latency but also strengthens the alignment between queries and relevant context. Our experimental results on six common datasets show that HyPE can improve retrieval context precision by up to 42 percentage points and claim recall by up to 45 percentage points, compared to standard approaches, while remaining compatible with re-ranking, multi-vector retrieval, query decomposition, and other RAG advancements

## 核心机制 / 方法

- 问题：query（疑问式）与 chunk（陈述式）的风格鸿沟；HyDE 在查询期生成合成答案（每次查询都多一次 LLM 调用）。
- **HyPE**：索引期对每个 chunk 用 LLM 一次生成 k 个「假设问题」（question 式），嵌入这些**问题**（而非 chunk 原文），检索 = question-question 匹配。
- 每 chunk 多向量 → 覆盖多种问法、扩大语义覆盖；「小 chunk 高精度 + 返回整 chunk 上下文」兼顾精确与上下文。
- 结果：6 数据集 claim recall 平均 +16pt、precision +20pt；Single-Topic 最高 +44.6pt；faithfulness ↑ / hallucination ↓；**「relevant noise sensitivity」变差**（冗余重复放大噪声）；MS MARCO（短 passage + 高词面重叠）增益小（已饱和）。
- 统计：Wilcoxon + Holm 校正，9/11 指标 p<0.10，Cliff's |δ| 0.44–0.72。

## 与我的工作 / 记忆的映射

- **印证我们的 hook 块是「索引期增强」**（techniques/applications 就是预计算的可检索面），方向正确，且优于 HyDE 式「查询期增强」。
- HyPE 依赖 embedding（我们没有）；**等价物** = 把 card 的 `applications` 写成「这条卡能回答哪些问题 / 解哪些题」（question 式，而非陈述式），让 BM25 的 query 侧（挑战描述）能与 card 侧（应用问题）词面对齐。
- **「relevant noise sensitivity 变差」的提醒**：冗余重复的检索结果会放大噪声——对应我们 note_recall 应对「同一卡多个 hook 字段命中」去重合并，而非重复返回。
- 不适用：HyPE 面向通用 RAG 语料（大规模、离线索引），我们是小规模个人 vault，每卡一个 `applications` 字段的「单问题索引增强」即可，无需多向量。

## 研读状态

- 状态：distilled
- 研读日志：reading/vakeBridgingQuestionAnswerGap2025.md（已创建）

## 原文

- [MinerU 全文](.raw/vakeBridgingQuestionAnswerGap2025/full.md)
- [PDF](.raw/vakeBridgingQuestionAnswerGap2025/source.pdf)
