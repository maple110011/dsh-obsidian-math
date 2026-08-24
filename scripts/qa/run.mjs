// scripts/qa/run.mjs — QA 统一入口。
//   node scripts/qa/run.mjs          # 仿真 vault 探针（零 token）+ 真实 vault 探针（若设置）
//   node scripts/qa/run.mjs --e2e    # + 真实会话端到端（烧真实 tokens）
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const withE2e = process.argv.includes("--e2e");

const run = (label, file) => {
  const r = spawnSync(process.execPath, [join(root, "scripts", "qa", file)], { cwd: root, stdio: "inherit" });
  const verdict = r.status === 0 ? "PASS" : r.status === 2 ? "SKIP" : "FAIL";
  console.log(`${label}: ${verdict}`);
  return r.status;
};

console.log("== 1/3 仿真 vault 探针（零 token，基准套 A）==");
const seed = run("seed-probe", "seed-probe.mjs");

console.log("\n== 2/3 真实 vault 探针（零 token，需设置 DSH_WORKSPACE_ROOT / DSH_OBSIDIAN_VAULT）==");
const engine = run("engine-probe", "engine-probe.mjs");

const ok = seed === 0 && (engine === 0 || engine === 2);
if (!withE2e) {
  console.log("\n（跳过 E2E；加 --e2e 运行真实会话验收，会消耗模型 tokens）");
  process.exit(ok ? 0 : 1);
}

console.log("\n== 3/3 真实会话端到端（消耗模型 tokens）==");
const e2e = run("E2E", "e2e.mjs");
process.exit(ok && e2e === 0 ? 0 : 1);
