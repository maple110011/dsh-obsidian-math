# 问题模板层说明（模板-定理关联图，轻量版）

> 本目录是本 vault 的**问题模板库**（借鉴 AAAI-26《Template-Theorems Graph Construction to Enhance Mathematical Reasoning Capabilities of LLM》）：把做过的题/证明模式抽象成可复用的“问题模板”，并与相关定理建立关联——模拟人类“见过同类题 → 想起相关定理”的认知过程。
> 与远程图数据库不同，这里是纯 markdown + 双链：每张模板卡就是一个节点，`related` 就是边。

## 模板卡（`templates/<slug>.md`）

```markdown
---
title: <模板名>
type: problem          # problem（题型模板）/ solution（解题步骤模板）
updated: YYYY-MM-DD
status: active         # active / superseded
related_theorems:
  - '[[theorems/index#定理名|定理名]]'
related_notes: []
source: '[[YYYY-MM-DD-episode-slug]]'
hook:                 # 可选：检索特征块（供 note_recall 统一检索加权）
  operator: probability
  pattern: subsequence_argument
  heuristics:
    - decompose
  techniques:
    - borel-cantelli
  applications: 证明 a.s. 收敛类问题
  verified: single-source
  # uses / success_rate / last_used 由插件维护，不要手写
---

# <模板名>

## 问题原型
<把具体题目抽象成一句话的一般形式，去掉表面细节>

## 解题步骤
1. <关键步骤：每步是实质性推理，不是标点切分>
2. …

## 适用边界
<什么条件下适用、常见误用>

## 关联定理
- [[theorems/index#定理名|定理名]]：<在该模板中扮演的角色>
```

## hook 块说明（记忆 v2，检索特征）

- 模板卡的 `hook.operator/pattern/heuristics/techniques/applications` 由你创建时填写、reinforce 时追加；`uses/success_rate/last_used` 由插件维护，**不要手写**。
- `verified` 新建只能写 `single-source`；升级到 `cross-referenced`/`user-confirmed` 必须用户参与。
- 有 hook 的模板卡才能被 `note_recall` 按策略加权检索到；solution 类卡片建议必有 hook。

## 维护规则（AI 执行）

1. **问题蒸馏（检索前）**：遇到新问题时，先把它抽象成模板表达（去掉具体数字/语境），并转成“挑战描述 + 2~3 条候选技巧关键词”。
2. **策略检索**：先用 `note_recall`（可带 operator 过滤）统一检索（笔记+带 hook 卡片）；同时查 `templates/index.md`。
3. **命中**：读命中的模板卡与 `related_theorems`，对定理**去重聚合**后进入推理；不要只取表面相似度最高的一个。
4. **未命中**：问题解决后，把新题型/新解法提取为模板卡（从你的实际解题过程中抽象），并把用到的定理写入 `related_theorems`——这就是“从种子问题逐步扩展知识库”。
5. **验证**：模板卡必须来源于真实解决过的问题或笔记（`source` 链接）；不得凭空编造定理名或引用不存在的笔记。
6. 更新 `templates/index.md`（每行一张卡）。
