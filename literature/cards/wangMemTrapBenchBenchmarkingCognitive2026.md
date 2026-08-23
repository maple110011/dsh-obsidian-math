---
citekey: wangMemTrapBenchBenchmarkingCognitive2026
title: "MemTrapBench: Benchmarking Cognitive Traps in LLM Memory Use"
shorttitle: "MemTrapBench"
authors: "Wang, Mengru; Luo, Haozhe; Xu, Zhenqian; Cui, Zhixiang; Xu, Haoming; Yang, Qu; Fang, Jizhan; Fang, Junfeng; Zhang, Ningyu"
year: 2026
status: distilled
doi: "10.48550/arXiv.2608.20202"
url: "http://arxiv.org/abs/2608.20202"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Computation and Language, Computer Science - Computers and Society, Computer Science - Databases, Computer Science - Machine Learning"
tags: [memory-trap, applicability, retrieval-hazard, benchmark]
full_text: .raw/wangMemTrapBenchBenchmarkingCognitive2026/full.md
pdf: .raw/wangMemTrapBenchBenchmarkingCognitive2026/source.pdf
---

# MemTrapBench: Benchmarking Cognitive Traps in LLM Memory Use

> **一句话**：记忆可能不是帮助而是陷阱——即使被忠实记录、语义相关的记忆，也会锚定模型的推理策略（Reasoning Fixation）或扭曲其信念（Belief Distortion），让「有记忆」比「无记忆」更差；所有被评测记忆框架都中招，而一个推理期 prompt（AdaptiveMem）就能显著缓解。

## 摘要

Memory has become a key component of large language models, enabling them to retain information and learn from long-term interactions. However, existing memory benchmarks mainly evaluate whether information is correctly extracted, stored, and retrieved, while largely overlooking how retrieved memories reshape model reasoning and affect performance on the current task. We identify memory-induced cognitive traps: even faithfully recorded and semantically relevant memories can distort model reasoning or beliefs and degrade current task performance. To systematically evaluate these failure modes, we introduce MemTrapBench, which covers two forms of cognitive traps: Reasoning Fixation and Belief Distortion. Experiments across two model families and five representative memory frameworks show that MemTrapBench is challenging: all evaluated memory strategies underperform the no-memory setting, with even the strongest methods suffering drops of more than 10%. To mitigate these cognitive traps, we propose AdaptiveMem, a simple yet effective inference-time method that instructs LLMs to avoid memory traps. AdaptiveMem mitigates cognitive traps on MemTrapBench while preserving or improving performance on standard memory benchmarks across diverse memory frameworks.

## 核心机制 / 方法

- 定位：现有记忆基准只测「抽取/存储/更新/检索」是否做对，忽略了「检索到的记忆如何重塑当前推理」——这是记忆系统最被忽视的一环。
- 定义：记忆陷阱 = `s(ŷ_M) < s(ŷ_∅)`（有记忆的答案比无记忆更差）；记忆仍可「忠实且相关」，却在「使用」阶段锚定推理或扭曲信念。
- 分类（两大类四场景）：
  - **Reasoning Fixation（推理固定）**：Task Boundary（跨任务，旧任务规则/格式/假设残留）、Cognitive Bias（旧成功策略过度泛化到需要新策略的实例，Einstellung 效应/算法固定）、Trauma（历史负面反馈导致回避当前本应正确的策略）。
  - **Belief Distortion（信念扭曲）**：Safety（历史中反事实/沙箱专属的前提覆盖了基本安全判断）。
- 构造：1,050 例（Cognitive Bias 350 / Task Boundary 350 / Safety 200 / Trauma 150）；seed → GPT-5.4 生成多轮对话（Plant the Trap → Bury in Noise → Spring the Trap）→ 两阶段质检（自动过滤 + 专家复核）。
- 评测：正确性 / 格式 / 相关性 / 效率四维 0–5，GPT-5.2 主判 + Claude-Sonnet-4.6 交叉一致。
- 关键结果：5 个记忆框架（FullText / LightMem / MemOS / SimpleMem / EverMemOS）全部低于 no-memory 基线；Gemini 上最强 EverMemOS 71.17 vs wo/Mem 85.16（跌 >13 点），FullText（全量历史）反而最差 60.68。消融证明退化来自「陷阱语义」而非上下文长度（no-trap 对照 ≈ wo/Mem，trap 版跌到 31.05）。
- 缓解：AdaptiveMem = 一段 system prompt 技能，让模型在用记忆前识别四类风险 + 执行决策流程（锚定最新 query、只保留明确相关且不冲突的上下文、冲突时优先客观真值+安全+当前 query）；零架构改动，MemTrapBench 上 +11.8/+14.9/+11.3，LongMemEval 不降。

## 与我的工作 / 记忆的映射

- **这是对我们核心假设的直接质疑**：dsh-math-memory 优化的是「忠实记录（source→episode 证据链）+ 语义相关（BM25+note_recall）+ 验证（verified 三级 promote/demote）」——MemTrapBench 证明这三者**必要但不充分**：一条 ✅ 用户确认、高 success_rate、语义命中的技巧卡，恰恰最可能成为「旧成功策略过度泛化」（Cognitive Bias）的锚点。
- **hookPrior 是固定效应的放大器**：0.45×成功率 + 0.25×使用 + 0.20×验证 + 0.10×新近度，主动把「已确认/高频」卡排得更靠前、并配 ✅ 徽标——把最易诱发固定的记忆排第一，却没有「当前 query 不适用」的反制检查。
- **`wrong` 反馈是 blunt 的负面信号**：❌ → success_rate 减半 → 体检 weak 建议改写/归档。单次或「仅当前上下文错误」会被泛化成「避开这个技巧」，正是 Trauma 陷阱机制；缺「错在当下 vs 错在一般」的区分。
- **AGENTS.md 显式鼓励锚定记忆**：「认知锚定：新内容尽量与已有笔记挂钩」「先读再答」——这正是 AdaptiveMem 要纠正的「锚定记忆而非锚定最新 query」。
- **Belief Distortion 映射**：vault 里可能有错误定理/定义、反例 artifact 卡、被 superseded 但仍留在磁盘的旧记录；「原文证据优先」可能让错误的「原文」覆盖模型正确的先验知识，需要「客观真值/安全优先于记忆」的兜底。
- **最便宜的落地**：AdaptiveMem 本质是一段 prompt，而我们的系统 90% 靠 prompt（AGENTS.md + 注入段）——把「四风险 + 决策流程」写进 AGENTS.md 检索/回答纪律 + 注入段，零架构改动即可拿到论文的主要收益。
- **已具备的原语**：note_recall 的 operator 硬过滤（stage-1）已是部分 Task-Boundary 防护；verified/反馈/归档闭环有价值，只缺「适用性」这一维。

## 研读状态

- 状态：distilled
- 研读日志：reading/wangMemTrapBenchBenchmarkingCognitive2026.md（已创建）

## 原文

- [MinerU 全文](.raw/wangMemTrapBenchBenchmarkingCognitive2026/full.md)
- [PDF](.raw/wangMemTrapBenchBenchmarkingCognitive2026/source.pdf)
