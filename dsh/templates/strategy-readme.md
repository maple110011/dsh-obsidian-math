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
4. 更新 `strategy/index.md`（按 difficulty 分组一行一条）。
5. **检索纪律**：策略卡是「候选」不是「指令」——命中后仍要按 AGENTS.md §5 记忆适用性逐条重判（防 Reasoning Fixation）。
