# DSH Math Notes Assistant (dsh-math-memory)

[English](README.md) · [简体中文](README.zh.md)

> A long-term math-memory agent for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that lives inside [Obsidian](https://obsidian.md) as a right-sidebar chat panel.

A **two-component** repository:

1. **Obsidian community plugin** (id `dsh-math-assistant`, repo-root `manifest.json` + `main.js`): embeds the dsh web UI in the right sidebar, detects and starts the dsh service, bootstraps the dsh-side configuration and vault templates on first run, and hosts the memory panel, capture-policy settings, and deterministic maintenance.
2. **dsh plugin** (npm package `dsh-math-memory`, `dsh/`): installs the same `notes-assistant` agent preset / profile and vault templates into `$DSH_HOME`.

The three install paths (native bundle / `--direct` offline copy / Obsidian's embedded bootstrap) produce equivalent configuration, kept conflict-free by owner markers. **Installing the Obsidian plugin alone is enough**; the CLI `dsh-math-memory install` (and `uninstall`) covers headless use.

## Why

Mathematics learning is long-horizon accumulation: notation habits, theoretical preferences, half-finished proofs, techniques, counterexamples, and ideas all need continuous collection and polishing into a connected system. Generic chat AI treats every conversation as isolated Q&A. This plugin gives the agent **cross-session layered memory** (five layers + a notation ledger + memo lifecycle), **unified retrieval** (notes + memory in one search), and a **standing protocol** (AGENTS.md) so each new session starts where the last one ended.

## How far this project actually gets (and what 1.0 means)

Being explicit about the boundary matters more than listing features:

- **Solved**: **"the agent cannot remember what you asked."** Raw evidence (episodes) is captured deterministically, typed atomic records carry source links, five indexed layers, unified retrieval (`note_recall`) in one pass, on-demand layer injection instead of dumping everything into context, plus a daily audit and a user feedback loop for deterministic upkeep. The cross-session *remember / find / correct* line works end to end.
- **Still far off**: **"helping you polish a body of mathematical understanding, and building a system for invoking that understanding and your techniques."** What is stored today is *what you asked and what was concluded*, not *where your understanding stands, where it stalls, and what to practice next*. The technique layer has storage and retrieval but **no invocation system** (when to use which card, how to judge its applicability boundary, what to switch to after a failure, how several techniques compose), and there is no active teaching loop (diagnose → hint → check → review as a long-term record) or review scheduling.
- **Therefore: 1.0 is the release that actually delivers the second line.** Today's 0.7.x is a prototype: the memory substrate is usable and the control surface is visible and correctable, but the "learning partner" goal is still a design generation away — see [docs/memory/handoff.md](docs/memory/handoff.md) §7 and [docs/memory/assessment.md](docs/memory/assessment.md) for the gap list and ordering.

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
- **Capture policy tiers**: `idea/fact/preference/structure × auto/ask/off` — one gate per memory layer (ideas → inbox, facts → records, preferences → profile/notation, structure → topics/theorem index/templates/strategy). Pick them in the plugin settings or by clicking the 「捕获策略」 line in either memory panel (both write back to `capture-policy.md`); auto-tier writes are announced in the closing line, ask-tier proposals state what/why/where.
- **Cross-session context**: past dsh sessions (zstd JSONL) distilled into bounded Q&A cues, vault-filtered and excluding the live session.

### Control surface (Obsidian side)
- **Memory panel**: a one-line status strip (profile/records/templates/topics/theorems/strategy/memos/episodes + last audit); a **⚠️ needs-you** block that puts the audit's re-review / archive suggestions next to the working archive button; all five card layers in one searchable list (title/topic/type/operator); per-card `✅ confirm` / `❌ wrong` / `stale` / `archive` (archive asks twice) with a plain-language receipt; an episode timeline with human titles + topics (8 rows, expandable); a Chinese audit summary with the model-facing checklist folded away; **edit-and-save in the panel** (mtime conflict guard).
- **Feedback loop**: `依据的记忆：<card title> — [✅ 这条对] [❌ 这张卡有错]` links in replies deterministically rewrite cards through the loopback `/feedback` endpoint (CSRF-token protected); note references are clickable and jump into Obsidian (`/open`).
- **Reply-quality protocol**: intuition before formalism, anchoring new material to your existing notes, difficulty adaptation, Socratic correction, low-frequency check questions.
- **No dsh-web-ui plugins mounted by default (independence)**: the profile bundles `dsh-web-app` for the embedded chat UI, but mounts **none** of the dsh-web-ui plugin family (skin center / task board / SSH / aionui panel / git-graph / pet / live-stats, etc.) by default — so it has no `@linxin666` UI packages to resolve and boots cleanly with or without a `web` profile. The **skin center** (skin picker + background transparency) can be optionally re-enabled from the plugin settings; it requires a `web` profile to mirror the `@linxin666` skin packages from. If that `web` profile carries the `@linxin666/dsh-web-all` aggregate (which has shipped its own skin-center row since 0.3.20), this toggle is functionally redundant — it still covers machines that have the skin packages but not the aggregate.

### Safety (fail-closed)
- Tool surface: file read/write/search + four note tools + ask_user; no shell, no web, no subagents, no delete tools. **No dsh-web-ui plugins are mounted** — the profile keeps the minimal agent tool surface.
- Writes confined to the vault (workspace-write); interactive escalation prompts disabled (`approval: never`); `DSH_PERMISSION_MODE=danger-full-access` only re-enables escalation prompts, the sandbox itself stays workspace-write.
- All memory lives as markdown inside the vault; archiving instead of deleting; the model may not edit policy or statistics fields.

## Requirements
- Obsidian desktop; Node.js ≥ 22.5; DeepSeek Harness (npm global `@deepseek-ai/dsh`, **verified against 0.1.5-rc.1** — see [`docs/dsh-0.1.5-adaptation.md`](docs/dsh-0.1.5-adaptation.md) for the session-format-V3 adaptation); a configured DeepSeek model.
- Default port **3180** (coexists with the regular `dsh web` on 3080; configurable in settings).

## Install

**A (recommended)**: download `main.js` / `manifest.json` / `styles.css` from the [latest release](https://github.com/maple110011/dsh-obsidian-math/releases) into `<vault>/.obsidian/plugins/dsh-math-assistant/`, then enable the plugin. First run auto-detects dsh, initializes preset/profile/templates, and starts the service.

> **Not in the community plugin browser yet.** The plugin id `dsh-math-assistant` is not present in Obsidian's `community-plugins.json`, so "Settings → Community plugins → Browse" will not find it; install it as above (or via [BRAT](https://github.com/TfTHacker/obsidian42-brat) pointed at this repo). See [`docs/release.md`](docs/release.md) for what the store listing still needs.

**B (CLI)**:
```bash
npm install -g dsh-math-memory
dsh-math-memory install --vault "D:\\Obsidian笔记数据库"
dsh --profile notes-assistant --port 3180                  # start (native: the bundle provides panel/workspace, no --patch needed)
```

Plugin settings: port, dsh install dir, DSH_HOME, auto-start, auto-init, auto-archive (>90-day episodes), ribbon button, keep-alive on close, the **skin-center toggle** (advanced; the aggregate bundle already carries a skin center), **sidebar performance mode** (default on: the loopback proxy drops the skin's expensive effects *and* slows the two hot loops in the skin's client hook script — the measured cause of the sidebar stutter), **sidebar skin decorations** (default on; turn it off to skip the skin's client script entirely — smoothest, at the cost of the hero scene / status character), and the **capture-policy dropdowns**. Measurements and the full cause list: [docs/memory/sidebar-performance.md](docs/memory/sidebar-performance.md).

> **Full guide** — installation model, conflict resolution (owner markers / `--force` takeover), and uninstall (three-tier deletion, `--purge-data` confirm phrase) — in [`docs/installation.md`](docs/installation.md).

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
npm test          # syntax + 232 zero-token regression checks + 30 route-level checks + 7 real-dsh handshake checks + 31 loopback-proxy checks + installer e2e (drift detection)
npm run qa        # engine probe: 12 ground-truth recall assertions + reachability layering / pooling A/B on the real vault (zero tokens)
npm run qa:e2e    # real-session end-to-end acceptance (spends real tokens; reports API-level usage)
node scripts/build-obsidian.mjs   # rebuild main.js (required after shared-file changes)
node scripts/deploy-local.mjs     # one-shot local deployment
```

- **Repository structure**: [ARCHITECTURE.md](ARCHITECTURE.md) — directory responsibilities, the two-component data flow, the memory↔retrieval boundary, and the feature checklist.
- **Memory knowledge base**: [docs/memory/](docs/memory/) — design (implementation spec), retrieval-v3 (retrieval proposal + §7 GraphMemix intake decisions and A/B measurements), testing (QA methodology), assessment, references (paper notes), [sidebar-performance](docs/memory/sidebar-performance.md) (why the Obsidian panel was janky and what was measured), changelog, handoff.
- **Host-version adaptation**: [docs/dsh-0.1.5-adaptation.md](docs/dsh-0.1.5-adaptation.md) — evidence, fix list, and the reasons for what was deliberately left alone under dsh 0.1.5-rc.1 / session format V3 / `dsh-web-all@0.3.20`.
- **Acceptance record**: both probes call the SHIPPED ranking pipeline (`buildRecallDoc` / `rankRecallDocuments` / `rankStrategyCards`) instead of re-deriving it — seed probe 8/8 on the synthetic vault, engine probe **12/12** on the real vault (navigation indices are demoted, so the "library has no answer → weak signal" control holds). The engine probe additionally prints GraphMemix-style **reachability layering** (Direct / Recoverable / No access) and a signed net-recovery Δ for the bag-vs-multi-view A/B, plus target ranks — the measurement that kept multi-view max-pooling out of the default path (`docs/memory/retrieval-v3.md` §7.2). The real-session E2E suite covers 5 cases (including the no-answer honesty and reformulate-retry behaviors); the cost-benchmark question (170K tokens pre-system) now measures ≈25K billed tokens (68% of the prompt served from cache).
- Version: **0.7.5** (prototype stage; the memory architecture has no long-term field testing yet and will keep evolving).

## Privacy & safety

Everything runs locally: the service binds 127.0.0.1, memory is markdown inside the vault, and the past-session index never leaves the machine.

## License

MIT
