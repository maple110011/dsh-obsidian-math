# 记忆记录层说明（原子记忆卡）

> 本目录是**类型化原子记忆层**（借鉴 NapMem 的 typed memory records）：把每轮对话的证据提炼成一条条独立记录，位于原始事件（episodes）与主题/画像之间。
> 设计依据：arXiv:2607.05794（NapMem）——原始对话之上需要一层可检索、可验证、可溯源的原子记录。

## 记录类型（四类）

| type | 含义 | 例子 |
|---|---|---|
| `fact` | 客观事实 | “用户在读 Tao 的《实分析》第 3 章” |
| `event` | 发生过的事件/决定 | “2026-08-15 决定改用 3180 端口” |
| `instruction` | 用户的长期指令/约定 | “关键想法默认写入备忘录” |
| `preference` | 偏好/习惯/倾向 | “偏好构造性证明，先看例子” |

## 单条记录模板（`records/<slug>.md`）

```markdown
---
id: rec-<slug>
type: fact            # fact / event / instruction / preference
status: active        # active / superseded
created: YYYY-MM-DD
updated: YYYY-MM-DD
source: '[[YYYY-MM-DD-episode-slug]]'
topic: <相关主题或“未归类”>
related: []
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

## 维护规则（AI 执行）

1. **先写 episode，再写 record**：每轮收尾先追加原始事件卡，然后把本轮的新事实/决定/指令/偏好提炼为记录。
2. **调和（reconcile）而非追加**：新记录与已有记录相同 → 更新原记录、标注 `updated`；冲突 → 旧记录 `status: superseded` 并在“变更历史”写明“旧值 → 新值（日期）”，新记录指向旧记录；禁止删除旧记录。
3. **溯源**：每条记录的 `source` 必须指向至少一个 episode；无法溯源的内容不要写入记录层。
4. **传播**：记录更新后，再按需更新 `topics/index.md` 与 `profile.md`（局部更新）。
5. 更新 `records/index.md`（按类型分组一行一条）。
