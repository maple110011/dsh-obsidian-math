# DSH Obsidian Math Assistant

<p align="center">
  <a href="README.zh.md"><img alt="中文文档" src="https://img.shields.io/badge/中文-切换到中文-blue?style=for-the-badge"></a>
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/English-English_README-2ea043?style=for-the-badge"></a>
</p>

A long-term math-memory agent for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that lives inside [Obsidian](https://obsidian.md) as a right-sidebar chat panel. This repository ships **two installable forms** of the same system:

1. **Obsidian community plugin** — `dsh-obsidian-math` (repo-root `manifest.json` + `main.js`). It opens the dsh web UI in the right sidebar, detects and starts the dsh service automatically, and bootstraps the vault memory templates. No extra cmd window.
2. **dsh plugin** — npm package `dsh-obsidian-math` (`dsh/`). Installs the `obsidian` agent preset and the `obsidian` profile into `$DSH_HOME`, plus optional vault templates.

The agent deliberately keeps the **smallest possible toolset** — file read/write/search and `ask_user_question` — and adds a layered, paper-informed memory system.

## Problems solved

1. **“I asked this before and forgot.”** Valuable context gets scattered across past AI conversations; after a while you re-ask from zero and the model re-guesses your focus, notation, and theoretical preferences. This plugin gives the agent a **durable layered memory** (profile + topic index + raw episode evidence) and injects a bounded digest of past dsh conversations into every new session, so it starts from where the last conversation ended instead of from scratch.
2. **“Writing notes means repeatedly sending md files to the AI.”** The assistant lives inside Obsidian's right sidebar and only has file read/write/search tools. Untangling structure, completing details, reviewing a draft, and finding problems all happen in place on the vault — no more copy-pasting notes back and forth.
3. **“Key mathematical ideas slip away.”** General math heuristics, techniques, and viewpoints that surface during conversations are easy to lose. The agent proactively proposes `💡 可捕捉的想法`, writes them (with your consent) into a memo library with lifecycle `inbox → polishing → done`, and the plugin re-surfaces related or stale memos with `🔔 备忘录提醒` — prompting you to polish exactly when new related ideas appear.

## Scope & limitations

- **Math-focused by design.** The memory layers, typed records, review workflow, and idea-memo reminders are tuned for math-adjacent knowledge (mathematics, statistics, economics: concepts, propositions, proofs, methods). Different knowledge domains — codebases, law, medicine, engineering workflows — typically need different memory granularity and retrieval protocols; do not assume this design transfers unchanged.
- **Prototype status (0.1.x).** The memory architecture has **not** been through long-term usage testing or systematic benchmark evaluation. Layer boundaries, record types, and reminder policies are expected to evolve. The design draws on [arXiv:2606.24775](https://arxiv.org/abs/2606.24775) and [arXiv:2607.05794](https://arxiv.org/abs/2607.05794); a more complete agent-native memory architecture remains future work.

## Highlights

- **Minimal agent surface**: `read`, `write`, `edit`, `glob`, `grep`, `read_image`, `ask_user_question`. No shell, no web tools, no subagents.
- **Layered long-term memory** (informed by [arXiv:2606.24775](https://arxiv.org/abs/2606.24775), *Are We Ready For An Agent-Native Memory System?*):
  - `profile.md` — semantic layer: stable preferences, notation, standing authorizations;
  - `topics/` — navigation layer: topic index and per-topic details;
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

## Install A — Obsidian community plugin

1. In Obsidian: **Settings → Community plugins → Browse**, search **DSH Obsidian Math Assistant**, install and enable. (For a manual install, copy `main.js`, `manifest.json`, `styles.css` from a GitHub release into `<vault>/.obsidian/plugins/dsh-obsidian-math/` and enable it.)
2. The plugin auto-detects the dsh installation (PATH, npm global, or `DSH_HOME`'s parent). If detection fails, open the plugin settings and press **Detect** or enter the path (e.g. `E:\software\deepseek-harness`).
3. On first run the plugin writes the `obsidian` agent preset and profile into `$DSH_HOME` (missing files only) and creates the vault memory templates (`AGENTS.md`, `.deepseek/...`). A settings button re-runs this bootstrap or forces a reinstall.
4. The service starts automatically. Click the ribbon icon (message-square) or run the command **DSH Math Assistant: Open DSH Math Assistant**; drag the tab to the right sidebar once — Obsidian remembers the position.

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
| Keep service alive when Obsidian closes | off by default |

## Install B — dsh plugin (npm)

```bash
# global CLI + one-shot setup (adds --vault to also seed the vault templates)
npm install -g dsh-obsidian-math
dsh-obsidian-math install --vault "D:\Obsidian笔记数据库"

# or install it into a profile like any other dsh plugin
dsh plugin --profile obsidian add dsh-obsidian-math
```

The installer is idempotent and preserves user edits (use `--force` to overwrite). It creates:

- `$DSH_HOME/.agent-presets/obsidian/` — preset.yml, agent.cordis.yml, obsidian-memory.mjs;
- `$DSH_HOME/profiles/obsidian/` — package.json, cordis.yml, cordis.patch.yml, pnpm-workspace.yaml;
- `<vault>/AGENTS.md` and `<vault>/.deepseek/**` templates (when `--vault` is given).

Then run:

```bash
dsh --profile obsidian --port 3180
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
    memory/records/index.md       typed atomic records (fact/event/instruction/preference)
    memory/records/<slug>.md      record cards with provenance links
    memory/episodes/index.md      event timeline
    memory/episodes/YYYY-MM-DD-*.md  raw event cards (append-only)
    inbox/index.md                memo index grouped by status
    inbox/<slug>.md               idea memos (inbox → polishing → done)
    cache/                        machine-generated dialogue index (do not edit)
```

## Development

```bash
npm test                       # syntax checks
node scripts/build-obsidian.mjs  # regenerate main.js from obsidian/main.template.js + dsh/ files
node scripts/test-installer.mjs  # end-to-end installer test against temp dirs
```

`main.js` is generated — edit `obsidian/main.template.js` and the shared `dsh/` files, then rebuild.

## Privacy & safety

Everything runs locally: the dsh web service binds to `127.0.0.1`, all memory lives as markdown inside the vault, and the past-session index never leaves the machine.

The `obsidian` profile is fail-closed by design: writes are confined to the vault (`workspace-write`), interactive permission-escalation prompts are **disabled** (`approval: never`, so an accidental click cannot widen the boundary), and the toolset contains no delete/rm tools. To opt into one-off full access you must set `DSH_PERMISSION_MODE=danger-full-access` explicitly and restart the service.

## Release

Releases are automated: bump `version` in `package.json` and `manifest.json` (keep them equal), run `node scripts/build-obsidian.mjs`, commit, then push a tag matching the version — the workflow publishes the release with `main.js`, `manifest.json`, and `styles.css` attached. Manual fallback: create a GitHub release with the same tag and upload those three files.

## License

MIT
