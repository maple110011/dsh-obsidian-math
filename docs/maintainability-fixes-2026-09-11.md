# 可维护性审查落地台账（2026-09-11）

> **状态**：`review` · 对应审查报告 [`maintainability-review-2026-09-11.md`](maintainability-review-2026-09-11.md)（该报告是**只读审计**，按当时 HEAD `fad0144` 写成，不改动）
> **版本**：仍为 **0.7.5**，**未发版**——发版是维护者的动作
> **本轮结果**：`npm test` 从「受限环境下 2 处红 + 静默跳过 16 个门禁」变为 **29/29 全绿**；新增 5 个守卫、1 个门禁汇总器、1 个仓库维护协议

本文件只做一件事：让报告里每一条发现都能追到**状态 + 证据**。报告说「哪里有问题」，这里说「改没改、凭什么相信改好了、还剩什么」。

## 1. 状态总览

| 严重度 | 总数 | 已修 | 部分 | 未做 |
|---|---|---|---|---|
| P0 | 4 | 3（P0-0/1/2） | 1（P0-3：加了守卫，去重留作目标态） | 0 |
| P1 | 8 | 6（P1-1/3/4/6/7/8） | 1（P1-2） | 1（P1-5） |
| P2 | 11 | 8（P2-1/2/4/5/8/9/10/11） | 3（P2-3、P2-6、P2-7） | 0 |
| P3 | 1 组 | 部分（构建日志字节数） | — | 若干小项 |

第二轮（同日）翻掉的：**P1-6**（frontmatter 单一事实源 + 守卫）、**P2-5**（`schemaVersion` 读侧生效）、**P2-7**（死代码 + 捕获路径静默失败）、**P2-6** 第一项（`pathIsInside`/`pathInside` 统一）。第三轮：**P2-4**（全仓文档漂移排查 + 改名守卫）、**CHANGELOG `[0.7.5]` 重编**（只留事实，叙述移入 `docs/changelog.md`）。第四轮：**P2-8**（环境变量单一参考 + 双向守卫；门禁 29 → **30**）。第五轮：**P2-2 的第一半**（发布面钉住 + 扫描）+ **反馈 token 半途改名的收尾**（门禁 30 → **31**）。第六轮：**P2-2 的第二半**（用户可见面里那条示例 vault 路径——见该行「更正」）、**P2-1**（语义常量归一到代码）、**P2-11**（把"8/8"改成证据支持的说法）（门禁 31 → **32**）。

> **⚠️ 关于"已验证"的一次自我更正（第六轮）**：第五轮我把 P2-2 记为 ✅，依据是"唯一硬编码本机路径在 gitignored 的 `deploy-local.mjs`"——**但那是另一个问题**。审查报告 P2-2 的证据其实是**用户可见文档里的示例 vault 路径**（`README.md:66` 等处的 `D:\Obsidian笔记数据库`），我当时没有回去读报告的原文，只是凭条目名推断，于是"修了一个相邻但不相同的问题"还打了勾——**这正是 P2-11 描述的那种失败模式（验收声明超出已提交的证据），我自己又犯了一次**。第六轮已按报告原文修复，并把"读原文再定范围"写进 `docs/changelog.md`。

未做项**全部**登记在 [`docs/handoff.md`](handoff.md) §7（该仓库唯一的「未做」权威清单），不是口头承诺。

## 2. 逐条台账

### P0 —— 全部处理

| 编号 | 发现 | 状态 | 证据 |
|---|---|---|---|
| **P0-0** | （安全）面板在**未配置环境变量**时把请求方自带的 `root` 当作约束根，下游 `pathInside` 两端都由调用方决定 | ✅ 已修 | 锚改为「环境变量 ∪ `ctx.workspaceRegistry`」，两者都空则拒绝一切带 root 的请求。`node scripts/test-panel-routes.mjs` → **44/44**（本次新增 5 项含「未配置 + 空注册表 → 403 且文件未被移动」；P2-9 又补 9 项）。**变异验证**：还原旧逻辑 → 新断言失败并报 `status: 200`（确实把卡移走），恢复后哈希一致 |
| **P0-1** | 仓库根无 `AGENTS.md`；唯一的 `AGENTS.md` 是**装进用户 vault 的教学协议**，却被 harness 当作仓库指令自动注入 | ✅ 已修 | ① 新增仓库根 `AGENTS.md`（产物/文件地图/五条铁律/验证纪律/记录纪律/陷阱）；② `dsh/templates/AGENTS.md` → `vault-AGENTS.md`，安装名仍由 `templates-manifest.json` 映射为 `AGENTS.md`。**实测**：根协议被自动注入，vault 协议**不再**被注入。`node scripts/test-installer.mjs` → 全部通过（含改名后的漂移断言） |
| **P0-2** | 受限环境里 `npm test` 必红、假失败与真回归无法区分；`&&` 链静默跳过 16 个门禁；`check-doc-consistency` 报 **18 条假「文档漂移」**；`__CHECKS__` 分母手写 | ✅ 已修 | `run-node.mjs` 用**真实文件描述符**代替管道（对照实验：`pipe → EPERM/stdout 空`，`file fd → status 0/输出完整`）；`run-gates.mjs` 全跑再汇总；doc-consistency 三态；`check()` 内计数。**`npm test` → 28/28 全绿**（原 2 红 + 跳 16）；文档同步为 35 路由 / 32 反代 / 8 握手（原 30/31/7） |
| **P0-3** | 记忆引擎双份实现（21 个同名符号），唯一同步机制是一句注释 | ◐ 守卫已加，去重未做 | 新增 `scripts/check-engine-sync.mjs`：钉住共享清单、按**词法流**比对（忽略注释/引号/`export`/空白）、要求「一致或有记录的偏离」（现 **15 一致 + 6 有据偏离**），反向也管（已登记的偏离若已一致同样失败）。**变异验证**：改宿主副本一个字符 → 失败。**彻底去重**（抽共享模块）登记在 §7 |

### P1

| 编号 | 发现 | 状态 | 证据 |
|---|---|---|---|
| **P1-1** | 出厂模板 `capture-policy.md` 说 `sessionCapture` **默认开**，代码与 `config.md` 都是默认关 | ✅ 已修 | 改为默认关（并说明开启位置）；`main.js` 已重建，`check-bundle-freshness` 通过 |
| **P1-2** | 6 处文档状态/版本与自身内容矛盾，其中 3 处落在 agent 首读路径 | ◐ 部分 | 已修：`handoff.md` 的「版本 0.7.2」→ 明确当前版本标记 + 把 0.7.2 还原为**历史时点**；`design.md` 去掉过期的 `v0.6.x`；`strategy-layer.md`「提案（未实现）」→ 已实现（并点明 §11 仍 2 项待定）。**并加了机制**：活文档用精确标记行 `> 当前版本：x.y.z`，由 `check-version-consistency.mjs` 与 `package.json` 比对（**变异验证**：改成 0.7.2 即失败）。其余状态矛盾未逐一复核 |
| **P1-3** | 最大、也是用户真正安装的文件（`main.js` 呈现层）零自动化测试 | ✅ 已修（**不必起 Obsidian**） | `MemoryView` 把决策留在四个**纯**方法里（`layerEntries` / `pendingItems` / `cardMeta` / `trendText`，入参出参都是普通数据），DOM 调用都在它们的**调用方**。新增 `scripts/test-panel-present.mjs`（第 33 个门禁）：**从 `main.template.js` 的源码文本里提取这四个方法并求值**——测的是**真源码**而非副本，且接缝被改名/挪走会**报错**（"extraction moved；update this test"）而不是静默不测。覆盖 20 项：五层渲染与缺字段降级、无 `layers` 时的 records+templates 回退、「⚠️ 待处理」的计数规则（`decisions.total` 更大时胜出、**过期的更小 total 不得隐藏已列出的行**、sections 缺失时整块不显示）、卡片元信息的**分段与顺序**（含"无 hook 块也必须显示徽标"、"`harmed: 0` 不显示倒忙段"）、趋势（<2 点或全 0 不显示、只保留**最后 5 点**、非对象项忽略）。**变异验证两项**：把计数规则改成"declared 无条件胜出" → 精确失败（`total=1`）；把 `cardMeta` 改名 → 提取阶段即报错。**测试当场抓到一个真实缺陷**：可选字段用的是 `!== ''` 守卫，`undefined` 会漏过去并渲染出字面文本 `上次 undefined` → 已改为 `typeof === 'string' && !== ''`，并新增一条"残缺卡片不得渲染 undefined"的断言 |
| **P1-4** | 提交进仓库的构建产物 `client.js` 没有任何再生成门禁 | ✅ 已修 | 新增 `scripts/check-client-bundle.mjs`：与一次全新构建**逐字节比对** + 形状检查。`build-client.mjs` 重构为导出 `buildClient()`，守卫复用同一份 esbuild 配置（避免第二份配置漂移）。本机 esbuild 子进程被环境禁止 → 按 SKIP 报告并仍做形状检查 |
| **P1-5** | 巨型函数：`buildAuditReport` 582 行等 | ❌ 未做 | 登记在 §7 |
| **P1-6** | frontmatter 有 6 个各自为政的解析器 | ✅ 已修 | 那个划边界的正则原本**复制了 15 处**（`math-memory.mjs` 12 / `memory-admin.mjs` 1 / `note-tools.mjs` 2），现在**全部归零**：规则搬进 `dsh/preset/hook-frontmatter.mjs`（`frontmatterSpan`/`frontmatterBlock`/`readFrontmatter`/`stripFrontmatter`/`replaceFrontmatter`/`replaceFrontmatterBlock`），6 个解析器保留各自**字段**解析（它们本来就解析不同字段，那部分是正当的）但共用边界判断。宿主树**不能 import** 它（Obsidian 的 `new Function` 注入绑定、不解析 import），所以 `memory-admin.mjs` 留**一份**拷贝，由新守卫 `check-frontmatter-source.mjs` 做**行为等价**校验（13 个 fixture，含空 body / CRLF / 行尾空格 / 无尾随换行 / `$$`+`$&` / 非首块 / 未闭合 / `---body` 无换行）。另外把「hook 解析器在插件里还能用吗」补进 `check-embedded-loader.mjs`（此前**零覆盖**，而这正是面板每次读卡都走的路）。**变异验证 4 项**：① 任一文件重写正则 → `[COPY]` 报出文件:行；② 宿主丢掉行尾空格容忍 → 等价校验失败；③ 宿主改闭合规则 → 报出 `shared={…} host=null`；④ 改坏 hook 块解析 → 「no longer parses a hook block」。`npm test` **29/29**（新增第 29 个门禁）；记忆回归仍 **240/240**（说明 15 处替换是行为保持的） |
| **P1-7** | `__CHECKS__` 分母手写，文档计数守卫锚在自报数上 | ✅ 已修 | proxy 自报 31→**实际 32**，auth 自报 7→**实际 8**；两套件改为 `check()` 内计数。文档锚点随之修正 |
| **P1-8** | QA 探针的环境变量优先级**与产品相反**，可能在给另一个 vault 打分 | ✅ 已修 | `engine-probe.mjs` / `e2e.mjs` 改为与产品一致的 `DSH_WORKSPACE_ROOT ?? DSH_OBSIDIAN_VAULT`，并写明理由。全仓 grep 确认只有这两处相反 |

### P2

| 编号 | 发现 | 状态 | 证据 / 说明 |
|---|---|---|---|
| **P2-1** | 同一事实有多个互相矛盾的数字 | ✅ 已修 | 逐条对代码取真值并改文档：① **笔记工具数** README 中英写「四个 / four」而 `note-tools.mjs` 注册 **5** 个（含 `note_strategy`）→ 改为五个并列出工具名；② **捕获默认值** `design.md` 写「默认 ask/ask/ask」而 `DEFAULT_CAPTURE_POLICY` 是 `structure: auto` → 按代码改写并说明为何 `structure` 默认 auto；③ **论文数**（曾被写出 14/15/19/20 四个版本）→ 改为**单一来源**：`docs/literature.md` 是唯一陈述处（现 20 篇，与 `literature/.raw/` 20 个目录一致），`handoff.md` 的四处复述改为指向它、历史数字标注「当时」；④ **默认值变更版本**：`0.7.4` 与 `0.7.5` 两说并存 → 用 `git log -S` 定位到引入提交（`cc177da` 2026-08-30，0.7.3 引入）与改动提交（`75422f6`，**把 0.7.4+0.7.5 打成一个提交、且 0.7.2–0.7.4 从未打 tag**，所以无法用 tag 复核）⇒ 采信**发布时写下的 0.7.4 条目**，把两处「0.7.5 起」改掉。**并加守卫** `check-doc-constants.mjs`（第 32 个门禁）：把**语义常量**锚到代码——笔记工具数由 `note-tools.mjs` 的注册数推出、论文数由 `literature/.raw` 目录数推出（`.raw` 是 gitignore 的语料，缺失时**声明 SKIP** 而非静默通过）；措辞变了导致解析不到锚点也**算失败**（否则锚点会腐烂成装饰）。**变异验证三项**：README 改回 four、design.md 改七个、literature.md 改 21 篇 → 各报出精确差异 |
| **P2-2** | 用户可见文档里残留维护者本机路径 | ✅ 已修（**第六轮，含一次自我更正**） | 报告原文的证据是**示例 vault 路径**：`README.md:66` / `README.zh.md:64` 的安装示例、`ARCHITECTURE.md:23` 的架构图、`docs/installation.md:124` 的 dry-run 输出里都写着 `D:\Obsidian笔记数据库`（npm README 是包主页，读者是陌生人）。已全部改为占位符（`<path-to-your-vault>` / `<你的 vault 路径>` / 「工作区根」/ `<vault>`）。**缺口也补了**：`check-release-paths.mjs` 原先只认英文目录名（`Users`/`Documents`/…），因此**漏掉了 `D:\Obsidian笔记数据库`**——现在增加「**具体的盘符路径**」规则（`X:\` 后紧跟占位符标记 `< $ % * …` 才放行），**变异验证**：把 README 那行改回原样 → 立刻报 `README.md:66`。**⚠️ 第五轮我按条目名推断、没读报告原文，把"发布面钉住"当成 P2-2 打了勾**（详见下方更正说明）——这条与 P2-11 是同一种失败模式 |
| **P2-3** | 必读路径 ≈40K token，交接文档接近「读不完」 | ◐ 部分 | 已给**短入口**（根 `AGENTS.md` 的三十秒速览 + 文档路由表，agent 不必先读 40K）；文档**体量**未减 |
| **P2-4** | 活文档引用已改名的模块/事实 | ✅ 已修 | 第三轮（2026-09-11）做了一次**全仓文档漂移排查**：① 产品名 `dsh web ui` → `dsh web`（README 中英/ARCHITECTURE/handoff/testing/design/control-panel/模板 `config.md`/插件与 profile 注释），插件家族改称可核对的包名 `@linxin666/dsh-web-all` + `dsh-client-ui-*`（**先读本机 `profiles/web/package.json` 取事实**）；② `obelisk-comparison.md` 里 P2-6 改名后遗留的 `pathIsInside`；③ `docs/archive/REFACTOR-PLAN.md` 横幅「Phase 4 未做」改为按事实区分（面板已换形态交付，未做的是自挂 DOM 列），同处「15 个模板」改为不写数字；④ `dsh-0.1.5-adaptation.md` 状态「实施中」→ 已实施；⑤ `dsh-panel-research.md`（快照）加日期化更正块。**并加守卫**：`check-rename.mjs` 第二条规则禁止活文件再出现旧名（排除真实退役包名 `dsh-web-ui-all`），历史档案须以「路径 + 理由」白名单豁免。**变异验证**：README 改回旧名 → 报出 `README.md:9` |
| **P2-5** | schema 版本常量三个兄弟里有一个是死的（`AUDIT_SCHEMA_VERSION` 只写不读） | ✅ 已修 | 读侧真正读它了：`memory-admin.mjs` 声明 `AUDIT_SCHEMA_VERSION_MIN/MAX`（1..2，与写入侧常量同一范围）并新增 `auditSchemaVersionOf`；`readAuditReport` 对**范围外**的报告返回 null（fail-closed，不再半解析）；`legacyAuditSummary` 的 v1 路径（无字段 = v1）保持可用。5 项新断言（含「无字段按 v1」「范围与写入侧常量一致」「更新的报告被拒」）。**变异验证**：删掉范围判断 → 「更新的报告被拒」立刻失败 |
| **P2-6** | 同一概念多份会各自漂移的定义（verified→权重阶梯 ×3、捕获策略默认值 ×4、vault 根解析 ×4、日期格式器 ×5、`pathIsInside` vs `pathInside`） | ◐ 部分 | `pathIsInside`/`pathInside` **已合并**（preset 侧改名 + 宿主侧补上类型守卫 ⇒ 两份现在逐 token 相同，并由 `check-engine-sync.mjs` 覆盖，**变异验证**：改一个字符即失败）。其余 4 类未动（登记 §7） |
| **P2-7** | 死代码与空 catch | ◐ 大部分 | 死代码：`MEMORY_SCAFFOLD_FILES`、`RETRIEVE_TARGETS` 已删（各自先 grep 确认零读取方；后者删后同修 `strategy-layer.md` 那句「改常量就能加取值」的假承诺）。`DSH_MATH_MEMORY_ENABLED` 确认从未实现，已在 `docs/archive/REFACTOR-PLAN.md` 就地加状态更正（该文件本身已标注「已退役」）。捕获路径静默失败：preset 与 host **两份**都改为返回 `warnings`（索引行读回校验、marker 写入、逐会话落盘），并顺带修掉「索引写失败导致整个会话重试、从而**重复追加**同一段对话」的潜在缺陷；8 项新断言（含「成功时不得有警告」）。**报告此处有 1 条过期**：`:1294` 的 stats 重置**已经**记录 `statsResetFailed` 并进入 `warnings`，无需改（见 §5「报告也会过期」） |
| **P2-8** | 环境变量没有单一参考文档，含别名对与一个死开关 | ✅ 已修 | 新增 **`docs/env-vars.md`**（唯一参考）+ **`scripts/check-env-vars.mjs`**（第 30 个门禁）。清单**从代码里提取**而非凭记忆：**11 个 `DSH_*`** 真有读取方（分布 9 个文件）+ 4 个平台/开发变量（`APPDATA` / `USERPROFILE` / `CHROME_PATH` / `BENCHMARK_VAULT`）；三对别名（`DSH_WORKSPACE_ROOT`↔`DSH_OBSIDIAN_VAULT`、`DSH_MATH_MEMORY_*`↔`DSH_OBSIDIAN_*`）写清"新名优先、旧名回退"并注明**顺序曾被写反过**（P1-8）；死开关 `DSH_MATH_MEMORY_ENABLED` 单列一节。守卫做**双向**核对：代码读了没写 → 失败；写了没人读 → 失败；**标成死开关却又被读 → 失败**（所以将来真要实现它，必须先改文档）。**变异验证三项**（各对应一条规则，改完全部还原）：删掉 `DSH_NODE_BIN` 行 → 报"read by obsidian/main.template.js but has no row"；加一行幽灵变量 → 报"documented but no code reads it"；真去实现死开关 → 报"documented as a dead switch but is now read"。**顺带查出一处真实缺口**（已记入 `handoff.md` §7）：token 改名只做了一半——preset 读新名优先，而 `math-memory-panel.mjs` 的校验**只读旧名**，所以插件当前必须注入旧名 |
| **P2-9** | 8 条面板路由里有 4 条零测试，其中包含唯一「按调用方给的 `rel` 写卡片」的 `feedback` | ✅ 已修 | `test-panel-routes.mjs` 新增 §10（9 项，35 → **44**，第五轮 token 收尾后为 **47/47**）：`feedback` 的 400 / `..` 逃逸 403 / 正向写入，`session-capture-toggle` 的 400 + `config.md` 往返，`POST /session-capture` 的返回形状，`/archive-episodes` 按 **mtime** 归档（fixture 回拨 200 天，使断言不依赖挂钟）+ `maxDays` 回退。**文档锚点由 doc-consistency 门禁自动抓出**（报 4 处「claims 35, actual 44」）并已同步 |
| **P2-10** | Obsidian 嵌入只比对了一半：本地 `npm test` 会在 `main.js` 过期时通过 | ✅ 已修（两半都补） | ① **完备性门禁**（`build-obsidian.mjs`）：`dsh/preset\|profile\|host` 下任何可嵌入文件必须被嵌入，或在 `NOT_EMBEDDED` 里写明理由；嵌入源 basename 不得撞车（**变异验证**：加一个未声明的 `.mjs` → 构建失败）。② **本地新鲜度门禁**（`check-bundle-freshness.mjs`）：`buildMain()` 与已提交 `main.js` 逐字节比对（消除 CRLF 差异），失败时指出**首个差异偏移与上下文**——此前只有 CI 的 `git diff` 覆盖，且只覆盖 `memory-admin.mjs`（**变异验证**：给一个模板追加一行 → 失败并报偏移 328805） |
| **P2-11** | 验收声明超出已提交的证据 | ✅ 已修 | 报告的证据是「`benchmark.md:3` 与 `handoff.md` 写 E2E **8/8 通过**，而唯一一份完整运行的 baseline 记的是 **7/8**，旁边两份是单用例重跑的 1/1」。核对属实 → 两处都改为**证据支持的说法**：8 用例套件**从未一次性全绿**；完整运行通过 7 项，余下 1 项**单独复跑**通过；要拿回"8/8"必须**整套重跑一次**（`npm run qa:e2e` 烧钱，先问用户）。同时点明 `baseline.json` **只写不读**（`e2e.mjs` 写、无人读），所以 `testing.md` 的「CI 可比对」是**目标而非现状**——该处也已更正。**去留决定**（消费 baseline 做阈值比对 vs 移出 git）登记在 `handoff.md` §7，没有偷偷删掉已提交的证据 |

### P3

| 发现 | 状态 | 说明 |
|---|---|---|
| 构建日志把 UTF-16 码元数当字节数报告 | ✅ 已修 | 中文密集型 `main.js` 少报约 10%（453446 vs 501340），而 CI 门禁比对字节；改为 `Buffer.byteLength` |
| `check-embedded-loader.mjs` 的 `fnAt` **从未被赋值** ⇒ allowlist 锚点从模板末尾往回搜，永远校验**最后一个** loader（注释声称的是"最近的前一个"）。**今天正确纯属运气**：memory-admin 的 loader 恰好排最后 | ✅ 已修 | `return { …, fnAt: at }`；提取函数参数化（`text = template`）以便自测；新增自测——往合成模板末尾再接一个 loader，断言取到的仍是 memory-admin 的名单。**变异验证**：改回 `fnAt` → 自测报 **"returned a non-integer fnAt (undefined) … the `fnAt` bug is back"** |
| `test-installer.mjs` 的 `vault cache removed` 断言**永不可能失败**：断言 `!existsSync(.deepseek/cache)`，但安装器从不创建该路径、夹具里也没有 | ✅ 已修 | 不是删断言，而是**让前置条件成立**：夹具先建出 `.deepseek/cache/captured-sessions.json`，再断言 `--purge` 删掉它。修完立刻证明该行为**确实实现了**（安装器日志 `[remove] …\.deepseek\cache`）——也就是说这条断言过去既没保护代码、也没保护"`--purge` 会清缓存"这个文档承诺 |
| `test-memory.mjs` 的自指式期望（`navSection.length <= MAX_TOTAL_MEMORY_CHARS`，常量从被测模块 import；`HOOK_SCHEMA_VERSION > 0`） | ❌ 未做 | 改大常量即可让断言永远成立。登记在 §7 |
| `engine-probe.mjs` 的 ground truth 指向**某个私有 vault**，与 `testing.md` 声称的"合成夹具探针"不符 ⇒ 真实语料结论在别的机器与 CI 上不可复现 | ❌ 未做 | 登记在 §7（需要一次"夹具化 ground truth"的设计） |
| 脆弱断言：47 处 `includes('中文文案')`、无锚点魔法数（`posture.length === 9`、`r.files === 5`、`assert 31`） | ❌ 未做 | 登记在 §7（属"改文案即红"的维护成本，非缺陷） |
| 其余仓库卫生小项 | ❌ 未做 | 登记在 §7 |

## 3. 本轮新增的守卫（各自证明过会失败）

**每一条都做过变异验证**——不是「跑了没报错」，而是「故意制造它要抓的缺陷，它确实报错，然后恢复」。这是本仓库既有的验收习惯（见 `docs/handoff.md` §4 陷阱 56–58 的教训）。

| 守卫 | 抓什么 | 变异验证 |
|---|---|---|
| `scripts/run-node.mjs` | （机制）无管道捕获子进程输出 | 对照实验：pipe → EPERM；fd → 成功 |
| `scripts/run-gates.mjs` | 一个门禁失败吞掉其余门禁 | 见 `npm test` 输出：28 条逐条报告 |
| `scripts/check-engine-sync.mjs` | 两份引擎静默漂移 | 改宿主副本 1 个字符 → FAIL |
| `scripts/check-client-bundle.mjs` | `client.js` 与源码脱节 | 形状检查恒跑；重建在 CI 生效 |
| `scripts/check-bundle-freshness.mjs` | `main.js` 过期 | 给模板加一行 → FAIL（带偏移） |
| `build-obsidian.mjs` 完备性门禁 ×2 | 新增模块忘嵌入 / basename 撞车 | 加未声明的 `.mjs` → 构建失败 |
| `check-version-consistency.mjs` 版本横幅 | 活文档版本腐烂 | 改成 0.7.2 → FAIL |
| `test-panel-routes.mjs` 5 项新断言 | 未配置时信任调用方 root | 还原旧逻辑 → FAIL（`status: 200`） |

## 4. 怎么自己复核

```bash
node scripts/run-gates.mjs          # 全部门禁（等同 npm test），逐条状态 + 计数
node scripts/run-gates.mjs --list   # 门禁名单
node scripts/run-gates.mjs --only panel   # 只跑名字含 panel 的
node scripts/check-engine-sync.mjs  # 双份引擎：15 同步 / 6 有据偏离
node scripts/check-bundle-freshness.mjs   # main.js 是否是当前源码的构建结果
```

在**受限环境**（禁止子进程管道 stdio）里也应当全绿；若某条报 `could not start the child process`，那是环境结果而不是代码结果，`run-gates.mjs` 会明确分开标注。

## 5. 刻意**没有**改的东西

- **版本号**：仍是 0.7.5。0.7.5 已发布，本轮改动进入 `CHANGELOG.md` 的 `[Unreleased]`；发版（改五处版本号 + 打 tag）留给维护者。
- **审查报告本身**：`maintainability-review-2026-09-11.md` 是**按当时 HEAD 写成的只读审计**，不追改。它的结论被本台账取代的部分，以本台账为准。
- **`docs/changelog.md` 里已改名的模块引用（P2-4）**：这是**历史记录**，追改历史条目会让「为什么变成现在这样」失真；应当在新条目里说明改名（本轮已在新章节写明）。
- **`dsh/preset` 与 `dsh/host` 的 6 处已知偏离**：它们多数是**结构性的**（宿主侧不能 import，必须用注入的 `zstdDecompressSync`；preset 侧有完整实现而宿主侧是薄封装）。所以登记理由而不是强行合并——**先把「静默漂移」变成「显式偏离」**，去重是下一步的独立工作。
