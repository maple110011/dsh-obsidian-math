# Changelog

> 本文件是**发布级摘要**（每个版本「改了什么」，面向用户与发布）。记忆系统「为什么改、怎么改」的细账见 [docs/memory/changelog.md](docs/memory/changelog.md)；现状/坑/决策见 [docs/memory/handoff.md](docs/memory/handoff.md)。

## [0.7.5] - 2026-09-10

### Fixed

- **体检报告不再只是「dsh 的输出记录」**：`buildAuditReport` 过去只产出一根字符串，它同时被①注入模型提示、②写进 `cache/memory-audit.json`、③被两个面板**原样**显示——于是用户看到的字面文本是 `- 低效用归档候选（0.5×可靠性+0.3×频次+0.2×新近度）: [[.deepseek/memory/records/optimal-coupling-cyclically-monotone|最优耦合 ⟹ 集中在 $c$-循环单调集…]](0.327)——向用户建议处置，不自行删除。`（用户原话：「几乎就是 ds 的输出记录，令人不知所云」）`现在拆成**两个渲染、一份数据**：`checklist`（模型看的简明指令清单）与 `human`（人看的中文摘要），结构化事实放进 `counts` / `decisions` / `thresholds` / `sections` / `structural` 并带 `schemaVersion: 2`。两个面板今后渲染 `human` 与结构化字段，模型清单退到「查看模型版清单」折叠里。
- **体检报告不再把刚归档的卡列成「建议归档」**：`moveCardsToArchive` 在报告行构建**之前**执行，而报告从移动前的数组取数——`autoArchive` 打开时，报告会建议归档一张**已经不在库里**的卡（文件已被移走，点按钮就是死链）。现在所有 section 与 `decisions` 计数统一按「归档后仍在库中」过滤，`counts.cards` 同步扣减。
- **面板不再丢掉数据层已经算好的信息**（同一份 JSON，两个面板此前各显示不同子集）：
  - `collectMemoryState` 现在收集**全部五个卡片层**（记录 / 模板 / 主题 / 定理 / 策略）。此前只收集 records + templates，于是文档反复承诺的「五层」里有三层（topics/theorems/strategy，真实 vault 里确实有卡）在两个面板都**不可达**——只有主题卡或策略卡的 vault 会被判成「记忆库还是空的」。
  - episode 现在带**人类标题、主题与日期**（解析 `memory/episodes/index.md`）。此前只显示 `2026-09-02-session-8e8ae65a….md` 和**捕获写盘时间**——同一次捕获写入的多条 episode 时间戳完全相同（实测两条都显示 `2026/9/10 09:16:21`），所以「事件时间线」既没有时间也没有线。
  - `topic`（用户按主题浏览记忆的主维度，此前可搜索却从不显示）随卡片返回；卡片还带上 `layer`。
  - 新增 `readAuditReport`：`readAuditText` 只取字符串，把 `generatedAt`/`counts`/`structural`/`archiveCandidates` 全丢了（面板因此显示 09-09 的「共 3 张卡」而实时摘要是「记录 2」——同屏两个卡数）。
  - 搜索：haystack 转小写却拿原样 needle 比较，`De Finetti` 这类带大写字母的查询一条也搜不到；episode 此前完全不参与搜索。
- **「对 / 错 / 归档」三选项改为分层，并补上回执**（用户：「令人不明所以，从日常使用来看感觉意义不大」）：
  - 回复末尾的反馈行改为**每张卡一行、并写明是哪张卡**：`依据的记忆：<卡标题> — [✅ 这条对] [❌ 这张卡有错]`。旧模板给 N 张卡发 N 行**一模一样**的 `[✅ 这条对]`（只有 URL 里的路径不同），而「这条」在中文里读作「这个回答对不对」，实际动作却是对该卡的**永久判定**。
  - `归档` 从评估行里移出（它是**文件移动**，不是第三个评价），两个面板的按钮改为 `✅ 确认` / `❌ 有错` / `过期` / `归档`，归档带二次确认与危险样式；补一行徽标图例 `✅ 已确认 · ⚖️ 与他处互证 · ❓ 单次来源`。
  - **dsh web 面板的按钮第一次有回执**：它的 `run()` 丢弃响应体，点任何按钮界面上什么都不显示（Obsidian 侧有 Notice）；而唯一显示的 `success=` 对真实卡片永远是 `—`——等于让人对一个不存在的数字表态。现在显示宿主返回的中文回执或错误。
  - **`❌` 不再凭空发明 `success_rate`**：旧实现按 base=0.5 写入 0.25，回执却写「成功率减半」——从"没有评级"变成"看起来量过的评级"。现在只有卡上**已有** `success_rate` 才改它；无评级卡只降 `verified` 一级并写 `needs_review`。
  - **没有 `hook:` 块的卡不再没有反馈入口**：旧实现直接返回「该卡片没有 hook 块」，两个面板也把 ✅/❌ 藏起来——**证据最弱的卡反而最不能纠错**（`handoff.md` 早已登记为未做项）。现在 `applyFeedback` 为该卡补一个空 `hook:` 块；行内 flow 写法仍明确拒绝而不是盲改。
- **web 面板刷新不再污染搜索框**：它唯一的刷新杠杆是 `setQ(q === "" ? " " : "")`，点一次「立即保存对话」搜索词就变成一个空格（URL `?q=%20`）。改用已有的 `tick` 计数（`&t=N`）。
- **版本漂移与发布链路**（package.json 0.7.3 / manifest.json 0.7.4 / CHANGELOG 0.7.4 / npm `latest` 0.7.1，而 0.7.2–0.7.4 **从未推过 tag**）：新增 `scripts/check-version-consistency.mjs`——`package.json` / `manifest.json` / `package-lock.json` / `versions.json` / `CHANGELOG.md` 五处必须同号（带 `--tag` 时还要求 tag 等于版本号、且版本是纯 `x.y.z`，因为 Obsidian 注册表拒绝预发布号）；`versions.json` 补上 `0.7.5`；三方版本对齐到 **0.7.5**。`release.yml` 补上 `npm ci`、版本/tag 一致性、重建 `main.js` + `git diff --exit-code`、`npm test`——**推 tag 的发布流程此前不跑任何测试**；Release notes 改用 `awk -v v="$GITHUB_REF_NAME"` 抽取该版本段落（原来的写法取的是 `## [Unreleased]`）。发布步骤见新增的 [docs/release.md](docs/release.md)。
- **检索回归网不再测"陈旧的手抄公式"**：两个零 token 探针（`scripts/qa/engine-probe.mjs`、`seed-probe.mjs`）此前各自复刻了一份打分公式 `0.85*BM25 + 0.10*cjk`，而产品用的是 `0.75*BM25 + 0.10*cjk + 0.15*hookPrior`，且探针**从不调用** `isRecallEligible`（superseded/duplicate 排除）、operator 硬过滤与 `maxResults`——权重在 08-30 改过而探针停在 08-25，于是**纠错机制上线后完全没有自动化看守**。现在把产品管线抽成 `buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`（`dsh/preset/note-tools.mjs` 导出），`note_recall`、`note_strategy` 与两个探针**调用同一份代码**：探针测的就是产品跑的。
- **导航索引不再压过它指向的内容**：`episodes/index.md` 列出每条 episode 的标题+主题，因此对几乎任何中文查询都有很高的原始字符覆盖率，实测把「库中无答案应给弱信号」的控制项顶掉（score 0.95 / coverage 0.86），并挤占真实命中的名次。新增按 kind 的语料权重（`episode-index` 0.4、`theorem-index` 0.7）把它降权。**真实 vault 探针因此从 9/12 回到 12/12，且没有改动任何一条 ground truth**（Fubini-Tonelli 由 rank 2 → 1，子序列记法由 rank 7 → 5）。
- **`captureSubagents`：子代理会话默认不进记忆**。子代理会话会重放父会话前缀，保存它等于把同一场对话重复写进证据层、并稀释每轮注入预算。dsh ≥ 0.1.5 的 V3 头部新增 `origin: subagent` / `delegationDepth`，第一次让这件事**可判定**；preset 的捕获路径与 host 侧的面板计数用同一规则（`distillSession` 记录 `isSubagent`），V2 头部没有这两个字段因此无法区分、一律保留。`config.md` / `agent.cordis.yml` 已加该开关（默认 `false`）。
- **junction 镜像会自愈了**：`syncGlobalPackageLinks` 只用 `existsSync` 判断是否已镜像，而 `existsSync` **跟随**链接——web profile 重装或包改名（0.3.20 聚合包替换了 `dsh-web-ui-all`、退役了 `dsh-perf`/`dsh-desktop-launcher`）后，悬空链接被判"不存在"，`symlinkSync` 随即 EEXIST 且被裸 catch 吞掉，这段"持久修复"就永久失效且**不留任何日志**（本机实测积了 7 个死链接）。现在用 `lstatSync` 识别条目、只在"是 junction 且目标已消失"时删除重建，并记录失败项。
- **皮肤中心开关的文案与语义对齐**：自 dsh-web-all 0.3.20 起聚合包已自带皮肤中心，本机这个开关在功能上冗余；改名为「挂载皮肤中心 UI（高级 / 通常无需开启）」并写明两点——它只覆盖"有皮肤包、没有聚合包"的 web profile；**关掉它不会关掉皮肤**（皮肤本体走全局 `$DSH_HOME/cordis.patch.yml` + junction 镜像，侧栏照样跟随主界面选的皮肤）。默认值保持 `false`。
- **`dsh/preset/math-memory.mjs` 里还有 4 处同类的 `$` 替换模板缺陷**（本轮回归检查时发现）。审计写入路径（`syncHookStatsToCard`、`syncTopLevelStatsToCard`、重复卡标记 `duplicate_of`、候选策略卡转正）都用 `text.replace(fmMatch[1], rewritten)`：第二个参数是**替换模板**，所以 agent 写的 frontmatter 里的 `$$`／`$&`／`$'`／`` $` `` 会被展开——而这是**每日审计自动触发**的，比点按钮更隐蔽。已改为按偏移量拼接（新增 `replaceLeadingFrontmatter`，与 memory-admin 的 `replaceFrontmatter` 同一原理），并补了对照测试：先用旧写法复现损坏（标题行被截断成 `title: 关于 $ 的表示 与 ---` 且 frontmatter 块二次注入），再断言新写法保留原文并落盘改动。
- **Obsidian 侧栏在 dsh 0.1.5 上不再显示 401 文本页 —— 真正的修法是主进程反代**。上一轮只做到"抓到 token 并让 iframe 加载带 token 的地址"，实测证明导航发生了（`[render] iframe src -> …?token=…` 紧跟 `[iframe] load`）**但界面仍是 401**。根因是 dsh 的会话 cookie 带 **`SameSite=Strict`**：侧栏是 iframe（顶层 `app://obsidian.md`、框架 `http://127.0.0.1:3180`，**跨站**），这种 cookie 在跨站子框架里既存不下也发不出。现在：
  - dsh 以 `--port 0` 启动（内部端口），**插件在主进程里跑一个反代监听用户配置的端口**（默认 3180），浏览器只与代理通信 —— cookie 的权威（`dsh-auth-<sha256(host:port)>`）因此稳定且第一方；
  - 代理用 `http.request`（`fetch` 会忽略 Host）**以公共权威**兑换启动 token 并保存 cookie，随后给每个转发请求注入 `cookie`、把 `host` 改写成公共权威（dsh 按 `Host` 决定 cookie 名），并剥掉 `set-cookie`/`x-frame-options`/`content-security-policy`；
  - `/api/` 前缀的 WebSocket 升级照常转发（实时更新依赖它）；
  - 就绪判定改为"代理在配置端口上能供出已认证界面"；`stop()` 关闭代理并清 cookie。
  - 落地前做过一次性可行性实测（权威匹配、首页 200/28884 字节含 `__DSH_BOOT__`、资源 200/516675 字节、`/api` 非 401/403、`/api/remote.mux` 升级 101），全部通过。
- **`check-embedded-loader.mjs` 不再自证**：它此前比对的**是自己那份** `return {…}` 名单（审计用变异实验证明：从模板删掉 5 个被消费符号后它仍 exit 0）。现在它从模板里**读取**真实的参数表、`return {…}` 白名单与追加的 helper，断言"白名单覆盖模板消费的每一个 `MEMORY_ADMIN.*`"、"白名单里的每个符号都能解析"、"参数表与实参表一致"，并**自测**"抽掉任一被消费符号必须被发现"。
- 安全性：`/memory-panel/*` 路由不再把"约束根"交给调用方，并拒绝跨源请求。此前 `body.root`／`?root=` 直接**就是**约束根，`pathInside(root, target)` 因此对任何不含 `..` 的 `rel` 都是恒真——攻击者同时决定两端。加上路由只校验 loopback（而"任意网页"可以用 `content-type: text/plain` 发 CORS 简单请求、无需预检），实测后果是**任何网页或本机进程能移动任意路径下的任意文件**（评估报告 §2 P0-1，已复现）。现在：
  - `root` 只在重启述 profile 启动时确定的 vault（`DSH_WORKSPACE_ROOT`／`DSH_OBSIDIAN_VAULT`），不同路径一律 403 `root not allowed`；
  - 任何带**非 loopback `Origin`** 的请求直接 403（含 `Origin: null`）；带 loopback Origin 或无 Origin 的本地客户端照常；
  - 配置了 `DSH_OBSIDIAN_FEEDBACK_TOKEN` 的实例（Obsidian 插件启动的那个）要求每个请求携带 token（`X-DSH-Token` 头、`?t=` 或 body），定时安全比较。
- **`archiveMemoryFile` 现在校验源**：只接受 `.deepseek/<层>/…` 下的 `.md` **常规文件**，拒绝普通笔记、整个目录、`capture-policy.md`／`config.md`、含 `..` 或盘符的路径、以及 vault 根本身（此前这些全都能被"归档"，已复现）。归档目录改为**校验通过后**才创建——之前被拒的请求会在 vault 里留下空的 `.deepseek/archive/records/`（实测发现并修掉）。
- **写入记忆卡片不再损坏文件**（两个静默数据损坏模式，均由面板 ✅/❌ 按钮触发）：
  - `text.replace(spanText, newText)` 会把**第二个参数当替换模板**解释，于是 agent 写的 frontmatter 里的 `$$`／`$&`／`$'`／`` $` `` 被展开——数学库里 `title: 关于 $$ 的表示` 会变成 `关于 $ 的表示`，`$&` 更会把整段 frontmatter 注入标题（62→149 字节）。项目自己在 `scripts/build-obsidian.mjs` 早就为构建脚本规避过同一个坑。
  - frontmatter **体为空**时搜索串是 `""`，`replace("", x)` 在偏移 0 **插入**而非替换，收尾的 `---` 被推到文件中间，而 UI 报"已成功"。
  - 改为按**偏移量拼接**（新增 `frontmatterSpan`／`replaceFrontmatter`，两份自包含副本同步），空体与 CRLF 都保持良构；`setHookField`／`setTopField` 也不再给空体留空行。
- **链接跳转服务不再对已解码的参数二次解码**：`URLSearchParams.get()` 返回的已是解码值，再 `decodeURIComponent` 一次会让**任何含 `%` 的路径**（数学笔记常见）抛 `URIError`；该语句原本在 `try` 之外，异常逃出请求监听器，**点击永久挂起无响应**。现在删掉两处二次解码，并把整个 handler 包进 try/catch，异常一律回 500 并写日志。
- **`install-into-profile.mjs` 不再静默失败**：它把 insert 锚在结尾的 `]`（flow 风格），而仓库里三个 patch 文件都是 block 风格、没有 `]`，于是 `replace` 原样返回、脚本照样写回并打印成功——客户端面板进 profile 的**唯一**途径从来没生效过。现在改为在末尾**追加** block 风格 `insert:`，写入后断言文件确实含包名，否则 exit 1。
- **`/memory-panel/workspaces` 不再要求 `?root=`**：root 守卫原本在路由分发之前，而面板前端正是裸 fetch 这条路由 → 400 → 工作区下拉框永远是空的。该分支现在排在 root 门禁之前（它只读 registry，不碰 vault）。
- **`capture-policy` 路由校验 `field`／`mode`**：`field` 会进入 `new RegExp("^" + field + ":")`，`a.c` 能改到无关行、`idea|fact` 会同时毁掉两个真实键。现在只接受 `^[A-Za-z_][A-Za-z0-9_-]{0,63}$` 与 `^[a-z]{2,16}$`。

### Changed

- **侧栏卡顿：第一轮修的**不是**真因，第二轮用 CDP 实测定位后修对了**。用户报告「Obsidian 里的 dsh 界面很卡顿，展开侧边栏时尤其明显」，第一轮从皮肤 CSS 推断是「跨帧毛玻璃」（`backdrop-filter`）并上线了样式注入；**用户复测仍然卡，且主 dsh web（3080）也卡**。第二轮改用 headless Chromium + CDP 驱动**真实 dsh**（真实皮肤、真实前端、真实鼠标事件做 6 次侧栏开合），做同轮对照实验：
  - 皮肤 **CSS 全部移除**（JS 仍在）：帧 >50ms 3→4、最差帧 84→83ms、样式重算 1172→1165ms —— **一点没变**；
  - 皮肤 **JS 停用**（CSS 仍在）：帧 >50ms 3→**0**、最差帧 84→**33ms**、长动画帧 8→**0**。
  真因是皮肤 `orca-link` 的**客户端脚本 `hooks.mjs`**：约 14 个 subtree MutationObserver、一个约 5 次/秒改状态角色内联样式的循环、以及一个跟着侧栏动画**每帧**触发的 ResizeObserver（读布局 → 写 body 级 CSS 变量 → 翻 `body[data-orca-sidebar-wide]`，每次都是全文档样式重算）。同一个皮肤在 Obsidian 侧栏与 3080 都在跑，所以两边一起卡——这也解释了「为什么 CSS 修完还卡」。
  - 处置（两档，都在代理里完成，**不改皮肤文件**）：**侧栏性能模式**现在除样式表外还会改写 `hooks.mjs` 的两处热循环（ResizeObserver 改 180ms 尾边沿防抖、角色循环下限提到 1s），锚点全中才改、皮肤更新后自动原样返回并记日志；新增开关**「侧栏加载皮肤动态装饰」**（默认开），关掉后把该模块换成空实现（保持导出契约），实测最流畅（Task −18%、样式重算 ops −34%、LoAF 归零），代价是侧栏里的 hero 场景/状态角色/信号芯片消失。
  - 经**已发布代理**端到端复测：性能模式开（装饰保留）帧 >50ms 2→**0**、最差帧 67→34ms、LoAF 5→1；关装饰后 3 帧 >33ms、0 帧 >50ms、最差 33ms、LoAF 0。
  - 其余第一轮的改动保留（iframe 隔离 `contain`/`translateZ(0)`、侧栏收起时 `display:none` 挂起并每秒自检、`writeDebugLog` 改异步批量、记忆面板搜索 220ms 防抖）——它们各自省开销，只是**不是**这次卡顿的主因；完整原因清单（11 条）与自查用 DevTools 片段见 [docs/memory/sidebar-performance.md](docs/memory/sidebar-performance.md)。
  - 回归：`test-panel-proxy.mjs` 15 → **31** 项（注入 9 项 + 皮肤脚本改写 5 项 + 原有反代断言）。**这套断言在开发中抓到一个会白屏的真实缺陷**：改写后的响应同时带着上游的 `transfer-encoding: chunked` 与新的 `content-length`，客户端判协议违规（`Content-Length can't be present with Transfer-Encoding`）。
- **GraphMemix（Li et al. 2026）可吸纳点：测量、采纳与不采纳都写进设计**。新读的这篇论文（`literature/cards/liGraphMemixQueryAwareEvidence2026.md`）与本项目已有的几件机制重复的部分不再重做（边界门控 / `harmed` / `verified_by` / 声明值与有效值 / `degraded`），本轮把**其余可吸纳点逐条落成决策**（[docs/memory/retrieval-v3.md](docs/memory/retrieval-v3.md) §7）：
  - **多视图 max-pool：实现了、测过了、不采纳**。`composePassageViews()` 把 passage 拆成 `title` / `keywords` / `body` 三个视图（字段集合与单袋一致，只改池化），`rankRecallDocuments(…, { viewPool: "max" })` 按视图各自的长度统计打分再取最大值，`viewPool` 默认仍是 `"bag"` 并在返回值里如实回报用了哪种池化。真实 vault 的 A/B（11 条 ground truth，top-8）：Direct 11 → 11 不变，**目标排名均值 1.73 → 2.27，0 例改善 / 2 例变差**（Fubini-Tonelli 1→5、Helly 引理 3→5），有符号净恢复 **Δ = +0 − 0 = 0**。原因是我们与论文的语料形态不同：我们的袋已按种类截断且有界，长度稀释本来就小，而 max 丢掉了「查询词分散在标题与正文时两视图分数相加」这一信号。**结论：保持单袋默认**；出现真实稀释案例时先补 ground-truth 再复测。
  - **可达性分层 + 有符号净恢复 Δ 成为常驻测量**：`npm run qa` 的引擎探针新增 §2——从 vault 原文抽 `related`/`source`/`[[wikilink]]` 边（断链不算可达），把每条 ground truth 目标分成 **Direct / Recoverable / No access** 三层，对两种池化各算一次，并同时报告**目标排名**（分层是粗粒度的：本轮 11/11 全是 Direct，只看分层会误判「两种池化一样」）。读法约定：改检索必须「Direct 数不降**且**排名均值不升」。
  - **明确不采纳通用多样性重排**（MMR/DPP）：论文的冻结候选控制实验本身给出反例（Top-K 56.87 / MMR 56.84 / DPP 52.69；净恢复 forest +43 vs MMR −6 / DPP −36），`AGENTS.md` §5 已有对应纪律。
  - **记录在案、暂不实现**（各带触发条件）：查询条件化的关系信任 + 「锚点槽位」（我们的 `related` 边还没有可信度信号）、按打开成本自适应 k（语义设计需拍板）、两阶段适用性判定（等于新增每轮必做步骤，与实测失败模式冲突）。

- **吸纳外部设计的 5 个机制（评估见 `docs/design-intake-2026-09-10.md`）**：评估两个外部项目后的结论是「少吸收、多印证」，最终落地 5 件全部确定性、零新依赖、零模型调用的改动：  - **适用边界进检索（硬门控）**：卡片顶层/`hook` 里的 `not_applicable_when` 现在被 `note_recall` 与 `note_strategy` 当门控用——查询命中边界短语时该卡**不进候选**，但结果里**单独列出「因适用边界被排除（命中『…』）」**。刻意不做静默丢弃：不可见的假阴性会让用户以为"库里没有"。边界文本按顿号/逗号拆成 ≤12 字的短片段再匹配，关键词列表与散文式边界都能吃下。
  - **负反馈计数 `harmed`**：「用过但结果更差」是 `uses`/`success_rate` 表达不了的一类信号（体检 weak 桶要求"成功率低**且**用过 ≥3 次"，真实 vault 从未达到）。用户点 ❌ 时插件累加 `hook.harmed`；两个面板在 >0 时显示 `⚠️ 倒忙 N 次`，体检新增「负反馈」行与清单项。
  - **验证等级凭据 `verified_by`**：把「verified 升级必须用户参与」从一句话变成**可机检的不变量**——用户点 ✅ 时由插件写 `verified_by: user`；体检把「等级高于 single-source 却没有凭据」的卡列为**越权升级**（只报告、不自动改）。❌ 降级时作废凭据（写 `none`），避免旧确认继续背书。
  - **声明值 vs 有效值**：`uses` 的真相是「frontmatter 声明值 + `retrieval-stats.json` 中尚未合并的增量」（那份文件是**增量**，体检合并后清零）。面板此前只显示声明值 ⇒ 两次体检之间少报。现在 `collectMemoryState` 返回 `uses`（有效值）+ `usesDeclared`/`usesPending`；体检在回写后**读回文件核对**，不一致即报告。
  - **`degraded` 取代静默成功**：体检里每一处确定性写入都改成「写完读回验证」，失败即计入 `postconditions` 并给出 `status: "degraded"` + `warnings`（人话摘要与模型清单都会写出来）。**这条上线当轮就抓到下面两个真实缺陷。**
- **修掉一个静默写坏卡片文件的缺陷（由上面第 5 条当场抓出）**：`math-memory.mjs` 的 `syncTopLevelStatsToCard` 把**含首尾 `---` 的整块**交给 `setTopFieldText`，于是当策略卡**没有** `uses:` 行时，追加的字段落在**闭合分隔符之后**（即正文里），且每次体检都会再追加一行——这正是此前在 `strategy/strat-ot-structure-proof.md` 里发现并清理的那两行 `uses: 0` 的**成因**。现在改为在分隔符**内部**拼接，并由「读回验证」保证落点正确。
- **命中无处可写时不再静默丢弃**：既无 `hook` 块又不是策略卡的卡片若累积了命中，体检会明确报告「这批 hits 会在重置时丢失」（此前被直接清零）。

- **「设计迭代忘记适配」专项审计（用户要求）**：把每个"后来才长出来的东西"（记忆层、反馈动作、开关、皮肤、插件包、产物）拿去比对所有向它枚举消费点的地方，找到 6 处真实缺陷并全部修复：
  - **归档只认 records 层**：`archiveMemoryFile` 与体检的 `moveCardsToArchive` 都把目的地写死 `.deepseek/archive/records/`，且只回写 `records/index.md` ⇒ 归档一张**策略卡**会把它塞进记录层的归档目录，并让 `strategy/index.md` 里那行变成**悬空链接**。现在按卡自己的层归档并回写该层索引（`records` 的映射不变，已有归档仍可找回）。
  - **web 面板的「自动保存对话」勾选与引擎相反**：面板用 `enabled !== false`，而引擎对**缺失的键返回 false**（默认关）⇒ 真正关闭时界面显示"已开启"。改为 `=== true`。
  - **文档说 `sessionCapture` 默认开、实际默认关**（0.7.3 默认 `true`，后按"写入先征得同意"改为 `false`，文档没跟）。已更正 handoff 与 0.7.3 条目。
  - **注入给模型的「分层长期记忆」说明停在五层**，路由清单里没有 templates 与 strategy。现在写明"五层 + 三个后长出来的检索面"并补齐路由。
  - **AGENTS.md 三写第 3 步清单漏了 `strategy/`**（后加的层不在收尾清单里）。已补。
  - **本机 `deploy-local.mjs` 只部署 8/19 个模板**（手写清单，漏 `config.md` 与 `strategy/_README.md`，后者是后加的层，改它永远进不了 vault）。改为读 `dsh/templates-manifest.json`，用户自有文件（config/capture-policy/notation）改为只在缺失时创建。
  - 另有三处判定为**有意为之**并补上说明：体检只扫 records/templates/strategy（导航卡不参与"低效用归档"）、`structural` 只对 records 生效、`notation.md` 在检索语料里按笔记分类。回归 200 → **207**（§32 归档按层 6 项 + 注入覆盖 1 项），路由回归 28 → **30**。

- **面板第二轮打磨（用户反馈）**：
  - **只保留路径下拉框**：dsh web 记忆面板此前同时显示「工作区下拉」与「手动输入 vault 路径」两个控件，令人困惑。现在默认只有下拉（选项显示工作区名，完整路径放悬停提示，下方一行「当前 vault」）；仅当工作区列表为空时才退化为手动输入。
  - **修掉浅色文字看不清**：次级文字用的 `--dsw-alias-label-dimmed` **在用户当前皮肤（orca-link）里没有定义**——该皮肤只定义 `primary/secondary/tertiary/caption` 一族，于是这条声明失效、颜色回退到继承值。改用 `var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary, …))`；Obsidian 侧同批把 `--text-faint` 换成 `--text-muted`。**教训：跨皮肤写样式只能用各皮肤都保证存在的 token**（`docs/memory/handoff.md` 坑 39）。
  - **卡片补一行「这是什么」**：标题常常是一整句数学命题（30–40 个汉字、含 LaTeX），只看标题看不出内容。数据层新增 `summaryOf()`：优先 frontmatter `summary/description/abstract`，否则取正文第一段有效行，跳过标题/引用/表格与记账行（`- 标签：…`、`- 状态：…`、以及真实卡片里那两行游离在 frontmatter 之外的 `uses: 0`），策略卡退到 `abstraction.principle`，最后才用 `hook.pattern`；两个面板把它作为标题下的一行显示。真实 vault 上四条记录/主题/策略卡的摘要现在都是可读的一句话。
- **捕获策略扩到四个档位：`idea/fact/preference/structure`**。原策略的三个"内容类别"配上一句"三写第 2/3 步先问"，导致**在协议之后才长出来的层**（topics / theorems / templates / strategy）归属只能靠读者推断，`strategy/` 甚至不在三写清单里。现在一个档位对应一组层：想法→inbox；事实→records 的 fact/event/instruction/artifact；偏好→profile 与 notation；**结构→topics / 定理索引 / 模板 / 策略**的索引与结构行（默认 `auto`：它管的是给已存在的内容补索引，每次都问会打断对话）。AGENTS.md、`capture-policy.md` 模板、系统提示注入、两个面板的策略行、host 侧读取与测试全部同步；**缺 `structure:` 行的旧策略文件行为不变**（等同 `auto`）。事件层（episodes，归 `sessionCapture` 开关）与记号「收集」的豁免也第一次写清楚。
- **项目定位写进文档**：记忆系统已解决「agent 记不住用户问过什么」，但**「辅助用户打磨一套数学理解、并建立对理解/技巧的调用体系」远未解决——真正实现它才是 1.0**。README 中英、`docs/memory/README.md`、`handoff.md` 决策记录均已写明，并列出 1.0 之前缺的东西（理解状态与卡点、技巧的调用体系、主动教学闭环、复习调度）。
- **`docs/session-scope.md`（会话隔离备忘）标注为已否决**：原始不适来自"面板信息量太低"的错觉；P1 要包住被会话搜索 / lineage / 按 URL 打开共用的 `sessionPersistence.list()`，代价与收益不成比例；侧栏分组折叠（状态持久化）已够用。文档顶部给出否决结论与理由，正文保留为存档。

- **两个面板的呈现层重做**（同一份 JSON、同一套词）：
  - 顶部一行状态条：`画像 ✅ · 记录 2 · 模板 0 · 主题 2 · 定理 0 · 策略 1 · 备忘录 3 · 事件 30 · 上次体检 2026-09-09`——回答「记忆库现在什么样」。
  - 新增置顶的 **⚠️ 待处理** 区块（仅在非空时出现）：把体检的「待重审 / 建议归档」直接摆在可点的归档按钮旁边。此前「建议归档某卡」只出现在原始 wikilink 文本里，而归档按钮在另一处、没有任何标记。
  - 卡片行改为 `标题 · 类型 · 算子 · #主题 · 徽标 · 用过 N 次 · N 天前`：补上从不显示的 `topic`（搜索承诺了它、过滤也确实按它匹配，但两个面板都不渲染），去掉真实数据里恒为 `—`/`0→0` 的 `success=` 与趋势线，去掉 web 面板直接打印的 **vault 相对路径**（降为悬停提示），去掉分区标题里硬编码的 `.deepseek/…` 路径。
  - 事件时间线改为 `日期 · 人类标题 · 主题`，默认折叠到 8 条 + 「展开全部」（真实 vault 恰好 30 条，此前是夹在卡片与体检报告之间的 30 行文件名墙）。
  - 补一行徽标图例；空状态判据覆盖全部层（此前只看 4 层，只有主题/策略卡的 vault 会被误判为空，而真实 vault 里它又几乎永不触发）。
  - 两个面板的术语与文案对齐（`记录` 而非 `记录层`、`捕获策略：想法=先询问` 而非 `ask/ask/ask`、备忘录状态用中文而非裸 `inbox`）。
- `🔁 不适用` 退出所有 UI：它写入的 `last_not_applicable` **全仓库没有任何读取方**（grep 验证），排序影响为零——即「看起来像 ❌、实际什么都不会发生」的最坏组合，而这个失败模式已由 `AGENTS.md` §5 的推理期适用性纪律覆盖。宿主仍保留该动作，**旧对话里的历史链接照常可用**（这也是不删代码的原因）。
- 零 token 回归 165 → **207** 项：新增 §30 面板数据层 22 项（五层收集、episode 索引解析的标题/主题/归档前缀、大小写不敏感搜索、hookless 卡的 ✅/❌、无评级卡不发明 `success_rate`、结构化 audit 与 `auditHuman` 分离、v1 旧体检文件的降级摘要、缺文件时 `audit=null`）与 §31 体检报告一致性 6 项（自动归档后不得再出现在归档候选/`counts.cards`/`decisions` 里；`schemaVersion` 与 human/checklist 双渲染）。路由回归 25 → **30**（新增「`/state` 交付面板真正渲染的字段」：五层、episode 的标题/主题/日期、无体检文件时优雅降级）。变异验证：把 `parseEpisodeIndex` 的分隔符正则从 `[ \t]` 改回 `\s`，第 30 节立刻失败（换行被吞、下一条 episode 的链接被塞进上一条的 `topic`）。
- 新增 [docs/release.md](docs/release.md)：发版手册（五个版本位置、tag 必须等于版本号、三条工作流各自的门禁、为什么「插件商店拿不到新版本」以及三条可用的分发路径、推送需要用户口令）。
- 零 token 回归 138 → **155** 项，并新增**路由信任边界回归 25 项**（`scripts/test-panel-routes.mjs`）、**侧栏握手端到端 7 项**（`scripts/test-panel-auth.mjs`，对**真实 dsh**：内部端口 + token → 反代兑换 → 界面/资源/API/WebSocket 全通；未装 dsh 时 SKIP）与**侧栏反代回归 15 项**（`scripts/test-panel-proxy.mjs`，stub 上游）：跨源拒绝（含 `Origin: null`）、root 锚定、token 三态、目录／非 `.md`／`..` 拒绝、被拒后不留归档目录、字段校验、未知路由 404、权威 cookie 命名、Host 保真、401 透传、升级转发与 5 条接线断言。变异验证：拆掉 Origin/root 守卫 → 6 条断言失败；抽掉嵌入白名单里的符号 → 守卫自测失败。
- 新增 `scripts/check-embedded-writers.mjs`：**求值 main.js 里嵌入的那份 `memory-admin.mjs`**（与插件 loader 同样的 import/export 剥离 + `new Function`）并跑真实写入，同时断言"嵌入源码 == 仓库源码"。此前审计已证明旧的 `check-embedded-loader.mjs` 比对的**是它自己那份名单**（删掉模板里 5 个被消费符号仍 exit 0）。
- `check-doc-consistency.mjs` 改为读取各套件**运行期**打印的 `__CHECKS__ <passed>/<total>`，不再用正则数源码里的 `check(` 调用点——后者会漏掉夹具循环里生成的断言（实测 152 调用点 vs 155 执行），且看不到提前退出。

- **修复「打字几秒才显示」的整机卡顿：会话扫描不再全量解码**。`countUncapturedSessions`/`runSessionCapture` 此前会遍历 `$DSH_HOME/sessions/` 下的**每一份**会话日志，并逐个**完整 zstd 解压 + JSON 解析**，之后才去查那个本来就能跳过它的指纹标记；而 `countUncapturedSessions` 由记忆面板 `onOpen` 在 Obsidian 渲染进程主线程上调用。本机实测：389 份日志 / 367 MB，单次 `count` **48.6 s**、单次 `capture` **51.4 s**（`debug.log` 里对得上 45 s 的面板卡死空档），期间整个 Obsidian 界面（含编辑器打字）完全冻结。三重修复：
  - **只看头部就判定归属**：新增 `readSessionHeader`，只读文件头 64 KiB 并只解压**第一个 zstd 帧**，取会话头行的 `{type,id,cwd}`；非本 vault 的会话在读头阶段就被排除，不再解压全文（同一存储：读全部头部 **0.59 s**，全量解码 **34 s**，约 58×）。
  - **按文件修订号记忆判定**：marker 新增 `scanned`（`日志绝对路径 → {fp, inVault, pending}`，`fp = path|mtimeMs|size`）。未变化的日志只做一次 `stat`、永不重读；**别的 workspace 的日志特征化一次后永久跳过**（此前正是这 ~98% 的解码被白白丢掉）。实测 `count` 冷启 48 641 ms → **1 668 ms**、热态 → **166 ms**。
  - **面板不再阻塞首帧**：未保存角标改到 `setTimeout(…, 0)` 执行，冷启动扫描不可能再挡住面板首绘。
- **对话框索引只看本 vault 的会话（顺带修正确性）**：`buildDialogueIndex` 同样是「先解码、后过滤」，而且是在**全局最新 20 份**里筛本 vault——既白解码了别的工作区的会话，又可能因为更忙的项目占了最新文件而让索引几乎为空。现在先按会话头筛出本 vault 的最新 N 份再解码：实测 3 974 ms → **590 ms**（6.7×），且本 vault 的会话真正进了索引（15 个来源 / 39 条问答，此前为空或极少）。
- **头部判定失败时不缓存「无关」结论**：若首帧超过 64 KiB（或文件被截断）导致读不到头部，改为回退全文解码判定，而不是缓存一个无法自证的 `inVault:false`——错误缓存会让该会话**永远**不再被捕获。
- **适配 dsh 0.1.5 的会话数据格式 V3：同一会话不再被当成两份日志**。dsh 0.1.5 把会话日志升级到 V3，做法是**生成 `session.v3.jsonl.zstd` 并保留 V2 原件**（上游明确「保留原文件、不支持降级读取」），于是同一个 `<session-id>` 目录里会有两份都以 `.jsonl.zstd` 结尾的日志——既不是过渡态，也不会自动消失。原先的扫描判据只看后缀，后果有两条：捕获路径会把同一会话扫两次并让 marker 的指纹在 V2/V3 之间来回覆盖（`lastSeq` 增量与面板「N 个会话未保存」角标失真），对话索引路径则让同一会话占掉「最新 20 份」窗口里的两个名额、问答对重复进入注入预算。修复为**按会话去重后再切片**：`sessionLogKey` 取会话身份（会话目录名，兼容扁平布局），`selectAuthoritativeLogs` 每个会话只保留权威版本——**显式优先 `.v3.` 变体**（迁移件才是活的；两者 mtime 可能落在同一时间戳刻度上），其次按 mtime 取新。preset 与 host 两份自包含副本同步修改。
  - 解码无需改动：V3 仍是多帧拼接的无字典 zstd，会话头行与 `user/message`／`assistant/message`／`session/title` 事件名、`source.kind === "user"` 判据全部不变；V3 反而去掉了逐块流事件（`assistant/chunk` 等），单份日志的事件量更小。
  - 评估、取证与「不改什么」的完整理由见 [docs/dsh-0.1.5-adaptation.md](docs/dsh-0.1.5-adaptation.md)。

### Changed

- 零 token 回归 118 → 138 项（在既有扫描缓存不变量之外，新增 dsh 0.1.5 会话格式 V3 的 12 项：V2/V3 成对折叠为一份、优先迁移件、`maxFiles` 按会话计数、V3 事件可蒸馏、捕获落盘顺序、删掉 V3 后回落到 V2 原件）。本轮安全修复再增至 155 + 路由回归 25。
- 客户端面板的 `dsh.client.inject` 声明改用 dsh 0.1.5 实际存在的包名（`dsh-client-modules`／`dsh-client-locale`／`dsh-client-ui-settings`），并注明该字段只是加载/预取元数据、真正的依赖是运行时注入的 cordis 服务名（`slots`/`locale`）；旧名 `dsh-client-runtime`／`dsh-client-ui-slots` 属于 0.1.5 已移除的 runtime face。
- 皮肤中心可选挂载补充说明（行为不变，默认仍关）：`dsh-web-all@0.3.20` 聚合包已自带 `web-ui-skin-center` 行，因此在装有聚合包的机器上这个开关是冗余的（宿主半边只跑一次、浏览器半边按包名去重），它仍然覆盖「有皮肤包但没有聚合包」的 web profile。

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
  - 开关：`.deepseek/config.md` `sessionCapture`（0.7.3 默认 `true`；**0.7.5 起默认 `false`**，见该版本条目——默认自动保存与「写入记忆先征得同意」的既定原则冲突）。
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
- 记忆陷阱防御配套文档：`docs/memory/changelog.md` 记「AdaptiveMem 本土化 + lit-import 修复」条目；`docs/memory/handoff.md` §3 增量说明、§7 记录后续工作（陷阱压力样例 / 记忆诱发退化被动信号 / note_recall 结构化适用性 / 文献库剩余 13 篇蒸馏）；回归断言 83→85 全仓统一。

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
- 结构收敛：`REFACTOR-PLAN.md` 退役（历史档案横幅）、根 `TESTING.md` 并入 `docs/memory/testing.md`（新增本地验收手册）、`docs/memory/README.md` 导航补齐 control-panel/testing/handoff；根 CHANGELOG 只做发布摘要，记忆系统细账统一进 `docs/memory/changelog.md`。
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
