# 记忆系统变更日志

> 记忆系统专属的“为什么改、改了什么”。比仓库根 CHANGELOG 更细，面向后续维护者与改造 agent。最新在上。交接文档见 [handoff.md](handoff.md)。

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

- 零 token 引擎探针 `scripts/probe-vault.mjs`（本机脚本，12 组 ground-truth）：发现并修复「无答案查询仍得 0.9+ 自信分」缺陷——`note_recall` 命中新增 `coverage`（查询词覆盖率，<0.35 判弱信号），AGENTS.md 同步；修复后 12/12 PASS。
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
- 回归：召回排序断言退役（被 note_recall 的 BM25 测试取代），新增导航断言 3 项（导航层存在/无召回段/总长有界 ≤9000 字符）。

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