---
citekey: yangOptSkillsLearningGeneralizable2026
title: "OptSkills: Learning Generalizable Optimization Skills from Problem Archetypes via Cluster-Based Distillation"
shorttitle: "OptSkills"
authors: "Yang, Haochen; Zhao, Ke; Ma, Mengyuan; Lu, Xingyu; Wang, Xiangfeng; Qian, Hong"
year: 2026
status: distilled
url: "http://arxiv.org/abs/2605.29829"
keywords: "Computer Science - Artificial Intelligence"
tags: [problem-archetypes, cluster-based-distillation, skill-cards, generalization, vendor-snapshot]
full_text: ""
pdf: ""
---

# OptSkills: Learning Generalizable Optimization Skills from Problem Archetypes via Cluster-Based Distillation

> **一句话**：把优化问题的**问题原型（archetype）**经**基于聚类的蒸馏**做成可泛化的技能卡；成果是 **103 个优化问题原型**，以 `skills/optskills` 的形式**直接并入** VeryMath 的 AI4Math-Optimization 仓库。**对我们的价值有限但明确：它是"技能卡"这一载体在数学领域被规模化学术验证的样本，且其并入方式（vendored snapshot + SOURCES.md 记上游 commit）是一个干净的第三方来源登记范式。**

## 摘要

Optimization problem archetypes distilled into reusable skill cards; 103 archetypes shipped as the AI4Math-Optimization `optskills` package. EMNLP 2026 Findings.

> ⚠️ **以上摘要由本仓库根据 VeryMath 官网公告与仓库 `SOURCES.md` 改写，不是论文原文摘要。** 已核验的部分：标题、作者（Haochen Yang, Ke Zhao, Mengyuan Ma, Xingyu Lu, Xiangfeng Wang, Hong Qian）、arXiv 号 `2605.29829`、EMNLP 2026 Findings、103 个原型、以及"以 `optskills` 包并入 AI4Math-Optimization"这一事实（官网 2026.09 公告与仓库 `SOURCES.md` 双向确认）。**论文正文未通读**（本次调研聚焦 VeryMath 组织级实践，未逐篇精读其论文）。

## 核心机制 / 方法

> 来源：VeryMath 官网 2026.09 "EMNLP 2026 Findings · OptSkills × VeryMath" 公告 + `AI4Math-Optimization/skills/optskills/SOURCES.md`（均为一手，已核验）。

- **问题原型的用法（官网原文描述）**：用自然语言描述一个优化问题 ⇒ **agent 匹配相关的问题原型** ⇒ 抽取**决策变量、目标函数、约束条件** ⇒ **选择当前环境中可用的求解器** ⇒ 求解后**检查求解状态、目标值和关键约束**。
- **覆盖方向**：指派、网络流、路径规划、生产调度、装箱、集合覆盖、图优化。
- **规模**：**103 个**优化问题原型（另加 10 张，据 SOURCES.md）。
- **★ 并入方式（我们该记的工程细节）**：`optskills` 在 VeryMath 侧是一个 **"thin, standalone entrypoint"**，指向上游 [OptSkills](https://github.com/fujiwaranoM0kou/OptSkills) 的**已发布技能卡**，并**钉住上游快照 commit `d9e14300df4b499529c74ea1981e2c1ab453a566`**；它**明确排除**了上游的训练/聚类/评估/agent/LLM/embedding 组件——**只搬产物，不搬训练管线**。
- **分工边界（同仓库）**：用户或建模技能**选定求解器**，`or-solver` 负责把该求解器**配置好**（依赖、安装、许可证、环境变量、故障排查）。**"选哪个"与"怎么装"分开**。

## 与我的工作 / 记忆的映射

- **★ "问题原型 → 技能卡"与我们 `templates/`（问题模板卡）同层**：我们的 `memory/templates/<slug>.md` 是"题型/解法 ↔ 定理关联图"，正是"问题原型"这一层的本土实现。这为我们**已有**的设计提供了**同层外部参照**——说明"按问题原型（而非按论文/时间）组织可复用解法"是这类系统的常见选择。
- **★ 第三方来源登记范式可直接抄**：`SOURCES.md` 记**上游仓库 + 快照 commit + 排除项**。我们的 `literature/` 有 `library.bib` + `.raw/<citekey>/meta.json`（含 sha256），但**对"从外部系统/仓库引入的机制"没有登记惯例**——`docs/memory/references.md` 现在只用链接。补一句"来源 + 快照/版本 + 明确不搬的部分"成本极低，且能防"读到一半的二手印象"。
- **"选问题原型"与"配求解器"分离**：对应我们 `topics`（选方向）/ `theorems`（事实）/ `strategy`（方法）/ `notation`（记号）的职责分离——**又一次同向印证**。
- **不适用**：优化建模/求解器/LP-MIP-SOCP 具体内容（与数学笔记记忆系统无关）；它的训练/聚类管线（我们既无训练也无模型调用）。
- **诚实标注**：本卡**未通读论文**，摘要为改写。价值判断建立在**工程并入方式**而非论文方法上；若要引用其方法论（cluster-based distillation 的具体做法），**须先取回原文**。这也是一条流程教训：**从二手公告引入文献条目时，卡片必须显式标注"摘要非原文"。**

## 研读状态

- 状态：distilled（**仅工程层面**；论文方法层面为 `to-process`，待取 PDF/MinerU 全文后补 §核心机制）
- 研读日志：reading/verymathOrg2026.md（**组织级调研**，OptSkills 见 §6 / §12）
- 源质量：无 PDF/MinerU（网页源）。**摘要为改写，非原文**，已在卡内显式标注。

## 原文

- [arXiv 摘要页](https://arxiv.org/abs/2605.29829)（本次 fetch 失败，未核验原文摘要）
- [上游 OptSkills 仓库](https://github.com/fujiwaranoM0kou/OptSkills)
- [VeryMath 的 optsills 入口与 SOURCES.md](https://github.com/VeryMath/AI4Math-Optimization/tree/main/skills/optskills)
- [VeryMath 官网公告](https://verymath.github.io/)
