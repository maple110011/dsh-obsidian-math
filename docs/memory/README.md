# 记忆系统知识库（Memory System Knowledge Base）

> 本目录是 Obsidian 笔记助手**记忆系统与检索**的长期文档中心。记忆系统的设计、评估、改造、参考文献、决策记录都在这里维护——记忆与检索是本项目后续长期的优化重点，任何一次改造都应先在这里留下文字，再动代码。
>
> 适用对象：项目维护者、参与记忆系统改造的 agent 与协作者。

## 目录导航

| 文档 | 内容 | 更新时机 |
|---|---|---|
| [`design.md`](design.md) | **当前实现**的记忆系统规格：五层结构、注入预算、检索路由、写回协议、生命周期与安全边界 | 每次代码改动落地后同步 |
| [`assessment.md`](assessment.md) | **评估记录**：两轮系统评估的完整结论（问题清单、打分、改进优先级） | 每轮正式评估后追加 |
| [`v2-proposal.md`](v2-proposal.md) | **改造方案**：hook schema、两级检索、确定性维护 pass、验证等级、记忆控制面；标注实现状态 | 方案定稿/实现状态变化时更新 |
| [`references.md`](references.md) | **参考文献笔记**：每篇论文的核心结论、可借鉴机制、与我们的映射关系 | 读完新论文后追加 |
| [`changelog.md`](changelog.md) | **记忆系统专属变更日志**：比仓库根 CHANGELOG 更细的"为什么改、改了什么" | 每次记忆系统改动后追加 |

## 核心结论（TL;DR）

1. **现状**：五层持久记忆（profile / topics / records / episodes / inbox）+ 模板-定理关联图，方向正确、证据链完整；但读靠全量注入、写靠模型自律、管靠用户翻文件夹，是"规则注入型记忆"而非"检索型记忆"。
2. **长期方向**（详见 [`v2-proposal.md`](v2-proposal.md)）：
   - 检索式注入：静态摘要瘦身 + feature-hook 两级检索（ISM 式），已实现 `note_retrieve`；
   - 确定性维护：ISM 七机制的本土化维护 pass（审计报告已实现，模型执行的合并/强化走协议）；
   - 记忆控制面：浏览/溯源/反馈（规划中，依赖 Web GUI 面板能力）。
3. **不可动摇的原则**（来自两轮评估）：原文证据优先；写时保留（superseded 而非删除）；检索先粗后细；证明可核查；所有记忆写入带来源与验证等级；fail-closed 安全边界。

## 工作约定（对协作者/agent）

- 改记忆系统代码前，先读 `design.md` 确认现状；设计变更先更新 `v2-proposal.md` 并记录到 `changelog.md`。
- 新读的论文必须把要点沉淀到 `references.md`（含 URL、核心机制、可借鉴点、不适用的部分），否则评估和方案失去依据。
- 检索层每次改动后跑回归检查（当前为 `npm test`；后续将补充 Exercise100 式记忆回归基准，见 `v2-proposal.md` §6）。
- 文档与代码同 PR 提交：**只改代码不改文档的改造视为未完成**。

## 当前状态（2026-08）

| 项目 | 状态 |
|---|---|
| v2 之 hook 解析 + `note_retrieve` 两级检索 | ✅ 已实现（`dsh/preset/obsidian-notes.mjs`） |
| v2 之确定性记忆体检（audit pass） | ✅ 已实现（`dsh/preset/obsidian-memory.mjs`，`cache/memory-audit.json`） |
| v2 之模型执行的 merge/reinforce/demote 协议 | ✅ 协议已写入 `AGENTS.md`（第 2/6 节），待长期使用检验 |
| v2 之验证徽标 + 反馈链接（阶段 1a） | ✅ 已实现（`/feedback` 端点 + 徽标渲染规则，见 control-panel.md） |
| v2 之记忆视图（Obsidian 面板，阶段 1b） | ✅ 已实现（MemoryView ItemView；设置页按钮 + 命令面板入口，brain 标签图标） |
| v2 之检索式注入（静态瘦身 + 每轮召回 top-k） | ✅ 已实现（见 design.md §3/§4） |
| v2 之 dialogue index 修复 + 相关性提醒 + note 增量缓存 + 安全加固 | ✅ 已实现（见 handoff.md §3/§4） |
| v2 之 embedding 后端 | ⬜ 规划中（当前为 token 加权召回/检索，无外部依赖） |
| 质量保障 | ✅ 零 token 回归检查（`scripts/test-memory.mjs`）+ 被动信号；**不做 token 型 benchmark**（决策见 v2-proposal §6） |
