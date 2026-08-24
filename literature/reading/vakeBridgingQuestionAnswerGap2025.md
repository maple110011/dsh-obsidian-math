# 研读记录：vakeBridgingQuestionAnswerGap2025

## 0. 元信息

- citekey：vakeBridgingQuestionAnswerGap2025
- 标题：Bridging the Question-Answer Gap in Retrieval-Augmented Generation: Hypothetical Prompt Embeddings（HyPE）
- 年份：2025（IEEE Access）
- 阅读日期：2026-08-24
- 阅读方式：MinerU 全文通读（.raw/vakeBridgingQuestionAnswerGap2025/full.md）

## 1. 一句话定位

把 query↔document 对齐从查询期（HyDE）搬到索引期：为每个 chunk 预计算多个「假设问题」并嵌入，检索变 question-question 匹配，零查询延迟。

## 2. 问题与动机

query（疑问式）与文档（陈述式）风格鸿沟；HyDE 在查询期生成合成答案（每次查询多一次 LLM 调用 + 有延迟）。HyPE 把生成搬到离线索引期。

## 3. 记忆结构

- 每 chunk 关联 k 个「假设问题」嵌入（多向量），索引 E = {(v_ij, C_i)}。
- 小 chunk 高精度 + 返回整 chunk 上下文（兼顾精确与上下文）。

## 4. 写路径（固化）

- 索引期 LLM 对每 chunk 一次生成 k 个「可回答该 chunk 的问题」（question 式）；一次性 n 次 LLM 调用（n = chunk 数）。

## 5. 读路径（检索）

- 查询期零 LLM：embed query → ANN 找最近问题向量 → 返回关联 chunk。
- question-question 匹配（同风格聚类 + 多问法覆盖）。

## 6. 组织与关系

- 无图结构；「多问题表示」替代单一 chunk 向量，扩大语义覆盖。

## 7. 维护与自改进

- 无维护；作者明示「prompt 质量筛选/领域化生成」是未来工作（当前所有问题等权）。

## 8. 验证与质量门控

- 6 数据集 + RAGChecker（context precision / claim recall / faithfulness / hallucination / noise sensitivity / self-knowledge）。
- Wilcoxon + Holm 校正，9/11 指标 p<0.10，Cliff's |δ| 0.44–0.72（中等~大效应）。

## 9. 成本 / 安全 / 隐私

- 索引期 n 次 LLM 调用（一次性）；查询期零 LLM、latency 平。
- 对超大语料索引成本可观（严格 ∝ 语料大小）。

## 10. 关键数字 / 阈值

- claim recall +16pt / precision +20pt 平均；Single-Topic 最高 +44.6pt。
- hallucination 19.9 vs Naive 26.0（↓）；「relevant noise sensitivity」21.0 vs 13.8（↑，冗余重复放大噪声）。
- MS MARCO（短 passage + 高词面重叠）增益小（饱和）。

## 11. 评估方法

- RAGChecker 的检索层（precision/recall）+ 生成层（faithfulness/hallucination）分离度量。
- 可借鉴：检索层与生成层分离评测，对应我们 engine-probe（检索）+ E2E（生成）。

## 12. 可迁移机制清单

1. **applications 写「问题式」**：hook.applications 用「这条卡回答哪些问题/解哪些题」措辞（BM25 版的「假设问题」）。
2. **去重合并**：同一卡多字段命中时合并，避免「冗余重复放大噪声」（对应 HyPE 的 relevant noise sensitivity 变差）。

## 13. 与 dsh-math-memory 的映射与差距

- 采纳：applications 问题式措辞；命中去重合并。
- 改造：把 HyPE 的「索引期假设问题」降级为「每卡一个 applications 字段」（小 vault，无需多向量）。
- 不适用：embedding、多向量索引、离线大规模 LLM 生成。
- 差距：我们 hook 字段已接近「索引期增强」，但 applications 的「问题式」措辞未强调。

## 14. 行动项

1. templates/_README 与 AGENTS.md 把 applications 写成「问题式」示例。
2. note_recall 对「同一卡多 hook 字段命中」去重（按 card 聚合分数，不重复返回）。
