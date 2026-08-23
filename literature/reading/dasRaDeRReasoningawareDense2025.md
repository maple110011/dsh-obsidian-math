# 研读记录：RaDeR: Reasoning-aware Dense Retrieval Models

## 0. 元信息

- citekey：dasRaDeRReasoningawareDense2025
- 标题：RaDeR: Reasoning-aware Dense Retrieval Models
- 年份：2025
- 阅读日期：2026-XX-XX（MinerU 全文）
- 阅读方式：MinerU 全文通读（.raw/dasRaDeRReasoningawareDense2025/full.md）

## 1. 一句话定位

针对「推理密集检索」中查询与相关文档（如定理）词面/语义重叠极低、现有 dense 检索器不如 BM25 的问题，RaDeR 用检索增强的 MCTS 数学解题轨迹 + 自反思相关性评估合成高质量训练数据，训练出首个在 CoT 推理步骤作查询时超过 BM25 的一阶段 dense 检索器与重排器。

## 2. 问题与动机

推理型相关性预测需要「读懂子问题需要哪个定理/算法」，而现有检索器只会词面/语义匹配：图 1 中「pigeonhole principle」与题目/CoT 之间没有匹配词，GPT-4 的推理步骤只描述如何套用鸽笼原理、并不能帮检索定位它。已有方案要么是「交错推理+检索」（受限于 off-the-shelf 检索器）、要么是「推理重排器」（受限于首阶段候选集）；缺乏真正的一阶段推理检索器，且缺乏「格式/长度/推理复杂度多样 + 难负样本」的训练数据。

## 3. 记忆结构

无持久记忆，核心是**解题轨迹树**：MCTS 从题目 M 出发，节点是中间推理步 s_i，动作集 A = {OST 单步思考、CRS 补全余下解、QG 生成检索查询、RT 检索定理}。检索到的定理经「自反思」（relevant/non-relevant + 解释）过滤后才作为节点入树，并经「自摘要」压缩后融入后续推理。正文档 = 成功轨迹里被检索且判定相关的定理；难负样本 = 同查询下被判 non-relevant 的检索结果。这是「把解题过程中的定理使用证据固化成正负样本」的结构。

## 4. 写路径（固化）

数据合成（非记忆写入）：对每个数学题做 16 次 MCTS rollout，奖励 = 终态答案是否正确（R=1/0），只采样「含检索节点的高奖励轨迹」。每条轨迹产 (q, p, N)：p = 被检索且自反思判为相关的定理；N = 同查询下被判 non-relevant 的定理。四种查询类型：(1) q_CoT = 到查询节点为止的部分解；(2) q_llmq = LLM 生成的、与正定理低词面重叠的推理型查询；(3) q_question = 原始题目；(4) q_lexical = 高词面重叠查询，用 Promptagator 式 round-trip 一致性（BM25 top-20 命中正定理才保留）过滤。=> 纪律：正例必须有「成功解题 + 自反思相关」双重背书；负例直接来自被拒定理。

## 5. 读路径（检索）

一阶段检索用 uni-embedding bi-encoder（Qwen2.5-instruct 3B/7B/14B，另测 gte-Qwen2-7B、Llama-3.1），InfoNCE contrastive loss，12 个 hard negatives + in-batch negatives。重排用 pointwise cross-attention 模型，直接给相关分（无 test-time compute，比 RANK-1 等更省）。空结果/负样本语义：被自反思判 non-relevant 的定理不丢，反而当难负样本——「不相关」是训练信号而非失败。

## 6. 组织与关系

组织在「定理语料（ProofWiki）+ 解题轨迹树」两层：轨迹树是导航结构，定理语料是检索目标。关键关系是「子问题 ↔ 定理」由推理步骤连接——定理对子问题相关则对原题相关。q_CoT 用部分解当查询、把「应用定理的场景」与定理本身对齐，弥补词面鸿沟。四种查询类型显式平衡「推理型 vs 词面型」检索能力，防止顾此失彼。

## 7. 维护与自改进

无 audit/merge；「自改进」内嵌在数据管线：自反思（相关性过滤 + 解释）剪枝无关节点、自摘要把定理压缩进后续推理、奖励引导 MCTS 向正确轨迹收敛。局限三自省：奖励只看最终答案，错误的 CoT 也可能撞出正确答案 → 训练数据会带噪（与我们「verified 需用户参与、单源不算数」的态度同构）。

## 8. 验证与质量门控

双重门：数学题金答案验证（终态正确性作为检索相关性的 proxy）+ 自反思相关性标签（relevant/non-relevant + 理由）。前者是客观可核验的（数学题可判对错），后者是模型自评（有噪声）。对应到我们：✅/❌ 反馈是用户参与的更强门，self-reflection 可作中间弱门。

## 9. 成本 / 安全 / 隐私

数据合成是一次性离线成本（16 rollouts/题 × MCTS 展开 + 自反思/自摘要 LLM 调用），训练数据量小（43,120 条，仅为 REASONIR 的 2.5%）是卖点。推理时 bi-encoder/pointwise reranker 无 test-time compute，比推理式重排省。无本地/隐私议题（云端模型 + ProofWiki 公开语料）。

## 10. 关键数字 / 阈值

- 训练数据：MATH 43,120 条（+NuminaMath 约 78K 用于重排对比）；16 rollouts/题；12 hard negatives/查询；in-batch negatives。
- 数据效率：43,120 ≈ REASONIR 1,729,368 的 2.5%，nDCG@10 仍高 +1.1 点（+4.5% 相对）。
- BRIGHT（问题作查询）：最佳 avg nDCG@10 = 25.5，比最强基线高至少 2 点；TheoQ +12.1/+11.3（问题/CoT 查询），Leet +8。
- 首个 CoT 查询 zero-shot 超过 BM25 的 dense 检索器。
- RAR-b（Math/Coding）：gte-Qwen2-7B 0.852/0.835，逼近 OpenAI-3-large 0.877/0.894。
- MS MARCO：Dev MRR@10 34.4、R@1k 98.1（与强基线 competitive，推理训练不伤词面）。
- 重排（top-100 BM25）：超 GPT-4 +2.5/+2.1 nDCG；LeetCode/TheoremQA +20.3/+20.4。
- 下游 QA（TheoremQA）：no-retrieval 71.0 → in-context RAG+RaDeR 75.0（RepLLaMA 72.6、gold 77.6）→ MCTS+RaDeR 80.2（gold 81.5）。

## 11. 评估方法

双层评估：检索层（BRIGHT/RAR-b 用 nDCG@10，MS MARCO 用 MRR@10/R@1k，另报 recall/precision）+ 下游 QA 层（TheoremQA 的最终准确率，验证检索对推理模型的实际增益）。可借鉴的被动信号：**「问题→定理」低词面重叠场景的检索失败**（我们的 theorems 索引正是同类）、**round-trip 一致性过滤**（BM25 top-20 是否命中正例，作为查询质量的确定性检查）、**最终任务成功率 vs 检索命中率的相关**（判断检索是否是瓶颈）。

## 12. 可迁移机制清单

1. 把「定理 ↔ 应用场景/子问题」对齐写进 theorems 索引：为每条定理补「典型应用场景、触发它的问题特征」字段，弥补词面鸿沟（等价于人工构造 q_CoT）。
2. 自反思相关性标签（relevant/non-relevant + 理由）作为检索命中的中间弱门：模型选卡后先自评「这张卡是否真的相关并给理由」，不相关就当作难负样本沉淀。
3. 自摘要：把命中的长定理/记录压缩成一句话摘要再进入上下文（对应现有 kind-aware passage，可显式产出摘要 artifact）。
4. 四种查询类型平衡「推理型 + 词面型」：任何对 note_recall 的增强都保留 BM25 词面基线，混合打分。
5. 金答案可验证性作为相关性 proxy：数学任务里「最终解对错」可确定性判据，用来给相关记录加权重。
6. 难负样本来自「被否定的检索结果」：把 loopback ❌ 与自反思 non-relevant 累积为负例池，用于调 BM25 参数/训练轻量重排。
7. round-trip 一致性（BM25 能否 top-k 找回正例）作为查询质量的确定性检查，纳入每日体检。
8. 奖励只信最终答案会带噪 → 重要记忆升级仍需用户确认（强化现有 verified 三级）。

## 13. 与 dsh-math-memory 的映射与差距

| 论文机制 | 我们现状 | 判定 |
| --- | --- | --- |
| 一阶段 dense 推理检索器 | note_recall 是纯 BM25，无 dense | 不适用（保留 BM25；可评估轻量重排） |
| 推理→定理低词面检索 | theorems 索引存在，但靠 BM25 词面，未补「应用场景」字段 | 采纳（补场景/特征字段） |
| 自反思相关性（relevant + 理由） | 精读协议靠模型判断「是否适用」，但无显式理由字段 | 改造（显式化理由并沉淀） |
| 自摘要压缩命中内容 | kind-aware passage 有截断，无「摘要 artifact」 | 改造（可产摘要卡） |
| 难负样本来自被否结果 | ❌ 反馈改写 status，但未积累负例池 | 采纳（建负例池） |
| 金答案验证作 proxy | 数学任务天然可验证，未用于记忆加权 | 采纳 |
| 数据平衡（推理+词面） | 无训练，天然只有 BM25 词面 | 改造（增强时做混合） |
| 奖励只看终态致噪 → 需用户确认 | verified 三级已要求用户参与升级 | 采纳（已有，保持） |

## 14. 行动项

1. 为 theorems 索引每条补「典型应用场景 / 触发特征 / 常见子问题」字段，让推理型查询能词面命中（人工版 q_CoT）。
2. 在精读协议中把「是否适用」改为「相关性判断 + 一句理由」，理由入库，non-relevant 命中记入负例池。
3. 把命中卡片的「一句话摘要」作为可选产物写回 artifact 卡（自摘要本地化）。
4. 用 loopback ❌ 与自反思 non-relevant 建持久负例池，供 BM25 参数校准或未来轻量重排训练。
5. 每日体检增加 round-trip 检查：抽样笔记→用其关键词 BM25 检索→确认 top-20 能找回该笔记（查询质量/索引完整性）。
6. 数学类任务把「最终解是否正确（✅/❌）」作为相关记录/定理的确定性加权信号。
7. 保持任何检索增强为「BM25 词面 + 推理感知」混合，防止推理专精伤害普通笔记召回。
