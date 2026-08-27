// dsh/host/hook-frontmatter.mjs — re-export of the canonical hook-block parser
// (dsh/preset/hook-frontmatter.mjs) so dsh/host consumers resolve it as a flat
// sibling in the published package layout.
//
// The canonical file lives in dsh/preset/ because note-tools.mjs (also in
// dsh/preset/) imports it as `./hook-frontmatter.mjs`, and the preset tree is
// synced FLAT into ~/.dsh/.agent-presets/notes-assistant/. math-memory-panel.mjs
// (in dsh/host/) also imports `./hook-frontmatter.mjs`; inside the installed
// package this re-export satisfies that import without duplicating the parser.
// The legacy flat-copy install path writes the canonical file as a sibling in
// the profile directory instead, so this file is only ever resolved by the
// bundle (node_modules) layout.
export { parseHookFrontmatter, stripQuotes, HOOK_SCHEMA_VERSION } from "../preset/hook-frontmatter.mjs";
