# 研读记录：Memory OS of AI Agent

## 0. 元信息

- citekey：kangMemoryOSAI2025
- 标题：Memory OS of AI Agent
- 年份：2025
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（架构 + 更新 + 检索 + 结果）

## 1. 一句话定位

用 OS 的分段分页 + 淘汰策略做 agent 记忆：STM（对话页）→ MTM（主题段）→ LPM（人格），按「热度」淘汰与升级，兼顾主题一致与长期个性化。

## 2. 问题与动机

平铺 FIFO（MemGPT）导致主题混杂；纯图（A-Mem）链接生成重、延迟高、误差累积。需要系统化的分层管理。

## 3. 记忆结构

- STM：对话页 page = {Q, R, T, meta链}，链式维护连续上下文。
- MTM：同主题对话页聚成 segment（每段一个 LLM 摘要），分段分页。
- LPM：User Persona（静态画像 + User KB 事实 + 90 维 traits）+ Agent Persona（静态 + 动态 traits）。

## 4. 写路径（固化）

- STM→MTM：FIFO，STM 队列满时最旧页迁入 MTM。
- MTM→LPM：热度超阈值（τ=5）的段升级为 LPM 更新人格；段删除按热度。
- Heat = α·访问次数 + β·交互页数 + γ·新近度（exp 衰减）。

## 5. 读路径（检索）

MTM 两段式：先按（语义 cos + 关键词 Jaccard）选 top-m 段，再在段内选 top-k 页；STM 全取；LPM 取 top-10 相关条目。

## 6. 组织与关系

三层 + 分段分页；段=主题，页=对话，人格=长期偏好。

## 7. 维护与自改进

热度驱动的段淘汰与 LPM 升级；LPM queue 固定 100 FIFO。

## 8. 验证与质量门控

无显式验证门控，靠下游任务。

## 9. 成本 / 安全 / 隐私

LoCoMo 全面超 A-Mem/MemGPT（GPT-4o-mini 与 Qwen2.5-3B 均第一）。

## 10. 关键数字 / 阈值

Heat 三因素；τ=5；trait 90 维；LPM queue 100；LoCoMo single-hop F1 35.27 vs A-Mem 27.02 / MemGPT 26.65。

## 11. 评估方法

GVD + LoCoMo；F1/BLEU 分项 + 平均 rank；消融（去三层任一层）。

## 12. 可迁移机制清单

1. 热度淘汰（访问 × 交互 × 新近度）替代单一 unused——我们体检的 unused/demote 排序可改为三因素效用。
2. 分段分页对应我们 topics 层（段=主题，页=episode），检索两段式（先段后页）我们已有「导航层→索引→全文」。
3. 人格分静态/动态 + 90 维 trait：profile 可借鉴结构化 trait，但仍保留自由文本。

## 13. 与 dsh-math-memory 的映射与差距

- STM/MTM/LPM → 改造：我们 episodes=页、topics=段、profile=LPM，已同构；缺「热度」这一动态淘汰/升级信号。
- 两段式检索 → 采纳：已有导航注入 + note_recall 精读，等价。
- 人格分层 → 改造：profile 目前自由文本，可补静态/动态标注。
- 固定队列 → 不适用：我们 markdown 不设队列，用体检 + 归档。

## 14. 行动项

1. daily audit 的 unused 排序改为 Heat=0.5×verified + 0.3×访问频次 + 0.2×新近度（与 MACLA 剪枝同款）。
2. profile.md 模板增加「静态画像 / 动态 trait / 事实库」小节提示。
