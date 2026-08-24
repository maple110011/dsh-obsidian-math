# 基准测试设计规格（Benchmark）

> **状态：已实现并实测**。仿真 vault（`scripts/qa/benchmark-vault/`）+ 零 token 探针（`scripts/qa/seed-probe.mjs`，8/8）+ 8 维度用例（`scripts/qa/benchmark-cases.json`）+ baseline.json 记录 + session log 归档（`e2e.mjs`）已全部搭好；真实 token E2E **8/8 通过**（deepseek-v4-flash，见 `docs/memory/changelog.md` 本轮条目）。本文是「记忆系统运行效果 + tokens/时间成本」基准的完整设计规格。
>
> **背景**：现有基准只有用户当初"随便问的"几道 E2E 用例 + 绑真实 vault 的引擎探针，既不系统、又因真实 vault 持续变动而 ground truth 腐烂。策略层（`strategy-layer.md`）落地后，尤其需要一套系统基准来衡量它「是赚是赔」。
>
> **关联**：`testing.md`（QA 方法论）、`strategy-layer.md`（被测对象）、`literature/`（维度来源：Dual RAG / QueryLink / MemTrapBench）。

## 1. 目标与原则

1. **测两件事**：记忆系统「运行效果」（召回、溯源、防幻觉、适用性、写回）与「成本」（tokens、时间）。
2. **ground truth 不腐烂**：基准的锚不绑用户真实 vault，而是绑**基准自有的仿真 vault**（见 §3），用户平时怎么改笔记都不影响基准。
3. **可复现、可对比**：每次运行产出结构化快照（§6），改一次代码就能看出哪维度退化、token 涨跌。
4. **按代价分层**：零 token 的检索正确性进 CI，真实 token 的行为/成本本机跑——贵的测试只跑必要的那套。

## 2. 两套分层

| | 套 A · 引擎探针 | 套 B · 端到端会话 |
|---|---|---|
| 代价 | 零 token、秒级、可进 CI | 真实 token、本机跑、贵 |
| 测什么 | 检索器**隔离**的正确性（note_recall / note_strategy 命中率、覆盖率） | 完整 agent 的**行为**（用没用对记忆、溯没溯源、诚实不诚实）+ 成本 |
| 现状 | engine-probe.mjs 已有 12 组 | e2e.mjs + cases.json（就用户那条随便问的） |
| 目标 | 扩充到覆盖全维度（约 24 组），改打分器必跑 | 系统化成 8 维度 × 1 题，跑通后扩到 2 题 |
| ground truth | 仿真 vault（冻结） | 仿真 vault（检索维度冻结 GT）+ 结构性断言（行为维度） |

「效果 / tokens / 时间」不是三套题，是**同一套题上的三个指标**：每个用例既判 PASS/FAIL（效果），又记 token 分项与 latency（成本）。

## 3. 仿真 vault（seed vault）

基准自有的、冻结 ground truth 的仿真 vault，只含**数学 + 统计**，按用户的四种真实笔记风格 + 异构 + 噪声构建。

### 3.1 目录结构

```text
benchmark-vault/
  数学/
    分析学/对角线式方法.md          ← 方法卡（干净结构，不用用户散标记）
    实分析/某定理.md                ← 抄书式（prose + >[!theorem] + 内嵌 >[!tip] 技巧）
    概率论/某收敛定理.md            ← 抄书式
    线性代数/某方法.md              ← 方法卡
    某stub.md                       ← 一行 stub（异构/噪声）
  统计学/
    概率论/某引理.md                ← 抄书式 + #亟待修改 草稿
    方法论/某技巧.md                ← 方法卡
  备忘录/
    杂想.md                         ← 随手备忘式（flat bullet 掺技巧顿悟）
    某方向探索.md                   ← 结构化备忘式（分节）
  .deepseek/
    memory/records/…                ← 3-5 张记录卡（fact/artifact + hook）
    memory/theorems/index.md        ← 定理索引
    memory/templates/…              ← 2-3 张模板卡
    memory/episodes/…               ← 2-3 条 episode（证据链）
    strategy/…                      ← 3-4 张策略卡（新，见 strategy-layer.md）
    inbox/…                         ← 1-2 条 agent memo
    notation.md / profile.md
```

### 3.2 四种笔记风格（从用户真实 vault 采样）

| 风格 | 样本 | 特征 |
|---|---|---|
| 方法卡 | 对角线选取方法 | 加粗标记分块（原理/作用/如何推广/经典战役）+ `>[!remark]` 感悟 + wikilink |
| 抄书 | 最优传输 1/2 | 长文 prose + LaTeX + `>[!definition/proposition/tip/lemma/theorem]` + 完整证明 + 内嵌技巧 callout |
| 随手备忘 | 待整理杂记 | 一长串 flat bullet，杂想/疑问/技巧顿悟混排 |
| 结构化备忘 | BDL 探索记录 | 分节（备忘/知识/方向/资源）+ 带链接 bullet + 个人疑问 |

### 3.3 噪声（模拟"乱和散"）

- 一行 stub（如"不能随意换序的反例"一句）；
- `#亟待修改` 草稿；
- 跑题半成品（同领域但无关的内容）；
- 同一个概念的多份近似重复（测去重/合并）。

### 3.4 ground truth 锚定

仿真 vault 冻结，每个检索维度 query 都有一条稳定映射 `query → 应命中的 top-k 卡`。检索机制（BM25 + hook 字段 + 抽象阶梯）是内容无关的——它在仿真 vault 上命中，就会在用户真实笔记上命中。

## 4. 八个考察维度（套 B）

| # | 维度 | 考察什么 | 断言 |
|---|---|---|---|
| 1 | 检索召回·换说法 | 换措辞还能命中 | mustUse note_recall + mustRead 目标文件 |
| 2 | 检索召回·抽象层级 | 具体问题命中抽象原理卡 | 命中 abstraction 卡 |
| 3 | 策略召回 | 技巧/方法类命中 strategy 卡 | mustUse note_strategy + 按 move→retrieve 走 |
| 4 | 证据溯源 | 答案带 source 回 episode | mustRead episode + 引用带 source |
| 5 | 防幻觉 | 库里没有的明说没有 | mustContain「库里没有」 |
| 6 | 记忆适用性 | 陷阱题（别被记忆带偏） | mustNotContain 被带偏的答案 |
| 7 | 跨会话续接 | working.md / dialogue index 续上 | 第二问用上第一问的上下文 |
| 8 | 写回/体检 | 三写落盘 + 体检发现结构问题 | 会话后 records/index 有新增 + 体检报告 |

断言格式沿用 `testing.md` 的 `cases.json`：`mustUse` / `mustRead` / `mustContain` / `mustNotContain` / `answerNotEmpty`。第 1-3 维的 `mustRead` 绑仿真 vault 的冻结路径；第 4-8 维是结构性断言，不绑具体文件。

## 5. 成本记录

每用例记：

- **tokens**：input / output / reasoning / cacheRead（dsh-token-meter 已提供，usage 在 `assistant/chunk` 块里）；
- **时间**：首 token 延迟 + 总时长；
- **对比基线**：同一批题「有/无策略层」的 token 差（这是 strategy-layer.md §10.1 里 open question 的答案）。

## 6. 结果记录（baseline.json）

每次运行追加一条快照（不覆盖）。核心原则：**原始痕迹靠引用 session log（dsh 已持久化完整对话 + tool 轨迹 + 每 chunk 的 token usage），baseline.json 只记 session log 里没有的元数据 + 判定 + 汇总**，保证"跑完发现缺信息"不可能发生。

```json
{
  "run": {
    "id": "run-2026-08-24-001", "startedAt": "…", "endedAt": "…",
    "git": { "commit": "abc1234", "dirty": false },
    "env": { "node": "24.14.1", "os": "win32-x64", "dsh": "0.1.1-rc.2" },
    "model": { "name": "…", "temperature": 0.7, "maxTokens": 8192 },
    "seedVault": { "version": "1.0", "sha256": "…" },
    "config": { "suite": "e2e", "strategyLayer": "on" }
  },
  "cases": [
    {
      "id": "recall-paraphrase", "dimension": "检索召回·换说法",
      "question": "…",
      "expected": { "mustUse": ["note_recall"], "mustRead": ["…"], "mustContain": ["…"], "mustNotContain": ["…"] },
      "sessionId": "…",
      "verdict": {
        "pass": true,
        "assertions": [
          { "type": "mustUse", "target": "note_recall", "ok": true },
          { "type": "mustContain", "target": "库里没有", "ok": false, "actual": "…" }
        ]
      },
      "trace": { "toolsUsed": ["note_recall", "read"], "filesRead": ["…"], "recalls": 1 },
      "cost": {
        "turns": 1,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0 },
        "latencyMs": { "firstToken": 0, "total": 0 }
      }
    }
  ],
  "summary": {
    "passRate": "6/8", "byDimension": { "recall-paraphrase": true },
    "totalTokens": 0, "avgLatencyMs": 0,
    "diffVs": "run-2026-08-23-001",
    "tokenDelta": { "input": -500, "output": 0, "reasoning": 0, "cacheRead": 0 }
  }
}
```

**字段说明**（每类都回答"事后诊断需要什么"）：

| 字段 | 为什么需要 |
|---|---|
| `run.git.commit` + `dirty` | 结果必须能对应到具体代码版本，否则无法归因 |
| `run.model.*`（含 temperature/maxTokens） | 生成参数影响结果与成本，缺了无法复现 |
| `run.seedVault.sha256` | 检测种子是否被意外改动 |
| `cases[].question` + `expected` | 事后复核"考的是什么、预期是什么、pass 判得对不对" |
| `cases[].sessionId` | **原始痕迹引用**：完整对话/tool 轨迹/逐 chunk token 在 session log 里 |
| `cases[].verdict.assertions[]`（含 actual） | 知道**哪条**断言挂了、实际 vs 预期差在哪 |
| `cases[].trace` | 工具/文件/检索次数摘要，快速定位 |
| `cases[].cost.turns` + 逐轮 token | E2E 是多轮的，逐轮 token 才能定位"哪轮最贵" |
| `summary.diffVs` + `tokenDelta` | 跨次对比，识别退化/成本变化 |

快照可横向对比「改前 vs 改后」，让每次"贵而耗时"的测试都变成一条可追溯的历史。

> **⚠️ session log 不能只引用，要归档**：dsh 的 session log 可能被轮转/清理（dialogue index 只读最近 20 个），所以跑完一次基准后，应把 `sessionId` 对应的 `.jsonl.zstd` **复制**进基准归档目录（如 `qa/runs/<runId>/`），与 baseline.json 同目录存放——否则"引用"会在日志被清理后变成死链，关键原始痕迹照样丢。

## 7. 与现有 QA 的关系 / 迁移

- `engine-probe.mjs`：**默认迁到仿真 vault**（冻结 GT），真实 vault 变成可选覆盖——解决"ground truth 绑真实 vault、内容变化就烂"的旧痛点。
- `qa/e2e.mjs` + `cases.json`：从"那条随便问的题"扩充到 8 维度 × 1 题。
- 用户真实 vault：**只做"真实使用 smoke test"**（主观体验，不打分），不进基准。

## 8. 未决 / 待办

1. **仿真 vault 的具体内容**：目录结构已定，但每条笔记/卡的具体文字待写——将按 §3.2 的四种风格 + 用户真实笔记采样来写，写时需再核对几份真实笔记。
2. **套 B 题目文字**：8 题的题目/预期行为待定（实现时逐条写，第 3 维"策略召回"要等策略层实现后再定 ground truth）。
3. **是否加"时间成本"断言**：latency 先只记录、不设阈值（本机环境差异大），积累几轮基线后再定是否设上限。
