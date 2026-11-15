// 统一的模型调用错误。kind 对应界面文案 error.*。

export class LLMError extends Error {
  /**
   * @param {"auth"|"rate"|"network"|"timeout"|"refusal"|"truncated"|"bad_output"|"not_found"|"bad_request"|"server"|"config"|"unknown"} kind
   * @param {string} [message]
   * @param {object} [extra]
   */
  constructor(kind, message = "", extra = {}) {
    super(message || kind);
    this.name = "LLMError";
    this.kind = kind;
    this.extra = extra;
  }
}

/**
 * 服务商的报错可能原样带回 key（多半是自定义的服务）。显示到屏幕、写进文件之前，
 * 把这次用的 key 和几种常见格式都换成 ***（安全审查第 4 条，修订记录第 18 轮）。
 */
export function redactSecrets(text, key) {
  let s = String(text ?? "");
  if (key && key.length >= 8) s = s.split(key).join("***");
  return s.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g, "***").replace(/Bearer\s+\S+/gi, "Bearer ***");
}
