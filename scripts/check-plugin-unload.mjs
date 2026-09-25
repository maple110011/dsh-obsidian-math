/**
 * check-plugin-unload — `onunload()` must release the sockets this plugin opened.
 *
 * WHY. The proxy (`DshWebProxy`) binds `settings.port` INSIDE the Obsidian process,
 * so a leaked listener outlives the plugin instance and the next enable cannot bind
 * that port again: `EADDRINUSE` retried for ~20 s, "dsh 服务未能在端口 N 上启动",
 * plus a fresh dsh child spawned on every retry — the user had to restart Obsidian
 * to recover. Found in a real session (2026-09-26).
 *
 * The old code hung the whole cleanup off `this.service?.child !== null`, and the
 * child field is cleared the moment it exits (spawn error/exit handlers), so any
 * unload after a failed or externally-killed child skipped `stop()` entirely.
 *
 * WHAT IT ASSERTS (source shape, because the template runs only inside Obsidian and
 * cannot be imported by a gate):
 *   1. `onunload()` closes the proxy — directly, or by calling `service.stop()`
 *      (which does `await this.proxy.close()`);
 *   2. that release is not conditioned on `service.child` — the condition that made
 *      it silently skippable;
 *   3. `linkServer` is still stopped.
 *
 * Mutation check performed when it was written: putting the old
 * `if (this.service?.child !== null ...)` guard back turns assertion (2) red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const template = readFileSync(join(root, "obsidian", "main.template.js"), "utf8");

/** Body of a method, from its `name(` up to the next line that closes it at 2-space indent. */
function methodBody(name) {
  const at = template.indexOf(`  ${name}()`);
  if (at < 0) return null;
  const end = template.indexOf("\n  }", at);
  return end < 0 ? null : template.slice(at, end);
}

/**
 * Drop comment LINES before matching (never a `/*…*\/` span: a greedy block regex ate
 * the code between two comment blocks on the first attempt, which made this gate
 * report "no cleanup" on a correct tree).
 *
 * NOT optional here: the explanatory comment above `onunload`'s cleanup quotes the OLD
 * condition verbatim — that is how the reader learns why it was wrong — so matching raw
 * source made the gate fail on a correct tree. Both mistakes were caught while
 * mutation-testing it (the "normal" case was already red).
 */
function codeOnly(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

const problems = [];
const unloadRaw = methodBody("onunload");
const unload = unloadRaw === null ? null : codeOnly(unloadRaw);
if (unload === null) {
  problems.push("onunload() not found in obsidian/main.template.js");
} else {
  // `void service.proxy?.close?.()` — note the `?.` BEFORE the call, which an earlier
  // `/proxy\?*\.close\?*\(/` did not accept.
  const closesProxyDirectly = /service\s*\??\.\s*proxy\b[\s\S]{0,40}\.close/.test(unload);
  const stopsService = /service\s*\??\.\s*stop\b/.test(unload);
  if (!closesProxyDirectly && !stopsService) {
    problems.push("onunload() neither closes the proxy nor calls service.stop() — the listener on settings.port would outlive the plugin and break the next enable (EADDRINUSE)");
  }
  if (/service\s*\??\.\s*child\s*!==\s*null/.test(unload)) {
    problems.push("onunload() still gates its cleanup on `service.child !== null` — the child is cleared when it exits, so a failed/killed child skips the release entirely");
  }
  if (!/linkServer\s*\??\.\s*stop\b/.test(unload)) {
    problems.push("onunload() no longer stops the LinkServer");
  }
}

if (problems.length > 0) {
  console.error("\n" + problems.map((p) => " - " + p).join("\n"));
  console.error("\nSee docs/changelog.md 2026-09-26 (unload leak) for the reproduction.");
  process.exit(1);
}
console.log("plugin-unload check: ok (onunload releases the proxy and the link server, unconditionally)");
