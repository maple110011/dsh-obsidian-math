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

/** Join frontmatter lines, dropping the blank line an EMPTY body would leave. */
export function joinFrontmatterLines(lines, useCrlf) {
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines.join(useCrlf ? "\r\n" : "\n");
}

/**
 * Set a top-level (non-indented) frontmatter field, appending when absent.
 *
 * MERGED 2026-09-26 from `setTopField` (host) and `setTopFieldText` (preset) — byte
 * identical logic except that the host joined through `joinFrontmatterLines` and the
 * preset joined inline, so for an EMPTY frontmatter body (`---\n\n---`) the host
 * produced `key: value` while the preset produced `\nkey: value`. The host's is the
 * side that had been FIXED (a spare leading blank line is noise at best), so it is
 * the behaviour both engines get now. Pinned by a test in scripts/test-memory.mjs.
 *
 * Note the deliberate limit: an INDENTED `field:` (i.e. inside `hook:`) is not
 * touched — that is `setHookField`'s job.
 */
export function setTopField(frontmatterText, field, value) {
  const lines = frontmatterText.split(/\r?\n/);
  let seen = false;
  const pattern = new RegExp("^" + field + ":");
  const updated = lines.map((line) => {
    if (!/^\s/.test(line) && pattern.test(line)) {
      seen = true;
      return field + ": " + value;
    }
    return line;
  });
  if (!seen) updated.push(field + ": " + value);
  return joinFrontmatterLines(updated, frontmatterText.includes("\r\n"));
}
