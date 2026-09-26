/**
 * Read a panel response WITHOUT assuming its body is JSON.
 *
 * WHY (2026-09-26, real-machine): every call site used `await res.json()`. When the
 * route is not mounted — the client half was installed but the host half had skipped
 * activation — dsh answers **404 with an empty body**, and the panel showed
 *
 *     加载失败：SyntaxError: Unexpected end of JSON input
 *
 * which blames the parser and says nothing about the real problem. A response carries
 * TWO facts (status and body); report both, and never let "empty" look like "corrupt".
 *
 * Kept as a plain module (not inline JSX) so a Node test can drive it with fake
 * responses — the panel's own failure modes deserve to be tested, not eyeballed.
 */

/**
 * @param {Response|{ok: boolean, status: number, text: () => Promise<string>}} res
 * @param {string} what - human name of the call, used in the message.
 * @returns {Promise<any>} the parsed JSON body.
 * @throws {Error} with the HTTP status when the response is not ok, or when an ok
 *   response carries no JSON at all.
 */
export async function readJson(res, what = "面板接口") {
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json = null;
  if (text !== "") {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const status = Number(res?.status ?? 0);
  const serverError = json !== null && typeof json.error === "string" && json.error !== "" ? json.error : "";
  if (!res?.ok) {
    const detail = serverError !== ""
      ? serverError
      : text === ""
        ? "空响应 —— 路由可能没挂上（宿主半个没激活？）"
        : text.slice(0, 200);
    throw new Error(`${what} HTTP ${status}：${detail}`);
  }
  if (json === null) {
    throw new Error(`${what} 返回了非 JSON 内容（HTTP ${status}）—— 这条路径可能被别的处理器接管了`);
  }
  return json;
}

/**
 * `fetch` + `readJson` in one call. Also used for the POST routes so every call site
 * reports failures the same way.
 */
export async function requestJson(url, init, what = "面板接口") {
  const res = await fetch(url, init);
  return readJson(res, what);
}
