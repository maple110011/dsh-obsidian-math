# 研读记录：LeanDojo（Theorem Proving with Retrieval-Augmented Language Models）

## 0. 元信息

- citekey / 标题 / 年份：yangLeanDojoTheoremProving2023 / LeanDojo: Theorem Proving with Retrieval-Augmented Language Models / 2023（NeurIPS 2023；作者 Kaiyu Yang, Aidan M. Swope, Alex Gu, Rahul Chalamala, Peiyang Song, Shixing Yu, Saad Godil, Ryan Prenger, Anima Anandkumar；Caltech + NVIDIA + MIT + UCSB + UT Austin；https://leandojo.org）
- 阅读日期：2026-09-18
- 阅读方式：MinerU 全文 `.raw/yangLeanDojoTheoremProving2023/full.md`；正文与实验精读 1–190 行，附录精读 413–788 行（A.1 premise 抽取 / A.2 交互可靠性 / A.3 工具对比 / B 数据集格式与 datasheet / C.1 超参 / C.2 GPT-4 baseline / C.3 不与他作比较的理由 / C.4 MiniF2F 与 ProofNet / D Lean 4 / E ChatGPT plugin / F 局限），191–412 行为参考文献，跳过。
- 交叉核对：同目录另有 `full.txt`（pdftotext -layout），本笔记的关键数字（21.1 / 1.4% / 33,160 / 2.13 / 130,262 / 217,776 / 129,243 / 102,514 / 213,067 / 152,695 / 2,300 / 26.5 / 13.8 / 48 等）已与 `full.txt` 逐条核对一致。
- 与本仓库的关系：本仓库场景是「Obsidian 数学笔记的正确性审查」（不调模型优先、fail-closed、`verified` 三级 + `verified_by` 凭据 + 体检查越权升级）。LeanDojo 的价值不在证明了什么，而在**它如何让「验证」这件事由一个确定性裁判（Lean kernel）承担，且把 AI 的输出限制在「提案」一侧**。§8 / §12 按这个角度写。

## 1. 一句话定位

LeanDojo 把「LLM 证定理」从私有复现不了的状态，变成开源 toolkits + data + models + benchmarks：数据抽取（file dependencies + AST DAG；每条 tactic 及其前后 state；每条 premise 的**全名、定义位置、使用位置**）+ 可靠的 Lean 交互环境（两个原语）+ 一个带挑战性切分的 benchmark（98,734 定理）；配套 ReProver 用 DPR 检索 premise 后交给 ByT5 生成 tactic，单卡 5 天训练即在 Lean 3 benchmark 上 Pass@1 51.2%（random）/ 26.3%（`novel_premises`）。

## 2. 问题与动机

- LLM 定理证明的复现壁垒：据作者所知此前的 LLM prover **无一开源**（第 20 行）；全部使用私有预训练数据；算力可达**上千 GPU days**；部分依赖自研的分布式训练与 proof assistant 交互基础设施，没有开源代码就无法完整复现（第 20 行）。C.3 进一步列明不可比的原因：数据是两年多前的旧 mathlib、Lample et al. 的合成数据 Equations 不公开、全部方法都在 PACT 辅助任务上 co-train（数据/算力贵一个数量级）、Polu et al. 与 Lample et al. 还用与 Lean 在线交互采集的新证明继续微调（第 656–668 行）。
- 原始 Lean 代码不适合作训练数据：缺少人类在 Lean 里能看到的运行时信息（tactic 之间的中间 state），也无法直接看到前提信息（第 75 行）。
- 数据抽取工具也是瓶颈：Lean 官方能导出 dependencies / AST / states / tactics，但**不能解析 premise 全名、不能定位定义位置**（第 83 行）；已有带 premise 的数据集（如 Magnushammer、HOList 一侧）抽取工具不公开，构造新数据集困难（第 52 行）。
- 交互工具不可靠：此前唯一成熟的交互工具 lean-gym 把 **21.1%** 的正确人类证明误判为 incorrect（第 24、115 行），既低估评测成绩，又给 RL 提供噪声反馈（第 448 行）。
- premise selection 本身是被公认的瓶颈（第 26、48、69 行）：库里定义与定理数十万条，全塞进模型上下文装不下，纯记忆只在「训练时见过相似目标」时有效，遇到真正新场景（需要训练中没见过的引理）就不泛化（第 30 行）。

## 3. 记忆结构

三类记录，全部离线抽自 Lean 源码：

1. **文件依赖图（DAG）**：节点是文件，边是 import 关系；外加每个文件的 AST。用途是程序分析——「某文件定义了哪些定理」「某定理可达哪些 premise」（第 77 行）。
2. **proof tree**：抽取**全部** tactic，并记录每条 tactic 之前与之后的 state，从而重建图 1 左上那种以初始 state 为根、tactic 为边、直到所有 goal 解完的树（第 16、79 行）。
3. **premise 语料**：`corpus.jsonl` 共 3,280 行，一行对应一个 Lean 文件；每个 premise 记录 `full_name` / `code` / `start`–`end`（行列 span）/ `kind`（如 `class` / `definition`），并带该文件的 `imports` 列表（第 480–506 行）。规模 130,262 条，含 theorem 也含可作 premise 的 definition（第 85 行）。

记录与记录之间的边有两种，这是全篇最有用的一点：

- **定义位置**：premise 在哪定义（例如 `def_path: src/analysis/special_functions/trigonometric/basic.lean`、`def_pos: [122, 7]`，见第 524–525 行的 JSON）。
- **使用位置**：premise 在哪被用——用 HTML-like 串标注在 tactic 文本里（`linarith [<a>pi_pos</a>]`），随后跟一个 `provenance list`，列表元素逐个对应 tactic 里用到的 premise（第 508 行）。

命名层：每条 premise 有唯一完全限定名（`nat.mod_self`），但人类写的是短名（`mod_self`），靠 Lean 的 name resolution 消歧；LeanDojo 把解析前后都记下来（第 81、436 行）。

规模与切分：98,734 条 theorem / proof，来自 3,384 个 Lean 文件；217,776 条 tactic，其中 129,243 条至少带一个 premise；**带 premise 的 tactic 平均 premise 数 2.13**（第 85 行）。train/val/test = 94,734/2,000/2,000（第 103、478 行）。抽取自 mathlib commit `19c869efa56bbb8b500f2724c0b77261edbfa28c`（2023-10-11 发布，第 554 行）。

## 4. 写路径（固化）

- **离线一次性构建，无增量学习**。写路径只有一条：用打过 patch 的 Lean 构建 repo → 导出 → 后处理成 JSONL（第 574 行）。整库更新即重跑构建。
- 为了让「写」能拿到 premise 信息，作者**改了 Lean 本身**：Lean 的 name resolution 属于 **elaboration**，发生在 parsing 之后、trusted kernel 校验之前；它把用户写的、简略且有歧义的 **pre-expression** 转成 kernel 可查的完整 expression（第 438 行）。LeanDojo 拦 elaborator 的输入与输出（第 440–442 行）：
  - 输入 pre-expression：包含 premise 在证明中**被使用的位置**；
  - 输出 expression：包含 premise 的**全名**与**定义位置**；
  - 位置统一是 span：文件名 + 起止 row/column（第 444 行）。
- 修改以 **Git patch** 形式提供，可自动应用于 **2022-03-24 之后**的任何 Lean 3 版本（第 444 行）。这也解释了为什么只能抽取该日期之后的 repo（第 658 行）。
- **写入纪律的关键一条**：打了 patch 的 Lean **只用于数据抽取，不用于评测**（第 83 行）。因此不会因为改 Lean 而意外破坏 Lean 的逻辑可靠性——抽出的是元数据，裁判仍是原版 kernel。
- 切分策略是写路径的一部分，两条并存：`random` 与 `novel_premises`。后者的约束不是「测试定理名字没出现」，而是**测试证明至少要用一个训练中从未被用过的 premise**；等价表述：若 `conj_mul` 出现在训练集某定理里，另一条用它的定理也必须留在训练集（第 105 行）。动机见图 3：最后两条定理不仅长得像，**证明完全相同**，随机切分下模型靠记忆即可「证出」看似不平凡的定理（第 101–103 行）。

## 5. 读路径（检索）

- Retriever 基于 DPR：query 是当前 state，候选池是 premise 集合，取 cosine similarity 最高的 top-m（第 121 行）。打分函数取 Transformer encoder + average pooling（第 123 行）。
- **效率设计**：premise embedding 全部预计算，query 侧只需**一次 forward pass**；**不做 rerank**（第 125 行）。论文给了明确理由：像 Magnushammer 那样 rerank 要对每条被检索的 premise 各跑一次 forward，成本高（第 125 行）。这是「预算换精度」的显式取舍，不是遗漏。
- **约束一：只从 accessible premises 检索**。候选 = 同文件内定义在该定理之前的 + import 进来的。可达集靠 LeanDojo 的程序分析（依赖 DAG + AST）算出（第 133 行）。全库 130,262 条，而**平均 accessible 仅 33,160**，检索任务因此显著变简单（第 34、133 行）。
- **约束二：in-file negatives**。DPR 依赖负例质量；早期全随机采负例时，模型常错误地取到**同一文件里的另一条 premise**。改法是每个样本采 3 个负例，其中 **1 个 in-file 负例**（第 135、620 行）。消融显示这项改进带来的收益不如「可达约束」大但稳定（第 155 行）。
- 生成：检索到的 premise 与 state **字符串拼接**后喂 ByT5（encoder-decoder，直接吃 UTF-8 字节、无 tokenizer），最小化对人类 tactic 的交叉熵（第 137、618 行）。训练时对检索到的 premise 施加 **dropout 0.5**（避免生成器过度依赖检索、学会「隐含记忆 vs 显式检索」的取舍），输入截断到 **2,300 token**（第 620 行）。
- 检索评测：只对至少带一个 premise 的 tactic 做 premise selection；query 是 tactic 之前的 state，检索 100 条，报 R@k 与 MRR（第 145 行）。

## 6. 组织与关系

- 三层导航，从粗到细：**import DAG（文件级）→ AST（文件内定义位置）→ proof tree（一条证明里的 state/tactic 序列）**。要回答「哪条 premise 对该定理可达」，靠的是前两层的组合（第 77、133 行）。
- 别名层：`full_name`（`nat.mod_self`）是身份，短名是使用形式，中间由 name resolution 桥接。同一短名可对应多条 premise（`read` 曾同时有 `buffer.read` 与 `monad_reader.read`，见附录 A.2 的例子，第 452 行）。
- 记录级的「用在哪」是反向边：premise → 使用它的 tactic 位置（第 81 行）。这条边让「这条 tactic 用了哪条定理」可追溯，也让「哪条定理被谁用」可反向查询。
- 论文没有做「概念分类法/主题层级」，分类法只有 `kind`（`class` / `definition` / theorem 等，第 497、504 行）这一维。

## 7. 维护与自改进

- 维护手段是**可复现性而非自动演进**：代码 MIT、数据 CC BY 2.0、文档在 Read the Docs、模型权重放 Hugging Face Hub、数据托管在 zenodo（CERN），作者负责后续维护与联系（第 600–612 行）。
- 快照纪律：评测固定到具体 commit（Lean 3 版用 mathlib `19c869e…`，Lean 4 版用 mathlib4 `3ce43c1…`），数据版本随 commit 绑定（第 554、692 行）。
- 数据集自有 datasheet 一节，逐项声明用途、构成、采集过程、已知噪声（**AST 有少量导出错误，但影响不显著**，第 562 行）、分发与许可、维护与勘误（「Is there an erratum? No.」，第 604 行）。
- 改进来源可归因：靠消融（w/ all premises、w/o in-file negatives，第 155 行）而不是整体指标。
- 没有做：增量更新、自动剪枝、自动升格降格、把模型自证的新证明自动回写库（新证明只以 pull request 形式提交给 MiniF2F / ProofNet，第 674、678 行）。

## 8. 验证与质量门控

这一节按「谁有裁判权、裁判的输入输出是什么、失败长什么样、拒绝时给什么反馈」四个问题拆开写。

### 8.1 裁判是谁：kernel，不是模型

论文把形式定理证明定义为「代码生成的一个特例：**评测严格、模型没有幻觉余地**」（第 18 行）。原因不在模型，而在裁判是证明助手：每一条 tactic 由 Lean 检查，不通过就是不通过。对我们的直接含义：**只要我们能让裁判保持确定性，模型侧的胡说就只能在「提案」层造成噪声，不能在「结论」层造成污染**。

### 8.2 交互层的输入/输出契约（只有两个原语）

- `initialize(theorem)` → 返回 initial state：一个字符串，表示当前 proof goals 与 local contexts；**有多个 goal 时把它们的字符串拼起来**（第 111 行）。
- `run_tac(state, tactic)` → 返回下一个 state。tactic 执行不成功（超时、不适用等）返回 **error state**；**若输入 state 本身已是 error，结果只能是 error**（第 113 行）。这一条是全篇最锋利的失败语义：错误状态**不可恢复、只会传播**，唯一出路是回到某个先前 state 换一条 tactic（ChatGPT plugin 的 `state_id` 回退就建立在这条上，第 715、723 行）。
- 覆盖范围：只支持 tactic 风格证明，作者声明任何证明都可转成 tactic 风格，因此不失一般性（第 109 行）。

### 8.3 环境的正确性本身是可靠性前提（附录 A.2）

这是本文对我们最有价值的一节，因为它证明：**检查器/交互层的实现错误，会伪造出「正确的东西不通过」这种假失败信号，而且量级极大**。

- 实测：用 Lean v3.42.1 + mathlib commit `6e5ca7d0097313e59f7533a42e3ea5197484c775`（两个工具都支持的版本），把 LeanDojo 抽出的全部 tactic 风格证明分别喂进两个工具。这些证明全都是正确的：lean-gym 失败 **21.1%**，LeanDojo 失败 **1.4%**，且 **LeanDojo 的失败是 lean-gym 失败的子集**（第 454 行，Table A 同数）。
- 根因具体到一行代码语义：lean-gym 构造的环境与人类原环境有微妙差异——**「打开 namespace」与「身处 namespace 内」不是一回事**：身处其中会让 Lean **优先 favour** 该 namespace 下的常量，打开则不会（第 452 行）。典型后果是短名解析错：`unfold read` 里的 `read` 本应解析到 `buffer.read`，在 lean-gym 的环境里被解析到 `monad_reader.read`（定义在 `init/control/reader.lean`），Lean 于是抱怨 `read` 不是 equational lemma（第 452 行）。
- 修法也是机制级的：LeanDojo **把交互代码包装成一条 Lean tactic，插入到证明中正确的位置**（不是在 IO monad 里跑独立程序），因此交互代码**必然**与人类原证明处于同一环境（第 452、468 行）。
- 残余失败的处理方式是透明度：剩下的 1.4% 在开源仓库里逐条记录示例，公开 LeanDojo 自身的局限（第 454 行）。

### 8.4 输出侧的质量门控：靠编译筛，不靠打分筛

- 每条 state 上用量 beam search 生成 **64** 个 tactic 候选，每个候选带 log-likelihood（第 622 行）。
- 搜索用 **best-first search**，state 的优先级 = **到达该 state 的 tactic 的 log-likelihood 之和**（不是平均、不是最大值）（第 622 行）。
- 关键推论（论文未明说但机制上是这样）：错误 premise 生成的 tactic 通常**编译不过**，因此在环境层就被消掉；打分只用来在**已经通过编译的**分支之间排优先顺序。假说不是被分数否掉的，是被编译器否掉的。
- 评测口径极严：**Pass@1**，只给一次尝试，墙钟上限 **10 分钟**（第 149 行）。

### 8.5 溯源即凭据：premise provenance

每条带 premise 的 tactic 在数据里存成 `annotated_tactic`：tactic 文本内用 `<a>…</a>` 标注用到的 premise，紧跟一个 provenance list，元素含 `full_name` + `def_path` + `def_pos`（第 508–528 行）。也就是说，事后可以精确回答「这条 tactic 用了哪条定理、那条定理定义在哪个文件的哪一行」。这是**机器可读的凭据**，而不是一句「据说用了某引理」。

### 8.6 反记忆的评测设计

`novel_premises` 切分把「测试证明必须至少用一个训练中从未被用过的 premise」写成硬约束（第 105 行）。效果是可见的：`tidy` 从 23.8 掉到 5.3、GPT-4 从 29.0 掉到 7.4、ReProver 从 51.2 掉到 26.3（第 161 行）。作者的主张：**挑战性切分上的成绩更能代表真实能力，应当在后续工作中被强调**（第 165 行）。反过来，随机切分上的分数有相当一部分来自记忆（图 3 的两条定理证明完全相同）。

### 8.7 拒绝时的反馈内容与权限边界

- 拒绝的内容不是「我不确定」，而是**具体的错误信息**：不适用/超时 → error state；名字解析错 → 明确的「`read` 不是 equational lemma」这类 kernel 报错（第 452 行）。反馈是可定位的、与代码位置相关的，所以能被用于改下一步。
- 权限边界在本文里是绝对二分：**模型只有提案权（生成 tactic / 生成 tactic + confidence），裁判权 100% 在 Lean**。论文没有「模型自评通过」这种通道。附录 E 恰好给了反面教材：ChatGPT 在 LeanDojo 明确返回 `proof_finished: False` 的情况下宣称定理已证出（第 779 行）——**模型的自我结论与裁判结论冲突时，以裁判为准，且这种冲突必须被识别为幻觉而不是分歧**。

### 8.8 对我们场景最该抄的一条：可达性约束是「物理上取不到」

检索只从 accessible premises 里取：同文件内定义在前的 + 已 import 的（第 133 行，原文第 69 行也强调「证明不能使用尚未定义的 premise，也不能使用未 import 进当前文件的 premise」）。不可达的 premise **根本不在候选池里**——这不是「提示模型别用」，而是结构上取不到。反面对照也给足了证据：改成从全部 premise 检索后，检索指标（R@1/R@10/MRR：13.5/38.4/0.31 → 11.7/36.2/0.27，novel 上 9.1/27.6/0.24 → 7.1/23.1/0.20，第 155 行）与定理证明（no-retrieval 之外，BM25 的 w/ all premises 更差：R@1 只有 1.9 / 2.1）全面下滑。

### 8.9 反面：检索层不保证「用得对」（含一处明确推论）

- 论文自己承认的三条边界：**不 rerank**（成本理由，第 125 行）；2,300 token 输入**只能装 10–15 条 premise**（第 756 行）；检索器在 `novel_premises` 上 **R@10 只有 27.6**（第 155 行）。
- **【我们的推论，非论文原话】** 检索失败**会被下游吸收为证明失败，但不会被误判为成功**。依据是 8.4 的机制：检索没给对 premise → 生成的 tactic 编译不过 → 环境返回 error → 该分支死掉，最终表现为 Pass@1 下降（26.3 而非 51.2），而不是虚高的成功率。这一条是本笔记对论文机制的外推，引用时须标明。

### 8.10 一条可直接搬到 vault 审计的对应关系

8.3 的教训换个对象就成立：**如果审计工具解析笔记的方式与笔记的真实使用方式不一致（frontmatter 边界判错、层级判错、别名解析错），审计会产出「正确的笔记被判为错」这种假问题**，而且这类假问题的量级可以很大（对应 21.1%）。因此在我们的场景里，「检查器实现本身的唯一性」不是工程洁癖，而是质量门控的前置条件——本仓库已有 `check-frontmatter-source.mjs` 禁止复制 frontmatter 正则，正是同一形状的防护。

## 9. 成本 / 安全 / 隐私

- 训练：单卡 A100 80GB **5 天**（≈**120 GPU hours**），对比前人 **>1000 小时**（第 139 行）。评测：**2 天 / 8×V100**（第 149 行）。batch size 8，前 2,000 步线性 warmup 后 cosine 衰减，最大学习率检索器 `1e-4` / 生成器 `5×10⁻⁴`，bfloat16 + DeepSpeed ZeRO Stage 2（第 620 行）。
- 模型：`google/byt5-small`，**299M** 参数，对比 837M / 600M（第 139 行）。选 ByT5 而非 T5 的理由是 Lean 代码大量使用 Unicode 数学符号，T5 的预训练 tokenizer 可能出问题（第 618 行）。**不用领域预训练、不用辅助数据（PACT）、不用与 Lean 在线交互采集的数据**（第 139 行）——作者把这三点列为「正交但会大幅增加复杂度与算力」的可选方向，故意不做。
- 推理侧预算：每步 64 个候选、10 分钟墙钟、检索 100 条 premise 一次 forward（第 125、149、622 行）。
- 受限/失败即止：`run_tac` 的错误语义使错误状态**不可继续**（8.2），搜索因此天然有界，不会在错误分支上继续烧算力。
- 隐私与许可：数据不涉密、不含个人通信（第 566 行）；数据集 **CC BY 2.0**，数据生成代码 **MIT**，抽取源 mathlib 与 lean 均为 Apache 2.0 并随数据附许可（第 592、612 行）。
- 已知污染：GPT-4 baseline 明确标注**存在数据污染可能**（很多证明在 GPT-4 数据截止 2021-09 之前就公开在 GitHub 上，第 151、652 行）；ChatGPT plugin 的研究同样标注污染可能与探索性（第 735 行）。

## 10. 关键数字 / 阈值

| 类别 | 数字 | 出处（full.md 行号） |
|---|---|---|
| 交互可靠性 | lean-gym 误判正确证明 **21.1%**；LeanDojo **1.4%**，且为前者的子集 | 24 / 115 / 454 / 470 |
| 对比环境 | Lean v3.42.1 + mathlib `6e5ca7d0097313e59f7533a42e3ea5197484c775` | 454 |
| patch 适用范围 | 2022-03-24 之后的任意 Lean 3 版本 | 444 |
| 抽取规模 | 98,734 theorems / 3,384 Lean files；130,262 premises；217,776 tactics（129,243 至少带一个 premise）；平均 2.13 premise | 85 |
| 切分 | train/val/test = 94,734 / 2,000 / 2,000 | 103 / 478 |
| mathlib commit | `19c869efa56bbb8b500f2724c0b77261edbfa28c`（2023-10-11） | 554 |
| 可达约束 | 130,262 → 平均 accessible **33,160** | 133 |
| 负例超参 | 每样本 3 个负例，其中 1 个 in-file | 620 |
| 检索指标（random / novel） | Ours 13.5/38.4/0.31 与 9.1/27.6/0.24；w/ all premises 11.7/36.2/0.27 与 7.1/23.1/0.20；w/o in-file negatives 10.8/33.1/0.25 与 7.9/25.7/0.22；BM25 6.7/17.2/0.15 与 5.9/15.5/0.14 | 155 |
| 定理证明 Pass@1（random / novel） | tidy 23.8/5.3；GPT-4 29.0/7.4；ReProver 51.2/26.3；w/o retrieval 47.6/23.2 | 161 |
| 生成超参 | premise dropout 0.5；输入截断 2,300 token；beam 64 候选；state 按 log-likelihood **之和**排序 | 620 / 622 |
| 评测口径 | Pass@1，单次尝试，墙钟上限 10 分钟 | 149 |
| 训练成本 | 5 天 / 单卡 A100 80GB ≈ 120 GPU hours（前人 >1000）；评测 2 天 / 8×V100 | 139 / 149 |
| 优化器 | AdamW，batch 8，warmup 2,000 步后 cosine；lr 检索器 1e-4 / 生成器 5e-4 | 620 |
| 模型 | google/byt5-small 299M（对比 837M / 600M） | 139 |
| MiniF2F | Pass@1 26.5%（非 RL SOTA 25.9%，RL 29.6%）；新证明 33 条；commit `5271ddec…` | 167 / 674 / 676 |
| ProofNet | Pass@1 13.8%（48/349，首个报告结果）；39/48 原本无 Lean 证明；3 条只有靠 premise retrieval 才能证出；帮助修正 7 个定理的形式化；commit `e8645aa8…` | 167 / 678 |
| Lean 4 | mathlib4 commit `3ce43c18f614b76e161f911b75a3e1ef641620ff`（2023-10-21）；102,514 theorems / 213,067 tactics / 152,695 premises | 692 |
| Lean 4 指标 | 检索 R@1/R@10/MRR = 12.8/34.7/0.29（random）、9.8/32.1/0.24（novel）；Pass@1 ReProver 48.6/19.9、w/o retrieval 44.5/16.2 | 702 / 706 |
| GPT-4 baseline | zero-shot；每次索要 **35** 条带 confidence 的 tactic，过滤无效后配 best-first；token 上限 **1,024** | 151 / 631 / 634 |
| ChatGPT plugin | 只暴露 `initialize_proof_search` 与 `run_tactic`；用 `state_id` 回退 | 715 / 718 / 723 |
| 上下文上限 | 2,300 token 只能装 **10–15** 条 premise | 756 |
| 许可 | 数据 CC BY 2.0 / 生成代码 MIT / 源 mathlib 与 lean Apache 2.0 | 592 |

## 11. 评估方法

- 两个任务分开测。**premise selection**：只用至少带一个 premise 的 tactic，query = tactic 前的 state，检索 100 条，报 **R@k**（top-k 召回）与 **MRR**（第 145 行）。**theorem proving**：Pass@1（单次尝试）+ 10 分钟墙钟，配 best-first search（第 149 行）。
- 每个方法在两条 split 上**独立训练与评测两个模型**（random 与 `novel_premises`），避免跨 split 泄漏（表 1 脚注，第 153 行）。
- baseline 分三类：无学习的 `tidy`（mathlib 里的启发式 tactic，第 151 行）；zero-shot GPT-4（35 候选 + best-first，第 151 行）；自身消融（w/ all premises、w/o in-file negatives，第 155 行）。**消融是改进归因的唯一手段**。
- 跨库外测用两个纯测试集：MiniF2F（奥数，commit `5271ddec…`）与 ProofNet（本科教科书习题，commit `e8645aa8…`）（第 672–678 行）。作者明确列出不可比的原因：交互工具不同会影响成绩、这两个集合没有训练定理、别人主攻 RL 而我们只比其非 RL 基线、Lample et al. 用 Pass@64 而我们用 Pass@1（跑一遍 MiniF2F 测试集已需一天）（第 676 行）。
- 我们能借鉴的**被动信号**：
  1. 「新证明」当产出量来报告（33 条 MiniF2F / 39 条 ProofNet 原本无 Lean 证明），并且**把新增贡献交回上游**（pull request），顺带暴露上游 7 个定理的形式化问题（第 674–678 行）——对应我们「审计发现问题并回写」的产出计数。
  2. 「只有靠检索才能证出」的案例单列（ProofNet 上 3 条，图 D，第 695 行）——这是**机制有效性**的直接证据，比总通过率更能说明作用。
  3. 分 split 报成绩（random vs novel），并要求自己关注差的那个（第 165 行）——对应我们「按来源/新近度分桶报命中与出错」。
  4. 明确标注污染与不可比（第 652、676 行）——我们的评测也应显式标注哪些指标受自证循环影响。

## 12. 可迁移机制清单

按「能否零 token 落到本仓库」排序，前 7 条是重点。

1. **候选池可达性约束（物理取不到，而非提示禁令）**。论文对应：不可定义、未 import 的 premise 不在候选池（第 69、133 行）。搬到我们这里：一条笔记/卡片可引用的证据范围应当是**可计算的封闭集合**——`source` 指向的 episode 必须存在、被引笔记必须在本 vault 内、且引用的定理必须在被引笔记中先于使用处出现。范围外的引用**不进入候选**，直接判 `unreachable`，而不是在提示里写「请不要引用不存在的笔记」。**零 token。**
2. **裁判与提案分离，且裁判的判定是二值的**。论文对应：Lean kernel 是唯一裁判，模型只生成 tactic（第 18 行）；`run_tac` 只回 state 或 error。搬到我们这里：插件的确定性检查（结构校验、`verified_by` 凭据、`unjustifiedUpgrade`、frontmatter-span 唯一实现）是裁判；模型的判断只能作为 `proposal` 落在报告里，不得写成任何 `verified` 等级。**零 token（裁判侧）。**
3. **错误状态不可恢复、只会传播**。论文对应：输入是 error 则输出只能是 error（第 113 行）。搬到我们这里：一次审计里，若某条基础事实被判 `unresolved`，任何以它为唯一支柱的结论都必须标 `blocked` 而不是「暂定通过」；不允许用下游的「看起来没问题」去覆盖上游的未决。这是 fail-closed 的机制化表述，且可机检。**零 token。**
4. **检查器实现一致性是质量门控的前置条件**。论文对应：21.1% vs 1.4%，根因是环境构造的语义细节（打开 namespace ≠ 身处 namespace）（第 452–454 行）。搬到我们这里：体检对笔记的解析必须与插件主路用同一实现（frontmatter span、层级、别名解析），任何第二份实现都是假问题的来源。已有 `check-frontmatter-source.mjs` 是这条的正面样板，其余解析（`hook:` 块、`verified`、引用链接）可套同一形状。**零 token。**
5. **溯源作为凭据，粒度到「定义位置 + 使用位置 + 全名」**。论文对应：`annotated_tactic` + provenance list（`full_name` / `def_path` / `def_pos`）（第 508–528 行）。搬到我们这里：卡片引用笔记里的定理时，凭据应包含**笔记路径 + 标题层级锚点 + 引用到的精确 `full_name`（笔记里的定理编号/名称）+ 使用该结论的位置**。现在是「指向 episode」一级，缺「用在哪一行」。**零 token（记录与校验），需模型（生成锚点建议）。**
6. **反记忆的评测设计 Δ**。论文对应：`novel_premises` 要求测试证明至少用一个训练中从未被用过的 premise（第 105 行）。搬到我们这里：体检应能区分「这条结论的依据在别的笔记里也出现过（可能同源复述）」与「依据只在这一处出现」。前者在 `cross-referenced` 之前必须再确认来源**不是同一份底稿**。现状：`cross-referenced` 的定义是「与 vault 内笔记/定理互证」，未要求来源独立。**零 token（查重）→ 需用户（升级判定）。**
7. **候选数量与排序口径固定并可测**。论文对应：64 候选、按 log-likelihood 之和排 state（第 622 行）。搬到我们这里：任何候选列表都要有**固定的容量上限与确定性的排序键**（例如 `verified` 等级 → `success_rate` → `uses`），不要按「相关性感觉」动态截断；候选超限时明确丢弃并计数，不静默。**零 token。**
8. **假设靠「编译不过」筛掉，而非靠打分保住**。论文对应：错误 premise 生成的 tactic 编不过，被环境消掉（8.4）。搬到我们这里：**编译 = 结构校验/链接可达/证据存在**。任何通不过结构校验的候选一律丢弃并记录，不允许「分数高所以留下」。
9. **消融式归因**。论文对应：w/ all premises、w/o in-file negatives 两条消融（第 155 行）。搬到我们这里：每次改进机制后，跑一次「关掉它」的对照（本仓库已有探针 A/B 实践），没有对照的改进只能记为「提案」。
10. **快照绑定 + datasheet**。论文对应：所有数字绑定到具体 commit；数据集附 datasheet，包括已知噪声与勘误状态（第 554、562、604 行）。搬到我们这里：审计报告应绑定 vault 快照（`git rev-parse HEAD` 或笔记 mtime 集合），并显式写「本轮已知噪声/未覆盖范围」。
11. **成本上限写进契约**。论文对应：单次尝试 + 10 分钟墙钟 + 一次性 forward（第 125、149 行）。搬到我们这里：体检每项检查要有确定性上界（文件数、读取字节、递归深度），超限即停并报 `truncated`，不静默降级。
12. **「取一档、不重排」的预算纪律**。论文对应：不做 rerank 的显式理由（每条都要一次 forward，太贵）（第 125 行）。搬到我们这里：为「不做某件更贵的事」留下**写明的理由与触发条件**（本仓库 `retrieval-v3.md` §7.4 的「记录在案不实现 + 触发条件」正是这个形状），避免后人当成疏漏重议。
13. **两张能力对比表**。论文对应：Table A 把 LeanStep / lean-gym / LeanDojo 按能力维度（premise 信息、Lean 4、近期 mathlib、非 mathlib repo、估计误差、文档与单测）逐格标 ✕/√（第 470 行）。搬到我们这里：repo 内可比机制的对比按格标注，缺什么就写 ✕，比散文更省字也更容易腐烂被检出。

**明确不可迁移的**：DPR/ByT5 训练、可达集与嵌入语料的全库构建、best-first search 与 64 候选（都需要模型与算力）、Lean 交互原语本身（我们是 Obsidian 插件，无 kernel）。

## 13. 与 dsh-math-memory 的映射与差距

| 论文机制 | 我们现状 | 判定 |
|---|---|---|
| 两个原语、error state 传播 | 插件是确定性检查器，但无「未决 → 下游 blocked」的显式规则 | **改造**（§14-1） |
| 可达性约束（物理取不到） | 有 `verified` 分级与 `source` 必指 episode，但「引用范围」未做成可计算封闭集 | **改造**（§14-1） |
| 检查器实现唯一性（21.1% vs 1.4%） | frontmatter span 已单一实现 + `check-frontmatter-source.mjs`；其余解析未见同等守卫 | **采纳**（§14-8） |
| 裁判二值、模型无裁判权 | `verified_by` 唯一写入者是用户 ✅；体检查 `unjustifiedUpgrade`（三件齐备：承诺 + 唯一写入者 + 检测者） | **已一致，继续加固** |
| 溯源到「定义位置 + 使用位置」 | 有 `source` → episode；缺「用在哪一条/哪一处」的结构化锚 | **改造**（§14-4） |
| 反记忆 split | 有 `cross-referenced` 档，但未要求两个来源**独立** | **改造**（§14-3） |
| 无 rerank 的成本理由被写明 | `retrieval-v3.md` §7.4 已有「记录在案不实现 + 触发条件」的形状 | **采纳**（§14-11） |
| 消融归因 | 已有探针 A/B 实践（GraphMemix 多视图 max-pool 实测后不采纳） | **采纳** |
| 快照绑定与 datasheet | 有 `docs/changelog.md` / 决策台账；审计报告未绑定快照与覆盖范围 | **改造**（§14-10） |
| Table A 式能力对比表 | 文档多为散文；`references.md` 有卡片级对照但非逐格 | **采纳**（§14-12） |
| 64 候选 + best-first + log-likelihood | 无（不调模型） | **不适用** |
| Lean kernel / proof tree / DAG 抽取 / DPR 训练 | 无，也不该有 | **不适用** |
| 无增量学习的离线快照维护 | 我们反过来是**增量 + 每日体检**，比它更活；理念不冲突（全 markdown、无 DB 的同一取向） | **不适用（方向相反）** |
| ChatGPT plugin 式交互回退（`state_id`） | 面板 `run()` 曾丢弃响应体（历史坑），回退语义无从谈起 | **改造（低优先）** |
| 数据污染自标注 | 我们有「同源复述」风险但没有显式标注字段 | **改造**（§14-3） |

## 14. 行动项

每条标注成本档：**零 token**（确定性插件/脚本逻辑即可）/ **需模型** / **做不到**。

1. **把「可达引用」做成可计算的封闭集，并让越界引用不可用（不进入候选）**。实现：体检新增一项 `reachability`——对每条 `records` 卡，校验 `source` 指向的 episode 文件存在、引用的笔记路径在 vault 内、被引定理在被引笔记中先于引用处出现；不在集合内的引用记为 `unreachable`，与 `missing` 分开计数（对应「检索到但无用」vs「没检索到」的区分）。**零 token。**
2. **显式「未决 → blocked」传播规则**。实现：报告里为每条结论引入 `status: resolved | unresolved | blocked`；若唯一支柱是 `unresolved`，下游只能为 `blocked`，不得为 `resolved`。体检断言「不存在 `resolved` 而支柱含 `unresolved`」。**零 token**（对应 error state 不可恢复）。
3. **`cross-referenced` 加「来源独立」判据**。实现：升级到 `cross-referenced` 前，体检检查两个来源是否**不同文件且非同一底稿**（比对内容指纹/近重），同源则拒绝升级并指向反记忆风险。升级动作本身仍**必须用户参与**——我们**不做机器自动升档**（论文的 `novel_premises` 是评测设计，不是自动升格机制）。**零 token（查重与拒绝）/ 需模型（近重判定的文案与说明）**；**自动升档：做不到，且不做**。
4. **引用锚点粒度从「episode 级」细到「位置级」**。实现：`records.source` 之外增加可选 `anchors: [{note, heading, theorem}]`，体检校验锚点可解析（标题存在、定理名在笔记内唯一）。**零 token（存储与校验）/ 需模型（从对话中提取锚点候选）**。这一条**不能**由插件自己生成锚点（会变成模型替代证据）。
5. **扩展越权检测到「机器层字段被改」**。实现：现有 `structural.unjustifiedUpgrade` 只覆盖 `verified` 高于 `single-source` 而无 `verified_by`。扩展：`uses` / `success_rate` / `last_used` / `harmed` / `verified_by` 任一字段的文本与插件上次写入的期望值不符 ⇒ 报 `structural.machineFieldTampered`（**只报告，不自动改写**，理由与既有决策一致：自动改会覆盖用户手改）。**零 token。**
6. **校验「检查器实现一致性」扩展到其余解析器**。实现：把 frontmatter 之外的解析（`hook:` 块字段、`verified`、引用链接、标题层级）也纳入「唯一实现 + 守卫」形状，或至少加一条漂移检测脚本。这是 8.10 的直接落地；不做的话，体检会自己制造假问题。**零 token。**
7. **区分「没找到证据」与「找到但不适用」，并禁止在空证据下给结论**。实现：检索/体检输出为空时返回结构化 `no_evidence`，而不是空列表 + 沉默；模型在 `no_evidence` 下必须声明「无依据」，不得给出结论性判断（这是把 8.9 的推论变成我们自己的契约）。**零 token（契约与断言）/ 需模型（遵守契约）**。
8. **审计报告绑定快照与覆盖范围**。实现：报告头部写 vault 快照（`git rev-parse HEAD` 或笔记路径+mtime 集合的摘要）、扫描文件数、跳过项与原因、已知噪声（如解析器局限）。**零 token。**
9. **每项体检检查写上确定性上界**。实现：逐项声明最大读取文件数/字节数/递归深度，超限记 `truncated` 并列出被跳过对象。**零 token。**
10. **改进机制必须带「关掉它」的对照**。实现：新机制上线时同时给出 A/B 或前测/后测数字；没有对照的改动在台账里标 `proposal` 而非 `verified`（沿用仓库既有措辞）。**零 token**（跑对照的成本另计）。
11. **把「记录在案不实现 + 触发条件」固化成台账格式**。实现：`references.md` / `retrieval-v3.md` §7.4 已有此形状，抽成一个模板小节，供本笔记这类外部机制评估复用（对应论文「不 rerank 但写明理由」）。**零 token。**
12. **能力对比表替代散文对照**。实现：新增机制评估时用逐格 ✕/√ 表（premise 信息 / Lean 4 / 近期 mathlib / 非 mathlib repo / 估计误差 / 文档与单测 这种维度），至少含「有无关守卫」一列。**零 token。**
13. **不做**：任何「每轮新增必做步骤」的模型侧流程（仓库已有明确否决记录，实测失败模式是「机制没人用」而非「机制不够多」）；任何机器自动升 `verified` 等级；任何形式的 64 候选式多样本采样（烧 token 且我们无确定性裁判去筛）。
