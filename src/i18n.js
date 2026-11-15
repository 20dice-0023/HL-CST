// 界面文案：所有给人看的字都从 content/<语言>/ui.json 里取。

let ui = {};

export function setUI(dict) {
  ui = dict;
}

/** t("report.s2.title")，t("round.progress", { i: 3, n: 12 }) */
export function t(key, vars = {}) {
  const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), ui);
  if (typeof value !== "string") return key;
  return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}
