# 记忆系统当前设计（实现规格）

> 当前版本：0.8.1
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

### 2.1 知识层与产物层是分开的，且**知识层不因产物失效而消失**（设计正当性，2026-09-18 补）

> **外部论据**：WikiSkill（arXiv:2608.27454 §3.1）把它自己的工作区**物理分成三层**——`raw/`（不可变执行轨迹）、`wiki/`（持久、复利、**永不回滚**的知识）、`skills/`（可执行产物，可被门控回滚）；消融显示**拿掉持久知识累积会掉 15.0 分**（48.7 → 63.7），而把知识层开放给执行者反而掉 2.8 分。它的核心主张是「**学到的东西要有一个独立的表示**，不能只留在产物里」。

我们有同样的分离，只是此前**没有把它写成原则**：

| | 知识层（长期、不随某张卡失效而消失） | 产物层（可晋升/降级/重写） |
|---|---|---|
| 层 | `records/`（原子事实与技巧）、`topics/`、`theorems/`、`notation.md`、`profile.md` | `strategy/<slug>.md`（困难→策略→检索目标）、`memory/templates/` |
| 谁在用 | 检索注入 + `note_recall` | `note_strategy` 按需检索，不逐轮注入 |
| 失效语义 | `superseded`（保留证据与 source 链，**不删除**）；`archive/` 可找回 | `candidate → active` 晋升、连续失败降级、边界被反馈收窄 |

**三条落地推论**（都是既有实现，这里只是把理由写明）：

1. **`superseded` 而非删除**：知识层的一条被推翻，是"又一条证据"，不是"可以抹掉的历史"——与 WikiSkill 的"wiki 永不回滚"同向；也与 Danus/GraphMemix/MSCE 三处独立结论一致（低价值材料仍保留作反证据）。
2. **策略卡改写不该带走支撑它的事实**：产物层的方法卡可以重写甚至重建，但它引用的事实（`theorems`/`notation`/`records`）留在知识层，因此"从这个方法退回来"不丢信息。
3. **两边各自有写入纪律**：知识层由三写协议维护（`source` 必指 episode），产物层额外有晋升门（`uses ≥ 3` 且 `success_rate ≥ 0.6` + 接地门）与**状态即权限**（`candidate` 只能当线索）。

**我们刻意不学它的一点**：它在训练期**禁止执行者读知识层**（-2.8 分的实测），因为它的度量是"技能本身够不够好"；我们的度量是"这一轮答得对不对"，所以**全注入是有意的**。要保留的是它的**判据**：凡让模型直接在会话里读原始素材的动作，都会降低**蒸馏产物**的质量——因此我们反对把 `episodes/` 原文塞进上下文，而不是反对注入 `topics/notation`。

## 3. 注入预算（`math-memory.mjs` 常量）

| 段 | 预算 |
|---|---|
| profile | 4000 字符 |
| notation（记号体系） | 800 字符 |
| topics index | 1800 字符 |
| records index（尾部最新行） | 800 字符 |
| templates index（尾部最新行） | 600 字符 |
| episodes index（尾部最新行） | 1200 字符 |
| inbox digest（含提醒候选） | 1200 字符 |
| 跨会话问答线索 | 最多 6 组 / 3000 字符 |
| 记忆体检报告（v2） | 1200 字符 |
| working.md（工作记忆草稿） | 500 字符（空则跳过） |

**被预算截断时必须说出来（2026-09-18 起；2026-09-21 扩为「头 + 尾」）**：`clip(text, maxChars)` 在截断处插入
`……［截断：省略 M 字符，全文 N 字符，此处非全文，用 read/grep 取原文件］`，**N 是原文长度、M 是被略去的字符数**。

- **为什么不能用结尾的 `…` 代替**：散文本来就常以省略号结尾（审计的人读摘要里就有 `names}${count > 3 ? " …" : ""}` 这种写法），所以「以 `…` 结尾」**区分不了**"被预算截断"与"原文如此"。而把残片当完整证据，比没有证据更糟——WikiSkill（arXiv:2608.27454 Appendix C）对每条注入日志的上限写法就是显式的 `[TRUNCATED: …]`，而不是靠一个省略号。
- **为什么两端都保（2026-09-21）**：原来只保头部，这在**方向上**是错的，而且错得**没有任何测试看得见**——本仓库所有夹具都远低于各自预算，`clip` 从不触发（实测 `scripts/qa/benchmark-vault` 的整段注入是 **4088 字符、零截断**）。用「增长型」夹具重建后立刻现形：40 条 records 索引行对 800 预算，**保住了 `rec-1`、丢掉了 `rec-40`**；5033 字符的 `topics/index.md` 保住了 `alpha`、丢掉了 `omega`。两个方向各有不可替代的作用——**头部**是定义性的（身份、记号约定），**尾部**是自上次读取以来唯一变化的部分（本库的写入协议是 append-only、新的在下方）。只保一侧必然是另一侧的静默丢失。
- **ASCII 边界才裁词**：`clip` 只在边界字符是 ASCII 时回退到词边界。数学 vault 的正文以 CJK 为主，那里没有词边界，裁了就是从词中间咬掉几个字——正是这条标记要防的「读起来像完整证据的残片」。
- **代价**：标记不计入预算（内容仍是 `maxChars`，标记是固定长度追加），因此**不会**因为这条改动而缩小任何一层的实际内容；`clip` 原有的 `…` 结尾保留，读旧格式的读者不受影响。标记变长会让被截断的段落**总长**略增（多出的是标记本身）。
- **注意边界**：`note_tools` 的检索片段（snippet）**不适用**这条——片段是围绕查询词的短窗口，而它读到的 passage 在 `composePassage` 里**已经**被截到 800–2000 字符，**原始长度在那里已经不可知**，无法做一个诚实的标记（试过两种实现，都无法区分，已放弃并在 `tests` 里不留假断言）。那里的诚实做法是**说清片段的性质**（工具描述里写明"snippets are short WINDOWS around the query terms, not the full card"），而不是给一个可能撒谎的标记。

静态索引即“导航层”（告诉模型有什么）；相关内容按需用 `note_recall` 拉取（检索 v3 S5，不再逐轮注入召回段）。截断策略：`clip()` **头尾都保**；三个 append-only 层索引（records/templates/episodes）由同一个 `appendOnlyIndexDigest` **按行保尾部**——它们曾有两份各自为政的实现，而其中两份是**头截断**（见上一条的实测数字）。

### 3.1 档位（`budget`：compact / standard / rich）

上表是 **`standard`**，也就是**没有选择档位时的行为**——`BUDGET_TIERS.standard` 与上表逐个数字相同（有断言钉住这条否定性性质：仅仅提供一个选择，不能改变没有选择的人的行为）。`compact` 各项更小，`rich` 更大；三档以 `profile/notation/topics/records/templates/episodes/inbox/dialogue` **八个键**对齐。`notation` 是 2026-09-21 补进表的：它此前是读取点上的硬编码 800，于是档位旋钮**管不到它**（`standard` 取值不变，仍是 800）。

**优先级**（`budgetsFor`）：**显式 preset 配置 > 库内 `.deepseek/config.md` 的 `budget` > `standard`**。库内那一层由设置页写入（`setMemoryBudget`），因为 preset 配置文件 `agent.cordis.yml` 是构建产物、插件没有写它的通道。无法识别的档位**保持字段缺失**（而不是钉成 `standard`），好让 preset 配置继续生效。

**它限制什么**：只有**导航层**——即"有哪些主题 / 记录 / 模板 / 事件索引"。**不限制正文**：答案内容由 `note_recall` 现场检索读出，不受此预算约束。所以导航被截断的后果是"模型可能想不起来去查"，不是"答案丢了"。

**实测（2026-09-17，真实库）**：三档实际注入 **7864 / 8250 / 8890** 字符，硬上限 `MAX_TOTAL_MEMORY_CHARS = 18000`。**三档几乎无差别**，因为除 `episodes/index.md`（2647 字符 / 预算 1200，保尾部）外所有导航文件都没超预算。库变大或事件时间线变长后档位才有实际差别。

## 4. 检索路由（AGENTS.md §5）

粗到细的路由规则，核心是“注入的是导航，证据在磁盘”：

- 关键词/tag 找笔记 → `note_recall`（带 `query`+`tag` = 在带该 tag 的笔记里排序检索；**只给 `tag` 不给 `query`** = 枚举该 tag 下的笔记，按 `updated` 降序、不计相关性）；反链 → `note_links`；（`note_search` 已于 2026-09-20 退役，详见 retrieval-v3.md §5.1）
- v3（检索重构，见 retrieval-v3.md）：统一入口 `note_recall`——BM25 对笔记+全部记忆层一次排序，kind-aware passage，空结果/重试协议；hook 命中带 verified/success_rate/uses + 新近度先验（promote/demote + recency，`hookPrior`）；注入层只保留导航（S5 已移除逐轮召回段）；
- 策略层（见 strategy-layer.md）：`note_strategy`——方法层检索（difficulty 主匹配 + BM25 对 difficulty/move/abstraction 打分），证明/构造类问题先查策略卡拿到「困难→策略→检索目标」清单，再按清单逐步 `note_recall`（iterative retrieval，≤4 步）；
- **隐藏目录限制**：Obsidian 的 vault 索引排除所有点号开头的路径段（已核对 1.13.7 源码），`.deepseek` 文件无法经 openLinkText/TFile 打开——记忆面板点击卡片走插件内预览 Modal。
- 精确事实/原话/日期 → `note_recall` 先定位（记忆卡/episode 索引/主题）再读命中文件；确认「某文件里是否真有这句话」时才在该文件上 grep；
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
| `origin`（**顶格**，不在 hook 块内） | **插件（每日体检）** | **不可写** | **来源**：谁写了这张卡（`agent` / `user` / `imported`；缺席＝来源未知）。见 §5.2 |
| `needs_review` | **插件（❌ 反馈路径）** | **不可写** | ❌ 置 `true`、✅ 清 `false` |

**数据流**：`note_recall` 命中 → 写 `cache/retrieval-stats.json`（`note-tools.mjs`）→ 每日体检合并进卡片的 `uses`/`last_used`（`math-memory.mjs`）→ 体检**读回文件校验回写是否落地**，未落地则记入 `structural.usesMismatch`（事后校验，**不自动重试**：静默改写用户的文件比报出来更糟）→ 排序时由 `hookPrior` 消费。

**两条守卫**（都在每日体检里）：

1. **越权升级**：`verified` 高于 `single-source` 却缺 `verified_by: user` ⇒ 记入 `structural.unjustifiedUpgrade`。
2. **脏值免疫**：插件专有字段尽管「模型不可写」，仍是从**用户可编辑的 markdown** 里解析出来的文本，因此是**不可信输入**。`hookPrior` 对 `success_rate`/`uses`/`gain`/`last_used` 每项钳制取值、并对最终结果整体钳制到 `[0,1]`——手改 `success_rate: 5`、`uses: -3` 或 `gain: 99` 不能把先验推出 BM25 混合所假设的量纲（`scripts/test-memory.mjs` 有断言，且做过变异验证）。量纲内的取值行为不变，因此既有排序不会移动。

### 5.2 来源（`origin`）与验证等级是**两件事**（2026-10-01 新增，C7/N1）

> **来源与理由**：Louck（arXiv:2606.34591）机检证明「以内容、或以内容可导出的血缘边为判决依据的可信度信号可被洗白」（T1），要求「写入时绑来源 + 独立共证」（T3）。我们的 `hook.verified` 是**标签**——任何人（含模型）都能打；它回答的是「验过没有」，而用户真正需要的另一半「**这话是谁说的**」此前根本没有被记录。四篇文献的跨论文评估见 [`../../literature/notes/memory-fidelity-papers-2026-10-01.md`](../../literature/notes/memory-fidelity-papers-2026-10-01.md)，决策见 [`../pending-decisions-2026-09-26.md`](../pending-decisions-2026-09-26.md) §3.1 的 **C7=A**（只加字段 + 只显示不排序）。

- **字段**：卡片 frontmatter **顶格** `origin: agent | user | imported`；**缺席＝来源未知**（老卡不静默降级，照 §4.2 那条纪律）。
- **谁写**：**只有每日体检写**（开关 `auditMaintainOrigin`，默认开，与 `auditMaintainLedger` 同形）。模型不可写、不可改；用户手改会被**报告**（见下）而不会被覆盖——`verified_by` 那条「静默改写用户手写值是最忌」的规则在这里同样适用。
- **凭据在台账里**：`.deepseek/cache/card-origin.jsonl`，**只追加、只有体检写**，每行 `{ v, rel, firstSeen, origin, evidence, updated }`。`firstSeen` 是**宿主自己第一次见到这张卡的日期**——它是模型与文件都无法伪造的那一半（内容可以编，日期不行）。`evidence` 记这次判定从哪来：`memory-layer-path`（路径判定）/ `declared`（字段已在磁盘上）/ `external-edit`（与宿主记录不符）。写入是**幂等**的：值与原记录一致时不更新 `firstSeen`、也不改 `updated`（否则每天都会重写一遍，`updated` 会把"卡变过没有"这个信息抹掉）。
- **取值从哪来**：`AUDIT_CARD_DIRS` 扫的三层（`records/` / `templates/` / `strategy/`）是协议**保留给 agent** 的层，所以路径判定只会得出 `agent`；`imported` 与 `user` **不会被路径判出**。这不是遗漏：本库没有任何通道能区分"剪藏的文章"与"用户自己的散文"，硬猜就是 T1 点名的"用内容派生可信度"。
- **为什么永远不写 `user`**：本地 vault 是纯文本、无认证通道，Louck 的前提 A1（已认证通道）在这里**只能降级为通道推断**（该文献 §5.2 自己写明）。所以「这是用户原话」这种声明**无法被证实**，只能由用户本人确认——与 `verified` 的处理完全同形（`user-confirmed` 也只能由 ✅ 写入）。任何 `origin: user` 的声明进 `structural.unauthorizedOrigin`（照 `unjustifiedUpgrade` 的形状：**只报不改**）。
- **不改排序**：`origin` **不参与** `hookPrior`／`note_recall` 排序（C7=A 的明确定义）。理由与 P5②「单源老化降权」相同：排序是全局量，动它要过 `engine-probe` 的门槛，而加字段是纯增量；先把"谁说的"记下来，才谈得上按它调权。
- **它**不**解决的**：`origin` 只覆盖**体检扫得到的层**（即 AI 自己写的那些卡）。用户手写的笔记不在 `AUDIT_CARD_DIRS` 里，因此系统无法给用户的笔记盖来源章——**"你的笔记"这一侧仍然是靠层来区分的**，这条边界不要过度声称。


**为什么需要 `gain`（而 `uses` 不够）**：`uses` 数的是**被检索出来**的次数，不是**帮上忙**的次数——被检索 20 次、其中 18 次读了就弃用的卡，和一个真解决了 20 个问题的卡，在 `uses` 上完全一样。`harmed` 只进体检报告、**不参与排序**，且是单侧计数（表达不了净收益）。`gain` 补上这一格：**带符号**的裁决，且**负值会把卡压到未评级卡之下**。它只由用户显式反馈推出（❌ ⇒ −1、✅ ⇒ +1、无反馈或缺席 ⇒ 0 中性），**刻意不把「用户继续追问」当负分**（追问可能只是好奇，噪音负分比没有负分更糟）。权重从「使用次数」里划出（`0.25 → 0.15 + 0.10`），总量不变、可回退。

## 6. 备忘录生命周期与提醒

- 捕获档位（1c）：以 `.deepseek/capture-policy.md` 为准——`idea` 档 ask（默认）先问、auto 直接写、off 不主动捕捉；事实/偏好同理（`fact`/`preference` 档，默认 auto，即三写协议原节奏）；用户在 Obsidian 插件设置页可直接改档（三个下拉框写回文件），面板编辑与文件直改等效；
- 捕获：识别到“一般性数学思路/方法/技巧/观点”时回复末尾给 `💡 可捕捉的想法`，ask_user 征得同意才写；新想法与已有 memo 高度相关则并入、中度相关加 related 双链、独立新建。
- 提醒候选（插件确定性扫描）：陈旧（inbox > 7 天、polishing > 3 天）**或与当前消息相关（relevance ≥ 0.15）**且今天未提醒，按 0.7×相关性 + 0.3×新鲜度 排序取 top3 注入；模型在相关讨论时给 `🔔 备忘录提醒` 并 ask_user，每天每条最多一次（`last_reminded`）。
- 状态流转 inbox→polishing→done 更新 index；done 的升华内容写入正式笔记前仍需询问。

## 7. 跨会话线索（dialogue index）

- 扫描 `$DSH_HOME/sessions/**/*.jsonl.zstd` 最近 20 个**会话**（递归、mtime 倒序），**只保留 cwd 位于本 vault 内的会话**（其他工作区的会话不进索引）；
  - **一个会话 = 一份日志**：dsh 从 0.1.5 起每次格式迁移都会为同一会话生成**新代**日志并**保留旧代原件**（V2 → `session.v3.jsonl.zstd`、V3 → `session.v4.jsonl.zstd`），它们都以 `.jsonl.zstd` 结尾。`findSessionLogs` 在排序后、切片前按 `sessionLogKey` 折叠（`selectAuthoritativeLogs`），**先比世代号 `vN`（无标记 = 0，大者权威），mtime 只作同代兜底**，所以 `maxFiles` 计的是会话数而不是文件数。详见 [../dsh-0.1.7-adaptation.md](../dsh-0.1.7-adaptation.md)（V4）与 [../dsh-0.1.5-adaptation.md](../dsh-0.1.5-adaptation.md)（V3）。
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

### 8.4 卡片尺寸上限（**已实现**，2026-09-18）

> **来源**：WikiSkill（arXiv:2608.27454 Appendix E.2）把模式页**硬性限制在 10–30 行**，理由是"知识页一旦长成小作文就不再可用"。我们的模板一直写"原子化、不要整段对话总结"——**没有数字的纪律无法检查**，所以它从来只是建议。

- **上限**：正文（frontmatter 之后的非空行）**≤ `AUDIT_BODY_MAX_LINES = 20`**；策略卡 **move 数 ≤ `AUDIT_MAX_MOVES = 5`**（两个常量都在 `math-memory.mjs`）。
- **数字从哪来（不凭空定）**：先量了语料——种子 vault 的 records 正文 **7–8 行**、策略卡 **2–6 行**、move **≤ 3**。上限刻意**宽于**实测分布，目的是抓"囤积"，不是给正常写作添堵。
- **move 计数按原文**，**不是按正文**：`strategies:` 是 **frontmatter 字段**，move 写在头块里，`stripFrontmatter` 会把整块剥掉（第一版实现就是在正文上数，于是恒为 0；这是本轮第三个"由自己的断言/调试抓出来的实现错误"）。这条以前面那条 `cardRef` 缺字段的 bug 是同一族：**判据要能看见自己的输入**。
- **怎么报**：进 `structural.tooLong` / `structural.tooManyMoves`，清单里**说清该做什么**（拆成一到两张原子卡 / 把过程挪进 episode / 按触发条件排序并移出不触发的 move），**只报告不自动改**——拆卡需要判断，属于模型与用户的活。
- **状态**：**已实现**（`buildAuditReport` + 体检台账 `split-card` / `split-or-prioritize-moves`；模板纪律写在 `records-readme.md` 第 6 条与 `strategy-readme.md` 第 9 条）。**未做**（有意）：episode 与 topics/theorems 的同类上限（它们的形态不同，需要各自的分布数据）。

### 8.5 笔记范围：定理索引与载体笔记的**只读**审查（**已实现**，2026-09-18）

> **来源与理由**：在此之前，体检只扫 `records/` / `templates/` / `strategy/` 三层（`AUDIT_CARD_DIRS`），而**用户自己手写的笔记与 `theorems/index.md` 不在任何检查范围内**——这恰好是**唯一没有 verifier 的写入者**。真实实例（对真实 vault 的只读调研发现）：`theorems/index.md` 把 Cramér–Rao 登记为 `状态:已证`，而它的载体笔记自己写着"由 AI 依口述骨架撰写……不是我的原稿"，正文里还有一句"请勿当作已证"。**文内的诚实标记挡不住下游按索引使用**——索引是人和 agent 判断"这条能不能用"的入口，盖错章会被一直沿用。

- **`scanNoteClaims(root)`**（导出、有断言）：读 `theorems/index.md`，逐行取定理名与载体链接，产出**两类发现**：
  1. **`contradictions`**——索引说"已证"，但载体**自己不认可**：载体正文含 `待核对`/`待补`/`AI 补全`/`待证明`/`存疑`（这是**确定的事实**），或载体短于 `AUDIT_NOTE_STUB_CHARS = 120` 字（这是**明说的猜测**，措辞写"疑似存根"）。
  2. **`unresolved`**——索引指向的笔记不存在。既有的断链检查**只对 `records/` 生效**（`:1939` 那一行 `if (!card.rel.includes("/records/")) continue;`），所以索引里的悬空载体以前是**看不见**的。
- **只读**：不写任何文件、不改任何卡片、不产生台账以外的副作用（台账仍由既有机制写）。
- **`状态:引用` 不算"已证"**：它只声称"引自别处"，不声称 vault 内已证，因此载体里有 `待核对` **不构成矛盾**（有断言守住这条否定性性质）。
- **笔记名取行首标签、不取链接**：索引格式是 `- <定理名> · 领域:… · 状态:… · 讨论载体:[[载体]]`，第一版实现取链接的显示文本（这些行通常没有）或链接目标，于是**把发现命名成了载体而不是定理**——由门禁的断言抓出并修正。
- **漏报与误报的边界（实测教训）**：长度下限**不能**当作"存根"的证明——同一批调研里一篇 2,059 字、含完整证明与两个应用例的笔记曾被长度过滤误判为存根。因此这里只把它当"疑似"，且同一条发现只报一次。
- **扫描范围有界**：`listVaultNotes` 跳过 `.git` / `.obsidian` / `node_modules` / `.deepseek`（记忆树另行审计）与 `deploy-backup-…`（它是 `.deepseek/` 的**整份副本**，按 basename 解析 wikilink 会制造幻影同名目标）。
- **无论有没有记忆卡都报**：定理索引是用户自己的产物，可能先于任何记忆卡存在——第一版把这些发现放在"有卡片"分支里，被门禁断言抓出（新建库索引盖错章反而看不见）。
- **状态**：**已实现**（`scanNoteClaims` + `counts.noteClaims` / `counts.noteIndexUnresolved` / `sections.noteClaims` / `sections.noteIndexUnresolved` + `decisions.noteClaimCards`，进体检清单与人类摘要、进体检台账）。断言 335 → **345**（含变异验证：让 `contradictions` 恒为空 ⇒ 4 条断言红）。
- **未做（有意）**：不做 claim 级台账与内容指纹作废、不做数值反例、不做形式化——理由与方案见 `literature/notes/verification-framework-2026-09-18.md`（待拍板）。

#### 8.5.1 混写笔记：AI 补全段落（**已实现**，2026-10-01，N-a）

> **来源与理由**：用户问「如果有一些笔记是 AI 和用户混写的呢，比如 AI 在某篇用户笔记中补全了一些内容」。**文件级的 `origin`（§5.2）描述不了它**——一个 frontmatter 字段表达不了"同一篇笔记里第 3 段是 AI 补的、第 5 段是用户写的"。而按段**自动判定归属**不可行：那是语义判断（本模块红线：插件不调模型），且必然误报。**唯一出路是把协议早就要求的那件事接进系统**：`vault-AGENTS.md` §3 从 0.x 起就要求助手用 `<!-- AI 补全 -->` 标注自己补的内容，真实库实测**确实有人标**（`统计学/方法论/数据压缩.md`），但这个标记此前只在 §8.5 那条窄路（索引说已证 × 载体自认 AI 补全）上被消费过。

- **体检侧**：`scanNoteHygiene` 新增 `aiMarked` / `aiMarkedTotal`，**与 `noteGaps` 分开报**——未闭合是"待做的活"，AI 补全是"不是用户说的话"，动作不同；合在一处会让后者消失在"TODO 计数"里。识别用**一条**交替正则（`<!--\s*AI\s*补全\s*-->|AI\s*补全`，注释式在前）⇒ 字面 `<!-- AI 补全 -->` **只计一次**，裸写仍认得（与 `AUDIT_OPEN_MARKERS` 的词表一致）。
- **检索侧**：`buildRecallDoc` 给 `kind === "note"` 记 `aiCompletions`；`note_recall` 把 `［含 N 处 AI 补全·非用户原话］` **前缀到 snippet**。两条约束决定了这个落点：① **不能加字段**——match 项是 `additionalProperties: false`，多一个键会被 dsh 严格校验拒绝并打死整次调用（2026-09-14 的 `hook`/`boundary` 事故）；② **放 snippet 不放元数据行**——标记的含义是"**这段文字**里有不是用户写的部分"，读者看的正是 snippet。这与既有"归档"标签用同一条通道。
- **协议侧**：`vault-AGENTS.md` §3 把标记从一行注释扩成读写纪律（一段一个标记、放在段落**之前**；读到标记覆盖的段落按"笔记里的说法"引用；**用户删标记＝认可**，模型不得替用户删）。模型可见的工具描述只说一句行为，**不写标记语法**（`agent-experience` skill：描述行为而非实现）。
- **刻意不做**：**不检测"未标记的补全"**。检测风格突变属语义判断（红线）且会误报；漏标的责任写在协议里（"漏标就等于把 AI 写的话伪装成用户原话"）。
- **状态**：**已实现**（`scanNoteHygiene` 的 `aiMarked` + `sections.noteAiCompletions` / `counts.noteAiCompletions`；`note-tools.mjs` 的 `AI_COMPLETION_MARKER` / `aiCompletionCount` + `buildRecallDoc` 的 `aiCompletions`）。断言 **440 → 452**（12 条），含成对否定性断言（混写笔记有计数 / 全自写笔记不报；有前缀 / 干净笔记无前缀）与"match 项没有多出未声明字段"。变异验证：删掉 snippet 前缀 ⇒ 1 条红。

##### 8.5.1.1 检索侧的**临时标记**：`［…·不宜当结论］`（2026-10-01 追加）

> **来源与理由**：用户在 N-a 之后指出**真实症状**——"当我用插件助手讨论和这篇笔记相关的问题时，agent 的回复**总是极大地受这篇笔记影响，每次都给出差不多的回答**"。这不是排序错误（`note-interference-probe` 实测：它在 5/5 相关查询里 rank 1–2、**0/5 无关查询侵入**，排得准），而是 **experience-following**：高分命中被当成结论复述。仓库里其实早有这条失效形态的名字（`note_recall` 的描述写着 "a previously-successful technique can be a **fixation trap** on a slightly-different instance"），也早有针对**卡片层**的防御（`inbox/` 注入带「待打磨」、记录层被当作已沉淀）——**但用户自己的笔记两边都不占**，于是全库影响最强的文档不带任何"未定"标记。

- **做法**：`buildRecallDoc` 给 note 记 `aiCompletions` **与** `openMarkers`（`待核对`/`待补`/`待证明`/`存疑`，与体检既有的 gap 词表一致），`note_recall` 把两者**合并成一个**括号前缀到 snippet：`［AI 补全 ×11·待核对 ×14·不宜当结论］`。
- **为什么合并成一个括号**：两个计数给读者的裁决是同一句（"别当结论"），两个前缀会在 snippet 窗口里收两次费——第一版的长前缀（58 字符）吃掉约 19% 的窗口。**标记语法与判据写到工具描述／vault 协议，不写在结果里**（`agent-experience`：描述行为而非实现、同一事实说一次）。
- **工具描述同步一条行为**：见到该前缀 ⇒ 那些内容不是已沉淀知识，**重新推导而不是复述笔记**，也不得说成用户原话。
- **实测（真实库）**：那篇 61K 字符的笔记 `aiCompletions=11`、`openMarkers=14`，前缀现在出现在**每一次**取回它的结果里——**它自己第 6 行就写着的"不是我的原稿、两处待核对"，过去从不进检索语料（passage 只取正文前 1500 字符），现在在检索那一刻就被看到**。
- **不声称的**：这只**降低**"被复述为结论"的概率，不保证模型一定重新推导（模型行为不可由确定性层保证）。要彻底解决，仍需把"讨论存档"与"可引用的知识"分开（用户那篇的本质是**逐次追加型活文档**：§3.6/§3.7/§2.7/§1.6/§2.1.1 全是过去讨论的存档）。

### 8.6 `cross-referenced` 由插件确定性写入（**已实现**，2026-09-18）

> **来源与理由**：`cross-referenced`（与别处互证）的含义是「这份 vault 里另有一处说了同一件事」——**这是关于文件的事实，不是用户的口味**，所以要求用户点 ✅ 才给这一级，等于让用户做记账。代价是**结构性**的：每张新卡都从 `single-source` 起步，而**没有任何东西能把它升上去**，于是「单源超过 60 天」清单永远报同一批卡、唯一出路是逐张点 ✅。实测（2026-09-10 复查真实 vault）该字段全为 0，说明这条路没人走。

- **判据（窄，且有否定性断言守住）**：卡片通过 `related` / `depends_on` / `source` 链到**另一份文档**（用户笔记或记忆卡，**排除 `_README.md` / `index.md` 脚手架**——层 README 里写着示例 hook `pattern: subsequence_argument`，否则每一张链到 README 的卡都会被"互证"），而**该文档正文里出现了这张卡的 `hook.pattern` 或某个 `hook.techniques`**（按词边界匹配，≥6 字符）。只共享主题不算。
- **写入**：`verified: cross-referenced` + 凭据 `verified_by: corroboration`，**同一次编辑写完**，并**读回校验**——否则会造出体检自己那条 `unjustifiedUpgrade` 检查要抓的「等级升高但无凭据」状态。凭据取值只有两个：`user`（用户点 ✅）与 `corroboration`（体检比对成功），模型两个都不能写。
- **`user-confirmed` 仍然只有用户能给**，❌ 仍然降一级（`wrong` 路径把凭据改回 `none`）。
- **升的是「中间那一级」**：`utilityOf` 的验证强度 0.33 → 0.66，因此升过级的卡在低效用归档里更不容易被选中——这是设计意图（有互证的卡不该与孤立卡同价）。
- **证据进报告、不进卡片**：`sections.corroborated` 列出「哪张卡 ← 依据哪份文档」，但不往卡里写指针——存指针会在改名后腐烂，而凭据字段已经足够让体检判真伪。报告同时进体检清单与人类摘要（**自动改等级必须可见可争议**）。
- **失败要报**：写入未确认时进 `warnings`（与归档失败同形），并作为一个建议进体检台账。
- **状态**：**已实现**（`findCorroboration` + `rewriteHookStats` 的 verification 参数 + `syncHookStatsToCard` 的读回校验）。断言 345 → **353**（本项 10 条，其余见 §8.6）（含"没被别处提到的卡不动""README 不算证据""第二遍是 no-op（幂等）"三条否定性断言；变异验证：让 `via` 恒为 `null` ⇒ 5 条断言红）。

#### 8.6.1 判据收紧：**共享上游不算第二票**（2026-10-01，C8/N4）

> **来源与理由**：本节的判据此前只问"别处有没有出现同一个 pattern"。Louck 的 L-c「制造共证」与 Dash 的 Salience 脆弱性（**重复 ≥3 次就被当成重要性**）说明：「重复出现」是**可以被制造**出来的信号——把同一次对话的结论抄进两份文档，就能从零铸出 `cross-referenced`。既有文 [`note-noise-and-memory-fidelity-2026-09-26.md`](../note-noise-and-memory-fidelity-2026-09-26.md) §5 曾把"自动互证升级"算作**系统自己能降噪**，这条**改口**：它需要更严的判据才成立。文献依据见 [`../../literature/notes/memory-fidelity-papers-2026-10-01.md`](../../literature/notes/memory-fidelity-papers-2026-10-01.md) §3 修正项 1。

- **新增判据**：匹配到的文档若与本卡**共用同一个 `source` / `depends_on` 出处**，则它是**同一来源的复述**，不是独立见证 ⇒ **不升级**，并进 `sections.corroborationRepetitions`（“相关重复、不计票”）+ 人类摘要一行。
- **`import` 语义**：独立性的观测用的是**候选文档自己声明的链接**，不是"卡链到了它"（后者是这对匹配得以成立的原因，不能当独立性证据）。
- **继续搜索，不在第一份命中处停下**：一份被污染的文档**不否决**后面那份独立文档——第一版实现会在第一个名字命中处 `return`，于是一处同源就足以干掉一次本来成立的升级（这个 bug 在实现时被自己的新测例抓到）。
- **同源集合由 `extractLinks` 取**：它此前是 `buildAuditReport` 里的**闭包**，而喂给 `findCorroboration` 的访问器只读 `source`/`related`——于是 `depends_on` 在这条路径上**根本看不见**。现已提为模块级函数，两处共用同一提取（`depends_on` 一并纳入）。
- **候选文档的出处此前**根本没被读**：证据池条目是 `{ rel, text }`，所以把 `other.source` 传进访问器永远是 `""`——这条新判据当时**结构上不可能**发现同源，而它还能"通过自己的测试"。已补 `provenanceOfDocument`。**这是本仓库反复出现的同一形态：守卫看不见自己的输入。**
- **不声称的**：两个**没有**共享链接的文档被当作独立，这是**推断不是证明**（vault 没有认证通道，Louck 的 A1 在这里不成立）。引用这项能力时不要说"已保证独立"。
- **状态**：**已实现**（`findCorroboration` 的返回值由 `path|null` 改为 `{ origin, evidence, sharedWith }`；`sections.corroborationRepetitions` / `counts.corroborationRepetitions`）。断言 427 → **440**（本项 5 条 + 来源项 8 条，见 §5.2）。

## 9. 安全边界（fail-closed）

- 工具面：文件读写/搜索 + 四个笔记工具（note_recall / note_strategy / note_create / note_links）+ ask_user；无 shell/web/subagent；
- 写操作被 workspace-write 沙箱限制在 vault 内，交互提权默认禁用（`approval: never`）；
- 插件自身唯一写的文件在 `cache/`；一切记忆变更走 ctx.fs，无裸 fs 旁路。

## 10. 已知局限（详见 assessment.md）

**从 WikiSkill（arXiv:2608.27454）借来的两条"我们领先"的自我认知（2026-09-18 记入，防止后人反向重做）**：

- **它自陈"不评估技能检索与触发"**（Limitations 第一条：为了隔离技能质量，把全部技能整段注入 prompt）。我们的 `note_recall`（统一 BM25 + hook 加权 + coverage 弱信号 + 边界硬门控）与 `note_strategy`（difficulty 主匹配 + 状态即权限 + ≤4 步迭代检索）正是它留白的那一块。⇒ **不要因为它的"三层级联"说法去重写检索**；要补的是索引行的可读性（§8.2）与截断的诚实性（§3）。
- **它自陈"wiki 没有自动裁剪机制"**（Limitations 第三条：模式页与日志无界累积）。我们有 `archive/`、`superseded`、`autoArchive`（**2026-09-18 起默认开**，判据是"零使用 + >90 天 + 非用户确认"，移动而非删除）、`unused` 检测与**体检台账的两个有界上限**（§8.1）。⇒ 不裁剪会累积是**已被作者承认的真问题**，我们的归档路线方向正确；这里要补的是**裁得准**（枢纽保护、下游复查），不是"加一个自动删除"。

检索为纯 BM25 词法（无 embedding，语义召回靠 Tier B 可选后端、暂未启用）；三写协议仍依赖模型自律（体检提供 records 的结构校验兜底，但内容质量仍靠 prompt）；记忆架构处于 prototype 阶段、无长期 field testing；记忆面板有两套入口：Obsidian 侧 ItemView（浏览/搜索/编辑/反馈/归档）与 dsh web 的 `settings.section` 面板（`dsh/client-panel/`，主 dsh web 3080 上使用）。

纠错链路（0.7.2 起，详见 `self-correction.md`）：① `superseded` / `duplicate_of` 卡在 `note_recall` 中**已排除**；② `❌` 反馈**已**把 `success_rate` 封顶 0.35 并降一级 `verified`（写 `needs_review`/`last_wrong`）；③ `hookPrior` 检索权重**已**从 5% 提到 15%（`verified`/`success_rate` 对排序影响 ≈10%）；④ 语义对错**仍无全自动确定性校验**——体检新增「待重审」清单（确定性检测 + 模型读 `source` 证据链执行），但内容正确性的最终判断仍依赖模型与用户反馈（插件不调模型是设计红线）。