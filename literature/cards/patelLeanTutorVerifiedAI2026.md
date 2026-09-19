---
citekey: patelLeanTutorVerifiedAI2026
title: "LeanTutor: Towards a Verified AI Mathematical Proof Tutor"
shorttitle: "LeanTutor"
authors: "Patel, Manooshree; Bhattacharyya, Rayna; Lu, Thomas; Mehta, Arnav; Voss, Niels; Norouzi, Narges; Ranade, Gireeja"
year: 2026
status: distilled
doi: "10.1609/aaai.v40i47.41514"
url: "https://ojs.aaai.org/index.php/AAAI/article/view/41514"
tags: [faithful-autoformalization, proof-tutoring, next-step-generation, feedback-generation, lean4, peanobench, answer-leakage, llm-as-judge-unreliable]
full_text: .raw/patelLeanTutorVerifiedAI2026/full.md
pdf: .raw/patelLeanTutorVerifiedAI2026/source.pdf
---

# LeanTutor: Towards a Verified AI Mathematical Proof Tutor

> **一句话**：证明导师的概念验证系统——学生用自然语言写（可以是不完整、甚至错的）证明，Lean 在后台**逐步**判定对错，一个模块生成**下一条合法 tactic**，一个模块生成**不泄露答案的引导性反馈**；三个模块的分工是 autoformalizer/proof-checker → next-step generator → feedback generator。对我们的价值：**"忠实性而非编译通过"这个质量目标**、**"抄书率"与"脱离来源后的正确率"这两个可计算探针**、以及**反自证 + 反时序的禁列表**。

## 摘要

This paper considers the development of an AI-based provably-correct mathematical proof tutor. While Large Language Models (LLMs) allow seamless communication in natural language, they are error prone. Theorem provers such as Lean allow for provable-correctness, but these are hard for students to learn. We present a proof-of-concept system (LeanTutor) by combining the complementary strengths of LLMs and theorem provers. LeanTutor is composed of three modules: (i) an autoformalizer/proof-checker, (ii) a next-step generator, and (iii) a natural language feedback generator. To evaluate the system, we introduce PeanoBench, a dataset of 371 Peano Arithmetic proofs in human-written natural language and formal language, derived from the Natural Numbers Game.

## 核心机制 / 方法

> 来源：MinerU 全文通读（`.raw/patelLeanTutorVerifiedAI2026/full.md`，332 行）；全部数字已与同目录 `full.txt`（pdftotext -layout）逐条核对。

- **★ autoformalizer / proof checker 契约**：**一次只形式化一个学生证明步**，把结果追加到 Lean 定理陈述与之前已形式化的步骤之后，**每一步都编译**（via LeanInteract）。上下文放四样：**staff solution**（一份 NL+FL 的参考证明，**可能与学生的写法不一致**；目前**只放进上下文、没有进一步利用**）、**theorem/tactic 字典**（键 = Lean 形式名，值 = NL 描述）、**5-shot 示例**、学生输入。模型 `gpt-4o-mini-2024-07-18`（temperature 0.0）。
- **★ 判错规则（全文最硬的机制）**：编译器输出**只有 unsolved goals** → 判该步正确并继续；**出现任何其他错误消息**（unknown tactic、unexpected identifier 等）→ 判该步错误并把该步标为 erroneous；**定位到第一个错误就结束**。论文明确承认的歧义：**编译器错误既可能是学生步骤错，也可能是 autoformalization 错**（未解决，列入未来工作）。
- **★ 忠实性的度量（relaxed exact matching，§5.1）**：先 exact tactic-matching（字符串直接比对）；失败则 **state-matching**——把预测/真值 tactic 分别追加到各自证明上，比较所得 **proof state 是否在变量重命名下语法相同**（proof state 按 goal/casework 分段，标准化变量名后再比）。两阶段都失败判为不忠实。选它而不用 LLM-as-a-judge（有幻觉、不可靠）或 SMT 等价证明（贵），**主要依赖人工评价**。
- **★ next-step generator（NSG）契约**：在"未被判定为完整且正确"时启动；输入是**已形式化、且把出错步移除**的部分学生证明；输出**一条**能导向完整证明的 Lean tactic。机制照 COPRA：LLM **生成 12 条带排序的候选 tactic**（prompt 只带**该定理所在 NNG4 world 的 tactic/premise 列表**）→ 过 Lean 编译 → 过 **progress check** → 用通过的候选建证明搜索树，**DFS 到树深 8** → 找不到就**把"找不到"上报给反馈模块**（不伪造下一步）。
- **★ 禁列表（progress check 的两条硬边界）**：(1) **不得使用当前正在证的定理**（反自证/反循环）以及**按 NNG4 顺序在该定理之后才引入的定理**（反时序）；(2) **避免循环 tactic**（会让证明树回到已访问的 goal state）。**候选在进树之前就被过滤，是结构性边界而非提示式禁令。**
- **★ feedback generator 契约**：输入 = 已形式化证明 + **Lean 错误信息**（若有）+ NSG 给出的下一条 tactic；prompt 里放**学生在归纳证明里常犯的六类错误**（Baker 1996）。输出三类：**①指出学生错误 ②给一个引导性提示或问题 ③给一条显式的下一步**（对应 bottom-out hint；论文承认③与 ATP 里的 auto-informalization 很相似）。
- **★ 忠实性性能（pass@1；tactic 级 900 条、正确证明 150 条、错误证明 146 条；误差棒为 Jeffreys 先验 95% CI）**：
  | 实验 | Correct Tactics | Correct Proofs | Incorrect Proofs |
  |---|---|---|---|
  | Baseline | 32.9% | 6.7% | 14.4% |
  | **Baseline + Staff Solution** | **56.8%** | **18.0%** | **30.1%** |
  | Baseline（整篇一次形式化） | 28.2% | 10.7% | 13.0% |
  | Baseline + Staff Solution（整篇） | 51.8% | **26.7%** | 21.9% |
- **★ staff solution 的依赖度（§5.2）**：**89%** 的正确 tactic 形式化里预测的 tactic **出现在 staff solution 中**；autoformalization **错**时 **51%** 的情况是**抄了 staff solution 里的一条 tactic**；**期望形式化不在 staff solution 里时只有 32%** 能正确形式化。⇒ **给参考大幅提分（32.9→56.8）但也把模型变成抄写器。**
- **★ 逐步 vs 整篇的消融**：带 staff solution 时**正确证明上两者相当**（tactic 级 56.8 vs 51.8；proof 级 18.0 vs 26.7），但**错误证明上逐步高 8%**（30.1 vs 21.9）——论文理由很实际：**进导师系统的证明很多是错的**。
- **★ 反馈质量（Table 2，21 条错误证明，2 名有数学教学经验的 CS 研究生、model-blind、四轴 5 分制）**：Error Identification 3.4→**3.4** / 3.5→**3.8** / 4.5→4.3 / 4.6→4.5；Hint-Question 3.1→**3.7** / 2.9→**3.7** / 4.7→4.7 / 4.3→4.4；Next Step 2.8→**3.7** / 2.9→**3.9** / 4.6→4.4 / **Answer Leakage 2.2→1.1**。论文明确：Next Step 的 leakage **低是预期的（1 分是预期值）**，因为给出显式下一步按定义就会泄露。
- **★ LLM-as-a-judge 的反例**：用 gpt-4 当裁判重跑同一评估（校准到作者给的三条分数）后，**baseline 在几乎每个轴、每种反馈上都压过 LeanTutor，与人工评分相反**——论文据此指出该范式有问题。**这是"用模型审查代替人工审查"的一手反例。**
- **PeanoBench（371 条 = 正确 225 + 错误 146）**：来自 NNG4 原 80 条取 75 条**回译**，NL 注释由论文前五位作者撰写；**NL 步与 FL tactic 一一对应**（区别于先前"整篇对整篇"的数据集）。正确证明分 staff-solution（**仅作上下文、不评估**）+ equation-based persona（少词、多代数变形）+ justification-based persona（**显式包含所用定理与定义**）；后者每条由一人写、另一人校对，并**同时改动 Lean 代码**。错误证明 = **从证明最后三行随机跳过一步**模仿逻辑错误，一行长的证明被剔除（论文自认只覆盖一种错误类型、且程序化删除可能不现实）。
- **场景特权（§1，值得记住）**：导师场景可以假设**教师知道一份完整解答**（"忠实 autoformalization 的更容易版本"），且**下一步搜索可限制在小定理库**（而非 Mathlib）。论文把这当作合法的简化前提，而非作弊。
- **成本**：**全部实验（含消融）不到 $4.00**（gpt-4o-mini）；论文刻意做**模型无关框架**、不针对不同 LLM 优化。
- **★ 自认的系统级缺口**：**autoformalization 失败时可能给出错误反馈或答不上来**，所以**端到端评估排除了 autoformalization 错的样本**；并且"**把编译器报错当学生错**"这个假设本身**会因 autoformalization 错而产生假阳性**（抽查显示问题不大）。两条自动化的能力假设（NL 步↔FL tactic 一一对应；已有形式化的 staff solution）被列为**不可泛化**的局限。

## 与我的工作 / 记忆的映射

- **★ "忠实性"而非"读得通"**：论文的核心主张是 `syntactic correctness is insufficient`。可直接落成协议一句判据——「**通顺、读得懂、能编译，都不构成任何证据；只有"给定前文，结论必须成立"被核对过才算**」。
- **★ "抄书"是可度量的，而且是主导模式（对应我们的"跟教材抄书"中间产物）**：89% 的正确 tactic 来自参考材料；**期望答案不在其中时正确率只有 32%**。落地形状：用确定性 n-gram/Jaccard（仓库已有 tokenize + Jaccard 用于 duplicate 检测）算**卡片与 `source` 的重叠度**，产出"有来源卡的占比"与"平均重叠度"两个数。**高重叠不是错**（抄书是合法的中间产物），但它意味着**这条内容没有经过独立验证**，应作为**是否值得花力气审查**的排序依据，而不是当作错误。
- **★ "脱离来源后的正确率"是审查优先级的输入**：把"内容**不**能在 `source` 里找到"的卡单列"**独立产出**"一节优先审查——依据是 LeanTutor 里期望答案不在参考材料中时正确率只有 32%，**那才是真实能力所在处**。
- **★ 禁列两条（最便宜、最可直接搬）**：**反自证**（卡片不得 `depends_on` 自己；不得用待证结论证明自己）与**反时序**（若 A 依赖 B，B 的写入时间/`source` 不能晚于 A）。零成本、可机检。
- **★ "推不出下一步"是一等结果**：NSG 找不到证明时**上报**而不是编一个。对应我们：**"判不了"必须有输出**（`unresolved`/`blocked`），**不得用沉默代替**。
- **★ 拒绝反馈的三段式**：定位（哪句/哪个前提）→ 提示（缺什么条件、往哪查）→ 最小修正。对应 Danus 的 repair hints；我们标 `needs_review` 时应同时给出这三段，否则重判没有抓手。
- **★ 小库特权换确定性**：论文把"库小 + 教师知道解答"当正当前提，用它换搜索空间的可控。我们同样有"vault 规模小、用户知道自己在学什么"的特权——**应当用它换零 token 的封闭集检查，而不是模仿大库语义检索。**
- **★ 人工校准不可省**：LLM-as-judge 与人工评分相反这一发现是"AI 审查会错"的一手证据。任何"模型审查更准/更省"的结论都必须附一次**小规模、model-blind 的人工校准**，并如实报告不一致。
- **★ 成本纪律**：全部实验 <$4、模型无关、先证明机制有用再谈模型。
- **不适用**：Lean / LeanInteract / NNG4 / NSG 的 tactic 搜索 / COPRA / persona 数据构造 / autoformalization 词典 / PeanoBench 式数据集构建。我们不做数据集，也没有形式化栈。
- **反向警示**：LeanTutor 的判错通道**只有一个**（编译器报错 ⇒ 学生错），因此它把"表达失败"与"内容错误"混在一起——**这正是我们要避免的**（对照 SAFE 的四态）。

## 研读状态

- 状态：distilled
- 研读日志：reading/patelLeanTutorVerifiedAI2026.md
- 源质量：正文干净，关键数字已与 `full.txt`（pdftotext -layout）逐条核对一致。唯一结构性瑕疵是正文 §5.2 两处表引用写成 `Table ??`（LaTeX 交叉引用未编译），**不影响 Table 1 / Table 2 的数据**。

## 原文

- [MinerU 全文](.raw/patelLeanTutorVerifiedAI2026/full.md)
- [PDF](.raw/patelLeanTutorVerifiedAI2026/source.pdf)
