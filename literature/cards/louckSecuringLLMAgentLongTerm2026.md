---
citekey: louckSecuringLLMAgentLongTerm2026
title: "Securing LLM-Agent Long-Term Memory Against Poisoning: Non-Malleable, Origin-Bound Authority with Machine-Checked Guarantees"
shorttitle: "Securing LLM-Agent Long-Term Memory Against Poisoning"
authors: "Louck, Yedidel"
year: 2026
status: distilled
doi: "10.48550/arXiv.2606.24322"
url: "http://arxiv.org/abs/2606.24322"
keywords: "Computer Science - Cryptography and Security"
tags: [memory-poisoning, origin-binding, non-malleable, corroboration]
full_text: .raw/louckSecuringLLMAgentLongTerm2026/full.md
pdf: .raw/louckSecuringLLMAgentLongTerm2026/source.pdf
---

# Securing LLM-Agent Long-Term Memory Against Poisoning: Non-Malleable, Origin-Bound Authority with Machine-Checked Guarantees

> **一句话**：机检的分离定理证明「**看内容或看血缘来判断记忆可不可信，在原理上不健全**」——三条 LLM 特有的洗白通道（自摘要 / 可信工具回声 / 制造共证）能把不可信来源洗成看似可信；作者给出的构造 TMA-NM（写入时绑来源 + 标签单调传播 + ≥2 个**由构造保证独立**的主体共证才提权）在 8 个前沿模型上把直接与洗白攻击都压到 **0% ASR**（基线上限 **68%**），合法效用 100%、判决 1.3 µs。**它对我们最直接的后果：`hook.verified` 靠"另一份文档出现同一 pattern"自动升 `cross-referenced`，正落在 L-c「制造共证」通道里。**

## 摘要

LLM agents increasingly rely on persistent long-term memory, which creates a critical vulnerability that we study here: memory poisoning. An adversary can store untrusted content in one session that later steers a consequential action, such as a payment, a setting change, or data exfiltration, in a future session. Existing defenses base a memory item's authority to act on either its content (detection or trust-scoring) or its derivation history (lineage). We show that both signals are malleable. An attacker can launder an untrusted origin through three channels specific to LLM agents: the agent's own summarization, a trusted-tool echo, and manufactured corroboration. Each makes the content look benign and breaks or flips its derivation edge to ``trusted.'' We formalize malleability for the memory write-retrieve-act pipeline and prove a machine-checked separation theorem. No content- or lineage-based defense is sound under laundering (T1), write-time origin binding is necessary (T2), and non-malleable origin-bound authority with Sybil-resistant corroboration-gated elevation is sufficient (T3). Our construction, TMA-NM (Tamper-evident Memory Authority, Non-Malleable), instantiates non-malleable information-flow control (IFC) for LLM-agent memory. A cross-defense, cross-attack, and cross-model benchmark over eight frontier models shows that existing defenses fail exactly where the theory predicts (up to 68% laundering attack-success), while TMA-NM reaches 0% attack success on both direct and laundering attacks across all models and channels, at full legitimate utility. We release the benchmark, harness, and machine-checked TLA+ models to support reproducibility.

## 核心机制 / 方法

- **建模**：条目 `(content, origin, scope, t_write, act_class)`，`origin ∈ {user, trusted tool, agent, untrusted external}`；流水线 `write→retrieve→act`；A1 假设来源标注由**通道**决定（已认证通道，mTLS/OAuth/签名），**不从内容推断**。
- **四条机制**：M1 写入时来源绑定（`act_class = f(origin)`）；M2 **不可篡改传播**（派生内容继承最不可信等级、改写/摘要/回声都不能提权）；M3 **抗 Sybil 共证提权**（≥2 个由构造独立的主体，或一次动作绑定的单次用户授权；条目不能自我共证）；M4 哈希链判决日志（只提供可审计性，不提供安全性——消融证明去掉它 ASR/效用都不变）。
- **形式结果**（TLA+ TLC，有界模型 Slots=3 / sessions≤2 / k=2）：T1 内容或内容可导出血缘的门可被洗白并违反安全不变式（见证轨迹 `write-untrusted → paraphrase → act`）；T2 去掉写入时绑定即可达违反 ⇒ 必要；T3 上述构造在 **3,270 个可达状态**满足不变式，并给出机检的归纳不变式（参数无关性仍是手写论证，无界全机械化留作未来工作）。
- **实证**（8 模型 × 12 领域 × 五类有后果工具）：基线洗白 ASR 上限 **68%**、lineage 47%、capability-IFC 68%（直接攻击 84%）；**TMA-NM 全 0%（每通道 0/192，跨模型主实验 0/4032）**、legit-utility 100%、`uncorr-auto` 0%（未共证的不可信来源动作**必须**问人而不是自动执行）。
- **独立性是硬约束**：共证者须加密身份不同、管理域不同、无共享上游；共享域的两票被域感知 monitor 折叠（Table X：naive 67% → 域感知 **0%**）；k 是按动作配置的旋钮（常规 k=2、高爆炸半径 k≥3 或一次授权）。

## 与我的工作 / 记忆的映射

- **采纳（补缺口 3「没有说话人来源字段」）**：卡片应在**写入时**由宿主确定性写 `hook.origin`（user / agent / imported），模型不可改，标签来自通道而非内容；由 AI 归纳或由 AI 补全笔记派生的记录不得高于其来源（M2 的单调传播）。
- **采纳（改 P5 / D1 的升级判据，本批 4 篇里最具体的一条）**：`cross-referenced` 只能由**不共享上游**的两个来源触发；"同一段文字在两份 AI 笔记里都出现"不算两票（Table X：相关共证是 68% 那一类）。我们的 `findCorroboration` 现在正是按内容 pattern 比对升级（note-noise §2.6），落在 L-c 通道里。
- **采纳（形态）**：共证计数与 `verified_by` 由宿主只追加记录维护、**不从卡片正文重新解析**（对应 Mem0 段：存储侧改写不得悄悄降低独立计数）。
- **改造（P1/P2 的定位）**：注入措辞分级与 ❓/⚖️/✅ 是**可见性**改进，论文不把它算作正确性/安全机制；引用时不能说成"解决了洗白"。
- **改造（P4/D1 的形式）**：把"AI 产物默认降级"写成"默认 `origin=agent` 且不可提权，除非有独立共证或用户批准（批准与内容绑定、一次性）"——比"降权重"更贴近论文的结构，也与 Zhang 的"固化设闸"同向。
- **不适用（必须写清的威胁模型差距）**：论文的对手是自适应攻击者、目标是**阻止有后果动作**；它**显式把 answer-bias 划出范围**（§VI 末、§IX(a)：只守 retrieval→action，不管自由文本回答）。用户抱怨的"越看越乱"正是 answer-bias ⇒ **本篇不能当作"AI 笔记让人理解出错"的证据**，只能当作"内容派生的可信度信号不可靠"的证据。
- **不适用（A1 只能部分满足）**：我们没有认证通道，vault 里的内容可能是用户粘贴、剪藏或 AI 写的，`origin` 只能退化为"写入者自报 + 通道推断"，拿不到论文的 0% 保证——采纳时须如实标注强度。
- **可复用纪律**：论文用 `legit-utility` 做反同义反复控制（全拦也能拿 0% ASR），与我们 `retrieval-v3.md` §7.5"Direct 数不降且排名均值不升"同形：任何"少信脏记忆"的改动都必须同时报合法效用不降。

## 研读状态

- 状态：distilled
- 状态更新：2026-10-01
- 研读日志：reading/louckSecuringLLMAgentLongTerm2026.md（已创建）

## 原文

- [MinerU 全文](.raw/louckSecuringLLMAgentLongTerm2026/full.md)
- [PDF](.raw/louckSecuringLLMAgentLongTerm2026/source.pdf)
