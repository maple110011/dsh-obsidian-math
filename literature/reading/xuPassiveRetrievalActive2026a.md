# 研读记录：From Passive Retrieval to Active Memory Navigation（NapMem）

## 0. 元信息

- citekey：xuPassiveRetrievalActive2026a
- 标题：From Passive Retrieval to Active Memory Navigation: Learning to Use Memory as a Structured Action Space
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（方法 + 主结果 + 结论）

## 1. 一句话定位

把长期用户记忆重构为「多粒度记忆金字塔 + 工具式主动导航」，用 GRPO 训练 agent 主动选择访问哪一层（而非被动检索）。

## 2. 问题与动机

被动检索把记忆当静态语料；实际应让 agent 学会「何时用、用哪层、用多细」的记忆使用策略。

## 3. 记忆结构（金字塔，自底向上）

raw conversations（原始对话，append-only，含 role/time/id）→ memory records（fact/event/instruction/preference 四类，带 id/type/content/时间/source 消息 id）→ topic tracks（主题文件：元数据+摘要+叙事）→ user profile（顶层稳定画像，长度预算）。

## 4. 写路径（固化）

增量自底向上：新对话 append raw → 批量提取/调和 records（新增/更新/supersede/矛盾）→ 更新 topic tracks → 更新 profile（按预算压缩）。

## 5. 读路径（检索 = 工具式导航）

五个工具：get_conversations / search_conversations / get_records / search_records / read_files；agent 顺序决定访问哪层（自顶向下或自底向上），有工具调用预算。

## 6. 组织与关系

相邻层用 provenance 链接贯通；records 是基本语义单元，topic 是中程抽象，profile 是全局。

## 7. 维护与自改进

records 两阶段增量调和；profile 按预算压缩；RL 训练粒度选择策略。

## 8. 验证与质量门控

奖励 = 格式 + 正确性 + 用对记忆工具（正确且用对才 +1，滥用扣分）；工具调用预算。

## 9. 成本 / 安全 / 隐私

RL 后非记忆任务无谓记忆调用 34.51%→6.90%；保留非记忆能力。

## 10. 关键数字 / 阈值

NapMem-9B w/RL 平均 62.74，超 397B 的 59.85；四类 records；工具预算。

## 11. 评估方法

LoCoMo / LongMemEval / PersonaMem-v2 + 非记忆基准（GPQA-D/BFCL/V*Bench）；消融与工具使用分析。

## 12. 可迁移机制清单

1. 四层金字塔与我们五层几乎一一对应（raw=episodes, records=records, topic=topics, profile=profile）——验证了我们的结构选择。
2. 工具式主动导航：note_recall/note_search/note_links/read 已近似，缺「粒度选择」显式化。
3. records 四类 fact/event/instruction/preference 与我们一致（我们多 artifact）。
4. 「用对工具给分、滥用扣分」→ 用被动信号（无谓检索率、空结果率、命中引用率）校准。
5. profile 按长度预算压缩（我们已有 120 行约束）。

## 13. 与 dsh-math-memory 的映射与差距

高度同构（NapMem 像我们系统的「训练版」）。差距：我们无 RL 训练粒度选择、无 topic track 的「叙事」形式、无显式工具调用预算。

## 14. 行动项

1. 保持四类 records + artifact，不新增第五类。
2. AGENTS.md 检索路由已按粒度分路，可补「默认先粗后细、避免越级」纪律。
3. 体检报告新增被动信号：无谓检索率（检索了但未引用）、空结果率、命中引用率。
4. records 调和显式化：新增/更新/supersede/矛盾 四态（supersede 已有，补 explicit reconcile 协议）。
