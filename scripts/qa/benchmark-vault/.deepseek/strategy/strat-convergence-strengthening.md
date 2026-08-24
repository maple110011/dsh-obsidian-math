---
type: strategy
id: strat-convergence-strengthening
status: active
difficulty: convergence-strengthening
domain: [probability]
problem_type: proof
strategies:
  - move: 快子列（几何衰减）
    retrieve: [technique, theorem]
  - move: Borel-Cantelli
    retrieve: [theorem, proven-path]
  - move: 对角线论证
    retrieve: [similar-problem, technique]
abstraction:
  concrete: "依测度收敛 → 子列 a.s. 收敛"
  principle: "先取子列、再加紧：从弱收敛模式加强到逐点结论的通法"
  generalize: "任何『想从较弱收敛拿到 a.s./逐点结论』的场景"
not_applicable_when: "序列不依测度收敛，或无法选到几何衰减子列时"
provenance: agent
verified: single-source
source: '[[2026-08-20-收敛加强]]'
---

# 收敛加强：从依测度到 a.s.

遇到「把依测度/依分布收敛加强到几乎处处收敛」时，先用快子列 + Borel-Cantelli，再考虑对角线论证。
