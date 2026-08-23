---
citekey: juAutomatedConjectureResolution2026a
title: "Automated Conjecture Resolution with Formal Verification"
authors: "Ju, Haocheng; Gao, Guoxiong; Jiang, Jiedong; Wu, Bin; Sun, Zeming; Liu, Shurui; Chen, Leheng; Wang, Yutong; Wang, Yuefeng; Wang, Zichen; He, Wanyi; Wu, Peihao; Xiao, Liang; Liu, Ruochuan; Dai, Bryan; Dong, Bin"
year: 2026
status: distilled
doi: "10.48550/arXiv.2604.03789"
url: "http://arxiv.org/abs/2604.03789"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Machine Learning"
tags: []
full_text: .raw/juAutomatedConjectureResolution2026a/full.md
pdf: .raw/juAutomatedConjectureResolution2026a/source.pdf
---

# Automated Conjecture Resolution with Formal Verification

> **一句话**：Rethlas（非形式推理 + Matlas 定理检索）+ Archon（Plan/Lean 双 agent + LeanSearch）端到端解决 Anderson 开问题并在 Lean 4 验证，靠检索发现跨域技术、靠形式 agent 自动填证明缺口。

## 摘要

Recent advances in large language models have significantly improved their ability to perform mathematical reasoning, extending from elementary problem solving to increasingly capable performance on research-level problems. However, reliably solving and verifying such problems remains challenging due to the inherent ambiguity of natural language reasoning. In this paper, we propose an automated framework that integrates natural language reasoning with formal verification to tackle research-level mathematical problems. Our framework consists of two components: an informal reasoning agent, Rethlas, and a formal verification agent, Archon. Rethlas combines reasoning primitives with our theorem search engine, Matlas, to explore solution strategies and construct candidate proofs. Archon, equipped with LeanSearch, translates informal arguments into formalized Lean 4 projects through task decomposition, iterative refinement, and automated proof synthesis, ensuring machine-checkable correctness. Using this framework, we resolve an open problem in commutative algebra and formally verify the resulting proof in Lean 4 with essentially no human involvement. Additional case studies illustrate the capabilities of Rethlas in informal mathematical reasoning and discovery, as well as the ability of Archon to formalize research-level proofs in Lean 4. Our experiments demonstrate that strong theorem retrieval tools enable the discovery and application of cross-domain mathematical techniques, while the formal agent can autonomously fill nontrivial gaps in informal arguments. More broadly, our work illustrates a promising paradigm for mathematical research in which informal and formal reasoning systems, equipped with theorem retrieval tools, operate in tandem to produce verifiable results, reduce human effort, and support human-AI collaborative mathematical research.

## 核心机制 / 方法

- 双 agent 流水线：Rethlas 生成候选证明（generation + verification 迭代），Archon 转 Lean 4 并用内核保证正确。
- Rethlas 技能 = 推理原语：toy example、反例、搜结果、分解计划、直接/递归证明、识别关键失败，互连非固定顺序。
- Matlas：对 arXiv ~13.6M 数学语句做语义检索（embedding + cosine），发现跨域定理（如 Jensen 结果）。
- Archon 双 agent：Plan Agent 新上下文分解 + 定向指导，Lean Agent 受限范围执行，缓解上下文污染/任务厌恶。
- 持久记忆：每 session 强制 summary + 全局 status 文档 + Review Agent 跨 session 合成趋势检测停滞；失败路线持久化。
- LeanSearch：模糊检索 Mathlib（>267k 定理），判断库内是否已有结论，决定调库还是自证。
- 验证双层：lake build 无 sorry/axiom + Comparator 对照人工审过的顶层规范；人只审陈述与关键定义。
- 规模：Anderson 证明 ~19,448 行 Lean/42 文件/80h，唯一人工是下载付费 PDF。

## 与我的工作 / 记忆的映射

- 采纳 session summary + 全局进度文档：给长题加 progress ledger（阶段/子目标状态/已试路线），随会话更新。
- 新增「负结果/失败方法」记忆（record 类型或 tag），避免重复走死路。
- 候选证明路线与已确认定理/源分开存放，读时按需加载，保持上下文干净。
- 每日体检加会话级停滞检测（连续 N 轮同一路线即 flag 换策略）。
- note_recall 给 theorems/templates 加可选向量相似检索，补 BM25 表面词盲区，支持跨域发现。
- hook 的 techniques/applications 强化为「证明技巧/构造/归约」字段，检索时随 theorem 一起取。
- 不适用：Lean/内核证明管道与 80h 级预算不适配右侧栏 markdown 助手；双层验证可降级为「机器结构校验 + 人工审顶层结论」。

## 研读状态

- 状态：distilled
- 研读日志：reading/juAutomatedConjectureResolution2026a.md（已创建）

## 原文

- [MinerU 全文](.raw/juAutomatedConjectureResolution2026a/full.md)
- [PDF](.raw/juAutomatedConjectureResolution2026a/source.pdf)
