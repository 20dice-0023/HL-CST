// 受试者开始时说的身份（在上学、在工作……）。只用来让题目贴近本人的日常：换情境的说法、挑例题。
// 它不是观察通道：分析不能拿它当证据，也不能拿它解释倾向。

// 开始页上给人选的；packages.json 里另外留着旧的"school"（在上学，不分中学大学），只为读旧记录。
export const LIFE_STAGES = ["middle", "college", "work", "both", "neither", "unsaid"];
export const DEFAULT_STAGE = "unsaid";

/** 这个身份的出题说明（见 content/<语言>/packages.json 的 lifeStages）；没说或不认识的按"不想说"。 */
export function stageInfo(content, id) {
  const items = content.packages.lifeStages ?? {};
  return items[id] ?? items[DEFAULT_STAGE] ?? { short: "", who: "", examples: ["any"], fallback: [] };
}

/** 例题和身份合不合：0 合适，1 凑合，2 不合适。例题没标就当"什么身份都行"。 */
export function exampleRank(info, example) {
  const tag = example.for ?? "any";
  if ((info.examples ?? ["any"]).includes(tag)) return 0;
  if ((info.fallback ?? []).includes(tag)) return 1;
  return 2;
}

/** 按合适程度排好的例题（同一档里保持原来的顺序）。 */
export function rankExamples(info, examples) {
  return examples
    .map((e, i) => ({ e, i, r: exampleRank(info, e) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

/** 包装换成这个身份下的说法，给出题和审计看；记录里仍存原来的取值。 */
export function packageText(info, pkg) {
  const say = (labels, value) => labels?.[value] ?? value;
  return `情境：${say(info.carrierLabels, pkg.carrier)}；角色：${say(info.roleLabels, pkg.role)}；分量：${say(info.stakesLabels, pkg.stakes)}；抽象程度：${say(info.abstractionLabels, pkg.abstraction)}`;
}
