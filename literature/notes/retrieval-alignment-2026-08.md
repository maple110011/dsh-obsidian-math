# 检索对齐四篇综述（2026-08-24）

> 四篇新入库文献（Dual RAG / QueryLink / HyPE / MemSearcher）的跨论文综合：它们围绕同一个主题——**检索的「query ↔ memory 语义对齐」**——对 dsh-math-memory 的改进建议。逐篇卡片见 `cards/`，逐篇研读见 `reading/`。

## 一句话结论

四篇一致指向同一个缺口：**我们的 memory-side 增强已做（hook.techniques/applications），但 query-side 增强缺失、且两侧没有「共享措辞」的对齐自觉**。检索命中仍靠 BM25 词面巧合，而不是「挑战 ↔ 应用」的语义对齐。

## 四篇各自的贡献

| 论文 | 核心机制 | 对我们的映射 |
|---|---|---|
| Dual RAG（Yang 2025） | 检索**证明技巧**（不只定理）；query（挑战+草图）与 document（应用+技巧）双增强 | 确认 P0-1：query 蒸馏结果应参与索引/打分 |
| QueryLink（Hu 2026） | 对称多粒度表征（Raw/Semantic/Keyword + centroid）+ union 检索；flat > graph | hook 字段分字段加权；applications 问题式 |
| HyPE（Vake 2025） | 索引期预计算「假设问题」，question-question 匹配 | 印证 hook 是索引期增强；applications 写问题式 |
| MemSearcher（Yuan 2026） | 每轮 LLM 把历史压成 ≤1K token 紧凑记忆 | dialogue index 可迭代化（但保留证据、不丢弃） |

## 综合行动项（按收益/成本排序）

1. **P0 · `applications` 改「问题式」措辞**（Dual RAG + HyPE + QueryLink 共同指向）：`hook.applications` 从「陈述式用途」改为「这条卡能回答/解决哪些问题」，与 note_recall 的 query 挑战词面对齐。改 `records/_README.md` + `templates/_README.md` 模板提示 + AGENTS.md §2 hook 纪律即可，零引擎改动。

2. **P0 · note_recall 的 hook 字段分字段加权**（QueryLink 多粒度）：现在 `composePassage` 把 hook 字段拼进单个 passage 让 BM25 打一个分；改为 operator/pattern/techniques/applications 各自与 query 打分后融合（techniques/applications 命中加权更高）。这是「BM25 版多粒度检索」，不依赖 embedding。

3. **P1 · query-side augmentation 落地**（Dual RAG 的明确缺口）：note_recall 的「挑战描述 + 候选技巧」蒸馏结果，除了当查询文本，还应把「挑战」与 card 的 `applications` 显式比对（或至少把蒸馏结果写入检索语料）。这是 assessment.md 第 2 轮已点名的 P0-1，本轮四篇再次坐实。

4. **P1 · 命中去重合并**（HyPE 的 noise sensitivity 教训 + QueryLink k=4）：同一卡因多个 hook 字段/多个词命中时按 card 聚合，不重复返回同一卡；note_recall 默认 top-k 与「读前 2-3 条」保持一致。

5. **P2 · theorem-index 加「技巧」维**（Dual RAG）：theorems 登记时同时写「证明用到什么技巧」，让定理检索也能按技巧命中（不只按定理名/领域）。

6. **P2 · dialogue index 迭代化评估**（MemSearcher）：考虑把「静态问答对注入」改为「每轮迭代更新的紧凑 working memory」（question + 上轮摘要 → 本轮摘要），但坚持「压缩注入、证据留磁盘」不丢弃。低优先，需实测收益。

## 不照搬的部分

- 四篇都依赖 embedding + LLM 索引/重排；我们隐私/零部署约束下仍走 BM25 + hook 字段（已在 references.md 论证过）。
- MemSearcher 的 RL 训练（frozen model，无训练管线）与「每轮丢弃无关信息」（与我们「持久化、可回溯」冲突）不照搬。
- QueryLink 的「flat > graph」只是确认了我们的扁平五层 markdown 路线，不需改结构。

## 与既有两篇蒸馏的衔接

- MemTrapBench（已蒸馏）：记忆「适用性」防御——本批四篇都在讲「怎么检索到」，MemTrapBench 讲「检索到了怎么用」；两者互补：检索对齐负责召回，适用性防御负责使用。
- Shutova（已蒸馏）：结构压力题 + hint 诊断——本批四篇提供了「换说法/同技巧不同定理/技巧类」的具体压力题素材。
