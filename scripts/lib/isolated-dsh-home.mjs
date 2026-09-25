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
 * @param opts.withPreset - 是否连 `.agent-presets/<profile>/` 一起种（只有需要 agent preset 的探针要）。
 * @returns {{ profileRoot: string, patch: string|null, presetRoot: string|null }}
 */
export function seedIsolatedHome(home, realHome, opts = {}) {
  const profile = opts.profile ?? 'notes-assistant';
  const profileRoot = join(home, 'profiles', profile);
  const realProfile = join(realHome, 'profiles', profile);
  mkdirSync(profileRoot, { recursive: true });

  // 顶层文件（cordis.yml / *.patch.yml / *.mjs / package.json / pnpm-workspace.yaml …）。
  // 用 cpSync 逐项复制而不是 copy 整个目录：真实 profile 下可能有体积很大的 node_modules。
  let entries = [];
  try { entries = readdirSync(realProfile); } catch { entries = []; }
  const TRACE = process.env.SEED_TRACE === '1';
  if (TRACE) console.log(`  [seed] 真实 profile 顶层 ${entries.length} 项: ${entries.join(', ')}`);
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const from = join(realProfile, name);
    try {
      const st = lstatSync(from);
      if (!st.isFile()) { if (TRACE) console.log(`  [seed] 跳过 ${name}（非普通文件: ${st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'other'}）`); continue; }
      if (TRACE) console.log(`  [seed] 复制 ${name} (${st.size}B)`);
      cpSync(from, join(profileRoot, name));
    } catch (error) { if (TRACE) console.log(`  [seed] ${name} 失败: ${String(error?.message ?? error)}`); }
  }

  // node_modules：**符号链接**而不是复制。启动 profile 需要从 `node_modules` 解析
  // `@dsh-math-memory/*` 与 `@linxin666/*`（皮肤），复制一份代价太大；链接读的还是用户那份，
  // 但 dsh 往里写的东西（storage/session）落在临时 home 里 —— 这正是我们要的边界。
  const realModules = join(realProfile, 'node_modules');
  if (TRACE) console.log(`  [seed] node_modules: 真实存在=${existsSync(realModules)} 目标已存在=${existsSync(join(profileRoot, 'node_modules'))}`);
  if (existsSync(realModules) && !existsSync(join(profileRoot, 'node_modules'))) {
    try {
      mkdirSync(join(home, 'profiles', profile), { recursive: true });
      symlinkSync(realModules, join(profileRoot, 'node_modules'), 'junction');
      if (TRACE) console.log('  [seed] node_modules junction 建好');
    } catch (error) { if (TRACE) console.log(`  [seed] junction 失败: ${String(error?.message ?? error)}`); }
  }

  const patch = join(profileRoot, `${profile}.patch.yml`);
  let presetRoot = null;
  if (opts.withPreset === true) {
    if (TRACE) console.log('  [seed] 开始种 preset');
    presetRoot = join(home, '.agent-presets', profile);
    const realPreset = join(realHome, '.agent-presets', profile);
    if (existsSync(realPreset)) {
      mkdirSync(join(home, '.agent-presets'), { recursive: true });
      // ⚠️ **逐文件**复制，绝不 `cpSync(recursive)`：真实 preset 目录里可能有指向
      // `node_modules` 的 junction，递归复制会跟着链接走出去（实测把进程打成栈溢出）。
      let presetEntries = [];
      try { presetEntries = readdirSync(realPreset); } catch { presetEntries = []; }
      mkdirSync(presetRoot, { recursive: true });
      for (const name of presetEntries) {
        const from = join(realPreset, name);
        try {
          const st = lstatSync(from);
          if (!st.isFile()) { if (TRACE) console.log(`  [seed] preset 跳过 ${name}（${st.isSymbolicLink() ? 'symlink' : 'dir'}）`); continue; }
          cpSync(from, join(presetRoot, name));
        } catch (error) { if (TRACE) console.log(`  [seed] preset ${name} 失败: ${String(error?.message ?? error)}`); }
      }
      if (TRACE) console.log(`  [seed] preset 种好: ${existsSync(join(presetRoot, 'agent.cordis.yml'))}`);
    } else if (TRACE) console.log('  [seed] 真实 preset 目录不存在');
  }

  const storages = join(home, 'storages');
  if (!existsSync(storages)) { try { mkdirSync(storages, { recursive: true }); } catch { /* ignore */ } }

  return { profileRoot, patch: existsSync(patch) ? patch : null, presetRoot };
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
