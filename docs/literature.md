# 文献库架构（Literature Library）

> 目标：把「论文 PDF + MinerU 全文 markdown + Zotero BibTeX」整理成一个 **agent 可读、人类可看** 的文献库，并让研读成果能回流到 vault 记忆系统。全部为 markdown / JSON / BibTeX 文件，无数据库，延续本项目「持久状态都是文件」的哲学。
> 位置：本仓库 `literature/`（agent 在仓库内直接维护这一区域；研读产出回流到 vault 记忆系统）。
> 施行入口：`scripts/lit-import.mjs`（已用真实语料跑通，见 §7）。

## 1. 设计原则

1. **citekey 是唯一 ID**：BibTeX key（如 `gaoLeanSearchV2Global2026`）贯穿目录、卡片、原始语料、索引，杜绝「文件名对不上」。
2. **双面分离**：
   - **人类侧**（小、可写、人类直接看）：`index.md` + `cards/<citekey>.md` + `reading/` + `notes/`。
   - **机器侧**（大、生成、不可手改）：`.raw/<citekey>/` + `.index.json` + `.manifest.json`。
3. **frontmatter = 机器契约，正文 = 人类蒸馏**：agent 先读 frontmatter 定位，人类读正文理解。
4. **原始语料不可变、卡片可编辑、导入幂等**：重跑导入只刷新机器侧；`cards/*.md` 已存在则保留（研读笔记不被覆盖）。
5. **MinerU `full.md` 是「全文事实源」**，PDF 是档案原件；两者都进机器侧，不污染人类视图。
6. **无数据库**：检索靠 `.index.json`（结构化元数据）+ grep/read（全文）。

## 2. 参考实践（借鉴点）

| 参考 | 借鉴点 |
|---|---|
| [dsh-noema](https://github.com/ZSeven-W/dsh-noema) | 记忆 = 工作区 markdown 文件 + frontmatter 契约；agent 与人类共用同一套文件，「知识即文件」 |
| [obelisk](https://github.com/tommy0103/obelisk) | 每篇一个原子「碑」式卡片 + 统一 registry/index；类型化、可溯源、一张卡一个稳定 ID |
| [OpenViking](https://github.com/volcengine/OpenViking) | 记忆的存储/组织/检索分层：原始语料、元数据、检索索引各司其职，不在同一层混写 |
| [hindsight](https://github.com/vectorize-io/hindsight) | raw vs curated 分离 + metadata-first 检索：蒸馏后的「卡片」才进检索，原始大文本留底层按需读 |

（以上为模式层面的借鉴；各仓库细节以其 README 为准，本设计不绑定任一实现。）

## 3. 目录结构

```text
literature/             （本仓库根下）
  README.md            人类入口：是什么、怎么看、怎么重新导入
  index.md             人类总索引（自动生成表格 + 人工补充导航）
  library.bib          BibTeX（Zotero 导出原样）
  cards/<citekey>.md   每篇一张文献卡（人类读这个；agent 先读这个）
  reading/<citekey>.md 单篇研读笔记（可选，人类/agent 共写）
  notes/               跨文献综合 / 综述 / 研读产出（可选）
  .raw/<citekey>/      机器侧原始语料（不可手改）
    source.pdf         论文原件
    full.md            MinerU 全文
    images/            MinerU 图片（full.md 的相对引用）
    meta.json          元数据 + 文件清单 + 校验和
  .index.json          机器检索索引（结构化，agent 用）
  .manifest.json       导入清单 + 告警（缺 PDF / 缺全文）
```

> 点号目录（`.raw/`、`.index.json`、`.manifest.json`）= 机器侧/生成物，约定不手改；若某天把本区域镜像进 Obsidian，点号路径也会被 vault 索引自动排除，避免污染搜索。agent 用 node fs 不受影响。

## 4. 文件契约

### 4.1 卡片 frontmatter（`cards/<citekey>.md`）

```yaml
---
citekey: gaoLeanSearchV2Global2026
title: "LeanSearch v2: ..."
shorttitle: "LeanSearch v2"
authors: "Gao, Guoxiong; Sun, Zeming; ..."
year: 2026
status: unread        # to-process | unread | reading | distilled | archived
doi: "10.48550/arXiv.2605.13137"
url: "http://arxiv.org/abs/2605.13137"
keywords: "Computer Science - ..."
tags: []              # 人类主题标签，研读时填
full_text: .raw/<citekey>/full.md
pdf: .raw/<citekey>/source.pdf
---
```

正文固定四节：`摘要`（机器填）→ `核心机制 / 方法`（人类/agent 蒸馏）→ `与我的工作 / 记忆的映射`（回流记忆的入口）→ `研读状态 + 原文链接`。

### 4.2 机器侧

- `meta.json`：citekey + BibTeX 元数据 + 源文件清单 + `sha256` + 导入时间（可追溯）。
- `.index.json`：`{ generatedAt, count, entries: [{citekey, title, authors, year, keywords, status, doi, url, card, fullText, pdf}] }`，供 agent 或未来 note_recall 集成直接消费。
- `index.md` 的表格位于 `<!-- BEGIN AUTO-INDEX --> ... <!-- END AUTO-INDEX -->` 自动块内；重跑只刷新该块，块外的人工导航/备注保留。

## 5. 工作流

**agent 读路径**（逐步细化，省 token）：
1. 读 `index.md` 或 `.index.json` 定位相关文献；
2. 打开 `cards/<citekey>.md` 看 frontmatter + TL;DR + 映射；
3. 需要细节再 grep/read `.raw/<citekey>/full.md`（全文事实源）。

**人类看路径**：
- `index.md` 看全貌与状态 → `cards/<citekey>.md` 看摘要/映射 → `.raw/` 看原始全文（Explorer 可见）。

**研读 → 蒸馏 → 记忆闭环**：
1. 研读后把「可迁移机制 + 与我的映射」写进卡片两节（人类/agent 共写）；
2. 把可复用的机制蒸馏进 vault 记忆：records 的 `hook:` 块（techniques/applications）、theorems、templates——即文献库是「输入语料」，蒸馏后才进入长期记忆；
3. 卡片 `status` 流转 `unread → reading → distilled`。

**在仓库里维护**：本区域就在仓库 `literature/` 下，agent 后续改进时直接用文件工具读/写/编辑这里的卡片、笔记、索引；新增文献 = 把 PDF/BibTeX 放进源目录后重跑 `scripts/lit-import.mjs --source … --out literature`。

## 6. 导入器 `scripts/lit-import.mjs`

```bash
node scripts/lit-import.mjs --source <源目录> --out <输出目录> --dry-run   # 先看计划
node scripts/lit-import.mjs --source <源目录> --out <输出目录>            # 正式导入
# 可选：--bib <bibtex路径>  --no-images
```

- 输入：源目录里的 `*.pdf`、`<pdf名>-<uuid>/full.md`（+ images/）、`collected papers.bib`。
- 匹配：BibTeX `file` 字段里的 PDF 文件名 → 同名 PDF → 同前缀 MinerU 目录；有标题/年份兜底。
- 幂等：`.raw/`、`.index.json`、`.manifest.json`、`library.bib`、`index.md` 自动块每次刷新；`cards/*.md`、`README.md` 已存在则保留。
- 非破坏：只读源、只写 `--out`，不删除/改写任何源文件。

## 7. 施行状态与下一步

**已完成（仓库 `literature/`）**：14 条 BibTeX 全部匹配 14 个 PDF，14 篇全部有 MinerU `full.md`（`unread`）；产出 14 张卡、`notes/_README.md`、`index.md`/`.index.json`/`.manifest.json`/`library.bib`，`.raw/` 含 14 份 PDF + full.md + images（约 42MB，511 张图）。

**下一步候选（需拍板后再动）**：
1. **git 处理**：`.raw/` 是约 42MB 二进制（PDF + 图片），建议加入 `.gitignore`（工作区保留、不进 git 历史），或整体纳入版本库做备份——由你定；
2. **蒸馏流程**：从 `unread` 开始研读，把可迁移机制写进卡片「核心机制 / 映射」两节，并回流到 vault 记忆的 records/hook、theorems、templates；
3. **纳入统一检索**：让 `note_recall` 把 `literature/cards/`（或 full.md 摘要级）纳入统一语料（需改 `note-tools.mjs`）；
4. **AGENTS.md 增文献路由**：告诉 agent「找论文先读 index → 卡片 → full.md → 蒸馏进 records/hook」（需改模板 + 重建 `main.js`）。
