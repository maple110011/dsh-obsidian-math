# 变更账本：为什么改、怎么改、踩了什么坑

> **范围**：**整个仓库**，不只是记忆子系统（本文原名「记忆系统变更日志」、位于 `docs/memory/`，2026-09-11 提升到 `docs/changelog.md`——因为它的内容早已超出记忆子系统，而目录位置在说"这是记忆那摊事"）。
> **与根 `CHANGELOG.md` 的分工**：根文件是**发布摘要**（每个版本面向用户「改了什么」）；本文是**维护者细账**（为什么这么改、排查过程、实测数字、被否决的方案）。**最新在上。**

## 2026-09-26 · 0.1.7 适配收口：三条激活形态全坏，而"全绿"里含一条 0/0 断言的门禁

**状态**：已实施，三个新门禁 + 两个重写门禁，全部做过变异验证。
**背景**：09-25 那一轮把 preset 迁成"声明 + 把体文件铺进 profile 目录"（见下一节）。本轮做的是
**真机复验**——而它发现：**仓库全绿、发布面却是坏的，而且坏的不止一处**。

**① 三条激活形态，只有一条是好的（实测）。**

| 形态 | 结果 | 根因 |
|---|---|---|
| Obsidian 引导（profile 名 = `notes-assistant`） | ✅ 好的（唯一） | 硬编码的 profile 名恰好等于它自己创建的那个 |
| `dsh plugin --profile web add dsh-math-memory`（`docs/installation.md` 推荐的那条） | ❌ `agent-preset/invalid` | 宿主把体文件铺进 `profiles/notes-assistant/`（常量），声明却活在 `profiles/web/` |
| 任意 profile 的**冷启动第一次** | ❌ 同上；**第二次就好** | registry 在**宿主行还在 import 自己**时就挂载了 preset 的 `plugins` 行 |
| `dsh-math-memory install --direct` | ❌ 同上 | 体文件清单四份，这一份**缺两个文件** |
| npm `latest`（0.7.8，发布件） | ❌ `agent-preset/not-found` | 适配只在工作区，没发版 |

四种失败的**症状完全一样**（`session/create` → `agent-preset/invalid` 或 `not-found`，**启动日志零输出**），
所以只能靠差分实验区分。关键测量：把体文件手工补进 profile 目录 → 立刻 `ok:true`（确立 `--direct` 的因果）；
把 preset 入口行从 `./math-memory.mjs` 改成包内 specifier → **冷启动一次就通**（确立冷启动那条的因果）。

**② 为什么"45/45 全绿"没拦住。** 09-25 的 `$DSH_HOME` 事故把现场清掉之后，
`test: deployed profile accepts a session` 的前置条件永久不成立 ⇒ 打印 SKIP 并 `exit 0`、**0/0 断言**；
而 `run-gates.mjs` 只按退出码统计，把它算成通过。同时 `test-installer.mjs` 断言的是**已退役**的
`.agent-presets/notes-assistant/*` 布局 ⇒ **它守着一个已经没人读的目录**，并给坏的 `--direct` 通道盖章。
"清单与声明对得上"那条断言只比对两个字符串，看不见 `install.mjs` 那份缺项。

**③ 修法：一个组合、两种 name 形态，各配一条通道。**
- **bundle 通道改用包内 specifier**（`dsh-math-memory/dsh/preset/math-memory.mjs`）。包本来就是
  `dsh plugin add` 装进 `profile/node_modules` 的，**不需要任何东西先存在** ⇒ 冷启动无竞态；
  同时它对 profile 名**完全免疫**（那条硬编码路径随之删掉，宿主插件不再铺体文件）。
- **离线通道保留 `./name`**（Obsidian 引导、`install --direct`）：这两条**在 dsh 启动前**就把体文件写进
  profile 目录，相对形态反而更直接。
- 两种形态由**同一次生成**产出（`build-preset-declaration.mjs` 的 `localPrefix` 参数），
  由 `check: preset body lists agree` 分别钉住；**手改生成块会红**。

**④ 体文件清单收敛到一处 + 客户端包的传递闭包。**
- 权威清单 = `preset-deploy.mjs` 的 `PRESET_BODY_FILES`，而判定它是否**完备**的判据是
  `dsh/preset/math-memory.mjs` 的**相对 import 闭包**；`install.mjs` 与 `main.template.js` 的清单
  由同一条门禁比对（这次漂移就发生在这两份里）。
- 记忆面板客户端半个的包，原来把宿主入口拷到包根 + 手挑四个兄弟文件；`host/index.mjs` 在 0.1.7 多了
  一个 `../preset/preset-deploy.mjs` 之后，**包根本 import 不起来**（`ERR_MODULE_NOT_FOUND`），
  而安装器打印的是"包已就位"。现在按 `collectDshImportClosure()` 复制整条闭包、入口落在 `host/index.mjs`，
  门禁**真的 `import()` 一次产物**（两个宿主半分支各一次）。
- 顺带修掉 `presetBodyDeployed()` 里未 import 的 `existsSync`（零调用方 ⇒ 没有任何门禁执行过它，见坑 95）。

**⑤ 门禁自证：三态汇总 + 自带前置条件。**
`run-gates.mjs` 现在区分 `ok` / `SKIP` / `FAIL`，并**列出被跳过的门禁名与原因**（`__SKIP__` 是套件声明的
唯一标记）。`test: deployed profile accepts a session` 被换成
`test: self-provisioned profile accepts a session`：它**离线**装一份 bundle 形态的 profile
（`node_modules` 也是拷的，不用 pnpm、不联网），profile 名**故意不叫** `notes-assistant`，
冷启动一次再建会话 —— 上面三条坏形态一网打尽。变异验证：把 bundle 声明改回相对形态 → 该门禁 8/10 红、
`session/create` 报 `agent-preset/invalid`；把 `install.mjs` 清单去掉体文件 → `check-preset-body-lists` 红；
把闭包截断成只剩入口 → `check-client-package-layout` 红。三条都恢复后全绿。

> **与 09-25 那一节的关系**：那一节的"模块铺进 profile 目录（npm 宿主插件与 Obsidian 引导共用）"
> 只对离线通道继续成立；bundle 通道改成 specifier，理由就是本节的冷启动测量。历史记录不改写。

**⑥ 记录纪律的欠账也还了。**
[`dsh-0.1.7-adaptation.md`](dsh-0.1.7-adaptation.md) 的 A1b 验收③（让 `check-patch-yaml` 断言 patch 行 id
在当前 schema 里存在）**从未实施**，仍列为未做；`build-preset-declaration.mjs` 与
`lib/preset-declaration.mjs` 的注释引用了一个**不存在**的 `check-preset-declaration.mjs`——现在真正的守卫是
生成器自己的 `--check`，并已注册为门禁。

**⑦ 插件管理页的卡片素材（icon / locale）。**
0.1.7 的插件管理页用三样东西画一张卡片：`package.json.icon` 与 `<pkg>/locale/<lang>.json` 的
`meta.title`/`meta.description`。本插件此前**一样都没声明** ⇒ 卡片只有包名、没有图标。
三种错法全是**静默降级**（locale 缺失 → 回退英文；字段类型不对 → 一条 `metadataError`；
图标不合格 → 保留默认图），"文件在不在"式的检查一个都抓不到。落地：`locale/en.json` +
`locale/zh.json` + `icon.svg`，并把它们加进 `package.json` 的 `files`
（发布集由 `check-release-paths.mjs` 钉住，所以那条守卫的 `EXPECTED_FILES` 同批改并写了理由）。
新增门禁 `check: plugin manifest meta (icon/locale)`：跑 **dsh 自己的读取器**
（`dsh-app-boot` 的 `readPluginMeta`）并断言**中英标题不同**（证明 `zh.json` 真的被读了，而不是
回退成英文也算过）。变异验证：移走 `locale/zh.json` → 两条本地化断言红；`icon` 改成绝对路径 →
4 条红，含 dsh 原文 `icon must be a relative file path`。

> **一处刻意不改**：`dsh.engines.dsh` 留着。0.1.7 的兼容门禁只读 `peerDependencies`，
> 所以它确实是**惯例元数据**；但生态里的插件（`@linxin666/*`、`@deepseek-ai/dsh-web-app`）
> 都同时声明两者，而本仓的 `check-version-consistency.mjs` **刻意断言两者都存在且相等**。
> 为了"纯"而删掉一个全生态都在写的字段，换不来任何可判定性的提升，反而会让那条一致性守卫
> 失去一半断言目标。误读风险改由文档承担（`dsh-0.1.7-adaptation.md` §4.4(a) 已写明门禁读的是
> `peerDependencies`）。

**守卫**（2026-09-26 补）：`test-agent-preset.mjs` 从 16 项增到 **19** 项——它此前只"建会话"、
**从不发一轮消息**，所以"请求准备阶段失败"对它完全不可见（这个故障期间它在 50/50 里是**绿的**）。
新增两条**静态**前置断言，覆盖今晚这类里可静态判定的两种形态：
① 已部署 profile 的清单必须声明非空 `name` **和** `version`（缺 version = 每轮请求准备阶段就炸）；
② 已部署 overlay 里每个**相对行**都必须有对应文件（"行在、文件不在"是同一族事故，`session/create`
回 `agent-preset/invalid` 而启动时不打印任何东西）。
**变异验证**（临时 home 造坏形态，不碰真实 profile）：M21 删掉清单的 `version` ⇒ 那条红，
其余仍绿；M22 塞一行指向不存在文件的相对行 ⇒ 那条红。还原后 19/19 绿。
⚠️ 这两条**不能**替代"真发一轮消息"的端到端验证（那要真 API、会花 token）。

## 2026-09-26 · 面板不再把"空体 404"报成 JSON 解析错误

**背景**：3080 那次故障的**可诊断性**问题。客户端半个每个调用点都写 `await res.json()`；而"路由没挂"
时 dsh 回的是 **404 + 空体** ⇒ 面板显示 `加载失败：SyntaxError: Unexpected end of JSON input`
——把注意力引向 JSON 解析器，而真问题是路由不存在（排查时我也是靠直接 curl 那条路由才看见 404）。
响应里的**状态**与**体**是两件事，应当分别报告。

**做法**：新增纯模块 `dsh/client-panel/src/http-json.mjs` 的 `readJson(res, what)`——先读文本，能解析
才解析，然后：

- 非 2xx：报 `HTTP <status>` + 服务端自己的 `error` 文案；**空体**时明说
  「空响应 —— 路由可能没挂上（宿主半个没激活？）」；有体但不是 JSON 就截前 200 字符带上；
- 2xx 但体不是 JSON（空体/HTML）：明说「返回了非 JSON 内容（HTTP 200）—— 这条路径可能被别的处理器
  接管了」。

6 个调用点全部改用它，并各自带**中文语境标签**（记忆状态 / 工作区列表 / 会话捕获状态 / 保存本轮对话 /
归档 / 反馈 / 捕获策略），于是失败信息会说清"是谁失败了"。刻意做成独立模块而不是内联 JSX，是为了让
Node 测试能直接驱动它（面板自己的失败模式也值得被测，而不是靠撞见）。

**守卫与变异**：`check-client-package-layout.mjs` 增 **6 条**——200+JSON 原样返回；**空体 404 必须报
状态并提示路由可能没挂（且不得出现 "JSON input"）**；JSON 错误体透出服务端原文；空 200 与 HTML 200
都判为非 JSON；以及一条**形态**断言：源码里不得再有裸 `res.json()`（`readJson` 调用点 ≥5）。
**变异 M26**：把 `if (!res.ok)` 的判断拿掉 ⇒ 恰两条红（空体 404、JSON 错误体），还原后全绿。
另：客户端 bundle 已重建（`lib/client.js` 22,618 B，`check: client bundle freshness` OK），并重装进
`notes-assistant` 与 `web` 两个 profile（幂等，行未重复插入）。

## 2026-09-26 · 3080 里记忆面板"加载失败：Unexpected end of JSON input"

**症状**：把引擎装进 `web` profile 之后，3080 侧**能**看到「数学笔记助手」模式（bundle 补丁声明的，
不受影响），但记忆面板报 `SyntaxError: Unexpected end of JSON input`。

**取证**：直接探测 `http://127.0.0.1:3080/memory-panel/workspaces` ⇒ **404 且响应体为空**。客户端半个
`res.json()` 解析空体 ⇒ 那句话 ✓（"空体 404" 在浏览器里长得像 JSON 解析 bug，其实是没有路由）。

**根因（读代码 + 变异复现确认）**：宿主半 `dsh/host/index.mjs` 有一道通道归属守卫——
`owner !== null && owner.owner !== "npm"` ⇒ 打印 `skipping bundle activation` 并 **return**（面板路由与
工作区注册都跳过）。而 `readChannelOwner()` 的第二来源是 **home 级**的退役标记
`$DSH_HOME/.agent-presets/notes-assistant/.owner.json`——**它按 "preset" 索引，却被当成"任意 profile"的
归属**。你机器上那个标记写着 `owner: "direct"`（2026-09-25 的旧安装留下的）⇒ `web` profile 被误判成
"归 direct 通道"，于是**静默跳过激活**；`preset` 由 bundle 补丁声明、不走这道守卫，所以模式照常出现，
症状看着像面板的 bug。

**两个真 bug 与修法**：
1. **退役标记的适用范围**（`dsh/host/channel-owner.mjs`）：只有当被问的 profile **就是该 preset 自己的
   profile**（目录同名）时才读它；否则忽略。这样侧栏（`notes-assistant`）的原保护不变，别的 profile
   不再继承这个判定。
2. **native 通道不写归属锚点**（`dsh/install.mjs` 的 `nativeInstall()`）：现在会写 profile 自己的
   `.install-manifest.json`（`owner: "npm"`）。三个通道都写锚点，回退路径就不再需要被用到。

**守卫与变异**：`scripts/test-channel-owner.mjs` **14 → 18** 项——新增"**不同名 profile 不得继承退役
标记**"（读侧）+ 两条**运行时**用例（真的调用 `dsh/host/index.mjs`，断言不出现
`skipping bundle activation` 且确实去挂面板路由）。**变异 M25**：把限定改回去 ⇒ **4 条红**，并原样打出
根因句 `this profile is owned by "direct" (legacy .agent-presets marker) — skipping bundle activation`；
还原后 18/18 ✓。

**实机修复（用户机器）**：给 `<web>/.install-manifest.json` 写入 `owner: "npm"`；把修好的
`channel-owner.mjs` 覆盖进已安装包（bundle 用的是**已安装那份**，不重建就还是旧逻辑）。就地验证（用
**已安装的**那份代码）：`web → owner=npm/manifest` ✓、`notes-assistant → owner=direct/manifest` ✓
（侧栏不受影响）。**需再重启一次 3080** 才会重新执行激活。

**留下的粗糙面（已记 §7）**：客户端半个把"空体 404"报成 JSON 解析错误 ⇒ 应改成先看 `res.ok`/空体并显示
HTTP 状态；这是纯客户端改动（要重建 `client.js` 并重装到两个 profile）。

## 2026-09-26 · "两侧通用"：让主 dsh web（3080）也有笔记助手模式与记忆面板

**用户的观察**：侧栏（`notes-assistant` profile，3180）里能看到"数学笔记助手"模式和记忆面板，
但主 dsh web（`web` profile，3080）里都没有。**这不是 bug 而是安装范围**：引擎 + preset + 面板宿主
路由由**我们的 bundle** 提供，而客户端半个由 `installClientIntoProfile()` 单独装 —— 后者此前
**硬要求** profile 里有 `notes-assistant.patch.yml`（那是插件用 `--patch` 传的 overlay，`web` 启动时
根本不读它），而且 `nativeInstall()` 路径**从不调用**它。于是 3080 侧一件都没有。

**修法（三处代码 + 一次实机装配）**：

1. **挂行落在"该 profile 真正会被读到的层"**：有 overlay ⇒ 仍要求行来自内嵌 overlay（那份每次起服务
   会被重写，自己写等于白写）；没有 overlay（如 `web`）⇒ **插入到 profile 自己的 `cordis.patch.yml`**
   （没有任何人会重写它，所以行留得住），幂等。
2. **native 路径也装客户端半个**：`nativeInstall()` 在 `dsh plugin add` 成功后调用
   `installClientIntoProfile()`。
3. **⚠️ 修掉一个会炸的重复注册**：`web` 装 bundle 之后，**两个**宿主半个都会注册
   `/memory-panel/*` —— bundle 的 `math-memory-host` 行（→ 包根 → `dsh/host/index.mjs`，**它就是**
   注册路由的那个模块）**和**客户端包里的真宿主半个 ⇒ 重启即 `duplicate prefix route`（2026-09-21
   那次事故的同族）。判据补上第二种来源：独立文件 `math-memory-panel.mjs` **或**
   `node_modules/dsh-math-memory` 存在，都算"已有真宿主"⇒ 客户端包的宿主半写**空实现**。
   **这条是在让用户重启之前抓到的**：`--dump-config` 看不见路由注册，只有读懂"包根 main 就是宿主半"
   才看得出来。

**守卫**：`check-client-package-layout.mjs` 增**两条分支**——分支 3（只有 `cordis.patch.yml` 的
web 形态：行必须被插入到该层、脚手架内容不丢、幂等、宿主半用真的）与分支 4（**bundle 在场** ⇒
宿主半必须空）。**变异 M24**：把安装器改回旧硬编码 ⇒ 分支 3 精确报出
`没有 notes-assistant.patch.yml… 它是唯一允许挂载本包 loader 行的文件`。

**实机装配结果（`web` profile）**：组合里 `preset-notes-assistant` 1 次、`math-memory-host` 1 次、
`math-memory-client-panel` 1 次、引擎行 1 次，`dsh-web` 原有 42 处未受影响，`--dump-config` 无报错。
**注意**：`dsh plugin add` 会把依赖写进 `web/package.json`，本次用的是**本地目录**（`file:E:/…`）——
因为**已发布的 0.7.8 是 0.1.7 适配之前的形态，它的 bundle 补丁里只有宿主行、没有 preset 声明**
（实测：装它之后 `preset-notes-assistant` 在组合里 0 次）。换成下一版发布后应改用发布包。

**数据天然共享**：记忆文件在 vault 的 `.deepseek/memory/**`，两个 profile 用同一个 vault 就看见同一份
记忆；3080 侧只需在面板里把该 vault 选为工作区（下拉来自 `ctx.workspaceRegistry`，第一次用之前要先有
一个以该 vault 为工作区的会话）。

## 2026-09-26 · B0：给"第三份"（装好后的 profile 平铺文件）装上护栏

**背景**：解耦评估（`docs/decoupling-assessment-2026-09-26.md` §2.3）实测：现场 profile 的 12 项
posture 文件里 **4 项已与仓库不一致，而没有任何门禁会红**。根因是这"第三份"由**上一次**安装写下，
此后没人知道磁盘上的东西是否还是当初写的那份。

**落地（两件不同严格度的事，刻意分开）**：

- **硬检查——完整性基线**：`.install-manifest.json` 新增 `postureDigests`（每个 posture 文件一条
  sha256），两个安装器都写（CLI 的 `dsh/install.mjs` → `postureDigests()`；Obsidian 引导的
  `main.template.js` → `postureDigestsOf()`，同一形状）。校验用导出的
  `verifyPostureDigests()`：**磁盘与 manifest 记录的摘要必须一致**。不一致 = 有人绕过安装器改了
  profile、或写入被截断/被旧代码覆盖——这正是 2026-09-26 两次实机故障的同一族。
- **提示行——落后于仓库**：profile 的**代码文件**与仓库当前源码逐项比，差异打印成提示但**不失败**。
  **为什么不做成硬失败**：改动要等下一次安装/引导才落盘，滞后是**正常的**；做成硬失败会让每个没重装的
  用户永久飘红，那种门禁活不过一天。比较对象**派生**自仓库布局（只比 `dsh/preset|host` 下的同名文件），
  **不新增第四份文件名清单**（坑 96 的病根）。
  实测输出：`落后 2/6 个：math-memory.mjs (dsh/preset), note-tools.mjs (dsh/preset)` ✓ 与解耦文档
  独立测得的漂移一致（另两项 `cordis.patch.yml`/`package.json` 属 profile 专有文件，按设计排除）。

**踩到的坑（值得记）**：第一版落后提示写成"遍历 `postureDigests` 的键"——而现场的 manifest 是旧版本
写的、**没有** `postureDigests` ⇒ 遍历空集合、打印"与仓库一致"：**一个什么都没比的假绿**。改成从
`posture` 名单派生后立刻报出真实的 2 项落后。**空集合上的"通过"比没有检查更糟**（坑 69/98 同族）。

**守卫与变异验证**：
- `test-installer.mjs` 增 **4 条**：每个 posture 文件都有摘要；新装即验证通过；**自我变异**（测试内
  故意改动一个文件 ⇒ 必须报 drifted，还原后必须清零）；**旧 manifest 必须报 `unrecorded`，不能报
  clean**（否则等于把"没记录"当成"没问题"）。
- 真 dsh 门禁 `test-agent-preset.mjs` 增 **2 条**：完整性硬检查 + 落后提示（后者恒绿、只报数字）。
- **变异 M23**（临时 home，不碰真实 profile）：manifest 摘要与磁盘不符 ⇒
  `[FAIL] …完整性基线 | {"checked":3,"drifted":["cordis.patch.yml"],"missing":[]}` ✓，恰一条红。

## 2026-09-26 · 侧栏面板 403 与"vault 路径变成文本框"是同一个缺口：客户端半个不带 token

**两个症状**（实机同一时刻）：
1. 侧栏里打开记忆面板，报 `错误：forbidden: bad or missing token`；
2. 「笔记 vault」字段是个**自由文本框**，填了路径也不生效。

**一个根因**：面板的**客户端半个**（`dsh/client-panel/src/index.jsx`，跑在被代理的 dsh web 前端里）
**从来不发送 token**——它不可能知道：token 是**每次插件加载时随机生成**的，通过
`DSH_MATH_MEMORY_FEEDBACK_TOKEN` 注入 dsh 子进程，宿主半个（`dsh/host/math-memory-panel.mjs`）
据此校验（未设置时放行；设置了就必须带对，见该文件的 `panelToken`/`tokenMatches`）。
于是客户端半个的每一次 `/memory-panel/*` 都是 403 ✓。

第 2 个症状是这个 403 的**隐蔽后果**：客户端半个本来就有下拉分支——
```jsx
const res = await fetch("/memory-panel/workspaces");
if (json && json.ok && Array.isArray(json.workspaces)) setWorkspaces(json.workspaces);
…
{workspaces.length > 0 ? (<select …>) : (<input …>)}
```
`/memory-panel/workspaces` 被 403 掉 ⇒ `workspaces` 恒为空 ⇒ 退化成文本框。
（宿主半个**早就有**这个路由，且按仓库规矩从 `ctx.workspaceRegistry` 取根，不用请求里的 `root` ✓。）

**修法**：由**代理**替客户端半个盖章。代理（`DshWebProxy`）就在中间、构造时拿着 plugin 引用，
`plugin.linkServer.token` 就是注入子进程的那个值 ⇒ 在 `upstreamOptions()` 里对
`/memory-panel/*` 的请求加 `x-dsh-token`。这样密钥**不进 URL、不进页面 JS**，客户端半个一行都不用改。
路径判定抽成 `isMemoryPanelPath(url)`（接受裸前缀与子路径、忽略 query，明确"token 不从 URL 取"）。

**守卫**：`test-panel-routes.mjs` 从 47 项增到 **53** 项——行为侧断言 `/workspaces` 返回工作区列表
（下拉的数据源）且同样在 token 墙后；产物侧断言路径判定与代理盖章存在、客户端半个确有下拉分支。
断言先剥掉整行 `//` 注释（否则"把注入注释掉"这种最常见的退化会骗过正则——`check-plugin-unload.mjs`
2026-09-26 刚踩过同一个坑）。**变异验证 M20**：把产物里的 `headers['x-dsh-token'] = panelToken;`
注释掉 ⇒ 53 → 52，恰好那一条红；还原后 53/53。

**顺带收获**：这几条读 `main.js` 的断言**同时也是"改了模板必须重建"的守卫**——`git checkout -- main.js`
回到旧构建时它们立刻红（50/53）。

**真机状态**：新 `main.js`（732,080 字节）已部署到 vault；重启 Obsidian 后侧栏面板应不再 403，
且「笔记 vault」应变成**从工作区列表里选**的下拉。

## 2026-09-26 · 面板客户端包"只拷不声明"（真缺口，但**不是**下面那次故障的病因）

⚠️ **因果更正**：本节最初把"每一轮回复都失败"归因于这个缺口。**错了**——真正的原因是 profile 清单缺
`version`（见下一节）。这个缺口是在排查途中发现的**独立真问题**，修法保留：dsh 的运行时解析图由
`dsh-app-boot` 的 `installedProfilePackageNames()` 构建，判据是
> profile 的 `package.json` 的 **`dependencies` ∪ `peerDependencies`**，**且**该名字在
> profile 的 `node_modules/<name>/package.json` 真的存在。

我们的面板客户端半个此前只满足后半条（安装器把它**拷进** `node_modules` 却**从不声明**）⇒ 那一行是
"激活的、裸包名、不在图里"，而默认开启的清单扩展正是对"不在图里的活动行"抛错的那种消费者。
修法：安装器拷贝之后**同时声明**——同一棵树再放一份到 profile 内的稳定目录 `.dsh-client-panel/`，
并在 profile 的 `package.json` 里写
`"@dsh-math-memory/client-ui-memory-panel": "file:.dsh-client-panel"`。
`file:` 指向 profile 内、目标目录真实存在 ⇒ pnpm 也认（用版本号会去 registry 取；用 `node_modules`
里那份自己会成自引用）。两份内容一致：`node_modules` 那份负责"立即可加载 + 满足图的存在性判据"，
`.dsh-client-panel` 那份只作为 pnpm 可解析的来源。

**踩到的坑**：第一版用 `fs.cpSync` 拷贝，在真实 `$DSH_HOME` 下报 `EIO, Access is denied`（同一调用在
`%TEMP%` 下成功 ⇒ 环境/杀软产物而非权限规则）。改成显式 `readdir + mkdir + copyFile` 的朴素实现，
并把原因写进注释。

**守卫**：`check-client-package-layout.mjs` 增 4 条断言——profile **声明**了它、`file:` 目标目录真实存在、
`node_modules` 里存在（图的存在性判据）、重复安装不会反复改写声明（幂等）。

**排查途中被作废的两个"像真凶"的假设**（留着免得重踩）：
1. headless profile 里插一行"存在但未声明"的裸包名 —— **没触发**：那一行 inject
   `webServer`/`workspaceRegistry`，headless 里没有这些服务 ⇒ 它**从未被激活**，而该扩展只看活动行
   （`fiber.state === 2`）。这个"看似证伪"的实验其实什么都没测。
2. 用真 profile 的插件集 + 无头 app 复现 —— 也没触发（缺 web app 的那些服务）。
最终靠**探针插件**拿到里层 cause 才定案（见下一节）。

## 2026-09-26 · 实机测试抓到的第三个缺陷：每一轮回复都失败（profile 清单缺 `version`）

**症状**：侧栏里每一轮回复都失败，报
`本轮运行失败 DeepSeek request extension preparation failed`。会话日志显示它在 `request/context`
之后约 30 ms 就 `turn/end: error` ⇒ **HTTP 之前**、**没花任何 token**。

**定位过程**（每一步都排除了一个看起来很像的嫌疑）：
1. 上游只有一处抛这句话：`@deepseek-ai/dsh-llm-deepseek` 的 `prepareRequestExtensions`，它把真正的
   `cause` 包在里层，UI 与会话日志**只留外层**；
2. 贡献请求字段的插件只有两个，都在 `dsh-base`：`session-log-deepseek`（opt-in，默认关）与
   `plugin-package-inventory-deepseek`（**默认开**）；后者的 `resolve()` 是唯一会抛的地方；
3. 三次"端到端复现"都没触发（原因见上一节的两条作废假设）；
4. 改用**探针插件**：在真 profile 里挂一行，把 `deepseekLlmApiExtensions.prepare` 包起来，捕获时把
   `message`/`code`/`cause`/`aggregate`/活动行列进文件，并**临时吞掉**失败让用户先能用；
5. 日志第一行就是铁证：
   `plugin-package-inventory-deepseek: …\profiles\notes-assistant\package.json must declare non-empty name and version`。

**根因**：profile 自己的 `package.json` **有 `name` 却缺 `version`**。链路是：该扩展解析**每一个活动行**
的"归属清单"；**相对路径行**（`./math-memory.mjs`，正是离线通道的形态）走
`nearestManifest()` 一路向上，落到 **profile 自己的 `package.json`**，然后上游
`identityFromManifest(path, allowAnonymous = true)` 是这么写的：
```js
if (allowAnonymous && manifest.name === undefined) return undefined;   // 没有 name = loose module，放行
if (!name || !version) throw new Error('… must declare non-empty name and version');
```
⇒ **有 name、缺 version 就抛**，而它在请求**准备**阶段抛，所以请求根本没发出去。
`web` profile 从不触发，因为它所有行都是裸包名，压根不走那次向上查找——这解释了"为什么只有侧栏 profile 坏"。

**修法**（三处，缺一不可）：
- `dsh/profile/package.json` 补 `"version": "0.0.0"`（私有 profile 不需要真实版本号）；
- `dsh/install.mjs` 新增并导出 `repairProfileManifest()`，在 `nativeInstall` 与
  `directInstallProfile` 两条路径都调用——**因为 `copyFile` 默认保留用户可编辑文件，光改脚手架救不了
  已装用户**；
- `obsidian/main.template.js` 的引导里加同款 `repairProfileManifestFile()`，让 Obsidian 侧自愈。

**守卫**：`test-installer.mjs` 新增 5 条断言——脚手架必须声明非空 `name`/`version`、装出来的清单两者
都在、以及**变异式前置**（把 `version` 删掉再跑一次安装器，必须被补回，且 `dsh`/`dependencies` 不变）。

**教训**：症状指向"上游适配"时，先想办法拿到**里层 cause**（这里是一个自建探针 + 一次真机复现），
比端到端猜三轮都值；"没复现"不等于"不是它"——先确认实验真的压到了那条路径（本次两次假阴性都是
"那一行压根不是活动行"）。

## 2026-09-26 · 实机测试抓到的第二个缺陷：卸载插件时漏掉代理监听

**症状**（用户机器上）：重载插件后侧栏报 `dsh 服务未能在端口 3180 上启动`，而日志同时显示 dsh 子进程
其实起来了（`dsh web: http://127.0.0.1:62796/?token=…`）；插件 debug.log 里每秒一条
`[auth] 代理无法监听 3180：Error: listen EADDRINUSE`，重试约 20 次后放弃，并且**每次重试又拉一个 dsh
子进程**（本机当场累积到 2 个）。`netstat` 显示 3180 的持有者是 **Obsidian 进程自己**。

**根因**：`onunload()` 的清理被挂在 `this.service?.child !== null` 上，而子进程**一退出**
`start()` 的 exit/error 处理器就把 `this.child` 置空（`this.child = null`）。于是"子进程曾经失败过、
或被人为结束过"之后，插件卸载时**整段 `stop()` 都被跳过**——而 `DshWebProxy` 的监听 socket 是**在
Obsidian 进程里**的，它不会随插件实例一起消失。下一次启用时新实例 `listen(3180)` 永远 EADDRINUSE。

这条路径平时不容易撞上，是"**旧模块仍在内存里 + 我把它的两个子进程杀了**"两件事叠出来的：
子进程被杀 → `child` 置空 → 卸载不清理 → socket 泄漏。也就是说，**"重载插件"这个动作对旧版本而言
是危险操作**，而当时的建议正是它。

**修法**：`onunload()` **无条件**释放：不再看 child 状态；`keepAliveOnUnload` 为真时只关渲染进程这一侧
的 proxy（保留子进程），否则整条 `service.stop()`（它内部会 `await this.proxy.close()`）。用户设置的
`keepAliveOnUnload=false`，所以走后者。

**守卫**：新增第 **50** 条门禁 `check: plugin unload cleanup`，断言 `onunload()` 直接关代理**或**调用
`service.stop()`、不再以 `service.child` 为条件、且仍停 LinkServer。模板只能在 Obsidian 里运行，
所以这是源码形态断言（与皮肤那两条同一风格）。写它时踩了两次自己的坑，都记在门禁的注释里：
① 断言匹配到了**自己写的说明注释**（注释里引用了旧代码原文）⇒ 改为按行丢弃注释行；
② 第一版"去注释"用贪婪的 `/*…*/` 正则**把中间代码整段吃掉**，于是正确代码也报"没有清理" ⇒ 改成按行过滤。
变异验证：**M17** 旧 child 守卫放回 ⇒ 精确报 child 那条；**M18** 两处释放删掉 ⇒ 精确报 neither 那条；
**M19** 不停 LinkServer ⇒ 精确报 linkServer 那条。

**同时确认的一件好事**：门禁 `test: agent preset mounts` 里有一条会读**真实部署**的 overlay 并断言
preset 声明在场——旧模块每起一次服务就重写 overlay（把声明擦掉），这条就会红。它是对的，不是误报；
本轮它也真的抓到了（`15/16`，红的那条写着"侧栏会报 agent-preset/not-found"）。

**验证**：`node scripts/run-gates.mjs` = **50/50 passed, 0 skipped**；`main.js` 已重建（728,214 字节）。

## 2026-09-26 · 实机测试抓到的第一个缺陷：皮肤中心行会被插两遍

**怎么发现的**：本机 `$DSH_HOME` 里**没有 `notes-assistant` profile**（2026-09-25 那次全损删掉了，
之后一直没重建），所以两条最该真跑的门禁长期 SKIP。把 profile 用离线通道铺出来之后：

1. 两条 SKIP 变成真跑：`test: agent preset mounts` **16/16**、`test: panel auth e2e` **8/8**
   ⇒ 全量 **49/49 passed, 0 skipped**（这是本轮第一次没有 SKIP）；
2. 顺手把 P2-D 那个按钮干的活（`dsh plugin --profile notes-assistant add` 两个皮肤中心包）
   在真机上跑了一遍——**这是 P2-D 里唯一没有被任何自动化覆盖的一步**；
3. 跑完看组合结果才发现问题：`dsh plugin add` 把两个包登记进了 profile 的
   `dsh.profile.bundles`，于是**它们自带的 patch**（`dsh.bundle.patch` → `cordis.patch.yml`）
   已经把 `ui-skin-center` / `ui-web-ui-settings` 两行插进去了——
   `dsh --dump-config` 里这两行标着 `# == @linxin666/dsh-client-ui-skin-center`，即**来自包本身**。

而用户的设置里 `enableSkinCenter: true`，插件还会往 overlay **再插一次同样的 id**。

**为什么必须修**：同 id 插两次在语义上就是错的（能不能被 dsh 容忍是另一回事——我没能用
`--dump-config` 证伪，因为它不渲染 preset 组合体内的行）。而这条路径以前不会被触发，因为
"包在、且已登记成 bundle"这个状态**只有在用那个按钮之后才会出现**，而按钮是 2026-09-26 才有的。

**修法**：把判据拆成三个，各司其职——
- `skinCenterInstalled(home)`：这两个包在**本 profile** 里可解析（按钮与状态行用它）；
- `skinCenterBundled(home)`：本 profile 的 `dsh.profile.bundles` 里已经有它们（读
  `profiles/<name>/package.json`）；
- `skinCenterMountable(settings, home)`：开关开 **且** 已安装 **且** 未登记成 bundle
  ——只有这种情况才轮到插件插入挂载行。
连带的用户可见变化：**点过按钮之后那个开关就不再控制皮肤中心了**（行由包自己的 patch 提供），
所以设置页文案与提示都改了，按钮的成功提示也分两种情形如实说明。
（按钮的完成判据必须用 `skinCenterInstalled` 而不是 `skinCenterMountable`——装成 bundle 之后
后者**故意**是 false，用错会让一次成功的安装被报成失败。）

**守卫**：`check-skin-fallback.mjs` 新增"挂载判据必须读 profile bundles"这条断言；
并把上一轮那条"必须检查本 profile 的 scope"改成**跟随委托关系**（判据下沉到 `skinCenterInstalled`
之后，旧断言在一个正确的树上误报了——这本身也是它该被改写的信号，而不是放宽它）。
变异验证：**M15** 拿掉 bundle 判据 ⇒ 精确报那一条；**M16** 判据退回 web scope ⇒ 报
mirror-era + bundle 两条；恢复后绿。

**验证**：真 profile 组合结果里 `id: ui-skin-center` 与 `id: ui-web-ui-settings` **各出现 1 次**；
`node scripts/run-gates.mjs` = **49/49 passed, 0 skipped**。

## 2026-09-26 · 第二对重复实现合并，且扫描覆盖共享模块（P2-B 第三步）

**合并 `setTopFieldText`（preset）/ `setTopField`（host）。** 与上一对不同，这一对**不是同义代码**：
host 经 `joinFrontmatterLines` 会**剥掉开头的空行**，preset 内联 join 不会 ⇒ 空 frontmatter 体
（`---\n\n---`）下前者产出 `key: value`、后者产出 `\nkey: value`。我原先在守卫表里写的理由是错的
（"差别在调用方传的是原值还是转义值"），**读代码才发现的**。合并取 **host 那一侧**：它是被修过的一侧
（多出来的空行只是噪声），而且已经有一条既有断言钉着（`check-embedded-writers` 的
"keeps an EMPTY frontmatter block well-formed"）。

**行为变更的交代**：preset 侧写出来的卡片在"frontmatter 体以空行开头"时少一个空行。preset 只有三处调用
（`rewriteHookStats` 的 uses/last_used、`duplicate_of`、`status`），都是改写已有卡片，正常路径完全一致；
新增 7 条断言把它钉住（`scripts/test-memory.mjs`，含空体、缩进字段不动、CRLF 保持、缺字段追加）。

**合并后出现的新盲区，一并补上**：共享助手被**拷回某一个引擎**时，两两引擎扫描**看不见**它（那一侧已经
不再声明同名符号，另一个引擎也没有对应物）⇒ 扫描改为**三集合**：`engine-shared.mjs` ×（preset ∪ host），
任意名字、超阈值即失败，**且这里没有豁免表**——命中就意味着"这个助手现在有两份"。
变异验证 **M14**：把 `contentText` 拷贝回 host 并改名 ⇒ 红（0.804），恢复后绿。

**顺带**：`scripts/test-memory.mjs` 的断言数 391 → 398，`check-doc-counts` 立刻抓出 5 处文档计数
（`ARCHITECTURE.md` ×2、`docs/memory/README.md`、`docs/handoff.md` ×2、中英 README 各 1）——
这正是那条门禁存在的理由，逐处按"实际 398"更新，README 对已重新记录。

**验证**：三个布局仍然实测——离线扁平（真 dsh 自举 profile 门禁 10/10 绿）、package（`import()` 成功且
`setTopField('', 'k', 'v') === 'k: v'`）、内嵌求值（捕获扫描 29 ms；空 frontmatter 体断言绿）；
`node scripts/check-engine-sync.mjs` = 绿（23 共享符号，2/2 改名重复已承认）；`node scripts/run-gates.mjs`
= **47/49 passed, 2 skipped, 0 failed**。

**还剩 1 对**：`decodeZstdSessionLog`/`decodeSessionLog`——合并要把**解压器参数化**（host 用的是嵌入加载器
注入的 `zstdDecompressSync`，见 `KNOWN_DIVERGENT` 为 `readSessionHeader` 记下的同一偏离）。

## 2026-09-26 · 第一对重复实现真的合并了（P2-B 第二步）

**做了什么**：把 `contentText`（preset）/ `captureContentText`（host）——**逐字同义、只差引号风格**——合并成
一份实现，放进新的规范文件 `dsh/preset/engine-shared.mjs`。

**为什么现在能合，而以前"两个产物不能共享 import"**：那句话成立的场景是 preset 体文件住在
`$DSH_HOME/.agent-presets/<id>/`（一个没有 `node_modules` 的扁平目录）。**同一个相对 specifier 要在两种
布局下都能解析**这件事，仓库里早有解法：`dsh/host/hook-frontmatter.mjs` 那个"规范文件 + 同名 re-export shim"。
于是：

- 规范文件 `dsh/preset/engine-shared.mjs`（离线通道**扁平**铺进 profile 目录）；
- `dsh/host/engine-shared.mjs` = `export { contentText } from "../preset/engine-shared.mjs"`（package 布局下
  让 `./engine-shared.mjs` 也能解析），并记进 `NOT_EMBEDDED`（内嵌会与规范文件同名冲突，理由与 hook-frontmatter 同源）；
- 两侧都写 `import { contentText } from "./engine-shared.mjs"`：preset 侧解析到同目录规范文件、host 侧在
  package 里解析到 shim、离线扁平布局解析到规范文件、内嵌产物解析到被内嵌的那份。

**连带必须一起改的地方（都是门禁逼出来的，逐条都有价值）**：
1. `PRESET_BODY_FILES` 加一项 ⇒ `check-preset-body-lists` 立刻报"闭包 == 清单"通过，但**同时抓到 Obsidian 模板
   侧漏了两处**：`DIRECT_PROFILE_FILES` 没这项、也没写这个文件。这正是那条门禁存在的理由。
2. `EMBEDDED_SOURCES` 加 `engine-shared.mjs`（构建是显式白名单，不加就抛错）。
3. **内嵌加载器**：模板求值 `memory-admin.mjs` 时是把 `node:` import 剥掉、用注入的绑定求值的，它没有模块系统
   ⇒ 现在把规范文件的源码**拼在模块体之前**（函数声明会提升）并剥掉那行相对 import，模拟"加载器把两个文件
   物化到同一个目录"。`check-embedded-loader.mjs` 镜像着这条变换链，同步改（这是有意维护的"被检验的重复"）。
4. `test-installer.mjs` 的 posture 计数 11 → 12，并把 `engine-shared.mjs` 加进存在性断言。

**验证（三个布局都实测）**：
- **离线扁平**：真 dsh 自举 profile 的门禁绿（`test: self-provisioned profile accepts a session`，10/10）——
  它就是把 `PRESET_BODY_FILES` 铺进一个临时 profile 再启动的；
- **package 布局**：`import('./dsh/host/memory-admin.mjs')` 与 `import('./dsh/host/math-memory-panel.mjs')`
  都成功（31 / 5 个导出）⇒ shim 真的被解析到；
- **内嵌求值**：`node scripts/check-embedded-loader.mjs <vault>` 跑到了捕获扫描（56 ms）——那条路径会调用
  `contentText`，所以不是"只求值没执行"；
- `node scripts/run-gates.mjs` = **47/49 passed, 2 skipped, 0 failed**。

**守卫随合并自动收口**：那一对从 `KNOWN_ESCAPES` 里删掉（`--sweep` 里它不再出现，留着会因"条目过期"报红）。
**读代码而不是信分数**还带出一个发现：`setTopFieldText`/`setTopField` 那对 0.836 的**并不是同义代码**——
host 经 `joinFrontmatterLines` 会**剥掉开头空行**，preset 内联 join 不会（空 frontmatter 体时前者产出
`key: value`、后者产出 `\nkey: value`）。我原先在守卫表里写的理由是错的，已改成 `action: 'divergent'` 并写明：
合并它等于把 host 的行为（被修好的那一侧）搬给 preset，那是**行为变更**，要单独一条提交加测试。

## 2026-09-26 · 引擎守卫补上"改名逃逸"检测（P2-B 第一步）

**问题**：`check-engine-sync.mjs` 的每一条判据都**按符号名配对**，所以"同一份代码换了名字"是它的
盲区。这个盲区已经吃过一次亏：`pathIsInside`（preset）/ `pathInside`（host）是同一个
**安全相关**（vault 边界判断）的助手，却因为名字不同而长期不被守卫看见（陷阱 64，2026-09-11 才
统一改名）。2026-09-26 用"同一套 span 抽取器 + token bigram 全量比对"手工扫出**还有 3 对**在盲区里，
外加一处结构性逃逸。

**这一步只做守卫，不动引擎**（改引擎是另一条提交、另一类风险）。新增与名字无关的
**token-shape 扫描**：

- 把 preset 的每个顶层声明与 host 的每个顶层声明两两比对（本次实测 **3537 对**），用
  **Sørensen–Dice 的 token-bigram 重叠度**打分——近似重复（差几个标识符，正是改名的样子）接近 1，
  无关函数远低；
- 超过阈值就必须登记在 `KNOWN_ESCAPES` 并写明理由与处置（`dedup` / `structural`），
  与 `KNOWN_DIVERGENT` 同一套纪律：**条目过期也是失败**（去重之后不删条目 ⇒ 红），
  这样"豁免表"不会退化成"随便漂移的通行证"；
- `--sweep` 打印最高分的跨名对与阈值，供重新定标（像 `run-gates --list`、`check-env-vars --list`）。

**阈值是量出来的，不是拍的**：已知 4 对落在 **0.792–0.844**，第 5 名是 **0.662**
（`parseLocalDay` ↔ `daysSinceText` —— 两个短日期助手仅仅"长得像"）。0.70 落在这道断层里，
所以既抓得住真重复，也不必让人去承认巧合。把它定在 0.62 会多报两对假阳性，定在 0.85 会漏掉
最低那对真重复。

**当前被守住（并与 `KNOWN_DIVERGENT` 的分工写清）的 4 对**：

| preset | host | 分数 | 处置 |
|---|---|---|---|
| `decodeZstdSessionLog` | `decodeSessionLog` | 0.844 | `dedup` |
| `setTopFieldText` | `setTopField` | 0.836 | `dedup` |
| `contentText` | `captureContentText` | 0.804 | `dedup` |
| `runSessionCapture` | `scanSessionCapture` | 0.792 | `structural` |

最后一对是**结构性**逃逸：host 把 112 行捕获循环从 `runSessionCapture` 里拆了出去（留下一个 10 行
包装），而名字判据登记的正是那个包装 ⇒ 真正的循环体从未被比对。现在它由这个扫描比对，于是那段
代码的漂移第一次有了足迹。

**变异验证（两个方向都必须红）**：
- **M11**：把 host 的 `setTopField` 改名为 `setTopFieldValue`（= 制造一个改名重复）⇒
  新对与"条目过期"**两条同时红**；
- **M13**：名字不变、给白名单那一对灌入约 90 个独特 token 使其相似度掉到 **0.598** ⇒
  "条目过期"红。
恢复后逐字节一致、exit 0。

**这一步之后仍待做（P2-B 的去重本体）**：把 3 对标记 `dedup` 的重复实现合并成一份。合并的可行形态
已在 `dsh/host/hook-frontmatter.mjs` 立过先例（规范实现 + 同相对 specifier 的 shim：package 布局解析到
shim、离线扁平布局解析到规范文件本身，shim 记在 `NOT_EMBEDDED`）。**已探明的障碍**：
`decodeSessionLog` 那一对不能简单合并——host 侧解压走的是**嵌入加载器注入的**
`zstdDecompressSync`（这正是 `KNOWN_DIVERGENT` 为 `readSessionHeader` 记下的偏离），所以合并要把
解压器**参数化**，而不是复制一份实现。

**验证**：`node scripts/check-engine-sync.mjs` = 绿（23 个共享符号：17 同步 + 6 有记录偏离；
4/4 改名重复已承认、0 过期、0 新增）；`node scripts/run-gates.mjs` = **47/49 passed, 2 skipped,
0 failed**。

## 2026-09-26 · `.deepseek/config.md` 的创建口径统一（P2-A3）

**先说我为什么没做原计划的 P2-A（把设置搬进 dsh `Config`）**：dsh 0.1.7 确实自带
`dsh-config-editor`（*"Persist plugin configuration through profile patches and Loader
reconciliation"*）+ Settings→Plugins 表单，收益是真的。但声明 `Config` 需要静态
`import z from "@deepseek-ai/schemastery"`，而我们的 preset 体文件住在 profile 目录里。
用 Node 的真实解析器实测：

```
从离线 notes-assistant profile 解析  @deepseek-ai/schemastery -> MODULE_NOT_FOUND
从 web profile 解析                  @deepseek-ai/schemastery -> .../web/node_modules/... ✓
```

`$DSH_HOME/profiles/node_modules`（app-boot 在 pnpm 装机时"heal"的那层）在离线装机上**不存在**
⇒ 静态裸 import 一旦加上，离线通道的 preset 就挂不上，**每次新建会话都失败**（陷阱 70 的形态）。
仓库自己的 `note-tools.mjs` 就为此写过动态加载（且那段注释还是按已退役的老路径写的）。
⇒ 原计划的 A 在**主通道**上不成立，已按此结论收口；改为做 A3（口径统一）。

**A3 修的是一处真实的语义漂移**：同一个"没有 `config.md` 就从脚手架创建"的操作有两个前端，
它们给的内容不一样——

| 键 | `dsh/templates/config.md`（权威） | 面板的字面量 |
|---|---|---|
| `autoArchive` | `true` | `false` |
| `captureSubagents` | `false` | **缺失** |

`autoArchive: true` 正是"体检把低效用卡移进 `.deepseek/archive/`"的开关，所以这不是文案差异而是
**行为差异**：同一个 vault 的默认值取决于你先点了哪个 UI 创建那个文件。

**改法**：
- `math-memory-panel.mjs` 新增 `configScaffold()`：**优先读真模板**（`../templates/config.md`，npm/bundle
  通道下可用，创建出的文件连字段说明都一致），读不到才退回字面量；字面量已按模板改正并 `export`。
  路由从 `CONFIG_FALLBACK` 改为传 `configScaffold()`。
- 新门禁 `check-config-scaffold.mjs`（**第 49 条**）：直接 `import()` 面板模块取**真实常量**（不是 grep
  源码），与真模板比对 frontmatter 的**键集合、顺序、每个值**和标题行；再断言 `configScaffold()` 在模板
  可达时确实返回模板本身。用共享的 `frontmatterSpan` 取块——重打分隔符正则会被
  `check-frontmatter-source.mjs` 拒绝（这条门禁第一次跑就抓到了我自己犯的这个错）。
- 变异验证：**M9** 把回退里的 `autoArchive` 改回 `false` ⇒ 红；**M10** 删掉 `captureSubagents` 行 ⇒
  键集合与缺失值两条同时红；恢复后 exit 0。

**验证**：`node scripts/run-gates.mjs` = **47/49 passed, 2 skipped, 0 failed**（门禁 48 → 49，AGENTS §4
的计数由 `check-doc-counts.mjs` 守住）；`main.js` 已重建（720,829 字节）。

## 2026-09-26 · junction 镜像退役：侧栏皮肤中心改为显式安装（P2-D）

**问题（先取证，因为它推翻了原计划）**：插件在 `onLayoutReady` 无条件调用
`syncGlobalPackageLinks(home)`，用**目录链接**把 web profile 的整片 `@linxin666`
镜像进笔记 profile（本机 **18 条**）。它存在的理由是：

> 皮肤管理器把活动皮肤写进全局 `$DSH_HOME/cordis.patch.yml`，而全局层作用于**每一个**
> profile，所以侧栏 profile 也必须能解析 `@linxin666`。

取证发现**这个前提已经不成立**：`@linxin666/dsh-client-ui-skin-center@0.4.2` 的 README 原文是
*"no reload, no **cordis.patch.yml rewrite**, no restart"*——皮肤 v2 是"纯资源目录 + 浏览器半
实时切换"，v1 写进 home 根 `cordis.patch.yml` 的受管段还会被它的 legacy bridge **清掉**
（issue #788）。本机实测：`$DSH_HOME/cordis.patch.yml` 里**只有 pretooluse-guard，一行 skin 都没有**。

也就是说，**镜像的全部理由是历史**，而它留下的只是副作用：在本机（2026-09-25 全损过一次 harness
home、目录链接是疑似载体、全局守卫此后禁止 agent shell 工具建链接）每次启动建 18 条链接，
**而且守卫看不见**——它拦得住 `pwsh`/`node` 的 `mklink`/junction，拦不住 Obsidian 插件进程里的
`symlinkSync`。

**现在还需要 `@linxin666` 的只剩一处**：设置项 `enableSkinCenter` 往 overlay 追加
`ui-skin-center` + `ui-web-ui-settings` 两行，让侧栏里也有那个选择器。这两个包带**真实运行时依赖**
（`jpeg-js`、`lightningcss` + 其原生包、`yaml`、`schemastery`，共约 1.9 MB），所以"像客户端半个
那样拷进 `node_modules`"会解析不了依赖——**`dsh plugin add` 是唯一正确的安装器**。

**改法（用户选定"显式安装"）**：
- **删除** `syncGlobalPackageLinks` 及其反向清理、`readSkinFallbackBlock` / `stripSkinFallbackBlock`，
  以及 `onLayoutReady` 里那次无条件调用；`fs` 里 `lstatSync` / `rmSync` / `symlinkSync` 随之从
  require 列表移除（它们在本文件已无其它用途）。
- **新增** `installSkinCenterPackages(home, done)`：跑
  `dsh plugin --profile notes-assistant add @linxin666/dsh-client-ui-skin-center @linxin666/dsh-client-ui-web-ui-settings`，
  `stdio: 'ignore'`（受限环境禁止管道捕获子进程输出），**成功与否由文件系统判定**——
  `close` 后重新检查那两个包在**本 profile**里是否真的存在，从不只看退出码。
- **`skinCenterMountable()` 改为纯文件系统判据**（本 profile 里装着这两个包才挂那两行）：
  `writeNotesAssistantPatch()` 每次启动都跑，而它**不能有副作用**——一旦把"顺带装个包"塞进去，
  就变成在渲染进程里同步等一次 pnpm。
- 设置页新增一个按钮「把皮肤中心装进侧栏 profile」，并显示当前状态（已装 / 有可装版本 / 无来源）；
  开关打开但包没装时给出**指向那个按钮**的提示，而不是含糊的"未检测到皮肤包"。
- **`SKIN_FALLBACK` 保留**，但它现在有了独立的理由：它读机器级 patch 里仍被引用的 `ui-skin-*` id
  并写成 `disabled: true`。这件事**不依赖镜像**（对手工写过 v1 行的机器仍是有效防御），而且从
  "只在 web profile 缺失时降级"变成**每次启动重算**（旧实现里那块内容是"被刷新擦掉再重放"，
  时序上曾经失效过一次——见 CHANGELOG 2026-09-11 那条）。

**删掉的门禁**：`check: mirror cleanup (dangling @linxin666 junctions)`（7 项、做过变异验证）——
它测的是"镜像清理得干不干净"，而**被测代码整段退役了**。保留它只会养一段死代码，与本轮 B2 同一
条纪律。门禁总数 **49 → 48**（由 `check-doc-counts.mjs` 守住）。

**保留/更新的防御**：`check: skin fallback` **保留**（它断言 base profile 里不得硬挂任何
`@linxin666`——在"包必须真装进本 profile"的新形态下，这条比过去更重要），只更新了头部注释。

**首次启用成本要说清**：`enableSkinCenter` 在本机 `data.json` 里是 `true`，但这两个包**从未**装进
笔记 profile（过去靠镜像"看起来装着"）。这次改动之后侧栏皮肤中心在**点一次按钮之前不生效**——
为了避免用户以为功能坏了，开关的提示直说要点那个按钮。

**新增的两条不变量断言**（都加进 `check-skin-fallback.mjs`，因为这个文件本来就在守"base profile 不得硬挂
`@linxin666`"）：
1. **挂载判据必须是本 profile 的 scope**（`skinCenterMountable` 里出现 `obsidianSkinScope(home)`、且
   不再出现 `webSkinScope(home)`）——判据退回 web scope 就正好恢复了"镜像时代的条件"；
2. **插件源码里不得出现建链接的调用**（`symlinkSync(` 与 `'junction'` 字面量）。注意用**调用形态**
   而不是裸词匹配：本文件的注释里就写着这两个名字（解释它们为什么被删掉），裸词匹配会自伤。

**变异验证**（新守卫必须证明它在该报错时确实报错）：
- **M7** 把 `skinCenterMountable` 的判据改回 `webSkinScope(home)` ⇒ 两条断言红、exit 1；
- **M8** 重新插入一行 `symlinkSync('a','b','junction')` ⇒ 两条断言红、exit 1；恢复后 exit 0。

**验证**：`node scripts/run-gates.mjs` = **46/48 passed, 2 skipped, 0 failed**（两次 SKIP 仍是本机
没有已部署的 `notes-assistant` profile）；`npm run qa` = seed-probe 8/8。
`node --check obsidian/main.template.js` 通过；`main.js` 已重建（718,895 字节，14 个内嵌源），
`check-bundle-freshness` 逐字节确认提交的 `main.js` == 用当前模板的全新构建。

## 2026-09-26 · 退役 `.agent-presets/`（步骤 B2：删掉死代码并改名）

**状态**：已实施。这一步**不改变任何行为**，只把 B1 之后确定无人调用/无人读的东西清掉。

**删了什么，凭什么说它无人调用**：
- `syncPresetTree`（及其 `filesUnder` / `sameFile` / `pruneExtras`）：生产代码零调用——
  `grep syncPresetTree` 只剩它与测试自己。它做的"目录式 preset 同步"在 0.1.7 被
  bundle 里的**声明**取代了（模块按包内路径或 profile 目录里的 `./name` 解析）。
  它此前还被 `gates.mjs` 的 `syntax` 与 `test: preset sync` 两条门禁"养着"——
  **门禁在保护一个已退役的机制**，这正是本轮要拆掉的东西。
- 连带删掉当轮新增门禁里那句"它已无生产调用方，仅测试在跑"的注释所指的状态。

**改名**：`dsh/host/preset-sync.mjs` → `dsh/host/channel-owner.mjs`
（它现在只回答"这个 profile 归哪条通道"，`preset-sync` 已经是它的历史）;
配套 `scripts/test-preset-sync.mjs` → `scripts/test-channel-owner.mjs`（同理由），
门禁名 `test: preset sync` → `test: channel ownership anchor`。
用 `git mv` 保留历史；`scripts/build-obsidian.mjs` 的 `NOT_EMBEDDED` 条目、
`gates.mjs` 的 syntax 条目、`dsh/host/index.mjs` 与 `dsh/install.mjs` 的 import 同步更新。

**联动更新**（都是"引用了刚被删掉的东西"的地方）：`check-patch-yaml.mjs` 与
`gates.mjs` 里"别的门禁把这些文件当文本读"的举例（原先举 `test-preset-sync.mjs` 的
逐字节比对，现改举 `test-installer.mjs` 的漂移比对）、`test-installer.mjs` 的注释指向、
`main.template.js` 的注释指向（⇒ 重建 `main.js`）、`ARCHITECTURE.md` 的入口地图与
`npm test` 行。

**验证**：`node scripts/test-channel-owner.mjs` = **15 passed, 0 failed**（锚点优先级 8 +
`profileDirFromCtx` 3 + 运行时守卫对照 4——最后一段用 cache-busting 的 in-process `import()`
直接调**真的** `dsh/host/index.mjs`，因此这几条断言不是"复制一份逻辑来测"）；
`node scripts/run-gates.mjs` = **47/49 passed, 2 skipped, 0 failed**。

## 2026-09-26 · 退役 `.agent-presets/`（步骤 B1：停止写入）

**状态**：已实施。步骤 A（锚点迁移 + 回退读取）见下一节；**B2（删掉 `syncPresetTree` 与它那两条门禁）待做**。

**为什么现在能停写**：`.agent-presets/<id>/` 的**唯一**剩余意义是通道归属标记，而归属已经在步骤 A
迁到 `<profile>/.install-manifest.json`（三条通道本来就都在写它）。preset 实体自 0.1.7 起由
bundle patch 里的声明提供，模块按包内路径或（离线通道）profile 目录里的相对路径解析——那个目录
**没有任何读者**。

**做了什么**：
- `dsh/install.mjs`：删掉 `directInstallPreset()`（它把 5 个 preset 文件 + `.owner.json` 写进旧目录）
  ，`--direct` 只走 `directInstallProfile`；`--force` 也不再补写旧 marker（profile 清单已经写了
  `owner=npm`，而 `readChannelOwner` 优先读它，陈旧 marker 因此无害）。
  `uninstall` 保留**迁移清理**分支：旧目录还在就删掉，没有就什么都不做；`status` 在发现旧目录时
  打印一行 `retired: [present] …`，让残留状态可见而不是静静躺着。
- `obsidian/main.template.js` 的 `bootstrapDshConfig`：不再写旧目录（5 个 `ensureFile` + 一个 marker
  写入），**冲突守卫改成先读 profile 清单、再回退旧 marker**——模板不能 import `preset-sync.mjs`
  （那是 `NOT_EMBEDDED`），所以这里是同一套优先级的一份内联实现，与宿主那份行为一致。
  连带的 `writeOwnerMarker` 随之删除（零调用方）。**重建了 `main.js`**。
- `scripts/lib/isolated-dsh-home.mjs`：删掉 `withPreset` 分支（探针不再需要种那个目录）。
- `scripts/test-installer.mjs`：断言反过来——**旧目录不得被创建**、不得写旧 marker；而卸载时
  **测试自己造一个**（模拟 2026-09-26 之前的装机）并断言它被清掉；冲突用例保留"只有旧锚点"的
  迁移路径。

> **保留回退是有意的，不是没删干净**：把回退也删掉，2026-09-26 之前装的机器会变成"无主"，
> 另一条通道就会静默接管——那正是这一轮要修的缺陷本身。回退的寿命至少到下一次大版本。

## 2026-09-26 · 通道归属锚点从退役目录迁到 profile 目录（步骤 A/两步）

**状态**：步骤 A 已实施（新锚点 + 旧锚点回退 + 三处读写归一）；步骤 B（删旧目录的写入与
`syncPresetTree`）待做。

**问题**：npm / direct 两条通道的冲突守卫，**唯一**能查的锚点是
`$DSH_HOME/.agent-presets/<notes-assistant>/.owner.json`——而那个目录自 dsh 0.1.7 起
**没有任何代码读它**。也就是说「把死目录清掉」这个看起来最顺手的动作，会让守卫
**静默失效**：两条通道此后互相覆盖、一句提示都没有。讽刺的是，文档里到处写着"这个目录已经死了"。

**修法（步骤 A）**：锚点换成 `<profile>/.install-manifest.json` 的 `owner`——**三条通道本来
就都在写它**（`install.mjs` 的两条路、Obsidian 引导），所以这次不需要新增任何写入，只需要
规定**读的优先级**：

- `dsh/host/preset-sync.mjs` 新增 `readChannelOwner({profileDir, home, presetId})`：
  **profile manifest 优先，退役的 `.owner.json` 仅作回退**（旧装机只有后者；把它当成
  "无人拥有"正是这条函数要防的静默接管）与 `profileDirFromCtx(ctx)`（`ctx.baseUrl` 实测锚点）。
- `dsh/host/index.mjs` 的运行时守卫、`install.mjs` 的三处冲突检查/`status`/`uninstall`
  全部改走它；**一次查询**取代了原先"分别读两个 marker、可能各自得出不同结论"的写法。
- `install.mjs` 原本自己写了一遍 `.owner.json` / `.install-manifest.json` 两个**文件名字面量**，
  现在从 `preset-sync.mjs` 导入——第二份字面量正是两个锚点会各自漂移的入口。

**验证**：
- `test-preset-sync.mjs` 从 20 项扩到 **35 项**：锚点优先级 8 项（含"两个锚点冲突时 manifest 赢"、
  "manifest 坏 JSON 不致命"、"没有 owner 的 manifest 不算拥有"、"没有任何锚点 ⇒ 无人拥有"）、
  `profileDirFromCtx` 3 项，以及**运行时守卫的对照实验 4 项**——用带 cache-busting 的
  in-process `import()` 起两份 `host/index.mjs` 实例（`apply` 有模块级 `mounted` 旗标，同进程只能
  跑一次），差分条件是"manifest 说 direct、旧 marker 说 npm"：守卫必须跳过**并点名 manifest**，
  且面板/工作区**一次都没被尝试**；无锚点的那份必须正常激活。
- `test-installer.mjs` 的冲突用例拆成两条：**只有旧锚点**（旧装机）必须拒绝；
  **两个锚点冲突**时 manifest 说了算，也必须拒绝；`--force` 之后**两个锚点都**变成 direct。
- 端到端：把 manifest 改成 `npm` 后 `--direct` 装拒绝（exit 1）；**再把 `.agent-presets/` 整个删掉，
  仍然拒绝** —— 这正是本次迁移的目的。
- 变异验证：守卫退回"只读旧 marker" ⇒ 运行时那两条断言红（33/35）。

## 2026-09-25 · dsh 0.1.7 适配（P0 preset 断代 + V4 日志选择 + 悬空镜像）

**状态**：P0 与两条 P1 已实施并有回归。完整评估、逐条证据与剩余项见
[`dsh-0.1.7-adaptation.md`](dsh-0.1.7-adaptation.md)。本轮口径：`@deepseek-ai/dsh`
`0.1.5-rc.3` → **`0.1.7-rc.2`**（本机实装），`@linxin666/dsh-web-all` `0.3.20` → **`0.4.2`**。

**为什么这次不能"只补几个字段"**：上游在 0.1.7 把两件**结构性**的东西换掉了 ——
agent preset 的载体，与会话日志的世代命名。前者让侧栏**完全起不来**（不是降级，是新建会话必失败），
后者是**静默**的（读旧日志 ⇒ 新轮次永不落盘，界面一切正常）。

**① P0：preset 从"目录"改成"声明"，而解析锚点不是直觉里的那个位置。**
0.1.7 起 `.agent-presets/` 不再被读（`.agent-presets` / `preset.yml` / `includeUserRoot`
三个字符串在全库 0 命中），preset 变成一条普通 Cordis 行
`name: '@deepseek-ai/dsh-agent-preset'`、`config.plugins` 放组合。落地形状：

- **声明是生成的**：`scripts/build-preset-declaration.mjs` 从 `dsh/preset/agent.cordis.yml`
  + `preset.yml` 生成带标记的 `- insert:` 块，写进**两个通道**的 patch
  （`dsh/cordis.patch.yml` = npm bundle；`dsh/profile/notes-assistant.patch.yml` = Obsidian `--patch`）。
  生成而不是手抄，是因为这等于把组合复制一份；`test: agent preset mounts` 里有一条
  **逐字对比**的漂移断言，手改任一侧就会红。
- **模块铺进 profile 目录**：`dsh/preset/preset-deploy.mjs`（npm 宿主插件与 Obsidian 引导共用）。
  **这是本轮最容易搞错的一点**：相对 `name:` 的锚点是 **profile 目录**，不是声明它的 patch 文件所在目录
  —— 见 handoff §4 陷阱 92（含差分实验与代码依据：registry 的 `register()` 捕获的是服务自己的 ctx）。
- **默认预设行也修了**：`dsh/profile/cordis.patch.yml` 里那条 `- id: agent-presets` 在 0.1.7 上
  **匹配不到任何行**（发行 id 已改为 `agent-preset-registry`，`includeUserRoot` 也随之消失）。
  patch 匹配不到只 warn 并跳过，所以它不仅没配成默认预设，连"这条 patch 存在"都是假象。
  实测判据：`dsh --profile notes-assistant --dump-config` 现在**不再打印**
  `patch: entry "agent-presets" not found`，且 registry 行 `default: notes-assistant` 生效。
- **证**：门禁 `test: agent preset mounts (real dsh)` 由
  `agent-preset/not-found`（`available=["standard","ptc","minimal","cordis"]`）变为
  **`{"ok":true,"value":{"sessionId":"session-probe-…","agentPreset":"notes-assistant"}}`**（16/17 → 17/17；
  剩下那条是"用户真实 home 的工作区表没有临时登记"，属历史残留，见下）。

> **诊断陷阱（已记 handoff 陷阱 93）**：模块解析失败时**看不到** `ERR_MODULE_NOT_FOUND` ——
> loader 的 `_init()` 把 import 异常记进 logger 后直接 return（fiber 不创建），preset 审计只有
> `math-memory (./math-memory.mjs): never started`。所以门禁**不能**锚错误文本，要锚
> `agentPresets/list` 无 `broken` + `session/create` 是否 `ok:true`。

**② P1：V4 日志的权威版本判据（静默数据陈旧）。** 会话格式升到 V4，新文件名
`session.v4.jsonl.zstd`，且迁移**保留旧代**。旧判据是
`/\.v3\./.test(path)` 二选一 ⇒ `isNewerArtifact(v4, v3)` 返回 `false` ⇒ **选旧 V3**。
后果两条：对话索引落后；自动捕获的 `fingerprint`/`lastSeq` 锚在不再写入的 V3 上 ⇒ 新轮次永不落盘。
本机实测当时 **2 个会话目录 v3+v4 并存且 V4 更新**。修法：`artifactGeneration(path)` 取世代号
（无标记 = 0，`.vN.` = N），**先比世代号、mtime 只作同代兜底**；两份实现同步，
并把新符号**钉进** `check-engine-sync.mjs` 的共享清单（23 个符号：17 同步 + 6 有记录的偏离）——
这是照着坑 64（改名即逃出守卫）刻意做的。

> **测试纪律**：新断言**先在旧代码上跑红**（386/391，5 条红），再修，再绿（391/391）。
> 夹具的 mtime 是**故意交叉**的（V4 更新但文件更旧），这样"按世代号"与"按 mtime"不会互相冒充。

**③ P1：`dsh-web-all` 0.4.x 之后的悬空镜像。** 0.4.0 把 `dsh-perf` / `dsh-doctor` / `dsh-skins`
/ `dsh-web-ui-all` 等并入聚合包。而 `syncGlobalPackageLinks` 的镜像循环只遍历 **web 侧现存**的包
⇒ 被删掉的包**永远不会被回头处理**，链接一直指着不存在的目标；`existsSync` 会跟随 junction，
把断链也报成"不存在"，所以这个缺陷长期不可见。本机实测 **9 条**悬空链接。
修法：多一趟**反向**遍历（只删 junction，真实目录与文件一律不碰），新增门禁
`check: mirror cleanup (dangling @linxin666 junctions)`（7 项，**做过变异验证**：去掉第二趟 ⇒ 5/7 红）。

**顺带（非上游变更）**：清掉了本机工作区表里 10 条 2026-09-24 的探针残留
（`scripts/qa/clean-probe-workspaces.mjs --apply`，先写 `.bak`），`test: agent preset mounts`
由 16/17 回到 17/17。**这条断言锚在用户环境数据上**，见到它红先跑一次 dry-run 确认是不是旧垃圾，
**不要**改断言（已补进 handoff 陷阱 91 的补充条）。

**④ 阶段 3 真机验收抓到一个仓库门禁看不见的缺口（已是 handoff 陷阱 94）。** 上面三条做完、
`npm test` 全绿之后，**从现场**（真实 `$DSH_HOME/profiles/notes-assistant`）再验一次仍然
`agent-preset/not-found`：声明在 `cordis.patch.yml` 里，**却不在真正作为 `--patch` 传入的
`notes-assistant.patch.yml` 里**。仓库侧门禁是"自己铺自己验"，证明的是**仓库**对；真机上那份是
安装/引导写出来的，两者可以不一致而不被任何仓库门禁发现。修完把它固化成新门禁
`test: deployed profile accepts a session (real dsh)`（8 项）——从**已部署**的 profile 起隔离副本、
只回填引导会写的东西，再真建一个会话；与 `test: agent preset mounts`（仓库侧）分工互补，两条都绿
才算两条路都对。**教训**：交付"配置类"改动时，必须从现场再验一次，不能只信"从仓库重建"的夹具。

**⑤ B1：补上 dsh 兼容性声明。** 0.1.7 的插件兼容性门禁读 **`peerDependencies`**（不是
`engines.dsh`——这是本轮探针纠正的误解之一），而本仓此前什么都没声明 ⇒ 等于跳过检查。
现在 `peerDependencies["@deepseek-ai/dsh"]` 与 `dsh.engines.dsh` 同时声明 `>=0.1.7-rc.2`
（实际验证过的版本），并在 `check-version-consistency.mjs` 里加了"两者必须一致"的断言
（**变异验证**：把 peerDeps 改成别的范围 ⇒ 该门禁报错）。

**结论**：`node scripts/run-gates.mjs` **45/45**（门禁总数由 43 → 44 → 45）。
本轮**未做**：把 Obsidian 侧插件开关搬到 dsh 插件 `Config`（0.1.7 的 `meta.volatile` 免重载能力）；
客户端包的 `locale/<lang>.json` 多语言标题与 `package.json.icon`；
`decodeZstdSessionLog` / `decodeSessionLog` 的名字统一（双份守卫的盲区）。三项都在
`dsh-0.1.7-adaptation.md` §5/§9 挂着，都不影响可用性。

> ⚠️ **工具纪律（本轮真踩到）**：更新文档计数时我用 PowerShell `Get-Content -Raw` +
> `[IO.File]::WriteAllText` 往返，把 `AGENTS.md` 与 `handoff.md` 的中文整篇变成 mojibake
> ——文件仍是合法 UTF-8，所以**没有任何门禁发现**，是 `git diff` 里满屏 `鈥?` 才暴露的。
> ⇒ **改仓库文本一律用 read/edit/write 工具**；`git diff` 里中文的显示也不可信（控制台编码）。

## 2026-09-25 · 落笔路径自述诊断 + 探针改动了用户持久状态（拖拽仍未完成）

**状态**：拖拽「从文件树拖进输入框」**仍未完成**。本条只记两件当天真正落地的事，接续入口是
[`docs/drag-to-mention-progress-2026-09-25.md`](drag-to-mention-progress-2026-09-25.md)。

**① 落笔路径自述诊断（提交 `9790420`）。** `insertMentionText` 的契约是布尔 —— 插进去了 `true`，
否则 `false`，**没有"为什么"**。于是现场"拖进去没反应"时日志里一个字节都没有，而当天排查正好卡在
这里：SSE 在进程层面完全正常（POST 204 → `data: "路径"`）、页面也确实订阅着、composer 是页面上
**唯一**的 `[contenteditable="true"]`、直调 `__dshMentionInsert` 就能落笔 —— 可草稿是空的。
修法是让**静默的失败分支自述**：

- `describeMentionInsert()` 把落笔拆成可观察步骤（`step` / `ok` / `editable`（可编辑元素个数）/
  `target`（命中的元素）/ `textLen` / `error`）；
- `reportMentionDiagnostic()` 把诊断 fire-and-forget 发回 Obsidian 那侧（`fetch` + `mode:'no-cors'`：
  跨源写、不需要读响应），写进插件日志；
- **每一次落笔都上报**（成功与失败都报）。不留"只在失败时报"：那要先判断返回值，而"处理器到底
  有没有被调用"本身正是最容易丢的一环 —— 当天现场就是它；
- `LinkServer` 新增 `/mention-report`（只用查询参数、白名单字段、逐值截断：这是**页面可控输入**，
  不能往日志里灌任意内容），地址由 `mentionChannelMeta` 作为第二个 meta 注入；
- 服务端补两条**永久留痕**：`/mention-stream` 连接时记**订阅者数量**、`/mention` 收到时**先记订阅者
  数量再推送**。"推给了 0 个订阅者"与"推了但没落笔"此前在日志里长得一模一样，而这两种的修法完全不同。

**② 探针改动了用户的持久状态（我自己造成的，已清）。** `dsh/profile/math-memory-workspace.mjs` 会把
`DSH_WORKSPACE_ROOT` **登记**进 `$DSH_HOME/storages/workspace.json`，而所有 QA 探针都为"不碰真实
vault"用 `mkdtempSync` 造临时 vault 起 dsh ⇒ **每跑一次探针，用户侧栏的「工作区」列表里就多一条**
`C:\Windows\Temp\dsh-*-probe-*/vault`。反复调试那几天累计 **38 条**，列表被同名 `vault` 填满之后
页面会先显示"选择工作区"而不是直接给输入框 —— **看起来像功能坏了**，实际是我弄脏了用户环境。
清理脚本 `scripts/qa/clean-probe-workspaces.mjs`（只删系统临时目录下的登记、先写 `.bak`、默认
dry-run）已入库；教训写进 `docs/handoff.md` §4 陷阱 91。

**③ 一条被误用的观察（陷阱 90）。** 我用"日志里没有诊断行"推断"处理器没执行" —— 而当时线上跑的
客户端包是**旧构建**（页面加载时取的，服务重启前一直是旧的），它**根本没有**那段诊断代码。
**"我没观察到" ≠ "它没发生"**：用一条"还没被部署的代码"的沉默当证据，等于拿空气当证据。
纪律：判定"某段代码有没有被执行"之前，先证明那段代码**在运行的构建里**。

**夹具坑（都表现为"产品像坏了"，实际是夹具缺件，已写进接续文档）**：改写正文的反代必须禁掉上游
压缩（否则 gunzip 纯文本失败、页面永远 `loading`，而 curl/node 自测看不到）；反代必须代理
WebSocket `upgrade`（否则页面停在"重新连接中"）；夹具 vault 要用唯一名字；假 DOM 缺
`querySelectorAll` 会让落笔路径走 `query-threw` 分支造成假红。

**④ dsh 0.1.7 的 preset 断代（环境结果，不是本仓回归）。** 用户机器的 dsh 于当天 10:28 升到
`0.1.7-rc.2`，它**不再读** `$DSH_HOME/.agent-presets/<id>/`（内置技能 `editing-cordis-compositions`
原文：*"Nothing reads that directory any more."*），preset 改为 `@deepseek-ai/dsh-agent-preset` 的
插件行声明。于是 `notes-assistant` preset 认不出来、**会话完全起不来**。判据：门禁
`test: agent preset mounts` 红，且**在纯净 HEAD 上一样红** ⇒ 按 AGENTS.md §4，这是环境结果，
**不要**改断言或文档去"修"。已登记进 handoff §7，用户决定新开会话专门适配。


## 2026-09-21（续）· 拖拽引用的**装配**缺口：包在 `node_modules` 里，却没有任何 loader 挂载它

**用户实测**：「有提示条了，但是松手后文件并没有进对话框」——拖拽被接住了（提示条是 Obsidian 那侧的
落点），但草稿始终为空。**上一节记的是"代码怎么写"，这一节记的是"代码为什么没被加载"**，两者是同一个
功能的两半，而坏掉的是后一半。

**故障区间由插件日志夹死**（`<vault>/.obsidian/plugins/dsh-math-assistant/debug.log`）：

```
[drop] 收到拖拽，解析结果="抄书/最优传输/最优传输2"
[drop] 直插=false
[drop] /mention 响应 204（抄书/最优传输/最优传输2）      ← 连续 5 次，全部如此
```

即：**Obsidian 侧完全正常**（解析对了、服务端也收下了）。断点在"送进页面之后由谁落笔"。

**两个独立成因，缺一都修不好**：

1. **直插那条路结构性不存在**：`insertMentionIntoFrame` 调 `frame.executeJavaScript` —— 那是 Electron
   `<webview>` 的方法，而侧栏里放的是**跨源 `<iframe>`**（`app://obsidian.md` 与 `http://127.0.0.1:3180`
   不同源），没有这个方法 ⇒ 按设计返回 `false`。**日志里的 `直插=false` 是正确行为，不是 bug。**
2. **兜底那条路没有接收方**：`/mention` → SSE `/mention-stream` 那半边要求页面里跑着**客户端的客户端
   半个**（它才 `window.__dshMentionInsert` + 订阅 SSE），而那个包**只躺在 `node_modules` 里，没有任何
   loader 行挂载它**。于是 `pushMention` 每次都落进空队列（`mentionClients.size === 0`）后被挤掉：
   **204 是真的，送达是假的。**

**根因（"装好了"却"没挂上"）**：安装器 `install-into-profile.mjs` 把 loader 行**追加到
`profiles/<profile>/cordis.patch.yml`**。但 Obsidian 插件在**每次启动服务时**都用内嵌副本重写
`notes-assistant.patch.yml`（`obsidian/main.template.js` 的 `buildNotesAssistantPatch`），而启动命令是
`dsh --profile notes-assistant --patch …/notes-assistant.patch.yml` —— **`cordis.patch.yml` 压根不在这条
启动路径上**。两头都错：追加到 A 的行会被覆盖，追加到 B 的行同样会被覆盖。

| # | 谁在说谎 | 真相 |
|---|---|---|
| 1 | 安装器的成功判据 `patch.includes(PKG)` | **子串**检查：证明"文件里出现过包名"，证明不了"有一行 id 挂载了它" |
| 2 | `test-installer.mjs` 的"仓库内容是**前缀**、追加块含包名" | 这条断言**把 bug 写成了期望** —— 等于给故障盖章 |
| 3 | `check-patch-yaml.mjs` 的"id **不冲突**" | 不冲突 ≠ 存在。**只证明了没有撞车，证明不了它在那儿** |
| 4 | `drop-to-mention-e2e.mjs` 那条"该 profile 自己加载了客户端半个" | 探针起实例时**没传 `--patch`** ⇒ 那台 profile 本来就不加载它 ⇒ **长期为红，等于没有断言**（同族：坑 56/59/69） |

**修法与纪律**：
1. **那一行必须是发布物的一部分**：写进权威源 `dsh/profile/notes-assistant.patch.yml`（由 build 内嵌进
   `main.js`，每次启动重写时自然带上）。**"安装期写文件 + 运行期重写同一文件"的地方，必须先问谁是权威。**
2. 安装器只做"**装包 + 校验行在**"，不再往任何 patch 文件写行；并把 `OVERLAY_FILE` 作为唯一权威写进注释。
3. 门禁从"不冲突"改成**"恰好出现一次"**：零次＝静默失效，两次＝`duplicate loader entry id`（整个 profile
   起不来）。**变异验证两种红都做过**（删行 → 红；在另一层加同 id → 红），恢复后 20/20。
4. `test-installer.mjs` 的"前缀"断言**删除**，改为"`cordis.patch.yml` 也必须逐字节等于仓库源"（它不再是
   例外）+ 断言 overlay 里真的解析出那一行、且 `name` 指向安装器会装的包、且该 id 全 profile 只出现一次。
5. 探针改为照抄插件真实启动参数（含 `--patch`），于是 `present:true, handlers:5` 第一次由探针自己验到，
   端到端 **14/14**。
6. **判据要锚在结构上，不要锚在子串上**："装好了"必须由"能解析出一行 id、且它指向的包确实存在"来证。

**为什么这条值得单独记**：拖拽功能**每一段代码都测过、每一段也都是对的**（载荷解析、合成 paste、SSE、
CSRF、门禁），坏的是**装配** —— 而装配恰好落在"安装器"与"插件每次启动重写 overlay"这两个各自都很合理的
设计的**接缝**上。**"装进 profile"不等于"界面里加载了它"。** 已记进 `docs/handoff.md` §4 陷阱 89。


## 2026-09-21 · 拖拽引用落地：从 Obsidian 文件树拖一篇笔记进输入框

**用户诉求**（原话）：「我就是希望能够从 Obsidian 左侧的文件夹中拖拽文件到 dsh 对话框里」。
规格与落地记录在 `docs/drag-drop-design-2026-09-21.md`；这里只记**为什么这么实现、以及验证是怎么被
自己的夹具骗了三次**。

**链路**：文件树拖拽 → 跨源 iframe 内 `document` 的 `drop` → 解析
`obsidian://open?vault=…&file=<库内路径>` → 在 composer 上派发一次**合成 `paste`**（文本
`@库内路径 `）→ 宿主自己的 paste 处理器插到光标处。

**为什么用合成 paste，而不是官方 `SessionInput.setDraft`**：
`setDraft` 需要**会话作用域的 ctx 或会话 id**（客户端根上下文里没有"当前会话"的公开读法），
而且它**整体替换**草稿 —— 用户拖进来时草稿里往往已经有半句话。而 dsh 的 composer 自己注册了
paste 处理器（`dsh-client-ui-conversation/lib/client.js:15259-15273` 读
`clipboardData.getData("text/plain")` 再走 `pasteText`），于是"把文本递给宿主、让宿主决定插到哪儿"
改动面最小。代价：**它依赖宿主行为而非公开契约** ⇒ 由端到端探针钉住（下面第 2 条）。

**验证的三层 + 两次变异**：
1. 零 token 回归 `test-drop-mention.mjs`（**47 项**，新门禁 `test: drop-to-mention`）：
   **用宿主的 ModuleLoader 协议求值真产物**（`lib/client.js`），再驱动它产出的真处理器。
   变异验证两次：去掉 `//` 空段拒绝 → 红；去掉 `drop` 的 `preventDefault` → 红。
2. 端到端探针 `scripts/qa/drop-to-mention-e2e.mjs`（**9/9**）：独立 dsh + headless 浏览器，
   CDP `Input.dispatchDragEvent` 投递**与实测一致的载荷** → 断言草稿里出现 `@库内路径`。
3. 接缝探针 `scripts/qa/composer-drop-probe.mjs`（7/7）：输入框是 Lexical `contenteditable`、
   `document` 冒泡阶段收得到 drop、合成 paste 能落进草稿。

**客户端半个的安装路径（同日补上，否则前端功能等于没装；过程中把用户侧栏搞挂过两次）**：本功能
（以及记忆面板的 Settings 面板）在 **dsh web 客户端半个插件**里，而它此前**只被装进 `web` profile**
—— Obsidian 侧栏跑的 `notes-assistant` profile 只有宿主半个 ⇒ **侧栏里根本不会加载它**。这正是
"代码对、测试绿、用户却用不上"的典型形态。修法：`dsh/client-panel/install-into-profile.mjs` 把安装
逻辑抽成导出函数 `installClientIntoProfile()`（CLI 行为不变），`dsh/install.mjs` 的 `--direct` 分支
装完 profile 后调用它（幂等），`scripts/deploy-local.mjs` 走的正是这条安装器路径；
`commandInstall`/`directInstallProfile`/`main` 因此改为 `async`。

**但这一步连撞两个 cordis 硬失败，用户的侧栏真的起不来了**（报错原文：
`dsh: plugin tree failed to load: … duplicate loader entry id: math-memory-panel`，随后还有
`webserver: duplicate prefix route "/memory-panel"`）：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `duplicate loader entry id: math-memory-panel` | 插入行 id 用了 `math-memory-panel`，而 `notes-assistant.patch.yml` 里**已经**有一个同 id 的宿主半个 —— 两个 patch 层各插一个同 id | 插入 id 改为 `math-memory-client-panel`；安装**前**扫全部 `*.yml` 查 id 冲突，冲突即中止且**不写任何文件**；门禁 `check-patch-yaml` 断言该 id 不与任何已发布行 id 冲突（做过变异验证） |
| 2 | `webserver: duplicate prefix route "/memory-panel"` | 包的 `index.mjs` 用的是 `host/math-memory-panel.mjs` —— **正是注册路由的那个模块**；而 profile 里已有独立宿主半个 ⇒ 两个条目注册同一前缀 | **profile 已有独立宿主半个时，本包的宿主半写成空实现**，只交付客户端半个；没有独立宿主半个的 profile（如 `web`）才用真宿主 `host/index.mjs` |

**教训**：`id` 与**路由前缀**是跨文件、跨 patch 层共享的命名空间，而这两个风险此前**没有任何东西**
在写之前检查。现在安装时（`findIdOwners`）与门禁里（`check-patch-yaml`）各有一份检查，且都在**写之前**。
另一条：**"文件里多了几行"与"整个应用起不来"之间只隔一个命名冲突**，所以这类改动必须**真的启动一次**
才算验证过 —— `test-installer.mjs` 因此补了"安装后 row id 唯一"的断言，`drop-to-mention-e2e.mjs`
补了"profile 自己加载了客户端半个"的直接判据。

**元教训：这一轮的"红"几乎全是探针自己造的（三次）。** 写得清楚，因为每一种都会让一个**正确**的
实现看起来坏掉，而人的第一反应是去改产品：
- **假 DOM 的 `createElement` 每次返回新元素** ⇒ 安装器 `querySelector` 找到的落点与探针观察的
  不是同一个节点，paste 派发到了没人看的地方 → 症状"产品没递数据"。
- **`DataTransfer` 替身缺 `getData`** ⇒ 断言读到 `getData is not a function` → 症状同前。
- **断言看的是外层数组，而实现递的是事件** ⇒ 数组当然是空的。

**AST 切片的三个坑**（要跑"仓库那份产物"就得从压缩代码里取片段，宿主没给 react 的读取通道）：
1. **自己写括号配平不可行**：压缩后的正则字符类 `[\u0000-\u001f\u007f-\u009f"]` 里的 `"]` 被当成
   字符串收尾，配平直接失衡。改用 **acorn 解析 + 按节点范围切片**。
2. **按"标记名字符串"找安装器永远找不到**：`"__dshMathMemoryDropMention"` 在产物里只出现一次
   （`var j="…"`），安装器体内用的是**变量名**（`s[j]`）。改为按**导出表**定位
   （`installComposerDropMention: () => N`）——语义锚点，不随压缩改名。
3. **正则扫"引用名"会把 `\u0000` 转义当成名字 `u`**，于是去外面找别人函数体里的
   `let u = await fetch(…)` 并当作声明抽出来，报错是 `missing ) after argument list`。
   改为由 **AST 收集 `Identifier`**，并排除属性名/键/参数/局部声明。

**刻意不做**（写进 `handoff.md` §7）：多选拖拽、文件夹、编辑器里选中文字 —— 这三种载荷形态
**没有实测**。载荷认不出来时**什么都不做**（不是"猜一个"），因为猜错会往提示词里塞一个指向
可能越界路径的 `@` 引用（`@` 是接受绝对路径的）。

## 2026-09-21 · 一行被注释吞掉的 YAML，让整个 profile 起不来——而 41 条门禁全绿

**怎么发现的（这一节的价值全在"发现方式"上）**：本轮为回答用户"你部署了吗"而跑了
`node scripts/deploy-local.mjs`，之后**顺手**重跑门禁做确认，发现 `test: agent preset mounts`
从绿转红。手工启动 dsh 读它的 stderr，拿到真因：

```
Error: dsh: failed to parse overlay C:\Users\…\.dsh\profiles\notes-assistant\cordis.patch.yml:
YAMLException: end of the stream or a document separator is expected (16:1)
  16 | - id: sandbox-policy
```

`dsh/profile/cordis.patch.yml` 的**第一行与上一条注释拼在了同一行**：

```yaml
# …plus the cross-session memory plugin.- id: agent-presets
```

那一行因此**整体是注释** ⇒ 顶层序列从未开始 ⇒ 后面第一个裸 `- id:` 就是语法错误。
真 dsh 会**拒绝启动整个 `notes-assistant` profile**——Obsidian 侧栏、`dsh --profile notes-assistant`、
以及依赖它的门禁全部一起坏掉。

**为什么 41 条门禁没发现它（三种失效叠在一起）**：
1. 除 preset 门禁外，**所有门禁都把这些文件当文本读**。`test-preset-sync.mjs` 逐字节比对两份
   拷贝——而被改坏的行仍然是**完全合法的文本**，两份还**一模一样**，所以它比得越严格越是绿的;
2. 唯一会发现的 preset 门禁靠**真的启动一个 dsh**，而它需要写 `$DSH_HOME`：在受限环境里它会
   先因"写不了"失败（或 SKIP）⇒ **恰好在看不到真相的环境里，这个 YAML 错误是不可见的**；
3. `check-embedded-*` 系列校验的是**嵌入**（`main.js` 里那份），不是 profile 目录里那份。

**改动**：
1. 修好那一行（并在源文件里写下"这个空行不是装饰"的注释，免得下次又被合并掉）。
2. **新增门禁 `scripts/check-patch-yaml.mjs`**：对随包发出的 5 个 YAML **真的解析**，并断言——
   解析通过；`*.patch.yml` / `*.cordis.yml` 顶层是**op 序列**；每个 op 带 `id` 或 `insert`；
   以及**直接断言那条陷阱**（没有注释行吞掉一个 `- id:`）。它不需要 dsh、不需要子进程、不需要
   可写状态 ⇒ 在**boot 门禁跑不动的环境里它照样有效**，这正是补上缺口的关键。
   `!!js` 是 dsh 自己的标量标签，解析前按结构等价地剥掉（不为它仿造 schema）。
3. 门禁数 41 → **42**；`AGENTS.md` §4 的计数同步（由 `check-doc-counts.mjs` 守着）。
4. 新增 `js-yaml` 为 devDependency（只给这条门禁用）。

**验证**：`node scripts/check-patch-yaml.mjs` **15/15**；修好后
`node scripts/run-gates.mjs --only "agent preset"` **10/10**（真 dsh 又能启动了）；
全量门禁 **42/42**。这条门禁对"第一行被注释吞掉"是**承重**的——`.md` 之外唯一会报错的就是它
（变异形态见下：把源文件那一行改回去 → 该门禁立刻红）。

## 2026-09-21 · 拖拽引用的两个前提：实测掉了（载荷形态 + 跨源 iframe 收不收得到）

**起因**：评估文档把「Obsidian 拖拽的 `dataTransfer` 形态」和「跨源 iframe 里的 drop 监听收不收得到」
都列为**未验证的前提**。用户直接问「你能不能自动实测」。能——本轮补了两个探针，两条前提都成了实测。

**A. 载荷真值**（`scripts/qa/drag-payload-probe.mjs`）。

不猜的做法：启动一个**隔离**的 Obsidian（独立 `--user-data-dir` + 临时 vault，不碰用户实例），
用 CDP 的 `Input.setInterceptDrags` 拦下 Chromium **真实**的 `DragData`——那是页面在 `dragstart`
里 `setData()` 之后、投递之前的真值，而不是我们伪造的 `DataTransfer`。结果：

```
文件树拖一篇笔记：
  dragOperationsMask: -1
  mime="text/plain"     data="obsidian://open?vault=vault&file=%E6%A0%B9%E7%AC%94%E8%AE%B0"
  mime="text/uri-list"  data="obsidian://open?vault=vault&file=%E6%A0%B9%E7%AC%94%E8%AE%B0"
```

⇒ 不是 vault 相对路径，是 **`obsidian://open?vault=…&file=<URL 编码的库内路径>`**，两个 MIME 同值。

**B. 跨源 iframe 收不收得到**（`scripts/qa/iframe-drop-probe.mjs`）。三个临时 HTTP 服务做**真跨源**
（源 / 宿主 / 目标 iframe 各一个端口），用 `Input.dispatchDragEvent` 把 A 的同款载荷分别投给
**同源对照区**与**跨源 iframe**：

```
[ok] 对照：宿主文档收到了 drop            hostDrops=1 dragenters=1
[ok] 跨源 iframe 的 drop 监听收到了 drop   drops=1
[ok] 跨源 iframe 能读到 dataTransfer 内容  text="obsidian://open?vault=vault&file=…"
__CHECKS__ 4/4  结论：路径 A 可行，不需要透明遮罩。
```

**探针自己踩的三个坑（每个都会让结论反过来，所以都写进文件注释了）**：
1. **同源夹具会证明一个不存在的场景是对的** ⇒ 三个角色必须三个端口（与坑 85 同族）。
2. **一次拖拽只能在一个 CDP target 的输入管线里完成** ⇒ 第一版把"源"放在另一个 tab，
   结果连**同源对照**都没收到 drop（0 事件）。差一点就把这个 0 读成"跨源 iframe 不行"——
   **对照失败时结论无效**这条纪律救了它。
3. **父页面读不到跨源 iframe 的内部状态**（实测 `SecurityError: Blocked a frame …`）⇒ 目标 iframe
   改用 `postMessage` 回报；顺带一个事实：`Input.setInterceptDrags` 不是"观察并放行"，它会**暂停**
   拖拽，必须用 `Input.dispatchDragEvent` 续上，否则投递根本不会发生。

**仍未实测**：**文件夹**与**编辑器里选中文字**两种拖拽（前者要先把文件夹展开、后者要真实鼠标
划选，探针里都没跑通）。按同一条 `dragstart` 处理器推测同形，已在 `handoff.md` §7 标注为待测，
并要求实现时把"解不出 `file=` 的拖拽"当作忽略而不是异常。

**结论对实现的影响**：路径从"遮罩 + 回环"收敛为**一条**——在 dsh 客户端插件里挂 document 级
`drop` 监听，从 `text/plain` 解出 `file=`，`setDraft('@' + 库内路径)`。本轮**只登记不改代码**。

**顺带**：本轮把两项改动部署进了用户本机 vault（`node scripts/deploy-local.mjs`）——此前
部署副本是 2026-09-20 的旧构建，**不包含**本轮的 `/open` 分流与协议模板。部署后逐字节比对通过，
但**运行中的 Obsidian 与 dsh 服务需要重载/重启才会用上**。

## 2026-09-21 · 回复里的记忆引用点不开：两处根因，一处从未登记

**起因**：用户问「dsh 回复里引用了它自己记忆库里的东西，似乎无法在 Obsidian 中打开查看」。取证后确认这不是一个 bug，而是**两个独立缺口叠在一起**，而且第二个从未被登记、也**不可能被现有测试发现**。

**根因 ①（缺陷）：`/open` 把 `.deepseek/**` 交给了对它无效的 API。**

`obsidian/main.template.js` 的 `/open` 分支无条件执行 `app.workspace.openLinkText(notePath, '', openInNewPane)`。而 Obsidian 的 vault 索引**排除所有以 `.` 开头的路径段**——插件自己在 `MemoryPreviewModal` 的注释里早就写明了这条（「so .deepseek files cannot be opened through openLinkText or any TFile-based API」），`/feedback` 也早就绕开了（面板走 node `fs` 直读 + 预览 Modal），**只有 `/open` 没有**。真实症状记在 `docs/changelog.md` 另一处：「点击会变成"创建文件"→ `Folder already exists`」。而且失败**全程静默**：注入的拦截脚本把点击改成 `fetch(...).catch(function(){})`，`/open` 成功也只回 204。

**根因 ②（缺口）：协议层从没给记忆卡一个「可打开」的链接模板。**

注入里的链接模板只教了「引用**笔记**用 `/open`」；对**记忆卡**只给了 `/feedback`（✅/❌）与验证徽标。于是模型引用卡时只有两条路，两条都不通：
- 写纯文本/反引号路径 → dsh 前端不可点（`chatFileMentions` 只收录本轮 `write`/`edit` 成功产出的路径 + `present` 申报，只读出来的卡永远不进词表）；
- 把笔记规则推广成 `/open?path=.deepseek/…` → 撞上根因 ①，静默失效。
后者比前者更糟：**看起来可点**。

**为什么长期潜伏（两条都要记）**：
1. `docs/handoff.md` §7（唯一权威未做清单）**没有这一条**——它是未登记的缺口；
2. `scripts/test-link-server.mjs` 的 `/open` 用例**全部只用普通笔记路径**，而假 workspace 的 `openLinkText` 是一个**永远成功的桩**，`.deepseek` 只出现在 `/feedback` 用例里 ⇒ 这个缺陷在该套件里**结构上不可能被发现**（与本仓库坑 69「守卫 exit 0 不代表它比过」、坑 81「断言在变异下照样通过」同族）。

**改动**（`obsidian/main.template.js` + `dsh/preset/math-memory.mjs` + `vault-AGENTS.md`）：

1. **抽出 `normalizeVaultRelPath`**，`/open` 与 `/feedback` 共用。它原来是 `/feedback` 的行内逻辑，两条路由各写一份正是它们此前漂移的形态。顺带修掉一个**判断对象错误**：`..` 原来在**规范化之前**的字符串上判，于是 `a/../b.md` 被当成"段里没有 `..`"放行——检查的路径与实际解析的路径不是同一个。
2. **`/open` 对 `.deepseek/` 前缀分流**到 `plugin.openMemoryPreview(rel)`（与记忆面板点卡片**同一个 Modal**）。分派只认这个前缀：索引内的普通笔记保持"在编辑器里打开"的既有语义，不让 `/open` 变成一个语义含糊的万能入口。文件不存在时回 **404**（不再静默）。
3. **预览能力搬到插件上**（`DshObsidianMathPlugin.openMemoryPreview`）。原因是结构性的：`LinkServer` 够不到 `MemoryView` 实例（面板是用户打开时才创建的），而把读取逻辑在 `LinkServer` 里复制一份，就是把「隐藏文件只能 node fs 直读」这条规则变成两份——正是根因 ① 的成因本身。`MemoryView.openNote` 保留为面板入口（留住"保存后重渲染"的行为）并补上同一条路径校验。
4. **协议补上卡的 `/open` 模板**：系统提示与 `vault-AGENTS.md` 各加一句「卡标题也写成可点击链接」，并要求末尾反馈行里的卡标题用链接而不是纯文本。顺手统一了 `vault-AGENTS.md` 里互相打岔的两句（回复正文用 `/open` vs 写进文件用 `[[wikilink]]`）——现在写成一条「两种场合不要混用」。

**验证与覆盖范围**：
- `test-link-server.mjs` 新增 **6 项**（§④b，共 22 → 28 项）：记忆卡 `/open` → 204；**走插件预览而不是 `openLinkText`**；`openLinkText` 没有被 `.deepseek` 路径碰到；不存在的卡 → 404；`.deepseek/../../etc/passwd` 被拒且**没有真的去开文件**；普通笔记的穿越也被同一条规则拦住。
- **夹具加固（这是本轮的元教训）**：假 workspace 的 `openLinkText` 从「永远成功」改成**对 `.deepseek` 路径留痕**，`existsSync` 从恒真改成**真查磁盘**（并为此建一个用完即删的真夹具文件），`pathInside` 从恒真换成真实现。理由：**夹具在证明一个不存在的场景是对的**——它此前正是这样放走了根因 ①。
- **变异验证**：把 `/open` 的 `.deepseek` 分派去掉（`if (false && …)`）→ 3 项立刻红，失败信息里直接打出 `{"path":".deepseek/…","impossible":true}`，即"它确实把记忆卡交给了那个对它无效的 API"。
- `test-memory.mjs` 新增 **2 项**（卡 `/open` 模板存在、反馈行要求用链接），共 384 → 386 项。

**刻意没做**：不动 dsh 前端、不给 `notes-assistant` preset 挂 `present`。理由：`present` 的定义是「交付本轮**产出**」，把"读过的卡"申报成交付会污染每个 turn 的 deliverables 行，而且它打开的是 dsh 右栏预览而**不是 Obsidian**——与用户诉求不符。完整的方案对比与三处否决见 `docs/design-intake-2026-09-21.md` §2.2/§3。

## 2026-09-21 · 注入的截断方向是反的：最新的内容先被砍掉

**起因**：用户问「记忆系统的上下文注入是怎么做的，能不能专门优化」。取证时顺手量了一下真实输入，结果与预期相反：**这个缺陷有两个独立成因，而且现有测试结构上不可能发现它。**

**实测（零 token，直调 `buildMemorySection`）**：

用 `scripts/qa/benchmark-vault` 作输入时，整段注入 **4088 字符，一条截断都没有**：

```
 1366 (header)      456 捕获策略    295 画像      196 记号
  431 主题索引        216 记录摘要    183 模板索引   117 事件时间线
   63 备忘录         314 工作记忆
```

也就是说：**本仓库所有夹具都远低于各自预算，`clip()` 从不触发**。靠现有夹具永远测不到截断行为——这正是这个缺陷能长期潜伏的原因。

构造「增长型」夹具（与真实写入协议一致：最旧在前、最新在后）后立刻现形：

| 夹具 | 结果 |
|---|---|
| `records/index.md` 40 条索引行（1452 字符，预算 800） | 保住了 `rec-1`（最旧），**丢掉了 `rec-40`（最新）** |
| `topics/index.md` 5033 字符（头为 alpha、尾为 omega） | 保住了 `alpha`，**丢掉了 `omega`** |

**两个成因**：

1. **`clip()` 只保头部。** 这对本系统的每一个被注入文件都是错的方向：vault 是 append-only 的（新的写在文件下方），所以**尾部才是自上次读取以来唯一变化的部分**；而头部是定义性的（身份、记号约定），也不能丢。只保一侧必然是另一侧的静默丢失。标记还只写「全文 N 字符」，读者知道缺了东西，但**不知道缺了多少**。
2. **三个 append-only 层索引有两份各自为政的实现。** `episodeIndexDigest` 一直保尾部（对），而 `recordIndexDigest` / `templateIndexDigest` 把头部的行拼起来再 `clip`（错）。同一个规则写三遍，两份是对的、一份是错的——这正是「共享助手用同一个名字」那条纪律要防的形态（坑 64 的同族）。

**改动**（`dsh/preset/math-memory.mjs` + 回归）：

1. `clip()` 改为**头 + 显式标记 + 尾**，标记写出**被略去的字符数**与原文总长（`省略 M 字符，全文 N 字符`）。ASCII 边界才回退到词边界——数学 vault 正文以 CJK 为主，那里没有词边界，裁了就是从词中间咬掉几个字，正是这条标记要防的「读起来像完整证据的残片」。
2. 三个摘要器合并为一个 `appendOnlyIndexDigest`（按行保尾部），`episodeIndexDigest` / `recordIndexDigest` / `templateIndexDigest` 都调它。
3. **`notation` 预算进 `BUDGET_TIERS`**：它此前是读取点上的硬编码 800（`:3716`），于是档位旋钮**管不到它**——一个声称给「记忆段」定尺寸的旋钮，却有一个段不归它管。`standard` 仍是 **800**（选择档位不得改变不选档位者的行为）。

**验证与覆盖范围**：① 新断言成对写「**头**存活」与「**尾**存活」——只保一侧即红；② 端到端用 40 行的 records/templates 索引断言「保最新、弃最旧」；③ notation 真按档位变化（`compact` 段 < `rich` 段）+ 超预算时自报截断；④ **两次变异验证都做过**：把 `appendOnlyIndexDigest` 改回 `clip(join)` → 2 项红；把 `clip` 改回头截断 → 「TAIL survives」红（这两条正是要防的形态）。零 token 回归 **376 → 384**。

**顺带修掉一个会把正确报告判红的断言**：`test-memory.mjs` 的 `audit: report bounded` 原本断言 `report.length <= 1200`，而被截断的报告长度 = 内容 + 标记；标记变长 12 个字符就会让**内容一字未变**的报告报红。改为断言**被保留的内容** ≤ 1200，并在失败信息里同时打出两者。

**刻意没做**：不动注入**结构**（把增长型索引从逐轮注入挪走、按 query 注入 top-k）。方向认可，但它改的是注入语义，需要先量真实 vault 的逐段长度与命中率——先修纯缺陷（本次），结构问题另起一轮。

**记录**：`docs/memory/design.md` §3/§3.1 同步（含「为什么两端都保」与实测数字）；未做清单新增三条（`working.md` 的 500 上限、拖拽引用、`CHANGELOG.md:230` 与当前前端不符），见 `docs/handoff.md` §7。

## 2026-09-20 · `note_search` 退役：它和 `note_recall`、grep 都重复

**起因**：用户读了上一节的改动后问——「grep 是不是和 note_search 工具重复了」。这是个该被问的问题：如果 grep 与 `note_search` 重复，那上一节把 grep 降为"核对工具"就等于**留下一半的重复没处理**。

**核对（读代码，不凭印象）**：

| 能力 | `note_search` | `note_recall` | grep |
|---|---|---|---|
| tag 过滤 | 有 | **同一套实现**（`noteTags` / `matchesTagFilter`，含 `math/analysis` 嵌套匹配） | 做不到 |
| 文本查找 | 字面子串（不排序） | BM25 排序 | 正则/字面，任意文件 |
| 语料 | 仅用户笔记（刻意排除 `.deepseek`） | 笔记 + 全部记忆层 | 任意文件/目录 |
| 只按 tag 枚举 | **可以**（`query` 可省） | **原先不行**（`query` 必填） | 做不到 |

⇒ 结论：重复是真的，而且是**两边都重复**——tag 过滤与 `note_recall` 完全重合，字面文本查找与 grep 重合。它唯一不可替代的能力是「只按 tag 枚举」。

**更关键的一处历史事实（这决定了处置方式）**：`docs/memory/retrieval-v3.md` §5 原本就写着迁移方案——「**search 取代 note_search 与 note_retrieve 的查询职责**」，§6 的 S3 也把 `note_retrieve` 标成「已退役」。也就是说 **`note_search` 当初就是要退役的**，只是它的"查询职责"迁进了 `note_recall`、**工具本身没被摘掉**，于是 vault 里同时留着三个"找东西"的入口（`note_recall` / `note_search` / grep）。上一节的 grep 问题与这一节是同一个病根的两面：**同一件事有多个入口，模型就会自己挑**。

**真实用法佐证它没在被当回事用**：本机真实 vault 会话里 `note_search` 共 15 次调用，**15 次都带 `query`、0 次只按 tag**。它实际被当成"低精度的字面子串搜索"在用——而 `note_recall` 是 BM25 排序，字面命中反而更弱（`docs/memory/assessment.md` §5 早就记过"纯子串对 LaTeX/中文同义改写命中差"）。

**改动**：

1. **`note_recall` 新增 tag-only 枚举模式**（承接 `note_search` 唯一不可替代的能力）：`query` 改为可选，**只给 `tag` 不给 `query`** ⇒ `rankRecallDocuments` 走枚举分支——不评分、不算 coverage，按 frontmatter `updated` 降序（无日期排最后，并列按路径字典序稳定排序），`mode: "enumeration"`、`score: 0`、`coverage: 0`。渲染时**不打印 score、`覆盖:—（枚举模式不计分）`**，并在结果头写明"这是枚举不是相关性排序，需要找相关内容请带 query 再检索"——**不能让它看起来像一次排序检索**。枚举模式**不做适用边界门控**（那套判据依赖查询词），也**不写 hook 命中统计**（枚举不是"为某个查询取回了卡"）。
2. **摘掉 `note_search` 的注册**（不保留同名壳工具；老会话/旧基线里的历史记录不需要兼容），原位留下一段注记说明"为什么退役、验过什么、替代路径是什么"。
3. 同步：`vault-AGENTS.md`（§0 工具清单与分工、§5 路由表"精确 tag 过滤"行）、`math-memory.mjs`/`agent.cordis.yml`/`cordis.patch.yml`/`preset.yml` 的注释与描述、两个 README 的"检索"与"安全/工具面"两节、`design.md`（检索路由 + 工具面计数）、`ARCHITECTURE.md` §2 文件地图、`handoff.md` §2 文件地图、`scripts/fixtures/tool-outputs.json`（删 `note_search` 两项、给 `note_recall` 补一条枚举 fixture）。
4. `main.js` 重建（未改版本号）。

**验证与覆盖范围**：① 用一个只调真管线的临时探针跑枚举分支：3 篇带 `math/analysis` 的笔记 → 顺序为 `updated` 降序（09-19 → 01-05 → 无日期）、无日期的排最后、`.deepseek/memory/records/*.md` **不出现**（枚举只返回 `kind: "note"`）、嵌套 tag `math/analysis` 同样命中 3 篇、带 `query`+`tag` 时仍是排序检索且 tag 仍限制语料——**这条是变异可验的**：去掉枚举分支，同样的输入会按语料顺序返回并给出伪造的 score/coverage。② 枚举请求在 `query` 为空时**必须报错**（工具边界保留 `provide query, tag, or both`）。③ `test-tool-schemas` 22/22、`test-tool-shape` 11/11（工具数从源码自动发现，删工具后 fixture 与 schema 同步一致）。④ `check-doc-constants` 由红转绿——它自己报出三处"claims 5 note tools, but registers 4"，我按它指的位置逐条改（这正是"锚点在代码、不在记忆"的价值）。⑤ `npm test` 见下节记录。

**刻意没做**：① 不给枚举模式加 `operator`/`kind` 之类的额外过滤参数（用不上就先不加，`operator` 目前只在评分路径里被消费）；② 不把 grep 从工具面摘掉——它仍能干 tag 覆盖不到的事（非 markdown、点目录、`.deepseek` 深层、正则），只是被限制在"已知文件后核对"这一种用法；③ 不动 `scripts/qa/benchmark-vault/vault-AGENTS.md`（**冻结基准语料**，仍需一次有意的刷新 + 新 baseline）。

**验证与覆盖范围**：① 用一个只调真管线的临时探针跑枚举分支：3 篇带 `math/analysis` 的笔记 → 顺序为 `updated` 降序（09-19 → 01-05 → 无日期）、无日期排最后、`.deepseek/memory/records/*.md` **不出现**（枚举只返回 `kind: "note"`）、嵌套 tag `math/analysis` 同样命中 3 篇、带 `query`+`tag` 时仍是排序检索且 tag 仍限制语料——**这条是变异可验的**：去掉枚举分支，同样的输入会按语料顺序返回并给出伪造的 score/coverage。② 枚举模式在 `query` 为空、`tag` 也为空时**仍然报错**（工具边界保留 `provide query, tag, or both`）。③ `test-tool-schemas` 22/22、`test-tool-shape` 11/11（工具数从源码自动发现，删工具后 fixture 与 schema 同步一致）。④ `check-doc-constants` 由红转绿——它自己报出三处「claims 5 note tools, but registers 4」，按它指的位置逐条改（这正是"锚点在代码、不在记忆"的价值）；`check-readme-pair` 也红了一次并指出**两侧 README 都被改过**，确认结构对齐（14 节 / 29 条目 / 3 围栏一致）后 `--write` 重新记录。⑤ `npm test` = **39/41**，两条红是**与本次无关的环境结果**：`link server`（无头浏览器 CDP `timeout Page.enable`）与 `agent preset mounts`（dsh 未打印带 token 的启动地址）——上一节已用 A/B 基线证过它们在 HEAD 上同样红。⑥ 零 token 探针：`npm run qa` 的 seed-probe **8/8**；真实 vault 的 engine-probe **11/12**，唯一红项「定理索引命中」是**既有的 vault 漂移**（`git stash` 后在 HEAD 上复现同一红：期望 `.deepseek/memory/theorems/index.md`，而该文件不在真实 vault 里——探针的 ground truth 绑定本机 vault，需随 vault 变化维护，见 `retrieval-v3.md` §6 末）。未跑 `qa:e2e`（烧 token，按纪律先问用户）。

**记录**：新增 `docs/handoff.md` 陷阱 83（"迁移只迁职责、没摘旧工具 ⇒ 一个能力多个入口"）与 84（"冻结 fixture 不能顺手同步"），陷阱条数 82 → **84**；`AGENTS.md` §1/§6 两处引用由 `check-doc-counts` 逼着一起改——它当场报出「claims 82 traps, but §4 holds 84」。

## 2026-09-20 · 检索分工写死：grep 从「备用检索」降为「已定位文件的字面核对」

**起因**：用户观察——「笔记助手模式有时候还是会调用 grep，它不应该只调用 `note_recall` 吗？毕竟这个专门做了 BM25 等优化」。要判断这是"模型不听话"还是"协议就是这么写的"，所以先去读**真实会话日志**再动手。

**排查（只读真实 vault 会话日志）**：**32 个会话**出现过检索类工具调用（`note_recall` 25 次、`note_search` 16 次、**grep 50 次**，其中 14 个会话用过 grep；样本含探针/基准残留会话，按会话去重、v2/v3 双份日志只取 v3）。关键结论有三条，都推翻了"grep 在抢答"的直觉：

1. **近期没有一场是 grep 起手的**。8 场"grep 先于一切检索工具"的会话**全部是 2026-08-15/16 的**——那时 `note_recall` 统一入口尚未上线（检索 v3 之前），所以那不是当前形态的回归。最近的会话（09-07 起）形态固定为「`note_recall` → 读命中 → **grep 按正则/行号在已知文件或已知层里定位**」：例如 09-16 那场先 `note_search` 命中了目标文件，再 grep 该文件里的具体句子。
2. **一次真实的空转出现在 2026-09-20**：查询「高维空间距离集中 欧氏距离失效 最近邻 相对对比度 维数灾难 concentration of distances」→ `note_recall` 返回 15 条，**排第一的就是正确笔记**（`1备忘录合集/待整理或扩展杂记.md`，score 0.902），但**15 条的 coverage 全 < 0.35**，于是工具在结果头上写「15 条 coverage<0.35 属弱信号，多为词面巧合」，模型据此判定"弱命中"，接着用 grep 扫了三遍（`.deepseek` → episodes → 该笔记）。
3. **根因是"协议与工具描述在多个位置暗示 grep 也是检索路径"**，不是模型无视纪律：`AGENTS.md` 路由表有两行直接写「grep `memory/episodes/`」「`note_recall` + grep episodes/records」，§0 只说"能用 `note_recall` 不用裸 grep"（暗示 grep 可用）；`math-memory.mjs` 每轮的注入段里同样有「先 grep episodes/」「再 grep 笔记全文」「细节请 grep episodes」；`note-tools.mjs` 的系统提示段写着「ordinary file read/write/edit/glob/grep … keep using the generic file tools」，`note_search` 的 description 还写着「use grep/read for memory files」。

**改动（A 方案：收紧协议 + 改工具描述，检索实现不动）**：

1. `dsh/templates/vault-AGENTS.md`：§0 新增一条**写死的分工**——「找内容 = `note_recall`（方法层再叠 `note_strategy`），是唯一的内容发现入口；**grep 不是检索器**，只在『已定位到某个文件之后』核对该文件的**原话/字面字符串/行号**；**禁止**用 grep/glob 对 vault 或 `.deepseek` 做全库扫描找内容（既慢又漏——grep 默认跳过点目录——且绕开 hook 加权、coverage、验证等级、适用边界这些只有 `note_recall` 才有的信号）；一次没搜到不要马上换 grep，先按 §5 改写查询重试一次。」§1 会话开始处补一句同向提示；§5 路由表两行改写（精确事实/用户原话 → `note_recall` 先定位再读命中，**确认某文件里是否真有这句话时**才在该文件上 grep；跨会话分散证据 → `note_recall` 先粗后细 + `includeArchived` 兜底 + 读 `source` 链）；精读纪律补上**「整批 coverage 都弱 ≠ 库里没有」**（长查询/中英混排会把覆盖率整体压低，先读排第一的那篇全文核实），并把"能用 `note_recall` 不用裸 grep"改成"能 `note_recall` 就不换工具"。
2. `dsh/preset/math-memory.mjs`（系统提示的每轮注入段）：三条 grep 路由改成 `note_recall` 起手，段首新增一条与 §0 同义的分工句；「近期跨会话问答线索（细节请 grep episodes）」改为「细节请 `note_recall` 定位后读文件，必要时再 grep 该文件」。两处注释同步（`grep/read` → `note_recall` 发现 + 定向 grep/read 核验）。
3. `dsh/preset/note-tools.mjs`：系统提示段把「glob/grep 继续用通用文件工具」改成**明确的分工句**（grep 是"已知路径后核对字面字符串/行号"的精确工具，glob 只管按路径模式找文件，都不做内容发现）；`note_search` 的 description 去掉「use grep/read for memory files」，改为「记忆内容用 `note_recall` / `note_strategy`」；`note_recall` 的 description 去掉"prefer it over grep"这种**并列比较**（那读起来像两个可选检索器），改成「这是**找内容**的入口，grep 不是发现工具」。
4. **`note_recall` 结果头里的"整批弱信号"改为有条件措辞**（这是把模型推出 recall 的直接诱因）：coverage 按**全部查询 token**算，一条长查询或中英混排会**同时**压低所有命中，而旧文案对"15 条全弱"和"3 条里 1 条弱"用的是同一句"多为词面巧合"。现在整批都弱时改说「多为长查询/中英混排把覆盖率整体压低，不等于库里没有：先读排第一的那篇全文核实，再决定是否改写查询（**不要改用 grep 全库搜**）」，只有部分弱时才保留原判断。
5. `main.js` 重建（内嵌 preset 与全部模板；未改版本号，等发版）。

**验证与覆盖范围**：`node scripts/build-obsidian.mjs` → `check-bundle-freshness` **逐字节**与全新构建一致；`check-agent-instructions` 1 个自动注入文件（仍是根 `AGENTS.md`，未新增/改名模板）；`check-doc-counts` 82 条陷阱 + 41 条门禁自洽。`npm test` = **39/41**，两条红**与本次改动无关**，且做了 A/B 基线：把改动 `git stash` 后在 HEAD `834357a` 上**单独重跑这两条门禁，复现完全相同的错误**——① `test: link server port+token stability`：前 15 项全 ok，红在无头浏览器 CDP 的 `timeout Page.enable`；② `test: agent preset mounts (real dsh, no tokens)`：6/7，唯一红项「dsh 启动并打印了带 token 的启动地址」。两条都是环境结果（本机浏览器/子进程环境），不是本次回归。**覆盖范围的边界**：本次改的是**文本（协议 + 工具描述 + 一处渲染文案）**，没有代码路径可被单测覆盖；"模型下次真的少用 grep"只能靠真实会话观察，或烧 token 的 `npm run qa:e2e`（本次未跑，按仓库纪律需先问用户）。

**刻意没做**：① 没有把 grep 从工具面摘掉（那会失去"核对某文件是否真有某句话/行号定位"这类合法用途，且 `tool-fs-search` 里 grep 与 glob 是同一个插件、无单独开关，摘 grep 得自写一个只为 glob 的本地插件）；② 没有改 `coverage` 的算法本身（那是 B 方案的活：只按"库里存在的 token"计算，属检索实现改动，风险与验收面都更大）；③ 没有同步 `scripts/qa/benchmark-vault/vault-AGENTS.md`——它是**冻结的基准语料**（`handoff.md` §7 明确"一次有意的刷新 + 新 baseline"才能动），顺手改会改变基准所测的东西。

**实测数据的口径（写给复核者）**：会话日志是 `session[.v3].jsonl.zstd`，**多帧 zstd**，逐帧解压；同一会话目录可能同时存在 v2 与 v3 两份（v3 是迁移产物、v2 被保留），统计时**优先 v3**否则会双计；真实工具调用是 `{"type":"tool/call","data":{"name",…,"arguments"}}`，按 `"note_recall"` 之类的字符串在整行里 grep 会把**系统提示与工具描述里的提及**也算进去，必须按事件类型过滤。

## 2026-09-18 · 文献库第六批（验证类 4 篇）+ 一个"同一论文两张卡"的重复条目 + 数学笔记验证机制评估

**起因**：用户提出一个设计问题——「我在笔记里写的定理和方法是错的怎么办？靠让 AI 审查会有细节错漏吗？有没有稳健的审查方法？」并给了 4 篇验证类文献（Danus / SAFE / LeanTutor / LeanDojo）与真实笔记库路径。要求按仓库文献处理流程研读记录，并评估如何改进。

**改动**：

1. **导入并蒸馏 4 篇**（`lit-import.mjs --source "D:\临时\agent记忆" --bib "…/导出的条目.bib"`，dry-run 先核对；4 篇 `full.md` 均洁净，`<sub>` 计数 ≤2）：`liuDanusOrchestratingMathematical2026` / `liuSafeEnhancingMathematical2025` / `patelLeanTutorVerifiedAI2026` / `yangLeanDojoTheoremProving2023`，各配 14 节研读记录（共 1,243 行）。
2. **`docs/literature.md` 的篇数 26 → 30**（`.raw/` 实际目录数，`check-doc-constants.mjs` 当场报红——它锚的正是这个数）。
3. **发现并处置一个真实的重复条目**：Danus 在 2026-09-17 已作为**网页源**导入（`danusFactGraphMemory2026`），本批拿到 PDF/全文后又按 citekey 生成了新卡。**根因：`lit-import.mjs` 按 citekey 去重、不按 DOI/标题去重**（`.index.json` 里两条记录 `doi` 完全相同）。处置：旧卡标 `status: superseded` + 正文顶部加指向新卡的说明（**不删除**——它保留了全文没有的网页来源与 pin commit 证据；`note_recall` 默认排除 superseded）。逐条差异（12 条证实 / 10 条需补精确 / 16 条新增）见 `reading/liuDanusOrchestratingMathematical2026.md` §13.1。
4. **`status: superseded` 现在是一个真实的文献卡状态**，因此 `scripts/lib/lit-index.mjs` 的 `statusLabel()` 补了映射（否则中文索引表会直接印出英文 token）。断言 10 → 11，**并做了变异验证**（撤掉映射 ⇒ 新断言红，恢复 ⇒ 11/11）。
5. **评估文档两篇**：`literature/notes/verification-design-2026-09-18.md`（机制设计：四态 × 五级瀑布、claim 台账、缝检查、落地清单 V0–V9）与 `literature/notes/math-note-fault-taxonomy-2026-09-18.md`（对真实 vault 的只读实证：7 类笔记、12 类错误形态、逐条文件+行号+计数）。

**评估给出的、值得记下来的三条**：

- **缺口是"范围"而非"没有机制"**：`AUDIT_CARD_DIRS` 只含 `records/templates/strategy`，`theorems/index.md` 与用户笔记**既不入体检也不入级联**（`math-memory.mjs:155, 1939-1943`）——而它们恰是唯一没有 verifier 的写入者。
- **实测里最贵的错不是算错，是"等级盖错章"**：`theorems/index.md` 把 Cramér–Rao 记为 `状态:已证`，而载体文件自称"由 AI 依口述骨架撰写……不是我的原稿"、正文标注"请勿当作已证"。**文内警告挡不住下游按索引使用**；这类错纯文本可查。
- **两个"机制存在但从未运行"的实例**：`notation.md` 三张表全是「（示例）」占位行（而协议举的冲突示例在库内出现 0 次）；体检记录停在两天前、`unverified = 0`。⇒ 修法必须是"体检多一段报告"的被动形状，不能是"每轮必做"（用户已在 `docs/handoff.md` §5 否决后者）。

**验证与覆盖范围**：`npm test` = **39/41**（211.9s）。**两条红都是环境结果，不是本次回归**——① `test: link server port+token stability`：前 15 项全 ok，红在无头浏览器 CDP 的 `timeout Page.enable`（本机无浏览器环境）；② `test: agent preset mounts (real dsh, no tokens)`：6/7，唯一红项是"dsh 启动并打印启动地址"（本机子进程/端口环境）。两条**单独重跑均复现同一错误**，且本次改动**不含任何代码路径**（`git diff` 只有 markdown/JSON 与一处 `lit-index.mjs` 映射 + 一处断言）。定向复核：`run-gates --only doc` 4/4 绿（含 doc-constants 的篇数锚）、`--only lit-import` 2/2 绿（11/11）。

**未做（留给下一轮，均已写进评估文档 §7 并带判据）**：V1/V2（等级章对账、体检纳入笔记层）、V3–V5（级联穿笔记、内容指纹作废、断链扩到笔记且把过滤规则本身当被测对象）、V6（初始化 `notation.md`）、导入器的 DOI/标题去重检查。

## 2026-09-18 · 更新说明改回"用户视角"：正文只写摘要（用户明确要求）

**起因**：用户读 0.7.8 的 Release 正文后指出——段首那段「本版是 0.7.7 之后累积的全部用户可见改动（43 个提交）。0.7.7 发布时 `[Unreleased]` 是空的，其后的两批……都没进过任何 Release，所以这些能力是你升级到 0.7.8 才会第一次拿到的」**不需要**；更新说明**只要一段"本版主要包含哪些方面"的摘要**。

**判断：这是同一类返工的第二次**。第一次是 0.7.8 摘要本身（我当时把"提交数/哪个版本漏发"当成读者需要的信息）；本次是它的延续——根因相同：**把维护者视角写进了用户说明**。这类信息对维护者有用（它解释"为什么这一版装的东西比一版多"），但读者只关心"这版给我什么"。⇒ 它不是措辞问题，而是**视角问题**。

**改动**：

1. `CHANGELOG.md` 的 `[0.7.8]` 段首摘要重写为四个方面（治理闭环 / 记录纪律 / 写入的诚实性 / 预算档位与文献库与探针），另附一句"修掉会让适用边界静默失效的缺陷"。段落 4,536 → **4,497 字符**，五个小节不变。
2. **规则写进手册**（`docs/release.md` 新增 §5「版本更新说明的写法」）：正文开头只写 3–4 个方面的摘要；**不写**提交数、哪个版本漏发、曾长期躺在 `[Unreleased]`、门禁/断言数变化（后者属 `Internal` 小节，可留但不进摘要）——这些是维护者细账，去处是本文。
3. 线上 Release 正文用 `PATCH /releases/391229993` 同步替换；`docs/archive/release-notes-0.7.8.md` 重建为修正后的段落（其头部也去掉了此前我误加的一段元说明）。

**为什么把规则写进手册而不是只改这一次**：这类返工已经发生两次；把规则留在某次对话里，下一次发版的人（包括我自己）不会知道。

**验证**：`check-doc-consistency` / `check-doc-counts` / `check-version-consistency --tag 0.7.8` 全绿；段落内旧措辞（"43 个提交"、"都没进过任何 Release"）抽样计数为 0；线上正文更新后与 `CHANGELOG.md` 段落逐字一致。

## 2026-09-18 · 发版 0.7.8 的收尾与一次 CHANGELOG 编辑事故

**先说事故（我自己造成的，且它泄漏到了线上 Release 正文）**。0.7.8 的准备提交里，我用一次「只替换标题行」的编辑把根 `CHANGELOG.md` 的 `## [Unreleased]` 改成 `## [0.7.8] - 2026-09-18`，并**在其下插入**新写的发布段落。当时我核对过「`[0.7.8]` 段不含 `## [0.7.7]` 标题、结构正确」，**但没检查旧 `[Unreleased]` 的正文是否被我插入的段落挤成了孤儿**——结果是：旧内容的**尾巴**（一条破损的半句 + 重复的 `### Fixed` / `### Added`）留在 `[0.7.8]` 段落内部。

- **后果**：`release.yml` 按设计抽取 `## [0.7.8]` 到下一个 `## [` 之间的全文当 Release notes，于是**线上 Release 正文里有重复段落**（10,064 字符里约 4.3K 是重复内容）。
- **为什么当时没发现**：我只验了"边界正确"，没验"**内容无重复**"。这与本仓库反复出现的形态同族：**验证了格式，没验证语义**。另外，若当时把抽取出的正文**打印出来读一遍**（而不是只数行数与长度），重复段落一眼可见——`release.yml` 本就有一句 `head -5 release-notes.md` 的调试输出，我一次都没用过。
- **修法**：删掉 `[0.7.8]` 段内第 54–78 行的孤儿块（内容全部已在上面各节写过），段落从 10,064 → **5,708 字符**，小节恢复为 `Added / Changed / Fixed / Docs / Internal` 五个；`check-doc-consistency` 与 `check-version-consistency --tag 0.7.8` 全绿。
- **线上正文**：Release 正文是**一次性快照**，改文件不会回改它。已记入 `docs/handoff.md` §7 的 0.7.8 行作为遗留手工事：**若要修好线上正文，删掉该 Release 后用同一 tag 重建即可**（正文会按修好的段落重新抽取；资产会重新上传）。**本次未做**——它需要写权限，且不影响插件/npm 的可用性。
- **教训（写给下一次发版）**：**发版前把 Release 正文抽出来读一遍**，而不只是校验它的长度或边界。抽取命令等价于 `awk` 那 5 行，本地跑一次即可。

**同时补记的两处文档**：

1. `docs/release.md` §2 第三种情况（registry 可见性延迟）补上第三次实测（**0.7.8 = 92 秒**）与一条更重要的处置原则：**先用只读方式独立核实 registry 的真实状态，再决定动作**——本次有效的查法是直接取 `https://registry.npmjs.org/dsh-math-memory/latest`（回应里的 `"version"` 即真值）；本机 `npm view` 在受限环境会因 `EPERM` 写不了缓存而失败，**失败 ≠ 未发布**。另记下：失败路径会 `skip` 掉"关历史 issue"那一步，所以这类**假失败每次都留一件手工事**。
2. `docs/handoff.md` §7 新增「发布 0.7.8（推 tag）」行：tag `0.7.8` / commit `d813a67` / Release 4 个资产 / npm `latest` = 0.7.8（带 provenance，`gitHead` 对得上）；并按手册 §4 记录两处遗留（关 issue、线上 Release 正文重复）。

**验证**：`check-doc-consistency` 13 锚点全绿；`check-version-consistency --tag 0.7.8` 通过；`[0.7.8]` 段无重复三项抽样计数均为 0。

## 2026-09-18 · WikiSkill 研读后的文档收口（设计正当性 + 探针方法学）

**这一节只动文档**，把本轮从 WikiSkill（arXiv:2608.27454）读出来的两条**判断**写成可引用的规格，防止后来者反向重做：

1. `docs/memory/design.md` §2.1 **知识层 / 产物层分离**：我们有同样的分离（`records/topics/theorems/notation` vs `strategy/templates`），但此前只写在实现里、没写成原则。现在写明三条推论——`superseded` 而非删除、策略卡改写不带走支撑它的事实、两边各自的写入纪律；并引它的三层与"wiki 永不回滚"当外部论据。**同时写明我们刻意不学的一点**：它训练期禁读知识层（-2.8 分）是因为它度量"技能本身够不够好"，我们度量"这一轮答得对不对"，所以**全注入是有意的**；要保留的是它的判据（读原始素材会降低蒸馏产物质量 ⇒ 反对把 `episodes/` 原文塞进上下文）。
2. `docs/memory/design.md` §10 补两条**"我们领先"的自我认知**（也来自它的 Limitations 自陈）：它**不评估检索**（那是我们 `note_recall`/`note_strategy` 的地盘 ⇒ 不要因为"三层级联"去重写检索）、**无裁剪机制**（我们有 archive/superseded/上限 ⇒ 方向正确，要补的是裁得准）。
3. `docs/memory/testing.md` §4.1 **探针方法学：2×2 消融 + 重复 3 次（状态：提案，未实现）**——照它 §5.1 的消融形状：把"关掉一个开关"换成「注入该特性 × 库里有/没有对应内容」的四格，因为单开关消融**区分不了"没读到"与"没有可读"**（两个原因同一个红/绿）。明确**不做** bootstrap 显著性（我们几十条合成用例，样本量支撑不了这个统计量；它有 18–280 条真实测试集才用），也**不进 CI**（需要真实 vault）。

**为什么只是文档**：这三条要么是既有实现的**理由**（改写它不影响行为），要么需要**真实 vault** 才能落地（探针的格子与重复）。规格先立，实现留给有真实 vault 的那一轮——这比先写一个跑不起来的探针更符合本仓库对"状态标注"的要求（§0.5 第七荣辱）。

## 2026-09-18 · 卡片尺寸上限 + 三条 move 纪律（把"不要写小作文"变成可检查）

**起因**：WikiSkill（arXiv:2608.27454 Appendix E.2）把模式页**硬性限制在 10–30 行**。我们的模板写了很久的"原子化、不要整段对话总结"——**没有数字的纪律无法检查**，所以它一直只是建议。同一篇的 §4.2.2 还把负迁移的两个诱因（**底层 workaround 硬化**、**碎片化前置检查耗尽交互预算**）写成实证结论，这两条正好对应我们策略卡的写法。

**数字不凭空定**：先量语料——种子 vault 的 records 正文 **7–8 行**、策略卡 **2–6 行**、move **≤ 3**。上限定在**正文 ≤ 20 行**、**move ≤ 5**（宽于实测分布 ⇒ 抓囤积，不给正常写作添堵）。

**实现**：`AUDIT_BODY_MAX_LINES = 20` / `AUDIT_MAX_MOVES = 5`；进 `sections.tooLong` / `sections.tooManyMoves`，清单**说清该做什么**（拆卡 / 把过程挪进 episode / 按触发条件排序并移出不触发的 move），进体检台账（`split-card` / `split-or-prioritize-moves`）；**只报告不自动改**。

**模板纪律**（`records-readme.md` 第 6 条、`strategy-readme.md` 第 9 条）：卡片要短；**每个 move 写清触发条件**（检索步数是硬预算，无条件清单会挤掉真正解决问题的检索）；**不写语法级 workaround**（`concrete` 段不写死具体算子/记号/结论，那属于 `theorems`/`notation` 层）。

**★ 第三个由自己抓出来的实现错误（记下来，因为它是同一族）**：第一版 move 计数写在**正文**上，**恒为 0**。原因是 `strategies:` 是 **frontmatter 字段**——move 写在头块里，`stripFrontmatter` 把整块剥掉。这一条与前面 `cardRef` 缺 `uses`/`successRate` 是同一族病：**判据看不见自己的输入**。定位它花了远超预期的时间，而且中间我被自己的探针结果误导了一轮（探针脚本在改过内容与没改过内容之间切换，先后输出互相矛盾的数字）。**教训值得写进 §6：探针脚本要一次成型、改一次就重跑，否则它会像假守卫一样骗人。**

**验证**：`test-memory.mjs` **331 → 335 项**（超长卡被点名且带行数、正常卡不被误报、move 过多单独成一条 finding、清单给出处置动作）；`npm run qa` seed-probe 8/8。

## 2026-09-18 · 破坏性写入：原子替换 + 失败要报（旧版把错误全吞了）

**起因**：WikiSkill（arXiv:2608.27454）用 staging + checkpoint + 原子 `rename` 保证"被否决/中断的更新不会毁掉已接受的东西"。对照我们的 `moveCardsToArchive`：它**把每一个错误都吞掉**（`catch { /* leave in place */ }`、索引改写 `catch { /* best-effort */ }`），于是重命名因文件被占用而失败、或索引写不进去时，报告照样说"自动归档 N 张"——**报告与 vault 不一致，而且没人知道**。这正是本仓库记过的那类病：**静默成功比报错更贵**。

**实现**（`math-memory.mjs`）：

1. **`writeFileAtomic(path, content)`**：写 `.tmp` → **读回校验** → 备份旧内容到 `.bak` → `renameSync` 原子替换 → 再读回校验。任一步失败 ⇒ 清掉自己的临时文件、**原文件一字不动**、返回 `{ok:false, reason}`。读回校验是刻意的：满盘/只读挂载会在**原文件还完好时**就暴露。
2. **`moveCardsToArchive` 返回 `{moved, failures}`**；失败进 `warnings` ⇒ `status: degraded`，并写进 `postconditions.archiveFailures`。索引改写失败时卡片**已经移动了**，所以报告写的是"卡片已移动，可据 `.bak` 修复"，**不假装整件事失败或整件事成功**。
3. **不设 known-good 快照**（有意）：WikiSkill 那份实现每次构造工作区都用当前磁盘状态覆盖快照，崩溃后的中间态会被"追认"成 good。我们改的是**用户可编辑的 markdown**（不是可重建的生成物），所以只要"失败不动原文件"，多一层快照只会带来"哪份才算数"的歧义。

**验证**：`test-memory.mjs` **326 → 331 项**：3 项原子写（成功落盘且 `.bak` 是旧内容；**失败时原文件内容逐字不变**并给出 reason；占用临时路径的外来目录不被误删）+ 2 项归档降级（用"占住 index.md.tmp"逼索引改写失败 ⇒ 断言 `status: degraded`、`postconditions.archiveFailures` 有一条、卡片确实已移走）。

## 2026-09-18 · 预算截断必须自报（并撤回一处做不到的标记）

**起因**：WikiSkill（arXiv:2608.27454 Appendix C）对每条注入日志的上限写法是**显式的 `[TRUNCATED: Exceeded 15,000 characters limit]`**。我们的注入层有九档预算（profile 4000 / topics 1800 / …），截断只用结尾一个 `…`——而**散文本来就常以省略号结尾**（审计的人读摘要里就有 `count > 3 ? " …" : ""`），所以「以 `…` 结尾」区分不了"被预算截断"与"原文如此"。把残片当完整证据，比没有证据更糟。

**实现**（`math-memory.mjs` 的 `clip`）：截断处追加 `……［截断：全文 N 字符，此处非全文，用 read/grep 取原文件］`，**N 是原文长度**（读者由此知道缺了多少，而不只是"缺了东西"）。标记**不计入预算**，内容仍是 `maxChars`；原有的 `…` 结尾保留，旧读者不受影响。`clip` 已导出，便于直接断言这条契约——它在组装后的提示里是**看不见的**：静默截断的段落看起来仍像一个完整段落。

**★ 一处按"做不到"撤回的改动（记录在案，防止后人重做）**：我最初把标记做在 `note_tools` 的检索片段上（`snippetIsTruncated` + 提示语），写了两版实现、两次被自己的探针打回：
① 用 `source.includes(文本)` 判截断 → **重复字符会让它误判**（`"x".repeat(400)` 包含任意 `xxxx…` 片段，于是"被截断"判成 false）；
② 改用长度判据（窗口 ≤ `maxLen+180`，达到 3/4 即算截断）→ 仍然错，因为**它读到的 passage 在 `composePassage` 里已被截到 800–2000 字符，原始长度在那里根本不可知**。
⇒ 结论：**这一层做不出诚实的标记**，所以撤回全部实现，只在工具描述里写清片段性质（"snippets are short WINDOWS around the query terms, not the full card"）。**留下的是一个可判定的说明，不是一个可能撒谎的标记。**

**验证**：`test-memory.mjs` **321 → 326 项**（4 项单元 + 1 项端到端：构造超预算的 topics 索引，断言**组装后的注入段里出现截断标记**）。变异验证：把 `clip` 改回只加 `…` ⇒ 两条断言报错（**324/326**），还原后 326/326。

## 2026-09-18 · 索引行说明下限：在索引里 ≠ 说了什么

**起因（同上一条，仍来自 WikiSkill）**：它的模式索引每行必须写全 **PROBLEM + ROOT CAUSE + FIX**，理由是**这一行决定读者要不要打开整页**。我们的索引行格式本来就是 `- [[stem|一句话]] · topic · updated: …`，但**没有东西检查那句"一句话"说了什么**：`- [[x]]` 与 `- [[x|?]]` 照样满足体检的"卡在索引里"检查。

**规格先行**：`docs/memory/design.md` §8.2（状态标已实现）。

**实现**：`indexDescriptionIssue(line, minChars)`（导出、纯函数）+ 体检三层索引扫描（`records/` / `templates/` / `strategy/`），下限 `AUDIT_INDEX_DESC_MIN = 8` 字符。两条 finding 分开：**说明过弱**（`indexWeak`）与**行不合契约**（`indexNotAnEntry`，行首不是 `[[` 链接——读者与旧解析器都从链接取 stem，形式不对的卡按名字找不到）。清单里写明该写什么；**只报告、不自动改写**（措辞质量归模型，机器只声明"空的/太短"）。同一张卡**不会**同时被报"未入索引"与"说明过弱"。

**★ 自己的断言抓出我自己两处实现 bug**（都不是先有 bug 再补测试，而是写完断言跑出来的）：

1. **元数据把长度凑够了**：描述原先取"第一个 `|` 之后的全部文本"，于是 `- [[rec-thin|?]] · 数论 · updated: 2026-01-01` 的 `?·数论·updated:…` 有 20+ 字符、**不触发下限**。已改为**只取链接内的显示文本**。
2. **`]]` 被算进长度**：一个字符的描述被算成三个。两处各补一条断言。

**变异验证**：把描述提取改成"没有 `|` 时也从链接里取描述" → `[FAIL] index lint: a bare link with no description is an empty description`，**320/321**；还原后 **321/321**，并核对该行回到原文。

**验证范围**：`test-memory.mjs` **311 → 321 项**（6 项单元 + 4 项端到端）；`npm run qa` seed-probe 8/8；全量门禁结果见本节末尾的统一说明。**索引行 lint 是"能把纪律写成 lint"的一个实例**（`agent-repo-maintenance.md` §0.6 第 6 条）。

## 2026-09-18 · 体检台账（跨次判定史）：让"报了十一天"不再读起来像"今天新报"

**起因（来自文献，不是来自报错）**：研读 WikiSkill（arXiv:2608.27454，卡片 `literature/cards/tangWikiSkillCompilingAgent2026.md`）时，它的 `skill-impact.md` 给出了一条我们没有的机制——**每条改动的 diff + 验证分 + Accept/Reject 由框架程序化追加、且永不回滚**，作者明列用途之一是「**被拒过的干预不再重复提出**」。对照我们自己的日常形态：体检**每天从同样的文件重新推出同样的建议**，而"这张卡上周被报过、当时决定先不动"没有任何地方记录。于是同一张 weak 卡可以连续多周被报，每次都被当成新发现重新判断一遍——**用户与 agent 都在为同一件事反复付注意力**。

**这条同时也补上了一个已记账的缺口**：`improvement-details-2026-09-17.md` 第 5 项把「增量回执符号 `+ ~ ! ⚠`」延后，理由是"只比数量会在'解决一对又新增一对'时误判为无变化"。它需要的正是**身份级的上一份记录**——台账就是那份记录。

**规格先行**：`docs/memory/design.md` 新增 §8.1（状态标 `已实现`），把文件位置、每行字段、**身份定义**、两个有界性上限、"只报事实不要求动作"、以及有意不做的部分一次写清。**先写规格再写代码**，因为这条机制的风险不在实现难度，而在语义：一旦把"历史条目"也当成动作要求，它就从"回执"退化成"每天多一段噪音"。

**实现**（`dsh/preset/math-memory.mjs`，新增常量 5 个 + 函数 5 个）：

1. `cache/audit-ledger.jsonl`，**append-only、只由体检写**，每行 `{at, today, object, action, criterion, evidence, firstSeen, count}`；与 `cache/memory-audit.json` 的分工是**快照 vs 判定史**。
2. **身份 = `object` + `action` + `criterion`，刻意不含 `evidence` 的数值**——否则 `uses`/相似度/天数一变就会被记成"新问题"，而这恰恰是台账要消灭的噪声。
3. **反向回执**：新条目与"此前已在账、今日仍成立"的条目**分开报**，后者只带 `firstSeen`/`count` 两个数字、**不要求动作**；模型清单里写明「不是新问题」。
4. **两个有界上限**：单次最多入账 200 条、文件最多 2000 行（超出丢最旧）。WikiSkill 的自陈短板正是"wiki 无裁剪机制"，这条不重蹈。
5. 开关 `auditMaintainLedger`（默认开，与 `autoArchive` 同形）；关闭时报告形状不变，仍报历史但**不消费**它。

**★ 实现中查出的两个自身缺陷（都由自己写的断言抓出来，不是先有 bug 再补测试）**：

- **守卫看不见自己的输入**：`sections` 的条目由 `cardRef()` 投影，而它原先**只带 `rel`/`title`/`gain`**。于是我为 weak 段写的一致性自检读到的 `uses`/`successRate` 是 `undefined` → **在每张 weak 卡上都会触发**（"狼来了"），台账里也写出 `uses=undefined,success_rate=none`。这正是本仓库反复出现的形态（断言在变异下照样通过 / 夹具不超过上限所以测不出上限）。已让 `cardRef()` 带上这两个字段；自检因此变成真判据（删掉它 → 「台账 evidence 读不到数字」的断言会红）。
- **同日重跑丢掉历史**：台账每天由体检写入、每份报告带一个 `today`。原先的读取逻辑**跳过 `today === 今天` 的行**来避免"同日行把 `firstSeen` 锚到今天"；但**跨日延续的行在重写时 `firstSeen` 是旧日期、`today` 是新日期**——于是同一天第二次审计又把它当新条目。修法是按 `firstSeen` 取**最早**、`count` 取**最大**来恢复延续状态，而不是按行日期过滤。抓出它的是断言「a disabled run did not consume the history」（我先写的断言、后发现的缺陷）。

**变异验证（做了两轮，做了才知道断言是假的）**：

1. **第一轮抓到一条假守卫**：把 `ledgerSignature` 改成**含 `evidence`** → **断言照样全绿（311/311）**。原因是那两条"身份不含数字"的断言只检查 `signature` 的前三个元素，而变异把 `evidence` 追加到**第四个**——它根本没在测它声称测的东西。这正是本仓库最贵的教训（"断言在变异下照样通过"）的又一实例，**由变异验证自己抓出来**。
2. **改用可观察行为重写断言**（改卡片让 `uses` 从 4 变 6、`success_rate` 从 0.2 变 0.35，两者不参与身份 ⇒ 该条建议必须仍算"延续"），再跑同一条变异 → **`[FAIL] ledger: changing only the evidence numbers keeps the item carried over … {"newCount":2,"carriedCount":2,…}`，308/311**。**这次它在该报错时确实报错了。** 还原后复跑 **311/311**，并核对了那行已回到原文（无变异残留）。

**验证范围**：`scripts/test-memory.mjs` **297 → 311 项**（新增 11 项台账 + 3 项 weak 自检），311/311 通过；`docs` 六处断言数锚点同步为 311（`check-doc-consistency` 13 个可比锚点全绿）；`npm run qa` seed-probe **8/8 PASS**（真实 vault 探针本机未设 `DSH_WORKSPACE_ROOT`，按设计 SKIP）；全量门禁 **38/41**——三条红中 `check: doc consistency` 是本轮**尚未同步文档**时的中间态（同步后转绿），另两条（`test: link server` 的 headless CDP、`test: agent preset mounts` 的真实 dsh）**在干净 HEAD 上以 `git stash` 复跑逐字同样失败**，属本机环境结果。**"39/41"或"38/41"都不等于"全绿"，两条红的性质是在动手前就已在案的环境项**（`AGENTS.md` §4：先分类，再动手）。

**有意不做**（已写进 §8.1）：台账的面板/CLI 渲染、"首次出现"接进面板「⚠️ 待处理」计数、按天数升级提醒强度、任何形式的自动关闭或"视为已处理"。**台账只记录；判定归用户与模型**（插件不调模型是设计红线）。

## 2026-09-18 · 手写数字收进守卫（陷阱条数 + 门禁总数）+ 两处会把人带偏的活文档 + 成本基准存档

**起因**：上一轮把 §7 的未做清单补齐后，它自己留下了三条「低优先」项。逐条评估「影响 vs 收益」后动手的是**三类**：**会腐烂的手写计数**（两处，同一族）、**会把读者带向已证伪结论的措辞**，以及用户当轮决定的**成本基准存档**。判定标准沿用本仓库的既有教训——**收益不在"多一个守卫"，而在"下次有人改这里时不会静默改错"**。

**① 陷阱条数不再手写（新门禁第 41 条）**

`AGENTS.md` §1/§6 要引用"这个仓库有多少条历史陷阱"，而那个数字**手写并已腐烂**：写着 69，实际 81（`docs/handoff.md` §4 的最后一个编号）。它落在 **agent 的首读路径**上（`AGENTS.md` 是 harness 自动注入的那个文件），所以错的那个数字会被优先读到。

- **改法不是改一个数字，而是让它可判定**：`docs/handoff.md` §4 顶部新增一行标记 `> 陷阱条数：81`（**单一事实源**），`AGENTS.md` 两处引用都指回它。
- **新守卫 `scripts/check-doc-counts.mjs`** 数出 §4 的真值（本节内 `^N. ` 的顶层编号），核对 ①标记行 ②`AGENTS.md` 两处引用；并额外断言**编号必须是 1..N 无重无缺**——重号会让"见坑 62"这类引用指向两处，而总量看起来仍然正确。
- **申报式失败**：措辞变了导致匹配不到引用时**报错**而不是静默通过（否则锚点会腐烂成装饰，同 `check-doc-constants.mjs` 的规则）。

**变异验证三项**（做完全部还原）：① 两处计数都改成 80 → 报 `declares 80 traps but holds 81` + `§1 table claims 80`；② 把陷阱 79 改成 45（造重号）→ 报 `repeats 45` + `skips 79`（正好是"总量不变但编号坏了"的形态）；③ 删掉标记行 → 报 `must declare its own size in a marker line`。

> 过程留痕：第 ③ 项之后我用 `git checkout -- docs/handoff.md` 想还原，但那份文件当时**整个都是未提交的改动**（标记行 + §7 收尾），于是把本轮对它的全部编辑一起还原了。教训与仓库既有纪律同族（**先看 `git status`，再选还原手段**）：对未提交的文件，`git checkout` 不是"撤销上一步"，而是"撤销这个文件的一切"。

**② 两处会把人带向已证伪结论的措辞**

- `docs/memory/README.md` 的文档导航把 `sidebar-performance.md` 概括成「**跨帧 `backdrop-filter` 主因**」——而那份文档自己测出的结论是**主因 = 皮肤客户端脚本 `hooks.mjs` 持续改 DOM**，`backdrop-filter` **是第二轮就被 A/B 否掉的错误推断**（`handoff.md` 坑 49 的原话是"『看起来很贵』不等于『测得出来贵』——先 A/B，再改代码"）。照导航那句话去找原因，就会重走一遍已经走错的路。改为写明真因、并标明 backdrop-filter **已被实测否掉**；顺带把"12 条候选"改为与正文一致的 **11 条**。
- 同一表里 `benchmark.md` 的更新时机写着「**拍板后实现**」，而 benchmark 的引擎探针早已实现并实测（零 token）——只有端到端那半需要真实 token。改为按事实区分两半。

**未做（本轮有意不碰）**：`improvement-details-2026-09-17.md` 的落地状态总览、审计对每张 hook 卡多读一遍文件（`writeGain`）、陷阱 77 的两项遗留（链接模板运行时注入 / 代理自愈）、侧栏性能的三项未解决。

**验证**：`check-doc-counts`（原 `check-trap-count`，含上面三项变异验证）、`check-doc-consistency` 13 个锚点全绿、`check-doc-constants`、`check-readme-pair`（重新记录后）；全量门禁 **41 条跑到 39 绿**——另两条（`test: link server port+token stability` 的 `timeout Page.enable`、`test: agent preset mounts` 的 `dsh 启动并打印了带 token 的启动地址`）在**干净 HEAD 上用 `git stash -u` 复跑后逐字同样失败**，属本机环境结果（无头 Chromium CDP 超时、真实 dsh 起不来），与本次改动无关。**"39/41"不等于"全绿"，两条红的性质是在动手前就已在案的环境项**（`AGENTS.md` §4：先分类，再动手）。

**③ 门禁总数也收进同一个守卫（同轮追加）**

同一个病：`AGENTS.md` §4 写着「本机当前 **34/34**」，而门禁已经 **41** 条。**手写计数落在 agent 的首读路径上**，与陷阱条数是同一族。

- **清单本身成为单一事实源**：`GATES` 从 `run-gates.mjs` 抽到 **`scripts/lib/gates.mjs`**，`run-gates.mjs` 与守卫**导入同一份**。守卫因此不需要跑子进程，也不需要解析 `--list` 的输出（沙箱禁止捕获管道 stdio，所以"能 import 就不 spawn"是本仓库的既有教训）。
- **文档改为写"注册总数"，不再写"本机跑绿几条"**：跑绿的数量是**环境结果**（本机常有两三条因无头浏览器/无 dsh 而红或 SKIP），钉进文档只会不断制造假漂移。所以守卫钉的是 `GATES.length`。
- **变异验证两项**：④ 文档改 40、清单仍 41 → `claims 40 gates, but … registers 41`；⑤ **真的把一条门禁注释掉** → `claims 41 gates, but … registers 40`（这才是要防的方向：加/删门禁却忘了改文档）。

**④ 成本基准（单题 tokens 对照）按用户决定存档**

用户指示：「那个成本基准可以存档了，目前不需要它」。查清它**是什么**再动手——它不是一套套件，而是**一道题的一次实测**（旧系统约 17 万计费 tokens → 新系统约 2.5 万，缓存命中 68%），作为「验收记录」写在两个 README 里，另有推广稿复述一次。**没有任何脚本、用例或 baseline 与它绑定**：无法重跑、无法验证。

- **活跃声明移除**：两个 README 的验收记录里那句删掉（其余 E2E 5 用例的声明保留，它们有套件支撑）。删完 `check: readme pair` 如实报红（"两侧都被改过，请确认它们说同样的话，然后重新记录"）——这是该守卫的设计行为，**结构比对本身是通过的**（14 节 / 29 条目 / 3 围栏一致），只是两侧哈希记录需刷新；按提示跑 `node scripts/check-readme-pair.mjs --write` 重新记录（`README.i18n.yaml` 两行哈希）。**注意顺序**：先确认两侧说得一致，再 `--write`，否则就是把不一致"记录"成一致。
- **证据存档、原文不删**：`docs/archive/cost-benchmark-2026-08.md` 保存数字、三处出处与**证据边界**。
- **历史推广稿不改写**（本仓库的既有约定：改历史记录等于毁掉"当时是什么样"的证据）：`推文-0.7.1.md` 保留原文，顶部加状态横幅并指向存档。
- **顺带查出一条与它有关的旧账，已按纪律记成陷阱**：当时 **E2E 的 token 计量恒为 0**（`project-assessment-2026-09-10.md` §2 第 11 条：只读了会话格式 V3 里**已被移除**的 `assistant/chunk` usage 事件），而 `benchmark.md` §5 恰恰把"从 `assistant/chunk` 取 tokens"写成成本记录的设计 ⇒ **"成本怎么量"这件事本身当时是坏的**，而**没有任何门禁会发现"计量恒为 0"**（0 是合法数字）。这才是"停用口径"而非"修好再用"的直接理由。已记入 **`handoff.md` §4 陷阱 82**（连带修正标记行 81 → **82**），存档里写明证据边界与恢复条件。

## 2026-09-17 · 预算档位的用户入口：走库内 `.deepseek/config.md`（第三批收尾）

**背景**：上一节记了「设置页下拉框卡在一条不存在的通道上」。用户拍板选**通道 2（库内文件承载）**，本轮落地。

**★ 查档少造了一个文件**：我本打算新建 `.deepseek/memory/config.md`，但查档发现**已经存在** `.deepseek/config.md`，而且它的注释就写着「vault overrides preset, field by field；缺失则 preset 生效」，并且 `setSessionCapture` 已经在写它。**所以复用它，只加一个 `budget` 字段**——与原本的设计意图完全一致，但少一个文件、少一套约定。

**改动**：

1. `parseMemoryConfig` 增加 `budget`（字符串，非布尔）——**只记录已知档位**；无法识别的值**保持字段缺失**，从而让 preset 配置继续生效，而不是静默钉死 `standard`。
2. 新增 `budgetsFor(config, ws)`，把**优先级**写成一行可读代码：**显式 preset 设置 > 库内配置 > standard**。之所以没在 `normalizeConfig` 里定案，是因为库内读取需要 vault root，而那是 per-agent、构造插件时还不知道的。
3. `dsh/host/memory-admin.mjs` 新增 `setMemoryBudget(root, tier, template)`，照 `setSessionCapture` 的形状（最小 frontmatter diff、缺失时用模板建文件、没有 frontmatter 就拒绝猜）。
4. 设置页新增「注入预算」下拉框（compact / standard / rich），并说明**它只限制导航层、不限制正文**；`main.js` 的 `MEMORY_ADMIN` 导出表补上 `setMemoryBudget`。

**验证**：`test-memory` **290 → 295**（+5：库内档位被读回、库内决定 budgets、**显式 preset 胜出**、未知档位被忽略、写入器保留原字段）。**两次变异验证**：① 优先级反转 ⇒ 「显式预设胜出」失败（294/295）；② 未知档位被记录 ⇒ 「未知被忽略」失败（294/295）；恢复后 295/295。`build-obsidian` 重建（578327 字节）、`bundle-freshness` / `embedded-writers` / `engine-sync` / `check-doc-constants` 全通过。

**顺带登记**：文献索引逻辑门禁 `scripts/test-lit-import.mjs` 已登记进 `scripts/run-gates.mjs`（用户确认 README 配对守卫工作已完成、该文件不再被占用）。

## 2026-09-17 · 检索分层：分层取用与失败回退（第三批之二，只补协议文本）

**约定**：**只补协议文本，不动检索核心**（检索改动属 `retrieval-v3.md` 的地盘，单独评）。

**依据**：MSCE（arXiv:2607.16621 §4.3）的三层级联——技能优先 → 命中的环境认知**只提供参数、不覆盖技能过程** → **技能不命中或失败就回退证据层**。

**改动**：`dsh/templates/vault-AGENTS.md` §5 其后新增五条：

1. **先方法、后证据**——方法与结论**分属两层**，别指望方法卡里带着答案；
2. **方法是候选不是判决**——`matches` 可依据、`candidates`（`status: candidate`）只能当线索；
3. **方法不奏效就回退证据层**——回退是**正常路径**，不是在方法层反复换措辞；
4. **层级只提供参数、不覆盖方法**——`profile`/`notation`/`topics` 用于实例化方法卡里的占位；
5. **一次失败要留下痕迹**——写进 `not_applicable_when` 或 `decision_guidance.avoid`。

**验证**：`main.js` 重建（572607 字节）、`bundle-freshness` 通过；`agent-instructions` 通过（仍只有根 `AGENTS.md` 一个自动发现文件——本仓库中过两次这个坑，改 vault 模板时必须复查）；`test-memory` **290/290**。本项**无代码改动**，因此没有变异验证对象——协议文本约束的是模型行为，其机制面由既有断言间接覆盖（适用边界门控、`candidates` 分流）。

## 2026-09-17 · 注入预算档位（第三批之一，preset 侧；设置页未做）

**依据**：MemForest（arXiv:2609.08273）把压缩率做成**显式旋钮**（30/50/70%），并从那条曲线读出准确率–成本关系，而不是让"注入多少"成为实现的隐藏副作用。我们的注入预算是 `math-memory.mjs` 里一组写死的常量。

**改动（preset 侧）**：
- 新增 `BUDGET_TIERS`：`compact` / `standard` / `rich` 三档 × 七个键（profile / topics / records / templates / episodes / inbox / dialogue）。
- **`standard` 与既有常量逐字相同**——这是本项最关键的**否定性**性质：仅仅"提供一个选择"绝不能改变**没有选择**的人的行为。断言直接钉住这一点。
- 导出 `resolveBudgetTier()`：**未设置或取值无法识别一律回落到 `standard`，不抛错**（配置文件里一个拼写错误不该把整个 preset 拖垮，安全方向就是"回到档位存在之前的行为"）。这条也有断言。
- `buildMemorySection` 新增 `budgets` 参数并**默认 `standard`**：既有调用点（含 6 处测试调用）不传也保持原行为。
- `agent.cordis.yml` 侧可以通过 `budget: compact|rich` 配置——**预设配置本来就把自定义项传进插件**（`maxHistoryChars` 等），所以这条路不需要动设置页。

**验证**：`test-memory` 284 → **289**（+5：standard 逐字等于旧常量、三档键集一致、三档严格递增、未知值回落不抛错、档位被正确穿进 section builder）。

**★ 一条我试了、发现不成立、于是如实登记而没有硬改断言的事（已结案，且结论是我错了）**：「档位真的改变注入体积」这条当时**在夹具下不成立**——`compact` 与 `rich` 得到**完全相同**的 2120 字符。我当时把它记为"中间有什么在缩短 profile 段，我连猜两次都没对"。

**下一轮查清了，是夹具的问题，不是代码的问题**：我把同一段 profile 用**不同预算**量了一遍——`budgets.profile = 100 → 渲染 354 字符`、`2500 → 2453`、`99999 → 2453`。**上限一直是生效的**；我那个夹具的实际内容只有约 350 字符，**远小于 compact 档的 2500**，所以两档都够装、长度自然相同。
> 教训比结论更值钱：**一个不超过上限的夹具，无法用来测上限**。而且我上一轮"登记异常、不硬改断言"的做法虽然方向对（没有把测试调绿），但**结论下早了**——"我查不出来"与"那里有问题"是两件事，我写成了后者。现在断言是真的：`compact 4600 < standard 6096 < rich 8102`，并另有一条"上限是**被强制**的而非仅仅被接近"（rich 8102 < 原始文件 10205）。**变异验证**：① `resolveBudgetTier` 恒返回 `standard` ⇒ 回落断言失败；② 把 compact 换成 standard 的值 ⇒ 递增断言与体积断言同时失败。

**未做（第三批剩余）：Obsidian 设置页的档位下拉框——查档后发现它卡在一条不存在的通道上，不是"还没写"。**

设置项在这套架构里只写插件自己的 `data.json`（`DEFAULT_SETTINGS` → `loadData()`），而**预算档位是 preset 层的配置**（`agent.cordis.yml` 的 `config:` 段，由 `dsh/preset/math-memory.mjs` 的 `normalizeConfig` 读取）。查了两处，**插件里没有任何把它写回 preset 的路径**：

- `agent.cordis.yml` 是**嵌入生成物**（`main.js` 里的 `EMBEDDED_PRESET`），bootstrap 时按它写入；`dsh/host/preset-sync.mjs` 的 `syncPresetTree` 是幂等字节同步，但**插件侧没有调用它**（grep `syncPreset|presetSync|PRESET_SYNC` 在 `main.template.js` 里无命中）。
- 所以一个只改 `data.json` 的下拉框会**写进一个没人读的地方**——那种"看起来能用但什么都不做"的控件比没有更糟。

**当时列出的三条候选通道（用户已选第 2 条，其余两条保留作决策依据）**：

1. **插件写 `$DSH_HOME/<profile>/preset/agent.cordis.yml` 的 `config.budget` 并触发一次 preset 同步**——但这会让插件去改一个当前属于 bootstrap 生成物的文件，需处理"用户手改过怎么办"与字节门禁。**未采用。**
2. **✅ 采用：改由库内文件承载**，与 `capture-policy.md` 同一套路——**用户在设置页改，插件把结果写进库内的文件，preset 读那个文件**。（落地时发现 `.deepseek/config.md` **已经存在**且注释就写着"vault overrides preset, field by field"，所以复用它、只加 `budget` 一个字段，而不是新建文件。）
3. 也可以只写文档让用户改 `agent.cordis.yml`。**未采用**（功能上等价，但对用户不可达）。

**结论（已于同日收口，用户选通道 2）**：档位功能当时**已经可用且已被断言**（改 preset 配置即可生效），缺的只是用户可达的入口，而入口需要先定通道。**用户拍板选通道 2**，同日实现并提交（`44ddb47`）——走库内 `.deepseek/config.md` 的 `budget`，设置页下拉框与 `setMemoryBudget` 均已落地，优先级为**显式 preset > 库内 > standard**。**本条已不再是待办。** 实现细节见本文上一节「预算档位的用户入口」。

## 2026-09-17 · 探针新增 §3 检索成本 Avg-R（第二批之五，第二批收尾）

**依据**：MemForest（arXiv:2609.08273 §5.3.2）用**平均检索轮数**（Avg-R）证明它的压缩把轮数从 3.10 压到 2.6，而不是只报准确率。**命中率把「第一个结果就对」和「翻到第 7 个才找到」记成同一个分数**——后者意味着要连读多条才拿到答案，而这正是用户体验的差别。

**改动**（`scripts/qa/engine-probe.mjs` 新增 §3，**只报告、不做断言**）：

```
Avg-R = Σ(未找到 ? 10 : 目标排名) / 可排名用例数
```

另报中位数、最差名次、名次分布（1 / 2-3 / 4-8 / >8 位各几例）、「排名首位」与「只读前 3 条可覆盖」两个计数，并点名未进 top-8 的用例。

**两个刻意的口径选择**：

1. **未命中按上限 10 计入，而不是从分母剔除**——丢掉找不到的用例会让平均值看起来更好，正是 MSCE 提醒过的"低成本可能来自提前终止"。
2. **不做断言，只做基线**。没有阈值可比，硬编一个会把"当前水平"固化成"正确水平"。它的用途是**改检索前后各跑一次**：Avg-R 下降且命中数不降才算改进（沿用 §2 的门槛口径）。

**实测基线（真实 vault，2026-09-17）**：Avg-R **2.45**、中位数 **1**、最差 **10**、**11 例**；**7 例排首位**、**9 例在前 3**、1 例未进 top-8。那条未进 top-8 的正是 §2 里同为 `Recoverable` 的「定理索引命中」——**两个互相独立的口径指向同一条用例，说明这个数字没有凭空造出问题**。

**附带说明**：`npm run qa` 的引擎探针按设计需要 `DSH_WORKSPACE_ROOT` / `DSH_OBSIDIAN_VAULT`（`qa/run.mjs` 第 2/3 步标题已写明），本机未设时显示 SKIP；本次是显式设好 vault 路径跑的。指标读法已写进 `docs/memory/testing.md`。

**未做**：计划里的「高/低冗余双场景对照」与 §3 的两场景口径——留待后续（现有合成 benchmark vault 与真实 vault 的用例集不同，直接并列比较**不是**"同一机制在两个场景下"的对照，需要先统一用例集）。

## 2026-09-17 · 文献库：索引显示真实状态 + 陈旧提醒（第二批之四）

**问题（文档自己承认过的已知现象）**：`literature/index.md` 的「状态」列是**生成**的，取的是条目里的**机器默认值**（首次建卡时写的 `unread`）；而 `cards/*.md` 跨导入是**保留**的。于是本库的卡片其实**全都 `distilled`**，索引却对全部显示「未读」。`docs/literature.md` 把它记为已知现象，但**不会有任何门禁因此失败**——这正是「文档承诺与实际不符且无人看守」的典型。

**改动**：
- 索引状态**优先读卡片**；卡片不存在（全新导入）才回落到机器默认。
- **陈旧提醒**：卡片 `研读状态` 节新增人工维护的 `- 状态更新：YYYY-MM-DD`，索引据此标注「已停 N 天」，并在有陈旧项时附一段处置建议（未读/待转换 ≥ 7 天、研读中 ≥ 30 天）。**没有这一行就不提醒**——凭空造日期等于凭空造提醒；也**不用文件 mtime**（mtime 会在 `git checkout` 时整体变化，而 `.raw/` 是 gitignore 的再生语料，都无法为一次研读定日期）。
- 已用真实库重跑导入：索引里 25 条现在显示各自真实状态（`已蒸馏` 等）而非「未读」。

**★ 一次环境边界迫使我改了实现方式（值得记）**：第一版把索引逻辑留在 `lit-import.mjs` 内，用一个 `scripts/test-lit-import.mjs` **包装脚本 `spawnSync` 去跑 `--self-test`**。它在本机直接失败：`spawnSync ... EPERM`——**本仓库的沙箱禁止捕获子进程的管道输出**，`execFileSync` 同样 EPERM。按 `docs/agent-repo-maintenance.md` 的规矩，这类"子进程根本没起来"必须与"检查失败"分开报（我确实分了），但**根本问题是这个门禁在本环境里不可能运行**。
> 修法不是想办法绕（指引也明确说不要），而是**改结构**：把索引逻辑抽成 `scripts/lib/lit-index.mjs`（唯一实现），导入器与新门禁**都 import 它**，因此测试**进程内运行、无子进程**。副产品是索引逻辑有了单一真相源——原来那段内联在导入器里，只有跑真实导入才能间接看到。

**验证**：新门禁 `node scripts/test-lit-import.mjs` **10/10**；**两次变异验证**：① `cardProgress` 恒返回空 ⇒ 4 条断言失败；② `isStalled` 恒 false ⇒ 4 条断言失败；恢复后 10/10。真实导入未受影响（`cards 新建 0 / 保留 2`）。

**待办**：把它登记进 `scripts/run-gates.mjs`——**该文件当前被另一项未提交的工作占用**（同那条文档计数漂移），所以本次不越界改动。登记方式是在门禁列表加一行 `{ name: 'test: lit-import index logic', args: ['scripts/test-lit-import.mjs'] }`。

## 2026-09-17 · 否决即收窄适用边界 + 成对的对比指导（第二批之三）

**依据**：MSCE（arXiv:2607.16621 §4.3 生命周期）里"用户否决 ⇒ **shrink**（收窄适用边界 B）"；以及它的决策指导 `D = (context, a⁺, a⁻, evidence, ξ)`——只写"该怎么做"记不住教训，成对写出"该做/该避免"才能把一次失败固化成可迁移的判断。

### ① 否决即收窄边界

**问题**：用户点了「🔁 本次场景不适用」之后，那张卡**下次同类查询还是会被检索出来**（只是权重低一点），因为边界没变。"否决应当收窄适用面，而不只是降低成功率"。

**改动**：
- `note_recall` / `note_strategy` 命中的**查询**现在写进 `cache/retrieval-stats.json` 的 `last_query`。这是必需的：用户点的那条链接**只带路径和动作**，没有查询；不在命中时记住，上下文就永久丢了。
- `applyFeedback` 的 **`inapplicable`** 分支把**本次查询里、且确实出现在本卡中的**短片段（≤2 条，每条 2–12 字）追加进 `not_applicable_when`。只提议"已经在本卡里出现过的词"——那正是**匹配到它的那些词**，也就是它被宣告不覆盖的那个场景。片段必须符合边界语法（`boundarySegments` 的 2–12 字、无标点），否则门控切不准。
- 回执里明说改了什么（「适用边界已收窄：+谱半径（下次这类查询会直接排除这张卡并说明原因）」），用户看得见适用范围变了。

**★ 一处比原计划更精确的语义选择**：原方案写的是"❌ 反馈时收窄边界"。我改成挂在 **`inapplicable`** 上，**`wrong` 不动边界**——`wrong` 说的是**内容错**（该降级），`inapplicable` 说的是**内容对但此场景超出适用范围**，后者才正是边界所记录的东西。挂在 `wrong` 上会**静默改写一张其适用范围从未被投诉过的卡**。

### ② 成对的对比指导 `decision_guidance`

策略卡新增 `decision_guidance.prefer` / `.avoid`（各**一行**、多条用 `;` 分隔），`note_strategy` 把它读出来并渲染成「✔ 建议 / ✘ 避免」。**刻意用单行字符串而非嵌套数组**：卡片里保持可读，且避开本仓库反复踩到的内联 flow 列表陷阱（`[a b]` 会被解析成**一个** token）。

**验证**：`test-memory` 276 → **284**（+8 条）。**四次变异验证**全部被抓住：① 收窄改挂 `wrong` ⇒ 干净卡上边界被写（281/284）；② 去掉"片段必须在卡里"⇒ 凭空造出边界词（280/284）；③ 不再记录 `last_query` ⇒ 写入侧断言失败（281/284）；④ guidance 的 `avoid` 恒空 ⇒ 提取器断言失败（283/284）。

**★ 两处我自己的假断言，都是变异验证抓出来的**：
1. **「`wrong` 不动边界」第一版写在已被 `inapplicable` 收窄过的卡上**——那个词已在边界里，"不重复添加"这行让 `wrong` 什么也没改，**删掉语义约束它照样通过**。改成在**干净卡**上单独跑 `wrong` 才可证伪。
2. **`last_query` 完全没有断言覆盖**：我的测试是手写 stats 文件，所以**删掉记录那行照样全绿**。为此把 `recordRetrievalStats` 导出（调用点在工具处理器内、写入走串行 promise 队列，没有公共纯函数能到达它），直接断言写入。

**★ 一处我自己引入又清掉的噪音**：用 PowerShell 的 `Set-Content -Encoding UTF8` 改 `note-tools.mjs` / `memory-admin.mjs` 时**被写入了 UTF-8 BOM**（`HEAD` 里没有）。它会污染 diff 并可能干扰下游解析。已用 `UTF8Encoding($false)` 清除并复查两个文件均无 BOM。**教训：改这些源文件不要用 `Set-Content -Encoding UTF8`。**

## 2026-09-17 · 第二批的 QA 验证：seed 8/8，以及一条「不是本次回归」的实测结论

按目标要求，第二批跑零 token 的 `npm run qa`。

**① seed 探针先报 7/8，我一度当成回归——查档后确认不是 bug，是真实行为改变暴露了探针的盲点。** `策略召回: 定义层证明` 变成 rank 0：seed vault 里的 `strat-definition-proof.md` **本身就是 `status: candidate`**，而探针只读 `.matches`；note_strategy 分流候选后，那张卡（正确地）进了 `candidates`，探针就看不见它了。**修法是改探针，不是改产品**：把两个分桶合并回按分数排序的一个列表——探针问的是"这个技巧找不找得到"（检索问题），候选策略卡仍是合法检索结果（它是线索，不是已确立技巧），而"是否已确立"由归属表达。修后 **8/8 PASS**（提交 `d54dbb0`）。**教训**：把某个分桶从输出里搬走时，必须同时查谁在读它。

**② 真实 vault 探针 11/12，`定理索引命中` 失败——但这不是本次改动引入的。** 判据不是推理而是实测：用 `git worktree` 在**动手之前的提交** `c12e0c4` 上跑同一条探针，得到**完全相同的 11/12 与同一条失败**。所以这与本批改动无关，而是 **README 记载的 12/12 已经过期**——该 vault 的 `theorems/index.md` 在 **2026-09-16 14:50** 被改过，晚于那条验收记录。
> 本次**没有**去改 README 的那句 12/12：它属于上面那条待办（README/docs 断言数与验收数字需要与另一项未提交的 README 守卫工作一起收口）。**记在这里，避免下次有人重新把它当成本批的回归去查。**

## 2026-09-17 · 晋升的接地门：够格但缺证据的候选不晋升，并点名（第二批之二）

**依据**：MSCE（arXiv:2607.16621 §4.3）只在策略**仍保留证据**、且近期证据仍吻合其触发/过程时才结晶成技能；支持集同时用正证据与反证据。

**改动**：`promote` 增加第三道门——**候选策略卡若无可回溯的 `source`，即使 `uses ≥ 3` 且 `success_rate ≥ 0.6` 也不晋升**，并被点名进 `structuralDetail.promoteBlocked` 与体检清单（措辞说明"补上 source 后会自行晋升"，避免用户以为这张卡被判死了）。

**★ 这里我做了一个比原计划更保守的选择，理由要写清楚**：原计划这一项还包含"跨场合独立支撑门"（`n_min` 个不同 episode）。**我把它否掉了**，因为——

- 本轮的跨场合计数是**按 record 的 `hook.techniques` + `source`** 算的；而策略卡的 `moves` 指向的是 `retrieve` 目标，**不是 episode**。两者不是同一个东西。
- 拿"record 的技巧跨了几个场合"去卡"某张策略卡能不能晋升"，**等于用不描述这张卡的数据改变它的状态**。而且每个候选都会因此被静默改动，既没有测试覆盖也没有数据支撑。

所以本步**只落地能可靠判定的那一半**（来源接地），跨场合的**建议**仍由体检报告给出、决定权留给读者。门控本身也刻意设计成**只能"因为缺来源"而阻断，绝不额外索要字段**——否则会索要诚实卡片本来就不该有的字段，把它们变成永远无法晋升。

**验证**：`test-memory` 272 → **276**（新增 4 条：缺 source 不晋升、被点名且给出原因、清单说明补 source 会自行晋升、补上 source 后同一张卡确实晋升——**后半条同样重要**，它证明这门是"阻断"而不是"惩罚"）。同时把三处候选策略夹具补上 `source`（真实模板本就要求 `provenance`/`source`，补上是让夹具更真实，不是削弱断言）。**变异验证**：把门控条件改成恒假 ⇒ 无来源的候选被晋升、`promoteBlocked` 为空，3 条断言失败（273/276）；恢复后 276/276。

## 2026-09-17 · 跨场合支持计数：一次是轶事，多次才是方法（第二批之一，数据层）

**依据**：MSCE（arXiv:2607.16621 §4.2）在同一个签名桶凑齐 `n_min` 个**不同 episode** 的证据之前**拒绝归纳策略**，理由写得很直白——否则一条长轨迹自己就能铸出一条过专的规则。MemForest（arXiv:2609.08273 §3.2）把"同一个事件"定义为**语义相近 + 时间相邻**，权重 0.8/0.2。

**★ 查档纠正了立项时的一个前提**：原方案假设策略卡记录了"哪些 episode 用过它的 move"。**它没有**——`strategy` 卡与 episode 之间**没有任何链接**，`card.uses` 数的是被**检索**的次数，所以回答不了"这个招数在几个不同场合奏效过"。按「以臆猜接口为耻」，改用**真实存在的那条链路**：`records.hook.techniques` + `records.source` → 指向的 episode。最终用户要的答案（哪些技巧是方法、哪些只是一次性）不变，只是数据源换了。

**改动**（只报告，**不改任何卡的状态**）：

- 统计每个技巧出现在几个**独立场合**。"同一场合" = 同一 episode 桶，其中**相隔 ≤ `OCCASION_WINDOW_DAYS = 3` 天**的 episode 合并为一个桶（跨天完成的推导是一次使用，不是几次）。**无日期的证据自成一桶、绝不与其它无日期证据合并**——凭空制造邻近就是凭空制造支持。
- **无可用 `source` 的卡不计入**：没有溯源的证据不能声称任何场合。
- 达标（`≥ OCCASION_MIN = 2`）的技巧进 `sections.independentTechniques` 并在体检清单里单列，措辞点明区别：「这些可以当方法用，一次性的只能当线索」。只列达标的——把每个一次性技巧都倒出来就是数据倾倒。

**验证**：`test-memory` 266 → **272**（新增 6 条：相隔 10 天算两个场合、同日算一个、相隔 2 天仍在窗内、只出现一次不入列、无 source 不能制造第二个场合、清单给出区别说明）。**两次变异验证**：① `OCCASION_WINDOW_DAYS` 设为 −1 ⇒ 同日与邻近都被算成独立场合，2 条断言失败（270/272）；② 去掉"无 source 不计入"的保护 ⇒ `once` 被凑成 2 个场合而入列，2 条断言失败（270/272）；恢复后 272/272。

**★ 第二次变异验证暴露了我自己的一个假断言**：第一版夹具给这张无源卡起了一个**独有的技巧名**，于是删掉那行保护后**什么都不会变**（空 source 自成一桶，计数仍是 1），断言在变异下照样通过——**它没有在测那行保护**。把无源卡改成与"只出现一次"的卡**共用同一技巧名**后才真正可证伪（空 source 被当独立 episode ⇒ 凑够 2 个场合 ⇒ 入列 ⇒ 报错）。这是本项目第二次出现"断言不可证伪"，两次都靠变异验证抓出来。

**下一步（未完成）**：把该计数接进 `promote` 作为跨场合门（本步刻意只交付数据层，让行为改动可单独审阅/回退）。

## 2026-09-17 · 净增益 `gain`：把「被检索到」和「真帮上忙」分开（第一批改进之五，第一批收尾）

**问题**：`uses` 数的是**被检索出来**的次数，不是**帮上忙**的次数——一张卡被检索 20 次、其中 18 次读了就弃用，和一张真解决了 20 个问题的卡，在 `uses` 上完全一样，排序却因此奖励"被提到"。`harmed` 更弱：它只出现在体检报告里、**不参与排序**，而且是单侧计数，表达不了净收益。

**依据**：MSCE（arXiv:2607.16621）用 `G = V̄_with − V̄_blend(S_without)` 做全部治理决策，并且**在负面证据稀薄时向保守基线收缩**（`N_0 = 5, b = 0.5`）而不是让单个样本决定；GraphMemix 的净回收带符号（−6/−36）；MemForest 的 Minimum 对照比随机更差。三篇都在警告：**只统计单侧会系统性高估**。

**改动**：

- 新增机器维护的 `hook.gain` ∈ {−1, 0, +1}：**只由用户显式反馈推出**——❌（`harmed`/`needs_review`）⇒ −1，✅（`verified_by: user`）⇒ +1，无反馈或缺席 ⇒ 0 中性。**冲突裁决（先❌后✅）取中性**，不猜。
- **刻意不采纳的信号**：「用户继续追问」——追问可能只是好奇，噪音负分比没有负分更糟（这正是用户拍板时认同的那条）。「卡片被 superseded」也排除：它说的是**过时**，不是**用了更差**。
- 排序消费它：权重**从「使用次数」里划出**（`0.25 → 0.15 + 0.10`），总量不变、可回退。**负值会把卡压到未评级卡之下**——这才让它不只是装饰。`gain` 与其它专有字段一样做**脏值钳制**。
- 缺席即中性、**不写 `gain: 0`**；裁决被后续 ✅ 解决时**删掉那一行**（留着就是系统已不再主张的声明）。

**一处设计修正（自查发现）**：`gain` 的写回最初被我挂在 `maintainHookStats` 开关下，结果关掉统计维护时**用户的 ❌ 会静默丢失**。已解耦：`gain` 是**结果裁决**、不是使用统计，无论该开关如何都要落盘。同时把它移到统计合并**之后**写，避免用合并前的 `uses` 覆盖（第一版正是这样引入了两条回归）。

**验证**：`test-memory` 260 → **266**（新增 6 条：三种裁决、写回 hook 块、无反馈不留行、✅ 清除过期负裁决、排序消费且负值低于未评级、越界值仍钳制）。**两次变异验证**：① `hookPrior` 去掉 gain 项 ⇒ 三张卡先验全变 0.375，断言失败（265/266）；② `cardGain` 的负分支恒返回 0 ⇒ 裁决与写回断言失败（264/266）；恢复后 266/266。`auditReport.structuralDetail.gains` 现给出**权威的逐卡裁决清单**（含 0），面板与测试共用。

## 2026-09-17 · 依赖方向 + 失效级联：某张卡的依据变了，谁知道？（第一批改进之四）

**问题**：卡片之间只有 `related`（无方向的「另见」）。于是有一个很实际的问题**没有任何东西能回答**：当一张卡被标 `superseded`、或被用户点 ❌ 标成 `needs_review` 时，**哪些卡是踩在它上面的、需要重读？** 你只能靠自己记得。

**依据（三篇文献指向同一处，是本批最集中的共识）**：Danus（arXiv:2607.06447）的每条已验证事实**连同依赖它的入边一起保存**，事实图**可级联撤销**；MSCE（arXiv:2607.16621）要求每个技能保留**证据锚点**以便回溯「这条凭什么可信」；MemForest（arXiv:2609.08273）在边权里给高连接节点降权，理由同样是**影响面**。

**改动**：

- 新增**有方向**的 frontmatter 字段 `depends_on`（「本卡建立在这些卡之上」），写入 `records` 与 `templates` 模板，并在 `records/_README.md` 与 `vault-AGENTS.md`（体检响应）写明纪律。**关键区分**：`related` 是无方向「另见」，`depends_on` 是有方向「依据」——两者的区别不是格式，而是**能不能回答上面那个问题**。
- 体检新增「**下游待复查**」段：依据变动的卡（`superseded` / `needs_review`）⇒ 列出**直接**依赖它的卡，**两端都点名**并给出变动原因（"已被取代" vs "被标为待重审"——读者对这两种原因的处理不同）。进入 `sections.downstreamReview`、`structural.downstream`、体检清单与人类摘要，并计入 `decisions.total`（**每张下游卡各算一件**：每一张都是独立判断，合并计数会掩盖一张错前提的影响范围）。
- **只报不改**：与 `usesMismatch` 同一条纪律（"报出来，绝不自动重试"）——依据被改写后下游是否仍成立，只有读原文才能判断。

**两个刻意划下的边界**（都有断言守住）：

1. **不追传递链**。A ← B ← C 中 A 失效时只报 B，不报 C。追下去需要置信度传播模型，而对人来说"整条链下游全都列出来"是噪音。C 会在 B 自己被标记时再被报出。
2. **无方向的 `related` 不参与级联**。把 `related` 当依赖会让清单立刻失去可信度（这是变异 1 专门验证的行为）。

**验证**：`test-memory` 252 → **260**（新增 8 条：空态不报、直接下游被点名、原因被说明、`related` 不级联、不算自我依赖、计入 decisions、清单点名两端、`needs_review` 同样级联且有各自原因）。**两次变异验证**：① 级联改读 `related` ⇒ 对照组「仅相关丁」被误报，3 条断言失败（257/260）；② 去掉「依据变动」判定 ⇒ 空态就报出下游，4 条断言失败（256/260）；恢复后 260/260。`check-engine-sync` 通过（本项只动 preset 那一份）。

## 2026-09-17 · 疑似重复按相似度排序 + 结构枢纽保护（第一批改进之三）

**依据**：MemForest（arXiv:2609.08273）的两组对照——它的消融显示**合并"最不相似"的一对（89.0%）比随机挑一对（91.7%）还差**，而合并"最相似"的一对是 96.0%；理论侧 Eq. 15 给出原因（两节点越相似，幸存者与查询相似度的下界越高）。它同时把**高度数节点**在边权里降权，理由是"高度数节点通常是核心，不应被过早合并"。

**改动**（`dsh/preset/math-memory.mjs`）：

1. **重复对先收集、后按 Jaccard 降序排序**。原实现把 `duplicates.length < 3` 放**内层循环条件**里，扫描到 3 对就停 —— 所以"前 3 对"实际是"最先遇到的 3 对"，排序会被这个提前退出吃掉。现在收集全部再 `sort`，再在渲染时 `slice(0,3)`。
2. **结构枢纽**：用**零成本的反链计数**（`related`/`source` 里指向本卡的链接数，未知目标不计），≥2 处引用的卡进 `sections.hubs` 与 `structural.hubs`，并在体检清单与人类摘要里单列。它**不删除任何建议**：重复对照样报告，只是在含枢纽的那一对上标注"不要覆盖枢纽那一侧"。
3. 重复对现在**携带 `jaccard` 分数**（原先只用它做过滤，报告里看不到证据强度）。

**★ 写这条断言时踩的坑（值得记，因为全是"夹具错、不是代码错"）**：

- **流式数组按逗号分隔**：`techniques: [gamma x]` 被解析成**一个** token `"gamma x"`，不是两个。
- **`pattern` 无论写几个词都只算一个 token**（`hookText` 把数组 join 成空格后整体 tokenize，`pattern` 是字符串 ⇒ 一个 token）。
- **`0.75` 需要每侧 3 个 token（2 共享 / 1 独有）**，不是"2 个共享 token"——我连着算错三次，两次把 0.6、0.5 当成了 0.75。
- **最关键的坑：断言一开始不可证伪**。卡片按**文件名**顺序被收集，所以我把强组写成 `dup-b*`、弱组写成 `dup-c*` 时，扫描序恰好就是降序 —— **去掉排序断言照样通过**（第一次变异验证就这样失败地"通过"了）。把强组改写到 `dup-c*`、弱组写到 `dup-b*` 之后，去掉排序会得到 `[0.75, 1.00]` 并如实报错。

结论与 `docs/agent-repo-maintenance.md` §1 的老教训同源：**变异验证不是形式，它是唯一能证明"这条断言真的在测东西"的手段**；而**手算替代不了测量**——所有夹具分值最后都是跑真实 tokenizer 量出来的。

**验证**：`test-memory` 246 → **252**（新增 6 条：排序、最强对领先、分数被携带、枢纽计数、非枢纽不被误报、清单点出枢纽）。**两次变异验证**：① 去掉 `sort` ⇒ 顺序变 `[0.75,1.00]`，两条断言报错（250/252）；② `HUB_BACKLINKS` 抬到 3 ⇒ 枢纽被漏掉，两条断言报错（250/252）；恢复后 252/252。`check-engine-sync` 通过（本项只动 preset 那一份，`structural` 不在 22 个共享符号内）。

**⚠️ 连带未完成项**：断言数 240 → **266**，`check-doc-consistency.mjs` 因此报**六处**数字漂移——`README.md`、`README.zh.md`、`ARCHITECTURE.md`（两处）、`docs/memory/README.md`、`docs/handoff.md`（两处）。这些文件当时**已被另一项未提交的工作（`scripts/check-readme-pair.mjs` + `README.i18n.yaml` 的中英配对守卫）修改**，故本次**故意不改**它们（避免把别人的半成品一并提交、并让 `README.i18n.yaml` 的 blob hash 立刻失效）。**这是待办，不是已修**：那项工作落定后把这些数字从 240 改成 266（或跑一次守卫提供的更新方式）即可。

## 2026-09-17 · `status: candidate` 变成权限：`note_strategy` 分组返回

**问题**：`strategy-readme.md` 与 `vault-AGENTS.md` 一直写着「策略卡是**候选**不是**指令**」，但代码层面**没有任何东西**阻止一张 `status: candidate` 卡被当成已确立的技巧使用——`rankStrategyCards` 只排除 `superseded`，而且**输出里根本没有 `status` 字段**，模型拿到的 `matches` 里 `active` 与 `candidate` 完全无法区分。这正是「文档承诺的纪律没有落到机制上」。

**改动**（外部依据：VeryMath 的 Co-Mathematician 把门控做成可程序检查的状态机——"草稿目标不可执行，只有 `approved` 才能接收工作流"）：

- `rankStrategyCards` 新增 `candidates` 桶，把**显式** `status: candidate` 的卡从 `matches` 分流出去；`matches` 与 `candidates` 的每一项新增 `status` 字段。
- `note_strategy` 的输出 schema 同步新增 `candidates`（并给两个数组的 item 加 `status`）；渲染时把候选单列，并写明「可以把 moves 当线索试用，但**不得当作已验证技巧引用**」。
- 工具描述补一句：`matches` = 现在可依据；`candidates` = 仍是线索。

**一个刻意的边界**：**只有显式声明的 `candidate` 才被分流**。status **缺失**或取值未知的卡**留在 `matches`**，行为与改动前完全一致——因为每日体检读的是 `meta.status ?? "active"`（`math-memory.mjs:1255`），若在这里静默把老卡降级，等于**改变了模型被允许依赖什么**，而"权限只在该库真的声明了的地方收窄"才是可预期的规则。这条差异有专门断言守住。

**验证**：`test-memory` 240 → **246**（新增 3 条状态权限断言，其中一条专测"未声明 status 仍在 matches"）；`test-tool-schemas` 的 fixture 被守卫如实拦下（`missing required property "value.candidates"`）→ 更新 fixture → 26/26；`test-tool-shape` 11/11（它断言"实际返回值没有未声明字段"）。**变异验证**：把 `matches` 的分流表达式改回 `eligible.slice(...)` ⇒ 断言如期报错（候选同时出现在两个桶里，245/246）⇒ 恢复 ⇒ 246/246。

## 2026-09-17 · 八荣八耻入档 + 字段所有权显式化（第一批改进之一）

### ① 八荣八耻：放进已有的维护方法文档，不新建文件

`docs/agent-repo-maintenance.md` 本来就是「给 agent 的仓库维护方法（通用）」，AGENTS.md §1 已把它登记为入口 ⇒ 按「复用存量」原则新增为 **§0.5**（用小数编号是为了**不给现有 1–10 节重新编号**——重编号会让所有交叉引用瞬间腐烂）。`AGENTS.md` 只加一行「§0.5 = 八荣八耻，动手前先读」，不把正文抄进这份**每个 agent 都会被注入**的协议（它已 107 行，继续膨胀会稀释真正关键的铁律）。

每条都映射到本仓库的可观察动作，例如：臆猜接口 → 先 `read` 到定义再 `grep` 全部调用点，且**注意两份同名实现**；省略校验 → 变异验证 + 断言锚在代码不锚在数据；乱改架构 → 改 `dsh/**` 必须重建 `main.js`；批量乱改 → 一次提交一件事、**别顺手带上别人未提交的半成品**。

### ② 字段所有权：从「多处提醒」收敛成一张表

**触发**：读代码时发现原先的评估不够精确——插件专有字段其实是**不可信输入**。

`uses` / `success_rate` / `last_used` / `harmed` / `verified_by` 的写入者是插件，但它们的**读取路径**是「从用户可编辑的 markdown 解析文本 → `hookPrior` 打分」。也就是说：模型不该写它们，可**用户手改、模型违规改、插件回写失败**三种情况都会让脏值进入排序。

**三处实证（先查档再动手的收获）**：

1. `structural`（结构校验）住在 **preset 那一份** `math-memory.mjs`，**不在** `check-engine-sync.mjs` 的 22 个共享符号里 ⇒ 这项改动只动一处，**不受双份实现约束**（若按"改一处必改两处"的直觉行事，会白改 `memory-admin.mjs`）。
2. `structural.usesMismatch` 的语义**不是**"模型篡改统计数字"，而是**回写是否落地**的事后校验（只读文件 / 并发编辑 / 解析意外），注释明确「报出来，绝不自动重试」——原评估把它误读成"没有覆盖统计字段越权"，实际是两件事，不该合并。
3. `hookPrior` **已经**消费 `verified` / `success_rate` / `uses` / `last_used`（`note-tools.mjs:501`），所以"让统计字段参与排序"**不需要新机制**，缺的只是**文档契约**。

**改动**：

- `docs/memory/design.md` 新增 **§5.1 字段所有权**表（谁有权写哪个字段 + 数据流 + 两条守卫）。**所有权以该表为准**，模板里"不要手写"的措辞是它的面向用户副本。
- `hookPrior` 改为对每个专有字段钳制取值、并对最终结果整体钳制到 `[0,1]`。**量纲内行为不变，故既有排序不移动**；只把手改 `success_rate: 5` / `uses: -3` 这类值挡在量纲外。
- `scripts/test-memory.mjs` 新增 3 条断言（超范围成功率、负 uses、畸形值退化），**240 → 243**。

**变异验证（AGENTS.md §6 要求）**：把 `uses` 的钳制还原成旧的 `Math.min(...)`（允许负数）⇒ 断言如期报错 `neg=0 zero=0.655`（242/243）⇒ 恢复 ⇒ `git diff` 只剩本次有意改动。**验收标准是"它在该报错时确实报错"**，不是"跑了没报错"。

**重建产物**：`note-tools.mjs` 在 `EMBEDDED_SOURCES` 里 ⇒ 跑 `build-obsidian.mjs`（main.js 529488 字节），`check-bundle-freshness.mjs` 字节级通过。


## 2026-09-14（第二轮）· 用户实测两问：`note_recall` 报 schema 错、回复里的双链不能跳

用户原话：①「模型回复说 note_recall 目前返回结构不合 schema（工具侧报错），我改用 note_search/grep 走同样的路由」；②「现在 dsh 回复中的双链依旧无法跳转对应笔记」。

### ① 三个真实的工具契约缺陷（其中一个把 `note_recall` 整个打死）

dsh ≥0.1.5 会对**成功返回值**做严格校验（`validateJsonSchemaValue`），而我们的 output schema 是 `additionalProperties: false` ⇒ **多一个字段就整次失败**。查出来的三处：

| 位置 | 缺陷 | 后果 |
|---|---|---|
| `rankRecallDocuments().matches[]` | 多带 `hook` / `boundary`，被原样返回给 `note_recall` | 每次 `note_recall` 都可能报 schema 错 |
| `boundaryHitsOf(entry)` 与 `excluded` 的 map | 写成 `entry.doc.X`，而 `entry` **本身就是** `{ doc, … }` | **只要有一张卡被适用边界排除，`note_recall` 直接抛 TypeError** |
| `note_create` / `note_strategy` | `rel` 不是声明里的 `path`；`excluded` 多带 `kind`/`score`；`note_strategy` 少必填的 `title` | 调用报 schema 错 / 字段缺失 |

`entry.doc` 那条是**零覆盖分支**：记忆回归测的是打分与排名，从不读 `excluded` —— 坑 68 那族（没有用例走到的分支不算被测过）。

**修法**：在工具边界收窄返回值（管线内部保留 rich 值），补齐 `note_strategy` 的 `title`。**新增两个门禁**：`test-tool-schemas.mjs`（静态"声明了却没出现" + 用 dsh 真校验器跑 fixture + `--mutate` 变异验证）、`test-tool-shape.mjs`（**真调管线**、递归比对声明与实际，并留一条"直通值必须被判违规"的反证）。

**一条设计教训**：静态文本检查**不能**用来找"多字段"。第一版用"逗号/冒号切 token"读键，把 `path: a ?? "all"` 里的 `:` 当成键分隔符，报出 `all`/`rel`/`null` 等 **4 条假阳性**；**假阳性比不检查更糟**（它会教人忽略这个套件）。现在静态只报"缺"，"多"交给真值测试。

### ② 双链不能跳：链接服务的端口/令牌一重载就变

模型回复里的链接是 `http://127.0.0.1:<LinkServer 端口>/open?path=…&t=<令牌>`，**写进系统提示**；而提示只在 dsh 子进程启动时生成一次。原先端口 `listen(0)` 随机、令牌每次加载重新生成 ⇒ **插件一重载，此前所有回复里的链接立刻失效**（端口没人听，或令牌对不上 403）。

实测证据：把最近的 vault 会话（V3 多帧 zstd，逐帧解开 1.25 MB 文本）里的真实链接抽出来，指向 `127.0.0.1:52269`；`netstat` 显示该端口早已不存在，同一时刻**任何**回环端口上都没有 LinkServer 在听。

**修法**：端口与令牌进 `data.json`（`linkServerPort` 默认 39217 / `linkServerToken`），启动时复用；被占则回落随机端口并写一行日志。**新增门禁** `test-link-server.mjs`（12 项：固定端口、重载后端口/令牌不变、占用时回落不抛、两端点的令牌与路径穿越判定）。**旧的已生成链接仍然打不开**——要有新回复才会带上新地址，所以"把链接模板改成运行时注入"是明确的下一步。

## 2026-09-14 · 「新建会话」静默失效（preset schema 漂移）+ 卡顿随文档规模增长的实测

用户报两件事：① Obsidian 侧栏里的 dsh「新建对话按钮无法新建对话了」；② 卡顿不是一启动就有，**用久了才出现**，怀疑是"什么东西一直在堆积"。

### ① 新建会话失效：不是前端，是 preset 挂载失败（HTTP 200 + `ok:false`）

**排查路径**（值得复用）：不猜前端，直接把**真实 dsh** 跑起来、用 headless Chromium 经**插件自己的反代**打开，用 CDP 真实鼠标点那个按钮，然后把 `Runtime.consoleAPICalled` 与 `Network.getResponseBody` 都读出来。第一次运行就拿到完整错误链：

```
new session failed: SessionCreateError: session create failed: agent-preset/invalid:
  agent-presets: preset "notes-assistant" failed to mount:
  failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid config:
  - $.prefix missing required value (at prefix) (…/.agent-presets/notes-assistant/agent.cordis.yml)
```

**根因**：`dsh/preset/agent.cordis.yml` 的 persona 行的配置字段写的是 `text:`，而 `@deepseek-ai/dsh-persona` 0.1.5-rc.1 的 `Config` 是 `prefix: z.string().required()`（+ `suffix` 默认空）。字段不认识 ⇒ 校验失败 ⇒ preset 挂不掉 ⇒ 每次建会话都失败。响应体是 `{"type":"server-response","result":{"ok":false,"error":{"code":"agent-preset/invalid",…}}}`，**HTTP 是 200**，前端只 `console.warn`，所以用户侧表现为"点了没反应"。

**为什么"以前能用"**：本机 dsh 于 2026-09-10 14:02 升级到 0.1.5-rc.1，而 `bootstrapDshConfig` 对 `agent.cordis.yml` 用 `force=false`（保护用户手改），所以升级后 preset **不会自动跟上新 schema**。这是坑 70。

**修法**：仓库与已安装 preset 的 `text:` → `prefix:`（不改文案；`{{model}}`/`{{cwd}}` 仍是 prompt variable，照旧解析），重建 `main.js`。

**守卫（新门禁）**：`scripts/test-agent-preset.mjs`（零 token，需要本机 dsh 否则 SKIP）。9 项断言：仓库 preset 用 `prefix`、不含 `text`；**已安装** preset 同样；真的调 `/api/session/create` 并断言 `ok:true` 且错误里没有 `failed to mount`。
**变异验证**：把已安装 preset 改回 `text:` → **5/9 红**并打印上面那条原始错误；改回 `prefix` → **9/9 绿**。

### ② 卡顿：随"当前会话的渲染树规模"增长（同轮同 harness，`sidebar-newchat-probe.mjs`）

| 文档元素数 | 每次样式重算 | 帧 >50ms | 最差帧 | LoAF |
|---|---|---|---|---|
| 730（空会话 hero） | **1.2 ms/op** | 0–1 | 50–67 ms | 1–3 |
| 12 731（注入 3000 行占位内容） | **19.9 ms/op（16.6×）** | 52 | **533 ms** | 54 |

与 2026-09-11 真实 Obsidian 的读数（13 102 元素、410 次重算 22.76 s = **55 ms/op**）同一量级——真实的会话节点比注入的纯 div 还贵。⇒ 用户在"关掉其他程序 + 重启 Obsidian"后连续 2 小时流畅，是因为**换了新会话**（文档从 13k 节点回到几百），不是"关程序"本身；关闭其他程序只是让内存压力这个**放大器**消失，而已经变大的文档不会因此变小（所以当时"没有马上恢复"）。详见 `handoff.md` 坑 71 与 `docs/memory/sidebar-performance.md` §0.3。

### 发布 0.7.6：又一条"红得没有道理"的 npm 流水线（坑 72）

`git push origin main`（CI 双平台绿）→ `git push origin 0.7.6`。Release 一次成功（4 个资产、notes 正确取到 `## [0.7.6]` 段）。npm 那条**判红，但包其实发出去了**：`Publish (trusted publishing)` 步 **success**、日志有 `+ dsh-math-memory@0.7.6` 与 provenance 上链记录，可紧接着的 `Confirm the registry state` 在 **60 秒**内查到的还是 missing ⇒ 开了 issue #3 并 fail job。

实测 **约 60–80 秒后** registry 才出现 0.7.6（`latest` 才翻过去）。**处置 = Re-run failed jobs**（`POST /actions/runs/<id>/rerun-failed-jobs`）：第二次跑确认到版本、job 转绿、issue #3 自动关闭。**这条红不需要改任何代码**。与坑 58 的两种情形同族但方向相反：那两条讲"退出码在撒谎"，这条讲"**registry 的可见性有延迟，查早了就是假红**"。

## 2026-09 · 新守卫的第一次 CI 运行就红：换行，以及"本地全绿"是假的

用户报「npm test 好像有一个出问题了」。是 GitHub Actions 的 `CI`（run 65，我推的 `3ce0835`）：**上一次 run 64 是绿的**——因为出问题的这道门禁（`check-client-bundle.mjs`，客户端产物新鲜度）正是这 22 个提交里新加的，**它从未在 CI 上通过过**，我这一推才把它暴露出来。GitHub API 确认：`test (windows-latest)` failure、`test (ubuntu-latest)` success（含 ubuntu 的 `npm test` 步骤）。

**现象**：`committed 14456 bytes vs fresh 14445 bytes`——两个数字只差 11。

**根因：11 恰好是这个文件的换行数。** 守卫用 `readFileSync(..., 'utf8')` 读提交进仓库的产物，与一次全新构建**逐字节**比较。Windows runner 的检出带 `core.autocrlf=true`，产物到手是 **CRLF（14456 字节）**，而构建输出是 **LF（14445 字节）**，差值正好等于文件里 **11 个 LF**。注意 `git ls-files --eol` 显示 `i/lf`（blob 是 LF）——**blob 的换行不等于检出后的换行**，后者由 `core.autocrlf` 决定。ubuntu 上两侧都是 LF，所以同一次 push 两个 job 一红一绿。

**这是坑 57 的复发**：`check-bundle-freshness.mjs`（main.js）早就用 `s.replace(/\r\n/g, '\n')` 修过同一件事，注释里也写了原因；后写的守卫没照做。

**更值得记的是它为什么在我的机器上连显都不显**：本机沙箱禁止 esbuild 的**子进程**（`spawn EPERM`），守卫**如实打印了 SKIP**、只跑形状检查，然后 **exit 0**；而 `run-gates.mjs` 只按退出码判成败，于是汇总照打 **34/34**。我连续几轮把"34/34"读成"全部验证过"——**其实第 26 条什么都没比**。这与坑 68（"守卫看起来在工作"）同族，但主体不同：**守卫没撒谎，是汇总把 SKIP 抹平了**。

**修法**：比较前两侧都做 `\r\n → \n` 归一化（与 main.js 那道守卫一致）。

**变异验证（三步全部实做）**：

1. 把产物强制检出成 CRLF（注意：`git checkout -- <file>` 在内容未变时是 **no-op**，必须 `Remove-Item` 之后再检出；实测 `bytes=14456 CRLF=11`）→ **修前**的输出与 CI **逐字一致**，修后 5 项全 ok；
2. 故意追加 7 字节让产物过期 → 仍然 FAIL（`14452 vs 14445`），证明没有把守卫改成恒真；
3. 重建（`node dsh/client-panel/build-client.mjs`）→ OK。

**副产品两条**：

- `core.autocrlf=true` 会让"LF 工作区 vs LF blob"在 `git status` 里显示成 `M`，但 `git diff --quiet` 退出 0、`git hash-object -- <file>` 与 `git rev-parse HEAD:<file>` 相同（实测 `f2e2bfbc…`）⇒ 那是 stat 假象。判断"到底改了没有"要用哈希，不要用 status。
- 已记录为**坑 69**；`AGENTS.md` §4 里"若它绿，你是真的绿"那句**已就地更正**（补上"绿只等于退出码 0、门禁内部的 SKIP 不被汇总区分"）。**未做、登记为后续**：让 `run-gates.mjs` 把门禁内部的 SKIP 显示出来（需要一个 `__SKIP__` 约定），以及加 `.gitattributes` 把换行钉死——两者都属另一次改动。

**验证范围**（按 §4 的要求写清）：`node scripts/check-client-bundle.mjs` 单独跑了 4 次（CRLF 修前 / CRLF 修后 / 变异 / 恢复），另跑全量 `npm test` = **34/34**——其中该条在本机仍然 SKIP，**这正是本文的主题**。

## 2026-09 · 独立端口：哪一半是必要的，哪一半只是习惯

用户问：「就实现 dsh 其他使用与笔记使用互不干扰这一点来说，独立 3180 端口有必要吗？独立端口相比其他方案优劣如何？」本文记录**结论与依据**，全文见 [`port-and-isolation.md`](port-and-isolation.md)。**只做了研究，没有改代码。**

**结论一：独立的 authority（=独立端口）是结构必要的，不是设计偏好。** 推理链只有三步，但每一步都有硬证据：① dsh 一个进程只能挂一个 profile —— 已安装包 `@deepseek-ai/dsh/lib/bin.js` 里 `--profile <name>` 是**单值**参数，`dsh web` 只是 `--profile web` 的别名，所以"编程用的"与"笔记用的"必然是**两个进程**；② 每个进程都要对外提供 web UI ⇒ 两个监听端点；③ 端点 = (地址, 端口)，两者都绑 `127.0.0.1` ⇒ **端口必须不同**。想绕开只有两条路：换回环地址（`127.0.0.2`，可行但更怪）或让一个进程挂两个 profile（**上游不支持**）。换 hostname 没用——`localhost:3180` 与 `127.0.0.1:3180` 是**两个 origin**却不构成**两个端点**，第二个进程照样绑不上。

**结论二：3180 这个固定数字不必要——而且它自己制造了一个干扰。** 机制上没有任何地方依赖它：反代 `listen()` 后立刻用 `server.address().port` 反推 authority（`main.template.js:685-689`），兑换 cookie 时把该 authority 当 `Host` 送出去（`:715-743`）。**只要"实际绑定的端口"与"兑换时声称的 authority"是同一个值，0 号端口（OS 分配）也完全成立。** 反过来，固定默认值有一个真实代价：设置存在 **vault 内**的插件数据里（`loadData`/`saveData`，`:2640-2644`），每个 vault 各自一份、默认都是 3180；第二个 vault 的实例预检到"端口不是 down"就**直接抛错**（`:1056-1059`），`resolveAuth` 也没有回退（`:969-989`），而 Notice 的措辞是"被**其他服务**占用"——不会告诉用户那是**另一个 vault 的自己**。**这是当前唯一由端口引发的干扰。**

**结论三：端口不是"互不干扰"的主要杠杆。** 端口买到的是独立 origin 与独立生命周期；可下列干扰**一条都不受端口影响**：会话列表两侧共享（`DSH_SESSIONS_ROOT` 不是这个开关，见 `main.template.js:1081-1084` 的注释）、归档状态写在全局 `$DSH_HOME/storages/workspace.json`（`session-scope.md` §2.3，且"收窄会话列表"已被用户否决）、同一会话不能两边同开（dsh ≥0.1.5 会话写锁）、皮肤走全局 `cordis.patch.yml`、`$DSH_HOME` 本身共享。**另外记了一条未经证实的假设**：两端写 `.deepseek/memory/**` 都是就地 `writeFileSync`、没有锁（只有索引缓存用了 staging+`renameSync`），因此面板的归档/改名与笔记侧的捕获/蒸馏**理论上**可能丢更新——**按本仓库的教训，先实测再当结论**，不要从"两端都写"直接推出"会丢"。

**一个反直觉的自证**：插件里**早就**在用动态端口——给 agent 回复用的 `DSH_MATH_MEMORY_LINK_URL` 指向 `LinkServer`，它 `listen(0)`、每次启动换端口且换 token（`:267-271`、注入点 `:1074`）。它照样好用，因为那个地址是**写进 prompt** 的，不是**被人记住**的。也就是说"稳定端口"从来只是给人看的便利，不是机制的必需。

**建议（未实施）**：保留 3180 作首选，把"占用即失败"改成"占用即回退到 OS 分配"，并在状态栏/Notice 显示**实际地址**；实现时注意 `resolveAuth` 用 `proxy.port !== wanted` 判断是否需要重听，直接把 `wanted` 设为 0 会导致每 300 ms 反复重绑、每次换端口并让已兑换的 cookie 失效——需要一个"请求端口"字段。**明确不做**：同端口 + 路径路由（两种 UI 同 origin 会互相污染界面状态，且侧栏变成依赖用户的实例在跑）、另一个回环地址、复用 3080 那台。**记录在案等触发条件**：同源 iframe + `postMessage` 桥（唯一能同时消灭 SameSite 反代与端口的路子，但要改 dsh web 的客户端传输层）。

## 2026-09 · 附着到真实 Obsidian：把"侧栏卡顿"从未测量的那一半量出来

用户问「侧栏性能是不是查错了对象」。要在**真实 Obsidian** 里量这一层，先得能驱动它；而这件事本身踩了三个坑，值得完整记下来。

**方法**：给 Obsidian 开 `--remote-debugging-port=9222`（它也是 Electron，Chromium 内核，因此接受 Chromium 的调试开关），于是 `/json/list` 直接给出两个 target：宿主 `app://obsidian.md/index.html` 与 **iframe `http://127.0.0.1:3180/`**（就是侧栏里的 dsh 面板）。用与既有探针**同一套 CDP 代码**连它们即可。

**坑 1：开关"没生效"其实是单实例**。Electron 应用是单实例的——Obsidian 已经开着时，再启动一次 exe 只会把旧窗口切到前台，`--remote-debugging-port` 被丢弃。**必须先彻底退出再从终端启动**；验证办法是浏览器打开 `http://127.0.0.1:9222/json/version`。

**坑 2：被遮挡的窗口不渲染，`frames=0` 会被误读成"零掉帧"**。第一次采样两侧都报 `frames=0`、`Task=0.003 s`，看起来"极其流畅"——实际是 `document.visibilityState === 'hidden'`（窗口最小化/被完全遮挡），Chromium 停掉了渲染循环，**rAF 一次都不触发**。工具因此改为**先等 `visible` 再记录**，并在结果里报告 `visibilityEnd`。
**注意为什么既有数字仍然有效**：那些是 `--headless=new` 跑的——headless 的合成器照常运行、不被遮挡节流。**只有"附着到真实窗口"才会遇到这个节流。**

**坑 3（最贵的）：串行采样让"两侧对比"完全无效**。第一版脚本 `for (const [side, …])` 顺序执行：宿主的 60 秒窗口（T+0→T+60）跑完才开始 iframe 的（T+60→T+150）；而用户实际在 T+89 才点击。于是**宿主的窗口里一次点击都没有**，"宿主很干净"这个结论在那次运行里**根本不成立**。第二版改为 `Promise.all` **并发**采样、各自返回 `epochAtStart`，分析时按绝对时间取**共同窗口**（实测偏差 26 ms）。

**坑 4（读数，不是流程）**：ResizeObserver **在 observe 时必然回调一次**（实测 `panel=888x740 @t≈0`），那不是用户操作；把它当"用户点了宿主侧"就会误判。

**结果**（同一段 90 秒，`visibilityEnd=visible`；Obsidian 1.13.7 / Electron 32.2.5；皮肤启用）：

| 指标 | 宿主 Obsidian | iframe（dsh 面板） |
|---|---|---|
| >33ms / >50ms 帧 | **0 / 0** | 63 / 37 |
| 最差帧 / LoAF | **18 ms / 0** | **2183 ms / 37** |
| `TaskDuration` | 2.11 s（2.3%） | **35.54 s（39%）** |
| `RecalcStyleDuration`（次数） | 0.067 s（96） | **22.76 s（410）** ⇒ 55 ms/次 |

iframe 的 6 个属性翻转精确对应**三次开合**（+3.6→12.7、+18.5→26.2、+29.6→37.3 s），掉帧秒逐个落在这些区间；**最后一次开合后（+40→90 s）回到 60 fps / 17 ms / 零 LoAF**。

⇒ **卡顿 100% 在 dsh 侧**（宿主 0 掉帧）；**主成本是布局与样式重算**（22.76 s 重算 + 2.31 s 布局，而 JS 只有 2.04 s），发生在 **13 102 个元素**的文档上。此前"宿主也贵"只是**没测过**，不是测出来贵。

**固化成工具，而不是留在临时脚本里**：新增 `scripts/qa/sidebar-attach-probe.mjs`（**按需运行**，不进门禁），把方法、两条测量纪律（先等可见、两侧必须并发）与已知限制（ResizeObserver 首次回调；收起时 leaf 若被卸载则宿主侧收不到回调）都写进注释。原始帧数组不再入库——90 秒即可复现，文档里的数字就是记录。

**下一步（唯一的剩余 A/B）**：关掉插件设置里的「侧栏加载皮肤动态装饰」，用同一条命令再跑一次，以分离"皮肤脚本"与"上游布局"的贡献。

## 2026-09 · 三问：两个 changelog 是否重复、指令文件如何不干扰、侧栏性能查错了没有

### 一、`CHANGELOG.md` 与 `docs/changelog.md` **不是重复**，是两层记录

用户问「内容是不是重复、是否只留一个」。先量再答：两个文件 74.6 KB / 132.2 KB，**结构完全不相交**——根文件的二级标题全是 `## [x.y.z]`（**0** 个日期式标题），本文的二级标题全是 `## 2026-09 · <主题>`（**0** 个版本式标题）：

| | 组织方式 | 读者 | 回答的问题 |
|---|---|---|---|
| `CHANGELOG.md` | 按**版本** | 用户 / 发布 | 这个版本**改了什么** |
| `docs/changelog.md` | 按**日期主题** | 维护者 / agent | **为什么**这么改、怎么查出来的、否决了什么 |

这正是一般维护指南 §5.2 说的**两层记录**。**不能合并**：并进根文件会把发布摘要变成 200 KB 的叙事（`[0.7.5]` 刚刚才从这种状态里被拆出来）；并进本文则会让用户看不到"这个版本改了什么"。

**但重复的*风险*是真的**：同一事实被两处复述就可能长出两个数字（P2-1 就是这么发现的）。所以本轮把"分工"变成**可机检**的：`check-doc-constants.mjs` 新增三条断言——① 本文**不得**出现版本式标题（一旦出现，说明它开始重复发布说明、并把"为什么"埋进版本流水里）；② 根文件必须指向本文；③ 本文必须指向根文件。**变异验证两项**：往本文追加 `## [0.7.4]` → 失败；把根文件的指向改掉 → 失败。

**记忆系统要不要单独记录？** 不需要**第三份**：本文就是那份记录（按日期主题分节，内容仍以记忆系统为主，因为仓库主体就是它）；记忆系统的**规格**另有 `docs/memory/design.md` 等。**什么时候才该再分**：当某子系统的历史对"改这个仓库"不再有普遍参考价值时——那时按同一判据（读者是谁）分出去，不要预先分。

### 二、把「会被 harness 自动注入的文件」当成一类风险来守

用户的观察准确：这类文件"有点多"。实测全仓只有**两个**自动发现名的文件（根 `AGENTS.md`、合成基准 vault 里的 `AGENTS.md`），但**两个都真的注入过**：

- `dsh/templates/AGENTS.md`（给用户 vault 的教学协议）——已改名 `vault-AGENTS.md`，安装名由模板清单映射（坑 60）。
- `scripts/qa/benchmark-vault/AGENTS.md`（合成基准 vault 的协议）——**本会话又一次被注入**：只要碰那个目录，harness 就把它的全文当"本仓库指令"发给我。已改名 `vault-AGENTS.md`，**harness 随即报告 `Instructions removed: …`**——这是修复生效的直接证据。

**为什么不能只靠"记得别打开它"**：注入按**名字与位置**触发，与"谁打算读它"无关；而"写给别人的文档"恰恰最容易被放进这些名字。

**修法三层**：
1. **改名/移位**，消费方按清单映射（源码一个名字、安装另一个名字）。
2. **加守卫** `check-agent-instructions.mjs`（第 34 个门禁）：自动发现的名字列成清单，除仓库根 `AGENTS.md` 外一律拒绝，且**"一个都没找到"也算失败**（遍历一坏就变成静默通过）。变异验证：fixture 里放回 `AGENTS.md`、根放一个 `CLAUDE.md` → 各报出路径与原因。
3. **配套的行为一致性**：改 fixture 的文件名会改变**检索语料**——`classifyVaultDoc` 原本只跳过 `AGENTS.md`，改名后 `vault-AGENTS.md` 会**进入语料**。已把两个名字都跳过（模板源名本来也可能出现在用户 vault 里），实测合成探针仍 **8/8**。**顺序也验证过**：先只改名、不改分类器，探针仍 8/8（说明这条 ground truth 不敏感），但语料确实变了——所以该修还是修，只是不能拿"探针全绿"当作"没影响"。

### 三、侧栏性能：方向**大体正确**，但有一个从未测量的半边

用户怀疑"查错了对象"——他指的是 **Obsidian 内 dsh 插件里 dsh 的侧栏**，不是 Obsidian 自己的侧栏。核对结论：

- **探针测的确实是 dsh 的侧栏**（`sidebar-performance.md` §4：headless Chromium + CDP，真实鼠标事件点的是**dsh 自己**的「收起/展开侧边栏」按钮），所以**方向没跑偏**。
- **但文档把两个"侧栏"混用了**，读者无法判断每条证据属于哪一侧；而且——
- **Obsidian 侧栏面板那一侧从未被测过**：探针跑在**独立浏览器页**里，看不到也点不到 Obsidian 的 Electron 界面。原因 3/4（iframe 与宿主隔离、收起时挂起）属于**推理后处置**，不是测量结论；原因 8 只排除了"宿主空闲 CPU"，不等于"面板开合时的宿主渲染成本已测"。

**处置**（文档层，不改结论）：§0.1 新增术语表与**证据归属**（1/2/5/6/9/10/11 属于 dsh 侧栏；3/4 属于 Obsidian 侧；8 只排除空闲 CPU）；§6 新增 **Obsidian 侧的量法**——给 Obsidian 开 `--remote-debugging-port`（它也是 Electron），**同一套 CDP 代码换 target**，既能量真正的面板展开/收起，也能读到 iframe 内部；§9 第 5 项登记为"下次接着做"，并注明**在量到之前不要声称"侧栏卡顿已定位"覆盖了 Obsidian 侧**。

## 2026-09 · 三份文档移位：第二次应用「目录即接口」

用户判断三份文档的位置与其角色不符，逐一移位。**移位不是"移动文件"，而是"改一批引用 + 加一条守卫"**——路径和文件名一样是接口，而失效的路径**不会报错**，只会让人点空。

| 从 | 到 | 为什么 |
|---|---|---|
| `REFACTOR-PLAN.md`（仓库根） | **`docs/archive/REFACTOR-PLAN.md`** | 已退役的规划稿占着根目录——根目录是**入口文档**（README / ARCHITECTURE / CHANGELOG / AGENTS）的地盘，归档件不该混在里面 |
| `推文-0.7.1.md`（仓库根） | **`docs/promotion/推文-0.7.1.md`** | 发布宣传稿，同属归档而非入口；给它一个专门的存档目录 |
| `docs/memory/changelog.md` | **`docs/changelog.md`** | 它**事实上已经是整个仓库的变更账本**（打包/发布/皮肤/面板都记在里面），却放在记忆子系统下 |

**第三份为什么不是仓库根**：用户本来倾向于放根目录，但根目录已有 `CHANGELOG.md`——在 Windows/macOS 的**大小写不敏感**文件系统上，`changelog.md` 与 `CHANGELOG.md` 是同一个文件名，git 与检出都会坏。所以落到 `docs/` 顶层，与上一轮刚提升的 `docs/handoff.md` 并列：两个「仓库级维护文档」现在在同一层。

**执行要点（都是可复用的）**：
- **逐类替换，不用一条正则通吃**：引用分「仓库根相对路径」「从 `docs/` 写的相对路径」「从 `docs/memory/` 写的相对链接」三种形态；还要区分**链接目标**（必须改）与**散文里提到文件名**（不必改）。
- **文档自己的出链最容易漏**：`docs/memory/changelog.md` 上移一层后，它原来的 `../handoff.md`、`../literature.md` 会指到仓库根去——单独检查它内部的全部相对链接。
- **踩到一个真错误**：第一遍改引用时用了 `String.replace(字符串, …)`，它**只替换每处文件的第一处匹配**（要 `replaceAll` 或用带 `g` 的正则）。症状很隐蔽：`AGENTS.md` 的表格里**文字标签更新了、链接目标没更新**——看起来像改好了。是残留检查把 15 处旧路径揪出来的。
- **`docs/memory/README.md` 的索引行**同步更新为「仓库级变更账本（2026-09-11 提升）」；`ARCHITECTURE.md` 里"记忆系统细账"的说法也改成"仓库级细账"。
- **守卫**：`check-rename.mjs` 第三条规则从"一个旧路径"扩成**一张表**（`docs/memory/handoff.md`、`docs/memory/changelog.md`、以及 `](REFACTOR-PLAN.md)` 这种裸链接形态），每条都给出新位置与理由。**根目录两份的裸文件名不设规则**：文件名本身仍是引用一个文件的正确方式，而 `推文-*.md` 被 `.gitignore:23` 忽略（是维护者本地的宣传稿，**刻意不入库**）——给一个"在新克隆里本来就不存在"的文件加路径守卫只会制造误报。

**顺带核实的一件事**：`推文-0.7.1.md` **不在版本控制里**，所以 `git mv` 报 `not under version control`——这不是缺陷。`.gitignore` 的 `推文-*.md` 规则在任何目录层级都命中，移动后依然命中；三份文档里对它只有**散文引用、没有 markdown 链接**（已实测：0 处链接），所以新克隆里不会出现死链。移动它只是整理了工作副本，**跟踪状态不变**。

## 2026-09 · 「守卫看起来在工作」：读了一个从未赋值的变量 / 前置条件永远不成立

第八轮（同日）：审查 P3 里两条"守卫看起来在工作、实际条件失效"的实例（与 P1-7 同类）。它们值得单独成节，因为**这类缺陷不会被任何门禁抓到**——它本身就是门禁。

- **① `check-embedded-loader.mjs` 的 `fnAt` 从未被赋值**。`loaderCall()` 明明算出了偏移 `at`，却写成 `return { params, args, fnAt }` —— 返回的是**模块级那个还没赋值的 `let fnAt`**。后果不是崩溃，而是**悄悄地锚错位置**：`String.prototype.lastIndexOf(search, undefined)` 按规范等价于 `position = +∞`，也就是**从模板末尾往回搜**，于是守卫永远取到**最后一个** `\nreturn { `，而不是注释里写的"最近的前一个 allowlist"。**它今天是对的，纯属运气**：memory-admin 的 loader 恰好排在最后；再加一个 loader，它就会去校验**别的名单**并照样打印 OK。
  - **修法**：`fnAt: at`。同时把提取函数**参数化**（`loaderAllowlist(fnAt, text = template)`、`loaderCall(text = template)`），这样自测才能在**合成模板**上跑同一份提取逻辑。
  - **自测**：往合成模板**末尾再接一个 loader**（自带一个 only-in-synthetic 的 allowlist），断言提取到的仍是 memory-admin 的名单（含 `probeService`、不含合成名）。失败信息直接点根因：`loaderCall() returned a non-integer fnAt (undefined) — … (the fnAt bug is back)`。
  - **变异验证**：把 `fnAt: at` 改回 `fnAt` → 自测立刻失败（这是"证明守卫会失败"的又一次实践）。
  - **顺带修好一处被我改坏的注释**：本会话早前给这个守卫加 hook-frontmatter 检查时，误删了自测注释的第一行（"The extraction above must actually be load-bearing: if the template drops a"），句子从半截开始。已补回。
- **② `test-installer.mjs` 的"vault cache removed"恒真**。断言 `!existsSync(vault/.deepseek/cache)`，可**安装器从不创建**该目录、夹具里也没有 ⇒ 这条断言删掉或注释掉都没人会发现。它是一条**装饰**。
  - **修法不是删断言，而是让前置条件成立**：夹具先造出真实 vault 跑过插件后才会有的 `.deepseek/cache/captured-sessions.json`，再断言 `--purge` 把它删掉。修完立刻证明该行为**确实实现了**（安装器日志打出 `[remove] …\.deepseek\cache`）——反过来说，这条断言过去既没保护代码，也没保护"`--purge` 会清缓存"这个**文档承诺**。
- **两条判据（写完任何断言/守卫都问）**：① 「**它读到的东西真的被赋过值吗？**」——`fnAt` 这种"用了但没赋值"的变量不会报错，只会静默改变搜索范围；② 「**让它失败的那个输入真的可能出现吗？**」——前置条件不存在时，断言测的是"什么都没有"。两句都答不上来，这条断言就是装饰。已写进 §4 陷阱 68。
- **同族坑**：44（写完就当成功）、56（守卫把"没跑起来"当失败）、67（grep 跳过隐藏目录）。共同点都是**验证动作本身失效，而输出仍然是"通过"**。


## 2026-09 · 呈现层第一次被测：找到接缝，而不是搬来 Obsidian

第七轮（同日）：P1-3。审查的原话是"最大、也是用户真正安装的文件（`main.js` 呈现层）零自动化测试"。

- **先找接缝，再谈测试**。`main.template.js` 有 2959 行、8 个 class、依赖 Obsidian API 与 DOM——直接"给它写测试"会变成造一个假 Obsidian，测的是假件而不是产品。查过之后发现 `MemoryView` 恰好把**决策**留在四个**纯**方法里：`layerEntries`（state → 层列表）、`pendingItems`（audit → 待处理项与计数）、`cardMeta`（card → 一行元信息）、`trendText`（card → 趋势串）。**DOM 调用全在它们的调用方**（`pendingBlock`/`cardRow`/`memoRow`）。所以可以完全不碰 Obsidian 就把"显示什么、什么顺序、什么时候不显示"测掉。
- **方法：从源码文本里提取，而不是复制一份**。`scripts/test-panel-present.mjs` 读 `main.template.js`，按两空格缩进切出方法体、按花括号平衡切出常量，再 `new Function(..., 'daysSinceText', ...)` 求值——`daysSinceText` 注入的是 `memory-admin.mjs` 的**真实实现**（正是模板里 `const daysSinceText = MEMORY_ADMIN.daysSinceText` 所别名的那一个），所以连**接线**一起测了。
  - **关键设计：接缝挪走要报错**。若 `cardMeta` 改名或挪窝，提取阶段直接抛 `the presentation seam moved; update this test`。**一个悄悄停止测试的测试比没有测试更糟**——这也是本轮变异验证的第二项。
  - 第二处一致性的保险：切出来的方法体做一次花括号平衡检查，不平衡即报错（防止格式变化导致"测了半个方法"）。
- **测试当场抓到一个真实缺陷**：那六个可选字段用 `!== ''` 守卫，`undefined` 会漏过去，残缺卡片渲染成 `❓ · 从未用过 · 上次 undefined`。数据层目前总给字符串，所以它一直是**潜伏**的——而这正是呈现层该有的那种 bug（"其他都对，就是显示了不该显示的东西"）。已改成 `typeof === 'string' && !== ''`，并补一条"残缺卡片不得出现 `undefined`"的断言。
- **覆盖的是"可以错而其他都对"的部分**：五层渲染与字段缺失降级、无 `layers` 时回退 records+templates、「⚠️ 待处理」的计数规则（`decisions.total` 更大时胜出 / **过期的更小 total 不得隐藏已列出的行** / sections 缺失时整块不显示）、元信息分段与顺序（无 hook 块也必须有徽标、`harmed: 0` 不显示倒忙段）、趋势显示条件（<2 点、全 0、只取最后 5 点、非对象项忽略）。20 项。
- **没测什么，写清**：DOM 调用（`createDiv`/`createEl`）、Obsidian API、`daysSinceText` 的日期算术（后者属 `memory-admin.mjs`，记忆套件已覆盖）。**边界写明白，比多测几条更重要**——否则下一个人会以为"呈现层全测了"。
- **变异验证两项**：把待处理计数改成"declared 无条件胜出" → 精确失败（`total=1`，正是要防的"过期小数藏掉已列出的行"）；把 `cardMeta` 改名 → 提取阶段报错。


## 2026-09 · 散文里的数字要有出处；以及一次「没读原文就下结论」的自我更正

第六轮（同日）：P2-1 + P2-11 + **P2-2 的补做**。

- **P2-1「同一事实五个数字」——数字要从代码取**：① README 中英写「四个 / four note tools」，而 `note-tools.mjs` 实际注册 **5** 个（我第一次 grep 只看到 4 个，因为**命中了结果上限**；`note_strategy` 在第 1429 行——**"grep 没看到"不等于"不存在"**，凡是要下计数结论都得用能穷举的手段）；② `design.md` 写捕获策略「默认 ask/ask/ask」，而 `DEFAULT_CAPTURE_POLICY` 是 `structure: auto`（**文档漏掉了后来长出来的第四个档位**，与坑 42「设计迭代忘记适配」同族）；③ 论文数被写出 **14/15/19/20** 四个版本 → 不再各处复述，**收敛到单一来源 `docs/literature.md`**（现 20 篇，与 `.raw` 的 20 个目录一致），其余地方改成指向它、历史数字标「当时」；④ `sessionCapture` 默认关的**版本**两说并存——用 `git log -S` 定位：功能由 `cc177da`（2026-08-30）引入（0.7.3），改动落在 `75422f6`，而那个提交**把 0.7.4 与 0.7.5 打成一件事**、且 **0.7.2–0.7.4 从未打 tag**（`git tag` 只有 0.6.x/0.7.0/0.7.1/0.7.5）⇒ 无法用 tag 复核。**采信发布当时写下的 0.7.4 条目**，把两处「0.7.5 起」改掉，并在记录里写明判据是"发布时写下的那一份"而不是"少数服从多数"。
- **加守卫：把语义常量锚到代码**（`check-doc-constants.mjs`，第 32 个门禁）。`check-doc-consistency` 只锚测试套件的断言数，审查的建议是把「工具数」「论文数」这类**散文常量**也锚上——它们会静默漂移而读者无从核对。两条设计要点：① `.raw` 是 gitignore 的语料，缺失时**声明 SKIP**，不静默通过；② **措辞变了导致解析不到锚点也算失败**，否则锚点会腐烂成装饰（这条比"数字对不对"更重要）。变异验证三项：README 改回 four、`design.md` 改七个、`literature.md` 改 21 篇 → 各报精确差异。
- **P2-11「验收声明超出证据」**：`benchmark.md` 与 `handoff.md` 写真实 token E2E「8/8 通过」，而唯一一份完整运行的 baseline 是 **7/8**，另外两份是**单用例重跑**的 1/1——**把一次子集重跑和一次完整运行拼成了一个总数**。改为证据支持的说法，并点明 `baseline.json` **只写不读**（所以 `testing.md` 的"CI 可比对"是目标而非现状）。**没有删掉已提交的证据**：`baseline.json` 的去留（消费它做阈值 vs 移出 git）登记成 §7 的工作项——**删证据比留着一个待决问题更糟**。
- **★ 自我更正：第五轮我把 P2-2 打错了勾。** 当时我按**条目名**推断"发布物里残留维护者本机路径"指的是 gitignore 的 `deploy-local.mjs`，查证"当前树上不可达"后就记为 ✅——**但我没有回去读报告原文**。报告 P2-2 的证据其实是**用户可见文档里的示例 vault 路径**（`README.md:66` / `README.zh.md:64` / `ARCHITECTURE.md:23` / `docs/installation.md:124` 都写着 `D:\Obsidian笔记数据库`，而 npm README 是包主页、读者是陌生人）。**我修了一个相邻但不相同的问题，还打了勾**——这正是 P2-11 描述的那种失败模式，只是这次犯错的是我自己。第六轮按原文修复，并把它写进台账的显眼位置。
  - 更值得记的是**守卫为什么没抓到**：`check-release-paths.mjs` 只认英文目录名（`Users`/`Documents`/…），于是 `D:\Obsidian笔记数据库` 一路通过。现在增加「**具体的盘符路径**」规则：`X:\` 之后紧跟占位符标记（`<` `$` `%` `*` `…`）才放行，其余按真实路径处理——**`D:` 不在任何名单里，它也不需要**。教训：**白名单式的检测器只能抓到你想得到的东西；要么改成"默认可疑 + 显式豁免"，要么承认它有盲区。**
  - **流程教训（最重要的一条）**：审查报告是**清单**，不是**标题集合**。给每一条打勾之前，先回去读那一条的**证据段**——标题常常比正文宽或窄，凭标题推断范围就会像这次一样"修错了东西还自认为完成"。


## 2026-09 · 发布面：先证伪报告的结论，再把"可达性"钉住

第五轮（同日）：P2-2。报告写的是"发布物里残留维护者本机路径"。**先查它到底可不可达**，再决定修什么：

- npm 包只发 `dsh/` + `README*` + `LICENSE`（`package.json` 的 `files`），**不含 `scripts/`**；
- GitHub Release 只附 `main.js` / `manifest.json` / `styles.css`；
- 全仓唯一硬编码本机路径是 `scripts/deploy-local.mjs` 的 `C:/Users/<name>/.dsh`，而它**被 gitignore，且落在两个发布面之外**。

⇒ **报告描述的泄漏在当前树上不可达。** 这一条以后会反复出现：审计在**某个 HEAD** 上写结论，而"不可达"往往靠的是**别处的清单恰好没变**。所以正确的收尾既不是"照报告去删文件"，也不是"确认没事就关掉"，而是：

- **把可达性所依赖的清单本身钉住**：`scripts/check-release-paths.mjs` 把 `package.json` 的 `files` **pin 成显式清单**——改它必须改守卫并写下理由（与 `check-engine-sync.mjs` 钉共享符号清单同一手法）；并显式拒绝 `scripts/`（那里有机器特定文件）。
- **加扫描**：对实际发布面（`files` ∪ Obsidian 三件）扫**本机标识**（`os.homedir()`、登录名作为**路径段**）与通用绝对路径。只 pin 不扫，会漏掉"合法发布但内含路径"；只扫不 pin，会漏掉"还没发布但将被发布"的文件。
- **变异验证三项**：把 `scripts/` 加进 `files`、给某发布文件塞通用绝对路径、塞**本机真实 home** → 各触发一条。**注意第一次做这个验证时我改错了锚点**（`package.json` 是缩进多行格式，我按紧凑格式去 replace）→ 什么都没改，守卫当然通过 ⇒ **"没报错"被当成了"验证通过"**。改用 JSON 解析后写入才真正触发。**这条要记住：变异验证失败的第一步是确认变异真的发生了。**
- **顺带清掉一个误报源**：`main.template.js` 里有一句注释示例 `(e.g. E:\software\deepseek-harness)`。它不是泄漏（是举例），但**读起来像真路径**，会让每个审阅者重查一次、也让守卫的误报更难判断。零价值的例子不该长得像事实，改成中性写法。

## 2026-09 · 半途改名的收尾：两侧各读各的名字，等于把"偏好顺序"变成隐式契约

第五轮（同日）。上一轮把"反馈 token 改名只做一半"登记成缺口，这轮修掉：

- **症状**：preset 读 `新 ?? 旧`，面板**只读旧名**。于是无论插件注入哪个名字，**总有一侧看不见它**——插件注入新名则面板拒掉自己的 token，注入旧名则 preset 侧的新名分支永远走不到。
- **修法**：两侧读**同一对、同一顺序**（新名优先），并且 **Obsidian 插件同时注入两个名字**。为什么两个都注入而不是只发新名？因为 **Obsidian 插件与 npm 包可以分别升级**——只发新名会打断所有旧消费者，只发旧名则让改名永远完不成。双注入 + 两侧同序，使"顺序"在线上不再重要。
- **回归 3 项**（`test-panel-routes.mjs` §4b）：新名单独生效、只设新名时被强制（无 token → 403）、**两个都设时新名优先**。**变异验证**：把面板改回只读旧名 → 2 项失败并报 `{"newName":403,"oldName":200}`——**偏好顺序被反转，正是要防的那个形态**，诊断信息直接把它印出来。
- **老实记一笔**：3 项里有 1 项（"新名单独被接受"）在旧代码下**也通过**（因为旧代码此时没配置任何 token，请求本来就放行），所以它**不承重**；承重的是另外两项。**验收时要分清哪条断言真的能失败**，否则"全绿"会掺水。
- **教训**：别名/改名要一次改完**所有读取点**，并让写入方同时提供新旧两个名字；只改一半时，**偏好顺序**就成了只有运行时才知道的隐式契约——而它没有任何测试或文档在守。

## 2026-09 · 环境变量收进一份参考，并让守卫**双向**核对

第四轮（同日）：P2-8。审查报告的措辞是"10 个环境变量没有单一参考文档，含别名对与一个死开关"。**先数清楚再说**：写了一个脚本遍历文件系统、用 `process\.env\.([A-Za-z_]\w*)` 提取，结果是 **11 个 `DSH_*` 真有读取方**（分布在 9 个文件）+ 4 个平台/开发变量——**报告的数字本身就偏了一位**，而"从代码里提取"比争论数字便宜。

- **为什么需要这份文档**：这些变量此前只活在代码里。维护者要回答三件事只能靠 grep，而 grep 只回答你已经想到要问的问题：① 这个变量干嘛的？② 新旧名哪个优先？③ 能不能删？
- **三对别名的规则写成了纪律**：`DSH_WORKSPACE_ROOT` ↔ `DSH_OBSIDIAN_VAULT`、`DSH_MATH_MEMORY_LINK_URL` ↔ `DSH_OBSIDIAN_LINK_URL`、`DSH_MATH_MEMORY_FEEDBACK_TOKEN` ↔ `DSH_OBSIDIAN_FEEDBACK_TOKEN`，一律"**新名优先、旧名回退**"。这条不是描述而是**警告**：这个顺序**被写反过**——两个 QA 探针曾写成旧名优先，于是在"给产品设了新名"的机器上，探针在给**另一个 vault** 打分（P1-8）。**新增读取点时照抄现有写法，不要自己重排。**
- **死开关的正确处置不是删，是记账**：`DSH_MATH_MEMORY_ENABLED` 被 `docs/archive/REFACTOR-PLAN.md` 描述成"进程级最后兜底开关"，全仓**零读取方**。删掉那句描述的代价大于收益（那是历史档案，已就地加更正）；真正的风险是**下一个人实现它并以为早就生效**。所以它单列一节，写明"设了没用""真要生效的总开关在哪"，并让守卫在它第一次被读取时**失败**。
- **守卫是双向的**（这是本轮最值得复用的部分）：
  1. 代码里读了、文档没写 → 失败；
  2. 文档写了、代码没读 → 失败（**反向腐烂**：清单会变成"曾经存在过的东西"的墓地）；
  3. **标成死开关却又被读 → 失败**——把"实现死开关"这件未来可能发生的事，变成一次**必须同时改文档**的动作。
  三条都做了**变异验证**（删一行文档 / 加一行幽灵变量 / 真去实现那个开关，各触发一条，随后全部还原）。
- **两个自己踩到的细节**：① 守卫最初**把自己的头注释判定成一次读取**——注释里写了模式 `process.env.X`，于是它要求文档里有一行 `X`。修法与 `check-rename.mjs` 一致：**显式跳过自己**。② 新文档里为了说明"另一个守卫禁止旧产品名"，把那个**字面量**写进了表格 → `check-rename` 立刻失败。修法不是给守卫加豁免，而是**改文档措辞**（"旧产品名（字面量由该守卫持有）"）。**两个守卫互相咬合、并在真实改动上立刻生效**，这比它们各自单独通过更能说明问题。
- **顺带查出一处真实缺口（未修，已登记 §7）**：反馈 token 的改名只做了一半——preset 侧读 `新 ?? 旧`，而 `math-memory-panel.mjs` 的校验**只读旧名**，所以插件现在必须注入旧名。这条以前没人能一眼看出来，正是因为变量散在代码里。

## 2026-09 · 文档漂移排查：`dsh web ui` → `dsh web`，以及「历史档案」与「当下声明」的分界

用户指出：产品已更名，但 README 里仍写 `dsh web ui`，并要求顺带查一遍**其他可能的漂移**。先取**事实**再改：读本机 `~/.dsh/profiles/web/package.json`，得到权威现状——聚合包是 **`@linxin666/dsh-web-all`**（`dsh.profile.bundles` 里与 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 并列），子包为 `dsh-client-ui-*`；`dsh-web-ui-all` 是 **0.3.20 之前的已退役名字**。**先读真实安装，而不是照着旧文档猜**——这正是"消费真实值"那条纪律。

- **产品名与家族名分开处理**：产品一律写 `dsh web`；插件家族**不写口头的家族名**，改称「`@linxin666/dsh-web-all` 聚合的那一族 UI 插件」。理由是**可核对性**：包名能在 `package.json` / npm 上验证，家族名只能靠记忆，而它已经错过一次。
- **区分「当下的声明」与「历史的记录」**（这是 §5 文档腐烂类型学的又一次实战）：
  - **改**：README 中英、ARCHITECTURE、`handoff.md` 入口表、`testing.md` 小节标题、`design.md`、`control-panel.md` 方案表、vault 模板 `config.md`、插件与 profile 的代码注释——它们都在描述**现在**。
  - **不改**：已发布的 CHANGELOG 段落、日期化审计（`maintainability-review-*`、`project-assessment-*`）、已退役的 `docs/archive/REFACTOR-PLAN.md`、`docs/dsh-0.1.5-adaptation.md`（它记录的**就是**这次改名）、`docs/dsh-panel-research.md`（2026-08 快照）、`docs/changelog.md` 自身的历史条目。
  - **折中**：快照类文档（`dsh-panel-research.md`）**不动正文**，在开头加**日期化更正块**并指向权威依据——正文是"当时的证据"，改写它会毁掉证据价值。
- **顺带查出三类真实漂移**（都是"当下的声明"，所以都改）：
  1. `docs/archive/REFACTOR-PLAN.md` 横幅称「Phase 4（web ui 适配）未做」——**半对半错**：面板后来换形态交付了（独立客户端包 + 官方 `settings.section` + 宿主路由），未做的只是**自挂右侧 DOM 列**那种形态。按事实改写，而不是简单反转结论；同处「15 个模板」改为**不写数字**（实际 19，且真值属于 `templates-manifest.json`）。
  2. `docs/dsh-0.1.5-adaptation.md` 状态停在「计划已定，实施中」，而三条适配与 §7 的两个待决问题都已落地/已决定 → 改为**已实施**并列结论。
  3. `docs/memory/obelisk-comparison.md` 仍引用 `pathIsInside`——P2-6 已把它改名成 `pathInside`。**这是"改名之后靠 grep 补文档"漏掉的一处**，也说明改名必须配守卫。
- **加了守卫而不是只改文本**：`check-rename.mjs` 增加第二条规则，活文件里再出现 `dsh web ui` / `dsh-web-ui` 即失败（**排除**真实退役包名 `dsh-web-ui-all`）；历史档案必须在守卫里以「**路径 + 理由**」白名单豁免。**要改历史记录，得先写下理由**——这条设计让"不改历史"从习惯变成需要显式决定的事。变异验证：把 README 那行改回去 → 立刻报出 `README.md:9`。
- **两个新坑**：
  - **坑 66**：脚本按行拼接 CRLF 文件时 `split("\n")` + `join("\r\n")` 会产生 `\r\r\n`，而且门禁照过、只有**行号会整体偏移**（.NET `ReadLine` 把多余的 `\r` 当换行）。
  - **坑 67**：**`grep` 会跳过点目录**——本轮 grep 报 28 处，而遍历文件系统的守卫多报出一处 `scripts/qa/benchmark-vault/.deepseek/config.md`（`.deepseek/` 是隐藏目录，但该文件**是 git 跟踪的**）。结论：**要声称"全仓没有 X"，必须用自己遍历文件系统的守卫**；grep 只用于定位，不用于证明不存在。
- **刻意不改的一处（记在 `handoff.md` §7）**：`scripts/qa/benchmark-vault/` 是**冻结的基准语料**（整座合成 vault，含"试做型 0.6.x"这类刻意的旧状态）。改它的文字会改变基准测的东西，所以守卫按**目录前缀**豁免它，并写明"要靠一次有意的刷新 + 新 baseline 来更新，不能顺手改"。这是"明确记录刻意没改的东西"那条纪律的实例。

## 2026-09 · 重编 `CHANGELOG.md` 的 `[0.7.5]` 节：把「做过什么」从这里移出去

用户判定：**已发布的 `[0.7.5]` 节写混了**——排查过程、前后反复（"第一轮修的不是真因，第二轮才修对"）、实测数字、外部论文的采纳/不采纳论证，全都和"修了什么"混在一起；而且各轮各自记了一遍回归计数（`200 → 207`、`165 → 207`、`138 → 155`、`118 → 138`），同一份文档里互相矛盾，读者无法判断哪个是最终值。

- **两份记录的职责被重新划清**（其实 §5 记录纪律早就写好了，是执行时没守住）：
  - `CHANGELOG.md` = **面向用户的版本变更**：修了什么 / 改了什么 / 加了什么，一条一件，可扫读；
  - `docs/changelog.md`（本文件）= **面向维护者的细账**：为什么这么改、排查过程、实测数字、被否决的方案。
- **重编前先确认"移出去的东西确实在别处"**：本文件里 0.7.5 时期的对应小节都在（侧栏卡顿排查 + GraphMemix 决策、外部设计吸纳 5 机制、设计迭代专项审计、面板第二轮打磨、体检报告与呈现重做、探针改调真管线、侧栏 401 真根因、安全修复、V3 适配、会话扫描不再全量解码、首次推 tag 暴露的三个流水线缺陷）。所以 `CHANGELOG` 里那些叙述是**重复**，不是唯一副本——**这一步没做就删，等于真的删信息**。
- **`[0.7.5]` 已发布，所以不能悄悄改**：节首加了一行「本节于 2026-09-11 重编 … 版本内容本身未变，只是换了记录层次」，并指向本文件。改的是**记录层次**，不是版本内容。
- **删掉的具体是**：用户原话引用、"第 N 轮修的不是真因"式叙事、A/B 实验数字表、论文分析与"实现了/测过了/不采纳"决策（后者属于 `retrieval-v3.md` §7 与本文件的决策记录）、以及全部跨轮回归计数。**留下的是**：每条修复的现象 + 机制 + 现状一行，安全项标 `（安全）`，新增的脚本/文档进 `Added`。
- **结果**：`[0.7.5]` 从 118 行降到 72 行，结构从「Fixed / Changed / Changed」变成「Fixed / Changed / Added」，并用脚本核对了 30 个特征关键词全部仍在（确认没有误删条目）。
- **顺带记一条操作坑（坑 66）**：用脚本按行拼接 CRLF 文件时，`split("\n")` 会把 `\r` 留在每行末尾，再 `join("\r\n")` 就产生 `\r\r\n`。这种文件**看起来正常**、门禁也照过（守卫按 `\r?\n` 切分），但 .NET 的 `ReadLine` 会把多出来的 `\r` 当成一次换行，于是**所有行号偏移**——排查时一度以为拼接错位。

## 2026-09 · 可维护性审查落地：把「agent 能不能长期维护」变成可守卫的东西

审查报告 `docs/maintainability-review-2026-09-11.md`，台账 `docs/maintainability-fixes-2026-09-11.md`。**版本仍是 0.7.5，未发版**（发版动作留给维护者）。通用经验另见 `docs/agent-repo-maintenance.md`。

**诊断**：这个仓库对**人类**维护者约 8/10（CI 双平台、五处版本门禁、`main.js` 字节级重建门禁、232 项零 token 回归、模板清单完整性门禁都在），但对 **agent** 约 4/10。缺的不是纪律，而是三样东西：**给 agent 的入口**、**可信的验证信号**、**唯一的一份实现**。下面按这三条记录落地理由。

### 一、验证信号不可信（P0-2）——本轮最重要的一件

**现象**：本机 `npm test` 必红，且**红得和真回归一模一样**。

- `test-panel-auth.mjs` 用 `stdio: ['ignore','pipe','pipe']` spawn dsh。在禁止子进程管道 stdio 的环境里子进程**根本没起来**（`spawn EPERM`）。它排在第 5 位，`&&` 链由此断开，**其后 16 条命令一次都没跑**——"npm test 失败"因此不携带任何关于其余门禁的信息。
- 更隐蔽的第二层：`check-doc-consistency.mjs` 真跑各套件并解析 `__CHECKS__`，拿不到输出就把计数读成 **0**，于是报出 **18 条「文档漂移：文档写 232、实际 0」**。文档全是对的——**而 agent 最自然的反应就是照着去"修"正确的文档**，这才是真正的损失。
- 第三层：`__CHECKS__` 的分母是**手写常量**（proxy 写 31、实际 32；auth 写 7、实际 8）。于是"全绿"是**算术**，不是覆盖证据；而文档锚点盯着这些自报数，把错数字抄进了 5 处文档。

**修法**（关键实验：`pipe → error EPERM, stdout=undefined`；**fd 重定向 → status 0 且输出完整**）：

1. `scripts/run-node.mjs`：子进程 stdio 指向**真实文件描述符**（不是管道）。两种环境都能跑，照旧捕获输出；stdout/stderr 合流到一个文件，保留发生顺序。
2. `scripts/run-gates.mjs`：`npm test` 不再用 `&&`，改为**跑完全部门禁再汇总**，逐条报告状态 + 套件自报计数，失败时附该门禁输出的末尾；"子进程没起来"单独标为**环境结果**。
3. `check-doc-consistency.mjs` 改**三态**：真计数 / 声明的 SKIP / **套件跑不起来**（报 SKIP，锚点不比较）——绝不再把"没跑"当成"文档错了"。
4. `check()` 内部计数，套件末尾打印真实值；文档同步为 44 路由 / 32 反代 / 8 握手。
5. `test-panel-auth.mjs` 在环境不允许子进程写自身状态（实测：dsh 子进程写 `~/.dsh/profiles/notes-assistant/cordis.yml` 被拒）时**声明 SKIP 并说明路径**，而不是断言一个从未存在的进程。

**结果**：本机 `npm test` **27/27 全绿**（原为 2 处红 + 静默跳过 16 条）。

### 二、入口错位（P0-1）

仓库根**没有** `AGENTS.md`，唯一的 `AGENTS.md` 是 `dsh/templates/AGENTS.md`——那是**安装进用户 vault 的教学协议**。agent harness 只要在仓库里读到它，就把它当作**本仓库的指令**自动注入（实测约 200 行"你是本 vault 的数学学习伙伴"，其中含"永不申请权限升级"这类与仓库维护冲突的硬约束）。**冷启动 agent 拿到的是教学纪律，不是"这是什么仓库、改哪里、怎么验证"。**

修法（两半都要）：

1. 仓库根新增 `AGENTS.md`：两个产物与数据流、文件地图、五条铁律、验证纪律（**受限环境的红不是回归**）、记录纪律、已知陷阱。
2. `dsh/templates/AGENTS.md` → **`dsh/templates/vault-AGENTS.md`**：安装后的名字仍由 `templates-manifest.json` 映射为 `AGENTS.md`，但**源文件不再占用会被自动发现的文件名**。三条安装路径都按 `source → target` 遍历，所以只需改清单（+ `test-installer.mjs` 的一处漂移断言）。模板顶部另加「文件身份」说明，在 vault 内读也成立。

### 三、唯一实现：双份记忆引擎（P0-3）

两份引擎无法共享 import（宿主那份在 Obsidian bundle 里，`fs`/`zlib` 由嵌入加载器注入，不能自己 import）。代价是：`dsh/preset/math-memory.mjs`（115 个顶层声明）与 `dsh/host/memory-admin.mjs`（56 个）**共享 21 个同名符号**，而唯一的同步机制是其中一处的注释 `keep the two in sync`；`main.template.js` 里还有第三条捕获路径。

**彻底去重（抽共享模块 + 两侧薄封装）留作下一步**（已记入 `handoff.md` §7）。本轮先做**守卫** `scripts/check-engine-sync.mjs`，把"静默漂移"换成"显式决定"：

- 比对**词法流**而不是原始字节——注释、引号风格、`export`、空白都不算漂移（否则 21 个里有 9 个会被误报为偏离）。
- 共享清单**钉住**（21 个）：增删都必须是有意的。
- 逐符号要求"一致 **或** 有记录的偏离"。现状 **15 一致 + 6 有据偏离**，6 条各自写明理由（如 `readSessionHeader` 在宿主侧走加载器注入的 `zstdDecompressSync`、`runSessionCapture` 在 preset 侧是 103 行完整实现而宿主侧是 `scanSessionCapture` + `persistCaptureState` 的薄封装）。
- 反向也要管：**已登记的偏离如果已经一致了，同样失败**——否则豁免清单会腐烂成"随便漂移"的通行证。
- 自带提取器自测（含"参数默认值里的 `{}` 不能提前结束 span"这个真实踩过的坑）。**变异验证**：改宿主副本里一个字符即失败。

### 四、安全：约束根必须锚在服务端（P0-0，本轮唯一的安全发现）

`/memory-panel` 的约束根在**两个环境变量都没设**时退回"请求里带的 `root`"——下游 `pathInside(root, target)` 的两端就都由调用方决定。上一轮（2026-09-10）的修复只覆盖了"已配置"的一半；而套件在它之前的**每个**用例都设了环境变量，**恰好绕过这条分支**。

修法：允许的根 = 环境变量 ∪ `ctx.workspaceRegistry`（服务端自己的状态），**两者都空则拒绝一切带 root 的请求**。补 5 项断言（35 项；P2-9 又补 9 项，现 44 项）。**变异验证**：还原旧逻辑，新断言失败且报 `status: 200`。教训写进 `handoff.md` 坑 62：**"未配置/空值"分支如果没有用例走到，它就不算被测过。**

### 五、其余落地

- **`client.js` 新鲜度门禁**（P1-4）：那是**提交进仓库**的构建产物、也是真正下发给 dsh web 面板的代码，此前**没有任何门禁引用它**。现在与一次全新构建逐字节比对；构建需要 esbuild 子进程，环境不允许时 SKIP 并仍做形状检查。`build-client.mjs` 因此重构为导出 `buildClient()`——守卫复用同一份 esbuild 配置，避免第二份配置漂移。
- **嵌入清单完备性门禁**（P2-10）：`EMBEDDED_SOURCES` 改为数据 + 三条门禁（未声明的可嵌入文件必须写出理由 / 嵌入源 basename 不得撞车 / 模板 `.md` 必须在清单里）。此前"新增模块忘了嵌入"会产出一个**静默缺文件**的 bundle。
- **文档事实**：`capture-policy.md` 的 `sessionCapture` 默认值改为默认关（与代码、`config.md` 一致，坑 42 早有记载）；`strategy-layer.md` 状态改为已实现（§11 仍 2 项待定）；`design.md` 去掉过期的 "v0.6.x"；活文档加 `> 当前版本：x.y.z` 精确标记并由版本守卫比对（P1-1/P1-2）。
- 构建日志报告的 "bytes" 实为 UTF-16 码元数（中文密集文本少约 10%），改为 `Buffer.byteLength`。

### 六、死代码、只写不读的常量，以及「删之前先核对报告」

第二轮（同日）：P2-5 / P2-7。

- **`AUDIT_SCHEMA_VERSION` 只写不读**（P2-5）。本项目最有效的既有防御之一是「**缓存语义变更必须带版本**」（坑 9），而这个常量**看起来**在守护体检报告格式、实际不设防：改报告结构后旧缓存会被当作新格式解析，而坑 38 说明这种事故真的发生过（v1 缓存 / v2 读取方）。修法不是删常量，而是**让读侧真的读它**：声明兼容范围（v1 = 无字段、v2 = 双渲染），范围外返回 null。**fail-closed 优于半解析**——"没有可用报告"用户能理解，"格式不对但装作读懂了"不能。
- **捕获路径的三处静默失败**（P2-7）。episode 落盘 / `episodes/index.md` 索引行 / 捕获 marker 写入失败此前全部被吞掉，于是**"持续写失败的 vault"与"空闲的 vault"完全无法区分**（都是 `captured: []`）。现在 `runSessionCapture` 返回 `warnings`（两份实现都改），marker 与索引判定改成**读回校验**（不是"没抛异常"，坑 44）。顺带修掉一个**潜在的真实缺陷**：索引行写失败过去会让该会话整个重试，而 episode 正文是**追加**写的 ⇒ 同一段对话会被写进同一个文件两遍。现在"正文已落盘"即算捕获成功，只报索引缺失。
- **`pathIsInside` vs `pathInside`**（P2-6 的第一项）。同一个"路径包含"助手在两个引擎里名字不同，于是 `check-engine-sync.mjs` **根本看不到这一对**——一个**安全相关**（面板约束根、vault 过滤都靠它）的命名分叉，正好落在守卫的盲区里。改名 + 给宿主侧补上 preset 独有的类型守卫后，两份逐 token 相同并纳入守卫；共享清单 21 → 22，而守卫**强制**这个决定被显式做出（清单一变就失败）。
- **死代码**（P2-7）。`RETRIEVE_TARGETS`、`MEMORY_SCAFFOLD_FILES` 已删（各自先 grep 确认零读取方）。前者更值得记：它让 `strategy-layer.md` 的「加取值 = 改常量」成为**假承诺**——维护者改常量、门禁全绿、行为不变。**删掉一个无人读取的常量，比留着一个"看起来很关键"的常量更安全。**

**方法教训：审计报告本身也会过期。** 报告点名 `math-memory.mjs:1294` 是"静默吞掉写入失败"，实测该处**已经**记录了 `statsResetFailed` 并进入 `warnings`（报告写于更早的 HEAD）。逐条 grep 核对之后再动手，省下了一次"修一个不存在的问题"。**照报告删代码之前，先自己确认它真的没人读。**

### 七、frontmatter 的边界规则：一份规范，加一份**被证明等价**的拷贝

第三轮（同日）：P1-6，也是 P2-6「同一概念多份会各自漂移的定义」的主要来源。

- **症状**：判断「元数据块从哪到哪」的正则 `/^---\r?\n([\s\S]*?)\r?\n---/` 在仓里被复制 **15 次**，落在 6 个解析器里（`math-memory.mjs` 12、`memory-admin.mjs` 1、`note-tools.mjs` 2）。本仓库历史上最严重的三次数据损坏（坑 21/22/43）**是同一个形状**：写入方的"块内"和读取方的"块内"不一致，闭合 `---` 就落到文件中间。注意这**不是**"某几处偷懒"——每处复制当初都合理（就地解析、不引依赖），累积起来才成为最危险的东西。
- **关键约束决定了修法**：宿主树**不能** `import` 规范实现。Obsidian 插件用 `new Function(params, body)` 求值 `memory-admin.mjs`，靠**注入绑定**而不是解析 import（`check-embedded-loader.mjs` 就是钉这件事的）。所以目标不是"删到只剩一份"，而是**一份规范 + 一份必要拷贝 + 一条证明两者等价的守卫**；硬凑成一份要改 loader 的注入契约，风险大于收益。
- **守卫按语义配对，不按名字、也不按文本**。`check-engine-sync.mjs` 比的是同名符号的**词法流**；这里两份实现的注释与风格**本来就不该强求相同**，必须相同的是"它认为块在哪"。所以新守卫把两份跑过 13 个 fixture（空 body / CRLF / 行尾空格 / 无尾随换行 / `$$`+`$&` / 非首块 / 未闭合 / `---body`）并比较结果。**配对的依据应当是"这个守卫要防哪种分歧"，而不是"有没有同名"或"文本像不像"。**
- **文档引用规则不算复制**。守卫只扫代码文件并跳过注释行——否则它会把自己"解释这条规则"的注释、审查报告、`handoff.md` 条目一起判违规（第一版就误报了 4 处）。真正的判据是"**运行时能不能与另一个副本分歧**"。
- **要动一条没人测的路径，先给它加测试**。`hook-frontmatter.mjs` 在插件里的求值路径（剥掉 `export {...}` 再 `new Function`）**此前零覆盖**，而这一轮正好把它的导出从 3 个改成 9 个、还变成多行——最容易静默坏掉的一类改动。所以先给 `check-embedded-loader.mjs` 补上这段（并让它真的解析一个 hook 块），再动代码。
- **行为保持的证据**：15 处替换后记忆回归仍 **240/240**（含 `$$`/`$&` 那条病理用例），`npm test` **29/29**。

### 还剩什么

- **面板路由读取分支补测**（P2-9）：`collectMemoryState` / 搜索 / 捕获策略 / 归档旧 episode 等仍未逐条断言。
- **引擎去重目标态**：把共享引擎抽成一个模块，两侧薄封装（现在是"有守卫的重复"）。
- **大函数拆分**（P1-5）：`buildAuditReport` 582 行 / `MemoryView` 537 / `apply` 471 / `DshWebProxy` 387。
- 这些都记在 `handoff.md` §7。


## 2026-09 · 0.7.5 首次推 tag 暴露的三个流水线缺陷（已修）

推 tag 后 **Release 成功、npm 失败、CI 在 Windows 上失败**——三件都在本机不可见：

1. **守卫把「本机不跑」当失败**：`check-doc-consistency.mjs` 会真跑各套件并解析 `__CHECKS__`，而 `test-panel-auth.mjs` 在没有本地 dsh 时按设计 SKIP（CI runner 正是如此）⇒ 守卫报 `no __CHECKS__ line` 并把文档里的 7 项认证断言与 0 比较。改为：`runSuite(rel, { optional: true })` 识别 SKIP 返回 null，认证锚点只报告不比较；其它套件缺行仍算失败。
2. **守卫不容忍 CRLF**：Windows runner 检出 CRLF，两个嵌入守卫用多行字面量/逐字节比较 ⇒ 误报「appended loader helper is unterminated」与「embedded memory-admin 是旧版」。改为读入即归一化到 LF（与 `build-obsidian.mjs` 一致），比较两侧都归一化。复现：`git -c core.autocrlf=true archive <commit>` 解出的 CRLF 检出。
3. **`npm publish` 无诊断，而且 token 路线本身正在被 npm 废弃**：token 缺失/过期/无发布权/2FA 都只有非零退出码。**已改为 trusted publishing（OIDC）**：workflow 不设 `NODE_AUTH_TOKEN`、显式 `npm install -g npm@11`（要求 ≥11.5.1；**钉 11 不钉 12**——npm 12 默认不跑依赖 lifecycle 脚本，会静默跳过 esbuild 的 `postinstall`）、publish 前加只读诊断（npm 版本 / id-token 端点 / `whoami`）。npm 侧一次性配置（Trusted Publisher → GitHub Actions，填仓库 + workflow 文件名 `npm-publish.yml`）是人工动作。依据：[2026-07-08](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/) 与 [2026-07-31](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/) 的公告；详见 `docs/release.md` §1 与 `handoff.md` 坑 58。

另：为了拿到 CI 的真实报错，临时加过一个 `ci-debug.yml`（把失败命令的输出发到 job summary + 一个 issue）——已随分支删除，issue 也已自动关闭。教训写进 `handoff.md` 坑 56-58 与 `docs/release.md`。**推 tag 前确认 `ci.yml` 的 ubuntu 与 windows 两个 job 都绿。**

> 记忆系统专属的“为什么改、改了什么”。比仓库根 CHANGELOG 更细，面向后续维护者与改造 agent。最新在上。交接文档见 [handoff.md](handoff.md)。

## 2026-09 · 侧栏卡顿排查 + GraphMemix 吸纳决策（0.7.5）

### 一、侧栏卡顿（用户报告「展开左侧边栏很卡顿，其他按钮也类似地卡」）

- **第一轮（错误方向，保留作教训）**：只看了静态资源，从皮肤 `patches.css` 的 4 处 `backdrop-filter`（含一处 `:before { inset: 0 }` 覆盖整个侧栏区域）+ 7 处 `infinite` 动画推断「跨帧毛玻璃让宿主动画每帧重算模糊」，上线了 CSS 注入 + iframe 隔离 + 挂起 + 去掉渲染线程同步 IO。**用户复测仍然卡，且 3080 也卡。**
- **第二轮（用 CDP 实测定位）**：headless Chromium + 真实 dsh + 真实皮肤，用真实鼠标事件做 6 次侧栏开合，采集帧间隔 / LoAF / Task·Layout·RecalcStyle 指标 + V8 采样 profile。对照实验（同轮同代码）：

  | 配置 | 帧 >50ms | 最差帧 | RecalcStyle | LoAF |
  |---|---|---|---|---|
  | 皮肤 JS + CSS 都在（现状） | 3 | 84 ms | 1172 ms（960 ops） | 8 |
  | 皮肤 **CSS 全部移除**（JS 仍在） | 4 | 83 ms | 1165 ms | 8 |
  | 皮肤 **JS 停用**（CSS 仍在） | **0** | **33 ms** | 743 ms（663 ops） | **0** |

  **CSS 那一行毫无变化，JS 那一行全面改善** ⇒ 真因是皮肤 `orca-link` 的**客户端脚本 `hooks.mjs`**：约 14 个 subtree MutationObserver、一个约 5 次/秒改 `DIV.orca-ch-statusCharacterSprite` 内联样式的角色循环、一个跟着侧栏动画每帧触发的 ResizeObserver（读布局 → 写 body 级 CSS 变量 → 翻 `body[data-orca-sidebar-wide]`，每次都是全文档样式重算）。同一个皮肤在 3080 也跑，所以两边一起卡——这解释了「为什么 CSS 修完还卡」。
- **处置（两档，都在代理里，不改皮肤文件）**：性能模式现在除样式表外还**改写 `hooks.mjs` 的两处热循环**（ResizeObserver 180 ms 尾边沿防抖；角色循环下限 1 s），锚点全中才改、否则原样返回并记日志；另有新开关**「侧栏加载皮肤动态装饰」**（默认开），关掉后直接把模块换成空实现（保持 `export default function defineSkinHooks()` 契约）。经**已发布代理**端到端复测：性能模式开（装饰保留）帧 >50ms 从 2 → 0、最差帧 67 → 34ms、LoAF 5 → 1；关装饰后 Task −18%、RecalcStyle ops −34%、LoAF 0。
- 回归：`test-panel-proxy.mjs` 24 → **31** 项（新增皮肤脚本改写 5 项 + 之前的注入 9 项），含「补丁锚点变化时原样返回」「空实现仍满足导出契约」。完整清单与自查用的 DevTools 片段见 `docs/memory/sidebar-performance.md`。

### 二、GraphMemix（Li et al. 2026，arXiv:2608.26983）吸纳决策

论文精读记录 `literature/reading/liGraphMemixQueryAwareEvidence2026.md`（MinerU 的 md 有 5613 个 `<sub>` 标签、3954 处词中断裂，改用 `pdftotext -layout` 重读，SOP 补进 `docs/literature.md` §8）。可吸纳点逐条落成决策，写在 **`retrieval-v3.md` §7**：

1. **已吸收（上一轮落地，本轮只登记）**：适用边界硬门控 + 带原因排除、`harmed`、`verified_by`、声明值 vs 有效值、`degraded`。
2. **多视图 max-pool：实现为可测选项，实测后不采纳**。`composePassageViews()` 拆 `title`/`keywords`/`body`（字段集合与单袋**一致**，保证 A/B 只比较池化方式），`rankRecallDocuments(…, { viewPool: "max" })` 按视图各自长度统计打分取最大；`viewPool` 默认 `"bag"`，返回值如实回报本次池化。真实 vault A/B（11 条 ground truth，top-8）：**Direct 11 → 11、排名均值 1.73 → 2.27、0 改善 / 2 变差**（Fubini-Tonelli 1→5、Helly 3→5）、**Δ = +0 − 0 = 0**。原因：我们的袋已按 kind 截断且有界，稀释本来就小；max 反而丢掉了"查询词分散在标题与正文时两视图分数相加"的信号。**保持单袋默认**，触发复测的条件写在 §7.2。
3. **可达性分层 + 有符号净恢复 Δ 成为常驻测量**：引擎探针新增 §2，从原文抽 `related`/`source`/`[[wikilink]]` 边（**断链不算可达**），分 Direct / Recoverable / No access 三层，并**同时报告目标排名**——本轮 11/11 全是 Direct，只看分层会误判"两种池化一样"。读法约定：改检索必须「Direct 数不降**且**排名均值不升」。
4. **不采纳通用多样性重排**：论文自己的冻结候选实验（Top-K 56.87 / MMR 56.84 / DPP 52.69；净恢复 +43 vs −6 / −36）就是反例，`AGENTS.md` §5 已写纪律。
5. **记录在案不实现（带触发条件）**：查询条件化关系信任 + 锚点槽位（我们的 `related` 边还没有可信度信号）、按打开成本自适应 k（语义设计需拍板）、两阶段适用性判定（等于新增每轮必做步骤，与实测失败模式冲突）。
6. **形态差异（为何不能整包照搬）**：论文靠图数据库多跳找证据路径；我们靠"选候选 → 模型读全文核实"，图是人可读的十几个文件。见 §7.6。

## 2026-09 · 外部设计吸纳：5 个机制 + 当场抓出的一个写坏文件缺陷（0.7.5）

- **背景**：用户指定两个外部项目做吸纳评估（`zy839971925-zyy/Agent--deep-research-Workflow-Skills`、`DeusData/codebase-memory-mcp`），评估存档见 `docs/design-intake-2026-09-10.md`。元结论是「少吸收、多印证」：R1 的多数规则我们**已经在做**（不得自升 verified、导航式注入、验证凭据、fail-closed），R2 的价值是**写入契约的纪律**而不是它的引擎（C + SQLite + 图 + embedding 全套与我们的规模/约束不符）。准入规则：**只吸收「卡片上的字段 + 少量确定性检查」，凡是新增"每轮必做步骤"的一律拒**——理由是实测失败模式是"机制没人用"（真实 vault 里整套反馈面全为 0），不是"机制不够多"。
- **落地 5 件（全部确定性、零新依赖、零模型调用）**：
  1. **适用边界进检索**（R1 `anti_conditions`）：`not_applicable_when` 从注释变成**硬门控**。`note_recall` / `note_strategy` 命中边界短语时不返回该卡，但在 `excluded[]` 里**带命中短语**列出——刻意不做静默丢弃（不可见的假阴性会让用户以为"库里没有"）。实现细节：边界按标点拆成 ≤12 字短片段再做**子串包含**判定；评估时设想的"token 重叠比例"在散文式边界上阈值永不触发（实测），故改为此法，并要求协议把边界写成短句/关键词列表。
  2. **负反馈计数 `harmed`**（R1 `usage.harmed`）：用户点 ❌ 时累加。`uses`/`success_rate` 表达不了"用过且误导"，而体检 weak 桶要求"成功率低**且**用过 ≥3 次"，真实 vault 从未达到 ⇒ 这类卡此前完全不可见。两个面板显示 `⚠️ 倒忙 N 次`（仅 >0 时），体检新增 `counts.harmed`/`sections.harmed`/人话行/清单行。
  3. **验证等级凭据 `verified_by`**（R1 provenance 阶梯）：把「升级必须用户参与」变成**可机检**的不变量——✅ 时由插件写 `user`；❌ 若等级仍在 single-source 之上则写 `none` 作废旧确认；体检把「等级高于 single-source 却无凭据」列入 `structural.unjustifiedUpgrade`（只报告，不自动改：自动改写可能覆盖用户手改）。
  4. **声明值 vs 有效值**（R1 declared/effective）：`retrieval-stats.json` 是**增量**而非总量（体检合并后清零）——评估时误以为它"与 frontmatter 打架"，实际风险是**两次体检之间面板少报**。`collectMemoryState` 现在返回有效 `uses` + `usesDeclared`/`usesPending`；体检回写后**读回核对**，不一致进 `structural.usesMismatch`。
  5. **`degraded` 取代静默成功**（R2 `status:"degraded"`）：三处确定性写入（hook 统计回写、顶层统计回写、hook 历史）全部返回布尔，体检累计 `postconditions` 并输出 `status` + `warnings`，写进人话摘要与模型清单。
- **★ 第 5 条上线当轮就抓出两个真实缺陷**（它的价值证明）：
  - **`syncTopLevelStatsToCard` 把字段写到 frontmatter 之外**：它把**含首尾 `---` 的整块**交给只认"行"的 `setTopFieldText`，所以当策略卡没有 `uses:` 行时，追加的 `uses: N` 落在**闭合分隔符之后**（正文里），且每次体检再追加一行。**这正是此前在 `strategy/strat-ot-structure-proof.md` 里发现并清理掉的那两行游离 `uses: 0` 的成因**——脏数据与缺陷源在同一轮里闭环。现改为在分隔符**内部**拼接，并由读回验证保证落点。
  - **命中无处可写时被静默清零**：既无 `hook` 块又不是策略卡的卡片若累积了命中，旧代码直接把增量清零；现在进 `postconditions.unmergeableStats` 并报警。
- **零代码两条也落进文档**：评审独立性（评审者拿产物+证据、不拿求解者推理；分歧不表决，去找判别性证据）写进协作约定；「不要做通用去冗余/多样化重排」写进 `AGENTS.md` §5，论据是 GraphMemix 的控制实验（MMR 56.84 / DPP 52.69 不优于 top-k 56.87，净回收 −6 / −36；已验证关系 +12/+14，联合森林 +43）。
- **回归**：`test-memory.mjs` 207 → **224**（新增 §33 共 17 项：边界拆词与命中、两条检索路径的排除、无边界卡不误伤、`harmed` 累加与体检计数、凭据写入与作废、越权升级检出、有效 uses 与 pending、同步读回验证、`degraded` 与「无处可写」告警）。

## 2026-09 · 「设计迭代忘记适配」专项审计（0.7.5）

起因：用户问「是否还有别的像『旧 ask 不适配新层』那样、迭代后忘了同步的地方」。做法是按**轴**搜而不是按文件读——把每个"后来才长出来的东西"（层、动作、开关、皮肤、插件包、产物）拿去比对所有向它枚举消费点的地方。找到 6 处，全部修复；另有 3 处判定为**有意为之**并补上说明。

### 真实缺陷（已修）

1. **归档目的地与索引回写写死在 `records`**（`memory-admin.mjs` `archiveMemoryFile` + `math-memory.mjs` `moveCardsToArchive`）。两者都写于"只有记录层可归档"的年代：任何层的卡都移进 `.deepseek/archive/records/`，而且只回写 `records/index.md`。后果：归档一张**策略卡**会把它塞进记录层的归档目录，并让 `strategy/index.md` 里那行变成**悬空链接**。现在按卡自己的层走（`.deepseek/memory/<layer>/x.md` 与 `.deepseek/<layer>/x.md` → `.deepseek/archive/<layer>/`），每个受影响的层各自回写自己的索引；`records` 的映射与从前完全一致（已有归档仍然可找回）。回归 §32 六项钉住。
2. **web 面板的「自动保存对话」勾选状态与引擎相反**：面板写 `checked={cap?.enabled !== false}`，而 `readSessionCaptureEnabled` 对**缺失的键返回 false**（默认关）。于是真正关闭时界面显示"已开启"——用户以为在自动保存，实际什么都没存。改为 `=== true`；路由回归补 2 项把"缺键 = OFF / 写了 true = ON"钉在 `/memory-panel/session-capture` 的返回值上。
3. **文档说 `sessionCapture` 默认开、实际默认关**：0.7.3 发布时确实默认 `true`，后来按"写入记忆先征得同意"的原则改成 `false`（`config.md` 模板与 `agent.cordis.yml` 都有注释），但 `handoff.md` 的历史增量与 `CHANGELOG` 0.7.3 条目没跟着改。CHANGELOG 是发布级文档，留着错话会误导，已就地更正并在 handoff 决策记录里写明这是**有意的默认值变更**。
4. **注入给模型的"分层长期记忆"说明停留在五层**：它说"组织为五层：profile/topics/records/episodes/inbox"，路由清单里只有 theorems，**没有 templates 与 strategy**——而这两层早就在注入里各有一段（模板索引）或至少有一个工具（`note_strategy`）。模型因此拿不到"策略层存在"的提示（AGENTS.md 里有，但注入段自称是完整的分层说明）。现在写明"五层 + 三个在五层之后长出来的检索面"，并补上模板与 `note_strategy` 的路由行。回归 +1。
5. **AGENTS.md 三写第 3 步的清单漏了 `strategy/`**：写的是 `topics/profile/theorems/templates`——策略层是后加的，只出现在 §2 的正文和策略卡纪律里，不在收尾清单里，于是"每轮该写什么"的清单本身不完整。已补入并注明它归 `structure` 档位。
6. **机器本地的 `scripts/deploy-local.mjs`（gitignored）只部署 8/19 个模板**：它手写清单，漏了 `config.md` 与 `strategy/_README.md`——后者是**后加的层**，意味着改 `strategy/_README.md` 永远不会进 vault。改为读 `dsh/templates-manifest.json`，并对用户自有的文件（config / capture-policy / notation）改成**只在缺失时创建**，避免部署脚本冲掉用户设置。⚠️ 该文件被 gitignore，此修复只作用于本机，不随仓库分发。

### 判定为有意为之（补说明，不改）

- **审计只扫 records/templates/strategy**（`AUDIT_CARD_DIRS`）：topics/theorems 是导航与索引卡，没有 hook 统计、也不该被"低效用→建议归档"。代价是 `counts.cards` 与面板状态条的层计数不是同一个口径（体检说"3 张卡"而面板显示"记录 2 · 主题 2 · 策略 1"）。已在 control-panel.md 写明体检口径，不扩大扫描范围。
- **`structural` 的缺 source / 未入索引只对 records 生效**：`source` 证据链是记录层的纪律；话题/策略卡不从 episode 派生，强制它会制造噪音。
- **`notation.md` 在检索语料里按普通笔记（`note`）分类**：它既是注入段又是可检索内容，按笔记处理不会出错（重复出现在两处只是多一点点注入预算）。

### 顺手清掉的脏数据

`strategy/strat-ot-structure-proof.md` 里两行**游离在 frontmatter 之外**的 `uses: 0`（早期写入缺陷留下的真实物证）。用户批准后按最小 diff 删除（只删这两行，frontmatter 分隔符仍为 2 个、正文标题与 source 链接不变），这也是 `summaryOf` 必须跳过"记账行"的原因。

## 2026-09 · 面板第二轮打磨 + 捕获策略扩到四档 + 项目定位（0.7.5）

- **背景（用户五点反馈）**：① 记忆面板同时有「选择路径」和「输入路径」两个框；② 部分浅色文字在当前皮肤下看不清；③ 各条记忆的名称让人 get 不到内容；④ 仓库里"把会话分开"的设计备忘（`docs/session-scope.md`）现在看是不必要的；⑤ 捕获策略的 ask 还适配新长出来的记忆层吗；另加一条定位要求——把「已解决什么、离 1.0 差什么」写进项目。

- **② 的根因值得记住：跨皮肤写样式只能用各皮肤都保证存在的 token**。次级文字用的 `--dsw-alias-label-dimmed` 在用户当前皮肤 `orca-link` 里**根本没有定义**（该皮肤只定义 `primary/secondary/tertiary/caption`），于是那条 `color` 声明在计算值阶段失效、颜色回退到继承值——不是"颜色偏淡"，是"这条样式没生效"。改用 `var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary, …))`。Obsidian 侧同批把 `--text-faint`（出了名的低对比）换成 `--text-muted`。
- **③ 的做法：数据层给出「这是什么」的一行**。新增 `summaryOf(text, meta, hook)`（`memory-admin.mjs`）：frontmatter `summary/description/abstract/one_liner` → 正文第一段有效行 → 策略卡的 `abstraction.principle` → `hook.pattern`。跳过的行包括标题/引用/表格/代码围栏，以及**记账行**——这一步是实测逼出来的：导航层卡片的正文首行是 `- 标签：#…`，而真实策略卡里有两行游离在 frontmatter 之外的 `uses: 0`（早期写入缺陷留下的），两者都会变成毫无信息量的"摘要"。修好后真实 vault 上 5 张卡的摘要全是可读的一句话。两个面板把它显示为标题下的一行。
- **①**：dsh web 面板默认只保留工作区下拉（选项显示工作区名、完整路径进悬停提示，下方一行「当前 vault」）；只有工作区列表为空时才退化为手动输入。
- **⑤ 的答案：不适配，已补齐**。原策略的 idea/fact/preference 是"内容类别"，而协议把效力描述成「三写第 2/3 步先问」——于是**在协议之后才长出来的层**（topics / theorems / templates / strategy）只能靠读者推断归属，`strategy/` 甚至不在三写清单里；记号「收集」的豁免、事件层（episodes）由 `sessionCapture` 管辖这两件事也从没在同一处写清。新增第四个档位 `structure`（topics / 定理索引 / 模板 / 策略）默认 `auto`，并在 AGENTS.md、系统提示注入、策略模板里给出一张**层 → 档位**的对照表；`structure` 缺行等同 `auto`（升级不改变行为）。
- **④ 会话隔离否决**：见 `docs/session-scope.md` 顶部否决块。一句话理由——需求本身来自"面板信息量太低"的错觉，而 P1 要包住被会话搜索 / lineage / 按 URL 打开共用的 `sessionPersistence.list()`，代价与收益不成比例。
- **定位**：记忆系统已解决「agent 记不住用户问过什么」；「辅助用户打磨一套数学理解、并建立对理解/技巧的调用体系」远未解决，**真正实现它才是 1.0**。写进 README 中英 + `docs/memory/README.md` + `handoff.md` 决策记录。
- **回归**：`test-memory.mjs` 193 → **207**（摘要提取 5 项：正文首行、frontmatter 覆盖、无正文时为空、游离 `uses:` 行被跳过、记账行不进摘要；结构层档位与注入表 2 项）。

## 2026-09 · 体检报告与面板呈现重做 + 反馈三选项分层（0.7.5）

- **背景**：用户提出四个问题——① 体检报告「展示的几乎是 ds 的输出记录，令人不知所云」；② 记录层「对、错、归档」三选项「令人不明所以，从日常使用来看感觉意义不大」；③ 记忆面板信息显示待优化；④ Release 没更新版本，Obsidian 插件商店拿不到新信息。先做两份**只读取证**调研（面板呈现 / 反馈设计意图），再动手。

- **取证的关键结论（决定改法）**：
  1. **数据层早就把信息算好了，是呈现层丢掉的**，而且两个面板丢的不是同一批：`collectMemoryState` 只收集 records+templates ⇒ 文档承诺的「五层」里有三层（topics/theorems/strategy，真实 vault 里确有卡）在两个面板**都不可达**；`topic` 可搜索却从不显示；episode 只返回 `{rel,name,mtimeMs}`。
  2. **体检报告只有一根字符串**，同时被注入模型提示、写进 JSON、并被两个面板原样显示 ⇒ 用户读到的是 `[[.deepseek/memory/records/…|最优耦合 … $c$-循环单调集…]](0.327)——向用户建议处置，不自行删除`。
  3. **反馈机制从未被使用过**（全库普查：`last_wrong`/`needs_review`/`last_not_applicable`/`status: superseded`/`verified: user-confirmed`/`success_rate` 全为 0，`.deepseek/archive/` 不存在，🔁 字符 0 个）。机制本身是好的（`confirm` 是验证等级升级的**唯一**确定性通道；`wrong` 的杠杆主要在徽标降级），坏的是**分层与回执**。
  4. **dsh web 面板的 `run()` 丢弃响应体**，点任何按钮界面上什么都不发生；而面板唯一显示的 `success=` 对真实卡永远是 `—`。等于让人对一个不存在的数字表态。

- **改 1：体检报告拆成两个渲染、一份数据**（`dsh/preset/math-memory.mjs`）。`buildAuditReport` 现在返回 `{ schemaVersion: 2, generatedAt, today, counts, decisions, thresholds, sections, structural, passive, checklist, human, checklistChars/Truncated, humanChars, report }`：`checklist` 给模型（路径、阈值、`[[wikilink]]` 都在这里），`human` 给人（计数式标题 + 每条「你能做什么」，不含内部字段名与路径），`sections` 是两者共同的结构化来源。同时修掉一个排序缺陷：`moveCardsToArchive` 在报告行构建**之前**执行，而报告从移动前的数组取数 ⇒ `autoArchive` 打开时报告会建议归档一张**刚被归档、文件已不在库里**的卡；现在用 `archivedRels` 统一过滤全部 section 与 `decisions`，`counts.cards` 同步扣减。
- **改 2：数据层补齐**（`dsh/host/memory-admin.mjs`）。新增 `CARD_LAYERS`（记录/模板/主题/定理/策略）并返回 `layers`（`records`/`templates` 保留为同数组的别名）；新增 `parseEpisodeIndex`（解析 `episodes/index.md` 的 `- [[stem|标题]] — 主题`）与 `episodeDateOf`，episode 现在带 `title`/`topic`/`date`；卡片带 `topic`（一直有）与 `layer`；新增 `readAuditReport`（`readAuditText` 只取字符串，把 `generatedAt`/`counts`/`structural` 全丢了——面板因此显示 09-09 的「共 3 张卡」而实时摘要写「记录 2」，同屏两个卡数）。搜索改为大小写不敏感（haystack 转小写、needle 原样比较 ⇒ `De Finetti` 一条也搜不到）并覆盖 episode。
- **改 3：反馈三选项分层**。
  - 回复行的反馈链接改为**每张卡一行、写明卡标题**：`依据的记忆：<卡标题> — [✅ 这条对] [❌ 这张卡有错]`（`math-memory.mjs` + `AGENTS.md`）。旧模板给 N 张卡发 N 行一模一样的链接，且「这条」读作"这个回答对不对"而实现是**对该卡的永久判定**。
  - **`🔁 不适用` 退出所有 UI**：它只写 `last_not_applicable`，全仓库**无读取方**、排序影响为零——"看起来像 ❌、实际什么都不发生"是最坏的一种选项。宿主保留该 action 与文案（旧对话里的历史链接仍可用），删除会让它们 404。
  - **`归档` 从评估行移出**：它是 `renameSync` 到 `.deepseek/archive/records/`，会让卡同时退出检索与面板列表；摆在 ✅/❌ 旁边等于暗示它是第三种评价。现在它是面板的生命周期动作，带二次确认与危险样式。
  - **回执**：`applyFeedback` 返回的 `message` 由**实际写入**生成（旧文案在没有 `success_rate` 的卡上写「成功率减半」，实际是"无" → 0.25）；两个面板都显示它。
  - **`❌` 不再凭空发明 `success_rate`**：只有卡上已有该字段才改它；无评级卡只降 `verified` 一级并写 `needs_review`。
  - **无 `hook:` 块的卡自动补块**（`ensureHookBlock`）：此前直接返回「该卡片没有 hook 块」且面板把 ✅/❌ 藏起来——**证据最弱的卡反而最不能纠错**（`handoff.md` 早已登记为未做项）。行内 flow 写法仍明确拒绝而不是盲改。
- **改 4：发布链路**。新增 `scripts/check-version-consistency.mjs`（`package.json`/`manifest.json`/`package-lock.json`/`versions.json`/`CHANGELOG.md` 五处同号，`--tag` 时还要求 tag 等于版本且是纯 `x.y.z`）、`versions.json`、`docs/release.md`；三方版本对齐 **0.7.5**；`release.yml` 从「推 tag 零门禁」变成 `npm ci` + 版本一致性 + 重建 `main.js` + `git diff --exit-code` + `npm test`，Release notes 用 `awk -v v="$GITHUB_REF_NAME"` 抽该版本段落（原来取的是 `## [Unreleased]`）。
- **回归**：`scripts/test-memory.mjs` 165 → **207**（§30 面板数据层 22 项：五层收集、episode 索引解析、大小写不敏感搜索、hookless 卡的 ✅/❌、无评级卡不发明 `success_rate`、`audit`/`auditHuman` 分离、v1 旧体检文件的降级摘要、缺文件时 `audit=null`；§31 体检归档一致性 6 项）；`scripts/test-panel-routes.mjs` 25 → **30**（`/state` 必须交付面板真正渲染的字段：五层、episode 标题/主题/日期、无体检文件时优雅降级）。变异验证：把 `parseEpisodeIndex` 的分隔符从 `[ \t]` 改回 `\s`，§30 立刻失败（`\s` 吞掉换行，下一条 episode 的链接被塞进上一条的 `topic`）。文档断言数同步 165 → 224、25 → 28。

## 2026-09 · 修好"验收网自己"：探针改调产品真管线 + 导航索引降权 + 四项决策落地

- **背景**：三路审计的元结论是——138 条断言守卫的是"grep 看得见的东西"和良构夹具上的纯函数，而这次缺陷属于它一条断言都没有的四类（信任边界／输入类性质／资源上限／CI 内的真实端到端）；其中"验收网自己在骗人"有两例：探针手抄打分公式、接受记录无凭据（[../project-assessment-2026-09-10.md](project-assessment-2026-09-10.md) §2 P1-4/P1-10）。
- **修 1：探针改调产品管线**。`note-tools.mjs` 新增三个导出——`buildRecallDoc(rel, raw)`、`rankRecallDocuments(docs, query, opts)`、`rankStrategyCards(cards, query, opts)`，把原先内联在 `note_recall` / `note_strategy` 里的"过滤 → passage → BM25 → 权重融合 → 排序"抽成唯一实现；两个工具改调它，`scripts/qa/engine-probe.mjs` 与 `seed-probe.mjs` 也改调它。**结果：探针测的就是产品跑的**（含 `isRecallEligible` 排除、operator 硬过滤、hook prior、maxResults）。旧探针的 `0.85*BM25 + 0.10*cjk` 与产品的 `0.75*BM25 + 0.10*cjk + 0.15*hookPrior` 分叉自此不可能再发生。
- **修 2：导航索引降权**。`episodes/index.md` 列出全部 episode 标题+主题，对任意中文查询都有很高的字符覆盖率——实测 `矩阵谱半径 Gelfand 估计`（库里确实没有）它给 score 0.95 / coverage 0.86，把"无答案应弱信号"控制项顶掉，并挤占 Fubini-Tonelli、子序列记法的名次。新增 `KIND_CORPUS_WEIGHT = { "episode-index": 0.4, "theorem-index": 0.7 }`：**导航层仍可被检索命中**（它是"这里有什么"的地图，设计上就该在语料里），但排在内容之后。同时把弱信号判据落在**内容文档**上（导航索引天然高覆盖，让它代表"库里有答案"是假警报）。
- **结果**：真实 vault 探针 **9/12 → 12/12**，且**一条 ground truth 都没改**：Fubini-Tonelli rank 2 → 1、子序列记法 rank 7 → 5、谱半径控制项通过。仿真探针保持 8/8。
- **修 3：四项决策落地**（评估 §3 的推荐）：
  1. **皮肤中心开关**保持默认 `false`，改名为「挂载皮肤中心 UI（高级 / 通常无需开启）」，并把"聚合包已自带、关掉它不会关掉皮肤"写进设置页描述；
  2. **junction 镜像自愈**：`existsSync` 跟随链接，悬空 junction 被判"不存在"→ `symlinkSync` EEXIST → 裸 catch 吞掉，这段"持久修复"会永久失效且无日志（本机实测 7 个死链接）。改为 `lstatSync` 判别 + 只在"是 junction 且目标消失"时删除重建 + 记录失败；
  3. **`captureSubagents`（默认 false）**：子代理会话重放父会话前缀，保存它等于重复入库。V3 头部新增的 `origin: subagent` / `delegationDepth` 让判定第一次可行（V2 无此字段 ⇒ 无法区分 ⇒ 一律保留）；`distillSession` 记录 `isSubagent`，preset 捕获与 host 面板计数用同一规则，避免角标报告"捕获永远不会做的工作"。config.md / agent.cordis.yml 已加开关；
  4. **导航索引降权**见上（即决策 4 的落地）。
- **回归**：`scripts/test-memory.mjs` 160 → **165**（新增 §29 子代理过滤 5 项：V3 头部标记、父卡入库而子卡不入、不写子卡 episode、`captureSubagents: true` 可回选、面板计数同规则）；文档断言数同步（`check-doc-consistency` 13 → 15 个锚点，四套件运行期计数：165 记忆 + 25 路由 + 7 握手 + 15 反代（第三批后为 191 + 28））。

## 2026-09 · 侧栏 401 的真正根因：SameSite=Strict cookie + 跨站 iframe → 主进程反代

- **上一轮没修好，原因是判断错了**。抓到 token 并让 iframe 加载带 token 的地址之后，实测（`debug.log`）证明导航确实发生了：
  `[render] iframe src -> http://127.0.0.1:3180/?token=…` 紧跟 `[iframe] load`，**但界面仍是 401 文本**。
- **根因**：dsh 的会话 cookie 是 `SameSite=Strict`（`sessionCookie()` 原文：`…; HttpOnly; SameSite=Strict`）。Obsidian 的侧栏是 **iframe**，顶层站 `app://obsidian.md`、框架 `http://127.0.0.1:3180` —— **跨站**。跨站子框架里 `SameSite=Strict` 的 cookie 既不会被存储也不会被发送，所以 303 之后的 `/` 请求依旧 401。这不是插件能靠"把 token 放进 URL"解决的（`authorizeIndex` 只在带 token 的那一次请求上生效，其余一律 401）。
- **解法：把 dsh 藏到内部端口，插件在主进程做反代**（`class DshWebProxy`）：
  1. dsh 以 `--port 0` 启动 → OS 分配内部端口；**代理监听用户配置的端口**（默认 3180），浏览器只跟代理说话，于是 cookie 的权威（`dsh-auth-<sha256(host:port)>`）稳定且"第一方"；
  2. 代理用 `http.request`（**不能用 `fetch`**——Host 是 forbidden header，会被忽略）以**公共权威**兑换启动 token，保存 cookie；
  3. 每个转发请求注入 `cookie` 并**把 `host` 改写成公共权威**（dsh 的 `requestAuthority` 取 `Host` 定 cookie 名与签名受众）；同时剥掉 `set-cookie`/`x-frame-options`/`content-security-policy`；
  4. `/api/` 前缀的 WebSocket 升级同样转发（客户端用 `new WebSocket(new URL('/api/remote.mux', location.origin))`，所以走代理自然成立）；
  5. `stop()` 关代理并清 cookie（token 随进程消亡）。
- **落地前先做了可行性实测**（一次性探针，全部通过）：权威匹配、首页 200 / 28884 字节含 `__DSH_BOOT__`、静态资源 200 / 516675 字节、`/api` 不再 401/403、`/api/remote.mux` 升级 **101**。
- **回归**：新增 `scripts/test-panel-proxy.mjs`（**15** 项：stub 上游复刻 dsh 的权威命名与 cookie 规则 → 兑换前 401 透传、兑换后 200、静态资源、上游看到的 Host 是公共权威、cookie 注入、升级 101、非 mux 路径拒绝、close 释放端口、外加 5 条"接线"断言）与重写 `scripts/test-panel-auth.mjs`（**7** 项**对真实 dsh**：内部端口 + token → 代理兑换 → 界面/资源/API/WebSocket 全通；未装 dsh 时 SKIP 退出 0）。
- **教训**：第一次诊断止步于"token 没传到位"，而日志显示 token 传到位了；**是 cookie 的 SameSite 语义**在跨站 iframe 里失效。判断"401 是鉴权问题"之后，必须继续问"凭证在这一层到底能不能带到"。

## 2026-09 · 侧栏认证握手：修掉 dsh 0.1.5 的 401 文本页

- **症状**：升级到 dsh 0.1.5 后，Obsidian 右侧栏里的 dsh 界面变成一行英文 `dsh web authentication required; reopen the URL printed by dsh web.`，而插件状态栏仍显示「服务已在端口 3180 就绪」——失败被"端口有响应就算好"的探测掩盖。
- **根因**：0.1.5 的 web carrier 引入了浏览器会话鉴权（`requestRejection`：先 Host/Origin 栅栏 403，再会话校验 401；`/api` 与根路径一视同仁）。只有用启动时打印的 `…/?token=…` 打开过、从而种下 `dsh-auth-<sha256(authority)>` cookie 的会话才能拿到 index。插件把 iframe 指向裸 root，全插件**不消费 token**，而 token URL 只出现在子进程 stdout。
- **修法**（`obsidian/main.template.js` 的 `DshService`）：
  1. `captureAuthUrl` 在 stdout 的 `data` 事件里**流式**匹配 token URL（不能事后翻 `logLines`——600 行环形缓冲会把早期 URL 挤掉），并忽略端口不匹配的 URL；
  2. `iframeSrc` = 持有 token 时用带 token 的地址，否则裸 root（兼容 0.1.5 之前 / cookie 已在 jar 中）；地址变化时 `plugin.refreshViews()` 让已打开视图重渲染；
  3. `resolveAuth(waitForToken)` 用**三态探测**（`ready`/`unauthorized`/`down`）判定就绪：401 不再算健康；`stop()` 清空地址（token 随进程消亡）；
  4. 视图新增 `unauthorized` 状态与专门的提示文案 + **「重启服务」**按钮（token 只能由重新 spawn 取得）。
- **`probeService` 的落点**：它必须访问 `http`，而 `new Function` 里的嵌入代码没有模板作用域闭包，所以实现放在嵌入 loader 的 body 内（多注入一个 `http` 绑定）并随 `return {…}` 白名单导出为 `MEMORY_ADMIN.probeService`；模板侧只做转发。
- **回归**：新增 `scripts/test-panel-auth.mjs`（**13** 项）。它把模板里**真实的** `captureAuthUrl`/`resolveAuth`/`iframeSrc` 抽出来求值（不是复刻），对着一台行为与 dsh 一致的 stub 服务打：裸 root 401 → token URL 303+Set-Cookie → 带 cookie 200 且含 `__DSH_BOOT__`；另测端口不匹配的 token 被忽略、无 token 需求的旧 dsh 仍走裸 root、死端口不报 ready。
- **对真实 dsh 0.1.5 的端到端验证**（一次性，已归档结论）：spawn 真进程 → 抓到 `?token=` → 裸 root **401** → 该 URL **303** + `dsh-auth-…` cookie → 带 cookie 拿到 **200 / 27 659 字节**含 `__DSH_BOOT__` → 去掉 cookie 仍 **401**（对照）。`main.js` 已重建并 `deploy-local`。
- **顺带修 `check-embedded-loader.mjs` 的自证问题**：改为从模板读取真实参数表与 `return {…}` 白名单、断言"白名单覆盖模板消费的每个 `MEMORY_ADMIN.*`"、并**自测**"抽掉任一被消费符号必须被发现"（此前它比对自己抄的那份名单，删掉模板里 5 个符号仍 exit 0）。

## 2026-09 · 安全修复：面板路由的信任边界与记忆卡片的静默损坏（评估 P0）

- **来源**：三路独立代码审计（[../project-assessment-2026-09-10.md](project-assessment-2026-09-10.md)）。审计的元结论是：**138 条断言测的是"grep 看得见的东西"和良构夹具上的纯函数**，而这次的四类缺陷（信任边界／输入类性质／资源上限／CI 内的真实端到端）恰好一条断言都没有；凡是它试图检查边界的地方，期望值往往是从实现自身推导出来的（自指式 oracle）。
- **P0-1 面板路由无鉴权 + 约束根由调用方指定**：`body.root` 直接就是约束根 ⇒ `pathInside(root, target)` 恒真；loopback 不是授权边界（任意网页可发 CORS 简单请求）。修复三件套：root 只在重启述 profile 的 vault（不同路径 403 `root not allowed`）；非 loopback `Origin` 一律 403（含 `Origin: null`）；配置了 `DSH_OBSIDIAN_FEEDBACK_TOKEN` 的实例要求 token（`X-DSH-Token`／`?t=`／body，定时安全比较）。**token 是可选的**：Obsidian 插件给 3180 实例设了它，用户自己的 3080 实例通常没有——那里由 Origin + root 锚定承担。
- **P0-2 `archiveMemoryFile` 零校验**：现在只接受 `.deepseek/<层>/…` 下 `.md` 常规文件，拒绝非 `.md`／目录／配置文件／`..`／vault 根；归档目录改为校验通过后才建（此前被拒请求会留下空 `.deepseek/archive/records/`，是实测验收时发现的）。
- **P0-3 frontmatter 写入的两个静默损坏模式**：`replace(span, text)` 的**替换字符串语义**会展开 `$$`／`$&`／`$'`／`` $` ``（`title: 关于 $$ 的表示` → `关于 $ 的表示`；`$&` 把整段 frontmatter 注入标题），而**空 frontmatter 体**让 `replace("", x)` 在偏移 0 插入、收尾 `---` 被推到文件中央。两者都由面板 ✅/❌ 按钮触发、都报"成功"。改为 `frontmatterSpan` + `replaceFrontmatter` 按**偏移量拼接**（两份自包含副本同步），空体／CRLF 均保持良构；`setHookField`／`setTopField` 不再给空体留空行。
- **P1-15 `install-into-profile.mjs` 静默 no-op**：insert 锚在 flow 风格的收尾 `]`，而仓库三个 patch 都是 block 风格 ⇒ 唯一的面板安装途径从未生效。改为末尾追加 block 项 + 写后断言。
- **P1-3 `/memory-panel/workspaces` 不可达**：root 门禁在路由分发之前，而面板裸 fetch 它 ⇒ 工作区下拉框永远为空。该分支前移。
- **P1-2 LinkServer 二次解码**：`URLSearchParams` 已解码，再解一次让含 `%` 的路径抛 `URIError` 且异常逃出请求监听器 ⇒ 点击永久挂起。删掉两处二次解码 + 整个 handler 包 try/catch。
- **回归**：`scripts/test-memory.mjs` 138 → **155**（新增 §26 写入器矩阵：`$$`／`$&`／`$'`／`` $` `` 四种 `$` 模式 × ✅、空 frontmatter、CRLF、无 frontmatter、span 精确性；§27 归档校验：笔记／目录／vault 根／配置文件／非 `.md`／`..` 全部被拒 + 真卡仍可归档）。新增 `scripts/test-panel-routes.mjs`（**25** 项路由断言）与 `scripts/check-embedded-writers.mjs`（求值 main.js 里**嵌入的那份** `memory-admin.mjs` 并跑真实写入，同时断言嵌入源码 == 仓库源码）。变异验证：拆掉两道守卫，6 条断言立刻失败；注入嵌入漂移，stale-bundle 断言失败。
- **`check-doc-consistency.mjs` 升级**：改为读各套件**运行期**打印的 `__CHECKS__ <passed>/<total>`，不再正则数源码调用点（实测 152 调用点 vs 155 执行，且看不到提前退出）。
- **现场记录（本次实施期间发生并已复原）**：首轮真实验收跑在**尚未部署修复**的已安装 profile 上，把 vault 根目录的 `临时.md` 真归档了一次（已搬回原位、时间戳不变）；被拒请求留下的空 `.deepseek/archive/records/` 已删除；误把 `dsh/host/hook-frontmatter.mjs`（re-export 文件）覆盖到 profile 的扁平副本导致 boot 失败，已用 `dsh/preset/hook-frontmatter.mjs` 复原并随 `deploy-local` 对齐。**教训**：验收必须跑在已部署的新代码上，或先显式记录"当前部署版本"。

## 2026-09 · 适配 dsh 0.1.5 会话格式 V3（同一会话两份日志）

- **触发**：宿主升级 dsh 0.1.1-rc.2 → **0.1.5-rc.1**，web 插件升级到 `@linxin666/dsh-web-all@0.3.20`（旧 `dsh-web-ui-all` 已废弃改名）。上游 release notes 明确：*「会话数据格式升级至 V3……自定义日志读取器需适配 V3」*。完整评估与取证见 [../dsh-0.1.5-adaptation.md](dsh-0.1.5-adaptation.md)。
- **格式事实（本机实测）**：迁移**按需触发**（会话被打开/恢复时），产出 `session.v3.jsonl.zstd` 并**保留** `session.jsonl.zstd`；新会话只写 V3。所以"同目录两份日志"是长期状态。V3 仍是多帧拼接、无字典的 zstd；会话头行仍是第一帧的 `{type,id,cwd,createdAt}`（多一个 `version: 3`）；`user/message`／`assistant/message`／`session/title` 事件名与 `data.source.kind === "user"` 判据不变；逐块流事件（`assistant/chunk`、`*-chunks`）被 `assistant/message.data.stream[]` 取代，事件量更小。⇒ `scanZstdFrames`／`decodeZstdSessionLog`／`distillSession`／`pairMessages` **均无需改动**。
- **真实缺陷**：`findSessionLogs` 的判据只有 `endsWith('.jsonl.zstd')`，两份日志都命中。捕获路径会把同一会话扫两次，并让 `sessions[id].fingerprint` 在 V2/V3 之间来回覆盖（`lastSeq` 增量与面板角标失真）；索引路径让同一会话占掉「最新 20 份」的两个名额、问答对重复进注入预算。
- **修法**：`findSessionLogs` 内新增两步——`sessionLogKey(path)` 取会话身份（**上溯到第一个非 `sessions` 根祖先目录**，即 `<projectKey>/<session-id>/` 里的会话目录；扁平 `<id>.jsonl.zstd` 布局回落到文件名），`selectAuthoritativeLogs(logs)` 每个会话只留权威版本：**先显式优先 `.v3.` 变体**（迁移件才是活的；两者 mtime 可能落在**同一时间戳刻度**上，只看 mtime 会在同刻写入时选错——这正是回归测试第一次跑出来的失败），再按 mtime 取新。去重在 `slice(0, maxFiles)` **之前**完成，`maxFiles` 语义仍是"至多 N 个会话"。结果列表保持 mtime 降序。两份自包含副本（`math-memory.mjs` 与 `memory-admin.mjs`）同步修改，`countUncapturedSessions` 与 `runSessionCapture` 自动共用同一判据。
- **回归**：`scripts/test-memory.mjs` 126 → 138 项（新增 12 项 V3 断言：键推导与 V2/V3 一致、成对折叠、`maxFiles` 按会话计数、V3 事件蒸馏、捕获以迁移件为准且落盘有序、删掉 V3 后回落到 V2 原件）。既有 capture/capture-scan 夹具改为真实 `<session-id>/session.jsonl.zstd` 目录布局（此前是扁平文件，会与新判据撞键）。
- **顺带（非记忆系统）**：客户端面板 `dsh.client.inject` 声明改用 0.1.5 实际存在的包名；皮肤中心可选挂载补注释说明其在聚合包时代已冗余（行为不变）。
- **既有失败（非本次引入）**：`npm run qa` 真实 vault 探针 9/12——探针只读 vault 的 markdown、只用 `note-tools.mjs` 纯函数，不读会话日志；失败源于 vault 内容漂移（`episodes/index.md` 成为高分命中并顶掉"弱信号"控制项）。详见 adaptation 文档 §3.6/§6。

## 2026-09 · 会话扫描不再全量解码（修「整机卡顿/打字几秒才显示」）

- **症状与定位**：用户报「界面很卡，打字要几秒才显示」。插件 `debug.log` 里 `[memory-view] onOpen start` 到 `render start` 之间有 **45.4 s** 空档——`onOpen` 中同步调用 `refreshCaptureBadge()` → `countUncapturedSessions`。Obsidian 插件运行在渲染进程，`readFileSync`/`zstdDecompressSync` 全是同步的，于是整个界面（含编辑器输入）在这段时间完全冻结。
- **根因**：`countUncapturedSessions`/`runSessionCapture`（`memory-admin.mjs` 与 `math-memory.mjs` 各有一份）先用 `findSessionLogs(sessionsRoot, CAPTURE_SCAN_LIMIT=100000)` 取**全部**日志，再对每份都 `readFileSync` + `decodeSessionLog`（全量 zstd 解压 + 逐行 JSON.parse），**之后**才比对 `sessions[id].fingerprint`——本该最先起作用的廉价跳过被放在了最贵的工作之后。而会话归档按 `<cwd 编码>/<session-id>/` 分目录，本机 389 份日志里只有 40 份属于本 vault：**约 98% 的解码结果被 vault 过滤直接丢弃**。实测单次 count **48 641 ms**、capture **51 416 ms**。
- **修法（三处）**：
  1. `readSessionHeader(path)`：只读头部 64 KiB、只解压第一个 zstd 帧，取出会话头行 `{type,id,cwd}` 做归属判定。同一存储读全部头部 **591 ms** vs 全量解码 **34 078 ms**；且它对路径写法差异（`D:\…` 与 `D:/…` 都会出现）天然免疫，比按 `projectKey` 反推目录名更稳。
  2. marker 增加 `scanned`：`日志绝对路径 → {fp, inVault, pending}`，与 `sessions` 并存（`schemaVersion` 保持 1，故旧 marker 无损迁移）。未变化的日志只 `stat`、永不重读；外部工作区日志特征化一次后永久跳过。`capture` 路径遇到 `pending:true` 记录会**照常解码**，所以缓存绝不会吞掉一次待写增量。
  3. `count` 路径会把 `scanned` 写回（它是会话日志的纯函数缓存），但 `persistCaptureState(..., keepDiskSessions=true)` 会重读磁盘并让**磁盘上的 `sessions` 胜出**——Obsidian 与 dsh host 路由可能并发写同一文件，而 `sessions.lastSeq` 一旦丢失会导致对话尾巴被重复追加。
- **兜底**：头部读不到时（首帧 > 64 KiB、文件被截断）**不缓存** `inVault:false`，改为回退全文解码判定——错误缓存会让该会话永久漏捕。
- **顺带修 `buildDialogueIndex`**：原先在**全局最新 20 份**里筛本 vault（先解码后过滤），既白解码别的工作区，又可能让索引几乎为空。改为先按头部筛出本 vault 最新 N 份再解码：3 974 ms → **590 ms**，本 vault 会话真正进索引（15 来源 / 39 问答）。`getDialogueIndex` 的失效指纹同步改为对**同一筛选结果**计算，避免别的工作区变化无法触发重建。
- **插件侧**：`main.template.js` 的嵌入 loader 需多注入 `openSync/readSync/closeSync`（`new Function` 参数表 + 实参 + `require('fs')` 三处，缺一处即运行期 ReferenceError）；未保存角标改到 `setTimeout(…, 0)`，冷启动扫描不挡首绘。
- **回归**：`scripts/test-memory.mjs` 118 → 126 项（扫描缓存不变量 + 超大首帧回退；本轮 V3 适配再增至 138 项）；断言数与 7 处文档锚点同步。`main.js` 已重建。

## 2026-08 · 自动保存对话落地（obelisk-comparison.md §5，版本 0.7.3）

- **背景**：对照 Obelisk 定位最大差距「该记的没记」——episodes 证据层此前只靠模型三写自觉，会漏。实证解码真实会话日志确认：思考（reasoning）是独立事件 + assistant 内容块，`contentText` 天然排除；会话有稳定 `id` + 每事件单调 `seq`。
- **`distillSession`**（`math-memory.mjs`）：加 `seq`/`createdAt` 字段 + `opts.userClip/assistantClip`（dialogue index 维持 500/320，capture 用 4000/4000）。
- **新增对话保存**（`math-memory.mjs`）：`localDateFromMs` / `planSessionDelta`（按 seq 算增量）/ `renderConversationTail`（尾截断）/ `readCaptureState` / `runSessionCapture`（扫 sessions → 解码 → vault 过滤 → 增量 → 写 `episodes/<date>-<sessionId>.md` → 更新 index → 写 marker）+ `appendEpisodeIndex`。
- **配置贯通**：`sessionCapture`（默认 true）进 `config.md`/`agent.cordis.yml`/`parseMemoryConfig`/`normalizeConfig`；`MemoryEngine.captureNow()`（节流 60s、fail-closed），在 `apply` 启动时 + `system-prompt/assemble` 时 `setTimeout` fire-and-forget 触发。
- **粒度**：整场对话（user + assistant 正文，reasoning 排除）；单消息 ≤4000、单会话 ≤24000，尾截断保留最新。
- **幂等/续接**：marker = `cache/captured-sessions.json`（`schemaVersion` + `session.id → { lastSeq, fingerprint, file }`），只追加 `seq > lastSeq` 的 delta；文件指纹变化即重扫（续接旧会话也补新尾巴）。
- **回归**：`scripts/test-memory.mjs` 104 → 118 项（distill 排除思考/带 seq、planSessionDelta、尾截断、日期格式、真实 zstd 端到端、vault 过滤、marker、续接增量、capture-toggle 开关往返）；断言数与 README/ARCHITECTURE/handoff/docs-memory-README 同步；版本 0.7.2 → 0.7.3。
- **双面板 UI 落地**：`memory-admin.mjs` 新增 host-agnostic 捕获核心（`runSessionCapture`/`countUncapturedSessions`/`readCaptureState`/`setSessionCapture`/`readSessionCaptureEnabled`，含 zlib 解码，与 math-memory 同步）；Obsidian 侧 `main.template.js`（MEMORY_ADMIN 加载器注入 `zstdDecompressSync`/`dirname`，设置页「自动保存对话」toggle，MemoryView「立即保存对话」按钮 + 未保存角标）；dsh web 侧 `math-memory-panel.mjs`（`/memory-panel/session-capture` GET/POST + toggle 路由）+ `client-panel`（开关/按钮/角标）。`main.js` 与 `lib/client.js` 已重建。

## 2026-08 · Obelisk 对照与「捕获确定性」提案（obelisk-comparison.md，待拍板）

- **背景**：调研成熟 agent 记忆系统 [Obelisk](https://github.com/tommy0103/obelisk)（SQLite+Litestream 的持久化活动记忆 + 确定性工作流），对照我们的数学语义记忆，定位最大差距。
- **产出**：新建 `docs/memory/obelisk-comparison.md`（未改代码）：对照表 + 「捕获确定性钩子」具体方案——把「按需三写」补一个确定性会话落盘（复用已有 `$DSH_HOME/sessions/*.jsonl.zstd` 全量日志 → append 进 episodes），幂等 + 三触发候选（session-close 钩子 / Obsidian 启动 sweep / system-prompt 组装增量），评估为 P0。
- **入库**：`references.md` §11 新增 Obelisk（URL、机制、映射、不适用部分）。
- **登记**：`README.md` 导航/状态表、`handoff.md` §7 下一步候选同步。
- **待办**：三点待用户拍板（触发时机 / 落盘粒度 / 是否默认开），拍板后再动代码。

## 2026-08 · 记忆纠错与确定性自维护落地（self-correction.md P1–P5，版本 0.7.2）

- **P1a**（`note-tools.mjs`）：新增 `isRecallEligible()`，`note_recall` 排除 `status: superseded` 与 `duplicate_of` 非空的卡（旧卡只留作证据、不再当活跃候选）；`classifyVaultDoc` 补 `.deepseek/archive` 跳过。
- **P1b**（`memory-admin.mjs`）：`wrong` 反馈改为 `success_rate = min(×0.5, 0.35)` + 降一级 `verified`（user-confirmed→cross-referenced→single-source）+ 写 `last_wrong`/`needs_review`。
- **P1c**（`note-tools.mjs`）：检索打分 `0.85/0.10/0.05 → 0.75/0.10/0.15`（命名常量 `RECALL_BM25/CJK/PRIOR_WEIGHT`），纠错信号对排序影响从 ~3% 提到 ~10%。
- **P2**（`math-memory.mjs`）：体检新增「待重审」段（`needs_review`/`last_wrong` 卡），返回 `pendingReview`。
- **P3**（`math-memory.mjs` + 配置）：新增 `autoArchive` 开关（默认 off，`config.md`/`agent.cordis.yml`/`parseMemoryConfig`/`normalizeConfig` 贯通）；体检确定性把「零使用 + >90 天陈旧 + 非确认」卡移入 `archive/records/`（`moveCardsToArchive`，移动非删除，索引链接同步改写）。
- **P4**（`math-memory.mjs`）：体检给重复对的冗余侧确定性写 `duplicate_of: [[保留方]]`（`setTopFieldText`），检索据此去重。
- **P5**（`note-tools.mjs` + `math-memory.mjs`）：`note_strategy` 加 verified 先验、跳过 superseded、记录命中统计；体检读取策略卡顶层 `uses/success_rate/verified`（hook 缺省回退到顶层）、回写顶层 uses/last_used（`syncTopLevelStatsToCard`）、确定性 `candidate→active`（uses≥3 且 rate≥0.6）。
- **回归**：`scripts/test-memory.mjs` 90 → 104 项；断言数与 README/ARCHITECTURE/handoff/docs-memory-README 同步；版本 0.7.1 → 0.7.2（package/manifest/package-lock/README/README.zh/handoff/CHANGELOG）。
- **待办**：真实 E2E 与 Obsidian 本机部署验收仍留用户侧；`autoArchive` 默认 off，用户可自行在 `config.md` 开启。

## 2026-08 · 记忆纠错与确定性自维护提案（self-correction.md，待拍板）

- **背景**：逐行审查记忆系统的纠错链路后，确认四个具体缺口——`superseded` 卡不降权、`❌` 反馈惩罚弱且不降 `verified`、纠错信号在检索里权重只有 5%、语义纠错无确定性兜底；并调研 OpenViking（Volcengine 开源「Self-evolving Context Database」）的强度/遗忘/巩固模型。
- **产出**：新建 `docs/memory/self-correction.md`（提案，未改代码），五条改动方案 + 评估与取舍：P1 纠错进检索三件套（superseded 排除 / wrong 降 verified+惩罚更陡 / hookPrior 权重 0.05→0.15）、P2 待重审清单、P3 低效用卡确定性自动归档（默认 off）、P4 duplicate_of 标记 + 检索去重、P5 strategy 卡纳入统一生命周期。
- **入库**：`references.md` §10 新增 OpenViking（URL、机制、映射、不适用部分）。
- **登记**：`handoff.md` §7 下一步候选、`README.md` 导航/状态表、`design.md` §10 已知局限同步。
- **待办**：两条争议点待用户拍板（`❌` 是否降 `verified`、自动归档默认开关），拍板后再动代码。

## 2026-08 · 基准 E2E 实测 + 两处修复

- **实测**：基准套 B（8 维度）用 deepseek-v4-flash 跑通，**8/8 PASS**（总 ~256K tokens：input/output 分项 + cacheRead 都记入 baseline）；基线快照与 session log 归档在 `scripts/qa/runs/run-*/`。
- **修 `e2e.mjs` OOM**：原 `DSH_SESSIONS_ROOT` 指向用户真实 `$DSH_HOME/sessions`，对话索引扫描/解码真实会话日志（含长会话）触发 `JavaScript heap out of memory`；改为指向临时空目录 `tmpDir/sessions`，基准不再扫真实会话（对话索引不属于基准考察范围）。
- **修 `e2e.mjs` spawn stdio**：从文件 fd（`openSync`）改为 pipe + 事件回写 service.log（更稳；排查 OOM 时顺带）。
- **修 `benchmark-cases.json` 案例 6 断言**：`mustNotContain ["子列","对角线"]` 过严——agent 用 Egorov 定理正确回答"a.s. 蕴含依测度"，其证明合法提到"子列"，被误判 FAIL；改为 `mustNotContain ["不蕴含","不一定"]`（只拦错误方向）。
- 实测发现（记录，非阻塞）：案例 1 agent 会先 `ask_user_question`（捕获策略 idea 档 ask 触发），harness 按"合法终态"处理、断言在提问前已满足——后续可考虑在基准中禁用 ask 或给"捕获档位 off"的专用 config。

## 2026-08 · 策略层落地（strategy-layer.md 实现）

- 实现策略层（`strategy-layer.md`）：strategy 模板（`strategy/_README.md` + `strategy/index.md`）+ working.md 模板 + `note_strategy` 工具 + working.md 注入 + AGENTS.md 策略层路由 / iterative retrieval / 策略卡纪律（templates-manifest 注册三份新模板）。
- `note-tools.mjs`：新增 `RETRIEVE_TARGETS` 枚举、`classifyVaultDoc` 的 strategy 分支（+ working.md skip）、`composePassage` 的 strategy 分支、`strategySurface`/`strategyMoves`/`strategyRetrieve`/`strategyAbstraction` 解析器、`note_strategy` 工具（difficulty 主匹配 + BM25 对 difficulty/move/abstraction 打分）。
- `math-memory.mjs`：`buildMemorySection` 注入 working.md（≤500 字符、空则跳过）；`AUDIT_CARD_DIRS` 纳入 `strategy/`。
- 回归 85→90（classify strategy / working 注入 / strategy 解析 ×3）；main.js 重建。

## 2026-08 · 基准搭建（benchmark.md 部分实现）

- 建**仿真 vault** `scripts/qa/benchmark-vault/`（15 文件：抄书式/方法卡/stub/备忘四种风格 + .deepseek 的 records/hook/theorems/templates/episodes/strategy/inbox/notation/profile，冻结 ground truth，只留数学统计）。
- 新增 `scripts/qa/seed-probe.mjs`（零 token 套 A）：note_recall + note_strategy 双路 ground-truth 断言（8/8 PASS）。
- 新增 `scripts/qa/benchmark-cases.json`（套 B，6 维度各 1 题：换说法/抽象层级/策略召回/溯源/防幻觉/适用性陷阱）；`e2e.mjs` 扩展写 `qa/runs/<runId>/baseline.json`（git commit + 逐用例 verdict/trace/cost + summary）。
- `run.mjs` 改为「seed-probe → engine-probe（可选）→ e2e（可选）」。
- `e2e.mjs` 扩展：多轮（`followup`）+ 会话后 vault 检查（`vaultCheck`）+ session log 归档（复制本次运行新产生的 `.jsonl.zstd` 到 `qa/runs/<runId>/sessions/`）；8 维度用例齐（维度 7 多轮续接、维度 8 写回 vaultCheck）。**待做**：真实 token E2E 实测（留用户本机跑）。

## 2026-08 · 策略层设计规格（strategy-layer.md，提案）

- 入库并蒸馏 4 篇检索对齐文献（Dual RAG / QueryLink / HyPE / MemSearcher，共 19 篇、19 篇全蒸馏），跨论文综合见 `literature/notes/retrieval-alignment-2026-08.md`。
- 与用户讨论收敛出「策略层」设计，写 `docs/memory/strategy-layer.md`（**提案，待拍板**）：方法层（strategy 卡：difficulty 主轴 + domain 软轴 + move→retrieve + 抽象阶梯 + not_applicable_when）+ 工作记忆（working.md 覆写草稿）+ iterative retrieval（≤1 次 note_strategy + ≤4 步）+ 审计驱动 promote/demote（复用现有 hookPrior）。
- 核心结论：现有 note_recall 是 document-level retrieval，缺「方法/思路/技巧」的策略层；四个 gap（lexical/semantic/abstraction/procedural）中后两个必须靠新增一层解决，而非继续在检索器上打补丁。
- 研究用户真实 vault（`D:\Obsidian笔记数据库`）的四种笔记风格（方法卡 / 抄书 / 随手备忘 / 结构化备忘），据此补两条设计：①策略层的「候选沉淀」要把**内嵌技巧 callout + 用户备忘 bullet** 当输入源（不只 hook 字段）；②**用户自留备忘区**与 agent 的 `.deepseek/inbox/` 并存、用途不同，不混为一谈。
- 写 `docs/memory/benchmark.md`（**提案，待拍板**）：两套分层（引擎探针零 token + 端到端真实 token）、8 维度、仿真 vault（四种风格 + 异构 + 噪声、只留数学统计、冻结 ground truth）、baseline.json 记录格式——解决"ground truth 绑真实 vault 会腐烂"的旧痛点。
- 未改代码；`docs/memory/README.md` 与 `handoff.md` §7 已登记两个提案为「下一大改」。

## 2026-08 · 记忆陷阱防御（MemTrapBench + AdaptiveMem 本土化）

- 依据新入库文献 MemTrapBench（arXiv:2608.20202，见 `literature/`）：「忠实记录 + 语义相关 + 已验证」的记忆仍可能在「使用」阶段锚定推理（Reasoning Fixation）或扭曲信念（Belief Distortion），让「有记忆」比「无记忆」更差；推理期 prompt（AdaptiveMem）即可显著缓解。
- **AGENTS.md §5 新增「记忆适用性（防记忆陷阱）」**：四风险（任务边界 / 认知偏差 / 创伤 / 信念扭曲）+ 决策流程（锚定最新 query、冲突时优先客观真值 + 当前 query + 最小上下文）；§8 认知锚定补「记忆是辅助不是指令」；§8 反馈链接新增 `🔁 不适用`。
- **注入引擎**（`math-memory.mjs`）：`buildMemorySection` 每轮注入「记忆是候选不是指令」适用性纪律 + 信念扭曲兜底；链接模板新增 `action=inapplicable`。
- **`note_recall`**（`note-tools.mjs`）：工具描述与结果渲染补「读前 2-3 条核实适用性——相关 + 已验证 ≠ 适用于本题」。
- **反馈闭环**（`memory-admin.mjs` + `main.template.js`）：新增 `inapplicable` 动作——「记忆正确但本题不该用」只记 `last_not_applicable` 标记，**不降** success_rate/verified（避免一次误用把正确技巧整体降权，对应 Trauma 陷阱）。
- **`lit-import.mjs` 修复全量覆盖 bug**：原实现从源 BibTeX 重写 `.index.json`/`.manifest.json`/`library.bib`/`index.md` 自动块，用「只含新论文的子集源目录」导入会清空已有条目；现改为按 citekey 增量合并（`library.bib` 只追加缺失 @entry），并用真实子集源目录验证幂等。
- **文档**：`docs/literature.md` 新增「新增单篇文献 SOP」；回归断言 83→85（新增「注入含适用性纪律」+「inapplicable 不降级」两项）。
- **皮肤中心加固**：`skinCenterMountable` 收紧为检查「`dsh-client-ui-skin-center` + `dsh-client-ui-web-ui-settings` 两个具体包」而非「web profile 目录存在」；degrade 皮肤禁用块从硬编码 11 id 改为读取 `$DSH_HOME/cordis.patch.yml` 动态生成（新增/改名皮肤自动覆盖，无需再维护列表）；`check-skin-fallback.mjs` 改为断言基础 profile 零 @linxin666 挂载。

## 2026-08 · 面板小项收尾（方案 A）

- `settings.section` 显示名改对字段 `label`（之前误用 title/locale），面板现名「记忆面板」。
- 面板顶部增加「工作区下拉」（宿主新增 `GET /memory-panel/workspaces`，注入 workspaceRegistry）+ 手动输入。
- Obsidian 插件（方案 A：保持两实例）新增命令「在 dsh web 打开记忆面板」与设置 `memoryPanelUrl`（默认 3080），用 electron.shell.openExternal 打开主 dsh web；notes profile 仍保持独立/fail-closed。
- `npm test` 82/82 全绿，main.js 重建。

## 2026-08 · Phase 2b（dsh web 记忆面板）

- 客户端包 `dsh/client-panel/`：`src/index.jsx`（React 面板，settings.section 槽位：vault 路径输入 + 记录/模板/备忘录/体检 + ✅/❌/归档）+ `build-client.mjs`（esbuild → `window.__ModuleLoader__.load`）+ `install-into-profile.mjs`（装进 web profile + insert cordis.patch.yml）。
- 装配机制：web profile 的 `dsh.profile.bundles` 里 `dsh-web-ui-all` 聚合各 `dsh-client-ui-*`；本面板作为独立包 insert 进 `profiles/web/cordis.patch.yml`（host 半 index.mjs 挂 /memory-panel/*，client 半 client.js 挂 settings.section）。
- 已实测：主 dsh web（3080）Settings 出现记忆面板，填 vault 路径后能拉取 `/memory-panel/state`。
- 遗留小项：settings.section 的显示名未接 i18n（按钮无名字，纯外观）。

## 2026-08 · Phase 2a（host 面板路由）

- 新增 `dsh/host/math-memory-panel.mjs`：host-plane 插件（inject webServer），挂 `/memory-panel/*` 路由（loopback-only + pathInside 门控），复用 `memory-admin.mjs`：state / feedback / archive / capture-policy / archive-episodes。
- 接线：`install.mjs` 与 Obsidian bootstrap 把 `memory-admin.mjs` + `math-memory-panel.mjs` + `hook-frontmatter.mjs` 写进 profile 目录；`notes-assistant.patch.yml` 挂载 `math-memory-panel`；`npm test` 增语法检查。
- 冒烟：profile 启动后 `GET /memory-panel/state` 返回 `{ok:true,state:{...}}`。
- 剩余：Phase 2b 客户端面板（settings.section 槽位）。

## 2026-08 · Phase 1 解耦（host-agnostic core）

- 新建 `dsh/host/memory-admin.mjs`：把 Obsidian 插件里的确定性记忆操作 + 面板数据层抽成纯 node:fs/path 函数（pathInside/setHookField/setTopField/setCapturePolicyMode/applyFeedback/archiveMemoryFile/archiveOldEpisodes/parseMemoryFrontmatter/titleOf/daysSinceText/collectMemoryState/readAuditText/FEEDBACK_MESSAGES），hook 解析器与 capture-policy 模板改为注入。
- 接入构建：`build-obsidian.mjs` 嵌入该文件；插件 `MEMORY_ADMIN` 加载器（import/export 剥离 + 注入 fs/path）；插件本地同名函数全部改为别名/薄封装，消除重复。
- 冒烟验证：加载器 eval 后 13 个导出可用；`npm test` 82/82 全绿；main.js 重建。

## 2026-08 · 记忆系统强化第二轮（recency + 模板/记录 schema + QA 验收）

- `hookPrior` 增加新近度项（90 天线性衰减，Belief Memory λ^τ 推广到 records），权重 0.45/0.25/0.20/0.10。
- records 模板新增 `confidence` 字段与「可修订记录（置信与备选）」规则；templates 维护规则补定理表聚合/按定理重选模板/解题步骤为实质性推理；profile 补静态/动态标注；AGENTS.md §8 环境变量旧名改 `DSH_MATH_MEMORY_LINK_URL`，三写补去重与备选、§4 补定理表聚合与条件演化门。
- 回归 81 → 82；main.js 重建。
- QA 验收：`npm test` 82/82 全绿；引擎探针 12/12 PASS（真实 vault `D:/Obsidian笔记数据库`）；`qa:e2e` 尝试运行但 dsh 服务启动即退（exit code 1）——需用户侧模型凭据/余额/环境，复跑命令见下。

## 2026-08 · 记忆系统强化第一轮（promote/demote + 热度归档 + 反模式 + 被动信号）

- 依据 14 篇文献综合评估（literature/notes/memory-system-review.md）落实高优先级改进。
- note_recall：hook 先验改为 verified/success_rate/uses 三因素（`hookPrior`，promote/demote）；检索统计新增 `__meta__`（总调用/空结果）。
- 体检：新增 反模式（weak + artifact 失败卡）、低效用归档候选（热度三因素排序）、检索健康（空结果率）；stats 重置同步清 `__meta__`。
- AGENTS.md：三写补自动链接、Refine 步、promote/demote 说明、反模式/归档候选/检索健康处理规则、检索粒度纪律。
- 回归 75 → 81；main.js 重建。

## 2026-08 · 仓库文档大改（结构收敛 + 漂移清零 + 一致性守卫）

- 背景：审查发现根目录与 `docs/memory/` 两份文档集存在事实漂移（测试断言数在 README/ARCHITECTURE/TESTING 各写 63/70/75）、导航缺口（`docs/memory/README.md` 漏列 control-panel/testing/handoff）、两个孤儿文档（根 `docs/archive/REFACTOR-PLAN.md`、根 `TESTING.md`），以及双 changelog 的双写负担。
- 改动：断言数统一为真实值 75（以 `scripts/test-memory.mjs` 的 `check()` 数为准）；README 双语旧身份 `obsidian`→`notes-assistant`；design.md 注入段名改 `dsh-math:memory`、删除「hook schema 无版本常量」这一已失效局限；env 旧名改新名并注明兼容。
- 结构：`docs/archive/REFACTOR-PLAN.md` 加历史档案横幅退役；根 `TESTING.md` 并入 `docs/memory/testing.md`（新增「本地验收手册」节）；`docs/memory/README.md` 导航补齐 3 份；根 CHANGELOG 定位为发布摘要，记忆细账只进本文件。
- 守卫：新增 `scripts/check-doc-consistency.mjs`（断言数与代码实测自动比对），接入 `npm test`，从机制上防止数字漂移复发。

## 2026-08 · 皮肤中心在 obsidian 界面不可见（挂载宿主补齐）

- 症状：用户实测 obsidian 内嵌 dsh 界面找不到皮肤中心与透明度调节；boot manifest 里 `ui-skin-center` 正常加载。
- 根因：皮肤卡片向 `web-ui.plugin.item` 槽注入，而渲染该槽的「Web UI 插件」分组卡由 `ui-web-ui-settings` 提供——profile 只挂了 `ui-skin-center`，卡片注入了槽却无人渲染（主 web 界面能见是因为 web-ui-all 全家桶带着宿主）。
- 修复：`cordis.patch.yml` 补挂 `ui-web-ui-settings`（纯 UI：设置页分组卡 + loopback 设置桥，无 agent 工具）；无 web profile 可镜像时，降级 fallback 块同步禁用该条目保证可启动。入口：设置 → 插件 → Web UI 插件 → 皮肤中心。
- 教训：dsh-web-ui 家族插件卡片不自我渲染——挂卡片前先确认「渲染该槽的宿主」也在 profile 里。

## 2026-08 · 记号体系（notation system）：收集 → 统一 → 维护

- 背景：此前记号只被「被动保留」（§0 一句），profile 的记号节长期空置；用户指出「用户一开始未必有统一习惯，需要 agent 协助打磨」。
- 载体：`memory/notation.md`（已采纳/候选/已否决三表 + 修订历史；每条带出处；同符号跨领域分表）；模板三路安装（Obsidian bootstrap / npm 安装器 / deploy-local）。
- 协议（AGENTS.md §2）：收集不打扰（新用法即记，带出处）；统一是核心——发现不一致提「现状两例 + 推荐记号 + 取舍理由」，ask_user 确认后入已采纳；用户无统一习惯时先观察多次用法再提、不过早强制；维护——偏离温和提醒一次、换记号走 ~~旧~~→新（日期）。
- 注入：`buildMemorySection` 新增「记号体系」段（≤800 字符，缺失时不注入）；回归 +1（fixture 断言注入）。

## 2026-08 · 回复质量原则与捕获策略补强（prompt 层 + 设置页 UI）

- **学习对话原则**（AGENTS.md §8）：直觉先行、认知锚定（新内容与用户已有笔记挂钩并点明关系）、难度自适应（拿不准就问「直觉版还是严格版」）、苏格拉底式纠错（先反问引导一轮再直接纠正）、学习场景适度展示思路、低频检查性收尾、陌生记号定义；persona 同步「学习伙伴」定位。
- **捕捉协议补强**（AGENTS.md §6）：ask 档提案必须含「一句话想法 + 为什么值得捕捉 + 拟写入类型与关联条目」；auto 档写入后回复末尾注明「已捕捉：<标题>」（用户可见 auto 写了什么）；fact/preference 的 ask 档与想法提问合并，每轮最多一次。
- **设置页捕获策略 UI**（main.template.js）：三个下拉框（idea/fact/preference × ask/auto/off，含效果说明文案）→ `setCapturePolicyMode` 主机侧最小 diff 写回 `capture-policy.md`（刷新 updated 日期；文件缺失时以内嵌模板补建）。设置页与面板编辑、文件直改三入口等效。

## 2026-08 · 检索 v3 自动探针与真实会话端到端验收

- 零 token 引擎探针 `scripts/qa/engine-probe.mjs`（本机脚本，12 组 ground-truth）：发现并修复「无答案查询仍得 0.9+ 自信分」缺陷——`note_recall` 命中新增 `coverage`（查询词覆盖率，<0.35 判弱信号），AGENTS.md 同步；修复后 12/12 PASS。
- 真实会话 E2E（真实 web 服务 + obsidian preset，4 题）：note_recall 均为首选入口；蒸馏查询格式正确；「读前 2-3 篇核实」执行；「改写重试一次」在无答案题真实发生；模型自行引用 coverage 阈值判弱命中并**明说没有、不编造**。4/4 通过（证据详见 retrieval-v3.md 验收节）。
- 教训：dsh-headless 不装配 agent preset，不能作为本插件的验收路径。

## 2026-08 · 检索 v3 S6：审计结构校验

- `buildAuditReport` 新增确定性结构检查（只查 records 卡）：① 缺 `source`；② `source`/`related` 里的 wikilink 目标在 vault 内不存在（断链，候选路径含 episodes/records/topics/templates/inbox）；③ `records/index.md` 存在但缺该卡行（未入索引）。
- 报告注入「结构校验：缺 source N 张（…）；断链 M 处（…）；未入索引 K 张（…）」行（前三名，有界），返回对象新增 `structural` 计数；AGENTS.md 体检段增兜底规则——三写第 2 步从纯自律变成「自律+体检兜底」。
- 回归 +4（缺 source/断链/未入索引/报告行），总数 55 → 59。

## 2026-08 · 检索 v3 S5：导航式注入（移除逐轮召回）

- 删除「本轮记忆召回」段（2200 字符/轮）与全部召回语料机制：`buildRecallIndex`/`rankRecall`/`recallDocsFor`/`recallTextFor` 及 `recallEnabled/recallTopK/recallMaxChars` 配置、`#recallCache`；
- 系统提示只保留导航层（profile/topics/records/templates/episodes/inbox 摘要 + dialogue 线索 + 体检），「相关内容」全部按需用 `note_recall` 拉取——注入语义与工具检索同一套排序，不再有两套打分；
- memo 相关性提醒（memoDigest 的 relevance 阈值）保留——那是提醒机制而非召回；
- 回归：召回排序断言退役（被 note_recall 的 BM25 测试取代），新增导航断言 3 项（导航层存在/无召回段/总长有界 ≤18000 字符）。

## 2026-08 · 检索 v3 第一批（S1 统一入口 + S2 BM25 + S3 精读协议）

### 背景

依据 AgentIR/RaDeR/LeanSearch v2 三篇论文与端到端审视（retrieval-v3.md v2 提案），用户确认「现状可推倒重来，优先正确且快速，token 花在刀刃上」。

### S2 BM25 打分器

- `bm25Score`/`computeCorpusStats`/`rankBm25`（k1=1.2, b=0.75）：词频饱和、IDF、长度归一；note_retrieve 打分与召回注入排序两处替换 overlap 系数（`weightedOverlap` 仅保留给 memo 相关性阈值——需要 [0,1] 有界刻度）。

### S1 统一入口 note_recall

- 一次 `listNotes` 遍历同时覆盖用户笔记与 `.deepseek` 记忆层；`classifyVaultDoc`（note/record/template/memo/topic/theorem-index/episode-index/skip——episode 正文与脚手架不进语料，证据仍走 grep/read）；
- `composePassage` kind-aware 组装（LeanSearch structured passage 本土化）：hook 卡强调 hook 字段+正文头 800，memo/note 强调正文头，索引类保留行内容，frontmatter 一律剔除；
- 打分 = 0.85×BM25 池内归一 + 0.10×CJK 字符包含 + 0.05×成功/使用先验；hook 命中统计（uses/last_used）迁移到 note_recall，体检回写闭环不变；
- 真实 vault 探针发现并修复两个词法缺口：Unicode 连字符归一（Borel–Cantelli≡borel-cantelli）、`cjkCharOverlap`（桥接 子列/子序列）；探针结果：Wasserstein 查询命中 topic+memo+相关笔记混排正确，「子列选取 紧性 加强」备忘录 #1；
- `note_retrieve` 工具退役（解析/打分纯函数保留供体检复用）；旧统计注释与文档全部同步。

### S3 精读挑选协议（AGENTS.md 重写）

- 查询蒸馏强制格式：挑战描述 + 2~3 候选技巧；多步问题先写步骤草图、逐步检索；
- 精读挑选：读 top 2-3 全文逐条判适用/不适用；空结果=信号，改写查询重试最多一次，仍无则明说没有；
- 精读纪律：同一轮最多 2 次 note_recall、每次读全文 ≤3 篇；顺链扩读（related/source 邻域）；
- 路由表从「四路分裂 + 手写决策树」收敛为 note_recall 默认首选 + 精确场景专用路由。

### 回归

- 测试 47 → 56（BM25 5 + 统一语料 5 + 连字符/CJK 4 + 缓存门控 4 + 链接 token 3 等）全绿；npm test exit 0。

## 2026-08 · 低危清单清理（handoff 序 4）

- **note_search 排除 .deepseek**：`listNotes` 增加 `extraExcludeDirs` 参数，note_search 传入 `['.deepseek']`——用户笔记语义与记忆树彻底分开（note_links/note_retrieve 不排除，前者需要记忆卡的反链、后者靠记忆卡检索）；工具描述、系统提示段与 AGENTS.md §5 同步。
- **归档同步 records source**：`archiveOldEpisodes` 移动 episode 后，除更新 episodes/index.md 外，现在扫描 `.deepseek/memory/records/*.md` 并把 `[[旧stub]]` 改写为 `[[archive/新stub]]`（有改动才写，best-effort）——溯源链跨归档不断。
- **端口占用提示**：`DshService.warnPortOccupied()` 一次性 Notice——端口有响应但本插件从未 spawn 过子进程时提示检查端口；`keepAliveOnUnload` 场景（重启后旧服务仍在）自动豁免，避免误报。
- **权限措辞**：README 中英与 cordis.patch.yml 注释改为准确描述——`DSH_PERMISSION_MODE=danger-full-access` 只重开交互式提权（approval: ask），沙箱仍是 workspace-write。

## 2026-08 · hook 趋势可视化（handoff 序 3）

- **历史记录**：`buildAuditReport` 在每日体检末尾调用 `writeHookHistory`——纯函数 `buildHookHistory`（导出，可测）按“同日更新原位、新日追加”把 `{date, uses, successRate}` 写入 `cache/hook-history.json`；每卡 30 点、全局 500 卡有界；只记带 block-style hook 的卡。
- **面板渲染**：`collectMemoryState` 读历史并挂到卡片条目；`cardRow` 有 ≥2 点历史时在 meta 行渲染近 5 点迷你趋势 `📈 4@0.8→6@0.9`（uses@成功率）。
- **回归**：第 14 节新增 4 断言（追加/新日追加/同日原位/容量上限），总数 38 → 42，全绿。

## 2026-08 · 捕获策略分级（控制面 1c）落地

### 背景

control-panel.md 阶段 1c（捕获策略分级）是控制面三阶段里的最后一个未做项：让用户按对象类型决定助手“写不写、要不要先问”。

### 设计

- **策略载体**：`vault/.deepseek/capture-policy.md`（frontmatter `idea/fact/preference: auto|ask|off`），用户维护，模型不得修改；默认档位（idea=ask、fact=auto、preference=auto）与既有行为完全一致，因此是纯增量、零迁移。
- **执行方式**：确定性表面化 + 模型执行——obsidian-memory 解析策略文件并把档位注入系统提示（与三写协议同一种执行哲学）；AGENTS.md §2 增“捕获档位”条款、§6 想法捕获改按 `idea` 档位执行、§7 目录树登记新文件。
- **配套**：模板随 Obsidian 插件 bootstrap、npm 安装器、deploy-local 三路安装（缺文件才创建，不覆盖用户修改）；记忆面板摘要行展示当前档位（如 `捕获 ask/auto/auto`）。

### 回归

- `scripts/test-memory.mjs` 新增第 13 节（默认档位 / 合法值解析 / 非法值回落默认 / 注入段 / 缺失提示语义），总数 33 → 38，全绿。

### 待办

- 面板内直接编辑策略文件 → 已随 handoff 序 2 落地（预览弹窗编辑 + 策略链接）。

## 2026-08 · 面板内编辑记忆（handoff 序 2）

- **预览弹窗编辑**：`MemoryPreviewModal` 新增「编辑」→ textarea +「保存/取消」；保存前做 mtime 冲突检查（打开时快照 vs 保存前 stat，不一致则拒绝覆盖并提示重新打开）；保存后回调刷新面板。适用于 records/templates/memos/episodes 卡与 capture-policy.md。
- **策略快捷入口**：面板摘要行下新增 `⚙️ 捕获 ask/auto/auto（点击编辑策略）` 链接，直接打开 `.deepseek/capture-policy.md` 的编辑弹窗。
- 样式：`.dsh-memory-preview-editor` / `.dsh-memory-policy-link`。UI 代码无法进零 token 回归，验证 = `--check` + 构建 + 部署 + 用户点击实测。

## 2026-08 · 推送前修复轮（feedback token 接线 / 缓存 schemaVersion / 皮肤 fallback 时序）

### 背景

上一轮全面评估在本机部署实测后给出三个必修项：feedback 链接断裂（CSRF 修复不完整）、dialogue-index 缓存语义失效、皮肤降级 fallback 时序错误。全部修复并回归：`npm test` 33/33 全绿（新增 7 项断言），安装器 e2e + 漂移检测通过。

### 改动

1. **feedback 链接 token 接线**：A 轮给 `/feedback` 加 CSRF token 时，注入给模型的链接模板没有同步带 `t=`——回复里的 `[✅ 这条对] [❌ 这条错]` 点击必 403，纠错闭环实际断开。`obsidian-memory.mjs` 读取 `DSH_OBSIDIAN_FEEDBACK_TOKEN`，把 `&t=<token>` 拼进 `/open` 与 `/feedback` 链接模板；`/open` 端点同步加 token 校验（此前任意网页 GET 即可触发 openLinkText，包括创建不存在的笔记——vault 污染面）；AGENTS.md §8 更新链接模板与“照抄完整模板，不得省略 t=”纪律。
2. **dialogue-index 缓存 schemaVersion**：0.4.0 的 vault 过滤修复对“旧代码写出的磁盘缓存”无效（指纹命中直接复用），跨工作区会话内容会继续注入。索引带 `schemaVersion: 2`，导出 `cacheIndexValid` 做版本门控，旧缓存一律重建；本机残留的 08-15 旧缓存（含编码工作区会话源）随部署清理。
3. **皮肤降级 fallback 时序**：fallback 块追加发生在 autoStart 的 `ensureObsidianPatch`（overwrite）之前，必被擦除。刷新现在提取并重放 fallback 块；两处 marker 收拢为共享常量 `SKIN_FALLBACK_START/END`。
4. **卸载清理**：全局 error/unhandledrejection 监听与 `Notice.prototype.setMessage` 补丁在 onunload 移除/恢复（补丁仅在仍属本插件时恢复，不覆盖他人补丁）。
5. **文档漂移修复**：design.md 标题回到 0.4.x，§2 各层预算与 §3/代码对齐（topics 1800 / records 800 / templates 600 / episodes 1200 / inbox 1200 字符）。

### 回归

- `scripts/test-memory.mjs` 新增第 11 节（缓存版本门控 4 断言）与第 12 节（链接模板 token 3 断言），总数 26 → 33，全绿；
- main.js 重建（207,592 bytes），嵌入内容验证通过；
- 教训入档：**给端点加防护时，必须同步更新所有渲染该端点的提示词模板**（见 handoff.md §4 新坑）。

## 2026-08 · A→F 全面修复轮（发布前最后一批）

- **A（必修 bug）**：`hook.uses` 双计（stats 合并后清零）；AGENTS.md weak 规则与 hook 纪律矛盾（success_rate 归插件）；主视图 activateView 补 null-leaf 兜底；/feedback 加 CSRF token（`DSH_OBSIDIAN_FEEDBACK_TOKEN`）；debug.log 1MB 轮转；stats 写入串行队列；安装器漂移检测（11 对文件内容比对）。
- **B（检索式注入落地）**：静态预算瘦身（topics 1800/records 800/templates 600/episodes 1200/inbox 1200 字符）+ 每轮按最近用户消息对卡片/备忘录/主题/事件做 IDF 加权召回 top-k（默认 6 条/2200 字符，mtime 指纹缓存）；`latestUserText` 从 `agent.session.log` 取最后一条真实用户消息。
- **C（dialogue 修复）**：只保留 cwd 在本 vault 内的会话；问答配对改为取轮次**最后一条** assistant 回复（`pairMessages` 可测）。
- **E（相关性提醒）**：提醒候选 = 陈旧 **或** relevance ≥ 0.15，排序 0.7×相关性 + 0.3×新鲜度。
- **D（增量缓存）**：note_search/note_links/note_retrieve 用 mtime+size 校验的原文缓存（`readNoteTextCached`），避免每次全库重读。
- **F（加固）**：皮肤 web profile 缺失时自动往 --patch overlay 追加禁用块；`cacheEntryFresh` 等纯函数进回归（**26/26 全绿**）。
- **交接**：新增 [handoff.md](handoff.md)。

## 2026-08 · 0.4.0 部署与调试收尾（本机 Obsidian 实测）

### 部署过程中的真实坑（全部已修复并留档）

1. **cpSync 原生崩溃**：本机 Node 24.14.1 上 `fs.cpSync`（递归目录拷贝）触发 0xC0000409（栈溢出），连 1 文件小目录都必崩，且会把托管进程一起带走（此前 dsh web 进程被杀的元凶）。规避：部署脚本改用「手动遍历 + copyFileSync」，禁止 cpSync。
2. **皮肤管理器全局 patch**：`$DSH_HOME/cordis.patch.yml` 把当前皮肤 insert 进所有 profile，obsidian profile 无皮肤包 → 启动崩。修复：插件启动时把 web profile 的 `@linxin666/*` 全部 junction 镜像进 obsidian profile（`syncGlobalPackageLinks`），并按用户偏好让皮肤直接生效——任何现有/未来皮肤都自动适配，零清单维护。
3. **readdirSync 未导入**（历史 bug）：`archiveOldEpisodes` 一直静默失败，>90 天事件归档从未生效；补导入修复。
4. **视图方法名冲突**：记忆面板的「打开笔记」方法曾命名 `open`，与 Obsidian 1.13.7 视图生命周期的 `view.open(containerEl)` 冲突——面板空白、onOpen 不执行、容器对象被送进 openLinkText 导致 `e.toLowerCase is not a function` toast（那 toast 还是自己 catch 弹的）。修复：改名 `openNote` + 类型守卫。教训：ItemView 子类不得定义 `open/close/load` 等方法名。
5. **隐藏目录进不了 Obsidian 索引**：vault 排除所有点号开头的路径段（已核对 1.13.7 源码），`.deepseek` 文件无法用 openLinkText/TFile 打开，点击会变成“创建文件”→ `Folder already exists`。方案：面板内预览 Modal（node fs 直读 + 复制/资源管理器/默认应用打开）。
6. **Obsidian 1.13.7 Notice 不走 setMessage**：构造函数直接 `createDiv({text})`，给 setMessage 打补丁无效——调试期改用 DOM MutationObserver + 文件日志（`debug.log`，维护者直读）才抓到第 4 条的真凶。

### 版本策略（用户约定）

- 本地调试用 0.4.1~0.4.6 小版本滚动；**对外发布（GitHub）统一为 0.4.0**，仓库 manifest/package 已复位为 0.4.0。

### 面板入口（最终形态）

- 设置页「打开记忆面板」按钮 + 命令面板命令；视图标签 brain 图标；无独立 ribbon 按钮；
- 点击卡片 = 预览弹窗（隐藏目录限制下的最优解）；✅/❌/过期/归档按钮 = 与回复内反馈链接同一套确定性写回。

## 2026-08 · 部署事故：皮肤管理器全局 patch 导致 obsidian profile 启动失败

### 现象与根因

- obsidian profile 启动报 `Cannot find package '@linxin666/dsh-client-ui-skin-blue-fantasy'`；
- 根因：web 皮肤管理器在 `$DSH_HOME/cordis.patch.yml`（全局层）里 insert 当前皮肤，**作用于所有 profile**，且该层应用在 profile 自己的 `cordis.patch.yml` 之后——所以在 `cordis.patch.yml` 写 disabled 无效（补丁匹配不到、warn-and-skip）；
- 唯一能盖过全局层的层是启动命令的 `--patch` 覆盖层（`profiles/obsidian/obsidian.patch.yml`，最后应用）；而该文件被 Obsidian 插件每次加载时强制刷新（bootstrap overwrite=true），机器本地手工加的行会被冲掉。

### 修复（最终版：皮肤适配而非禁用）

- **持久机制**：插件启动时把 web profile 的 `node_modules/@linxin666/*` 全部包用 junction 镜像到 obsidian profile（`syncGlobalPackageLinks`），任何当前/未来皮肤都能解析，该故障模式不再可能复发；
- **按用户偏好**：`obsidian.patch.yml` 不再禁用皮肤——obsidian 内嵌 web UI **直接应用**主 web 界面所选的皮肤，无需维护任何 id 清单；
- 验证：皮肤实际加载的备用端口启动测试 15 秒存活；`npm test` 全绿。

## 2026-08 · v2 控制面阶段 1b：Obsidian 记忆面板

### 改动

- **MemoryView ItemView**（`obsidian/main.template.js`，view 类型 `dsh-memory-panel`）：五层记忆浏览（画像存在性、records、templates、memos、episodes 最近 30 条）+ 体检报告展示；每张卡显示类型/算子/状态/验证徽标（✅/⚖️/❓）/uses/成功率/last_used/更新天数；搜索框按标题/算子/类型/主题过滤；逐卡操作按钮 ✅确认、❌错误、过期（superseded）、归档（移入 archive/records/，永不硬删），全部复用 1a 的确定性 frontmatter 手术；顶部「归档 >90 天事件」按钮。
- **入口**（按用户偏好调整）：设置页按钮「打开记忆面板」+ 命令「打开 DSH 记忆面板」；视图标签用 brain 图标，不占用独立 ribbon 按钮。
- **修复既有隐藏 bug**：`readdirSync` 未从 `node:fs` 导入，导致 `archiveOldEpisodes` 的目录扫描抛 ReferenceError 被 try/catch 吞掉——**事件归档（>90 天）实际上从未生效过**，一直静默返回 moved: 0。本次补上导入，归档与记忆面板扫描同时恢复。
- **测试**：stub-Obsidian 集成验证新增 13 项断言（frontmatter/hook 解析、title 提取、collectMemoryState 五层收集与过滤、面板内 wrong 反馈改写），全部通过；`npm test` 全绿。

### 设计要点

- 面板只做**读 + 确定性写**：读走 `collectMemoryState`（node fs 直读 vault），写走 1a 的 `applyFeedback`/归档，不经模型、不经 dsh；
- 面板的 ✅/❌ 与回复内的反馈链接是**同一套函数**，两个入口行为一致；
- 体检报告（memory-audit.json）直接在面板可见——“记忆哪里需要打理”从此有可视入口。

## 2026-08 · v2 控制面阶段 1a：验证徽标 + 反馈链接

### 背景

control-panel.md 定稿后评估了三种注入方案（dsh 客户端自挂列 / Obsidian 侧视图 + loopback 反馈 / 混合），选定混合方案 C：先用 loopback 反馈链接拿到纠错闭环，记忆视图留到阶段 1b。

### 改动

- **`/feedback` 端点**（`obsidian/main.template.js` LinkServer）：`confirm`（verified→user-confirmed、success_rate 提到 ≥0.9）/ `wrong`（success_rate 减半，≥0.05）/ `stale`（status→superseded）/ `forget`（移入 `.deepseek/archive/records/`，永不硬删）；确定性 frontmatter 行手术（setHookField/setTopField），安全约束：仅 vault 相对路径、必须在 `.deepseek/` 下、解析后必须落在 vault 内（win32 大小写不敏感）、action 白名单、只绑 127.0.0.1。
- **徽标与反馈链接渲染规则**：`obsidian-memory.mjs` 的链接指令新增验证徽标（✅/⚖️/❓）与末尾反馈链接模板；AGENTS.md §8 同步纪律（不要自行改 verified/success_rate/status，不为凑反馈引用未用到的卡）。
- **测试**：对构建产物 main.js 做 stub-Obsidian 集成验证（confirm/wrong/stale 改写、路径包含判断、归档移动），全部通过。

### 设计要点

- 反馈是**验证等级升级的唯一确定性通道**（模型无权自升 verified）；
- `wrong` 直接喂给次日体检的 weak 检测（Demote 信号源），形成闭环；
- 阶段 1b（Obsidian ItemView 记忆视图）与阶段 2（dsh 客户端列，待官方右侧槽位）见 control-panel.md。

## 2026-08 · v2 第一批落地：hook 检索 + 记忆体检

### 背景

两轮系统评估（见 assessment.md）确认三大瓶颈：全量注入、模型自律写回、零透明控制面。结合 Dual RAG（EMNLP 2025 Findings 1162）与 ISM（arXiv:2606.31191）两篇论文，把 P0 改造从方向升级为规格。

### 改动

- **新增 `note_retrieve` 工具**（`dsh/preset/obsidian-notes.mjs`）：解析记忆卡 `hook:` frontmatter，执行 ISM 式两级检索——算子硬过滤 + 加权软打分（lexical 0.55 / structure 0.15 / heuristics 0.15 / quantity 0.05 / prior 0.10），prior 项含 success_rate 与 uses；无 hook 卡片时退化为全库 token 加权匹配。
- **hook 字段正反馈**：note_retrieve 命中时插件直接更新该卡 `hook.uses` / `hook.last_used`（确定性写回，不走模型）。
- **新增记忆体检（audit pass）**（`dsh/preset/obsidian-memory.mjs`）：确定性扫描 records/templates/inbox 的 frontmatter 与 hook，产出 `cache/memory-audit.json`，每 vault 每天最多重扫一次；报告随系统提示注入（≤1200 字符），列出 unused / weak / duplicate candidates / strong / unverified 清单。
- **协议同步**：AGENTS.md 新增 note_retrieve 纪律、hook 字段维护规则、体检报告行动规则（merge/reinforce/demote 的模型执行版）；records/templates README 模板加 hook 块与 verified 等级说明。
- **零 token 回归检查**：新增 `scripts/test-memory.mjs`（17 项断言：hook 解析 / 分词 / 打分排序 / 体检五类分类 / hook 统计回写语义），接入 `npm test`；`obsidian-memory.mjs` 补入 `--check` 链。
- **文档基建**：新建 `docs/memory/` 知识库（README / design / assessment / v2-proposal / references / changelog）。

### 未做（明确留待后续）

- embedding 后端（当前 lexical 加权；接口已预留替换点）；
- 记忆控制面板与反馈按钮（依赖 Web GUI 面板能力）；
- 记忆 benchmark：**明确不做 token 消耗型基准**（无现成对口基准、烧 token、标注成本高），改为零 token 回归检查 + 被动信号 + 未来一次性手动探针（决策见 v2-proposal §6）；
- dialogue index 的 vault 过滤与“最后一条 assistant 回复”配对质量改进。

### 影响与兼容性

- 对既有安装：obsidian-notes.mjs / obsidian-memory.mjs 随升级刷新（agent.cordis.yml 保留用户编辑的机制不变），工具自动出现；
- 对既有记忆数据：hook 块为可选字段，旧记录卡无 hook 时 note_retrieve 走 fallback，体检报告给出“建议补 hook”提示；
- 安全边界不变：新工具同样走 ctx.fs 沙箱，插件唯一新增写文件是 `cache/memory-audit.json` 与 hook 字段的 uses 更新。