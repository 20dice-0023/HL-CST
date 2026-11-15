// 按 schemas.js 里写的结构，整理并检查模型的输出。
// Claude 和 GPT 的严格格式本身就保证结构；DeepSeek、本地模型这类只靠提示词约束，拿到以后要再查一遍：
// 能安全修正的就修正（该是列表的地方给了空值或单个值、数字写成了字符串、取值只差大小写或空格），
// 缺字段、取值不在规定范围里的，列出来让模型重答（见 llm.js）。

const label = (path) => path || "输出";
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @param {*} value   模型输出里的一部分
 * @param {object} schema  type 为 object / array / string / integer / number / boolean 的结构描述
 * @param {string} [path]  字段路径，只用来写错误信息
 * @returns {{value: *, errors: string[]}}  value 是整理后的副本（只留结构里有的字段）；errors 为空表示可用
 */
export function conform(value, schema, path = "") {
  switch (schema.type) {
    case "object": {
      if (!isPlainObject(value)) return { value, errors: [`${label(path)} 应该是一个对象`] };
      const out = {};
      const errors = [];
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        const where = path ? `${path}.${key}` : key;
        if (value[key] === undefined) {
          errors.push(`缺少字段 ${where}`);
          continue;
        }
        const r = conform(value[key], sub, where);
        out[key] = r.value;
        errors.push(...r.errors);
      }
      return { value: out, errors };
    }
    case "array": {
      let list = value;
      if (value === null) list = [];
      else if (!Array.isArray(value)) {
        // 只有一项时，有的模型不套列表。
        const single = schema.items.type === "object" ? isPlainObject(value) : typeof value === "string" || typeof value === "number";
        if (!single) return { value, errors: [`${label(path)} 应该是一个列表`] };
        list = value === "" ? [] : [value];
      }
      const out = [];
      const errors = [];
      list.forEach((item, i) => {
        const r = conform(item, schema.items, `${path}[${i}]`);
        out.push(r.value);
        errors.push(...r.errors);
      });
      return { value: out, errors };
    }
    case "string": {
      if (schema.enum) {
        const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : null;
        const hit = text === null ? undefined : schema.enum.find((e) => e === text) ?? schema.enum.find((e) => e.toLowerCase() === text.toLowerCase());
        if (hit !== undefined) return { value: hit, errors: [] };
        return { value, errors: [`${label(path)} 只能是 ${schema.enum.join("、")} 之一，不能是 ${JSON.stringify(value)}`] };
      }
      if (typeof value === "string") return { value, errors: [] };
      if (value === null) return { value: "", errors: [] };
      if (typeof value === "number" || typeof value === "boolean") return { value: String(value), errors: [] };
      return { value, errors: [`${label(path)} 应该是一段文字`] };
    }
    case "integer":
    case "number": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      const ok = typeof n === "number" && Number.isFinite(n) && (schema.type === "number" || Number.isInteger(n));
      return ok ? { value: n, errors: [] } : { value, errors: [`${label(path)} 应该是${schema.type === "integer" ? "整数" : "数字"}`] };
    }
    case "boolean": {
      if (typeof value === "boolean") return { value, errors: [] };
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (text === "true" || text === "false") return { value: text === "true", errors: [] };
      return { value, errors: [`${label(path)} 应该是 true 或 false`] };
    }
    default:
      return { value, errors: [] };
  }
}
