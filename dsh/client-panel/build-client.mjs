// dsh/client-panel/build-client.mjs — 把 React 面板打成 dsh web 的 client.js。
// 产物形状与 @linxin666/dsh-client-ui-* 一致：
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
// 其中 react / react/jsx-runtime / @deepseek-ai/dsh-client-runtime/client 为外部依赖，
// 由宿主 ModuleLoader 注入。
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const id = "@dsh-math-memory/client-ui-memory-panel";

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
const wrapped = "window.__ModuleLoader__.load({\n" +
  "  id: " + JSON.stringify(id) + ",\n" +
  "  factory: (require) => {\n" +
  "    var module = { exports: {} };\n" +
  "    var exports = module.exports;\n" +
  "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n" +
  body + "\n    return module.exports;\n  }\n});\n";
mkdirSync(join(root, "lib"), { recursive: true });
writeFileSync(join(root, "lib", "client.js"), wrapped, "utf8");
console.log("built lib/client.js (" + wrapped.length + " bytes)");
