# 项目评估（2026-09-10）：dsh 0.1.5 升级后的现状、缺陷与优先级

> **性质**：一次完整评估的存档。三路独立代码审计（记忆引擎/宿主、Obsidian 插件侧、测试与发布链路）+ 宿主升级实测 + 四项待决策的优劣分析。
> **方法**：全部结论区分「已复现（CONFIRMED）」与「推断（SUSPECTED）」；严重度 CRITICAL / HIGH / MEDIUM / LOW。审计为只读，所有变异复现都跑在 `%TEMP%` 临时目录，**真实 vault 与 `$DSH_HOME` 零改动**（已核对：vault 根目录 4 个文件、`.deepseek/archive` 不存在）。
> **读法建议**：先看 §1 结论与 §2 优先级队列；四项决策见 §3；升级带来的行为破坏见 §4；细节清单见 §5。
>
> ## ✅ 修复进展（同日实施）
>
> **P0 表全部三行 + 三个小修已落地并验证**：P0-0（frontmatter `$` 替换模板与空块偏移插入）、P0-1（路由 root 锚定 + Origin 校验 + 可选 token）、P0-2（`archiveMemoryFile` 源校验）、P1（LinkServer 二次解码）、P2（`install-into-profile` 静默 no-op）、P3（`/memory-panel/workspaces` 不可达）、P14 中的 capture-policy 字段白名单。
>
> - 回归：`test-memory.mjs` 138 → **155**；新增 `test-panel-routes.mjs` **25** 项路由断言；新增 `check-embedded-writers.mjs`（求值 main.js 里嵌入的那份 `memory-admin.mjs` 并断言"嵌入 == 仓库"）。
> - 变异验证：拆掉 Origin/root 守卫 → 6 条断言立刻失败；注入嵌入漂移 → stale-bundle 断言失败。
> - `main.js` 已重建（341,474 B，可字节级重现）、`deploy-local` 已执行、live 验收 **9/9**（含"被拒的归档不留空目录"这条实测发现的新断言）。
> - 仍未修：§2 P1 的 #6–#13、P1.5 的 P4/P5/P6/P7/P8/P9/P10/P11/P12/P13/P15。
>
> **✅ 追加修复（同日，第一批）**：**§4.1 的 iframe 401 已修**——而且修法比原计划深一层。第一轮"抓 token + iframe 加载带 token 地址"实测**不够**：日志证明导航发生了（`[render] iframe src -> …?token=…` 紧跟 `[iframe] load`）**但界面仍是 401**。根因是 dsh 的会话 cookie 带 **`SameSite=Strict`**（`sessionCookie()` 原文），而侧栏是**跨站 iframe**（顶层 `app://obsidian.md` → 框架 `http://127.0.0.1:3180`），该 cookie 在跨站子框架里存不下也发不出。最终方案：**dsh 退到内部端口（`--port 0`），插件在主进程跑反代监听用户配置的端口**（`class DshWebProxy`），由代理以公共权威兑换 token、保存并注入 cookie（同时改写 `Host`、剥掉 `set-cookie`/框架头），WebSocket 升级一并转发。新增 `scripts/test-panel-proxy.mjs`（15 项，stub 上游）与重写 `scripts/test-panel-auth.mjs`（7 项，**对真实 dsh** 端到端）。顺带把 `check-embedded-loader.mjs` 从"自证"改成"读模板真实名单 + 自测"。**已在 Obsidian 中确认可用。**
>
> **✅ 追加修复（同日，第二批）**：**§2 P1-4（检索回归网测陈旧手抄公式）与 §3 的四项决策全部落地**。
>
> - 产品检索管线抽成 `buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`，`note_recall`、`note_strategy` 与两个探针**调用同一份代码**；探针再也无法与产品分叉。
> - 导航索引降权（`episode-index` 0.4、`theorem-index` 0.7），弱信号判据落在内容文档上。**真实 vault 探针 9/12 → 12/12，未改任何 ground truth**；仿真探针 8/8。
> - 决策 1：皮肤中心开关保持默认 `false` + 文案改名并写清"关掉它不会关掉皮肤"。
> - 决策 2：junction 镜像改为 `lstatSync` 判别 + 悬空即重建 + 记录失败（原来 `existsSync` 跟随链接 ⇒ 死链接永久沉默）。
> - 决策 3：`captureSubagents`（默认 `false`）——V3 头部的 `origin: subagent`/`delegationDepth` 让判定可行；preset 捕获与 host 面板计数同规则。
> - 决策 4：即导航索引降权。
> - 回归：`test-memory.mjs` 165 项（新增子代理过滤 5 项）；文档一致性 15 个锚点。
>
> **仍未修**：§2 P1 的 #6–#8、#10–#13（含 `check-embedded-loader` 之外的验收凭据问题、版本号不一致、CI 仅 Linux）、P1.5 的 P4–P13、以及非原子写那一类。
>
> **✅ 追加修复（同日，第三批 —— 用户反馈驱动的呈现层与发布链路）**：本轮不是审计驱动，而是**用户使用反馈**驱动：① 体检报告「展示的几乎是 ds 的输出记录，令人不知所云」；② 记录层「对、错、归档」三选项「令人不明所以，从日常使用来看感觉意义不大」；③ 记忆面板信息显示待优化；④ Release 没更新版本，插件商店拿不到新版。先做两份**只读取证调研**再动手（面板呈现层逐元素清单 + 反馈机制设计意图回溯），结论与改法：
>
> - **呈现层丢掉了数据层早已算好的信息，且两个面板丢的不是同一批**：`collectMemoryState` 只收集 records+templates ⇒ 文档承诺的「五层」里有三层（topics/theorems/strategy，真实 vault 确有卡）在两个面板**都不可达**；`topic` 可搜索却从不显示；episode 只返回 `{rel,name,mtimeMs}`——而 `mtimeMs` 是**捕获写盘时间**，同一次捕获的多条 episode 时间戳完全相同（实测两条都是 `2026/9/10 09:16:21`），所以「事件时间线」既没时间也没线。人类标题/主题一直躺在 `episodes/index.md` 里没人读。
> - **体检报告只有一根字符串**，同时被注入模型提示、写进 JSON、并被两个面板**原样**显示 ⇒ 用户读到的字面文本是 `[[.deepseek/memory/records/…|最优耦合 … $c$-循环单调集…]](0.327)——向用户建议处置，不自行删除`。现在拆成 `checklist`（模型）+ `human`（人）+ `sections/counts/decisions/thresholds/structural`（结构化，`schemaVersion: 2`）；`readAuditText` 只取字符串、丢掉其余字段的问题由 `readAuditReport` 补上（面板因此曾同屏显示 09-09 的「共 3 张卡」与实时的「记录 2」）。顺带修掉「报告建议归档一张它刚刚归档掉的卡」的排序缺陷。
> - **反馈机制从未被使用过**（全库普查：`last_wrong`/`needs_review`/`last_not_applicable`/`status: superseded`/`verified: user-confirmed`/`success_rate` 全为 0，🔁 字符 0 个，`.deepseek/archive/` 不存在，3 张真实卡全是 `single-source` 且无评级）。机制本身是好的（`confirm` 是验证等级升级的**唯一**确定性通道），坏的是**分层与回执**：N 张卡发 N 行一模一样的 `[✅ 这条对]`、「这条」读作"回答对不对"而实现是**对该卡的永久判定**、`归档`（一次 `renameSync`）被摆在两个"评价"按钮旁边、`🔁 不适用` 写的字段**全仓库无读取方**（看起来像 ❌、实际零效果）、而 dsh web 面板的 `run()` **丢弃响应体**（点任何按钮界面无变化，唯一显示的 `success=` 对真实卡永远是 `—`）。
> - 落地：回复行改为「每张卡一行 + 写明卡标题」的两选项并删掉 🔁；`归档` 移出评估行成为面板生命周期动作（二次确认 + 危险样式）；`❌` 不再给无评级卡凭空写 `success_rate`；无 `hook:` 块的卡自动补块（此前**证据最弱的卡反而最不能纠错**）；两个面板都显示中文回执。
> - **发布链路**：版本号曾三方漂移（package 0.7.3 / manifest 0.7.4 / CHANGELOG 0.7.4 / npm `latest` 0.7.1），且 0.7.2–0.7.4 **从未推过 tag** ⇒ 用户端永远停在 0.7.1，这正是「插件商店拿不到新版本」的机制。新增 `scripts/check-version-consistency.mjs`（五处版本 + `--tag`）、`versions.json`、`docs/release.md`；`release.yml` 从「推 tag 零门禁」变成 `npm ci` + 版本一致性 + 重建 diff + `npm test`，Release notes 改抽该版本段落（原来取的是 `## [Unreleased]`）。
> - 回归：`test-memory.mjs` 165 → **207**（§30 面板数据层 22 项、§31 体检归档一致性 6 项）、`test-panel-routes.mjs` 25 → **30**。**未兑现项**：`control-panel.md` §2.3 要求的 source 证据链与引用次数仍未交付（`collectMemoryState` 不解析 `source`）。

## 1. 结论摘要

**项目整体是健康的**：138/138 零 token 回归全绿、`main.js` 可字节级重建（CI 门禁真实有效且当前为绿）、安装器 e2e 覆盖直接/冲突/接管/卸载全链路、三个外部锚定守卫（插件 id、改名、皮肤降级）工作正常、npm 产物 47 个文件完整、文档一致性守卫真的拦住了我这次的断言数改动。

**但这次审计翻出了 5 个 CRITICAL**，其中 3 个是**真实的数据安全洞**（任意文件移动、文件损坏），2 个是**"验收网本身不可信"**（回归网测的是陈旧手抄公式、文献库不可复现）。

**一句话概括最严重的问题**：项目的测试体系守卫的是"grep 能看见的东西"（名字、数字、语法）与"良构夹具上的纯函数"，而这次翻出的四类缺陷——**信任边界**、**输入类上的性质**、**资源上限**、**CI 内的真实端到端路径**——恰好是它没有任何断言覆盖的四类；而且凡是它试图检查边界的地方，期望值往往是从实现自身推导出来的，于是检查在结构上就是空的。

## 2. 缺陷与改进：优先级队列

### P0 · 必修（安全 / 数据损坏，建议本周内）

| # | 严重度 | 问题 | 位置 | 影响 |
|---|---|---|---|---|
| 0 | **CRITICAL** | **`text.replace(fm, 替换字符串)` 把 agent 写的 frontmatter 当替换模板解释**：`$$`→`$`、`$&`→被匹配的整段、`` $` ``/`$'`→匹配前/后的全文 | `dsh/host/memory-admin.mjs:144-145`（applyFeedback）、`:89`（setCapturePolicyMode）、`:905`（setSessionCapture） | 一次 ✅/❌ 点击就**静默损坏记忆卡片**。本机精确复现（临时夹具）：`title: 关于 $$ 的表示` → `title: 关于 $ 的表示`；`$&` → 标题里插进整段 frontmatter（62→149 字节）；`$'`/`` $` `` → 文件被拼接成原内容的重复。**数学库里 `$$`（行间公式）出现在标题里是高概率事件**，而返回给用户的仍是 `{"ok":true,"已确认 ✅"}`。项目自己早就在 `scripts/build-obsidian.mjs:57-59` 为构建脚本规避过同一个坑（"Use replacement functions, not replacement strings"），产品代码没有 |
| 1 | **CRITICAL** | `/memory-panel/*` 全部路由**无鉴权、无 CSRF**，且**约束根由调用方指定**（`body.root`），`pathInside(root, join(root, rel))` 对任何不含 `..` 的 `rel` 都是恒真 | `dsh/host/math-memory-panel.mjs:84,89,91,107,114` | 用户浏览器里**任意网页**（`content-type: text/plain` 属于 CORS simple request，无预检）或本机任意进程，可移动/改名任意路径下的任意文件与目录、重写约束模型写入的记忆策略、触发全量会话库扫描。模型被 `workspace-write` 沙箱约束，**这个面完全没有沙箱** |
| 2 | **CRITICAL** | `archiveMemoryFile` 对源**不做任何校验**：非 `.md`、目录、甚至 vault 根都能被"归档" | `dsh/host/memory-admin.mjs:150-163` | 已复现：把普通笔记移走；把整个 `records/` 目录改名进 archive；尝试改名 vault 根（Windows 上 EPERM 挡住，换根/换文件系统会成功） |
| 3 | **CRITICAL** | `text.replace(fmMatch[1], fm)`：frontmatter 体为空时 `replace("", X)` **在偏移 0 插入**而非替换，且**返回成功** | `dsh/host/memory-admin.mjs:89`（setCapturePolicyMode）、`:144`（applyFeedback）、`:905`（setSessionCapture） | 已复现：`---\n\n---\nbody` 卡片被 `inapplicable` 动作写成 `"\nlast_not_applicable: 2026-09-10---\n\n---\nbody\n"`——分隔符跑到文件中间，卡片对所有消费者不可解析，而 UI 报"已记录"；捕获策略文件同样中招 |
| 4 | **CRITICAL** | **检索回归网测的是陈旧的手抄评分公式**：探针用 `0.85*BM25 + 0.10*cjk`，产品用 `0.75*BM25 + 0.10*cjk + 0.15*hookPrior`，且探针**从不调用** `isRecallEligible`（superseded/duplicate_of 排除）、operator 硬过滤、`maxResults` | 探针 `scripts/qa/engine-probe.mjs:48`、`seed-probe.mjs:53,63`；产品 `dsh/preset/note-tools.mjs:349-351,1099,1082` | 权重漂移有 git 证据：探针最后改动 `8f2f8de`(08-25)，产品权重在 `cc177da`(08-30) 改过。**唯一自动化的检索回归网对 hook prior 与纠错排除完全没有覆盖**——这正是 self-correction P1c 上线后无人看守的原因 |
| 5 | **CRITICAL** | **文献库不可复现**：`literature/.raw/`（19 PDF + 19 `full.md` + 589 图，51.87 MB）被 gitignore，而其唯一再生源 `D:\临时\agent记忆` 现在只剩 **4** 个条目 | `.gitignore:14`、`docs/literature.md:114`（仍把它记为待办且写 42 MB） | 仓库里的 19 篇双面文献库无法从任何现存输入重建 |

### P1 · 高价值修复（1–2 周）

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| 6 | HIGH | 对话索引 cache miss = **0.7–3.5 s 同步 zstd 解码**（真实 399 份 / 390 MB 库实测：miss 3516 ms / hit 92-99 ms），而**活跃会话本身占着一个指纹槽位**，所以每轮对话都会 miss | `math-memory.mjs:1878-1914`（`vaultSessionLogs` 仍在按解码后的内容过滤，见 §5 性能项） |
| 7 | HIGH | `sessionLogKey` 在边缘形状下会**合并两个不同会话**（"取第一个遇到的祖先目录名"，且 file-stem 兜底不可达；`stem()` 循环剥掉所有点分段）；已在默认布局的 399 份真实产物上验证**零碰撞**，但形状 C（产物父目录名本身是 `sessions`/`session`，即 `DSH_SESSIONS_ROOT` 指向的库根）可达且会静默丢会话 | `math-memory.mjs:352-371`；`memory-admin.mjs:560-579` |
| 8 | HIGH | `.v3.` 优先级**无条件**：若某会话恢复后只往 v2 追加（或备份还原了旧 `.v3.`），新消息对索引与捕获**永久不可见**，且捕获 marker 的 `lastSeq` 可能已是 v3 时代的序号，导致新回合被当"已见过"丢弃（SUSPECTED：本机仅一对且行为正常） | `math-memory.mjs:403-408` |
| 9 | HIGH | `check-embedded-loader.mjs` 的招牌不变量**是同义反复**：它比对的是自己那份 `return {...}` 名单，不是模板的。已用变异实验证明——从模板删掉 5 个被消费的符号，守卫仍 exit 0 | `scripts/check-embedded-loader.mjs:72,83-86` vs `obsidian/main.template.js:58` |
| 10 | HIGH | **接受记录无凭据**：文档称"引擎探针 12/12（合成 vault）"，实测对合成 vault 跑出 **0/12**（8 个期望路径里 7 个在夹具中不存在，探针也没有夹具回退）；文档称"E2E 8/8"，唯一提交的 8 用例 baseline 是 **7/8**，随后那 1 个用例被单独重跑成 1/1 | `README.md:86,95`、`docs/memory/benchmark.md:3`、`docs/changelog.md:69`；`scripts/qa/runs/run-2026-08-24T19-50-43-407Z/baseline.json` |
| 11 | HIGH | 基准**证据本身不可信**：硬编码 `dirty:false` 且 `startedAt === endedAt`（同一毫秒）；会话归档只保住 1/N 份日志（basename 碰撞，7 个 sessionId 成死链）；**token 计量恒为 0**（只读 V3 已移除的 `assistant/chunk` usage 事件）；**0 用例套件 exit 0** | `scripts/qa/e2e.mjs:216-241,249-260,76-91,264` |
| 12 | HIGH | 原生安装路径（`dsh-math-memory install` 默认路径）**从未被任何测试执行**；文档却声明"三种安装方式产出等价配置"；卸载的核心安全承诺（`uninstall --yes` 保留 `.deepseek/**` 内容）**无任何断言**；vault 模板 19 个目标只验证 3 个 | `scripts/test-installer.mjs:22,42-45,85-90` |
| 13 | HIGH | `npm run qa:e2e` 在 0.1.5 上**大概率跑不起来**：`e2e.mjs` 用"任何 200"判定就绪、且 `/api/*` **完全不带 token/cookie**；我实测 0.1.5 的 `/api` 无 cookie 一律 401（`requestRejection`：先 Host/Origin 403，再浏览器会话 401） | `scripts/qa/e2e.mjs:27-35,43-69,189,249` |
| 14 | HIGH | **版本号三方不一致且无门禁**：`package.json`/`package-lock` 0.7.3、`manifest.json` 0.7.4、README 0.7.3、CHANGELOG 顶部 0.7.4、npm registry latest 0.7.1（0.7.2/0.7.3 从未发布） | `package.json:3`、`manifest.json:4`、`CHANGELOG.md:25` |
| 15 | HIGH | `release.yml:23` 的 awk 抓的是**第一个** `## [` 段——即 `## [Unreleased]`，所以每个 GitHub release 的说明都是 Unreleased 块；且 **tag 触发的两个工作流都不跑测试、不校验 main.js 重建一致性** | `.github/workflows/release.yml:23`、`npm-publish.yml` |
| 16 | ~~HIGH~~ **已作废（2026-09-15 更正）** | **文档声明了不存在的安装方式**：README 让用户"在社区插件市场搜索 DSH Math Notes Assistant 安装"，而 `obsidian-releases` 的 7458 条目里没有 `dsh-math-assistant` | `README.md:51` / `README.zh.md:51` |
| 17 | HIGH | Obsidian 侧栏 iframe **在 0.1.5 下必然 401**（详见 §4） | `obsidian/main.template.js:889-896` |

### P1.5 · Obsidian 插件侧专项（第三路审计，均为实测）

> **⚠️ 更正（2026-09-15）**：§2 第 16 条的观察**已经作废**，而且它的**判据本身就是错的**。当时（2026-09-10）我用 `obsidianmd/obsidian-releases` 的 `community-plugins.json` 里没有 `dsh-math-assistant` 来判"未上架"。实测：**该文件至今（2991 行）仍没有本插件，但插件在架**——收录方式已经改变，`community-plugins.json` 不再是收录依据，现行依据是插件在 [community.obsidian.md](https://community.obsidian.md/plugins/dsh-math-assistant) 有页面。**因此 README 写「第三方插件 → 搜索安装」是对的**；反倒是 en 侧后来据此加的「Not in the community plugin browser yet」callout 是错的，本轮已改正。教训见 `handoff.md` 坑 78：**"某份清单里没有它"不等于"它不存在"**；日期化快照里的观察不能直接当现状引用。

这一组此前没有单独列出，因为它们集中在 `obsidian/main.template.js`（约 1800 行、**零自动化测试**、CI 完全看不见）。

| # | 严重度 | 问题 | 位置 | 证据 |
|---|---|---|---|---|
| P1 | **HIGH** | **LinkServer 对已经解码过的查询参数再解码一次**：`url.searchParams.get()` 返回的已是解码值，代码又 `decodeURIComponent` 一次；含 `%` 的路径（数学笔记里很常见）直接抛 `URIError`，且该语句在 `try` **之外**，异常逃出请求监听器——链接点击**永久挂起无响应** | `main.template.js:203-206`（/feedback）、`:256-257`（/open） | 本机复现：`?path=…%2050%25.md` → `searchParams`=`损失函数 50%.md` → 二次解码 `THREW URIError: URI malformed`（实测已证）。另外裸 `+` 会被 `searchParams` 变成空格 |
| P2 | **HIGH** | **`install-into-profile.mjs` 在所有随仓库发布的 patch 文件上静默 no-op**：它把 insert 锚在结尾的 `]`（flow 风格），而三个 patch 文件都是 block 风格、结尾没有 `]`，`replace` 原样返回后脚本仍写回文件并打印成功；若真遇到 flow 风格，插进去的 block 项还会产出**非法 YAML** | `dsh/client-panel/install-into-profile.mjs:58-62` | 实测：`dsh/profile/cordis.patch.yml`、`notes-assistant.patch.yml`、`dsh/cordis.patch.yml` 三个文件 `regex matched = false`。而这是客户端面板进 profile 的**唯一**途径（`handoff.md:79`） |
| P3 | **HIGH** | **`/memory-panel/workspaces` 无 `?root=` 就 400**：root 守卫在路由分发**之前**，而面板前端的 `fetch("/memory-panel/workspaces")` 不带 root → 工作区下拉框永远不渲染 | 守卫 `math-memory-panel.mjs:89-90` vs 前端 `dsh/client-panel/src/index.jsx:56` | 实测：不带 root → `400 {"ok":false,"error":"missing root"}`；带 root → 200。**修正我在 §4.1 的说法**：我此前报告"三个路由全部 200"是因为我给每个请求都带了 `root`——`workspaces` 这条实际不可达 |
| P4 | **MEDIUM** | **Windows 上 `shell:true` 导致 `child.kill()` 杀不掉真正的 dsh**：直接子进程是 `cmd.exe`，被杀的只有它，node 孙进程继续占端口；`stop()` 还先把 `this.child` 置空再杀、1500 ms 后不升级 | `main.template.js:509-515,553-564` | 本机复现：`after child.kill() -> direct(cmd): false | grandchild(node): true`（孤儿子进程确认存活）。附带 `DEP0191`：带空格的 `--patch C:\Users\…` 参数未转义会被拆断 |
| P5 | **MEDIUM** | **镜像 junction 的死链接既不修复也不上报**：`existsSync` **跟随**链接，悬空链接返回 false → `symlinkSync` 报 `EEXIST` → 被裸 `catch` 吞掉 | `main.template.js:820-832` | 这解释了 §2 里那 7 个死链接为何长期存在；症状正是这段代码要防的 `ERR_MODULE_NOT_FOUND`，且**无任何日志** |
| P6 | **MEDIUM** | **降级块该删不删、该留却删**：块只在"无 web profile"分支里被剥离，所以机器一旦降级过、之后有了 web profile，皮肤仍在笔记 profile 里被全局禁用；反过来 `readGlobalSkinIds` 读文件失败返回 `[]` 时会把已有块**剥掉**，可能让 profile 死在 `ERR_MODULE_NOT_FOUND` | `main.template.js:798-833,635-657` | 代码路径分析（SUSPECTED，未构造现场） |
| P7 | **MEDIUM** | **重启/停止与进行中的启动竞态**：`start()` 只按"有没有进行中的 promise"去重、不看代次，`stop()` 期间探测循环会跳出并立刻 `setStatus('error')` + 抛超时 | `main.template.js:459-467,535-548,566-570` | 用户点"重启服务"时会看到"启动失败"的 Notice，而服务其实是好的 |
| P8 | **MEDIUM** | **每次插件加载非原子重写 ~200 KB 共享文件**（`math-memory.mjs` 96 KB、`note-tools.mjs` 61 KB、patch overlay 等），而 dsh 子进程可能正在启动或已运行；读到撕裂文件即语法错误 | `main.template.js:79-84,756-771,709-718` | `writeFileSync` 先截断后写（语义分析；未构造并发现场）。同一类风险也在 `memory-admin.mjs` 的读-改-写与捕获 marker 全量覆盖 |
| P9 | **MEDIUM** | **`memoryPanelUrl` 未校验就交给 `shell.openExternal`**：该值存在 `<vault>/.obsidian/plugins/…/data.json`——**在 agent 可写的 vault 内** | `main.template.js:1375-1385` | 非 `http(s)` scheme（`file:`、自定义协议）会被交给 OS 执行，构成一个低成本的启动原语 |
| P10 | **LOW-MED** | **dsh 探测在 CJK 用户名下会乱码**：`where dsh` 输出按 UTF-8 解码，实测出现 U+FFFD；且 `parseLauncher` 接受 `$basedir/...` 这类**不存在**的脚本路径（无 `existsSync` 校验） | `main.template.js:318-337,348-365,372-376` | 实测：`where` 原始字节是 GBK 的 `小新`，UTF-8 解码后含替换字符；`$basedir` 路径在磁盘上不存在 |
| P11 | **LOW-MED** | 健康检查是"端口上有东西应答就算好"（401 也算，`statusCode < 500`），且 45 s 窗口过后**永久 error、不再重探** | `main.template.js:95-113,535-548` | 这正是 §4.1 里"状态栏说就绪、侧栏是 401"的机制 |
| P12 | **LOW-MED** | `keepAliveOnUnload` 下链接必然失效：存活子进程留着**旧**的 `DSH_OBSIDIAN_LINK_URL`（临时端口）与旧 token，新实例又铸了新 token 且因端口探测通过而**从不重启服务** → 之后的 `/open`、`/feedback` 全部 403 | `main.template.js:490-505,272-280,450-455` | 供 agent 用的链接会静默失效 |
| P13 | **LOW** | 生命周期卫生：autoStart 的 `setTimeout(…,1200)` 从不清理；`onunload` 不 await `stop()`；`render()` 可在已 detach 的视图上跑（会重建 iframe）；`MemoryPreviewModal` 又走一次 `window.require('electron')`；`appendLog` 按 chunk 切行导致跨 chunk 的 CJK 字符变 U+FFFD；端口框 `parseInt` 使 `3180abc` 静默变 3180；`loadSettings` 不做逐键类型校验（`"enableSkinCenter": "true"` 字符串会让皮肤中心静默关闭） | `main.template.js:1455,1543-1555,926-928,1000-1009,416-422,1584,1536,677` | 代码路径分析 |
| P14 | **LOW** | 客户端面板质量项：`setQ(q === "" ? " " : "")` 是个依赖宿主把字段用空格拼接的 refetch hack（宿主一改就白屏，且搜索框里会留一个空格）；`tick` state 设了从不读；`cap === null` 时开关渲染成**已勾选**而服务端默认是关；`locale.register` 的两参调用方式与 0.1.5 的两种重载都不匹配（要么注册进一个垃圾 locale id，要么抛进空 catch）；`useJson` 无 abort/陈旧响应保护 | `dsh/client-panel/src/index.jsx:89,108,50,107,124,166` | 代码路径分析 + 与安装的 0.1.5 locale 实现比对 |
| P15 | **LOW** | `scripts/build-obsidian.mjs` 只 gate"每个 `dsh/templates/*.md` 都在 manifest 里"，**不** gate"模板读取的每个 `EMBEDDED_*` key 都存在"——key 打错会在用户 vault 里以 `ERR_INVALID_ARG_TYPE` 爆炸，CI 全绿 | `scripts/build-obsidian.mjs:43-54` | 我手工交叉核对当前 key：都能解析（现状安全） |

**这组里最该先修的三条**：P0 表的第 0 行（`$` 替换字符串，一行修法）、P1（二次解码，删两个调用 + handler 包 try/catch）、P2（patch 写入，改成解析 YAML 后断言包含包名）。三条都是小改动、零架构风险、直接消除静默损坏。
- **LOW** 仓库卫生：`docs/promotion/推文-0.7.1.md`（三个版本前的推广稿）；`docs/dsh-0.1.5-adaptation.md`、`docs/session-scope.md`、`scripts/check-embedded-loader.mjs` 被多处引用但**未 `git add`**（新克隆会引用到不存在的文件）；文献库机器路径写进 `.manifest.json`；`docs/changelog.md` 与 baseline 里嵌了本机路径

### P2 · 中优先级（技术债，按需）

- **MEDIUM** 皮肤中心双挂载冗余（行为无害，属文档/默认值问题，见 §3 决策 1）
- **MEDIUM** junction 镜像只增不删：notes-assistant profile 里现有 **7 个死链接**（`dsh-web-ui-all`、`dsh-perf`、`dsh-desktop-launcher`、`dsh-skins`、`dsh-chat-recovery`、`dsh-client-ui-aionui-panel`、`dsh-client-ui-session-id`）
- **MEDIUM** 捕获策略 `field` 未转义进 `new RegExp("^" + field + ":")`：`a.c` 会改到无关行，`idea|fact` 会同时毁掉两个真实键（`memory-admin.mjs:60,45`）
- **MEDIUM** `archiveOldEpisodes` 记录的名字不是它实际写出的文件（suffix 先自增后建名），第二次运行产生孤立链接（`memory-admin.mjs:189-198`）
- **MEDIUM** 笔记文本缓存只看 `mtimeMs+size`：同刻同尺寸改写会长期返回旧内容（`note-tools.mjs:197-227`）
- **MEDIUM** 面板 badge 的 `countUncapturedSessions` 实测冷启 1089 ms / 热 179-204 ms，且在 Obsidian 渲染进程主线程
- **MEDIUM** `check-skin-fallback.mjs` 只认一种 YAML 写法；只查一个 patch 文件
- **MEDIUM** 生成物无再生成门禁：`dsh/client-panel/lib/client.js`、`scripts/qa/runs/**`、`literature/.index.json`（`main.js` 是唯一有门禁的）
- **MEDIUM** `npm publish` 把**中文 README** 作为包主页（`readmeFilename: README.zh.md`）
- **MEDIUM** `docs/installation.md` 多处引用代码里不存在的输出/标记（`# dsh-math-memory:begin` 等）
- **MEDIUM** 文献库状态自相矛盾：`literature/index.md` 19 篇全标"未读"，19 张卡片全标 `distilled`，且每次导入都会重现（`lit-import.mjs:426`）
- **MEDIUM** `mergeBib` 只比 key 不比内容：修正过的 BibTeX 条目永远无法覆盖旧条目
- **MEDIUM** CI 仅 Linux，而项目 Windows 优先（`install.mjs:240` 等平台分支无人执行）；CI 不跑 `npm ci`
- **MEDIUM** 无 `versions.json`（Obsidian 在 `minAppVersion` 高于客户端时查它）
- **LOW** `GET /memory-panel/workspaces` 不可达（所有路由都强制要 root）；`note_search` 的 `title` 返回路径；`note_recall` 带 `tag` 时静默清空记忆层；`kindLabel` 缺 `strategy`；`findSessionLogs` 无符号链接环保护；`HOOK_SCHEMA_VERSION` 不参与缓存失效；zstd 校验和被跳过且失败帧静默 `continue`

## 3. 四项待决策：优劣与推荐
### 决策 1 · Obsidian 侧 `enableSkinCenter` 默认值

**现状**：本机 `data.json` 里 **`enableSkinCenter: true`**（是开着的），皮肤实际生效。

| 选项 | 优 | 劣 |
|---|---|---|
| A. 保持默认 false（现状） | 默认零依赖：没有 `web` profile 也能干净启动；与 `check-skin-fallback` 守卫一致 | 想用皮肤中心要手动开一次（但本机已开） |
| B. 默认 true | 开箱即用 | 默认路径依赖"web profile 里存在两个 `@linxin666` 包"；包被移走时**静默不生效**（不崩，但用户不知道） |
| C. 删除这个开关 | 少一个概念 | 丢掉"只有皮肤包、没有聚合包"机器的唯一入口 |

**推荐：A（保持默认 false），并把开关文案改成「挂载皮肤中心 UI（聚合包已自带，通常无需开启）」**。理由：0.3.20 起聚合包自带皮肤中心，本机这个开关在功能上冗余；它的真实价值只在非常规部署（有皮肤包无聚合包）下成立，属于高级选项而非默认。**同时要写清一个容易误解的点**：关掉它**不会**关掉皮肤——皮肤本体由全局 `$DSH_HOME/cordis.patch.yml` 注入 + junction 镜像解析，Obsidian 侧 web UI 照样跟着全局皮肤走；这个开关只管"要不要那个选择器 UI"。

### 决策 2 · `syncGlobalPackageLinks` 的死链接清理

**现状**：只建不删，已有 7 个死链接（换包名/退役子插件留下的）。

| 选项 | 优 | 劣 |
|---|---|---|
| A. 只在 deploy-local 里清一次 | 不引入常驻风险；立刻清爽 | 下次升级又会积累 |
| B. 让 `syncGlobalPackageLinks` 幂等（镜像存在的 + 删指向不存在目标的链接） | 自愈 | 删错链接会让皮肤/插件解析失败（需要 `lstatSync().isSymbolicLink()` + 目标存在性双重校验，且失败必须继续而非中断） |
| C. 不管 | 零风险 | 7 个死链接会继续误导排查（本次审计就差点被它带偏） |

**推荐：B，但按保守规则实现**——只在 `lstatSync().isSymbolicLink() === true` 且 `realpath` 不存在时才删（绝不递归删目录）；单条失败 continue；先只对 `@linxin666` 作用域生效。理由：这正是"降级块/junction 镜像"设计的既有意图（它已经在做"只在必要时镜像"的判断），补上"清理"是同一逻辑的闭合；风险可控且可回滚（最坏情况重开插件会重建链接）。

### 决策 3 · V3 头部新增的 `origin: "subagent"` 是否用来过滤子代理会话

**现状**：所有 cwd 在 vault 内的会话都会被捕获进 episodes 并进对话索引，**包括子代理会话**。

| 选项 | 优 | 劣 |
|---|---|---|
| A. 不过滤（现状） | 证据完整；不丢任何对话 | 同一段对话被存多份（子代理继承父会话前缀），episodes 与注入预算被稀释；实测子代理日志已达 488 KB 量级 |
| B. 显式过滤 `origin === "subagent"` | 去重、省预算、语义正确（子代理是执行细节，不是用户对话） | V2 日志没有该字段 ⇒ 只能对 V3 生效（行为不完全对称）；若用户确实想留子代理问答则会失望 |
| C. 参数化（默认过滤，留开关） | 两边都满足 | 多一个配置项与文档面 |

**推荐：C（实现成本 ≈ B + 一个布尔配置，默认"过滤"）**。理由：过滤是更正确的默认（避免同一对话重复入库），但"要不要留子代理痕迹"是使用偏好而非对错，因此给一个开关比替用户拍板好。实现上只读 V3 头部的既有字段，零额外 IO（头部本来就要读）。

### 决策 4 · `episodes/index.md` 在检索里的权重

**现状**：`episodes/index.md`（37 行 / 3562 字节，列出全部 32 篇 episode 的标题+主题）被 `classifyVaultDoc` 当成普通文档进入检索语料。真实 vault 探针实测它 **score 0.95 / coverage 0.86**，把"库里没有答案应给弱信号"这条控制项直接顶掉（第 3 项失败），并在另外两项里进前 2/4。

| 选项 | 优 | 劣 |
|---|---|---|
| A. 维护 ground truth（按探针文件头要求） | 不动产品代码 | 治标：一个导航文件继续压过知识笔记，真实使用里就是错的（模型会先读到索引而不是证据） |
| B. 把 `index.md`/`_README.md` 这类脚手架排除出 note_recall 语料 | 一处小改，语义正确（`buildAuditReport` 早就有 `AUDIT_CARD_SCAFFOLD` 这个集合，note-tools 只是没用）；顺带修好控制项 | 会改变召回结果 → 需要重跑探针并更新 ground truth（预期会变好） |
| C. 只降权 | 折中 | 引入第二个可调权重，长期更难解释 |

**推荐：B**。理由：episodes 索引与各层 `index.md` 是**导航**，不是证据；把它们排除出召回语料与项目自己的"导航层进 prompt、内容按需拉取"设计是一致的（项目已经用 `AUDIT_CARD_SCAFFOLD` 表达了同一判断）。实施时同时更新 `docs/memory/design.md` 的检索契约与探针 ground truth。

## 4. dsh 0.1.5 升级带来的行为破坏（两条，都影响日常使用）

### 4.1 Obsidian 侧栏 iframe 必然 401（**当前最影响体验的问题**）

- 0.1.5 的 web carrier 强制浏览器会话鉴权：`requestRejection` = 先 Host/Origin 栅栏（403），再浏览器会话校验（401）；**`/api/*` 与根路径一视同仁**，无例外。
- 实测（换端口 3201）：裸 root → **401**；`/?token=<启动 token>` → **303 + Set-Cookie `dsh-auth-<sha256(authority)>`**；带 cookie → **200（含 `__DSH_BOOT__`）**；`/api` 无 cookie → 401。
- 插件把 iframe `src` 写死为裸 `http://127.0.0.1:${port}/`，且**全插件不消费 token**（`?token`/`authenticatedUrl`/`dsh-auth` 命中数为 0）；子进程 stdout 只进内存日志（600 行环形缓冲）。就绪判定是"端口有响应即 running"，所以状态栏会显示「服务已在端口 3180 就绪」而侧栏里是那行英文 401。
- **修复方向**：解析子进程 stdout 里的 `?token=`，先用一次 `fetch(tokenUrl)` 让 Electron cookie jar 种下 cookie，再把 iframe 指向干净 root；或直接把 iframe 指向 tokenUrl（303 后落到干净 `/`）。cookie 绑定 `host:port`，改端口需重新种。顺带把"就绪"判定改为"能取到已鉴权的 `/`"。

### 4.2 会话独占锁：同一会话不能被两个进程同时打开

0.1.5 为每个会话加写锁（Windows = 命名内核信号量 `Local\dsh-session-lock-<sha256(路径小写)>`，零超时等待；POSIX = `flock`），冲突抛 `SessionAlreadyOwnedError`。对"3080 主实例 + 3180 笔记实例共用同一 `$DSH_HOME`"的方案意味着：同一场会话不能在两边同时打开。记忆侧不受影响（只读日志文件）。

## 5. 为什么 138 条断言 + 4 个守卫 + 文档门禁没抓到这些（元分析）

**结构性缺口有四类**，各对应一个缺陷族：

1. **信任边界无人守**：仓库里所有断言都是关于**值**的，没有一条是关于**权限**的；没有任何测试调用过一条路由。最讽刺的是同一个仓库里 Obsidian 侧的 `/feedback` 有 CSRF token 校验（`handoff.md:75` 还写着"防护必须双端接线"），而 host 侧路由**从不读** `DSH_OBSIDIAN_FEEDBACK_TOKEN` —— 两个 loopback 面用了两套鉴权模型，且没有任何东西断言它们一致。
2. **自指式 oracle（真正的病根）**：写一个守卫函数，再喂给它一个**由被检查对象自身推导出来**的期望值。已证实的实例：`check-embedded-loader`（比对自己的名单）、`math-memory-panel` 的 root（攻击者同时决定两端）、`test-memory.mjs` 的 `sessionLogKey` 断言（照抄实现假设的字面量）、`test-installer.mjs:96`（断言一个安装器从不创建的路径不存在，永不可能失败）、`check-doc-consistency`（断言数来自源码正则计数而非"真跑了几条"）。对照之下，**能工作的守卫都是对着外部锚点比对的**（`check-plugin-id` 比 manifest 的 id、`check-rename` 比安装目录名）。
3. **"E2E"标签下其实是单元测试**：真正自动化跑的端到端只有安装器测试；`scripts/qa/e2e.mjs` 需要三个环境变量、烧真 token、且**不在任何 CI 里**；而探针把评分公式手抄了一份。
4. **CI 只 gate 两件事**：`main.js` 可字节重建 + 一条 20 命令的 `&&` 链退出 0。tag 触发的 release/publish **完全不跑测试**；CI 仅 Linux，而项目 Windows 优先。

**最小补充检查（每类一条，总约 100 行）**：
1. 路由授权测试（stub `webServer`，喂越界 root / `..` / 非 loopback / 目录 rel → 断言非 2xx）+ 对每个导出写函数做"目标越出记忆树必须被拒"的表驱动测试；
2. 写入器变异往返性质测试：夹具矩阵 {空 frontmatter、无尾换行、CRLF、无 frontmatter、重复键、CJK 值} × 每个写入器 → 断言"仍可解析 + 只改了目标键"；
3. 断言 IO 次数而非毫秒（给解码器加计数器）：热路径 0 次解压、无关回合不改变指纹；
4. 分区性质而非字面量：生成目录树，断言 `#distinct(sessionLogKey) === #distinct(会话目录)`。

## 6. 建议的推进顺序

1. **P0 安全三连 + 一行修法**：把 root 从请求里拿掉（改成只从 `ctx.workspaceRegistry`/配置取）、所有 POST 加 token、`archiveMemoryFile` 加"必须是 `.deepseek` 下的 `.md` 文件"、写入器改成按偏移量拼接、`replace(fm, () => fm)`；顺带 P1/P2/P3 三条小修（二次解码、patch 写入、workspaces 路由顺序）。
2. **修好"验收网自己"**（#4/#9/#10/#11）：探针改为调用产品评分函数；`check-embedded-loader` 读模板真实名单；重跑并如实记录接受结果；基准脚本修 `dirty`/时间戳/归档/token 计量/0 用例。
3. **0.1.5 收尾**（§4）：iframe token 自举；文档补会话锁说明；把 4.1 作为"升级后必须手测"的第一条写进 testing.md。
4. **P1 其余**（#6/#7/#8/#12–#17）。
5. **四项决策落地**（§3：A / B / C / B）。

## 7. 复核命令（把本文结论重现一遍）

```powershell
npm test                                   # 138/138 + 安装器 e2e + 四守卫 + 文档一致性
$env:DSH_OBSIDIAN_VAULT="D:\Obsidian笔记数据库"; npm run qa     # 合成 8/8；真实 9/12（3 项见 §3 决策 4）
node scripts/build-obsidian.mjs            # 再跑一次 → 与已提交 main.js 字节一致
dsh --profile notes-assistant --port 3199 --host 127.0.0.1 --no-open   # 换端口冒烟，不动 3080
curl "http://127.0.0.1:3199/memory-panel/session-capture?root=D%3A%5CObsidian%E7%AC%94%E8%AE%B0%E6%95%B0%E6%8D%AE%E5%BA%93"
git status --porcelain                     # 注意 references-but-untracked 的三个文件
```
