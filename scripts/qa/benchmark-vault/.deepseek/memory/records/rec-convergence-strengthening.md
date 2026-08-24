---
id: rec-convergence-strengthening
type: artifact
status: active
created: 2026-08-20
updated: 2026-08-20
source: '[[2026-08-20-收敛加强]]'
topic: 概率论
confidence: 0.9
hook:
  operator: probability
  pattern: subsequence_argument
  heuristics:
    - fast_subsequence
  techniques:
    - borel-cantelli
    - subsequence-trick
  applications: 证明「依测度收敛 → 子列几乎处处收敛」类问题；任何「从弱收敛模式加强到逐点结论」的场景
  verified: single-source
  uses: 0
---

# 依测度收敛加强到 a.s. 的子列论证

## 内容

若 $X_n \xrightarrow{P} X$，则存在子列 $X_{n_k} \to X$ a.s.。做法：取误差与概率都按 $2^{-k}$ 几何衰减的子列，用 Borel-Cantelli 第一引理。

## 证据

- 来源事件：[[2026-08-20-收敛加强]]
- 原始表述摘录：见 episode「从依测度收敛到几乎处处收敛」一节

## 变更历史

- 2026-08-20：创建
