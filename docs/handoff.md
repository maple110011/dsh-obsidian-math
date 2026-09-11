# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、决策、已修坑、未做事项与工作约定。
> 当前版本：0.7.5
> （本文件描述**当前**状态；它与 `package.json` 的一致性由 `check-version-consistency.mjs` 守卫）
> 最后更新：2026-08 大改收尾——仓库文档大改 + 文献库子系统 + 记忆系统强化（两轮）+ Phase 1 解耦 + Phase 2a/2b dsh web 面板 + 面板方案 A（两实例）。**0.7.2 时**（记忆纠错与确定性自维护落地，见 `self-correction.md`；上一版 0.7.1 = 2026-08-26）。0.7.1 新增 **dsh-native 分发重构**（bundle + `dsh plugin add` 原生安装、`--direct` 离线拷贝、owner marker 冲突解决、对称 `uninstall`；功能无变化，仅优化安装方式），详见 `docs/dsh-native-refactor.md` 与 `docs/installation.md`。

## 1. 项目是什么

`dsh-math-memory`（原 `dsh-obsidian-math`）：把 DeepSeek Harness（dsh）嵌入 Obsidian 右侧栏的**数学笔记助手**，核心是跨会话分层记忆系统。**单仓库**、**两个独立分发产物**，外加两个仓库内子系统：

- **npm 包 `dsh-math-memory`**（`dsh/`）：dsh agent preset + profile + 安装器，把记忆系统装进任意 DSH_HOME。
- **Obsidian 社区插件**（id `dsh-math-assistant`，根目录 `main.js`/`manifest.json`/`styles.css`）：右侧栏 UI（服务管理、记忆面板 ItemView、反馈闭环、归档）。
- **文献库**（`literature/`）：双面文献库——人类侧 `cards/`/`reading/`/`notes/`/`index.md`，机器侧 `.raw/`/`.index.json`（gitignored）；14 篇论文全部导入（均有 MinerU 全文）。
- **dsh web 管理面板**（`dsh/host/math-memory-panel.mjs` + `dsh/client-panel/`）：装在**主 dsh web（3080）** 的 React 面板，读/写记忆与工作区切换。

仓库地址：github.com/maple110011/dsh-obsidian-math（**仓库名未改**，只有 npm 包名改了）。

## 2. 文件地图（改哪里先看哪）

| 路径 | 职责 |
|---|---|
| `dsh/preset/math-memory.mjs` | 记忆注入引擎：五层导航摘要、体检、dialogue index、memo 提醒、`config.md` 开关解析 |
| `dsh/preset/note-tools.mjs` | 笔记工具：note_recall/note_search/note_create/note_links + BM25 + `resolveWorkspaceRoot` + `hookPrior` |
| `dsh/preset/hook-frontmatter.mjs` | **共享 hook 块解析器**（单一事实源；+ `HOOK_SCHEMA_VERSION`；被 ESM import + 插件嵌入 loader 双路加载） |
| `dsh/preset/agent.cordis.yml` | preset 装配：最小工具面 + 记忆开关（`enabled`/`dialogueIndex`/`reminders`/`audit`） |
| `dsh/preset/preset.yml` | preset 元信息（显示名「数学笔记助手」） |
| `dsh/profile/` | **profile `notes-assistant`**：fail-closed 沙箱（workspace-write + approval never）；**默认不挂载 `@linxin666` UI 插件**（皮肤中心可经 Obsidian 设置开关启用） |
| `dsh/templates/` | vault 模板：AGENTS.md + 记忆层模板 + `config.md`（独立设置）+ `capture-policy.md` |
| `dsh/templates-manifest.json` | **模板清单单一事实源**（build/install/bootstrap 三处派生 + 构建漏模板门禁） |
| `dsh/install.mjs` | CLI **编排器**（npm bin `dsh-math-memory`）：`install`（原生 `dsh plugin add`）/ `install --direct`（离线扁平拷贝）/ `status` / `uninstall`；写 owner marker |
| `dsh/host/memory-admin.mjs` | host-agnostic 记忆管理核心（确定性操作 + 面板数据层；Obsidian 插件经嵌入 loader 复用） |
| `dsh/host/math-memory-panel.mjs` | **dsh web 宿主面板插件**：inject `webServer`+`workspaceRegistry`，路由 `/memory-panel/*`（state/workspaces/feedback/archive/capture-policy/archive-episodes），loopback-only + `pathInside` 门控 |
| `dsh/client-panel/` | **dsh web 客户端面板**：React 源码 `src/index.jsx` + esbuild 打包 `build-client.mjs` + 安装 `install-into-profile.mjs` + 产物 `lib/client.js` |
| `literature/` + `scripts/lit-import.mjs` + `docs/literature.md` | **文献库子系统**：BibTeX + PDF + MinerU markdown → 双面文献库（14 篇） |
| `docs/dsh-panel-research.md` | dsh web 面板机制调研（客户端契约 / settings.section 槽位 / profile 装配名单 / 宿主路由） |
| `obsidian/main.template.js` | Obsidian 插件源码：服务管理、LinkServer（/open + /feedback）、MemoryView 面板、全局皮肤 patch 兜底、bootstrap、**命令「在 dsh web 打开记忆面板」+ `memoryPanelUrl` 设置** |
| `scripts/build-obsidian.mjs` | 把模板 + dsh 文件嵌入 `main.js`（**改共享文件后必跑**） |
| `scripts/test-memory.mjs` | 零 token 记忆回归（240 项断言，进 `npm test`） |
| `scripts/test-panel-routes.mjs` | `/memory-panel` 路由信任边界回归（47 项断言：跨源拒绝、root 锚定（含**未配置**时拒绝调用方 root）、token、字段校验、四条写入型端点；进 `npm test`） |
| `scripts/test-panel-proxy.mjs` | 侧栏反代回归（32 项：权威 cookie、Host 保真、401 透传、升级转发、接线断言 + 11 项侧栏性能注入/皮肤脚本改写回归） |
| `scripts/test-panel-auth.mjs` | 侧栏握手端到端（8 项，对真实 dsh；未装 dsh 或环境不允许子进程写自身状态时 SKIP） |
| `scripts/test-panel-present.mjs` | **呈现层**纯净决策回归（提取 `MemoryView` 的 `layerEntries`/`pendingItems`/`cardMeta`/`trendText` 四个方法并求值；测真源码，接缝挪走即报错） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测 |
| `scripts/check-doc-consistency.mjs` | 文档一致性守卫（断言数等数字与代码实测对齐，进 `npm test`） |
| `scripts/check-rename.mjs` / `check-skin-fallback.mjs` / `check-plugin-id.mjs` | 三个守卫（见 §4 坑） |
| `scripts/qa/` | engine-probe（12 组 ground-truth + §2 可达性分层/池化 A/B）+ e2e（真实 token 会话，`npm run qa:e2e`） |
| `scripts/deploy-local.mjs` | 本机一键部署（gitignored，含本机路径；用 copyFileSync 手动遍历，勿用 cpSync） |

## 3. 当前状态（2026-08 大改收尾后）

> **增量（本会话）**：文献库入库 MemTrapBench（第 15 篇，已蒸馏），并落地「记忆适用性（防记忆陷阱，AdaptiveMem 本土化）」——AGENTS.md §5 四风险 + 决策流程、`math-memory.mjs` 每轮注入适用性纪律、`note_recall` 适用性提示、`inapplicable` 反馈动作（不降成功率）、`lit-import.mjs` 改增量合并（修全量覆盖 bug）、`docs/literature.md` 补「新增单篇文献 SOP」。回归 83→90。皮肤中心加固：`skinCenterMountable` 收紧为检查两个具体皮肤包，degrade 皮肤禁用块改为运行时读取 `$DSH_HOME/cordis.patch.yml` 动态生成（去硬编码 11 id）。又入库并蒸馏 4 篇检索对齐文献（Dual RAG / QueryLink / HyPE / MemSearcher；**文献库当前规模见 [`docs/literature.md`](literature.md)**，此处不再复述数字——同一事实曾被写出 14/15/19/20 四个版本），综合改进见 `literature/notes/retrieval-alignment-2026-08.md`。**策略层已实现**（`strategy-layer.md` 落地）：strategy 模板 + `note_strategy` 工具 + `working.md` 注入 + AGENTS.md 策略层路由/iterative retrieval；回归 +5（strategy 解析/classify/working 注入）。**记忆纠错与确定性自维护已实现（0.7.2）**：`docs/memory/self-correction.md` P1–P5 全部落地——P1 纠错进检索三件套（superseded/duplicate_of 排除 / wrong 降 verified+封顶 0.35 / hookPrior 权重 0.15）、P2 待重审清单、P3 低效用卡自动归档（默认 off）、P4 duplicate_of 标记、P5 strategy 统一生命周期；回归 90→104，`main.js` 已重建。**自动保存对话已实现（0.7.3）**：`docs/memory/obelisk-comparison.md` §5 落地——整场对话（不含思考）确定性写进 episodes（尾截断 + seq 增量续接 + vault 过滤 + `sessionCapture` 当时默认开；**0.7.4 起改为默认关**——见 §5 决策记录），`distillSession` 加 seq/createdAt/clip 参数，`runSessionCapture` + marker；回归 104→118。双面板 UI（Obsidian 记忆面板 + dsh web 记忆面板的「自动保存对话」开关、「立即保存对话」按钮、「N 个未保存」角标）也已落地，`main.js` 与 `lib/client.js` 重建。

**本轮改动总账（按阶段）**：

1. **仓库文档大改**：测试断言数全仓统一（README 中英 / ARCHITECTURE / docs-memory-README / handoff）；README 双语旧身份 `obsidian`→`notes-assistant`；env 旧名改新名（`DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`）；`docs/archive/REFACTOR-PLAN.md` 退役、根 `TESTING.md` 并入 `docs/memory/testing.md`；新增 `scripts/check-doc-consistency.mjs` 一致性守卫。
2. **文献库子系统**：`literature/` 双面文献库 + `scripts/lit-import.mjs` + `docs/literature.md`；**当时**导入 14 篇论文、产出 14 张卡 + 14 条精读记录 + `notes/memory-system-review.md`（14 篇综合、优先级建议）。**当前规模以 `docs/literature.md` 为准**（现为 20 篇，该文件与 `literature/.raw/` 的实际内容一致）。
3. **记忆系统强化（两轮）**：`hookPrior` promote/demote（verified/success_rate/uses 0.45/0.25/0.20 + recency 0.10，90 天线性衰减）；每日体检新增反模式、热度归档候选（heat 0.5/0.3/0.2）、被动召回信号（空结果率）；records 模板加 `confidence` 与「可修订记录」；templates/profile/AGENTS.md 补定理表聚合、条件演化门、写卡去重、自动链接、Refine 步、检索粒度纪律；回归 75→82。
4. **Phase 1 解耦（host-agnostic core）**：把 Obsidian 插件里的确定性记忆操作抽成 `dsh/host/memory-admin.mjs`（纯 node:fs/path）；`build-obsidian.mjs` 嵌入 + 插件 `MEMORY_ADMIN` loader；插件本地副本改别名；`npm test` 增 `node --check dsh/host/*.mjs`。
5. **Phase 2a（宿主面板路由）**：`dsh/host/math-memory-panel.mjs` 挂 `/memory-panel/*`（loopback-only + pathInside 门控，复用 memory-admin）；boot 冒烟 `GET /memory-panel/state` 返回 `{ok:true}`。
6. **Phase 2b（客户端面板）**：`dsh/client-panel/` React 面板（工作区下拉 + 手动 root + localStorage），esbuild 打包，装在主 dsh web Settings（`settings.section` 槽位，显示名「记忆面板」）；实测可用。
7. **面板方案 A（两实例）**：主 dsh web `3080`（`web` profile，编程 + 记忆面板）、notes dsh web `3180`（`notes-assistant` profile，Obsidian 聊天，fail-closed、不挂 `@linxin666`）。Obsidian 插件新增命令「在 dsh web 打开记忆面板」+ 设置 `memoryPanelUrl`（默认 `http://127.0.0.1:3080/`，`electron.shell.openExternal`）。

**身份解耦（早前 Phase 2，已稳定）**：文件更名 `obsidian-*`→`math-memory`/`note-tools`/`math-memory-workspace`；npm 包 `dsh-obsidian-math`→`dsh-math-memory`；profile/preset id `obsidian`→`notes-assistant`；权限预设 `obsidian-locked`→`math-memory-locked`；env 别名 `DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`（旧名兼容）。**单仓**（不拆双 git 仓库）。

**开关与共存 / 独立设置面板**：总开关 `enabled` + 粒度开关 `dialogueIndex`/`reminders`/`audit`；独立设置面板 = 工作区级 `.deepseek/config.md`（host-agnostic 配置文件）；**皮肤中心改为可选**（默认不挂载；Obsidian 设置「启用皮肤中心」开关把 `ui-skin-center` + `ui-web-ui-settings` 追加到 `notes-assistant.patch.yml`，需 web profile 镜像 `@linxin666` 包）。

**QA 状态（2026-09-11 更新）**：`npm test` **28/28 门禁全绿**（记忆回归 **240/240**、路由 **47/47**、侧栏握手 8、反代 **32/32**）；合成 vault 引擎探针 12/12；**真实 vault 探针 12/12**（导航索引降权后恢复满格，未改任何 ground truth；另输出可达性分层与池化 A/B）；真实 token 会话 E2E（`npm run qa:e2e`）**留待用户本机跑**（需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN 真实 JS 入口 + 模型余额）。侧栏交互性能探针（`scripts/qa/sidebar-perf-probe.mjs`）按需运行，不进 CI。

**宿主适配（2026-09-10，dsh 0.1.5-rc.1 + dsh-web-all 0.3.20）**：完整取证与清单见 [`docs/dsh-0.1.5-adaptation.md`](dsh-0.1.5-adaptation.md)。结论：解码与蒸馏路径**无需改动**（V3 仍是多帧无字典 zstd，事件名与 `source.kind==="user"` 判据不变）；profile patch / preset / `settings.section` 槽位在 0.1.5 下全部实测有效（boot 冒烟 + `/memory-panel/*` 均 200）。唯一真实缺陷是 **V3 迁移会为同一会话保留 V2 原件**，于是"一个会话两份都以 `.jsonl.zstd` 结尾的日志"成为长期状态；已按会话去重（**显式优先 `.v3.` 变体**，因为两者 mtime 可能同刻）修复，`findSessionLogs` 在切片前完成折叠，preset 与 host 两份副本同步。回归 126→138，`main.js` 已重建并已 `deploy-local` 到本机 vault / `$DSH_HOME`。

**安全修复（2026-09-10，评估 P0 三连 + 三个小修）**：完整评估与优先级队列见 [`docs/project-assessment-2026-09-10.md`](project-assessment-2026-09-10.md)。本轮修掉：① `/memory-panel/*` 无鉴权 + 约束根由调用方指定（→ root 锚定 + Origin 校验 + 可选 token）；② `archiveMemoryFile` 零校验（→ 只收 `.deepseek/<层>/*.md` 常规文件，且校验通过才建归档目录）；③ frontmatter 写入的 `$` 替换模板展开与空块偏移 0 插入（→ `frontmatterSpan` + `replaceFrontmatter` 按偏移拼接）；④ `install-into-profile.mjs` 在所有随仓库发布的 patch 上静默 no-op（→ 追加式 insert + 写后断言）；⑤ LinkServer 二次解码导致链接挂起（→ 删二次解码 + handler 包 try/catch）；⑥ `/memory-panel/workspaces` 因 root 门禁永远 400（→ 分支前移）；⑦ capture-policy 的 `field` 未校验（→ 白名单 + mode 白名单）。回归 **165 + 路由回归 25**（现为 191 + 28）；新增 `scripts/test-panel-routes.mjs`、`scripts/check-embedded-writers.mjs`；`check-doc-consistency.mjs` 改为读**运行期** `__CHECKS__`。`main.js` 已重建、`deploy-local` 已执行、live 验收 9/9（含"被拒的归档不留空目录"）。

**检索与验收网修复（2026-09-10，第二批）**：① **探针改调产品真管线**——`note-tools.mjs` 新增 `buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`，`note_recall`、`note_strategy` 与两个探针共用同一实现（原先探针手抄 `0.85*BM25+0.10*cjk`，产品是 `0.75*BM25+0.10*cjk+0.15*hookPrior`，静默分叉导致纠错机制长期无回归覆盖）；② **导航索引降权**（`episode-index` 0.4、`theorem-index` 0.7）+ 弱信号判据落在内容文档上 ⇒ **真实 vault 探针 9/12 → 12/12，未改任何 ground truth**；③ 四项决策落地：皮肤中心开关改名并写清"关掉不关皮肤"（默认仍 false）、junction 镜像自愈（`lstatSync` 判别悬空即重建）、`captureSubagents`（默认 false，V3 头部 `origin`/`delegationDepth` 可判定）、导航索引降权。回归 **160 → 165**（新增子代理过滤 5 项）。

**体检报告与面板呈现重做 + 反馈三选项分层（2026-09-10，第三批，0.7.5）**：用户提出四个问题——体检报告「几乎是 ds 的输出记录，令人不知所云」、记录层「对/错/归档」三选项「不明所以，感觉意义不大」、记忆面板信息显示待优化、Release 没更新版本导致插件商店拿不到新版。两份只读取证调研（面板呈现 + 反馈机制）之后落地：

- **体检报告拆成两个渲染、一份数据**：`buildAuditReport` 现在产出 `checklist`（模型看的指令清单）与 `human`（人看的中文摘要），结构化事实进 `counts`/`decisions`/`thresholds`/`sections`/`structural` + `schemaVersion: 2`；`readAuditReport` 让面板拿到对象而不是一根字符串。顺带修掉「报告建议归档一张它刚刚归档掉的卡」的排序缺陷（`archivedRels` 统一过滤 section 与 `decisions`）。
- **数据层补齐**：`collectMemoryState` 收集全部五个卡片层（此前只 records/templates，文档承诺的 topics/theorems/strategy 在两个面板都不可达）、episode 带人类标题/主题/日期（解析 `episodes/index.md`，替代捕获写盘时间）、卡片带 `topic` 与 `layer`、搜索大小写不敏感且覆盖 episode。
- **「对/错/归档」分层**：回复行改为每卡一行并写明卡标题、去掉 🔁 不适用（它写的字段无任何读取方）；`归档` 从评估行移出，成为面板的生命周期动作（二次确认 + 危险样式）；web 面板的 `run()` 不再丢弃响应体（**回执**是这次改动的关键之一）；`❌` 不再给无评级卡凭空写 `success_rate`；无 `hook:` 块的卡自动补块，✅/❌ 对所有卡可用。
- **发布链路**：新增 `scripts/check-version-consistency.mjs`（五处版本 + tag）、`versions.json`、`docs/release.md`；三方版本对齐 0.7.5；`release.yml` 从「推 tag 零测试」变成完整门禁（npm ci + 版本一致性 + 重建 diff + npm test + 正确的 CHANGELOG 段落）。**推 tag 仍需用户口令。**
- 回归 **165 → 224**（新增 §30 面板数据层 22 项、§31 体检归档一致性 6 项），`main.js` 与 `lib/client.js` 均已重建。

## 4. 必须知道的坑（勿重蹈覆辙）
1. **本机 `fs.cpSync` 会原生崩溃**（0xC0000409）。任何脚本用「手动遍历 + copyFileSync」。
2. **Obsidian 1.13.7 视图生命周期有 `open(containerEl)` 方法**——ItemView 子类**不得**定义 `open/close/load` 同名方法。
3. **vault 索引排除点号路径段**（`.deepseek` 对 Obsidian API 不可见）：面板用 node fs 读取 + 预览 Modal，不能 openLinkText/TFile。
4. **Obsidian 1.13.7 的 Notice 构造不调 setMessage**——抓 toast 用 DOM MutationObserver。
5. **插件 id `dsh-math-assistant` 是稳定标识、永远不要改**——Obsidian 按 `.obsidian/plugins/<目录名>/` 加载插件，manifest `id` 必须等于目录名；改 id 会让已有安装插件「消失」。有 `check-plugin-id` 守卫。
6. **notes profile 默认不挂载 `@linxin666` UI 插件**——皮肤中心（`ui-skin-center`/`ui-web-ui-settings`）是可选的，由 Obsidian 设置「启用皮肤中心」在运行时追加进 `notes-assistant.patch.yml`（仅在存在 web profile 可镜像时）。若有人把 `@linxin666` 挂载加回 `cordis.patch.yml` 会 boot 崩（`check-skin-fallback` 会拦：挂载必须在降级块里被禁用；`cordis.patch.yml` 当前是 0 挂载）。
7. **插件 bootstrap 每次加载强制刷新** `math-memory.mjs/note-tools.mjs/.../notes-assistant.patch.yml`（overwrite=true）——机器本地手改这些文件会被冲掉，改动必须进仓库。
8. **防护必须双端接线**：给 loopback 端点加 CSRF/权限校验时，必须同步更新注入给模型的链接模板（`t=`）；只改端点不改模板 = 点击闭环静默断裂。
9. **缓存语义变更必须带版本**：`cache/dialogue-index.json` 按指纹复用；任何过滤/配对语义变化都要 bump `schemaVersion`（现为 2）。
10. **fallback 写入必须抵抗刷新**：`notes-assistant.patch.yml` 每次加载 overwrite 刷新；运行时追加的机器本地块要在 `ensureObsidianPatch` 里提取重放。
11. **dsh web 客户端插件契约**（已核对 `@linxin666/dsh-client-ui-*` 类型）：`window.__ModuleLoader__.load({id, factory})`；`factory(require)` 内自建 `var module={exports:{}}`、`var exports=module.exports`，末尾 `return module.exports`；导出 `inject` + `apply(ctx)`；`ctx.inject([...deps], (scope)=>...)`；槽注入 `scope.slots.inject('settings.section', () => scope.slots.register({name,id,order,label}, Component))`；清理用 `ctx.effect(() => disposer, name)`；宿主路由 `ctx.webServer.register({kind:'prefix'|'exact', path, handler})`。`settings.section` 的显示名字段是 **`label`**（不是 `title`/`locale`），否则节无名。
12. **web profile 客户端装配是显式名单**：`profiles/web/package.json` 的 `dsh.profile.bundles` 聚合 + `cordis.patch.yml` 里 insert 包名。新增客户端包必须跑 `install-into-profile.mjs` 把包名 insert 进 patch，否则不加载；目录不会被自动扫描。
13. **面板 = 宿主半 + 客户端半**：宿主插件（`dsh/host/math-memory-panel.mjs` 的 webServer 路由）+ 客户端插件（`dsh/client-panel/` 的 React 壳）**两半都要装进同一 profile** 才成面板。
14. **`DSH_BIN=dsh` 是 shell shim**：e2e/脚本要传真实 JS 入口 `.../node_modules/@deepseek-ai/dsh/lib/bin.js`，否则 service 早期退出 code 1。
15. **dsh web 长会话 OOM**：本机曾 `JavaScript heap out of memory`（fetch ECONNRESET 表象）。启动加 `--max-old-space-size`（本机 4096）+ `--no-open`，boot 失败把 cause 写进日志再断言，别只报 code。
16. **面板前端 fetch 空 root**：`root` 为空时 fetch 会拿到 SPA HTML（`<!doctype`）导致 `Unexpected token '<'`。root 输入 + localStorage（`dsh-math-memory.panelRoot`）守卫；工作区列表走 `GET /memory-panel/workspaces`。
17. **本机有两个 dsh 安装**：Obsidian 插件 `dshInstallDir` 可能指向非 npm 全局的 dsh（如 `E:/software/deepseek-harness/dsh` v0.1.0-rc.6），其 dsh-web-frontend bundle 与 npm 全局版（v0.1.1-rc.2）文件名与渲染器变量都不同。前端补丁必须同时改写 `new URL(u).protocol` 与 `new URL(s).protocol` 两种写法；排查「补丁未命中」先看插件 `data.json` 的 `dshInstallDir` 到底指向哪个 dsh。
18. **乱码 workspace 会话目录会让 dsh 崩溃**：`$DSH_HOME/sessions/` 里若出现含 `~FFFD~`（Unicode 替换字符）的乱码目录，dsh 0.1.1-rc.2 在 session identity 校验时报 `corrupt session log` 并 boot 失败。把乱码目录移出 `sessions/`（备份，勿直接删）即可恢复。
19. **dsh ≥ 0.1.5：一个会话可能有两份日志**（会话格式 V3）——迁移生成 `session.v3.jsonl.zstd` 并**保留** V2 原件，两份都以 `.jsonl.zstd` 结尾，同目录长期共存；新会话只写 V3，`version` 字段在头行（`0`/`2` = 旧，`3` = 新）。⇒ 任何"扫 `$DSH_HOME/sessions`"的代码都必须**按会话去重**（`sessionLogKey` + `selectAuthoritativeLogs`，**显式优先 `.v3.` 变体**：迁移件与原件 mtime 可能落在同一时间戳刻度上，只看 mtime 会选错），否则同一个会话会被计两次/索引两次。旧版本文档里的 `findSessionLogs` 平铺夹具（`s1.jsonl.zstd`）也已改为真实 `<session-id>/session.jsonl.zstd` 目录布局。
20. **V3 里没有逐块流事件**：`assistant/chunk` / `reasoning-chunks` / `text-chunks` / `tool-call-chunks` 在 V3 中不再存在（内容进 `assistant/message.data.stream[]`），事件量显著变小。依赖"逐块事件"的任何新逻辑在 V3 上会静默拿不到数据。—— 以上两条的完整取证见 `docs/dsh-0.1.5-adaptation.md`。
21. **`String.replace(a, b)` 的 `b` 是替换"模板"不是字面量**：agent 写的 frontmatter 里 `$$`／`$&`／`$'`／`` $` `` 会被展开（`title: 关于 $$ 的表示` → `关于 $ 的表示`；`$&` 把整段 frontmatter 注入标题）。写文件的代码一律用 `replaceFrontmatter`（按偏移量拼接）或 `replace(x, () => y)`；同一个坑 `scripts/build-obsidian.mjs:57-59` 早有注释记录。
22. **空 frontmatter（`---\n\n---\nbody`）是合法输入**：`replace("", x)` 会在偏移 0 **插入**而非替换，把收尾 `---` 推到文件中间——而调用方仍收到 `{ok:true}`。写入器一律走 `frontmatterSpan` 定位。
23. **loopback 不是授权边界**：`/memory-panel/*` 的旧实现在 `127.0.0.1` 之上再无校验，而**任意网页**都能用 `content-type: text/plain` 发 CORS 简单请求（无预检）打到它。现在靠三件套：root 只在重启述 profile 的 vault、非 loopback `Origin` 拒绝、有 token 的实例强制 token。**改这些路由时不要削弱任何一件**——`scripts/test-panel-routes.mjs` 会在拆掉守卫时立刻失败（变异验过）。
24. **插件内嵌的那份 `memory-admin.mjs` 才是 Obsidian 里真正跑的代码**：改 `dsh/host/memory-admin.mjs` 后**必须** `node scripts/build-obsidian.mjs`，否则 `check-embedded-writers.mjs` 会以 `main.js embeds the current …` 失败拦住提交（这条守卫补上了"旧 embedded-loader 守卫比对的是自己那份名单"的漏洞）。
25. **验收必须跑在"已部署"的代码上**：本轮实施时首轮 live 验收跑在还没部署修复的 profile 上，把真实 vault 的 `临时.md` 归档了一次（已复原、时间戳不变）。跑 destructive 验收前先确认 `$DSH_HOME` 里的副本与仓库一致（`deploy-local`，或显式比对哈希）。
26. **dsh ≥ 0.1.5：裸 root 一律 401，界面只能通过带 token 的启动地址打开**。token 只出现在子进程 **stdout**（`--no-open` 时不会进浏览器），插件必须流式抓取并让 iframe 加载该地址（303 会顺手种下 `dsh-auth-<sha256(host:port)>` cookie）；cookie 绑定 `host:port`，**换端口即失效**。探测必须三态（`ready`/`unauthorized`/`down`）——把 401 当"健康"正是侧栏显示 401 文本页却报"服务就绪"的原因。回归见 `scripts/test-panel-auth.mjs`。
27. **`probeService` 这类依赖 Node 内建模块的 helper 必须放进嵌入 loader 的 body 里**：`new Function` 求值的代码**没有**模板作用域的闭包，所以 `http` 要在 `new Function` 的参数表里注入、函数在 body 内定义、再经 `return {…}` 白名单导出。直接写在模板里会 `ReferenceError`（只有 Obsidian 运行时才会炸）。
28. **dsh 的会话 cookie 是 `SameSite=Strict`，Obsidian 的 iframe 永远拿不到它**——这是"抓到 token 但界面仍 401"的真正根因。iframe 的顶层站是 `app://obsidian.md`、框架是 `http://127.0.0.1:3180`，**跨站**；`SameSite=Strict` 的 cookie 在这种导航/子请求里既存不下也用不上。**解法是让插件在主进程里做反代**（`DshWebProxy`）：代理解析启动行里的 token，**以"公共权威"（用户配置的端口）**兑换出 cookie 并保存，然后给每一个转发请求注入 `cookie` 与 `host`；dsh 自己退到 `--port 0` 的内部端口。**两条不能改**：(a) 代理必须监听用户配置的那个端口（cookie 名是 `dsh-auth-<sha256(host:port)>`，端口一变 cookie 名就变）；(b) 转发时必须把 `host` 改写成公共权威（`requestAuthority` 取 `Host`），否则 cookie 名对不上。另外 Node 的 `fetch` **忽略**调用方传的 `host` 头（forbidden header），要指定权威必须用 `http.request` + `setHost:false`。回归：`scripts/test-panel-proxy.mjs`（15 项，stub 上游）+ `scripts/test-panel-auth.mjs`（7 项，**对真实 dsh**）。
29. **探针绝不能自己复刻打分公式**：两个 QA 探针曾各自手抄一份 `0.85*BM25 + 0.10*cjk`，而产品是 `0.75*BM25 + 0.10*cjk + 0.15*hookPrior`，且探针从不调用 `isRecallEligible`——**权重改了三个月没人发现，纠错机制等于没有回归网**。现在产品管线抽成 `buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`，任何新探针/新测试都必须调用它们，**不要**在测试里重写评分。
30. **导航索引（`episodes/index.md`、`theorems/index.md`）对任意中文查询都有高覆盖率**（它列出所有条目标题），因此**不能**用它的 coverage 判断"库里有没有答案"——弱信号判据必须落在内容文档上。它在排序上已按 kind 降权（`episode-index` 0.4、`theorem-index` 0.7），但仍留在语料里（它是"这里有什么"的地图）。
31. **正则里的 `\s` 会吃掉换行**：`parseEpisodeIndex` 的分隔符原写成 `(?:\s*[—–-]\s*(.*))?$`，于是 `- [[a]]` 的下一行 `- [[b|标题]] — 主题` 被当成**同一行**的续写——`a` 的 `topic` 变成下一行的整条链接。行内分隔符一律用 `[ \t]`（`scripts/test-memory.mjs` §30 钉住了这一点）。
32. **面板的「空状态」判据必须覆盖所有层**：旧判据只看 4 层，于是只有主题/策略卡的 vault 被判成"记忆库还是空的"；而真实 vault 里它又几乎永不触发（episodes 被自动捕获填满），第一次使用的人只看到一堆事件文件名。改判据时同步改两个面板。
33. **回执是功能的一部分**：dsh web 面板的 `run()` 原本丢弃响应体——点 ✅/❌/归档 界面上什么都不发生，而唯一显示的 `success=` 对真实卡永远是 `—`。**任何写操作都必须把宿主返回的 `message`/error 显示出来**，否则用户无法区分"生效了"和"点了没反应"。
34. **`last_not_applicable` 没有读取方**（全仓库 grep 只有写入点）。加新的 frontmatter 字段时，必须同时指出**谁读它**；写而不读的字段会在 UI 上表现为"看起来像 ❌、实际零效果"，比没有这个选项更糟。
35. **真实 vault 里这套反馈机制从未被使用过**（2026-09-10 全库普查：`last_wrong`/`needs_review`/`last_not_applicable`/`status: superseded`/`verified: user-confirmed`/`success_rate` 全为 0，🔁 字符 0 个，`.deepseek/archive/` 不存在，3 张真实卡全是 `single-source` 且无 `success_rate`）。**"没人用"本身就是最强的信号**：先怀疑入口（文案/回执/位置），再怀疑机制。
36. **版本号不是发布**：Obsidian 的更新只认「社区注册表条目 + tag 等于 `manifest.json` 版本的 Release」。本插件**不在** `community-plugins.json` 里，且 0.7.2–0.7.4 从未推过 tag ⇒ 用户端永远停在 0.7.1。发版步骤见 `docs/release.md`；`check-version-consistency.mjs` 钉住五处版本号（package / manifest / lock / versions.json / CHANGELOG）。
37. **面板是两半，生效方式不同**：宿主半（`math-memory-panel.mjs` + `memory-admin.mjs`，装在 `profiles/web/node_modules/@dsh-math-memory/…`）**由 dsh web 进程启动时加载** ⇒ 换新要**重启 dsh web**；客户端半（`client.js`）是页面加载时取的静态文件 ⇒ **刷新页面**即可。两者之间存在"新客户端 + 旧宿主"的窗口，所以客户端必须给每个字段兜底（`{ rel:'', topic:'', … , ...card }`），否则会渲染出字面量 `#undefined`。
38. **旧缓存（audit schema v1）要能降级渲染**：v1 的 `memory-audit.json` 只有 `report` 字符串，没有 `human`/`sections`/`decisions`/`today`。面板不能因此说"还没有体检记录"，也不能把模型清单原样摊开——`normalizeAuditForPanel` 会从 v1 遗留的 `pendingReview`/`archiveCandidates`/`passive`/`generatedAt` 合成 `sections`/`decisions`/`today`，`legacyAuditSummary` 合成人话摘要；下一次体检写回新格式后自动失效。
39. **跨皮肤写样式只能用各皮肤都保证存在的 token**。dsh web 面板的次级文字原本用 `--dsw-alias-label-dimmed`，而用户当前皮肤 `orca-link` **只定义 `primary/secondary/tertiary/caption`** —— 该变量不存在，`color` 声明在计算值阶段失效、颜色回退到继承值。表现是"浅色文字看不清"，真因是"这条样式根本没生效"。现在统一用 `var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary, …))`。Obsidian 侧同理：`--text-faint` 换成 `var(--text-muted, var(--text-faint))`。**改面板配色前先确认皮肤里有没有这个变量**。
40. **侧栏只有 ~340px，卡片必须纵向排布**。观察到的"标题看不出内容"有一半是布局问题：四个动作按钮（`✅ 确认`/`❌ 有错`/`过期`/`归档`）本身要 235px，元信息又占 60%，单行 `nowrap` 布局下标题与摘要各只剩 ~50px（约 4 个汉字）。现在每张卡四行、各占满一行（标题/摘要/元信息/动作），元素改回 `flex: 1 1 auto` 或 `max-width: 60%` 就会退化回去——用 headless Chromium 量过（316/400/500/700/900px 五档，摘要都在标题下方且不溢出）。
41. **卡片摘要必须跳过"记账行"**：真实 vault 里导航层卡片的正文首行是 `- 标签：#…`，而 `strategy/strat-ot-structure-proof.md` 里有两行**游离在 frontmatter 之外**的 `uses: 0`（早期写入缺陷留下的，已于 2026-09-10 清理）。按"取正文第一行"直接做摘要会得到"标签：#…"和"uses: 0"。`summaryOf` 因此跳过 YAML 形状的行与一组中文记账前缀，并且**只认文件开头那个 frontmatter 块**。
42. **"后来才长出来的东西"要回头比对所有枚举消费点**（2026-09-10 专项审计的元结论）。按轴搜出 6 处真实缺陷：归档目的地/索引写死 `records`（策略卡会误归档 + 该层索引悬空）、web 面板 sessionCapture 勾选与引擎相反（缺失键=OFF 而面板用 `!== false`）、文档说 sessionCapture 默认开而实际默认关、注入的"分层长期记忆"说明停在五层（没有 templates/strategy）、AGENTS.md 三写第 3 步清单漏了 `strategy/`、本机 `deploy-local.mjs` 只部署 8/19 个模板。**新增一个层/动作/开关时固定要问：谁枚举了它的兄弟？**（归档目的地、索引、注入段、设置页、面板、模板清单、文档表、测试都算）。三处判定为有意为之并写明理由：体检只扫 records/templates/strategy、`structural` 只对 records 生效、`notation.md` 按普通笔记进检索语料。
43. **"追加 frontmatter 字段"的助手也会写到块外**：`syncTopLevelStatsToCard` 把**含首尾 `---` 的整块**传给了只认"行"的 `setTopFieldText`，于是没有 `uses:` 行的策略卡被追加到**闭合分隔符之后**（正文里），而且每次体检再加一行——`strategy/strat-ot-structure-proof.md` 里那两行游离 `uses: 0` 就是这么来的（2026-09-10 定位并修复）。**规则**：追加字段前先把块拆成「分隔符 + 内容 + 分隔符」，只在内容里拼接；写完**读回验证**（这次正是读回验证抓到的，见坑 44）。
44. **"写完就当成功"是最容易复发的缺陷形态**（2026-09-10 一天内 4 个 bug 全是它：安装脚本 no-op、归档非卡、面板显示开启而引擎关闭、体检建议归档它刚归档的卡）。现在体检的每处确定性写入都**返回布尔 + 读回核对**，`status: "degraded"` + `warnings` 会写进人话摘要与模型清单。**新加写入路径时必须照此办理**，否则它会静静地不生效（上线当轮它就抓出了坑 43）。
45. **`uses` 是「声明值 + 未合并增量」**：`cache/retrieval-stats.json` 是**增量**（体检合并进 frontmatter 后清零），不是总量。面板显示 `uses`（有效值）并另给 `usesDeclared`/`usesPending`；只看 frontmatter 会在两次体检之间少报，只看 stats 会以为计数丢了。
46. **检索不要做通用「去冗余 / 多样化」**：GraphMemix 的冻结候选控制实验里 MMR/DPP 类目标不优于朴素 top-k、净回收为负（−6 / −36）；有用的是**已验证的关系**（`related`/`source` 顺链，+43）。这条已写进 `AGENTS.md` §5，避免以后凭直觉加惩罚项（见 `docs/memory/references.md` §12）。
47. **`not_applicable_when` 现在门控检索**：查询命中边界短语 → 该卡不进候选、但在结果里单独列出「因适用边界被排除」（**不静默丢弃**：静默假阴性比误召回更难发现）。匹配按标点拆出的 ≤12 字短片段做子串包含，所以**要写成短句/关键词列表**——整段散文会被拆碎、门控不准。
48. **`verified_by` 是验证等级的凭据**：只有用户点 ✅ 时由插件写 `user`；❌ 把等级留在 single-source 之上时会写 `none` 作废旧确认；体检把「等级高于 single-source 却没有凭据」列为越权升级（**只报告、不自动改**——自动改写可能覆盖用户手改）。
49. **iframe 内的 `backdrop-filter` 看着很贵，实测不是卡顿来源**（第一轮的错误结论，保留作教训）：皮肤 `orca-link` 在侧栏区域盖了一层 `:before { inset: 0; backdrop-filter: blur(10px) }`，第一轮据此推断「跨帧毛玻璃让宿主动画每帧重算模糊」并上线了 CSS 注入。**用户复测仍然卡**，随后用 CDP 做对照实验：把皮肤 CSS **全部**移除后，6 次真实点击的帧数据**一点没变**（3→4 帧 >50ms、最差 84→83ms、RecalcStyle 1172→1165ms）。教训：**「看起来贵」不等于「测得出贵」**——先 A/B，再改代码（`docs/memory/sidebar-performance.md` §2/§4）。CSS 注入保留（代价为零），但别再把功劳记在它头上。
50. **★ 侧栏卡顿的真因是皮肤的客户端脚本 `hooks.mjs`**（同一个皮肤在 Obsidian 侧栏与 3080 都在跑，所以两边一起卡）：它注册约 14 个 subtree MutationObserver，有一个约 5 次/秒改 `DIV.orca-ch-statusCharacterSprite` 内联样式的角色循环，还有一个 ResizeObserver 跟着侧栏动画**每帧**触发（读布局 → 写 body 级 CSS 变量 → 翻 `body[data-orca-sidebar-wide]`）。停用该模块：帧 >50ms 从 3 → **0**，最差帧 84 → **33ms**，LoAF 8 → **0**。处置：代理改写该模块的两处热循环（默认，装饰保留），或换成空实现（可选设置，最流畅）。
51. **给转发响应加 `content-length` 时必须同时删掉 `transfer-encoding`**：dsh 的 HTML 走 chunked，注入改写后如果两个头并存，客户端直接判协议违规（`Content-Length can't be present with Transfer-Encoding`），现象是**打开侧栏就白屏**。这个缺陷是 `test-panel-proxy.mjs` 的 stub 上游抓到的（真实 dsh 也是 chunked，所以它一定会发生）。
52. **注入只能在未压缩响应上做**：dsh 只要客户端声明 `accept-encoding: gzip` 就压（实测 28884 → 4388 字节）。所以性能模式的改写路径必须 (a) 只对**导航请求**与**皮肤 hooks 模块**去掉 `accept-encoding`，(b) 见到 `content-encoding` 就原样透传，(c) 没有 `</head>` 就原样透传。三条都进了回归。
53. **改写第三方模块必须「锚点全中才改、否则原样返回」**：皮肤 `hooks.mjs` 的补丁按宽松正则匹配两处锚点，任一缺失就返回原文并写日志——皮肤更新后补丁失效是**降级**，绝不能变成「皮肤崩了」。
54. **渲染线程上的同步文件 IO 会被当成"界面卡"**：`writeDebugLog` 原用 `appendFileSync`，由 `render()` 调用（启动日志实测 7 ms 内 3 条）。改成队列 + 250 ms 异步批量追加；卸载时 flush 一次。同类：记忆面板搜索框曾**每次按键**重扫整个 vault（`collectMemoryState` 是同步扫盘），现在 220 ms 防抖 + 显式按钮走 `renderNow()`。
55. **挂起 iframe 必须能自愈**：`display:none` 挂起（侧栏收起/切标签页）能省下整个 guest 的渲染，但判据一旦误判就是"面板永远空白"。两条保险：只认无歧义信号（祖先 `display:none`、容器矩形为 0、`isShown()===false`），且**挂起期间每秒自检**（只在挂起时跑）——漏事件不会永久黑屏。
56. **★ 守卫必须容忍"这个套件在本机不跑"**：`check-doc-consistency.mjs` 会真的运行各套件并解析它们的 `__CHECKS__` 行，而 `test-panel-auth.mjs` 在没有本地 dsh 时**按设计 SKIP**（CI runner、任何新克隆都是这种情况）——于是守卫把"没有 `__CHECKS__` 行"判成失败，并把文档里写的 7 项认证断言与凭空得到的 0 相比。**这个缺陷让 0.7.5 的第一次 tag 发布在 CI 上挂掉，而本机全绿**。现在 `runSuite(rel, { optional: true })` 识别 SKIP 并返回 null，认证锚点只报告不比较；其它套件缺 `__CHECKS__` 仍然算失败。教训：**任何"在 CI 上不跑"的套件都要在守卫里显式声明**。
57. **★ 守卫必须容忍 CRLF**：CI 是双平台（ubuntu + windows），Windows runner 检出的是 **CRLF**。两个嵌入守卫用多行字面量/逐字节比较解析文本，于是 Windows 上分别报「appended loader helper is unterminated」与「main.js 里的 memory-admin 是旧版」——**Linux 全绿**。修法：读入即 `replace(/\r\n/g, '\n')`（`build-obsidian.mjs` 早就这么做了，所以嵌入体本来就是 LF 形态），比较时两侧都归一化。复现方法：`git -c core.autocrlf=true archive <commit> | tar -x` 得到一个 CRLF 检出（本机验证过 `npm test` 现在 exit 0）。
58. **`npm publish` 失败时日志什么也不说，而且旧的 2FA-bypass token 路线正在被 npm 关掉**：0.7.5 的 Release 与 npm 是两条独立流水线——Release 成功（GitHub Release + 4 个资产），npm 那条在 `Publish` 步失败（前面 6 步全过）。npm 对「token 缺失/过期/无发布权/需要 2FA」一律只给非零退出码。**方向已定：改用 trusted publishing（OIDC），不要再造长效 token**——[2026-07-08](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/) 起 2FA-bypass 的 granular token 已不能做账号/包管理，[2026-07-31](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/) 明确约 **2027-01 起连直接发布也不能**。因此 `npm-publish.yml` 现在：① 不设 `NODE_AUTH_TOKEN`；② 显式 `npm install -g npm@11`（trusted publishing 要求 ≥11.5.1，Node 22 自带 npm 10；**钉 11 不钉 12**——npm 12 默认不跑依赖 lifecycle 脚本，会静默跳过 esbuild 的 `postinstall` 二进制下载）；③ publish 前加一步只读诊断（npm 版本 / `ACTIONS_ID_TOKEN_REQUEST_URL` 是否存在 / `whoami`）。**剩下的是一次性人工动作**：npmjs.com → 包 `dsh-math-memory` → Settings → Trusted Publisher → GitHub Actions，填 `maple110011` / `dsh-obsidian-math` / workflow 文件名 `npm-publish.yml`（**environment 必须留空**——job 未声明 environment，claims 里没有该字段，填了就必然 403）；配完在 Actions 页面对失败的那条 run 直接 **Re-run failed jobs**（不必重新推 tag）。**2026-09-11 已全通**：用户配好 Trusted Publisher 后 re-run 成功，`dsh-math-memory@0.7.5` 上线（`latest`，带 SLSA provenance）。两条由此得来的教训写进 `docs/release.md` §2：**退出码 0 ≠ 已发布**（staged publishing 要人工批准）、**退出码非 0 ≠ 未发布**（重复推同一 tag 会报 `cannot publish over the previously published versions`，现在算成功）；判断成败一律看 registry 实际状态（workflow 里 `Confirm the registry state`），并据此自动关闭历史失败 issue。另：**本机代理会缓存 registry 文档**，排查时通过它查询会看到过期的 `modified` 与 404。
59. **★ 受限环境禁止「管道 stdio」，而一条 `&&` 链会把它伪装成回归**：在禁止子进程管道 stdio 的环境里（本机沙箱、部分 CI 容器），node 进程**无法**通过管道 spawn 另一个 node 进程——`spawnSync` 直接返回 `error.code === 'EPERM'`，`stdout` 为空。后果有二：① `npm test` 的 `&&` 链在第 5 个门禁（auth e2e）断掉，**静默跳过其后 16 条命令**，于是"红了"不携带任何关于其余门禁的信息；② `check-doc-consistency.mjs` 拿到空输出、把计数读成 0，报出 **18 条"文档漂移：文档写 232、实际 0"**——而文档全是对的，**照它去改就会把正确的文档改错**（这才是真正的损失）。修法两条：`scripts/run-node.mjs` 把子进程 stdio **重定向到真实文件描述符**而不是管道（两种环境都能跑且照样捕获输出；实测 `pipe → EPERM / stdout=undefined`，`file fd → status 0 / 输出完整`）；`scripts/run-gates.mjs` 一次跑完**所有**门禁再汇总，失败不再吞掉后续门禁，并把"子进程根本没起来"单独标成环境结果。**判断"红"之前先问：这是代码的问题，还是运行环境的问题？**
60. **★ 仓库内的模板文件名不要叫 `AGENTS.md`**：`dsh/templates/AGENTS.md` 是**要安装进用户 vault 的教学协议**，但 agent harness 只要在仓库里读到 `AGENTS.md` 就会把它当成"**本仓库**的指令"自动注入——实测仅仅读取该文件，就被注入约 200 行"你是本 vault 的数学学习伙伴"，其中还含与仓库维护**直接冲突**的硬约束。修法：源文件改名 `dsh/templates/vault-AGENTS.md`，**安装后的名字仍由 `templates-manifest.json` 映射为 `AGENTS.md`**（build / install / 插件引导三条路径都是按 `source → target` 遍历，所以只需改清单 + 一处漂移断言）；同时补上仓库根 `AGENTS.md` 作为维护协议。**推论**：凡是"面向别人家仓库/目录的指令文件"，都不要在源仓库里占用会被自动发现的文件名。
61. **★ `__CHECKS__` 的分母必须由套件自己数，不能手写常量**：`test-panel-proxy.mjs` 写死 `EXPECTED_CHECKS = 31` 而实际执行 **32** 个断言；`test-panel-auth.mjs` 打印 `7 - failed`/`7` 而可达断言是 **8** 个（9 个调用点里一个在 else 分支）。文档锚点盯着这些自报数，于是**把错的数字抄进了 5 处文档**，而"全绿"只是**算术**而不是覆盖证据。修法：计数放进 `check()` 内部（`total += 1`），末尾打印真实值；`check-doc-consistency.mjs` 的锚点随之被修正。
62. **★ 安全边界要锚在服务端自己的状态上，且"未配置"分支必须有测试**：`/memory-panel` 的约束根一度在**两个环境变量都没设**时退回"请求里带的 `root`"——于是下游 `pathInside(root, target)` 两端都由调用方决定，形同虚设；而套件在它之前的**每个**用例都先设了环境变量，恰好绕过这条分支。修法：允许的根 = 环境变量 ∪ `ctx.workspaceRegistry`，**两者都空则拒绝一切带 root 的请求**；补"未配置 + 空注册表 → 403 且文件未被移动"的用例。**变异验证**：把旧逻辑还原，新用例立刻失败且报 `status: 200`（即真的把卡移走了）。
63. **版本横幅会静默腐烂**：`handoff.md` 写着"版本 0.7.2"而仓库已在 0.7.5，`design.md` 停在"v0.6.x 实现规格"——读者（人和 agent）无法判断文档落后了几个版本，也无法判断该信谁。修法：活文档加**精确标记行**（版本号独占一行）：

   ```
   > 当前版本：0.7.5
   ```

   由 `check-version-consistency.mjs` 与 `package.json` 比对。**用精确标记而不是宽松正则**，是为了不把"0.1.5 adaptation""0.7.2 时…"这类**历史引用**误判成关于当下的声明。
64. **★ 审计报告本身也会过期：照它删代码之前，先自己确认"真的没人读"**：本轮落地一份审查报告时，报告点名 `math-memory.mjs:1294` 是"把写入失败直接吞掉且不留计数器"——实测该处**已经**记录 `statsResetFailed = true` 并进入 `warnings`（报告写于更早的 HEAD，或当时判断有误）。同一轮核对还有两个方向的教训：`RETRIEVE_TARGETS` 确实**零读取方**（删），但它被 `strategy-layer.md` 当作"内核枚举"引用，所以**删它必须同时改文档**，否则那句"改常量就能加取值"的假承诺会随代码一起消失而无人知晓；`pathIsInside`/`pathInside` 是**同名盲区**——两者的名字不同，于是"比对同名符号"的守卫**看不见**这一对，删/改任何一个都不会有提示。**规则**：报告是**线索**不是**事实**——每条"这是死代码"先 grep 全仓（**含 docs**），每条"这里吞了错误"先读现场。核对成本几分钟，误删/误修的成本是一次真实故障。**推论**：写守卫时要想清楚"用什么特征配对"——按名字配对就会漏掉改了名的重复实现。
65. **★ 同一份逻辑的多份拷贝，"能不能 import"决定了修法；守卫该按语义配对而不是按名字/文本**：frontmatter 的边界正则曾被复制 **15 次**、散在 6 个解析器里（P1-6），而它是坑 21/22/43 三次数据损坏的共同根因。看起来"抽成一个模块、全改调它"就够了，但**宿主树根本不能 import**：Obsidian 插件是用 `new Function(params, body)` 求值 `memory-admin.mjs` 的，靠注入绑定、不解析 import。硬凑成一份就要改 loader 的注入契约，风险大于收益。所以最终形态是**一份规范 + 一份必要拷贝 + 一条证明两者行为等价的守卫**。三条推论：① **配对依据是"守卫要防哪种分歧"**——`check-engine-sync.mjs` 防的是同名符号漂移，所以比词法流；这里两份实现的注释与风格本来就不该强求相同，必须相同的是"它认为块在哪"，所以比 **13 个 fixture 上的行为**。② **守卫要放过文档**：只扫代码、跳过注释行，判据是"**运行时能不能与另一个副本分歧**"，否则它会把自己解释规则的注释和引用它的文档一起判违规（第一版守卫就这样误报了 4 处）。③ **要动没人测的路径，先给它加测试**：`hook-frontmatter.mjs` 在插件里的求值路径（剥 `export {...}` + `new Function`）当时**零覆盖**，而这轮正要把它的导出从 3 个改成 9 个、还变成多行——先补 `check-embedded-loader.mjs`（含"真的解析一个 hook 块"）再动代码。
66. **★ 用脚本按行拼接 CRLF 文件：`split("\n")` + `join("\r\n")` 会产生 `\r\r\n`**。读文件用 `[System.IO.File]::ReadAllText` 再 `-split "\`n"`，每个元素**末尾仍带 `\r`**；拼回去时若用 `join("\r\n")`，被保留的那些行就变成 `\r\r\n`（本轮重编 `CHANGELOG.md` 的 `[0.7.5]` 节时踩到，325 行中招）。最阴的地方是**它看起来是对的**：文件照样能读、`check-version-consistency` 与 `check-doc-consistency` 照样通过（守卫都按 `\r?\n` 切分，多出的 `\r` 被当成行内容），但 .NET 的 `ReadLine` 会把那个多出来的 `\r` **当成一次换行**，于是 `Select-String` / `Get-Content` 报出的**行号整体偏移**，让人误判"拼接错位/内容丢了"。**修法**：拆分后 `TrimEnd("\`r")` 再拼，或整文件 `Replace("\r\r\n", "\r\n")` 收尾；**验收**：`[regex]::Matches($raw, "\r\r\n").Count` 必须为 0，且 `(?<!\r)\n` 也为 0（不引入混合行尾）。同族坑见坑 57（守卫必须容忍 CRLF）——那条讲读，这条讲写。
67. **★ grep 会跳过点目录，所以「全仓 grep 过」不等于「真的全仓」**：本轮做文档漂移排查时，`grep dsh.web.ui` 报 28 处、没有 `scripts/qa/benchmark-vault/.deepseek/config.md`；而新守卫直接 `readdirSync` 走文件系统，**立刻报出这一处**——它在一个 `.deepseek/` 目录里（被 grep 工具默认忽略的隐藏目录），而且是 **git 跟踪的文件**（`git check-ignore` 退出码 1）。同一份排查还漏不掉别的：`.github/`、`.vscode/`、任何 `.*` 目录都在 grep 的盲区里。**规则**：要声称"全仓没有 X"，用**自己遍历文件系统的守卫**，不要用 grep；排查阶段的 grep 只用于**定位**，不用于**证明不存在**。**推论**：写这类守卫时要么显式遍历（含隐藏目录），要么把"跳过了哪些目录"打印出来——静默跳过会让守卫和 grep 犯同一个错。
68. **★ 断言/守卫「看起来在工作」的两种形态：读了一个从未赋值的变量 / 前置条件永远不成立**。审查 P3 点名过这一类（"守卫看起来在工作、实际条件失效"），本轮修掉两个真实实例：
    - **① 读了一个从未赋值的变量**：`check-embedded-loader.mjs` 的 `loaderCall()` 算出了偏移 `at`，却写成 `return { params, args, fnAt }` —— 返回的是模块级那个**还没赋值**的 `let fnAt`。于是 `lastIndexOf(marker, undefined)` 按规范等价于**从模板末尾往回搜**，守卫永远校验**最后一个** allowlist，而不是注释里写的"最近的前一个"。**今天正确纯属运气**：memory-admin 的 loader 恰好排在最后；再加一个 loader，它就会去校验**错误的名单**而照样打印 OK。修法：`return { …, fnAt: at }`；并把提取函数**参数化**（`text = template`）以便自测——往合成模板末尾再接一个 loader，断言取到的仍是 memory-admin 的名单。**变异验证**：把 `fnAt: at` 改回 `fnAt` → 自测立刻失败并报出根因（"returned a non-integer fnAt (undefined) … the `fnAt` bug is back"）。
    - **② 前置条件永远不成立**：`test-installer.mjs` 的 `check('vault cache removed', !existsSync(vault/.deepseek/cache))` —— 安装器**从不创建**该目录，夹具里也没有 ⇒ 这条断言**恒真**，把它删掉或注释掉都不会有人发现。修法**不是删掉断言，而是让前置条件成立**：夹具先建出 `.deepseek/cache/captured-sessions.json`（真实 vault 跑过插件后就是这样），再断言 `--purge` 删掉它。修完立刻证明这个行为**确实实现了**（安装器日志打出 `[remove] …\.deepseek\cache`）——也就是说这条断言过去既没保护代码、也没保护文档承诺。
    - **判据（写完任何断言/守卫都问两句）**：「**它读到的东西真的被赋过值吗？**」「**让它失败的那个输入真的可能出现吗？**」两句都答不上来，这条断言就是装饰。同族：坑 44（写完就当成功）、坑 56（守卫把"没跑起来"当成失败）。
69. **★ 逐字节比对构建产物的守卫必须归一化换行；而且"本地全绿"可能是假的——守卫 exit 0 不代表它比过**。新加的 `check-client-bundle.mjs` 把提交进仓库的 `dsh/client-panel/lib/client.js` 与一次全新构建**逐字节**比较，**忘了归一化换行**：Windows runner（`core.autocrlf=true`）检出的产物是 **CRLF / 14456 字节**，构建输出是 **LF / 14445 字节**，差值恰好是文件的 **11 个换行**（实测该文件的 LF 计数 = 11）。于是**同一个 commit** 在 `test (windows-latest)` 上红（"产物过期"）、在 `test (ubuntu-latest)` 上绿（Linux 检出是 LF）。**这是坑 57 的复发**——`check-bundle-freshness.mjs`（main.js）早就用 `s.replace(/\r\n/g, '\n')` 修过同一件事，写新守卫时没照做。
    - **为什么本地几轮都显不出来**：本机沙箱禁止 esbuild 的**子进程**（`spawn EPERM`），守卫**如实打印了 SKIP**、只跑形状检查，然后 **exit 0**；而 `run-gates.mjs` 只按退出码判定成败，于是汇总照打 **34/34**。我连续几轮把"34/34"读成"全部验证过"，**其实那一条什么都没比**（失败只能由 CI 报出来）。**这是坑 68 的第三张脸**：守卫没撒谎，是汇总把它抹平了。
    - **规则**：① 写字节比较的守卫前，先看同族守卫有没有归一化（这里是坑 57）；② **别用"汇总全绿"代替"这一条真的跑了"**——看到 `SKIP`/环境字样就去读那条门禁自己的输出（`node scripts/run-gates.mjs --only bundle`）；③ 本地与 CI 不一致时优先怀疑**换行、路径分隔符、大小写**。
    - **复现与变异验证（修复时实做）**：`git checkout -- <file>` 在内容未变时是 **no-op**，必须 `Remove-Item` 后再 `git checkout --`，才能拿到真检出（实测 `bytes=14456 CRLF=11`）。修前报 `committed 14456 bytes vs fresh 14445 bytes`（**与 CI 逐字一致**）、修后 OK；再故意追加 7 字节 → 仍然 FAIL（证明没有把守卫改成恒真）。
    - **附带**：`core.autocrlf=true` 会让这种"LF 工作区 vs LF blob"在 `git status` 里显示成 `M`，而 `git diff --quiet` 退出 0、`git hash-object -- <file>` 与 `git rev-parse HEAD:<file>` 相同 ⇒ **那是 stat 假象，不是内容变化**；要判断"到底改了没有"，用哈希而不是 status。


## 5. 用户决策记录（不要推翻）

- **单仓**（不拆双 git 仓库），两个产物独立分发（npm 包 + Obsidian 插件）+ 仓库内文献库/面板子系统。
- npm 包名 `dsh-math-memory`；插件 id `dsh-math-assistant`（**不改**）；仓库名 `dsh-obsidian-math`（**未改**）。
- 版本 0.6.2（2026-08-23：链接站内跳转 + 数学交流提示词 + ask_user 节制 + 链接路径免手工编码）。
- 独立设置面板 = **配置文件**（`.deepseek/config.md`），不是图形 UI（若需要可后续在其上加 web 页面）。
- **记忆面板进主 dsh web（3080）**（方案 A）：Obsidian 用命令 `shell.openExternal` 打开 3080；notes profile（3180）保持独立/fail-closed、**默认不挂任何 `@linxin666` UI**（皮肤中心可经设置开启）。
- **文献库放仓库**（`.raw/` gitignore）。
- 不做 token 型 benchmark；推送 GitHub 必须等用户口令（"推送"）。
- **项目定位（2026-09-10 明确，已写进 README 中英与 docs/memory/README.md）**：记忆系统已解决「agent 记不住用户问过什么」；**「辅助用户打磨一套数学理解，并建立对理解/技巧的调用体系」远未解决，真正实现它才是 1.0**。当前 0.7.x 只是"记忆基础设施 + 控制面可用"的试做型。
- **会话隔离（`docs/session-scope.md`）已否决**（2026-09-10，用户决定）：P1/P2/P3/P4 全不做——原始不适来自"面板信息量太低"而非会话列表本身，而 P1 要包住被会话搜索 / lineage / 按 URL 打开共用的 `sessionPersistence.list()`，代价与收益不成比例；侧栏分组折叠（状态持久化）已经够用。详见该文顶部的否决块。
- **捕获策略扩到四个档位**（2026-09-10）：`idea/fact/preference/structure` 各管一组层，`structure` 默认 `auto`（缺行等同 auto，升级不会让用户被多问）。见 `control-panel.md` §2.4。
- **外部设计吸纳**（2026-09-10）：只吸收 5 个「卡片字段 + 确定性检查」级别的小件（适用边界门控 / `harmed` / `verified_by` / 声明值对账 / `degraded`），**拒绝任何"每轮新增必做步骤"**的机制——我们的实测失败模式是"机制没人用"，不是"机制不够多"。评估存档 `docs/design-intake-2026-09-10.md`（含否决清单，勿重议）。
- **检索不做通用去冗余/多样化重排**（有反例实验支撑，见坑 46）。
- **GraphMemix（Li et al. 2026）吸纳范围（2026-09-10 定）**：已吸收「边界门控 / `harmed` / `verified_by` / 声明值与有效值 / `degraded`」（`design-intake-2026-09-10.md` §1）；**多视图 max-pool 实测后不采纳**（探针 A/B：Direct 11→11 不变，目标排名均值 1.73 → 2.27，2 例变差 0 例改善 ⇒ 保持单袋默认，`retrieval-v3.md` §7.2）；查询条件化关系信任 + 锚点槽位、自适应 k、两阶段适用性判定**记录在案不实现**（各带触发条件，`retrieval-v3.md` §7.4）。可达性分层 + 有符号净恢复 Δ 已作为**常驻测量**进引擎探针（`retrieval-v3.md` §7.5）。
- **侧栏性能模式默认开启**（2026-09-10）：它是**唯一**会改动 dsh 侧栏响应字节的机制，取舍是「皮肤毛玻璃 + 两处热循环的节奏」换「宿主与侧栏动画不再掉帧」。开关在插件设置里，关掉即回皮肤原样；不动 dsh 本体、不动皮肤文件、只作用于侧栏这一份渲染。
- **侧栏加载皮肤动态装饰默认开启**（2026-09-10，第二轮）：关掉后侧栏不加载皮肤客户端脚本（hero 场景/状态角色/信号芯片消失），换来实测最流畅的一档（帧 >50ms 归零、Task −18%、RecalcStyle ops −34%）。默认保留装饰，把选择权留给用户。

## 6. 工作流命令

```bash
npm test                        # 240 项零 token 回归 + 47 项路由回归 + 8 项认证 + 32 项反代 + 安装器 e2e + 漂移 + 五守卫 + 文档一致性 + 语法检查（= node scripts/run-gates.mjs）
node scripts/build-obsidian.mjs # 改 dsh/ 或模板后重建 main.js
npm run build:client            # 改 dsh/client-panel/src 后重建 lib/client.js
node dsh/client-panel/install-into-profile.mjs --dsh-home <home>   # 装面板进 web profile
node scripts/deploy-local.mjs   # 本机部署（vault / DSH_HOME / 插件目录）
dsh --profile notes-assistant --port 3180   # 原生（bundle 已提供 panel/workspace）；--direct 装时需 --patch notes-assistant.patch.yml
dsh plugin --profile web add dsh-math-memory   # 把 preset 加进主 web profile（原生，替代旧 --preset-only）
# 真实 E2E（需模型余额 + 真实 vault + 真实 JS 入口）：
#   DSH_HOME=<home> DSH_WORKSPACE_ROOT=<vault> DSH_BIN=<.../lib/bin.js> npm run qa:e2e
# 调试日志：<vault>/.obsidian/plugins/dsh-math-assistant/debug.log
```

## 7. 未做 / 下一步候选（供新会话挑选）

| 项 | 说明 | 优先级 |
|---|---|---|
| **记忆纠错与确定性自维护（self-correction.md）** | ✅ 已实现（0.7.2）：P1 纠错进检索三件套（superseded/duplicate_of 排除 / wrong 降 verified+封顶 0.35 / hookPrior 权重 0.15）+ P2 待重审清单 + P3 低效用卡自动归档（默认 off，`autoArchive` 开关）+ P4 duplicate_of 标记 + P5 strategy 统一生命周期；回归 90→104 | 完成 |
| **自动保存对话（obelisk-comparison.md）** | ✅ 已实现（0.7.3）：整场对话（不含思考）确定性写进 episodes（尾截断 + seq 增量续接 + vault 过滤 + `sessionCapture` 当时默认开；**0.7.4 起改为默认关**——见 §5 决策记录）+ 双面板「自动保存对话」开关 /「立即保存对话」按钮 /「N 个未保存」角标 | 完成 |
| **策略层（方法层 + 工作记忆 + iterative retrieval）** | ✅ 已实现（`strategy-layer.md`：strategy 模板 + note_strategy + working.md 注入 + AGENTS.md 路由） | 完成 |
| **基准测试（benchmark.md）** | ✅ 已实现并实测：仿真 vault + seed-probe（零 token，8/8）+ benchmark-cases（8 维度）+ baseline.json + session log 归档；基线在 `scripts/qa/runs/run-*/`。⚠️ **真实 token E2E 的 8 用例套件从未一次性全绿**：唯一一次完整运行的 baseline 是 **7/8**，其中 1 个失败用例随后被单独重跑成 1/1——所以"8/8 通过"曾经是不成立的表述，已于 2026-09-11 更正（见 §7） | 完成 |
| **3 类陷阱压力样例进引擎探针** | 造 Cognitive Bias / Task Boundary / Trauma 的数学版 ground-truth 进 `scripts/qa/engine-probe.mjs`（需绑定真实 vault，vault 内容变化时同步维护） | 中 |
| **「记忆诱发退化」被动信号** | 有/无记忆对照的答案质量（LLM-judge 打分）作为体检的「固定/扭曲」健康指标（需接 judge，可选增强） | 低 |
| **note_recall 结构化适用性字段** | 现为 prompt 提醒（描述 + 渲染），可升级为返回可判定的「适用性」弱信号（如跨 operator/主题命中标注） | 低 |
| **真实 E2E（用户跑）** | `npm run qa:e2e` 需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN（真实 JS 入口）+ 模型余额；本轮已诊断「profile 缺失已装 + OOM 已降 4G + cause 日志」，留用户跑 | 高（发布前） |
| **Obsidian 本机部署验收** | `deploy-local` 后用户在 Obsidian reload + 命令「在 dsh web 打开记忆面板」实测打开 3080 面板 | 高（发布前） |
| **dsh session 路径编码 mojibake** | 非 ASCII workspace 路径下 session 目录编码分裂（正确 vs 乱码并存），影响跨工作区 dialogue index；已知未修 | 中 |
| **vault 里 `strategy/strat-ot-structure-proof.md` 的两行游离 `uses: 0`** | ✅ 已于 2026-09-10 清理（用户批准，最小 diff 只删这两行）。它是"写入器曾把字段写到 frontmatter 之外"的物证，`summaryOf` 的记账行过滤仍然保留作为同类脏数据的兜底 | 完成 |
| **1.0 之前缺的东西（README 已写明的定位缺口）** | ① 理解状态与卡点（现在只记"问过什么/结论是什么"）；② **技巧的调用体系**（何时用哪条、适用边界怎么判、失败后换哪条、几条如何组合）——现在只有存储与检索；③ 主动教学闭环（诊断→提示→检验→复盘的长期档案）；④ 复习调度（间隔重复）。这四项才是 1.0 的定义 | 高（方向） |
| **反馈无 hook 块自动补块** | ✅ 已实现（0.7.5）：`ensureHookBlock` 自动补最小 `hook:` 块，两个面板的 ✅/❌ 对所有卡可用；行内 flow 写法明确拒绝 | 完成 |
| **Obsidian 插件自动化测试** | ✅ 已修（2026-09-11，第七轮）：`MemoryView` 的四个**纯**决策方法（`layerEntries` / `pendingItems` / `cardMeta` / `trendText`）已由 `scripts/test-panel-present.mjs` 覆盖（20 项，从 `main.template.js` 源码文本提取求值，接缝挪走即报错）；**测试当场抓到一个真实缺陷**（可选字段的 `!== ''` 守卫让 `undefined` 漏过去，渲染出 `上次 undefined`）。**仍未覆盖**：DOM 调用（`createDiv`/`createEl`）、Obsidian API 交互、`DshWebProxy` / `DshService` / 设置页。要覆盖那些需要假 Obsidian + DOM stub（或把逻辑继续往纯函数上搬） | 完成（余下见说明） |
| **可维护性审查落地（docs/maintainability-review-2026-09-11.md）** | ✅ 已修（**五轮**）：① 面板未配置约束根 → 拒绝（P0-0，变异验证）；② 仓库根 `AGENTS.md` + 模板源改名 `vault-AGENTS.md` 消除自动注入（P0-1）；③ 验证链可信化——`run-node.mjs`（fd 捕获）+ `run-gates.mjs`（全跑汇总）+ doc-consistency 三态 + 计数自数（P0-2）；④ 双份实现守卫 `check-engine-sync.mjs`（**22** 个共享符号：16 同步 / 6 条有记录的偏离）（P0-3）；⑤ `client.js` 新鲜度门禁（P1-4）；⑥ 文档事实修正（capture-policy 默认关、strategy-layer 状态、版本横幅）（P1-1/P1-2）；⑦ 探针环境变量优先级与产品对齐（P1-8）；⑧ 嵌入清单完备性门禁 + `main.js` 本地新鲜度门禁（P2-10）；⑨ 面板路由补测（P2-9，44 → 现 **47** 项）；⑩ `AUDIT_SCHEMA_VERSION` 读侧真正生效（P2-5）+ 捕获路径三处静默失败改为 `warnings`（P2-7）+ 死代码删除 + `pathInside` 两引擎同名（P2-6 第一项）；⑪ frontmatter 边界规则单一化 + 行为等价门禁（P1-6）；⑫ 全仓文档漂移排查（产品名 `dsh web ui` → `dsh web`、遗留 `pathIsInside`、错误的 Phase 4 横幅、过期的适配状态）+ `check-rename.mjs` 第二条改名守卫（P2-4）；⑬ `CHANGELOG.md` 的 `[0.7.5]` 节重编（只留「修了什么/改了什么」，排查叙述移入 `docs/changelog.md`）；⑭ 环境变量单一参考 `docs/env-vars.md` + 双向守卫 `check-env-vars.mjs`（P2-8）；⑮ 发布面钉住 + 本机路径扫描 `check-release-paths.mjs`（P2-2，先证伪"值不值得修"再设防）；⑯ 反馈 token 半途改名的收尾（两侧同序 + 插件双注入 + 3 项回归）；⑰ 用户可见面的示例 vault 路径（P2-2 的第二半）、语义常量锚到代码（P2-1）、基准验收声明对齐证据（P2-11）；⑱ 呈现层首次有自动化测试（P1-3，且当场抓到 `上次 undefined`）。门禁 **33/33**。台账见 `docs/maintainability-fixes-2026-09-11.md` | 完成（余项见下） |
| **frontmatter 六个各自为政的解析器（P1-6）** | ✅ 已修（2026-09-11）：那个划边界的正则原本复制 **15 处**（`math-memory.mjs` 12 / `memory-admin.mjs` 1 / `note-tools.mjs` 2），现全部归零，规则收进 `dsh/preset/hook-frontmatter.mjs`。宿主树**不能** import 它（插件用 `new Function` 注入绑定），故保留一份拷贝并由新门禁 `check-frontmatter-source.mjs` 做**行为等价**校验（13 fixture）；另把「hook 解析器在插件里还能用吗」补进 `check-embedded-loader.mjs`（此前零覆盖）。`npm test` **29/29** | 完成 |
| **host 与 preset 的 `frontmatterSpan` 仍是两份** | 上一条的**有意**残留：`memory-admin.mjs` 那份因 loader 注入契约而无法删除。现在有行为等价门禁兜着，**不是**待修的缺口；若要合并成一份，得先改 `main.template.js` 的注入清单与 `check-embedded-loader.mjs`，收益（少 8 行）小于风险 | 不做（已记录） |
| **反馈 token 的改名** | ✅ 已完成（2026-09-11，第五轮）：原先 preset 读「新 ?? 旧」而面板**只读旧名** ⇒ 无论插件注入哪个名字，总有一侧看不见它。现在**两侧读同一对、同一顺序**，且 **Obsidian 插件同时注入两个名字**（插件与 npm 包可分别升级，只发新名会打断旧消费者）。回归新增 3 项（新名单独生效 / 只设新名时被强制 / **两个都设时新名优先**，`test-panel-routes.mjs` §4b）；**变异验证**：把面板改回只读旧名 → 2 项失败并报 `{"newName":403,"oldName":200}`（顺序被反转，正是要防的形态）。注：3 项里有 1 项（"新名单独被接受"）在旧代码下也通过，**不承重**，承重的是另外两项 | 完成 |
| **环境变量参考（P2-8）** | ✅ 已修（2026-09-11）：新增 `docs/env-vars.md`（**11 个 `DSH_*`** + 4 个平台/开发变量的唯一参考，含三对别名的优先级、死开关、已知缺口）+ `scripts/check-env-vars.mjs`（第 **30** 个门禁，**双向**核对，含"死开关不得被读"的反向规则；三项变异验证）。清单由脚本**从代码提取**，不凭记忆 | 完成 |
| **历史档案里的旧名与旧状态** | **刻意不追改**（改了会毁掉"当时是什么样"的证据）：已发布的 CHANGELOG 段落、`maintainability-review-*` / `project-assessment-*`（日期化审计）、已退役的 `docs/archive/REFACTOR-PLAN.md` 正文、`docs/dsh-panel-research.md` 正文（已加日期化更正块）、`docs/changelog.md` 的历史条目。`check-rename.mjs` 用「路径 + 理由」白名单豁免它们——**要改历史记录，得先写下理由** | 不做（设计如此） |
| **`scripts/qa/benchmark-vault/` 停在旧状态**（含「试做型 0.6.x」与旧包名） | **刻意不顺手改**：它是**冻结的基准语料**（整座合成 vault，`npm run qa` 的引擎探针与 benchmark 都跑它），改文字会改变基准所测的东西。守卫按**目录前缀**豁免。正确做法是**一次有意的刷新**（连带更新 `scripts/qa/runs/*/baseline.json`），不是搭便车改 | 不做（需专门评估） |
| **发布物里的本机路径（P2-2）** | ✅ 已修（2026-09-11）：先**证伪**——npm 只发 `dsh/` + 3 个根文件，Release 只附 Obsidian 三件，唯一的硬编码本机路径在 gitignore 的 `scripts/deploy-local.mjs`，**报告描述的泄漏在当前树上不可达**。但"可达"只靠两个清单没人改，故新增 `scripts/check-release-paths.mjs`（第 **31** 个门禁）：**发布集 pin 住**（改 `package.json` 的 `files` 必须改守卫并写理由）+ **发布面扫描**本机标识与通用绝对路径。三项变异验证。同处把 `main.template.js` 里一句像真路径的注释示例改成中性写法 | 完成 |
| **`baseline.json` 是死产物，去留待定** | `e2e.mjs` 会写 `scripts/qa/runs/*/baseline.json`（已提交 3 份），但**没有任何代码读它** ⇒ `testing.md` 的「CI 可比对基线」是目标而非现状。两条路：① **让守卫真的消费它**（比对阈值 / 回归门禁，需要先定义"退步"的判据）；② **移出 git**（当作本机运行产物）。在此之前不要在文档里声称"可比对"。已提交的证据不删，等决定 | 中 |
| **自指式期望与脆弱断言（审查 P3）** | ① `test-memory.mjs` 断言 `navSection.length <= MAX_TOTAL_MEMORY_CHARS`，而该常量**从被测模块 import**；另一处断言模块自己的 `HOOK_SCHEMA_VERSION > 0`——**改大常量即可让断言永远成立**。② 47 处 `includes('中文文案')` 断言（改文案即红，属维护成本而非缺陷）。③ 无锚点魔法数（`posture.length === 9`、`r.files === 5`、反代 31）。修法方向：自指项改成**独立推导的期望值**（或把常量从夹具注入）；魔法数改成**从清单/代码推出**。同族坑 68 | 低 |
| **`engine-probe.mjs` 的 ground truth 绑定私有 vault** | 期望路径指向维护者的真实 vault（`数学/Picard-Banach定理.md` 等），与 `testing.md` 声称的"合成夹具探针"不符 ⇒ 真实语料上的排序结论在别的机器与 CI 上**不可复现**。修法需要一次"夹具化 ground truth"的设计（把真实用例抽象成合成 vault 里的等价语料），并保留现有真实 vault 探针作为本机验收 | 中 |
| **记忆引擎去重（P0-3 的目标态）** | `dsh/preset/math-memory.mjs` 与 `dsh/host/memory-admin.mjs` 仍有 22 个同名符号、其中 6 个已实质偏离（`check-engine-sync.mjs` 已逐条登记理由）。彻底做法是把共享引擎抽成一个模块、两边各自薄封装——现在至少有守卫，不会再静默漂移 | 中 |
| **大函数拆分** | `buildAuditReport`(582 行) / `MemoryView`(537) / `apply`(471) / `DshWebProxy`(387) / `DshObsidianSettingTab`(298)（审查报告 P1-5） | 低 |
| **可溯源（source 链 + 引用次数）** | `control-panel.md` §2.3 要求的「每条记忆显示 source 证据链与引用次数」**仍未交付**：`collectMemoryState` 至今不解析 `source`，两个面板都没有 | 中 |
| **发布 0.7.5（推 tag）** | 版本号已对齐、守卫已就位、`docs/release.md` 已写；**推 tag 需要用户口令**，推完才会产出 Release 与 npm 包 | 高（发布前） |
| **persona / AGENTS.md 语义解耦** | persona 仍自称「Obsidian …」，改「工作区」措辞（语义改动，需拍板） | 中 |
| **侧栏性能：宿主侧已量（原"空白"已补）** | ✅ 2026-09-11 用 `scripts/qa/sidebar-attach-probe.mjs`（附着到真实 Obsidian：`--remote-debugging-port`，**只读**观察用户手动点击）测出结论：**同一 90 秒内宿主 0 帧 >33ms、最差 18 ms、LoAF 0、`RecalcStyle` 0.067 s；iframe 63 帧 >33ms、最差 2183 ms、`RecalcStyle` 22.76 s（410 次）**。⇒ 卡顿全在 dsh 侧，主成本是**布局/重算**（13 102 元素文档上 55 ms/次），不是脚本空转；原因 3/4 属廉价保险。**剩余唯一 A/B**：关掉「侧栏加载皮肤动态装饰」复测，以分离皮肤脚本与上游布局的贡献（见 `sidebar-performance.md` §0.2/§9） | 中（A/B 待做） |
| **命名空间隔离** | `.deepseek` → 可配置 `memoryRoot`（多套记忆共存时再做，需迁移） | 低（延后） |
| **（可选）3180 内嵌面板** | 方案 A 已决策**不做**（保持 3180 fail-closed）；如需再议 | 低 |
| **端口：多 vault 抢占 + 占用无回退** | 研究结论见 `docs/port-and-isolation.md`（2026-09-11，**只研究、未改代码**）：独立 authority 是**结构必要**的（`--profile` 单值 ⇒ 两个进程 ⇒ 两个端点），但固定 3180 **不必要**，且它是当前**唯一由端口引发的干扰**——设置存在 vault 内、默认值相同，第二个 vault 预检到占用即**抛错**（`main.template.js:1056-1059`，无回退，提示还写作"其他服务"）。建议：保留 3180 为首选 + 占用时回退到 OS 分配并显示**实际地址**；实现注意 `resolveAuth` 的 `proxy.port !== wanted` 判断（`wanted=0` 会每 300 ms 重绑并作废已兑换的 cookie）。**不做**：同端口路径路由 / 另一个回环地址 / 复用 3080 那台 | 中 |
| **侧栏性能：两项未量到的原因** | ① 同机 3080 的 `dsh web` 持续吃 ~15% 单核（与本插件无关，但会放大动画抖动）；② iframe 内 dsh UI 的 DOM 规模（长会话）。量法与 A/B 复核步骤见 `docs/memory/sidebar-performance.md` §4/§6 | 中 |
| **★ 运行卡顿（已存档，用户决定之后再解决）** | 真因已测出：皮肤 `orca-link` 的客户端脚本 `hooks.mjs`（14 个 MutationObserver + 5 次/秒的角色样式循环 + 跟着侧栏动画每帧触发的 ResizeObserver）。已交付两档修复（性能模式改写两处热循环；可关皮肤装饰）。**未解决的三件**：① 3080 不走我们的代理，同一份脚本仍在跑——换皮肤 / 关皮肤 / 给皮肤文件打同样补丁（需备份、皮肤更新会覆盖）/ 上报作者，等用户选；② dsh 前端自身每次点击仍有 ~110ms 样式重算（侧栏宽度是 CSS grid 轨道），插件无法从外部修，需要时可拿探针输出做最小复现；③ 用户真机（长会话 + 完整插件家族）实测数字未取。**复现工具已入库**：`node scripts/qa/sidebar-perf-probe.mjs --vault=<vault> [--via-proxy] [--mutations]`；结论与判读约定见 `docs/memory/sidebar-performance.md`（§9 是接续入口） | **下次接着做** |
| **检索：关系信任 + 锚点槽位** | GraphMemix 的「查询条件化关系信任」需要 `related`/`source` 边带可信度（可用 `verified_by`/`harmed` 当先验）；触发条件写在 `retrieval-v3.md` §7.4 | 低（有触发条件） |
| **多视图 max-pool 复测** | 本轮实测 Δ=0 且排名变差，保持单袋默认；出现「标题精确命中却排在 5 名之后」的真实稀释案例时，先补 ground-truth 用例再复测（`retrieval-v3.md` §7.2） | 低（有触发条件） |
| **（可选）settings.section i18n** | `label` 已可用；若需多语言再补 | 低 |

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。
