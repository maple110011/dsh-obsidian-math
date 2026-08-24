---
title: 收敛模式加强
type: solution
status: active
updated: 2026-08-20
hook:
  operator: probability
  pattern: convergence_strengthening
  techniques:
    - borel-cantelli
    - subsequence-trick
  applications: 把「依测度/依分布收敛」加强到「几乎处处收敛」的题型
  verified: single-source
  uses: 0
---

# 收敛模式加强（题型模板）

## 题型

「从 $X_n \xrightarrow{P} X$ 推出子列 $X_{n_k} \to X$ a.s.」一类问题。

## 解法骨架

1. 取几何衰减的 $\varepsilon_k = 2^{-k}$；
2. 选子列使 $P(|X_{n_k}-X| > \varepsilon_k) < \varepsilon_k$；
3. Borel-Cantelli → $P(\text{i.o.})=0$ → 子列 a.s. 收敛。

## 关联定理

- [[Borel-Cantelli]]
