# 研读记录：shutovaEvaluatingMemoryStructure2026

## 0. 元信息

- citekey：shutovaEvaluatingMemoryStructure2026
- 标题：Evaluating Memory Structure in LLM Agents
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（.raw/shutovaEvaluatingMemoryStructure2026/full.md）

## 1. 一句话定位

提出基准 StructMemEval，测 LLM agent「能否组织长期记忆」而非仅事实召回；核心主张：需要结构化组织的任务上，简单 RAG 随规模扩展失效，记忆 agent 在「被提示如何组织」时能稳定求解，但模型往往不会自发识别所需结构。

## 2. 问题与动机

现有长期记忆基准（LOCOMO、LongMemEval）主要测单跳/多跳召回、时间更新，而 EMem 这类简单检索基线就能超过复杂记忆架构，说明这些基准没测到「复杂记忆层级」的真实价值。作者追问：什么任务真正需要复杂记忆结构？答案之一：需要「组织知识」的任务（账本、待办、树、状态跟踪、偏好聚合）。

## 3. 记忆结构

- 实现无关（implementation-agnostic）：不规定内部 schema，只评最终答案；但任务被设计成「结构对则简单、无结构几乎不可解」。
- 四类结构模式（对应人类记笔记方式）：
  1. Tree：家谱/公司层级，含隐含关系与双向边。
  2. State tracking：实体状态随时间变化（邻居/城市语境化）。
  3. Counting：交易账本、净额结算、抵消环债。
  4. Recommendation：从事件史聚合偏好与运行统计。
- 每场景 = 对话史 + 不同深度的问题（10–500 条消息）。
- 参考记忆框架：Mem-agent（markdown 笔记）、Mem0（图数据库）；检索基线：原始消息检索、EMem/EMem-G（EDU 粒度检索）。

## 4. 写路径（固化）

- 记忆 agent 从原始消息提取知识，写 markdown 笔记（Mem-agent）或图条目（Mem0）。
- 关键失败点（反面清单）：漏记交易、重复计数（同一交易不同标签记两次）、凭空捏造记录、只记单向边、状态变化后不更新关联实体。
- 论文本身不规定写入纪律；「organization hint」是任务级结构提示，仅用于诊断。

## 5. 读路径（检索）

- 检索基线：text-embedding-3-large + top-10 passage；EMem 转 EDU，linking_top_k=30、qa_top_k=10。
- 记忆 agent：从结构化笔记/图中按需取回并推理，而非整段消息召回。
- 观察：检索系统小规模可行，复杂度超出检索窗口后骤降；间接查询（隐含关系、语境化的「邻居」）尤其误导纯检索。

## 6. 组织与关系

- 树需要双向链接与隐含关系推导（A 是 B 继女 + C 是 B 妻子 ⇒ C 是 A 母）。
- 状态跟踪需要「按地点/状态分组」而非平铺记录。
- 账本需要聚合/净额而非逐条存储。
- 结论：组织形态（图/分层/分组/聚合）由任务决定；「怎么存」决定「能不能取」。

## 7. 维护与自改进

- 论文不提出维护协议；通过 error analysis 给出反面清单（缺双向边、未传播状态更新、幻觉记录、重复记录）。
- 用有/无 hint 对照，把「不知道要组织」与「组织执行失败」解耦。

## 8. 验证与质量门控

- 评估用 LLM-as-judge（gpt-4o-mini）对照参考答案判事实正确性。
- 数据合成 + 人工校验；合成场景规避真实隐私数据。
- 局限：主评测未跑多种子（API 成本高）；含专有模型有弃用风险，故补 deepseek-v4 开源权重模型。

## 9. 成本 / 安全 / 隐私

- 合成数据规避敏感用户/商业数据隐私。
- 编码数百轮对话昂贵 → 主集只测 51 个最长场景。
- 纯评测基准，无 fail-closed 等安全机制。

## 10. 关键数字 / 阈值

- 207 场景（90 tree / 45 count / 42 state / 30 recsys），>2000 问，10–500 消息；主集 51 个（每类最长，≥250 消息）。
- 检索 top-10；EMem linking_top_k=30、qa_top_k=10；top-20 仍差。
- Table 1（gemini-3.1-pro，Total 等权）：Retrieval 0.06、EMem 0.175、EMem-G 0.19、Mem-agent 0.66、Mem0 0.39。
- Table 2（Mem-agent 不同 backbone，Total）：gemini-3.0-flash 0.53、gemini-3.1-pro 0.66、gpt-5.5 0.35、deepseek-v4-flash 0.46、deepseek-v4-pro 0.47。
- 关键结论：hint 带来的提升 > Mem0 与 Mem-agent 之间的差异。

## 11. 评估方法

- 最终答案级评测（不看内部结构），实现无关；任务设计解耦模型其它能力（编程/推理）。
- 长度缩放分析（横轴 = 消息数/边数/状态转移数/交易数）。
- 有/无 hint 对照诊断（区分「不组织」vs「执行失败」）。
- 轨迹审查：LLM 辅助 + 人工核验，归纳失败模式。
- 可借鉴被动信号：双向链完整性、状态变更是否传播到关联记录、重复/缺失/凭空记录率。

## 12. 可迁移机制清单

1. 把「organization hint」诊断法搬进 note_recall 调试：失败时注入任务级结构提示，判断瓶颈在「没识别结构」还是「执行/检索」。
2. 为 dsh-math-memory 设计结构压力题（tree/state/counting/recsys 型），测 theorems 索引、templates 图、notation 体系，而非只测 BM25 召回。
3. 体检清单新增「双向链完整性」检查：A→B 存在而反向缺失即 flag。
4. 体检新增「状态变更传播」检查：superseded/状态变化后，依赖它的 records/templates 是否被标记过期。
5. 引入 distractor/无关消息压力，量化 coverage 弱信号 + 无关干扰下的召回鲁棒性。
6. 用 LLM-as-judge 自动打分 recall 质量（对照标准答案），作为被动质量信号。
7. 长度缩放评估：随笔记条数增长测 note_recall 命中率拐点，给出容量上限。
8. 失败模式分类表（缺向边/重复/幻觉/漏记/未传播）直接扩充每日体检的结构校验项。

## 13. 与 dsh-math-memory 的映射与差距

- 采纳：hint 诊断法；结构压力题设计原则；双向链 + 状态传播体检项。
- 改造：LLM-as-judge 打分 → 结合 verified 三级与 loopback 做成半自动质量信号；EDU 粒度检索思路 → 我们的 kind-aware passage 已部分覆盖，可加句子级 passage。
- 不适用：他们只测最终答案、实现无关，我们有固定五层 schema 的确定性系统，不能照搬「不规定结构」。
- 差距：我们缺「结构组织」维度的自我评估；模型写 hook 时可能「知道算法但不主动套结构」（对应其 Option B），capture-policy 是最接近 hint 的机制，可强化为按 record 类型的结构模板。

## 14. 行动项

1. 在 capture-policy 中为每种 record 类型写显式「结构模板 + 最小字段」，作为常驻 hint。
2. 体检增加两类确定性校验：双向链完整性、被 supersede 后依赖项的陈旧标记。
3. 造 10–20 条 dsh-math-memory 结构压力样例（定理依赖、学习进度状态、使用统计、偏好聚合），纳入回归。
4. note_recall 失败时执行一次 hint 诊断（注入结构提示重试），结果写进体检报告。
5. 用 LLM-as-judge 对 recall 结果做月度抽检打分，回填 verified 弱信号。
