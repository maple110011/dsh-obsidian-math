# DSH 数学笔记助手（dsh-math-memory）

[English](README.md) · [简体中文](README.zh.md)

> 把 DeepSeek Harness 变成一个住在 Obsidian 右侧栏里的长期数学笔记助手。

一个**双组件**仓库：

1. **Obsidian 社区插件**（id `dsh-math-assistant`，仓库根 `manifest.json` + `main.js`）：右侧栏嵌入 **dsh web**、自动检测并启动 dsh 服务、首次运行自动初始化 dsh 侧配置与 vault 模板；另有记忆面板、捕获策略设置与确定性维护。
2. **dsh 插件**（npm 包 `dsh-math-memory`，`dsh/`）：把同一套 `notes-assistant` agent preset / profile 与 vault 模板安装进 `$DSH_HOME`。

三种安装方式（原生 bundle / `--direct` 离线拷贝 / Obsidian 内置直写）产出等价配置，靠 owner marker 避免互相覆盖。**只装 Obsidian 插件即可使用**；纯 CLI 用 `dsh-math-memory install`（含 `uninstall`）。

## 为什么做这个插件

数学学习是长周期积累：记号习惯、理论偏好、半成品证明、技巧、反例、想法都需要持续收集并打磨成关联体系。普通对话式 AI 把每次聊天当孤立问答；本插件给 agent 一套**跨会话分层记忆**（五层结构 + 记号体系 + 备忘录生命周期）、**统一检索**（笔记+记忆一次查清）与**长期协议**（AGENTS.md），让新会话从上次结束的地方开始。

## 这个项目解决到哪一步了（与 1.0 的距离）

说清楚边界，比堆特性重要：

- **已经解决的**：**「agent 记不住用户问过什么」**。原文证据（episodes）确定性落盘、类型化原子记录（records）带来源链、五层结构 + 导航索引、统一检索（`note_recall`）一次查清、每轮按需注入而不是全量塞进上下文、每日体检 + 用户反馈闭环做确定性维护。也就是说：**跨会话的"记得住、找得到、可纠正"这条线是通的**。
- **还差得多的**：**「辅助用户打磨一套数学理解，并建立对理解、技巧等的调用体系」**。现在记的是"用户问过什么/结论是什么"，不是"用户理解到哪、卡在哪、下一步该练什么"；技巧层只有存储与检索，**没有调用体系**（什么时候该用哪条、适用边界怎么判、失败了换哪条、几条如何组合）；也没有主动的教学闭环（诊断 → 提示 → 检验 → 复盘的长期档案）与复习调度。
- **因此：真正实现了后一条，才叫 1.0。** 当前是 0.7.x 试做型——记忆基础设施可用、控制面可见可纠正，但离"学习伙伴"这个目标还差一代设计（缺什么、按什么顺序补，见 [docs/handoff.md](docs/handoff.md) §7 与 [docs/memory/assessment.md](docs/memory/assessment.md)）。

## 特性

### 检索（v3：统一入口、粗筛-精读）
- **`note_recall` 统一检索**：一次 BM25 排序覆盖用户笔记 + 全部记忆层（记忆卡带 hook 字段加权、备忘录、主题、定理/事件索引）；Unicode 连字符归一 + 中文字符包含桥接词形差异；命中带 **coverage**（查询词覆盖率，<0.35 视为词面巧合弱信号）。
- **精读挑选协议**：蒸馏查询（挑战描述 + 候选技巧）→ 读前 2-3 篇全文逐条判适用 → 空结果改写重试一次 → 仍无则明说「库里没有」，不编造；同一轮 ≤2 次检索、≤3 篇全文。
- **导航式注入**：系统提示只注入导航层（画像/记号/主题/记录/模板/事件索引），相关内容按需拉取——每轮注入有硬上限（≤18000 字符；各层预算见 [docs/memory/design.md](docs/memory/design.md) §3）。
- `note_search`（用户笔记 tag 过滤）、`note_links`（反链/顺链扩读）、`note_create`（拒绝覆盖）配合使用。

### 记忆（五层 + 维护闭环）
- **五层记忆**：profile（语义层）/ topics（导航）/ records（类型化原子卡，带 hook 检索特征与验证等级 ✅⚖️❓）/ episodes（原始证据，append-only）/ inbox（想法备忘录，inbox→polishing→done）。
- **记号体系**：`memory/notation.md` 三表（已采纳/候选/已否决 + 修订历史），「收集→统一→维护」——发现记号不一致时主动提议统一（用户无统一习惯时先观察再提）。
- **每日体检**：确定性扫描 strong/weak/unused/疑似重复/unverified + **结构校验**（缺 source/断链/未入索引）；`note_recall` 命中统计回写 `uses/success_rate`。
- **备忘录提醒**：陈旧（inbox>7 天、polishing>3 天）或与当前讨论相关时提醒打磨，相关性×新鲜度排序。
- **捕获策略分级**：`idea/fact/preference/structure × auto/ask/off`——**一个档位对应一组记忆层**（想法→inbox、事实→records、偏好→profile/记号、结构→主题/定理索引/模板/策略）；设置页下拉框或在任一记忆面板的「捕获策略」一行点选即可（都写回 `capture-policy.md`）；auto 档写入后回复末尾注明，ask 档提案含「一句话想法+为什么+拟写入位置」。
- **跨会话上下文**：解析本机历史 dsh 会话（zstd JSONL），注入最近问答线索（自动排除当前会话，按 vault 过滤）。

### 控制面（Obsidian 侧）
- **记忆面板**：首屏一行状态条（画像/记录/模板/主题/定理/策略/备忘录/事件 + 上次体检）；**⚠️ 待处理**（体检的「待重审 / 建议归档」直接摆在可点的归档按钮旁）；五层卡片合并浏览 + 搜索（标题/主题/类型/算子）；逐卡 `✅ 确认` / `❌ 有错` / `过期` / `归档`（归档二次确认）并给出中文回执；事件时间线显示人类标题 + 主题（默认折叠 8 条）；记忆体检显示中文摘要（模型版清单折叠在「查看模型版清单」里）；**面板内直接编辑保存**（mtime 冲突防护）。
- **反馈闭环**：回复内 `依据的记忆：<卡标题> — [✅ 这条对] [❌ 这张卡有错]` 链接经 loopback `/feedback` 端点确定性改写卡片（CSRF token 保护）；笔记引用可点击跳转 Obsidian（`/open`）。
- **回复质量协议**：直觉先行、认知锚定（新内容挂钩你的笔记）、难度自适应、苏格拉底式纠错、低频检查性收尾。
- **默认不挂载 `@linxin666` UI 插件（独立性）**：profile 只 bundle `dsh-web-app` 以嵌入聊天 UI，**默认不挂载** `@linxin666/dsh-web-all` 聚合的那一族 UI 插件（皮肤中心/任务看板/SSH/aionui 面板/git-graph/宠物/统计等）——因此没有 `@linxin666` UI 包需要解析，有/无 `web` profile 都能干净启动。**皮肤中心**（皮肤选择 + 背景透明度）可在插件设置里选择性开启，需本机存在 `web` profile 以镜像 `@linxin666` 皮肤包；若该 `web` profile 装的是 `@linxin666/dsh-web-all` 聚合包（0.3.20 起聚合包已自带皮肤中心行），这个开关在功能上是冗余的——它仍覆盖「有皮肤包但没有聚合包」的机器。

### 安全（fail-closed）
- 工具面：文件读写/搜索 + 五个笔记工具（`note_recall` / `note_strategy` / `note_search` / `note_create` / `note_links`）+ ask_user；无 shell/web/子代理/删除工具。**不挂载任何 `@linxin666` UI 插件**——保持最小 agent 工具面。
- 写操作限定 vault（workspace-write）；交互式提权默认禁用（`approval: never`）；`DSH_PERMISSION_MODE=danger-full-access` 仅重开提权询问、沙箱不变。
- 记忆全部是 vault 内 markdown；归档代替删除；模型不得修改策略/统计字段。

## 要求
- Obsidian 桌面版；Node.js ≥ 22.5；DeepSeek Harness（npm 全局 `@deepseek-ai/dsh`，**已在 0.1.5-rc.1 上验证**；会话数据格式 V3 的适配见 [`docs/dsh-0.1.5-adaptation.md`](docs/dsh-0.1.5-adaptation.md)）；已配置的 DeepSeek 模型。
- 默认端口 **3180**（与 dsh web 的 3080 并存不冲突，可在设置里改）。

## 安装

**方式 A（推荐）**：Obsidian 设置 → 第三方插件 → 搜索 **DSH Math Notes Assistant** 安装启用；或手动把 `main.js`/`manifest.json`/`styles.css` 放进 `<vault>/.obsidian/plugins/dsh-math-assistant/`。首次运行自动检测 dsh、初始化 preset/profile/vault 模板、启动服务。

**方式 B（CLI）**：
```bash
npm install -g dsh-math-memory
dsh-math-memory install --vault "<你的 vault 路径>"
dsh --profile notes-assistant --port 3180                  # 启动（原生：bundle 已提供 panel/workspace，无需 --patch）
```

插件设置项：端口、dsh 安装目录、DSH_HOME、自动启动、自动初始化、自动归档（>90 天事件）、ribbon 按钮、关闭 Obsidian 时保留服务、**皮肤中心开关**（进阶；聚合包已自带皮肤中心）、**侧栏性能模式**（默认开启：代理把皮肤在侧栏里的高开销特效去掉，并把皮肤客户端脚本 `hooks.mjs` 的两处热循环减速——实测那才是侧栏卡顿的主因）、**侧栏加载皮肤动态装饰**（默认开启；关掉则侧栏不加载皮肤脚本，实测最流畅，代价是 hero 场景/状态角色消失）、**捕获策略四档下拉框**。详细原因与实测数据见 [docs/memory/sidebar-performance.md](docs/memory/sidebar-performance.md)。

> **完整指引**：安装原理、冲突解决（owner marker / `--force` 接管）与卸载（三级删除、`--purge-data` 确认短语）见 [`docs/installation.md`](docs/installation.md)；发版与商店更新通道见 [`docs/release.md`](docs/release.md)。**更新随商店与插件管理器走**——只要存在 tag 等于 `manifest.json` 版本的 Release，就不必手动换文件。

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
npm test          # 语法 + 295 项零 token 回归 + 路由回归（47 项路由断言） + 侧栏认证握手回归（8 项，对真实 dsh）+ 侧栏反代回归（32 项）+ 安装器 e2e（漂移检测）
npm run qa        # 引擎探针：真实 vault 12 组召回断言 + 可达性分层/A-B 测量（零 token）
npm run qa:e2e    # 真实会话端到端验收（烧真实 tokens，报告 API 级 usage）
node scripts/build-obsidian.mjs   # 重建 main.js（改共享文件后必跑）
node scripts/deploy-local.mjs     # 本机一键部署
```

- **仓库结构**：[ARCHITECTURE.md](ARCHITECTURE.md)——目录职责、双组件数据流、记忆↔检索边界、落地清单。
- **记忆系统知识库**：[docs/memory/](docs/memory/)——design（实现规格）、retrieval-v3（检索提案 + §7 GraphMemix 吸纳决策与 A/B 实测）、testing（QA 方法论）、assessment、references（论文笔记）、[sidebar-performance](docs/memory/sidebar-performance.md)（侧栏卡顿的原因清单与处置）、changelog、handoff。
- **宿主版本适配**：[docs/dsh-0.1.5-adaptation.md](docs/dsh-0.1.5-adaptation.md)——dsh 0.1.5-rc.1 / 会话格式 V3 / `dsh-web-all@0.3.20` 的影响取证、修复清单与「刻意不改」的理由。
- **验收记录**：两个探针都改为调用**产品自己的排序管线**（`buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`），不再各自复刻公式——仿真 vault 探针 8/8，真实 vault 探针 **12/12**（导航索引已降权，因此「库里没有答案 → 弱信号」这条控制项成立）。引擎探针另打印 GraphMemix 式**可达性分层**（Direct / Recoverable / No access）与单袋 vs 多视图的**有符号净恢复 Δ**、目标排名——正是这次测量把多视图 max-pool 挡在默认路径之外（`docs/memory/retrieval-v3.md` §7.2）。真实会话 E2E 共 5 个用例（含「无答案不编造」「改写重试」行为验证）；成本基准题（旧系统同题 17 万 tokens）新系统实测约 2.5 万计费 tokens（缓存命中 68%）。
- 版本：**0.7.7**（试做型；记忆架构未经长期使用测试，会继续演进）。

## 隐私与安全

全部本地运行：服务绑定 127.0.0.1，记忆是 vault 内 markdown，历史会话索引不出本机。

## License

MIT
