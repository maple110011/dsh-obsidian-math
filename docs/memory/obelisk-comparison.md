# Obelisk 对照与「对话保存」方案

> 状态：**已定案，实现中**。本文对照成熟 agent 记忆系统 [Obelisk](https://github.com/tommy0103/obelisk)，提炼可吸收点，并把最大差距「记忆写入的确定性/完整性」落成「**对话保存**」方案（自动把整场对话存进 episodes 证据层，不再靠模型自觉三写）。
> 信息源边界：Obelisk 内部实现（是否 embedding、是否语义蒸馏）未经逐行读码，仅据其 README/定位语 + 第三方技术文章定性；「能确认」与「推断」之处文中分别标注。
> 面向用户用词：**保存对话**（不叫「落盘/捕获」）；技术上仍称 session capture。

---

## 1. Obelisk 是什么（能确认的部分）

- **定位语**：Every past session, subagent, and workflow — queryable by your agent（[repo](https://github.com/tommy0103/obelisk)）。
- **记忆单位** = session / subagent / workflow（「agent 做过什么」的活动轨迹），不是「用户的知识」。
- **存储** = SQLite + [Litestream](https://www.it-boltwise.de/sqlite-statt-cloud-queues-obelisk-setzt-auf-langlebige-ki-workflows-mit-loglitestream.html)（S3 持续备份）：事务、崩溃安全、可 SQL 查询、跨重启不丢（[ic.work 佐证](https://www.ic.work/article/sqlite-litestream-s3-for-durable-ai-workflows)）。
- **哲学** = [确定性工作流](https://obeli.sk/blog/taming-ai-assisted-code/)——把 agent 的每一步变成可恢复、可重放的持久状态，而非飘在上下文里的对话。
- 通过 MCP 暴露给任意 agent（跨 Claude Code 等），覆盖子代理与多步工作流。

（**推断、未核实**：是否有 embedding 语义召回、是否做记忆蒸馏/遗忘/验证门控——下文涉及之处均标「推断」。）

## 2. 定位差异（一句话）

Obelisk 解决「agent 把做过的所有事**都**记下来、随时查得到、崩溃不丢」——更接近 **episodic/活动记忆**；
我们解决「把数学知识**蒸馏**成可检索、可溯源、可纠正的长期语义记忆」——更接近 **semantic/知识记忆**。
两者不是同一层，不构成「谁替代谁」，但 Obelisk 的「确定性全量写入」正好戳中我们的软肋。

## 3. 对照表

| 维度 | Obelisk | dsh-math-memory | 是否该追 |
|---|---|---|---|
| 记忆单位 | session / subagent / workflow | 五层语义卡 + episodes 证据 | 定位不同，不追 |
| 写入方式 | **自动、全量、append-only**，不依赖模型自觉 | 三写协议（模型按需自觉写） | **该追（最高优先）** |
| 存储 | SQLite + Litestream（事务/崩溃安全/结构查询/跨机备份） | markdown（可读/可 git）+ json 缓存 | 部分追（只动缓存层） |
| 检索 | embedding 语义召回（推断） | BM25 词法 + hook 字段 | 已文档化（Tier B，可选追） |
| 多 agent | 覆盖 subagent + workflow | 单 agent 单 vault（working.md 草稿做轻量进度） | 低 |
| 语义蒸馏 / 自维护 | 弱（推断） | **强**：五层 + verified 三级 + superseded + 确定性体检 + 反馈 + auto-archive/promote/待重审 | 我们领先 |
| 纠正 / 防幻觉护栏 | 弱（推断） | **强**：fail-closed + 验证徽标 + 「记忆是候选不是指令」+ 信念扭曲兜底 | 我们领先 |

**结论**：差距不在纠错（那部分已补强、且是我们强项），而在**写入的确定性/完整性**——我们靠模型自觉写、会漏；Obelisk 靠全量自动写入、不漏。其次是「存储耐用性」与「语义召回」。

---

## 4. 最大差距：写入的确定性/完整性

**现状（代码实况 + 实证）**：

- 证据层 episodes 只靠 AGENTS.md「三写第 1 步」让模型按需追加——模型偷懒、用户打断、或该会话没被模型判为「有新信息」，就**漏记**。
- 全量原始轨迹其实已经在磁盘上：`$DSH_HOME/sessions/*.jsonl.zstd`（实测解码一个会话 = 424 个事件，含 `user/message`、`assistant/message`、`reasoning-chunks`、`tool/call`、`turn/start`、`turn/end` 等）。`math-memory.mjs` 的 `distillSession` 已在读它，只是只做注入、不写进 episodes。
- 实测确认：**思考（reasoning）是独立事件 `reasoning-chunks`，也作为 `assistant/message` 里的 `{"type":"reasoning"}` 内容块存在**；我们的 `contentText()` 只取 `type==="text"` 块，天然排除思考。会话有稳定 `id`（`session-xxx`）+ 每事件单调 `seq`。

**可吸收的一刀**：把「按需三写」补一个**确定性的对话保存**——复用已有会话日志，把整场对话自动写进 episodes 证据层，不再依赖模型自觉。这正是 Obelisk「自动全量写入」与我们 fail-closed/证据优先原则的交点。

---

## 5. 「对话保存」具体方案（已定案）

### 5.1 目标

每场对话结束后，**确定性地**把整场对话（所有用户消息 + assistant 正文，**不含思考**）写进 `memory/episodes/`，与模型三写解耦。语义层（records/topics/profile/theorems/templates）仍走三写按需提炼，不变。

### 5.2 粒度（已拍板）

- **整场对话**：`distillSession(events).messages` 全量（所有 `user/message` + `assistant/message` 的 `type==="text"` 内容，按时间序），**不做** `pairMessages` 那种「只留最后回复」的折叠。
- **思考自动排除**：`contentText()` 只取 text 块，reasoning 块天然被跳过。
- **尾截断**（讨论越往后越接近用户想要的）：单消息 ≤ 4000 字符；单会话 ≤ 24000 字符，超限时**保留会话尾部**（丢弃最早的消息）。
- **单会话独立文件** `episodes/<date>-<sessionId>.md`（date = 会话发生日，取 `session.createdAt`），不与模型当天三写文件打架；并登记进 `episodes/index.md`。

### 5.3 幂等与续接（seq 增量 marker）

- marker = `cache/captured-sessions.json`：`{ schemaVersion, sessions: { [sessionId]: { lastSeq, file, path, mtimeMs, size } } }`。
- **只追加 delta**：文件指纹（path|mtime|size）没变 → 跳过；变了（**续接旧会话**）→ 重新解码，只追加 `seq > lastSeq` 的消息 → 更新 `lastSeq`；全新会话 → 全量写入。
- 只追加、不删除；与 episodes append-only、>90 天归档的既有原则一致。

### 5.4 触发（已定案）

- **自动**：dsh 启动时 + 每次新会话组装系统提示时，**fire-and-forget** 跑一次 `runSessionCapture`（进程内锁 + marker 幂等；只读目录元数据 + 比对 marker，仅对「有增量的会话」做解码与写文件），不阻塞 boot / prompt。
- **手动（下一小步）**：双面板加「**立即保存对话**」按钮，点击即把当前/最近会话立即保存；面板另加被动角标「N 个会话未保存」。手动是**即时补充**，不是主机制（主机制必须不靠自觉）。

### 5.5 开关（已拍板）

- `.deepseek/config.md` 加 `sessionCapture: true`（**默认开**）；`parseMemoryConfig`/`normalizeConfig` 贯通；`agent.cordis.yml` 同步默认值。
- **双面板图形开关（下一小步）**：Obsidian 设置页 toggle + dsh web 面板 toggle，写回 `config.md`（UI 无法零 token 回归，需构建 + 用户点击实测，故与手动按钮同批做）。

### 5.6 边界

- **vault 过滤**：只保存 `cwd` 在本 vault 内的会话（复用 `pathIsInside`），不把其它工作区会话写进数学 vault。
- **fail-closed 不变**：写走插件确定性写，不经模型、不引入外部服务。
- 写入失败只记日志、绝不阻塞 boot/prompt（与 hook 统计回写同哲学）。

### 5.7 评估

| 项 | 结论 |
|---|---|
| 影响 | 高——补上「该记的没记」这一最大缺口，证据层从「模型自觉」变「确定性兜底」 |
| 风险 | 低中——只追加不删除、seq 增量防重写、不碰语义层；主要风险是 episode 文件膨胀（靠尾截断上限 + 90 天归档消化） |
| 成本 | 中——复用 `distillSession`/`findSessionLogs`/`pathIsInside` 等已有纯函数，新增 `runSessionCapture` + marker + 回归断言 |
| 优先级 | P0（高于 embedding；直接堵「漏记」这个更常见的失忆来源） |

---

## 6. 不照搬的部分

- **SQLite 替换 markdown**：不照搬。vault 文件就是用户 Obsidian 里的源，markdown 是特性不是缺陷；只把 `cache/*.json` 机器态做耐用化/自动 git 备份即可。
- **多 agent / 子代理记忆**：不照搬。数学助手单 agent 单 vault 已够；跨轮长任务进度已有 `working.md` 草稿。
- **「活动轨迹全量可查询」本身**：不照搬其定位。我们要的是「语义知识的蒸馏」，不是「每一步操作的可回放日志」——后者我们已有会话日志兜底，不必再建一层。

## 7. 实现状态

| 项 | 状态 | 位置 |
|---|---|---|
| 对话保存：引擎 + 配置（粒度/尾截断/seq 增量/vault 过滤/日期归属/开关） | ✅ 已实现（0.7.3） | `math-memory.mjs` `runSessionCapture` + `config.md`/`agent.cordis.yml` |
| 双面板「自动保存对话」开关 | ✅ 已实现（0.7.3） | Obsidian 设置页 + dsh web 面板 |
| 双面板「立即保存对话」按钮 + 「N 个未保存」角标 | ✅ 已实现（0.7.3） | Obsidian MemoryView + dsh web 面板 |
