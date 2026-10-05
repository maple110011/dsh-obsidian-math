/**
 * profile-contract — 这份插件往一个 dsh profile 里放什么、服务哪些路由：**唯一**的机器可读陈述。
 *
 * 为什么存在（2026-09-26，解耦第 2 步 / `docs/decoupling-assessment-2026-09-26.md` §5 方案 A）：
 * 同一批事实（文件清单、overlay 行 id、路由路径）原本**手写在四处**——仓库里的 deployer、CLI 安装器、
 * Obsidian 引导、面板的路由链——而那份文档 §3.7 统计的 46 起跨边界事故里，"B. 契约/枚举未同步"占 10 起，
 * 每一起都是从其中一处先漂移开始的。**能读这份契约的代码就读它**；读不到的（内嵌后取不到构建期信息的地方）
 * 由 `scripts/check-profile-contract.mjs` 钉住，且该门禁会明说"哪几条是钉住而不是读的"。
 *
 * ⚠️ **必须保持平铺可用**：本文件会被内嵌进 `main.js`、并在 profile 目录里物化成 `./profile-contract.mjs`，
 * 所以所有消费者都用**平铺名** import 它（`./profile-contract.mjs`），不要放进子目录。
 *
 * 不进这里的东西：版本号（有 `check-version-consistency`）、preset 声明正文（由
 * `scripts/build-preset-declaration.mjs` 从 `agent.cordis.yml` + `preset.yml` 生成）。
 */

/**
 * preset 的相对行需要、且在 dsh 0.1.7 里必须平铺在 profile 目录里的模块。
 * 权威消费点：`dsh/preset/preset-deploy.mjs`（把它原样再导出，4 处既有 import 不受影响）。
 */
export const PRESET_BODY_FILES = ['math-memory.mjs', 'note-tools.mjs', 'hook-frontmatter.mjs', 'engine-shared.mjs'];

/**
 * 离线通道（Obsidian 引导 / `install --direct`）另外铺进 profile 的脚手架与宿主半。
 * 与 `PRESET_BODY_FILES` 合起来就是"一个能启动的 profile 需要哪些文件"的全集。
 */
export const PROFILE_SCAFFOLD_FILES = [
  // This file itself. It is the ONE name that has to be staged by hand (everything else derives from
  // it), and it must be listed here so the manifest and the gates agree with what is written — the
  // 2026-09-26 experiment showed a listed-but-unwritten file passing silently in BOTH writers.
  'profile-contract.mjs',
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
  'math-memory-workspace.mjs',
  'notes-assistant.patch.yml',
  'memory-admin.mjs',
  'math-memory-panel.mjs'
];

/**
 * 这些 posture 文件**不是**安装器独占的：安装器只负责在文件缺席时把它铺下去，之后
 * **永不重写**，而且**不许**把它的字节当成"我们说它是什么样它就必须是什么样"的凭据。
 *
 * 为什么需要这个区分（2026-09-27 真机取证，2026-10-01 落地）：
 * 安装清单原本给**每一个** posture 文件记 sha256，并把它当硬校验（第三份完整性基线）。
 * 其中 `cordis.patch.yml` 被同一个安装器在 650 行之外明确定义为"用户的层、永不重写"
 * （`dsh/install.mjs` 的 `ensurePosture` 注释），而 dsh 自己的设置面板按设计就重写它 ——
 * `@deepseek-ai/dsh-config-editor` 把整份文件重新序列化后追加自己那一行
 * （实测：本机该文件从 3738 B 变成 4523 B，其中 11 B 的差来自 YAML 把两条长 `!!js`
 * 标量在 80 列处折行，而这种折行**不可能是**人手编辑的形态）。
 * ⇒ 摘要**注定**过期，而门禁把"按插件自己的指示编辑了配置"判成了故障。
 * 这类文件上一个就会让门禁永久飘红，于是没人再分得清哪条红是真故障。
 *
 * 判据是**谁还会写这个文件**，不是"谁创建了它"——所以每条都带实测到的另一个写入方：
 *   · `package.json`      dsh 的插件管理器（`dsh plugin add` / 插件页）往里写 bundles 与 dependencies；
 *                         本插件自己也修它的 name/version ⇒ 两个作者。
 *   · `cordis.yml`        dsh 每次组合 profile 都把它重写回 `[]`（实测 `--dump-config` 就会写，
 *                         字节相同但 mtime 每次都变）⇒ 字节归 dsh 所有。
 *   · `cordis.patch.yml`  用户按设计在这里放自己的 provider/默认模型；dsh-config-editor 也会写它。
 * 其余 posture 文件（模块 `.mjs`、`notes-assistant.patch.yml`、`pnpm-workspace.yaml`）目前
 * **只有我们写**，所以继续按硬基线校验 —— 那正是这条基线存在的意义（抓截断写入与旧插件覆盖）。
 * 要往这里加名字，请先写明实测到的第二个写入方；没有第二个写入方的文件不许进来。
 */
export const POSTURE_SHARED_FILES = ['package.json', 'cordis.yml', 'cordis.patch.yml'];

/**
 * 本插件往三个 patch 层里插入的**全部**行 id（实测取自三份文件，2026-09-26）：
 *   · 包内 patch（bundle 通道）: `math-memory-host` + `preset-notes-assistant`
 *   · profile 自己那层（离线通道）: `preset-notes-assistant`（自 B3 起声明的家）
 *   · overlay（`notes-assistant.patch.yml`）: `math-memory-workspace` / `math-memory-panel` /
 *     `math-memory-client-panel`
 * 其余 id（persona / tool-fs / sandbox-policy …）属于 dsh-base 的 posture，不是本插件的。
 */
export const OVERLAY_ROWS = [
  'math-memory',
  'math-memory-host',
  'math-memory-workspace',
  'math-memory-panel',
  'math-memory-client-panel',
  'preset-notes-assistant'
];

/** 判定"这个行 id 属于本插件"的取名规则——门禁用它来发现"多出来的自家行"。 */
export const OWN_ROW_ID_PATTERN = '^(math-memory|preset-notes-assistant)';

/**
 * 宿主半实际服务的 `/memory-panel/*` 路径。
 * ⚠️ 面板内部仍是一条 `if (pathname === …)` 链（改成表驱动属于 A′ 的范围），所以这一项是**被门禁钉住**的，
 * 不是被代码读的——门禁会从 `dsh/host/math-memory-panel.mjs` 源码里提取实际路径与它比对。
 */
export const PANEL_ROUTES = [
  '/memory-panel/workspaces',
  '/memory-panel/state',
  '/memory-panel/feedback',
  '/memory-panel/archive',
  '/memory-panel/capture-policy',
  '/memory-panel/archive-episodes',
  '/memory-panel/session-capture',
  '/memory-panel/session-capture-toggle',
  // D2 (2026-09-26): the Obsidian settings page's writes go through these two now.
  '/memory-panel/config-flag',
  '/memory-panel/injection-budget'
];
