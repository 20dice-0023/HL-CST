// GPT、Gemini、DeepSeek、本地模型和其它 OpenAI 兼容服务：都走 /chat/completions。
// 只发 Content-Type 和 Authorization 两个请求头：多发别的头，有的服务（比如 Gemini）会拒绝浏览器的跨域请求。

import { LLMError, redactSecrets } from "../errors.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 一次请求最多等这么久（和 Claude 的 SDK 默认值一样）：写报告正文、本地模型都可能要几分钟，但不能无限等下去。
export const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const isTimeout = (e) => e?.name === "TimeoutError" || e?.name === "AbortError";
// 模型列表里排除明显不是对话模型的条目。
const NON_CHAT = /(embed|tts|whisper|dall-e|imagen|image|veo|audio|realtime|moderation|transcri|aqa|search|-live)/i;

async function send(url, apiKey, init) {
  const headers = { ...(init.headers ?? {}) };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  try {
    return await fetch(url, { ...init, headers, signal });
  } catch (e) {
    throw new LLMError(isTimeout(e) ? "timeout" : "network", e?.message ?? "");
  }
}

// 429 和 5xx 等一下再试，最多两次。
async function withRetry(fn) {
  const delays = [1000, 3000];
  for (let i = 0; ; i++) {
    const res = await fn();
    if ((res.status === 429 || res.status >= 500) && i < delays.length) {
      await sleep(delays[i]);
      continue;
    }
    return res;
  }
}

async function errorFrom(res, apiKey) {
  let message = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      message = j?.error?.message ?? (Array.isArray(j) ? j[0]?.error?.message : "") ?? text;
    } catch {
      message = text;
    }
  } catch {
    // 读不到正文就算了
  }
  const s = res.status;
  const kind = s === 401 || s === 403 ? "auth" : s === 404 ? "not_found" : s === 429 ? "rate" : s >= 500 ? "server" : s === 400 || s === 422 ? "bad_request" : "unknown";
  return new LLMError(kind, redactSecrets(String(message || s), apiKey).slice(0, 300), { status: s });
}

const withSchemaHint = (system, schema) => `${system}\n\n只输出 JSON。JSON Schema：${JSON.stringify(schema)}`;

/** 一次 JSON 输出调用。jsonMode：json_schema（严格结构化）、json_object（JSON 模式）或 none。 */
export async function openaiCall({ baseURL, apiKey, model, system, user, schema, jsonMode, extraBody = {} }) {
  const url = `${baseURL}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: "system", content: jsonMode === "json_schema" ? system : withSchemaHint(system, schema) },
      { role: "user", content: user },
    ],
    ...extraBody,
  };
  if (jsonMode === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: "output", strict: true, schema } };
  else if (jsonMode === "json_object") body.response_format = { type: "json_object" };

  const post = (b) =>
    withRetry(() => send(url, apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }));
  let res = await post(body);
  if (res.status === 400 && body.response_format) {
    // 有的服务不支持这种输出格式：去掉格式要求再试一次，改靠提示词约束。
    const { response_format: _dropped, ...rest } = body;
    rest.messages = [{ role: "system", content: withSchemaHint(system, schema) }, body.messages[1]];
    res = await post(rest);
  }
  if (!res.ok) throw await errorFrom(res, apiKey);

  let data;
  try {
    data = await res.json();
  } catch (e) {
    // 超时也可能发生在读正文的时候；别的情况是回来的根本不是 JSON。
    throw new LLMError(isTimeout(e) ? "timeout" : "bad_output", e?.message ?? "");
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") throw new LLMError("truncated");
  if (choice?.finish_reason === "content_filter") throw new LLMError("refusal", "", { category: "content_filter" });
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : "";
  return { text, model: data?.model ?? model, usage: data?.usage };
}

export async function openaiListModels({ baseURL, apiKey }) {
  const res = await send(`${baseURL}/models`, apiKey, { method: "GET" });
  if (!res.ok) throw await errorFrom(res, apiKey);
  const data = await res.json();
  const ids = (data?.data ?? data?.models ?? [])
    .map((m) => String(m?.id ?? m?.name ?? "").replace(/^models\//, ""))
    .filter((id) => id && !NON_CHAT.test(id));
  return [...new Set(ids)].sort();
}
