---
citekey: liuDanusOrchestratingMathematical2026
title: "Danus: Orchestrating Mathematical Reasoning Agents with Fact-Graph Memory"
shorttitle: "Danus"
authors: "Liu, Jihao; Gao, Guoxiong; Sun, Zeming; Wu, Bin; Liu, Shurui; Jiang, Jiedong; Ju, Haocheng; Chen, Leheng; Cheng, Ronnie; Zhang, Xiping; Dong, Bin"
year: 2026
status: distilled
doi: "10.48550/arXiv.2607.06447"
url: "http://arxiv.org/abs/2607.06447"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Computation and Language, Computer Science - Multiagent Systems"
tags: [fact-graph-memory, stateless-verifier, role-gated-tools, separation-of-powers, cascade-revocation, verification-gated-writes, long-horizon-math-reasoning, two-stage-verification]
full_text: .raw/liuDanusOrchestratingMathematical2026/full.md
pdf: .raw/liuDanusOrchestratingMathematical2026/source.pdf
---

# Danus: Orchestrating Mathematical Reasoning Agents with Fact-Graph Memory

> **一句话**：研究级数学推理的并行编排系统——主 agent 规划调度、3–9 个 worker 各攻一条路线、**无状态验证器是正确性的唯一权威**；只有通过验证的断言才进入**以逻辑依赖为边的 DAG 事实图**（全程唯一的真相来源），其余一切（计划、死胡同、例子、顾问输出）只进**明确"不是真相"的 memory**。对我们的价值：它把"权限强制而非提示词纪律"与"**二阶验证**（事实级通过推不出事实缝成的散文正确）"这两件事做成了一手范本。

## 摘要

Recent LLM-based mathematical reasoning agents have begun to tackle research-level problems and, in several cases, have contributed to the resolution of open problems. However, scaling and orchestrating such agents effectively remains challenging, due to the difficulty of coordinating parallel proof search while keeping intermediate claims organized and reliable. In this paper, we propose Danus, an orchestration system for research-level mathematical reasoning centered on a shared fact graph as a global memory-management mechanism. Danus consists of a main agent that performs planning and coordination, multiple worker agents that carry out proof search in parallel, and a stateless verifier that checks proposed mathematical claims before they are admitted into the fact graph. Each verified fact is stored together with its proof and logical dependencies, allowing the system to build long arguments incrementally while keeping the shared proof state organized. The main agent periodically summarizes the evolving proof state, redirects workers across promising directions, and supports interaction with human mathematicians through progress reports. We evaluate Danus through six research-level case studies in algebraic geometry, singularity theory, and combinatorics, illustrating how the fact-graph memory mechanism enables Danus to construct long, detailed mathematical proofs. Our results suggest that fact-graph-based orchestration provides an effective route toward scaling mathematical reasoning agents for long-horizon research problems. Danus is open source at https://github.com/frenzymath/Danus.

## 核心机制 / 方法

> 来源：MinerU 全文通读（`.raw/liuDanusOrchestratingMathematical2026/full.md`），全部数字与机制表述已与同目录 `full.txt`（pdftotext -layout）逐条核对。同一论文另有网页源卡片 `danusFactGraphMemory2026`（仅 arXiv 摘要 + 仓库 README，未通读正文），**本卡以全文为准**。

- **权力分立（strict separation of powers）**：主 agent 全局规划与协调；worker 做详细证明搜索；**验证器是正确性的唯一权威**（无状态）；**一张事实图装下全部已验证结果，且是系统唯一真相来源**。主 agent **不做具体数学推导**——"详细推导"是唯一受验证的内容。
- **★ 权限由构造强制，不靠提示词（Figure 4 完整工具表）**：`fact_submit` **只在 worker**；`fact_revoke` **只在主 agent**；**验证器只有 `Matlas`（文献检索）与"把事实图当文件读"，没有任何写工具**（连 `global_memory_add` 都没有）；主 agent 另有 `reference_audit` / `reference_verify` / `paper_verify_math` / `paper_revise` / `paper_subgraph` / `summary_write`。原文：负责指挥搜索的 agent 在结构上无法把未验证的数学引入事实图。
- **★ 事实图结构**：DAG，节点 = fact（**一条数学陈述 + 一份验证器检查过的证明**），边 = 逻辑依赖（**A→B 表示 B 的证明用了 A**，A 是 B 的**入边**）。worker 提交时**自己标注依赖的 fact 标识符**，这些成为新 fact 的入边。原则上可访问整张图，实践中靠 `fact_search` 检索。
- **★ memory 不是真相**（原文 `Memory is not part of the truth`）：两层——每个 worker 的私有 local log；全局 memory（所有 worker 与主 agent 可读写）记录计划、有希望的方向、死胡同、构造的例子与反例，以及**每一次 GPT-5.5-pro 咨询的 prompt 与 reply**。顾问输出**只进 memory 作为 guidance，永不进事实图作为真相**（`a GPT-5.5-pro consultation enters the memory as guidance, never the fact graph as truth`）。
- **★ 入库循环（submit–verify–repair）**：worker 一次只专注**一条** claim（引理/反例/玩具例子），带上证明与对已有 fact 的引用提交 → 验证器 **accept（入图，引用成为入边）** 或 **reject + repair hints** → 改写重交，直到通过。因为一次只取需要的事实、一次提交一条，**工作上下文始终很小，而证明可以长到很多页**。
- **★ 无状态的确切含义**：每次提交由**全新实例**判定、判完不留任何状态；但**验证器被允许读事实图**（`it is permitted to read the fact graph`），以便**追踪引用并检查依赖**。§4.3 把它称为 `context isolation`：**检查者的上下文只有"提交 + 被引用的 fact + 什么都没有"**。三个检查技能：`verify-sequential-statements`、`check-referenced-statements`（**确认被引用陈述存在且适用**）、`synthesize-verification-report`。
- **★ 级联撤销（revocation）**：一条后来发现错误的 fact，**连同所有直接或传递依赖它的 fact 一起移除**。触发恰好两类：**被引用文献本身有错**，或**概念混淆/证明有缺陷**（后者更少见）。真实频次：**全程只被需要过一次**（§3.5，撤 23 条）。撤销是**编排动作**（主 agent 的 `fact_revoke`），不是判定动作。
- **★ 二阶验证（论文级）**：**事实级验证不可转移**（`Fact-level verification does not transfer`）——把图写成线性散文会创造从未成为 fact 的新数学（压缩的步骤、`it suffices to` 化归、**陈述"接近但不完全相等"的 fact 之间的粘合**），**正确的 fact 可以被缝成不正确的稿件，错误在接缝处**。所以草稿必须**整份按写成的样子过验证器**；长文**切成自包含部分、每部分以一个指定结果收尾，并把依赖的结果作为"已确立的陈述"带上**——**判完整文档，不判碎片**；被压缩成断言处**重新提供并完整渲染原始证明**。
- **★ 验证器的精度与已知失败模式**：原文说 `produced essentially no false positives`，但举的两个例子都是**不该接受却接受了**（接受了**含少量跳过步骤**的证明；**因为把被引用文献当作正确**而接受了依赖**错误引用**的证明）；论文认为两类都**在最终人工审查中很容易抓到**。§4.5：总共只观察到**一只手数得过来**的错误，多数源于**被引用文献本身陈述不精确或错误**。§4.3：验证器**几乎从不接受有缺陷的证明**。
- **★ 验证精度是承重假设**：worker **信任每条已有 fact 而不重推**，所以一条 fact 的可靠性等于它下面的一切；§3.6 的定理压在 **664 条支撑 fact、链深 54** 上——验证不精确则误差沿链累积、长程推理不可能；精确则累积安全。
- **★ 真实运行规模（六案例）**：§3.1 5 worker / 63 fact / 239 失败路径；§3.2 7 worker / 首波约 8 小时 / 784 fact / 77 支撑；§3.4 5 worker / 约 90 分钟 / 100 fact / 链深 15 / 37 支撑 / **无死胡同**；§3.5 7 worker 两波 / 687 fact（另撤 23）/ 链深 21 / 约 10 支撑 / 91 次证明尝试 + 49 反例；§3.6 7 worker / 约 5 天 / **3,157 fact / 8,616 依赖边 / 链深 54 / 664 支撑** / 636 次证明尝试 + 151 反例 + 25 死胡同。图上的簇 = 不同进攻路线，**含最终证明从未引用的条件性脚手架与其中一条界的独立重推**。
- **角色配置**：worker 与 verifier 跑 Codex + GPT-5.5；主 agent 用 Claude Code + Claude Opus 4.8（更擅长读大量持续变化的 log 与上千条 fact 的图）；GPT-5.5-pro 最强但太贵，只作**低频专家参考（至多每小时一次）**。worker **3–9 个、均分 `high`/`xhigh` 两档**（故意留一半在较低档以增加多样性）。
- **终止条件是语义的**：不是预设轮数，**只有目标定理或其否证作为已验证 fact 出现在图中才停**；主 agent 每 **1–2 小时**重读 worker 日志 + memory + 图，产出摘要并问 GPT-5.5-pro 下一步。
- **禁令式摘要技能**：进度报告由**隔离 agent** 写（只拿到问题陈述与已验证数学，系统内部全被剥离）；**绝不数字化估计进度**；**只有当一条已验证 fact 在没有任何未匹配假设的情况下确证结果**时才报已证明，**默认报得更弱**。给 GPT-5.5-pro 的状态摘要里，**每条停滞路线必须分类为"方法的失败"（陈述仍活着）或"对陈述本身的证据"**。
- **§3.6 是全文最接近受控比较的实验**：同一 verbatim prompt、**同一批 worker 与同一个验证器模型**下，Rethlas **三次全败**、GPT-5.5-pro 网页版**无有意义结果**、Danus 先解 rational 形式再适配 integral 版本——差异只归于编排。
- **scaling 的两个轴与边界**：**width**（更多 worker → 更多探索；3,157 里只 664 支撑定理）与 **depth**（验证提供信任，使 worker 能站在 54 条深的链上而不重推；memory 负责记住，每层压缩下一层，所以读的东西有界而系统知道的东西在长）。**但 scaling 不创造路径**：当解法需要一个任何单次调用都提不出的想法时，更多 worker 与更长时限只让系统打转；实验里这种僵局是**由人给出缺失想法**打破的。
- **经济学结论**：验证在写作循环里充当**第一审稿人**，被判拒的东西由机器修好、**永远到不了专家面前**；因为**瓶颈是人类检查而不是机器搜索**（一两天产出的结果专家要一两周查完），**加速新数学联合生产的是验证，而非搜索速度**。

## 与我的工作 / 记忆的映射

- **★ 权限强制 > 提示词纪律（最该吸收的一条）**：我们已有"统计字段由插件维护、模型不得手写"的纪律 + 体检的**越权升级**检测（`verified` 高于 `single-source` 却无 `verified_by` 凭据）。Danus 的工具表说明这条路可以更彻底：**入图只有验证通过一条路，出图只能由编排者级联撤销，验证器连写工具都没有**。我们能落到的等价物是"**插件是唯一写入者 + 体检可检测的越权**"——已经有零件，不必引入多 agent。零 token。
- **★ 二阶验证直击我们的真问题**：一条笔记里"由 A 与 B 推出 C"的那句话**不是 A 也不是 B**，它是在**接缝处**新造的内容，而**单条的通过不传递**。落地形状：**拼接句必须作为独立断言单独审**。这是本卡对我们的第一优先项。
- **★ memory 不是真相 ⇒ 分层语义要写出来**：`records/templates/strategy` 是**有 `source` 的沉淀**；`episodes/inbox` 与"模型本轮的高价值推断"是**工作上下文，不构成真相**。Danus 用两个容器 + 一句硬限定做到这件事；我们目前只是三层目录，**没有把"这不是真相"写成语义**。
- **★ 级联撤销解我们的一个真缺口**：一条 record 被 `superseded`、或一个定理被推翻后，**下游哪些卡/笔记依赖它、需要复审？** 我们现在只有 `related` 双向链，**没有依赖方向、没有级联**。（同一缺口在 MemForest 侧表现为"结构枢纽度"、在 MSCE 侧表现为"证据锚点"——三篇独立指向同一处。）
- **★ "缺陷只进 memory"对应我们的审查降级路径**：Danus 的错误路线被尝试、被反驳、**被记为死胡同**，而不是被删除；我们已有 ❌ → `needs_review` 的降级路径，**同形**，可继续沿用"不删只标"。
- **"每次只取当前断言需要的事实、一次提交一条"** 与我们 `note_recall` 的召回预算、"读前 2-3 篇"是同一思路（小上下文 + 增量累积）。
- **"最终证明从未引用的条件性脚手架"与"独立重推"**：**记忆里必然有大量"当时有用、最终没用上"的材料**，Danus 把它当作**正常且应保留**的现象（可追溯性）。**这支持我们的 `unused` 只归档不删除。**
- **"验证器把引用当正确 ⇒ 文献自身的错静默通过"**：这正好是我们痛点的一个已命名失败模式——**错的可能来自上游材料**（§3.5 的 `nilpotent` 定义错误就是这样传播的），且**只有人工审查能解决**。对应我们的 `source` 字段：**来源本身需要被审，而不只是"有来源就算有据"**。
- **不适用**：多 agent 蜂群编排、并行证明搜索、MCP 角色表、`--dangerously-bypass-approvals-and-sandbox` 的运行姿态（我们恰恰相反：`approval: never` + fail-closed 沙箱 + 最小工具面）。我们场景是**单用户数学学习**，不是研究级并行证明。
- **反向警示**：它的自主性换来**高权限风险**（自述需隔离、可弃主机）；我们的 fail-closed 姿态是**有意的相反选择**，不要被"自主性更强"吸引而放松。

## 研读状态

- 状态：distilled
- 研读日志：reading/liuDanusOrchestratingMathematical2026.md
- 源质量：MinerU 全文（轻度 OCR 噪声仅在数学排版区）；关键数字已与 `full.txt`（pdftotext -layout）逐条交叉核对，无一处事实依赖被破坏的段落。
- **同论文另有网页源卡片 `danusFactGraphMemory2026`（仅 arXiv 摘要 + 仓库 README，未逐字通读正文）；本卡以全文为准。** 两者差异（证实/需修正/新增）见研读记录 §13.1。
  - **该旧卡已于 2026-09-18 标 `status: superseded` 并改为指向本卡的溯源卡**（按仓库"superseded 而非删除"的纪律：它保留了全文没有的网页来源与 pin commit 证据；`note_recall` 默认排除 superseded 卡，故不会与本卡争检索位次）。处置理由与逐条差异见研读记录 §13.1 末。

## 原文

- [MinerU 全文](.raw/liuDanusOrchestratingMathematical2026/full.md)
- [PDF](.raw/liuDanusOrchestratingMathematical2026/source.pdf)
