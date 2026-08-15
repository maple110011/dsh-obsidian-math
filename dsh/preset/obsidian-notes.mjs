/**
 * obsidian-notes — dedicated Obsidian note tools for the `obsidian` dsh agent
 * preset:
 *   - note_search  full-text / tag-filtered search across vault notes
 *   - note_create  create a new note; refuses to overwrite an existing one
 *   - note_links   backlink (wikilink) queries
 *
 * Registered through `defineTool` from @deepseek-ai/dsh-tools, following the
 * same pattern as the dsh-obsidian-assistant reference plugin. Every file
 * touch goes through the harness `ctx.fs` service so the profile's
 * workspace-write sandbox and fail-closed approval stay authoritative; no raw
 * Node fs bypass exists here.
 */
import { isAbsolute, join, resolve } from "node:path";

export const name = "obsidian-notes";
export const inject = ["tools", "fs", "systemPrompt", "loader"];

/**
 * Load `defineTool` without a static bare import. A local agent-preset plugin
 * lives under `$DSH_HOME/.agent-presets/obsidian/`, where Node's ordinary ESM
 * resolution cannot see the harness's `node_modules`; static
 * `import "@deepseek-ai/dsh-tools"` would fail for almost every user. The
 * harness loader resolves bare specifiers from the host composition instead
 * (the same mechanism preset rows like `@deepseek-ai/dsh-tool-fs` use), so we
 * ask it for the module once at apply time.
 */
async function loadDefineTool(ctx) {
  const internal = ctx.loader?.internal;
  if (typeof internal?.import === "function") {
    // The profile directory is the correct resolution anchor: app-boot heals
    // `$DSH_HOME/profiles/node_modules` with links to every dsh package, while
    // `ctx.loader.ctx.baseUrl` points at the preset directory and cannot see
    // `@deepseek-ai/dsh-tools`.
    const base = ctx.root?.baseUrl ?? ctx.loader?.ctx?.baseUrl ?? ctx.baseUrl;
    if (base === undefined) {
      throw new Error("obsidian-notes: cannot resolve the harness module base (ctx.root.baseUrl is unset)");
    }
    const module = await internal.import("@deepseek-ai/dsh-tools", base, {});
    if (typeof module.defineTool !== "function") {
      throw new Error("obsidian-notes: @deepseek-ai/dsh-tools did not export defineTool");
    }
    return module.defineTool;
  }
  // Bare-Node fallback (smoke tests): normal resolution from this file.
  const module = await import("@deepseek-ai/dsh-tools");
  if (typeof module.defineTool !== "function") {
    throw new Error("obsidian-notes: @deepseek-ai/dsh-tools did not export defineTool");
  }
  return module.defineTool;
}

const DEFAULT_MAX_RESULTS = 50;
const HARD_MAX_RESULTS = 200;
const DEFAULT_MAX_NOTE_BYTES = 1024 * 1024;
const DEFAULT_EXCLUDE_PATTERNS = [".obsidian", ".trash", ".git", "node_modules"];

function positiveInteger(value, fallback, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`obsidian-notes: ${label} must be a positive integer`);
  }
  return number;
}

function normalizeConfig(config) {
  const raw = config ?? {};
  return {
    vaultRoot: typeof raw.vaultRoot === "string" ? raw.vaultRoot.trim() : "",
    maxSearchResults: positiveInteger(raw.maxSearchResults, DEFAULT_MAX_RESULTS, "maxSearchResults"),
    maxNoteBytes: positiveInteger(raw.maxNoteBytes, DEFAULT_MAX_NOTE_BYTES, "maxNoteBytes"),
    excludePatterns: Array.isArray(raw.excludePatterns)
      ? raw.excludePatterns.filter((pattern) => typeof pattern === "string" && pattern.trim() !== "").map((pattern) => pattern.trim())
      : DEFAULT_EXCLUDE_PATTERNS
  };
}

// ── vault resolution ────────────────────────────────────────────────────────

/** Resolve the vault the tools act on: preset config, DSH_OBSIDIAN_VAULT, session cwd. */
function vaultRootFor(exec, config) {
  const fromConfig = config.vaultRoot;
  const fromEnv = (process.env.DSH_OBSIDIAN_VAULT ?? "").trim();
  const session = exec?.agent?.session;
  const cwd = typeof session?.header?.cwd === "string"
    ? session.header.cwd
    : typeof session?.cwd === "string" ? session.cwd : "";
  const raw = fromConfig || fromEnv || cwd;
  if (raw === "") {
    throw new Error("obsidian-notes: cannot determine the vault directory; set DSH_OBSIDIAN_VAULT or configure vaultRoot in the preset.");
  }
  if (!isAbsolute(raw)) {
    throw new Error(`obsidian-notes: vaultRoot must be an absolute path, got ${JSON.stringify(raw)}`);
  }
  return resolve(raw);
}

async function resolveVault(ctx, exec, config) {
  const rootPath = vaultRootFor(exec, config);
  const rootTarget = await ctx.fs.resolve(rootPath, { signal: exec?.signal });
  const info = await ctx.fs.stat(rootTarget, exec?.signal);
  if (info === undefined) throw new Error(`obsidian-notes: vault root not found: ${rootPath}`);
  if (info.type !== "directory") throw new Error(`obsidian-notes: vault root is not a directory: ${rootPath}`);
  return { rootPath, rootTarget };
}

function requireInsideVault(ctx, rootTarget, target) {
  if (!ctx.fs.contains(rootTarget, target)) {
    throw new Error(`obsidian-notes: path escapes the vault: ${target.displayPath}`);
  }
}

// ── exclusion glob (simple `*` wildcard, like the reference plugin) ──────────

function globMatch(pattern, value) {
  const pat = pattern.replace(/\\/g, "/");
  const val = value.replace(/\\/g, "/");
  if (!pat.includes("*")) return val === pat || val.startsWith(`${pat}/`);
  const expression = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${expression}$`).test(val);
}

function isExcluded(name, relDir, patterns) {
  const full = relDir === "" ? name : `${relDir}/${name}`;
  return patterns.some((pattern) => globMatch(pattern, name) || globMatch(pattern, full));
}

// ── note discovery / parsing ────────────────────────────────────────────────

async function listNotes(ctx, rootTarget, signal, excludePatterns) {
  const notes = [];
  const seenDirectories = new Set();

  async function walk(target, relDir) {
    if (seenDirectories.has(target.targetKey)) return; // symlink-cycle guard
    seenDirectories.add(target.targetKey);
    const entries = await ctx.fs.listDir(target, signal);
    for (const entry of entries) {
      if (entry.type === "directory") {
        if (isExcluded(entry.name, relDir, excludePatterns)) continue;
        if (!ctx.fs.contains(rootTarget, entry.target)) continue;
        await walk(entry.target, relDir === "" ? entry.name : `${relDir}/${entry.name}`);
      } else if (entry.type === "file" && entry.name.toLowerCase().endsWith(".md")) {
        if (isExcluded(entry.name, relDir, excludePatterns)) continue;
        if (!ctx.fs.contains(rootTarget, entry.target)) continue;
        const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
        notes.push({ path: rel, name: rel.slice(0, -3), target: entry.target });
      }
    }
  }

  await walk(rootTarget, "");
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes;
}

/** Split leading YAML frontmatter from the note body. */
function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { frontmatter: null, body: raw };
  const close = raw.indexOf("\n---", 3);
  if (close < 0) return { frontmatter: null, body: raw };
  const frontmatter = raw.slice(3, close).replace(/^\r?\n/, "");
  const body = raw.slice(close + 4).replace(/^\r?\n/, "");
  return { frontmatter, body };
}

function cleanTagToken(token) {
  return token.trim().replace(/^['"]|['"]$/g, "").replace(/^#+/, "");
}

/** Extract `tags:` from YAML-ish frontmatter (inline list, flow list, or `-` list). */
function frontmatterTags(text) {
  if (text === null) return [];
  const tags = [];
  const lines = text.split(/\r?\n/);
  let inTagList = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (inTagList) {
      const item = /^\s+-\s+(.+)$/.exec(line);
      if (item !== null) {
        tags.push(cleanTagToken(item[1]));
        continue;
      }
      inTagList = false;
    }
    const key = /^tags:\s*(.*)$/.exec(line);
    if (key === null) continue;
    const value = key[1].trim();
    if (value === "") {
      inTagList = true;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      for (const item of value.slice(1, -1).split(",")) {
        const token = cleanTagToken(item);
        if (token !== "") tags.push(token);
      }
    } else {
      for (const item of value.split(/[\s,]+/)) {
        const token = cleanTagToken(item);
        if (token !== "") tags.push(token);
      }
    }
  }
  return tags;
}

/** Extract inline `#tag` occurrences (never `# heading`). */
function inlineTags(body) {
  const tags = [];
  const expression = /(?:^|[\s([{])#([A-Za-z0-9_\-/]+)/g;
  let match;
  while ((match = expression.exec(body)) !== null) tags.push(match[1]);
  return tags;
}

function noteTags(note) {
  const seen = new Set();
  const tags = [];
  for (const raw of [...frontmatterTags(note.frontmatter), ...inlineTags(note.body)]) {
    const tag = raw.replace(/^#+/, "");
    const key = tag.toLowerCase();
    if (tag === "" || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function normalizeTagFilter(raw) {
  return String(raw ?? "").trim().replace(/^#+/, "").toLowerCase().replace(/^\/+|\/+$/g, "");
}

function matchesTagFilter(tags, filter) {
  return tags.some((tag) => {
    const normalized = tag.toLowerCase();
    return normalized === filter || normalized.endsWith(`/${filter}`);
  });
}

function makeSnippet(haystack, index, matchLength) {
  const start = Math.max(0, index - 60);
  const end = Math.min(haystack.length, index + matchLength + 120);
  return `${start > 0 ? "…" : ""}${haystack.slice(start, end).replace(/\s+/g, " ").trim()}${end < haystack.length ? "…" : ""}`;
}

/** Wikilinks, including embeds and heading/anchor suffixes. */
function extractWikiLinks(raw) {
  const links = new Set();
  const expression = /!?\[\[([^\[\]|#]+)(?:#[^\]\[]*)?(?:\|[^\]\[]*)?\]\]/g;
  let match;
  while ((match = expression.exec(raw)) !== null) {
    const target = match[1].trim().replace(/\.md$/i, "");
    if (target !== "") links.add(target);
  }
  return [...links];
}

function normalizeNoteRelPath(input) {
  const rawInput = String(input).trim();
  if (rawInput.includes("\u0000")) throw new Error("obsidian-notes: note path contains a NUL byte");
  if (isAbsolute(rawInput) || /^[A-Za-z]:[\\/]/.test(rawInput)) {
    throw new Error(`obsidian-notes: note path must be vault-relative, got ${JSON.stringify(rawInput)}`);
  }
  let rel = rawInput.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (rel.startsWith("/")) rel = rel.replace(/^\/+/, "");
  if (rel === "" || rel === "." || rel.endsWith("/")) {
    throw new Error(`obsidian-notes: invalid note path ${JSON.stringify(rawInput)}`);
  }
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.includes(":"))) {
    throw new Error(`obsidian-notes: note path escapes the vault or is invalid: ${JSON.stringify(rawInput)}`);
  }
  if (!rel.toLowerCase().endsWith(".md")) rel += ".md";
  return rel;
}

const OVERWRITE_REFUSAL = (rel) => `note_create: note already exists (${rel}); refusing to overwrite. Read it and use edit/write only when the user explicitly asks to change the existing note.`;

// ── cordis plugin ────────────────────────────────────────────────────────────

export async function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  const defineTool = await loadDefineTool(ctx);

  ctx.systemPrompt.section({
    name: "tool:obsidian-notes",
    order: 103,
    text:
      "Use the dedicated Obsidian note tools for note-level operations: note_search (text and/or tag filter, better than raw grep for \"find my notes\"), " +
      "note_create (new note only — it refuses to overwrite an existing note), and note_links (which notes link to a note). " +
      "For ordinary file read/write/edit/glob/grep inside the vault keep using the generic file tools."
  });

  // ── note_search ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_search",
    description: `Search the Obsidian vault for markdown notes whose title or body contains a query string, optionally filtered by a tag. Returns up to ${DEFAULT_MAX_RESULTS} matches by default, each with vault-relative path, title, tags, and a text snippet. Prefer this over raw grep when the user asks to find notes by topic, keyword, or tag.`,
    parameters: {
      query: { type: "string", description: "Case-insensitive substring matched against note titles and bodies. Omit to search by tag only." },
      tag: { type: "string", description: "Optional tag filter without leading '#' (e.g. \"analysis\" also matches nested tag \"math/analysis\")." },
      maxResults: { type: "integer", description: `Optional cap on matches; defaults to ${DEFAULT_MAX_RESULTS}, maximum ${HARD_MAX_RESULTS}.` }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", required: true },
                title: { type: "string", required: true },
                snippet: { type: "string", required: true },
                tags: { type: "array", required: true, items: { type: "string" } }
              }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.matches.length === 0
          ? "No matching notes found."
          : value.matches.map((match) => `- ${match.title} (${match.path})${match.tags.length > 0 ? ` [${match.tags.join(", ")}]` : ""}\n  ${match.snippet}`).join("\n")
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { rootTarget } = await resolveVault(ctx, exec, cfg);
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const tag = normalizeTagFilter(args.tag);
      if (query === "" && tag === "") {
        throw new Error("note_search: provide query, tag, or both");
      }
      const requested = Number(args.maxResults ?? cfg.maxSearchResults);
      if (!Number.isInteger(requested) || requested < 1) {
        throw new Error(`note_search: maxResults must be a positive integer`);
      }
      const limit = Math.min(requested, HARD_MAX_RESULTS);

      const notes = await listNotes(ctx, rootTarget, exec?.signal, cfg.excludePatterns);
      const matches = [];
      for (const note of notes) {
        if (matches.length >= limit) break;
        let raw;
        try {
          raw = await ctx.fs.readText(note.target, exec?.signal);
        } catch {
          continue; // unreadable note is skipped, not a search failure
        }
        const { frontmatter, body } = splitFrontmatter(raw);
        const tags = noteTags({ frontmatter, body });
        if (tag !== "" && !matchesTagFilter(tags, tag)) continue;
        if (query !== "") {
          const haystack = `${note.name}\n${raw}`;
          const lower = haystack.toLowerCase();
          const index = lower.indexOf(query);
          if (index < 0) continue;
          matches.push({
            path: note.path,
            title: note.name,
            snippet: makeSnippet(haystack, index, query.length),
            tags
          });
        } else {
          matches.push({
            path: note.path,
            title: note.name,
            snippet: makeSnippet(body, 0, 0),
            tags
          });
        }
      }
      return { matches };
    },
    presentCall: (args) => ({ card: "generic", title: "Search notes", kind: "search", rawInput: args.query ?? args.tag })
  }));

  // ── note_create ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_create",
    description: `Create a new markdown note in the Obsidian vault at the given vault-relative path. The full markdown (including any frontmatter) is written exactly as provided. This tool refuses to overwrite an existing note and has no overwrite flag; to change an existing note, use read + edit/write after the user asks for it.`,
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative path for the new note, with or without the \".md\" extension." },
      content: { type: "string", required: true, description: "Full markdown content of the note, including any YAML frontmatter you want at the top." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          operation: { type: "string", required: true, enum: ["create"] }
        }
      },
      render: (_args, value) => [{ type: "text", text: `Created note: ${value.path}` }]
    },
    async execute(args, exec) {
      const { rootPath, rootTarget } = await resolveVault(ctx, exec, cfg);
      const rel = normalizeNoteRelPath(args.path);
      const bytes = Buffer.byteLength(args.content, "utf8");
      if (bytes > cfg.maxNoteBytes) {
        throw new Error(`note_create: note is ${bytes} bytes; maximum is ${cfg.maxNoteBytes} bytes`);
      }
      const target = await ctx.fs.resolve(join(rootPath, ...rel.split("/")), { signal: exec?.signal });
      requireInsideVault(ctx, rootTarget, target);

      const existing = await ctx.fs.stat(target, exec?.signal);
      if (existing !== undefined) throw new Error(OVERWRITE_REFUSAL(rel));

      let outcome;
      try {
        outcome = await ctx.fs.writeText(target, args.content, { kind: "createIfAbsent" }, exec?.signal);
      } catch (error) {
        if (error?.code === "FS_NOT_OBSERVED") throw new Error(OVERWRITE_REFUSAL(rel));
        throw error;
      }
      ctx.emit("fs/observed", target, { kind: "present", version: outcome.version }, exec);
      return { path: rel, operation: "create" };
    },
    presentCall: (args) => ({
      card: "diff",
      title: `Create note ${args.path}`,
      diffs: [{ path: args.path, oldText: null, newText: args.content }]
    })
  }));

  // ── note_links ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "note_links",
    description: `Query wikilink backlinks in the Obsidian vault: which notes link TO a note. Pass a note name (with or without the ".md" extension) to see only its incoming links; omit the argument to return the full note-name -> linking-notes map.`,
    parameters: {
      note: { type: "string", description: "Optional note name or vault-relative path (extension optional) to filter backlinks to." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          queried: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
          exists: { type: "boolean", required: true },
          backlinks: { type: "json", required: true },
          total: { type: "integer", required: true }
        }
      },
      render: (_args, value) => {
        const entries = Object.entries(value.backlinks ?? {});
        const lines = entries.map(([target, sources]) => `- ${target} ← ${sources.join(", ")}`);
        if (value.queried !== null) {
          if (!value.exists) return [{ type: "text", text: `No note found: ${value.queried}` }];
          return [{
            type: "text",
            text: `Backlinks for ${value.queried} (${value.total}):\n${lines.join("\n") || "（none）"}`
          }];
        }
        return [{
          type: "text",
          text: `Backlink map across vault (${value.total} links):\n${lines.join("\n") || "（none）"}`
        }];
      }
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { rootTarget } = await resolveVault(ctx, exec, cfg);
      const notes = await listNotes(ctx, rootTarget, exec?.signal, cfg.excludePatterns);

      const backlinks = new Map();
      const noteNames = new Map();
      const notePaths = new Map();
      for (const note of notes) {
        noteNames.set(note.name.toLowerCase(), note.name);
        notePaths.set(note.path.toLowerCase().replace(/\.md$/i, ""), note.name);
      }
      for (const note of notes) {
        let raw;
        try {
          raw = await ctx.fs.readText(note.target, exec?.signal);
        } catch {
          continue;
        }
        for (const target of extractWikiLinks(raw)) {
          const sources = backlinks.get(target) ?? [];
          if (!sources.some((source) => source.toLowerCase() === note.name.toLowerCase())) sources.push(note.name);
          backlinks.set(target, sources);
        }
      }
      for (const sources of backlinks.values()) sources.sort((a, b) => a.localeCompare(b));

      const requested = typeof args.note === "string" ? args.note.trim().replace(/\.md$/i, "") : "";
      if (requested === "") {
        const all = Object.fromEntries([...backlinks.entries()].sort(([a], [b]) => a.localeCompare(b)));
        const total = Object.values(all).reduce((sum, sources) => sum + sources.length, 0);
        return { queried: null, exists: true, backlinks: all, total };
      }

      const requestedLower = requested.toLowerCase();
      const exactKey = [...backlinks.keys()].find((key) => key.toLowerCase() === requestedLower);
      const suffixKey = [...backlinks.keys()].find((key) => key.toLowerCase().endsWith(`/${requestedLower}`));
      const key = exactKey ?? suffixKey;
      const noteName = notePaths.get(requestedLower) ?? noteNames.get(requestedLower);
      if (key !== undefined) {
        const sources = backlinks.get(key) ?? [];
        return { queried: key, exists: true, backlinks: { [key]: sources }, total: sources.length };
      }
      if (noteName !== undefined) {
        return { queried: noteName, exists: true, backlinks: { [noteName]: [] }, total: 0 };
      }
      return { queried: requested, exists: false, backlinks: { [requested]: [] }, total: 0 };
    },
    presentCall: (args) => ({ card: "generic", title: "Query backlinks", kind: "search", rawInput: args.note ?? "(all)" })
  }));
}
