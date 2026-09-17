# 可吸取改进的评估（2026-09-17）：WikiSkill（arXiv:2608.27454）

> **本文回答一个问题**：读完 WikiSkill 这篇论文（+ 它的第三方复现仓库）之后，**能不能改进系统、改什么、哪些不采纳**。
> **来源**：`literature/cards/tangWikiSkillCompilingAgent2026.md`（蒸馏卡）、`literature/reading/tangWikiSkillCompilingAgent2026.md`（14 节研读记录 + W1–W9 行动项）、论文全文 `literature/.raw/tangWikiSkillCompilingAgent2026/full.md`（正文 + Appendix A–E 全读）。
> **补充来源（工程事实，非效果证据）**：第三方复现仓库 <https://github.com/martjay/Wiki-Skill>（HEAD `ddf8fdb`，owner `martjay`，**非论文作者**；2026-08-31 单日建库）。⚠️ 它 README 里的实验数字与论文 Table 1 **不一致**，本文**不引用它的任何数字**，只用它的实现与坑。**未执行仓库任何代码。**
> **状态**：**本文成稿时是评估与提案；随后用户批准，全部 P0/P1/P2 项已落地（2026-09-18，共 7 个提交）。** 逐项结果见下方 §1.1「落地状态」。正文保留的是**当时的判断依据**（为什么提、来源、优先级），**不回头改写**；未做清单的唯一权威仍是 `docs/handoff.md` §7。
> **代码细节以代码与 `docs/changelog.md` 的 2026-09-18 各节为准**——本文的措辞是评估稿的措辞。

### 1.1 落地状态（2026-09-18 更新）

| 项 | 状态 | 落点 / 证据 |
|---|---|---|
| **W1 治理台账** | ✅ 已完成 | `cache/audit-ledger.jsonl`（append-only、只由体检写）；身份 = 对象+动作+判据、**不含数值**；新条目与"已在账"分开报。规格 `design.md` §8.1；断言 11 项 + 3 项自检（`test-memory` 297 → 311） |
| **W2 索引行三段式 + lint** | ✅ 已完成 | `indexDescriptionIssue()` + 三层索引扫描；下限 8 字符；两条 finding（说明过弱 / 行不合契约）。规格 §8.2；模板纪律写进两个 `_README`；断言 10 项。**实现中自己抓出两处 bug**（元数据凑长度、`]]` 计入长度） |
| **W3 截断标注** | ✅ 已完成（**范围收窄**） | 落在 `clip()`（预算层）：`……［截断：全文 N 字符］`，N 是原文长度。⚠️ **最初想做的"检索片段标注"按"做不到"撤回**——片段读到的 passage 已被 `composePassage` 截过，原始长度不可知，做不出诚实标记。规格 §3 末段；断言 5 项 |
| **W4 原子写 + 失败必报** | ✅ 已完成 | `writeFileAtomic()`（临时文件+读回校验+`.bak`+rename）；`moveCardsToArchive` 返回 `{moved, failures}`，失败 ⇒ `status: degraded`。规格 §8.3；断言 5 项 |
| **W5 / W6 / W7 模板纪律** | ✅ 已完成（**含一处额外实现**） | 纪律写进 `records-readme` 第 6 条与 `strategy-readme` 第 9 条；另按 §0.6 第 6 条**把它写成可判定检查**：正文 ≤ 20 行、move ≤ 5（数字来自实测分布：种子库正文 7–8 行、move ≤ 3）。规格 §8.4；断言 4 项 |
| **W8 设计正当性文档** | ✅ 已完成 | `design.md` §2.1（知识层/产物层分离 + 三条推论 + 刻意不学的一点）、§10（两条"我们领先"的自我认知） |
| **W9 探针方法学** | ✅ 规格已立，**实现未做**（需真实 vault） | `testing.md` §4.1：2×2 消融 + 重复 3 次，标注**提案**；明确不做 bootstrap、不进 CI |

**本轮的实际产出**：`test-memory.mjs` **297 → 335 项**（每次改动都做了变异验证：故意造缺陷 ⇒ 确认目标断言报错 ⇒ 还原 ⇒ 核对无残留）；`npm run qa` seed-probe 8/8；全量门禁 **39/41**（两条红是 headless CDP 与真实 dsh 的**本机环境项**，已在干净 HEAD 上用 `git stash` 复跑确认同形失败）。**未改任何检索核心**（README 与协议文本里也写明了为什么不该改）。

**过程中被抓出来的三类"假东西"**（比改动本身更值得记）：① 一条**假守卫**（变异下仍全绿，因为它只看数组前三个元素）；② 一处**守卫看不见自己输入**（`cardRef` 投影丢字段 ⇒ 自检在每张卡上都触发）；③ 一处**判据看不见自己输入**（`strategies:` 在 frontmatter 里，从正文数 move 恒为 0）。三处都是"断言/检查没在测它声称测的东西"，与 `agent-repo-maintenance.md` §0.6 的元规则同族。


## 1. 结论摘要

**可以改进，但增量集中在一处，不要被"三层架构"这个说法带走。**

WikiSkill 的主线（三层知识 + 四组件闭环 + 验证门控）在我们这里**已经有对应物**：`episodes/` = 它的 raw 层、`records/topics/theorems/notation` = 它的 wiki 层、`strategy/` = 它的 skills 层。**它的分层不是新东西。**

真正的增量是三条我们确实没有的**纪律**，且都不依赖模型：

| # | 改进 | 依据 | 为什么值得做 |
|---|---|---|---|
| **W1** | **治理台账**：把体检的每次判定（对象 + 动作 + 依据 + 结论，**含"决定不处置"**）追加成 append-only 记录，下次体检先读它 | 它的 `skill-impact.md`：程序化追加「提案 diff + 验证分 + Accept/Reject」，三个明确用途之一是**"被拒过的干预不再重复提"**（§3.2.4 + Figure 3 案例） | 我们**每天**都在产生"同一张 weak 卡被反复报、没人记得上次为什么没改"这一现象。它是 `improvement-details` 第 5 项「增量回执」被延后时**缺的那份"可比的上一份记录"** |
| **W2** | **索引行三段式 + 确定性 lint**：一行内必须含「适用场景 + 为什么有效 + 具体动作」，体检检查 | 它把 `index.md` 的行格式称为全库最重要的一处，理由是**索引行决定读者要不要打开整页** | 我们的体检已经会报"疑似重复/枢纽"，但索引行本身**没有任何写法纪律**，而索引行正是 agent 决定读不读的入口 |
| **W3** | **截断标注**：证据被截断时显式标注 | 它的 `… [TRUNCATED: Exceeded 15,000 characters limit]`（Appendix C + 仓库实现） | 模型现在**不知道自己看到的是残片**，会拿残片当完整证据用。这是诚实性问题，不是优化 |

**另外一组（W4–W7）是低风险模板/实现纪律**（写候选态再原子替换、量化长度上限、防御性检查须条件触发、技能不写语法级 workaround），**W8 是文档正当性**，**W9 是评估方法**。

**明确不采纳**：两个 LLM 算子（Wiki Maintainer / Skill Proposer）、五项基准与工具环境、多轮 ReAct 提案循环、full-injection、RobustPatchEngine、它的 checkpoint 实现（有真实缺陷）。

**一句话回答用户的问题**：**能吸取，但吸的是"记录纪律"和"索引可读性"，不是"分层架构"**；它对我们最大的价值是**用一个 15 分的消融把"持久知识累积"这一件事单独称了出来**（48.7 → 63.7），以及**作者自己承认的两个缺口**（不评检索、无裁剪机制）恰好都是我们的强项——这反过来告诉我们**不要往那个方向改**。

## 2. 先说清楚：它与 MSCE 的分工（防止把两篇读混）

我们库里已有 MSCE（`tangMemorySkillsEvidenceGrounded2026`），两篇都是"记忆 ↔ 技能"，但**管的是不同环节**：

| | **MSCE**（已采纳其骨架） | **WikiSkill**（本文评估） |
|---|---|---|
| 回答的问题 | **凭什么晋升**：增益门 `G`、稳定性门、证据接地校验、可靠性 `η`、生命周期 shrink/revise/rebuild | **学过的东西存在哪、怎么记住"什么试过了"**：模式页、索引、两本台账、技能原子补丁 |
| 结构 | L1 trace → L2 policy → L3 env cognition → 下游 Skill | raw → wiki（patterns + index + log + **skill-impact**）→ skills |
| 关键消融 | Flat Memory 掉 **15.38 / 16.00 / 19.23** 分；w/o Value Calibration 每域都掉分 | 拿掉持久知识累积掉 **15.0** 分（48.7 → 63.7）；训练期开 wiki 掉 **2.8** 分 |
| 对我们的缺口 | 我们缺"判定" | 我们缺"留痕" |

**结论**：MSCE 的行动项（`gain`、接地门、`depends_on`、跨场合计数）**已经在 2026-09-17 落地**；WikiSkill 的 W1/W2/W3 **是新增的、且与已落地项不冲突**。两篇**唯一重叠**的地方是"证据锚点/接地"——已经做过，本次不重复提。

## 3. 采纳清单（按优先级）

标注：**P0** = 零 token、纯确定性、建议现在做；**P1** = 需要小设计或动模板（模板改动**必须重建 `main.js`**，AGENTS.md §3 铁律 1）；**P2** = 评估方法，需与探针一起评。

### P0-1（W1）治理台账 —— 本次最该做的一件

- **缺口（现状）**：体检（`dsh/host/memory-admin.mjs` `buildAuditReport`）每天产出 weak / unused / 疑似重复 / 待重审 / 反模式 / 枢纽 / 下游待复查等清单，**但清单本身不留档**。于是：同一张卡可以连续多天被报成 weak；用户或 agent 某天决定"这张卡先不动"，**这个决定没有任何地方记录**；下一天从零重新判断。`improvement-details-2026-09-17.md` 第 5 项把「增量回执符号 `+ ~ ! ⚠`」延后的理由正是**"只比数量会在'解决一对又新增一对'时误判为无变化"**——需要的正是**身份级的上一份记录**，而这份记录现在不存在。
- **采纳（照 `skill-impact.md` 的形状，换成我们的对象）**：每次体检对某个对象给出处置建议时，追加一条：
  `时间 · 对象（卡路径）· 动作（建议合并 / 收窄边界 / 归档 / 补 source / 补索引行 / 不处置）· 依据（哪条判据 + 具体数字，如 jaccard、uses、success_rate、gain、days）· 结论（本次是否执行；未执行必须写理由）`。
  **"不处置"必须落盘**——这是整个机制的价值所在（它让"我们看过、决定不改"变成可查的事实）。
  体检在**生成建议之前**先读台账：对同一对象、同一判据、依据数值未变的情况，输出「与 YYYY-MM-DD 的判定一致（依据未变）」而不是当作新发现重复报；依据变了才当新建议。
- **落点**：`dsh/host/memory-admin.mjs`（写入 + 读取）+ `dsh/preset/math-memory.mjs`（若体检与宿主两份实现都参与，注意 **AGENTS.md §3.3 的双份实现**：新增共享助手要用**同一个名字**，否则 `check-engine-sync.mjs` 看不见它）；`docs/memory/design.md` 补一节规格。
- **判据**：`scripts/test-memory.mjs` 加断言——构造一张 weak 卡，连跑两次体检 ⇒ 台账两条、第二条能关联到第一条；**把台账读入关掉 ⇒ 断言必须失败**（AGENTS.md §6 的变异验证）。
- **风险与反模式**：**不要把它做成"每轮新增必做步骤"**。`design-intake-2026-09-10.md` 记着一条教训：这个项目真实的失败模式是**机制没人用**（真实 vault 里整套反馈面全为 0）。所以台账必须**全部由体检自动写**，模型零负担、零新工具。
- **待拍板的一个小选择**：落点用 `cache/memory-audit-log.jsonl`（**便于身份级比对**，机器侧，`cache/` 已是既有约定）还是 `.deepseek/memory/audit-log.md`（**便于人读与 Obsidian 搜索**）。我倾向 **jsonl 为事实源 + 体检报告里渲染人类可读的一小段**（两个面板都已从 `collectMemoryState` 渲染，不新增解析）。

### P0-2（W2）索引行三段式 + 确定性 lint

- **缺口**：`strategy/index.md`、`theorems/index.md`、`records/` 的索引行是**人手/模型随手写的一行**，没有写法纪律；而 agent 判断"要不要打开这张卡"靠的就是这一行（外加 `note_recall` 的 snippet）。
- **采纳**：在 `strategy-readme.md` / `records-readme.md` 里写明**索引行三段式**：`适用困难/场景 + 为什么有效（根因/机制）+ 具体动作（去哪检索/用哪招）`；体检做**确定性 lint**——缺"为什么"或"怎么做"任一段 ⇒ 列进「索引行不合格」，给出改写建议（**只报告不自动改**）。
- **判据**：构造一行只有标题、没有理由与动作的索引 ⇒ 断言体检列出它；补齐后断言消失。
- **注意**：**不要**引入新格式契约去推翻现有索引行（它们是导航，不是机器契约）；lint 的是"信息是否齐"，不是"格式是否合规"。

### P0-3（W3）截断标注

- **缺口**：`note-tools.mjs` 组装检索结果与卡片正文时，长内容会被截断/压缩，但**返回文本里没有截断标记**——模型读到的是"看起来完整"的残片。
- **采纳**：照 `… [TRUNCATED: 原文 N 字符，已截断至 M]` 的形状显式标注；`note_recall` 的 coverage 行也可顺带说明"本段为节选"。
- **判据**：构造超长卡 ⇒ 断言返回文本含截断标记与原文长度；标记缺失则断言失败。

### P1-1（W4）破坏性写入：候选态 + 原子替换 + `.bak`

- **缺口**：我们的写入是"读整文件 → 改 → 写回"（`writeFileSync`），失败只在 `catch` 里 best-effort 报告。仓库那条坑对我们的动机是一样的：**在 Obsidian 里被人类手改过的文件，任何"整体重写"都必须有回退路径**。
- **采纳**：先写临时文件 → 校验写回成功 → 替换；保留 `.bak`；失败则保留原文件并**报告降级**（不是静默成功）。
- **明确避免**：仓库的 `_init_workspace()` **每次构造工作区都用当前磁盘状态覆盖 known-good checkpoint** ⇒ 崩溃后的中间态会被"追认"为 good。我们要的是**反向语义**：只有显式成功才更新 known-good。
- **判据**：注入一次写入失败 ⇒ 断言原文件仍在、报告为降级。

### P1-2（W5 / W6 / W7）三条模板纪律（一组，一次改完）

1. **W5 量化长度上限**：本文的「模式页 10–30 行」是**可确定性检查**的，我们的「原子化、不要整段总结」不可检查。给 records 正文与策略卡各定一个**上限**（建议：records 正文 ≤ 20 行，策略卡 moves ≤ 5 条），体检把超限卡列为「过长、需拆分」。
2. **W6 防御性检查必须条件触发**：负迁移的第二诱因是**碎片化前置检查耗尽交互预算**。我们的同构物是 AGENTS.md §5 的检索步数预算（一轮 ≤1 次 `note_strategy` + ≤4 步内容检索）；风险在于策略卡的 moves 被 agent 当成**每轮必跑的前置清单**。⇒ 模板里要求每个 `move` 标注**触发条件**，并把"预算是硬约束"从 AGENTS.md 写进 `strategy-readme.md`。
3. **W7 不写语法级 workaround**：负迁移的第一诱因是**底层 workaround 硬化会束缚更强的执行者**。我们有 `abstraction` 三段（concrete/principle/generalize），方向一致；补一条纪律：**`concrete` 段不得硬编码具体算子/记号的结论**（那属于 `theorems`/`notation` 层，与"MSCE 的 L2/L3 禁写隔离"是同一条边界）。

- **落点**：`dsh/templates/strategy-readme.md`、`dsh/templates/records-readme.md`、`dsh/templates/vault-AGENTS.md` §5。
- **⚠️ 必做**：改模板 ⇒ 同步 `dsh/templates-manifest.json`（若增删文件）+ **重建 `main.js`**（`node scripts/build-obsidian.mjs`）并一起提交（CI 有字节级门禁）。
- **判据**：模板完整性门禁 + `check-doc-consistency.mjs`；W5 另加体检「过长卡」检测的断言。

### P2-1（W8）文档：把"知识层 / 产物层分离 + 知识层不回滚"写成设计正当性

- **做什么**：在 `docs/memory/design.md` 写明——我们的 `records/topics/theorems/notation` 是**知识层**（长期、不因某张卡失效而消失），`strategy` 是**产物层**（可 promote/demote/rewrite），并引本文的三层物理分离与「wiki 永不回滚、技能可回滚」、以及 Table 3 的 +15.0 / −2.8 作为外部论据。
- **附带**：把本文 Limitations 的两条（**不评检索**、**无裁剪机制**）也记进去，作为"我们的强项在哪、为什么不去学它的检索"的书面依据——防止下一个 agent 读到"三层级联"又想重写 `note_recall`。

### P2-2（W9）评估方法：2×2 消融形状 + 三次重复

- **做什么**：把 `engine-probe.mjs` 的消融从"关掉一个开关跑一遍"改成 **「注入 vs 不注入」×「库里有 vs 没有」** 的 2×2（理由：单开关消融无法区分"没读到"与"没有可读"）；同一组查询**重复 3 次**报稳定性。
- **不做什么**：bootstrap 显著性在我们几十条合成用例上**不适用**；live/E2E 部分**不跑**（AGENTS.md §4：要跑先问用户）。

## 4. 明确不采纳（附理由，防后续重复讨论）

| 不采纳 | 理由 |
|---|---|
| **Wiki Maintainer / Skill Proposer 两个 LLM 算子** | 直接违背"插件不调模型"红线（`design.md` §9）。**只取它们产出的文件契约**（模式页四段式、索引行格式、台账字段），判定留给确定性代码 |
| **五项基准及其工具环境**（LiveMath/SealQA/SpreadSheet/OfficeQA/ALFWorld + bash/web_search/glob） | 我们的场景是单用户数学学习；引入外部 benchmark 与工具面会破坏最小工具面与 fail-closed 姿态 |
| **多轮 ReAct 提案循环**（`T_ReAct` 10–20 轮、`read_file` 自主探索） | 依赖模型自主探索，与我们"模型只提案内容、统计字段由插件原子改写"的所有权契约（已落地）冲突 |
| **full-injection（全部技能整段塞进 prompt）** | 作者这样做是为了**排除检索这个混淆变量**，代价是自己承认"技能一多就不可行"。我们的注入预算是分档的（精简/标准/富上下文），且我们**有**检索——这正是我们的强项 |
| **RobustPatchEngine（三级容错补丁）** | 我们的写入者是插件（确定性），不需要"猜模型想改哪段"；人类手改的风险由 **P1-1 的原子替换**覆盖。另：仓库这份实现**未做名字净化**（`create_patterns` 可含 `../`）、目标缺失时**静默跳过**——两点都不要照抄 |
| **它的 checkpoint / known-good 实现** | `_init_workspace()` 每次构造都用当前磁盘状态覆盖 checkpoint ⇒ 崩溃中间态被追认成 good。语义是反的 |
| **训练期"推理 agent 禁读知识层"** | 我们**故意**全注入（这是产品形态）。但**它的判据要保留**：让模型直接在会话里读原始素材，会降低**蒸馏产物**的质量 ⇒ 反对把 `episodes` 原文塞进上下文 |
| **验证集严格单调门（`> R_best`）** | 我们的"验证"是稀疏的用户 ✅/❌（比它的 18 条验证集更稀疏），严格单调会几乎不接受任何改动。我们的 `gain` + 接地门 + 0.6 阈值已经是更适合的形状 |

## 5. 悬置项（需拍板）

1. **W1 台账的落点与格式**：`cache/memory-audit-log.jsonl`（机器侧、便于身份级比对）还是 `.deepseek/memory/audit-log.md`（人可读、可被 Obsidian 搜到）？**建议 jsonl 为事实源 + 体检报告渲染一段人读摘要**。
2. **W1 是否要在体检输出里做"与上次一致"的合并**：合并会让每天的报告更短（更像"增量回执"），但也会让"这张卡仍然有问题"变得不显眼。**建议先只写台账、不改报告**，跑一两周看效果再决定。
3. **W5 的长度上限具体取多少**：本文给的是"模式页 10–30 行"。我们的 records/策略卡粒度不同，需先统计真实 vault 的分布再定阈值（**锚在代码与真实分布上，不要凭空定数**，AGENTS.md §6）。
4. **W9 的探针改造是否与检索 v4 一起做**：它动的是 `scripts/qa/engine-probe.mjs`（零 token），但与"检索核心"相邻。建议**单独做**（它只改探针的对照形状，不改检索）。

## 6. 来源与可信度

- **论文**：MinerU `full.md` **干净**（`<sub>` 0 处），**正文 §1–§7 + Limitations + Appendix A–E 全部读完**（Algorithm 1、Table 1–7、五个推理 prompt、Maintainer 与 Proposer 完整 prompt）。14 个 `<table>` 以原始 HTML 保留（可读，但需要能读 HTML）。可信度高。
- **第三方仓库**：HEAD `ddf8fdb`，owner `martjay`（**非论文作者**），MIT，6 stars，0 fork，2026-08-31 单日 7 次提交。**已核**：`README.md`、`SKILL.md`、`references/architecture-and-loop.md`、`references/best-practices-and-pitfalls.md`、`scripts/wikiskill_framework.py`、`scripts/wikiskill_orchestrator.py`，以及（经子代理核对）`ingest_kilo_sessions.py` / `run_kilo_evolution.py` / `test_wikiskill.py`。**未核**：其 `references/empirical-results.md` 的数据来源（不引）、`references/prompts-and-tools.md` 全文（经子代理摘录格式契约）。**未执行任何仓库代码。**
- ⚠️ **它的实验数字与论文不一致**（Gemma/Gemini 行分项不同），且其代码里有几处**实现级放行**（turnkey 路径缺验证集时 `cur_val_score = 1.0`；mock+auto 直接 `manual_dec = True`；`SessionTraceParser` 产出的轨迹没有 `target` 字段而 `SubstringScorer` 对空真值直接返回满分）⇒ **它的自测通过不能当作论文结论的佐证**。本文因此**只把它当工程参考**，并在卡片与研读记录里同样标注了这一点（AGENTS.md §6「二手来源要标注」）。
- **本轮（成稿时）**：**未运行任何 live/烧钱验收**；**未改动任何代码**；全部动作是读论文、导入文献、写卡片/研读记录/本评估、更新索引。文献导入按 `docs/literature.md` §8 的 SOP 执行（`node scripts/lit-import.mjs --source "D:\临时\agent记忆" --out literature --bib "D:\临时\agent记忆\导出的条目.bib"`），源目录仍含该论文，`.manifest.json` 的 `source` 指向真实语料目录（**未**踩 §7 那个"临时目录当 `--source`"的坑）。
