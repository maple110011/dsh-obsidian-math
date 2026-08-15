# DSH Obsidian 数学笔记助手（dsh-obsidian-math）

> 完整中文使用指南见 [`docs/使用指南.md`](docs/使用指南.md)。

把 DeepSeek Harness 变成一个住在 Obsidian 右侧栏里的长期数学笔记助手。同一套系统以两种形态发布：

1. **Obsidian 社区插件**（仓库根 `manifest.json` + `main.js`）：右侧栏嵌入 dsh Web UI、自动检测并启动 dsh 服务、自动初始化 vault 记忆模板——不需要任何 cmd 窗口。
2. **dsh 插件**（npm 包，`dsh/` 目录）：把 `obsidian` agent preset 与 `obsidian` profile 安装进 `$DSH_HOME`，可选初始化 vault 模板。

Agent 刻意保持**最小工具集**：`read / write / edit / glob / grep / read_image / ask_user_question`，并附带分层长期记忆系统。

## 特性

- **最小工具面**：没有 shell、没有网页工具、没有子代理。
- **四层长期记忆**（依据 [arXiv:2606.24775](https://arxiv.org/abs/2606.24775)）：
  - `profile.md` 语义层：稳定偏好、记号、长期授权；
  - `topics/` 导航层：主题索引与细节；
  - `episodes/` 证据层：每轮对话的原始事件卡（append-only，保留原话）；
  - `inbox/` 备忘录库：生命周期 `inbox → polishing → done`。
- **跨会话上下文**：记忆插件解析本机历史 dsh 会话（zstd JSONL），注入最近问答线索（自动排除当前会话）。
- **主动备忘录提醒**：插件扫描每条 memo 的 frontmatter，把陈旧候选（打磨中 >3 天、待打磨 >7 天、今天未提醒）注入系统提示；AI 在相关讨论出现时给出 `🔔 备忘录提醒` 并用 `ask_user_question` 征询是否现在打磨。新关联想法自动并入已有 memo 而非重复建卡。
- **笔记工作流**：理思路、补细节（标注 `<!-- AI 补全 -->`）、分级审阅、找问题。
- **版本化事实**：旧事实标 `~~旧值~~ → 新值（日期）`，从不悄悄删除。

## 环境要求

- Obsidian 桌面版；
- Node.js ≥ 22.5；
- 已安装 DeepSeek Harness（npm 全局 `@deepseek-ai/dsh` 或任意本地安装，能被 `dsh` 命令/设置路径找到）；
- 已配置 DeepSeek 模型。

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

## 隐私

全部本地运行：dsh 只绑定 `127.0.0.1`，记忆全部是 vault 内 markdown，历史会话索引不出本机。

## 发布

社区提交与 npm 发布步骤见 [docs/RELEASING.md](docs/RELEASING.md)。

## License

MIT
