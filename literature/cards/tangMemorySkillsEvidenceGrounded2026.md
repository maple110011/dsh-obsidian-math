---
citekey: tangMemorySkillsEvidenceGrounded2026
title: "From Memory to Skills: Evidence-Grounded Co-Evolution Governance for Long-Horizon LLM Agents"
shorttitle: "MSCE"
authors: "Tang, Bo; Zhang, Yang; Zhuang, Guomian; Wei, Wenqiang; Zheng, Gaoyang; Xie, Lindong; Tan, Yanchao; Xiong, Feiyu; Yang, Qingyu; Chung, Edward; Li, Zhiyu"
year: 2026
status: distilled
doi: "10.48550/arXiv.2607.16621"
url: "http://arxiv.org/abs/2607.16621"
keywords: "Computer Science - Computation and Language"
tags: [memory-to-skill, evidence-anchoring, skill-crystallization, value-backfilling, applicability-boundary, decision-guidance, governance-gates]
full_text: .raw/tangMemorySkillsEvidenceGrounded2026/full.md
pdf: .raw/tangMemorySkillsEvidenceGrounded2026/source.pdf
---

# From Memory to Skills: Evidence-Grounded Co-Evolution Governance for Long-Horizon LLM Agents

> **一句话**：把长期记忆从**被动上下文**升格为**可调用技能**——L1 可审计步骤证据 → L2 跨 episode 归纳的程序策略 → L3 声明式环境认知的三层受治理记忆，只把「**有证据支撑 + 增益为正（G > 0）+ 近期稳定**」的 L2 策略结晶成带触发/过程/验证/边界/证据锚点/可靠性 η 的技能；并用**反思加权价值回填** `V_t = α_t·R + (1−α_t)·γ·V_{t+1}`（γ=0.9）把稀疏终点反馈沿稠密自反思摊到每一步。对我们的直接价值：**它给出了「技巧调用体系」的完整治理骨架，而我们的 `strategy/` 层正好缺其中的增益门、接地校验与边界收窄**。

## 摘要

Existing memory systems for long-horizon LLM agents often retrieve prior traces as passive context rather than converting them into executable capabilities. In this paper, we propose MSCE, a training-free Memory--Skill Co-Evolution framework that organizes agent experience into grounded step traces, reusable procedural policies, and declarative environmental cognition. MSCE crystallizes evidence-backed L2 policies with positive estimated gain into callable skills that retain evidence links, applicability boundaries, decision guidance, verification rules, and reliability estimates. It further introduces reflection-weighted value backfilling, which propagates sparse terminal feedback through dense local self-reflections to produce evidence-calibrated trace values for governing memory and skill evolution. Experiments on EvoAgentBench and LoCoMo demonstrate that MSCE significantly outperforms state-of-the-art skill-augmented and memory-driven agent baselines, exhibiting strong cross-domain transferability and lifelong-evolution capabilities.

## 核心机制 / 方法

- **要治的两个病**：① 记忆是死的（反复探索过的仓库还会再列一次目录；轨迹里已有「装依赖」的完整过程，系统仍让模型重新推一遍）；② **直接蒸馏技能是脆的**——原始轨迹含失败尝试与盲目探索，终点反馈稀疏延迟 ⇒ 步级信用分配不确定，且技能还需要触发/边界/验证/生命周期，不然会过拟合、会在不合适场合被调用。
- **三层 + 下游技能库**（`M = (M⁽¹⁾, M⁽²⁾, M⁽³⁾)`，`K` 在层级**下游**，「防止轨迹/策略/环境事实/可调用动作混成一个不受控的池子」）：
  - **L1** `f⁽¹⁾ = (s, a, o, ρ, V)`：证据层，`V` 初值 PENDING、事后回填；**有界持久化**（截断 + 去重 + 规则脱敏），高层只存**证据 id** 不复制原始观测。
  - **L2** `f⁽²⁾ = (φ, π, κ, B, {f⁽¹⁾})`：触发 / 过程 / 验证判据 / 适用边界 / 支撑证据。**内部抽象，不直接暴露给 agent**。
  - **L3** `f⁽³⁾ = (E, I, C, {f⁽²⁾})`：实体结构 / 动作–响应规律 / 约束。**禁祈使句**（不得出现 do/don't/should/use/prefer/avoid/try/install/run）。
  - **Skill** `k = (φ, π, κ, B, A, D, η)`：从 L2 继承前四项，新增**证据锚点 A / 决策指导 D / 可靠性 η**，有标准调用接口与生命周期。**结晶不是格式化，是晋级。**
- **★ 隔离纪律**：L2 与 L3 互相**禁写**，prompt 里各带「不要写这些」清单，并要求「**同一个事实两种表述**」（「Alpine 不预装系统开发库」→ L2 写成动作条件，L3 写成声明事实）。作者原话：**两侧互相污染会同时稀释两边**。
- **写路径（算法 2，按 episode id 幂等）**：episode 定界（三分类 `Correction` 延长上一 episode / `Follow-up` 同任务开新 / `New task` 开新上下文；**拒绝把每次工具调用当独立任务**）→ L1 落盘（截断 + 抽取 ρ + 打分 α）→ 终点反馈到达后**回填 V** → 对 `V ≥ v_min = 0.1` 的轨迹做 **L2 关联（语义 + 结构化触发重叠；tag 不兼容或错误签名冲突时即使相似度很高也拒绝）**或入候选池（按**确定性模式签名**分桶）→ 同桶积累 **≥ n_min = 2 个不同 episode** 才归纳 → L3 抽象 → 技能结晶。
- **★ 价值回填（Eq. 2）**：`V(f_{i,t}) = α_{i,t}·R_i + (1−α_{i,t})·γ·V(f_{i,t+1})`，`γ = 0.9`，终点步 `V = R_i`。**高 α 步**＝对最终结果有本地信息量；**低 α 步**主要继承后续价值。目的：把记忆构建**偏向「既被全局奖励、又本地可解释」的步**。反思打分看四轴（faithfulness / causal insight / transferability / concreteness），**空或同义反复 ⇒ α = 0**。
- **★ 增益 G（Eq. 1 + B.4）是全会话治理信号**（决定策略「留活跃 / 够格结晶 / 该退休」）：`G = V̄_with − V̄_blend(S_without)`。with 侧在 `|S_with| ≥ 3` 时用 **softmax 加权均值**（`τ_V = 0.5`），否则算术均值；**without 侧向保守基线 `b = 0.5` 收缩**（伪计数 `N_0 = 5`）⇒ 没有失败样本时不产生虚假增益。作者**明说这是启发式效用信号、不是因果效应估计**。
- **★ 技能结晶的门与验**：两道门（`G > θ_G = 0`；**稳定性**＝近期证据吻合当前 φ/π/B 而非迫使大改写）+ 三道**确定性**插入校验（schema 齐全 / **证据接地**：引用证据 id ∈ 支持集且声明工具 ∈ 证据轨迹工具白名单 / 两个覆盖测试：不发明无支撑命令、不偏离保留证据）。**任一不过 ⇒ 丢弃草案，不作为可调用技能暴露。** 支持集同时用正证据（归纳公共过程）与**反证据（约束边界并产出反模式）**。
- **生命周期**（Table 4）：`probationary → active → archived`；`η = (n_pass + 1)/(n_trial + 2)`（平滑成功率）；`η > 0.6` 进活跃检索、`η < 0.2` 归档；事件映射：成功 → `reinforce`；失败 → `repair`；**用户否决 → `shrink`（收窄边界 B）**；新反证据 → `revise`；**源策略被重写 → `rebuild`（从证据重新结晶，不就地打补丁）**；长期不用/低可靠 → `archive`。
- **决策指导 D**：当两个动作模式出现在相似上下文但价值显著不同、且低价值模式有失败或用户纠正支撑时，生成 `d = (c, a⁺, a⁻, e, ξ)`（上下文/该做/该避免/证据/可靠性）。**只在上下文匹配当前技能或策略触发时注入**；修复包**暂存到下一轮**，不打断当前动作。
- **★ 读路径是三层级联 + 降级**：① 活跃技能优先（按 `触发相关度 + η + G` 排序，`k = 3`）；② 命中的 L3 认知只提供**环境先验**（实例化参数、解释边界），**不覆盖技能过程**；③ **无技能命中或技能失败 ⇒ 回退 L1**（精确线索如错误签名 + 状态摘要语义相似度；**低价值轨迹仍保留**作反证据与决策修复源）；④ 结构性不确定时取 L3。**技能不能单独生效——其调用以记忆层级为条件。**
- **消融（Table 3，Pass@1 相对 Full MSCE）**：**Flat Memory 在 IR/Math/SE 掉 15.38 / 16.00 / 19.23 分**（Code 成本 2.0 → 5.3 turns）；w/o Skill Crystallization 掉 6.15~11.54 且**每域成本都升**；**w/o Value Calibration（直接注入检索到的技能、不做适用性过滤）在每个领域都掉分且成本升** ⇒ 「**盲目注入技能是有害的**」。
- **主结果**：EvoAgentBench 最强非 MSCE 基线 → MSCE：IR 21.54→**26.15**、Math 43.00→**47.00**、SE 38.46→**53.85**、Code 61.54→**61.54**（并列，成本 3.9→2.0 turns）、KW 48.28→**53.45**。LoCoMo 综合 61.23（次好 59.22）/ F1 49.89。**成本多数下降**（Math/Code 降幅尤其大；仅 SE 37.3→40.8 turns 反升）。
- **跨域迁移 6/6 全升**（+2.56~+5.13，平均 **+3.93**）；**长期演进「learning by using」**：p0→p100 的 Pass@1 在 Math/SE/IR 单调升 +17.00/+15.39/+13.84，归一化成本 p25 先升后持续下降，**p100 时 Math 与 SE 低于 p0**。
- **模拟人类反馈**（Table 7）：KW +13.79、SE +7.69、Code +2.56、IR +1.54、**Math +0.00**（作者解读：数学瓶颈在**符号正确性**而非程序性改进）。
- ⚠️ **五个 LLM 算子**（反思打分、奖励量化、L2 归纳、L3 抽象、技能起草）——它们**违背我们「插件不调模型」的红线**，全部不适用；但**判定环节是确定性的**（schema/接地/覆盖/阈值），这部分我们可以照搬。

## 与我的工作 / 记忆的映射

- **★ 这是我们 1.0 缺口（「技巧调用体系」）最完整的现成骨架**：我们的 `strategy/<slug>.md` 已经有 `difficulty`（触发）/`strategies[].move`+`retrieve`（过程）/`not_applicable_when`（边界）/`provenance`/`status: candidate→active`，promote 门是 `uses ≥ 3 且 success_rate ≥ 0.6`——**这几乎就是 MSCE 的可靠性门（阈值 0.6 巧合地一致）**。缺三样：**增益门 G**、**稳定性门**、**证据接地校验**。第三样纯确定性、最该先做。
- **★ 「增益」是我们 hook 块唯一缺的治理信号**：我们有 `uses / success_rate / last_used / harmed / verified`，**没有「用了它比不用它好多少」**。MSCE 的 without 侧**向保守基线收缩**（`N_0 = 5, b = 0.5`）正是「小样本不要妄下结论」的确定性写法，形状可直接照抄（用我们的确定性代理量替换 V）。**这是把 `harmed`（单侧计数）升级为带符号净收益的关键。**
- **★ 适用性过滤是防害机制、不是可选优化**：MSCE 的「w/o Value Calibration 每域都掉分且成本升」给了 `not_applicable_when` 硬门控一个**外部实证理由**。这条应写进 design 与协议，并补**变异可验证**的断言（AGENTS.md §6 要求）——我们目前没有一条断言专门盯这个门控。
- **★ 「边界」应当被反馈收窄**（MSCE 的 `shrink`）：我们 ❌ 目前只改 `success_rate` + 降 `verified`；把**被否决时的上下文特征追加进 `not_applicable_when`** 是可加的确定性动作，且直接服务「这张卡什么时候不该用」。
- **★ 稀疏终点反馈回填可以做成确定性的**：MSCE 最独特的一件是 Eq. 2，而我们恰好有一个天然的 α 载体（episode 原文 + records + 体检报告），终点反馈只有 ❌/✅ 两个离散动作、极稀疏。设计**确定性 α 代理**（例如「用户是否继续追问同一问题」「本轮结论是否在后续被 supersede」「本轮是否触发 ❌」）沿 `episode → record/strategy` 回填 `gain`，**不触碰红线**。**这是「技巧调用体系」缺的闭环。**
- **「跨 episode 独立支撑」= 区分「一次巧合」与「真技巧」**：MSCE 拒绝让一条长轨迹自撑出一个策略（`n_min` 个**不同** episode）。我们体检只报「疑似重复」，**没有「同一模式被几个独立 episode 支撑」这个计数**——数据已在 `episodes/` 里，判据是确定性的。
- **L2/L3 禁写隔离可低成本搬到我们的卡上**：我们的 `records` 类型含 fact/event/instruction/preference/artifact，**过程与事实混在一张卡里**。照 MSCE 的「同一事实两种表述」补一段模板文本，规定**策略卡只写过程骨架与检索目标，具体定理/记号/结论由 `theorems`/`notation`/`topics` 实例化**（这正好对应 MSCE 的「技能不覆盖层级、层级实例化技能」）。
- **我们的溯源纪律其实比它严**：MSCE 只要求「高层记忆带证据 id 链接」，我们要求 `records.source` **必指 episode**、并有 `verified_by` 凭据门与「越权升级」检测（verified 高于 single-source 却无凭据 ⇒ 列为越权）。**本文反过来印证了这套纪律的方向是对的**，可以引用。我们的差距是**策略卡没有证据锚点 A**（`provenance` 不是结构化 id 列表）。
- **评估方法上的两处空白**：① MSCE 的 **Cost 与 Pass@1 必须合看**（它自己声明「低成本可能来自提前终止或工具使用不足」）——我们 `engine-probe.mjs` 只报命中，没有代价视角；② **「在线累积 → 后评估」协议**（记忆只从演化 episode 累积、再在后续评估复用）——我们**从没测过「记忆长期积累是否让后续会话更好」**。
- **不适用**：五个 LLM 算子（反思打分/奖励量化/L2 归纳/L3 抽象/技能起草）——违背「插件不调模型」；嵌入/图检索；多模态与视频分支；`OpenClaw` 运行时与工具白名单假设。**引用它的确定性判定骨架，丢掉它的模型依赖。**
- **反向提醒**：本文强在**写路径 + 技能治理**，弱在**读路径的检索质量**（它用嵌入 + 语义相似度，我们是 BM25 词法；它在「精确线索」上反而是启发式拼的）。我们不要因为它把三层级联说得好就盲目重写 `note_recall`——那属于检索 v4 的地盘，先只补协议文本。

## 研读状态

- 状态：distilled
- 研读日志：reading/tangMemorySkillsEvidenceGrounded2026.md（含 14 节完整记录 + 9 条行动项 A1–A9）
- 源质量：MinerU `full.md` **干净**（`<sub>` 仅 2 处，均为下标数字；词中切分模式 0 处），无需 `pdftotext` 回退

## 原文

- [MinerU 全文](.raw/tangMemorySkillsEvidenceGrounded2026/full.md)
- [PDF](.raw/tangMemorySkillsEvidenceGrounded2026/source.pdf)
