// 标准题（修订记录第 16、17 轮，轴表第 9 节）：事先拆好结构的固定题，放在 content/zh/standard.json。
// 编码时把拆解附给模型，让它对号入座；离线检查工具（tools/check-coder.mjs）拿样例回答比对编码结果。
// 正式轮次还不出标准题；网页不读 standard.json，所以在网页里 content.standard 是空的，附的拆解也是空的。

/** 这道题的拆解：题目带着 standardId，而且内容里有这道标准题。 */
export function findStandard(content, q) {
  if (!q?.standardId || !content?.standard) return null;
  return content.standard.questions.find((s) => s.id === q.standardId) ?? null;
}

/** 附给编码模型的拆解；不是标准题就是空字符串（提示词里那一行就空着）。 */
export function standardCardText(content, q) {
  const s = findStandard(content, q);
  if (!s) return "";
  const { card } = s;
  return [
    "这道题事先拆过。先按下面的拆解对号入座；对不上的，照系统提示里的编码规则来。",
    `- 左边一极在这道题里指：${card.left}`,
    `- 右边一极在这道题里指：${card.right}`,
    `- 不表态的代价：${card.stake}`,
    `- 题里故意没说的：${card.gap}`,
    "- 常见的说法怎么编：",
    ...card.routes.map((r) => `  · ${r}`),
    `- 判断标准尽量用这些说法：${card.criteria.join("、")}`,
    "- 通用规则：",
    ...content.standard.rules.map((r, i) => `  ${i + 1}. ${r}`),
  ].join("\n");
}

const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));
// 判断标准是模型自己写的短语，说法不必一字不差：互相包含就算提到了。
const mentions = (labels, wanted) => labels.some((l) => l && (l === wanted || l.includes(wanted) || wanted.includes(l)));

/**
 * 一份样例回答编得对不对。倾向、暂缓、交给谁要和写好的一样；
 * 判断标准只要提到应有的任何一个就算对上，样例没写应有的判断标准时不算这一项（null）。
 */
export function scoreCoding(expect, coding) {
  return {
    lean: coding.lean === expect.lean,
    deferral: coding.deferral === expect.deferral,
    deferredTo: sameSet(expect.deferred_to, coding.deferred_to),
    criteria: expect.criteria.length ? expect.criteria.some((c) => mentions(coding.criteria ?? [], c)) : null,
  };
}

export const SCORE_KEYS = ["lean", "deferral", "deferredTo", "criteria"];

/** 汇总：每一项对了几个、算了几个（编码失败的那份每一项都算错）。 */
export function tally(scores) {
  return Object.fromEntries(
    SCORE_KEYS.map((k) => {
      const xs = scores.map((s) => (s ? s[k] : false)).filter((v) => v !== null);
      return [k, { right: xs.filter(Boolean).length, total: xs.length }];
    }),
  );
}
