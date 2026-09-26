# 解耦评估：记忆系统与 Obsidian↔dsh 两侧的耦合（2026-09-26）

> **状态**：调研结论 + 提案。本文**不改任何代码**，只做只读取证与方案比较。
> **回答了什么问题**：记忆系统耦合度是否过高？Obsidian 侧与 dsh 侧缠在一起的地方有哪些、有多深？能不能解耦、先解哪一处？
> **一句话结论**：**耦合确实高，但高的不是"记忆数据"，是"同一份引擎源码 + 同一套文件/行/环境变量契约被三份产物各自持有一份拷贝"**。可解耦；且"最该先解"的那一处不是引擎重复，而是 **profile 清单（`package.json`）缺 `version` 会让每一轮回复都失败**——它已经在真机上发生过一次（`docs/handoff.md` 坑 100）。
> **被测状态**：仓库 `b29c566`，读数时工作树只有一个未提交改动（`scripts/test-agent-preset.mjs`，非本次改动）。**读数之后仓库被并行会话继续修改**（见下条）。
> **一个必须说明的时间差**：本次调研开始时（`git status` 只显示 `scripts/test-agent-preset.mjs` 一个改动），任务书引用的 `docs/bundle-channel-plan-2026-09-26.md` **确实不存在**——`git log --all --name-only` 无记录、`git grep HEAD` 无引用、工作树无此文件。调研期间它由**并行的另一个会话**写出（`LastWriteTime 2026-09-26 02:13`，同时出现 `docs/note-noise-and-memory-fidelity-2026-09-26.md` 与 `docs/changelog.md`、`docs/installation.md` 的改动）。因此：**该文件现已存在并且是方案 B 的权威设计**，本文与它的关系是**交叉引用、不重复细节**（§5 方案 B、§6 第 3 步）。它的现场读数（12 个 posture 文件、`owner: direct`、`version: 0.7.8`）与本文 §2.3 **各自独立测出且一致**，可互为佐证。
> **本文的读数时刻**：§2 的数字来自上述文件出现**之前**的那次快照；此后仓库被并行会话继续修改，**本文不代表更晚的树**。

---

## 1. 这次调研做了什么（方法与边界）

| 类别 | 具体做法 | 是否产生副作用 |
|---|---|---|
| 读文档 | `AGENTS.md`、`ARCHITECTURE.md`、`docs/handoff.md`（全文 454 行）、`docs/env-vars.md`、`docs/agent-repo-maintenance.md` 风格参照 | 无 |
| 测尺寸 | `Get-ChildItem`/`Get-Item`/`Get-FileHash`、`npm pack --dry-run --json` | 无（不落盘、不发布） |
| 跑门禁（只读） | `node scripts/check-engine-sync.mjs [--sweep]`、`node scripts/run-gates.mjs --list`、`node scripts/check-env-vars.mjs --list` | 无（这三条只读源码） |
| 看已装产物 | 只读 `%USERPROFILE%\.dsh\profiles\notes-assistant\`（14 个文件） | **只读**，未写入 `$DSH_HOME` |
| 没做 | 未跑会写 `$DSH_HOME` 的 dsh 命令；未碰真实 vault（`D:\Obsidian笔记数据库`）；未改代码；未 commit | — |

**没有跑 `npm test` 全量**：其中多条门禁会启动真 dsh 子进程并写隔离 home 甚至登记工作区（坑 74/91），超出本次"只读"授权。因此下文凡涉及"门禁会拦"的断言，凡未亲自跑过的都标 **未验证**。

---

## 2. 量化底数：同一份引擎源码的"三份"

先给数字（全部来自上面那几条只读命令）：

### 2.1 ① 仓库源码（npm 包/native 通道）

| 项 | 命令 | 结果 |
|---|---|---|
| `dsh/**` 全部文件 | `Get-ChildItem -Recurse -File dsh` | **49 个文件 / 667 272 字节** |
| 其中 `.mjs` | 同上 `-Filter *.mjs` | **18 个 / 517 076 字节** |
| 记忆"引擎六件" | 见 §2.4 | **6 个 / 420 210 字节 / 7 674 行** |
| 最大单文件 | — | `dsh/preset/math-memory.mjs` **227 616 字节 / 3 975 行** |
| npm 包内容 | `npm pack --dry-run --json` | **57 条 / 243 633 字节（压缩）/ 700 716 字节（解包）**，其中 `dsh/` **49 条 / 667 272 字节** |

### 2.2 ② Obsidian 插件 `main.js`（生成物，内嵌 ①）

| 项 | 命令 | 结果 |
|---|---|---|
| `main.js` | `Get-Item main.js` | **732 080 字节 / 3 543 行 / 3 763 个 LF / 0 个 CRLF** |
| 被嵌入的 `dsh/**` 源文件 | `scripts/build-obsidian.mjs:29-45` 的 `EMBEDDED_SOURCES` | **15 个键 / 450 602 字节** |
| 被嵌入的 vault 模板 | `dsh/templates-manifest.json` | **19 个 / 71 567 字节** |
| 插件源码本身 | `obsidian/main.template.js` | **185 880 字节 / 3 543 行** |
| 账面合计 | 450 602 + 71 567 + 185 880 | 708 049 字节；`main.js` 比它多 **24 031 字节**（JSON 双重转义的额外负担） |
| 只有 4 个可嵌入文件**不进**包 | `scripts/build-obsidian.mjs:54-59` 的 `NOT_EMBEDDED` | 4 条（每条都写了理由，且 build 会在漏项时抛错） |

也就是说：**`main.js` 里有一份 450 602 字节的 `dsh/**` 拷贝，占文件体积约 62%**。改 `dsh/**` 而忘记重建 `main.js`，就是"两份引擎行为不同"。

### 2.3 ③ 装好后的 profile 平铺文件（本次实测的本机现场）

| 项 | 命令 | 结果 |
|---|---|---|
| 部署目录 | `Get-ChildItem -File $env:USERPROFILE\.dsh\profiles\notes-assistant` | **14 个文件 / 438 454 字节** |
| 权威清单记录 | `.install-manifest.json` 的 `posture` | **12 项 / 431 218 字节**（`owner: "direct"`、`version: 0.7.8`、`installedAt: 2026-09-25T17:36:49.800Z`） |
| 与仓库的哈希比对 | `Get-FileHash`（SHA256，逐个比） | **12 项里 4 项已漂移**：`math-memory.mjs` −4 147 字节、`note-tools.mjs` −1 760 字节、`cordis.patch.yml` **+80 字节**、`package.json` **+287 字节**；其余 8 项一致 |

这 4 项漂移**不是缺陷**，但它们正是"第三份"的本质：现场那份由**上一次**安装写下，只有重新引导/安装才会追上仓库。`+287 字节` 的 `package.json` 就是历史事故（坑 100："有 name、缺 version"）之后被 `repairProfileManifestFile()` 补过的痕迹。

### 2.4 引擎重复的规模（①内部）

| 文件 | 字节 | 行数 | 角色 |
|---|---|---|---|
| `dsh/preset/math-memory.mjs` | 227 616 | 3 975 | preset 侧引擎（注入/检索/捕获/蒸馏） |
| `dsh/host/memory-admin.mjs` | 76 178 | 1 567 | host 侧引擎（维护/归档/体检/会话捕获） |
| `dsh/preset/note-tools.mjs` | 92 370 | 1 652 | 笔记工具（BM25 + `note_*`） |
| `dsh/host/math-memory-panel.mjs` | 14 838 | 282 | 面板宿主半（`/memory-panel/*`） |
| `dsh/preset/hook-frontmatter.mjs` | 6 139 | 139 | frontmatter 边界（唯一权威） |
| `dsh/preset/engine-shared.mjs` | 3 069 | 59 | 已合并的共享助手（2 个助手） |
| **合计** | **420 210** | **7 674** | — |

### 2.5 共享符号的实测状态（`check-engine-sync.mjs`，本机实跑）

```
node scripts/check-engine-sync.mjs
  → dsh/preset/math-memory.mjs declares top-level symbols (154)
  → dsh/host/memory-admin.mjs declares top-level symbols (59)
  → 共享清单：23 个同名符号 = 17 同步 + 6 条有记录的偏离
  → 2/2 改名重复已承认，0 条过期，无新增
  → exit 0

node scripts/check-engine-sync.mjs --sweep
  → threshold 0.70, min tokens 30, 3225 cross-name engine pairs, 3 shared-module declarations
  → 最高分：0.844 decodeZstdSessionLog ↔ decodeSessionLog
            0.792 runSessionCapture ↔ scanSessionCapture
            0.662 parseLocalDay ↔ daysSinceText（断层下方）
```

**注意一个数字对不上的地方**：`AGENTS.md` §3.3 与 `check-engine-sync.mjs:344` 的注释都写"实测 3537 对跨名配对"，而本机实跑是 **3225 对**。差值 312 来自"过滤掉 token 数 < 30 的短声明"这一层之后的可变基数——**注释里的数字已经过期**，属于本文第 4 节 C6 类（文档锚在会变的量上）。这是我实测到的、不是推断的。

### 2.6 门禁面（耦合的"护栏"有多厚）

```
node scripts/run-gates.mjs --list  →  50 条
```

其中**直接为"两侧契约同步"而存在**的 30 条：

| 门禁 | 守的是哪条缝 |
|---|---|
| `check: engine sync (preset vs host)` | 23 个同名符号 + 跨名 token-shape + 共享模块再声明 |
| `check: preset body lists agree` | 4 份清单（权威 `PRESET_BODY_FILES`）+ 两个通道的 `name` 形态 |
| `check: preset declaration is current` | 生成块与 `agent.cordis.yml` 一致 |
| `check: frontmatter single source` | 宿主那份拷贝必须行为等价（13 fixture） |
| `check: embedded loader` / `embedded writers` | `new Function` 注入的参数表/导出白名单 + 嵌入体逐字节 |
| `check: main.js bundle freshness` / `client bundle freshness` | 生成物是否过期（逐字节，含 CRLF 归一化） |
| `check: client package layout` | 客户端半个真的能 `import()`（两个宿主半分支各一次） |
| `check: shipped yaml parses` | overlay 真的能解析（坑 88） |
| `check: config scaffold parity` | 面板兜底字面量 == `dsh/templates/config.md` |
| `check: env vars vs docs/env-vars.md` | 15 个变量双向一致（含死开关反向检查） |
| `check: channel ownership anchor` | 三条安装通道的归属锚点优先级 |
| `check: version consistency` | 五处版本 + tag |
| `check: plugin manifest meta` / `release artifact paths` / `plugin id` | 发布面形状 |
| `check: readme pair` / `doc consistency` / `doc counts` / `doc constants` | 文档侧锚点 |
| 其余（`skins fallback`、`patch yaml`、`agent instructions`、`drop-to-mention`、`tool schemas`、`panel routes`、`panel proxy`、`panel auth`、`panel present`、`installer e2e`、`link server`、`agent preset mounts`、`self-provisioned profile`） | 各条运行时接口 |

**这是本次评估最重要的一个观察**：50 条门禁里有 30 条（60%）的存在理由就是"防止两侧漂移"。**护栏的厚度本身就是耦合深度的读数**——一个不需要同步的系统不需要 30 条同步守卫。

---

## 3. 耦合在哪、有多深（六类清单）

### C1 源码重复：同一份引擎存在三处

- **证据**：§2.1/2.2/2.3 的字节数；`scripts/build-obsidian.mjs:29-45`（15 个嵌入键）；`dsh/preset/preset-deploy.mjs:52`（`PRESET_BODY_FILES` 4 项）；`obsidian/main.template.js:1864-1870`（`DIRECT_PROFILE_FILES` 12 项）；`dsh/install.mjs:91-110`（`DIRECT_PROFILE_BASE` 9 项 + 从权威清单派生）。
- **量化**：**3 份**；① 49 文件/667 272 字节；② 内嵌 15 源/450 602 字节，占 `main.js`（732 080）约 62%；③ 现场 12 文件/431 218 字节。共享符号 **23**（17 同步 + 6 偏离），改名重复 **2**（分数 0.844/0.792，阈值 0.70）。
- **深度**：**深，但已被守住**。真正的风险不是"有两份"，而是"改了 A 忘了 B"——`check: engine sync` + `check: embedded writers` + `check: main.js bundle freshness` 三条已经覆盖到字节级与词法级。**未覆盖的那一段**见 D2。

### C2 布局与文件契约：谁铺哪些文件、铺到哪、哪一行长什么样

- **证据**：
  - 插件写 dsh 的 profile：`obsidian/main.template.js:1876`（`bootstrapDshConfig`）内 **11 次 `ensureFile()`** 调用（1896–1929 行），覆盖 package/cordis/patch/pnpm/workspace/panel/admin/frontmatter/engine-shared/math-memory/note-tools；
  - 归属锚点：同文件 `1935-1942` 写 `<profile>/.install-manifest.json`（`owner/version/installedAt/profile/posture/vaults`）；读侧优先序在 `dsh/host/channel-owner.mjs:41`（`CHANNEL_MANIFEST`）；
  - overlay 文件名与形态：插件用 `--patch <profile>/notes-assistant.patch.yml` 启动（`main.template.js:1503`、`1538`），而**这份 overlay 每次起服务都被插件从内嵌副本重写**（`buildNotesAssistantPatch`，`1822`）；
  - 生成块：`dsh/profile/notes-assistant.patch.yml:56-176`（`./name` 形态）与 `dsh/cordis.patch.yml`（包内 specifier 形态）由 `scripts/build-preset-declaration.mjs` 从 `dsh/preset/agent.cordis.yml` 生成；
  - 退役回退：`.agent-presets/<id>/.owner.json`（`main.template.js:1890`）仅作回退读、不再写。
- **量化**：profile 文件清单**权威 1 份（4 项）+ 派生 2 份（9+4→12 项）+ 插件内硬编码 1 份（12 项）**，共计 **4 处**提到文件名（坑 96 的形态，其中一处已改为 import 派生）；overlay 文件 **2 个**（`cordis.patch.yml` / `notes-assistant.patch.yml`），只有后者在真启动路径上（坑 94）；被写入 profile 的文件 **12 个**。
- **深度**：**最深的一类**。它不是"两份代码"，是"四份文件名清单 + 两条 overlay 路径 + 一个归属锚点"要在三个时间点（引导时、每次起服务时、安装时）保持一致。

### C3 运行时接口：插件直接调用 dsh 的内部形状

- **证据**（插件依赖 dsh 的哪些"不是 API 的东西"）：
  - `dsh plugin` CLI：`main.template.js:1785`（`['plugin','--profile',PRESET_NAME,'add',...specs]`）、`1788`（`spawn('dsh', args, {env:{...process.env, DSH_HOME: home}})`）；
  - 启动参数与 URL/token：`1538-1539`（`--profile … --patch … --no-open --port 0`）、`112-131`（`probeService` 三态 `ready/unauthorized/down`）、`1546`（`spawn` + `stdio:['ignore','pipe','pipe']` 抓 stdout 里的 token）；
  - 反代：`class DshWebProxy`（`main.template.js:783`），`195`（`isMemoryPanelPath`）、`1140`（对 `/memory-panel/*` 盖 `x-dsh-token`）、`1188`/`1284`（`httpRequest`，坑 28 的 `setHost:false` 约束）；
  - 会话日志格式 V4（zstd、多代并存、头行 `version` 字段）：`dsh/preset/math-memory.mjs:354`（`readSessionHeader`）、`627`（`artifactGeneration`）、`428`（`decodeZstdSessionLog`）与 host 侧 `1120`/`1214`/`1087` 的同名/改名对应件；
  - `ctx.workspaceRegistry`：`dsh/host/math-memory-panel.mjs:15`（`inject = ["webServer","workspaceRegistry"]`）、`233`、`241`；`ctx.webServer.register`：`298`；
  - 客户端插件协议（`__ModuleLoader__`、`settings.section` 的 `label`、`ctx.effect`）：见坑 11；产物 `dsh/client-panel/lib/client.js`（21 751 字节）；
  - 路径扫描的私有读：`docs/handoff.md` §7「`math-memory.mjs` 的 `session.messages` 分支是死代码」一条记录：对 `session.log`（TS `private`、运行时存在）的直读是绕过公开 API 的私有读。
- **量化**：插件对 dsh 的**协议级依赖点**（按上列证据逐条数）**≥ 8 处**：CLI 动词 `plugin add`、`--profile/--patch/--port/--no-open` 四个参数、启动 stdout 的 token 行、`dsh-auth-<sha256(host:port)>` cookie 名、会话日志 V4 的 zstd 帧与头行、`ctx.workspaceRegistry.list()` 的 `{id,path,title}` 形状、`ctx.webServer.register({kind:'prefix',path})`、`settings.section` 的 `{name,id,order,label}`。另有 **9 条 `/memory-panel/*` 路由**（`dsh/host/math-memory-panel.mjs` 内 10 处字面量）在两侧手写。
- **深度**：**深且大部分必要**（见 §4）。这些是"dsh 就是这样设计的边界"，插件只能适配，但**适配方式可以更薄**：现在每一条都被插件"自己实现一遍"（三态探测、cookie 兑换、token 猜测），而不是依赖 dsh 的公开出口。

### C4 版本与生命周期

- **证据**：五处版本（`package.json:3` / `package-lock.json` / `manifest.json:4` / `versions.json` / `CHANGELOG.md`）由 `scripts/check-version-consistency.mjs:42-84` 钉住；引擎要求 `package.json:51-57`（`dsh.engines.dsh: ">=0.1.7-rc.2"` + `peerDependencies["@deepseek-ai/dsh"]`）；现场 manifest 的 `version: 0.7.8` 由插件在 `main.template.js:1937` 写。
- **量化**：**5 处版本 + 1 个 tag + 2 处引擎约束（`engines` + `peerDependencies`，值重复）**；`.mjs` 里还有 2 处硬编码的消息前缀（`math-memory:` / `session-capture:`，见 `KNOWN_DIVERGENT.scanZstdFrames`）。
- **深度**：中等。版本是**单一数字**，护栏足够；真正的风险在**"装了但没生效"**（下面的 C2/C6）。已实测的两次现场事故都是这类：坑 94（声明在 `cordis.patch.yml` 却不在真启动的 `--patch` 里）、坑 100（清单缺 `version`）。

### C5 进程与端口

- **证据**：dsh 退到 `--port 0` 内部端口，**代理占据用户配置端口**（`main.template.js:1537-1539`）；端口默认 `3180`（`147`）；面板 URL 默认 `http://127.0.0.1:3080/`（`164`）；cookie 名绑定 `host:port`（坑 26/28）；LinkServer 端口/令牌**持久化**在 `data.json`（`177-178`，坑 77）。
- **量化**：**3 个端口角色**（用户配置的公共端口 3180 / dsh 内部随机端口 / 面板 3080）+ 1 个持久化的 LinkServer 端口。`docs/port-and-isolation.md` 已论证"独立 authority 是结构必要的"。
- **深度**：深（cookie 权威不可换端口），但**这是 dsh 的设计约束，不是自找的**。

### C6 文档与锚点

- **证据**：`check-doc-counts.mjs`（陷阱条数 100 / 门禁 50）、`check-doc-consistency.mjs`（断言数从运行期 `__CHECKS__` 读）、`check-doc-constants.mjs`、`check-readme-pair.mjs`。
- **量化**：文档锚点守卫 **4 条**；本文实测到 **1 处已过期**：`check-engine-sync.mjs:344` 与 `AGENTS.md:53` 的"3537 对"（实跑 3225）。
- **深度**：浅，但它是"数字写进文档就会腐烂"的常驻成本。

### 3.7 历史事故的统计口径（本节是 §3 的收尾）

`docs/handoff.md` §4 共 **100 条**陷阱（该节顶部标记行 `> 陷阱条数：100` 由 `check-doc-counts.mjs` 守住）。按下面这条判据逐条筛，得 **46 条**（46%）。判据是：把两侧中任一方的文件、字段名、行 id、环境变量、版本号、协议形状改掉一个，这条事故就会（重新）发生。**这 46 条不是均匀分布的**，分成 7 簇：

| 簇 | 条数 | 陷阱编号 | 形态（一句话） |
|---|---|---|---|
| A. 三份拷贝不同步 | **10** | 24, 27, 56, 57, 65, 68, 69, 90, 95, 97 | 改了源没重建/没部署；宿主树不能 import 只能留拷贝；守卫只比自己的名单 |
| B. 契约/枚举未同步 | **10** | 8, 42, 44, 45, 48, 64, 89, 94, 96, 98 | 一侧改了形状，另一侧的枚举/清单/清单消费点没跟上 |
| C. dsh 格式/版本漂移 | **9** | 11, 12, 13, 19, 20, 26, 28, 70, 92 | 上游改了字段名/schema/格式/协议，我们静默失效 |
| D. Profile 生命周期 | **6** | 7, 10, 36, 37, 75, 100 | overlay 被覆盖、版本号缺一处、两半生效时机不同 |
| E. 两侧命名/偏好不一致 | **5** | 79, 80, 82, 93, 99 | 命名不一致、文档承诺无执行点、兜底前提失效 |
| F. 文档/锚点腐烂 | **4** | 9, 87, 91, 100※ | 缓存版本、上限含包装、探针污染（与 D 簇有重叠） |
| G. 环境变量 | **2** | 77, 62 | 端口/令牌注入提示、约束根由环境变量决定 |

> ※ 上表按"**事故的根因**"归类，一条只进一簇，合计 **A10+B10+C9+D6+E5+F4+G2 = 46 条**。坑 100 同时有"配置面"（D 簇）与"文档面"（F 簇）两个可观察角度，这里**只按配置面计入 D 簇**，F 簇那条是它的文档侧观察，不重复计数——所以**去重后的准确数字是 46 条**，不是 47。**这个数字本身就是本次评估的关键证据**：仓库已经积累了 30 条同步守卫，历史事故里仍有 **46%** 可以从"两侧契约不同步"这条路走通。
>
> ⚠️ **口径的可疑处（2026-09-26 复核补记，由 Lead 补）**：这 46 是**人工逐条归类**的结果，宽严一变数字就会变；**可复核的 artefact 是上面那张簇表的编号，不是这个百分比**。复核抽查了三条：坑 24（"插件内嵌的那份 `memory-admin.mjs` 才是真正跑的代码"）与坑 89（"包装进了 `node_modules`，却没有任何 loader 挂载它"）归类准确 ✓；坑 44（"写完就当成功"）属**边界归类**——它本身是校验纪律问题，只有在"面板显示开启而引擎关闭"这种消费点不同步的角度才落进 B 簇。⇒ 引用时请写成"**约 46 条（判据见 3.7）**"，或直接引用簇表编号。

---

## 4. 哪些耦合是必要的，哪些是自找的

| 耦合 | 判定 | 理由 |
|---|---|---|
| dsh 的 CLI 动词与参数（`plugin add`、`--profile/--patch/--port/--no-open`） | **必要**（只能适配） | 这是 dsh 的公开入口，没有替代品 |
| 启动 stdout 的 token + `dsh-auth-<sha256(host:port)>` cookie 名 | **必要** | 坑 26/28 已经证过：SameSite=Strict + 跨站 iframe，除了主进程反代没有第二条路 |
| 会话日志 V4（zstd 多帧、多代并存、头行 `version`） | **必要** | 它是"跨会话记忆"的数据源，不读就没有这个功能 |
| `ctx.workspaceRegistry` / `ctx.webServer.register` / `settings.section` | **必要** | 宿主的插件契约 |
| **同一份引擎存在三份** | **一半自找** | ②（`main.js` 内嵌）是"单文件分发"的代价，③（profile 平铺）是"离线通道"的代价——两者都**必要**；但**"三份都靠人手同步"是自找的**：② 已经有逐字节守卫，③ **没有哈希守卫**（本次实测 12 项里 4 项漂移，没有任何门禁会因此红） |
| **四份文件名清单** | **自找** | 权威只需一份（`PRESET_BODY_FILES`），其余应当派生。`dsh/install.mjs` 已经改成派生（`107-110`），**插件里那份还是硬编码字面量**（`main.template.js:1864-1870`） |
| **preset 声明挂在插件每次重写的 overlay 里** | **自找** | 坑 89/94 的共同形态：谁重写谁就是权威，而"每次启动重写"让声明随时可能被旧插件副本擦掉。`handoff.md` §7 已把它列为待改项 |
| **插件自己实现三态探测 + cookie 兑换 + token 猜测** | **自找（可收窄）** | 适配是必要的，但"适配代码住在插件里"不是；见方案 B |
| **版本号 5 处 + 引擎约束 2 处** | **必要**（体积小） | 发布链路的客观要求 |
| 端口三分角色 | **必要** | `docs/port-and-isolation.md` 已论证 |

一句话：**数据层的耦合（记忆文件的文件契约，`ARCHITECTURE.md` §3）本来就是设计**，写读分离、hook schema 版本化，这部分不是问题。**问题全在"代码与安装产物的分发层"**。

---

## 5. 解耦方案（4 个粒度）

四个方案可以叠加，不是互斥的。每个都按"改哪些文件 / 门禁怎么改 / 变异验证怎么做 / 预计影响面"写。

### 方案 A — 契约化：把散落的常量收敛成一份机器可读契约 —— ✅ **已落地第一刀（2026-09-26，B2）**：`dsh/preset/profile-contract.mjs` + 门禁 `check: profile contract is the single source`（1 读 + 6 钉 + 4 次变异）。**未做**：`env` 字段、把引导清单与面板路由改成**读**契约（现为钉住）。

**目标**：把"文件清单、overlay 行 id、env 名、路由、版本要求"从**代码字面量**变成**数据文件**，两侧和门禁都断言它。

- **新增**：`dsh/contract/profile-contract.json`（或 `.mjs`，便于门禁 import）。字段建议：
  ```json
  {
    "profile": "notes-assistant",
    "presetBodyFiles": ["math-memory.mjs","note-tools.mjs","hook-frontmatter.mjs","engine-shared.mjs"],
    "hostFiles": ["memory-admin.mjs","math-memory-panel.mjs"],
    "shimFiles": ["hook-frontmatter.mjs","engine-shared.mjs"],
    "scaffoldFiles": ["package.json","cordis.yml","cordis.patch.yml","pnpm-workspace.yaml"],
    "overlays": { "startup": "notes-assistant.patch.yml", "scaffold": "cordis.patch.yml" },
    "overlayRows": ["math-memory-workspace","math-memory-panel","math-memory-client-panel","preset-notes-assistant"],
    "env": ["DSH_HOME","DSH_WORKSPACE_ROOT","DSH_SESSIONS_ROOT", "..."],
    "routes": ["/memory-panel/state","/memory-panel/workspaces", "..."],
    "engineRequires": ">=0.1.7-rc.2"
  }
  ```
- **改哪些文件**：新增 1 个契约文件；`dsh/preset/preset-deploy.mjs`（`PRESET_BODY_FILES` 改为从契约读，保留同名导出以不破坏 4 处 import）；`obsidian/main.template.js:1864-1870` 的 `DIRECT_PROFILE_FILES` 改为**编译期注入**（build 把契约塞进内嵌 map，插件不手写字面量）；`dsh/install.mjs:91-101` 的 `DIRECT_PROFILE_BASE` 同样派生；`dsh/host/math-memory-panel.mjs` 的路由字面量改为从契约表注册。
- **门禁怎么改**：新增 `check: profile contract is the single source`——(1) 断言 `PRESET_BODY_FILES`/`DIRECT_PROFILE_FILES`/插件内嵌清单**三者的集合都等于契约**；(2) 断言契约里的 `overlayRows` 与两个生成 patch 里真实出现的行 id 相等；(3) 断言契约里的 `routes` 与 `math-memory-panel.mjs` 实际注册的路由集合相等；(4) 断言契约里的 `env` 与 `check-env-vars.mjs` 从代码提取的清单相等（可让后者直接复用契约）。
- **变异验证**：分别做 4 次 —— ① 从契约里删一个 `presetBodyFiles` 项 → 红；② 把某个 overlay 行 id 改名（只改 patch 不改契约）→ 红；③ 删一条路由注册 → 红；④ 在代码里新增一处 `process.env.DSH_NEW` 但不动契约 → 红。四次都要 `git diff` 归零后确认恢复。
- **预计影响面**：改写 **4 处清单 + 1 处路由表**（约 60 行），影响 `dsh/preset/preset-deploy.mjs`、`dsh/install.mjs`、`obsidian/main.template.js`、`dsh/host/math-memory-panel.mjs` + `main.js` 重建（732 080 字节会小幅变大）；**门禁净增 1 条、覆盖面扩大到 30+ 条同步守卫的公共上游**。
- **不解决**：三份引擎源码（那是方案 D 的事）。

### 方案 B — 所有权转移：让 dsh 侧自己的安装器负责，插件只调用

**目标**：插件不再往 profile 里铺文件、不再自己拼 `--patch`，改成"调 dsh 自己的机制"。

- **与已有设计的关系**：**本节与 [`docs/bundle-channel-plan-2026-09-26.md`](bundle-channel-plan-2026-09-26.md) 的 A′ 是同一件事的两个面，细节以那份为准**。A′ 回答"离线通道怎么物化一个真正的 dsh bundle 包（`<profile>/.dsh-math-memory/` staging + `dsh plugin add <本地目录>`），让插件出现在 dsh 插件管理页且可启用/禁用/移除"；本节只回答**所有权边界**：`docs/dsh-native-refactor.md` 已定下 **capability 走 `dsh plugin`、posture 留安装程序**，而 A′ 是它的收口。**本文不重复 A′ 的包内文件清单、staging 路径与 `package.json` 字段设计**；两份文档共用同一个判据——**"谁重写这份文件，谁就不是它的作者"**。本节只加一条 A′ 未展开的约束：**插件不再知道**任何文件名/行 id（见下方接口边界），A′ 的 staging 目录名与 `dsh.profile.bundles` 声明同样**不得**出现在 `obsidian/main.template.js` 的字面量里，应由同一个注入式 reader 提供。
- **接口边界**（只定边界，不重复细节）：
  - 插件 → npm 包：`node <pkg>/dsh/install.mjs install --direct --vault <vault> --dsh-home <home>`（一条命令，退出码 + stdout 的 `{written, planned}`）；
  - 插件 → dsh：`dsh plugin --profile notes-assistant add dsh-math-memory`（已在使用，`main.template.js:1785`）；
  - 插件**不再**知道：`DIRECT_PROFILE_FILES`、overlay 文件名、preset 体文件清单、归属锚点的字段名。它只读 `.install-manifest.json` 的 `owner/version` 做冲突提示。
- **改哪些文件**：`obsidian/main.template.js`（删 `DIRECT_PROFILE_FILES` 与 11 处 `ensureFile`，改为"若离线则调用安装器，否则调 `dsh plugin add`"；约 −80 行）；`dsh/install.mjs`（`--direct` 分支补 `--vault` 必填校验与幂等）；`dsh/host/channel-owner.mjs`（不动，它已经是锚点的唯一家）。
- **门禁怎么改**：`check-preset-body-lists.mjs` 里"插件模板必须声明 `DIRECT_PROFILE_FILES`"那三条（`check-preset-body-lists.mjs:97-111`）**整体删除并改写**为"插件不再持有清单"的**反向断言**（出现该字面量即红）；`test-installer.mjs` 增加"插件走的这条命令真的产出可启动 profile"（可与 `test: self-provisioned profile accepts a session` 共用夹具）。
- **变异验证**：把清单字面量塞回模板 → 反向断言红；把 `--direct` 的 `--vault` 去掉 → 安装器门禁红。
- **预计影响面**：**这是最大的改动**（插件减少约 80 行、`main.js` 缩小），风险集中在"插件的失败路径"（安装器不可用、pnpm 不可用 → 必须仍能离线跑）。建议在 A 之后做，因为它需要 A 的契约当输入。
- **收益**：直接砍掉 C2 类事故的一整簇（坑 89/94/96 都是"插件与安装器两个人都在写同一份文件"）。

### 方案 C — 进程/接口边界：面板不再直接 import 引擎

**目标**：把"Obsidian 设置页的记忆面板"与"dsh web 面板"统一成**一个 HTTP 客户端**，两侧都不直接持有引擎。

- **现状**：Obsidian 侧是**嵌入 loader 直接求值 `memory-admin.mjs`**（`main.template.js:78-137`，含 14 个注入绑定与 20 个导出白名单），dsh 侧是 `math-memory-panel.mjs` 走 HTTP。也就是说**同一个能力在 Obsidian 里有两条路**：设置页直接 import 引擎，侧栏 iframe 走 3080 的 HTTP 面板。
- **方案**：Obsidian 设置页的记忆面板改为**反向调用本插件已经建好的反代**（`DshWebProxy` 已经在转发 `/memory-panel/*` 并盖 `x-dsh-token`，`main.template.js:1140`），即"面板 = HTTP 客户端"，不再 `new Function` 求值引擎。
- **改哪些文件**：`obsidian/main.template.js`（删 `MEMORY_ADMIN` loader 与 `MEMORY_ADMIN.*` 的 20 个再导出，改为一个 `memoryPanelClient`；**注意**：LinkServer 的反馈写回与归档也可以走同一批路由）；`dsh/host/math-memory-panel.mjs`（补上目前只在插件里用的两个动作，若缺）。
- **代价/风险（必须说清）**：
  - **收益**：`check-embedded-loader.mjs`（278 行）与 `check-embedded-writers.mjs`（111 行）可以退役——它们存在的唯一理由就是"引擎被求值进插件"；`main.js` 会**掉约 76 KB**（`memory-admin.mjs` 的嵌入体）。
  - **风险**：面板从"进程内调用"变成"依赖 dsh 服务在跑"。**当前 Obsidian 面板在服务没起来时仍可用**（它直接读 vault 文件），改完就不可用了。这需要用户拍板（D3）。
  - **附带**：坑 24（改了 `memory-admin.mjs` 必须重建 `main.js`）会随 `main.js` 里那份拷贝一起消失。
- **门禁怎么改**：退役两条 embedded 守卫；`check-embedded-writers` 覆盖的"嵌入产物真的能跑"改由 `check: client package layout`（已在真的 `import()`）承接。
- **变异验证**：改 `memory-admin.mjs` 的一个写入行为 → 面板路由的回归（`test-panel-routes.mjs` 53 项）必须红；这条变异正是"如果面板走 HTTP，引擎漂移就一定被路由回归看见"的证明。
- **预计影响面**：插件 −76 KB 引擎 + −120 行 loader/再导出；两条门禁退役；**用户可见的行为变化**只有一条（服务未启动时面板不可用）。

### 方案 D — 减少"三份源码"：指定唯一权威

| 那一份 | 应当是什么 | 怎么保证 |
|---|---|---|
| ① `dsh/**` 源文件 | **唯一权威**（保持现状） | `git` + 所有单测 |
| ② `main.js` 内嵌 | **生成物**，只读 | 已有：`check-bundle-freshness`（逐字节）+ `check-embedded-writers`（`memory-admin.mjs` 逐字节）——**建议扩展到全部 15 个键**，现在只逐字节比了 1 个 |
| ③ profile 平铺文件 | **生成物**，只读 | **缺**：本次实测 12 项里 4 项漂移而不红。建议：`install.mjs status` 增加 `--verify`（逐文件哈希对比 `.install-manifest.json` 里记录的摘要），并把摘要写进 manifest |

- **③ 的具体做法**：`dsh/install.mjs` 写 manifest 时同时记 `files: { "math-memory.mjs": "<sha256>" }`；`status` 逐项比对；`test-installer.mjs` 增加"改一个字节 → status 报漂移"的断言。
- **底线（"哪一份应当是唯一权威"的答案）**：**权威永远是 ①；②③ 必须是可重建、可比对、且比对失败会报红的东西。** 现在 ② fulfilled，③ 没有。
- **预计影响面**：manifest 变大（12 项 × 64 字符 ≈ 800 字节）；`install.mjs` +约 30 行；门禁 +1 条断言族。

---

## 6. 推荐路线：先做哪一步，为什么

**第 0 步（✅ 已落地 2026-09-26）：给 ③ 加哈希校验 + 修掉 `3537` 这个过期数字。**
落地形态与本文建议略有出入，**是刻意的**：摘要记在 `.install-manifest.json` 的 `postureDigests`（两个安装器都写），
**硬检查**只判"磁盘 vs manifest 记录"（手改/半截写入/被旧代码覆盖）；而"profile 落后于仓库"做成**提示行**——
滞后在两次部署之间是正常的，做成硬失败会让每个没重装的用户永久飘红。比较对象派生自仓库布局（只比
`dsh/preset|host` 同名文件），不新增第四份清单。实测提示：`落后 2/6 个：math-memory.mjs、note-tools.mjs`。
守卫：`test-installer.mjs` 4 条（含自我变异：篡改→报 drifted→还原清零）+ 真 dsh 门禁 2 条 + 变异 **M23**。
同时 `check-engine-sync.mjs` 与 `AGENTS.md` 里写死的 3537 已改为"跑 `--sweep` 看实跑值"（实测 3225）。
理由：这是**唯一一条"零风险、当场见效"**的动作。本次实测已经证明现场 4/12 项与仓库不一致而**没有任何门禁会红**；`handoff.md` 坑 24 的整个族（"改了没重建/没部署"）在 ③ 这一层目前**完全没有护栏**。同时把 `check-engine-sync.mjs:344` 与 `AGENTS.md:53` 的 3537 改成实跑值（或改成不写具体数字），因为它现在就是"文档锚在会变的量上"的现存实例。

**第 1 步（✅ 已落地 2026-09-26）：迁移 preset 声明出 `notes-assistant.patch.yml`。**
理由：这是**当前最危险的一类事故**的根因，且修法已经被写下来过。危险的那类事故是：

> **"配置在，但不是被读的那一份" —— 症状是会话直接建不出来 / 每一轮回复都失败，而启动日志一行都不说。**

它有四种已实测的形态：坑 94（声明在 `cordis.patch.yml` 却不在真启动的 `--patch` 里）、坑 89（loader 行写进一份被每次重写覆盖的文件）、坑 70（preset 字段 schema 变了没人跟）、坑 100（profile 清单缺 `version`，报 `DeepSeek request extension preparation failed` 且 cause 被包住）。**它们共同的可怕之处是"失败没有指向根因的报错"**：用户看到的是"新建会话没反应"或"每一轮回复都失败"，而日志里没有线索（坑 93 甚至只有一句 `never started`）。修法：把声明生成进 profile 自己的 `cordis.patch.yml`（脚手架文件，插件只在缺失时写、此后不动），让声明与插件版本解耦。

**第 2 步：方案 A（契约化）。**
理由：它是第 3 步的前置，也是 C2 类（占历史事故 10/46）的公共上游。成本可控（约 60 行改写 + 1 条新门禁），收益是**把四条互相盯着的清单收敛成一条**。

**第 3 步：方案 B（所有权转移），与 [`docs/bundle-channel-plan-2026-09-26.md`](bundle-channel-plan-2026-09-26.md) 的 A′ 合流。** ✅ **第一刀已落地（2026-09-26）**：**插件侧不再手写 staging 清单**——它改为构建期注入契约（`__PROFILE_CONTRACT_JSON__`），门禁由 PINNED-5 升级为 READ-2 + READ-2b（后者连"改了契约没重建"一起抓）。**剩余**：面板路由链表化、契约加 `env` 字段。**
理由：它砍掉的是**根**（"两个人都在写同一份文件"），但需要 A 的契约当输入、需要第 1 步先稳定启动路径。**A′ 已经写出了包内文件清单与 staging 路径**，所以这一步的增量只剩"插件侧删掉字面量"。

**方案 C（面板走 HTTP）单独决策**，因为它有唯一一处用户可见的取舍（服务没起来时面板还能不能用）——见 **D2**。

**不建议现在做的**：把 `decodeZstdSessionLog`/`decodeSessionLog` 合并（P2-B 剩下的 1 对）。它的收益是"少 1 对改名重复"，但合并要**参数化解压器**，而这条缝已经被 `KNOWN_ESCAPES` + `KNOWN_DIVERGENT` 两处登记守住（0.844 分，命中即报告）。**在有更危险的耦合没解之前，不值得动它。**

---

## 7. 需要你决定的事项

**D1 — 三份源码里，③（profile 平铺文件）的权威口径怎么定？**
- 选项 A：**保持"生成物 + 哈希校验"**（方案 D 第 0 步）。代价：manifest 变大 ~800 字节、`install.mjs` +30 行。风险：低。
- 选项 B：**取消平铺，强制所有通道走 npm 包内 specifier**（即让离线通道也依赖 `node_modules` 里有包）。代价：离线装机（无网络/no pnpm）不可用，而 Obsidian 引导目前恰恰是那条路。风险：高。
- **我的建议：选 A**。B 会毁掉"离线也能装"这个当前唯一能覆盖 Obsidian 用户的能力。

**D2 — 插件的嵌入 loader 要不要退役（方案 C）？**
- 选项 A：**保留**，继续维护 `check-embedded-loader` + `check-embedded-writers` 两条守卫。代价：每次改 `memory-admin.mjs` 都要重建 `main.js`；`main.js` 多 76 KB。
- 选项 B：**退役**，Obsidian 记忆面板改走 HTTP（反代已经在了）。代价：**服务未启动时面板不可用**（现在是可用的）；LinkServer 的反馈/归档路径要一起迁。
- 选项 C：**折中**——设置页保留进程内读（只读），**写操作**全部走 HTTP 路由。代价：两套路径并存，但"写"这一侧（最容易出坑 44/89 的一侧）被统一。
- **我的建议：选 C**。它把 76 KB 里最危险的那部分（写入器）搬出插件，同时保住"服务没起来也能看记忆"这个真实体验。

**D3 — 第 1 步的"声明搬家"要不要现在就做？**
- 选项 A：现在做（第 1 步）。代价：动 `dsh/profile/cordis.patch.yml` 与生成器、要重跑 preset 门禁；需要真机复验一次冷启动。
- 选项 B：先只加"启动前断言真启动路径里必须有声明"的门禁（现有 `test: agent preset mounts` 已有一条读真实部署 overlay 的断言），搬家留到下一轮。
- **我的建议：选 A**，但**拆成两个提交**：先搬声明 + 加门禁，再删旧位置的生成。理由是它对应的事故形态（静默、无声、每一轮回复都失败）已经真实发生过一次（2026-09-26 实机）。

**D4 — 方案 A 的契约放在哪、用什么格式？**
- 选项 A：`dsh/contract/profile-contract.json`（纯数据）。代价：插件侧要走 build 注入才能读到，多一层生成。
- 选项 B：`dsh/contract/profile-contract.mjs`（可 import 的模块）。代价：`dsh/**` 多一个 `.mjs`，会被 `build-obsidian.mjs:90-100` 的完备性门禁要求嵌入或写 `NOT_EMBEDDED` 理由。
- **我的建议：选 A**。契约是**数据**，不是代码；用 `NOT_EMBEDDED` 的现有机制把它排除在 bundle 之外（它只被门禁和安装器读，插件侧由 build 把常量注入 `EMBEDDED_PRESET` 即可）。

**D5 — "46/100 条陷阱与契约不同步有关"这个统计要不要进 `handoff.md`？**
- 选项 A：**写进 `handoff.md` §4 顶部**作为一条元记录（不改 100 这个数字本身）。代价：多一个会腐烂的数字，需要守卫或改成"按簇引用编号"。
- 选项 B：**只留在本文**，不放 `handoff.md`。代价：下一个 agent 不一定读到。
- **我的建议：选 B**，但按 §3.7 的做法把"簇 → 编号"写成**引用而不是计数**（编号不会腐烂，计数会）。要进 `handoff.md` 就进那份簇表，不要进那个百分比。
