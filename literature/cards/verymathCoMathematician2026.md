---
citekey: verymathCoMathematician2026
title: "Co-Mathematician: A repository-backed mathematical research workspace for coding agents"
shorttitle: "Co-Mathematician"
authors: "VeryMath"
year: 2026
status: distilled
url: "https://github.com/VeryMath/co-mathematician"
keywords: "Computer Science - Artificial Intelligence"
tags: [state-machine-gates, approval-gate, reviewer-loop, provenance-required, uncertainty-required, failed-attempts-preserved, deterministic-harness]
full_text: ""
pdf: ""
---

# Co-Mathematician: A repository-backed mathematical research workspace for coding agents

> **一句话**：把数学研究对话变成**文件承载的长期项目**，公式是 `coding agent + 仓库文件系统 + 门控 + 评审循环 = 研究工作台`；最关键的一条硬规则是 **"草稿目标不可执行——目标只有 `status: approved` 才能接收工作流"**，且最终论文**只从通过独立评审的报告渲染**。**对我们的价值：它是"把门控做成可程序检查的状态机"与"失败尝试/不确定性是产出必填项"的一手范本。**

## 摘要

A lightweight research workspace for using a repository-aware coding agent as an AI co-mathematician. Core formula: coding agent + repo filesystem + gates + reviewer loop = research workspace. Draft goals are not executable; a goal can receive workstreams only when status is approved. Workstream kinds proof/computation/literature/review; reports must carry provenance, explicit uncertainty, failed explorations and independent reviews; the final working paper is rendered only from reviewed reports. Inspired by Google DeepMind's AI Co-Mathematician paper (arXiv:2605.06651), not a reproduction.

## 核心机制 / 方法

> 来源：README v0.2.0（已核验）。作者自述"受 DeepMind AI Co-Mathematician 论文的公开设计原则启发，但**不是**复现"。

- **★ 门控是状态机，可程序检查**：**"草稿目标不可执行。目标只有在 `status: approved` 时才能接收工作流。"** 命令 `co-math check-gate --gate goal_approval --goal-id G1`；另一道是 `workstream_completion`。**门不是提示词里的建议，是 harness 能验证的状态。**
- **★ 确定性与模型动作物理分离**：Python harness **"不跑 agent"**——只做**初始化文件、追加消息、创建（已批准的）工作流、检查门控、渲染最终论文**。agent 是你的 coding agent。
- **工作流四类**：`proof` / `computation` / `literature` / `review`。**每份报告必须带**：重要论断的**溯源**、**显式的不确定性**、**失败探索的记录**，以及 `reviews/` 下的**独立评审**。
- **最终产出**：`co-math render-final` 只从通过评审的报告渲染 `workspace/final/working_paper.md`——**"是工作论文，不是聊天总结"**，须保留溯源、不确定性、失败探索与评审状态。
- **★ 技能移交是一等公民**：`co-math skill-handoff --skill … --mode skill_guided --reason … --query … --skill-path …` 落 `skill_handoffs.jsonl`。语义：**任务被判定属于某领域 Skill 的辖区 ⇒ 记录移交，之后按该 Skill 自己的流程走；只有用户想要持久研究产出时才启用完整的目标/工作流/评审流程。**
- **项目独立且长期存活**：`co-math new/list/status/resume/next/archive/reopen`；每个项目自带目录、workspace、Skill 与可选 Git 仓库；**项目 B 不会清理或复用项目 A 的文件**。
- **规范位置唯一**：`.agents/skills/co-mathematician/SKILL.md` 是规范技能位置；`AGENTS.md` 是通用入口；`CLAUDE.md` 只是指向同一套说明的短壳；`.codex/`、`.claude/`、`.cursor/` 仅是**开发适配器**。
- **作用域实践**：项目本地技能装 `.agents/skills/`，**全局技能根只在有意跨项目共享时才用**；registry scanner 同时发现 `.agents/skills/<skill>/` 与嵌套 `.agents/skills/<category>/<skill>/`。
- **无检索层**：没有索引、没有 BM25，技能发现靠 `co-math suggest-skills --query`。

## 与我的工作 / 记忆的映射

- **★ "状态即权限"是我们最该抄的形状**：我们已有状态机（`strategy: candidate → active`、`inbox → polishing → done`、`records: active / superseded`、`verified: single-source → cross-referenced → user-confirmed`），但**没有一条"未达状态即结构性禁止"的显式规则**。它给出范本：**`candidate` 策略卡不得作为结论依据注入**（只能作为"待验证线索"列出）；`done` 的备忘不得再算活跃。这是**零 token** 的协议 + 体检断言。
- **★ "失败尝试 + 不确定性"是产出必填项**：我们已有反模式与 `confidence`，但**没有要求把"试过但没成功"结构化成产出**。这与 MSCE 的"反证据约束边界、产出反模式"、GraphMemix 的"低价值轨迹仍保留作反证据"**三方同向**——可以合成一条设计原则。
- **★ 技能移交记录可移植**：我们 `note_strategy` 命中后"按清单逐步 `note_recall`（≤4 步）"是同类动作，但**没有留下移交记录**——回答不了"这次为什么走了策略路线、用了哪张卡的检索目标"。落一条轻量记录（哪个 difficulty/哪张策略卡/什么理由）成本很低。
- **"harness 不跑 agent"= 我们"插件不调模型"**：**我们与它独立收敛到同一条**——确定性动作与模型动作分离。这是我们设计正当性的又一条外部论据。
- **只绑定 `127.0.0.1` 等本地优先姿态**（同组织的术语库/教材台一致）与我们 `docs/port-and-isolation.md` 的隔离思路同源。
- **不适用**：多工作流/评审循环/最终论文渲染（我们是**学习辅助**，不是研究项目管理）；`Git` 仓库化每个项目；它**没有检索层**，也**没有记忆分层**——这两块我们是相对优势。
- **反向提醒**：它的"门控 + 评审"很重（目标要批准、工作流要四类、报告要评审才能出终稿）。**我们的场景是即时学习对话，不能照搬这种重流程**——要抄的是"状态 = 权限"这个**轻量**形状，不是整套流程。

## 研读状态

- 状态：distilled
- 研读日志：reading/verymathOrg2026.md（**组织级调研**，Co-Mathematician 见 §4 / §6 / §7 / §8）
- 源质量：无 PDF/MinerU（网页源）。事实来自 README v0.2.0，已核验。

## 原文

- [仓库](https://github.com/VeryMath/co-mathematician)
- [官网手册（含 Co-Mathematician 一节）](https://verymath.github.io/handbook/HANDBOOK.zh-CN.html)
