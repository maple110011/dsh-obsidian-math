// scripts/test-tool-shape.mjs — 真调共用管线，断言**工具边界上的返回值**没有多字段。
//
// WHY: `note_recall` / `note_strategy` 的返回值不是手写对象，而是共用管线
// (`rankRecallDocuments` / `rankStrategyCards`) 的结果。管线要保持丰富（QA 探针也用它），
// 所以"多字段"的风险恰恰出现在**工具边界**——而 dsh ≥0.1.5 对成功返回值做严格校验，
// schema 又是 `additionalProperties: false`：多一个字段 = 每次调用都失败
// （2026-09-14 真实故障：match 对象里的 hook/boundary 被直通进 note_recall）。
//
// 这个套件**真的调用管线**（小夹具），再对结果做递归的"声明 vs 实际"检查——静态文本
// 匹配看不见嵌套对象，这里补上。零 token、不需要模型。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = await import(pathToFileURL(join(root, 'dsh', 'preset', 'note-tools.mjs')).href);

let passed = 0;
let total = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};

const source = readFileSync(join(root, 'dsh', 'preset', 'note-tools.mjs'), 'utf8');

/** 取某工具 `output.schema` 的数据字面量（源码内是纯数据）。 */
function schemaSpec(toolName) {
  const needle = 'ctx.tools.register(defineTool({';
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at < 0) throw new Error(toolName + ' not found');
    const open = source.indexOf('{', at + needle.length - 1);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const block = source.slice(open, end + 1);
    from = end;
    if (!new RegExp('name:\\s*"' + toolName + '"').test(block)) continue;
    const outputAt = block.indexOf('output: {');
    const outputOpen = block.indexOf('{', outputAt);
    let d2 = 0;
    let outputEnd = -1;
    for (let i = outputOpen; i < block.length; i += 1) {
      if (block[i] === '{') d2 += 1;
      else if (block[i] === '}') { d2 -= 1; if (d2 === 0) { outputEnd = i; break; } }
    }
    const outputBody = block.slice(outputOpen, outputEnd + 1);
    const schemaAt = outputBody.indexOf('schema: {');
    const schemaOpen = outputBody.indexOf('{', schemaAt);
    let d3 = 0;
    let schemaEnd = -1;
    for (let i = schemaOpen; i < outputBody.length; i += 1) {
      if (outputBody[i] === '{') d3 += 1;
      else if (outputBody[i] === '}') { d3 -= 1; if (d3 === 0) { schemaEnd = i; break; } }
    }
    // eslint-disable-next-line no-new-func -- 纯数据字面量，源码是本仓库的
    return new Function('return (' + outputBody.slice(schemaOpen, schemaEnd + 1) + ')')();
  }
}

/** 递归比较声明与值：每一层对象的键都必须被声明。 */
function extraKeys(spec, value, path = 'value', found = []) {
  if (spec === null || typeof spec !== 'object' || value === null || typeof value !== 'object') return found;
  if (spec.type === 'array') {
    for (const [index, item] of (Array.isArray(value) ? value : []).entries()) {
      extraKeys(spec.items ?? {}, item, path + '[' + index + ']', found);
    }
    return found;
  }
  const props = spec.properties;
  if (props === undefined) return found; // json / 自由形状
  const declared = new Set(Object.keys(props));
  for (const key of Object.keys(value)) {
    if (!declared.has(key)) found.push(path + '.' + key);
  }
  for (const [key, child] of Object.entries(props)) {
    if (value[key] !== undefined) extraKeys(child, value[key], path + '.' + key, found);
  }
  return found;
}

// ── 夹具：两张记忆卡（其中一张带适用边界），走真管线 ────────────────────────
const RECORD = [
  '---',
  'title: 子列收敛技巧',
  'status: active',
  'hook:',
  '  operator: bound',
  '  verified: user-confirmed',
  '  uses: 3',
  '  success_rate: 0.66',
  '  not_applicable_when: 有限维 / 紧集',
  '---',
  '先取子列，再用 Borel-Cantelli 把 a.s. 收敛拉回来。'
].join('\n');
const STRATEGY = [
  '---',
  'title: 定义层证明冗长',
  'difficulty: 定义层证明冗长',
  'strategy: 定义层证明冗长时，把定义展开成可操作的不等式，再回到定义核对。',
  'moves:',
  '  - 先换等价刻画',
  '  - 再回到定义',
  'retrieve:',
  '  - .deepseek/memory/records/subsequence-trick.md',
  'abstraction: 把定义展开成可操作的不等式',
  'not_applicable_when: 有限维',
  'hook:',
  '  verified: single-source',
  '---',
  '正文。'
].join('\n');
const docRecord = tools.buildRecallDoc('.deepseek/memory/records/subsequence-trick.md', RECORD);
// 策略层在 `.deepseek/strategy/`（`classifyVaultDoc` 只认这个前缀；`.deepseek/memory/strategy/`
// 会被判成普通笔记 → strategy 字段为空 → rankStrategyCards 直接跳过。第一版夹具就踩了这个）。
const docStrategy = tools.buildRecallDoc('.deepseek/strategy/strat-a.md', STRATEGY);
check('夹具：两张卡都解析出来了', docRecord !== null && docStrategy !== null);

// 查询里**故意**带边界短语 → applicability gate 把卡放进 excluded，覆盖那条分支。
const ranked = tools.rankRecallDocuments([docRecord, docStrategy], '定义层证明 有限维 子列', { limit: 5 });
check('夹具：边界门控真的排除了卡（excluded 分支被覆盖）', ranked.excluded.length > 0, 'excluded=' + ranked.excluded.length + ', matches=' + ranked.matches.length);
// 换个不触发边界的查询 → 拿到 matches（工具边界上要收窄的另一条路径）。
const rankedHit = tools.rankRecallDocuments([docRecord, docStrategy], '子列 收敛 技巧', { limit: 5 });
check('夹具：换查询能拿到 matches（matches 分支被覆盖）', rankedHit.matches.length > 0, 'matches=' + rankedHit.matches.length);

// 修复后工具真正返回的形状 = 管线 matches（收窄现在发生在管线内部）。
const narrowedMatches = rankedHit.matches.map((match) => ({ ...match }));
// 修复**前**的形状：同样的 match 再加两个内部字段（就是让 dsh 校验失败的那种）。
const passThroughMatches = narrowedMatches.map((match) => ({ ...match, hook: { verified: 'user-confirmed' }, boundary: '有限维' }));
const narrowedExcluded = ranked.excluded.map((item) => ({
  path: item.path,
  title: item.title,
  boundary: item.boundary,
  boundaryHits: item.boundaryHits
}));
const recallNarrowed = { query: 'q', mode: ranked.mode, operator: ranked.operator, matches: narrowedMatches, excluded: narrowedExcluded };

// ① 收窄后的值必须没有未声明字段（matches 与 excluded 两条路径都被覆盖）。
const recallExtras = extraKeys(schemaSpec('note_recall'), recallNarrowed);
check('note_recall（收窄后）：matches/excluded 没有未声明字段', recallExtras.length === 0, recallExtras.join(', '));

// ② 反证：**直通**的 matches 必须被判出多余字段 —— 证明这个检查看得见这次的缺陷。
const rawShape = extraKeys(schemaSpec('note_recall'), { query: 'q', mode: ranked.mode, operator: null, matches: passThroughMatches, excluded: [] });
check('反证：管线 matches 直通值（带 hook/boundary）会被判出多余字段', rawShape.some((key) => /matches\[\d+\]\.(hook|boundary)$/.test(key)), rawShape.join(', ') || '(none)');

// ②b 同一条反证用 dsh 自己的校验器再跑一遍（有本地 dsh-tools 时）。
const validatorPath = join(process.env.DSH_HOME || join(process.env.USERPROFILE ?? '', '.dsh'), 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
if (existsSync(validatorPath)) {
  const { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } = await import(pathToFileURL(validatorPath).href);
  const json = valueSchemaSpecToJsonSchema(schemaSpec('note_recall'));
  const widened = { query: 'q', mode: ranked.mode, operator: null, matches: passThroughMatches, excluded: [] };
  const violations = validateJsonSchemaValue(json, widened, 'value');
  check('反证（dsh 校验器）：直通值必须被判违规', violations.length > 0, violations.slice(0, 2).join(' / '));
  const clean = validateJsonSchemaValue(json, recallNarrowed, 'value');
  check('dsh 校验器：收窄后的值必须通过', clean.length === 0, clean.slice(0, 2).join(' / '));
} else {
  console.log('[skip] 用 dsh 的校验器复核 | 没有本地 dsh-tools');
}

// ③ 策略卡：excluded 收窄 + matches 带 title。
const strategyRanked = tools.rankStrategyCards([docStrategy], '定义层证明冗长 展开 不等式', { limit: 3 });
check('夹具：策略卡命中了（note_strategy 的 matches 分支）', strategyRanked.matches.length > 0, 'matches=' + strategyRanked.matches.length);
const strategyExtras = extraKeys(schemaSpec('note_strategy'), {
  query: '定义层证明冗长',
  matches: strategyRanked.matches.map(({ path, title, difficulty, verified, score }) => ({
    path, title, difficulty, moves: [], retrieve: [], abstraction: '', notApplicableWhen: '', verified, score
  })),
  excluded: strategyRanked.excluded.map((item) => ({
    path: item.path, title: item.title, boundary: item.boundary, boundaryHits: item.boundaryHits
  }))
});
check('note_strategy：matches/excluded 没有未声明字段', strategyExtras.length === 0, strategyExtras.join(', '));

// ④ 管线本身现在也**不再**带内部字段（2026-09-14 的修复把收窄放进了管线，因为
//    note_recall 的 excluded 一度是空的 —— 那是另一条更严重的缺陷：`entry.doc.*` 的
//    形状错误让 excluded 里全是 undefined，只有 schema 校验能发现）。
const pipelineKeys = Object.keys(rankedHit.matches[0] ?? {});
check('rankRecallDocuments 的 matches 不再带 hook/boundary（收窄在管线内）', !pipelineKeys.includes('hook') && !pipelineKeys.includes('boundary'), pipelineKeys.join(','));
check('rankRecallDocuments 的 excluded 是真实卡片（不是 undefined）', ranked.excluded.every((item) => typeof item.path === 'string' && item.path !== '' && typeof item.title === 'string'), JSON.stringify(ranked.excluded).slice(0, 200));

console.log('__CHECKS__ ' + passed + '/' + total);
process.exit(passed === total ? 0 : 1);
