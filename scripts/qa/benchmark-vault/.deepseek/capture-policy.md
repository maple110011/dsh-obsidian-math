---
idea: ask
fact: auto
preference: auto
updated: 2026-08-16
---
# 捕获策略（capture policy）

> 由**用户**维护，模型不得修改此文件。用户口头指令永远优先于本文件。

控制助手把新信息写入记忆的方式：三类对象 × 三档策略。

- `auto` = 按 AGENTS.md 三写协议直接写入；
- `ask` = 先用 ask_user 征得同意，再写入；
- `off` = 不主动捕获（用户明确要求时除外）。

| 字段 | 对象 | 默认 | 说明 |
|---|---|---|---|
| `idea` | 💡 可捕捉的想法（写入 inbox 备忘录） | `ask` | 识别到一般性思路/方法/技巧时先问再写（既有行为） |
| `fact` | 新事实 / 事件 / 指令（写入 records 原子卡） | `auto` | 三写协议第 2 步的默认节奏 |
| `preference` | 稳定偏好 / 记号 / 授权（写入 profile 与 records） | `auto` | 三写协议第 3 步的默认节奏 |

修改方式：编辑上方 frontmatter 的三个字段（`auto` / `ask` / `off`），并更新 `updated` 日期。
例如：不希望任何自动写入打扰时全部改为 `ask`；只想被问、完全手动时改为 `off`。
