# 记忆系统变更日志

## 2026-09 · 0.7.5 首次推 tag 暴露的三个流水线缺陷（已修）

推 tag 后 **Release 成功、npm 失败、CI 在 Windows 上失败**——三件都在本机不可见：

1. **守卫把「本机不跑」当失败**：`check-doc-consistency.mjs` 会真跑各套件并解析 `__CHECKS__`，而 `test-panel-auth.mjs` 在没有本地 dsh 时按设计 SKIP（CI runner 正是如此）⇒ 守卫报 `no __CHECKS__ line` 并把文档里的 7 项认证断言与 0 比较。改为：`runSuite(rel, { optional: true })` 识别 SKIP 返回 null，认证锚点只报告不比较；其它套件缺行仍算失败。
2. **守卫不容忍 CRLF**：Windows runner 检出 CRLF，两个嵌入守卫用多行字面量/逐字节比较 ⇒ 误报「appended loader helper is unterminated」与「embedded memory-admin 是旧版」。改为读入即归一化到 LF（与 `build-obsidian.mjs` 一致），比较两侧都归一化。复现：`git -c core.autocrlf=true archive <commit>` 解出的 CRLF 检出。
3. **`npm publish` 无诊断**：token 缺失/过期/无发布权/2FA 都只有非零退出码。`npm-publish.yml` 在 publish 前加 `npm whoami`（`|| true`）；刷新 `NPM_TOKEN` 属用户侧动作。

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

- **背景**：三路审计的元结论是——138 条断言守卫的是"grep 看得见的东西"和良构夹具上的纯函数，而这次缺陷属于它一条断言都没有的四类（信任边界／输入类性质／资源上限／CI 内的真实端到端）；其中"验收网自己在骗人"有两例：探针手抄打分公式、接受记录无凭据（[../project-assessment-2026-09-10.md](../project-assessment-2026-09-10.md) §2 P1-4/P1-10）。
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

- **来源**：三路独立代码审计（[../project-assessment-2026-09-10.md](../project-assessment-2026-09-10.md)）。审计的元结论是：**138 条断言测的是"grep 看得见的东西"和良构夹具上的纯函数**，而这次的四类缺陷（信任边界／输入类性质／资源上限／CI 内的真实端到端）恰好一条断言都没有；凡是它试图检查边界的地方，期望值往往是从实现自身推导出来的（自指式 oracle）。
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

- **触发**：宿主升级 dsh 0.1.1-rc.2 → **0.1.5-rc.1**，web 插件升级到 `@linxin666/dsh-web-all@0.3.20`（旧 `dsh-web-ui-all` 已废弃改名）。上游 release notes 明确：*「会话数据格式升级至 V3……自定义日志读取器需适配 V3」*。完整评估与取证见 [../dsh-0.1.5-adaptation.md](../dsh-0.1.5-adaptation.md)。
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

- 背景：审查发现根目录与 `docs/memory/` 两份文档集存在事实漂移（测试断言数在 README/ARCHITECTURE/TESTING 各写 63/70/75）、导航缺口（`docs/memory/README.md` 漏列 control-panel/testing/handoff）、两个孤儿文档（根 `REFACTOR-PLAN.md`、根 `TESTING.md`），以及双 changelog 的双写负担。
- 改动：断言数统一为真实值 75（以 `scripts/test-memory.mjs` 的 `check()` 数为准）；README 双语旧身份 `obsidian`→`notes-assistant`；design.md 注入段名改 `dsh-math:memory`、删除「hook schema 无版本常量」这一已失效局限；env 旧名改新名并注明兼容。
- 结构：`REFACTOR-PLAN.md` 加历史档案横幅退役；根 `TESTING.md` 并入 `docs/memory/testing.md`（新增「本地验收手册」节）；`docs/memory/README.md` 导航补齐 3 份；根 CHANGELOG 定位为发布摘要，记忆细账只进本文件。
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