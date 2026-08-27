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

把我们的 bundle 加进**已存在**的 `web` profile（它自带 in-box 的 dsh-base + dsh-web-app）。装完后**重启 dsh**，bundle 宿主插件会在启动时把 preset 同步进 `~/.dsh/.agent-presets/`，新建会话即可选「数学笔记助手」。

**注意**：`@deepseek-ai/dsh-web-app` 是 dsh 的 **in-box bundle**（随 dsh 安装自带），**不能** `dsh plugin add`（会去注册表拉一个版本对不上的副本）。新建专用 profile 请用方式 B（安装程序会写骨架），方式 A 只适合往已有 `web` profile 里加 bundle。方式 A 也**没有** fail-closed 沙箱（沿用 web 的沙箱）。

### 方式 B：安装程序（能力 + 姿态 + 模板，CLI/npm 用户）

```bash
dsh-math-memory install --vault /path/to/你的Obsidian库
```

内部依次做：调 `dsh plugin add` 装能力 → 写 profile 姿态 → 写 owner marker → 种 vault 模板（`AGENTS.md` + `.deepseek/**`）。这是**完整**安装，需要 pnpm + 网络。

### 方式 C：离线扁平拷贝（无 pnpm）

```bash
dsh-math-memory install --direct --vault /path/to/你的Obsidian库
```

把随包发布的 preset/profile 文件直接写进 `~/.dsh`（不需要 pnpm / 网络），并写同样的 owner marker。功能与方式 B 等价，只是「能力」不是由 bundle 在启动时同步，而是命令式落盘。

### Obsidian 插件安装

Obsidian 插件**内置直写流程**（等价于方式 C 的 `--direct` 逻辑，因为插件必须离线可用、不依赖 node/pnpm），并写同样的 owner marker。三种方式功能等价，靠 owner marker 避免互相覆盖。

### 装进已有 `web` profile？

可以，但会**失去 fail-closed 沙箱**（沿用 `web` profile 自己的沙箱策略）。安装程序检测到非专用 profile 时会打印醒目警告。想保证安全边界，请用专用的 `notes-assistant` profile。

## 2. 升级

```bash
# 能力层升级（preset/工具/引擎/面板）
dsh plugin --profile notes-assistant update dsh-math-memory
```

升级后**重启 dsh**，宿主插件会把新版 preset 同步进 `.agent-presets/`（字节比对，只更新变化的部分，不碰用户自建的其它 preset）。vault 模板属于「种子」，只在 `install` 时种一次、之后归用户，升级不会覆盖你改过的模板。

## 3. 冲突解决怎么用

系统在多个位置写入时，用 **owner marker（归属标记）** 判定所有权，避免两条通道（`npm` bundle 同步 vs `direct` 直写）互相覆盖。owner 取值只有两个：`npm`（bundle 在启动时同步）和 `direct`（`--direct` 或 Obsidian 内置直写）。

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
[dry-run] will remove cache: D:/Obsidian笔记数据库/.deepseek/cache
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
