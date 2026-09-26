# 两个（其实是三个）设置面怎么融洽：取证与处置（2026-09-26）

> **一句话结论**：**不是"两套设置在打架"，而是"三个面各管一类事，但没人告诉用户谁管谁"**。
> 已查证：**每一个键都只有一个执行点**（两个 UI 调的是同一个 `MEMORY_ADMIN.*` 函数、且兜底语义一致），
> 所以**不存在双写者**；真正缺的是**归属说明**与**可发现性**（还有 6 个开关根本没有 UI 入口）。

## 1. 三个面各是什么（取证）

| 面 | 位置 | 管什么（实测条目） |
|---|---|---|
| **① Obsidian 插件设置页** | Obsidian → 设置 → 本插件（`DshObsidianSettingTab`） | **连接与进程**：端口 / dsh 安装目录 / `DSH_HOME` / 开机自动起服务 / 关闭时保留服务 / 自动初始化配置与模板 / 显示侧栏按钮 / 皮肤中心三项 / 侧栏性能模式 / 笔记链接打开位置；**以及 4 组记忆开关**：捕获策略（idea/fact/preference/structure）、自动保存对话、注入预算档位、启动时自动归档旧事件 |
| **② 记忆面板** | **同一个 React 面板**，两个宿主都能看到：Obsidian 侧栏 + dsh 3080（`settings.section` 槽位，`dsh/client-panel/src/index.jsx`） | **记忆的内容与日常操作**：看卡（✅/⚖️/❓ 徽标）/ ❌ 反馈 / 归档 / 保存本轮 / 捕获策略 / 自动保存对话 / 会话捕获状态 |
| **③ `.deepseek/config.md`（+ `capture-policy.md`）** | vault 里的文件 | **记忆系统的总开关与档位**：`enabled` / `dialogueIndex` / `reminders` / `audit` / `autoArchive` / `sessionCapture` / `captureSubagents` |

## 2. 重叠区：实测"一人一份实现"，不是双写者

重叠的三组键：**捕获策略**、**自动保存对话**、**注入预算档位**（①②都有）。

一开始我怀疑"两个 UI 各写各的"（今晚 B3 那个根因的同族），于是去查**执行点**：

```js
// obsidian/main.template.js:365-367 —— 三个设置项都只是转发，且都带内嵌兜底模板
const setCapturePolicyMode = (vault, field, mode) => MEMORY_ADMIN.setCapturePolicyMode(vault, field, mode, typeof EMBEDDED_TEMPLATES['capture-policy.md'] === 'string' ? … : '');
const setSessionCaptureMode = (vault, enabled)   => MEMORY_ADMIN.setSessionCapture(vault, enabled, typeof EMBEDDED_TEMPLATES['config.md'] === 'string' ? … : '');
const setMemoryBudgetMode   = (vault, tier)      => MEMORY_ADMIN.setMemoryBudget(vault, tier, typeof EMBEDDED_TEMPLATES['config.md'] === 'string' ? … : '');
```

⇒ ① 是**转发层**，② 的面板走 `POST /memory-panel/*` → 同一批 `MEMORY_ADMIN.*` 函数（面板传的兜底来自
`configScaffold()`，指向**真模板**）⇒ **同名键只有一个写入者**，兜底语义也一致 ✓。

> ⚠️ **过程记录（值得留）**：我第一次读这段时看到的是**被 grep 截断的半行**，据此写下"设置页少传兜底 ⇒
> 策略文件不存在时会抛错、面板却成功"的结论 —— **是错的**。查档（看完整行）之后推翻。
> 这正是 AGENTS.md §6 那条"先取证"的又一次生效：**别拿半行代码当证据**。

## 3. 真正的问题：归属不清 + 6 个开关没有 UI

1. **同一件事在两个地方都能改**（捕获策略/自动保存/预算），用户不知道哪个"算数" —— 答案是"都算数、
   因为是同一份实现、同一个文件"，但**界面上没有任何一句话这么说**。
2. **6 个开关只能在文件里手改**：`enabled`（记忆总开关）、`dialogueIndex`、`reminders`、`audit`、
   `autoArchive`（体检自动归档**卡**，与 ① 里那项"自动归档旧**事件**"不是一回事）、`captureSubagents`。
3. ① 里那项"启动时自动归档旧事件（>90 天）"与 ② 的 `POST /memory-panel/archive-episodes` 是**同一件事的
   自动/手动两个入口** —— 属于**互补**，不是冲突（但它俩的措辞让用户以为是两件事）。

## 4. 处置（按"最小且能减混乱"排序）

**已做（不改行为，只加说明与归属）**：
- ✅ **A. 在 ① 的记忆类设置上面加一句归属说明**（"记忆的完整面板在侧栏「记忆」里；这里只放连接与进程类设置，
  以及三个常用开关"）——用户可见、纯增量、零行为变化。
- ✅ **B. 本文档 + `AGENTS.md` §1 索引**（三个面 × 各管什么 × 谁执行）。
- ✅ **C. 六个"只能在文件里改"的开关 → 补上两个（你已拍板）**：`enabled`（记忆总开关）与 `autoArchive`
  （体检自动归档低效用卡）已做成设置页的开关（提交 `feb6768`；宿主 `setMemoryConfigFlag` 走白名单 + 写回
  校验；变异 M38）。其余四个（`dialogueIndex` / `reminders` / `audit` / `captureSubagents`）留在文件里，
  由设置页那句说明指路 —— 它们属于"装好就不动"的档位。
- ✅ **D. 描述瘦身**（提交 `1917dac`）：最长 633 → 106 字符；删掉更新记录与实测数字，保留"做什么 / 代价 /
  要不要重启"。

**明确不做**：
- 不删 ① 里那三组开关（删了会伤可发现性：用户会在"设置"里找记忆开关，而不是先去侧栏找面板）。
- 不把 ② 的面板搬进设置页（面板的价值恰恰是**常驻在侧栏**、和记忆内容在一起）。

**判据（以后遇到同类问题的通用答案）**：
> **谁执行、文件是权威、UI 可以多入口但必须同实现。**
> ① **执行点唯一**（同名键只有一个 `MEMORY_ADMIN.*` 函数）；② **文件是权威**（`config.md` /
> `capture-policy.md`，与 `dsh/templates/config.md` 的"模板权威"一致）；③ **多入口必须收敛到同一实现**
> （否则就是今晚 B3 那个"两个人写同一份文件"的根因）。这条与 `check-config-scaffold.mjs`（第 49 条门禁，
> 逐字段比对面板字面量与真模板）是同一族纪律。

## 5. 与今晚其它改动的关系

- ③ 的位置（vault 文件）与 B3 搬走的"preset 声明"不同：**声明**必须住在没人重写的地方（B3）；
  **用户偏好**必须住在**用户能编辑且我们只读它**的地方（`config.md`）——同一个"谁能写"的问题，两种正确解。
- 面板在**两个宿主**里是同一份 React 代码（`dsh/client-panel/src/index.jsx` + `lib/client.js`），
  所以"dsh 侧设置"与"Obsidian 侧设置"在记忆面板这一块**本来就是同一个东西**；差别只在宿主容器。
