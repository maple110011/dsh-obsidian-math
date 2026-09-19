# 研读记录：Danus — Orchestrating Mathematical Reasoning Agents with Fact-Graph Memory

## 0. 元信息

- **citekey**：`liuDanusOrchestratingMathematical2026`
- **标题**：Danus: Orchestrating Mathematical Reasoning Agents with Fact-Graph Memory
- **作者**：Jihao Liu, Guoxiong Gao, Zeming Sun, Bin Wu, Shurui Liu, Jiedong Jiang, Haocheng Ju, Leheng Chen, Ronnie Cheng, Xiping Zhang, Bin Dong（北大 / 京都大 RIMS / 天津大 / 中关村学院 / Stanford / 西湖大 / 同济 / 大湾区大学）
- **年份**：2026（arXiv:2607.06447）
- **阅读日期**：2026-09-18
- **阅读方式**：MinerU 全文通读（`.raw/liuDanusOrchestratingMathematical2026/full.md`，362 行，含正文 §1–§5 与参考文献）
- **源质量**：`full.md` 在数学排版区有轻度 OCR 噪声（`efectively`、`dificulty` 这类连字丢失，单字 `suffices` 被读成 `sufices`，两处公式含多余上标）。本笔记引用的**每一个规模数字与机制表述都已与同目录 `full.txt`（pdftotext -layout，985 行，可信文本层）逐条交叉核对**（如 3,157 / 8,616 / 54 / 664 / 784 / 77 / 687 / 23 / 21 / 100 / 15 / 37 / 63 / 239 / 636 / 151 / 25 / 91 / 49）。含公式的定理陈述（§3.4 的包络区间）也已与 `full.txt` 第 558–564 行核对一致。无一处事实依赖被破坏的段落。
- **同一论文的另一张卡**：`literature/cards/danusFactGraphMemory2026.md` 是本文的**网页源卡片**（arXiv 摘要 + pin commit `7a51336e53cd1d558d0e766a61eb0fed46ebb05b` 的仓库 README），明确标注"未逐字通读论文正文"。本笔记以全文为准；两者的逐条差异见 §13 末。

---

## 1. 一句话定位

Danus 把"研究级数学证明搜索"从**单条推理线**扩成**多条并行线**，靠两件事使并行不互相污染：一张**唯一事实来源的事实图**（verified fact 的 DAG，边是逻辑依赖），和一个**无状态验证器**（唯一正确性权威、唯一写门）。核心主张是**权力分立**——规划者、证明者、裁决者三类 agent 各自只拿自己的技能与**角色门控的工具表**，使"把未验证的数学引入事实图"在**结构上不可为**。

---

## 2. 问题与动机

论文的 gap 陈述（§1）值得逐条记住，因为它对"记忆系统的写入纪律"是直接类比：

- 现有数学 agent（Aletheia / Rethlas / QED / ProofCouncil / AI co-mathematician）几乎都内含 generate–verify–revise 循环，且其中的"multi"指的是**角色分工不同**，而不是**直接参与证明生成的 agent 数量**。
- 增加参与证明生成的 agent 数量**不是**简单多开几个：**多 agent 的共享记忆若处理不当，会混淆 agent、传播无关或错误的中间产物，最终损害性能**（原文：`If the shared memory of multiple agents is not handled appropriately, it can confuse the agents, propagate irrelevant or erroneous intermediate artifacts, and ultimately hurt performance.`）。
- 前身 Rethlas 用**单个 Markdown blueprint** 承载全部支撑引理、定义与最终定理；worker 反复编辑这一个文件并请验证器检查。这带来两个问题：**每个 worker 必须背负整条累积证明**（上下文膨胀、无关内容干扰推理）；**一个文件无法被多个 worker 并行编辑**。
- 于是 Danus 的动机等价于一句话：**把"一个越来越大的共享文档"换成"一张可按需取用的图"**，把上下文管理问题（每个 agent 只看它当前 claim 需要的事实）与并行写入问题（贡献累加而不冲突）一并解决。

---

## 3. 记忆结构

Danus 的记忆是**明确分层的，而且层级之间有一条"是不是真相"的硬边界**：

### 3.1 事实图（fact graph）——唯一真相

- 形态：**DAG**，节点 = fact，边 = 逻辑依赖。**fact = 一条数学陈述 + 一份被验证器检查过的证明**；边的方向是"另一条 fact 的证明用到了这一条"，即 `edge from A to B` 表示 **B 的证明使用 A**，A 成为 B 的**入边**。
- 写入者标注依赖：worker 提交新陈述与证明时，**自己记录该证明依赖的 fact 的标识符**，这些标识符成为新 fact 的入边。
- 唯一性：**事实图是整个系统唯一的事实来源**（unique source of truth）；验证通过的每条陈述都进图，图一直增长到包含目标定理。
- 可见性：原则上 worker 可访问**整张图**；实践中它**检索图**取相关 fact（`fact_search`）。

### 3.2 事实图之外的 memory（不是真相）

- **两层**：
  - **每个 worker 的私有 local memory**：自身活动的连续日志（running log），用途主要是事后分析某条推理线是怎么发展的。
  - **全局 memory**（所有 worker 与主 agent 可读写）：记录搜索的中间产物——**计划、有希望的方向、死胡同、构造出的例子与反例**，以及**每一次 GPT-5.5-pro 咨询的 prompt 与 reply**。
- 定位（原文的一句关键限定）：**memory 不是真相的一部分**（`Memory is not part of the truth`），它是共享上下文，作用是**让 worker 不重复彼此的失败尝试**，并让主 agent 保留对推理策略与计划的整体把握。

> 对笔记系统最重要的一点：Danus 把"经过验证的真相"与"有助于工作的上下文"**分在两个容器里**，而且**禁止二者互相冒充**。顾问模型的输出（GPT-5.5-pro）**只进 memory，永不进事实图**。

---

## 4. 写路径（固化）

### 4.1 触发与粒度

- worker 在**主 agent 指派的任务**下工作，**典型情况是一次只专注一条 claim**：一个引理、一个反例、或一个玩具例子，**而不是整条证明**。
- 写入门槛是**一条 claim 一条证明**：worker 反复把这条 claim 提交给验证器，**在验证器的反馈下修改**，直到通过；通过后该 claim 作为 fact 进图。
- 依赖标注：入图时记录它依赖的 fact 标识符（见 §3.1）。

### 4.2 为什么"一次一条"是核心设计（原文的两条理由）

1. **上下文小**：单 blueprint 迫使每个 worker 背负整个累积证明；事实图让每个 worker 只取当前 claim 需要的事实、一次提交一条，**于是工作上下文保持很小，而证明可以长到很多页**。
2. **可并行**：单文件难以被多个 worker 同时编辑或用于不同进攻路线；事实图让贡献**累加**成一份共享结构。

### 4.3 撤销（revocation）——写入的逆操作

- 一条后来被发现错误的 fact，**连同所有直接或传递依赖它的 fact 一起被移除**（级联删除）。
- 触发情形**恰好两种**（原文列举）：
  1. **被引用文献本身有错**——通常由 agent 在最终 review 时发现，或由人类专家指出；
  2. **概念混淆或证明有缺陷**——原文明确说这更少见（`more rarely`）。
- 真实频次：**在作者们的运行中，撤销只被需要过一次**（§4.3 再次强调：`revocation, the graph's repair channel, was needed only once`，对应 §3.5 那个 23 条 fact 的撤销）。
- 注意撤销是**级联删除**而不是"标记失效"——这依赖 DAG 的入边信息完整（每条 fact 记录全部逻辑依赖）。

---

## 5. 读路径（检索）

- worker 对图的操作被抽象成 **MCP 工具 `fact_search`**（见 §8 的工具表）；**原则上可用整张图，实践中靠检索**取当前 claim 需要的事实（§2.2 原文：`in principle it has access to the entire graph, and in practice it retrieves the relevant facts by searching it`）。
- 图的**读取端不止 worker**：验证器也读（`reads the fact graph as files`），主 agent 也读（它每 1–2 小时 re-read workers 的 log、memory 与 fact graph 来做状态摘要与再分配）。
- 检索的**空结果语义**论文未形式化；但 §4.4 给出一个重要的量级感：worker 做第 10 个任务时，继承的是**摘要**（前 9 个任务的教训），**而不是五天的日志**——即"读路径是有损压缩，且压缩由主 agent 的 summary 承担"。
- 文献检索是**另一个工具**（`Matlas`，语义搜索引擎），**worker、主 agent、验证器三者都可用**——注意验证器也能查文献，这是它能判断"被引用陈述是否存在且适用"的前提。

---

## 6. 组织与关系

- **组织形态就是 DAG 本体**：没有额外的分类法/tag 层；`有什么` 与 `取什么` 之间的桥是**依赖边 + 检索**。
- 图的**簇（cluster）语义**在 §3.6 的图上被明确读出：3,157 条 fact 的图里，簇对应**不同的进攻路线**——底部是**最终证明从未引用的条件性脚手架**，左侧是**其中一条界（Chern-number bound）的独立重推**，右上角是**结果的 integral lift**，其最终路线进入了证明。也就是说：**图记录的是搜索的历史形状，不只是最终证明的支撑集**。
- **"哪些 fact 支撑了定理"是一个可计算的子集**，论文多处给出这个数：§3.6 是 **664**（支撑闭包）对 3,157（全图）；§3.2 是 **77 / 784**；§3.4 是 **37 / 100**；§3.5 是**约 10 条**闭合对 687 条。**支撑闭包可以远小于全图**，论文把这当作正常现象而非噪音（§4.4：`only 664 of them support the theorem, and the rest record how widely the system searched`）。
- 论文写作阶段还有一次**结构再组织**：从图到线性散文需要动机、与发现顺序不同的呈现顺序、省略例行细节（§4.2）；以及 `paper_subgraph` 这个工具（见 §8 工具表）——即**按子图取材料来写**。

---

## 7. 维护与自改进

- **主 agent 的策略循环**（§2.4）就是维护循环：
  - 起始：读懂人类专家给的任务 → 咨询 GPT-5.5-pro 取高层策略 → 给 worker 分配初始方向。
  - 周期（**每 1–2 小时**）：re-read worker 日志 + memory + fact graph → 理解当前状态与**卡在哪** → 产出状态摘要 → 问 GPT-5.5-pro 下一步战略 → 重新分配 worker。
  - 终止条件**不是预设轮数**：**只有当主 agent 确认目标陈述或其否证已经作为已验证 fact 出现在事实图中时才停**。
- **放弃路线的判据被形式化为一个二分类**（§2.7 末）：给 GPT-5.5-pro 的状态摘要中，**每一条停滞的路线必须被归类为**
  1. **方法的失败**（陈述仍然活着），或
  2. **对该陈述本身的证据**（据此主 agent 决定放弃这条路）。
  这个区分是"放弃一条路线"的决策依据。
- **摘要纪律是一组禁令而非写作指南**（§2.7）：进度报告由**隔离的 agent** 写，它**只收到问题陈述与已验证数学，系统内部的一切都被剥离**（因此报告不可能提到作者没见过的东西）。技能内容：
  - **绝不数字化估计进度**；
  - **只有当一条已验证 fact 在没有任何未匹配假设的情况下确证了结果时**才报告为已证明；
  - 默认**报得更弱**（`the default is to report it as weaker`）。
  动机原文：模型自行总结时会**乐观**——"一个还差一个未匹配假设的条件论证会被写成 essentially complete"。
- **写作阶段的重做循环**（§4.2）：先把草稿写得可读，然后**整份稿件必须作为写成的样子通过验证器**，不通过就修再审——"worker 的 submit–verify–repair 循环被提升到整篇论文"，区别是主 agent 面对验证器但**不写新 fact**，它只从图里取已有 fact 更准确地复述。
- **审计工具**（主 agent 工具表里）：`reference_audit`、`reference_verify`、`paper_verify_math`、`paper_revise`——即**引用审计、引用核验、稿件数学核验、稿件修订**是四个独立动作。

---

## 8. 验证与质量门控（重点）

### 8.1 验证器的形态与权限边界

| 维度 | 论文事实 |
|---|---|
| 形态 | **以服务形式运行**，**worker 与主 agent 都可以调用** |
| 无状态 | **每次提交由一个全新实例判定，判完不留任何状态**（`a fresh instance judges each submission and retains nothing afterwards`） |
| 读权限 | **被允许读事实图**，因此当一份证明依赖其它 fact 时，它能**追踪这些引用并检查依赖** |
| 写权限 | **没有 `fact_submit`**（见工具表）；图里只有"验证通过"这一个入口 |
| 输入 | **一条陈述 + 它的证明**，证明中**引用图中已存在的 fact**（引用以 fact 标识符标注，成为新 fact 的入边） |
| 输出 | **accept 或 reject**；reject 附 **repair hints（修复提示）**；此外还会产出 `synthesize-verification-report` |
| 检查技能 | `verify-sequential-statements`（逐步检查证明）、`check-referenced-statements`（确认**被引用的陈述存在且适用**）、`synthesize-verification-report` |
| 可用工具 | 从 Figure 4 的结构看，验证器一栏只有 **`Matlas`** 一项工具，另注明 **`reads the fact graph as files`**（把事实图**当文件读**）；**没有写类工具** |

> Figure 3 的字面契约（从 `full.txt` 第 293–308 行读出）：`worker --submit(statement + proof, citing facts already in the graph)--> Verifier`；验证器 `stateless · a fresh instance per submission`，`reads cited facts` → `fact graph`；出口两条：`accept` → `verified fact stored`，`reject` → `repair hints / proof rejected` → `revise and resubmit`。

### 8.2 三类 agent 的角色门控工具表（Figure 4，逐条照抄）

| | 主 agent（global planning and orchestration） | Worker × N（autonomous proof search） | Verifier（stateless · sole authority on correctness） |
|---|---|---|---|
| SKILLS | `initialize`、`elaboration`、`consult`、`human-summary`、`write-paper` | `obtain-immediate-conclusions`、`construct-toy-examples`、`construct-counterexamples`、`propose-subgoal-decomposition-plans`、`direct-proving`、`identify-key-failures`、`search-math-results`、`query-memory`、`verify-proof` | `verify-sequential-statements`、`check-referenced-statements`、`synthesize-verification-report` |
| MCP TOOLS | `global_memory_add`、`global_memory_search`、`fact_search`、`fact_revoke`、`Matlas`、`summary_write`、`paper_subgraph`、`paper_write`、`reference_audit`、`reference_verify`、`paper_revise`、`paper_verify_math` | `global_memory_add`、`global_memory_search`、`fact_search`、**`fact_submit`**、`Matlas` | `Matlas`（＋`reads the fact graph as files`） |

三条从这张表直接读出的事实：

1. **主 agent 没有 `fact_submit`**：负责指挥搜索的 agent 在**结构上**无法把未验证的数学引入事实图（§2.4 原文：`The system thereby maintains a separation of powers, preventing the agent that steers the search from introducing unverified mathematics into the fact graph.`）。
2. **验证器没有写工具**：它连 `global_memory_add` 都没有，只有 `Matlas` 与读图。它的唯一输出是判定与报告。
3. **`fact_revoke` 在主 agent 手里，不在验证器手里**：撤销是编排动作，不是判定动作；worker 也没有 revoke 权限。

另外：还有一个**小的 CLI** 让主 agent `start / assign / monitor / stop` worker（`danus new · assign · start · status · stop · list · finalize`），即 worker 的**生命周期由主 agent 控制**。

### 8.3 精度：论文自己报的数字与失败模式

- 原文（§2.5）：`Owing to the skills and checking procedure carefully engineered in Rethlas, the verifier produced essentially no false positives on the problems we tested.`
- **论文用 `false positives` 指代的是"放过了错误的证明"**（也就是我们通常说的 false negative / 漏放），因为它给出的两个实例都是**不该接受却接受了**：
  1. 接受了**含有少量被跳过步骤**的证明；
  2. **因为把被引用的文献当作正确**，接受了依赖**错误引用**的证明。
- 两类失误被论文判定为"**在最终 review 中都很容易抓到**"，这正是事实图能当真相来源的理由。
- §4.3 重申并收紧了表述：验证器**几乎从不接受有缺陷的证明**（`almost never accepts a flawed proof`）；**实验中记录的少数失误都在最终人工审查中抓到**；§4.5 补充"总共只观察到**一只手数得过来**的验证器错误，多数源于被引用文献的陈述不精确或错误"。
- **验证器的精度是架构的承重假设**（§4.3 原文）：worker **信任每条已存在的 fact 而不重新推导**，因此一条 fact 的可靠性只等于它下面的一切；§3.6 的定理压在 **664 条支撑 fact、链深至 54** 的结构上，**这种深度的结构完全押在验证器上**：验证不精确 → 误差沿链累积 → 上层 fact 不可靠 → 长程推理不可能；验证精确 → 累积是安全的。
- **已知的一个"不会报错"的方向**：验证器**把被引用的文献陈述当正确**，所以文献本身的错会**静默通过**，只有人工审查或后续发现才能揭出（§3.5 就是一次：某参考文献里 `nilpotent` 的定义本身是错的，而该错误经由引用**传播进了论证的一步**）。这属于**验证器能力边界之外**的问题，被论文归为"最终全靠专家审查解决"。

### 8.4 二级验证器：论文级（paper-level）验证

这是**与 fact 级验证完全不同的一道门**，论文给的理由很硬（§2.7、§4.2）：

- **事实级验证不可转移**（`Fact-level verification does not transfer`）。把图变成线性散文**创造了从未成为 fact 的新数学**：
  - 被压缩的步骤；
  - "只需……"型的化归（`it suffices to` reductions）；
  - **在陈述"接近但不完全相等"的 fact 之间做的粘合**（`glue between facts whose statements nearly but not exactly meet`）。
- 因此**正确的 fact 可以被缝成不正确的稿件，错误出现在接缝处**。
- 稿件的验证方式：**整份草稿回到验证器，按写成的样子审，反复修订直到通过**（§3.3 与 §3.6 都有实例：草稿被拒→按验证器的 findings 修订→通过）。
- **长文的分片规则**：当稿件长到不能一次通过时，主 agent 把它**切成自包含的部分，每部分以一个指定结果收尾，并把它依赖的结果作为"已确立的陈述"带上**——目的是让验证器**判一份完整文档，永远不判碎片**。
- **被压缩成断言的地方，原始证明被重新提供并完整渲染**。
- 稿件级的角色约束同 fact 级：**主 agent 面对验证器，但不写新 fact**，每轮修订都是**从图里取已有 fact 更准确地复述**（§4.2）。

### 8.5 验证器之外的兜底层（谁有权改什么的总表）

| 动作 | 谁做 | 依据 |
|---|---|---|
| 提交 claim + 证明 | worker（`fact_submit`） | 一次一条 |
| 判定 accept/reject + 修复提示 | verifier（`fact_revoke` 不在它手里） | 无状态、全新实例 |
| 撤销 fact 及传递依赖 | 主 agent（`fact_revoke`） | 引文错误 / 概念混淆 / 证明缺陷 |
| 写进度报告（对外） | 隔离的写作 agent，只拿到问题陈述与已验证数学 | 禁令式技能、默认报弱 |
| 写最终稿件 | 主 agent（`write-paper`、`paper_write`、`paper_revise`） | 稿件整份过验证器 |
| 最终定稿 | **人类专家** | 每条证明人工确认；残留缺陷（notation / citation format）由人修 |

### 8.6 人机成本的经济学（§4.3，对我们很实用的一句话）

> 验证改变了人机循环的经济学：在写作循环里它充当**第一审稿人**，被判拒的东西由机器修好，**永远到不了专家面前**。这很重要，因为**瓶颈是人类检查而不是机器搜索**：一两天产出的结果，专家通常要一两周才能查完。**加速新数学共同生产的是验证，而不是搜索速度。**

---

## 9. 成本 / 安全 / 隐私

- **模型分配按实测强项**（§4.1）：worker 与 verifier 跑在 Codex + GPT-5.5（数学更强）；主 agent 用 Claude Code + Claude Opus 4.8（更擅长读大量持续变化的 log/memory/上千条 fact 图）；GPT-5.5-pro 数学最强但**太贵，不能持续调用**，只作**低频专家参考**。作者尚未系统评估 Anthropic 的 Fable 5。
- **咨询频率被硬限**：主 agent 对 GPT-5.5-pro 的 fine point 咨询**至多每小时一次**；状态循环**每 1–2 小时**一次。
- **worker 规模与努力档**：每个项目 **3–9 个 worker**，**大致均分**在 `high` 与 `xhigh` 两档（底层 Codex 的 effort 设置）；**故意留一半在较低的 high**，用来补充"更浅但有用"的结论并**增加蜂群的推理多样性**。
- **算力/时间量级**：§3.4 五 worker 约 90 分钟到目标定理；§3.2 首波约 8 小时；§3.6 七 worker 约 5 天，3,157 条 fact，636 次证明尝试、151 个反例、25 个死胡同。
- **顾问输出的安全语义**：GPT-5.5-pro 的咨询**进入 memory 作为 guidance，永不作为真相进入事实图**（§4.1 原文：`a GPT-5.5-pro consultation enters the memory as guidance, never the fact graph as truth`）。错误的路线被尝试、被反驳、被记为死胡同；正确的路线哪怕是"十分之一"也被带进已验证 fact。
- **不是 fail-closed 姿态**：README（旧卡已记录）预期以 `codex --dangerously-bypass-approvals-and-sandbox` 运行，并警告在**隔离、可弃主机**上运行。论文本身谈的是数学正确性，不涉及沙箱/审批。**这一点与我们相反，见 §13。**
- **上下文与深度有界**：raw exploration 留在 local log，distilled lessons 上升到 global memory，主 agent 的 summary 把整个 run 压成一页；**每层压缩下一层**，所以任何 agent 读到的东西**有界**，而系统知道的东西在增长（§4.4）。这就是论文所说的"depth 方向的 test-time scaling"。

---

## 10. 关键数字 / 阈值

### 10.1 规模（六个 case study，全部为"真实运行"数字）

| 案例 | 领域 | worker | 时长 | 已验证 fact | 依赖链最深 | 支撑闭包 | global memory 其他计数 |
|---|---|---|---|---|---|---|---|
| §3.1 Optimal bend-and-break for foliations | 双有理几何 | 5 | — | **63** | — | — | **239 条失败路径** |
| §3.2 Shokurov 全局指数猜想（三维叶状） | 叶状几何 | 7 | 首波约 **8 小时** | **784** | — | **77** | — |
| §3.3 有理奇点在族中的 total Cartier index | 代数几何→交换代数→实代数几何 | 7 | — | — | — | — | — |
| §3.4 Matryoshka 数的阶乘渐近 | 组合/数学物理 | 5 | 约 **90 分钟** | **100** | **15** | **37** | 仅有**单次**证明尝试、无死胡同 |
| §3.5 对数向量场的加权齐次性 | 奇点理论 | 7（两波） | — | **687**（另撤销 **23**） | **21** | **约 10** | **91** 次证明尝试、**49** 个反例 |
| §3.6 matroid 切类与 wonderful compactification | 组合代数几何 | 7 | 约 **5 天** | **3,157** | **54** | **664** | **636** 次证明尝试、**151** 个反例、**25** 个死胡同 |

- Figure 2 的图注数字：**3,157 verified facts, 8,616 dependency edges**，节点按依赖深度加深加大（**最深 54**）。
- §3.5 的另一处细节：撤销的 23 条 fact 是"修复刚才所述缺陷"时发生的（参考文献里 `nilpotent` 定义错误导致一步论证有缺陷 → 弃掉受影响步骤 → 找到正确引用 → 大幅修订）。
- §3.6 的对照实验：同一固定 verbatim prompt、**同一批 worker 与同一个验证器模型**，给三个系统：GPT-5.5-pro 网页版、Rethlas、Danus。**Rethlas 跑了三次全部失败**（找不到能通过验证器的结果，恰恰绊在问题诱导的混淆上，例如 realizable matroid / wonderful model / permutohedral toric variety 之间、integral 与 rational K-theory 之间），GPT-5.5-pro **无有意义结果**，Danus 先解 rational 形式再适配到 integral。
- 全部六个问题都独立地也问过 GPT-5.5-pro 网页版，**没有一个产生有意义结果**。

### 10.2 运行参数

| 项 | 值 |
|---|---|
| worker 数 / 项目 | 3–9，均分 `high` 与 `xhigh` 两档 |
| 主 agent 状态循环 | 每 **1–2 小时** |
| GPT-5.5-pro 咨询上限 | **至多每小时一次** |
| 终止条件 | 目标定理或否证**作为已验证 fact 出现在图中**（非预设轮数） |
| worker 单次任务粒度 | 一条 claim（引理 / 反例 / 玩具例子） |
| 主 agent 模型 | Claude Code + Claude Opus 4.8 |
| worker/verifier 模型 | Codex agents + GPT-5.5 |

### 10.3 §3.4 的包络（一个"可验证数字"的范例）

`0.00542831750 ≤ S ≤ 0.00542831848`，**宽度小于 1e-9** 的包络，包含 OEIS 条目的猜想值 `c ≈ 0.0054283`；证明是初等的、每个常数都显式，所以这个包络是**严格的（rigorous）而非数值的**；因为 S 没有已知闭式，论文认为这样的包络是关于该常数最强的有意义刻画。

---

## 11. 评估方法

- **不是 benchmark 论文，是系统论文 + 六个 case study**（`§3 Results`: `we summarize a selection of representative papers to illustrate the capabilities of Danus`）。所有案例都是与数学家合作的 **Danus–human collaboration 模式**。
- **人工输入被显式分账**：每个案例区分
  - **common input**（每个案例都有）：问题陈述本身；不含数学内容的操作性指令（要状态摘要、要产出稿件）；对完成稿件的**最终检查**（人类专家确认每条证明）；以及稿件完成后人类作者独立做的修订，**主要是数学记号与引用格式的微调**；
  - **本案例特有的额外输入**（各案例单列）。
- **§3.6 是全文最接近受控比较的实验**：同 prompt、同 worker 与 verifier 模型，Rethlas 三次失败 vs Danus 完整验证解 → 差异**只能归于模型之外的编排**（论文原话）。
- **对"记忆机制到底贡献了什么"的证据形态是定性的**：§4.4 把 scaling 拆成两个轴——
  - **width**：更多 worker 变成更多探索（3.6 的 3,157 条里只有 664 条支撑定理，其余记录"搜索得多宽"）；
  - **depth**：verification 提供信任（一条 fact 入图时被检查，worker 才能站在 54 条深的链上而不重推任何一条），memory 负责记住（raw log → global memory → 主 agent 一页摘要）。
- **明确划出失效边界**：scaling **只在"解存在、只需被找到"时有效**；它**不创造路径**——当解法需要一个任何单次调用都提不出的想法时，更多 worker 与更长时限只让系统**打转**、累积浅结论（§4.4）。实验里这种僵局是被**人**给出缺失想法打破的。
- **我们可借用的被动信号**：
  1. **"停滞路线"必须被归类**（方法失败 vs 反对陈述本身）——这是可从日志/记忆自动抽取的**二值标签**，且不需要模型（需要模型来打标签，但标签的形式是确定的）；
  2. **支撑闭包 / 全图的比值**与**依赖链深度**——两个纯图结构量，可直接从任何有向依赖图算出；
  3. **撤销次数**——一个极稀疏但极重的质量信号；
  4. **"最终证明从未引用的条件性脚手架"**——把"当时有用、最终没用上"当作**正常且应保留**的现象。

---

## 12. 可迁移机制清单

按"能搬进 dsh-math-memory 的具体机制"逐条列，并标注证据强度。

1. **真相容器与工作上下文容器分离**（强证据，多处重申）。Danus：fact graph（真相）vs local/global memory（非真相的共享上下文）。对应我们：`records/`（有 `source` 的沉淀）vs `episodes/`、`inbox/`。**我们的差距**：我们没有一个**明确宣告"这不是真相"**的容器类别在检索时被降权——inbox 是暂存，但 memory 语义没有写在协议里。
2. **"顾问输出只进上下文，永不进真相"**（§4.1 明文）。这是 Danus 对"AI 审查会错"这一痛点的直接回答：模型的高价值输出**默认只配做 guidance**。
3. **唯一写门 + 权限由工具表强制**（Figure 4）。`fact_submit` 只在 worker，`fact_revoke` 只在主 agent，verifier 只有读与 Matlas。**这是结构性不可为，不是提示词纪律。**
4. **claim 级粒度写入**（一条引理 / 一个反例 / 一个玩具例子）。对笔记系统：**一条"可独立判真假的断言"是天然的审查单元**，而不是一整篇笔记。
5. **每条 fact 显式记录它依赖的 fact 标识符 → 形成入边**（依赖方向由**写入者**声明，但**可被下游审核**）。
6. **级联撤销**：一条错了，传递依赖它的一并作废。我们目前只有 `related` 双向链，**没有依赖方向、没有级联**。
7. **无状态判定**：每次提交全新实例、判完不留状态。可迁移语义：**审查者不携带上一次审查的结论**，避免"上次我认可了这条，这次也顺着认可"的路径依赖。
8. **验证器的输入是"陈述 + 证明 + 对已有事实的引用标注"**，输出是**二值判定 + 修复提示**，并且**引用必须存在且适用**（`check-referenced-statements`）。这条直接对应我们要的"引用核验"。
9. **验证器可读被引用对象**（把图当文件读）——检查"引用是否适用"必须能读到被引对象本身。
10. **二阶验证不可省**：事实级通过 **推不出** 由事实缝成的散文正确；接缝处（压缩步骤、it suffices to 化归、近似但不等价的粘合）是错误集中地。**对我们的直接推论：单条笔记里"定理 A 与定理 B 拼接出结论 C"的那句话，必须单独作为一条 claim 审。**
11. **长文分片规则**：切成自包含部分，每部分以指定结果收尾，并把依赖的结果作为**已确立的陈述**带上——**判完整文档，不判碎片**。
12. **禁令式摘要技能**：不数字化估计进度；只有"无未匹配假设地确证"才报已证明；**默认报弱**。对应我们的笔记/体检措辞纪律：**宁可写 `unverified`，不要写"基本成立"**。
13. **停滞路线的二分类**（方法失败 / 反对陈述本身）——一个可枚举、可写在卡片 frontmatter 的字段形状。
14. **撤销是编排动作而非判定动作**：所以 revoke 权限给了主 agent 而不是 verifier。
15. **支撑闭包可计算且通常远小于全图**（664/3157、77/784、37/100、约 10/687）：**不要用"这条记录有没有被最终引用"当删除判据**，Danus 明确把它当正常现象。

---

## 13. 与 dsh-math-memory 的映射与差距

我们现状（读代码确认）：`hook.verified ∈ {single-source, cross-referenced, user-confirmed}`，模型**只能写 `single-source`**，更高等级必须用户参与，`verified_by` 是凭据（只在用户点 ✅ 时由插件写入），体检把"等级高于 single-source 但没有凭据"列为**越权升级**并要求重判；`verified` 进 `note_recall` 排序（user-confirmed 1 / cross-referenced 0.75 / single-source 0.5 一类权重），体检还有 `unverified` 一节（`verified ∈ {null, single-source}` 且超过 `AUDIT_UNVERIFIED_DAYS = 60` 天）。用户反馈 ❌ 会写 `needs_review: true` 允许**降级**。

| # | Danus 机制 | 我们的现状 | 判定 |
|---|---|---|---|
| 1 | 唯一事实来源 + 非真相上下文分离 | records / episodes / inbox 三层，但"这不是真相"没有写成检索语义 | **采纳（改措辞与排序）** |
| 2 | 顾问输出只进 memory | 我们无外部顾问，但"AI 审查结论不得冒充凭据"完全同构 | **采纳** |
| 3 | 角色门控工具表（结构性不可为） | 统计字段由插件维护是**纪律 + 事后体检**；我们本来就有一个"模型不得手改"的清单 | **改造**：升级为"体检可检测的越权"（已有先例），不引入工具表（单用户插件没有多 agent） |
| 4 | claim 级粒度 | 我们按**卡**审，一张卡可以装很多东西 | **采纳**：引入"可判真假的单条断言"作为审查单元 |
| 5 | 依赖入边 | 只有 `related` 双向链，`uses` 是计数不是依赖 | **采纳**：给「依赖」一个方向 |
| 6 | 级联撤销 | 只有 `superseded` 单点标记 | **采纳（改造）**：不删，改为"标记 stale + 列出下游" |
| 7 | 无状态判定 | 无审查器 | **改造**：等于"每次审查不读上次结论"，落成一个字段 |
| 8 | 验证器 I/O 契约（二值 + 修复提示 + 引用须存在且适用） | 无 | **采纳**：这是我们要设计的核心契约 |
| 9 | 验证器可读被引用对象 | 插件本来就能读全 vault | **零成本具备** |
| 10 | 二阶（稿件级）验证 | 无 | **采纳（最有价值的一条）**：拼接句单独审 |
| 11 | 长文分片 | 我们的卡本来就短（`AUDIT_BODY_MAX_LINES = 20`） | **改造**：分片规则变成"一句话一条断言" |
| 12 | 禁令式摘要（默认报弱） | 已有 `unverified` 措辞，但无"默认报弱"纪律 | **采纳** |
| 13 | 停滞路线二分类 | 无 | **采纳（低成本）** |
| 14 | revoke 是编排动作 | ❌ 反馈 + `needs_review` 由用户/插件做 | **已具备同形** |
| 15 | 支撑闭包 ≠ 全图 | 体检有 `unused`（30 天 0 使用）一节 | **改造**：`unused` 只能作为**建议**，不能作为删除判据 |
| — | 多 agent 蜂群 / 并行证明搜索 / MCP 角色表 | 单用户数学学习 | **不适用** |
| — | `--dangerously-bypass-approvals-and-sandbox` 姿态 | `approval: never` + fail-closed 沙箱 + 最小工具面 | **不适用（且反向警示：不要被"自主性更强"吸引）** |
| — | 依赖 LLM 验证器做正确性权威 | 我们**插件不调模型**，零 token 优先 | **不适用**：Danus 的 verifier 是一个前沿模型服务，我们只能借它的**契约形状**，不能借它的**判定能力** |

### 13.1 与旧卡 `danusFactGraphMemory2026` 的逐条对照

**被全文证实的（旧卡说法 → 全文依据）**

| 旧卡说法 | 全文依据 | 结论 |
|---|---|---|
| 主 agent 规划协调、多 worker 并行证明搜索、**无状态验证器是正确性的唯一权威** | §2 开篇"strict separation of powers"；Figure 4 标题 `stateless · sole authority on correctness` | ✅ 证实 |
| 验证器由**全新实例**判定、判完不留任何状态 | §2.5 `a fresh instance judges each submission and retains nothing afterwards` | ✅ 证实 |
| 事实图保存每条已验证结果及其**逻辑依赖作为入边** | §2.2 入边定义 | ✅ 证实 |
| **主 agent 没有 `fact_submit`**，"负责指挥搜索的 agent 在结构上无法把未验证的数学引入事实图" | Figure 4 主 agent 工具表确无 `fact_submit`；§2.4 原文几乎就是这句话 | ✅ 证实（且 Figure 4 给了完整工具表） |
| **验证器什么都不写**（只读） | Figure 4 验证器栏仅 `Matlas` + `reads the fact graph as files` | ✅ 证实（比旧卡更精确：它**能读**图与查文献） |
| worker 通常一次只处理**一条**断言（引理/反例/玩具例子，而非整条证明），反复"提交+证明 → 验证器接受/带修复提示拒绝"直到通过 | §2.5 worker 段 + §2.1 + Figure 3 | ✅ 证实 |
| 因为一次只取需要的 fact、一次提交一条，**工作上下文保持很小，而证明可以长到很多页** | §2.2 第二条理由，原文几乎逐字 | ✅ 证实 |
| 事实按内容寻址、**可级联撤销**；验证器是唯一写门 | 级联撤销 ✅（§2.2 逐字）；"唯一写门" ✅（只有验证通过才入图） | ✅ 证实（"内容寻址"见下） |
| 规模：**3,157 条已验证事实 / 8,616 条依赖边**，链最深 **54**，其中 **664** 条构成最终定理的支撑闭包 | §3.6 + Figure 2 图注，逐字 | ✅ 证实 |
| 聚类是**不同的进攻路线**，含**最终证明从未引用的条件性脚手架**与**其中一条界的独立重推** | Figure 2 图注，逐字（"left, an independent re-derivation of the Chern-number bound"） | ✅ 证实 |
| 最终论文本身交付前还要经专门的"**论文数学验证器**"通读 | §2.7 + §4.2 | ✅ 证实 |
| `strategies/` 是 consult 网关（elaboration → 强模型 → master_guidance）；worker/verifier 跑在用户的 codex 后端；一切 BYO key | 属仓库 README 事实，论文未涉及 | ⚠️ 未在正文出现（不算被证实也不算被否证） |
| 运行姿态 `codex --dangerously-bypass-approvals-and-sandbox`，需隔离可弃主机 | 同上，README 事实 | ⚠️ 论文未涉及 |
| 运维教训（先谈定"什么算做完"；给写作系统几篇范例论文） | 同上，README 事实 | ⚠️ 论文未涉及 |

**需要修正或补精确的（旧卡说法 → 全文的准确版本）**

1. **"无状态"的准确含义**：旧卡只说"判完不留任何状态"。全文补上了一个关键限定——**验证器被允许读事实图**（`it is permitted to read the fact graph, so that when a proof depends on other facts it can follow those citations and check the dependency`）。所以"无状态"指**不保留跨提交的记忆**，**不是**"无输入上下文"。它每次拿到的上下文是**提交 + 被引用的 fact + 查文献的能力**，仅此而已。§4.3 把这条称为 `context isolation` 的核心：`the checker must be a separate agent whose context holds the submission, the cited facts, and nothing else`。
2. **"验证器什么都不写"要精确到工具级**：它**没有** `fact_submit`，**也没有** `global_memory_add`；它有 `Matlas`（文献检索）与读图。旧卡"只读"的表述方向对，但漏了"它能查文献"这一项——而这一项正是它能执行 `check-referenced-statements`（确认**被引用陈述存在且适用**）的前提。
3. **"内容寻址"在正文中没有对应表述**。正文只说事实图按**逻辑依赖**组织、按 fact 检索；"content-addressed" 是旧卡的仓库来源（README）用语。**建议按正文写"依赖寻址 / 依赖入边"，把"内容寻址"标为 README 说法。**
4. **"验证器几乎不产生 false positive"这个说法必须带着论文的原话一起引**。论文写的是 `produced essentially no false positives`，但它举的两个例子都是**不该接受却接受了**（跳过步骤的证明、依赖错误引用的证明）——即通常所谓的**漏放（false negative）**。引用这个数时必须同时给出**两类具体失误**与"**在最终人工审查中都能抓到**"，否则会把"验证器可能放过错误"误读成"验证器可能冤枉正确"。
5. **"验证器是唯一写门"要补一个例外级联**：撤销不是验证器做的，是**主 agent** 用 `fact_revoke` 做的；验证器只 place/deny 单条提交。写门的完整表述是"**入图只有验证通过一条路；出图只能由主 agent 级联撤销**"。
6. **"二级验证"的描述可以更重**：旧卡只说"最终论文交付前经论文数学验证器通读"。全文给了**为什么必须有它**（fact-level verification 不转移；错误在接缝处）与**怎么分片**（切成自包含部分、每部分以指定结果收尾、把依赖结果作为已确立陈述带上；**判完整文档不判碎片**）。这一条对我们的"拼接句"问题是最直接的范本。
7. **"664 条支撑闭包"的语境要补**：不要把 664/3157 读成"只有 21% 有用"。论文把其余部分明确当作 **scaling in width 的记录**（`the rest record how widely the system searched`），并认为这类材料**应被保留**。
8. **成本侧的数字旧卡完全没有**：worker 3–9 个、均分 high/xhigh、主 agent 每 1–2 小时一轮、GPT-5.5-pro 至多每小时一次咨询、六个案例的数字表（见 §10.1）。这些是"真实运行规模"的确切来源。
9. **"验证器是唯一正确性权威"有一个论文自己承认的缺口**：验证器**把被引用文献当作正确**，所以**文献本身的错误会静默通过**（§3.5 的 `nilpotent` 定义错误就是这么传播的），这类错误**只能靠专家审查解决**。旧卡把它表述为能力，应补为"**能力 + 一个已知的、位于其能力边界之外的缺口**"。
10. **精度评级的措辞**：论文 §4.5 的原话是"总共只观察到**少数（a handful）**验证器错误，多数源于被引用文献陈述不精确或错误"——比旧卡的"几乎不产生 false positive"更弱也更准确；同时 §4.3 说"**几乎从不接受有缺陷的证明**"。两句并用才不失真。

**旧卡没有的新机制（全文独有）**

1. **Figure 4 的完整角色门控工具表与技能表**（三类 agent 的 skills + MCP tools，逐项可抄）——旧卡只有"角色门控的工具集"这个概括。
2. **无状态验证器的完整 I/O 契约**：输入 = 陈述 + 证明 + 对图中已有 fact 的引用；输出 = accept（入图，引用成为入边）或 reject + **repair hints**；三个检查技能（逐语句检查、确认被引用陈述存在且适用、合成验证报告）；Figure 3 的 submit–verify–repair 循环。
3. **验证器失误的两种具体类型**（少量跳过步骤；依赖错误引用），以及"因为把引用当作正确"这一设计选择。
4. **撤销的触发二分类**（引用错误 / 概念混淆或证明缺陷）与**真实频次（全程只用过一次）**。
5. **事实图之外的两层 memory**（每个 worker 的私有 local log + 全局 memory），以及全局 memory 记录**每次 GPT-5.5-pro 咨询的 prompt 与 reply**；以及核心限定句 **`memory is not part of the truth`**。
6. **级联撤销的机制层细节**：不仅是"移除错误事实"，而是**连同所有直接或传递依赖它的 fact 一起移除**（3.5 里就是 23 条）。
7. **二阶验证的完整理由与分片规则**（见上面第 6 条修正）。
8. **禁令式摘要技能的具体禁令**：绝不数字化估计进度；只有"无未匹配假设地确证"才报已证明；**默认报弱**；动机是模型自行总结会乐观。以及主 agent 对 GPT-5.5-pro 的**停滞二分类**（方法失败 / 反对陈述本身）。
9. **终止条件是语义的**（目标定理或其否证**作为已验证 fact 出现**），**不是预设轮数**。
10. **模型按实测强项分工**，以及 GPT-5.5-pro **只作低频（≤1/小时）专家参考**。
11. **worker 的努力档设计与理由**：3–9 个，**故意一半留在较低的 high** 以增加推理多样性。
12. **"宽度"与"深度"两个 scaling 轴**的划分，以及**scaling 不创造路径**这条边界（僵局靠人给想法打破）。
13. **人类输入的分账方法**（common input vs 案例特有输入），以及一个可引用的经济学结论：**瓶颈是人的检查，加速联合生产的是验证而非搜索速度**。
14. **§3.6 的受控对照事实**：同 prompt、同 worker 与 verifier 模型，Rethlas 三次失败、GPT-5.5-pro 无结果、Danus 成功——差异归于编排。
15. **"最终证明从未引用的条件性脚手架 / 独立重推"被明确定性为正常现象**（旧卡已提到，但全文给了它在 Figure 2 上的位置与所占比例）。
16. **§3.4 的严格包络数字**（宽度 < 1e-9 且证明初等、常数显式 → 严格而非数值），旧卡完全没有。

**旧卡的处置（2026-09-18，已执行）**

- **不删除、标 `status: superseded`、正文顶部加指向本卡的说明**，其余正文按原样保留。理由三条：① 审计结论是**旧卡没有一条被全文否证**，需要改的只是四处措辞（见上）；② 它保留着**全文里没有的网页来源证据**（`danus-helper-dsh` 安装技能、pin commit、运行姿态警告、运维教训）；③ 与仓库既定纪律一致——**"superseded 而非删除"**（被取代的记忆是证据，不是可抹掉的历史，见 `docs/memory/design.md` §2.1），且 `note_recall` 默认排除 superseded 卡，因此不会与全文本卡争检索位次。
- **同时记下导入器的缺口**：`lit-import.mjs` **按 citekey 去重，不按 DOI/标题去重**，所以"先导网页源、后补 PDF/全文"必然产出**同一论文两张卡**。这是本库第一次真实发生（`.index.json` 里两条记录的 `doi` 完全相同）。修法见 `notes/verification-design-2026-09-18.md` §7 的 V0 第 ③ 项（导入时对新条目的 DOI/标题做一次"已存在？"的出声检查）。

---

## 14. 行动项

> 每条标注：**[零 token]** = 确定性插件逻辑可做到；**[需模型]** = 需要模型参与；**[做不到]** = 本仓库架构下不可行。

### A. 立即可做（零 token，改的是协议措辞与体检规则）

1. **[零 token] 把"这不是真相"写进记忆分层语义。** 在 vault 协议里给三类容器各写一句定位：`records/`+`templates/`+`strategy/` 是**有 `source` 的沉淀**；`episodes/`+`inbox/` 是**工作上下文，不构成真相**；并明确"**模型本轮的高价值推断默认只配做 guidance，不得冒充凭据**"。对应 Danus 的 `Memory is not part of the truth`。
2. **[零 token] 引入"依赖"字段并给方向。** 最低成本形状：卡片 frontmatter 增 `depends_on: [卡名]`（有向），由模型在写卡时声明，由体检校验**目标卡存在**（可复用现有 broken-link 检查）。有了方向才能有级联。
3. **[零 token] 级联不删、只标 stale。** 体检若发现某卡的 `depends_on` 指向一张 `needs_review: true` 或已 `superseded` 的卡，就在清单里列出"**下游待复审**"一行。**不要自动改下游内容**——参照 Danus"验证器不写、撤销是编排动作"，插件只报告。
4. **[零 token] 把停滞/失败原因做成一个枚举字段。** 例如体检对 `success_rate` 低的卡要求一个 `failure_kind ∈ {method, claim}`（方法不行 / 这条本身可能不对）——直接抄 Danus 对 GPT-5.5-pro 的停滞二分类。
5. **[零 token] 新增"单条断言"审查单元。** 体检对每张卡抽取**可判真假的断言句**（需要模型抽句 → 见 B1；但"卡内断言数超阈值"可以零 token 用确定性规则先做上限告警），并把"**拼接句**"（把两条记录缝成第三条结论的那一句）单独列出。
6. **[零 token] `unused` 不得作为删除判据。** 现有体检的 `unused`（30 天 0 使用）建议文本里，补一句"**未被引用不等于无用**（Danus：3,157 条里 664 条支撑定理，其余记录搜索宽度）"，把它的建议等级钉在"建议归档"而不是"建议删除"。
7. **[零 token] 校验引用必须"存在"。** 体检已能检测 broken link；把它升级为：卡片正文里以定理名/引理名引用的目标**必须在 vault 内有对应卡或明确的 `source` 行**，否则列一条 `dangling-claim-ref`。

### B. 需要模型参与（但不需要插件调模型——由会话中的模型按协议做，零插件 token）

8. **[需模型] claim 值不值得形式化的判据。** 从 SAFE 的 auto-formalization 提示词借三条**确定性可判**的启发式（见 SAFE 笔记 §12）：**(a) 一切数值运算一律审，不论多显然**；**(b) 有"跳跃"、不直观的步骤审**；**(c) 单纯的复述/吟唱/总结不审**。写进 vault 协议作为**审什么**的门槛，插件不参与。
9. **[需模型] 每次审查必须留"修复提示"而不是只留判定。** Danus 的验证器 reject 时返回 repair hints。对应我们的形状：卡片被标 `needs_review` 或降级时，**必须同时写一句"怎么改才可能对"**（换更强的条件、补一个前提、指出反例在哪一步），否则重判没有抓手。
10. **[需模型] 二阶审查纪律：拼接句单独审。** 协议加一条：当一条笔记把 A 与 B 合起来得出 C 时，**C 必须作为独立断言接受一次审查**，理由是 Danus 的"接缝错误"与"fact-level verification does not transfer"。
11. **[需模型] 默认报弱。** 禁令式措辞：不得写"基本成立/显然/可以证明"；只有"无未匹配假设地确证"才写已证明；不确定一律 `unverified`。这条与仓库已有的「不假装可信」方向一致。

### C. 外部验证（问题 2）

12. **[需模型，零 token 工具] 数值反例优先，因为它是唯一"零成本可判定"的验证形式。** Danus 的 worker skills 里有 `construct-counterexamples` 与 `construct-toy-examples`；SAFE 的分析也指出 auto-formalization 能覆盖"数值计算、解方程组"这类**通用编程语言也能做**的断言。落地形状：对笔记里带明确参数范围的断言，**由模型给出可执行的数值检查提示**（不是插件去跑，而是把"这条断言若为真，某些具体取值必须满足 X"作为审查输入）；插件侧零 token。
13. **[需模型] 定理库检索作为"是否存在反例/是否存在更强版本"的入口。** Danus 让**验证器也能用文献检索工具**（`Matlas` 对三类 agent 都开放），这是它能判断"被引用陈述存在且适用"的前提。我们没有 Matlas，但可以让会话中的模型在**审查阶段**做文献检索，并把结果写进 `source` 字段（而不是写进 `verified`）。
14. **[做不到] 真正的形式化验证。** 我们没有 Lean、没有 ATP、没有形式化程度足够的笔记语料；SAFE 的 FormalStep 也显示 27.8% 的步骤**根本形式化不了**。不要在这条路上投入。

### D. 权限边界（问题 4 的可迁移形式）

15. **[零 token] 把"事实进入 memory 前必须经过独立 verifier"翻译成三层而非两态**：
    - **采集层**（episodes/inbox）：无门，什么都能进来，**且明确标注不构成真相**；
    - **沉淀层**（records/templates/strategy）：默认 `verified: single-source` + `verified_by: none`，**这是"已固化但未经外部确认"的诚实状态**；
    - **凭据层**（`verified_by: user`）：**只有用户动作能写**，插件是唯一写入者。
    这正是 Danus 的"worker 可写 memory、只有 verifier 能写 fact graph、revoke 由编排者做"在单用户场景下的最小同形。**零 token，且我们已经有全部零件**（`verified` 白名单 + `verified_by` 凭据 + 越权升级检测）。
16. **[零 token] "独立"的可判定化。** Danus 的"独立"是两个具体性质：(a) **全新实例**（无跨提交记忆）；(b) **上下文隔离**（只有提交 + 被引用的 fact，别的什么都没有）。我们能确定性校验的部分是：**审查者与写作者不是同一次会话**（可用会话/时间戳字段），以及**审查时引用必须能被读到**。把"审查必须由不同上下文产生"落成一个可检测条件（如 `verified_by` 与 `source` 的时间/会话不一致）。
17. **[需模型] 拒绝时的反馈内容要有形状**（对齐 Danus 的 `synthesize-verification-report`）：固定的三行 = **判定（accept/reject/不能判定）** + **依据（引用了哪条、缺哪个前提）** + **修复提示**。"不能判定"必须是**一等状态**（见问题 3）。

### E. 无法验证时降级为 `unverified`（问题 3）

18. **[零 token] 把 `unverified` 做成显式值而不是缺省。** 现在的语义是"`verified` 缺失或 `single-source` + 超 60 天"。Danus/SAFE 都提示：**"形式化失败"与"证明失败"是两种不同的失败**（SAFE 的四态），**不能合并**。建议形状（仍只用 frontmatter 白名单，不新增插件能力）：
    - `verified: single-source` + `verified_by: none` = **已固化、未获外部凭据**；
    - 新增可写值 `verified: unverified`（模型可写，因为它**降低**了声称）= **已尝试审查但无法判定（缺工具 / 超出可判定范围 / 找不到来源）**；
    - 关键是**保留卡片与内容**，只降级等级——对齐 Danus"不删只撤销/归档"与我们现有的 ❌ → `needs_review` 降级路径。
19. **[零 token] "无法验证"必须带原因码。** 建议枚举：`no-source`（找不到文献/来源）、`out-of-scope`（超出可判定范围，如几何/组合的可形式化边界）、`tool-missing`（缺验证工具）、`ambiguous`（陈述本身有歧义，先要澄清陈述）。**没有原因码的 unverified 等于丢弃**——这正是 Danus 用"修复提示"避免的事。
20. **[做不到] 把"降级为 unverified"自动化。** 判断"这条能不能被验证"本身需要一个判定者；插件零 token 只能做到**按原因码做降权与清单**，做不到**判定该降级**。所以这条的正确落点是：**给模型一个确定的降级动作 + 给体检一个确定的展示规则**。

### F. 明确是过度设计的（综合判断的负面清单）

21. **[做不到/过度] 多 agent 角色表、MCP 工具门控、并行 worker swarm。** 我们的场景是单用户数学学习，且插件不调模型。Danus 的工具门控靠 agent 类型实现，我们只有"插件 vs 模型"两种主体，**门控退化成体检规则**——这已经够了。
22. **[过度] LSTM/PRM 形式的分数聚合。** SAFE 用一个两层、隐藏 64 的 LSTM 把四态序列压成 0–1 分；我们**没有标注数据、也不该引入训练依赖**。它的四态枚举可以借（见 18），聚合器不要借。
23. **[过度] 依赖链深度的自动截断/剪枝策略。** Danus 的链深到 54 是**深度工作的证据**，不是需要剪的东西。
24. **[过度] 任何"自动提升 verified 等级"的逻辑。** Danus 里升级的唯一路径是验证器 accept，而它的判定成本是前沿模型服务；我们把它对应到**用户动作**，这是既有的、正确的设计，**不要为了"自动化"而绕过它**。
