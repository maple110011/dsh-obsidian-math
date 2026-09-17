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

## 12. GraphMemix: Query-Aware Evidence Forests for Long-Term Multimodal Agent Memory（arXiv:2608.26983）

- 来源：https://arxiv.org/abs/2608.26983（Geng Li, Yuhao Wang, Dong Li, Jianye Hao, Yuxin Peng；北京大学王选计算机研究所 / MemoraX AI）。卡片 `literature/cards/liGraphMemixQueryAwareEvidence2026.md`，研读记录 `literature/reading/liGraphMemixQueryAwareEvidence2026.md`。
- 定位：把「长期记忆给模型看什么」从**写时压缩**搬到**查询时选择**，并把选择写成带预算与结构的组合优化（查询条件下的**证据森林**）。
- 核心机制（对我们有价值的部分）：
  1. **多视图 max-pool**：同一记忆的多个视图（图/caption/OCR/帧）**各自打分取 max**，而不是拼成一个文本 bag 打一次分（式 3）——只为「捞进候选集」，不用于最终排序。
  2. **两种验证职责分离**（式 6–8）：**节点验证器**判「这条自身是否支持该问题」（listwise，把候选放在同一语义尺度上比）；**证据链验证器 ECV** 判「相对某个锚点，这条是**增量**还是冗余」，给六种角色 `new_fact / clarification / corroboration / redundant / conflict / irrelevant`，只有正分且属前三种的最优锚点边被保留。实测：合成一次调用 → 分离两调用，macro **Acc +2.00 / R@10 +3.00**（Table 7），两者并行、无串行代价。
  3. **开链成本 ⇒ 自适应 k**（式 10–12）：$C_{\text{open}}=\kappa\,m(S,F)$（$m$=独立证据链条数），森林下 $m=|S|-|F|$，目标化为 $\sum_{i\in S}(p_i-\kappa)+\sum_{e\in F}(\kappa-\lambda c_e)$——**孤立记忆要自证 $p_i>\kappa$ 才值得单开一条链**，能挂到已选分量上的只按边际收益收。
  4. **关系可信度是查询条件化的**：给所有边一个 query 无关的固定可靠性（0.99）反而更差；ECV 把每题边数从 6–7 压到 0.25–1.47，Hit@10 反升 1.83~5.60（Table 6）。
  5. **★ 通用多样性/去冗余没有价值（控制实验，Table 9/10）**：冻结候选与节点效用、固定 $K=10$ 时，MMR 56.84 / Rel.–Red. 56.82 / Facility 56.80 / DPP 52.69 **都不优于**朴素 Top-K 56.87，按净回收是负的（−6 / −4 / −2 / −36）；而用**已验证关系**的 Anchor–Neighbor +14、ECV Pointwise +12、Greedy Forest +18、**Forest Proposal +43**。**「让列表更不相似」本身没有价值，甚至有害**——价值在把已验证的关系路径变成低排名证据的回收。
  6. **可达性分层**：gold 证据分 Direct（top-10 内）/ Recoverable（top-10 外但候选图内）/ No access。四基准里 Recoverable 占 **15.14% / 37.87% / 39.70% / 33.93%**（Table 4）；问题级回收 40.08–68.48%，占全部保留 gold 对的 12.01–19.58%（Table 5）。
  7. 关键超参（§4.1/§A.2）：$L{=}24$、$H{=}1$、$k{=}8$、$M{=}48$、$K{=}10$；$(\alpha,\tau,\delta)=(0.8,5.2,0.7)$ ≡ $p_i=\sigma(4.2s_i+0.2v_i-3.6)$（**检索先验 4.2 vs 验证器 0.2**，验证器只是修正项）；$\lambda=0.1$、$\kappa_{\text{prop}}=0.2$、$\kappa=0.12$；序列化 = 分量按根效用排序、分量内宽优先（§A.5）。
  8. 结果：Qwen3-VL-8B 下四基准 macro Judge Acc 61.55（第二好 49.80，+11.75）；Gemma 4 12B 下 67.42；ATM 全生命周期比 A-MEM/VimRAG/LightMem 缩短 1.78×/4.27×/4.74×。增量消融：多视图 +4.40 / 节点验证器 +5.20 / ECV 重排 +0.90 / 森林优化 +1.85。
- 映射：① **多视图 max-pool 可直接替换** `composePassage` 的「拼接成一个 bag」——现在 `title + hook + topic + body(≤800)` 拼接会让长正文稀释 hook 的强匹配；② 六角色是 `note_recall` 加「结构化适用性字段」的具体设计（1.0 缺口**技巧调用体系**最缺的一环，但落地方式是**角色门控**而非列表惩罚项——见 ★）；③ 「开链成本」解释了为何固定 `maxResults` 是错的方向；④ 可达性分层 + **带符号净回收**可以直接进 `engine-probe.mjs`，量化我们「顺链扩读」到底值多少（AGENTS.md §5 要求顺链扩读，但从未测过）。
- **落地状态（2026-09-10，决策与数字见 `retrieval-v3.md` §7）**：④ 已落地为引擎探针 §2（可达性分层 + 有符号净恢复 Δ + 目标排名，探针每轮输出）；① 已实现为 `{ viewPool: "max" }` 可选路径并**实测后不采纳**（真实 vault：Direct 11→11、目标排名均值 1.73→2.27、0 改善 / 2 变差 ⇒ 保持单袋默认）；② 的六角色与 ③ 的自适应 k 记录在 §7.4（各带触发条件）；★ 已写进 `AGENTS.md` §5 与 handoff 坑 46（禁止通用去冗余重排）。
- 不适用的部分：LVLM 验证器与图优化求解器（Kruskal / 1-swap）——前者违背「插件不调模型」，后者对我们的个位数候选是过度工程；全部多模态分支；**它的写路径是空的**（不做写时压缩、无 audit/merge/prune/reinforce，记忆只增）——我们体检比它强，吸收时只取读路径结构。
- ⚠️ **源质量（教训已写进 `docs/literature.md` §8）**：这份 MinerU `full.md`/`content_list.json` 对该 PDF 有**系统性 `<sub>` 破坏**（5613 个标签、3954 处词中被切开），两套独立运行一致 ⇒ MinerU 的行内公式检测器误判。**已用 `pdftotext -layout` 从 `source.pdf` 复读并更正**（补齐超参数/控制实验，并纠正首版「靠去冗余取胜」的误读）。

## 13. MSCE: From Memory to Skills（arXiv:2607.16621）

- 来源：https://arxiv.org/abs/2607.16621（Bo Tang, Yang Zhang 等；MemTensor / 中科大 / 港理工 / 福州大学 / 西安交大）。卡片 `literature/cards/tangMemorySkillsEvidenceGrounded2026.md`，研读记录 `literature/reading/tangMemorySkillsEvidenceGrounded2026.md`。
- 定位：把记忆从**被动上下文**升格为**可调用技能**——三层受治理记忆（L1 步骤证据 / L2 程序策略 / L3 声明式环境认知）+ 下游可调用技能库。
- 核心机制（对我们有价值的部分）：
  1. **★ 增益 G 是全会话治理信号**（Eq. 1 + §B.4）：`G = V̄_with − V̄_blend(S_without)`，with 侧在 `|S_with| ≥ 3` 时用 softmax 加权均值（`τ_V = 0.5`），**without 侧向保守基线收缩**（伪计数 `N_0 = 5`、基线 `b = 0.5`）⇒ 没有失败样本时**不产生虚假增益**。决定策略"留活跃 / 够格结晶 / 该退休"。作者明说这是**启发式效用信号、不是因果效应估计**。
  2. **★ 技能结晶的门与验**：两道门（`G > θ_G = 0`；**稳定性**＝近期证据吻合当前 φ/π/B 而非迫使大改写）+ 三道**确定性**插入校验（schema 齐全 / **证据接地**：引用证据 id ∈ 支持集且声明工具 ∈ 证据轨迹工具白名单 / 覆盖测试：不发明无支撑命令、不偏离保留证据）。**任一不过 ⇒ 丢弃草案**。支持集同时用正证据（归纳过程）与**反证据（约束边界、产出反模式）**。
  3. **★ 生命周期与边界收窄**（Table 4）：`probationary → active → archived`；`η = (n_pass+1)/(n_trial+2)`（平滑成功率）；`η > 0.6` 进活跃检索、`< 0.2` 归档；事件映射：成功 `reinforce` / 失败 `repair` / **用户否决 `shrink`（收窄边界 B）** / 新反证据 `revise` / **源策略重写 `rebuild`（从证据重新结晶，不就地打补丁）** / 长期不用 `archive`。
  4. **★ 决策指导 D**：`d = (c, a⁺, a⁻, e, ξ)`（上下文 / 该做 / 该避免 / 证据 / 可靠性）；**只在上下文匹配当前技能或策略触发时注入**；修复包**暂存到下一轮**、不打断当前动作。
  5. **★ 三层级联检索 + 降级**：活跃技能优先（按 `触发相关度 + η + G` 排序，`k = 3`）→ 命中的 **L3 只提供环境先验、不覆盖技能过程** → **无技能命中或技能失败 ⇒ 回退 L1**（精确线索 + 状态摘要相似度；**低价值轨迹仍保留**作反证据）→ 结构性不确定时取 L3。**技能调用以记忆层级为条件。**
  6. **价值回填**（Eq. 2）：`V_t = α_t·R + (1−α_t)·γ·V_{t+1}`（`γ = 0.9`），把稀疏终点反馈沿稠密自反思摊到每一步 ⇒ **偏向"既被全局奖励、又本地可解释"的步**。α 由 LLM 打分——**这部分我们不采纳**（违红线），只取其**形状**并用确定性代理量替代。
  7. **L2/L3 禁写隔离**：两侧互相禁写，prompt 各带"不要写这些"清单，要求"**同一个事实两种表述**"（L2 写成动作条件，L3 写成声明事实）。原话：**两侧互相污染会同时稀释两边**。
  8. 关键数字：`n_min = 2`（不同 episode）、`v_min = 0.1`、`θ_G = 0`、L3 队列 `m = 2` / `θ_sim = 0.62`、`θ_edge = 0.34`、每技能证据 `K = 6`、`k = 3`、`n_prob = 1`、`θ_η^active = 0.6`、`θ_η^archive = 0.2`、反馈步长 `δ = 0.1`；奖励权重 `0.45g + 0.30p + 0.25u`；`γ = 0.9`。
  9. 结果：EvoAgentBench 五域全为最佳或并列最佳（IR 21.54→**26.15**、Math 43.00→**47.00**、SE 38.46→**53.85**、Code 61.54 并列且成本 3.9→2.0 turns、KW 48.28→**53.45**）；LoCoMo 综合 61.23 / F1 49.89；跨域迁移 6/6 全升（平均 **+3.93**）；长期演进 p0→p100 在 Math/SE/IR 单调升 +17.00/+15.39/+13.84，**p100 时 Math 与 SE 成本低于 p0**。模拟人类反馈：KW +13.79、SE +7.69、Code +2.56、IR +1.54、**Math +0.00**（作者解读：数学瓶颈在**符号正确性**而非程序性改进）。
- 映射：① **`hook` 唯一缺的治理量是"增益"**——我们有 `uses/success_rate/last_used/harmed`，没有"用了它比不用它好多少"；采纳其**形状**（含 without 侧收缩）并换成确定性代理量（见 `literature/notes/improvement-intake-2026-09-17.md` P0-1）；② **`not_applicable_when` 硬门控是防害机制**——w/o Value Calibration **每域掉分且成本升**，为我们的门控提供外部实证（P0-4/§4.5）；③ **边界应被反馈收窄**（`shrink`）——❌ 现在只改 `success_rate`+降 `verified`（P1-3）；④ **策略卡缺证据锚点与接地校验**（P1-2）；⑤ **"跨 episode 独立支撑"= 区分一次巧合与真技巧**（P1-1）；⑥ **Cost 必须与效果合看**、**"在线累积→后评估"协议**（P1-4）。
- 不适用的部分：五个 LLM 算子（反思打分/奖励量化/L2 归纳/L3 抽象/技能起草）——违背"插件不调模型"；嵌入/图检索；多模态与视频分支；`OpenClaw` 运行时与工具白名单假设。**取确定性判定骨架，弃模型依赖。**
- 反向印证：它只要求"高层记忆带证据 id 链接"，我们要求 `records.source` **必指 episode** + `verified_by` 凭据门 + 越权升级检测 ⇒ **我们的溯源纪律更严**。
- 源头质量：MinerU `full.md` **干净**（`<sub>` 仅 2 处下标数字），无需 `pdftotext` 回退。

## 14. MemForest: EventTree 分区与渐进合并（arXiv:2609.08273）

- 来源：https://arxiv.org/abs/2609.08273（Junxi Wang 等；上海交大 / 复旦 / 上海 AI Lab / 南大 / 哈工大 / 四川大学 / 阿里 / 清华）。卡片 `literature/cards/wangMemForestEfficientAgent2026.md`，研读记录 `literature/reading/wangMemForestEfficientAgent2026.md`。
- 定位：**与记忆框架解耦的写时压缩算子**——事件单元分区（语义 + 时间连续）+ 单元内最大生成树 + 逐步合并最相似的节点 + 锚点引导传播检索。
- 核心机制（对我们有价值的部分）：
  1. **★ 合并优于剪枝，且"选哪一对"本身有价值**：低压缩率（30%）两类差不多，**压过 50% 后剪枝类明显掉、合并类撑得住**（连专用剪枝 StreamMeCo 都不如随机压缩）⇒ 剪枝丢信息、合并保信息。**消融（Table 4）：Minimum（挑最不相似的一对合并）89.0% 比 Random 91.7% 还差**，Ours 96.0% ⇒ **选错对象比不做更糟**。
  2. **★ "优先合并最相似的一对"有理论下界**（Eq. 15）：`s_l ≥ sᵢ − (1−λ)√(2 − 2ρᵢⱼ)`，`ρ` 越大下界越高 ⇒ 合并高相似节点更保真。
  3. **★ 高度数节点是枢纽，不应先合并**（Eq. 6）：`w'ᵢⱼ = η·wᵢⱼ − (1−η)(deg(mᵢ)+deg(mⱼ))`，`η = 0.99` ⇒ 对应我们 `note_links` 的**反链数**（零成本的结构枢纽度）。
  4. **事件的双轴定义**：`u = β·g + (1−β)·l`（全局语义相似 + 局部时间连续），`β = 0.8`、窗 `w = 5` ⇒ "同一件事" = **语义相近且时间相邻**，明显偏语义。
  5. **AGPR**：`pⱼ = (1/(λk))·Σᵢ exp(−|t'ⱼ − t'_{aᵢ}|)`，融合 `vⱼ = γ·sⱼ + (1−γ)·pⱼ`（`γ = 0.9`、`L = 4`、`λ = 0.2`）；**收益只在压缩后才显著**（50% 压缩时 M3-Agent **+21.0%**、未压缩 +17.6%）⇒ 它是**补偿压缩损失**，不是通用检索改进。**几乎零额外耗时。**
  6. 关键数字：Mem0 三基准 50% 压缩保留 **97.1%**、提速 **1.89×**；M3-Agent 保留 **99.7%**、提速 **2.24×**；合并成本约 **$0.1 / 6000 节点**；消融去 `g` → 91.5%、去 `l` → 93.6%；跨模型合并 GPT-4o-mini 97.0% / GPT-5.2 96.5%（饱和）/ Qwen2.5-7B 87.9%。**限制：低冗余文本压 70% 只剩 93.3%。**
- 映射：① **不做自动合并**（不可逆 + 需 LLM + 违反红线；我们保留 `superseded` 调解）——但采纳它的**排序判据**：疑似重复按相似度降序输出 + 枢纽卡排除出建议合并（P0-3）；② **`Avg-R`（平均检索轮数）** 与 **跨高/低冗余两场景测** 可进引擎探针（P1-4）；③ **压缩率是显式旋钮**（30/50/70%）对照我们硬编码的注入预算 ⇒ 可做三档（P2）；④ **"同一件事"的双轴分组**与 MSCE 的 `n_min` 合并成"跨 episode 独立支撑"（P1-1）。
- 不适用的部分：LLM 合并与其不可逆性；AGPR 的时间邻域检索（**数学笔记场景里时间相邻 ≠ 内容相关**，见 notes §4.1）；多模态/视频分支。
- **反向印证**：它**无审计、无体检、无反模式、无适用边界**，且 §G 未来工作想做的"识别冲突或损坏条目"**正是我们的体检** ⇒ 这是我们的相对优势，**不要因为读了一篇"压缩"论文就弱化体检**。
- 源头质量：MinerU `full.md` 可用（5 处 `<sub>` 均为 `m₁..m₃`，非词中切分），已 `pdftotext -layout` 交叉核对。⚠️ 原文 §5.3.2 提速数字与 Table 13 有轻微不一致（照录并标注）。

## 15. VeryMath 组织 / Co-Mathematician / Danus / OptSkills

- 来源：https://github.com/VeryMath （华东师范大学数学科学学院 / 数学与工程应用教育部重点实验室；ECNU 官方新闻 2026-07-06 称研发者**王祥丰**教授）；官网 https://verymath.github.io/ ；手册 https://verymath.github.io/handbook/HANDBOOK.zh-CN.html 。研读记录 `literature/reading/verymathOrg2026.md`，卡片 `verymathCoMathematician2026` / `danusFactGraphMemory2026` / `yangOptSkillsLearningGeneralizable2026`。
- 定位：**不是我们的上游，也不是同层竞争者**——是"同一哲学在另一个场景的成熟实现"（12 公开仓库、约 29 个 `SKILL.md` 技能包）。**它全无 BM25、全无分层 episode/inbox 记忆、全无 hook 字段加权**——这三块是我们的相对优势。
- 核心机制（对我们有价值的部分）：
  1. **★ 机器层/人类层分离 + Ground Truth 在磁盘文件**：文献库 `local_reference_db.json`（"Ground Truth 始终是磁盘上的 JSON 文件"）配笔记 YAML frontmatter（`type`/`global_uri`/`source_json`/`core_theorems`/`status`/`tags`）；术语库 `glossary.json` 为唯一事实源、Excel 仅供导出。
  2. **★ 脚本中介写入（三处独立出现）**：文献库原文——"每次对 `local_reference_db.json` 的更新必须通过 Python 脚本原子执行，**禁止 LLM 读取全量 JSON 后手工编辑并覆写**"（附 `upsert_paper.py` 模板：stdin、UPSERT、原子写）；术语库"JSON 使用原子替换"、覆盖前先备份、写操作记 `修改记录.md` / 扩充记 `扩充记录.md`；co-mathematician"Python harness **不跑 agent**，只初始化文件、追加消息、创建工作流、检查门控、渲染论文"。
  3. **★ 增量（delta-only）回执**：固定符号 `+` 新增 / `~` 更新 / `!` 冲突 / `⚠` 超期，**无变更不输出**。
  4. **★ 门控是状态机、可程序检查**（co-mathematician）：**"草稿目标不可执行。目标只有在 `status: approved` 时才能接收工作流。"** `co-math check-gate --gate goal_approval`。工作流四类 `proof/computation/literature/review`；**每份报告必须带溯源、显式不确定性、失败探索记录与独立评审**；终稿只从通过评审的报告渲染。
  5. **★ 权限由构造强制而非提示词**（Danus）：主 agent **没有 `fact_submit`**、验证器**只读**；"权限由 MCP 角色表强制，不是靠提示词"。**"三层记忆，一条正确性边界：只有经验证器门控的事实图是真相，全局记忆只是认知"**；事实**内容寻址 + 可级联撤销**；最终论文在交付前再经一次论文数学验证器通读。真实运行规模：**3,157 条已验证事实 / 8,616 条依赖边 / 依赖链最深 54 条**。
  6. **稳定类型化 URI**：`paper:arxiv:YYYYMM.NNNNN#Thm-1`，**明令禁止** `[[本文 Lemma 3.1 笔记]]` 这类自然语言链接；取不到的元数据**强制填 `[UNKNOWN]`**（"严禁大模型根据预训练记忆推测或编造"）。
  7. **陈旧提醒**：`待读 → 略读中 → 精读中 → 已归档` + `last_interacted`；**7 天未读提醒、30 天未互动冷落提醒 + 四个处置选项**。
  8. **第三方来源登记范式**（OptSkills）：`SOURCES.md` 记**上游仓库 + 快照 commit + 明确排除项**（"只搬产物，不搬训练管线"）。
  9. **技能移交**（co-mathematician）：`skill-handoff` 落 `skill_handoffs.jsonl`——任务判定属某领域 Skill 辖区 ⇒ 记录移交、之后按其流程走。
- 映射：① 写入原子性 + "模型只提案"应写成**显式契约**并把"模型整体重写统计字段"纳入体检检测（P0-5）；② 增量回执 `+ ~ ! ⚠`（P0-5）；③ **"状态 = 权限"**：`candidate` 策略卡不得作为结论依据注入（P0-4）；④ **"失败尝试 + 不确定性是产出必填项"** 与 MSCE 的反证据、GraphMemix 的低价值轨迹保留**三方同向**（§4.3）；⑤ 陈旧提醒可补到我们的**文献库**侧（P1-5）；⑥ 来源登记范式可补进本文档的写法（P1-5）；⑦ **技能移交记录**可用于 `note_strategy`（回答"这次为什么走了策略路线"）。
- 不适用的部分：JSON/SQLite 作为事实源（markdown 文件是我们的特性）；把技能交回 agent 全局 skills 目录自动发现（会扩大工具面、破坏 `approval: never` + 最小工具面）；多 agent 蜂群编排与并行证明搜索（我们场景是单用户数学学习）；Danus 的运行姿态 `--dangerously-bypass-approvals-and-sandbox`（自述需隔离可弃主机）——与我们 fail-closed **故意相反**；co-mathematician 的完整重流程（只抄轻量形状）。
- **独立收敛的价值**：VeryMath 三处持久状态设计都落在我们已有原则上（机器契约+人类正文 / Ground Truth 在文件 / 确定性维护与模型动作分离）。三个互不相关的作者群各自得出这些结论 ⇒ **这不是我们的任意选择，而是这类系统的稳定解**，可作为设计正当性的外部论据。
- 未核实：OptSkills 原文摘要（fetch 失败，其卡片已标注"摘要为改写"）；`sage_ref_search.py` 与 `harness/co_math/skills.py` 内部算法；是否有私有仓库；组织 owner 身份。

## 待读清单（后续追加）

- arXiv:2606.24775 原文细读（当前只有二手摘要）；
- arXiv:2607.05794 原文细读；
- MemGPT / Letta 的 tiered context 与自编辑记忆（评估中作为对照）；
- HyDE / Rewrite-Retrieve-Read（Dual RAG 提到查询改写的前作，用于 embedding 后端的查询侧增强）。