# 研读记录：juAutomatedConjectureResolution2026a

## 0. 元信息

- citekey：juAutomatedConjectureResolution2026a
- 标题：Automated Conjecture Resolution with Formal Verification
- 年份：2026
- 阅读日期：2026-08-23
- 阅读方式：MinerU 全文通读（.raw/juAutomatedConjectureResolution2026a/full.md）

## 1. 一句话定位

非形式推理 agent（Rethlas）+ 形式化验证 agent（Archon）端到端解决研究级数学问题并 Lean 4 验证；核心主张：强定理检索（Matlas/LeanSearch）能发现跨领域技术，形式 agent 能自动填补非形式证明的缺口，近乎无人干预地解决 Anderson 开问题。

## 2. 问题与动机

NL 推理有歧义、LLM 易幻觉，研究级结果难可靠验证（专家也可能误判、审稿也出错）；需要机械化、无歧义的框架。目标：非形式 agent 提候选证明，形式 agent 转 Lean 4 并由内核保证正确。

## 3. 记忆结构

- Rethlas 工作记忆：中间产物（toy example、counterexample、子目标分解计划），显式「写入记忆 + 需要时查询」，跨推理步复用。
- Archon 持久记忆：全局 status 文档（整体 workflow 阶段、每文件证明状态、本地 sorry 消除/重构记录）；每 session 强制写 summary；Review Agent 跨 session 合成趋势。
- 参考管理：初始化时人类备论文（agent 辅助），agent 检索补充；候选证明路线与原始参考文献分开存放；按任务只加载相关材料。
- 双层知识：非形式（arXiv ~13.6M 语句向量库 Matlas）与形式（Mathlib 定理/定义 LeanSearch 模糊检索）。

## 4. 写路径（固化）

- 强制日志：缩短 Lean–Plan 迭代时长，每 session 写 summary。
- 全局状态文档跨 session 持久；Review Agent 在 session 边界合成（不改形式化本身，只给 Plan Agent 策略依据 + 人类进度视图）。
- 失败方法/学到的技巧持久化，跨 context compression 与重启存活。
- 候选证明路线记入专门位置，与源文献分离。

## 5. 读路径（检索）

- Matlas：对数学语句语义检索（embedding + cosine 近邻），比 web 检索更细粒度、更结构化；先查 Matlas，再 web 补背景与参考文献。
- LeanSearch：对 Mathlib 定理/定义模糊检索，判断「库中是否已有结论」，决定调库还是从零 formalize。
- 读纪律：不只读定理陈述，还要读证明提取技巧/构造/归约；展开定义、核对术语跨语境一致性。

## 6. 组织与关系

- 技能（skills）= 推理原语（造 toy example、反例、搜结果、分解计划、直接证明、递归证明、识别关键失败），互连而非固定顺序。
- 双 agent 分工：Plan Agent 新上下文分解 + 定向指导；Lean Agent 受限范围执行，避免上下文污染与任务厌恶。
- 三阶段：Scaffolding（sorry 占位分解）→ Proving（Plan/Lean 迭代、可并行）→ Verification & Polish（无 sorry/axiom、抽取可复用引理）。

## 7. 维护与自改进

- Review Agent 跨 session 检测「停滞」（只在连续 session 才显形的模式）→ 触发 Plan Agent 调策略。
- 自我诊断 + 跨 session 重构：Zorn + 可数假设失败后，自行换 well-founded 递归 + 基数算术。
- 发现替代证明策略（Krull 域 → Kaplansky 判据），绕过 Mathlib 缺基础设施。
- 人类可像带研究生一样给方向/指错误/给参考文献，不必写形式细节。

## 8. 验证与质量门控

- 双层：lake build 全过（内核证明、无 sorry/axiom 逃逸）+ Comparator 对照人工审过的简化规范（Challenge.lean）核对定理陈述忠实性。
- 人工仅审顶层定理陈述与关键定义（~5 分钟/题），内核保证其余。
- 数据防污染：FirstProof（当时无公开解）选 P4/P6。

## 9. 成本 / 安全 / 隐私

- Anderson 形式化 ~80h、3×Claude Code Max（$200/月，各约 70% 周配额）；P4 50h/$1200、P6 30h/$750（Claude Opus 4.6 per-call）。
- 唯一人工干预：下载付费 PDF + 自动 OCR 转 Markdown，无数学判断。
- 对照：专家 ~150–250 行 Lean/天，19k 行 ≈ 数月人工。

## 10. 关键数字 / 阈值

- Matlas 语料 ~13.6M 语句（arXiv 定义/命题/定理/推论/例子/注记）。
- Mathlib >267k 定理、127k 定义、770+ 贡献者。
- Anderson 证明：~19,448 行 Lean、42 文件、~80h；非形式发现 45 分钟。
- 消融：人工蓝图分支 2h12m vs 自主 3h43m（约 +70%），且 agent 未采纳建议路线，只选择性吸收可用中间结论。
- P4 50h、P6 30h；Rethlas 代数群题 44 分钟；p-adic 定理把 g≫r 强化为 g≥r²+1。

## 11. 评估方法

- 案例研究为主：开问题（Anderson）+ FirstProof 两道研究级形式化 + 代数群新题 + p-adic 探索。
- 验证指标：lake build 通过、无 sorry/axiom、Comparator 规范匹配、代码行数/文件数/时长/成本。
- 对比：GPT-5.5 Pro 网页版对代数群题给出完全错误证明。
- 可控消融（人工蓝图 vs 自主）量化人机协作加速。
- 可借鉴被动信号：连续 session 停滞检测、每 session summary、候选路线 vs 死路计数、检索命中是否跨域。

## 12. 可迁移机制清单

1. 每 session/每轮强制写 summary + 全局「进度文档」：给长期解题任务加 progress ledger（当前阶段、每子目标状态、已尝试路线）。
2. 每日体检升级为「跨 session 合成」：在扫描 records/templates/inbox 之外，加会话级停滞/重复尝试检测。
3. 失败路线持久化：新增「负结果/失败方法」记录类型（或用 artifact+tag），避免重复探索同一死路（对应论文「反复走死路」痛点）。
4. 候选路线与源文献分离目录：笔记中把「尝试中的证明路线」与「已确认定理/源」分开存，读时按需加载。
5. 双 agent 上下文隔离：note_recall 精读协议已近似「蒸馏→读少量→改写」，显式加「规划上下文（新）与执行上下文（受限）分离」。
6. 检索不只读陈述、还读证明：note_recall 的 kind-aware passage 增加「证明技巧/构造/归约」字段，支持跨域技术迁移。
7. 双层验证：把「机器可查（结构/链接/索引）+ 人工可审最小规范（顶层陈述）」组合，对应 verified 升级的 cross-referenced 层。
8. 跨域定理检索：Matlas 式语义向量检索补强 theorems 索引的 BM25，发现「表面不相关但可迁移」的定理/模板。

## 13. 与 dsh-math-memory 的映射与差距

- 采纳：session summary + 进度文档；失败路线持久化；候选路线/源分离；停滞检测；证明内「技巧/构造」字段。
- 改造：Matlas 语义检索 → 给 theorems/templates 加向量相似检索（BM25 只覆盖表面词）；Review Agent → 每日体检已类似，把扫描对象从 records 扩到「会话日志/进度文档」；双层验证 → 无 Lean 内核，用「结构确定性校验 + 人工审顶层结论」近似。
- 不适用：Lean 4/Mathlib/内核证明是形式化管道，dsh-math-memory 是 markdown 记忆助手，无编译器可查；80h/数千美元预算与单次右侧栏交互不符。
- 差距：我们缺「负结果/失败方法」与「长任务进度」记忆；缺语义向量检索；verified 升级靠用户参与，可加「机器可查的结构证据」自动升 cross-referenced。

## 14. 行动项

1. 新增 record 类型或 tag：`failed-approach`（负结果），capture-policy 要求记录「试过什么 + 为何失败」。
2. 增加「progress」层或 artifact：长证明/长题记录 workflow 阶段 + 每子目标状态，随 session 更新。
3. 体检加「停滞检测」：同一题目连续 N 轮同一检索/同一路线，flag 并提示换策略。
4. note_recall 为 theorems/templates 增加可选向量相似检索（BM25 之上），服务跨域发现。
5. 捕获 hook 的 techniques/applications 字段强化为「证明技巧/构造/归约」显式字段，读时随 theorem 一起取。
6. 探索「机器可查证据自动升 verified」：结构校验通过（source 存在、链完整、已入索引）可自动标 single-source→cross-referenced 候选，仍须用户确认 user-confirmed。
