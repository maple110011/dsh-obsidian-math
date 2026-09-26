# 脏笔记、AI 补全与记忆保真度：会不会「越看越错乱」？

> 状态：**调研已完成（只读），结论有代码证据；方案部分已实施（2026-09-26 二次标注）**。原文写的"改进方案**全部**为提案、未实施"已不准确：**P1（注入措辞分级）/ P2（可信度进注入）/ P3（体检清单 `unverified` 前置）已实现**（各自标题行标 ✅，见 `:214` / `:224` / `:239`）；**P4 / P5 / P6 / P7 仍是提案**（`:247` / `:258` / `:274` / `:286`），其中 P5 只剩"单源老化降权"一半（另一半 P5-A 卡级矛盾检测已落地）。**决策项 D1–D6 仍待你拍板**（`:330` 起，汇总在 `docs/pending-decisions-2026-09-26.md` 的 C1–C6）。
> 日期：2026-09-26 · 仓库版本：0.7.8（`docs/memory/design.md:3` 的标记行与 `package.json` 一致）
> 调研方式：只读代码与既有文档 + 三处**本机实测**（合成夹具，不触真实 vault）。所有 `file:line` 指向本仓库当前提交。
> 本文档**不改任何代码**，不替代 `docs/memory/design.md`（实现规格）；它只回答一个产品问题。

**要看的一句话**：**会，但不是因为"笔记脏"本身——是因为注入层把记忆**当成已沉淀的事实**呈现，而"这张卡/这条笔记有多可信"的唯一机器信号（`hook.verified`）在**注入路径上既不被排序消费、也不被显示**（`dsh/preset/math-memory.mjs:3611-3648`、`:3776`）。加上"检索命中 ⇒ `uses`+1 ⇒ 排序权重上升"这条自我强化链（`dsh/preset/note-tools.mjs:539`、`:880`），脏内容确实能在一个闭环里越滚越靠前。触发条件很具体，见 §1.3。**

---

## 1. 结论先行

### 1.1 会不会

**会形成负反馈闭环，但闭环的入口不是"你的笔记"，而是"被沉淀进记忆层的东西"。** 两者要分开谈：

| 内容在哪 | 会不会被注入 | 会不会固化 | 机制 |
|---|---|---|---|
| 你的笔记 `vault/**/*.md`（含 AI 补全的） | **不会**（不在注入路径里） | 会，**间接** | 只有模型主动 `note_recall` 才被读到；读到的片段按 **BM25 词面**排名，**不看可信度**（`dsh/preset/note-tools.mjs:878-885`、`:1011-1035`） |
| 记忆卡 `memory/records/**`、`profile.md`、`notation.md`、`inbox/**` | **会**（每次组装系统提示都注入） | 会，**直接** | 注入的是**索引行与原文**，行里**不含** `verified`/`source`（`math-memory.mjs:3611-3648`、`:3756`、`:3766`、`:3776`） |
| `episodes/**`（整场对话原文） | 只注入**索引行** | 弱 | 原文留在磁盘，靠 read/grep 按需读（`design.md:42`） |

### 1.2 一句话机制（谁写 → 谁检索 → 谁注入 → 模型如何对待 → 又写回哪里）

```text
① 谁写    模型按"三写协议"写 records/topics/profile（vault-AGENTS.md:35-38）
          + AI 补全的用户笔记（模板允许：vault-AGENTS.md:87 "标注 <!-- AI 补全 -->"）
          唯一门槛 = capture-policy 档案（idea/fact/preference 默认 ask、structure 默认 auto）
          —— 但那是"要不要写"的对话级确认，**不落任何字段**（math-memory.mjs:1008）
② 谁检索  note_recall 统一 BM25 语料（note-tools.mjs:875-885）
          分数 = 0.75×BM25 + 0.10×CJK字符包含 + 0.15×hookPrior
          hookPrior = 0.45×成功率的缺省0.5 + 0.15×uses + 0.10×gain + 0.20×verified + 0.10×新近度
          ⚠️ 0.45 那一项的 0.5 是"没有 success_rate 时"的缺省 —— **未核实的卡并不因此扣分**
③ 谁注入  每次 system-prompt 组装追加 dsh-math:memory 段（math-memory.mjs:4121-4133）
          profile/notation/records索引/templates索引/episodes索引/inbox摘要 + 体检清单
          **索引行里只有 `- [[stem|一句话]] · topic · updated: 日期`**，没有 verified、没有 source
④ 模型    注入头部明说"以下内容用于知道去哪找，不要当作完整证据"（:3676）
          但 records 段的小标题是「类型化原子事实」、profile 段是「稳定偏好」（:3756、:3776）
          —— **同一段文字里，元层说"这是地图"，小标题说"这是事实"**
⑤ 写回    note_recall 每次命中 → cache/retrieval-stats.json 记一笔（note-tools.mjs:1724）
          → 每日体检把 uses 合并进卡（math-memory.mjs:2224、:2244-2275）
          → 下次 hookPrior 里 uses 项更高（note-tools.mjs:539）
```

### 1.3 触发条件（三个同时满足才会"越看越错乱"）

1. **脏内容已经进过记忆层**（records/topics/profile/notation），而不只是躺在笔记里；
2. **它被反复检索命中**（因为词面贴合当前问题——AI 写的东西通常恰好用了你的高频术语），于是 `uses` 增长、`updated` 变新；
3. **它始终停在 `single-source`**——没有任何东西会因为它"未经用户确认"而压它，`verified=0.5` 是缺省而非惩罚。

**本机实测（合成夹具，2026-09-26）**：写一个 14 篇文档的小语料，两张内容几乎相同的卡：

```
单源 AI 卡      score=0.9363   verified=single-source, success_rate=0.5, uses=10
用户确认卡      score=0.9173   verified=user-confirmed, success_rate=0.9, last_used=90 天前
```

**一张从未被用户确认、只是被检索了 10 次的 AI 卡，排在你亲手 ✅ 过的卡前面。** 复现命令（只读，不改任何文件）：

```powershell
node --input-type=module -e "const nt=await import('file:///E:/software/ss/Deepseek-Harness/dsh-obsidian-math/dsh/preset/note-tools.mjs'); …"
```

（完整脚本见 附录 A；`hookPrior` 单点值：AI 卡 0.591 / 零命中的同款 AI 卡 0.441 / 用户✅的 90 天旧卡 0.655。）

**这就是"越看越错乱"的量化形态**：不是模型突然开始胡说，而是**未核实的内容因为被反复使用而获得排序上的自信**，而模型看到的注入文本里**没有任何东西告诉它"这条没人确认过"**。

### 1.4 但有两处已有的限制，别把风险说得比实际大

- **注入不是"全库倾倒"**：`records` 索引注入 ≤800 字符、`templates` ≤600、`inbox` ≤1200（`math-memory.mjs:88-97`、`:118-122`），整段硬上限 `MAX_TOTAL_MEMORY_CHARS = 18000`（`:167`）。
- **固定措辞框架本身占 2329 字符**（实测：空 vault 的注入长度，`buildMemorySection`）。基准 vault 整段 **4088 字符**、内容部分仅 **1759**（实测）。也就是说：在你现在这个规模下，"脏内容挤出导航"还不是主要矛盾；**主要矛盾是"注入里没有可信度"**。当库变大、真的顶到各层预算时，才会叠加第二种病：`appendOnlyIndexDigest` 静默丢掉最旧的行（`math-memory.mjs:3619-3629`——按预算 break，**不插截断标记**，而 `clip()` 在别处是会插的，`:492-518`、`design.md:89-96`）。

---

## 2. 闭环的六段，逐段给证据

### 2.1 注入侧：注入了什么

`buildMemorySection`（`dsh/preset/math-memory.mjs:3662-3852`）按固定顺序拼：

| 顺序 | 段 | 来源 | 预算 | 有无可信度标记 |
|---|---|---|---|---|
| 1 | 头部路由说明 + **记忆适用性纪律** | 硬编码 `:3670-3698` | — | — |
| 2 | 捕获策略 | `.deepseek/capture-policy.md` `:3743-3753` | — | — |
| 3 | 用户画像与稳定偏好 | `memory/profile.md` `:3663`、`:3756` | 4000 | **无** |
| 4 | 记号体系 | `memory/notation.md` `:3764-3767` | 800 | **无**（但有"自动收集"块与"已采纳/候选/已否决"三表结构，见 `:2002-2028`） |
| 5 | 研究主题索引 | `topics/index.md` `:3664` | 1800 | **无** |
| 6 | 记忆记录摘要 | `records/index.md` 尾部行 `:3665`、`:3641-3643` | 800 | **无** |
| 7 | 问题模板索引 | `templates/index.md` 尾部行 `:3666` | 600 | **无** |
| 8 | 近期事件时间线 | `episodes/index.md` 尾部行 `:3667` | 1200 | **无** |
| 9 | 备忘录状态 + 提醒候选 | `inbox/` + 相关性排序 `:3668`、`:1103-1195` | 1200 | 有隐含标记：「待打磨/打磨中/已完成」（`:1163-1173`） |
| 10 | 跨会话问答线索 | 会话日志蒸馏 `:3805-3835` | ≤6 组 / 3000 | 有：`问`/`答` 分开标（`:3831`） |
| 11 | 记忆体检清单 | `cache/memory-audit.json` `:3837-3840` | 1200 | — |
| 12 | 工作记忆 | `working.md` `:3845-3849` | 500 | 有：「草稿，非长期记忆」 |

**关键事实：第 3–8 段的文本是文件内容的原样片段，没有一处附加"这是笔记里的说法/未核实"的措辞。** 唯一的区分来自段落小标题本身，而小标题把 records 称做「类型化原子事实」（`:3776`）、把 profile 称做「稳定偏好」（`:3756`）。

### 2.2 排序与选择信号：静态层根本没有排序

- **静态导航层不做任何相关性/置信度排序**：`records`/`templates`/`episodes` 走 `appendOnlyIndexDigest`，语义是"按行保留**最新**的、直到预算用完"（`math-memory.mjs:3611-3633`）；`profile`/`notation`/`topics` 走 `readMemoryFile` 整段截断（`:966-976`）。**预算内 = 全都要，预算外 = 丢最旧**，没有别的信号。
- **唯一按相关性选择的是 inbox 提醒候选**：`0.7×相关性 + 0.3×新鲜度`，阈值 `relevance ≥ 0.15` 或陈旧（`:1178-1184`）。
- **排序信号集中在一个函数**：`hookPrior(hook, updatedDate)`（`dsh/preset/note-tools.mjs:529-552`），权重 `0.45 success + 0.15 uses + 0.10 gain + 0.20 verified + 0.10 recency`，最终钳到 `[0,1]`；它只以 **`RECALL_PRIOR_WEIGHT = 0.15`** 的权重进入总分（`:354`、`:880`）。
- **`not_applicable_when` 是硬门控**：命中边界短语的卡**不进候选**，只在结果里单列「因适用边界被排除」（`:895-937`、`:1489`；坑 47，`docs/handoff.md:140`）。这是**唯一**因为"这张卡自己说别用"而被排除的机制。
- **`superseded` / `duplicate_of` 已排除**（`design.md:288`）。
- **预算档位**：`compact|standard|rich` 八个键（`math-memory.mjs:118-122`），优先级 = 显式 preset 配置 > 库内 `.deepseek/config.md` 的 `budget` > `standard`（`:143-149`）。**`standard` 各段预算合计 13400**，加上体检 1200 + working 500 = **15100**，硬上限 18000（本机计算，非文档引用）。
- **实测**：三档在真实库上只差 7864 / 8250 / 8890 字符（`design.md:108`，2026-09-17 真实库）——即档位旋钮目前**没有实际作用**。

### 2.3 捕获/蒸馏侧：谁写、有没有来源

| 路径 | 实现 | 是否记来源 | 是否需用户确认 |
|---|---|---|---|
| 会话日志 → episodes | `runSessionCapture`（`math-memory.mjs:831-942`）/ host 侧 `scanSessionCapture`（`dsh/host/memory-admin.mjs:1370-1502`） | 记 `sessionId` + 日期（`:899-906`），**只取 `source.kind === "user"` 的真实用户消息**（`:190`、`memory-admin.mjs:1275`） | 开关 `sessionCapture`，**默认 `false`**（`:3882`、`dsh/templates/config.md:22`） |
| episodes → records | **模型按三写协议手写**（`vault-AGENTS.md:38`） | `source` 必须指向 episode（**只是纪律，只在 records 层被体检校验**：`math-memory.mjs:3162-3167`） | 看 `capture-policy` 的 `fact` 档，默认 `ask`（`:1008`） |
| 会话 → records 的"确定性蒸馏" | **不存在**。整场对话只落 episodes 原文，records 全靠模型提炼 | — | — |

**关键缺口**：`capture-policy` 的 `ask` 只约束"这一轮要不要写"的**对话级同意**，**不产生任何卡上字段**。也就是说，用户当时点过"同意"，事后无从区分——**"经用户确认的"和"AI 自己觉得该记的"在存储上完全同形**。

- **`hook.verified` 是唯一的存储级可信度字段**，取值 `user-confirmed` / `cross-referenced` / `single-source`。模型**只能写 `single-source`**（`vault-AGENTS.md:62`）；升级到 `cross-referenced` 由体检确定性写入（凭据 `verified_by: corroboration`，`math-memory.mjs:266-271`、`design.md:261-271`）；升级到 `user-confirmed` **只能由用户点 ✅**（`memory-admin.mjs:258-261`、`design.md:164`）。越权升级被体检抓（`math-memory.mjs:2453-2455`）。
- **没有"这句话是用户说的 / AI 说的 / AI 从笔记推断的"这种来源字段**。卡片 frontmatter 里的 `source` 指**证据链**（哪张 episode），不指**说话人身份**；`vault-AGENTS.md:66` 提到的策略卡 `provenance` 字段**代码里没有任何读取点**（本机全仓 grep：只有注释，无消费方）。这与坑 34（写而不读的字段；`docs/handoff.md:126`）同形。

### 2.4 可信度信号：`✅ / ⚖️ / ❓` 是怎么算出来的

**答案：不算——只是显示。** 完整链路：

1. 面板客户端 `CardRow` 拿 `card.verified` 查表：`const badge = VERIFIED_BADGES[c.verified] ?? "❓"`（`dsh/client-panel/src/index.jsx:79`），图例在 `:245`（`✅ 已确认 · ⚖️ 与他处互证 · ❓ 单次来源`）。注释明确：**没有 hook 块的卡是 `❓`，不是"无徽标"——证据最弱的卡不能看起来最干净**（`:70-71`）。
2. `card.verified` 由宿主路由 `/memory-panel/state` 经 `collectMemoryState` 提供，来源是 `parseMemoryFrontmatter` 解析出的 frontmatter：`verified: typeof hook?.verified === 'string' ? hook.verified : null`（`dsh/host/memory-admin.mjs:869`；路由在 `dsh/host/math-memory-panel.mjs:249-252`）。
3. **没有第二处计算**：`VERIFIED_BADGES` 只影响渲染，不参与任何排序；面板的排序就是目录扫描序（`memory-admin.mjs:830-891`）。

**同一个字段在检索侧确实参与排序**（`hookPrior` 的 `0.20` 项），**但在注入侧（静态导航层）完全不参与**。所以今天：**你点 ✅ 提升的是"检索时的先验"，不是"注入时的措辞"**——注入里那张卡和你从没看过的卡长得一模一样。

### 2.5 体检/审计：能发现什么，有没有"待澄清队列"

`buildAuditReport`（`math-memory.mjs:2183-3466`）扫描 `records` / `templates` / `strategy` 三层（`AUDIT_CARD_DIRS`，`:168`），确定性地报：

| 发现 | 判据 | 代码 | 进模型清单？ | 进面板？ |
|---|---|---|---|---|
| `weak` | 成功率 ≤0.4 且 uses ≥3 | `:2528` | ✅ | ✅（`decisions`） |
| `unused` | uses=0 且 >30 天 | `:2529` | ✅ | ✅ |
| `unverified` | 仍单源 且 >60 天 | `:2530-2533` | ✅ | ✅（仅**计数**：`:3358-3360`） |
| `duplicates` | 同 operator 且 Jaccard ≥0.7 | `:2535-2560` | ✅ | ✅ |
| `pendingReview` | `needs_review: true`（用户点过 ❌） | `:2808` | ✅ | ✅（面板「⚠️ 需要你处理」，`index.jsx:278-287`） |
| `unjustifiedUpgrade` | verified 高于单源但无 `verified_by` | `:2453-2455` | ✅ | ✅ |
| `missingSource` / `brokenLinks` / `notInIndex` | records 层结构校验 | `:3162-3167` | ✅ | 部分 |
| `indexWeak` / `indexNotAnEntry` | 索引行说明 <8 字符 / 不是 `- [[stem|…]]` | `:2411-2448`、`design.md:214-223` | ✅ | ❌ |
| `tooLong` / `tooManyMoves` | 正文 >20 行 / move >5 个 | `:2466-2480` | ✅ | ❌ |
| `downstreamReview` | `depends_on` 的上游被改 | `design.md:127-131` | ✅ | ❌ |
| **`methodologyInRecords`** | artifact 卡既不关联笔记、正文又无公式数字 → **"一般性梳理落进了记录层（会以已沉淀的事实身份被引用）"** | `:2055-2077`、`:2919-2922` | 只进 `human`（`:3384-3387`） | ❌ |
| **`noteClaims`** | 定理索引写"已证"但载体笔记自称"AI 补全/待核对/存疑" | `:2098-2182`、`design.md:245-259` | ✅ | ✅（`human`） |
| **`noteGaps`** | 笔记里有 `待补/待核对/待证明/TODO` | `:1958-1991` | ✅ | ✅ |
| **`notationConflicts`** | 同一个**名字**对应多个符号 | `:1981-1984`、`:3392-3395` | ✅ | ✅ |

**"待澄清队列"式的出口：不存在。** 有的只是：

- `sections.pendingReview`（**只由用户点过 ❌ 触发**，`:2808`）——它是"你说过它错"，不是"它还没被确认"；
- `archiveCandidates`（低效用，0.5×可靠性+0.3×频次+0.2×新近度）→ 面板可一键归档（`index.jsx:288+`）；
- 面板路由全集只有：`/state`、`/feedback`、`/archive`、`/capture-policy`、`/archive-episodes`、`/session-capture(-toggle)`、`/workspaces`（`math-memory-panel.mjs:240-291`）。**没有"隔离/降权/标记待澄清"路由**；
- 反馈动作里已删掉 `inapplicable`（`control-panel.md:50`），现役只有 `confirm` / `wrong` / `stale` / `forget`（`control-panel.md:37-42`）。**"我还没搞清楚"不是一个可表达的状态。**

**另有两处让体检信息到不了模型**（`buildAuditReport` 相关）：

- 模型清单被 `clip(..., MAX_AUDIT_CHARS)` 截到 **1200 字符**（`:3407`，`:156`），而 `unverified` 排在清单很靠后的位置（`:3198-3201`）——**库一大，最该看的"单源 60 天"就先被裁掉**（`clip` 会插截断标记，但那一行不会出现）。
- `design.md:212` 说台账开关 `auditMaintainLedger` "默认开"；代码里实际读的是 `helpers.maintainLedger !== false`（`:2996`），而 `normalizeConfig`（`:3861-3905`）**从未设置 `maintainLedger`** ⇒ 台账**恒开、没有关闭通道**，`auditMaintainLedger` 这个名字在配置里是空的（**本项为只读代码推断，未跑开关验证**）。

### 2.6 其它防御（已有的）

| 防御 | 状态 | 证据 |
|---|---|---|
| 去重（卡级） | `superseded` / `duplicate_of` 在 `note_recall` 中排除 | `design.md:288` |
| 去重（相似度建议） | 体检 Jaccard ≥0.7 报"疑似重复"，含枢纽保护 | `math-memory.mjs:2535-2560`、`:3202-3210` |
| 时间衰减 | `hookPrior` 的 90 天线性衰减项，权重 0.10 | `note-tools.mjs:543-551` |
| 过期标记 | 顶层 `status: superseded`（退出检索、文件保留） | `control-panel.md:41` |
| 冲突检测（卡级） | 只有**建议**：疑似重复 + 下游待复查；**没有"新旧事实矛盾"的检测** | `:3202-3220` |
| 冲突检测（笔记级） | `notationConflicts`（同名多符号）+ `noteClaims`（索引声称已证但载体不认可） | `:1981`、`:2098` |
| 自造符号 | `collectNotation` 收集 → 体检写进 `notation.md` 自动块（人不动手） | `:1868-1943`、`:2002-2028` |
| `source` / `confidence` 字段 | 字段存在；`source` 只在 records 层被校验"有没有"，**不校验它指向的 episode 里到底说了什么**；`confidence` 属模型可写、**无任何读取点**（同坑 34 形态） | `:3162-3167`、`design.md:163` |
| 归档 | `autoArchive` 判据 = 零使用 + >90 天 + **非用户确认**；模板 `config.md:6` 默认 `true`，preset 默认 `false`（`math-memory.mjs:3879`）——**两侧默认值不一致**，实际取值取决于 vault 里有没有 `config.md` | `:2813-2823` |
| 体积控制 | 硬上限 18000 + 三层索引保尾部 + `clip` 头尾都保且**插截断标记** | `:167`、`:3611-3633`、`:492-518` |
| "薄记忆模式" | 有 `compact` 档，但**没有任何开关把记忆整体降为"只注入 profile"**；`enabled: false` 是"全停"（`:4080-4083`），不是"变薄" | `:119`、`:4080` |

---

## 3. 现状防御清单：有什么、缺什么（每条一句）

**已经有**

1. 「记忆是候选不是指令」的注入纪律 + 四条认知偏差对策（`math-memory.mjs:3688-3698`）。
2. `single-source` 是模型写入上限，升级需用户或体检凭据（`vault-AGENTS.md:62`、`:2453-2455`）。
3. 边界硬门控 + 不静默丢弃（`note-tools.mjs:895-937`，坑 47）。
4. 未核实的卡在**检索**里确实排得靠后（`hookPrior` 的 0.20 verified 项）。
5. 体检能确定性地发现"单源 60 天"、"一般性梳理落进记录层"、"索引盖错章"、"同名多符号"（§2.5）。
6. 归档是移动不是删除，可找回（`design.md:227-233`）。

**缺什么（按严重度）**

1. **注入里没有可信度**：records/topics/profile 的注入文本不含 `verified`，也不加"未核实"措辞（`math-memory.mjs:3756-3790`）。
2. **`ask` 的同意不落字段**：无法区分"用户确认过"与"AI 自己觉得该记"（`:1008`）。
3. **没有说话人来源字段**：用户说的 / AI 说的 / AI 从笔记推断的，存储上同形（§2.3；`provenance` 字段无读取点）。
4. **没有"待澄清"状态**：用户看到一条自己没搞懂的记忆，只有 ✅（撒谎）/ ❌（说它错）/ 过期 / 归档四个动作（`control-panel.md:37-42`）。
5. **检索会自我强化**：`uses` → `hookPrior`（`note-tools.mjs:539`），而 `uses` 只数"被检索出来"，不数"帮上忙"（`design.md:177` 已指出，但 `gain` 需要用户逐条点 ✅/❌，真实 vault 里从未被使用过——坑 35，`docs/handoff.md:127`）。
6. **档位旋钮当前无实际作用**（三档实测仅差 1026 字符，`design.md:108`）。
7. **体检清单在 1200 字符处截断**，`unverified` 排在末尾（`:3407`、`:3198-3201`）。
8. **三层索引超预算时静默丢最旧行、不插标记**（`:3619-3629`）。
9. **`autoArchive` 两侧默认不一致**（preset `false` vs 模板 `true`；`:3879`、`config.md:6`）。
10. **台账开关名存实亡**（`:2996` 读 `maintainLedger`，配置里写 `auditMaintainLedger`）。

---

## 4. 改进方案（按"最小可落地 → 较大改造"排序）

> 每条都给了：改什么 / 预期效果 / 代价 / 风险 / **怎么验证（含门禁与变异方式）**。
> 所有方案的共同纪律（照 AGENTS.md §4）：**声称验证必须说覆盖范围**，且**加守卫必须做变异验证**（故意造缺陷 ⇒ 确认报错 ⇒ 恢复 ⇒ `git diff` 为空）。

### P1【最小】注入措辞分级：让"未核实"在注入里可见 —— ✅ **已实现（2026-09-26，与 P2 成对）**

- **改什么**：`dsh/preset/math-memory.mjs` 的 `buildMemorySection`（`:3756-3790` 三段小标题与后缀）。在 `records` 段的标题与结尾加一句**确定性措辞**，例如
  `### 记忆记录摘要（…；**未经用户确认的条目一律按"笔记里的说法"引用，不得当作已核实事实**）`；
  以及在 `recordIndexDigest`（`:3641-3643`）产出的每行**行尾**追加一个字段（见 P2 落地后可用真实值）。
- **预期效果**：模型不再把"AI 写的索引行"与"用户确认过的偏好"当成同一类东西。**零新增数据、零迁移。**
- **代价**：极小（改字符串）。注入长度 +约 40 字符/段。
- **风险**：纯措辞的效果**不可测**——这恰好是本仓库的老问题（坑 80：文档里的纪律要能指出代码执行点；`docs/handoff.md:243-246`）。所以 P1 **必须与 P2 成对**，单独做就是口号。
- **怎么验证**：`scripts/test-memory.mjs` 加断言：注入段包含该分级措辞**且**不含"类型化原子事实"/"稳定偏好"这种无保留的措辞（**否定性断言**）。变异：把措辞删掉 ⇒ 断言红。覆盖率仅"注入文本含该串"，**不覆盖模型实际行为**（诚实声明）。

### P2【最小可落地·推荐先做】可信度进注入：一行一个 `❓/⚖️/✅` + 未确认标记 —— ✅ **已实现（2026-09-26）**：逐行标记（records/templates）+ 三处**段级声明**（profile/notation/topics）；fail-closed（缺 `verified` ⇒ ❓）；`test-memory.mjs` 8 条断言，变异 M27/M28/M29。**覆盖面**：标记计入行预算（可能挤掉更旧的行）。

- **改什么**：
  1. `math-memory.mjs` 新增 `indexEntryVerification(root, layer)`：解析 `records/index.md` / `templates/index.md` 的每行 stem，读对应卡的 `hook.verified`（复用 `parseHookFrontmatter`，避免新写 frontmatter 正则——坑 65 / AGENTS.md §6）。
  2. `appendOnlyIndexDigest`（`:3611`）产出每行时**不改索引文件**，只在注入文本里追加 ` ❓未确认` / ` ⚖️互证` / ` ✅你确认过`。
  3. `profile.md` / `notation.md` / `topics/index.md` 是整段注入，无法逐行标 —— 改为**段级声明**：若该文件里不存在任何用户确认痕迹，段标题追加「（其中含 AI 归纳，未经你逐条确认）」。
- **预期效果**：**§1.3 实测的那个反转在注入层被说破**。模型至少有据可依地降级引用，并在回复里用 ❓ 徽标告诉你"这条我没底"（徽标规则已注入：`:3715`）。
- **代价**：`indexEntryVerification` 每层 O(行数) 次文件读取，只在 system-prompt 组装时跑一次且可按 mtime 缓存（`records` 索引 ≤800 字符预算 ⇒ 最多几十行，可接受）。约 60–100 行代码 + 断言。
- **风险**：① 徽标进注入会让导航行变长，**挤压实际预算**（行内字符计入 `maxChars`）⇒ 需要把标记做成 ≤3 个字符（`❓`/`⚖️`/`✅`）而不是词；② 若某卡的 `verified` 缺失，必须显示 `❓`（沿用 `index.jsx:70-71` 的既定纪律：**最弱证据不能看起来最干净**）。
- **怎么验证**：门禁（`test-memory.mjs` + `node scripts/run-gates.mjs --only memory`）：
  - 正向：构造三张卡（三种 verified 各一），断言注入文本里三行分别含对应标记；
  - **否定性**：构造一张**无** `hook.verified` 的卡，断言注入里它带 `❓` 而不是"无标记"；
  - **变异 M-P2**：把 `?? "❓"` 改成 `?? ""` ⇒ 该否定性断言必须红；把标记追加整段删掉 ⇒ 正向断言红。
  - 判据锚在**代码提供的性质**上（构造条件 + 断言），不锚在"某个 fixture 恰好长这样"上（AGENTS.md §6：测试锚代码不锚数据）。

### P3【小改】体检清单：`unverified` 前置 + 台账开关名修正 —— ✅ **已实现（2026-09-26）**：`unverified`/`待重审` 紧跟 `负反馈`；`auditMaintainLedger` 现在真的接线（config → helpers，与旁边 `auditMaintainHookStats` 同形）。`test-memory.mjs` 以**跨越 1200 字符阈值**的夹具（`len=1235, truncated=true`）断言 `unverified` 截断后仍存活；变异 M28/M31。**未做**：`design.md:212` 的措辞是否也要跟着改（文档侧对齐）。

- **改什么**：`math-memory.mjs:3198-3201` 把 `unverified`（与 `pendingReview`）提到清单**最前面**（在 `harmed` 之后、`strong/weak/unused` 之前）；`:2996` 的 `helpers.maintainLedger` 与 `normalizeConfig`（`:3861-3905`）对齐，真正接上 `auditMaintainLedger`（或删掉这个名字，照坑 34 的纪律）。
- **预期效果**：库变大后，"单源 60 天"不再被 1200 字符截断吃掉；`design.md:212` 与代码不再是两套说法。
- **代价**：改行序 + 一个配置字段。10 行以内。
- **风险**：清单是**模型**的待办；调序会让"strong/weak"这些日常项更容易被截掉。可接受（它们是"提升"，`unverified` 是"防止误信"）。
- **怎么验证**：构造 >1200 字符的清单夹具（**必须跨过 `MAX_AUDIT_CHARS` 阈值**——坑 81 的教训：夹具不跨阈值就测不出上限，`docs/handoff.md:248-250`），断言 `checklist.includes("unverified")` 且 `checklistTruncated === true`。变异：把该段移回末尾 ⇒ 红。

### P4【中改·推荐】AI 产物默认停在 inbox：`stage` 字段 + 注入措辞分流

- **改什么**：
  1. `vault-AGENTS.md` §2 与 `records/_README.md` 写死：**模型自己归纳出的内容（不是用户说的、也不是某道题的产物）一律先写 `inbox/`**，已有的 `methodologyInRecordLayer`（`:2055`）从"只报"升级为"报 + 建议搬层"。
  2. 新增顶层字段 `stage: draft | settled`（或复用 `status: candidate` 的语义，见 P5 的取舍）：模型只能写 `draft`；`settled` 只能由用户点 ✅ 或体检互证写入——**完全照抄 `verified` 那套"承诺 + 唯一写入者 + 检测者"范本**（坑 80 的反例，`docs/handoff.md:246`）。
  3. 注入时：`records` 段里 `stage: draft` 的行带 `（草稿·未定论）`；`inbox` 段已经是「待打磨」（`:1163`），无需改。
- **预期效果**：**"AI 的方法论 gloss 硬化成事实"这条路被堵在写下的一刻**，而不是靠事后再分类。这正对应 `:2033-2042` 那段注释里写的用户担忧。
- **代价**：中等——要改协议模板（`vault-AGENTS.md` + `dsh/templates/*.md` + `dsh/templates-manifest.json` 不用改，只是内容变）、体检（新增一条"draft 卡长期未定论"的发现）、注入、README 纪律；且**已有卡没有该字段**，需要有明确缺省（建议缺省=`settled`，否则老卡一夜之间全部降级，等于静默改变"模型被允许依赖什么"——这正是 `design.md:141` 明确反对的做法）。
- **风险**：产品取向问题（见 **D1**）。降级太狠会让模型不敢用你的记忆，回到"什么都没记住"。
- **怎么验证**：门禁三层——① 单元：`stage: draft` 的卡在注入里带标记、在 `note_recall` 里不被当作已验证技巧（沿用 `status: candidate` 的处理，`note-tools.mjs:651-655`）；② 否定性：老卡（无 `stage`）**不得**被标记为草稿；③ 变异：把"模型只能写 draft"的执行点删掉 ⇒ 越权检测（照 `unjustifiedUpgrade` 的形状）必须红。

### P5【中改】冲突与过期不再静默并列：卡级矛盾检测 + 单源老化降权

> **状态（2026-09-26）**：**① 卡级矛盾检测 ✅ 已实现**（判据 = 同一 `hook` signature + 结论极性相反 +
> **≥3 个共享 2-gram**；进 `sections.conflicting` 与清单，并**在注入的两行上都标** `⚠️与[[另一张]]矛盾`；
> 只报不改、零排序风险；变异 M39/M40/M41）。**② 单源老化降权 ⏸ 未做**——它要动 `hookPrior`、会移动既有排序，
> 必须先过 `retrieval-v3 §7.5` 的"Direct 数不降且排名均值不升"门槛，属**待你拍板**的独立决定。
> 实测修正一处：`topic` 不是卡片字段（那是 memo 的）⇒ 判据锚在 signature 上，比原方案更窄。

- **改什么**：
  1. 卡级矛盾检测（当前**不存在**）：同一 `topic` + 同一 `hook.pattern`（或 `depends_on` 指向的卡）下，两条卡的结论行互相否定时进 `sections.conflicting`——**只报不改**，并在注入的 records 段里对这两行标 `⚠️ 与 [[另一张]] 互相矛盾`。
  2. 单源老化降权：`hookPrior`（`note-tools.mjs:551`）引入"未核实惩罚"项：`verified === "single-source" 且 age > AUDIT_UNVERIFIED_DAYS` ⇒ 在现有 `[0,1]` 钳制内下压（**只降不升**，量纲不变，既有排序在阈值内不移动——照 `:520-527` 那条纪律的写法）。
- **预期效果**：① 矛盾的记忆不再以"两条都对"的形态同时注入；② §1.3 那个"检索 10 次的单源卡压过用户确认卡"的反转**重新被 verified 拉回来**。
- **代价**：中。矛盾检测要么做词面启发式（会喊狼来了，`:1953-1956` 已就"同名多符号不报"给过这条理由），要么引入模型判断（**违反"插件不调模型"的红线**，`design.md:286`）⇒ 建议**只做"同 pattern 且正文含否定词/不同数值"这一类窄判据**，并在报告里写清判据，宁可漏报不误报。
- **风险**：改 `hookPrior` 会移动既有排序——`docs/memory/retrieval-v3.md:229` 定的门槛是"**Direct 数不降且目标排名均值不升**"，必须跑 `scripts/qa/engine-probe.mjs` 复核。
- **怎么验证**：① 复现 §1.3 的合成夹具，断言"用户确认卡排在单源高频卡之前"（**这就是变异验证的反面用例**：把新项去掉 ⇒ 该断言必须红）；② `node scripts/qa/engine-probe.mjs` 的 12 组断言 + `docs/memory/retrieval-v3.md:221-227` 的三层可达性输出不退化；③ 矛盾检测的**否定性断言**："只有共同主题、没有互相否定的两张卡不得被报为矛盾"（照 `findCorroboration` 的断言写法，`design.md:265-271`）。

### P6【较大改造】"待澄清队列"进面板：一个新状态 + 一条新路由

- **改什么**：
  1. **状态**：把"我还没搞懂这条记忆"表达成一个**不撒谎的动作**——`applyFeedback` 增加第 5 个动作 `unclear`（写顶层 `needs_clarification: true` + `clarification_asked: <date>`），与 `wrong` 分开（`wrong` 是"它错了"，`unclear` 是"我还没判断"）。宿主保留旧动作的兼容（照 `inapplicable` 的处理：`control-panel.md:50`）。
  2. **路由**：`math-memory-panel.mjs:240-291` 增加 `POST /memory-panel/quarantine`（= 移到 `archive/` 的 `<层>/quarantine/` 子目录，仍可找回）或"降权"（写 `stage: draft`）。**必须继续走服务端锚定的 `resolveAllowedRoot` + `pathInside`**（AGENTS.md §6 第一条，坑 62）。
  3. **面板**：`index.jsx` 的「⚠️ 需要你处理」块（`:278-289`）增加一段「❔ 待澄清（N）」，支持一键隔离/降权，回执沿用既有 `message` 契约（`:192-196`）。
  4. **注入**：`needs_clarification` 的卡在注入里带 `❔待你判断`，且**不进入 `note_recall` 的候选**（或降权），直到被处理。
- **预期效果**：闭环第一次有了"我不确定"这个出口——这是用户原话里"越让我搞不懂"的直接对症项。
- **代价**：大（宿主半 + 客户端半 + 路由测试 + 注入 + 面板呈现），且**客户端包与宿主分开部署**（相门禁 `check-client-package-layout.mjs`、`control-panel.md` 部署说明）。
- **风险**：① 新动作会让回复里的反馈行变长（当前每卡一行 3 个链接已经很长，`math-memory.mjs:3725-3736`）；② 新字段必须**有读取方**（坑 34）。
- **怎么验证**：`scripts/test-panel-routes.mjs` 补路由用例（含**未配置 root 的拒绝分支**——坑 62 明确要求"未配置"分支必须有测试）；`test-memory.mjs` 补 `unclear` 的 frontmatter 写入与读回断言；变异 M-P6：注释掉路由里的 `pathInside` ⇒ 必须红。

### P7【较大改造】"薄记忆模式"：注入体积的最后一道闸

- **改什么**：
  1. `BUDGET_TIERS`（`:118-122`）增加 `minimal` 档（只保留 profile + notation + 各层"计数 + 最近 3 条"），并让 `budgetsFor` 接受；
  2. 或更直白：`config.md` 增加 `injection: full | nav-only | off`，`nav-only` 时 `buildMemorySection` 只输出路由说明 + 各层计数（不含内容行）。
- **预期效果**：库变得很脏时，用户可以先"止注入"（而不必全停记忆），再慢慢清理。今天的 `enabled: false`（`:4080-4083`）是核按钮。
- **代价**：中（一个档位 + 面板/设置页写回 + 断言）。**注意**：`design.md:102` 已有"提供选择不能改变未选择者的行为"这条否定性断言，新档位必须保持 `standard` 逐字段不变。
- **风险**：`nav-only` 会让模型失去"知道有什么"的能力，检索变差 ⇒ 默认必须仍是 `standard`，且面板上要写清代价。
- **怎么验证**：断言 `BUDGET_TIERS.standard` 八键与 `:88-97` 常量逐字段相等（既有断言形态）；断言 `minimal` 注入长度 < `compact` < `standard` < `rich` 且 `MAX_TOTAL_MEMORY_CHARS` 仍不被突破；变异：把 `standard` 改小 ⇒ 该断言红。

---

## 5. 给用户的判断标准：什么时候该清理，什么时候系统能自己降噪

**系统能自己降噪的**（你不用动手）：

1. **零使用 + 超过 90 天 + 非你确认过的卡** → 体检自动归档（前提：vault 的 `config.md` 里 `autoArchive: true`；预设默认是 `false`，`:3879`）。
2. **被检索命中但从来没用上的** → 进 `unused`，体检在回复末尾建议处置（不会自动删）。
3. **与别处互证的** → 体检按"另一份文档里出现了同一 pattern/技巧"自动从单源升到 `⚖️互证`（`:266-271`）；这只是自动比对，**不等于你确认过**，随时可 ❌ 推翻（`:3401` 就是这么写给用户看的）。
4. **同名的符号有两套写法** → 自动收集进 `notation.md` 自动块，报告里点名（`:3392-3395`）。

**系统永远降不了、只能你自己判断的**：

1. **单源 60 天以上**（`unverified`）——系统只会说"注意"，不会降级、不会归档、不会改注入措辞。**这是今天最该由你处理的一类。**
2. **两套记号哪种才是你的意思**——`notationConflicts` 只报同名多符号；"同一符号两个意思"**故意不报**（需要语义，会喊狼来了，`:1953-1956`）。
3. **一般性梳理被记进了 records**（`methodologyInRecords`）——只有你或模型能判断"它服务某道题"还是"它想说明一类问题"（`vault-AGENTS.md:113-118`）。
4. **定理索引盖错章**（`noteClaims`）——体检能发现"索引说已证、载体说 AI 补全"这类**文本自陈**，但载体如果既没标记又写得很像，机器判不了。

**一条可操作的判据（建议写进你的习惯）**：

> **只看一件事：这条内容被注入时，我能不能在 10 秒内说出它的出处？**
> 说不出来 ⇒ 它应该待在 `inbox/`（会被标"待打磨"），或者待在你的笔记里（**不会被注入**，只在你问到时被检索）。
> 说得出来（"这是我 3 月在 X 笔记里定的记号"）⇒ 让它留在 records/profile，并且**值得你点一次 ✅**——因为今天 ✅ 是唯一能改变它"被注入时的措辞"的东西（P2 落地前，它甚至只能改变检索排名）。

**触发"该清理了"的硬信号**（都在面板/体检里现成）：

- 面板「⚠️ 需要你处理」里的「❓ 待处理」计数；
- 体检里的 `unverified` 计数 > 0 且你最近在靠记忆答题；
- `methodologyInRecords` / `noteClaims` 出现任一；
- 注入长度接近 `MAX_TOTAL_MEMORY_CHARS`（18000）——**目前（基准 vault）只有 4088，远未接近**；等接近了，`compact` 档也没用（三档只差 1026 字符），得上 P7。
- **反向信号（不必清理）**：库在涨但 `unused`/`unverified` 不涨 ⇒ 系统自己在收敛，动手反而添乱。

---

## 6. 需要你决定的事项

### D1 · AI 补全 / AI 归纳的产物，要不要默认降级？

**背景**：今天模型写 `records` 与写 `inbox` 都能记录它自己的归纳；只有 `inbox` 在注入时被标「待打磨」（`math-memory.mjs:1163`），`records` 不会（`:3776`）。

| 选项 | 代价 | 风险 |
|---|---|---|
| **A. 默认降级**：AI 归纳一律先写 `inbox/`（=P4），要进 records 必须用户确认 | 协议模板 + 体检 + 注入三处改；已有卡缺省 `settled` 需明确 | 模型可能"什么都不敢记"，记忆长不大 |
| **B. 只加标记不搬层**（=P2）：留在 records，但注入时带 `❓未确认` | 最小，1 天量级 | 脏内容仍在 records 层，检索照样命中，只是措辞变诚实 |
| **C. 维持现状**，靠事后体检清理 | 零 | 就是你问的那个闭环继续存在 |

**我的建议：先 B（立刻做），观察两周再决定要不要 A。** 理由：B 的证据门槛最低（一个字段 + 注入措辞，可变异验证），而 A 会**改变模型被允许依赖什么**——这正是 `design.md:141` 明确要求"权限只在该库真的声明了的地方收窄"的地方，动它需要真实的失败证据，而不是我的推测。**A 的触发条件**：B 上线后仍然出现"模型把 AI 归纳当成你的原话说出来"的实例（请留一条 episode 作证）。

### D2 · 可信度要不要新增一个"未核实"等级？

**背景**：现在三档 `user-confirmed` / `cross-referenced` / `single-source`，缺省是 `single-source`（`note-tools.mjs:536-537` 的 `?? 0.5`）。

| 选项 | 代价 | 风险 |
|---|---|---|
| **A. 不加等级，只把缺省从 0.5 压到 0.35** | 改一个数字 | 移动全部既有排序；`engine-probe` 的"排名均值不升"门槛可能过不去（`retrieval-v3.md:229`） |
| **B. 加第四档 `unverified`（模型默认写它，`single-source` 留给"用户说过但没确认"）** | 要迁移既有卡 + 面板 + 体检 + `verifiedWeight` 表 | 迁移即"静默改变权限"，与 `design.md:141` 冲突，除非有明确的迁移窗口与公告 |
| **C. 不新增等级，只在注入措辞与体检清单里区分（=P1+P2+P3）** | 最小 | 存储层仍然无法区分"用户说过"与"AI 猜的" |

**我的建议：C，并把 B 记为"等 D1-A 一起做"。** 单独加等级会同时动 4 个消费点（`hookPrior`、注入、面板、体检），而收益与 C 有重叠。

### D3 · 要不要在注入里显式区分"你的笔记说"与"事实"？

**背景**：注入头部已经说了"不要当作完整证据"（`:3676`），但 records/profile 的小标题是「原子事实」「稳定偏好」。**两者互相矛盾**，而模型会读小标题。

| 选项 | 代价 | 风险 |
|---|---|---|
| **A. 改小标题**为「记忆记录（**可能是笔记里的说法，不是事实**）」 | 一行字符串 | 属"改文案"，47 处 `includes('中文文案')` 断言会红（`docs/handoff.md:416` 已登记这一族） |

> **✅ 已实现（2026-09-26）**：四层（profile / notation / topics / records）标题都带上了诚实措辞，"尚未建立"
> 分支也去掉了"稳定偏好"。**实测纠正**：既有断言只牵动 **1** 条，不是 47 条；真正要补的是**正向断言**
> （需要四层真的存在的夹具，放在 `test-memory.mjs` 第 9 节）。变异 **M37**。
| **B. 在每层段尾加一句确定性提示** | 每段 +30 字符 | 提示疲劳 |
| **C. 不改** | 零 | 元层与标题继续打架 |

**我的建议：A**。文案冲突是**确定性可测**的（否定性断言：注入里不得同时出现"不要当作完整证据"与无保留的"事实"小标题），且这是最便宜的一处"让模型别把你的笔记当事实"。

### D4 · 用户侧清理的默认动作：归档还是隔离？

**背景**：今天只有 `stale`（标 superseded，退出检索）与 `forget`（移到 `archive/`），二者都相当于"我不再要它"。

| 选项 | 代价 | 风险 |
|---|---|---|
| **A. 归档（现状）** | 零 | 用户想"先放一放"时会误用永久性动作 |
| **B. 新增 `unclear` + 隔离目录**（=P6） | 大：宿主 + 客户端 + 路由 + 注入 | 新状态需要用户理解成本 |
| **C. 用 `status: candidate` 兼职"未定论"** | 小 | `candidate` 已有明确语义（"不得当作已验证技巧引用"，`design.md:139`），兼职会让两者互相污染 |

**我的建议：A 保持为默认，把 B 列为"当 D1=D1-A 时一起做"**——那时"AI 产物默认草稿"与"用户标未澄清"是同一套机制的两种入口，一起做才划算。**不要选 C。**

### D5 · 注入体积：现在就上"薄记忆模式"吗？

**建议：不上。** 实测基准 vault 注入 **4088 / 18000**，三档只差 1026 字符（`design.md:108`）。**触发条件**：任一层的索引行开始被 `appendOnlyIndexDigest` 静默丢弃（`:3619-3629`），或注入 > 12000 字符。在那之前 P7 只是增加旋钮数量。

### D6 · 我这次调研的可信边界（需要你认账的部分）

- 三处**实测**都是**合成夹具**（§1.3、附录 A 与注入长度），**没有碰你的 vault**，也**没有跑任何 dsh 命令**。
- 附录 A 的排序结论只在**我构造的那个 14 篇文档语料**上验证过；真实 vault 的 IDF、passage 长度、CJK 覆盖率都会改变具体分数。**结论的方向（verified 的 20% 权重可能被 uses 的 15% 项盖过）是公式的直接推论，但"反转是否在你的库里真实发生过"未验证。**
- `auditMaintainLedger` 名存实亡、`autoArchive` 两侧默认不一致两条是**只读代码推断**，未做运行时验证。
  - **✅ 两条都已查证（2026-09-26）**：① `auditMaintainLedger` **确实是死的**（清单会打印"台账已关闭"，但没有任何配置能触发——审计读的是只有测试注入的 `helpers.maintainLedger`）⇒ **已修**（P3b：按旁边 `auditMaintainHookStats` 的同形接线，config → helpers），变异 **M31**。② `autoArchive` 的"两侧不一致"**不是缺陷**：`dsh/templates/config.md` 是**权威**（`true`，2026-09-18 起，附了理由与退出口），代码里的 `false` 只作用于"**这个 vault 还没有 `config.md`**"的那种情形（保守：没有配置就不自动归档）。而且面板那份字面量早已在 2026-09-26 的 A3 里改成与模板一致，并新增第 49 条门禁 `check-config-scaffold.mjs` 逐字段比对（变异 M9/M10）⇒ **这一条我原先的建议（"把模板文字对齐代码"）作废**：模板才是权威，代码那侧是另一个层级（无配置）的默认。

---

## 附录 A · 可复现的实测脚本（只读，不写任何文件）

**测 1：注入长度**（本机 2026-09-26）

```powershell
node --input-type=module -e "
const mm = await import('file:///E:/software/ss/Deepseek-Harness/dsh-obsidian-math/dsh/preset/math-memory.mjs');
const mk = (root) => ({vaultRoot:root, sessionsRoot:'x', maxHistoryEntries:0, maxHistoryChars:0, cacheTtlMs:0});
const empty = mm.buildMemorySection(mk('E:/nonexistent-xyz'), 'live', {sources:[],entries:[]}, undefined, '');
const bench = mm.buildMemorySection(mk('E:/software/ss/Deepseek-Harness/dsh-obsidian-math/scripts/qa/benchmark-vault'), 'live', {sources:[],entries:[]}, undefined, '');
console.log('空 vault（=固定措辞框架）', empty.length);
console.log('基准 vault', bench.length, '内容', bench.length - empty.length);
"
```
实测输出：`空 vault 2329 / 基准 vault 4088（内容 1759）`。硬上限 18000（`:167`）。

**测 2：`hookPrior` 单点**

```powershell
node --input-type=module -e "
const nt = await import('file:///E:/software/ss/Deepseek-Harness/dsh-obsidian-math/dsh/preset/note-tools.mjs');
const iso=(d)=>new Date(Date.now()-d*86400000).toISOString().slice(0,10);
console.log(nt.hookPrior({verified:'single-source',success_rate:'0.5',uses:'10'}, iso(30)));
console.log(nt.hookPrior({verified:'user-confirmed',success_rate:'0.9',uses:'0'}, iso(90)));
"
```
实测：AI 单源卡 **0.591** > 用户确认 90 天旧卡 **0.655** 的对照见 §1.3；零命中的同款 AI 卡 = **0.441**。

**测 3：排序反转（§1.3 的那次）**——构造 12 篇填充 + 一张单源高频卡 + 一张用户确认卡，调 `rankRecallDocuments(docs, 'convergence_argument 收敛论证')`：
实测 `单源 AI 卡 0.9363` > `用户确认卡 0.9173`。

---

## 附录 B · 引用的仓库条目

| 条目 | 位置 | 与本主题的关系 |
|---|---|---|
| 坑 34 | `docs/handoff.md:126` | `last_not_applicable` 没有读取方 ⇒ 本主题下的 `confidence` / `provenance` 同形 |
| 坑 35 | `docs/handoff.md:127` | 反馈机制在真实 vault 里**从未被使用过** ⇒ `gain` 与 ✅ 升级在实践中不产生信号 |
| 坑 44 | `docs/handoff.md:137` | "写完就当成功" ⇒ 任何新增的可信度写入都必须读回校验 |
| 坑 46 | `docs/handoff.md:139` | 不要做通用去冗余重排（GraphMemix −6/−36）⇒ P5 不能走"多样性"路线 |
| 坑 47 | `docs/handoff.md:140` | 边界门控不静默丢弃 ⇒ P2/P5 的标记必须"说出来"，不能悄悄过滤 |
| 坑 80 | `docs/handoff.md:243-246` | **文档里的每条纪律都要能指出代码执行点** ⇒ P1 单独做就是口号；同时 `verified_by` 那条是**范本**（承诺+唯一写入者+检测者），P4/P6 要照抄 |
| 坑 81 | `docs/handoff.md:248-250` | 断言在变异下照样通过（含"夹具不超过预算上限"）⇒ P3/P7 的夹具必须跨阈值 |
| 坑 62 | `docs/handoff.md:155`、AGENTS.md §6 | 面板安全边界必须锚在服务端状态，"未配置"分支必须有测试 ⇒ P6 的硬约束 |
| §7 自指式期望 | `docs/handoff.md:416` | 断言不得从被测模块 import 常量 ⇒ 本文档所有门禁的新期望值必须独立推导 |
| `design.md` §5.1 | `docs/memory/design.md:158-168` | 字段所有权表；新增 `stage`/`needs_clarification` 必须写进这张表并指定唯一写入者 |
| `design.md` §10 | `docs/memory/design.md:286` | "插件不调模型是设计红线" ⇒ P5 的矛盾检测只能用确定性判据 |
| `retrieval-v3.md` §7.5 | `docs/memory/retrieval-v3.md:221-229` | 改检索的验收门槛：Direct 不降 **且** 排名均值不升 ⇒ P5 的硬约束 |
