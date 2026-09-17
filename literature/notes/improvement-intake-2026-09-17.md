# 可吸取改进的评估（2026-09-17）：MSCE × MemForest × VeryMath

> **本文回答一个问题**：读完这批文献/仓库后，**能不能改进系统、改什么、按什么顺序、哪些不采纳**。
> **来源**（研读记录见 `literature/reading/`，卡片见 `literature/cards/`）：
> 1. **MSCE**（`tangMemorySkillsEvidenceGrounded2026`，arXiv:2607.16621）——记忆→技能的受治理晋升；
> 2. **MemForest**（`wangMemForestEfficientAgent2026`，arXiv:2609.08273）——写时压缩；
> 3. **VeryMath 组织**（`reading/verymathOrg2026.md`）——AI4Math skill 生态 + Co-Mathematician + Danus + 文献/术语库；
> 4. 已在本仓库的前作（GraphMemix / Obelisk 等，见 `references.md` §11–12）——用于去重与合流。
> **状态**：本文是**评估与提案**，未改动任何代码/模板/`main.js`。落地需你拍板（AGENTS.md §5：未做清单以 `docs/handoff.md` §7 为唯一权威）。

## 1. 结论摘要

**可以改进，而且缺口被三个互不相关的来源同时指到了同一处。**

一句话概括这批材料：**我们的"读路径"（分层记忆 + 统一 BM25 + hook 字段加权 + 卡片级验证分级）已经优于这三者中的任何一个；我们缺的全部在"治理闭环"上——写了之后，怎么知道它有没有用、什么时候收窄、依赖它的东西要不要复审。** 这正是 `ARCHITECTURE.md` 说的 1.0 缺口「技巧调用体系」。

最值得立刻做的三件事（都**零 token**、都不触碰"插件不调模型"红线）：

| # | 改进 | 谁指出的 | 为什么现在做 |
|---|---|---|---|
| **1** | **`hook` 增加「增益」治理信号**（把单侧 `harmed` 升级为带符号净收益，without 侧向保守基线收缩） | MSCE（`G = V̄_with − V̄_blend`，`N_0=5, b=0.5`） | 这是 hook 块唯一缺的治理量；没有它就分不清"用过没效果"与"从没被用过" |
| **2** | **依赖方向 + 级联复审**（卡被 `superseded`/推翻时，列出下游待复审清单） | **三篇独立指向**：Danus（内容寻址 + 级联撤销）、MemForest（度数高的节点是枢纽）、MSCE（证据锚点 A） | 我们现在**完全没有**；直接服务 1.0 的"可纠错" |
| **3** | **"选哪一对"的候选排序 + 枢纽保护**（去重按相似度降序；被多次反链引用的卡单列、排除出建议合并） | MemForest（Eq. 15 下界；Table 4 的 Minimum 89.0% 比 Random 91.7% 更差） | 体检现在只报"疑似重复"、**无排序依据**；选错对象比不做更糟 |

**明确不采纳**（理由见 §5）：自动合并（不可逆 + 需 LLM）、JSON/SQLite 替代 markdown 事实源、多 agent 蜂群编排、把技能交回 agent 全局发现、五个 LLM 算子。

## 2. 外部证据：为什么我们的架构选择是对的

读这批材料的**首要收获不是"要改什么"，而是"哪里不用改"**。三个互不相关的作者群各自独立收敛到我们已经有的原则：

| 我们的原则 | 外部印证 |
|---|---|
| **机器契约（frontmatter）+ 人类正文** 双层 | VeryMath 的文献笔记（YAML frontmatter：`type`/`global_uri`/`core_theorems`/`status`）、术语库（JSON 事实源 + Excel 仅供导出）、co-mathematician（`GOALS.yaml` + 报告正文） |
| **Ground Truth 在磁盘文件**、无数据库 | VeryMath 原文："Ground Truth 始终是磁盘上的 JSON 文件"；"JSON 文件为唯一事实源" |
| **确定性维护与模型动作分离**（我们：插件不调模型） | co-mathematician 原文："Python harness **不跑 agent**，只初始化文件、追加消息、创建工作流、检查门控、渲染论文"；Danus："权限由 MCP 角色表强制，**不是靠提示词**" |
| **分层组织 > 扁平记忆** | MSCE 消融：**Flat Memory 在 IR/Math/SE 掉 15.38 / 16.00 / 19.23 分**，Code 成本 2.0 → 5.3 turns |
| **可回溯、不删除**（`superseded` 而非删除） | Danus：最终证明**从未引用的条件性脚手架仍保留**；GraphMemix：**低价值轨迹仍保留作反证据**；MSCE：低置信认知**不删除，只排除出默认检索** |
| **`not_applicable_when` 硬门控不是可选优化** | MSCE 消融：**w/o Value Calibration 在每个领域都掉分且成本升** ⇒ 盲目注入技能有**害** |
| **不做离线生成式摘要/压缩** | GraphMemix 反对写时压缩（贵且丢局部线索）；MemForest 的限制：**低冗余文本压 70% 只剩 93.3%** |

⇒ 这些可以直接写进 `docs/memory/design.md` 作为**设计正当性的外部论据**（行动项 D7）。

## 3. 按优先级排的采纳清单

标注：**P0** = 现在就该做且零 token；**P1** = 需要小设计；**P2** = 需要改代码/动检索核心，建议与检索 v4 一起评。

### P0-1 「增益」治理信号（MSCE 的形状 + 我们的确定性代理量）
- **缺口**：`hook` 有 `uses / success_rate / last_used / harmed / verified`，**没有"用了它比不用它好多少"**。`harmed` 是单侧计数，无法表达净收益。
- **采纳**：MSCE `G = V̄_with − V̄_blend(S_without)`，**without 侧向保守基线收缩**（伪计数 `N_0 = 5`、基线 `b = 0.5`）——小样本时不产生虚假增益。**用我们的确定性代理量替换它的 `V`**（候选代理：本轮是否触发 ❌、结论是否在后续被 `superseded`、用户是否继续追问同一问题）。
- **落点**：`dsh/preset/math-memory.mjs`（体检统计回写）+ `records-readme.md` 字段语义 + `note_recall` 的 `hookPrior` 消费。
- **判据**：`test-memory.mjs` 断言"小样本时不越界、`uses = 0` 时无虚假增益"。**要锚在代码上、不锚在数据上**（AGENTS.md §6）。
- **红线**：必须**确定性**。MSCE 的 α 由 LLM 打分，我们**不能**照搬那部分。

### P0-2 依赖方向 + 级联复审
- **缺口**：卡被 `superseded`/定理被推翻后，**下游哪些模板/策略/笔记依赖它、需要复审**——我们只有 `related` 双向链，无方向、无级联。
- **采纳**：卡片显式记录**它依赖哪些卡**（与 `related` 分开）；体检在某卡失效时**列出下游待复审清单**。三篇独立指向（Danus 级联撤销 / MemForest 枢纽度 / MSCE 证据锚点）。
- **落点**：`records-readme.md` / `templates-readme.md` / `theorems-readme.md` + `dsh/host/memory-admin.mjs`。
- **判据**：构造 A ← B ← C，把 A 标 `superseded` ⇒ 断言体检列出 B、C。

### P0-3 去重候选排序 + 枢纽保护（MemForest）
- **采纳**：① 疑似重复**按相似度降序**输出（依据 Eq. 15 下界）；② 计算**反链数**（`note_links` 已有，零成本）作为**结构枢纽度**，枢纽卡在体检里**单列并排除出"建议合并"**（依据 Eq. 6 的动机 + Table 4 的 Minimum 反例）。
- **落点**：`memory-admin.mjs` 体检输出。
- **判据**：构造"A↔B 互链 + C 孤立"⇒ 断言 C 先被建议合并、A/B 标为枢纽。

### P0-4 状态机补"未达状态即结构性禁止"
- **缺口**：我们**已是**状态机（`candidate → active`、`inbox → polishing → done`、`active / superseded`、`single-source → cross-referenced → user-confirmed`），但**只有 `superseded` 真正做成了"状态即权限"**；策略卡的 `candidate` 在代码层面**没有任何东西阻止**它被当作结论依据使用。
- **采纳**（co-mathematician 的"草稿目标不可执行，只有 `approved` 才能接收工作流"）：`candidate` 策略卡仍可被检索（是有价值的线索），但**输出必须与 `active` 分开**并标明"候选线索，不得直接作为依据"；`done` 备忘不再算活跃。**抄形状，不抄它的重流程**。实现可直接照 `note-tools.mjs` 已有的 `excluded` 分组写法。
- **落点**：`note-tools.mjs`（`note_recall`/`note_strategy` 输出分组）+ `strategy-readme.md` + `vault-AGENTS.md` §5 + 断言。
- **更正**：本项与"适用边界门控"是两件事——**适用边界 `not_applicable_when` 的硬门控已经完整实现且有测试**（`note-tools.mjs` 771–828 行；`test-memory.mjs` 1490–1502、1676 行）。我曾误称"没有断言盯这个门控"，详见 `improvement-details-2026-09-17.md` §1。

### P0-5 写入原子性 + "模型只提案"契约 + 增量回执
- **采纳**（VeryMath 三处独立出现）：明文规定**机器统计字段只由插件确定性原子改写；模型只提案内容，不得整体重写索引或统计字段**；并把**任一处被模型改动**纳入体检检测（扩展现有"越权升级"检测）。
- **增量回执**：体检与维护动作只输出 `+` 新建 / `~` 更新 / `!` 冲突 / `⚠` 陈旧未提醒，**无变更即静默**。
- **落点**：`vault-AGENTS.md` §5、`design.md` §5/§8、`math-memory.mjs`。
- **为何优先**：三处独立来源得出同一结论，且这是我们契约里**唯一没写明的部分**。

### P1-1 跨 episode 独立支撑计数（MSCE `n_min` + MemForest 的事件双轴）
- **采纳**：用**同 `topic` + `episodes` 日期邻近**确定性识别"同一件事"，统计"同一 `difficulty × move` 被几个**独立** episode 支撑"。判据来自 MSCE（拒绝让一条长轨迹自撑出一个策略）+ MemForest（"同一件事 = 语义相近且时间相邻"，偏语义 0.8 / 时间 0.2）。
- **价值**：区分"一次巧合"与"重复出现的真技巧"——`strategy` promote 的第三道门。

### P1-2 策略卡「接地 + 稳定性 + 增益」三道结晶门
- **现状**：promote 条件是 `uses ≥ 3 且 success_rate ≥ 0.6`——**这几乎就是 MSCE 的可靠性门**（阈值 0.6 巧合一致）。
- **补三样**：① **接地**（`strategies[].move` 声称的定理/技巧必须在 `provenance` 指向的证据里出现过，纯确定性）；② **稳定性**（近期证据吻合当前 move/边界，未被反复改写）；③ **增益门**（P0-1）。
- **另补**：策略卡的**证据锚点**（结构化列出支撑 records/episodes 的 id，而不是只写 `provenance`）；`preconditions`（正向前置条件，与 `not_applicable_when` 负向门控配对）。

### P1-3 反馈收窄边界 + 反模式结构化
- **采纳**（MSCE 的 `shrink` 与 `D = (c, a⁺, a⁻, e, ξ)`）：❌ 反馈时除改 `success_rate`/降 `verified` 外，**把被否决时的上下文特征追加进 `not_applicable_when`**；把反模式升级为策略卡的 `prefer[] / avoid[]` **对比对（各带 evidence）**。
- **补强**：co-mathematician 要求"**失败尝试与不确定性是产出必填项**"⇒ 把"试过但没成功"结构化成产出（与 `avoid` 侧互补）。

### P1-4 评估指标升级（三源合流）
- **`Avg-R`（平均检索轮数）**（MemForest）：为取到足够信息**要检索几轮**——度量检索的**信息密度**，我们从未用过。
- **Cost 与 Pass@1 必须合看**（MSCE 自述"低成本可能来自提前终止或工具使用不足"）。
- **带符号净回收**（GraphMemix，已在 `retrieval-v3.md` §7 落地为探针 §2）。
- **可达性分层 Direct / Recoverable / No access**（GraphMemix，已落地）。
- **跨"高冗余/低冗余"两场景测**（MemForest）：给**适用边界**而不只是单一分数。
- **落点**：`scripts/qa/engine-probe.mjs` + `docs/memory/testing.md`。**建议合成一次探针升级**而不是四个独立改动。

### P1-5 文献库生命周期与来源登记
- **陈旧提醒**（VeryMath：7 天未读 / 30 天未互动 + 四个处置选项）：给 `cards/*.md` 的研读状态加提醒并在索引可见（`.index.json` 的 status 是机器默认 `unread`，已知现象，正好借此修正）。
- **来源登记范式**（OptSkills 的 `SOURCES.md`：上游仓库 + 快照 commit + **明确排除项**）：`references.md` 现只用链接；补"来源 + 版本/快照 + 不搬的部分"，防止"二手印象入档"。
- **实体级稳定引用**（`paper:arxiv:…#Thm-1`）：我们 `citekey` 已做到文献级，**定理级**是否要，由你定。

### P2 注入预算档位
- MemForest 的压缩率是**显式旋钮**（30/50/70%）；我们的预算是**硬编码常量**（profile 4000 / topics 1800 / …）。可做成"精简 / 标准 / 富上下文"三档。
- **注意**：要动 Obsidian 设置页 ⇒ 必须重建 `main.js`，且 `docs/env-vars.md` 由 `check-env-vars.mjs` 双向守卫。

### P2 三层级联检索与回退语义
- MSCE 是"技能优先 → L3 先验 → 技能失败回退 L1"；我们是**一次统一 BM25 排序**。改检索核心属 `retrieval-v3.md` 地盘，**建议先只补协议文本**（"策略卡命中但失败 ⇒ 回退 `note_recall` 读 records/episodes"），改代码留给检索 v4 统一评。

## 4. 三源交叉后新出现的判断（单篇读不出来的）

1. **"时间邻近 ≠ 内容相关"要分场景**。MemForest 的 AGPR 押"时间邻域"是因为它的对象是**连续对话/视频片段**；MSCE 押"**跨 episode 独立支撑**"是反方向（要求**不同** episode）；VeryMath 的文献库用 `last_interacted` 时间戳但**只用于提醒、不用于检索**。⇒ 我们的结论：**时间只做提醒与分组（P1-1），不做检索加权**。这条单看任何一篇都会做错。
2. **"枢纽/度数"这个概念在三处有不同名字但同一件事**：MemForest 的节点度数（不要先合并）、Danus 的依赖入边（级联撤销）、MSCE 的证据锚点（哪些东西依赖它）。⇒ 合成一个统一的**"被引用度"体检维度**（P0-2 + P0-3）。
3. **"失败/低价值材料要留、不能删"是三方共识**（Danus 未引用的脚手架 / GraphMemix 低价值轨迹 / MSCE 低置信认知）。⇒ **强化我们不删除只归档的路线**，并在文档里写明它是共识而非我们的偏好。
4. **治理量必须"带符号"**：MSCE 的 `G`（with − without）、GraphMemix 的净回收（−6/−36）、MemForest 的 Minimum vs Random 对照——**三处都在警告单侧计数会高估**。⇒ 我们现有 `harmed`（单侧）与新 `gain`（带符号）要成对存在（P0-1）。
5. **"适用性过滤是防害"有三重独立证据**：MSCE 的 w/o Value Calibration 每域掉分、MemForest 的 Minimum 比 Random 更差、GraphMemix 的通用去冗余净回收为负（已在 handoff 坑 46）。⇒ 我们应在文档里把 `not_applicable_when` 从"建议写"升格为"**防害机制**"。

## 5. 明确不采纳（附理由，防后续重复讨论）

| 不采纳 | 理由 |
|---|---|
| **自动合并近重复卡**（MemForest 的核心） | ① 合并需 LLM ⇒ 违背"插件不调模型"红线；② **不可逆**，与我们 `source` 必指 episode、`superseded` 可回溯、1.0「可纠错」目标冲突；③ 我们的重复量级（个人数学笔记）远小于它的 6000 节点/100MB。**保留 `superseded` 路线**（但采纳它的**排序判据**，见 P0-3） |
| **JSON / SQLite 作为事实源** | markdown 文件是我们的**特性**（Obsidian 原生、可 grep、用户可读可改），不是缺陷。VeryMath 用 JSON 是它的场景选择 |
| **多 agent 蜂群编排 + 并行证明搜索**（Danus） | 我们场景是**单用户数学学习**，不是研究级并行证明；且它的运行姿态（`--dangerously-bypass-approvals-and-sandbox`，自述需隔离主机）与我们 fail-closed + 最小工具面**故意相反** |
| **把技能交回 agent 全局 skills 目录自动发现**（VeryMath） | 会扩大工具面、破坏我们 preset 的最小工具面与 `approval: never` 姿态；我们的策略卡走 `note_strategy` 是更窄的入口 |
| **五个 LLM 算子**（MSCE：反思打分 / 奖励量化 / L2 归纳 / L3 抽象 / 技能起草） | 直接违背"插件不调模型"。**只取其确定性判定骨架**（schema / 接地 / 覆盖 / 阈值） |
| **AGPR 的时间邻域检索**（MemForest） | 见 §4.1：数学笔记场景里时间相邻 ≠ 内容相关 |
| **MCP 角色表 / 内容寻址存储的具体实现**（Danus） | 机制思想采纳（P0-2/P0-5），但 MCP 与内容寻址存储与我们 markdown + 插件的形态不兼容；用"体检可检测"替代"工具表强制" |
| **co-mathematician 的完整重流程** | 目标审批 + 四类工作流 + 评审出终稿，对即时学习对话过重。**只抄"状态 = 权限"的轻量形状**（P0-4） |

## 6. 需要你拍板的悬置项

1. **P0-1 的确定性代理量选哪一个**（触发 ❌ / 被 `superseded` / 用户继续追问）——这决定 `gain` 的语义与断言怎么写。我倾向**先只用"是否被 ❌ 或被 superseded"**（最确定、无歧义），把"继续追问"留作后续。
2. **P1-4 探针升级是否一次性做完**（`Avg-R` + Cost + 净回收 + 可达性分层 + 双场景）——一次做完信息量最大但改动面大；分批则每批都能独立验证。
3. **P2 注入预算档位是否值得做**——它对"侧栏性能/上下文窗口"有实际价值，但要动 Obsidian 设置页并重建 `main.js`（且新增环境变量会进 `docs/env-vars.md` 的双向守卫）。
4. **P1-5 的定理级引用**是否要做——收益是精确引用，成本是给 `theorems/` 引入新的 ID 契约与生成/校验。

## 7. 落地顺序建议（若全部同意）

```
第一批（P0，全部零 token、互不依赖，可一次提交一组）
  P0-5 写入原子性 + 模型只提案 + 增量回执   ← 先立契约（它是其余各项的前提）
  P0-4 状态机"未达状态即禁止"
  P0-3 去重排序 + 枢纽保护
  P0-2 依赖方向 + 级联复审
  P0-1 增益信号                              ← 改动最大的一项，放最后便于单独回退

第二批（P1，需要小设计）
  P1-1 跨 episode 独立支撑 → P1-2 三道结晶门（两者共用"同一件事"的分组）
  P1-3 收窄边界 + 反模式结构化
  P1-4 探针升级（建议与 retrieval-v3 的既有探针合并）
  P1-5 文献库生命周期 + 来源登记

第三批（P2，动代码/动检索核心，与检索 v4 一起评）
  P2 注入预算档位 / 三层级联与回退
```

每批的纪律：**改完重建 `main.js`**（若触及 `dsh/**`、模板或 `obsidian/main.template.js`）→ `npm test` → `npm run qa` → 按 AGENTS.md §5 写 `docs/changelog.md`；**守卫类改动必须做变异验证**（故意造缺陷 ⇒ 确认报错 ⇒ 恢复 ⇒ `git diff` 为空）。断言数等数字改动后跑 `check-doc-consistency.mjs`。

## 8. 来源与可信度

- **MSCE**：MinerU 全文干净（`<sub>` 仅 2 处下标数字），**正文 + Appendix B/C/D/E 全部读完**（含超参数表 6 与三个 prompt 原文）。可信度高。
- **MemForest**：MinerU 全文可用（5 处 `<sub>` 均为 `m₁..m₃`），**§1–§6 + Appendix A–G 读完**，并用 `pdftotext -layout` 交叉核对。⚠️ 原文 §5.3.2 的提速数字与 Table 13 存在轻微不一致（已在研读记录中标为原文出入）。
- **VeryMath**：一手核验了官网首页、官方手册、co-mathematician README、`skill_reference_manager.md`、`math-glossary/SKILL.md`、`danus-helper-dsh/SKILL.md`、Danus README（pin commit）+ arXiv 摘要。⚠️ 未核实：OptSkills 原文摘要（fetch 失败，卡片已标注"摘要为改写"）、`sage_ref_search.py` 与 `harness/co_math/skills.py` 内部、是否有私有仓库、组织 owner 身份。
- **未做**：本轮**未运行任何 live/烧钱验收**（AGENTS.md §4 要求先问用户）；**未改动任何代码**；本轮所有动作都是读、导入文献、写研读记录。
