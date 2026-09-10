---
citekey: liGraphMemixQueryAwareEvidence2026
title: "GraphMemix: Query-Aware Evidence Forests for Long-Term Multimodal Agent Memory"
shorttitle: "GraphMemix"
authors: "Li, Geng; Wang, Yuhao; Li, Dong; Hao, Jianye; Peng, Yuxin"
year: 2026
status: distilled
doi: "10.48550/arXiv.2608.26983"
url: "http://arxiv.org/abs/2608.26983"
keywords: "Computer Science - Computation and Language, Computer Science - Artificial Intelligence"
tags: [query-time-organization, evidence-forest, multi-view-retrieval, anchor-conditioned-verification, redundancy-vs-complementarity]
full_text: .raw/liGraphMemixQueryAwareEvidence2026/full.md
pdf: .raw/liGraphMemixQueryAwareEvidence2026/source.pdf
---

# GraphMemix: Query-Aware Evidence Forests for Long-Term Multimodal Agent Memory

> **一句话**：把「长期记忆该给模型看什么」从**写时压缩**搬到**查询时选择**——先用多视图检索（各视图打分取 max）捞出一个有界候选图（$L{=}24$ 种子、$H{=}1$ 跳、$M{=}48$ 候选），再用两个**职责分离**且可并行的验证器分别给「节点自身的支持度」与「相对锚点的增量价值」定价（六角色 new_fact/clarification/corroboration/redundant/conflict/irrelevant），最后在读者预算 $K{=}10$ 内解出**证据森林**；核心收益是**把已验证的关系路径转换成低排名证据的回收**（控制实验净回收 **+43** 条 gold，而 MMR/DPP 这类通用多样性目标是 **−6 / −36**）。

## 摘要

Organizing long-term memory for multimodal agents remains challenging because existing methods either suffer from expensive question-agnostic offline summaries or naive embedding similarity matching that introduces incomplete and redundant context. To address these issues, we propose GraphMemix, a combinatorial-optimization graph memory framework that models memory organization as query-aware evidence-forest construction. Specifically, our method consists of three key components: (1) candidate graph construction, which expands multi-view seed memories through schema and semantic relations to acquire query-aware original context; (2) evidence utility and activation costs, which decouples direct memory support from anchor-conditioned relation verification to suppress redundant or conflicting information; and (3) forest optimization, which jointly selects a forest-format memory context under a maximum evidence budget and its reliable relational structure. By organizing memory into a query-relevant subgraph, the method avoids substantial lifecycle cost and recovers low-similarity complementary evidence. Experimental results across four long-term multimodal memory benchmarks demonstrate significant improvements with different foundation models and establish a new Pareto frontier between accuracy and lifecycle cost.

## 核心机制 / 方法

- **问题（两条现有路线各自的失败模式）**：① 问题无关的离线压缩（MIRIX/SGM/A-MEM/AUGUSTUS/M²A）要处理整段历史以避免遗漏 ⇒ 冷启动与更新成本高，且会丢掉事后才关键的视觉状态/局部上下文；② 多模态 RAG 按相似度排序 ⇒ **过度选择近重复、漏掉低相似度互补证据**，而回答常常需要多条记忆**联合**才有用。
- **三步（§3.3–3.5）**：
  1. **候选图**：同一记录多视图（原图/caption/OCR/视频帧）各自打分后**取 max**（式 3）→ top-$L$ 种子 → 沿 schema 边（同 session/同地点等可观测结构）+ 语义边（互为 kNN，式 4）扩 $\le H$ 跳 → 截到 $M$ 个（式 5）。**全程有界**。
  2. **两种定价**（式 6–10）：**节点验证器** listwise 一次读 $q$ 与全部候选，给「单独支持度」$\nu_i$，与检索分融合 $p_i=\sigma(\tau[\alpha s_i+(1-\alpha)\tilde\nu_i-\delta])$；**ECV（证据链验证器）**只看「锚点↔候选」的 schema 边，为每条候选选一个最能解释其增量的锚点、给增量分 $s^{\text{inc}}$ 并归入六角色，**只保留正分且角色属前三种的边** ⇒ 边成本 $c_{ai}=-\log w_{ai}$，$C_{\text{edge}}=\lambda\sum c_e$。
  3. **森林优化**（式 11–13）：$C_{\text{open}}=\kappa\,m(S,F)$（$m$=连通分量数=「独立证据链」条数），最优解可设为森林故 $m=|S|-|F|$，定义结构增益 $B_e=\kappa-\lambda c_e$ 后目标等价于 $\sum_{i\in S}(p_i-\kappa)+\sum_{e\in F}B_e$。**语义**：孤立记忆要自证 $p_i>\kappa$ 才值得单开一条链，能挂到已选分量上的只需 $p_i-\lambda c_e$——**自适应 k 由此而来**，不需要额外的每节点惩罚。求解：1-swap 局部搜索（收敛极快，六次后增益可忽略）+ 每个提议集用 Kruskal 精确求最大权森林；平手时优先更少记忆、再优先更早名次。
- **实测参数（§4.1/§A.2）**：$L=24$ 种子、$H=1$ 跳、互 $k$NN $k=8$、$M=48$ 候选、读者 $K=10$；编码器 gme-Qwen2-VL-2B-Instruct（1536 维）；节点效用 $(\alpha,\tau,\delta)=(0.8,5.2,0.7)$ ≡ $p_i=\sigma(4.2s_i+0.2v_i-3.6)$（**检索先验权重 4.2 vs 验证器 0.2**，验证器只是修正项）；schema 可靠性上限 0.99、$\lambda=0.1$、$\kappa_{\text{prop}}=0.2$、$\kappa=0.12$；三阶段 32k 上下文 / temperature 0；验证器 ≤8,192 输出 token、读者 ≤1,000。
- **★ 控制实验的反例（§A.6，Table 9/10）**：冻结候选与节点效用、固定 $K=10$ 时，**通用多样性/覆盖类选择器全部不优于朴素 top-K**（Top-K 56.87 / MMR 56.84 / Rel.–Red. 56.82 / Facility 56.80 / DPP 52.69），按**净回收**看甚至是负的（MMR −6、DPP −36、Rel.–Red. −4、Facility −2）；而用**已验证关系**的 Anchor–Neighbor +14、ECV Pointwise +12、Greedy Forest +18、**Forest Proposal +43**（H2HMem 一项 +31，通用选择器最多 +1）。⇒ **「让列表更不相似」本身没有价值**；价值在「把已验证的关系路径变成低排名证据的回收」。
- **两个验证器必须分开**（§4.4.4）：合并成一次调用（同一 JSON schema 同时输出两个判断）反而更差；分离两调用 **Acc +2.00 / R@10 +3.00**，且两者并行无串行代价，ECV 不覆盖节点分数。
- **关系可信度是查询条件化的**（§4.4.3）：给所有可接受边一个 query 无关的固定可靠性（0.99）反而更差；ECV 把每题边数从 6–7 条压到 **0.25–1.47** 条，Hit@10 反升 1.83~5.60。
- **序列化（§A.5）**：每个分量取效用最高的节点为根 → 分量按根效用排序 → 分量内**宽度优先**遍历；平手按节点效用、再按原始检索顺序 ⇒ 读者先看到直接锚点，再看到由关系捞回的补充。
- **增量消融（macro J.Acc.，Table 3）**：49.20（embedding top-k）→ 53.60（+多视图）→ 58.80（+节点验证器）→ 59.70（+ECV 重排）→ **61.55**（+森林优化）。
- **主结果**：Qwen3-VL-8B 下四基准 macro 61.55（第二好 UniversalRAG 49.80，**+11.75**）；Gemma 4 12B 下 67.42（+12.33）；ATM-Bench 全生命周期比 A-MEM/VimRAG/LightMem 缩短 **1.78×/4.27×/4.74×**（位于准确率–成本 Pareto 前沿）。
- ⚠️ **写路径是空的**：本文刻意不做写时压缩，**没有** audit/merge/prune/reinforce 等维护机制，记忆只增；抗冗余/抗冲突全在查询时靠角色门控解决。

## 与我的工作 / 记忆的映射

- **印证我们的路线**：它反对「写时生成式压缩」，坚持查询时按需组织——与我们的「hook 字段 + 索引 + 查询时 BM25 + 读前 2-3 篇」同向；它的成本论证（离线摘要贵且丢局部线索）可以引用为「不做离线 LLM 摘要」的论据。
- **★ 先别做通用去冗余/多样性重排**：控制实验（Table 9/10）里 MMR 56.84 / DPP 52.69 **不优于**朴素 top-K 56.87，净回收还是负的（−6 / −36）。要做的是「用**已验证的关系**够到低排名证据」（+43）。这条应写进 design/协议，防止未来凭直觉给 `note_recall` 加相似度惩罚项。
- **多视图 max-pool 是我们能直接搬的**：同一条记录用多个视图各自打分取 max，而不是拼成一个 bag 打一次分。我们现在 `composePassage` 把 `title + hook(operator/pattern/techniques/applications) + topic + body(≤800)` **拼成一个 passage** ⇒ 长正文会**稀释** hook 的强匹配。改成按视图打分取 max，零新依赖。
- **锚点条件下的「冗余 vs 互补」判定正是我们 1.0 缺口里的「技巧调用体系」**：`note_recall` 现在返回**扁平排名**，没有「相对已选中的那条，这条是新增/澄清/佐证/冗余/冲突」的信息。六角色可以本土化成确定性版本（hook.techniques/pattern 的 Jaccard + operator 是否相同 + `duplicate_of`/`superseded` 字段），不需要任何模型调用；但落地方式是**角色门控**（决定要不要采纳关系证据），不是列表惩罚项。
- **「开链成本」解释了我们为什么该放弃固定 k**：`maxResults` 是硬截断；式 12 给的是「孤立证据要自证价值、可挂靠的证据按边际收益收」的自适应基数。我们的等价物是「先锚点、再按边际贡献决定是否继续加」。
- **可达性分层 + 净回收指标（Table 4/5/10）能直接量化我们的「顺链扩读」**：Direct（top-10 内）/ Recoverable（top-10 外但候选图内）/ No access；并且要统计**带符号**的净变化（捞回一条是否挤掉了另一条），单侧计数会高估。AGENTS.md §5 要求顺链扩读，但**我们从未测过它到底值多少**。零 token 可测。
- **不适用**：图优化求解器（Kruskal/1-swap）——我们候选规模是个位数，纯属过度工程；两个 LVLM 验证器——违背「插件不调模型」红线；全部多模态分支；「只增不维护」的路线（我们体检比它强，不要削自己）。
- ⚠️ **源质量与复读**：MinerU 的 `full.md`/`content_list.json` 对该 PDF 有系统性 `<sub>` 破坏（词中被切开 3954 处），本卡的内容以 **`pdftotext -layout` 从 `source.pdf` 直抽的文本**为准（复读后补齐了超参数、控制实验与序列化细节，并修正了首版「靠去冗余取胜」的误读）。
- **反向提醒**：本文的强项是**读路径**，弱项是**维护与自改进**（空）；我们的强项恰好相反。吸收时只取读路径的结构，不要因为它把「不维护」说成优点就跟着简化体检。

## 研读状态

- 状态：distilled
- 研读日志：reading/liGraphMemixQueryAwareEvidence2026.md（已创建；含 14 节完整记录 + 5 条行动项）

## 原文

- [MinerU 全文](.raw/liGraphMemixQueryAwareEvidence2026/full.md)
- [PDF](.raw/liGraphMemixQueryAwareEvidence2026/source.pdf)
