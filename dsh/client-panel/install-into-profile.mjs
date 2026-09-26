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
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "..", "..");
export const CLIENT_PKG = "@dsh-math-memory/client-ui-memory-panel";
/** Where the same tree is staged so the profile can declare a `file:` dependency on it. */
export const STAGING_DIR = ".dsh-client-panel";
/** The `file:` spec the profile's package.json must carry (see the declaration block below). */
export const DEP_SPEC = "file:.dsh-client-panel";
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
 * Copy a directory tree with an explicit walk.
 *
 * Deliberately NOT `fs.cpSync`: on this machine it failed with
 * `EIO, Access is denied` while creating the destination under the real
 * `$DSH_HOME` profile (the same call succeeds in %TEMP%, so it is an
 * environment/AV artifact rather than a permissions rule) — and the declaration
 * this copy exists for must not depend on that. mkdir + copyFile is boring and
 * works.
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}

/**
 * 把客户端半个装进 `profileHome`（幂等）。
 *
 * @param profileHome - profile 目录（含 `cordis.patch.yml`）。
 * @param opts.quiet - true 时不打印进度（安装器里会自己记日志）。
 * @returns {{ ok: boolean, pkgDir: string, inserted: boolean, declared?: boolean, error?: string }}
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
  // Which patch layer does THIS profile's boot actually read? (2026-09-26: the client half
  // must reach BOTH sides — the Obsidian sidebar and the main `dsh web` on 3080.)
  //   · The notes-assistant profile is booted by the plugin as
  //     `dsh --profile notes-assistant --patch <profile>/notes-assistant.patch.yml`, and that overlay is
  //     REWRITTEN from the plugin's embedded copy on every service start ⇒ the row must come from there
  //     (the authoritative-source rule, unchanged: writing it here would be erased on the next start).
  //   · Any other profile (e.g. `web`) has no such overlay: its ONLY patch layer is the profile's own
  //     `cordis.patch.yml`, which nothing of ours rewrites ⇒ the row can be INSERTED there and stays.
  // Before this, the installer hard-required the overlay, so the client half could never be installed
  // anywhere except the notes-assistant profile — which is exactly why 3080 had no memory panel.
  const usesOverlayLayer = existsSync(overlayPath);
  const rowLayerPath = usesOverlayLayer ? overlayPath : posturePath;
  if (!existsSync(rowLayerPath)) {
    result.error = `没有可用 patch 层：既无 ${OVERLAY_FILE} 也无 cordis.patch.yml（${home}）`;
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
  // 正确的形状：**profile 已经挂载了真宿主半个时，本包的宿主半必须是空实现** —— 它存在的唯一
  // 目的是让 patch 行有东西可挂，而客户端半个（`./client`）才是我们要交付的东西。
  //
  // 2026-09-26 补第二判据（"两侧通用"那次）：真宿主半个有两种来源 ——
  //   · profile 里那份独立文件 `math-memory-panel.mjs`（离线/direct 形态）；
  //   · **我们的包作为 bundle 装进了这个 profile**（native 形态：bundle 的行 `math-memory-host`
  //     → 包根 → `dsh/host/index.mjs`，它**就是**注册路由的那个模块）。
  // 只看第一种，会让 web profile 同时挂两个真宿主 ⇒ 重启即 `duplicate prefix route`。
  // 所以"独立文件存在 **或** `node_modules/dsh-math-memory` 存在"都算"已有真宿主"。
  const hasStandaloneHost = existsSync(join(home, "math-memory-panel.mjs"));
  const hasBundledHost = existsSync(join(home, "node_modules", "dsh-math-memory", "package.json"));
  const hasMountedHost = hasStandaloneHost || hasBundledHost;
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
    if (hasMountedHost) {
      // The profile already mounts a REAL host half — either its own
      // `math-memory-panel.mjs` (the offline/direct shape) or our package installed as a
      // bundle, whose `math-memory-host` row resolves to `dsh/host/index.mjs` and
      // registers `/memory-panel` itself (the native shape, e.g. `web`). Either way this
      // package's host half must be EMPTY: it exists only so the patch row has something
      // to load, while `./client` is what we ship. Two real host halves register the
      // /memory-panel prefix twice and dsh refuses to boot the whole profile
      // (`duplicate prefix route`) — 2026-09-21 standalone, 2026-09-26 bundle.
      writeFileSync(join(pkgDir, "host", "index.mjs"), [
        "// 自动生成（dsh/client-panel/install-into-profile.mjs）——本 profile 已经挂载了真宿主半个",
        hasStandaloneHost
          ? "// （`math-memory-panel.mjs`，由 notes-assistant.patch.yml 挂载）"
          : "// （我们的包以 bundle 装进本 profile：`math-memory-host` 行 → 包根 → dsh/host/index.mjs）",
        "// 本包因此只提供 **客户端半个**（`./client`）。宿主侧留空，避免两个条目重复注册",
        "// /memory-panel 路由（`duplicate prefix route` 会让整个 profile 起不来）。",
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

  // ⚠️ 只把包拷进 node_modules 是不够的：**必须同时在 profile 的 package.json 里声明它**。
  //
  // 2026-09-26 实机故障：那个 profile 里每一轮回复都失败，报
  //   `DeepSeek request extension preparation failed`（code REQUEST_EXTENSION）。
  // 真凶是 dsh 默认开启的请求扩展 `@deepseek-ai/dsh-plugin-package-inventory-deepseek`
  // （dsh-base 的 patch 里一行，无 config ⇒ 默认 enabled:true）：它的 prepare 会遍历
  // **所有活动行**，对**裸包名**查运行时解析图，查不到就抛
  // `cannot resolve active package "<name>"`。而 dsh 的解析图由上游
  // `dsh-app-boot` 的 `installedProfilePackageNames()` 给出，判据是
  //   profile 的 package.json 的 dependencies ∪ peerDependencies，**且**
  //   该名字在 profile 的 node_modules 里真有 package.json。
  // 我们此前只满足后者 ⇒ 面板的客户端行（`@dsh-math-memory/client-ui-memory-panel`）
  // 是"激活的、裸包名、不在图里"⇒ 每一次请求的准备阶段都抛。
  //
  // 声明成 `file:` 指向 profile 内的稳定目录（而不是 node_modules 里那份自己），
  // 是为了让 pnpm 也认这个依赖：`file:` 目标必须真实存在，所以下面把同一棵树再放一份。
  // 两份内容一致；node_modules 那份负责"立即可加载 + 满足图的存在性判据"，
  // `.dsh-client-panel` 那份只作为 pnpm 可解析的来源。
  const stagingDir = join(home, STAGING_DIR);
  try {
    copyTree(pkgDir, stagingDir);
  } catch (error) {
    result.error = `无法准备依赖声明用的目录 ${stagingDir}: ${String(error)}`;
    log(result.error);
    return result;
  }
  const profilePkgPath = join(home, "package.json");
  let profilePkg = {};
  try {
    profilePkg = JSON.parse(readFileSync(profilePkgPath, "utf8"));
  } catch {
    profilePkg = {};
  }
  if (profilePkg === null || typeof profilePkg !== "object") profilePkg = {};
  const dependencies = { ...(profilePkg.dependencies ?? {}) };
  if (dependencies[PKG] !== DEP_SPEC) {
    dependencies[PKG] = DEP_SPEC;
    writeFileSync(profilePkgPath, JSON.stringify({ ...profilePkg, dependencies }, null, 2) + "\n", "utf8");
    result.declared = true;
    log(`declared ${PKG} = "${DEP_SPEC}" in ${profilePkgPath}`);
  }

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

  // 校验那一行**确实在会被读到的那一层里**。
  // · overlay 层：本模块不写它（那份 overlay 每次起服务都会被插件从内嵌副本重写）——那行必须来自内嵌
  //   overlay，否则下一次服务启动就会被擦掉，而"包在、行不在"恰恰是拖拽静默失效的形状，所以正面对质。
  // · profile 自己的 cordis.patch.yml：没有任何人会重写它，所以可以安全**插入**（幂等）。
  const rowRe = new RegExp(`^\\s*-\\s*id:\\s*['"]?${INSERT_ID}['"]?\\s*$`, "m");
  let insertedRow = false;
  if (!rowRe.test(readFileSync(rowLayerPath, "utf8"))) {
    if (usesOverlayLayer) {
      result.error =
        `${OVERLAY_FILE} 里没有 id "${INSERT_ID}" 的 loader 行：${overlayPath}。` +
        `该行必须来自仓库源 dsh/profile/${OVERLAY_FILE}（由 build 内嵌进 main.js）；` +
        `只装包不挂行 = 拖拽引用在页面里没有接收方。`;
      log(result.error);
      return result;
    }
    const current = readFileSync(rowLayerPath, "utf8");
    const row = [
      "",
      `# ${PKG} —— 记忆面板的客户端半个（由安装器写入）。`,
      "# 这一层是 profile 自己的 patch 层，没有任何人会重写它，所以这行会留住；",
      "# 删掉本行即等于在面板里卸掉客户端半个。",
      "- insert:",
      `    - id: ${INSERT_ID}`,
      `      name: '${PKG}'`,
      ""
    ].join("\n");
    writeFileSync(rowLayerPath, current.replace(/\s*$/, "\n") + row, "utf8");
    insertedRow = true;
    log(`已在 ${rowLayerPath} 插入 ${INSERT_ID} 行`);
  }
  if (!existsSync(join(pkgDir, "client.js"))) {
    result.error = `包里没有 client.js：${join(pkgDir, "client.js")}`;
    log(result.error);
    return result;
  }

  result.inserted = insertedRow;
  result.ok = true;
  result.rowLayer = rowLayerPath;
  log(`已挂载 ${INSERT_ID}（${relative(home, rowLayerPath) || rowLayerPath}）；包已就位：${pkgDir}`);

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
