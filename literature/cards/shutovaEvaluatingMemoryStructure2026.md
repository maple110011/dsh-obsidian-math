---
citekey: shutovaEvaluatingMemoryStructure2026
title: "Evaluating Memory Structure in LLM Agents"
authors: "Shutova, Alina; Olenina, Alexandra; Vinogradov, Ivan; Sinitsin, Anton"
year: 2026
status: distilled
doi: "10.48550/arXiv.2602.11243"
url: "http://arxiv.org/abs/2602.11243"
keywords: "Computer Science - Machine Learning, Computer Science - Computation and Language"
tags: []
full_text: .raw/shutovaEvaluatingMemoryStructure2026/full.md
pdf: .raw/shutovaEvaluatingMemoryStructure2026/source.pdf
---

# Evaluating Memory Structure in LLM Agents

> **一句话**：提出 StructMemEval 基准，测 agent「组织记忆」而非事实召回，发现简单 RAG 不随规模扩展、记忆 agent 在给定组织提示时可靠但往往不会自发识别结构。

## 摘要

Modern LLM-based agents and chat assistants rely on long-term memory frameworks to store reusable knowledge, recall user preferences, and augment reasoning. As researchers create more complex memory architectures, it becomes increasingly difficult to analyze their capabilities and guide future memory designs. Most long-term memory benchmarks focus on simple fact retention, multi-hop recall, and time-based changes. While undoubtedly important, these capabilities can often be achieved with simple retrieval-augmented LLMs and do not test complex memory hierarchies. To bridge this gap, we propose StructMemEval - a benchmark that tests the agent's ability to organize its long-term memory, not just factual recall. We gather a suite of tasks that humans solve by organizing their knowledge in a specific structure: transaction ledgers, to-do lists, trees and others. Our initial experiments show that simple retrieval-augmented LLMs struggle with these tasks, whereas memory agents can reliably solve them if prompted how to organize their memory. However, we also find that modern LLMs do not always recognize the memory structure when not prompted to do so. This highlights an important direction for future improvements in both LLM training and memory frameworks.

## 核心机制 / 方法

- 定位：现有记忆基准只测事实召回，简单检索基线（EMem）就能赢，测不到复杂记忆结构的价值。
- 设计：StructMemEval 用 tree / state tracking / counting / recommendation 四类「组织知识」任务，实现无关，只评最终答案。
- 任务解耦：题目「结构对则简单、无结构几乎不可解」，避免编程/推理能力污染评估。
- 诊断法：可选 organization hint（人工结构提示）区分「没识别结构」与「组织执行失败」。
- 规模分析：207 场景 10–500 消息，主集 51 个最长（≥250）；检索基线过了规模拐点即崩。
- 主要失败模式：缺双向链、状态变化未传播到关联记录、漏记/重复/凭空捏造记录。
- 关键数字：Mem-agent 0.66 vs Mem0 0.39 vs 检索 0.06（gemini-3.1-pro 等权）；hint 增益 > 框架间差异。

## 与我的工作 / 记忆的映射

- 采纳 hint 诊断法：note_recall 失败时注入结构提示，判断瓶颈是「结构没识别」还是「检索/执行」。
- 体检新增双向链完整性、supersede 后依赖陈旧标记两类结构校验。
- 造结构压力题（定理依赖/学习状态/使用统计/偏好聚合）测 theorems/templates/notation，而非只测 BM25。
- capture-policy 按 record 类型写显式结构模板，充当常驻 hint，避免模型「知道算法却不套结构」。
- 借鉴 LLM-as-judge 做 recall 月度抽检，回填 verified 弱信号。
- 不适用：他们实现无关、只看最终答案，我们有固定五层 schema，不能照搬「不规定结构」。

## 研读状态

- 状态：distilled
- 研读日志：reading/shutovaEvaluatingMemoryStructure2026.md（已创建）

## 原文

- [MinerU 全文](.raw/shutovaEvaluatingMemoryStructure2026/full.md)
- [PDF](.raw/shutovaEvaluatingMemoryStructure2026/source.pdf)
