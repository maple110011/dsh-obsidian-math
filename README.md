# DSH Math Notes Assistant (dsh-math-memory)

[English](README.md) · [简体中文](README.zh.md)

> A long-term math-memory agent for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that lives inside [Obsidian](https://obsidian.md) as a right-sidebar chat panel.

A **two-component** repository:

1. **Obsidian community plugin** (id `dsh-math-assistant`, repo-root `manifest.json` + `main.js`): embeds the dsh web UI in the right sidebar, detects and starts the dsh service, bootstraps the dsh-side configuration and vault templates on first run, and hosts the memory panel, capture-policy settings, and deterministic maintenance.
2. **dsh plugin** (npm package `dsh-math-memory`, `dsh/`): installs the same `notes-assistant` agent preset / profile and vault templates into `$DSH_HOME`.

Both write identical, idempotent configuration. **Installing the Obsidian plugin alone is enough**; `dsh/install.mjs` covers the pure-CLI workflow.

## Why

Mathematics learning is long-horizon accumulation: notation habits, theoretical preferences, half-finished proofs, techniques, counterexamples, and ideas all need continuous collection and polishing into a connected system. Generic chat AI treats every conversation as isolated Q&A. This plugin gives the agent **cross-session layered memory** (five layers + a notation ledger + memo lifecycle), **unified retrieval** (notes + memory in one search), and a **standing protocol** (AGENTS.md) so each new session starts where the last one ended.

## Features

### Retrieval (v3: unified entry, coarse-filter + careful-read)
- **`note_recall` unified search**: one BM25-ranked pass over user notes AND all memory layers (hook-weighted cards, memos, topics, theorem/episode indexes); unicode-dash normalization and CJK char containment bridge word-form gaps; hits carry a **coverage** indicator (query-token coverage; <0.35 marks a lexical-coincidence weak signal).
- **Read-verify protocol**: distilled query (challenge + candidate techniques) → read the top 2-3 hits in full and judge each → on empty/weak results reformulate once → then admit "not in the vault" instead of fabricating; bounded at 2 recalls and 3 full reads per turn.
- **Navigation-only injection**: the system prompt carries only the navigation layers (profile/notation/topics/records/templates/episodes); content is pulled on demand; the injected section has a hard total cap (≤18000 chars; per-layer budgets in [docs/memory/design.md](docs/memory/design.md) §3).
- Supporting tools: `note_search` (user-note tag filter), `note_links` (backlinks / link-following), `note_create` (refuses to overwrite).

### Memory (five layers + maintenance loop)
- **Five layers**: profile (semantic) / topics (navigation) / records (typed atomic cards with retrieval `hook:` blocks and verification levels ✅⚖️❓) / episodes (raw evidence, append-only) / inbox (idea memos, inbox→polishing→done).
- **Notation system**: `memory/notation.md` with adopted/candidates/rejected tables and a revision history — collect → unify → maintain; the agent proposes unifications when your notation drifts (observes first when you have no stable habit yet).
- **Daily audit**: deterministic scan for strong/weak/unused/duplicate-candidate/unverified cards plus **structural checks** (missing source / broken links / missing index rows); recall hits sync back into `uses/success_rate`.
- **Memo reminders**: stale (inbox>7d, polishing>3d) or currently-relevant memos surface for polishing, ranked by relevance × recency.
- **Capture policy tiers**: `idea/fact/preference × auto/ask/off` — pick them in the plugin settings (dropdowns write back to `capture-policy.md`), or edit via the memory panel / the file directly; auto-tier writes are announced in the closing line, ask-tier proposals state what/why/where.
- **Cross-session context**: past dsh sessions (zstd JSONL) distilled into bounded Q&A cues, vault-filtered and excluding the live session.

### Control surface (Obsidian side)
- **Memory panel**: browse all five layers, search, hook stats with 📈 usage trends, per-card ✅/❌/supersede/archive, audit report; **edit-and-save in the panel** (mtime conflict guard); capture policy editable on the settings page with effect descriptions.
- **Feedback loop**: `[✅ 这条对] [❌ 这条错]` links in replies deterministically rewrite cards through the loopback `/feedback` endpoint (CSRF-token protected); note references are clickable and jump into Obsidian (`/open`).
- **Reply-quality protocol**: intuition before formalism, anchoring new material to your existing notes, difficulty adaptation, Socratic correction, low-frequency check questions.
- **No dsh-web-ui plugins mounted by default (independence)**: the profile bundles `dsh-web-app` for the embedded chat UI, but mounts **none** of the dsh-web-ui plugin family (skin center / task board / SSH / aionui panel / git-graph / pet / live-stats, etc.) by default — so it has no `@linxin666` UI packages to resolve and boots cleanly with or without a `web` profile. The **skin center** (skin picker + background transparency) can be optionally re-enabled from the plugin settings; it requires a `web` profile to mirror the `@linxin666` skin packages from.

### Safety (fail-closed)
- Tool surface: file read/write/search + four note tools + ask_user; no shell, no web, no subagents, no delete tools. **No dsh-web-ui plugins are mounted** — the profile keeps the minimal agent tool surface.
- Writes confined to the vault (workspace-write); interactive escalation prompts disabled (`approval: never`); `DSH_PERMISSION_MODE=danger-full-access` only re-enables escalation prompts, the sandbox itself stays workspace-write.
- All memory lives as markdown inside the vault; archiving instead of deleting; the model may not edit policy or statistics fields.

## Requirements
- Obsidian desktop; Node.js ≥ 22.5; DeepSeek Harness (npm global `@deepseek-ai/dsh`); a configured DeepSeek model.
- Default port **3180** (coexists with the regular `dsh web` on 3080; configurable in settings).

## Install

**A (recommended)**: Obsidian → Settings → Community plugins → search **DSH Math Notes Assistant**, install and enable; or copy `main.js`/`manifest.json`/`styles.css` from a release into `<vault>/.obsidian/plugins/dsh-math-assistant/`. First run auto-detects dsh, initializes preset/profile/templates, and starts the service.

**B (CLI)**:
```bash
npm install -g dsh-math-memory
dsh-math-memory install --vault "D:\\Obsidian笔记数据库"
dsh --profile notes-assistant --port 3180 --patch "$DSH_HOME/profiles/notes-assistant/notes-assistant.patch.yml"
```

Plugin settings: port, dsh install dir, DSH_HOME, auto-start, auto-init, auto-archive (>90-day episodes), ribbon button, keep-alive on close, the **skin-center toggle** (optional dsh-web-ui skin settings), and the **capture-policy dropdowns**.

## Vault layout

```text
vault/
  AGENTS.md                       working protocol (auto-loaded)
  .deepseek/
    memory/profile.md             semantic layer (profile)
    memory/notation.md            notation ledger (collect → unify → maintain)
    memory/topics/                navigation layer
    memory/records/               typed atomic cards (+ hook blocks)
    memory/theorems/              personal theorem index (Matlas-style)
    memory/templates/             problem-template ↔ theorem graph
    memory/episodes/              raw evidence (append-only + archive/)
    inbox/                        idea memos
    capture-policy.md             capture policy (user-maintained)
    cache/                        machine-generated caches (do not edit)
```

## Development & quality

```bash
npm test          # syntax + 85 zero-token regression checks + installer e2e (drift detection)
npm run qa        # engine probe: 12 ground-truth recall assertions on the real vault (zero tokens)
npm run qa:e2e    # real-session end-to-end acceptance (spends real tokens; reports API-level usage)
node scripts/build-obsidian.mjs   # rebuild main.js (required after shared-file changes)
node scripts/deploy-local.mjs     # one-shot local deployment
```

- **Repository structure**: [ARCHITECTURE.md](ARCHITECTURE.md) — directory responsibilities, the two-component data flow, the memory↔retrieval boundary, and the feature checklist.
- **Memory knowledge base**: [docs/memory/](docs/memory/) — design (implementation spec), retrieval-v3 (retrieval proposal), testing (QA methodology), assessment, references (paper notes), changelog, handoff.
- **Acceptance record**: engine probe 12/12; the real-session E2E suite covers 5 cases (including the no-answer honesty and reformulate-retry behaviors); the cost-benchmark question (170K tokens pre-system) now measures ≈25K billed tokens (68% of the prompt served from cache).
- Version: **0.6.5** (prototype stage; the memory architecture has no long-term field testing yet and will keep evolving).

## Privacy & safety

Everything runs locally: the service binds 127.0.0.1, memory is markdown inside the vault, and the past-session index never leaves the machine.

## License

MIT
