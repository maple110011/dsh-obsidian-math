// dsh/client-panel/build-client.mjs — 把 React 面板打成 dsh web 的 client.js。
// 产物形状与 @linxin666/dsh-client-ui-* 一致：
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
// 其中 react / react/jsx-runtime / @deepseek-ai/dsh-client-runtime/client 为外部依赖，
// 由宿主 ModuleLoader 注入。
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export const CLIENT_ID = "@dsh-math-memory/client-ui-memory-panel";
export const CLIENT_OUT = join(root, "lib", "client.js");

/**
 * Bundle the panel and return the exact text that must be committed to
 * `lib/client.js`.
 *
 * Exported rather than only written so `scripts/check-client-bundle.mjs` can
 * compare the committed artifact against a FRESH build. The alternative —
 * re-stating the esbuild options inside the guard — would be a second copy of
 * these settings, which is the drift this repo keeps having to fix elsewhere.
 * (The committed bundle had no guard at all before: `lib/client.js` could go
 * stale against `src/index.jsx` with nothing in `npm test` to notice.)
 */
export async function buildClient() {
  const result = await build({
    entryPoints: [join(root, "src", "index.jsx")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    external: ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-runtime/client"],
    write: false,
    jsx: "automatic",
    minify: true,
    logLevel: "info"
  });
  const body = result.outputFiles[0].text;
  return "window.__ModuleLoader__.load({\n" +
    "  id: " + JSON.stringify(CLIENT_ID) + ",\n" +
    "  factory: (require) => {\n" +
    "    var module = { exports: {} };\n" +
    "    var exports = module.exports;\n" +
    "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n" +
    body + "\n    return module.exports;\n  }\n});\n";
}

// CLI: `node dsh/client-panel/build-client.mjs` (or `npm run build:client`).
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const wrapped = await buildClient();
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(CLIENT_OUT, wrapped, "utf8");
  console.log("built lib/client.js (" + wrapped.length + " bytes)");
}
