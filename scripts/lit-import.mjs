#!/usr/bin/env node
// lit-import.mjs — 把「Zotero BibTeX + PDF + MinerU markdown」整理成 agent 可读、人类可看的文献库。
// 非破坏性：只读源目录、只写 --out；重复运行不覆盖用户已编辑的卡片（cards/*.md 已存在即保留）。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const log = (...a) => console.log(...a);
const warn = (...a) => console.error('WARN', ...a);

const USAGE = [
  '用法: node scripts/lit-import.mjs --source <源目录> --out <输出目录> [--bib <bibtex路径>] [--dry-run] [--no-images]',
  '  源目录结构（你的 D:/临时/agent记忆 现状）:',
  '    *.pdf                     原始论文',
  '    <pdf名>-<uuid>/full.md    MinerU 转换全文 + images/',
  '    collected papers.bib      Zotero 导出 BibTeX',
  '  输出结构见 docs/literature.md。'
].join('\n');

function parseArgs(argv) {
  const a = { dryRun: false, copyImages: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source') a.source = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--bib') a.bib = argv[++i];
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--no-images') a.copyImages = false;
    else if (k === '--help') { console.log(USAGE); process.exit(0); }
    else { console.error('未知参数: ' + k); console.error(USAGE); process.exit(2); }
  }
  if (!a.source || !a.out) { console.error('需要 --source 与 --out'); console.error(USAGE); process.exit(2); }
  return a;
}

// ---------- BibTeX 解析（对 Zotero 导出格式容错） ----------
function cleanTex(s) {
  return String(s)
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFields(body) {
  const fields = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|\{)/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    let val;
    if (m[2] !== undefined) {
      val = m[2];
    } else {
      const start = re.lastIndex;
      let depth = 1, k = start, acc = '';
      while (k < body.length && depth > 0) {
        const ch = body[k];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
        acc += ch;
        k++;
      }
      val = acc;
      re.lastIndex = k + 1;
    }
    fields[name] = cleanTex(val);
  }
  return fields;
}

function parseBibtex(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line.startsWith('@')) { i++; continue; }
    const m = /^@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(line);
    if (!m) { i++; continue; }
    const type = m[1].toLowerCase();
    const key = m[2];
    let rest = line.slice(m[0].length);
    let depth = 1;
    const bodyLines = [];
    let j = i;
    let cur = rest;
    while (true) {
      for (let k = 0; k < cur.length; k++) {
        const ch = cur[k];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { cur = cur.slice(0, k); break; } }
      }
      if (depth <= 0) { bodyLines.push(cur); break; }
      bodyLines.push(cur);
      j++;
      if (j >= lines.length) break;
      cur = lines[j];
    }
    entries.push({ type, key, fields: parseFields(bodyLines.join('\n')) });
    i = j + 1;
  }
  return entries;
}

function parseAuthors(s) {
  if (!s) return [];
  return s.split(/\s+and\s+/).map(x => x.trim()).filter(Boolean);
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function extractPdfBasenames(fileField) {
  const out = [];
  if (!fileField) return out;
  for (const m of fileField.matchAll(/[^\\;]+\.pdf/gi)) {
    const name = m[0].split(/[\\/]/).pop();
    if (name) out.push(name);
  }
  return out;
}

function matchPdf(entry, pdfMap) {
  const cands = extractPdfBasenames(entry.fields.file);
  for (const c of cands) if (pdfMap.has(c.toLowerCase())) return c;
  const title = norm(entry.fields.title || '');
  const year = String(entry.fields.year || '');
  let best = null, bestScore = 0;
  for (const key of pdfMap.keys()) {
    const nk = norm(key.replace(/\.pdf$/i, ''));
    let score = 0;
    if (year && nk.includes(year)) score += 2;
    if (title && nk.includes(title.slice(0, Math.max(12, Math.floor(title.length / 2))))) score += 5;
    if (title && nk.includes(title)) score += 10;
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return (bestScore >= 7) ? best : null;
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function copyFileOrNull(src, dst) {
  if (src && existsSync(src)) { ensureDir(join(dst, '..')); copyFileSync(src, dst); return true; }
  return false;
}

function copyDirRecursive(src, dst) {
  let n = 0;
  if (!existsSync(src)) return n;
  ensureDir(dst);
  for (const f of readdirSync(src)) {
    const s = join(src, f), d = join(dst, f);
    if (statSync(s).isDirectory()) n += copyDirRecursive(s, d);
    else { copyFileSync(s, d); n++; }
  }
  return n;
}

function sha256(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }

function writeJson(p, obj) { ensureDir(join(p, '..')); writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function yamlStr(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function renderCard(e, meta) {
  const c = e.key;
  const f = e.fields;
  const title = f.title || c;
  const authors = parseAuthors(f.author);
  const status = meta.status;
  const abstract = (f.abstract || '').trim();
  const L = [];
  L.push('---');
  L.push('citekey: ' + c);
  L.push('title: ' + yamlStr(title));
  if (f.shorttitle) L.push('shorttitle: ' + yamlStr(f.shorttitle));
  L.push('authors: ' + yamlStr(authors.join('; ')));
  L.push('year: ' + (f.year || ''));
  L.push('status: ' + status);
  if (f.doi) L.push('doi: ' + yamlStr(f.doi));
  if (f.url) L.push('url: ' + yamlStr(f.url));
  if (f.keywords) L.push('keywords: ' + yamlStr(f.keywords));
  L.push('tags: []');
  L.push('full_text: .raw/' + c + '/full.md');
  L.push('pdf: .raw/' + c + '/source.pdf');
  L.push('---');
  L.push('');
  L.push('# ' + title);
  L.push('');
  L.push('> **一句话**：<!-- TODO -->');
  L.push('');
  L.push('## 摘要');
  L.push('');
  L.push(abstract || '（无摘要）');
  L.push('');
  L.push('## 核心机制 / 方法');
  L.push('');
  L.push('<!-- TODO：用自己的话提炼——它解决什么问题、关键设计、可迁移机制 -->');
  L.push('');
  L.push('## 与我的工作 / 记忆的映射');
  L.push('');
  L.push('<!-- TODO：可借鉴点、不适用部分、与现有 hook / records / 检索的关系 -->');
  L.push('');
  L.push('## 研读状态');
  L.push('');
  L.push('- 状态：' + status);
  L.push('- 研读日志：reading/' + c + '.md（按需创建）');
  L.push('');
  L.push('## 原文');
  L.push('');
  L.push(meta.fullMd ? '- [MinerU 全文](.raw/' + c + '/full.md)' : '- MinerU 全文：**待转换**');
  L.push('- [PDF](.raw/' + c + '/source.pdf)');
  L.push('');
  return L.join('\n');
}

function statusLabel(status) {
  const map = { 'to-process': '待转换', 'unread': '未读', 'reading': '研读中', 'distilled': '已蒸馏', 'archived': '已归档' };
  return map[status] || status;
}

const AUTO_START = '<!-- BEGIN AUTO-INDEX (lit-import.mjs 生成，勿手改本块) -->';
const AUTO_END = '<!-- END AUTO-INDEX -->';

function renderIndexBlock(rows) {
  const L = [];
  L.push('| 状态 | 文献 | 作者 | 年份 | 关键词 |');
  L.push('|---|---|---|---|---|');
  for (const r of rows) {
    const t = r.title;
    const a = (r.authors[0] || '') + (r.authors.length > 1 ? ' 等' : '');
    const tags = (r.keywords ? r.keywords.split(/[,;]/)[0] : '') || '—';
    L.push('| ' + statusLabel(r.status) + ' | [' + t + '](cards/' + r.citekey + '.md) | ' + a + ' | ' + r.year + ' | ' + tags + ' |');
  }
  return L.join('\n');
}

function indexHeader() {
  return [
    '# 文献库索引',
    '',
    '> 表格由 lit-import.mjs 生成；你可以在本文件任意位置补充主题导航、优先级、人工备注（自动块外不会被覆盖）。',
    '',
    '## 目录',
    '- [卡片](cards/)：每篇一篇文献卡',
    '- [研读笔记](reading/)：研读日志（按需创建）',
    '- [综合笔记](notes/)：跨文献综述与研读产出',
    '- [原始语料](.raw/)：PDF + MinerU 全文 + 图片（机器侧）',
    '- [BibTeX](library.bib)：归一化文献元数据',
    ''
  ].join('\n');
}

function indexFooter() {
  return [
    '',
    '## 使用',
    '',
    '- agent：先读本索引，再打开 cards/<citekey>.md 看 TL;DR 与映射，需要细节再读 .raw/<citekey>/full.md；研读后把「可迁移机制 + 映射」蒸馏进卡片与 vault 记忆（records/hook）。',
    '- 人类：直接看 cards/ 与 index.md；原始全文在 .raw/（Windows 资源管理器可见，Obsidian 里点号目录会隐藏）。'
  ].join('\n');
}

function renderNotesReadme() {
  return [
    '# 综合笔记（跨文献）',
    '',
    '这里是围绕文献库的跨论文记录与产出：综述、对比、主题梳理、研读心得、待办等（单篇研读笔记放 ../reading/，单篇蒸馏卡放 ../cards/）。',
    '',
    '建议按主题或目标建文件，例如：',
    '- memory-taxonomy.md   记忆系统分类 / 综述',
    '- retrieval-notes.md   检索相关论文的横向对比',
    '- todo.md             研读队列与优先级',
    '',
    'agent 在仓库里维护本区域：研读后把可复用机制蒸馏进 cards + vault 记忆（records/hook），跨论文结论沉淀到这里。'
  ].join('\n');
}

function renderReadme() {
  return [
    '# 文献库（Literature Library）',
    '',
    '> 设计见仓库 docs/literature.md。本目录 = agent 可读的文献语料 + 人类可看的研读卡片。',
    '',
    '## 结构',
    '',
    '    library/',
    '      index.md            人类总索引（自动生成表格 + 人工补充导航）',
    '      library.bib         BibTeX（Zotero 导出原样，file 字段保留原始路径）',
    '      cards/<citekey>.md  每篇一张文献卡（人类读这个；agent 先读这个）',
    '      reading/<citekey>.md 研读笔记（可选，人类/agent 共写）',
    '      notes/             跨文献综合 / 综述 / 研读产出（可选）',
    '      .raw/<citekey>/     机器侧原始语料',
    '        source.pdf',
    '        full.md           MinerU 全文',
    '        images/',
    '        meta.json         元数据 + 文件清单 + 校验和',
    '      .index.json         机器检索索引',
    '      .manifest.json      导入清单',
    '',
    '## 人类怎么看',
    '',
    '- 读 index.md 定位，再读 cards/<citekey>.md 看摘要/映射/状态。',
    '- 原始全文在 .raw/<citekey>/full.md（Windows 资源管理器可见；放进 Obsidian 后点号目录会被隐藏，避免污染搜索）。',
    '',
    '## agent 怎么读',
    '',
    '1. 读 index.md / .index.json 找到相关文献；',
    '2. 打开 cards/<citekey>.md（frontmatter 是机器契约，正文是给人类看的蒸馏）；',
    '3. 需要细节读 .raw/<citekey>/full.md（grep/read 均可）；',
    '4. 研读产出蒸馏进卡片「核心机制 / 与我的映射」两节，并同步到 vault 记忆（records 的 hook 块、theorems、templates）。',
    '',
    '## 重新导入',
    '',
    '    node scripts/lit-import.mjs --source <源目录> --out <本目录> --dry-run',
    '    node scripts/lit-import.mjs --source <源目录> --out <本目录>',
    '',
    '- .raw/、.index.json、.manifest.json、index.md 的自动块、library.bib 会被刷新；',
    '- cards/*.md 已存在则保留（研读笔记不会被覆盖）。'
  ].join('\n');
}

function main() {
  const a = parseArgs(process.argv);
  const source = a.source;
  const out = a.out;
  const bibPath = a.bib || join(source, 'collected papers.bib');

  if (!existsSync(bibPath)) { console.error('找不到 BibTeX: ' + bibPath); process.exit(2); }
  const entries = parseBibtex(readFileSync(bibPath, 'utf8'));
  log('解析到 ' + entries.length + ' 条 BibTeX 条目');

  const top = readdirSync(source).map(f => join(source, f));
  const pdfMap = new Map();
  for (const p of top) if (statSync(p).isFile() && p.toLowerCase().endsWith('.pdf')) pdfMap.set(basename(p).toLowerCase(), p);
  const mineruMap = new Map();
  for (const p of top) if (statSync(p).isDirectory() && existsSync(join(p, 'full.md'))) mineruMap.set(basename(p).toLowerCase(), p);
  log('源目录: ' + pdfMap.size + ' 个 PDF, ' + mineruMap.size + ' 个 MinerU 目录');

  ensureDir(out);
  ensureDir(join(out, 'cards'));
  ensureDir(join(out, 'reading'));
  ensureDir(join(out, 'notes'));
  const notesReadme = join(out, 'notes', '_README.md');
  if (!existsSync(notesReadme)) writeFileSync(notesReadme, renderNotesReadme(), 'utf8');
  ensureDir(join(out, '.raw'));

  const report = [];
  const missingPdf = [], missingMd = [];
  const jsonEntries = [];

  for (const e of entries) {
    const c = e.key;
    const f = e.fields;
    const pdfName = matchPdf(e, pdfMap);
    const pdfPath = pdfName ? pdfMap.get(pdfName.toLowerCase()) : null;
    let mineruPath = null;
    if (pdfName) {
      for (const [dname, dpath] of mineruMap) {
        if (dname.startsWith(pdfName.toLowerCase() + '-')) { mineruPath = dpath; break; }
      }
    }
    if (!pdfPath) missingPdf.push(c);
    if (pdfPath && !mineruPath) missingMd.push(c);

    const rawDir = join(out, '.raw', c);
    const status = (pdfPath && mineruPath) ? 'unread' : 'to-process';
    const meta = {
      citekey: c,
      bibType: e.type,
      title: f.title || c,
      shorttitle: f.shorttitle || '',
      authors: parseAuthors(f.author),
      year: f.year || '',
      doi: f.doi || '',
      url: f.url || '',
      keywords: f.keywords || '',
      status,
      sourcePdf: pdfName || null,
      mineruDir: mineruPath ? basename(mineruPath) : null,
      fullMd: !!mineruPath,
      images: 0,
      sha256Pdf: '',
      importedAt: new Date().toISOString()
    };

    let images = 0;
    if (!a.dryRun) {
      ensureDir(rawDir);
      if (pdfPath) {
        copyFileOrNull(pdfPath, join(rawDir, 'source.pdf'));
        meta.sha256Pdf = sha256(join(rawDir, 'source.pdf'));
      }
      if (mineruPath) {
        copyFileOrNull(join(mineruPath, 'full.md'), join(rawDir, 'full.md'));
        if (a.copyImages) images = copyDirRecursive(join(mineruPath, 'images'), join(rawDir, 'images'));
      }
      meta.images = images;
      writeJson(join(rawDir, 'meta.json'), meta);

      const cardPath = join(out, 'cards', c + '.md');
      const cardExisted = existsSync(cardPath);
      if (!cardExisted) writeFileSync(cardPath, renderCard(e, meta), 'utf8');
      report.push({ citekey: c, pdf: pdfName || null, mineruDir: mineruPath ? basename(mineruPath) : null, status, card: cardExisted ? 'kept' : 'created' });
    } else {
      report.push({ citekey: c, pdf: pdfName || null, mineruDir: mineruPath ? basename(mineruPath) : null, status, card: 'would-create' });
    }

    jsonEntries.push({
      citekey: c, title: meta.title, shorttitle: meta.shorttitle, authors: meta.authors, year: meta.year,
      keywords: meta.keywords, status: meta.status, doi: meta.doi, url: meta.url,
      card: 'cards/' + c + '.md',
      fullText: mineruPath ? '.raw/' + c + '/full.md' : null,
      pdf: '.raw/' + c + '/source.pdf'
    });
  }

  if (a.dryRun) {
    log('--- dry-run 计划 ---');
    for (const r of report) log('  ' + r.citekey + '  [' + r.status + ']  pdf=' + (r.pdf || '✗') + '  mineru=' + (r.mineruDir ? '✓' : '✗') + '  card=' + r.card);
    log('缺 PDF: ' + (missingPdf.length ? missingPdf.join(', ') : '无'));
    log('缺 MinerU: ' + (missingMd.length ? missingMd.join(', ') : '无'));
    return;
  }

  copyFileOrNull(bibPath, join(out, 'library.bib'));

  const rows = jsonEntries.map(x => ({ citekey: x.citekey, title: x.title, authors: x.authors, year: x.year, keywords: x.keywords, status: x.status }));
  const autoBlock = AUTO_START + '\n' + renderIndexBlock(rows) + '\n' + AUTO_END;
  const indexPath = join(out, 'index.md');
  if (existsSync(indexPath)) {
    let text = readFileSync(indexPath, 'utf8');
    const s = text.indexOf(AUTO_START), en = text.indexOf(AUTO_END);
    if (s >= 0 && en > s) text = text.slice(0, s) + autoBlock + text.slice(en + AUTO_END.length);
    else text += '\n\n' + autoBlock + '\n';
    writeFileSync(indexPath, text, 'utf8');
  } else {
    writeFileSync(indexPath, indexHeader() + autoBlock + '\n' + indexFooter(), 'utf8');
  }

  const readmePath = join(out, 'README.md');
  if (!existsSync(readmePath)) writeFileSync(readmePath, renderReadme(), 'utf8');

  writeJson(join(out, '.index.json'), { generatedAt: new Date().toISOString(), count: jsonEntries.length, entries: jsonEntries });
  writeJson(join(out, '.manifest.json'), {
    generatedAt: new Date().toISOString(), source, out, bibPath,
    entries: report,
    warnings: { missingPdf, missingMd }
  });

  log('完成：' + report.length + ' 条文献 → ' + out);
  log('  cards 新建 ' + report.filter(r => r.card === 'created').length + ' / 保留 ' + report.filter(r => r.card === 'kept').length);
  if (missingPdf.length) warn('缺 PDF（bib 有但源目录没有）: ' + missingPdf.join(', '));
  if (missingMd.length) warn('缺 MinerU 全文（待转换）: ' + missingMd.join(', '));
}

main();
