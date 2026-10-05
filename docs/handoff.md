# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、决策、已修坑、未做事项与工作约定。
> 当前版本：0.8.1
> （本文件描述**当前**状态；它与 `package.json` 的一致性由 `check-version-consistency.mjs` 守卫）
>
> ⚠️ **"当前版本 0.8.0" = 仓库工作区的版本号。** 已发布的 **0.7.8 及更早**是 dsh 0.1.7 适配**之前**的形态（bundle 补丁里没有 preset 声明），装它之后**每次新建会话都会失败**——用户侧警告见 [`docs/installation.md`](installation.md) 的"0.7.8 及更早不要用"。**0.8.0（2026-09-27 发布）起已修**，本文件描述的修复都在其中。
> 最后更新：2026-09-27（0.8.0）——**离线安装也装成真正的包**（于是它出现在 dsh 的插件管理页里，并有自己的名字与图标）+ **安装器不再动你自己的配置**（`install --force` 此前会整份覆盖 profile 的 `cordis.patch.yml` 与 `package.json`，实测吃掉过真实的模型配置）+ 一批「静默失效」的修复（侧栏新建对话、会话记忆读旧格式日志、面板客户端半个装不上、回复里的记忆卡点不开、重载插件卡死端口）。**本次发布把 0.1.7 适配之前的所有修复第一次交付给用户**（0.7.8 及更早都装不上/建不了会话）。当前注册门禁 **54** 条、零 token 回归 **427** 项（引用计数以 `scripts/lib/gates.mjs` 与套件自报的 `__CHECKS__` 为准）。
> 更早：2026-09-18（0.7.8）——**治理闭环 + 记录纪律**：净增益 `gain`、有方向的依据链 `depends_on` 与失效级联、接地门、状态即权限、边界随否决收窄、`decision_guidance`；**体检台账**（`cache/audit-ledger.jsonl`，跨次判定史，"此前已在账"不再当作新问题）、**索引行说明下限**、**卡片尺寸上限**、**预算截断自报**、**破坏性写入原子化 + 失败进报告**、注入预算档位（含设置页入口）。**0.7.7 与它之间没有 Release**：0.7.8 装的是 0.7.7 之后 43 个提交的全部用户可见改动。门禁 38 → **41**，零 token 回归 240 → **376** 项。**⬅ 这两个数字是那一版的历史快照**：当前（2026-09-26 实测）注册门禁 **51** 条、零 token 回归 **427** 项。本节越往下越像"当下"，所以凡是要引用计数，**以 `scripts/lib/gates.mjs` 与套件自报的 `__CHECKS__` 为准**，不要从这一段的叙述里抄。
> 更早：2026-09-15（0.7.7）——用户实测的三处缺陷：**工具返回值不合 schema**（dsh 对成功返回值也严格校验 + `additionalProperties: false`，坑 75）、**`note_recall` 遇到边界卡直接抛异常**（`entry.doc.X` 形状错误，零覆盖分支，坑 76）、**链接跳转的端口/令牌不稳定 + 点链接弹外部网页**（`target="_blank"` 与跨源导航，坑 77）。门禁 35 → **38**。此前的 2026-09-14（0.7.6）：「新建会话」静默失效的根因与修复（agent preset 的 persona 字段 `text`→`prefix`，见坑 70）+ 卡顿随文档规模增长的实测（坑 71、`sidebar-performance.md` §0.3）。更早的 2026-08 大改收尾——仓库文档大改 + 文献库子系统 + 记忆系统强化（两轮）+ Phase 1 解耦 + Phase 2a/2b dsh web 面板 + 面板方案 A（两实例）。**0.7.2 时**（记忆纠错与确定性自维护落地，见 `self-correction.md`；上一版 0.7.1 = 2026-08-26）。0.7.1 新增 **dsh-native 分发重构**（bundle + `dsh plugin add` 原生安装、`--direct` 离线拷贝、owner marker 冲突解决、对称 `uninstall`；功能无变化，仅优化安装方式），详见 `docs/dsh-native-refactor.md` 与 `docs/installation.md`。

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
| `dsh/preset/note-tools.mjs` | 笔记工具：note_recall（含 tag-only 枚举）/note_strategy/note_create/note_links + BM25 + `resolveWorkspaceRoot` + `hookPrior`（`note_search` 2026-09-20 退役，见 `docs/memory/retrieval-v3.md` §5.1） |
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
| `docs/design-intake-2026-09-21.md` | **用户提问评估（2026-09-21）**：三个问题的取证与吸纳决策——拖拽引用（可行性 + 待实测项，**只登记未实施**）、记忆引用打不开（两处根因 + B组实施范围）、注入机制（实测数据 + 「不做 handoff 文档」的理由） |
| **`docs/drag-to-mention-progress-2026-09-25.md`** | **拖拽引用的接续入口（未完成）**：已修好并实测证实的缺陷（客户端半个从未被加载）、**已复现但尚未判定**的那一环（页面收到了投递、草稿却为空）、四个分层探针各自的量法与最近结果、自述诊断的日志格式、夹具坑、以及"探针会改用户持久状态"的教训。**接手拖拽这件事先读它。** |
| `obsidian/main.template.js` | Obsidian 插件源码：服务管理、LinkServer（/open + /feedback）、MemoryView 面板、全局皮肤 patch 兜底、bootstrap、**命令「在 dsh web 打开记忆面板」+ `memoryPanelUrl` 设置** |
| `scripts/build-obsidian.mjs` | 把模板 + dsh 文件嵌入 `main.js`（**改共享文件后必跑**） |
| `scripts/test-memory.mjs` | 零 token 记忆回归（455 项断言，进 `npm test`） |
| `scripts/test-panel-routes.mjs` | `/memory-panel` 路由信任边界回归（62 项断言：跨源拒绝、root 锚定（含**未配置**时拒绝调用方 root）、token、字段校验、写入型端点；进 `npm test`） |
| `scripts/test-panel-proxy.mjs` | 侧栏反代回归（32 项：权威 cookie、Host 保真、401 透传、升级转发、接线断言 + 11 项侧栏性能注入/皮肤脚本改写回归） |
| `scripts/test-panel-auth.mjs` | 侧栏握手端到端（8 项，对真实 dsh；未装 dsh 或环境不允许子进程写自身状态时 SKIP） |
| `scripts/test-panel-present.mjs` | **呈现层**纯净决策回归（提取 `MemoryView` 的 `layerEntries`/`pendingItems`/`cardMeta`/`trendText` 四个方法并求值；测真源码，接缝挪走即报错） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测 |
| `scripts/check-doc-consistency.mjs` | 文档一致性守卫（断言数等数字与代码实测对齐，进 `npm test`） |
| `scripts/check-rename.mjs` / `check-skin-fallback.mjs` / `check-plugin-id.mjs` | 三个守卫（见 §4 坑） |
| `scripts/qa/` | engine-probe（12 组 ground-truth + §2 可达性分层/池化 A/B）+ e2e（真实 token 会话，`npm run qa:e2e`）+ **按需探针**：`sidebar-*`（侧栏性能）、**`drag-payload-probe.mjs`**（隔离 Obsidian + CDP 拦真实拖拽载荷）、**`iframe-drop-probe.mjs`**（真跨源夹具测 iframe 内 drop 可达性） |
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

**QA 状态（2026-09-26 重测）**：`npm test`（= `node scripts/run-gates.mjs`）**51 条门禁注册、本机 49 ok / 2 SKIP / 0 FAIL**；记忆回归 **427/427**、路由 **62/62**、反代 **32/32**、呈现层 20/20。⚠️ **两条 SKIP 不是通过**——`test: panel auth e2e` 与 `test: agent preset mounts` 都因"本机没有已安装的 dsh + notes-assistant profile"而**一条都没比**（汇总会单独列出被跳过者与原因，见坑 98）。合成 vault 引擎探针 **8/8 PASS**（本轮实测，`npm run qa`）。**真实 vault 探针本轮 SKIP**（`engine-probe: 需要 DSH_WORKSPACE_ROOT 或 DSH_OBSIDIAN_VAULT`）⇒ 本节历史上写的"真实 vault 探针 12/12"**在本机无法复核**；§7 另记 2026-09-20 实测为 **11/12**（唯一红项是定理索引命中，已判为 vault 内容漂移）。**以「哪一次、在什么上跑」为准，不要引用一个不带日期的分数。** 真实 token 会话 E2E（`npm run qa:e2e`）**仍需用户本机跑**（要 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN 真实 JS 入口 + 模型余额）。侧栏交互性能探针（`scripts/qa/sidebar-perf-probe.mjs`）按需运行，不进 CI。

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

> 陷阱条数：115

**为什么这里要写一个数字**：别的文档（`AGENTS.md` §1/§6）要引用"这个仓库有多少条历史陷阱"。**手写的数字会腐烂**——它曾长期写着「69 条」而实际已到 81，读者无法判断该信哪一份。现在这个数字是**机器可读的单一事实源**：`scripts/check-trap-count.mjs` 从本节的编号里数出真值，比对这一行、以及其它引用它的文档；任一处对不上就红。**加一条陷阱 = 同时改这一行**（改完跑那条守卫即可知道自己漏没漏）。

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
19. **dsh ≥ 0.1.5：一个会话可能有多份日志**（每次格式升级都保留旧代原件）——V2 → V3 迁移生成 `session.v3.jsonl.zstd`、V3 → V4 生成 `session.v4.jsonl.zstd`，都**保留**原件，同目录长期共存；新会话只写最新一代，`version` 字段在头行（`0`/`2` = 旧，`3` = V3，`4` = V4）。⇒ 任何"扫 `$DSH_HOME/sessions`"的代码都必须**按会话去重并取最新世代**（`sessionLogKey` + `selectAuthoritativeLogs`：`artifactGeneration` 先比 `vN` 世代号，mtime 只作同代兜底），否则同一个会话会被计两次/索引两次，**或者（更隐蔽）一直读旧代导致新轮次永不落盘**——2026-09-25 实测本机 2 个会话目录 v3+v4 并存且 V4 更新，旧的"显式优先 `.v3.`"判据正是这样选错的（见 `docs/dsh-0.1.7-adaptation.md` §4.2）。旧版本文档里的 `findSessionLogs` 平铺夹具（`s1.jsonl.zstd`）也已改为真实 `<session-id>/session.jsonl.zstd` 目录布局。
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
36. **版本号不是发布**：Obsidian 的更新只认「**tag 等于 `manifest.json` 版本的 Release**」。当时 0.7.2–0.7.4 从未推过 tag ⇒ 用户端永远停在 0.7.1，表现为"商店里看不到新版本"。发版步骤见 `docs/release.md`；`check-version-consistency.mjs` 钉住五处版本号（package / manifest / lock / versions.json / CHANGELOG）。
    - **⚠️ 更正（2026-09-15）**：本条原文还写着「本插件**不在** `community-plugins.json` 里」并把它当作"看不到新版本"的原因之一。**那句是错的**——插件早已在架，收录方式已改变、`community-plugins.json` 不再是收录依据（详见坑 78）。"版本号不是发布"这个结论仍然成立，成立的理由只有 tag 那一条。
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
70. **★ 「按钮点了没反应」不一定是前端：`/api/session/create` 用 HTTP 200 回答失败，而 UI 只在控制台写一行 warning**（2026-09-14，真实故障：Obsidian 侧栏的「新建会话」永久失效）。
    - **表象**：侧栏界面正常渲染、能上网关、按钮可点、网络面板里**没有任何失败请求**、Obsidian 通知区**什么都不弹**。用户只知道"新建对话按钮没法新建对话了"。
    - **真因**：agent preset 挂载失败 —— `.agent-presets/notes-assistant/agent.cordis.yml` 的 persona 行写的是旧字段 `text:`，而 `@deepseek-ai/dsh-persona` ≥ 0.1.5-rc.1 的 Config 是 `prefix` **必填**：
      `agent-presets: preset "notes-assistant" failed to mount: failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid config: - $.prefix missing required value (at prefix)`
      preset 挂不了 ⇒ 每次建会话都失败。**这不是插件 UI、反代或按钮的缺陷，是"配置 schema 变了下游没跟"**。
    - **为什么难查**：① 接口是 RPC 风格，成功与业务失败都返回 **HTTP 200**，`ok:false` 在响应体里（`{"type":"server-response","result":{"ok":false,"error":{…}}}`），只看状态码/网络失败**永远看不到**；② 前端只 `console.warn('new session failed: …')`，不弹 toast；③ 反代按设计原样透传、日志里也没有异常。
    - **排查手法（可复用）**：headless Chromium + CDP 打开**真实** dsh（要经插件反代就经反代），点那个按钮，然后读 `Runtime.consoleAPICalled` 与 `Network.getResponseBody` —— 本次就是这样一次拿到完整错误链的（工具：`scripts/qa/sidebar-newchat-probe.mjs`）。
    - **守卫**：`scripts/test-agent-preset.mjs`（零 token）：① 静态断言仓库与**已安装** preset 的 persona 行都用 `prefix:`、都不含 `text:`；② 真的用已安装的 dsh 建一个会话，断言 `ok:true` 且错误里没有 `failed to mount`。**变异验证**：把已安装 preset 改回 `text:` → 套件 5/9 红并打印上面那条原始错误；改回 `prefix` → 9/9 绿。
    - **推论（重要）**：`bootstrapDshConfig` 对 `agent.cordis.yml` / `cordis.patch.yml` 用 `force=false`（保护用户手改），所以 **dsh 升级后 preset 不会自动跟上新 schema**。dsh 每次升级都要问一句："我这份 preset 的字段还是当前 schema 吗？"——本次正是 9/10 升级 dsh 到 0.1.5-rc.1 后遗留的**静默**失效。
71. **★ 侧栏卡顿随"当前会话的渲染树规模"增长——这是"刚启动不卡、用久了才卡"的第一解释**（2026-09-14 实测，同轮同一 harness）：
    | 文档元素数 | 每次样式重算 | 帧 >50ms | 最差帧 | LoAF |
    |---|---|---|---|---|
    | 730（空会话 hero） | **1.2 ms/op** | 0–1 | 50–67 ms | 1–3 |
    | 12 731（注入占位行模拟长会话） | **19.9 ms/op**（16.6×） | **52** | **533 ms** | 54 |
    对照 2026-09-11 在**真实 Obsidian** 里的读数：13 102 元素时 410 次重算共 **22.76 s = 55 ms/op**（比注入的纯 div 还贵，因为真实会话节点带着自己的样式与合成层）。三条推论：① 卡顿的主成本是 **RecalcStyle/布局**，与 dsh 前端把侧栏宽度做成 CSS grid 轨道有关（上游）；② 插件侧能做的只有"别让这份文档继续长大"（皮肤脚本减速/停用已做，见 §0 原因 1）；③ 所以"重开会话 / 少留超长会话"是当前**唯一用户可用的缓解手段**。
    - **为什么"关掉其他程序后没有马上恢复"**：内存压力只是放大器，不是主因。关掉程序后 ① Windows 回收工作集/页文件是滞后的；② 那个已经很大的文档仍在同一个渲染进程里，重算成本不会因为别的程序退出而下降——**要恢复得让 dsh 侧那份文档变小（切换/重开会话、重载面板、重启 Obsidian）**。用户在"关掉其他程序 + 重启 Obsidian"之后连续 2 小时流畅，正是因为**换了新会话、少了 13k 节点**。
    - 复现：`node scripts/qa/sidebar-newchat-probe.mjs --vault=<vault> --bloat=3000`。
72. **★ 排障纪律：仪器本身会把被测对象弄坏；「服务端 ok:true」不等于「用户界面有反应」；自建实例的结论不能代替用户实例**（2026-09-14，同一天里我在这三条上各栽了一次，全部写下来）。
    - **① 仪器制造的故障**：为了"记录一切"，我给页面 patch 了 `window.fetch`（`res.clone().text()` 记响应体）。dsh 客户端靠**流式响应**维持会话控制流，克隆读取把那条流消耗掉，页面随即**永久停在**「自动重连中...」/`phase=connecting`、控制台刷 `[connection] connection lost, retry #N`。我据此得出"服务连不上"——**错的**。不插桩时同一个实例 WebSocket `/api/remote.mux` 建得好好的。**规则：观测工具不得改写被观测的流**；要抓响应体就用 CDP 的 `Network.getResponseBody`（代理侧），不要在页面里包 `fetch`。
    - **② `ok:true` ≠ 有反应**：`POST /api/session/create` 返回 `ok:true` 只说明**服务端**建了会话；用户看的是界面。这一轮真正的判据是**侧栏会话行数有没有增加**（点击前后 `[role=treeitem]` 计数）。我先前只看服务端返回就宣布修好，结果被用户当场否掉。
    - **③ 自建实例 ≠ 用户实例**：我起的 dsh（`--port 0` + 自建 vault 目录）与用户在 Obsidian 里跑的那个（插件反代 + 真实 vault + 真实会话历史 + 皮肤）在**页面状态**上并不等价——同一段代码、同一个 preset 字段 bug，在两者上的表现可以完全不同。**要判断"用户那边怎么了"，必须打用户那个实例**：现在探针支持 `--entry=http://127.0.0.1:3180/`（跳过自建、直连已在跑的实例）。
    - **④ 顺带纠正一条数字**：`sidebar-performance.md` §0.3 那张"12 731 元素 19.9 ms/次"的表是**注入 3000 行 div** 造的，而 `data-chat-flow` 未必挂在可注入位置（实测 `flow=DIV[other]`，注入落在 `body`）。它只能证明"同页面上文档越大越贵"，**不能**预测"你会话写到 13k 节点时一定卡"——真实数字只认 §0.2 的真实 Obsidian 读数（13 102 节点、55 ms/次）。该节已加更正块。
    - **⑤ 结论**：坑 70 的 preset 修复是**真实且必要**的（服务端 `session/create` 从 `ok:false` 变 `ok:true`，有变异验证），用户也在**没有重启 Obsidian** 的情况下确认「新建会话会正常新建跳转了」（`agent-presets` 每次建会话现读，所以改盘即生效）。但"点按钮没反应"当时是否**只**由 preset 引起，我没有把用户实例的界面状态测到底——**别再把它当成"已完整解释"**。

73. **★ npm 发布有一条"publish 成功了但 registry 还没可见"的竞态，会被判成失败**（2026-09-14 发 0.7.6 实测）。整条流水线的每一步都是绿的——`Publish (trusted publishing)` 步 **success**、日志里已有 `+ dsh-math-memory@0.7.6` 与 `Provenance statement published to transparency log`——但紧跟着的 `Confirm the registry state` 在 **60 秒**内查到 registry 上 still missing，于是走失败分支：开 issue「npm publish failed for 0.7.6」并把 job 判红。**实测约 60–80 秒后** `https://registry.npmjs.org/dsh-math-memory` 才出现 0.7.6（`latest` 也才翻过去）。**处置：Re-run failed jobs**（`POST /actions/runs/<id>/rerun-failed-jobs`），第二次跑该步就能确认到 —— 转绿并自动 close 掉那个 issue。**不要因为这条红去改代码或改版本号**。这与坑 58 记的两种"退出码在撒谎"是同一族但方向相反：那条讲"退出码 0 ≠ 已发布"，这条讲"**registry 的可见性有延迟，查早了就是假红**"；`docs/release.md` §2 的"判断成败一律看 registry 实际状态"要加一条限定——**看 registry 也要给它一两分钟**。
    - 顺带核实了本次 claims 与 0.7.5 一致（`job_workflow_ref` 带 `@refs/tags/0.7.6`、无 `environment`、`aud = npm:registry.npmjs.org`），所以 trusted publisher 配置无需改动。
    - **第四次复现（2026-09-27 发 0.8.0）**：延迟这次 **> 90 秒**（issue #6），而 `Confirm the registry state` 当时的口袋正好是 **90 秒**（`for attempt in 1..6; sleep 15`）⇒ 又判红。**注意这条陷阱的原样复现说明"轮询存在"不等于"轮询够久"**——四次实测的延迟是 60–80 s / 92 s / 4–5 min / >90 s，**在增长**。已把该步改成 **18 次退避轮询（前 6 次 10 s、其后 25 s，约 6 分钟）**，并把**实际耗时打进日志**（`elapsed Ns`），这样下一次要重新定标时看日志即可，不必再靠猜。只读核实的方式不变，且仍是唯一判据。

74. **★ 探针会往用户的 dsh 里"注册工作区"，而且删目录删不掉它**（2026-09-14，用户发现侧栏多了 7 个 `dsh-preset-ws-XXXXXX`）。
    - **机制**：`session/create` 的副作用是**永久登记一个工作区**，dsh 把它写进 `$DSH_HOME/storages/workspace.json`（`tables.workspaces` + `global.workspaceIds`），这份表直接喂给侧栏的「工作区」列表。所以"用一个 `mkdtempSync` 临时目录建个会话试试"这种探针，会在**用户自己的侧栏**留下一个他从未创建过的工作区。我的 `test-agent-preset.mjs` 第一版用 `mkdtempSync('dsh-preset-ws-')`（每次新目录）⇒ 每次 `npm test` 留一个，一共留了 8 个。
    - **删目录没用**：登记项在 json 里，路径不存在也照样显示。必须**摘登记项**（现在有 `scripts/lib/workspace-registry.mjs` 的 `pruneWorkspaces` / `pruneMissingWorkspacePaths`）。
    - **第二个坑：大小写**。`os.tmpdir()` 在 Windows 给 `C:\WINDOWS\TEMP`，而 dsh 写的是 `C:\Windows\Temp` —— `path.startsWith(probePath)` 逐字符比较**全部漏掉**，于是"清理成功但一条没删"。`pruneWorkspaces` 负责把小写化 + 反斜杠归一，调用方只给谓词。
    - **第三个坑：服务内存里还有一份**。只手改 `workspace.json` 不管用——**运行中的 dsh 服务持有内存态**，它下次落盘会把删掉的条目写回来。清理顺序必须是：**先让服务结束 → 再改文件 → 再让服务起来**（实测：kill 后它并不会在退出时把旧列表刷回去，所以这个顺序是安全的）。
    - **规则**：任何会调 `session/create`（或点「新建会话」）的探针，跑完必须自己摘登记项，并把这一步做成断言（"残留在 json 里的条目数 === 0"），否则它会静默污染用户环境。**探针的默认工作区应该是固定路径 + 用完即删**，不要每次 `mkdtempSync` 一个新目录。
    - **顺带一条**：如果探针在 3180 上跑，它点的「新建会话」会在**用户真实 vault 的工作区**里建一个空白会话（我第一次就这么干了，两个空会话已删）。用 `--entry` 打用户实例时要接受这一点，或者只读不点。

75. **★ 工具返回值多一个字段 = 整次调用失败（dsh 的严格校验 + `additionalProperties: false`）**（2026-09-14，用户实测：模型说"note_recall 返回结构不合 schema，我改用 note_search/grep"）。
    - **机制**：dsh ≥0.1.5 的 `ToolRuntime` 对**成功返回值**也做 `validateJsonSchemaValue(tool.output.schema, value)`，而我们的 output schema 一律 `additionalProperties: false`。于是"**多返回**一个未声明字段"就是失败（不是"少返回"）。
    - **实测到的三处**：`rankRecallDocuments` 的 match 对象带 `hook` / `boundary` 且被原样返回给 `note_recall`；`note_recall` / `note_strategy` 的 `excluded` 项曾经带 `kind` / `score`；`note_create` 返回 `{ path, operation }` 时把键写成 `rel`（schema 里没有 `rel`）。**`note_strategy` 还少一个必填字段**（schema 声明了 `title`，返回里没有）。
    - **修法**：在**工具边界**收窄（管线内部可以继续带 rich 值给探针用），并补齐声明。`rankRecallDocuments` 的 matches 现在就在管线里收窄，因为它同时是探针与工具的输入。
    - **守卫**：`scripts/test-tool-schemas.mjs`（静态"声明了但没出现"+ 用 dsh 真校验器跑 fixture，含 `--mutate` 变异验证）、`scripts/test-tool-shape.mjs`（**真调管线**再递归比对声明与实际，并留一条"直通值必须被判违规"的反证）。
    - **设计教训**：静态文本匹配**不能**用来找"多字段"——第一版用"逗号/冒号切 token"读键，把 `path: a ?? "all"` 里的 `:` 当键分隔符，报出 `all`/`rel`/`null` 四个**假阳性**。**假阳性比不检查更糟**（教人忽略这个套件）。静态只报"缺"，"多"交给真值测试。
76. **★ `entry.doc.X` 的形状错误：`note_recall` 只要遇到一张"适用边界命中查询"的卡就整体抛 TypeError**（2026-09-14，同一轮修掉）。
    - `rankRecallDocuments` 的 `boundaryHitsOf(entry)` 原先写 `entry.doc.boundary`，而 `entry` **本身就是** scored 项（`{ doc, i, score, operatorMatch }`）⇒ `entry.doc` 是 `undefined`，读 `.boundary` 直接抛。`excluded` 的 map 又写 `entry.doc.rel`，同一处错误。
    - **为什么一直没被发现**：记忆回归（240 项）测的是**打分与排名**，不读 `excluded`；探针也不覆盖"边界命中"这条分支。**这条分支没有任何测试走过**——正是坑 68 那族（"没有用例走到的分支，不算被测过"）。
    - **触发条件**：库里任何一张带 `not_applicable_when` 的卡，其边界短语出现在查询里 → 整个 `note_recall` 不可用（模型侧只能退回 grep，用户看到的就是这句话）。
    - **修法**：`excluded.push({ doc: entry.doc, hits })` + map 用 `doc.*`，返回的四个键与 schema 逐字一致。守卫见坑 75 的两个套件（fixture 里**故意**放一张带边界的卡）。
77. **★ 链接跳转服务的端口与令牌必须跨加载稳定**（2026-09-14，用户实测"回复里的双链点了没反应"）。
    - **机制**：模型回复里的笔记链接是 `http://127.0.0.1:<LinkServer 端口>/open?path=…&t=<令牌>`，而这个地址是**写进系统提示**的（`DSH_MATH_MEMORY_LINK_URL` / `DSH_MATH_MEMORY_FEEDBACK_TOKEN`），提示又只在 **dsh 子进程启动时**生成一次。原先端口是 `listen(0)`（每次随机）、令牌每次插件加载重新 `randomBytes` ⇒ **插件一重载，此前所有回复里的链接立刻失效**：端口没人听（连接被拒），或者令牌对不上（403）。
    - **实测证据**：会话日志里模型生成的链接指向 `127.0.0.1:52269`，`netstat` 显示该端口早已不存在；同一时刻**任何**回环端口上都没有 LinkServer 在听。
    - **修法**：端口与令牌进 `data.json`（`linkServerPort` / `linkServerToken`），启动时复用；端口被占则回落随机端口**并写一行日志**（"链接又变了"必须有痕迹，否则下次还得从零排查）。守卫 `scripts/test-link-server.mjs`（12 项：固定端口、重载后端口/令牌不变、占用时回落不抛、两个端点的令牌与路径穿越判定）。
    - **仍未做**：把链接模板改成**运行时**注入（`ctx.systemPrompt.context()`），这样即使 LinkServer 换端口，新回复也总带当前地址；以及 3180 代理在"服务还活着但代理没绑上"时能自愈（本次排查中我把代理 reload 成了无监听状态，只能靠 reload 插件恢复）。
78. **★ 「某份清单里没有它」不是「它不存在」：我据一份过期的收录清单，把一个在架的插件判成"没上架"**（2026-09-15，同一天里我先误判、再按误判改了文档，被维护者当场纠正）。
    - **经过**：维护者要求核对中英 README 的漂移。我读到 `docs/project-assessment-2026-09-10.md` 第 16 条（判 HIGH：README 让用户在社区插件市场搜索，而 `obsidian-releases` 的 `community-plugins.json` 里没有 `dsh-math-assistant`），又**只**核验了 `community-plugins.json`（当时实测 2991 行，确实没有本插件），于是判定 zh 侧的「第三方插件 → 搜索安装」是**不存在的安装方式**，把它改掉，并把 en 侧早已存在的「尚未上架社区插件市场」当成正确的一侧去"统一"。
    - **实际事实**：**插件已在架**，中文 README 原本是对的。Obsidian 的收录方式已经改变，`community-plugins.json` **不再是收录依据**；现行依据是插件在 [community.obsidian.md](https://community.obsidian.md/plugins/dsh-math-assistant) 有页面（第三方目录 [obsidianstats](https://www.obsidianstats.com/plugins/dsh-math-assistant) 也收录了）。用一句"JSON 里没有"就下结论，等于**拿一把已经作废的尺子量**。
    - **它同时命中了仓库自己的两条纪律**：① `docs/agent-repo-maintenance.md` §5.3「已归档/已退役的文件里，仍可能藏着一句当下的声明」——`project-assessment-2026-09-10.md` 是**日期化快照**，它写的是 2026-09-10 的观察，不是今天的结论；② 「报告是线索不是事实」（坑 64）——我当时把它的结论当成了可直接执行的事实，**没有回去核对当下**。**核查规则**：判断"某东西存不存在"要用**当下的权威来源**（官方商店页 / 官方 API / 现场），清单文件只在**其自身被声明为权威**时才算证据；用清单做否定结论前，先确认这份清单还在被维护。
    - **连带纠正**：en 侧 README 的「**Not in the community plugin browser yet**」callout（含 BRAT 退路）**本身是错的**，需要按在架事实改正（本轮先把误改的 zh 侧还原，en 侧的事实修正单独做）。`docs/project-assessment-2026-09-10.md` 第 16 条与 `docs/release.md` §3 也要就地加日期化更正——它们仍在把这条早已不成立的观察当现状引用。
    - **本轮的净产出（保留）**：① 门禁 `scripts/check-readme-pair.mjs`（第 39 条）+ 一致性记录 `README.i18n.yaml`：只改一侧就红并指出是哪一侧（"最近被改的一侧即源"的机器形态），另比结构签名 / 切换行 / 相对链接集合 / 围栏代码骨架；② 它自己的变异验证 `--selftest`（8 项，同进程纯函数——**初版是假的**：fork 守卫看退出码，而受限环境禁止管道 stdio ⇒ `spawnSync` EPERM 被读成"退出 1"，于是每个变异都"被抓住"，最后 8/8 才真正成立）；③ 两侧 README 的 `- Version:`/`- 版本：` 行纳入 `check-version-consistency.mjs`（此前只锚 `handoff.md`/`design.md`）；④ 两侧**真实同构**的结论（14 节 / 29 条目 / 3 围栏、层级逐节一致）——即"英文显著落后于中文"这一初始判断不成立，真正落后的是两者共同腐烂的版本行。
    - **★ 与 dsh 上游 docs/i18n 的两处「故意不同」（照抄会误报，保留此结论）**：① 上游要求围栏代码块**逐字节一致（含注释）**——本仓库的注释是**有意本地化**的，`check-doc-consistency.mjs` 正是锚在中文那一份的注释措辞上（`# 语法 + 240 项零 token 回归`），所以这里只比"去掉注释后的首个 token（命令/路径）"；② 上游要求中文侧相对链接指向 `.zh.md`——本仓库**没有第二语言语料**（`docs/**`、`literature/**` 都只有中文一份），两侧必须指向**同一批文件**，所以比的是"两侧链接集合相等"。第一版按上游规则写，当场误报 15 处。**教训**：规则随语料结构走。

79. **★ 解析出的值带着包裹引号去拼接：边界会静默失效**（2026-09-17，构造探针查出）。
    - **经过**：「用户否决 ⇒ 收窄适用边界」的功能把本次查询的特征追加进 `not_applicable_when`。旧实现取整行值后**直接按顿号切片**，而模板 `templates/records/_README.md` 推荐的写法**带引号**（`not_applicable_when: "等价刻画不存在或更繁时"`），于是开引号黏在第一个片段上，值变成 `"等价刻画不存在或更繁时"、谱半径`。
    - **为什么危险**：门控是按**子串包含**判定的（`boundarySegments` 切出 2–12 字片段后做 `query.includes(segment)`），带引号的片段几乎永远不命中 ⇒ **用户点一次「本次场景不适用」，那张卡的原有边界就悄悄失效了**，而文件看起来完全正常、没有任何报错。
    - **修法**：取值后先 `trim()` 再剥掉包裹引号（`replace(/^["']|["']$/g, '')`）再切片（`memory-admin.mjs` 的 `inapplicable` 分支）。
    - **为什么值得记**：这是「**模板推荐的写法恰好触发代码的缺陷**」——最常用的形态反而是坏的。而且它**只在拼接时才暴露**，单看任何一半都正常。**推而广之：任何"读出值 → 拼接 → 写回"的字段处理，都要先按门控/消费者的解析方式归一化**，而不是按写入时的观感。
    - **它是被构造探针查出来的，不是读代码看出来的**：先写一个"带引号的边界"输入跑一遍，才看到输出坏掉。断言现为 `test-memory.mjs` 的 `shrink: a QUOTED boundary is unwrapped…` 与 `shrink: both the pre-existing boundary and the added one actually gate`。

80. **★ 文档承诺的纪律，代码可能一条都没实现**（2026-09-17，多个实例）。
    - **实例**：`strategy-readme.md` / `vault-AGENTS.md` 一直写着「策略卡是**候选**不是**指令**」，但 `rankStrategyCards` 只排除 `superseded`，而且**返回值里连 `status` 字段都没有** ⇒ 模型拿到的 `matches` 里 `active` 与 `candidate` 完全无法区分。同类：`uses` 数的是"被检索出来几次"，却被当作"有用"参与排序；`harmed` 只进体检报告、不影响排序。
    - **判据**：**文档里的每条"纪律"都要能指出它在代码里的执行点**；指不出来就是口号。发现方式很便宜——把文档里带"必须/只能/不得"的句子逐条去 grep 代码。
    - **反例（做对了的）**：`verified` 高于 `single-source` 必须有 `verified_by` 凭据，这条既有写入方（只有用户点 ✅ 会写）又有检测方（体检的 `unjustifiedUpgrade`）。**这条是范本：承诺 + 唯一写入者 + 检测者，三者齐备。**

81. **★ 断言在变异下照样通过：本仓库已出现至少五次**（2026-09-17 汇总）。
    - **形态**：断言看起来在测某性质，实际上夹具/条件让它在变异下也通过。已发生的实例——① 夹具内容**不超过**预算上限，所以测不出上限（写作 `compact` 与 `rich` 长度相同，我当时误判成"代码有未知机制在缩短"）；② `last_query` **完全没有写入侧断言**（测试手写 stats 文件，删掉记录那行照样全绿）；③ 重复对排序的夹具里强组写在**靠前的文件名**，扫描序恰好是降序，去掉 `sort` 断言不红；④ 「`wrong` 不动边界」写在**已被 `inapplicable` 收窄过**的卡上，"不重复添加"让变异无从体现；⑤ 无源卡的**技巧名独一无二**，去掉"无 source 不计入"的保护后什么都不会变。
    - **纪律**：**加了守卫必须做变异验证**（故意造缺陷 ⇒ 确认报错 ⇒ 恢复 ⇒ `git diff` 为空）。验收标准是"**它在该报错时确实报错**"，不是"跑了没报错"。**夹具必须跨过被测的阈值**，否则测的是阈值以下的行为。
82. **★ 「成本怎么量」本身当时是坏的——所以"省了 x% tokens"这类数字不能当套件产物看**（2026-09-18 归档时查清）。
    - **经过**：用户决定把 README 里那条「成本基准」存档（一道题：旧系统约 17 万计费 tokens → 新系统约 2.5 万，缓存命中 68%）。查它**是什么**时发现：**没有任何脚本、用例或 baseline 绑定这两个数字**（它来自一次人工对照运行），而且当时用来量成本的机器本身是坏的——`scripts/qa/e2e.mjs` 的 **token 计量恒为 0**，因为它只读会话格式 V3 里**已被移除**的 `assistant/chunk` usage 事件（`project-assessment-2026-09-10.md` §2 第 11 条）。
    - **最刺的地方**：`docs/memory/benchmark.md` §5 恰好把"tokens 从 `assistant/chunk` 的 usage 里取"写成了成本记录的**设计**。也就是说文档与代码在同一个错误上互相印证，而**没有任何门禁会发现"计量恒为 0"**——0 是一个合法数字，不会让任何断言失败。
    - **纪律**：① **一个没有测量脚本绑定的数字，不配进验收记录**——它无法重跑、无法验证，只会在文档里独立腐烂（本条正是它的下场）；② 量成本的产物里如果出现**恒为 0 或恒定不变**的字段，先怀疑**它读的事件还在不在**，而不是去解释那个 0；③ 归档"停用口径"的测量时，把**证据边界**一起存档（本次存进 `docs/archive/cost-benchmark-2026-08.md` §4），否则下一个人会把旧数字重新抄回文档。

83. **★ 「迁移」只迁了职责、没摘旧工具 ⇒ 一个能力留下多个入口，模型就自己挑**（2026-09-20 查清）。
    - **经过**：用户问「grep 是不是和 note_search 重复了」。核对后发现 `note_search` **两边都重复**——tag 过滤与 `note_recall` 用的是同一套 `noteTags`/`matchesTagFilter`，字面文本查找又与 grep 重叠（且是不排序的子串，精度更低）。更要紧的是 `docs/memory/retrieval-v3.md` §5 当初就写着「search 取代 note_search 与 note_retrieve 的查询职责」、§6 也把 `note_retrieve` 标成已退役，**但 `note_search` 这个工具本身没被摘掉**。于是 vault 里长期并存三个"找东西"的入口（`note_recall` / `note_search` / grep），模型自己挑；同一天排查的"grep 被当检索器用"正是同一病根的另一面（协议在多个位置把 grep 写成可选检索路径）。
    - **为什么长期没人发现**：没有任何门禁会因为"多一个入口"报错——工具数、schema、fixture 全都自洽。真实会话日志里 `note_search` 15 次调用**全部带 `query`、0 次只按 tag**，也就是说它唯一不可替代的能力（按 tag 枚举）其实没人在用，而它被当成"低精度字面搜索"，看起来还能用。
    - **纪律**：① **迁移一个接口时，旧接口要么当场摘掉，要么在工具面之外显式标成"已退役"并留一条守卫**——"职责迁走了"不等于"入口没了"；② 判断两个工具是否重复**不要凭印象**：把能力逐项列出来、对照代码（本例是"同名的 tag 匹配函数"这一条把结论钉死的）；③ 摘工具前先量一次**真实调用分布**（`note_search` 的 15/0 就是"可以摘"的证据），否则会把偶尔有用的能力一起删掉。
84. **★ 冻结的 fixture 会让你以为"顺手同步"是安全的**（2026-09-20，同一次改动）。
    - **形态**：`scripts/qa/benchmark-vault/` 是**冻结的基准语料**（`handoff.md` §7 已登记、`check-rename.mjs` 也按目录前缀豁免）。本轮改了 vault 协议（`vault-AGENTS.md`）后，它那份**故意停留在旧措辞**（还写着 `note_search` 与「grep episodes」路由）。
    - **纪律**：改协议模板时**先确认哪些副本是"生成的"、哪些是"冻结的"**——生成的要重建（`main.js`），冻结的**不要顺手改**，它的更新方式是"一次有意的刷新 + 新 baseline"，并且必须在改动记录里写明"刻意没同步它、为什么"。
85. **★ 夹具在证明一个不存在的场景是对的：三个"永远成功"的桩联手放走了一个必现缺陷**（2026-09-21）。
    - **形态**：`/open` 把 `.deepseek/**`（Obsidian 的隐藏目录）交给 `openLinkText`，**必然打不开**，而这个缺陷在该套件里**结构上不可能被发现**——因为三件事同时成立：① 所有 `/open` 用例**只用普通笔记路径**（`.deepseek` 只出现在 `/feedback` 用例里）；② 假 workspace 的 `openLinkText` 是**永远成功的桩**；③ `existsSync` 是**恒真桩**、`pathInside` 是**恒真桩**。于是"文件不存在 → 404"和"路径越界 → 403"这两条契约也从未被真正测过。
    - **同族**：坑 69（守卫 exit 0 不代表它比过）、坑 56（守卫把"没跑起来"当失败）、坑 81（断言在变异下照样通过）。共同点是**验证动作本身失效，而输出仍然是"通过"**。
    - **纪律**：① 桩要**如实反映真实约束**——`openLinkText` 对点目录"给不出 TFile"这一条，起码要在桩里留痕（本轮加了 `impossible` 标记），否则夹具会把产品缺陷洗成绿；② **每个端点都要有一条"不成功"的用例**（不存在、越界、令牌错），只测成功路径等于只测了一半；③ 新增分支时**先问"哪个桩会替它撒谎"**。
86. **★ 截断逻辑可以长期零覆盖：所有夹具都小于预算**（2026-09-21）。
    - **形态**：`clip()` 的截断分支两年没被触发过——本仓库所有夹具的注入内容都**远低于各自预算**（实测 `benchmark-vault` 整段 **4088 字符**、零截断），而它恰恰是错的（只保头部 ⇒ append-only 文件的**最新内容最先被丢**）。构造"增长型"夹具（旧在前、新在后、条目数超过预算）后立刻现形：`rec-1` 保住、`rec-40` 丢掉。
    - **纪律**：**超限/降级/错误分支都要有专门构造的夹具**，"默认路径绿"不覆盖它们；夹具的**形状**（而非只是大小）决定它能测到什么——append-only 的语料必须"最旧的在前"，否则"保头还是保尾"这个性质根本不会被区分。
87. **★ 断言把"包装"算进了被包装物的上限**（2026-09-21）。
    - **形态**：`audit: report bounded` 断言 `report.report.length <= 1200`，而被截断的报告长度 = 内容 + **截断标记**。标记因为要写出"省略了多少字符"长了 12 个字符，于是**内容一字未变**的报告报红。
    - **纪律**：断言一个量的时候，先问"这个量里还装了别的东西吗"；上限类断言要**分别**断言"被保留的内容 ≤ N"与"超限时标记存在"，不要合成一个恒等式。
88. **★ 一个被注释掉的列表项，让整个 profile 无法启动——而 41 条门禁全绿**（2026-09-21，实测踩到）。
    - **形态**：`dsh/profile/cordis.patch.yml` 的**第一行与上一条注释拼在了同一行**（`# …plus the cross-session memory plugin.- id: agent-presets`）。那一行因此是注释 ⇒ 顶层序列**从未开始** ⇒ 后面第一个裸 `- id:` 就是 YAML 语法错误。真 `dsh` 直接拒绝启动整个 `notes-assistant` profile：`failed to parse overlay …: YAMLException: end of the stream or a document separator is expected (16:1)`。**Obsidian 侧栏、`dsh --profile notes-assistant`、以及依赖它的门禁全部一起坏掉。**
    - **为什么门禁没发现**：① 除 preset 门禁外，**所有门禁都把这些文件当文本读**——`test-preset-sync.mjs` 逐字节比对两份拷贝，而被改坏的行仍然是合法文本，两份还**完全一致**；② 唯一会发现的 preset 门禁是因为它**真的启动 dsh** 才撞上的，而它在受限环境里会因"写不了 `$DSH_HOME`"先失败 ⇒ **恰好在看不到真相的环境里，这个 YAML 错误是不可见的**（同族：坑 56/59/69）。
    - **纪律**：① **"是合法文本"不等于"是合法配置"**——对装配文件（`*.patch.yml` / `*.cordis.yml`）必须有**解析**它的门禁，不能只做字节或文本断言；② 一个只在"能启动真进程"时才被发现的缺陷，等于在受限环境里**没有守卫**；③ 注释与结构的边界是这类文件的常见雷区（本仓库已两次：坑 60 的文件名、这条的注释吞行）——**新增守卫 `scripts/check-patch-yaml.mjs`**（解析 + 顶层必须是 op 序列 + 每个 op 带 `id`/`insert` + 直接断言"没有行被注释吞掉"）。
89. **★ 包装进了 `node_modules`，却没有任何 loader 挂载它——拖拽"接住了、也回 204"，就是不落笔**（2026-09-21，用户实测踩到）。
    - **形态**：从 Obsidian 文件列表把笔记拖进侧栏 dsh 输入框 → 提示条出现 → 松手 → **草稿里什么都没有**。插件 `debug.log` 把故障区间夹得很死：
      `[drop] 收到拖拽，解析结果="抄书/最优传输/最优传输2"` → `[drop] 直插=false` → `[drop] /mention 响应 204`，连续 5 次，全部这样。
      也就是说：**Obsidian 那侧完全正常**（路径解析对了、服务端也收下了），断的是"送进页面之后由谁落笔"。
    - **两个独立成因，缺一都修不好**：
      1. **直插那条路结构性不存在**：`insertMentionIntoFrame` 调 `frame.executeJavaScript` —— 那是 Electron `<webview>` 的方法，而侧栏里放的是**跨源 `<iframe>`**，没有这个方法 ⇒ 它按设计返回 `false`（日志里的 `直插=false` 是**正确行为**，不是 bug）。
      2. **兜底那条路没有接收方**：`/mention` → SSE `/mention-stream` 那半边要求页面里跑着**记忆面板的客户端半个**（它才 `window.__dshMentionInsert` + 订阅 SSE），而那个包**只躺在 `node_modules` 里，没有任何 loader 行挂载它**：`dsh/profile/notes-assistant.patch.yml` 与 `profiles/notes-assistant/cordis.patch.yml` 里都只有宿主半个。于是 `pushMention` 每次都落进空队列（`mentionClients.size === 0`）后被挤掉，**204 是真的、送达是假的**。
    - **根因（为什么"装好了"却"没挂上"）**：安装器 `install-into-profile.mjs` 把 loader 行**追加到 `profiles/<profile>/cordis.patch.yml`**。可 Obsidian 插件在**每次启动服务时**都用内嵌副本重写 `notes-assistant.patch.yml`（`buildNotesAssistantPatch`），而启动命令是 `dsh --profile notes-assistant --patch …/notes-assistant.patch.yml` —— **`cordis.patch.yml` 压根不在这条启动路径上**。两头都错：追加到 A 的行会被覆盖（就算追加到 B 也一样）。
    - **为什么门禁没发现**：① `install-into-profile.mjs` 的"成功判据"是 `patch.includes(PKG)` —— 一个**子串**检查，它证明"文件里出现过包名"，证明不了"有一行 id 挂载了它"；② `test-installer.mjs` 当时的断言是"`cordis.patch.yml` 的仓库内容是**前缀**，且追加块里有这个包名" —— 这条断言**把 bug 写成了期望**，等于给故障盖了章；③ `check-patch-yaml.mjs` 当时只断言 id **不冲突**（证明不了它**存在**）；④ e2e 探针 `drop-to-mention-e2e.mjs` 起实例时**没传 `--patch`**，于是它那台 profile 本来就不加载客户端半个，那条"该 profile 自己加载了客户端半个"永远红 —— **一条长期为红的断言，等于没有断言**（同族：坑 56/59/69）。
    - **修法与纪律**：① **那一行必须是发布物的一部分**，写进权威源 `dsh/profile/notes-assistant.patch.yml`（由 build 内嵌进 `main.js`，每次启动重写时自然带上）；② 安装器只做"**装包 + 校验行在**"，**不再往任何 patch 文件写行**；③ 门禁从"不冲突"改成**"恰好出现一次"**（零次＝静默失效，两次＝`duplicate loader entry id` 整个 profile 起不来），并**变异验证**过两种红；④ 探针改为照抄插件真实启动参数（含 `--patch`），于是那条断言第一次真的在测装配路径；⑤ **判据要锚在结构上，不要锚在子串上**："装好了"必须由"能解析出一行 id、且它指向的包确实存在"来证，不能由 `includes('包名')` 来证。
    - **为什么这条值得记**：拖拽功能**每一段代码都测过、每一段也都是对的**（解析、载荷、合成 paste、SSE、CSRF），坏的是**装配**——而装配恰好落在"安装器"与"插件每次启动重写 overlay"这两个各自都很合理的设计的**接缝**上。**"装进 profile"不等于"界面里加载了它"**；凡是有"安装期写文件 + 运行期重写同一文件"的地方，都要问一句**谁是权威、谁会覆盖谁**。
90. **★ 拿一个"沉默的旧构建"的观察结果去判定新代码有没有被执行**（2026-09-21/25，查拖拽时踩到）。
    - **形态**：真实侧栏实例（127.0.0.1:3180，经插件反代）上，我量到"页面订阅了 `/mention-stream`、服务端推一条、页面 `message` 事件**确实收到** `"路径"`、可草稿是空的"，于是判定"消息处理器那一段没落笔"。**这个结论当时是无效的**：那台实例上跑的客户端包是**旧构建**（`lib/client.js` 在页面加载时取，服务重启前一直是旧的），它根本**没有**我刚加的自述诊断代码——于是"日志里没有诊断行"被我读成了"处理器没执行"，而真相是"那段代码不在运行的包里"。
    - **为什么危险**：这是坑 88（文本 vs 配置）的近亲 —— **"我没观察到" ≠ "它没发生"**：观察通道本身可能是旧版本、或压根不存在。用一条"还没被部署的代码"的沉默当证据，等于拿空气当证据；而它会把排查方向引到完全错误的地方（我当时已经开始怀疑 SSE 解析与事件次序）。
    - **纪律**：① 判定"某段代码有没有被执行"之前，**先证明那段代码在运行的构建里**（取它自己的特征串/导出名去当前页面或当前产物里查一次，例如 `describeMentionInsert` 在不在服务的 bundle 里）；② **让被观察的东西自己说话**：静默的失败分支必须自述（`describeMentionInsert` + `/mention-report`），而不是靠外部推断"没看到 ⇒ 没发生"；③ 客户端包是**页面加载时**取的 —— 改了 `lib/client.js` 之后，**旧页面仍是旧代码**，"重启服务"与"刷新页面"是两件不同的事。
91. **★ 测试探针改动了用户的持久状态：一条"零 token 可随意跑"的探针，往侧栏塞了 38 条垃圾工作区**（2026-09-21/25，我自己造成的）。
    - **形态**：`dsh/profile/math-memory-workspace.mjs` 会把 `DSH_WORKSPACE_ROOT` **登记**进 `$DSH_HOME/storages/workspace.json`。而 QA 探针为了不碰真实 vault，都用 `mkdtempSync` 造临时 vault 起 dsh ⇒ **每跑一次探针，用户侧栏的「工作区」列表里就多一条 `C:\Windows\Temp\dsh-*-probe-*/vault`**。反复调试拖拽那几天累计塞进 **38 条**，列表里全是同名 `vault` / `probe-vault-*`。
    - **为什么危险**：工作区登记是**持久**的（写在 json 里、不是进程内状态），而且探针"零 token、可随意跑"这个表述**诱导人把它当成无副作用**。它的副作用还与排查混在一起：列表被垃圾项填满后，页面会先显示"选择工作区"而不是直接给输入框 —— **看起来像功能坏了**，实际是我的探针弄脏了用户环境。
    - **纪律**：① 探针前先问"它会写哪些**持久**状态"（workspace.json、settings、`.agent-presets`、会话目录…），会写就**用完立刻清**；② 清理要做成**按判据**的脚本（`scripts/qa/clean-probe-workspaces.mjs`：只删系统临时目录下的登记、先写 `.bak`、默认 dry-run），而不是手改 json —— `test-agent-preset.mjs` 早就有这条纪律（固定探针路径 + 用完摘登记），新探针必须照做；③ 探针的 vault 目录要用**唯一名字**，同名既让夹具无法确定性点中，也让垃圾项更难辨认；④ **"用完清理"不够，最好让它一开始就写不到**：`scripts/lib/isolated-dsh-home.mjs` 给探针种一个临时 `$DSH_HOME`（复制 profile 要点 + junction 链 node_modules），登记于是写进副本。注意两个反例：**删目录前要先读登记表**（顺序反了 `catch` 会返回 0 ⇒ 断言永远绿），以及**路径比较必须归一化**（`dsh` 写的是反斜杠路径，拿正斜杠前缀 `startsWith` 一条都匹配不到 —— 这是同一条断言"永远绿"的第二个原因；两处都做过变异验证）。

    - **补充（2026-09-25）**：本机残留的 10 条已在适配时清掉，那之后 `test: agent preset mounts` 由 16/17 变 17/17。**但这条断言本身就是"锚在用户环境数据上"的**：它读真实 `$DSH_HOME` 的工作区表，所以任何历史残留都会让它红——它是**告警**，不是回归。见到它红先跑 `node scripts/qa/clean-probe-workspaces.mjs`（dry-run）确认是不是旧垃圾，**不要**改断言。
92. **★ dsh ≥ 0.1.7：preset 里相对 `name:` 的解析锚点是 profile 目录，不是你写声明的地方**（2026-09-25，做 0.1.7 适配时踩到）。
    - **形态**：0.1.7 起 preset 变成一条普通 Cordis 行（`name: '@deepseek-ai/dsh-agent-preset'`，`config.plugins` 放组合）。把 `./math-memory.mjs` 这类相对行名按"和组合文件同目录"去理解（上一轮 V3 适配留下的直觉），于是把 `.mjs` 与声明它们的 patch 放在一起 ⇒ preset 审计报 `math-memory (./math-memory.mjs): never started`、`session/create` 返回 `agent-preset/invalid`；把**同一份** patch 里的 `.mjs` 只换位置（放进 `$DSH_HOME/profiles/<profile>/`）就一次通过（做过双 marker 差分：只有 `PROFILE_DIR:imported` 出现）。
    - **根因**：`agentPresetRegistry.register()` 捕获的是**registry 服务自己的 ctx**（`dsh-agent-preset-registry/lib/index.js:500-501,534` → `mountPreset(scope.ctx.extend({ baseUrl: record.context.baseUrl }))`），而 registry 行挂在 profile 里 ⇒ 相对行名锚定 **profile 目录**。`…/dsh/lib/profile-boot-*.js` 的注释也写了同一件事：*"the Loader needs a real include root to anchor `baseUrl` at the profile directory"*。
    - **纪律**：① 迁移这类"声明与实体分离"的机制时，**锚点要靠实测定位，不能靠"文件应该在哪"的直觉**——判据是"换个位置就通/不通"的差分实验，不是读代码猜；② 跨版本适配**不要从上一轮的结论外推**（V3 那轮"和组合文件同目录"是对的，0.1.7 就不是了）；③ 我们的落地形状：`dsh/preset/preset-deploy.mjs` 把体文件铺进 profile 目录，声明由 `scripts/build-preset-declaration.mjs` 生成进两个通道的 patch，两者由 `test: agent preset mounts` 一起钉住。
93. **★ import 失败在 preset 审计里只有一句 "never started"，真实异常被吞掉**（2026-09-25）。
    - **形态**：模块解析失败时**看不到** `ERR_MODULE_NOT_FOUND`。`cordis-plugin-loader/src/config/entry.ts:221-235` 的 `_init()` 把 `tree.import()` 的异常 `ctx.logger.error(error)` 之后**直接 return**（fiber 永不创建），于是 registry 的审计只能报 `math-memory (./math-memory.mjs): never started`；dsh 的启动 stdout/stderr 全文里也只有那一行 URL。
    - **为什么危险**：诊断文本指向"这个插件没起来"，但**不告诉你为什么**；而"没起来"与"起来后抛错"在审计里长得不一样、修法也完全不同（前者是装配/解析，后者看 apply）。若拿报错文本去 grep 模块名，会一条都搜不到。
    - **纪律**：① **门禁不要锚在错误文本上**：判据用"`agentPresets/list` 里有没有无 `broken` 的本 preset" + "`session/create` 是否 `ok:true`"；② 要知道"异步 apply 抛错是会被审计抓到的"（有对照实验：故意让 apply throw ⇒ 审计报 `broken`），所以"全程无 broken"可以当"apply 跑完了"的证据；③ 自己写插件时，装配失败要**主动自述**（照坑 90 的纪律），别指望宿主把它翻译出来。
94. **★ "仓库门禁全绿"不等于"机器上那份是好的"：声明在一个 overlay 里、却不在真正启动的那个里**（2026-09-25，阶段 3 真机验收时抓到）。
    - **形态**：把 preset 迁移做完、`npm test` 全绿之后，真机验收仍然报 `agent-preset/not-found`。原因不在代码：**已部署**的 `$DSH_HOME/profiles/notes-assistant/cordis.patch.yml` 里没有那条声明，而 `--dump-config` 看起来是"好的"（它把各层合起来看）。真正被当作 `--patch` 传进去的是 **`notes-assistant.patch.yml`**——`cordis.patch.yml` 走的是另一条路。**同一个 profile 的两个 overlay 都是真实启动路径的一部分，只在一个里放声明，就还是"认不出来"。**
    - **为什么危险**：仓库侧门禁是**自己铺自己验**（从仓库文件重建一份隔离 home），它证明的是"仓库对"；而真机上那份是**安装/引导写出来的**，两者可以不一致而不被任何仓库门禁发现。这是"夹具替产品撒谎"的又一个变体（坑 56 / 87 同族）：**验证的形状对了，被验证的对象不是现场那个**。
    - **纪律**：① 交付"配置类"改动时，**必须从现场（已部署的那份）再验一次**，不能只用"从仓库重建"的夹具；② 多 overlay 的启动链要**逐个**确认哪一层真的被读（这里靠实跑定位：`--patch` 参数就是答案）；③ 修完把"从现场出发"的验收**固化成门禁**：新增 `test: deployed profile accepts a session (real dsh)`——它从真实 profile 起隔离副本、只回填引导会写的东西，然后真建一个会话；两条路（仓库 / 现场）分开钉，才能各自说话。
    - **附带**：这一轮的临时验收脚本第一版**又踩了坑 91**（往真实工作区表塞了 3 条 `dsh-real-accept-*`，已用 `clean-probe-workspaces.mjs --apply` 摘掉）。教训照旧且更硬：**新探针默认先建隔离 home，而不是"记得清理"**。
    - **另附（工具纪律）**：本轮的文档计数更新一度用 PowerShell `Get-Content -Raw` + `[IO.File]::WriteAllText` 往返，把 `AGENTS.md` 与 `handoff.md` 的中文整篇变成了 mojibake（文件本身仍是合法 UTF-8，所以没有任何门禁发现；是 `git diff` 里满屏 `鈥?` 才暴露）。⇒ **改仓库文本文件一律用 read/edit/write 工具，不要用 PowerShell 把整份读进来再写回去**；`git diff` 中文字符的显示本身不可信（控制台编码），判断编码要看字节与工具读数。

95. **★ "没有调用方的导出"不被任何门禁执行：一个坏模块可以一直躺在发布包里**（2026-09-26）。
    - **形态**：`dsh/preset/preset-deploy.mjs` 的 `presetBodyDeployed()` 用了 `existsSync`，而该文件的 import 行里**没有它** ⇒ 一调就 `ReferenceError: existsSync is not defined`（实测跑过一次）。它从 0.1.7 适配那一轮就写在那儿，注释还写着"给安装器/status 用"。
    - **为什么没被发现**：① `node --check` 只查语法，而 `existsSync` 是运行时名字，语法层看不见；② `gates.mjs` 里没有它的 `--check` 条目；③ **全仓零调用方**——想调它的代码从来没写过，所以没有任何测试路径会碰到它。三条合起来 = "发布包里躺着一段一执行就崩的代码"。
    - **纪律**：① 守卫要**真的执行**导出，而不是只读源码文本：新门禁 `check: preset body lists agree` 直接 `deployPresetBody(...)` 写一个临时目录、再用 `presetBodyDeployedIn(...)` 各问一次，这类坏导出从此必红；② **零调用方的导出要么删、要么有守卫执行它**——"没有调用方"不等于"没有风险"，它只是"没有证据"。
96. **★ "四份清单"的漂移：`install --direct` 少铺两个文件，而门禁把错的布局写成了期望**（2026-09-26）。
    - **形态**：preset 体文件清单（`math-memory.mjs` / `note-tools.mjs` / `hook-frontmatter.mjs`）一度存在**四处**：`preset-deploy.mjs` 的 `PRESET_BODY_FILES`、`obsidian/main.template.js` 的 `DIRECT_PROFILE_FILES`、`dsh/install.mjs` 的 `DIRECT_PROFILE_FILES`、以及生成声明里的相对 `name:`。0.1.7 适配改了 Obsidian 那份与 npm 那条路，**漏了 `install.mjs`** ⇒ `install --direct` 产出的 profile 里声明写着 `name: ./math-memory.mjs`，而那个文件从没被铺进去。
    - **症状与判据（实测）**：`agentPresets/list` 里 preset 带 `broken:"math-memory (./math-memory.mjs): never started"`、`session/create` → `agent-preset/invalid`，**启动日志零告警**。把两个文件手工补进 profile 目录 → 立刻 `ok:true`（对照实验，因果确立）。
    - **为什么门禁没拦住**：`test-installer.mjs` 当时断言的是**已退役**的 `.agent-presets/notes-assistant/*` 布局（preset 解析锚点改成 profile 目录之后没人动这段期望）⇒ **它守着一个已经没人读的目录**，同时给坏通道盖章。而"清单与声明对得上"那条断言只检查 `preset-deploy.mjs` 里有没有那两个字符串，看不到 `install.mjs` 那份缺项。
    - **纪律**：① 一份清单只能有一处**权威**，其余要么派生、要么由守卫比对：现在权威 = `PRESET_BODY_FILES`，判它完不完备的判据是 `dsh/preset/math-memory.mjs` 的**相对 import 闭包**（`check: preset body lists agree`）；② 改一条通道的期望时，**同一提交里**要把断言其它通道的门禁一起改，否则"绿"只说明没人比。
97. **★ bundle 通道的 preset 不能用相对 `name:`：冷启动第一次必坏，第二次就好**（2026-09-26）。
    - **形态**：preset 的模块改成"由宿主行 `apply()` 铺进 profile 目录"之后，`dsh plugin --profile <名> add dsh-math-memory` 的**第一次**启动必然失败：`agentPresets/list` 报 `broken:"math-memory (./math-memory.mjs): never started"`、`session/create` → `agent-preset/invalid`，**而启动日志一行都没有**；第二次启动（文件已在）一切正常。最小复刻里把"铺文件的行使者"放在声明行**之前**那次是通的，所以这**不是**"顺序写没写对"的问题。
    - **根因**：registry 挂载 preset 的 `plugins` 行发生在**声明行激活时**，而那时宿主行**还在 import 自己**（动态 import 是异步的）。任何"宿主先铺文件、声明再解析相对名"的设计都天然有一拍窗口，插件侧关不掉。
    - **修法（实测）**：bundle 通道把 preset 入口行写成**包内 specifier**（`dsh-math-memory/dsh/preset/math-memory.mjs`）——包本来就是 `dsh plugin add` 装进 `profile/node_modules` 的，**不需要任何东西先存在**，冷启动一次就通；同一 profile 名故意不叫 `notes-assistant` 也照样通。离线通道（Obsidian 引导、`install --direct`）继续用 `./name`，因为那两条**在 dsh 启动前**就把体文件写进 profile 目录了。
    - **纪律**：① 判据必须是"**冷启动一次**能不能建出会话"，不能接受"重启一次就好了"；② 两种 name 形态由同一次生成产出、由守卫**分别**钉住（`check: preset body lists agree`），**不要手改生成物**；③ 见到只有一句 `never started` 的报错，先按坑 93 换判据，别去 grep 错误文本。
98. **★ 门禁会退化成 `0/0 断言 + exit 0`，而汇总把它算成"通过"**（2026-09-26）。
    - **形态**：`test: deployed profile accepts a session` 的起点是**机器上已部署**的 profile。2026-09-25 那次整机事故把 `$DSH_HOME` 清掉之后，它的前置条件永久不成立 ⇒ 打印 SKIP 并 `exit 0`、**一条断言都没跑**；而 `run-gates.mjs` 当时**只按退出码统计**，汇总于是报"45/45 gates passed"。真相反过来：它测的那种形状是**唯一没坏的**，另有三种形态全坏（profile 名 ≠ 常量、冷启动第一次、`--direct`），一条都没被覆盖。
    - **为什么危险**：SKIP 与 PASS 在汇总里长得一模一样，而"全绿"是人做判断的依据。更要命的是**门禁越依赖现场就越容易退化成这样**：现场会消失（事故、换机器、CI），而它不会因此变红。
    - **纪律**：① 门禁要**自带前置条件**而不是依赖现场：这条现在自己离线装一份 bundle 形态的 profile（`node_modules` 也是拷的，不联网、不用 pnpm），profile 名**故意不叫 `notes-assistant`**，冷启动一次再建会话——三种坏形态一网打尽；② 汇总必须**三态**（`ok` / `SKIP` / `FAIL`）并**列出被跳过的门禁名与原因**，`__SKIP__ <原因>` 是套件声明跳过的唯一标记；③ 合成型门禁（自己再跑别的套件的那种）**不要回显子套件的 `__SKIP__`**，否则父门禁会被误判成跳过（`check-doc-consistency.mjs` 现在回显前会剥掉该标记）。附带一个容易踩的细节：`\bSKIP\b` **匹配不到** `__SKIP__`（`_` 是词字符，没有词边界），本轮差点因此让 `check-doc-consistency` 直接 FAIL。

99. **★ "防御性兜底"的前提会失效，而它不会因此报错**（2026-09-26）。
    - **形态**：`syncGlobalPackageLinks` 存在的理由是"皮肤管理器把活动皮肤写进 `$DSH_HOME/cordis.patch.yml`，而那个全局层作用于**每一个** profile，所以侧栏 profile 也必须能解析 `@linxin666`"。但 skin-center **0.4.x 已经不再改写那个文件**（它自己的 README 原文：*"no reload, no cordis.patch.yml rewrite, no restart"*），并且它的 legacy bridge 会把 v1 的受管段**清掉**。本机 `$DSH_HOME/cordis.patch.yml` 里确实一行 skin 都没有 ⇒ 镜像的**全部理由**消失了，代码却仍在每次启动时建 18 条目录链接。
    - **为什么危险**：这类"为兼容上游行为而写的兜底"**不会随上游改变而报错**——它只是退化成一个纯副作用：在本机（全局禁止建链接、且刚经历过一次 harness home 全损、目录链接是疑似载体）悄悄建 18 条链接，而且**没有任何门禁能发现"前提已不成立"**，因为门禁测的是"镜像有没有清理干净"，而不是"还要不要镜像"。
    - **纪律**：① 写兜底/兼容代码时，把**它成立的前提**写进注释并给出**可复核的判据**（这里是"`$DSH_HOME/cordis.patch.yml` 里有没有 skin 行"）——下一次适配先跑那个判据；② 兜底要有**退出条件**，不能只有触发条件；③ 退役时**保留仍能独立成立的那部分防御**：机器级 patch 里若还有皮肤行，`buildSkinFallbackBlock` 仍会把它们 `disabled: true` 掉（这件事不依赖镜像）；④ 只为它存在的门禁（`check: mirror cleanup`）与代码一起删，别留着测死代码。

100. **★ 一个"自己报了名、却没报版本"的清单文件，能让整条回复链路全废**（2026-09-26）。
    - **形态**：实机侧栏里**每一轮回复**都失败，报 `本轮运行失败 DeepSeek request extension preparation failed`；会话日志显示 `request/context` 之后约 30 ms 就 `turn/end: error` ⇒ **HTTP 之前**、**没花 token**。真凶是 profile 自己的 `package.json`：它有 `name` 却**没有 `version`**。
    - **为什么危险**：上游唯一抛那句话的地方是 `dsh-llm-deepseek` 的 `prepareRequestExtensions`，它把真正的 `cause` 包在里层（UI 与会话日志**只留外层**）⇒ 从症状读不出病因。而触发链很绕：`dsh-base` 里那个**默认开启**的 `@deepseek-ai/dsh-plugin-package-inventory-deepseek` 请求扩展会解析**每一个活动行**的"归属清单"；**相对路径行**（`./math-memory.mjs`，正是离线通道的形态）走 `nearestManifest()` 一路向上找到了 **profile 自己的 `package.json`**，然后上游的 `identityFromManifest(path, allowAnonymous=true)` 是这么写的：
      `if (allowAnonymous && manifest.name === undefined) return undefined;`（**没有 name = 当作 loose module，放行**）
      `if (!name || !version) throw new Error('… must declare non-empty name and version');`
      ⇒ **有 name、缺 version 就抛**。`web` profile 从不触发，因为它所有行都是裸包名，压根不走那次向上查找。
    - **纪律**：① 症状指向"上游/版本适配"时，先想办法拿到**里层 cause**——本轮最终靠的是"在真 profile 里挂一个包住 `prepare` 的探针插件，把 `cause`/`aggregate`/活动行列成文件"（探针同时**吞掉**失败，用户先能用），比猜三轮都值；② profile 清单这类"我以为是脚手架、其实参与解析"的文件，**只有 name 不够**：脚手架、安装器和插件引导都必须补齐 `version`，且**存量 profile 要能被修复**（`copyFile` 默认保留用户可编辑文件 ⇒ 光改脚手架救不了已装用户）；③ 中途两个"看起来证伪"的实验其实什么都没测——headless profile 里那一行 inject `webServer`/`workspaceRegistry`，没有这些服务就**不是活动行**，而该扩展只看活动行（`fiber.state === 2`）。**"没复现"不等于"不是它"**，先确认实验真的压到了那条路径。

101. **`$DSH_HOME/sessions/` 的目录名是"有损编码"，但**别**用它给会话归因**（2026-09-26）。
    - **形态**：目录名看着像乱码，容易被当成"编码 bug"去修（`docs/handoff.md` §7 那条"mojibake"就是这么写的），
      实测**不是** bug、也**不该**被本插件依赖。
    - **方案本身**（读 dsh 源码确认，`@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js:875-894 projectKey`）：
      `/ \ :` → 单个 `-`；`[A-Za-z0-9._-]` 原样；**其余字符**（中文、`~` 等）→ `~` + `charCodeAt().toString(16)`
      大写补 4 位；结果包成 `--…--` 并**截断到 251 字符**。所以 `小新` 变 `~5C0F~65B0`（不是乱码，是可逆的转义）。
      源码 `:870-871` 自己注明**截断与分隔符替换是"有意有损"的**（human-navigable 惯例）⇒ 两个很长的项目路径
      **可能共用同一个目录**。
    - **为什么不该依赖它**：本插件给会话归因用的是**会话日志头行的 `cwd`** 再 `pathInside(root, cwd)`
      （`dsh/preset/math-memory.mjs:394-405 isVaultSessionLog`）⇒ 目录名怎么编码、是否被截断、是否合并，
      都**不影响**"这场会话属不属于这个 vault"；再加 `selectAuthoritativeLogs` 按会话 id 去重，
      同一会话也不会因目录重复而被计两次。**结论：拿目录名当项目身份是个陷阱**——它有损且可能碰撞。
    - **仍然真实的上游风险**（陷阱 18）：`sessions/` 里若真出现含 `~FFFD~`（U+FFFD 替换字符）的目录，
      dsh 0.1.1-rc.2 会在 session identity 校验时报 `corrupt session log` 并 **boot 失败**；处置是把该目录
      **移出**（备份，勿直接删）。本插件的扫描对读不了的目录是 `try/catch` 跳过，不会因此崩。
    - **本机实测（只读）**：`$DSH_HOME/sessions/` 只有 2 个项目目录、命名规范、含 `~FFFD~` 的 **0 个**
      ⇒ "编码分裂（正确 vs 乱码并存）"在本机**不存在**；写这条时不要照抄旧结论。

102. **★ "重复注册 `/memory-panel` 前缀会让整个 profile 起不来"——在本机 dsh 上复现不出来，别当成既定事实**（2026-09-26）。
    - **背景**：`dsh/client-panel/install-into-profile.mjs` 的注释与 `docs/bundle-channel-plan-2026-09-26.md` 的 S3
      都把 `duplicate prefix route "/memory-panel"` 当作**硬失败**（"整个 profile 起不来"），并据此说"没有这条守卫
      就不能合"。本轮为验证 S3 去真装配，**没能复现**这个硬失败。
    - **实测怎么做的**：隔离 `$DSH_HOME` → 真物化 bundle 包放进 `node_modules` → 用 `--patch` 挂上**仍声明那两行**的
      overlay → 先用 `--dump-config` 确认组合树里**同时**有包的行（`math-memory-host` / `math-memory`）与 overlay 的行
      （`math-memory-workspace` / `math-memory-panel`）→ 再真启动。**结果：启动成功，0 条 duplicate 诊断。**
    - **为什么第一次没测出来（值得记的坑）**：overlay 那两行是**相对名**，而 bundle 通道**只在 `node_modules` 里放包、
      不在 profile 根铺平铺文件** ⇒ 它们以 `failed to import` 告终，**根本没挂载**，自然不撞车。把 `math-memory-panel.mjs`
      的**完整依赖链**补到 profile 根（它需要同级的 `memory-admin.mjs` 与 `hook-frontmatter.mjs`，后者又需要
      `engine-shared.mjs`）后，panel 行**确实 import 成功**，**仍然没有** duplicate 报错。
    - **结论与纪律**：① **不要**再引用"重复注册该前缀 ⇒ dsh 硬失败"作为设计前提；`install-into-profile.mjs` 注释里那次
      历史故障**想必另有条件**，要引用就得先复现。② 结论变了**不代表 S3 白做**：剥掉那两行仍然正确（组合树只声明一份、
      不留死行），只是它是**正确性/整洁性**改进，**不是**阻断性风险。③ 探针**必须自证施加了变异**——我第一版把
      "变异形态"与"S3 输出形态"的 overlay 文本**接反**了，静默测了正确形态并得出"无碰撞"；是靠 `--dump-config`
      打印组合行才发现的（与陷阱 68 同族：**控制用例必须能把现象归因到它自己那一次运行**）。
    - **另一条操作细节**：`dsh --patch` 必须排在 app 参数（`--no-open` / `--port`）**之前**，否则 dsh 已停止解析自己的
      flag，报 `unknown option '--patch'`（仓库里 `test-agent-preset.mjs` 就是这么写的）。

103. **★ `--force` 曾把用户在 `<profile>/cordis.patch.yml` 里写的配置整份吃掉**（2026-09-27 真机，同一机制一天内两次）。
    - **症状**：用户装本插件到 3080 的 `web` profile，随后"自定义模型信息消失了"。
    - **根因**：那个文件是 **profile 自己的、用户可编辑的 dsh patch 层**（用户把自定义 provider 写在这里）。
      `install.mjs` 有四处把 `!existsSync(target) || options.force` 当 `copyFile` 的 overwrite 标志传给
      `PROFILE_DIR/cordis.patch.yml`。而 `--force` 的**本职是通道归属接管**（`assertChannelOwnership`），与这个文件无关
      ⇒ 任何 `install --force` 都会整份替换它。实测：`web` 的层 `988 B → 3738 B`（`15:13:18`），用户的 `llm-pi-ai`
      块随之消失；`notes-assistant` 的层同日 `14:27:45` 同样被换掉。
    - **我们其实早就把契约写下来了**——写在**安装器自己种进那个文件的注释里**
      （`dsh/client-panel/install-into-profile.mjs`）："这一层是 profile 自己的 patch 层，**没有任何人会重写它**"。
      所以这不是设计分歧，是**自己违反自己的契约**。
    - **修法**：新增 `ensurePosture()`，四处调用点全部改走它：**只在缺失时铺脚手架**，存在就原样保留（并打 `[keep]` 行），
      通道需要的声明增删仍由本来就会保留用户行的 `stripPresetDeclaration` / `ensurePresetDeclaration` 精确完成。
      **关键细节**：真正防住数据丢失的是 `copyFile(..., false)`，不是那句 `if (existsSync)` 提前返回
      ——变异验证时把提前返回去掉，文件**依然安全**（只是不再出声），把标志位改回 `options.force` 才会丢数据。
    - **门禁**：`test-installer.mjs` 新增 11 条（helper 保持 `--force` 不改写 / 逐字节不变 / 出声 / 真 CLI 端到端 /
      缺失时仍铺且与仓库一致 / `--dry-run` 不写 / **源码里不许再出现 `cordis.patch.yml` 与 `options.force` 同行** /
      四个调用点都走 `ensurePosture`）。**变异验证**：还原成原始形态 ⇒ **5 条红**（含两条数据丢失断言与 CLI 端到端）。
    - **教训**：一个 flag 同时兼职"接管归属"与"覆盖文件"两件事时，**"用户数据"是它顺手碾过去的那一类**。给可写配置加
      overwrite 参数之前，先问"这个文件到底是我的还是用户的"。
    - **顺带记录（未修）**：同一批 `copyFile` 对 `package.json` 也传了 `firstRun || options.force`（3 处）。profile 的
      `dsh.profile.bundles` 里可能有用户自己加的行，**这是同一类风险的候选**，本轮未查未改，别当成已解决。

104. **★ 本地工作副本的行尾**可以**和提交的内容不一样**，而 `git status` 一声不吭 —— 于是"本地全绿、CI 全红"（2026-09-27 实测）。
    - **症状**：把积压的 129 个提交推上去后 CI 红；同一个门禁在本机跑是绿的。失败的只有一条：
      `no drift …\profiles\notes-assistant\cordis.patch.yml`（`test: installer e2e`）。
    - **根因**：仓库里这个文件的行尾是 **CRLF**（无 `.gitattributes`；实测 267 个受版本控制的文件在 blob 里都是 CRLF），
      而本机工作副本里它恰是 **LF**。本机 `core.autocrlf=true` ⇒ **比较时两边都被规范化**，
      所以工作副本字节不同而 `git status` 仍然干净。声明修复函数又把 `"\n"` 写死：
      `stripPresetDeclaration` 的空白行折叠**匹配不到** CRLF 的连续空行（`\r\n\r\n\r\n` 每对之间都有 `\r`），
      append 路径则把 LF 块接到 CRLF 文档上 ⇒ 实测 `9849 → 9726` 字符、**行尾混用**（79 CRLF + 123 LF）。
      本地(LF)往返是恒等的，CI(CRLF)不是 ⇒ drift 断言只在 CI 红。
    - **怎么复现 CI（这条方法比结论更值钱）**：`git archive` 取出**受版本控制的那棵树**（不含任何被忽略的本地文件），
      复制 `node_modules` 后在里面直接跑套件 —— 那就是 CI 拿到的文件集合。本机 `git clone --local` 会因硬链接失败而不可用。
    - **纪律**：① **不要拿本地文件的行尾当事实**——门禁要**显式喂 CRLF**（本次新增的 6 条就是这么写的），
      断言仓库自带文件等于跟着 checkouts 漂移；② 生成/改写配置的函数**不许写死行尾**，要么探测、要么保持；
      ③ "本地绿、CI 红"优先怀疑**文件集合与字节**的差异，而不是代码逻辑差异。
    - **修复**：`lineEndingOf()` / `withLineEnding()` + 两处修复函数改为行尾保真（LF 下结果逐字节不变）。变异验证：
      把 `lineEndingOf` 改回写死 `"\n"` ⇒ **恰好 3 条 CRLF 断言红**（LF 三条仍绿），数字与事故现场一致（9849→9726、crlf 202→79）。

105. **★ 只在 Windows 成立的"测试缝"等于在 Linux 上是空过**——`spawnSync` 报"工具缺失"的形态**按平台不同**（2026-09-27 实测）。
    - **症状**：Ubuntu CI **连续三轮**都只有一条红，Windows 同一提交全绿：
      `[FAIL] S4 fallback: it SAYS it fell back, with the reason`，细节是
      `[fallback] 本地包化未成功（dsh not found on PATH）⇒ 回落到平铺通道`。
    - **根因**：`tryBundleInstall` 先判 `result.error` 再判那条测试缝。而 `spawnSync("dsh", …, { shell: process.platform === "win32" })`：
      **Linux 上 `shell:false` ⇒ 返回 `result.error`（ENOENT）**；**Windows 上 `shell:true` ⇒ cmd 起得来，只有退出码非零**。
      于是没有 `dsh` 的机器上，**Linux 走 ENOENT 提前返回，永远到不了 `DSH_TEST_UNREGISTER_BUNDLE` 那条缝** ——
      这条缝本来要用变异证明"判定来自文件系统而不是退出码"，在 Linux 上**一次都没比过**；而断言又要求理由里出现
      `DSH_TEST_UNREGISTER_BUNDLE|not registered`，于是 Linux 报红、Windows 报绿。
    - **纪律**：**测试缝必须排在任何环境相关的提前返回之前**，否则它在某些平台上静默失效（正是本仓库反复删掉的
      "空过"形状，见 AGENTS.md §6「没有用例走到的分支，不算被测过」）。判据不要依赖 `spawnSync` 的**形态**
      （`error` vs `status`），那是平台方言。
    - **复现办法（本机就能做，不必等 Linux）**：把 `install.mjs` 里三处 `shell: process.platform === "win32"` 全改成
      `shell: false`（= 模拟 Linux 分支），并把 `Roaming\npm` 从 `PATH` 里去掉（= 模拟 CI 没有 `dsh`/`pnpm`）。
      于是：**修复前** ⇒ 恰好 1 条红、细节字符串与 Ubuntu 注解逐字相同；**修复后** ⇒ 全绿。
    - **修复**：把 `const forcedUnregistered = …` 提到 spawn 之前，并写成 `if (result.error && !forcedUnregistered)`。
      附带发现：`run-gates.mjs` 失败时只打**尾 25 行**，而这条红排在约 470 条通过断言之前 ⇒ **报告失败却报不出是哪条**；
      连 CI 注解也救不了（截断发生在 run-gates 内部，`[FAIL]` 行从未到达 stdout）。已改为**先打印所有 `[FAIL]` 行**再打尾部；
      workflow 的 `::error::` 窗口也从 2500 字符放宽到 6000。**诊断信息不该把失败藏起来**。

106. **★ `install --force` 也吃掉过 profile 的 `package.json`**——与陷阱 103 同源、同一天，且是**这一类的最后一处**（2026-09-27）。
    - **症状**：一个自己加过东西的 profile，跑 `install --direct --flat --force` 之后，`dsh.profile.bundles` 里用户加的
      `user-custom-bundle`、`dependencies` 里的 `some-user-plugin`、`scripts`、以及一个自定义顶层键**全部消失**
      （实测 `371 → 304` 字符）；而且 `name` 变成脚手架里写死的 `dsh-profile-notes-assistant` —— 往 `web` 装也自称是
      notes-assistant 那个 profile。
    - **根因**：三处把 `firstRun || options.force` 当 `copyFile` 的 overwrite 标志传给
      `PROFILE_DIR/package.json`（`nativeInstall` / `tryBundleInstall` / `directInstallProfile`）。
      `--force` 的本职是**通道归属接管**，与这个文件无关 —— 与陷阱 103 一模一样的形状。
    - **仓库其实早就知道这文件是用户的**：`repairProfileManifest` 的注释称它为 "the one file a user may have edited by
      hand" 并为它守住了 `--dry-run`；卸载路径也守住"手改过的 posture 不删"。**三条路径守了两条，`--force` 这条没守。**
    - **关键实测（修复的安全性依据）**：模板拷贝对**已有** profile 是**多余**的。在"今天本来就会跳过拷贝"的路径上
      （已有 profile、不加 `--force`、走真 bundle 通道 + pnpm）实测：`dsh-math-memory` 照样被注册进
      `bundles`，用户那条 `user-custom-bundle` 也还在。所以去掉 `|| options.force` 是**构造上安全**的。
    - **修复**：新增 `ensureProfileManifest()`（与 `ensurePosture` 同形）——**缺失才铺脚手架，存在则保留并打 `[keep]`**；
      三处调用点共用它，其返回值天然就是原来的 `firstRun`。顺带修掉写死的 name：新建时按
      `dsh-profile-<profile 目录名>` 推导（与 `repairProfileManifest` 已有的规则一致；对默认 profile 结果不变）。
    - **门禁**：`test-installer` 新增 11 条（真 CLI `--force` 后用户四项**全在** / 仍自称自己 / 安装器自己的依赖**仍被追加** /
      出声 / 缺失时仍铺且 name 按目录推导 / `--dry-run` 不写 / **源码里不许再出现 `package.json` 与 `options.force` 同行** /
      三个调用点都走 `ensureProfileManifest`）。**变异验证**：还原成原始形态（去掉 keep-guard + 标志位改回
      `options.force`）⇒ **3 条红**（两条数据丢失 + 一条结构性）。注意：**只**去掉 keep-guard 是**测不出来**的
      —— 真正防住的是 `copyFile(..., false)` 这个标志位（与陷阱 103 记的同一条教训）。
    - **纪律**：给"可写配置"加 overwrite 参数之前，先问"这文件到底是我的还是用户的"；`--force` 只做归属。
      `install.mjs` 里**仅存**的 `options.force` 文件写入就是这三处，其余（`assertChannelOwnership` / 卸载判定）
      都不碰用户文件 —— 这一类到此为止。

107. **★ npm 拒绝发布"比当前 `latest` 更低"的版本**——所以版本一经发布就**不能往回改**（2026-09-27 实测，代价是一整轮改号作废）。
    - **怎么撞上的**：0.8.0 已发布后，用户判定本批以修补为主、要求改成 `0.7.9`。GitHub 侧清干净了（删 Release + tag），
      npm 侧也想"留着 0.8.0 当孤儿、把 0.7.9 发成 latest"，结果 `npm publish` 直接被拒：
      ```
      npm error Cannot implicitly apply the "latest" tag because previously published version 0.8.0
                is higher than the new version 0.7.9. You must specify a tag using --tag.
      ```
    - **含义**：npm 不会隐式把 `latest` **倒退**。要走下去只有两条：① 显式 `--tag latest`（绕过这道守卫，但会在 registry 里
      **永久**留下一个更高的孤儿版本，且此后每次发布都要显式覆盖一步安全检查）；② 先 `npm unpublish`（见下）。
      **结论：发布过的版本号就是事实，改动它是逆着 registry 走的**，除非愿意付上面两种代价之一。
    - **unpublish 只能人工做**（本次实测到底）：npm **没有网页入口**，只有 CLI `npm unpublish <pkg>@<version>`
      （72 小时内；单版本不需要 `-f`，**加 `-f` 或省略版本号会删掉整个包**）。它要求**登录 + 2FA**，本机 `~/.npmrc`
      **没有任何 token**（`npm whoami` → `ENEEDAUTH`）⇒ 自动化不了。**OIDC trusted publishing 也不行**：我用它换到了凭据，
      但 registry 在授权层拒绝 —— `400 Bad Request ... OIDC publish authorize: Invalid request`
      （**trusted publishing 只授权 publish，不授权 unpublish**；那是 npm 侧的策略，不是配置错误）。
    - **纪律**：① 发版前把版本号想清楚，"先发再改号"不是可逆操作；② 想知道发没发出去**只看 registry**，
      `npm view` 的本机缓存会骗人（要用带 cache-buster 的直连查询）；③ 判据别信 `Publish` 步的绿 —— 它是
      `continue-on-error`，真正的判据是 `Confirm the registry state`（本次正是它抓住"npm 拒绝了"，并把 npm 的原话写进 issue #7）。
    - **顺带一条可复用的手法**：npm 的失败原文会进 **issue**（job 日志要 admin 权限才能读，issue 不需要）——排查发布问题时**先读 issue**。

108. **★ 只冻结"只有我们会写"的文件的字节**——把别人也会写的文件做哈希冻结，等于**按插件自己的指示操作就会永久飘红**（2026-10-01 实测）。
    - **怎么撞上的**：安装清单给**每一个** posture 文件记 sha256 并当硬校验。其中 `cordis.patch.yml` 被同一个安装器
      在 650 行之外定义为"用户的层、永不重写"，而 **dsh 自己的设置面板按设计就重写它**：
      `@deepseek-ai/dsh-config-editor` 把整份文件重新序列化后追加自己那一行（`:23-26` / `:105-109` / `:123`）。
      本机记录 `733715c9…`、现存 `69ea710a…`，13 个文件里**只此一个**不符 ⇒ 门禁 53 唯一那条红。
    - **形态特征（认得出来就能立刻定性）**：不是人手编辑的样子 —— 安装器写的 `3738 B` 被 YAML 重新序列化成 `3749 B`
      （只有 2 条长 `!!js` 标量在默认 80 列处折成 4 行），再加 `774 B` 的 3 行新配置。
      **同类但更隐蔽的一条**：`cordis.yml` 由 dsh **每次**组合 profile 都重写成 `[]`（`--dump-config` 就会写）——
      **字节相同所以摘要不红**，但字节归 dsh 所有，一旦上游改一次排版就会红成同一形态。
    - **纪律**：判据是**"谁还会写这个文件"**，不是"谁创建了它"。共享清单住在
      `dsh/preset/profile-contract.mjs` 的 `POSTURE_SHARED_FILES`，**每条必须带实测到的第二写入方**，
      没有第二写入方的文件**不许进来**。共享文件不冻结摘要、卸载时**无条件保留**
      （"仅在漂移时保留"会在**未改动**时把它们删掉 —— 那正是 2026-09-26 丢配置的同一类）。
    - **守卫形态**：两个 manifest 写入方（CLI 与 Obsidian 模板）此前**没有任何比对**。`check-profile-contract.mjs`
      的 `PINNED-7` 把模板那个函数**从 `main.js` 里取出来真求值**，拿同一份 profile 与 CLI 实现逐文件比摘要 ——
      **不要**改成比对源码文本（那只能钉住写法）。

109. **★ dsh 0.2.0 起 `$DSH_HOME/cordis.patch.yml`（home 层）压过 profile 自己的层**（2026-10-01 读源码 + 实测，本机当前无冲突）。
    - **含义**：home 层与 profile 层若有**同 id** 的行，home 层**静默赢**（`profile-boot`, `:192-198`）。
      插件把 `permission` / `approval` / `sandbox-policy` / `fs-sandbox` 写在 **profile 层** ——
      用户在 home 层写同名 id 就会**静默覆盖**它们，而没有任何东西会报错。
    - **第二条连带**：配置编辑器现在会**拒绝保存**被 home patch 覆盖的行（`dsh-config-editor/lib/index.js:122`，
      `Configuration for "<id>" is overridden by a home patch or command-line overlay`）。
      它**堵住了** §7 里那条 C1（把 Obsidian 开关搬到插件 `Config`）——那条本就未拍板，现在多一条反对理由。
    - **本机现状**：`~/.dsh/cordis.patch.yml` 只有一条 `- insert:` 的 `pretooluse-guard` 行，**不覆盖任何 id**。
    - **要做的事**：属产品决策（要不要在启动时检测 home 层与插件同 id 的行并提示），已记 §7。

110. **★ 断言被"硬编码路径 + 静默跳过"变成假绿**——门禁报 `9/9`，实际动态校验**整块没跑**（2026-10-01 实测）。
    - **怎么撞上的**：两个工具套件里**唯一**调用 dsh 校验器的断言，都 gate 在
      `<DSH_HOME>/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js`。本机实测：
      `~/.dsh/profiles/node_modules/…` **False**、`…/profiles/notes-assistant/node_modules/…` **False**、
      `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js` **True**
      ⇒ `npm i -g` 装的 dsh 把内置包放在**全局安装内部**，那些断言全部 `[skip]`。
    - **为什么危险**：`output.schema` 还能过**宿主自带的**校验器，正是"宿主升级后工具契约仍成立"的**唯一动态证据**。
      一个会静默跳过的检查**无法为任何宿主版本作证** —— 与坑 98（0/0 断言 + exit 0）同族，
      但更隐蔽：套件**内部**的分块跳过不会反映到汇总的 `passed/total` 上。
    - **纪律**：① 解析路径要**按候选顺序试**（含 npm 全局安装内部），并给显式覆盖变量；
      ② 找不到时**大声 SKIP 并打印试过的路径**，不要让它看起来像通过了；③ 新变量要同步 `docs/env-vars.md`
      （那条守卫双向，本次先红了一次才补上）。
    - **修后**：`22/22` + `11/11`（修前各 `9/9` 且动态块跳过），且是拿 0.2.0-rc.2 **自己的**校验器跑的。

111. **★ JS 正则里 `$` 在无 `m` 标志时也匹配"尾随换行之前"，`replace` 会**悄悄吞掉行尾**（2026-10-01 自己踩的，症状很能骗人）。
    - **怎么撞上的**：写 `migrateRetiredPresetRow` 时用 `/^(\s*)-\s*id:\s*…['"]?\s*(\r?\n)?$/` 去匹配**仍带 `\n` 的行**。
      `$` 在 `(\r?\n)?` **之前**就匹配成功 ⇒ 那个捕获组不被消费 ⇒ `replace` 的输出**少了换行**。
      实测症状：断言 detail 打印 `renamed`（函数确实改了文件、`migrated === true`），但
      **行数从 14 变 12**（该少 1 行却少了 2 行）——只看"改没改"完全看不出来。
    - **纪律**：**在剥掉终止符的行体上匹配**（先 `line.replace(/\r?\n$/, "")`，改名后再把终止符拼回去）；
      或者给正则加 `m` 标志并让 `$` 明确落在行体末尾。任何"按行改写文件"的代码都该有一条**行数守恒**的断言。
    - **顺带**：这条同族的教训是"函数返回 true ≠ 文件正确"，所以新加的迁移测试同时断言
      **改名成功 / 丢掉失效键 / 其余逐字节保留 / 行数只少 1 / 幂等 / 相似 id 不碰**。

112. **★ dsh 的版本范围不许"顺手整理"成 `>=0.2.0` / `^0.2.0`**——在 prerelease 运行时上它**不匹配**，插件会被**静默停用**（2026-10-01 隔离实测）。
    - **机制**：兼容门禁只读 `peerDependencies` 里 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`
      （`dsh-app-boot/lib/index.js:294`），用 `semver.satisfies(…, { includePrerelease: true })` 比对（`:300`）；
      **整个 key 不存在 = 完全不检查**（`:289`）；`dsh.engines.dsh` **门禁根本不读**（全库零命中）。
    - **隔离 `DSH_HOME` 实测**：`>=0.2.0` ✗、`^0.2.0` ✗（都跳过）、`>=0.2.0-rc.2` ✓、`>=0.1.7-rc.2` ✓。
    - **失败信号很弱，必须认得**：不兼容**不会**让 dsh 非零退出 —— 它是 **exit 0 + stderr 一行**
      （`dsh: skipping profile bundle …`）**+ 组合结果被掏空**。只有 `--dump-config-schema` 会 exit 1。
      真实启动时还有**第二道更严的按行门禁**（`dsh: disabling profile plugin row …`），
      **`--dump-config` 看不到它**（dump 从不挂 Loader）。
    - **例外通道**：`dsh plugin --profile <p> allow-version <pkg>@<ver> --dsh-version <exact> --accept-risk`
      写 `<profile>/compatibility.json` 后即可放行（实测无需联网、无交互）。

113. **★ 判据"看不见自己的输入"，于是它永远发现不了它要抓的东西**——新加的"共享上游不算共证"判据**跑得通、测得过**，却**结构上不可能**命中（2026-10-01，C8）。
    - **两个同时存在的缺陷**：① 证据池条目建成 `{ rel, text }`，而判据要读候选文档的 `source`/`related`
      ⇒ `other.source` 永远是 `""`；② 计算"共享上游"用的链接访问器只读 `source`/`related`，而 `extractLinks`
      当时是 `buildAuditReport` 里的闭包 ⇒ `depends_on` 在这条路径上**根本看不见**。
    - **为什么危险**：它不会报错、不会红，只会**恒返回"没有共享上游"**——即"两层防御都不会打架"，
      而人的直觉会认为"我加了这条判据，所以它被守住了"。这正是本仓库"断言在变异下照样通过"那一族：
      **守卫看不见自己的输入**（同族：`cardRef` 少带 `uses`/`successRate` 导致 weak 自检每张卡都触发）。
    - **纪律**：加**任何**"读某字段做判断"的逻辑，先写一句**断言这个字段真的被读到了**——
      最省事的形态是**成对测例**（同源必须不升级 + 独立来源必须升级），因为只写"同源不升级"的话，
      "判据根本没跑"和"判据跑了并拒绝"给出**完全一样**的结果。
    - **顺带**：`extractLinks` 已提为模块级（两处共用同一提取，`depends_on` 一并纳入），
      证据池补 `provenanceOfDocument`。

114. **★ 收集结果的数组在"收集之前"就绑定了，于是发现被静默丢弃**（2026-10-01，C7）。
    - **形状**：`origin` 的越权声明先由 `originBlocked` 收集，`structural` 对象**稍后**才 `= { …, unauthorizedOrigin: [] }`
      ⇒ 那个空数组才是 `structural.unauthorizedOrigin`，收集到的东西**从未接上**，
      `counts.originUnauthorized` **恒为 0**、`sections.originUnauthorized` 恒为空。
    - **症状很能骗人**：卡上确实写着 `origin: user`、成员数组里确实有那条字符串，
      但报告与计数是空的——**"我明明 push 了"**。实测由新测例（断言 `counts.originUnauthorized === 1`）抓出。
    - **纪律**：**同一个事实不要有两个数组**。要么让后续结构体**引用**那个数组（现在是 `unauthorizedOrigin: originBlocked`），
      要么在结构体定义之后才收集。写完这类"收集 → 汇总"的两段式代码，**回头看一遍谁指向谁**，
      并让断言读**最终报告**里的字段（而不是读你刚 push 的那个变量）。

115. **★ `--dry-run` 在"最可能丢数据的文件"上说了反话**（2026-10-01，装 0.8.1 时踩到）。
    - **形状**：`copyFile(options, src, dst, overwrite = false)` 先判 `dryRun` 再判 `!overwrite && exists`，
      于是 dry-run 对**每一个**目标都打印 `would copy`，而真跑对已存在目标是
      `[skip] exists, preserving user edits`。**实测**（临时 vault 里预置 `profile.md`）：
      dry-run 输出 `would copy … profile.md`，真跑输出 `[skip] exists …`，文件**逐字节未变**。
    - **为什么这条特别坏**：`--dry-run` 的**唯一用途**就是让人在动手前确认"会不会覆盖我的东西"。
      它偏偏在 `profile.md`（用户画像）/ `notation.md`（记号表）/ `AGENTS.md`（协议）这几处——
      **整个安装过程里唯一有丢数据风险的文件**——给出了与真跑相反的承诺。我是**因为部署前先列了目标文件现状**
      才没被误导；只看 dry-run 会以为要覆盖 19 个文件。
    - **纪律**：**dry-run 必须与真跑走同一套判定、同一顺序**，只在"动作"那一步分叉。
      任何"预览/预演"实现都该有一条断言：**模拟与真实对同一输入的结论一致**。
      修法是把 `!overwrite && exists` 提到 `dryRun` 之前，并打印 `[dry-run] would skip`。

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
- **lemmalog（`JordyZomer/lemmalog`，Rust Datalog 记忆引擎）评估结论：不引入**（2026-10-01）。理由：**fit failure 而非质量问题**——四个彼此独立的阻断项（① 要新增一层记忆，在"不做"清单里；② 打破"vault = 唯一持久化 + 纯 Markdown、无数据库"；③ 三条安装通道**没有一条**能交付 `cargo build` 产物；④ 主用法是 MCP 服务，而 preset **刻意不挂** shell/web/subagent，够不着），每条在本仓库都有**书面决定**。它许诺的好处也已被覆盖或**有意拒绝**（传递式级联 `design.md:130` 拒绝；来源链已设计为纯 JS 的 V0–V9 计划；图检索实测 **flat > graph**）。**完整证据、成本与"若坚持要验"的唯一合理形态见 [`lemmalog-assessment-2026-10-01.md`](lemmalog-assessment-2026-10-01.md)。** ⚠️ 本行是**决策记录**：下次再提请先读该文，不要从头再评一遍。
- **dsh 版本下限保持 `>=0.1.7-rc.2`**（2026-10-01 用户拍板）：0.2.0-rc.2 已实测通过且**没有破坏性变更**，所以**不**把下限提到 0.2.0（那会把还能用的 0.1.7-rc.2 用户挡在门外）。两个 README 已写明"0.2.0-rc.2 已实测"。**反向禁止**：不要把范围"顺手整理"成 `>=0.2.0` / `^0.2.0`——在 prerelease 运行时上不匹配会让插件被静默停用（陷阱 112）。

## 6. 工作流命令

```bash
npm test                        # 455 项零 token 回归 + 62 项路由回归 + 8 项认证 + 32 项反代 + 安装器 e2e + 漂移 + 五守卫 + 文档一致性 + 中英配对 + 语法检查（= node scripts/run-gates.mjs）
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

> **本节的核实状态（2026-09-26）**：本节曾是"作者记忆里的待办"，未经逐条对照代码。本轮做了一次
> **核实 sweep**：用两个只读子代理 + 自查，要求每条给出 `file:line` 证据、计数**实测**、无法核实就写
> UNVERIFIED（不改仓库、不碰真实 vault）。**实测覆盖：未做行 38 条中已核实 32 条**，**改掉 15 处失真**
> （含 4 处"其实已完成/已解决却仍记成欠账"、5 处事实或行号过期、3 份评估文档的过期状态页眉、1 处
> **我自己上一轮引入的错误引用**、1 处**影响判断被实测推翻**（session 目录编码）、1 处决策未登记）。已核实且**仍然准确**的代表：L398（18000 上限真实）、L403（候选卡
> `uses` 自锁机制属实，`note-tools.mjs:1719-1724`）、L416（README 四项缺口仍在）、L428（`installation.md:52`
> 真有）、L430（豁免清单真实且承重）、L433（确无读者）、L455（拖拽引用有专门进展文档）。
> **仍未核实（共 6 条，缺条件而非未查）**：`真实 E2E（用户跑）`、`Obsidian 本机部署验收`（两条都是**用户动作**）、
> `侧栏性能：两项未量到的原因`、`★ 运行卡顿`（要真机长会话实测）、`检索：关系信任 + 锚点槽位`、
> `多视图 max-pool 复测`（要真实语料/探针条件）。
> **真实 vault 的绝对数字已取到一条**：预算档用新探针 `scripts/qa/probe-injection-size.mjs` 实测为
> **9318 / 10213 / 11252**（差 **1934**，不是文档里写的 1026）—— 也就是说那条"基准 vault 三档只差 1026"
> 的存疑**已解**：1026 是**同一个真实库在 2026-09-17 的旧读数**，库长大后才变成 1934，与基准 vault 无关。
> 仍未取的只剩 `note_*` 调用计数与 engine-probe 的 11/12 复现。
> **本轮新核实的 4 条**（原文准确、无需改）：`命名空间隔离`（无 `memoryRoot` 实现）、
> `settings.section i18n`（设置页 16 处 `setName` 无 i18n）、`working.md 的 500 上限`（`math-memory.mjs:4044`
> 确实 `readMemoryFile(…, 500)`，是对**整份**草稿的截断）、`（可选）3180 内嵌面板`（`main.template.js:147`
> 默认 `port: 3180`，未内嵌）。
> **`dsh session 路径编码 mojibake` 已核实并重写**（2026-09-26）：实测本机 `sessions/` 只有 2 个规范目录、
> **含 `~FFFD~` 的 0 个**（没有"编码分裂"）；且本插件给会话归因读的是**日志头行的 `cwd`**
> （`math-memory.mjs:394-405`），**不看目录名** ⇒ 原行声称的"影响跨工作区 dialogue index"**不成立**。
> 机制已写成陷阱 **101**。

| 项 | 说明 | 优先级 |
|---|---|---|
| **项目重构蓝图（2026-10-01）：前提已置换，等 7 项拍板** | 用户把前提从"**仅 Obsidian 插件 / 极低成本 / 尚未 dsh-Obsidian 解耦**"换成"**dsh 插件家族 / 成本可放宽 / 环境由用户自备、插件只声明+指引**"，并明确**现有笔记插件降级为新项目中的一个功能**，要做一次大型重构。**复审结论（有一手证据）**：`plugin-family-assessment-2026-10-01.md` 把"不调模型/不持库/不引新运行时/不做 Lean/不挂 shell"判成"产品红线、与架构无关"**是错的**——它们多数是"当初约束的产物"：成本曾是一等约束（`docs/archive/cost-benchmark-2026-08.md` 存着 17 万→2.5 万 tokens 的对照，而该文 §4 自陈**当时成本根本量不准**）；**最强的单条证据是项目自己提过又静默降级的 P0-2**（`docs/memory/assessment.md:54`「异步确定性固化流水线：turn/session 结束钩子触发独立固化 pass」→ 第 2 轮改写成同步体检，实现成跑在 preset 每轮路径上）；范围假设的原话是「**我们场景是单用户数学学习**」（`references.md:194`）。**蓝图**：[`refactor-blueprint-2026-10-01.md`](refactor-blueprint-2026-10-01.md)（§1 逐条复审 A–E 分类 + L1–L13 + 代价/验收；§3 **8 条非不变量**；§4 家族协议：能力服务契约 / 数据契约版本化（借 dsh 会话格式"一跳一个迁移包"模型）/ 第三方贡献治理 / 环境声明与指引；§5 分阶段 R0–R5+）。**决策台账**：[`pending-decisions-2026-10-01.md`](pending-decisions-2026-10-01.md)（**P1–P7**：P1 认可 L9/L10 作废 + L2/L3 拆半 + L6 前半反转 + L1 按包拆半 + L12 重写；P3 research profile 放宽程度；P4 派生索引落地为 `node:sqlite`；P5 建可复现质量/成本基准；P6 仓库形态；P7 第三方开放程度）。**未拍板不动代码** | 待决（最高） |
| **插件家族评估（2026-10-01）：四问已答完，等 8 项拍板** | 用户问：①记忆主体移入 dsh 插件后哪些被舍弃的机制变得可引入；②外部复杂工具该纳入现有插件还是另做插件再组合；③能否做成数学/统计的学习科研插件集合；④还有哪些类型的插件可做。**答：** 上移解锁的是**成本型**限制（引擎三份→一份、每轮路径→宿主侧、宿主权能），**不解锁产品红线**（⚠️ 此判断已被 `refactor-blueprint-2026-10-01.md` §1 修正）；纳入形态的判据是**四条硬边界**（数据契约所有权 / 权限姿态 / 外部依赖 / 版本 cohort），四条都不跨就**优先做 tool/skill 而不是新包**（定量理由：本仓库 54 条门禁里 **30 条**只为防跨边界漂移）；能做，但可行形态是 **1 monorepo × N 个 bundle 包 × 2–3 个 profile**（因为**权限档是闭表**，不同姿态要不同 profile），而"多个模式"应出**多个 preset 行**而非多个包。**报告**：[`plugin-family-assessment-2026-10-01.md`](plugin-family-assessment-2026-10-01.md)（§0–§8 完成）。**卡在**：该文 §8 的 **D0–D7 + N-A/N-B + L12 共 11 项需用户表态**，其 L12（"凡是要新增「每轮必做步骤」的都拒"）是**唯一同时挡掉十来项机制的总闸**；**未拍板前不动代码**。附带产出：本机外部工具链实测（Python 3.14 ✅ / TeX Live ✅ / cargo ✅ / `node:sqlite` 内置 ✅；**R ❌ / Lean ❌**） | 待决 |


| ✅ **脏记忆：来源（`origin`）+ 互证判据收紧（C7/C8，2026-10-01）** | **用户拍板 `C7=A` / `C8=A` 后落地**（机制指定为"宿主写 + 首见台账"、字段放卡片 frontmatter）。**C7**：卡片顶格 `origin`（`agent`/`user`/`imported`；缺席＝来源未知），**唯一写入者是每日体检**（`auditMaintainOrigin`），凭据进 `.deepseek/cache/card-origin.jsonl`（只追加、记 `firstSeen`＝宿主首次见到该卡的日期），越权声明进 `structural.unauthorizedOrigin`（**只报不改**）；**`origin: user` 永远进这一列**（本地无认证通道）。**不改排序**（`hookPrior` 未动）。**C8**：`findCorroboration` 的返回值改为 `{ origin, evidence, sharedWith }`，**共享 `source`/`depends_on` 出处的匹配＝相关重复、不计票**（不再升级），进 `sections.corroborationRepetitions` + 人类摘要。断言 **427 → 455**；**变异验证 2 条**（M-C8 ⇒ 4 红；M-origin-idempotence ⇒ 2 红，且第一条变异最初是绿的 ⇒ 补了"第二遍台账逐字节不变"的断言才转红）。**实现时被自己的测例抓出 3 个真缺陷**（陷阱 **113/114**）。细账见 [`changelog.md`](changelog.md)，判据见 [`memory/design.md`](memory/design.md) §5.2 / §8.6.1 | 完成 |
| **本次改动尚未装到你的 vault / profile** | 代码与生成物（`main.js`）已就绪、门禁全绿，但**部署是单独一步**（仓库纪律：`deploy-local` 不由 agent 自动跑，且本批改了插件产物）。你那边要生效需要：① 重新安装/引导（Obsidian 侧栏或 `install`）或跑既有的 deploy 脚本；② 首次体检会把老卡补上 `origin`（**一次性的批量写入，可逆**：删掉那一行即可，体检会再补）。**在此之前你的库仍是旧行为** | 等你决定何时部署 |
| ✅ **混写笔记 + 不确定标记在检索里可见（N-a / N-a′，2026-10-01）** | 用户问"如果有些笔记是 AI 和用户混写的呢（AI 在用户笔记里补全内容）？"**查档结论**：协议**早就要求**标注（`vault-AGENTS.md` §3 的 `<!-- AI 补全 -->`），真实库**确实有人在标**（`统计学/方法论/数据压缩.md`），但**三处没接上**：① `scanNoteHygiene` 的 gap 正则只数 `待补/待核对/待证明/TODO/待完成`，**不含** AI 标记 ⇒ 标了也不报；② `note_recall` 把 AI 补全段落与用户原文**同权返回**；③ 该标记只在 `scanNoteClaims`（定理索引用错章）那条窄路上被消费过。**已做**：`scanNoteHygiene` 新增 `aiMarked`/`aiMarkedTotal`（与"未闭合处"**分开报**）；`buildRecallDoc` 给 note 记 `aiCompletions` **与 `openMarkers`**，`note_recall` 把 `［AI 补全 ×N·待核对 ×M·不宜当结论］`**合并成一个**前缀到 snippet（**不能**加字段：match 项是 `additionalProperties: false`，加字段会像 2026-09-14 那样打死整次调用）；清单与人类摘要各一条，含引用规则；`vault-AGENTS.md` §3 把标记扩成读写纪律（一段一个标记、放在段落前；用户删标记＝认可，模型不得替删）。断言 **440 → 455**。**刻意不做**：不检测"未标记的补全"（语义判断、红线、必误报）。细账见 [`changelog.md`](changelog.md) | 完成 |
| ✅ **固化改成显式动作（2026-10-01，用户拍板；文献处方）** | 用户问"只加个提示会不会太单薄了，文献又指出如何改善吗" ⇒ **问对了**：`［…·不宜当结论］` 属于 P2 那一档（用记忆时降级），文献里的大头在**写路径**。**引原文**：Zhang Table 5 逐档 **43.2（就地改写）→ 50.0（append-only，旧库可见）→ 64.0 → 70.0（旧库隐藏）→ 76.6（原始轨迹）**；处方是「abstraction 应 **opt-in** 且被证据设闸，而不是每次交互后触发」。**查档发现的病灶**：写入其实**已被门控**（`capture-policy` 默认 idea/fact/preference=ask，且"每轮最多一次"），**但 `vault-AGENTS.md` §2 的"每轮按需三写"是另一套、没有闸门** ⇒ 「每轮自动固化」是模型自愿多做的，正好落在最伤那一格。**做法（两处，缺一不可）**：① 注入文本（`math-memory.mjs` 捕获策略段）新增固化闸门——**没有用户同意不写抽象层**，默认**先问**且与既有捕获提问**合并成一次**（不增加弹窗），例外仅两条（用户当场明确要求／已给长期授权）；② [`dsh/templates/vault-AGENTS.md`](../dsh/templates/vault-AGENTS.md) §2 同一规则。**为什么两处**：vault 里的 `AGENTS.md` 是安装副本，老 vault 不重装吃不到。**断言 452 → 455**（3 条钉住两处一致），**变异验证 2 条**（删注入侧 ⇒ 2 红；只改模板侧 ⇒ 1 红）。**证据边界**：该实验在程序化 benchmark 上、**未**测人类笔记混合库 ⇒ 机制可迁移、幅度不可换算；这条闸门由提示词执行（**非**确定性强制）；**未做** A/B 实测（要花钱，需用户点头） | 完成 |
| **⚠️ 用户纠正："干扰"的含义（2026-10-01）** | 我先按"排序错/挤掉别人"理解，**用户澄清**：是"当讨论相关问题时，**agent 的回复总是极大地受这篇笔记影响、每次都给出差不多的回答**"。⇒ 病因在**模型行为层（experience-following）**，不在检索层。新增只读探针 [`scripts/qa/note-interference-probe.mjs`](../scripts/qa/note-interference-probe.mjs)，它实测**支持**这个判断：目标笔记在 **5/5 相关查询** rank 1–2（最高 0.93）、**0/5 无关查询**侵入 top-8 ⇒ **排序是准的**。于是修法改到"给那篇笔记加临时标记"（见上一条的 `openMarkers` / `不宜当结论`）。**仍未解决的部分**：那篇笔记本质是**逐次追加型活文档**（947 行 / 61K 字符 / 11 处 AI 补全 / 14 处待核对；`§3.6/§3.7/§2.7/§1.6/§2.1.1` 全是过去讨论的存档，标题里就写着"增补/附/错在哪"），把"讨论存档"与"可引用的知识"分开才是根治——**我没有动用户的笔记**，等用户决定 | 待用户拍板（拆分） |
| ✅ **用户负担探针（2026-10-01）** | 用户提出一条产品原则："**尽可能减少用户自行维护整理的麻烦工作，让用户专注思考**"。落成可判定判据：**凡是能从文件系统确定性推出的事实，系统不得要求用户报告或维护**；只有"只有用户知道的偏好/意图"才允许问。新增只读零 token 探针 [`scripts/qa/user-burden-probe.mjs`](../scripts/qa/user-burden-probe.mjs)（不写任何文件、无样本时如实说"没样本"）。**真实库实测（`D:\Obsidian笔记数据库`）**：`user-confirmed` **0/5**、`success_rate`/`gain`/`harmed` **0/5**、`needs_review` **0/5** ⇒ 三条用户配额**全部 DEAD**；`origin` 0/5（尚未部署本批）；卡内 AI 补全标记 0 处（笔记里有 3 处）。检索侧被动信号：`retrieval-stats.json` 累计 **calls=7 / empty=0**，**67 个不同卡路径**有过命中记录（≈ 每次召回 top-k 命中一批） | 完成（探针）；原则待入档 |
| **⚠️ 会话日志样本的真实状态（2026-10-01 查实，**不要再被"0 次"误导**）** | ① **活着的** `~\.dsh\sessions`（45 个日志）里 `note_recall` 调用 **0 次**——但这**不能**当作"插件没用过"，因为 **`$DSH_HOME` 被整体清空过四次**（第一次 2026-09-25 就丢掉了全部会话日志，见 [`HANDOFF-删库与防灾.md`](../../HANDOFF-删库与防灾.md) §2）。② 备份里有可恢复的会话数据：`E:\backups\dsh-state\*`（15 分钟一档）与 `dsh-home\*` 共 **104 个备份点、去重后 116 个可解日志**，其上扫描结果 = **`note_recall` 1 次**（`query="高等数理统计1 笔记内容 讲了什么"`）。③ 但那些日志的标题显示绝大部分是**仓库维护/事故取证/功能测试**会话，不是用户的笔记会话 ⇒ **这批数据不足以度量"结局"**。**结论**：C9-A′ 的"暴露 → 被读 → 被引用"要等插件在真实笔记会话里跑起来、并部署本批（`origin`）之后才有样本；在那之前**不要**为 7 次调用建重型度量 | 记录事实 |
| **⚠️ `user-confirmed` 自动推断**（原计划第 2 步）**前提不成立，已改口** | 原计划：卡的模式出现在用户**之后**写的笔记里 ⇒ 视为确认。**真实库实测否决了两条前提**：① **106 篇笔记里带 `updated` 字段的是 0 篇** ⇒ 没有"之后"可比；② 5 张卡的 `hook.pattern` 是**下划线分词式内部标识**（`exchangeable_sequence_de_finetti`、`resolution_floor_order`），在 106 篇笔记里**命中 0 次**；放宽到自然语言主题词才有命中（充分统计量 6 篇、单调 8 篇、耦合 3 篇）——而**主题共现恰恰是 Louck T1 点名的那种"内容派生可信度"**，不能用来提到最高等级。**可行的降级方向**：① 继续走"**从行为读**"（C9-A′，需要真实笔记会话样本）；② 加一条**已有的**被动确认路线：用户自己的笔记里**链接到某张卡**（wikilink，`[[卡名]]`）＝主动引用过 ⇒ 视为确认——今天真实库 **0 次**（没人链过卡），零摩擦但是冷启动；③ 若接受"模型为用户记一条锚"（写进 episode/notes-index，模型维护、带日期），时间前提才成立，但要用户拍板 | 待用户拍板 |
| **C9 需要重新设计（用户反馈 + 实测，2026-10-01）** | 用户原话：「✅/❌ 我一直没用过，作用不明晰、判断起来太麻烦」。**只读核实支持这句**：真实库 **65 个记忆层文件里 `success_rate`/`gain`/`harmed`/`needs_review`/`verified_by` 一次都没被写过**（命中的全是各层 `_README.md` 的说明文字）⇒ 字段全在默认值、`weak` 段恒空、晋升门 `success_rate ≥ 0.6` **永远不可能满足**。⇒ **C9 原方案（把 ✅/❌ 回填到暴露记录）建立在一个从未产生的信号上**，不能照做。**重设计方向 = C9-A′**（记四层：暴露 → 是否被读 → 是否被引用 → 用户有没有明说不满；先只报告），已登记 [`pending-decisions-2026-09-26.md`](pending-decisions-2026-09-26.md) §3.1 | 待用户拍板 |
| **C10 仍未拍板** | **固化输入隔离 A/B**：写记录那一轮不把旧抽象索引注入上下文（Zhang Table 5：旧库可见 50.0 vs 隐藏 70.0）。未动代码；文献 §8 排在顺序 4 | 待用户拍板 |
| ✅ **dsh 0.2.0-rc.2 适配：审计完成 + 三处收口（2026-10-01）** | **没有发现破坏性变更**（逐接口核对：`ctx.fs` 8 处用法 / `ctx.tools.register` / `system-prompt/assemble` / `settings.section` / `ctx.webServer` / `ctx.workspaceRegistry` / `!!js` 方言 / bundle 通道全部还在；profile 的 5 条 patch 行 id 全部仍命中，`--dump-config` exit 0 且**零 `not found` 警告**；依赖面**只增不减**）。三处收口：① **工具 schema 的动态校验此前是假绿**（两个套件硬编码的 `dsh-tools` 路径在 `npm i -g` 的机器上不存在 ⇒ 断言整块跳过、汇总仍报 `9/9`）→ 新增共享解析器 + `DSH_TOOLS_PATH`，修后 **22/22 + 11/11**，拿 0.2.0-rc.2 **自己的**校验器跑；② **posture 契约拆分**（安装器私有 vs 共享 `package.json`/`cordis.yml`/`cordis.patch.yml`）⇒ 门禁 53 由 **23/24 → 24/24**，且**不用重装**；③ **迁移已死的 `agent-presets` 行**（0.2.0 全库零命中，patch 匹配不到只 warn 并跳过 ⇒ 默认 preset 静默丢失）。**变异验证 4 条**，均实测报红 + 恢复字节级一致。详见 [`dsh-0.2.0-adaptation.md`](dsh-0.2.0-adaptation.md)；陷阱 **108–112** | 完成 |
| **home 层 patch 与插件同 id 的检测** | 0.2.0 起 `$DSH_HOME/cordis.patch.yml` **压过** profile 自己的层（陷阱 109）。插件把 `permission`/`approval`/`sandbox-policy`/`fs-sandbox` 写在 profile 层，用户若在 home 层写同名 id 就会**静默覆盖**它们（沙箱/审批边界被无声改写），而没有任何东西会报错。本机 home 层只有一条 `- insert:` 的 guard 行，**当前无冲突**。**要做的事**：在插件启动（或安装）时检测"home 层是否有与插件 posture 同 id 的行"，有则打印一条**点名**的提示（不要自动改用户的 home 层）。**属产品决策**（要不要做、提示到什么程度） | 中 |
| **`defaultPreset: math-memory-locked` 成了启动检查的唯一支点** | 0.2.0 的 `dsh-base/cordis.patch.yml:248` 把 approval 默认值写成 `danger-full-access ? 'never' : 'ask'`，与插件 profile 层的表达式**相反**。插件层赢，且"组合出的沙箱/审批默认值必须命中某个 preset"这条启动检查（`dsh-permission-presets/lib/index.js:178-181`）目前**只靠** `defaultPreset: math-memory-locked` 通过。**若哪天去掉它，profile 会起不来**。可选修法：给 preset 表补一行与插件表达式相反映射匹配的条目。**改安全相关配置需单独拍板**，本轮只记录 | 低（有触发条件） |
| **工具套件的"宿主校验器"覆盖** | ✅ 已修（2026-10-01，见上表第一行）：此前两个套件的动态校验**整块跳过**而汇总报 `9/9`（陷阱 110）。现在按候选顺序解析 `dsh-tools`（含 **npm 全局安装内部**），找不到就大声 SKIP 并打印试过的路径。**仍未做**：套件**内部**的分块跳过**不反映**到 `run-gates.mjs` 的三态汇总上（汇总只区分整套 SKIP）——若要根治，得让套件把 `__SKIP__` 提升为醒目信号或让汇总解析 `(N skipped)` | 低 |

| ✅ **A′（离线通道包化）S1–S5 已落地（2026-09-26）** | 用户最初的问题"插件为什么不出现在 dsh 插件管理页"的**根治**：离线通道现在会先把本插件**物化成一个真包**，再 `dsh plugin add file:<本地目录>`（**不联网**）⇒ 那条通道装出来的插件**也出现在管理页**、可启用/禁用/移除。**S1** 物化模块（清单从宿主入口 import 闭包 ∪ 契约体文件 ∪ 声明的 extras **派生**）；**S2** 证物化包**能被真 dsh 冷启动**（10/10）；**S3** overlay 按"本包是否已登记"删掉包已提供的那两行（fail-safe；`client-panel` 行**必须**留下）+ host 守卫认得本地 bundle；**S4** 接线（判据是**文件系统**不是退出码、owner **最后**翻转、失败**回落平铺并明说**、`--flat` 强制旧形态）；**S5** 迁移三方向（升级 / 中断自愈 / 反向切换）实测。守卫：新门禁 `check: overlay drops bundle-owned rows`（22 条）+ `test-installer` 新增 29 条；变异验证共 **9 条**。⚠️ **S3 的一条前提被实测推翻**（见陷阱 102）。⚠️ **Obsidian 插件引导那半仍是纯平铺** —— 见下一条 | 完成（S1–S5） |
| ✅ **A′ 的 Obsidian 半个（机会式包化）已落地（2026-09-26）** | 侧栏那条安装路径现在**也会先把本插件物化成一个真包**再 `dsh plugin add file:<本地目录>`（不联网），因此**侧栏装出来的插件同样出现在 dsh 的「插件」页**。与 CLI 同一序：物化 → add → **按文件系统核验**（不看退出码）→ **最后**翻转 `owner: npm` + `bundleSource: local`；失败 ⇒ 打印**具体原因**、**回滚登记**、回落平铺。客户端半个（`install-into-profile.mjs`）仍单独装 —— 它不在 bundle 的 patch 里。门禁 `check: plugin rebuilds a wiped $DSH_HOME` **22 → 40 条**，含一条**端到端**（真 `dsh plugin add`：断言 `bundles` 含本包、16 个文件落盘、overlay 剥行但保留 client-panel 行）。变异验证 2 条：计划退回"只含 import 闭包" ⇒ **7 红**；核验退回 `exit code == 0` ⇒ **4 红**。**实现要点**：模板不能 `import`，所以构建期从**与 CLI 同一个** `localBundleSourceFiles()` 派生"按包内路径编键"的两半计划注入；**不要**把 16 个文件全塞进 payload（第一版这么做，`main.js` 780 KB → 1.28 MB），只补现有键装不下的 9 个（24 KB）⇒ 814 KB。⚠️ **两个实测抓到的坑**：① 物化清单**必须**是完整计划，**不能**只用 import 闭包 —— 否则 7 个没人 import 的文件（首当其冲 `dsh/cordis.patch.yml`）被静默丢掉，`dsh plugin add` 报 `failed to read overlay … ENOENT` 并整体回滚；② 核验失败但登记成功时**必须回滚登记**，否则 profile 半迁移（manifest 说 direct、bundles 里有我们、overlay 已剥）。设置里 `bundleInstall: false` 可退回纯平铺，等价于 CLI 的 `--flat` | 完成 |
| **文献研读驱动的改进（第一批：治理闭环）** | ✅ 已交付（2026-09-17）：字段所有权表（`design.md` §5.1）+ `hookPrior` 脏值免疫；`status` 即权限（`note_strategy` 分流 candidates）；疑似重复**按相似度排序** + 结构枢纽保护；`depends_on` 有向依据链 + 体检「下游待复查」级联；`hook.gain` 净增益（只由显式 ✅/❌ 推出，负值压到未评级卡之下）。断言 240 → 266，每项做过变异验证。**增量回执符号（`+ ~ ! ⚠`）有意延后**——理由见 `literature/notes/improvement-details-2026-09-17.md` 第 5 项 | 完成（1 项延后） |
| **文献研读驱动的改进（第二批：技能治理与度量）** | ✅ 已交付（2026-09-17）：跨场合支持计数（数据层）、晋升的**接地门**（候选无 `source` 不晋升并点名）、**拒绝即收窄适用边界**、`decision_guidance`（建议/避免成对）、探针 §3 `Avg-R`、文献库索引显示真实状态 + 陈旧提醒。断言 → 290。**两处主动否决并写明理由**：跨场合门不用于策略卡晋升（计数按 record 的 techniques+source 算，不描述该卡）、探针双场景对照（两套用例集不可比） | 完成（2 项否决） |
| **文献研读驱动的改进（第三批：预算与协议）** | ✅ 已交付（2026-09-17）：注入预算档位 `compact/standard/rich`（preset 配置 + **设置页下拉框**，走库内 `.deepseek/config.md`；优先级 显式 preset > 库内 > standard）；检索分层**只补协议文本** | 完成 |
| **预算档位对注入体积的实际影响** | **2026-09-26 在真实库（`D:\Obsidian笔记数据库`）用新探针重测，原数字已过期**：真实库三档注入 **9318 / 10213 / 11252** 字符（硬上限 **18000** 不变），档间**总差 1934**。原文写的 **7864 / 8250 / 8890（差 1026）是 2026-09-17 的读数** —— 库长大之后差别**翻了一倍**，所以"三档几乎无差别"该改成"**仍远未接近上限，但档位已开始有实际差别**"（rich 也还有 6748 余量，**没有任何一档触到上限**）。**超预算的层有两层，不止原文说的那一层**：`episodes/index.md` **2647 vs 1200**（超 1447）、`records/index.md` **840 vs 800**（超 40）；其余都装得下（topics 1197/1800、profile 1987/4000、templates 135/600）。⇒ 档位仍是"库再大/时间线更长才真正起作用"的旋钮。⚠️ **绝对数字随库内容漂移，别只写不重测**：重跑用 `node scripts/qa/probe-injection-size.mjs --vault <路径>`（**零 token、只读**，从源码提取 `BUDGET_TIERS`/`MAX_*`，不给默认 vault 以免在别的机器上静默测错）。写新数字时**带上读数日期与库**，否则又是一处"数据型断言"（见 `AGENTS.md` §6） | 观察，无需动作 |
| **审计里每张 hook 卡多读一遍文件** | 定性结论成立：`writeGain(true)` 确实给每张 hook 卡**多加一次** `readFileSync`（那次在 `math-memory.mjs:2359`）。⚠️ **但原文的三个数字/变量都错了，已按仪表化实测更正（2026-09-26）**：① "现 3 次"不成立 —— 在基准 vault 副本上仪表化 `buildAuditReport`，hook 卡（`records/rec-convergence-strengthening.md`、`templates/tpl-convergence.md`）各被读 **5 次**（源行 **2268 / 1286（经 2408 调 `syncHookStatsToCard`）/ 2359（writeGain）/ 2520 / 2575**）；默认开 `maintainHookStats` 才有 5 次，"3 次"只在关掉统计时成立。② "此前 2 次"也不对 —— 在 `writeGain` 之前的那版（`53d99d2^`）审计早已≥3 次。③ 修法里的 `cardEntries` **是 `dsh/host/memory-admin.mjs:832` 的变量，不在 `buildAuditReport` 里**（`math-memory.mjs` 内 0 命中）。修正后的修法：让 `writeGain` **复用 2268 那次已读的文本**。每日一次、卡片百级，非热路径 | 低 |
| **门禁总数不能手写** | ✅ 已修（2026-09-18）：`AGENTS.md` §4 曾写「本机当前 34/34」而门禁已增长到 **41**。现改为写**注册总数**（由 `scripts/lib/gates.mjs` 派生，`run-gates.mjs` 与 `check-doc-counts.mjs` 共用同一份清单），由守卫比对；**"本机跑绿几条"不再写进文档**——那是环境结果（本机常有两三条因沙箱/无头浏览器而红或 SKIP），钉在文档里只会制造假漂移 | 完成 |
| **成本基准（单题 17 万 → 2.5 万 tokens）已存档** | ✅ 已归档（2026-09-18，用户决定「目前不需要它」）：该数字是**一道题的一次实测**，没有脚本/用例/baseline 绑定它。已从**两个 README 的验收记录**移除（那是活跃声明），原文与证据边界存进 `docs/archive/cost-benchmark-2026-08.md`，`docs/promotion/推文-0.7.1.md` 保留原文并加状态横幅。**顺带查清它背后的旧账并记成陷阱 82**（当时 E2E 的 token 计量恒为 0）——**要恢复**需按存档 §5 重建测量：固定用例 + 可重跑对照 + 修好 token 计量 + 报分布 + 让守卫真的消费 baseline | 完成（已停用口径） |
| **陷阱条数的引用会腐烂** | ✅ 已修（2026-09-18）：`AGENTS.md` §1/§6 曾长期写着「69 条历史陷阱」而实际已到 **81**。本轮不再手写数字，改为**机器可读的单一事实源**——`docs/handoff.md` §4 顶部一行 `> 陷阱条数：N`，由新门禁 `scripts/check-doc-counts.mjs` 从本节编号数出真值并比对（含"编号必须 1..N 无重无缺"）。加陷阱时只改那一行，守卫会告诉你还有哪份文档没同步 | 完成 |
| **note 工具族的使用程度与候选卡「自锁」** | **观察中，暂不动代码（2026-09-20 用户决定）**。真实 vault 全量会话（同目录 v2/v3 只取 v3）的 `note_*` 调用：`note_recall` **13**、`note_create` **4**、`note_strategy` **1**、`note_links` **1**（对照 `read` 94 / `edit` 63 / `grep` 20）。**结构上正常的部分**：这四者是「一个宽入口 + 三个条件分支」，`note_strategy` 只在证明/构造类问题起手、`note_links` 只在顺链扩读、`note_create` 在「能编辑已有笔记就不新建」下天然低——低调用数不等于低价值，它们的价值是**提前收窄上下文**。**查出的一处真缺口（未修）**：候选策略卡只会出现在 `note_strategy` 的 `candidates` 桶（按设计"不得当已验证技巧引用"），而用量统计只记 `matches` 桶（`note-tools.mjs:1724` 用 `top`）；`note_recall` 那边又只对**带 `hook:` 块的卡**记命中 ⇒ **一张没有 hook 块的候选卡，被检索多少次 `uses` 都不会涨**，永远达不成 `uses ≥ 3` 的晋升门（`strategy-layer.md` §7.2 声称"每日体检统计 uses"）。实证：真实 vault 唯一方法卡 `strat-ot-structure-proof` 为 `status: candidate` + `uses: 0`，`note_strategy` 查询它时只落进 candidates、matches 为空桶。**未修的理由**：样本太薄——1 次调用、1 张卡、0 张模板卡，**据此定"候选该不该计入 uses"会把噪声当信号**（该不该计、计成什么语义，都还没有真实使用撑腰）。**重新审视的条件（满足其一）**：① 方法卡或候选卡数量明显增长；② 出现"候选卡实际被采用、但无法被标记/晋升"的实例；③ 用户主动发起策略层内容建设（那是 1.0 缺口③「技巧的调用体系」的入口）。另记：`note_recall` 的 13 次调用**参数永远只有 `query`**——`tag` / `operator` / `includeArchived` 从未被真实使用（零 token 探针里有覆盖，所以先当作"未被用到的能力"观察，不删） | 观察中（有判据与复查条件） |

| **记忆纠错与确定性自维护（self-correction.md）** | ✅ 已实现（0.7.2）：P1 纠错进检索三件套（superseded/duplicate_of 排除 / wrong 降 verified+封顶 0.35 / hookPrior 权重 0.15）+ P2 待重审清单 + P3 低效用卡自动归档（默认 off，`autoArchive` 开关）+ P4 duplicate_of 标记 + P5 strategy 统一生命周期；回归 90→104 | 完成 |
| **自动保存对话（obelisk-comparison.md）** | ✅ 已实现（0.7.3）：整场对话（不含思考）确定性写进 episodes（尾截断 + seq 增量续接 + vault 过滤 + `sessionCapture` 当时默认开；**0.7.4 起改为默认关**——见 §5 决策记录）+ 双面板「自动保存对话」开关 /「立即保存对话」按钮 /「N 个未保存」角标 | 完成 |
| **策略层（方法层 + 工作记忆 + iterative retrieval）** | ✅ 已实现（`strategy-layer.md`：strategy 模板 + note_strategy + working.md 注入 + AGENTS.md 路由） | 完成 |
| **基准测试（benchmark.md）** | ✅ 已实现并实测：仿真 vault + seed-probe（零 token，8/8）+ benchmark-cases（8 维度）+ baseline.json + session log 归档；基线在 `scripts/qa/runs/run-*/`。⚠️ **真实 token E2E 的 8 用例套件从未一次性全绿**：唯一一次完整运行的 baseline 是 **7/8**，其中 1 个失败用例随后被单独重跑成 1/1——所以"8/8 通过"曾经是不成立的表述，已于 2026-09-11 更正（见 §7） | 完成 |
| **3 类陷阱压力样例进引擎探针** | 造 Cognitive Bias / Task Boundary / Trauma 的数学版 ground-truth 进 `scripts/qa/engine-probe.mjs`（需绑定真实 vault，vault 内容变化时同步维护） | 中 |
| **「记忆诱发退化」被动信号** | 有/无记忆对照的答案质量（LLM-judge 打分）作为体检的「固定/扭曲」健康指标（需接 judge，可选增强） | 低 |
| **note_recall 结构化适用性字段** | 现为 prompt 提醒（描述 + 渲染），可升级为返回可判定的「适用性」弱信号（如跨 operator/主题命中标注） | 低 |
| **真实 E2E（用户跑）** | `npm run qa:e2e` 需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN（真实 JS 入口）+ 模型余额；本轮已诊断「profile 缺失已装 + OOM 已降 4G + cause 日志」，留用户跑 | 高（发布前） |
| **Obsidian 本机部署验收** | `deploy-local` 后用户在 Obsidian reload + 命令「在 dsh web 打开记忆面板」实测打开 3080 面板 | 高（发布前） |
| **dsh session 路径编码 mojibake** | ⚠️ **本行已按实测重写（2026-09-26）** —— 原文说的"编码分裂（正确 vs 乱码并存），**影响跨工作区 dialogue index**"**不成立**。**为什么影响不到**：本插件给会话归因**不看目录名**，而是读会话日志头行的 `cwd` 再 `pathInside(root, cwd)`（`dsh/preset/math-memory.mjs:394-405 isVaultSessionLog`，头行字段见 `:399-402`）⇒ 归档/索引的归属由**日志自述的 cwd** 决定，目录名怎么编码都不影响；而且即便真出现两个目录，`selectAuthoritativeLogs` 按 `sessionLogKey`（会话 id）去重，同一个会话也不会被计两次。**本机现状（只读实测）**：`$DSH_HOME/sessions/` 只有 **2 个**项目目录、命名规范、**含 `~FFFD~` 的 0 个**（`--C-Users-~5C0F~65B0air15-Documents-…--` 与 `--E-software-ss-Deepseek-Harness--`），**没有分裂**。**编码方案本身**（读 dsh 源码确认，`@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js:875-894 projectKey`）：`/ \ :` → 单个 `-`；`[A-Za-z0-9._-]` 原样；**其余字符**（含中文、`~`）→ `~` + 该字符 `charCodeAt().toString(16)` 大写补足 4 位（`小`→`~5C0F~`、`新`→`~65B0~`）；再包成 `--…--` 并**截断到 251 字符**。⚠️ 源码注释明写**截断与分隔符替换是有损的**（`:870-871`）⇒ 两个很长的项目路径可能**共用**一个目录；但仍不影响本插件（归因看 cwd）。**仍然真实存在的是上游那条崩溃**（陷阱 18）：`sessions/` 里若真出现含 `~FFFD~` 的目录，dsh 0.1.1-rc.2 会在 session identity 校验时报 `corrupt session log` 并 boot 失败；本插件的扫描对读不了的目录是 `try/catch` 跳过、不会因此崩 | 中（上游问题；本插件的归因路径已证明不受影响） |
| **vault 里 `strategy/strat-ot-structure-proof.md` 的两行游离 `uses: 0`** | ✅ 已于 2026-09-10 清理（用户批准，最小 diff 只删这两行）。它是"写入器曾把字段写到 frontmatter 之外"的物证，`summaryOf` 的记账行过滤仍然保留作为同类脏数据的兜底 | 完成 |
| **1.0 之前缺的东西（README 已写明的定位缺口）** | ① 理解状态与卡点（现在只记"问过什么/结论是什么"）；② **技巧的调用体系**（何时用哪条、适用边界怎么判、失败后换哪条、几条如何组合）——现在只有存储与检索；③ 主动教学闭环（诊断→提示→检验→复盘的长期档案）；④ 复习调度（间隔重复）。这四项才是 1.0 的定义 | 高（方向） |
| **反馈无 hook 块自动补块** | ✅ 已实现（0.7.5）：`ensureHookBlock` 自动补最小 `hook:` 块，两个面板的 ✅/❌ 对所有卡可用；行内 flow 写法明确拒绝 | 完成 |
| **Obsidian 插件自动化测试** | ✅ 已修（2026-09-11，第七轮）：`MemoryView` 的四个**纯**决策方法（`layerEntries` / `pendingItems` / `cardMeta` / `trendText`）已由 `scripts/test-panel-present.mjs` 覆盖（20 项，从 `main.template.js` 源码文本提取求值，接缝挪走即报错）；**测试当场抓到一个真实缺陷**（可选字段的 `!== ''` 守卫让 `undefined` 漏过去，渲染出 `上次 undefined`）。**仍未覆盖**：DOM 调用（`createDiv`/`createEl`）、Obsidian API 交互、`DshWebProxy` / `DshService` / 设置页。要覆盖那些需要假 Obsidian + DOM stub（或把逻辑继续往纯函数上搬） | 完成（余下见说明） |
| **可维护性审查落地（docs/maintainability-review-2026-09-11.md）** | ✅ 已修（**五轮**）：① 面板未配置约束根 → 拒绝（P0-0，变异验证）；② 仓库根 `AGENTS.md` + 模板源改名 `vault-AGENTS.md` 消除自动注入（P0-1）；③ 验证链可信化——`run-node.mjs`（fd 捕获）+ `run-gates.mjs`（全跑汇总）+ doc-consistency 三态 + 计数自数（P0-2）；④ 双份实现守卫 `check-engine-sync.mjs`（**22** 个共享符号：16 同步 / 6 条有记录的偏离）（P0-3）；⑤ `client.js` 新鲜度门禁（P1-4）；⑥ 文档事实修正（capture-policy 默认关、strategy-layer 状态、版本横幅）（P1-1/P1-2）；⑦ 探针环境变量优先级与产品对齐（P1-8）；⑧ 嵌入清单完备性门禁 + `main.js` 本地新鲜度门禁（P2-10）；⑨ 面板路由补测（P2-9，44 → 现 **47** 项）；⑩ `AUDIT_SCHEMA_VERSION` 读侧真正生效（P2-5）+ 捕获路径三处静默失败改为 `warnings`（P2-7）+ 死代码删除 + `pathInside` 两引擎同名（P2-6 第一项）；⑪ frontmatter 边界规则单一化 + 行为等价门禁（P1-6）；⑫ 全仓文档漂移排查（产品名 `dsh web ui` → `dsh web`、遗留 `pathIsInside`、错误的 Phase 4 横幅、过期的适配状态）+ `check-rename.mjs` 第二条改名守卫（P2-4）；⑬ `CHANGELOG.md` 的 `[0.7.5]` 节重编（只留「修了什么/改了什么」，排查叙述移入 `docs/changelog.md`）；⑭ 环境变量单一参考 `docs/env-vars.md` + 双向守卫 `check-env-vars.mjs`（P2-8）；⑮ 发布面钉住 + 本机路径扫描 `check-release-paths.mjs`（P2-2，先证伪"值不值得修"再设防）；⑯ 反馈 token 半途改名的收尾（两侧同序 + 插件双注入 + 3 项回归）；⑰ 用户可见面的示例 vault 路径（P2-2 的第二半）、语义常量锚到代码（P2-1）、基准验收声明对齐证据（P2-11）；⑱ 呈现层首次有自动化测试（P1-3，且当场抓到 `上次 undefined`）。门禁 **33/33**。台账见 `docs/maintainability-fixes-2026-09-11.md` | 完成（余项见下） |
| **frontmatter 六个各自为政的解析器（P1-6）** | ✅ 已修（2026-09-11）：那个划边界的正则原本复制 **15 处**（`math-memory.mjs` 12 / `memory-admin.mjs` 1 / `note-tools.mjs` 2），现全部归零，规则收进 `dsh/preset/hook-frontmatter.mjs`。宿主树**不能** import 它（插件用 `new Function` 注入绑定），故保留一份拷贝并由新门禁 `check-frontmatter-source.mjs` 做**行为等价**校验（13 fixture）；另把「hook 解析器在插件里还能用吗」补进 `check-embedded-loader.mjs`（此前零覆盖）。`npm test` **29/29** | 完成 |
| **host 与 preset 的 `frontmatterSpan` 仍是两份** | 上一条的**有意**残留。⚠️ **这里的理由已被更正（2026-09-26，两个独立审计都指出）**：原文写"`memory-admin.mjs` 那份**因 loader 注入契约而无法删除**" —— **这个前提已经不成立**。`dsh/preset/engine-shared.mjs:3-14` 自己就写明"两个引擎不能共享 import"的前提**已随 0.1.7 作废**（扁平 `.agent-presets/` 被移除），而"规范实现 + 同名 re-export shim + 按 basename 内嵌"这套手法**在三处都能解析**，且已经在用：`dsh/host/memory-admin.mjs:17` 就从 `./engine-shared.mjs` 导入（走 `dsh/host/engine-shared.mjs:6` 的 shim），`obsidian/main.template.js:88/93` 也已经把 preset 拥有的模块**拼接进同一个 body**。所以准确说法是：**机械上可合并**（把 span 助手搬进已拼接的 `engine-shared.mjs`、扩 host shim、改 `check-frontmatter-source.mjs` 的 CANONICAL）——只是现在判断**不值得**（收益少 8 行，风险是动到行为等价门禁的基准）；不是"不能删"。现状有行为等价门禁兜着（`check-frontmatter-source.mjs`：13 fixture 比对 span 三元组 + `replaceFrontmatter`，实跑 exit 0） | 不做（理由已更正） |
| **3080 记忆面板"加载失败：Unexpected end of JSON input"** | ✅ 已修（2026-09-26）。**空体 404 长得像 JSON 解析 bug，其实是路由没挂**：宿主半 `dsh/host/index.mjs` 的通道归属守卫读到 **home 级退役标记** `$DSH_HOME/.agent-presets/notes-assistant/.owner.json`（写着 `owner: direct`）⇒ 判定 `web` profile "归 direct 通道" ⇒ `skipping bundle activation`（面板路由与工作区注册全跳过）；preset 由 bundle 补丁声明、不走这道守卫，所以模式照常出现、症状看着像面板 bug。两处修：① 退役标记**只在"被问的 profile 就是该 preset 自己的 profile"时**才读（`channel-owner.mjs`）；② `nativeInstall()` 也写 profile 自己的 `.install-manifest.json`（owner=npm）。守卫 `test-channel-owner` 14→18（含两条**运行时**用例）+ **变异 M25**（打回旧逻辑 ⇒ 4 条红并原样打印根因句）。**仍未做**：无（客户端那半当天已修：新增 `dsh/client-panel/src/http-json.mjs` 的 `readJson`，6 个调用点全部改用它并带中文语境标签 ⇒ 空体 404 现在报 `HTTP 404：空响应 —— 路由可能没挂上（宿主半个没激活？）`；守卫 `check-client-package-layout` 增 6 条 + 变异 **M26**） |
| **主 dsh web（3080）里没有笔记助手模式与记忆面板（"两侧通用"）** | ✅ 已修（2026-09-26）。根因是**安装范围**：引擎/preset/面板宿主路由来自我们的 **bundle**，客户端半个由 `installClientIntoProfile()` 单独装，而后者①硬要求 `notes-assistant.patch.yml`（`web` 启动时不读它）②`nativeInstall()` 路径**从不调用**它。三处修法：挂行改成"落在该 profile 真正会读的层"（无 overlay 时插进 profile 自己的 `cordis.patch.yml`，幂等）；native 路径也装客户端半个；**并修掉一个会炸的重复注册**——`web` 装 bundle 后有两个真宿主半个都会注册 `/memory-panel/*` ⇒ 重启即 `duplicate prefix route`，判据补上"bundle 已在 `node_modules` 里"也算已有真宿主（客户端包改写空宿主半）。守卫：`check-client-package-layout` 增分支 3/4 + 变异 **M24**；实机装配 `web` profile 校验通过。**"仍未做"已撤回**（2026-09-26 二次审计）：native 通道**确实会**装客户端半个 —— `node dsh/install.mjs install --profile web` 即可开启 3080 的面板与模式；**刻意保留的**只是"Obsidian 插件引导不去改用户的 `web`"。⚠️ 当时还写着"已发布的 0.7.8 是 0.1.7 适配前的形态，要等下一版"——**该前提已随 0.8.0 发布消失**（2026-09-27 推 tag，见下方发版记录） |
| **面板 token 的"最后一公里"** | ✅ 已修（2026-09-26）：改名那轮只保证了**两侧读同一个名字**，但**客户端半个压根不发送** token——它跑在被代理的 dsh web 前端里，不可能知道每次插件加载随机生成的 `DSH_MATH_MEMORY_FEEDBACK_TOKEN` ⇒ 侧栏面板的每一次 `/memory-panel/*` 都是 403（`forbidden: bad or missing token`）。同一个 403 还让 `/memory-panel/workspaces` 恒为空，于是「笔记 vault」从**下拉静默退化**成自由文本框。修法：代理在 `upstreamOptions()` 里对 `/memory-panel/*` 盖 `x-dsh-token`（密钥不进 URL、不进页面 JS，客户端半个零改动）；路径判定抽成 `isMemoryPanelPath()`。守卫：`test-panel-routes.mjs` 47 → **53** 项（行为侧 + 产物级断言，先剥整行注释；**变异 M20**：注释掉注入 ⇒ 53→52 恰好一条红）。**"仍未做"已撤回**（2026-09-26 二次审计）：`web` profile 的客户端半个由 `node dsh/install.mjs install --profile web` 装上（native 通道会调 `installClientIntoProfile`，见第 411/444 行），所以那已经不是缺口；设置页里配 URL 的老路**仍然可用**，但不再是唯一路径 | 完成 |
| **反馈 token 的改名** | ✅ 已完成（2026-09-11，第五轮）：原先 preset 读「新 ?? 旧」而面板**只读旧名** ⇒ 无论插件注入哪个名字，总有一侧看不见它。现在**两侧读同一对、同一顺序**，且 **Obsidian 插件同时注入两个名字**（插件与 npm 包可分别升级，只发新名会打断旧消费者）。回归新增 3 项（新名单独生效 / 只设新名时被强制 / **两个都设时新名优先**，`test-panel-routes.mjs` §4b）；**变异验证**：把面板改回只读旧名 → 2 项失败并报 `{"newName":403,"oldName":200}`（顺序被反转，正是要防的形态）。注：3 项里有 1 项（"新名单独被接受"）在旧代码下也通过，**不承重**，承重的是另外两项 | 完成 |
| **环境变量参考（P2-8）** | ✅ 已修（2026-09-11）：新增 `docs/env-vars.md`（**11 个 `DSH_*`** + 4 个平台/开发变量的唯一参考，含三对别名的优先级、死开关、已知缺口）+ `scripts/check-env-vars.mjs`（第 **30** 个门禁，**双向**核对，含"死开关不得被读"的反向规则；三项变异验证）。清单由脚本**从代码提取**，不凭记忆 | 完成 |
| **三份评估与决策清单（2026-09-26）** | **提案 / 待用户决定**：① [`bundle-channel-plan-2026-09-26.md`](bundle-channel-plan-2026-09-26.md)（离线通道包化 A′，D1–D7；原"未验证"的 U1–U3 已实测为事实：pnpm 本地目录 spec **零网络**、写 `file:C:/…`、**不建目录链接**。**进度（2026-09-26）**：S1 物化模块 ✅、S2「物化包能被真 dsh 冷启动」✅（该门禁 10/10）；**S3–S6 未动**，卡在 A1/A2/A3/A4/A6/A7 待拍板）；② [`decoupling-assessment-2026-09-26.md`](decoupling-assessment-2026-09-26.md)（量化底数 + 六类耦合 + 4 方案 + 推荐 4 步；**约 46/100 条陷阱**根因是跨边界契约/三份拷贝不同步，判据与簇表见该文 §3.7。**进度**：第 0/1/2 步 ✅ 已落地、第 3 步进行中＝即本表 A′）；③ [`note-noise-and-memory-fidelity-2026-09-26.md`](note-noise-and-memory-fidelity-2026-09-26.md)（脏笔记/AI 补全 → "越看越乱"的闭环 + P1–P7 方案）。**三份的决策收在 [`pending-decisions-2026-09-26.md`](pending-decisions-2026-09-26.md)（A1–A7 / B1–B5 / C1–C6）；未拍板前不动代码。** | 待决 |
| **离线通道不出现在 dsh「内置插件 → 插件管理」页** | **已知且刻意，不是缺陷**：那一页列的是**包**（`dsh.profile.bundles ∪ profile.dependencies ∪ installation.dependencies`，且只有声明 `dsh.bundle.patch` 的包才带版本/描述/行列出），而 `--direct`／Obsidian 引导刻意只**平铺文件**（不装包、不联网）⇒ 该通道由 **Obsidian 插件设置页**管理。机制与对照已写进 `docs/installation.md`；"让它也包化"= 上表的 A′ 提案 | 已完成（文档） |
| **真 dsh 门禁此前看不见"每一轮回复都失败"** | ✅ 已修（2026-09-26）：那个门禁只"建会话"、**从不发一轮消息**，所以**请求准备阶段**的故障在它眼里是绿的——今晚那个故障期间它 50/50 全绿。现补两条**静态**前置断言（已部署 profile 的清单必须有非空 `name`+`version`；overlay 的每个相对行必须有对应文件），**变异 M21/M22** 各让一条变红。⚠️ 静态断言**不能**替代"真发一轮消息"的端到端验证（要真 API、花 token） | 完成 |
| **历史档案里的旧名与旧状态** | **刻意不追改**（改了会毁掉"当时是什么样"的证据）：已发布的 CHANGELOG 段落、`maintainability-review-*` / `project-assessment-*`（日期化审计）、已退役的 `docs/archive/REFACTOR-PLAN.md` 正文、`docs/dsh-panel-research.md` 正文（已加日期化更正块）、`docs/changelog.md` 的历史条目。`check-rename.mjs` 用「路径 + 理由」白名单豁免它们——**要改历史记录，得先写下理由** | 不做（设计如此） |
| **`scripts/qa/benchmark-vault/` 停在旧状态**（含「试做型 0.6.x」与旧产品名 `dsh web ui`） | **刻意不顺手改**：它是**冻结的基准语料**（整座合成 vault），改文字会改变基准所测的东西。守卫按**目录前缀**豁免（`check-rename.mjs` 的 `HISTORICAL_PREFIXES`，是**承重**的：不加豁免，`scripts/qa/benchmark-vault/.deepseek/config.md:10` 的旧产品名会被报）。⚠️ **两处描述已按实跑更正（2026-09-26）**：① 旧**包**名并不在库里 —— `obsidian-math-memory` 与 `dsh-web-ui-all` 各 **0 命中**，在的只有旧**产品**名 `dsh web ui`；② **谁跑它**：`npm run qa` 里跑基准 vault 的是 `seed-probe.mjs`（它默认用该目录），而 `engine-probe.mjs` 与 E2E 都从环境变量取 vault（`engine-probe.mjs:24-25` 拿不到就 exit 2/SKIP）⇒ **引擎探针不会自动跑基准 vault**。正确做法是**一次有意的刷新**（连带更新 `scripts/qa/runs/*/baseline.json`），不是搭便车改 | 不做（需专门评估） |
| **发布物里的本机路径（P2-2）** | ✅ 已修（2026-09-11）：先**证伪**——npm 只发 `dsh/` + 3 个根文件，Release 只附 Obsidian 三件，唯一的硬编码本机路径在 gitignore 的 `scripts/deploy-local.mjs`，**报告描述的泄漏在当前树上不可达**。但"可达"只靠两个清单没人改，故新增 `scripts/check-release-paths.mjs`（第 **31** 个门禁）：**发布集 pin 住**（改 `package.json` 的 `files` 必须改守卫并写理由）+ **发布面扫描**本机标识与通用绝对路径。三项变异验证。同处把 `main.template.js` 里一句像真路径的注释示例改成中性写法 | 完成 |
| **`baseline.json` 是死产物，去留待定** | `e2e.mjs` 会写 `scripts/qa/runs/*/baseline.json`（已提交 3 份），但**没有任何代码读它** ⇒ `testing.md` 的「CI 可比对基线」是目标而非现状。两条路：① **让守卫真的消费它**（比对阈值 / 回归门禁，需要先定义"退步"的判据）；② **移出 git**（当作本机运行产物）。在此之前不要在文档里声称"可比对"。已提交的证据不删，等决定 | 中 |
| **自指式期望与脆弱断言（审查 P3）** | ① **仍然成立**：`test-memory.mjs:56` 从被测模块 import `MAX_TOTAL_MEMORY_CHARS`（`math-memory.mjs:167 = 18000`）再断言 `:338 navSection.length <= MAX_TOTAL_MEMORY_CHARS`；`:41` import `HOOK_SCHEMA_VERSION`（`hook-frontmatter.mjs:16 = 1`）再断言 `:417 … > 0`——**改大常量即可让断言永远成立**。② **数字已过期，已更正（2026-09-26 实测）**：原文"47 处"来自 `maintainability-review-2026-09-11.md:448` 的旧口径；实测 `test-memory.mjs` 里"含中文的 `.includes(...)`"是 **153 处 / 108 行**（`.includes(` 总计 261，其中 16 处在 `check(` 行上）。改文案即红，属**维护成本而非缺陷**。③ **三个魔法数都已被修掉**（原文列举已失效，实测 0 命中）：`posture.length === 9`、`r.files === 5`（连 `scripts/test-preset-sync.mjs` 这个文件都不存在）、反代 31（`test-panel-proxy.mjs:27-32` 记着 `EXPECTED_CHECKS = 31` 已过期，现改为运行期累加）。**当前同类例子**（若还要继续收）：`test-memory.mjs:286 report.counts.cards === 5`、`test-panel-present.mjs:122 five.length === 5`、`scripts/qa/client-plugin-served-probe.mjs:193 String(handlers).split(',').length === 5`。修法方向：自指项改成**独立推导的期望值**（或把常量从夹具注入）；魔法数改成**从清单/代码推出**。同族坑 68 | 低 |
| **`engine-probe.mjs` 的 ground truth 绑定私有 vault** | 期望路径指向维护者的真实 vault（`engine-probe.mjs:62/65-67`：`1备忘录合集/BDL探索记录.md`、`数学/Picard-Banach定理.md`、`数学/Fubini-Tonelli定理.md`、`统计学/概率论/Helly引理.md`），vault 来自环境变量（`:24`，拿不到就 `:25` exit 2/SKIP）⇒ 真实语料上的排序结论在别的机器与 CI 上**不可复现**。⚠️ **一处引用已更正（2026-09-26）**：原文说这"与 `testing.md` 声称的『合成夹具探针』不符" —— **这是错的**，`docs/memory/testing.md` 恰恰说的是**相反**的话（`:9` "对真实 vault 跑 ground-truth 召回断言"、`:12`/`:109` "ground truth 与本机 vault 绑定"、`:106` "需真实 vault"）；唯一的"合成"提法是**未来路线**（`:70` "无 vault 时用合成 fixture"）。"合成夹具"的故事在**日期化的审计** `docs/project-assessment-2026-09-10.md:68` 里，不在现行 `testing.md`。修法仍需一次"夹具化 ground truth"的设计（把真实用例抽象成合成 vault 里的等价语料），并保留现有真实 vault 探针作为本机验收；`docs/memory/benchmark.md:169` 也记着"默认迁到仿真 vault … 未实现"。**2026-09-20 实测的新证据**：本机跑成 **11/12**，唯一红项「定理索引命中」（期望 `.deepseek/memory/theorems/index.md`）在 `git stash` 到 HEAD 后**复现同一红** ⇒ 这是 vault 内容漂移，不是检索回归；两侧都红也说明这条 ground truth 需要随 vault 维护或夹具化 | 中 |
| **记忆引擎去重（P0-3 的目标态）** | `dsh/preset/math-memory.mjs` 与 `dsh/host/memory-admin.mjs` 仍有 23 个同名符号、其中 6 个已实质偏离（`check-engine-sync.mjs` 已逐条登记理由）。彻底做法是把共享引擎抽成一个模块、两边各自薄封装——现在至少有守卫，不会再静默漂移 | 中 |
| **大函数拆分** | 实测（2026-09-26，用 `acorn` 真解析器量，**不是**手数括号）：`buildAuditReport` **1305** 行 / `MemoryView` **552** / `DshWebProxy` **526** / `DshObsidianSettingTab` **441**（审查报告 P1-5 当年记的是 582/537/387/298 ⇒ **那组数字已过期，`buildAuditReport` 涨了一倍多**）。`apply` 现在只有 46 行。拆分方向：按"读数据 / 算判定 / 渲染"切，并让每段都有独立可测的入口 | 低（数字已更新） |
| **可溯源（source 链 + 引用次数）** | `control-panel.md` §2.3 要求的这一项里，**两半的状态不同，已分清（2026-09-26 核实）**：**「引用次数」其实已交付** —— 卡片行显示 `用过 N 次 / 从未用过`（`obsidian/main.template.js:2987`，客户端半个 `dsh/client-panel/lib/client.js` 同款），`control-panel.md:64` 也把它列在已交付的行里。**欠的只有「source 证据链」**：`dsh/host/memory-admin.mjs:784 collectMemoryState` 的卡片字段（`:850-877`）里没有 `source`，该文件里出现的 `source` 全是无关的（`:1277` 的 `event.data?.source?.kind`、归档路径变量、`verified: single-source`）；面板只是把 `collectMemoryState` 转给 `/memory-panel/state`。`control-panel.md:68` 自己写着"这是本节唯一未兑现项" ⇒ 所以这条应读作**只欠 source 证据链** | 中 |
| **发布 0.7.5（推 tag）** | ✅ 已发布（2026-09-11 推 tag `0.7.5`）。**发布 0.7.6（2026-09-14）也已发布**：`git push origin main` + `git push origin 0.7.6` 后，CI 双平台绿 → Release `0.7.6`（4 个资产）→ `dsh-math-memory@0.7.6` 上 npm（latest，带 provenance）。⚠️ 本次又踩到"**publish 步成功但 registry 还没可见**"：`Confirm the registry state` 在 60 s 内看到 missing → 开 issue #3 并判失败；实测约 **60–80 秒**后 registry 才出现 0.7.6，随后 **Re-run failed jobs** 即转绿并自动关掉 issue #3。⇒ **看到 npm 那条红，先查 registry 实际状态、等一两分钟再 re-run，不要改代码**（已记入 `docs/release.md` §2 与坑 73）。| 完成 |
| **发布 0.7.7（推 tag）** | ✅ 已发布（2026-09-15 推 tag `0.7.7`，commit `dcd3656`）：CI 双平台绿 → Release `0.7.7`（4 个资产）→ `dsh-math-memory@0.7.7` 上 npm（latest，带 provenance）。⚠️ **坑 73 的延迟这次更长**：`Confirm the registry state` 查早 ⇒ 开 issue #4 判红；registry 直到 **约 4–5 分钟**后才出现 0.7.7（比 0.7.6 的 60–80 秒久得多，所以"等一两分钟就 re-run"不足够——**别急着 re-run，先轮询 registry**，它自己会绿）。issue #4 已手工关闭并在正文写明"实际已发布" | 完成 |
| **发布 0.7.8（推 tag）** | ✅ 已发布（2026-09-18 推 tag `0.7.8`，commit `d813a67`）：CI 绿 → Release `0.7.8`（4 个资产，正文取自 CHANGELOG）→ `dsh-math-memory@0.7.8` 上 npm（**`latest` 实测已指向 0.7.8**，带 SLSA provenance，`gitHead = d813a67`）。⚠️ **坑 73 第三次复现（延迟 92 秒）**：`Publish` 步 success、`Confirm the registry state` 查到 missing ⇒ 判红并开 issue。**本次用只读方式独立核实了"其实已发布"**（`https://registry.npmjs.org/dsh-math-memory/latest` 返回 0.7.8，含 `_id`/`version`/provenance）——这是比 npm 退出码更可信的判据。**两处遗留经只读核实已解决（2026-09-26）**：① `GET /repos/…/issues?state=open` 返回 **`[]`**（无未关 issue）；② Release `0.7.8` 正文**没有重复段落**了 —— 逐段标题计数 `### Added`/`### Changed`/`### Fixed`/`### Docs`/`### Internal` **各出现 1 次**、`## [0.7.8]` 1 次、正文 4497 字符。⇒ 两处遗留都已不在 | 完成 |
| **发布 0.8.1（推 tag）** | ✅ **已发布（2026-10-05 推 tag `0.8.1`，commit `126d181`）**：本批含 **0.8.0 之后未提交的全部改动（56 项）**——C7 来源（`origin`）+ C8 互证判据收紧、N-a/N-a′ 的 AI 补全与"不宜当结论"临时标记、固化改成显式动作、用户负担／笔记干扰两个只读探针、dsh 0.2.0-rc.2 适配的三处收口、第七批文献与三份评估台账。**版本号选 patch（`0.8.1`）由用户拍板**（`0.8.0` 已是 npm latest，不能往下改，见陷阱 107）。发布前门禁 **54/54**、零 token 回归 **455**。<br>**只读独立核实（§2 要求）**：GitHub Release `0.8.1` = **4 个资产**；`https://registry.npmjs.org/dsh-math-memory/0.8.1` → `version=0.8.1`、**`gitHead = 126d181a39309e25e9bcffbeb943ab3a39fb967e`（与本机 tag 逐字符一致）**、`fileCount=60`、`unpackedSize=840756`、`shasum=3c1c8e9801d7d65cf7a870e3ad10132f8d5704d6`；`/latest` **已指向 0.8.1**。⚠️ **第一次直查是 404**——正是坑 73 那个"publish 成功但 registry 尚不可见"的窗口（本次约 **1 分钟内**转好）；**未据此改任何东西**（§2 明文：成败看 registry 实际状态，并给它一两分钟） | 完成 |
| ✅ **本机部署（2026-10-05）** | `install --direct --force --vault D:\Obsidian笔记数据库` 成功：`bundles` 里 `dsh-math-memory` 仍以**本地包**注册（owner=npm、bundleSource=local）⇒ **插件管理页可见性保住**；**vault 的 19 个模板文件全部 `[skip] exists`（用户内容零覆盖）**；Obsidian 侧 `main.js` 821→**864 KB** 已覆盖并核验含新标记。⚠️ **教训**：先跑 `install`（native）会**失败**——它要让 npm 取包，而本地改动尚未发布（`dsh plugin add … ENOENT .dsh-math-memory`）；失败**未损坏** profile（状态仍 bundle 注册完好）。**离线开发用 `--direct`**。⚠️ 顺带修掉一个会骗人的缺陷：`--dry-run` 对 `overwrite=false` 的目标一律打印 "would copy"，真跑却是 `[skip] exists` ⇒ **dry-run 在最可能丢数据的文件上说了反话**（陷阱 115） | 完成 |
| **发布 0.8.0（推 tag）** | ✅ 已发布（2026-09-27 推 tag `0.8.0`，commit `ab0531e`）：CI 双平台绿（run 92）→ Release `0.8.0`（4 个资产，`main.js` 817042 B，正文取自 CHANGELOG 的 0.8.0 段 = 5982 字符）→ `dsh-math-memory@0.8.0` 上 npm。**只读独立核实**（§2 的要求）：`https://registry.npmjs.org/dsh-math-memory/0.8.0` 与 `/latest` **都已指向 0.8.0**，`gitHead = ab0531e`、60 文件、`unpackedSize 788541`、shasum `3e7b88a58b94a7a647c624e3a39f59314c42ec9e`（与 workflow 日志里那行**逐字一致**）、带 SLSA provenance。⚠️ **坑 73 第四次复现**：`Publish` 步 success、日志里已有 `+ dsh-math-memory@0.8.0`，而 `Confirm the registry state` 查到 missing ⇒ 判红并开 **issue #6**——**假失败**（registry 只是 "being processed"）。**未据此改任何代码或版本号**（§2 明文）。⚠️ 另：本次推送期间 GitHub 出现间歇性 `SSL_ERROR_SYSCALL`，`main` 重试一次才上去、tag 反而先成功 ⇒ 一度"远端有 tag 而 main 未到"，随即补推对齐（`0 0`）。<br>**⚠️ 当日的一次改号弯路（记为教训）**：用户一度认为本批以修补为主、要求改成 `0.7.9`。改号准备（版本五处 + `versions.json` 删 `0.8.0` 行 + CHANGELOG 标题 + 四处横幅 + README 配对重录）已完成并推上 main（`9072d61`），GitHub 侧也清干净了（Release `0.8.0` 删除、tag `0.8.0` 删本地+远端）。**但 npm 直接拒绝发布**：`Cannot implicitly apply the "latest" tag because previously published version 0.8.0 is higher than the new version 0.7.9. You must specify a tag using --tag.` ⇒ **改号作废，全部回退**（`git revert 9072d61`），并重推 tag `0.8.0`（仍指 `ab0531e`）恢复 Release。**结论：版本一经发布就不能往回改**，除非显式 `--tag`（那会永久留下一个更高的孤儿版本）或先 unpublish（需人工登录+2FA）。详见陷阱 107。 | 完成 |
| **persona / AGENTS.md 语义解耦** | persona 仍自称「Obsidian …」，改「工作区」措辞（语义改动，需拍板） | 中 |
| **侧栏性能：宿主侧已量（原"空白"已补）** | ✅ 2026-09-11 用 `scripts/qa/sidebar-attach-probe.mjs`（附着到真实 Obsidian：`--remote-debugging-port`，**只读**观察用户手动点击）测出结论：**同一 90 秒内宿主 0 帧 >33ms、最差 18 ms、LoAF 0、`RecalcStyle` 0.067 s；iframe 63 帧 >33ms、最差 2183 ms、`RecalcStyle` 22.76 s（410 次）**。⇒ 卡顿全在 dsh 侧，主成本是**布局/重算**（13 102 元素文档上 55 ms/次），不是脚本空转；原因 3/4 属廉价保险。**剩余唯一 A/B**：关掉「侧栏加载皮肤动态装饰」复测，以分离皮肤脚本与上游布局的贡献（见 `sidebar-performance.md` §0.2/§9） | 中（A/B 待做） |
| **命名空间隔离** | `.deepseek` → 可配置 `memoryRoot`（多套记忆共存时再做，需迁移） | 低（延后） |
| **（可选）3180 内嵌面板** | 方案 A 已决策**不做**（保持 3180 fail-closed）；如需再议 | 低 |
| **端口：多 vault 抢占 + 占用无回退** | 研究结论见 `docs/port-and-isolation.md`（2026-09-11，**只研究、未改代码**）：独立 authority 是**结构必要**的（`--profile` 单值 ⇒ 两个进程 ⇒ 两个端点），但固定 3180 **不必要**，且它是当前**唯一由端口引发的干扰**——设置存在 vault 内、默认值相同，第二个 vault 预检到占用即**抛错**（`main.template.js:1056-1059`，无回退，提示还写作"其他服务"）。建议：保留 3180 为首选 + 占用时回退到 OS 分配并显示**实际地址**；实现注意 `resolveAuth` 的 `proxy.port !== wanted` 判断（`wanted=0` 会每 300 ms 重绑并作废已兑换的 cookie）。**不做**：同端口路径路由 / 另一个回环地址 / 复用 3080 那台。⚠️ **行号已复核（2026-09-26）**：占用即抛错的那处在 `obsidian/main.template.js` 的 **1567** 行（`throw new Error(\`端口 … 被占用…\`)`），提示文案在 **1530 / 1565**；原文引用的 `1056-1059` 早已是别的代码（皮肤 hooks 拦截段） | 中 |
| **侧栏性能：两项未量到的原因** | ① 同机 3080 的 `dsh web` 持续吃 ~15% 单核（与本插件无关，但会放大动画抖动）；② iframe 内 dsh UI 的 DOM 规模（长会话）。量法与 A/B 复核步骤见 `docs/memory/sidebar-performance.md` §4/§6 | 中 |
| **★ 运行卡顿（已存档，用户决定之后再解决）** | 真因已测出：皮肤 `orca-link` 的客户端脚本 `hooks.mjs`（14 个 MutationObserver + 5 次/秒的角色样式循环 + 跟着侧栏动画每帧触发的 ResizeObserver）。已交付两档修复（性能模式改写两处热循环；可关皮肤装饰）。**未解决的三件**：① 3080 不走我们的代理，同一份脚本仍在跑——换皮肤 / 关皮肤 / 给皮肤文件打同样补丁（需备份、皮肤更新会覆盖）/ 上报作者，等用户选；② dsh 前端自身每次点击仍有 ~110ms 样式重算（侧栏宽度是 CSS grid 轨道），插件无法从外部修，需要时可拿探针输出做最小复现；③ 用户真机（长会话 + 完整插件家族）实测数字未取。**复现工具已入库**：`node scripts/qa/sidebar-perf-probe.mjs --vault=<vault> [--via-proxy] [--mutations]`；结论与判读约定见 `docs/memory/sidebar-performance.md`（§9 是接续入口） | **下次接着做** |
| **检索：关系信任 + 锚点槽位** | GraphMemix 的「查询条件化关系信任」需要 `related`/`source` 边带可信度（可用 `verified_by`/`harmed` 当先验）；触发条件写在 `retrieval-v3.md` §7.4 | 低（有触发条件） |
| **多视图 max-pool 复测** | 本轮实测 Δ=0 且排名变差，保持单袋默认；出现「标题精确命中却排在 5 名之后」的真实稀释案例时，先补 ground-truth 用例再复测（`retrieval-v3.md` §7.2） | 低（有触发条件） |
| **（可选）settings.section i18n** | `label` 已可用；若需多语言再补 | 低 |
| **拖拽引用：把 Obsidian 笔记拖进侧栏 dsh** | ⚠️ **部分实现 —— 未完成，接续入口见 [`docs/drag-to-mention-progress-2026-09-25.md`](drag-to-mention-progress-2026-09-25.md)**。**已修好并实测证实**的缺陷：客户端半个（拖拽的接收端）此前**从未被加载** —— 包躺在 `node_modules` 里，但 loader 行写进了不参与启动、且每次开机被内嵌副本覆盖的 `cordis.patch.yml`。现在那一行住在权威源 `dsh/profile/notes-assistant.patch.yml`（随 `main.js` 内嵌），安装器只"装包 + 校验行在"，门禁按**恰好出现一次**守（含零次/两次变异验证）。证：修前 `/` 的 HTML 里 `memory-panel` 出现 **0 次**，修后出现 client bundle 且实例干净启动。**仍未判定的一环**：真实侧栏上 `__dshMentionInsert` 存在且直调就能落笔、页面也确实订阅并**收到了** SSE 消息（`errors:0`），**但草稿仍为空** ⇒ "消息处理器是否调用了落笔"还没定论（产品已加自述诊断，下一次拖拽会写进插件日志）。⚠️ **用户更正：这个问题在 dsh 升级前就存在**，不是升级引入的。规格与落地记录见 [`docs/drag-drop-design-2026-09-21.md`](drag-drop-design-2026-09-21.md) | **未完成** |
| ✅ **dsh 0.1.7 适配：preset 不再是 `.agent-presets/` 目录** | **两轮做完**。① 2026-09-25：按 bundle 声明迁移 preset（生成块进两个通道的 patch），P0 解除（`agent-preset/not-found`）。② **2026-09-26 收口**：真机复验发现**三条激活形态仍然全坏**——`dsh plugin --profile <名> add`（profile 名 ≠ 常量时体文件落错目录）、冷启动第一次（注册表在宿主行 import 完之前就挂载 preset）、`install --direct`（少铺两个体文件），而当时"45/45 全绿"里含一条 **0/0 断言**的门禁（见坑 96/97/98）。修法：bundle 通道改用**包内 specifier**、`--direct` 补铺体文件、门禁改为自带 profile 并三态汇总。三条形态现在各有实测与门禁。 | 完成（2026-09-26） |
| ✅ **`.agent-presets/` 退役完成（A + B1 + B2，2026-09-26）** | preset 实体早就不落这个目录（0.1.7 无人读它），但它曾是 npm/direct **通道冲突守卫的唯一锚点**（⇒ 删目录 = 守卫**静默失效**）。**A**：锚点换成 `<profile>/.install-manifest.json` 的 `owner`（三条通道本来就都在写），退役 marker 仅作**回退**；运行时守卫、安装器三处冲突检查、`status`、`uninstall` 全走 `readChannelOwner`，配 8 项优先级 + 4 项运行时对照断言。**B1**：**停止写入**——`directInstallPreset` 与 `--force` 补写、Obsidian 引导的 5 个 `ensureFile` + marker 写入全部删掉（模板守卫改为"先读 profile 清单、再回退旧 marker"），`isolated-dsh-home.mjs` 的 `withPreset` 删除，`test-installer.mjs` 断言反过来（旧目录不得被创建 + 卸载时清理测试自己造的旧目录）。**B2**：删掉零调用方的 `syncPresetTree` 与它那两条门禁，模块改名为 `dsh/host/channel-owner.mjs`（它现在只管通道归属），配套套件改名 `scripts/test-channel-owner.mjs`。**保留回退是有意的**：把回退也删掉，2026-09-26 之前装的机器会变成"无主"、被另一条通道静默接管——那正是本轮要修的缺陷本身。 | 完成 |
| ✅ **junction 镜像退役，侧栏皮肤中心改为显式安装（2026-09-26）** | 插件曾用目录链接把 web profile 的整片 `@linxin666` 镜像进笔记 profile（本机 18 条），前提是"皮肤管理器会把活动皮肤写进全局 `cordis.patch.yml`"。该前提已失效（skin-center 0.4.x 不再改写它，见坑 99），而目录链接在本机经历过一次 home 全损、全局守卫此后禁止建链接 ⇒ 镜像删除，`check: mirror cleanup` 与它的代码一起删。皮肤中心改为设置页一个**显式按钮**（`installSkinCenterPackages()` 跑 `dsh plugin add`，需要 pnpm/网络；失败明确提示、不假装成功），且 `skinCenterMountable()` 改为纯文件系统判据（这个 profile 里真的装着这两个包才挂那一行）。原来只服务于镜像的 `SKIN_FALLBACK` 保留为**不依赖镜像**的独立防御（机器级 patch 里若仍有皮肤行就 `disabled: true`）。 | 完成 |
| ✅ **`web` profile 不自动装记忆面板客户端半个（CLI/native 通道已修；插件引导刻意不修）** | **曾列为未做，实际已落地**（2026-09-26 审计发现本条与上面第 410 行互相矛盾，且代码站在"已修"一侧）：`nativeInstall()` 与 `directInstallProfile()` **两条安装路径都会调用** `installClientIntoProfile()`（`dsh/install.mjs`），所以 `node dsh/install.mjs install --profile web` 会把客户端半个装进 `web`。这是 2026-09-26 那轮"两侧通用"的修复内容之一。**仍未做且刻意如此**：Obsidian 插件**自己的引导**只服务专用 profile，**不去改用户的 `web`**，所以 3080 那条路由要靠 CLI/native 通道开启（见 `docs/installation.md`）。 | 已完成（插件引导侧刻意不做） |
| ✅ **`autoArchive` 的兜底值与模板相反（已修，2026-09-26）** | 面板的兜底字面量曾是 `autoArchive: false`（且缺 `captureSubagents`），而权威模板 `dsh/templates/config.md` 写的是 `true` ⇒ 同一个 vault 的默认值取决于你先点了哪个 UI 创建 `config.md`；`autoArchive` 正是"体检自动归档低效用卡"的开关，因此这是行为差异。修法：`configScaffold()` **优先读真模板**、读不到才退回已按模板校正的字面量，并新增门禁 `check: config scaffold parity`（第 49 条，直接 import 面板模块取真实常量比对模板；变异 M9/M10 均按预期红）。 | 完成 |
| ✅ **设置搬进 dsh `Config`（原 P2-A）：勘察后判定在主通道不成立** | dsh 0.1.7 自带 `dsh-config-editor`（配置经 profile patch 持久化 + Loader reconcile）与 Settings→Plugins 表单，收益是真的；但声明 `Config` 要静态 `import "@deepseek-ai/schemastery"`，而 preset 体文件住在 profile 目录里：用 Node 真实解析器在**离线** profile 下得到 `MODULE_NOT_FOUND`（`$DSH_HOME/profiles/node_modules` 在离线装机上不存在——只有 pnpm 装机才会 heal 它），在 web profile 下可解析。静态裸 import 会让离线通道的 preset 挂不上 = **每次新建会话失败**（陷阱 70 形态）。**结论**：不改配置架构；"两个 UI 写同一份设置"本身早已是单一实现（都调 `memory-admin.setSessionCapture/setMemoryBudget`），真正的漂移只有脚手架口径，已按 A3 修掉（见上一行）。若将来只支持 npm 装法，可用"可选动态 import"让该表单只在 npm 通道出现。 | 已勘察/收口 |
| **离线通道的 preset 声明只活在一份"插件每次启动都会重写"的文件里** | ✅ **已修（2026-09-26，B3）**。声明现在生成进 profile **自己**的 `cordis.patch.yml`（安装器/引导只在缺失时写、此后不动）；`ensurePresetDeclaration()` / `ensureProfileDeclaration()` 会给存量 profile **只增不改**地补上（`copyFile` 刻意不覆盖用户可编辑文件，光改脚手架救不了已装用户）。生成器新增 `RETIRED_TARGETS`，在同一趟里**删除旧家的块**——搬不是拷，同一个 id 出现在两个生效层是硬失败。门禁改成「**profile 层带着 + overlay 里不许有**」（含**已部署** profile 的两条）；`test-real-profile-accept`（bundle 形态探针）不再拷扁平 posture，否则会以 `math-memory (./math-memory.mjs): never started` 起不来。**变异 M32**：把声明塞回 overlay ⇒ 两条同时红，跑一次生成器即还原。真机已自愈（安装器打印 `[preset] 已把 preset 声明补进 profile 自己的 patch 层`）。 | 完成 |
| **`math-memory.mjs` 的 `session.messages` 分支是死代码** | 上游 `Session` **没有 `messages` 成员**（只有 `deriveMessages()` 与 `surface.messages`），所以 `Array.isArray(session.messages)` 那一支永不命中；同一行对 `session.log`（TS `private`、运行时存在）的直读仍是绕过公开 API 的私有读（上游已弃用 `snapshotEvents`/`eventAt`/`ownEvents`，但三者仍在）。修法：删死支 + 评估改用公开读取面。 | 低 |
| **记忆引擎的"改名逃逸"重复实现** | `check-engine-sync.mjs` 原按**符号名**配对，2026-09-26 已补上名字无关的 token-shape 扫描（引擎间 `KNOWN_ESCAPES` + **共享模块 × 引擎**，`--sweep` 可重定标，变异 M11/M13/M14 验证），所以漂移会被抓住。**去重进度 2/3**：`contentText`/`captureContentText`、`setTopField`/`setTopFieldText` **已合并**到 `dsh/preset/engine-shared.mjs`（后者是**行为变更**：统一到 host 剥空行的版本，`test-memory.mjs` 补了 7 条断言）；**还剩 1 对**：`decodeZstdSessionLog`/`decodeSessionLog`，合并要把**解压器参数化**（host 用嵌入加载器注入的 `zstdDecompressSync`）。清单见 `AGENTS.md` §3.3。 | 中（2/3 已合并） |
| **`math-memory-workspace.mjs` 的登记副作用** | 它把 `DSH_WORKSPACE_ROOT` **登记**进 `$DSH_HOME/storages/workspace.json`（持久）。所有 QA 探针都用临时 vault 起 dsh ⇒ 每跑一次就在用户侧栏多一条垃圾工作区（2026-09-25 累计 38 条，已用 `scripts/qa/clean-probe-workspaces.mjs` 摘除）。**探针侧规矩**已写进陷阱 91；可选的产品侧改进：给登记加"探针/临时目录不登记"的开关，或让探针用独立 `DSH_HOME` | 中 |
| **`working.md` 的 500 字符上限** | 它是注入里唯一的「工作上下文」，但模板五字段（当前问题/子目标/已证·已失败/已检索·已排除/下一步）光标签就约 120 字符，500 装不下真正的进度 ⇒ 实际能承载的只有一两行。提到 800–1000 或精简模板，二选一；**要与注入体积一起量**再定。⚠️ 原文引用的行号（`math-memory.mjs:3797`）与「`clip()` 对它是头截断」已在 2026-09-21 变更——`clip` 现为**头尾都保**，行号以当时代码为准 | 低（需先量） |
| **拖拽：文件夹与编辑器选中文字的载荷未实测** | `scripts/qa/drag-payload-probe.mjs` 只测出了**文件树里拖一篇笔记**的载荷（`obsidian://open?vault=…&file=…`）。**文件夹**（要先把文件夹展开 + 真实鼠标动作）与**编辑器里选中文字**两种没测出来；实现按"解不出 `file=` 就忽略"处理，**不猜**。要支持它们，先补探针再改解析器 | 中 |
| **卸载会留下客户端半个的包目录** | `dsh/install.mjs` 的 `--direct` 分支现在会把 `@dsh-math-memory/client-ui-memory-panel` 装进 profile 的 `node_modules/`（拖拽引用与记忆面板的客户端半个）。`uninstall` 按 marker 删的是 `cordis.patch.yml` 等**文件**，**不删**这个包目录 ⇒ 卸载后残留一个不再被 patch 引用的目录（无害但不对称）。修法：给 `node_modules/@dsh-math-memory/**` 也写进 owner marker 的删除清单 | 低 |
| **`CHANGELOG.md:230` 与当前安装的前端版本不符** | 该行称「dsh 前端已内置 loopback 链接站内跳转」并据此删掉了 `patchDshFrontendLinks`；而在本机安装的 `@deepseek-ai/dsh-web-frontend/dist/assets/index-DuF6ti6g.js` 里 grep `127.0.0.1\|localhost\|loopback` **命中 0 处**。对本轮的记忆引用缺陷**无影响**（无论有没有 loopback 特判，`.deepseek/` 都打不开），但该说法需要单独核实并修正文档 | 低 |
| **P5-B：单源老化降权（未做，待拍板）** | P5-A（卡级矛盾检测，只报不改）✅ 已落地（2026-09-26，提交 `9c242f1`/`afde8e1`/`f5d4ac5`，变异 M39/M40/M41）。**剩下的一半**会给 `hookPrior` 加"未核实且陈旧 ⇒ 在既有 [0,1] 钳制内只降不升"，从而把 §1.3 实测的反转（单源高频卡 0.9363 压过用户确认卡 0.9173）真正拉回来。**它移动既有排序**，必须先过 `docs/memory/retrieval-v3.md §7.5` 的门槛（Direct 数不降 **且** 排名均值不升），可能需调参 ⇒ 属用户拍板项，方案与代价见 `docs/note-noise-and-memory-fidelity-2026-09-26.md` §4 P5 与 §6。 | 中（待拍板） |
| **还有 4 个记忆开关只能手改 `.deepseek/config.md`** | `enabled` 与 `autoArchive` 已在 2026-09-26 做进插件设置页（提交 `feb6768`）；剩下 `dialogueIndex` / `reminders` / `audit` / `captureSubagents` 仍只在文件里（模板带逐项说明）。**要不要也做 UI 属用户拍板项**（我的建议：不做——它们属于"装好就不动"的档位，做了会让设置页变成开关墙）。背景见 `docs/settings-surfaces-2026-09-26.md` §3。 | 低（待拍板） |
| ✅ **H2 的运行时验证已完成（2026-09-26）** | 缺陷与修法见 `docs/changelog.md` 2026-09-26 §③（`nativeInstall` 先于 `writePosture`，后者是 native 通道唯一创建 `<profile>/cordis.patch.yml` 的地方）。**已用真实 pnpm + dsh 在隔离 `DSH_HOME` 复验**：`node dsh/install.mjs install --profile web` → `[client] 客户端半个已装（新插入行）`，`<home>/profiles/web/node_modules/@dsh-math-memory/` 存在，`cordis.patch.yml` 里有客户端行。 | 完成 |
| ✅ **`parseArgs` 对未知参数静默忽略（已修 2026-09-26）** | 参数循环没有 else、不报错，未知 flag 被直接丢掉。已造成一次真实误导：`docs/installation.md` 曾教用户 `install --native`，而 `--native` 不存在 ⇒ 命令退回默认 profile `notes-assistant`，把客户端半个装进了**侧栏**那个 profile，`web` 依旧没有面板且毫无提示。现在**收集**所有未知参数后报错并 **exit 2**（`--help` 里新增 "Exit codes" 一节）；`status`/`--help` 仍 exit 0。守卫 4 条 + 变异验证。 | 完成 |
| ✅ **`uninstall` 的删除面收窄（两半都已修，2026-09-26）** | **前半**：卸载不再无条件删除 `manifest.posture` 里的每个文件——先 `verifyPostureDigests`，**漂移过（被用户或 dsh config editor 改过）的文件保留并提示手工删除**。此前 native 通道记录的 posture 恰好是 `cordis.patch.yml`，而在 `web` profile 里那是**用户自己的 dsh 设置**（provider/默认模型），卸载会静默删掉它；`verifyPostureDigests` 本就是为这件事写的却从未被调用。带 5 条断言 + 变异验证（`if (drifted.has(rel))` → `if (false)` 即红）。**后半（M6，已修）**：`--purge-data` 的 `contentFiles`/`contentDirs` 曾是**手抄** `dsh/templates-manifest.json` 的第二份清单（仓库协议禁止再加一份，且新模板会被静默漏掉）⇒ 现**全部派生**：文件取清单全部 target 去掉骨架，**容器目录取每个 target 的父目录**（第一版仍留手写 `containers`，实测未来层的目录会半删存活）。守卫重写过一次（第一版无法失败，属装饰性守卫，坑 68/81）+ 变异验证 3 条红。 | 完成 |
| ✅ **插件"从零重建"从未被执行过（已补门禁 2026-09-26）** | 用户报告 `$DSH_HOME` 被清空过**四次**。查证发现结构性空洞：`bootstrapDshConfig()`（服务启动路径上、每次启动都跑、`ensureFile` 幂等）**没有任何门禁执行过** —— `check-embedded-writers` 跑的是内嵌 `memory-admin.mjs`；`check: profile contract` 只验写入清单是派生的、不验真的写；`test: self-provisioned profile` 自己铺 profile、绕过插件引导。**已新增 `scripts/check-bundle-recovery.mjs`（19 条，门禁总数 52→53）**：用 acorn 把出厂 `main.js` 里真正的 `bootstrapDshConfig` 抽出来执行，验四种现场（整个 home 不存在 / 半清空 + 手改代码文件 / 第二次启动幂等 / 别的通道拥有时拒绝且 `force` 真能接管）。变异验证三条（少刷 body 文件、少刷 engine-shared、digest 记成 `{}`）全红。**顺带查实**：全仓只有一处破坏性调用（预设引擎对**内部临时文件**的 best-effort `rmSync`），归档走 `renameSync` ⇒ **插件不可能删用户 vault 数据**；且上次四次清空后 `workspace.json` 只有 2 条、**stray=0**（不同于 2026-09-25 那次的 38 条）。 | 完成 |
| ✅ **安装器会把 OS 主目录当成 harness home（S0，已修 2026-09-26）** | 用户担心"$home 静默保持用户主目录 ⇒ A′ 会不会重演删库"。**先把话说准：这条防的是"写错地方"，不是"删错地方"。** 查实的：① **没有"删 home"的代码路径** —— `install.mjs` 的删除点只有五处（`presetRoot`、单个文件、`.install-manifest.json`、**已空的** `profileRoot`、`<vault>/.deepseek/cache`），全仓"把 `home`/`dshHome` 当删除目标"的调用 **零命中**，`remove()` 只删传入的那一个路径、不向上走；② **四次清空也不是"递归删错一层"**（第 4 次是 <600 ms 内**有序清空**顶层项 + 改名，执行者未点名），把它归因于 `$home` 算错**与证据不符**；③ 真实后果是**散落写入**（`~\profiles`、`~\skins`）。已加 `assertHarnessHome()`：拒绝"等于 OS 主目录"与"**包含**一个 harness home（`<raw>/.dsh` 存在）"两种形态并**打印实际路径**；逃生口 `--any-home` / `DSH_ALLOW_ANY_HOME=1`。刻意**没**要求"路径必须以 `.dsh` 结尾"（所有安装测试用 `mkdtempSync` 临时目录，硬性要求会把门禁搞红）。守卫 7 条 + **两条分支各自变异验证**（拆"包含"半 ⇒ 3 条红、且原样记录事故损害 `status=0`；拆"等于"半 ⇒ 1 条红）。对应仓库外防灾交接的**缺口 8** | 完成 |
| ✅ **`uninstall --dry-run` 已逐条核对（2026-09-26）** | `uninstall` **默认就是 dry-run**（执行要加 `--yes`），此前只断言过"keeps the deployed preset body"，而删除动作有六类。先静态排查（所有删除都走 dry-run-aware 的 `remove()`，无裸 `rmSync`/`writeFileSync`），再实测：对 `profile` 与 `vault` 各做整棵树 sha256 快照，跑 `uninstall --purge --purge-data`（不加 `--yes`）→ 计划 44 行、两棵树 **changed/added/removed 全 0**；随后真跑一次 profile **36 → 22** 个文件（证明断言不空洞）。守卫 4 条（整棵树比对）+ 变异验证（把一处 `remove` 换成裸 `rmSync` ⇒ `removed=1` 红）。 | 完成 |
| ✅ **客户端包 id 冲突留下半改状态（M7，已修 2026-09-26）** | 冲突检查的注释写着"**先**查冲突再下结论"，位置却在**所有写入之后**（包已进 `node_modules/`、暂存已写、`package.json` 已加 `file:` 依赖）⇒ 拒绝后留下半改 profile。现上移到任何写入之前（`findIdOwners` 只读 `*.yml`，不依赖后面的产物），并**删掉**原位置已不可达的 overlay 分支（第二份能互相矛盾的判断）。守卫 6 条（新增 `branch 4b`），判据刻意是"**它什么都没写**"而非"它会报错"；变异验证 5 条红。 | 完成 |
| ✅ **client 半个安装失败只是"日志级"（M3，已修 2026-09-26）** | 两条路径此前都只打一行日志随后 `Done` + exit 0 ⇒ 记忆面板可以完全不存在而所有信号都说"装好了"。现抽出 `stageClientHalf()`：`ok:false`/抛异常 ⇒ 返回 false；**且不轻信 `ok:true`** —— 后置校验"行指向的包真的带着 `client.js`"才算装上。两条路径把 false 往上传 ⇒ **非零退出且不打印 `Done`**，并说明"面板的其余部分已写入"。判据放在最后一步（native 的 `dsh plugin add` 副作用已经产生，拒绝执行回滚不了任何东西，能守的是"不谎报")。测试缝 `DSH_TEST_FORCE_CLIENT_FAIL=1`（已登记 `docs/env-vars.md` §2）；守卫 4 条（含反恒真）+ 变异验证。 | 完成 |
| ✅ **`check-doc-counts.mjs` 的顺序断言（已修 2026-09-26）** | 文件头声称断言"numbering must be **1..N** with no repeats and no gaps"，但只查**重复与缺口**、**不查顺序** ⇒ 实测陷阱表里 **73 排在 72 之前**而门禁是绿的。已补顺序断言（`traps[i] !== i+1` 即失败，并报位置与值），**并把那两条真的对调**（只改注释不改数据就是"注释比断言强"的镜像）。变异验证：再对调回去立刻红。 | 完成 |
| ✅ **`--purge-data` 的手抄清单（M6，已修 2026-09-26）** | 两张手写清单是 `templates-manifest.json` 的第二份拷贝（协议禁止）⇒ 新模板会在安装时铺进 vault、`--purge-data` 时**静默存活**（"我把记忆删了"是假的且无人报错）。现**全部派生**：文件取清单全部 target 去掉骨架；**容器目录取每个 target 的父目录**（第一版仍留手写 `containers`，实测未来层的目录会半删存活——取父目录后不可能漏）。守卫重写过一次：第一版只断言"清单 target 都不在"，而那条在把清单换回手写子集时**依然通过**（递归删容器顺手删了），属**装饰性守卫**（坑 68/81）；现改为在独立 vault 里种"清单命名、位于 vault 根"的文件断言被删 + 种"清单未命名"的同目录文件断言存活。变异验证 3 条红。 | 完成 |
| ✅ **`handoff.md` §3 与 §1 banner 的过期计数（已修 2026-09-26）** | 曾写着 `28/28 门禁全绿` / `记忆回归 240/240` / `回归 240 → 376`，而门禁是 **51 条注册**、回归是 **427/427**。已按"实测值 + 前提"改写：§3 换成三态汇总口径（并写明两条 SKIP 不是通过、真实 vault 探针本轮 SKIP），§1 banner 保留原文但紧跟一句更正与"以 `scripts/lib/gates.mjs` 与 `__CHECKS__` 为准"。 | 完成 |

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。
