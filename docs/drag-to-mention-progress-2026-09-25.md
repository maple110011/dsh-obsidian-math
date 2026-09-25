# 拖拽引用（Obsidian 文件树 → dsh 输入框）：进展与接续

> **状态（2026-09-21/25）**：**未完成**。已定位并修好一个真实缺陷（客户端半个从未被加载）；
> 另有一环**已复现但未判定**（页面收到了投递，草稿却仍为空）。本文是接续入口，写清"已经证实的事实、
> 还没证实的东西、以及下一步该量什么"。
>
> ⚠️ **用户更正（重要）**：**"拖拽进不去"在 dsh 升级到 0.1.7-rc.2 之前就已经存在**。所以这不是升级
> 引入的回归，不要把两者混为一谈。（本文 §3 记的 preset 不兼容是**另一件**独立的事，它会让会话
> 完全起不来，但**不是**拖拽失效的原因。）

## 1. 用户诉求（原话）

> 「我就是希望能够从 Obsidian 左侧的文件夹中拖拽文件到 dsh 对话框里」

链路：文件树拖一篇笔记 → 落点在 **Obsidian 那侧**（跨源 iframe 收不到拖拽，见 `docs/drag-drop-design-2026-09-21.md` §6）
→ 解析出库内路径 → 送进 dsh 页面 → 在 composer 上派发一次**合成 `paste`** → 宿主自己的 paste
处理器插到光标处，草稿里出现 `@库内路径 `。

两条投递通道（都在设计里）：
1. **直插**：`<webview>.executeJavaScript` 调页面里的 `window.__dshMentionInsert`。
2. **推送（兜底）**：`POST /mention` → SSE `/mention-stream` → 页面 `EventSource` → 同一个落笔函数。

## 2. 已修好并**实测证实**的缺陷：客户端半个从未被加载

**症状**（用户实测 + 插件 `debug.log`）：

```
[drop] 收到拖拽，解析结果="抄书/最优传输/最优传输2"
[drop] 直插=false
[drop] /mention 响应 204（抄书/最优传输/最优传输2）      ← 连续 5 次，全部如此
```

**两个独立成因**：

1. `直插=false` 是**正确行为**：`insertMentionIntoFrame` 调 `frame.executeJavaScript`，那是 Electron
   `<webview>` 的方法，而侧栏里是**跨源 `<iframe>`**，没有它 ⇒ 按设计返回 `false`。
2. **兜底通道没有接收方**：记忆面板的**客户端半个**（它才 `window.__dshMentionInsert` + 订阅 SSE）
   **只躺在 `node_modules` 里，没有任何 loader 行挂载它** ⇒ `pushMention` 每次落进空队列后被挤掉。
   **204 是真的、送达是假的。**

**根因**：安装器把 loader 行写进 `profiles/<profile>/cordis.patch.yml`，而

- 启动命令是 `dsh --profile notes-assistant --patch …/notes-assistant.patch.yml` ⇒ `cordis.patch.yml` **不在启动路径上**；
- 插件的 `buildNotesAssistantPatch` 在**每次启动服务时**都用内嵌副本重写 `notes-assistant.patch.yml` ⇒ 就算写在那里也会被覆盖。

**修法**（提交 `981f9b8`、`429b061`）：把那一行写进**唯一权威源** `dsh/profile/notes-assistant.patch.yml`
（由 build 内嵌进 `main.js`，每次启动重写时自然带上）；安装器只做"**装包 + 校验行在**"，
并按"**恰好出现一次**"设门禁（零次＝静默失效，两次＝`duplicate loader entry id` 整个 profile 起不来）。

**实测证据**（这是"修好了"的依据，不是推断）：

| 量 | 修前 | 修后 |
|---|---|---|
| `http://127.0.0.1:3180/` 的 HTML 里 `memory-panel` 出现次数 | **0** | 5 |
| 插件清单里是否有 `@dsh-math-memory/client-ui-memory-panel` | 无 | `/plugins/??@dsh-math-memory/client-ui-memory-panel/client.js` |
| 实例能否干净启动（无重复 id / 重复路由） | — | 能 |
| 该 bundle 里是否有 `__dshMentionInsert` / `mention-stream` | — | 都有 |

## 3. 已复现、**尚未判定**的那一环（下一步就从这里开始）

在**真实的** Obsidian 侧栏实例（127.0.0.1:3180，经插件反代）上逐层实测，四个事实同时成立：

| # | 事实 | 怎么量的 |
|---|---|---|
| 1 | `window.__dshMentionInsert` **存在**，**直调就能落笔**（草稿 `"前半句@探针/直调落笔.md "`） | `scripts/qa/mention-insert-live-probe.mjs`（7/7） |
| 2 | 页面**订阅成功**：EventSource 指向 `http://127.0.0.1:39217/mention-stream?t=…`，`errors:0` | `scripts/qa/mention-stream-delivery-probe.mjs` |
| 3 | 服务端推一条，**页面 message 事件确实收到** `"抄书/最优传输/最优传输3"` | 同上 |
| 4 | **可草稿仍然是空的** | 同上（6/7） |

把 1–4 放在一起，只留下一个可能：**消息处理器那一行没走到落笔、或走到了但没落笔**。
用 `mention-handler-probe.mjs` 把 `__dshMentionInsert` 包起来量"每次调用及其返回值"，
得到的是 **`calls=0`（一次都没被调用）**。

**注意一个观察上的陷阱**：当时线上跑的是**旧客户端包**（HEAD 版，没有自述诊断），
所以"没有诊断上报"这件事**不能**用来判断处理器有没有被调用 —— 见 `docs/handoff.md` §4 陷阱 91。
判定"处理器有没有调用落笔"最直接的办法是**看落笔函数自己的记录**，而我已经把它做进产品了（§4）。

### 用来自证的四个分层探针

| 探针 | 量什么 | 最近结果 |
|---|---|---|
| `composer-selector-probe.mjs` | 真页面里 `[contenteditable="true"]` 有几个、第一个是不是 composer | 唯一，`div.uV2eYG_input`，role=textbox，lexical（所以"取错元素"这个猜想被否掉） |
| `mention-insert-probe.mjs` | 真页面里直接调产物的 `describeMentionInsert` | `step:dispatched`，草稿出现 `@路径`（12/12） |
| `mention-insert-live-probe.mjs` | 只读地看真实页面的 `__dshMentionInsert` 并调它一次 | 7/7（不改产品代码，结论即现场） |
| `mention-stream-delivery-probe.mjs` | 页面到底收没收到 SSE 消息 | 收到、`errors:0`，草稿为空（6/7） |
| `mention-handler-probe.mjs` | 处理器到底调没调落笔入口 | `calls=0`（但当时跑的是旧包，见上） |
| `mention-pipe-probe.mjs` | 自建"插件那一侧"（桩 LinkServer + 注入 meta），把 POST→SSE→订阅者→落笔**整条链**串起来 | **未跑通**：投递到达页面、落笔入口零调用 |

> `mention-pipe-probe.mjs --via=inject` 目前的结论：`message` 到达页面、客户端的 message 监听器
> **跑了 1 次**（`listenerCalls:1`）、**监听器没抛错**、上报通道**单独验证可用**（手动 POST 桩能收到）
> —— 但落笔入口 **0 次调用**、草稿为空。**这组事实自相矛盾**，所以它多半仍是夹具问题
> （见 §6 的夹具坑），**不要**据此改产品。

## 4. 已经做进产品的自述诊断（下一次拖拽就能拿到答案）

提交 `9790420`。`insertMentionText` 的契约是布尔（`true`/`false`），**没有"为什么"** —— 所以
现场"拖进去没反应"时日志里一个字节都没有。现在：

- **`describeMentionInsert(rel)`**：把落笔拆成可观察的步骤，返回
  `{ step, ok, editable, target, textLen, error }`。
  - `step`：`start` / `no-global` / `no-text` / `query` / `no-element` / `dispatched` / `dispatch-threw`
  - `editable`：页面上 `[contenteditable="true"]` 的**个数**（落笔取第一个）
  - `target`：命中的元素（tag + 前两个 class）
- **`reportMentionDiagnostic()`**：`fetch(..., { mode:'no-cors' })` 把诊断发回 Obsidian 那侧
  （跨源写、不需要读响应）。**每一次落笔都上报**（成功与失败都报）。
- **`LinkServer` 新增 `/mention-report`**：只用查询参数、白名单字段、逐值截断（页面可控输入，
  不能往日志里灌任意内容）。地址由 `mentionChannelMeta` 作为第二个 meta 注入。
- **服务端两条永久留痕**：`/mention-stream` 连接时记**订阅者数量**；`/mention` 收到时**先记订阅者数量再推送**。
  （"推给了 0 个订阅者"与"推了但没落笔"此前在日志里长得一模一样。）

**下一次拖拽后，`<vault>/.obsidian/plugins/dsh-math-assistant/debug.log` 里会出现**：

```
[drop] /mention-stream 已连接（当前订阅者 N）
[drop] /mention 收到（订阅者 N）：抄书/最优传输/最优传输3
[drop] 落笔诊断 via=stream step=dispatched ok=true hadDocument=true hadWindow=true textLen=… editable=1 target=div.uV2eYG_input error=
```

- **有"落笔诊断"行** ⇒ 处理器调用了落笔，看 `step`：
  - `dispatched` 且草稿仍为空 ⇒ **paste 被宿主忽略**（多半是没有插入点/焦点）⇒ 换落笔策略；
  - `no-element` / `editable=0` ⇒ composer 当时不在页面上（例如停在选择工作区页）；
  - `no-text` ⇒ 路径被拒（解析问题）。
- **没有"落笔诊断"行**，但 `/mention 收到（订阅者 ≥1）` ⇒ **处理器没走到落笔** ⇒ 查
  `installMentionInbox` 的 `message` 监听是否真的挂上了（`parseMentionSseLine` 的返回值）。
- **`订阅者 0`** ⇒ 页面没在听 ⇒ 查 meta 注入与 EventSource 是否建立。

## 5. 两条通道的现实结论

- **直插通道**在侧栏里**结构性不可用**（跨源 iframe 没有 `executeJavaScript`）。日志里的
  `直插=false` 是正确行为，**不要**去"修"它。要保住这条路，得让 Obsidian 用 `<webview>` 而不是
  `<iframe>`（那是插件视图层的改动）。
- **推送通道**是让侧栏可用的那条。服务端实测健康：带 `Origin: http://127.0.0.1:53191` 请求
  `/mention-stream` → 200 + 正确 CORS；伪造成 `app://obsidian.md` → 403（守卫有效）；
  POST `/mention` → 204，订阅者实测收得到 `data: "路径"`。

## 6. 夹具坑（每一条都表现为"产品像坏了"，实际是夹具缺件）

1. **改写正文的反代必须禁掉上游压缩**。带着 `accept-encoding` 转发 ⇒ 上游 gzip ⇒ 我们解压后用
   纯文本改写正文、却仍带 `content-encoding: gzip` 发出去 ⇒ 浏览器 gunzip 纯文本失败，页面
   **永远停在 `loading`**（`readyState:"loading"`、`document.body === null`）。
   用 curl/node 自测**看不到**，因为不会带这个头。同族：`docs/handoff.md` §4 陷阱 52。
2. **反代必须代理 WebSocket `upgrade`**。不代理时页面停在「重新连接中… / 选择工作区」，
   输入框根本不出现。
3. **反代要兑换启动 token 拿 cookie**，否则上游给未授权空壳。
4. **夹具要用唯一 vault 名**：dsh 的工作区选择器按目录名显示，多个探针都叫 `vault` 就没法
   确定性点中。
5. **`Page.addScriptToEvaluateOnNewDocument` 跑在"文档还没有节点"时**：那时 `document.head` 是
   `null`，直接 `appendChild` 会落到别处。要用 `MutationObserver` 等 `<head>` 出现。
6. **`--patch` 必须紧跟 `--profile`**（它是**启动器**旗标）；放到 `--port` 之后会被透传给应用，
   报 `error: unknown option '--patch'`，看起来像"dsh 不支持 --patch"。
7. **假的 DOM 缺件会造成假红**：落笔路径用 `querySelectorAll` 数可编辑元素，假 DOM 只有
   `querySelector` 时它走 `query-threw` 分支 ⇒ `test-drop-mention.mjs` 报红两条。已补。

## 7. 探针会**改动持久状态**（已犯错，务必遵守）

`dsh/profile/math-memory-workspace.mjs` 会把 `DSH_WORKSPACE_ROOT` 登记进
`$DSH_HOME/storages/workspace.json`，而**所有** QA 探针都用 `mkdtemp` 的临时 vault 起 dsh
⇒ **每跑一次探针，用户侧栏的「工作区」列表里就多一条垃圾项**。本次累计塞进 **38 条**，
已用 `scripts/qa/clean-probe-workspaces.mjs` 全部摘除（只删 `%TEMP%` 下的登记、先写 `.bak`、默认 dry-run）。

**规矩**：跑任何起 dsh 的探针之前，先想清楚它会不会写用户的持久状态；会写就**用完立刻清**，
并把清理做成脚本而不是手改。`test-agent-preset.mjs` 早就有这条纪律（固定探针路径 + 用完摘登记），
新探针必须照做。

## 8. 与 0.1.7 适配的关系（**另一件事**，留给新会话）

用户机器上的 dsh 在 2026-09-25 10:28 升到 **`0.1.7-rc.2`**，它**不再读** `$DSH_HOME/.agent-presets/<id>/`
（内置技能 `editing-cordis-compositions` 原文：*"Nothing reads that directory any more."*）。
preset 改为 `@deepseek-ai/dsh-agent-preset` 的**插件行声明**（`presets/<id>.patch.yml`）。
实测报错：

```
agent-preset/not-found: Unknown agent preset: notes-assistant
details.available = ["standard","ptc","minimal","cordis"]
```

**注意**：这会让**会话完全起不来**（连 composer 都不会出现），所以它**会掩盖**拖拽问题 ——
但它**不是**拖拽失效的原因（用户已更正：拖拽在升级前就坏）。

判据：`node scripts/run-gates.mjs --only 'agent preset mounts'` 红，且在**纯净 HEAD** 上一样红
⇒ 环境结果，不是本仓回归。按 `AGENTS.md` §4 的纪律：**不要**改断言或改文档去"修"它。

## 9. 下一步（建议顺序）

1. 起一台真实实例（或让用户重启 Obsidian），**拖一次**，把 `debug.log` 里 §4 那三行拿来
   ⇒ 判定"处理器是否调用落笔 / paste 是否被宿主接受"。这是唯一还缺的事实。
2. 若判定为"paste 被忽略"：把落笔策略从"合成 paste"换成对宿主更硬的方式，并**保留现值探测**
   （插入后读一次 composer 文本；没变化就走备选），备选要能用端到端探针钉住。
3. 清理夹具（`mention-pipe-probe.mjs` 目前自相矛盾，先别信它的结论；`--via=proxy` 那条路
   卡在"工作区要显式选中"，`--via=inject` 那条卡在"handler 调用链"）。
4. 与新会话的 0.1.7 适配一起收口：preset 迁移完成后，端到端验证才有意义（否则会话起不来）。

## 10. 相关提交

| 提交 | 内容 |
|---|---|
| `c14c8ef` | Obsidian 侧的拖拽落点（跨源 iframe 收不到，改在宿主侧接） |
| `030f933` | 落点的 CSS 自锁：`display:none` 让它永远收不到 `dragenter`（提示条不出现的根因） |
| `981f9b8` | **客户端半个的 loader 行改由权威 overlay 携带**（本文 §2 的那个缺陷） |
| `429b061` | 门禁改成"loader 行恰好挂一次"（含零次/两次变异验证）+ e2e 探针照抄插件真实启动参数 |
| `9790420` | **落笔路径自述诊断**（本文 §4，下一次拖拽就能拿到答案） |
| `ba3e2ac` | 五个分层探针 + 探针工作区清理脚本（本文 §6/§7） |
