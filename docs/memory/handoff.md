# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、决策、已修坑、未做事项与工作约定。
> 最后更新：本轮大重构后（单仓身份解耦 + 记忆开关 + 独立设置面板 + 皮肤中心移除）。**版本仍 0.5.1，未 bump**——用户后续还有记忆系统与仓库文档大改，改完再统一 bump。

## 1. 项目是什么

`dsh-math-memory`（原 `dsh-obsidian-math`）：把 DeepSeek Harness（dsh）嵌入 Obsidian 右侧栏的**数学笔记助手**，核心是跨会话分层记忆系统。**单仓库**、**两个独立分发产物**：

- **npm 包 `dsh-math-memory`**（`dsh/`）：dsh agent preset + profile + 安装器，把记忆系统装进任意 DSH_HOME。
- **Obsidian 社区插件**（id `dsh-math-assistant`，根目录 `main.js`/`manifest.json`/`styles.css`）：右侧栏 UI（服务管理、记忆面板 ItemView、反馈闭环、归档）。

仓库地址：github.com/maple110011/dsh-obsidian-math（**仓库名未改**，只有 npm 包名改了）。

## 2. 文件地图（改哪里先看哪）

| 路径 | 职责 |
|---|---|
| `dsh/preset/math-memory.mjs` | 记忆注入引擎：五层导航摘要、体检、dialogue index、memo 提醒、`config.md` 开关解析 |
| `dsh/preset/note-tools.mjs` | 笔记工具：note_recall/note_search/note_create/note_links + BM25 + `resolveWorkspaceRoot` |
| `dsh/preset/hook-frontmatter.mjs` | **共享 hook 块解析器**（单一事实源；+ `HOOK_SCHEMA_VERSION`；被 ESM import + 插件嵌入 loader 双路加载） |
| `dsh/preset/agent.cordis.yml` | preset 装配：最小工具面 + 记忆开关（`enabled`/`dialogueIndex`/`reminders`/`audit`） |
| `dsh/preset/preset.yml` | preset 元信息（显示名「数学笔记助手」） |
| `dsh/profile/` | **profile `notes-assistant`**：fail-closed 沙箱（workspace-write + approval never）；**不挂载任何 dsh-web-ui 插件** |
| `dsh/templates/` | vault 模板：AGENTS.md + 记忆层模板 + `config.md`（独立设置）+ `capture-policy.md` |
| `dsh/templates-manifest.json` | **模板清单单一事实源**（build/install/bootstrap 三处派生 + 构建漏模板门禁） |
| `dsh/install.mjs` | CLI 安装器（npm bin `dsh-math-memory`；`--preset-only` 只装 preset） |
| `obsidian/main.template.js` | Obsidian 插件源码：服务管理、LinkServer（/open + /feedback）、MemoryView 面板、全局皮肤 patch 兜底、bootstrap |
| `scripts/build-obsidian.mjs` | 把模板 + dsh 文件嵌入 `main.js`（**改共享文件后必跑**） |
| `scripts/test-memory.mjs` | 零 token 记忆回归（75 项断言，进 `npm test`） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测 |
| `scripts/check-rename.mjs` / `check-skin-fallback.mjs` / `check-plugin-id.mjs` | 三个守卫（见 §4 坑） |
| `scripts/deploy-local.mjs` | 本机一键部署（gitignored，含本机路径；用 copyFileSync 手动遍历，勿用 cpSync） |

## 3. 当前状态（本轮大重构后）

**架构解耦（Phase 1）**：`resolveWorkspaceRoot`（config > env > cwd）统一 vault 解析；hook 解析器抽成单一文件 `hook-frontmatter.mjs`；`templates-manifest.json` 单一事实源；确定性文件操作去 Obsidian API 依赖（改收 vault 路径）。

**身份解耦（Phase 2）**：文件更名 `obsidian-memory.mjs`→`math-memory.mjs`、`obsidian-notes.mjs`→`note-tools.mjs`、`obsidian-workspace.mjs`→`math-memory-workspace.mjs`、`obsidian.patch.yml`→`notes-assistant.patch.yml`；npm 包 `dsh-obsidian-math`→`dsh-math-memory`；profile/preset id `obsidian`→`notes-assistant`；权限预设 `obsidian-locked`→`math-memory-locked`；环境变量别名 `DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_*`（旧名兼容）。**保持单仓**（不拆双 git 仓库）。

**开关与共存（Phase 3）**：总开关 `enabled` + 粒度开关 `dialogueIndex`/`reminders`/`audit`；`--preset-only` 装进主 dsh。

**独立设置面板（Phase 4）**：`.deepseek/config.md`（host-agnostic 配置文件，非图形 UI）；**移除皮肤中心挂载**（`ui-skin-center`/`ui-web-ui-settings`），消除 `@linxin666` 依赖、无 `web` profile 也能启动。

**守卫**：`check-rename`（profile 名一致性）、`check-skin-fallback`（@linxin666 挂载与降级块一致）、`check-plugin-id`（插件 id 与目录名一致），均接入 `npm test`。

## 4. 必须知道的坑（勿重蹈覆辙）

1. **本机 `fs.cpSync` 会原生崩溃**（0xC0000409）。任何脚本用「手动遍历 + copyFileSync」。
2. **Obsidian 1.13.7 视图生命周期有 `open(containerEl)` 方法**——ItemView 子类**不得**定义 `open/close/load` 同名方法。
3. **vault 索引排除点号路径段**（`.deepseek` 对 Obsidian API 不可见）：面板用 node fs 读取 + 预览 Modal，不能 openLinkText/TFile。
4. **Obsidian 1.13.7 的 Notice 构造不调 setMessage**——抓 toast 用 DOM MutationObserver。
5. **插件 id `dsh-math-assistant` 是稳定标识、永远不要改**——Obsidian 按 `.obsidian/plugins/<目录名>/` 加载插件，manifest `id` 必须等于目录名；改 id 会让已有安装插件「消失」。有 `check-plugin-id` 守卫。
6. **profile 不再挂载任何 dsh-web-ui 插件**——若有人把 `@linxin666` 挂载加回 `cordis.patch.yml` 会 boot 崩（`check-skin-fallback` 会拦：挂载必须在降级块里被禁用；当前是 0 挂载）。
7. **插件 bootstrap 每次加载强制刷新** `math-memory.mjs/note-tools.mjs/.../notes-assistant.patch.yml`（overwrite=true）——机器本地手改这些文件会被冲掉，改动必须进仓库。
8. **防护必须双端接线**：给 loopback 端点加 CSRF/权限校验时，必须同步更新注入给模型的链接模板（`t=`）；只改端点不改模板 = 点击闭环静默断裂。
9. **缓存语义变更必须带版本**：`cache/dialogue-index.json` 按指纹复用；任何过滤/配对语义变化都要 bump `schemaVersion`（现为 2）。
10. **fallback 写入必须抵抗刷新**：`notes-assistant.patch.yml` 每次加载 overwrite 刷新；运行时追加的机器本地块要在 `ensureObsidianPatch` 里提取重放。

## 5. 用户决策记录（不要推翻）

- **单仓**（不拆双 git 仓库），两个产物独立分发（npm 包 + Obsidian 插件）。
- npm 包名 `dsh-math-memory`；插件 id `dsh-math-assistant`（**不改**）；仓库名 `dsh-obsidian-math`（**未改**）。
- **版本号暂不 bump**——后续还有记忆系统 + 仓库文档大改，改完统一 bump。
- 独立设置面板 = **配置文件**（`.deepseek/config.md`），不是图形 UI（若需要可后续在其上加 web 页面）。
- 记忆面板**留在 Obsidian**（不并入 dsh web ui）。
- **皮肤中心移除**（独立，不依赖 `@linxin666`）。
- 不做 token 型 benchmark；推送 GitHub 必须等用户口令（"推送"）。

## 6. 工作流命令

```bash
npm test                        # 75 项零 token 回归 + 安装器 e2e + 漂移检测 + 三个守卫
node scripts/build-obsidian.mjs # 改 dsh/ 或模板后重建 main.js
node scripts/deploy-local.mjs   # 本机部署（vault / DSH_HOME / 插件目录）
dsh --profile notes-assistant --port 3180 --patch <home>/profiles/notes-assistant/notes-assistant.patch.yml --dump-config
node dsh/install.mjs install --dsh-home <home> --preset-only   # 只装 preset 进主 dsh
# 调试日志：<vault>/.obsidian/plugins/dsh-math-assistant/debug.log
```

## 7. 未做 / 下一步候选（供新会话挑选）

| 项 | 说明 | 优先级 |
|---|---|---|
| **命名空间隔离** | `.deepseek` → 可配置 `memoryRoot`（31 处代码 + 模板 + 宿主 + 文档），多套记忆共存时再做，需迁移 | 低（延后） |
| **反馈无 hook 块自动补块** | 反馈闭环对无 `hook:` 块的卡报「该卡片没有 hook 块」，可改为自动补最小 hook 块再写入 | 中（随记忆系统梳理） |
| **persona / AGENTS.md 语义解耦** | persona 仍自称「Obsidian knowledge-base assistant / Obsidian vault」，改「工作区」措辞（语义改动，需拍板） | 中 |
| **版本 bump + 补 CHANGELOG** | 等大改完成后统一 bump 版本 + 细化 CHANGELOG | 高（发布前） |
| **Obsidian 插件自动化测试** | `main.template.js` 的反馈/面板/归档/捕获策略逻辑零自动化测试，全靠手测 | 中 |
| **`qa:e2e` 真实 token 端到端** | 需模型凭据 + 真实 vault，本轮未跑 | 中 |

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。
