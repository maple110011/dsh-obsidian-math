# 研读记录：yuanMemSearcherIterativeMemory2026

## 0. 元信息

- citekey：yuanMemSearcherIterativeMemory2026
- 标题：MemSearcher: Iterative Memory Integration for Search Agent via End-to-End Reinforcement Learning
- 年份：2026（ACL 2026 Findings）
- 阅读日期：2026-08-24
- 阅读方式：MinerU 全文通读（.raw/yuanMemSearcherIterativeMemory2026/full.md）

## 1. 一句话定位

搜索 agent 每轮用 LLM 把历史压成 ≤1K token 的紧凑记忆、只留与问题相关的信息，替代 ReAct 的 O(n) 上下文增长；multi-context GRPO 端到端训练。

## 2. 问题与动机

ReAct 把完整交互史（thought/action/observation）拼进上下文，O(n) 线性增长；搜索 agent 的 observation 是检索 passage，噪声多、成本/显存高，且易因实体混淆答错。

## 3. 记忆结构

- 每轮输入 = (question, memory_prev)，memory 是自然语言、≤1024 token、只留任务相关信息。
- 记忆由 LLM（作为「记忆管理器」）每轮迭代整合（memory_prev + observation → memory）。

## 4. 写路径（固化）

- 每轮 observation 后，LLM 读 (memory_prev, observation) 生成新 memory（保留相关、丢弃无关）。
- 训练用 RL（multi-context GRPO）：轨迹级 advantage 传播到每轮，逐轮独立优化；loss mask 屏蔽工具 token。

## 5. 读路径（检索）

- 无外部检索（memory 就是上下文）；动作是「搜索」或「作答」。
- 上下文 O(1)、FLOPs/turn O(1)、总 FLOPs O(n)。

## 6. 组织与关系

- 扁平自然语言记忆（无图/结构化）；「记忆管理器」软集成，避免 ReAct 的历史拼接。

## 7. 维护与自改进

- RL 直接奖励「最终答案对」，让模型学「留什么、丢什么」——记忆维护内生于训练。
- 训练奖励两阶段：前 25 步陡升（学会搜索+记忆基本交互），之后平缓（精细化）。

## 8. 验证与质量门控

- 7 数据集 Exact Match；3B/7B/14B 三档；与 SFT 对比（RL 43.8 vs SFT 28.5）。

## 9. 成本 / 安全 / 隐私

- context <4K token（可资源受限部署）；训练需 8 H100（3B/7B）。
- 无安全边界讨论（通用 QA）。

## 10. 关键数字 / 阈值

- MemSearcher 3B 43.8 > 7B baselines；7B 48.9 > ReSearch 32B。
- memory 长度 256（简单任务饱和）~1024（复杂任务更好）为最优；默认 1024。

## 11. 评估方法

- EM + token 数随轮次曲线（效率层）；RL vs SFT 对比。
- 可借鉴：token 数随轮次的「稳定 vs 线性」作为效率指标（对应我们注入预算的稳定性）。

## 12. 可迁移机制清单

1. **迭代 working memory**：dialogue index 从「注入静态问答对」升级为「每轮迭代更新的紧凑 working memory」（question + 上轮记忆 → 本轮记忆）。
2. **记忆长度最优值**：印证注入预算（≤18000 字符）+「读前 2-3 条」。

## 13. 与 dsh-math-memory 的映射与差距

- 采纳：迭代紧凑记忆（作为 dialogue index 的增强方向）。
- 改造：我们是「压缩注入、保留证据」而非「丢弃」——memory 应指向 episodes/records 证据，而非丢掉。
- 不适用：RL 训练（frozen model）、无工具搜索 agent 场景。
- 差距：我们的 dialogue index 是「静态快照」而非「每轮迭代」，可借鉴 MemSearcher 的迭代语义。

## 14. 行动项

1. 评估 dialogue index 是否值得改成「每轮迭代的 working memory」（question + 上轮摘要 → 本轮摘要），而非静态问答对注入。
2. 保持「压缩注入、证据留磁盘」的哲学，不与 MemSearcher 的「丢弃」混淆。
