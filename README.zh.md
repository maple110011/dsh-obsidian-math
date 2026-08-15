# DSH Obsidian 数学笔记助手（dsh-obsidian-math）

> 📄 本页为中文文档 · [**English README（Switch to English）**](https://github.com/maple110011/dsh-obsidian-math/blob/main/README.md)

把 DeepSeek Harness 变成一个住在 Obsidian 右侧栏里的长期数学笔记助手。本仓库包含**两个相互配合的组件**：

1. **Obsidian 社区插件**（插件 id `dsh-math-assistant`，仓库根 `manifest.json` + `main.js`）：这是用户入口——右侧栏嵌入 dsh Web UI、自动检测并启动 dsh 服务，并且**首次运行会自动初始化 dsh 侧配置**（`obsidian` agent preset/profile 与 vault 记忆模板）。
2. **dsh 插件**（npm 包 `dsh-obsidian-math`，`dsh/` 目录）：把**同一套** `obsidian` preset/profile 和可选 vault 模板安装进 `$DSH_HOME`。

**两者关系**：写入的 dsh 配置完全相同、幂等、可互换。大多数用户**只装组件 1（Obsidian 插件）就足够**；组件 2 用于“不用 Obsidian 插件、只想要 `dsh --profile obsidian`”的场景，或想用命令行显式安装/更新 dsh 侧配置的场景。

## 为什么做这个插件

数学领域的学习是一项长周期的积累：记号习惯、理论偏好、半成品证明、技巧、反例和各类具有一般性的想法，往往需要持续积累，并在不断打磨中形成一套可以带来知识复利的庞大关联体系。你在这一过程中遇到过这些问题吗？

1. 随着积累量的不断上升，各类手工积累的方式会产生越发高昂的时间和精力成本；知识库的维护和检索高度依靠自己易逝的记忆和反人性的自律。
2. 在学习过程中频繁与 AI 交流打磨想法，是非常有益且高效的学习手段；但普通对话式 AI 会把每次聊天当成孤立问答，有价值的信息（关于你的和关于知识的）都散落在历史对话中，每次新会话 AI 都要从零开始猜你的已有知识、关注方向和既有思路。
3. 在与 AI 交流过程中出现的关键想法稍纵即逝，淹没在大量对话消息中。

为了解决诸如此类在学习中长期困扰着我（或许也困扰着你）的问题，我在 DeepSeek 辅助下开发了这一款 Obsidian 插件（及 DeepSeek Harness preset）。

插件特点如下：

1. 把 DeepSeek Harness（dsh）嵌入 Obsidian 右侧栏，为 dsh 增添 Obsidian 笔记助手模式。该模式下 dsh 仅拥有笔记区内的基本文件读写权限，并严格限制其他权限；具体安全边界见 [隐私与安全](#隐私与安全)。AI 辅助理结构、补细节、审证明、找问题、推想法，都在 Obsidian 笔记区内完成，agent 可以直接掌握整个笔记区的既有知识。
2. 给 agent 增添记忆系统。目前参考相关文献、结合数学知识的特点，试做了一版面向数学类知识的记忆方案：五层持久记忆（画像 / 主题 / 类型化记录 / 原始证据 / 想法库）参考了 [arXiv:2606.24775](https://arxiv.org/abs/2606.24775) 和 [arXiv:2607.05794](https://arxiv.org/abs/2607.05794)；问题模板-定理关联图参考了 [AAAI-26《Template-Theorems Graph Construction》](https://ojs.aaai.org/index.php/AAAI/article/view/40411)。
3. Agent 主动捕捉 `💡 可捕捉的想法`，**经用户同意后**写入备忘录库，跟踪 `inbox → polishing → done`；关联想法合并而非重复建卡，并在条目陈旧或重新相关时用 `🔔 备忘录提醒` 提示打磨。提醒阈值见 [特性](#特性)。

> 关于当前方案的局限性，详见 [适用范围与局限](#适用范围与局限)。

### 仓库包含什么、各自安装到哪里

| 仓库文件 | 是什么 | 安装位置 |
|---|---|---|
| 仓库根 `main.js` / `manifest.json` / `styles.css` | Obsidian 社区插件（id `dsh-math-assistant`） | `<vault>/.obsidian/plugins/dsh-math-assistant/` |
| `dsh/preset/`（`preset.yml`、`agent.cordis.yml`、`obsidian-memory.mjs`、`obsidian-notes.mjs`） | dsh **agent preset** `obsidian`（最小工具集 + 记忆插件 + 专用笔记工具） | `$DSH_HOME/.agent-presets/obsidian/` |
| `dsh/profile/`（`package.json`、`cordis.patch.yml`、`obsidian-workspace.mjs`、`obsidian.patch.yml` 等） | dsh **profile** `obsidian`（web 界面 + fail-closed 沙箱 + vault 工作区自动注册） | `$DSH_HOME/profiles/obsidian/` |
| `dsh/templates/` | vault 记忆模板（`AGENTS.md`、`.deepseek/**`） | `<vault>/AGENTS.md`、`<vault>/.deepseek/**` |
| `dsh/install.mjs` | npm CLI `dsh-obsidian-math`，负责把上面这些写到位 | npm 全局 bin |

注意：dsh 侧**不是** Cordis bundle，而是 **agent preset + profile + 安装器** 的组合（Obsidian 插件内嵌并自动初始化同一套文件）。具体工具集、记忆分层与提醒策略见 [特性](#特性)；局限见 [适用范围与局限](#适用范围与局限)。

## 适用范围与局限

- **面向数学类知识设计**：记忆分层、类型化记录、审阅工作流与想法备忘录提醒都是围绕数学相关领域（数学、统计学：概念-命题-证明-方法）调校的。不同领域的知识（代码库、法律、医学、工程流程等）通常需要不同的记忆粒度与检索协议，不要默认这套设计可以原样迁移。
- **试做型（0.3.x）**：当前记忆架构基于作者个人选取的若干相关文献，**尚未**经过长期使用测试，也没有系统的基准评测，且缺少长期落地实践经验；分层边界、记录类型、提醒策略都可能继续演进。更完善的 agent-native 记忆架构仍是后续研究课题。

## 特性

- **最小工具面**：`read / write / edit / glob / grep / read_image / ask_user_question`，外加专用笔记工具 `note_search`（tag 过滤）、`note_create`（拒绝覆盖）、`note_links`（反链查询）。没有 shell、没有网页工具、没有子代理。
- **五层长期记忆**（参考 [arXiv:2606.24775](https://arxiv.org/abs/2606.24775) 与 [arXiv:2607.05794](https://arxiv.org/abs/2607.05794)）：
  - `profile.md` 语义层：稳定偏好、记号、长期授权；
  - `topics/` 导航层：主题索引与细节；
  - `records/` 记录层：类型化原子卡（fact/event/instruction/preference，带来源链接）；
  - `episodes/` 证据层：每轮对话的原始事件卡（append-only，保留原话）；
  - `inbox/` 想法层：备忘录库，生命周期 `inbox → polishing → done`。
- **跨会话上下文**：记忆插件解析本机历史 dsh 会话（zstd JSONL），注入最近问答线索（自动排除当前会话）。
- **主动备忘录提醒**：插件扫描每条 memo 的 frontmatter，把陈旧候选（打磨中 >3 天、待打磨 >7 天、今天未提醒）注入系统提示；AI 在相关讨论出现时给出 `🔔 备忘录提醒` 并用 `ask_user_question` 征询是否现在打磨。新关联想法自动并入已有 memo 而非重复建卡。
- **笔记工作流**：理思路、补细节（标注 `<!-- AI 补全 -->`）、分级审阅、找问题。
- **版本化事实**：旧事实标 `~~旧值~~ → 新值（日期）`，从不悄悄删除。

## 环境要求

- Obsidian 桌面版；
- Node.js ≥ 22.5；
- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（npm 全局 `@deepseek-ai/dsh` 或任意本地安装，能被 `dsh` 命令/设置路径找到）；
- 已配置 DeepSeek 模型。

### 为什么默认端口是 3180，而不是 dsh 默认的 3080？

dsh 的 **web** profile 默认绑定 `127.0.0.1:3080`。本插件启动的是独立的
**obsidian** profile（另一个服务进程），两个进程不能同时占用同一个端口。
默认用 `3180` 是为了让 Obsidian 助手和日常使用的 `dsh web`（coding 会话）
在同一台机器上互不冲突、同时运行，不会出现 `EADDRINUSE`。
端口可以在插件设置里修改，或命令行 `dsh --profile obsidian --port <端口>`。

## 安装方式 A：Obsidian 社区插件（推荐，通常只装这个就够了）

这一步同时安装 UI 和 dsh 侧配置（插件会自动初始化）。

1. Obsidian → 设置 → 第三方插件 → 浏览，搜索 **DSH Math Notes Assistant**，安装并启用。（手动安装：把 release 里的 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/dsh-math-assistant/` 后启用。）
2. 插件会自动检测 dsh（PATH、npm 全局目录、`DSH_HOME` 的上级目录）；检测不到就在插件设置里点 **自动检测** 或手动填路径（例如 `E:\software\deepseek-harness`）。
3. 首次运行自动写入 `$DSH_HOME` 下的 preset/profile（只补缺失文件）和 vault 记忆模板（`AGENTS.md`、`.deepseek/...`）。设置页有 **初始化** 与 **强制重装** 按钮。
4. 服务自动启动；点左侧 ribbon 的 message-square 图标（或命令面板运行 **打开 DSH数学笔记助手**），把标签页拖到右侧栏一次，之后位置会被记住。

不需要 cmd、不需要手改 profile。

### 插件设置

| 设置 | 说明 |
|---|---|
| Port | 本地端口，默认 `3180` |
| dsh installation directory | 自动检测，可手动覆盖 |
| DSH_HOME | harness 主目录，默认取环境变量或 `~/.dsh` |
| Start service automatically | 默认开启 |
| Initialize configuration automatically | 默认开启（只补缺失） |
| Show ribbon icon | 一键按钮 |
| Keep service alive when Obsidian closes | 默认关闭 |

## 安装方式 B：dsh 插件 via npm（可选；只有跳过 Obsidian 插件时才需要）

它安装的是 Obsidian 插件会自动初始化的**同一套** `obsidian` preset/profile。适用于纯 dsh CLI 工作流，或想用命令行显式安装/更新 dsh 侧配置。

```bash
npm install -g dsh-obsidian-math
dsh-obsidian-math install --vault "D:\Obsidian笔记数据库"

# 或像普通 dsh 插件一样装进 profile
dsh plugin --profile obsidian add dsh-obsidian-math
```

安装器幂等、保留用户修改（`--force` 覆盖）。随后启动：

```bash
# Obsidian 插件会自动附加这个 --patch 覆盖层；纯 CLI 使用时也请显式带上，
# 这样 vault 会自动注册为工作区，不需要手动选择。
dsh --profile obsidian --port 3180 \
  --patch "$DSH_HOME/profiles/obsidian/obsidian.patch.yml"
```

记忆插件与路径无关：vault 自动取会话 cwd（或用 `DSH_OBSIDIAN_VAULT` 覆盖），历史会话自动取 `$DSH_HOME/sessions`（或用 `DSH_SESSIONS_ROOT` 覆盖）。

## Vault 目录结构

```text
vault/
  AGENTS.md                      工作协议（自动加载）
  .deepseek/
    memory/profile.md            语义层：偏好与稳定事实
    memory/topics/index.md       导航层：主题路由索引
    memory/topics/<topic>.md     主题细节
    memory/records/index.md      记录层：类型化原子记录索引
    memory/records/<slug>.md     原子记忆卡（fact/event/instruction/preference/artifact，带来源链接）
    memory/theorems/index.md     定理索引（个人 Matlas）
    memory/templates/            问题模板库（题型/解法模板 ↔ 定理关联图）
    memory/episodes/index.md     事件时间线
    memory/episodes/YYYY-MM-DD-*.md  原始事件卡（append-only）
    inbox/index.md               备忘录状态索引
    inbox/<slug>.md              想法 memo（inbox → polishing → done）
    cache/                       机器生成的对话索引（勿动）
```

## 开发

```bash
npm test                        # 语法检查
node scripts/build-obsidian.mjs # 用模板 + 共享 dsh/ 文件重新生成 main.js
node scripts/test-installer.mjs # 临时目录端到端测试安装器
```

`main.js` 是构建产物：改 `obsidian/main.template.js` 或共享 `dsh/` 文件后要重新构建。

## 隐私与安全

全部本地运行：dsh 只绑定 `127.0.0.1`，记忆全部是 vault 内 markdown，历史会话索引不出本机。

`obsidian` profile 默认 **fail-closed**：写入被限制在 vault 内（`workspace-write`），交互式提权审批**默认关闭**（`approval: never`，不会弹出“是否升权”窗口，杜绝误点扩大权限边界），工具集中没有删除类工具。如确需一次性全权限，必须显式设置 `DSH_PERMISSION_MODE=danger-full-access` 并重启服务。

由于 agent 没有删除/移动工具，生命周期维护由 Obsidian 插件承担：超过 90 天的旧事件卡会在启动时自动移入 `episodes/archive/`（可在设置中关闭或手动触发）。记录冲突用 `superseded` 标记而非删除，不会静默丢失历史。

## License

MIT
