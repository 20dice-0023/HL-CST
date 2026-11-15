// 整理报告（输出规格 1.0–1.9）：复查被标出的题、选择图谱、第二遍编码、判断标准、暂缓、假设与审计、披露。

import { fitChoiceModel, calibrateAxes, axisTable, axisCounts, leaveOneOut, THRESHOLDS } from "./choice-model.js";
import { mulberry32 } from "./rng.js";
import { callRole } from "./llm.js";
import { containsAny } from "./text.js";
import { liveSessions, answeredRounds, chosenQuestion, ensureCoding1, ensureCoding2, followUpPrompt, informedAt, needsCoding, newId, now, repairCodings } from "./session.js";
import { REASONING_DIMS, REASONING_NONE, reasoningCounts, stabilityRows } from "./reasoning.js";
import { DEFAULT_STAGE, stageInfo } from "./life-stage.js";
import { axisLabel } from "./content.js";

const CONCURRENCY = 3;
const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

async function mapLimit(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

export const annotationKey = (session, round) => `${session.id}:${round.index}`;

/**
 * 所有用于报告的组，按轮的先后、组的先后编成全局序号。
 * since：从这个时间起答的组算知情后（见 session.js 的 informedAt）；试玩报告传 null，全算知情前。
 */
export function collectRounds(data, sessions, since = informedAt(data)) {
  const out = [];
  let n = 0;
  for (const session of sessions) {
    for (const round of answeredRounds(session)) {
      n++;
      out.push({ n, session, round, informed: Boolean(since && round.answeredAt > since) });
    }
  }
  return out;
}

/** 记下实际是哪家、哪个模型答的（试玩写"规则生成"，和每轮开始时记的叫法一样）。 */
const usedModel = (res) => (res.providerId === "demo" ? "试玩（规则生成）" : `${res.providerId} / ${res.model}`);
const distinct = (values) => [...new Set(values.filter(Boolean))];

function toChoiceRound(item) {
  const options = item.round.offered.map((o) => ({ axis: o.axis, position: o.position }));
  const choice = item.round.choice === "skip" ? -1 : item.round.offered.findIndex((o) => o.qid === item.round.choice);
  const r = { options, choice };
  if (item.round.worst) r.worst = item.round.offered.findIndex((o) => o.qid === item.round.worst);
  return r;
}

function axisName(content, id) {
  const a = content.axisById[id];
  return a ? `${a.id} ${a.name}` : id;
}

function roundText(content, item, { full }) {
  const { n, session, round, informed } = item;
  const lines = [`第 ${n} 组（第 ${session.number || 1} 轮${informed ? "，知情后" : ""}）`];
  if (full) {
    for (const o of round.offered) lines.push(`- 题（${axisName(content, o.axis)}｜${o.pkg.carrier}｜第 ${o.position} 题）：${o.text}`);
  }
  const q = chosenQuestion(round);
  lines.push(q ? `- 选了：第 ${q.position} 题（${axisName(content, q.axis)}）` : "- 三道都没选");
  if (q) {
    if (!full) lines.push(`- 题目：${q.text}`);
    lines.push(`- 回答：${round.answer || "（空）"}`);
    if (round.followUp) lines.push(`- 轻追问"${followUpPrompt(round)}"：${round.followUp.declined ? "（跳过）" : round.followUp.text}`);
    for (const p of round.probes)
      lines.push(`- 补全追问：${p.prompt}；回应：${p.declined ? "（不想回答）" : p.keptDeferring ? "（继续暂缓）" : p.response}`);
    const c = round.coding1;
    if (c) {
      lines.push(
        `- 编码：倾向 ${c.lean}；暂缓 ${c.deferral}；标准：${c.criteria.join("、") || "无"}；交给：${c.deferred_to.join("、") || "无"}`,
      );
    }
  }
  if (round.excluded) lines.push(`- （这一组已剔除：${round.excluded.reason}）`);
  return lines.join("\n");
}

function pct(x) {
  return `${Math.round(100 * x)}%`;
}

// 自我预测只和选择图谱里已经下了判断的轴对照；数据不够时按后验均值排名只是噪声，不拿来对照。
function judgedExtremes(rows) {
  const pick = (prefix, dir) =>
    rows
      .filter((r) => r.judgment.key.startsWith(prefix))
      .sort((a, b) => dir * (b.mean - a.mean))
      .map((r) => r.axis);
  return { most: pick("prefer", 1), least: pick("avoid", -1) };
}

/**
 * @param {object} ctx  llm 调用上下文
 * @param {object} data 全部记录
 * @param {object} opts { demoSession?: 试玩的那一轮, onProgress?: (key, vars) => void }
 */
export async function buildReport(ctx, data, { demoSession = null, onProgress = () => {} } = {}) {
  const content = ctx.content;
  const axes = content.axisIds;
  const sessions = demoSession ? [demoSession] : liveSessions(data);
  const items = collectRounds(data, sessions, demoSession ? null : informedAt(data));
  const annotations = demoSession ? {} : data.profile.annotations;
  // 上一版：用更少的组整理出来的最近一份。同样的数据重新整理出来的不算，否则预测会拿生成它的那些组来"核对"。
  const previousReport = demoSession ? null : data.profile.reports.filter((r) => r.roundsUsed < items.length).at(-1) ?? null;

  // 1. 复查受试者标出"题目本身有问题"的组（审计员），确认的剔除。
  const toRecheck = items.filter((it) => {
    const a = annotations[annotationKey(it.session, it.round)];
    return a?.problem && !a.recheck;
  });
  if (toRecheck.length) onProgress("analysis.recheck");
  for (const it of toRecheck) {
    const a = annotations[annotationKey(it.session, it.round)];
    const q = chosenQuestion(it.round) ?? it.round.offered[0];
    const res = await callRole(ctx, "recheck", { question: q.text, complaint: a.why || "（受试者没写具体问题）" }, {});
    a.recheck = { confirmed: Boolean(res.data.confirmed), note: res.data.note, at: now(), model: res.model };
    if (a.recheck.confirmed) it.round.excluded = { reason: res.data.note || "审计员确认题目有问题", at: now() };
  }

  // 2. 选择图谱：只用知情前、没有被剔除的组。
  onProgress("analysis.model");
  await yieldToUI();
  const pre = items.filter((it) => !it.informed && !it.round.excluded);
  const post = items.filter((it) => it.informed && !it.round.excluded);
  const preRounds = pre.map(toChoiceRound);
  let rows = [];
  let model = null;
  if (preRounds.length) {
    model = fitChoiceModel(preRounds, axes);
    // 校正要模拟几百次，没有哪一类出现够次数的时候（比如试玩）判断反正都是"数据不够"，就不算了。
    const judgeable = Object.values(axisCounts(preRounds, axes)).some((c) => c.exposures >= THRESHOLDS.minExposure);
    const calib = judgeable
      ? calibrateAxes(preRounds, axes, model, { nSim: 300, rng: mulberry32(preRounds.length * 7919 + 17) })
      : Object.fromEntries(axes.map((a) => [a, { chanceAvoid: 1, chancePrefer: 1 }]));
    rows = axisTable(preRounds, axes, model, calib);
  }
  const position = { 1: 0, 2: 0, 3: 0 };
  for (const it of pre) {
    const q = chosenQuestion(it.round);
    if (q) position[q.position]++;
  }
  const skips = items.filter((it) => it.round.choice === "skip").length;
  const carriers = {};
  for (const r of rows) {
    if (!r.judgment.key.startsWith("avoid")) continue;
    carriers[r.axis] = [...new Set(pre.flatMap((it) => it.round.offered.filter((o) => o.axis === r.axis).map((o) => o.pkg.carrier)))];
  }
  const informedCounts = post.length ? Object.values(axisCounts(post.map(toChoiceRound), axes)) : [];
  const loo = preRounds.filter((r) => r.choice >= 0).length >= 6 ? leaveOneOut(preRounds, axes) : null;

  // 3. 两遍编码。做题时已经在后台做过的直接用，还在跑的等它跑完；没做过或失败了的在这里补上。
  // 第一遍失败不挡报告（这一组只是不进回答通道的统计）；第二遍失败就报错，可以重试。
  // 先把以前存下的编码整理一遍：格式不对、修不了的会被丢掉，在这里重编。
  for (const it of items) repairCodings(it.round);
  const needCoding = items.filter((it) => needsCoding(it.round));
  let done = 0;
  if (needCoding.length) onProgress("analysis.code2", { done, total: needCoding.length });
  await mapLimit(needCoding, CONCURRENCY, async (it) => {
    await Promise.all([
      ensureCoding1(ctx, it.session, it.round).catch((e) => console.warn("coding failed", e)),
      ensureCoding2(ctx, it.session, it.round),
    ]);
    done++;
    onProgress("analysis.code2", { done, total: needCoding.length });
  });

  // 两遍编码对不上的组，后面的结论把握降低。
  const disagree = new Set(
    items
      .filter((it) => it.round.coding1 && it.round.coding2)
      .filter((it) => it.round.coding1.lean !== it.round.coding2.lean || it.round.coding1.deferral !== it.round.coding2.deferral)
      .map((it) => it.n),
  );

  // 4. 暂缓的方式。
  const answered = items.filter((it) => it.round.choice !== "skip" && it.round.coding1);
  const deferredItems = answered.filter((it) => it.round.coding1.deferral !== "none");
  const deferral = {
    total: deferredItems.length,
    conditional: deferredItems.filter((it) => it.round.coding1.deferral === "conditional").length,
    open: deferredItems.filter((it) => it.round.coding1.deferral === "open").length,
    byAxis: Object.entries(
      deferredItems.reduce((m, it) => {
        const a = chosenQuestion(it.round).axis;
        m[a] = (m[a] ?? 0) + 1;
        return m;
      }, {}),
    ),
    probes: { decided: 0, new_gap: 0, still: 0, declined: 0 },
    probeRounds: items.filter((it) => it.round.probes.length).map((it) => it.n),
  };
  for (const it of items) {
    if (!it.round.probes.length) continue;
    const p = it.round.probes[0];
    if (p.declined) deferral.probes.declined++;
    else {
      const outcome = it.round.coding2?.probe_outcome;
      if (outcome === "decided") deferral.probes.decided++;
      else if (outcome === "new_gap") deferral.probes.new_gap++;
      else deferral.probes.still++;
    }
  }

  // 4b. 你凭什么选：推理方式的次数（所有答了题的组，和尺子、暂缓一样），
  // 以及同一类取舍里做法、理由各自稳不稳（只用知情前的，和选择图谱一样）。
  const bothCoded = items.filter((it) => it.round.choice !== "skip" && it.round.coding1 && it.round.coding2);
  const reasoning = {
    ...reasoningCounts(bothCoded.map((it) => it.round)),
    stability: stabilityRows(
      pre.filter((it) => it.round.choice !== "skip" && chosenQuestion(it.round)).map((it) => ({ axis: chosenQuestion(it.round).axis, round: it.round })),
      axes,
    ),
  };

  // 5. 分析模型：判断标准、假设、上一版预测的核对、可以留意的时刻。
  onProgress("analysis.analyst");
  // 试玩报告不写类别的名字（规则拼出来的假设会用到它），见 content.js 的 axisLabel。
  const table = rows.map((r) => ({ ...r, name: axisLabel(content, r.axis, { masked: Boolean(demoSession) }) }));
  const dataText = buildAnalystData(content, data, items, rows, position, skips, sessions, previousReport, annotations, demoSession, reasoning);
  const analystDemo = {
    table,
    rounds: answered.map((it) => ({
      round: it.n,
      chosenAxis: chosenQuestion(it.round).axis,
      criteria: it.round.coding1.criteria,
      quote: it.round.coding1.quotes[0] ?? "",
      deferral: it.round.coding1.deferral,
    })),
  };
  const analystRes = await callRole(ctx, "analyst", { data: dataText }, analystDemo);
  const analysis = analystRes.data;

  const roundAxis = Object.fromEntries(items.map((it) => [it.n, chosenQuestion(it.round)?.axis ?? null]));
  const criteria = (analysis.criteria ?? [])
    .map((c) => {
      const axesSeen = [...new Set(c.rounds.map((n) => roundAxis[n]).filter(Boolean))];
      return { ...c, axes: axesSeen, dominant: axesSeen.length >= 3 };
    })
    .sort((a, b) => b.axes.length - a.axes.length || b.rounds.length - a.rounds.length);

  // 6. 假设：先做程序检查（证据数、评价性词语），再交给审计员；不通过的改写或删除。
  onProgress("analysis.audit");
  const banned = [...content.wordlists.evaluative, ...content.wordlists.trait];
  const bannedIn = (h) => containsAny(`${h.statement}${h.prediction}`, banned);
  const auditLog = { kept: 0, rewritten: 0, dropped: 0, details: [] };
  // 证据不够两条的直接删：审计员只能改写说法，补不了证据。
  const enough = (h) => (h.evidence ?? []).length >= 2;
  for (const h of (analysis.hypotheses ?? []).filter((x) => !enough(x))) {
    auditLog.dropped++;
    auditLog.details.push({ statement: h.statement, problems: ["证据少于两条"], outcome: "dropped" });
  }
  // 词表查出来的问题和审计员自己查出的一样处理：交给审计员改写。词表很粗（"可能更好"这种说法也会被查到），
  // 所以不直接删；但改写以后还带着这些词的，仍然不出现在报告里。
  const drafts = (analysis.hypotheses ?? []).filter(enough).map((h, i) => {
    const hits = bannedIn(h);
    return { ...h, index: i + 1, wordHits: hits, codeProblems: hits.length ? [`用了评价或标签性的词：${hits.join("、")}`] : [] };
  });
  let reviews = [];
  let checker = null; // 核对假设的模型；没有要核对的假设就不调用
  if (drafts.length) {
    const roundsText = items.map((it) => roundText(content, it, { full: false })).join("\n\n");
    const hypText = drafts
      .map(
        (h) =>
          `${h.index}. ${h.statement}\n   依据：${h.evidence.map((e) => `第 ${e.round} 组（${e.channel}）${e.note}`).join("；")}\n   反例：${h.counter.join("；")}\n   其它可能：${h.alternatives.join("；")}\n   把握：${h.confidence}（${h.confidence_reason}）\n   预测：${h.prediction}` +
          (h.wordHits.length ? `\n   程序检查：陈述或预测里用了评价或标签性的词（${h.wordHits.join("、")}）。请改写陈述和预测，改写里不要再出现这些词。` : ""),
      )
      .join("\n\n");
    const auditRes = await callRole(ctx, "auditorHypotheses", { rounds: roundsText, hypotheses: hypText }, { count: drafts.length });
    reviews = auditRes.data.reviews ?? [];
    checker = usedModel(auditRes);
  }
  const reportIndex = (demoSession ? 0 : data.profile.reports.length) + 1;
  const hypotheses = [];
  for (const h of drafts) {
    const rv = reviews.find((r) => r.index === h.index);
    const problems = [...h.codeProblems, ...(rv && !rv.pass ? rv.problems : [])];
    let final = null;
    if (problems.length === 0) {
      final = { ...h, rewritten: false };
      auditLog.kept++;
    } else if (rv?.rewrite_statement) {
      // 审计员没改预测时沿用原来的预测，所以要拿最终会显示的两句话一起查词表。
      const rewritten = { ...h, statement: rv.rewrite_statement, prediction: rv.rewrite_prediction || h.prediction, rewritten: true };
      if (bannedIn(rewritten).length === 0) final = rewritten;
    }
    if (final?.rewritten) auditLog.rewritten++;
    else if (!final) auditLog.dropped++;
    auditLog.details.push({ statement: h.statement, problems, outcome: final ? (final.rewritten ? "rewritten" : "kept") : "dropped" });
    if (final) {
      const lowAgreement = final.evidence.some((e) => disagree.has(e.round));
      hypotheses.push({
        id: `h${reportIndex}-${h.index}`,
        statement: final.statement,
        evidence: final.evidence,
        counter: final.counter,
        alternatives: final.alternatives,
        confidence: lowAgreement && final.confidence === "高" ? "中" : final.confidence,
        confidenceReason: lowAgreement ? `${final.confidence_reason}；部分依据的两遍编码不一致` : final.confidence_reason,
        prediction: final.prediction,
        rewritten: final.rewritten,
      });
    }
  }

  // 7. 自我预测对照。
  const sp = demoSession ? null : data.profile.selfPrediction;
  const selfPrediction = sp ? { thought: { most: sp.most, least: sp.least }, actual: judgedExtremes(rows) } : null;

  // 8. 概况和披露。
  const shortAnswers = answered.filter((it) => (it.round.answer || "").length < 12).length;
  const experiences = sessions
    .filter((s) => s.end?.experience)
    .map((s) => {
      const repeatN = (s.end.experience.repeatRounds ?? [])
        .map((idx) => items.find((it) => it.session === s && it.round.index === idx)?.n)
        .filter(Boolean);
      return {
        session: s.number || 1,
        sessionId: s.id,
        repeatRounds: repeatN,
        auditTags: repeatN.map((n) => {
          const it = items.find((x) => x.n === n);
          return { n, axes: it.round.offered.map((o) => o.audit.taggedAxis || o.axis) };
        }),
        pressure: s.end.experience.pressure ?? "",
      };
    });
  const disclosure = {
    // 出题和审题按每轮开始时记下的（几轮之间换过模型就都列出来）；写报告、核对假设按这次实际调用的。
    // 0.3.0 以前只记了最后一轮开始时的三个，中途换过模型的话"分析"那一项会写错。
    models: {
      writer: distinct(sessions.map((s) => s.models?.writer)),
      auditor: distinct(sessions.map((s) => s.models?.auditor)),
      analyst: usedModel(analystRes),
      checker,
    },
    sameProvider: sessions.some((s) => s.models?.sameProvider),
    lifeStages: [...new Set(sessions.map((s) => s.lifeStage ?? DEFAULT_STAGE))],
    rounds: items.map((it) => ({
      n: it.n,
      informed: it.informed,
      offered: it.round.offered.map((o) => ({
        axis: o.axis,
        carrier: o.pkg.carrier,
        position: o.position,
        attempts: o.audit.attempts,
        verdict: o.audit.verdict,
        problems: o.audit.problems,
      })),
      chosen: chosenQuestion(it.round)?.axis ?? null,
      excluded: it.round.excluded?.reason ?? null,
    })),
    probeRounds: deferral.probeRounds,
    auditLog,
  };

  const report = {
    id: newId(),
    generatedAt: now(),
    demo: Boolean(demoSession),
    masked: Boolean(demoSession), // 试玩报告里类别只写"第一类""第二类"；没有这个标记的旧试玩报告，打开时重新拼一份
    informedSince: demoSession ? null : informedAt(data),
    sessionsUsed: sessions.filter((s) => answeredRounds(s).length).length,
    roundsUsed: items.length,
    overview: {
      rounds: items.length,
      skips,
      followUps: items.filter((it) => it.round.followUp).length,
      probes: deferral.probeRounds.length,
      informed: post.length,
      shortAnswers: answered.length > 0 && shortAnswers / answered.length > 0.5,
      readAxes: demoSession ? false : data.profile.readAxes === true,
      experiences,
    },
    choiceMap: {
      rows: rows.map(({ axis, exposures, chosen, expected, worst, mean, sd, pAvoid, pPrefer, chanceAvoid, chancePrefer, judgment }) => ({
        axis,
        exposures,
        chosen,
        expected,
        worst,
        mean,
        sd,
        pAvoid,
        pPrefer,
        chanceAvoid,
        chancePrefer,
        judgment,
      })),
      position,
      positionEffects: model ? model.position : null,
      carriers,
      informedRows: informedCounts,
    },
    criteria,
    deferral,
    hypotheses,
    priorChecks: analysis.prior_checks ?? [],
    moments: analysis.moments ?? [],
    selfPrediction,
    reasoning,
    predictionTest: loo,
    disclosure,
  };
  if (demoSession) demoSession.report = report;
  else data.profile.reports.push(report);
  return report;
}

/** 推理方式和"做法、理由稳不稳"，写成给分析模型看的文字（叫法和报告里一样，取自 ui.json）。 */
function reasoningText(content, reasoning) {
  const L = content.ui?.report?.reasoning ?? {};
  const label = (v) => L.values?.[v] ?? v;
  const lines = [];
  for (const [dim, d] of Object.entries(reasoning.dims)) {
    const parts = REASONING_DIMS[dim].map((v) => `${label(v)} ${d.counts[v]} 次`);
    lines.push(`${L.dims?.[dim] ?? dim}：${parts.join("，")}；没体现 ${d.counts[REASONING_NONE[dim]]} 次；两遍编码对不上 ${d.counts.disagree} 次`);
  }
  for (const s of reasoning.stability) {
    const ax = content.axisById[s.axis];
    const lean = (v) => (v === "left" ? ax.left : v === "right" ? ax.right : L.leans?.[v] ?? v);
    const action = s.action.status === "stable" ? `一致（${lean(s.action.value)}）` : s.action.status === "varies" ? "在变" : "看不出";
    const reason =
      s.reason.status === "stable" ? `一致（${s.reason.dims.map((x) => label(x.value)).join("、")}）` : s.reason.status === "varies" ? "在变" : "看不出";
    lines.push(`${axisName(content, s.axis)}（答过 ${s.rounds} 次）：做法${action}；理由${reason}`);
  }
  return lines;
}

function buildAnalystData(content, data, items, rows, position, skips, sessions, previousReport, annotations, demoSession, reasoning) {
  const parts = [];
  const preCount = items.filter((it) => !it.informed && !it.round.excluded).length;
  parts.push(`## 选择统计（只用知情前的 ${preCount} 组，也就是看报告或说明文档之前做的）`);
  for (const r of rows) {
    const chance =
      r.judgment.key === "insufficient"
        ? "出现次数不够，不做判断"
        : `完全随机选时出现至少这么明显的回避的概率 ${pct(r.chanceAvoid)}，偏好 ${pct(r.chancePrefer)}；判断：${r.judgment.key}`;
    parts.push(`${axisName(content, r.axis)}：出现 ${r.exposures} 次，选了 ${r.chosen} 次，随机期望 ${r.expected.toFixed(1)} 次；${chance}`);
  }
  parts.push(`题位：第一题 ${position[1]} 次，第二题 ${position[2]} 次，第三题 ${position[3]} 次；整组跳过 ${skips} 次。`);
  if (reasoning) {
    parts.push("", "## 推理方式（从回答里看；两遍编码对得上的才算；只描述说法，没有高低）");
    parts.push(...reasoningText(content, reasoning));
  }
  parts.push("", "## 受试者开始时说的身份（只用来理解情境，不当证据）");
  for (const s of sessions) parts.push(`第 ${s.number || 1} 轮：${stageInfo(content, s.lifeStage).short}`);
  parts.push("", "## 每一组");
  for (const it of items) parts.push(roundText(content, it, { full: true }), "");
  const ends = sessions.filter((s) => s.end?.experience);
  if (ends.length) {
    parts.push("## 结束时的体验");
    for (const s of ends) {
      const ex = s.end.experience;
      const rep = (ex.repeatRounds ?? []).map((idx) => items.find((it) => it.session === s && it.round.index === idx)?.n).filter(Boolean);
      parts.push(`第 ${s.number || 1} 轮：觉得重复的组：${rep.length ? rep.join("、") : "无"}；压力：${ex.pressure || "无"}`);
    }
    parts.push("");
  }
  if (!demoSession) {
    const sp = data.profile.selfPrediction;
    parts.push("## 自我预测");
    parts.push(sp ? `最常选：${sp.most.join("、") || "没选"}；最少选：${sp.least.join("、") || "没选"}` : "没有做");
    parts.push("");
    if (previousReport?.hypotheses?.length) {
      const from = previousReport.roundsUsed + 1;
      parts.push(`## 上一版假设（上一版用到第 ${previousReport.roundsUsed} 组，核对预测只看第 ${from} 组起的新数据）`);
      for (const h of previousReport.hypotheses) parts.push(`[${h.id}] ${h.statement}；预测：${h.prediction}`);
      parts.push("");
    }
    const notes = items
      .map((it) => ({ it, a: annotations[annotationKey(it.session, it.round)] }))
      .filter(({ a }) => a && (a.why || a.problem));
    if (notes.length) {
      parts.push("## 受试者的批注（知情后自述）");
      for (const { it, a } of notes) {
        const re = a.recheck ? `；审计员复查：${a.recheck.confirmed ? "成立" : "不成立"}` : "";
        parts.push(`第 ${it.n} 组：${a.why || "（没写）"}${a.problem ? "；标了题目有问题" : ""}${re}`);
      }
    }
  }
  return parts.join("\n");
}
