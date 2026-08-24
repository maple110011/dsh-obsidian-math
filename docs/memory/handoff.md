# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、决策、已修坑、未做事项与工作约定。
> 最后更新：2026-08 大改收尾——仓库文档大改 + 文献库子系统 + 记忆系统强化（两轮）+ Phase 1 解耦 + Phase 2a/2b dsh web 面板 + 面板方案 A（两实例）。**版本 0.6.5（2026-08-23）**。

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
| `dsh/install.mjs` | CLI 安装器（npm bin `dsh-math-memory`；`--preset-only` 只装 preset） |
| `dsh/host/memory-admin.mjs` | host-agnostic 记忆管理核心（确定性操作 + 面板数据层；Obsidian 插件经嵌入 loader 复用） |
| `dsh/host/math-memory-panel.mjs` | **dsh web 宿主面板插件**：inject `webServer`+`workspaceRegistry`，路由 `/memory-panel/*`（state/workspaces/feedback/archive/capture-policy/archive-episodes），loopback-only + `pathInside` 门控 |
| `dsh/client-panel/` | **dsh web 客户端面板**：React 源码 `src/index.jsx` + esbuild 打包 `build-client.mjs` + 安装 `install-into-profile.mjs` + 产物 `lib/client.js` |
| `literature/` + `scripts/lit-import.mjs` + `docs/literature.md` | **文献库子系统**：BibTeX + PDF + MinerU markdown → 双面文献库（14 篇） |
| `docs/dsh-panel-research.md` | dsh web 面板机制调研（客户端契约 / settings.section 槽位 / profile 装配名单 / 宿主路由） |
| `obsidian/main.template.js` | Obsidian 插件源码：服务管理、LinkServer（/open + /feedback）、MemoryView 面板、全局皮肤 patch 兜底、bootstrap、**命令「在 dsh web 打开记忆面板」+ `memoryPanelUrl` 设置** |
| `scripts/build-obsidian.mjs` | 把模板 + dsh 文件嵌入 `main.js`（**改共享文件后必跑**） |
| `scripts/test-memory.mjs` | 零 token 记忆回归（85 项断言，进 `npm test`） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测 |
| `scripts/check-doc-consistency.mjs` | 文档一致性守卫（断言数等数字与代码实测对齐，进 `npm test`） |
| `scripts/check-rename.mjs` / `check-skin-fallback.mjs` / `check-plugin-id.mjs` | 三个守卫（见 §4 坑） |
| `scripts/qa/` | engine-probe（12 组 ground-truth）+ e2e（真实 token 会话，`npm run qa:e2e`） |
| `scripts/deploy-local.mjs` | 本机一键部署（gitignored，含本机路径；用 copyFileSync 手动遍历，勿用 cpSync） |

## 3. 当前状态（2026-08 大改收尾后）

> **增量（本会话）**：文献库入库 MemTrapBench（第 15 篇，已蒸馏），并落地「记忆适用性（防记忆陷阱，AdaptiveMem 本土化）」——AGENTS.md §5 四风险 + 决策流程、`math-memory.mjs` 每轮注入适用性纪律、`note_recall` 适用性提示、`inapplicable` 反馈动作（不降成功率）、`lit-import.mjs` 改增量合并（修全量覆盖 bug）、`docs/literature.md` 补「新增单篇文献 SOP」。回归 83→85。皮肤中心加固：`skinCenterMountable` 收紧为检查两个具体皮肤包，degrade 皮肤禁用块改为运行时读取 `$DSH_HOME/cordis.patch.yml` 动态生成（去硬编码 11 id）。

**本轮改动总账（按阶段）**：

1. **仓库文档大改**：测试断言数全仓统一（README 中英 / ARCHITECTURE / docs-memory-README / handoff）；README 双语旧身份 `obsidian`→`notes-assistant`；env 旧名改新名（`DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`）；`REFACTOR-PLAN.md` 退役、根 `TESTING.md` 并入 `docs/memory/testing.md`；新增 `scripts/check-doc-consistency.mjs` 一致性守卫。
2. **文献库子系统**：`literature/` 双面文献库 + `scripts/lit-import.mjs` + `docs/literature.md`；14 篇论文全部导入，产出 14 张卡 + 14 条精读记录 + `notes/memory-system-review.md`（14 篇综合、优先级建议）。
3. **记忆系统强化（两轮）**：`hookPrior` promote/demote（verified/success_rate/uses 0.45/0.25/0.20 + recency 0.10，90 天线性衰减）；每日体检新增反模式、热度归档候选（heat 0.5/0.3/0.2）、被动召回信号（空结果率）；records 模板加 `confidence` 与「可修订记录」；templates/profile/AGENTS.md 补定理表聚合、条件演化门、写卡去重、自动链接、Refine 步、检索粒度纪律；回归 75→82。
4. **Phase 1 解耦（host-agnostic core）**：把 Obsidian 插件里的确定性记忆操作抽成 `dsh/host/memory-admin.mjs`（纯 node:fs/path）；`build-obsidian.mjs` 嵌入 + 插件 `MEMORY_ADMIN` loader；插件本地副本改别名；`npm test` 增 `node --check dsh/host/*.mjs`。
5. **Phase 2a（宿主面板路由）**：`dsh/host/math-memory-panel.mjs` 挂 `/memory-panel/*`（loopback-only + pathInside 门控，复用 memory-admin）；boot 冒烟 `GET /memory-panel/state` 返回 `{ok:true}`。
6. **Phase 2b（客户端面板）**：`dsh/client-panel/` React 面板（工作区下拉 + 手动 root + localStorage），esbuild 打包，装在主 dsh web Settings（`settings.section` 槽位，显示名「记忆面板」）；实测可用。
7. **面板方案 A（两实例）**：主 dsh web `3080`（`web` profile，编程 + 记忆面板）、notes dsh web `3180`（`notes-assistant` profile，Obsidian 聊天，fail-closed、不挂 `@linxin666`）。Obsidian 插件新增命令「在 dsh web 打开记忆面板」+ 设置 `memoryPanelUrl`（默认 `http://127.0.0.1:3080/`，`electron.shell.openExternal`）。

**身份解耦（早前 Phase 2，已稳定）**：文件更名 `obsidian-*`→`math-memory`/`note-tools`/`math-memory-workspace`；npm 包 `dsh-obsidian-math`→`dsh-math-memory`；profile/preset id `obsidian`→`notes-assistant`；权限预设 `obsidian-locked`→`math-memory-locked`；env 别名 `DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`（旧名兼容）。**单仓**（不拆双 git 仓库）。

**开关与共存 / 独立设置面板**：总开关 `enabled` + 粒度开关 `dialogueIndex`/`reminders`/`audit`；独立设置面板 = 工作区级 `.deepseek/config.md`（host-agnostic 配置文件）；`--preset-only` 只装 preset；**皮肤中心改为可选**（默认不挂载；Obsidian 设置「启用皮肤中心」开关把 `ui-skin-center` + `ui-web-ui-settings` 追加到 `notes-assistant.patch.yml`，需 web profile 镜像 `@linxin666` 包）。

**QA 状态**：`npm test` 85/85 全绿；engine-probe 12/12 全绿；真实 token 会话 E2E（`npm run qa:e2e`）**留待用户本机跑**（需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN 真实 JS 入口 + 模型余额）。

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

## 5. 用户决策记录（不要推翻）

- **单仓**（不拆双 git 仓库），两个产物独立分发（npm 包 + Obsidian 插件）+ 仓库内文献库/面板子系统。
- npm 包名 `dsh-math-memory`；插件 id `dsh-math-assistant`（**不改**）；仓库名 `dsh-obsidian-math`（**未改**）。
- 版本 0.6.2（2026-08-23：链接站内跳转 + 数学交流提示词 + ask_user 节制 + 链接路径免手工编码）。
- 独立设置面板 = **配置文件**（`.deepseek/config.md`），不是图形 UI（若需要可后续在其上加 web 页面）。
- **记忆面板进主 dsh web（3080）**（方案 A）：Obsidian 用命令 `shell.openExternal` 打开 3080；notes profile（3180）保持独立/fail-closed、**默认不挂任何 `@linxin666` UI**（皮肤中心可经设置开启）。
- **文献库放仓库**（`.raw/` gitignore）。
- 不做 token 型 benchmark；推送 GitHub 必须等用户口令（"推送"）。

## 6. 工作流命令

```bash
npm test                        # 85 项零 token 回归 + 安装器 e2e + 漂移 + 三守卫 + 文档一致性 + 语法检查
node scripts/build-obsidian.mjs # 改 dsh/ 或模板后重建 main.js
npm run build:client            # 改 dsh/client-panel/src 后重建 lib/client.js
node dsh/client-panel/install-into-profile.mjs --dsh-home <home>   # 装面板进 web profile
node scripts/deploy-local.mjs   # 本机部署（vault / DSH_HOME / 插件目录）
dsh --profile notes-assistant --port 3180 --patch <home>/profiles/notes-assistant/notes-assistant.patch.yml --dump-config
node dsh/install.mjs install --dsh-home <home> --preset-only   # 只装 preset 进主 dsh
# 真实 E2E（需模型余额 + 真实 vault + 真实 JS 入口）：
#   DSH_HOME=<home> DSH_WORKSPACE_ROOT=<vault> DSH_BIN=<.../lib/bin.js> npm run qa:e2e
# 调试日志：<vault>/.obsidian/plugins/dsh-math-assistant/debug.log
```

## 7. 未做 / 下一步候选（供新会话挑选）

| 项 | 说明 | 优先级 |
|---|---|---|
| **3 类陷阱压力样例进引擎探针** | 造 Cognitive Bias / Task Boundary / Trauma 的数学版 ground-truth 进 `scripts/qa/engine-probe.mjs`（需绑定真实 vault，vault 内容变化时同步维护） | 中 |
| **「记忆诱发退化」被动信号** | 有/无记忆对照的答案质量（LLM-judge 打分）作为体检的「固定/扭曲」健康指标（需接 judge，可选增强） | 低 |
| **note_recall 结构化适用性字段** | 现为 prompt 提醒（描述 + 渲染），可升级为返回可判定的「适用性」弱信号（如跨 operator/主题命中标注） | 低 |
| **文献库剩余 13 篇蒸馏** | `literature/` 15 篇仅 2 篇 distilled（shutova + memtrapbench）；按 `docs/literature.md` §8 SOP 逐篇研读 + 蒸馏 + 回流记忆 | 中 |
| **真实 E2E（用户跑）** | `npm run qa:e2e` 需 DSH_HOME/DSH_WORKSPACE_ROOT/DSH_BIN（真实 JS 入口）+ 模型余额；本轮已诊断「profile 缺失已装 + OOM 已降 4G + cause 日志」，留用户跑 | 高（发布前） |
| **Obsidian 本机部署验收** | `deploy-local` 后用户在 Obsidian reload + 命令「在 dsh web 打开记忆面板」实测打开 3080 面板 | 高（发布前） |
| **dsh session 路径编码 mojibake** | 非 ASCII workspace 路径下 session 目录编码分裂（正确 vs 乱码并存），影响跨工作区 dialogue index；已知未修 | 中 |
| **反馈无 hook 块自动补块** | 反馈闭环对无 `hook:` 块的卡报「该卡片没有 hook 块」，可改为自动补最小 hook 块再写入 | 中 |
| **persona / AGENTS.md 语义解耦** | persona 仍自称「Obsidian …」，改「工作区」措辞（语义改动，需拍板） | 中 |
| **Obsidian 插件自动化测试** | `main.template.js` 的反馈/面板/归档/捕获策略逻辑零自动化测试，全靠手测 | 中 |
| **命名空间隔离** | `.deepseek` → 可配置 `memoryRoot`（多套记忆共存时再做，需迁移） | 低（延后） |
| **（可选）3180 内嵌面板** | 方案 A 已决策**不做**（保持 3180 fail-closed）；如需再议 | 低 |
| **（可选）settings.section i18n** | `label` 已可用；若需多语言再补 | 低 |

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。
