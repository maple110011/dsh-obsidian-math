# 研读记录：Learning Hierarchical Procedural Memory for LLM Agents through Bayesian Selection and Contrastive Refinement (MACLA)

## 0. 元信息

- citekey：forouzandehLearningHierarchicalProcedural2025
- 标题：Learning Hierarchical Procedural Memory for LLM Agents through Bayesian Selection and Contrastive Refinement
- 年份：2025（AAMAS 2026 录用）
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（.raw/forouzandehLearningHierarchicalProcedural2025/full.md）

## 1. 一句话定位

MACLA 把「学习」从 LLM 参数中解耦：冻结 LLM 只做语义抽象与动作生成，所有适应都发生在外部、可读的分层程序记忆里——贝叶斯后验选程序、对比精化修程序、元程序组合长程策略，不微调权重即获得样本高效、可解释、持续改进的智能体。

## 2. 问题与动机

- 早期 prompt/self-critique 智能体没有持久「怎么做」程序，相似但不同的任务每次重新规划，成本高、延迟大。
- 微调（SFT/RLHF/PPO）把整条轨迹按终局成功/失败加权，忽略中间正确子步骤（成功拿到鸡蛋但没煮熟，前段仍是对的）；需离线密集标注+重复训练（44.8 GPU-h 级），且推理期静态。
- 目标：把推理与学习解耦，让改进落在外部显式记忆上（memory edit 而非 gradient update）。

## 3. 记忆结构

两层（原子程序 + 元程序），全部人类可读：

- 原子程序 Proc = {G: 自然语言目标, Ψ: 前置条件模式, π: 抽象动作序列, Φ: 后置条件模式}；由冻结 LLM 对轨迹语义分段后抽取，嵌入 e_k = φ([G;Ψ;Φ])。
- 元程序 MP = {G_meta, Ψ_meta, {Proc_i1..im}, Θ}；Θ 是轻量控制策略 Θ(o_t, index) ∈ {continue, skip, repeat, abort}，从多次成功轨迹的分叉点蒸馏。
- 本体语义索引：取 k_vocab 高频词用 Sentence-Transformer 嵌入聚类成隐式领域本体（C_container={mug,cup,glass}），检索时把观测映射到语义类别，跨词面泛化。
- 索引：ANN（FAISS，O(log N)）；每程序失败索引≤15 条；episode buffer≤1000 步。

## 4. 写路径（固化）

- 写触发：离线构建期从成功与失败轨迹都抽程序（失败轨迹前段仍可贡献正确子步骤）。
- 分段+抽象：冻结 LLM 把轨迹切成语义连贯子任务，抽 goal/precondition/action/postcondition 四元组。
- 去重：相似度 θ_dup=0.85 以上不新增；容量上限默认程序 200 / 元程序 50（ALFWorld 收敛到 187/43）。
- 合并/演进：对比精化把 ΔΨ/Δπ/ΔΦ 合并回原程序；发现多种执行模式时特化成变体并继承先验计数。
- 写纪律：LLM 调用按 episode 固定预算（分段、抽象、偶发精化），检索/贝叶斯打分/更新走符号或向量化，推理成本不随经验增长。

## 5. 读路径（检索）

- 候选：对当前观测嵌入做 top-k ANN，候选=程序+元程序。
- 打分：期望效用 EU = Rel_i·(α_i/(α_i+β_i))·R_max − Risk_i·(β_i/(α_i+β_i))·C_fail + λ_info·H[Beta(α_i,β_i)]。Rel_i=cos(φ(o_t),e_i)；Risk_i=相似上下文失败占比；H=熵鼓励探索。
- 选择：argmax EU；若 max EU < θ_conf（约 0.4）回退零样本 LLM 一步并记录。
- 执行前校验：原子程序先 CHECKPRE(Ψ,o_t)，执行后 CHECKPOST(Φ,o_{t+1})，任一不满足即回退。
- 空结果语义：明确「低于置信阈值→回退+记录」，而非硬凑答案。

## 6. 组织与关系

- 层次：原子程序（技能）→ 元程序（playbook，条件控制流）。
- 组合：稳定重复程序序列（≥3 程序、共同高阶目标、稳定顺序）抽象为元程序。
- 跨词面泛化：本体聚类把 mug/cup/glass 归同类，程序学了 mug 也能用于 cup。
- 质量指标：reuse rate（ALFWorld 78% / SQL 51%）、posterior 成功率、meta hit（38–51%，SQL 仅 18%）直接反映「有什么」与「取什么」。

## 7. 维护与自改进

- 对比精化：某程序同时积累 ≥3 成功与 ≥3 失败上下文（|S|,|F|≥3）时触发；LLM 对比 S vs F 提取三维判别子：ΔΨ+（成功独有前置）/ΔΨ−（失败独有前置取反）、Δπ（漏/错序动作）、ΔΦ（不完整目标态）。
- 后验更新：每次执行按 y∈{0,1} 更新 Beta：α←α+y, β←β+(1−y)；先验 0.5 起，收敛 0.79，方差 O(1/(α+β))。
- 剪枝：多因素效用 U = 0.5·(α/(α+β)) + 0.3·(n_i/N_total) + 0.2·exp(−Δt/τ)；权重 0.5/0.3/0.2 网格搜索定；保留 >0.7、剪除 <0.4，剪枝用分层抽样保证目标簇多样性。
- 自强化闭环：差程序累积失败（β 高）→ 低效用 → 高证据前被剪掉。

## 8. 验证与质量门控

- 执行期双重校验：前置/后置条件不满足都不算成功，直接回退零样本。
- 贝叶斯后验即质量门：可靠性连续量化，而非二元对错。
- 自动质控证据：73% 被剪程序成功率<0.5，81% 保留程序>0.7；高成功率且高使用象限为空（无良程序被误剪）。
- 谁有权改：仅对比精化模块在充分证据下改程序；零样本回退只记录不改记忆。

## 9. 成本 / 安全 / 隐私

- 构建成本：0.016 GPU-h（56s，单 RTX 3090），比 IPR 44.8 GPU-h 快 2800×。
- 运行成本：ALFWorld 平均 6.2 次 LLM 调用/episode；成熟期 fallback<5%；检索/打分/更新非 LLM 化。
- 规模有界：容量 200/50、失败索引 15、buffer 1000、足迹 3.6 MB；2851 轨迹压缩成 187 程序（15:1）。
- 可解释：程序为人类可读结构，改动可审计。

## 10. 关键数字 / 阈值

- Beta 先验 0.5 → 收敛后验 0.79；可靠阈值 0.75；剪枝保留线 0.7 / 剪除线 0.4。
- 效用权重：可靠性 0.5、频率 0.3、新近度 0.2。
- θ_conf≈0.4（低于即零样本回退）；θ_dup=0.85（去重）；θ_sim（本体聚类相似阈值）。
- 对比精化触发：|S|≥3 且 |F|≥3；元程序触发：≥3 程序稳定顺序。
- 容量：默认 200/50；最优 150–200，>300 现检索噪声。
- 性能：平均 78.1%（WebShop 70.2 / InterCodeSQL 59.3 / TravelPlanner 83.3 / ALFWorld 87.2 seen、90.3 unseen，+3.1 正泛化）；高于 10× 大的 Qwen2.5-72B（75.6）。
- 复用率 51–78%，后验 0.64–0.81，meta hit 18–51%。

## 11. 评估方法

- 四基准跨域：ALFWorld / WebShop / TravelPlanner / InterCodeSQL，统一超参不按任务调。
- 组件消融：去贝叶斯选择（seen −7.8 / unseen −9.1）、去元程序（−5.9/−11.9，正泛化翻负）、去对比（−3.6/−4.6）、去本体（−4.4/−6.2）。
- 容量扫描 25→300 观察饱和与后验平台；任务侧写（复用率/后验/meta-hit/程序长度）与性能强相关。
- 学习动力学：探索(1–570)→巩固(571–1425)→利用(1426–2851)；fallback 100%→<5%。
- 可借鉴被动信号：reuse rate、posterior 成功率、meta-hit、LLM 回退率、平均调用次数——无需额外标注，可扩展我们的确定性体检指标。

## 12. 可迁移机制清单

1. 给 technique/template 卡加显式「前置条件 / 后置条件」字段，与 operator/pattern/heuristics 并列，使卡片成为可判可用的 Procedure。
2. 把 success_rate 从标量升级为 Beta(α,β) 计数（uses 拆 success/fail），检索打分加后验项：score = rel·E[ρ] − λ_risk·失败相似度 + λ_info·熵。
3. note_recall 加置信阈值+回退语义：最高分<阈值即触发既有「明说没有」路径，而非强给最相近卡片。
4. 对比精化协议：某卡同时有 ≥3 个对与 ≥3 个错上下文时触发一次对比式 merge/reinforce（区分成功/失败前置差异），并入每日体检协议。
5. 元程序/解题 playbook：把高频共现 technique 序列（题型→定理→技巧）蒸馏成带 continue/skip/repeat/abort 分支的题型-定理图节点。
6. 多因素效用剪枝：daily audit 的 unused/demote 排序改为 U=0.5·可靠性 + 0.3·频率 + 0.2·新近度（按 verified 三级重映射），替代单一 unused。
7. 语义类别/记号同义词索引：为 notation 与 concept 建轻量同义簇，解决换说法即检索不到的 coverage 弱信号问题。
8. 容量上限+去重阈值：给 records/templates 设容量预算与相似度去重（≈0.85），防重复变体堆积。

## 13. 与 dsh-math-memory 的映射与差距

- 程序四元组 {goal,precondition,action,postcondition} → 改造：映射到 technique/template 卡，需补前置/后置字段。
- Beta 后验+期望效用选择 → 改造：已有 success_rate/uses，可低成本升 Beta 计数并进入 note_recall 重排（BM25 后加一层）。
- 置信阈值+零样本回退 → 采纳：与 coverage<0.35 词面巧合判定、精读协议「明说没有」同构，直接对齐为阈值语义。
- 对比精化（S vs F ≥3 触发）→ 采纳：与 [对/错] loopback 反馈闭环+每日 merge/reinforce/demote 天然契合，只需把对比成功/失败写进协议。
- 元程序 playbook → 改造：对应 templates 题型-定理图，可加组合节点；数学解题的稳定顺序弱于具身任务。
- 本体聚类 → 改造：对应 notation 体系做同义词簇；纯 markdown 下聚类索引只能作为可选派生 cache，不破坏无数据库原则。
- 效用剪枝 → 采纳：daily audit 已有 unused/duplicate，换三因素效用排序即可；但无删除工具，剪枝=归档（archive），需保留归档线。
- 环境 step 奖励 → 不适用：笔记助手无每步环境 reward；等价信号是用户 [对/错] 与每日体检，密度低，后验收敛慢，需把单次使用也计入先验证据。
- 冻结 LLM+外部记忆哲学 → 完全一致：本系统本就是外部 markdown 记忆、不动模型权重。

## 14. 行动项

1. 在 technique/template 卡 schema 草案中增加 precondition / postcondition 可选字段（与 operator/pattern/heuristics 并列），capture-policy 写入时尝试抽取。
2. 把 memory card 的 success_rate 记账改成 success_count / fail_count 双计数，前端仍显比率，检索侧可用 Beta 后验重排。
3. 在 note_recall 重排层引入后验加权：final_score = BM25·(α/(α+β)) 或加风险惩罚项，先离线评测再上线。
4. 给 daily 体检协议加对比精化触发条件：同一记录 ≥3 对相反反馈才允许 reinforce/demote，避免单次错误反馈反复改卡。
5. 体检报告新增被动指标：reuse rate（命中的卡在本轮回复被引用比例）、fallback 率（触发「明说没有」比例）、平均检索轮数。
6. unused/demote 排序从单一「最近未用」改为三因素效用 U=0.5·verified 级 + 0.3·使用频次 + 0.2·新近度，输出为归档候选而非删除。
7. 评估 notation/概念同义词簇收益：先在 capture-policy 做同记号不同写法归一化，验证覆盖率提升后再决定是否引入聚类索引。
