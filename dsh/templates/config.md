---
enabled: true
dialogueIndex: true
reminders: true
audit: true
autoArchive: true
sessionCapture: false
captureSubagents: false
budget: standard
---

# 记忆系统设置（本工作区）

> 独立设置面板：本文件与 Obsidian 插件、dsh web 均无关，直接改上方 frontmatter 的 `true`/`false` 即可。
> 缺省字段使用 preset 默认值（`agent.cordis.yml`）；本文件仅覆盖当前工作区（vault/文件夹）。
> **本文件在升级时被保留**，所以这里写下的值优先于 preset 的新默认值——想跟随新默认值就把那一行删掉。

- `enabled`：总开关。`false` = 本工作区完全停用记忆（不注入 / 不体检 / 不扫对话索引；文件与缓存原样保留）。
- `dialogueIndex`：是否扫描历史会话、生成跨会话问答线索。
- `reminders`：是否在回复里注入 🔔 备忘录提醒候选。
- `audit`：是否运行每日确定性记忆体检。
- `autoArchive`：体检时是否把「零使用 + 长期陈旧（>90 天）+ 非用户确认」的低效用卡自动移入 `.deepseek/archive/<层>/`（移动而非删除，可逆、有 `.bak`）。**2026-09-18 起默认 `true`**——逐张点「归档」属于用户要求做掉的那类平凡工作；判据很窄（零使用 + 90 天 + 非用户确认）。改 `false` 即回到「只建议、不自动归档」。
- `sessionCapture`：是否自动把每场对话**保存到记忆**（整场对话、不含思考，写进 `.deepseek/memory/episodes/` 证据层，与模型三写解耦）。默认 `false`（不自动保存；需要时可在插件设置里开启，或把模型三写设为 ask 让每次写入先征得同意）。
- `captureSubagents`：`sessionCapture` 开启时，是否也保存**子代理会话**。默认 `false`——子代理会话会重放父会话的前缀，保存它等于把同一场对话重复入库。dsh ≥ 0.1.5 的 V3 头部带 `origin: subagent` / `delegationDepth`，据此可判定；旧格式（V2）没有这两个字段，因此无法区分、一律保留。
- `budget`：往提示里注入多少「导航」（`compact` / `standard` / `rich`），默认 `standard`。它**不限制正文**——答案内容仍由 `note_recall` 按需检索。插件设置页里也有同一个档位（写的就是这一行）。
