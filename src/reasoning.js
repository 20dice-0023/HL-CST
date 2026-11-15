// "你凭什么选"：从回答里看推理方式（修订记录第 11 轮）。只描述说法，不分高低。
// 每段回答由两遍编码各打一次标签，两遍对得上的才算。

/** 五条推理方式，每条的取值（不含"没体现"）。 */
export const REASONING_DIMS = {
  basis: ["consequence", "experience"], // 依据：看前因后果 / 看经验和迹象
  weighing: ["worst_case", "overall"], // 权衡：先保住最坏的情况 / 算整体划不划算
  scope: ["this_time", "as_a_rule"], // 范围：只看这一次 / 当成以后的做法
  likelihood: ["mentioned"], // 可能性：说到可能性大小
  certainty: ["sure", "hedged", "unsure"], // 把握：说得很肯定 / 留有余地 / 明说拿不准
};

/** 每条"没体现"时的取值。 */
export const REASONING_NONE = { basis: "none", weighing: "none", scope: "none", likelihood: "not_mentioned", certainty: "none" };

export const REASONING_SHOW_MIN = 4; // 一条维度至少这么多次有标签，才在报告里出现
export const STABILITY = { minRounds: 3, share: 0.75 }; // 同一类取舍至少答过 3 次；占到 3/4 算"一致"
const REASON_DIMS = ["basis", "weighing", "scope"]; // "理由稳不稳"看这三条

/** 两遍编码对得上的标签；缺一遍或对不上，就是 null（这一组这一条不算）。 */
export function agreedTag(round, dim) {
  const a = round.coding1?.reasoning?.[dim];
  const b = round.coding2?.reasoning?.[dim];
  return a && b && a === b ? a : null;
}

/** 各条推理方式的次数。rounds：答了题的组（有两遍编码）。 */
export function reasoningCounts(rounds) {
  const dims = {};
  for (const [dim, values] of Object.entries(REASONING_DIMS)) {
    const counts = Object.fromEntries([...values, REASONING_NONE[dim], "disagree"].map((v) => [v, 0]));
    for (const r of rounds) {
      const tag = agreedTag(r, dim);
      if (tag === null) counts.disagree++;
      else if (tag in counts) counts[tag]++;
    }
    const tagged = values.reduce((n, v) => n + counts[v], 0);
    // "可能性"没说也是一种说法，所以按对得上的总次数算够不够；其余几条按真正打上标签的次数算。
    const enough = dim === "likelihood" ? tagged + counts[REASONING_NONE[dim]] : tagged;
    dims[dim] = { counts, tagged, show: enough >= REASONING_SHOW_MIN };
  }
  return { answered: rounds.length, dims };
}

function consistency(values) {
  if (values.length < 2) return { status: "unclear", n: values.length };
  const tally = {};
  for (const v of values) tally[v] = (tally[v] ?? 0) + 1;
  const [value, count] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return { status: count / values.length >= STABILITY.share ? "stable" : "varies", value, n: values.length, counts: tally };
}

/**
 * 同一类取舍里，做法稳不稳、理由稳不稳。
 * rounds：知情前、没剔除、答了题的组，每组给出 { axis（选的那道的轴）, round }。
 */
export function stabilityRows(rounds, axisIds) {
  return axisIds
    .map((axis) => {
      const rs = rounds.filter((r) => r.axis === axis);
      if (rs.length < STABILITY.minRounds) return null;
      // 做法：两遍编码对得上的倾向；"没有实质内容"不算。
      const leans = rs.map(({ round }) => (round.coding1?.lean && round.coding1.lean === round.coding2?.lean ? round.coding1.lean : null)).filter((v) => v && v !== "none");
      const reasonDims = REASON_DIMS.map((dim) => ({ dim, ...consistency(rs.map(({ round }) => agreedTag(round, dim)).filter((v) => v && v !== REASONING_NONE[dim])) })).filter((x) => x.n >= 2);
      const reason = !reasonDims.length ? "unclear" : reasonDims.every((x) => x.status === "stable") ? "stable" : "varies";
      return { axis, rounds: rs.length, action: consistency(leans), reason: { status: reason, dims: reasonDims } };
    })
    .filter(Boolean);
}
