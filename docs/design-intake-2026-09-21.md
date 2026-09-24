# 用户提问评估（2026-09-21）：记忆引用打不开 / 注入机制 / 拖拽引用

> **性质**：用户提了三个问题——(1) 能不能把 Obsidian 笔记拖进侧栏的 dsh 里引用；(2) dsh 回复里引用自己记忆库时在 Obsidian 中打不开；(3) 记忆的上下文注入怎么做的、能不能专门优化、搞一份 handoff 文档让 agent 先读会不会更好。本文是**只读取证 + 吸纳决策**。
> **状态（2026-09-21）**：§2.1（A组：截断方向 + notation 进档位表）**已实施**（`fix(memory): 注入截断方向是反的`）；§2.2（B组：记忆卡可打开）**已实施**（`/open` 分流 + 协议补链接模板 + 回归与变异验证）。§2.3（C组）只登记不动代码，§3 的否决项与 §4 的登记项保持原判。
> **方法**：三个子代理 + 主代理并行只读取证（源码 + 已安装的 dsh 0.1.5-rc.1 + 本仓库文档），所有结论带 `文件:行号`；推断处标注【推断】。
> **不变式**：本文只描述**当前**状态与决策，实现进度以 `docs/handoff.md` §7 与 `CHANGELOG.md` 为准。

## 0. 一句话结论

- **拖拽引用：能做，但缺的不是机制而是「谁去写那个 mention」**——dsh 的 `@path` 引用就是**普通提示词文本**，`setDraft` 是公开 API；代价是需要一个 dsh 客户端插件里的 `drop` 监听。**Obsidian 拖拽 payload 的确切形态未实测**，这是动手前必须先补的一步。
- **记忆引用打不开：两个独立原因，都静默失败**——① `/open` 把 `.deepseek/**` 交给了对隐藏目录无效的 `openLinkText`；② 协议层从没给记忆卡一个「可打开」的链接模板。前者是**缺陷**（插件自己早在注释里写明了这条限制，只是没应用到 `/open`），后者是**缺口**。这一组应该做。
- **handoff 文档：不要做**——vault 根 `AGENTS.md` **已经在自动注入**（22873 字符/会话），`.deepseek/working.md` **已经就是那个 handoff**（模板已结构化 + 已注入 + 已有轮末覆写纪律 + 已有断言）。再加一份等于给「找当前状态」加第四个入口，正面踩**坑 83**。真正该修的是注入的**截断方向**与**档位覆盖面**。

## 1. 三项取证摘要

### 1.1 拖拽（问题 1）

| 事实 | 证据 |
|---|---|
| 侧栏 iframe **跨源**，插件碰不到它的 DOM | `obsidian/main.template.js:569-572` 注释原文「the plugin cannot touch its DOM (cross-origin)」；顶层站 `app://obsidian.md` vs frame `http://127.0.0.1:3180`（`:541-542`） |
| iframe 无 `sandbox` 属性 | `:1780-1783`（但这不改变跨源事实） |
| 代理**能**往导航 HTML 注入脚本（已成熟的通道） | `injectPerfStyle` `:705-710` + `forwardInjecting` `:971-1002`；已有 11 项回归 |
| dsh 的内置 drop 只接真文件 | `dsh-client-ui-attachment/lib/client.js:618-619`：`!dataTransfer.types.includes("Files")` → 直接 `return null` |
| `@path` mention 是**普通提示词文本** | `dsh-file-reference/README.md:12`「inserts the matching mention as **ordinary prompt text**」；语法 `formatFileMention`（`lib/types/grammar.js:32-42`） |
| 程序化写 draft 是**公开 API** | `dsh-client-ui-conversation/lib/types/client/contract/input.d.ts:172-176` `SessionInput.setDraft`（注释「persisted-draft seed and **programmatic writes**」）；服务名 `conversation`（`lib/types/client/index.d.ts:31`） |
| 本地 provider **不排除点目录** | `dsh-file-reference-local/lib/index.js:189,245-246`（带 `.` 的查询不被过滤） |

### 1.1.1 实测结果（2026-09-21，两个探针，**已不再是推断**）

上一节把「Obsidian 拖拽 payload 形态」列为**未验证**。当天用两个探针把它测掉了：

**A. 拖拽载荷的真值** — `node scripts/qa/drag-payload-probe.mjs`
（启动**隔离**的 Obsidian：独立 `--user-data-dir` + 临时 vault，不碰用户正在用的实例；
用 CDP `Input.setInterceptDrags` 拦下 Chromium **真实**的 `DragData`，即页面 `dragstart`
里 `setData()` 之后、投递之前的真值）:

```
文件树里拖一个 note：
  dragOperationsMask: -1
  mime="text/plain"     data="obsidian://open?vault=vault&file=%E6%A0%B9%E7%AC%94%E8%AE%B0"
  mime="text/uri-list"  data="obsidian://open?vault=vault&file=%E6%A0%B9%E7%AC%94%E8%AE%B0"
```

⇒ **不是 vault 相对路径，是一条 `obsidian://open?vault=<库名>&file=<URL 编码的库内路径>` URI**，
`text/plain` 与 `text/uri-list` 两份同值。解析它得到的是 `file=` 后的**库内路径**
（`%2F` 解出来是 `/`）。**嵌套文件与文件夹这两行探针没测出来**（文件夹需要先展开、
编辑器的文字选择需要真实鼠标划选，这两条在该夹具里没跑通），因此它们的载荷形态
**仍是推断**：按同一条 `dragstart` 处理器，最可能是同一种 URI。

⚠️ **但这不影响可行性结论**：URI 里已经带了 `vault=` 与 `file=` 两个参数，
`file=` 就是库内路径；即便文件夹/文字选择各有差异，drop 侧只需要处理「拿不到可解析的
`file=` 时忽略该次拖拽」这一种退化情形。

**B. 跨源 iframe 到底收不收得到 drop** — `node scripts/qa/iframe-drop-probe.mjs`
（三个临时 HTTP 服务 = 真跨源：源 / 宿主 / 目标 iframe 各在不同端口；CDP
`Input.dispatchDragEvent` 把 A 测出的同款载荷分别投给**同源对照区**与**跨源 iframe**）:

```
[ok] 三个角色确实不同源（源 ≠ 宿主 ≠ 目标 iframe）    source=53779 host=53781 child=53780
[ok] 对照：宿主文档（自己就是 drop 目标）收到了 drop    hostDrops=1 dragenters=1
[ok] 跨源 iframe 的 drop 监听收到了 drop 事件          drops=1
[ok] 跨源 iframe 能读到 dataTransfer 的内容            text="obsidian://open?vault=vault&file=%E6%A0%B9%E7%AC%94%E8%AE%B0"
__CHECKS__ 4/4
结论：路径 A 可行 —— 在 dsh 客户端插件里挂 document 级 drop 监听即可，不需要遮罩。
```

⇒ **跨源 iframe 内的 `drop` 监听能收到事件、并且能读到 `dataTransfer` 的内容**
（`types` 与 `text/plain` 都拿到了）。**路径 A 成立**，路径 B（透明遮罩）不必要。

**夹具自己的三个坑（都写进探针注释了，因为每一个都会让结论反过来）**：
1. **同源夹具**会证明一个不存在的场景是对的 ⇒ 三个角色必须三个端口；
2. **一次拖拽只能在一个 CDP target 的输入管线里完成** ⇒ 把"源"放另一个 tab，
   连**同源对照**都收不到 drop（第一版就是这样，差点把 0 读成"跨源不行"）；
3. **父页面读不到跨源 iframe 的内部状态**（`SecurityError`）⇒ 目标 iframe 用
   `postMessage` 回报结果，而不是让父页面读它的 `window`。
   另：`setInterceptDrags` 不是"观察并放行"，它会**暂停**拖拽，必须用
   `Input.dispatchDragEvent` 续上——不改这一点，投递根本不会发生。

**给实现的最短路径**（也是本轮登记进 `handoff.md` §7 的内容）：
在新客户端插件里 `document.addEventListener('drop', …)` → 从 `dataTransfer.getData('text/plain')`
里取 `obsidian://open?…&file=<路径>` → 解出库内路径 → `setDraft(现有草稿 + '@' + 路径)`。
`@path` 是普通提示词文本（§1.1 已证），模型会自己去读文件。

**未验证（动手前必须补）**：Obsidian 拖拽的实际 `dataTransfer` 类型与取值（`text/plain` 是 vault 相对路径还是 markdown 链接？`text/uri-list` 是否为绝对路径？）。本文不据此下结论。

### 1.2 记忆引用打不开（问题 2）

**原因 ①：`/open` 对隐藏目录无效（缺陷）。**
- `obsidian/main.template.js:411` 无条件下交 `app.workspace.openLinkText(notePath, '', openInNewPane)`。
- 插件自己写明了这条限制：`:1900-1905`「Obsidian's vault index excludes dot-folders … so **.deepseek files cannot be opened through openLinkText or any TFile-based API**」。
- `/feedback` 早就绕开了（面板走 node fs + `MemoryPreviewModal`，`:1906-2007`、`:2363-2372`），**`/open` 没有**。
- 真实失败现象已记录：`docs/changelog.md:1404`「点击会变成"创建文件"→ `Folder already exists`」。
- **失败还是静默的**：注入脚本吞掉点击改 `fetch(...).catch(function(){})`（`:700`），`/open` 成功也只回 204（`:421-424`）。

**原因 ②：协议层从没给记忆卡一个可打开的链接模板（缺口）。**
- `dsh/preset/math-memory.mjs:3673` 只教「引用**笔记**」用 `/open`；`:3686-3688` 对**记忆卡**只给 `/feedback`（✅/❌）+ 验证徽标，**没有打开手段**。`dsh/templates/vault-AGENTS.md:201-202` 同。
- dsh 回复正文里唯一「可自动变可点」的通道是 `chatFileMentions`，而它**只收录本轮 `write`/`edit`/`str_replace_editor` 成功产出的路径 + `present` 申报**（`dsh-client-ui-deliverables/lib/client.js:413-431,469-486,952-962`；`lib/index.js:125` 的提示词原文限定 "create or modify"）。**只读出来的记忆卡永远不进词表**。
- 本 profile **没有挂 `present`**：`dsh/preset/agent.cordis.yml` 全文件只有 persona / agent-instructions / tool-fs / tool-fs-search / tool-ask-user / math-memory。

**为什么长期潜伏（两条都要记）**：
1. `docs/handoff.md` §7（唯一权威未做清单）**没有这一条**——它是未登记的缺口。
2. `scripts/test-link-server.mjs` 的 `/open` 用例**全是普通笔记路径**（`:122-129`），假 workspace 的 `openLinkText` 是**永远成功的桩**（`:108`）⇒ 这个缺陷在该套件里**结构上不可能被发现**。`.deepseek` 只出现在 `/feedback` 用例（`:131`）。

**附带发现**：`CHANGELOG.md:230` 称「dsh 前端已内置 loopback 链接站内跳转」，而在本机安装的 `dsh-web-frontend/dist/assets/index-DuF6ti6g.js` 里 grep `127.0.0.1|localhost|loopback` **命中 0 处**。该说法与当前安装版本不符（不改变本节结论，但值得单独核实）。

### 1.3 注入机制（问题 3）

**只有 2 个代码注入点**：
1. `dsh/preset/note-tools.mjs:1276-1285` —— 固定散文（工具路由），`ctx.systemPrompt.section`。
2. `dsh/preset/math-memory.mjs:4073-4086` —— `ctx.on("system-prompt/assemble", …)` 追加 `dsh-math:memory` 段。

**全部是静态文件读**，硬上限 `MAX_TOTAL_MEMORY_CHARS = 18000`（`:155`）：

| 段 | 来源 | 挑选规则 | standard 预算 |
|---|---|---|---|
| 画像 | `memory/profile.md` | 固定文件 | 4000 |
| 记号 | `memory/notation.md` | 固定文件 | **硬编码 800，不在 BUDGET_TIERS 里** |
| 主题索引 | `memory/topics/index.md` | 固定文件 | 1800 |
| 记录摘要 | `memory/records/index.md` | 只留 `-` 行，**头截断** | 800 |
| 模板索引 | `memory/templates/index.md` | 只留 `-` 行，**头截断** | 600 |
| 事件时间线 | `memory/episodes/index.md` | **保尾部** | 1200 |
| 备忘录 | `.deepseek/inbox/*.md` | **唯一带 query 相关性**（0.7×relevance + 0.3×staleness，top3） | 1200 |
| 跨会话线索 | 会话日志 → `cache/dialogue-index.json` | 排除当前会话，≤6 组 | 3000 |
| 记忆体检 | `cache/memory-audit.json` | 每日一次扫描 | 1200 |
| 工作记忆 | `.deepseek/working.md` | 空则不注入 | 500 |

**「按 query 检索后注入 top-k」不存在**：retrieval v3 的 S5 已整段删除（`:3738-3739`），回归断言钉住「不得出现『本轮记忆召回』」（`test-memory.mjs:295`）。`latestUserText()` 算出来了但**只喂 memo 排序**（`:4043`）。

**已存在的 handoff 通道（这就是 §3 否决的依据）**：
- `AGENTS.md` 自动注入：`agent.cordis.yml:52-55` 挂 `@deepseek-ai/dsh-agent-instructions`（`maxBytes: 65536`），vault 根 `AGENTS.md` 实测 **22873 字符**、每会话首请求全文进上下文，`read` 到更深目录会自动追加该层指令。
- `working.md`：`math-memory.mjs:3797-3801` 注入、模板 `dsh/templates/working.md` 已结构化（当前问题/子目标/已证·已失败/已检索·已排除/下一步）、`templates-manifest.json` 已登记、`install.mjs`/`deploy-local.mjs` 已覆盖、`test-memory.mjs:308-312` 已断言。
- **并且协议已写明它不需要「先读」**：`vault-AGENTS.md:163`「系统提示若注入『工作记忆』段，说明上一轮有未闭合线程——**沿用**其进度状态」。

## 2. 决定做（本文档对应的实施范围）

### 2.1 A组 · 注入截断方向 + 档位覆盖面

**实测（本机，零 token，`buildMemorySection` 直调）**：

以 bench vault 为输入时各段字符数（总计 **4088**，**无任何截断**）：

```
 1366 (header)      456 捕获策略    295 画像      196 记号
  431 主题索引        216 记录摘要    183 模板索引   117 事件时间线
   63 备忘录         314 工作记忆
```
⇒ 合成夹具根本触发不到截断，**这正是这个缺陷至今没人发现的原因**。

构造**增长型**夹具（与真实写入协议一致：最旧在前、最新在后）后立刻现形：

| 夹具 | 结果 |
|---|---|
| `records/index.md` 40 条索引行（1452 字符，预算 800） | 出现 `［截断：全文 1452 字符］`；**含 rec-1（最旧）= true，含 rec-40（最新）= false** |
| `topics/index.md` 5033 字符，头为 alpha、尾为 omega | 段 1886 字符；**含 alpha = true，含 omega = false** |

⇒ **增长型内容被「保头部」截断，最新写进去的东西最先被砍掉**。这与本仓库「append-only、带时间戳多版本」的写入协议**方向相反**。

**改法（三条，都在 `dsh/preset/math-memory.mjs`）**：
1. `clip()`：从「保头部」改为「**头 + 显式中间标记 + 尾**」。理由：`profile.md`/`notation.md` 这类文件的**头部是定义性的**（身份/记号），尾部是**最新增补**，只保一侧必然丢东西；`episodes` 保尾是对的但那是因为它是纯时间线，不能推广到所有文件。标记里**写出被略去的字符数**（现有标记只写原文总长，读者无法知道缺多少）。
2. `recordIndexDigest` / `templateIndexDigest`：改为**像 `episodeIndexDigest` 一样保尾部**（三个摘要器同构 ⇒ 抽成共享助手，符合仓库「共享助手用同一个名字」的纪律，`check-engine-sync.mjs` 会按名字配对）。
3. **`notation` 预算进 `BUDGET_TIERS`**（当前硬编码 800 在 `:3716`，档位管不到它），三档各给一个值，`standard` 保持 **800 不变**（"选择档位不得改变不选档位者的行为"）。

**必须同步的断言**（已知会红，提前列出）：`test-memory.mjs:2149-2159`（`OLD_CONSTANTS` 七键 → 八键 + `compact<standard<rich` 全键）、`:2544-2548`（`clip` 保留内容 ≤ 预算、`…` 约定）、`:2558`（组装段自报截断）。

### 2.2 B组 · 记忆卡引用可打开

- **B1（主修）**：`/open` 对 `.deepseek/` 前缀分流到 `MemoryPreviewModal`，其余仍走 `openLinkText`；顺带用上 `/feedback` 已有的路径校验（`:342-358`），对不存在/越界**回 4xx 而不是静默**。
- **B2（配套）**：`math-memory.mjs` 与 `vault-AGENTS.md` 各加一句：记忆卡的**卡标题也用 `/open` 链接**；顺手统一 `vault-AGENTS.md:201`（回复正文用 `/open`）与 `:203`（写进文件用 `[[wikilink]]`）的边界措辞。
- **B3（兜底）**：失败要有回执（不能继续「静默 204 + 吞点击」）。
- **B4（硬性）**：`test-link-server.mjs` 补 `.deepseek` 的 `/open` 用例；把假 workspace 的 `openLinkText` 桩改成**对 `.deepseek` 记失败**（当前桩使缺陷结构上不可发现）；**变异验证**（删掉分流应报红）。

**顺序不可颠倒**：先 B1 后 B2。只做 B2 会制造更多「点了没反应」的链接，比纯文本更糟。

### 2.3 C组 · 拖拽引用登记

本机取证已足够写清**可行性**与**未验证项**（§1.1），但**不足以直接动手**（payload 形态未知）。因此本轮只把它**带证据登记进 `docs/handoff.md` §7**，不动代码。

## 3. 明确不做（不要再讨论）

| 否决项 | 理由（证据） |
|---|---|
| **新建一份 handoff 文档让 agent「先读」** | ① `AGENTS.md` **已在自动注入**（22873 字符/会话，`agent.cordis.yml:52-55`）；② `.deepseek/working.md` **已经就是那个 handoff**（已注入、已结构化、已有覆写纪律、已有断言）；③ `vault-AGENTS.md:163` 已写明「**沿用**注入的进度状态」——它本来就不需要「先读」；④ 「让模型去读」比「直接注入」**更弱**（模型可跳过，跳过了还无声）；⑤ 正面踩**坑 83**「一个能力多个入口，模型就自己挑」。**若确实要每会话一份交接**，正解是配置 `dsh-agent-instructions` 的 `instructionFileCandidates`（一行 YAML、零代码），接进已有通道。 |
| 把 vault 里的工作记忆**改名**成 `handoff.md` | `docs/handoff.md` 在本仓库已是「给维护者的交接文档」；vault 里再出现同名文件会让人和 agent 永久混淆。要扩就扩 `working.md` 的**语义**，不要新占名字。 |
| 把 `.deepseek/**` 变成 Obsidian 可见 | 无公开 API 可把点目录塞进 vault 索引（`userIgnoreFilters` 只影响搜索/链接建议）；搬出 `.deepseek/` 会打断硬编码契约（`note-tools.mjs:953-998` 的语料分类、`memory-admin.mjs` 归档路径、`main.template.js:347` 的 `/feedback` 白名单、模板与文档全篇）。 |
| 挂 `@deepseek-ai/dsh-tool-present` 让记忆卡进 mention 词表 | `present` 的定义是「交付本轮**产出**」（`dsh-client-ui-deliverables/lib/index.js:125` 原文限定 "create or modify"）；把「读过的卡」申报成交付会污染每个 turn 的 deliverables 行，而且**不满足用户诉求**（要的是在 Obsidian 里打开）。 |
| 按 query 检索后注入 top-k 召回段 | retrieval v3 的 S5 已实测删除并留了否定式断言（`test-memory.mjs:295`）；重新引入要先有反例数据。 |
| 注入层按「层」重排（把增长型索引从逐轮注入挪走） | **方向认可，但本轮不做**：它改的是注入**语义**，需要先量真实 vault 的逐段长度与命中率，属于 §2.1 之后的独立一轮。先修截断方向（纯缺陷），再看还需要不需要动结构。 |

## 4. 登记进未做清单（`docs/handoff.md` §7）

- **拖拽引用**（§1.1）：待补「Obsidian 拖拽 payload 实测」后可动手；实现路径 = dsh 客户端插件里的 document 级 `drop` 监听 + `setDraft`（或「透明遮罩 + LinkServer 回环」的备选）。
- **`working.md` 的 500 字符上限**：模板五字段光标签就约 120 字符，装不下真正的进度；提到 800–1000 或精简模板——需与「注入体积」一起量。
- **`CHANGELOG.md:230` 与当前前端不符**：本机 0.1.5-rc.1 前端 bundle 里 loopback 特判命中 0 处，需单独核实。

## 5. 风险

- **B1 让 `/open` 有了两条语义**（索引内 → 编辑器；`.deepseek/` → 预览 Modal）。缓解：只对 `.deepseek/` 前缀分流，路径校验复用 `/feedback` 那一套，并对越界/缺失回 4xx。
- **B3 要动注入脚本**（`noteLinkInterceptor`），它已被 headless Chromium/CDP 验证过（`CHANGELOG.md:77`、`scripts/qa/sidebar-*`）⇒ 改动后必须重跑那些探针。
- **A组改 `clip` 会改变所有被截断段的字节**，包括用户侧已习惯的读法。缓解：`standard` 的任何**预算数字**都不变，只有截断结果的**形状**变。
