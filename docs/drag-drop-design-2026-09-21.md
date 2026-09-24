# 实现规格（2026-09-21）：从 Obsidian 文件树拖一篇笔记到 dsh 对话框，变成一次引用

> **状态：✅ 已实现并验证（2026-09-21）。** 落地记录见 §6；未做与未知见 §5。
> **性质**：用户要求的**具体功能**（不是评估）：在 Obsidian 里把左侧文件树的条目拖进右侧栏的 dsh 输入框，草稿里出现对该笔记的引用，然后正常发送。
> **前序**：`docs/design-intake-2026-09-21.md`（问题评估）+ §1.1.1（两个前提的实测）。

## 0. 结论与最短路径

```
Obsidian 文件树 --拖拽--> dsh 侧栏 iframe 的 document
    drop 事件 → 从 dataTransfer 取 text/plain
      → 解析 obsidian://open?vault=<库>&file=<库内路径>
        → 在 composer 上派发一次合成 paste（文本 = "@<库内路径> "）
          → composer 自己的 paste 处理器把它插到光标处
```

**四个前提全部已实测**（不是推断）：

| # | 前提 | 证据 |
|---|---|---|
| 1 | 拖拽载荷是 `obsidian://open?vault=…&file=<URL 编码库内路径>`，`text/plain` 与 `text/uri-list` 同值 | `scripts/qa/drag-payload-probe.mjs`（CDP `Input.setInterceptDrags` 拦真值） |
| 2 | **跨源 iframe 内的 `drop` 监听能收到事件并读到 `dataTransfer`** ⇒ 不需要透明遮罩 | `scripts/qa/iframe-drop-probe.mjs`（三端口真跨源夹具，4/4） |
| 3 | dsh 的输入框是 **Lexical `contenteditable`**（不是 textarea），且 `document` **冒泡阶段**收得到 drop（dsh 不吞、不 stopPropagation） | `scripts/qa/composer-drop-probe.mjs` |
| 4 | **composer 自己处理 `paste`**（读 `clipboardData.getData("text/plain")` → `pasteText`）⇒ 一次合成 `ClipboardEvent('paste')` 就能把文本插到光标处 | `composer-drop-probe.mjs` 实测 `after="@拖拽探针笔记.md "`；源码 `dsh-client-ui-conversation/lib/client.js:15259-15273` |

## 1. 为什么用「合成 paste」而不是会话 API

dsh 为程序化写草稿提供了 `SessionInput.setDraft(text)`
（`dsh-client-ui-conversation/lib/types/client/contract/input.d.ts:172-176`，注释原文
"persisted-draft seed and **programmatic writes**"）。它**更正式**，但本仓库用不了，原因具体：

1. `ctx.conversation.input.for(actx)` 要**会话作用域的 ctx**；`shell(sessionId)` 要**会话 id**
   （`lib/types/client/input/hub.d.ts:31,47`）。插件在客户端根上下文里，**没有**"当前是哪个会话"的
   公开读法 —— 要去猜内部状态，正是这个仓库反复吃过的亏（坑 64：按名字/按猜测配对）。
2. `setDraft` **整体替换草稿**。用户的诉求是"拖进来变成引用"，而草稿里往往已经有半句话；
   替换会把它删掉（或需要我们自己读回草稿再拼，又落回问题 1）。
3. `drop` 事件自带**元素与坐标**，而 composer 自己就是 paste 的消费者 ⇒ 让 dsh 已有的处理器
   决定"插到哪儿"，我们只负责把文本递过去。**改动面最小，且不复制宿主的编辑逻辑。**

代价与边界（写清楚，免得后来者以为它是万能的）：
- 依赖的是**宿主已注册的 paste 处理器**，不是公开契约。若 dsh 改掉 paste 路径，本功能会静默失效
  ⇒ 所以有一条**端到端探针**（真拖拽 → 断言草稿里出现 `@路径`）钉住它，而不是只测我们自己的代码。
- 合成事件不携带"用户意图"，若将来有人在 composer 上加了 paste 拦截（比如自动剥格式），
  我们的文本会跟着走那条路 —— 这是**期望**行为（与粘贴一致），但要知道。

## 2. 落点与模块划分

| 文件 | 职责 | 为什么在这里 |
|---|---|---|
| `dsh/client-panel/src/drop-mention/parse.drop.mjs` | **纯**解析：从 `dataTransfer` 取值 → 得库内路径（或 null） | 纯函数 = 可回归、可变异验证，且**不需要浏览器** |
| `dsh/client-panel/src/drop-mention/composer-drop.mjs` | DOM 接线：`dragover`/`drop` → 合成 paste；返回 disposer | 只碰 `document`，可注入假 document 测 |
| `dsh/client-panel/src/index.jsx` | `apply()` 里安装它（一次性） | 复用现有 client 插件的装配点 |
| `scripts/test-drop-mention.mjs` | 纯解析 + 接线的**载荷**回归 | 零 token、无浏览器、进 `npm test` |
| `scripts/qa/composer-drop-probe.mjs` | **端到端**：真拖拽 → 草稿出现 `@路径` | 按需探针，钉住"宿主 paste 契约没变" |

**为什么解析器单独一个文件**：拖拽载荷是**宿主格式**（Obsidian 的 `obsidian://`），最可能变。
把它做成纯函数，就能在它变的时候**当场看到**红，而不是等用户报"拖进去没反应"。

## 3. 行为规格（逐条可测）

### 3.1 解析（`parse.drop.mjs`）

- 输入：`dataTransfer.getData('text/plain')`。
- 认得出**一条** `obsidian://open?vault=<库名>&file=<URL 编码路径>`，返回解码后的库内路径。
- **保守拒绝**（返回 `null`），任何一条命中就不认：
  | 条件 | 为什么 |
  |---|---|
  | 不是 `obsidian://open` | 别的 scheme/动作不是"拖一篇笔记" |
  | `file` 为空 | 没有目标文件 |
  | 路径是绝对路径（`/x`、`C:\x`、`\\server\x`） | 装进 `@` 只会让模型去读库外路径（`@` 接受绝对路径！） |
  | 含 `..` 段或**反斜杠** | 同上：越界与分隔符歧义 |
  | 含 NUL 或控制字符 | 不能安全放进提示词文本 |
  | 路径超过 2000 字符 | 与 `/open`、`/feedback` 的既有上限一致 |
  | 多个候选（多行/多 URL，例如多选拖拽） | **只做单篇**，多选不猜（写清理由，见 §5） |
- **文件名本身含空格/`&`/`#`/中文全角括号都能解析**：只按"最后一个 `&file=`"取，参数必须
  是**最后一个**（`file` 的值里可能含 `&`，因为它是 URL 编码过的；只有 `file=` 之前的参数才
  可能出现未编码的 `&`）。⚠️ 实现与测试都要覆盖这条 —— 这是最容易写错的地方。

### 3.2 接线（`composer-drop.mjs`）

- 在 `document` 上挂 `dragover` 与 `drop`（**冒泡阶段**；实测 dsh 不吞）。
- `dragover`：只有当 `types` 里**没有** `Files`、且**有** `text/plain` 时才 `preventDefault()`
  ⇒ 真文件拖拽仍归 dsh 自己的附件通道（`dsh-client-ui-attachment` 只认 `Files`）。
- `drop`：解析成功才拦截（`preventDefault` + `stopPropagation`），失败**放行**（让宿主自己处理）。
- 落点选择：从 `event.target` 往上找 `[contenteditable="true"]`；找不到就用页面上唯一的那个
  composer（`document.querySelector`）。两者都没有 ⇒ 什么都不做（不抛）。
- **反馈**：拖动期间在页面上加一个可放置提示（`document.documentElement` 上的一个标记类 / 一个小
  提示条），`dragend`/`drop` 时移除。**必须能自愈**（坑 55 的同族：挂起/漏事件不能留下永久覆盖层）。
- 安装是**幂等**的：`window.__dshMathMemoryDropMention` 打标；返回 disposer。

### 3.3 阻止什么

- 不做"拖文件夹"（探针未测出文件夹载荷形态，见 §5）。
- 不做"拖编辑器里选中的文字"（同上）。
- 不新增任何网络请求、不改 `LinkServer`、不改 preset。
- 不碰 `/open`（那是回复里链接的通道，两件事）。

## 4. 验证计划

| 层 | 命令 | 覆盖什么 |
|---|---|---|
| 纯解析 | `node scripts/test-drop-mention.mjs` | 载荷的**形状**：正常/空格/中文/`&`/绝对路径/`..`/反斜杠/控制字符/多候选/非 obsidian/缺 `file` |
| 接线 | 同上（假 document） | `dragover` 只在"非文件 + 有 text/plain"时 preventDefault；`drop` 成功才拦、失败放行；落点解析；disposer 真的摘掉监听；安装幂等 |
| 端到端（按需） | `node scripts/qa/composer-drop-probe.mjs` | **真拖拽**（CDP `Input.dispatchDragEvent`，真实 MIME + 真实载荷）→ 草稿里出现 `@库内路径` |
| 变异验证 | 手工 | 把解析器的某个拒绝条件去掉、把 `drop` 的放行改掉、把安装去掉 ⇒ 对应断言必须红 |

**客户端半个的安装（已修，2026-09-21）——过程中真的把用户的侧栏搞挂过两次**：

本功能在 **dsh web 客户端半个插件**里，而侧栏跑的 `notes-assistant` profile 原先**只装了宿主半个**
（`notes-assistant.patch.yml` 插 `./math-memory-panel.mjs`），客户端半个
（`@dsh-math-memory/client-ui-memory-panel` + `lib/client.js`）只装在 `web` profile
⇒ 侧栏里根本不会加载它。把这一步固化进安装路径时，连撞两个 **cordis 硬失败**（都是整个 profile
起不来，用户看到的是「dsh 服务未能在端口 3180 上启动」）：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `duplicate loader entry id: math-memory-panel` | 插入行 id 用了 `math-memory-panel`，而 `notes-assistant.patch.yml` 里**已经**有一个同 id 的宿主半个 —— 两个 patch 层各插一个同 id | 插入 id 改为 `math-memory-client-panel`；安装**前**先扫该 profile 的全部 `*.yml` 查 id 冲突，冲突就中止且**不写任何文件**；门禁 `check-patch-yaml` 断言该 id 不与任何已发布行 id 冲突 |
| 2 | `webserver: duplicate prefix route "/memory-panel"` | 包的 `index.mjs` 直接用了 `host/math-memory-panel.mjs`（**就是注册路由的那个模块**），而 profile 里已有独立宿主半个 ⇒ 两个条目注册同一前缀 | **profile 已有独立宿主半个时，本包的宿主半写成空实现**（`export const name`; `export function apply() {}`），只交付客户端半个；没有独立宿主半个的 profile（如 `web`）才用仓库里那份真宿主 `host/index.mjs` |

**教训（值得单独记）**：这两个都是"**往别人的 profile 目录里插条目**"这类改动的固有风险 ——
`id` 与**路由前缀**是**跨文件、跨 patch 层**共享的命名空间，而当时**没有任何东西**在写之前检查。
现在检查点在**安装时**（`install-into-profile.mjs` 的 `findIdOwners`）与**门禁里**（`check-patch-yaml`）
各有一份，且都在**写之前**。另一条：**"文件里多了几行"与"整个应用起不来"之间只隔一个命名冲突**，
所以这类改动必须**真的启动一次**才算验证过 —— `test-installer.mjs` 因此补了"安装后 row id 唯一"的断言。

端到端探针还有一条**直接判据**：`drop-to-mention-e2e.mjs` 在页面里先查
`window.__dshMathMemoryDropMention` 是否**已被 profile 自己装上**（10/10 通过）——
只测"注入之后能用"是不够的，那证明不了用户那边会加载。

## 5. 刻意不做 / 未知

- **多选拖拽**：Obsidian 多选拖出的载荷形态**未实测**。若它也是单个 URI（只带一个文件），我们
  静默只引用那一个；若是多行，按 §3.1 拒绝。**不猜**——猜错的代价是用户以为拖了三篇、实际只引了一篇。
- **文件夹**：`drag-payload-probe.mjs` 没跑出文件夹的载荷（需要先展开 + 真实鼠标动作）。
  实现时若 `file=` 指向的是文件夹，`@文件夹/` 是**合法**的 mention 语法（`formatFileMention`
  对 directory 保留尾部斜杠），但我们不特殊处理 —— 等载荷实测过再说。
- **编辑器选中文字**：同上未测。那是另一条通道（应该是 `text/plain` = 选中的原文），
  行为上"拖一段话进来"与"拖一篇笔记进来"语义不同，**要分开设计**，不在本轮。
- **拖到侧栏以外**（比如把笔记拖到 dsh 页面但不在输入框上）：本轮**接受**并插到 composer
  （drop 目标是 composer 时最自然；目标是页面空白时也插，因为用户的意图明确是"给 dsh"）。
  若实测发现误触多，再收紧为"只接受 composer 内的 drop"。

## 6. 落地记录

**实现**：
- `dsh/client-panel/src/drop-mention/parse.drop.mjs` —— 纯解析（`parseObsidianDragText` / `formatMention` / `mentionFromDataTransfer`）。
- `dsh/client-panel/src/drop-mention/composer-drop.mjs` —— DOM 接线（`installComposerDropMention`），幂等、可清理、带拖动提示。
- `dsh/client-panel/src/index.jsx` —— `apply()` 里显式传 `{document, window}` 安装，并**再导出**安装器（回归与装配共用同一实现）。
- `dsh/client-panel/lib/client.js` 重建（产物，进 `check-client-bundle` 门禁）。

**验证（说清覆盖范围）**：
- `scripts/test-drop-mention.mjs`（新门禁 `test: drop-to-mention`，**47 项**）：**用宿主的 ModuleLoader 协议求值真产物**再驱动真处理器 —— 正常载荷、空格/中文/`&`/`#`/全角括号、`file=` 取最后一个参数、14 条拒绝载荷、`Files` 放行、`dragover` 的三种分支、落点回退、提示自愈、清理与幂等。
  **变异验证两次**：去掉 `//` 空段拒绝 → 该项红；去掉 `drop` 的 `preventDefault` → "事件被拦截"红。
- `scripts/qa/drop-to-mention-e2e.mjs`（按需，**9/9**）：起独立 dsh + headless 浏览器，用 CDP `Input.dispatchDragEvent` 投递**与实测一致的载荷** → 断言输入框草稿里出现 `@库内路径`；不认识的载荷不追加垃圾；提示自愈。它跑的是**从产物里按 AST 切出的实现**（`scripts/lib/extract-bundle-function.mjs`）。
- `scripts/qa/composer-drop-probe.mjs`（按需，7/7）：量到输入框是 Lexical `contenteditable`、`document` 冒泡阶段收得到 drop、合成 paste 能落进草稿。

**踩过的坑（都写进代码注释了，因为每一条都会让"验证"变成假绿）**：
1. **按配平括号自己切产物**会被压缩后正则字符类里的 `"]` 骗过（`[\u0000-\u001f\u007f-\u009f"]`），配平失衡。改用 **acorn 解析 + 按节点范围切片**。
2. **按"标记名字符串"找安装器永远找不到**：`"__dshMathMemoryDropMention"` 在产物里只出现一次（`var j="…"` 的初始化值），安装器体内用的是**变量名**（`s[j]`）。改为按**导出表**（`installComposerDropMention: () => N`）定位。
3. **正则扫"引用名"会把字符串里的 `\u0000` 转义当成名字 `u`**，于是去外面找 `let u = await fetch(…)` 并把它当声明抽出来 —— 报错是 `missing ) after argument list`，离真因极远。改为由 **AST 收集 `Identifier`**，并排除属性名/键/参数/局部声明。
4. **探针自己的假 DOM 三次骗了自己**：`createElement` 每次给新元素 ⇒ paste 派发到了没人观察的节点；`DataTransfer` 替身缺 `getData` ⇒ 断言读到"方法不存在"；断言看的是**外层数组**而实现递的是**事件**。三次的症状都是"产品没工作"，而产品一直是对的。
