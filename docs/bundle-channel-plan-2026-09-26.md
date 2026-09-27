# 管道方案：让离线通道也「包化」（A′）

> **状态**：`提案` → **S1/S2 已落地（2026-09-26 二次标注）**。原文写的"未实现，本文只调研 + 设计，不含代码改动"描述的是**成文时**：现在 §S1（物化模块 `dsh/profile/local-bundle.mjs`，门禁 `syntax: dsh/profile/local-bundle.mjs`）与 §S2（`test: self-provisioned profile accepts a real session` 改为**真物化**后冷启动，实测 `__CHECKS__ 10/10`，含两条变异验证）都已完成。**S3–S6 未做**，卡在 §7 的 A1–A7 与 `docs/pending-decisions-2026-09-26.md`；A2 另有一处实现方式待定（`dsh/profile/cordis.patch.yml` 已占用同名 basename，不能直接内嵌第二份）。**仍然成立**的是：未拍板前不替用户动代码。
> **面向版本**：0.7.8（本机 `package.json:3` / `manifest.json`）。
> **一句话目标**：Obsidian 引导与 `install --direct` 这两条**离线**路径，改为在 profile 内物化一个**真正的 dsh bundle 包**并走 `dsh plugin add <本地目录>`，使插件用户在**不联网**的前提下自动安装，同时该插件出现在 dsh 的「内置插件 → 插件管理」页且可启用 / 禁用 / 移除；现有的**平铺通道保留为兜底**。
> **证据来源**：仓库文件（相对路径）+ 本机安装的 dsh **0.1.7-rc.2**（`C:\Users\小新air15\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\`，下文 `@deepseek-ai/...` 均指该目录下的包）。实测与本机现场读取的差别在文中逐条标注。

---

## 1. 为什么现在不显示（机制 + 证据）

**机制。** 插件管理页的卡片来自 `dsh-plugin-manager` 的 `listBundles()`，它先算「候选名字」：

```
names = dsh.profile.bundles ∪ profile.dependencies ∪ installation.dependencies
```
（`@deepseek-ai/dsh-plugin-manager/lib/index.js:1456-1466`）

然后对每个名字读它的清单：`bundleManifest()` **只在该包声明了 `dsh.bundle.patch` 时返回清单**，否则返回 `undefined`（同文件 `:226-229`）。返回 `undefined` 且**未被选中**时该名字**根本不进列表**；只有"被选中却不是 bundle"才会以 `error.code = "not-bundle"` 出现（同文件 `:1476-1488`）。声明了 bundle 的包则带上 `version` / `description` / `meta`（icon + locale 标题）与它 patch 里声明的行（`:1494-1505`）。

**本机现场（只读）。** 侧栏 profile 现在是 direct 形态：

- `C:\Users\小新air15\.dsh\profiles\notes-assistant\package.json:4-17`：`dependencies` 只有三个包（两个 `@linxin666/...` + `@dsh-math-memory/client-ui-memory-panel`），`dsh.profile.bundles` 只有 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与那两个 `@linxin666` 包 —— **没有 `dsh-math-memory`**，`node_modules` 里也没有它。
- 同 profile 的 `.install-manifest.json`：`"owner": "direct"`、`"version": "0.7.8"`、`posture` = 12 个平铺文件名（与 `dsh/install.mjs:107-112` 的 `DIRECT_PROFILE_FILES` 一致）。
- 因此 `dsh-math-memory` 既不在 `selected` 也不在 `dependencies` ⇒ **它连 "not-bundle" 项都不会出现**；而同一个 profile 里的 `@linxin666/dsh-client-ui-skin-center` 声明了 bundle patch，所以它在页面里可见。

**direct 通道做了什么。** `directInstallProfile()` 把 `dsh/profile|host|preset` 下的文件**平铺**进 `profiles/<id>/`，再写 owner 标记（`dsh/install.mjs:364-415`，标记见 `:413`）；overlay 里的行写成相对路径（`dsh/profile/notes-assistant.patch.yml:27,31,129` 的 `./math-memory-workspace.mjs`、`./math-memory-panel.mjs`、`./math-memory.mjs`）。Obsidian 引导做同一件事（`obsidian/main.template.js:1876-1945`）。**两条路径都不写 dependency、也不写 `dsh.profile.bundles`**，所以名单里没有它 —— 这不是 bug，而是"平铺通道从来不产生包"的直接后果。

---

## 2. A′ 的设计

### 2.1 目标形态（包内有哪些文件、谁写、写到哪）

新增**一个纯函数模块** `dsh/profile/local-bundle.mjs`（名字待定，见 D1），由**两个调用方**共用、用**同一个注入式 reader** 读源码（与 `dsh/preset/preset-deploy.mjs:76-92` 的 `deployPresetBody({read})` 同形状）：

- **谁写**：Obsidian 引导（`obsidian/main.template.js` 的 `bootstrapDshConfig`）从**内嵌副本**读；CLI 安装器（`dsh/install.mjs`）从**磁盘**读（`presetReaderFromDir`，`dsh/preset/preset-deploy.mjs:113-121`）。
- **写到哪**：`<profile>/.dsh-math-memory/`（staging 目录，**不是** `node_modules`）。先例：客户端半个已经用同一手法把包放在 `<profile>/.dsh-client-panel/` 并在 profile 清单里声明 `file:.dsh-client-panel`（`dsh/client-panel/install-into-profile.mjs:36-38,289-311`），本机 profile 的 `dependencies` 里就能看到这一行（`profiles/notes-assistant/package.json:7`）。
- **包内文件**（全部是"当前这份源码/模板"的物化，不是新写的第二份内容）：

```
<profile>/.dsh-math-memory/
  package.json                 # 生成：name/version/description/icon/main/exports?/dsh.bundle.patch/peerDependencies
  dsh/cordis.patch.yml         # bundle patch（宿主行 + 包内 specifier 的 preset 声明）
  dsh/<host 入口的相对 import 闭包>   # host/index.mjs、channel-owner.mjs、math-memory-panel.mjs、
                                     # memory-admin.mjs、hook-frontmatter.mjs、engine-shared.mjs
  dsh/preset/<4 个体文件>       # math-memory / note-tools / hook-frontmatter / engine-shared
  dsh/profile/math-memory-workspace.mjs
  dsh/templates/config.md      # 只因为 math-memory-panel.mjs 的 configScaffold() 会读它（见 2.6）
  icon.svg
  locale/{en,zh}.json
```

`package.json` 的**关键字段**（示意；`dsh` 段的形状见根 `package.json:47-54`）：

```json
{
  "name": "dsh-math-memory",
  "version": "0.7.8",
  "description": "…（与根 package.json 同一字符串）",
  "icon": "icon.svg",
  "type": "module",
  "main": "./dsh/host/index.mjs",
  "dsh": { "bundle": { "patch": "./dsh/cordis.patch.yml" }, "engines": { "dsh": ">=0.1.7-rc.2" } },
  "peerDependencies": { "@deepseek-ai/dsh": ">=0.1.7-rc.2" }
}
```

三条**必须**的约束：

1. **不要**照抄根 `package.json`：它带 `devDependencies`（acorn/esbuild/js-yaml，`:61-65`）与 `scripts`。物化清单要最小化——虽然 `file:`/`link:` 依赖不装 devDependencies，但把 `prepare`/`postinstall` 之类脚本带进依赖是 pnpm 会真的执行（或拒绝执行、要求 `allowBuilds` 批准）的东西，而 `allowBuilds` 的写入口在 dsh 侧是被 pnpm 的构建审批触发的（`@deepseek-ai/dsh-plugin-manager/lib/index.js:927-953`）。**没有脚本 = 不触发那条路径**。
2. `peerDependencies["@deepseek-ai/dsh"]` **必须**保留：它是 dsh 兼容性门禁的唯一依据（`@deepseek-ai/dsh-app-boot/lib/index.js:286-301`；口径见 `docs/dsh-0.1.7-adaptation.md:428`），装不兼容的包会被 preflight 直接拒绝（`@deepseek-ai/dsh-plugin-manager/lib/index.js:503-514`）。
3. `version` 只能来自**单一版本源**（根 `package.json:3`，五处一致由 `check-version-consistency.mjs` 守），物化代码里不得出现第二个版本字面量。

### 2.2 patch 内容：谁写、写什么、行相对于谁解析

**行名锚点（关键事实，有实测）。** bundle patch 里的 `insert` 行若以 `./` / `../` / 绝对路径开头，会被**改写成相对 patch 文件所在目录**的 `file://` URL（`@deepseek-ai/dsh-app-boot/lib/index.js:3535-3544`）。但**preset 的 `config.plugins` 不走这条路**：它的相对 `name:` 由 agent-preset registry 用**自己的 ctx.baseUrl（= profile 目录）**解析（实测记录：`.scratch-p0-preset-probe.md` §0 结论第 2 条、`scripts/lib/preset-declaration.mjs:23-36`、`docs/handoff.md:298-301` 陷阱 92）。冷启动第一次的实测结论是：bundle 通道**不能**用 `./` 形态，必须写成**包内 subpath**（`docs/handoff.md:322-326` 陷阱 97）。

**所以 A′ 的 bundle patch 直接沿用仓库现有那份**（`dsh/cordis.patch.yml:20-22` 的宿主行 + `:36-145` 生成块）：

```yaml
- insert:
    - id: math-memory-host
      name: dsh-math-memory          # 裸包名 → 由 patch 目录向上做 node 解析，落到 node_modules/dsh-math-memory
- insert:
  - id: preset-notes-assistant
    name: '@deepseek-ai/dsh-agent-preset'
    config:
      plugins:
      - id: math-memory
        name: dsh-math-memory/dsh/preset/math-memory.mjs   # 包内 subpath，什么都不用先落盘
```

**包必须可在 `node_modules` 里按包名解析到。** `resolveBundleDir()` 用 Node 的 `node_modules` 查找顺序，先 dsh 安装锚点、再 `<profile>/package.json`（`@deepseek-ai/dsh-app-boot/lib/index.js:900-906`）；patch 文件路径由 `join(packageDir, patch)` 得到（同文件 `:495-509`）。⇒ **"任意本地路径"不够**：包必须以 `node_modules/<name>` 可解析，这也正是 `dsh plugin add` 帮你做的事。

**谁写**：这份 patch 的内容必须在运行时可用。两条候选见 **D2**（内嵌 `dsh/cordis.patch.yml` 原样复用 / 运行时从内嵌组合重新生成）。注意它**现在没有被任何门禁解析**：`check-patch-yaml.mjs` 只扫 `dsh/profile` 与 `dsh/preset`（`scripts/check-patch-yaml.mjs:58-64`），不含 `dsh/cordis.patch.yml`。

### 2.3 profile overlay 的状态机（**这是本方案最容易炸的一处**）

duplicate loader entry id 是 **cordis 硬失败**：整个 profile 起不来（`docs/handoff.md:277-287` 陷阱 89；`scripts/check-patch-yaml.mjs:137-148`）。所以 **bundle patch 与 overlay 不能同时声明同一个 preset id，也不能同时挂两个注册 `/memory-panel` 前缀的宿主半**（后者会 `duplicate prefix route "/memory-panel"`，见 `dsh/client-panel/install-into-profile.mjs:195-205`）。

| `dsh-math-memory` 是否在本 profile 的 `dsh.profile.bundles` 里 | overlay 的 preset 声明（`./` 形态） | overlay 的 `./math-memory-workspace.mjs` / `./math-memory-panel.mjs` 行 | 能力由谁提供 |
|---|---|---|---|
| **是**（A′ 主形态） | **省略** | **省略** | bundle patch：宿主行 `dsh-math-memory` → `dsh/host/index.mjs`（面板路由 + 工作区登记，`dsh/host/index.mjs:72-84`）+ preset 声明 |
| 否（兜底） | 保留 | 保留 | profile 目录里的平铺文件 |

overlay 由插件**每次起服务时**重写（`obsidian/main.template.js:1835-1841`），所以这个分支可以像 `skinCenterMountable()` 那样写成**纯文件系统判据**（先例：`obsidian/main.template.js:1727-1758` 用 `profileBundles(home)` + `skinCenterBundled`）。注意 `dsh/host/index.mjs:60-70` 还有一层**通道守卫**：owner ≠ `npm` 时它只打一条警告就 **return**（不挂面板、不登记工作区）。⇒ A′ 必须同时把 owner 改成 `npm`（见 2.5 / D4），否则会得到"bundle 已启用、宿主行却空转"的第三种形态。

客户端半个那一行（`id: math-memory-client-panel`，`dsh/profile/notes-assistant.patch.yml:32-33`）**两种形态都保留**：它是另一个包，bundle patch 不提供它；"恰好出现一次"由 `check-patch-yaml.mjs:149-195` 守着。

### 2.4 安装调用形状

```
dsh plugin --profile <id> add file:<绝对路径>/.dsh-math-memory
```

- **必须绝对路径**：dsh 会把 `.`/`..` 开头的 spec 解析到**调用方的 cwd**（`@deepseek-ai/dsh-plugin-manager/lib/index.js:210-219`，CLI 传的是 `process.cwd()`，`@deepseek-ai/dsh/lib/plugin-DkYIj96-.js:63-67`）。Obsidian 进程的 cwd 与 profile 无关 ⇒ 相对路径必错。
- 先例：插件已经在**同一个进程里**跑 `dsh plugin add`（皮肤中心按钮，`obsidian/main.template.js:1783-1819`，`stdio:'ignore'`、以文件系统结果判定成败）。CLI 侧同形状见 `dsh/install.mjs:337-341`。
- **离线判据（静态）**：dsh 的 preflight 对**路径 spec** 直接在磁盘上读清单，只有 `kind === "registry"` 才发 `pnpm view`（`@deepseek-ai/dsh-plugin-manager/lib/index.js:317-322` vs `:324-345`）；`allowBuilds` 的提示分支只针对 git 形式（`@deepseek-ai/dsh/lib/plugin-DkYIj96-.js:79`）；profile 的 `pnpm-workspace.yaml` 只钉了 `nodeLinker: hoisted` + `autoInstallPeers: false`（`dsh/profile/pnpm-workspace.yaml:4-5`），与本地目录依赖无关。**"pnpm 自身在 registry 不可达时对 `file:` 目录依赖零网络访问"这一条未实测**（见 U1/U2/U3）。
- 装完会由 dsh 自动把该包加进 `dsh.profile.bundles`（`reconcile()`，`@deepseek-ai/dsh-plugin-manager/lib/index.js:238-266`，调用点 `:669`）——**这一步就是"出现在插件管理页"的充要条件**。

### 2.5 归属标记与通道语义

现状：owner 取两个值 `npm` / `direct`（`dsh/host/channel-owner.mjs:9-19`；写入口 `dsh/install.mjs:304-315`、`obsidian/main.template.js:1935-1942`）。A′ 的 profile **真的是 bundle 拥有的**，所以 `owner` 应为 `npm`，但**必须**额外记一个字段说明这份 bundle 是本地物化的（`readChannelOwner` 会 `...parsed` 透传额外字段，`dsh/host/channel-owner.mjs:97`）。

不改这一层会撞上一个自伤：Obsidian 引导的冲突守卫是 `existing.owner !== 'direct'` 就抛错（`obsidian/main.template.js:1891-1893`）——它自己写下 `owner: "npm"` 之后，**下一次引导就会拒绝自己**。所以冲突判据要改成"owner + 写出者"两元组，`assertChannelOwnership`（`dsh/install.mjs:297-302`）与 `dsh/host/index.mjs:60-70` 三处一起改（D4）。

### 2.6 两个容易漏的行为差异

- `math-memory-panel.mjs` 的 `configScaffold()` 会尝试读 `<包>/dsh/templates/config.md`，读不到才退回已按模板校正的字面量（`dsh/host/math-memory-panel.mjs:180-200`）。物化包**要么包含这一个模板**（`EMBEDDED_TEMPLATES['config.md']` 已在插件里，`scripts/build-obsidian.mjs:113-116`），要么显式记下"走字面量"。
- 平铺兜底必须**继续保持可用**：客户端半个的 `installClientIntoProfile()` 依赖 `<profile>/math-memory-panel.mjs` 是否存在来决定包的宿主半是空实现还是真宿主（`dsh/client-panel/install-into-profile.mjs:207,224-239`）。A′ 若在 bundle 形态下删掉平铺文件，这条判据会翻面 ⇒ **建议平铺文件继续铺**（它们同时是 rollback 的凭据）。

---

## 3. 分步实施计划

> 仓库纪律：一次提交一件事；**加守卫必须做变异验证**（`AGENTS.md:102`，`docs/agent-repo-maintenance.md:56`）。每步的"变异验证"都要附上那句报错。

### S1 · 物化模块（无调用方，纯函数） ✅ **已落地 2026-09-26**
- **实际形态与本文原稿的差异**（以代码为准）：模块是 `dsh/profile/local-bundle.mjs`，导出
  `LOCAL_BUNDLE_DIR` / `LOCAL_BUNDLE_PKG` / `LOCAL_BUNDLE_EXTRA_FILES` / `localBundleSourceFiles` /
  `localBundleManifest` / `materializeLocalBundle` / `localBundleInstalledIn` / `removeLocalBundle` /
  `localBundleAddArgs` / `localBundleTreeFiles`。**原稿写的 `LOCAL_BUNDLE_FILES` 不存在**——清单是
  `localBundleSourceFiles({repoRoot, collectClosure, presetBodyFiles})` **派生**的（宿主入口闭包 ∪
  契约体文件 ∪ 5 个声明 extras），手写部分只剩那 5 个 extras，每条都要有真实文件（门禁钉住）。
- 已进 `scripts/build-obsidian.mjs` 的 `EMBEDDED_SOURCES`（否则 build 抛错），`main.js` 重建；
  `scripts/lib/gates.mjs` 加 `syntax: dsh/profile/local-bundle.mjs`（总数 **52**）。
- **验收**：`node scripts/run-gates.mjs --only local-bundle` 绿；`check: main.js bundle freshness` 绿。
- **变异验证**：删 `icon.svg` / 删 `dsh/cordis.patch.yml` / 把闭包文件重复列进 extras ⇒
  `check-preset-body-lists.mjs` 的三条字段交叉断言与"无重复"断言分别报红。
  ⚠️ 原稿写的"删掉 `note-tools.mjs` ⇒ 闭包断言必红"**在本实现下不成立**：那条断言两边同源、在构造上恒真
  （实测删掉仍全绿）。真正能抓的是"生成的 manifest 指向的文件不在清单里"，已按此重写断言。

### S2 · 物化结果必须能被真 dsh 冷启动（离线、不碰 pnpm） ✅ **已落地并验证 2026-09-26**
- **改**：`scripts/test-real-profile-accept.mjs` 的 `provisionProfile()` 从"`cpSync` 整个仓库 `dsh/`"改为
  **调用 `materializeLocalBundle` 物化到 `<profile>/.dsh-math-memory/`，再放成 `node_modules/dsh-math-memory`**
  （＝ `dsh plugin add` 的 `file:` 链接等价物）。物化这一跳刻意留在路径里——它就是被测代码。
- **验收（实测）**：`node scripts/run-gates.mjs --only self-provisioned` ⇒ **`__CHECKS__ 10/10` 全绿**，
  其中 `agentPresets/list` 列出 `notes-assistant`（名"数学笔记助手"）、**无 `broken` 行**、
  `session/create` 返回 `ok:true`。**这就是 A′ 的生死题，答案是"能"**——物化出的包能冷启动真 dsh。
- **变异验证（实测，用新测试缝）**：
  ① `DSH_TEST_DROP_BUNDLE_FILE=dsh/preset/note-tools.mjs` ⇒ **8/10**，`no preset row is broken` 与
  `session/create` 两条红；
  ② `DSH_TEST_DROP_BUNDLE_FILE=dsh/cordis.patch.yml` ⇒ **8/10**，roster 与 `session/create` 两条红。
  测试缝已登记 `docs/env-vars.md` §2（读了就必须登记，`check-env-vars` 当场报红确认过）。
- **仍未做**：原稿的"让 patch 里的 preset 行退回 `./` 形态 ⇒ 该门必须红"**没做**——那条要改
  `dsh/cordis.patch.yml` 的生成块，属 S3/S6 的范围（生成器有 `--check` 门禁挡着），留到那时一起。

### S3 · overlay 状态机 + 归属语义 ✅ **已落地 2026-09-26（两条真 dsh 变异验证留到 S4/S6）**
- **实际形态**：① overlay 的那两行用**成对标记**包住（`# >>> bundle-owned rows >>>` / `# <<< bundle-owned rows <<<`），
  `buildNotesAssistantPatch()` 复用既有的 `profileBundles(home)` 判断"本包是不是这个 profile 的已登记 bundle"，
  是则删掉标记之间整块、否则**逐字节不变**；标记缺失或顺序颠倒时**原样返回**（fail-safe，不半删）。
  ② `dsh/host/index.mjs` 的守卫改为 `owner === null || owner.owner === "npm" || packageIsRegisteredBundle(profileDir)`，
  并**按 `dsh.profile.bundles` 实查**（不靠 owner 标签推断，陈旧标记无法让守卫变松）。
- **与原文的差异（以代码为准）**：原文 ① 说"去掉生成块与 `./math-memory-*` 两行"——**生成块不在这个 overlay 里**
  （B3 早已把它搬到 profile 自己的 `cordis.patch.yml`），所以只有那两行要处理；
  原文 ② 说的"冲突判据改为两元组（owner + bundleSource）"**未按字面实现**：A4 选的是①"保持两值 + 新字段"，
  而判据实际做成了**"owner 或 bundles 实查"**——比两元组更强（不依赖标记是否正确），已照此记为实际形态。
- **验收（实测）**：新门禁 `check: overlay drops bundle-owned rows` **22/22**；`test-channel-owner` **25/25**；
  `--only installer` 绿；重建 `main.js` 后 `check: main.js bundle freshness` 绿；`npm test` **53 ok / 1 SKIP / 0 FAIL**。
- **变异验证**：谓词恒 `true` ⇒ 1 条红；恒 `false` ⇒ 4 条红。另有 3 条"fail-safe"断言（标记缺失/顺序颠倒 ⇒ 原样返回）。
- **⚠️ 两条"真 dsh 变异验证"尝试过但未能复现（2026-09-26 实测，重要）**：原文要求
  ①"overlay 在 bundle 已登记时仍保留声明 ⇒ 必须报 `duplicate loader entry id`"；
  ②"overlay 保留 `./math-memory-panel.mjs` 且 bundle 已启用 ⇒ 必须报 `duplicate prefix route "/memory-panel"`"。
  我在真 dsh（隔离 `$DSH_HOME`、真物化 bundle 包、`--patch` 挂 overlay）上把两种形态都装配出来，用
  `--dump-config` 确认了**组合树里确实同时有包的行与 overlay 的行**（`math-memory-host`+`math-memory` 来自包，
  `math-memory-workspace`+`math-memory-panel` 来自 overlay），然后**真启动**：

  | 形状 | profile 根有平铺文件？ | 结果 |
  |---|---|---|
  | overlay 仍声明那两行 | **没有** | 3 行 `failed to import`（workspace / panel / client-panel），**能启动**，无 duplicate 报错 |
  | overlay 仍声明那两行 | **有**（`--direct` 形态） | workspace **成功激活**；panel 仍 `failed to import`；**能启动**，无 `duplicate prefix route` |
  | overlay 已剥掉那两行（S3 输出） | 有 | 只剩 client-panel `failed to import`，**能启动** |

  ⇒ **两条预测的硬失败都没出现**。原因查清了：overlay 那两行用的是**相对名** `./math-memory-workspace.mjs` /
  `./math-memory-panel.mjs`，而 **bundle 通道只在 `node_modules/` 里放包、不在 profile 根铺平铺文件**
  （这正是"包化"的定义），于是这些行**解析不到模块**、以"未激活"告终 —— 它们**不注册路由**，也就无从撞车。
  在形状 B（手工把平铺文件摆上）里 workspace 才真的激活，而 **panel 那行仍然 import 失败**，所以路由始终只有
  一份，`duplicate prefix route` 也就**不可能**触发。

  **决定性的一次（把"必要条件"补齐后）**：上面形状 B 里 panel 行仍 `failed to import`，所以它**没真的挂载**，
  撞车自然不成立 —— 那是我的探针缺文件，不是 dsh 的行为。补齐 flat 行的**完整依赖链**
  （`math-memory-panel.mjs` 需要同级的 `memory-admin.mjs` 与 `hook-frontmatter.mjs`，后者又需要 `engine-shared.mjs`）
  之后再测：

  | 形状 | 组合树里的行 | panel 行 import | 结果 |
  |---|---|---|---|
  | 纯 bundle（无 overlay） | `math-memory-host`, `math-memory` | — | 启动成功，**0 条诊断** |
  | 混合 + overlay 已剥（S3 输出） | + `math-memory-client-panel` | — | 启动成功，仅 client-panel 未激活 |
  | **混合 + overlay 仍声明（变异）** | + `math-memory-workspace`, `math-memory-panel` | **成功**（该行不再出现在 `failed to import` 里） | **启动成功，仍然没有任何 `duplicate prefix route`** |

  ⇒ **在最有利于它的条件下，第 ② 条预测依然没有复现**：panel 行确实 import 成功并尝试挂载，而
  dsh **0.1.7-rc.2 并不会因为同一个 `/memory-panel` 前缀被注册两次而拒绝启动整个 profile**。也就是说，
  **原文第 ② 条所依据的"dsh 会硬失败"这一前提，在本机版本上不成立**（`install-into-profile.mjs` 注释里记的那次
  `duplicate prefix route` 故障想必另有条件，本次没能复现，**不要再把它当作既定事实引用**）。

  **这对本方案意味着什么（必须如实说）**：S3 的"剥掉那两行"**仍然是对的**（它们否则是**死行**或至少是**重复声明**，
  组合树应当只声明一份），但**它的紧迫性远低于原文的估计** —— 原文把它当成"没有这两条守卫就不能合"的**硬约束**，
  而实测表明在本机 dsh 上**不会因此起不来**。因此 S3 **不应**再被当作阻断性风险；它是**正确性/整洁性**的改进。
  真正需要警惕的是**混合形态**（bundle 已装 + 平铺文件仍在 profile 根，正是 S4/S5 迁移期的状态）：那时两边的行
  **都会真的挂载**，行为取决于 dsh 对重复前缀的容忍度（本机：容忍），但这属于**要实测**的问题，不是可以假定的。

### S4 · 两条调用路径接线 ✅ **CLI 侧已落地 2026-09-26；Obsidian 侧未做（见末尾）**
- **实际形态**：`dsh/install.mjs` 新增 `tryBundleInstall()` —— 写 pnpm 需要的最小脚手架 → 物化到
  `<profile>/.dsh-math-memory/` → `dsh plugin add file:<abspath>` → **按文件系统核验**（包目录存在**且**名字在
  `dsh.profile.bundles` 里）→ 写 posture（并 `stripPresetDeclaration`）与 overlay（剥掉包已提供的行）→
  **最后**才翻转 `owner: npm` + `bundleSource: local`。失败 ⇒ 打印 `[fallback] …（原因）` 并回落平铺。
  新增 `--flat` 强制旧形态。退出码非 0 但核验通过时**以文件系统为准**（只打一行提示）。
- **为什么 owner 最后翻转（S5 依赖它）**：中断只会留下 `owner: direct` + 包已登记 ⇒ 下一次运行**重试并完成迁移**；
  反过来先写 `owner: npm` 就会留下"声称 npm 却没有包"的坏形态。
- **验收（实测）**：`test-installer.mjs` 新增 **29 条**（0e 节 S4 16 条 + 0f 节 S5 13 条）；新增测试缝
  `DSH_TEST_UNREGISTER_BUNDLE=1`（已登记 `docs/env-vars.md`）让核验可被确定性失效。既有 1–6 节改为显式
  `--flat`（它们断言的是平铺通道的文件/卸载行为）。
- **变异验证（实测）**：① 判据退回 `exit code == 0` ⇒ **3 条红**（含 `the manifest does NOT claim the npm channel | npm`，
  即"包没登记却写成 owner=npm"）；② 不再剥 overlay ⇒ 1 条红；③ 删掉核验 ⇒ **5 条红**。
- **⚠️ Obsidian 侧（`bootstrapDshConfig`）未做**：它仍是纯平铺，所以**从侧栏那条路装出来的插件仍不出现在管理页**。
  障碍是成本而非设计：插件进程没有 `pnpm`，物化器是 ESM 而模板是 `new Function` 求值的 bundle（不能 `import`），
  要先把物化器按 basename 内嵌进 `main.js` 并在模板作用域里自备 `read`/`collectClosure`。**如实记为未做**，
  已登记 `docs/handoff.md` §7。

### S5 · 迁移与回滚 ✅ **已落地（实测，2026-09-26）**
- 三个方向都实测：**平铺 → 本地包**（升级已装用户，owner/bundles/overlay **两两一致**、旧平铺文件保留）；
  **中断自愈**（用测试缝模拟"包已 add、owner 未翻转" ⇒ 该次留在 direct，**再跑一次完成迁移**）；
  **反向切换**（native 安装会**移除**直接通道留下的暂存包 `LOCAL_BUNDLE_DIR`，一个 profile 只有一个来源）。
- **变异验证**：native 不再移除暂存包 ⇒ 1 条红。⚠️ **未做**：把"写 owner"提前以真正反转发号顺序 —— 需要在同一函数里
  移动代码，字符串替换做不干净，**没有用不可靠的替换去凑**；第二条变异（删核验）**间接**覆盖同一后果。

### S6 · 门禁与文档 ✅ **本轮已落地**
- **`check: shipped yaml parses` 补上一个真实覆盖缺口**：它**从来没看** `dsh/cordis.patch.yml`（只走
  `dsh/profile/` 与 `dsh/preset/`），而那个文件正是**整个 bundle 通道的启动依据**。已显式加入 candidates，
  现在 25 条断言（原 20）。变异：把顶层 `- id:` 改成 `id:`（破坏结构）⇒ 红。
- `docs/installation.md` 的**方式 C** 与**可见性表**已改写：承诺从"**不需要** pnpm/网络"改为"**优先**不联网地包化，
  `dsh`/`pnpm` 不在或核验失败时**回落平铺并明确报告**"，并说明**如何分辨当前走的是哪条通道**。
- `AGENTS.md` §2 文件地图增一行（离线通道的包化物化 → `dsh/profile/local-bundle.mjs` + 三条门禁）；
  §1 的计划状态更新为"S1–S5 已落地"。
- `docs/handoff.md` §7 增两条（A′ S1–S5 完成；**插件侧机会式包化未做**，含验收判据）。
- **仍未做**：本节列的门禁影响面里，`check: plugin manifest meta`（对物化树跑一次真 `readPluginMeta`）、
  `test: agent preset mounts` 的"声明恰好在一个地方"改写、`check: version consistency` 的"物化版本派生自根"
  三条**未改** —— 现状下它们**仍是绿的**，只是**没有专门覆盖** A′ 带来的新形态。如实记为未做，不假装覆盖了。

---

## 4. 迁移与回滚

**现状的两条通道 + A′ 之后的状态**

| 阶段 | owner | `dsh.profile.bundles` 含本包 | overlay 声明 | 平铺文件 |
|---|---|---|---|---|
| 现在（direct） | `direct` | 否 | 有 | 有 |
| A′ 成功 | `npm` + `bundleSource: local` | 是 | 无 | **保留**（不再被引用） |
| A′ 回落 | `direct` | 否 | 有 | 有 |

**迁移策略（建议自动 + 可回滚）**：插件与安装器在下一次运行 bootstrap/install 时**机会式**尝试包化；成功即翻转，失败保持现状并**在 `status` 与插件日志里说清当前是哪条通道**（现在 `status` 只报 owner 与 posture，`dsh/install.mjs:496-540`）。

**必须防的三种坏形态**（都不是假设，仓库有前科）：

1. **包在、行不在**（`bundles` 里有名字，但 `node_modules` 里没有包 ⇒ `resolveBundleDir` 抛错 ⇒ 该 bundle 进 `skippedBundles` 只打印一行、**profile 照常启动但没有 preset**，`@deepseek-ai/dsh-app-boot/lib/index.js:924-944`、`docs/dsh-0.1.7-adaptation.md:349`）。防护：`localBundleInstalledIn()` 必须同时核验"清单里的 `dsh.bundle.patch` 文件存在"，bootstrap 每次启动都重跑核验，失败就重跑 add 或回落。
2. **行在、包不在**（overlay 声明着 preset，但平铺体文件被删/被覆盖 ⇒ 每次建会话 `agent-preset/invalid`，启动日志零告警：陷阱 93/96，`docs/handoff.md:302-305,317-321`）。防护：平铺体文件继续保持"每次启动都覆盖"（现在是 `ensureFile(..., true)`，`obsidian/main.template.js:1912-1929`），且**只在 bundle 核验通过后才**去掉 overlay 声明。
3. **两者同时在**（duplicate id / duplicate prefix route ⇒ 整个 profile 起不来）。防护：§3-S3 的两条变异验证 + 一条"全 profile 的 patch 文件里 `preset-notes-assistant` 恰好出现一次"的断言（判据形状照抄 `scripts/check-patch-yaml.mjs:149-195` 对客户端行的"恰好一次"）。

**写入顺序（防"崩在中间"）**：① 平铺文件 → ② 物化 staging → ③ `add` → ④ 核验 → ⑤ 重写 overlay（去声明）→ ⑥ 写 owner。若在 ⑤ 之前崩溃：overlay 仍带声明、`bundles` 已含本包 ⇒ **坏形态 3**。所以更稳的序是 **④ 之后先把 overlay 切成"无声明"再核验一次**，或者让下一次启动的判据"以 `bundles` + 文件系统为准、永远重写 overlay"来兜住 —— 后者是现有机制（每次起服务都重写），**但只在 Obsidian 起服务时成立**：若用户此后只用 CLI 启动，坏形态就留在盘上。⇒ **建议把这条恢复动作同时放进 `dsh/install.mjs` 的 `status`/`install` 路径**（D3）。

**回滚**：`dsh-math-memory uninstall`（会跑 `dsh plugin remove dsh-math-memory`，`dsh/install.mjs:562-578`）+ `install --flat --force` 重新平铺；或直接删 `<profile>/.dsh-math-memory/` 并从 `dependencies` / `bundles` 里去掉名字。**回滚后不会有"半条通道"**：平铺文件与 owner 的写入是幂等的。

---

## 5. 门禁影响面（每条：为什么受影响 + 怎么改）

| 门禁（`scripts/lib/gates.mjs`） | 为什么受影响 | 要怎么改 |
|---|---|---|
| `syntax: dsh/install.mjs` / `syntax: dsh/host/*`（`:17`、`:99-103`） | 新增模块要有 `--check` 条目；零调用方导出会腐烂（陷阱 95） | 加 `syntax: dsh/profile/local-bundle.mjs` |
| `test: installer e2e`（`:28`） | 断言写死 `posture=12`（`test-installer.mjs:97`）、overlay 与源文件**逐字节一致**（`:114`）、"宿主半行仍在"（`:139-140`） | 按通道分支：direct 平铺组保持原断言；新增"机会式 bundle / 回落 / `--flat`"三组，spawn **注入**（沙箱无 dsh/pnpm） |
| `check: preset body lists agree`（`:69`） | 物化包带来**第五处**体文件清单；overlay 的声明变成条件式 | 断言物化清单 == `PRESET_BODY_FILES` ∩ host 闭包；并钉住"overlay 的声明只在未登记 bundle 时出现" |
| `check: preset declaration is current`（`:73`） | 声明生成器现在有 2 个目标；bundle patch 变成离线通道也消费的文件 | 若 D2 选"内嵌原样复用"则不改生成器，只加"物化 patch == `dsh/cordis.patch.yml` 字节一致"的断言 |
| `check: shipped yaml parses`（`:88`） | 它**根本没看** `dsh/cordis.patch.yml`（`check-patch-yaml.mjs:58-64`），而 A′ 让它成为离线通道的启动依据 | 把 `dsh/cordis.patch.yml` 加进 `candidates`（这是顺手补上的真实缺口） |
| `check: plugin manifest meta (icon/locale)`（`:52`） | 卡片素材要对着**物化包**也成立，否则本地 bundle 的卡片与 npm 通道不一致 | 让该门对物化树跑一次真 `readPluginMeta`（现成写法：`check-plugin-manifest-meta.mjs:95-102`） |
| `check: skin fallback`（`:30`） | 它**禁用** `obsidian/main.template.js` 里出现 `symlinkSync(` 与 `'junction'` 字面量（`check-skin-fallback.mjs:91-99`） | 不改判据，但实现里**不能**出现这两个字面量（例如注释里解释"pnpm 可能建链接"时不要写 `'junction'`） |
| `check: main.js bundle freshness`（`:97`） | 模板与内嵌清单都改了 | 重建 `main.js` 并一起提交（`AGENTS.md:49`） |
| `check: embedded loader` / `check: embedded writers`（`:60-61`） | 新嵌入键与模板注入绑定 | 这两条按**键名**锚定（`check-embedded-loader.mjs:57`、`check-embedded-writers.mjs:30`），新键不破坏它们；若物化需要新的模板作用域绑定，才要改注入清单 |
| `test: channel ownership anchor`（`:108`） | owner 语义/两元组判据变了 | 补"自己写的本地 bundle 不被自己拒绝"与"另一种通道被拒"两组断言（现写法见 `test-installer.mjs:166-193`） |
| `test: agent preset mounts (real dsh)`（`:129`） | 它读**已部署**的 overlay 并断言声明在场（陷阱 94 的形状） | 断言改为"声明恰好在一个地方"：bundle patch 或 overlay，二者取一，且与 `dsh.profile.bundles` 的现状一致 |
| `test: self-provisioned profile accepts a session`（`:130-140`） | 它是本方案**最强的离线验收** | 见 S2：provision 改走物化函数 |
| `check: version consistency`（`:53`） | 物化 `package.json` 有版本字段 | 断言它派生自根 `package.json`，仓库里没有第二个版本字面量 |
| `check: release artifact paths`（`:89`） | 发布集是 pin 住的（`files` 含 `dsh/`、`locale/`，根 `package.json:11-18`） | 新增文件都在 `dsh/**` 内 ⇒ 不动；若新增顶层目录才要改 pin 并写理由 |
| `check: config scaffold parity`（`:35`） | 见 2.6：物化包缺 `dsh/templates/config.md` 会走字面量 | 决定包含它，或把"缺模板时走字面量"写进该门的预期 |
| `check: doc counts`（`:79`） | 新增门禁数会变 | 改 `AGENTS.md:61` 的注册总数（守卫会直接告诉你写错） |
| `test: drop-to-mention`（`:113`）、`test: panel routes`（`:24`） | 客户端半的行与包未变 | 不动；但"客户端行恰好一次"的跨文件断言要继续绿（`check-patch-yaml.mjs:181-187`） |

---

## 6. 风险与未验证项

**已用静态证据支持、但**仍标**未实测的点**

- **U1**（✅ **已实测**，2026-09-26）：pnpm 在 registry 不可达时，对 `file:` **本地目录**依赖**零网络访问**。实测命令与结果：`pnpm --dir <profile> add "file:<pkg>" --registry=http://127.0.0.1:9/ --config.fetch-retries=0` ⇒ `resolved 1, reused 1, downloaded 0, added 1`，1.1 s 完成（pnpm 11.21.0）。⇒ 本方案可以如实承诺"**不需要 registry/网络**"，但仍**需要 pnpm 在场**（这是与"完全离线"的唯一实质差别）。
- **U2**（✅ **已实测**，2026-09-26）：pnpm 写进 `profile/package.json` 的 spec 是 `file:C:/WINDOWS/TEMP/a-prime-probe/pkg`（**绝对路径 + 正斜杠**，即使传入的是反斜杠形态）；`node_modules/dsh-math-memory` 的 `LinkType` **为空** ⇒ **不是目录链接**，而是自 content-addressable store 硬链接出来的普通目录 ✓ 与本机"目录链接过敏"不冲突（R4 随之消解）。⚠️ 副作用：spec 记的是**绝对路径**，物化目录一旦移动或重建，就必须重装（迁移/升级要覆盖这条）。
- **U3**（✅ **已实测**，2026-09-26）：Windows 上 `file:<盘符>:\…` 这种"协议 + 盘符"形态被 pnpm 直接接受（传入 `file:C:\…\pkg` 成功，写出时规范化为 `file:C:/…/pkg`）。
- **U4**（未验证）：`disabled: true` 能否消除"两处声明同一 preset id"的冲突（若可以，兜底声明就能常驻；不建议依赖，因为 id 唯一性检查与 disabled 处理的先后顺序未测）。
- **U5**（未验证）：profile 正被 dsh 加载时再跑 `add` 的即时效果（`reconcile` 会改清单；HMR 是否存在决定行是否立即生效）。锁是安全的：`withFileLock(<profile>/package.json, …, { waitMs: 2 分钟 })`（`@deepseek-ai/dsh-plugin-manager/lib/types/operations.js:526-537`、`@deepseek-ai/dsh/lib/plugin-DkYIj96-.js:66`），另有 `.plugin-manager/run.json` 的"上一次运行的进程还活着"判据（`lib/index.js:356-393`）。**A′ 的建议是"起服务之前装完"**，从而不依赖这条。
- **U6**（未验证）：往 `add` 后追加 `--offline` 让"不联网"变成硬约束（flag 会作为 pnpm 参数透传：`namedSpecs()` 只过滤 `-` 开头的参数做 preflight，`lib/index.js:292-305`；`runPlugin` 只截获 dsh 自己的子命令，`@deepseek-ai/dsh/lib/plugin-DkYIj96-.js:11-13,58-81`）。副作用是：profile 里若有**未缓存**的 registry 依赖，add 会直接失败 ⇒ 正好落进 S4 的回落分支。

**风险**

- **R1 状态机窗口**（§4）：`add` 成功与 overlay 重写之间崩溃会留下坏形态 3（profile 起不来）。缓解：overlay 每次起服务都重写 + 核验以 `bundles` 与文件系统为准；残余风险是"此后只用 CLI 启动"。
- **R2 首次启动变慢/需要 pnpm**：A′ 的主路径**需要 pnpm**（`dsh plugin add` 内部就是 pnpm：`lib/index.js:517`；缺 pnpm 时 dsh 打印 `dsh: pnpm was not found`，`@deepseek-ai/dsh/lib/plugin-DkYIj96-.js:76`）。这是与"完全离线"的**唯一**实质冲突：本方案的承诺必须是"**不需要 registry/网络**"，不是"不需要 pnpm"。若某台机器连 pnpm 都没有 ⇒ 回落平铺（今天的形态），插件管理页仍然不显示。
- **R3 `dsh` 不在 PATH**：与皮肤中心按钮同一风险面（`spawn('dsh', ..., { shell: win32 })`，`obsidian/main.template.js:1788-1795`），已有先例与失败提示。
- ~~**R4 与本机"目录链接过敏"的冲突**~~（**已消解**，2026-09-26 实测：pnpm 对本地目录 spec 生成的是硬链接副本，`node_modules/<pkg>` 的 `LinkType` 为空，不建目录链接；见 U2）。
- **R5 卸载残留变多**：现在是"卸载会留下客户端半个的包目录"（`docs/handoff.md:447`）；A′ 会再加 `node_modules/dsh-math-memory` 与 `.dsh-math-memory/`。必须一起写进 owner manifest 的清理清单。
- **R6 门禁/文档面比代码面大**：§5 里 10+ 条门禁要动，其中两条真 dsh 门禁是"唯一能证明装配正确"的信号（`docs/handoff.md:327-330` 陷阱 98 的教训：0/0 断言 + exit 0 不算通过）。

**U-验证（✅ 已于 2026-09-26 跑过，结论见上面的 U1/U2/U3；命令保留给复核）**

```powershell
$p = "$env:TEMP\a-prime-probe"; Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory "$p\profile" | Out-Null
'{ "name":"probe-profile","version":"0.0.0","private":true }' | Set-Content "$p\profile\package.json"
"packages:`n  - .`n`nnodeLinker: hoisted`nautoInstallPeers: false" | Set-Content "$p\profile\pnpm-workspace.yaml"
# <pkg> = 按 §2.1 物化出来的目录；先把它准备好
pnpm --dir "$p\profile" add "file:$p\pkg" --registry=http://127.0.0.1:9/ --config.fetch-retries=0
Get-Content "$p\profile\package.json"                       # U2：spec 形态
Get-Item "$p\profile\node_modules\dsh-math-memory" | Select-Object LinkType,Target   # U2：是否目录链接
```
（`--registry=http://127.0.0.1:9/` 是刻意不可达；这条探针只写 `%TEMP%`，不碰 `$DSH_HOME`。）

---

## 7. 需要用户决定的事项

| # | 事项 | 选项与代价 | 我的建议 |
|---|---|---|---|
| **D1** | `--direct` / 插件引导的默认行为 | ①机会式：先试包化、失败回落平铺（要 pnpm，首次多几秒）②新增显式模式 `--bundle`（旧行为不变，但"自动安装"就打折）③完全替换 direct（离线且无 pnpm 的机器直接失去通道） | **① + `--flat` 逃生口**；把 `status` 输出做成"当前通道"的唯一真相 |
| **D2** | bundle patch 从哪来 | ①内嵌 `dsh/cordis.patch.yml` 原样复用（要放宽 `build-obsidian.mjs:104-111` 的 basename 门禁为**键**门禁，因为 `dsh/profile/cordis.patch.yml` 与它同 basename；`main.js` +≈9 KB）②运行时从内嵌组合生成（不新增嵌入，但等于**第二个生成器**，需自己的守卫）③bundle 只声明宿主行、preset 声明继续留在 overlay（改动最小，但 preset 与包版本解耦的问题（handoff §7 第 441 行）不解决） | **①**：单一来源、离线通道直接复用 npm 通道那份已被真机验证过的 patch；门禁的放宽要写理由并做变异验证 |
| **D3** | 首次启动是否阻塞在 `add` 上 | ①阻塞（上限 120 s；失败回落）②后台跑、下次重启生效（首启快，但页面里要等一轮） | **①**，并把它排在"起服务之前"（避开 U5 的整类不确定性） |
| **D4** | owner 语义 | ①保持两值 `npm`/`direct` + 新字段 `bundleSource: local`（三处守卫改判据）②新增第三值 `local`（语义最准，`readChannelOwner` 的消费者与门禁都要改） | **①**：`owner` 回答"能力由 bundle 提供吗"，`bundleSource` 回答"包从哪来" |
| **D5** | 卡片素材（`icon.svg` + `locale/*.json`）是否也内嵌 | ①内嵌（`main.js` +≈800 B，本地 bundle 的卡片与 npm 通道一致）②不嵌（卡片标题退回英文包名、图标退回默认） | **①**：插件管理页的卡片正是本方案要交付的可见结果，不能两个通道长得不一样 |
| **D6** | 卸载清理范围 | ①只清 overlay/posture（残留 `.dsh-math-memory/` 与包）②连带清 staging + `node_modules` 两处（对称，顺手关掉 handoff §7 第 447 行） | **②**，写进 owner manifest 的清理清单，卸载 dry-run 要打印出来 |
| **D7** | 迁移是否自动 | ①下次启动自动升级（无人值守，但会动已装用户）②设置页一个显式按钮（可控，但大多数用户不会点） | **① + 失败回落 + `status` 显示**；发版说明里明确写"首次启动可能多花几秒装一次本地包" |

---

## 8. 与 `docs/handoff.md` §7 的关系

- **会关掉**：§7 第 **441** 行「离线通道的 preset 声明只活在一份"插件每次启动都会重写"的文件里」——A′ 落地后，主形态的声明住在**包内**（`dsh/cordis.patch.yml`），与包版本一起演进，插件内存里的旧模块再也擦不掉它。**但只关掉主形态那一半**：回落形态（未登记 bundle）仍然靠 overlay 声明，所以该条要改写成"主形态已解耦、回落形态仍是老形状"，而不是划掉。
- **会连带关掉一半**：§7 第 **447** 行「卸载会留下客户端半个的包目录」——D6 若选②，同一份清理清单把客户端半个、本地 bundle 包、staging 目录一起清掉。
- **不受影响**：§7 第 **438** 行（`web` profile 不会自动装客户端半个）——A′ 只动 `notes-assistant` profile；若要让 `web` 也包化，那是另一个决定。
- **§7 第 435 行**（0.1.7 适配收口）保持完成状态；A′ 是它之后的下一个形态，不是回退。
- **需要新增**：§7 一条「离线通道不出现在插件管理页（A′ 提案，见本文）」+ §4 一条陷阱（若实施）：「同一个 preset id 被 bundle patch 与 overlay 各声明一次 ⇒ profile 起不来」，根因、复现、修法与"恰好一次"的判据照抄陷阱 89 的写法。

---

## 9. 复核指引（写给下一个 agent）

- 机制类结论都能在 **本机安装的 dsh** 里复核：`@deepseek-ai/dsh-plugin-manager`（名单/清单/pnpm 调用/锁）、`@deepseek-ai/dsh-app-boot`（bundle 解析、patch 解析、meta 读取）、`@deepseek-ai/dsh/lib/plugin-DkYIj96-.js`（CLI）。
- 仓库侧**唯一**权威清单是 `dsh/preset/preset-deploy.mjs:52`（体文件）与本文 §2.1 新增的物化清单；两处都由 `check: preset body lists agree` 系列的"闭包 == 清单"手法守。
- 两条真 dsh 门禁（`test: agent preset mounts`、`test: self-provisioned profile accepts a session`）是"装配对了没有"的唯一信号；改这个方案时**先看它们红不红**，不要用"仓库门禁全绿"代替（`docs/handoff.md:306-309`）。
