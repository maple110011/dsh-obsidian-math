# 记忆系统当前设计（实现规格）

> 当前版本：0.7.7
> （本文件描述**当前**实现；它与 `package.json` 的一致性由 `check-version-consistency.mjs` 守卫）
>
> 本文档描述**代码里真实存在**的记忆系统，不是愿景。对应文件：
> - 注入引擎：`dsh/preset/math-memory.mjs`
> - 笔记工具：`dsh/preset/note-tools.mjs`
> - 工作协议：`dsh/templates/vault-AGENTS.md`（安装进 vault 根目录后名为 `AGENTS.md`）
> - 记忆模板：`dsh/templates/*.md`（安装进 `<vault>/.deepseek/**`）
> - 生命周期维护：`dsh/host/memory-admin.mjs` 的 `archiveOldEpisodes`（由 Obsidian 插件启动时触发）

## 1. 架构总览

```text
                 system prompt 组装
                 ├─ persona + AGENTS.md + 工具说明（静态）
                 └─ dsh-math:memory 段（每次组装动态追加）
                        │
   vault/.deepseek/     │  buildMemorySection()
   ┌──────────────────┐ │  ├─ 五层摘要：profile / topics / records /
   │ memory/profile.md│─┤  │   templates / episodes / inbox 各层索引，
   │ memory/topics/   │ │  │   按字符预算截断注入（导航层进 prompt）
   │ memory/records/  │ │  ├─ dialogue index：历史会话问答线索（≤6 组）
   │ memory/theorems/ │ │  └─ memory-audit：记忆体检报告（v2，≤1200 字符）
   │ memory/templates/│ │
   │ memory/episodes/ │ └─ 证据层留在磁盘，靠 grep/read 按需读
   │ inbox/           │
   │ cache/           │
   └──────────────────┘
```

记忆**只存在于 vault 的 markdown 文件**里；插件不持库、不调模型、唯一写文件是自己的缓存（`cache/dialogue-index.json`、`cache/memory-audit.json`）。

## 2. 五层记忆结构

| 层 | 文件 | 内容 | 注入方式 |
|---|---|---|---|
| 语义层 | `memory/profile.md` | 现在仍成立的稳定偏好/记号/授权，带修订历史 | 摘要注入（≤4000 字符） |
| 导航层 | `memory/topics/index.md` + `<topic>.md` | 主题路由索引与细节 | 索引注入（≤1800 字符） |
| 记录层 | `memory/records/index.md` + `<slug>.md` | 类型化原子卡 fact/event/instruction/preference/artifact，带 id/source/变更历史，冲突 superseded | 索引注入（≤800 字符） |
| 证据层 | `memory/episodes/YYYY-MM-DD-*.md` | 每轮对话的原始事件卡，append-only | 时间线尾部注入（≤1200 字符）+ grep 按需读 |
| 想法层 | `inbox/<slug>.md` | 想法 memo，状态 inbox→polishing→done | 状态摘要注入（≤1200 字符） |

辅助结构：
- `memory/theorems/index.md`：个人 Matlas 定理索引（一行一条，领域/关键词/状态）；
- `memory/templates/<slug>.md`：问题模板卡（题型/解法 ↔ 定理关联图），索引注入 ≤600 字符；
- `memory/notation.md`：记号体系（已采纳/候选/已否决三表 + 修订历史；收集→统一→维护，≤800 字符随提示注入）；
- `capture-policy.md`：捕获策略（四个档位 `idea`/`fact`/`preference`/`structure` × `auto`/`ask`/`off`，frontmatter，用户维护；随系统提示注入）。默认 `idea`/`fact`/`preference` = `ask`（写入记忆前先征得同意），**`structure` = `auto`**（它管的是给已存在的内容补索引与结构行，每次都问会打断对话；也保证缺 `structure:` 行的旧策略文件行为不变）——见 `DEFAULT_CAPTURE_POLICY`；
- `strategy/<slug>.md`：策略层方法卡（困难→策略→检索目标 + 抽象阶梯 + 反模式），`note_strategy` 按需检索，不逐轮注入；
- `working.md`：工作记忆草稿（覆写、有未闭合线程才写、≤500 字符注入、空则跳过）；
- `cache/`：机器生成的对话索引、记忆体检报告与 hook 历史快照（用户勿动）。

## 3. 注入预算（`math-memory.mjs` 常量）

| 段 | 预算 |
|---|---|
| profile | 4000 字符 |
| topics index | 1800 字符 |
| records index | 800 字符 |
| templates index | 600 字符 |
| episodes index（尾部最新行） | 1200 字符 |
| inbox digest（含提醒候选） | 1200 字符 |
| 跨会话问答线索 | 最多 6 组 / 3000 字符 |
| 记忆体检报告（v2） | 1200 字符 |
| working.md（工作记忆草稿） | 500 字符（空则跳过） |

**被预算截断时必须说出来（2026-09-18 起）**：`clip(text, maxChars)` 在截断处追加
`……［截断：全文 N 字符，此处非全文，用 read/grep 取原文件］`，**N 是原文长度**。

- **为什么不能用结尾的 `…` 代替**：散文本来就常以省略号结尾（审计的人读摘要里就有 `names}${count > 3 ? " …" : ""}` 这种写法），所以「以 `…` 结尾」**区分不了**"被预算截断"与"原文如此"。而把残片当完整证据，比没有证据更糟——WikiSkill（arXiv:2608.27454 Appendix C）对每条注入日志的上限写法就是显式的 `[TRUNCATED: …]`，而不是靠一个省略号。
- **代价**：标记不计入预算（内容仍是 `maxChars`，标记是固定长度追加），因此**不会**因为这条改动而缩小任何一层的实际内容；`clip` 原有的 `…` 结尾保留，读旧格式的读者不受影响。
- **注意边界**：`note_tools` 的检索片段（snippet）**不适用**这条——片段是围绕查询词的短窗口，而它读到的 passage 在 `composePassage` 里**已经**被截到 800–2000 字符，**原始长度在那里已经不可知**，无法做一个诚实的标记（试过两种实现，都无法区分，已放弃并在 `tests` 里不留假断言）。那里的诚实做法是**说清片段的性质**（工具描述里写明"snippets are short WINDOWS around the query terms, not the full card"），而不是给一个可能撒谎的标记。

静态索引即“导航层”（告诉模型有什么）；相关内容按需用 `note_recall` 拉取（检索 v3 S5，不再逐轮注入召回段）。截断策略：`clip()` 从头截断（episodes 保留尾部）。

### 3.1 档位（`budget`：compact / standard / rich）

上表是 **`standard`**，也就是**没有选择档位时的行为**——`BUDGET_TIERS.standard` 与上表逐个数字相同（有断言钉住这条否定性性质：仅仅提供一个选择，不能改变没有选择的人的行为）。`compact` 各项更小，`rich` 更大；三档以 `profile/topics/records/templates/episodes/inbox/dialogue` 七个键对齐。

**优先级**（`budgetsFor`）：**显式 preset 配置 > 库内 `.deepseek/config.md` 的 `budget` > `standard`**。库内那一层由设置页写入（`setMemoryBudget`），因为 preset 配置文件 `agent.cordis.yml` 是构建产物、插件没有写它的通道。无法识别的档位**保持字段缺失**（而不是钉成 `standard`），好让 preset 配置继续生效。

**它限制什么**：只有**导航层**——即"有哪些主题 / 记录 / 模板 / 事件索引"。**不限制正文**：答案内容由 `note_recall` 现场检索读出，不受此预算约束。所以导航被截断的后果是"模型可能想不起来去查"，不是"答案丢了"。

**实测（2026-09-17，真实库）**：三档实际注入 **7864 / 8250 / 8890** 字符，硬上限 `MAX_TOTAL_MEMORY_CHARS = 18000`。**三档几乎无差别**，因为除 `episodes/index.md`（2647 字符 / 预算 1200，保尾部）外所有导航文件都没超预算。库变大或事件时间线变长后档位才有实际差别。

## 4. 检索路由（AGENTS.md §5）

粗到细的路由规则，核心是“注入的是导航，证据在磁盘”：

- 关键词/tag 找笔记 → `note_search`；反链 → `note_links`；
- v3（检索重构，见 retrieval-v3.md）：统一入口 `note_recall`——BM25 对笔记+全部记忆层一次排序，kind-aware passage，空结果/重试协议；hook 命中带 verified/success_rate/uses + 新近度先验（promote/demote + recency，`hookPrior`）；注入层只保留导航（S5 已移除逐轮召回段）；
- 策略层（见 strategy-layer.md）：`note_strategy`——方法层检索（difficulty 主匹配 + BM25 对 difficulty/move/abstraction 打分），证明/构造类问题先查策略卡拿到「困难→策略→检索目标」清单，再按清单逐步 `note_recall`（iterative retrieval，≤4 步）；
- **隐藏目录限制**：Obsidian 的 vault 索引排除所有点号开头的路径段（已核对 1.13.7 源码），`.deepseek` 文件无法经 openLinkText/TFile 打开——记忆面板点击卡片走插件内预览 Modal。
- 精确事实/原话/日期 → grep episodes → 读命中文件；
- 类型化事实 → records/index → grep/读记录 → `source` 回证据；
- 定理 → theorems/index → grep 全文 → 展开定义、核对适用性；
- 同类题型 → 问题蒸馏 → templates/index → 读模板卡与关联定理（去重聚合）。

### 4.1 依据（`depends_on`）与决策指导（`decision_guidance`）

两个**可选**卡片字段，都属内容层（模型维护，见 §5.1 所有权表）：

- **`depends_on: ['[[卡]]', …]`**——**有方向**的"本卡建立在这些卡之上"。与无方向的 `related`（另见）区别不在格式，而在**能不能回答一个具体问题**：某张卡被标 `superseded` 或被标 ❌ 之后，**哪些卡是踩在它上面的、需要重读**。
  - 体检据此产出「**下游待复查**」段（`sections.downstreamReview` / `structural.downstream`），**两端都点名**并给出变动原因。
  - **只报不改**：依据被改写后下游是否仍成立，只有读原文才能判断（与 `usesMismatch` 同一条纪律）。
  - **只报直接下游，不追传递链**（A←B←C 中 A 失效只报 B）：追下去需要置信度传播模型，而对人是噪音；C 会在 B 自己被标记时再被报出。
  - 无方向的 `related` **不参与**级联——把它当依赖会让清单立刻失去可信度（有断言守住）。
- **`decision_guidance: { prefer: "…", avoid: "…" }`**——**成对**的对比指导（各一行，多条用 `;`/`；` 分隔），`note_strategy` 渲染成「✔ 建议 / ✘ 避免」。理由：只写"该怎么做"记不住教训；成对写出"该做 / 该避免"才能把一次失败固化成可迁移的判断。**用单行字符串而非嵌套数组**是刻意的——避开内联 flow 列表陷阱（`[a b]` 会被解析成**一个** token）。

### 4.2 `status` 是权限，不只是标签

`note_strategy` 把结果**按状态分两组**返回：

- `matches`——现在**可依据**的卡（`status: active` **或未声明 status**）；
- `candidates`——`status: candidate` 的卡，单独列出并标明"可以把 moves 当线索试用，但**不得当作已验证技巧引用**"。

**只有显式声明的 `candidate` 才被分流**；status 缺失或取值未知的卡**留在 `matches`**——因为体检读的是 `meta.status ?? "active"`，在这里静默把老卡降级会**改变模型被允许依赖什么**，而"权限只在该库真的声明了的地方收窄"才是可预期的规则（有断言守住这条差异）。

晋级（`candidate → active`）有两道门：① `uses ≥ 3` 且 `success_rate ≥ 0.6`；② **接地门**——候选若无可用 `source`，即使达标也**不晋升**，并被点名进 `structuralDetail.promoteBlocked`（措辞写明"补上 source 后会自行晋升"）。接地门**只能因缺来源而阻断，绝不额外索要字段**，否则会索要诚实卡片本就不该有的字段、把它们变成永远无法晋升。

## 5. 写回协议（三写，模型执行）
每轮收尾**按需**三写（细→粗；无新信息全跳过）：

1. episode：出现新事实/决定/想法/修正才追加当天事件卡（原话保留）；
2. records：提炼原子卡并调和（相同更新、冲突 superseded、`source` 必指 episode）；
3. topics/profile/theorems/templates：仅局部更新，禁止整段总结进 prompt 层。

执行纪律：同一轮记忆写入合并为最少工具调用；完成后只在回复末尾一行说明（“已记录：N 条”）。

### 5.1 字段所有权（谁有权写哪个字段）

三写协议是**模型执行**的，但并非卡片上的每个字段都归模型。所有权必须显式，否则「模型手改统计数字」与「插件回写」会互相覆盖而无人察觉。**所有权以本表为准**（模板里的措辞是它的面向用户副本）：

| 字段 | 所有者 | 模型可否写 | 说明 |
|---|---|---|---|
| 正文、`title`、`type`、`topic`、`related`、`source` | **模型** | 可写 | 内容与溯源，三写协议维护 |
| `hook.operator` / `pattern` / `heuristics` / `quantity` / `techniques` / `applications` | **模型** | 可写 | 创建时填、reinforce 时追加；**不得编造** |
| `not_applicable_when`（适用边界） | **模型** | 可写 | 短句/关键词列表，每条 ≤12 字（检索按精确匹配用它做硬门控） |
| `confidence`、`status`（`active`/`superseded`） | **模型** | 可写 | 调和与置信维护 |
| `hook.verified` | **受约束** | 只能写 `single-source` | 升级到 `cross-referenced` / `user-confirmed` 必须用户参与 |
| `hook.uses` / `success_rate` / `last_used` / `harmed` | **插件** | **不可写** | `note_recall` 命中计数 → `cache/retrieval-stats.json` → 每日体检回写 |
| `hook.gain` | **插件** | **不可写** | **结果裁决**（−1/0/+1），只由显式 ✅/❌ 推出；**不受 `maintainHookStats` 开关影响**（它是结果不是使用统计）。缺席＝0＝「尚无裁决」 |
| `hook.verified_by` | **插件（仅 ✅ 反馈路径）** | **不可写** | 升级凭据；**唯一写入者**是用户点 ✅（`memory-admin.mjs` 的 feedback 路径） |
| `needs_review` | **插件（❌ 反馈路径）** | **不可写** | ❌ 置 `true`、✅ 清 `false` |

**数据流**：`note_recall` 命中 → 写 `cache/retrieval-stats.json`（`note-tools.mjs`）→ 每日体检合并进卡片的 `uses`/`last_used`（`math-memory.mjs`）→ 体检**读回文件校验回写是否落地**，未落地则记入 `structural.usesMismatch`（事后校验，**不自动重试**：静默改写用户的文件比报出来更糟）→ 排序时由 `hookPrior` 消费。

**两条守卫**（都在每日体检里）：

1. **越权升级**：`verified` 高于 `single-source` 却缺 `verified_by: user` ⇒ 记入 `structural.unjustifiedUpgrade`。
2. **脏值免疫**：插件专有字段尽管「模型不可写」，仍是从**用户可编辑的 markdown** 里解析出来的文本，因此是**不可信输入**。`hookPrior` 对 `success_rate`/`uses`/`gain`/`last_used` 每项钳制取值、并对最终结果整体钳制到 `[0,1]`——手改 `success_rate: 5`、`uses: -3` 或 `gain: 99` 不能把先验推出 BM25 混合所假设的量纲（`scripts/test-memory.mjs` 有断言，且做过变异验证）。量纲内的取值行为不变，因此既有排序不会移动。

**为什么需要 `gain`（而 `uses` 不够）**：`uses` 数的是**被检索出来**的次数，不是**帮上忙**的次数——被检索 20 次、其中 18 次读了就弃用的卡，和一个真解决了 20 个问题的卡，在 `uses` 上完全一样。`harmed` 只进体检报告、**不参与排序**，且是单侧计数（表达不了净收益）。`gain` 补上这一格：**带符号**的裁决，且**负值会把卡压到未评级卡之下**。它只由用户显式反馈推出（❌ ⇒ −1、✅ ⇒ +1、无反馈或缺席 ⇒ 0 中性），**刻意不把「用户继续追问」当负分**（追问可能只是好奇，噪音负分比没有负分更糟）。权重从「使用次数」里划出（`0.25 → 0.15 + 0.10`），总量不变、可回退。

## 6. 备忘录生命周期与提醒

- 捕获档位（1c）：以 `.deepseek/capture-policy.md` 为准——`idea` 档 ask（默认）先问、auto 直接写、off 不主动捕捉；事实/偏好同理（`fact`/`preference` 档，默认 auto，即三写协议原节奏）；用户在 Obsidian 插件设置页可直接改档（三个下拉框写回文件），面板编辑与文件直改等效；
- 捕获：识别到“一般性数学思路/方法/技巧/观点”时回复末尾给 `💡 可捕捉的想法`，ask_user 征得同意才写；新想法与已有 memo 高度相关则并入、中度相关加 related 双链、独立新建。
- 提醒候选（插件确定性扫描）：陈旧（inbox > 7 天、polishing > 3 天）**或与当前消息相关（relevance ≥ 0.15）**且今天未提醒，按 0.7×相关性 + 0.3×新鲜度 排序取 top3 注入；模型在相关讨论时给 `🔔 备忘录提醒` 并 ask_user，每天每条最多一次（`last_reminded`）。
- 状态流转 inbox→polishing→done 更新 index；done 的升华内容写入正式笔记前仍需询问。

## 7. 跨会话线索（dialogue index）

- 扫描 `$DSH_HOME/sessions/**/*.jsonl.zstd` 最近 20 个**会话**（递归、mtime 倒序），**只保留 cwd 位于本 vault 内的会话**（其他工作区的会话不进索引）；
  - **一个会话 = 一份日志**：dsh ≥ 0.1.5 的会话格式 V3 会为同一会话生成 `session.v3.jsonl.zstd` 并保留 V2 原件，两份都以 `.jsonl.zstd` 结尾。`findSessionLogs` 在排序后、切片前按 `sessionLogKey` 折叠（`selectAuthoritativeLogs`，**显式优先 `.v3.` 变体**，其次 mtime 新者），所以 `maxFiles` 计的是会话数而不是文件数。详见 [../dsh-0.1.5-adaptation.md](../dsh-0.1.5-adaptation.md)。
- zstd 拼接帧手动解析（Node ≥22.5 `zlib.zstdDecompressSync`；V2/V3 帧格式相同、无字典），只取 `source.kind === "user"` 的真实用户消息；
  - V3 没有逐块流事件（`assistant/chunk` 等改为 `assistant/message.data.stream[]`），读取方依赖的 `user/message` / `assistant/message` / `session/title` 事件名与内容块结构均未变，因此蒸馏逻辑与两个版本共用。
- 每条用户消息配该轮**最后一条** assistant 回复（下一用户消息前最后一条 assistant）组成问答对，时间正序、取最近 maxHistoryEntries 条、字符预算 maxHistoryChars；
- 缓存：进程内 + `cache/dialogue-index.json`（fingerprint = path|mtime|size 列表），组装时排除当前会话 id。

## 8. 生命周期维护（宿主插件）

- agent 无删除/移动工具；>90 天 episode 由 Obsidian 插件启动时移入 `episodes/archive/` 并更新 index（可配置关闭/手动触发）；
- v2 新增：记忆体检报告由 math-memory 插件确定性扫描生成（≤每天一次），见 v2-proposal §3；报告现含 strong/weak/unused/unverified + 结构校验 + **反模式（失败经验）** + **低效用归档候选（0.5×可靠性+0.3×频次+0.2×新近度）** + **检索健康（note_recall 空结果率）**。

### 8.1 体检台账（`cache/audit-ledger.jsonl`，**已实现**）

> **来源与理由**：WikiSkill（arXiv:2608.27454 §3.2.4）把每条技能改动的 **diff + 验证分 + Accept/Reject** 程序化追加成一份**永不回滚**的审计台账 `skill-impact.md`，用途之一是**"被拒过的干预不再重复提出"**。我们的对应缺口是：**同一张卡可以连续几天被体检报出，而"上次为什么决定不动它"没有任何地方记录**——下一天（或下一个 agent）从零重新判断一遍。

- **文件**：`.deepseek/cache/audit-ledger.jsonl`，**append-only**、每行一个 JSON 对象、**只由体检写**（模型不可写、不可删）。与 `cache/memory-audit.json`（会被整份覆盖）的分工：报告是**本次快照**，台账是**跨次的判定史**。
- **每行的字段**：`{ at（ISO 时间）, today（本地日期）, object（卡或卡对，卡对形如 a|b）, action（建议动作的机器标签）, criterion（哪条判据）, evidence（该判据的可核数字）, firstSeen（首次出现的日期）, count（含本次共出现几次） }`。
- **身份（identity）= `signature` = `object` + `action` + `criterion` 的稳定序列化**，**不含 `evidence` 的数值**。因此"同一张卡、同一判据、同一条建议"跨天只算**一次事件的延续**（`firstSeen` 不变、`count` 递增），而"同一张卡换了一条判据"是**新事件**。这样做是刻意的：把数值放进身份会让每天的数字波动制造出一堆假新事件。
- **写入的量**：每次体检对**当前需要动作的条目**各写一行，按 `signature` 去重后**总量上限 200**（超出时按既有顺序截断，并在 `warnings` 里说明被截断）。文件另有 2000 行上限（超出丢弃最旧的行）。两个上限都是**有界性**要求：台账不能长成第二个无界知识库（WikiSkill 的自陈短板正是"wiki 无裁剪机制"）。
- **反向回执（只报事实）**：体检把**今天首次出现**的条目与**已有历史**的条目分开报，历史条目只带 `firstSeen`/`count` 两个数字，**不要求任何具体动作**。理由是双向的：① 对历史上的条目，"又报一次"与"它长期没被处理"是两种不同的信息，混在一起会让人以为每天都有新问题；② 不做任何"自动关闭/自动视为已处理"——台账**只记录**，判定归用户与模型（插件不调模型是设计红线）。
- **反馈会改写统计、从而改变身份**：`note_recall` 命中或 ✅/❌ 反馈会改 `uses`/`success_rate`/`status`，一张卡可能因此**离开** weak 段（换判据或不再出现）。这是**期望的行为**：它意味着"这条建议已被数据追认"。若希望某条建议永久留痕，留痕的是**台账那一行**，不是卡的状态。
- **一致性校验（防"数字与列表互相矛盾"）**：weak 判据是 `successRate ≤ 0.4 且 uses ≥ 3`，因此 weak 段里的卡**不应**出现 `uses === 0` 或 `success_rate` 接近零的形态。体检对 weak 段做一次**确定性自检**，发现不一致就记入 `warnings`（`status: degraded`）——这是"两份真相源必须互相守卫"在本模块的落地，而不是等读者发现。
  - **配套（2026-09-18，实现时发现）**：`sections` 里的条目由 `cardRef()` 投影，而它原先**只带 `rel`/`title`/`gain`**——于是这条自检读到的 `uses`/`successRate` 是 `undefined`，**在每张 weak 卡上都会触发**，台账里也写出了 `uses=undefined`。这属于本仓库反复出现的形态：**守卫看不见自己的输入**。已让 `cardRef()` 带上 `uses`/`successRate`（多带两个字段，面板与套件都能直接读，不必再回读文件），自检因此变成真判据。
- **状态**：**已实现**（`dsh/preset/math-memory.mjs`；写入随体检、开关 `auditMaintainLedger` 与 `autoArchive` 同形，默认开）。**未做**（有意）：台账的**渲染**（面板/CLI 目前不显示它）、把"首次出现"接进面板的「⚠️ 待处理」计数、按天数升级提醒强度。

### 8.2 索引行说明下限（**已实现**）

> **来源与理由**：WikiSkill（arXiv:2608.27454 Appendix E.2）把「每条模式一行」的索引称为**全库最重要的一处**，因为它**决定读者要不要打开整页**，并要求每行写全 **PROBLEM + ROOT CAUSE + FIX**。我们的索引行本来就是 `- [[stem|一句话]] · topic · updated: YYYY-MM-DD`，但**没有任何东西检查那句"一句话"说了什么**——`- [[x]]` 与 `- [[x|?]]` 都能满足"这张卡在索引里"，却对读者毫无信息。

- **检查什么**：体检对 `records/`、`templates/`、`strategy/` 三层的 `index.md` 逐行判定，描述**下限 `AUDIT_INDEX_DESC_MIN = 8` 字符**；不达标的卡进入 `structural.indexWeak`，清单里点名并写明该写什么（什么困难 + 为什么有效 + 具体怎么做）。
- **只查什么**：**只查长度，不查语义**。机器判不了"这句话有没有解释为什么"，但判得了"描述是空的/只有一个字"，本检查**只声明后者**。措辞质量归模型（因此：只报告、不自动改写）。
- **描述的边界（易错处，2026-09-18 由自己的断言抓出两处实现 bug）**：描述**只取链接的显示文本**（`[[stem|这里]]`）。两个反例：① 把链接之后的 `· topic · updated: …` 也算作描述 ⇒ 元数据把长度凑够，`- [[rec-thin|?]] · 数论 · updated: 2026-01-01` 因此漏检；② 把 `]]` 计入长度 ⇒ 一个字符的描述被算成三个字符。两处都已修，并各有一条断言。
- **不重复报**：一张卡**不会**同时被列为"未入索引"与"索引行过弱"——后者已经说明它**在**索引里（一条发现只报一次）。
- **另一条更硬的 finding**：行首不是 `[[` 链接的行（例如写成了 markdown 链接或纯文本）进入 `structural.indexNotAnEntry`——读者与旧解析器都从链接里取 stem，形式不对的卡**按名字找不到**，即便它"在索引里"。
- **状态**：**已实现**（`dsh/preset/math-memory.mjs` 的 `indexDescriptionIssue` + `buildAuditReport`；模板纪律写在 `records-readme.md` / `strategy-readme.md`）。**未做**（有意）：修好后的自动重排、面板单列一段、把上限也做成可配置。

### 8.3 破坏性写入：原子替换 + 失败要报（**已实现**，2026-09-18）

> **来源**：WikiSkill（arXiv:2608.27454）用 `skills_staging/` + `skills_checkpoint/` + 原子 `rename` 保证"被否决或中断的更新不会毁掉已接受的东西"。它自己有一处实现缺陷值得记下来当反面教材：它每次构造工作区都用**当前磁盘状态**覆盖 known-good 快照，于是崩溃后的中间态会被"追认"成 good——**我们要的是反向语义：只有显式成功才更新可信状态。**

- **`writeFileAtomic(path, content)`**：写 `<path>.tmp` → **读回校验** → 备份旧内容到 `<path>.bak` → `renameSync` 原子替换 → 再读回校验。任一步失败 ⇒ 删掉自己的临时文件、**原文件一字不动**、返回 `{ok:false, reason}`。读回校验是刻意的：满盘或只读挂载会在**原文件还完好时**就暴露出来。
- **回滚语义**：只有 `rename` 成功才改变用户文件；`.bak` 是**上一步**的内容，不是"第一个版本"。**不设** known-good 快照——我们改的是用户可编辑的 markdown，不是可重建的生成物，多一层快照只会带来"哪份才算数"的歧义。
- **失败必须进报告**：`moveCardsToArchive` 现在返回 `{moved, failures}`（旧版把每一个错误都吞掉：`catch { /* leave in place */ }`），失败项进 `warnings` 并让 `status: degraded`，同时出现在 `postconditions.archiveFailures`。"自动归档 3 张"是一句**声明**，声明必须能被证伪。
- **卡片移动与索引改写是两个动作**：卡片先移（`rename`），索引再改（原子 + 校验）。索引失败时**卡片已经在 archive 里**——报告写明"卡片已移动，可据 `.bak` 修复"，而不是假装整件事失败或整件事成功。
- **状态**：**已实现**（`writeFileAtomic` / `moveCardsToArchive` + `postconditions.archiveFailures`；断言 3 项原子写 + 2 项归档降级）。**未做**（有意）：给用户可编辑的卡片正文也加同样的原子写（正文写入由模型的 `edit`/`write` 走 `ctx.fs`，非本插件职责）；`.bak` 的自动清理与保留策略。

## 9. 安全边界（fail-closed）

- 工具面：文件读写/搜索 + 五个笔记工具（note_recall / note_strategy / note_search / note_create / note_links）+ ask_user；无 shell/web/subagent；
- 写操作被 workspace-write 沙箱限制在 vault 内，交互提权默认禁用（`approval: never`）；
- 插件自身唯一写的文件在 `cache/`；一切记忆变更走 ctx.fs，无裸 fs 旁路。

## 10. 已知局限（详见 assessment.md）

检索为纯 BM25 词法（无 embedding，语义召回靠 Tier B 可选后端、暂未启用）；三写协议仍依赖模型自律（体检提供 records 的结构校验兜底，但内容质量仍靠 prompt）；记忆架构处于 prototype 阶段、无长期 field testing；记忆面板有两套入口：Obsidian 侧 ItemView（浏览/搜索/编辑/反馈/归档）与 dsh web 的 `settings.section` 面板（`dsh/client-panel/`，主 dsh web 3080 上使用）。

纠错链路（0.7.2 起，详见 `self-correction.md`）：① `superseded` / `duplicate_of` 卡在 `note_recall` 中**已排除**；② `❌` 反馈**已**把 `success_rate` 封顶 0.35 并降一级 `verified`（写 `needs_review`/`last_wrong`）；③ `hookPrior` 检索权重**已**从 5% 提到 15%（`verified`/`success_rate` 对排序影响 ≈10%）；④ 语义对错**仍无全自动确定性校验**——体检新增「待重审」清单（确定性检测 + 模型读 `source` 证据链执行），但内容正确性的最终判断仍依赖模型与用户反馈（插件不调模型是设计红线）。