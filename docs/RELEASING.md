# Releasing dsh-obsidian-math

This repository publishes the same system twice: as an **Obsidian community plugin** and as an **npm package** for DeepSeek Harness.

## 1. Prepare the release

```bash
npm test
node scripts/build-obsidian.mjs        # regenerate main.js from the template
node scripts/test-installer.mjs         # installer end-to-end test
```

Bump `version` in three places to the same value:

- `package.json`
- `manifest.json`
- (optionally) `versions.json` if you add one later

Commit and push to `main`.

## 2. Obsidian community plugin

### First-time submission

1. Create a GitHub release:
   - Tag: `1.0.0` (must equal `manifest.json` `version`);
   - Upload the three release assets built from the tag: `main.js`, `manifest.json`, `styles.css`.
2. Fork <https://github.com/obsidianmd/obsidian-releases>.
3. Add your plugin to `community-plugins.json`:

```json
{
  "id": "dsh-obsidian-math",
  "name": "DSH Obsidian Math Assistant",
  "author": "maple110011",
  "description": "Embeds the DeepSeek Harness math-memory agent in the right sidebar with automatic service management and layered long-term memory.",
  "repo": "maple110011/dsh-obsidian-math"
}
```

4. Open a pull request to `obsidianmd/obsidian-releases`. The submission checklist will validate the plugin id against the repository, the manifest fields, and the release assets.

### Every update

- Bump `manifest.json` `version`, build `main.js`, create a release with the same tag, and upload the three assets again. Obsidian updates users automatically.

## 3. npm package (dsh plugin)

```bash
npm publish
```

Users then install with:

```bash
npm install -g dsh-obsidian-math
dsh-obsidian-math install --vault "<vault dir>"
```

`postinstall` also runs a quiet `dsh-obsidian-math install` automatically, so
`dsh plugin --profile obsidian add dsh-obsidian-math` works as a one-liner.

## 4. Release checklist

- [ ] `node scripts/build-obsidian.mjs` ran and `main.js` is committed
- [ ] `npm test` passes
- [ ] `manifest.json` version == release tag == `package.json` version
- [ ] GitHub release has `main.js`, `manifest.json`, `styles.css` assets
- [ ] `obsidian-releases` PR opened (first submission) or release published (update)
- [ ] `npm publish` (dsh plugin)
