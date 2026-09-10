# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、决策、已修坑、未做事项与工作约定。
> 最后更新：2026-08 大改收尾——仓库文档大改 + 文献库子系统 + 记忆系统强化（两轮）+ Phase 1 解耦 + Phase 2a/2b dsh web 面板 + 面板方案 A（两实例）。**版本 0.7.2**（记忆纠错与确定性自维护落地，见 `self-correction.md`；上一版 0.7.1 = 2026-08-26）。0.7.1 新增 **dsh-native 分发重构**（bundle + `dsh plugin add` 原生安装、`--direct` 离线拷贝、owner marker 冲突解决、对称 `uninstall`；功能无变化，仅优化安装方式），详见 `docs/dsh-native-refactor.md` 与 `docs/installation.md`。

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
| `dsh/profile/` | **profile `notes-assistant`**：fail-closed 沙箱（workspace-write + approval never）；**默认不挂载 dsh-web-ui 插件**（皮肤中心可经 Obsidian 设置开关启用） |
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
| `scripts/test-memory.mjs` | 零 token 记忆回归（232 项断言，进 `npm test`） |
| `scripts/test-panel-routes.mjs` | `/memory-panel` 路由信任边界回归（30 项断言：跨源拒绝、root 锚定、token、字段校验；进 `npm test`） |
| `scripts/test-panel-proxy.mjs` | 侧栏反代回归（31 项：权威 cookie、Host 保真、401 透传、升级转发、接线断言 + 11 项侧栏性能注入/皮肤脚本改写回归） |
| `scripts/test-panel-auth.mjs` | 侧栏握手端到端（7 项，对真实 dsh；未装 dsh 时 SKIP） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测 |
| `scripts/check-doc-consistency.mjs` | 文档一致性守卫（断言数等数字与代码实测对齐，进 `npm test`） |
| `scripts/check-rename.mjs` / `check-skin-fallback.mjs` / `check-plugin-id.mjs` | 三个守卫（见 §4 坑） |
| `scripts/qa/` | engine-probe（12 组 ground-truth + §2 可达性分层/池化 A/B）+ e2e（真实 token 会话，`npm run qa:e2e`） |
| `scripts/deploy-local.mjs` | 本机一键部署（gitignored，含本机路径；用 copyFileSync 手动遍历，勿用 cpSync） |

## 3. 当前状态（2026-08 大改收尾后）

> **增量（本会话）**：文献库入库 MemTrapBench（第 15 篇，已蒸馏），并落地「记忆适用性（防记忆陷阱，AdaptiveMem 本土化）」——AGENTS.md §5 四风险 + 决策流程、`math-memory.mjs` 每轮注入适用性纪律、`note_recall` 适用性提示、`inapplicable` 反馈动作（不降成功率）、`lit-import.mjs` 改增量合并（修全量覆盖 bug）、`docs/literature.md` 补「新增单篇文献 SOP」。回归 83→90。皮肤中心加固：`skinCenterMountable` 收紧为检查两个具体皮肤包，degrade 皮肤禁用块改为运行时读取 `$DSH_HOME/cordis.patch.yml` 动态生成（去硬编码 11 id）。又入库并蒸馏 4 篇检索对齐文献（Dual RAG / QueryLink / HyPE / MemSearcher，共 19 篇、19 篇已蒸馏），综合改进见 `literature/notes/retrieval-alignment-2026-08.md`。**策略层已实现**（`strategy-layer.md` 落地）：strategy 模板 + `note_strategy` 工具 + `working.md` 注入 + AGENTS.md 策略层路由/iterative retrieval；回归 +5（strategy 解析/classify/working 注入）。**记忆纠错与确定性自维护已实现（0.7.2）**：`docs/memory/self-correction.md` P1–P5 全部落地——P1 纠错进检索三件套（superseded/duplicate_of 排除 / wrong 降 verified+封顶 0.35 / hookPrior 权重 0.15）、P2 待重审清单、P3 低效用卡自动归档（默认 off）、P4 duplicate_of 标记、P5 strategy 统一生命周期；回归 90→104，`main.js` 已重建。**自动保存对话已实现（0.7.3）**：`docs/memory/obelisk-comparison.md` §5 落地——整场对话（不含思考）确定性写进 episodes（尾截断 + seq 增量续接 + vault 过滤 + `sessionCapture` 当时默认开；**0.7.5 起改为默认关**——见 §5 决策记录），`distillSession` 加 seq/createdAt/clip 参数，`runSessionCapture` + marker；回归 104→118。双面板 UI（Obsidian 记忆面板 + dsh web 记忆面板的「自动保存对话」开关、「立即保存对话」按钮、「N 个未保存」角标）也已落地，`main.js` 与 `lib/client.js` 重建。

**本轮改动总账（按阶段）**：

1. **仓库文档大改**：测试断言数全仓统一（README 中英 / ARCHITECTURE / docs-memory-README / handoff）；README 双语旧身份 `obsidian`→`notes-assistant`；env 旧名改新名（`DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`）；`REFACTOR-PLAN.md` 退役、根 `TESTING.md` 并入 `docs/memory/testing.md`；新增 `scripts/check-doc-consistency.mjs` 一致性守卫。
2. **文献库子系统**：`literature/` 双面文献库 + `scripts/lit-import.mjs` + `docs/literature.md`；14 篇论文全部导入，产出 14 张卡 + 14 条精读记录 + `notes/memory-system-review.md`（14 篇综合、优先级建议）。
3. **记忆系统强化（两轮）**：`hookPrior` promote/demote（verified/success_rate/uses 0.45/0.25/0.20 + recency 0.10，90 天线性衰减）；每日体检新增反模式、热度归档候选（heat 0.5/0.3/0.2）、被动召回信号（空结果率）；records 模板加 `confidence` 与「可修订记录」；templates/profile/AGENTS.md 补定理表聚合、条件演化门、写卡去重、自动链接、Refine 步、检索粒度纪律；回归 75→82。
4. **Phase 1 解耦（host-agnostic core）**：把 Obsidian 插件里的确定性记忆操作抽成 `dsh/host/memory-admin.mjs`（纯 node:fs/path）；`build-obsidian.mjs` 嵌入 + 插件 `MEMORY_ADMIN` loader；插件本地副本改别名；`npm test` 增 `node --check dsh/host/*.mjs`。
5. **Phase 2a（宿主面板路由）**：`dsh/host/math-memory-panel.mjs` 挂 `/memory-panel/*`（loopback-only + pathInside 门控，复用 memory-admin）；boot 冒烟 `GET /memory-panel/state` 返回 `{ok:true}`。
6. **Phase 2b（客户端面板）**：`dsh/client-panel/` React 面板（工作区下拉 + 手动 root + localStorage），esbuild 打包，装在主 dsh web Settings（`settings.section` 槽位，显示名「记忆面板」）；实测可用。
7. **面板方案 A（两实例）**：主 dsh web `3080`（`web` profile，编程 + 记忆面板）、notes dsh web `3180`（`notes-assistant` profile，Obsidian 聊天，fail-closed、不挂 `@linxin666`）。Obsidian 插件新增命令「在 dsh web 打开记忆面板」+ 设置 `memoryPanelUrl`（默认 `http://127.0.0.1:3080/`，`electron.shell.openExternal`）。

**身份解耦（早前 Phase 2，已稳定）**：文件更名 `obsidian-*`→`math-memory`/`note-tools`/`math-memory-workspace`；npm 包 `dsh-obsidian-math`→`dsh-math-memory`；profile/preset id `obsidian`→`notes-assistant`；权限预设 `obsidian-locked`→`math-memory-locked`；env 别名 `DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`（旧名兼容）。**单仓**（不拆双 git 仓库）。

**开关与共存 / 独立设置面板**：总开关 `enabled` + 粒度开关 `dialogueIndex`/`reminders`/`audit`；独立设置面板 = 工作区级 `.deepseek/config.md`（host-agnostic 配置文件）；**皮肤中心改为可选**（默认不挂载；Obsidian 设置「启用皮肤中心」开关把 `ui-skin-center` + `ui-web-ui-settings` 追加到 `notes-assistant.patch.yml`，需 web profile 镜像 `@linxin666` 包）。

**QA 状态**：`npm test` **232/232 全绿**（另含路由 30 / 侧栏握手 7 / 反代 31）；合成 vault 引擎探针 12/12；**真实 vault 探针 12/12**（导航索引降权后恢复满格，未改任何 ground truth；另输出可达性分层与池化 A/B）；真实 token 会话 E2E（`npm run qa:e2e`）**留待用户本机跑**（需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN 真实 JS 入口 + 模型余额）。侧栏交互性能探针（`scripts/qa/sidebar-perf-probe.mjs`）按需运行，不进 CI。

**宿主适配（2026-09-10，dsh 0.1.5-rc.1 + dsh-web-all 0.3.20）**：完整取证与清单见 [`docs/dsh-0.1.5-adaptation.md`](../dsh-0.1.5-adaptation.md)。结论：解码与蒸馏路径**无需改动**（V3 仍是多帧无字典 zstd，事件名与 `source.kind==="user"` 判据不变）；profile patch / preset / `settings.section` 槽位在 0.1.5 下全部实测有效（boot 冒烟 + `/memory-panel/*` 均 200）。唯一真实缺陷是 **V3 迁移会为同一会话保留 V2 原件**，于是"一个会话两份都以 `.jsonl.zstd` 结尾的日志"成为长期状态；已按会话去重（**显式优先 `.v3.` 变体**，因为两者 mtime 可能同刻）修复，`findSessionLogs` 在切片前完成折叠，preset 与 host 两份副本同步。回归 126→138，`main.js` 已重建并已 `deploy-local` 到本机 vault / `$DSH_HOME`。

**安全修复（2026-09-10，评估 P0 三连 + 三个小修）**：完整评估与优先级队列见 [`docs/project-assessment-2026-09-10.md`](../project-assessment-2026-09-10.md)。本轮修掉：① `/memory-panel/*` 无鉴权 + 约束根由调用方指定（→ root 锚定 + Origin 校验 + 可选 token）；② `archiveMemoryFile` 零校验（→ 只收 `.deepseek/<层>/*.md` 常规文件，且校验通过才建归档目录）；③ frontmatter 写入的 `$` 替换模板展开与空块偏移 0 插入（→ `frontmatterSpan` + `replaceFrontmatter` 按偏移拼接）；④ `install-into-profile.mjs` 在所有随仓库发布的 patch 上静默 no-op（→ 追加式 insert + 写后断言）；⑤ LinkServer 二次解码导致链接挂起（→ 删二次解码 + handler 包 try/catch）；⑥ `/memory-panel/workspaces` 因 root 门禁永远 400（→ 分支前移）；⑦ capture-policy 的 `field` 未校验（→ 白名单 + mode 白名单）。回归 **165 + 路由回归 25**（现为 191 + 28）；新增 `scripts/test-panel-routes.mjs`、`scripts/check-embedded-writers.mjs`；`check-doc-consistency.mjs` 改为读**运行期** `__CHECKS__`。`main.js` 已重建、`deploy-local` 已执行、live 验收 9/9（含"被拒的归档不留空目录"）。

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
6. **notes profile 默认不挂载 dsh-web-ui 插件**——皮肤中心（`ui-skin-center`/`ui-web-ui-settings`）是可选的，由 Obsidian 设置「启用皮肤中心」在运行时追加进 `notes-assistant.patch.yml`（仅在存在 web profile 可镜像时）。若有人把 `@linxin666` 挂载加回 `cordis.patch.yml` 会 boot 崩（`check-skin-fallback` 会拦：挂载必须在降级块里被禁用；`cordis.patch.yml` 当前是 0 挂载）。
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
58. **`npm publish` 失败时日志什么也不说**：0.7.5 的 Release 与 npm 是两条独立流水线——Release 成功（GitHub Release + 4 个资产），npm 那条在 `Publish` 步失败（前 6 步全过）。`npm publish` 对"token 缺失/过期/无发布权/需要 2FA"一律只有非零退出码，光看日志无法区分。因此 `npm-publish.yml` 现在在 publish **之前**加一步 `npm whoami`（`|| true`，不改变成败），把答案留在日志里。**刷新 `NPM_TOKEN` 是用户侧动作**（npm → Access Tokens → Granular，勾 publish 权限与 bypass 2FA），改完可以直接在 Actions 页面 re-run 那条 workflow。

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
npm test                        # 232 项零 token 回归 + 30 项路由回归 + 7 项认证 + 31 项反代 + 安装器 e2e + 漂移 + 三守卫 + 文档一致性 + 语法检查
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
| **自动保存对话（obelisk-comparison.md）** | ✅ 已实现（0.7.3）：整场对话（不含思考）确定性写进 episodes（尾截断 + seq 增量续接 + vault 过滤 + `sessionCapture` 当时默认开；**0.7.5 起改为默认关**——见 §5 决策记录）+ 双面板「自动保存对话」开关 /「立即保存对话」按钮 /「N 个未保存」角标 | 完成 |
| **策略层（方法层 + 工作记忆 + iterative retrieval）** | ✅ 已实现（`strategy-layer.md`：strategy 模板 + note_strategy + working.md 注入 + AGENTS.md 路由） | 完成 |
| **基准测试（benchmark.md）** | ✅ 已实现并实测（8/8，deepseek-v4-flash）：仿真 vault + seed-probe（8/8）+ benchmark-cases（8 维度）+ baseline.json + session log 归档；基线在 `scripts/qa/runs/run-*/` | 完成 |
| **3 类陷阱压力样例进引擎探针** | 造 Cognitive Bias / Task Boundary / Trauma 的数学版 ground-truth 进 `scripts/qa/engine-probe.mjs`（需绑定真实 vault，vault 内容变化时同步维护） | 中 |
| **「记忆诱发退化」被动信号** | 有/无记忆对照的答案质量（LLM-judge 打分）作为体检的「固定/扭曲」健康指标（需接 judge，可选增强） | 低 |
| **note_recall 结构化适用性字段** | 现为 prompt 提醒（描述 + 渲染），可升级为返回可判定的「适用性」弱信号（如跨 operator/主题命中标注） | 低 |
| **真实 E2E（用户跑）** | `npm run qa:e2e` 需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN（真实 JS 入口）+ 模型余额；本轮已诊断「profile 缺失已装 + OOM 已降 4G + cause 日志」，留用户跑 | 高（发布前） |
| **Obsidian 本机部署验收** | `deploy-local` 后用户在 Obsidian reload + 命令「在 dsh web 打开记忆面板」实测打开 3080 面板 | 高（发布前） |
| **dsh session 路径编码 mojibake** | 非 ASCII workspace 路径下 session 目录编码分裂（正确 vs 乱码并存），影响跨工作区 dialogue index；已知未修 | 中 |
| **vault 里 `strategy/strat-ot-structure-proof.md` 的两行游离 `uses: 0`** | ✅ 已于 2026-09-10 清理（用户批准，最小 diff 只删这两行）。它是"写入器曾把字段写到 frontmatter 之外"的物证，`summaryOf` 的记账行过滤仍然保留作为同类脏数据的兜底 | 完成 |
| **1.0 之前缺的东西（README 已写明的定位缺口）** | ① 理解状态与卡点（现在只记"问过什么/结论是什么"）；② **技巧的调用体系**（何时用哪条、适用边界怎么判、失败后换哪条、几条如何组合）——现在只有存储与检索；③ 主动教学闭环（诊断→提示→检验→复盘的长期档案）；④ 复习调度（间隔重复）。这四项才是 1.0 的定义 | 高（方向） |
| **反馈无 hook 块自动补块** | ✅ 已实现（0.7.5）：`ensureHookBlock` 自动补最小 `hook:` 块，两个面板的 ✅/❌ 对所有卡可用；行内 flow 写法明确拒绝 | 完成 |
| **Obsidian 插件自动化测试** | 面板呈现层仍无自动化测试（`main.template.js` 的反馈/面板/归档/捕获策略逻辑靠手测）；**数据层已有 15 项**（`scripts/test-memory.mjs` §30 覆盖 `collectMemoryState`/`parseEpisodeIndex`/`applyFeedback`），呈现层可用同样的方式补 | 中 |
| **可溯源（source 链 + 引用次数）** | `control-panel.md` §2.3 要求的「每条记忆显示 source 证据链与引用次数」**仍未交付**：`collectMemoryState` 至今不解析 `source`，两个面板都没有 | 中 |
| **发布 0.7.5（推 tag）** | 版本号已对齐、守卫已就位、`docs/release.md` 已写；**推 tag 需要用户口令**，推完才会产出 Release 与 npm 包 | 高（发布前） |
| **persona / AGENTS.md 语义解耦** | persona 仍自称「Obsidian …」，改「工作区」措辞（语义改动，需拍板） | 中 |
| **Obsidian 插件自动化测试** | `main.template.js` 的反馈/面板/归档/捕获策略逻辑零自动化测试，全靠手测 | 中 |
| **命名空间隔离** | `.deepseek` → 可配置 `memoryRoot`（多套记忆共存时再做，需迁移） | 低（延后） |
| **（可选）3180 内嵌面板** | 方案 A 已决策**不做**（保持 3180 fail-closed）；如需再议 | 低 |
| **侧栏性能：两项未量到的原因** | ① 同机 3080 的 `dsh web` 持续吃 ~15% 单核（与本插件无关，但会放大动画抖动）；② iframe 内 dsh UI 的 DOM 规模（长会话）。量法与 A/B 复核步骤见 `docs/memory/sidebar-performance.md` §4 | 中 |
| **★ 运行卡顿（已存档，用户决定之后再解决）** | 真因已测出：皮肤 `orca-link` 的客户端脚本 `hooks.mjs`（14 个 MutationObserver + 5 次/秒的角色样式循环 + 跟着侧栏动画每帧触发的 ResizeObserver）。已交付两档修复（性能模式改写两处热循环；可关皮肤装饰）。**未解决的三件**：① 3080 不走我们的代理，同一份脚本仍在跑——换皮肤 / 关皮肤 / 给皮肤文件打同样补丁（需备份、皮肤更新会覆盖）/ 上报作者，等用户选；② dsh 前端自身每次点击仍有 ~110ms 样式重算（侧栏宽度是 CSS grid 轨道），插件无法从外部修，需要时可拿探针输出做最小复现；③ 用户真机（长会话 + 完整插件家族）实测数字未取。**复现工具已入库**：`node scripts/qa/sidebar-perf-probe.mjs --vault=<vault> [--via-proxy] [--mutations]`；结论与判读约定见 `docs/memory/sidebar-performance.md`（§9 是接续入口） | **下次接着做** |
| **检索：关系信任 + 锚点槽位** | GraphMemix 的「查询条件化关系信任」需要 `related`/`source` 边带可信度（可用 `verified_by`/`harmed` 当先验）；触发条件写在 `retrieval-v3.md` §7.4 | 低（有触发条件） |
| **多视图 max-pool 复测** | 本轮实测 Δ=0 且排名变差，保持单袋默认；出现「标题精确命中却排在 5 名之后」的真实稀释案例时，先补 ground-truth 用例再复测（`retrieval-v3.md` §7.2） | 低（有触发条件） |
| **（可选）settings.section i18n** | `label` 已可用；若需多语言再补 | 低 |

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。
