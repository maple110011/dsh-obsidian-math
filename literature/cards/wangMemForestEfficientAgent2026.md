---
citekey: wangMemForestEfficientAgent2026
title: "MemForest: Efficient Agent Memory Management via EventTree Partitioning and Progressive Merging"
shorttitle: "MemForest"
authors: "Wang, Junxi; Sun, Te; Zhu, Jiayi; Zhang, Chen; Li, Siyuan; Liu, Xuyang; Wen, Zichen; Tu, Xiaobing; Ren, Jinkui; Zhang, Xiantao; Yuan, Ziqi; Zhang, Linfeng"
year: 2026
status: distilled
doi: "10.48550/arXiv.2609.08273"
url: "http://arxiv.org/abs/2609.08273"
keywords: "Computer Science - Artificial Intelligence"
tags: [write-time-compression, event-partitioning, spanning-tree-merging, anchor-guided-retrieval, redundancy-vs-pruning, compression-ratio]
full_text: .raw/wangMemForestEfficientAgent2026/full.md
pdf: .raw/wangMemForestEfficientAgent2026/source.pdf
---

# MemForest: Efficient Agent Memory Management via EventTree Partitioning and Progressive Merging

> **一句话**：一个**与记忆框架解耦的写时压缩算子**——把历史记忆按「全局语义相似 + 局部时间连续」（`u = 0.8·g + 0.2·l`，时间窗 `w = 5`）切成事件单元，每单元建**最大生成树（EventTree）**，再按「**边权减去两端度数**」（`η = 0.99`，高度数节点是枢纽、不该先合并）迭代挑权重最高的边做 **LLM 合并**，直到达到预设压缩率；配一个**锚点引导传播检索（AGPR）**按「离锚点的时间距离指数衰减」在压缩后的记忆上补回邻域信息。核心结论：**50% 压缩保住 97.1%（文本）/ 99.7%（多模态）性能，检索提速 1.89× / 2.24×**；且 **>50% 压缩时合并类明显优于剪枝类**。**对我们的定位：哲学相反（它压缩不可逆、我们 `superseded` 可回溯），可迁移的只有"选哪一对合并"的排序判据与两个评估设计。**

## 摘要

Agent memory systems have demonstrated significant potential in tasks such as long-term dialogue, personalized assistants, and video understanding. However, as inference progresses, continuously accumulated memory imposes substantial storage and retrieval burdens. To address this issue, we propose MemForest, a general memory compression framework adaptable to various agent memory systems. Specifically, MemForest leverages both global semantic similarity and local temporal continuity of memory events to partition the historical memory into a set of event-centric independent units. For each independent unit, the framework constructs a maximum spanning tree structure, referred to as an EventTree, and performs progressive merging by iteratively selecting high-weight edges, thereby effectively compressing redundant memory nodes and reducing storage overhead. In addition, we introduce an anchor-guided propagation retrieval mechanism, which retrieves more relevant memory nodes from the temporal neighborhoods of key memory nodes, thereby enabling more accurate memory retrieval. Extensive experiments demonstrate the effectiveness of MemForest. Under the unimodal Mem0 framework, across three benchmarks (LoCoMo, LongMemEval, and PersonaMem), MemForest preserves 97.1% of the original performance while compressing 50% of historical memory, achieving a 1.89x retrieval speedup. Under the multimodal M3-Agent framework, across two benchmarks (M3-Bench-robot and M3-Bench web), MemForest retains 99.7% of the original performance under a 50% compression ratio, while achieving a 2.24x retrieval speedup.

## 核心机制 / 方法

- **问题**：记忆持续累积 ⇒ 存储与推理期检索成本双涨。现有压缩分**剪枝**（Random Pruning / KMeans / DART / StreamMeCo）与**合并**（Random Merging / ToMe）两类。
- **★ 核心实证（§5.2）**：**低压缩率（30%）时两类差不多；压过 50% 后剪枝类明显掉、合并类仍撑得住**（M3-Agent 上连专用剪枝框架 StreamMeCo 在 >50% 时都不如随机压缩）⇒ **合并保留信息，剪枝丢弃信息**。
- **事件单元划分（§3.2）**：节点 `mᵢ = (内容, 嵌入, 时间戳)`；KMeans 在嵌入上切 `N·α` 个单元（`α = 0.05`）⇒ 取每单元离中心最近者为**中心节点** ⇒ 非中心节点用 `u = β·g + (1−β)·l` **重指派**（`g` = 与各中心的**全局相似度**，`l` = 是否落在中心时间窗 `[t_c−w, t_c+w]` 的**局部连续度**；`β = 0.8`、`w = 5`）。⇒ **"同一件事" = 语义相近且时间相邻**，且明显偏语义（20% 权重给时间）。
- **★ 逐步合并（§3.3）**：单元内建完全图（边权 = 嵌入余弦相似度）→ **Kruskal 最大生成树** → **按度数修正边权** `w'ᵢⱼ = η·wᵢⱼ − (1−η)(deg(mᵢ) + deg(mⱼ))`（`η = 0.99`）→ 每轮取 `w'` 最大的边作为合并对 → **LLM 融合两条内容** `c' = F(c_{i*}, c_{j*})`、重新编码、时间戳取 `max` → 迭代至目标压缩率。**动机（原文）**：树里高度数节点通常是事件的核心/枢纽，携带更多核心信息，**不应被过早合并**。
- **★ 为什么合并高相似节点（§4 + §B.1）**：设嵌入 L2 归一、`sᵢ = qᵀeᵢ`、`ρᵢⱼ = eᵢᵀeⱼ`、合并嵌入取范数归一插值，则可证 `s_l ≥ sᵢ − (1−λ)·√(2 − 2ρᵢⱼ)`（Eq. 15）。**ρᵢⱼ 越大下界越高 ⇒ 合并高相似节点更保真**；ρ 小则语义偏移大、top-k 可能取不回来。
- **★ AGPR 读路径（§3.4）**：取 top `L·k`（`L = 4`）为候选 ⇒ 其中 top `λ·k`（`λ = 0.2`）为**锚点** ⇒ 传播分 `pⱼ = (1/(λk))·Σᵢ exp(−|t'ⱼ − t'_{aᵢ}|)`（**离锚点时间越近越高**）⇒ 融合 `vⱼ = γ·sⱼ + (1−γ)·pⱼ`（`γ = 0.9`）取 top k。**AGPR 的收益在压缩后才显著**（50% 压缩时 Mem0 +1.2%、M3-Agent **+21.0%**；未压缩时 +0.2% / +17.6%）⇒ 它的作用是**补偿压缩导致的信息损失**，而非通用检索改进。**几乎零额外耗时**（Table 13：0.48s vs 0.48s）。
- **关键结果**：Mem0 三基准 50% 压缩保留 **97.1%**、提速 **1.89×**；M3-Agent 两基准保留 **99.7%**、提速 **2.24×**。合并成本约 **$0.1 / 6000 节点**（GPT-4o-mini），可换本地模型。
- **消融（Table 3/4，50% 压缩，Avg%）**：Baseline 54.4（100%）；**去掉全局相似度 g → 49.8（91.5%）**；去掉局部连续度 l → 50.9（93.6%）；Ours 52.2（96.0%）。合并策略：Random 49.9（91.7%）、**Minimum 48.4（89.0%，最差）**、Ours 52.2 ⇒ **「挑最不相似的合并」比随机还差**，证明**合并对象的选择本身**而非"合并"这个动作带来收益。
- **跨模型合并（Table 12）**：GPT-4o-mini 97.0% / GPT-5.2 96.5%（**饱和**）、Qwen2.5-7B 87.9%（明显差）⇒ 合并质量对模型规模有门槛。
- **⚠️ 限制（§F）**：**低冗余的文本记忆在高压缩率下退化明显——压 70% 时精度只剩无压缩的 93.3%**；多模态因冗余高，压缩空间大得多。
- **⚠️ 没有质量门控**：无审计、无体检、无反模式、无适用边界、无 promote/demote；**压缩不可逆**（原文被替换）。唯一"前瞻"在 §G 未来工作：想训练专用小合并模型；想对历史记忆做**整体分析以识别冲突或损坏条目**——**而这一条我们已经有了（体检）**。

## 与我的工作 / 记忆的映射

- **★ 哲学相反，不要采纳合并本身**：它**不可逆地替换原文**；我们的 `records` 纪律是"调和（reconcile）而非追加：相同则更新、冲突则旧卡 `superseded`、**禁止删除**"，且 `source` 必指 episode。**可回溯、可纠错正是我们 1.0 的目标**。因此：**不做自动合并**（合并需 LLM ⇒ 也违背"插件不调模型"红线）。这条要记进 handoff 的"已评估、不采纳"，防止后续 agent 读到本文就给 vault 加自动合并。
- **★ 可采纳的是"选哪一对"的排序判据**：Eq. 15 给"优先处理最相似的一对"一个可引用的下界；Table 4 的 **Minimum（挑最不相似）89.0% 比 Random 91.7% 还差** 则警告"选错对象比不做更糟"。我们体检现在只报"疑似重复"、**没有排序依据** ⇒ 改成按相似度降序输出。
- **★ "高度数节点是枢纽，最后再合并"对我们直接可用**：我们的 `note_links` 已有**反链数**（零成本的结构枢纽度）。一张被很多卡 `related` 的 records 一旦被改写或标 `superseded`，影响面最大 ⇒ 体检的"建议合并"里应**单列并排除枢纽卡**。
- **★ 「事件」的双轴定义与 MSCE 的 `n_min` 合并**：「同主题 + 时间邻近」是**确定性可算**的（我们 `records.topic` + `episodes` 日期）。用它给 MSCE 的"跨 episode 独立支撑"做分组，就能区分"一次巧合"与"重复出现的真技巧"。
- **★ 两个评估设计直接可抄**：① **同一机制跨「高冗余 / 低冗余」两个宿主测**（Mem0 低冗余文本 vs M3-Agent 高冗余多模态），从而给出**适用边界**而不只是单一分数——我们可类比"笔记为主/记忆稀"与"记忆密/重复多"两个 benchmark vault；② **`Avg-R`（平均检索轮数）**："为取到足够信息要检索几轮"，直接度量检索的**信息密度**，比命中率更接近用户感受——我们**完全没用过**这个指标。
- **压缩率是显式旋钮（30/50/70%）**：我们的注入预算是 `design.md` 里的**硬编码常量**（profile 4000 / topics 1800 / records 800 / templates 600 / episodes 1200 / inbox 1200 / 对话线索 3000 / 体检 1200 / working 500）。可把预算做成用户可见的三档（精简/标准/富上下文）。
- **AGPR 的时间邻域检索不适用**：我们的对象是数学笔记与技巧，**时间相邻 ≠ 内容相关**（同一天读的两篇无关论文不该互相带出）。我们已有更合适的机制（hook 字段 + 主题索引 + 策略卡的检索目标清单）。
- **它的弱项反衬我们的强项**：它无审计/无边界/无反模式，而 **§G 未来工作想做的"识别冲突或损坏条目"正是我们的体检**。**不要因为读了一篇"压缩"论文就弱化体检。**
- **源质量**：MinerU `full.md` 的 5 处 `[a-z]<sub>` 全部是同一个数学表达 `m<sub>1..3</sub>`（记忆节点下标），已用 `pdftotext -layout` 交叉核对、**无语义差异**，不构成 GraphMemix 式的破坏。**可按 `docs/literature.md` §8 的判别口径直接使用。**

## 研读状态

- 状态：distilled
- 研读日志：reading/wangMemForestEfficientAgent2026.md（含 14 节完整记录 + 7 条行动项 B1–B7）
- 源质量：MinerU `full.md` 可用（`<sub>` 5 处均为 `m₁..m₃` 下标；已 `pdftotext` 交叉核对）

## 原文

- [MinerU 全文](.raw/wangMemForestEfficientAgent2026/full.md)
- [PDF](.raw/wangMemForestEfficientAgent2026/source.pdf)
