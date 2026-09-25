// scripts/lib/isolated-dsh-home.mjs — 给探针一个**能启动但不污染用户状态**的 $DSH_HOME。
//
// WHY THIS EXISTS（2026-09-25，我自己踩的坑）。`dsh/profile/math-memory-workspace.mjs` 会把
// `DSH_WORKSPACE_ROOT` **登记**进 `$DSH_HOME/storages/workspace.json`，而这条登记是**持久**的：
// 它会出现在用户侧栏的「工作区」列表里。所有 QA 探针都为"不碰真实 vault"用 `mkdtempSync` 造临时
// vault 起 dsh —— 于是**每跑一次探针，就往用户的真实工作区表里塞一条**
// `C:\Windows\Temp\dsh-*-probe-*/vault`。反复调试几天累计 38 条，列表被同名 `vault` 填满之后
// 页面会先显示"选择工作区"而不是直接给输入框 —— **看起来像功能坏了**，实际是探针弄脏了用户环境。
// 详见 `docs/handoff.md` §4 陷阱 91。
//
// 修法不是"记得清理"，而是**让探针从一开始就写不到那张表**：给它一个临时 `$DSH_HOME`，
// 并把启动 profile 所需的文件**种**进去（profile 文件 + 预设 + `node_modules` 符号链接）。
// 种进去的文件是从真实 home **复制**的，所以探针仍然在测"用户实际装的那套"，只是写的是副本。
import { cpSync, existsSync, mkdirSync, symlinkSync, readdirSync, lstatSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 把 `realHome` 里启动 `profile` 所需的东西种进 `home`。
 *
 * @param home - 临时 `$DSH_HOME`（必须已存在）。
 * @param realHome - 真实的 `$DSH_HOME`。
 * @param opts.profile - profile 名（默认 `notes-assistant`）。
 * @returns {{ profileRoot: string, patch: string|null }}
 */
export function seedIsolatedHome(home, realHome, opts = {}) {
  const profile = opts.profile ?? 'notes-assistant';
  const profileRoot = join(home, 'profiles', profile);
  const realProfile = join(realHome, 'profiles', profile);
  mkdirSync(profileRoot, { recursive: true });

  // 顶层文件（cordis.yml / *.patch.yml / *.mjs / package.json / pnpm-workspace.yaml …）。
  // 逐项复制而不是整个目录：真实 profile 下可能有体积很大的 node_modules。
  let entries = [];
  try { entries = readdirSync(realProfile); } catch { entries = []; }
  let copied = 0;
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const from = join(realProfile, name);
    try {
      // 只复制普通文件：目录（含 junction）一律跳过，避免跟着链接递归。
      if (!lstatSync(from).isFile()) continue;
      cpSync(from, join(profileRoot, name));
      copied += 1;
    } catch (error) {
      console.warn(`isolated-dsh-home: 复制 ${name} 失败：${String(error?.message ?? error)}`);
    }
  }

  // node_modules：**符号链接**而不是复制。启动 profile 需要从 `node_modules` 解析
  // `@dsh-math-memory/*` 与 `@linxin666/*`（皮肤），复制一份代价太大；链接读的还是用户那份，
  // 但 dsh 往里写的东西（storage/session）落在临时 home 里 —— 这正是我们要的边界。
  const realModules = join(realProfile, 'node_modules');
  let linked = false;
  if (existsSync(realModules) && !existsSync(join(profileRoot, 'node_modules'))) {
    try {
      symlinkSync(realModules, join(profileRoot, 'node_modules'), 'junction');
      linked = true;
    } catch (error) {
      console.warn(`isolated-dsh-home: node_modules junction 建不起来：${String(error?.message ?? error)}`);
    }
  }

  const patch = join(profileRoot, `${profile}.patch.yml`);
  // 种子的结果直接说出来：探针起不来时，第一件要判断的事就是"副本到底种全了吗"。
  console.log(`  [seed] ${profileRoot}：${copied} 个文件${linked ? ' + node_modules 链接' : ''}`);

  const storages = join(home, 'storages');
  if (!existsSync(storages)) { try { mkdirSync(storages, { recursive: true }); } catch { /* ignore */ } }

  return { profileRoot, patch: existsSync(patch) ? patch : null };
}

/**
 * 删掉种子出来的临时 home。
 *
 * WHY 单独一个函数：里面那个 `node_modules` 是 **junction**，而 `rmSync(dir, {recursive:true})` 在
 * Windows 上会**跟着链接走/或在链接上失败** —— 实测 `rmSync` 抛错被 catch 吞掉之后，`%TEMP%` 里
 * 攒了一堆 `dsh-preset-home-*`。所以这里**先摘链接**（`rmdirSync`/`unlinkSync` 只删链接本身，
 * 不动目标），再删目录，并且**先删文件再删目录**（`rmSync` 直接删目录同样会踩链接）。
 * 只用于我们自己 mkdtemp 出来的目录。
 */
export function removeIsolatedHome(home) {
  if (typeof home !== 'string' || home === '') return false;
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name);
      let st = null;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) {
        // 只摘链接本身：`rmdirSync` 对目录联接有效，`unlinkSync` 对文件符号链接有效。
        try { rmdirSync(p); } catch { try { unlinkSync(p); } catch { /* ignore */ } }
        continue;
      }
      if (st.isDirectory()) { walk(p); try { rmdirSync(p); } catch { /* ignore */ } continue; }
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  };
  walk(home);
  try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  return !existsSync(home);
}
