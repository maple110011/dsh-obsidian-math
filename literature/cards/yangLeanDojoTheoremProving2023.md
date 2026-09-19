---
citekey: yangLeanDojoTheoremProving2023
title: "LeanDojo: Theorem Proving with Retrieval-Augmented Language Models"
shorttitle: "LeanDojo"
authors: "Yang, Kaiyu; Swope, Aidan; Gu, Alex; Chalamala, Rahul; Song, Peiyang; Yu, Shixing; Godil, Saad; Prenger, Ryan J.; Anandkumar, Animashree"
year: 2023
status: distilled
doi: "10.52202/075280-0944"
url: "https://proceedings.neurips.cc/paper_files/paper/2023/hash/4441469427094f8873d0fecb0c4e1cee-Abstract-Datasets_and_Benchmarks.html?utm_source=chatgpt.com"
tags: [premise-selection, retrieval-augmented-proving, accessible-premises, in-file-negatives, novel-premises-split, lean-interaction-reliability, provenance, proof-tree-extraction]
full_text: .raw/yangLeanDojoTheoremProving2023/full.md
pdf: .raw/yangLeanDojoTheoremProving2023/source.pdf
---

# LeanDojo: Theorem Proving with Retrieval-Augmented Language Models

> **一句话**：LeanDojo 把"用 LLM 证 Lean 定理"从私有不可复现变成开源 toolkits + data + models + benchmarks：**数据抽取**（文件依赖 DAG + AST、每条 tactic 的前后 state 以重建证明树、**每条 premise 的全名/定义位置/使用位置**）+ **可靠的 Lean 交互环境**（只有两个原语）+ 一个带挑战性切分的 benchmark（98,734 定理）；配套 ReProver 用 DPR 检索 premise 后交给 ByT5 生成 tactic，单卡 5 天训练即在 Lean 3 benchmark 上 Pass@1 51.2%（random）/ 26.3%（`novel_premises`）。对我们的价值：**"可达性约束 = 物理上取不到"**、**"检查器实现错误会伪造出大量假失败"（21.1% → 1.4%）**、以及**"未决会传播"**这三条判决性机制。

## 摘要

Large language models (LLMs) have shown promise in proving formal theorems using proof assistants such as Lean. However, existing methods are difficult to reproduce or build on, due to private code, data, and large compute requirements. This has created substantial barriers to research on machine learning methods for theorem proving. This paper removes these barriers by introducing LeanDojo: an open-source Lean playground consisting of toolkits, data, models, and benchmarks. LeanDojo extracts data from Lean and enables interaction with the proof environment programmatically. It contains fine-grained annotations of premises in proofs, providing valuable data for premise selection—a key bottleneck in theorem proving. Using this data, we develop ReProver (Retrieval-Augmented Prover): an LLM-based prover augmented with retrieval for selecting premises from a vast math library. It is inexpensive and needs only one GPU week of training. Our retriever leverages LeanDojo's program analysis capability to identify accessible premises and hard negative examples, which makes retrieval much more effective. Furthermore, we construct a new benchmark consisting of 98,734 theorems and proofs extracted from Lean's math library. It features challenging data split requiring the prover to generalize to theorems relying on novel premises that are never used in training. We use this benchmark for training and evaluation, and experimental results demonstrate the effectiveness of ReProver over non-retrieval baselines and GPT-4. We thus provide the first set of open-source LLM-based theorem provers without any proprietary datasets and release it under a permissive MIT license to facilitate further research.

## 核心机制 / 方法

> 来源：MinerU 全文通读（`.raw/yangLeanDojoTheoremProving2023/full.md`，788 行 = 正文/实验 + 附录 A–F）；全部数字已与同目录 `full.txt`（pdftotext -layout）逐条核对。

- **两种 split 是评测设计的核心**：`random` 与 **`novel_premises`**——后者要求**测试证明至少用一个训练中从未被用过的 premise**（若 `conj_mul` 出现在训练集某定理里，另一条用它的定理也必须留在训练集）。动机：图 3 里最后两条定理**不仅长得像、证明完全相同**，随机切分下模型**靠记忆**就能"证出"看似不平凡的定理。所有方法在 `novel_premises` 上都显著更差（ReProver 51.2 → 26.3），论文主张**挑战性切分上的成绩才代表真实能力**。
- **规模与切分**：98,734 theorems / 3,384 files；130,262 premises；217,776 tactics（其中 129,243 至少带一个 premise）；**带 premise 的 tactic 平均 2.13 个 premise**；train/val/test = 94,734/2,000/2,000；抽自 mathlib commit `19c869e…`（2023-10-11）。Lean 4 版（Benchmark 4）：102,514 theorems / 213,067 tactics / 152,695 premises。
- **ReProver 检索**：DPR，query = 当前 state，按 cosine 取 top-m；embedding 用 Transformer encoder + average pooling；**premise embedding 预计算、query 只一次 forward、不做 rerank**（论文给出理由：像 Magnushammer 那样 rerank 要对每条被检索 premise 各跑一次 forward，成本高）。两项针对性改进：
  1. **只从 accessible premises 检索**（同文件内定义在该定理之前的 + 已 import 的，靠 LeanDojo 的程序分析算）：全库 130,262 → **平均 accessible 仅 33,160**；
  2. **in-file negatives**：负例采自**与正样本同一 Lean 源文件**（每样本 3 个负例，其中 1 个 in-file）；早期全随机采负例时模型常误取同文件里别的 premise。
- **tactic 生成与搜索**：检索到的 premise 与 state **字符串拼接**后喂 ByT5（encoder-decoder，直接吃 UTF-8 字节、无 tokenizer）；生成器训练时对检索到的 premise 施 **dropout 0.5**、输入截断 **2,300 token**。评测时每步 beam search 产 **64 个候选 tactic**（带 log-likelihood），用 **best-first search**，state 优先级 = **到达该 state 的 tactic 的 log-likelihood 之和**；**Pass@1，单次尝试，墙钟上限 10 分钟**。
- **数据抽取的三个要点**：(a) 文件依赖 DAG + 每个文件的 AST；(b) **全部 tactic 及前后 state**，从而重建 proof tree；(c) **premise 的全名 + 定义位置 + 使用位置**。Lean 官方能导出 dependencies/AST/state/tactic 但**不能解析 premise 全名、不能定位定义位置**，所以作者**改了 Lean**（Git patch，可自动应用于 **2022-03-24 之后**任意 Lean 3）——拦截 **elaborator** 的输入 pre-expression（含使用位置）与输出 expression（含全名与定义位置）；位置统一为 file + 起止 row/column 的 span。**该改动只用于数据抽取、不用于评测**，因此不冒破坏 Lean 逻辑可靠性的风险。
- **交互原语只有两个**：`initialize(theorem)` → 返回 initial state 字符串（当前 goals + local contexts，多 goal 时拼接）；`run_tac(state, tactic)` → 返回下一个 state，tactic 执行不成功（超时/不适用）返回 **error state**，且**若输入 state 已是 error，结果只能是 error**（错误状态不可恢复、只会传播；唯一出路是回到某个先前 state 换一条 tactic）。
- **结果**：premise selection R@1/R@10/MRR（random / novel）——BM25 6.7/17.2/0.15 与 5.9/15.5/0.14；**Ours 13.5/38.4/0.31 与 9.1/27.6/0.24**；w/ all premises 11.7/36.2/0.27 与 7.1/23.1/0.20；w/o in-file negatives 10.8/33.1/0.25 与 7.9/25.7/0.22。定理证明 Pass@1（random / novel）：tidy 23.8/5.3；GPT-4 29.0/7.4；**ReProver 51.2/26.3**；**w/o retrieval 47.6/23.2**。
- **跨库外测**：MiniF2F Pass@1 **26.5%**（非 RL SOTA 25.9%、RL 29.6%），发现 **33** 条原本没有 Lean 证明的新证明；ProofNet Pass@1 **13.8%**（48/349，首个报告结果），其中 **39/48** 原本无 Lean 证明、**3** 条**只有靠 premise retrieval 才能证出**，并交回上游后帮其发现并修正了 **7** 个定理形式化中的问题。Lean 4 上：检索 12.8/34.7/0.29（random）与 9.8/32.1/0.24（novel）；Pass@1 ReProver 48.6/19.9、w/o retrieval 44.5/16.2。
- **成本**：训练 **5 天 / 单卡 A100 80GB**（≈120 GPU hours，对比前人 >1000 小时）；评测 2 天 / 8×V100；模型 `google/byt5-small`（**299M**，对比 837M / 600M）；**不用领域预训练、不用 PACT 辅助数据、不用与 Lean 在线交互采集的数据**。数据 CC BY 2.0、代码 MIT。
- **局限（附录 F）**：人类证明数据稀缺；**人类证明只记录最终成功轨迹、没有试错中间史**，tactic 难以学习；跨项目泛化差；**拼接式 premise 融合在 2,300 token 上限下只能装 10–15 条 premise**，建议改 hidden-space 融合（Fusion-in-Decoder）或 generative retrieval；ByT5 无 tokenizer 的代价是序列过长（Attention 对长度二次方）。

## 与我的工作 / 记忆的映射

- **★ 可达性约束 = 物理上取不到（而非提示禁令）**：不可达的 premise **根本不在候选池里**；消融证明放宽到全库后检索与证明**全面下滑**。搬到我们这里：一条卡片可引用的证据范围应是**可计算的封闭集合**（`source` 指向的 episode 必须存在、被引笔记必须在本 vault 内、被引定理须在被引笔记中先于使用处出现），范围外的引用记 `unreachable` 而**不进入候选**——而不是在提示里写"请不要引用不存在的笔记"。**零 token。**
- **★ 裁判与提案分离、且判定是二值的**：Lean kernel 是唯一裁判，模型只生成 tactic。我们对应：插件的确定性检查（结构校验、`verified_by` 凭据、`unjustifiedUpgrade`、frontmatter span 唯一实现）是裁判；**模型的判断只能作为提案落在报告里，不得写成任何 `verified` 等级**。
- **★ 错误状态不可恢复、只会传播**：`run_tac` 的输入是 error 则输出只能是 error。搬到我们这里：**若某条基础事实被判 `unresolved`，任何以它为唯一支柱的结论必须标 `blocked`，不得"暂定通过"**；不允许用下游的"看起来没问题"覆盖上游的未决。这是 fail-closed 的可机检表述。
- **★ 检查器实现一致性是质量门控的前置条件（21.1% → 1.4%）**：lean-gym 把 **21.1%** 的正确人类证明误判为 incorrect，根因是环境构造的语义细节——**"打开 namespace"与"身处 namespace 内"不是一回事**（后者才让 Lean 优先 favour 该 namespace 的常量），于是 `unfold read` 里的 `read` 被解析到 `monad_reader.read` 而不是 `buffer.read`；修法是**把交互代码包装成一条插入到证明正确位置的 Lean tactic**，误判降到 **1.4%**（且其失败是 lean-gym 失败的子集）。对应我们：**审计/体检解析笔记的方式若与插件主路不一致（frontmatter 边界、层级、别名），会产生大量"正确的笔记被判为错"的假问题**——仓库已有 `check-frontmatter-source.mjs` 禁止复制 frontmatter 正则，正是同一形状的防护，可推广到其余解析器。
- **★ 溯源作为凭据，粒度到"定义位置 + 使用位置 + 全名"**：`annotated_tactic` 用 `<a>…</a>` 标注用到的 premise，紧跟 provenance list（`full_name` / `def_path` / `def_pos`）——事后能精确回答"这条 tactic 用了哪条定理、它定义在哪个文件的哪一行"。我们目前只有"`source` → episode"一级，**缺"用在哪一条/哪一处"的结构化锚**。
- **★ 反记忆的评测设计**：`novel_premises` 要求测试证明至少用一个训练中从未被用过的 premise。对应我们的 `cross-referenced`：**当前只要求"与 vault 内笔记互证"，未要求两个来源"独立"**——同源复述（同一份底稿的两处抄写）不应算互证。
- **★ 候选数量与排序口径固定可测**：64 候选、按 log-likelihood **之和**排 state、Pass@1 + 10 分钟墙钟。对应我们：任何候选列表都要有**固定容量上限 + 确定性排序键**，超限时明确丢弃并计数，不静默。
- **★ 假设靠"编译不过"筛掉，而非靠打分保住**：错误 premise 生成的 tactic 通常编译不过，在环境层就被消掉；打分只用于在**已通过编译的**分支间排序。对应我们：结构性校验（链接可达、证据存在）就是"编译"，通不过的一律丢弃并记录，**不允许"分数高所以留下"**。
- **★ 消融归因与快照纪律**：改进的归因靠消融（w/ all premises、w/o in-file negatives），所有数字绑定到具体 commit，数据集附带 datasheet（含已知噪声与"是否有勘误"）。对应我们：新机制上线要带"关掉它"的对照；审计报告应绑定 vault 快照并写明覆盖范围与已知噪声。
- **★ 造假信号比漏检更容易发生**：论文用 21.1% 这个量级说明，**检查器/交互层的实现错误会批量伪造出"正确的东西不通过"**。对笔记审查的含义是明确的——**先把"判定工具本身对不对"当第一优先级，再谈判什么**。
- **不适用**：Lean kernel / proof tree / DAG 抽取 / DPR 与 ByT5 训练 / best-first search 与 64 候选 / Lean 交互原语本身（我们是 Obsidian 插件、无 kernel、不调模型）。
- **方向相反的一点**：LeanDojo 是**离线一次性快照**（无增量学习、新证明只以 PR 形式交回上游），我们反过来是**增量 + 每日体检**——理念不冲突（同是全 markdown、无 DB），但不要照搬其"重跑构建"式的维护。

## 研读状态

- 状态：distilled
- 研读日志：reading/yangLeanDojoTheoremProving2023.md
- 源质量：MinerU 全文（`.raw/yangLeanDojoTheoremProving2023/full.md`，788 行）；关键数字已与同目录 `full.txt`（pdftotext -layout）逐条核对一致。

## 原文

- [MinerU 全文](.raw/yangLeanDojoTheoremProving2023/full.md)
- [PDF](.raw/yangLeanDojoTheoremProving2023/source.pdf)
