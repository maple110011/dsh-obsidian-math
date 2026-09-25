// dsh/host/engine-shared.mjs — re-export of the canonical shared engine helpers
// (dsh/preset/engine-shared.mjs) so dsh/host consumers resolve them as a flat
// sibling in the published package layout.
//
// Same trick and same reason as ./hook-frontmatter.mjs: the offline install path
// stages the CANONICAL file as a flat sibling in the profile directory, so this
// file is only ever resolved by the bundle (node_modules) layout — and it is
// deliberately NOT embedded (see NOT_EMBEDDED in scripts/build-obsidian.mjs),
// because embedding it too would collide with the canonical file on the same
// materialized basename.
export { contentText, joinFrontmatterLines, setTopField } from "../preset/engine-shared.mjs";
