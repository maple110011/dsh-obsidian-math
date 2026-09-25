// scripts/qa/clean-probe-workspaces.mjs — 摘掉**探针临时目录**在全局工作区表里留下的登记。
//
// 背景：`dsh/profile/math-memory-workspace.mjs` 会把 `DSH_WORKSPACE_ROOT` 登记成一个工作区，
// 而所有 QA 探针都用 mkdtemp 造的临时 vault 起 dsh —— 于是每跑一次探针，用户的
// `$DSH_HOME/storages/workspace.json` 里就多一条 `C:\Windows\Temp\dsh-*` 登记。跑几十次之后
// 侧栏会先弹「选择工作区」（列表里全是垃圾项）而不是直接给输入框 —— 表现就像"功能坏了"。
//
// 这个脚本**只删** `%TEMP%` 下的登记，且**先备份**。默认 dry-run。
//
// 用法：
//   node scripts/qa/clean-probe-workspaces.mjs                 # 只看会删什么
//   node scripts/qa/clean-probe-workspaces.mjs --apply         # 真的删（会写 .bak）
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const STORE = join(DSH_HOME, 'storages', 'workspace.json');
const APPLY = process.argv.includes('--apply');

if (!existsSync(STORE)) {
  console.log(`clean-probe-workspaces: 没有 ${STORE}，无需处理`);
  process.exit(0);
}

const raw = readFileSync(STORE, 'utf8');
const data = JSON.parse(raw);
const table = data?.tables?.workspaces ?? {};
const ids = data?.global?.workspaceIds ?? [];

/** 判据：路径就是系统临时目录、或落在它下面 ⇒ 是探针造的。**只按这一条**，绝不误删用户自己的目录。 */
const isProbe = (p) => {
  const s = String(p ?? '').toLowerCase().replace(/[\\/]+$/u, '');
  const t = tmpdir().toLowerCase().replace(/[\\/]+$/u, '');
  return s === t || s.startsWith(t + '\\') || s.startsWith(t + '/');
};

const doomed = Object.entries(table).filter(([, ws]) => isProbe(ws?.path));
if (doomed.length === 0) {
  console.log('clean-probe-workspaces: 没有临时目录登记，工作区表是干净的');
  process.exit(0);
}

console.log(`clean-probe-workspaces: 发现 ${doomed.length} 条临时目录登记：`);
for (const [id, ws] of doomed) console.log(`  - ${ws?.path}  (title=${ws?.title ?? '?'}, id=${id})`);

if (!APPLY) {
  console.log('\n（dry-run。加 --apply 才会真的摘除；会先写 .bak）');
  process.exit(0);
}

copyFileSync(STORE, STORE + '.bak');
for (const [id] of doomed) delete table[id];
data.global.workspaceIds = ids.filter((id) => table[id] !== undefined);
// 这些临时工作区名下的会话也一并从全局列表里摘掉（会话文件不动，只是不再登记）。
const keptSessions = new Set();
for (const ws of Object.values(table)) for (const s of ws?.sessionIds ?? []) keptSessions.add(s);
if (Array.isArray(data.global.archivedSessionIds)) data.global.archivedSessionIds = data.global.archivedSessionIds.filter((s) => keptSessions.has(s));
if (Array.isArray(data.global.pinnedSessionIds)) data.global.pinnedSessionIds = data.global.pinnedSessionIds.filter((s) => keptSessions.has(s));

writeFileSync(STORE, JSON.stringify(data, null, 2) + '\n', 'utf8');
const after = JSON.parse(readFileSync(STORE, 'utf8'));
console.log(`\n已摘除 ${doomed.length} 条；剩余工作区 ${Object.keys(after.tables.workspaces).length} 个。备份：${STORE}.bak`);
console.log('（dsh 服务需重启后侧栏才会重新读取这张表。）');
