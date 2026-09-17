---
citekey: danusFactGraphMemory2026
title: "Danus: Orchestrating Mathematical Reasoning Agents with Fact-Graph Memory"
shorttitle: "Danus"
authors: "Liu, Jihao; Gao, Guoxiong; Sun, Zeming; Wu, Bin; Liu, Shurui; Jiang, Jiedong; Ju, Haocheng; Chen, Leheng; Cheng, Ronnie; Zhang, Xiping; Dong, Bin"
year: 2026
status: distilled
doi: "10.48550/arXiv.2607.06447"
url: "http://arxiv.org/abs/2607.06447"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Computation and Language, Computer Science - Multiagent Systems"
tags: [fact-graph-memory, verifier-gated-writes, role-gated-permissions, content-addressed-facts, cascade-revocation, math-reasoning-orchestration]
full_text: ""
pdf: ""
---

# Danus: Orchestrating Mathematical Reasoning Agents with Fact-Graph Memory

> **一句话**：研究级数学推理的编排系统——主 agent 规划调度、多个 worker 并行搜索证明、**无状态验证器是正确性的唯一权威**；只有通过验证的断言才进入**内容寻址的事实图**，而事实图**是整个系统唯一的事实来源**（"三层记忆，一条正确性边界：只有经验证器门控的事实图是真相，全局记忆只是认知 awareness"）。**对我们的价值：它是"权限强制（角色门控工具表）而非提示词约束"与"内容寻址 + 级联撤销"这两个我们尚未具备的机制的一手范本。**

## 摘要

Recent LLM-based mathematical reasoning agents have begun to tackle research-level problems and, in several cases, have contributed to the resolution of open problems. However, scaling and orchestrating such agents effectively remains challenging, due to the difficulty of coordinating parallel proof search while keeping intermediate claims organized and reliable. In this paper, we propose Danus, an orchestration system for research-level mathematical reasoning centered on a shared fact graph as a global memory-management mechanism. Danus consists of a main agent that performs planning and coordination, multiple worker agents that carry out proof search in parallel, and a stateless verifier that checks proposed mathematical claims before they are admitted into the fact graph. Each verified fact is stored together with its proof and logical dependencies, allowing the system to build long arguments incrementally while keeping the shared proof state organized.

## 核心机制 / 方法

> 来源说明：arXiv 摘要（已核验）+ pin 到 commit `7a51336e53cd1d558d0e766a61eb0fed46ebb05b`（tag `v0.1.0-codex`）的仓库 README（已核验）。上游为 FrenzyMath（北大 AI4Math）；VeryMath 提供 DeepSeek Harness 版安装技能 `danus-helper-dsh`。**未逐字通读论文正文**。

- **角色三分的"权力分立"**：主 agent 全局规划与协调；worker 做详细证明搜索；**无状态验证器是正确性的唯一权威**（每个提交由**全新实例**判定、判完不留任何状态）；事实图保存每条已验证结果及其**逻辑依赖作为入边**。
- **★ 权限由构造强制，不靠提示词**：每种 agent 只拿自己的技能与**角色门控的工具集**——**主 agent 没有 `fact_submit`**（原文："负责指挥搜索的 agent 在结构上无法把未验证的数学引入事实图"），**验证器什么都不写**（只读）。这是"结构性不可为"而非"被要求不要做"。
- **★ 入库循环**：worker 通常一次只处理**一条**断言（引理、反例、玩具例子，而非整个证明），反复"提交断言 + 证明（引用已有事实）→ 验证器接受/带修复提示拒绝"直到通过，此时断言以事实入图，其证明依赖的事实成为**入边**。因为每个 worker 只取当前断言需要的事实、一次只提交一条，**工作上下文保持很小，而证明可以长到很多页**。
- **★ 内容寻址 + 级联撤销**：事实按内容寻址，**可级联撤销**；验证器是**唯一写门**。
- **规模实证（真实研究运行）**：**3,157 条已验证事实 / 8,616 条依赖边**，依赖链最深 **54 条**；其中 **664 条**构成最终定理的支撑闭包；聚类是**不同的进攻路线**——包含**最终证明从未引用的条件性脚手架**，以及**其中一条界的一个独立重推**。
- **二级验证**：最终论文**本身**在交付前还要经一个专门的"论文数学验证器"通读（在逐事实验证之上）。
- **运行工程细节**：`strategies/` 是 consult 网关（elaboration → 强模型 → master_guidance）；worker/verifier 跑在用户的 codex 后端；一切 BYO key。
- **⚠️ 风险样本（原文自述）**：预期运行模式是 `codex --dangerously-bypass-approvals-and-sandbox`（无逐动作审批），README 明确警告"agent 会以你的 shell 权限行动，请在**隔离、可弃**主机上运行"。
- **⚠️ 运维教训（原文自述）**：**开工前先与主 agent 谈定"什么算做完"**——否则 swarm 会在你已经不关心的点之后继续烧 token；给写作系统**几篇你自己的论文作为范例**，是改善"读起来像一堆已验证事实"的最高杠杆修正。

## 与我的工作 / 记忆的映射

- **★ 权限强制 > 提示词纪律（我们最该吸收的一条）**：我们已经有"统计字段由插件维护、模型不得手写"的纪律，但**它是靠提示词 + 体检事后检测**。Danus 的做法提示我们把它升级为**结构性**：我们的插件本就是唯一能改 frontmatter 统计字段的确定性组件，**应当把"模型整体重写索引/统计字段"变成体检可检测的违规**（我们已有"越权升级"检测的先例，扩展同一形状即可）。零 token。
- **★ 内容寻址 + 级联撤销解我们的一个真问题**：一条 records 被 `superseded`、或一个定理被推翻后，**下游哪些模板卡/策略卡/笔记依赖它、需要复审？** 我们现在只有 `related` 双向链，**没有依赖方向、没有级联**。（同一缺口在 MemForest 侧表现为"结构枢纽度"、在 MSCE 侧表现为"证据锚点"——三篇独立指向同一处。）
- **"主 agent 无 `fact_submit`"对应我们的分层**：我们的模型能提议写什么，但**统计与验证等级由插件裁决**——这是同一个"提案 vs 裁决"分离。Danus 把它做到工具表级别，我们可以先做到"体检可检测"级别。
- **"每次只取当前断言需要的事实、一次提交一条"** 与我们 `note_recall` 的"2 召回 / 3 精读"预算、"读前 2-3 篇"是同一思路（**小上下文 + 增量累积**），可互相印证。
- **"最终证明从未引用的条件性脚手架"与"独立重推"**：这是一个很有价值的观察——**记忆里必然有大量"当时有用、最终没用上"的材料**。我们的体检有 `unused` 一类，方向一致；但 Danus 把它当作**正常且应保留**的现象（可追溯性），而不是噪音。**这支持我们不删除只归档的路线。**
- **不适用**：多 agent 蜂群编排、并行证明搜索、MCP 角色表、`--dangerously-bypass-approvals-and-sandbox` 的运行姿态（我们恰恰相反：`approval: never` + fail-closed 沙箱 + 最小工具面）。我们场景是**单用户数学学习**，不是研究级并行证明。
- **反向警示**：它的自主性换来了**高权限风险**（自述需隔离主机）。我们的 fail-closed 姿态是**有意的相反选择**，不要被"自主性更强"吸引而放松。

## 研读状态

- 状态：distilled
- 研读日志：reading/verymathOrg2026.md（**组织级调研**，Danus 见 §4 / §8 / §12）
- 源质量：无 PDF/MinerU（网页源）。事实来自 arXiv 摘要页与 pin commit 的仓库 README，均已核验；**论文正文未通读**。

## 原文

- [arXiv 摘要](https://arxiv.org/abs/2607.06447)
- [Danus 仓库（pin commit）](https://github.com/frenzymath/Danus/tree/7a51336e53cd1d558d0e766a61eb0fed46ebb05b)
- [VeryMath 的 DSH 安装技能](https://github.com/VeryMath/AI4Math-Auto-Research/blob/main/skills/danus-helper-dsh/SKILL.md)
