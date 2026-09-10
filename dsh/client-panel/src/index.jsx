// dsh/client-panel/src/index.jsx — 记忆管理面板（settings.section 槽位）。
//
// 呈现原则（与 Obsidian 侧记忆面板一致，见 docs/memory/control-panel.md）：
//   · 用户看到的是「我记住了什么 / 哪些可信 / 有什么要我处理」，不是内部字段。
//   · 不显示 vault 相对路径、不显示裸分数、不显示 hook/success_rate 这类字段名。
//   · 每一类动作都给出回执（旧版 run() 丢弃响应体，点了按钮什么也不发生——
//     这是「三选项令人不明所以」的直接原因之一）。

import { useEffect, useState } from "react";

const ROOT_KEY = "dsh-math-memory.panelRoot";

const VERIFIED_BADGES = { "user-confirmed": "✅", "cross-referenced": "⚖️", "single-source": "❓" };
const MEMO_STATUS_TEXT = { inbox: "待打磨", polishing: "打磨中", done: "已完成" };
const CAPTURE_MODE_TEXT = { auto: "自动写入", ask: "先询问", off: "不捕获" };
/** One gate per memory layer (see docs/memory/control-panel.md §2.4). */
const CAPTURE_FIELD_TEXT = { idea: "想法", fact: "事实", preference: "偏好", structure: "结构" };
const CAPTURE_FIELD_ORDER = ["idea", "fact", "preference", "structure"];
const EPISODE_PREVIEW = 8;

/**
 * Secondary-text colour. NOT `--dsw-alias-label-dimmed`: skins are free to
 * define only the `primary/secondary/tertiary/caption` family, and the skin in
 * use here (orca-link) does exactly that — the variable resolved to nothing, so
 * every meta line fell back to an inherited colour and became unreadable
 * (reported as 「浅色文字在当前皮肤下显示不清晰」). `secondary` is the one token
 * both the base theme and this skin define, so it is the safe default; the
 * chain keeps working on a skin that only ships `tertiary`.
 */
const MUTED = "var(--dsw-alias-label-secondary, var(--dsw-alias-label-tertiary, #8a8a8a))";

/** 「N 天前」from a YYYY-MM-DD string; '' when unparseable. */
function daysSinceText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (match === null) return "";
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const days = Math.floor((Date.now() - day.getTime()) / 86400000);
  return days > 0 ? `${days} 天前` : "今天";
}

const dim = { fontSize: "12px", color: MUTED };
const sectionHead = { margin: "14px 0 2px", fontSize: "13px" };

function useJson(url, body) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (url === "") return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(url, body ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        } : undefined);
        const json = await res.json();
        if (alive) setData(json);
      } catch (err) {
        if (alive) setError(String(err));
      }
    })();
    return () => { alive = false; };
  }, [url, body ? JSON.stringify(body) : ""]);
  return { data, error };
}

/** One card line. `badge` is always rendered — a card without a hook block is
 *  ❓ 单次来源, not "no badge" (the least-evidenced card must not look cleanest).
 *
 *  Every field is defaulted first: the client bundle and the host route are
 *  deployed separately, so during a deploy window the new panel can read a
 *  response from the previous host (no `layer`, no `topic`, …) and must render
 *  an empty string rather than the literal `#undefined`. */
function CardRow({ card, busy, onAction }) {
  const c = { rel: "", title: "", summary: "", type: "", operator: "", topic: "", status: "active", verified: null, uses: 0, harmed: 0, successRate: null, updated: "", ...card };
  const badge = VERIFIED_BADGES[c.verified] ?? "❓";
  const meta = [];
  if (c.type !== "") meta.push(c.type);
  if (c.operator !== "") meta.push(c.operator);
  if (c.topic !== "") meta.push(`#${c.topic}`);
  if (c.status !== "active") meta.push(c.status === "superseded" ? "已过期" : c.status);
  meta.push(badge);
  meta.push(c.uses > 0 ? `用过 ${c.uses} 次` : "从未用过");
  // Negative transfer: used AND it made things worse (only when it happened).
  if (c.harmed > 0) meta.push(`⚠️ 倒忙 ${c.harmed} 次`);
  if (Number.isFinite(c.successRate)) meta.push(`成功率 ${c.successRate}`);
  const fresh = daysSinceText(c.updated);
  if (fresh !== "") meta.push(fresh);
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--dsw-alias-border-l2)" }}>
      <div>
        <strong title={c.rel}>{badge} {c.title}</strong>
        <small style={{ marginLeft: "6px" }}>{c.layerLabel ?? ""}</small>
      </div>
      {c.summary !== "" ? (
        <div style={{ ...dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.summary}>{c.summary}</div>
      ) : null}
      <div style={dim}>{meta.join(" · ")}</div>
      <div style={{ marginTop: "2px", display: "flex", gap: "6px" }}>
        <button disabled={busy} title="这张卡内容正确：验证等级升为「用户确认」，检索时排得更靠前" onClick={() => onAction("confirm")}>✅ 确认</button>
        <button disabled={busy} title="这张卡的内容有错：降一级验证等级，下次体检重审；文件不会被删除" onClick={() => onAction("wrong")}>❌ 有错</button>
        <button disabled={busy} title="不再参与检索，文件仍然保留" onClick={() => onAction("stale")}>过期</button>
        <button disabled={busy} title="移出记忆库到 .deepseek/archive/（移动而非删除，可找回）" onClick={() => onAction("archive")}>归档</button>
      </div>
    </div>
  );
}

function MemoryPanel() {
  const [root, setRoot] = useState(() => (typeof localStorage === "undefined" ? "" : (localStorage.getItem(ROOT_KEY) ?? "")));
  const [workspaces, setWorkspaces] = useState([]);
  const [q, setQ] = useState("");
  const [tick, setTick] = useState(0);
  const [cap, setCap] = useState(null);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/memory-panel/workspaces");
        const json = await res.json();
        if (json && json.ok && Array.isArray(json.workspaces)) setWorkspaces(json.workspaces);
      } catch { /* no workspaces endpoint yet */ }
    })();
  }, []);

  const refreshCap = async () => {
    if (root === "") { setCap(null); return; }
    try {
      const res = await fetch("/memory-panel/session-capture?root=" + encodeURIComponent(root));
      const json = await res.json();
      if (json && json.ok) setCap(json);
    } catch { /* ignore */ }
  };
  useEffect(() => { refreshCap(); }, [root]);

  const toggleCapture = async (enabled) => {
    await fetch("/memory-panel/session-capture-toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root, enabled })
    });
    refreshCap();
  };
  const saveNow = async () => {
    setBusy(true);
    try {
      const res = await fetch("/memory-panel/session-capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root })
      });
      const json = await res.json();
      // Report the outcome: this button used to leave the UI unchanged, so a
      // no-op and a successful capture looked identical.
      setReceipt(json?.ok ? `已保存本轮对话（本轮新增 ${json.captured ?? 0} 个会话）` : `保存失败：${json?.error ?? "unknown"}`);
    } catch (err) {
      setReceipt(`保存失败：${String(err)}`);
    } finally {
      setBusy(false);
      refreshCap();
      setTick(tick + 1);
    }
  };

  // `t=` (the tick) is the refetch lever. The old code refetched by writing
  // `setQ(q === "" ? " " : "")` — i.e. by CORRUPTING the search box into a
  // single space after every save/feedback click.
  const url = root === "" ? "" : "/memory-panel/state?root=" + encodeURIComponent(root) + "&q=" + encodeURIComponent(q) + "&t=" + tick;
  const { data, error } = useJson(url, null);

  const saveRoot = (value) => {
    setRoot(value);
    try { if (value === "") localStorage.removeItem(ROOT_KEY); else localStorage.setItem(ROOT_KEY, value); } catch { /* ignore */ }
  };

  const run = async (rel, action) => {
    if (action === "archive" && !(typeof window !== "undefined" && window.confirm("归档只是把文件移到 .deepseek/archive/（可找回），不是删除。确定归档这张卡？"))) return;
    setBusy(true);
    try {
      const res = await fetch(action === "archive" ? "/memory-panel/archive" : "/memory-panel/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "archive" ? { root, rel } : { root, rel, action })
      });
      const json = await res.json();
      // The host already returns a plain-language receipt (`message`); showing it
      // is what turns "点了没反应" into a corrigible loop.
      if (json?.ok !== true) setReceipt(`失败：${json?.error ?? json?.message ?? "unknown"}`);
      else if (action === "archive") setReceipt("已归档：文件移到了 .deepseek/archive/（按层存放，可找回）。");
      else setReceipt(json.message ?? "已记录。");
    } catch (err) {
      setReceipt(`失败：${String(err)}`);
    } finally {
      setBusy(false);
      setTick(tick + 1);
    }
  };

  const policy = data?.ok === true ? (data.state.capturePolicy ?? {}) : {};
  const nextCaptureMode = (mode) => (mode === "ask" ? "auto" : mode === "auto" ? "off" : "ask");

  const toggleCapturePolicy = async (field) => {
    setBusy(true);
    try {
      const res = await fetch("/memory-panel/capture-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root, field, mode: nextCaptureMode(policy[field]) })
      });
      const json = await res.json();
      if (json?.ok !== true) setReceipt(`失败：${json?.error ?? "unknown"}`);
      else setReceipt(`捕获策略：${CAPTURE_FIELD_TEXT[field] ?? field} → ${CAPTURE_MODE_TEXT[nextCaptureMode(policy[field])]}`);
    } catch (err) {
      setReceipt(`失败：${String(err)}`);
    } finally {
      setBusy(false);
      setTick(tick + 1);
    }
  };

  const renderState = (s) => {
    const layers = s.layers ?? { records: { label: "记录", cards: s.records ?? [] }, templates: { label: "模板", cards: s.templates ?? [] } };
    const entries = Object.entries(layers);
    const cards = entries.flatMap(([, layer]) => layer.cards ?? []);
    const memos = s.memos ?? [];
    const episodes = s.episodes ?? [];
    const audit = s.audit ?? null;
    const sections = audit?.sections ?? {};
    const pending = sections.pendingReview ?? [];
    const candidates = sections.archiveCandidates ?? [];
    const decisions = audit?.decisions?.total ?? pending.length + candidates.length;
    const empty = cards.length === 0 && memos.length === 0 && episodes.length === 0;
    const layerLabel = (layer) => layer.label ?? "";
    const shown = expanded ? episodes : episodes.slice(0, EPISODE_PREVIEW);
    return (
      <div>
        <input value={q} placeholder="搜索记忆（标题 / 主题 / 类型 / 算子）" onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
        <div style={{ ...dim, marginTop: "4px" }}>
          ✅ 已确认 · ⚖️ 与他处互证 · ❓ 单次来源（鼠标悬停可看路径）
        </div>

        {empty && q === "" ? (
          <div style={{ ...dim, marginTop: "12px" }}>
            记忆库还是空的。与助手对话后，记忆会逐层写入：记录 / 主题 / 定理 / 模板 / 策略 / 备忘录 / 事件。
          </div>
        ) : cards.length === 0 && memos.length === 0 && episodes.length === 0 ? (
          <div style={{ ...dim, marginTop: "12px" }}>没有匹配的记忆。</div>
        ) : null}

        <div style={{ ...dim, marginTop: "8px" }}>
          {[
            s.profile === true ? "画像 ✅" : "",
            ...entries.map(([, layer]) => `${layerLabel(layer)} ${(layer.cards ?? []).length}`),
            `备忘录 ${memos.length}`,
            `事件 ${episodes.length}`,
            audit?.today ? `上次体检 ${audit.today}` : ""
          ].filter((part) => part !== "").join(" · ")}
        </div>
        <div style={{ ...dim, marginTop: "2px" }}>
          捕获策略：
          {CAPTURE_FIELD_ORDER.map((field, index) => (
            <span key={field}>
              {index > 0 ? " · " : ""}
              <a href="#" onClick={(e) => { e.preventDefault(); toggleCapturePolicy(field); }}>
                {CAPTURE_FIELD_TEXT[field]}={CAPTURE_MODE_TEXT[policy[field]] ?? "先询问"}
              </a>
            </span>
          ))}
          <span title="结构层＝为主题 / 定理索引 / 问题模板 / 策略卡补索引与结构；它不改写记录内容">（结构层=导航与索引写入）</span>
        </div>

        {decisions > 0 ? (
          <div style={{ margin: "10px 0", padding: "8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "4px" }}>
            <strong>⚠️ 需要你处理（{decisions}）</strong>
            {pending.map((item) => (
              <div key={`review-${item.rel}`} style={{ marginTop: "6px" }}>
                <div>✍️ 「{item.title}」被你标过 ❌，助手会在相关讨论时重审</div>
                <button disabled={busy} onClick={() => run(item.rel, "confirm")}>✅ 确认</button>
                <button disabled={busy} onClick={() => run(item.rel, "archive")}>归档</button>
              </div>
            ))}
            {candidates.map((item) => (
              <div key={`cleanup-${item.rel}`} style={{ marginTop: "6px" }}>
                <div title={item.utility === undefined ? "" : `效用评分 ${item.utility}`}>⚠️ 「{item.title}」长期没被用到，建议归档（移动而非删除）</div>
                <button disabled={busy} onClick={() => run(item.rel, "archive")}>归档</button>
              </div>
            ))}
          </div>
        ) : null}

        {entries.map(([key, layer]) => {
          const layerCards = layer.cards ?? [];
          if (layerCards.length === 0 && key !== "records") return null;
          return (
            <div key={key}>
              <h3 style={sectionHead} title={layer.dir ?? ""}>{layerLabel(layer)}（{layerCards.length}）</h3>
              {layerCards.length === 0
                ? <div style={dim}>（暂无）</div>
                : layerCards.map((card) => (
                  <CardRow key={card.rel} card={{ ...card, layerLabel: layerLabel(layer) }} busy={busy} onAction={(a) => run(card.rel, a)} />
                ))}
            </div>
          );
        })}

        <h3 style={sectionHead}>备忘录（{memos.length}）</h3>
        {memos.length === 0 ? <div style={dim}>（暂无）</div> : memos.map((memo) => {
          const m = { rel: "", title: "", topic: "", status: "", updated: "", ...memo };
          return (
            <div key={m.rel} style={{ padding: "4px 0" }} title={m.rel}>
              {m.title}
              <small style={{ marginLeft: "6px" }}>
                {[m.topic, MEMO_STATUS_TEXT[m.status] ?? m.status, daysSinceText(m.updated)].filter((part) => part !== "" && part !== undefined).join(" · ")}
              </small>
            </div>
          );
        })}

        <h3 style={sectionHead}>事件时间线（{episodes.length}）</h3>
        {episodes.length === 0 ? <div style={dim}>（暂无）</div> : (
          <>
            {shown.map((episode) => {
              const e = { rel: "", name: "", title: "", topic: "", date: "", ...episode };
              return (
                <div key={e.rel} style={{ padding: "2px 0" }} title={e.rel}>
                  {e.date !== "" ? <span style={dim}>{e.date}</span> : null}
                  {" "}{e.title !== "" ? e.title : e.name}
                  {e.topic !== "" ? <small style={{ marginLeft: "6px" }}>{e.topic}</small> : null}
                </div>
              );
            })}
            {episodes.length > EPISODE_PREVIEW ? (
              <button onClick={() => setExpanded(!expanded)}>
                {expanded ? "收起" : `展开全部（${episodes.length}）`}
              </button>
            ) : null}
          </>
        )}

        <h3 style={sectionHead}>记忆体检</h3>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", margin: 0 }}>{s.auditHuman || "（还没有体检记录：与助手对话后会自动生成。）"}</pre>
        {s.auditText ? (
          <details style={{ marginTop: "4px" }}>
            <summary style={dim}>查看模型版清单</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "11px" }}>{s.auditText}</pre>
          </details>
        ) : null}
      </div>
    );
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <label>笔记 vault</label>
      {workspaces.length > 0 ? (
        <select value={root} onChange={(e) => saveRoot(e.target.value)} style={{ width: "100%", marginBottom: "4px" }}>
          <option value="">（选择工作区）</option>
          {workspaces.map((w) => <option key={w.id} value={w.path}>{w.title}</option>)}
        </select>
      ) : (
        // Only when the registry has no workspace at all do we fall back to
        // typing a path. Having BOTH a <select> and a path <input> on screen at
        // once was reported as confusing — the select is the intended control.
        <input value={root} placeholder="输入笔记 vault 路径（未检测到任何工作区）" onChange={(e) => saveRoot(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
      )}
      {workspaces.length > 0 && root !== "" ? (
        <div style={{ ...dim, margin: "0 0 8px" }} title={root}>当前 vault：{workspaces.find((w) => w.path === root)?.title ?? root}</div>
      ) : null}
      {root !== "" ? (
        <div style={{ margin: "4px 0 12px", padding: "8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "4px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input type="checkbox" checked={cap?.enabled === true} onChange={(e) => toggleCapture(e.target.checked)} />
            自动保存对话
          </label>
          <div style={{ ...dim, margin: "4px 0" }}>
            未保存：{cap?.count ?? "…"} 个会话
          </div>
          <button disabled={busy} onClick={saveNow}>立即保存对话</button>
        </div>
      ) : null}
      {receipt !== "" ? (
        <div style={{ ...dim, margin: "4px 0" }} role="status">{receipt}</div>
      ) : null}
      {root === "" ? (
        <div>请选择笔记 vault（面板会记住你的选择）。</div>
      ) : error !== "" ? (
        <div>加载失败：{error}</div>
      ) : data === null ? (
        <div>加载中…</div>
      ) : data.ok !== true ? (
        <div>错误：{data.error ?? "unknown"}</div>
      ) : (
        renderState(data.state ?? {})
      )}
    </div>
  );
}

export const inject = ["slots"];
export function apply(ctx) {
  ctx.inject(["slots", "locale"], (scope) => {
    try { scope.locale?.register?.("math-memory-panel", { title: "记忆面板" }); } catch { /* cosmetic */ }
    scope.slots.inject("settings.section", () => scope.slots.register({
      name: "settings.section",
      id: "math-memory-panel",
      order: 80,
      label: "记忆面板"
    }, MemoryPanel));
  });
}
