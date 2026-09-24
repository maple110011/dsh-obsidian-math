// scripts/lib/extract-bundle-function.mjs — 从**构建产物**里按 AST 取出"闭包住某个锚点"的实现片段。
//
// WHY。端到端探针要在真实页面里跑「仓库那份产物」的 drop 逻辑，而产物是
// `window.__ModuleLoader__.load({ id, factory })` 形状的 IIFE：想通过 ModuleLoader 求值它，
// 就需要 `factory(require)` 里那些**宿主才有的**模块（react 等），而宿主没有公开的读取通道
// （实测：`window.__ModuleLoader__` 上只有 `create`/`load`，react 实例在模块系统内部）。
// 所以换路子：把**实现那几个片段**从产物文本里切出来单独求值。
//
// 这与本仓库既有手法同源：`check-embedded-loader.mjs` 与 `test-panel-present.mjs` 都从源码文本里
// 取片段求值，测的是**真源码**而不是副本。
//
// ⚠️ 但**不要自己写括号配平**。第一版就是这么写的，然后被压缩后一段正则字符类
// `[\u0000-\u001f\u007f-\u009f"]` 里的 `"]` 骗过 —— 它把正则当成了字符串，配平失衡，而失败的
// 样子是「解不出某个名字」，看起来像源码变了。区分"正则字面量"与"除号"需要真正的词法分析，
// 所以这里用 **acorn 解析成 AST**，按节点范围切片：准确，且错了会明确报解析失败。
import { parse } from 'acorn';

/** 解析产物（普通脚本，非 ESM）；失败时把原因说清楚。 */
function parseBundle(text) {
  try {
    return parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch (error) {
    throw new Error(`解析构建产物失败（${error.message}）——产物可能不是普通脚本形态了`);
  }
}

/** 遍历 AST（跳过位置字段）。 */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (value !== null && typeof value === 'object') walk(value, visit);
  }
}

/** 所有函数节点（声明/表达式/箭头）。 */
function functionNodes(ast) {
  const out = [];
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') out.push(node);
  });
  return out;
}

/** 包含 `at` 偏移的**最内层**函数节点（范围最小的那个）。 */
function innermostFunctionAt(nodes, at) {
  let best = null;
  for (const node of nodes) {
    if (node.start <= at && at < node.end && (best === null || (node.end - node.start) < (best.end - best.start))) best = node;
  }
  return best;
}

/**
 * 包含 `at` 偏移的**最内层具名函数**（`FunctionDeclaration` / `FunctionExpression`，且 `id` 非空）。
 *
 * ⚠️ 为什么不能直接用 `innermostFunctionAt`：产物整体包在
 * `window.__ModuleLoader__.load({ factory: (require) => { … } })` 里，于是**任何**位置的最内层
 * 函数都可能是那个巨大的 `factory` 箭头 —— 它把整个模块都包在里面。第一版就因此把"包含某字面量
 * 的函数"判成了 factory（匿名），报出"安装器是匿名函数"这种与事实无关的错。
 *
 * 这里用带栈的遍历，返回**当前最内层的具名声明**，而不是"范围最小的那个函数"。
 */
function innermostNamedFunctionAt(ast, at) {
  let found = null;
  const visit = (node, stack) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) visit(child, stack); return; }
    if (typeof node.type !== 'string') return;
    const isNamedFn = (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id !== null && node.id !== undefined;
    if (node.start <= at && at < node.end && isNamedFn) found = node; // 越深越后赋值 ⇒ 自然是最内层
    const next = isNamedFn ? node : stack;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (value !== null && typeof value === 'object') visit(value, next);
    }
  };
  visit(ast, null);
  return found;
}

/** 包含 `at` 偏移的最内层**任意**函数（用于箭头形式的 helper，如 `var f = (t) => …`）。 */
function innermostFunctionContaining(ast, at) {
  let found = null;
  const visit = (node, stack) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) visit(child, stack); return; }
    if (typeof node.type !== 'string') return;
    const isFn = /Function/.test(node.type) || node.type === 'ArrowFunctionExpression';
    if (node.start <= at && at < node.end && isFn) found = node;
    const next = isFn ? node : stack;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (value !== null && typeof value === 'object') visit(value, next);
    }
  };
  visit(ast, null);
  return found;
}

/**
 * 声明表：name → 候选列表（**可能多个同名候选**，压缩后短名会撞车）。
 *
 * 不在这里排除"函数体内的声明"：模块整体包在 `factory` 箭头里，而我们要的常量
 * （`var j="…"`）也在其中，一刀切会把它们全丢掉（试过：结果是运行时 `j is not defined`）。
 * 真正的甄别放在 `visibleDecl`：按名字 + 形态挑，而不是按"嵌不嵌套"。
 */
function topLevelDecls(ast) {
  const byName = new Map();
  const push = (name, entry) => {
    const list = byName.get(name) ?? [];
    list.push(entry);
    byName.set(name, list);
  };
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id !== null) {
      push(node.id.name, { start: node.start, end: node.end });
      return;
    }
    if (node.type !== 'VariableDeclaration') return;
    for (const decl of node.declarations) {
      if (decl.id.type !== 'Identifier') continue;
      push(decl.id.name, { start: node.start, end: node.end });
    }
  });
  return byName;
}

/**
 * 从一段声明片段里取出它声明的名字（`function NAME(` / `var|let|const NAME =`），取不到返回 null。
 */
function declaredNameOf(slice) {
  const fn = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/u.exec(slice);
  if (fn !== null) return fn[1];
  const v = /^\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/u.exec(slice);
  if (v !== null) return v[1];
  return null;
}

/**
 * 找 `name` 在使用位置 `useAt` 处**真正可见**的声明。
 *
 * 两道判据，缺一不可：
 *   ① **形态**：片段必须是一条声明（`function NAME(` / `var|let|const NAME =`），
 *      否则会把别人函数体里的语句片段当声明抽出来（报 `missing ) after argument list`）；
 *   ② **名字匹配**：片段声明的名字必须就是我们要的那个 —— 压缩后短名到处都是，
 *      按名字取候选必然撞车，这一条把"名字撞车"直接挡住。
 * 在所有通过的候选里取**起始位置最接近使用点**的那个（词法遮蔽的正确近似）。
 */
function visibleDecl(text, candidates, useAt, wantedName) {
  if (candidates === undefined) return null;
  const before = candidates.filter((c) => c.start < useAt).sort((a, b) => b.start - a.start);
  const after = candidates.filter((c) => c.start >= useAt).sort((a, b) => a.start - b.start);
  for (const c of [...before, ...after]) {
    const slice = text.slice(c.start, c.end);
    const declared = declaredNameOf(slice);
    if (declared === null || declared !== wantedName) continue;
    return slice;
  }
  return null;
}

/**
 * 一段函数源码里**被引用的标识符**，由 AST 收集，而不是正则扫词。
 *
 * ⚠️ 正则版踩的坑：正则会命中字符串里的 `\u0000` 转义（文字上是 `u0000`，于是被当成名字
 * **`u`**），也会命中属性名、对象字面量的键。这些"名字"再拿去当自由变量解析，就会切出别人
 * 函数体里的 `let u = await fetch(…)` —— 三轮排查都卡在这里。用 AST 收集则不会有这类噪声：
 * 只取 `Identifier` 节点，且跳过非计算属性名与键位置。
 */
function referencedNames(source) {
  let ast;
  try {
    ast = parse(`(function(){${source}})`, { ecmaVersion: 'latest' });
  } catch {
    return new Set();
  }
  const names = new Set();
  const visit = (node, parent) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) visit(child, parent); return; }
    if (typeof node.type !== 'string') return;
    if (node.type === 'Identifier') {
      const isKey = parent !== null && parent.type === 'Property' && parent.key === node && parent.computed !== true;
      const isMemberProp = parent !== null && parent.type === 'MemberExpression' && parent.property === node && parent.computed !== true;
      const isDeclaredHere = parent !== null && parent.type === 'VariableDeclarator' && parent.id === node;
      const isParam = parent !== null && /Function/.test(parent.type) && (parent.params ?? []).includes(node);
      const isFnName = parent !== null && /Function/.test(parent.type) && parent.id === node;
      if (!isKey && !isMemberProp && !isDeclaredHere && !isParam && !isFnName) names.add(node.name);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (value !== null && typeof value === 'object') visit(value, node);
    }
  };
  visit(ast, null);
  return names;
}

const KEYWORDS = new Set(['function', 'return', 'if', 'else', 'let', 'const', 'var', 'new', 'typeof', 'for', 'while', 'try', 'catch', 'throw', 'null', 'true', 'false', 'in', 'of', 'break', 'continue', 'instanceof', 'delete', 'void', 'this']);
const BUILTINS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'URL', 'decodeURIComponent', 'encodeURIComponent', 'console', 'document', 'window', 'DataTransfer', 'ClipboardEvent', 'Math', 'JSON', 'undefined', 'Set', 'Map', 'Promise', 'Error']);

/**
 * 按**导出名**取一个函数声明：产物尾部有
 * `ce(Se,{apply:()=>Ce,inject:()=>Ee,installComposerDropMention:()=>N})` 这样的导出表，
 * 把 `installComposerDropMention` 映射到压缩后的短名。
 *
 * ⚠️ 为什么不用"标记名字符串"当锚点：`__dshMathMemoryDropMention` 在产物里只出现**一次** ——
 * 在 `var j="…"` 的初始化值里；安装器体内引用的是**变量名**（`s[j]`）。所以"找包含该字面量的
 * 函数"永远找不到安装器。导出表是**语义**锚点，不随压缩改名。
 *
 * 也不要求它是 `Program` 的直接子节点：产物把整个模块包在
 * `window.__ModuleLoader__.load({ factory: (require) => { … } })` 里，所以声明可能嵌在
 * `factory` 体内（实测如此）。按 `FunctionDeclaration` 名字在**全树**里找即可。
 */
function findExportedFunction(ast, text, exportName) {
  let targetName = null;
  walk(ast, (node) => {
    if (targetName !== null || node.type !== 'Property') return;
    if (node.key === undefined || node.value === undefined) return;
    const keyName = node.key.type === 'Identifier' ? node.key.name : (node.key.type === 'Literal' ? String(node.key.value) : null);
    if (keyName !== exportName) return;
    if (node.value.type === 'ArrowFunctionExpression' && node.value.body.type === 'Identifier') targetName = node.value.body.name;
    else if (node.value.type === 'Identifier') targetName = node.value.name;
  });
  if (targetName === null) throw new Error(`导出表里找不到 ${exportName}（产物形态变了）`);

  let hit = null;
  walk(ast, (node) => {
    if (hit !== null || node.type !== 'FunctionDeclaration' || node.id === null) return;
    if (node.id.name === targetName) hit = node;
  });
  if (hit === null) throw new Error(`导出 ${exportName} 指向 ${targetName}，但全树里没有这个函数声明`);
  void text;
  return { name: targetName, start: hit.start, end: hit.end };
}

/**
 * 一段源码里**自己声明**的名字（参数、`var/let/const`、内层函数名）。
 *
 * ⚠️ 必须把它们从"引用的自由名字"里排除，否则会去外面找 `n`、`i`、`l` 这种压缩后的**局部**
 * 变量，然后切出 `let i=fe(r);` 这样的语句片段当"声明"用 —— 拼起来就是一堆莫名其妙的
 * 重声明/语法错误。第一版正是这样：连 `"gu"`（正则里的引号标识符）都被当成了名字 `gu`。
 */
function localNamesOf(source, ast) {
  const names = new Set();
  // 先把这段源码解析成一个函数，再收集其中的绑定名。
  let node;
  try {
    node = parse(`(function(){${source}})`, { ecmaVersion: 'latest' });
  } catch {
    return names;
  }
  walk(node, (n) => {
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      for (const p of n.params ?? []) collectPatternNames(p, names);
      if (n.id !== null && n.id !== undefined) names.add(n.id.name);
    }
    if (n.type === 'VariableDeclarator') collectPatternNames(n.id, names);
    if (n.type === 'CatchClause' && n.param !== null) collectPatternNames(n.param, names);
  });
  void ast;
  return names;
}

function collectPatternNames(pattern, out) {
  if (pattern === null || pattern === undefined) return;
  if (pattern.type === 'Identifier') { out.add(pattern.name); return; }
  if (pattern.type === 'ObjectPattern') { for (const p of pattern.properties) collectPatternNames(p.value ?? p.argument, out); return; }
  if (pattern.type === 'ArrayPattern') { for (const p of pattern.elements) collectPatternNames(p, out); return; }
  if (pattern.type === 'AssignmentPattern') { collectPatternNames(pattern.left, out); return; }
  if (pattern.type === 'RestElement') collectPatternNames(pattern.argument, out);
}

/**
 * 一次性切出端到端探针需要的**全部片段**。
 *
 * 返回的 `source` 可直接 `new Function(source)()`；里面已带 `return { install }`。
 * 压缩后的名字每次都变，所以这里**不要求调用方知道任何名字**。
 *
 * @param text - 构建产物（`dsh/client-panel/lib/client.js`）的文本。
 * @returns {{ source: string, names: string[], helpers: string[] }}
 */
export function extractDropMentionProbeSource(text) {
  const ast = parseBundle(text);

  // ① 安装器：按**导出名**定位（`installComposerDropMention`），不按压缩后的短名、也不按字面量。
  const installDecl = findExportedFunction(ast, text, 'installComposerDropMention');
  const installSource = text.slice(installDecl.start, installDecl.end);

  // ② 取 mention 的函数：锚点 = 它读的 MIME。这个字面量只出现在它体内。
  const pickerAnchor = text.indexOf('text/plain');
  if (pickerAnchor < 0) throw new Error('锚点 "text/plain" 不在产物里');
  const pickerNode = innermostFunctionContaining(ast, pickerAnchor);
  if (pickerNode === null) throw new Error('找不到读 text/plain 的函数');
  const pickerSource = text.slice(pickerNode.start, pickerNode.end);

  // ③ 这两段体内引用到的声明（幂等标记常量、解析 URI、格式化 mention…）。
  //
  //    按**使用位置**取可见的那个声明（见 `visibleDecl`）；同一个短名有多个候选时，
  //    取错一个就会拼出 `Identifier 'i' has already been declared` 这种离真因很远的报错。
  //
  //    引用位置用一段体内的**第一次**出现近似（够用：helper 都在同一作用域，且都在使用点之前）。
  const decls = topLevelDecls(ast);
  const helpers = [];
  const seen = new Set();
  for (const [sourceText, baseAt] of [[installSource, installDecl.start], [pickerSource, pickerNode.start]]) {
    const locals = localNamesOf(sourceText, ast);
    for (const name of referencedNames(sourceText)) {
      if (KEYWORDS.has(name) || BUILTINS.has(name)) continue;
      if (locals.has(name)) continue; // 局部绑定：不去外面找
      if (name === installDecl.name || pickerNode.id?.name === name) continue;
      const atInSource = sourceText.indexOf(name);
      const useAt = baseAt + (atInSource < 0 ? 0 : atInSource);
      // 传位置：声明表里有多个同名候选时，取使用位置之前最近的那个。
      const slice = visibleDecl(text, decls.get(name), useAt, name);
      if (slice === null) continue; // 内建/宿主全局：交给运行时
      if (seen.has(slice)) continue;
      seen.add(slice);
      helpers.push(slice);
    }
  }
  void installDecl;

  // 自检：拼起来必须能解析。切错但"看起来能跑"的片段是最危险的形态，这里直接挡住。
  const source = [
    '/* 从 dsh/client-panel/lib/client.js 里按 AST 取出的 drop→mention 实现（探针用） */',
    ...helpers,
    installSource,
    pickerSource,
    `return { install: ${installDecl.name}, picker: ${pickerNode.id?.name ?? 'undefined'} };`
  ].join('\n');
  try {
    // eslint-disable-next-line no-new-func -- 只是让引擎替我们做语法自检
    new Function(source);
  } catch (error) {
    throw new Error(`切出的片段拼不成合法 JS（${error.message}）：说明锚点定位错了，请检查产物形态`);
  }
  return { source, names: [installDecl.name, pickerNode.id?.name ?? '(anonymous)'], helpers };
}
