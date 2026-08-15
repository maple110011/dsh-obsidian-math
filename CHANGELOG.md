# Changelog

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
