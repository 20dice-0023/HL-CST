// 服务商、默认模型，以及"哪种调用用哪套配置"。

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    kind: "anthropic",
    needsKey: true,
    // Fable、Mythos 系列要求保存 30 天，零数据保存的组织用不了，所以不在默认列表里。
    curatedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    defaultMain: "claude-opus-5-5",
    defaultAuditor: "claude-sonnet-5-5",
    retentionUrl: "https://platform.claude.com/docs/en/manage-claude/api-and-data-retention",
  },
  openai: {
    id: "openai",
    kind: "openai",
    needsKey: true,
    baseURL: "https://api.openai.com/v1",
    jsonMode: "json_schema",
    extraBody: { store: false },
    retentionUrl: "https://developers.openai.com/api/docs/guides/your-data",
  },
  gemini: {
    id: "gemini",
    kind: "openai",
    needsKey: true,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    jsonMode: "json_schema",
    retentionUrl: "https://ai.google.dev/gemini-api/docs/zdr",
  },
  deepseek: {
    id: "deepseek",
    kind: "openai",
    needsKey: true,
    baseURL: "https://api.deepseek.com",
    jsonMode: "json_object",
    retentionUrl: "https://api-docs.deepseek.com/",
    // DeepSeek 默认开着思考模式、强度 high，思考按输出计费；不设的话每次调用都先想一大段，又贵又慢。
    // 按步骤分开设（reasoning_effort：none 关掉，low / high / max 开着）：写报告正文要想；
    // 出题、审题、审假设、复查题目想一点；编码是填表，补全追问和测试连接只有一句话，都不用想。
    reasoningEffort: {
      analyst: "high",
      writer: "low",
      auditorQuestions: "low",
      auditorHypotheses: "low",
      recheck: "low",
      coder: "none",
      coder2: "none",
      probe: "none",
      ping: "none",
      pingAuditor: "none",
    },
  },
  local: {
    id: "local",
    kind: "openai",
    needsKey: false,
    baseURL: "http://localhost:11434/v1",
    jsonMode: "json_object",
    editableBaseURL: true,
  },
  custom: {
    id: "custom",
    kind: "openai",
    needsKey: true,
    baseURL: "",
    jsonMode: "json_object",
    editableBaseURL: true,
  },
};

export const PROVIDER_ORDER = ["anthropic", "openai", "gemini", "deepseek", "local", "custom"];

export const DEFAULT_SETTINGS = {
  main: { provider: "anthropic", model: "claude-opus-5-5", baseURL: "" },
  // mode "same"：和上面同一家，只换模型；mode "separate"：用另一家。
  auditor: { mode: "same", model: "claude-sonnet-5-5", provider: "openai", separateModel: "", baseURL: "" },
  remember: false,
};

// 每种调用归哪套配置。审计员相关的调用（含第二遍编码）走 auditor。
export const ROLE_TARGET = {
  writer: "main",
  coder: "main",
  probe: "main",
  analyst: "main",
  ping: "main",
  auditorQuestions: "auditor",
  auditorHypotheses: "auditor",
  recheck: "auditor",
  coder2: "auditor",
  pingAuditor: "auditor",
};

// 只对 Claude 生效（output_config.effort）。分析要求最高，出题和编码中等，补全追问最轻。
// DeepSeek 的思考强度另外按步骤设，见上面 PROVIDERS.deepseek.reasoningEffort。
export const ROLE_EFFORT = {
  writer: "medium",
  coder: "medium",
  probe: "low",
  analyst: "high",
  ping: "low",
  auditorQuestions: "medium",
  auditorHypotheses: "high",
  recheck: "medium",
  coder2: "medium",
  pingAuditor: "low",
};

export const isCoveredModel = (model) => /^claude-(fable|mythos)/i.test(model ?? "");

export function defaultAuditorModel(providerId) {
  return PROVIDERS[providerId]?.defaultAuditor ?? "";
}

/** 合并已保存的设置和默认值（兼容以后新增的字段）。 */
export function normalizeSettings(saved) {
  const s = saved ?? {};
  return {
    main: { ...DEFAULT_SETTINGS.main, ...(s.main ?? {}) },
    auditor: { ...DEFAULT_SETTINGS.auditor, ...(s.auditor ?? {}) },
    remember: Boolean(s.remember),
  };
}

/**
 * 请求发往的地址。只有能改地址的服务商（本地模型、其它兼容服务）才用设置里存的；
 * OpenAI、Gemini、DeepSeek 一律用官方地址，免得哪里留下的旧地址把它们的 key 带走（安全审查第 3 条）。
 */
export function endpointOf(p, baseURL) {
  return ((p.editableBaseURL ? baseURL : "") || p.baseURL || "").trim().replace(/\/+$/, "");
}

/** 某种调用实际要用的服务商、模型、地址和 key。 */
export function resolveTarget(settings, secrets, role) {
  const which = ROLE_TARGET[role] ?? "main";
  let providerId = settings.main.provider;
  let model = settings.main.model;
  let baseURL = settings.main.baseURL;
  if (which === "auditor") {
    if (settings.auditor.mode === "separate") {
      providerId = settings.auditor.provider;
      model = settings.auditor.separateModel;
      baseURL = settings.auditor.baseURL;
    } else {
      model = settings.auditor.model || settings.main.model;
    }
  }
  const p = PROVIDERS[providerId];
  if (!p) return { role, which, providerId, kind: "missing" };
  const reasoning = p.reasoningEffort?.[role];
  return {
    role,
    which,
    providerId,
    kind: p.kind,
    model: (model ?? "").trim(),
    baseURL: endpointOf(p, baseURL),
    apiKey: (secrets?.keys?.[providerId] ?? "").trim(),
    needsKey: p.needsKey,
    jsonMode: p.jsonMode,
    extraBody: { ...(p.extraBody ?? {}), ...(reasoning ? { reasoning_effort: reasoning } : {}) },
    effort: ROLE_EFFORT[role] ?? "medium",
  };
}

/** 设置是否已经够用；返回缺的东西（空数组表示可以开始）。 */
export function missingSettings(settings, secrets) {
  const missing = [];
  for (const role of ["writer", "auditorQuestions"]) {
    const tg = resolveTarget(settings, secrets, role);
    const label = tg.which;
    if (tg.kind === "missing") missing.push(`${label}.provider`);
    if (!tg.model) missing.push(`${label}.model`);
    if (tg.needsKey && !tg.apiKey) missing.push(`${label}.key`);
    if (tg.kind === "openai" && !tg.baseURL) missing.push(`${label}.baseURL`);
  }
  return [...new Set(missing)];
}

/** 审计和出题是不是同一家（报告披露要注明独立性较弱）。 */
export function auditorSameProvider(settings) {
  return settings.auditor.mode !== "separate" || settings.auditor.provider === settings.main.provider;
}
