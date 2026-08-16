# Changelog

## [Unreleased]

### Added

- **低危清单清理（handoff 序 4）**：`note_search` 排除 `.deepseek` 记忆树（记忆文件仍走 grep/read；note_links/note_retrieve 不变）；episode 归档同步改写 records 卡 `source` 链接（溯源链不断）；探测到端口被非本插件服务占用时给出一次性 Notice 提示（keepAlive 场景自动豁免）；README/`cordis.patch.yml` 对 `DSH_PERMISSION_MODE` 的措辞改为“仅重开交互式提权、沙箱仍 workspace-write”。
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
