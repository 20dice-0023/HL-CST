// 按"角色"调用模型：选对配置、填好提示词、取回 JSON。
// ctx = { settings, secrets, content, demo, demoState }

import { anthropicCall, anthropicListModels } from "./providers/anthropic.js";
import { openaiCall, openaiListModels } from "./providers/openai-compatible.js";
import { demoRespond } from "./providers/demo.js";
import { PROVIDERS, resolveTarget } from "./settings.js";
import { extractJSON, fill } from "./text.js";
import { LLMError } from "./errors.js";
import { SCHEMAS } from "./schemas.js";
import { conform } from "./validate.js";

const PROMPT_OF = {
  writer: "writer",
  auditorQuestions: "auditor-questions",
  coder: "coder",
  coder2: "coder",
  probe: "probe",
  analyst: "analyst",
  auditorHypotheses: "auditor-hypotheses",
  recheck: "auditor-recheck",
  ping: "ping",
  pingAuditor: "ping",
};

const SCHEMA_OF = {
  writer: "writer",
  auditorQuestions: "auditorQuestions",
  coder: "coder",
  coder2: "coder",
  probe: "probe",
  analyst: "analyst",
  auditorHypotheses: "auditorHypotheses",
  recheck: "recheck",
  ping: "ping",
  pingAuditor: "ping",
};

// 每次调用模型后通知一声用了多少 token（目前只有模拟脚本在听，用来算费用；网页里没人听就什么都不做）。
let usageListener = null;
export function setUsageListener(fn) {
  usageListener = fn;
}

/**
 * @param {object} ctx
 * @param {string} role
 * @param {object} vars  填进提示词的变量
 * @param {object} [demoPayload]  试玩模式下给规则生成器的结构化输入
 * @returns {Promise<{data: object, model: string, providerId: string}>}
 */
export async function callRole(ctx, role, vars, demoPayload) {
  if (ctx.demo) return { data: await demoRespond(role, demoPayload, ctx), model: "demo", providerId: "demo" };

  const target = resolveTarget(ctx.settings, ctx.secrets, role);
  if (target.kind === "missing" || !target.model || (target.needsKey && !target.apiKey) || (target.kind === "openai" && !target.baseURL)) {
    throw new LLMError("config");
  }
  const prompt = ctx.content.prompts[PROMPT_OF[role]];
  const schema = SCHEMAS[SCHEMA_OF[role]];
  const system = fill(prompt.system, vars);
  const firstUser = fill(prompt.user, vars);

  // 输出不能用时把具体哪里不对告诉模型，再要一次；第二次还不行就报错。
  let lastError = new LLMError("bad_output");
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = attempt === 0 ? firstUser : `${firstUser}\n\n（上一次的输出不能用：${problem}。请改正后只输出 JSON，不要加任何说明。）`;
    const { text, model, usage } =
      target.kind === "anthropic"
        ? await anthropicCall({ apiKey: target.apiKey, model: target.model, system, user, schema, effort: target.effort })
        : await openaiCall({
            baseURL: target.baseURL,
            apiKey: target.apiKey,
            model: target.model,
            system,
            user,
            schema,
            jsonMode: target.jsonMode,
            extraBody: target.extraBody,
          });
    usageListener?.({ role, providerId: target.providerId, model: model || target.model, usage });
    let parsed;
    try {
      parsed = extractJSON(text);
    } catch (e) {
      problem = "不是合法的 JSON";
      lastError = new LLMError("bad_output", e.message);
      continue;
    }
    // 结构和取值都查一遍（Claude、GPT 的严格格式下总是通过；只靠提示词约束的服务商靠这一步把关）。
    const { value, errors } = conform(parsed, schema);
    if (!errors.length) return { data: value, model, providerId: target.providerId };
    problem = errors.slice(0, 5).join("；");
    lastError = new LLMError("bad_output", problem);
  }
  throw lastError;
}

export async function listModels(providerId, { apiKey, baseURL }) {
  const p = PROVIDERS[providerId];
  if (!p) throw new LLMError("config");
  if (p.kind === "anthropic") {
    const ids = await anthropicListModels(apiKey);
    return [...new Set([...p.curatedModels, ...ids])];
  }
  return openaiListModels({ baseURL: (baseURL || p.baseURL || "").replace(/\/+$/, ""), apiKey });
}
