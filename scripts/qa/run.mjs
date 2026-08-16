// scripts/qa/run.mjs — 检索 v3 QA 统一入口。
//   node scripts/qa/run.mjs          # 仅引擎探针（零 token）
//   node scripts/qa/run.mjs --e2e    # 引擎探针 + 真实会话端到端（烧真实 tokens）
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const withE2e = process.argv.includes("--e2e");

console.log("== 1/2 引擎探针（零 token，ground-truth 召回断言）==");
const engine = spawnSync(process.execPath, [join(root, "scripts", "qa", "engine-probe.mjs")], { cwd: root, stdio: "inherit" });
console.log("引擎探针:", engine.status === 0 ? "PASS" : "FAIL");

if (!withE2e) {
  console.log("\n（跳过 E2E；加 --e2e 运行真实会话验收，会消耗模型 tokens）");
  process.exit(engine.status === 0 ? 0 : 1);
}

console.log("\n== 2/2 真实会话端到端（消耗模型 tokens）==");
const e2e = spawnSync(process.execPath, [join(root, "scripts", "qa", "e2e.mjs")], { cwd: root, stdio: "inherit" });
console.log("E2E:", e2e.status === 0 ? "PASS" : "FAIL");
process.exit(engine.status === 0 && e2e.status === 0 ? 0 : 1);
