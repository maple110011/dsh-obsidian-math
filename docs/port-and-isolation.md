# 独立端口与"两套用途互不干扰"（研究备忘，2026-09-11）

> **状态**：**结论已定，只记录，未改代码。** 本文回答用户的问题——"就『dsh 其他使用与笔记使用互不干扰』而言，独立 3180 端口有必要吗？独立端口相比其他方案优劣如何？"
>
> **结论速览**
> 1. **"独立 authority"是结构性必要的**：dsh 一个进程只能挂一个 profile（`--profile <name>` 单值），所以"编程用的 dsh"与"笔记用的 dsh"必然是**两个进程、两个监听端点**；端点 = (回环地址, 端口)，而两者都绑 `127.0.0.1` ⇒ **必须两个端口**。
> 2. **"3180 这个固定数字"不必要**，而且它是当前**唯一由端口引发的干扰**：第二个 vault 抢不到 3180 就**硬失败**（有 Notice，无回退）。代码本来就从**实际绑定的端口**推导 authority，所以动态端口在机制上等价；插件里已经有一个动态端口的先例（给 agent 回复用的 `LinkServer`）。
> 3. **端口不是"互不干扰"的主要杠杆。** 两套用途之间真正还在互相干扰的几项（会话列表、`workspace.json` 归档、皮肤、`$DSH_HOME` 全局状态、可能的记忆文件并发写）**全都由端口隔离不了**——换端口、换随机端口、换回环地址都不影响它们。

## 1. 先界定"互不干扰"指哪两套用途

| | 实例 | 谁起 | profile | 界面 |
|---|---|---|---|---|
| A | 用户自己的 `dsh web` | 用户 | `web` | 编程 + 记忆面板（`settings.section` 槽位）；Obsidian 用命令 `shell.openExternal` 打开 |
| B | 插件起的 notes 实例 | Obsidian 插件 | `notes-assistant` | 右侧栏 iframe 里的聊天 |

B 的装配（`obsidian/main.template.js:1106-1108`）：`dsh --profile notes-assistant --patch … --no-open --port 0`，即 **upstream 本身已经是 OS 分配的动态端口**；对外那个"用户知道的端口"是插件在主进程里跑的反代（`class DshWebProxy`）。A/B 共用同一个 `$DSH_HOME`（`:1077`）。

## 2. 为什么"必须两个端口"：端点才是绑定约束

**不是"两个 origin"，是"两个端点"。** 一个 dsh 进程要对外提供 web UI，就必须 listen 一个端点；端点由 (地址, 端口) 唯一确定。两个进程都要被浏览器（或反代）访问：

- 若两者都绑 `127.0.0.1` ⇒ 端口必须不同；
- 换 hostname 没用：`localhost:3180` 与 `127.0.0.1:3180` 是**两个 origin**，但仍是**同一个端点**，第二个进程绑不上；
- 唯一不用第二个端口的路子是**另一个回环地址**（`127.0.0.2:3180`），见 §5 方案 D。

而"一个进程挂两个 profile"这条捷径**当前不存在**：已安装的 `@deepseek-ai/dsh/lib/bin.js` 里 `--profile <name>` 是单值参数（launcher 一次只 boot 一个 profile 栈），`dsh web` 只是 `--profile web` 的硬编码别名。所以 A/B 两个用途 ⇒ 两个进程 ⇒ 两个端点 ⇒ **端口决策是被迫的，不是设计偏好**。

**"独立端口"买到的是"独立 origin"**，具体有两层：

1. **浏览器侧**：不同 authority ⇒ 不同 cookie jar / localStorage / CacheStorage。这一层在当前实现里其实**没有被用到**——反代的 `forward()` 会**删掉** upstream 的 `set-cookie`（`main.template.js:760`），cookie 由代理自己持有并注入（`:748`）。所以就算同 origin，浏览器也不会串味；真正靠 origin 区分的是**面板 UI 与聊天 UI 的界面状态**（例如面板把工作区 root 存在 `localStorage.dsh-math-memory.panelRoot`）。
2. **生命周期**：两个进程，重启/崩溃/升级互不连坐。**注意这来自"多起了一个进程"，不来自端口号**——把两者塞进同一个端口反而会退化成耦合（§5 方案 C）。

## 3. 为什么"3180 这个数字"不必要

代码里**没有任何地方把 3180 写进机制**，它只是一个默认值：

- 反代 `listen(port)` 之后立刻 `this.port = server.address().port`（`:685-689`），`publicAuthority` 从**实际绑定端口**推导（`:663-665`）；
- 兑换 cookie 时以该 authority 作为 `Host` 送出（`:715-743`）——dsh 按请求 authority 命名 cookie，浏览器访问的也是同一个 `proxy.baseUrl`，两边天然一致。**只要"绑定的端口"与"兑换时声称的 authority"是同一个值，任何端口都成立**（包括 0 ⇒ OS 分配）。

也就是说：换成动态端口在机制上等价，代价只在**人**这一侧：

| 固定端口买到的 | 谁在用 |
|---|---|
| 可记、可书签、可 `curl` 的稳定地址 | `docs/session-scope.md` §2.2 的 curl 示例；`scripts/qa/sidebar-attach-probe.mjs:54` 靠 `127.0.0.1:3180` 找 iframe target |
| "3080 = 我的 dsh，3180 = Obsidian 里那个"的心智模型 | README、设置页文案（`main.template.js:2686`）、多份文档 |
| 启动前的占用预检（`:1056`）能发现"有个不是我们的服务" | 有诊断价值，但也正是 §4 那个硬失败的来源 |

**先例说明"稳定端口"并非这个插件的硬需求**：给 agent 回复用的 `DSH_MATH_MEMORY_LINK_URL` 指向的 `LinkServer` 就是 `listen(0)`、每次启动换端口、每次换 token（`:267-271`，注入点 `:1074`）。它照样能用，因为那个地址是**写进 prompt** 的，不是**被人记住**的。

## 4. 端口目前**制造**的那个干扰：多 vault 抢占

`DEFAULT_SETTINGS.port = 3180`（`:137`）存在 vault 内的插件数据里（`loadData`/`saveData`，`:2640-2644`），即**每个 vault 各自一份、默认值相同**。两个 vault 同时打开、都装了插件时：

- 先进者占用 3180；
- 后进者 `_start()` 预检 `probeServiceStatus(3180) !== 'down'` ⇒ 记日志 + `new Notice('…端口 3180 被其他服务占用…')` + **抛错**（`:1056-1059`），`resolveAuth` 的 `listen` 也没有回退（`:969-989`）。
- 用户看到的提示是"**其他服务**占用"，不会告诉他那是**另一个 vault 的自己**。

这是**固定端口直接导致的失败**，而它要解决的问题（"两根网线插一个口"）跟用户想防的干扰无关。

## 5. 替代方案与优劣

| 方案 | 隔离来自 | 端口 | 优点 | 代价 / 缺点 | 结论 |
|---|---|---|---|---|---|
| **A 现状**：独立 + 固定 3180（可配） | 独立进程 + 独立端点 | 固定 | 地址稳定可记、文档/探针/curl 都指着它；与 3080 心智模型清晰；预检能发现外来服务 | 多 vault 抢端口**硬失败**；与别的软件抢 3180 | **保留** |
| **B 独立 + 端口自动**（占用即回退到 OS 分配，或直接 `listen(0)`） | 同 A | 动态 | 永不冲突；多 vault 天然可用；无设置项；机制上零代价（§3） | 地址每次变：书签/文档 curl/附着探针失效；**实现要小心**：`resolveAuth` 现在是 `proxy.port !== wanted` 就重听（`:974`），`wanted` 传 0 会导致每轮 300 ms 反复重绑并换端口 ⇒ 需要一个"请求值"字段而非拿实际端口比 | **推荐的最小改动**（3180 仍作首选，占用时回退并**显示实际地址**） |
| **C 同端口 + 路径路由**（一个反代伺服两个 profile） | 无（同 origin） | 共享 | 只占一个端口 | 两种 UI 同 origin ⇒ localStorage/缓存/界面状态互相污染；B 变成**依赖 A 在跑**，A 重启就打断侧栏（生命周期耦合）；还要求 dsh web 客户端支持子路径挂载（未验证，倾向不支持） | **不做** |
| **D 另一个回环地址**（`127.0.0.2:3180`） | 同 A（端点不同） | 号码可相同 | 号码不撞车；Windows 整个 `127.0.0.0/8` 都是回环 | 地址更怪；非 `.1` 回环对安全软件/代理不友好；仍解决不了"同号码、不同实例"的困惑 | 不做 |
| **E 彻底不要对外端口**：把 dsh UI 以**同源** iframe 载入（`app://` 静态资源）+ `postMessage` 桥接 API | 同源，无跨站 | 无需 | 连 SameSite 反代这一整层都不需要了（反代存在的唯一理由就是跨站 cookie）；Obsidian CSS 能够到面板；多 vault 无冲突 | 要改 dsh web **客户端传输层**（fetch/EventSource/WebSocket → postMessage），是跨仓库的大改；静态资源要走 Obsidian 的 `app://` 与 CSP；失去"在真浏览器里打开面板" | **记录，暂不做**（将来若要拆掉反代再议） |
| **F 一个进程挂两个 profile** | 单实例 | 一个 | 无端口问题；会话/皮肤天然一致 | **核心不支持**（`--profile` 单值）；且失去 fail-closed 隔离，面板侧出问题会连坐编程会话 | 不可选（除非上游改） |
| **G 笔记侧直接用 3080 那台** | 无 | 共享 | 无 | 3080 是 `web` profile，没有笔记 profile 的插件与工具集 ⇒ 等于放弃笔记侧的产品形态 | 不可选 |

顺带一条与隔离无关但值得写明的：两个实例都只绑 `127.0.0.1`（`:685`），局域网不可达；端口大小本身不承担安全职责。

## 6. 端口隔离不了的那几项（这才是"互不干扰"的真正缺口）

以下都**不随端口变化**，逐条都是"换端口 / 换随机端口 / 换回环地址都没用"：

| 干扰面 | 现状 | 证据 |
|---|---|---|
| **会话列表** | 两侧看到同一批会话；`DSH_SESSIONS_ROOT` **不是**这个开关，列表跟的是 `session-persistence-jsonl` 的 `root` 配置 | `main.template.js:1081-1084` 的注释；[`session-scope.md`](session-scope.md) §2.4 |
| **归档状态** | `archiveSession()` 写在 `$DSH_HOME/storages/workspace.json`，**所有 profile 共用** ⇒ 在 Obsidian 侧归档会在编程侧一起消失 | [`session-scope.md`](session-scope.md) §2.3（含"收窄会话列表"已被用户**否决**的记录） |
| **同一会话不能两边同开** | dsh ≥0.1.5 的会话写锁（Windows 命名信号量 / POSIX flock） | `docs/handoff.md` 陷阱 28 尾注、[`dsh-0.1.5-adaptation.md`](dsh-0.1.5-adaptation.md) |
| **皮肤** | 皮肤本体走全局 `$DSH_HOME/cordis.patch.yml` ⇒ 在主 web 选的皮肤侧栏照样跟随 | `main.template.js:1406,1420` 注释 + 设置页文案（`:2776`） |
| **`$DSH_HOME` 全局状态** | 两个实例同一个 home | `main.template.js:1077` |
| **记忆文件并发写**（**假设，未验证**） | 两端写 `.deepseek/memory/**` 都是**就地 `writeFileSync`、没有锁**；面板（3080）做归档/体检/改名，笔记侧 agent 随时捕获与蒸馏，指向同一 vault 时理论上可丢更新 | `dsh/host/memory-admin.mjs:1385,1436,1494`、`dsh/preset/math-memory.mjs:692,718,1038,1124`（只有索引缓存用了 staging+`renameSync`，`:2218-2219`）。**先实测再当结论**——按本仓库的教训，不要从"两端都写"直接推出"会丢" |

## 7. 建议

**现在就做（若要在端口上动）**
1. 保留 3180 作默认与"首选端口"，把**占用即失败**改成**占用即回退**：预检发现占用时不要抛错，改 `listen(0)`，并在状态栏/Notice 里显示**实际地址**（分不清"外来服务"与"另一个 vault 的自己"是当前最容易误诊的一点）。
2. 顺带修 §5 方案 B 里那个实现陷阱：给 `DshWebProxy` 增加"请求端口"字段，`resolveAuth` 用它判断是否需要重听，否则 `wanted = 0` 会每 300 ms 重绑并让已兑换的 cookie 失效。

**明确不做**：C（同端口路径路由）、D（另一个回环地址）、G（复用 3080 那台）。
**记录在案、等触发条件**：E（同源 + `postMessage`，唯一能同时消灭反代与端口的路子，但代价是跨仓库改客户端传输层）、F（要上游支持一进程多 profile）。

**如果"互不干扰"的真实痛点是别的**（会话列表混在一起、皮肤互相影响、归档互相牵连），那**不要把力气花在端口上**——`session-scope.md` 已经评估过会话收窄并被否决（否决理由仍然成立：代价与收益不成比例、有折叠这个零成本替代），其余几项是独立议题，应先各自立条目再决定。

## 8. 证据索引（本文断言对应的源码位置）

- 反代与 authority：`obsidian/main.template.js:491`（class）、`:663-665`（`publicAuthority`）、`:676-690`（`listen` + `server.address().port`）、`:715-743`（以公共 authority 兑换 cookie）、`:746-754`（`host` 改写）、`:760`（剥 `set-cookie`）
- 端口配置与硬失败：`:137`（默认值）、`:2640-2644`（per-vault 数据）、`:969-989`（`resolveAuth` 无回退）、`:1050-1060`（预检抛错）、`:2684-2696`（设置项）
- 笔记实例的装配：`:1075-1102`（env：共享 `DSH_HOME`、`DSH_SESSIONS_ROOT`、链接基址与 token）、`:1106-1115`（`--profile notes-assistant … --port 0`）
- 动态端口的既有先例：`:241-271`（`LinkServer` `listen(0)`）、`:1074`（把它作为 `DSH_MATH_MEMORY_LINK_URL` 注入）
- profile 单值（"为什么必须两个进程"）：已安装包 `@deepseek-ai/dsh/lib/bin.js`（`--profile <name>` 单值；`dsh web` = `--profile web` 别名）
- 端口无关的干扰：`docs/session-scope.md` §2.3/§2.4、`docs/handoff.md` 陷阱 28、`main.template.js:1406,1420,2776`、`dsh/host/memory-admin.mjs` 与 `dsh/preset/math-memory.mjs` 的写入点
