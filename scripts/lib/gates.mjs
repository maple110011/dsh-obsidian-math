/**
 * scripts/lib/gates.mjs — the list of gates `npm test` runs.
 *
 * Why this is a module and not a literal inside `run-gates.mjs`
 * -------------------------------------------------------------
 * The *number* of gates is quoted in prose (`AGENTS.md` §4 said "本机当前
 * 34/34" long after the list had grown past it), and a hand-written count on the
 * first-read path rots exactly like the trap count did. So the list itself is
 * the single source of truth: `run-gates.mjs` runs it, and
 * `check-doc-counts.mjs` counts it and compares every doc claim.
 *
 * The order mirrors the historical `&&` order so results stay comparable run to
 * run. `--only <substring>` filters by `name`, so names must stay unique and
 * descriptive.
 */
export const GATES = [
  { name: 'syntax: dsh/install.mjs', args: ['--check', 'dsh/install.mjs'] },
  { name: 'syntax: dsh/preset/note-tools.mjs', args: ['--check', 'dsh/preset/note-tools.mjs'] },
  { name: 'syntax: dsh/preset/math-memory.mjs', args: ['--check', 'dsh/preset/math-memory.mjs'] },
  { name: 'syntax: dsh/profile/math-memory-workspace.mjs', args: ['--check', 'dsh/profile/math-memory-workspace.mjs'] },
  // A′ module with no caller yet (docs/bundle-channel-plan-2026-09-26.md S1). Syntax-checked so it
  // cannot rot before S4 wires it up; trap 95 is the precedent (a broken export shipped for a round
  // because no gate ever executed it).
  { name: 'syntax: dsh/profile/local-bundle.mjs', args: ['--check', 'dsh/profile/local-bundle.mjs'] },
  { name: 'syntax: main.js (generated bundle)', args: ['--check', 'main.js'] },
  { name: 'preset: imports and exposes its name', args: ['-e', "import('./dsh/preset/math-memory.mjs').then(m=>console.log('preset ok:', m.name))"] },
  { name: 'test: memory regression', args: ['scripts/test-memory.mjs'] },
  { name: 'test: panel routes', args: ['scripts/test-panel-routes.mjs'] },
  { name: 'test: panel auth e2e (real dsh)', args: ['scripts/test-panel-auth.mjs'] },
  { name: 'test: panel loopback proxy', args: ['scripts/test-panel-proxy.mjs'] },
  { name: 'test: panel presentation layer', args: ['scripts/test-panel-present.mjs'] },
  { name: 'test: installer e2e', args: ['scripts/test-installer.mjs'] },
  { name: 'check: rename', args: ['scripts/check-rename.mjs'] },
  { name: 'check: skin fallback', args: ['scripts/check-skin-fallback.mjs'] },
  // `.deepseek/config.md` 的"没有就从脚手架创建"有两个前端（Obsidian 设置页 / 面板路由），
  // 它们曾经给出不同内容：面板的字面量写 `autoArchive: false` 且漏了 `captureSubagents`，而权威模板
  // `dsh/templates/config.md` 写的是 `true` ⇒ 同一个 vault 的 `autoArchive` 默认值取决于你先点了哪个 UI
  // （handoff §7）。这条门禁把回退字面量钉在模板上（键、顺序、值），并断言运行期仍优先读真模板。
  { name: 'check: config scaffold parity', args: ['scripts/check-config-scaffold.mjs'] },
  // `onunload()` 必须无条件释放它开过的 socket：代理绑的是 `settings.port`，**在 Obsidian 进程里**，
  // 泄漏之后下一次启用永远绑不上（EADDRINUSE 重试 ~20 s → "dsh 服务未能在端口 N 上启动"，且每次重试
  // 都再拉一个 dsh 子进程）。实机 2026-09-26 踩到：清理被挂在 `service.child !== null` 上，而 child 退出
  // 时就被置空，于是失败/被杀之后卸载完全不清理。
  { name: 'check: plugin unload cleanup', args: ['scripts/check-plugin-unload.mjs'] },
  // 原先这里还有一条 `check: mirror cleanup (dangling @linxin666 junctions)`：它守的是
  // "镜像循环只走 web 侧、被删掉的包永远不被回访，于是留下悬空 junction"（2026-09-25 实测 9 条）。
  // **2026-09-26 镜像本身退役了**（skin-center 0.4.x 已不再往全局 patch 写皮肤行，"镜像"失去了
  // 存在理由；而本机经历过一次 harness home 全损、目录链接是疑似载体，全局守卫此后禁止建链），
  // 所以那条门禁与被测代码一起删除，而不是留着测一段死代码。
  { name: 'check: plugin id', args: ['scripts/check-plugin-id.mjs'] },
  // 0.1.7 的插件管理页用三样东西画一张卡片：`package.json.icon` 与
  // `<pkg>/locale/<lang>.json` 的 `meta.title`/`meta.description`。本插件此前**一样都没声明**，
  // 卡片只能显示包名、没有图标——而这三种错法都会**静默降级**（locale 缺失 → 回退英文；
  // 图标不合格 → 保留默认图），"文件在不在"式的检查一个都抓不到。这条门禁跑**真的读取器**
  // （dsh-app-boot 的 `readPluginMeta`），并断言中英标题不同（证明 zh.json 真的被读了）。
  { name: 'check: plugin manifest meta (icon/locale)', args: ['scripts/check-plugin-manifest-meta.mjs'] },
  { name: 'check: version consistency', args: ['scripts/check-version-consistency.mjs'] },
  { name: 'check: doc consistency', args: ['scripts/check-doc-consistency.mjs'] },
  // 双语文档配对：README.md ↔ README.zh.md 的结构、切换行、链接集合与一致性记录。
  // 此前没有任何门禁覆盖这一对，于是 zh 侧把"社区插件市场能搜到"这条**不存在**的
  // 安装方式留在了原地（评估报告第 16 条 HIGH），两边的版本行也一起停在 0.7.5。
  // 变异验证：`node scripts/check-readme-pair.mjs --selftest`（同进程、不产生子进程）。
  { name: 'check: readme pair (en/zh)', args: ['scripts/check-readme-pair.mjs'] },
  { name: 'check: embedded loader', args: ['scripts/check-embedded-loader.mjs'] },
  { name: 'check: embedded writers', args: ['scripts/check-embedded-writers.mjs'] },
  { name: 'check: engine sync (preset vs host)', args: ['scripts/check-engine-sync.mjs'] },
  // 0.1.7 把 preset 变成「组合包里的一行声明」，于是"体文件清单"一度存在四份，而其中
  // 三份是错的：`install --direct` 那份**缺两个文件**，产出的 profile 每次建会话都
  // `agent-preset/invalid`，而当时所有门禁都是绿的（installer 门禁断言的是**已退役**的
  // `.agent-presets/` 布局）。这条门禁把清单收敛到 preset-deploy.mjs 的**相对 import
  // 闭包**，并钉住两个通道各自的 name 形态（bundle 走包内 specifier、overlay 走 `./`）——
  // 后者是首次冷启动能不能建出会话的分界线。变异验证：清单漏一项 → 红（已跑）。
  { name: 'check: preset body lists agree', args: ['scripts/check-preset-body-lists.mjs'] },
  // The upstream of every other list (2026-09-26, B2): `dsh/preset/profile-contract.mjs` is the ONE
  // statement of what gets staged / which rows exist / which routes are served. It says explicitly
  // which assertions READ the contract and which only PIN a hand-written list.
  { name: 'check: profile contract is the single source', args: ['scripts/check-profile-contract.mjs'] },
  // 用户现场发生过四次 `$DSH_HOME` 被清空（陷阱 56/59）。插件号称每次启动都会从内嵌副本重建 profile，
  // 但在 2026-09-26 之前**没有任何门禁执行过那个函数**：`check-embedded-writers` 跑的是内嵌的
  // memory-admin，`check-profile-contract` 只验清单是派生的（不验真的写），自带的 real-profile 门禁又是
  // 自己铺 profile、绕过插件引导。这条门禁把 `bootstrapDshConfig` 从生成的 main.js 里抽出来真跑一遍
  // （抽取用 acorn 真解析器，不是手数括号），在"整个 home 不存在""manifest 在但正文没了""第二次启动"
  // 与"别的通道拥有"四种现场上验恢复。
  { name: 'check: plugin rebuilds a wiped $DSH_HOME', args: ['scripts/check-bundle-recovery.mjs'] },
  // 声明块是生成的，两个通道两种形态。生成器自己的 `--check` 就是漂移守卫——
  // 此前 build-preset-declaration.mjs 与 lib/preset-declaration.mjs 的注释都引用了一个
  // **不存在**的 `check-preset-declaration.mjs`，于是漂移只被 test-agent-preset 顺带看到。
  { name: 'check: preset declaration is current', args: ['scripts/build-preset-declaration.mjs', '--check'] },
  { name: 'check: frontmatter single source', args: ['scripts/check-frontmatter-source.mjs'] },
  { name: 'check: env vars vs docs/env-vars.md', args: ['scripts/check-env-vars.mjs'] },
  { name: 'check: doc constants (tools/papers)', args: ['scripts/check-doc-constants.mjs'] },
  // 手写计数不能落在 agent 的首读路径上：陷阱条数曾写「69」而实际 81，门禁总数曾写
  // 「34」而实际已 41。真值分别来自 handoff §4 的编号与 scripts/lib/gates.mjs。
  { name: 'check: doc counts (traps/gates)', args: ['scripts/check-doc-counts.mjs'] },
  { name: 'check: agent instruction files', args: ['scripts/check-agent-instructions.mjs'] },
  // 随包发出的 *.patch.yml / *.cordis.yml 必须**真的能解析**。2026-09-21 实测：profile 的
  // cordis.patch.yml 第一行与上一条注释拼在了同一行（`…plugin.- id: agent-presets`），
  // 该行被注释掉 ⇒ 顶层序列从未开始 ⇒ 后面那个裸 `- id:` 是 YAML 语法错误，**真 dsh 直接
  // 拒绝启动整个 notes-assistant profile**。当时**没有任何门禁发现**：preset 门禁是因为它
  // 真的启动 dsh 才撞上的（而那条门禁在沙箱里会因别的原因失败，于是这个 YAML 错误在受限
  // 环境里根本不可见），其余门禁都把这些文件当**文本**读（`test-installer.mjs` 的漂移比对
  // 逐字节比较已装文件，而被改坏的行仍然是合法文本）。这条门禁只做别的门禁都没做的那件事：**解析它**。
  { name: 'check: shipped yaml parses', args: ['scripts/check-patch-yaml.mjs'] },
  { name: 'check: release artifact paths', args: ['scripts/check-release-paths.mjs'] },
  { name: 'check: client bundle freshness', args: ['scripts/check-client-bundle.mjs'] },
  // 记忆面板的**客户端半个**是一个安装时才生成的包。它曾经把宿主入口拷到包根、再手挑
  // 四个兄弟文件 —— 0.1.7 给 `host/index.mjs` 加了一个相对 import 之后，那份手写清单少了
  // 三个目标，包**根本 import 不起来**（`ERR_MODULE_NOT_FOUND …/preset/preset-deploy.mjs`），
  // 而安装器打印的是"包已就位"。现在改成复制**相对 import 闭包**，并由这条门禁真的
  // `import()` 一次产物（两个宿主半分支各一次）。变异验证：闭包截断成只剩入口 → 红（已跑）。
  { name: 'check: client package layout', args: ['scripts/check-client-package-layout.mjs'] },
  { name: 'check: main.js bundle freshness', args: ['scripts/check-bundle-freshness.mjs'] },
  { name: 'syntax: scripts/lit-import.mjs', args: ['--check', 'scripts/lit-import.mjs'] },
  { name: 'syntax: dsh/host/memory-admin.mjs', args: ['--check', 'dsh/host/memory-admin.mjs'] },
  { name: 'syntax: dsh/host/math-memory-panel.mjs', args: ['--check', 'dsh/host/math-memory-panel.mjs'] },
  { name: 'syntax: dsh/host/index.mjs', args: ['--check', 'dsh/host/index.mjs'] },
  { name: 'syntax: dsh/host/channel-owner.mjs', args: ['--check', 'dsh/host/channel-owner.mjs'] },
  { name: 'syntax: dsh/host/hook-frontmatter.mjs', args: ['--check', 'dsh/host/hook-frontmatter.mjs'] },
  // 通道归属：锚点是 profile 的 `.install-manifest.json`，退役的 `.agent-presets/<id>/.owner.json`
  // 只作回退。这个优先级是重点——守卫原先只认那个没人读的目录，于是"清理死目录"会**静默废掉**它。
  // 最后一段用带 cache-busting 的 in-process `import()` 直接调**真的** `dsh/host/index.mjs`
  // （`apply` 有模块级 `mounted` 旗标，同进程一份实例只能跑一个场景），无需启动 dsh。
  { name: 'test: channel ownership anchor', args: ['scripts/test-channel-owner.mjs'] },
  // 「从 Obsidian 文件树拖一篇笔记进输入框」：载荷解析（每条拒绝条件都对应一个 if）+
  // DOM 接线（该不该 preventDefault、什么时候放行、落点、提示自愈、幂等与清理）。
  // **它跑的是 dsh/client-panel/lib/client.js 这个真产物**（用宿主的 ModuleLoader 协议求值），
  // 所以"改了源码忘了重建 bundle"会在这里红，而不是等用户发现功能不存在。
  { name: 'test: drop-to-mention', args: ['scripts/test-drop-mention.mjs'] },
  // 「新建会话」真的能建出来吗：preset 字段漂移（persona 的 text→prefix）会让每次建会话
  // 都以 HTTP 200 + ok:false 失败，而 UI 只写一行 console.warn ——零 token，需要本机 dsh，
  // 否则按设计 SKIP（见 scripts/test-agent-preset.mjs 与 handoff.md 坑 70）。
  // 工具 output schema 的契约：dsh ≥0.1.5 严格校验成功返回值，而我们的 schema 是
  // `additionalProperties: false` ⇒ 多返回一个字段 = 每次调用都失败（2026-09-14 真实故障）。
  { name: 'test: tool output schemas vs dsh validator', args: ['scripts/test-tool-schemas.mjs'] },
  { name: 'test: tool output shape (real pipeline)', args: ['scripts/test-tool-shape.mjs'] },
  // 文献索引的「状态」列是生成的：它原先取条目的机器默认值（恒为 unread），而
  // cards/*.md 跨导入是保留的 —— 于是全库卡片其实都已蒸馏、索引却全显示「未读」，
  // 且没有任何门禁会因此失败。逻辑抽到 scripts/lib/lit-index.mjs，本套件**进程内**
  // 导入它（沙箱禁止捕获子进程管道输出，spawn/exec → EPERM，所以不能 shell 出去）。
  { name: 'test: lit-import index logic', args: ['scripts/test-lit-import.mjs'] },
  // 链接跳转服务的端口/令牌必须跨插件加载稳定：否则旧回复里的笔记链接会静默失效
  // （端口没人听 / 令牌 403）。2026-09-14 用户实测的"双链点了没反应"就是这个。
  { name: 'test: link server port+token stability', args: ['scripts/test-link-server.mjs'] },
  { name: 'test: agent preset mounts (real dsh, no tokens)', args: ['scripts/test-agent-preset.mjs'] },
  // 阶段 3 验收：自己离线装一份**bundle 形态**的 profile（profile 名故意不叫
  // `notes-assistant`），冷启动它，并真建一个会话。与上一条的分工：上一条用仓库里的
  // 文件自己铺 preset（证明**仓库**对），这一条走官方插件管理留下的那份形状
  // （证明**装出来的那份**对）。
  //
  // 这条门禁取代了 `test: deployed profile accepts a session`——那一条从机器上已部署的
  // profile 出发，2026-09-25 它抓到了真实缺陷，但现场随 `$DSH_HOME` 一起没了之后它就
  // 只会 SKIP（0/0 断言、exit 0），于是"45/45 全绿"里含一条什么都没比的门禁。而它测的
  // 那种形状恰好是**唯一没坏**的那种：实测另有三种形态全坏（profile 名 ≠ 常量、
  // 冷启动第一次、`--direct`），一条都没被覆盖。现在它自带 profile，这三种一起钉住。
  { name: 'test: self-provisioned profile accepts a session (real dsh)', args: ['scripts/test-real-profile-accept.mjs'] }
];
