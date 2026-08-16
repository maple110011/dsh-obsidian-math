# 记忆控制面：交互规格与注入方案评估（v2 之 ③）

> 目标：让用户对记忆**可见、可溯源、可纠正**。本文档先定义交互规格，再评估三种注入方案并给出分阶段落地计划。
> 状态：**规格定稿；阶段 1a（反馈链接 + 验证徽标）与 1b（Obsidian 记忆面板 ItemView）已实现**；阶段 1c（捕获策略分级）与阶段 2（dsh 客户端列）规划中。

## 1. 要解决的问题（来自 assessment.md 第 1 轮）

- 用户对记忆零透明：写了什么、改了什么只有一行“已记录：N 条”；
- 无回答溯源：不知道答案依据了哪些记忆；
- 无纠错闭环：发现错误记忆只能自己去 .deepseek/ 翻文件；
- 验证等级（hook.verified）目前只能靠对话中用户口头确认，升级路径脆弱。

## 2. 交互规格

### 2.1 验证等级徽标（回答溯源）

代理引用记忆卡时，在正文按 `hook.verified` 标注：

| 徽标 | 等级 | 含义 |
|---|---|---|
| ✅ | user-confirmed | 用户明确确认过 |
| ⚖️ | cross-referenced | 与 vault 内笔记/定理互证 |
| ❓ | single-source | 仅一次对话来源 |

### 2.2 反馈链接（纠错闭环）

依据了记忆卡的回复末尾，代理渲染一对反馈链接（当 `DSH_OBSIDIAN_LINK_URL` 可用时）：

`[✅ 这条对](http://127.0.0.1:<port>/feedback?path=<卡路径>&action=confirm)`
`[❌ 这条错](http://127.0.0.1:<port>/feedback?path=<卡路径>&action=wrong)`

点击后由 Obsidian 插件的 loopback LinkServer 直接、确定性地改写该卡 frontmatter（不经模型、不经 dsh 沙箱）：

| action | 确定性效果 |
|---|---|
| `confirm` | `hook.verified → user-confirmed`；`success_rate → max(现有, 0.9)` |
| `wrong` | `success_rate → max(0.05, 现有 × 0.5)`（Demote，体检的 weak 检测随之生效） |
| `stale` | 顶层 `status → superseded`（不删除，保留证据） |
| `forget` | 文件移入 `.deepseek/archive/records/`（从不硬删除） |

**安全约束**：只接受 vault 相对路径、必须位于 `.deepseek/` 之下、必须解析后仍落在 vault 内；action 白名单；服务只绑 127.0.0.1。

### 2.3 记忆视图（浏览/搜索/编辑）

- 分层浏览五层记忆（profile/topics/records/templates/episodes/inbox）+ 体检报告；
- 每条记忆显示：验证徽标、`hook.uses/success_rate/last_used`、source 链、引用次数；
- 按文件名/tag/operator 过滤搜索；点击打开原文（复用 /open 跳转）；
- 编辑走原文编辑；删除仅指“归档/标记 superseded”，无硬删除按钮。

### 2.4 捕获策略分级（可选项，随视图落地）

偏好/事实/想法三类各自 auto / ask / off；写入 profile 的“长期授权”段。

## 3. 注入方案评估（本机生态实测）

实测对象：`dsh-client-ui-aionui-panel@0.1.14`（本机 web profile 已装配，右侧面板系统）。关键事实：

1. **宿主侧**：Cordis 插件 `inject: [webServer, workspaceRegistry, systemPrompt]`，用 `ctx.webServer.register({ kind: "prefix"|"exact", path, handler })` 挂路由，用 `ctx.effect(() => ..., name)` 管理生命周期，用 workspace gate（canonicalize + 前缀包含判断）做安全边界。
2. **客户端侧**：tsdown 构建的 `client.js` 经 `window.__ModuleLoader__.load()` 注册；官方槽位目前只有 `conversation.input.dock`（输入框上方小条）等，**没有官方的右侧大面板槽位**——aionui 的「预览/文件/变更」列是**自行向页面挂载 DOM 列**实现的（监听 `ctx.sessions.list` 拿当前会话 cwd，固定定位渲染右列，宽窄/折叠用 localStorage 持久化）。
3. **部署**：UI 插件是 web profile 的 bundle（`@linxin666/dsh-client-ui-*`），经 profile 装配；热插拔由 super-injector 支持。

### 方案对比

| 方案 | 实现 | 优点 | 代价/风险 |
|---|---|---|---|
| **A. dsh 客户端自挂列**（aionui 模式） | 新包：宿主路由 `/memory-panel/*`（gate 到 vault 工作区）+ 客户端 tsdown 列 | 与聊天同屏、体验最好；模式被 aionui 验证 | 本仓库引入 tsdown 客户端构建链；自挂 DOM 与 shell 内部结构耦合，shell 升级可能碎；需随 Obsidian 插件引导进 obsidian profile 的 node_modules（新装配链路） |
| **B. Obsidian 侧视图 + loopback 反馈** | Obsidian 插件加 ItemView（原生面板）+ LinkServer 加 `/feedback` | **零客户端构建**、复用现有构建链（main.template.js → main.js）；反馈链接天然活在聊天回复里；记忆浏览落在 Obsidian（用户看笔记的地方） | 面板与聊天不在同一窗口内（可并排：右侧栏聊天 + 主区记忆视图） |
| **C. 混合（推荐）** | 阶段 1 先做 B 的全部 + 徽标；阶段 2 待 dsh-web-ui 出现官方右侧槽位或 aionui 列模式沉淀后，再做 A 的客户端列 | 先拿到最大收益（纠错闭环），保留最优体验的升级路径 | 阶段 2 依赖上游生态 |

**推荐 C**。理由：反馈链接 + 验证徽标是 v2 闭环的**必选件**，且几乎零成本（LinkServer 已存在、已注入到每条回复）；记忆视图放 Obsidian 侧与本插件的“笔记助手”定位一致；dsh 客户端列当前无官方槽位，自挂 DOM 的维护成本不应由本仓库在 v2 早期承担。

## 4. 分阶段落地计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1a | `/feedback` 端点（confirm/wrong/stale/forget 确定性改写）+ 代理侧徽标与反馈链接渲染规则 | ✅ 已实现 |
| 1b | Obsidian ItemView「记忆面板」：五层浏览 + hook 统计（uses/成功率/验证徽标）+ 搜索 + 逐卡 ✅/❌/过期/归档按钮 + 体检报告展示 + 一键归档旧事件 | ✅ 已实现（`main.template.js` MemoryView + `styles.css`） |
| 1c | 捕获策略分级（auto/ask/off × 偏好/事实/想法） | ⬜ 下一步 |
| 2 | dsh 客户端记忆列（官方槽位出现后） | ⬜ 待上游 |

## 5. 与现有机制的衔接

- 反馈 = 体检信号源：`wrong` 降 success_rate → 次日体检进入 weak 清单 → 模型按 AGENTS.md 改写或建议归档；
- `confirm` = 验证等级升级的唯一确定性通道（模型无权自升）；
- `forget` 走归档目录，与“agent 无删除工具、档案永不硬删”的既有原则一致；
- 反馈写入由插件执行，不经模型、不产生工具调用，用户点击即生效。