// 文本小工具：填提示词模板、从模型输出里取出 JSON、数汉字。

/** 把 {{name}} 换成 vars.name。 */
export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
}

/** 提示词文件用一行 ===USER=== 分成系统部分和用户部分。 */
export function splitPrompt(text) {
  const parts = text.split(/^===USER===\s*$/m);
  if (parts.length !== 2) throw new Error("prompt file must contain one ===USER=== line");
  return { system: parts[0].trim(), user: parts[1].trim() };
}

/** 从模型输出里取出 JSON：先整体解析，再去掉代码块标记，最后截取第一个 { 到最后一个 }。 */
export function extractJSON(text) {
  if (typeof text !== "string" || text.trim() === "") throw new Error("empty output");
  const tries = [];
  const trimmed = text.trim();
  tries.push(trimmed);
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) tries.push(trimmed.slice(first, last + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      // 试下一种
    }
  }
  throw new Error("output is not valid JSON");
}

/** 汉字和字母数字的个数（不算空白和标点），用来粗查题长。 */
export function visibleLength(s) {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export function containsAny(s, words) {
  return words.filter((w) => s.includes(w));
}

/**
 * 英文双引号换成中文的“”：按出现顺序一开一合（修订记录第 20 轮：题目里的双引号一律用中文的）。
 * 模型写的题目和追问用它兜底；已经是中文引号的不动。
 */
export function chineseQuotes(text) {
  let open = true;
  return String(text).replace(/"/g, () => {
    const q = open ? "“" : "”";
    open = !open;
    return q;
  });
}
