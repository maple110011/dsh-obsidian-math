// dsh/client-panel/install-into-profile.mjs — 把记忆面板装进一个 dsh web profile。
// 面板 = 宿主半（index.mjs：/memory-panel/* 路由）+ 客户端半（client.js：Settings 面板）。
// 机制：把包放进 profile/node_modules，并把包名 insert 进 profile/cordis.patch.yml。
// 用法: node dsh/client-panel/install-into-profile.mjs --profile-home <dir>

import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "..", "..");
const PKG = "@dsh-math-memory/client-ui-memory-panel";
const INSERT_ID = "math-memory-panel";

const args = process.argv.slice(2);
const i = args.indexOf("--profile-home");
const profileHome = i >= 0 && args[i + 1] ? resolve(args[i + 1]) : "";
if (profileHome === "") { console.error("需要 --profile-home"); process.exit(2); }

const pkgDir = join(profileHome, "node_modules", ...PKG.split("/"));
mkdirSync(pkgDir, { recursive: true });

copyFileSync(join(repo, "dsh", "host", "math-memory-panel.mjs"), join(pkgDir, "index.mjs"));
copyFileSync(join(repo, "dsh", "host", "memory-admin.mjs"), join(pkgDir, "memory-admin.mjs"));
copyFileSync(join(repo, "dsh", "preset", "hook-frontmatter.mjs"), join(pkgDir, "hook-frontmatter.mjs"));
copyFileSync(join(root, "lib", "client.js"), join(pkgDir, "client.js"));

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
      // are the cordis service names the panel injects at runtime
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
console.log("installed package into:", pkgDir);

const patchPath = join(profileHome, "cordis.patch.yml");
if (!existsSync(patchPath)) { console.error("没有 cordis.patch.yml:", patchPath); process.exit(2); }
let patch = readFileSync(patchPath, "utf8");
if (patch.includes(PKG)) {
  console.log("cordis.patch.yml 已包含该包，跳过 insert");
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
  const insert = [
    "",
    "# Math-memory client panel (install-into-profile.mjs).",
    "- insert:",
    "    - id: " + INSERT_ID,
    "      name: '" + PKG + "'"
  ].join("\n");
  const next = patch.replace(/\s*$/, "") + insert + "\n";
  writeFileSync(patchPath + ".bak", patch, "utf8");
  writeFileSync(patchPath, next, "utf8");
  if (!readFileSync(patchPath, "utf8").includes(PKG)) {
    console.error("insert 失败：写入后", patchPath, "仍不含", PKG);
    process.exit(1);
  }
  console.log("已 insert 到", patchPath, "（备份 cordis.patch.yml.bak）");
}

const pp = join(profileHome, "package.json");
const bak = pp + ".bak";
if (existsSync(bak)) {
  const cur = readFileSync(pp, "utf8");
  if (cur.includes(PKG)) {
    writeFileSync(pp, readFileSync(bak, "utf8"), "utf8");
    console.log("已从 profile package.json 移除 file: 依赖");
  }
}

console.log("\n下一步：重启 dsh web（3080），打开 Settings 看「记忆面板」section。");
