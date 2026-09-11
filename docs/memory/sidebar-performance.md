# 侧栏卡顿排查与修复（Obsidian 内的 dsh 面板）

> 触发：用户报告「Obsidian 里的 dsh 界面很卡顿，展开侧边栏时尤其明显，其他按钮也类似地卡」；第一轮修复后**仍然卡**，且**主 dsh web（3080）也卡**。
> **⚠️ 术语（2026-09-11 补充，先读 §0.1）**：本文的「侧栏」有两个所指——**dsh 侧栏**（dsh web 自己的导航列，跑在浏览器页里）与 **Obsidian 侧栏面板**（Obsidian 右侧承载 iframe 的面板）。**已测的数字全部是前者**；后者的交互成本**从未测量**，见 §0.1 与 §9 第 5 项。
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
| 9 | dsh 应用自身的侧栏切换成本 | 停用皮肤脚本后仍是 ~110 ms 样式重算/次点击（dsh 前端自身开销，见 §7 表）。**2026-09-11 在真实 Obsidian 里复测**：410 次重算共 **22.76 s**（平均 **55 ms/次**），落点精确对齐每次开合 ⇒ 这是**主要成本** | 上游问题，插件无法修（插件侧只能减少文档规模/重算次数） | **已定位（§0.2）** |
| 10 | 同机 `dsh web`（3080）进程 CPU | 空闲 ~14%（主 JS 线程 7%）；长对话时出现秒级 300%+ 突发（会话日志 zstd 写入 + 大工具输出序列化，与本次会话 8MB 日志相关） | 与本插件无关；仍卡可单独排查 | 待观察 |
| 11 | iframe 内 dsh UI 的 DOM 规模（长会话历史） | **2026-09-11 实测：13 102 个元素**（同一时刻宿主 Obsidian 只有 756 个），iframe 1206×740 @ dpr 1.25 ⇒ 合成约 1506×925 设备像素。**重算成本随文档规模增长**（见 §0.2） | 减少渲染树/动画范围（上游），插件侧无法直接改 | **已量化** |

### 0.1 两个「侧栏」必须先分清（2026-09-11 补充）

本文此前两种「侧栏」混用，读者无法判断每条证据属于哪一侧。定义如下，后面凡出现都用这两个词：

| 词 | 指什么 | 谁在渲染 |
|---|---|---|
| **dsh 侧栏** | dsh web 界面**自己**的侧栏（会话/导航那一列，宽度是 CSS grid 轨道） | dsh 前端，跑在浏览器页里 |
| **Obsidian 侧栏面板** | Obsidian 右侧栏里**承载 iframe** 的那个面板（以及它的展开/收起/改宽） | Obsidian（Electron 宿主）+ 我们的插件包装层 |

**证据归属（重要）**：

- **原因 1/2/5/6/9/10/11 测的都是「dsh 侧栏」**——探针用 headless Chromium + CDP 驱动**真实的 dsh web**（§4 第 1-3 步），真实鼠标事件点的是 **dsh 自己**的「收起/展开侧边栏」按钮。它是**独立浏览器页**，与 Obsidian 无关（`--via-proxy` 时经插件反代，但仍然是浏览器页）。
- **原因 3/4 是「Obsidian 侧栏面板」侧**（iframe 与宿主隔离、收起时挂起 iframe）——**这两条没有 CDP 测量**，是按宿主行为推理后处置的。
- **原因 8 排除了宿主空闲 CPU**（4 秒采样 `Obsidian.exe` 增量为 0），但它**不等于**「Obsidian 在面板开合时的渲染成本已被测过」。
- ⇒ **Obsidian 侧栏面板的交互成本**在 2026-09-11 之前**从未被测量**（探针跑在独立 Chromium 里，看不到也点不到 Obsidian 的 Electron 界面）。**该空白已于 2026-09-11 补上**：见 §0.2——结论是**宿主侧几乎不花钱，卡顿全部落在 dsh 面板那一侧**。

### 0.2 附着到真实 Obsidian 的两侧并发测量（2026-09-11）

**方法**：给 Obsidian 开 `--remote-debugging-port`（它也是 Electron），用 `scripts/qa/sidebar-attach-probe.mjs`（**按需运行**）**同时**驱动两个 target——宿主 `app://obsidian.md` 与 iframe `http://127.0.0.1:3180/`——各记录同一段 90 秒墙钟。真实鼠标事件由**用户手动点击**（探针只做只读观察），两侧的 observer 给每次开合打时间戳。

**条件**：Obsidian 1.13.7 / Electron 32.2.5（Chrome 128）；皮肤启用、性能模式按默认（经代理 3180）；iframe 888×740；两侧 `visibilityEnd=visible`（窗口全程可见，数据有效）；两侧起点偏差 26 ms。

| 指标（同一 90 秒） | 宿主 Obsidian | iframe（dsh 面板） | 比值 |
|---|---|---|---|
| 帧数 / >33ms / >50ms | 5401 / **0** / **0** | 3878 / **63** / **37** | — |
| 最差帧 | **18 ms** | **2183 ms** | 121× |
| LoAF 条数（最差） | **0** | **37**（2205 ms） | — |
| `TaskDuration` | 2.11 s（2.3% 墙钟） | **35.54 s（39%）** | 17× |
| `ScriptDuration` | 0.28 s | 2.04 s | 7× |
| `LayoutDuration`（次数） | 0.001 s（4） | 2.31 s（125） | — |
| `RecalcStyleDuration`（次数） | 0.067 s（96） | **22.76 s（410）** | **340×** |

**用户的三次开合**（iframe 的 `body[data-orca-sidebar-wide]` 属性翻转，+秒为窗口内相对时间）：
`+3.6→+12.7`、`+18.5→+26.2`、`+29.6→+37.3`。掉帧秒**逐个落在这三段里**（0–5 / 7–13 / 15–27 / 29–39）；**最后一次开合结束后（+40→+90 s）回到 60 fps、最差 17 ms、零 LoAF**。

**结论**：
1. **卡顿 100% 在 dsh 侧**。同一段墙钟内，你点的是 dsh 侧栏，宿主 Obsidian **0 掉帧、最差 18 ms、LoAF 0**。此前"宿主也贵"只是没测过，而不是测出来贵。
2. **主成本是重排/重算**：410 次 `RecalcStyle` 花了 22.76 s（55 ms/次），`LayoutDuration` 2.31 s，而 JS 只占 2.04 s——不是"脚本在空转"，是**布局**。这与 §7 的「侧栏宽度是 CSS grid 轨道，切换整树重排」一致，只是真实文档（**13 102 节点**）比空会话重得多。
3. **因果清楚**：开合停止 → 掉帧立即消失。所以"皮肤脚本持续改 DOM"（原因 1）在**这条路径**上不是主因；本机性能模式默认开启也会削掉它的一部分。**要分离皮肤脚本的贡献需要一次 A/B**（关掉插件设置里的「侧栏加载皮肤动态装饰」再跑一次同一测量）——这是下一步，见 §9。

**两次测量设计错误（都已修，也写进工具注释）**：
- 第一版**串行**采样（宿主 0–60 s，之后 iframe 60–150 s）⇒ 宿主的窗口里**没有用户的点击**，"两侧对比"不成立。现在两侧并发 + 各自返回 `epochAtStart`，按绝对时间取共同窗口。
- 被遮挡/最小化的窗口 **rAF 根本不触发**（`frames=0`）——那是"没在画"，不是"零掉帧"。探针现在**先等 `visible`** 再记录，并报告 `visibilityEnd`。
- 另一处读数陷阱：宿主的 ResizeObserver **在 observe 时必然回调一次**（实测 `panel=888x740 @t≈0`），那不是用户操作；本次它没有出现第二次回调，**不能据此断定用户没点宿主侧**（也可能收起时 leaf 被直接卸载，元素消失后不再回调）。

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
- **`Obsidian 侧栏面板` 这一侧的交互成本** —— ✅ **已量到，**用现成脚本（2026-09-11 起）：
  ```powershell
  # 1) 彻底退出 Obsidian，再（它也是 Electron，单实例：已开着的话开关会被忽略）
  & 'E:\software\Obsidian\Obsidian.exe' --remote-debugging-port=9222
  # 2) 确认端口在听：浏览器打开 http://127.0.0.1:9222/json/version
  # 3) 保持 Obsidian 前台可见，然后：
  node scripts/qa/sidebar-attach-probe.mjs --seconds=90
  ```
  该脚本（`scripts/qa/sidebar-attach-probe.mjs`，**按需运行**）**同时**驱动宿主 `app://obsidian.md` 与 iframe `127.0.0.1:3180` 两个 target，各记同一段墙钟；你在这期间**手动**点 dsh 侧栏的开合（它只做**只读**观察，不派发输入），它会把每次开合的时间戳与掉帧秒对齐。结论见 §0.2。
  **三条测量纪律**（都是实测踩出来的，脚本内置了前两条）：① 窗口被遮挡/最小化时 **rAF 不触发**，`frames=0` 不是"流畅"而是"没在画"——脚本先等 `visible`，并报告 `visibilityEnd`；② **两侧必须并发**，串行测出来的"对比"里根本没有同一次点击；③ ResizeObserver **在 observe 时必然回调一次**，那不是用户操作。
- **在你自己机器上复核**（最直接）：打开 dsh 界面（3080 或侧栏）→ F12 Console 粘贴下面这段，然后**在 6 秒内展开/收起侧栏几次**（注意：在 3080 或侧栏 iframe 里点的是 **dsh 侧栏**；要复核 **Obsidian 侧栏面板**，得按上一条用 Obsidian 的远程调试端口）：

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
5. ✅ **`Obsidian 侧栏面板` 这一侧已于 2026-09-11 测量**（§0.2，`scripts/qa/sidebar-attach-probe.mjs`）：同一段 90 秒墙钟里，**宿主 0 掉帧、最差 18 ms、LoAF 0、`RecalcStyle` 0.067 s**，而 iframe **63 帧 >33ms、最差 2183 ms、`RecalcStyle` 22.76 s（410 次）**。⇒ 卡顿在 dsh 侧，宿主侧不花钱；原因 3/4（iframe 隔离、收起挂起）属于廉价的保险，不是主因。
6. **下一步（唯一的剩余 A/B，需要用户）**：**分离皮肤脚本的贡献**。本次测量在性能模式默认开启下进行，无法把"皮肤脚本持续改 DOM"（原因 1）与"dsh 前端的 grid 轨道重排"分开。做法：在插件设置里关掉**「侧栏加载皮肤动态装饰」**，用同一条命令再跑一次 §0.2 的测量，对比 iframe 的 `RecalcStyle`/最差帧。若差别不大 ⇒ 主因确为上游布局成本（应推动上游减少渲染树/动画范围）；若显著变小 ⇒ 皮肤脚本在真实文档上仍是放大器。
