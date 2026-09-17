// scripts/qa/mutate-readme-pair.mjs — check-readme-pair 的变异验证。
//
// WHY IN-PROCESS. 最早的写法是 fork 出守卫、改文件、看退出码。本仓库的受限环境会
// **禁止管道 stdio**：`spawnSync` 直接 `EPERM`（handoff 坑 56 / run-node.mjs），于是
// spawn 失败被读成"守卫退出 1"，变异验证变成**永远为真**的空壳——正是 AGENTS.md §6
// 说的"守卫必须被证明会失败"要防的那件事。
// 现在改成：读一次真实 README 到内存，对**内存文本**做变异，直接调守卫的纯函数
// `checkPair`，并断言"基线绿、每个变异红"。不产生子进程、不触碰工作树。
//
// 用法：node scripts/check-readme-pair.mjs --selftest
import { checkPair, renderRecord, EN, ZH } from '../check-readme-pair.mjs';

/** 在归一化（LF）文本上做替换：README.zh.md 在工作树里是 CRLF。 */
const sub = (text, from, to) => {
  const lf = text.replace(/\r\n/g, '\n');
  if (!lf.includes(from)) throw new Error(`变异夹具失效：找不到 ${JSON.stringify(from.slice(0, 60))}`);
  return lf.replace(from, to);
};

const MUTATIONS = [
  ['围栏代码块里多一条命令（两侧代码骨架不再一致）', (m) => ({ ...m, zhText: sub(m.zhText, 'npm install -g dsh-math-memory\n', 'npm install -g dsh-math-memory\nnpm run definitely-not-a-real-script\n') })],
  ['某一节多一条一级条目', (m) => ({ ...m, enText: sub(m.enText, '- Default port **3180**', '- An invented prerequisite the other side lacks.\n- Default port **3180**') })],
  ['中文侧删掉语言切换行', (m) => ({ ...m, zhText: sub(m.zhText, '[English](README.md) · [简体中文](README.zh.md)\n', '') })],
  ['两侧相对链接集合不一致', (m) => ({ ...m, enText: sub(m.enText, '[`docs/release.md`](docs/release.md)', '[`docs/release.md`](docs/release.md) 与 [ghost](docs/ghost.md)') })],
  ['同一节在两侧处于不同层级', (m) => ({ ...m, zhText: sub(m.zhText, '### 安全（fail-closed）', '## 安全（fail-closed）') })],
  ['一致性记录缺一行', (m) => {
    const record = renderRecord({ [EN]: 'a'.repeat(40), [ZH]: 'b'.repeat(40) }).replace(/^README\.zh\.md: .*$/m, '');
    return { ...m, recordText: record };
  }],
  ['只改了英文一侧（记录随之失配）', (m) => ({ ...m, enText: `${m.enText}\nOne extra English-only line.\n` })],
  ['只改了中文一侧（记录随之失配，且必须指出是 zh 侧）', (m) => ({ ...m, zhText: `${m.zhText}\n只多出来的一行中文。\n` })],
];

/**
 * @param {{enText: string, zhText: string}} files 真实 README 的内容（由调用方读盘）
 * @returns {{ok: boolean, lines: string[], failures: string[]}}
 */
export function runSelfTest(files) {
  const lines = [];
  const failures = [];
  const baseline = checkPair({ ...files, recordText: null });
  if (baseline.problems.length !== 1 || !baseline.problems[0].startsWith(`缺少 ${'README.i18n.yaml'}`)) {
    failures.push(`基线不干净：除"缺少 README.i18n.yaml"外还有 ${baseline.problems.length - 1} 个问题 —— ${baseline.problems.filter((p) => !p.startsWith('缺少 ')).join(' / ')}`);
  }
  // 用真实 hash 造一份记录 ⇒ 基线必须完全变绿（这同时验证记录机制本身能自我一致）。
  const record = renderRecord(baseline.hashes);
  const green = checkPair({ ...files, recordText: record });
  if (green.problems.length !== 0) failures.push(`记录两侧当前 hash 后仍有问题：${green.problems.join(' / ')}`);

  lines.push(`基线：不记录 ⇒ ${baseline.problems.length} 个问题；记录两侧当前 hash ⇒ ${green.problems.length} 个问题`);
  lines.push('变异验证（每个变异都必须让守卫变红）');

  let caught = 0;
  for (const [name, mutate] of MUTATIONS) {
    const mutated = mutate({ ...files, recordText: record });
    const r = checkPair({ enText: mutated.enText, zhText: mutated.zhText, recordText: mutated.recordText ?? record });
    const red = r.problems.length > 0;
    if (red) caught += 1;
    else failures.push(`变异未被抓住：${name}`);
    lines.push(`${red ? '红 ✓' : '绿 ✗'}  ${name}`);
    lines.push(`        ${(r.problems[0] ?? '(无 FAIL)').slice(0, 170)}`);
  }

  // 驱动侧断言：只改一侧时，报告必须点出**是哪一侧**（"最近被编辑的一侧即源"这个约定
  // 只有在守卫说得出方向时才对维护者有用）。
  const onlyEn = checkPair({ ...files, enText: `${files.enText}\nOne extra English-only line.\n`, recordText: record });
  if (!onlyEn.driftedSide || onlyEn.driftedSide.join() !== EN) failures.push(`只改英文侧时 driftedSide=${JSON.stringify(onlyEn.driftedSide)}，期望 ["${EN}"]`);
  const onlyZh = checkPair({ ...files, zhText: `${files.zhText}\n只多出来的一行中文。\n`, recordText: record });
  if (!onlyZh.driftedSide || onlyZh.driftedSide.join() !== ZH) failures.push(`只改中文侧时 driftedSide=${JSON.stringify(onlyZh.driftedSide)}，期望 ["${ZH}"]`);

  lines.push('');
  lines.push(`${caught}/${MUTATIONS.length} 个变异被抓住；基线绿=${green.problems.length === 0}；漂移方向可判定=${failures.length === 0 || failures.every((f) => !f.includes('driftedSide'))}`);
  for (const f of failures) lines.push(`FAIL  ${f}`);
  return { ok: failures.length === 0 && caught === MUTATIONS.length, lines, failures };
}
