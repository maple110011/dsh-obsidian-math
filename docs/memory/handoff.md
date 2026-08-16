# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、已修坑、未做事项与工作约定。
> 最后更新：2026-08-16（0.4.0 发布前）。

## 1. 项目是什么

`dsh-obsidian-math`：把 DeepSeek Harness（dsh）嵌入 Obsidian 右侧栏的**数学笔记助手**，核心是跨会话记忆系统（记忆 v2）。两个组件同仓库：

- Obsidian 社区插件（根目录 `main.js`/`manifest.json`/`styles.css`，由 `obsidian/main.template.js` + `dsh/` 共享文件构建）；
- dsh 侧 agent preset + profile + 安装器（`dsh/`，npm 包 `dsh-obsidian-math`）。

仓库地址：github.com/maple110011/dsh-obsidian-math。版本 **0.4.0**。

## 2. 文件地图（改哪里先看哪）

| 路径 | 职责 |
|---|---|
| `dsh/preset/obsidian-memory.mjs` | 记忆注入引擎：五层摘要、召回 top-k、体检、dialogue index、memo 提醒 |
| `dsh/preset/obsidian-notes.mjs` | 笔记工具：note_search/note_create/note_links/note_retrieve + hook 解析 + 打分 + 增量缓存 + stats 队列 |
| `dsh/preset/agent.cordis.yml` | preset 装配：最小工具面 + 记忆/审计/召回配置 |
| `dsh/preset/preset.yml` | preset 元信息（描述） |
| `dsh/profile/*` | obsidian profile：fail-closed 沙箱、workspace 自动注册、--patch overlay |
| `dsh/templates/AGENTS.md` | **工作协议**（装进 vault 根，自动加载给模型）；`dsh/templates/*` 是记忆层模板 |
| `obsidian/main.template.js` | Obsidian 插件源码：服务管理、LinkServer（/open + /feedback）、MemoryView 面板、预览 Modal、皮肤 junction 同步、自动 bootstrap |
| `scripts/build-obsidian.mjs` | 把模板 + dsh 文件嵌入 `main.js`（**改共享文件后必须跑**） |
| `scripts/test-memory.mjs` | 零 token 记忆回归（26 项断言，进 `npm test`） |
| `scripts/test-installer.mjs` | 安装器 e2e + **漂移检测**（安装产物必须与仓库源一致） |
| `scripts/deploy-local.mjs` | **本机一键部署**（gitignored，含本机路径；用安全拷贝，勿用 cpSync） |
| `docs/memory/*.md` | 知识库：README（导航）/design/assessment/v2-proposal/references/changelog/control-panel/handoff |

## 3. 当前状态（0.4.0）

**读**：hook 两级检索（note_retrieve）+ **检索式注入**（静态预算瘦身 + 每轮按当前消息召回 top-k）。
**写**：每日确定性体检（strong/weak/unused/疑似重复/unverified）+ hook 统计回写（stats 合并后清零，无双计）+ 模型执行协议（AGENTS.md）。
**管**：验证徽标（✅⚖️❓）+ 反馈链接（/feedback，confirm/wrong/stale/forget，CSRF token）+ Obsidian 记忆面板（浏览/搜索/逐卡操作/预览弹窗；入口=设置页按钮+命令面板，brain 标签图标）。
**质量**：26 项零 token 回归 + 安装器漂移检测 + 被动信号（uses/success_rate）。
**皮肤**：@linxin666 皮肤在 obsidian profile 直接生效（junction 镜像 + web profile 缺失时自动降级禁用）。

## 4. 必须知道的坑（勿重蹈覆辙）

1. **本机 `fs.cpSync` 会原生崩溃**（0xC0000409，连 1 文件子目录都崩，曾连带杀死 dsh web 进程）。任何脚本用「手动遍历 + copyFileSync」。
2. **Obsidian 1.13.7 视图生命周期有 `open(containerEl)` 方法**——ItemView 子类**不得**定义 `open/close/load` 等同名方法（记忆面板曾因此空白 + 报 e.toLowerCase）。
3. **vault 索引排除点号路径段**（`.deepseek` 对 Obsidian API 不可见）：不能用 openLinkText/TFile 打开记忆文件，面板用 node fs 读取 + 预览 Modal。
4. **Obsidian 1.13.7 的 Notice 构造不调 setMessage**——想抓 toast 用 DOM MutationObserver，别 patch setMessage。
5. **皮肤管理器全局 patch**（`$DSH_HOME/cordis.patch.yml`）把当前皮肤 insert 进**所有** profile；profile 自己的 cordis.patch.yml 盖不过它（应用顺序：bundle → profile patch → 全局 patch → --patch overlay）。持久解 = junction 镜像（已内置）。
6. **插件 bootstrap 每次加载强制刷新** `obsidian-memory.mjs/obsidian-notes.mjs/cordis.yml/obsidian-workspace.mjs/obsidian.patch.yml`（overwrite=true）——机器本地手改这些文件会被冲掉，改动必须进仓库。
7. 历史 bug 已修：readdirSync 未导入（归档静默失败）、uses 双计、AGENTS.md success_rate 矛盾、主视图 null-leaf 兜底缺失。

## 5. 用户决策记录（不要推翻）

- **版本策略**：本地调试可滚动小版本，**对外发布统一 0.4.0**（仓库已复位）。
- **不做 benchmark**（烧 token + 无对口公开基准）：零 token 回归 + 被动信号 + 可选一次性手动探针。
- **记忆面板入口**：设置页按钮 + 命令面板，不设独立 ribbon；brain 图标仅作视图标签。
- **皮肤**：让 obsidian profile **直接应用**主 web 所选皮肤（不维护禁用清单）。
- 推送 GitHub 必须等用户口令（"推送"）。

## 6. 工作流命令

```bash
npm test                                  # 语法 + 26 项回归 + 安装器 e2e（含漂移检测）
node scripts/build-obsidian.mjs           # 改共享文件后重建 main.js
node scripts/deploy-local.mjs             # 本机部署（vault/DSH_HOME/插件目录），日志 deploy-local.log
dsh --profile obsidian --patch <home>/profiles/obsidian/obsidian.patch.yml --dump-config   # 查组合树
# 调试：插件把异常/面包屑写 <vault>/.obsidian/plugins/dsh-math-assistant/debug.log（>1MB 自动截断）
# 反馈端点带 CSRF token：DSH_OBSIDIAN_FEEDBACK_TOKEN（插件自动注入 dsh env）
```

## 7. 未做/下一步候选（供挑选）

| 方向 | 说明 | 预估 |
|---|---|---|
| embedding 后端 | 召回/检索的 lexical 项可换本地 bge-small-zh；接口已预留 | 1-2 天 |
| 面板内编辑记忆 | 预览 Modal 目前只读；加编辑+保存（node fs 直写 + mtime 冲突检查） | 1 天 |
| 捕获策略分级（1c） | 偏好/事实/想法 × auto/ask/off，写入 profile | 半天 |
| 皮肤切换自愈 | 新皮肤 id 出现时无需任何维护（junction 已保证解析）；仅 web profile 缺失时需补降级清单 | 已覆盖 |
| 统计可视化 | 面板展示 uses/success_rate 趋势（数据已齐） | 半天 |
| 多 vault 支持 | 当前单 vault 假设（DSH_OBSIDIAN_VAULT） | 2-3 天 |
| 指标面板 | recall@k / 幻觉率 / 首 token 延迟 / 每会话成本 的轻量采集 | 1 天 |

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。