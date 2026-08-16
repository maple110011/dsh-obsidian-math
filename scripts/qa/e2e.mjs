// scripts/qa/e2e.mjs — 检索 v3 真实会话端到端验收驱动器。
// 用法: node scripts/qa/e2e.mjs [--cases scripts/qa/cases.json] [--port 3191]
// 流程: 起临时 obsidian web 服务 → 逐题 session.create(cwd=vault, agentPreset=obsidian)
//       → session.prompt → 轮询 session.history → 断言工具轨迹与回答 → 汇总 PASS/FAIL。
// 依赖: 本机 node + dsh 安装（DSH_BIN 或默认路径）+ 已配置模型（真实 token 消耗）。
import { spawn } from "node:child_process";
import { readFileSync, openSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const CASES_PATH = opt("--cases", new URL("./cases.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PORT = Number(opt("--port", "3191"));
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = process.env.DSH_HOME || "E:/software/deepseek-harness/.dsh";
const VAULT = process.env.DSH_OBSIDIAN_VAULT || "D:/Obsidian笔记数据库";
const DSH_BIN = process.env.DSH_BIN || "E:/software/deepseek-harness/dsh/lib/bin.js";
const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
const tmpDir = mkdtempSync(join(tmpdir(), "dsh-qa-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...parts) => console.log(...parts);

async function waitForService(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("service exited early with code " + child.exitCode);
    try {
      const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* booting */ }
    await sleep(3000);
  }
  throw new Error("service did not come up within " + timeoutMs + "ms");
}

async function rpc(method, payload) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }),
    signal: AbortSignal.timeout(90000)
  });
  return res.json();
}

async function history(sessionId) {
  const h = await rpc("session.history", { sessionId, maxMessages: 200 });
  return h?.result?.ok ? (h.result.value.events ?? []) : [];
}

function estimateTokens(events) {
  let chars = 0;
  for (const entry of events) {
    const e = entry.event ?? entry;
    const textOf = (content) => {
      const blocks = Array.isArray(content) ? content : [content];
      return blocks.filter((b) => typeof b === "string" || (b && typeof b.text === "string"))
        .map((b) => (typeof b === "string" ? b : b.text)).join("");
    };
    if (e?.type === "tool/result") chars += textOf(e.data?.content ?? e.data?.result?.content ?? "").length;
    else if (e?.type === "assistant/message") chars += textOf(e.data?.message?.content ?? e.data?.content ?? "").length;
    else if (e?.type === "user/message") chars += textOf(e.data?.content ?? "").length;
  }
  return Math.round(chars * 0.9); // zh-heavy heuristic
}

async function runCase(index, testCase, serviceLog) {
  const expect = testCase.expect ?? {};
  const timeoutMs = expect.timeoutMs ?? 420000;
  const created = await rpc("session.create", { cwd: VAULT, agentPreset: "obsidian" });
  if (!created?.result?.ok) return { ok: false, note: "session.create failed: " + JSON.stringify(created).slice(0, 200), tokens: 0 };
  const sessionId = created.result.value.sessionId;
  await rpc("session.prompt", { sessionId, mode: "queue", content: [{ type: "text", text: testCase.question }] });

  const deadline = Date.now() + timeoutMs;
  const toolNames = new Set();
  const readTargets = new Set();
  let finalText = "";
  let sawTurnEnd = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    const entries = await history(sessionId);
    for (const entry of entries) {
      const e = entry.event ?? entry;
      if (e?.type === "tool/call") {
        toolNames.add(e.data?.name ?? "?");
        if (e.data?.name === "read" || e.data?.name === "note_recall" || e.data?.name === "grep" || e.data?.name === "glob") {
          try {
            const a = JSON.parse(e.data.arguments ?? "{}");
            readTargets.add(String(a.file_path ?? a.path ?? a.pattern ?? a.query ?? ""));
          } catch { /* ignore */ }
        }
      }
      if (e?.type === "assistant/message") {
        const content = e.data?.message?.content ?? e.data?.content ?? [];
        const txt = (Array.isArray(content) ? content : []).filter((b) => b?.type === "text").map((b) => b.text).join("");
        if (txt !== "") finalText = txt;
      }
      if (e?.type === "turn/end") sawTurnEnd = true;
    }
    if (sawTurnEnd && finalText !== "") break;
  }
  const tokens = estimateTokens(await history(sessionId));
  const failures = [];
  for (const tool of expect.mustUse ?? []) if (!toolNames.has(tool)) failures.push(`未使用工具 ${tool}`);
  for (const path of expect.mustRead ?? []) {
    const hit = [...readTargets].some((t) => t.includes(path));
    if (!hit) failures.push(`未读取 ${path}`);
  }
  for (const needle of expect.mustContain ?? []) if (!finalText.includes(needle)) failures.push(`回答未包含 ${needle}`);
  for (const needle of expect.mustNotContain ?? []) if (finalText.includes(needle)) failures.push(`回答不应包含 ${needle}`);
  if (expect.answerNotEmpty === true && finalText.trim() === "") failures.push("回答为空");
  if (!sawTurnEnd) failures.push("轮次未在超时内结束");
  if (failures.length === 0) {
    log(`[PASS] 案例${index + 1}（约 ${tokens.toLocaleString()} tokens）: ${testCase.question.slice(0, 46)}`);
  } else {
    log(`[FAIL] 案例${index + 1}: ${failures.join("；")}`);
    log("      tools:", [...toolNames].join(","), "| reads:", [...readTargets].slice(0, 4).join(","));
    log("      answer head:", finalText.replace(/\s+/g, " ").slice(0, 120));
    try { log("      service log tail:", readFileSync(serviceLog, "utf8").slice(-600).replace(/\n+/g, " ")); } catch { /* no log */ }
  }
  return { ok: failures.length === 0, tokens, sessionId };
}

const serviceLog = join(tmpDir, "service.log");
const logFd = openSync(serviceLog, "w");
const env = { ...process.env, DSH_HOME: HOME, DSH_OBSIDIAN_VAULT: VAULT, DSH_SESSIONS_ROOT: join(HOME, "sessions") };
const child = spawn(process.execPath, [DSH_BIN, "--profile", "obsidian", "--patch", join(HOME, "profiles", "obsidian", "obsidian.patch.yml"), "--port", String(PORT)], {
  cwd: VAULT, stdio: ["ignore", logFd, logFd], env, windowsHide: true
});

try {
  await waitForService(child, 120000);
  log(`服务就绪 ${BASE}（用例 ${cases.length} 个，将消耗真实模型 tokens）`);
  let pass = 0, totalTokens = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const result = await runCase(i, cases[i], serviceLog);
    if (result.ok) pass += 1;
    totalTokens += result.tokens ?? 0;
  }
  log(`\nE2E 结果: ${pass}/${cases.length} PASS，约 ${totalTokens.toLocaleString()} tokens 总消耗（字符估算）`);
  process.exitCode = pass === cases.length ? 0 : 1;
} catch (error) {
  log("[ERROR]", String(error));
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* already gone */ }
  await sleep(800);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
