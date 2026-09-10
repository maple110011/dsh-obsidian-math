# 会话隔离：Obsidian 侧只看笔记会话（评估备忘）

> ## ❌ 已否决（2026-09-10，用户决定）
>
> **结论：不做。** 本文全部方案（P1 包 `list()` 过滤 / P2 给 `dsh-workspace` 加 scope 配置 / P3 换会话库 root / P4 折叠）**均不实施**，本节以下内容仅作为"当时怎么想的"存档，不要再按它排期。
>
> 否决理由（按权重排序）：
>
> 1. **需求本身消失了**。当时的不适来自"记忆面板被别的工作区干扰"，而真正的原因是**面板只渲染了极少数记忆层、且信息量太低**——现在面板有了工作区下拉、五层卡片、⚠️ 待处理与结构化体检摘要，侧栏列表混着几个 coding 分组已经不影响使用。
> 2. **代价与收益不成比例**。P1 要在 Obsidian profile 里包住 `sessionPersistence.list()`，而同一个 `list()` 还被会话搜索、lineage/subagent 继承、按 URL 直接打开会话消费——收益只是"少看几个分组"，风险却是"某个被过滤掉的会话打不开"。P2 要改 npm 安装的 `dsh-workspace` 本体（升级即被覆盖）。P3 连需求都不满足（见 §3 的警示）。
> 3. **有零成本的替代**：侧栏分组本来就可以折叠，且折叠状态持久化（§3 P4）。
>
> 若将来真的需要"按用途收窄会话列表"，**先确认不是**因为面板/检索的信息组织问题又变得难用；真要动手时从 P1 开始，并逐项实测 §3 列出的三个消费方。

> **原状态（评估时）**：已评估，暂缓实施。本文只记录设想、取证、可选方案与取舍，供之后决定怎么改。写于 2026-09-10，基于当时本机实测与 `@deepseek-ai/dsh` 的已安装版本。

## 1. 需求（用户原话）

> 「我其实希望在 Obsidian 里只显示笔记相关会话，在 coding 侧可以显示所有对话。」

关键点是**非对称**：

| | 会话列表可见范围 |
|---|---|
| Obsidian 内的 dsh | **只**笔记库（vault）相关会话 |
| 平常 coding 用的 dsh | **全部**会话（含笔记会话） |

即：**收窄 Obsidian，不缩小 coding。**

## 2. 现状取证

### 2.1 磁盘上已经按工作区分目录

会话日志路径为 `$DSH_HOME/sessions/<projectKey(cwd)>/<session-id>/session.jsonl.zstd`，`projectKey` 定义见 `@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js:106-125`（路径分隔符/盘符折成 `-`，非 ASCII 转 `~XXXX`，整体包成 `--…--`）。

本机实测：5 个项目目录，笔记库是 `--D-Obsidian~7B14~8BB0~6570~636E~5E93--`（40 份日志 / 6.6 MB），其余是 coding 项目（合计 349 份 / 368 MB）。

**所以「文件夹区分」确实已经存在，但那只影响磁盘布局，不影响任何 UI。**

### 2.2 Obsidian 实例当前暴露全部工作区分组

直接查询运行中的 Obsidian 实例（3180 端口，`math-memory-panel.mjs` 的 workspace 路由）：

```
$ curl "http://127.0.0.1:3180/memory-panel/workspaces?root=D%3A%5CObsidian%E7%AC%94%E8%AE%B0%E6%95%B0%E6%8D%AE%E5%BA%93"
书籍译介             E:\临时文档及草案\译介工作\书籍译介
personal_website     E:\software\ss\personal_website
Obsidian笔记数据库    D:\Obsidian笔记数据库
Deepseek-Harness     E:\software\ss\Deepseek-Harness
```

4 个分组，笔记库只是其中之一 —— 与用户"混在一起"的感受一致。

### 2.3 为什么没有现成开关

1. **列表是"扫出来的"而不是"配出来的"**：`dsh-workspace/lib/index.js:571-613` 的 `bootstrap(headers)` 把存储里**所有**会话按 `cwd` 分组，并为**每个不同路径自动建一条工作区记录**（`:596-613`）。没有白名单 / 允许列表的概念。
2. **唯一的"隐藏"机制是全局的**：`archiveSession()`（`dsh-workspace/lib/index.js:406-432`）把会话从所有列表里藏掉；前端 `sessionVisible()`（`dsh-client-ui-workspace/lib/client.js:95-100`）对 archived 会话返回"任何地方都不可见"。但这份状态存在 **`$DSH_HOME/storages/workspace.json`** —— 本机确认该文件存在，且 **DSH_HOME 是所有 profile 共用的**，因此在 Obsidian 侧归档会连带在 coding 侧一起消失。⇒ 无法做非对称。
3. **没有任何 scope 配置**：`dsh-workspace` 没有 `static Config`；前端只持久化 `groupExpansion` / `sessionOrderByAccount` / `sessionUpdatedAtByAccount`（key `dsh.workspace.view.v5`，`dsh-client-ui-workspace/lib/client.js:30-49`）。⇒ 分组**可折叠但不能过滤**。

### 2.4 会话库根目录是可配的（但与需求不匹配）

`dsh-base/cordis.patch.yml:98-101` 声明：

```yaml
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js dshHomePath('sessions')
```

该插件 schema 里 `root` 必填（`dsh-session-persistence-jsonl/lib/index.js:771`），构造时 `resolve(config.root)`（`:791`）。notes-assistant profile 加载的正是 `dsh-base`，所以**可以按 profile 换库**。

⚠️ 但换库的语义是「换一个库」而不是「过滤」：Obsidian 只看笔记 ✓，**coding 侧就再也看不到笔记会话了** ✗ —— 恰好是需求的反面。这一条是上一版方案的错误所在，务必别重犯。

## 3. 候选方案与优劣

### P1 · 在 notes-assistant profile 内包一层 `list()` 过滤 ⭐ 推荐优先试

在 Obsidian profile 里加一个 host 插件（形态照抄现有 `dsh/host/math-memory-panel.mjs`），注入 `sessionPersistence`，把它对外的 `list()` 包成"只保留 `header.cwd` 落在 vault 内的会话头"。`dsh-workspace.bootstrap()` 拿到的是过滤后的列表，于是**只渲染笔记这一个分组**。

- **优点**
  - **天然只影响 Obsidian 侧**：coding 是另一个进程、另一套 composition，完全不受影响 ⇒ 正是要的非对称。
  - 不改 `node_modules`，随 profile patch 走，可回滚。
  - 命中点明确：`dsh-workspace` 的三处取用都在 `ctx.sessionPersistence.list()`（`dsh-workspace/lib/index.js:321`、`:324`、`:442`）。
- **已核对的安全性**：`bootstrap()`（`:596-642`）对共享表**只新增/更新、从不删除**，`workspaceIds` 由全部表项重排（`:629-642`）；`validateStoredState`（`:644-668`）的一致性约束也不会被过滤破坏。⇒ 共享表安全，coding 侧的分组不会丢。
- **风险 / 必须先验证**
  - 同一 profile 内其它 `list()` 消费方：会话搜索（`sessionQuery`）、lineage / subagent-fork 继承、按 URL 直接打开某个被过滤掉的 id。**需要逐个实测**，不能先假设无副作用。
  - 执行时机：patch 必须在 `dsh-workspace` 首次 bootstrap 之前生效。
  - `listSnapshots()` 是另一条路径，是否也要一并包。
- **落点**：`dsh/profile/notes-assistant.patch.yml` 的 `insert:` 块 + 新增一个 host 插件文件，并进 `scripts/build-obsidian.mjs` 的嵌入清单。

### P2 · 给 `dsh-workspace` 加真正的 scope 配置

例如 `config.onlyPaths: string[]`，在 `bootstrap()` 分组时过滤。

- **优点**：语义正确、干净，是"上游该有的东西"；一处配置即可表达需求。
- **缺点**：要改 `dsh-workspace` 本体，而它是 **npm 安装的包**——本地改 `node_modules` 不持久（`npm i` / 升级即被覆盖）。除非推给上游，否则得自带一份 patch 流程。
- **落点**：`dsh-workspace/lib/index.js` 的 `bootstrap()` + 新增 Config schema。

### P3 · 独立会话库（换 `session-persistence-jsonl` 的 `root`）

- **优点**：改动最小、harness 原生支持；笔记会话与 coding 会话彻底分离，互不干扰。
- **缺点**：**不满足需求**（coding 侧会看不到笔记会话）。⇒ 仅当用户愿意接受"笔记历史只在笔记侧可见"时才是选项。
- **附带事实**：从终端跑 `dsh --profile notes-assistant` 仍可正常使用笔记助手，并不会被锁死在 Obsidian 里；失去的只是"在**默认 coding profile 的列表里**看到笔记会话"。

### P4 · 零风险临时手段：折叠

侧栏里手动把 3 个 coding 分组折叠，折叠状态会持久化（`groupExpansion`）。

- **优点**：不动任何代码，立即改善观感。
- **缺点**：它们仍在列表里、仍可被搜索命中，不是真正的"只显示"。

## 4. 顺带发现的两个真实缺陷（**已修**）

| 位置 | 问题 | 处置 |
|---|---|---|
| `dsh/host/math-memory-panel.mjs` | `sessionsRoot()` **硬编码** `$DSH_HOME/sessions`，无视 `DSH_SESSIONS_ROOT` | 已改为 `DSH_SESSIONS_ROOT` 优先，与 preset 对齐 |
| `obsidian/main.template.js` | 传了 `DSH_SESSIONS_ROOT`，但 harness **没有任何包读它** | 保留（记忆侧确实在用），补充注释说明其真实作用域，避免误以为是 UI 开关 |

要点：**`DSH_SESSIONS_ROOT` 不是会话列表开关**。它只被记忆 preset 与（修复后的）host 面板路由消费；侧栏列表跟的是 `session-persistence-jsonl` 的 `root` 配置。将来若做 P1/P2，别再指望这个环境变量。

## 5. 决策清单（之后回来做决定时逐条回答）

1. 走 P1 还是 P2？（P1 见效快但需实测消费方；P2 干净但要维护 harness 改动）
2. 若走 P1：只包 `list()`，还是连 `listSnapshots()` 一起？
3. 过滤判据用 `header.cwd` 落在 vault 内即可，还是还要额外限定"仅当前 vault"（多 vault 场景）？
4. 被过滤掉的会话是否仍允许通过 URL / 搜索打开？（"只显示" vs "只显示且不可用"）
5. 是否需要"临时查看全部"的逃生开关（便于排查）？
