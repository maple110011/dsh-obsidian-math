/**
 * check-config-scaffold — `.deepseek/config.md` must be created the SAME way from
 * every front-end.
 *
 * Two surfaces perform the same "there is no config.md, so create it from the
 * scaffold, then set one field" operation:
 *
 *   1. the Obsidian plugin's settings page — passes the embedded
 *      `dsh/templates/config.md` (the authoritative scaffold, which also carries
 *      the field documentation the user reads), and
 *   2. the memory panel route `/memory-panel/session-capture-toggle` — passes
 *      `configScaffold()`, which reads that same template file when it is
 *      reachable and otherwise falls back to a literal.
 *
 * They used to disagree: the panel's literal said `autoArchive: false` and omitted
 * `captureSubagents`, while the template says `autoArchive: true`. So a vault that
 * had its config.md created by the panel silently started with a different
 * `autoArchive` default than the documentation promised (docs/handoff.md §7).
 * A wrong default here is not cosmetic: `autoArchive: true` is what makes the
 * deterministic audit move low-utility cards into `.deepseek/archive/`.
 *
 * This check pins the FALLBACK literal to the template (keys, order, values) and
 * asserts the runtime path still reads the real file first. It imports the panel
 * module for real rather than grepping its source, so a reformat cannot fool it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FALLBACK, configScaffold } from "../dsh/host/math-memory-panel.mjs";
// The frontmatter DELIMITER rule has exactly one home (`check-frontmatter-source.mjs`
// rejects re-typed copies — it is the root cause behind three data-corruption
// incidents). Split the span it returns; never match `---` here.
import { frontmatterSpan } from "../dsh/preset/hook-frontmatter.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const templatePath = join(root, "dsh", "templates", "config.md");
const template = readFileSync(templatePath, "utf8");

/** Frontmatter key/value pairs, in file order. */
function frontmatterPairs(text) {
  const span = frontmatterSpan(text);
  if (span === null) return null;
  return span.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf(":");
      return at < 0 ? [line, ""] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    });
}

/** First markdown heading, which names the file for the user. */
function titleOf(text) {
  const match = /^#\s+(.+)$/m.exec(text);
  return match === null ? null : match[1].trim();
}

let failed = 0;
const check = (label, cond, detail = "") => {
  console.log((cond ? "[ok]" : "[FAIL]"), label + (cond || detail === "" ? "" : ` — ${detail}`));
  if (!cond) failed += 1;
};

const templatePairs = frontmatterPairs(template);
const fallbackPairs = frontmatterPairs(CONFIG_FALLBACK);
check("the template has a parseable frontmatter", Array.isArray(templatePairs) && templatePairs.length > 0);
check("the fallback has a parseable frontmatter", Array.isArray(fallbackPairs) && fallbackPairs.length > 0);

const templateKeys = (templatePairs ?? []).map(([k]) => k);
const fallbackKeys = (fallbackPairs ?? []).map(([k]) => k);
check("fallback frontmatter keys match the template (same set AND order)",
  fallbackKeys.length === templateKeys.length && fallbackKeys.every((k, i) => k === templateKeys[i]),
  `template=[${templateKeys.join(",")}] fallback=[${fallbackKeys.join(",")}]`);

const disagreements = [];
for (const [key, value] of templatePairs ?? []) {
  const found = (fallbackPairs ?? []).find(([k]) => k === key);
  if (found === undefined) disagreements.push(`${key}: missing from the fallback`);
  else if (found[1] !== value) disagreements.push(`${key}: template=${value} fallback=${found[1]}`);
}
check("every fallback value equals the template's value", disagreements.length === 0, disagreements.join("; "));

check("the fallback title matches the template's heading",
  titleOf(CONFIG_FALLBACK) === titleOf(template),
  `template=${titleOf(template)} fallback=${titleOf(CONFIG_FALLBACK)}`);

// The runtime path must prefer the real file: if the fallback silently became the
// only source, the created config.md would lose the field documentation, so the
// two channels would create different files again.
check("configScaffold() returns the REAL template when it is reachable (npm/bundle channel)",
  configScaffold().includes("# 记忆系统设置") && configScaffold().length === template.length,
  `got ${configScaffold().length} chars, template is ${template.length}`);

console.log(failed === 0
  ? "config-scaffold: ok (panel fallback == template; runtime path prefers the template)"
  : `config-scaffold: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
