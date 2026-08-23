---
citekey: chenAgentIRReasoningAwareRetrieval2026
title: "AgentIR: Reasoning-Aware Retrieval for Deep Research Agents"
shorttitle: "AgentIR"
authors: "Chen, Zijian; Ma, Xueguang; Zhuang, Shengyao; Lin, Jimmy; Asai, Akari; Zhong, Victor"
year: 2026
status: distilled
doi: "10.48550/arXiv.2603.04384"
url: "http://arxiv.org/abs/2603.04384"
keywords: "Computer Science - Computation and Language"
tags: []
full_text: .raw/chenAgentIRReasoningAwareRetrieval2026/full.md
pdf: .raw/chenAgentIRReasoningAwareRetrieval2026/source.pdf
---

# AgentIR: Reasoning-Aware Retrieval for Deep Research Agents

> **一句话**：把 Deep Research 智能体检索前的推理轨迹与查询联合编码（推理感知检索），并用 DR-Synth 从普通 QA 数据合成子查询级正负样本，训练出比 BM25、更大 dense 模型和 LLM 重排都更准、更省搜索步数的 AgentIR-4B。

## 摘要

Deep Research agents are rapidly emerging as primary consumers of modern retrieval systems. Unlike human users who issue and refine queries without documenting their intermediate thought processes, Deep Research agents generate explicit natural language reasoning before each search call, revealing rich intent and contextual information that existing retrievers entirely ignore. To exploit this overlooked signal, we introduce: (1) Reasoning-Aware Retrieval, a retrieval paradigm that jointly embeds the agent's reasoning trace alongside its query; and (2) DR-Synth, a data synthesis method that generates Deep Research retriever training data from standard QA datasets. We demonstrate that both components are independently effective, and their combination yields a trained embedding model, AgentIR-4B, with substantial gains. On the challenging BrowseComp-Plus benchmark, AgentIR-4B achieves 68 textbackslash% accuracy with the open-weight agent Tongyi-DeepResearch, compared to 50 textbackslash% with conventional embedding models twice its size, and 37 textbackslash% with BM25. Code and data are available at: https://texttron.github.io/AgentIR/.

## 核心机制 / 方法

1. 定位：检索器只收到智能体孤立的子查询，查询欠指定（歧义、依赖前文线索），而智能体检索前显式生成的推理轨迹被现有检索器完全忽略。
2. 关键设计：把当前轮推理 τ_t 与查询 q_t 拼接后联合编码 [τ_t, q_t]，让检索器读到任务意图、对既往结果的反思、对搜索目标的假设；τ_t 本就「免费」产生，零额外推理开销。
3. DR-Synth：从标准 QA (Q,A,P) 跑智能体 rollout 得子查询；每轮取 top-50 候选、前插正文档 P、用 LLM listwise 重排（输入 q_t + 全局 Q + 真答案 A），第 1 名作正例、末 7 名作难负例，只保留答对的 rollout（rejection sampling）。
4. 训练：contrastive loss（温度 0.01）微调 Qwen3-Embedding-4B，5,238 条 WebShaper 合成实例。
5. 组件独立有效：仅拼轨迹不训练 +6.9 点，仅训练不拼轨迹 +10.7，二者叠加最大。
6. 「遗忘是特性」：当前轮推理天然总结已确认线索并滤掉错误假设（k=1 已覆盖 >40% 历史线索）；喂全历史（含文档）反而传播噪声（11.45% 任务零召回、37.46 轮）。
7. 可迁移：检索时把「当前意图/已确认事实」作简短前缀拼进查询，只带当前轮、不带全历史。

## 与我的工作 / 记忆的映射

1. 可借鉴：给 note_recall 的蒸馏查询加「检索意图前缀」，拼入当前目标与已确认事实；只保留当前轮、丢弃失败候选与错误假设。
2. 可借鉴：把 loopback ❌ 标记沉淀为难负例池，用于校准 BM25 排序或未来训练轻量重排。
3. 可借鉴：把零召回、搜索轮数膨胀作为检索质量的被动体检信号（现有体检只有缺 source/断链/未入索引等结构校验）。
4. 可借鉴：正例需「对本轮相关 + 对齐全局目标」双重背书，对应 records 的 source 溯源与 confirmed 升级。
5. 不适用：4B dense 微调与云端合成数据管线，我们坚持全 markdown + BM25、无数据库。
6. 与现有关系：强化精读协议的改写纪律——改写查询时丢弃上一轮被否候选、只带已确认线索；任何增强都保留 BM25 词面基线做混合。

## 研读状态

- 状态：distilled
- 研读日志：reading/chenAgentIRReasoningAwareRetrieval2026.md（按需创建）

## 原文

- [MinerU 全文](.raw/chenAgentIRReasoningAwareRetrieval2026/full.md)
- [PDF](.raw/chenAgentIRReasoningAwareRetrieval2026/source.pdf)
