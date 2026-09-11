# 可维护性审查（重点：agent 维护）

> **性质**：一次只读的维护性审查。**不是**功能评估，也**不是**缺陷审计（安全类缺陷见 [`project-assessment-2026-09-10.md`](project-assessment-2026-09-10.md)）。
> **审查对象**：仓库结构 + 架构 + 验证网 + 文档面，判据是「**换一个 agent 接手，能不能低成本、低风险地正确改一处代码**」。
> **状态**：`status: review` · 一次性快照（2026-09-11）· 结论绑定版本 **0.7.5**（`package.json` / `manifest.json` / `package-lock.json` / `versions.json` / `CHANGELOG.md` 五处一致）。
> **方法**：全部结论都在本机复现过；区分「实测」与「推断」，实测附命令。审查期间未修改仓库内容（`git status` 干净）。

---

## 1. 结论

**整体判断：这个仓库的工程纪律明显高于同规模个人项目，但"由 agent 长期维护"这一项目前有三个结构性障碍。**

做对的部分是实打实的：CI 双平台、`npm ci`、版本五处一致门禁、`main.js` 字节级重建门禁、232 项零 token 回归、以及一个**罕见的"消费真实值"型文档守卫**（它真的去跑各个套件并解析运行期 `__CHECKS__`，而不是 grep 调用点）。`handoff.md` §4 的 58 条"坑"逐条带根因，是本仓库最值钱的资产——那正是 agent 最需要的东西。

但有三件事会让 agent 维护**系统性地出错**，而不是偶尔出错：

| # | 障碍 | 后果 |
|---|---|---|
| 1 | **入口错位**：没有根 `AGENTS.md`，仓库里唯一的 `AGENTS.md` 是**面向 vault 用户的 agent 人设协议**，且会被 harness 自动加载为仓库指令 | agent 冷启动拿到的是"你是这个 vault 的数学学习伙伴"，不是"这是仓库、改这里、这样验证" |
| 2 | **验证信号不可信**：`npm test` 在受限环境下必然报红，且失败形态与真实回归**无法区分** | agent 拿到一条假的"文档漂移"红，最可能的反应是去改**正确**的文档 |
| 3 | **双份实现**：记忆引擎的核心在 `dsh/preset/` 与 `dsh/host/` 各存一份，21 个同名顶层符号，无一致性守卫 | 改一处漏一处，且漏了不一定被测出来 |

修掉 1–3 之后，本仓库对 agent 的维护友好度会从"需要老手带"变成"可以自助"。不修，则每次改动都同时承担三重风险：**读 4 万 token 文档仍可能拿到过期状态 + 改一处要改两到四处 + 红绿无法解释**。

**分项评分（10 分制，判据是 agent 友好度）**

| 维度 | 分 | 一句话 |
|---|---|---|
| 目录/仓库卫生 | 8 | 生成物与源分离清晰、`.gitignore` 正确、无脏文件；扣分在共享代码文件清单靠手写 |
| 代码分层与模块边界 | 5 | 层次分得对（preset / host / profile / templates），但层内是巨型文件，且核心逻辑有两份 |
| 单一事实源 | 6 | 模板清单做到了单一事实源 + 完整性门禁；版本做到了；**共享代码与文档没有** |
| 验证网可信度 | 7 | 断言多、跑得快、探针已改为调用产品管线；扣分在环境依赖与假失败 |
| CI / 发布 | 8 | 双平台 + 版本门禁 + 重建 diff；扣分在 `client.js` 无门禁、`qa` 不进 CI |
| 文档 | 5 | 量足、诚实、有守卫；但 6 处状态与内容自相矛盾，且都落在 agent 首读路径上 |
| **agent 上手成本** | **4** | 必读路径 ≈40K token，且入口文件是错的受众 |

**总分约 6.2/10**：作为人类维护的项目可以给到 8；作为 **agent 维护**的项目，扣分几乎全部集中在"入口、验证、重复"这三件事上——而这三件恰好都是可以在一两天内改善的。

---

## 2. 优点（先说做对的，避免改错方向）

1. **验证网是真的在验证**。`main.js` 我实测字节级可重建（重建前后 SHA256 均为 `3C694BC0…`），CI 有 `git diff --exit-code` 门禁；`check-version-consistency.mjs` 钉住五处版本 + tag，且文件头写明了它存在的历史原因（曾出现 package 0.7.3 / manifest 0.7.4 / npm latest 0.7.1 三方漂移）。
2. **`check-doc-consistency.mjs` 是本仓库最好的设计之一**：它 `execFileSync` 真跑套件、解析运行期 `__CHECKS__ passed/total`，并拒绝 `passed !== total`；还专门为"本机没装 dsh 时按设计 SKIP"的套件加了 `optional: true`（`check-doc-consistency.mjs:33-56`）。这是"守卫消费真实值而非自证"的正确形态。
3. **模板做到了单一事实源**：`dsh/templates-manifest.json` 是唯一清单，`build-obsidian.mjs:50-54` 有一条完整性门禁——`dsh/templates/*.md` 里任何一个文件没进 manifest 就直接构建失败。这正是防"新加模板静默不生效"的正确做法。
4. **回归套件零 token、秒级、且探针不再手抄公式**：`scripts/qa/*` 现在 import 产品的 `buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`（`engine-probe.mjs:18`、`seed-probe.mjs:14`），修掉了此前"探针手抄权重、与产品静默分叉"的病根。
5. **`handoff.md` §4「必须知道的坑」= 58 条带根因的陷阱清单**。这是 agent 接手时最省时间的东西，也是本仓库区别于同类项目的核心资产。
6. **定位诚实**：README 与 `docs/memory/README.md` 都明确写出"已解决什么、远未解决什么、1.0 的定义是什么"，没有把 0.7.x 包装成成品。
7. **我逐条实测的运行结果**（用于对照，见 §5）：`test-memory.mjs` 232/232、`test-panel-routes.mjs` 30/30、`test-panel-proxy.mjs` 31/31、`test-installer.mjs` 通过、7 个 `check-*` 中 6 个通过、`test-preset-sync.mjs` 20/20、`npm run qa` 仿真探针 8/8。**代码本身是健康的。**
8. **模块是"导入无副作用"的**：`dsh/preset/*.mjs` 与 `dsh/host/*.mjs` 没有任何顶层 IO/网络/`ctx` 操作，所有副作用都在 `apply()` 或显式函数里。**这意味着 agent 可以在裸 Node 里 `import` 任何一个模块并立即单测**——这是本项目对 agent 最友好的一条设计，也是 P0-3/P1-5 之所以"可以修"的前提。
9. **确定性写入会读回核对**：`syncHookStatsToCard`、`writeHookHistory` 以及体检的写后后置条件都**重新读文件**来验证，并输出 `status: "ok"|"degraded"` + `warnings`，而不是报告"成功"。项目把"'写完就当成功'是最容易复发的缺陷形态"这条教训固化成了机制——这正是坑 44 的正面版本。
10. **零 `TODO`/`FIXME`/`HACK`，零注释掉的代码块**（实测 grep 整个 `dsh/`）。比大多数项目干净，也说明技术债是以"重复实现"而不是"待办标记"的形态存在的——这解释了为什么 grep 找不到问题而审查能找到。
11. **发布流水线已经补上测试**：tag 触发的 `release.yml:37` / `npm-publish.yml:63` 现在**真的跑 `npm test`**（上一次评估点名的"推 tag 零门禁"已修）；CI 是 ubuntu+windows 双平台，字节确定性门禁钉在 Linux（`ci.yml:33`）。发布认证也已从长效 `NPM_TOKEN` 迁到 OIDC trusted publishing（见 §6 末条）。

**另外必须单独点出的一条（不是维护性问题，但审查中撞上了，不能埋）**：`dsh/host/math-memory-panel.mjs:95` 在**两个环境变量都没配置**时，把请求方自带的 `root` 直接当作约束根（`if (configured === "") return asked === "" ? "" : resolve(asked);`）——而同一个函数的文档注释（`:84-87`）声称"Now the configured value wins; a request may only *restate* it"。也就是说 2026-09-10 评估里的 P0-1（"约束根由调用方指定"）**只修了一半**：配置了就安全，没配置就退回原状。详见 **P0-0**。

---

## 3. 发现清单

### P0-0 · （安全）未配置环境变量时，约束根仍由调用方指定——上一次评估的 P0-1 只修了"已配置"那一半

**证据（我亲自读码确认）**：`dsh/host/math-memory-panel.mjs:92-99`

```js
function resolveAllowedRoot(requested) {
  const configured = (process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT ?? "").trim();
  const asked = typeof requested === "string" ? requested.trim() : "";
  if (configured === "") return asked === "" ? "" : resolve(asked);   // ← 调用方决定约束根
  const root = resolve(configured);
  if (asked === "") return root;
  return resolve(asked) === root ? root : "";
}
```

注释（`:84-87`）写的是「`body.root` / `?root=` **过去**就是约束根，这让下游的 `pathInside(root, target)` 变成同义反复……**现在**配置值优先」。这句注释只对 `configured !== ""` 的分支成立。

**而验证网恰好绕过了这一分支**：`scripts/test-panel-routes.mjs` 在每个用例前都先设置其中一个环境变量（`:74-81` 的 `setEnv`），却在 `:135-140` 断言「配置 vault 之外的 root 会被拒绝」。**测试断言的是一条代码只在有条件时才提供、而自身从不验证该条件的性质。**

**为什么这属于维护性审查**：这是"验收网说谎"的原型——文档注释、测试断言、评估结论三者都宣称这条边界已经关上，而**唯一没被覆盖的分支就是没关上的那个**。任何后续 agent 读到注释与测试，都会把这个面当作已加固而不再检查。是否可被实际利用取决于部署方式（dsh-native 安装是否总会写入 `DSH_WORKSPACE_ROOT`）——我没有验证所有部署路径，但**代码本身没有兜底**这一点是确定的。

**修法**：约束根改从 `ctx.workspaceRegistry`（或 profile 配置）派生，「未配置」直接 **403**（而不是信任调用方），并补一条"两个环境变量都删掉"的用例。

---

### P0-1 · 唯一的 `AGENTS.md` 是 vault 用户协议，且会被自动加载为仓库指令

**证据（实测）**：仓库根**没有** `AGENTS.md`，也没有 `CLAUDE.md`（`Test-Path` → False）。唯一的 `AGENTS.md` 是 `dsh/templates/AGENTS.md`——那是**装进用户 vault** 的工作协议，开篇即"你是本 vault 的长期数学学习伙伴……"。

本次审查中，仅仅**读取**该文件，harness 就把它作为 *"Additional instructions from: dsh-obsidian-math\dsh\templates\AGENTS.md"* 注入进了我的上下文——约 200 行、约 15K 字符的 agent 人设协议。该协议里还包含与仓库维护**直接冲突**的硬约束：

> 「**永不申请权限升级**：遇到 `[sandbox: file access denied ...]` 即视为禁止——停止重试，报告原因，不要使用 `sandbox_permissions`。」

一个正在维护本仓库的 agent，会因此被一份"教学内容"告知不要去申请它可能需要的沙箱权限。

**为什么妨碍 agent 维护**：冷启动的 agent 找的是"这是什么仓库、改哪里、怎么验证"；它拿到的却是"你在这个 vault 里怎么当数学老师"。它会继承一套完全无关的操作纪律，且没有任何一行字告诉它"这个仓库不是 vault"。

**修法**：加根 `AGENTS.md`（三段即可：仓库是什么 / 入口文件地图 / 验证与提交纪律），并在 `dsh/templates/AGENTS.md` 顶部加一行「本文件是**安装进用户 vault 的模板**，不是本仓库的维护协议」。

---

### P0-2 · `npm test` 在受限环境必然报红，且假失败与真回归无法区分

**证据（实测）**：`npm test` 退出码 1，停在第 5 个门禁：

```
[ok] ... (232/232)
panel-routes: 30/30 checks passed
[FAIL] harness: spawn EPERM
__CHECKS__ 6/7
panel-auth-e2e: 1 FAILED
```

根因是**沙箱边界，不是代码缺陷**：`scripts/test-panel-auth.mjs:62` 用 `spawn(..., { stdio: ['ignore','pipe','pipe'] })` 起真实 dsh，受限模式下带管道的 stdio 被拒（EPERM）。同理 `dsh/client-panel/build-client.mjs` 因 esbuild 需要 spawn 服务进程而失败。**这不是产品 bug**——我逐条验证过，被中断的那些门禁单独跑全部通过（见 §5）。

**关键证据：这条约束仓库里早就知道，而且已经在一处修好了，只是没修另外两处。** `scripts/test-installer.mjs:11-13` 写着：

```js
// Inherit stdio instead of piping: sandboxed CI environments may forbid
// capturing a child process's output through anonymous pipes.
const run = (args) => spawnSync(process.execPath, [installer, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
```

也就是说 `test-installer.mjs` 刻意用 `inherit` 规避了它，**因此它在同一个沙箱里跑绿**（实测 `installer: all checks passed`）；而同仓库的 `test-panel-auth.mjs:62`（`pipe`）与 `check-doc-consistency.mjs:36`（`execFileSync` 默认管道）没有这样做，于是双双 EPERM。这不是"环境不行"，是**同一个已知约束的应用不一致**——而且不一致的方向恰好是"坏的那一处会报出 18 条假漂移"。

但真正的维护性缺陷是**失败的形态**，有三层：

1. **`&&` 链在第 5 个门禁处中断**（`package.json:17`），其后 **16 条命令全部未执行**：`test-panel-proxy`、`test-installer`、`check-rename`、`check-skin-fallback`、`check-plugin-id`、`check-version-consistency`、`check-doc-consistency`、`check-embedded-loader`、`check-embedded-writers`、5 条 `node --check`、`test-preset-sync`。一次环境性失败把 16 个门禁静默吞掉。
2. **`check-doc-consistency.mjs` 会因此报出 18 条假的"文档漂移"**。它用 `execFileSync`（默认管道）跑子套件（`check-doc-consistency.mjs:36`），沙箱下同样 EPERM → `stdout === ''` → 记 `suite did not run` 并**返回计数 0**（`:40-43`）→ 随后每条锚点都拿 `0` 去比文档：
   ```
   FAIL  README.md: claims 232, actual 0
   FAIL  README.zh.md: claims 232, actual 0
   ... (共 18 条)
   ```
   而文档写的 232/30/7/31 **全部是正确的**（我单独跑过）。
3. 守卫已经为"本机不跑的套件"设计过 `optional: true`（`check-doc-consistency.mjs:47-50`），说明作者认识到"跑不起来 ≠ 结论不符"——但**没有覆盖"整台机器都 spawn 不了"这一档**。

**为什么妨碍 agent 维护**：agent 最可能的动作是"照守卫说的把文档 232 改成 0"——**把正确的文档改错**。这是三种失败模式里最坏的一种：不是信息缺失，而是**信息反向**。次坏的是 agent 看到 `npm test` 红就认为"环境坏了/上一个改动破坏了构建"，从而放弃验证或开始乱改。

**修法**：把门禁从 `&&` 单链改为**逐条执行 + 汇总**（单条失败不阻断其余），并让 `check-doc-consistency.mjs` 区分三态——`spawn 失败`（报告"环境不支持，跳过"）/ `SKIP`（已支持）/ `计数不符`（真失败）。

---

### P0-3 · 记忆引擎双份实现，无一致性守卫

**证据（实测，逐符号比对）**：`dsh/preset/math-memory.mjs`（2400 行）与 `dsh/host/memory-admin.mjs`（1429 行）**共同声明了 21 个同名顶层符号**，包括整条会话日志 / zstd / 蒸馏 / 捕获流水线：

```
CAPTURE_FILE            preset | host
MEMORY_DIR              preset | host
ZSTD_MAGIC              preset | host
sessionLogKey           preset:200  | host:1086
selectAuthoritativeLogs preset:399  | host:1086
findSessionLogs         preset:423  | host:1108
distillSession          preset:312  | host:1135
readSessionHeader       preset      | host
scanZstdFrames          preset      | host
planSessionDelta        preset      | host
runSessionCapture       preset:599  | host:1372
appendEpisodeIndex      preset      | host
readCaptureState        preset      | host
...（共 21 个）
```

而且**分解方式不同**：preset 的 `runSessionCapture`（`math-memory.mjs:599`）是 101 行的内联实现；host 的 `runSessionCapture`（`memory-admin.mjs:1372`）只是薄封装，真正的逻辑在 host 独有的 `scanSessionCapture:1236` + `persistCaptureState:1354` 里。也就是说这**不是一份代码的两个副本，而是同一个行为的两种结构**。

代码级差异是真实存在的（引号风格 `'` vs `"`、注释不同——例如 host 版 `sessionLogKey` 的注释就写着 "Mirrors `selectAuthoritativeLogs` in `dsh/preset/math-memory.mjs`"，等于承认是手工镜像）。两份文件之间有 **70 个逐字节相同的 8 行窗口**，说明它们确实是同一份代码，而不是两次独立实现。

**而唯一的同步机制是一条注释。** `dsh/host/memory-admin.mjs:901` 写着 "keep the two in sync"——**这就是全部的一致性保障**。我 grep 了整个 `scripts/`，没有任何脚本比对这两个文件；`test-memory.mjs` 确实同时 import 了两者（`:63` 与 `:64`），但那是各自独立测试，不是**一致性**测试。

雪上加霜的是还有第三、第四份：
- `main.js` 通过 `build-obsidian.mjs:38` 嵌入 `host-memory-admin.mjs`，而 `obsidian/main.template.js`（2947 行）**自带第四条捕获路径**——即会话捕获逻辑在仓库里一共存在**三份**（守卫只覆盖其中"嵌入字节 == 仓库源"这一层）；
- Obsidian bootstrap 每次加载还会把 `math-memory.mjs` / `note-tools.mjs` 覆盖写回 `$DSH_HOME`。

`handoff.md` §4 坑 19 自己记录了"preset 与 host 两份副本同步"这条纪律——**纪律靠人记，就是没有纪律**。

**为什么妨碍 agent 维护**：这是最典型的 agent 失效模式——agent 会读到一个函数、改它、跑测试变绿、提交，而**另一份从未被改到**。测试不会红，因为两份都被独立覆盖。缺陷会在真实使用中、在另一条代码路径上才显形。

**修法**：短期加一条"双份实现必须逐符号一致（或列明允许差异）"的守卫；长期让 preset 从 host（或新抽的 `dsh/shared/`）import，消除第二份。

注意：代码里给出的"不能共享"理由是**过期的**。`math-memory.mjs:1029` 的 `setTopFieldText` 注释写 "Mirrors memory-admin.mjs setTopField **so the preset stays dependency-free**"——但 `dsh/preset/hook-frontmatter.mjs` 与 `dsh/host/hook-frontmatter.mjs`（后者是前者的 re-export）已经证明 **preset 与 host 本来就可以共享同一个文件**。所以"保持零依赖"这个理由不成立，共享抽出的门槛比注释暗示的低得多。

---

### P1-1 · 出厂模板给用户 vault 写入了一个错误的默认值

**证据（实测）**：`dsh/templates/capture-policy.md:28` 写：

> 「事件层（`memory/episodes/`）……开关是 `.deepseek/config.md` 的 `sessionCapture`（**默认开**）。」

代码是：`math-memory.mjs:2146` `const sessionCapture = config.sessionCapture === true;` ⇒ **默认关**。且 `dsh/templates/config.md:7` `sessionCapture: false`、`:21` 明确写「默认 `false`（不自动保存……）」，`CHANGELOG.md` 也记录了 0.7.5 起改为默认关。

**为什么妨碍 agent 维护**：这是**唯一一处把错误事实复制进用户 vault** 的地方（模板会被安装器/插件 bootstrap 写进用户的 `.deepseek/`）。agent 在新装的 vault 里读到的第一手"配置说明"就是错的，会据此推断"对话在被自动保存"——而实际上没有。文档其他地方还是对的，所以这个错会被长期掩盖。

**修法**：把「默认开」改为「默认关」，并顺手让 `check-doc-consistency.mjs` 增加一条锚点（默认值的锚点比断言数更值得钉）。

---

### P1-2 · 6 处文档状态与自身内容矛盾，其中 3 处落在 agent 首读路径

**证据（均实测）**

| 文档 | 声明 | 实际 |
|---|---|---|
| `docs/memory/strategy-layer.md:3` | 「状态：**提案（未实现，待拍板）**」 | 策略层已实现并发布（`docs/memory/README.md:60`、`handoff.md:180` 均 ✅） |
| `docs/memory/design.md:1` | 「记忆系统当前设计（**v0.6.x** 实现规格）」 | 仓库是 0.7.5；而 `design.md` 正是被指定为"改代码前先读"的头号规格（`docs/memory/README.md:42`） |
| `docs/handoff.md:4` | 头部写「**版本 0.7.2**」 | 正文一路记到 0.7.5（`§3` 第三批）——**交接文档自己的状态行过期了三个版本** |
| `docs/memory/control-panel.md:4` | 「阶段 2（dsh 客户端列）**规划中**」 | `dsh/client-panel/` 已存在且 `handoff.md:58` 记为"实测可用" |
| `docs/memory/README.md:47` / `:61` | 「当前状态（**2026-08**）」；benchmark「⬜ 提案」 | 代码基是 2026-09-10；`handoff.md:181` 记 benchmark ✅ 已实现并实测 8/8 |
| `docs/dsh-0.1.5-adaptation.md:177` | 把"subagent 会话是否进记忆"列为**待决策** | 已决策并实现：`captureSubagents` 默认 `false` |
| `REFACTOR-PLAN.md:3` | 退役横幅称「Phase 4（web ui 适配）**未做**」；`:30`「15 个模板」 | dsh web 面板已实现并装在 3080；模板实际 **19** 个（实测 `dsh/templates/*.md` = 19，manifest = 19） |

**为什么妨碍 agent 维护**：`strategy-layer.md` 那条最危险——agent 被要求维护 `note_strategy`，而它读到的**权威规格**说这个功能不存在。`handoff.md:4` 那条次之——交接文档是 agent 的第一个入口，它的状态行却滞后三个版本。

**修法**：给每篇文档加一个 `status:` 字段（`live` / `archived` / `proposal`）+ 约定状态行必须与内容同步；把这条纳入 `check-doc-consistency.mjs`，让"状态矛盾"变成机器可查。`REFACTOR-PLAN.md:3` 与 `docs/session-scope.md:3` 已证明团队会写好的头部横幅——**缺的是一致性与机器检查**。

---

### P1-3 · 最大、且是用户真正安装的那个文件，零自动化测试

**证据**：`obsidian/main.template.js` = **2947 行**（构建产物 `main.js` 499 KB，2741 非空行），是全仓库最大的源文件，也是 Obsidian 用户实际加载的东西。仓库内没有任何套件执行它——`test-panel-auth.mjs:20-54` 只是用正则把 `DshWebProxy` 这个类**抠出来**单独求值，`check-embedded-loader/writers` 只检查嵌入字节一致性。

项目自己知道：`handoff.md` §7 两处列为未做（「Obsidian 插件自动化测试……呈现层仍无自动化测试」）。

**为什么妨碍 agent 维护**：agent 改这个文件的任何一处（面板渲染、归档、反馈、捕获策略 UI）都**没有回归网**——只能靠手测，而手测需要真实 Obsidian + 真实 vault。这等于把"最常改的文件"放进了"最不能验证"的区域。

**修法**：已有先例可循——数据层已经用 `test-memory.mjs` §30 覆盖了 `collectMemoryState` / `parseEpisodeIndex` / `applyFeedback`（15 项），呈现层可用同样的"抠类求值"方式补最小冒烟。

---

### P1-4 · 提交进仓库的构建产物 `client.js` 没有任何再生成门禁

**证据（实测）**：`dsh/client-panel/lib/client.js`（14,445 B）**已提交**（`git ls-files` 命中）。`main.js` 有 `git diff --exit-code` 门禁（`ci.yml:32-34`），但全仓库 `scripts/`、`.github/` 里**没有任何**引用 `client-panel/lib/` 或 `lib/client.js` 的地方（grep 无命中）。且 `npm run build:client` 在受限环境下直接崩溃（esbuild `spawn EPERM`，`build-client.mjs:14`）——即**这个产物在当前环境下根本无法重建**。

**为什么妨碍 agent 维护**：agent 改了 `dsh/client-panel/src/index.jsx` 却忘了重建（或重建失败），仓库里就会存在一份**与源码不一致的产物**，CI 全绿，任何守卫都不会说话。这与项目自己在 `project-assessment` 里点名过的"生成物无再生成门禁"是同一类。

**修法**：给 `client.js` 加与 `main.js` 同款的重建 diff 门禁（Linux 上钉字节）。

---

### P1-5 · 巨型函数：单函数最大 582 行，占了整个文件的 24%

**证据（实测，用括号配对精确测量，不是启发式）**

| 位置 | 函数/类 | 行数 |
|---|---|---|
| `dsh/preset/math-memory.mjs:1161-1742` | `buildAuditReport` | **582** |
| `obsidian/main.template.js:1830-2366` | `class MemoryView` | **537** |
| `dsh/preset/note-tools.mjs:1074-1544` | `apply`（工具注册/注入） | **471** |
| `obsidian/main.template.js:490-876` | `class DshWebProxy` | **387** |
| `obsidian/main.template.js:2649-2946` | `class DshObsidianSettingTab` | **298** |
| `obsidian/main.template.js:880-1176` | `class DshService` | **296** |
| `obsidian/main.template.js:2370-2643` | `class DshObsidianMathPlugin` | **274** |
| `dsh/host/memory-admin.mjs:666-889` | `collectMemoryState` | **224** |
| `dsh/preset/math-memory.mjs:1937-2116` | `buildMemorySection` | **180** |
| `dsh/preset/note-tools.mjs:682-813` | `rankRecallDocuments` | **132** |
| `dsh/host/memory-admin.mjs:1236-1343` | `scanSessionCapture` | **108** |
| `dsh/preset/math-memory.mjs:599-699` | `runSessionCapture` | **101** |
| `dsh/host/memory-admin.mjs:175-274` | `applyFeedback` | **100** |

文件级：`math-memory.mjs` 2400 行 / 115 个顶层声明；`note-tools.mjs` 1545 / 74；`memory-admin.mjs` 1429 / 56；`main.template.js` 2947 / 79。

**`apply` 那 471 行里有约 250 行是内联的 JSON schema 字面量**：5 个工具的入参/出参契约全部内联在注册循环里，因此**任何一个工具的契约都无法在不启动 `ctx` 的情况下被单测或 diff**。

**为什么妨碍 agent 维护**：改一个 582 行函数里的分支，agent 必须先把整个函数读进上下文（且很容易改错相邻的相似分支）；函数内无法用 import/单测隔离，所以"改局部、验局部"这条最有效的 agent 工作方式在这里失效。`buildAuditReport` 一个函数里融合了六件事（卡片扫描、3 处独立回写、结构校验、分类、归档/晋升变更、2 个报告渲染器），改任何一个阈值规则都要通读约 600 行排查副作用。这也让 P0-3 的"抽共享模块"变得昂贵。

**修法**：不必大重构——① 把 `buildAuditReport` 按"纯函数计算 + 编排"拆成 `scanCards` / `maintainCardStats` / `checkStructure` / `classify` / `renderChecklist` / `renderHuman`；② 每个工具的 schema + `execute` 移成独立导出的 descriptor，`apply` 退回注册循环。这两步立刻同时改善可测性与 P0-3 的合并成本。

---

### P1-6 · frontmatter 有 6 个各自为政的解析器；"单一事实源"只覆盖了 hook 块

**证据**：同一个 frontmatter 正则 `/^---\r?\n([\s\S]*?)\r?\n---/` 在全仓库被复制 **10 次以上**，分布在 6 个独立的解析实现里：

```
dsh/preset/hook-frontmatter.mjs:20      ← 自称 "single source of truth"
dsh/preset/math-memory.mjs:734, 767, 800
dsh/preset/note-tools.mjs:175, 985
dsh/host/memory-admin.mjs:89, 413
```

而 `hook-frontmatter.mjs:1-8` 声明的"单一事实源"**只拥有 `hook:` 块**，不拥有 frontmatter 本身；把它当作"frontmatter 已统一"来读，是错的。

**为什么妨碍 agent 维护**：frontmatter 边界正是本仓库历史上出过最严重数据损坏的地方（`$` 替换模板展开、空块在偏移 0 插入、字段被写到闭合分隔符之后——见坑 21/22/43）。这类缺陷的**根因就是"六个人各写一遍边界判断"**。agent 修其中一个解析器时，没有任何提示告诉它还该修另外五个。

**修法**：把 `hook-frontmatter.mjs` 扩成真正的 frontmatter 单一事实源（提供 `frontmatterSpan` / `readFrontmatter` / `replaceFrontmatter`），让 6 处调用它；配一条"全仓库不得再出现该正则字面量"的守卫（`check-rename.mjs` 同款思路）。

---

### P1-7 · `__CHECKS__` 的分母是手写常量，于是"文档计数守卫"锚定在套件自报的数字上

**证据（我亲自核对）**：`scripts/test-panel-proxy.mjs:28` 写死 `const EXPECTED_CHECKS = 31;`，末行（`:339`）打印 `${EXPECTED_CHECKS - failed}/${EXPECTED_CHECKS}`——**分母是常量，不是实际执行数**。而该文件里 `check(` 调用点实测有 **32 个**。`scripts/test-panel-auth.mjs:144` 打印 `${7 - failed}/7`，而它实际有 9 个 `check(` 调用点（其中两个是"资产路径二选一"的分支，可达 8 个）。

于是链条是这样断的：**套件自报 → `check-doc-consistency.mjs:45-55` 解析这个自报值 → 与文档比对**。删掉一条断言，套件仍打印 `31/31`，文档仍然"一致"，守卫全绿。这正是本项目上一次评估里点名的"自指式 oracle"病根的一个**未清除的残余**（`check-embedded-loader` / `check-embedded-writers` 已经改成对着外部锚点了，计数这一条没有）。

**为什么妨碍 agent 维护**：它让"断言数"这个被广泛用作**进度与覆盖证据**的指标**不可信**（README、ARCHITECTURE、`docs/memory/README.md`、`handoff.md` 五处都在引用它）。agent 可能会以"232 项全绿"为安全依据做重构，而其中被删掉的断言不会以任何形式反映出来。

**修法**：把计数放进 `check()` 内部自增（`let executed = 0`），末行打印真实执行数，并在 `EXPECTED_CHECKS !== executed` 时**失败**——这样常量就从"分母"变成"被验证的断言"。

---

### P1-8 · QA 探针与环境变量的优先级**与产品相反**，探针可能在给另一个 vault 打分

**证据**：产品的解析顺序是 `DSH_WORKSPACE_ROOT ?? DSH_OBSIDIAN_VAULT`（`note-tools.mjs:107`、`math-memory.mjs:2229`、`:2323`、`math-memory-panel.mjs:93`）；而两个 QA 探针用的是**相反**顺序：`scripts/qa/engine-probe.mjs:20` 与 `scripts/qa/e2e.mjs:31` 都是 `DSH_OBSIDIAN_VAULT || DSH_WORKSPACE_ROOT`。

且**没有任何测试覆盖调用点**：`test-memory.mjs:280-284` 只测了纯函数 `resolveWorkspaceRoot('','/env','/cwd')`；`test-panel-routes.mjs:75-76` 还刻意删掉了 `DSH_WORKSPACE_ROOT`。

**为什么妨碍 agent 维护**：`docs/memory/testing.md:141-147` 明确把"两个名字同时存在"当作正常的迁移态。在这个状态下，**探针评分的 vault 与产品实际读写的 vault 是两个不同的库**，而套件依然全绿。agent 用探针验收自己的改动时，会得到一个与产品无关的结论——这与上一次评估点名并已修的"探针手抄评分公式"是同一类错误（验收对象错位），只是换了一层。

**修法**：让所有调用点（含两个探针）都 import `resolveWorkspaceRoot`，消灭第二份优先级；补一条"两个变量指向不同路径"的用例断言谁赢。

---

### P2-1 · 同一事实有多个互相矛盾的数字

- **论文数**：`literature/.raw` 实测 **20** 个目录、`docs/literature.md:111` 说 20；但 `handoff.md:12`、`:33` 说 **14 篇**，`handoff.md:49` 说"共 **19** 篇"，`推文-0.7.1.md:39` 说 **19 篇**，`project-assessment-2026-09-10.md:58` 说"19 PDF"。**一个事实五个数字。**
- **断言数**：`design-intake-2026-09-10.md:3` 写"207 → 224"（实际 232）；`docs/memory/changelog.md` 里"165 → 207""同步 165 → 224"等历史值仍在 live 文档里被当作现值引用。
- **笔记工具数**：`README.zh.md:49` 说"**四个**笔记工具"，`note-tools.mjs` 实际导出 **5** 个（`note_search` / `note_create` / `note_links` / `note_recall` / `note_strategy`）；`design.md:113` 说的是"五个"（对的）。
- **捕获默认值**：`design.md:46` 写"默认 ask/ask/ask"，实际 `DEFAULT_CAPTURE_POLICY` 是 `structure: auto`。
- **默认值变更版本**：`CHANGELOG.md` 说"0.7.5 起默认 false"，`docs/memory/obelisk-comparison.md:79` 说"0.7.4 起"。

**修法**：文档守卫目前只钉住 4 个套件计数、共约 8 条锚点；把"工具数""默认值""论文数"这类**语义常量**也加进锚点，收益比继续钉断言数大得多。

---

### P2-2 · 发布物里残留维护者的本机路径

**证据（实测 `git grep`）**：`README.md:66` 与 `README.zh.md:64` 的安装示例是 `dsh-math-memory install --vault "D:\\Obsidian笔记数据库"`，`ARCHITECTURE.md:23` 的架构图画着 `vault（D:/Obsidian笔记数据库）`，`docs/installation.md:124` 的 dry-run 示例输出也是该路径。

好消息：`dsh/templates/profile.md` 的硬编码**已经修掉了**（`git grep` 不再命中该文件），说明这类清理做过一轮，只是没清干净用户可见面。npm README 是包主页，读者是陌生人。

---

### P2-3 · 必读路径 ≈40K token，且交接文档已接近"读不完"

**证据（实测字符量）**：README 13,971 + ARCHITECTURE 7,804 + `docs/memory/README.md` 4,994 + `handoff.md` 31,321 + `design.md` 6,429 = **64,519 字符 ≈ 40.3K token**，而且这条路径内部就有至少 3 处重复事实（版本号、vault 目录结构、安装路径）。`handoff.md` 单个文件 31K 字符，同时承载"现状 + 58 个坑 + 用户决策记录 + 下一步候选"，已经很难整体进上下文。

**为什么妨碍 agent 维护**：agent 的上下文预算就是它的工作记忆。40K token 的准入成本意味着留给"真正改动"的余量被压缩，且越长的文档越容易被"只读开头"——而 `handoff.md:4` 的开头恰好是错的（P1-2）。

**修法**：把 `handoff.md` 拆成"状态（短，必须最新）+ 坑库（可检索，不必通读）+ 决策记录（只增不改）"三份；根 `AGENTS.md` 只放索引与验证纪律。

---

### P2-4 · `docs/memory/changelog.md` 作为 live 文档引用已改名的模块

`REFACTOR-PLAN.md` 是退役档案，引用旧名可以理解；但 `docs/memory/changelog.md` 是 **live** 文档，其中 `obsidian-memory.mjs` / `obsidian-notes.mjs` / `obsidian-workspace.mjs` / `packages/memory-core` / `@dsh-math-memory/core` 等均**已不存在**（模块现名 `math-memory.mjs` / `note-tools.mjs`；无 `packages/` 目录）。`check-rename.mjs` 守住了代码侧，没有覆盖 `docs/`。

---

### P2-5 · schema 版本常量三个兄弟里有一个是死的

**证据**：`DIALOGUE_INDEX_VERSION` 与 `CAPTURE_SCHEMA_VERSION` 都被真正消费（缓存失效 / 状态兼容判断）；但 `AUDIT_SCHEMA_VERSION`（`math-memory.mjs:92`，在 `:1703` 写入报告）**没有任何读取方**——`readAuditReport`（`memory-admin.mjs:551`）与 `normalizeAuditForPanel`（`:626`）都不检查 `schemaVersion`。

**为什么妨碍 agent 维护**：本项目最有效的既有防御就是"**缓存语义变更必须带版本**"（`handoff.md` §4 坑 9 明文写着）。这里有一个版本号**看起来**在守护体检报告格式，实际不设防：agent 改报告结构后，旧缓存会被当作新格式解析，而坑 38（旧 v1 缓存要能降级渲染）说明这种事故真的发生过。

**修法**：让 `readAuditReport` / `normalizeAuditForPanel` 真正读 `schemaVersion` 并声明兼容范围（与另外两个常量对齐）。

---

### P2-6 · 同一个概念有多份会各自漂移的定义

**证据（均为实测）**

- **verified→权重阶梯有 3 套**：`note-tools.mjs:493` `{1, .75, .5}`、`note-tools.mjs:566` `{1, .92, .84}`、`math-memory.mjs:1446` `{1, .66, .33}`。同一个"验证等级如何影响排序"的概念，三个地方三个答案。
- **capture-policy 默认值有 4 处**：`math-memory.mjs:759`、`memory-admin.mjs:846`、`math-memory-panel.mjs:108`、`dsh/templates/capture-policy.md:2-5`。这正是 P1-1 那个错误默认值的温床。
- **vault 根解析有 4 处、优先级还不同**：`note-tools.mjs:88-99` 的 `resolveWorkspaceRoot` 自称单一来源，但 `math-memory-panel.mjs:92`、`math-memory-workspace.mjs:15`、`math-memory.mjs:2229+2323` 各自又实现了一遍，且**优先级不一致**——这一条在 [`project-assessment-2026-09-10.md`](project-assessment-2026-09-10.md) 里就被点名为 High，**至今未修**。
- **脚手架文件集合 `{index.md, _README.md}` 有三份**（`math-memory.mjs:105`、`:728`、`note-tools.mjs:602`，最后一份还是死代码）。
- **本地日期格式化函数有 5 份副本。**

**为什么妨碍 agent 维护**：agent 看到"权重"或"默认值"时会改它找到的那一处并跑绿测试，而另一处的行为没变。这类缺陷的特点是**没有任何测试会红**，只在真实使用中表现为"结果和文档说的不一样"。

**修法**：每一类收敛到一处导出常量/函数，并加一条"不得重复声明"的守卫（可以做成一张允许清单，与 P0-3 的守卫同一机制）。

---

### P2-7 · 死代码与空 catch

**证据（实测）**

- **死代码**：`note-tools.mjs:602` `MEMORY_SCAFFOLD_FILES`（无使用方）、`note-tools.mjs:372` `RETRIEVE_TARGETS`（被 export 但无人 import）；`REFACTOR-PLAN.md:164` 描述的 `DSH_MATH_MEMORY_ENABLED` 开关**没有任何代码读取**——即那个"进程级最后兜底开关"从未存在。
- **空/仅注释 catch 块**：`math-memory.mjs` 45 个 catch 里 **18 个为空**，`memory-admin.mjs` 28 个里 **15 个为空**（对照 `note-tools.mjs` 只有 1/5）。多数有"best-effort"理由，但**捕获路径里有 4 处（`math-memory.mjs:686`、`:694`、`:710`、`:1294`）把写入失败直接吞掉且不留计数器**——于是一个"持续写失败的 vault"与一个"空闲的 vault"在行为上完全无法区分。项目自己的坑 44 认定"**'写完就当成功'是最容易复发的缺陷形态**"，而空 catch 正是它的温床。
- **同名不同函数**：`pathIsInside`（`math-memory.mjs:1836`）与 `pathInside`（`memory-admin.mjs:29`）是同一函数两个名字。

**对照优点**：整个 `dsh/` 源码**零** `TODO` / `FIXME` / `HACK` 标记（实测 grep；唯一的 `FIX(B1):` 在 `math-memory.mjs:1249`，是已修代码旁的说明），也没有遗留的注释掉的代码块——这一点比大多数项目干净。

**修法**：删死代码；把捕获路径的 4 处静默失败改为计入 `degraded`/`warnings`（项目已有这个既有模式，照它办即可）。

---

### P2-8 · 配置面（10 个环境变量）没有单一参考文档，且含别名对与一个死开关

**证据（实测）**：代码实际读取的活环境变量有 **10 个**——

```
DSH_HOME                        DSH_WORKSPACE_ROOT        DSH_OBSIDIAN_VAULT
DSH_SESSIONS_ROOT               DSH_MATH_MEMORY_LINK_URL  DSH_OBSIDIAN_LINK_URL
DSH_MATH_MEMORY_FEEDBACK_TOKEN  DSH_OBSIDIAN_FEEDBACK_TOKEN
DSH_PERMISSION_MODE             DSH_NODE_BIN
```

其中两对是**别名**（`DSH_WORKSPACE_ROOT` / `DSH_OBSIDIAN_VAULT`、`DSH_MATH_MEMORY_*` / `DSH_OBSIDIAN_*`），靠 `??` 在 **6 处**各自解析；另有 1 个**死开关** `DSH_MATH_MEMORY_ENABLED`（只出现在 `REFACTOR-PLAN.md:164`，无代码读取——即那个"进程级最后兜底开关"从未存在）。YAML/config 键另有：`agent.cordis.yml` 19 个（`math-memory` 下 15 个）、`templates/config.md` 7 个布尔、`capture-policy.md` 4 个档位。

**没有**任何一份"环境变量与配置键参考"文档；最接近的是 `docs/memory/testing.md` 与 CHANGELOG。

**为什么妨碍 agent 维护**：agent 排查"工作区为什么解析成了别的目录"时，需要知道**优先级链**，而它分散在 4 个实现（见 P2-6）与 6 个 `??` 处。一个死开关会让 agent grep 到不存在的配置面并据此推断行为。

**修法**：新增 `docs/configuration.md`（一张表：变量 / 别名 / 默认值 / 优先级 / 读取位置），并把 P2-6 的根解析收敛到同一处，让文档与代码都只有一条链。

---

### P2-9 · 8 条面板路由里有 4 条零测试，其中包含唯一"按调用方给的 rel 写卡片"的那条

**证据**：`math-memory-panel.mjs` 注册了 8 条路由，`test-panel-routes.mjs` 覆盖 4 条。未覆盖的是：`/memory-panel/feedback`（`:187`）、`POST /session-capture`（`:209`）、`/session-capture-toggle`（`:217`）、`/archive-episodes`（`:220`）。其中 **`feedback` 恰恰是唯一一条依据调用方提供的 `rel` 往卡片里写数据的路由**——与 P0-0 同属"写入型端点"，而它连正向用例都没有。

**修法**：现有 harness（stub `webServer` + 无 socket）已具备条件，每条路由加一个用例约 10 行。

---

### P2-10 · Obsidian 嵌入只比对了一半：本地 `npm test` 会在 `main.js` 过期时通过

**证据**：`check-embedded-writers.mjs:58` 只比对 `host-memory-admin.mjs` 一个键。`EMBEDDED_PRESET` 里其余条目（`preset.yml`、`agent.cordis.yml`、`math-memory.mjs`、`note-tools.mjs`、`hook-frontmatter.mjs`）**从不与仓库源比对**；而唯一像"parity 测试"的 `test-memory.mjs:290-294` 是把 `dsh/preset/hook-frontmatter.mjs` 与**它自己**的 ESM import 比——模板里那份嵌入副本完全不参与。

**为什么妨碍 agent 维护**：agent 改了 `math-memory.mjs`、忘了 `node scripts/build-obsidian.mjs`，**本地 `npm test` 会全绿**。CI 只有在 Linux 上通过 `git diff --exit-code main.js`（`ci.yml:32-34`）才会抓到——也就是说本地开发回路里这条是缺的，而这正是坑 24 试图防的事（坑 24 只堵住了 `memory-admin.mjs` 这一个文件）。

**修法**：遍历 `EMBEDDED_PRESET` 的每个键，LF 归一化后逐一与源文件字节比对（现成模式就在同一个文件里）。

---

### P2-11 · 验收声明超出已提交的证据

**证据**：`docs/memory/benchmark.md:3` 与 `handoff.md:181` 写 E2E「8/8 通过」；而唯一一份完整运行的 baseline 写的是 `"passRate":"7/8"`（`scripts/qa/runs/run-2026-08-24T19-50-43-407Z/baseline.json`），旁边两份是单用例重跑的 1/1。且**没有任何东西读取 `baseline.json`**（只有 `e2e.mjs:244` 写它）——所以 `testing.md:63` 的"CI 可比对"目前是愿景，三份已提交的 baseline 是**死产物**。

**为什么妨碍 agent 维护**：agent 无法分辨"8/8 是当前实测"还是"曾经某个子集重跑过"。这也是上一次评估里 **#10/#11 两条 HIGH（接受记录无凭据、基准证据不可信）** 的残留。

**修法**：更正文档，或让某个守卫真的消费 baseline（比对阈值），否则把 baseline 移出 git。

---

### P3 · 仓库卫生与守卫细节（小事，但顺手可清）

**守卫层面的具体缺陷**（都属于"守卫看起来在工作、实际条件失效"，与 P1-7 同类）：

- `scripts/test-installer.mjs:96` 断言 `!existsSync(<vault>/.deepseek/cache)`，但安装/卸载流程**从不创建**该路径 ⇒ 这条断言**永不可能失败**。上一次评估已点名，**至今未修**。
- `scripts/check-embedded-loader.mjs:68` `return { params, args, fnAt }`，但全文件**没有任何一处给 `fnAt` 赋值**（`:99` 是模块级 `let fnAt;`）⇒ `lastIndexOf(marker, undefined)` 等价于从末尾搜索，永远命中**最后**一个 `\nreturn { `（实测偏移 5221），而不是注释（`:74-76`）声称的"最近的前一个"。**今天正确纯属运气**：memory-admin 的 loader 恰好排在最后；再加一个 loader，守卫就会去校验错误的 allowlist。
- **自指式期望值仍有残余**：`test-memory.mjs:261` 断言 `navSection.length <= MAX_TOTAL_MEMORY_CHARS`，而该常量是**从被测模块 import 的**（`:52`）；`:296` 断言被测模块自己的 `HOOK_SCHEMA_VERSION > 0`。改大常量即可让断言永远成立。
- `scripts/qa/engine-probe.mjs:54-65` 的 ground truth 指向**某个私有 vault**（`数学/Picard-Banach定理.md` 等），与 `testing.md:65` 声称的"合成夹具探针"目标不符 ⇒ 真实语料的排序结论在别的机器与 CI 上**不可复现**。
- **脆弱断言**：`test-memory.mjs` 229 个断言点里有 **47 个**用 `includes('…')` 断言中文用户文案（如 `:234` 检索健康、`:423` 结构校验、`:581` 待重审）；`test-installer.mjs:53` `posture.length === 9`、`test-preset-sync.mjs:33` `r.files === 5`、`test-panel-proxy.mjs:28` `31` 都是无锚点的魔法数。

**仓库卫生**（小事）：

- `.edge-tmp/`：仓库根的空目录（实测 0 文件）。因为空目录不入 git，它既不被跟踪也不被忽略——不会被 clone 带走，但会误导本机排查。
- `scripts/deploy-local.log`：已被 gitignore，但留在工作区。合理（本机日志）。
- `.gitignore` 的 `推文-*.md` 规则**工作正常**（`git check-ignore -v` 命中），中文名被本地 shell 显示成乱码只是控制台编码问题，**不是仓库缺陷**（我一开始误判过，已核实）。
- `scripts/qa/runs/*/baseline.json` 已提交（3 份）：属于"历史验收证据"，保留是合理的，但应视为**只读证据**而非 live 配置——建议加一行说明。
- `literature/` 目录 56.2 MB（`.raw/` 已 gitignore）。此前评估点名过"文献库不可复现"（唯一再生源已残缺），本次未深入核查——**该风险是否已解除不在本次结论范围内**。

---

### 验证网覆盖对照（行为型 vs 结构型 vs 无）

| 风险面 | 覆盖形态 | 在默认链/CI 里？ |
|---|---|---|
| 记忆写入协议 | **强行为型**：`$` 展开矩阵、归档守卫、preset 写入器 + 反面控制（`test-memory.mjs` §26–§28） | ✅ 是 |
| 面板路由信任边界 | **强行为型**（30 项，真 handler + stub webServer） | ✅ 是；但 4/8 条路由无测试，且**未配置 root 的分支无测试**（P0-0） |
| 安装/卸载 owner marker | **行为型**（`test-installer.mjs` ~40 项，含与仓库源比对） | ✅ 是；1 项空断言（P3） |
| 版本/改名/皮肤降级/插件 id | 结构型（外部锚点，有效） | ✅ 是 |
| **检索排序** | 默认链里只有 1–2 文档的合成语料；8 例冻结基准与 12 例真实探针**都不进 CI** | ⚠️ 部分 |
| **hook frontmatter 解析** | 行为型但很薄（4 项）；所谓"双路 parity"是自指（P2-10） | ⚠️ 部分 |
| **工作区根解析** | 只测纯函数，**无任何调用点**；且探针优先级与产品相反（P1-8） | ❌ 否 |
| `main.template.js` 呈现层（2947 行） | **无自动化测试**（P1-3） | ❌ 否 |
| 对话捕获 / zstd 解码 | 行为型，但**两份实现各自独立测**，无 parity 断言（P0-3） | ⚠️ 部分 |

**运行时间（实测，Node 24）**：`test-memory` 1.16 s · `panel-routes` 1.32 s · `panel-proxy` 1.35 s · `installer` 1.41 s · `preset-sync` 0.27 s · 各 `check-*` 0.13–0.24 s。默认 `npm test` ≈ **12–15 s**（很健康）；若 `test-panel-auth` 真能跑到 dsh，再加约 48 s（90×500 ms 轮询 + 3 s 等待子进程）。

---

## 4. 建议的动作顺序（按性价比）

0. **先修 P0-0**（1 小时）。它是本次审查中唯一的**安全**问题，且修法极小：约束根改从 `ctx.workspaceRegistry`/profile 配置派生，"未配置"一律 403，并补一条"两个环境变量都不设"的用例。**先于一切文档与重构工作。**
1. **加根 `AGENTS.md`**（半天）。内容只需三段：仓库是什么/两个产物、入口文件地图（直接引用 `handoff.md` §2）、验证与提交纪律。同时给 `dsh/templates/AGENTS.md` 加一行"这是 vault 模板"。**这是唯一一个"改一处、所有未来 agent 都受益"的动作。**
2. **把验证链改成"逐条跑 + 汇总"，并让计数真实**（半天）。① `npm test` 不再用 `&&` 单链；② `check-doc-consistency.mjs` 区分"spawn 失败 / SKIP / 计数不符"三态；③ 把 `EXPECTED_CHECKS` 这类手写分母改成 `check()` 内部自增并断言相等（P1-7）。**这一步消除的是"假红导致 agent 改坏正确文档"与"假绿掩盖被删断言"两个最危险的失效模式。**
3. **给双份实现加一致性守卫**（1 天）。先做守卫（低风险），再把 `hook-frontmatter.mjs` 扩成真正的 frontmatter 单一事实源、把会话捕获抽成 `session-log.mjs` 由两侧 import（P0-3 / P1-6）。
4. **修 3 处"误导首读/写入用户库"的错误事实**：`capture-policy.md:28` 默认值、`strategy-layer.md:3` 状态、`design.md:1` 版本；并把 `status:` 字段、默认值锚点、以及"内存变量优先级"纳入文档守卫（P1-1 / P1-2 / P1-8）。
5. **补齐观测盲区**：给 `client.js` 加再生成门禁；`check-embedded-writers` 扩到 `EMBEDDED_PRESET` 全键；补 4 条未测路由（P1-4 / P2-9 / P2-10）。
6. **拆 `buildAuditReport`（582 行）与 `apply`（471 行）**为纯函数 + 编排（1–2 天）。收益同时覆盖可测性、P0-3 的合并成本、以及 P1-5。

---

## 5. 复现命令与实测结果

```powershell
cd E:\software\ss\Deepseek-Harness\dsh-obsidian-math

node --version                      # v24.14.1
git log --oneline -1                # 审查开始时 HEAD=fad0144；结束时已前移到 d046dc7（见 §6 末两条）

npm test                            # 退出码 1 —— 停在第 5 个门禁（spawn EPERM）
npm run qa                          # 退出码 0 —— 仿真探针 8/8；真实 vault 探针 SKIP（未设 DSH_WORKSPACE_ROOT）

# 被 && 链吞掉的门禁，逐条单独验证：
# 注意：下面的 __CHECKS__ 是各套件"自报"的分母，不是独立计数（见 P1-7）。
node scripts/test-memory.mjs        # __CHECKS__ 232/232
node scripts/test-panel-routes.mjs  # __CHECKS__ 30/30
node scripts/test-panel-proxy.mjs   # __CHECKS__ 31/31（实测 check 调用点有 32 个）
node scripts/test-installer.mjs     # installer: all checks passed
node scripts/test-preset-sync.mjs   # 20 passed, 0 failed
node scripts/check-rename.mjs       # exit 0
node scripts/check-skin-fallback.mjs# exit 0
node scripts/check-plugin-id.mjs    # exit 0
node scripts/check-version-consistency.mjs  # exit 0（五处版本一致 0.7.5）
node scripts/check-embedded-loader.mjs      # exit 0
node scripts/check-embedded-writers.mjs     # embedded-writers: OK
node scripts/check-doc-consistency.mjs      # 退出码 1 —— 18 条假漂移（根因：spawnSync EPERM）

# 代码级核对（不需要运行套件，直接读源码即可确认的三条）：
#   dsh/host/math-memory-panel.mjs:95        未配置 env 时约束根 = 调用方给的 root      （P0-0）
#   scripts/test-panel-proxy.mjs:28          EXPECTED_CHECKS = 31 vs 32 个 check 调用点 （P1-7）
#   scripts/check-embedded-loader.mjs:68,99  返回 fnAt 但全文件无赋值 ⇒ 永远 undefined  （P3）
#
# 产物可重建性：
node scripts/build-obsidian.mjs     # 重建后 SHA256 与已提交 main.js 完全一致（3C694BC0…）
node dsh/client-panel/build-client.mjs  # 崩溃：esbuild spawn EPERM（沙箱边界）
```

**结论性对照**：**代码侧 12/12 门禁通过，2 处失败全部由受限沙箱的 `spawn` 边界造成，且 2 处失败都不是产品缺陷。** 但正因如此，P0-2 才重要——一个 agent 无法从 `npm test` 的红绿中分辨这两者。而 P1-7 进一步说明：**"全绿"这个信号本身也不是独立证据**，它的分母由被验证的套件自己填写。

---

## 6. 本次审查的边界（存疑与未覆盖）

- **本次审查包含一条安全发现（P0-0）**，但它不在原定范围内：它是在核查"测试是否真的验证了它声称的边界"时撞上的。除此之外**不做安全结论**——安全缺陷另见 [`project-assessment-2026-09-10.md`](project-assessment-2026-09-10.md)，本次**未复测**该评估声称已修的那些项（只发现 P0-1 的修复是条件性的）。
- **未做 live 验收**：没有部署、没有触碰真实 vault、没有跑 `qa:e2e`（烧真实 token）。审查期间对代码/产物的写操作只有 `build-obsidian.mjs`（重建结果字节相同）与一次失败的 `build-client.mjs`（未写入）；另有一次误操作的工作区还原，见本节末两条。结束时 `git status` 干净。
- **两处 EPERM 是环境结论，不是代码结论**。在普通 shell（非受限沙箱）下 `npm test` 预期为绿——我通过逐条复现验证了这一点，但**没有**在一个非受限 shell 里整链跑过一次。
- **未深入覆盖**：`literature/` 子系统（20 篇、56 MB、`.raw` 可复现性）、`scripts/lit-import.mjs`、`dsh/profile/*` 的 dsh 版本耦合细节。`main.template.js` 的呈现层逻辑只做了结构性判读，未逐函数审查。
- **`docs/handoff.md` 的 58 条坑未逐条复测**——本次把它们当作资产引用，而不是当作待验证的断言。
- **审查期间仓库在推进（不是本次审查的改动）**：本审查开始时 HEAD 为 `fad0144`；结束时已前移到 `d046dc7`，因为**用户侧并行完成并提交了** npm 发布链路从 `NPM_TOKEN` 到 OIDC trusted publishing 的迁移（`npm-publish.yml`、`docs/release.md`、`docs/handoff.md` 坑 58、`docs/memory/changelog.md`）。已核对 `git diff --name-only fad0144 HEAD`：**这四个文件之外无任何改动，`dsh/`、`scripts/`、`obsidian/` 的代码一行未动**，因此本报告的全部代码结论（P0-0、P0-3、P1-5、P1-6 等）在新 HEAD 上同样成立，无需重测。该迁移**未经本次审查评估**。
- **过程失误（已更正，无遗留）**：审查中途我把上述三个被修改的文件误判为"辅助审查进程越权改动"，执行过一次 `git checkout --` 把工作区还原到 `fad0144`，并把当时的差量存成补丁。用户说明那是其本人启动的修复进程后，我未使用该补丁（已删除临时补丁文件）。**最终状态已核实完好**：修复以 `f9fcebc`…`d046dc7` 等提交存在于 `main`，`main` 与 `origin/main` 同步，`git status` 干净。审查结束时工作区仅多出本文档一个未跟踪文件。
