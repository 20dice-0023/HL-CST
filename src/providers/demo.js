// 试玩模式：不调用任何模型。题目取轴表里的例题，编码和假设按简单规则拼出来，只用来看流程。

import { exampleRank, rankExamples } from "../life-stage.js";
import { weightedPick } from "../rng.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 试玩时给一道题挑例题。挑和身份最合得来的；同样合得来的，优先情境一致的。
 * 有的身份按比例从几份题库里抽（packages.json 的 demoMix）："不想说"的人什么身份都有可能，
 * 现在是中学的七成、成年人的三成；抽中的那份这一类没有可用的例题了，就按平常的办法挑。
 */
export function pickExample(stage, pool, carrier, rng = Math.random) {
  let top = null;
  if (stage.demoMix?.length) {
    const part = weightedPick(stage.demoMix, stage.demoMix.map((m) => m.weight), rng);
    const rank = (e) => part.tags.indexOf(e.for ?? "any"); // 同一份里按 tags 的先后挑
    const inPart = pool.filter((e) => rank(e) >= 0);
    if (inPart.length) {
      const best = Math.min(...inPart.map(rank));
      top = inPart.filter((e) => rank(e) === best);
    }
  }
  if (!top) {
    const ranked = rankExamples(stage, pool);
    const best = exampleRank(stage, ranked[0]);
    top = ranked.filter((e) => exampleRank(stage, e) === best);
  }
  return top.find((e) => e.carrier === carrier) ?? top[0];
}

const CRITERIA_HINTS = [
  [/成本|花钱|费用|多少钱|代价|划算|白费/, "代价大小"],
  [/规定|规则|制度|流程|规矩/, "规则"],
  [/领导|上级|老板|老师|经理/, "上级意见"],
  [/朋友|关系|感情|面子|室友|同事/, "关系"],
  [/风险|万一|出事|后果|危险/, "风险大小"],
  [/责任|负责|担责|背锅/, "责任归属"],
  [/时间|来不及|急|赶/, "时间"],
  [/信任|相信|靠谱/, "信任"],
  [/公平|公正/, "公平"],
  [/自己|舒服|喜欢/, "自己的感受"],
];

// 推理方式按关键词粗打（只用于试玩）。
function reasoningOf(text) {
  const pick = (pairs, none) => pairs.find(([re]) => re.test(text))?.[1] ?? none;
  return {
    basis: pick([[/以前|上次|别人|大家|一般|经验|都这样|看起来/, "experience"], [/会让|会导致|结果|后果|影响|这样.{0,6}就/, "consequence"]], "none"),
    weighing: pick([[/万一|最坏|至少|保险|稳妥|保底/, "worst_case"], [/划算|值得|权衡|比较|总的来说|利大于弊|得不偿失/, "overall"]], "none"),
    scope: pick([[/以后|每次|一直|规矩|习惯|原则/, "as_a_rule"], [/这次|这一回|眼下|先.{0,6}再说/, "this_time"]], "none"),
    likelihood: /可能|多半|大概率|万一|十有八九|概率|也许/.test(text) ? "mentioned" : "not_mentioned",
    certainty: pick([[/不确定|说不好|不知道|拿不准/, "unsure"], [/肯定|一定|当然|必须|绝对/, "sure"], [/应该|大概|也许|我觉得/, "hedged"]], "none"),
  };
}

function codeAnswer(answer, deferralWords, probeResponse) {
  const text = answer ?? "";
  const deferred = deferralWords.some((w) => text.includes(w));
  const conditional = /如果|要是|假如|取决于|要看/.test(text);
  const deferral = deferred ? (conditional ? "conditional" : "open") : "none";
  let probeOutcome = "none";
  if (probeResponse !== undefined) {
    if (probeResponse === null) probeOutcome = "declined";
    else if (deferralWords.some((w) => probeResponse.includes(w))) probeOutcome = "still_deferred";
    else probeOutcome = "decided";
  }
  return {
    lean: deferral === "none" ? (text.trim() ? "other" : "none") : deferral === "conditional" ? "conditional" : "deferred",
    deferral,
    missing_info: deferral === "none" ? [] : ["结果会怎样"],
    criteria: CRITERIA_HINTS.filter(([re]) => re.test(text)).map(([, label]) => label).slice(0, 5),
    flip_conditions: [],
    deferred_to: /领导|上级|老板|经理/.test(text) ? ["上级"] : /规定|规则/.test(text) ? ["规则"] : [],
    quotes: text.trim() ? [text.trim().slice(0, 30)] : [],
    question_problem: "",
    probe_outcome: probeOutcome,
    reasoning: reasoningOf(text),
  };
}

function demoAnalysis(p) {
  const criteria = [];
  const byLabel = new Map();
  for (const r of p.rounds) {
    for (const label of r.criteria ?? []) {
      if (!byLabel.has(label)) byLabel.set(label, { label, rounds: [], quotes: [] });
      const c = byLabel.get(label);
      c.rounds.push(r.round);
      if (r.quote && c.quotes.length < 2) c.quotes.push(r.quote);
    }
  }
  criteria.push(...byLabel.values());

  const hypotheses = [];
  const top = p.table.slice().sort((a, b) => b.chosen - b.expected - (a.chosen - a.expected))[0];
  if (top && top.chosen > 0) {
    const rounds = p.rounds.filter((r) => r.chosenAxis === top.axis).map((r) => r.round);
    hypotheses.push({
      // top.name 在试玩报告里是"第一类""第二类"这样的代称，不是类别的名字。
      statement: `（试玩示意）在${top.name}取舍上，你选它的次数比随机多一些。`,
      evidence: [
        { round: 0, channel: "选择", note: `出现 ${top.exposures} 次，选了 ${top.chosen} 次` },
        ...rounds.slice(0, 2).map((n) => ({ round: n, channel: "回答", note: "选了这一类" })),
      ],
      counter: ["本次没有发现反例"],
      alternatives: ["样本很小，可能只是巧合"],
      confidence: "低",
      confidence_reason: "试玩只有 5 组",
      prediction: "如果正式做两轮以后这一类的选择次数回到随机水平，这条就不成立。",
    });
  }
  const deferred = p.rounds.filter((r) => r.deferral && r.deferral !== "none");
  if (deferred.length > 0) {
    hypotheses.push({
      statement: "（试玩示意）在信息不全的时候，你会先说出缺什么，再决定。",
      evidence: deferred.slice(0, 2).map((r) => ({ round: r.round, channel: "回答", note: "回答里有暂缓" })),
      counter: ["本次没有发现反例"],
      alternatives: ["题目本身信息确实太少"],
      confidence: "低",
      confidence_reason: "试玩只有 5 组，回答编码由规则生成",
      prediction: "如果补上信息后你仍然不做决定，这条要改写。",
    });
  }
  return {
    criteria,
    hypotheses,
    prior_checks: [],
    moments: ["（试玩示意）下次遇到信息不全的事，可以留意自己第一反应是先问清楚，还是先做点什么。"],
  };
}

/** 和真实模型一样的输入输出约定，只是由规则生成。 */
export async function demoRespond(role, p, ctx) {
  await sleep(80 + Math.random() * 120); // 只是让"稍等"的提示闪一下，不用真等
  const deferralWords = ctx.content.wordlists.deferral;
  switch (role) {
    case "writer": {
      // 挑没用过的例题（见 pickExample）。
      const used = ctx.demoState.usedExamples;
      return {
        questions: p.slots.map((s) => {
          const examples = ctx.content.axisById[s.axis].examples;
          const fresh = examples.filter((e) => !used.has(e.text));
          const ex = pickExample(p.stage, fresh.length ? fresh : examples, s.carrier, ctx.demoState.rng);
          used.add(ex.text);
          return { slot: s.slot, text: ex.text, carrier: ex.carrier };
        }),
      };
    }
    case "auditorQuestions":
      return { results: p.items.map((it) => ({ slot: it.slot, main_axis: it.axis, secondary_axes: [], problems: [], note: "" })) };
    case "coder":
    case "coder2":
      return codeAnswer(p.answer, deferralWords, p.probeResponse);
    case "probe":
      return { text: "假设结果不会太糟，对方也能接受。现在呢？你也可以继续暂缓。" };
    case "analyst":
      return demoAnalysis(p);
    case "auditorHypotheses":
      return { reviews: Array.from({ length: p.count }, (_, i) => ({ index: i + 1, pass: true, problems: [], rewrite_statement: "", rewrite_prediction: "" })) };
    case "recheck":
      return { confirmed: true, note: "试玩模式：直接确认" };
    default:
      return { ok: true };
  }
}
