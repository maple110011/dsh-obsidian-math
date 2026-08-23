# dsh 面板机制调研（2026-08）

> 目标：为 dsh-math-memory 的「记忆管理面板」选择 dsh web 里的挂载方式。
> 结论：**优先用官方 `settings.section` 槽位（noema 路线），不采用 aionui 的自挂 DOM 列。**

## noema 的做法（已核实，子代理调研 + 源码 URL）

- 形态：npm 插件 `@zseven-w/dsh-noema`，宿主 `src/` + 客户端 `src/client/`。
- 接入：package.json 的 `dsh.bundle.patch` 指向 cordis.patch.yml（profile 层 insert），`dsh.client.inject` 声明 runtime/locale/ui-settings；构建产物 `lib/index.js` + `lib/client.js`。
- 宿主注入：`inject=['tools']`（必需）；再按需 `ctx.inject(['systemPrompt'])`、`['webServer']`、`['settings']`；路由 `webServer.register({kind:'exact', path:'/_dsh/dsh-noema/status', handler})`。
- 客户端挂载：`ctx.slots.inject('settings.section', () => ctx.slots.register({ id, order }, Panel))`——面板在 **Settings → Noema Memory**，不是右侧列。
- 客户端加载：build 脚本把 React bundle 包成 `window.__ModuleLoader__.load({ id, factory })`。
- 记忆布局：markdown 文件，`---json` frontmatter + body；hippocampus 审阅队列；词法 BM25 + PageIndex 检索。

## 我们的 Phase 2 路线（据此确定）

1. 宿主：新增 `dsh/host/memory-panel.mjs`，`inject: [webServer, workspaceRegistry]`，挂 `/memory-panel/*`（list/search/feedback/archive/capture-policy/audit），复用 `dsh/host/memory-admin.mjs` 的纯函数。
2. 客户端：新增 `dsh-client-ui-memory-panel` 包，走 `settings.section` 官方槽位（照 noema 的 `__ModuleLoader__` 包装），面板内做浏览/搜索/编辑/✅❌/归档/捕获策略/体检报告。
3. Obsidian 薄壳化：面板交给 dsh web；Obsidian 只留 /open、服务管理、捕获策略、归档。

## 客户端契约（已从 aionui 包逐行核实）

- 客户端入口导出 `inject`（数组）+ `apply(ctx)`；`apply` 里 `ctx.inject([...deps], (scope) => {...})`。
- 注册槽位：`scope.slots.inject('settings.section', () => scope.slots.register({ name, id, order, locale?, inject? }, ReactComponent))`；`register` 返回 `unregister`。
- 清理：`ctx.effect(() => disposer, name)`；i18n：`ctx.locale.register(NS, dictionaries)`。
- 打包：esbuild（external: react / react/jsx-runtime / @deepseek-ai/dsh-client-runtime/client）→ `window.__ModuleLoader__.load({ id, factory: (require) => { ...module.exports... } })`。
- 骨架已落在 `dsh/client-panel/`（package.json + src/index.jsx + build-client.mjs）；`npm run build:client` 已能编译出 `lib/client.js`（esbuild 已入 devDependencies），产物为 `window.__ModuleLoader__.load({id, factory})`，react 走 external。剩余：把 client 包装进 web profile 并在真实 web shell 联调（root 取当前会话 cwd、槽位挂载、按钮打宿主路由）。

## 客户端包的装配机制（已核实）

- web profile 的 `profiles/web/package.json` 通过 `dsh.profile.bundles` 声明宿主 bundle：`dsh-base` + `dsh-web-app` + `dsh-agent-teams` + `dsh-web-ui-all`。
- `dsh-web-ui-all` 把所有 `dsh-client-ui-*` 作为 `dependencies` 聚合；每个 client 包声明 `dsh.client.inject` + `exports["./client"]`（即 `lib/client.js`）。
- 客户端产物统一是 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`，React / client-runtime 走 external（shell 注入）。
- 安装我们的面板 = 把 `@dsh-math-memory/client-ui-memory-panel`（package.json + client.js）放进 `profiles/web/node_modules/`，并在 profile 依赖图里可解析；辅助脚本 `dsh/client-panel/install-into-profile.mjs --profile-home ... --add-dep` 已写好（非破坏，先备份）。
- 剩余唯一的「活体验证」：重启 dsh web 后看 Settings 页是否出现该 section——这一步必须由跑着的 web shell 来确认。

## 遗留

- aionui 与 dsh web ui 两个调研子代理本轮因余额/并发失败；但 noema 的结论 + 本仓库 control-panel.md §3 的实测已足够确定路线，后续可补。
- 关键源码：https://github.com/ZSeven-W/dsh-noema （src/index.ts、src/status-route.ts、src/settings.ts、src/client/index.tsx、scripts/build-client.mjs）
