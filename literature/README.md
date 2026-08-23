# 文献库（Literature Library）

> 设计见仓库 docs/literature.md。本目录 = agent 可读的文献语料 + 人类可看的研读卡片。

## 结构

    library/
      index.md            人类总索引（自动生成表格 + 人工补充导航）
      library.bib         BibTeX（Zotero 导出原样，file 字段保留原始路径）
      cards/<citekey>.md  每篇一张文献卡（人类读这个；agent 先读这个）
      reading/<citekey>.md 研读笔记（可选，人类/agent 共写）
      notes/             跨文献综合 / 综述 / 研读产出（可选）
      .raw/<citekey>/     机器侧原始语料
        source.pdf
        full.md           MinerU 全文
        images/
        meta.json         元数据 + 文件清单 + 校验和
      .index.json         机器检索索引
      .manifest.json      导入清单

## 人类怎么看

- 读 index.md 定位，再读 cards/<citekey>.md 看摘要/映射/状态。
- 原始全文在 .raw/<citekey>/full.md（Windows 资源管理器可见；放进 Obsidian 后点号目录会被隐藏，避免污染搜索）。

## agent 怎么读

1. 读 index.md / .index.json 找到相关文献；
2. 打开 cards/<citekey>.md（frontmatter 是机器契约，正文是给人类看的蒸馏）；
3. 需要细节读 .raw/<citekey>/full.md（grep/read 均可）；
4. 研读产出蒸馏进卡片「核心机制 / 与我的映射」两节，并同步到 vault 记忆（records 的 hook 块、theorems、templates）。

## 重新导入

    node scripts/lit-import.mjs --source <源目录> --out <本目录> --dry-run
    node scripts/lit-import.mjs --source <源目录> --out <本目录>

- .raw/、.index.json、.manifest.json、index.md 的自动块、library.bib 会被刷新；
- cards/*.md 已存在则保留（研读笔记不会被覆盖）。