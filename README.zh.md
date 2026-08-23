# DSH 数学笔记助手（dsh-math-memory）

[English](README.md) · [简体中文](README.zh.md)

> 把 DeepSeek Harness 变成一个住在 Obsidian 右侧栏里的长期数学笔记助手。

一个**双组件**仓库：

1. **Obsidian 社区插件**（id `dsh-math-assistant`，仓库根 `manifest.json` + `main.js`）：右侧栏嵌入 dsh Web UI、自动检测并启动 dsh 服务、首次运行自动初始化 dsh 侧配置与 vault 模板；另有记忆面板、捕获策略设置与确定性维护。
2. **dsh 插件**（npm 包 `dsh-math-memory`，`dsh/`）：把同一套 `notes-assistant` agent preset / profile 与 vault 模板安装进 `$DSH_HOME`。

两者写入的 dsh 配置完全相同、幂等。**只装 Obsidian 插件即可使用**；`dsh/install.mjs` 供纯 CLI 场景。

## 为什么做这个插件

数学学习是长周期积累：记号习惯、理论偏好、半成品证明、技巧、反例、想法都需要持续收集并打磨成关联体系。普通对话式 AI 把每次聊天当孤立问答；本插件给 agent 一套**跨会话分层记忆**（五层结构 + 记号体系 + 备忘录生命周期）、**统一检索**（笔记+记忆一次查清）与**长期协议**（AGENTS.md），让新会话从上次结束的地方开始。

## 特性

### 检索（v3：统一入口、粗筛-精读）
- **`note_recall` 统一检索**：一次 BM25 排序覆盖用户笔记 + 全部记忆层（记忆卡带 hook 字段加权、备忘录、主题、定理/事件索引）；Unicode 连字符归一 + 中文字符包含桥接词形差异；命中带 **coverage**（查询词覆盖率，<0.35 视为词面巧合弱信号）。
- **精读挑选协议**：蒸馏查询（挑战描述 + 候选技巧）→ 读前 2-3 篇全文逐条判适用 → 空结果改写重试一次 → 仍无则明说「库里没有」，不编造；同一轮 ≤2 次检索、≤3 篇全文。
- **导航式注入**：系统提示只注入导航层（画像/记号/主题/记录/模板/事件索引），相关内容按需拉取——每轮注入有硬上限（≤18000 字符；各层预算见 docs/memory/design.md §3）。
- `note_search`（用户笔记 tag 过滤）、`note_links`（反链/顺链扩读）、`note_create`（拒绝覆盖）配合使用。

### 记忆（五层 + 维护闭环）
- **五层记忆**：profile（语义层）/ topics（导航）/ records（类型化原子卡，带 hook 检索特征与验证等级 ✅⚖️❓）/ episodes（原始证据，append-only）/ inbox（想法备忘录，inbox→polishing→done）。
- **记号体系**：`memory/notation.md` 三表（已采纳/候选/已否决 + 修订历史），「收集→统一→维护」——发现记号不一致时主动提议统一（用户无统一习惯时先观察再提）。
- **每日体检**：确定性扫描 strong/weak/unused/疑似重复/unverified + **结构校验**（缺 source/断链/未入索引）；`note_recall` 命中统计回写 `uses/success_rate`。
- **备忘录提醒**：陈旧（inbox>7 天、polishing>3 天）或与当前讨论相关时提醒打磨，相关性×新鲜度排序。
- **捕获策略分级**：`idea/fact/preference × auto/ask/off`——设置页下拉框直接选择（写回 `capture-policy.md`），也可在记忆面板/文件中编辑；auto 档写入后回复末尾注明，ask 档提案含「一句话想法+为什么+拟写入位置」。
- **跨会话上下文**：解析本机历史 dsh 会话（zstd JSONL），注入最近问答线索（自动排除当前会话，按 vault 过滤）。

### 控制面（Obsidian 侧）
- **记忆面板**：五层浏览、搜索、hook 统计与 📈 使用趋势、逐卡 ✅/❌/过期/归档、体检报告展示；**面板内直接编辑保存**（mtime 冲突防护）；捕获策略与策略说明在设置页可见可改。
- **反馈闭环**：回复内 `[✅ 这条对] [❌ 这条错]` 链接经 loopback `/feedback` 端点确定性改写卡片（CSRF token 保护）；笔记引用可点击跳转 Obsidian（`/open`）。
- **回复质量协议**：直觉先行、认知锚定（新内容挂钩你的笔记）、难度自适应、苏格拉底式纠错、低频检查性收尾。
- **不挂载任何 dsh-web-ui 插件（独立性）**：profile 只 bundle `dsh-web-app` 以嵌入聊天 UI，但**不挂载** dsh-web-ui 插件家族（皮肤中心/任务看板/SSH/aionui 面板/git-graph/宠物/统计等）——因此没有 `@linxin666` UI 包需要解析，有/无 `web` profile 都能干净启动。

### 安全（fail-closed）
- 工具面：文件读写/搜索 + 四个笔记工具 + ask_user；无 shell/web/子代理/删除工具。**不挂载任何 dsh-web-ui 插件**——保持最小 agent 工具面。
- 写操作限定 vault（workspace-write）；交互式提权默认禁用（`approval: never`）；`DSH_PERMISSION_MODE=danger-full-access` 仅重开提权询问、沙箱不变。
- 记忆全部是 vault 内 markdown；归档代替删除；模型不得修改策略/统计字段。

## 要求
- Obsidian 桌面版；Node.js ≥ 22.5；DeepSeek Harness（npm 全局 `@deepseek-ai/dsh`）；已配置的 DeepSeek 模型。
- 默认端口 **3180**（与 dsh web 的 3080 并存不冲突，可在设置里改）。

## 安装

**方式 A（推荐）**：Obsidian 设置 → 第三方插件 → 搜索 **DSH Math Notes Assistant** 安装启用；或手动把 `main.js`/`manifest.json`/`styles.css` 放进 `<vault>/.obsidian/plugins/dsh-math-assistant/`。首次运行自动检测 dsh、初始化 preset/profile/vault 模板、启动服务。

**方式 B（CLI）**：
```bash
npm install -g dsh-math-memory
dsh-math-memory install --vault "D:\\Obsidian笔记数据库"
dsh --profile notes-assistant --port 3180 --patch "$DSH_HOME/profiles/notes-assistant/notes-assistant.patch.yml"
```

插件设置项：端口、dsh 安装目录、DSH_HOME、自动启动、自动初始化、自动归档（>90 天事件）、ribbon 按钮、关闭 Obsidian 时保留服务、**捕获策略三档下拉框**。

## vault 布局

```text
vault/
  AGENTS.md                       工作协议（自动加载）
  .deepseek/
    memory/profile.md             语义层（画像）
    memory/notation.md            记号体系（收集→统一→维护）
    memory/topics/                导航层
    memory/records/               记录层（原子卡 + hook）
    memory/theorems/              定理索引（个人 Matlas）
    memory/templates/             问题模板库（题型↔定理图）
    memory/episodes/              证据层（append-only + archive/）
    inbox/                        想法备忘录
    capture-policy.md             捕获策略（用户维护）
    cache/                        机器生成缓存（勿动）
```

## 开发与质量

```bash
npm test          # 语法 + 82 项零 token 回归 + 安装器 e2e（漂移检测）
npm run qa        # 引擎探针：真实 vault 12 组召回断言（零 token）
npm run qa:e2e    # 真实会话端到端验收（烧真实 tokens，报告 API 级 usage）
node scripts/build-obsidian.mjs   # 重建 main.js（改共享文件后必跑）
node scripts/deploy-local.mjs     # 本机一键部署
```

- **仓库结构**：[ARCHITECTURE.md](ARCHITECTURE.md)——目录职责、双组件数据流、记忆↔检索边界、落地清单。
- **记忆系统知识库**：[docs/memory/](docs/memory/)——design（实现规格）、retrieval-v3（检索提案）、testing（QA 方法论）、assessment、references（论文笔记）、changelog、handoff。
- **验收记录**：引擎探针 12/12；真实会话 E2E 4/4（含「无答案不编造」「改写重试」行为验证）；成本基准题（旧系统同题 17 万 tokens）新系统实测约 2.5 万计费 tokens（缓存命中 68%）。
- 版本：**0.6.3**（试做型；记忆架构未经长期使用测试，会继续演进）。

## 隐私与安全

全部本地运行：服务绑定 127.0.0.1，记忆是 vault 内 markdown，历史会话索引不出本机。

## License

MIT
