# dsh-native 分发重构评估 — 完整安装 / 卸载 / 冲突解决

状态：**评估 + 迁移清单（未动工）**。目标：dsh 侧交付改为 **dsh 原生 bundle 模式**（参照 `@linxin666/dsh-liangshen`），做到——(1) 仅用 `dsh plugin` 即可原生装出全部能力；(2) Obsidian 插件 bootstrap 退化为「调用安装程序」，保留直写作应急兜底；(3) 任意安装路径功能完整且互不冲突；(4) 提供干净、安全的**卸载**手段；(5) 符合 dsh 设计理念。

## 0. 结论摘要（TL;DR）

- **capability（能力）**：preset / 笔记工具 / 记忆引擎 / 面板路由 / workspace 自动注册 → 全部进 bundle，`dsh plugin add` 原生送达（见 §2 实测结论）。
- **posture（部署姿态）**：fail-closed 沙箱 / 审批 / 权限表 / 默认 preset / workspace root → 属于「部署姿态」，是机器/用户特定且安全敏感的，**不该**由可复用 bundle 强制，由安装程序落盘到 profile 的 `cordis.patch.yml`（这是唯一非原生、也合理非原生的部分）。
- **安装程序退化为薄编排器**：内部调用 `dsh plugin add` 装能力 + 只写 posture 文件 + 记录 owner marker；不再手写拷贝 preset/profile。
- **Obsidian bootstrap**：只调用安装程序；原始直写流程保留为**应急兜底**（node/pnpm 缺失等）。
- **冲突解决**：owner marker + 版本戳，单一 owner，异主报错 + `--force` 接管。
- **卸载**：对称 `uninstall` 子命令 + 按「可重建 / 不可重建」分级的删除矩阵（默认 dry-run，记忆内容仅在 `--purge-data` + 确认短语时删）。

## 1. 现状盘点

三条交付通道都靠**命令式拷贝**（详见 `dsh/install.mjs`）：

| 通道 | 入口 | 写什么 |
|---|---|---|
| npm CLI | `dsh/install.mjs`（`postinstall` 自动跑） | preset 5 文件 + profile 9 文件 + vault 模板 18 个 |
| Obsidian 插件 | `obsidian/main.template.js` bootstrap | 同上（嵌入 `main.js`，不依赖 node/npm） |
| 本机一键 | `scripts/deploy-local.mjs` | 同上（gitignore） |

关键事实：引擎**已经是 cordis 插件**（`math-memory.mjs` 导出 `name/inject/apply`，注入 `tools/fs/systemPrompt/loader`）。差距不在引擎形态，而在**交付机制**——无 `dsh.bundle.patch`、命令式拷贝、`postinstall` 隐式装 `~/.dsh`、引擎按本地路径 `./math-memory.mjs` 引用（导致 `note-tools.mjs` 需要 `ctx.loader.internal.import` 动态导入兜底）。

## 2. 实测结论：`dsh plugin` 到底做了什么

本机 dsh CLI 与 `@deepseek-ai/dsh-app-boot` / `dsh-web-app` 源码确认：

1. `dsh` 顶层**只有一个子命令 `plugin`**（无 `dsh profile` / `dsh preset`）。
2. `dsh plugin --profile <n> add <pkg...>` = 三步：**① profile 不存在则自动初始化**（`initProfile(dir, PROFILE_TEMPLATES[n] ?? DEFAULT_PROFILE_BUNDLES)`，其中 `DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"]`）；**② pnpm add**；**③ reconcile**——遍历 profile 的**直接** `dependencies`，凡声明 `dsh.bundle.patch` 的包**自动追加进 `dsh.profile.bundles`**，被移除/失去 bundle 声明的包自动移出（`plugin-9h8shc4d.js` `reconcilePlugins`）。
3. `@deepseek-ai/dsh-web-app` 是 **in-box bundle**（随 dsh 安装自带，`dsh-web-app@0.1.1-rc.2` 在 dsh 自己的 `node_modules` 里）——它**不能** `dsh plugin add`（pnpm 会去注册表拉一个版本对不上的副本，镜像站还会对其依赖 `dsh-frontend-static` 报 404）。in-box bundle 只写进 profile 的 `dsh.profile.bundles`，由 `loadProfile` 从 dsh 安装目录解析，不经 pnpm。

**结论**：原生完整安装 = **安装程序先写 profile 骨架（`package.json` 的 `dsh.profile.bundles = [dsh-base, dsh-web-app]`，均为 in-box）→ 再 `dsh plugin add dsh-math-memory`（只有它是树外插件）**：

```bash
dsh-math-memory install --profile notes-assistant
# → 写骨架（in-box dsh-base + dsh-web-app）+ dsh plugin add dsh-math-memory
#   dsh.profile.bundles = [dsh-base, dsh-web-app, dsh-math-memory]
```

「仅通过 `dsh plugin` 完整安装能力」**不成立**——in-box bundle 不能 pnpm 拉；正确形态是「骨架 + 树外 bundle」，只有 `dsh-math-memory` 走 `dsh plugin add`。

## 3. 目标架构：capability 进 bundle，posture 留 profile

原则：**bundle = 可复用能力；profile = 部署姿态**。这是 dsh-native 的正确切分——`dsh-liangshen` 也遵守「往已存在 profile 加插件，不建 profile、不种安全姿态」。

```
┌─ bundle  dsh-math-memory（dsh plugin add 送达，capability）──────────────┐
│  dsh/cordis.patch.yml:                                                    │
│    insert { id: math-memory, name: 'dsh-math-memory' }   ← host 插件     │
│  exports "." → dsh/host/index.mjs（host 插件 apply 时）:                  │
│    ① preset-sync: 同步 dsh/preset/ → ~/.dsh/.agent-presets/notes-assistant/│
│    ② panel: 注册 /memory-panel/* 路由（有 host webserver 时）              │
│    ③ workspace: 自动注册 vault 工作区（有 workspaceRegistry 时）           │
│  dsh/preset/（agent.cordis.yml + math-memory.mjs + note-tools.mjs + ...） │
└──────────────────────────────────────────────────────────────────────────┘
┌─ profile  notes-assistant（安装程序落盘，posture）────────────────────────┐
│  cordis.patch.yml: fail-closed 沙箱 / 审批 / 权限表 / 默认 preset / root   │
│  （由 dsh-math-memory install 写入；唯一非原生但合理的部分）                │
└──────────────────────────────────────────────────────────────────────────┘
┌─ vault（安装程序落盘模板，数据默认不删，见 §6）──────────────────────────┐
│  .deepseek/** 模板 + AGENTS.md（种子，之后归用户）                          │
└──────────────────────────────────────────────────────────────────────────┘
```

相对现状的变化：

- `dsh/profile/notes-assistant.patch.yml`（`--patch` overlay 里 workspace + panel）**并入 bundle 的 `cordis.patch.yml`**，启动不再需要 `--patch`（skin overlay 除外）。
- `dsh/host/*.mjs` 变成 bundle 的内部模块（`exports "."` 主插件 import 它们）；Obsidian 侧仍把同一批文件嵌入 `main.js`（离线路径，共享单一事实来源不变）。
- `dsh/install.mjs` 退化为薄编排器（§4），不再拷贝 preset/profile。

## 4. 安装程序：薄编排器（install / status / uninstall）

`dsh-math-memory`（`bin`）暴露三个子命令，**单一入口**供 CLI 与 Obsidian bootstrap 共用。

```
dsh-math-memory install [--vault <dir>] [--dsh-home <dir>] [--profile <name=notes-assistant>] [--force]
  1. 写 profile 骨架（in-box dsh-base + dsh-web-app）→ dsh plugin --profile <name> add dsh-math-memory   # 原生装能力
  2. 写 profile cordis.patch.yml（posture：沙箱/审批/权限/默认 preset/root）     # 只写姿态
  3. 写 owner marker + install manifest（记录写过的文件 + 版本 + 哈希）
  4. --vault 时种子 vault 模板（幂等、保留用户编辑）
  5. 校验：dsh --profile <name> --dump-config 冒烟，报告 bundle 是否登记成功

dsh-math-memory status [--dsh-home <dir>]
  列出：bundle 登记 / preset 同步状态 / posture 是否在位 / marker owner / vault 模板清单

dsh-math-memory uninstall [--vault <dir>] [--purge] [--purge-data] [--yes]   # §6
```

要点：

- 第 1 步**直接复用 `dsh plugin add`**，不是模拟它——bundle 登记、`node_modules`、`dsh.profile.bundles` 全交给 dsh 自己维护，安装程序不碰。
- 第 2 步是**唯一**手写文件：profile 的 posture。它没有 dsh 原生命令等价物，且必须由「部署者」显式授权（因为 fail-closed 是安全承诺，不该随 bundle 静默强加给任何 profile）。
- 若用户想装进**已有 `web` profile**（不建专用 profile）：能力照常工作，但**没有 fail-closed 沙箱**（沿用 web 的沙箱）。安装程序检测到非专用 profile 时**打印醒目警告**，推荐专用 `notes-assistant`。

## 5. 冲突解决：owner marker + 版本戳

双通道（npm bundle-sync vs Obsidian bootstrap 直写）会写同一批目录。用 **owner marker** 建立单一所有权：

| 位置 | marker | 内容 |
|---|---|---|
| `.agent-presets/notes-assistant/.owner.json` | preset 归属 | `{ owner: "npm"\|"obsidian", version, installedAt }` |
| `profiles/notes-assistant/.install-manifest.json` | profile 归属 | 落盘文件清单 + 哈希 + 版本 + owner |
| `$DSH_HOME/cordis.patch.yml` | 全局 patch 归属 | 我们加的条目用 `# dsh-math-memory:begin/end` 包裹 |

规则：

1. **同主**：幂等升级（字节比对跳过一致文件，prune 源里没有的，retire 被删的）。
2. **异主**：安装时检测到 `owner` 不是自己 → **报错并给指引**（说明当前归属哪个通道、如何切换），`--force` 才接管（重写 marker）。
3. **版本戳**：bootstrap 直写前读 marker；若线上 bundle 版本更新，直写回退路径**拒绝降级覆盖**（只允许 ≥ 已装版本），防止旧 `main.js` 嵌入快照覆盖新 npm 版。
4. **全局 patch 只删自己的块**：卸载按 `begin/end` 标记摘除，绝不碰其他插件条目。

这样「无论用户如何安装，功能完整且互不冲突」由两点保证：能力来源收敛到 bundle（单一事实来源），所有权由 marker 显式判定（有冲突就报错而非静默覆盖）。

## 6. 卸载：按「可重建性」分级 + 默认 dry-run

记忆系统在多层注入了东西。卸载的正确性目标不是「承诺永不删」，而是**默认不删任何不可重建内容，且删除前先打印完整计划（dry-run）**——把「可预期」落到操作层。

**默认行为 = dry-run**：`uninstall` 不带 `--yes` 时只打印「将删 / 将保留」清单，不做任何写操作；加 `--yes` 才执行。

| 层 | 内容 | 卸载动作 |
|---|---|---|
| bundle | `profiles/notes-assistant` 的 `dsh-math-memory` + `dsh-web-app` 依赖 | `dsh plugin remove`（reconcile 自动移出 `dsh.profile.bundles`） |
| 同步出的 preset 副本 | `.agent-presets/notes-assistant/**` | 仅当 `.owner.json` 认领方是自己才删（副本，源码在包里，可重装重建）；异主报错 |
| profile 目录 | `profiles/notes-assistant/**` | 默认列出；`--purge` 删（`node_modules` 清空后） |
| 全局 patch | `$DSH_HOME/cordis.patch.yml` 内 `begin/end` 块 | 摘除自己的块 |
| workspace | dsh 工作区注册项 | 注销 vault 工作区 |
| 机器生成缓存 | `.deepseek/cache/**` | 自动删（可重建） |
| 可重建骨架 | `index.md`、`_README.md`（纯索引骨架，重装可逐字重建） | 默认**保留 + 列出**；`--purge` 删 |
| 用户/模型内容 | `AGENTS.md`、`profile.md`、`notation.md`、`capture-policy.md`、`config.md`、`working.md`、records/topics/theorems/templates/episodes/strategy 卡片、`inbox/*.md`、`archive/**` | 默认**不删**；`--purge-data` + 输入确认短语 `DELETE MY MATH MEMORY` 才删，删前提示先备份 |
| Obsidian 插件 | `.obsidian/plugins/<id>/` + `data.json` | 交给 Obsidian 自身「禁用/卸载」，本程序不碰 |

执行结束打印三份清单——「已删 / 已保留（列路径）/ 需手动（如 Obsidian 插件本体）」。

**为什么不用「永不」这种绝对措辞**：缓存与 preset 副本这类**可重建**内容，自动删是安全且必要的；真正要守住的是「**不可重建**」这一类。分级按「可重建性」划分，而不是笼统承诺，这样默认 dry-run + 不可重建需确认短语，两道闸共同兜住「误删」。

## 7. 迁移清单（文件级，分阶段）

**Phase A — bundle 化能力（可先行，不动 install.mjs）**

- [ ] 根 `package.json`：加 `dsh.bundle.patch: "./dsh/cordis.patch.yml"`；`exports "."` 指向 host 主插件。
- [ ] 新增 `dsh/cordis.patch.yml`：`insert { id: math-memory, name: 'dsh-math-memory' }`。
- [ ] 新增 `dsh/host/index.mjs`（host 主插件）：preset-sync + panel 路由 + workspace 注册三合一，`mountOnce` 防重。
- [ ] 新增 `dsh/host/preset-sync.mjs`：移植 `dsh-liangshen/src/sync.ts` 为纯 JS（字节比对/prune/retire/写 `.owner.json`）。
- [ ] 复用现有 `dsh/host/memory-admin.mjs` / `math-memory-panel.mjs` / `math-memory-workspace.mjs`（import 进主插件）。
- [ ] 新增 `scripts/test-preset-sync.mjs`（幂等/prune/retire/owner marker 回归）进 `npm test`。

**Phase B — 安装程序改造 + 卸载 + marker**

- [ ] `dsh/install.mjs` 改为薄编排器（§4）；删 `installPreset()`/`installProfile()` 的文件拷贝，改调 `dsh plugin add` + 写 posture + 写 marker/manifest。
- [ ] 新增 `uninstall` / `status` 子命令 + 删除矩阵（§6）。
- [ ] Obsidian `main.template.js` bootstrap：优先调 `dsh-math-memory install`；捕获失败（node/pnpm 缺失等）→ 回退原始直写（带版本戳 + 拒绝降级）。
- [ ] `postinstall` 语义：移除自动装 preset/profile，改为打印 `dsh plugin add` 指引（或保留 `install --quiet` 作显式选项，见决策 2）。
- [ ] `scripts/test-installer.mjs`：适配新清单 + 卸载/冲突回归。
- [ ] 全局 patch 条目改 `begin/end` 标记（skin fallback 相关）。

**Phase C — 文档 + 发布**

- [ ] `ARCHITECTURE.md` §2 更新（bundle 化后的职责 + uninstall + marker）。
- [ ] `README.md` / `README.zh.md`：`dsh plugin add` 为主、CLI 为辅、卸载说明；**中文文档必须保留**。
- [ ] `docs/memory/handoff.md`、`docs/memory/changelog.md`、根 `CHANGELOG.md`。
- [ ] `scripts/check-doc-consistency.mjs` 若断言数变化则同步。
- [ ] Obsidian 插件设置页加「卸载」入口（调 `uninstall`）。

## 8. 决策记录（已定）

| # | 决策 | 结论 |
|---|---|---|
| 1 | owner marker 异主策略 | **同主幂等 / 异主报错 + `--force` 接管**（语义最清、可预期） |
| 2 | `postinstall` 去留 | **移除自动装，只打印 `dsh plugin add` 指引**（符合 dsh-native） |
| 3 | 共享 `web` profile | **允许 + 醒目警告（无 fail-closed）**（灵活 + 安全提示） |
| 4 | `--purge-data` 确认 | **输入确认短语 `DELETE MY MATH MEMORY`**（脚本友好、误删概率低） |
| 5 | 版本号 | **0.7.1**（功能无变化，仅安装方式优化，patch 级） |

## 9. 风险

- **双通道写同一目录** → marker 未落地前不删 `install.mjs` 直写路径（Phase B 前 Phase A 两条并存）。
- **冷启动时序**：`dsh plugin add` 后、首次 boot 前 preset 不在 `.agent-presets/`——文档写明「add 后重启 dsh 生效」。
- **posture 非原生**：fail-closed 由安装程序落盘，若用户手改 `cordis.patch.yml` 可能与后续升级漂移——用 `install-manifest.json` 的哈希检测「用户已改」并跳过覆盖。
- **schema 校验缺失**：preset-sync 暂做「文件存在 + 非空」最小校验（`dsh-liangshen` 的 `validateAgentCordis` 需移植或略过）。
- **uninstall 边界**：`healProfilesModuleFallback` 维护的 `$DSH_HOME/profiles/node_modules` 扁平链接由 dsh 自动管理，不手动清；workspace 注册项若已不存在则跳过。

## 10. 明确不做（Non-goals）

- 不改 Obsidian 插件「离线直写」为依赖 npm/node（应急兜底必须保留）。
- 不把 vault 模板改成运行时同步（需目标路径，仍走安装程序）。
- 不在本次把引擎拆成独立 npm 包（原 Tier 3 延后）。
- 不动 memory 系统内部逻辑（分层/检索/体检/策略层），本次只改**交付 + 卸载 + 冲突机制**。
