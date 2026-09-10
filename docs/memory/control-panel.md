# 记忆控制面：交互规格与注入方案评估（v2 之 ③）

> 目标：让用户对记忆**可见、可溯源、可纠正**。本文档先定义交互规格，再评估三种注入方案并给出分阶段落地计划。
> 状态：**规格定稿；阶段 1a（反馈链接 + 验证徽标）、1b（Obsidian 记忆面板 ItemView）与 1c（捕获策略分级）均已实现**；阶段 2（dsh 客户端列）规划中（依赖上游官方右侧槽位，见 §3 方案 C）。

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

依据了记忆卡的回复末尾，代理**为每张实际用到的卡各渲染一行**并写明是哪张卡（当 `DSH_MATH_MEMORY_LINK_URL` 可用时，旧名 `DSH_OBSIDIAN_LINK_URL` 兼容）：

`依据的记忆：<卡标题> — [✅ 这条对](http://127.0.0.1:<port>/feedback?path=<卡路径>&action=confirm&t=<token>) [❌ 这张卡有错](http://127.0.0.1:<port>/feedback?path=<卡路径>&action=wrong&t=<token>)`

> `t=` 为 CSRF 校验参数（`DSH_MATH_MEMORY_FEEDBACK_TOKEN`，旧名 `DSH_OBSIDIAN_FEEDBACK_TOKEN` 兼容，由系统提示注入进链接模板）；省略会被端点拒绝（403）。`/open` 链接同样带 `t=`。

点击后由 Obsidian 插件的 loopback LinkServer 直接、确定性地改写该卡 frontmatter（不经模型、不经 dsh 沙箱）：

| action | 确定性效果 |
|---|---|
| `confirm` | `hook.verified → user-confirmed`；`success_rate → max(现有, 0.9)`；并清除 `needs_review`（一个 ✅ 确认消解先前的 ❌） |
| `wrong` | `verified` 降一级（user-confirmed→cross-referenced→single-source，缺失则写 `single-source`）+ 写 `needs_review: true` 与 `last_wrong`；**仅当卡上已有 `success_rate` 时**才改它（`min(现有 × 0.5, 0.35)`，一次 ❌ 必落 weak 区） |
| `stale` | 顶层 `status → superseded`（不删除，保留证据） |
| `forget` | 文件移入 `.deepseek/archive/records/`（从不硬删除） |

卡上没有 `hook:` 块时，`confirm`/`wrong` 会先补一个空 `hook:` 块再写字段（行内 flow 写法明确拒绝，不盲改）——**证据最弱的卡也必须能纠错**。

**两个反馈通道的分工（2026-09-10 定稿）**：

- **评估**（「这张卡的内容对不对」）＝ `confirm` / `wrong`，出现在回复行与面板按钮上（面板文案 `✅ 确认` / `❌ 有错`）。
- **生命周期**（「这张卡还要不要留在库里」）＝ `stale`（过期，退出检索、文件保留）/ `forget`（归档，文件移动到 archive）。**`归档` 不是第三个评价**，因此不在回复的评估行里出现，只作为面板动作并要求二次确认、用危险样式区分。
- **已退出 UI**：`inapplicable`（🔁 不适用）。它只写顶层 `last_not_applicable`，而该字段**全仓库没有任何读取方**、排序影响为零，用户看到的却是"点了没反应"（与 ❌ 的区分因此不可预测）。它要表达的失败模式（记忆正确但不该用）由 `AGENTS.md` §5 的推理期适用性纪律覆盖。宿主**保留**该动作：旧对话里的历史链接仍然可用，删掉会让它们变成 404。

**安全约束**：只接受 vault 相对路径、必须位于 `.deepseek/` 之下、必须解析后仍落在 vault 内；action 白名单；服务只绑 127.0.0.1。

### 2.3 记忆视图（浏览/搜索/编辑）

**呈现原则**：面板回答的是「我记住了什么 / 哪些可信 / 有什么要我处理」，不是把内部 JSON 摊开。因此**默认不显示** vault 相对路径、裸分数（utility / success_rate）、字段名（`hook` / `needs_review`）与模型版体检清单。

- **状态条**（首屏一行）：`画像 ✅ · 记录 N · 模板 N · 主题 N · 定理 N · 策略 N · 备忘录 N · 事件 N · 上次体检 <日期>`。五个卡片层全部可达——此前只收集 records/templates，文档承诺的「五层」里有三层在两个面板都取不到。
- **⚠️ 待处理**（仅非空时置顶）：体检的「待重审 / 建议归档」以卡片标题列出，旁边就是可点的归档按钮。此前建议只出现在原始 wikilink 文本里，而归档按钮在别处、无任何标记。
- **搜索**：标题 / 主题 / 类型 / 算子（大小写不敏感，episode 的人类标题也参与匹配）；命中原因可见，因为这几项本来就显示在卡片行上。
- **卡片行**：`标题 · 类型 · 算子 · #主题 · 验证徽标 · 用过 N 次 · N 天前`；右侧动作 `✅ 确认` / `❌ 有错` / `过期` / `归档`（归档二次确认 + 危险样式）。徽标含义用一行图例说明：`✅ 已确认 · ⚖️ 与他处互证 · ❓ 单次来源`。
- **事件时间线**：`日期 · 人类标题 · 主题`（解析 `memory/episodes/index.md`），默认折叠 8 条 + 「展开全部」。此前打的是**捕获写盘时间**——同一次捕获的多条 episode 时间戳相同，等于没有时间轴。
- **记忆体检**：渲染结构化字段生成的中文摘要（`audit.human`），模型版清单收进「查看模型版清单」折叠；摘要与实时计数不再互相矛盾。
- 点击打开预览弹窗（阶段 1b 起，dot 目录限制），**弹窗内可直接编辑保存（mtime 冲突防护）**；删除仅指"归档/标记 superseded"，无硬删除按钮。
- **可溯源（source 链与引用次数）仍未交付**——原规格要求每条记忆显示 `source` 证据链与引用次数，`collectMemoryState` 至今不解析 `source`。这是本节唯一未兑现项。

### 2.4 捕获策略分级（✅ 已实现，阶段 1c；2026-09-10 扩到四个档位）

**一个档位对应一组记忆层**，写在 vault 根 `.deepseek/capture-policy.md` 的 frontmatter（用户维护，模型不得修改）：

| 档位 | 管哪些层 | 默认 |
|---|---|---|
| `idea` | `inbox/` 想法备忘录 | `ask` |
| `fact` | `memory/records/` 的 fact / event / instruction / artifact | `ask` |
| `preference` | `memory/profile.md`、`memory/notation.md` | `ask` |
| `structure` | `memory/topics/`、`memory/theorems/index.md`、`memory/templates/`、`strategy/` 的索引与结构写入 | `auto` |

| 取值 | 含义 |
|---|---|
| `auto` | 按 AGENTS.md 三写协议直接写入 |
| `ask` | 先用 ask_user 征得同意，再写入 |
| `off` | 不主动捕获（用户明确要求时除外） |

**为什么加 `structure`**：策略最初只有 idea/fact/preference 三个"内容类别"，而协议把它们的效力描述成「三写第 2/3 步先问」——于是话题/定理/模板/策略这些**在协议之后才长出来的层**，其归属只能靠读者从"第几步"推断，`strategy/` 甚至不在三写清单里。现在每个层都能指到一个档位。`structure` 默认为 `auto`（= 字段存在之前的事实行为）：它管的是**给已经存在的内容补索引与结构行**，每次都问会明显打断对话；想连它也问就把策略文件里那一行改成 `ask`。

两点边界（写进 AGENTS.md 与模板，避免再靠推断）：

- **事件层 `memory/episodes/` 不受本表管辖**：整场对话原文由确定性捕获写入，开关是 `.deepseek/config.md` 的 `sessionCapture`；它的定位是原始证据，不是"模型决定要不要记"的内容。
- **记号体系的「收集」是豁免的**：新用法出现即记、不打扰；只有「统一」（改用户已采纳的记号体系）才走 `preference` 档位。这条是 §2 记号体系一节的原设计，不是遗漏。

**向后兼容**：策略文件里没有 `structure:` 行时，行为等同 `auto`（升级不会让用户被多问）。

策略随系统提示注入（含上面这张"哪个档位管哪些层"的表），两个记忆面板的「捕获策略」一行都可直接点选轮换档位。

### 2.5 归档与体检的口径（2026-09-10 明确）

- **归档按层存放**：`.deepseek/archive/<layer>/`，`<layer>` 取自卡自己的位置（`.deepseek/memory/<layer>/x.md` 与 `.deepseek/<layer>/x.md` 都取其 `<layer>`；`records` 仍是 `archive/records/`，已有归档不受影响），并回写**该层自己的索引**。此前目的地与索引都写死 `records`——归档策略卡会误filed 且在 `strategy/index.md` 留下悬空链接。
- **体检只扫 `records` / `templates` / `strategy` 三层**（`AUDIT_CARD_DIRS`）：这三层有 `hook` 统计与生命周期，才谈得上 weak/unused/低效用归档。`topics/` 与 `theorems/` 是**导航与索引卡**，不参与"低效用→建议归档"，因此 **`counts.cards` 与面板状态条的分层计数口径不同**——面板显示 `记录 2 · 主题 2 · 策略 1`，体检说"3 张卡"，两者都对，只是范围不同。`structural` 的「缺 source / 未入索引」同样只对 records 生效（`source` 证据链是记录层的纪律）。
- **事件层不参与任何卡级维护**：`memory/episodes/` 只有"归档 >90 天"这一条确定性操作（`archiveOldEpisodes`），开关与实现都在插件侧。

### 2.6 侧栏性能：为什么面板要动 dsh 的响应字节（2026-09-10）

「Obsidian 里 dsh 界面卡顿（展开侧栏时最明显）」的第一轮结论（跨帧毛玻璃）**被实测否掉**：把皮肤 CSS 全部移除后帧数据毫无变化。真正的来源是**皮肤 `orca-link` 的客户端脚本 `hooks.mjs`**——约 14 个 subtree MutationObserver、一个约 5 次/秒改状态角色内联样式的循环、一个跟着侧栏动画每帧触发的 ResizeObserver（读布局 → 写 body 级 CSS 变量 → 翻 `body[data-orca-sidebar-wide]`）。同一个皮肤在 3080 也跑，所以两边一起卡。停用该脚本：6 次点击里「>50ms 的帧」从 3 → 0、最差帧 84 → 33ms、LoAF 8 → 0。

- 插件设置有两档：
  - **「侧栏性能模式」（默认开）**：代理注入样式表（去毛玻璃/无限装饰动画）+ **改写 `hooks.mjs` 的两处热循环**（ResizeObserver 防抖 180ms、角色循环下限 1s）。锚点全中才改，皮肤更新后自动降级为原样返回。
  - **「侧栏加载皮肤动态装饰」（默认开）**：关掉后把 `hooks.mjs` 换成空实现（保持导出契约）——实测最流畅（帧 >50ms 归零、Task −18%），代价是 hero 场景 / 状态角色 / 信号芯片消失。
- 影响面：只改**导航 HTML** 与**皮肤 hooks 模块**两类响应，且都要求未压缩；其余请求与压缩响应一律字节透传。两个开关都即时生效（面板自动重载，不需重启服务）。
- 完整原因清单（11 条，含已排除项与未量到的项）、对照实验数据与自查用 DevTools 片段：**`docs/memory/sidebar-performance.md`**。

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
| 1c | 捕获策略分级（auto/ask/off × 想法/事实/偏好） | ✅ 已实现（`.deepseek/capture-policy.md` + 系统提示注入 + 面板摘要） |
| 1d | **呈现层重做**（2026-09-10）：状态条 + ⚠️ 待处理 + 五层合并卡片列表 + episode 人类标题/折叠 + 结构化体检摘要；`归档` 从评估行移出并二次确认；`🔁 不适用` 退出 UI | ✅ 已实现（两个面板同批改，同一份 `collectMemoryState` 数据层） |
| 2 | dsh 客户端记忆列（官方槽位出现后） | ⬜ 待上游（**已交付的是 `settings.section` 设置页形态的记忆面板**，不是本节描述的右侧列） |

## 5. 与现有机制的衔接

- 反馈 = 体检信号源：`wrong` 降 verified（并在卡上已有 `success_rate` 时把它压到 weak 区）+ 写 `needs_review` → 次日体检进入 weak 清单与「待重审」清单 → 模型按 AGENTS.md 读 source 证据链重判或改写；
- `confirm` = 验证等级升级的唯一确定性通道（模型无权自升）；
- `forget` 走归档目录，与“agent 无删除工具、档案永不硬删”的既有原则一致；
- 反馈写入由插件执行，不经模型、不产生工具调用，用户点击即生效；
- **回执是闭环的一部分**：每次点击都必须给出「对哪张卡做了什么」的中文回执（Obsidian 用 `Notice`，web 面板显示宿主返回的 `message`）。此前 web 面板的 `run()` 丢弃响应体，点 ✅/❌/归档 界面上什么都不发生——这是「三选项令人不明所以」的直接原因之一。