// 一轮题：按调度出题（出题 → 盲审 → 不过就重写）、记录选择和回答、轻追问、补全追问。
// 叫法：界面和文档里的"轮"是代码里的 session（坐下来做一次，十来组）；"组"是 round（三道题挑一道答）；"次"只用来数次数。

import { planRounds } from "./scheduler.js";
import { mulberry32, randomSeed } from "./rng.js";
import { callRole } from "./llm.js";
import { containsAny, visibleLength } from "./text.js";
import { auditorSameProvider, resolveTarget } from "./settings.js";
import { DEFAULT_STAGE, packageText, rankExamples, stageInfo } from "./life-stage.js";
import { SCHEMAS } from "./schemas.js";
import { conform } from "./validate.js";
import { standardCardText } from "./standard.js";

// 行为有变化就改版本号：每一轮都记着，事后查问题时分得清是哪一版的代码。package.json 里的版本号跟着它走。
export const APP_VERSION = "0.4.0";
export const SESSION_ROUNDS = 12;
export const DEMO_ROUNDS = 5;
export const MAX_PROBES = 3;
export const SHORT_ANSWER = 12; // 回答少于这么多字，轻追问一句（原话见 ui.json 的 round.followUpTitle）
// 不过审的题最多重写一次：实测里重写两次常常还是不过，一组却要等五六分钟。
const MAX_REWRITES = 1;
// 只记录、不退回的问题。"句式和前面的题雷同"重写也很难改掉（12 组里有 5 组重写两次后还是雷同），
// 却最费时间；记在披露里，不为它重写。
export const SOFT_PROBLEMS = new Set(["template"]);
// 提前准备几组：受试者答题的时候，后面的题在后台按顺序准备好。
export const PREFETCH_AHEAD = 2;
// 题面长度（不算标点和空格）的程序检查，比出题规则里的 50 到 100 字放宽一些，只拦明显过短或过长的。
export const QUESTION_LENGTH = { min: 30, max: 150 };

export const now = () => new Date().toISOString();
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const liveSessions = (data) => data.sessions.filter((s) => s.mode === "live");

/** 下一轮正式做的是第几轮。接着最大的编号往下排，不按个数算：中间删过一轮，编号也不会和留下的重复。 */
export const nextSessionNumber = (data) => liveSessions(data).reduce((max, s) => Math.max(max, s.number || 0), 0) + 1;

function describeTarget(ctx, role) {
  if (ctx.demo) return "试玩（规则生成）";
  const tg = resolveTarget(ctx.settings, ctx.secrets, role);
  return `${tg.providerId} / ${tg.model}`;
}

export function createSession(ctx, data, mode, { lifeStage = DEFAULT_STAGE } = {}) {
  const seed = randomSeed();
  const previous = mode === "live" ? liveSessions(data) : [];
  const history = previous.flatMap((s) => s.rounds.flatMap((r) => r.offered.map((o) => ({ axis: o.axis, carrier: o.pkg.carrier }))));
  const plan = planRounds({
    axes: ctx.content.axisIds,
    nRounds: mode === "demo" ? DEMO_ROUNDS : SESSION_ROUNDS,
    rng: mulberry32(seed),
    packages: ctx.content.packages,
    history,
  });
  const session = {
    id: newId(),
    mode,
    seed,
    createdAt: now(),
    appVersion: APP_VERSION,
    axisTableVersion: ctx.content.axisTableVersion,
    number: mode === "live" ? nextSessionNumber(data) : 0,
    lifeStage, // 开始时说的身份，只用来让题目贴近日常
    models: {
      writer: describeTarget(ctx, "writer"),
      auditor: describeTarget(ctx, "auditorQuestions"),
      analyst: describeTarget(ctx, "analyst"),
      sameProvider: ctx.demo ? true : auditorSameProvider(ctx.settings),
    },
    plan,
    rounds: [],
    status: "active",
    probesUsed: 0,
    end: null,
  };
  data.sessions.push(session);
  return session;
}

/** 下一组要做的序号；全部做完返回 null。 */
export function nextRoundIndex(session) {
  for (const p of session.plan) {
    const r = session.rounds.find((x) => x.index === p.index);
    if (!r || r.choice === null) return p.index;
  }
  return null;
}

export const answeredRounds = (session) => session.rounds.filter((r) => r.choice !== null).sort((a, b) => a.index - b.index);

// 报告要做满几轮、一共答满几组才给入口：看过报告之后的选择都算"知情后"，前几轮先不给看，知情前的数据攒够了再看。
// 回避要攒到三四轮才认得出（输出规格 1.2），所以默认 3 轮。只数轮不够：每轮只答一组也算一轮。
// 组数按统计定：每一类大约出现"组数 × 3/8"次，出现 8 次以上才可能判"明显"，24 组时每一类都有 9 次。
// 模拟（修订记录第 14 轮）：明显的回避（本该三次选一次，实际只选 6%），24 组认出约两成，36 组约一半，48 组约七成。
export const REPORT_AFTER_SESSIONS = 3;
export const REPORT_AFTER_ROUNDS = 24;

/** 正式做完了几轮（结束了，而且至少答过一组）。 */
export const completedSessions = (data) => liveSessions(data).filter((s) => s.status === "done" && answeredRounds(s).length > 0).length;

/** 正式做的一共答了几组（整组跳过的也算：选择图谱里它也算出现过）。 */
export const answeredLiveRounds = (data) => liveSessions(data).reduce((n, s) => n + answeredRounds(s).length, 0);

/** 能不能看报告：已经看过（本来就知情了），或者轮数和组数都够了。 */
export const reportUnlocked = (data) =>
  Boolean(data.profile.firstReportAt) || (completedSessions(data) >= REPORT_AFTER_SESSIONS && answeredLiveRounds(data) >= REPORT_AFTER_ROUNDS);

/**
 * 从什么时候起算"知情后"：第一次看报告（含看报告前的自我预测那一步），或者在网站里打开"它是怎么运作的"
 * （那几份说明把题目怎么分类、看什么都写了），取早的那个。之后答的组不进选择图谱，单独统计。
 */
export function informedAt(data) {
  return [data.profile.firstReportAt, data.profile.docsReadAt].filter(Boolean).sort()[0] ?? null;
}

function axisLine(ax) {
  return `${ax.id} ${ax.name}：${ax.tradeoff}`;
}

function sessionTexts(session) {
  return session.rounds.flatMap((r) => r.offered.map((o) => o.text));
}

function formatPrevious(texts) {
  return texts.length ? texts.map((t, i) => `${i + 1}. ${t}`).join("\n") : "（暂无）";
}

// 以前几轮出过的题：出题时只摘这一组用到的那几类，每类最近的这么多道，每道只给情境和开头一句。
// 全文发过去太贵（几轮下来上百道），摘要够出题模型避开同样的事由。
export const EARLIER_PER_AXIS = 12;
const OPENING_MAX = 40;

/** 以前几轮正式做过的题（不含这一轮），按出题先后排。只在出题时摘给出题模型看，不显示给受试者。 */
export function earlierQuestions(data, session) {
  return liveSessions(data)
    .filter((s) => s.id !== session.id)
    .flatMap((s) => s.rounds.flatMap((r) => r.offered.map((o) => ({ axis: o.axis, carrier: o.pkg.carrier, text: o.text }))));
}

/** 题目的开头：第一句；第一句太短（不到 8 个字）就连上第二句；太长就截断。 */
export function opening(text) {
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [text];
  let out = sentences[0];
  if (visibleLength(out) < 8 && sentences[1]) out += sentences[1];
  out = out.trim();
  return out.length > OPENING_MAX ? `${out.slice(0, OPENING_MAX)}……` : out;
}

function formatEarlier(ctx, specs, earlier) {
  const blocks = [...new Set(specs.map((s) => s.axis))]
    .map((axis) => {
      const items = earlier.filter((q) => q.axis === axis).slice(-EARLIER_PER_AXIS);
      if (!items.length) return null;
      return [`- ${ctx.content.axisById[axis].name}：`, ...items.map((q) => `  · ${q.carrier}：${opening(q.text)}`)].join("\n");
    })
    .filter(Boolean);
  return blocks.length ? blocks.join("\n") : "（暂无）";
}

function specText(ctx, s, note, stage) {
  const ax = ctx.content.axisById[s.axis];
  // 示例挑和受试者身份合得来的，最好换一个情境，免得照着写。
  const ranked = rankExamples(stage, ax.examples);
  const example = ranked.find((e) => e.carrier !== s.pkg.carrier) ?? ranked[0];
  const lines = [
    `编号 ${s.slot}`,
    `- 轴：${axisLine(ax)}`,
    `- 定义：${ax.definition}`,
    `- 边界：${ax.boundary}`,
    `- ${packageText(stage, s.pkg)}`,
    `- 示例（只帮你理解，不要模仿）：${example.text}`,
  ];
  if (note) lines.push(`- 上一版没通过审计：${[...note.problems, note.note].filter(Boolean).join("；")}。请换一个情境重写。`);
  return lines.join("\n");
}

async function writeQuestions(ctx, specs, previousTexts, notes, stage) {
  const vars = {
    who: stage.who,
    count: specs.length,
    specs: specs.map((s) => specText(ctx, s, notes[s.slot], stage)).join("\n\n"),
    previous: formatPrevious(previousTexts),
    earlier: formatEarlier(ctx, specs, ctx.earlier ?? []),
  };
  const demo = { stage, slots: specs.map((s) => ({ slot: s.slot, axis: s.axis, carrier: s.pkg.carrier })) };
  const out = {};
  const carriers = {}; // 试玩用的是现成例题，情境以例题自己的为准，披露里才对得上
  let model = "";
  for (let attempt = 0; attempt < 2 && Object.keys(out).length < specs.length; attempt++) {
    const missing = specs.filter((s) => !(s.slot in out));
    const res = await callRole(
      ctx,
      "writer",
      { ...vars, count: missing.length, specs: missing.map((s) => specText(ctx, s, notes[s.slot], stage)).join("\n\n") },
      { ...demo, slots: demo.slots.filter((d) => missing.some((m) => m.slot === d.slot)) },
    );
    model = res.model;
    for (const q of res.data.questions ?? []) {
      if (!missing.some((m) => m.slot === q.slot) || typeof q.text !== "string" || !q.text.trim()) continue;
      out[q.slot] = q.text.trim();
      if (ctx.demo && q.carrier) carriers[q.slot] = q.carrier;
    }
  }
  if (Object.keys(out).length < specs.length) throw new Error("writer did not return every question");
  return { texts: out, model, carriers };
}

async function auditQuestions(ctx, specs, texts, previousTexts, stage) {
  const axesText = ctx.content.axes.map((a) => `${axisLine(a)}\n  定义：${a.definition}\n  边界：${a.boundary}`).join("\n");
  const vars = {
    who: stage.who,
    axes: axesText,
    previous: formatPrevious(previousTexts),
    questions: specs.map((s) => `编号 ${s.slot}：${texts[s.slot]}`).join("\n\n"),
  };
  const res = await callRole(ctx, "auditorQuestions", vars, { items: specs.map((s) => ({ slot: s.slot, axis: s.axis })) });
  const bySlot = Object.fromEntries((res.data.results ?? []).map((r) => [r.slot, r]));
  const out = {};
  for (const s of specs) {
    const r = bySlot[s.slot];
    const text = texts[s.slot];
    const codeProblems = [];
    const len = visibleLength(text);
    if (len < QUESTION_LENGTH.min || len > QUESTION_LENGTH.max) codeProblems.push("length");
    if (containsAny(text, ctx.content.wordlists.jargon).length) codeProblems.push("jargon");
    const problems = [...new Set([...(r?.problems ?? []), ...codeProblems])];
    const taggedAxis = r?.main_axis ?? "";
    if (taggedAxis && taggedAxis !== s.axis) problems.push("axis_mismatch");
    out[s.slot] = {
      // 只记录、不退回的问题（见 SOFT_PROBLEMS）不影响通过。
      pass: Boolean(r) && problems.every((p) => SOFT_PROBLEMS.has(p)),
      taggedAxis,
      secondary: r?.secondary_axes ?? [],
      problems,
      note: r?.note ?? "",
      model: res.model,
    };
  }
  return out;
}

/** 生成第 index 组的三道题（出题 → 盲审 → 不过的重写，最多一次）。已经生成过就直接返回。 */
export async function prepareRound(ctx, session, index) {
  const existing = session.rounds.find((r) => r.index === index);
  if (existing) return existing;
  const plan = session.plan.find((p) => p.index === index);
  const stage = stageInfo(ctx.content, session.lifeStage);
  const previousTexts = sessionTexts(session);
  const { texts, model: writerModel, carriers } = await writeQuestions(ctx, plan.slots, previousTexts, {}, stage);
  const audits = await auditQuestions(ctx, plan.slots, texts, previousTexts, stage);
  const attempts = Object.fromEntries(plan.slots.map((s) => [s.slot, 1]));
  // 每次审计查出的问题都留着（最后一次的另外放在 problems 里），以后调规则时看得出是哪一项最常退回。
  const history = Object.fromEntries(plan.slots.map((s) => [s.slot, [audits[s.slot].problems]]));
  for (let k = 0; k < MAX_REWRITES; k++) {
    const failing = plan.slots.filter((s) => !audits[s.slot].pass);
    if (!failing.length) break;
    const others = plan.slots.filter((s) => audits[s.slot].pass).map((s) => texts[s.slot]);
    const rewritten = await writeQuestions(ctx, failing, [...previousTexts, ...others], audits, stage);
    Object.assign(texts, rewritten.texts);
    Object.assign(carriers, rewritten.carriers);
    Object.assign(audits, await auditQuestions(ctx, failing, texts, previousTexts, stage));
    for (const s of failing) {
      attempts[s.slot]++;
      history[s.slot].push(audits[s.slot].problems);
    }
  }
  // 生成期间可能已经有别处存好了这一组（比如预取），以先到的为准。
  const raced = session.rounds.find((r) => r.index === index);
  if (raced) return raced;
  const round = {
    index,
    offered: plan.slots
      .map((s) => ({
        qid: `${session.id}-${index}-${s.slot}`,
        slot: s.slot,
        axis: s.axis,
        position: s.position,
        pkg: carriers[s.slot] ? { ...s.pkg, carrier: carriers[s.slot] } : s.pkg,
        text: texts[s.slot],
        writerModel,
        audit: { ...audits[s.slot], verdict: audits[s.slot].pass ? "pass" : "flagged", attempts: attempts[s.slot], history: history[s.slot] },
      }))
      .sort((a, b) => a.position - b.position),
    choice: null,
    worst: null,
    answer: "",
    followUp: null,
    probes: [],
    coding1: null,
    coding2: null,
    excluded: null,
    preparedAt: now(),
    answeredAt: null,
  };
  session.rounds.push(round);
  session.rounds.sort((a, b) => a.index - b.index);
  return round;
}

// 同一组只生成一次：预取和正式请求共用同一个进行中的任务。
const inflight = new Map();

export function ensureRound(ctx, session, index, onReady) {
  const key = `${session.id}:${index}`;
  const done = session.rounds.find((r) => r.index === index);
  if (done) return Promise.resolve(done);
  if (!inflight.has(key)) {
    inflight.set(
      key,
      prepareRound(ctx, session, index)
        .then((r) => {
          onReady?.(r);
          return r;
        })
        .finally(() => inflight.delete(key)),
    );
  }
  return inflight.get(key);
}

export function recordAnswer(round, { choice, answer }) {
  round.choice = choice; // 题目 qid，或者 "skip"
  round.answer = choice === "skip" ? "" : answer.trim();
  round.answeredAt = now();
}

export const needsFollowUp = (round) => round.choice !== "skip" && !round.followUp && visibleLength(round.answer) < SHORT_ANSWER;

/** 轻追问当时的原话。2026-10-30 以前的记录没存原话，那时问的是"你最在意的是哪一点？"。 */
export const followUpPrompt = (round) => round.followUp?.prompt ?? "你最在意的是哪一点？";

export function chosenQuestion(round) {
  return round.offered.find((o) => o.qid === round.choice) ?? null;
}

function extraText(round, { includeProbes }) {
  const lines = [];
  if (round.followUp) lines.push(`轻追问"${followUpPrompt(round)}"：${round.followUp.declined ? "（跳过了）" : round.followUp.text}`);
  if (includeProbes)
    for (const p of round.probes) {
      const reply = p.declined ? "（不想回答）" : p.keptDeferring ? "（继续暂缓）" : p.response;
      lines.push(`补全追问："${p.prompt}"\n受试者的回应：${reply}`);
    }
  return lines.join("\n");
}

/** 第一遍编码（主模型），用来决定要不要补全追问。 */
export async function codeRound(ctx, round) {
  const q = chosenQuestion(round);
  if (!q) return null;
  const ax = ctx.content.axisById[q.axis];
  const vars = {
    axis: axisLine(ax),
    left: ax.left,
    right: ax.right,
    question: q.text,
    card: standardCardText(ctx.content, q),
    answer: round.answer || "（空）",
    extra: extraText(round, { includeProbes: false }),
  };
  const fullAnswer = [round.answer, round.followUp?.text].filter(Boolean).join(" ");
  const res = await callRole(ctx, "coder", vars, { answer: fullAnswer, axisId: q.axis });
  round.coding1 = { ...res.data, model: res.model, version: CODING_VERSION };
  return round.coding1;
}

/** 第二遍编码（审计员的模型），会看到补全追问和回应。做题时在后台先做，整理报告时补齐。 */
export async function codeRoundAgain(ctx, round) {
  const q = chosenQuestion(round);
  if (!q) return null;
  const ax = ctx.content.axisById[q.axis];
  const vars = {
    axis: axisLine(ax),
    left: ax.left,
    right: ax.right,
    question: q.text,
    card: standardCardText(ctx.content, q),
    answer: round.answer || "（空）",
    extra: extraText(round, { includeProbes: true }),
  };
  const p = round.probes[0];
  const probeResponse = p ? (p.declined ? null : p.keptDeferring ? "继续暂缓" : p.response) : undefined;
  const fullAnswer = [round.answer, round.followUp?.text].filter(Boolean).join(" ");
  const res = await callRole(ctx, "coder2", vars, { answer: fullAnswer, axisId: q.axis, probeResponse });
  round.coding2 = { ...res.data, model: res.model, version: CODING_VERSION };
  return round.coding2;
}

export const shouldProbe = (session, round) =>
  round.choice !== "skip" && round.coding1 && round.coding1.deferral !== "none" && round.probes.length === 0 && session.probesUsed < MAX_PROBES;

/**
 * 回答里有没有可能是暂缓（按词表粗看，宁宽勿漏）。没有的话不必等编码出结果，直接进下一组，编码在后台做；
 * 有的话要等编码确认，才知道该不该补全追问。
 */
export function mayProbe(ctx, session, round) {
  if (round.choice === "skip" || round.probes.length || session.probesUsed >= MAX_PROBES) return false;
  const words = ctx.content.wordlists.deferralHints ?? ctx.content.wordlists.deferral;
  const text = [round.answer, round.followUp?.text].filter(Boolean).join(" ");
  return containsAny(text, words).length > 0;
}

// 编码在后台跑：同一组的同一遍只跑一次；整理报告时等还在跑的，没跑过或失败了的补上。
const codingInflight = new Map();

function codeOnce(key, run) {
  if (!codingInflight.has(key)) codingInflight.set(key, run().finally(() => codingInflight.delete(key)));
  return codingInflight.get(key);
}

const answered = (round) => round.choice !== null && round.choice !== "skip";

// 编码的版本：编码规则加了字段就加一。旧版本编出来的，整理报告时重编一次（第 2 版加了推理方式）。
export const CODING_VERSION = 2;
const current = (coding) => (coding?.version ?? 1) >= CODING_VERSION;

/** 这一组还要不要编码（没编过、编码失败过，或者是旧版本编的）。 */
export const needsCoding = (round) => answered(round) && (!current(round.coding1) || !current(round.coding2));

/**
 * 整理已经存下的编码。0.3.0 以前，只靠提示词约束的服务商返回什么就存什么：该是列表的地方可能是空值，
 * 取值可能不在规定范围里。能修正的就地修正；修不了的丢掉，整理报告时会重编。
 */
export function repairCodings(round) {
  for (const key of ["coding1", "coding2"]) {
    const coding = round[key];
    if (!coding) continue;
    const { value, errors } = conform(coding, SCHEMAS.coder);
    round[key] = errors.length ? null : { ...value, model: coding.model, version: coding.version };
  }
}

export function ensureCoding1(ctx, session, round) {
  if (current(round.coding1) || !answered(round)) return Promise.resolve(round.coding1 ?? null);
  return codeOnce(`${session.id}:${round.index}:1`, () => codeRound(ctx, round));
}

/** 第二遍编码要看补全追问，所以等这一组的追问结束再调用。 */
export function ensureCoding2(ctx, session, round) {
  if (current(round.coding2) || !answered(round)) return Promise.resolve(round.coding2 ?? null);
  return codeOnce(`${session.id}:${round.index}:2`, () => codeRoundAgain(ctx, round));
}

export async function makeProbe(ctx, round) {
  const q = chosenQuestion(round);
  const missing = round.coding1?.missing_info?.length ? round.coding1.missing_info.join("、") : "（受试者没有具体说）";
  const res = await callRole(ctx, "probe", { question: q.text, answer: round.answer, missing }, { missing });
  return res.data.text.trim() || null; // 没写出追问就不问
}

export function recordProbe(session, round, { prompt, response = "", declined = false, keptDeferring = false }) {
  round.probes.push({ type: "fill", prompt, response: response.trim(), declined, keptDeferring, at: now() });
  session.probesUsed++;
}

export function finishSession(session, { reason, experience }) {
  session.status = "done";
  session.end = { reason, at: now(), experience };
}
