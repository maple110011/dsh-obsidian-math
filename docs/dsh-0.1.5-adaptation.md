# DSH 0.1.5-rc.1 适配：评估与实施计划

> **状态：计划已定，实施中。** 本文记录 dsh 0.1.1-rc.2 → 0.1.5-rc.1（会话数据格式 V2 → V3）与 dsh-web-ui → dsh-web-all 0.3.20 对本项目的影响、取证与适配清单。
> 写于 2026-09-10，基于本机实测（dsh 0.1.5-rc.1 / dsh-web-all 0.3.20 / 394 份会话日志）。

## 1. 触发原因

用户升级了宿主与 web 插件：

| 组件 | 升级前 | 升级后 |
|---|---|---|
| `@deepseek-ai/dsh`（全局 CLI） | `0.1.1-rc.2` | `0.1.5-rc.1` |
| web profile 插件 | `@linxin666/dsh-web-ui-all@0.3.6`（已废弃） | `@linxin666/dsh-web-all@0.3.20` |

上游 release notes（[dsh v0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)）中与本项目直接相关的三组变更：

1. **会话数据格式升级至 V3**：受支持的旧日志通过版本迁移生成新版日志并**保留原文件**；升级后的会话不支持降级读取。原文：*「自定义日志读取器需适配 V3」*。
2. **Session 生命周期变更**：持久化 API 改为生命周期持有的 `SessionHandle`；`agentLoop.create()` 改为异步；新增 session 锁。
3. **Web 插件面板 API 调整**：新增 `sidebar.panellist` 与 `main` 全局面板；原 `conversation` Slot 迁移为 `main` 的 `conversation` key。另有 `ctx.agent` 移除与 Inbox API 改为类型接口。

`dsh-web-all@0.3.20` 另有一层约束：其 `dsh.engines.dsh` 为 `>=0.1.5-rc.1`，即全家桶与 0.1.5 cohort 绑定；皮肤/设置子包（`dsh-client-ui-skin-center`、`dsh-client-ui-web-ui-settings`）同步发布 0.3.20 并声明同一宿主下限。

## 2. 本项目的耦合面（被改动的可能性）

| 耦合点 | 位置 | 对 V3 / 新宿主的敏感度 |
|---|---|---|
| 会话日志扫描（文件名后缀） | `dsh/preset/math-memory.mjs:findSessionLogs`、`dsh/host/memory-admin.mjs:findSessionLogs`（两份副本） | **高**（V3 换了文件名） |
| 会话日志解码（zstd 分帧） | `math-memory.mjs:scanZstdFrames/decodeZstdSessionLog` | 中（帧格式是否变） |
| 会话事件语义（蒸馏/配对） | `math-memory.mjs:distillSession`、`pairMessages` | 中（事件名/来源是否变） |
| 会话头读取（vault 归属过滤） | `math-memory.mjs:readSessionHeader` | 低（`{type,id,cwd}` 是否保留） |
| 面板宿主插件与路由 | `dsh/host/index.mjs`、`math-memory-panel.mjs` | 中（`ctx.workspaceRegistry`、`ctx.webServer`） |
| 客户端面板槽位 | `dsh/client-panel/src/index.jsx`（`settings.section`） | 中（槽位契约） |
| 皮肤中心可选挂载 + junction 镜像 | `obsidian/main.template.js` | **高**（web profile 换包名） |
| profile patch 行 id 与配置 schema | `dsh/profile/cordis.patch.yml` | 中（行 id 是否还在） |

## 3. 取证（本机实测，全部可复现）

### 3.1 会话文件名：V3 是新文件，旧文件保留

```
$DSH_HOME/sessions/<projectKey>/<session-id>/
  session.jsonl.zstd      ← V2 原件（保留，不再写入）
  session.v3.jsonl.zstd   ← V3 迁移件（新写入的权威版本）
```

- 实测 `~/.dsh/sessions` 下 394 份日志：392 份仍是纯 V2，2 份已有 `.v3.` 伴生文件。
- **迁移是按需触发的，不是开机全量**：只有被「打开/恢复」过的会话才有 V3 伴生文件（本机两例：当前会话与一个 subagent 会话）。⇒ 随着使用，**每个被打开的旧会话都会变成"同目录两份日志"**；这不是过渡态，而是长期状态（上游明确保留原文件、不支持降级读取）。
- `session-8963fcda-…` 目录里**只有** `session.v3.jsonl.zstd`（subagent 会话，创建时已是 V3）⇒ 新会话也只写 V3。

### 3.2 解码路径：**无需改动**

项目自带的 `scanZstdFrames` + `decodeZstdSessionLog` 对 V3 文件直接可用（实测）：

```
scanZstdFrames OK, frames = 59      decoded events = 298
header: {"type":"session","version":3,"id":"session-…","createdAt":…,"cwd":"E:\\…","isSeeded":false,"delegationDepth":0,"agentPreset":"standard"}
distilled id/title/cwd: session-… | 如何更新dsh和dsh-web插件 | E:\software\ss\Deepseek-Harness
```

结论：**zstd 分帧依旧是多帧拼接、无字典**；`session` 头行仍在第一帧，`{type,id,cwd,createdAt}` 字段不变（只多了 `version: 3`）。

### 3.3 事件语义：蒸馏逻辑兼容，且 V3 更干净

V2 与 V3 的事件类型对照（同一会话，同一段内容）：

| 事件 | V2 (`session.jsonl.zstd`) | V3 (`session.v3.jsonl.zstd`) |
|---|---|---|
| `assistant/chunk` / `*-chunks` | 226+60+21+108 条逐块流 | **0 条**（改为 `assistant/message.data.stream[]`） |
| `system/message` | 0 | 3（系统提示词提升为 surface 节点） |
| `user/message` / `assistant/message` / `session/title` / `tool/*` | 同名同形 | 同名同形 |

- 真人输入判据 `data.source.kind === "user"` **仍然成立**（V3 实测：`user×3, plugin×3, skill-catalog×1`）。
- 文本抽取 `data.message.content[].type === "text"` 仍然成立（`reasoning`/`tool-call` 块照旧被忽略）。
- ⇒ `distillSession` / `pairMessages` / 对话索引 / 捕获渲染**语义上无需改动**；V3 少掉逐块流事件，解码量反而下降。

### 3.4 真实缺陷：同一会话被当成两份日志
`findSessionLogs` 的判据是 `name.endsWith(".jsonl.zstd")`，`session.jsonl.zstd` 与 `session.v3.jsonl.zstd` **都命中**。后果分两条路径：

**(a) 捕获路径（`runSessionCapture` / `countUncapturedSessions`）**：同一会话被扫描两次，两次产出同一个 `entry.id`，共享 `next.sessions[entry.id].lastSeq` 与 `scanned[log.path]`。第二次处理的是**较旧内容的 V2 原件**，其 delta 相对已推进的 `lastSeq` 会判为"无新内容"而跳过，但会把 `sessions[id].fingerprint` **覆盖回 V2 文件**；此后 V3 文件再增长时，指纹比对与 `lastSeq` 的来源不再一致，增量与计数都可能失真（面板「N 个会话未保存」徽标与「立即保存对话」按钮读的就是这条路径）。

**(b) 对话索引路径（`buildDialogueIndex` → `vaultSessionLogs`）**：`MAX_LOG_FILES = 20` 的窗口按 mtime 取最新 20 份日志。同一会话的两份文件各占一个名额，窗口被稀释；若两份都被解码，同一会话的问答对会**重复进入注入预算**（`MAX_DIALOGUE_PAIRS = 6` / `MAX_DIALOGUE_CHARS = 3000`）。

> 说明：`dialogue-index.json` 的 `entries` 里同一 `sessionId` 出现两次是**正常设计**（一条 user + 一条 assistant），与本节缺陷无关，勿据此误判。

### 3.5 profile / preset / 面板：在新宿主下**可用**

| 检查 | 命令 | 结果 |
|---|---|---|
| patch 行 id 与 schema 仍有效 | `dsh --profile notes-assistant --dump-config` | `sandbox-policy` / `approval` / `permission`（`math-memory-locked`）/ `fs-sandbox` / `agent-presets(default=notes-assistant)` 全部按预期合成 ✅ |
| Obsidian overlay 仍有效 | 追加 `--patch …/notes-assistant.patch.yml` | 三个 insert 行（`math-memory-workspace` / `math-memory-panel` / 可选皮肤两行）全部合成 ✅ |
| 皮肤包在 0.1.5 下可加载 | `import('@linxin666/dsh-client-ui-skin-center')` | OK（导出 `SKIN_*` schema）✅ |
| 宿主插件 + 面板路由 | `dsh --profile notes-assistant --port 3199` 实跑 | boot 无错；`/memory-panel/workspaces`、`/session-capture`、`/state` 全部 HTTP 200 ✅ |
| 客户端槽位 `settings.section` | 查 0.1.5 的 client runner 槽位契约 | 槽位仍在（`kind: list`，选项 `id`/`order`/`label`），register 形态与项目一致 ✅ |
| `ctx.agent` / Inbox API 变更 | grep 项目全部 `.mjs` | 项目未使用 `ctx.agent`、未使用 `agent.inbox` ⇒ 不受影响 ✅ |
| 记忆回归 | `npm test` | 138/138 全绿（新增 12 项 V3 断言）✅ |
| 引擎探针（真实 vault） | `npm run qa` | **9/12**：3 项失败见下方 §8，与本次改动无关（探针不读会话日志）|

### 3.6 真实 vault 探针的既有失败（非本次改动引入）
`npm run qa` 的真实 vault 探针 3 项未过：`Fubini-Tonelli (连字符)`（rank 2，需 ≤1）、`子序列 记法变体`（rank 7，需 ≤5）、`谱半径 (库中无, 应弱信号)`（top1 是 `.deepseek/memory/episodes/index.md`，score 0.95 / coverage 0.86）。

**不是本次改动造成的**，理由是可验证的：`scripts/qa/engine-probe.mjs` 只 `walk` vault 的 `.md` 文件并用 `note-tools.mjs` 的纯函数打分（`tokenize` / `bm25Score` / `computeCorpusStats` / `composePassage` …），既不导入 `math-memory.mjs`，也不读任何会话日志。触发点写在探针自己的文件头里：*「ground truth 与本机 vault 绑定…vault 内容变化时需同步维护此文件」*。

成因是 **vault 内容漂移**：`.deepseek/memory/episodes/index.md`（2026-09-10 09:16 更新，3562 字节）现在对多个查询都是高分命中——尤其把"库中无答案应给弱信号"这条控制项顶掉了。这属于 ground truth 维护问题，处置见 §6。

补充两条重要事实：

- `dsh.client.inject`（package.json 里那串包名）在新版宿主中**只是加载/预取元数据，不是激活顺序，也不是解析目标**（0.1.5 源码注释原文：*"dsh.client.inject edges are informational (loading/prefetch metadata, never apply sequencing)"*）。项目 `client-panel/package.json` 与 `install-into-profile.mjs` 里的 `@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-slots` **在 0.1.5 中已不存在**，但不会导致加载失败——属"文档陈旧"，不属"故障"。
- 皮肤中心已并入聚合包：`dsh-web-all` 自带 `web-ui-skin-center` / `web-ui-settings` 行。Obsidian 侧 `settings.enableSkinCenter` 的可选挂载（`ui-skin-center` + `ui-web-ui-settings`）在新宿主下**功能上冗余**（同一插件被挂两次；上游说明：宿主半边只跑一次、浏览器半边按包名去重，属无益但无害）。

### 3.7 ⚠️ 两处升级带来的**行为破坏**（不是本项目代码的缺陷，但会让功能失效）

这两条在 3.5 的"能启动"之外，属于"启动了但用不了"，必须单独记录。

**(1) web 界面强制 token 鉴权 → Obsidian 侧栏 iframe 会显示 401 纯文本，而不是聊天界面**

dsh 0.1.5 的 web carrier 引入了浏览器会话鉴权（`@deepseek-ai/dsh-client-connection` 的 `browser-auth`）：

- 启动时打印 `http://127.0.0.1:<port>/?token=<launch-token>`；带 token 访问根路径会 **303 重定向到 `/` 并种下 `dsh-auth-<sha256(authority)>` cookie**，cookie 绑定 `host:port` 且有过期时间；无 token、无 cookie 的请求一律 **401**，正文是纯文本 `dsh web authentication required; reopen the URL printed by dsh web.`
- 本机实测（换端口 3201 跑同一 profile）：`bare root → 401`；`root?token=… → 303 + Set-Cookie`；`root + cookie → 200（含 __DSH_BOOT__，27 659 字节）`；`/api 无 cookie → 401`。**已确认没有任何 iframe 例外**（根路径无 `X-Frame-Options` / CSP，但鉴权是硬的）。
- **Obsidian 插件当前会踩中它**：`obsidian/main.template.js` 的 `render()` 把 iframe 的 `src` 定为裸 `http://127.0.0.1:${port}/`，并且全插件**没有任何地方**消费 token（`?token` / `authenticatedUrl` / `dsh-auth` 命中数均为 0）；子进程 stdout 只被 `appendLog` 写进 debug log。服务的健康检查（端口能否响应）仍会通过，所以状态栏显示"服务已在端口 3180 就绪"，**但侧栏里的 UI 是那行 401 文本**。
- 为什么以前没暴露：0.1.1-rc.2 的 web 根路径**不需要**鉴权，所以裸 iframe 一直能用；本机 `debug.log` 最后一次插件运行为 2026-09-10 01:30Z（升级前）。
- **修复（已落地，两轮）**：第一轮从子进程 stdout 流式抓取 `?token=` 并让 iframe 加载该地址——**实测不够**：日志证明导航发生了（`[render] iframe src -> …?token=…` 紧跟 `[iframe] load`）但界面仍是 401。根因是 dsh 的会话 cookie 带 **`SameSite=Strict`**（`sessionCookie()` 原文），而侧栏是**跨站 iframe**（顶层 `app://obsidian.md` → 框架 `http://127.0.0.1:3180`），这种 cookie 在跨站子框架里存不下也发不出。
  - 第二轮（真正解决）：**dsh 以 `--port 0` 启动到内部端口，插件在主进程跑反代监听用户配置的端口**（`class DshWebProxy`）。代理用 `http.request`（`fetch` 忽略 Host）**以公共权威**兑换 token 并保存 cookie，随后给每个转发请求注入 `cookie` 并把 `host` 改写成公共权威（dsh 的 `requestAuthority` 取 `Host` 定 cookie 名与签名受众），同时剥掉 `set-cookie`/`x-frame-options`/`content-security-policy`；`/api/` 前缀的 WebSocket 升级一并转发；`stop()` 关代理并清 cookie。
  - 回归：`scripts/test-panel-proxy.mjs`（15 项，stub 上游复刻权威+cookie 规则）、`scripts/test-panel-auth.mjs`（7 项，**对真实 dsh** 走完整链路）。

**(2) 会话独占锁 → 同一会话不能被两个进程同时打开**

0.1.5 为每个会话加了写锁：Windows 用命名内核信号量（`Local\dsh-session-lock-<sha256(路径小写)>`，零超时等待，争用即 `ERROR_SHARING_VIOLATION`），POSIX 用 `flock`，冲突抛 `SessionAlreadyOwnedError`。

- 对"双实例"方案（主 dsh web 3080 + Obsidian notes 3180，**共用同一个 `$DSH_HOME`**）的含义：同一场会话不能在两边同时打开——后打开的一侧会报"已被占用"。这是新行为，值得写进使用说明；它不影响记忆功能本身（记忆侧只读日志文件，不取锁）。
- 附带影响：记忆侧的捕获/索引与主进程的写入并发时，读取方可能读到"写了一半"的最后一个 zstd 帧——项目对此**已有容错**（`decodeZstdSessionLog` 逐帧解压，失败即 `continue`），所以只会少读到最后一帧，不会崩。

## 4. 适配清单

### A. 必修（真实缺陷，本次实施）

**A1 · 会话日志选择策略：同一会话只取权威版本**

新增一个共用的"日志选择"步骤，两条路径（preset 的索引/捕获、host 的未保存计数）都改走它：

1. 按 `mtimeMs` 降序排序（现有行为）；
2. 由路径取 `<session-id>` 目录名作为键，**同一键只保留最新的一份**；
3. 若同一目录下同时存在 V2 与 V3 文件，**优先 `session.v3.jsonl.zstd`**（V3 必然晚于 V2 产生；前缀判据点：3.1 的实测与上游"迁移生成新文件、保留原件"的语义）。

实现约束：
- `findSessionLogs` 是导出的公开函数，另有 `tests`/`qa` 使用；**保持签名不变**，在内部完成去重，避免调用方各自打补丁。
- `dsh/host/memory-admin.mjs` 是刻意自包含的副本（注释已声明"与 preset 保持同步"）⇒ 同步改这一份，并补一条测试断言两份实现行为一致。
- 去重后 `MAX_LOG_FILES` / `CAPTURE_SCAN_LIMIT` 的语义不变（仍是"最多 N 个会话"），但不再被重复日志稀释。

**A2 · 面板"未保存"计数与捕获共用同一判据**：`countUncapturedSessions` 走 `scanSessionCapture`，与 `runSessionCapture` 同源；A1 落地后两者自动一致（需在测试中固定这一不变量）。

### B. 应修（一致性，低风险）

**B1 · 客户端面板包的版本声明更新**：`dsh/client-panel/package.json` 与 `install-into-profile.mjs` 生成的 `dsh.client.inject` 改为 0.1.5 实际存在的包名（`@deepseek-ai/dsh-client-modules`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings`），并加注释说明该字段是"信息性"的、真正的依赖是运行时的 cordis 服务名（`slots` / `locale`）。避免下次排查时被陈旧包名误导。

**B2 · 皮肤中心冗余挂载的说明（已落地为注释）**：不改变现有行为（默认 `enableSkinCenter: false`，且聚合包挂载与它互不冲突），在 `obsidian/main.template.js` 的 `SKIN_CENTER_INSERT` 与 `dsh/profile/notes-assistant.patch.yml` 注释里写清：自 0.3.20 起皮肤中心已随聚合包进入 web profile，Obsidian 侧这个开关在"有聚合包的机器"上冗余、在"只有皮肤包没有聚合包"的机器上仍是唯一入口。**不改默认值**——改默认值属于产品决策，留给用户拍板（见 §6）。

### C. 明确不改（记录理由，避免下次重复排查）

| 项 | 理由 |
|---|---|
| `scanZstdFrames` / `decodeZstdSessionLog` | V3 帧格式与 V2 相同，实测可用 |
| `distillSession` / `pairMessages` / `text extraction` | 事件名与来源判据未变 |
| `readSessionHeader` | `{type,id,cwd}` 头行仍在第一帧 |
| profile patch（`cordis.patch.yml`） | 全部行 id 与 schema 在 0.1.5 下仍有效（3.5 实测） |
| 客户端面板的 `settings.section` 槽位注册 | 槽位契约未变（3.5 实测） |
| `session-scope.md` 的 P1 方案 | 其依赖的 `ctx.sessionPersistence.list()` 需在实施该方案时重新取证（本次不实施） |

## 5. 实施顺序（文档先行）

1. **本文档**（已完成）→ 2. A1 代码 → 3. host 副本同步 → 4. 回归测试（V3 夹具 + 双文件场景 + 两份实现一致性）→ 5. `npm test` → 6. 端到端验收（3199 冒烟 + `/memory-panel/*` 路由 + `npm run qa`）→ 7. 文档同步（`CHANGELOG.md`、`docs/memory/changelog.md`、`docs/memory/design.md`、`README.md` + `README.zh.md`、`docs/memory/handoff.md`）→ 8. `node scripts/check-doc-consistency.mjs`（断言数等数字必须与实测一致）。

## 6. 待用户决策（不在本次实施范围）

1. **B2 的默认值**：既然聚合包已自带皮肤中心，Obsidian 侧 `enableSkinCenter` 是否改为默认 `true`（本地 web UI 直接带皮肤选择器）还是继续保持 `false`？
2. **是否清理 junction 残留**：`syncGlobalPackageLinks` 只建立镜像、不清理失效项；web profile 换包名后，notes-assistant profile 里留下 21 个 junction，其中一部分（如 `dsh-web-ui-all`）在新 web profile 下已无对应目录。是否加一步"只镜像仍然存在的包 + 清理失效 junction"？
3. **subagent 会话是否要进记忆**：V3 头部新增 `parentSession` / `origin: "subagent"` / `delegationDepth`，使"跳过子代理会话"第一次成为**可判定**的事（V2 无此字段）。当前实现会把子代理会话按 vault 归属收进捕获与索引。
4. **真实 vault 探针的 ground truth 维护**（§3.6）：`episodes/index.md` 已成为多个查询的高分命中，并把"库中无答案=弱信号"控制项顶掉。两条路线——(a) 把 episode 索引从检索语料里降权/排除（它本是导航文件，不是知识证据），(b) 按探针文件头的要求维护 ground truth 期望值。推荐 (a)，因为"导航文件压过知识笔记"对真实使用也是错的，但这属于检索层改动，需要单独提案。

## 7. 复现命令

```powershell
# 日志布局与 V3 伴生文件
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Recurse -Filter "session*.jsonl.zstd" |
  Group-Object DirectoryName | Where-Object Count -gt 1

# profile 合成（含 Obsidian overlay）
dsh --profile notes-assistant --dump-config
dsh --profile notes-assistant --patch "$env:USERPROFILE\.dsh\profiles\notes-assistant\notes-assistant.patch.yml" --dump-config

# boot 冒烟（换端口，不影响 3080）
dsh --profile notes-assistant --port 3199 --host 127.0.0.1 --no-open
curl "http://127.0.0.1:3199/memory-panel/session-capture?root=D%3A%5CObsidian%E7%AC%94%E8%AE%B0%E6%95%B0%E6%8D%AE%E5%BA%93"

# 回归
npm test
npm run qa
```
