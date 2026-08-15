# Changelog

## [0.3.0] - 2026-08-15

### Added

- Three dedicated note tools in the `obsidian` agent preset, registered via `defineTool` (`dsh/preset/obsidian-notes.mjs`):
  - `note_search` — full-text vault search with optional tag filtering;
  - `note_create` — create a new note only, refusing to overwrite existing notes;
  - `note_links` — wikilink backlink queries (one note or the whole vault).
- The note tools are applied through `obsidian-memory.mjs` (always refreshed on update), so existing 0.2.0 installations activate them without a forced preset reinstall.

### Changed

- READMEs reordered so the "Problems solved" section appears right after the introduction.
- Version references updated across README, vault `AGENTS.md`, preset description, and plugin settings tab.

## [0.2.0] - 2026-08-15

### Added

- Loopback link server in the Obsidian plugin: note references in agent replies become clickable links (`/open?path=...`) that jump straight to the note in Obsidian; files still use `[[wikilink]]`.

## [0.1.2] - 2026-08-15

### Changed

- Plugin display name renamed from "DSH Obsidian Math Assistant" to "DSH Math Notes Assistant" (directory rule: names must not contain "Obsidian").

## [0.1.1] - 2026-08-15

### Changed

- Obsidian plugin id renamed from `dsh-obsidian-math` to `dsh-math-assistant` to comply with the community directory rule that plugin ids must not contain `obsidian`.

## [0.1.0] - 2026-08-15

### Added

- Obsidian community plugin: right-sidebar dsh web view, automatic dsh detection/start/stop, first-run bootstrap of the `obsidian` preset/profile and vault memory templates, ribbon button, settings tab with logs.
- dsh npm plugin: `dsh-obsidian-math` CLI installer for `$DSH_HOME/.agent-presets/obsidian` and `$DSH_HOME/profiles/obsidian`, optional vault template seeding, idempotent with `--force` support.
- `obsidian` agent preset: minimal file-only tools (`read`, `write`, `edit`, `glob`, `grep`, `read_image`, `ask_user_question`).
- Layered long-term memory plugin (informed by arXiv:2606.24775): profile / topics / episodes / inbox, path-independent vault resolution, zstd session-log dialogue index with caching.
- Typed atomic-record memory layer (fact/event/instruction/preference with provenance links), informed by arXiv:2607.05794 (NapMem).
- Rethlas-style proof workflow: reasoning primitives, generate-verify loop, personal theorem index, and artifact records (arXiv:2604.03789).
- Personal template-theorems graph: problem/solution template cards linked to theorems, with distillation-first retrieval (AAAI-26 40411).
- Idea memo library with lifecycle `inbox → polishing → done`, frontmatter scanning, stale-candidate reminders, and proactive polishing prompts.
- GitHub Actions: CI build/test checks and tag-triggered release asset publishing.
- Bilingual README with language switch buttons.
