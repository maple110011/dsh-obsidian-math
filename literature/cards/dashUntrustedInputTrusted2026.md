---
citekey: dashUntrustedInputTrusted2026
title: "From Untrusted Input to Trusted Memory: A Systematic Study of Memory Poisoning Attacks in LLM Agents"
shorttitle: "From Untrusted Input to Trusted Memory"
authors: "Dash, Pritam; Ge, Tongyu; Jain, Aditi; Shah, Tanmay; Shang, Zhiwei"
year: 2026
status: distilled
doi: "10.48550/arXiv.2606.04329"
url: "http://arxiv.org/abs/2606.04329"
keywords: "Computer Science - Artificial Intelligence, Computer Science - Cryptography and Security"
tags: [memory-poisoning, llm-agent-memory, agent-security, provenance, benchmark, prompt-injection]
full_text: .raw/dashUntrustedInputTrusted2026/full.md
pdf: .raw/dashUntrustedInputTrusted2026/source.pdf
---

# From Untrusted Input to Trusted Memory: A Systematic Study of Memory Poisoning Attacks in LLM Agents

> **一句话**：把长期记忆的**写入**当成攻击面来系统化——四条写通道（显式指令 / 系统提示策略 / 压缩 / 经验→技能）× 三层九条结构脆弱性，衍生六类攻击与基准 MPBench；两个 agent 上总体 **ASR 50.46% / RSR 41.05%**，且**一次写入即可跨会话长期生效**（§1、Table 2）。

## 摘要

Memory is a core component of AI agents, enabling them to accumulate knowledge across interactions and improve performance. However, persistent memory introduces the risk of memory poisoning, where a single adversarial memory write can exert long-term influence over agent behavior. We present a systematic study of memory poisoning in LLM-based agents. We identify four memory write channels and nine structural vulnerabilities in model capabilities, system prompt design, and agent system architecture that make these channels exploitable. Based on these vulnerabilities, we develop a taxonomy of six classes of memory poisoning attacks. Furthermore, we design MPBench -- a benchmark for evaluating memory poisoning attacks, and show that agents designed to write and retrieve memory more aggressively are more exploitable. We also show that existing prompt injection defenses fail to cover memory poisoning attacks. Our findings provide a foundation for understanding and mitigating memory poisoning attacks against AI agents.

## 核心机制 / 方法

- **问题**：prompt injection 的载荷必须每次都在活跃上下文；记忆投毒**只需一次成功写入**，此后被当作可信先验知识反复取用，而**没有机制追踪条目来源**（§1）。
- **四条写通道**（按"触发者 + 写入权限"分，§2.2）：C1 显式指令执行（**直写**，内容由外来指令决定）；C2 系统提示策略（模型按模糊留存策略判断）；C3 压缩驱动（上下文满/会话结束时摘要落库）；C4 经验→技能（模型从执行轨迹认出"可复用流程"）。C1–C4 之外无第五条。
- **九条脆弱性**（§2.3，Table 1）：模型层 V-M1 指令-数据边界盲、V-M2 多源来源归属失败；提示层 V-P1 写入策略欠定义、V-P2 压缩不筛来源；架构层 V-S1 写路径无校验、V-S2 多源共享上下文、V-S3 压缩触发可被载荷长度顶开、V-S4 技能创建无校验、**V-S5 自我改进即放大**（执行没报错＝被当验证，毒技能越迭代越优化；静态记忆系统里没有对应物）。
- **六类攻击**（§3.2）：Explicit Command（C1，强）、Conditional Command（C1，强）、Salience-Driven Compaction（C3，强；重复 ≥3 次让压缩把重复当重要性）、Policy-Conformant Fact Injection（C2，弱）、False Precedent Insertion（C2，弱）、Skill-Procedure Insertion（C4，弱）。
- **强/弱信号是全文最有用的划分**（§3.2.1）：强信号在原始输入里可被分类器还原；**弱信号在输入层与合法内容不可区分**——被写进去"不是因为有写命令，而是因为它像事实/政策/经验"。
- **MPBench**：3,240 条对抗用例（5 类 ×600 + Skill 240）+ 2,997 条良性样本；7 个领域；两段式度量——ASR 测**写入**（LLM judge 判条目与目标指令是否同一行为指令），RSR **只在 ASR 为正的用例上**测跨会话影响（§4.1.3）。
- **实测**：OpenClaw 平均 ASR 34.25% / RSR 17.40%；HERMES 66.67% / 64.70%；最强单点 HERMES Conditional ASR 76.00% / RSR 92.76%、Salience ASR 85.17%；最弱 OpenClaw Policy-Conformant ASR 8.33%（Table 2）。HERMES 的**压缩阈值 = 2200 字符**（§4.2）。
- **为什么 HERMES 更惨**（§4.4，作者归因，非消融）：留存策略更宽松 + 压缩阈值更低 ⇒ ASR 高；记忆在会话开始**作为冻结快照注入系统提示**（而非工具检索）⇒ 投毒条目无需检索就在上下文里 ⇒ RSR 高。
- **防御不覆盖**（§4.5，Table 3/4）：四个输入层检测器，最强 PromptArmor off-the-shelf 67.67% TPR / 1.00% FPR，但**弱信号检出只有 42.50%**（强信号 84.44%，落差 41.94 点）；适配后不升反降（61.60%）。PIGuard 适配后落差收到 1.67 点。→ **弱信号在输入边界上抓不到**。

## 与我的工作 / 记忆的映射

- **我们的注入 = HERMES 形态**：记忆卡每次组装系统提示就注入（note-noise §1.1）⇒ 落在论文的高 RSR 档（HERMES 64.70% vs OpenClaw 工具检索 17.40%）；`note_recall` 才是 OpenClaw 形态。我们是混合体。
- **最尖的一刀 → 缺口 3 / P6**：我们的可信度只在"库内一致性"维度（single/cross/user-confirmed），**没有"它从哪来"这一维**；论文的整个攻击面恰好是来源维（§5 建议 provenance + 来源感知的降权/隔离，**未实测**）。
- **`capture-policy` 的 `structure: auto` = V-P1 的逐字对应物**（note-noise §1.2）：写入权限交给模型判断、判据模糊 ⇒ 对应 **D1 选项 A / P4 的 `stage: draft`**；`ask` 那条只约束"这一轮要不要写"，正是论文说的"写路径无校验（V-S1）"。
- **`uses → hookPrior` = V-S5 的同构错误**（缺口 5 / P5-②）：把"被检索命中"当验证信号 ≈ 论文里"把执行没报错当验证"。
- **缺口 4 / P6**：弱信号攻击在输入层看起来完全正常 ⇒ 用户需要一个不撒谎的"待澄清"中间态，而不能只有 ✅/❌/过期/归档。
- **缺口 8 有条件成立**：载荷顶阈值 ↔ `appendOnlyIndexDigest` 静默丢最旧行；但实测基准库注入 4088/18000（note-noise §1.4），**今天不生效**。
- **不适用**：C3 强形态（无"上下文满→自动压缩落库"，`sessionCapture` 默认 false）、C4 / V-S4 / V-S5（无过程记忆、无自主技能合成）——引进会制造假风险。
- **引用纪律**：§5 的三条防御方向（收窄写策略 / 来源隔离+provenance / 写后监控）**全部零实验**；"激进读写更易被利用"是 n=2 的两 agent 对比、非消融；单模型 GPT-OSS-120B。

## 研读状态

- 状态：distilled
- 状态更新：2026-10-01
- 研读日志：reading/dashUntrustedInputTrusted2026.md（已创建）

## 原文

- [MinerU 全文](.raw/dashUntrustedInputTrusted2026/full.md)
- [PDF](.raw/dashUntrustedInputTrusted2026/source.pdf)
