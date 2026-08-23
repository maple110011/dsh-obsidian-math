# dsh-obsidian-math 拆分重构方案（t4 · refactor 顾问产出）

> **状态：已退役（历史档案，不再维护）**。本文为拆分重构的规划稿。执行结果：Phase 0（清文档漂移）、Phase 1（解耦命名/路径）、Phase 3（开关与共存）已落地；Phase 2（拆仓库）已由用户决定**保持单仓**、取消；Phase 4（web ui 适配）未做。所有剩余/未做事项以 [docs/memory/handoff.md](docs/memory/handoff.md) §7 为准。本文仅存档决策依据。

> 基于 t1（架构）、t2（文档漂移）、t3（代码质量）三份审查发现；每条结论标注了依赖的具体发现。本文是**可执行方案**，不是愿景。

---

## 一、拆分总图（两个仓库的边界 + 数据流 + 依赖方向）

```
┌───────────────────────────── dsh-math-notes-assistant（Obsidian 插件仓库）────────────────────────────┐
│  Obsidian 壳：                                                                                        │
│   · 服务管理（spawn/kill dsh、端口探测、日志）                                                          │
│   · 右侧栏 iframe（嵌入 dsh web ui）                                                                   │
│   · 记忆面板 ItemView（浏览/搜索/编辑/✅❌/归档按钮/捕获策略下拉框）—— 短期仍是壳内 UI                    │
│   · loopback /open（openLinkText 跳笔记，Obsidian 专属）+ /feedback（CSRF token）                       │
│   · 归档维护 archiveOldEpisodes · 皮肤 junction syncGlobalPackageLinks                                 │
│   · 把 vault 路径写成 env：DSH_WORKSPACE_ROOT（旧名 DSH_OBSIDIAN_VAULT 兼容）                          │
└──────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                               │ 依赖（单向，仅此方向）：npm 依赖 @dsh-math-memory/core；
                               │ 构建时把 core 的 preset/profile/templates 嵌入 main.js
                               ▼
┌───────────────────────────── dsh-math-memory（记忆内核仓库，host-agnostic，零 Obsidian 依赖）─────────┐
│  通用记忆内核：                                                                                        │
│   · 注入引擎：buildMemorySection / buildDialogueIndex / 体检 audit / capture-policy 解析与注入           │
│   · 笔记工具：note_recall / note_search / note_create / note_links + BM25 + hook 解析 + tokenizer       │
│   · 确定性文件操作（从 Obsidian 宿主下沉，t1 H1）：applyFeedback / archiveMemoryFile / setCapturePolicyMode │
│   · 工作区根解析 resolveWorkspace（统一，修 t3 High）                                                  │
│   · 模板与协议：AGENTS.md / 五层结构 / capture-policy / notation / 15 个模板（单一 templates-manifest） │
│   · 安装器 install.mjs（--workspace 任意文件夹）· 宿主路由 /memory-panel/*（host-agnostic，Phase 4）     │
└──────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                               │ 读/写（markdown，无数据库）
                               ▼
       任意工作区根（默认 <workspace>/.dsh-math-memory/**，旧名 .deepseek 兼容）
       memory/（profile/topics/records/theorems/templates/episodes）+ inbox/ + capture-policy.md + cache/
```

**依赖方向：插件 → 内核（单向）。内核零 Obsidian import。** 数据流不变：agent 读/写工作区 markdown；内核注入 `dsh-math:memory` 段（旧名 `obsidian:memory`）；插件只做 UI 触发 + 进程管理 + Obsidian 跳转。

---

## 二、逐条回答 9 个问题

### 问题 1：记忆系统和 Obsidian 插件是否应该分开？边界画在哪？

**结论：应该分开，但要分两层走——先"逻辑解耦"（单仓内，低风险，Phase 1），再"物理拆仓"（Phase 2）。** 边界按"确定性文件操作 vs Obsidian API 交互"来画，而不是按"记忆 vs 笔记"画。

**理由**：t1 给了 7/10 的总评，核心痛点是"深层功能耦合而非命名耦合"——最硬的证据是 **t1 H1**：验证升级（`applyFeedback` L180）、成功率改写（wrong）、superseded、归档（`archiveMemoryFile` L211 / `archiveOldEpisodes` L780）、捕获策略写回（`setCapturePolicyMode` L161）全部只在 Obsidian 插件内用裸 `node:fs` 执行，agent 无删除/移动工具。这意味着记忆的"验证→反馈→归档"闭环脱离 Obsidian 即失效。但这些操作的**本质是通用确定性文件操作**（改 hook frontmatter、移动文件到 archive/），只是现在借了 Obsidian 的 `app.vault.adapter.getBasePath()` 和裸 fs 实现——所以"记忆系统"与"Obsidian"的解耦点不在记忆存储，而在**控制面下沉**。

**边界划分**：

| 属于通用记忆内核（下沉到 dsh-math-memory） | 属于 Obsidian 壳（留在 dsh-math-notes-assistant） |
|---|---|
| 记忆注入引擎（buildMemorySection / dialogue index / 体检） | 服务管理（spawn/kill dsh、端口探测、日志） |
| 笔记工具 + BM25 检索引擎 + hook 解析 + tokenizer | 右侧栏 iframe 嵌入 |
| 确定性文件操作：applyFeedback / archiveMemoryFile / setCapturePolicyMode / archiveOldEpisodes 的**函数体** | loopback `/open`（`app.workspace.openLinkText` 跳笔记） |
| 捕获策略解析与注入、capture-policy 模板 | 捕获策略**下拉框 UI**（壳内控件，调用内核函数） |
| 15 个 vault 模板 + AGENTS.md 协议 | 皮肤 junction（syncGlobalPackageLinks） |
| 安装器（--workspace 任意文件夹） | 把 vault 路径写入 env（DSH_WORKSPACE_ROOT） |
| 缓存（dialogue-index / memory-audit / retrieval-stats） | 进程管理、日志文件 |

**具体改动清单**（Phase 1）：
1. 把 `applyFeedback` / `archiveMemoryFile` / `setCapturePolicyMode` / `archiveOldEpisodes` 从 `obsidian/main.template.js` 抽成纯函数，移入内核模块（输入 `workspaceRoot` + 参数，输出文件操作结果），插件只保留"读 `app.vault.adapter.getBasePath()` → 调内核函数"的薄封装。
2. 消除内核对 Obsidian 的 `require('obsidian')` / `app.*` 依赖——内核模块只依赖 `node:fs` / `node:path`。

---

### 问题 2：dsh 能否不基于 Obsidian、对任意文件夹实现记忆？现状差在哪？

**结论：能，而且成本不高；但现状是"部分能、当前不能"，差 4 处结构性 + 2 处一致性（引 t1/t3）。**

**现状差的点（结合 t1 耦合点清单逐条）**：

| # | 耦合点（t1/t3 发现） | 位置 | 是否阻碍"任意文件夹" |
|---|---|---|---|
| 1 | 记忆生命周期控制面在 Obsidian 宿主（t1 H1） | `main.template.js` applyFeedback/archiveMemoryFile/setCapturePolicyMode/archiveOldEpisodes | **是**（最关键） |
| 2 | 身份命名 "obsidian" 遍布（preset 名、profile 名、变量、section 名、文案、`MEMORY_DIR=".deepseek"` 之外还有大量 Obsidian 字样） | `dsh/preset/*`、`dsh/profile/*`、`main.template.js`、AGENTS.md | 否（仅命名，但阻碍"心智上通用"） |
| 3 | 出厂模板硬编码本机路径（t1 H3） | `dsh/templates/profile.md:30` `D:\Obsidian笔记数据库`；`scripts/qa/engine-probe.mjs:13`、`e2e.mjs:21` 回退硬编码 | 是（污染任何新安装） |
| 4 | `.deepseek` taxonomy + wikilink + `.obsidian/.trash` 约定（t1） | `DEFAULT_EXCLUDE_PATTERNS=[".obsidian",".trash",...]`（obsidian-notes.mjs:62）、`note_links` wikilink 反链、`.deepseek` 目录名 | 部分是（`.obsidian`/`.trash` 排除与 wikilink 是 Obsidian 专属） |
| 5 | vault 解析优先级两模块不一致（t3 High #3） | `obsidian-memory.mjs:1105`（env 优先）vs `obsidian-notes.mjs:87-94`（config 优先） | 是（行为分歧，安全边界内） |

**要移除的假设（"任意文件夹"清单）**：
1. **假设工作区根 = Obsidian vault**（有 `.obsidian/`、`.trash/`、wikilink）。→ 改为"任意工作区根 + 可配置排除模式 + 链接语法可配置（wikilink 反链降级为通用反链或可选开关）"。
2. **假设记忆目录名固定 `.deepseek`**。→ 改为可配置 `memoryRoot`（默认 `.deepseek` 向后兼容，新默认 `.dsh-math-memory`）。
3. **假设反馈/归档由 Obsidian 端点触发**。→ 下沉为内核纯函数 + 通用 loopback 端点（Phase 4 的 `/memory-panel/*` 同款）。
4. **假设 vault 路径来自 `DSH_OBSIDIAN_VAULT`**。→ 统一为 `DSH_WORKSPACE_ROOT`（保留旧名兼容）。
5. **假设会话 cwd 之外没有"选定工作区"入口**。→ 复用 dsh workspace 机制（workspaceRegistry，已有 `obsidian-workspace.mjs` 可通用化）。

---

### 问题 3：拆两个仓库是否更好？职责边界/依赖方向/发布物/版本/CI

**结论：双仓库更优（长期目标），但建议分两步——先在单仓内拆成 monorepo 多包（`packages/memory-core` + `packages/obsidian-plugin`），边界稳定后物理拆成两个 git 仓库。** 理由：t3 的 3 处"手工同步清单"（hook parser ×3、模板清单 ×3）和 t1 的"版本号三方无一致性门禁"都说明**当前单仓用"嵌入构建"把两个组件绑死，但内部却是靠人肉同步**；拆包能把这些同步变成"npm 依赖 + 单一事实源"。过早物理拆仓则会在边界未稳时引入跨仓版本同步成本，所以用 monorepo 过渡。

**职责边界**：

| | `dsh-math-memory`（记忆内核） | `dsh-math-notes-assistant`（Obsidian 插件） |
|---|---|---|
| 职责 | 记忆/检索引擎、确定性文件操作、模板协议、安装器、host-agnostic web 面板逻辑 | 服务管理、iframe、ItemView、/open /feedback、归档触发、皮肤 junction、vault 路径注入 |
| 依赖 | 只依赖 node 内置 + harness 注入（tools/fs/systemPrompt/loader/webServer/workspaceRegistry） | **依赖 `@dsh-math-memory/core`**（单向） |
| 发布物 | npm：`@dsh-math-memory/core`（纯函数库）+ `dsh-math-memory`（preset/profile/templates + bin `dsh-math-memory install --workspace`） | Obsidian 社区插件：`main.js` / `manifest.json` / `styles.css`（GitHub release，BRAT/社区分发） |
| 版本 | 独立 semver；**hook schema 版本化（修 t1 H2）**：`HOOK_SCHEMA_VERSION` 常量进 core | 独立 `manifest.json` version；`manifest` 里声明 `requires dsh-math-memory >= x.y` |
| CHANGELOG | 记记忆/检索/hook schema/模板契约变更 | 记 UI/服务/端点/兼容变更 |

**版本与 CHANGELOG 管理**：
- 内核每次改 hook frontmatter schema 必须 bump `HOOK_SCHEMA_VERSION`（现在无版本常量，t1 H2）——这是唯一跨仓协调点，也写进两份 CHANGELOG 的"Breaking"节。
- 插件 CHANGELOG 的"Breaking"节引用内核版本要求。
- 用一份 `templates-manifest.json`（内核发布物内）作为**模板清单唯一事实源**（修 t3 High #2），插件构建时从内核 npm tarball 读，消除 build/install/bootstrap 三处手写清单。

**构建与 CI 拆分**：
- 内核 CI：`node --check` + 63 项回归（`test-memory.mjs`）+ 安装器 e2e（`test-installer.mjs`）+ 引擎探针；发布 npm（含 core）。
- 插件 CI：`node scripts/build-obsidian.mjs`（从内核 tarball 嵌入）+ `git diff --exit-code main.js`（重建一致性门禁）+ **新增**"漂移检测"：断言嵌入内容 == 已发布内核版本（替代现在的"git diff 只能保证可复现、不能发现漏发"，t3 High #2）+ 现有测试；tag 触发 release。
- 替代方案（若坚持单仓）：保留单仓但把 `dsh/preset`、`dsh/profile`、`dsh/templates` 移入 `packages/memory-core/`，插件移入 `packages/obsidian-plugin/`，用 pnpm workspace 链接——是双仓之前的必经中间态，不冲突。

---

### 问题 4：math memory 与其他 memory 冲突怎么办？共存机制

**结论：现状是"整包抢占"——`obsidian` 是一个完整、自足的独立 profile（`dsh --profile obsidian`），`default preset=obsidian` 且工具面最小互斥（只有 tool-fs/tool-fs-search/ask-user/obsidian-notes），它不继承你主 profile 的任何 memory/工具（因为是不同 profile、不同进程）。所以不是"同时注入两次冲突"，而是"用了 math memory 就得整个换成 obsidian profile、放弃主 profile 的其它能力"——这是互斥，不是并存。**（依据：`cordis.patch.yml` 的 `agent-presets.config.default: obsidian` + `includeUserRoot: true` 只包含用户自建 preset，不包含主 profile 的装配；profile 是 `dsh --profile` 级别的整包。）

**拆分后：让 math memory 成为一个"可装配的记忆后端插件"而非"整包 profile"**：

1. **插件装配（推荐主路径）**：把内核做成一个 Cordis 插件（注入 `systemPrompt` + `tools` + `fs`），可以像现在这样被 `obsidian/notes-assistant` preset 引用，**也可以被任意 profile 的任意 preset 装配**——在用户的 `agent.cordis.yml` 里加一行：
   ```yaml
   - id: math-memory
     name: '@dsh-math-memory/preset'
     config: { workspaceRoot: 'D:/notes', enabled: true, memoryRoot: '.dsh-math-memory' }
   ```
2. **命名空间隔离**（共存的关键）：注入 section 名 `dsh-math:memory`（而非 `obsidian:memory`）、缓存目录 `<root>/.dsh-math-memory/cache/`（而非 `.deepseek/cache`）、环境变量前缀 `DSH_MATH_MEMORY_*`（而非 `DSH_OBSIDIAN_*`）、工具名可加前缀（默认保持 `note_recall` 等，但注册时声明 namespace，避免与其它 memory 插件重名）。
3. **多套记忆共存**：每套 memory 各配一个 `workspaceRoot`，互不覆盖；同一 profile 里可挂多个 memory 插件（各自 section 独立注入）。
4. **互斥（二选一）**：靠"profile 装配里只挂一个"实现，不是靠覆盖。
5. **profile 组合（辅）**：`--profile notes-assistant` 仍作为"开箱即用最小面"保留（向后兼容）；高级用户走"插件装配"把 math memory 挂进自己主 profile，彻底消除"整包抢占"。

---

### 问题 5：记忆系统只在学数学时打开？开关形态与语义

**结论：应该加开关，且不是单一 bool，而是"主开关 + 行为粒度开关"。推荐形态优先级：frontmatter（工作区根配置）＞ preset config（agent.cordis.yml 默认值）＞ 环境变量（紧急关停）＞ 命令（运行时切换）。**

**开关应控制的行为（六项，逐项可独立）**：

| 行为 | 开关 | 现状态 |
|---|---|---|
| 记忆写入（三写协议 + 捕获） | `write: on/off` + capture-policy（idea/fact/preference × auto/ask/off，已有） | 已有 capture-policy |
| 检索注入（note_recall 可用 + 记忆段注入） | `retrieval: on/off` | 无（总是开） |
| 对话索引扫描（dialogue index） | `dialogueIndex: on/off` | 无 |
| 提醒（备忘录 🔔） | `reminders: on/off` | 无（靠 prompt 文本自律） |
| 体检（audit 扫描） | `auditEnabled` | **已有**（agent.cordis.yml） |
| 捕获策略 | capture-policy 三档 | **已有** |

**推荐形态**：工作区根一个 `config.md`（或 `.dsh-math-memory/config.md`）的 frontmatter，用户维护、模型不改（与 capture-policy 同一纪律）：
```yaml
---
enabled: true        # 主开关：false = 完全停用（暂停）
mode: full           # full | readonly
write: auto
retrieval: on
dialogueIndex: on
reminders: on
audit: on
---
```
preset config 只放默认值；`DSH_MATH_MEMORY_ENABLED=0` 是进程级最后兜底；`/memory off` 或 `dsh-math-memory on|off` 是运行时切换（需 host 支持）。

**开/关语义（明确，不骑墙）**：
- **关 = 完全停用（暂停）**（推荐默认）：不写、不注入、不扫描、不体检、不提醒；文件与缓存**原样保留**；零 token、零 IO、零副作用。这最贴合"只在学数学时打开"——关掉即不存在。
- **只读（可选二级）**：`mode: readonly` = 仍注入已有记忆供检索，但不写新记忆、不回写 hook stats、不体检改写。适合"复习已有笔记但不想继续积累"。
- **卸载是另一个动作**：`dsh-math-memory uninstall`（或从装配里删插件行），**不与开关混用**。

---

### 问题 6：拆分后如何实现"工作区选定笔记 vault 文件夹"

**结论：把 `DSH_OBSIDIAN_VAULT` + `vaultRoot` + 硬编码路径三处统一为一个 `workspaceRoot` 概念，来源优先级统一，并提供三条"选定"入口。**

**具体做法**：
1. **统一命名 + 兼容别名**：新名 `workspaceRoot`（config）/ `DSH_WORKSPACE_ROOT`（env）；读取顺序固定为：`config.workspaceRoot → config.vaultRoot → env DSH_WORKSPACE_ROOT → env DSH_OBSIDIAN_VAULT → session cwd`（单一路径，消除 t3 High #3 的两模块优先级不一致）。
2. **抽共享解析函数**：`resolveWorkspace(config, env, agent)` 纯函数进 core，memory 与 notes 都调它，配一条黄金 fixture 同时测两处。
3. **"选定"入口（三条）**：
   - **Obsidian 侧（自动）**：插件仍把 `app.vault.adapter.getBasePath()` 写入 `DSH_WORKSPACE_ROOT`。
   - **CLI（显式）**：`dsh-math-memory install --workspace <dir>`（现 `--vault` 改名）。
   - **dsh 侧（运行时）**：会话开在哪个工作区，记忆就落在 `<cwd>/.dsh-math-memory/`；配合 workspace picker（通用化 `obsidian-workspace.mjs` → `math-memory-workspace.mjs`，注入 `workspaceRegistry` 自动注册）。
4. **去掉硬编码**：`dsh/templates/profile.md:30` 改成占位符「（待填充：你的笔记/工作区路径）」；`engine-probe.mjs`/`e2e.mjs` 的硬编码回退改为 `--workspace` 参数 + 临时 fixture 目录（cases.json 已存在，直接喂参）。

---

### 问题 7：preset 更名"笔记助手"涉及哪些改动点、如何兼容旧配置

**结论：值得改，且应趁拆分一起改（命名是 t1/t3 都点名的抽象泄漏源）。推荐目录/profile id 用 ASCII `notes-assistant`（避免中文目录/命令行的坑），显示名 `preset.yml name:` 用「数学笔记助手」。**

**改动点全清单**：
1. **文件名/模块名**：`obsidian-memory.mjs`→`math-memory.mjs`、`obsidian-notes.mjs`→`note-tools.mjs`；`export const name` 同步。
2. **profile 目录/文件**：`profiles/obsidian/`→`profiles/notes-assistant/`；`obsidian.patch.yml`→`notes-assistant.patch.yml`；`obsidian-workspace.mjs`→`math-memory-workspace.mjs`。
3. **install.mjs**：`PROFILE_NAME = "obsidian"`→`"notes-assistant"`；三路安装路径同步。
4. **cordis.patch.yml**：`default: obsidian`→`notes-assistant`；`permission.presets.obsidian-locked`→`math-memory-locked`（或保留但默认值改）。
5. **main.template.js**：`PRESET_NAME = 'obsidian'`→`'notes-assistant'`；`--profile notes-assistant`；`ensureObsidianPatch`→`ensureNotesAssistantPatch`。
6. **环境变量**：`DSH_OBSIDIAN_VAULT`/`DSH_OBSIDIAN_LINK_URL`/`DSH_OBSIDIAN_FEEDBACK_TOKEN`→`DSH_WORKSPACE_ROOT`/`DSH_MATH_MEMORY_LINK_URL`/`DSH_MATH_MEMORY_FEEDBACK_TOKEN`（旧名保留读取 + deprecation 日志）。
7. **文案/section**：注入段名 `obsidian:memory`→`dsh-math:memory`；AGENTS.md、preset.yml description、persona、错误消息里的 "Obsidian"/"vault" 措辞改通用。
8. **文档**：ARCHITECTURE / README（中英同步）/ design / retrieval-v3 / control-panel 等所有 "obsidian" 指代。

**兼容/迁移（避免旧配置失效）**：
- 安装器内置 `migrations/`（按版本顺序执行）。0.5.x→0.6.0 迁移 = rename 目录 + 写别名 shim + 保留旧 env 读取。
- **别名 shim**：若发现旧 `$DSH_HOME/.agent-presets/obsidian/` 与 `profiles/obsidian/`，写一个 `profiles/obsidian/cordis.yml` 只含「default preset = notes-assistant」一行转发（`--profile obsidian` 仍可用，只是转发），README 提示迁移到 `--profile notes-assistant`。
- 环境变量旧名保留读取（deprecation 警告），2 个版本后移除。
- 迁移前在 `npm test` 里加"旧目录存在时迁移脚本幂等"断言。

---

### 问题 8：Obsidian 功能按钮能否下沉到 dsh-math-memory？移动清单

**结论：判据是"确定性文件操作"（能下沉）vs "Obsidian API 交互"（必须留）。**

| 功能 | 能否下沉 | 理由 / 做法 |
|---|---|---|
| 记忆面板浏览/搜索/编辑 | ✅ 能 | 数据是 markdown，读/写/搜是通用 fs；mtime 冲突防护通用 |
| ✅/❌ 反馈（confirm/wrong/stale/forget 确定性改写） | ✅ 能 | 把 applyFeedback/archiveMemoryFile 函数体下沉为 core 纯函数（t1 H1）；Obsidian 的 /feedback 只是同一函数的一个壳入口 |
| 捕获策略下拉框 | ✅ 能 | setCapturePolicyMode 是通用 frontmatter 写回；下沉函数体，UI 换成 web 面板控件 |
| 归档按钮（archiveOldEpisodes） | ✅ 能 | 归档是通用 fs move；下沉函数体，触发改为面板按钮/定时任务 |
| 体检报告展示 | ✅ 能 | audit 报告是 JSON，web ui 直接渲染 |
| `/open` 跳转笔记 | ❌ 留 | `app.workspace.openLinkText` 是 Obsidian 专属（跳到 Obsidian 编辑器）；通用侧最多"打开文件位置/预览" |
| 右侧栏 iframe 嵌入 | ❌ 留 | 把 dsh web 嵌进 Obsidian 本来就是壳能力 |
| vault 文件操作（`app.vault.adapter.getBasePath()`、vault 索引打开） | ❌ 留（但读写本身通用） | 留的是"用 Obsidian 的 vault 路径/索引打开"，文件读写本身下沉 |
| 服务进程管理（spawn/kill dsh、端口探测、日志） | ❌ 留 | host 职责，web ui 不能 spawn 宿主外的 node 进程 |
| 皮肤 junction（syncGlobalPackageLinks） | ❌ 留 | Obsidian 宿主文件系统 hack |

**一句话**：下沉后，Obsidian 面板从"功能的唯一实现"退化为"core 面板在壳内的宿主 + 薄 UI"，三处 parser 重复（t3 High #1）随之消除。

---

### 问题 9：适配 dsh web ui 的可行路径

**结论：承接 control-panel.md §3 的 C（混合）方案，但把"记忆面板逻辑"先抽成 host-agnostic 数据层，再分短期/中期/长期三步把 UI 从 Obsidian ItemView 迁移到 dsh web ui 列。**

**现状与可用槽位**（引 control-panel.md §3 实测）：obsidian profile 已 bundle `dsh-web-app` + 挂 `ui-web-ui-settings` + `ui-skin-center`；右侧栏 iframe 已是 dsh web ui。但官方客户端槽位**只有 `conversation.input.dock`**，**没有官方右侧大面板槽位**——aionui 的"预览/文件/变更"列是**自行挂载 DOM 列**实现（监听 `ctx.sessions.list` 拿 cwd，固定定位渲染右列，宽窄/折叠用 localStorage）。宿主侧能力：`webServer.register({kind,path,handler})`、`workspaceRegistry`、`systemPrompt` 注入、workspace gate（canonicalize + 前缀包含）。

**迁移路径**：
1. **短期（Phase 1-2）**：把 `collectMemoryState` / `applyFeedback` / `archiveMemoryFile` 抽成 core 的 host-agnostic 数据层；Obsidian ItemView 变薄，只调用 core 函数（先消除 t3 High #1 的 parser 三份重写）。
2. **中期（Phase 4）**：做 A 方案最小版——内核加一个 host-agnostic `math-memory-web` 插件（注入 `webServer` + `workspaceRegistry`，挂 `/memory-panel/*` 路由，workspace gate 复用 aionui 的 canonicalize + 前缀包含），客户端加一个 tsdown 列包 `@dsh-math-memory/client-ui-panel`（照抄 aionui 自挂列模式）。
3. **长期**：dsh web ui 出现官方右侧槽位后，列从自挂 DOM 迁到官方槽位。

**需要新增的槽位/能力**：
1. host-agnostic `/memory-panel/*` 路由插件（core 内，注入 webServer + workspaceRegistry）。
2. 客户端 tsdown 列（新包，自挂列 + localStorage 折叠持久化）。
3. `math-memory-workspace.mjs`（把 `obsidian-workspace.mjs` 通用化，注入 workspaceRegistry）。
4. 向上游提"官方右侧面板槽位"需求，降低自挂 DOM 的维护成本（control-panel §3 已指出这是 A 方案的主要风险）。

---

## 三、重构路线图

| 阶段 | 关键改动 | 主要风险 | 验收标准 |
|---|---|---|---|
| **Phase 0 清文档漂移**（零代码） | 修 t2 的 4 条 Critical + 4 条 High：retrieval-v3 标题 vs 状态表、v2-proposal note_retrieve 状态、handoff 滞后 2 版、design §10 旧系统、§9 三个→四个工具、control-panel 头"1c 规划中"、README TL;DR 现状 | 几乎无（纯文档）；注意 README 中英同步 | `grep` 确认无"待用户抉择后实施"vs"已实现"矛盾；状态表与 0.5.1/note_recall/63 断言一致 |
| **Phase 1 解耦命名与路径** | 更名 notes-assistant（Q7 全清单）；统一 `resolveWorkspace`（Q6）；去硬编码路径（profile.md/engine-probe/e2e）；抽共享 hook parser 模块 + 单一 templates-manifest（修 t3 High #1/#2）；下沉确定性文件操作函数体（t1 H1） | 更名导致旧安装失效（用 migration + 别名 shim 化解）；parser 合并引入回归（用黄金 fixture 三处同测） | `npm test` 63 断言 + 安装器 e2e 全绿；`--profile obsidian` 仍可用（shim 转发）；CI 的"扫描 templates/*.md 断言全被 manifest 引用"通过 |
| **Phase 2 拆仓库** | monorepo 多包 → 物理双仓；hook schema 版本化 `HOOK_SCHEMA_VERSION`（t1 H2）；发布物/CHANGELOG/CI 拆分（Q3）；插件构建改从内核 npm tarball 读 manifest | 跨仓版本同步（用 requires 约束 + 漂移检测化解）；monorepo→双仓的 git 历史迁移 | 内核 CI 独立发布 npm；插件 CI 的"嵌入==已发布内核版本"漂移门禁通过；`git diff --exit-code main.js` 通过 |
| **Phase 3 开关与共存** | 主开关 + 行为粒度开关（Q5）；命名空间隔离（section 名/缓存目录/工具名/env 前缀）；"插件装配"共存路径（Q4）；CLI `--workspace` | 开关语义不清导致数据意外停写（明确"关=暂停、readonly=只读、卸载=独立动作"）；多 memory 重名（命名空间注册） | 关掉后零 token/零 IO（e2e 断言）；同 profile 挂两套 memory 各注入各自 section 不冲突 |
| **Phase 4 web ui 适配** | core 数据层 + `/memory-panel/*` 宿主路由 + 客户端 tsdown 列（Q9）；`math-memory-workspace.mjs` | 自挂 DOM 与 shell 内部结构耦合、shell 升级可能碎（control-panel §3 已预警） | 记忆面板在 dsh web ui 列可用（浏览/搜索/编辑/反馈/归档）；Obsidian 侧仍保留 /open 跳转 |

---

## 四、结论依赖索引（哪些结论依赖 t1/t2/t3 的哪些发现）

- **Q1（边界）、Q2（差 4 处）、Q8（移动清单）** → t1 H1（控制面在宿主）、t1 耦合点清单、t3 High #3（vault 解析不一致）。
- **Q2（硬编码）、Q6（去硬编码）** → t1 H3（profile.md:30 硬编码 `D:\Obsidian笔记数据库` + engine-probe/e2e 回退）。
- **Q3（hook schema 版本化、模板清单单一事实源）** → t1 H2（hook schema 无版本常量）+ t3 High #1/#2（parser ×3、模板清单 ×3）。
- **Q4（整包抢占）** → `cordis.patch.yml` default preset + 最小工具面（自读核实）。
- **Q7（更名清单）** → t1 "preset 名三处硬编码" + t3 命名泄漏清单。
- **Q9（web ui 路径）** → control-panel.md §3 A/B/C + aionui 自挂列实测（t2 指出该文档头部状态标注漂移，但 §3 实测内容与代码一致，可采信）。
- **Phase 0（清漂移）** → t2 的 4 Critical + 4 High 清单。
