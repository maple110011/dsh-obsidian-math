# ARCHITECTURE.md — 仓库结构与系统架构

本文件说明仓库里**每个目录/文件是干什么的**、两个组件如何协作、以及记忆系统与检索系统的边界。文档知识库入口见 [docs/memory/README.md](docs/memory/README.md)。

## 1. 双组件总览

```
┌──────────────────────────── Obsidian（用户）────────────────────────────┐
│  右侧栏 iframe（dsh web）   记忆面板 ItemView    设置页（服务/捕获策略）    │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ 启动/停止 dsh 服务；/open /feedback loopback；
               │ bootstrap 写入 preset/profile/模板；归档维护
┌──────────────▼──────────────────────────── dsh 服务（obsidian profile）─┐
│  agent preset `obsidian`：最小工具面 + obsidian-memory + obsidian-notes  │
│  fail-closed 沙箱（workspace-write，approval never）                     │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ 读/写
┌──────────────▼──────────────────────── vault（D:/Obsidian笔记数据库）───┐
│  笔记/ + AGENTS.md + .deepseek/                                          │
│    memory/（profile, notation, topics, records, theorems, templates,     │
│             episodes）  inbox/  capture-policy.md  cache/（机器生成）     │
└──────────────────────────────────────────────────────────────────────────┘
```

**职责分工**：Obsidian 插件 = 服务管理 + UI + 确定性维护（归档/反馈写回）；dsh 侧 = agent 能力（检索/记忆注入/工具）；vault = 全部持久状态（笔记 + 记忆都是 markdown，无数据库）。

## 2. 仓库文件地图

| 路径 | 职责 |
|---|---|
| `manifest.json` / `main.js` / `styles.css` | Obsidian 社区插件发布物（`main.js` 由构建生成，勿手改） |
| `obsidian/main.template.js` | 插件源码：服务管理、LinkServer（/open + /feedback）、记忆面板、预览编辑、皮肤 junction 同步、设置页（含捕获策略下拉框）、bootstrap |
| `dsh/preset/` | **agent preset `obsidian`**：`preset.yml`（元信息）、`agent.cordis.yml`（装配：最小工具 + 记忆插件配置）、`obsidian-memory.mjs`（记忆注入引擎 + 体检 + 对话索引 + 记号/捕获策略注入）、`obsidian-notes.mjs`（笔记工具：note_recall/note_search/note_create/note_links + BM25 检索引擎） |
| `dsh/profile/` | **profile `obsidian`**：`package.json`（bundles: dsh-base + dsh-web-app）、`cordis.patch.yml`（fail-closed 沙箱/审批/权限表/默认 preset）、`obsidian.patch.yml`（workspace 自动注册，插件刷新）、`obsidian-workspace.mjs` |
| `dsh/templates/` | **vault 模板**：`AGENTS.md`（工作协议，自动加载）、`profile.md`、`notation.md`（记号体系）、`topics-index.md`、`records-{readme,index}.md`、`theorems-*.md`、`templates-*.md`、`episodes-*.md`、`inbox-*.md`、`capture-policy.md` |
| `dsh/install.mjs` | npm CLI 安装器（`dsh-obsidian-math install --vault …`），幂等、保留用户编辑 |
| `scripts/build-obsidian.mjs` | 把模板 + dsh/ 共享文件嵌入 `main.js`（CRLF 归一化，CI 重建一致性门禁） |
| `scripts/deploy-local.mjs` | 本机一键部署（gitignore，机器特定路径；备份 + 三路安装 + 验证） |
| `scripts/qa/` | **QA 工具链**：`engine-probe.mjs`（零 token 召回断言）、`e2e.mjs`（真实会话验收，含 API 级 token 计量）、`cases.json`、`run.mjs`；方法论见 `docs/memory/testing.md` |
| `scripts/test-memory.mjs` | 零 token 回归（63 断言，进 `npm test`） |
| `scripts/test-installer.mjs` | 安装器 e2e + 漂移检测 |
| `docs/memory/` | **知识库**：README（导航+状态表）、design（当前实现规格）、retrieval-v3（检索提案与状态）、testing（QA 方法论）、assessment（评估轮次）、v2-proposal、references（论文笔记）、changelog（记忆系统细账）、control-panel、handoff（交接） |
| `.github/workflows/` | CI（重建 main.js 一致性 + 全测试）、release（tag 触发发布资产） |

## 3. 记忆系统 ↔ 检索系统：写读分离、文件契约耦合

```
记忆系统（写路径）                       检索系统（读路径）
  拥有：五层结构、三写协议、hook schema、     拥有：统一索引、BM25 打分、
  体检、统计回写、归档、记号体系、捕获策略      精读协议、coverage 弱信号
        │                                        │
        ├─① 卡片文件（.deepseek/memory/**）──→ │ 只读消费（kind-aware passage）
        ├─② hook frontmatter schema ─────────→ │ 字段加权 + 算子过滤
        │                                        │
        │←─③ cache/retrieval-stats.json ────────┤ 检索命中写入
        │   （体检读统计 → 回写 uses/success_rate）
        └─④ 推送接口：profile/notation/topics/dialogue 注入 prompt
```

两条路径独立演化；唯一协调点 = hook schema 变更（版本化）。详见 [docs/memory/retrieval-v3.md](docs/memory/retrieval-v3.md) §3.5。

## 4. 常用命令

```bash
npm test                        # 语法 + 63 项回归 + 安装器 e2e（含漂移检测）
npm run qa                      # 引擎探针（零 token，12 组召回断言）
npm run qa:e2e                  # 引擎探针 + 真实会话端到端（烧真实 tokens，含 API 级计量）
node scripts/build-obsidian.mjs # 重建 main.js（改 dsh/ 或模板后必跑）
node scripts/deploy-local.mjs   # 本机部署（vault + DSH_HOME + 插件目录）
dsh --profile obsidian --port 3180 --patch <home>/profiles/obsidian/obsidian.patch.yml  # 纯 CLI 启动
```

## 5. 新功能落地清单（改代码时对照）

1. 逻辑放对层：host（Obsidian 插件）/ agent（preset）/ 数据（vault 模板）；
2. 纯函数进 `scripts/test-memory.mjs` 回归；行为断言进 `scripts/qa/`；
3. 新模板三路安装（main.template.js bootstrap / install.mjs / deploy-local.mjs）+ 进 build-obsidian.mjs 嵌入清单；
4. 文档同步：design.md（规格）、CHANGELOG.md + docs/memory/changelog.md（细账）、README（特性）、必要时 handoff.md；
5. 构建 → npm test → npm run qa → deploy-local →（用户口令后）提交推送。
