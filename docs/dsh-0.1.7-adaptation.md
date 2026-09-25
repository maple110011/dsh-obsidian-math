# DSH 0.1.5-rc.3 → 0.1.7-rc.2 适配：评估与实施计划

> **状态：P0 与两条 P1 已实施并全绿（2026-09-25；`node scripts/run-gates.mjs` = 44/44）。**
> 本文记录 `@deepseek-ai/dsh` 从本插件适配过的 `0.1.5-rc.3` 前进到 `0.1.7-rc.2`（本机实装版本）期间，
> 上游变更对本项目的影响、取证与适配清单。前一份同类文档是
> [`dsh-0.1.5-adaptation.md`](dsh-0.1.5-adaptation.md)（V2 → V3，已实施）；本文接续它。
>
> **实施结果速览**：A1 preset 声明化（含 A1b 那条失效的 `agent-presets` patch 行）、
> A2 V4 世代号判据、A3 悬空镜像清理、**A4 真机验收（新增门禁 `test: deployed profile accepts a session`）**、
> **B1 `peerDependencies`/`dsh.engines.dsh` 版本声明（含版本一致性门禁里的一致性断言）** —— **已落地**，
> 每项都有"先在旧代码上跑红"的变异证据。`node scripts/run-gates.mjs` = **45/45**。
> 仍未做：C1/C2（设置搬到插件 `Config`、locale/icon）与 B4（`decodeZstdSessionLog` 名字统一），见 §5/§9。
>
> **写于本轮**，基于本机实测：`@deepseek-ai/dsh@0.1.7-rc.2`、`@linxin666/dsh-web-all@0.4.2`、
> 556 份真实会话日志（392 × V2 / 147 × V3 / 17 × V4）。所有结论带 `文件:行号` 或命令原文；
> 推断处标注【推断】，无法确证处标注【待取证】并写进 §9。
>
> ⚠️ **先说结论**：这不是一次"补几个字段"的适配。**插件当前在 0.1.7 上是坏的** ——
> 侧栏会起服务、路由也能通，但**新建会话直接失败**（`agent-preset/not-found`），
> 用户看到的是"点了没反应"。另有两条**静默**的数据陈旧缺陷（V4 日志选择、皮肤包名镜像）。

---

## 1. 一页结论

| # | 类别 | 结论 | 严重度 |
|---|---|---|---|
| 1 | **阻塞** | `notes-assistant` agent preset 不再被识别。0.1.7 起 preset 由插件在激活时**向 `ctx.agentPresets` 注册**，`$DSH_HOME/.agent-presets/<id>/` 已无人读取。本机实测 `agent-preset/not-found: Unknown agent preset: notes-assistant`，`available=["standard","ptc","minimal","cordis"]` | **P0 阻断（会话起不来）** |
| 2 | **静默失效** | V4 会话日志已在本机出现（`session.v4.jsonl.zstd` × 17），而"同一会话取权威版本"的判据**只认 `.v3.`**（[math-memory.mjs:626-631](dsh/preset/math-memory.mjs#L626-L631) / [memory-admin.mjs:1222-1227](dsh/host/memory-admin.mjs#L1222-L1227)）。实测**已有 2 个会话目录 v3+v4 并存且 v4 更新** ⇒ 插件**显式选旧 v3**：对话索引落后、自动捕获判"无增量"⇒ 新轮次永不落盘 | **P1 静默（数据陈旧）** |
| 3 | **静默失效** | `@linxin666/dsh-web-all` 0.3.20 → **0.4.2**：旧的逐包 `@linxin666/*` 被并入聚合包，插件镜像进 Obsidian profile 的 junction 已有 **9 条悬空**（含 `dsh-web-ui-all`、`dsh-skins`、`dsh-doctor`…）。自愈逻辑只在插件启动时跑一次，且下次镜像时被 `existsSync` 判为"健康"而跳过 | **P1 静默** |
| 4 | 未声明 | 0.1.7 新增**插件 × DSH 版本兼容性门禁**（例外文件 `profiles/<p>/compatibility.json`），它读的是 **`peerDependencies`**（不是 `engines.dsh`）——而本仓 `package.json` 既无 `peerDependencies["@deepseek-ai/dsh"]`、也无 dsh 下限 | P2 |
| 5 | **静默失效** | `dsh/profile/cordis.patch.yml:18-21` 那条 `- id: agent-presets` 的 patch **在 0.1.7 上匹配不到任何行**：发行 id 已改为 `agent-preset-registry`，且 `includeUserRoot` 全库零命中。patch 匹配不到**只 warn 并跳过** ⇒ 连"默认预设 = notes-assistant"这层配置也一起没了 | **P1 静默** |
| 6 | 契约面 | `dsh.web` 的设置改由**当前 Profile 的插件配置**（插件 `Config` schema + `meta.volatile`）保存；插件不该再依赖 `settings.yaml`（本仓确实没用，但**该能力正好能替掉**插件自己那套开关） | P2 |
| 7 | 明确不受影响 | profile patch 行、`!!js` 标签、`ctx.webServer` 路由、`ctx.workspaceRegistry`、`system-prompt/assemble` 注入钩子、`settings.section` 槽位、401+token 反代握手 —— 在本机 0.1.7-rc.2 上**实测仍然工作**（见 §3） | — |
| 8 | 明确不用改 | `snapshotEvents/eventAt/ownEvents`、`readBytes`、`settings.yaml`、`spill-policy`/`maxInlineBytes`、`ctx.agent`、Inbox API、`agent/created`、PTC/E2B/Ralph/Team 改名 —— 本插件**一处都没用**（逐条带搜索关键词见 §7） | — |

**一句话**：**修三件事（preset 迁移 + 那条已死的 `agent-presets` patch 行、V4 选择判据、镜像失效清理），
声明一件事（`peerDependencies` 版本下限），再决定一件事（设置搬到插件 Config）**。
其中第一件不做，另外几件都没有端到端验证的现场。

---

## 2. 版本断代与"适配了什么版本"的口径

先说清"上次适配的是哪一版"，因为它决定本次要读的变更面：

| 事实 | 证据 |
|---|---|
| 本机实装 dsh | `0.1.7-rc.2`（`C:\Users\小新air15\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\package.json`） |
| npm `@deepseek-ai/dsh` 的 `dist-tags` | `latest=0.1.5-rc.3`、`next=0.1.7-rc.2`、`alpha=0.1.7-alpha.2`。**`0.1.5-rc.3` 确实存在**（就是 `latest`），但它**没有 GitHub release**，因此没有单独的 release notes |
| GitHub 上 `0.1.5-rc.2` 之后 | 只有 `0.1.6-alpha.1/2`、`0.1.7-alpha.1/2`、`0.1.7-rc.1/2`（`releases?per_page=100` 全量拉取） |
| **因此本适配要读的变更面** | `0.1.5-rc.2 → 0.1.7-rc.2`。上游自己在 [0.1.7-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1) 的正文里写明：*"作为 0.1.7 系列的首个候选版本，本版本汇总了自 **v0.1.5-rc.3** 以来的主要用户和开发者相关变更"* ⇒ 与我们的口径一致 |
| 本机 web profile 实装 | `@linxin666/dsh-web-all` **0.4.2**（`~/.dsh/profiles/web/package.json` 为 `^0.4.2`），其 `dsh.engines.dsh = ">=0.1.7-rc.2"`、`peerDependencies["@deepseek-ai/dsh"] = ">=0.1.7-rc.2"` |
| web-all 的版本曲线 | `0.3.20`（engines `>=0.1.5-rc.1`）→ `0.3.24`（同）→ **`0.4.0`（engines `>=0.1.7-rc.1`）** → `0.4.2`（`>=0.1.7-rc.2`）。**0.4.0 是断代点**：全家桶与 0.1.7 cohort 绑定 |

> 口径提醒：上一份适配文档 §1 记的是"宿主 0.1.5-rc.1 + web-all 0.3.20"。本轮两个都在 0.1.7 cohort 上，
> 所以"宿主升级"和"web 插件升级"这次是**同一件事**（不像上次那样可以分开归因）。

---

## 3. 先说仍然有效的东西（本机实测，避免过度适配）

这一节的作用是**防止把"能用的"当"坏的"改掉**。全部在本机 0.1.7-rc.2 上实跑：

| 检查 | 命令 / 落点 | 结果 |
|---|---|---|
| 侧栏鉴权握手（0.1.5 引入的 401 + token + SameSite=Strict 问题） | `node scripts/test-panel-auth.mjs`（**对真实 dsh**：spawn 真进程、抓 `?token=`、经 `DshWebProxy` 取回页面） | **8/8 通过** ✅ |
| 面板路由与信任边界 | `node scripts/test-panel-routes.mjs` | **47/47 通过** ✅ |
| 反代转发规则（stub 复刻权威 + cookie） | `node scripts/test-panel-proxy.mjs` | **32/32 通过** ✅ |
| 记忆回归（引擎、捕获、蒸馏、索引） | `node scripts/test-memory.mjs` | **386/386 通过** ✅ |
| 工具返回值严格 schema 校验 | `test: tool output schemas vs dsh validator` | **22/22 通过** ✅ |
| 工具输出形状（真实管线） | `test: tool output shape (real pipeline)` | **11/11 通过** ✅ |
| profile patch 合成 + `!!js` 标签 + 五条 posture 行 | `test: agent preset mounts (real dsh)` 的 seed 阶段 | seed 成功、dsh 启动并打印带 token 的地址 ✅ |
| **全量门禁** | `node scripts/run-gates.mjs` | **42/43 通过**；唯一失败 = 下面的 preset 断代 ❌ |

**结论**：`ctx.webServer` / `ctx.workspaceRegistry` / `settings.section` 槽位 / `!!js` patch 标签 /
`system-prompt/assemble` 注入面 / 401+token 反代**都不需要改**。上一份适配文档 §4 C 表里那条
"profile patch 全部行 id 与 schema 在 0.1.5 下仍有效"的结论，**在 0.1.7 上继续成立**。

---

## 4. 上游变更 → 本项目影响（只列有交点的）

### 4.1 必修 · P0：preset 断代

**上游变更**（0.1.7-rc.1 其他变更）：

> *「Agent 预设改由插件组合包声明和安装，可通过创造模式创建或覆盖；设置页保留查看与选择，
> 移除复制、删除和打开目录入口，**旧目录预设需迁移**。」*

**本机实测**（`node scripts/run-gates.mjs`，本机 HEAD 干净复现）：

```
FAIL test: agent preset mounts (real dsh, no tokens)  (exit 1)
  [seed] C:\WINDOWS\TEMP\dsh-preset-home-RV0naE\profiles\notes-assistant：13 个文件 + node_modules 链接，preset=true
  [FAIL] session/create 返回 ok:true（preset 能挂载）
    {"result":{"ok":false,"error":{"code":"agent-preset/not-found",
      "message":"Unknown agent preset: notes-assistant",
      "details":{"available":["standard","ptc","minimal","cordis"]}}}}
```

**耦合面**（`dsh/host/preset-sync.mjs` 把 `dsh/preset/` 同步到 `$DSH_HOME/.agent-presets/notes-assistant/`）：

| 落点 | 内容 |
|---|---|
| [dsh/host/index.mjs:63](dsh/host/index.mjs#L63) | 启动时调用 preset 同步 |
| [dsh/host/preset-sync.mjs:98-130](dsh/host/preset-sync.mjs#L98-L130) | 就地把 `dsh/preset/**` 拷进 `.agent-presets/<id>/`（含 `.owner.json` 归属标记） |
| [dsh/profile/cordis.patch.yml:18-21](dsh/profile/cordis.patch.yml#L18-L21) | patch 行 `id: agent-presets` + `config.{default, includeUserRoot}` |
| [dsh/install.mjs:260](dsh/install.mjs#L260) / [:431](dsh/install.mjs#L431) | 安装/卸载路径也操作同一目录 |
| [obsidian/main.template.js:1726](obsidian/main.template.js#L1726) | 插件侧"写 `.agent-presets`"的旁路 |
| [dsh/preset/preset.yml](dsh/preset/preset.yml) | 展示元数据（`name`/`description`/`order`） |
| [dsh/preset/agent.cordis.yml](dsh/preset/agent.cordis.yml) | 预设的组合行（persona / agent-instructions / tool-fs / tool-fs-search / tool-ask-user / 本地 `./math-memory.mjs`） |

**迁移目标形状（两条路，都有实证）**：

**路 A（原生声明行，最小改动）**：预设就是"插件组合包里的一条普通 Cordis 行"，指向
`@deepseek-ai/dsh-agent-preset`，其 Config 只有五个字段（本机 `dsh-agent-preset/lib/index.js` 全文 29 行）：

```js
static Config = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  order: z.number(),
  plugins: z.array(z.any()).required()
});
```

⇒ 与现有 `preset.yml`（`name`/`description`/`order`）+ `agent.cordis.yml`（`plugins`）**天然同构**。
**路 B（registry 声明）**：host 插件激活时 `ctx.get("agentPresets")` 后 `register(definition)`，拿回 disposer。

| 路径 | 好处 | 代价 |
|---|---|---|
| **A** 在 bundle patch 里加一条 `@deepseek-ai/dsh-agent-preset` 行 | 改动最小；不用碰 host 代码；上游自带 lifecycle | 预设内容要以 `plugins:` 形式内联进 patch，**两份真相**（`dsh/preset/*.yml` 与 patch）需要门禁钉住 |
| **B** host 插件激活时 register | 保持"`dsh/preset/` 是唯一真相"；停用即注销；与 [dsh-native-refactor.md](dsh-native-refactor.md) 的方向一致 | 要确认相对模块解析（下表）与 disposer 生命周期 |

> **路 A 的行形状已从本机实装逐字取到**（`dsh --profile notes-assistant --dump-config` 的 `preset-standard` 条目）：
>
> ```yaml
> - id: preset-standard
>   name: '@deepseek-ai/dsh-agent-preset'
>   config:
>     id: standard
>     order: 1
>     plugins:
>       - id: persona
>         name: '@deepseek-ai/dsh-persona'
>         config: { suffix: Your working directory is {{cwd}}., prefix: … }
>       - id: tool-bash
>         name: '@deepseek-ai/dsh-tool-bash'
>         disabled: !!js process.platform === 'win32'
> ```
>
> ⇒ `disabled` 与 `!!js` 在同一条行里都被支持；本仓 `agent.cordis.yml` 的 6 条行**没有** `!!js`，可整段搬。
> 默认行 id 是 **`agent-preset-registry`**（`dsh-web-app/cordis.patch.yml:558-562`），不是 `agent-presets`。
>
> **相对模块解析的锚点也已确证**：相对 `name:` 由 loader 的 **`ctx.baseUrl`**（config-tree anchor）解析
> （`dsh-typert-loader/lib/index.js:220-222` 原文：*"ctx.baseUrl is unset — the loader needs the
> config-tree anchor to resolve plugin packages"*；workspace 文件侧同法用
> `createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')`，
> `dsh-client-modules/lib/index.js:756`）。**后果**：`./math-memory.mjs` 只有在
> "组合文件与那些 `.mjs` 同目录"时才能解析 ⇒ **两条路都得把 `dsh/preset/**` 落到一个真实目录**，
> 这正是现有设计在做的事（npm 通道用包内 `dsh/preset/`，Obsidian 通道写
> `$DSH_HOME/.agent-presets/notes-assistant/` 并由插件每次启动重写）。

**活样例**：`@linxin666/dsh-liangshen@0.4.2` 走的是路 B，其注释与代码可作模板
（`presets/liangshen/` 里就躺着 `agent.cordis.yml` + `preset.yml` + 7 个 `.mjs`）：

```
// lib/index.js:504-517（注释）
// Host half only: at activation it DECLARES the bundled LiangShen agent preset
// to the harness's agent-preset registry (`ctx.agentPresets`) ... Declare = enabled ...
// nothing is written to the harness home.
```

| 要素 | 实证（`dsh-liangshen/lib/index.js`） | 对我们的含义 |
|---|---|---|
| 服务名与获取方式 | `ctx.get("agentPresets")`，拿不到就 warn（:644-650） | 【推断】host 插件 `inject` 需加该服务名，或按样例 try/catch 取 |
| 注册 API | `release = await registry.register(definition)`，返回 **disposer**（:691） | 生命周期由声明方持有；卸载/停用即注销 |
| definition 形状 | `{ id, ...preset.yml 元数据, plugins: [组合行…] }`（:386-399） | **现有 `preset.yml` + `agent.cordis.yml` 可原样复用** |
| 卸载清理 | `ctx.effect(fn, label)` 的返回函数里 `undeclare()`（:722-732） | 我们已有 `ctx.effect` 用法（[math-memory-panel.mjs:262](dsh/host/math-memory-panel.mjs#L262)） |
| 设置热更新 | `ctx.on("loader/volatile-update", rearm)` + Config 字段 `.volatile()`（:559-568, :719-721） | 见 §4.4(b) |

> ⚠️ **路 B 的 API 名有两个陷阱**（T1 实测）：registry 服务名是 **`agentPresets`**（复数），
> 而 `ctx.agent`（单数）在 0.1.7-rc.2 **全库零命中**、应写作 `ctx.agents`。
> 本仓目前两处都没用（实测 `ctx\.agents?\b` 在 `dsh/**` + `obsidian/main_template` 里 **0 命中**），
> 所以只有"新增"的风险，没有"改错"的风险。

**附带的第二条必修（同一根因，之前没人发现）**：
[dsh/profile/cordis.patch.yml:18-21](dsh/profile/cordis.patch.yml#L18-L21) 写的是

```yaml
- id: agent-presets
  config:
    default: notes-assistant
    includeUserRoot: true
```

但 0.1.7-rc.2 里**发行行 id 是 `agent-preset-registry`**（`dsh-web-app/cordis.patch.yml:558-562`），
而 `includeUserRoot` 字段全库**零命中**。patch 匹配不到目标 id 的后果是**静默**：

```
dsh-app-boot/lib/index.js:55   // "A patch that matches nothing warns and is skipped."
dsh-app-boot/lib/index.js:97   // warn("patch: entry %C not found", id)
```

⇒ 这条 patch 连"默认预设 = notes-assistant"一起失效（默认值仍来自 web-app bundle 的 `standard`）。
**两处源文件都要改**：仓库源 [dsh/profile/cordis.patch.yml](dsh/profile/cordis.patch.yml) 与
本机实装 `~/.dsh/profiles/notes-assistant/cordis.patch.yml`（实测两者同内容，`:18-21` 逐行一致）。

**最大的技术风险（必须先验证）**：预设内的**相对模块解析**。
`agent.cordis.yml:82-83` 用 `name: ./math-memory.mjs`，而 `math-memory.mjs:4106` 又 `await import("./note-tools.mjs")`；
`note-tools.mjs:39-53` 还依赖 `ctx.root.baseUrl` 才能把 `@deepseek-ai/dsh-tools` 拉进来。
liangshen 的注释说 registry 会拿"**relative module paths resolve inside the bundled preset directory**"（`lib/index.js:505-508`）
⇒ 这套机制**依然支持预设目录内的相对引用**（liangshen 的 `presets/liangshen/` 里就躺着 7 个 `.mjs`）。
但我们的情形多一层：`math-memory.mjs` 只有**一份**，既做 preset 插件又做 host 侧的捕获引擎，
所以"它必须同时能从预设目录和从 profile 目录被加载"。**这是 P0 实施里唯一需要先做实验的点**（见 §6 阶段 0）。

**还有一条副作用要一起处理**：`dsh/preset/` 一旦不再拷进 `.agent-presets/`，
`dsh/install.mjs` 的 `--direct` 通道、`.owner.json` 归属标记、`status` / `uninstall` 的对应分支
就都失去被管理的对象（[dsh/install.mjs:48-49](dsh/install.mjs#L48-L49)、[:204-220](dsh/install.mjs#L204-L220)、[:306](dsh/install.mjs#L306)、[:322](dsh/install.mjs#L322)）。
**不能只删同步、留着归属逻辑假装还在管**。

---

### 4.2 必修 · P1：V4 会话日志（静默数据陈旧）

**上游变更**（0.1.7-alpha.1 / rc.1 其他变更）：

> *「Session 日志升级为 V4，新增面向开发者的批量迁移工具，并兼容部分 V3 会话缺少轮次结束记录的情况。」*

**本机实测（文件名形态，556 份日志）**：

```
392 × session.jsonl.zstd        (V2 原件)
147 × session.v3.jsonl.zstd     (V3)
 17 × session.v4.jsonl.zstd     (V4)          ← 新的第三种文件名
549 个会话目录中：v4+v3 并存 = 2；v4 only = 17；v4+v2 并存 = 0
```

并存的 2 例（V4 **更新**）：

```
DIR session-9ea46a2f-…   session.v3.jsonl.zstd  mtime=2026-09-25 10:22:23  4 732 728 B
                         session.v4.jsonl.zstd  mtime=2026-09-25 12:06:14  3 326 957 B
DIR session-a26483bd-…   session.v3.jsonl.zstd  mtime=2026-09-25 10:27:22    130 827 B
                         session.v4.jsonl.zstd  mtime=2026-09-25 10:32:00     92 448 B
```

**缺陷机制**（[math-memory.mjs:626-631](dsh/preset/math-memory.mjs#L626-L631)，host 侧同构 [memory-admin.mjs:1222-1227](dsh/host/memory-admin.mjs#L1222-L1227)）：

```js
function isNewerArtifact(candidate, incumbent) {
  const candidateV3 = /\.v3\./.test(candidate.path);   // v4 → false
  const incumbentV3 = /\.v3\./.test(incumbent.path);   // v3 → true
  if (candidateV3 !== incumbentV3) return candidateV3; // true≠false ⇒ return false
  return candidate.mtimeMs > incumbent.mtimeMs;
}
```

`isNewerArtifact(v4, v3)` ⇒ `return false` ⇒ **旧的 v3 胜出**，与 mtime 无关。后果分两条路
（同上一轮的"同会话两份日志"缺陷，只是这次选错的方向反了）：

1. **对话索引**：注入的记忆语境读旧 v3 ⇒ 最近轮次缺失；
2. **自动捕获**：`sessions[id].fingerprint` / `lastSeq` 锚在 v3 文件上，而 v3 已不再写入
   ⇒ `planSessionDelta`（[math-memory.mjs:761-768](dsh/preset/math-memory.mjs#L761-L768)）永远判"无增量"
   ⇒ **该会话的新轮次永不落盘**（面板"未保存会话"计数同样失真）。

**已经确认不需要改的**（来自 V4 迁移规范，`@deepseek-ai/dsh-session-format-v3-to-v4/README.md`）：

- **物理帧格式不变**：*"V4 physical rows: `releasedV4SessionFormatCodec` **reuses released V2 framing**"*
  ⇒ 自造 `scanZstdFrames` / `decodeZstdSessionLog` **不需要改**（与 V3 时同结论）；
- **头行只在 `version` 上变**：V4 头要求 `version/id/createdAt/isSeeded/delegationDepth`（必填），
  可选 `cwd/parentSession/origin/agentPreset` ⇒ 现有 `readSessionHeader` 读 `{type,id,cwd}` **仍然成立**；
- **`data.source.kind === "user"` 判据不变**：消息来源转换只处理 **plugin 包装**（`{plugin: "…"}` → `kind`），
  *"Direct sources, including unknown and already-prefixed kinds, **keep their original kind** and every own JSON field"*
  ⇒ 真人输入判据、`content[].type === "text"` 抽取**都不需要改**；
- **`tool/result` 的表示变了**（`role:'user'` → `role:'tool'`，去 wrapper），但本插件**不读 tool 结果**，无交点。

⇒ **修复很小：把"权威版本"的判据从"认不认 `.v3.`"改成"版本号越大越权威"**。
但顺着本次盘点发现另一个**同源但是既有的**缺陷（不在 0.1.7 引入范围内）：

- `decodeZstdSessionLog`（[math-memory.mjs:423](dsh/preset/math-memory.mjs#L423)）与
  `decodeSessionLog`（[memory-admin.mjs:1101](dsh/host/memory-admin.mjs#L1101)）**名字不同**，
  因此**不在** `check-engine-sync.mjs` 的共享清单里（[scripts/check-engine-sync.mjs:172-183](scripts/check-engine-sync.mjs#L172-L183)）
  —— 即"改了名就逃出双份守卫"（坑 64 的同类）。本次若动解码，这条会立刻变成漂移源。
- preset 与 host 对"头行读不出来"的处理**不对称**：preset 判为"非本 vault"**永久丢弃**
  （[math-memory.mjs:389-400](dsh/preset/math-memory.mjs#L389-L400)），host 回落到全量解码
  （[memory-admin.mjs:1391-1400](dsh/host/memory-admin.mjs#L1391-L1400)）⇒ 同一个上游变化会打出两种结果。

---

### 4.3 必修 · P1：`dsh-web-all` 0.3.20 → 0.4.2 与悬空镜像

**上游变更**：web 全家桶 0.4.0 起 engines 提到 `>=0.1.7-rc.1`（0.4.2 提到 `>=0.1.7-rc.2`），
并且 **0.4.x 把旧的逐包依赖并入了聚合包**（对比 npm registry 的 `dependencies` 可见：
`@linxin666/dsh-perf`、`dsh-doctor`、`dsh-skins`、`dsh-desktop-launcher`、`dsh-web-ui-all`
在 0.4.2 中**已从依赖树消失**，能力改由 `dsh-web-all` 的 `./shells/shell.js` 子路径导出）。

**本机实测（Obsidian profile 的 `@linxin666` 镜像目录）**：

```
notes-assistant profile 里 27 条 junction，其中 9 条悬空（目标已不存在）：
  dsh-chat-recovery, dsh-client-ui-aionui-panel, dsh-client-ui-session-id,
  dsh-desktop-launcher, dsh-doctor, dsh-perf, dsh-skins, dsh-tool-describe-image, dsh-web-ui-all
web profile 里有、notes-assistant 里缺的：0 条
```

**缺陷机制**（[obsidian/main.template.js:1593](obsidian/main.template.js#L1593) `syncGlobalPackageLinks`）：
它把 web profile 的 `@linxin666` 整个 scope 镜像进 Obsidian profile，并且已经有自愈代码
——**但自愈只在"下一次镜像时"、且判据是 `existsSync(target)`**：

```js
if (entry !== null) {
  if (existsSync(target)) continue;   // ← 悬空 junction 在这里被当成"健康链接"跳过
  ...
}
```

源码注释自己点明了这个坑的成因（*"`existsSync` FOLLOWS a junction, so a link whose target was
removed by a web-profile reinstall (or a package rename …) reports 'absent', `symlinkSync` then fails
EEXIST"*），修法是改用 `lstatSync` 判定。但**镜像循环只遍历 `webScope` 里现存的项**
（`for (const name of readdirSync(webScope))`）⇒ **web 侧被删掉的包，这一轮根本不会被访问**，
于是"清理失效镜像"这件事**在结构上做不到**：必须再遍历一次 Obsidian 侧、把"web 侧已无对应项"的
junction 删掉。**这就是这 9 条悬空的根因。**

附带影响：Obsidian 侧 `settings.enableSkinCenter` 挂的是 `@linxin666/dsh-client-ui-skin-center` +
`@linxin666/dsh-client-ui-web-ui-settings`（[obsidian/main.template.js:1573-1587](obsidian/main.template.js#L1573-L1587)），
这两个包在 0.4.2 里**仍然存在于 web profile 的 node_modules**（实测 18 个 `@linxin666` 包，
含 `dsh-client-ui-skin-center`），所以**默认关闭的路径不受影响**；但"镜像自愈"这一条必须修。

---

### 4.4 应做 · P2：版本下限声明 + 插件设置面

**(a) 兼容性门禁没有可读声明 —— 而且声明位置不是 `engines`。** 0.1.7-rc.1 原文：

> *「插件安装和启动会检查与当前 DSH 版本的兼容性；不兼容时说明原因，**并可对确切版本授予例外**。」*

**本机取证（T1，一手）**：门禁读的是插件 `package.json` 的 **`peerDependencies`**，只挑名字等于
`@deepseek-ai/dsh` 或前缀 `@deepseek-ai/dsh-` 的项，用 semver **含预发布版**比较；
`workspace:^/~/*` 视为"当前运行时版本"（`dsh-app-boot/lib/index.js:286-301`）。
**`engines.dsh` / `dsh.engines` / `minDsh` / `dshVersion` 在兼容检查里零命中**
⇒ 生态里那些包同时写 `dsh.engines.dsh`（我们的误读来源）**只是惯例元数据，不是门禁依据**。

| 行为 | 实证 |
|---|---|
| 不兼容（pnpm 安装路径） | 抛 `ManagementFailure("incompatible-version")` ⇒ **绝不安装**；正在用的那个继续工作（`dsh-plugin-manager/lib/index.js:1490-1491`） |
| 不兼容（profile 启动路径） | 该 bundle 进 `skippedBundles` 并打印 `skipping profile bundle "<name>": <reason>`，**不拖垮整个 profile**（`dsh-app-boot/lib/index.js:911-912`、`:515-517`） |
| 例外文件 | **`$DSH_HOME/profiles/<name>/compatibility.json`**，schema `{ "<pkg>@<exact version>": ["<exact dsh version>", …] }`，键值都必须是**确切**版本（不接受 range），授予必须 `acceptRisk: true`（`:328`、`:359-403`、`:421-441`）；本机**尚无**此文件（⇒ 目前没有任何例外） |
| 补救入口 | `dsh plugin --profile <p> allow-version <name>`（T1 在 `lib/plugin-DkYIj96-.js` 里读到该命令与告警文本） |

而本仓 [package.json:49-51](package.json#L49-L51) **只有** `"engines": { "node": ">=22.5" }`，
`peerDependencies` 只有客户端子包的 `react`。

⇒ 结论：**本插件目前既不在门禁的检查范围内（所以没被拦），也没有声明"我适配到哪一版"的能力。**
因为"未声明 `peerDependencies`"会直接返回 `undefined`（= 兼容），我们**现在没被拦是"没声明"的副产物**，
不是"适配过了"的证据。**补 `peerDependencies["@deepseek-ai/dsh"]` 才是正确动作**（见 §5 B1）。

**(b) 设置面变了，而且新面正好能替掉旧面。** 0.1.7-rc.1 原文：

> *「设置改由当前 Profile 的插件配置保存，支持声明过的实时更新字段；旧 settings.yaml 仅尝试导入一次，
> 自定义设置插件需适配。」* 另有 *「插件可声明无需重载的配置字段；仅修改这些字段时保留运行中的插件实例。」*

本仓**没有**读写 `settings.yaml`（§7 已逐关键词确认），所以**不受破坏**。但插件自己有一堆开关
（`enableSkinCenter`、`sidebarSkinScripts`、`bannerText`、`panelRoutes` 等，
[obsidian/main.template.js:139-160](obsidian/main.template.js#L139-L160)），它们的**唯一真相**目前活在
Obsidian 插件的 `data.json` 里，而 dsh 侧看不到、也不参与 profile 配置。

**0.1.7 的插件配置/元数据契约（T1 一手实测，字段名精确）**：

| 能力 | 精确落点 | 说明 |
|---|---|---|
| 配置存放 | **当前 profile 的 `cordis.patch.yml`**（顶层 YAML 序列 `{id, config}`），`ConfigEditor.documentPath === profileContext.patchPath`（`dsh-config-editor/lib/index.js:23-26`） | 设置面板写的就是这份文件；profile `package.json` 文件锁 + 原子写，保留 `!!js` |
| 旧 `settings.yaml` 导入 | `<profile.home>/settings.yaml`，**先改名 `settings.yaml.imported` 再逐 section 导入**，只跑一次（`dsh-settings/lib/index.js:339-363`） | 本机 `~/.dsh/settings.yaml.imported` **已存在** ⇒ 导入早已发生，别再指望第二遍 |
| 免重载字段 | Schemastery Config 节点上的 **`meta.volatile`**（`dsh-settings/lib/types/schema.js:39-53`）；写入非 volatile 字段会**直接抛错** | 即"改这个字段不重新挂载插件"；配套事件 `loader/volatile-update` |
| 多语言标题/描述 | **`locale/<lang>.json`** 里的 `meta.title` / `meta.description`（`en.json` 为基准）（`dsh-app-boot/lib/index.js:1968-1998`） | 中文放 `locale/zh.json` |
| 图标 | `package.json` **顶层 `icon`**，相对路径，仅 `.svg/.png/.jpg/.jpeg/.webp`，≤ 256 KiB，且不得越出 manifest 目录（`dsh-app-boot/lib/index.js:1850-1874`） | 插件管理页展示用 |

⇒ "哪些开关该搬到 dsh 侧"是**产品决策**（§9 问题 3），不是必修项；但字段名不必再猜了。

**(c) 客户端半个：实测仍然有效，不必改。** 0.1.7 原文只说 *「客户端 Session 会话支持多实例共存，
相关 API 及 slot 有变化」*，**T1 实测本仓用到的那两处都没坏**：

- `settings.section` 槽位在 0.1.7-rc.2 仍在（`kind: "list"`、`scope: "root"`，当前 5 个占用者），
  且官方 example 与本仓写法**逐字同形**（`dsh-cordis-client-runner/lib/client.js:4705-4754`）：
  `ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label }, render))`
  ⇒ [client-panel/src/index.jsx:455-460](dsh/client-panel/src/index.jsx#L455-L460) **无需改**；
- `"main"` 仍是 `kind:"keyed"`/`scope:"root"`，且 **`conversation` 是保留 key**
  （`replaceRisk: "shadows-shipped-ui"`）⇒ 我们**不要**去占它（本仓也没占）。

⇒ 之前 T2 把"slot 变了"列为高危 #5，是**基于 release note 文字**的推断；**实测否证**，降级为"不改"。
唯一值得顺手做的是 0.1.7 新增的 `locale/<lang>.json` 与 `package.json.icon`（§5 C2）。

### 4.5 明确不改（记录理由，避免下次重复排查）

| 上游变更 | 为什么不用改 |
|---|---|
| `readBytes` 统一工作区读取 | 本仓**未使用**（`readBytes` 在 `dsh/ obsidian/ scripts/` 里 0 命中；插件读笔记走 `ctx.fs.readText`，[note-tools.mjs:223](dsh/preset/note-tools.mjs#L223)）。【待取证】`readText` 是否属"被取代的旧接口"（§9 问题 3） |
| `snapshotEvents` / `eventAt` / `ownEvents` | 未使用。**注意 release note 与实装不一致**：note 说"弃用"，而 0.1.7-rc.2 里三者**都还在、上游自己 60+ 处在用、无 `@deprecated` 标注**（`dsh-session/lib/index.js:1323/1336/1349`）。本仓两条都不依赖 ⇒ 不改；但 [math-memory.mjs:3575-3587](dsh/preset/math-memory.mjs#L3575-L3587) 直读 `agent.session.log` / `.messages` 是**绕过公开 API 的私有读**，与这三者是同一族风险（§9 问题 5） |
| `agent/session-start` → `agent/created` | 未使用。**实测 `agent/session-start` 全库零命中**（只有 `SessionStartSource` 类型名与散文里的 "session-start edge"），现行事件是 `agent/created`（`payload: {agent, source: 'startup'\|'resume'\|'clear'\|'compact'}`）。插件唯一的 `ctx.on` 是 `system-prompt/assemble`（[math-memory.mjs:4122](dsh/preset/math-memory.mjs#L4122)）⇒ 无需改 |
| `spill-policy` 的 `maxInlineBytes` → `maxInlineTokens` | 未配置 spill-policy |
| `ctx.agent` 移除 / Inbox 改类型接口 | 未使用（与上一份适配文档 §3.5 结论一致） |
| PTC `ptc-runtime` 改名 / `workflow-ptc` / E2B 移除 / Ralph 默认关 / Team `spawn_teammate` / `SandboxProvider.confine` 异步化 | 预设**刻意不挂** shell / 子代理 / 工作流（[agent.cordis.yml:12-13](dsh/preset/agent.cordis.yml#L12-L13)），整批无交点 |
| 官方适配器只用 Messages API | 不涉及模型的调用形态；本插件不碰 provider 配置 |
| `--dump-config-schema` 新增 | 未使用，但**这恰是本次适配该用的工具**（见 §6 阶段 0） |

---

## 5. 适配项清单（可执行，带验收）

> 每一项都写清：改哪里、验收判据、以及"这个判据在该报错时确实会报错"的变异验证。

### A. 必修

| 编号 | 内容 | 触碰范围（写入域） | 验收 |
|---|---|---|---|
| **A1** | **preset 改为声明式**（§4.1 的路 A 或路 B）：`preset.yml` + `agent.cordis.yml` 继续作权威源；停用/卸载时释放声明（路 B 走 `dispose`） | `dsh/host/index.mjs`、`dsh/host/preset-sync.mjs`（改造或退役）、`dsh/cordis.patch.yml`（或 `profile/cordis.patch.yml`）、`dsh/install.mjs`、`obsidian/main.template.js` 的同步旁路 | ① `node scripts/run-gates.mjs --only 'agent preset mounts'` 由 **10/12 红 → 12/12 绿**（判据：`session/create` 返回 `ok:true`）；② **变异验证**：故意不声明 → 该门禁必须重新红；③ 卸载后 `$DSH_HOME` 里不再出现 `.agent-presets/notes-assistant/`，其他 preset 目录零改动 |
| **A1b** | **修掉那条已死的 patch 行**：`- id: agent-presets` 改为现行 id（`agent-preset-registry`）——**两处源**：仓库 [dsh/profile/cordis.patch.yml:18-21](dsh/profile/cordis.patch.yml#L18-L21) 与本机 `~/.dsh/profiles/notes-assistant/cordis.patch.yml`；同时处置 `includeUserRoot`（现行 schema 无此字段） | `dsh/profile/cordis.patch.yml`（仓库源）；实装文件由插件重写覆盖 | ① `dsh --profile notes-assistant --dump-config` 里能看到目标行被真正 patch 上（而不是只剩 warn）；② **变异验证**：把 id 改回 `agent-presets` → 必须能观察到 `patch: entry … not found` 警告；③ `scripts/check-patch-yaml.mjs` 增一条"patch 行的 id 必须在当前 schema 里存在"的断言 |
| **A2** | **V4 权威版本判据**：把 `/\.v3\./` 单标签判定改成"版本号大者优先"（`vN`，无标记 = 最旧），并保留 mtime 兜底 | `dsh/preset/math-memory.mjs:626-631`、`dsh/host/memory-admin.mjs:1222-1227`（**两处同名符号，`check-engine-sync` 同步项**） | ① 新增断言：`selectAuthoritativeLogs([{v4, 旧 mtime}, {v3, 新 mtime}])` 必须返回 v4（现行代码返回 v3，**先用现有代码跑一次确认它红**）；② 补一条真实夹具："v3+v4 并存 + v4 有新增轮次"整链捕获必须写出 episode；③ `npm test` 两条相关套件计数不得下降 |
| **A3** | **镜像失效清理**：`syncGlobalPackageLinks` 增加"遍历 Obsidian 侧、删除 web 侧已不存在的 junction"分支（判据用 `lstatSync`，只动 junction，绝不动真实目录/文件） | `obsidian/main.template.js:1593`（`syncGlobalPackageLinks`）+ 重建 `main.js` | ① 在隔离 `$DSH_HOME` 里造 3 条悬空 junction → 启动后必须只剩 0 条，且真实目录与真实文件**零改动**；② 变异验证：把清理分支注释掉 → 该断言必须红；③ `scripts/check-skin-fallback.mjs` 仍绿 |
| **A4** | **A1–A3 之后的端到端收口**：侧栏真机验证（服务启动 → 新建会话成功 → 拖一篇笔记 → 记忆面板可见） | 无代码改动（验收） | 见 §6 阶段 3；**必须真机**，因为 A1 失败的表现正是"会话起不来"，而门禁只能证明 RPC 成功 |

### B. 应做

| 编号 | 内容 | 验收 |
|---|---|---|
| **B1** | 根 `package.json` 补 **`peerDependencies["@deepseek-ai/dsh"]`**（门禁的**唯一**依据；`dsh.engines.dsh` 只是生态惯例、门禁不读），口径钉在**实际适配到的版本**上（不是 `latest`：`0.1.5-rc.3` 与 `0.1.7-rc.2` 的 API 面不同） | 加门禁：`peerDependencies` 里的 dsh 范围与 `README` 声明的"已验证版本"一致；变异：把范围写错（如 `>=0.1.4`）→ 红；并实测一次"故意声明成不兼容范围"时 dsh 是否真的 `skipping profile bundle`（这是门禁生效的端到端证据） |
| **B2** | `docs/env-vars.md` 与代码双向一致的门禁已存在；**补一条"宿主版本声明"门禁**，并让 `check-version-consistency` 覆盖它 | 与 B1 合并验收 |
| **B3** | 客户端 `dsh.client.inject` 与 `install-into-profile.mjs` 的包名按 **0.1.7 实际存在的包名**复核（`@linxin666/dsh-web-all@0.4.2` 的 `dsh.client.inject` 实测为 `[]`；`dsh-liangshen` 用的是 `dsh-client-connection / dsh-client-ui-renderer / dsh-client-ui-settings / dsh-api-remotes / dsh-api-session-controller`） | 注释里写明该字段是"信息性元数据"；门禁 `check-embedded-loader.mjs` 仍绿 |
| **B4** | 顺手补掉两个既有隐患：① `decodeZstdSessionLog` / `decodeSessionLog` **同名化**（或加进 `check-engine-sync` 的共享清单，消灭盲区）；② preset 与 host 对 `header===null` 的**不对称**处置统一 | ① `check-engine-sync` 的共享清单条目数 +1（或改名后自动纳入），变异：只改一份 → 红；② 补断言覆盖"头行读不出"这一分支的两侧行为一致 |

### C. 可选（产品决策，见 §9）

| 编号 | 内容 |
|---|---|
| **C1** | Obsidian 侧插件开关搬到 dsh 插件 `Config`（拿到 0.1.7 的"免重载实时更新"） |
| **C2** | 客户端包补 `icon` 与多语言标题（0.1.7 新能力），并复核 `settings.section` 的 `name`/`id` 同值 |
| **C3** | 文档漂移：`README.md:54` / `README.zh.md:54` 仍写"已在 0.1.5-rc.1 上验证"；`docs/handoff.md:386` 与 `docs/changelog.md:46-47` 的记录是**上一轮的临时判据**（"环境结果，不要改断言"），A1 落地后**必须改写**为"已适配" |

---

## 6. 实施路线（分阶段，含并发纪律）

> **本轮并发上限 = 3**（用户明确约束）。下表按"同时最多 3 个执行体（1 个 lead + 2 个 teammate，
> 或 3 个独立执行体）"排布，任何阶段不得超配。

| 阶段 | 目标 | 执行体与写入域（互不重叠） | 出口判据 | 依赖 |
|---|---|---|---|---|
| **0 · 先验证两个未知** | 把 P0/P1 里**唯一不能靠读文档定论**的两点做实：① registry 声明后，`./math-memory.mjs` 相对解析能否成立（含 `ctx.root.baseUrl` 锚点）；② `dsh --dump-config-schema` 能否用于静态校验 profile patch | **2 个只读探针（并行）**：探针 X 在隔离 `$DSH_HOME` 里跑一个最小声明样例；探针 Y 跑 `--dump-config-schema` 并把 patch 行 schema 落成一份对照表 | 两份带命令原文的结论；**不改仓库代码** | 无 |
| **1 · P0 preset 迁移** | A1 | **串行（1 个执行体）**：preset 声明与安装/卸载路径是一条链，改一半会两边都不一致 | 门禁 `agent preset mounts` 12/12；变异验证通过；`$DSH_HOME` 无残留 | 阶段 0 ① |
| **2 · P1 静默缺陷（可并行）** | A2（V4 判据）与 A3（镜像清理） | **2 个执行体并行**，写入域**不重叠**：执行体 A = `dsh/preset/math-memory.mjs` + `dsh/host/memory-admin.mjs`（双份同步 + `check-engine-sync`）；执行体 B = `obsidian/main.template.js` + 重建 `main.js` | 各自的门禁 + 变异验证；**A2 必须先在旧代码上把"该红"跑出来** | 无（与阶段 1 的写入域也不重叠，但**`main.js` 重建只能有一个执行体**，见下） |
| **3 · 收口与真机验收** | A4 + B1–B4 | **串行（lead）**：`main.js` 重建、全量 `npm test`、真机侧栏验收、文档同步 | `npm test` 43/43 绿；真机三件事（起服务 / 新建会话 / 拖拽引用）逐一有日志或截图证据 | 阶段 1、2 |
| **4 · 记录** | 文档与账本 | **lead**：`docs/handoff.md` §7 划掉 preset 条目、§4 补陷阱；`docs/changelog.md` 追加一节；`CHANGELOG.md` 的 `[Unreleased]`；`ARCHITECTURE.md` 若结构变化 | `node scripts/check-doc-consistency.mjs` + `check-doc-counts.mjs` 绿 | 阶段 3 |

**并发硬约束（写进纪律，避免重复踩坑）**：

1. **`main.js` 是生成物，任何阶段只允许一个执行体重建**（`node scripts/build-obsidian.mjs`）。
   阶段 2 里执行体 A 改的是 `dsh/**`——它**也被内嵌进 `main.js`** ⇒ A 与 B 都碰 `main.js`。
   ⇒ **实际排法**：A2 与 A3 代码并行写，但**重建与提交串行**，由 lead 在阶段 3 统一 `build` 一次。
2. **`check-engine-sync.mjs` 是双份实现的守卫**：A2 必须**两处同时改**，否则要么门禁红、要么静默分叉。
3. **测试不得并行跑**：门禁里有真实 dsh 探针（会写 `$DSH_HOME/storages/workspace.json`，
   真实事故见 [docs/handoff.md](docs/handoff.md) 陷阱 91）。**同时跑两条 `npm test` 会互相污染**。
4. **本轮基线先记下来**：`node scripts/run-gates.mjs` = **42/43**，唯一失败项 = `agent preset mounts`
   （`session/create` 被拒 + 一条探针残留断言）。阶段 1 之后这个数只能变好，不许"用改断言的方式变绿"。

---

## 7. 未使用清单（防止过度适配）

凡写"未使用"的，都给出**实际搜索的关键词**与范围（`dsh/`、`obsidian/`、`scripts/`、根 `package.json`）：

| 上游面 | 结论 | 搜索关键词 |
|---|---|---|
| `readBytes` 工作区读取 | 未使用 | `readBytes` |
| `snapshotEvents` / `eventAt` / `ownEvents` | 未使用（但 `agent.session.log` 直读是同源风险） | `snapshotEvents\|eventAt\|ownEvents` |
| `settings.yaml` / Profile 插件配置 | 未使用 | `settings\.yaml\|settings\.json\|profileConfig` |
| `spill-policy` / `maxInlineBytes` | 未使用 | `maxInlineBytes\|maxInlineTokens\|spill` |
| `engines.dsh` / `dsh.engines` | 本仓**未声明** | `engines\.dsh\|dsh\.engines` |
| `agent/session-start` / `agent/created` | 未使用 | `agent/session-start\|agent/created` |
| dsh Inbox API | 未使用（`inbox` 命中全是 vault 内 `.deepseek/inbox/` 与拖拽模块名） | `inbox` |
| `ctx.agent` | 未使用（只用 `context.agent` / `exec.agent`） | `ctx\.agent` |
| `sessionPersistence` 服务 | 未使用（文档里那个方案已被否决） | `sessionPersistence` |
| PTC / workflow-ptc / E2B / Ralph / Team / `confine` | 未使用（预设不挂这些面） | `ptc-runtime\|workflow-ptc\|ralph\|spawn_teammate\|confine` |

---

## 8. 复现命令

```powershell
# 1. 基线：全量门禁（当前应为 42/43，唯一红 = agent preset mounts）
node scripts/run-gates.mjs
node scripts/run-gates.mjs --only 'agent preset mounts'      # 单独看那条红

# 2. 上游版本面（本机实装 vs 适配口径）
(Get-Content "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\package.json" -Raw | ConvertFrom-Json).version
dsh --version
dsh --help

# 3. 会话日志三种文件名形态（V2 / V3 / V4）
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Recurse -Filter "*jsonl.zstd" |
  Group-Object Name | Sort-Object Count -Descending | Select-Object Count, Name

# 4. v3+v4 并存的会话（A2 的现场；关键看 v4 的 mtime 是否更新）
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Recurse -File |
  Where-Object Name -like '*jsonl.zstd' | Group-Object DirectoryName |
  Where-Object { ($_.Group.Name -contains 'session.v4.jsonl.zstd') -and ($_.Group.Name -contains 'session.v3.jsonl.zstd') } |
  ForEach-Object { Write-Host (Split-Path $_.Name -Leaf); $_.Group | Sort-Object Name | Format-Table Name, LastWriteTime, Length }

# 5. 悬空镜像（A3 的现场）
$web="$env:USERPROFILE\.dsh\profiles\web\node_modules\@linxin666"
$obs="$env:USERPROFILE\.dsh\profiles\notes-assistant\node_modules\@linxin666"
Get-ChildItem $obs -Force | Where-Object { -not (Test-Path (Join-Path $web $_.Name)) } |
  Select-Object -ExpandProperty Name

# 6. web 全家桶的 cohort 下限（0.4.0 是断代点）
(Get-Content "$env:USERPROFILE\.dsh\profiles\web\node_modules\@linxin666\dsh-web-all\package.json" -Raw) -match '"dsh":\s*"([^"]+)"'

# 7. 兼容门口与 schema 工具
dsh plugin --profile notes-assistant allow-version <name>
dsh --profile notes-assistant --dump-config-schema
```

---

## 9. 待取证与待决策

### 待取证（写进阶段 0，不许臆测）

> T1 的取证已经把下面几条**从"待取证"变成"已确证"**：V4 是新文件名且与 V3 逐键同构（⇒ 解码器不用改）、
> 兼容门禁读 `peerDependencies`、例外文件是 `profiles/<p>/compatibility.json`、`settings.section` 仍有效、
> `ctx.agent` 已写作 `ctx.agents`。**仍未确证的只剩下面 4 条。**

1. **registry 声明（路 B）后的相对模块解析**：`name: ./math-memory.mjs` 与 `import("./note-tools.mjs")`
   在新机制下如何解析？`ctx.root.baseUrl` 还指向哪里？**路 A 不受此问题影响**（声明行本身就在组合里）。
2. **`- id: agent-presets` 那条 patch 的失效方式**：T1 只读到"匹配不到只 warn 并跳过"的源码与注释，
   **没有启动 dsh 实测**；`includeUserRoot` 这个未知 key 是被 schemastery 丢弃还是报错也未确证。
3. **`ctx.fs.readText` 是否属被 `readBytes` 取代的旧接口**：T1 已确证推荐 API 是
   `ctx.workspaceFiles.readBytes(scope, path, options, signal)`（高层）与 `ctx.fs.readBytes(target, signal, maxBytes)`（低层），
   但**没有**说 `readText` 被移除；需确认它是否只是"文本分页"的另一入口。
4. **`Session` 上是否还保留 `.log` / `.messages`**（[math-memory.mjs:3575-3587](dsh/preset/math-memory.mjs#L3575-L3587) 直读；
   0.1.7-rc.2 里 `snapshotEvents()`/`eventAt()` 是公开替代）。

### 待用户决策

1. **preset 走哪条路**（§4.1）：**路 A**（bundle 里加 `@deepseek-ai/dsh-agent-preset` 行，改动最小）
   还是**路 B**（host 插件 `ctx.agentPresets.register`，保持 `dsh/preset/` 唯一真相）？
   （**推荐路 B**：本仓已经为"两处真相 / 两份实现"付过多次代价，`preset.yml` + `agent.cordis.yml` 应当只有一个作者。）
2. **`peerDependencies` 的范围钉在哪一版**：`>=0.1.7-rc.2`（当前实装，最紧）还是 `>=0.1.7-rc.1`
   （web 全家桶 0.4.0 的下限，略宽）？（推荐：**`>=0.1.7-rc.2`**，与实装和 web-all 0.4.2 一致）
3. **`latest` 与 `next` 两条通道怎么对待**：npm `dist-tags` 目前 `latest=0.1.5-rc.3`、`next=0.1.7-rc.2`。
   用户是跟着 `next` 走的。要不要在 README 写明"本插件验证的是 rc 通道的具体版本"？
4. **Obsidian 侧插件开关是否搬到 dsh 插件 `Config`**（C1，字段名已确证：Schemastery `meta.volatile`
   + `loader/volatile-update`）。搬了能拿到免重载热更新，代价是"Obsidian 界面设置"与"dsh profile 配置"
   两处真相合并——需要用户拍板哪边是权威。
5. **`.agent-presets/` 的迁移残留怎么处置**：本机实测该目录仍在
   （`~/.dsh/.agent-presets/notes-assistant/`：`.owner.json` + `agent.cordis.yml` + 三个 `.mjs` + `preset.yml`，
   含一个 2026-09-10 的 `.bak`），A1 之后它变成**无人读取的垃圾目录**。删掉、还是留一份并打印一行"已迁走"？
6. **是否顺带修 B4 的两条既有隐患**（`decodeZstdSessionLog` 同名化、`header===null` 处置不对称）：
   它们不是 0.1.7 引入的，但**正好挡在 A2 的必经之路上**。

---

## 10. 关联文档

| 文档 | 用途 |
|---|---|
| [`dsh-0.1.5-adaptation.md`](dsh-0.1.5-adaptation.md) | 上一轮（V2 → V3）的评估与实施记录；本文是它的续篇 |
| [`handoff.md`](handoff.md) §7 | **唯一权威的"未做"清单**（preset 迁移条目在那里；A1 落地后必须划掉） |
| [`changelog.md`](changelog.md) | 维护者细账（本文所引 0.1.7 断代的当天记录在 :46-47） |
| [`memory/design.md`](memory/design.md) §189 | "一个会话 = 一份日志"的当前实现规格（**A2 落地后必须同步**） |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | 模块职责与数据流 |
| 上游 | [v0.1.7-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)（**跨版本汇总，本次的主依据**）、[v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)、[v0.1.6-alpha.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1) |

## 11. 本次取证的两份原始盘点（未纳入版本控制）

| 文件 | 内容 |
|---|---|
| `.scratch-adapter-inventory.md` | A–G 分节的**全量耦合点表**（每条：耦合点 → 文件:行号 → 假设的上游形状 → 改后怎么坏），含双份实现落位表与"未使用"清单 |
| `.scratch-adapter-probe.md` | 本机 0.1.7-rc.2 的**宿主契约取证**（V4 头行与事件形态、兼容门禁字段、slot 与 ctx 服务面），每条带证据 |
