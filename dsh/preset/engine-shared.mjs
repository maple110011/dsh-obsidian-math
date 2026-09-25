// dsh/preset/engine-shared.mjs — helpers that BOTH copies of the memory engine use.
//
// WHY A SHARED FILE, WHEN "THE TWO ENGINES CANNOT SHARE AN IMPORT". They could not
// while the preset body lived in `$DSH_HOME/.agent-presets/<id>/` — a flat
// directory with no `node_modules` to resolve from — and the host half ran from the
// installed package. Both half-problems have the same shape ("the same relative
// specifier must resolve in two layouts"), and `dsh/host/hook-frontmatter.mjs`
// already solved it: the canonical file lives here, the offline channel stages it
// FLAT beside the other preset files, and a re-export shim of the same name in
// `dsh/host/` satisfies the import inside the published package. So
// `import { contentText } from "./engine-shared.mjs"` resolves in all three places
// this repository runs code: the preset tree, the host tree, and the materialized
// Obsidian bundle (which embeds this file under its basename).
//
// WHAT BELONGS HERE. Only helpers whose two copies were PROVEN identical, or that
// were merged deliberately. Everything else stays duplicated on purpose and is
// listed — with a reason and a lifecycle — in `scripts/check-engine-sync.mjs`, the
// guard that also reports any renamed duplicate it can find.

/** Concatenate the `text` blocks of a message content array (reasoning blocks are not `text`). */
export function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
