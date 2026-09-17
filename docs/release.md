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
#    ⚠️ 本机全绿 ≠ CI 全绿：认证握手套件在本机（装了 dsh）会真跑、在 CI 上按设计 SKIP；
#    Windows runner 检出的是 CRLF。推 tag 前先确认 ci.yml 的 ubuntu 与 windows 两个 job 都绿
#    （0.7.5 第一次推 tag 就栽在这两点上）。

# ⑤ 提交与打 tag（推送需要用户口令，见 §4）
git add -A && git commit -m "0.7.6: <一句话主题>"
git tag 0.7.6          # 注意：不带 v 前缀，release.yml 只匹配 [0-9]+.[0-9]+.[0-9]+
git push origin main
git push origin 0.7.6  # ← 这一步才会真正产出 Release
```

`npm-publish.yml` 在推 tag 时并行发布 npm 包。**认证走 trusted publishing（OIDC），不再用长效 token**：

- npm 正在废弃 2FA-bypass 的 granular token（[2026-07-08](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/) / [2026-07-31](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)）：这类 token 已不能做账号/包管理，**约 2027-01 起也不能直接发布**。
- **一次性配置（人工 + 2FA，自动化不了）**：npmjs.com → 包 `dsh-math-memory` → Settings → Trusted Publisher → GitHub Actions，填 `maple110011` / `dsh-obsidian-math` / **workflow 文件名 `npm-publish.yml`**（环境留空）。**workflow 名填错是最常见的失败原因。**
- workflow 侧：`permissions: id-token: write`（已有）、**不设 `NODE_AUTH_TOKEN`**、npm 必须 **≥ 11.5.1**（所以显式 `npm install -g npm@11`；Node 22 自带 npm 10）。**故意钉 11 不钉 12**：npm 12 打开了安装期安全默认值（依赖 lifecycle 脚本默认不跑，需 allowlist），会静默跳过 esbuild 的 `postinstall` 二进制下载。
- 失败时先看 `Registry / OIDC diagnostics` 那一步：它打印 npm 版本、是否拿到 `ACTIONS_ID_TOKEN_REQUEST_URL`、以及 `whoami` 的结果。**发布失败时同一份信息还会进 job summary 与一个 issue**（job 日志需要 admin 权限才能读，issue 不需要），其中包含 registry 的原话 + **本次实际出示的 OIDC claims**。
- **两种情况用错误码就能分辨**：`E404` = npm 上没有匹配的 trusted publisher（没配 / 仓库名或 workflow 文件名对不上）；`E403 OIDC permission denied for this action` = 配置**匹配到了**但某个 claim 不一致（最常见是 **environment**，或 workflow 文件名写成了全路径）。
- 本仓库的 workflow 实际出示的 claims（2026-09-11 实测，可作为比对基准）：

  ```
  repository        = maple110011/dsh-obsidian-math
  job_workflow_ref  = maple110011/dsh-obsidian-math/.github/workflows/npm-publish.yml@refs/tags/<tag>
  event_name        = push          ref_type = tag
  aud               = npm:registry.npmjs.org
  ```

  注意**没有 `environment` claim**（job 未声明 `environment:`），所以 npm 侧的 Environment 必须留空。
- **用 CLI 配置/核对（npm ≥ 11.10，需账号 2FA；每个包只允许一条配置）**：

  ```bash
  npm trust list dsh-math-memory --json          # 看现有的 file / repo / environment
  npm trust revoke --id <trust-id> dsh-math-memory   # 要改就得先撤销（一个包只允许一条）
  npm trust github dsh-math-memory --file npm-publish.yml \
      --repo maple110011/dsh-obsidian-math --yes   # 不带 --env 即要求无 environment
  ```

- 若 npm 侧只能选**分阶段发布**（staged publishing，需人工 2FA 批准后才公开），workflow 要改成 `npm stage publish`（需要 npm ≥ 11.16/12：可以放在 `npm ci` **之后**再升级 npm，避开 npm 12 的安装期默认值），并保留最后的人工批准步骤。这一步尚未实现——需要时再改。

## 2. 三个工作流各自的门禁

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `ci.yml` | push / PR | Ubuntu + Windows 双矩阵：`npm ci` → 版本一致性 → **Ubuntu 上**重建 `main.js` 并 `git diff --exit-code` → `npm test` |
| `release.yml` | 推 `x.y.z` tag | 版本一致性（含 tag）→ 重建 + diff 门禁 → `npm test` → 从 CHANGELOG 抽取**该版本**段落当 Release notes → 上传 `main.js` / `manifest.json` / `styles.css` / `versions.json` |
| `npm-publish.yml` | 推 `x.y.z` tag | 同上校验 → `npm publish --provenance`（OIDC，无 token）→ **按 registry 实际状态判定成败**（public 即成功并关闭历史失败 issue；missing 则打印 npm 原话 + OIDC claims、开 issue、判失败） |

**发布是否成功只由 registry 状态决定，不看 npm 的退出码**——「退出码/流水线在撒谎」的情况已经遇到过三种：

- **退出码 0 ≠ 已发布**：分阶段发布（staged publishing）上传后等人用 2FA 批准，此时公开 registry 上什么都没有，而 pipeline 会全绿（0.7.5 就出现过一次「全绿但 npm 上没有」）。
- **退出码非 0 ≠ 未发布**：重复推送同一个 tag 时 npm 报 `You cannot publish over the previously published versions`，而该版本其实早就在了（仓库为修发布链路反复移动过 0.7.5 tag）。现在这种情况算成功。
- **⚠️ 第三种：registry 的可见性有延迟（0.7.6 实测）**。`Publish` 步 success、日志里已有 `+ dsh-math-memory@0.7.6`，但下一步 `Confirm the registry state` 在 60 秒内查到的仍是 missing ⇒ 开 issue + 判红。实测 **约 60–80 秒**后 registry 才出现该版本。**处置：等一两分钟再 `Re-run failed jobs`**（`POST /actions/runs/<id>/rerun-failed-jobs`），第二次即可确认并自动关 issue。**不要据此改代码或版本号**。

历史教训（已修，勿回退）：

- Release 的 notes 曾是 `## [Unreleased]`——旧 `awk '/^## \[/{n++} n==1{print}'` 取的是第一个段落。
- 推 tag 的工作流曾**不跑任何测试**：任何能推 tag 的人都能从任意未验证提交发版。
- 版本号曾三方漂移（package 0.7.3 / manifest 0.7.4 / npm latest 0.7.1），
  于是「插件商店拿不到新版本」——见 §3。
- **本机全绿 ≠ CI 全绿（0.7.5 第一次推 tag 就栽在这上面）**：两个只在 CI 环境暴露的守卫缺陷——① `check-doc-consistency.mjs` 把「套件在本机 SKIP（没有 dsh）」当成失败；② 两个嵌入守卫用多行字面量解析文本，Windows runner 的 **CRLF** 检出让它们误报。修法见 `handoff.md` 坑 56/57。**推 tag 前先看一眼 `ci.yml` 的两个 job 是否都绿**（Ubuntu + Windows）。
- **`npm publish` 的失败信息为零，且 token 路线正在被废弃**：token 缺失/过期/无发布权/需要 2FA 都只有非零退出码。已改为 **trusted publishing（OIDC）**：workflow 不设 `NODE_AUTH_TOKEN`、显式 `npm install -g npm@11`（要求 ≥11.5.1，Node 22 自带 npm 10）、publish 前加只读诊断（npm 版本 / id-token 端点 / `whoami` / **解码后的 OIDC claims**）。**npm 侧一次性配置是人工动作**：包 Settings → Trusted Publisher → GitHub Actions 填仓库 + workflow 文件名 `npm-publish.yml`、**environment 留空**（job 未声明 environment，claims 里没有该字段 ⇒ 填了必然 403）。别再创建长效发布 token：2FA-bypass token 已失去账号/包管理能力，约 2027-01 起失去直接发布能力。**2026-09-11 实测全通**：`dsh-math-memory@0.7.5` 已发布并带 SLSA provenance 证明。
- **npm 12 的安装期安全默认值**（`allowScripts` 默认关、`--allow-git`/`--allow-remote` 默认 `none`）：本项目唯一带 lifecycle 脚本的依赖是 devDependency `esbuild`（`postinstall: node install.js`）。`npm ci` 仍会成功，但 **esbuild 的二进制不会下载**，于是 `npm run build:client` 会失败。因此发布工作流钉在 npm 11；将来升 12 时先跑 `npm approve-scripts --allow-scripts-pending` 并把 allowlist 提交进 `package.json`。
- **本地 registry 缓存会骗人**：排查期间通过本机代理查询 `registry.npmjs.org` 拿到的是**过期文档**（`modified` 时间戳停在旧日期、`/0.7.5` 返回 404），而包其实已经发布。判断「到底发出去没有」要用带 cache-buster 的直连查询，或者看 workflow 里那步 `Confirm the registry state` 的输出。

## 3. Obsidian 插件商店的更新通道

> **⚠️ 更正（2026-09-15）**：本节原标题是「为什么 Obsidian『插件商店』看不到新版本」，并断言「插件 id 不在 `community-plugins.json` 里 ⇒ 浏览里搜不到」。**那个判据已经作废**：实测该文件至今（2991 行）仍没有 `dsh-math-assistant`，但插件**已在架** —— Obsidian 的收录方式已改变，`community-plugins.json` 不再是收录依据。现行依据是插件在 [community.obsidian.md/plugins/dsh-math-assistant](https://community.obsidian.md/plugins/dsh-math-assistant) 有页面。**判断"上架没有"要查商店页面本身，不要查这个 JSON**（见 `handoff.md` 坑 78）。下面的"更新通道"部分仍然成立，它是**版本可见性**的机制，与收录方式无关。

更新通道只认一件事：**仓库里存在 tag 等于 `manifest.json` 版本的 Release**。插件在架、但版本页停在旧号的典型成因：

- `manifest.json` 的版本必须有一个**同号 tag 的 Release**；本地 git tag 曾停在 0.7.1、npm `latest` 也是 0.7.1，而 0.7.2–0.7.4 从未发过 tag ⇒ 用户端能拿到的最新版永远是 0.7.1。

结论：**发版 = 推 tag**，不是改版本号。改完版本号不推 tag，等于什么都没发生。

三条可用的分发路径：

1. **社区商店安装**（推荐，[商店页](https://community.obsidian.md/plugins/dsh-math-assistant)）：Obsidian → 设置 → 第三方插件 → 浏览 → 搜索 **DSH Math Notes Assistant**；更新随插件管理器走。
2. **手动安装**：下载 Release 的 `main.js` + `manifest.json` + `styles.css` 放进 `<vault>/.obsidian/plugins/dsh-math-assistant/`。
3. **BRAT**（Beta Reviewers Auto-update Tool）：填 `maple110011/dsh-obsidian-math`，它按 Release 的 `manifest.json` 版本自动更新——同样要求先推 tag。
4. **分发面**：上架后再改名/改 id 会被商店判为"新插件"，`manifest.json` 的 `id` 与 `scripts/check-plugin-id.mjs` 必须保持一致。（历史上曾通过向 `obsidianmd/obsidian-releases` 提 PR 在 `community-plugins.json` 追加条目来上架；该路径已不适用，仅作历史记录。）

## 4. 推送纪律

- `git push` / `git tag` 推送 / `npm publish` **必须等用户明确口令**，不要自行执行。
- 本地 `npm test` 全绿 + `check-version-consistency --tag <版本>` 通过，是请求口令前的最低门槛。
- 发版后回头核对三处：GitHub Releases 页面有该 tag、npm `npm view dsh-math-memory version`
  等于该版本、`docs/handoff.md` 记录本次发版。
