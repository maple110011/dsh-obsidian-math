# DSH 0.1.7-rc.2 → 0.2.0-rc.2 适配：评估、实施与证据

> **状态：审计完成 + 三处落地（2026-10-01）。** 本文记录 `@deepseek-ai/dsh` 从本插件上一轮适配的
> `0.1.7-rc.2` 前进到 **`0.2.0-rc.2`**（本机实装、且已是 npm `latest`）期间，上游变更对本项目的影响。
> 前两份同类文档：[`dsh-0.1.7-adaptation.md`](dsh-0.1.7-adaptation.md)（preset 声明化 + V4 判据）、
> [`dsh-0.1.5-adaptation.md`](dsh-0.1.5-adaptation.md)（会话格式 V2→V3）。
>
> **⚠️ 本轮与上一轮的性质不同，先说清口径。**
> 上一轮是"插件在 0.1.7 上是**坏的**"（新建会话直接失败）。**本轮没找到任何破坏**：
> 54 条门禁里唯一与 0.2.0 无关的红是别的（见 §6），所有 API 面逐条查过都还在。
> 所以本轮**不是**一次机制迁移，而是**一次取证 + 一处契约修正 + 两处静默失效收口**。
> 这正是"过度适配"最容易发生的情形，所以 §5 专门列了**明确不改**的东西。

---

## 1. 一页结论

| # | 类别 | 结论 | 证据位置 |
|---|---|---|---|
| 1 | **无破坏** | 插件调用的**每一个**宿主接口在 0.2.0-rc.2 上都还在、签名未变：`ctx.fs` 8 处用法、`ctx.tools.register`/`defineTool`、`system-prompt/assemble`、`settings.section` 槽位、`ctx.webServer.register`、`ctx.workspaceRegistry`、`!!js` patch 方言、`dsh.profile.bundles`/`dsh.bundle.patch`/`file:` 依赖、`.plugin-manager` | §3 |
| 2 | **无破坏** | profile 里那 5 条 patch 行 id 全部仍命中；`dsh --profile notes-assistant --dump-config` = **exit 0 且零 `not found` 警告** | §3.1 |
| 3 | **无破坏** | 依赖面**只增不减**：0.1.7-rc.2 → 0.2.0-rc.2 只多了 `@deepseek-ai/dsh-experimental-schedule-bundle`，**没有任何包被移除**。插件也不依赖 dsh 的 schedule 服务 | §3.2 |
| 4 | **静默失效（已修）** | 工具 schema 的动态校验**在本机整个跳过**、汇总却仍显示 `9/9`：两个套件硬编码 `$DSH_HOME/profiles/node_modules/…`，而 `npm i -g` 装的 dsh 把 `dsh-tools` 放在**全局安装内部**。⇒ 修好后 **22/22 + 11/11**，且是拿 0.2.0-rc.2 **自己的**校验器跑的 | §4.1 |
| 5 | **契约缺陷（已修）** | 安装清单把 `cordis.patch.yml` 当"安装器私有、可哈希冻结"的文件，而同一位安装器在别处明说它是**用户的层**、dsh 的设置面板也按设计重写它 ⇒ 摘要注定过期、门禁**永久飘红**。"第三份完整性基线"从此门禁**红的唯一一条**。 | §4.2 |
| 6 | **静默失效（已修）** | 老版本装过的 profile 可能还留着已死的 `- id: agent-presets`（0.2.0 全库零命中）。patch 匹配不到**只 warn 并跳过** ⇒ "默认 preset = notes-assistant"静默丢失，而 `ensurePresetDeclaration()` 只认自己那段 BEGIN/END 块、**不迁移**这行旧 id | §4.3 |
| 7 | **新增风险（记录）** | 0.2.0 起 **`$DSH_HOME/cordis.patch.yml`（home 层）压过 profile 自己的层**：同 id 的行会被静默覆盖，而 dsh 的设置面板**现在会拒绝**保存被 home patch 覆盖的行。本机 home 层只有一条 `- insert:` 的 guard 行，**当前无冲突** | §5.2 |
| 8 | **必须记住** | 把版本范围"顺手整理"成 `>=0.2.0` 或 `^0.2.0` 会在 prerelease 运行时上**静默停用整个插件**（exit 0，只有一行 stderr）。**`>=0.1.7-rc.2` 与 `>=0.2.0-rc.2` 都通过**；两者都是 prerelease 形态 | §4.4 / 陷阱 112 |
| 9 | **明确不改** | `ctx.fs.readText`（曾被列为待取证）**没有被 `readBytes` 取代**——两者在 0.2.0-rc.2 的类型契约里**并列声明**；`session.log` 仍是真实字段；`snapshotEvents` 一族仍未使用 | §5.1 |

**一句话**：**0.2.0-rc.2 不需要改机制**；本轮把"我们以为自己验证过、其实跳过了"的那条补成真验证（§4.1），
把"按插件自己的指示改配置就会永久飘红"的契约矛盾拆干净（§4.2），再收口一处 0.1.7 遗留的静默失效（§4.3）。

---

## 2. 版本断代与变更面

| 事实 | 证据 |
|---|---|
| 本机实装 dsh | `0.2.0-rc.2`（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh\package.json`） |
| npm `dist-tags` | **`latest` = `0.2.0-rc.2`**、`next` = `0.2.0-rc.2`、`alpha` = `0.1.7-alpha.2`（上一轮记的 `latest=0.1.5-rc.3` 已过期 ⇒ **不升级的用户拿到的就是它**） |
| npm 上的版本序列 | `0.1.7-rc.2`（2026-09-24）→ `0.2.0-rc.1`（2026-09-28）→ `0.2.0-rc.2`（2026-09-29）。**中间没有 0.2.0-alpha / 0.1.7-rc.3**，所以变更面就是这两份 release notes |
| GitHub 上 `0.1.7-rc.2` 之后 | 只有 `dsh-v0.2.0-rc.1`、`dsh-v0.2.0-rc.2`；`rc.1` 正文自称"汇总自 `v0.1.7-rc.2` 以来的主要变更" ⇒ 口径一致 |
| **与本项目有交点的变更** | 只有 3 条（§3.3）：插件版本兼容提示的区分、配置保存更快（伴随一条新的**保存拒绝**）、pi-ai 0.87.1 移除部分旧模型 ID。其余全是桌面端/UI/沙箱技能/自动化包的变动 |
| 会话数据格式 | 仍是 V4；本机 `$DSH_HOME/sessions` 下 **26/26 全是 `session.v4.jsonl.zstd`**（无 v2/v3 共存）。`dsh-session-format` 的文件名契约未变 |

> ⚠️ **口径提醒**：`0.2.0-rc.2` 是 **prerelease**。dsh 的兼容门禁用 `includePrerelease: true` 比对，
> 所以它**能**被 `>=0.1.7-rc.2` 接受；但它**不会**被 `>=0.2.0` 或 `^0.2.0` 接受。这一条踩过就静默失效，见陷阱 112。

---

## 3. 上游变更 → 本项目影响

### 3.1 明确仍然工作（本机实测，防止把"能用的"当"坏的"改掉）

| 检查 | 命令 / 落点 | 结果 |
|---|---|---|
| 全量门禁 | `node scripts/run-gates.mjs` | **54 条全跑完**；与 0.2.0 相关的全部绿（含 `agent preset mounts` 由 23/24 → **24/24**） |
| profile 组合（patch 行是否还命中） | `dsh --profile notes-assistant --dump-config` | **exit 0、1377 行、零 `not found` 警告**。`agent-preset-registry` 被正确 patch（`default: notes-assistant`）、`sandbox-policy` / `fs-sandbox` / `approval` / `permission` 全部 patch 成功、bundle 的 `math-memory-host` + `preset-notes-assistant` 都在 |
| 真 dsh 启动 + 新建会话 | 门禁 `test: agent preset mounts`（真实 dsh 探针） | **24/24**，`session/create` 返回 `ok:true`、`agentPreset: notes-assistant` |
| 侧栏鉴权握手（401 + token + SameSite） | 门禁 `test: panel auth e2e (real dsh)` | **8/8**。它用**插件原样的 spawn 参数**启动真 dsh：`--profile … --patch … --no-open --port 0` |
| 面板 / 路由 / 反代 / 呈现 | 门禁 `panel routes` 62/62、`panel loopback proxy` 32/32、`panel presentation` 20/20 | 全绿 |
| Obsidian 侧 CLI 面 | `dsh --help`、`dsh web` 的 `--host/--port/--trusted-host/--no-open`（`dsh-web-app/lib/startup.js:22`）、`dsh plugin --profile <p> add/remove` | 全部还在 |
| 客户端半个的槽位 API | `dsh-client-ui-renderer/lib/client.js:1323`（`super(ctx, "slots")`）、`:1343`（`inject(key, callback)`）、`SlotCore.register(options, component)` | 与插件 `src/index.jsx:454-461` 的用法逐项对应 |
| React 版本 | `dsh-web-frontend` / `dsh-client-ui-primitives` 仍是 `react ^18.2.0` | **没有 major 跳变**（客户端半个的 peer 也是 `^18.2.0`） |
| 工具返回值校验 | 门禁 `tool output schemas` **22/22**、`tool output shape` **11/11** | 拿 0.2.0-rc.2 自带的 `validateJsonSchemaValue` 跑；见 §4.1（修好后才是真的） |
| 本地包通道（A′） | `dsh.profile.bundles` / `dsh.bundle.patch` / `file:` 依赖 / `.plugin-manager` | 未变；门禁 `plugin rebuilds a wiped $DSH_HOME` 绿 |

> **"当前工作目录会写什么是可预期的"**：`dsh --help` 明列 `--profile` / `--patch` / `--dump-config` /
> `--dump-config-schema` / `--dump-default-config`。`--dump-config` 是零 token 的取证利器（本轮主要靠它）。

### 3.2 依赖面：只增不减

把 npm 上 `0.1.7-rc.2` 的 `dependencies` 与本机 `0.2.0-rc.2` 的逐名比对：

```
=== only in 0.2.0-rc.2 ===
@deepseek-ai/dsh-experimental-schedule-bundle
=== only in 0.1.7-rc.2 ===
(空)
81 / 47  ->  82 / 47        (dependencies / devDependencies 计数)
```

**没有任何包被移除**（这正是"插件会不会突然找不到某个内置行"的第一个筛查）。
唯一新增的 `dsh-experimental-schedule-bundle` 与插件**无交点**：

- 插件的 profile bundles 是 `dsh-base` + `dsh-web-app` + `dsh-math-memory`，不含它；
- 插件的"提醒"是**自述式**的（注入文本 + memo frontmatter 的 `last_reminded`，见
  `dsh/preset/math-memory.mjs:3995-4000`、`:4076`），**不读** dsh 的 schedule 服务——
  全仓对 `ctx.schedule` / `dsh-schedule` / `dsh-experimental-schedule-bundle` **零命中**。

### 3.3 release notes 里与本项目有交点的三条（逐条判"要不要动"）

| release note（0.2.0-rc.1/rc.2） | 判断 | 理由 |
|---|---|---|
| "精简插件安装引导，并区分已安装、不兼容和内置插件的升级提示" | **不改** | 纯 UI 文案；插件不在"内置"名单里（内置 = dsh 自己 bundled 的包） |
| "改善插件配置保存操作的等待时间" | **记录，不改** | 它伴随一条**新行为**：保存一行时若该 id 被 home patch 覆盖，配置编辑器**直接抛错拒绝**（`dsh-config-editor/lib/index.js:122`）。本机无冲突，但这条**堵住了**上一轮列的 C1（把 Obsidian 开关搬到插件 `Config`）——见 §5.2 |
| "pi-ai 0.87.1，部分旧模型 ID 被移除，已保存的选择可能需要重新选择" | **不改，标 UNVERIFIED** | 插件不碰 provider 配置。本机 profile 用的是**自定义** `penguin` 路由 + 自定义 `models` 数组（`openai-completions` API），字段名仍被支持；但那些模型 ID 的**可服务性**没有真请求验证过（要花 token） |

### 3.4 明确**不是** 0.2.0 引入、但挡住适配路径的东西

唯一那条与 0.2.0 无关的红门禁（`已部署 profile 的文件与 manifest 记录的摘要一致`）**在 0.1.7-rc.2 上同样会红**。
取证链：

- 该文件的 mtime 是 `2026-09-28 15:26`（本地），**早于** `0.2.0-rc.2` 的发布（`2026-09-29 09:56 UTC`）；
- 内容是**用户自己的**配置（`llm-pi-ai` 的 `penguin` provider + `agent-default-model` + `ui-settings-general`）；
- `dsh --dump-config` 在 0.2.0-rc.2 上实测**只重写 `cordis.yml`**（字节相同、mtime 每次变），
  **完全不碰 `cordis.patch.yml`**（改前改后 sha256 都是 `69ea710a…`，mtime 不变）。

⇒ 它是"契约把用户配置层当私有文件冻结"的缺陷，不是宿主升级的回归。修法见 §4.2。

---

## 4. 本轮落地的三项

### 4.1 工具 schema 的动态校验此前是**假的绿**

**现象**：门禁 `test: tool output schemas vs dsh validator` 与 `test: tool output shape (real pipeline)`
都报 `ok … (9/9 checks)`，看起来"用 dsh 自己的校验器验过了"。

**真相**：两个套件里**唯一**调用 dsh 校验器的那些断言，都 gate 在一个硬编码路径上：

```js
// 修前（两个文件各写一份，2026-10-01 实测）
join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
```

而本机三种形态都不长这样：

| 候选路径 | 存在？ |
|---|---|
| `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js` | **False** |
| `~/.dsh/profiles/notes-assistant/node_modules/@deepseek-ai/dsh-tools/lib/index.js` | **False** |
| `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js` | **True** |

所以那些断言**整块跳过**（`[skip]`），而汇总仍报 `9/9` —— 这正是 `AGENTS.md` §4 警告过的形态：
**绿覆盖的断言比它看起来少**。它在本轮尤其要命，因为"我们的 `output.schema` 还能过宿主的校验器"
**就是**宿主升级的适配证据；一个会静默跳过的检查无法为 0.2.0-rc.2 作证。

**修法**：新增**一个共享解析器** `scripts/lib/dsh-tools-validator.mjs`（按顺序试 4 类候选：
`$DSH_HOME/profiles/node_modules` → 三个 profile 目录各自的 `node_modules` → **npm 全局安装内部**
→ `./node_modules`；`DSH_TOOLS_PATH` 是**硬指定**——设了就以它为准、**不回落**，否则"想拿这一版校验"
会变成悄悄拿另一版）。两个套件都改用它。找不到时**大声 SKIP 并打印试过的路径**（或错设的值），
而不是让它看起来像通过了。新变量已登记进 `docs/env-vars.md`（那条守卫是双向的：代码读了没写下来也红）。

**结果（真跑）**：

```
# 未设 DSH_TOOLS_PATH（本机默认）
dsh-tools validator: C:\Users\小新air15\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js
__CHECKS__ 22/22      (tool-output schemas，修前 9/9 + 整块跳过)
__CHECKS__ 11/11      (tool-output shape，修前 9/9 + 整块跳过)

# 反证：把 DSH_TOOLS_PATH 指到一个不存在的路径
[skip] 用 dsh 的 validateJsonSchemaValue 校验代表性值 | 找不到 dsh-tools —— DSH_TOOLS_PATH is set to "…" but nothing is there — unset it to search, or fix the path
__CHECKS__ 9/9 (1 skipped)
```

即：**4 个工具的 output schema / 9 条代表性 fixture，对 0.2.0-rc.2 自带的校验器零违规**；
且反向证明（给 match 加未声明字段 ⇒ 必须被判违规）也是拿那个校验器跑的；
而"找不到校验器"这一情形会**留在 `__CHECKS__` 的 `(N skipped)` 里**，不再冒充通过。

### 4.2 posture 契约拆分：安装器私有 vs 用户所有

**缺陷**：安装清单给**每一个** posture 文件记 sha256，并把它当硬校验（"第三份完整性基线"）。
其中 `cordis.patch.yml` 被同一个安装器在 650 行之外明确定义为"用户的层、永不重写"
（`dsh/install.mjs` 的 `ensurePosture` 注释），而 dsh 自己的设置面板**按设计就重写它**：
`@deepseek-ai/dsh-config-editor` 把整份文件重新序列化后追加自己那一行。实测形变不是人手编辑的样子——
本机该文件 `3738 B（安装器写的）→ 4523 B（现存）`，其中只有 **2 行被折成 4 行**（两条长 `!!js`
标量在 YAML 默认 80 列处折行），其余是 774 B 的新增行。

⇒ 门禁把"**按插件自己的指示**去 `cordis.patch.yml` 里改配置"判成了故障，而且**永久**飘红。
（插件自己在 `notes-assistant.patch.yml` 第 1-4 行就写着 *"user edits belong in `cordis.patch.yml`"*。）

**判据**（写进契约，不是写在某个测试里）：**谁还会写这个文件**，而不是"谁创建了它"。

| posture 文件 | 另一个写入方 | 处置 |
|---|---|---|
| `package.json` | dsh 的插件管理器（`dsh plugin add` / 插件页写 bundles 与 dependencies） | **共享**：不冻结、不删 |
| `cordis.yml` | dsh **每次**组合 profile 都重写成 `[]`（实测 `--dump-config` 就会写，字节相同、mtime 变） | **共享**：不冻结、不删 |
| `cordis.patch.yml` | 用户（按设计）+ dsh-config-editor | **共享**：不冻结、不删 |
| 模块 `.mjs`、`notes-assistant.patch.yml`、`pnpm-workspace.yaml` | 目前**只有我们** | **继续硬基线**（这才是那条基线存在的意义：抓截断写入与旧插件覆盖） |

**落地**：

- 单一事实源是 `dsh/preset/profile-contract.mjs` 的 `POSTURE_SHARED_FILES`（每条都带实测到的第二个写入方，
  并写明"没有第二个写入方的文件不许进来"）。
- `dsh/install.mjs`：`postureDigests()` 跳过共享文件；`verifyPostureDigests()` 新增 `shared` 桶（**不是** drifted）；
  卸载时共享文件**无条件保留**（旧的"仅在漂移时保留"会在**未改动**的情况下删掉它们）。
- **向后兼容**：旧清单里记着共享文件的摘要时，那些条目被**重新归类**进 `shared` 而不是报 drift ⇒
  修好这条**不需要重装**，本机现存 profile 直接转绿。
- Obsidian 那半个（模板里的 `postureDigestsOf`）**不能 import 任何模块**，所以它的过滤来自构建期注入的契约
  （`scripts/build-obsidian.mjs` → `__PROFILE_CONTRACT_JSON__`）。
- **新增守卫**（补上一个此前完全没人管的盲区）：`check-profile-contract.mjs` 的 `PINNED-7` 把模板里那个函数
  **从 `main.js` 里取出来真求值**，拿同一份临时 profile 与 CLI 的实现逐文件比对摘要——任何一方手写第二份
  清单都会红。不比对源码文本（那只能钉住写法）。

**结果**：`test: agent preset mounts` 由 **23/24 红 → 24/24 绿**，且**没有碰用户真实的 profile**
（本机 `$DSH_HOME/profiles/notes-assistant` 一个字节都没改）。

### 4.3 已死的 `agent-presets` 行不再静默丢失默认 preset

0.2.0 里 `- id: agent-presets`（0.1.5 时代的 loader 行 id）**全库零命中**（逐包 grep 过），
`includeUserRoot` 同样。而 patch 行的 id 匹配不到任何行时，dsh **只 warn 并跳过**——
于是老版本插件装过的 profile 会**静默**失去"默认 preset = notes-assistant"。

`ensurePresetDeclaration()` 只认自己那段 `BEGIN/END` 块，**不会**迁移这行旧 id。
新增 `migrateRetiredPresetRow()` 并在 `ensurePresetDeclaration()` 里调用，判据刻意收窄（因为它改的是用户文件）：

- 只认**顶层**序列项、id **恰好**是 `agent-presets`（`agent-presets-*` 不碰）；
- 丢掉 `includeUserRoot`（现行 schema 无此字段，留着只会误导读者以为它还起作用）；
- 其余内容与**行尾**逐字节保留；
- **幂等**：改名后模式不再匹配。

**验收**：`test-installer` 新增 9 条断言，含**调用点**级别的两条（分别覆盖"有/没有生成块"两种分支）——
只测 helper 的话，未来重构把调用删掉仍会全绿。

### 4.4 版本声明：**保持 `>=0.1.7-rc.2`**，并写明已验证到哪一版

**这是本轮唯一一处用户拍板的取舍。** 事实基础：

- 0.2.0-rc.2 上**没有发现破坏** ⇒ 声明 `>=0.2.0-rc.2` 会把"其实还能用的 0.1.7-rc.2 用户"挡在门外（dsh 会拒载）；
- dsh 的兼容门禁**只读 `peerDependencies`** 里 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`
  （`dsh-app-boot/lib/index.js:294`），用 `semver.satisfies(..., { includePrerelease: true })` 比对（`:300`）；
  **整个 key 不存在 = 完全不检查**（`:289`）；
- `dsh.engines.dsh` 是生态惯例，**门禁不读**它（全库对 `engines.dsh` / `minDsh` 零命中）。

**决定**：两个字段都保持 `>=0.1.7-rc.2`（`check-version-consistency.mjs` 要求二者一致），
在两个 README 的宿主要求行**后面**写明"0.2.0-rc.2 已实测"。
`docs/literature.md` 那种"手写版本号"的腐烂风险由既有守卫挡住：`check-doc-consistency.mjs:148-169`
把 README 的宿主要求**锚在 `package.json` 的 peer 范围上**（派生，不是字面量），所以改范围必须同时改 README。

⚠️ **不要"顺手整理"成 `>=0.2.0` 或 `^0.2.0`** —— 见 §5.3 与陷阱 112。

---

## 5. 明确不改（记录理由，避免下次重复排查）

### 5.1 上一轮遗留的"待取证"两条，本轮**已确证**

| 项 | 上一轮状态 | 本轮结论 | 证据 |
|---|---|---|---|
| `ctx.fs.readText` 是否被 `readBytes` 取代 | 【待取证】 | **没有被取代**：两者在类型契约里**并列声明** | `dsh-fs/lib/types/index.d.ts:162` `readText(target, signal?): Promise<string>`；`:183` 区段的 `readBytes`；`types.d.ts:64` 的说明直接写"`readText` vs `streamText`" |
| `Session` 上是否还保留 `.log` / `.messages` | 【待取证】 | `.log` **仍是真实运行时字段**；`.messages` **不存在**（插件原有的 fallback 分支是良性的、不是缺陷） | `dsh-session/lib/index.js:1249`；`dsh-agent/lib/index.js:291-297` 的 `assembleContextFor()` 返回 `{agent, scope, signal}`，`dsh-system-prompt/lib/index.js:355` 原样透传 ⇒ 插件的 `context?.agent` 判据仍然成立 |

### 5.2 记录但不改

| 上游事实 | 为什么不动 |
|---|---|
| **`$DSH_HOME/cordis.patch.yml`（home 层）压过 profile 自己的层** | 0.2.0 新增的优先级。本机 home 层只有一条 `- insert:` 的 `pretooluse-guard` 行（不覆盖任何 id），**当前无冲突**。插件写 `permission` / `approval` / `sandbox-policy` / `fs-sandbox` 都在 **profile 层**，若将来用户在 home 层写同名 id，那些行会被静默覆盖。**属产品决策**（要不要在启动时检测并提示），已记进 `docs/handoff.md` §7 |
| **配置编辑器拒绝保存被 home patch 覆盖的行** | 同上，`dsh-config-editor/lib/index.js:122`。它**堵住了**上一轮列的 C1（把 Obsidian 侧开关搬到 dsh 插件 `Config`）：只要那个 id 被 home 层覆盖，保存就抛错。C1 本来就没拍板，现在多了一条反对理由 |
| **`dsh-base` 的 approval 默认值反了**（`:248` 是 `danger-full-access ? 'never' : 'ask'`，而插件 profile 层的表达式给的是相反映射） | 插件**profile 层赢**，且启动检查（`dsh-permission-presets/lib/index.js:178-181` 的"组合出的沙箱/审批默认值必须命中某个 preset"）目前由 `defaultPreset: math-memory-locked` 保证通过。**改安全相关配置不属于"顺手做"**；只记录：若哪天去掉 `defaultPreset`，这条启动检查会红。已记进 §7 |
| **`pnpm-workspace.yaml` 仍列为安装器私有** | 没有实测到第二个写入方。判据是证据不是猜测——**要加进共享清单，先给出写入方**（契约里写明了这条纪律） |
| pi-ai 0.87.1 的模型 ID 可服务性 | 要真请求才能验，**花 token**；且本机走自定义 provider，不受目录变更影响 |

### 5.3 不要做

- **不要把版本范围收紧成 `>=0.2.0` / `^0.2.0`。** 在 prerelease 运行时上它**不匹配**，
  于是 dsh 把 bundle 层**静默跳过**（exit 0，只有一行 stderr）——插件"看起来装了但什么都没挂"。
  实测：`>=0.2.0` / `^0.2.0` 都失败；`>=0.2.0-rc.2` 与 `>=0.1.7-rc.2` 都通过。
- **不要把共享 posture 文件加回硬基线。** 那等于再制造一次"按指示改配置就永久飘红"。
- **不要为 `agent-presets` 加"猜"式的兼容**（比如同时保留两行不同 id）。⚠️ **本条的依据 2026-10-01 被只读取证收窄了，原文写错了**：
  原文说"同一 id 出现两次会让整个 profile 起不来（见 `notes-assistant.patch.yml` 的既有说明）"——**那句话在该文件里找不到**（grep `id|两次` 共 11 处，无重复-id 相关注释），是**二手转述**。实测到的真实形态有两种，**别混**：
  - **重复 `(kind,path)` 的 web 路由 ⇒ 真的 throw**（会阻碍启动，`dsh-app-boot` WEB:179 一带）——这是本仓库 `/memory-panel` 那次"重复注册"事故的真实机制；
  - **重复的 loader entry id ⇒ 源码里只是"静默复用同一个 Entry"，没找到显式拒绝逻辑**（`cordis-plugin-loader` LOADER:58-60/81-82）。
  ⇒ **结论仍然成立**（别制造同 id 重复），但理由要改成"**路由层会炸、条目层会静默复用同一份实现**"，而不是那个未经复现的"一定起不来"。**本条未复现**，建议在隔离 `DSH_HOME` 里用故意重复 id 的 patch 跑 `--dump-config` 补证。

---

## 6. 本轮的门禁状态与那条**不属于本轮**的红

全量 `node scripts/run-gates.mjs`：**54 条**（数量由 `scripts/lib/gates.mjs` 派生，`check-doc-counts.mjs` 守）。

- 与 0.2.0 适配相关的全部绿，包括：`agent preset mounts` **24/24**（修前 23/24）、
  `profile contract is the single source`（含新增 PINNED-7）、`tool output schemas` **22/22**（修前 9/9 + 跳过）、
  `tool output shape` **11/11**、`installer e2e`、`main.js bundle freshness`、`env vars vs docs`。
- ⚠️ **有一条红不属于本轮，且刻意不去"修"**：
  `check: doc constants` 报 `docs/literature.md claims 30 papers, but literature/.raw holds 34 directories`。
  取证：`literature/.raw` 下多了 **4 个目录**（mtime `2026-10-01 13:22`，就在本轮跑门禁前 11 分钟），
  对应的卡片/研读笔记/`index.md`/`.index.json`/`library.bib` 都已生成——**是另一次文献导入的产物**，
  与本插件、与 0.2.0 无关。`docs/literature.md:117` 那句手写计数（以及它附近 26/27 篇的蒸馏计数链）**没有被自动更新**。
  **按 `AGENTS.md` §4 的纪律，这类"环境/并发工作的红"要分类、不许改断言去掩盖**；而且该文件的计数是**一串**相互关联的
  数字（30 / 27 / 26），只改一个会让下一次读它的人更糊涂。⇒ 留给该次导入的负责人一次**有意的刷新**。

---

## 7. 复现命令

```powershell
# 1. 宿主版本面（本机实装 vs npm 的通道）
dsh --version
(Get-Content "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\package.json" -Raw | ConvertFrom-Json).version
# latest 现在就是 0.2.0-rc.2（上一轮记的 0.1.5-rc.3 已过期）

# 2. patch 行是否还命中（零 token、只打印组合结果）—— 关键是「零 not found 警告」
dsh --profile notes-assistant --dump-config > $env:TEMP\dump.txt 2>&1
$LASTEXITCODE; Select-String -Path $env:TEMP\dump.txt -Pattern 'not found|agent-preset-registry|math-memory-host'

# 3. 依赖面：只增不减
$a = Invoke-RestMethod "https://registry.npmjs.org/@deepseek-ai/dsh/0.1.7-rc.2"
$b = Get-Content "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\package.json" -Raw | ConvertFrom-Json
Compare-Object $a.dependencies.PSObject.Properties.Name $b.dependencies.PSObject.Properties.Name

# 4. 集成基线（修好 §4.2 之后应为 24/24，且不依赖你重装）
node scripts/run-gates.mjs --only "agent preset mount"

# 5. 工具 schema 是否**真的**用 0.2.0 的校验器跑（打印路径，然后 22/22 / 11/11）
node scripts/test-tool-schemas.mjs
node scripts/test-tool-shape.mjs

# 6. 契约拆分与迁移的变异验证（每条都该报红，恢复后应字节级一致）
node scripts/run-gates.mjs --only "profile contract"
node scripts/run-gates.mjs --only "installer"

# 7. 会话世代（本机应全是 v4；插件按世代号择优，不再只认 .v3.）
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Recurse -File -Filter "*.jsonl.zstd" |
  Group-Object Name | Sort-Object Count -Descending | Select-Object Count, Name

# 8. 兼容门禁的端到端行为（在**隔离的** DSH_HOME 里做，别碰真机）
#    证据见 .scratch-compat-gate-e2e.md：不兼容 = exit 0 + 一行 stderr + 组合结果被掏空
#    （**不是**非零退出；只有 --dump-config-schema 会 exit 1）
```

---

## 8. 关联文档

| 文档 | 用途 |
|---|---|
| [`dsh-0.1.7-adaptation.md`](dsh-0.1.7-adaptation.md) | 上一轮（preset 声明化、V4 判据、悬空镜像）；本文接续它 |
| [`handoff.md`](handoff.md) §4 | **唯一权威的陷阱清单**（本轮新增 108–112）；§5 决策记录；§7 未做清单 |
| [`changelog.md`](changelog.md) | 维护者细账（本轮三项改动的理由与证据） |
| [`env-vars.md`](env-vars.md) | 环境变量单一参考（本轮新增 `DSH_TOOLS_PATH`） |
| [`lemmalog-assessment-2026-10-01.md`](lemmalog-assessment-2026-10-01.md) | 同轮完成的"能否为记忆系统引入 lemmalog"评估（结论：不引入） |
| 上游 | [v0.2.0-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)（跨版本汇总）、[v0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) |

## 9. 本轮的原始取证（未纳入版本控制）

| 文件 | 内容 |
|---|---|
| `.scratch-0.2.0-interface-audit.md` | 逐接口的 0.2.0-rc.2 契约核对（每条带 `文件:行号`），含 6 条警告与"未能核实"清单 |
| `.scratch-gate53-diagnosis.md` | 那条红门禁的根因取证：两个摘要的来源、dsh-config-editor 的写入路径、YAML 重序列化的字节级复现 |
| `.scratch-compat-gate-e2e.md` | 兼容门禁的端到端实验（5 步、隔离 DSH_HOME、含 prerelease 边界与 `allow-version` 豁免路径） |
| `.scratch-lemmalog-assessment.md` | lemmalog 的可行性与适配评估 |

> ⚠️ 四份 `.scratch-*` 都被 `.gitignore` 排除（第 29 行），**它们的结论已全部写进本文件与 `handoff.md`**，
> 但**报告本身不会随仓库发布**——所以上面这些数字若只出现在 scratch 里，就等于没记。
