---
citekey: kangMemoryOSAI2025
title: "Memory OS of AI Agent"
authors: "Kang, Jiazheng; Ji, Mingming; Zhao, Zhe; Bai, Ting"
year: 2025
status: distilled
doi: "10.48550/arXiv.2506.06326"
url: "http://arxiv.org/abs/2506.06326"
keywords: "Computer Science - Artificial Intelligence"
tags: []
full_text: .raw/kangMemoryOSAI2025/full.md
pdf: .raw/kangMemoryOSAI2025/source.pdf
---

# Memory OS of AI Agent

> **一句话**：OS 式三层记忆：STM 对话页 → MTM 主题段（分段分页）→ LPM 人格，按「热度」淘汰与升级，兼顾主题一致与长期个性化。

## 摘要

Large Language Models (LLMs) face a crucial challenge from fixed context windows and inadequate memory management, leading to a severe shortage of long-term memory capabilities and limited personalization in the interactive experience with AI agents. To overcome this challenge, we innovatively propose a Memory Operating System, i.e., MemoryOS, to achieve comprehensive and efficient memory management for AI agents. Inspired by the memory management principles in operating systems, MemoryOS designs a hierarchical storage architecture and consists of four key modules: Memory Storage, Updating, Retrieval, and Generation. Specifically, the architecture comprises three levels of storage units: short-term memory, mid-term memory, and long-term personal memory. Key operations within MemoryOS include dynamic updates between storage units: short-term to mid-term updates follow a dialogue-chain-based FIFO principle, while mid-term to long-term updates use a segmented page organization strategy. Our pioneering MemoryOS enables hierarchical memory integration and dynamic updating. Extensive experiments on the LoCoMo benchmark show an average improvement of 49.11% on F1 and 46.18% on BLEU-1 over the baselines on GPT-4o-mini, showing contextual coherence and personalized memory retention in long conversations. The implementation code is open-sourced at https://github.com/BAI-LAB/MemoryOS.

## 核心机制 / 方法

- STM：对话页 {Q,R,T,链元信息}；MTM：同主题页聚成段（段=LLM 摘要）；LPM：User/Agent 双人格（静态画像 + 动态 traits + User KB）。
- STM→MTM FIFO；MTM→LPM 热度超阈值（τ=5）升级；段按热度淘汰。
- Heat = α·访问次数 + β·交互页数 + γ·新近度（exp 衰减）。
- MTM 两段式检索：先选段（cos+Jaccard）再段内选页；LPM 取 top-10。

## 与我的工作 / 记忆的映射

- STM/MTM/LPM → 改造：episodes=页、topics=段、profile=LPM 已同构；缺「热度」动态淘汰/升级信号。
- 两段式检索 → 采纳：导航注入 + note_recall 精读等价。
- 人格分层 → 改造：profile 可补静态/动态标注。
- 固定队列 → 不适用：markdown 不设队列，用体检 + 归档。

## 研读状态

- 状态：distilled
- 研读日志：reading/kangMemoryOSAI2025.md（按需创建）

## 原文

- [MinerU 全文](.raw/kangMemoryOSAI2025/full.md)
- [PDF](.raw/kangMemoryOSAI2025/source.pdf)
