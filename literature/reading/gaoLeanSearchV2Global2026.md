# 研读记录：LeanSearch v2（Global Premise Retrieval for Lean 4 Theorem Proving）

## 0. 元信息

- citekey / 标题 / 年份：gaoLeanSearchV2Global2026 / LeanSearch v2: Global Premise Retrieval for Lean 4 Theorem Proving / 2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（.raw/gaoLeanSearchV2Global2026/full.md），Abstract/贡献/Method/实验表/Conclusion 精读，Related Work 扫标题

## 1. 一句话定位

解决「全局前提检索」：一次找回整条定理证明所需的一组分散库引理（非单条、非局部）。核心主张：标准模式（层级非形式化语料 + 嵌入-重排）做基座，推理模式以 sketch-retrieve-reflect 迭代组装连贯引理集，全程无领域微调。

## 2. 问题与动机

gap：语义搜索只找单个 declaration；premise selection 只看当前 proof state 的局部一步。二者都恢复不了整条定理需要的引理集合——它们靠证明策略的逻辑架构相连而非共享词汇。找不到就重复证明已有引理。

## 3. 记忆结构

- 语料 = Mathlib 全部可提取 declaration，每项存 kind/全限定名/签名/value/源位置/依赖/非形式化描述。
- Jixia 抽取声明+依赖图（DAG），拓扑排序后自底向上非形式化（每项以「已非形式化的依赖」为上下文接地）；Qwen3-32B 主、Gemini 2.5 Pro 兜底。
- 检索侧：Qwen3-Embedding-8B 编码结构化 passage（任务指令+kind+签名+非形式化描述；value 仅 def/class/instance 保留，定理 proof term 是噪声）；Qwen3-Reranker-8B 做 kind-aware 重排。

## 4. 写路径（固化）

离线一次性构建、无增量学习，触发 = 库演化时重跑非形式化；去重靠 declaration 全限定名唯一；版本化 = 语料快照，评测用交集子集控 snapshot drift。无微调便于随库演化维护与迁移。

## 5. 读路径（检索）

- 标准模式：嵌入 top-50 → 重排（P(yes) 打分）→ 输出。
- 推理模式：sketch 生成器把定理拆成子查询（只写证明策略，不写代码/引理名）→ 各子查询走标准模式（当黑盒）→ filter 逐条判相关/不相关，**可返回空集**（区分「检索到但无用」与「没检索到」，top-k 会混淆）→ judge 二值 accept/reject + 结构化反馈（哪步失败、为何）→ reviser 改写重试，≤3 轮、2 并行分支。
- 聚合：丢弃原始分（跨子查询不可比），只用 rank 折扣 1/log2(i+2) 求和去重。

## 6. 组织与关系

核心结构是 declaration DAG：非形式化沿拓扑序，描述基于依赖。benchmark 以 premise group（组内可互换）+ alternative routing（等价路线）刻画「多路线达同一证明」。

## 7. 维护与自改进

无微调 => 库演化只重跑语料构建；judge-reviser 是运行期自改进；2 并行分支是低成本方差削减。

## 8. 验证与质量门控

- judge 二值可行性判定 + 结构化拒绝；accept 即质量门。
- LLM-as-judge：3 次匿名随机排列、严格全序、报 mean rank；发现 primacy bias 0.42-0.58 rank，用平衡位置分配消除。
- 下游 extrinsic：固定 prover loop 只换 retriever，验证检索质量传导到证明率。

## 9. 成本 / 安全 / 隐私

推理模式单查询约 $1.10；标准模式嵌入全语料约 6 GPU 小时，服务化后 0.2s/查询、重排 top-50。预算：3 轮 revision、2 分支、输出均值 30.6 条。推理模式把标准模式当黑盒（只发 NL 查询），两层可独立改进。

## 10. 关键数字 / 阈值

- Search：nDCG@10 0.623 vs 0.533；Recall@10 0.780；LLM judge rank 1.63。重排 +10 点，kind-aware +2-3（def/instance 收益，theorem 近零）。
- MathlibMPR：69 定理，premise group 1-8（mean 2.96）；Recall(group)@10 46.1 vs DIVER 38.0 vs 最好 premise-selection 9.3；Covered@10 30.4 vs 24.6。
- Prove：FATE-H 20% vs 16%（INF-X）vs 4%（无检索）。
- judge 接受 46/69（66.7%）：29 初始即过、11 一改、6 两改，无接受者需第 3 轮。
- rank 折扣：rank1=1.00、rank2=0.63、rank3=0.50。

## 11. 评估方法

专家构建：MathlibQR（200 声明/946 查询/6 种 query style/难度标签）、MathlibMPR（69 个 merged PR 定理，premise group + alternative routing；PR 晚于 prover 知识截止 6 个月防污染）。指标：nDCG@k、Recall@k、Recall(group)@k、Covered@k（完整路线全命中才计）。可借鉴：「回答是否命中能独立支撑结论的记录组」作 covered 被动信号；LLM judge 排列去偏。

## 12. 可迁移机制清单

1. 集合级检索：把用户问题当定理，检索「一组联合支撑答案的记录」；Covered = 某完整证据路线全命中。
2. sketch-retrieve-reflect：蒸馏子查询→逐条检索→filter 判相关（可空集）→judge 结构化反馈→改写重试≤1 次（补 judge）。
3. 空信号语义：显式区分「检索到但无用」与「没检索到」，强化 coverage<0.35 判词面巧合。
4. rank-only 聚合：跨异构子查询丢原始分，1/log2(i+2) 位置折扣求和去重。
5. kind-aware passage：按记录类型定制编码模板与重排/体检提示，验证收益。
6. 依赖接地写描述：把关联记录/概念作上下文（topics 链），不孤立写。
7. 等价记录组：duplicate-candidates 升级为可互换组，组内任一条命中即算。
8. 分层黑盒：检索层只暴露 NL 查询、推理层只消费排序结果，符合 fail-closed 分层。
9. 无微调维护：不微调、只靠非形式化+kind 提示；全 markdown 无 DB 同理。
10. LLM-as-judge 去偏：匿名+随机排列+位置修正，校准检索质量。

## 13. 与 dsh-math-memory 的映射与差距

- 单查询 BM25 全层排序 = 标准模式弱化版，缺重排 → 改造（可选加语义/kind-aware 重排）。
- coverage 弱信号 = Covered/空信号雏形，缺「完整路线全命中」判据 → 改造；精读协议 = sketch-retrieve-reflect 轻量版，缺 judge 反馈与显式空集 → 改造。
- records 类型化 + source/superseded = kind-aware passage + 唯一名，有 kind 但未验证检索收益 → 采纳（验证）；topics = DAG 弱对应，无「概念依赖→接地描述」 → 采纳。
- duplicate-candidates = premise group 弱版，升级为等价记录组 → 改造；每日体检确定性零 LLM 成本，缺路线级信号 → 采纳（补 covered）。
- 无删除/归档/全 markdown = 无微调/快照，理念一致 → 采纳（对齐）。
- 不适用：Lean 形式化、prover loop、Jixia 抽取、嵌入语料构建（无大库语义检索需求，保持零模型依赖确定性主路）。

## 14. 行动项

1. note_recall 加「集合级覆盖」：按证据路线分组的记录命中 + Covered（先被动评估，不进主路）。
2. 精读协议加结构化 judge（相关/不相关/空集 + 失败原因），反馈喂改写器，保留「仍无则明说没有」。
3. 实现 rank-only 聚合（1/log2(i+2)）供多子查询改写。
4. 定义等价记录组：duplicate-candidates 升级为可命中组，组内任一条命中即算。
5. 各 record 类型做 kind-aware passage 模板 + 重排/体检提示，用 daily audit 验证收益。
6. 记录/卡描述附关联概念上下文（topics 链），接地式描述。
7. 一次性 LLM-as-judge（匿名+随机排列+位置去偏）校准检索质量，仅作参考。
