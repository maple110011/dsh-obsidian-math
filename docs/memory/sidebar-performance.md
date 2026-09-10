# 侧栏卡顿排查与修复（Obsidian 内的 dsh 面板）

> 触发：用户报告「Obsidian 里的 dsh 界面很卡顿，展开侧边栏时尤其明显，其他按钮也类似地卡」；第一轮修复后**仍然卡**，且**主 dsh web（3080）也卡**。
> 本文件是**原因清单 + 逐条证据 + 每条对应的处置**。结论先写：**卡顿的主因是皮肤 `orca-link` 的客户端脚本 `hooks.mjs` 在持续改 DOM**——不是它的 CSS 特效，也不是我们的插件代码。第一轮按「CSS 特效」修，方向错了：把皮肤的全部 CSS 停掉后卡顿数据**一点没变**；停掉它的 JS 后长帧全部消失。第二轮据此改成「减速 / 停用皮肤脚本」。

## 0. 结论速览（按证据强度排序）

| # | 原因 | 证据（CDP 实测，6 次真实点击） | 处置 | 状态 |
|---|---|---|---|---|
| 1 | **皮肤客户端脚本 `hooks.mjs` 持续改 DOM**：约 14 个 subtree MutationObserver、约 5 次/秒改状态角色内联样式的循环、跟着侧栏动画每帧触发的 ResizeObserver（写 body 级 CSS 变量 + 翻 `body[data-orca-sidebar-wide]`） | 脚本在跑：**3 帧 >50ms，最差 84ms**，LoAF 8 条；停用脚本：**0 帧 >50ms，最差 33ms**，LoAF 0 | 代理改写该模块：① 两处热循环减速（性能模式）② 可选：整个模块换成空实现 | **已修**（两档） |
| 2 | 皮肤 CSS 特效（毛玻璃 / 无限动画 / 装饰模糊） | 皮肤 CSS 全部移除：3→4 帧 >50ms、最差 84→83ms、RecalcStyle 1172→1165ms —— **没有变化** | 仍然去掉（无害，但**不是**卡顿原因） | 已修（非主因） |
| 3 | iframe 未与宿主隔离、未被提升为合成层 | `styles.css` 原本只有 `flex/width/border/background` | `contain: layout paint style` + `transform: translateZ(0)` | 已修 |
| 4 | 侧栏收起 / 切标签页时 iframe 仍在渲染 | 视图原先不感知可见性 | `display:none` 挂起 + 每秒自检 | 已修 |
| 5 | **渲染线程上的同步文件写入**：`writeDebugLog` 用 `appendFileSync`，由 `render()` 调用 | 启动日志 7 ms 内 3 条 `[render]`，即 3 次阻塞写 | 队列 + 250 ms 异步批量追加，卸载时 flush | 已修 |
| 6 | 记忆面板搜索框**每次按键**重扫整个 vault | 代码：`input` → `render()` | 220 ms 防抖 + `renderNow()` | 已修 |
| 7 | 插件内的轮询/事件循环 | 全文件检索：**无** `setInterval`、无 `MutationObserver`、无 workspace 事件循环；iframe 只创建一次 | 无需处置 | 已排除 |
| 8 | 宿主侧空闲 CPU 占用 | 4 秒采样：全部 `Obsidian.exe` 进程 CPU 增量 0 | 无需处置 | 已排除 |
| 9 | dsh 应用自身的侧栏切换成本 | 停用皮肤脚本后仍是 ~110 ms 样式重算/次点击（dsh 前端自身开销，见 §7 表） | 上游问题，插件无法修 | **已定位** |
| 10 | 同机 `dsh web`（3080）进程 CPU | 空闲 ~14%（主 JS 线程 7%）；长对话时出现秒级 300%+ 突发（会话日志 zstd 写入 + 大工具输出序列化，与本次会话 8MB 日志相关） | 与本插件无关；仍卡可单独排查 | 待观察 |
| 11 | iframe 内 dsh UI 的 DOM 规模（长会话历史） | 未直接取到；但 §7 显示切换成本与渲染树规模正相关 | 按 §6 的办法量 | **未知** |

## 1. 为什么不是「我们的 JS」

三条独立证据把「插件代码在空转」排除掉：

1. **没有轮询**：`obsidian/main.template.js` 里没有 `setInterval`、没有 `MutationObserver`、没有 workspace 事件循环；唯一的周期行为是记忆面板徽标的**一次性** `setTimeout`。
2. **iframe 只创建一次**：`render()` 只在 `src` 真正变化时 `setAttribute('src', …)`；日志显示启动后只有 1 次 `[iframe] load`。
3. **空闲时宿主 CPU 为 0**：对全部 `Obsidian.exe` 进程做 4 秒 CPU 增量采样，全部为 0 s。卡顿**只在交互/动画期间**发生。

## 2. 第一轮的错误结论（保留，作为教训）

第一轮只看了**静态资源**：皮肤 `patches.css` 里有 4 处 `backdrop-filter`（其中一处 `:before { inset: 0 }` 覆盖整个侧栏区域）、14 处 `blur(`、7 处 `infinite` 动画，于是推断「跨帧毛玻璃让宿主动画每帧重算模糊」。**这个推断从未被测量验证**，实测直接否掉了它（§0 第 2 行）。教训写进 `handoff.md` 坑 54：**「看起来很贵」不等于「测得出来贵」——先做 A/B，再改代码**。

## 3. 其它被同时处置的原因

### 3.1 隔离与合成层（原因 3）

```css
.dsh-math-assistant-iframe {
  contain: layout paint style;   /* 宿主布局树在框架处截断 */
  transform: translateZ(0);      /* 自己一层，宿主重绘不再重栅格化整块 */
}
```

### 3.2 皮肤 CSS 特效（原因 2）——保留但降级为「顺手」

注入的样式表（在 `</head>` 之前）：

- `backdrop-filter: none`（保留背景色）、皮肤装饰类 `animation: none`、其余无限动画最多跑一轮，**功能性**动画（spinner / 光标 / 进度）刻意保留——冻住它们会让人以为界面卡死；
- `[class*="orca-"] { filter: none }` —— 皮肤装饰层的大面积 `blur()`。
- 实测这些**不是**卡顿原因（§0 第 2 行），但仍然去掉：代价为零，且少一层跨帧模糊总归更省。

### 3.3 隐藏即停（原因 4）

`DshMathView.syncSuspension()` 在 `layout-change` / `active-leaf-change` / `resize` / `onResize` 时判定可见性；判定为不可见（祖先 `display:none`、容器矩形为 0、Obsidian `isShown()===false`）就给 iframe 加 `display:none` 并打上 `data-dsh-suspended="true"`。两个安全设计：

- **只认无歧义信号**，不确定就当可见（误判为隐藏会让面板空白）；
- 挂起期间**每秒自检**一次（只在挂起时运行），所以漏掉事件也不会永久黑屏。
- 顺带收益：`display:none` 会让皮肤角色循环收到 `visibilitychange` 并自行暂停。

### 3.4 渲染线程上的同步 IO 与按键重扫（原因 5、6）

- `writeDebugLog`：`appendFileSync` → 队列 + 250 ms 异步批量 `appendFile`；`onunload` 时同步 flush 一次，日志不丢顺序。
- 记忆面板搜索：输入 220 ms 防抖；「刷新」「归档」「立即保存对话」走 `renderNow()`（先取消防抖再渲染）。

## 4. 第二轮：怎么测出真因的

用 CDP 驱动**真实的 dsh web**（headless Chromium，同一台机器，真实皮肤与真实前端）：

1. 起一个真实 dsh 实例（`--profile notes-assistant --port 0`），从 stdout 抓 token URL；
2. Chromium 以 `--headless=new --remote-debugging-port` 启动，Node 用内置 `WebSocket` 直连 CDP；
3. 打开界面后**用真实鼠标事件**（`Input.dispatchMouseEvent`）点「收起/展开侧边栏」按钮，每次点击后重新定位按钮（收起后按钮会移位）；
4. 采集：rAF 帧间隔、`long-animation-frame`（LoAF）、`Performance.getMetrics` 的 `TaskDuration` / `ScriptDuration` / `LayoutDuration` / `RecalcStyleDuration` / `RecalcStyleCount`，以及 V8 采样 profile。

关键对照实验（每次 6 次真实点击）：

| 配置 | 帧 >33ms | 帧 >50ms | 最差帧 | Task | RecalcStyle | LoAF |
|---|---|---|---|---|---|---|
| 皮肤 JS + CSS 都在（用户现状） | 15 | **3** | **84 ms** | 2320 ms | 1172 ms（960 ops） | **8** |
| 皮肤 **CSS 全部移除**（JS 仍在） | 15 | 4 | 83 ms | 2382 ms | 1165 ms | 8 |
| 皮肤 **JS 停用**（CSS 仍在） | **2** | **0** | **33 ms** | 1493 ms | 743 ms（663 ops） | **0** |
| 皮肤 JS 停用 + CSS 移除 | 2 | 0 | 33 ms | 1449 ms | 661 ms | 1 |

结论一目了然：**CSS 那一行没有变化，JS 那一行全面改善**。皮肤脚本空转时，页面每 4 秒还会产生 20 次 `style` 属性改写（全部落在 `DIV.orca-ch-statusCharacterSprite` 上），伴随约 70 次/秒的样式重算——用户什么都不做时主线程已有约 18% 被占着，任何动画都会在这些毛刺里掉帧。

## 5. 处置：两档（都在代理里做，不改皮肤文件）

皮肤脚本跑在 iframe 里，Obsidian 的 CSS/JS 都碰不到它；唯一能看到字节的是插件的回环反代 `DshWebProxy`。因此：

- **侧栏性能模式（默认开）**：除原有样式表外，现在还会**改写 `hooks.mjs`**——把两处热循环减速：
  1. `syncSidebarWidth` 的 `ResizeObserver` 回调改成 180 ms 尾边沿防抖（原来侧栏动画每帧都触发，每次都要读布局 + 写 body 级 CSS 变量 + 翻 `body[data-orca-sidebar-wide]`）；
  2. 状态角色循环的下限提到 1000 ms（原来约 5 次/秒改内联样式）。
  锚点用宽松正则匹配，**两处都匹配上才改**；皮肤更新导致锚点变化时**原样返回**并写一行日志（过期补丁绝不弄坏皮肤）。
- **侧栏加载皮肤动态装饰（默认开，可关）**：关掉后代理把 `hooks.mjs` 换成一份**空实现**（`export default function defineSkinHooks() { return { apply() {} } }`，保持导出契约），于是侧栏不再有 hero 场景 / 状态角色 / 信号芯片，也**不再有任何脚本空转**。这是实测最流畅的一档。

经**已发布的代理**端到端复测（同样 6 次真实点击）：

| 配置 | 帧 >33ms | 帧 >50ms | 最差帧 | Task | RecalcStyle | LoAF |
|---|---|---|---|---|---|---|
| 性能模式关（皮肤原样） | 9 | 2 | 67 ms | 1986 ms | 976 ms（998 ops） | 5 |
| 性能模式开（装饰保留） | 4 | **0** | 34 ms | 1966 ms | 1076 ms（785 ops） | 1 |
| 性能模式开 + 装饰关闭 | **3** | **0** | **33 ms** | **1625 ms** | **874 ms（660 ops）** | **0** |

> 测量噪声提示：同一配置在不同轮次间会有波动（基线曾测到最差帧 344 ms）。判断改动只看**同一轮 harness 内的相对比较**，不要跨轮比绝对值。

## 6. 还没量到的与怎么量

- **同机 3080 的 `dsh web`**：空闲 ~14%（主 JS 线程 7%），长对话期间突发到 300%+；它不是本插件拉起的实例（插件用 `--profile notes-assistant --port 0`）。排查：临时退出 3080，观察动画是否变顺。
- **3080 的皮肤脚本**：同一个皮肤在 3080 也跑同样的 `hooks.mjs`（我们的代理只覆盖 Obsidian 侧栏）。若想让 3080 也流畅：① 换皮肤；② 关掉皮肤；③ 按同样方式给皮肤文件打这两处减速补丁（会备份、可回滚，但皮肤更新会覆盖）。
- **iframe 内 DOM 规模**：Electron 未开 CDP 时读不到跨源文档节点数。要量：`Ctrl+Shift+I` → Console 切到 `http://127.0.0.1:3180` frame → `document.querySelectorAll('*').length`。
- **在你自己机器上复核**（最直接）：打开 dsh 界面（3080 或侧栏）→ F12 Console 粘贴下面这段，然后**在 6 秒内展开/收起侧栏几次**：

```js
(() => { const f = []; let last = performance.now();
  const loop = (t) => { f.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const loaf = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push({ d: Math.round(e.duration), s: (e.scripts||[]).slice(0,2).map(x => (x.sourceURL||'?').split('/').pop() + ':' + x.sourceFunctionName) }); }).observe({ type: 'long-animation-frame' }); } catch {}
  setTimeout(() => console.log('frames', f.length, '>33ms', f.filter(x => x > 33).length, '>50ms', f.filter(x => x > 50).length, 'worst', Math.max(...f).toFixed(0) + 'ms', 'loaf', loaf), 6000); })()
```

## 7. 影响面与回退

- 改写只发生在两类响应上：**导航 HTML**（`accept: text/html`）与**皮肤的 hooks 模块**（`/api/skin-center/**/hooks.mjs`），且都要求响应**未压缩**：代理会为这两类请求去掉 `accept-encoding`（回环带宽免费），其余请求一律原样转发、不缓冲、不重写。
- 文档没有 `</head>`、hooks 锚点不匹配、或响应超过 2 MB：原样透传并记一条日志（降级而不失败）。
- 上游用 gzip 时（`content-encoding` 存在）：不注入，字节透传——**绝不往压缩字节里塞东西**。
- 关掉开关 = 立刻回到皮肤原样（切换后面板自动重载，不需要重启 dsh 服务）。

## 8. 回归

- `scripts/test-panel-proxy.mjs`（31 项，其中 11 项侧栏性能回归）：注入位置在 `</head>` 之前、注入内容含去模糊与去无限动画规则、外壳其余字节不变、导航请求要求未压缩、非导航保留 `accept-encoding`、非 HTML 绝不重写、无 `</head>` 原样通过、gzip 文档字节一致、开关关闭后与 dsh 原样相同；hooks 模块：被打上两处补丁且**其余字节与皮肤原样相同**、锚点变化时原样返回、空实现档保持导出契约且 content-type 仍是 script、关闭性能模式时压缩透传不改写。
- 该套件在开发中抓到一个真实缺陷：注入响应同时带着上游的 `transfer-encoding: chunked` 与新的 `content-length`，客户端直接判协议违规（`Content-Length can't be present with Transfer-Encoding`）——即「打开侧栏就白屏」。这是把「声明值 vs 有效值」用在**协议头**上的例子。

## 9. 存档：怎么复现（用户决定「之后再解决」时留下的尺子）

调查过程用的临时 CDP 脚本已固化进仓库，**按需运行、不进 `npm test` / `npm run qa`**（需要本机 Chrome/Edge + 真实 dsh + 一份 vault；`--dsh-home` / `--chrome` 可在别的机器上覆盖）：

```bash
# 皮肤原样（对照）
node scripts/qa/sidebar-perf-probe.mjs --vault="D:\Obsidian笔记数据库" --label=baseline --cycles=3
# 经插件已发布的反代（性能模式默认开）
node scripts/qa/sidebar-perf-probe.mjs --vault="D:\Obsidian笔记数据库" --via-proxy --label=proxy
# 性能模式开 + 关皮肤装饰（最流畅档）
node scripts/qa/sidebar-perf-probe.mjs --vault="D:\Obsidian笔记数据库" --via-proxy --skin-scripts=off
# 谁在空转：4 秒 DOM 改动流
node scripts/qa/sidebar-perf-probe.mjs --vault="D:\Obsidian笔记数据库" --mutations
```

本机最近一次运行（每档 4 次真实点击，同一轮 harness）：

| 档位 | 帧 >33ms | 帧 >50ms | 最差帧 | RecalcStyle | LoAF |
|---|---|---|---|---|---|
| 皮肤原样 | 12 | 1 | 67 ms | 646 ops | 4 |
| 经反代（性能模式开） | **3** | **0** | **33 ms** | 519 ops | **0** |
| `--mutations`（皮肤原样） | — | — | — | 4 秒 12 条改动，**全部**落在 `DIV.orca-ch-statusCharacterSprite` | — |

### 仍未解决（下次从这里接着做）

1. **3080 也在跑同一份皮肤脚本**，我们的代理覆盖不到它。选项：① 换皮肤 / 关皮肤；② 给 `$DSH_HOME/skins/orca-link/hooks.mjs` 打同样两处锚点补丁（先备份；皮肤更新会覆盖）；③ 上报皮肤作者。**等用户决定。**
2. **dsh 前端自身的切换成本**：停用皮肤脚本后每次点击仍有 ~110 ms 样式重算（侧栏宽度是 CSS grid 轨道，切换会整树重排）。插件无法从外部修；若要推动上游，本探针 `--label` 的输出即可作为最小复现证据。
3. **在用户真机上量一次**：§6 末尾的 DevTools 片段（长会话 + 完整插件家族的真实数字）——本机 headless 用的是空会话，可能低估真实卡顿。
4. **iframe 内 DOM 规模**与**长会话的影响**未量化（§6）。
