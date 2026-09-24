// dsh/client-panel/install-into-profile.mjs — 把记忆面板的**客户端半个**装进一个 dsh web profile。
//
// 面板 = 宿主半（`host/math-memory-panel.mjs`：`/memory-panel/*` 路由）+ 客户端半
// （`lib/client.js`：Settings 面板 + **拖拽引用**）。本脚本装的是**包**：把两份文件放进
// `profile/node_modules/@dsh-math-memory/client-ui-memory-panel/`，并把包名 register 进
// `profile/cordis.patch.yml`。
//
// ⚠️ **两个 profile 都需要它**（2026-09-21 踩到）：`web` profile 走这条路是为了 3080 的记忆面板；
// 而 **Obsidian 侧栏跑的 `notes-assistant` profile 默认只有宿主半个** —— 于是"从文件树拖一篇笔记
// 进输入框"这个功能在**侧栏里根本不加载**（代码对、也测过，但没被装上）。现在 `dsh/install.mjs`
// 与 `scripts/deploy-local.mjs` 都会调用本模块导出的函数，把这一步固化进安装路径。
//
// 用法（CLI）：node dsh/client-panel/install-into-profile.mjs --profile-home <dir>
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "..", "..");
export const CLIENT_PKG = "@dsh-math-memory/client-ui-memory-panel";
const PKG = CLIENT_PKG;
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

  const patchPath = join(home, "cordis.patch.yml");
  if (!existsSync(patchPath)) {
    result.error = `没有 cordis.patch.yml: ${patchPath}`;
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
    if (hasStandaloneHost) {
      writeFileSync(join(pkgDir, "index.mjs"), [
        "// 自动生成（dsh/client-panel/install-into-profile.mjs）——本 profile 已有独立的宿主半个",
        "// （`math-memory-panel.mjs`，由 notes-assistant.patch.yml 挂载），本包因此只提供",
        "// **客户端半个**（`./client`）。宿主侧留空，避免两个条目重复注册 /memory-panel 路由。",
        "export const name = 'math-memory-client-panel';",
        "export function apply() {}",
        ""
      ].join("\n"), "utf8");
    } else {
      copyFileSync(join(repo, "dsh", "host", "index.mjs"), join(pkgDir, "index.mjs"));
      copyFileSync(join(repo, "dsh", "host", "preset-sync.mjs"), join(pkgDir, "preset-sync.mjs"));
    }
    copyFileSync(join(repo, "dsh", "host", "memory-admin.mjs"), join(pkgDir, "memory-admin.mjs"));
    copyFileSync(join(repo, "dsh", "preset", "hook-frontmatter.mjs"), join(pkgDir, "hook-frontmatter.mjs"));
    copyFileSync(join(root, "lib", "client.js"), join(pkgDir, "client.js"));
  } catch (error) {
    result.error = `拷贝失败: ${String(error)}`;
    log(result.error);
    return result;
  }

  const pkgJson = {
    name: PKG,
    version: "0.1.0",
    type: "module",
    main: "index.mjs",
    exports: { ".": "./index.mjs", "./client": "./client.js", "./package.json": "./package.json" },
    dsh: {
      client: {
        // Informational only: dsh >= 0.1.5 documents `dsh.client.inject` as
        // load/prefetch metadata, never apply sequencing — the real requirements
        // are the cordis service names the plugin injects at runtime
        // (`slots`, `locale`). The names below are the 0.1.5 cohort's providers;
        // the pre-0.1.5 `dsh-client-runtime` / `dsh-client-ui-slots` faces no
        // longer exist in an installed tree (docs/dsh-0.1.5-adaptation.md §3.5).
        inject: ["@deepseek-ai/dsh-client-modules", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"],
        platform: "web"
      }
    },
    peerDependencies: { react: "^18.2.0" }
  };
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf8");
  log("installed package into: " + pkgDir);

  const patch = readFileSync(patchPath, "utf8");

  // ⚠️ 先查 id 冲突，**再**动文件。cordis 对重复 id 是硬失败（整个 profile 起不来），
  // 而"写进去之后才发现"意味着用户已经拿到一个坏 profile —— 2026-09-21 就是这样把用户的
  // 侧栏搞挂的。同 id 已被**别的包**占用时：什么都不写，明确报错。
  const owners = findIdOwners(home, INSERT_ID).filter((o) => !o.owner.includes(PKG));
  if (owners.length > 0) {
    result.error =
      `patch 里已存在 id "${INSERT_ID}"（${owners.map((o) => `${o.file}:${o.line} → ${o.owner || "(无 name)"}`).join("；")}）。` +
      `再插一个同 id 条目会让 cordis 拒绝启动整个 profile（duplicate loader entry id）。已中止，未改动任何文件。`;
    log(result.error);
    return result;
  }

  if (patch.includes(PKG)) {
    log("cordis.patch.yml 已包含该包，跳过 insert");
    result.inserted = false;
    result.ok = true;
  } else {
    // The previous implementation anchored the insert to a trailing `]` (flow
    // style). Every patch file this repo actually ships is BLOCK style with no
    // trailing `]`, so `String.replace` returned the input unchanged — and the
    // script still wrote the file back and printed success. That silent no-op is
    // the only documented way the client panel reaches a profile. Appending a
    // block item to a genuine flow sequence instead produced invalid YAML.
    //
    // Now the block-style insert is APPENDED (block style accepts any number of
    // top-level items), and the write is asserted.
    const insert = ["", "# Math-memory client panel (install-into-profile.mjs).", "- insert:", "    - id: " + INSERT_ID, "      name: '" + PKG + "'"].join("\n");
    const next = patch.replace(/\s*$/, "") + insert + "\n";
    writeFileSync(patchPath + ".bak", patch, "utf8");
    writeFileSync(patchPath, next, "utf8");
    if (!readFileSync(patchPath, "utf8").includes(PKG)) {
      result.error = `insert 失败：写入后 ${patchPath} 仍不含 ${PKG}`;
      log(result.error);
      return result;
    }
    log("已 insert 到 " + patchPath + "（备份 cordis.patch.yml.bak）");
    result.inserted = true;
    result.ok = true;
  }

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
