# 研读记录：Are We Ready For An Agent-Native Memory System?

## 0. 元信息

- citekey：zhouAreWeReady2026a
- 标题：Are We Ready For An Agent-Native Memory System?
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（方法总览 + 四模块细粒度消融 + 结论）

## 1. 一句话定位

从数据管理视角系统评测 agent 记忆系统：把记忆拆成「表示/存储、提取、检索路由、维护」四模块，逐模块消融给出最有效的做法与选型指导。

## 2. 问题与动机

记忆系统碎片化、缺统一评测；需要知道每个模块哪种设计真的有效。

## 3. 记忆结构（表示与存储 taxonomy）

- 表示：token 序列 / 图-树拓扑 / 异构复合（文本+元数据+向量+链接）。
- 存储：瞬态上下文寄存器 / 单引擎（向量库、图库、SQL、文件）/ 多引擎混合。

## 4. 写路径（提取）

raw 拼接 / schema-free 语义提取 / schema-constrained 结构化提取。

## 5. 读路径（检索与路由）

原生注意力 / 稠密 KNN / 子图遍历 / agentic 自主路由 / 多阶段混合（BM25+稠密+重排）。

## 6. 组织与关系

图/树/分层/复合容器；层级主要改善「访问」，不能恢复被删内容。

## 7. 维护与自改进

时间戳多版本 / 容量驱动淘汰（硬淘汰 vs 评分淘汰）/ LLM 语义合并（内联合并 vs 工具 CRUD）/ 参数化持续优化。

## 8. 验证与质量门控

LLM-as-judge + 消融对照；关键结论 O8-O11。

## 9. 成本 / 安全 / 隐私

评测了记忆操作成本（RQ5）；文件/对象存储保留原始证据但检索需额外索引。

## 10. 关键数字 / 阈值

关键发现 O8-O11（见 §11/§13，比具体数字更有价值）。

## 11. 评估方法

LoCoMo + LongMemEval；EM/Ans.F1/Substr.EM/ROUGE-L；逐模块造变体消融。

## 12. 可迁移机制清单（核心发现）

- O8 内容保真：保留原文 > 轻压缩 > 摘要；层级只改善访问、不能恢复被删内容 → 我们 episodes append-only 已对，records 抽象要克制。
- O9 晚过滤：写时保留覆盖而非激进过滤；粗分割、轻改写、存 user+assistant 两侧 → 三写「原文只在 episodes」已对，警惕 records 过度抽象。
- O10 规划与融合：显式规划 + 均衡稀疏/稠密融合最有效；规划后再加反思无收益 → 我们蒸馏查询已有；纯 BM25 可补稠密做 hybrid。
- O11 保守合并：保守整合优于延迟 flush 与过粗总结 → 我们 merge/supersede 阈值应保守。

## 13. 与 dsh-math-memory 的映射与差距

我们 = 文件存储 + BM25 稀疏 + hook schema-constrained 提取 + 导航注入 + audit LLM 合并 + superseded 多版本。与最佳实践高度一致；差距：纯稀疏（无稠密 hybrid）、无显式容量淘汰（靠 unused 归档）、检索无「均衡融合」。

## 14. 行动项

1. 坚持「原文证据优先」，episodes 永不摘要化、records 抽象克制（已符合，写入检查清单）。
2. 未来可选 hybrid：BM25 + 本地 embedding 均衡融合（对应 O10）。
3. merge/supersede 阈值保守化，避免过早合并分散线索。
4. 体检 unused 用「访问×交互×新近度」热度替代单一未用。
