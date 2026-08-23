# 研读记录：Belief Memory — Agent Memory Under Partial Observability

## 0. 元信息

- citekey：liaoBeliefMemoryAgent2026
- 标题：Belief Memory: Agent Memory Under Partial Observability
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（方法 + 结果 + 消融）

## 1. 一句话定位

记忆应存「信念分布」而非「点估计」：每个属性保留多个候选结论及概率，检索返回完整信念，避免自我强化式错误。

## 2. 问题与动机

POMDP 下点估计记忆丢弃不确定性；错误结论会被自我强化（例：存「API X 失败」后不再重试，错过反驳证据）。

## 3. 记忆结构

M = {属性 c → {候选结论 h → 证据概率 p}}；每个属性存多个带证据的候选，而非唯一结论。

## 4. 写路径（固化）

- Add：新属性存候选（概率夹在 [pmin, pmax]）。
- Merge：新证据 noisy-OR 合并 p←1−(1−p)(1−Δ)，上限 0.99；竞争候选降到 0.25。
- 归档旧版本，支持时间推理。

## 5. 读路径（检索）

检索分 = 语义相似 × 时间衰减 λ^τ；返回完整信念（所有候选+概率），让决策时看到备选。

## 6. 组织与关系

按属性组织候选；staleness 时间戳驱动衰减。

## 7. 维护与自改进

noisy-OR 持续合并证据；历史版本归档。

## 8. 验证与质量门控

概率上限 0.99 防止「确定」；竞争候选降权；wrong 反馈可纠正。

## 9. 成本 / 安全 / 隐私

只用 16.67% 记忆库即超 5/6 基线；50% corpus 仍最优。

## 10. 关键数字 / 阈值

0.99 合并上限；0.25 竞争降权；时间衰减 λ^τ；ALFWorld SR 59.88 vs ReadAgent 54.03。

## 11. 评估方法

LoCoMo + ALFWorld；F1/BLEU/SR/steps；消融（w/o belief / retrieval / Add / Merge）。

## 12. 可迁移机制清单

1. 对可修订事实/偏好存「候选 + 置信」而非单一结论。
2. wrong 反馈 = 降权而非直接改结论（我们 feedback wrong 减 success_rate 方向一致，可强化为「保留备选」）。
3. 检索排序加时间衰减（我们 memo 提醒已有 recency 项，可推广到 records）。
4. 归档历史版本（我们 superseded 版本化已具备，可类比「保留历史信念」）。

## 13. 与 dsh-math-memory 的映射与差距

- 点估计风险 → 改造：fact/preference 卡通常只存当前结论，可对可修订属性存候选+置信。
- wrong 反馈降权 → 采纳：feedback wrong 已减 success_rate，可补「保留被否结论为备选」。
- 时间衰减 → 改造：memo 已有 recency，records 检索可加 staleness 项。
- 归档历史 → 采纳：superseded 已有，语义对齐。
- 概率门控 → 改造：verified 三级是粗粒度替代，可加 confidence 字段。

## 14. 行动项

1. fact/preference 类卡增加 confidence（或复用 verified + success_rate），wrong 反馈降权而非只改 status。
2. records 检索排序考虑 staleness（复用 memo 的 recency 机制）。
3. 体检对「长期未受质疑的单一结论」增加复审提示（自我强化风险）。
