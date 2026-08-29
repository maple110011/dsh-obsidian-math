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
| [`retrieval-v3.md`](retrieval-v3.md) | **检索 v3 提案**：三篇推理感知检索论文的可迁移机制、Tier A（零成本）/Tier B（可选本地 embedding）设计、成本对照 | 检索设计变更前必读；实现状态随进度更新 |
| [`strategy-layer.md`](strategy-layer.md) | **策略层提案**：方法层（strategy 卡）+ 工作记忆（working.md）+ iterative retrieval 的完整设计规格 | 拍板后实现；实现状态随进度更新 |
| [`self-correction.md`](self-correction.md) | **记忆纠错与确定性自维护提案**：纠错信号进检索（superseded 排除 / wrong 降 verified / prior 权重）+ 待重审 + 自动归档 + 合并去重 + strategy 统一生命周期 | 已实现（0.7.2）；实现状态随进度更新 |
| [`obelisk-comparison.md`](obelisk-comparison.md) | **Obelisk 对照与自动保存对话方案**：对照成熟 agent 记忆系统的差距分析 + 「保存对话」具体方案（整场对话/尾截断/seq 增量） | 引擎已实现（0.7.3）；UI 留下一小步 |
| [`references.md`](references.md) | **参考文献笔记**：每篇论文/系统的核心结论、可借鉴机制、与我们的映射关系 | 读完新论文/系统后追加 |
| [`changelog.md`](changelog.md) | **记忆系统专属变更日志**：比仓库根 CHANGELOG 更细的"为什么改、改了什么" | 每次记忆系统改动后追加 |
| [`control-panel.md`](control-panel.md) | **控制面交互规格**：验证徽标、反馈闭环、记忆面板、捕获策略分级与注入方案评估 | 控制面变更时同步 |
| [`testing.md`](testing.md) | **QA 方法论 + 本地验收手册**：引擎探针/E2E 用法、boot 冒烟、手动 Obsidian 验证、环境变量对照 | 测试流程/验收步骤变化时更新 |
| [`benchmark.md`](benchmark.md) | **基准测试设计规格**：两套分层（引擎探针 + 端到端）、8 维度、仿真 vault（seed vault）、baseline.json 记录格式 | 拍板后实现；基准结构变化时更新 |
| [`handoff.md`](handoff.md) | **交接文档**：现状、坑、决策记录、下一步候选 | 每轮大改收尾时更新 |

## 核心结论（TL;DR）

1. **现状**：五层持久记忆（profile / topics / records / episodes / inbox）+ 模板-定理关联图，方向正确、证据链完整；已从"规则注入型记忆"演进为"检索型记忆"——读走 note_recall 统一检索 + 导航式注入，写走三写协议 + 每日确定性体检兜底，管走记忆面板 + 反馈闭环（可见、可溯源、可纠正）。
2. **长期方向**（详见 [`v2-proposal.md`](v2-proposal.md)）：
   - 检索式注入：已实现为 note_recall 统一入口（BM25 粗筛 + 精读挑选）+ 导航式注入（S5）；
   - 确定性维护：ISM 七机制的本土化维护 pass（审计报告已实现，模型执行的合并/强化走协议）；
   - 记忆控制面：浏览/溯源/反馈已实现（Obsidian 记忆面板 + 反馈链接，阶段 1a/1b/1c）；dsh web ui 面板已实现（`settings.section` 槽位，装在主 dsh web 3080）。
3. **不可动摇的原则**（来自两轮评估）：原文证据优先；写时保留（superseded 而非删除）；检索先粗后细；证明可核查；所有记忆写入带来源与验证等级；fail-closed 安全边界。

## 工作约定（对协作者/agent）

- 改记忆系统代码前，先读 `design.md` 确认现状；设计变更先更新 `v2-proposal.md` 并记录到 `changelog.md`。
- 新读的论文必须把要点沉淀到 `references.md`（含 URL、核心机制、可借鉴点、不适用的部分），否则评估和方案失去依据。
- 检索层每次改动后跑回归检查（当前为 `npm test`；后续将补充 Exercise100 式记忆回归基准，见 `v2-proposal.md` §6）。
- 文档与代码同 PR 提交：**只改代码不改文档的改造视为未完成**。

## 当前状态（2026-08）

| 项目 | 状态 |
|---|---|
| 检索 v3：note_recall 统一入口（笔记+记忆一次 BM25 排序，kind-aware passage，coverage 弱信号） | ✅ 已实现并两层验收（引擎探针 12/12 + 真实会话 E2E 5 用例，见 testing.md） |
| 检索 v3：精读挑选协议（蒸馏查询/空结果重试/精读纪律）与导航式注入 | ✅ 已实现（AGENTS.md §4/§5；注入层=导航层） |
| v2 之确定性记忆体检 + hook 统计回写 + 结构校验（S6） | ✅ 已实现（`cache/memory-audit.json`；缺 source/断链/未入索引） |
| v2 之验证徽标 + 反馈链接 + 记忆面板（浏览/编辑/趋势） | ✅ 已实现（control-panel.md 阶段 1a/1b + 面板内编辑 + 📈 趋势） |
| 捕获策略分级（1c）+ 设置页 UI | ✅ 已实现（capture-policy.md + 设置页下拉框） |
| 记号体系（收集→统一→维护） | ✅ 已实现（memory/notation.md + AGENTS.md §2 + 每轮注入） |
| 回复质量协议（学习对话原则） | ✅ 已实现（AGENTS.md §8） |
| 检索 v3 之 embedding 后端（Tier B） | ⬜ 可选（用户暂缓；95MB 本地模型 + hybrid 打分） |
| 检索 v3 之独立 LLM 重排（A6） | ⬜ 可选（默认关闭；探针不满意时启用） |
| 策略层（方法层 + 工作记忆 + iterative retrieval） | ✅ 已实现（`strategy-layer.md`：note_strategy + working.md + strategy 模板 + AGENTS.md 路由） |
| 基准测试（引擎探针 + 端到端 + 仿真 vault） | ⬜ 提案（`benchmark.md`，待拍板） |
| 质量保障 | ✅ 118 项零 token 回归 + `scripts/qa/` 工具链（引擎探针零 token + E2E 真实 usage 计量）；**不做 token 型 benchmark**（决策见 v2-proposal §6） |
| 记忆纠错与确定性自维护（self-correction） | ✅ 已实现（0.7.2，`self-correction.md`）：P1 纠错进检索三件套 + P2 待重审 + P3 自动归档 + P4 合并去重 + P5 strategy 统一生命周期 |
| 自动保存对话（obelisk-comparison） | ✅ 引擎已实现（0.7.3，`obelisk-comparison.md`）：整场对话确定性写进 episodes（尾截断 + seq 增量 + vault 过滤 + `sessionCapture` 开关）；双面板 UI 开关/按钮留下一小步 |
