// dsh/host/math-memory-panel.mjs — host-plane memory management panel routes.
// injects webServer and serves /memory-panel/* (loopback-only, workspace-gated)
// by reusing the pure functions in ./memory-admin.mjs. The browser client half
// (Phase 2b) will consume these routes from a dsh web settings-section panel.

import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { pathInside, collectMemoryState, applyFeedback, archiveMemoryFile, setCapturePolicyMode, archiveOldEpisodes, runSessionCapture, countUncapturedSessions, readCaptureState, setSessionCapture, readSessionCaptureEnabled } from "./memory-admin.mjs";
import { parseHookFrontmatter } from "./hook-frontmatter.mjs";

export const name = "math-memory-panel";
export const inject = ["webServer", "workspaceRegistry"];

const json = (res, envelope, status = 200) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(envelope));
};
const ok = (value) => ({ ok: true, ...(value ?? {}) });
const fail = (error) => ({ ok: false, error });

const loopbackOnly = (req) => {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
};

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw === "") return {};
  try { return JSON.parse(raw); } catch { return null; }
}

const CAPTURE_POLICY_FALLBACK = [
  "---",
  "idea: ask",
  "fact: auto",
  "preference: auto",
  "updated: 2026-01-01",
  "---",
  "",
  "# 捕获策略",
  ""
].join("\n");

const CONFIG_FALLBACK = [
  "---",
  "enabled: true",
  "dialogueIndex: true",
  "reminders: true",
  "audit: true",
  "autoArchive: false",
  "sessionCapture: true",
  "---",
  "",
  "# 记忆系统设置",
  ""
].join("\n");

function sessionsRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

export function apply(ctx) {
  const handler = async (req, res) => {
    if (!loopbackOnly(req)) return json(res, fail("forbidden: loopback-only"), 403);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const body = req.method === "POST" ? await readJson(req) : {};
    if (body === null) return json(res, fail("malformed json"), 400);
    const rootRaw = typeof body.root === "string" && body.root !== "" ? body.root : url.searchParams.get("root");
    if (typeof rootRaw !== "string" || rootRaw === "") return json(res, fail("missing root"), 400);
    const root = resolve(rootRaw);

    try {
      if (req.method === "GET" && pathname === "/memory-panel/workspaces") {
        const workspaces = (ctx.workspaceRegistry?.list?.() ?? []).map((w) => ({
          id: w.id, path: w.path, title: w.title
        }));
        return json(res, ok({ workspaces }));
      }
      if (req.method === "GET" && pathname === "/memory-panel/state") {
        const state = collectMemoryState(root, url.searchParams.get("q") ?? "", parseHookFrontmatter);
        return json(res, ok({ state }));
      }
      if (req.method === "POST" && pathname === "/memory-panel/feedback") {
        if (typeof body.rel !== "string" || typeof body.action !== "string") return json(res, fail("rel/action required"), 400);
        const target = join(root, body.rel);
        if (!pathInside(root, target)) return json(res, fail("outside root"), 403);
        return json(res, ok(applyFeedback(target, body.action)));
      }
      if (req.method === "POST" && pathname === "/memory-panel/archive") {
        if (typeof body.rel !== "string") return json(res, fail("rel required"), 400);
        const parts = body.rel.split("/").filter(Boolean);
        const target = join(root, ...parts);
        if (!pathInside(root, target)) return json(res, fail("outside root"), 403);
        return json(res, ok({ archived: archiveMemoryFile(root, parts) }));
      }
      if (req.method === "POST" && pathname === "/memory-panel/capture-policy") {
        if (typeof body.field !== "string" || typeof body.mode !== "string") return json(res, fail("field/mode required"), 400);
        setCapturePolicyMode(root, body.field, body.mode, CAPTURE_POLICY_FALLBACK);
        return json(res, ok({}));
      }
      if (req.method === "POST" && pathname === "/memory-panel/archive-episodes") {
        return json(res, ok(archiveOldEpisodes(root, Number.isFinite(body.maxDays) ? body.maxDays : 90)));
      }
      if (req.method === "GET" && pathname === "/memory-panel/session-capture") {
        const count = countUncapturedSessions(root, sessionsRoot());
        const state = readCaptureState(root);
        return json(res, ok({ count, captured: Object.keys(state.sessions ?? {}).length, enabled: readSessionCaptureEnabled(root) }));
      }
      if (req.method === "POST" && pathname === "/memory-panel/session-capture") {
        return json(res, ok(runSessionCapture(root, sessionsRoot(), readCaptureState(root))));
      }
      if (req.method === "POST" && pathname === "/memory-panel/session-capture-toggle") {
        if (typeof body.enabled !== "boolean") return json(res, fail("enabled required"), 400);
        setSessionCapture(root, body.enabled, CONFIG_FALLBACK);
        return json(res, ok({ enabled: body.enabled }));
      }
      return json(res, fail("not found"), 404);
    } catch (error) {
      ctx.logger?.warn?.("math-memory-panel: " + String(error));
      return json(res, fail(String(error)), 500);
    }
  };

  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/memory-panel", handler }), "math-memory-panel: /memory-panel routes");
}
