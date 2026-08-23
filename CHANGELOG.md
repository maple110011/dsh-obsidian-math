# Changelog

> 本文件是**发布级摘要**（每个版本「改了什么」，面向用户与发布）。记忆系统「为什么改、怎么改」的细账见 [docs/memory/changelog.md](docs/memory/changelog.md)；现状/坑/决策见 [docs/memory/handoff.md](docs/memory/handoff.md)。

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
