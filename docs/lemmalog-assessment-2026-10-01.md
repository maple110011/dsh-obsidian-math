# 评估：能否为记忆系统引入 lemmalog？

> **状态：评估完成（2026-10-01）。结论：不引入（reject），置信度约 0.85。**
> 本文回答一个问题——[`JordyZomer/lemmalog`](https://github.com/JordyZomer/lemmalog) 能不能接进本插件的记忆系统。
> 它是**适配评估**，不是拒绝一个项目的好坏：lemmalog 本身是个做得相当认真的引擎。
> 原始取证（未纳入版本控制）见 `.scratch-lemmalog-assessment.md`。
>
> **先说结论**：**这是拟合失败（fit failure），不是质量问题。** 四个彼此独立的阻断项，每一项在**本仓库已有的
> 决策里**都留下了书面记录——也就是说，这次不是"要不要新开一个方向"，而是**要不要推翻四条已经写下来的决定**。

---

## 1. 一页结论

| # | 阻断项 | 本仓库的既有记录 |
|---|---|---|
| 1 | 它要求**新增一层记忆**，而"不再加层"写在**不做清单**里 | `literature/notes/verification-design-2026-09-18.md:26` |
| 2 | 它打破**"vault = 全部持久状态的唯一容器、纯 Markdown、无数据库"**这条架构前提 | `ARCHITECTURE.md:30`、`docs/memory/design.md:33` |
| 3 | 三条安装通道**没有一条能交付它**（见 §4.1）：`cargo build` 出来的二进制既不是 npm 包，也不是平铺 `.mjs` | `docs/installation.md:64` |
| 4 | 它的主要用法是一个 **MCP 服务**，而本插件的 preset **刻意不挂** shell / web / subagent 这些面 | `verification-design-2026-09-18.md:15` |

**它真正许诺的两个好处，本仓库要么已经明确拒绝、要么已经用纯 JS 设计好了**（§3.2）：

- **传递式级联（transitive cascade）**：`design.md:130` **有意拒绝**——它需要一套置信度传播模型，
  而真实语料里人类噪声占比高，"自动往下游传播结论"会把噪声也一起放大。
- **来源链 / 证据追踪**：已从 Danus 那条线设计成**纯 JS 的 V0–V9 claim 计划**（见
  `verification-design-2026-09-18.md`、`notes/verification-framework-2026-09-18.md`）。
- 检索侧：BM25 + 图已是现状（`note-tools.mjs:753/477/529`），而且**图变体在本库实测为负**
  （多视图 max-pool 的 A/B 见 `docs/memory/retrieval-v3.md` §7.2，及 `handoff.md` §5 的「GraphMemix 吸纳范围」行；
  `retrieval-alignment-2026-08.md:36` 记着 **"flat > graph"**）。

**最小下一步**：**结案**——在 `docs/handoff.md` §5（用户决策记录）写一行，避免下次再被当成新方向提出来。
本仓库对 `lemmalog` **零命中**（首次提出），所以这不是重复讨论；但**它所属的类别**已经定过案了。

---

## 2. lemmalog 是什么（已确证，不是猜的）

**它是一个用 Rust 写的、面向 LLM agent 记忆的 Datalog 引擎。** 不是一个日志库、也不是 Lean 的东西。

| 维度 | 事实 | 来源 |
|---|---|---|
| 语言 / 许可 | **Rust** / **MIT** | GitHub API（HTTP 200） |
| 热度 / 活跃 | 326 stars / 29 forks；创建 2026-08-27，最后 push 2026-09-15（评估时已 16 天无提交） | `api.github.com/repos/JordyZomer/lemmalog` |
| 成熟度 | **未上 crates.io**（HTTP 404）、**零 release**（`/releases` → `[]`）、**零 tag**（`[]`）、**无 CI**（`/.github` → 404）。体量 295 KB、5 位贡献者、bus factor 1 | 同上 + `/releases`、`/tags`、`/.github` |
| 唯一获取方式 | `git clone` + `cargo build --release` | 同上（无 registry、无 release 二进制） |
| 依赖 | `Cargo.lock` 76 个 crate；**声明的直接依赖只有 2 个**（`serde_json`、`ureq`），且都可选 | `Cargo.lock` / `Cargo.toml` |
| 数据模型 | **双时态标注事实**：`edge(S,R,O,valid_from,valid_to,asserted_at,confidence,provenance)` | README / 设计文档 |
| 推理能力 | 分层 Datalog（含否定与聚合）、**半朴素增量维护**、**DRed-lite 撤回**、`why()` 证明树、magic-sets 的 `ask_deep`、版本化规则注册表 | 同上 |
| 接口面 | `AgentMemory` facade + **12 工具的 MCP 服务（stdio）**；持久化是 **TSV 快照**（派生关系加载时重建）；无 DB、无服务端 | 同上 |
| 它自己的评测 | 其设计文档把 LongMemEval 上的成绩称作**"统计上的平手"**（0.48 vs 0.50 transcript） | 设计文档 |
| 自报测试数 | 同一份仓库里自相矛盾（README 44 / 设计文档 42 / 最后一次提交 86） | README vs 设计文档 vs `git log` |

**我没有确证的东西（不要当已验事实）**：Windows 上能不能编译运行（无 CI、文档里的性能数字来自 macOS、
安装脚本是 bash）、release 二进制的体积、**今天**的测试是否还全绿、维护者是"暂停"还是"弃坑"。

---

## 3. 与本插件记忆系统的拟合

### 3.1 本插件记忆系统的实际形态（`file:line` 为准）

- **分层**：`records/` + `topics/`（长期）、`episodes/`（事件）、`inbox/` + `strategy/`（暂存与策略），
  全部是 vault 里的 **Markdown + frontmatter**（`docs/memory/design.md`）。
- **数据流**：笔记 → hook/会话日志 → 捕获与蒸馏 → `.deepseek/memory/**` → 检索注入回对话
  （`ARCHITECTURE.md`；引擎在 `dsh/preset/math-memory.mjs`，宿主半在 `dsh/host/memory-admin.mjs`）。
- **检索**：BM25 + 图扩展 + hook 加权 + 验证等级 + 适用边界，全在 `dsh/preset/note-tools.mjs`
  （`note_recall` 的实现面 `:753/477/529`）。
- **注入**：`system-prompt/assemble` 钩子（`math-memory.mjs:4326`），受注入预算档位约束（上限 18000 字符）。
- **行为契约**：`scripts/test-memory.mjs`（**427 条**断言，`ARCHITECTURE.md:50`）。

### 3.2 逐缝映射：它想占哪个位置，以及为什么占不了

| 它想占的缝 | 本插件现状 | 结论 |
|---|---|---|
| 事实存储（edge 表） | vault 里的 Markdown 卡片 + frontmatter，**人类可读、可手工编辑**（这是产品定位） | **冲突**：接上去等于给同一批事实加**第二个真相源**，而迁移是**有损**的——把带上下文与出处说明的卡片重新抽成三元组，丢掉的正是本插件最看重的部分；而 lemmalog 自己承认的瓶颈恰是**抽取召回** |
| 推理 / 级联 | **有意不做传递式级联**（`design.md:130`：需要置信度传播模型 + 人类噪声） | **冲突**：这条是**写下来的产品决定**，不是疏漏 |
| 来源链 / `why()` 证明树 | 已设计为**纯 JS 的 V0–V9 claim 计划**（`verification-design-2026-09-18.md`） | **已被别处的方案覆盖**：接进来会与在用方案竞争，而不是补它的缺 |
| 图检索 | BM25 + 图已实现；**图变体在本库实测为负**（max-pool A/B = Δ0 且排名变差，见 `docs/memory/retrieval-v3.md` §7.2；`retrieval-alignment-2026-08.md:36` 的结论是 **flat > graph**） | **已被实测否定** |
| 主动检索 / 工具面 | preset **刻意不挂** shell / web / subagent（`verification-design-2026-09-18.md:15`），工具只有 `note_*` 四个 | **不可达**：MCP 服务需要宿主装 MCP 客户端并让它连上去，而当前 preset 的结构故意不留这个面 |
| 每轮必经的机制 | 已被**带证据地否决**（`handoff.md` §5 的「外部设计吸纳」行）。实测的失效模式是**"机制没人用"**：真实 vault 全量会话里 `note_recall` 13 次、`note_strategy` 1 次、`note_links` 1 次（`handoff.md` §7 的「note 工具族的使用程度与候选卡『自锁』」行） | **与实测相悖**：再挂一个"每轮都要走"的新机制，最可能的结果是又一个没人调用的开关 |

### 3.3 一句话

**lemmalog 能提供的能力，本插件要么已经有（检索、来源链设计），要么已经**明确**拒绝（级联、图优先），
要么**结构上够不着**（MCP 工具面）。而它要求的东西——新的运行时、新的存储形态、第二个真相源——恰好是
这个仓库反复为之付过代价、并写进决定里的三样。**

---

## 4. 成本、风险与约束

### 4.1 三条安装通道，没有一条能交付它（最硬的一条）

| 通道 | 交付形态 | 能不能带一个 `cargo build` 出来的二进制 |
|---|---|---|
| 平铺/离线（Obsidian 引导、`install --direct`） | 往 profile 目录铺 `.mjs` 文件 | ❌ 这里承诺"**不依赖 node/pnpm**"就能装（`docs/installation.md:64`），却要再加一条 Rust 工具链？ |
| 包化（本地 bundle / npm） | `node_modules` 里的一个 npm 包 | ❌ 内容必须是 JS/可解析模块；发布物清单（`package.json` 的 `files`）与 `check-release-paths.mjs` 钉住的是这一套 |
| Obsidian 社区插件 | 单个 `main.js` + `manifest.json` | ❌ 这是**生成物**（`scripts/build-obsidian.mjs`），`check-bundle-freshness.mjs` 逐字节比对；塞不进原生二进制 |

**要诚实的地方**：插件**已经**会 spawn 外部进程（`node`、`dsh` —— `obsidian/main.template.js:11/413-417`），
所以"插件不跑外部程序"这个说法是**错的**。真正的问题是：**没有任何一条安装通道会去装一条 Rust 工具链**，
而且用户机器上大概率也没有 `cargo`。

### 4.2 与既有守卫正面冲突

- **`scripts/check-engine-sync.mjs`**：它建模的是"**恰好两个**引擎 + **一个**共享模块"
  （`EXPECTED_SHARED:241`、`ESCAPE_THRESHOLD=0.7:355`、共享模块清单位于 `:44-47`）。
  加第三个引擎 ⇒ 要么**守卫看不见它**（静默漂移，正是这个守卫存在的理由），要么**必须扩守卫并补变异验证**。
- **`scripts/check-bundle-freshness.mjs`**：逐字节比对一次全新构建；`dsh/preset|host` 下**新增文件会被构建直接拦下**
  （要求你嵌入它，或在 `NOT_EMBEDDED` 里写明为什么不该进 —— `AGENTS.md` §6）。
- **`scripts/test-memory.mjs`**：**427 条**断言，其中含中文串的 `.includes(...)` 有 **153 处**
  （`handoff.md` §7 的「自指式期望与脆弱断言（审查 P3）」行）。改层与注入文本会**按构造**弄红一大片——那不是"顺手改断言"的量级。

### 4.3 其余风险

| 风险 | 说明 |
|---|---|
| 许可证 | MIT ↔ 本仓库 MIT，**兼容**（唯一一项不构成障碍） |
| 供应链 | 未上 crates.io、零 release、无 CI、bus factor 1、16 天无提交。**唯一的获取路径是 clone 一份并自己构建**——对最终用户不可审计、不可复现 |
| 数据迁移 | 现有 `.deepseek/memory/**` 是**产品资产**（用户手写 + AI 蒸馏，含确认状态与边界）。迁成 TSV 三元组是**有损**的，且没有回程 |
| 平台 | Windows 完全未经验证；而本插件的目标环境（Obsidian 桌面）**大量在 Windows 上** |
| 维护面 | 多一条"装/编译/版本对齐/失败诊断"的安装链要维护——本仓库已经为"三条通道各自的形态差异"付过多次代价（见 `decoupling-assessment-2026-09-26.md` §3.7：约 46/100 条陷阱的根因是跨边界契约不同步） |

---

## 5. 建议与最小下一步

### 建议：**不引入**（置信度约 0.85）

不是因为它不好，而是因为**它要占的每一个位置，本仓库都已经有过结论**；而它带来的新东西
（原生运行时 + 第二个真相源 + MCP 工具面）与该产品的三条硬约束（纯 Markdown 的 vault、
无工具链的离线安装、刻意收窄的工具面）**同时**冲突。

**如果你仍然想验它**（我不推荐，但如果你想，下面是唯一合理的形态）：

1. **完全在树外**：`%TEMP%` 里 clone + `cargo build`，**不碰本仓库的任何文件**。
2. **只问一个可证伪的问题**：`why()` + 作用域内重算，在**100–300 张真实卡片**上，
   是否比现有的 `depends_on` 下游复查做得更好？（这是它相对现有方案的**唯一**可能增量。）
3. **先写死 kill criterion**（例如"在 N 张卡上准确率提升 < X% 或需要人工标注 → 停"）。
4. **用 `MockExtractor`**，把"抽取召回"这个它自己承认的瓶颈排除在变量之外。
5. 无论结果如何，**都不动 `dsh/preset|host`**——实验结论写文档，不写代码。

### 最小下一步（本文的收尾动作）

在 `docs/handoff.md` **§5（用户决策记录，不要推翻）**加一行：*"lemmalog（Rust Datalog 记忆引擎）评估结论：不引入（2026-10-01）"*，
附一句"理由与证据见本文"。**决策要落在那个文件里**，否则下一次有人再提，又得从头查一遍。
