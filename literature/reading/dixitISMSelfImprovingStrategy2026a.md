# 研读记录：ISM — Self-Improving Strategy Memory for Continual Mathematical Reasoning

## 0. 元信息

- citekey：dixitISMSelfImprovingStrategy2026a
- 标题：ISM: Self-Improving Strategy Memory for Continual Mathematical Reasoning
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（方法 + 记忆控制器 + 结果；本项目 v2-proposal 已深度消化）

## 1. 一句话定位

冻结 LLM + 外部策略记忆 + 七种独立调度的自维护机制 + 符号验证门控，实现持续数学推理中的自改进记忆。

## 2. 问题与动机

episode 间硬性 reset、只共享外部记忆；需要记忆随使用自审计、自纠错、自合并、自剪枝、自强化，防止错误泛化入记忆。

## 3. 记忆结构

schema = 内容（描述/解法模板/启发式）+ feature hook（operator/pattern/heuristics/quantity/embedding 质心/success_rate）分离；内容稳定、hook 在线更新。

## 4. 写路径（固化）

成功与失败都结构化沉淀（对称学习）；每次更新过符号验证。

## 5. 读路径（两级检索）

算子硬过滤 → 加权软打分：结构 0.15 + 启发式 0.15 + 数量 0.05 + 嵌入 0.55 + 成功先验 0.10。

## 6. 组织与关系

operator 一级硬过滤键；embedding 质心支撑 merge/prune。

## 7. 维护与自改进（七机制，独立调度）

Audit（每 10 集）/ Correct（weak 且有 ≥5 用，3 次失败升格剪枝）/ Merge（每 20 集，cos>0.88，seed 保护）/ Promote-Demote（ρ≥0.8 +2%、ρ≤0.4 −5%）/ Prune（每 25 集）/ Reinforce（每 15 集，成功集蒸馏新启发式）/ Antipattern（每 20 集，失败集提取要避免的错误）；条件演化门（≥10 集且同算子近 20 集失败 ≥3 才合成新 schema）。

## 8. 验证与质量门控

每次更新（hook/merge/rewrite/promote/reinforce/antipattern/synthesis）过符号验证，防错误泛化。

## 9. 成本 / 安全 / 隐私

冻结 LLM；记忆严格有界。

## 10. 关键数字 / 阈值

300 集持续学习；记忆规模比最强被动基线少 64%/86%、比 retrieval 类少最多 23×；Promote ≥0.8 +2%、Demote ≤0.4 −5%。

## 11. 评估方法

数学基准持续学习流 + 六基线 + 消融；领域漂移鲁棒性。

## 12. 可迁移机制清单

我们已实现大部分：hook 块、audit（strong/weak/unused/duplicate/unverified）、merge/reinforce/demote 协议、verified 三级、反馈闭环。仍可补：
1. 显式 promote/demote：verified + success_rate 作为 note_recall 打分先验（±权重）。
2. antipattern 从 artifact 提升为独立体检项（失败集→要避免的错误）。
3. 条件演化门：同 operator 多次失败才建议新模板/卡。
4. 体检按机制分周期调度（audit/merge/prune 不同频率）。

## 13. 与 dsh-math-memory 的映射与差距

我们是 ISM 的本土化（无 embedding 质心、无符号验证器，用 verified 三级 + provenance 替代）。差距：无显式 promote/demote 打分调权、antipattern 待强化、无条件演化门、无 warmup/周期调度。

## 14. 行动项

1. note_recall 打分显式加 verified/success_rate 先验（对应 promote/demote）。
2. 体检把「失败经验」纳入 antipattern 清单（artifact 反例结构化）。
3. 条件演化门：同一 operator 多次失败才建议新建/拆分模板卡。
