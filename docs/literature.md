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

**`研读状态` 节的日期约定（2026-09-17 新增）**：该节里写一行 `- 状态更新：YYYY-MM-DD`，每次推进状态时更新它。它是**人工维护**的字段，但**机器会读**：`scripts/lib/lit-index.mjs` 用它判断陈旧，并据此在 `index.md` 里标注「已停 N 天」与「陈旧提醒」（未读/待转换 ≥ 7 天、研读中 ≥ 30 天）。
- 为什么不用文件的修改时间：mtime 会在 `git checkout` 时整体变化，而 `.raw/` 是 gitignore 的再生语料——两者都无法为"一次研读"定日期。
- **没有这一行就不提醒**（而不是编一个日期）：凭空造出日期等于凭空造出提醒。

**`index.md` 的 `状态` 列取卡片真实状态，不再取机器默认**（2026-09-17 修）：`cards/*.md` 跨导入**保留**，所以首次导入时写下的机器默认（恒为 `unread`）对任何后续被研读过的卡都是错的——本库的卡片实际全都 `distilled`，而索引曾对全部显示「未读」。本文档把这一不一致记为已知现象，但它**不会让任何门禁失败**。现在索引优先读卡片，卡片不存在（全新导入）时才回落到机器默认。守卫：`scripts/test-lit-import.mjs`（**进程内**，10 项断言，做过变异验证）。

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

**已完成（仓库 `literature/`）**：`.raw/` 下 **25** 条 BibTeX 条目（= `.raw/` 目录数），其中 22 篇为「BibTeX + PDF + MinerU `full.md`」齐全的完整条目，2026-09-17 新增 **3** 条**网页源**条目（无 PDF、故不在 `.raw/` 下，见下）。产出卡片、`notes/_README.md`、`notes/retrieval-alignment-2026-08.md`、`notes/improvement-intake-2026-09-17.md`、`index.md`/`.index.json`/`.manifest.json`/`library.bib`。

- **前 22 篇全部已蒸馏**（cards + reading 齐全）：前批 14 篇 + `wangMemTrapBenchBenchmarkingCognitive2026` + 第二批 4 篇（`yangRetrievalAugmentedLanguageModels2025`=Dual RAG、`huQueryLinkLeveragingQueryMemory2026`、`vakeBridgingQuestionAnswerGap2025`=HyPE、`yuanMemSearcherIterativeMemory2026`）+ 第三批 1 篇（`liGraphMemixQueryAwareEvidence2026`=GraphMemix，2026-09-10 按 §8 流程导入并蒸馏）+ 第四批 2 篇（`tangMemorySkillsEvidenceGrounded2026`=MSCE、`wangMemForestEfficientAgent2026`=MemForest，2026-09-17 按 §8 流程从 `D:\临时\agent记忆` 导入并蒸馏；两篇均有 PDF + MinerU 全文）。
- **2026-09-17 新增 3 条网页源条目**（`danusFactGraphMemory2026`、`yangOptSkillsLearningGeneralizable2026`、`verymathCoMathematician2026`）：**无 PDF / 无 MinerU**，`status: to-process` 由导入器写出、随后人工蒸馏为 `distilled`（研读记录共用 `reading/verymathOrg2026.md` 这份组织级调研）。**这是「非 PDF 文献」的处理范式**：BibTeX 进 `library.bib` → 导入器建卡（记 `to-process`）→ 直接读网页/仓库一手来源 → 卡片蒸馏 + 在卡内**显式标注"摘要为改写，非原文"**（OptSkills 即如此，因 arXiv 摘要页 fetch 失败）。**注意**：`literature/.raw/` 的目录数因此**小于**文献条目总数——`check-doc-constants.mjs` 锚的是**目录数**，所以它没有把网页源算进"篇数"。

> **源目录缺 BibTeX 条目时的做法**（GraphMemix 的实际情形）：`lit-import.mjs` 只遍历 BibTeX 条目，**源目录里的 PDF 若没有对应条目就是不可见的**（dry-run 里不会出现）。做法是：从 MinerU `full.md` 首页取标题/作者，用网络核对卷期/arXiv 号，**另写一个临时 bib（不改源目录）**并把它与原 bib 合并后 `--bib` 传入：
> ```bash
> node scripts/lit-import.mjs --source <源目录> --out literature --bib <临时合并 bib>
> ```
> 合并后的 bib 含全部条目，因此已导入的条目只是被幂等刷新（卡片保留），新条目被追加进 `library.bib`。**注意**：`--bib` 是「本次要处理的条目全集」，传一个只含新条目的 bib 不会删除已有条目（index/manifest 按 citekey 合并），但为了让 dry-run 能一次核对全部匹配，仍建议传全集。

> ⚠️ **坑（2026-09-17 实测踩到）：临时 bib 的存放目录不能当作 `--source`。** `--source` 会被**原样写进 `.manifest.json` 的 `source` 字段**。若把临时 bib 和 `--source` 都指向一个临时目录（如 `.lit-tmp/`），manifest 就会记录一个**随即被删掉的路径**，机器侧溯源断掉。正确做法是：**临时 bib 可以放别处（甚至放在源目录里），但 `--source` 必须指向真实的语料目录**。本仓库的实际操作是分两次跑——(`--source "D:\临时\agent记忆" --bib "<临时合并 bib>")` 导入 PDF 类条目，再 (`--source <只含新 bib 的目录> --bib <该 bib>`) 导入网页源条目，**最后再跑一次只含 PDF 类条目、`--source` 指向真实语料目录** 的命令，把 manifest 的 `source` 修正回来（该命令对已导入条目是幂等的，卡片会"保留"而不是重建）。修复后 `git diff literature/.manifest.json` 里不应再有临时路径。

**下一步候选（需拍板后再动）**：
1. **git 处理**：`.raw/` 是约 42MB 二进制（PDF + 图片），建议加入 `.gitignore`（工作区保留、不进 git 历史），或整体纳入版本库做备份——由你定；
2. **蒸馏流程**：从 `unread` 开始研读，把可迁移机制写进卡片「核心机制 / 映射」两节，并回流到 vault 记忆的 records/hook、theorems、templates；
3. **纳入统一检索**：让 `note_recall` 把 `literature/cards/`（或 full.md 摘要级）纳入统一语料（需改 `note-tools.mjs`）；
4. **AGENTS.md 增文献路由**：告诉 agent「找论文先读 index → 卡片 → full.md → 蒸馏进 records/hook」（需改模板 + 重建 `main.js`）；
5. **GraphMemix 带来的三项检索改进（2026-09-10 研读产出，待评估）**：① `composePassage` 的「拼接成一个 bag」改成**按视图打分取 max**（长正文正在稀释 hook 的强匹配）；② `note_recall` 加**确定性角色字段**（新增/澄清/佐证/冗余/冲突/无关）——这是我们 1.0 缺口「技巧调用体系」最小可落地的一件；③ `engine-probe.mjs` 加**可达性分层**断言（Direct / Recoverable / No access），零 token 量化「顺链扩读」的实际收益。详见 `docs/memory/references.md` §12 与卡片。

## 8. 新增单篇文献 SOP（后续 agent 照此执行）

目标：把一篇新论文加入文献库并留下研读记录，**不破坏已有条目**。

1. **准备源目录**：把新论文的 `*.pdf`（可选的 MinerU `full.md` 目录 + BibTeX `collected papers.bib`）放进一个临时源目录——**不必包含全部论文**（导入器是增量合并的）。
2. **导入**：
   ```bash
   node scripts/lit-import.mjs --source <临时源目录> --out literature
   ```
   - 按 citekey 增量合并 `.index.json` / `.manifest.json`，`index.md` 自动块从合并结果重生成，`library.bib` 只追加缺失的 @entry——**不会覆盖已有条目**（已修复，幂等可重复跑）。
   - 有 MinerU `full.md` → 状态 `unread`；缺 → `to-process`（待转换）。
3. **通读**：读 `.raw/<citekey>/full.md`（MinerU 全文，事实源）。
   - ⚠️ **MinerU 会偶发大面积破坏行内文本**：2026-09-10 的 GraphMemix（arXiv:2608.26983）就是实例——`full.md` 与 `content_list.json` 里出现 5613 个 `<sub>` 标签，其中 **3954 处把词从中间切开**（`Memor<sub>y</sub>`、`consistenc<sub>y</sub>`），两套独立 MinerU 运行结果一致 ⇒ 是 MinerU 的行内公式检测器把普通正文误判成公式，**不是 full.md 渲染层的问题**（`content_list.json` 同样坏）。
   - **判别**：`full.md` 里 `<sub>` 计数上千、或出现 `[a-z]<sub>` 这种「字母后紧跟 `<sub>`」的模式时，判定为破坏。
   - **替代路径（已验证可用）**：直接从源 PDF 抽取——
     ```bash
     pdftotext -layout -enc UTF-8 ".raw/<citekey>/source.pdf" <out.txt>
     ```
     本机 `pdftotext` 随 TeXLive 提供（`D:\texlive\2026\bin\windows\pdftotext.exe`）；`-layout` 保留表格结构。抽取结果干净（该论文 108,779 字符）。
   - **纪律**：**不要在有噪声的源上做蒸馏**。若已基于坏源写过卡片/笔记，修好源后**复读并更正**（GraphMemix 的复读就补出了超参数、控制实验，并纠正了一处误读）。复读时在 reading 顶部标注「本版以 pdftotext 抽取文本为准」。
4. **写卡片**：把 `cards/<citekey>.md` 的 TODO 换成蒸馏——「一句话」+「核心机制 / 方法」+「与我的工作 / 记忆的映射」，frontmatter `status` 改为 `distilled`。
5. **写研读记录**：按 `reading/_TEMPLATE.md` 的 14 节写 `reading/<citekey>.md`（重点：可迁移机制清单 + 映射/差距 + 行动项）。
6. **回流记忆（可选）**：把可复用机制蒸馏进 vault 记忆的 records/hook、theorems、templates。

**约定**：
- `citekey` 是唯一 ID，贯穿目录/卡片/索引，不要改。
- `cards/*.md` 是人类侧真相（status 流转 `unread → reading → distilled`）；`.index.json` / `index.md` 的 status 是机器默认（`unread`），与卡片可能不一致，属已知现象。
- `.raw/`、`.index.json`、`.manifest.json` 是机器侧，不手改。
