---
citekey: tangWikiSkillCompilingAgent2026
title: "WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution"
shorttitle: "WikiSkill"
authors: "Tang, Liyan; Rashtchian, Cyrus; Ferng, Chun-Sung; Tomkins, Andrew; Juan, Da-Cheng; Vu, Tu"
year: 2026
status: distilled
doi: "10.48550/arXiv.2608.27454"
url: "http://arxiv.org/abs/2608.27454"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Computation and Language"
tags: [experience-compilation, persistent-knowledge-base, skill-evolution, audit-trail, rejected-proposal-memory, three-layer-workspace, cross-model-transfer, negative-transfer]
full_text: .raw/tangWikiSkillCompilingAgent2026/full.md
pdf: .raw/tangWikiSkillCompilingAgent2026/source.pdf
---

# WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution

> **一句话**：在**不可变原始轨迹**与**可执行技能**之间插一层**持久、复利、永不回滚的知识库（wiki）**——wiki 用「一个失败模式/成功策略一页（10–30 行、含根因与确切命令、必须写明问题+根因+解法）」累积模式，用两本台账（`log.md` 演进日志、`skill-impact.md` 审计日志：提案 diff + 验证分 + Accept/Reject）记住「什么试过了、结果如何」，技能只由 wiki 驱动地做**原子补丁**。消融把它最关键的一件称出来了：**拿掉持久知识累积，掉 15.0 分（48.7 → 63.7）；而给推理 agent 开 wiki 访问反而掉 2.8 分（63.7 → 60.9）**。对我们的直接价值：**它给出了「知识层 / 产物层分离」与「失败与否决也要留痕」这两条我们至今没有的治理机制，且这两条都由代码而非模型执行。**
>
> ⚠️ **来源分级**：论文本身是一手来源；`https://github.com/martjay/Wiki-Skill` 是**第三方复现**（作者为 GitHub 用户 `martjay`/MusicHunter，非论文作者；2026-08-31 单日 7 次提交建库，README 自称"基于论文深度复现与全平台工程升级"）。该仓库**重跑出的实验数字与论文 Table 1 不一致**（例如 Qwen-3.5-4B 平均 38.5% 与论文一致，但各分项与 Gemma/Gemini 行不同），因此**它的数字不作证据引用**；本文引用它时只引**实现与工程记录**（文件契约、补丁引擎、原子写、坑）。

## 摘要

Agent skills package specialized knowledge and workflows into reusable resources that extend AI agent capabilities. Recent work automatically discovers such skills from agent experience, which enables agents to progressively adapt through interaction. However, the insights that guide skill development typically remain scattered across optimization histories, limiting their systematic reuse across iterations. We introduce WikiSkill, a framework that co-evolves agent skills with a persistent knowledge base (wiki). At a high level, WikiSkill separates raw execution experience, accumulated knowledge, and executable skills, while continuously consolidating experience into the wiki, which subsequent skill updates can build on. Across diverse benchmarks and models, WikiSkill consistently outperforms state-of-the-art skill-evolution methods and improves over no-skill baselines in most model-benchmark settings. We find that skill evolution complements model scaling: larger models generally benefit more from evolved skills, while smaller models with skills can outperform substantially larger models without them. We also find that evolved skills transfer effectively across models and model families, and skills evolved by other models can outperform self-evolved skills. Finally, our ablation studies confirm that persistent knowledge accumulation in the wiki is critical for effective skill evolution. These results demonstrate the benefits of systematically accumulating and refining agent experience for developing reusable and transferable skills.

## 核心机制 / 方法

- **要治的病**：技能自演化已有成熟闭环（rollout → 分析轨迹 → 改技能 → 验证门控），但**学到的东西没有独立的表示**——EvoSkill 只留「提案 + 结果」的扁平历史，Trace2Skill 把教训直接压进技能补丁，SkillOpt 用被拒编辑的反馈与逐轮元指导。共同缺陷：经验**散落在优化历史里**，下一轮没法在「越来越有支撑的知识」上继续，只能在上一轮的产物上打补丁。
- **★ 三层工作区（物理目录分离，不是逻辑分层）**：
  - `raw/traces/` —— **不可变**执行轨迹（推理、工具调用参数、工具输出原文、最终答案）。
  - `wiki/` —— **持久、复利、永不回滚**：`patterns/`（一页一个失败模式或成功策略）+ `index.md`（模式总目录）+ `log.md`（逐轮演进日志）+ `skill-impact.md`（**框架程序化追加**的审计台账）。
  - `skills/<name>/` —— 可执行产物，每个技能两个文件：`SKILL.md`（frontmatter `name`/`description` + `When to Apply` / `When NOT to Apply` / `Instructions`）与 `PURPOSE.md`（`Origin` / `Patterns Addressed` / `Evolution History`，把技能映射回催生它的 wiki 模式）。
- **★ 模式页与索引的写法（最可迁移的两条格式契约）**：
  - 每页必须含：是什么 / **根因分析（WHY，不只是 WHAT）** / 轨迹里的**确切命令序列** / 具体可操作解法；**10–30 行，不要写小作文**；成功模式与失败模式都要收；**不要建重复模式，用新证据更新已有的**。
  - `index.md` 每行固定格式：`- [pattern-name](wiki/patterns/pattern-name.md): PROBLEM + ROOT CAUSE + FIX in one or two sentences.` 作者说这是全库**最重要**的一处，因为它决定读者（下一轮的提案者）要不要打开整页——**描述必须细到能脱离正文判断相关性**。
- **★ 两条台账（治理闭环的记忆本体）**：`log.md` 记「这一轮发现了什么、做了什么」；`skill-impact.md` 记「**每一条技能改动**的提案元数据 + 目标技能 + **unified diff** + 验证集得分 + Accepted/Rejected」。作用有三个（作者原文）：① 看到完整的接受史，**被拒过的干预不再重复提**；② 知道前几轮提过什么、成没成；③ 认出**跨轮反复出现的错误**。技能可以回滚，**wiki 任何情况下都不回滚**。
- **演化闭环（Algorithm 1）**：迭代 k：① 推理 agent 用当前技能集 `S_{k-1}` 在训练集 rollout（**训练期禁止读 wiki**）；② 分层抽样轨迹（**≤8 条：≤5 失败 + ≤3 成功，单条截断 15,000 字符**）；③ Wiki Maintainer 做根因分析并**增量补丁**维护 `patterns/`、重写 `index.md`、追加 `log.md`；④ Skill Proposer 以**多轮 ReAct** 读 `index.md` + `skill-impact.md` + 按需 `read_file` 具体模式页与轨迹（**规则要求至少读 4 条失败轨迹**），产出**原子提案**（新建一个技能，或对某一个技能打补丁）；⑤ 应用后跑验证集，`R(T_val) > R_best` 才接受，否则**只回滚技能层**；⑥ 无论接受与否，程序化追加一条 `skill-impact.md`（含 diff、得分、结论）；验证分达 1.0 早停。
- **★ 持久知识的消融（Table 3，Gemini-3.5-Flash）**：`No skill 40.4` / 提案者可读 wiki **48.7** / 提案者与推理 agent 都可读 wiki **60.9** / 只有提案者可读 wiki（默认配置）**63.7**。两条结论：**持久知识把技能质量从 48.7 抬到 63.7（+15.0）**；**训练期让推理 agent 读 wiki 反而降到 60.9（LiveMath 72.6 → 64.8）**——作者解释是「知识捷径」：推理 agent 直接从 wiki 抄零散解法，掩盖了技能本身的结构缺陷，产出的轨迹对技能开发不再有信息量。
- **主结果（Table 1–2）**：五个基准（LiveMath / SealQA / SpreadSheet / OfficeQA / ALFWorld）× 五个模型（Qwen-3.5-4B/9B、Qwen-3.6-27B、Gemma-4-31B、Gemini-3.5-Flash）。平均分相对各模型最强基线 +3.3 / +5.1 / +10.0 / +5.8 / +12.0；**技能演化与模型规模互补**（Qwen 家族增益随规模递增 +12.3 → +17.5 → +23.9；带技能的 9B 平均 47.4 > 不带技能的 27B 39.4）；**技能可跨模型/跨家族迁移，且他模型演化的技能有时胜过自演化**（ALFWorld：9B 用 27B 技能 70.2 vs 自演化 63.4）；**负迁移真实存在**（4B 技能把 Gemini-3.5-Flash 在 SpreadSheet 上从 50.5 打到 18.1，原因是小模型把「单行 Python、逐步转字符串」这类底层 workaround 写进技能，且碎片化前置检查耗尽交互预算）。
- **规模与形态统计（Table 4–5）**：技能长度 45.1–142.5 行（Gemma 最短、SpreadSheet 最长），wiki 模式 4.4–9.8 个（平均 18.1–48.2 行）；被接受的技能更新**只有 39%–58% 发生在最初两轮**，其余发生在中后期 ⇒ 持久知识支持**持续精修**而非一次性生成。成本上，优化器每轮 LLM 调用 `C = (1 + T_ReAct)·N_train/B`，full-batch 时与训练集大小**无关**（`T_ReAct ≈ 10–20`）。
- **作者自陈的四个限制（与我们直接相关）**：① **不评估技能检索/触发**——为了让技能质量不被检索失败混淆，他们把全部技能**整段注入**系统提示；因此「技能多了怎么办」是明确的未来工作；② 门控要求**每次都必须严格提升**验证分，排除了「当下中性、后续才见效」的提案；③ **wiki 没有任何自动裁剪机制**，长期跑下去模式页会无限增长；④ 不覆盖数百步/数小时级的超长程任务。

## 与我的工作 / 记忆的映射

- **★ 它与我库里的 MSCE（`tangMemorySkillsEvidenceGrounded2026`）是同一问题域的两条不同路线，且分工互补，不要混读**：MSCE 管**晋升的判定**（增益门 G、稳定性门、证据接地、可靠性 η、生命周期）；WikiSkill 管**知识本体与留痕**（模式页、索引、两本台账、失败与否决的持久记录）。**MSCE 缺「学过的东西存在哪」，WikiSkill 缺「凭什么晋升」**。我已经采纳过 MSCE 的骨架（`gain`、接地门、`depends_on`、跨场合计数），**本次新增的增量在 WikiSkill 这一侧**。
- **★ 我们已经有「持久知识层」，但没有把它当一等公民来写**：`records/`（可复用事实/技巧）+ `topics/` + `notation.md` + `theorems/index.md` 事实上就是 WikiSkill 的 wiki 层，`strategy/` 是它的 skills 层，`episodes/` 是它的 raw 层——**三层我们都有**。差距不在结构而在**纪律**：WikiSkill 明确要求「技能只做增量补丁、知识层不因技能被拒而回滚」，而我们的实践是**策略卡被改写时旧内容直接消失**，且失败尝试只以「一句 `not_applicable_when`」的形式留下。
- **★ 「被拒绝的提案要留全文」是我们最该补的一件，而且它有一个我们每天都会踩的具体形态**：WikiSkill 的 `skill-impact.md` 把**提案 diff + 验证分 + 接受/拒绝**程序化落盘，目的是「不要重复提已经被否过的改动」。我们的对应物是：**体检（audit）反复把同一张卡报成 weak / 疑似重复 / 待重审，而「上一轮为什么决定不改它」没有任何地方记录**——下一天、下一轮对话、下一个 agent 会从零重新判断一遍。可用**纯确定性**方式补：体检每次给出处置建议时，把「本次判定 + 依据 + 若为「不处置」则说明理由」追加进一个 append-only 台账（形状照 `skill-limpact.md`：时间 + 对象 + 动作 + 证据 + 结论），并让体检在生成建议前先读它——**这就是 `improvement-intake` 里「增量回执」被延后时缺的那份「上次是什么状态」**（details 第 5 项：`+`/`~` 需要身份级对比，而身份级对比正需要一个可比的上一份记录）。
- **★ 「模式页索引描述必须自带问题+根因+解法」直接对应我们的 `note_recall` 空结果问题**：我们体检已经在报「疑似重复」「枢纽」，但**索引行的写法没有纪律**（`strategy/index.md`、`theorems/index.md` 的行是人随手写的）。WikiSkill 的理由很硬：索引行决定读者要不要打开整页。可把「一行内写清：适用困难 + 为什么有效 + 具体动作」写进 `strategy-readme.md` / `records-readme.md` 的模板纪律，并让体检做**确定性 lint**（缺任一段 ⇒ 列出「索引行不合格」）。
- **★ 「训练期不许读知识层」消融对我们的启示是反向的，但同样有用**：我们**故意**把 `topics/notation/theorems/strategy` 全部注入（这是我们的产品形态：单用户数学学习，不存在「训练/推理」两阶段）。WikiSkill 的 -2.8 分警告在**它自己的度量下**成立（它度量的是「技能本身够不够好」）；**我们的度量是「这一轮回答对不对」**，所以注入是对的。**要记下的不是结论而是它给出的判据**：任何「让模型直接在会话里读原始素材」的动作都会降低「蒸馏产物的质量」——当我们讨论「要不要把 `episodes` 原文也注入」时，这条是反对票。
- **★ 知识的注入预算纪律可以直接照抄数字形状**：单条证据 ≤ 15,000 字符、一轮抽样 ≤ 8 条（失败 5 / 成功 3）、ReAct 每次读文件观测 ≤ 4,000 字符、**截断处显式标注 `[TRUNCATED]`**。我们的注入预算是硬编码档位（精简/标准/富上下文），但**没有「截断标注」**——模型看到被截断的证据时不知道自己看到的是残片，这是个可低成本修复的诚实性问题。
- **★ 「模式页 10–30 行、不要写成小作文」是一条对模型侧的硬纪律，我们缺**：我们的模板反复强调「原子化、不要整段对话总结」，但**没有给出行数/字数的量化上限**。量化上限是确定性可检查的，而「不要写太啰嗦」不可检查。
- **★ 它的读路径明显弱于我们，不要被「三层」迷惑**：WikiSkill 为了排除检索这个混淆变量，**把技能整段塞进系统提示**，并自陈「不评估技能检索与触发」；推理阶段也没有任何检索，全库模式靠提案者用 ReAct 一页页翻。我们的 `note_recall`（统一 BM25 + hook 字段加权 + coverage 弱信号 + 边界硬门控）与 `note_strategy`（difficulty 主匹配 + 状态即权限）**在这个维度上领先于它**。所以**不要**因为它把「三层级联」讲得漂亮就去重写检索——这条与 MSCE 研读时的结论一致。
- **仓库（第三方复现）提供的工程增量，与论文无关但对我们有用**：
  - **`RobustPatchEngine` 的三级容错补丁**（精确子串 → 行尾空白归一化后按行窗口匹配 → `strip()` 单行回退，三级都失败就**抛错不静默**）。理由对我们是现成的：**人类会在 Obsidian 里手改卡片**，所以任何「按精确子串定位再替换」的写入都会遇到空白/换行差异。⚠️ 但它的 `create_patterns` 名字未做路径净化（可含 `../`）、`update_patterns` 目标文件不存在时**静默跳过**——这两点**不要照抄**（我们已有 `pathIsInside` 这类锚定纪律）。
  - **checkpoint + staging + 原子 rename**：先写 `skills_staging/`，判定通过才 `os.rename` 替换，异常回滚 `skills_checkpoint/`。我们的写入目前是「读整文件 → 改 → 写回」（best-effort，`try/catch` 后只报告，见 `math-memory.mjs` 的统计回写）。**可以借这个形状**，但要补它没有的：`fsync`、`.bak`、以及 `_init_workspace()` 每次构造都用当前磁盘状态覆盖 checkpoint 这个**真实缺陷**（崩溃后的中间态会被追认成 good）。
  - **它自陈的坑**（`best-practices-and-pitfalls.md`）：负迁移的两个诱因（底层 workaround 硬化 / 碎片化前置检查耗尽交互预算）⇒ 技能应写**高层程序性策略**、防御性检查要**条件触发**；技能落盘必须**原子**（`os.remove` + 重写会丢掉整个技能目录）。这两条对应到我们：策略卡不该写死语法级步骤（我们已有 `abstraction` 三段，方向一致）；模板的「建议先做 X、再 Y」如果变成**无条件前置清单**，会挤占本轮的检索步数预算（我们 AGENTS.md 有「一轮最多 1 次 `note_strategy` + 最多 4 步内容检索」，正好是它的交互预算的同构物——**建议把「预算」写进模板纪律，而非只在 AGENTS.md 里**）。
- **不适用**：Wiki Maintainer 与 Skill Proposer 两个 LLM 算子、五项基准与它们的工具环境、`T_ReAct` 多轮 ReAct 提案、跨模型迁移实验、embedding/图检索（它也没用）。**我们只取「文件契约 + 确定性台账 + 门控形状」，丢掉「谁来做判断」。**
- **反向提醒**：这篇论文的**方法部分很薄**（§3 只有三层 + 四组件 + 一个阈值门控），**价值集中在消融与格式纪律上**。它没有超参数表、没有成本数字表、没有失败分析章节——**不要指望从它那里拿到可调阈值**；能拿的是「哪些字段必须存在」「哪些记录必须永不回滚」。

## 研读状态

- 状态：distilled
- 状态更新：2026-09-17
- 研读日志：reading/tangWikiSkillCompilingAgent2026.md（含 14 节完整记录 + 9 条行动项 W1–W9）
- 改进评估：notes/wikiskill-intake-2026-09-17.md（能否改进、采纳清单、不采纳项、与 MSCE 的分工）
- 源质量：MinerU `full.md` **干净**（`<sub>` **0 处**；`<sup>` 为上标作者/引文，另有 14 个 `<table>` 块与 1 个 `mineru-algorithm` 块被保留为原始 HTML，表格内容可读）。**未回退 `pdftotext`**。
- 补充来源：第三方复现仓库 `martjay/Wiki-Skill`（HEAD `ddf8fdb`，2026-08-31）——**已读** `README.md`、`SKILL.md`、`references/architecture-and-loop.md`、`references/best-practices-and-pitfalls.md`、`scripts/wikiskill_framework.py`、`scripts/wikiskill_orchestrator.py`（含其测试与坑）；**未读** `references/prompts-and-tools.md` 全文（经子代理摘录其模式页/索引/提案格式契约）、`references/empirical-results.md`（其数字为复现结果，本文不引用）、`scripts/ingest_kilo_sessions.py` / `run_kilo_evolution.py` / `test_wikiskill.py`（经子代理核对）。**未执行仓库任何代码。**

## 原文

- [MinerU 全文](.raw/tangWikiSkillCompilingAgent2026/full.md)
- [PDF](.raw/tangWikiSkillCompilingAgent2026/source.pdf)
- 第三方复现仓库：<https://github.com/martjay/Wiki-Skill>（非论文作者，数字与论文不一致，仅作工程参考）
