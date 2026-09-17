# 研读记录：VeryMath（GitHub 组织）——AI4Math Skill 生态与三套"记忆式"基础设施

> 本条目不是单篇论文，而是**一次组织级调研**（用户要求"详细调研 github.com/VeryMath 相关仓库"）。因此沿用 `reading/_TEMPLATE.md` 的 14 节骨架，但把"记忆结构/写路径/读路径"读作"它如何组织持久状态、如何写入、如何取用"。
> 核查日期：2026-09-17。所有事实以下列**一手来源**为准；未能核实处显式标注。

## 0. 元信息

- 对象：GitHub 组织 [VeryMath](https://github.com/VeryMath)（华东师范大学数学科学学院 / 数学与工程应用教育部重点实验室；ECNU 官方新闻 2026-07-06 称其为"数学科学学院自主研发的轻量化 AI 辅助数学科研平台"，研发者**王祥丰**教授）
- 规模：**12 个公开仓库，0 归档**（2026-09-17 快照）；34 followers；组织 profile 本身无 bio/主页字段
- 性质：**11 个是 `AI4Math-*` 的 agent-skill 库**（markdown `SKILL.md` 包，靠"跟你的 coding agent 说一句话"安装），另有 `co-mathematician`（仓库承载的数学研究工作区）与 `VeryMath-textbook-copilot`（本地教材学习台）
- 一手来源（本次逐个 fetch 核验）：
  - <https://verymath.github.io/>（官网首页，含 2026.08 "DeepSeek Harness × VeryMath" 公告）
  - <https://github.com/VeryMath/co-mathematician> 的 README（v0.2.0）
  - `skills/math-paper-reading/skill_reference_manager.md`（文献笔记中控台）
  - `skills/math-glossary/SKILL.md`（双语术语库）
  - `skills/danus-helper-dsh/SKILL.md`（DeepSeek Harness 版 Danus 安装助手）
  - `https://verymath.github.io/handbook/HANDBOOK.zh-CN.md`（官方使用手册）
  - Danus 仓库 README（pin 到 commit `7a51336…`）+ arXiv:2607.06447 摘要
- 阅读方式：**网页/仓库文档通读**（非 PDF）。三份**二手元数据**（OptSkills 摘要、star/日期计数）标注为未逐字核对。

## 1. 一句话定位

VeryMath 是**高校数学学院做的"Agent–Skill–Harness"工程体系**：把数学科研能力拆成一堆可被 coding agent 自动发现并执行的 markdown `SKILL.md` 包，再用少数几个"独立程序"（研究工作区、教材学习台、术语库）承载持久状态。它对我们最有价值的**不是**任何单点算法，而是两件事：**① 一套已经规模化的"技能即说明书"工程范式；② 三处与我们的设计高度同构的持久状态契约（机器层/人类层分离、脚本中介写入、门控）。** 它**没有**分层 markdown 记忆、**没有** BM25 检索——这两块是我们的相对优势，不是我们的缺口。

## 2. 问题与动机

- 每篇论文/每个工具都自带一套提示词与流程 ⇒ 能力散落、不可复用。VeryMath 的回答是**把流程抽成 Skill 包**：`SKILL.md`（说明书）+ `references/`（参考资料）+ `scripts/`（确定性脚本）+ `templates/`。
- **Skill 只是说明书，不是运行环境**（手册明确写）：SageMath Skill 要求本机真装了 SageMath，Lean Skill 要求 Lean 4 + mathlib。这划清了"能力声明"与"环境依赖"的界。
- 数学科研的产出不能停在一次性对话里 ⇒ **"用仓库承载研究过程，让问题、假设、计算、失败尝试、评审意见和最终写作都成为可追踪的持久成果"**（官网原话）。这与我们"持久状态都是文件"的哲学**完全同向**。

## 3. 记忆结构（它如何组织持久状态）

三处"像记忆"的设计，全部是**机器契约 + 人类正文**双层：

| 载体 | 机器层（契约） | 人类层 | 备注 |
|---|---|---|---|
| `math-paper-reading` 文献库 | `local_reference_db.json`（**Ground Truth 始终是磁盘上的 JSON**）+ 笔记 YAML frontmatter（`type` / `global_uri` / `arxiv_id` / `source_json` / `json_path` / `core_theorems` / `status` / `tags`） | `memory/notes/*.md` 正文 | 笔记正文分 **L1 基础视图 / L2 逻辑拓扑 / L3 深度推导 / L4 原子链接** 四层 |
| `math-glossary` 术语库 | `glossary.json` 为唯一事实源；`term_id` 唯一标识；`source` 记"文件名+行号" | Excel 仅作**导出**供人工审阅 | 别名展开为独立行（同一 `en`，`term_id` 加 `__N`） |
| `co-mathematician` 研究工作区 | `workspace/project/{PROJECT.md, GOALS.yaml, PROJECT_STATUS.md, messages.jsonl}` + `workspace/workstreams/` + `reviews/` | `workspace/final/working_paper.md`（只从通过评审的报告渲染） | 追加式 `messages.jsonl` 相当于事件日志 |

**★ 最值得注意的一条**：文献库用**稳定类型化 URI** 做跨条目引用，而不是自然语言链接——`paper:arxiv:YYYYMM.NNNNN#Entity-Type-N`（如 `paper:arxiv:2101.00001#Lem-3.1`），并**明令禁止** `[[本文 Lemma 3.1 笔记]]` 这类中文字符串链接。

## 4. 写路径（固化）

**★ 三处独立出现的同一条纪律：写入必须经确定性脚本原子执行，模型不得整体重写机器层。** 这是本次调研**最有价值的单条发现**，因为它由三个互不相关的作者群各自独立得出：

1. `math-paper-reading` 原文：**"每次对 `local_reference_db.json` 的更新必须通过 Python 脚本原子执行，禁止 LLM 读取全量 JSON 后手工编辑并覆写"**，并附完整 `upsert_paper.py` 模板（stdin 传 JSON、UPSERT、原子写、stdout 只回 delta）。
2. `math-glossary`：`term_id` 为唯一标识、**JSON 使用原子替换**、**覆盖前先备份**（`--force` 显式确认）、写操作记 `修改记录.md`、扩充记 `扩充记录.md`（新增表 + 替换表，逐字段记"旧值 → 新值"）。
3. `co-mathematician`：Python harness **"不跑 agent，只初始化文件、追加消息、创建工作流、检查门控、渲染论文"**——确定性动作与模型动作被物理分开。

配套两条细节：
- **delta-only 输出**：脚本只回增量，用固定符号 `+` 新增 / `~` 更新 / `!` 冲突 / `⚠` 超期，无变更则不输出。**模型不需要读全量库就知道刚才发生了什么。**
- **入库前先查重与冲突检测**：术语库同 `term_id` 冲突时**逐条让用户裁决**（给出各自来源）；文献库录入新文献时与已有库做**结论级冲突预警**。

Danus（VeryMath 的 DSH 版安装助手所部署的系统）是这套纪律的极端形态（一手 README，pin commit 核验）：
- **"三层记忆，一条正确性边界：只有经验证器门控的事实图是真相；全局记忆只是认知（awareness）"**；
- **权限由 MCP 角色表强制，而不是靠提示词**：**主 agent 没有 `fact_submit`**（"负责指挥搜索的 agent 在结构上无法把未验证的数学引入事实图"），**验证器什么都不写**（只读、无状态，每个提交由全新实例判定）；
- 事实**内容寻址**（content-addressed）且**可级联撤销**；最终论文**本身**在交付前还要再经一次专门的论文数学验证器通读。

## 5. 读路径（检索）

**这一节是 VeryMath 的明显短板，也是我们不该照搬的地方。**

- `math-paper-reading`：JSON 字段/子串匹配 + 模糊检索，**不是 BM25**；无嵌入、无排序模型。
- `math-glossary`：前缀匹配（英文/中文输入即搜）+ 多义词按 `field` 与语境消歧。
- `co-mathematician`：**完全没有检索层**（无索引、无排序）；技能发现靠 `co-math suggest-skills --query`。
- SageMath Skill：`scripts/sage_ref_search.py` 在内置参考手册里检索（**内部算法未核验**）。
- 有两条"按需检索"的**产品化**做法值得注意：术语库的 Web 管理界面**默认只绑 `127.0.0.1`**，远程暴露需显式 `--allow-remote`（与我们 `docs/port-and-isolation.md` 的隔离思路同源）；文献笔记的 L2/L3 视图用 `<details>` **折叠**，默认不展开（等价于"注入导航、正文按需"）。

**结论**：我们的 `note_recall`（一次 BM25 覆盖笔记+全部记忆层、hook 字段加权、CJK 字符包含、coverage 弱信号、2 召回/3 精读纪律）在检索这一层**明显强于 VeryMath 的任何部分**。

## 6. 组织与关系

- **Skill 目录即分类法**：仓库按任务切分（Paper Reading / Optimization / Lean / Writing / Computational / Evolving / Auto-Research / MathTool / SageMath），每个仓库下 `skills/<name>/` 一包一职责，包内含自己的 README、references、scripts、templates。**9 + 6 + 4 + 2 + 3 + 2 + 1 + 1 + 1 个包**，共约 29 个技能包。
- **发现机制分层**：`.agents/skills/<skill>/SKILL.md` 与嵌套 `.agents/skills/<category>/<skill>/SKILL.md` 都能被 registry scanner 发现；全局技能根（`~/.codex/skills`、`~/.agents/skills`）只在**有意跨项目共享**时才用。
- **★ 技能移交（skill handoff）是一等公民**：`co-math skill-handoff --skill … --mode skill_guided --reason … --query … --skill-path …` 落一条 `skill_handoffs.jsonl`。语义是：**当任务被判定属于某个领域 Skill 的辖区，就记录移交，之后按该 Skill 自己的流程走；只有用户想要"持久研究产出"时才启用完整的目标/工作流/评审流程。**
- 文档层同样双轨：`docs/`（人读）与 `AGENTS.md`/`.agents/skills/`（agent 读），平台适配器（`.codex/`、`.claude/`、`.cursor/`）只是开发期外壳，**规范位置只有一处**。

## 7. 维护与自改进

- **`co-mathematician` 的门控是状态机，不是提示词**：**"草稿目标不可执行。目标只有在 `status: approved` 时才能接收工作流。"** 命令 `co-math check-gate --gate goal_approval --goal-id G1` 可被程序检查；另有 `workstream_completion` 门。工作流四类（`proof`/`computation`/`literature`/`review`）；**每份报告必须带来源溯源、显式不确定性、失败尝试记录，以及 `reviews/` 下的独立评审**；`render-final` 只从通过评审的报告渲染 `workspace/final/working_paper.md`。
- **陈旧/冷落提醒**（文献库）：`待读 → 略读中 → 精读中 → 已归档` 四态 + `last_interacted`；**捕获时 7 天未读提醒，`精读中`/`重要` 超 30 天未互动给"冷落提醒"**，并给四个处置选项（继续/降级/归档补笔记/确认放弃移出）。
- **版本演进公开**：`co-mathematician` 有 CHANGELOG 式的 Version Updates（0.1.0 → 0.2.0）；术语库有 `修改记录.md` + `扩充记录.md` 作为**变更台账**。
- **反造假纪律**：文献库对取不到的元数据**强制填 `[UNKNOWN]`**，"严禁大模型根据预训练记忆推测或编造"；术语库规定"**AI 例句属于待审阅建议，不得当作原始文献证据**"；Lean Skill 规定最终补丁**不得引入 `sorry` / `admit` / 新公理，也不得悄悄改动定理陈述**。

## 8. 验证与质量门控

VeryMath 的组织级主题就是**"验证优先"**，但形态与我们不同：

| 机制 | 出处 | 性质 |
|---|---|---|
| 目标必须 `approved` 才能开工 | co-mathematician | **确定性门（程序可查）** |
| 工作流完成门 + 独立评审目录 `reviews/` | co-mathematician | **确定性门 + 角色分离** |
| 评审角色分工：logic / adversarial / citation / computational | co-mathematician | 角色分离 |
| 只有验证器门控的事实图是真相；主 agent 无 `fact_submit` | Danus | **权限强制（结构性），非提示词** |
| 最终论文再经一次论文数学验证器通读 | Danus | 二级验证 |
| Lean 补丁不得含 `sorry`/`admit`/新公理/陈述漂移 + 本地 `verify-delivery` | AI4Math-Lean-Agents | **确定性校验** |
| 术语冲突逐条用户裁决；覆盖前备份 | math-glossary | 人机协同门 |
| 数学结果必须来自 runner 输出，不得来自模型猜测 | AI4Math-Sagemath | **证据接地** |
| 写完自检清单（每 skill 末尾的 checkbox 清单） | math-paper-reading 等 | 模型自检 |

**与我们的对照**：我们的 `verified` 三级（`single-source → cross-referenced → user-confirmed`）+ `verified_by` 凭据 + 体检的"越权升级"检测，在**卡片级**上比它们更细；它们比我们强的是 **① 门控是状态机可程序检查**、**② 权限分离落到工具表（agent 结构上做不到）**、**③ 失败尝试与不确定性是报告的必填项**。

## 9. 成本 / 安全 / 隐私

- **本地优先**：教材学习台"所有数据留在你自己的电脑上（默认 `~/.course-copilot/`），用你自己的 Agent 账号"；术语库 Web 界面**默认只绑 loopback**，远程暴露需显式授权；不直接发布可能受版权约束的语料。
- **凭据纪律**：手册明确"需要账号登录的环节由你本人完成，**不要把 API key 交给 agent 写进仓库**"；术语库"不得读取未明确提供的密钥，不得把密钥写入术语库、日志或命令输出"。
- **依赖安装需先征得同意**："不得自动安装依赖"（术语库）；"涉及下载、装环境、创建 conda 环境的操作，先看清楚再批准"（手册）。
- **Danus 的相反一极（值得记录的风险样本）**：它的**预期运行模式**是 `--dangerously-bypass-approvals-and-sandbox`（无逐动作审批），README 自己警告"agent 会以你的 shell 权限行动，请在隔离可弃主机上运行"。
- 成本：本调研未做成本测量；VeryMath 未公开 token/成本数据。

## 10. 关键数字 / 阈值

- 组织：12 公开仓库 / 0 归档 / 34 followers；约 29 个 skill 包。
- Star（2026-09-17 快照，二手计数）：`verymath.github.io` 20、`AI4Math-Sagemath-skill` 11、`AI4Math-Optimization` 9、`co-mathematician` 8、`AI4Math-Auto-Research` 8、`VeryMath-textbook-copilot` 8、`AI4Math-Writing` 7、`AI4Math-Lean-Agents` 7、`AI4Math-Paper-Reading` 4、`AI4Math-Evolving` 3、`AI4Math-Computational-Mathematics` 1、`AI4Math-MathTool` 1。
- 学术：OptSkills **103 个优化问题原型**（EMNLP 2026 Findings，arXiv:2605.29829，VeryMath 官网与 `SOURCES.md` 双向确认标题与作者）；Danus 真实研究运行的事实图 **3,157 条已验证事实 / 8,616 条依赖边 / 依赖链最深 54 条**，其中 **664 条**构成最终定理的支撑闭包。
- 文献库阈值：**7 天**未读提醒、**30 天**未互动冷落提醒；笔记四态；URI 形如 `paper:arxiv:YYYYMM.NNNNN#Thm-1`。
- 术语库：`term_id` 唯一；别名加 `__N`；Web 默认 `127.0.0.1:7788`。
- 教材学习台：Node ≥ 22.13；默认 `~/.course-copilot/`；服务默认 `127.0.0.1:4173`；v0.1.0（macOS 预览）/ v0.1.1（Windows 预览）。
- Danus 适配：pin 到 `frenzymath/Danus` commit `7a51336e53cd1d558d0e766a61eb0fed46ebb05b`（tag `v0.1.0-codex`），面向 **DSH 0.1.0-rc.5 / rc.6**；安装记录写 `$DSH_HOME/danus-helper-dsh.toml`，技能装到 `$DSH_HOME/skills/danus-helper-dsh`；用 DSH 官方 `schedule_create`/`schedule_list`/`schedule_delete` 做定时唤醒。

## 11. 评估方法

- 本条目无 benchmark；可评估的是**工程方法的可迁移性**，判据是"是否与我们的既有纪律同构、是否可零 token 落地"。
- 它与我们**独立收敛**到同一组结论，这一点本身就是证据（见 §13 第 1 条）。
- ⚠️ 未核实：OptSkills 摘要逐字内容；`sage_ref_search.py` 与 `harness/co_math/skills.py` 内部算法；是否有私有仓库；组织 owner 身份；VeryMath 是否以组织名义发表过论文（未找到）。

## 12. 可迁移机制清单

1. **★ 脚本中介写入 + 禁止模型整体重写机器层**（三处独立出现）。我们已有"确定性维护在插件、三写协议给模型"的分工，但**没有把它写成显式契约**。应当把这条纪律写入 `vault-AGENTS.md` 与 `design.md`：**机器统计字段（`uses`/`success_rate`/`last_used`/`harmed`/`verified_by`）只由插件原子改写；模型只能提案，不能整体重写索引或 frontmatter 统计**。
2. **★ 增量（delta-only）报告契约**：`+ / ~ / ! / ⚠` 四符号 + "无变更不输出"。我们的体检报告与"已记录：N 条"是同类意图，但**没有固定符号与"无变更即静默"的契约**。这是**零 token** 且直接改善"模型如何知道刚才发生了什么"。
3. **★ 门控做成可程序检查的状态机**：`status: approved` 才可执行 / 可接收工作流。我们的 `strategy/` 有 `candidate → active`、`inbox → polishing → done`、`active / superseded`——**已是状态机**，但**没有一条"未达状态即结构性禁止"的显式规则**（例如 candidate 策略不得作为依据注入）。可补一条硬规则 + 断言。
4. **★ 角色/权限由构造强制，而非靠提示词**（Danus）：主 agent 无 `fact_submit`、验证器只读。对应我们：**"统计字段模型不可写"应当由体检的越权检测强制执行**（我们已有"越权升级"检测，可扩展为"任何统计字段被模型改动即报"）。
5. **★ 内容寻址 + 级联撤销**（Danus）：事实内容寻址、被撤销时**级联**。这对我们一个**尚无解**的真问题：一条 records 被 `superseded` 或一个定理被推翻后，**下游哪些模板卡/策略卡/笔记依赖它、需要复审？** 我们只有 `related` 双链，没有依赖方向与级联。
6. **★ "失败尝试"与"不确定性"是产出的必填项**：`co-mathematician` 要求每份报告显式保留失败探索与不确定处。我们已有反模式与 `confidence`，但**未要求把"试过但没成功"结构化成产出**——这与我们「技巧调用体系」的 `avoid` 侧互补。
7. **★ 稳定类型化 URI 替代自然语言链接**：`paper:arxiv:…#Thm-1`，且明令禁止中文字符串链接。我们的 `related: []` 是自然语言/双链，**跨文献引用没有稳定 ID**。文献库已有 `citekey` 做 ID，但**没有到"定理级实体"的粒度**。
8. **冷落/陈旧提醒的阈值与处置选项**（7 天 / 30 天 + 四个处置选项）。我们 inbox 陈旧 7 天、polishing 3 天已有；**文献库侧没有**——我们的 `reading/` 与 `cards/` 目前**无状态提醒**（`.index.json` 的 status 是机器默认 `unread`，已知现象）。这条能直接补上文献库的生命周期。
9. **技能移交记录 `skill_handoffs.jsonl`**：把"这个任务移交给某个领域技能，之后按它的流程走"落成一条可追溯记录。我们的 `note_strategy` 命中后"按清单逐步 note_recall"是同类动作，**但没有留下移交记录**（无法回答"这次为什么走了策略路线"）。
10. **"Skill 只是说明书，不是运行环境"**：显式分离"能力声明"与"环境依赖/前置条件"。我们的策略卡只有 `not_applicable_when`（负向），**没有前置条件（正向）**——可补 `preconditions`。

## 13. 与 dsh-math-memory 的映射与差距

**★ 最重要的判断：VeryMath 不是我们的上游，也不是同一层的竞争者；它是"同一哲学在另一个场景的成熟实现"，与我们构成"独立收敛"。**

1. **独立收敛 = 我们架构成立的外部证据**。VeryMath 的三处持久状态设计都落在我们已有的原则上：**机器契约 + 人类正文双层**（= 我们的 frontmatter ↔ 正文）、**Ground Truth 在磁盘文件**（= 我们"持久状态都是文件"、`design.md` §9）、**确定性维护与模型动作分离**（= 我们的插件不调模型 + 体检）。三个互不相关的作者群各自得出这些结论，说明**这不是我们的任意选择，而是这类系统的稳定解**。这一条可以直接写进设计文档作为论据。
2. **能力边界互补而不冲突**：它们的强项是**技能工程**（29 个包的规模化、`SKILL.md` 范式、技能移交、门控状态机）与**权限强制**；我们的强项是**分层记忆 + 统一检索 + 卡片级验证分级 + 体检**。**VeryMath 全无 BM25、全无分层 episode/inbox 记忆、全无 hook 字段加权**——我们不必在这些方向向它学习。
3. **`math-paper-reading` 的文献笔记 ≈ 我们 `literature/` 的一个更弱版本**：它同样有 frontmatter 契约、状态生命周期、溯源、冲突检测、检索——但检索是 JSON 子串匹配而非 BM25，且**没有"研读→蒸馏→记忆回流"闭环**（我们有 `cards/` + `reading/` + 回流到 records/hook 的路径）。**我们的 `docs/literature.md` 流程在其之上。**
4. **我们确实缺的三块**：① 写入的**原子性与"禁止模型整体重写"契约**（§12.1–2）；② **依赖方向与级联复审**（§12.5）；③ **实体级稳定 URI**（§12.7）。这三块都**零 token 可落地**。
5. **我们不采纳的**：JSON/SQLite 作为事实源（markdown 文件是我们的特性）；把技能装进 agent 的全局 skills 目录再由 agent 发现（与我们的 preset/工具面设计不兼容，且会扩大工具面）；多 agent 蜂群编排（我们的场景是单用户数学学习，不是研究级并行证明搜索）。
6. ⚠️ **命名冲突（事实陈述，非建议）**：`dsh-math-memory` 这个 npm 包名与 `notes-assistant` 这个 preset 名对应的是另一个仓库 `maple110011/dsh-obsidian-math`（v0.7.5，MIT），与 VeryMath 无关。本仓库即该项目。

## 14. 行动项

**C1（零 token，最高优先）— 把"写入原子性 + 模型只提案"写成显式契约。**
- 改哪里：`dsh/templates/vault-AGENTS.md` §5（三写协议）、`dsh/templates/records-readme.md`、`dsh/templates/strategy-readme.md`、`docs/memory/design.md` §5。
- 做什么：明文规定——**机器统计字段只由插件确定性原子改写（读-改-写整文件，不做部分拼接）；模型只提案内容，不得整体重写索引文件或统计字段**。并给出**任一处被模型改动即由体检报出**的检测（扩展现有"越权升级"检测）。
- 判据：`test-memory.mjs` 构造"模型改了 `uses`"的场景 ⇒ 断言体检报出；**变异验证**（AGENTS.md §6）。
- 为何优先：三处独立来源得出同一结论，且是我们当前契约里唯一没写明的部分。

**C2（零 token）— 体检与写入回执的增量契约 `+ ~ ! ⚠`。**
- 改哪里：`math-memory.mjs`（体检报告生成）、`vault-AGENTS.md`（回执格式）、`docs/memory/design.md` §8。
- 做什么：确定性维护动作只输出增量：`+` 新建 / `~` 更新 / `!` 冲突 / `⚠` 陈旧未提醒；**无变更则不输出**。
- 判据：`test-memory.mjs` 断言符号与"无变更静默"。

**C3（零 token）— `strategy`/`inbox` 状态机补"未达状态即结构性禁止"。**
- 改哪里：`strategy-readme.md` + `vault-AGENTS.md` §5 + 体检。
- 做什么：`status: candidate` 的策略卡**不得**作为结论依据注入（只可作为"待验证线索"列出）；`done` 的 inbox 条目不得再被当作活跃备忘。给出可程序检查的规则与断言。
- 判据：构造 candidate 卡 + 命中查询 ⇒ 断言它出现在"线索"而非"依据"。

**C4（零 token，需设计）— 依赖方向与级联复审。**
- 改哪里：`records-readme.md` / `templates-readme.md` / `theorems-readme.md`（新增"依赖"字段方向）、`memory-admin.mjs`（体检级联）。
- 做什么：卡片显式记录**它依赖哪些卡**（不只是 `related` 双向）；当某卡 `superseded`/被推翻/降级时，体检**列出下游待复审清单**。这是我们现在**完全没有**的能力，且直接服务 1.0 的"可纠错"。
- 判据：构造 A ← B ← C 依赖链，把 A 标 `superseded` ⇒ 断言体检列出 B、C。

**C5（零 token）— 文献库状态提醒与实体级引用。**
- 改哪里：`docs/literature.md` §5/§8（流程）、`literature/index.md` 的 status 语义、`scripts/lit-import.mjs`（如需）。
- 做什么：① 给 `cards/*.md` 的研读状态加**陈旧提醒**（`unread` 超 N 天、`reading` 超 M 天），并在索引/README 里可见；② 讨论是否把跨文献引用从自然语言升级为**稳定 ID**（`citekey` 已有；是否要到定理级由你定）。
- 判据：文献库索引能列出"陈旧卡片"；`check-doc-consistency.mjs` 不漂移。

**C6（零 token）— 策略卡补 `preconditions`（正向前置条件）。**
- 改哪里：`strategy-readme.md` + `note_strategy` 的匹配逻辑（可选）。
- 做什么：与 `not_applicable_when`（负向硬门控）配对，补**正向前置条件**（"要能用这条，先得有什么"）——对应 MSCE 技能的 `φ`（触发）与前置条件分离、Danus/术语库的"Skill 只是说明书，环境依赖另说"。
- 判据：断言前置条件不满足时策略降权而非硬排除（与负向门控区分）。

**C7（记录，零 token）— 把 VeryMath 作为外部论据写进设计文档。**
- 改哪里：`docs/memory/references.md` 新增 §13；`docs/memory/design.md` §9 或 §5 的脚注。
- 做什么：用"三个独立来源都得出机器层/人类层分离 + Ground Truth 在文件 + 脚本中介写入"支撑我们的设计选择；把 VeryMath 的**能力边界**（无 BM25、无分层记忆）作为"我们这两块是相对优势"的对照。
- 判据：文档引用可点、事实与本文一致；**不要把它写成"对手"或"上游"**——它是相邻实践。

**C8（不采纳，记录理由）— 不引入 JSON/SQLite 事实源、不引入蜂群编排、不改技能发现方式。**
- 理由：markdown 文件是我们的特性；单用户学习场景不需要并行证明搜索；把技能交回 agent 全局发现会扩大工具面、破坏我们 `preset` 的最小工具面与 fail-closed 姿态。**记进 `docs/handoff.md` §7 的"已评估、不采纳"，防止后续重复讨论。**
