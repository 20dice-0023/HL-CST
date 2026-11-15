// Claude：通过官方 Anthropic SDK（vendor/ 里打包好的浏览器版本）直接从浏览器调用。

import Anthropic from "../../vendor/anthropic-sdk.js";
import { LLMError, redactSecrets } from "../errors.js";

// 这些模型支持服务端拒答回退：被安全分类器误拦时，由 Anthropic 推荐的模型接着答。
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1"]);
// 支持 output_config.effort 的模型。
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-5|^claude-opus-4-[5-8]|^claude-sonnet-4-6/;

// 在 Node 里跑（比如模拟脚本）时，SDK 会去读环境变量：设了 ANTHROPIC_BASE_URL，请求连同 key 就发到那个地址；
// 设了 ANTHROPIC_AUTH_TOKEN，它也会被拿来用。所以地址写死成官方的，authToken 明确设成 null，只用受试者自己填的 key。
// 网页里没有环境变量，不受影响。
const BASE_URL = "https://api.anthropic.com";
const client = (apiKey) => new Anthropic({ apiKey, authToken: null, baseURL: BASE_URL, dangerouslyAllowBrowser: true });

function mapError(e, apiKey) {
  if (e instanceof LLMError) return e;
  const message = redactSecrets(e?.message ?? String(e), apiKey);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new LLMError("auth", message);
  if (e instanceof Anthropic.RateLimitError) return new LLMError("rate", message);
  if (e instanceof Anthropic.NotFoundError) return new LLMError("not_found", message);
  if (e instanceof Anthropic.BadRequestError) return new LLMError("bad_request", message);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new LLMError("timeout", message); // 是 APIConnectionError 的子类，要先判断
  if (e instanceof Anthropic.APIConnectionError) return new LLMError("network", message);
  if (e instanceof Anthropic.InternalServerError) return new LLMError("server", message);
  return new LLMError("unknown", message);
}

/** 一次结构化输出调用，返回模型的原始文本和实际作答的模型名。 */
export async function anthropicCall({ apiKey, model, system, user, schema, effort }) {
  const output_config = { format: { type: "json_schema", schema } };
  if (EFFORT_MODELS.test(model)) output_config.effort = effort;
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config,
  };
  try {
    const c = client(apiKey);
    const res = FALLBACK_MODELS.has(model)
      ? await c.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await c.messages.create(params);
    if (res.stop_reason === "refusal") {
      throw new LLMError("refusal", res.stop_details?.explanation ?? "", { category: res.stop_details?.category ?? "" });
    }
    if (res.stop_reason === "max_tokens") throw new LLMError("truncated");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, model: res.model, usage: res.usage };
  } catch (e) {
    throw mapError(e, apiKey);
  }
}

export async function anthropicListModels(apiKey) {
  try {
    const ids = [];
    for await (const m of client(apiKey).models.list()) ids.push(m.id);
    return ids;
  } catch (e) {
    throw mapError(e, apiKey);
  }
}
