---
citekey: zhangUsefulMemoriesBecome2026
title: "Useful Memories Become Faulty When Continuously Updated by LLMs"
authors: "Zhang, Dylan; Lin, Yanshan; Wu, Zhengkun; Sun, Yihang; Li, Bingxuan; Li, Dianqi; Peng, Hao"
year: 2026
status: distilled
doi: "10.48550/arXiv.2605.12978"
url: "http://arxiv.org/abs/2605.12978"
keywords: "Computer Science - Artificial Intelligence"
tags: [memory-consolidation, degradation, episodic-first, gated-abstraction]
full_text: .raw/zhangUsefulMemoriesBecome2026/full.md
pdf: .raw/zhangUsefulMemoriesBecome2026/source.pdf
---

# Useful Memories Become Faulty When Continuously Updated by LLMs

> **一句话**：让 LLM 持续把经验固化成文本记忆库，效用会**先升后降**、甚至低于无记忆基线（GPT-5.4 在自己 100% 解出的 19 题 ARC-AGI 切片上，流式固化后准确率掉到 **52.6%**，Fig. 2）；损坏来自**固化步骤本身**——其中"就地重写旧条目"是单项最伤（Table 5：43.2 → 去掉它就 50.0，再隐藏旧库 70.0，而原始轨迹 76.6）。补救是把 **episode 当一等证据 + 给固化设闸**，而不是提高模型能力或优化 prompt。

## 摘要

Learning from past experience benefits from two complementary forms of memory: episodic traces -- raw trajectories of what happened -- and consolidated abstractions distilled across many episodes into reusable, schema-like lessons. Recent agentic-memory systems pursue the consolidated form: an LLM rewrites past trajectories into a textual memory bank that it continuously updates with new interactions, promising self-improving agents without parameter updates. Yet we find that such consolidated memories produced by today's LLMs are often faulty even when derived from useful experiences. As consolidation proceeds, memory utility first rises, then degrades, and can fall below the no-memory baseline. More surprisingly, even when consolidating from ground-truth solutions, GPT-5.4 fails on 54% of a set of ARC-AGI problems it had previously solved without memory. We trace the regression to the consolidation step rather than the underlying experience: the same trajectories yield qualitatively different memories under different update schedules, and an episodic-only control that simply retains those trajectories remains competitive with the consolidators we test. In a controlled ARC-AGI Stream environment that exposes Retain, Delete, and Consolidate actions, agents preserve raw episodes by default and double the accuracy of their forced-consolidation counterparts; disabling consolidation entirely (episodic management only) matches this auto regime. Practically, robust agent memory should treat raw episodes as first-class evidence and gate consolidation explicitly rather than firing it after every interaction. Looking forward, reliable agentic memory will require LLMs that can consolidate without overwriting the evidence they depend on.

## 核心机制 / 方法

- **双存储 + 三动作**：Episodic buffer（原始轨迹）与 Abstract store（跨 episode 的 lesson）分开；每步可选 `Retain` / `Delete` / `Consolidate`。三种控制回路：`Force`（每轮必须固化、episodic 不留）、`Auto`（模型自选）、`Episodic Management Only`（禁用抽象）。
- **主结果**：固化效用非单调——ScienceWorld 峰值 ≈ step 20 后持续下降、有时低于无记忆（Fig. 1a）；WebShop AWM 8 例 0.64 → 128 例 0.20（无记忆 0.20，Fig. 1b）；19 题 ARC-AGI 100% → 52.6%（Fig. 2，Table 2 口径 "100% → 54%"）。
- **归因实验**：同样的轨迹池，只改固化排程（Static-All / Static-Group / Stream）⇒ Stream 比整池一次固化掉 17–38 分（Fig. 3）；异构批次加速衰退（Fig. 4）；7 个框架、5 个 backbone、自主 coding agent 均"先升后降"（Table 3）；填充到 ~790K tokens 只差 <4 分（§L.5）、GEPA prompt 优化只靠"教解算器不信任记忆"恢复部分（§L.7）。
- **组件剥离（Table 5，准确率）**：默认就地改写 43.2 → append-only 且旧库可见 50.0 → 加剪枝不去就地编辑 64.0 → append-only 且**旧库隐藏** 70.0 → 原始轨迹 76.6。结论：就地重写最伤、剪枝有益、第一次抽象已丢信息。
- **失败模式**（§6）：误分组（Auto 需 71 步/568 例才收齐 6 类；Force 常跨类合并）、干扰（Cumulative 比 Fresh 落后 +203 分，过度泛化 ≈5×、垃圾 ≈20×）、窄流过拟合。
- **处方**（§5）：episodic 与 schema 两个角色不要塌进同一条重写回路；abstraction 应 opt-in 且被 schema fit 设闸，而不是每次交互后触发。只管 episodic 就追平/超过完整 Auto。

## 与我的工作 / 记忆的映射

- **给 P4（AI 归纳默认停 inbox / `stage: draft`）一个比"降低权重"更根本的理由**：损坏发生在**固化动作**上（改写次数越多越坏），所以闸门的意义是**减少固化次数**，不是仅给低可信标记。缺口 2（`ask` 的同意不落字段）随之升级为"要不要固化必须落成卡上字段"。
- **新增机制（P1–P7 里没有）：固化时的上下文隔离。** 我们每次组装 system-prompt 都注入 records/templates/topics 索引（`math-memory.mjs:4121-4133`），于是模型在**写新记录**时正被旧抽象锚定——对应 Table 5 的 B 行（旧库可见 50.0 vs 隐藏 70.0）。这与 P2 互补：P2 管"用记忆时降级引用"，隔离管"写记忆时不受旧抽象影响"。
- **对 P5「单源老化降权」的修正**：Zhang 的处方是"原始证据优先"，不是"给旧抽象打低权重"。降权不阻止旧抽象继续参与新固化；更贴近证据的做法是在**固化输入**里移除旧抽象。
- **对 `methodologyInRecords`（`:2055-2077`）的升级**：现在是事后报告，本文的异构批次结论支持把它提前成写入前的**分族检查**（一条卡覆盖几个族）。
- **不适用**：Force/Auto 是逐步决策的 agent loop，我们没有人机对话之外的自主动作循环；Table 3 那类"自主 agent 管记忆"只借结论（能力与预算不治病）。
- **证据强度边界**：全部实验在程序化 agent benchmark 上、记忆是 LLM 自写的 lesson bank；**没有**任何实验测"人类笔记 + AI 补全"的混合库。可迁移的是机制，不可换算成 vault 的具体退化幅度。

## 研读状态

- 状态：distilled
- 状态更新：2026-10-01
- 研读日志：reading/zhangUsefulMemoriesBecome2026.md（已创建）

## 原文

- [MinerU 全文](.raw/zhangUsefulMemoriesBecome2026/full.md)
- [PDF](.raw/zhangUsefulMemoriesBecome2026/source.pdf)
