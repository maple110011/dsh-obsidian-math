# 测试与验收（自动化 QA + 本地验收手册）

> 位置：`scripts/qa/`。目标：把「引擎正确性」与「agent 行为合规」两层验收变成可重复、可扩展、可计量成本的自动化流程；§6 为本地验收手册（安装 / boot 冒烟 / 手动 Obsidian 验证）。

## 1. 两层测试

### 引擎探针（零 token）

`scripts/qa/engine-probe.mjs`：对真实 vault 跑 ground-truth 召回断言（换说法/连字符变体/读取半径/无答案弱信号 12 组）。**零 token、秒级**，改打分器/语料组装后必跑。

- 断言三类：`must rank top-k`（目标文件须进入前 k 名）、`__WEAK__`（无答案查询 top-1 coverage 必须 < 0.35）；
- ground truth 与本机 vault 绑定（`DSH_WORKSPACE_ROOT` 可覆盖，旧名 `DSH_OBSIDIAN_VAULT` 兼容），vault 内容变化时同步维护断言。
- **§2 可达性分层 + 池化 A/B（2026-09-10 加，GraphMemix 式测量）**：抽 vault 原文里的 `related`/`source`/`[[wikilink]]` 边（**断链不算可达**），把每条 ground truth 目标分成 **Direct / Recoverable / No access**，对 `viewPool: "bag"`（默认）与 `"max"` 各算一次，报告有符号净恢复 Δ 与**目标排名**均值。
  - 为什么两个口径都要：分层是粗粒度的——本轮 11/11 全是 Direct，只看分层会得出「两种池化没差别」，而排名显示 max-pool 更差（0 改善 / 2 变差）。
  - **读法约定（改检索的门槛）**：必须「Direct 数不降**且**目标排名均值不升」。只有分层改善而排名变差 → 按未通过处理。
  - 决策记录与数字：`retrieval-v3.md` §7.2/§7.5。
- **§3 检索成本 Avg-R（2026-09-17 加，MemForest 式测量）**：`Avg-R = Σ(未找到 ? 10 : 目标排名) / 可排名用例数`，另报中位数、最差、名次分布，以及「排名首位」与「只读前 3 条可覆盖」两个计数。
  - **为什么命中率不够**：命中率把「第一个结果就对」和「翻到第 7 个才找到」记成同一个分数。MemForest（arXiv:2609.08273 §5.3.2）正是用平均检索轮数证明它的压缩把轮数从 3.10 压到 2.6，而不是只报准确率。
  - **未命中按上限 10 计入，不从分母剔除**：丢掉找不到的用例会让平均值看起来更好——MSCE 提醒过"低成本可能来自提前终止"。
  - **只报告、不做断言**：它的用途是**改检索前的可比基线**（改动前后各跑一次，Avg-R 下降且命中数不降才算改进，同 §2 的门槛口径）。
  - 当前真实 vault 基线（2026-09-17）：**Avg-R 2.45 · 中位数 1 · 最差 10 · 11 例**；7 例排首位、9 例在前 3、1 例未进 top-8（即那条已知的「定理索引命中」）。

### 侧栏交互性能探针（零 token，按需运行，不进 CI）

`scripts/qa/sidebar-perf-probe.mjs`：起真实 dsh +（可选）插件已发布的反代 `DshWebProxy`，用 headless Chromium 的 CDP 以**真实鼠标事件**点侧栏开合，输出帧间隔 / 长动画帧(LoAF) / Task·Layout·RecalcStyle。**不进 `npm test` / `npm run qa`**（需本机 Chrome + 真实 dsh）。

- 用途：皮肤升级、dsh 升级、换机器后复测「面板卡不卡」；`--mutations` 模式用来找「谁在空转」。
- 这是「Obsidian 面板卡顿」排查留下的尺子：第一轮凭静态资源推断改错了地方，第二轮靠它定位到真因（皮肤客户端脚本 `hooks.mjs`）。用法、判读与未解决项见 `sidebar-performance.md` §9。

### 真实会话 E2E（消耗模型 tokens）

`scripts/qa/e2e.mjs`：起临时 obsidian web 服务（默认 3191 端口）→ 逐题建 preset 会话 → 轮询 session.history → 断言**工具轨迹**与**回答内容** → 汇总 PASS/FAIL 与 token 估算。

- 用例格式（`scripts/qa/cases.json`）：
```json
{
  "question": "…",
  "expect": {
    "mustUse": ["note_recall"],                      // 必须调用的工具
    "mustRead": [".deepseek/inbox/x.md"],            // 必须读取的文件（子串匹配）
    "mustContain": ["库里没有"],                     // 回答必须包含
    "mustNotContain": ["…"],                        // 回答不得包含
    "answerNotEmpty": true,
    "timeoutMs": 420000
  }
}
```
- 断言维度覆盖协议的四个关键行为：**首选入口**（mustUse note_recall）、**精读核实**（mustRead）、**空结果诚实**（mustContain 库里没有）、**改写重试**（Q2 类用例用两次 note_recall 观察）。
- token 成本：**真实数字**——dsh-web-app 已挂 `dsh-token-meter`，会话事件的 `assistant/chunk` 携带 `usage` 块（input/output/reasoning/cacheRead，直接来自 DeepSeek API 响应）；驱动器按用例汇总并打印分项。注意 usage 在 chunk 块里，不在顶层事件类型里。

## 2. 用法

```bash
npm run qa          # 只跑引擎探针（零 token）
npm run qa:e2e      # 引擎探针 + 真实会话 E2E（烧真实 tokens，需已配置模型）
node scripts/qa/e2e.mjs --cases my-cases.json --port 3192   # 自定义用例集
```

## 3. 环境依赖

- `DSH_HOME`、`DSH_WORKSPACE_ROOT`（旧名 `DSH_OBSIDIAN_VAULT` 兼容）、`DSH_BIN`（dsh 启动脚本）三个环境变量必填——QA 脚本不再内置本机路径默认值；
- E2E 需要本机 dsh 安装 + 已配置的模型凭据；引擎探针无任何外部依赖。

## 4. 演进路线（后续可扩展）

1. **成本计量**：E2E 临时服务挂 `dsh-token-meter`，报告每用例真实 token；
2. **行为断言库**：把「改写重试」「顺链扩读」「徽标引用」做成可配置断言；
3. **回归基线**：引擎探针结果存 JSON 基线（`qa/baseline.json`），CI 可比对。**当前状态（2026-09-11 更正）**：`e2e.mjs` 确实会写 `scripts/qa/runs/*/baseline.json`，但**没有任何代码读取它**——所以「CI 可比对」是目标而非现状，那三份已提交的基线目前是死产物（去留登记在 `handoff.md` §7）；
4. **多 vault 探针**：engine-probe 支持自定义 vault + 用例文件，供他人复用；
5. **CI 边界**：引擎探针可进 GitHub Actions（无 vault 时用合成 fixture）；E2E 因需模型凭据与真实 vault，保持本机运行；
6. **消融的形状与重复性（2026-09-18，**提案**，未实现）**——见下方 §4.1。它与第 3 条（基线）是同一件事的两半：没有重复性度量的基线不可比。

### 4.1 探针的方法学：2×2 消融 + 重复 3 次（**提案**，未实现）

> **来源**：WikiSkill（arXiv:2608.27454 §5.1）的消融不是"关掉一个模块再跑一遍"，而是构造 **2×2 的访问矩阵**（推理 agent 能否读 wiki × 提案者能否读 wiki），并在"提案者不能读 wiki"时**同时移除 Maintainer**，从而把"读了知识"与"有知识可读"分开。它还对小验证集做**3 次独立完整运行**并报平均，因为单次运行在小样本上没有结论力。

**为什么我们的"关开关"式消融不够**：`note_recall` / `note_strategy` 的一类改动（hook 加权、状态分流、边界门控）关掉开关后，**读到的内容与"库里没有可读"在输出上无法区分**——两个不同的原因给出同一个红/绿，于是不知道改的是哪一半。

**形状**（每条用例都跑四个格子）：

|  | 注入该特性 | 不注入 |
|---|---|---|
| **库里有对应内容** | ① 应当命中 | ② 反事实：有内容但不用它 |
| **库里没有** | ③ 空注入（防"没内容也命中"） | ④ 基线 |

- **断言分工**：① 命中 → 特性有效；② 与 ① 的差 → **该特性的净收益**；③ 必须**不比 ④ 好** → 防"任何注入都被当答案"。
- **重复 3 次**：同一组用例连跑 3 次，报告 3 次的命中集合；**只要有一次不同就标 `unstable`**，而不是报一个平均数掩盖抖动（探针与模型无关，抖动只可能来自数据顺序/缓存/时间，正是要抓的东西）。
- **不要做**：bootstrap 显著性（我们几十条合成用例，样本量支撑不了这个统计量；WikiSkill 有 18–280 条真实测试集才用它）；也不要把它做成 CI 门禁（它需要真实 vault）。

## 5. 已知教训（写用例时注意）

- `dsh-headless` 不装配 agent preset，不能作为本插件验收路径——必须走 web 服务 + preset 会话；
- 轮询历史时 `turn/end` 与最终 `assistant/message` 可能不同页——必须等到「turn/end 且 finalText 非空」；
- 工具调用参数在 `data.arguments`（JSON 字符串），读取目标从 `file_path/path/pattern/query` 提取；
- 无答案类断言用 mustContain「库里没有」而非 mustNotContain 公式——模型会一边声明缺失一边写出公式。
- **ask_user_question 会让轮次挂起等待用户答复**——驱动器把「存在未答复的 ask_user_question」视为合法终态（否则误报超时）；这也是观察「捕获协议」行为的窗口。

## 6. 本地验收手册（安装 / boot 冒烟 / 手动 Obsidian 验证）

> 本节承接原根目录 `TESTING.md`（已并入），去掉机器特定的「你的现状」，保留可复用的验收步骤。

### 6.1 零 token 快速检查

```bash
npm test     # 语法 + 零 token 回归 + 安装器 e2e + 漂移检测 + 三个守卫 + 文档一致性守卫
npm run qa   # 引擎探针：12 组 ground-truth 召回断言（需真实 vault）
```

`npm run qa` 的 ground truth 绑定真实 vault，需先设置 `DSH_WORKSPACE_ROOT`（旧名 `DSH_OBSIDIAN_VAULT` 兼容）。

### 6.2 Boot 冒烟测试（零 token，验证 profile 能加载）

```bash
tmp=$(mktemp -d)
node dsh/install.mjs install --direct --dsh-home "$tmp" --quiet
DSH_HOME="$tmp" dsh --profile notes-assistant --dump-config
```

应看到关键标记：`default: notes-assistant`、`mode: workspace-write`、`approval ... 'never'`、`defaultPreset: math-memory-locked`（不再挂载 `ui-skin-center` / `ui-web-ui-settings`）。Windows PowerShell 下用 `$env:DSH_HOME` 代替 `DSH_HOME=`。

### 6.3 正式安装

```bash
node scripts/deploy-local.mjs                                            # 本机一键部署（gitignored，含本机路径）
node dsh/install.mjs install --direct --dsh-home "$DSH_HOME" --vault "<vault>"    # 纯 CLI（离线）
node dsh/install.mjs install --dsh-home "$DSH_HOME" --vault "<vault>"    # 原生（需 pnpm）
dsh --profile notes-assistant --port 3180   # 原生；--direct 装时需 --patch notes-assistant.patch.yml
```

### 6.4 在主 dsh web 里用 preset（不建专用 profile）

```bash
dsh plugin --profile web add dsh-math-memory   # 把 bundle 加进主 web profile（原生）
```

装完后重启 dsh，新建会话时选「数学笔记助手」preset。注意：这样用的是主 dsh 的沙箱/审批（比专用 profile 的 fail-closed 宽松）；旧 `--preset-only` 已移除，由 `dsh plugin add` 取代。

### 6.5 独立设置面板（host-agnostic config 文件）

每个工作区一个 `.deepseek/config.md`（frontmatter），任何环境（Obsidian / 主 dsh / CLI）共用：

```markdown
---
enabled: true        # 总开关：false = 本工作区完全停用记忆
dialogueIndex: true  # 是否扫描历史会话生成跨会话问答线索
reminders: true      # 是否注入 🔔 备忘录提醒候选
audit: true          # 是否运行每日确定性记忆体检
---
```

缺省字段用 preset 默认值（`agent.cordis.yml`），本文件只覆盖当前工作区；`enabled: false` 时该工作区记忆完全停用（文件保留、零注入）。安装时随模板写入 `<vault>/.deepseek/config.md`，也可手动创建。

### 6.6 手动 Obsidian 验证（无法自动化）

更新插件三件套（`main.js` / `manifest.json` / `styles.css`）后：

1. **重载插件**：Obsidian → 设置 → 社区插件 → 关闭再开启（或 Ctrl+P「Reload app without saving」）。
2. **服务自动启动**：确认右侧栏聊天 iframe 出现，`127.0.0.1:3180` 有响应。
3. **反馈链接**：让助手引用一条记忆卡，点回复末尾 `[✅ 这条对]` / `[❌ 这条错]`，确认卡片 frontmatter 的 `hook.verified` / `hook.success_rate` 被确定性改写。
4. **记忆面板**：打开面板，确认五层可浏览/搜索/编辑（mtime 冲突防护）、hook 统计与 📈 趋势可见。
5. **捕获策略下拉框**：设置页改 idea/fact/preference 档位，确认写回 `.deepseek/capture-policy.md`。
6. **归档**：点「归档 >90 天事件」，确认旧 episode 移入 `episodes/archive/` 且 index 同步。

### 6.7 环境变量对照（新名优先，旧名兼容）

> **完整参考见 [`docs/env-vars.md`](../env-vars.md)**（谁读、默认值、死开关、已知缺口），并由 `check-env-vars.mjs` 双向核对。这里只留最小的对照表。

| 新名 | 旧名（兼容） |
|---|---|
| `DSH_WORKSPACE_ROOT` | `DSH_OBSIDIAN_VAULT` |
| `DSH_MATH_MEMORY_LINK_URL` | `DSH_OBSIDIAN_LINK_URL` |
| `DSH_MATH_MEMORY_FEEDBACK_TOKEN` | `DSH_OBSIDIAN_FEEDBACK_TOKEN` |

### 6.8 已知遗留（非阻塞）

- 插件 id `dsh-math-assistant` 是稳定标识、永远不要改（有 `check-plugin-id.mjs` 守卫）。
- 更名是破坏性的：旧 `obsidian/` 目录会变成孤儿，`install.mjs` 会打印提示清理；完整「别名转发 shim」（旧 `--profile obsidian` 转发到新名）未做，需要可补。
- `agent.cordis.yml` 的 persona 文本仍自称「Obsidian knowledge-base assistant」，属语义解耦待办（见 handoff.md §7）。
