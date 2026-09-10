# 发布手册（Release Runbook）

> 目标读者：维护者本人。**一次发版只改一个数字，其余全部由守卫自动校验**；
> 任何一步跳过都会在 CI 或用户端以「版本拿不到」的形式暴露出来。

## 0. 两个产物，一个版本号

| 产物 | 渠道 | 由谁取用 | 版本号来源 |
|---|---|---|---|
| Obsidian 插件 | GitHub Release（tag = 版本号） | 用户手动安装 / BRAT / 社区商店 | `manifest.json` |
| npm 包 `dsh-math-memory` | npm registry | `dsh plugin add` / `dsh/install.mjs` | `package.json` |

两者必须同号：用户可能一边用 npm 装的 preset，一边用 Release 装的插件。
`scripts/check-version-consistency.mjs` 强制下面 **五个**位置一致：

1. `package.json` → `version`
2. `manifest.json` → `version`（必须是纯 `x.y.z`，Obsidian 社区注册表拒绝预发布号）
3. `package-lock.json` → `version`（跑一次 `npm install` 刷新）
4. `versions.json` → 新增一条 `"<版本>": "<minAppVersion>"`
5. `CHANGELOG.md` → 最新的非 `[Unreleased]` 标题 `## [<版本>] - YYYY-MM-DD`

带 tag 时（`--tag 0.7.5`）还会额外要求 **tag 字符串 === 版本号**。

## 1. 发版步骤

```bash
# ① 版本号（4 个文件）+ versions.json 新条目
#    package.json / package-lock.json（两处：根与 packages[""]）/ manifest.json
#    versions.json: {"0.7.6": "1.4.0", ...}   ← 只增行，不删旧行

# ② CHANGELOG.md：把 [Unreleased] 攒的内容改成
#    ## [0.7.6] - YYYY-MM-DD，并在顶部留一个空的 [Unreleased]

# ③ 重新生成被提交的产物（CI 有 rebuild + git diff 门禁，忘了必红）
node scripts/build-obsidian.mjs      # obsidian/main.template.js → main.js
node dsh/client-panel/build-client.mjs   # src/index.jsx → lib/client.js（改了面板才需要）

# ④ 本地过一遍与 CI 完全相同的门禁
npm test
node scripts/check-version-consistency.mjs --tag 0.7.6

# ⑤ 提交与打 tag（推送需要用户口令，见 §4）
git add -A && git commit -m "0.7.6: <一句话主题>"
git tag 0.7.6          # 注意：不带 v 前缀，release.yml 只匹配 [0-9]+.[0-9]+.[0-9]+
git push origin main
git push origin 0.7.6  # ← 这一步才会真正产出 Release
```

`npm-publish.yml` 在推 tag 时并行发布 npm 包（`npm publish --provenance`，
需要 `id-token: write` 权限与 npm 的 trusted publishing 配置）。

## 2. 三个工作流各自的门禁

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | push / PR | Ubuntu + Windows 双矩阵：`npm ci` → 版本一致性 → **Ubuntu 上**重建 `main.js` 并 `git diff --exit-code` → `npm test` |
| `release.yml` | 推 `x.y.z` tag | 版本一致性（含 tag）→ 重建 + diff 门禁 → `npm test` → 从 CHANGELOG 抽取**该版本**段落当 Release notes → 上传 `main.js` / `manifest.json` / `styles.css` / `versions.json` |
| `npm-publish.yml` | 推 `x.y.z` tag | 同上校验 → `npm publish --provenance` |

历史教训（已修，勿回退）：

- Release 的 notes 曾是 `## [Unreleased]`——旧 `awk '/^## \[/{n++} n==1{print}'` 取的是第一个段落。
- 推 tag 的工作流曾**不跑任何测试**：任何能推 tag 的人都能从任意未验证提交发版。
- 版本号曾三方漂移（package 0.7.3 / manifest 0.7.4 / npm latest 0.7.1），
  于是「插件商店拿不到新版本」——见 §3。

## 3. 为什么 Obsidian「插件商店」看不到新版本

Obsidian 的插件更新只认两件事：**社区注册表里的条目** + **仓库里 tag 等于
`manifest.json` 版本的 Release**。本插件的实际情况：

- 插件 id `dsh-math-assistant` **不在** `obsidianmd/obsidian-releases` 的
  `community-plugins.json` 里（该文件 7459 条；里面确实有若干其他 DSH 插件，
  但没有本插件）⇒ 在 Obsidian 的「浏览」里搜不到，也就没有自动更新通道。
- 即使已上架，`manifest.json` 的版本必须有一个**同号 tag 的 Release**；
  本地 git tag 停在 0.7.1、npm `latest` 也是 0.7.1，而 0.7.2–0.7.4 从未发过 tag。
  所以用户端能拿到的最新版永远是 0.7.1。

结论：**发版 = 推 tag**，不是改版本号。改完版本号不推 tag，等于什么都没发生。

三条可用的分发路径：

1. **手动安装**（当前推荐，README 已写明）：下载 Release 的 `main.js` +
   `manifest.json` + `styles.css` 放进 `<vault>/.obsidian/plugins/dsh-math-assistant/`。
2. **BRAT**（Beta Reviewers Auto-update Tool）：填 `maple110011/dsh-obsidian-math`，
   它按 Release 的 `manifest.json` 版本自动更新——同样要求先推 tag。
3. **上架社区商店**：向 `obsidianmd/obsidian-releases` 提 PR，在
   `community-plugins.json` 末尾加 `{"id":"dsh-math-assistant","name":"DSH Math Assistant","author":"maple110011","description":"…","repo":"maple110011/dsh-obsidian-math"}`。
   前置条件：仓库根目录有 `README.md`、`LICENSE`、`manifest.json`/`versions.json` 合规、
   Release 里带 `main.js`+`manifest.json`+`styles.css`，且**已有一个正式版本 tag**。
   ⚠️ 上架后再改名/改 id 会被商店判为"新插件"，`manifest.json` 的 `id` 与
   `scripts/check-plugin-id.mjs` 必须保持一致。

## 4. 推送纪律

- `git push` / `git tag` 推送 / `npm publish` **必须等用户明确口令**，不要自行执行。
- 本地 `npm test` 全绿 + `check-version-consistency --tag <版本>` 通过，是请求口令前的最低门槛。
- 发版后回头核对三处：GitHub Releases 页面有该 tag、npm `npm view dsh-math-memory version`
  等于该版本、`docs/memory/handoff.md` 记录本次发版。
