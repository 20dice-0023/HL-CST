// 每种模型调用要求输出的 JSON 结构。所有对象都写全 required、关掉 additionalProperties，
// 这样 Claude 的结构化输出和 OpenAI 的严格模式都能直接用。

import { REASONING_DIMS, REASONING_NONE } from "./reasoning.js";

const str = { type: "string" };
const strArr = { type: "array", items: str };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arrOf = (items) => ({ type: "array", items });
const enumOf = (values) => ({ type: "string", enum: values });

const AXIS_IDS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];

export const QUESTION_PROBLEMS = [
  "named_tradeoff",
  "leading",
  "free_deferral",
  "no_gap",
  "template",
  "jargon",
  "heavy",
  "unclear",
  "presumes",
];

export const SCHEMAS = {
  writer: obj({ questions: arrOf(obj({ slot: { type: "integer" }, text: str })) }),

  auditorQuestions: obj({
    results: arrOf(
      obj({
        slot: { type: "integer" },
        main_axis: enumOf(AXIS_IDS),
        secondary_axes: arrOf(enumOf(AXIS_IDS)),
        problems: arrOf(enumOf(QUESTION_PROBLEMS)),
        note: str,
      }),
    ),
  }),

  coder: obj({
    lean: enumOf(["left", "right", "conditional", "deferred", "other", "none"]),
    deferral: enumOf(["none", "conditional", "open"]),
    missing_info: strArr,
    criteria: strArr,
    flip_conditions: strArr,
    deferred_to: arrOf(enumOf(["规则", "上级", "多数人", "专家", "对方", "时间", "运气", "其他"])),
    quotes: strArr,
    question_problem: str,
    probe_outcome: enumOf(["none", "decided", "new_gap", "still_deferred", "declined"]),
    // 推理方式（见 reasoning.js）：只看回答里说出来的，没说就是"没体现"。
    reasoning: obj(Object.fromEntries(Object.entries(REASONING_DIMS).map(([dim, values]) => [dim, enumOf([...values, REASONING_NONE[dim]])]))),
  }),

  probe: obj({ text: str }),

  analyst: obj({
    criteria: arrOf(obj({ label: str, rounds: arrOf({ type: "integer" }), quotes: strArr })),
    hypotheses: arrOf(
      obj({
        statement: str,
        evidence: arrOf(obj({ round: { type: "integer" }, channel: enumOf(["选择", "回答", "自述"]), note: str })),
        counter: strArr,
        alternatives: strArr,
        confidence: enumOf(["低", "中", "高"]),
        confidence_reason: str,
        prediction: str,
      }),
    ),
    prior_checks: arrOf(obj({ id: str, status: enumOf(["准", "不准", "还没有相关数据"]), note: str })),
    moments: strArr,
  }),

  auditorHypotheses: obj({
    reviews: arrOf(
      obj({
        index: { type: "integer" },
        pass: { type: "boolean" },
        problems: strArr,
        rewrite_statement: str,
        rewrite_prediction: str,
      }),
    ),
  }),

  recheck: obj({ confirmed: { type: "boolean" }, note: str }),

  ping: obj({ ok: { type: "boolean" } }),
};
