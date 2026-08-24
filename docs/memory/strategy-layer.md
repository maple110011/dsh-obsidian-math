# 策略层设计规格（Strategy Layer）

> **状态：提案（未实现，待拍板）**。本文是「方法层 + 工作记忆 + iterative retrieval」的完整设计规格，拍板后照此实现。
>
> **背景**：四篇检索对齐文献（Dual RAG / QueryLink / HyPE / MemSearcher，见 `literature/notes/retrieval-alignment-2026-08.md`）与用户对「agent 自己的工作记忆」的讨论收敛出同一个缺口：现有 note_recall 是 **document-level retrieval**，无法充分利用数学个人知识库里「方法、思路、技巧」这一类策略性知识。
>
> **关联**：现状见 [`design.md`](design.md)；note_recall 现状见 [`retrieval-v3.md`](retrieval-v3.md)；本缺口在 [`assessment.md`](assessment.md) 第 2 轮已被点名为 P0-1（查询增强），本文把它从「方向」升级为「规格」。

## 1. 动机与诊断

数学问题与可用记忆之间存在四类 gap：

| gap | 含义 | 归属 |
|---|---|---|
| **lexical** | 用词不同（"依测度收敛加强到 a.s." vs 卡里写"Borel-Cantelli 子列"） | 检索器（BM25 词面） |
| **semantic** | 意思相关但词不同 | 检索器（需 embedding，我们没有） |
| **abstraction** | 问题在"具体"层、知识在"抽象"层 | **记忆怎么写**（不是检索器） |
| **procedural / strategy** | 存了"用户的数学知识"，没存"怎么攻一类问题"的方法论 | **缺失的一层** |

前两个由 note_recall（BM25 + hook 字段 + coverage 弱信号）部分缓解；后两个必须靠**新增一层**解决，而不是继续在 document-level 检索上打补丁。

## 2. 核心决策（已讨论拍板）

1. **策略卡独立成层，但 user + agent 统一**：一条技巧有没有用，不取决于它来自用户笔记还是来自 agent 解题；分界线是「长期 vs 短期」，不是「用户 vs agent」。
2. **高频/通用才沉淀，一次性的一次性**：复用现有 `hookPrior` promote/demote 当「频率计数器」，不靠模型自觉。
3. **显式字段 + 抽象阶梯**：卡片用显式字段（含 `abstraction: concrete/principle/generalize` 三段）。
4. **检索上限改步数限**：从「同一轮最多 2 次 note_recall」改为「1 次策略检索 + 最多 N 步内容检索」。
5. **trigger 两轴**：`difficulty`（困难）是主轴、跨算子；`domain`（算子）是软轴、同域偏好、跨域不硬拦。
6. **工作记忆覆写、不累积**：`working.md` 轮末一次覆写、有未闭合线程才写。
7. **检索目标固定枚举 + 版本化 + 审计演进**：复用 `HOOK_SCHEMA_VERSION` 模式。

## 3. 两层记忆模型

在现有五层（用户层）之外，新增一个**方法层**（长期）和一个**工作记忆**（短期草稿）：

```text
用户层（现状五层，几乎不动）
  profile / notes / records / theorems / templates / episodes / inbox

方法层（长期，user + agent 统一沉淀）        ← 新增
  .deepseek/strategy/<slug>.md

工作记忆（短期，agent 内，草稿）             ← 新增
  .deepseek/working.md   （覆写，非 append）
```

- **方法层**与用户层同属「长期记忆」，区别只是内容：方法层存「怎么攻一类问题」的策略，用户层存「用户的知识与事实」。来源差异用 `provenance` 字段标（`user` / `agent` / `both`），不分层。
- **用户自留备忘区**属于用户层（notes），与 agent 的 `.deepseek/inbox/` 并存、用途不同——用户有「随手记」的专门区域（如真实 vault 的 `1备忘录合集/`），agent 的 inbox 是「想法打磨」流水线。策略层的「候选沉淀」要把这两类都当输入源（见 §7），但不混为一谈。
- **工作记忆**不是「记忆」，是「草稿」：随轮次走、覆写零增长，只在有未闭合线程时存在。

## 4. 方法层：strategy 卡 schema

以「定义层证明的破局」为例：

```yaml
---
type: strategy                     # 新卡类型
title: "定义层证明的破局"
# ── trigger（两轴）──
difficulty: definition-level-proof # 困难轴：主轴（跨算子相通）
domain: [analysis, probability]    # 算子轴：软偏好（跨域可命中）
problem_type: proof                # 证明 / 计算 / 构造 / 验证
# ── 策略 × 检索目标（每对 move→retrieve）──
strategies:
  - move: 等价刻画
    retrieve: [similar-problem, theorem]
  - move: 反证法
    retrieve: [similar-problem, proven-path]
  - move: 凸分析标准技巧
    retrieve: [technique, theorem]
# ── 抽象阶梯（跨层级检索面）──
abstraction:
  concrete:   "定义层证明 → 等价刻画绕开逐字展开"
  principle:  "定义难证时，先找等价/更易验证的刻画"
  generalize: "任何『逐点/逐字展开太繁琐』的证明场景"
# ── 护栏（接 MemTrapBench）──
not_applicable_when: "等价刻画不存在或更繁时"
# ── 验证/来源（复用现有 hook 机制）──
provenance: agent                 # user | agent | both
verified: single-source           # single-source | cross-referenced | user-confirmed
success_rate: 0.8
uses: 3
source: [[episode-xxx]]           # 证据链必指 episode
---
```

**字段契约**：

| 字段 | 必填 | 语义 | 说明 |
|---|---|---|---|
| `type: strategy` | ✅ | 卡类型 | 与 record/template 并列的新类型 |
| `difficulty` | ✅ | 困难类型（跨算子） | 主轴；开放词汇，随使用沉淀 |
| `domain` | 可选 | 算子（软偏好） | 同域加分、跨域不硬拦 |
| `problem_type` | 可选 | 证明/计算/构造/验证 | 粗粒度题型 |
| `strategies[].move` | ✅ | 策略/方法 | 开放词汇（等价刻画/反证法/…） |
| `strategies[].retrieve` | ✅ | 检索目标 | 固定枚举（见 §8），每 move 一个或多个 |
| `abstraction` | 建议 | 具体/原理/一般化三段 | 跨层级检索面（见 §4.1） |
| `not_applicable_when` | 建议 | 何时不适用 | MemTrapBench 防固定护栏 |
| `provenance` | ✅ | 来源 | user/agent/both |
| `verified/success_rate/uses/source` | ✅ | 复用现有 hook 机制 | 与 record 卡完全同构 |

### 4.1 抽象阶梯（abstraction ladder）

三段各自是**独立的检索面**，让同一个技巧能在不同抽象层级被命中：

- `concrete`（具体）：这条经验最贴的原始场景，词面最接近原问题。
- `principle`（原理）：背后的通法，用**跨场景的中层词**表达（如「子列/对角线论证」「对偶」）。
- `generalize`（一般化）：还能迁移到哪些别的场景。

检索时三段分别与 query 打分后融合——用户问"怎么从依分布收敛拿到 a.s. 收敛"，即使词面与"Borel-Cantelli"无关，也能靠 `principle` 的"子列论证"命中。

## 5. 工作记忆：working.md

> 对应 Rethlas 的「迭代分治 + 子目标分解」——把上下文里的进度状态持久化，跨轮/跨上下文压缩存活；它不是新概念，是 Rethlas 工作流的「持久化」。

```markdown
---
updated: 2026-08-24
---
# 工作记忆（草稿，非长期记忆）

## 进度状态（transient，随轮次覆写）
- 当前问题：证明 S_n / E S_n → 1 a.s.（独立 Poisson）
- 当前子目标：把「依测度收敛」加强到「a.s.」
- 已证：子列存在性；已失败：直接 Chebyshev（不够）
- 已检索：note_recall「子列」→ [[memo-子列选取]]、[[record-快子列]] ✅；已排除 Riesz（条件不符）
- 下一步：按 strategy 卡「定义层证明」第 3 步查「反证法」相关卡

## 经验缓冲（轮末清空，流入长期层）
- 待沉淀·正确：快子列对「依测度→a.s.」有效 → strategy「收敛加强」candidate
- 待沉淀·错误：直接 Chebyshev 在此类失效 → strategy 反模式 / record 反例
```

**纪律**：

1. **覆写不 append**：每轮末写一次，文件永远几 KB；简单问答不写。
2. **有未闭合线程才写**：一轮问答已闭环则删除/清空 working.md。
3. **是草稿不是记忆**：内容可被下一轮随意推翻，不进长期层、不进体检、不参与 note_recall 语料。
4. **注入**：下轮开始时，若 working.md 非空，把「进度状态 + 下一步」注入系统提示（≤500 字符）；agent 也可主动读全文。
5. **经验流出**：经验缓冲只是「候选池」，轮末经 promote 门槛（uses/success_rate）才正式写入 strategy 层 / records；未达标的留在 episode，不进长期层。这正对应 Rethlas 的「识别共同失败 + 工作产物沉淀」——沉淀的是长期层，working.md 只做中转。

**成本**：一次覆写 ≈ 100~300 token 输出，仅在「有线程」的轮次发生；注入 ≈ 几百字符。对比一轮回答本身（500~2000+ token），开销 5~15% 且非每轮都有。

## 6. 读路径：iterative retrieval

```
1. 判困难：LLM 读原问题 → 判断「问题类型 + 当前困难」（如 proof + definition-level-proof）
2. 检索方法层：note_strategy(difficulty, domain) → 命中 trigger 匹配的策略卡（≤2 张，≤800 字符注入）
3. 按清单逐步检索：依 strategy 卡的 move→retrieve 清单执行，最多 N=4 步：
   每步 note_recall 一次（查询 = 当前 move 的蒸馏 + 已读到的技巧/定理名）
   读 ≤2 篇全文 → 逐条判适用性 → 产出（命中的技巧名/定理名/排除项）喂下一步
4. 每步按「适用性」重判（AGENTS.md §5 记忆适用性，防固定）
5. 收尾回写：成功/失败回写 strategy 卡（uses/success_rate）与 working.md（未闭合才写）
```

**检索上限**（替代「同一轮最多 2 次 note_recall」）：

- 每轮最多 1 次 `note_strategy`（方法层检索）；
- 最多 N=4 步内容检索，每步 note_recall 一次 + 读 ≤2 篇全文；
- 超限即当「记忆里没有」，明说。

## 7. 维护循环（复用现有体检）

一个 strategy 卡本质上是一张**带 hook 的记录卡**，因此现有 `hookPrior` + 每日体检 + `verified` 三级**天然就是「高频/通用才沉淀」的确定性判据**：

1. **候选产生**：三写时模型把「本轮用到的困难→策略」写进 `strategy/`（初始 `verified: single-source`、`uses: 0`），或只在 episode 留一句。**候选来源不止 hook 字段**——用户真实笔记里，技巧往往**内嵌在正文**（抄书笔记的 `>[!tip] 紧性证明技巧`、备忘的「关注对立性质的运用」这类 bullet）；体检/模型提炼时应把「内嵌技巧 callout + 用户备忘 bullet」也当候选源，而不只扫 hook 字段。
2. **确定性 promote**：每日体检统计同一「difficulty + move」的 `uses` 与 `success_rate`；`uses ≥ 3` 且 `success_rate ≥ 0.6` → 保持正式卡；未达标的留在候选区（`status: candidate`）。
3. **确定性 demote**：连续失败 3 次 → 体检 flag「建议补 `not_applicable_when` 或降级」。
4. **审计驱动词表演进**（§8）：体检统计 `difficulty` / `move` / `retrieve` 的实际使用频率，作为「该加/该减枚举值」「某困难缺策略卡」的被动信号。

> 与 record 卡的体检（strong/weak/unused/duplicate/结构校验）**同一条流水线**，只多两个分类：`candidate`（候选未达标）与 `stale-strategy`（触发条件失效）。

## 8. 检索目标枚举（固定 + 版本化 + 审计演进）

初始闭集（每个值在 note_recall 里 map 到一个检索动作）：

| 枚举值 | 含义 | 检索动作 |
|---|---|---|
| `similar-problem` | 类似问题 | note_recall 按「题型/困难」搜 templates/records |
| `technique` | 可迁移证明技巧 | note_recall 按「技巧名」搜 hook.techniques |
| `theorem` | 相关定理 | note_recall 搜 theorems/index + 笔记 |
| `proven-path` | 过去成功的证明路径 | 读 episodes + 相关 record 的 source 链 |
| `definition` | 定义/等价刻画 | note_recall 搜 definitions + notation |
| `notation` | 记号/术语约定 | 读 notation.md + profile |

**演进**：

- 枚举作为常量进内核（如 `note-tools.mjs` 的 `RETRIEVE_TARGETS`），加值 = 改常量 + bump `STRATEGY_SCHEMA_VERSION` + 更新模板。
- 旧卡遇到未知枚举值 → **优雅降级**为通用关键词搜索，不报错。
- 审计统计各值使用频率 → 决定加/减。

> **会长期演进的不是这个枚举，而是开放词汇**：`difficulty`（困难）与 `move`（策略）是开放字段，随使用沉淀新卡即可，不动 schema。

## 9. 与现有系统的关系 / 迁移

**新增（不改动现有）**：

- `dsh/templates/strategy/_README.md` + `strategy/index.md`（模板，随三路安装）。
- `.deepseek/strategy/` 目录纳入 note_recall 统一语料（新 kind `strategy`）。
- 新工具 `note_strategy`（方法层检索：difficulty 硬匹配 + domain 软加权 + abstraction 三段打分）。
- `working.md` 模板 + 注入（`buildMemorySection` 加「工作记忆」段，≤500 字符，空则跳过）。

**改造（兼容，不破坏）**：

- `note_recall` 的 `operator` 硬过滤改为**策略卡的 `domain` 软加权**——现状会把「跨算子但策略近」的卡硬丢掉（Dual RAG 说的"语义远但策略近漏检"），策略卡不沿用这个硬过滤。
- `kind-aware passage`（note-tools.mjs `composePassage`）加 `strategy` 分支：强调 `difficulty/strategies[].move/abstraction` 三段。
- AGENTS.md 增「策略层路由 + iterative retrieval + working.md」纪律；`hook` 纪律同步 `difficulty/move/retrieve` 字段。

**迁移**：

- 现有 records/templates 的 `hook.applications` 措辞改为「问题式」（这条卡能回答/解决哪些问题），与 query 挑战对齐（Dual RAG / HyPE / QueryLink 共识），不改 schema。
- 现有 `hook.operator` 继续有效；新增 `difficulty` 为可选字段，旧卡无 `difficulty` 时策略检索按 `domain` 兜底。

## 10. 成本预算

| 项 | 预算 |
|---|---|
| 方法层检索注入（命中策略卡） | ≤2 张 / ≤800 字符 |
| working.md 注入 | ≤500 字符（空则跳过） |
| iterative retrieval | ≤1 次 note_strategy + ≤4 步 note_recall，每步读 ≤2 篇全文 |
| 抽象阶梯三段 | 每段 ≤80 字符（避免卡片膨胀） |

### 10.1 token 控制（关切：会不会更耗）

策略层的定位是「**花小钱导航、省大钱检索**」，不是无条件叠加：

- **阶梯触发（零增量路径）**：简单事实/笔记查询**不**走 note_strategy（直接 note_recall 命中即可，0 增量）；只有「证明/构造类」或「直接 recall 空结果 / coverage<0.35」才升级到策略层 + iterative——这是现有「空结果改写重试」的扩展。
- **有界**：note_strategy ≤2 卡 ≤800 字符；iterative ≤4 步，每步读 ≤2 篇（与现状「读前 2-3 条」同级）；超限即「明说没有」。
- **条件写**：working.md 只在有线程时写；strategy 回写只在 promote（uses≥3）时发生，不是每轮。
- **可置换**：若实测固定注入过重，可用策略层/工作记忆**置换一部分 dialogue index 注入**（跨会话问答线索 3000 字符是最大可让位项），净额可负。
- **实测回退**：仓库已有 dsh-token-meter + E2E usage 计量；实现后对比「有/无策略层」每轮 token，超标即瘦身或回退。

预期：简单轮 ≈ 0 增量；证明类轮最坏 ≈ +2K token，但因导航更准、少做盲搜与少读全文，净额通常持平甚至为负（**以实测为准，不作为承诺**）。

## 11. 未决 / 延后

1. **`note_strategy` 的打分公式**：difficulty 硬匹配 + domain 软加权 + abstraction 三段各占多少权重，实现时用引擎探针定（先给初值 0.5 difficulty + 0.2 domain + 0.3 abstraction，探针后调）。
2. **工作记忆是否注入、何时清空**：先按 §5 的「非空才注入 + 闭环清空」，实际体验后再调。
3. **embedding（Tier B）**：仍延后；策略层的 abstraction 阶梯是"手工语义层"，先验证它能否替代 embedding 的部分效果，不行再上 Tier B。
4. **候选区 `status: candidate` 的存放**：与正式卡同目录（`strategy/`）用 status 区分，还是单独 `strategy/candidates/` 子目录，实现时定（先倾向同目录 + status）。
