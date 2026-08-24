---
enabled: true
dialogueIndex: true
reminders: true
audit: true
---

# 记忆系统设置（本工作区）

> 独立设置面板：本文件与 Obsidian 插件、dsh web ui 均无关，直接改上方 frontmatter 的 `true`/`false` 即可。
> 缺省字段使用 preset 默认值（`agent.cordis.yml`）；本文件仅覆盖当前工作区（vault/文件夹）。

- `enabled`：总开关。`false` = 本工作区完全停用记忆（不注入 / 不体检 / 不扫对话索引；文件与缓存原样保留）。
- `dialogueIndex`：是否扫描历史会话、生成跨会话问答线索。
- `reminders`：是否在回复里注入 🔔 备忘录提醒候选。
- `audit`：是否运行每日确定性记忆体检。
