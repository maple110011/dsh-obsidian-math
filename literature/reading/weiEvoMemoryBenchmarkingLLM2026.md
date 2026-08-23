# 研读记录：Evo-Memory — Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory

## 0. 元信息

- citekey：weiEvoMemoryBenchmarkingLLM2026
- 标题：Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（方法 + 四组 RQ + 结论）

## 1. 一句话定位

把静态数据集转成流式任务序列，评测 agent 测试期「自演化记忆」；提出 ExpRAG（经验检索聚合）与 ReMem（Think/Act/Refine 循环，把记忆精化作为显式动作）。

## 2. 问题与动机

先前工作只测静态对话召回，忽略「跨任务积累与复用经验」；需要统一基准回答"记忆能否在部署期真正自演化"。

## 3. 记忆结构

记忆 M_t 随历史演化；经验条目 m = 结构化经验文本 {输入, 输出, 反馈}。

## 4. 写路径（固化）

- ExpRAG：每个任务把 (x, ŷ, feedback) 打包成一条经验，直接 append。
- ReMem：Refine 动作做元推理——利用有用经验、剪噪声、重组 M_t，再写入。

## 5. 读路径（检索）

- ExpRAG：按检索分 top-k 取相似经验注入。
- ReMem：Think 分解任务 + 检索，Refine 精化记忆，Act 执行。

## 6. 组织与关系

任务级经验（而非逐轮消息）；反馈 f_t 区分成功/失败。

## 7. 维护与自改进

Refine 是核心：选择性利用、剪枝噪声、重组——失败经验不精化直接积累会带来噪声。

## 8. 验证与质量门控

反馈 f_t 写入记忆；失败感知（failure-aware）记忆演化。

## 9. 成本 / 安全 / 隐私

ReMem 步数更少（AlfWorld 22.6→11.5），效率更高。

## 10. 关键数字 / 阈值

任务相似度与增益相关 r=0.717（Gemini）/0.563（Claude）；Hard→Easy 迁移最好（0.94/0.97）；无过滤失败经验使基线退化。

## 11. 评估方法

AIME/GPQA/MMLU-Pro/ToolBench（单轮）+ AlfWorld/BabyAI/PDDL/ScienceWorld（多轮）；四组 RQ（效果/记忆改善/难度序列/反馈）。

## 12. 可迁移机制清单

1. 失败经验必须「精化后」再入记忆，不能无过滤 append（对应我们 capture-policy + 体检，但可更显式）。
2. 显式 Refine 动作：把「记忆精化」作为每轮可选步骤，而非只在每日体检做。
3. 经验条目带 feedback（成功/失败）——我们 records 有 verified/success_rate，可补 outcome 字段。
4. 任务相似度→增益：提醒我们 hook/templates 对「重复题型」最有效，对发散任务收益有限。

## 13. 与 dsh-math-memory 的映射与差距

- ExpRAG → 采纳：等价于 note_recall 检索相似经验 + 模板卡。
- ReMem Refine → 改造：我们有三写 + 每日体检，但缺「每轮显式记忆精化」这一步（可加进 AGENTS.md）。
- 失败感知 → 改造：artifact 反例已存在，但 antipattern 机制待强化（handoff 已知）。
- 反馈 → 采纳：feedback 闭环已有（[对]/[错]），可把 outcome 写进 records。

## 14. 行动项

1. AGENTS.md 增「Refine 步」：本轮结束后若发现某条记忆被新证据修正，主动精化对应 records（而非只追加 episode）。
2. records 卡可选加 outcome/success 字段，与 verified、success_rate 并列。
3. 体检新增「未精化的失败经验」提示（把 artifact 反例纳入 antipattern 清单）。
