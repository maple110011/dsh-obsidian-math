# 安装 / 卸载 / 冲突解决指引

本文是给**用户**看的使用指引：讲清安装原理、两条安装路径、冲突解决功能怎么用、卸载怎么用。内部设计规格见 [`dsh-native-refactor.md`](dsh-native-refactor.md)。

## 0. 一句话原理

dsh-math-memory 由**两层**组成，安装方式不同：

- **能力层（bundle）**：preset「数学笔记助手」、笔记工具、记忆引擎、面板路由、工作区自动注册。这一层用 dsh 原生命令 `dsh plugin` 安装，**符合 dsh 设计理念**。
- **姿态层（posture）**：fail-closed 沙箱、审批策略、权限表、默认 preset、工作区根目录。这一层是「部署姿态」，由安装程序写入 profile 的 `cordis.patch.yml`。

> 一句话：**能力走 `dsh plugin`，姿态由安装程序落盘。** 因为「能力」是可复用的插件，「姿态」是这台机器/这个用户的部署选择，二者不该混在一个可复用包里。

## 1. 安装方式

### 方式 A：把 bundle 加进已有 `web` profile（只装能力）

```bash
dsh plugin --profile web add dsh-math-memory
```

把我们的 bundle 加进**已存在**的 `web` profile（它自带 in-box 的 dsh-base + dsh-web-app）。bundle 自带的补丁层会往 profile 里插一条宿主行和一条 preset 声明，preset 的模块按**包内路径**解析（包已在 `profile/node_modules` 里），所以什么都**不需要**在启动前先落盘。装完后**重启 dsh**，新建会话即可在预设选择器里看到「数学笔记助手」。

> 这种方式**不会**把它设为默认预设——默认预设由 profile 自己的 `cordis.patch.yml` 里 `agent-preset-registry` 那行的 `default` 决定，只有专门的 `notes-assistant` profile（方式 B / C / Obsidian 插件）才会写它。在 `web` 里请在新建会话时手动选。旧文档说的"同步进 `~/.dsh/.agent-presets/`"自 dsh 0.1.7 起已不成立（那个目录不再被任何代码读取）。

**注意**：`@deepseek-ai/dsh-web-app` 是 dsh 的 **in-box bundle**（随 dsh 安装自带），**不能** `dsh plugin add`（会去注册表拉一个版本对不上的副本）。新建专用 profile 请用方式 B（安装程序会写骨架），方式 A 只适合往已有 `web` profile 里加 bundle。方式 A 也**没有** fail-closed 沙箱（沿用 web 的沙箱）。

> ⚠️ **实测症状（2026-09-26）**：把它加到 dsh 新建的**自定义** profile（例如 `dsh plugin --profile myprobe add …`）时，`add` 会成功、`bundles` 也写对了，但启动日志只说一句
> `dsh: warning: 2 entries did not activate`（`math-memory-host … pending (waiting for services: webServer, workspaceRegistry)`、`preset-notes-assistant … pending (waiting for service: agentPresets)`），**并且永远不会打印 token 地址** —— 那个 profile 没有 web 栈。要用方式 A 就加到已有的 `web`；要新 profile 请走方式 B。
> 可复现探针：`node scripts/qa/release-accept.mjs`（临时 `DSH_HOME`，不碰你的真实环境）。

### 方式 B：安装程序（能力 + 姿态 + 模板，CLI/npm 用户）

```bash
dsh-math-memory install --vault /path/to/你的Obsidian库
```

内部依次做：调 `dsh plugin add` 装能力 → 写 profile 姿态 → 写 owner marker → 种 vault 模板（`AGENTS.md` + `.deepseek/**`）。这是**完整**安装，需要 pnpm + 网络。

### 方式 C：离线扁平拷贝（无 pnpm）

```bash
dsh-math-memory install --direct --vault /path/to/你的Obsidian库
```

把随包发布的 preset/profile 文件直接写进 `~/.dsh`（不需要 pnpm / 网络），并写同样的 owner marker。功能与方式 B 等价，差别在**能力怎么送达**：方式 B 由 bundle 的补丁层声明 preset（模块走包内路径），方式 C 把 preset 的模块**命令式落盘到 profile 目录**、并在 `--patch` overlay 里用相对路径引用它们（这两条都在 dsh 启动前完成，所以不存在"第一次启动来不及"的问题）。

### Obsidian 插件安装

Obsidian 插件**内置直写流程**（等价于方式 C 的 `--direct` 逻辑，因为插件必须离线可用、不依赖 node/pnpm），并写同样的 owner marker。三种方式功能等价，靠 owner marker 避免互相覆盖。

### 三种方式在 dsh「内置插件 → 插件管理」页里的可见性不同（2026-09-26 实测）

那一页列的是**包**，不是行。它的数据来自 dsh 自己的 `dsh-plugin-manager`：

```
names = dsh.profile.bundles ∪ profile.dependencies ∪ installation.dependencies
```

而且只有清单里声明了 **`dsh.bundle.patch`** 的包才会带版本号/描述/行列表被列出来（否则只在"被选中"时以 `not-bundle` 问题项出现）。

| 安装方式 | 那一页里看到什么 |
|---|---|
| **方式 A**（把 bundle 加进 profile） | ✅ 能看到 `dsh-math-memory`，带版本、描述、它声明的行，可启用/禁用/移除 |
| **方式 B**（安装程序，native） | ✅ 同上（B 内部就是 `dsh plugin add dsh-math-memory`） |
| **方式 C / Obsidian 插件**（离线扁平拷贝） | ❌ **看不到**。这条通道刻意**不装包**：它把模块**平铺**进 profile 目录、用 overlay 里的**相对路径行**引用它们。没有包名/版本/`dsh.bundle.patch` ⇒ 那一页没有可列的东西。 |

**这不是缺陷**：方式 C 存在的意义就是"不需要 pnpm/网络"，代价是它不由 dsh 的包管理器托管。**离线通道的启用/禁用/卸载在 Obsidian 插件的设置页里做**（这是该通道设计的 UX），CLI 侧用 `dsh-math-memory uninstall`。

对照：用 `dsh plugin add` 装进去的第三方包（例如 `@linxin666/dsh-client-ui-skin-center`）**会**出现在那一页 ✓。

> 让离线通道也"包化"（从而既可离线又能在那一页被管理）是一份**提案**，见 [`bundle-channel-plan-2026-09-26.md`](bundle-channel-plan-2026-09-26.md)（状态：提案，未动代码）。

### 让主 dsh web（3080）也有笔记助手模式与记忆面板

默认只有专用 profile（`notes-assistant`，Obsidian 侧栏用）会被插件铺好；主 `web` profile 里
**看不到"数学笔记助手"模式、也没有记忆面板**——因为引擎/preset/面板路由来自我们的 bundle，而客户端
半个是单独装的。想两侧通用：

```bash
# ① 引擎 + preset + 面板宿主路由（bundle 通道；装进 web 即成为该 profile 的一个 bundle）
dsh plugin --profile web add dsh-math-memory

# ② 面板的客户端半个（安装器会把 loader 行插进 web 自己的 cordis.patch.yml —— 那一层没人重写）
node dsh/install.mjs install --profile web
```

> ⚠️ **`--profile web` 不能省。** 这里此前写着 `dsh-math-memory install --native`，而 `--native` 这个
> flag **不存在**：`install.mjs` 的参数解析没有它、也不报错（未知参数被静默忽略），于是命令会退回默认
> profile `notes-assistant`，把客户端半个装进**侧栏那个 profile**，而 `web` 依旧没有面板——正好是本节
> 想解决的反面，而且全程没有任何提示（2026-09-26 查文档时发现并删掉）。

三点注意：

- **必须重启 3080 那个 dsh**（bundle 列表在启动时读）；重启会断开当前页面连接。
- **已发布的 0.7.8 不要用**：它是 0.1.7 适配之前的形态，bundle 补丁里**没有 preset 声明** ⇒ 装完
  3080 里不会出现笔记助手模式（实测）。等下一版发布，或临时用本地目录
  `dsh plugin --profile web add file:<仓库绝对路径>`（会在该 profile 的 `package.json` 留下
  `file:` 依赖，仓库挪位置后要重装）。
- **客户端半个只能装一份真宿主**：`web` 装了 bundle 之后，bundle 的行**已经**注册
  `/memory-panel/*`，所以客户端包里必须是**空宿主半**（安装器现在会自动这样判；两份真宿主会让整个
  profile 以 `duplicate prefix route` 起不来）。
- **数据是共享的**：记忆在 vault 的 `.deepseek/memory/**`，两侧用同一个 vault 就是同一份记忆；
  3080 侧第一次用面板前，先让它有一个以该 vault 为工作区的会话，下拉里才会出现它。

### 装进已有 `web` profile？

可以，但会**失去 fail-closed 沙箱**（沿用 `web` profile 自己的沙箱策略）。安装程序检测到非专用 profile 时会打印醒目警告。想保证安全边界，请用专用的 `notes-assistant` profile。

## 2. 升级

```bash
# 能力层升级（preset/工具/引擎/面板）
dsh plugin --profile notes-assistant update dsh-math-memory
```

升级后**重启 dsh** 即可：preset 是 bundle 补丁里的一行声明，随包升级自动生效（离线通道则由安装器/插件引导把新版模块覆盖进 profile 目录——它们是代码不是配置，每次都覆盖）。vault 模板属于「种子」，只在 `install` 时种一次、之后归用户，升级不会覆盖你改过的模板。

## 3. 冲突解决怎么用

系统在多个位置写入时，用 **owner marker（归属标记）** 判定所有权，避免两条通道（`npm` bundle vs `direct` 直写）互相覆盖。owner 取值只有两个：`npm`（bundle 通道）和 `direct`（`--direct` 或 Obsidian 内置直写）。**标记文件是 profile 自己的 `~/.dsh/profiles/<profile>/.install-manifest.json`**（三条安装方式都写它，守卫优先读它）。

旧的 `~/.dsh/.agent-presets/notes-assistant/.owner.json` 已**退役**（2026-09-26）：不再被任何通道写入，只在 profile 清单缺失时作为**兼容回退**被读取（这样 2026-09-26 之前装的那份仍会被认出来，而不是被另一条通道静默接管）；`uninstall` 会把它连同那个目录一起清掉。原本只有它一个锚点，于是"清理这个没人读的死目录"会**静默废掉**这层保护——这也是它被迁走的原因。

**先诊断：**

```bash
dsh-math-memory status
```

会列出：bundle 是否登记、preset 同步状态、姿态是否在位、当前 owner 是谁、vault 模板清单。

**遇到「归属冲突」报错时：**

```
preset .agent-presets/notes-assistant is owned by "direct" (v0.7.0),
but this installer is "npm" (v0.7.1). Refusing to overwrite.
```

意思是：之前用 `--direct`（或 Obsidian 内置直写）装的（owner=direct），现在又用 bundle 装（owner=npm）。**这是保护，不是故障**。两个选择：

- **切回原通道**：用回之前那套（direct / Obsidian）继续维护，不要混用。
- **切换到新通道（接管）**：确认后加 `--force`：

  ```bash
  dsh-math-memory install --force
  ```

  `--force` 会重写 marker，把所有权接管到 npm 通道，之后以 npm 包为准。

**双向保护**：这套拒绝是双向的——`--direct`/Obsidian 直写遇到 owner=npm 会拒绝；bundle 在启动时同步遇到 owner=direct 也会跳过并告警。任何一方都不会静默覆盖另一方的安装。

**全局 patch**：本系统写进 `$DSH_HOME/cordis.patch.yml` 的条目都用 `# dsh-math-memory:begin` / `# dsh-math-memory:end` 包裹，卸载只摘除自己这一块，不碰其它插件。

## 4. 卸载怎么用

```bash
dsh-math-memory uninstall            # 先看计划，不做任何改动（默认 dry-run）
dsh-math-memory uninstall --yes      # 执行「自动删」级别
dsh-math-memory uninstall --purge --yes          # 加删脚手架模板
dsh-math-memory uninstall --purge --purge-data --yes   # 加删记忆内容（需确认短语）
```

卸载按「**可重建性**」分三级：

> **记忆默认保留**：卸载**不会**删除你的记忆内容（records/topics/theorems/templates/episodes/strategy 卡片、inbox、archive 等），除非你**显式**加 `--purge-data` 并输入确认短语 `DELETE MY MATH MEMORY`。不传 `--vault` 时 `.deepseek/**` 完全不被触碰。

| 级别 | 内容 | 何时删 |
|---|---|---|
| 自动删 | bundle 登记、同步出的 preset 副本、机器缓存 `.deepseek/cache/**`、工作区注册 | `--yes` |
| 骨架 | `index.md`、`_README.md`（纯索引骨架，重装可逐字重建） | `--purge` |
| 内容 | `AGENTS.md`、`profile.md`、`notation.md`、`capture-policy.md`、`config.md`、`working.md`、records/topics/theorems/templates/episodes/strategy 卡片、`inbox/*.md`、`archive/**` | `--purge-data` + 输入 `DELETE MY MATH MEMORY` |

**安全设计**：

1. 默认 dry-run：不带 `--yes` 时只打印「将删 / 将保留」清单，不写任何东西。
2. 记忆内容（不可重建）只有在 `--purge-data` **且**输入确认短语 `DELETE MY MATH MEMORY` 时才删，删除前会提示你先备份。
3. 执行结束打印三份清单：**已删 / 已保留（列路径）/ 需手动**（如 Obsidian 插件本体，交给 Obsidian 自己禁用/卸载）。

示例输出：

```
$ dsh-math-memory uninstall
[dry-run] will remove bundle: dsh-math-memory, @deepseek-ai/dsh-web-app (profile notes-assistant)
[dry-run] will remove preset copy: ~/.dsh/.agent-presets/notes-assistant (owner=npm)
[dry-run] will remove cache: <vault>/.deepseek/cache
[keep]    skeletons (use --purge): .deepseek/**/index.md, _README.md
[keep]    memory content (use --purge-data): AGENTS.md, .deepseek/memory/records/**, ...
Run with --yes to execute the "自动删" tier.
```

## 5. 常见问题

- **装完看不到「数学笔记助手」preset？** bundle 在 dsh 启动时才同步 preset，`dsh plugin add` 后请**重启 dsh**。
- **`status` 显示 owner 是 direct，我想改用 npm？** 见 §3，用 `install --force` 接管。
- **只想删缓存、保留所有记忆？** `uninstall --yes`（只动「自动删」级别，记忆内容默认保留）。
- **卸载会删我的笔记吗？** 不会。本系统只管理 `.deepseek/**` 下的记忆文件与模板；你的普通笔记（`.md`）从不被安装/卸载触碰。记忆内容也只在 `--purge-data` + 确认短语时才删。
- **为什么装能力用 `dsh plugin`、装姿态要用安装程序？** 见 §0 与 [`dsh-native-refactor.md`](dsh-native-refactor.md) §2：`dsh plugin` 是 dsh 原生的 bundle 安装通道；「种安全姿态」这类部署操作 dsh 没有原生命令，只能由安装程序落盘。
