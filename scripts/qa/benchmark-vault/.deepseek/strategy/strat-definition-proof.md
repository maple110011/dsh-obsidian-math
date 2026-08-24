---
type: strategy
id: strat-definition-proof
status: candidate
difficulty: definition-level-proof
domain: [analysis, probability]
problem_type: proof
strategies:
  - move: 等价刻画
    retrieve: [similar-problem, theorem]
  - move: 反证法
    retrieve: [similar-problem, proven-path]
abstraction:
  concrete: "定义层证明 → 等价刻画绕开逐字展开"
  principle: "定义难证时，先找等价/更易验证的刻画"
  generalize: "任何『逐点/逐字展开太繁琐』的证明场景"
not_applicable_when: "等价刻画不存在或更繁时"
provenance: agent
verified: single-source
source: '[[2026-08-20-收敛加强]]'
---

# 定义层证明的破局

定义逐字展开太繁时，先找等价刻画或走反证。

## 实例（vault 内已见）

- 依测度 → 子列 a.s.：不逐点验证，取误差与概率都按 $2^{-k}$ 衰减的快子列 + Borel-Cantelli，把「逐点」问题换成「概率和」问题（[[rec-convergence-strengthening]]、[[从依测度收敛到几乎处处收敛]]）
- 弱收敛：用分布函数在连续点收敛（Helly）/ 一致胎紧 ⇔ 相对紧（Prokhorov）绕开「有界连续函数」定义（[[胎紧与弱收敛]]）
- 对角线选取：紧性论证免去逐点构造收敛子列（[[对角线选取方法]]）

## 反证法实例

- Borel-Cantelli 的概率化反证：假设坏事件 i.o. 概率为正，与 $\sum P(A_n) < \infty$ 矛盾。
