# 测试与验收（自动化 QA + 本地验收手册）

> 位置：`scripts/qa/`。目标：把「引擎正确性」与「agent 行为合规」两层验收变成可重复、可扩展、可计量成本的自动化流程；§6 为本地验收手册（安装 / boot 冒烟 / 手动 Obsidian 验证）。

## 1. 两层测试

### 引擎探针（零 token）

`scripts/qa/engine-probe.mjs`：对真实 vault 跑 ground-truth 召回断言（换说法/连字符变体/读取半径/无答案弱信号 12 组）。**零 token、秒级**，改打分器/语料组装后必跑。

- 断言三类：`must rank top-k`（目标文件须进入前 k 名）、`__WEAK__`（无答案查询 top-1 coverage 必须 < 0.35）；
- ground truth 与本机 vault 绑定（`DSH_WORKSPACE_ROOT` 可覆盖，旧名 `DSH_OBSIDIAN_VAULT` 兼容），vault 内容变化时同步维护断言。

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
3. **回归基线**：引擎探针结果存 JSON 基线（`qa/baseline.json`），CI 可比对；
4. **多 vault 探针**：engine-probe 支持自定义 vault + 用例文件，供他人复用；
5. **CI 边界**：引擎探针可进 GitHub Actions（无 vault 时用合成 fixture）；E2E 因需模型凭据与真实 vault，保持本机运行。

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
node dsh/install.mjs install --dsh-home "$tmp" --quiet
DSH_HOME="$tmp" dsh --profile notes-assistant --dump-config
```

应看到关键标记：`default: notes-assistant`、`mode: workspace-write`、`approval ... 'never'`、`defaultPreset: math-memory-locked`（不再挂载 `ui-skin-center` / `ui-web-ui-settings`）。Windows PowerShell 下用 `$env:DSH_HOME` 代替 `DSH_HOME=`。

### 6.3 正式安装

```bash
node scripts/deploy-local.mjs                                            # 本机一键部署（gitignored，含本机路径）
node dsh/install.mjs install --dsh-home "$DSH_HOME" --vault "<vault>"    # 纯 CLI
dsh --profile notes-assistant --port 3180 --patch "$DSH_HOME/profiles/notes-assistant/notes-assistant.patch.yml"
```

### 6.4 只装 preset（在主 dsh web UI 里用）

```bash
node dsh/install.mjs install --dsh-home "$DSH_HOME" --preset-only
```

装完后在主 dsh web UI 新建会话时选「数学笔记助手」preset，并把会话工作区设为笔记目录。注意：`--preset-only` 不装独立 profile，用的是主 dsh 的沙箱/审批（比独立 profile 的 fail-closed 宽松）；记忆文件仍写在工作区（默认 `.deepseek/`）。

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

| 新名 | 旧名（兼容） |
|---|---|
| `DSH_WORKSPACE_ROOT` | `DSH_OBSIDIAN_VAULT` |
| `DSH_MATH_MEMORY_LINK_URL` | `DSH_OBSIDIAN_LINK_URL` |
| `DSH_MATH_MEMORY_FEEDBACK_TOKEN` | `DSH_OBSIDIAN_FEEDBACK_TOKEN` |

### 6.8 已知遗留（非阻塞）

- 插件 id `dsh-math-assistant` 是稳定标识、永远不要改（有 `check-plugin-id.mjs` 守卫）。
- 更名是破坏性的：旧 `obsidian/` 目录会变成孤儿，`install.mjs` 会打印提示清理；完整「别名转发 shim」（旧 `--profile obsidian` 转发到新名）未做，需要可补。
- `agent.cordis.yml` 的 persona 文本仍自称「Obsidian knowledge-base assistant」，属语义解耦待办（见 handoff.md §7）。
