# 交接文档（Handoff for the next agent）

> 目的：让下一个接手本项目的 agent 在**不翻聊天记录**的情况下，完整掌握现状、已修坑、未做事项与工作约定。
> 最后更新：2026-08-16（推送前修复轮完成后；feedback token 接线 / 缓存 schemaVersion / 皮肤 fallback 时序）。

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
**修复轮（推送前）**：/open 与 /feedback 链接带 `t=` token（模型模板 + 端点双端接线）；dialogue-index 缓存加 `schemaVersion: 2` 门控；皮肤降级 fallback 在 overlay 刷新时提取重放；卸载清理全局监听与 Notice 补丁；design.md 预算漂移修复。`npm test` 33/33 全绿。
**1c 捕获策略分级**：`capture-policy.md`（idea/fact/preference × auto/ask/off，默认 ask/auto/auto）+ 系统提示注入 + 面板摘要 + 三路模板安装；回归 33 → 38。
**序 2 面板内编辑**：预览弹窗「编辑/保存」+ mtime 冲突防护 + 保存后刷新；策略文件面板内可点开直改。
**序 3 趋势可视化**：`cache/hook-history.json` 每日快照 + 面板近 5 点 `📈` 迷你趋势；回归 38 → 42。
**序 4 低危清理**：note_search 排除 .deepseek；归档同步 records source；端口占用一次性提示；DSH_PERMISSION_MODE 措辞。
**检索 v3（进行中）**：S1 统一 note_recall（笔记+记忆一次 BM25 排序，kind-aware passage，hook 统计迁移，连字符归一 + CJK 字符包含）+ S2 BM25 打分器 + S3 精读挑选协议（AGENTS.md §0/§4/§5 重写，note_retrieve 退役，空结果/重试上限）。回归 56 项全绿；待 S5（按需导航注入）、S6（顺链+审计校验）。

## 4. 必须知道的坑（勿重蹈覆辙）

1. **本机 `fs.cpSync` 会原生崩溃**（0xC0000409，连 1 文件子目录都崩，曾连带杀死 dsh web 进程）。任何脚本用「手动遍历 + copyFileSync」。
2. **Obsidian 1.13.7 视图生命周期有 `open(containerEl)` 方法**——ItemView 子类**不得**定义 `open/close/load` 等同名方法（记忆面板曾因此空白 + 报 e.toLowerCase）。
3. **vault 索引排除点号路径段**（`.deepseek` 对 Obsidian API 不可见）：不能用 openLinkText/TFile 打开记忆文件，面板用 node fs 读取 + 预览 Modal。
4. **Obsidian 1.13.7 的 Notice 构造不调 setMessage**——想抓 toast 用 DOM MutationObserver，别 patch setMessage。
5. **皮肤管理器全局 patch**（`$DSH_HOME/cordis.patch.yml`）把当前皮肤 insert 进**所有** profile；profile 自己的 cordis.patch.yml 盖不过它（应用顺序：bundle → profile patch → 全局 patch → --patch overlay）。持久解 = junction 镜像（已内置）。
6. **插件 bootstrap 每次加载强制刷新** `obsidian-memory.mjs/obsidian-notes.mjs/cordis.yml/obsidian-workspace.mjs/obsidian.patch.yml`（overwrite=true）——机器本地手改这些文件会被冲掉，改动必须进仓库。
7. 历史 bug 已修：readdirSync 未导入（归档静默失败）、uses 双计、AGENTS.md success_rate 矛盾、主视图 null-leaf 兜底缺失。
8. **防护必须双端接线**：给 loopback 端点加 CSRF/权限校验时，必须同步更新注入给模型的链接模板（`t=`）；只改端点不改模板 = 点击闭环静默断裂（0.4.0 的 /feedback 正是如此，修复前所有反馈链接 403）。
9. **缓存语义变更必须带版本**：`cache/dialogue-index.json` 按 path|mtime|size 指纹复用；任何过滤/配对语义变化都要 bump `schemaVersion`（现为 2），否则旧代码写出的缓存继续生效——跨工作区会话泄漏的根因。
10. **fallback 写入必须抵抗刷新**：插件自有的 `obsidian.patch.yml` 每次加载 overwrite 刷新；任何运行时追加的机器本地块都要在刷新路径（`ensureObsidianPatch`）里提取重放，否则追加即被擦除。

## 5. 用户决策记录（不要推翻）

- **版本策略**：0.4.0 已发布（含 A-F 轮）；推送前修复轮对外发布为 **0.4.1**（bugfix release，不重写已发布的 0.4.0 标签）。
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

**下一轮安排（按优先级；序 0 是本轮修复的验收，先行）**：

| 序 | 方向 | 说明 | 预估 |
|---|---|---|---|
| 0 | 修复验收（用户实测） | 重载 Obsidian → 服务重启 → 验证：反馈链接带 `t=` 且点击生效；体检报告首次生成（`cache/memory-audit.json`）；dialogue-index 重建后不含非 vault 会话源；皮肤照常加载 | 半小时 |
| 1 | 捕获策略分级（1c） | 偏好/事实/想法 × auto/ask/off，写入 profile；与面板联动 | ✅ 已实现（`capture-policy.md`；面板内编辑随序 2） |
| 2 | 面板内编辑记忆 | 预览 Modal 加编辑+保存（node fs 直写 + mtime 冲突检查），补上控制面闭环的“编辑”一环 | ✅ 已实现（含策略文件快捷编辑入口） |
| 3 | 统计可视化 | 面板展示 uses/success_rate 趋势（数据已齐） | ✅ 已实现（hook-history.json 快照 + 📈 迷你趋势） |
| 4 | 低危清单清理 | note_search 排除 .deepseek（按工具维度）；episode 归档同步 records 的 source 链接；probeService 端口占用提示；DSH_PERMISSION_MODE 文档措辞 | ✅ 已实现（四项全清） |
| 5 | embedding 后端（可选） | 召回/检索的 lexical 项换本地 bge-small-zh；接口已预留 | 1-2 天 |
| 6 | 多 vault 支持 | 解除单 vault 假设（DSH_OBSIDIAN_VAULT） | 2-3 天 |
| 7 | 指标面板 | recall@k / 幻觉率 / 首 token 延迟 / 每会话成本 的轻量采集 | 1 天 |

顺序理由：0 先确认本轮闭环恢复；1-2 把“管”的最后两块补完（策略分级是 control-panel.md 阶段 1c 的既定件，编辑是面板只读缺口的自然补全）；3 零成本可视；4 清债；5-7 属架构级，等 1-4 稳定后再动。皮肤切换自愈已由 junction 机制覆盖，无需维护。

## 8. 与用户协作约定

- 大改先评估（docs 先行），用户抉择后再动手；
- 每轮改动同步 docs（changelog 必写），代码与文档同提交；
- 涉及部署/推送等副作用操作，先说明再执行；用户口令 "推送" 才 push。