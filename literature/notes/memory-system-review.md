# 记忆系统 vs 文献：综合评估（2026-08）

> 目的：重读 14 篇 agent 记忆相关文献，评估 dsh-math-memory 现有记忆系统是否可改进 / 需调整，落成可执行清单。
> 方法：按统一模板（literature/reading/_TEMPLATE.md）精读 14 篇 MinerU 全文，产出 reading/<citekey>.md 与卡片蒸馏；本文件做跨论文综合。
> 状态：14/14 已完成研读（reading/*.md）并蒸馏进 cards（status=distilled）。
> 落实状态：高优先 5 条 + 中优先的 recency、模板/记录 schema、Refine 步、条件演化门已落实（见 docs/memory/changelog.md）；hybrid embedding、容量去重阈值、检索工具预算仍待后续。

## 1. 现状基线

来源：docs/memory/design.md、docs/memory/handoff.md、dsh/preset/*.mjs。

- 结构：五层（profile/topics/records/episodes/inbox）+ theorems + templates + notation + capture-policy；全 markdown，无数据库。
- 读：note_recall 统一 BM25 检索 + 导航式注入 + 精读协议 + coverage 弱信号（<0.35）。
- 写：三写协议（episode→records→topics/profile）+ 记忆卡 hook 块 + 捕获策略分级（auto/ask/off）。
- 维护：每日确定性体检（strong/weak/unused/duplicate-candidates/unverified + 结构校验）+ 反馈闭环 + hook 使用趋势。
- 安全：fail-closed（workspace-write + approval never）、无删除工具、归档代替删除。

## 2. 跨文献发现（共性主题）

1. **原文证据优先 / 晚过滤**（zhou O8/O9；本项目既有原则）：保留原文 > 轻压缩 > 摘要；写时不过度过滤。→ 我们 episodes append-only + records 原子化已对齐。
2. **不确定性表示**（Belief Memory；MACLA 贝叶斯）：不要坍缩成点估计；保留候选 + 概率；wrong 反馈降权而非删改。→ 我们是点估计 + superseded 历史 + verified 三级（粗粒度）。
3. **显式维护/自改进循环**（ISM 七机制；MACLA 对比精化；Evo-Memory Refine；A-Mem 演化）：audit/merge/promote-demote/prune/reinforce/antipattern + 显式 Refine 步。→ 我们有 audit + merge/reinforce/demote + 反馈；缺 antipattern 落地、缺每轮 Refine 步、缺 promote/demote 打分。
4. **主动/工具式记忆导航**（NapMem）：记忆=动作空间，选粒度、设预算、奖励「用对工具」。→ 我们有 note_recall/note_search/note_links/read；缺粒度纪律与「无谓检索」被动信号。
5. **链接/图结构**（A-Mem 链接；Template-Theorems 图；MemoryOS 主题段）：链接从内容涌现；模板↔定理图；主题段。→ 我们有 source/related + templates/theorems + topics；缺写时自动链接、定理表聚合、主题叙事。
6. **检索质量**（AgentIR/RaDeR/LeanSearch）：蒸馏查询、CoT 查询、全局前提（集合级）、空结果信号、稀疏+稠密均衡融合。→ 我们有蒸馏查询 + BM25 + coverage + 空结果诚实；缺 dense/hybrid、缺集合级 coverage、缺等价记录去重。
7. **被动信号评估**（Evo-Memory；MACLA 指标；zhou RQ5 成本）：复用率、回退率、检索轮数、记忆调用率、成本。→ 我们有引擎探针 + E2E + hook stats；缺这些被动指标进体检。
8. **成本/规模有界**（A-Mem；MACLA；MemoryOS 热度）：token 预算、容量上限、热度淘汰。→ 我们有字符预算 + unused 体检；缺热度三因素排序、缺 records/templates 容量与去重阈值。
9. **验证门控**（ISM 符号验证；MACLA 前置/后置条件；Template-Theorems 四校验）：写入/升级前验证。→ 我们用 verified 三级 + 用户确认 + 结构校验替代；可补前置/后置条件字段。

## 3. 差距清单与建议（按优先级）

### 高优先（低风险、与现有设计一致、可直接落地）

1. **体检 unused/demote 改「热度三因素」**：Heat = 0.5×可靠性(verified 级) + 0.3×访问频次 + 0.2×新近度，输出归档候选（MACLA 剪枝 + MemoryOS Heat + zhou O11 保守合并）。
2. **antipattern 落地**：失败经验（artifact 反例）纳入独立体检项，聚合「要避免的错误」（ISM Self-Antipattern + Evo-Memory failure-aware）。
3. **promote/demote 进检索打分**：verified + success_rate 作为 note_recall 的先验项（ISM ±2%/−5%；MACLA Beta 后验）。
4. **写卡自动链接**：三写第 2 步显式「note_recall 近邻 → 建立/更新 related」（A-Mem Link Generation）。
5. **被动信号进体检**：复用率（命中且被引用）/ 回退率（明说没有）/ 无谓检索率（检索未引用）（MACLA + NapMem + Evo-Memory）。

### 中优先（结构性，值得做）

6. **records 置信/候选表示**：对 fact/preference 类可修订属性存「候选 + 置信」；wrong 反馈降权并保留备选（Belief Memory）。
7. **检索排序加 staleness/recency**：把 memo 已有 recency 推广到 records（Belief Memory λ^τ）。
8. **模板卡补「推理步骤序列」+ related_theorems 自动补全 + 定理表聚合重选模板**（Template-Theorems）。
9. **显式 Refine 步**：AGENTS.md 增「本轮新证据修正记忆时主动精化对应卡」纪律（Evo-Memory ReMem）。
10. **条件演化门**：同一 operator 多次失败才建议新建/拆分模板卡（ISM）。

### 低优先 / 可选 / 暂缓

11. **hybrid BM25 + 本地 embedding**：对应 zhou O10 均衡融合；我们 Tier B 可选后端已预留，维持暂缓（成本/隐私）。
12. **检索粒度纪律 + 工具调用预算**：AGENTS.md 路由加「默认先粗后细、避免越级」（NapMem）。
13. **records/templates 容量上限 + 去重阈值（≈0.85）**（MACLA/A-Mem）。
14. **profile 分层（静态画像 / 动态 trait / 事实库）**（MemoryOS LPM）——低，已有 profile，可选标注。

## 4. 结论

- **架构方向正确**：14 篇文献的「最佳实践」与我们现有设计高度同构（五层≈NapMem 金字塔、hook≈ISM、templates/theorems≈Template-Theorems、audit≈ISM 七机制、导航注入≈zhou O8 证据优先）。**不需要推倒重来，需要的是「补细节、强闭环」**。
- **最值得动的三件事**：① 体检从「单一 unused」升级为「热度三因素 + antipattern + 被动信号」；② 检索从「纯 BM25 + 词面 coverage」补「verified/success_rate 先验 + recency + （可选）hybrid」；③ 写路径补「自动链接 + 显式 Refine 步 + 可修订事实的置信表示」。
- 这些建议与 handoff.md §7 的既有待办一致（antipattern 待强化、反馈自动补 hook、qa:e2e 等），可作为下一轮「记忆系统大改」的输入。
