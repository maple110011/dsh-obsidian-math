# 研读记录：WikiSkill — Compiling Agent Experience into Persistent Knowledge for Skill Evolution

## 0. 元信息

- citekey：`tangWikiSkillCompilingAgent2026`
- 标题：WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution
- 作者：Liyan Tang, Cyrus Rashtchian, Chun-Sung Ferng, Andrew Tomkins, Da-Cheng Juan（Google Research）, Tu Vu（Google Research / Virginia Tech）
- 年份：2026（arXiv:2608.27454v1，`[cs.AI]`，2026-08）
- 阅读日期：2026-09-17
- 阅读方式：`.raw/tangWikiSkillCompilingAgent2026/full.md`（MinerU 全文，657 行）——**正文 §1–§7 + Limitations + References + Appendix A–E 全部读完**（含 Algorithm 1 伪代码、Table 1–7、五个推理 agent 的 system prompt、Wiki Maintainer 与 Skill Proposer 完整 prompt）
- 源质量：**干净**。`<sub>` 共 **0 处**（无 `[a-z]<sub>` 词中切分模式）；`<sup>` 为上标（作者单位、引文标注）；**14 个 `<table>` 块与 1 个 `div.mineru-algorithm` 块以原始 HTML 保留**（表格内容可读，但需要能读 HTML 的读者；`full.md` 里没有 markdown 表格）。**未回退 `pdftotext`。**
- 代码/仓库：论文**未给出**作者官方实现仓库。**第三方复现**：<https://github.com/martjay/Wiki-Skill>（owner `martjay` / commit 署名 MusicHunter，与论文作者无关联；仓库 2026-08-31 创建，同日 7 次提交至 HEAD `ddf8fdb`，6 stars，0 fork，MIT）。本记录 §11 之后凡涉及仓库的事实，均已核对到文件与函数（`scripts/wikiskill_framework.py`、`scripts/wikiskill_orchestrator.py`、`references/*.md`、`test_wikiskill.py`），并在文中标注「仓库」。
- ⚠️ **本记录对仓库数字的取舍**：仓库 README/`references/empirical-results.md` 复现了自己的一套实验数字，**与论文 Table 1 不一致**（例如 Gemma-4-31B 平均：论文 54.9 / 复现行与论文分项不同；Qwen-3.6-27B 平均两处均为 63.3 但相邻行不同）。**凡涉及"效果"的数字一律引论文**；仓库只用于**实现与工程事实**。这是 AGENTS.md §6「二手来源要标注」的直接应用。

## 1. 一句话定位

在**不可变的原始执行轨迹**与**可执行的技能**之间，插入一层**持久、复利、永不回滚的知识库（wiki）**：wiki 把每轮 rollout 的经验编译成"一个失败模式/成功策略一页"的模式页 + 一个全局索引，并用两本台账（`log.md` 演进日志、`skill-impact.md` **程序化追加**的审计日志：提案 diff + 验证分 + Accept/Reject）记住"什么试过、结果如何"；技能只由 wiki 驱动地做**原子补丁**，且**技能回滚不影响知识**。核心主张：**让技能演化站在"越来越有支撑的知识"上，而不是站在上一轮的产物上。**

## 2. 问题与动机

- **背景**：agent skill（把指令、脚本、资源打包成一个文件系统模块）已经成为不更新参数就能积累专业知识的标准载体；但**手写技能需要预判 agent 会需要什么**，于是出现了一整条"从经验自动演化技能"的路线：跑 agent → 分析成功/失败轨迹 → 改技能 → 验证门控。
- **gap（本文的靶子）**：这些方法**都没有把"学到的东西"维护成一个独立的、可演化的知识表示**。
  - EvoSkill：维护"历史提案 + 评估结果"的**扁平反馈历史**；
  - Trace2Skill：从轨迹抽取**局部教训**、层级合并成技能补丁；
  - SkillOpt：用**被拒编辑的反馈** + 逐 epoch 元指导。
  - 三者的共同后果：**指导技能开发的洞见散落在优化历史里**，跨迭代无法系统性复用（原话：insights … remain scattered across optimization histories, limiting their systematic reuse across iterations）。
- **思想来源**：Karpathy (2026) 的 "LLM Wiki" 主张把经验**编译成持久、复利的的知识**。本文的问题就是：agent 经验能不能也这样编译，从而支撑长期技能演化？
- **一句话**：**不加持久知识层的技能演化 = 在产物上反复打补丁；技能退化时你丢掉的不仅是技能，还有"为什么当初这么改"的记忆。**

## 3. 记忆结构

**三层物理目录（一个 workspace），不是逻辑分层**（§3.1）：

| 层 | 目录 | 内容 | 关键性质 |
|---|---|---|---|
| **Raw Layer** | `raw/traces/` | 完整 step-by-step 轨迹：推理、工具调用参数、工具输出原文、最终答案 | **不可变**（immutable）；Maintainer 与 Proposer 都可读 |
| **Wiki Layer** | `wiki/` | `patterns/`（一页一个失败模式或成功策略）+ `index.md`（模式总目录）+ `log.md`（逐轮演进日志）+ `skill-impact.md`（**框架程序化追加**的审计台账） | **持续累积、跨迭代复利、任何情况下不回滚** |
| **Skills Layer** | `skills/<name>/` | `SKILL.md`（frontmatter `name`/`description` + `When to Apply` / `When NOT to Apply` / `Instructions`）+ `PURPOSE.md`（`Origin` / `Patterns Addressed` / `Evolution History`，映射回催生它的 wiki 模式） | 可执行产物；**候选先写 staging，通过门控才原子替换，否则回滚** |

**模式页（pattern page）的写法契约**（来自 Wiki Maintainer 的 prompt，Appendix E.2；这是全文第二重要的东西）：

1. 每页必须写清四件：**是什么（description）** / **根因分析（WHY it happens，不只是 WHAT）** / **轨迹里的确切命令序列（做错了什么、做对了什么）** / **已知解法或 workaround（带确切语法的具体动作模式）**；
2. **成功模式与失败模式都要收**：失败模式记"怎么错的、怎么避免"，成功模式记"持续导致完成的策略"；
3. **不要建重复模式**——用新证据更新已有的；
4. **简洁：10–30 行，不要写小作文**；
5. **只对有意义、可泛化的观察建页**。

**`index.md` 的行格式（作者称其为"全库最重要的一处"）**：

```
- [pattern-name](wiki/patterns/pattern-name.md): PROBLEM + ROOT CAUSE + FIX in one or two sentences.
```

理由（原文）：索引行**决定读者要不要打开整页**，所以描述必须**细到可以脱离正文判断相关性**——problem、root cause、solution 三段都要在。

**`skill-impact.md`（治理闭环的记忆本体）每一条记录**：提案元数据、目标技能名、**unified diff**、验证集得分 `R(T_val,k)`、结论 `a_k ∈ {Accepted, Rejected}`。作者明列三个用途：① 观察**完整的技能接受史**，使**被拒过的干预不会再被提出**；② 追踪前几轮提过什么、成没成；③ **识别跨迭代反复出现的错误**。这份台账由**外层 harness 程序化追加**（不是模型写的），这就是它可信的原因。

## 4. 写路径（固化）

**Algorithm 1（Appendix A.1，逐行读）**：

```
S_0 ← ∅, W_0 ← ∅
基线验证：T_val,0 ← rollouts(S_0)；R_best ← R(T_val,0)
for k = 1..K:
  if R_best = 1.0: break            # 早停
  # 1 推理：训练集 rollout（只带技能）
  T_train,k ← { τ_i ~ π(x_i; S_{k-1}) }
  # 2 分层抽样
  T_sample,k ⊂ T_train,k
  # 3 Wiki 维护：把轨迹编译进 wiki（增量补丁）
  W'_k ← M_WM(W_{k-1}, T_sample,k)
  # 4 技能提案：ReAct 智能体读 wiki + 按需读轨迹，产出原子提案
  P_k ← M_P(W'_k, S_{k-1}, T_train,k)
  # 5 应用（候选）
  S'_k ← Apply(S_{k-1}, P_k)
  # 6 验证门控
  T_val,k ← rollouts(S'_k)
  if R(T_val,k) > R_best:  S_k ← S'_k; R_best ← R(T_val,k); a_k ← Accepted
  else:                    S_k ← S_{k-1}; a_k ← Rejected   # 只回滚技能层
  # 7 审计：无论接受与否都追加（wiki 永不回滚）
  W_k ← Update(W'_k, P_k, R(T_val,k), a_k)
return S_K, W_K
```

**四个组件的分工与写入纪律**：

- **推理 agent（§3.2.1）**：条件于 `S_{k-1}` 跑多轮轨迹；**全部活跃技能整段注入 system prompt**（作者刻意如此：跟随前作，用 full-injection **消除"技能触发/检索失败"这个混淆变量**）。**训练期禁止读 wiki。**
- **Wiki Maintainer（§3.2.2，一次 LLM 调用）**：输入 = 上一版 wiki 全文 + 抽样轨迹；做**失败根因分析**、抽取**成功策略**；**增量补丁式编辑**（append / replace / insert_after）维护 `patterns/`；**只要模式被改就同步重写 `index.md`**，并把本轮发现追加进 `log.md`。**每轮创建/更新多少个模式没有硬上限**，由 Maintainer 按证据自行决定。
- **Skill Proposer（§3.2.3，多轮 ReAct）**：初始**只**拿到 `wiki/index.md` + `skill-impact.md` + 训练集判分摘要（pass/fail、预测、真值），然后**自己用 `read_file` 按需翻具体模式页与原始轨迹**（作者明写这样做的理由是**避免上下文窗口耗尽**——不给固定预抽样轨迹）。每轮产出**一个原子提案**：新建一个技能，或对**某一个**已有技能做增量补丁。规则里两条硬约束：**必须先读 wiki、不得重复已被拒的方案**；**提出改动前必须至少读 4 条执行轨迹**。
- **门控与回滚（§3.2.4）**：`S'_k = Apply(S_{k-1}, P_k)` → 在验证集上评测 → **`R(T_val,k) > R_best` 才接受**，否则丢弃候选、把技能集还原到 `S_{k-1}`；`R_best` 初值是空技能集的基线分。**wiki `W_k` 无论接受与否都不回滚**（原话：accumulated patterns and logs persist across all iterations to ensure long-term knowledge retention）。
- **抽样的预算纪律（Appendix C）**：每轮**最多 8 条轨迹**，分层为**最多 5 条失败**（做根因分析）+ **最多 3 条成功**（提取有效策略、防止把本来能用的行为改坏）；**每条日志注入前截断到 15,000 字符**。

## 5. 读路径（检索）

**必须如实说：本文基本没有读路径。**这是全文最重要的"缺口自知"：

- 推理 agent **不做任何技能检索**——全部活跃技能整段注入。作者的理由是研究设计（隔离技能质量的混淆变量），并在 **Limitations 第一条**明确承认：`This setup does not evaluate skill retrieval or triggering, which becomes important as the number of available skills grows.`
- wiki 的读也**不是检索**：Maintainer 读整份 wiki 上下文；Proposer 读 `index.md` + `skill-impact.md`，然后**靠人（模型）写的索引描述**决定翻哪几页，再用 `read_file` 一页页读——**唯一的"排序信号"就是索引那一行的质量**。这也是为什么作者把索引描述质量列为 CRITICAL。
- 找文档的机制里唯一实现层的事实（仓库）：`read_file()` 把逻辑别名 `traces/x` 重写为 `raw/traces/x`，无扩展名时自动补 `.json`；路径逃出 root 抛 `PermissionError`；**每次读取的观测截断到 4,000 字符**。

⇒ 对我们最有价值的判断是**反向**的：**它把"技能检索"整块留白，而我们已经有这一块**（统一 BM25 + hook 字段加权 + coverage 弱信号 + 边界硬门控 + `note_strategy` 的状态即权限）。它值得学的是"索引行必须自带 problem/root cause/fix"，而不是它的检索架构。

## 6. 组织与关系

- **组织粒度**：一个**失败模式/成功策略** = 一页 10–30 行的 markdown；一个**全局索引**（一行一条，链接到页）；一个**技能目录**把若干模式收敛成一段可执行过程性知识。
- **两种关系被显式记录**：
  1. **技能 → 模式（溯源）**：`PURPOSE.md` 的 `Patterns Addressed` 明确写"这个技能是为了落实哪些模式页而存在"，`Evolution History` 记它的修改史。这是**产物到知识**的边。
  2. **提案 → 结果（审计）**：`skill-impact.md` 的每条记录把"改动 + 得分 + 接受/拒绝"绑在一起，形成**跨迭代的可比时间序列**。这是**决策到后果**的边。
- **层级导航**：`index.md`（有什么）→ 模式页（是什么/为什么/怎么做）→ 轨迹（原始证据）→ 技能（可执行产物）。作者强调索引行是这条链的**唯一入口**。
- 案例（§5.3, Figure 3，Qwen-3.6-27B 在 ALFWorld）：Iteration 0 Maintainer 发现 `take-examine-move-loop.md`，Proposer 提 `goal-directed-action` → **验证集没提升，被拒**，但 `skill-impact.md` **留下了提案 diff 与拒绝结论**；Iteration 1 Proposer **读到这条审计**，改提 `break-repetition-loop`（含具体动作规则 "Never Return an Item to Its Origin Location"）→ **接受**；随后 rollout 中出现新的循环变体，Maintainer 累积 `multi-operation-loop.md`；Iteration 4 Proposer 依据累积模式**再精修**该技能（新增 "Each Operation Type ONCE Per Item"）。**这个案例是全文的论点本身：被拒的提案没有消失，它变成了下一次提案的约束。**

## 7. 维护与自改进

- **维护者是"知识层"的唯一写者**，且是**增量补丁**而非重写（append / replace / insert_after，target 必须是原文的**精确子串**）；每次修改都要**同步更新索引**并**追加日志**。
- **自改进的机制是"知识累积 → 产物增量更新"**，而不是"产物自我迭代"：`S_k` 由 `W_k` 驱动，`W_k` 永不回滚，所以**每一次失败的尝试都以"负知识"的形式留在系统里**。
- **精修是持续的、不是一次性的**（Table 5）：被接受的技能更新中，**初始两轮只占 39%–52%**，中段（Iter 2–4）与后段（Iter 5–7）合计 48%–61%；SealQA 上后段占 28%。作者据此论证持久知识支撑**持续精修**。
- **演化产物形态的统计**（Table 4）：技能 45.1–142.5 行（Gemma-4-31B 最短 45.1，SpreadSheet 最长 142.5）；模式页平均 18.1–48.2 行，每模型创建 6.3–8.9 页、编辑 7.0–18.4 次。⇒ **模式页确实被反复编辑，而不是一次性写完**。
- **⚠️ 已知缺口（作者自陈，Limitations 第三条）**：`WikiSkill currently lacks an automated mechanism to prune the wiki`——模式页、日志、提案 diff **无限累积**，长期跑下去需要裁剪。**这是本文对我们最有用的"作者亲口说没解决"的一处**（我们正相反：我们的问题常常是**不敢删**、而不是**不会删**）。

## 8. 验证与质量门控

- **唯一的门是验证集分数**：`R(T_val,k) > R_best` 才接受；`R_best = max(R_best, R(T_val,k))`；`R_best = 1.0` 早停。**这是一个严格单调门**——作者自己在 Limitations 第二条承认它**排除了"当下中性、后续才见效"的提案**（`excludes neutral proposals that preserve immediate performance but could enable gains in subsequent iterations`），并说更灵活的接受判据是未来工作。
- **验证集规模都偏小**（Table 6：LiveMath 18 / SealQA 10 / SpreadSheet 40 / OfficeQA 24 / ALFWorld 18 条），作者明说这会给门控判定引入噪声，因此**整套演化流程独立跑 3 次、报 3 个演化后技能集的平均测试分**；显著性用 **paired bootstrap（1,000 次迭代，p < 0.05）**，跨基准用**分层宏平均 bootstrap**；"并列最优"的判定规则也写明了（不显著优于次优就不算唯一最优，而是**统计并列**并一起加粗）。**这是本文方法学上最值得我们抄的一处**（它把"看起来更好"和"真的更好"分开处理）。
- **谁有权改**：技能层可被提案改、可被门控回滚；**知识层没有任何"谁能改、能改到什么程度"的校验**——模式页长度（10–30 行）、去重、索引行格式**全部只是 prompt 里的文字要求，代码层零校验**（仓库侧同样零校验：`patterns/*.md` 直接 `open(name,"w")` 覆盖写）。
- **我们的对照物明显更严**（这点要写进评估）：我们的体检有**结构校验**、**越权升级检测**（`verified` 高于 `single-source` 却没有 `verified_by` 凭据 ⇒ 点名要求重判）、**接地门**（候选策略卡缺 `source` 不得 promote）。**本文反过来印证了这套纪律的方向是对的**——它自己在"知识层无校验"上留了洞。

## 9. 成本 / 安全 / 隐私

- **成本**（Appendix D.2, Table 7）：每轮优化器 LLM 调用数 `C_WikiSkill = (1 + T_ReAct)·N_train/B`；他们用 **full-batch（B = N_train）**，所以 `C = 1 + T_ReAct`，**与训练集大小无关**，`T_ReAct ≈ 10–20`（ReAct 轮数）。对照：EvoSkill `O(N_train/B)`、SkillOpt `O(K_opt·N_train/B)`（K_opt≈6–8）、Trace2Skill 下界 `O(N_train)`（每条轨迹一次独立 LLM 调用）。**作者诚实地指出**：常数调用数在有些数据集上**推理成本更高**，只是换来一致的性能提升。
- **计算环境**：5 个模型，闭源 Gemini-3.5-Flash；开源 Qwen-3.5-4B/9B、Qwen-3.6-27B、Gemma-4-31B（vLLM 部署）。**没有报告 token 数、金额、墙钟时间**（仓库侧同样没有 token/费用计量——这是这条路线共同的空白）。
- **安全/隐私**：**全文没有讨论**。没有提到沙箱、权限、提示注入、跨用户隔离。工具面是基准给定的（bash / web_search / read_file / glob+grep+read / 模拟器动作空间）。仓库侧我实测到一处实现级放行风险（`create_patterns` 的名字未做路径净化，可含 `../`；`update_patterns` 目标不存在时静默跳过），但我们**不引它的代码**，只把它作为"自己的路径锚定纪律（`pathIsInside`）值得保留"的反面例子。
- **规模有界**：raw 层靠 15,000 字符截断 + 8 条抽样"有界"，**wiki 层明确无界**（无裁剪）。

## 10. 关键数字 / 阈值

| 项 | 数值 | 出处 |
|---|---|---|
| 抽样上限 | 每轮 ≤ 8 条（≤5 失败 + ≤3 成功） | Appendix C |
| 单条日志注入截断 | 15,000 字符 | Appendix C |
| ReAct 轮数 `T_ReAct` | 约 10–20（仓库实现取 15 为上限） | Appendix D.2 |
| 提案者必读轨迹数 | ≥ 4 条执行轨迹（prompt 规则） | Appendix E.3 |
| 模式页长度 | 10–30 行 | Appendix E.2 |
| 门控判据 | `R(T_val,k) > R_best`（严格大于）；`R_best ← max(...)`；`R_best=1.0` 早停 | Eq. 4 / Alg. 1 |
| 独立重复次数 | 3 次完整演化，报平均测试分 | §4.2 |
| 显著性 | paired bootstrap 1,000 次，p < 0.05 | Appendix C |
| 技能长度 | 45.1–142.5 行（均按 markdown 行数） | Table 4 |
| 模式页长度/数量 | 平均 18.1–48.2 行；每模型创建 6.3–8.9、编辑 7.0–18.4 | Table 4 |
| 接受更新的时间分布 | 初始两轮 39%–52%，中+后段 48%–61% | Table 5 |
| 优化器调用复杂度 | `(1 + T_ReAct)·N_train/B`，full-batch 时 `O(1)`（对 `N_train`） | Table 7 / Eq. 5 |
| 数据划分（train/val/test） | LiveMath 35/18/124；SealQA 16/10/85；SpreadSheet 80/40/280；OfficeQA 50/24/172；ALFWorld 39/18/134 | Table 6 |

**消融与主结果（都是我们要引的数字）**：

- **Table 3（Gemini-3.5-Flash，知识层消融）**：`No skill 40.4` → 只有提案者可读 wiki（**默认**）**63.7** → 提案者+推理 agent 都可读 wiki **60.9** → 提案者可读、无 Maintainer（不累积）**48.7** → 推理 agent 可读、提案者不可读 **45.3**。
  - **+15.0**（48.7 → 63.7）：持久知识累积的净贡献（LiveMath 51.3 → 72.6；SpreadSheet 49.9 → 76.6）。
  - **−2.8**（63.7 → 60.9）：训练期给推理 agent 开 wiki 是**有害**的（LiveMath 72.6 → 64.8，−7.8）。
- **平均分（Table 1）**：WikiSkill 在 5 个模型上都是最高；相对各模型最强基线的增益 +3.3（Qwen-3.5-4B）/ +5.1（9B）/ +10.0（27B）/ +5.8（Gemma-4-31B）/ +12.0（Gemini-3.5-Flash）。
- **规模互补**：Qwen 家族平均增益 **+12.3 / +17.5 / +23.9**（4B / 9B / 27B）；**Qwen-3.5-9B 带技能 47.4% > Qwen-3.6-27B 不带技能 39.4%**。
- **跨模型迁移（Table 2）**：ALFWorld 上 Qwen-3.5-9B 用 27B 演化的技能 **70.2** vs 自演化 **63.4**；OfficeQA 上 4B 的技能**对它自己有害**（30.2 → 28.5）却把 27B 从 42.1 抬到 **52.9**。
- **负迁移（§4.2.2）**：4B 的技能把 Gemini-3.5-Flash 在 SpreadSheet 上从 **50.5 打到 18.1**；两个诱因——**底层 workaround 硬化**（"必须单行 Python"、"逐步转字符串"，束缚了强模型的端到端写法）与**碎片化诊断耗尽交互预算**（前置检查太多，强模型在完成任务前用完步数）。

## 11. 评估方法

- **测什么**：五个基准 × 五个模型，**演化产物在未见测试集上的平均分**（不是训练分）。所有方法的技能演化都从空技能集开始、增强后的技能在推理时注入 prompt——保证对比公平。
- **怎么保证不是噪声**：小验证集 → **3 次独立完整演化** + **paired bootstrap 显著性** + **跨基准分层宏平均**；并列判定规则写明（不显著优于次优 ⇒ 统计并列、一起加粗）。
- **消融怎么做**（这是本文最值得学的方法）：不是"去掉一个模块再跑一遍"，而是**构造 2×2 的知识访问矩阵**（推理 agent 能否读 wiki × 提案者能否读 wiki），并在"提案者不能读 wiki"时**同时移除 Maintainer**（于是持久累积这件事一起消失）。这样才能把"读了知识"和"有知识可读"分开。
- **迁移实验怎么做**：用 A 模型演化的技能去跑 B 模型，交叉出"源 × 目标"矩阵（Table 2），并**在矩阵里标出自演化对角行**以便对比。
- **定性分析怎么做**：Table 4 统计技能/模式页的数量与长度（看"知识是否在长"），Table 5 统计接受更新的时间分布（看"精修是否持续"），再加一个**从被拒到被接受的案例追踪**（Figure 3）。
- **我们能借鉴的被动信号**：
  1. **"当前配置 vs 去掉它"的 2×2 矩阵**——我们做消融时常犯的错是"关掉一个开关跑一遍"，没法区分"没读到"和"没有可读"。我们的 `engine-probe.mjs` 可以照这个形状构造：**注入策略卡 vs 不注入** × **库里有这张卡 vs 没有**。
  2. **重放同一组查询 3 次**看结论稳不稳（我们目前所有探针都是单次）。
  3. **接受/拒绝的时间分布**——如果我们的体检建议长期只在"第一次"被采纳、之后全是重复，那就是"缺持久知识"的信号（对应 §12 的 W1）。
  4. **产物长度的分布**（策略卡行数、records 行数）——本文用它证明"知识确实在长"。

## 12. 可迁移机制清单

编号 W1–W9，供跨论文汇总；每条注「改哪里 / 零 token 与否 / 是否依赖模型」。

- **W1（最高优先，零 token，纯确定性）— 治理台账：把"判定 + 依据 + 结论"追加成 append-only 审计文件。**
  照 `skill-impact.md` 的形状：每次体检/维护给出处置建议时，**追加**一条 `时间 + 对象（哪张卡/哪条索引）+ 动作（建议合并/收窄/归档/不处置）+ 依据（哪条判据、哪个数字）+ 结论（本次是否执行、为什么）`。**关键在"不处置也要记"**——我们目前只有"体检又报了一遍"这个现象，没有"上次为什么不改"的记忆，于是同一张 weak 卡可以连续几周被报、每次都被重新判断。落点：`memory-admin.mjs`（体检写入）+ 一处新的机器侧文件（例如 `cache/` 下的台账，或 `.deepseek/memory/audit-log.md`）。判据：构造同一张 weak 卡跑两次体检 ⇒ 断言台账有两条记录且第二条能读出"与第一条同一对象"；**这条同时是 `improvement-details` 第 5 项「增量回执」被延后时缺的那个"可比的上一份记录"**。
- **W2（零 token，纯确定性）— 索引行的三段式纪律 + 可检查性。**
  把「一行内写清 适用困难/场景 + 为什么有效（根因）+ 具体动作」写进 `strategy-readme.md` 与 `records-readme.md` 的模板纪律，并让体检做**确定性 lint**：`strategy/index.md`、`theorems/index.md` 的行若缺"为什么/怎么做"任一段 ⇒ 列入「索引行不合格」，给出改写建议。理由直接引本文：索引行决定读者要不要打开整页。注意**不要**引入新的行格式契约去推翻现有索引（现有格式是人写的导航行），只 lint 与提示。
- **W3（零 token，纯确定性）— 给证据注入加"截断标注"。**
  现在注入/检索返回的长内容被截断时，模型**不知道自己看到的是残片**。照 `[TRUNCATED: ...]` 的形状，在 `markCards`/passage 组装处显式标注截断位置与原文长度。这是诚实性问题，也直接影响模型对证据完整性的判断。
- **W4（零 token，需小设计）— 破坏性写入的"候选态 + 原子替换"。**
  照 `skills_staging` / `skills_checkpoint` 的形状：体检的自动动作（`autoArchive`、将来的合并/重写）先写**临时文件**，全部成功后再替换，中途失败保留原文件并**报告降级**（不是静默）。**必须补仓库没有的**：`.bak` 与失败回滚的显式断言。注意仓库那套有一个真实缺陷——`_init_workspace()` 每次构造都用**当前磁盘状态**覆盖 checkpoint，于是**崩溃后的中间态会被追认成 good**；我们要避免这个反向语义。
- **W5（零 token，模板纪律）— 给"模式页/卡片"一个量化长度上限。**
  本文的「10–30 行，不要写小作文」是**可确定性检查**的；我们的「原子化、不要整段总结」不可检查。落点：`records-readme.md` / `strategy-readme.md` / `vault-AGENTS.md` 各加一句量化上限，并让体检把超限卡列为「过长、需拆分」（**只报告不自动改**）。
- **W6（零 token，模板纪律）— 防御性检查必须条件触发，不能变成无条件前置清单。**
  负迁移的第二个诱因：碎片化的前置诊断耗尽交互预算。我们的对应风险是：策略卡的 `strategies[].move` 或模板的「建议先做 X 再 Y」被 agent 当成**每轮都跑的前置清单**，挤占本已有限的检索步数预算（AGENTS.md：一轮最多 1 次 `note_strategy` + 最多 4 步内容检索）。落点：把「预算是硬约束」从 AGENTS.md 也写进 `strategy-readme.md`，并在模板里要求每个 `move` 标注它的**触发条件**（而不是"总是先做"）。
- **W7（零 token，模板纪律）— 技能/策略只写高层程序性策略，不写语法级 workaround。**
  对应负迁移的第一个诱因与本文的"技能迁移"结论：写死底层 workaround 的技能会**束缚更强的执行者**。我们的 `abstraction` 三段（concrete / principle / generalize）方向已经一致，建议明确一条纪律：**`concrete` 段不得包含具体算子/记号的硬编码结论**（那属于 `theorems`/`notation` 层），并把它与「策略卡只写过程骨架」的边界写在一起。
- **W8（零 token，文档）— 把"知识层与产物层分离"写成设计正当性。**
  我们的 `records/topics/theorems/notation`（知识层，长期、不随某张卡失效而消失）与 `strategy`（产物层，可 promote/demote/rewrite）事实上已经分离，但**文档里没有把这条上升为设计原则**。可写进 `docs/memory/design.md`：引本文的三层物理分离与「wiki 永不回滚、技能可回滚」，说明我们为何 `superseded` 而不删除、为何策略卡改写不该带走支撑它的事实。
- **W9（记录 / 评估方法，零 token）— 2×2 消融形状 + 三次重复。**
  把 `engine-probe.mjs` 的消融从"关开关"改成**「注入 vs 不注入」×「库里有 vs 没有」**，并对同一组查询**重复 3 次**报稳定性。理由见 §11。**不要**在受限环境跑 live 部分（AGENTS.md §4 要求先问用户）。

## 13. 与 dsh-math-memory 的映射与差距

（现状引自 `docs/memory/design.md`、`docs/memory/strategy-layer.md`、`dsh/templates/vault-AGENTS.md`、`dsh/templates/records-readme.md`、`dsh/templates/strategy-readme.md`、`dsh/preset/math-memory.mjs`、`dsh/host/memory-admin.mjs`）

| WikiSkill | 我们的现状 | 判定 |
|---|---|---|
| raw 层（不可变轨迹） | `memory/episodes/YYYY-MM-DD-*.md`，append-only、原话保留；`records.source` 必指 episode | **已有**，且我们的溯源纪律更严（我们要求 `source` 必填，它只要求"高层可访问轨迹"） |
| **wiki 层 = 持久知识（模式页 + 索引 + 日志 + 审计）** | `records/`（可复用事实/技巧）+ `topics/` + `notation.md` + `theorems/index.md`；**没有**"永不回滚的审计台账" | **部分实现**。知识容器已有，**缺 W1（判定台账）**——这正是"同一张卡被反复报、无人记得上次为什么没改"的根因 |
| **模式页写法（问题 + 根因 + 确切做法 + 10–30 行）** | `records` 的 `hook` 块（operator/pattern/heuristics/techniques/applications）+ 正文；长度无纪律 | **部分实现** ⇒ 采纳 W5、W2（量化上限 + 索引行三段式） |
| **`skill-impact.md`（diff + 得分 + Accept/Reject，程序化追加）** | 无对应物。❌ 反馈只改 `success_rate`/`verified`/`gain`/`harmed`；**"为什么没改/改了什么"不留痕** | **缺（本文最该补的一条）** ⇒ W1 |
| skills 层（`SKILL.md` + `PURPOSE.md` 溯源） | `strategy/<slug>.md`：`difficulty`/`domain`/`strategies[].move`+`retrieve`/`abstraction`/`not_applicable_when`/`provenance`/`status`；**`provenance` 是枚举（user/agent/both），不是"落实到哪些模式"的链接** | **部分实现** ⇒ 可考虑让策略卡显式指回它落实的 `records`/`theorems`（这与 MSCE 研读里的"证据锚点 A"是同一条，见下） |
| 增量补丁编辑（append/replace/insert_after） | 我们是"读整文件 → 改 → 写回"，无补丁语义 | **不适用/不需要**——我们的写入者是插件（确定性），不是模型；但**人类手改**这一点与仓库的三级容错 patch 动机一致 ⇒ 只取 W4（原子替换），不取 patch 引擎 |
| 严格门控 `R_val > R_best` + `max` 单调 + 早停 | `note_strategy` promote 门（`uses ≥ 3 且 success_rate ≥ 0.6` + 接地门 + `gain`）；体检的 weak/archive 判据 | **已有且更丰富**（我们的门数更多、信号更多）。**但**我们的"验证集"是**用户反馈**（✅/❌），比它的 18 条验证集**更稀疏** ⇒ 它的严格单调门不可照搬（我们的 `gain` 已经用"only explicit ✅/❌"回避了这个问题） |
| 跨模型迁移 / 技能与规模互补 | 单用户单模型（vault 里的记忆属于这一个用户/一个模型生态） | **不适用**（但"技能可迁移"这一点在我们的"多模型共用 vault"场景里可能有一天成立，现在不评） |
| 训练期推理 agent 禁读 wiki（−2.8 分） | 我们**故意**全注入（topics/notation/theorems/strategy 都进上下文） | **方向相反但判据有用**：它度量"技能本身够不够好"，我们度量"这一轮答得对不对"。**要记的是它的判据**——凡让模型直接在会话里读原始素材的动作，都会降低**蒸馏产物**的质量（反对把 `episodes` 原文注入） |
| 模式页无裁剪机制（作者自陈限制） | 我们有 `archive/`、`superseded`、`autoArchive`（默认 off）、`unused` 检测 | **我们领先**，且本文正好印证"不裁剪会累积"是真问题 ⇒ 可把我们的归档路线与它的缺口的对照写进文档（行动：不需要改代码） |
| 检索/触发（本文明确不评） | `note_recall`（统一 BM25 + hook 加权 + coverage + 边界硬门控）+ `note_strategy`（difficulty 主匹配 + 状态即权限 + ≤4 步迭代检索） | **我们领先** ⇒ **不要**因为它的"三层"去重写检索（与 MSCE 研读结论一致） |
| 五个推理 agent prompt / 五项基准 / 工具环境 | 单用户数学学习场景 | **不适用**（但它的 prompt 结构值得当"协议文本写法"的参照） |
| Wiki Maintainer + Skill Proposer 两个 LLM 算子 | **零模型调用是红线**（插件不调模型，design.md §9） | **不适用** ⇒ 只取"它们产出的**文件契约**"与"判定由代码做"的形状 |
| 验证科学：3 次重复 + bootstrap 显著性 + 统计并列 | `engine-probe.mjs` 单次运行、无重复性度量 | **缺** ⇒ W9（重复 3 次看稳定）；**bootstrap 在我们的小样本上不适用**（我们的"样本"是几十条合成用例），只取"重复 + 并列"的思想 |
| AI Disclosure（LLM 参与写作） | 我们文献卡有"摘要为改写时须标注"的纪律 | **已有**（同类纪律） |

## 14. 行动项

供跨论文汇总（与 `notes/wikiskill-intake-2026-09-17.md` 的采纳清单一致；每条给「改哪里 / 判据 / 是否零 token」）。

**W1（最高优先，零 token，纯确定性）— 治理台账（"判定 + 依据 + 结论"append-only）。**
- 改哪里：`dsh/host/memory-admin.mjs`（体检产出处置建议时写入）+ 一处机器侧落点（建议 `cache/memory-audit-log.jsonl` 或 `.deepseek/memory/audit-log.md`，需拍板：**jsonl 便于身份级比对，md 便于人读**）；`docs/memory/design.md` 补一节。
- 做什么：每条 = `时间 + 对象 + 动作 + 依据（判据与数字）+ 结论（执行/不执行 + 理由）`；**"不处置"必须落盘**。体检在生成建议**前**先读它，对同一对象已给过结论且依据未变的情况，标注「与上次判定一致」而不是重复报。
- 判据：`scripts/test-memory.mjs` 加断言——同一张 weak 卡连跑两次体检 ⇒ 台账两条、第二条可关联第一条；把台账读入关掉 ⇒ 断言必须失败（变异验证）。
- 风险：**不要把它做成"每轮新增必做步骤"**（`design-intake` R1 的教训：机制没人用比没机制更糟）。它必须全部由体检自动写，模型零负担。

**W2（零 token）— 索引行三段式 + 确定性 lint。**
- 改哪里：`dsh/templates/strategy-readme.md`、`dsh/templates/records-readme.md`（纪律）+ `memory-admin.mjs`（lint）。
- 判据：构造一行只有标题没有"为什么/怎么做"的索引 ⇒ 断言体检把它列进「索引行不合格」；补齐后断言消失。

**W3（零 token）— 截断标注。**
- 改哪里：`dsh/preset/note-tools.mjs`（passage/卡片组装处，截断时追加显式标记）。
- 判据：构造超长卡 ⇒ 断言返回文本含截断标记与原文长度；标记缺失则断言失败。

**W4（零 token，需小设计）— 破坏性写入的候选态 + 原子替换 + `.bak`。**
- 改哪里：`dsh/preset/math-memory.mjs` / `dsh/host/memory-admin.mjs`（`moveCardsToArchive` 等）。
- 判据：注入一次写入失败 ⇒ 断言原文件仍在、报告为降级（**不是**静默成功）。**明确避免**仓库的 checkpoint 缺陷：不要用"当前磁盘状态"覆盖 known-good。

**W5 / W6 / W7（零 token，模板纪律一组）— 量化长度上限 / 防御性检查须条件触发 / 不写语法级 workaround。**
- 改哪里：`strategy-readme.md`、`records-readme.md`、`vault-AGENTS.md` §5（**改了模板要重建 `main.js`**，AGENTS.md §3 铁律 1）。
- 判据：模板完整性门禁 + `check-doc-consistency.mjs`；W5 另加体检的"过长卡"检测断言。

**W8（零 token，文档）— 把"知识层 / 产物层分离 + 知识层不回滚"写成设计正当性。**
- 改哪里：`docs/memory/design.md`；引本文 Table 3 与三层结构。
- 判据：文档一致性守卫；引用数字与本文一致。

**W9（零 token，评估方法）— 2×2 消融形状 + 三次重复。**
- 改哪里：`scripts/qa/engine-probe.mjs` + `docs/memory/testing.md`。
- 判据：探针输出结构变化 + 文档同步；**live 部分不跑**（AGENTS.md §4）。

**不采纳（写明理由，防后续重复讨论）**：Wiki Maintainer / Skill Proposer 两个 LLM 算子（红线）；五项基准与其工具环境；多轮 ReAct 提案循环；把全部技能整段注入的 full-injection（我们的注入预算是有档位的）；RobustPatchEngine（我们的写入者是插件，不需要容错补丁；人类手改的风险由 W4 的原子替换覆盖）；仓库的 checkpoint 实现（有"中间态被追认成 good"的缺陷）。
