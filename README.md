# DSH Math Notes Assistant

> 📄 [**中文文档（切换到中文）**](https://github.com/maple110011/dsh-obsidian-math/blob/main/README.zh.md) · This page is the English README.

A long-term math-memory agent for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that lives inside [Obsidian](https://obsidian.md) as a right-sidebar chat panel. This repository ships **two cooperating components**:

1. **Obsidian community plugin** — plugin id `dsh-math-assistant` (repo-root `manifest.json` + `main.js`). This is the user-facing entry point: it opens the dsh web UI in the right sidebar, detects and starts the dsh service, **and bootstraps the dsh-side configuration automatically** (the `obsidian` agent preset/profile plus the vault memory templates) on first run.
2. **dsh plugin** — npm package `dsh-obsidian-math` (`dsh/`). It installs the **same** `obsidian` agent preset, `obsidian` profile, and optional vault templates into `$DSH_HOME`.

**How they relate:** both components write identical, idempotent dsh configuration. Most users only need component 1 — installing the Obsidian plugin is enough. Use component 2 when you want the dsh mode without the Obsidian plugin, or when you prefer to install/update the dsh side from the command line.

## Why this plugin exists

Mathematics learning is a long-horizon accumulation: notation habits, theoretical preferences, half-finished proofs, techniques, counterexamples, and reusable ideas all need to be gathered continuously and polished into a connected system that compounds into knowledge returns. Have you run into these problems along the way?

1. As your collection grows, manual note-keeping costs ever more time and energy; maintaining and retrieving a knowledge base depends heavily on fallible memory and demanding self-discipline.
2. Talking with an AI while studying is a very effective way to refine ideas, but a generic conversational AI treats every chat as isolated Q&A. Everything valuable — about you and about the subject — scatters across past conversations, and each new session starts by guessing your existing knowledge, current focus, and lines of thought from zero.
3. Key ideas that emerge during AI conversations are fleeting and drown in long chat histories.

To solve the problems that have long bothered me (and perhaps you), I developed this Obsidian plugin (plus a DeepSeek Harness preset) with the help of DeepSeek.

What it does:

1. Embeds DeepSeek Harness (dsh) in Obsidian's right sidebar as an Obsidian note-assistant mode. In this mode dsh has only basic file read/write access inside the vault, with everything else strictly restricted; the exact safety boundary is described under [Privacy & safety](#privacy--safety). Restructuring, detail completion, proof review, problem finding, and idea exploration all happen inside the vault, where the agent can directly draw on the vault's existing knowledge.
2. Adds a memory system to the agent. Currently, following related literature and the characteristics of mathematical knowledge, it ships an experimental math-oriented memory design: the five-layer durable memory (profile / topics / typed records / raw episodes / ideas) references [arXiv:2606.24775](https://arxiv.org/abs/2606.24775) and [arXiv:2607.05794](https://arxiv.org/abs/2607.05794), while the problem-template ↔ theorem graph references [AAAI-26: Template-Theorems Graph Construction](https://ojs.aaai.org/index.php/AAAI/article/view/40411).
3. Proactively captures `💡 可捕捉的想法` and, **only with user consent**, writes them to a memo library with lifecycle `inbox → polishing → done`; related ideas are merged instead of duplicated, and stale memos surface as `🔔 备忘录提醒` prompts. The reminder thresholds are documented under [Highlights](#highlights).

> For the current design's limitations, see [Scope & limitations](#scope--limitations).

### What this repository contains and where it lands

| In this repo | What it is | Installed to |
|---|---|---|
| repo-root `main.js` / `manifest.json` / `styles.css` | Obsidian community plugin (id `dsh-math-assistant`) | `<vault>/.obsidian/plugins/dsh-math-assistant/` |
| `dsh/preset/` (`preset.yml`, `agent.cordis.yml`, `obsidian-memory.mjs`, `obsidian-notes.mjs`) | dsh **agent preset** `obsidian` (minimal tools + memory plugin + dedicated note tools) | `$DSH_HOME/.agent-presets/obsidian/` |
| `dsh/profile/` (`package.json`, `cordis.patch.yml`, `obsidian-workspace.mjs`, `obsidian.patch.yml`, …) | dsh **profile** `obsidian` (web app + fail-closed sandbox + vault workspace auto-registration) | `$DSH_HOME/profiles/obsidian/` |
| `dsh/templates/` | Vault memory templates (`AGENTS.md`, `.deepseek/**`) | `<vault>/AGENTS.md`, `<vault>/.deepseek/**` |
| `dsh/install.mjs` | npm CLI `dsh-obsidian-math` that writes the above | npm global bin |

Note: the dsh side is **not** a Cordis bundle — it is an **agent preset + profile + installer** (the Obsidian plugin embeds and bootstraps the same files automatically). The exact toolset, memory layers, and reminder policies are listed under [Highlights](#highlights); limitations are listed under [Scope & limitations](#scope--limitations).

## Scope & limitations

- **Math-focused by design.** The memory layers, typed records, review workflow, and idea-memo reminders are tuned for math-adjacent knowledge (mathematics and statistics: concepts, propositions, proofs, methods). Different knowledge domains — codebases, law, medicine, engineering workflows — typically need different memory granularity and retrieval protocols; do not assume this design transfers unchanged.
- **Prototype status (0.4.x).** The memory architecture is based on a small set of papers the author personally found relevant, has **not** been through long-term usage testing or systematic benchmark evaluation, and lacks long-term field experience. Layer boundaries, record types, and reminder policies are expected to evolve; a more complete agent-native memory architecture remains future work.

## Highlights

- **Capture policy tiers**: `.deepseek/capture-policy.md` (user-maintained) gates `idea/fact/preference × auto/ask/off` — auto writes directly, ask asks first, off stays silent; defaults preserve the existing behavior and the current tiers show in the memory panel.
- **Minimal agent surface**: `read`, `write`, `edit`, `glob`, `grep`, `read_image`, `ask_user_question`, plus dedicated note tools `note_search` (tag filtering), `note_create` (overwrite protection), `note_links` (backlink queries), `note_retrieve` (memory-v2 strategy retrieval). No shell, no web tools, no subagents.
- **Strategy retrieval (memory v2)**: `note_retrieve` performs two-stage retrieval over memory cards that carry a `hook:` frontmatter block — operator hard filter, then weighted scoring (token similarity / structural pattern / heuristics / quantity / success-rate prior), informed by [arXiv:2606.31191](https://arxiv.org/abs/2606.31191) (ISM) and [EMNLP 2025 Findings 1162](https://aclanthology.org/2025.findings-emnlp.1162/) (Dual RAG). Falls back to full-text token ranking when the vault has no hook cards.
- **Deterministic memory health check**: a daily audit scans the cards' frontmatter and hook fields, classifies them (strong / weak / unused / duplicate candidates / unverified), syncs `note_retrieve` hit statistics back into `hook.uses` / `hook.last_used`, and injects a bounded audit section into every system prompt. The model then acts on the audit per AGENTS.md — merges are superseded, never deleted.
- **Memory control surface**: verification badges (✅/⚖️/❓) and `[✅ 这条对] [❌ 这条错]` feedback links in agent replies (loopback `/feedback` endpoint with vault-containment), plus a dedicated **DSH 记忆面板** Obsidian view — browse all five memory layers with hook stats, search, and one-click confirm / wrong / supersede / archive per card (archive never hard-deletes).
- **Memory system knowledge base**: the design, assessments, v2 proposal, and paper notes live under `docs/memory/` and are maintained alongside the code.
- **Layered long-term memory** (references [arXiv:2606.24775](https://arxiv.org/abs/2606.24775) and [arXiv:2607.05794](https://arxiv.org/abs/2607.05794)):
  - `profile.md` — semantic layer: stable preferences, notation, standing authorizations;
  - `topics/` — navigation layer: topic index and per-topic details;
  - `records/` — typed atomic-record layer: fact/event/instruction/preference cards with provenance links;
  - `episodes/` — raw evidence layer: append-only per-conversation event cards (original wording preserved);
  - `inbox/` — idea memo library with lifecycle `inbox → polishing → done`.
- **Cross-session context**: a memory plugin distills this machine's past dsh sessions (zstd JSONL logs) into bounded Q&A cues injected into every system prompt, filtered to exclude the live session.
- **Proactive memo reminders**: the plugin scans every memo's frontmatter and injects stale candidates (`polishing` > 3 days, `inbox` > 7 days, not yet reminded today); the agent proposes `🔔 备忘录提醒` and asks via `ask_user_question` before polishing. New related ideas are merged into existing memos instead of duplicated.
- **Note workflow**: structure untangling, detail completion (marked `<!-- AI 补全 -->`), graded review, problem finding, all inside the vault.
- **Versioned fact updates**: superseded facts are marked `~~old~~ → new (date)`, never silently deleted.

## Requirements

- Obsidian desktop (plugin is desktop-only).
- Node.js ≥ 22.5.
- DeepSeek Harness installed (npm global `@deepseek-ai/dsh`, or any local install reachable via the `dsh` command / configured path).
- A configured DeepSeek model (the dsh Models page / `$DSH_HOME/settings.yaml`).

### Why port 3180 instead of dsh's default 3080?

The dsh **web** profile binds `127.0.0.1:3080` by default. This plugin boots its own
**obsidian** profile as a separate service, and two processes cannot share one port.
Using `3180` by default means the Obsidian assistant and a normally running
`dsh web` (your regular coding sessions) can coexist on the same machine without
either one failing with `EADDRINUSE`. The port is configurable in the plugin
settings or via `dsh --profile obsidian --port <n>`.

## Install A — Obsidian community plugin (recommended, usually sufficient)

This installs the UI **and** the dsh-side configuration (the plugin bootstraps it automatically).

1. In Obsidian: **Settings → Community plugins → Browse**, search **DSH Math Notes Assistant**, install and enable. (For a manual install, copy `main.js`, `manifest.json`, `styles.css` from a GitHub release into `<vault>/.obsidian/plugins/dsh-math-assistant/` and enable it.)
2. The plugin auto-detects the dsh installation (PATH, npm global, or `DSH_HOME`'s parent). If detection fails, open the plugin settings and press **自动检测** or enter the path (e.g. `E:\software\deepseek-harness`).
3. On first run the plugin writes the `obsidian` agent preset and profile into `$DSH_HOME` (missing files only) and creates the vault memory templates (`AGENTS.md`, `.deepseek/...`). A settings button re-runs this bootstrap or forces a reinstall.
4. The service starts automatically. Click the ribbon icon (message-square) or run the command **打开 DSH数学笔记助手**; drag the tab to the right sidebar once — Obsidian remembers the position.

That's it — no cmd window, no manual profile editing.

### Plugin settings

| Setting | Meaning |
|---|---|
| Port | local web port (default `3180`) |
| dsh installation directory | detected automatically; manual override |
| DSH_HOME | harness home; defaults from `DSH_HOME` env or `~/.dsh` |
| Start service automatically | on by default |
| Initialize configuration automatically | on by default (first run only) |
| Show ribbon icon | one-click sidebar button |
| Memory panel | opened from the plugin settings page («打开记忆面板») or the command palette; no extra ribbon icon |
| Keep service alive when Obsidian closes | off by default |

## Install B — dsh plugin via npm (optional; only if you skip the Obsidian plugin)

This installs the same `obsidian` preset/profile that the Obsidian plugin bootstraps automatically. Use it for the pure dsh CLI workflow, or to install/update the dsh side explicitly.

```bash
# global CLI + one-shot setup (adds --vault to also seed the vault templates)
npm install -g dsh-obsidian-math
dsh-obsidian-math install --vault "D:\Obsidian笔记数据库"

# or install it into a profile like any other dsh plugin
dsh plugin --profile obsidian add dsh-obsidian-math
```

The installer is idempotent and preserves user edits (use `--force` to overwrite). It creates:

- `$DSH_HOME/.agent-presets/obsidian/` — preset.yml, agent.cordis.yml, obsidian-memory.mjs, obsidian-notes.mjs;
- `$DSH_HOME/profiles/obsidian/` — package.json, cordis.yml, cordis.patch.yml, pnpm-workspace.yaml, obsidian-workspace.mjs, obsidian.patch.yml;
- `<vault>/AGENTS.md` and `<vault>/.deepseek/**` templates (when `--vault` is given).

Then run:

```bash
# The Obsidian plugin adds this --patch overlay automatically; for pure CLI
# use pass it explicitly so the vault auto-registers as a workspace.
dsh --profile obsidian --port 3180 \
  --patch "$DSH_HOME/profiles/obsidian/obsidian.patch.yml"
```

The memory plugin is path-independent: the vault is taken from the session cwd (or `DSH_OBSIDIAN_VAULT`), and session history comes from `$DSH_HOME/sessions` (or `DSH_SESSIONS_ROOT`).

## Vault layout

```text
vault/
  AGENTS.md                       working protocol (auto-loaded)
  .deepseek/
    memory/profile.md             semantic layer: preferences & stable facts
    memory/topics/index.md        navigation layer: topic routing index
    memory/topics/<topic>.md      per-topic details
    memory/records/index.md       typed atomic records (fact/event/instruction/preference/artifact)
    memory/records/<slug>.md      record cards with provenance links
    memory/theorems/index.md      personal theorem index (Matlas-style)
    memory/templates/             problem/solution template cards linked to theorems
    memory/episodes/index.md      event timeline
    memory/episodes/YYYY-MM-DD-*.md  raw event cards (append-only)
    inbox/index.md                memo index grouped by status
    inbox/<slug>.md               idea memos (inbox → polishing → done)
    cache/                        machine-generated dialogue index, memory audit, retrieval stats (do not edit)
```

## Development

```bash
npm test                       # syntax checks + memory regression checks + installer e2e
node scripts/build-obsidian.mjs  # regenerate main.js from obsidian/main.template.js + dsh/ files
node scripts/test-memory.mjs     # zero-token memory v2 regression checks (synthetic vault)
node scripts/test-installer.mjs  # end-to-end installer test against temp dirs
```

`main.js` is generated — edit `obsidian/main.template.js` and the shared `dsh/` files, then rebuild.

The memory system has its own knowledge base under [`docs/memory/`](docs/memory/): current design, assessment history, the memory-v2 proposal, and paper notes. Memory/retrieval changes are documented there together with the code.

## Privacy & safety

Everything runs locally: the dsh web service binds to `127.0.0.1`, all memory lives as markdown inside the vault, and the past-session index never leaves the machine.

The `obsidian` profile is fail-closed by design: writes are confined to the vault (`workspace-write`), interactive permission-escalation prompts are **disabled** (`approval: never`, so an accidental click cannot widen the boundary), and the toolset contains no delete/rm tools. To opt into one-off full access you must set `DSH_PERMISSION_MODE=danger-full-access` explicitly and restart the service.

Because the agent cannot delete or move files, lifecycle maintenance is owned by the Obsidian plugin: old episode cards (> 90 days) are moved into `episodes/archive/` automatically at startup (configurable in settings). Record conflicts are marked `superseded` instead of deleted, so no memory is silently lost.

## License

MIT
