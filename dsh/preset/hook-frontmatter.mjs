/**
 * hook-frontmatter — shared hook-block parser (single source of truth).
 *
 * The memory card `hook:` frontmatter block is parsed in exactly one place:
 * this file. It is imported by note-tools.mjs (ESM) and loaded into the
 * Obsidian plugin (obsidian/main.template.js → main.js) through the embedded
 * source loader in main.template.js. Keep this file free of imports so the
 * same source evaluates in both module systems.
 */

// Bump whenever the hook block's schema changes (new fields / changed value
// semantics). Any consumer that persists or caches hook-derived data must key
// on this version so a stale cache can never leak old-schema values.
const HOOK_SCHEMA_VERSION = 1;

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function parseHookFrontmatter(text) {
  if (typeof text !== "string" || text === "") return null;
  const lines = text.split(/\r?\n/);
  const hook = {};
  let inHook = false;
  let lastListKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inHook) {
      if (/^hook:\s*$/.test(trimmed)) { inHook = true; lastListKey = null; }
      continue;
    }
    if (line !== "" && !/^\s/.test(line)) break; // left the hook block
    if (trimmed === "") continue;
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (pair !== null) {
      const key = pair[1];
      const value = pair[2].trim();
      if (value === "") { hook[key] = []; lastListKey = key; }
      else if (value.startsWith("[") && value.endsWith("]")) {
        hook[key] = value.slice(1, -1).split(",").map((part) => stripQuotes(part.trim())).filter((part) => part !== "");
        lastListKey = null;
      } else { hook[key] = stripQuotes(value); lastListKey = null; }
    } else if (trimmed.startsWith("- ") && lastListKey !== null) {
      if (!Array.isArray(hook[lastListKey])) hook[lastListKey] = [];
      hook[lastListKey].push(stripQuotes(trimmed.slice(2).trim()));
    }
  }
  return Object.keys(hook).length === 0 ? null : hook;
}

export { parseHookFrontmatter, stripQuotes, HOOK_SCHEMA_VERSION };
