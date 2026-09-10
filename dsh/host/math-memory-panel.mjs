// dsh/host/math-memory-panel.mjs — host-plane memory management panel routes.
// injects webServer and serves /memory-panel/* (loopback-only, workspace-gated)
// by reusing the pure functions in ./memory-admin.mjs. The browser client half
// (Phase 2b) will consume these routes from a dsh web settings-section panel.

import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { timingSafeEqual } from "node:crypto";
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

/** Hosts a same-origin browser request legitimately carries in `Origin`. */
const loopbackHost = (host) => /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(String(host));

/**
 * Reject a mutating request whose `Origin` is a foreign site.
 *
 * A browser always attaches `Origin` to POST (cross-site or not), so this is
 * the check that stops the attack loopback alone does not: any web page the
 * user visits can POST here with `content-type: text/plain` — a CORS "simple
 * request", so no preflight is issued and no readable response is needed for
 * the side effect to land. The 2026-09-10 audit confirmed that such a request
 * (no token, caller-chosen root) moved a user note into `.deepseek/archive/`.
 *
 * A missing `Origin` is allowed: non-browser clients (curl, a local script, the
 * plugin) do not send one, and they are already inside the trust boundary this
 * route can meaningfully defend — the root confinement below is what limits
 * them. `Origin: null` (sandboxed iframe / local file) is NOT allowed.
 */
const originAllowed = (req) => {
  const origin = req.headers?.origin;
  if (origin === undefined) return true;
  try {
    return loopbackHost(new URL(String(origin)).host);
  } catch {
    return false;
  }
};

/**
 * Optional shared secret, read from the environment the launching plugin
 * controls (`DSH_OBSIDIAN_FEEDBACK_TOKEN` — the same variable
 * `dsh/preset/math-memory.mjs` documents for the Obsidian-side endpoint).
 *
 * The plugin sets it for the notes profile it spawns, so that instance also
 * requires it on every request. The user's own `web` profile usually has it
 * unset, so there the Origin + root-confinement pair carries the request. When
 * it IS set, a missing/incorrect token is fatal — that is the stronger mode.
 */
function panelToken() {
  return (process.env.DSH_OBSIDIAN_FEEDBACK_TOKEN ?? "").trim();
}

/** Timing-safe comparison of the request token against the configured one. */
function tokenMatches(req, url, body) {
  const expected = panelToken();
  if (expected === "") return true; // not configured on this instance
  const header = req.headers?.["x-dsh-token"];
  const supplied = (typeof header === "string" && header !== "" ? header : (url.searchParams.get("t") ?? "")) ||
    (typeof body?.token === "string" ? body.token : "");
  const a = Buffer.from(String(supplied), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * The one root this server will act on: the vault the profile was started for.
 *
 * `body.root` / `?root=` used to BE the confinement root, which made the
 * downstream `pathInside(root, target)` check vacuous — the caller chose both
 * ends. Now the configured value wins; a request may only *restate* it (the
 * panel sends the workspace it displays) and a different path is rejected.
 *
 * @returns the resolved root, or "" when neither the environment nor the
 *   request supplies one.
 */
function resolveAllowedRoot(requested) {
  const configured = (process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT ?? "").trim();
  const asked = typeof requested === "string" ? requested.trim() : "";
  if (configured === "") return asked === "" ? "" : resolve(asked);
  const root = resolve(configured);
  if (asked === "") return root;
  return resolve(asked) === root ? root : "";
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw === "") return {};
  try { return JSON.parse(raw); } catch { return null; }
}

const CAPTURE_POLICY_FALLBACK = [
  "---",
  "idea: ask",
  "fact: ask",
  "preference: ask",
  "structure: auto",
  "updated: 2026-09-02",
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
  "sessionCapture: false",
  "---",
  "",
  "# 记忆系统设置",
  ""
].join("\n");

/**
 * The session-log store the capture routes scan.
 *
 * `DSH_SESSIONS_ROOT` must win over the `$DSH_HOME/sessions` default, because
 * that is exactly what `dsh/preset/math-memory.mjs` does
 * (`normalizeConfig`: `process.env.DSH_SESSIONS_ROOT ?? config.sessionsRoot`)
 * and what the Obsidian plugin sets when it spawns this service. Reading the
 * default unconditionally here made the two halves of the same feature disagree
 * about which store to scan: the preset would index one directory while the
 * panel's "N 个会话未保存" badge and its 「立即保存对话」 button read another.
 *
 * NOTE: the harness's own persistence plugin does NOT read this variable — the
 * session store root there is the `session-persistence-jsonl` `config.root`
 * (default `dshHomePath('sessions')`, see dsh-base/cordis.patch.yml). So today
 * this only steers the memory feature, not the session list. See
 * docs/session-scope.md.
 */
function sessionsRoot() {
  const override = (process.env.DSH_SESSIONS_ROOT ?? "").trim();
  if (override !== "") return resolve(override);
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

export function apply(ctx) {
  const handler = async (req, res) => {
    if (!loopbackOnly(req)) return json(res, fail("forbidden: loopback-only"), 403);
    if (!originAllowed(req)) return json(res, fail("forbidden: cross-origin"), 403);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const body = req.method === "POST" ? await readJson(req) : {};
    if (body === null) return json(res, fail("malformed json"), 400);
    if (!tokenMatches(req, url, body)) return json(res, fail("forbidden: bad or missing token"), 403);
    const requestedRoot = typeof body.root === "string" && body.root !== "" ? body.root : url.searchParams.get("root");
    const root = resolveAllowedRoot(requestedRoot);

    try {
      // Listed BEFORE the root gate: it serves the registry, not the vault, and
      // the client panel fetches it with no `root` — requiring one here answered
      // 400 and left the workspace dropdown permanently empty.
      if (req.method === "GET" && pathname === "/memory-panel/workspaces") {
        const workspaces = (ctx.workspaceRegistry?.list?.() ?? []).map((w) => ({
          id: w.id, path: w.path, title: w.title
        }));
        return json(res, ok({ workspaces }));
      }
      if (root === "") {
        return json(res, fail(requestedRoot === undefined || requestedRoot === null ? "missing root" : "root not allowed"), requestedRoot === undefined || requestedRoot === null ? 400 : 403);
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
        // archiveMemoryFile re-validates the source (memory tree, .md, regular
        // file) and throws otherwise; the throw surfaces as a 500 below.
        return json(res, ok({ archived: archiveMemoryFile(root, parts) }));
      }
      if (req.method === "POST" && pathname === "/memory-panel/capture-policy") {
        if (typeof body.field !== "string" || typeof body.mode !== "string") return json(res, fail("field/mode required"), 400);
        // `field` reaches setTopField's `new RegExp("^" + field + ":")`, so a
        // metacharacter or an embedded newline can rewrite unrelated lines.
        if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(body.field)) return json(res, fail("invalid field"), 400);
        if (!/^[a-z]{2,16}$/.test(body.mode)) return json(res, fail("invalid mode"), 400);
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
