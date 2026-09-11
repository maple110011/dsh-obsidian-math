# 环境变量（单一参考）

> **这份文件是什么**：本仓库读的所有环境变量的**唯一权威清单**。
> **为什么需要它**：这些变量此前只散落在代码里——11 个 `DSH_*` 分布在 9 个文件、还夹着**三对别名**（新旧名字各读一次）、以及**一个从未被任何代码读取的死开关**（`DSH_MATH_MEMORY_ENABLED`）。维护者要回答"这个变量是干嘛的、新名还是旧名优先、能不能删"只能去 grep。
> **怎么保证不腐烂**：`node scripts/check-env-vars.mjs`（进 `npm test`）从**代码**里提取所有 `process.env.*` 读取，与本文件的表格双向核对——**代码里读了但没写下来 → 失败；写下来了却没代码读 → 失败；标成死开关却又被读 → 失败**。所以本文件的数字来自代码，不是回忆。

## 1. 产品变量（用户会设的）

> **这个「谁读」列按组件写，不逐个列文件名**——文件名清单是典型的腐烂源（本表初稿就把 `DSH_HOME` 的读取方写错成 `cordis.patch.yml`，还漏了 4 个脚本）。**精确的调用点**跑 `node scripts/check-env-vars.mjs --list` 得到（守卫 walk 文件系统提取，不是 grep）。

| 变量 | 谁读（按组件） | 作用 | 默认 / 优先级 |
|---|---|---|---|
| `DSH_HOME` | dsh 运行时（`preset` / `host` / `install`）+ Obsidian 插件 + 部署与 QA 脚本 | dsh 的安装根（profile / 会话 / 全局配置都在它下面） | 默认 `~/.dsh`（Windows：`%USERPROFILE%\.dsh`） |
| `DSH_WORKSPACE_ROOT` | 记忆引擎（`preset`）+ 面板（`host`）+ profile 装配 + 路由回归与 QA 探针 | **当前工作区（vault）根**。记忆的读写、路径包含检查、会话归属判断都以它为锚 | **首选**；缺省回退 `DSH_OBSIDIAN_VAULT` |
| `DSH_OBSIDIAN_VAULT` | 同 `DSH_WORKSPACE_ROOT`（外加侧栏性能探针） | `DSH_WORKSPACE_ROOT` 的**旧名**，保留兼容 | **回退项**——新名优先，二者同时设置时旧名被忽略 |
| `DSH_SESSIONS_ROOT` | 记忆引擎（`preset`）+ 面板（`host`） | 会话日志根目录（捕获与对话索引的数据源） | 默认 `<DSH_HOME>/sessions`；也可由 preset 配置 `sessionsRoot` 提供 |
| `DSH_PERMISSION_MODE` | profile 装配（`dsh/profile/cordis.patch.yml`） | 沙箱审批模式 | 默认 `workspace-write`；`danger-full-access` 只**重开提权询问**，沙箱本身不变 |
| `DSH_NODE_BIN` | Obsidian 插件（启动 dsh 时） | 启动 dsh 时使用的 node 可执行文件 | 默认走 PATH 里的 `node` |
| `DSH_MATH_MEMORY_LINK_URL` | 记忆引擎（`preset`，注入系统提示） | 回复里笔记链接与反馈链接的基址（如 `http://127.0.0.1:3180`） | **首选**；缺省回退 `DSH_OBSIDIAN_LINK_URL` |
| `DSH_OBSIDIAN_LINK_URL` | 记忆引擎（`preset`）+ 回归套件 | 上者的**旧名** | **回退项** |
| `DSH_MATH_MEMORY_FEEDBACK_TOKEN` | 记忆引擎（`preset`） | 反馈链接的 CSRF token | **首选**；缺省回退 `DSH_OBSIDIAN_FEEDBACK_TOKEN` |
| `DSH_OBSIDIAN_FEEDBACK_TOKEN` | 记忆引擎（`preset`）+ 面板（`host`）+ 回归套件 | 上者的**旧名**。**两侧都接受这一对（新名优先）**，所以谁在线上都行——2026-09-11 之前面板**只读旧名**，改名只做了一半（见 §4 的历史记录） | **回退项** |

### 别名与优先级纪律

三对别名的规则一致：**新名优先，旧名回退**（`新 ?? 旧`）。

> **为什么单列一条纪律**：这个顺序曾经**被写反过**——两个 QA 探针（`scripts/qa/engine-probe.mjs`、`scripts/qa/e2e.mjs`）此前写成 `DSH_OBSIDIAN_VAULT || DSH_WORKSPACE_ROOT`，于是"给产品设了新名"的机器上，探针在给**另一个 vault** 打分（2026-09-11 审查 P1-8，已对齐）。**新增读取点时不要自己重排顺序**，复制上面表格里的现有写法。

## 2. 开发 / 验收变量

| 变量 | 谁读（按组件） | 作用 | 默认 |
|---|---|---|---|
| `DSH_BIN` | QA 端到端（`scripts/qa/e2e.mjs`） | 真实 dsh 的 **JS 入口**（`npm run qa:e2e` 用；不设则 SKIP） | 无（未设即跳过真实 E2E） |
| `BENCHMARK_VAULT` | QA 种子探针（`scripts/qa/seed-probe.mjs`） | 仿真 vault 路径 | `scripts/qa/benchmark-vault` |
| `CHROME_PATH` | 侧栏性能探针 | 侧栏性能探针用的 Chromium/Edge 可执行文件 | Edge 默认安装路径 |
| `APPDATA` | Obsidian 插件 + 两个脚本 | **平台变量**：定位全局 npm 安装目录（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`） | 无（Windows 上由系统提供） |
| `USERPROFILE` | 侧栏性能探针 | **平台变量**：推导 `DSH_HOME` 默认值 | 无（Windows 上由系统提供） |

## 3. 死开关（不要实现它，也不要以为设了有用）

| 变量 | 谁读 | 作用 | 默认 / 优先级 |
|---|---|---|---|
| `DSH_MATH_MEMORY_ENABLED` | **无——全仓零读取** | 曾被描述为"进程级最后兜底开关"（`docs/archive/REFACTOR-PLAN.md:164`），但**从未实现**。设了它不会有任何效果 | 不适用 |

**处置**：不删文档、不实现它，而是把它**记在这里**——真正生效的总开关是工作区级的 `.deepseek/config.md` 里 `enabled:`（见 `docs/memory/control-panel.md`）。删除 `REFACTOR-PLAN` 里那句描述的代价大于收益（那是历史档案，已就地加更正）。**若将来要实现它**：实现的那一刻本文件的守卫会失败（"标成死开关却又被读"），必须先来改这一行。

## 4. 已知缺口（登记在 `handoff.md` §7）

- **（已修，2026-09-11）反馈 token 的改名曾只做一半**：preset 侧读 `新 ?? 旧`，而 `math-memory-panel.mjs` 的校验**只读旧名**——于是无论插件注入哪个名字，总有一侧看不见它。现在**两侧读同一对、同一顺序**，并且 **Obsidian 插件同时注入两个名字**（插件与 npm 包可以分别升级，只发新名会打断旧消费者）。回归套件新增 3 项：新名单独生效、新名在只设它时被强制、**两个名字都设时新名优先**（`test-panel-routes.mjs` §4b）。**保留在文档里**是因为它是"半途改名"的样本：两侧各读各的名字时，**偏好顺序**就变成了隐式契约。
- **`DSH_PERMISSION_MODE` 的取值没有校验**：任何非 `danger-full-access` 的值都等同 `workspace-write`（fail-closed，符合预期，但拼错时不会提示）。

## 5. 与本文档相关的守卫

| 守卫 | 管什么 |
|---|---|
| `scripts/check-env-vars.mjs` | 代码读取 ↔ 本文件表格的双向一致（含死开关的反向检查）；`--list` 打印**从代码提取**的清单与每个变量的读取点 |
| `scripts/check-rename.mjs` | 已退役的**旧产品名**不得出现在活文件里（字面量由该守卫持有，本文不重复它） |
| `scripts/check-skin-fallback.mjs` | profile 里 `@linxin666` 挂载必须落在降级块内（环境变量缺失时的可启动性） |
