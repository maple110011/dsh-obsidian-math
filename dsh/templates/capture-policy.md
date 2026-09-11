---
idea: ask
fact: ask
preference: ask
structure: auto
updated: 2026-09-10
---
# 捕获策略（capture policy）

> 由**用户**维护，模型不得修改此文件。用户口头指令永远优先于本文件。

控制助手把新信息写入记忆的方式：**四个档位 × 三档策略**。每个档位对应一组记忆层，照表执行——不要再按「三写协议第几步」去推断某个文件归哪一档。

- `auto` = 按 AGENTS.md 三写协议直接写入；
- `ask` = 先用 ask_user 征得同意，再写入；
- `off` = 不主动捕获（用户明确要求时除外）。

| 字段 | 管哪些层 | 默认 | 说明 |
|---|---|---|---|
| `idea` | `inbox/` 想法备忘录 | `ask` | 识别到一般性思路/方法/技巧/观点时先问再写 |
| `fact` | `memory/records/`：fact / event / instruction / artifact | `ask` | 新事实、事件、指令、工作产物（例子/反例/分解计划/障碍）——记录层的内容 |
| `preference` | `memory/profile.md`、`memory/notation.md` | `ask` | 「现在仍成立」的稳定偏好、授权、记号体系 |
| `structure` | `memory/topics/`、`memory/theorems/index.md`、`memory/templates/`、`strategy/` | `auto` | 导航与结构写入：给已有内容补索引行、登记定理、抽象模板、沉淀方法卡。默认 `auto`，因为它通常只是给**已经存在**的内容补一行索引，每次都问会明显打断对话 |

两点补充：

1. **`structure` 是后加的字段**：如果你的 `capture-policy.md` 里没有这一行，行为等同于 `auto`（与 0.7.x 一致，升级不会让你被多问）。
2. **事件层（`memory/episodes/`）不受本表管辖**：整场对话的原文由确定性捕获写入，开关是 `.deepseek/config.md` 的 `sessionCapture`（**默认关**；需要时在插件设置里开启）。它的定位是「原始证据」，不是模型决定要不要记的内容。

修改方式：编辑上方 frontmatter 的四个字段（`auto` / `ask` / `off`），并更新 `updated` 日期。
例如：不希望任何自动写入打扰时把 `idea`/`fact`/`preference` 全改为 `ask`；只想被问、完全手动时全改为 `off`；嫌索引类写入太啰嗦时把 `structure` 也改成 `ask`。

面板上也可以直接点：Obsidian 记忆面板与 dsh web 记忆面板的「捕获策略」一行，点一下在 `自动写入 → 先询问 → 不捕获` 之间轮换（写回本文件）。
