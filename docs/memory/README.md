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
| [`retrieval-v3.md`](retrieval-v3.md) | **检索 v3 提案**：三篇推理感知检索论文的可迁移机制、Tier A（零成本）/Tier B（可选本地 embedding）设计、成本对照；**§7 = GraphMemix（Li et al. 2026）吸纳决策与 A/B 测量记录**（多视图 max-pool 实测不采纳、多样性重排否决、可达性分层与有符号净恢复 Δ 的读法） | 检索设计变更前必读；实现状态随进度更新 |
| [`strategy-layer.md`](strategy-layer.md) | **策略层提案**：方法层（strategy 卡）+ 工作记忆（working.md）+ iterative retrieval 的完整设计规格 | 拍板后实现；实现状态随进度更新 |
| [`self-correction.md`](self-correction.md) | **记忆纠错与确定性自维护提案**：纠错信号进检索（superseded 排除 / wrong 降 verified / prior 权重）+ 待重审 + 自动归档 + 合并去重 + strategy 统一生命周期 | 已实现（0.7.2）；实现状态随进度更新 |
| [`obelisk-comparison.md`](obelisk-comparison.md) | **Obelisk 对照与自动保存对话方案**：对照成熟 agent 记忆系统的差距分析 + 「保存对话」具体方案（整场对话/尾截断/seq 增量） | 引擎已实现（0.7.3）；UI 留下一小步 |
| [`references.md`](references.md) | **参考文献笔记**：每篇论文/系统的核心结论、可借鉴机制、与我们的映射关系 | 读完新论文/系统后追加 |
| [`changelog.md`](../changelog.md) | **仓库级变更账本**（2026-09-11 从本目录提升为 `docs/changelog.md`）：每次改动"为什么改、改了什么"的细账，比仓库根 `CHANGELOG.md`（发布摘要）更细 | 每次有行为/契约改动后追加 |
| [`control-panel.md`](control-panel.md) | **控制面交互规格**：验证徽标、反馈闭环、记忆面板、捕获策略分级、侧栏性能模式和注入方案评估 | 控制面变更时同步 |
| [`sidebar-performance.md`](sidebar-performance.md) | **侧栏卡顿排查**：11 条候选原因的逐条证据与处置（**主因 = 皮肤客户端脚本 `hooks.mjs` 持续改 DOM**；跨帧 `backdrop-filter` 曾被当成主因，**实测已否掉**——见该文 §0.1；另有 iframe 隔离/挂起、渲染线程同步 IO、搜索防抖、上游 grid 轨道重算），含已排除项、未量到的项与 A/B 复核办法 | 面板性能相关改动或新证据时更新 |
| [`testing.md`](testing.md) | **QA 方法论 + 本地验收手册**：引擎探针/E2E 用法、boot 冒烟、手动 Obsidian 验证、环境变量对照 | 测试流程/验收步骤变化时更新 |
| [`benchmark.md`](benchmark.md) | **基准测试设计规格**：两套分层（引擎探针 + 端到端）、8 维度、仿真 vault（seed vault）、baseline.json 记录格式 | 引擎探针**已实现并实测**（零 token）；端到端套件需真实 token，结构变化时更新 |
| [`handoff.md`](../handoff.md) | **交接文档**：现状、坑、决策记录、下一步候选 | 每轮大改收尾时更新 |
| [`../dsh-0.1.5-adaptation.md`](../dsh-0.1.5-adaptation.md) | **宿主版本适配**：dsh 0.1.5-rc.1 / 会话格式 V3 / `dsh-web-all@0.3.20` 的影响取证、修复清单与「刻意不改」的理由 | 宿主或 web 插件大版本升级时更新 |

## 核心结论（TL;DR）

1. **现状**：五层持久记忆（profile / topics / records / episodes / inbox）+ 模板-定理关联图，方向正确、证据链完整；已从"规则注入型记忆"演进为"检索型记忆"——读走 note_recall 统一检索 + 导航式注入，写走三写协议 + 每日确定性体检兜底，管走记忆面板 + 反馈闭环（可见、可纠正；**可溯源仍未交付**）。
2. **这个项目解决到哪一步（项目定位，2026-09-10 明确）**：
   - **已解决**：**「agent 记不住用户问过什么」**——跨会话的原文证据 + 类型化原子记录 + 分层索引 + 统一检索 + 反馈纠错，这条线是通的。
   - **远未解决**：**「辅助用户打磨一套数学理解，并建立对理解、技巧等的调用体系」**——现在记的是"问过什么/结论是什么"，不是"理解到哪、卡在哪、下一步练什么"；技巧层只有存储与检索，**没有调用体系**（何时用哪条、适用边界怎么判、失败后换哪条、几条如何组合）；也没有主动教学闭环（诊断→提示→检验→复盘的长期档案）与复习调度。
   - **1.0 的定义**：真正实现后一条才是 1.0。当前 0.7.x 是记忆基础设施 + 控制面可用的试做型。
3. **长期方向**（详见 [`v2-proposal.md`](v2-proposal.md)）：
   - 检索式注入：已实现为 note_recall 统一入口（BM25 粗筛 + 精读挑选）+ 导航式注入（S5）；
   - 确定性维护：ISM 七机制的本土化维护 pass（审计报告已实现，模型执行的合并/强化走协议）；
   - 记忆控制面：浏览/反馈已实现（Obsidian 记忆面板 + 反馈链接，阶段 1a/1b/1c/1d）；dsh web 面板已实现（`settings.section` 槽位，装在主 dsh web 3080）；**溯源（source 链）未实现**。
4. **不可动摇的原则**（来自两轮评估）：原文证据优先；写时保留（superseded 而非删除）；检索先粗后细；证明可核查；所有记忆写入带来源与验证等级；fail-closed 安全边界。

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
| v2 之验证徽标 + 反馈链接 + 记忆面板（浏览/编辑/待处理） | ✅ 已实现（control-panel.md 阶段 1a/1b/1d + 面板内编辑 + ⚠️ 待处理区块；`📈 0→0` 这类无信息量的趋势行已移除） |
| 捕获策略分级（1c）+ 设置页 UI | ✅ 已实现（capture-policy.md + 设置页下拉框） |
| 记号体系（收集→统一→维护） | ✅ 已实现（memory/notation.md + AGENTS.md §2 + 每轮注入） |
| 回复质量协议（学习对话原则） | ✅ 已实现（AGENTS.md §8） |
| 检索 v3 之 embedding 后端（Tier B） | ⬜ 可选（用户暂缓；95MB 本地模型 + hybrid 打分） |
| 检索 v3 之独立 LLM 重排（A6） | ⬜ 可选（默认关闭；探针不满意时启用） |
| 策略层（方法层 + 工作记忆 + iterative retrieval） | ✅ 已实现（`strategy-layer.md`：note_strategy + working.md + strategy 模板 + AGENTS.md 路由） |
| 基准测试（引擎探针 + 端到端 + 仿真 vault） | ⬜ 提案（`benchmark.md`，待拍板） |
| 质量保障 | ✅ 297 项零 token 回归 + 47 项路由回归 + 32 项反代回归（含侧栏性能注入）+ `scripts/qa/` 工具链（引擎探针零 token + E2E 真实 usage 计量）；**不做 token 型 benchmark**（决策见 v2-proposal §6） |
| 记忆纠错与确定性自维护（self-correction） | ✅ 已实现（0.7.2，`self-correction.md`）：P1 纠错进检索三件套 + P2 待重审 + P3 自动归档 + P4 合并去重 + P5 strategy 统一生命周期 |
| 自动保存对话（obelisk-comparison） | ✅ 引擎已实现（0.7.3，`obelisk-comparison.md`）：整场对话确定性写进 episodes（尾截断 + seq 增量 + vault 过滤 + `sessionCapture` 开关）；双面板 UI 开关/按钮留下一小步 |
| 宿主适配：dsh 0.1.5 会话格式 V3 | ✅ 已适配（[`../dsh-0.1.5-adaptation.md`](../dsh-0.1.5-adaptation.md)）：解码/蒸馏无需改动；**按会话去重日志**（V3 迁移保留 V2 原件，同一会话会有两份日志）；profile patch / preset / `settings.section` 槽位在 0.1.5 下实测有效 |
