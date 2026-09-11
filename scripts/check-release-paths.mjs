/**
 * check-release-paths — the PUBLISHED surface carries no maintainer-local paths,
 * and the published set cannot grow by accident.
 *
 * Why this guard exists
 * ---------------------
 * A review reported "maintainer-local paths left in release artifacts". The
 * concrete instance was `scripts/deploy-local.mjs`, which hardcodes
 * `C:/Users/<name>/.dsh` — but that file is gitignored AND `package.json`'s
 * `files` publishes only `dsh/` + three root files, and the GitHub release
 * uploads only the Obsidian trio. So the leak was not reachable **as long as
 * nothing changes those lists** — which is exactly the kind of safety that
 * quietly disappears when someone adds a directory to `files` to "make the
 * scripts available".
 *
 * This guard therefore pins BOTH halves:
 *
 * 1. **the published set is pinned** (`EXPECTED_FILES`). Adding a path is a
 *    deliberate act that requires editing this guard with a reason — the same
 *    "pin the inventory" discipline as `check-engine-sync.mjs`. A gitignored,
 *    machine-specific file can only ever ship through this list.
 * 2. **the published surface is scanned** for this machine's own identifiers
 *    (`os.homedir()`, the login name as a path segment) and for absolute
 *    home/drive paths in general.
 *
 * Both halves are needed: (1) without (2) misses a path that is legitimately
 * published; (2) without (1) misses the file that is not published *yet*.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// ── 1. the published set is pinned ──────────────────────────────────────────
// `dsh/` is the npm artifact; the three root files are the documented READMEs
// and the license. The Obsidian artifact (main.js / manifest.json / styles.css)
// is attached to the GitHub release instead, and is scanned below.
const EXPECTED_FILES = ["dsh/", "README.md", "README.zh.md", "LICENSE"];
const files = pkg.files ?? [];
const setMatches = files.length === EXPECTED_FILES.length
  && EXPECTED_FILES.every((f) => files.includes(f));

// ── 2. scan the published surface ───────────────────────────────────────────
const published = [];
const collect = (abs) => {
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      collect(join(abs, entry.name));
    }
  } else {
    published.push(abs);
  }
};
for (const entry of files) {
  try {
    collect(join(root, entry.replace(/\/$/, "")));
  } catch {
    // A `files` entry that does not exist is npm's problem, not this guard's.
  }
}
// Always attached to the GitHub release (see .github/workflows/release.yml).
for (const rel of ["main.js", "manifest.json", "styles.css"]) {
  const abs = join(root, rel);
  try {
    statSync(abs);
    published.push(abs);
  } catch {
    // styles.css/manifest.json are small and always present; ignore if absent.
  }
}

const home = homedir();
const user = userInfo().username;
const detectors = [
  [new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "this machine's home directory"],
  [home.replace(/\\/g, "/") === home ? null : new RegExp(home.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "this machine's home directory (forward slashes)"]
].filter(([re]) => re !== null);
// The login name only counts as a leak when it appears as a PATH SEGMENT, so a
// README that happens to contain the word "user" is not a finding.
const userSegments = [
  new RegExp(`[/\\\\]${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[/\\\\]`, "i"),
  new RegExp(`[/\\\\]${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
];
const generic = [
  /[A-Za-z]:[\\/]{1,2}(?:Users|Documents|Desktop|Downloads|projects|software|src)[\\/]/i,
  /(?:^|[^A-Za-z0-9])(?:\/home|\/Users)\/[A-Za-z0-9._-]+\//,
  // A CONCRETE drive-letter path: `D:\Obsidian笔记数据库`. Placeholders are fine
  // — the point of this rule is that a reader must not be shown a path that
  // looks like somebody's actual machine. `<…>`, `$VAR`, `%VAR%` and `…` mark a
  // placeholder; anything else after `X:\` is treated as a real path.
  //
  // This rule exists because the first version of this guard MISSED the README
  // install example (`--vault "D:\\Obsidian笔记数据库"`): the previous patterns
  // only knew common English directory names, so a drive letter followed by a
  // non-English segment sailed through. `D:` is not in any list — it does not
  // need to be.
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/](?![<${%*…])/
];

// Prose and code comments may legitimately DOCUMENT a layout (a comment saying
// "put it under <dir>" is not a leak). What must never appear is a real absolute
// path, so the detectors run against every line and report the match itself.
let failed = 0;
const fail = (msg) => { console.log(`[FAIL] ${msg}`); failed += 1; };

if (!setMatches) {
  fail(`package.json \`files\` changed: expected ${JSON.stringify(EXPECTED_FILES)}, got ${JSON.stringify(files)}.\n`
    + "       If the new entry is intended, add it to EXPECTED_FILES here with a reason — and make sure it cannot\n"
    + "       contain machine-specific files (see .gitignore: scripts/deploy-local.mjs is one).");
}
if (files.some((f) => f === "scripts/" || f.startsWith("scripts/"))) {
  fail("`scripts/` is in package.json `files` — it contains gitignored, machine-specific helpers (deploy-local.mjs)");
}

let scanned = 0;
for (const file of published) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|zip|gz)$/i.test(rel)) continue;
  scanned += 1;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const [re, label] of detectors) {
      if (re.test(line)) fail(`${rel}:${i + 1}: contains ${label}: ${line.trim().slice(0, 120)}`);
    }
    for (const re of userSegments) {
      if (re.test(line)) fail(`${rel}:${i + 1}: contains the login name as a path segment: ${line.trim().slice(0, 120)}`);
    }
    for (const re of generic) {
      if (re.test(line)) fail(`${rel}:${i + 1}: contains an absolute local path: ${line.trim().slice(0, 120)}`);
    }
  }
}

// A guard that scans nothing must not report success.
if (scanned < 10) fail(`scanned only ${scanned} published files — the walk is broken, not the artifacts`);

if (failed > 0) {
  console.log(`\n${failed} release-artifact problem(s). Published surface = package.json \`files\` + the Obsidian trio.`);
  process.exit(1);
}
console.log(`release-paths: ok (published set pinned to ${EXPECTED_FILES.length} entries; ${scanned} shipped files scanned for local paths)`);
