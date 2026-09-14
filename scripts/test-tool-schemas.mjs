// scripts/test-tool-schemas.mjs — 工具声明的 output schema 与它的契约抽查（零 token）。
//
// WHY THIS EXISTS（2026-09-14，用户实测发现）。dsh ≥0.1.5 的 `ToolRuntime` 会对**成功返回值**
// 做严格校验：`validateJsonSchemaValue(tool.output.schema, value)`，而我们的 schema 一律写了
// `additionalProperties: false`。于是**多返回一个 schema 没声明的字段 = 整次调用失败**，
// 模型侧看到 `ToolOutputError`（用户看到的原话："note_recall 目前返回结构不合 schema
// （工具侧报错）"）。这不是"少返回字段"，而是"多返回字段"——单看返回值很健康，只有 schema
// 在旁边才能发现。
//
// 本套件的分工（重要的设计决定，别把两条混起来）：
//   ① 静态（这里）：**声明了但返回表达式里没出现** 的键 —— 只报"缺"，不报"多"。
//      为什么静态不报"多"：这个检查最初用"逗号/冒号切 token"来读键，把
//      `path: args.note ?? "all"` 里的 `:` 当成键分隔符，于是把 `all`、`rel`、`null`
//      这些**值**报成"未声明键"（4 条假阳性）。**假阳性比不检查更糟**——它会教人忽略这个
//      套件。真正看得见"多字段"的是 ② 的反证与 `scripts/test-tool-shape.mjs`（真调管线）。
//   ② 动态：有本地 dsh 时，导入它的 `validateJsonSchemaValue`，用**真实 schema** 校验
//      代表性值（`scripts/fixtures/tool-outputs.json`），含 excluded 等边界分支。
//      没有 dsh 就 SKIP（CI 上就是这样，与 test-panel-auth.mjs 同一约定）。
//   ③ `--mutate`：故意给 match 加一个未声明字段，② 必须报错——守卫必须证明它在该报错时
//      真的报错，而不是"跑起来没报错"。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'dsh', 'preset', 'note-tools.mjs'), 'utf8');

let passed = 0;
let total = 0;
let skipped = 0;
const check = (name, cond, detail = '') => {
  total += 1;
  if (cond) passed += 1;
  console.log((cond ? '[ok] ' : '[FAIL] ') + name + (detail ? ' | ' + detail : ''));
};
const skip = (name, why) => { skipped += 1; console.log('[skip] ' + name + ' | ' + why); };

/** 从源码里切出**每一个** `defineTool({ … })` 调用（按大括号配平）。 */
function allToolBlocks() {
  const blocks = [];
  const needle = 'ctx.tools.register(defineTool({';
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    const open = source.indexOf('{', at + needle.length - 1);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) throw new Error('unbalanced defineTool block');
    blocks.push(source.slice(open, end + 1));
    from = end;
  }
  return blocks;
}

const TOOL_BLOCKS = new Map();
for (const block of allToolBlocks()) {
  const match = /name:\s*"([^"]+)"/.exec(block);
  if (match !== null) TOOL_BLOCKS.set(match[1], block);
}
/** 工具名列表（从源码发现，不手写——新增工具自动纳入）。 */
const TOOLS = [...TOOL_BLOCKS.keys()];

function toolBlock(name) {
  const block = TOOL_BLOCKS.get(name);
  if (block === undefined) throw new Error(`tool ${name} not found (found: ${TOOLS.join(', ')})`);
  return block;
}

/** 取一段 `key: { … }` 的对象字面量（按配平），返回 `{ start, end, body }`。 */
function objectAfter(block, key) {
  const at = block.indexOf(`${key}: {`);
  if (at < 0) return null;
  const braceStart = block.indexOf('{', at);
  let depth = 0;
  for (let i = braceStart; i < block.length; i += 1) {
    if (block[i] === '{') depth += 1;
    else if (block[i] === '}') {
      depth -= 1;
      if (depth === 0) return { start: braceStart, end: i, body: block.slice(braceStart, i + 1) };
    }
  }
  return null;
}

/** output.schema 的顶层 `properties` 键名。 */
function declaredKeys(block) {
  const output = objectAfter(block, 'output');
  if (output === null) return [];
  const schema = objectAfter(output.body, 'schema');
  if (schema === null) return [];
  const props = objectAfter(schema.body, 'properties');
  if (props === null) return [];
  const body = props.body.slice(1, -1);
  const keys = [];
  let inner = 0;
  let token = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') inner += 1;
    else if (ch === '}' || ch === ']' || ch === ')') inner -= 1;
    if (inner === 0 && ch === ':') {
      const match = /([A-Za-z_$][\w$]*)\s*$/.exec(token);
      if (match !== null && !token.includes('?')) keys.push(match[1]);
      token = '';
      continue;
    }
    if (inner === 0 && ch === ',') { token = ''; continue; }
    token += ch;
  }
  return keys;
}

// ── ① 静态：只报"声明了却没在返回表达式里出现" ──────────────────────────────
/** execute 里所有 `return` 语句出现的标识符（粗但只用于"缺不缺"）。 */
function executeIdentifiers(block) {
  const start = block.indexOf('async execute(');
  const body = start < 0 ? block : block.slice(start);
  return new Set(body.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

check('从源码里发现了工具定义', TOOLS.length >= 4, TOOLS.join(', '));
for (const name of TOOLS) {
  const block = toolBlock(name);
  const declared = declaredKeys(block);
  const identifiers = executeIdentifiers(block);
  check(`${name}: schema 声明了属性`, declared.length > 0, declared.join(', '));
  const missing = declared.filter((key) => !identifiers.has(key));
  check(`${name}: schema 声明的每个键在返回值里都出现过`, missing.length === 0, missing.length === 0 ? '' : `缺 ${missing.join(', ')}`);
}

// ── ② 动态：用 dsh 自己的校验器验证代表性值 ────────────────────────────────
const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE ?? '', '.dsh');
const validatorPath = join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
const fixtures = JSON.parse(readFileSync(join(root, 'scripts', 'fixtures', 'tool-outputs.json'), 'utf8'));

/** output.schema 的数据字面量（源码里是纯数据）。 */
function schemaSpec(name) {
  const block = toolBlock(name);
  const output = objectAfter(block, 'output');
  const schema = output === null ? null : objectAfter(output.body, 'schema');
  if (schema === null) throw new Error(`${name}: output.schema not found`);
  // eslint-disable-next-line no-new-func -- 纯数据字面量，源码是本仓库的
  return new Function(`return (${schema.body})`)();
}

if (!existsSync(validatorPath)) {
  skip('用 dsh 的 validateJsonSchemaValue 校验代表性值', `没有本地 dsh-tools（${validatorPath}）`);
} else {
  const { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } = await import(pathToFileURL(validatorPath).href);
  for (const name of TOOLS) {
    const json = valueSchemaSpecToJsonSchema(schemaSpec(name));
    const cases = fixtures[name] ?? [];
    check(`${name}: 有代表性 fixture`, cases.length > 0);
    for (const [index, value] of cases.entries()) {
      const violations = validateJsonSchemaValue(json, value, 'value');
      check(`${name}: fixture#${index} 通过 dsh 的 schema 校验`, violations.length === 0, violations.slice(0, 3).join(' / '));
    }
  }
}

// ── ③ 变异验证（默认关闭，`--mutate` 打开）──────────────────────────────────
if (process.argv.includes('--mutate')) {
  if (!existsSync(validatorPath)) {
    skip('变异验证', '需要本地 dsh-tools');
  } else {
    const { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } = await import(pathToFileURL(validatorPath).href);
    const json = valueSchemaSpecToJsonSchema(schemaSpec('note_recall'));
    const mutated = JSON.parse(JSON.stringify(fixtures.note_recall[0]));
    if (mutated.matches.length > 0) mutated.matches[0].hook = { operator: 'bound' };
    else mutated.matches.push({ path: 'a', kind: 'note', title: 't', snippet: 's', verified: null, hookOperator: null, uses: 0, successRate: null, score: 1, coverage: 1, hook: { operator: 'bound' } });
    const violations = validateJsonSchemaValue(json, mutated, 'value');
    check('变异验证：给 match 加一个未声明字段 → dsh 的校验器必须报错', violations.length > 0, violations.slice(0, 2).join(' / '));
  }
}

console.log(`__CHECKS__ ${passed}/${total}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
process.exit(passed === total ? 0 : 1);
