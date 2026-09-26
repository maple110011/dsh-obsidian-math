# ARCHITECTURE.md — 仓库结构与系统架构

本文件说明仓库里**每个目录/文件是干什么的**、两个组件如何协作、以及记忆系统与检索系统的边界。文档知识库入口见 [docs/memory/README.md](docs/memory/README.md)。

> **项目定位（2026-09-10）**：本仓库已经解决「agent 记不住用户问过什么」（跨会话原文证据 + 类型化原子记录 + 分层索引 + 统一检索 + 反馈纠错）；但**「辅助用户打磨一套数学理解，并建立对理解/技巧的调用体系」远未解决——真正实现它才是 1.0**。因此本文描述的是 0.7.x 的**记忆基础设施 + 控制面**，不是最终形态；缺什么见 [docs/handoff.md](docs/handoff.md) §7。

## 1. 双组件总览

```
┌──────────────────────────── Obsidian（用户）────────────────────────────┐
│  右侧栏 iframe（dsh web）   记忆面板 ItemView    设置页（服务/捕获策略/  │
│                                                  侧栏性能模式）           │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ 启动/停止 dsh 服务；/open /feedback loopback；
               │ bootstrap 写入 preset/profile/模板；归档维护
               │ 主进程反代（DshWebProxy）：兑换启动 token 的 cookie、
               │ 注入侧栏性能样式表（导航响应）
┌──────────────▼──────────────────────────── dsh 服务（notes-assistant profile）─┐
│  agent preset `notes-assistant`：最小工具面 + math-memory + note-tools  │
│  fail-closed 沙箱（workspace-write，approval never）                     │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ 读/写
┌──────────────▼──────────────────────────── vault（工作区根）─────────────┐
│  笔记/ + AGENTS.md + .deepseek/                                          │
│    memory/（profile, notation, topics, records, theorems, templates,     │
│             episodes）  inbox/  capture-policy.md  cache/（机器生成）     │
└──────────────────────────────────────────────────────────────────────────┘
```

**职责分工**：Obsidian 插件 = 服务管理 + UI + 确定性维护（归档/反馈写回）；dsh 侧 = agent 能力（检索/记忆注入/工具）；vault = 全部持久状态（笔记 + 记忆都是 markdown，无数据库）。

## 2. 仓库文件地图

| 路径 | 职责 |
|---|---|
| `manifest.json` / `main.js` / `styles.css` | Obsidian 社区插件发布物（`main.js` 由构建生成，勿手改） |
| `locale/` + `icon.svg` | **dsh 插件管理页的卡片素材**（0.1.7 能力）：`dsh-app-boot` 的 `readPluginMeta` 读 `package.json.icon`（相对路径、≤256 KiB、包内真实文件）与 `<pkg>/locale/<lang>.json` 的 `meta.title`/`meta.description`（`en.json` 为基准）。三样都**静默降级**（缺失/不合格就回退到包名与默认图），所以由**真读取器**守卫：`scripts/check-plugin-manifest-meta.mjs`。`package.json` 的 `files` 必须带上这两项（发布集由 `check-release-paths.mjs` 钉住） |
| `obsidian/main.template.js` | 插件源码：服务管理、LinkServer（/open + /feedback）、主进程反代（`DshWebProxy`：cookie 兑换 + 侧栏性能注入）、记忆面板、预览编辑、**皮肤中心的显式安装**（`installSkinCenterPackages`：`dsh plugin add` 两个 `@linxin666` 包；退役的 junction 镜像已删，见 `docs/changelog.md` 2026-09-26）、机器级皮肤行的 disable 兜底（`buildSkinFallbackBlock`）、设置页（含捕获策略下拉框与侧栏性能模式）、bootstrap |
| `dsh/preset/` | **agent preset `notes-assistant`**：`preset.yml`（元信息）、`agent.cordis.yml`（装配：最小工具 + 记忆插件配置）、`math-memory.mjs`（记忆注入引擎 + 体检 + 对话索引 + 记号/捕获策略注入）、`note-tools.mjs`（笔记工具：note_recall（统一检索 + tag-only 枚举）/note_strategy/note_create/note_links + BM25 检索引擎） |
| `dsh/profile/` | **profile `notes-assistant`**：`package.json`（bundles: dsh-base + dsh-web-app）、`cordis.patch.yml`（fail-closed 沙箱/审批/权限表/默认 preset；**不挂载任何 `@linxin666` UI 插件**，保持独立）、`notes-assistant.patch.yml`（`--direct`/Obsidian 直写通道的 `--patch` overlay；native 模式由 bundle 提供，不用它）、`math-memory-workspace.mjs` |
| `dsh/templates/` | **vault 模板**：`AGENTS.md`（工作协议，自动加载）、`profile.md`、`notation.md`（记号体系）、`topics-index.md`、`records-{readme,index}.md`、`theorems-*.md`、`templates-*.md`、`episodes-*.md`、`inbox-*.md`、`capture-policy.md` |
| `dsh/install.mjs` | npm CLI **编排器**：`install`（原生 `dsh plugin add`）/ `install --direct`（离线扁平拷贝）/ `status` / `uninstall`（分级删除），写 owner marker（仓库里那个**退役目录** `~/.dsh/.agent-presets/<id>/` 自 2026-09-26 起**不再被写入**，只在缺失时作为兼容回退被读；权威锚点是 profile 的 `.install-manifest.json`）。`--direct` 会**把 preset 体文件铺进 profile 目录**（经 `preset-deploy.mjs`，dry-run 也走同一条路径）；`status` 的 preset 判据同样是 **profile 目录** |
| `dsh/cordis.patch.yml` | **bundle 补丁**（`dsh.bundle.patch` 指向）：往 profile roster `insert` 宿主插件 `dsh-math-memory`，并带**生成的 preset 声明**。声明里的 preset 入口写成**包内路径**（`dsh-math-memory/dsh/preset/math-memory.mjs`）而不是 profile 目录里的相对文件——bundle 行无法在冷启动第一次之前把文件铺好，而包本身一定已在 `node_modules` 里（见 `dsh/preset/preset-deploy.mjs` 与 `scripts/lib/preset-declaration.mjs` 的实测说明） |
| `dsh/host/` | **bundle 宿主插件 + 记忆管理核心**：`index.mjs`（`/memory-panel` 路由 + workspace 自动注册 + **通道归属守卫**；**不铺 preset 体文件**——bundle 通道的 preset 用包内路径，见 `dsh/cordis.patch.yml`）、`channel-owner.mjs`（**通道归属锚点的家**：`profileDirFromCtx` + `readChannelOwner`，profile 目录的 `.install-manifest.json` 优先、退役的 `.agent-presets/<id>/.owner.json` 仅作回退——删除死目录曾会静默废掉守卫。它原名 `preset-sync.mjs`，那份"目录式 preset 同步"在 0.1.7 之后已无调用方，2026-09-26 连它那两条门禁一起删除）、`hook-frontmatter.mjs` / `engine-shared.mjs`（各自把 `dsh/preset/` 里的**规范文件**以同名 re-export 出来，好让 `./xxx.mjs` 这种相对 specifier 在 package 布局下也能解析——离线扁平布局解析到规范文件本身）、`memory-admin.mjs`（确定性操作 + 面板数据层）、`math-memory-panel.mjs`（`/memory-panel/*` 路由） |
| `dsh/preset/preset-deploy.mjs` | **preset 体文件的唯一权威清单**（`PRESET_BODY_FILES`，现 4 项：`math-memory.mjs` / `note-tools.mjs` / `hook-frontmatter.mjs` / `engine-shared.mjs`）+ 给离线通道用的落盘函数。完备性判据 = `dsh/preset/math-memory.mjs` 的相对 import 闭包；`scripts/check-preset-body-lists.mjs` 会把三份清单与两个通道的 name 形态一起钉住 |
| `dsh/client-panel/` | dsh web 记忆面板：`src/index.jsx` + `build-client.mjs`（esbuild） + `install-into-profile.mjs`；**另含拖拽引用**：`src/drop-mention/`（`parse.drop.mjs` 纯解析 + `composer-drop.mjs` DOM 接线），把文件树拖来的笔记变成草稿里的 `@库内路径`（规格见 `docs/drag-drop-design-2026-09-21.md`） |
| `scripts/build-obsidian.mjs` | 把模板 + dsh/ 共享文件嵌入 `main.js`（CRLF 归一化，CI 重建一致性门禁） |
| `scripts/deploy-local.mjs` | 本机一键部署（gitignore，机器特定路径；备份 + 三路安装 + 验证） |
| `scripts/qa/` | **QA 工具链**：`engine-probe.mjs`（零 token 召回断言 + 可达性分层/池化 A/B）、`e2e.mjs`（真实会话验收，含 API 级 token 计量）、`sidebar-perf-probe.mjs`（**按需**：CDP 驱动真实 dsh 测侧栏交互卡顿，不进 CI）、`drag-payload-probe.mjs` / `iframe-drop-probe.mjs`（**按需**：拖拽引用的两条前提——Obsidian 拖拽载荷真值 + 跨源 iframe 收不收得到 drop），`cases.json`、`run.mjs`；方法论见 `docs/memory/testing.md` |
| `scripts/test-memory.mjs` | 零 token 回归（414 断言，进 `npm test`） |
| `scripts/test-panel-routes.mjs` | `/memory-panel` 路由信任边界回归（53 断言：跨源拒绝、root 锚定（含**未配置**时拒绝调用方 root）、token、字段校验、写入型端点；进 `npm test`） |
| `scripts/test-panel-auth.mjs` | 侧栏握手端到端（8 断言，对**真实 dsh**：内部端口 + token → 反代兑换 → 界面/资源/API/WebSocket 全通；未装 dsh 或环境不允许子进程写自身状态时 SKIP） |
| `scripts/test-panel-proxy.mjs` | 侧栏反代回归（32 断言：权威 cookie、Host 保真、401 透传、升级转发、接线断言 + 11 项侧栏性能注入/皮肤脚本改写：注入位置与规则内容、非导航不重写、无 `</head>` 与 gzip 透传、补丁锚点变化时原样返回、开关关闭后字节相同） |
| `scripts/test-panel-present.mjs` | **呈现层**纯净决策回归（从 `main.template.js` 的**源码文本**里提取 `MemoryView` 的四个纯方法 `layerEntries`/`pendingItems`/`cardMeta`/`trendText` 并求值——测的是真源码，不是副本；接缝被改名/挪走会**报错**而不是静默不测） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测（含"`--direct` 真的把 preset 体文件铺进 profile 目录"与"卸载把它们删掉"） |
| `scripts/check-preset-body-lists.mjs` | **preset 体文件清单的守卫**：清单必须等于 preset 入口的相对 import 闭包；`install.mjs` / `main.template.js` / 两个 patch 的其它几份必须覆盖它；两个通道各自的 name 形态（包内 specifier vs `./`）必须正确。它**真的调用** `deployPresetBody`/`presetBodyDeployedIn`，所以"零调用方的坏导出"也会被它抓到 |
| `scripts/check-client-package-layout.mjs` | **客户端半个那个安装时生成的包必须可加载**：按 `collectDshImportClosure()` 复制整条闭包后，真的 `import()` 一次产物（两个宿主半分支各一次），并核对 `main`/`exports` 形状与 `dsh.client.inject` 引用的包确实存在 |
| `scripts/check-plugin-manifest-meta.mjs` | **插件管理页的卡片素材**：跑 dsh 的**真读取器**（`dsh-app-boot` 的 `readPluginMeta`）断言中英标题不同、描述齐全、icon 被转成 data URL；静态部分另查 icon 路径形态/大小与 `locale/*.json` 的命名与字段。缺 dsh 时声明 SKIP |
| `scripts/build-preset-declaration.mjs` | preset 声明的**生成器**（`--check` 已注册为门禁）：从 `agent.cordis.yml` + `preset.yml` 生成两个通道的声明块，`localPrefix` 决定是包内 specifier 还是 `./` |
| `scripts/check-doc-consistency.mjs` | 文档一致性守卫：断言数等易漂移数字与代码实测值一致（进 `npm test`） |
| `scripts/lib/gates.mjs` | **门禁清单的唯一来源**：`run-gates.mjs` 执行它，`check-doc-counts.mjs` import 它数条数。抽成模块是为了让"有多少条门禁"可判定——`AGENTS.md` 曾手写「本机当前 34/34」而清单已长到 41 条，且手写数字落在 agent 的首读路径上 |
| `scripts/check-doc-counts.mjs` | 计数守卫：陷阱条数（真值 = `docs/handoff.md` §4 的编号 + 该节标记行 `> 陷阱条数：N`，并断言编号 1..N 无重无缺）与门禁总数（真值 = `scripts/lib/gates.mjs`），比对每一处引用（进 `npm test`） |
| `scripts/lit-import.mjs` | 文献库导入器：BibTeX + PDF + MinerU markdown → agent/人类双面文献库（见 `docs/literature.md`） |
| `scripts/lib/lit-index.mjs` | 文献索引的**状态与陈旧**逻辑（唯一实现）。`lit-import.mjs` 与门禁 `test-lit-import.mjs` **都 import 它**——抽成模块是为了让测试**进程内**运行：本仓库沙箱禁止捕获子进程管道输出（spawn/exec → EPERM），门禁不能 shell 出去跑导入器。背景：索引「状态」列原先取条目的机器默认值（恒为 unread），而 cards/*.md 跨导入保留 ⇒ 全库卡片其实都已蒸馏、索引却全显示「未读」，且没有门禁会因此失败 |
| `scripts/test-lit-import.mjs` | 文献索引逻辑门禁（10 断言，**进程内**，进 `npm test`） |
| `docs/memory/` | **知识库**：README（导航+状态表）、design（当前实现规格）、retrieval-v3（检索提案与状态 + §7 GraphMemix 吸纳决策与 A/B 实测）、testing（QA 方法论）、assessment（评估轮次）、v2-proposal、references（论文笔记）、changelog（记忆系统细账）、control-panel、sidebar-performance（侧栏卡顿原因清单与处置）、handoff（交接） |
| `docs/literature.md` | **文献库架构规格**：双面分离、文件契约、研读→蒸馏闭环（`scripts/lit-import.mjs` 的实施说明） |
| `docs/dsh-panel-research.md` | dsh 面板机制调研：noema/aionui 挂载方式，Phase 2 面板路线（官方 `settings.section` 槽位） |
| `docs/dsh-native-refactor.md` | **评估 + 迁移清单**：dsh 侧交付重构为 dsh-native bundle 模式（capability 走 `dsh plugin`，posture 留安装程序），含完整安装 / 对称卸载 / owner-marker 冲突解决 |
| `docs/installation.md` | **用户指引**：安装原理（capability/posture 两层）、两条安装路径、冲突解决（owner marker / `--force` 接管）、卸载（三级删除 + 确认短语）、FAQ |
| `docs/dsh-0.1.5-adaptation.md` | **宿主版本适配（dsh 0.1.5-rc.1 / 会话格式 V3 / dsh-web-all 0.3.20）**：耦合面盘点、本机取证（文件名、zstd 帧、事件语义、profile 合成、槽位契约、boot 冒烟）、修复清单（**按会话去重日志** + **主进程反代**解决 SameSite=Strict cookie）、刻意不改的项及理由、待决策清单 |
| `docs/project-assessment-2026-09-10.md` | **完整项目评估（存档）**：三路独立审计的发现（5 个 CRITICAL、按严重度排序的清单）、四项决策的优劣与推荐、dsh 0.1.5 升级破坏、**「为什么 138 条断言没测出来」的元分析**（自指式 oracle）、修复进展与仍未修清单 |
| `literature/` | **文献库（仓库内维护）**：`cards/` 蒸馏卡 + `reading/` 研读笔记 + `notes/` 跨文献产出 + `.raw/` 原始语料 + `index.md`/`library.bib`；导入器 `scripts/lit-import.mjs`，规格 `docs/literature.md` |
| `.github/workflows/` | CI（重建 main.js 一致性 + 全测试）、release（tag 触发发布资产） |

## 3. 记忆系统 ↔ 检索系统：写读分离、文件契约耦合

```
记忆系统（写路径）                       检索系统（读路径）
  拥有：五层结构、三写协议、hook schema、     拥有：统一索引、BM25 打分、
  体检、统计回写、归档、记号体系、捕获策略      精读协议、coverage 弱信号
        │                                        │
        ├─① 卡片文件（.deepseek/memory/**）──→ │ 只读消费（kind-aware passage）
        ├─② hook frontmatter schema ─────────→ │ 字段加权 + 算子过滤
        │                                        │
        │←─③ cache/retrieval-stats.json ────────┤ 检索命中写入
        │   （体检读统计 → 回写 uses/success_rate）
        └─④ 推送接口：profile/notation/topics/dialogue 注入 prompt
```

两条路径独立演化；唯一协调点 = hook schema 变更（版本化）。详见 [docs/memory/retrieval-v3.md](docs/memory/retrieval-v3.md) §3.5。

## 4. 常用命令

```bash
npm test                        # 语法 + 414 项回归 + 53 项路由回归 + 8 项认证 + 32 项反代回归 + 安装器 e2e（含漂移检测）+ 通道归属锚点回归 + preset 体文件清单/声明/客户端包布局/插件卡片素材。汇总为三态（ok / SKIP / FAIL）并列出被跳过的门禁——SKIP 不等于通过
npm run qa                      # 引擎探针（零 token，12 组召回断言 + 可达性分层/池化 A/B）
npm run qa:e2e                  # 引擎探针 + 真实会话端到端（烧真实 tokens，含 API 级计量）
node scripts/build-obsidian.mjs # 重建 main.js（改 dsh/ 或模板后必跑）
node scripts/deploy-local.mjs   # 本机部署（vault + DSH_HOME + 插件目录）
dsh-math-memory install --vault <库>          # 原生安装（dsh plugin add + 姿态 + 模板）
dsh-math-memory install --direct --vault <库> # 离线扁平拷贝
dsh-math-memory status / uninstall            # 诊断 / 卸载（默认 dry-run）
dsh --profile notes-assistant                 # 纯 CLI 启动（bundle 已提供 panel/workspace）
```

## 5. 新功能落地清单（改代码时对照）

1. 逻辑放对层：host（Obsidian 插件）/ agent（preset）/ 数据（vault 模板）；
2. 纯函数进 `scripts/test-memory.mjs` 回归；行为断言进 `scripts/qa/`；
3. 新模板三路安装（main.template.js bootstrap / install.mjs / deploy-local.mjs）+ 进 build-obsidian.mjs 嵌入清单；
4. 文档同步：design.md（规格）、CHANGELOG.md（发布摘要）＋ docs/changelog.md（**仓库级**细账：为什么改、怎么改、踩了什么坑）、**README.md 与 README.zh.md 中英同步（中文文档必须始终保留；由 `scripts/check-readme-pair.mjs` 判定：结构签名 + 切换行 + 链接集合 + 围栏代码骨架 + 一致性记录 `README.i18n.yaml`。**只改一侧就红，并指出是哪一侧被编辑**；改完一侧必须补齐另一侧再跑 `node scripts/check-readme-pair.mjs --write` 重新记录）**、必要时 docs/handoff.md；断言数等数字改动后跑 `scripts/check-doc-consistency.mjs`，两侧的版本行由 `scripts/check-version-consistency.mjs` 守（都在 `npm test` 里）。
5. 构建 → npm test → npm run qa → deploy-local →（用户口令后）提交推送。
