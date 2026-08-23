// dsh/client-panel/src/index.jsx — 记忆管理面板（settings.section 槽位）。

import { useEffect, useState } from "react";

const ROOT_KEY = "dsh-math-memory.panelRoot";

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

function CardRow({ rel, title, verified, uses, successRate, onAction }) {
  const badge = { "user-confirmed": "✅", "cross-referenced": "⚖️", "single-source": "❓" }[verified] ?? "";
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--dsw-alias-border-l2)" }}>
      <div><strong>{badge} {title}</strong> <small>({rel})</small></div>
      <div style={{ fontSize: "12px", color: "var(--dsw-alias-label-dimmed)" }}>
        uses={uses} success={successRate ?? "—"}
      </div>
      <button onClick={() => onAction("confirm")}>✅ 对</button>
      <button onClick={() => onAction("wrong")}>❌ 错</button>
      <button onClick={() => onAction("archive")}>归档</button>
    </div>
  );
}

function MemoryPanel() {
  const [root, setRoot] = useState(() => (typeof localStorage === "undefined" ? "" : (localStorage.getItem(ROOT_KEY) ?? "")));
  const [workspaces, setWorkspaces] = useState([]);
  const [q, setQ] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/memory-panel/workspaces");
        const json = await res.json();
        if (json && json.ok && Array.isArray(json.workspaces)) setWorkspaces(json.workspaces);
      } catch { /* no workspaces endpoint yet */ }
    })();
  }, []);

  const url = root === "" ? "" : "/memory-panel/state?root=" + encodeURIComponent(root) + "&q=" + encodeURIComponent(q);
  const { data, error } = useJson(url, null);

  const saveRoot = (value) => {
    setRoot(value);
    try { if (value === "") localStorage.removeItem(ROOT_KEY); else localStorage.setItem(ROOT_KEY, value); } catch { /* ignore */ }
  };

  const run = async (rel, action) => {
    const body = action === "archive" ? { root, rel } : { root, rel, action };
    await fetch(action === "archive" ? "/memory-panel/archive" : "/memory-panel/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setTick(tick + 1);
    setQ(q === "" ? " " : "");
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <label>笔记 vault</label>
      {workspaces.length > 0 ? (
        <select value={root} onChange={(e) => saveRoot(e.target.value)} style={{ width: "100%", marginBottom: "4px" }}>
          <option value="">（选择工作区）</option>
          {workspaces.map((w) => <option key={w.id} value={w.path}>{w.title} — {w.path}</option>)}
        </select>
      ) : null}
      <input value={root} placeholder="或手动输入 vault 路径，例如 D:/Obsidian笔记数据库" onChange={(e) => saveRoot(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
      {root === "" ? (
        <div>请选择或输入笔记 vault 路径，面板会记住它。</div>
      ) : error !== "" ? (
        <div>加载失败：{error}</div>
      ) : data === null ? (
        <div>加载中…</div>
      ) : data.ok !== true ? (
        <div>错误：{data.error ?? "unknown"}</div>
      ) : (
        (() => {
          const s = data.state;
          return (
            <div>
              <input value={q} placeholder="搜索（标题/算子/类型/主题）" onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
              <h3>记录层（{s.records.length}）</h3>
              {s.records.map((c) => <CardRow key={c.rel} rel={c.rel} title={c.title} verified={c.verified} uses={c.uses} successRate={c.successRate} onAction={(a) => run(c.rel, a)} />)}
              <h3>模板（{s.templates.length}）</h3>
              {s.templates.map((c) => <CardRow key={c.rel} rel={c.rel} title={c.title} verified={c.verified} uses={c.uses} successRate={c.successRate} onAction={(a) => run(c.rel, a)} />)}
              <h3>备忘录（{s.memos.length}）</h3>
              {s.memos.map((m) => <div key={m.rel} style={{ padding: "4px 0" }}>{m.title} <small>({m.status})</small></div>)}
              <h3>体检报告</h3>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>{s.auditText || "（暂无）"}</pre>
            </div>
          );
        })()
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
