# 实测指南（Phase 1 重构后）

> 状态：Phase 1 重构（① resolveWorkspaceRoot ② hook 解析器 + templates-manifest ③ 文件操作下沉 ④ 更名 notes-assistant）已全部完成，`npm test` 70/70 全绿，boot 冒烟测试已通过。

## 一、你的现状（重要）

你的 `DSH_HOME` = `C:\Users\小新air15\.dsh`，其中：
- `profiles/` 只有 `web`（+ `node_modules`）
- `agent-presets/` 只有 `liangshen`

**没有旧的 `obsidian` profile**，所以这次更名（`obsidian` → `notes-assistant`）对你是**干净的全新安装**，不需要迁移旧目录。

## 二、自动化测试

### 1. 零 token（最快、最常跑）

```powershell
cd E:\software\ss\Deepseek-Harness\dsh-obsidian-math
npm test
```

覆盖：70 项零 token 回归 + 安装器 e2e（含幂等二次运行）+ 漂移检测 + **更名一致性检查**（`scripts/check-rename.mjs`，抓任何残留的 `--profile obsidian` / `default: obsidian` 等）。

```powershell
npm run qa   # 引擎探针：12 组 ground-truth 召回断言（需要真实 vault）
```

> `npm run qa` 的 ground truth 绑定你的真实 vault，需先设置：
> ```powershell
> $env:DSH_WORKSPACE_ROOT = "<你的笔记 vault 绝对路径>"   # 或旧名 DSH_OBSIDIAN_VAULT
> ```

### 2. 真实 token（端到端验收）

```powershell
npm run qa:e2e   # 起 --profile notes-assistant 真实服务 + 逐题验收（烧真实 tokens）
```

需要：`DSH_HOME`、`DSH_WORKSPACE_ROOT`（或 `DSH_OBSIDIAN_VAULT`）、`DSH_BIN` 三个环境变量 + 已配置的模型凭据。

## 三、Boot 冒烟测试（零 token，验证 profile 能加载）

**已验证通过**。可随时复跑：

```powershell
$tmp = Join-Path $env:TEMP ("dsh-smoke-" + [guid]::NewGuid().ToString("N").Substring(0,8))
node dsh/install.mjs install --dsh-home $tmp --quiet
$env:DSH_HOME = $tmp
dsh --profile notes-assistant --dump-config
```

应看到（关键标记）：`default: notes-assistant`、`mode: workspace-write`、`approval ... 'never'`、`defaultPreset: math-memory-locked`（不再挂载 `ui-skin-center`/`ui-web-ui-settings`）。

## 四、正式安装到你的真实 DSH_HOME

```powershell
# 方式 A：本机一键部署（scripts/deploy-local.mjs 已含你的机器路径，gitignored）
node scripts/deploy-local.mjs

# 方式 B：纯 CLI
node dsh/install.mjs install --dsh-home "C:\Users\小新air15\.dsh" --vault "<你的 vault 路径>"
```

装完后启动：

```powershell
dsh --profile notes-assistant --port 3180 --patch "$env:DSH_HOME\profiles\notes-assistant\notes-assistant.patch.yml"
```

## 四.5、在主 dsh（web UI）里用「数学笔记助手」preset

上面的安装是「独立 profile」模式（Obsidian 插件独占一个 dsh 进程）。若你想让「数学笔记助手」出现在**主 dsh 的 web UI**里（和 `liangshen` 等其它 preset 并列、不开 Obsidian 也能用），只装 preset：

```powershell
node dsh/install.mjs install --dsh-home "C:\Users\小新air15\.dsh" --preset-only
```

装完后：在主 dsh web UI 新建会话时选「数学笔记助手」preset，并把会话工作区设为你的 vault 目录。

> 注意：`--preset-only` 不装独立 profile，所以用的是主 dsh 的沙箱/审批（比独立 profile 的 fail-closed 宽松）。记忆文件仍写在你指定的工作区（默认 `.deepseek/`）。

## 四.6、独立的记忆设置面板（host-agnostic config 文件）

记忆系统的开关不再是只能改 preset（`agent.cordis.yml`）——每个工作区都有一个**独立的设置文件** `.deepseek/config.md`（frontmatter），与 Obsidian 插件、dsh web ui 都无关，任何环境（Obsidian / 主 dsh / CLI）共用同一份：

```markdown
---
enabled: true        # 总开关：false = 本工作区完全停用记忆
dialogueIndex: true  # 是否扫描历史会话生成跨会话问答线索
reminders: true      # 是否注入 🔔 备忘录提醒候选
audit: true          # 是否运行每日确定性记忆体检
---
```

- 缺省字段用 preset 默认值（`agent.cordis.yml`），本文件只覆盖当前工作区。
- `enabled: false` 时该工作区的记忆完全停用（文件保留、零注入）。
- 安装时会随模板自动写入 `<vault>/.deepseek/config.md`；也可手动创建。

## 五、手动 Obsidian 验证（无法自动化，需你点）

更新插件（`main.js` / `manifest.json` / `styles.css` 三件套，从 release 或 `node scripts/build-obsidian.mjs` 产物）后：

1. **重载插件**：Obsidian → 设置 → 社区插件 → 关闭再开启，或 Ctrl+P 执行「Reload app without saving」。
2. **服务自动启动**：确认右下栏聊天 iframe 出现，且 `127.0.0.1:3180` 有响应。
3. **反馈链接**：让助手引用一条记忆卡，点回复末尾的 `[✅ 这条对]` / `[❌ 这条错]`，确认卡片 frontmatter 的 `hook.verified` / `hook.success_rate` 被确定性改写。
4. **记忆面板**：打开记忆面板，确认五层可浏览/搜索/编辑（mtime 冲突防护）、hook 统计与 📈 趋势可见。
5. **捕获策略下拉框**：设置页改 idea/fact/preference 档位，确认写回 `.deepseek/capture-policy.md`。
6. **归档**：点「归档 >90 天事件」按钮，确认旧 episode 移入 `episodes/archive/` 且 index 同步。

## 六、环境变量（更名后）

新名优先，旧名仍兼容（可逐步迁移）：

| 新名 | 旧名（兼容） |
|---|---|
| `DSH_WORKSPACE_ROOT` | `DSH_OBSIDIAN_VAULT` |
| `DSH_MATH_MEMORY_LINK_URL` | `DSH_OBSIDIAN_LINK_URL` |
| `DSH_MATH_MEMORY_FEEDBACK_TOKEN` | `DSH_OBSIDIAN_FEEDBACK_TOKEN` |

## 七、已知遗留（非阻塞）

- **插件 id `dsh-math-assistant` 是稳定标识、永远不要改**——Obsidian 按 `.obsidian/plugins/<目录名>/` 加载插件，manifest 的 `id` 必须等于目录名；改 id 会让已有安装的插件「消失」。已加 `check-plugin-id.mjs` 守卫（`npm test` 会校验 id 与 deploy-local/插件 debug 路径一致）。
- 更名是破坏性的（旧 `obsidian/` 目录会变成孤儿，`install.mjs` 会打印提示让你清理）——但你当前无旧目录，无影响。
- 完整「别名转发 shim」（让旧 `--profile obsidian` 命令继续转发到新名）未做，如需要可补。
- `agent.cordis.yml` 的 persona 文本仍自称「Obsidian knowledge-base assistant」，属语义解耦（Phase 2 拆仓库时再改），不影响功能。
