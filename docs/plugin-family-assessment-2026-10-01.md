# 面向数学/统计学学习与科研的 dsh 插件家族：考察评估与建设方案

> **状态：§0–§8 完成（2026-10-01）。** 已合入 **3 路**只读取证的结论（被舍弃机制台账、dsh 插件形态矩阵、文献→能力映射），其中**三处纠正了作者原先的判断**（`ctx.jobs` 不是调度器；hook 协议不是给 native 插件用的；`lemmalog` 的"本机无 Rust"前提不成立），均以 ⚠️ 标出。
> **覆盖边界（诚实说明）**：文献侧依据仓库**自己蒸馏过**的 `docs/memory/references.md`（15 条论文/系统）、`literature/notes/*`（10 份综合笔记）与 34 张卡片的 frontmatter/命中检索，**不是**对原文 `.raw/**/full.md` 的逐篇重读——因此"卡层面零命中"是确证的，**"原文层面零提及"未排除**。
> 4 路取证因超出并发上限（**3**）而失败，其职责**已由作者亲自取证替代**（本机工具链探针、CausalSmith/dsh-web 的 README 与 `docs/plugins.md`），覆盖情况见 §9。
> **回答四问**：(1) 记忆主体移入 dsh 插件后，哪些原先被舍弃的复杂机制变得可引入；(2) 数据库 / Lean 形式化 / Rethlas-Danus 式多智能体并行与成果积累 / lemmalog 这类外部复杂工具，该纳入现有插件还是另做插件再组合；(3) 能否做成一套围绕数学与统计的学习科研插件集合；(4) 若可以，还有哪些类型的插件可做。
> **不重复已有评估**：`docs/decoupling-assessment-2026-09-26.md`（耦合量化与 4 个解耦方案）、`docs/dsh-native-refactor.md`（capability→bundle / posture→profile）、`docs/lemmalog-assessment-2026-10-01.md`（lemmalog 否决）、`docs/pending-decisions-2026-09-26.md`（A/B/C 决策台账）都已存在；本文**引用它们并只回答上面四问**。

---

## 0. 结论摘要

| # | 结论 | 关键依据 |
|---|---|---|
| 1 | **"把记忆主体上移"确实能解锁东西，但解锁的是三类"成本型"限制，不是"能力型"限制。** 上移 = ①引擎从三份收敛成一份；②重活从**每轮注入路径**搬到**宿主侧**；③拿到宿主权能（服务、HTTP 路由、定时器、webhook）。 | 引擎三份与 30/54 条同步门禁：`docs/decoupling-assessment-2026-09-26.md` §2.4–2.6；**每轮成本实测在对话索引的指纹扫描/首轮重建**（`cacheTtlMs: 0` ⇒ `math-memory.mjs:4197-4233`；体检本身已有 24h 节流 `:4239-4243`）；宿主侧能力清单见 §4（⚠️ **`ctx.jobs` 不是调度器**，见 §4.1 的纠正） |
| 2 | **它不解锁那几条产品红线。** "vault 纯 Markdown、不持库"、"记忆插件**不调模型**"、没有语义召回（Tier B 你暂缓）、写时保留永不硬删、所有写入带来源与验证等级、fail-closed —— 这些是**决定**，与代码放哪无关。 | `docs/memory/design.md:33`、`:288`；`docs/memory/README.md:58`（Tier B "用户暂缓"）；`docs/memory/README.md:38`「不可动摇的原则」四条 |
| 3 | **最有价值的一处重新开放，是把"每轮新增必做步骤"这条否决拆成两半。** 该否决当时的理由是"**实测失败模式是机制没人用**"（真实 vault 里 `note_recall` 13 次、`note_strategy` 1 次、`note_links` 1 次）。**如果机制由宿主后台执行、模型完全不参与，它就不再是"每轮必做步骤"** ⇒ 这条理由失效。 | 否决原文：`docs/design-intake-2026-09-10.md:47`、`:52`；实测计数：`docs/handoff.md:559` |
| 4 | **但"失败原因是模型不采用"的机制，后台化救不了它。** 需要模型每轮主动调用的能力（检索、写回、反馈），成本降低不会让模型开始用它 —— 那要改成**确定性自动执行**或**从模型手里拿走这个选择**。区分这两种失败模式，是本次评估最重要的一条判据。 | 同 §3 的实测计数；`docs/design-intake-2026-09-10.md:53`「如实显示『从未评级』，而不是把 0 当成证据」 |
| 5 | **纳入形态的判据不是"话题"，而是四条硬边界：数据契约所有权、权限姿态、外部依赖、生命周期/版本 cohort。** 四条都不跨 ⇒ **留在现有插件**（优先做成 tool/skill，不要新包）；跨了任一条 ⇒ **独立插件**。 | 本仓库实测：**54 条门禁里 30 条只为防跨边界漂移**（`docs/decoupling-assessment-2026-09-26.md:120`）⇒ 每多一个边界就多一组守卫，**边界需要预算是**；dsh 的兼容性门控是**按包**读 `peerDependencies`（本人实测：`dsh-app-boot/lib/index.js:294`）⇒ cohort 不同必须分包 |
| 6 | **"家族 + 聚合包"在 DSH 生态里已被验证到 8.2k star 规模**，且有完整工程手册：单包骨架、`aggregate.yml` 的 `patchFrom`/`deps`、聚合行 id 自动加前缀以**让"装全家桶"与"单独装一个"共存**、强制的 `dsh.engines.dsh` + `peerDependencies` 下限、共享构建预设、第三方收编红线。 | [`zhu1090093659/dsh-web`](https://github.com/zhu1090093659/dsh-web) 的 [`docs/plugins.md`](https://github.com/zhu1090093659/dsh-web/blob/dev/docs/plugins.md)（本人已取全文；§7 摘录） |
| 7 | **"统计科研"有现成范本，且它的成果积累机制正是你要问的那个**：每轮流水线产出**带机器验证证明的存稿**，存进 `doc/research/_bank/accepted/<qid>_v1/`，而银行本身成为下一轮选题的输入。 | [`Jiyuan-Tan/CausalSmith`](https://github.com/Jiyuan-Tan/CausalSmith)（Lean 4 + 论文 [arXiv:2607.22511](https://arxiv.org/abs/2607.22511)，Apache-2.0） |
| 8 | **所以第 3 问的答案是"能，但不是现在这个形状"**：可行形态 = **1 个核心包（数据契约 + 记忆 + 笔记工具 + 面板）+ 少量能力包（各由 §5 的四条边界之一立命）+ 外部 MCP 桥（Lean/DB/检索服务）+ 一个聚合包**；而不是"一个大包"或"N 个小包各管一个话题"。 | §5 判据 + `dsh-native-refactor.md` §0 的既有决定 |

**补两条（§3/§5/§7.3 回填后）**：

- **lemmalog 在新架构下**：四条阻断项减到**两条半**——"新层"与"第二真相源"仍是产品红线；"本机建不出 `cargo` 产物"**不成立**（本机 `cargo` 存在），但"三条安装通道不会为最终用户装 Rust 工具链"仍成立；"preset 够不着 MCP"**不成立**。⇒ **结论仍是不引入**，但"若坚持要验"从"不可能"变成"树外 spike 可行"。
- **本机外部工具链实测**：**Python 3.14.5 ✅ · TeX Live 2026 ✅ · Rust/cargo ✅ · `node:sqlite` 内置 ✅**；**R ❌ · Lean/elan/lake ❌（完全没有）· pandoc/z3/jupyter ❌**。⇒ 计算与渲染**本地可做**；R 与 Lean **只能可选/外部**；**"要不要数据库"根本不需要新增依赖**。

---

## 1. 前提校正：上移到底解锁什么、不解锁什么

这一节是整个报告的地基。你的假设是"架构把更复杂的机制挡住了"——**这个假设对一半**，而准确区分哪一半，决定了后面所有设计。

### 1.1 上移解锁的三类限制

| 类别 | 现状（已取证） | 上移后 | 被解锁的机制类型 |
|---|---|---|---|
| **(C1) 引擎三份** | `dsh/preset/math-memory.mjs`（227 616 B / 3 975 行）与 `dsh/host/memory-admin.mjs`（76 178 B / 1 567 行）有 **23 个同名符号**靠 `check-engine-sync.mjs` 人工同步（17 同步 + 6 条有记录的偏离）；Obsidian 里还有**第三份**（`main.js` 内**450 602 B** 的 `dsh/**` 拷贝，占文件 62%） | 一份权威 + 薄适配/薄客户端 | **任何**新记忆功能：改动面从 3× 降到 1×；可退役 `check-embedded-loader.mjs`(278 行) 与 `check-embedded-writers.mjs`(111 行)；`main.js` **−76 KB** |
| **(C2) 每轮路径** | **对话索引的每轮指纹扫描（及首轮全量重建）在 preset 的 `system-prompt/assemble` 上**：`cacheTtlMs: 0` ⇒ 每轮 `vaultSessionLogs()` 做文件指纹，变了才整份重建（`math-memory.mjs:4197-4233`）；**体检本身已有 24h 节流**（`:4239-4243`，`auditIntervalMs: 86400000`）⇒ **昂贵的是每轮指纹扫描 + 首轮重建，不是"每天的体检"**（此说法 2026-10-01 由只读取证纠正） | host 侧持久化结果 + **宿主自己的定时器**（⚠️ **`ctx.jobs` 不是调度器**，见 §4.1 的纠正） | **所有"重"的确定性处理**：索引重建、跨会话聚合、依赖/失效传播、embedding 索引构建、更深的体检 —— 不再按每轮付费 |
| **(C3) 宿主权能** | preset 刻意只有"人格 + 4 个工具 + 记忆"（`agent.cordis.yml:12-13`，明确写"shell / web / subagents / workflows / goals / todo 一律不挂"）；插件的 HTTP 路由与工作区注册都在 **host** 半（`dsh/host/math-memory-panel.mjs`） | 能力放 host：服务、`ctx.webServer.register`、**宿主侧定时器与持久状态**（⚠️ **不是 `ctx.jobs`**，见 §4.1 的纠正）、webhook、被别的插件 `ctx.inject` | **任何需要"长期活着"或"被别的插件消费"的能力**：后台索引、增量重算、对外服务、被动触发 |

> **为什么这是"成本型"而不是"能力型"**：C1 让改动**变便宜**，C2 让运行**变便宜**，C3 让能力**放得下**。三者都不改变"系统被允许做什么"。

### 1.2 上移**不**解锁的东西（产品红线，需你单独拍板）

这些写得很明确，而且**与代码位置无关**。上移不会让它们变得可行：

| 红线 | 原文 | 上移能改变什么？ |
|---|---|---|
| **vault 文件就是唯一真相；插件不持库** | `design.md:33`「记忆**只存在于 vault 的 markdown 文件**里；插件不持库、不调模型、唯一写文件是自己的缓存」 | **不能**。这是不变量，不是实现细节。（但见 §4.4：**派生缓存**与**权威存储**是两件事，前者不违反它） |
| **（记忆插件）不调模型** | `design.md:288` 等 6 处反复重申「插件不调模型是设计红线」 | **不能**。它挡掉了 LLM 蒸馏/判定/矛盾检测/重排 —— 这些能力的开关在你手里，不在架构手里 |
| **没有语义召回** | `memory/README.md:58`「检索 v3 之 embedding 后端（Tier B）⬜ **可选（用户暂缓；95MB 本地模型 + hybrid 打分）**」；`design.md:286`「检索为纯 BM25 词法（无 embedding）」 | **部分**。不变量（不引新运行时）仍需你拍板；但**索引构建从每轮搬到后台**确实让 Tier B 从"奢侈"变成"可承受" |
| 写时保留、永不硬删 | `memory/README.md:38` | **不能** |
| 所有记忆写入带来源与验证等级 | 同上 | **不能** |
| fail-closed 安全边界 | `design.md` §9；`dsh/profile/cordis.patch.yml`（`workspace-write` + approval `never`） | **不能**（而且这是**每个新插件都要各自声明**的东西，见 §5） |

### 1.3 最关键的一条重新开放，及其边界

`docs/design-intake-2026-09-10.md` 的"明确否决"里有一条，理由是**实测的**：

> 「R1 的 6-Family 架构 / 必做 CAPA 分级 / 93KB `work_state` schema —— 我们的**实测失败模式恰好相反**：机制没人用（真实 vault 里整套反馈面全为 0）。**任何「每轮新增必做步骤」的提案默认拒绝** —— 只吸收「卡片上的字段 + 少量确定性检查」。」（`:47`）
>
> 「**机械化的诱惑**（最高风险）：R1 是为长周期多代理工作设计的；我们是个人数学笔记本。**判定标准：凡是要新增「每轮必做步骤」的都拒。**」（`:52`）

**注意这个否决混了两件事**：①"每轮"（成本）；②"必做步骤"（要模型自律去做）。上移只解决①。

- **解决的那部分**：体检、索引维护、依赖失效传播、跨会话聚合 —— 这些**本来就不需要模型参与**，它们当初被做成"每轮步骤"只是因为没有后台。搬到 host 后台 ⇒ 既不是"每轮"也不需要"模型去做" ⇒ **否决理由完全失效**。
- **没解决的那部分**：检索（`note_recall`）、写回（三写协议）、反馈（✅/❌）—— 它们的失败模式是**模型不调用**（13 / 1 / 1 次），而降低调用成本**不等于**提高调用率。这类要另外的解法：把动作变成确定性自动执行，或把选择从模型手里拿走（例如宿主在捕获路径上直接落盘，而不是让模型决定要不要记）。

> **这条判据可复用**：判断一个"被舍弃的机制"能否因上移而复活，先问它的否决理由是 **(a) 太贵** 还是 **(b) 模型不用**。**(a) 能复活的概率高；(b) 必须换解法。**

---

## 2. 纳入形态判据：什么进现有插件、什么必须独立、什么只是 skill

第 2 问（"纳入现有插件还是另做插件再组合"）不能按话题回答，否则会得到一个"N 个插件各管一个领域"的家族——而本仓库已经量化过这么做的代价。

### 2.1 四条硬边界（跨任一条 ⇒ 独立插件）

| 边界 | 为什么它强制分包 | 本仓库的实证 |
|---|---|---|
| **① 数据契约所有权** | 同一份数据（`.deepseek/memory/**`、卡片 frontmatter schema）**只能有一个 writer-owner**。两个包都写同一份文件 = 本仓库 46/100 起事故的根因形态 | `docs/decoupling-assessment-2026-09-26.md:202`（"两个人都在写同一份文件"）与 §3.7 的统计口径 |
| **② 权限姿态** | fail-closed 的笔记插件（`workspace-write` + approval `never`）与"要跑 Lean / 跑 R / 联外网"的能力**不可能共用一套姿态**。用户要能"只装记忆、不装执行" | `dsh/profile/cordis.patch.yml` 的 `permission` / `approval` / `sandbox-policy` 行；`docs/dsh-native-refactor.md:8`（posture 是机器特定且安全敏感的，**不该由可复用 bundle 强加**）。⚠️ **2026-10-01 只读取证的关键细化**：权限 preset 表是**闭表**——`dsh-permission-presets` RD:60 *"Callers cannot publish another preset through a generic contribution API"*，RD:136 该表在插件生命周期内**固定**。⇒ **一个能力包不能自己声明姿态**；姿态只住在 profile 层、由安装器写。⇒ **不同权限档要的是不同 profile（或显式切换姿态），不是不同包。** 这改变了 §6 的形状：家族 = **一个 monorepo（N 个包）× 2–3 个 profile（study / research），而不是一个 profile 里塞 N 个包** |
| **③ 外部依赖** | Lean / Mathlib / R / Python / 数据库 / embedding 模型 **不是每个用户都有**；塞进核心会让"离线也能装"（`docs/installation.md:64` 的承诺）当场失效 | 三条安装通道的实测形态见 `docs/dsh-0.2.0-adaptation.md` §3.2 与 `docs/installation.md` |
| **④ 生命周期 / 版本 cohort** | dsh 的兼容门控是**按包**读 `peerDependencies["@deepseek-ai/dsh*"]`（`dsh-app-boot/lib/index.js:294`，本人 0.2.0-rc.2 实测）；**不同 cohort 就必须分包**。另外 dsh 保证"可选插件启动失败不影响其他可用插件"（0.1.7 起）⇒ 分包是**故障隔离**手段 | 门控机制：`docs/dsh-obsidian-math` 的 `docs/dsh-0.2.0-adaptation.md` §4.4；dsh-web 把这条做成强制门禁（§7.4） |

### 2.2 四条都不跨 ⇒ 留在现有插件，而且**优先做成 tool 或 skill，不要新包**

理由是可量化的：**本仓库 54 条门禁里 30 条存在的唯一理由就是防跨边界漂移**（`decoupling-assessment:120`）。加一个包 = 加一组跨边界契约 = 加一批守卫与变异验证。所以：

- 同一个数据契约、同一套权限、无新外部依赖、同一 cohort 的新能力 ⇒ **做成 tool / skill / 后台作业**，加在核心包里。
- 只有当能力**必须**跨 §2.1 四条之一时，才新建包；新建时必须**同时**规划 ①id 命名空间（见 §7.2 的 `web-ui-` 前缀实证）、②它自己的守卫与变异验证、③它在聚合包里的席位。

### 2.3 三分法（本报告建议的形态词汇）

| 形态 | 用在哪 | dsh 侧对应 |
|---|---|---|
| **核心包（1 个）** | 数据契约 + 记忆层 + 检索 + 笔记工具 + 控制面板 | 现有 `dsh-math-memory`（bundle 通道 + preset） |
| **能力包（少量）** | 跨了 §2.1 任一条的能力（形式化验证、计算/复现、文献采集…） | 独立 bundle 包，各自 `dsh.bundle.patch` + 自己的 posture 声明 |
| **桥（bridge）** | 外部工具**已经有自己的服务**（Lean LSP、DB、检索服务、arXiv…）⇒ 只写薄适配，不搬代码 | 优先 **MCP**（`dsh-mcp-client`），其次子进程 + 工具 |
| **skill / tool** | 只改"模型怎么做"，不引入新依赖、不改数据契约 | preset 的 `plugins` 列表 / skill 目录 / `ctx.tools.register` |
| **聚合包** | 一键装齐（可选） | dsh-web 的 `dsh-web-all` 形态（§7.2） |

> **一条重要纪律（来自 dsh-web 的实证）**：聚合包的行 id **必须**与独立包不同（他们用 `web-ui-` 前缀），否则"装全家桶 + 单独装一个"会产生**重复 loader entry id** 而让 profile 起不来。分包时**一开始**就定命名空间。

---

## 3. 被舍弃机制的台账与逐条再裁定

**取证范围**：`docs/design-intake-2026-09-10.md`（§2 延后 / §3 明确否决）、`docs/design-intake-2026-09-21.md` §3、`docs/memory/references.md`（15 条论文/系统的"不适用的部分"）、`docs/memory/design.md` §10、`docs/memory/retrieval-v3.md` §7、`docs/pending-decisions-2026-09-26.md`（C1–C10）、`docs/lemmalog-assessment-2026-10-01.md`。**以下每一行的否决理由都取自原文，未加码也未削弱。**

分类记号：**(a)** 产品红线/不变量（与代码位置无关）· **(b)** "每轮"成本 · **(c)** 权限姿态或"够不着宿主" · **(d)** 改动/新子系统成本 · **(e)** 离线无依赖安装承诺 · **(f)** 经验或实测结论。

### 3.1 台账（24 条）

| # | 机制 | 出处 | 否决/延后理由（原文摘要） | 类 | 新前提下 |
|---|---|---|---|---|---|
| 1 | R1 的 6-Family 架构 / 必做 CAPA 分级 / 93KB `work_state` schema | `design-intake-2026-09-10.md:47`、`:52` | "我们的**实测失败模式恰好相反**：机制没人用（真实 vault 里整套反馈面全为 0）。**任何「每轮新增必做步骤」的提案默认拒绝**" | **b** | **拆开看**：无模型参与的重活 → 后台作业（复活）；需模型主动调用的 → 不复活（见 §1.3） |
| 2 | embedding 语义检索 / Cypher / tree-sitter+LSP / 原生二进制+守护+SQLite+3D UI | `:44` | "引一个新运行时会把『vault 文件就是真相』这条不变量破坏掉" | **a** | **不复活**（但"派生缓存"≠"权威存储"，见 §8 D2） |
| 3 | MinHash + LSH 近似重复检测 | `:46` | "`pattern+techniques` 上的精确 Jaccard 已实现且正确；万级以下用不上 LSH" | **f** | 不复活 |
| 4 | 团队共享的二进制图产物（git LFS + `merge=ours`） | `:45` | R2 自己 README 的教训：20MB 文件在 350 次提交里涨到 ~6GB | **f** | 不复活 |
| 5 | 把反条件当**硬过滤**（静默丢弃） | `:48` | 假阴性不可见；必须做成"带原因的排除" | **f** | 不复活（已按"带原因的排除"实现） |
| 6 | 依赖/失效传播 + `detect_changes` 影响面 | `:35` | "需要一张**引用图**（我们只有 `source` 单向链接），属于**新子系统** ⇒ 应写成设计备忘而非直接补丁" | **d** | **复活**：宿主后台作业 + 派生索引让"新子系统"从"改两处引擎"变成"一个后台 pass" |
| 7 | Louvain 聚类 ⇒ 候选主题 | `:37` | "聚类结果**每次都会抖**…在 3 张卡的语料上聚类等于制造噪音；先设规模/稳定性地板" | **f + 规模** | **部分**：规模地板仍在，但"定期后台重算 + 稳定性比较"变得可行 |
| 8 | 可上下调整的深度门 | `:36` | "改成『随不确定性调整』是语义设计，需拍板" | 产品 | 不因架构复活 |
| 9 | 语料覆盖声明（`note_recall` 报告"看了语料的多少"） | `:38` | "与『弱信号诚实』同源，可稍后做" | **d**（小） | **复活**（纯增量、零新依赖） |
| 10 | `manage_adr` 式分区写入（只重写指定 `## 小节`） | `:34` | "先要设计教学闭环本身（文档先行），再写这个 writer" | 前置缺失 | 不因架构复活（缺的是设计，不是算力） |
| 11 | 注入层按"层"重排（把增长型索引挪出逐轮注入） | `design-intake-2026-09-21.md:187` | "方向认可，但本轮不做：它改的是注入**语义**，需要先量真实 vault 的逐段长度与命中率" | 证据缺失 | 不因架构复活 |
| 12 | SQLite 替换 markdown 作为记忆载体 | `references.md:124` | "**vault 文件是特性不是缺陷**" | **a** | 不复活 |
| 13 | 「活动轨迹全量可回放」本身 | `references.md:124` | "我们要的是**语义蒸馏**，不是操作日志" | **a** | 不复活（但"全量**捕获**"≠"全量**回放**"，见 #20） |
| 14 | Obelisk 式的多 agent / 子代理记忆 | `references.md:124` | 同 #12/#13 | **a** | 不复活 |
| 15 | LVLM 验证器 + 图优化求解器（Kruskal / 1-swap） | `references.md:141` | 前者"违背「插件不调模型」"；后者"对我们的个位数候选是过度工程" | **a** + **f** | 不复活 |
| 16 | MSCE 的五个 LLM 算子（反思打分/奖励量化/L2 归纳/L3 抽象/技能起草） | `references.md:159` | "违背『插件不调模型』"。**"取确定性判定骨架，弃模型依赖"** | **a** | 不复活（但**骨架**可引入，见 §3.2 #2） |
| 17 | LLM 合并（MemForest）+ 其不可逆性 | `references.md:175` | 不可逆 + 需 LLM；我们保留 `superseded` 调解 | **a** + **f** | 不复活（但"按相似度降序 + 枢纽卡排除"已采纳） |
| 18 | AGPR 时间邻域检索 | 一手出处 `improvement-details-2026-09-17.md:490`（更精确：「**同一天读的两篇无关论文不该互相带出来**」）；转述见 `references.md:175` | "**数学笔记场景里时间相邻 ≠ 内容相关**" | **f** | 不复活（已有外部实证 + 本仓库自陈的表述） |
| 19 | JSON/SQLite 作为事实源 | `references.md:194` | "markdown 文件是我们的特性"；VeryMath 的 `local_reference_db.json` 形态**不照搬** | **a** | 不复活 |
| 20 | 把技能交回 agent 全局 skills 目录**自动发现** | `references.md:194` | "会**扩大工具面**、破坏 `approval: never` + 最小工具面" | **c** | **复活**：独立能力包各自声明工具面与姿态，核心包保持最小面 |
| 21 | **多 agent 蜂群编排与并行证明搜索** | `references.md:194` | "**我们场景是单用户数学学习**" | **产品范围** | **需你拍板**（D0）：你的场景陈述已变 ⇒ 这条否决的**理由本身**被你的新目标推翻 |
| 22 | Danus 的运行姿态 `--dangerously-bypass-approvals-and-sandbox` | `references.md:194` | "自述需隔离可弃主机 —— 与我们 fail-closed **故意相反**" | **c** | **复活但需改造**：新包声明自己的姿态 + 用户显式选择；**核心包不动** |
| 23 | lemmalog（Rust Datalog 记忆引擎） | `lemmalog-assessment-2026-10-01.md` | ①新增一层记忆（在不做清单）②打破 vault 不变量 ③三条通道交付不了 `cargo build` 产物 ④主用法是 MCP 而 preset 够不着 | **a a c c** | **③④不再成立**（见 §7.3）；① ② 仍成立 ⇒ 结论仍是不引入 |
| 24 | "薄记忆模式"（C5/P7） | `pending-decisions-2026-09-26.md:43` | 实测注入 **4088 / 18000**，三档只差 1026 字符 ⇒ 只是多一个旋钮 | **f** | 不复活（触发条件：某层索引被静默丢弃或注入 > 12000） |

### 3.2 现在变得划算的机制（按 价值 × 可负担 ÷ 成本 排序）

| 排名 | 机制 | 为什么现在划算 | 形态 |
|---|---|---|---|
| 1 | **把体检 / 索引 / 捕获搬出每轮路径** | 这不是"一个机制"，而是 §1.1 C2 本身 —— 它同时是下面 2–5 项的前置 | host 后台作业（M2） |
| 2 | **ISM 式七机制独立调度**（Audit → Correct → Merge → Promote/Demote → Prune → Reinforce → Antipattern，`references.md:55`） | 其中**六个是确定性**的（只有 Correct/Reinforce 需要模型），当初它们被做成"模型按协议执行"正是因为**没有后台**。搬到 host ⇒ 六个可直接实现，第七个降级为"体检报告里的一条建议" | host 后台作业（无模型参与的部分） |
| 3 | **依赖 / 失效传播 + 引用图**（#6） | `source` 单向链接 → 引用图是**派生索引**，可由后台 pass 构建并随卡片变更增量更新；不需要新运行时、不是第二真相源 | host 后台作业 + 派生缓存 |
| 4 | **会话全量确定性捕获**（#13 的正向部分） | 仓库自己指出：`$DSH_HOME/sessions/*.jsonl.zstd` **已有全量会话日志**（dialogue index 正在扫它）——"离『全量保存』只差把日志确定性写进 episodes"（`references.md:122`）。这是**零新数据源**的一条 | host 后台作业（0.7.3 引擎已在，只差默认开与搬迁） |
| 5 | **CausalSmith 式成果银行**（`_bank/accepted/<qid>_v1`） | 若"科研"进入范围，"积累"的单位应是**可复用的带验证产物**而非日志；银行同时是**下一轮选题的输入** | 新能力包 + `dsh-storage` 或 vault 侧目录 |
| 6 | **检索质量的可测量化**（GraphMemix 的可达性分层 + 有符号净回收已进引擎探针；可扩到 Avg-R、Cost 与"语料覆盖声明"#9） | 已有探针基建（`engine-probe.mjs`）；纯增量、零依赖 | 现有插件（探针 + 协议） |
| 7 | **Tier B（语义召回）** | 此前"奢侈"的一半原因是**索引构建压每轮**；后台化后降为纯索引维护成本。**但它仍是产品决定（D4）** | 可选能力包 / 可选依赖 |
| 8 | **VeryMath 的门控状态机**（"草稿目标不可执行；目标只有 `status: approved` 才能接收工作流"，`co-math check-gate`，`references.md:187`） | "**门控是状态机、可程序检查**"——在 host 侧就是一个服务 + 一组断言，不需要模型自律 | 核心包或教学包（host 服务） |

### 3.3 无论如何都不会因架构而变的两类

- **因模型不采用而失败**的机制（检索 `note_recall` 13 次、`note_strategy` 1 次、`note_links` 1 次，`handoff.md` §7 的「note 工具族」行）：降低调用成本**不提高调用率**。解法只有"确定性自动执行"或"从模型手里拿走这个选择"。
- **决策类**（#8 深度门、#11 注入层语义、#7 规模地板）：缺的是**证据或拍板**，不是算力。

### 3.4 ★ 最该拒绝的一条：**"用模型再审一遍"**（有一手反例，不只是理由）

这是本报告最该记住的一条拒建项，因为它**看起来最像"加个能力就能提高质量"**：

> **LeanTutor 用 `gpt-4` 当裁判重跑同一套评估，结果 baseline 在几乎每个轴上都压过 LeanTutor——与人工评分相反。**（`literature/cards/patelLeanTutorVerifiedAI2026.md:43`）

即：**模型裁判的输出可以与人工判断**系统性反向**，而不是"稍差一点"。配套的外部论证是 SAFE 的整条方法论（同一模型会犯同样的错，`verification-design-2026-09-18.md:382`，已记为 L11）。

**配套纪律**：任何"模型审查更准 / 更省"的结论，**必须附一次小规模 model-blind 人工校准**，否则不许写进结论。

**次强的三条拒建项是三组"实测为负"的数字**（不是推理，是实测）：

| 拒建 | 实测数字 | 出处 |
|---|---|---|
| 通用去冗余 / 多样化重排 | 净回收 **−6 / −4 / −2 / −36**（MMR / Rel.–Red. / Facility / DPP，均不优于朴素 Top-K） | `references.md:135` |
| 多视图 max-pool | Δ=0 且目标排名均值 **1.73 → 2.27**（0 改善 / 2 变差） | `references.md:140` |
| 时间邻域检索 | 时间相邻 ≠ 内容相关 | `improvement-details-2026-09-17.md:490` |

---

## 4. dsh 0.2.0-rc.2 的插件形态能力矩阵

**取证方式**：遍历本机实装的 `@deepseek-ai/dsh@0.2.0-rc.2` 内置包清单（`<dsh>/node_modules/@deepseek-ai/*`，约 200 个包）与 `dsh-base`/`dsh-web-app` 的 `cordis.patch.yml` 行 id，并读取其 `lib/types/*.d.ts`。**证据强度**列如实标注：`已实测`（本轮有运行或源码引用）· `读类型/清单`（读过声明或行 id）· `仅包名存在`（未取证其 API，用它做设计前必须先取证）。

| # | 形态 | 承载什么 | 实现包（本机实装） | 能后台 | 自调模型 | 证据强度 | 主要限制 |
|---|---|---|---|---|---|---|---|
| 1 | **host 插件 / cordis 服务** | 长期活着的逻辑；注册服务供别的插件 `ctx.inject` | 任意 `apply(ctx)` 插件；`dsh-scope` 决定作用域链 | ✅ | ✅（若注入 `llm`） | 已实测（本插件 host 半、`ctx.effect`/`ctx.on`） | 服务可见性受作用域约束 |
| 2 | **agent preset + preset 插件** | 一个"模式"（人格 + 工具集 + 注入） | `dsh-agent-preset`、`dsh-agent-preset-registry`、`dsh-web-app/presets/*.patch.yml` | ❌（会话级） | 由会话驱动 | 已实测（`agent.cordis.yml` 挂载、`--dump-config` 可验） | 每次新会话按 preset 组合；**preset 是"模式"的自然单位** |
| 3 | **tool 插件** | 给模型调用的动作 | `dsh-tool-*`、`dsh-tools`（`defineTool` + output schema 校验） | ❌ | ❌ | 已实测（本插件 4 个 `note_*`；本轮修好对 0.2.0 校验器的真验证，22/22） | 工具面**直接决定模型能力边界**；schema 必须过宿主校验 |
| 4 | **skill** | 可复用流程/知识，按需加载 | `dsh-skill`、`dsh-skill-filesystem`、`dsh-skill-office`、`dsh-skill-badge`、`dsh-tool-skill` | ❌ | ❌ | 读类型/清单 | 主 dsh 有 skill 中心与工作区级发现；**升级/删除有 UI 语义** |
| 5 | **client / UI 插件** | 浏览器半边（面板、设置卡） | `dsh.client` 清单 + `dsh-client-ui-*` + slots（`settings.section`） | ❌ | ❌ | 已实测（本插件客户端半个：`slots` 服务在 `dsh-client-ui-renderer/lib/client.js:1323`，`inject(key,cb)` `:1343`） | 需 `dsh.client.inject` 声明依赖；热更新受构建链约束 |
| 6 | **host HTTP 路由** | 面板/回调的 HTTP 端点 | `ctx.webServer.register({kind:'prefix'})` | ✅ | ✅ | 已实测（本插件 `/memory-panel/*`，53 项路由回归） | **同前缀重复注册会让整个 profile 起不来**（历史事故） |
| 7 | **命令（斜杠命令）** | 用户显式触发的动作 | `dsh-commands`、`dsh-command-goal`、`dsh-command-compact`、`dsh-command-feedback` | ✅ | ❌ | 读类型/清单 | 面向用户而非模型 |
| 8 | **后台作业** | 长任务、可被查询/取消 | `dsh-jobs`（abstract 服务，`dsh-jobs/lib/index.js:115-118`）、`dsh-jobs-local`、`dsh-tool-jobs`（`job_output`/`job_list`/`job_kill`） | ⚠️ **仅进程内** | 否 | 已实测 | ⚠️ **纠正（2026-10-01 只读取证）**：它**不是调度器**——`dsh-jobs-local/README.md:32` *"jobs should live in the harness process and **die with it**"*、`:61` *"Every record disappears when the harness process exits"*；类型定义里 `interval\|schedule\|cron\|Timer` **零命中**；任务**属于启动它的 agent session**（别的 agent 读不到也杀不掉），唯一 `attachController("tool-jobs")` 在 `dsh-tool-jobs/lib/index.js:256`（**agent 平面**）。**要耐久执行必须自己实现这个契约**（`dsh-jobs` RD:55）。⇒ **每日维护不要建在 `ctx.jobs` 上**，用宿主自己的定时器；`ctx.jobs` 适合"模型发起的长任务"这个原本用途 |
| 9 | **定时 / 自动化** | cron 式重复执行 | `dsh-schedule`、`dsh-client-ui-schedule`、**`dsh-experimental-schedule-bundle`** | ✅ | 可 | 已实测（0.2.0 把"自动化任务"移进**可选 bundle** —— 见 `dsh-0.2.0-adaptation.md` §3.3） | 0.2.0 起**默认不挂**，需显式启用 |
| 10 | **子代理 / Agent Team** | 并行与分工 | `dsh-subagent`、`dsh-subagent-in-process-driver`、`dsh-tool-subagent*`、`dsh-experimental-agent-team*`、`dsh-experimental-tool-agent-team` | ✅ | ✅ | 读类型/清单 + 发行说明 | Team 模式用 `spawn_teammate`、并**关闭 `subagent`/`subagent_fork`**；队友上限 16（0.1.7 起） |
| 11 | **workflow** | 多步编排 | `dsh-workflow`、`dsh-workflow-ptc`、`dsh-tool-workflow` | ✅ | ✅ | 读类型/清单 | 0.1.7 起执行器改为 `workflow-ptc`，遵循会话文件策略；**不支持 Python PTC** |
| 12 | **MCP 客户端 / 资源** | 接**外部**工具服务 | `dsh-mcp-client`、`dsh-mcp-resources` | ✅ | ❌（工具由外部服务实现） | 读类型/清单 | **外部工具接入的首选面**（Lean LSP、DB、检索服务、arXiv 等）；0.1.7 起支持资源发现与 URI 模板 |
| 13 | **webhook** | 外部事件触发 | `dsh-webhook`、`dsh-webhook-github` | ✅ | — | 读类型/清单 | 入站触发；适合 CI/仓库事件 |
| 14 | **storage** | 宿主侧持久状态 | `dsh-storage`、`dsh-storage-json`、`dsh-storage-domain` | ✅ | — | 已实测（`lib/types/index.d.ts`：**`root` 故意无默认值**——`process.cwd()` 回落会到处撒数据） | 后端是"文件树根或数据库文件"＋操作组；**不自动给默认 root**，插件必须显式选 |
| 15 | **LLM provider / 适配器** | 模型通道与默认模型 | `dsh-llm`、`dsh-llm-pi-ai`、`dsh-llm-deepseek*`、`dsh-agent-default-model` | ✅ | ✅ | 已实测（本机 profile 用自定义 `penguin` 路由挂 `dsh-llm-pi-ai`） | 目录/ID 随上游变动（0.2.0 提到 pi-ai 0.87.1 移除部分旧 ID） |
| 16 | **hooks（工具调用拦截）** | 外部 CLI 的钩子兼容层 | `dsh-hook-protocol`、`dsh-hooks-claude-code`、`dsh-hooks-codex` | ✅ | ❌ | 已实测（**本机 `$DSH_HOME/cordis.patch.yml` 正是用 `dsh-hooks-claude-code` 挂 `pretooluse-guard`**） | ⚠️ **纠正**：**它不是给 native 插件用的**——`dsh-hook-protocol` RD:32 原文 *"Avoid the whole group for bespoke behavior with no reference-tool equivalent: **a native Cordis plugin has the full harness API with no hook protocol in between**"*；只有 command hook 会跑，`continue:false` 无 run 级效果。⇒ 要**守卫/拦截/改写工具调用**，落点是 **`tools/pre-execute` waterfall + `ctx.tools.guard()`**（`dsh-tools` RD:85）。hook 协议只用于"让外部 CLI 的既有钩子在本机生效" |
| 17 | **会话/事件观察** | 读会话历史（记忆的数据源） | `dsh-session`、`dsh-session-projection*`、`dsh-session-query*`、`dsh-session-format*`、`dsh-session-log-*` | ✅ | — | 已实测（本插件扫 `$DSH_HOME/sessions/*.jsonl.zstd`；V4 世代号判据） | 会话格式有版本迁移（V1→V4），**必须按世代号择优** |
| 18 | **压缩 / 输出策略** | 上下文与输出治理 | `dsh-compaction-*`、`dsh-output-retention`、`dsh-spill-local`、`dsh-spill-policy` | ✅ | 可 | 读类型/清单 | 与注入预算同域，新增能力要核对预算 |
| 19 | **沙箱 / 审批 / 权限表** | 安全姿态 | `dsh-sandbox-*`（含 `dsh-sandbox-windows-acl`）、`dsh-permission-presets`、`dsh-user-approval` | — | — | 已实测（本插件 profile 层写 `permission`/`approval`/`sandbox-policy`；0.2.0 有"组合出的默认值必须命中某 preset"的启动检查） | **每加一个能力包就要各自声明姿态**；0.2.0 起 home 层 patch 会**压过** profile 层（见 `dsh-0.2.0-adaptation.md` 陷阱 109） |

### 4.1 组合机制（回答"一个包 vs 多个包"）

| 问题 | 机制 | 证据 |
|---|---|---|
| 多个第三方插件如何进同一个 profile？ | `package.json` 的 `dsh.profile.bundles` ∪ `dependencies`，加上 profile 自己的 `cordis.patch.yml` 与 `--patch` overlay；`dsh plugin add` 负责装与登记 | 已实测（本插件三条通道；`docs/dsh-native-refactor.md` §2–§3） |
| **0.2.0 的新优先级** | `$DSH_HOME/cordis.patch.yml`（home 层）**压过** profile 层；同 id 会被静默覆盖，且配置编辑器**拒绝**保存被 home patch 覆盖的行 | 已实测（陷阱 109） |
| A 插件如何把能力给 B 插件？ | cordis 服务注入（`ctx.inject`）＋作用域链（`@deepseek-ai/dsh-scope` 的 `bindScopeParent`/`createScope`）。preset 由 roster 挂在**同一棵树的 standing scope** 下 ⇒ host 服务在作用域链上可见 | 已实测（`dsh-scope` 引用；`agent.cordis.yml:15-16` 的注释"mounts it once under a standing scope"） |
| preset 是"集合"的自然单位吗？ | **是"模式"的单位，不是"包"的单位**。一个 preset 声明自己的 plugin 行列表 ⇒ 可以按模式（学习模式 / 科研模式）给不同插件集 | `agent.cordis.yml` 的 plugins 列表；`dsh-web-app/presets/*.patch.yml` |
| 同一能力被装两次会怎样？ | ⚠️ **要分两种，别混**：**① 重复 `(kind,path)` 的 web 路由 ⇒ 真的 throw**（阻碍启动）；**② 重复 loader entry id ⇒ 源码里只是"静默复用同一个 Entry"，没有找到显式拒绝逻辑**（`cordis-plugin-loader` LOADER:58-60/81-82）。⇒ dsh-web 的"聚合行 id 加命名空间前缀"是**主动避免歧义**的工程习惯，而"同 id 两次一定起不来"目前**只有二手来源、未复现** | ① 已实测（`WEB:179`）；② 2026-10-01 只读取证**未复现**，标为未取证（建议在隔离 `DSH_HOME` 里用故意重复 id 的 patch 跑 `--dump-config` 复现） |
| 版本兼容门控 | 按**包**读 `peerDependencies` 里 `@deepseek-ai/dsh*`，`includePrerelease: true`；**不声明 = 不检查**；不兼容时**exit 0 + 一行 stderr**（bundle 层被跳过） | 已实测（`dsh-app-boot/lib/index.js:289/294/300`；陷阱 112） |

### 4.2 ★ 关键纠正：扩展单位是「插件行 + 补丁层」，不是"插件包"

2026-10-01 的只读取证给出了一条**改变整个问题形状**的结论：

> **dsh 的扩展单位是「cordis 插件行 + 补丁层」。一个 npm 包可以同时是：host 插件（`insert` 一行）+ bundle（`dsh.bundle.patch`）+ preset 提供者（`@deepseek-ai/dsh-agent-preset` 一行，内含 N 行子插件）+ client 半个（`dsh.client` / `./client`）+ 技能目录（`customSkillDirs` 指向包内 `skills/`）。**
> 本仓库 `package.json:47-50` + `dsh/cordis.patch.yml:20-44` **就是这个四合一的现成实例**。

⇒ **"一个巨型插件 vs 多个散包"是假二分。** 真正的三个单位是：

| 单位 | 是什么 | 可变性 | 决定什么 |
|---|---|---|---|
| **bundle（包）** | 一个能力集 | 可 `dsh plugin add` / 可启用禁用 / **有独立版本与兼容门控** | **交付与故障隔离** |
| **preset 行** | 一份 agent 组合（人格 + 工具集 + 注入） | **按会话选，一个进程可并列多个** | **"模式"**（学习模式 / 科研模式） |
| **profile 层** | 部署姿态（沙箱 / 审批 / 权限表 / 默认 preset / workspace root） | **安全敏感、权限表是闭表** | **安全边界**（study profile vs research profile） |

**三条直接可用的推论**：

1. **要"多个模式"就出多个 preset 行，不要多出包**（S2 §2.6）。"严格证明模式"与"草稿模式"只差一个插件行的 `config`。
2. **要不同权限档，就出不同 profile**（因为权限表闭表且 per-profile 固定）——这比"给每个能力包配姿态"更接近 dsh 的真实语义（见 §2.1 边界②的细化）。
3. **跨包耦合只走 host 服务与事件**（§4.1 前两行），**不要互相 import 源码**——否则就是把"引擎三份"的耦合复制成"N 份清单"。

**19 种形态里只有 6 种是"第三方可自开/可换实现"的 seam，且都是"一个 context 一份实现"**（第二个载入即失败）：`ctx.jobs`、`ctx.spillStore`、`ctx.compaction`、`ctx.sessionQuery` 的 search 面、`ctx.workflowEngine`、`ctx.llm` 的 provider 路由。**能"加能力且与别人并存"的是注册表式服务**：`ctx.tools` / `ctx.skills` / `ctx.commands` / `ctx.webServer` / `ctx.storage` / `ctx.webhookRuntime` / slots。⇒ **想做"持久后台/数据库/检索后端"，要写的是"实现某个 abstract 契约的独立包"；想"加一类工具"，写在现有包里即可。**

### 4.3 建议的形态决策树（照它走，别按话题切包）

1. 外部世界**已经有 MCP server** 吗（Lean LSP、SQLite、Zotero…）？→ **先用 `dsh-mcp-client` 一行 config 验证，零代码**（连不上只记日志，`failOnStartupError:false`）。
2. 要的是"提示词/流程知识"吗？→ **skill**（包内 `skills/` 目录 + `customSkillDirs`）。
3. 要的是"模型调用的确定性动作"吗？→ **tool**（一个包可注册多个工具 ⇒ "数据库工具集"不必是多个包）；**要长跑就走 job producer + `job_output` 收结果**，不要阻塞工具调用。
4. 要"每个模式不同的组合"吗？→ **新的 preset 行**，不是新包。
5. 要"换掉某个单实例能力（存储 / 后台 / 压缩 / 检索 / 工作流引擎）"吗？→ **新包实现那一个 abstract 契约**（后端契约带 conformance suite）。
6. 要"人直接触发的入口"吗？→ command / webServer 路由 / webhook。
7. 要"UI 面"吗？→ **独立 client 包**（`dsh.client` 是包级声明且需要构建产物）。
8. 要"不同权限档"吗？→ **改 profile 的 `dsh-permission-presets` config 或换 profile**；**不能加 preset**。
9. 要"独立发布节奏 / 不同 dsh 兼容面"吗？→ 拆包（失败互不拖垮是分包的直接收益）。

### 4.4 由此得到的三条结论（替换旧版本）

1. **"核心包 + 能力包 + 桥 + 聚合包"在 dsh 上完全可行**，而且每一格都有现成形态（上表 19 类）。
2. **能力包之间不要互相依赖**：走 host 服务注入（形态 1）或 MCP（形态 12），而不是互相 import 源码——否则就是把"引擎三份"的耦合复制成"N 份清单"。
3. **"研究模式"应该是一个 preset，不是一个包**：preset 天然是"模式"的单位，而包是"生命周期与姿态"的单位。这正好对上 §2 的判据。

---

## 5. 插件目录：按八层组织 + 每类的最小可用版本

### 5.0 前置：本机外部工具链实测（2026-10-01，决定"可选"还是"当前不可行"）

| 工具 | 状态 | 说明 |
|---|---|---|
| Node / npm / pnpm / git | ✅ `v24.14.1` / `11.12.1` / `11.21.0` / 有 | 基建齐全 |
| **`node:sqlite`** | ✅ **内置可用**（`DatabaseSync`/`StatementSync`/`Session`/`backup`，Node 24） | ⇒ **"要不要数据库"不需要装任何东西**（见 §8 D2） |
| **Python** | ✅ **3.14.5**（`python` 与 `py -3` 均可） | ⇒ 统计计算与脚本中介写入**本地可行** |
| **Rust / cargo** | ✅ `E:\rust`（含 mingw64 `gcc`） | ⇒ Rust 工具**本地可构建**（对 lemmalog 的重新裁定有影响，见 §7.3） |
| **TeX Live 2026** | ✅ `D:\texlive\2026`：`pdflatex`/`xelatex`/`lualatex`/`tlmgr`/`latexmk` | ⇒ 论文/讲义渲染**本地可行** |
| **R / Rscript** | ❌ **不存在** | ⇒ 统计能力先做 Python；R 只能作为"可选外部依赖" |
| **Lean / elan / lake / Mathlib** | ❌ **完全不存在**（连 elan home 都没有） | ⇒ 形式化验证**绝不能进核心**；且装齐是 GB 级 + 小时级（见 §7.2 的成本） |
| `pandoc` / `tectonic` / `z3` / `jupyter` / `sqlite3` CLI / `zstd` | ❌ 均不存在 | `zstd` 不影响本项目（会话日志解压走 Node 内置 zlib）；`pandoc` 会挡 CausalSmith 式 `present` |

> **这张表改变了三个候选的结论**：Python 计算与 LaTeX 渲染是**本地可做**的；R 与 Lean 是**必须可选/外部**的；数据库**根本不需要新增依赖**。

### 5.1 目录（27 项，按八层）

标记：**M** = memory-adjacent（进核心包，做成 tool/skill/后台作业）· **N** = 需独立能力包 · **MCP** = 走外部桥。

#### A 采集

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| A1 | **会话全量确定性捕获** | `references.md:122`（`$DSH_HOME/sessions/*.jsonl.zstd` 已有全量日志；"离全量保存只差把日志确定性写进 episodes"）；Obelisk 的"不依赖模型自觉写" | **M**（后台作业；0.7.3 引擎已在） | 把 `sessionCapture` 的确定性写入从 preset 搬到 host 后台，并按世代号择优 | 隐私与体积（需保留 vault 过滤 + 尾截断） |
| A2 | 文献导入与卡片蒸馏 | 仓库已有 `scripts/lit-import.mjs` + 语料 34 篇 + 源质量教训（`references.md:142/161/177`） | **M**（tool + 后台作业） | 已实现；可加"源质量标记（MinerU 破坏 vs `pdftotext` 复核）"字段 | — |
| A3 | 文献元数据补全与**稳定类型化 URI** | `references.md:189`（`paper:arxiv:YYYYMM.NNNNN#Thm-1`；**明令禁止**自然语言式链接；取不到强制填 `[UNKNOWN]`，"严禁大模型推测或编造"） | **M**（数据契约 + tool） | 给 `literature/` 与卡片加 `uri` 字段 + 一条确定性校验（缺则 `[UNKNOWN]`，禁猜测） | 需要网络（姿态变化） |
| A4 | 会话→claim 抽取（把对话里的数学断言抽成待验证条目） | `references.md:187`（报告必带溯源与不确定性）；#2 的"写路径" | **N**（需要模型 → 属新包） | 只做抽取 + 落 `inbox/`，**不判定真伪**；判定交现有体检 | 与"插件不调模型"红线冲突 ⇒ 必须在新包里 |
| A5 | **★ 来源质量审计**（本报告原先漏掉的一层） | **本仓库一手实证**：MinerU 对某 PDF 有系统性 `<sub>` 破坏——**5 613 个标签 / 3 954 处词中被切开** | **M**（后台作业 + 卡片字段） | 给每篇文献记"源质量"字段（干净 / 需 `pdftotext -layout` 复核）+ 一条确定性检查（标签密度、词中切分比例） | 离线可做；**这正是"文献驱动"最容易静默出错的地方**——本仓库已经踩过一次（`docs/literature.md:157`） |

#### B 表示

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| B1 | 记号/术语唯一事实源 | `references.md:184`（VeryMath `glossary.json` 为唯一源、Excel 仅导出）；仓库已有 `notation.md` | **M** | 把 notation 从"注入文本"升为**机器可读表 + 派生注入** | 与现有 800 字符预算协调 |
| B2 | **事实图 + 内容寻址 + 可级联撤销** | `references.md:188`（Danus：3 157 条已验证事实 / 8 616 条依赖边 / 最深 54；"只有经验证器门控的事实图是真相，全局记忆只是认知"） | **N** | 先做**只读派生图**（从卡片 `source`/`depends_on` 建），不上"真相源" | **它是第二条正确性边界**——与"vault 是唯一真相"必须划清（见 §8 D2） |
| B3 | 引用图 / 前置依赖图 | `design-intake-2026-09-10.md:35`（"属于新子系统"） | **M**（后台派生索引，见 §3.2 #3） | 从 `[[链接]]`+`source`+`depends_on` 建图，输出"下游待复查"与"结构枢纽" | 规模地板（小语料上没意义） |
| B4 | 模板-定理关联图 | `references.md:30`（AAAI-26 40411，已映射 `templates/` + `related_theorems`） | **M** | 已实现；可加"模板聚类候选"（§3.1 #7 的触发条件） | 聚类抖动 |

#### C 计算

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| C1 | **统计计算与可复现运行** | 本机 Python 3.14 ✅；`references.md:194`（VeryMath"脚本中介写入"、"每次更新必须通过脚本原子执行，禁止 LLM 读全量再手工覆写"） | **N**（需要 shell → 姿态②） | 一个受限执行器：**只允许**跑工作区内的脚本、记录种子/输入哈希/产物清单；结果写 `episodes/` | 姿态放宽 = fail-closed 边界变化（用户必须显式选） |
| C2 | 实验/运行台账 | 同上 + MSCE 的"Cost 必须与效果合看"（`references.md:158`） | **N** 或 **M**（取决于是否执行） | 只做**记录**（种子、数据哈希、命令、产物路径），不执行 | — |
| C3 | 统计方法选择（该数据该用什么检验/模型） | 语料**有限支持**：因果推断侧有 `Causalean`（backdoor/frontdoor/IV/DID/LATE、部分识别、半参估计）；经典频率派选择规则**语料沉默** | **M**（skill/协议）+ 需外部调研 | 手写一张"问题类型 → 方法族 → 前提假设 → 常见误用"的确定性查表（**不调模型**） | 查表覆盖面；`math-note-fault-taxonomy` 已有错误形态学可复用 |
| C4 | 论文/讲义渲染 | 本机 TeX Live 2026 ✅ + `latexmk` ✅ | **N**（或 MCP） | 从 vault 的 md 生成 PDF，产物回链到卡片 | 需要 shell；路径/编码在 Windows 上易错 |

#### D 验证

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| D1 | **Lean 形式化辅助** | `references.md:87-94`（LeanSearch v2：结构化 passage、sketch-retrieve-reflect、**空结果是信号**）；`references.md:21-25`（Rethlas：生成-验证循环 + 推理原语 + 定理检索纪律） | **MCP**（本机**无 Lean**，见 §5.0） | 只做**接口与纪律**：把"展开定义 / 核对适用性 / 读证明提取可迁移技巧"写成 skill 协议；真正编译交给外部 MCP（`lean-lsp-mcp`） | 依赖用户自装 Lean + Mathlib（GB 级、小时级） |
| D2 | **确定性验证门控**（写入前过校验） | `references.md:57`（ISM"每次记忆更新都过符号验证"）；`references.md:150`（MSCE 三道确定性插入校验） | **M**（后台作业） | 把现有体检的"结构校验"升级为**写入前门控**：schema 齐全 / 证据接地 / 覆盖测试，任一不过 ⇒ 拒写并报告 | 拒写会打断模型流程 ⇒ 需 `degraded` 式回执 |
| D3 | 反例 / 边界检查 | ISM 的 Antipattern（`references.md:55`）+ 仓库已有 `hook.boundary` / `not_applicable_when` | **M** | 已有硬门控；可加"失败尝试必填"（见 D5） | 误报 |
| D4 | 论文终稿的"数学验证器通读" | `references.md:188`（Danus 交付前再经一次论文数学验证器） | **N** | 交付前的**独立复核**步骤（不同模型/不同会话，见 F2） | 需要模型 |
| D5 | "失败尝试 + 不确定性是产出必填项" | **三方同向**：`references.md:193`（VeryMath + MSCE 反证据 + GraphMemix 低价值轨迹保留） | **M**（数据契约 + 体检断言） | 给 cards/episodes 加 `failed_attempts` / `uncertainty` 字段并在体检里报缺失 | 可能被视为噪音 |
| D6 | **★ 判定工具一致性（前置质量门）**（本报告原先漏掉的一层） | **本仓库一手证据**：LeanDojo 的判定工具一致性把评测噪声从 **21.1% 降到 1.4%**（`literature/cards/yangLeanDojoTheoremProving2023.md:45`） | **M**（体检前置断言） | 在信任任何"通过/失败"计数之前，先断言**判定工具本身一致**（同一输入两次判定一致、版本固定）；不一致就把结论标为不可用 | 与 §3.4 的 model-blind 校准配套：**先证明量尺准，再量东西** |

#### E 检索

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| E1 | **查询 = 推理步骤而非关键词** | `references.md:69-72`（AgentIR：联合嵌入"当前轮推理 + query" 48.7→55.5%；**"历史不是资产"**；原子线索）；`:79`（RaDeR：term-matching 在推理相关场景失效） | **M**（已有雏形，v3 升级为结构化协议） | 查询 = 当前轮"挑战描述 + 候选技巧"，**绝不拼接历史对话** | 需协议纪律 |
| E2 | **四层检索**：词法 → 类型模式 → goal 反查 → 语义 | §7.2（CausalSmith 实证四层）；`references.md:88`（LeanSearch v2 的 sketch-retrieve-reflect） | **M** + Tier B 可选 | 先做第三层的**零 token 版**：模型先给证明草图，再对每个子目标分别 `note_recall` | goal 反查需 Lean 类型系统；通用笔记没有等价物 |
| E3 | **空结果是信号** | `references.md:88`（"∅ 是信号：区分『检索到支持』与『没检索到有用的』，top-k 规则会把两者混为一谈"） | **M**（协议 + 返回形状） | 让 `note_recall` 显式区分"零命中"与"低分命中" | 已有协议条款，缺机器可读形状 |
| E4 | 结构化 passage（按类型分组） | `references.md:87`（结构化 passage 模板 + definition 类单独调优）；GraphMemix 多视图 max-pool **实测不采纳**（`references.md:140`） | **M** | 已实现；可加"按 card.type 分组组装"（部分已在 v3） | 已实测过一个变体为负 ⇒ 必须 A/B |
| E5 | 自适应 k / 开链成本 | `references.md:133`（GraphMemix 式 10–12：孤立记忆要自证 `p_i > κ` 才值得单开一条链） | **M**（需拍板） | 先**测量**（探针报"若用自适应 k 会少开几条链"），不改默认 | 移动既有排序 |
| E6 | 语料覆盖声明 | `design-intake-2026-09-10.md:38` | **M** | `note_recall` 返回"本次实际看了语料的多少" | — |

#### F 协作

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| F1 | **成果银行**（可复用的带验证产物） | §7.2（CausalSmith `_bank/accepted/<qid>_v1`；银行是下一轮选题的输入） | **N**（+ `dsh-storage` 或 vault 目录） | 目录约定 + 一个 `bank` 索引工具；每次"通过评审的结论"落一份带证明/证据链的产物 | 与 episodes 的边界（证据 vs 结论） |
| F2 | **分工式多智能体**（发现/证明 与 复核/判定 用**不同模型**） | §7.2（CausalSmith 驱动 Codex + Claude，两者缺一不可）；仓库既有**评审独立性**约定（`design-intake-2026-09-10.md:28`："评审者拿任务+产物+证据，**不拿求解者的推理过程**；分歧时不做多数表决，去找判别性证据"） | **N**（需 subagent → 姿态③） | 一个"研究 run"编排：提案 → 证明尝试 → **独立复核**（不共享推理链）→ 存稿 | **这是 §3.1 #21 那条否决的直接翻转**，需要你拍板 D0 |
| F3 | **权限由构造强制，而非提示词** | `references.md:188`（Danus：主 agent **没有** `fact_submit`、验证器**只读**；"权限由 MCP 角色表强制，不是靠提示词"）；`references.md:187`（VeryMath 门控是**可程序检查的状态机**，`co-math check-gate`） | **架构原则** + **N** | 把关键动作拆给不同角色：**写入者不能自证**；门控用 host 服务 + 断言实现 | 需要工具面/角色表设计 |
| F4 | 技能移交记录 | `references.md:192`（`skill_handoffs.jsonl`） | **M** | 追加式 JSONL：何时判定任务属哪个技能辖区 | — |

#### G 教学

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| G1 | **理解状态与卡点**（1.0 缺口①） | `README.zh.md:18-24`（"现在记的是『问过什么/结论是什么』，不是『理解到哪、卡在哪、下一步练什么』"）；`design-intake:35`（依赖/失效传播"最接近缺口 (a)"） | **M**（新字段 + 后台汇总） | 新增"理解状态"卡类型：`理解到哪 / 卡在哪 / 下一步`，由后台从 episodes 汇总候选、**不自动改写** | 自动推断会猜错 ⇒ 只提案 |
| G2 | **技巧的调用体系**（缺口②） | GraphMemix 六角色（`references.md:132`：`new_fact/clarification/corroboration/redundant/conflict/irrelevant`，Acc +2.00 / R@10 +3.00）；MSCE 决策指导 `d=(c,a⁺,a⁻,e,ξ)`（`:152`） | **M** | 给策略卡加"何时用/何时不用/失败后换哪条/与哪几条组合"四问的**结构化字段**，检索时按角色门控 | 这是缺口②最缺的一环；但**落地方式是角色门控而非列表惩罚**（`references.md:135` 已实测"通用去冗余无价值甚至有害"） |
| G3 | **主动教学闭环**（缺口③） | VeryMath 四类工作流 `proof/computation/literature/review` + "每份报告必须带溯源、显式不确定性、失败探索记录与独立评审，终稿只从通过评审的报告渲染"（`references.md:187`） | **N**（教学包） | 一个"讲解 run"：诊断 → 提示（分级）→ 检验 → 复盘，四步各有产物；**先文档后实现**（`design-intake:34` 的前置顺序） | 与 #10 分区写入耦合（它是闭环的存储形态） |
| G4 | 复习调度（缺口④） | **语料沉默**（`references.md` 15 条里没有间隔重复论文） | **M**（后台作业） | 最小版：体检按 `last_used` / `not_applicable_when` / `success_rate` 产出**复习候选**（不做 SM-2 式算法） | **需外部文献调研**才能真正设计 |

#### H 治理

| # | 能力 | 依据 | 形态 | 最小可用版本 | 风险 |
|---|---|---|---|---|---|
| H1 | 写入原子性 + "模型只提案"契约 | `references.md:185`（VeryMath："**禁止 LLM 读取全量 JSON 后手工编辑并覆写**"；配 `upsert_paper.py` 原子写） | **M**（契约 + 体检检测） | 把"模型整体重写统计字段"纳入体检检测（`improvement-intake` P0-5） | — |
| H2 | 增量回执 `+ ~ ! ⚠` | `references.md:186`（"无变更不输出"） | **M** | 已有意延后（`improvement-intake` 第 5 项）⇒ 触发条件满足再做 | 文案改动会动 153 处中文断言 |
| H3 | 来源与验证等级 + `origin` 字段 | 仓库已有 `verified`/`verified_by`；`pending-decisions` C7（写入时来源字段由**宿主**写、模型不可改） | **M** | 加 `origin: user/agent/imported`，注入层**只显示不排序**（C7=A） | 老卡显示"来源未知"（不静默降级） |
| H4 | 预算 / 隐私 / 陈旧提醒 | `references.md:190`（7 天未读、30 天冷落 + 四个处置选项） | **M** | 把"陈旧"判据从笔记扩到文献库 | 提醒疲劳 |

### 5.2 目录的三个结论

**① 计数**：27 项里 **19 项是 memory-adjacent**（M）⇒ **"插件家族"的主体其实是现有插件要长出的能力**；真正需要新包的 **8 项**恰好就是跨了 §2.1 四条边界的那 8 项（需要模型 A4/D4/G3、需要 shell C1/C4、需要外部工具链 D1、需要存储与角色 F1/F2/F3）。

**② 文献侧打分前八名**（价值 × 语料强度 ÷ 成本；**前四项都是"一个字段或一条判据"，实证最硬**）：

| 排名 | 能力 | 得分 | 语料强度（实证来源） |
|---|---|---|---|
| 1 | **`origin` 来源绑定**（写入时由宿主写、模型不可改；C7/N1） | **20** | **机检 + 8 模型实测**；Louck Table IV：去掉来源绑定，ASR 回到 44/28/22（`memory-fidelity-papers-2026-10-01.md:50`） |
| 2 | **暴露 × 结局配对**（`retrieval-stats.json` 加 `outcome` 槽；C9/N3） | **20** | Xiong ACL 2026 §4.1 式 2（`:52`） |
| 3 | **固化输入隔离**（写记录那一轮不注入旧抽象索引；C10/N2） | **20** | Zhang Table 5 B 行 **50.0 vs 70.0**——**本批最大单项差**（`:51`） |
| 4 | **独立共证门槛**（不共享上游才算两票；C8/N4） | **16** | Louck Table X：相关共证 naive **67% → 域感知 0%**（`:53`） |
| 5 | 等级章对账 + 体检纳入笔记层 | 10 | **本仓库一手实证**：Cramér–Rao 真实实例（`math-note-fault-taxonomy-2026-09-18.md:404-408`）；`:501`「最贵的错是『等级盖错章』」 |
| 6 | 数值反代候选筛选 + 代入点规范 | 10 | **本仓库一手**：一次 20 行代入抓到唯一确认的硬错（`verification-design-2026-09-18.md:171-182`）；**代入点必须覆盖非对称/边界/退化**（μ=0 时完全正确、μ=1 时差 16%）。**需要 shell 才能"跑"** |
| 7 | `unverifiable` 四态 + 原因码 | 8 | SAFE **30 809 条**陈述的统计（`literature/cards/liuSafeEnhancingMathematical2025.md:44`） |
| 8 | 策略卡「失败后换哪条 / 如何组合」两个字段 | 6.7 | MSCE 骨架 + **w/o Value Calibration 每域掉分**；机制描述见 GraphMemix 六角色 |

**③ 语料沉默之处（确认，不是反驳）** —— 这几项**不能**以"文献支持"为由推进：

| 缺口 | 核查结果 |
|---|---|
| **④ 复习调度（间隔重复）** | **确证沉默**：34 张卡里 `间隔\|复习\|遗忘\|forget\|decay\|衰减\|Anki\|schedul` 共 6 处命中，**全部**是检索权重或写侧排程（AgentIR 的"遗忘是特性"、MemoryOS 的 Heat 衰减、BeliefMem 的 `λ^τ`、MemForest 的 AGPR、Zhang 的 update schedules）——**没有一处是学习科学意义的复习安排** ⇒ 要做得先补外部文献 |
| **① 理解状态与卡点** | 只有**机制描述**、无实证：Rethlas 的 status 文档 + 停滞检测 |
| **③ 主动教学闭环** | 有**几乎逐字命中**的一篇（LeanTutor：诊断→提示→检验→复盘三模块 + 21 条人工评估 + Answer Leakage 约束），**但它全程依赖 Lean，而本机无 Lean**（§5.0）⇒ 只能借"形状"，不能借"实现" |
| **C3 统计方法选择** | **复核后确认沉默**（经典频率派方法选择规则不在语料内；因果推断侧有 `Causalean` 的识别理论，但那需要 Lean） |

**④ 第 4 问的答案**：可做的**真正新插件**按性价比排序是 **F1 成果银行 → C1 计算/可复现 → F2 分工式多智能体 → G3 教学闭环 → D1 Lean 桥 → C4 渲染 → A4 claim 抽取 → B2 事实图**。其余 19 项应先做成现有包里的 tool / skill / 后台作业。

---

## 6. 分阶段建设方案

> 每一阶段都写四样：**目标** · **触及的文件与边界** · **验收判据**（可执行）· **必需的变异验证**（"它在该报错时确实报错"）。最后一行是**退出条件**（什么时候该拆包）。
> 纪律沿用本仓库既有约定：改 `dsh/**` 必须重建 `main.js`；新增守卫必须做变异验证；一条提交做一件事；**不碰真实 vault**。

### M0 · 前置：把决策问清楚（零代码）

| 项 | 内容 |
|---|---|
| **目标** | 拿到 §8 的 D0–D6 + N-A/N-B + L12 的表态。**在此之前不动任何代码**——这轮已经踩过一次"对着错的问题开工"的边缘 |
| **产出** | 本文档定稿 + `docs/pending-decisions-2026-10-01.md`（把待拍板项收在一处，格式照 `pending-decisions-2026-09-26.md`） |
| **验收判据** | 每个 D 项都有明确选择或明确的"暂不决定"；`check-doc-consistency` / `check-doc-counts` 仍绿 |
| **变异验证** | 不适用（无代码） |

### M1 · 引擎归一（**纯重构、零行为变化**）

| 项 | 内容 |
|---|---|
| **目标** | 消掉"三份引擎"里**机械重复的那部分**，把改动面从 3× 降到 1×。**不改任何行为**——这是它安全的原因，也是它的全部价值 |
| **触及** | `dsh/preset/math-memory.mjs`（3 975 行）与 `dsh/host/memory-admin.mjs`（1 567 行）的 23 个同名符号 → 收敛为"规范实现 + 同名 shim"（`dsh/preset/engine-shared.mjs` 已验证这套手法）；`obsidian/main.template.js` 的内嵌 loader 与其 20 个再导出（`main.js` **−76 KB**）；`scripts/check-engine-sync.mjs` 的 `KNOWN_ESCAPES` 同步删条目（**条目过期也是失败，这是故意的**） |
| **边界** | 不跨 §2.1 四条中的任何一条 ⇒ **不拆包** |
| **验收判据** | ① `npm test` **54/54**，其中 `test: memory regression` 必须仍是 **427/427**（纯重构不得改变断言数）；② `check: main.js bundle freshness` 逐字节绿；③ `main.js` 体积**下降**（记录实际字节）；④ 两条嵌入门禁（`check-embedded-loader` 278 行 / `check-embedded-writers` 111 行）**可以退役**——退役前必须证明它们覆盖的性质已由 `check: client package layout` 与 `test-panel-routes` 承接 |
| **变异验证** | ① 把某个共享助手的**两份实现改得不一致** ⇒ `check-engine-sync` 必须红（若退役了守卫，则改由"面板路由回归"红）；② 改 `memory-admin.mjs` 的一个写入行为 ⇒ `test-panel-routes` 必须红（这是"引擎漂移一定被路由回归看见"的证明） |
| **退出条件** | 若发现某个符号的"两份"其实是**有意不同的产品行为**（`KNOWN_DIVERGENT` 里那 6 条），**不要合并**——登记理由即可 |

### M2 · 每轮路径瘦身 + 宿主侧持久化（**这一步才真正解锁复杂设计**）

| 项 | 内容 |
|---|---|
| **目标** | 把**每轮固定成本**降到接近零：对话索引的**指纹扫描与首轮全量重建**移出 `system-prompt/assemble`（`math-memory.mjs:4197-4233`），改由 host 侧维护一份持久结果，preset 只读 |
| **触及** | `dsh/preset/math-memory.mjs`（注入路径改为"读宿主落盘结果"）；`dsh/host/`（新增持久化 + **宿主自己的定时器**）；`dsh/preset/agent.cordis.yml`（`cacheTtlMs` 语义） |
| **⚠️ 关键约束** | **不要用 `ctx.jobs` 承载周期维护**（它不是调度器、任务属会话、进程退出即消失，见 §4.1）。选择：宿主自己的定时器（`@deepseek-ai/cordis-plugin-timer` 已在 `dsh-base` 的 `timer` 行）或自实现一个 durable 后端 |
| **边界** | **跨了 §2.1 边界②**（host 要不要执行本地进程 → **N-B**）与**边界①**（派生缓存 vs 权威存储 → **N-A**）⇒ **M2 的开工前提是 N-A/N-B 已拍板** |
| **验收判据** | ① 注入**字节数不增加**（记录前后实测；当前真实库三档 9318/10213/11252，硬上限 18000）；② 每轮 `system-prompt/assemble` 的**文件 I/O 次数下降**（可用探针量）；③ **宿主侧结果与"现算"逐字节一致**（这是一条确定性等价断言，不是"看起来对"）；④ **后台失败不拖垮会话**：杀掉/破坏宿主侧持久化后，preset 必须**降级为现算**而不是报错 |
| **变异验证** | ① 让宿主侧结果**故意过期**（改一个索引文件）⇒ 必须有断言抓到；② 让宿主侧**完全不可用** ⇒ 会话仍能起、注入仍非空（降级路径）；③ 把 `cacheTtlMs` 改回 0 ⇒ 每轮 I/O 断言必须红 |
| **退出条件** | 若降级路径需要把"现算"整份保留在 preset 里，那 M2 的收益会被吃掉一半 ⇒ 此时应改为**只把"重"的部分（首轮全量重建）搬走**，保留轻量指纹 |

### M3 · 家族骨架：1 monorepo × N 包 × 2–3 profile（**先立地基，再谈能力**）

| 项 | 内容 |
|---|---|
| **目标** | 立起可复用的家族地基，**此时不新增能力**。核心是把三条边界处的地基打对：id 命名空间、版本下限、装完自检 |
| **触及** | 仓库结构（是否转 monorepo **需你拍板**，见 §8 D7）；`package.json` 的 `dsh.engines.dsh` **与** `peerDependencies` 同值（本仓库已有的规则，**dsh-web 独立做了同一件事**并多两条约束：只认 `>=` 形式、下限不得低于模板 cohort 下限）；每个新包自带 `cordis.patch.yml` + `dsh.bundle.patch`；**id 命名空间**（dsh-web 用 `web-ui-` 前缀）；profile 模板 ×2（study / research）；`--dump-config` 自检脚本 |
| **边界** | 这一步**定义**边界，因此必须显式写下"哪个包拥有哪份数据契约" |
| **验收判据** | ① 每个包单独装、组合装、装全家桶**三种形态都能启动**（`session/create` 返回 `ok:true`）；② `dsh --profile <p> --dump-config` **零 `not found` 警告**；③ **装完自检**：`--dump-config` 里每个预期的 id 都在（因为 required 名单是硬编码的全局集合，**第三方行失败只会 warn 不会中断**，所以家族必须自带自检）；④ 父子包各自声明版本下限且**不低于模板 cohort**；⑤ 卸载一个能力包后，其他包与核心**仍能启动** |
| **变异验证** | ① 故意把某个包的 `peerDependencies` 改成不兼容范围 ⇒ 必须能被自检抓到（**注意：bundle 不满足是 exit 0 + 一行 stderr 的静默跳过**，这是陷阱 112）；② 故意制造重复 `(kind,path)` 路由 ⇒ 必须 throw（已实测存在）；③ 故意删一个插件行的目标文件 ⇒ 自检必须红 |
| **退出条件** | 若某个"能力包"与核心**共享同一份数据契约、同一生命周期、同一权限面**，且彼此直接调用 ⇒ **它不该是包，应该是核心里的 tool/skill**（§4.4 决策树第 2/3 步） |

### M4+ · 能力推进（按 §3.2 / §5 的排序，一次一个）

**建议顺序**（依据 §3.2 的得分与 §5.2 的"真新包只有 8 项"）：

1. **固化输入隔离（N2）**——得分最高（价值 5 × 可负担 5 ÷ 成本 1）。写记录那一轮不注入旧抽象索引（Zhang Table 5：**50.0 vs 70.0**）。**纯裁剪、零模型调用、宿主侧可确定性判定"哪一轮是写入轮"**。⇒ 落在核心包。
2. **每轮路径瘦身**（= M2 本身）。
3. **数值反例的"候选筛选 + 代入点规格"**（T2）——实证有效（一次 20 行代入抓到本库唯一确认的公式硬错）。⇒ 核心包后台作业。
4. **claim 台账 + 内容指纹作废（V4）**——`theorems/_claims.md` + `source_hash`，全确定性。⇒ 核心包。
5. **增量回执 `+ ~ ! ⚠` + 体检台账消费**（R44）——`audit-ledger.jsonl` 已有，差一次身份级 diff。⇒ 核心包。
6. **依赖/失效传播 + 引用图**（§3.1 #6）——后台派生索引。⇒ 核心包。
7. **独立共证门槛（N4）**——"计数由宿主只追加维护、**不从卡片正文重算**"**只在宿主侧成立**（Louck：相关共证 naive 67% → 域感知 0%）。⇒ 核心包。
8. **成果银行（F1）** ⇒ **第一个新包**（跨边界①：它拥有"结论文物"这份新契约）。
9. **计算/可复现（C1）**、**分工式多智能体（F2）**、**教学闭环（G3）** ⇒ 后续新包，各需 D0/D1/D3 已拍板。
10. **Lean 桥（D1）** ⇒ **最后做**，且**先只用 `dsh-mcp-client` 验证**（本机**无 Lean**，见 §5.0）。

**每一个能力项的验收模板**（照抄 M2 的四段）：注入字节不增 · 确定性等价断言 · 降级路径存在 · 至少一条"该报错时报错"的变异验证。

### 6.1 关于"何时该拆包"的一句话判据

> **拆包的判据不是"话题不同"，而是：它拥有**独立的数据契约**、需要**不同的权限档**（⇒ 不同 profile）、依赖**外部工具链**、或需要**独立的版本/发布节奏**。四条都不满足 ⇒ 做成核心包里的 tool / skill / 后台作业。**
> 定量理由：本仓库 **54 条门禁里 30 条**存在的唯一理由就是防跨边界漂移（`decoupling-assessment:120`）——**边界是有价格的**。

---

## 7. 已取证：生态里的两个可参照范本

### 7.1 `dsh-web`（家族 + 聚合包 + 市场）

`zhu1090093659/dsh-web`：8 238 star / 555 fork / Apache-2.0 / TypeScript / 仍在推送（2026-10-01）/ 站点 [dsh-market.com](https://dsh-market.com)。它的 [`docs/plugins.md`](https://github.com/zhu1090093659/dsh-web/blob/dev/docs/plugins.md) 是一份**可以直接照抄架构的工程手册**：

- **单包骨架**（`node scripts/dsh-plugin-new <name>` 生成）：`cordis.patch.yml`（插件行）+ `package.json`（`dsh.bundle.patch` + `dsh.client`）+ `src/index.ts`（host 半）+ `src/client.ts`（browser 半）+ `README.md`/`README.zh.md`/`README.i18n.yaml`（配对记录）+ 可选包级 `AGENTS.md`。
- **聚合机制**：`packages/dsh-web-all/aggregate.yml` 的 `patchFrom`（汇总各包的 insert 行）+ `deps`（`workspace:*`）；`node scripts/aggregate.mjs` 生成，`--check` 在 CI 拦漂移。
- **共存设计**：聚合行 id **自动加 `web-ui-` 前缀** ⇒"装全家桶"与"单独装一个"不冲突、不产生重复 loader entry id；"宿主服务对同类插件会自动去重"。
- **强制的版本声明**（issue #754）：`dsh.engines.dsh` **与** `peerDependencies["@deepseek-ai/dsh"]` 同值，唯一支持形式 `>= X.Y.Z[-rc.N]`，由 `scripts/family-dsh-engines.test.mjs` 强制**每个家族包与模板**都声明，且下限不得低于模板 cohort 下限。⇒ **独立验证了本项目上一轮刚实现的规则**，并补了两条我们还没有的约束（只认 `>=`；下限不得低于模板）。
- **类型来源纪律**：只用官方 NPM SDK（`devDependencies` 里 `@deepseek-ai/*`），**禁止** tsconfig 指向任何 DSH 源码 checkout。
- **共享构建预设**：单一 `shared/tsdown.client.ts`，禁止复制到包内（与本仓库"单一事实源"同一条纪律）。
- **一条高价值陷阱**：判定"官方设置席位是否可用"时**不能**看席位有没有被声明——官方 harness bundle 的席位在每个 web 构建上都**先于**外部插件声明，据此刻定会让家族分区永远为空。
- **第三方收编红线**：活跃上游 ⇒ 不搬代码（fork 或当依赖）；收编条件含"无活跃上游/已停更/作者授权"，且必须 `git subtree` 保历史 + 保 LICENSE 与署名 + 记录来源与迁移日期；**无 LICENSE / 未授权 / 版权不明 ⇒ 一律不收编**。

**对本项目的用法**：§2.3 的"聚合包 + 独立包 + id 前缀"直接采用；**不采用**它的市场/皮肤/CI 规模（那是 web-UI 家族特有）。

### 7.2 `CausalSmith`（统计科研 + 成果积累）

`Jiyuan-Tan/CausalSmith`（Apache-2.0，Lean 4，论文 [arXiv:2607.22511](https://arxiv.org/abs/2607.22511)，Tan & Syrgkanis）。两个单向依赖的 Lean 包：`Causalean`（建立在 Mathlib 上的因果推断基础库：SCM、do-calculus、潜在结果、识别（backdoor/frontdoor/IV/DID/LATE…）、部分识别与界、面板、设计型/anytime-valid 推断、半参估计、因果发现；**约 8000 个声明**）与 `CausalSmith`（**LLM 驱动、形式化验证的定理生产流水线**）。

对你四问直接相关的四点：

1. **成果积累的形状**：完成的 run 落到 `CausalSmith/doc/research/_bank/accepted/<qid>_v1/`，其 Lean 证明进 `CausalSmith/CausalSmith/`；而**选题子技能会去搜"文献 + 已完成 run 的银行"**，挑"真有空间"的方向。⇒ **"积累"不是日志，是可被下一轮检索与复用的、带机器验证的产物。**
2. **多智能体是"分工"而非"并行同一任务"**：流水线**驱动两个不同 CLI**——**Codex 做发现与证明、Claude 做复核与判定**（两个登录缺一不可；API key 是可选项）。⇐ 这与本仓库既有的"**评审独立性**"约定同源，值得作为设计原则。
3. **检索是分层递进的四层**，且每层对应一种问法：词法（名字/陈述/docstring）→ **loogle 式类型模式** → **粘贴 Lean goal 反查能收口的引理** → 语义（微调检索器 + reranker，约 2.4 GB，可回落到 `BAAI/bge-large-en-v1.5`）；另有 `--scope module`（"该读哪个文件"）与 `--cluster`（按子领域限定）；并直接提供 **`lean-lsp-mcp`** 给 MCP 型 agent。
4. **"docstring 是唯一手写源"**：每一条声明的英文说明**只在 Lean docstring 里写一次**，随后 `doc/API.md`、`doc/library_index.json`、检索 embedding、网站**全部派生重生成、从不手改**，并有 CI（`kb-lint.yml`）与 `npm run doc:check` 兜底。⇒ 与本仓库"单一事实源 + 守卫"是同一条路，可作为**新增能力包**的文档纪律模板。

**成本实况（来自其 README）**：需要 Lean 工具链（elan + `lean-toolchain` 固定版本）、Mathlib 构建缓存 + 预编译 oleans（否则从源码构建是**小时级**）、Node ≥ 20.20.2、可选 Python 3 + `sentence-transformers`（约 2.4 GB 模型）、`present` 还需要 `pandoc` + TeX（`latexmk`）；Windows 需 Git Bash 且建议开长路径。⇒ **这一整套不可能进离线通道**，只能走 §2.3 的"桥/可选包"。

### 7.3 lemmalog 的重新裁定（四条阻断项 → 两条半）

既有评估见 [`lemmalog-assessment-2026-10-01.md`](lemmalog-assessment-2026-10-01.md)。在新架构 + 本机实测下逐条重裁：

| 原阻断项 | 新架构下 | 说明 |
|---|---|---|
| ① 要求**新增一层记忆**（在"不做"清单里） | **仍成立** | 这是产品决定（L8 同类）。搬架构不改变"要不要加一层" |
| ② 打破 **"vault = 唯一持久化、纯 Markdown、无数据库"** | **仍成立** | L2 红线；lemmalog 的 TSV 快照 + 派生关系是**第二个真相源** |
| ③ 三条安装通道**交付不了 `cargo build` 产物** | **一半不再成立** | ⚠️ **本机实测：`cargo` 存在**（`E:\rust`，含 mingw64 `gcc`）⇒"本机构建不出来"不成立。但**"三条通道没有一条会为最终用户装 Rust 工具链"仍成立**，且 L10（"不引入任何需要工具链/二进制/新运行时的机制"，`lemmalog-assessment:96-102`）仍是产品红线 |
| ④ 主用法是 **MCP 服务**，而 preset **刻意不挂**那个面 | **不再成立** | 家族架构下外部工具走**独立包 / `dsh-mcp-client` 桥**（§4.4 决策树第 1 步），核心 preset 的最小工具面**不再构成阻断** |

**结论：仍**不引入**，但**理由从四条减到"两条半"**（①② 是红线与不变量，③ 只剩"最终用户侧交付"这一半）。

**"若坚持要验"的形态也随之改变**：从"嵌进核心"改为**树外 spike + 独立外部桥**——在 `%TEMP%` 里 clone + `cargo build`（本机可行），只问一个可证伪的问题（`why()` + 作用域重算，是否比现有 `depends_on` 下游复查更好），先写死 kill criterion，**不碰 `dsh/preset|host`**。这与既有评估的"最小下一步"一致，只是现在**技术上是可执行的**（此前"本机没有 Rust"是隐含障碍）。

---

## 8. 需要你拍板的既有决策（含两条**新**边界）

> 编号可直接回我。**在 M0 完成前不动代码。**

### 8.1 最优先：一条"总闸"式红线要重新表态（**L12**）

`docs/design-intake-2026-09-10.md:52` 写的是：**"凡是要新增「每轮必做步骤」的都拒"**。只读取证发现它**同时**表达了两件事：

- **(i) 不要给会话加步骤** —— 这是**架构假设**（"步骤只能发生在会话里"）⇒ **新架构下可作废**；
- **(ii) 不要造"机制没人用"的东西** —— 这是**实测结论**（真实 vault 里 `note_recall` 13 / `note_strategy` 1 / `note_links` 1 次）⇒ **仍成立**。

**建议改写为**：「**不要给会话加步骤；确定性工作放到宿主侧。需要模型主动调用的机制，必须先证明调用率。**」
**这是唯一同时挡掉十来项机制的总闸**（只读取证的原话），所以它比下面任何单项都更值得先表态。

### 8.2 逐项

| # | 决策 | 现状 | 为什么现在要重问 | 我的建议 |
|---|---|---|---|---|
| **D0** | **场景是否从"单用户数学学习"扩展到"学习 + 科研"** | 这是**多智能体蜂群编排与并行证明搜索**被否的唯一理由（`references.md:194`："我们场景是单用户数学学习"） | 你这次的目标陈述**已经**把它变成"学习与科研"⇒ **那条否决的理由本身被你推翻**。但"要不要真的引入并行证明搜索"仍是一个**范围**决定，不是架构能替你答的 | 先只扩到"**科研准备**"（文献、claim 台账、可复现计算、成果积累），**暂不**上并行证明搜索——因为 §7.2 的成本实况是小时级 Lean 构建 + GB 级依赖 |
| **D1** | **"记忆插件不调模型"红线要不要对**新包**松绑** | `design.md:288`：插件不调模型 | §5 里有 8 项能力**必然**要驱动模型（A4 claim 抽取、D4 论文复核、F2 分工式多智能体、G3 教学闭环…）。若不放宽，这 4 项**全部做不了** | **分法**：核心记忆包**继续不调模型**（红线不动），**新能力包可以调**（各自独立、各自可卸载）。⇒ 需要你确认这个分法 |
| **D2 / N-A** | **"vault 纯 Markdown、不持库"是否允许派生缓存/索引**（embedding 向量、反链图、claim 台账放 `cache/`） | L2 严格版；但**现况已经在 `cache/` 放 `*.json`**（`dialogue-index.json`、`memory-audit.json`、`retrieval-stats.json`、`audit-ledger.jsonl`） | 这是**边界定义**，不是新功能。不澄清它，Tier B、引用图、claim 台账都只能停在"提案" | **明确划成两类**：**可重建的派生缓存**（允许，不进版本控制、可随时删）vs **权威事实**（只能 Markdown）。⇒ 需要你确认这条界 |
| **D3 / N-B** | **宿主插件可否在稳态运行时执行本地进程** | 现状：**安装器**已经在 spawn `node`/`dsh`；但"**引擎**在稳态 spawn"是另一件事 | §5 的 C1/C4/D1 全部依赖它；也是 §2.1 边界②的实际内容 | 允许，但**只在 research profile 里**：study profile 保持 fail-closed 不动；执行能力单独成包、单独 profile |
| **D4** | **语义召回（Tier B，95MB 本地模型）**是否解冻 | `memory/README.md:58` 标"用户暂缓" | 后台化后**索引构建不再压每轮**，成本结构变了；这是记忆质量最直接的杠杆。只读取证把它排在 §3.2 第 8（价值 5 / 可负担 3 / 成本 4） | 先解冻 **D2/N-A**，再决定；若解冻，**只做只读向量索引**（可重建、不是真相源） |
| **D5** | **Obsidian 的角色** | 现在是"接入 + 配置/展示"**加上**一份内嵌引擎 | 若按 M1 收敛，Obsidian 面板在**服务未启动时不可用**（现在可用）。`decoupling-assessment` D2 早已列为需拍板项 | 保留"服务没起来时能**只读**看记忆"（进程内读），**写路径**全部走 HTTP——即既有方案 C，已被批准过一次 |
| **D6** | **家族边界预算**：最终几个包 | 现在 1 个 | 本仓库实测 **30/54 门禁**用于防跨边界漂移；每多一个包都要付守卫成本 | **≤3 个能力包 + 1 个核心包**（+ 可选聚合包）；超出的能力一律先做成核心包里的 tool/skill |
| **D7** | **仓库是否转 monorepo** | 现在单包（`dsh/` + Obsidian 插件） | §4.3 的推荐单位是"1 monorepo → N 个 bundle 包"；dsh-web 就是这么做的（`packages/*` + `pnpm -w`）。但转结构本身有成本，而且本仓库还有 Obsidian 产物要一起维护 | **暂不转**：先用"同仓库多目录 + 各自 `cordis.patch.yml`"达到同样的交付语义（`dsh plugin add file:<dir>` 已支持），等真有第 2 个包再评估 |

### 8.3 本节的两条纪律

1. **未拍板项不许开代码**——`docs/pending-decisions-2026-09-26.md` 的 A1–A7 就是这条纪律的产物（"未拍板前不要替用户动代码"）。
2. **拍板结果要落进 `docs/pending-decisions-2026-10-01.md`**，而不是只留在本文——本文是评估，那才是台账。

---

## 9. 取证记录（哪一路落了、哪一路没落）

| 流 | 报告（gitignored） | 状态 | 回填到 |
|---|---|---|---|
| S1 被舍弃机制台账 | `.scratch-refused-mechanisms.md`（61 KB） | ✅ **已合入** | §3、§7.3、§8（**并纠正了作者两处判断**） |
| S2 dsh 插件形态能力矩阵 | `.scratch-dsh-plugin-forms.md`（60 KB） | ✅ **已合入** | §2.1、§4（**含"扩展单位是插件行而非包"这条关键纠正**） |
| S3 文献→能力映射 | `.scratch-literature-capability-map.md`（29 KB） | ✅ **已合入** | §5（打分排序、语料沉默确证、**并补上作者原先漏掉的两层**：来源质量审计 A5、判定工具一致性 D6）、§3.3/§3.4 |
| S4 形式化与外部工具 | — | ❌ 失败 | §5.0 **由作者自己实测替代**（工具链探针，见 §5.0） |
| S5 CausalSmith 深描 | — | ❌ 失败 | §7.2 **由作者亲自取 README 替代**（银行/技能/流水线阶段待补） |
| S6 dsh-web 工程蓝图 | — | ❌ 失败 | §7.1 **由作者亲自取 `docs/plugins.md` 全文替代** |
| S0 记忆主体上移可行性探针 | — | ❌ 失败 | §1.1、§6 的 M1/M2 **由作者自证 + S1/S2 的纠正替代** |

> **失败原因（值得记下）**：本轮并发上限是 **3**，而作者一次起了 **7 路**，超出部分以 `RATE_LIMIT` / 传输错误失败——**"一次多起几路"在受限并发下是负收益**。落地教训：**同一时刻不超过 2 路**。
>
> ⚠️ 全部为 `.gitignore` 第 29 行排除的临时件；**结论已写进本文件**，报告本身不随仓库发布。

## 10. 参考文献与依据

- 本仓库既有评估：[`decoupling-assessment-2026-09-26.md`](decoupling-assessment-2026-09-26.md)、[`dsh-native-refactor.md`](dsh-native-refactor.md)、[`bundle-channel-plan-2026-09-26.md`](bundle-channel-plan-2026-09-26.md)、[`note-noise-and-memory-fidelity-2026-09-26.md`](note-noise-and-memory-fidelity-2026-09-26.md)、[`pending-decisions-2026-09-26.md`](pending-decisions-2026-09-26.md)、[`lemmalog-assessment-2026-10-01.md`](lemmalog-assessment-2026-10-01.md)、[`dsh-0.2.0-adaptation.md`](dsh-0.2.0-adaptation.md)
- 记忆设计：[`memory/design.md`](memory/design.md)、[`memory/README.md`](memory/README.md)、[`memory/references.md`](memory/references.md)、[`memory/retrieval-v3.md`](memory/retrieval-v3.md)、[`memory/assessment.md`](memory/assessment.md)、[`memory/strategy-layer.md`](memory/strategy-layer.md)、[`memory/self-correction.md`](memory/self-correction.md)、[`memory/obelisk-comparison.md`](memory/obelisk-comparison.md)
- 吸纳决策： [`design-intake-2026-09-10.md`](design-intake-2026-09-10.md)、[`design-intake-2026-09-21.md`](design-intake-2026-09-21.md)
- 本仓库文献语料：`literature/cards/*.md`（34 篇）、`literature/reading/*.md`、`literature/notes/*.md`
- 外部范本：[zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web)（[`docs/plugins.md`](https://github.com/zhu1090093659/dsh-web/blob/dev/docs/plugins.md)）、[Jiyuan-Tan/CausalSmith](https://github.com/Jiyuan-Tan/CausalSmith)（[arXiv:2607.22511](https://arxiv.org/abs/2607.22511)）
