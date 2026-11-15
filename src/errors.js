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
