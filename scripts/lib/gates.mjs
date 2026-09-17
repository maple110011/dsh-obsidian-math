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
  { name: 'check: plugin id', args: ['scripts/check-plugin-id.mjs'] },
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
  { name: 'check: frontmatter single source', args: ['scripts/check-frontmatter-source.mjs'] },
  { name: 'check: env vars vs docs/env-vars.md', args: ['scripts/check-env-vars.mjs'] },
  { name: 'check: doc constants (tools/papers)', args: ['scripts/check-doc-constants.mjs'] },
  // 手写计数不能落在 agent 的首读路径上：陷阱条数曾写「69」而实际 81，门禁总数曾写
  // 「34」而实际已 41。真值分别来自 handoff §4 的编号与 scripts/lib/gates.mjs。
  { name: 'check: doc counts (traps/gates)', args: ['scripts/check-doc-counts.mjs'] },
  { name: 'check: agent instruction files', args: ['scripts/check-agent-instructions.mjs'] },
  { name: 'check: release artifact paths', args: ['scripts/check-release-paths.mjs'] },
  { name: 'check: client bundle freshness', args: ['scripts/check-client-bundle.mjs'] },
  { name: 'check: main.js bundle freshness', args: ['scripts/check-bundle-freshness.mjs'] },
  { name: 'syntax: scripts/lit-import.mjs', args: ['--check', 'scripts/lit-import.mjs'] },
  { name: 'syntax: dsh/host/memory-admin.mjs', args: ['--check', 'dsh/host/memory-admin.mjs'] },
  { name: 'syntax: dsh/host/math-memory-panel.mjs', args: ['--check', 'dsh/host/math-memory-panel.mjs'] },
  { name: 'syntax: dsh/host/index.mjs', args: ['--check', 'dsh/host/index.mjs'] },
  { name: 'syntax: dsh/host/preset-sync.mjs', args: ['--check', 'dsh/host/preset-sync.mjs'] },
  { name: 'syntax: dsh/host/hook-frontmatter.mjs', args: ['--check', 'dsh/host/hook-frontmatter.mjs'] },
  { name: 'test: preset sync', args: ['scripts/test-preset-sync.mjs'] },
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
  { name: 'test: agent preset mounts (real dsh, no tokens)', args: ['scripts/test-agent-preset.mjs'] }
];
