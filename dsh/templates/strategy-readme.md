# 策略层说明（方法卡）

> 本目录是**方法层**：agent 与用户共同沉淀的「怎么攻一类问题」的策略（困难 → 方法 → 检索目标），独立于用户内容层（notes/records/theorems/templates）。设计规格见 `docs/memory/strategy-layer.md`。
> 一条 strategy 卡的本质是「带 trigger 的原子方法」：遇到什么困难时、用什么方法、去哪找。

## 单条策略卡模板（`strategy/<slug>.md`）

```markdown
---
type: strategy
id: strat-<slug>
status: candidate        # candidate（候选） / active（正式）
difficulty: <困难类型>   # 主轴：跨算子相通（如 definition-level-proof）
domain: [analysis]       # 算子轴：软偏好（可省略；同域加分、跨域不硬拦）
problem_type: proof      # 证明 / 计算 / 构造 / 验证
strategies:              # 方法 × 检索目标（每对 move→retrieve）
  - move: 等价刻画
    retrieve: [similar-problem, theorem]
  - move: 反证法
    retrieve: [similar-problem, proven-path]
abstraction:             # 抽象阶梯（三段，跨层级检索面）
  concrete: "定义层证明 → 等价刻画绕开逐字展开"
  principle: "定义难证时，先找等价/更易验证的刻画"
  generalize: "任何『逐点/逐字展开太繁琐』的证明场景"
not_applicable_when: "等价刻画不存在或更繁时"   # 防固定护栏（MemTrapBench）
decision_guidance:        # 成对的对比指导（可选）：同场景下该做 / 该避免什么，各带证据
  prefer: []              # 建议：'先试等价刻画（证据：[[rec-xxx]]）'
  avoid: []               # 避免：'不要直接展开定义（证据：[[rec-yyy]]，曾因此绕远）'
provenance: agent        # user / agent / both（来源）
verified: single-source  # single-source / cross-referenced / user-confirmed
# uses / success_rate 由插件维护，不要手写
source: '[[YYYY-MM-DD-episode-slug]]'
---

# <一句话：什么困难、用什么方法>
```

## 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `difficulty` | ✅ | 困难类型（主轴、跨算子）——触发检索的主匹配键 |
| `domain` | 可选 | 算子（软偏好，同域加分、跨域不硬拦） |
| `problem_type` | 可选 | 证明 / 计算 / 构造 / 验证 |
| `strategies[].move` | ✅ | 方法/策略（开放词汇，随使用沉淀） |
| `strategies[].retrieve` | ✅ | 检索目标（固定枚举：similar-problem / technique / theorem / proven-path / definition / notation） |
| `abstraction` | 建议 | 抽象阶梯三段：concrete（具体）/ principle（原理）/ generalize（一般化） |
| `not_applicable_when` | 建议 | 何时不适用（防固定） |
| `provenance` | ✅ | 来源：user（用户笔记提炼）/ agent（agent 解题沉淀）/ both |

## 维护规则（AI 执行 + 体检确定性维护）

1. **候选产生**：三写时把「本轮用到的困难→策略」写进 candidate 卡（`status: candidate`、`verified: single-source`）；候选来源包括**内嵌技巧 callout（`>[!tip]`）+ 用户备忘 bullet**，不只 hook 字段。
2. **promote**：每日体检统计「difficulty + move」的 uses/success_rate，`uses ≥ 3` 且 `success_rate ≥ 0.6` → `status: active`；未达标留在 candidate。
3. **demote / 反模式**：连续失败 3 次 → 体检 flag「补 `not_applicable_when` 或降级」。
4. 更新 `strategy/index.md`（按 difficulty 分组一行一条）。**这一行要写全三段**：什么困难 + **为什么有效** + 具体怎么做（如 `- [[strat-eq-characterization|定义难证时先找等价刻画，绕开逐字展开]] · definition-level-proof · updated: …`）。理由：读者（人和 agent）**靠这一行决定要不要打开整张卡**；只写卡名或一个字（`- [[x|?]]`）等于让索引失去作用。体检会确定性检查**描述是否为空白/过短**（下限 8 字符）并点名，但**只报告不代写**——措辞是你的活。
5. **检索纪律**：策略卡是「候选」不是「指令」——命中后仍要按 AGENTS.md §5 记忆适用性逐条重判（防 Reasoning Fixation）。
6. **状态即权限（2026-09-17 起由检索强制）**：`note_strategy` 按 `status` **分组返回**——`matches` 是可依据的卡（`active` 或**未声明** status），`candidates` 是 `status: candidate` 的卡。候选卡会以「可以把 moves 当线索试用，但**不得当作已验证技巧引用**」单独列出。**所以 `status` 不只是标签**：写了 `candidate` 就等于声明"这张卡还没被使用记录晋升"，会被自动降格为线索。晋升规则见第 2 条（`uses ≥ 3` 且 `success_rate ≥ 0.6` 由体检确定性改写为 `active`），**另有一道接地门**：候选卡若没有 `source`，即使达标也不晋升，体检会点名并说明"补上 source 后会自行晋升"。
7. **成对的对比指导 `decision_guidance`（可选，但强烈建议在有失败经验时写）**：`prefer` 写"同场景下建议怎么做"，`avoid` 写"避免怎么做"，**每条都带证据链接**。理由：只写"该怎么做"记不住教训；成对写出"该做 / 该避免"才能把一次失败固化成可迁移的判断。这也与体检的「反模式」呼应——反模式是一条散句，`avoid` 是**挂在具体策略上、带证据**的那一条。
8. **`not_applicable_when` 会被反馈自动收窄**：用户点「🔁 本次场景不适用」时，插件会把**本次检索用到的、且确实出现在本卡里的关键词**追加进边界（最多 2 条，每条 ≤12 字——必须符合边界语法，否则门控切不准）。所以边界可能在你没改它的情况下变长，这是有意的：**否决应当收窄适用面，而不只是降低成功率**。注意用户点「❌ 这张卡有错」**不会**动边界——那是内容判定，不是适用范围判定。
9. **move 要少、要有条件，且不写语法级 workaround（三条纪律）**：
   - **moves ≤ 5**：超过 5 个 move 的卡基本等于"什么情况都能用"，也就等于没有触发条件。体检会点名（**按原文计数**——`strategies:` 在 frontmatter 里，不是正文）。
   - **每个 move 写清触发条件**，不要让它们变成每轮必跑的前置清单：检索步数是硬预算（一轮最多 1 次 `note_strategy` + 最多 4 步内容检索），无条件的清单会**挤掉真正解决问题的检索**。跨模型迁移的负迁移研究（WikiSkill, arXiv:2608.27454 §4.2.2）把"碎片化前置检查耗尽交互预算"列为负迁移两大诱因之一。
   - **不写语法级 workaround**：`concrete` 段写"具体场景"，**不写死具体算子/记号/结论**（那属于 `theorems` / `notation` 层）。把底层变通写进方法卡，会让方法卡只对"当初那个执行者"有效——同一个原因的另一个诱因是"底层 workaround 硬化会束缚更强的执行者"。
   - **卡片要短**：正文非空行 **≤ 20 行**；长的推导过程写进 episode，卡只留可复用的骨架。
