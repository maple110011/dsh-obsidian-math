# 外部设计吸纳评估（2026-09-10）：两个 GitHub 项目

> **状态：§1 的 5 件已全部实现（2026-09-10）**，回归 `test-memory.mjs` 207 → **224**（新增 §33 共 17 项）。实现要点与偏差见文末「§6 落地记录」。§2 的后续项与 §3 的否决项保持原判。
> **补充（2026-09-10，同轮）**：随后评估的 GraphMemix（Li et al. 2026）与本文档的两个项目有交集，其吸纳决策与实测记录写在 `docs/memory/retrieval-v3.md` **§7**——其中「通用去冗余/多样化重排」在论文的冻结候选实验里也被证伪（与 §3 的否决一致，现已有反例数字）；多视图 max-pool 做了 A/B 后**不采纳**（原因是我们与论文的语料形态不同，见 §7.2）。

> **性质**：用户指定的两个外部项目对本项目的可吸纳性评估。方法：只读取证（fetch README / docs / 关键源码 / GitHub API），逐条对照我们的现状与 **1.0 缺口**（(a) 理解状态与卡点、(b) 技巧的调用体系、(c) 主动教学闭环、(d) 复习调度，见 `README.zh.md`「这个项目解决到哪一步了」）。
> **结论一句话**：**R1 更多是「印证」而非「新增」；R2 的价值是写入契约的纪律，不是它的引擎**。真正值得现在动手的是 5 个小件（全部确定性、零新依赖、零模型调用）+ 2 条零代码的文档纪律。**两个项目都没有触及 (a) 和 (d)。**

## 0. 两个项目是什么

| | R1 `zy839971925-zyy/Agent--deep-research-Workflow-Skills` | R2 `DeusData/codebase-memory-mcp` |
|---|---|---|
| 形态 | 治理型 `SKILL.md`（Agent Skills 格式）+ JSON Schema + ~30KB Python | 纯 C 的 MCP server，把代码库索引成 SQLite 知识图 |
| 机制 | 任务画像 / 深度门（light…ultra）→ 确定性路由到 6 个 Family → 渐进披露；外加「工作流学习 / CAPA」维护面 | tree-sitter AST + 类型解析 → 节点/边 → BM25(FTS5) + 11 路语义检索 + Cypher 子集遍历；ADR 存储、git-diff 影响面、Louvain 聚类 |
| 成熟度 | **5 star、0 fork、0 issue、2026-09-06 建库**；README 自陈真实模型效果**未验证** | **42.9k star、3.5k fork、576 open issue**、当日仍在推送；SLSA-3 / CodeQL 门禁。（自家数字有漂移：徽章 162 语言 vs 正文 158） |
| 对我们的价值 | **词汇与门控**（可验证的规则） | **少量具体写入/查询机制** |

## 1. 建议现在就做的 5 件（全部 S 级成本）

| # | 来源 | 机制 | 现状差距 | 落点 |
|---|---|---|---|---|
| 1 | R1 | **反条件门控进检索**：记忆条目带 `applicability_conditions` / `anti_conditions`，检索时**硬排除**与当前标签冲突者 | `note_recall` 只把适用性写成提示词指望模型遵守；只有 `strategy/` 卡有机器可读的 `not_applicable_when` | 卡片字段扩展到 records/templates + `note-tools.mjs` ~10 行 |
| 2 | R1 | **`usage {used, helped, harmed}`**：记录「用过但**帮倒忙**」的次数，排序按 `-helped, +harmed` | 我们只有 `uses` / `success_rate`——「经常被用且经常误导」的卡**完全不可见**（体检 weak 桶要求 `rate≤0.4 且 uses≥3`，真实 vault 从未达到） | 统计写入 + 体检新增一行 |
| 3 | R1 | **provenance 字段 + 「内在反思不得升级」可机检** | 「verified 只能单源、升级需用户参与」目前只是 AGENTS.md 的**一句话** | 一个字段 + 一条审计断言 |
| 4 | R1/R2 | **declared vs effective state**：声明值只是输入，引擎算出唯一有效值，冲突必须显式报告 | 真实 vault 里 frontmatter `uses: 1` 与 `retrieval-stats.json uses: 0` **正在互相矛盾**，且两者都显示 | 体检对账 + 面板只显示一个值 |
| 5 | R2 | **`degraded` 状态取代静默成功**：索引用后置计数核对（低于阈值就返回 `degraded` 而不是 `indexed`） | 本轮 4 个 bug 全是「静默成功」（安装脚本 no-op、归档非卡、面板显示开启而引擎关闭、体检建议归档刚归档的卡） | 体检 JSON 加后置计数 + 面板/CLI 显示 |

**零代码的两条**：① **评审独立性**（R1）：评审者拿「任务 + 产物 + 证据」，**不拿求解者的推理过程**；评审分歧时不做多数表决，而是去找判别性证据——我们本轮用了三个子代理，这条可以直接写进协作约定；② **单一优先级清单**（R2）：把所有「哪些路径被跳过」的判据（`classifyVaultDoc`、`AUDIT_CARD_SCAFFOLD`、面板 `_*`/`index.md` 过滤、`AUDIT_CARD_DIRS`）收敛成**一张有优先级的表**——这正是我们刚做的「迭代忘记适配」审计所针对的那类 bug。

## 2. 值得做、但不是现在

| 来源 | 机制 | 为什么缓 |
|---|---|---|
| R2 | **`manage_adr` 式分区写入**：只重写指定的 `## 小节`，其余字节不动；同一小节写两次是 no-op（重试不会重复内容） | 它正是 1.0 缺口 (c)「把复盘的长期档案写成可增量更新的记录」所需的写入契约；但先要设计教学闭环本身（文档先行），再写这个 writer |
| R1 + R2 | **依赖/失效传播**（前提失效 ⇒ 依赖它的卡标记 stale）+ `detect_changes` 的影响面 | 这是最接近缺口 (a) 的东西，但需要一张**引用图**（我们只有 `source` 单向链接），属于新子系统 ⇒ 应写成设计备忘而非直接补丁 |
| R1 | **可上下调整的深度门**（证据薄就升档、纯查询就降档） | 我们现在是固定上限（≤2 次 recall、≤3 篇全文）；改成「随不确定性调整」是语义设计，需拍板 |
| R2 | **Louvain 聚类 ⇒ 候选主题**（给手工维护的 `topics/` 层做候选建议） | 聚类结果**每次都会抖**（顺序相关），而在 3 张卡的语料上聚类等于制造噪音；先设规模/稳定性地板再说 |
| R2 | **语料覆盖声明**：`note_recall` 报告「本次实际看了语料的多少」 | 我们只报查询覆盖率，不报语料覆盖率；与「弱信号诚实」同源，可稍后做 |

## 3. 明确否决（不要再讨论）

| 否决项 | 来源 | 理由 |
|---|---|---|
| embedding 语义检索 / Cypher 查询语言 / tree-sitter+LSP / 原生二进制 + 守护进程 + SQLite + 3D UI | R2 | 我们的「图」是十来个文件 + `[[链接]]`；引一个新运行时会把「vault 文件就是真相」这条不变量破坏掉。Tier B 已另有提案 |
| 团队共享的二进制图产物（git LFS + `merge=ours`） | R2 | R2 自己的 README 就写了一个 20MB 文件在 350 次提交里涨到 ~6GB 的教训；我们的 vault 本身就是可共享的纯文本产物 |
| MinHash + LSH 近似重复检测 | R2 | `pattern+techniques` 上的精确 Jaccard 已实现且正确；万级以下用不上 LSH |
| R1 的 6-Family 架构 / 必做 CAPA 分级 / 93KB `work_state` schema | R1 | 我们的**实测失败模式恰好相反**：机制没人用（真实 vault 里整套反馈面全为 0）。任何「每轮新增必做步骤」的提案默认拒绝——只吸收「卡片上的字段 + 少量确定性检查」 |
| 把反条件当**硬过滤**（静默丢弃） | R1 | 假阴性不可见：卡因边界词被吞，用户永远不知道它存在。必须做成「**带原因的排除**」（把命中的边界短语一起返回，并计入可审计的排除日志） |

## 4. 风险

1. **机械化的诱惑**（最高风险）：R1 是为长周期多代理工作设计的；我们是个人数学笔记本。**判定标准：凡是要新增「每轮必做步骤」的都拒。**
2. **计数器空转**：`harmed` 在可预见的几个月里都会是 0（❌ 至今一次没点过）。要**如实显示「从未评级」**，而不是把 0 当成证据。
3. **对账不能自动改写**：declared vs effective 若自动覆盖，就可能**静默改掉用户亲手改的值**——这是记忆系统的头号禁忌。只报告、不覆盖。
4. **分区写入会吃掉正文**：写 `## 下一步` 的解析逻辑写错就会破坏用户散文（与本轮修的 replace/归档 bug 同类）。限定到理解记录类型 + 固定标题白名单 + 重复标题即拒写 + 偏移拼接 + 属性测试。

## 5. 待用户决定

- ~~是否执行 §1 的 5 件~~ → **已执行（2026-09-10）**，见 §6。
- §2 里最值得先做**设计备忘**的是「依赖/失效传播」——它是缺口 (a) 的入口。

## 6. 落地记录（2026-09-10）

| # | 机制 | 落点 | 与评估的偏差 |
|---|---|---|---|
| 1 | 反条件门控 | `note-tools.mjs`：`buildRecallDoc` 读 `boundary`；新增导出 `boundarySegments`/`boundaryHits`；`rankRecallDocuments` 与 `rankStrategyCards` 各自返回 `excluded[]` | **偏差**：边界文本按标点拆成 ≤12 字短片段再匹配。原方案设想「token 重叠比例」，实测散文式边界（`成本非二次（无内积化）或 μ 非绝对连续…`）整段 token 重叠率极低、阈值永远不会触发；改按短片段**子串包含**判定，既准确又对关键词式写法同样有效（`AGENTS.md` 与两张 `_README.md` 已要求改写成短句）。另：`note_strategy` 一并加门控——策略层才是这个字段的原生地。 |
| 2 | `harmed` 计数 | `memory-admin.applyFeedback('wrong')` 累加 `hook.harmed`；`collectMemoryState` 透出；两个面板显示 `⚠️ 倒忙 N 次`；体检 `counts.harmed`/`sections.harmed`/人话行/清单行 | 无 |
| 3 | `verified_by` 凭据 | `applyFeedback('confirm')` 写 `verified_by: user`；`wrong` 降级后若仍在 single-source 之上则写 `none`；`buildAuditReport` 新增 `structural.unjustifiedUpgrade` + `structuralDetail` | 无 |
| 4 | 声明值 vs 有效值 | `collectMemoryState` 读 `retrieval-stats.json`，`uses` = 声明 + 未合并增量，并给出 `usesDeclared`/`usesPending`；体检回写后**读回核对**，不一致进 `structural.usesMismatch` | **修正了评估里的一处误解**：那份 stats 文件是**增量**（体检合并后清零），不是「与 frontmatter 打架的总量」。真正的风险是「两次体检之间少报」，所以面板改为显示有效值。 |
| 5 | `degraded` 状态 | `syncHookStatsToCard`/`syncTopLevelStatsToCard`/`writeHookHistory` 全部返回布尔；体检累计 `postconditions`，输出 `status` + `warnings`，并写入人话摘要与模型清单 | **附加值**：上线当轮就抓出两个真实缺陷——① `syncTopLevelStatsToCard` 把 `uses` 追加到**闭合 `---` 之后**（正文里），这正是此前清理掉的两行游离 `uses: 0` 的成因；② 无 `hook` 块且非策略卡的卡片命中会被静默清零。两者都已修/已报告。 |

零代码的两条也已落到文档：评审独立性写进协作约定（`docs/memory/handoff.md`），「不要做通用去多样性重排」写进 `AGENTS.md` §5（论据是 GraphMemix 的控制实验：MMR/DPP 净回收为负）。
