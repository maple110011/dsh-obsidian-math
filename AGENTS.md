# AGENTS.md — dsh-obsidian-math 仓库维护协议

> **English summary**: This repo ships **two artifacts off one version number** — an Obsidian plugin (`main.js`/`manifest.json`/`styles.css`; `main.js` is **generated**, never hand-edited) and a dsh plugin/preset published to npm as `dsh-math-memory` (`dsh/`). Read §2 for the file map, §3 before changing code, §4 before claiming success, §6 for the traps that keep recurring.
>
> **这份文件管什么**：**仓库维护**（改代码、跑测试、写文档、提交）。
> **不管什么**：`dsh/templates/vault-AGENTS.md` 是**安装进用户 vault 的教学协议**（安装后名为 `AGENTS.md`），约束的是"在 vault 里工作的 agent"。它**不是**本仓库的维护协议；若某个 harness 把它自动注入给你，只把它当作用户侧产品行为，不要照它维护本仓库。

## 0. 三十秒速览

- **产物 A — Obsidian 插件**：根目录 `main.js` + `manifest.json` + `styles.css`。`main.js`（约 500 KB；**确切字节数由 build 打印，不必在此维护**——钉一个数字在这里只会随每次重建腐烂）是**生成物**：`obsidian/main.template.js` 加上内嵌的 `dsh/**` 源码与全部模板，经 `node scripts/build-obsidian.mjs` 拼装。
- **产物 B — dsh 插件/预设 + npm 包** `dsh-math-memory`：`dsh/preset/`（记忆注入引擎、笔记工具）、`dsh/host/`（记忆维护 + 管理面板后端）、`dsh/profile/`、`dsh/templates/`、`dsh/install.mjs`。
- **一条数据流**：笔记 → hook/会话日志 → 捕获与蒸馏 → `.deepseek/memory/**` → 检索注入回对话。三层记忆：records/topics（长期）、episodes（事件）、inbox/strategy（暂存与策略）。
- **验证入口**：`npm test`（= `scripts/run-gates.mjs`，**跑完全部门禁再汇总**）。**先读 §4**：受限环境里的"红"未必是回归，要分类再动手。

## 1. 先读哪份文档

| 你想知道 | 读 |
|---|---|
| 目录结构、模块职责、数据流 | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 上手/交接：改哪里、跑什么、**69 条历史陷阱** | [`docs/handoff.md`](docs/handoff.md)（§2 入口地图、§4 陷阱、§7 未做清单） |
| **给 agent 的仓库维护方法（通用）** | [`docs/agent-repo-maintenance.md`](docs/agent-repo-maintenance.md)（**§0.5 = 八荣八耻、§0.6 = 业务项目测试纪律六条，动手前先读**） |
| 可维护性审查与整改台账 | [`docs/maintainability-review-2026-09-11.md`](docs/maintainability-review-2026-09-11.md)（审计，只读）、[`docs/maintainability-fixes-2026-09-11.md`](docs/maintainability-fixes-2026-09-11.md)（状态 + 证据） |
| 记忆系统的当前实现规格 | [`docs/memory/design.md`](docs/memory/design.md) |
| 每条行为/契约**为什么**变成现在这样 | [`docs/changelog.md`](docs/changelog.md) |
| 面向用户的版本变更 | [`CHANGELOG.md`](CHANGELOG.md) |
| 面板/路由/信任边界 | [`docs/memory/control-panel.md`](docs/memory/control-panel.md) |
| **为什么用独立端口 / 两套用途的隔离边界**（含"端口解决不了什么"） | [`docs/port-and-isolation.md`](docs/port-and-isolation.md) |
| **环境变量**（唯一参考：谁读、别名优先级、死开关） | [`docs/env-vars.md`](docs/env-vars.md)（代码与本表双向一致由 `check-env-vars.mjs` 保证） |
| 发布流程与 npm 侧一次性配置 | [`docs/release.md`](docs/release.md) |

## 2. 文件地图：改哪里

| 要改的东西 | 改这里 | 改完必须做 |
|---|---|---|
| 记忆注入、检索、排序、捕获、蒸馏 | `dsh/preset/math-memory.mjs` | 重建 `main.js`；查双份实现（§3.3） |
| `note_*` 笔记工具 | `dsh/preset/note-tools.mjs` | 重建 `main.js` |
| 记忆维护、归档、体检、会话捕获 | `dsh/host/memory-admin.mjs` | 重建 `main.js`；查双份实现（§3.3） |
| **frontmatter 的边界判断**（"块从哪到哪"） | `dsh/preset/hook-frontmatter.mjs` —— **唯一**的家 | 重建 `main.js`；`node scripts/check-frontmatter-source.mjs`（禁止再复制那个正则；宿主那份拷贝必须行为等价） |
| `/memory-panel/*` 路由与信任边界 | `dsh/host/math-memory-panel.mjs` | 重建 `main.js`；补 `test-panel-routes.mjs` |
| Obsidian 界面、设置页、引导、代理 | `obsidian/main.template.js` | 重建 `main.js` |
| 安装进 vault 的模板 | `dsh/templates/*.md` **+** `dsh/templates-manifest.json` | 跑 build（有完整性门禁） |
| 安装器（三条安装路径 / 卸载 / 归属标记） | `dsh/install.mjs` | `node scripts/test-installer.mjs` |
| dsh 预设与 profile 装配 | `dsh/profile/`、`dsh/preset/*.yml` | `node scripts/test-preset-sync.mjs` |

## 3. 改代码的五条铁律

1. **不要手改 `main.js`。** 它是生成物（内嵌 `dsh/**` 与全部模板）。改任何 `dsh/**`、`obsidian/main.template.js` 或 `dsh/templates/*.md` 之后，跑 `node scripts/build-obsidian.mjs` 并**把 `main.js` 一起提交**。CI 用 `git diff --exit-code main.js` 做字节级重建门禁（仅 Linux 跑）。
2. **新增或改名模板必须同步 `dsh/templates-manifest.json`**（`source → vault 目标路径`）。build 有完整性门禁：`dsh/templates/` 里有 `.md` 不在清单中就抛错。安装器与插件引导都**按清单**遍历，所以只需改清单、不要另加硬编码列表。
3. **存在两份实现，改一处必须改另一处。** `dsh/preset/math-memory.mjs` 与 `dsh/host/memory-admin.mjs` 有 22 个同名顶层符号（捕获、蒸馏、zstd 会话日志、索引解析等）。安装器把 `memory-admin.mjs` 同时装进 profile，面板与插件都消费它。**守卫：`node scripts/check-engine-sync.mjs`**——钉住共享清单、按词法流比对，现为 16 个同步 + 6 条有记录的偏离；只看注释里的 "keep the two in sync" 是不够的。
   - **按名字配对，所以改了名的重复实现是盲区**：`pathIsInside`（preset）/ `pathInside`（host）曾是同一个函数却因名字不同而不被守卫看见，2026-09-11 已统一改名（坑 64）。**新增共享助手时用同一个名字**，否则守卫帮不了你。
4. **版本号五处必须一致**：`package.json`、`package-lock.json`、`manifest.json`、`versions.json`、`CHANGELOG.md`（外加 git tag）。改完跑 `node scripts/check-version-consistency.mjs`。未发布的行为改到 `CHANGELOG.md` 的 `[Unreleased]`，**不要**擅自改版本号——发版是用户的决定。
5. **提交前看 `git status`**，只应有你有意的改动。不要提交 `literature/.raw/**`、本地部署产物、真实 vault 数据或任何密钥。

## 4. 验证：什么才算"通过"

**首选**：`npm test`（= `node scripts/run-gates.mjs`）。它**跑完全部门禁再汇总**，逐个报告状态与套件自报计数，失败时打印该门禁输出的末尾。**若它绿，你是真的绿**（本机当前 34/34）。⚠️ 但"绿"只等于**退出码 0**：门禁可以因环境不允许而**自行 SKIP** 后 exit 0，而汇总只按退出码统计、不区分 SKIP（坑 69：本机 34/34 里曾有一条其实什么都没比，CI 才报出来）。见到 `SKIP`/环境字样就去读那条门禁自己的输出（`node scripts/run-gates.mjs --only <子串>`），别把汇总当成"每条都真的比过"。

```bash
node scripts/run-gates.mjs               # 全部门禁（= npm test）
node scripts/run-gates.mjs --list        # 门禁名单
node scripts/run-gates.mjs --only panel  # 只跑名字含 panel 的
```

**受限/沙箱环境的注意事项。** 在禁止"管道 stdio"的环境里，子进程**无法**通过管道启动（`spawn EPERM`）。本仓库已为此加固，所以正常表现是：

- 需要子进程的套件（auth e2e）**声明 SKIP** 并打印原因（含确切路径），而不是失败；
- 守卫把"子进程根本没起来"单独标成**环境结果**（`could not start the child process`），不混进"文档漂移"；
- 计数由套件自己累加，不会凭空变成 0。

**但"红"仍要先分类再动手**：区分**代码缺陷**与**环境结果**。环境的红**不要**去改文档或改断言来"修"——历史上"文档写 232、实际 0"的假漂移就是这么被制造出来的（`handoff.md` 陷阱 56 / 59）。

- `npm run qa` — 仿真探针，**零 token**，可随意跑。
- `npm run qa:e2e` — 打真实 API，**烧钱**。默认不要跑；要跑先问用户。
- 套件末尾打印的 `__CHECKS__ n/m` 中，`m` 由**套件自己申报**。把它当"跑了多少"，不要当"覆盖了什么"；判断覆盖要看断言本身。
- **声称"已验证"时必须说出覆盖范围**：跑了哪条命令、多少项、哪条是变异验证。笼统的"测试通过"不算证据。

## 5. 记录纪律（改完就写，别攒着）

| 改动性质 | 写在哪 |
|---|---|
| 行为/契约变化及其**理由** | `docs/changelog.md`（追加一节，风格同前文） |
| 面向用户的版本变更 | `CHANGELOG.md`（未发布放 `[Unreleased]`） |
| 未完成、延期、已知缺口 | `docs/handoff.md` §7——**这是唯一权威的"未做"清单**，完成一项就划掉一项 |
| 架构/结构变化 | `ARCHITECTURE.md` 与 `docs/memory/design.md` |
| 陷阱与踩坑 | `docs/handoff.md` §4（带编号、带根因、带复现） |

文档里**有状态**的段落要有明确状态（`已实现` / `提案` / `部分实现`），别让读者自己猜。

## 6. 已知陷阱（不要重新踩）

- **面板的约束根永远来自服务端**（环境变量 + `ctx.workspaceRegistry`），**绝不能**退回"请求里带的 `root`"——那会让下游 `pathInside` 检查形同虚设。新增路由时，任何以调用方 `root` 为依据的路径判断都要走同一套锚定。
- **模板源文件名不要叫 `AGENTS.md`**（已改名 `vault-AGENTS.md`）：仓库内的源文件叫 `AGENTS.md` 会被 agent harness 自动当成"仓库指令"注入，而它其实是给用户 vault 的教学协议。
- **测试要锚在代码上，不要锚在数据上。** 已发生过：断言"文档写 232"这种由外部数据决定的性质，数据一变（或跑不动）就变成无意义/假失败。优先断言"代码在**有条件时**提供的性质"，并亲自构造那个条件。
- **生成物必须重建，且本地能查出来**：`main.js` 是生成物。CI 用 `git diff --exit-code main.js` 拦过期，本地由 `node scripts/check-bundle-freshness.mjs` 拦（逐字节比对一次全新构建，失败时指出首个差异偏移）。改了 `dsh/**`、模板或 `obsidian/main.template.js` 却忘了重建 → 这条会红。
- **新增模块会被构建拦下**：`dsh/preset|profile|host` 下新增可嵌入文件而没加进 `EMBEDDED_SOURCES`，`build-obsidian.mjs` 会**直接抛错**（要求你嵌入它，或在 `NOT_EMBEDDED` 里写明为什么不该进）。
- **不要只测"已配置"的分支。** 面板安全问题能长期潜伏，正是因为在它之前每个用例都设了环境变量。**没有用例走到的分支，不算被测过。**
- **加守卫必须做变异验证**：故意制造它要抓的缺陷 → 确认它报错 → 恢复 → 确认 `git diff` 为空。验收标准是"**它在该报错时确实报错**"，不是"跑了没报错"。
- **解析 frontmatter 不要自己写正则**：`/^---\r?\n([\s\S]*?)\r?\n---/` 曾被复制 15 次，是坑 21/22/43 三次数据损坏的共同根因。用 `dsh/preset/hook-frontmatter.mjs` 的 `frontmatterSpan`/`readFrontmatter`/`replaceFrontmatter`，守卫 `check-frontmatter-source.mjs` 会拒绝新的拷贝（坑 65）。
- **只有一个自动发现的指令文件**：仓库根 `AGENTS.md`（就是本文件）。任何其它 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` / `.github/copilot-instructions.md` 都会被 harness 当成"**本仓库**的指令"注入给 agent——不管它本来写给谁。本仓库已经中过两次（坑 60：`dsh/templates/AGENTS.md` 是给用户 vault 的协议；`scripts/qa/benchmark-vault/AGENTS.md` 是合成基准 vault 的协议，一动那个目录就被注入全文）。**守卫：`node scripts/check-agent-instructions.mjs`**——除根 `AGENTS.md` 外一律拒绝，"一个都没找到"也算失败。修法是**改源文件名**（安装名由清单映射），不是删文件，也不能只是"记得别打开它"。
- 完整清单见 `docs/handoff.md` §4（69 条）——改动前扫一遍与你要动的东西相关的条目。

## 7. 提交信息与工作方式

- 提交信息用 `<type>(<scope>): <中文说明>`（`feat` / `fix` / `ci` / `docs` / `refactor` / `test`），一条提交做一件事。
- 改动的**理由**写进提交信息或 `docs/changelog.md`，不要只留代码。
- 不要 `git push`、不要打 tag、不要发布——这些是用户的动作。
- 不要触碰真实 vault，不要跑 live 验收（除用户明确要求）。
