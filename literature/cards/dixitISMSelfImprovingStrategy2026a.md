---
citekey: dixitISMSelfImprovingStrategy2026a
title: "ISM:Self-Improving Strategy Memory for Continual Mathematical Reasoning"
shorttitle: "ISM"
authors: "Dixit, Prakhar; Oates, Tim"
year: 2026
status: distilled
doi: "10.48550/arXiv.2606.31191"
url: "http://arxiv.org/abs/2606.31191"
keywords: "Computer Science - Machine Learning"
tags: []
full_text: .raw/dixitISMSelfImprovingStrategy2026a/full.md
pdf: .raw/dixitISMSelfImprovingStrategy2026a/source.pdf
---

# ISM:Self-Improving Strategy Memory for Continual Mathematical Reasoning

> **一句话**：冻结 LLM + 外部策略记忆 + 七种独立调度的自维护机制 + 符号验证门控——我们 hook/体检/反馈系统的直接蓝本。

## 摘要

We propose Intelligent Schema Memory (ISM), a self-evolving memory-augmented system that improves mathematical reasoning for a frozen LLM under continual learning with hard episodic resets. ISM maintains a compact, self-refined bank of strategy schemas learned from both successful and failed episodes, with symbolic tools that check intermediate steps and certify answers. Without updating model parameters, ISM outperforms passive, retrieval, and reflection baselines on MATH-Hard and OlympiadBench, using 64% and 86% fewer schemas respectively than the strongest passive baseline. These results show that small, actively maintained, and verified strategy memories can support reliable continual mathematical reasoning under strict episodic isolation. The codebase is available at https://github.com/pdx97/ISM .

## 核心机制 / 方法

- schema = 内容 + feature hook（operator/pattern/heuristics/quantity/质心/success_rate）分离。
- 两级检索：算子硬过滤 → 加权软打分（0.15/0.15/0.05/0.55/0.10）。
- 七机制独立调度：Audit/Correct/Merge/Promote-Demote/Prune/Reinforce/Antipattern。
- 条件演化门：≥10 集且同算子近 20 集失败 ≥3 才合成新 schema。
- 每次更新过符号验证，防错误泛化。

## 与我的工作 / 记忆的映射

- 已实现：hook 块、audit、merge/reinforce/demote 协议、verified 三级、反馈闭环。
- 差距：无 embedding 质心、无显式 promote/demote 打分调权、antipattern 待强化、无条件演化门、无周期调度。
- 验证门控 → 我们用 verified 三级 + provenance 替代符号验证。

## 研读状态

- 状态：distilled
- 研读日志：reading/dixitISMSelfImprovingStrategy2026a.md（按需创建）

## 原文

- [MinerU 全文](.raw/dixitISMSelfImprovingStrategy2026a/full.md)
- [PDF](.raw/dixitISMSelfImprovingStrategy2026a/source.pdf)
