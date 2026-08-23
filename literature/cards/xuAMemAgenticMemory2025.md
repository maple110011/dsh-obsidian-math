---
citekey: xuAMemAgenticMemory2025
title: "A-Mem: Agentic Memory for LLM Agents"
shorttitle: "A-Mem"
authors: "Xu, Wujiang; Liang, Zujie; Mei, Kai; Gao, Hang; Tan, Juntao; Zhang, Yongfeng"
year: 2025
status: distilled
doi: "10.52202/085713-0593"
url: "https://proceedings.neurips.cc/paper_files/paper/2025/hash/19909c36f51abc4856b4560aff3d36d6-Abstract-Conference.html"
tags: []
full_text: .raw/xuAMemAgenticMemory2025/full.md
pdf: .raw/xuAMemAgenticMemory2025/source.pdf
---

# A-Mem: Agentic Memory for LLM Agents

> **一句话**：Zettelkasten 式 agentic 记忆：原子笔记 + LLM 自动关键词/标签/上下文描述 + 链接生成 + 记忆演化，无预定义 schema，多跳关系靠链接网络。

## 摘要

While large language model (LLM) agents can effectively use external tools for complex real-world tasks, they require memory systems to leverage historical experiences. Current memory systems enable basic storage and retrieval but lack sophisticated memory organization, despite recent attempts to incorporate graph databases. Moreover, these systems' fixed operations and structures limit their adaptability across diverse tasks. To address this limitation, this paper proposes a novel agentic memory system for LLM agents that can dynamically organize memories in an agentic way. Following the basic principles of the Zettelkasten method, we designed our memory system to create interconnected knowledge networks through dynamic indexing and linking. When a new memory is added, we generate a comprehensive note containing multiple structured attributes, including contextual descriptions, keywords, and tags. The system then analyzes historical memories to identify relevant connections, establishing links where meaningful similarities exist. Additionally, this process enables memory evolution -- as new memories are integrated, they can trigger updates to the contextual representations and attributes of existing historical memories, allowing the memory network to continuously refine its understanding. Our approach combines the structured organization principles of Zettelkasten with the flexibility of agent-driven decision making, allowing for more adaptive and context-aware memory management. Empirical experiments on six foundation models show superior improvement against existing SOTA baselines. The code is available at textbackslashurlhttps://anonymous.4open.science/r/AgenticMemory-76B4.

## 核心机制 / 方法

- 笔记 m = {原文, 时间戳, LLM 关键词, LLM 标签, LLM 上下文描述, embedding, 链接集合}，原子化。
- Note Construction：LLM 从交互生成 K/G/X 语义字段 + 文本编码 embedding。
- Link Generation：新笔记与 top-k 相似历史笔记由 LLM 判定建立链接（多「盒」归属）。
- Memory Evolution：新笔记到来时演化近邻笔记的上下文/关键词/标签。
- Retrieve：查询 embedding 余弦 top-k，命中时自动带出同盒链接记忆（多跳）。
- 成本：约 1200 tokens/操作，比基线省 85-93%。

## 与我的工作 / 记忆的映射

- 原子卡 + 链接 → 采纳：records 已有 source/related，缺「自动链接」；三写第 2 步可显式要求检索近邻并建 related。
- K/G/X 字段 → 改造：hook 的 techniques/applications 是领域化版本，可补通用 keywords/tags。
- Memory Evolution → 采纳：并入每日 merge/reinforce 协议。
- 同盒顺链 → 采纳：note_links 已有，缺「自动」触发；note_recall 命中后可默认顺链一步。
- embedding → 不适用：我们用 BM25 + hook 字段替代；自动链接仍需模型执行。
- 无预定义 schema → 部分不适用：我们的五层 + 类型更结构化，保留。

## 研读状态

- 状态：distilled
- 研读日志：reading/xuAMemAgenticMemory2025.md（按需创建）

## 原文

- [MinerU 全文](.raw/xuAMemAgenticMemory2025/full.md)
- [PDF](.raw/xuAMemAgenticMemory2025/source.pdf)
