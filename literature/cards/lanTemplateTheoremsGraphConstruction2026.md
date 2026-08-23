---
citekey: lanTemplateTheoremsGraphConstruction2026
title: "Template-Theorems Graph Construction to Enhance Mathematical Reasoning Capabilities of LLM"
authors: "Lan, Yarong; Xu, Yajing; Chen, Huajun"
year: 2026
status: distilled
doi: "10.1609/aaai.v40i37.40411"
url: "https://ojs.aaai.org/index.php/AAAI/article/view/40411"
tags: []
full_text: .raw/lanTemplateTheoremsGraphConstruction2026/full.md
pdf: .raw/lanTemplateTheoremsGraphConstruction2026/source.pdf
---

# Template-Theorems Graph Construction to Enhance Mathematical Reasoning Capabilities of LLM

> **一句话**：把题目抽象成问题/解法模板并与定理建关联图，检索时先蒸馏查询，再沿图取模板并聚合成「定理表」注入。

## 摘要

Large language models (LLMs) have made significant strides in mathematical reasoning, particularly at the elementary level. However, they continue to face substantial challenges when confronted with complex, advanced mathematical problems. In contrast to humans—who can effectively draw upon prior experiences in solving similar problems and retrieve relevant knowledge and theorems from memory—LLMs often struggle to accurately identify analogous problems and to recall or apply appropriate theorems. To overcome these limitations, we introduce a novel framework for constructing a template-theorems knowledge base, leveraging the capabilities of large language models. Inspired by the associative mechanisms of human cognition, our approach abstracts real-world problems into generalized templates and establishes intricate linkages between these templates and pertinent theorems. This design enables the efficient expansion of a comprehensive knowledge base, even when starting from a limited set of seed examples. Moreover, we develop an efficient retrieval strategy that, given a new problem, systematically extracts and presents the most relevant knowledge from the knowledge base as contextual input to the LLM. Extensive experiments on multiple public mathematical datasets and models demonstrate that our approach consistently surpasses conventional methods. Comprehensive ablation studies further corroborate the effectiveness of both our knowledge base construction and retrieval modules.

## 核心机制 / 方法

- 模板（问题模板 + 解法模板=推理步骤序列）↔ 定理 图。
- 两阶段生成 + 四类验证（答案/一致性/步骤数/定理匹配）。
- Graph RAG：蒸馏 → top-k 图检索（阈值 m）→ 聚合定理表 → 按定理重选模板 → 注入。

## 与我的工作 / 记忆的映射

- 已实现：templates/ + theorems/ + related_theorems。
- 差距：无「定理表聚合 + 按定理重选模板」协同、无模板分叉、无模板-定理兼容校验。
- 解法模板 → 模板卡补「推理步骤序列」字段。

## 研读状态

- 状态：distilled
- 研读日志：reading/lanTemplateTheoremsGraphConstruction2026.md（按需创建）

## 原文

- [MinerU 全文](.raw/lanTemplateTheoremsGraphConstruction2026/full.md)
- [PDF](.raw/lanTemplateTheoremsGraphConstruction2026/source.pdf)
