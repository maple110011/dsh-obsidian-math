# 记忆系统 v2 改造方案（检索式记忆 + 自维护记忆）

> 状态：**方案定稿，部分已实现**。设计依据：Dual RAG（EMNLP 2025 Findings）+ ISM（arXiv:2606.31191），结合本项目隐私/fail-closed 约束做的本土化。
> 与代码的对应关系见文末实现状态表。

## 1. 目标

1. **读**：从“每轮全量注入约 19K 字符”改为“静态瘦身 + 按问题检索 top-k”（ISM 式两级检索 + Dual RAG 式查询/上下文增强）；
2. **写**：从“模型自觉三写”改为“确定性体检/维护 pass + 模型执行 + 验证等级门控”；
3. **管**：用户对记忆可见、可溯源、可纠正（记忆控制面）。

三条原则：不破坏 fail-closed 安全边界；不引入外部服务/embedding 依赖（后置可选）；与现有 AGENTS.md 增量兼容。

---

## 2. Hook schema：记忆卡的检索特征（ISM 的 feature hook）

在 `records/<slug>.md` 与 `templates/<slug>.md` 的 frontmatter 中增加可选 `hook:` 块。**内容与检索特征分离**：正文/策略描述保持稳定，hook 字段随使用在线更新。

```yaml
---
id: rec-slug
type: artifact
# ……现有字段……
hook:
  operator: number-theory        # 算子类型：代数/数论/几何/组合/概率/分析/统计/计算，一级硬过滤键
  pattern: subsequence_argument  # 结构模式（如 optimization / evaluate_expression / two_agents_combined）
  heuristics:                    # 启发式签名（ISM 权重 0.15）
    - decompose
    - work_backwards
  quantity: sum-of-independent-rvs   # 数量签名（ISM 权重 0.05）
  techniques:                    # Dual RAG 上下文增强：这张卡里证明/解法用到的可迁移技巧
    - borel-cantelli
    - subsequence-trick
  applications: 证明 a.s. 收敛类问题   # Dual RAG 查询侧对齐：挑战描述
  uses: 7                        # 检索/复用次数（维护 pass 统计）
  success_rate: 0.86             # 使用成功率（维护 pass 更新，prior 项）
  verified: user-confirmed       # 验证等级，见 §5
  last_used: 2026-08-16
---
```

字段语义与来源：

| 字段 | 含义 | 谁来写 |
|---|---|---|
| operator | 一级硬过滤键，杜绝跨领域检索 | 模型创建卡片时写 |
| pattern / heuristics / quantity | 结构、启发式、数量签名 | 模型创建时写 |
| techniques | 从该记录的证明/解法中提取的可迁移技巧（Dual RAG 上下文增强） | 模型在 reinforce 时追加 |
| applications | 该记录能帮助解决什么挑战（与查询侧“挑战描述”对齐） | 模型创建/reinforce 时写 |
| uses / success_rate / last_used | 使用统计（ISM 的 prior 项与审计信号） | **插件维护 pass 确定性更新**，模型不得手改 |
| verified | 验证等级（§5） | 用户确认/维护 pass 升级，模型只能写最低级 |

## 3. 两级检索：note_retrieve（已实现）

`dsh/preset/obsidian-notes.mjs` 新增 `note_retrieve` 工具：

```text
Stage 0  查询增强（协议层，AGENTS.md §4 已有）：先做问题蒸馏，
         产出“挑战描述 + 2~3 条候选技术路线”作为查询。
Stage 1  算子硬过滤：hook.operator === 查询 operator 的卡片才进候选集；
         无 operator 的卡片只在与查询同 operator 的卡片不存在时兜底参与。
Stage 2  加权软打分（ISM 权重，embedding 项用 token 加权相似度替代）：
         score = 0.55×lexical(query, 卡片标题+techniques+applications+正文头部)
               + 0.15×structure(query.pattern, hook.pattern)
               + 0.15×heuristics(query.heuristics, hook.heuristics)
               + 0.05×quantity(query.quantity, hook.quantity)
               + 0.10×prior(0.5×success_rate + 0.5×min(uses/10, 1))
         分词：ASCII 单词 + CJK 一元/二元组；相似度用 IDF 加权的 overlap 系数。
Fallback 无任何 hook 卡片时，退化为对全库标题/正文的 token 加权匹配
         （等价于带排序的 note_search，保证工具永远有输出）。
输出     top-k 卡片：路径、score 分解、operator/pattern/techniques、验证等级，
         供模型读文件核实后使用。
```

设计取舍：
- **无 embedding 也能跑**：hook 字段 + token 加权已覆盖“策略相似、字面不同”的大部分漏检（ISM 中结构特征权重占 0.45、嵌入只占 0.55）；
- **embedding 后置可选**：本地 bge-small-zh 替换 lexical 项即可，接口不变；
- **prior 项是自我纠错的正反馈**：成功率高的卡片更容易被检索到，与 ISM Promote/Demote 一致。

## 4. 确定性维护 pass：记忆体检（已实现）

`dsh/preset/obsidian-memory.mjs` 新增审计器（ISM 七机制的本土化第一层）：

- **确定性扫描**（不调模型）：扫描 records/templates/inbox 的 frontmatter 与 hook 字段，产出体检报告 `cache/memory-audit.json`；
- **节流**：每个 vault 每天最多重扫一次（可配置 `auditIntervalMs`，默认 86400000），报告随系统提示注入（预算 1200 字符）；
- **报告内容**：
  - unused：uses=0 且 >30 天未更新的卡片（建议合并/降级/删除钩子但保留证据）；
  - weak：success_rate ≤ 0.4 且 uses ≥ 3（建议模型改写内容并把 success_rate 归零重估，ISM Self-Correct）；
  - duplicate candidates：同 operator 且 pattern+techniques Jaccard ≥ 0.7 的卡片对（建议合并，ISM Self-Merge）；
  - strong：success_rate ≥ 0.8（建议 reinforce：把最近成功案例的技巧追加进 techniques）；
  - unverified：verified 缺失或 single-source 超过 60 天（提醒升级或降级为 episode 引用）。
- **模型执行层（AGENTS.md 协议）**：模型按报告行动——merge/reinforce/demote 都是模型读文件执行的，插件只提供确定性清单；
- **正反馈闭环**：每次 note_retrieve 命中 → 更新 uses/last_used；用户反馈（future）→ 更新 success_rate。

与 ISM 七机制的映射：

| ISM 机制 | v2 对应 | 实现 |
|---|---|---|
| Self-Audit | 体检报告 | ✅ 确定性扫描 + 注入 |
| Self-Correct | weak 卡片改写协议 | ✅ AGENTS.md |
| Self-Merge | duplicate candidates 清单 + 合并协议 | ✅ AGENTS.md（模型执行） |
| Self-Promote/Demote | success_rate prior 项 | ✅ 检索打分 + 反馈信号（future） |
| Self-Prune | unused 清单 | ✅ 报告列出，删除由用户决定（无删除工具） |
| Self-Reinforce | strong 卡片 techniques 追加协议 | ✅ AGENTS.md |
| Self-Antipattern | 失败案例写 artifact 记录的 mistakes 协议 | ✅ AGENTS.md（机制待强化） |
| 验证门控 | verified 三级（§5） | ✅ 字段 + 报告 |

## 5. 验证等级（ISM 验证门控的本土化）

数学笔记没有符号验证器的现成等价物（自由文本、无 ground truth），务实替代是三级来源可信度 + provenance 强约束：

| 等级 | 含义 | 获得方式 | 权限 |
|---|---|---|---|
| `user-confirmed` | 用户明确确认过 | 用户说“对/就按这个记”或反馈按钮确认 | 可被 merge/reinforce，可进 profile 正面内容 |
| `cross-referenced` | 与 vault 内笔记/定理互证 | 模型找到第二独立来源（笔记 + episode 两处） | 可被 merge，进 records 正文需标注互证来源 |
| `single-source` | 仅一次对话出现 | 默认 | 永远保留 source 指向 episode；不得进 profile 正面内容；60 天未升级进审计报告 |

未来 UI：回答中引用记忆时展示等级徽标（✅/⚖️/❓），用户一键升级/降级。

## 6. 质量保障：零 token 回归检查 + 被动信号（已实现，不做 benchmark）

**决策（2026-08）**：不为本系统建立 token 消耗型 benchmark。理由：

1. 没有现成可用的公开基准——MATH-Hard/OlympiadBench 测的是求解能力而非记忆；LongMemEval/LoCoMo 等长记忆评测是合成 QA，与“个人 vault + 数学工作流”不对口；两篇论文的 Exercise100/持续学习流都是论文自身的实验装置，不可直接迁移。
2. 任何以模型回答为测量对象的基准都按轮次烧 token，与“个人助理每天省着用”的目标相悖；而且基准答案本身要人工标注金标准，维护成本会随 vault 增长。
3. 我们真正需要防的是**回归**（改检索层后变差），而回归可以用确定性代码测试抓到——hook 解析、两级检索打分、体检分类、统计回写都是纯函数。

**替代方案（已落地）**：

- **零 token 确定性回归检查**：`scripts/test-memory.mjs`（已接入 `npm test`），在临时 vault 上断言 hook 解析、token 化、相关卡得分 > 无关卡、体检五类分类、hook 统计回写语义（含“从未使用的卡不得伪造 last_used”）。每次改检索/体检代码必跑，成本为零。
- **被动信号采集（已内置）**：`note_retrieve` 命中计数与 `hook.uses/success_rate/last_used`、体检报告、注入字符数（report 长度有界）。这些是真实使用产生的免费信号。
- **未来可选的一次性手动探针**：某次大改检索层后，由用户挑 5~10 个自己知道答案的问题问一轮，看命中与溯源是否合理——一次性的、手动的、用完即弃，不做成常驻套件。

如果将来社区出现公认的个人知识库记忆基准（评测目标是“跨会话找回个人知识”而非解题），再回来评估是否值得接。

## 7. 记忆控制面（规划中）

- 面板：分层浏览/搜索/编辑/删除任意记忆，每条显示来源与引用次数（复用 /open 跳转）——规划为 Obsidian 侧 ItemView（阶段 1b，评估见 control-panel.md）；
- 溯源：答案底部标注依据文件 + 验证等级徽标；
- 反馈按钮：这条错了 / 不再适用 / 记住这件事 / 忘记——同时是 Demote/Promote 信号源、Antipattern 触发器、验证等级升级通道。**阶段 1a 已实现**：回复内的反馈链接 `[✅ 这条对] [❌ 这条错]` 经 loopback `/feedback` 端点由 Obsidian 插件确定性改写 verified/success_rate/status（confirm/wrong/stale/forget）；链接带 `t=` CSRF 校验参数，由系统提示注入，详见 control-panel.md；
- 捕获策略分级：auto / ask / off 按类别（偏好、事实、想法）分别设置；
- 冷启动 onboarding：首次运行 5-8 问生成 profile。

## 8. 实现状态

| 项目 | 状态 | 位置 |
|---|---|---|
| hook frontmatter 解析 | ✅ | `obsidian-notes.mjs` parseHookFrontmatter |
| note_retrieve 两级检索 | ✅ | `obsidian-notes.mjs`（register note_retrieve） |
| 记忆体检（audit） | ✅ | `obsidian-memory.mjs`（buildAuditReport + 注入段） |
| uses/success_rate 正反馈 | ✅ | note_retrieve 命中写 stats → 每日体检合并回卡片并**清零 stats**（无双计）；feedback 调 success_rate |
| 模型执行的 merge/reinforce/demote 协议 | ✅ | `AGENTS.md` §2/§4/§6 + records/templates README |
| 验证等级字段与报告 | ✅ | hook.verified + 审计报告 unverified 清单 |
| embedding 后端 | ⬜ | lexical 项可替换 |
| note 工具增量缓存 | ✅ | mtime+size 校验的原文缓存（`readNoteTextCached`），代替全库重复读取 |
| BM25/embedding 后端 | ⬜ | 当前 token 加权 + hook 快路径，embedding 仍可选 |
| 验证徽标 + 反馈链接（1a） | ✅ | `main.template.js` /feedback 端点 + AGENTS.md §8 渲染规则 |
| 记忆视图（1b，Obsidian ItemView） | ✅ | `main.template.js` MemoryView：五层浏览 + hook 统计 + 搜索 + 逐卡反馈按钮 + 预览弹窗（隐藏目录限制） |
| 检索式注入（P0-1 落地） | ✅ | 静态预算瘦身 + 每轮按当前消息召回 top-k（`buildRecallIndex`/`rankRecall`，mtime 指纹缓存） |
| dialogue index 修复 | ✅ | 按 vault 过滤 + 问答配对取轮次最后一条 assistant 回复 |
| 备忘录相关性提醒 | ✅ | relevance(0.7) × recency(0.3) 双分数 |
| 安全/质量加固 | ✅ | /feedback CSRF token、皮肤缺失自动降级、stats 串行队列、安装器漂移检测、debug.log 轮转 |
| 零 token 回归检查（不做 benchmark） | ✅ | `scripts/test-memory.mjs` + 被动信号，见 §6 |