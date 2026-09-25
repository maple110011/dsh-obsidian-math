// dsh/client-panel/install-into-profile.mjs — 把记忆面板的**客户端半个**装进一个 dsh web profile。
//
// 面板 = 宿主半（`host/math-memory-panel.mjs`：`/memory-panel/*` 路由）+ 客户端半
// （`lib/client.js`：Settings 面板 + **拖拽引用**）。本脚本装的是**包**：把宿主入口
// `dsh/host/index.mjs` 的**相对 import 传递闭包**按同样的目录深度铺进
// `profile/node_modules/@dsh-math-memory/client-ui-memory-panel/`（`host/`、`preset/`、
// `profile/`），然后**校验**那一行 loader 确实挂在权威 overlay 上（见 `OVERLAY_FILE`：
// 本脚本**不再自己写那一行**）。
//
// ⚠️ **为什么要铺整条闭包**（2026-09-26 实测）：上一版把 `host/index.mjs` 拷到包**根**，
// 再手挑四个兄弟文件 —— 其中三个缺失，包**根本 import 不起来**
// （`ERR_MODULE_NOT_FOUND …/@dsh-math-memory/preset/preset-deploy.mjs`）。那份手写清单是
// 0.1.7 给 `host/index.mjs` 加了 `../preset/preset-deploy.mjs` 之后没人更新的结果，所以现在
// 改成走闭包（`collectDshImportClosure`），并由 `scripts/check-client-package-layout.mjs`
// 真的 `import()` 一次产物来守。
//
// ⚠️ **两个 profile 都需要它**（2026-09-21 踩到）：`web` profile 走这条路是为了 3080 的记忆面板；
// 而 **Obsidian 侧栏跑的 `notes-assistant` profile 默认只有宿主半个** —— 于是"从文件树拖一篇笔记
// 进输入框"这个功能在**侧栏里根本不加载**（代码对、也测过，但没被装上）。现在 `dsh/install.mjs`
// 与 `scripts/deploy-local.mjs` 都会调用本模块导出的函数，把这一步固化进安装路径。
//
// ⚠️ **"装包"与"挂行"是两件事，必须分开做**：`web` profile 的行在它自己的 `cordis.patch.yml` 里
// （用户可编辑、不被覆盖），而 `notes-assistant` profile 的行必须写在**随 main.js 发布的**
// `notes-assistant.patch.yml` 源文件里 —— 因为插件每次启动服务都用内嵌副本重写那个文件。
// 具体原因见 `OVERLAY_FILE` 的注释，那里也是这个功能的真实故障记录。
//
// 用法（CLI）：node dsh/client-panel/install-into-profile.mjs --profile-home <dir>
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "..", "..");
export const CLIENT_PKG = "@dsh-math-memory/client-ui-memory-panel";
const PKG = CLIENT_PKG;

/**
 * The entry module of the package this installer builds, as a repo-relative
 * path. It must stay at the SAME depth as `dsh/host/index.mjs`, because that
 * module's own relative imports (`../preset/preset-deploy.mjs`,
 * `../profile/math-memory-workspace.mjs`, `./math-memory-panel.mjs`) are written
 * for the repo layout. The first version copied `host/index.mjs` to the package
 * ROOT and hand-picked four siblings — three of them missing, so the package
 * could not even be imported:
 *   ERR_MODULE_NOT_FOUND …/@dsh-math-memory/preset/preset-deploy.mjs
 * (measured 2026-09-26). Copying the whole closure under the same tree removes
 * the hand-written list that caused it.
 */
export const CLIENT_ENTRY_REL = "dsh/host/index.mjs";

/**
 * The relative-import closure of an ESM entry inside the repo's `dsh/` tree.
 * Walks `from './x'` and `import('./x')` specifiers — our modules always spell
 * the extension — and refuses to leave `dsh/`.
 *
 * @param {string} entryRel - repo-relative entry, e.g. {@link CLIENT_ENTRY_REL}.
 * @param {string} repoRoot - repo root (overridable so a gate can point at it).
 * @returns {string[]} sorted repo-relative paths, entry first.
 */
export function collectDshImportClosure(entryRel = CLIENT_ENTRY_REL, repoRoot = repo) {
  const specifier = /\bfrom\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]/g;
  const dshRoot = join(repoRoot, "dsh");
  const seen = new Set();
  const order = [];
  const queue = [entryRel];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    order.push(rel);
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) throw new Error(`closure: missing module ${rel}`);
    const text = readFileSync(abs, "utf8");
    for (const m of text.matchAll(specifier)) {
      const spec = m[1] ?? m[2];
      const target = resolve(dirname(abs), spec);
      const inside = relative(dshRoot, target);
      if (inside === "" || inside.startsWith("..") || inside.includes(`..${sep}`)) {
        throw new Error(`closure: ${rel} imports ${spec}, which leaves dsh/`);
      }
      queue.push(join("dsh", inside));
    }
  }
  return order;
}
/**
 * 这一行的 id **必须**与宿主半个的 id 不同，且必须在所有已应用的 patch 层里唯一。
 *
 * ⚠️ 2026-09-21 真实故障：这里原本也叫 `math-memory-panel`，而 `notes-assistant` profile 的
 * `notes-assistant.patch.yml` 里**已经**有一个同 id 的宿主半个（`./math-memory-panel.mjs`）。
 * 两个 patch 层各插一个同 id 条目 ⇒ cordis 直接拒绝启动整个 profile：
 *   `dsh: plugin tree failed to load: … duplicate loader entry id: math-memory-panel`
 * 后果是 Obsidian 侧栏**完全起不来**（用户看到「dsh 服务未能在端口 3180 上启动」）。
 * 现在安装前会**检查 id 冲突**：同 id 已被别的包占用时拒绝写入并报错，而不是写坏文件。
 */
const INSERT_ID = "math-memory-client-panel";
/** 导出给守卫用：`scripts/check-patch-yaml.mjs` 断言它不与任何已发布的行 id 冲突。 */
export const CLIENT_INSERT_ID = INSERT_ID;

/**
 * 那一行 loader 必须住在**哪个文件**里 —— 这是本模块 2026-09-21 第二个真实故障的结论。
 *
 * ⚠️ **不要把这个文件当成"安装时随便追加"的地方。** Obsidian 插件在**每次启动服务时**都用它内嵌
 * 的那份副本重写 `notes-assistant.patch.yml`（`obsidian/main.template.js` 的
 * `buildNotesAssistantPatch`）。也就是说：
 *
 *   · 安装时往 `notes-assistant.patch.yml` 追加的行 → **下一次启动就被覆盖掉**；
 *   · 往 `cordis.patch.yml` 追加的行 → 那个文件根本不参与本 profile 的启动
 *     （启动命令是 `dsh --profile notes-assistant --patch …/notes-assistant.patch.yml`），
 *     而且它同样会被内嵌模板覆盖。
 *
 * 本模块原先正是追加到 `cordis.patch.yml`，于是"装好了包、却没有任何 loader 挂载它"：拖拽能接住、
 * `/mention` 也回 204，但页面里既没有 `window.__dshMentionInsert`、也没有人订阅 `/mention-stream`，
 * 路径全部掉进队列。**唯一可行的形状是把行写进 repo 源文件**（`dsh/profile/notes-assistant.patch.yml`
 * → 由 build 内嵌进 `main.js` → 每次启动重写时自然带上），而本模块只负责**把包装进 node_modules**
 * 并**校验那一行确实在**。
 */
export const OVERLAY_FILE = "notes-assistant.patch.yml";

/** 扫一遍目录里的 `*.yml`，找出所有 `- id: <want>` 出现在哪、指向哪个包。 */
function findIdOwners(profileHome, want) {
  const owners = [];
  let names = [];
  try {
    names = readdirSync(profileHome).filter((n) => n.endsWith(".yml"));
  } catch { return owners; }
  for (const name of names) {
    let text = "";
    try { text = readFileSync(join(profileHome, name), "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!new RegExp(`^\\s*-\\s*id:\\s*['"]?${want}['"]?\\s*$`).test(lines[i])) continue;
      // 下一行（跳过空行/注释）通常是 `name: …`
      let owner = "";
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
        const m = /^\s*name:\s*['"]?([^'"\s]+)['"]?/.exec(lines[j]);
        if (m !== null) { owner = m[1]; break; }
      }
      owners.push({ file: name, line: i + 1, owner });
    }
  }
  return owners;
}

/**
 * 把客户端半个装进 `profileHome`（幂等）。
 *
 * @param profileHome - profile 目录（含 `cordis.patch.yml`）。
 * @param opts.quiet - true 时不打印进度（安装器里会自己记日志）。
 * @returns {{ ok: boolean, pkgDir: string, inserted: boolean, error?: string }}
 */
export function installClientIntoProfile(profileHome, opts = {}) {
  const log = opts.quiet === true ? () => {} : (m) => console.log(m);
  const home = resolve(profileHome);
  const pkgDir = join(home, "node_modules", ...PKG.split("/"));
  const result = { ok: false, pkgDir, inserted: false };

  const overlayPath = join(home, OVERLAY_FILE);
  const posturePath = join(home, "cordis.patch.yml");
  if (!existsSync(posturePath)) {
    result.error = `没有 cordis.patch.yml: ${posturePath}`;
    log(result.error);
    return result;
  }
  if (!existsSync(overlayPath)) {
    result.error = `没有 ${OVERLAY_FILE}: ${overlayPath}（它是唯一允许挂载本包 loader 行的文件）`;
    log(result.error);
    return result;
  }

  // ⚠️ 宿主半个**不能**在这里再挂一遍 `/memory-panel/*`。
  //
  // 2026-09-21 第二个真实故障：这个包原先把 `index.mjs` 直接设成 `host/math-memory-panel.mjs`
  // （**就是那个注册路由的模块**）。而 `notes-assistant` profile 里已经有一个独立的
  // `math-memory-panel.mjs`（`notes-assistant.patch.yml` 插的宿主半个）⇒ 两个条目都注册
  // `/memory-panel` 前缀 ⇒ dsh 硬失败：
  //   `duplicate prefix route "/memory-panel"`（连 `--patch` 那条路径一起起不来）。
  //
  // 正确的形状：**profile 里有独立宿主半个时，本包的宿主半必须是空实现** —— 它存在的唯一
  // 目的是让 patch 行有东西可挂，而客户端半个（`./client`）才是我们要交付的东西。
  // 没有独立宿主半个的 profile（如 `web`）才用仓库里那份真宿主（`host/index.mjs`：
  // 同步 preset + 挂面板路由 + 注册工作区）。
  const hasStandaloneHost = existsSync(join(home, "math-memory-panel.mjs"));
  try {
    mkdirSync(pkgDir, { recursive: true });
    // Mirror the entry's WHOLE relative-import closure under the same tree
    // (`host/…`, `preset/…`, `profile/…`) so `host/index.mjs` keeps working
    // verbatim — whatever relative import a later change adds. The previous
    // hand-picked list had three of four targets missing, so the package could
    // not be imported at all.
    for (const rel of collectDshImportClosure()) {
      const dest = join(pkgDir, relative(join(repo, "dsh"), join(repo, rel)));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(repo, rel), dest);
    }
    copyFileSync(join(root, "lib", "client.js"), join(pkgDir, "client.js"));
    // Older installs put the entry at the package ROOT; drop that copy so
    // nothing can load it (its relative imports pointed outside the package).
    rmSync(join(pkgDir, "index.mjs"), { force: true });
    if (hasStandaloneHost) {
      // The profile already mounts its OWN host half (`math-memory-panel.mjs`,
      // inserted by notes-assistant.patch.yml), so this package's host half must
      // be EMPTY: it exists only so the patch row has something to load, while
      // `./client` is what we ship. Two host halves would register the
      // /memory-panel prefix twice and dsh refuses to boot the whole profile
      // (`duplicate prefix route`) — 2026-09-21, see the file header.
      writeFileSync(join(pkgDir, "host", "index.mjs"), [
        "// 自动生成（dsh/client-panel/install-into-profile.mjs）——本 profile 已有独立的宿主半个",
        "// （`math-memory-panel.mjs`，由 notes-assistant.patch.yml 挂载），本包因此只提供",
        "// **客户端半个**（`./client`）。宿主侧留空，避免两个条目重复注册 /memory-panel 路由。",
        "export const name = 'math-memory-client-panel';",
        "export function apply() {}",
        ""
      ].join("\n"), "utf8");
    }
  } catch (error) {
    result.error = `拷贝失败: ${String(error)}`;
    log(result.error);
    return result;
  }

  const pkgJson = {
    name: PKG,
    version: "0.1.0",
    type: "module",
    // The entry lives at `host/index.mjs`, not the package root: that is the
    // depth its relative imports were written for (see CLIENT_ENTRY_REL).
    main: "host/index.mjs",
    exports: { ".": "./host/index.mjs", "./client": "./client.js", "./package.json": "./package.json" },
    dsh: {
      client: {
        // Package-name DEPENDENCY EDGES (load-order), not Cordis service
        // injection: dsh-client-modules uses them to decide whose factories must
        // arrive before this row materializes. The three names below are the
        // 0.1.7 cohort's providers the panel actually talks to (`slots` reaches
        // it through dsh-client-ui-settings), and all three exist in the
        // installed tree — asserted by scripts/check-client-package-layout.mjs.
        inject: ["@deepseek-ai/dsh-client-modules", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"],
        platform: "web"
      }
    },
    peerDependencies: { react: "^18.2.0" }
  };
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf8");
  log("installed package into: " + pkgDir);

  // ⚠️ 先查 id 冲突，**再**下结论。cordis 对重复 id 是硬失败（整个 profile 起不来），
  // 而"写进去之后才发现"意味着用户已经拿到一个坏 profile —— 2026-09-21 就是这样把用户的
  // 侧栏搞挂的。同 id 已被**别的包**占用时：明确报错。
  const owners = findIdOwners(home, INSERT_ID).filter((o) => !o.owner.includes(PKG));
  if (owners.length > 0) {
    result.error =
      `patch 里已存在 id "${INSERT_ID}"（${owners.map((o) => `${o.file}:${o.line} → ${o.owner || "(无 name)"}`).join("；")}）。` +
      `同 id 重复会让 cordis 拒绝启动整个 profile（duplicate loader entry id）。`;
    log(result.error);
    return result;
  }

  // 校验那一行**确实在权威来源里**。本模块不再写它（见 OVERLAY_FILE 的注释）：那行必须来自内嵌
  // overlay，否则下一次服务启动就会被重写掉 —— 而"包在、行不在"恰恰是拖拽静默失效的形状，
  // 所以这里必须正面对质，而不是像旧实现那样只要文件里出现过包名字符串就算通过。
  const rowRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${INSERT_ID}['"]?\\s*$`, "m");
  if (!rowRe.test(readFileSync(overlayPath, "utf8"))) {
    result.error =
      `${OVERLAY_FILE} 里没有 id "${INSERT_ID}" 的 loader 行：${overlayPath}。` +
      `该行必须来自仓库源 dsh/profile/${OVERLAY_FILE}（由 build 内嵌进 main.js）；` +
      `只装包不挂行 = 拖拽引用在页面里没有接收方。`;
    log(result.error);
    return result;
  }
  if (!existsSync(join(pkgDir, "client.js"))) {
    result.error = `包里没有 client.js：${join(pkgDir, "client.js")}`;
    log(result.error);
    return result;
  }

  result.inserted = false;
  result.ok = true;
  log(`overlay 已挂载 ${INSERT_ID}（${OVERLAY_FILE}）；包已就位：${pkgDir}`);

  const pp = join(home, "package.json");
  const bak = pp + ".bak";
  if (existsSync(bak)) {
    try {
      const cur = readFileSync(pp, "utf8");
      if (cur.includes(PKG)) {
        writeFileSync(pp, readFileSync(bak, "utf8"), "utf8");
        log("已从 profile package.json 移除 file: 依赖");
      }
    } catch { /* package.json 修不修都不影响加载 */ }
  }
  return result;
}

// CLI：只有直接运行本文件时才走这里（被 install.mjs import 时不应有副作用）。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--profile-home");
  const profileHome = i >= 0 && args[i + 1] ? resolve(args[i + 1]) : "";
  if (profileHome === "") { console.error("需要 --profile-home"); process.exit(2); }
  const res = installClientIntoProfile(profileHome);
  if (!res.ok) process.exit(1);
  console.log("\n下一步：重启 dsh web（3080 或侧栏那台），打开 Settings 看「记忆面板」section。");
}
