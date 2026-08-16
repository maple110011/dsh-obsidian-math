# 参考文献笔记

> 记忆系统相关的论文阅读笔记。每篇包含：URL、核心结论、可借鉴机制、与我们的映射、不适用的部分。读完新论文后按同样格式追加。

---

## 1. Four-module memory framework（arXiv:2606.24775）

- 来源：https://arxiv.org/abs/2606.24775
- 在读依据：五层分层中 profile/topics/episodes 的设计来源；README 与 AGENTS.md 引用的四模块框架。
- 核心结论（我们采用的）：保留原文/轻压缩优于抽象摘要（M1）；写时保留优于早过滤（M2）；时间戳多版本优于删除（M4）；prompt 只带导航层、原始证据留在磁盘由 grep/read 触达。
- 映射：episodes append-only、superseded 而非删除、注入预算的粗到细路由。
- 备注：原论文细节未逐条核对，后续读原文后补充。

## 2. NapMem：类型化原子记录层（arXiv:2607.05794）

- 来源：https://arxiv.org/abs/2607.05794
- 核心结论：原始对话之上需要一层可检索、可验证、可溯源的**类型化原子记录**（typed memory records）。
- 映射：records 层五类卡（fact/event/instruction/preference/artifact），id/source/变更历史。

## 3. Rethlas 推理原语与定理检索工作流（arXiv:2604.03789）

- 来源：https://arxiv.org/abs/2604.03789
- 核心结论：生成-验证循环；推理原语（玩具例子/反例/检索/分解计划/迭代分治/共同失败识别）；定理检索纪律（展开定义、核对适用性、读证明提取可迁移技巧）；Matlas 个人定理索引。
- 映射：AGENTS.md §4 证明工作流、theorems/index.md、artifact 记录。

## 4. Template-Theorems Graph Construction（AAAI-26 40411）

- 来源：https://ojs.aaai.org/index.php/AAAI/article/view/40411
- 核心结论：把做过的题抽象成问题模板，与相关定理建关联图，模拟“见过同类题 → 想起相关定理”的认知过程。
- 映射：templates/ 模板卡 + related_theorems；检索前“问题蒸馏优先”。

## 5. Retrieval-Augmented Language Models are Mimetic Theorem Provers（EMNLP 2025 Findings）

- 来源：https://aclanthology.org/2025.findings-emnlp.1162/
- 作者：Wenjie Yang, Ruiyuan Huang, Jiaxing Guo, Zicheng Lyu, Tongshan Xu, Shengzhong Zhang, Lun Du, Da Zheng, Zengfeng Huang（复旦/Ant Group/上海人工智能创新中心）。
- 核心发现：检索到**证明**（而不只是定理陈述）时，LLM 表现出“模仿式证明”——把检索上下文里的证明技巧迁移到新定理（Table 1：裸 DeepSeek-R1 证错，拿到“子序列 + Borel-Cantelli 技巧”上下文后证对）。
- 关键洞察：**依赖相同证明策略的定理在语义上可能相距很远**；检索“高斯”会召回一堆高斯性质，而真正关键的大数定律因语义距离远被漏掉。
- 方法（Dual RAG）：
  1. LLM 分块：定理+证明+例子+注记保持在同一块，不切断逻辑；
  2. 查询增强：LLM 分析目标定理的底层推理挑战（reasoning challenges）并生成初步证明草图（proof sketch），用增强后的查询检索（类 HyDE，但针对证明任务适配）；
  3. 上下文增强：对每块文档预生成“已知定理的可能应用场景 + 证明中使用的关键技术”，使查询的挑战描述与文档的技术标注在嵌入空间对齐；
  4. 稠密检索 + zero-shot 重排序。
- 结果：检索性能最高提升 34.19%；专家评估确认检索提升直接转化为证明质量提升；接 arXiv API 后能证明理论机器学习方向研究级定理。
- 映射：hook.techniques / hook.applications（上下文增强）、问题蒸馏作为查询（查询增强）、note_retrieve 的 top-k + 重排（读文件核实）、“不只读定理陈述还要读证明”的协议条款。
- 不适用的部分：其密集检索依赖 embedding 后端——我们先用 token 加权替代；其评测对象是纯证明任务，不覆盖笔记结构/偏好类场景。

## 6. ISM: Self-Improving Strategy Memory for Continual Mathematical Reasoning（arXiv:2606.31191）

- 来源：https://arxiv.org/abs/2606.31191（Prakhar Dixit, Tim Oates，UMBC；代码 https://github.com/pdx97/ISM）。
- 设定：冻结 LLM + 持续学习流 + **硬性 episodic reset**（episode 间不共享上下文，只共享外部记忆）——与“每次新会话失忆开局、积累全在 vault”的处境一致。
- 核心设计：
  1. **Schema = content + feature hook 双表示**：策略内容（描述/解法模板/启发式）与检索特征（算子类型、结构模式、启发式签名、数量签名、嵌入质心、成功率）分离；检索特征在线自适应、策略内容稳定。
  2. **两级检索**：算子硬过滤 → 加权软打分（结构 0.15 + 启发式 0.15 + 数量 0.05 + 嵌入 0.55 + 历史成功率 0.10）；分数分三档（直接用 / 带通用 fallback / 通用 schema 并可能触发演化）。
  3. **七种自维护机制独立调度**：Audit（10 集健康报告）→ Correct（弱 schema 改写，3 次失败升格剪枝）→ Merge（质心 cos>0.88 合并，seed 保护）→ Promote/Demote（成功率 ≥0.8 检索分 +2%、≤0.4 减 5%）→ Prune（零使用/持续失败移除）→ Reinforce（从验证过的成功蒸馏新启发式）→ Antipattern（从失败提炼“要避免的错误”）；另有条件演化门（同算子失败 ≥3 次才合成新 schema）。
  4. **对称学习**：成功与失败都作为结构化可检索知识（对照 Reflexion 只存失败反思、STaR/Voyager 只存成功）。
  5. **验证门控**：每次记忆更新（含合并/改写/强化）都过符号验证，防止错误泛化入记忆。
- 结果：300 集持续学习流上超越 vanilla/retrieval/reflection/static/passive 五基线；记忆规模比最强被动基线少 64%/86%、比 retrieval 类少最多 23 倍；领域漂移更鲁棒、记忆库严格有界。
- 映射：hook 块 = feature hook；note_retrieve 两级检索与打分权重照搬；体检报告 = Audit；merge/reinforce/demote 协议 = 其余机制的模型执行版；verified 三级 = 验证门控的本土化。
- 不适用的部分：其符号验证器依赖可验证答案，笔记自由文本无等价物（用三级验证等级 + provenance 替代）；其全自动 promote/merge 依赖 ground truth，我们必须把用户确认纳入闭环；其“压到几百 schema”是为了精简，我们有完整 vault 当证据层，精简只作用于注入摘要与索引。

---

## 待读清单（后续追加）

- arXiv:2606.24775 原文细读（当前只有二手摘要）；
- arXiv:2607.05794 原文细读；
- MemGPT / Letta 的 tiered context 与自编辑记忆（评估中作为对照）；
- HyDE / Rewrite-Retrieve-Read（Dual RAG 提到查询改写的前作，用于 embedding 后端的查询侧增强）。