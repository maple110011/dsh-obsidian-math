# 记忆系统当前设计（v0.5.x 实现规格）

> 本文档描述**代码里真实存在**的记忆系统，不是愿景。对应文件：
> - 注入引擎：`dsh/preset/math-memory.mjs`
> - 笔记工具：`dsh/preset/note-tools.mjs`
> - 工作协议：`dsh/templates/AGENTS.md`（安装进 vault 根目录）
> - 记忆模板：`dsh/templates/*.md`（安装进 `<vault>/.deepseek/**`）
> - 生命周期维护：`obsidian/main.template.js` 的 `archiveOldEpisodes`

## 1. 架构总览

```text
                 system prompt 组装
                 ├─ persona + AGENTS.md + 工具说明（静态）
                 └─ obsidian:memory 段（每次组装动态追加）
                        │
   vault/.deepseek/     │  buildMemorySection()
   ┌──────────────────┐ │  ├─ 五层摘要：profile / topics / records /
   │ memory/profile.md│─┤  │   templates / episodes / inbox 各层索引，
   │ memory/topics/   │ │  │   按字符预算截断注入（导航层进 prompt）
   │ memory/records/  │ │  ├─ dialogue index：历史会话问答线索（≤6 组）
   │ memory/theorems/ │ │  └─ memory-audit：记忆体检报告（v2，≤1200 字符）
   │ memory/templates/│ │
   │ memory/episodes/ │ └─ 证据层留在磁盘，靠 grep/read 按需读
   │ inbox/           │
   │ cache/           │
   └──────────────────┘
```

记忆**只存在于 vault 的 markdown 文件**里；插件不持库、不调模型、唯一写文件是自己的缓存（`cache/dialogue-index.json`、`cache/memory-audit.json`）。

## 2. 五层记忆结构

| 层 | 文件 | 内容 | 注入方式 |
|---|---|---|---|
| 语义层 | `memory/profile.md` | 现在仍成立的稳定偏好/记号/授权，带修订历史 | 摘要注入（≤4000 字符） |
| 导航层 | `memory/topics/index.md` + `<topic>.md` | 主题路由索引与细节 | 索引注入（≤1800 字符） |
| 记录层 | `memory/records/index.md` + `<slug>.md` | 类型化原子卡 fact/event/instruction/preference/artifact，带 id/source/变更历史，冲突 superseded | 索引注入（≤800 字符） |
| 证据层 | `memory/episodes/YYYY-MM-DD-*.md` | 每轮对话的原始事件卡，append-only | 时间线尾部注入（≤1200 字符）+ grep 按需读 |
| 想法层 | `inbox/<slug>.md` | 想法 memo，状态 inbox→polishing→done | 状态摘要注入（≤1200 字符） |

辅助结构：
- `memory/theorems/index.md`：个人 Matlas 定理索引（一行一条，领域/关键词/状态）；
- `memory/templates/<slug>.md`：问题模板卡（题型/解法 ↔ 定理关联图），索引注入 ≤600 字符；
- `memory/notation.md`：记号体系（已采纳/候选/已否决三表 + 修订历史；收集→统一→维护，≤800 字符随提示注入）；
- `capture-policy.md`：捕获策略（idea/fact/preference × auto/ask/off，frontmatter，用户维护；随系统提示注入，默认 ask/auto/auto 与既有行为一致）；
- `cache/`：机器生成的对话索引、记忆体检报告与 hook 历史快照（用户勿动）。

## 3. 注入预算（`math-memory.mjs` 常量）

| 段 | 预算 |
|---|---|
| profile | 4000 字符 |
| topics index | 1800 字符 |
| records index | 800 字符 |
| templates index | 600 字符 |
| episodes index（尾部最新行） | 1200 字符 |
| inbox digest（含提醒候选） | 1200 字符 |
| 跨会话问答线索 | 最多 6 组 / 3000 字符 |
| 记忆体检报告（v2） | 1200 字符 |

静态索引即“导航层”（告诉模型有什么）；相关内容按需用 `note_recall` 拉取（检索 v3 S5，不再逐轮注入召回段）。截断策略：`clip()` 从头截断（episodes 保留尾部）。

## 4. 检索路由（AGENTS.md §5）

粗到细的路由规则，核心是“注入的是导航，证据在磁盘”：

- 关键词/tag 找笔记 → `note_search`；反链 → `note_links`；
- v3（检索重构，见 retrieval-v3.md）：统一入口 `note_recall`——BM25 对笔记+全部记忆层一次排序，kind-aware passage，空结果/重试协议；注入层只保留导航（S5 已移除逐轮召回段）；
- **隐藏目录限制**：Obsidian 的 vault 索引排除所有点号开头的路径段（已核对 1.13.7 源码），`.deepseek` 文件无法经 openLinkText/TFile 打开——记忆面板点击卡片走插件内预览 Modal。
- 精确事实/原话/日期 → grep episodes → 读命中文件；
- 类型化事实 → records/index → grep/读记录 → `source` 回证据；
- 定理 → theorems/index → grep 全文 → 展开定义、核对适用性；
- 同类题型 → 问题蒸馏 → templates/index → 读模板卡与关联定理（去重聚合）。

## 5. 写回协议（三写，模型执行）

每轮收尾**按需**三写（细→粗；无新信息全跳过）：

1. episode：出现新事实/决定/想法/修正才追加当天事件卡（原话保留）；
2. records：提炼原子卡并调和（相同更新、冲突 superseded、`source` 必指 episode）；
3. topics/profile/theorems/templates：仅局部更新，禁止整段总结进 prompt 层。

执行纪律：同一轮记忆写入合并为最少工具调用；完成后只在回复末尾一行说明（“已记录：N 条”）。

## 6. 备忘录生命周期与提醒

- 捕获档位（1c）：以 `.deepseek/capture-policy.md` 为准——`idea` 档 ask（默认）先问、auto 直接写、off 不主动捕捉；事实/偏好同理（`fact`/`preference` 档，默认 auto，即三写协议原节奏）；用户在 Obsidian 插件设置页可直接改档（三个下拉框写回文件），面板编辑与文件直改等效；
- 捕获：识别到“一般性数学思路/方法/技巧/观点”时回复末尾给 `💡 可捕捉的想法`，ask_user 征得同意才写；新想法与已有 memo 高度相关则并入、中度相关加 related 双链、独立新建。
- 提醒候选（插件确定性扫描）：陈旧（inbox > 7 天、polishing > 3 天）**或与当前消息相关（relevance ≥ 0.15）**且今天未提醒，按 0.7×相关性 + 0.3×新鲜度 排序取 top3 注入；模型在相关讨论时给 `🔔 备忘录提醒` 并 ask_user，每天每条最多一次（`last_reminded`）。
- 状态流转 inbox→polishing→done 更新 index；done 的升华内容写入正式笔记前仍需询问。

## 7. 跨会话线索（dialogue index）

- 扫描 `$DSH_HOME/sessions/**/*.jsonl.zstd` 最近 20 个文件（递归、mtime 倒序），**只保留 cwd 位于本 vault 内的会话**（其他工作区的会话不进索引）；
- zstd 拼接帧手动解析（Node ≥22.5 `zlib.zstdDecompressSync`），只取 `source.kind === "user"` 的真实用户消息；
- 每条用户消息配该轮**最后一条** assistant 回复（下一用户消息前最后一条 assistant）组成问答对，时间正序、取最近 maxHistoryEntries 条、字符预算 maxHistoryChars；
- 缓存：进程内 + `cache/dialogue-index.json`（fingerprint = path|mtime|size 列表），组装时排除当前会话 id。

## 8. 生命周期维护（宿主插件）

- agent 无删除/移动工具；>90 天 episode 由 Obsidian 插件启动时移入 `episodes/archive/` 并更新 index（可配置关闭/手动触发）；
- v2 新增：记忆体检报告由 math-memory 插件确定性扫描生成（≤每天一次），见 v2-proposal §3。

## 9. 安全边界（fail-closed）

- 工具面：文件读写/搜索 + 四个笔记工具（note_recall / note_search / note_create / note_links）+ ask_user；无 shell/web/subagent；
- 写操作被 workspace-write 沙箱限制在 vault 内，交互提权默认禁用（`approval: never`）；
- 插件自身唯一写的文件在 `cache/`；一切记忆变更走 ctx.fs，无裸 fs 旁路。

## 10. 已知局限（详见 assessment.md）

检索为纯 BM25 词法（无 embedding，语义召回靠 Tier B 可选后端、暂未启用）；三写协议仍依赖模型自律（体检提供 records 的结构校验兜底，但内容质量仍靠 prompt）；记忆架构处于 prototype 阶段、无长期 field testing；记忆面板目前仅在 Obsidian 侧（dsh web ui 面板待重构 Phase 4）；hook frontmatter schema 无版本常量（重构 Phase 2 补）。