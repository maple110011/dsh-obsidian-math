---
citekey: huQueryLinkLeveragingQueryMemory2026
title: "QueryLink: Leveraging Query-Memory Alignment for Long-Term Reasoning in LLM Agents"
shorttitle: "QueryLink"
authors: "Hu, Xuxian; Teng, Zhu; Zhang, Wei; He, Ming; Fan, Jianping"
year: 2026
status: distilled
doi: "10.18653/v1/2026.findings-acl.765"
url: "https://aclanthology.org/2026.findings-acl.765/"
tags: [query-memory-alignment, multi-grained-retrieval, flat-memory, chunking]
full_text: .raw/huQueryLinkLeveragingQueryMemory2026/full.md
pdf: .raw/huQueryLinkLeveragingQueryMemory2026/source.pdf
---

# QueryLink: Leveraging Query-Memory Alignment for Long-Term Reasoning in LLM Agents

> **一句话**：长时记忆检索失败的根因是「隐式意图型 query」与「显式叙事型 memory」之间的语义鸿沟；QueryLink 用对称多粒度表征（Raw / Semantic-Event / Keyword + centroid）把两者投影到共享空间、多粒度检索（union）召回，证明「对齐好的扁平记忆 > 复杂图结构」。

## 摘要

Retrieval-Augmented Generation (RAG) systems are widely used to mitigate the stateless nature of Large Language Models (LLMs) in long-term and personalized interactions by incorporating external memory. However, existing approaches often prioritize memory organization, such as knowledge graphs, while overlooking a critical semantic gap between implicit, intent-driven queries and explicit, narrative-based memories. To bridge this gap, we propose QueryLink, a novel framework that leverages Query-Memory Alignment to project both queries and memories into a shared semantic space. It significantly boosts recall by facilitating multi-grained retrieval of semantically relevant information. To further enhance memory retrieval, we leverage Coherent Memory Chunking, a mechanism that processes memories in multi-turn dialogue units, preserving semantic integrity, rather than relying on fixed-size segments. Extensive experiments on the LoCoMo and LongMemEval benchmark demonstrate that QueryLink significantly outperforms SOTA methods, achieving at least a 7% improvement in reasoning accuracy (measured by LLM). Additionally, QueryLink can be integrated as a plug-and-play component to boost existing vector-based systems like A-MEM, leading to improvements of over 6% in both F1 and B1 scores.The code is available at https://github.com/Dontplay0112/querylink.

## 核心机制 / 方法

- 问题：query 是隐式/疑问/高层次（「我们决定了什么？」），memory 是显式/叙事/实体密集（「用户周二确认 API 是瓶颈」）；raw embedding 相似度仅 0.445，对齐后 0.599（+15.4%）。
- **Coherent Memory Chunking**：以多轮对话为语义单元（滑窗 W=5，超限时用摘要而非丢弃），保留完整「trigger-response」逻辑，不用固定 token 切块。
- **Query-Memory Alignment（对称多粒度）**：Raw（词法基线）+ Semantic/Event（query 侧生成「假设事件/意图」，memory 侧提取显式事件 + 隐式偏好）+ Keyword（实体/专名锚定）；centroid = 归一化求和（各粒度噪声互相抵消，去噪）。
- **Multi-grained retrieval**：四粒度各自 TopK 后取 **union**（「broad retrieval」，单一表征易漏检）。
- 结果：LoCoMo Judge 81.75（Nemori 74.38 / Mem0 66.88）；Temporal +25%（vs Mem0）；A-MEM + QM-Align 后 F1/B1 +6+，Open Domain F1 翻倍；**flat memory 打败 graph**；k=4 优于 k=8（「过度检索诅咒」）；离线索引 560K token vs Mem0 1693K。

## 与我的工作 / 记忆的映射

- 我们已有 query 侧蒸馏（「挑战描述 + 候选技巧」）+ memory 侧 hook 字段（operator/pattern/techniques/applications = 多粒度），但**没有「对称对齐」的概念**——query 的「挑战」与 card 的「applications」应该用同一套措辞才能命中。
- **「扁平记忆 + 对齐 > 图」验证了我们的五层 markdown（扁平文件）路线**，不必上知识图谱（REFACTOR-PLAN Q4 里曾纠结过共存）。
- **「过度检索诅咒」（k=8 劣于 k=4）印证我们「读前 2-3 条」的纪律**——多注入不更好。
- Coherent chunking 印证 episodes 的设计（整段对话、非固定切块、append-only）。
- 不适用：QueryLink 依赖 embedding + 索引期 LLM 生成多粒度视图（离线 token 高）；我们零 embedding + 零额外 LLM 索引，等价物是把 hook 字段当「手工多粒度视图」、把「applications」写成「这条卡回答哪些问题」。

## 研读状态

- 状态：distilled
- 研读日志：reading/huQueryLinkLeveragingQueryMemory2026.md（已创建）

## 原文

- [MinerU 全文](.raw/huQueryLinkLeveragingQueryMemory2026/full.md)
- [PDF](.raw/huQueryLinkLeveragingQueryMemory2026/source.pdf)
