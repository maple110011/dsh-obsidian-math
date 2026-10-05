# 研读记录：xiongHowMemoryManagement2026

## 0. 元信息

- citekey：xiongHowMemoryManagement2026
- 标题：How Memory Management Impacts LLM Agents: An Empirical Study of Experience-Following Behavior
- 年份：2026（ACL 2026 Long, `2026.acl-long.27`）
- 阅读日期：2026-10-01
- 阅读方式：MinerU 全文通读（`.raw/xiongHowMemoryManagement2026/full.md`，709 行；正文 §1–§6 + Limitations + References + 附录 A/B 全部逐行读过）

## 1. 一句话定位

这是一篇**实证研究**（不是新系统）：只做 memory addition 与 deletion 两个基本操作，量化出 LLM agent 的 **experience-following 属性**——「当前任务输入与检索到的记忆记录里的输入越相似，两者的执行输出就越相似」（Pearson r 在 RegAgent 上由 add-all 的 **0.95** 到 strict+history 的 **0.40**，见 Table 4/Table 5），并由此暴露 **error propagation** 与 **misaligned experience replay** 两个风险；对策只有一条：把**轨迹评估器（trajectory evaluator）**接进增删决策，其中最强的质量标签来自**未来任务对这条记忆的下游效用**（history-based deletion），不需要人工逐条标注。

## 2. 问题与动机

- 现有记忆管理策略（结构变换 / 合并 / 摘要 / 反思）**各自绑死在特定 agent 类型**上，缺少跨 agent 的底层原理：「these approaches are often designed for specific agent types (e.g., chatbot agents) and lack a unified design」（§2.2）。既有记忆库优化的两条路线（EM 优化、MDP 建模）也**没有解释基本增删操作在噪声下的长期后果**（§2.2）。
- 它要针对的 gap：记忆库是**动态演化且天然含噪**的检索池，而池子里的轨迹**常常是 agent 自己生成的**（§1）。这与「静态外部知识库 + in-context learning」的既有研究设定根本不同（§1，引 Luo et al. 2024）。
- 一句话动机：**不是「检索得准不准」，而是「检索回来的东西被模仿到什么程度、以及模仿错了会不会自己长回来」。**

## 3. 记忆结构

- 论文只考虑**情景记忆（episodic memory）**：记忆是 query–execution 对集合 $\mathcal{D}=\{(q_1,e_1),\dots,(q_N,e_N)\}$（§2.2）。没有语义记忆/程序记忆的实体化，也没有 schema、分层、链接——它**刻意**不建模这些（Limitations 明确说省略 structural transformation / merging / summarization / reflection）。
- 检索出的子集 $\xi_K \subset \mathcal{D}$ 被当作 **in-context demonstrations** 直接拼进 prompt（§2.2）。这是全篇的机制核心：**记忆不是「参考」，而是「示范」**——我们的 records 卡在注入时也是同一种呈现形态（原文片段进 system prompt），所以它的结论对我们有直接的形态可比性。
- 四个被测 agent 的记忆形态差异很大（Table 3）：RegAgent（输入向量 / 输出数字 / 检索 6 条）、EHRAgent（任务文本 / 代码 / 文本嵌入 / 检索 4 条）、AgentDriver（车辆状态 / 轨迹 / ego state+goal+history / **检索 1 条**）、CIC-IoT（IoT 包特征 / 推理+类别 / 检索 3 条）。**记忆条目就是「原始经验对」，没有卡级元数据**（无 verified、无来源、无标签）——这是它与我们最大的结构差异。
- 唯一的「质量元数据」是**运行时算出来、不进存储**的后验量：每条记忆被检索的次数 $\mathrm{fr}_t$，以及每次检索对应的下游效用 $\Phi(q_m,e_m)$（§4.1）。

## 4. 写路径（固化）

- 写入判据只有一个：评估器 $\pi$ 的通过与否。$\pi(q,e)=1$ 就存，$=0$ 就丢（§3.1）。四类：`fixed`（冻结不写）、`add-all`（全写）、`automatic/coarse`（三个自动评估器 C1/C2/C3）、`human/strict`（oracle，实际由 ground truth 模拟）（§3.1）。
- **关键写入纪律：不拒绝就是灾难。** add-all 对四个 agent 全部低于冻结基线（Table 1：RegAgent 55.48 vs Fixed 67.53；EHRAgent 13.05 vs 16.75；AgentDriver 32.32 vs 40.11；CIC-IoT 59.90 vs 71.50）。原文判语：「noisy or low-quality additions can harm memory utility」（§3.2）。
- **评估器的「严格度」不是越严越好，而是越准越好**：C1（4o-mini）/C2（4.1-mini）不一定赢过冻结基线（EHRAgent C1 26.19 > Fixed 16.75，但 RegAgent C1 63.18 < Fixed 67.53，AgentDriver C1 36.92 < Fixed 40.11），而 C3（4.1-mini 微调）/strict 稳定更好（§3.2、Fig. 2）。
- **廉价微调就够**：「fine-tuning the evaluator on only 300 trajectories (C3) already achieves strong long-term improvements」（§3.2）。
- 反向警告：「directly applying a vanilla LLM as a trajectory evaluator ... may lead to a more severe negative impact than manually crafting a small but high-quality dataset」（§3.2）。这是对我们最有杀伤力的一句——**直接用 LLM 当质检员，可能比手工维护一个小而干净的库更糟**。
- 论文**没有**去重 / 合并 / 剪枝 / 演进机制；删除单独放在 §4，且判据全部是**后验效用**（见 §7）。

## 5. 读路径（检索）

- 检索 = **按 query 相似度取 top-K**：$\xi_K$ 取最相关的 K 个对（§2.2）；相关性「often measured by the input similarity between the task query q and the query from the retrieved past experience」，实现上可以是文本编码器余弦相似度（§2.2）。
- K 的取值：RegAgent 6、EHRAgent 4、AgentDriver **1**、CIC-IoT 3（Table 3）；敏感性见 Table 5（RegAgent 3/6/12；CIC-IoT 1/3/5）——**K 变化不破坏定性结论**（Table 5，相关性仍高）。
- 相似度定义（RegAgent，§A.1）：输入相似度 = 输入向量余弦；输出相似度 $= \exp(-\gamma\|v_1-v_2\|^2)$，$\gamma=1.0$。AgentDriver 用同一形式的 RBF 核（§A.1）。EHRAgent 的**输出相似度是代码抄袭率**（`pycode_similar`，§A.1），CIC-IoT 用 embedding 相似度（§A.1）。
- **没有查询增强、没有空结果语义、没有精读纪律、没有排序权重**——它的「读」就是向量近邻 top-K。它把全部智力都放在「读回来的东西值不值得留」上（写删侧），这是我们最该学的分工。
- 特别值得注意：**输入相似度高 ≠ 这条记忆好**。add-all 的输入输出相似度最高（RegAgent 6 demos 下 Pearson r **0.95**、CIC-IoT **0.87**），但性能最差（55.5 / 71.5），而 strict 的 r 更低（0.92 / 0.82）却性能最高（71.0 / 85.4）（Table 5）。**高相似度只是在放大「记忆里已有的东西」，包括错误。**

## 6. 组织与关系

- 全篇**没有**分类法 / 链接 / 图谱 / 层级导航。记忆是一个平铺的、按相似度可检索的池子；组织完全交给检索器。
- 唯一的结构性区分是**时间**：记忆库随执行不断增长（Fig. 1 的工作流），并用「检索频次 $\mathrm{fr}_t$ 的时间差」$\mathrm{fr}_t - \mathrm{fr}_{t'}$ 与「检索次数 $n$」当作年龄段/成熟度代理（§4.1）。
- 「从有什么到取什么」这一跳，它的答案是：**不做组织，做后验打分**——$\Phi$ 的累计均值（§4.1 式 2）就是「取什么」的全部依据。

## 7. 维护与自改进

两种删除策略 + 一种组合（§4.1）：

1. **Periodical-based deletion**：$\phi_{\mathrm{per}} = \mathbf{1}[\mathrm{fr}_t - \mathrm{fr}_{t'} \le \alpha]$，即「一段窗口内被检索次数不够多」就删（简化自人类遗忘曲线类工作）。它保证 $M \le \alpha(t-t')K$（§4.1 式 1）。
2. **History-based deletion（论文的主推）**：一条记录**必须先被检索至少 n 次**，再算它历次检索的平均效用；均值低于 $\beta$ 就删（§4.1 式 2）。原文给的入选门槛写作 $>n$（式 2 中是 $\mathrm{fr}_t > n$，正文写作 "at least n times"），理由：「to reduce the estimation bias for the average utility」——**样本不够就不下结论**。
3. **Combined**：$\phi_{\mathrm{comb}} = \phi_{\mathrm{per}} \vee \phi_{\mathrm{hist}}$（§4.1 式 3）——按「或」合并，主打把体积压到最小。

效果（Table 2，strict evaluator 那一半）：

| agent | No del | Period | History | Combined |
|---|---|---|---|---|
| RegAgent SR | 70.95 (2938) | 67.65 (949) | 69.80 (2286) | 66.58 (890) |
| EHRAgent ACC | 38.67 (1012) | 38.59 (302) | **42.06 (784)** | 42.34 (248) |
| AgentDriver SR | 51.00 (1178) | 50.94 (467) | **51.81 (846)** | 49.97 (323) |
| CIC-IoT ACC | 85.40 (904) | 80.80 (310) | **89.60 (788)** | 85.50 (188) |

- 三个真实 agent 上 history-based 在 strict 评估器下**不降反升**（EHRAgent +3.39、CIC-IoT +4.20、AgentDriver +0.81），同时体积减半以上；periodical 只是「小降大幅缩容」（§4.2）。
- **规模对照组（Table 7）**：固定 1000 条同量记忆再比，strict+history **74.4** > strict only **72.8**——证明提升来自**平均质量**，不只是池子大小（§B.6）。
- **评估器不可靠时，删除是双刃剑**：用未微调的 GPT-4o-mini 当 history 评估器，「yields a clear performance gain on EhrAgent but leads to degraded performance on AgentDriver」（§4.2、Fig. 5）。
- **最反直觉的一条**：history-based deletion 在 AgentDriver 上**能超过 error-free 对照**（§B.4 与 §3.4/Fig. 13），说明它不仅删噪声，还留下「对后续任务恰好好用」的样本。
- **没有的维护机制**：promote/demote 分级、reinforce、antipattern 库、merge、audit 台账——一律不存在。

## 8. 验证与质量门控

- 质量门控**只有一道**：写入时的评估器 $\pi$；且论文证明了这道门的**能力决定一切**（§3.2：微调评估器 > 未微调 > 不筛）。
- **关键方法学：error-free 对照**（§3.4）。对每个任务用**同一批检索结果**，但把 LLM 的执行换成 ground-truth 输出，从而隔离「检索带来的误差」与「任务本身难」。「we compare it with a variant that uses the same retrieved examples for each task but replaces the LLM's execution with the ground-truth output」（§3.4）。这是他们判断 error propagation 的因果手段。
- **strict 评估器其实是 oracle 模拟**：「we simulate this process by comparing the generated output with the ground truth」（§3.1）。所以文中所有「human evaluation」都是**下界理想化**，不是真实人工标注——它没有测「用户点确认」这条路径。
- 质量标签的来源是本篇最有价值的论断：「future task evaluations can serve as free quality labels for stored memory」（Abstract / §4.1）。即 $\Phi$ 取自**将来那次任务做得好不好**，不需要为记忆本身另起一套标注。
- **评估器本身也会被纠正**：history-based deletion 会删掉「当初过了评估器、事后证明有害」的记录（§4.3、Fig. 6、Table 8；见 §10）。

## 9. 成本 / 安全 / 隐私

- **token / 预算**：全文**未给**任何 token 预算、注入长度上限、prompt 成本数字。它只谈**记忆条数**（Mem Size）与执行步数。
- **规模有界**：periodical deletion 有理论界 $M \le \alpha(t-t')K$（§4.1）；实测把 1178 条压到 323 条（Table 2 AgentDriver combined），或 904→188（CIC-IoT）。§5.2 研究**固定容量**（EHRAgent 100 条 / AgentDriver 180 条 = 初始尺寸）下的表现，结论是「naive, unbounded memory growth is unnecessary」（§5.2）——原文用的是 "suggests"（§5.2），措辞是推测不是断言。
- **成本维度**：评估器调用本身是**额外 LLM 调用**（C1/C2/C3 都是 LLM judge，§A.4 给了完整 prompt），论文没有记账。
- **安全 / 隐私**：**全文未给**。数据是公开数据集（MIMIC-III、nuScenes、CIC-IoT），没有隐私威胁模型、没有投毒/越权讨论。
- fail-closed：**无此概念**。

## 10. 关键数字 / 阈值

> 全部取自正文与附录；凡是「推算」的都标出算式。图表里若有数值，我逐字引用了它们的 caption。

**规模与配置（表格逐字）**

- RegAgent：初始记忆 **100** 条（6 维、三个高斯分布），评测流 **4000** 条输入–输出对；成功判据 $|\hat y - y| \le 1$；检索 **6** 条示范（§A.1）。
- EHRAgent：MIMIC-III 过滤后 **2392** 个任务；初始记忆 **100** 条；每次检索 **4** 条（§A.1）。
- AgentDriver：nuScenes 随机采样 **2000** 测试用例；初始记忆 **180** 条；原论文两步检索（top-3 + LLM 选 1）被简化为 **top-1**（§A.1）。
- CIC-IoT：34 类攻击过滤到 **8** 类；**1000** 测试用例；初始记忆 **100** 条合成记录；检索 **3** 条（§A.1）。
- 记忆条数（Table 1 / Table 2）：add-all 4100（RegAgent）、2411（EHRAgent）、2125（AgentDriver）、1050（CIC-IoT）。

**评估器阈值（全是可按我说的「门槛」用的数）**

- RegAgent strict 阈值：绝对误差 **1.0**；C1/C2/C3 = **1.6 / 1.4 / 1.2**（§3.1、§A.1）。
- AgentDriver strict 阈值：UniAD 3 秒平均 L2 **< 2.5**（§A.1）。
- CIC-IoT / EHRAgent strict：字符串包含 / 精确匹配（§A.1）。
- 微调评估器只用 **300** 条轨迹（§3.2；§3.1 写作 "300 correct judge data"）。
- EHRAgent 历史删除的 β：coarse（4o-mini / 4.1-mini）**0.3**，strict 与 4.1-mini-FT **0.7**（§A.1）；CIC-IoT β = **0.7**（§A.1）；RegAgent β = **0.5**（§A.1，但 §4.1/§A.1 开头那句笼统写 "a threshold β = 0.5 across all setups" 与之冲突，见 §15）。
- 「先检索够次数再判」：RegAgent/EHRAgent 最少 **5** 次；AgentDriver/CIC-IoT 最少 **3** 次（§A.1）。
- 周期：EHRAgent **200** 步、AgentDriver/RegAgent/CIC-IoT **500** 步；α：多数 **0**，CIC-IoT **1**（§A.1）。
- 输出相似度核：$\exp(-\gamma\|\cdot\|^2)$，$\gamma = 1.0$（§A.1，RegAgent 与 AgentDriver 同式）。
- Table 6 的敏感性：RegAgent 召回 5/10/15 次 → 69.8 / 67.4 / 70.1；β = 0.5/0.4/0.6 → 69.8 / 67.3 / 62.0；period = 500/100/300 → 67.7 / 53.2 / 64.0。CIC-IoT：89.6 / 87.6 / 88.7 与 β = 0.7/0.6/0.8 → 89.6 / 90.2 / 89.6。

**experience-following 的相关系数（Table 4 / Table 5，论文里唯一的量化形态）**

- Table 5（RegAgent）：Add All **0.95**（6 demos）/ 0.92（3）/ 0.90（12）；Strict **0.92** / 0.90 / 0.95。CIC-IoT：Add All 0.87 / 0.91 / 0.93；Strict 0.82 / 0.84 / 0.85。
- Table 4（Qwen 骨干，RegAgent）：Add All 0.74（Qwen3-32B）/ 0.82（Qwen3-14B）；Coarse 0.69 / 0.76；Strict 0.72 / 0.89；Strict+Hist 0.40 / 0.41。
- 正文定性：「the agent shows a near-perfect correlation (Pearson r 1)」——指 RegAgent 记忆变大、示范变近时（§3.3）。
- **同一张表里的反例（很重要）**：Add All 的 r=0.95 配 SR 55.5，Strict 的 r=0.92 配 SR 71.0（Table 5）。**相关系数高不等于系统好。**

**history-based deletion 的效果幅度（推算，算式写明）**

- EHRAgent strict：42.06 − 38.67 = **+3.39** ACC；记忆 1012 → 784，**−22.5%**（Table 2）。
- CIC-IoT strict：89.60 − 85.40 = **+4.20** ACC；904 → 788，**−12.8%**（Table 2）。
- AgentDriver strict：51.81 − 51.00 = **+0.81** SR；1178 → 846，**−28.2%**（Table 2）。
- RegAgent strict：69.80 − 70.95 = **−1.15** SR（该合成设定靠大池子吃饭，§4.2 明说）；但同量对照下 history 版 **74.4 > 72.8**（Table 7）。
- Combined vs No del（CIC-IoT strict）：86.6 → 61.0，**−25.6 点**（Table 8）。

**Table 8 保留 vs 删除的「内在质量」（逐字）**

- EHRAgent 正确率：Retained 44.1 / 49.1 / 54.8（4o-mini / 4.1-mini / 4.1-mini-FT）vs Deleted 36.3 / 32.1 / 48.2。
- CIC-IoT：Retained 78.9 / 72.2 / 86.6 vs Deleted 56.7 / 55.1 / 61.0。
- 图版（Fig. 6 / Fig. 15 / Fig. 16）：KDE 曲线显示 **retained 的绝对误差低于 deleted**（§4.3）。
- 反例（§B.7，只有文字）：「when using GPT-4o-mini as the evaluator, the retained memory in AgentDriver exhibits lower average quality than the deleted records」。**评估器不可靠 ⇒ 删除决策反向。**

**error-free 对照（Fig. 4 / Fig. 13，只有定性）**

- add-all 与 coarse 的「相对 error-free 的差距」随时间**扩大**；AgentDriver strict 在大约 **2000** 次执行后反超 error-free 对照（§3.4）。
- 具体数值**全文未给**（是图，不是表）。

## 11. 评估方法

- 单元是**长期执行流**：每个 agent 跑整条测试流（最多 4000 次执行），画累计曲线，而不是一次性静态评测（§3.1、Fig. 2/8/11）。
- 主指标：RegAgent/AgentDriver = 成功率 SR，EHRAgent/CIC-IoT = 准确率 ACC；辅指标 = **记忆条数**（Table 1/2 每格都带 Mem Size）——**性能与体积必须成对读**。
- 三种对照设计（这是可以整段搬进我们回归测试的结构）：
  1. **fixed-memory baseline**（冻结池）——隔离「增长」本身带来的收益；
  2. **error-free variant**（同检索、真值执行）——隔离「记忆嵌入的误差」；
  3. **size-matched comparison**（同条数再比）——隔离「质量」与「数量」（§B.6）。
- 压力场景：任务分布漂移（用 GMM 把测试 query 聚成 3 组并重排，制造突变，§5.1、§A.5）、容量硬约束（固定到初始尺寸，§5.2）。
- 我们能借鉴的**被动信号**（不需要用户额外操作）：
  - 从「同一条记忆被检索」到「这次任务的结局」的**配对样本**——这正是 $\Phi$ 的定义，我们的 `uses`（检索命中）与 `gain`（用户点过的好坏）之间缺的正是这条配对；
  - 用**后来的任务结果**回填早先记忆的质量标签（Abstract）；
  - 用相关系数（输入相似度 vs 输出相似度）当**行为健康指标**——它的绝对值不代表好坏，**它的存在性**才说明「模型在模仿记忆而不是在推理」。

## 12. 可迁移机制清单

> 每条写：机制 → 要改我们系统的哪个环节 → 采纳 / 改造 / 不适用。

1. **把「检索命中」升级为「检索命中 × 下游结果」的配对记账**（核心一条）。论文的 $\Phi(q_m,e_m)$ 是「第 m 次检索这条记忆时，当次任务最终有多好」；平均后成为该记录的效用。我们今天的 `uses` 只数「被检索出来」（`note-tools.mjs:539`、`design.md:177` 已自承），`gain` 要用户逐条点且真实 vault 里从未被用过（坑 35）⇒ **改造**：在 `cache/retrieval-stats.json`（`note-tools.mjs:1724`）的每条命中记录上加一个 `outcome` 槽位，由**下一轮会话**写入（对应 note-noise 缺口 5）。**不新增用户负担**——这是本篇最大的方法贡献。
2. **平均效用删除 + 最小样本门槛**：$\phi_{\mathrm{hist}} = \mathbf{1}[\overline{\Phi} \le \beta]$，且**必须先被检索 ≥ n 次才参与判定**（§4.1 式 2，「reduce the estimation bias」）⇒ **改造**：体检现在的 `weak` 是「成功率 ≤0.4 且 uses ≥3」（`math-memory.mjs:2528`），`unused` 是「uses=0 且 >30 天」（`:2529`）。可新增一条 `lowUtility`：**检索 ≥n 次且平均 outcome 低于阈值**，并明确指出「这是被用过但没用上的」，与 `unused` 区分（note-noise 缺口 5）。
3. **「先够次数，再下结论」的门槛语义**（n = 3~5，§A.1）⇒ **采纳**：把 `uses ≥ 3`（已有）提升为**所有质量判定的统一前置条件**，包括未来 P5 的降权与 P6 的隔离建议：样本不足时**只报不判**（照 `:520-527` 那条「既有排序在阈值内不移动」的纪律）。对应 note-noise 缺口 5 与 P5②。
4. **容量硬上限 + 「超限只删平均效用最低的那一条」**：§5.2 在固定容量下把 combined 改成「先 periodical，再只删一条最低效用的记录」⇒ **改造**：对应 P7 的 `minimal` 档思路，但论文给了更具体的策略——**超预算时删的是平均效用最低者，而不是最旧者**。我们的 `appendOnlyIndexDigest` 是「按预算丢最旧行、不插标记」（`math-memory.mjs:3619-3629`，note-noise 缺口 8）⇒ 可把「丢最旧」改成「丢最低效」并**必须插截断标记**（沿用坑 47）。
5. **评估器可靠性是删除的前置条件（fail-closed 门）**：strict 下 history 删除在三个真实 agent 上全升（+3.39/+4.20/+0.81），而**未微调的 LLM 评估器会让它反向**（「gain on EhrAgent but degraded performance on AgentDriver」，§4.2；§B.7 甚至出现 retained 质量低于 deleted）⇒ **采纳**：任何基于 outcome 的删除/降权，**必须先自证质量标签可靠**（可用「保留 vs 删除组的结局差异方向」当自检指标），不可靠时**退化为只报不删**。
6. **「免费质量标签」的方法学：用后续任务评测替代逐条人工标注**（Abstract）⇒ **改造**：我们不烧 API 做 judge，但**可以借用它的结构**——把 `gain` 从「用户对卡的判断」改成「用户对**那次用到这张卡的答复**的判断」。这直接回答 §13 的核心问题：`success_rate`/`gain`/`uses` 里，`uses` 是「暴露量」，`gain` 应重定义为「**持出结局**」，两者相乘才是效用——**照抄 $\Phi$ 的语义，不照抄它的 LLM judge 实现**。
7. **相关系数当「模仿度」健康指标**（Table 4/Table 5）⇒ **改造**：我们可算一个类比量——「note_recall 命中的卡与本次答复的用词/结构重合度」vs「本次答复的正确性」。论文已给反例警示：**r 高不代表好**（Add All r=0.95/SR 55.5 vs Strict r=0.92/SR 71.0），所以它只能当**告警**（模仿度陡升 ⇒ 检索在放大存量而非在推理），不能当排序权重。
8. **error-free 对照进我们的回归测试**：同检索、替换为已验证答案，看差距是否随时间扩大（§3.4）⇒ **改造**：把 `scripts/qa/engine-probe.mjs` 的探针扩成「同一批检索 + 真值答案」的对照，用于判断**注入的记忆是不是在引入误差**（note-noise 缺口 1/5 的验证手段）。
9. **misaligned experience replay 的命名与判据缺口**：论文**只给定义与事后归因**（§4.3），没有可计算判据 ⇒ **改造**：我们的 `not_applicable_when` 是唯一「这张卡自己说别用」的门控（note-noise §3 已有 3、坑 47）。不要再造第二套语义判据（P5① 的经验：判据锚在 signature 上才不喊狼来了）；**只把「检索很频繁但结局一直差」当作 misaligned 的操作化定义**。
10. **不适用**：论文的 $\Phi$ 用 LLM judge / ground truth 自动打分；我们的红线是「插件不调模型」（`design.md:286`）⇒ 我们不能自动打分，只能用**用户在同一轮或下一轮已经产生的结局**。这条差异必须写进任何采纳方案的风险栏。
11. **不适用**：论文不建模合并 / 摘要 / 反思 / 结构变换（Limitations 自承），也不建模分层索引与注入预算——我们的 P1/P2（注入措辞分级、可信度进注入）在它那里**没有对应物**，不能拿它当依据。
12. **不适用**：它的记忆是「经验对」，没有 verified/来源/说话人字段，也没有「用户确认」这一档（strict 是 oracle 模拟）⇒ 不能引它支持 D2 的第四档 `unverified`，也不能引它支持 D1 的「AI 产物降级」。

## 13. 与 dsh-math-memory 的映射与差距

> 逐条标 采纳 / 改造 / 不适用，并点名 note-noise 文档的缺口编号与 P 编号。

| # | 论文机制 | 我们的现状（对照 note-noise） | 判定 | 要改的环节 |
|---|---|---|---|---|
| 13.1 | $\overline{\Phi}$（平均下游效用）当删除判据（§4.1 式 2） | 缺口 5：`uses` 只数「被检索出来」，`gain` 从未被真实使用（坑 35）；`weak` 只看 `success_rate ≤0.4 且 uses ≥3`（`:2528`） | **改造** | P5② 的「单源老化降权」旁边并列一条**效用降权**；`retrieval-stats.json` 加 outcome 槽 |
| 13.2 | 「检索 ≥n 次才判定」（§4.1，「reduce the estimation bias」） | 已有 `uses ≥3` 门槛（`:2528`）、边界门控（坑 47） | **采纳** | 统一成「质量判定的最小样本门槛」；写进 P5/P6 的判据前置条件 |
| 13.3 | 容量约束下「删平均效用最低者，而非最旧者」（§5.2） | 缺口 8：`appendOnlyIndexDigest` 超预算**静默丢最旧行、不插标记**（`:3619-3629`） | **改造** | P7 的 `minimal` 档；三层索引的丢弃规则 + **必须插截断标记**（坑 47 的纪律） |
| 13.4 | 评估器不可靠 ⇒ 删除反向（§4.2、§B.7） | 缺口 5 + 坑 46（不要做通用去冗余重排，GraphMemix −6/−36） | **采纳** | 任何 outcome 驱动的删/降都必须**先自证方向**，否则退化为只报（对齐 P5「只报不改」） |
| 13.5 | 「免费质量标签」= 用后续任务评测（Abstract） | 缺口 5：`gain` 需要用户逐条点，实践中无信号；P2 已让 `verified` 进注入 | **改造** | 把 `gain` 的采集点从「卡片」移到「使用该卡的答复」；对应 note-noise §5「可操作的判据」那句 |
| 13.6 | 高相似度会**放大存量（含错误）**，r 高 ≠ 好（Table 5） | 缺口 1：注入里只有「地图/事实」措辞之争；§1.3 的自我强化链是**同族现象** | **采纳** | 给 `hookPrior` 的 `uses` 项加**上限/饱和**语义，并在体检里单列「模仿度告警」；这是 P2 之后的下一条注入纪律 |
| 13.7 | misaligned experience replay（§4.3） | 缺口 4：没有「待澄清」状态；`not_applicable_when` 是唯一硬门控 | **改造** | P6 的 `unclear` 动作**有了一条外部证据**（论文证明「过了质检的记忆仍可能有害」）；但不要新增语义判据 |
| 13.8 | error-free 对照（§3.4） | 缺口 5 的验证手段缺失；`engine-probe.mjs` 只测可达性 | **改造** | 探针加「同检索 / 真值答案」对照；验收门槛沿用 `retrieval-v3.md:229` |
| 13.9 | strict 评估器 = oracle 模拟（§3.1） | 我们的 `user-confirmed` **真的是用户点的** | **不适用** | 不能引它证明「用户确认比自动质检差」；它压根没测用户确认这条路径 |
| 13.10 | 不建模合并/摘要/反思、不建模注入预算（Limitations、全篇） | P1/P2/P3 全是注入侧工程 | **不适用** | 不能拿它当 P1/P2/P3 的依据，也不能当 D1/D2 的依据 |
| 13.11 | 无 verified / 无来源 / 无说话人字段（§3.1–§3.3） | 缺口 1/2/3 正是这三个字段的缺失 | **不适用** | 它证明不了「加字段有用」，因为它的设定里根本没有这个变量 |
| 13.12 | 分布漂移下 periodical 删除反而稳住性能（§5.1） | 我们无分布漂移概念（学科固定） | **不适用** | 只在跨学科/跨主题回忆时有类比价值，不值得先做 |

**最大差距（一句话）**：我们的 `uses`/`success_rate`/`gain` 是**三个各自独立的字段**，而论文的效用是「**同一次检索的暴露量 × 那次任务的结局**」构成的**配对样本**——**我们没有配对，所以永远算不出 $\overline{\Phi}$**。这是缺口 5 的真正病根，比「给 `uses` 降权」更本质。

## 14. 行动项

按「最小可落地 → 较大改造」排：

1. 【最小·先做】**给检索命中加结局槽**：`retrieval-stats.json` 的每次命中记录预留 `outcome` 字段，由下一轮会话写入「用到这张卡的那次答复结果」（用户 ✅/❌、或该轮的 `success_rate` 变化）。**验收**：构造「同一张卡命中 3 次、3 次结局分别为好/坏/坏」的夹具，断言算出的平均效用与手算一致；**否定性断言**：从未被命中的卡**不得**被算出效用（照 `findCorroboration` 的写法）。对应缺口 5。
2. 【小改】**新增 `lowUtility` 体检发现**：检索 ≥3 次且平均 outcome ≤ 阈值（阈值待定，见第 6 条）⇒ 进 `sections` 与清单，与 `weak`（成功率低）分开报，并**照 P3 的教训放在清单靠前位置**（缺口 7：清单在 1200 字符处截断）。**验收**：夹具必须**跨过 1200 字符阈值**（坑 81）。
3. 【小改】**`uses` 项饱和化**：`hookPrior` 的 `0.15 × uses` 改成有上限的映射（如 `min(uses, n)/n`，n 取论文的最小判定次数 3~5）。**这是唯一会移动既有排序的改动**，必须过 `retrieval-v3.md:229` 的「Direct 数不降且目标排名均值不升」，且发布前跑 `engine-probe.mjs`。对应缺口 5、§1.3 的自我强化链。
4. 【中改】**索引丢弃规则**：把 `appendOnlyIndexDigest` 的「丢最旧」改成「丢最低效/最低 verified」并**插截断标记**。这是论文 §5.2 的容量策略翻译，且能同时缓解缺口 8（静默丢行）。**验收**：断言超预算时输出含截断标记、且被丢的是最低效那行；变异：删掉标记注入 ⇒ 断言红。
5. 【中改·有前置条件】**基于 outcome 的降权/归档**：只有当第 1 条的 `outcome` 采样足够（≥3 次且方向自检通过）才允许自动降权；否则只报。**前置门**：先跑一次「保留组 vs 删除组的结局差异方向」自检（论文 §B.7 的教训：4o-mini 评估器下方向是反的）。对应 P5②/P6。
6. 【研究项】**阈值 β 的标定**：论文给的是 0.3/0.5/0.7（不同 agent 与评估器，§A.1），我们没有任何先验。建议先用**分位数**而不是绝对值（例如「平均 outcome 落在全库后 20%」），因为我们的 `success_rate` 量纲与他们的误差/L2 完全不同。**这是推算，非论文结论。**
7. 【研究项】**「模仿度」被动指标**：算「命中卡与本次答复的重合度」与其正确性的关系。**必须先接受论文的反例**（r 高不等于好），所以只做告警、不做排序。
8. 【不要做】**不要**引入 LLM 评估器自动打分（触 `design.md:286` 红线）；**不要**照搬 periodical deletion（我们没有「一段时间内被检索次数」的窗口概念，且论文自己承认它只是缩容手段，strict 下几乎不涨）。

## 15. 证据边界

**逐字读到的（可直接引用）**

- 全部正文 §1–§6、Limitations、附录 A.1–A.5、附录 B.1–B.8 均逐行读过；Table 1–8 的数值、caption 与正文引用均逐字核对。
- 具体阈值与超参：评估器阈值 1.6/1.4/1.2/1.0/2.5、β = 0.3/0.5/0.7、最小检索次数 3 与 5、周期 200/500、α = 0/1、γ = 1.0、微调 300 条——全部来自 §3.1/§4.1/§A.1（见 §10）。
- 「$\Phi$ 是历次检索的下游效用均值」这一语义来自 §4.1 的式 2 与其解释；「先检索 n 次再判定」来自同一段原文。

**我的推论（论文没直说）**

- §12 第 1 条把 $\Phi$ 映射到我们的 `uses × outcome` 配对、把 `gain` 重新定义为「持出结局」——这是我的设计推论，论文没有讨论任何「卡片 + 用户反馈」形态。
- §10 里所有标「推算」的百分比（+3.39 / +4.20 / +0.81 / −22.5% 等算式）是我从 Table 2/Table 8 的表格数值算的，不是论文原文。
- 「Add All 的高 r 说明它在放大存量」是我对 Table 5 两组数（r 与 SR 反向）的解读；论文只写了「indiscriminate memory addition will easily introduce incorrect executions」（§3.3），没有把 r 与 SR 的这个反差单独点出来。
- 第 14 条行动项里的具体工程落点（`retrieval-stats.json`、`appendOnlyIndexDigest`、`hookPrior` 的 `uses` 项）是我对照 note-noise 文档与仓库现状写的，论文与此无关。

**论文明确没做的（不要替它吹）**

- **没有**用户确认 / verified 分级 / 说话人来源的实验——strict 是 ground-truth 模拟的 oracle（§3.1 原文 "we simulate this process by comparing the generated output with the ground truth"）。
- **没有** token 预算、注入体积、成本、隐私、投毒安全（§9 已逐项核，全文未给）。
- **没有**数学/公式类任务，四个 agent 是回归、EHR 代码生成、自动驾驶、IoT 分类；**不能**直接外推到 dsh-math-memory 的数学记忆。
- **没有**合并 / 摘要 / 反思 / 结构变换 / 分层组织 / 去重（Limitations 自承）。
- **没有**理论保证（Limitations 自承）；也没有对「$\Phi$ 用 LLM judge 会自动打分」这一点做可靠性分析（§B.7 只观察到一个反向案例）。
- **主图（Fig. 2/3/4/5/7/13 等）是可提取性为零的普通 JPG**：MinerU 只产出 `![](images/....jpg)` 占位，图内数值与散点**全部不可得**。所以「Pearson r ≈ 1」「2000 次执行后反超」这类表述我只能按正文措辞转述，**无法核对图内真值**。
- 同理，Fig. 6/15/16 的 KDE 曲线只有定性 caption，**没有均值/方差数字**；Fig. 17/18 的容量约束结果也**只有图、无数值**。

**读全文时发现的可能缺损 / 论文自身不一致（原样记录，不做脑补）**

1. **同一条件两处数字不一致**：EHRAgent strict 无删除，Table 1 是 ACC **38.50**、Table 2 是 **38.67**；同理 Table 1 的 C1（26.19）与 Table 2「No del」的 C1（25.91）也不一致。论文未解释是不同 seed/协议还是笔误。
2. **β 的笼统表述与逐 agent 设定冲突**：§A.1 RegAgent 段写 "History-based deletion is applied with a minimum deletion frequency of 5 and a threshold β = 0.5 **across all setups**"，但同节后面给出 EHRAgent 的 β = 0.3/0.7、CIC-IoT β = 0.7。**"across all setups" 是不准确的**，我按逐 agent 的值记录。
3. **Table 8 与 §B.7 正文不符**：§B.7 说 "when using GPT-4o-mini as the evaluator, the retained memory in **AgentDriver** exhibits lower average quality than the deleted records"，但 Table 8 只有 **EhrAgent 与 CIC-IoT Agent** 两行（图 16 才是 AgentDriver）。所以那句结论**在表格里找不到支撑**，只能靠图 16 的 KDE（不可提取）。
4. **Table 4 的 "Coarse + Hist" 数值可疑**：Qwen3-32B 的 `66.5 (0.61/1.01)`、Qwen3-14B 的 `64.4 (0.63/0.97)`——表注说括号是 retained/deleted mean quality（误差量，越小越好），而这里 retained 0.61 却配了一个 **1.01**；对照组 `Strict + Hist` 是 `0.40/0.54`、`0.41/0.51`（自洽）。**1.01 > 1.0 超出 RegAgent 严格阈值 1.0 的范围**，我无法确认 1.01 是「deleted 质量」还是别的量，**存疑，未采用**。
5. **公式 OCR 有轻度损伤**：§4.1 两个分段函数与 §A.1 的相似度公式在 full.md 里是 LaTeX 片段，`\mathbf{v_1}` 一类花括号被截（如 `\text { output\_similarity } = \exp \left(- \gamma \| \mathbf {v _ {1}} - \mathbf {v _ {2}} \| ^ {2}\right).`），语义可辨但**不是原排版**；`μ ∈ -0.5, 0, 0.5` 与 `ϵ … within [1, 1]` 明显丢了负号语义（原文应为 $[-1,1]$ 之类），**这是我读到的最明确的公式损伤，需要以 PDF 为准**。
6. **参考文献编号引用全部丢失**：正文的 `(Wang et al., 2024a)` 一类在 full.md 里保留，但上标脚注（如 "code to facilitate further study. 1"）与图号交叉引用（"see Fig-" 断行）有断行损伤，不影响结论。
