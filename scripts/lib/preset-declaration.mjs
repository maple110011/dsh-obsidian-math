/**
 * scripts/lib/preset-declaration.mjs — build the agent-preset declaration from
 * the preset's own composition.
 *
 * Why this module exists
 * ----------------------
 * dsh 0.1.7 removed directory-based agent presets: `$DSH_HOME/.agent-presets/`
 * is no longer read, and a preset is now an ordinary Cordis row
 * (`name: '@deepseek-ai/dsh-agent-preset'`) whose `config.plugins` holds the
 * preset's composition. Our preset therefore has to be DECLARED in a patch
 * layer, in BOTH delivery channels (the npm bundle patch and the Obsidian
 * plugin's `--patch` overlay).
 *
 * Declaring it means embedding `dsh/preset/agent.cordis.yml` inside a YAML
 * block — i.e. duplicating the composition in text. Rather than hand-copy it
 * (two sources of truth that drift silently, which this repo has paid for more
 * than once), the block is GENERATED from the composition by
 * `scripts/build-preset-declaration.mjs` and committed; that script's `--check`
 * mode (gate `check: preset declaration is current`) re-generates the block and
 * fails on any drift, and `scripts/check-preset-body-lists.mjs` pins which name
 * form each channel must carry.
 *
 * Two facts this shape depends on, both measured on dsh 0.1.7-rc.2
 * (`.scratch-p0-preset-probe.md` §1/§2, `docs/dsh-0.1.7-adaptation.md` §4.1):
 *
 *   1. The registry resolves a relative row `name:` against the ctx `baseUrl`
 *      of the REGISTRY row — i.e. the PROFILE DIRECTORY — not against the patch
 *      file's directory. Its `register()` captures `this.ctx` (the registry
 *      service's own context), so `./math-memory.mjs` means
 *      `$DSH_HOME/profiles/<profile>/math-memory.mjs`. Hence the preset body
 *      files must be staged INTO the profile directory, and the relative names
 *      below stay relative.
 *   2. A missing/failed module does NOT surface as `ERR_MODULE_NOT_FOUND`: the
 *      loader logs the real error and returns without creating a fiber, so the
 *      preset audit only says `… (./x.mjs): never started`. Gate on
 *      `agentPresets/list` + `session/create`, never on error text.
 */

/**
 * Marker lines that wrap the generated block inside every patch file. Exported so
 * the writer (`build-preset-declaration.mjs`) and the reader
 * (`check-preset-body-lists.mjs`) cannot disagree about where the block is.
 */
export const DECLARATION_BEGIN = '# >>> GENERATED agent-preset declaration (scripts/build-preset-declaration.mjs) >>>';
export const DECLARATION_END = '# <<< END GENERATED agent-preset declaration <<<';

/** Indent one block of text by `spaces`. Blank lines stay blank. */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
}

/** Strip the leading comment block and blank lines from a composition document. */
function compositionRows(compositionText) {
  const lines = compositionText.replace(/\r\n/g, '\n').split('\n');
  const firstRow = lines.findIndex((line) => /^-\s/.test(line));
  if (firstRow < 0) throw new Error('agent.cordis.yml holds no top-level row (`- id: …`)');
  return lines.slice(firstRow).join('\n').replace(/\s*$/, '');
}

/** Read the single-line display scalars of `preset.yml`. */
export function readPresetMetadata(text) {
  const meta = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^(name|description|order):\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, raw] = match;
    meta[key] = key === 'order' ? Number(raw) : raw;
  }
  if (typeof meta.name !== 'string' || meta.name === '') {
    throw new Error('preset.yml must declare a non-empty `name`');
  }
  return meta;
}

/**
 * Rewrite every local row name (`name: ./x.mjs`) so it is reached as a subpath
 * of `prefix` instead. Used for the npm bundle channel, where the preset's
 * modules come from the INSTALLED PACKAGE rather than from the profile
 * directory — see the channel note in {@link buildPresetDeclarationBlock}.
 */
function rewriteLocalNames(rows, prefix) {
  return rows.replace(
    /^(\s*)name:\s*\.\/([A-Za-z0-9._/-]+)\s*$/gm,
    (_, indent, file) => `${indent}name: ${prefix}/${file}`
  );
}

/**
 * The `- insert:` block that declares the preset, ready to append to a profile
 * patch layer.
 *
 * TWO NAME FORMS, ONE COMPOSITION. dsh resolves a preset's row names against the
 * PROFILE DIRECTORY, so where the modules live decides how they must be named:
 *
 *   · `localPrefix = null` (Obsidian / `--direct` overlay) keeps `./x.mjs`, and
 *     the caller must stage those files into the profile directory BEFORE dsh
 *     boots (the plugin's bootstrap and `install --direct` both do).
 *   · `localPrefix = '<pkg>/dsh/preset'` (npm bundle channel) names the module as
 *     a subpath of the installed package. Measured 2026-09-26: this needs NO
 *     staging, and that matters — the bundle's host row cannot stage the body
 *     early enough on a COLD first boot, because the registry mounts the preset
 *     while the host row is still importing. The relative form won a second boot
 *     and lost the first (`broken: "math-memory (./math-memory.mjs): never
 *     started"`), which is exactly the "clicked New chat, nothing happened"
 *     symptom. The subpath form has no such race: nothing has to exist first.
 *
 * @param {{id: string, compositionText: string, presetYmlText: string, localPrefix?: string|null}} input
 * @returns {string} YAML text, newline-terminated.
 */
export function buildPresetDeclarationBlock({ id, compositionText, presetYmlText, localPrefix = null }) {
  const meta = readPresetMetadata(presetYmlText);
  const composed = compositionRows(compositionText);
  const rows = localPrefix === null ? composed : rewriteLocalNames(composed, localPrefix);

  const header = [
    `  - id: preset-${id}`,
    `    name: '@deepseek-ai/dsh-agent-preset'`,
    `    config:`,
    `      id: ${id}`,
    `      name: ${JSON.stringify(meta.name)}`,
    meta.description === undefined ? null : `      description: ${JSON.stringify(meta.description)}`,
    meta.order === undefined ? null : `      order: ${meta.order}`,
    `      plugins:`
  ].filter((line) => line !== null).join('\n');

  const shape = localPrefix === null
    ? [
        "# presets are gone). This copy keeps the preset's modules as `./name` rows:",
        '# the registry resolves those against the PROFILE DIRECTORY, so the caller',
        '# stages them there before dsh boots (bootstrap / `install --direct`).'
      ]
    : [
        "# presets are gone). This copy names the preset's modules as SUBPATHS OF THE",
        `# INSTALLED PACKAGE (\`${localPrefix}/…\`), because a bundle row cannot stage files`,
        '# into the profile directory early enough on a cold first boot — the registry',
        '# mounts the preset while the host row is still importing (measured 2026-09-26).'
      ];

  return [
    '# ⚠️ GENERATED from dsh/preset/agent.cordis.yml + preset.yml — do not edit by hand.',
    '# Regenerate with: node scripts/build-preset-declaration.mjs',
    '#',
    '# dsh 0.1.7 declares agent presets as ordinary Cordis rows (directory-based',
    ...shape,
    '#',
    '# Both channels are generated from ONE composition; scripts/check-preset-body-lists.mjs',
    '# fails when a form drifts.',
    '- insert:',
    header,
    indent(rows, 6)
  ].join('\n') + '\n';
}
