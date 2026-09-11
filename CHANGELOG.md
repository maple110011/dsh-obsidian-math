# Changelog

> 本文件是**发布级摘要**（每个版本「改了什么」，面向用户与发布）。记忆系统「为什么改、怎么改」的细账见 [docs/changelog.md](docs/changelog.md)；现状/坑/决策见 [docs/handoff.md](docs/handoff.md)。

## [Unreleased]

> 内容：2026-09-11 可维护性审查（[docs/maintainability-review-2026-09-11.md](docs/maintainability-review-2026-09-11.md)，视角是"agent 能否长期维护这个仓库"）的落地。**未发版**：版本号仍是 0.7.5，发版动作留给维护者。台账见 [docs/maintainability-fixes-2026-09-11.md](docs/maintainability-fixes-2026-09-11.md)。

### Fixed

- **面板约束根在"未配置"时会退回请求方自带的 `root`（安全）**：`/memory-panel` 的根锚定此前只在**环境变量已配置**时生效（`DSH_WORKSPACE_ROOT` / `DSH_OBSIDIAN_VAULT`）；两个都没配时，请求里的 `root` 直接成为约束根，于是下游 `pathInside(root, target)` 的**两端都由调用方决定**，形同虚设。现在允许的根 = 环境变量 ∪ 本实例已注册的 workspace（`ctx.workspaceRegistry`），**两者都空则拒绝一切带 root 的请求**。补了 5 项路由断言（含"未配置 + 空注册表 → 403 且文件未被移动"）；**变异验证**：还原旧逻辑，新断言立即失败并报 `status: 200`（确实把卡移走了）。
- **`npm test` 在受限环境下必然失败，而且静默跳过其后 16 个门禁**：node 子进程在禁止"管道 stdio"的环境里无法被 spawn（`spawn EPERM`），`&&` 链因此在第 5 个门禁断掉；更隐蔽的是 `check-doc-consistency.mjs` 拿到空输出后把计数读成 0，报出 **18 条"文档漂移"**——而文档是对的。现在子进程 stdio 走**真实文件描述符**而非管道（两种环境都能捕获输出），门禁**全部跑完再汇总**，并把"子进程根本没起来"单独标成环境结果。**本机 `npm test` 从"2 处红 + 跳过 16 条"变为 27/27 全绿。**
- **`dsh/client-panel/lib/client.js` 这个提交进仓库的构建产物此前没有任何门禁引用**：源码改了它不重新构建，所有门禁依然全绿，而它是**实际下发给 dsh web 面板**的代码。新增新鲜度门禁（与一次全新构建逐字节比对）；构建需要 esbuild 子进程，环境不允许时按 SKIP 报告并仍执行形状检查。
- **`capture-policy.md` 说 `sessionCapture` 默认开，而代码与 `config.md` 都是默认关**：这条错默认值是**安装进用户 vault 的模板**（`handoff.md` 坑 42 早有记载，模板里一直没改）。已改为默认关。
- **`strategy-layer.md` 的状态停在"提案（未实现，待拍板）"**：策略层自 0.7.2 起已实现（strategy 模板 + `note_strategy` + `working.md` 注入 + AGENTS.md 路由）。状态改为已实现，并点明 §11 仍有 2 项待定。
- **文档版本横幅腐烂**：`handoff.md` 写着"版本 0.7.2"（仓库在 0.7.5）、`design.md` 停在"v0.6.x 实现规格"。现在活文档用精确标记行 `> 当前版本：x.y.z`，并由版本守卫与 `package.json` 比对（精确标记以免把"0.1.5 adaptation"这类历史引用误判成当下声明）。
- **构建日志报告的"bytes"其实是 UTF-16 码元数**：`main.js` 是中文密集型文本，`main.length` 比真实字节数少约 10%，而 CI 门禁比对的是字节。改为 `Buffer.byteLength`。
- **体检报告的 `schemaVersion` 只写不读**：`AUDIT_SCHEMA_VERSION`（写入侧）此前**没有任何读取方**——`readAuditReport` 不看它，于是被**更新版本**的引擎写出的报告会被当作本版本能理解的形状解析（坑 38 记录的 v1/v2 事故正是这一类）。现在读侧声明兼容范围（v1 = 无字段 / v2 = 双渲染）并新增 `auditSchemaVersionOf`；范围外的报告返回 null（fail-closed，"没有可用报告"好过"半懂地渲染"），下一次体检重写该文件。
- **捕获路径的静默失败**：episode 落盘 / `episodes/index.md` 索引行 / 捕获 marker 三处写入失败此前**全部被吞掉**——于是"持续写失败的 vault"与"空闲的 vault"在行为上完全无法区分（都是 `captured: []`）。现在 `runSessionCapture` 返回 `warnings`（两份实现都改），marker 与索引判定改为**读回校验**而不只是"没抛异常"。顺带修掉一个潜在缺陷：索引行写失败过去会让整个会话重试，从而把同一段对话**重复追加**进 episode 文件；现在正文已写入即算捕获成功，只报索引缺失。
- **死代码**：`RETRIEVE_TARGETS`（导出但无人读取，且让 `strategy-layer.md` 的"改常量就能加取值"成为**假承诺**）与 `MEMORY_SCAFFOLD_FILES`（零使用方）已删除，`strategy-layer.md` 同步改为"目标是自由字符串、不校验"的实情。
- **文档漂移清理：产品名 `dsh web ui` → `dsh web`**。产品与插件家族都已改名（聚合包 `@linxin666/dsh-web-ui-all` → **`@linxin666/dsh-web-all`**，子包仍是 `dsh-client-ui-*`），但 README 中英、ARCHITECTURE、`handoff.md`、`testing.md`、`design.md`、`control-panel.md`、`config.md` 模板、插件注释与 profile 注释里仍写旧名。现在**活文档一律写 `dsh web`**，插件家族改称「`@linxin666/dsh-web-all` 聚合的那一族 UI 插件」——**引用可核对的包名，而不是口头的家族名**。历史档案（已发布的 CHANGELOG 段落、日期化审计、已退役的 `docs/archive/REFACTOR-PLAN.md`、调研快照）**不追改**，只就地加更正。
- **`docs/archive/REFACTOR-PLAN.md` 的状态横幅与事实不符**：它称「Phase 4（web ui 适配）未做」，而记忆面板其实**已经**以另一种形态交付（独立客户端包 + 官方 `settings.section` 槽位 + 宿主路由 `/memory-panel/*`）；未做的只是**自挂右侧 DOM 列**那一种形态。横幅改为按事实区分这两件事。同处「15 个模板」改为不写数字（实际 19，且数字应由 `templates-manifest.json` 决定）。
- **`docs/dsh-0.1.5-adaptation.md` 的状态停在「计划已定，实施中」**：三条适配（V3 日志按会话去重、401 改主进程反代、junction 镜像自愈）都已落地，§7 的两个待决问题也都已决定。状态改为**已实施**并列出结论。
- **`docs/dsh-panel-research.md`** 是 2026-08 的调研快照，正文里的包名已过期。加了日期化更正块（说明改名事实 + 权威依据），**不动正文**——正文是当时的证据。
- **面板元信息在字段缺失时会渲染字面文本 `undefined`**：`cardMeta` 对 `type` / `operator` / `topic` / `status` / `lastUsed` / `updated` 用的是 `!== ''` 守卫，`undefined` 会漏过去，于是残缺卡片显示成 `❓ · 从未用过 · 上次 undefined`。改为 `typeof … === 'string' && … !== ''`。这是新加的呈现层测试当场抓到的（见 `Added`）——数据层目前总会给字符串，所以它一直是**潜伏**的。
- **一个"看起来在工作"的守卫其实锚错了位置**：`check-embedded-loader.mjs` 的 `loaderCall()` 算出了偏移却返回了一个**从未被赋值**的模块级变量（`fnAt`），于是 `lastIndexOf(marker, undefined)` 按规范等价于**从模板末尾往回搜**，守卫永远校验**最后一个** allowlist，而注释声称的是"最近的前一个"。它今天正确**纯属运气**（memory-admin 的 loader 恰好排最后）——再加一个 loader 它就会去校验错误的名单，还照样打印 OK。现已修好，并加一条自测：往合成模板末尾再接一个 loader，断言取到的仍是 memory-admin 的名单（**变异验证**：改回原样 → 自测报出根因）。
- **一条永远不可能失败的断言**：`test-installer.mjs` 断言卸载后 `<vault>/.deepseek/cache` 不存在，但安装器从不创建该路径、夹具里也没有，因此它恒真。修法不是删掉断言，而是**让前置条件成立**（夹具先造出真实 vault 会有的缓存文件），再断言 `--purge` 删掉它——修完立刻证明这个行为确实实现了，也就是说这条断言过去既没保护代码、也没保护文档承诺。
- **合成基准 vault 的协议文件不再被 agent harness 注入**：`scripts/qa/benchmark-vault/AGENTS.md` → `vault-AGENTS.md`。它是那个合成 vault 的教学协议，但只要叫 `AGENTS.md`，任何 harness 都会把它当成**本仓库**的指令注入（实测：一动该目录，agent 就收到它的全文）。改名后 harness 直接报告 `Instructions removed: …`——这就是修复生效的证据。**配套**：`classifyVaultDoc` 现在同时跳过 `vault-AGENTS.md`（`AGENTS.md` 的模板源名），否则该文件会**进入检索语料**；实测合成探针仍 **8/8**。
- **文档上的两个「侧栏」在性能调查里从未分清**：`sidebar-performance.md` 的「侧栏」既指 **dsh 侧栏**（dsh web 自己的导航列，跑在浏览器页里）又指 **Obsidian 侧栏面板**（承载 iframe 的那个面板）。实际上**所有 CDP 数字都来自前者**（探针跑在独立 headless Chromium 里，看不到也点不到 Obsidian 的 Electron 界面），而后者——面板展开/收起 + iframe 重排/合成 + 宿主渲染——**从未测量**，原因 3/4 的处置属于推理。已新增 §0.1 术语表与证据归属、§6 的 Obsidian 侧量法（给 Obsidian 开 `--remote-debugging-port`，同一套 CDP 换 target）、§9 第 5 项。
- **用户可见文档里不再出现某个具体的 vault 路径**：README 中英的安装示例、`ARCHITECTURE.md` 的架构图与 `docs/installation.md` 的 dry-run 输出此前都写着同一个 `D:\Obsidian笔记数据库`——它读起来就是维护者的机器，而 npm README 是**包主页，读者是陌生人**。现在一律用占位符（`<path-to-your-vault>` / 「工作区根」/ `<vault>`）。
- **文档里的「数字」改成从代码取真值**：① README 中英写「四个 / four note tools」，而 `note-tools.mjs` 注册 **5** 个 → 更正并列出工具名；② `design.md` 写捕获策略「默认 ask/ask/ask」，而 `DEFAULT_CAPTURE_POLICY` 是 `structure: auto` → 按代码改写；③ 论文数曾被写出 **14 / 15 / 19 / 20** 四个版本 → 收敛为**单一来源** `docs/literature.md`（现 20 篇，与 `literature/.raw/` 一致），`handoff.md` 的复述改为指向它；④ `sessionCapture` 默认关的**版本**两说并存（0.7.4 / 0.7.5）→ 采信发布时写下的 0.7.4 条目（`0.7.2`–`0.7.4` 从未打 tag，无法用 tag 复核）。
- **基准的验收声明改为证据支持的说法**：`benchmark.md` 与 `handoff.md` 此前写真实 token E2E「**8/8 通过**」，而唯一一份完整运行的 baseline 记的是 **7/8**，其余两份是单用例重跑的 1/1。现在写明：8 用例套件**从未一次性全绿**；完整运行通过 7 项、余下 1 项单独复跑通过；要拿回「8/8」必须整套重跑（`npm run qa:e2e` 烧钱）。同时点明 `baseline.json` **只写不读**，所以 `testing.md` 的「CI 可比对」是**目标而非现状**。
- **`docs/memory/obelisk-comparison.md` 仍在引用 `pathIsInside`**：该函数在 P2-6 里已统一改名为 `pathInside`。这是"改名之后靠 grep 补文档"漏掉的一处。
- **`scripts/test-panel-present.mjs`：呈现层第一次有自动化测试**（第 33 个门禁）。`main.js` 是用户真正安装的文件，而它的呈现层此前**零覆盖**（徽标/元信息组合、「⚠️ 待处理」的计数规则、层级回退都靠手测）。`MemoryView` 恰好把决策留在四个纯方法里（`layerEntries` / `pendingItems` / `cardMeta` / `trendText`），测试**从 `main.template.js` 的源码文本里提取它们并求值**——测真源码而非副本，接缝挪走即报错。20 项断言覆盖五层渲染与降级、待处理计数规则、元信息分段与顺序、趋势的显示条件。**它第一次运行就抓到一个真实缺陷**（见 `Fixed`）。
- **`scripts/check-agent-instructions.mjs`（第 34 个门禁）：只允许一个自动发现的指令文件**。agent harness 按**文件名与位置**自动发现指令并注入，所以"写给别人的文档"会静默变成"维护本仓库的指令"——本仓库已中过两次（给用户 vault 的协议模板、合成基准 vault 的协议）。守卫把自动发现的名字列成清单，除仓库根 `AGENTS.md`（维护协议本身）外一律拒绝，并打印实际会被注入的文件；**"一个都没找到"也算失败**（否则遍历一坏就静默通过）。**变异验证**：在 fixture 里放回 `AGENTS.md`、在根放一个 `CLAUDE.md` → 各报出路径与原因。
- **`scripts/check-doc-constants.mjs`（第 32 个门禁）：把文档里的**语义常量**锚到代码**。`check-doc-consistency` 只锚测试套件的断言数；审查指出更值钱的是"有多少个笔记工具""文献库有多少篇"这类**散文里的常量**——它们会静默漂移，而读者无从核对（实测：论文数被写出 14/15/19/20 四个版本）。现在：笔记工具数由 `note-tools.mjs` 的注册推出（5 个）、论文数由 `literature/.raw` 的目录数推出（`.raw` 是 gitignore 的语料，缺失时**声明 SKIP** 而非静默通过）；**措辞变了导致解析不到锚点也算失败**，否则锚点会腐烂成装饰。**变异验证三项**：README 改回 four、`design.md` 改七个、`literature.md` 改 21 篇 → 各报出精确差异。
- **`scripts/check-rename.mjs` 增加第二条规则**（原先只管 profile 名）：活文件里再出现**已退役的旧产品名**即失败（真实退役包名 `dsh-web-ui-all` 例外），历史档案须以「路径 + 理由」白名单豁免——**要改历史记录，得先写下理由**。
- **frontmatter 的边界判断此前在全仓复制了 15 份**：`/^---\r?\n([\s\S]*?)\r?\n---/` 在 `math-memory.mjs`（12 处）、`memory-admin.mjs`（1 处）、`note-tools.mjs`（2 处）各写一遍，6 个解析器各判各的"块到哪里结束"。本仓库历史上最严重的三次数据损坏（坑 21/22/43）全是同一个形状：写入方的"块内"与读取方的"块内"不一致，闭合 `---` 落在文件中间。现在规则只有一个家（`dsh/preset/hook-frontmatter.mjs` 的 `frontmatterSpan` 及其派生：`frontmatterBlock` / `readFrontmatter` / `stripFrontmatter` / `replaceFrontmatter` / `replaceFrontmatterBlock`），15 处全部改调它；6 个解析器仍各自解析**字段**（那部分本来就不同，是正当的）。行为保持：记忆回归仍 **240/240**。

### Changed

- **反馈 token 与链接基址的「新名优先」现在两侧一致，且插件同时注入两个名字**：此前 preset 读 `DSH_MATH_MEMORY_*` 优先，而面板的 token 校验**只读旧名** `DSH_OBSIDIAN_FEEDBACK_TOKEN`——无论插件注入哪个名字，总有一侧看不见它（这是"半途改名"的典型形态：偏好顺序变成了隐式契约）。现在预设与面板读同一对、同一顺序，Obsidian 插件同时注入新旧两个名字（插件与 npm 包可以分别升级，只发新名会打断旧消费者）。回归 +3 项（含「两个都设时新名优先」）。
- **`npm test` 从 `&&` 长链改为 `node scripts/run-gates.mjs`**：一次运行全部门禁、逐个报告状态与套件自报计数，失败时打印该门禁输出的末尾；`--only <子串>` 可只跑匹配的门禁；`npm run test:list` 列出门禁名。**一个门禁失败不再吞掉其余门禁。**
- **测试套件的 `__CHECKS__` 分母改为自数**：`test-panel-proxy.mjs` 手写的 `EXPECTED_CHECKS = 31` 实际执行 **32** 个断言，`test-panel-auth.mjs` 的 `7 - failed`/`7` 实际可达 **8** 个。文档锚点盯着这些自报数，于是错数字被抄进了 5 处文档；现在 `check()` 内部计数，末尾打印真实值（文档已同步为 44 路由 / 32 反代 / 8 握手）。
- **四条面板路由此前零测试**（`feedback` / `session-capture` / `session-capture-toggle` / `archive-episodes`）：路由套件只驱动了 8 条里的 4 条，而**唯一一条"按调用方给的 `rel` 往卡片里写数据"的 `feedback` 连正向用例都没有**——与 P0-0 同属"写入型端点信任调用方输入"的形状。补 9 项断言（35 → **44**），覆盖 `..` 逃逸被拒、正向写入、开关往返、捕获返回形状、按 mtime 归档旧 episode 与 `maxDays` 回退。
- **`dsh/templates/AGENTS.md` 改名为 `dsh/templates/vault-AGENTS.md`**（安装后的文件名仍由 `templates-manifest.json` 映射为 `AGENTS.md`）：仓库内的源文件叫 `AGENTS.md` 会被 agent harness 当作"**本仓库**的指令"自动注入，而它其实是**给用户 vault 的教学协议**（实测被注入约 200 行，含与仓库维护冲突的硬约束）。

- **`pathInside` 在两个引擎里统一了名字**：preset 侧原叫 `pathIsInside`，所以 `check-engine-sync.mjs` **根本看不到这一对**——一个安全相关助手（面板约束根、vault 过滤都靠它）的命名分叉。改名后两份逐 token 相同并被守卫覆盖；宿主侧同时补上 preset 独有的类型守卫（原来传 null/undefined 会抛异常而不是返回 false）。共享符号清单 21 → 22（守卫会强制这个决定被显式做出）。
- **捕获索引失败的语义**：`appendEpisodeIndex` 由「返回 void / 抛异常」改为「返回布尔（读回校验）」。

### Added

- **仓库根 `AGENTS.md`**（维护协议）：两个产物与数据流、文件地图（改哪里 → 接着必须做什么）、五条铁律（生成物 `main.js`、模板清单、双份实现、版本五处一致、提交前看 `git status`）、**验证纪律**（受限环境的"红"不是回归；`npm run qa:e2e` 要烧钱需先问）、记录纪律、已知陷阱。
- **`scripts/run-node.mjs`**：不用管道的子进程捕获（附实测对照）。**`scripts/run-gates.mjs`**：门禁汇总器。
- **`scripts/check-engine-sync.mjs`**：双份实现守卫。两份记忆引擎（`dsh/preset/math-memory.mjs` 115 个顶层声明 / `dsh/host/memory-admin.mjs` 56 个）共享 **22 个同名符号**（`pathInside` 统一命名后 21 → 22），此前唯一的同步机制是其中一处的注释。守卫把共享清单**钉住**、逐符号比对**词法流**（忽略注释/引号风格/`export`/空白），要求"一致或有记录的偏离"——现为 **16 个同步 + 6 个有据偏离**；未登记的偏离、清单变化、以及"已登记的偏离其实已经一致了"都会失败。带提取器自测；**变异验证**：改动宿主副本里一个符号的一个字符即失败。
- **`scripts/check-frontmatter-source.mjs`**（第 29 个门禁）：frontmatter 的边界规则只准有一个家，且"不能 import 的那份拷贝"必须**行为等价**——详见 `Fixed` 一节。
- **`check-embedded-loader.mjs` 补上 hook 解析器覆盖**：模板剥掉 `hook-frontmatter.mjs` 的导出语句再 `new Function` 求值，这条路径此前零门禁，而它是内存面板每读一张卡都要走的 hook 解析；现在校验导出语句可被剥掉、allowlist 全部解析得到、模板消费的名字都在其中，并**真的解析一个 hook 块**。
- **`scripts/check-client-bundle.mjs`**：`client.js` 与一次全新构建逐字节比对。
- **嵌入清单完备性门禁**（`scripts/build-obsidian.mjs`）：`EMBEDDED_SOURCES` 改为数据 + 三条门禁——`dsh/preset|profile|host` 下任何可嵌入文件必须**要么被嵌入、要么在 `NOT_EMBEDDED` 里写明理由**；嵌入源的两两 basename 不得相同（模板把它们平铺落地，同名会互相覆盖）；`dsh/templates/` 下的 `.md` 必须在模板清单里（原有）。**变异验证**：新增一个未声明的 `.mjs` 即构建失败。
- **活文档版本横幅守卫**（`scripts/check-version-consistency.mjs`）：`handoff.md` / `design.md` 的 `> 当前版本：x.y.z` 必须等于 `package.json` 的版本。
- **[docs/env-vars.md](docs/env-vars.md)：环境变量的唯一参考**（谁读、别名对的优先级、默认值、死开关）+ **`scripts/check-env-vars.mjs`**（第 30 个门禁）。此前这些变量只存在于代码里：**11 个 `DSH_*`** 分布在 9 个文件，夹着三对别名（每个都读两次、新名优先），外加一个**被文档描述过、却没有任何代码读取**的开关。守卫做**双向**核对：代码读了没写下来 → 失败；写下来了却没代码读 → 失败；**标成死开关却又被读 → 失败**。**变异验证三项**：删一行文档、加一行幽灵变量、真去实现死开关，各触发对应的一条。
- **改名守卫增加第二条规则**（`scripts/check-rename.mjs`）：活文件里再出现**已退役的旧产品名**即失败（真实退役包名 `dsh-web-ui-all` 例外），历史档案须以「路径 + 理由」白名单豁免——**要改历史记录，得先写下理由**。
- **`scripts/check-release-paths.mjs`（第 31 个门禁）**：把**发布面**钉住——① `package.json` 的 `files` 被 pin（改它必须改守卫并写理由），且 `scripts/` 不得进入（那里有 gitignore 的机器特定文件）；② 扫描实际发布面（`files` ∪ Obsidian 三件）里是否出现**本机标识**（`os.homedir()`、登录名作为路径段）或通用绝对路径。审计曾报"发布物里残留维护者本机路径"：逐面核对后**当前树上不可达**（npm 只发 `dsh/` + 三个根文件，Release 只附三件，唯一硬编码本机路径的 `scripts/deploy-local.mjs` 被 gitignore），但**可达性靠的是两个清单没人改**——这条守卫就是让"没人改"变成有人守。**变异验证三项**：把 `scripts/` 加进 `files`、给发布文件塞入通用绝对路径、塞入本机真实 home，各触发一条。

### Docs

- 新增 [docs/agent-repo-maintenance.md](docs/agent-repo-maintenance.md)：从本轮工作提炼的**通用**「agent 仓库维护」清单（不是本项目专属）。
- `handoff.md` §4 陷阱清单 +5 条（59–63：管道 stdio / 模板文件命名 / 自报计数 / 安全边界要锚在服务端 / 版本横幅腐烂），§7 未做清单同步（本轮完成项 + 仍余项：路由补测、引擎去重目标态、大函数拆分）。

## [0.7.5] - 2026-09-10

> **本节于 2026-09-11 重编**：只保留「修了什么 / 改了什么 / 加了什么」的事实条目。排查过程、实测数字、外部设计的采纳与不采纳决策已归档到 [`docs/changelog.md`](docs/changelog.md)（面向维护者的细账，按日期分节）。**版本内容本身未变，只是换了记录层次。**

### Fixed

- **（安全）`/memory-panel/*` 不再把约束根交给调用方**：`root` 只接受启动时确定的 vault（`DSH_WORKSPACE_ROOT` / `DSH_OBSIDIAN_VAULT`），其它路径一律 403；带非 loopback `Origin` 的请求（含 `Origin: null`）一律 403；配置了 `DSH_OBSIDIAN_FEEDBACK_TOKEN` 的实例要求每个请求携带 token，定时安全比较。此前 `body.root` / `?root=` 直接就是约束根，`pathInside(root, target)` 的两端因此都由调用方决定，任何网页或本机进程都能移动任意路径下的文件。
- **（安全）`archiveMemoryFile` 校验源路径**：只接受 `.deepseek/<层>/…` 下的 `.md` 常规文件，拒绝普通笔记、目录、`capture-policy.md` / `config.md`、含 `..` 或盘符的路径以及 vault 根；归档目录改为**校验通过后**才创建（此前被拒的请求会在 vault 里留下空目录）。
- **写入记忆卡片不再损坏文件**（面板 ✅/❌ 与每日体检都会触发）。两个静默损坏模式：
  - `text.replace(span, newText)` 把第二个参数当**替换模板**，于是 agent 写的 frontmatter 里的 `$$` / `$&` / `$'` 被展开——数学库里 `title: 关于 $$ 的表示` 会丢掉 `$`，`$&` 会把整段 frontmatter 注入标题；
  - frontmatter **体为空**时搜索串是 `""`，`replace("", x)` 在偏移 0 **插入**而非替换，收尾的 `---` 被推到文件中间，而界面报「已成功」。
  改为**按偏移量拼接**（新增 `frontmatterSpan` / `replaceFrontmatter`），空体与 CRLF 都保持良构；`setHookField` / `setTopField` 也不再给空体留空行。同一缺陷在 preset 的四处审计写入路径（`syncHookStatsToCard`、`syncTopLevelStatsToCard`、重复卡标记 `duplicate_of`、候选策略卡转正）一并修掉。
- **策略卡的 `uses` 曾被写到 frontmatter 之外**：`syncTopLevelStatsToCard` 把含首尾 `---` 的**整块**交给 `setTopFieldText`，卡片没有 `uses:` 行时字段落在闭合分隔符之后的**正文**里，且每次体检再追加一行——`strategy/strat-ot-structure-proof.md` 里那两行游离的 `uses: 0` 就是这么来的。改为在分隔符**内部**拼接，并由读回验证保证落点。
- **体检报告不再只是「模型输出记录」**：`memory-audit.json` 拆成**两个渲染、一份数据**——`checklist`（模型看的指令清单）与 `human`（人看的中文摘要），结构化事实进 `counts` / `decisions` / `thresholds` / `sections` / `structural` 并带 `schemaVersion: 2`。两个面板渲染 `human` 与结构化字段，模型清单退到「查看模型版清单」折叠里。
- **体检报告不再把刚归档的卡列为「建议归档」**：`autoArchive` 打开时报告会指向一张已经不在库里的卡（点按钮就是死链）。所有 section 与 `decisions` 计数统一按「归档后仍在库中」过滤，`counts.cards` 同步扣减。
- **体检的确定性写入改为「写完读回验证」**：任一处未确认即计入 `postconditions` 并给出 `status: "degraded"` + `warnings`（人话摘要与模型清单都会写出来）；命中无处可写时明确报告「这批 hits 会在重置时丢失」，不再静默清零。
- **面板不再丢掉数据层已经算好的信息**：
  - `collectMemoryState` 收集**全部五个卡片层**（记录 / 模板 / 主题 / 定理 / 策略）。此前只收集 records + templates，于是文档反复承诺的「五层」里有三层在两个面板都不可达，只有主题卡或策略卡的 vault 会被判成「记忆库还是空的」；
  - episode 带上**人类标题、主题与日期**（解析 `memory/episodes/index.md`），此前只显示文件名与**捕获写盘时间**（同一次捕获写入的多条 episode 时间戳完全相同）；
  - 卡片返回 `topic`（用户按主题浏览记忆的主维度，此前可搜索却从不显示）与 `layer`；新增 `readAuditReport`（`readAuditText` 只取字符串，把 `generatedAt` / `counts` / `structural` 全丢了）；
  - 搜索统一大小写（此前 haystack 转小写却拿原样 needle 比较，`De Finetti` 这类查询一条也搜不到），episode 纳入搜索。
- **归档按卡片自己的层**：`archiveMemoryFile` 与体检的 `moveCardsToArchive` 此前都把目的地写死 `.deepseek/archive/records/` 并只回写 `records/index.md`——归档一张**策略卡**会进错目录，并让 `strategy/index.md` 里的那行变成悬空链接。
- **dsh web 面板的「自动保存对话」勾选与引擎相反**：面板用 `enabled !== false`，而引擎对**缺失的键返回 false**（默认关），于是真正关闭时界面显示「已开启」。改为 `=== true`。
- **反馈三选项分层 + 补回执**：回复末尾改为**每张卡一行并写明是哪张卡**（旧模板给 N 张卡发 N 行一模一样的 `[✅ 这条对]`）；`归档` 从评价行里移出（它是文件移动，不是第三个评价）并加二次确认；**dsh web 面板的按钮第一次有回执**（此前 `run()` 丢弃响应体，点任何按钮界面都不显示）；`❌` 不再凭空发明 `success_rate`（只有卡上已有才改它）；**没有 `hook:` 块的卡也能反馈**（自动补最小 `hook:` 块，行内 flow 写法仍明确拒绝）。
- **dsh web 面板刷新不再污染搜索框**：它唯一的刷新杠杆把搜索词变成一个空格（`?q=%20`），改用已有的 `tick` 计数（`&t=N`）。
- **侧栏 401 文本页的真正修法是主进程反代**：dsh 的会话 cookie 带 `SameSite=Strict`，而侧栏是跨站 iframe（顶层 `app://obsidian.md`、框架 `http://127.0.0.1:3180`），这种 cookie 在跨站子框架里存不下也发不出。现在 dsh 以 `--port 0` 启动（内部端口），插件在主进程跑一个反代监听用户配置的端口（默认 3180）：
  - 代理用 `http.request`（`fetch` 会忽略 Host）以公共权威兑换启动 token 并保存 cookie，随后给每个转发请求注入 `cookie`、把 `host` 改写成公共权威（dsh 按 `Host` 决定 cookie 名），并剥掉 `set-cookie` / `x-frame-options` / `content-security-policy`；
  - `/api/` 前缀的 WebSocket 升级照常转发；就绪判定改为「代理在配置端口上能供出已认证界面」；`stop()` 关闭代理并清 cookie。
- **侧栏卡顿的真因是皮肤客户端脚本**：`orca-link` 的 `hooks.mjs` 有约 14 个 subtree MutationObserver、一个约 5 次/秒改内联样式的循环、以及一个跟着侧栏动画**每帧**触发的 ResizeObserver。**侧栏性能模式**因此扩展为同时改写该脚本的两处热循环（锚点全中才改，皮肤更新后自动原样返回并记日志），并新增开关**「侧栏加载皮肤动态装饰」**（默认开；关掉则把该模块换成空实现，保持导出契约）。不改皮肤文件。
- **「打字几秒才显示」的整机卡顿：会话扫描不再全量解码**：`countUncapturedSessions` / `runSessionCapture` 此前遍历 `$DSH_HOME/sessions/` 下**每一份**日志并逐个完整 zstd 解压，之后才去查那个本来就能跳过它的指纹标记；而 `countUncapturedSessions` 由记忆面板 `onOpen` 在 Obsidian 渲染进程主线程调用（本机实测 389 份日志 / 367 MB，单次 `count` 48.6 s，期间界面含编辑器打字完全冻结）。三重修复：
  - 新增 `readSessionHeader`：只读文件头 64 KiB 并只解压**第一个 zstd 帧**，非本 vault 的会话在读头阶段就被排除；
  - marker 新增 `scanned`（`日志路径 → {fp, inVault, pending}`，`fp = path|mtimeMs|size`）：未变化的日志只 `stat`、永不重读，别的 workspace 的日志特征化一次后永久跳过；
  - 未保存角标改到 `setTimeout(…, 0)` 执行，冷启动扫描不再挡住面板首绘。
  另外 `buildDialogueIndex` 改为**先按会话头筛出本 vault 的最新 N 份再解码**（此前是在全局最新 20 份里筛本 vault，既白解码又可能让索引几乎为空）；头部读不到时回退全文解码判定，不缓存无法自证的 `inVault: false`。
- **同一会话不再被当成两份日志（dsh 0.1.5 的 V3 迁移）**：V3 生成 `session.v3.jsonl.zstd` 并**保留 V2 原件**，同一会话目录下有两份都以 `.jsonl.zstd` 结尾的日志。现在 `sessionLogKey` 取会话身份、`selectAuthoritativeLogs` 每个会话只保留权威版本（**显式优先 `.v3.` 变体**，因为两者 mtime 可能落在同一刻度上），preset 与 host 两份副本同步。
- **链接跳转服务不再对已解码的参数二次解码**：`URLSearchParams.get()` 返回的已是解码值，再 `decodeURIComponent` 一次会让**任何含 `%` 的路径**抛 `URIError`，且该异常逃出请求监听器导致**点击永久挂起无响应**。删掉两处二次解码，整个 handler 包进 try/catch（异常回 500 并写日志）。
- **`install-into-profile.mjs` 不再静默失败**：它把 insert 锚在 flow 风格结尾的 `]`，而仓库里三个 patch 文件都是 block 风格、没有 `]`，于是 `replace` 原样返回、脚本照样打印成功——客户端面板进 profile 的**唯一**途径从来没生效过。改为在末尾追加 block 风格 `insert:`，写入后断言文件确实含包名，否则 exit 1。
- **`/memory-panel/workspaces` 不再要求 `?root=`**：root 守卫原本在路由分发之前，而面板前端正是裸 fetch 这条路由（400 → 工作区下拉框永远是空的）。该分支移到 root 门禁之前（它只读 registry，不碰 vault）。
- **`capture-policy` 路由校验 `field` / `mode`**：`field` 会进入 `new RegExp("^" + field + ":")`，`a.c` 能改到无关行、`idea|fact` 会同时毁掉两个真实键。现在只接受 `^[A-Za-z_][A-Za-z0-9_-]{0,63}$` 与 `^[a-z]{2,16}$`。
- **junction 镜像会自愈**：`syncGlobalPackageLinks` 只用 `existsSync` 判断是否已镜像，而 `existsSync` **跟随**链接——web profile 重装或包改名后悬空链接被判「不存在」，`symlinkSync` 随即 EEXIST 且被裸 catch 吞掉，这段「持久修复」于是永久失效且**不留任何日志**。改用 `lstatSync` 识别条目、只在「是 junction 且目标已消失」时删除重建，并记录失败项。
- **检索回归网不再测「陈旧的手抄公式」**：两个零 token 探针各自复刻了一份打分公式，而产品用的是另一套权重，且探针从不调用 `isRecallEligible`（superseded/duplicate 排除）、operator 硬过滤与 `maxResults`——权重改过而探针停在旧版，于是**纠错机制上线后完全没有自动化看守**。现在把产品管线抽成 `buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards` 并导出，`note_recall`、`note_strategy` 与两个探针**调用同一份代码**。
- **导航索引不再压过它指向的内容**：`episodes/index.md` 列出每条 episode 的标题+主题，对几乎任何中文查询都有很高的原始字符覆盖率，实测顶掉了「库中无答案应给弱信号」的控制项并挤占真实命中的名次。新增按 kind 的语料权重（`episode-index` 0.4、`theorem-index` 0.7）为其降权。
- **`captureSubagents`：子代理会话默认不进记忆**。子代理会话会重放父会话前缀，保存它等于把同一场对话重复写进证据层、并稀释每轮注入预算。dsh ≥ 0.1.5 的 V3 头部新增 `origin` / `delegationDepth`，第一次让这件事**可判定**（V2 头部没有这两个字段，无法区分，一律保留）。
- **`check-embedded-loader.mjs` 不再自证**：它此前比对的是**自己那份** `return {…}` 名单。现在从模板里**读取**真实的参数表、白名单与追加的 helper，断言「白名单覆盖模板消费的每一个 `MEMORY_ADMIN.*`」「白名单里的每个符号都能解析」「参数表与实参表一致」，并**自测**「抽掉任一被消费符号必须被发现」。
- **`check-doc-consistency.mjs` 改为读取运行期计数**：不再用正则数源码里的 `check(` 调用点——后者会漏掉夹具循环里生成的断言，且看不到提前退出。
- **`🔁 不适用` 退出所有 UI**：它写入的 `last_not_applicable` 在**全仓库没有任何读取方**（grep 验证），排序影响为零，即「看起来像 ❌、实际什么都不会发生」。宿主保留该动作，**旧对话里的历史链接照常可用**。
- **「设计迭代忘记适配」专项审计修掉 6 处**（把每个「后来才长出来的东西」拿去比对所有向它枚举消费点的地方）：归档只认 records 层；dsh web 面板的「自动保存对话」勾选与引擎相反；文档说 `sessionCapture` 默认开、实际默认关；注入给模型的「分层长期记忆」说明停在五层、路由清单漏 templates 与 strategy；`AGENTS.md` 三写第 3 步清单漏 `strategy/`；本机 `deploy-local.mjs` 手写清单只部署 8/19 个模板（改为读 `dsh/templates-manifest.json`）。
- **版本身份对齐到 0.7.5**（此前 `package.json` 0.7.3 / `manifest.json` 0.7.4 / npm `latest` 0.7.1，且 0.7.2–0.7.4 **从未推过 tag**）：新增 `scripts/check-version-consistency.mjs` 要求 `package.json` / `manifest.json` / `package-lock.json` / `versions.json` / `CHANGELOG.md` 五处同号；`release.yml` 补上 `npm ci`、版本/tag 一致性、重建 `main.js` + `git diff --exit-code`、`npm test`——**推 tag 的发布流程此前不跑任何测试**，Release notes 也改为抽取该版本段落而不是 `## [Unreleased]`。

### Changed

- **两个面板的呈现层重做**（同一份 JSON、同一套词）：顶部一行状态条（各层计数 + 上次体检日期）；新增置顶的 **⚠️ 待处理** 区块（仅在非空时出现，把「待重审 / 建议归档」摆在可点的归档按钮旁边）；卡片行改为 `标题 · 类型 · 算子 · #主题 · 徽标 · 用过 N 次 · N 天前`（去掉真实数据里恒为 `—` 的 `success=` 与趋势线，去掉直接打印的 vault 相对路径，去掉分区标题里硬编码的 `.deepseek/…`）；事件时间线改为 `日期 · 人类标题 · 主题`（默认折叠 8 条 + 展开全部）；补徽标图例；空状态判据覆盖全部层；术语与文案对齐。
- **dsh web 记忆面板只保留工作区下拉框**（选项显示工作区名，完整路径放悬停提示），仅当工作区列表为空时才退化为手动输入。
- **捕获策略扩到四个档位 `idea/fact/preference/structure`**：一个档位对应一组层——想法→inbox；事实→records 的 fact/event/instruction/artifact；偏好→profile 与 notation；**结构→topics / 定理索引 / 模板 / 策略**的索引与结构行（默认 `auto`）。**缺 `structure:` 行的旧策略文件行为不变**（等同 `auto`）。事件层（episodes，归 `sessionCapture` 开关）与记号「收集」的豁免也第一次写清楚。
- **皮肤中心开关改名为「挂载皮肤中心 UI（高级 / 通常无需开启）」**，默认值仍 `false`：`dsh-web-all@0.3.20` 聚合包已自带皮肤中心，该开关只覆盖「有皮肤包、没有聚合包」的 web profile；**关掉它不会关掉皮肤**（皮肤本体走全局 `$DSH_HOME/cordis.patch.yml` + junction 镜像）。
- **注入给模型的协议随新层同步**：分层长期记忆说明改为「五层 + 三个后长出来的检索面」并补齐路由；`AGENTS.md` 三写收尾清单补 `strategy/`。
- **客户端面板的 `dsh.client.inject` 改用 dsh 0.1.5 实际存在的包名**（`dsh-client-modules` / `dsh-client-locale` / `dsh-client-ui-settings`）；旧名 `dsh-client-runtime` / `dsh-client-ui-slots` 属于 0.1.5 已移除的 runtime face。该字段只是加载/预取元数据，真正的依赖是运行时注入的 cordis 服务名。
- **跨皮肤写样式只用各皮肤都保证存在的 token**：次级文字原用 `--dsw-alias-label-dimmed`，而用户当前皮肤只定义 `primary/secondary/tertiary/caption` 一族，于是声明失效、颜色回退到继承值。改用带回退链的 `--dsw-alias-label-secondary`；Obsidian 侧 `--text-faint` 换成 `--text-muted`。
- **`docs/session-scope.md`（会话隔离备忘）标注为已否决**：P1 要包住被会话搜索 / lineage / 按 URL 打开共用的 `sessionPersistence.list()`，代价与收益不成比例，侧栏分组折叠已够用。文档顶部给出否决结论与理由，正文保留为存档。
- **项目定位写进文档**：记忆系统已解决「agent 记不住用户问过什么」，但「辅助用户打磨一套数学理解、并建立对理解/技巧的调用体系」远未解决——**真正实现它才是 1.0**。README 中英、`docs/memory/README.md` 与 `handoff.md` 均写明，并列出 1.0 之前缺的四件事。

### Added

- **数据层**：`summaryOf()`（卡片的「这是什么」一行，优先 `summary` / `description` / `abstract`，否则取正文第一段有效行）、`uses` / `usesDeclared` / `usesPending` 三值（声明值与「尚未合并的增量」分开显示）、`harmed` 负反馈计数、`verified_by` 验证凭据（把「verified 升级必须用户参与」从一句话变成**可机检的不变量**）。
- **检索侧的适用边界硬门控**：卡片顶层/`hook` 里的 `not_applicable_when` 被 `note_recall` 与 `note_strategy` 当门控用——查询命中边界短语时该卡不进候选，但结果里**单独列出「因适用边界被排除（命中『…』）」**，刻意不做静默丢弃。
- **`npm run qa` 引擎探针新增可达性分层**：从 vault 原文抽 `related` / `source` / `[[wikilink]]` 边（断链不算可达），把每条 ground truth 目标分为 **Direct / Recoverable / No access** 三层，并**同时报告目标排名**（分层粗粒度，只看分层会误判「两种池化一样」）。读法约定：改检索必须「Direct 数不降**且**排名均值不升」。
- **`scripts/check-version-consistency.mjs`**：五处版本必须同号（带 `--tag` 时还要求 tag 等于版本号、且版本是纯 `x.y.z`，因为 Obsidian 注册表拒绝预发布号）。
- **`scripts/check-embedded-writers.mjs`**：求值 `main.js` 里嵌入的那份 `memory-admin.mjs`（与插件 loader 同样的 import/export 剥离 + `new Function`）并跑真实写入，同时断言「嵌入源码 == 仓库源码」。
- **`scripts/test-panel-routes.mjs`**（`/memory-panel/*` 的信任边界回归）、**`scripts/test-panel-auth.mjs`**（对**真实 dsh** 的侧栏握手端到端，未装 dsh 时 SKIP）、**`scripts/test-panel-proxy.mjs`**（反代回归，stub 上游）。
- **[docs/release.md](docs/release.md)**：发版手册（五个版本位置、tag 必须等于版本号、三条工作流各自的门禁、为什么插件商店拿不到新版本以及三条可用的分发路径、推送需要用户口令）。
- **`config.md` / `agent.cordis.yml`** 新增 `captureSubagents` 开关（默认 `false`）。

## [0.7.4] - 2026-09-02

### Changed

- **捕获策略默认全改为 `ask`（先问再写）**：`fact`（事实/事件/指令 → records）与 `preference`（偏好/记号/授权 → profile/records）默认档位从 `auto` 改为 `ask`——agent 不再不经同意就自行写入记忆；`.deepseek/capture-policy.md` 模板、preset 默认策略、Obsidian 设置页下拉、记忆面板摘要与 dsh web 面板 fallback 全部同步。
- **自动保存对话默认关闭（opt-in）**：`sessionCapture` 从默认 `true` 改为 `false`——不再每场对话自动把整场对话写进 `.deepseek/memory/episodes/`；需要时可在 Obsidian 设置页「自动保存对话」或 `.deepseek/config.md` 手动开启。
- **移除过时的 dsh 前端链接补丁**：当前 dsh 前端已内置 loopback 链接站内跳转（`127.0.0.1`/`localhost` 链接不再 `target="_blank"`），旧补丁每次启动都命中失败并打「未命中」日志。已删除 `patchDshFrontendLinks` 与其调用，既去掉了噪音日志，也省去每次启动同步扫描/改写前端 bundle 的开销。

### Fixed

- **启动失败不再静默**：`ensureStarted` 的失败错误不再被 `.catch(() => {})` 吞掉；未找到 dsh、子进程启动失败、端口超时等路径都会写进设置页日志与 `debug.log` 并弹 Notice，方便定位「打开 Obsidian 后有概率 dsh 插件启动失败」的原因。
- **并发启动去重**：`start()` 增加 in-flight 守卫——侧栏视图 `onOpen` 与 autoStart 定时器并发触发时共享同一次启动，避免同时 spawn 两个 dsh 进程抢同一端口（EADDRINUSE）导致偶发启动失败。
- **启动路径减负**：删除启动时的前端 bundle 扫描（同步读目录 + 读写 400KB 文件），并让检测结果缓存，减少 Obsidian 每次启动时插件侧的开销。

## [0.7.3] - 2026-08

### Added

- **自动保存对话（session capture）**：每场对话结束后，确定性把**整场对话**（所有用户消息 + assistant 正文，**不含思考**）写进 `.deepseek/memory/episodes/` 证据层，不再只靠模型三写自觉——补上「该记的没记」这一最大失忆来源（依据 Obelisk 对照，见 `docs/memory/obelisk-comparison.md`）。
  - 粒度：单消息 ≤ 4000 字符、单会话 ≤ 24000 字符，**尾截断**（保留最新）。
  - 幂等：`cache/captured-sessions.json` 按 session 记 `lastSeq` + 文件指纹，只追加增量——**续接旧会话也能正确补新尾巴**。
  - 过滤：只保存 cwd 在本 vault 内的会话；日期归属会话发生日。
  - 触发：dsh 启动 + 每次新会话组装时 fire-and-forget（节流 60s，绝不阻塞 prompt）。
  - 开关：`.deepseek/config.md` `sessionCapture`（0.7.3 默认 `true`；**0.7.4 起默认 `false`**，见该版本条目——默认自动保存与「写入记忆先征得同意」的既定原则冲突）。
- **双面板 UI**：Obsidian 记忆面板 + dsh web 记忆面板都加了「自动保存对话」开关（写 `config.md`）、「立即保存对话」按钮与「N 个会话未保存」角标；`memory-admin.mjs` 增加 host-agnostic 的 `runSessionCapture`/`countUncapturedSessions`/`setSessionCapture`/`readSessionCaptureEnabled`（Obsidian 嵌入 loader 与 dsh web host 路由共用）。
- 零 token 回归 104 → 118 项。

## [0.7.2] - 2026-08

### Changed

- **纠错信号真正进入检索（self-correction.md P1）**：`note_recall` 排除 `superseded` 与 `duplicate_of` 卡（「写时保留」的旧卡不再当活跃候选浮到前列）；`❌` 反馈改为「成功率减半且封顶 0.35 + 验证等级降一级 + 写 `needs_review`/`last_wrong`」；检索打分 hook 先验权重 0.05 → 0.15（BM25 0.85 → 0.75），让 ✅/❌ 反馈真正改变排名。

### Added

- **待重审清单（P2）**：每日体检新增「待重审」段，列出被 ❌ 标记的卡，供模型读 `source` 证据链重判对错。
- **低效用卡自动归档（P3，默认 off）**：新增 `autoArchive` 开关（`.deepseek/config.md` / `agent.cordis.yml`），开启后体检把「零使用 + 长期陈旧(>90 天) + 非用户确认」的卡移入 `.deepseek/archive/records/`（移动而非删除、可逆）。
- **重复合并确定性一步（P4）**：体检给重复对的冗余侧确定性写 `duplicate_of` 链接，检索据此去重。
- **策略卡统一生命周期（P5）**：`note_strategy` 加验证等级先验并记录命中统计；体检读取策略卡顶层 `uses/success_rate/verified` 并确定性 `candidate → active`。
- 零 token 回归 90 → 104 项。

## [0.7.1] - 2026-08-26

### Added

- **dsh-native 分发重构**：dsh 侧交付改为 dsh 原生 bundle 模式——根 `package.json` 声明 `dsh.bundle.patch`，新增 `dsh/cordis.patch.yml`（bundle 补丁）、`dsh/host/index.mjs`（宿主插件：启动同步 preset + 注册 `/memory-panel` 路由 + 自动注册 workspace）、`dsh/host/preset-sync.mjs`（幂等字节比对同步）；现在可 `dsh-math-memory install` 原生安装（写 in-box 骨架 + `dsh plugin add dsh-math-memory`）。
- **安装程序改造**：`dsh/install.mjs` 重写为薄编排器，新增 `install`（原生 `dsh plugin add`）、`install --direct`（离线扁平拷贝）、`status`、`uninstall` 四个命令。
- **owner marker 冲突解决**：`.owner.json` / `.install-manifest.json` 记录归属（`npm` bundle 同步 vs `direct` 直写），双向拒绝异主覆盖，`--force` 接管。
- **对称卸载**：`dsh-math-memory uninstall` 按「可重建 / 不可重建」分级（默认 dry-run；记忆内容仅 `--purge-data` + 确认短语 `DELETE MY MATH MEMORY` 才删）。
- **用户指引**：`docs/installation.md`（安装原理 / 冲突解决 / 卸载用法）。

### Changed

- **移除 `postinstall`**：不再自动装（`dsh plugin add` 是正规路径）；避免 pnpm 11 把 `postinstall` 当 build script 拦截，导致 `dsh plugin add` 失败。
- **Obsidian bootstrap 写 owner marker**：内置直写流程写 owner=direct marker，与 bundle/npm 通道冲突安全。

### Docs

- `docs/dsh-native-refactor.md`（设计规格 + 迁移清单）、`docs/installation.md`（用户指引）；`ARCHITECTURE.md` §2 补新文件索引。

## [0.7.0] - 2026-08-25

### Added

- **记忆陷阱防御（AdaptiveMem 本土化）**：依据新入库文献 MemTrapBench（arXiv:2608.20202），AGENTS.md §5 新增「记忆适用性（防记忆陷阱）」四风险 + 决策流程，`math-memory.mjs` 每轮注入「记忆是候选不是指令」适用性纪律 + 信念扭曲兜底，`note_recall` 补「读前 2-3 条核实适用性——相关 + 已验证 ≠ 适用于本题」。
- **`inapplicable` 反馈动作**：新增「🔁 不适用」——「记忆正确但本题不该用」只记 `last_not_applicable` 标记，不降 success_rate/verified（避免一次误用把正确技巧整体降权）。
- **文献库新增单篇文献 SOP**：`docs/literature.md` 新增「新增单篇文献 SOP」（6 步，供后续 agent 遵循）；入库 MemTrapBench（第 15 篇，已蒸馏）。
- **策略层（strategy layer）**：新增方法层 `strategy/`（strategy 卡：difficulty 主轴 + domain 软轴 + move→retrieve + 抽象阶梯 + 反模式）+ `note_strategy` 工具 + working.md 工作记忆草稿 + AGENTS.md 策略层路由 / iterative retrieval（≤4 步）；依据 Dual RAG / QueryLink / HyPE / MemSearcher 四篇文献，设计规格见 `docs/memory/strategy-layer.md`。
- **基准测试（benchmark）**：仿真 vault（`scripts/qa/benchmark-vault/`，冻结 ground truth）+ 零 token 探针（`seed-probe.mjs`）+ 8 维度 E2E 用例（`benchmark-cases.json`）+ baseline.json 记录 + session log 归档；真实 token E2E 8/8 通过（deepseek-v4-flash）。设计规格见 `docs/memory/benchmark.md`。

### Fixed

- **`lit-import.mjs` 全量覆盖**：原实现从源 BibTeX 重写 `.index.json`/`.manifest.json`/`library.bib`/`index.md` 自动块，用「只含新论文的子集源目录」导入会清空已有条目；现改为按 citekey 增量合并（`library.bib` 只追加缺失 @entry），并验证幂等。
- **`memoDigest` 缺 helpers 必崩**：`buildMemorySection` 的无 helpers fallback 会因无条件调用 `helpers.tokenize` 抛 TypeError；现仅在可打分时 tokenize，无 helpers 时仍能列出备忘录（零 token 回归 82→83）。
- **E2E 驱动器 OOM**：`e2e.mjs` 的 `DSH_SESSIONS_ROOT` 指向真实 `$DSH_HOME/sessions`，对话索引扫描/解码真实长会话日志触发 heap OOM；改为指向临时空目录（基准不扫真实会话）。

### Changed

- **皮肤中心改为可选**：Obsidian 设置新增「启用皮肤中心」开关（默认关）。开启后把 `ui-skin-center` + `ui-web-ui-settings` 追加进 `notes-assistant.patch.yml`（仅当存在 web profile 可镜像 `@linxin666` 包时），在 dsh web ui 的「设置 → 插件 → Web UI 插件」里显示皮肤选择 + 背景透明度；关闭则保持默认的零 dsh-web-ui 依赖。
- **皮肤中心挂载加固 + 动态皮肤禁用**：`skinCenterMountable` 从「web profile 目录存在」收紧为「`dsh-client-ui-skin-center` + `dsh-client-ui-web-ui-settings` 两个具体包都存在」；degrade 模式的皮肤禁用块从硬编码 11 个 skin id 改为运行时读取 `$DSH_HOME/cordis.patch.yml` 动态生成（新增/改名皮肤自动覆盖）；`check-skin-fallback.mjs` 改为断言基础 profile 零 @linxin666 挂载。
- **Obsidian 启动 dsh 不再自动开浏览器**：插件 spawn dsh 时加 `--no-open`，3180 端口页面不再随服务启动弹出到系统浏览器（页面仍在 Obsidian 右侧栏 iframe 内可用）。

### Docs

- 清理文档漂移：设置页版本号 0.4.x→0.6.x；`notes-assistant.patch.yml` / `cordis.patch.yml` 皮肤中心注释改为「可选」语义；`design.md` 版本号与面板现状对齐；README 中英 E2E 用例数 4/4→5 用例；断言数 82→83 全仓统一。
- 记忆陷阱防御配套文档：`docs/changelog.md` 记「AdaptiveMem 本土化 + lit-import 修复」条目；`docs/handoff.md` §3 增量说明、§7 记录后续工作（陷阱压力样例 / 记忆诱发退化被动信号 / note_recall 结构化适用性 / 文献库剩余 13 篇蒸馏）；回归断言 83→85 全仓统一。

## [0.6.4] - 2026-08-23

### Fixed

- **链接补丁兼容两种 dsh 前端渲染器**：本机存在两个 dsh 安装（Obsidian 用的 `E:\software\deepseek-harness\dsh` v0.1.0-rc.6 与 npm 全局 v0.1.1-rc.2），其 markdown 渲染器分别写 `new URL(u).protocol` 与 `new URL(s).protocol`。补丁现同时改写两种写法、按 marker 幂等，loopback `/open`、`/feedback` 链接在两种 dsh 上都不再 `target="_blank"`，点击在 Obsidian 内 iframe 跳转、不再弹外部浏览器。

## [0.6.3] - 2026-08-23

### Fixed

- **链接补丁在「服务已在运行」时也执行**：补丁调用从 `start()` 移到 `ensureStarted()`，避免端口已被占用时跳过补丁导致 loopback 链接仍 `target="_blank"`。

## [0.6.2] - 2026-08-23

### Changed

- **链接路径免手工编码**：AGENTS.md 与注入的链接模板改为「路径原样放入链接即可（中文和 `/` 都不用手工 percent-encode，浏览器会自动处理）」，消除 agent 思考过程中逐字计算 URL 编码的 token 浪费。

## [0.6.1] - 2026-08-23

### Changed

- **链接站内跳转**：Obsidian 插件启动时对已安装的 dsh-web-frontend bundle 做幂等补丁，loopback `/open`、`/feedback` 链接不再 `target="_blank"`（不再跳外部浏览器），改在 iframe 内跳转并由 LinkServer `history.back()` 回到对话。
- **数学交流提示词**：AGENTS.md 开头 persona 改为「数学学习伙伴」，新增「数学交流风格」（少工程腔、公式自然嵌入、先直觉后严格、少元语言）与「少弹窗」节；难度自适应不再弹窗问、改为文末一句话。
- **ask_user 节制**：明确「除非真正需要用户抉择，否则不弹窗；每次只问一个关键问题、选项 ≤3」。

## [0.6.0] - 2026-08-23

> 单仓身份解耦 + 记忆系统开关 + 独立设置面板 + 皮肤中心移除 + 文献库 + 记忆系统强化（两轮）+ dsh web 记忆面板（方案 A 两实例）。QA：`npm test` 82/82 全绿、engine-probe 12/12 全绿；真实会话 E2E 留待用户本机跑。

### Changed（破坏性更名）

- **文件更名**：`obsidian-memory.mjs`→`math-memory.mjs`、`obsidian-notes.mjs`→`note-tools.mjs`、`obsidian-workspace.mjs`→`math-memory-workspace.mjs`、`obsidian.patch.yml`→`notes-assistant.patch.yml`。
- **npm 包更名**：`dsh-obsidian-math` → `dsh-math-memory`（CLI 命令同步更名）。
- **profile/preset id 更名**：`obsidian` → `notes-assistant`（`--profile notes-assistant`）；权限预设 `obsidian-locked` → `math-memory-locked`。
- **环境变量别名**（旧名仍兼容）：`DSH_WORKSPACE_ROOT`（旧 `DSH_OBSIDIAN_VAULT`）、`DSH_MATH_MEMORY_LINK_URL`（旧 `DSH_OBSIDIAN_LINK_URL`）、`DSH_MATH_MEMORY_FEEDBACK_TOKEN`（旧 `DSH_OBSIDIAN_FEEDBACK_TOKEN`）。
- 决定：**保持单仓**（不拆双 git 仓库），两个产物独立分发（npm 包 `dsh-math-memory` + Obsidian 插件 id `dsh-math-assistant`）。

### Added

- **统一 vault 解析** `resolveWorkspaceRoot`（config > env > cwd），memory 与 notes 两模块共用。
- **共享 hook 解析器** `hook-frontmatter.mjs`（+ `HOOK_SCHEMA_VERSION` 版本化），Obsidian 插件经嵌入 loader 复用同一份。
- **templates-manifest.json** 单一事实源，build/install/bootstrap 三处派生 + 构建漏模板门禁。
- **记忆系统开关**：总开关 `enabled` + 粒度开关 `dialogueIndex`/`reminders`/`audit`。
- **独立设置面板**：工作区级 `.deepseek/config.md`（host-agnostic，与 Obsidian/dsh web ui 无关）。
- **`--preset-only`** 安装标志：只装 agent preset 进任意 DSH_HOME（主 dsh 里也能用「数学笔记助手」）。
- **守卫脚本**：`check-rename.mjs`（profile 名一致性）、`check-skin-fallback.mjs`（皮肤降级一致性）、`check-plugin-id.mjs`（插件 id 与目录名一致性），均接入 `npm test`。
- **记忆系统强化（第一轮）**：note_recall 的 hook 先验改为 verified/success_rate/uses 三因素（promote/demote，`hookPrior`）；每日体检新增反模式、低效用归档候选（热度三因素）、检索健康（空结果率）；AGENTS.md 补写卡自动链接、Refine 步、检索粒度纪律；零 token 回归 75→81。
- **记忆系统强化（第二轮）**：`hookPrior` 增加新近度项（90 天线性衰减，recency）；records 模板加 `confidence` 与「可修订记录（置信与备选）」；templates/profile/AGENTS.md 补定理表聚合、条件演化门、写卡去重、env 旧名改 `DSH_MATH_MEMORY_LINK_URL`；零 token 回归 81→82。
- **Phase 2b（dsh web 记忆面板）**：新增 `dsh/client-panel/`（React 面板 + esbuild 打包 + 安装脚本），面板出现在主 dsh web Settings（`settings.section` 槽位），复用 `/memory-panel/*`；已实测可用。
- **面板小项收尾（方案 A 两实例）**：面板 `settings.section` 显示名修正为 `label`（现名「记忆面板」）；面板顶部工作区下拉（宿主 `GET /memory-panel/workspaces` + `workspaceRegistry`）+ 手动 root 输入（localStorage `dsh-math-memory.panelRoot`）；Obsidian 插件新增命令「在 dsh web 打开记忆面板」+ 设置 `memoryPanelUrl`（默认 `http://127.0.0.1:3080/`，`electron.shell.openExternal`）——**两实例架构**：主 dsh web `3080`（编程 + 记忆面板）、notes dsh web `3180`（Obsidian 聊天，fail-closed，不挂任何 `@linxin666`）；`scripts/qa/e2e.mjs` 加固（`--no-open`、`--max-old-space-size`、boot 失败 cause 日志、`DSH_BIN` 用真实 JS 入口而非 shell shim）。
- **Phase 2a（host 面板路由）**：新增 `dsh/host/math-memory-panel.mjs`（inject webServer，挂 `/memory-panel/*`，loopback-only + pathInside 门控，复用 `memory-admin.mjs`）；`install.mjs`/Obsidian bootstrap/`notes-assistant.patch.yml` 接线；boot 冒烟 `GET /memory-panel/state` 返回 `{ok:true}`。
- **Phase 1 解耦（host-agnostic core）**：把 Obsidian 插件里的确定性记忆操作与面板数据层抽成 `dsh/host/memory-admin.mjs`（纯 node:fs/path，注入 hook 解析器）；`build-obsidian.mjs` 嵌入 + 插件 `MEMORY_ADMIN` 加载器；插件本地副本改为别名，消除重复；`npm test` 增 `node --check dsh/host/memory-admin.mjs`。

### Removed

- **皮肤中心挂载**：`ui-skin-center` / `ui-web-ui-settings` 从 `cordis.patch.yml` 移除——记忆 profile 不再依赖任何 `@linxin666` UI 包，有/无 `web` profile 都能干净启动（消除 `ERR_MODULE_NOT_FOUND`）。

### Fixed

- 文档漂移（Critical/High/Medium/Low 全清）：`retrieval-v3.md` 状态头、`v2-proposal.md` 退役标注、`handoff.md` 滞后两版、`design.md` 旧局限、`三个→四个`笔记工具等。
- coverage 阈值统一为 0.35；注入加真实总上限（≤18000 字符）；E2E 端口/probe 路径与脚本对齐。

### Docs

- 仓库文档大改：测试断言数统一为 75（README 中英 / ARCHITECTURE / docs/memory/README）；README 双语旧身份 `obsidian`→`notes-assistant`；design.md 注入段名与 hook schema 版本状态对齐代码；env 旧名改新名（`DSH_WORKSPACE_ROOT` / `DSH_MATH_MEMORY_*`）。
- 结构收敛：`docs/archive/REFACTOR-PLAN.md` 退役（历史档案横幅）、根 `TESTING.md` 并入 `docs/memory/testing.md`（新增本地验收手册）、`docs/memory/README.md` 导航补齐 control-panel/testing/handoff；根 CHANGELOG 只做发布摘要，记忆系统细账统一进 `docs/changelog.md`。
- 新增 `scripts/check-doc-consistency.mjs`：断言数等易漂移数字与代码实测值自动比对，接入 `npm test`。
- 新增文献库子系统（仓库 `literature/`）：`docs/literature.md`（架构规格）+ `scripts/lit-import.mjs`（BibTeX + PDF + MinerU markdown → 双面文献库：人类侧 `cards/`/`reading/`/`notes/`/`index.md`，机器侧 `.raw/`/`.index.json`）；14 条文献全部导入（14 篇均有 MinerU 全文）。
- 新增 `docs/dsh-panel-research.md`：dsh web 面板机制调研（noema/aionui 客户端契约、`settings.section` 槽位字段、web profile 客户端装配显式名单、宿主路由契约）。

## [0.5.1] - 2026-08-16

### Added

- **皮肤中心（背景透明度，仅美观）**：obsidian profile 挂载 dsh-web-ui 皮肤中心（`ui-skin-center`）——皮肤选择 + 背景透明度调节（`skin-background` 设置命名空间），不增加任何 agent 工具；其余 dsh-web-ui 生态功能（任务看板/SSH/aionui/git-graph/宠物/统计等）一律不装，保持最小工具面；皮肤选择与主 web profile 共享。README 中英与 ARCHITECTURE 写明取舍；「README.zh.md 必须始终保留并与 README.md 同步」写入落地清单。真实启动验证通过。

### Fixed

- **皮肤中心在 obsidian 界面不可见**：皮肤卡片渲染在设置页的「Web UI 插件」分组卡（`web-ui.plugin.item` 槽）内，而该分组卡由 `ui-web-ui-settings` 提供——此前只挂了 `ui-skin-center`，卡片注入了槽却无人渲染。现同时挂载 `ui-web-ui-settings`（纯 UI：设置页分组卡 + loopback 设置桥，无 agent 工具）；入口为设置 → 插件 → Web UI 插件 → 皮肤中心。无 web profile 可镜像时（降级模式），插件在 `--patch` overlay 同步禁用该条目，保证 profile 仍可启动。

## [0.5.0] - 2026-08-16

### Added

- **低危清单清理（handoff 序 4）**：`note_search` 排除 `.deepseek` 记忆树（记忆文件仍走 grep/read；note_links/note_retrieve 不变）；episode 归档同步改写 records 卡 `source` 链接（溯源链不断）；探测到端口被非本插件服务占用时给出一次性 Notice 提示（keepAlive 场景自动豁免）；README/`cordis.patch.yml` 对 `DSH_PERMISSION_MODE` 的措辞改为“仅重开交互式提权、沙箱仍 workspace-write”。
- **回复质量与捕捉协议（prompt 层）**：AGENTS.md 新增「学习对话原则」（直觉先行 / 认知锚定到用户笔记 / 难度自适应 / 苏格拉底式纠错 / 学习场景适度展示思路 / 低频检查性收尾 / 陌生记号定义）；persona 补学习伙伴定位。捕捉提案升级为「一句话想法 + 为什么值得 + 拟写入类型与关联条目」，auto 档写入后回复末尾注明「已捕捉」，fact/preference 的 ask 档与想法提问合并为每轮最多一次。
- **记号体系（notation system）**：新增 `.deepseek/memory/notation.md`（已采纳/候选/已否决三表 + 修订历史，模板随 bootstrap/安装器/部署三路安装）；AGENTS.md 增「收集→统一→维护」协议——收集不打扰、发现不一致时提议统一（现状两例+推荐+取舍理由，ask_user 确认后采纳）、用户无统一习惯时先观察再提、偏离时温和提醒；记号摘要（≤800 字符）每轮注入系统提示；profile 的记号节改为指向体系文件。回归 +1。
- **设置页捕获策略**：插件设置新增「捕获策略」区——想法/事实/偏好三个下拉框（ask/auto/off，带效果说明），选择结果直接写入 vault 的 `capture-policy.md`（含 updated 日期刷新，文件缺失时用内嵌模板补建）。
- **检索 v3 S6（审计结构校验）**：每日体检新增确定性结构检查——records 卡缺 `source`、`source`/`related` 链接悬空（断链）、卡片未登记进 `records/index.md`；报告注入「结构校验」行，AGENTS.md 增对应兜底规则（三写第 2 步的体检保险）。回归 +4。
- **检索 v3 S5（导航式注入）**：移除每轮无条件注入的 2200 字符「本轮记忆召回」段与全部召回语料机制（`buildRecallIndex`/`rankRecall`/`recallDocsFor` 及 recall* 配置）；系统提示只保留静态导航层（主题/记录/模板/事件索引 = “有什么”），相关内容全部按需经 `note_recall` 拉取——每轮省约 2K 字符注入，且检索语义与工具完全一致。回归 56 项调整为 54 项（召回排序断言退役，导航断言 +3）。
- **检索 v3（S1-S3，retrieval-v3.md）**：统一入口 `note_recall`——BM25（k1=1.2,b=0.75）对「用户笔记 + 全部记忆层」一次排序（kind-aware passage：hook 卡强调 hook 字段、笔记带 tags+正文头、索引类保留行内容），hook 命中统计迁移至此，算子硬过滤与 tag 过滤降为可选参数；分词加 Unicode 连字符归一与 CJK 字符包含（桥接 子列/子序列 类词形差，真实 vault 探针验证：子列选取查询备忘录 #1）；`note_retrieve` 退役（纯函数保留供审计复用）；AGENTS.md §0/§4/§5 重写为「蒸馏强制格式 + 精读挑选 + 空结果/重试上限 + 顺链扩读」协议。回归 47 → 56 断言。
- **hook 趋势可视化（handoff 序 3）**：每日体检把各 hook 卡的 `uses/success_rate` 快照追加进 `cache/hook-history.json`（同日更新原位、每卡 30 点/全局 500 卡有界）；记忆面板卡片行渲染近 5 点迷你趋势（如 `📈 4@0.8→6@0.9`）。回归断言 +4。
- **面板内编辑记忆（控制面编辑闭环）**：预览弹窗新增「编辑」——textarea 直改 + 「保存」（写入前做 mtime 冲突检查，文件在别处被改则拒绝覆盖并提示）；保存后自动刷新面板。捕获策略文件在面板摘要中可点击直接编辑（`.dsh-memory-policy-link`）。
- **捕获策略分级（控制面 1c）**：vault 内 `.deepseek/capture-policy.md`（用户维护）以 `idea/fact/preference × auto/ask/off` 控制捕获节奏——auto=按三写协议直接写入、ask=先征得同意、off=不主动捕获；默认（想法 ask、事实/偏好 auto）与既有行为一致。策略随系统提示注入（obsidian-memory），记忆面板摘要展示当前档位，模板随 bootstrap/安装器安装；AGENTS.md §2/§6/§7 同步；回归断言 +5。

## [0.4.1] - 2026-08-16

### Fixed

- **反馈链接 token 接线**：`/feedback` 端点带 CSRF token（`t=`）后，注入给模型的链接模板从未带 token——回复里的 `[✅ 这条对]` / `[❌ 这条错]` 点击必 403。`obsidian-memory.mjs` 现在读取 `DSH_OBSIDIAN_FEEDBACK_TOKEN` 并把 `&t=<token>` 拼进 `/open` 与 `/feedback` 链接模板；`/open` 端点同时加上同一 token 校验（此前任何网页的 GET 都能触发打开、甚至创建笔记）；AGENTS.md §8 同步（回归断言 +3）。

- **dialogue-index 缓存加 schemaVersion**：旧代码（无 vault 过滤）写出的磁盘缓存会被新代码按指纹直接复用，跨工作区会话内容随之注入提示。索引现在带 `schemaVersion: 2`，`readCachedIndex` 只接受同版本缓存，语义变更后旧缓存强制重建（回归断言 +4）。

- **皮肤降级 fallback 时序**：`syncGlobalPackageLinks` 追加的 skin-disable 块会在 autoStart 的 `ensureObsidianPatch` 刷新时被擦除，降级保护从未生效。刷新现在提取并重放该块，两处 marker 收拢为共享常量。

- **卸载清理**：全局 `error` / `unhandledrejection` 监听与 `Notice.prototype.setMessage` 补丁在 `onunload` 时移除/恢复（补丁仅在仍属本插件时恢复）。

## [0.4.0] - 2026-08-16

### Added

- Memory-v2 strategy retrieval: `note_retrieve` tool in `dsh/preset/obsidian-notes.mjs` — parses the optional `hook:` frontmatter block on memory cards (operator / pattern / heuristics / quantity / techniques / applications / verified, informed by arXiv:2606.31191 ISM and EMNLP 2025 Findings 1162 Dual RAG), then runs two-stage retrieval: operator hard filter + weighted scoring (0.55 token-IDF similarity, 0.15 structural pattern, 0.15 heuristics, 0.05 quantity, 0.10 success-rate/uses prior). Falls back to full-text token ranking when the vault has no hook cards; records hits into `.deepseek/cache/retrieval-stats.json`.
- Deterministic memory health check in `dsh/preset/obsidian-memory.mjs`: scans records/templates frontmatter + hook fields at most once per vault per `auditIntervalMs` (default 24h), writes `.deepseek/cache/memory-audit.json`, classifies cards (strong / weak / unused / duplicate candidates / unverified), syncs retrieval statistics back into `hook.uses` / `hook.last_used` (block-style hooks only, opt-out via `auditMaintainHookStats: false`), and injects a bounded audit section (≤1200 chars) into every system prompt.
- Memory verification levels (`hook.verified`): `single-source` / `cross-referenced` / `user-confirmed`; upgrades require user participation and the audit flags stale single-source cards.
- Hook-block conventions and audit response rules added to vault `AGENTS.md`, `records/_README.md`, and `templates/_README.md` templates.
- `docs/memory/` knowledge base: current design, assessment history (two rounds), memory-v2 proposal with implementation status, paper notes, and a memory-system changelog.
- Memory control surface phase 1a: `/feedback` loopback endpoint in the Obsidian plugin (confirm → `verified: user-confirmed` + success_rate floor 0.9; wrong → success_rate halved; stale → `status: superseded`; forget → archive to `.deepseek/archive/records/`, never a hard delete) with vault-containment and action whitelisting, plus verification badges (✅/⚖️/❓) and feedback-link rendering rules in the memory prompt section and AGENTS.md. Design spec and injection-approach evaluation in `docs/memory/control-panel.md`.
- Obsidian memory panel (control surface phase 1b): a `dsh-memory-panel` ItemView with five-layer memory browsing (records/templates/memos with hook stats — uses, success rate, verification badges — plus episodes and the daily audit report), search, per-card ✅ confirm / ❌ wrong / supersede / archive buttons (reusing the phase-1a deterministic frontmatter surgery; archive moves into `.deepseek/archive/records/`, never deletes), a >90-day episode archive button, an error-surfacing render path with a diagnostics footer, and settings-page + command-palette entries (view tab uses the brain icon; no separate ribbon button). Clicking a card opens an in-panel preview modal (Obsidian's vault index excludes dot-folders, so hidden `.deepseek` files cannot be opened through any TFile/openLinkText API — the modal reads them via node fs and offers copy / reveal-in-explorer / open-with-default-app).
- Zero-token memory regression check `scripts/test-memory.mjs` (26 assertions: hook parsing, tokenization, retrieval scoring order, audit classification, hook-stats sync semantics, recall ranking, memo relevance, dialogue pairing, cache freshness), wired into `npm test`. Deliberately NOT a benchmark: no public benchmark fits a personal-vault memory assistant, and model-scored benchmarks would spend tokens continuously — see `docs/memory/v2-proposal.md` §6.
- Recall-based prompt injection (the memory v2 P0-1): static index budgets slimmed (topics 1800 / records 800 / templates 600 / episodes 1200 / inbox 1200 chars) and a per-request 「本轮记忆召回」 section injects the top-k cards/memos/topics/episodes scored against the current user message (IDF-weighted token overlap, mtime-fingerprinted corpus cache). Configurable via `recallEnabled` / `recallTopK` / `recallMaxChars`.
- Dialogue index quality: only sessions whose cwd lives inside the vault join the index, and each user message pairs with the FINAL assistant reply of its turn instead of the first.
- Memo reminders now use relevance × recency (0.7 relevance + 0.3 recency): a memo being actively discussed surfaces even before it goes stale.
- Incremental note-text cache for `note_search` / `note_links` / `note_retrieve` (mtime+size validated per file, so repeated vault scans no longer re-read unchanged notes).
- Security/quality hardening: `/feedback` CSRF token (`t=` param, passed via `DSH_OBSIDIAN_FEEDBACK_TOKEN`), automatic skin-disable fallback when the web profile is missing, serialized retrieval-stats writes, installer drift detection (installed files must equal repo sources), and debug.log rotation at 1 MB.

### Fixed

- `readdirSync` was never imported from `node:fs` in the Obsidian plugin, so `archiveOldEpisodes` threw a ReferenceError that its own try/catch swallowed — episode archiving (>90 days) silently never ran (always reported moved: 0). The import is restored; archiving and the new memory panel both work now.
- Obsidian profile failed to boot with `Cannot find package '@linxin666/dsh-client-ui-skin-*'`: the web skin manager writes a global patch (`$DSH_HOME/cordis.patch.yml`) that inserts the ACTIVE skin into EVERY profile, and the obsidian profile carried no skin packages. Durable fix: the plugin mirrors every `@linxin666` package from the web profile's `node_modules` into the obsidian profile via junctions (`syncGlobalPackageLinks`), so any current or future skin resolves — and per user preference the obsidian profile now intentionally APPLIES the active skin (no disabled rows, no id lists), following whatever skin is picked in the main web UI.
- Memory panel opened blank with a toast `e.toLowerCase is not a function`: the panel's note-opening helper was named `open`, which collides with Obsidian 1.13's view-lifecycle `open(containerEl)` method — Obsidian's mount call hit the helper, the container was never appended (blank panel), `onOpen` never ran, and the container object was passed to `openLinkText`. Renamed to `openNote` with a string-type guard, and documented the pitfall in the code.
- Clicking memory cards failed with `Folder already exists`: Obsidian's vault index excludes every path segment starting with `.` (verified against the 1.13.7 bundle), so `.deepseek` files are invisible to `openLinkText`/TFile APIs and the unresolved link triggered a create attempt. Cards now open the in-panel preview modal instead of attempting navigation.
- `hook.uses` double counting: the audit merged `retrieval-stats.json` hits into the cards but never reset the stats, so every daily audit re-added the same hits. Merged entries are now zeroed after sync.
- AGENTS.md self-contradiction: the weak-card audit rule told the model to reset `success_rate`, which the hook discipline forbids. The rule now leaves success_rate to the plugin.
- Main-view activation had the same missing null-leaf fallback that once blanked the memory panel; `activateView` now mirrors `activateMemoryView`'s hardened path.

## [0.3.1] - 2026-08-16

### Fixed

- Auto-register the Obsidian vault as a dsh workspace at service boot (`obsidian-workspace.mjs` + `obsidian.patch.yml`, passed via `dsh --patch` by the plugin), so the sidebar workspace picker always has the vault available and no directory-selection flow has to run inside the Obsidian iframe.
- Fix workspace selection doing nothing: `obsidian-notes.mjs` resolves `@deepseek-ai/dsh-tools` through the profile `node_modules` fallback (`ctx.root.baseUrl`) and `obsidian-memory.mjs` injects `loader`, so the `obsidian` agent preset mounts and `session.create` succeeds.

## [0.3.0] - 2026-08-15

### Added

- Three dedicated note tools in the `obsidian` agent preset, registered via `defineTool` (`dsh/preset/obsidian-notes.mjs`):
  - `note_search` — full-text vault search with optional tag filtering;
  - `note_create` — create a new note only, refusing to overwrite existing notes;
  - `note_links` — wikilink backlink queries (one note or the whole vault).
- The note tools are applied through `obsidian-memory.mjs` (always refreshed on update), so existing 0.2.0 installations activate them without a forced preset reinstall.

### Changed

- READMEs reordered so the "Problems solved" section appears right after the introduction.
- Version references updated across README, vault `AGENTS.md`, preset description, and plugin settings tab.

## [0.2.0] - 2026-08-15

### Added

- Loopback link server in the Obsidian plugin: note references in agent replies become clickable links (`/open?path=...`) that jump straight to the note in Obsidian; files still use `[[wikilink]]`.

## [0.1.2] - 2026-08-15

### Changed

- Plugin display name renamed from "DSH Obsidian Math Assistant" to "DSH Math Notes Assistant" (directory rule: names must not contain "Obsidian").

## [0.1.1] - 2026-08-15

### Changed

- Obsidian plugin id renamed from `dsh-obsidian-math` to `dsh-math-assistant` to comply with the community directory rule that plugin ids must not contain `obsidian`.

## [0.1.0] - 2026-08-15

### Added

- Obsidian community plugin: right-sidebar dsh web view, automatic dsh detection/start/stop, first-run bootstrap of the `obsidian` preset/profile and vault memory templates, ribbon button, settings tab with logs.
- dsh npm plugin: `dsh-obsidian-math` CLI installer for `$DSH_HOME/.agent-presets/obsidian` and `$DSH_HOME/profiles/obsidian`, optional vault template seeding, idempotent with `--force` support.
- `obsidian` agent preset: minimal file-only tools (`read`, `write`, `edit`, `glob`, `grep`, `read_image`, `ask_user_question`).
- Layered long-term memory plugin (informed by arXiv:2606.24775): profile / topics / episodes / inbox, path-independent vault resolution, zstd session-log dialogue index with caching.
- Typed atomic-record memory layer (fact/event/instruction/preference with provenance links), informed by arXiv:2607.05794 (NapMem).
- Rethlas-style proof workflow: reasoning primitives, generate-verify loop, personal theorem index, and artifact records (arXiv:2604.03789).
- Personal template-theorems graph: problem/solution template cards linked to theorems, with distillation-first retrieval (AAAI-26 40411).
- Idea memo library with lifecycle `inbox → polishing → done`, frontmatter scanning, stale-candidate reminders, and proactive polishing prompts.
- GitHub Actions: CI build/test checks and tag-triggered release asset publishing.
- Bilingual README with language switch buttons.
