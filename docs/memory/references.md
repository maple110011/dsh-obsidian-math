# 参考文献笔记

> 记忆系统相关的论文/系统阅读笔记。每篇包含：URL、核心结论、可借鉴机制、与我们的映射、不适用的部分。读完新论文/系统后按同样格式追加。

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
- 映射：hook.techniques / hook.applications（上下文增强）、问题蒸馏作为查询（查询增强）、note_recall 的统一检索 + 精读挑选（读文件核实）、“不只读定理陈述还要读证明”的协议条款。
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
- 映射：hook 块 = feature hook；note_recall 的 hook 字段加权与 BM25 打分（两级检索打分权重照搬，算子硬过滤已降级为可选参数）；体检报告 = Audit；merge/reinforce/demote 协议 = 其余机制的模型执行版；verified 三级 = 验证门控的本土化。
- 不适用的部分：其符号验证器依赖可验证答案，笔记自由文本无等价物（用三级验证等级 + provenance 替代）；其全自动 promote/merge 依赖 ground truth，我们必须把用户确认纳入闭环；其“压到几百 schema”是为了精简，我们有完整 vault 当证据层，精简只作用于注入摘要与索引。

---

## 7. AgentIR: Reasoning-Aware Retrieval for Deep Research Agents（arXiv:2603.04384）

- 来源：https://arxiv.org/abs/2603.04384（Chen, Ma, Zhuang, Lin, Asai, Zhong；UQ/Waterloo/CMU）
- 核心结论：Deep Research agent 每次搜索前会生成**显式自然语言推理**，现有检索器只拿 query、完全忽略这段推理。把「当前轮推理 + query」联合嵌入（即使冻结 backbone 不微调）即可把检索准确率从 48.7% 提到 55.5%；配合合成数据微调（AgentIR-4B）在 BrowseComp-Plus 上 68% vs 同尺寸基线 52%、BM25 37%。
- 关键分析（5.2/5.3，可直接迁移的负面结论）：
  - **历史不是资产**：把 prior queries / prior reasonings 拼进查询会引入大量冗余与错误假设（Forgetting as a Feature）——当前推理对已确认结论的**摘要**是最干净的检索信号，旧假设（如错猜的人名）是噪声。
  - **原子线索（Atomic Clues）**：把推理分解成短的、互相独立的陈述再用于检索，比整段推理更干净——即“结构化挑战描述”。
  - 查询扩展类（HyDE）是次优信号。
- 映射：note_recall 的查询 = 当前轮「挑战描述 + 候选技巧」（原子线索式），**绝不拼接历史对话**——与“遗忘是特性”一致（导航式注入只带静态导航层，不再注入最新用户消息）。
- 不适用：其训练与 4B embedding 部署成本不符合本项目约束；只取其查询侧洞察。

## 8. RaDeR: Reasoning-aware Dense Retrieval Models（arXiv:2505.18405）

- 来源：https://arxiv.org/abs/2505.18405（Das, O'Nuallain, Rahimi）
- 核心结论：用 LLM 的数学解题「检索增强推理轨迹」+ 自反思相关性评估合成训练数据（含 hard negatives），训练出的 dense retriever 在查询是 **CoT 推理步骤**时首次超过 BM25，且在 Math/Coding 切片上大幅领先；只用同类工作 2.5% 的训练数据。
- 关键洞察：term-matching 检索器在“推理相关”场景失效（如 pigeonhole 问题与答案间零词面重叠）；**查询应该是推理步骤而不是关键词**。
- 映射：问题蒸馏后「挑战描述 + 候选技巧」作为查询（已有雏形，v3 升级为结构化协议）；hard negatives 的教训——相关性不是词面重叠，hook 的 techniques/applications 字段正是“推理对齐”的轻量替代。
- 不适用：模型训练路线整体跳过。

## 9. LeanSearch v2: Global Premise Retrieval for Lean 4 Theorem Proving（arXiv:2605.13137）

- 来源：https://arxiv.org/abs/2605.13137（北大/IQuest 等；代码 https://github.com/frenzymath/LeanSearch-v2）
- 任务：全局前提检索——一次找回证明整个定理所需的**一组**引理，而非单条声明。
- 标准模式：① hierarchy-informalized 语料（每个声明配自然语言描述，且**依赖感知自底向上 informalize**）；② 结构化 passage 模板（kind + 类型签名 + 非正式描述 + value 字段，**按声明类型区别处理**——definition 类单独调优）；③ embedder 取 top-50 → reranker 二分类相关性重排。无领域微调，nDCG@10 0.62 vs 次优 0.53。
- 推理模式（sketch-retrieve-reflect 循环）：sketch 生成器把定理分解成多个子查询（每步=数学动作+上下文+检索 query）→ 每步子查询检索 → **filter LLM 逐个标记相关/不相关，且允许返回空集**（∅ 是信号：区分“检索到支持”与“没检索到有用的”，top-k 规则会把两者混为一谈）→ 可行性 judge 接受或给结构化反馈 → sketch 修订器迭代。69 题基准上 10 个候选内找回 46.1% 前提组。
- 映射：
  - 结构化 passage = 我们的 hook 块 + cardRetrievalText（v3 按 card.type 分组组装）；
  - 空结果是信号 → 协议条款“检索不到就明说/改查询/换路线”，不硬凑；
  - 分步 sketch → 我们的零 token 版本：模型在自身生成里先给证明草图，对每个外部结果步骤分别 note_recall（已有「子目标分解计划」原语的强化）；
  - 检索质量传播到证明成功率（20% vs 16% vs 4%）→ 支持优先投检索而非其它。
- 不适用：其每轮 sketch/filter/judge 的多 LLM 调用与 8B embedder/reranker 均超本项目 token/部署预算。
---

## 10. OpenViking（Volcengine 开源系统，非论文）

- 来源：https://github.com/volcengine/OpenViking ；文档 https://docs.openviking.ai/zh/getting-started/01-introduction
- 定位：Self-evolving Context Database for AI Agents——统一 **Agent Memory / Knowledge RAG / Skills** 三种上下文到一个库、一套检索。
- 核心机制（我们关心/可借鉴的）：
  1. **记忆强度 + 遗忘曲线**：每段记忆带强度值，被引用/确认 → 强化；长期不用 → 衰减；低于阈值 → 真正遗忘/归档（不是只提示）。
  2. **巩固（consolidation）**：相关/重复记忆自动合并、抽象成更高层知识。
  3. **冲突更新**：新事实与旧记忆矛盾时主动纠正/更新旧记忆。
  4. **Memory / Knowledge / Skills 共享同一套强度与检索生命周期**。
- 与我们的映射：我们有强度信号（`hook.uses/success_rate/last_used` + 每日体检的「低效用归档候选」「疑似重复」），但都停在「检测/建议」，执行靠 prompt——OpenViking 的启示是把「遗忘/合并/纠正」从建议升级为确定性动作。
- 吸收落点：见 `docs/memory/self-correction.md`（P1a/P1b/P1c 纠错进检索；P3 自动归档；P4 duplicate_of 合并；P5 strategy 统一生命周期；P2 待重审清单）。
- 不适用的部分：OpenViking 的强度是黑盒服务内部状态、带外部服务/数据库；我们坚持「记忆 = vault 里的 markdown + 可见 frontmatter 字段」，只把强度做成字段 + 检索权重，不引入外部服务、不引入数据库。

---

## 11. Obelisk（开源系统，非论文）

- 来源：https://github.com/tommy0103/obelisk ；作者博客 https://obeli.sk/blog/taming-ai-assisted-code/ ；第三方：https://www.it-boltwise.de/sqlite-statt-cloud-queues-obelisk-setzt-auf-langlebige-ki-workflows-mit-loglitestream.html
- 定位：Every past session, subagent, and workflow — queryable by your agent。通用 agent 的**持久化活动记忆 + 确定性工作流**。
- 核心机制（能确认）：
  1. **记忆单位 = session / subagent / workflow**（「agent 做过什么」的活动轨迹），不是「用户的知识」。
  2. **存储 = SQLite + Litestream（S3 备份）**：事务、崩溃安全、可 SQL 查询、跨重启不丢。
  3. **自动、全量、append-only 捕获**，不依赖模型自觉写。
  4. 通过 MCP 暴露给任意 agent（跨 Claude Code 等）。
- （推断、未核实：是否有 embedding 语义召回、是否做记忆蒸馏/遗忘/验证门控。）
- 与我们的映射：我们靠三写协议（模型按需自觉写 episodes）会漏记；而 `$DSH_HOME/sessions/*.jsonl.zstd` 其实已有全量会话日志（dialogue index 在扫它）——离「全量保存」只差把日志确定性写进 episodes。
- 吸收落点：见 `docs/memory/obelisk-comparison.md`——「自动保存对话」（0.7.3 已实现引擎：整场对话、尾截断、seq 增量、vault 过滤、`sessionCapture` 开关）。
- 不适用的部分：SQLite 替换 markdown（vault 文件是特性不是缺陷）；多 agent/子代理记忆；「活动轨迹全量可回放」本身（我们要的是语义蒸馏，不是操作日志）。

## 待读清单（后续追加）

- arXiv:2606.24775 原文细读（当前只有二手摘要）；
- arXiv:2607.05794 原文细读；
- MemGPT / Letta 的 tiered context 与自编辑记忆（评估中作为对照）；
- HyDE / Rewrite-Retrieve-Read（Dual RAG 提到查询改写的前作，用于 embedding 后端的查询侧增强）。