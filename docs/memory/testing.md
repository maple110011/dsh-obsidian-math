# 检索 v3 自动化测试（QA 工具）

> 位置：`scripts/qa/`。目标：把「引擎正确性」与「agent 行为合规」两层验收变成可重复、可扩展、可计量成本的自动化流程。

## 1. 两层测试

### 引擎探针（零 token）

`scripts/qa/engine-probe.mjs`：对真实 vault 跑 ground-truth 召回断言（换说法/连字符变体/读取半径/无答案弱信号 12 组）。**零 token、秒级**，改打分器/语料组装后必跑。

- 断言三类：`must rank top-k`（目标文件须进入前 k 名）、`__WEAK__`（无答案查询 top-1 coverage 必须 < 0.4）；
- ground truth 与本机 vault 绑定（`DSH_OBSIDIAN_VAULT` 可覆盖），vault 内容变化时同步维护断言。

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
- token 成本：每用例按历史事件的字符量估算（zh-heavy ×0.9），报告打印；后续可挂 `dsh-token-meter` 换精确计量。

## 2. 用法

```bash
npm run qa          # 只跑引擎探针（零 token）
npm run qa:e2e      # 引擎探针 + 真实会话 E2E（烧真实 tokens，需已配置模型）
node scripts/qa/e2e.mjs --cases my-cases.json --port 3192   # 自定义用例集
```

## 3. 环境依赖

- `DSH_HOME`（默认 `E:/software/deepseek-harness/.dsh`）、`DSH_OBSIDIAN_VAULT`（默认 `D:/Obsidian笔记数据库`）、`DSH_BIN`（dsh 启动脚本，默认安装路径）；
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
