#!/usr/bin/env node
/**
 * user-burden-probe — 只读探针：**系统向用户索取了多少动作，以及这些动作是必要的吗**。
 *
 * 背景（2026-10-01 用户提出、设计原则「用户负担最小化」的第一件工具）：
 *   用户原话——"尽可能减少用户自行维护整理的麻烦工作，让用户专注思考"。
 *   判据：**凡是能从文件系统确定性推出的事实，系统不得要求用户报告或维护。**
 *   这个探针不新增任何状态、不写任何文件，只回答两个问题：
 *     ① **死配额**：系统留了位置、写了规则要用户填的东西，真实库里填了多少？
 *     ② **结局**：卡片被检索出来多少次、其中多少次真的被读了？（C9-A′ 的前两层）
 *
 * 它**不会**：
 *   - 写任何文件（包括不建缓存、不触碰真实 vault 数据）；
 *   - 调用模型（零 token）；
 *   - 猜测缺失数据（样本为 0 时如实说"本环境没有样本"）。
 *
 * 用法：
 *   node scripts/qa/user-burden-probe.mjs --vault <vault 路径> [--sessions <日志根>] [--json]
 *   默认 vault 取 `DSH_WORKSPACE_ROOT` / `DSH_OBSIDIAN_VAULT`；都没有则报错退出（不猜路径）。
 *   `--sessions` 默认取 `$DSH_HOME/sessions`（或 `~/.dsh/sessions`）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeZstdSessionLog } from '../../dsh/preset/math-memory.mjs';

const arg = (name, fallback = undefined) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};

const vault = resolve(String(arg('vault', process.env.DSH_WORKSPACE_ROOT ?? process.env.DSH_OBSIDIAN_VAULT ?? '')));
if (vault === '' || vault === resolve('') || !existsSync(vault)) {
  console.error('user-burden-probe: 需要 --vault <路径>，或设置 DSH_WORKSPACE_ROOT / DSH_OBSIDIAN_VAULT');
  process.exit(2);
}
const asJson = arg('json', false) === true;

// ── ① 死配额：规则留了位置、真实库里填了多少 ────────────────────────────────
const MEMORY_DIR = join('.deepseek', 'memory');
const CARD_DIRS = [
  { layer: 'records', dir: join(MEMORY_DIR, 'records') },
  { layer: 'templates', dir: join(MEMORY_DIR, 'templates') },
  { layer: 'strategy', dir: join('.deepseek', 'strategy') }
];
const SCAFFOLD = new Set(['index.md', '_README.md']);

const readCards = () => {
  const out = [];
  for (const { layer, dir } of CARD_DIRS) {
    const abs = join(vault, dir);
    let entries = [];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || SCAFFOLD.has(entry.name) || entry.name.startsWith('_')) continue;
      let text;
      try {
        text = readFileSync(join(abs, entry.name), 'utf8');
      } catch {
        continue;
      }
      out.push({ layer, rel: `${dir.replace(/\\/g, '/')}/${entry.name}`, text });
    }
  }
  return out;
};

/** Count occurrences of `field: value`-style markers in a card's frontmatter/body. */
const hasField = (text, field) => new RegExp(`^[ \\t]*${field}:[ \\t]*\\S`, 'm').test(text);
const fieldValue = (text, field) => new RegExp(`^[ \\t]*${field}:[ \\t]*["']?([^"'\\r\\n]+)`, 'm').exec(text)?.[1]?.trim() ?? '';

const cards = readCards();

// retrieval-stats.json: the ONLY place exposure is counted. `__meta__` carries the
// passive signal (every note_recall call / empty call); per-card entries carry hits.
let recallMeta = { calls: null, empty: null };
let hitCards = 0;
const statsPath = join(vault, '.deepseek', 'cache', 'retrieval-stats.json');
if (existsSync(statsPath)) {
  try {
    const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
    recallMeta = { calls: stats.__meta__?.calls ?? 0, empty: stats.__meta__?.empty ?? 0 };
    hitCards = Object.keys(stats).filter((key) => key !== '__meta__').length;
  } catch {
    recallMeta = { calls: null, empty: null };
  }
}

const originUnknown = cards.filter((card) => fieldValue(card.text, 'origin') === '');
const verifiedByUser = cards.filter((card) => fieldValue(card.text, 'verified_by') === 'user');
const outcomeWritten = cards.filter((card) => hasField(card.text, 'success_rate') || hasField(card.text, 'gain') || hasField(card.text, 'harmed'));
const needsReview = cards.filter((card) => fieldValue(card.text, 'needs_review') === 'true');
const aiMarked = cards.filter((card) => /AI\s*补全/.test(card.text));

const deadQuota = [
  {
    quota: '✅ user-confirmed（最高验证等级）',
    howUserPays: '在回复末尾点 ✅（反馈链接）',
    status: '只由用户点击产生；真实库里从未被写入',
    count: verifiedByUser.length,
    verdict: verifiedByUser.length === 0 ? 'DEAD — 规则留了位置，没人填' : 'in use'
  },
  {
    quota: '❌/✅ 反馈 → success_rate / gain / harmed',
    howUserPays: '每条反馈单独判断"这张卡对不对"',
    status: '字段存在、排序消费，但从未被写过',
    count: outcomeWritten.length,
    verdict: outcomeWritten.length === 0 ? 'DEAD — 晋升门 success_rate ≥ 0.6 永远不可能满足' : 'in use'
  },
  {
    quota: 'needs_review（❌ 后的待重审标记）',
    howUserPays: '点 ❌',
    status: '体检的「待重审」段依赖它',
    count: needsReview.length,
    verdict: needsReview.length === 0 ? 'DEAD — 「待重审」段恒空' : 'in use'
  }
];

// ── ② 结局：暴露 × 是否被读（C9-A′ 前两层）─────────────────────────────────
// 来源只能是会话日志：`note_recall` 的**结果**里出现过的卡路径 = 暴露，该回合随后的
// `read` 调用命中同一路径 = 被读。两者都是既有事实，不需要新架构。
const sessionsRoot = String(arg('sessions', join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')));
const logs = [];
if (existsSync(sessionsRoot)) {
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.zstd')) {
        try {
          logs.push({ path, mtimeMs: statSync(path).mtimeMs });
        } catch {
          // unreadable log: not evidence
        }
      }
    }
  };
  walk(sessionsRoot);
}
logs.sort((a, b) => b.mtimeMs - a.mtimeMs);

const exposure = new Map(); // card rel → { exposed, read }
const sessionStats = { logs: 0, recallCalls: 0, readCalls: 0, logsWithRecall: 0 };
const NOTE_PATH_RE = /\.deepseek\/(?:memory\/(?:records|templates)|strategy)\/[^\s()"']+\.md/g;
for (const log of logs) {
  let events = [];
  try {
    events = decodeZstdSessionLog(readFileSync(log.path));
  } catch {
    continue;
  }
  sessionStats.logs += 1;
  const callName = new Map();
  const recallResultFor = new Map();
  for (const event of events) {
    if (event?.type === 'tool/call' && typeof event.data?.callId === 'string') callName.set(event.data.callId, String(event.data.name ?? ''));
  }
  let sawRecall = false;
  for (const event of events) {
    if (event?.type !== 'tool/result') continue;
    const name = callName.get(event.data?.callId) ?? '';
    const payload = typeof event.data?.message === 'string' ? event.data.message : JSON.stringify(event.data ?? '');
    if (name === 'note_recall') {
      sawRecall = true;
      sessionStats.recallCalls += 1;
      const found = payload.match(NOTE_PATH_RE) ?? [];
      recallResultFor.set(event.data.callId, new Set(found));
      for (const rel of found) {
        const entry = exposure.get(rel) ?? { exposed: 0, read: 0 };
        entry.exposed += 1;
        exposure.set(rel, entry);
      }
    } else if (name === 'read') {
      sessionStats.readCalls += 1;
      for (const rel of payload.match(NOTE_PATH_RE) ?? []) {
        const entry = exposure.get(rel);
        if (entry !== undefined) entry.read += 1;
      }
    }
  }
  if (sawRecall) sessionStats.logsWithRecall += 1;
}

const neverRead = [...exposure.entries()].filter(([, entry]) => entry.read === 0);

// ── 输出 ────────────────────────────────────────────────────────────────────
const lines = [];
lines.push(`user-burden-probe（只读、零 token）`);
lines.push(`vault: ${vault}`);
lines.push('');
lines.push(`① 死配额：系统留了位置、写了规则要你填的东西`);
lines.push(`   记忆卡总数: ${cards.length}（records/templates/strategy 三层）`);
lines.push(`   note_recall 被动信号: calls=${recallMeta.calls ?? '（无 retrieval-stats.json）'} empty=${recallMeta.empty ?? '—'} · 有命中记录的卡: ${hitCards}`);
for (const row of deadQuota) {
  lines.push(`   [${row.verdict}]`);
  lines.push(`     ${row.quota}`);
  lines.push(`     你要付的代价: ${row.howUserPays}`);
  lines.push(`     真实库现状: ${row.status} ⇒ 已填 ${row.count}/${cards.length}`);
}
lines.push(`   参考（不是配额，是"系统已能自己知道"的那部分）:`);
lines.push(`     origin 已标注: ${cards.length - originUnknown.length}/${cards.length}（未标注 ${originUnknown.length}）`);
lines.push(`     卡内含 AI 补全标记: ${aiMarked.length}`);
lines.push('');
lines.push(`② 结局：暴露 × 是否被读（来源：会话日志）`);
lines.push(`   日志: ${sessionsRoot}`);
lines.push(`   扫描日志 ${sessionStats.logs} 个 · note_recall 调用 ${sessionStats.recallCalls} 次（其中 ${sessionStats.logsWithRecall} 个日志里有）· read 调用 ${sessionStats.readCalls} 次`);
if (sessionStats.recallCalls === 0) {
  lines.push(`   ⚠️ 本环境的会话日志里没有 note_recall 调用 ⇒ **没有样本**，不能据此判断任何一张卡。`);
  lines.push(`      （这不等于"插件没用过"：可能只是这套日志不属于运行插件的那个 profile。）`);
} else {
  lines.push(`   被暴露过的卡: ${exposure.size} 张 · 其中从未被 read 的: ${neverRead.length} 张`);
  for (const [rel, entry] of [...exposure.entries()].sort((a, b) => b[1].exposed - a[1].exposed).slice(0, 10)) {
    lines.push(`     ${String(entry.exposed).padStart(3)} 次暴露 / ${entry.read} 次被读  ${rel}`);
  }
}
lines.push('');
lines.push(`结论口径：① 里标 DEAD 的配额，就是"用户被要求做但从未做的事"——按原则应当改由系统自己测`);
lines.push(`（判据：能从文件系统确定性推出的事实，不得要求用户报告）。② 只有在有样本时才下结论。`);

if (asJson) {
  console.log(JSON.stringify({ vault, cards: cards.length, recallMeta, hitCards, deadQuota, originUnknown: originUnknown.length, aiMarked: aiMarked.length, sessionStats, exposure: [...exposure.entries()], neverRead: neverRead.map(([rel]) => rel) }, null, 2));
} else {
  console.log(lines.join('\n'));
}
