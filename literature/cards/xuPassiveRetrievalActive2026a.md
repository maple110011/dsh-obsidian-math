---
citekey: xuPassiveRetrievalActive2026a
title: "From Passive Retrieval to Active Memory Navigation: Learning to Use Memory as a Structured Action Space"
shorttitle: "From Passive Retrieval to Active Memory Navigation"
authors: "Xu, Yue; Sun, Yutao; Liu, Yihao; Zhou, Mengyu; Qiao, Jiayi; Ma, Lu; Tang, Kai; Wang, Wenjie; Jiang, Xiaoxi; Jiang, Guanjun"
year: 2026
status: distilled
doi: "10.48550/arXiv.2607.05794"
url: "http://arxiv.org/abs/2607.05794"
keywords: "Computer Science - Artificial Intelligence"
tags: []
full_text: .raw/xuPassiveRetrievalActive2026a/full.md
pdf: .raw/xuPassiveRetrievalActive2026a/source.pdf
---

# From Passive Retrieval to Active Memory Navigation: Learning to Use Memory as a Structured Action Space

> **一句话**：把长期用户记忆重构为多粒度记忆金字塔 + 工具式主动导航，用 GRPO 训练 agent 主动选择合适粒度（而非被动检索）。

## 摘要

Long-term user memory is essential for personalized conversational agents, yet many memory systems still expose memory through passive retrieval interfaces, making the model a consumer of pre-selected evidence. We introduce NapMem, a framework for learning to use long-term user memory as a structured action space rather than passively retrieved context. NapMem organizes user history into a linked multi-granularity memory pyramid, where raw conversations, typed memory records, topic tracks, and user profiles are connected through provenance relations, and exposes these levels through memory tools. The agent is trained to select memory according to the query and intermediate evidence, allowing it to inspect different memory granularities before answering. Experiments on PersonaMem-v2, LongMemEval, and LoCoMo show that a NapMem agent trained with memory-tool reinforcement learning is competitive across diverse memory-intensive tasks, while evaluations on non-memory tasks suggest that the learned policy largely preserves general reasoning and tool-use abilities. Additional analyses examine storage, inference cost, tool-use behavior, and ablations over navigation, memory granularity, and RL training. Our results suggest that long-term user memory benefits from coupling structured storage with a learned policy for using memory at the appropriate granularity.

## 核心机制 / 方法

- 金字塔四层：raw conversations → records（fact/event/instruction/preference）→ topic tracks → user profile。
- 增量自底向上写入；records 两阶段调和（新增/更新/supersede/矛盾）。
- 五个工具 get/search_conversations、get/search_records、read_files，agent 顺序选择粒度，有工具调用预算。
- GRPO 奖励 = 格式 + 正确 + 用对记忆工具；RL 后无谓记忆调用 34.51%→6.90%。

## 与我的工作 / 记忆的映射

- 四层金字塔 ≈ 我们五层（raw=episodes、records=records、topic=topics、profile=profile）——验证结构。
- 工具式导航 ≈ note_recall/note_search/note_links/read，缺粒度选择显式化。
- 四类 records 与我们一致（多 artifact）。
- 用对/滥用工具奖励 → 被动信号（无谓检索率、空结果率、命中引用率）。
- profile 长度预算 → 我们已有 120 行约束。

## 研读状态

- 状态：distilled
- 研读日志：reading/xuPassiveRetrievalActive2026a.md（按需创建）

## 原文

- [MinerU 全文](.raw/xuPassiveRetrievalActive2026a/full.md)
- [PDF](.raw/xuPassiveRetrievalActive2026a/source.pdf)
