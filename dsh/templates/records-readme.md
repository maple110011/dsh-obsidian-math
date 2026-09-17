# 记忆记录层说明（原子记忆卡）

> 本目录是**类型化原子记忆层**（借鉴 NapMem 的 typed memory records）：把每轮对话的证据提炼成一条条独立记录，位于原始事件（episodes）与主题/画像之间。
> 设计依据：arXiv:2607.05794（NapMem）——原始对话之上需要一层可检索、可验证、可溯源的原子记录。

## 记录类型（五类）

| type | 含义 | 例子 |
|---|---|---|
| `fact` | 客观事实 | “用户在读 Tao 的《实分析》第 3 章” |
| `event` | 发生过的事件/决定 | “2026-08-15 决定改用 3180 端口” |
| `instruction` | 用户的长期指令/约定 | “关键想法默认写入备忘录” |
| `preference` | 偏好/习惯/倾向 | “偏好构造性证明，先看例子” |
| `artifact` | 证明工作产物 | 玩具例子、反例、分解计划、证明障碍、提取到的证明模式（吸收 Rethlas 的工作记忆设计） |

## 单条记录模板（`records/<slug>.md`）

```markdown
---
id: rec-<slug>
type: fact            # fact / event / instruction / preference / artifact
status: active        # active / superseded
created: YYYY-MM-DD
updated: YYYY-MM-DD
source: '[[YYYY-MM-DD-episode-slug]]'
topic: <相关主题或“未归类”>
related: []
depends_on: []         # 可选：本卡**建立在这些卡之上**（有方向！见下）；与 related 不同
confidence: 1.0        # 可选：0–1，可修订事实/偏好的置信度（被质疑时下调；模型维护）
hook:                 # 可选：检索特征块（记忆 v2，供 note_recall 统一检索加权）
  operator: probability      # 算子类型：algebra/number-theory/geometry/combinatorics/probability/analysis/statistics/calculus/linear-algebra/topology/logic
  pattern: subsequence_argument   # 结构模式（下划线分词）
  heuristics:           # 启发式签名
    - decompose
  quantity: sum-of-independent-rvs   # 数量签名（可省略）
  techniques:           # 可迁移技巧（Dual RAG 上下文增强；reinforce 时追加）
    - borel-cantelli
  applications: 证明 a.s. 收敛类问题   # 能解决什么挑战（与查询侧对齐）
  verified: single-source   # single-source / cross-referenced / user-confirmed（升级需用户参与）
  # uses / success_rate / last_used / harmed / verified_by 由插件维护，不要手写
not_applicable_when: 成本非二次、μ 非绝对连续   # 适用边界：短句/关键词列表（见下方说明）
---

# <一句话陈述>

## 内容
<精确、可独立理解的事实/决定/指令/偏好>

## 证据
- 来源事件：[[YYYY-MM-DD-episode-slug]]
- 原始表述摘录：<引用原文>

## 变更历史
- YYYY-MM-DD：创建
```

## hook 块说明（记忆 v2，检索特征）

- **写什么**：`operator/pattern/heuristics/quantity/techniques/applications/verified` 由你在创建卡片时填写，`techniques` 在 reinforce 时追加（来自真实证明/解题过程，不得编造）。
- **谁维护统计**：`uses/success_rate/last_used/harmed/gain` 由插件确定性维护——`note_recall` 命中计数写入 `cache/retrieval-stats.json`，每日体检把计数回写进 hook 块；`harmed` 在用户点 ❌ 时累加（「用过但结果更差」）；**`gain` 是插件写的结果裁决**（❌ ⇒ `-1`、✅ ⇒ `+1`、无反馈则**不写这一行**＝中性），它**影响检索排序**：负值的卡会排到未评级卡之后。**你永远不手写/手改这些字段。**
- **验证等级与凭据**：新建只能写 `single-source`；与 vault 内笔记互证后可升级 `cross-referenced`；`user-confirmed` 只能在用户明确确认后写。`verified_by` 是升级的凭据，**只有用户点 ✅ 时由插件写入**——你不要写；体检会把「等级高于 single-source 却没有凭据」的卡列为越权升级。
- **适用边界 `not_applicable_when`（强烈建议写）**：一句话说明「什么情况下别用这张卡」。它不只是注释：`note_recall` / `note_strategy` 会拿它当**硬门控**——查询里出现边界短语时该卡不进候选，而是在结果里单独列出「因适用边界被排除」。所以**写成短句/关键词列表**（顿号分隔、每条 ≤12 字），例如 `not_applicable_when: 成本非二次、μ 非绝对连续`；写成整段散文会被拆成碎片，门控就不准。
- **为什么要有 hook**：统一检索（`note_recall`）用 hook 字段加权打分与算子过滤；没有 hook 的卡只能靠全文匹配被找到，检索质量明显更低。artifact 与 solution 类卡片**建议必有**，fact/preference 类可省略。

## `depends_on` 说明（有方向的依据链）

`related` 是**无方向**的「另见」；`depends_on` 是**有方向**的「本卡建立在这些卡之上」。差别不是格式，而是**能不能回答一个具体问题**：当某张卡被标 `superseded`、或被用户标 ❌（`needs_review`）时，**哪些卡是踩在它上面的、需要重读？** 无方向的 `related` 回答不了。

- **写什么**：`depends_on: ['[[rec-xxx]]', '[[thm-yyy]]']`——只写你**真的用到**的那几张（那张卡的结论是你这张卡成立的前提），不要写"主题相近"的卡（那属于 `related`）。
- **写反了的代价**：体检会顺着它列「下游待复查」清单；写宽了会产出噪音，写漏了就漏报。**宁可漏写也不要乱写**：漏写只是没提醒，乱写会让清单失去可信度。
- **本字段是建议性的**：体检只**报告**，不会自动改动下游卡——依据被改写后下游是否仍成立，只有读原文才能判断（与 `uses` 回写不一致时「报出来、绝不自动重试」同一条纪律）。
- **谁维护**：由你在写卡/改卡时维护。它属于内容字段，不是插件统计字段。

## 维护规则（AI 执行）

1. **先写 episode，再写 record**：每轮收尾先追加原始事件卡，然后把本轮的新事实/决定/指令/偏好提炼为记录。
2. **调和（reconcile）而非追加**：新记录与已有记录相同 → 更新原记录、标注 `updated`；冲突 → 旧记录 `status: superseded` 并在“变更历史”写明“旧值 → 新值（日期）”，新记录指向旧记录；禁止删除旧记录。
3. **溯源**：每条记录的 `source` 必须指向至少一个 episode；无法溯源的内容不要写入记录层。
4. **传播**：记录更新后，再按需更新 `topics/index.md` 与 `profile.md`（局部更新）。
5. **索引行要写全三段**：`- [[rec-slug|一句话]] · topic · updated: YYYY-MM-DD` 里的那句"一句话"必须让读者**不打开卡片就能判断相关性**——写清**是什么 + 为什么有效（机制/根因）+ 具体怎么做**，不要只写卡名或一个字。体检会确定性检查**描述是否为空白/过短**（下限 8 字符）并点名，只报告不代写。
5. 更新 `records/index.md`（按类型分组一行一条）。
6. **体检响应**：系统提示的「记忆体检」段列出 weak/疑似重复/unused/strong/unverified 时，按 AGENTS.md 第 2 节的体检规则处理（合并标 superseded、绝不删除文件）。
7. **可修订记录（置信与备选，Belief Memory 本土化）**：fact / preference 可能被后续证据推翻，不要当成不可改的点估计——有反证/存疑时在「内容」里保留备选结论与各自依据；被用户判错（[❌ 这条错]）时不删除，记「已推翻 → 新结论（日期）」，可下调 `confidence`。
