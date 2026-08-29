# 记忆纠错与确定性自维护提案

> 状态：**已实现（0.7.2）**。本文把上一轮代码审查发现的四个具体缺口，加上 OpenViking（Volcengine 开源「Self-evolving Context Database」）的强度/遗忘/巩固模型，写成可落地的改动规格——逐条给出代码位置、具体改法、评估与取舍。P1–P5 均已落地，实现细节见 `docs/memory/changelog.md` 最新条目与文末实现状态表。
> 定位：继 `v2-proposal.md`（读改写）、`retrieval-v3.md`（检索重构）、`strategy-layer.md`（方法层）之后的第四份改造提案，主题是「**让纠错真正生效、让遗忘/巩固从 prompt 自律升级为确定性机制**」。

---

## 0. TL;DR

1. 系统的纠错「零件」都在，但**纠错的最后一公里是空的**：`❌` 反馈、`superseded` 标记、验证等级这三样，都没有真正传导到「检索到谁」这一环。
2. 四个具体缺口（§1）里，**P1（三件套）性价比最高、风险最低**，建议第一轮做；P2–P5 是可选的、对齐 OpenViking 的结构性增强。
3. 所有改动都遵循既有红线：**插件不调模型**（语义对错仍走「确定性检测 + 模型执行」）、**永不硬删**（遗忘=移动归档）、**fail-closed 不变**。
4. 争议点只有两处需要用户拍板：`❌` 是否同时降 `verified`（§5），以及自动归档默认开还是关（§5）。

---

## 1. 问题基线（审查发现的具体缺口）

| # | 缺口 | 现状（代码） | 后果 |
|---|---|---|---|
| 1 | `superseded` 卡不降权 | `note-tools.mjs` 的 `classifyVaultDoc()` 与 `note_recall` 的 doc 对象都不解析 `status`；打分公式无 status 项 | 「写时保留（superseded 而非删除）」只写在文件里，**检索照样把已取代的旧卡当 active 卡捞出来** |
| 2 | `❌` 反馈惩罚弱、且不降 `verified` | `memory-admin.mjs` `applyFeedback()`：`wrong` 只 `success_rate = max(0.05, round(base*0.5*100)/100)`，不动 `verified` | 0.9→0.45 仍高于 weak 阈值 0.4，**「明日体检重新评估」实际不触发**；且 ✅ 徽标与内容对错脱节 |
| 3 | 纠错信号权重过小 | `note-tools.mjs` 打分 `0.85×BM25 + 0.10×CJK + 0.05×hookPrior`；`hookPrior` 内 verified+success 合计约 0.65 | `verified`/`success_rate` 对最终排序影响上限 ≈ 3%，**点 ❌ 几乎不改变检索排名** |
| 4 | 语义纠错无确定性兜底 | `math-memory.mjs` `buildAuditReport()` 只查结构（缺 source/断链/未入索引）+ 使用统计，不查内容对错 | 一条数学上错的 fact，无人点 ❌、模型也没碰巧发现，就**永久 active 留存并继续被索引** |
| 5 | 遗忘/合并靠 prompt | 归档候选只「建议」不执行；重复合并是 AGENTS.md 让模型做 | 库只增不减；重复卡互相抢 top-k |

---

## 2. 改动方案（现状 → 方案 → 评估）

### P1 · 纠错信号真正进入检索（三件套，一轮做）

#### P1a `superseded` 卡降权/排除

- **现状**：`classifyVaultDoc()` 只按路径分类，不读 `status`；`note_recall` 的 doc 对象 `{kind,rel,title,tags,topic,updated,hook,strategy,body}` 无 `status`，打分无 status 项。
- **方案**：`note_recall` 解析 `status`（复用已有 `metaScalar(frontmatter,'status')`）；`status === 'superseded'` 的卡**默认排除出 top-k**（不参与排序），但仍在磁盘、仍可被 grep/read 按需溯源——证据链不断。保守替代：降权（`score × 0.1`）而非排除。
- **评估**：
  - 影响：高——被取代的旧记忆不再浮到前列，直接回应「错误记忆被一直索引」。
  - 风险：低——superseded 语义就是「已被取代」，排除是正确默认；溯源不依赖它进 top-k。
  - 成本：低——一处解析 + 一处 filter，回归 +1 断言。
  - 取舍：排除（干净）vs 降权（保守）。**建议排除**，因 superseded 卡本就只该留作证据。

#### P1b `❌` 反馈：降 `verified` + 更陡的成功率惩罚

- **现状**：`wrong` 只 `success_rate = max(0.05, base*0.5)`，`verified` 不动。
- **方案**：
  1. `wrong` 时 `success_rate = min(base*0.5, 0.35)`——一次 ❌ 必落 weak 区（阈值 0.4）以下，兑现「明日体检重新评估」；
  2. `wrong` 时降一级 `verified`：`user-confirmed → cross-referenced → single-source`（已在 `single-source` 则不降）；
  3. 追加顶层 `last_wrong: <date>`，供体检的「待重审」段（P2）消费。
- **评估**：
  - 影响：高——徽标与内容对错不再脱节；一次 ❌ 即触发体检介入。
  - 风险：中低——误点 ❌ 会降一级 verified；但「不适用」有独立按钮 `inapplicable`（本就不降），所以 ❌ 语义就是「内容错」，降 verified 合理。
  - 成本：低——`memory-admin.mjs` 一处函数，回归 +2~3 断言。
  - 取舍：是否降 `verified` 是唯一争议点，见 §5（默认降，可配）。

#### P1c `hookPrior` 权重重平衡

- **现状**：`0.85 BM25 + 0.10 CJK + 0.05 prior`；prior 内 `0.45 success + 0.25 uses + 0.20 verified + 0.10 recency`。
- **方案**：提 prior 权重 `0.05 → 0.15`，BM25 `0.85 → 0.75`，CJK 保持 0.10；把 `RECALL_PRIOR_WEIGHT = 0.15` 提为命名常量便于回归。最终 `0.75 BM25 + 0.10 CJK + 0.15 prior`，verified+success 影响上限 ≈ 9.75%。
- **评估**：
  - 影响：中高——纠错从「几乎无效」到「可感知」。
  - 风险：中——prior 过大让「高频老卡」压制「新相关卡」（正是 AGENTS.md §5 的策略惯性/创伤陷阱）。15% 是折中，BM25 仍占 75% 主导语义相关；20% 以上不推荐。
  - 成本：低——一处常量 + 打分断言微调（现有「相关卡 > 无关卡」断言需在改权重后重跑确认仍成立）。
  - 取舍：0.12 / 0.15 / 0.20。**建议 0.15 起步**，engine-probe / E2E 不满意再调。

### P2 · 语义纠错的确定性兜底（「待重审」清单）

- **约束**：插件不调模型（`math-memory.mjs` 头注释红线），因此**不能**做确定性语义判定；只能「确定性检测 + 模型执行」，与现有体检哲学一致。
- **方案**：
  1. P1b 的 `last_wrong`（或显式 `needs_review: true`）作为「待重审」状态位；`confirm` 或模型重审通过后清除。
  2. `buildAuditReport()` 新增「待重审」段：列出带 `last_wrong`（近 N 天）或 `needs_review` 的卡 + 其 `source` 链，注入预算内（复用 MAX_AUDIT_CHARS 1200）。
  3. `AGENTS.md` 体检段补规则：待重审卡在相关讨论时读 `source` 证据链重判对错 → 改内容或降 `verified`/`status`，改完清 `needs_review`。
- **评估**：
  - 影响：中——给错误记忆一个确定、可追踪的纠错入口，不再等模型「碰巧」发现。
  - 风险：低——只加标记 + 清单，不改变任何自动行为。
  - 成本：低——frontmatter 字段 + 一段报告，回归 +1。
  - 明确不做：完全确定性的语义校验（需 embedding/LLM，违反红线）；若 Tier B embedding 后置后端落地，再议「矛盾检测」。

### P3 · 遗忘真正发生（低效用卡确定性自动归档）

- **现状**：`archiveCandidates` 已确定性算出（0.5 verified + 0.3 freq + 0.2 recency，排除 user-confirmed），但只「向用户建议处置，不自行删除」；`archiveMemoryFile()`（软移动）已实现。
- **方案**：新增可配置开关 `autoArchive`（`.deepseek/config.md` 或 `agent.cordis.yml`），**默认 off**。开启后，体检对**同时满足**以下条件的卡确定性移入 `.deepseek/archive/records/`（移动而非删除，可逆）：
  - `status === 'active'` 且 `verified !== 'user-confirmed'`；
  - `uses === 0` 且 `days > 90`（零使用 + 长期陈旧）；
  - 不在 `duplicates` 的「被保留方」（避免归档刚合并的卡）。
- **评估**：
  - 影响：中——让「遗忘」像 episode 归档（`archiveOldEpisodes`，已有先例）一样自动发生，控制库规模。
  - 风险：低——默认 off；只动「零使用 + 非确认 + 超陈旧」最安全档；移动非删除、可逆。
  - 成本：低——复用 `archiveMemoryFile` + 一个开关，回归 +1~2。
  - 取舍：默认 off 还是 on，见 §5（保守默认 off）。

### P4 · 合并的确定性一步（`duplicate_of` 标记 + 检索去重）

- **现状**：`duplicates` 确定性检测（同算子 + Jaccard≥0.7），但合并是 AGENTS.md 让模型做；且重复卡不降权（同 P1a 缺口）。
- **方案**：
  1. 体检在检测到重复对时，确定性给「冗余方」（uses 更少/更旧）写顶层 `duplicate_of: [[保留方]]`（复用 `setTopField`）。
  2. 检索侧对 `duplicate_of` 非空或 `status: superseded` 的卡降权/排除（并入 P1a）。
  3. 模型仍负责最终「合并内容 + 标 superseded」——内容合并需判断保留更全的 evidence/source，不能确定性做。
- **评估**：
  - 影响：中——重复记忆不再互相抢 top-k，检索去重。
  - 风险：低——只加链接字段，不删不改内容。
  - 成本：低——`setTopField` + 一处 filter，回归 +1。
  - 明确不做：确定性自动合并内容（风险：误合并丢掉更全证据）。

### P5 · strategy 卡纳入统一验证/强度生命周期

- **现状**：strategy 卡已进 `AUDIT_CARD_DIRS`（会体检），但 `note_strategy` 只走 BM25、不读 `verified`/`success_rate`；`candidate → active` 的 promote 靠「uses≥3 且成功率达标」的 prompt 规则。
- **方案**：
  1. `note_strategy` 打分加 verified 先验（复用 `hookPrior` 或简化 verified 权重），让 ✅ 策略卡靠前、被标错的靠后。
  2. 体检对 strategy 卡的 `candidate → active` 做成确定性：`status===candidate && uses>=3 && successRate>=0.6 → status=active`（确定性回写，复用 `syncHookStatsToCard` 的模式）。
- **评估**：
  - 影响：中——策略层（≈OpenViking 的 Skills）与 records 共享同一套 promote/demote。
  - 风险：低。
  - 成本：低——`note_strategy` 一处打分 + 体检一处回写，回归 +1~2。
  - 优先级：P2（依赖 P1c 的 prior 语义统一）。

---

## 3. OpenViking 吸收对照

[OpenViking](https://github.com/volcengine/OpenViking)（[文档](https://docs.openviking.ai/zh/getting-started/01-introduction)）：Self-evolving Context Database，统一 **Agent Memory / Knowledge RAG / Skills**，核心是给每段记忆一个**强度值**，靠「强化—遗忘曲线」让记忆自己长、自己老、自己淘汰。

| OpenViking 机制 | 我们的现状 | 本提案吸收点 |
|---|---|---|
| 记忆强度 + 遗忘曲线（衰减到阈值真正遗忘） | 有强度信号（success_rate/uses/recency）+ 归档候选，但只「建议」不执行 | **P3**：确定性自动归档（最安全档，默认 off） |
| 巩固/合并（consolidation，相关记忆自动合并抽象） | 重复检测已确定性（Jaccard≥0.7），合并靠模型 | **P4**：确定性 `duplicate_of` 标记 + 检索去重 |
| 冲突更新（新事实矛盾 → 自动纠正旧记忆） | 有 `superseded` 写法、无触发机制 | **P1a + P2**：superseded 真正进检索 + 待重审清单 |
| Memory / Knowledge / Skills 同一套强度生命周期 | records 有 prior，strategy 只 BM25 | **P5**：strategy 纳入统一 verified/strength |
| 自我更新（自我演进、记忆随使用变好） | 反馈闭环 + 每日体检 | **P1b/P1c**：纠错信号真正进入检索 |

**不照搬的部分**：OpenViking 的「记忆强度」是黑盒服务内部状态；我们坚持「记忆 = vault 里的 markdown + 可见 frontmatter 字段」，强度只是 frontmatter 字段 + 检索权重，不引入外部服务、不引入数据库。

---

## 4. 评估总表与优先级

| 项 | 改动点 | 影响 | 风险 | 成本 | 优先级 |
|---|---|---|---|---|---|
| P1a | `note_recall` 排除 superseded | 高 | 低 | 低 | **P0** |
| P1b | `wrong` 降 verified + 惩罚更陡 | 高 | 中低 | 低 | **P0** |
| P1c | prior 权重 0.05→0.15 | 中高 | 中 | 低 | **P0** |
| P2 | 待重审清单 | 中 | 低 | 低 | P1 |
| P4 | duplicate_of 标记 + 检索去重 | 中 | 低 | 低 | P1 |
| P3 | 自动归档（默认 off） | 中 | 低 | 低 | P1（需拍板默认值） |
| P5 | strategy 统一生命周期 | 中 | 低 | 低 | P2 |

**建议落地顺序**：第一轮 P1（三件套，一次回归一起过）；第二轮 P2 + P4；P3、P5 视用户拍板再动。

---

## 5. 明确不做 / 争议点（需用户拍板）

1. **`❌` 是否同时降 `verified`**（P1b）：默认「降一级」。若担心误点，可改为「只降 success_rate + 写 last_wrong，verified 由待重审（P2）模型复核后再降」——更保守，但闭环慢一步。
2. **自动归档默认开/关**（P3）：默认 **off**（与「无删除工具、删除由用户决定」原则最一致）。若接受「最安全档自动归档」，可默认 on。
3. **superseded 排除 vs 降权**（P1a）：默认**排除**。如需「仍能在 top-k 里看到但垫底」，改降权。
4. **明确不做**：确定性语义校验（需 embedding/LLM，违反插件不调模型红线）；确定性自动合并内容（误合并丢证据）；任何硬删除。

---

## 6. 回归与文档同步计划（落地时必做）

- 每条落地配零 token 回归（`scripts/test-memory.mjs`）：P1a +1、P1b +2~3、P1c 打分断言重跑、P2 +1、P3 +1~2、P4 +1、P5 +1~2。
- 断言数变化同步 `scripts/check-doc-consistency.mjs` 与 `docs/memory/README.md` 状态表（仓库有守卫）。
- `design.md` §10 已知局限同步更新（superseded 不降权、wrong 不降 verified 两条缺陷落地后移除/改写）。
- `main.js` / `lib/client.js` 按需重建（改动落在 `dsh/preset/*`、`dsh/host/*` 时）。

---

## 7. 实现状态表

| 项 | 状态 | 位置 |
|---|---|---|
| P1a superseded 排除 | ✅ 已实现 | `note-tools.mjs` note_recall（`isRecallEligible`） |
| P1b wrong 降 verified + 惩罚 | ✅ 已实现 | `memory-admin.mjs` applyFeedback |
| P1c prior 权重 0.15 | ✅ 已实现 | `note-tools.mjs` 打分公式（`RECALL_*_WEIGHT`） |
| P2 待重审清单 | ✅ 已实现 | `math-memory.mjs` buildAuditReport（`pendingReview`） |
| P3 自动归档（off 默认） | ✅ 已实现 | `math-memory.mjs`（`moveCardsToArchive`）+ `config.md`/`agent.cordis.yml` 开关 |
| P4 duplicate_of 标记 | ✅ 已实现 | `math-memory.mjs` buildAuditReport + note_recall 去重 |
| P5 strategy 统一生命周期 | ✅ 已实现 | `note-tools.mjs` note_strategy + 体检顶层字段回退/回写/promote |
