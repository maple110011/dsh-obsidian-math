---
citekey: xiongHowMemoryManagement2026
title: "How Memory Management Impacts LLM Agents: An Empirical Study of Experience-Following Behavior"
shorttitle: "How Memory Management Impacts LLM Agents"
authors: "Xiong, Zidi; Lin, Yuping; Xie, Wenya; He, Pengfei; Liu, Zirui; Tang, Jiliang; Lakkaraju, Himabindu; Xiang, Zhen"
year: 2026
status: distilled
doi: "10.18653/v1/2026.acl-long.27"
url: "https://aclanthology.org/2026.acl-long.27/"
tags:
  - experience-following
  - memory-management
  - error-propagation
  - experience-replay
  - trajectory-evaluator
  - llm-agents
full_text: .raw/xiongHowMemoryManagement2026/full.md
pdf: .raw/xiongHowMemoryManagement2026/source.pdf
---

# How Memory Management Impacts LLM Agents: An Empirical Study of Experience-Following Behavior

> **一句话**：只做记忆增/删两个基本操作的实证研究，量化出 LLM agent 的 **experience-following 属性**（检索到的记忆输入与当前 query 越像，其输出被执行得越像；RegAgent 上 Pearson r 最高达 **0.95**，Table 5），并据此指出 **error propagation** 与 **misaligned experience replay** 两个风险——对策是把轨迹评估器接进增删决策，其中最强标签来自**未来任务对这条记忆的下游效用**（Abstract：「future task evaluations can serve as free quality labels」）。关键反直觉点：高相关≠高性能（Add All r=0.95/SR 55.5 vs Strict r=0.92/SR 71.0，Table 5）。

## 摘要

Memory is a critical component in large language model (LLM)-based agents, enabling them to store and retrieve past executions to improve task performance over time. In this paper, we conduct an empirical study on how memory management choices impact the LLM agents' behavior, especially their long-term performance. Specifically, we focus on two fundamental memory management operations that are widely used by many agent frameworks—memory addition and deletion—to systematically study their impact on the agent behavior. Through our quantitative analysis, we find that LLM agents display an experience-following property: high similarity between a task input and the input in a retrieved memory record often results in highly similar agent outputs. Our analysis further reveals two significant challenges associated with this property: error propagation, where inaccuracies in past experiences compound and degrade future performance, and misaligned experience replay, where some seemingly correct executions can provide limited or even misleading value as experiences. Through controlled experiments, we demonstrate the importance of regulating experience quality within the memory bank and show that future task evaluations can serve as free quality labels for stored memory. Our findings offer insights into the behavioral dynamics of LLM agent memory systems and provide practical guidance for designing memory components that support robust, long-term agent performance.

## 核心机制 / 方法

- 记忆 = 情景记忆的 query-execution 对池；检索 = 按输入相似度取 top-K 当 in-context demonstrations（§2.2；K=6/4/1/3，Table 3）。无 schema、无 verified、无来源字段。
- 写入判据只有评估器 $\pi(q,e)$：fixed / add-all / coarse(LLM judge) / strict(ground-truth 模拟)（§3.1）。**add-all 在四个 agent 上全低于冻结基线**（Table 1：55.48 vs 67.53 等）；微调 300 条轨迹的评估器即可稳定获益（§3.2）。
- experience-following：输入相似度↑ ⇒ 输出相似度↑（Fig. 3；Table 4/5 的 r）。它同时是收益来源与风险来源——**放大存量，包括错误**。
- error propagation：add-all/coarse 相对 error-free 对照的差距随时间扩大；strict 在 AgentDriver 约 2000 次执行后反超对照（§3.4、Fig. 4/13，仅定性）。
- 删除三式（§4.1）：periodical（窗口内检索次数 ≤α 即删，保证 $M\le\alpha(t-t')K$）、**history-based**（先检索 ≥n 次，再算历次下游效用的均值，低于 β 即删）、combined（二者取或）。
- 效果（Table 2，strict）：EHRAgent 38.67→**42.06**、CIC-IoT 85.40→**89.60**、AgentDriver 51.00→51.81，体积同时 −12%~−28%；同量对照 74.4 vs 72.8（Table 7）证明收益来自**平均质量**而非池子大小。
- 前置条件：评估器不可靠时删除会反向（未微调 GPT-4o-mini 在 EHRAgent 涨、AgentDriver 跌，§4.2；§B.7 出现 retained 质量低于 deleted）。
- 阈值：strict 1.0 / coarse 1.6-1.4-1.2（RegAgent）、L2<2.5（AgentDriver）、β=0.5（RegAgent）/0.3-0.7（EHRAgent）/0.7（CIC-IoT）、最小判定次数 5 或 3、周期 200/500（§3.1、§4.1、§A.1）。
- **未做**：合并/摘要/反思/结构变换、分层组织、注入预算、token 成本、用户确认路径、数学任务（Limitations 自承）。

## 与我的工作 / 记忆的映射

- **缺口 5（检索自我强化：`uses`→`hookPrior`，而 `uses` 不数「帮上忙」）**：论文的 $\overline\Phi$ = 「每次检索 × 那次任务结局」的配对均值（§4.1 式 2）。我们的 `uses` 只有暴露量、`gain` 从未被真实使用（坑 35）⇒ **改造**：`retrieval-stats.json` 的每条命中加 `outcome` 槽，由下一轮会话回填。
- **缺口 5 + P5②**：把「检索 ≥n 次才下结论」（论文的 estimation-bias 门槛）定为所有质量判定的统一前置条件，样本不足只报不判。
- **缺口 8（索引超预算静默丢最旧行）**：论文 §5.2 容量约束下「只删平均效用最低者」⇒ 把 `appendOnlyIndexDigest` 的丢弃规则从「最旧」改为「最低效」，并按坑 47 必须插截断标记。
- **P5①（只报不改）与 P6（`unclear` 状态）**：论文证明「过了质检的记忆仍可能有害」（§4.3 misaligned experience replay、§B.7 反向案例）⇒ 为「保留一份不确定」提供外部证据，但**不要**新增语义判据。
- **不适用**：它的评估器是 LLM judge / ground truth 自动打分，触我们「插件不调模型」红线（`design.md:286`）；strict 是 oracle 模拟（§3.1），**不能**引它支持 D1/D2（AI 产物降级 / 新增 `unverified` 档），也不能支持 P1/P2/P3（它压根不建模注入层）。

## 研读状态

- 状态：distilled
- 状态更新：2026-10-01
- 研读日志：reading/xiongHowMemoryManagement2026.md（已创建）

## 原文

- [MinerU 全文](.raw/xiongHowMemoryManagement2026/full.md)
- [PDF](.raw/xiongHowMemoryManagement2026/source.pdf)
