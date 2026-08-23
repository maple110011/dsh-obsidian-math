---
citekey: forouzandehLearningHierarchicalProcedural2025
title: "Learning Hierarchical Procedural Memory for LLM Agents through Bayesian Selection and Contrastive Refinement"
authors: "Forouzandeh, Saman; Peng, Wei; Moradi, Parham; Yu, Xinghuo; Jalili, Mahdi"
year: 2025
status: distilled
doi: "10.48550/arXiv.2512.18950"
url: "http://arxiv.org/abs/2512.18950"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Machine Learning"
tags: []
full_text: .raw/forouzandehLearningHierarchicalProcedural2025/full.md
pdf: .raw/forouzandehLearningHierarchicalProcedural2025/source.pdf
---

# Learning Hierarchical Procedural Memory for LLM Agents through Bayesian Selection and Contrastive Refinement

> **一句话**：MACLA 把学习从 LLM 参数解耦到外部分层程序记忆——贝叶斯后验选程序、对比精化修程序、元程序组合长程策略，不微调权重即可样本高效地持续改进。

## 摘要

We present MACLA, a framework that decouples reasoning from learning by maintaining a frozen large language model while performing all adaptation in an external hierarchical procedural memory. MACLA extracts reusable procedures from trajectories, tracks reliability via Bayesian posteriors, selects actions through expected-utility scoring, and refines procedures by contrasting successes and failures. Across four benchmarks (ALFWorld, WebShop, TravelPlanner, InterCodeSQL), MACLA achieves 78.1 percent average performance, outperforming all baselines. On ALFWorld unseen tasks, MACLA reaches 90.3 percent with 3.1 percent positive generalization. The system constructs memory in 56 seconds, 2800 times faster than the state-of-the-art LLM parameter-training baseline, compressing 2851 trajectories into 187 procedures. Experimental results demonstrate that structured external memory with Bayesian selection and contrastive refinement enables sample-efficient, interpretable, and continually improving agents without LLM parameter updates.

## 核心机制 / 方法

- 外部程序记忆两层：原子程序 {goal, precondition, action, postcondition} + 元程序（带 continue/skip/repeat/abort 控制流）；冻结 LLM 只做抽象与动作，学习全在外部可读记忆。
- 贝叶斯后验选程序：Beta(α,β) 追踪可靠性，期望效用 EU = 相关度×成功率 − 风险×失败代价 + 探索熵；低于置信阈值回退零样本并记录。
- 对比精化：某程序同时积累 ≥3 成功与 ≥3 失败上下文时，对比提取判别子（Δ前置 / Δ动作 / Δ后置）修程序。
- 本体语义索引：高频词嵌入聚类成同义簇（mug/cup/glass），跨词面泛化，缓解换说法检索不到。
- 多因素效用剪枝：0.5 可靠性 + 0.3 频率 + 0.2 新近度。
- 规模有界：程序 200 / 元程序 50 / 失败索引 15 / buffer 1000；2851 轨迹压缩成 187 程序。

## 与我的工作 / 记忆的映射

- 程序四元组 → 改造：给 technique / template 卡补 precondition / postcondition 字段，与 operator/pattern/heuristics 并列。
- Beta 后验 → 采纳：把 success_rate 升级为 success/fail 双计数，note_recall 重排层加后验项。
- 置信阈值 + 回退 → 采纳：与现有 coverage<0.35 词面巧合判定、精读协议「明说没有」同构，直接对齐为阈值语义。
- 对比精化 → 采纳：与 [对]/[错] 反馈闭环 + 每日 merge/reinforce/demote 契合，加「同一记录 ≥3 对相反反馈才允许 reinforce」护栏。
- 元程序 playbook → 改造：对应 templates 题型-定理图，可加组合节点（数学解题的稳定顺序弱于具身任务）。
- 本体聚类 → 改造：对应 notation 同义簇，只作可选派生 cache，不破坏无数据库原则。
- 效用剪枝 → 采纳：替换 daily audit 单一 unused 排序；剪枝=归档（无删除工具）。
- 环境 step 奖励 → 不适用：我们靠用户反馈 + 体检（密度低），需把单次使用也计入后验证据。

## 研读状态

- 状态：distilled
- 研读日志：reading/forouzandehLearningHierarchicalProcedural2025.md（按需创建）

## 原文

- [MinerU 全文](.raw/forouzandehLearningHierarchicalProcedural2025/full.md)
- [PDF](.raw/forouzandehLearningHierarchicalProcedural2025/source.pdf)
