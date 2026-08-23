# 研读记录：wangMemTrapBenchBenchmarkingCognitive2026

## 0. 元信息

- citekey：wangMemTrapBenchBenchmarkingCognitive2026
- 标题：MemTrapBench: Benchmarking Cognitive Traps in LLM Memory Use
- 年份：2026（arXiv:2608.20202）
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（.raw/wangMemTrapBenchBenchmarkingCognitive2026/full.md）

## 1. 一句话定位

提出基准 MemTrapBench 测「记忆诱发的认知陷阱」——即使记忆被忠实记录且语义相关，也可能在「使用」阶段锚定推理（Reasoning Fixation）或扭曲信念（Belief Distortion），让「有记忆」比「无记忆」更差；并给出推理期 prompt 缓解法 AdaptiveMem。

## 2. 问题与动机

现有记忆基准（LOCOMO/LongMemEval/MemBench 等）测的是「抽取、存储、更新、检索」是否正确，而简单检索基线就能赢，说明它们没测到记忆的「下游效应」。作者追问一个被普遍忽略的问题：检索回来的记忆**如何重塑模型在当前任务上的推理**？他们证明记忆可因「认知陷阱」而降低性能，且这与「记忆管理错误」（过期/错误/漏检）互补——前者的失败在于「记忆本身没问题，但被用错了地方」。

## 3. 记忆结构

- 论文把记忆管理抽象为三段：抽取 `E` → 更新 `U` → 检索 `R`，再叠加「使用」段 `G(x, M)`——这是它与所有只测前三段基准的分界。
- 评测的 5 个框架（实现无关）：FullText（全量交互史）、LightMem（分阶段压缩+合并）、MemOS（异构统一记忆系统）、SimpleMem（结构化语义压缩+query-aware 检索）、EverMemOS（分层组织、长程推理）。
- 陷阱分类法（这是最有价值的部分）：
  - **Reasoning Fixation**：记忆把模型锚在既有推理模式上。跨任务 = Task Boundary（旧任务规则/格式/假设残留）；任务内 = Cognitive Bias（旧成功策略过度泛化）+ Trauma（负面反馈 → 回避正确策略）。
  - **Belief Distortion**：记忆改变模型「何为真」。Safety = 历史里反事实/沙箱专属前提覆盖基本安全判断。

## 4. 写路径（固化）

- 论文不规定写入纪律，反而揭示「忠实写入」本身不足以防止陷阱——写入无误的记忆照样有害。
- 构造的陷阱正是靠「反复应用 + 权威语气」把 prior 固化进历史（Plant the Trap 阶段反复强化、Bury in Noise 阶段让其沉淀），对应我们三写协议里「profile 反复强化稳定偏好」的风险面。
- 关键反例清单：格式残留（Task Boundary 的 XML 模板泄漏）、策略惯性（24 Game 只用基本运算不用阶乘）、负反馈泛化（一次「你杀了他」导致全盘回避肾上腺素）、沙箱前提泄漏到现实。

## 5. 读路径（检索）

- 五个框架各自有检索/压缩策略，但**检索相关度越高 ≠ 越安全**——语义相关且正确的记忆恰恰是陷阱的载体。
- FullText（无检索、全量注入）反而最差，说明「多注入」不解决、甚至加重陷阱。
- 我们的 note_recall（BM25 + hookPrior）落在「语义相关 + 验证加权」象限，正是论文指出的「最易诱发固定」的配置，缺「适用性」第三维。

## 6. 组织与关系

- 陷阱根因是「记忆与当前 query 的边界没有被重新评估」：Task Boundary 是任务边界未识别，Cognitive Bias 是适用边界未识别，Trauma 是情绪史未与正确性解耦，Safety 是沙箱/现实边界未识别。
- 对应我们：operator 硬过滤是一个「任务边界」原语；但缺「适用边界」「正确性优先」「沙箱/现实边界」三个。

## 7. 维护与自改进

- 论文给出 AdaptiveMem 作为「使用阶段的维护」：不在存储/检索上动刀，而是在推理前加一道「记忆适用性自检」。
- 决策流程（可原文照搬）：① 从最新 query 单独识别当前任务；② 只保留明确相关且不被当前 query 推翻的 prior；③ 当记忆与 query 冲突，优先客观真值/安全/当前 query/最小上下文。
- 对照我们：promote/demote 维护的是「记忆本身的质量」，AdaptiveMem 维护的是「记忆是否适用于当前 query」——我们缺后者。

## 8. 验证与质量门控

- 评测用 LLM-as-judge（GPT-5.2）+ 交叉一致（Claude-Sonnet-4.6），四维 0–5（正确性/格式/相关性/效率），方向与幅度双判一致。
- 质检：GPT-5.4 只做候选生成，纳入靠「两阶段质检 + 专家复核」；gold-standard 从 query 独立可答，隔离「任务难度」与「记忆影响」。
- 对照我们：verified 三级（single/cross/user-confirmed）门控的是「记忆是否被验证」，缺「验证过 ≠ 当前适用」这一层——论文的 Safety 场景里，历史前提甚至可能被「确认」过。

## 9. 成本 / 安全 / 隐私

- AdaptiveMem 是 prompt，零 token 增量（一次注入）、零架构改动、可挂进任意框架。
- Safety 场景直指安全：错误前提覆盖真实安全判断是真实风险，不是学术玩具。
- 合成数据规避真实隐私；编码长对话昂贵 → 主集只测最长场景。

## 10. 关键数字 / 阈值

- 1,050 例：Cognitive Bias 350 / Task Boundary 350 / Safety 200 / Trauma 150。
- Gemini-3-Flash-Preview：wo/Mem 85.16 → EverMemOS 71.17（最强，仍跌 13.99）、LightMem 70.11、MemOS 60.67、FullText 60.68、SimpleMem 54.69。
- Qwen3-30B-A3B：wo/Mem 81.83 → LightMem 70.13（最强）。
- 消融（Task Boundary 子集）：wo/Mem 92.29 ≈ no-trap 94.39，trap 版 31.05（证明退化来自陷阱语义而非长度）。
- 长度：25% 记忆 36.03 → 100% 31.05（单调下降，主要落差在 25%→50%）。
- AdaptiveMem 增益（Gemini）：FullText +11.8 / LightMem +14.9 / EverMemOS +11.3；LongMemEval 四升两平，最高 +4.0。
- 四维权重等权；judge 一致性：GPT-5.2 跌 61.24 点 vs Claude 跌 55.50 点，方向一致。

## 11. 评估方法

- 有/无记忆对照（s(ŷ_M) vs s(ŷ_∅)）是核心方法——我们可借鉴为「note_recall 命中后，是否比不注入更差」的被动信号。
- 有/无 trap 对照（no-trap control）隔离「上下文长度」vs「陷阱语义」——可借鉴为回归测试结构。
- 长度缩放、双 judge 交叉、失败模式标注（gold + expected failure）。
- 可借鉴被动信号：note_recall 命中后答案质量是否下降、是否出现「格式残留」「策略惯性」等固定特征。

## 12. 可迁移机制清单

1. **AdaptiveMem 四风险 + 决策流程**原样搬进 AGENTS.md（§5 检索路由 + §8 回答纪律）与注入段——这是零成本、最高收益的一条。
2. **适用性第三维**：note_recall 返回结果给「与当前 query 的适用性」弱信号（如 operator 不匹配时标注「跨算子，需重新评估」），而非只给 verified/score。
3. **`wrong` 反馈语义细分**：区分「此卡在此上下文错误」vs「此卡本身错误」，避免 blunt 减半造成 Trauma 式过度回避（错在当下的反馈只记 context 不降全局 success_rate）。
4. **Belief Distortion 兜底**：注入段加「客观真值/数学定义/安全优先于记忆；记忆里的定义若与公认定义冲突，以公认定义为准并提示用户」。
5. **有/无记忆对照被动信号**：记录「注入记忆后答案被 judge 判定更差」的比例，作为体检的「固定/扭曲」健康指标（类似现有空结果率）。
6. **陷阱压力样例**：造 Cognitive Bias/Task Boundary/Trauma 三类的数学版样例（如「旧题用积分技巧、新题其实一步基本不等式」），纳入引擎探针。
7. **operator 硬过滤升级为「任务边界守卫」**：跨主题提问时提示模型「不要沿用上一主题的技巧/记号」。

## 13. 与 dsh-math-memory 的映射与差距

- **采纳**：AdaptiveMem 四风险 + 决策流程（写入 AGENTS.md + 注入段）；「适用性」作为 note_recall 返回的第三维；Belief Distortion 客观真值兜底。
- **改造**：`wrong` 反馈从 blunt 减半改为「全局错误降级 + 上下文错误只记 context」；promote/demote 加「适用性/新近度衰减」作为固定效应的反制；operator 硬过滤强化为任务边界守卫。
- **不适用**：他们实现无关、只评最终答案，我们有固定五层 schema 与确定性体检，不能照搬「不规定结构」；FullText 最差不意味着我们该去掉注入——而是注入要带「适用性提示」。
- **差距**：我们整个 promote/demote/verified 闭环都假设「验证过 + 相关 = 该用」，完全没建模「验证过 + 相关 + 不适用」这一象限——这是本篇指出的最大盲区。

## 14. 行动项

1. 在 AGENTS.md 检索/回答纪律与注入段加入 AdaptiveMem 式「四风险 + 决策流程」，重建 main.js（这是最高优先、零架构改动）。
2. note_recall 返回增加「适用性」弱信号（如 operator/主题与当前 query 不匹配时标注），并把「跨算子命中」作为低适用性处理。
3. 把 `wrong` 反馈拆成「此卡错（全局降 success_rate）」与「此上下文不适用（只记 context，不降全局）」，避免 Trauma 式过度回避。
4. 注入段加「客观真值/公认数学定义优先于记忆」的 Belief Distortion 兜底句。
5. 造 3 类陷阱压力样例（Cognitive Bias / Task Boundary / Trauma 的数学版）进引擎探针回归。
6. 体检新增「记忆诱发退化」被动信号（有/无记忆对照的答案质量），作为固定/扭曲健康指标。
