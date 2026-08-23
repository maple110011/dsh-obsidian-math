# 研读记录：AgentIR: Reasoning-Aware Retrieval for Deep Research Agents

## 0. 元信息

- citekey：chenAgentIRReasoningAwareRetrieval2026
- 标题：AgentIR: Reasoning-Aware Retrieval for Deep Research Agents
- 年份：2026
- 阅读日期：2026-XX-XX（MinerU 全文）
- 阅读方式：MinerU 全文通读（.raw/chenAgentIRReasoningAwareRetrieval2026/full.md）

## 1. 一句话定位

Deep Research 智能体每次检索前会显式产出自然语言推理轨迹（reasoning trace），其中携带查询意图、对既往结果的反思、以及对后续目标的假设；本文提出「推理感知检索」把该轨迹与查询联合编码，并用 DR-Synth 从普通 QA 数据合成智能体子查询级训练数据，得到 AgentIR-4B。

## 2. 问题与动机

现有多轮 Deep Research 中，检索器只收到孤立的子查询 q_t，但子查询天然欠指定（歧义、依赖前文线索），传统检索（query-only）容易把「backroom studio early 2010s euphoric」误解为游戏工作室；而 HyDE 式的查询扩展需要额外 LLM 调用、且只靠参数知识、不感知智能体状态。同时缺乏面向智能体子查询的检索训练数据（传统 QA 只有全局 Q 的正文档，子查询只针对 Q 的一个子线索）。

## 3. 记忆结构

无显式持久化记忆层；其「记忆」表现为多轮交互轨迹 H_t = (τ_1, a_1, o_1, …, τ_t, q_t)。关键发现是：当前轮的推理轨迹 τ_t 本身就是一种「隐式策划过的工作记忆」——它条件于完整历史生成，因此会总结既往已确认线索、并滤掉过期/错误假设。信号来源被分解为三类：任务意图（implicit instruction）、对既往结果的反思、对搜索目标的假设（类 HyDE 但更接地）。

## 4. 写路径（固化）

无记忆写入，而是「训练数据固化」：DR-Synth 从标准 QA 三元组 (Q, A, P) 出发，跑智能体 rollout 得到 T-1 个子查询；每轮取 query-only 检索 top-50、把正文档 P 前插、用 LLM 做 listwise 重排（输入 q_t、全局 Q、真实答案 A），取第 1 名为正例、末 7 名为 hard negatives；只对成功答对 Q 的 rollout 做 rejection sampling 后训练。=> 固化纪律：正例保证既对本轮相关又对齐全局目标；负例是「被排序器判定为无关」的难负样本。

## 5. 读路径（检索）

检索输入由 query-only 改为联合编码 [τ_t, q_t]（拼接模板），用 contrastive loss（温度 0.01）微调 Qwen3-Embedding-4B。推理时零额外开销（τ_t 本就「免费」产生）。消融证明：仅拼接轨迹不训练即 +6.9 点；仅训练不用轨迹 +10.7；二者叠加最大。空结果语义：无显式空结果处理，但揭示「把全文检索轨迹（含文档）塞回输入会传播噪声」——Prior Queries & Reasonings & Docs 设置下 11.45% 任务零召回、平均 37.46 轮。

## 6. 组织与关系

无图谱/层级导航。核心组织洞察是「上下文工程向检索器延伸」：不是喂越多的历史越好，而是当前轮 τ_t 已经天然完成对历史的「策划（curation）」。k=1 的当前推理已覆盖 >40% 的历史原子线索，且随 k 增加覆盖收益递减；加入更多历史轮次引入的错误假设噪声远多于有用信号（「遗忘是特性」）。

## 7. 维护与自改进

无 audit/merge 循环；「自改进」体现在训练端：用真实答案 A 作为 oracle 重排的监督，使标签同时对齐 q_t 与全局 (Q,A)；仅保留成功 rollout 的 rejection sampling 相当于「只从有效轨迹里提炼记忆」。

## 8. 验证与质量门控

正文档必须「对本轮相关且不违反全局约束」（满足 X 但违反 Y/Z 的文档要排低）；rejection sampling 只用答对的任务做训练，作为数据质量门。评估端用 LLM-as-judge 的端到端 QA 准确率、Recall（所有检索命中与 ground-truth 证据文档之比）、Search Calls 三个指标交叉看质量与效率。

## 9. 成本 / 安全 / 隐私

推理零额外开销（复用 τ_t）是其卖点；但对比 LLM rerank（top-20 用 Qwen3-8B）仍更便宜。DR-Synth 合成数据需 LLM 重排成本，但一次性离线。无本地/隐私/fail-closed 议题（云端检索模型）。

## 10. 关键数字 / 阈值

- BrowseComp-Plus：20+ 次搜索的复杂多跳任务；AgentIR-4B 68%（含 visit）vs Qwen3-Embed-8B 50.72/52%、BM25 33.98/37%、Qwen3-Embed-4B 48.67%、LLM Rerank 55.66%。
- Recall 78.86 vs 59.90；Search Calls 25.91 vs 31.02（Tongyi-DR，query-only 为 Qwen3-Embed-4B）。
- 组件消融（Tongyi-DR）：w/o Training 55.54、w/o Reasoning 59.40、full 66.27。
- DR-Synth：5,238 训练实例；top-50 候选、top-1 正例、bottom-7 难负例；温度 0.01。
- 检索信号对比：当前推理 66.27 > Global Question 63.25 ≈ Prior Queries 63.13 > Prior Q&R&Docs 60.00。
- k=1 覆盖 >40% 历史线索；全历史引入噪声 >> 信号。

## 11. 评估方法

端到端 QA Accuracy（LLM-as-judge，同 BrowseComp-Plus 协议）、Recall（智能体所有搜索调用命中 ground-truth 证据文档的比例）、Search Calls（效率）。可借鉴的被动信号：**零召回率**（11.45% 任务全未命中 → 检索失败的可观测信号）、**搜索轮数膨胀**（检索差时 37.46 轮 vs 27.18 轮 → 效率作为质量代理）、**线索覆盖率**（当前推理覆盖多少历史原子线索 → 判断是否需要补历史）。

## 12. 可迁移机制清单

1. 检索时把「当前推理/意图」与「查询」拼接（或给 BM25 查询加简短意图前缀），而不是只用裸查询；但只拼当前轮，不拼全历史。
2. 「当前推理 = 已策划的历史」：把模型上一轮的结论/已确认事实压缩进本轮查询，主动丢弃过期候选与错误假设（遗忘是特性）。
3. 用「最终任务是否成功」作为弱监督信号筛选哪些检索轨迹值得固化（rejection sampling 的本地化版本）。
4. 零召回率作为检索失败的被动体检信号，触发改写重试（对应现有精读协议的空结果重试）。
5. 搜索轮数膨胀作为检索质量代理指标，进入每日体检。
6. 难负样本思路：把「被判定无关/错误」的候选当负样本，反向校准 BM25 参数或训练轻量重排。
7. 训练数据要同时覆盖「推理型查询」与「词面匹配型查询」，避免专精推理后伤害普通检索。

## 13. 与 dsh-math-memory 的映射与差距

| 论文机制 | 我们现状 | 判定 |
| --- | --- | --- |
| [τ_t, q_t] 联合编码 | note_recall 用蒸馏后的裸查询做 BM25，未带推理/意图前缀 | 改造（加意图前缀，不必上 dense） |
| 当前轮推理胜过全历史 | 精读协议有蒸馏查询，但无「只保留已确认事实、丢错误假设」的显式纪律 | 采纳 |
| oracle 重排产出 relevance 标签 | 反馈闭环 [✅对][❌错] 已是确定性 relevance 信号，但未反向用于检索校准 | 改造（把 wrong 标记当难负样本） |
| rejection sampling（只固化成功轨迹） | records 靠 confirmed 升级，episodes 全留 append-only | 采纳（已有雏形） |
| 零召回/轮数膨胀信号 | 体检只有结构校验（缺 source/断链/未入索引），无检索质量信号 | 采纳（新增被动指标） |
| 4B dense 微调 | 我们全 markdown、无数据库、无 dense embedding | 不适用（保留 BM25，本地轻量重排可考虑） |
| DR-Synth 数据合成 | 无合成训练数据需求 | 不适用 |

## 14. 行动项

1. 给 note_recall 的查询增加可选的「检索意图前缀」字段（模型产出蒸馏查询时同时给一句当前目标/已确认事实），拼进 BM25 查询，但限制长度与「只保留当前轮确认事实」。
2. 在精读协议里明确一条：改写查询时丢弃上一轮失败/被否的候选与假设，只携带已确认线索。
3. 把 loopback 的 ❌错 标记沉淀为「难负例清单」，用于人工检查 BM25 排序或未来训练轻量重排。
4. 在每日体检中新增两个被动信号：单轮零召回计数、同任务检索轮数相对基线是否膨胀。
5. 保留 BM25 词面基线不退化：任何检索增强都做成「词面 + 推理感知」混合，而非替换。
