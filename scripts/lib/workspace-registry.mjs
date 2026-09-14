// scripts/lib/workspace-registry.mjs — 清理 dsh 的工作区登记表（探针专用）。
//
// WHY THIS EXISTS. `session/create` 的副作用是**永久登记一个工作区**：dsh 把它写进
// `$DSH_HOME/storages/workspace.json`，而这份表直接喂给侧栏的「工作区」列表。于是任何
// "用一个临时目录建个会话试试"的探针，都会在**用户自己的侧栏里**留下一个他从未创建过的
// 工作区（2026-09-14 实际留下 8 个 `dsh-preset-ws-XXXXXX`，用户发现后我才知道）。
//
// 规则：探针建过什么，就必须自己摘掉什么——**删目录不够**，登记项还在 json 里就照样显示。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 读取登记表；读不到就返回 null（不抛——调用方通常在 finally 里跑）。 */
export function readWorkspaceRegistry(dshHome) {
  try {
    return JSON.parse(readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 登记表里所有工作区的 `path`（用于"跑之前先记住有哪些"）。 */
export function workspacePaths(dshHome) {
  const parsed = readWorkspaceRegistry(dshHome);
  const table = parsed?.tables?.workspaces ?? {};
  return Object.values(table).map((value) => value?.path).filter((path) => typeof path === 'string');
}

/**
 * 从登记表里删掉工作区。
 * @param dshHome - DSH_HOME
 * @param predicate - 收到规范化后的 path（小写、反斜杠归一），返回 true 即删除
 * @returns 删掉的条数；登记表读不到返回 null
 */
export function pruneWorkspaces(dshHome, predicate) {
  const registry = join(dshHome, 'storages', 'workspace.json');
  const parsed = readWorkspaceRegistry(dshHome);
  if (parsed === null) return null;
  const table = parsed?.tables?.workspaces;
  if (table === undefined || table === null) return null;
  const doomed = Object.entries(table)
    .filter(([, value]) => typeof value?.path === 'string' && predicate(value.path.replaceAll('\\', '/').toLowerCase()))
    .map(([id]) => id);
  if (doomed.length === 0) return 0;
  for (const id of doomed) delete table[id];
  if (Array.isArray(parsed.global?.workspaceIds)) {
    parsed.global.workspaceIds = parsed.global.workspaceIds.filter((id) => !doomed.includes(id));
  }
  writeFileSync(registry, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return doomed.length;
}

/**
 * 删掉所有"路径已经不存在于磁盘上"的工作区登记项——探针用临时目录建的会话必然落进这一类，
 * 而真实工作区（用户的 vault / 仓库）永远还在。
 */
export function pruneMissingWorkspacePaths(dshHome, existsSync) {
  return pruneWorkspaces(dshHome, (normalized) => {
    const asNative = normalized.replaceAll('/', '\\');
    return !existsSync(asNative);
  });
}
