# 研读记录：yangRetrievalAugmentedLanguageModels2025

## 0. 元信息

- citekey：yangRetrievalAugmentedLanguageModels2025
- 标题：Retrieval-Augmented Language Models are Mimetic Theorem Provers（Dual RAG）
- 年份：2025（EMNLP 2025 Findings）
- 阅读日期：2026-08-24
- 阅读方式：MinerU 全文通读（.raw/yangRetrievalAugmentedLanguageModels2025/full.md）

## 1. 一句话定位

LLM 配检索到的**证明**（不只是定理陈述）能当「拟态定理证明器」；Dual RAG 用 LLM 双向增强 query（挑战+草图）与文档（应用+技巧），把「语义远但策略近」的定理拉近。

## 2. 问题与动机

现有 RAG for 数学检索主要检索「前提定理」；作者发现即使检索定理不同，只要检索到「证明技巧」LLM 就能迁移（mimetic proving）。于是追问：检索什么（定理 vs 证明技巧）？怎么检索（语义相似 vs 挑战相似）？——回答是：两者都要，且要按「推理挑战」对齐。

## 3. 记忆结构

- 检索单元 = chunk（定理 + 证明 + 例子 + 备注的逻辑单元，LLM-based chunking）。
- 关键区别：**证明技巧是可迁移的检索目标**，与定理陈述正交。
- 对应我们的：records/templates 的 hook 块（operator/pattern/techniques/applications）= 已把「技巧」结构化；theorem-index 缺「技巧」维。

## 4. 写路径（固化）

- Document-side augmentation（索引期）：LLM 为每个已知定理写「定理摘要 + 潜在应用 + 证明技巧分析」三件套，作为可检索上下文。→ 这正是我们 hook 块的 `applications` / `techniques` 字段，但论文把它写成「可检索面」而非「元数据」。

## 5. 读路径（检索）

- Query-side augmentation（查询期）：LLM 分析目标定理的「底层挑战」+ 生成证明草图，作为查询。→ 我们的「问题蒸馏（挑战+技巧关键词）」就是这步，但**蒸馏结果不参与索引/打分**。
- Rerank：按「对证明的用处」排序，避免语义相似但无关。

## 6. 组织与关系

- 关系 = 「挑战↔应用」的对齐，而非「语义相似」。两个定理字面不相关，但依赖同一技巧（如 Borel-Cantelli 子序列）就该被一起检索到。
- 对应我们：`related` 双链 + 同 operator 的 pattern/techniques 才是真正的「策略近」判据。

## 7. 维护与自改进

- 无维护循环；消融证明 augmentation > rerank > chunking，即「字段质量」比「排序/切块」更关键。
- 暗示：我们的 hook 字段的**填写质量**（applications 写得像不像「可检索问题」）是 recall 的决定因素。

## 8. 验证与质量门控

- Exercise100（100 题、4 本研究生教材、人工标注 gold context）；专家 0/0.5/1 打分校验「检索提升 → 证明质量提升」。
- 研究级案例：arXiv API 证明理论 ML 开放问题（专家确认「基本正确、只需小改」）。

## 9. 成本 / 安全 / 隐私

- 纯 RAG，无 fail-closed 考虑；DeepSeek-V3 做增强、DeepSeek-R1/o1 做生成（在线 API）。
- 增强是离线（文档） + 在线（query 一次 LLM 调用）。

## 10. 关键数字 / 阈值

- Coverage@K：Dual RAG vs Vanilla +10.62~34.19；Technique 子集 K=8 达 100%、Δ_r +37.75。
- 生成：DeepSeek-R1 +Dual RAG 82/96/90/88（PT/HDP/RA/TP）vs raw 62/90/80/64；Δ_g 2~12。
- 消融：w/o Rerank -3~8、w/o Aug -8~27、w/o Chunk -9~34（Aug 最重要）。

## 11. 评估方法

- Coverage@K（gold context 覆盖度）作为检索层指标，专家打分作为生成层指标——两层解耦、可各自回归。
- 可借鉴：造「定理类 vs 技巧类」两分集，测 note_recall 对「技巧类」题型的召回（这正是我们最弱、最该测的）。

## 12. 可迁移机制清单

1. **query-side augmentation 落地**：note_recall 的蒸馏（挑战+技巧）应进入检索打分，而非只当 prompt 纪律。
2. **applications 写成像「问题」**：hook.applications 用「这条卡能解/能证明 X 类题」的措辞，与 query 挑战词面对齐。
3. **theorem-index 加「技巧」维**：theorems 登记时同时写「证明用到什么技巧」，让定理检索也能按技巧命中。
4. **「定理 vs 技巧」分集回归**：引擎探针加「技巧类」ground-truth（换说法/同技巧不同定理）。

## 13. 与 dsh-math-memory 的映射与差距

- 采纳：query 挑战 ↔ card 应用的字段对齐；theorem-index 加技巧维。
- 改造：applications 措辞从陈述式改「问题式」；note_recall 蒸馏结果参与打分。
- 不适用：embedding + LLM rerank（隐私/零部署约束下仍走 BM25 + hook）。
- 差距：我们只有「半程」——document-side（hook 字段）已做，query-side（蒸馏参与索引）缺失，正是 assessment.md 第 2 轮点名的 P0-1。

## 14. 行动项

1. note_recall 把 query 蒸馏的「挑战 + 技巧关键词」作为额外打分项（或至少把 distillation 结果写进查询语料）。
2. records/templates 模板的 `applications` 字段改为「问题式」提示（「这条卡能回答/解决哪些问题」）。
3. theorems/_README 增加「证明技巧」登记字段。
4. engine-probe 增加「技巧类」ground-truth 用例。
