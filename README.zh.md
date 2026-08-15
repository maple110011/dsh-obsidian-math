# DSH Obsidian 数学笔记助手（dsh-obsidian-math）

<p align="center">
  <a href="README.zh.md"><img alt="中文文档" src="https://img.shields.io/badge/中文-切换到中文-blue?style=for-the-badge"></a>
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/English-English_README-2ea043?style=for-the-badge"></a>
</p>

把 DeepSeek Harness 变成一个住在 Obsidian 右侧栏里的长期数学笔记助手。同一套系统以两种形态发布：

1. **Obsidian 社区插件**（仓库根 `manifest.json` + `main.js`）：右侧栏嵌入 dsh Web UI、自动检测并启动 dsh 服务、自动初始化 vault 记忆模板——不需要任何 cmd 窗口。
2. **dsh 插件**（npm 包，`dsh/` 目录）：把 `obsidian` agent preset 与 `obsidian` profile 安装进 `$DSH_HOME`，可选初始化 vault 模板。

Agent 刻意保持**最小工具集**：`read / write / edit / glob / grep / read_image / ask_user_question`，并附带分层长期记忆系统。

## 解决的痛点

1. **“这个问题我问过，但忘了。”** 有价值的信息散落在以往与 AI 的对话里，时间一久只能重新问，AI 每次都要从零猜测你的关注点、记号习惯和理论偏好。本插件给 agent 一套**持久分层记忆**（画像 + 主题索引 + 原始事件证据），并把本机历史 dsh 会话的摘要注入每个新会话——它从上一次对话结束的地方开始，而不是从零开始。
2. **“写笔记总要反复把 md 发给 AI。”** 助手直接住在 Obsidian 右侧栏，只有文件读写/搜索工具。理思路、补细节、审阅、找问题都在 vault 原地完成，不再复制粘贴往返。
3. **“关键数学想法容易溜走。”** 对话中浮现的一般性数学思路、方法、技巧、观点稍纵即逝。agent 会主动给出 `💡 可捕捉的想法`，经你同意写入备忘录库（`inbox → polishing → done`），插件还会在出现新关联想法或条目久未更新时用 `🔔 备忘录提醒` 催你打磨。

## 适用范围与局限

- **面向数学类知识设计**：记忆分层、类型化记录、审阅工作流与想法备忘录提醒都是围绕数学相关领域（数学、统计学：概念-命题-证明-方法）调校的。不同领域的知识（代码库、法律、医学、工程流程等）通常需要不同的记忆粒度与检索协议，不要默认这套设计可以原样迁移。
- **试做型（0.1.x）**：当前记忆架构**尚未**经过长期使用测试，也没有系统的基准评测；分层边界、记录类型、提醒策略都可能继续演进。设计借鉴了 [arXiv:2606.24775](https://arxiv.org/abs/2606.24775)、[arXiv:2607.05794](https://arxiv.org/abs/2607.05794)、[arXiv:2604.03789](https://arxiv.org/abs/2604.03789)（Rethlas 的证明工作流），以及 [AAAI-26《Template-Theorems Graph Construction》](https://ojs.aaai.org/index.php/AAAI/article/view/40411)（问题模板-定理关联图）；更完善的 agent-native 记忆架构仍是后续研究课题。

## 特性

- **最小工具面**：没有 shell、没有网页工具、没有子代理。
- **五层长期记忆**（依据 [arXiv:2606.24775](https://arxiv.org/abs/2606.24775) 与 [arXiv:2607.05794](https://arxiv.org/abs/2607.05794)）：
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
- 已安装 DeepSeek Harness（npm 全局 `@deepseek-ai/dsh` 或任意本地安装，能被 `dsh` 命令/设置路径找到）；
- 已配置 DeepSeek 模型。

### 为什么默认端口是 3180，而不是 dsh 默认的 3080？

dsh 的 **web** profile 默认绑定 `127.0.0.1:3080`。本插件启动的是独立的
**obsidian** profile（另一个服务进程），两个进程不能同时占用同一个端口。
默认用 `3180` 是为了让 Obsidian 助手和你日常使用的 `dsh web`（coding 会话）
在同一台机器上互不冲突、同时运行，不会出现 `EADDRINUSE`。
端口可以在插件设置里修改，或命令行 `dsh --profile obsidian --port <端口>`。

## 安装方式 A：Obsidian 社区插件

1. Obsidian → 设置 → 第三方插件 → 浏览，搜索 **DSH Obsidian Math Assistant**，安装并启用。（手动安装：把 release 里的 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/dsh-obsidian-math/` 后启用。）
2. 插件会自动检测 dsh（PATH、npm 全局目录、`DSH_HOME` 的上级目录）；检测不到就在插件设置里点 **Detect** 或手动填路径（例如 `E:\software\deepseek-harness`）。
3. 首次运行自动写入 `$DSH_HOME` 下的 preset/profile（只补缺失文件）和 vault 记忆模板（`AGENTS.md`、`.deepseek/...`）。设置页有 **Initialize** 与 **Reinstall (force)** 按钮。
4. 服务自动启动；点左侧 ribbon 的 message-square 图标（或命令面板运行 “DSH Math Assistant: Open DSH Math Assistant”），把标签页拖到右侧栏一次，之后位置会被记住。

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

## 安装方式 B：dsh 插件（npm）

```bash
npm install -g dsh-obsidian-math
dsh-obsidian-math install --vault "D:\Obsidian笔记数据库"

# 或像普通 dsh 插件一样装进 profile
dsh plugin --profile obsidian add dsh-obsidian-math
```

安装器幂等、保留用户修改（`--force` 覆盖）。随后启动：

```bash
dsh --profile obsidian --port 3180
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
