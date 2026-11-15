// 模拟正式做两轮：一个虚拟中学生来答题，走真实的出题、盲审、编码、追问和报告流程。
// 不经过浏览器，也不碰你在网页里的记录；结果写进 sim-output/（不进仓库）。
//
// 用法：
//   Claude（Haiku / Sonnet / Opus 轮换，effort 都是 medium）：node tools/simulate.mjs
//   DeepSeek：node tools/simulate.mjs --provider deepseek
//   只测流程、不花钱：先运行 node tools/mock-llm-server.mjs，再运行  node tools/simulate.mjs --provider mock
// 运行后会让你粘贴 key：屏幕上不显示，只留在这次运行的内存里，不写进任何文件。
// 也可以事先设好环境变量 ANTHROPIC_API_KEY / DEEPSEEK_API_KEY，就不问了。
// 其它参数：--rounds 4（每轮只做前 4 组，先小跑一下）
//
// 第一轮的回答很短、常常说一半；第二轮写得长、讲理由。是同一个人，脾气不变（见 PERSONA），
// 这样能看出报告认不认得出来。报告照真实流程整理：两轮都算"看报告之前"做的。

import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { setUI, t } from "../src/i18n.js";
import { emptyData } from "../src/store.js";
import { ROLE_EFFORT, normalizeSettings } from "../src/settings.js";
import {
  answeredRounds,
  chosenQuestion,
  createSession,
  earlierQuestions,
  ensureCoding1,
  ensureCoding2,
  finishSession,
  followUpPrompt,
  makeProbe,
  mayProbe,
  needsFollowUp,
  now,
  prepareRound,
  recordAnswer,
  recordProbe,
  shouldProbe,
} from "../src/session.js";
import { buildReport } from "../src/analysis.js";
import { setUsageListener } from "../src/llm.js";
import { anthropicCall } from "../src/providers/anthropic.js";
import { openaiCall } from "../src/providers/openai-compatible.js";
import { extractJSON } from "../src/text.js";
import { conform } from "../src/validate.js";
import { REASONING_DIMS, REASONING_NONE } from "../src/reasoning.js";
import { ROOT, askHidden, loadContentFromDisk, stamp } from "./lib.mjs";

// ---------- 参数 ----------

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PROVIDER = arg("provider", "anthropic");
const ROUNDS = Number(arg("rounds", "12"));
const OUT = `${ROOT}sim-output/${stamp()}-${PROVIDER}`;

// ---------- 内容 ----------

const content = loadContentFromDisk();
setUI(content.ui);

// ---------- 用哪家、哪几个模型 ----------

const SETUPS = {
  anthropic: {
    id: "anthropic",
    key: process.env.ANTHROPIC_API_KEY,
    keyName: "ANTHROPIC_API_KEY",
    // 每一组三个模型各干一样：出题和第一遍编码、盲审和第二遍编码、扮演受试者；下一组整体错开一位。
    rotation: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    report: { main: "claude-opus-5-5", auditor: "claude-sonnet-5-5" },
  },
  deepseek: {
    id: "deepseek",
    key: process.env.DEEPSEEK_API_KEY,
    keyName: "DEEPSEEK_API_KEY",
    rotation: ["deepseek-flash", "deepseek-flash", "deepseek-flash"],
    report: { main: "deepseek-flash", auditor: "deepseek-flash" },
  },
  mock: {
    id: "custom",
    key: "mock",
    baseURL: "http://127.0.0.1:8787/v1",
    rotation: ["mock-large", "mock-small", "mock-subject"],
    report: { main: "mock-large", auditor: "mock-small" },
  },
};
const SETUP = SETUPS[PROVIDER];
if (!SETUP) {
  console.error(`不认识的 --provider：${PROVIDER}（可以用 anthropic、deepseek、mock）`);
  process.exit(1);
}

async function ensureKey() {
  if (SETUP.key) return;
  if (!process.stdin.isTTY) {
    console.error(`没有 key：请在终端里直接运行（会让你粘贴 key），或者先设好环境变量 ${SETUP.keyName}。`);
    process.exit(1);
  }
  const name = PROVIDER === "anthropic" ? "Claude" : "DeepSeek";
  SETUP.key = await askHidden(`粘贴你的 ${name} key（右键或 Ctrl+V；屏幕上不显示，用完不保存），然后按回车：`);
  if (!SETUP.key) {
    console.error("没收到 key，退出。");
    process.exit(1);
  }
  console.log("收到。开始跑，大概要半小时；中途可以按 Ctrl+C 停下（已经用掉的部分照样计费）。");
}
if (PROVIDER === "anthropic") for (const role of Object.keys(ROLE_EFFORT)) ROLE_EFFORT[role] = "medium";

const rolesFor = (g) => ({
  main: SETUP.rotation[g % 3],
  auditor: SETUP.rotation[(g + 1) % 3],
  subject: SETUP.rotation[(g + 2) % 3],
});

const ctxWith = (main, auditor) => ({
  settings: normalizeSettings({ main: { provider: SETUP.id, model: main, baseURL: SETUP.baseURL ?? "" }, auditor: { mode: "same", model: auditor } }),
  secrets: { keys: { [SETUP.id]: SETUP.key } },
  content,
  demo: false,
  demoState: null,
});

// ---------- 用量 ----------

const usage = {};
function addUsage(model, u) {
  const m = (usage[model] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  m.calls++;
  if (!u) return;
  m.input += u.input_tokens ?? u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0;
  m.output += u.output_tokens ?? u.completion_tokens ?? 0;
  m.cacheRead += u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? 0;
  m.cacheWrite += u.cache_creation_input_tokens ?? 0;
}
setUsageListener(({ model, usage: u }) => addUsage(model, u));

// 每百万 token 的美元价（Anthropic 官方价；输出里含思考，这三个模型默认都会思考）。
// DeepSeek 的价格按时段变，这里只报 token 数，自己按官网的价算。
const PRICES = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
const costOf = (model, m) => {
  const p = PRICES[model];
  if (!p) return null;
  return (m.input * p.in + m.cacheWrite * p.in * 1.25 + m.cacheRead * p.cacheRead + m.output * p.out) / 1e6;
};

// ---------- 受试者 ----------

const PERSONA = `你在帮忙测试一个"了解自己怎么做判断"的小工具，扮演下面这个人来答题。不要跳出角色，不要提到自己是 AI，也不要猜工具在测什么。

这个人：初二学生，在班里人缘还行。
- 不太愿意当面说让人不舒服的真话；碰到"要不要说出来"的题，能不选就不选，真要说也说得含糊。
- 别人都不管的事，常常顺手就接过来，事后又有点后悔。
- 做决定偏稳，怕出岔子，常想"万一……怎么办"。
- 拿主意时爱参考以前的经验和身边人的做法，很少讲可能性大小，说话留余地（"应该""大概"）。
- 遇到信息不全的事，有时候先放一放，问问家里人或老师再说。`;

const STYLES = [
  `这一次你很累、不太想写字：回答都很短，常常只有几个字，有时只说一半（比如"看情况吧""先不管""嗯，问问再说"），偶尔三道都不想选就直接跳过。被追问时也只回一两句，或者干脆不回。`,
  `这一次你状态不错、愿意多说：每道回答写三到六句，说清楚会怎么做、为什么，以及什么情况下会改主意。被追问时也认真回答。`,
];

const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const SUBJECT_SCHEMAS = {
  answer: obj({ choice: { type: "string", enum: ["1", "2", "3", "skip"] }, answer: str }),
  followUp: obj({ reply: str }),
  probe: obj({ action: { type: "string", enum: ["answer", "keep_deferring", "decline"] }, reply: str }),
  end: obj({ repeat_rounds: { type: "array", items: { type: "integer" } }, pressure: str }),
  predict: obj({ most: { type: "array", items: { type: "string", enum: content.axisIds } }, least: { type: "array", items: { type: "string", enum: content.axisIds } } }),
};

async function subject(kind, user, model, style) {
  if (PROVIDER === "mock") return mockSubject(kind, user, style);
  const system = `${PERSONA}\n\n${STYLES[style]}`;
  const schema = SUBJECT_SCHEMAS[kind];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res =
      PROVIDER === "anthropic"
        ? await anthropicCall({ apiKey: SETUP.key, model, system, user, schema, effort: "medium" })
        : await openaiCall({ baseURL: "https://api.deepseek.com", apiKey: SETUP.key, model, system, user, schema, jsonMode: "json_object", extraBody: { reasoning_effort: "none" } });
    addUsage(res.model || model, res.usage);
    try {
      const { value, errors } = conform(extractJSON(res.text), schema);
      if (!errors.length) return value;
    } catch {
      // 不是 JSON：再试一次
    }
  }
  throw new Error(`受试者（${kind}）没给出能用的 JSON`);
}

// 模拟服务下的受试者：按规则答，只为测流程。
let mockCount = 0;
function mockSubject(kind, user, style) {
  mockCount++;
  const short = ["看情况吧。", "先不管。", "嗯，问问再说。", "接过来。", "求稳一点。", "不知道。"];
  const long =
    "以前遇到过差不多的事，我一般会先把能做的做了，万一出问题也不至于太糟。应该先问问老师，再决定要不要接过来。以后遇到这种事，我大概都会这样。";
  if (kind === "answer") {
    if (style === 0 && mockCount % 5 === 0) return { choice: "skip", answer: "" };
    const options = [...user.matchAll(/^([123])\. /gm)].map((m) => m[1]);
    const avoid = [...user.matchAll(/^([123])\. .*（A5）/gm)].map((m) => m[1]);
    const choice = options.find((o) => !avoid.includes(o)) ?? "1";
    return { choice, answer: style === 0 ? short[mockCount % short.length] : long };
  }
  if (kind === "followUp") return { reply: style === 0 ? "" : "我最在意的是别出岔子。" };
  if (kind === "probe") return style === 0 ? { action: "keep_deferring", reply: "" } : { action: "answer", reply: "那我就先做，做完跟老师说一声。" };
  if (kind === "end") return style === 0 ? { repeat_rounds: [], pressure: "" } : { repeat_rounds: [2], pressure: "有几道题让我有点为难，不太想当面说那种话。" };
  return { most: ["A4", "A8"], least: ["A5", "A2"] };
}

// ---------- 一轮 ----------

const log = (...a) => console.log(...a);
const short = (s, n = 24) => (s.length > n ? `${s.slice(0, n)}……` : s);
const meta = []; // 每一组用了哪几个模型，给 summary 用

async function runSession(data, s, g0) {
  const style = s;
  const first = rolesFor(g0);
  const session = createSession(ctxWith(first.main, first.auditor), data, "live", { lifeStage: "middle" });
  const plan = session.plan.slice(0, Math.min(ROUNDS, session.plan.length));
  log(`\n=== 第 ${s + 1} 轮（${s === 0 ? "短回答" : "长回答"}），共 ${plan.length} 组 ===`);

  // 出题：按顺序一组一组准备（后一组要看到前一组的题），和网页里提前备题一样，只是一口气备完。
  const ready = [];
  let chain = Promise.resolve();
  plan.forEach((p, i) => {
    const r = rolesFor(g0 + i);
    // 第二轮起，出题时附上以前几轮同类题的开头（和网页里一样，见 session.js 的 earlierQuestions）。
    const ctx = { ...ctxWith(r.main, r.auditor), earlier: earlierQuestions(data, session) };
    chain = chain.then(() =>
      prepareRound(ctx, session, p.index).catch((e) => {
        log(`  第 ${p.index} 组出题失败（${e.message || e.kind}），重试一次`);
        return prepareRound(ctx, session, p.index);
      }),
    );
    chain.catch(() => {});
    ready.push(chain);
  });

  const codings = [];
  for (let i = 0; i < plan.length; i++) {
    const round = await ready[i];
    const r = rolesFor(g0 + i);
    const ctx = ctxWith(r.main, r.auditor);
    meta.push({ session: s + 1, index: round.index, ...r });
    const options = round.offered.map((o) => `${o.position}. ${o.text}`).join("\n");
    const pick = await subject(
      "answer",
      `第 ${round.index} 组（共 ${plan.length} 组）。下面三道题，按这个人的习惯挑一道回答；三道都不想答就选 skip。\n\n${options}\n\n只输出 JSON：{"choice": "1、2、3 或 skip", "answer": "回答（skip 时留空）"}`,
      r.subject,
      style,
    );
    const q = pick.choice === "skip" ? null : round.offered.find((o) => String(o.position) === pick.choice);
    if (!q || !String(pick.answer ?? "").trim()) {
      recordAnswer(round, { choice: "skip", answer: "" });
      log(`第 ${round.index} 组：三道都没选`);
      continue;
    }
    recordAnswer(round, { choice: q.qid, answer: pick.answer });
    log(`第 ${round.index} 组：选了 ${q.position}（${q.axis}），答：${short(pick.answer)}`);

    if (needsFollowUp(round)) {
      const prompt = t("round.followUpTitle");
      const fu = await subject("followUp", `你刚才答的题：${q.text}\n你的回答：${round.answer}\n\n工具追问：${prompt}\n按这个人的习惯回答；不想答就留空。只输出 JSON：{"reply": ""}`, r.subject, style);
      const text = String(fu.reply ?? "").trim();
      round.followUp = { prompt, text, declined: !text };
      log(`  轻追问：${text ? short(text) : "（跳过）"}`);
    }

    const c1 = ensureCoding1(ctx, session, round);
    if (mayProbe(ctx, session, round)) {
      await c1.catch(() => {});
      const prompt = shouldProbe(session, round) ? await makeProbe(ctx, round).catch((e) => log(`  补全追问没生成出来：${e.message || e.kind}`)) : null;
      if (prompt) {
        const pr = await subject(
          "probe",
          `你刚才答的题：${q.text}\n你的回答：${round.answer}\n\n工具补了一条信息：${prompt}\n现在你会怎么做？可以回答（action 写 answer），可以继续暂缓（keep_deferring），也可以不想回答（decline）。只输出 JSON：{"action": "answer", "reply": "……"}`,
          r.subject,
          style,
        );
        const reply = String(pr.reply ?? "").trim();
        if (pr.action === "answer" && reply) recordProbe(session, round, { prompt, response: reply });
        else if (pr.action === "decline") recordProbe(session, round, { prompt, declined: true });
        else recordProbe(session, round, { prompt, keptDeferring: true });
        log(`  补全追问 → ${pr.action}${reply ? `：${short(reply)}` : ""}`);
      }
    }
    codings.push(c1.catch((e) => log(`  第一遍编码失败：${e.message}`)), ensureCoding2(ctx, session, round).catch((e) => log(`  第二遍编码失败：${e.message}`)));
  }
  await Promise.all(codings);

  const list = answeredRounds(session)
    .map((r) => `第 ${r.index} 组：${chosenQuestion(r) ? short(chosenQuestion(r).text, 30) : "三道都没选"}`)
    .join("\n");
  const end = await subject(
    "end",
    `这一轮结束了。你做过的几组：\n${list}\n\n问题一：有没有哪几组让你觉得，几道题只是换了个说法？列出是第几组，没有就给空数组。\n问题二：有没有哪里让你觉得有压力或不舒服？用这个人的口气写一两句，没有就留空。\n只输出 JSON：{"repeat_rounds": [], "pressure": ""}`,
    first.subject,
    style,
  );
  const indexes = new Set(session.rounds.map((r) => r.index));
  finishSession(session, {
    reason: plan.length === session.plan.length ? "completed" : "ended",
    experience: { repeatRounds: (end.repeat_rounds ?? []).filter((n) => indexes.has(n)), pressure: String(end.pressure ?? "").trim() },
  });
  return session;
}

// ---------- 写成能读的样子 ----------

const axisName = (id) => content.axisById[id]?.name ?? id;
const R = (k, vars) => t(`report.reasoning.${k}`, vars);

function renderSession(session, offset) {
  const lines = [`## 第 ${session.number} 轮（${session.number === 1 ? "短回答" : "长回答"}）`, ""];
  for (const [k, round] of answeredRounds(session).entries()) {
    const m = meta.find((x) => x.session === session.number && x.index === round.index);
    const who = m ? `出题和第一遍编码：${m.main}；盲审和第二遍编码：${m.auditor}；答题：${m.subject}` : "";
    lines.push(offset ? `### 第 ${round.index} 组（报告里是第 ${offset + k + 1} 组）` : `### 第 ${round.index} 组`, "", `> ${who}`, "");
    for (const o of round.offered) {
      const flag = o.audit.verdict === "pass" ? (o.audit.problems?.length ? `（另记：${o.audit.problems.join("、")}）` : "") : `（未通过：${o.audit.problems.join("、")}）`;
      lines.push(`${o.position}. 【${o.axis} ${axisName(o.axis)}｜${o.pkg.carrier}｜重写 ${o.audit.attempts - 1} 次】${o.text}${flag}`);
    }
    const q = chosenQuestion(round);
    lines.push("", q ? `**选了 ${q.position}（${q.axis}）**：${round.answer}` : "**三道都没选**");
    if (round.followUp) lines.push(`- 轻追问"${followUpPrompt(round)}"：${round.followUp.text || "（跳过）"}`);
    for (const p of round.probes) lines.push(`- 补全追问"${p.prompt}"：${p.declined ? "（不想回答）" : p.keptDeferring ? "（继续暂缓）" : p.response}`);
    for (const [k, c] of [
      ["第一遍编码", round.coding1],
      ["第二遍编码", round.coding2],
    ]) {
      if (!c) continue;
      const tags = Object.keys(REASONING_DIMS)
        .map((d) => c.reasoning?.[d])
        .filter((v) => v && !Object.values(REASONING_NONE).includes(v))
        .map((v) => R(`values.${v}`));
      lines.push(`- ${k}（${c.model}）：倾向 ${c.lean}，暂缓 ${c.deferral}，标准：${(c.criteria ?? []).join("、") || "无"}；推理：${tags.join("、") || "没体现"}`);
    }
    lines.push("");
  }
  const ex = session.end?.experience;
  if (ex) lines.push(`**结束时说的**：觉得重复的组 ${ex.repeatRounds.join("、") || "无"}；感受：${ex.pressure || "（没写）"}`, "");
  return lines.join("\n");
}

function renderReport(report, title) {
  const L = [`## ${title}`, "", `用了 ${report.sessionsUsed} 轮、${report.roundsUsed} 组；跳过 ${report.overview.skips} 组；轻追问 ${report.overview.followUps} 次，补全追问 ${report.overview.probes} 次。`, ""];
  L.push("### 选择图谱", "", "| 取舍 | 出现 | 被选 | 随机期望 | 判断 |", "|---|---|---|---|---|");
  for (const r of report.choiceMap.rows) {
    const chance = r.judgment.key.startsWith("avoid") ? `，随机时约 ${Math.round(100 * r.chanceAvoid)}%` : r.judgment.key.startsWith("prefer") ? `，随机时约 ${Math.round(100 * r.chancePrefer)}%` : "";
    L.push(`| ${axisName(r.axis)} | ${r.exposures} | ${r.chosen} | ${r.expected.toFixed(1)} | ${t(`report.judgment.${r.judgment.key}`)}${chance} |`);
  }
  const rs = report.reasoning;
  if (rs) {
    L.push("", "### 你凭什么选", "");
    for (const [dim, d] of Object.entries(rs.dims)) {
      const parts = [...REASONING_DIMS[dim], REASONING_NONE[dim]].map((v) => `${v === REASONING_NONE[dim] ? "没体现" : R(`values.${v}`)} ${d.counts[v]}`);
      L.push(`- ${R(`dims.${dim}`)}：${parts.join(" · ")}；两遍对不上 ${d.counts.disagree}${d.show ? "" : "（次数不够，报告里不显示）"}`);
    }
    for (const st of rs.stability) {
      const ax = content.axisById[st.axis];
      const lean = (v) => (v === "left" ? ax.left : v === "right" ? ax.right : R(`leans.${v}`));
      const action = st.action.status === "stable" ? `一致（${lean(st.action.value)}）` : st.action.status === "varies" ? "在变" : "看不出";
      const reason = st.reason.status === "stable" ? `一致（${st.reason.dims.map((x) => R(`values.${x.value}`)).join("、")}）` : st.reason.status === "varies" ? "在变" : "看不出";
      L.push(`- ${axisName(st.axis)}（答过 ${st.rounds} 次）：做法${action}；理由${reason}`);
    }
  }
  const d = report.deferral;
  if (d.total) L.push("", "### 暂缓的方式", "", `暂缓 ${d.total} 次（有条件 ${d.conditional}，开放式 ${d.open}）；补全追问之后：做了决定 ${d.probes.decided}，新缺口 ${d.probes.new_gap}，仍然暂缓 ${d.probes.still}，不想回答 ${d.probes.declined}。`);
  L.push("", "### 假设", "");
  if (!report.hypotheses.length) L.push("（这次没有写出假设）");
  for (const h of report.hypotheses) {
    L.push(`- **${h.statement}**${h.rewritten ? "（审计员改写过）" : ""}`);
    L.push(`  - 依据：${h.evidence.map((e) => `第 ${e.round} 组（${e.channel}）${e.note}`).join("；")}`);
    L.push(`  - 反例：${h.counter.join("；")}；其它可能：${h.alternatives.join("；")}；把握：${h.confidence}（${h.confidenceReason}）`);
    L.push(`  - 预测：${h.prediction}`);
  }
  const al = report.disclosure.auditLog;
  L.push("", `被审计员退回或改写的假设：保留 ${al.kept}，改写 ${al.rewritten}，删掉 ${al.dropped}。`);
  if (report.criteria.length) {
    L.push("", "### 你常用的尺子", "");
    for (const c of report.criteria) L.push(`- ${c.label}：第 ${c.rounds.join("、")} 组${c.dominant ? "（可能的主导尺）" : ""}`);
  }
  if (report.selfPrediction) {
    const sp = report.selfPrediction;
    L.push("", "### 自我预测", "", `猜的最常选：${sp.thought.most.map(axisName).join("、") || "没选"}；最少选：${sp.thought.least.map(axisName).join("、") || "没选"}`);
    L.push(`选择图谱里判为偏好的：${sp.actual.most.map(axisName).join("、") || "暂无"}；判为回避的：${sp.actual.least.map(axisName).join("、") || "暂无"}`);
  }
  if (report.moments.length) L.push("", "### 下次可以留意的时刻", "", ...report.moments.map((m) => `- ${m}`));
  return L.join("\n");
}

function renderUsage() {
  const L = ["## 用量和费用（估算）", "", "| 模型 | 调用 | 输入 | 输出 | 缓存读 | 费用 |", "|---|---|---|---|---|---|"];
  let sum = 0;
  let priced = false;
  for (const [model, m] of Object.entries(usage)) {
    const c = costOf(model, m);
    if (c !== null) (sum += c), (priced = true);
    L.push(`| ${model} | ${m.calls} | ${m.input} | ${m.output} | ${m.cacheRead} | ${c === null ? "—" : `${c.toFixed(3)}`} |`);
  }
  if (priced) L.push("", `合计约 ${sum.toFixed(2)}`);
  if (PROVIDER === "deepseek") L.push("", "DeepSeek 按官网当前价格（分时段）自己算；你之前实测的是一轮约 2 元（调低思考强度之前）。");
  return L.join("\n");
}

// ---------- 主流程 ----------

// 做完一段就存一次：中途出错时，已经花了钱的部分不白跑。
const state = { data: null, reports: [] };

function save() {
  const { data, reports } = state;
  if (!data) return;
  mkdirSync(OUT, { recursive: true });
  const parts = [`# HL-CST 模拟：两轮`, "", `服务商：${PROVIDER}；模型轮换：${SETUP.rotation.join(" → ")}${PROVIDER === "anthropic" ? "；effort 都是 medium" : ""}；生成于 ${new Date().toLocaleString("zh-CN")}`, "", "## 虚拟受试者", "", PERSONA.split("\n\n")[1], ""];
  let offset = 0;
  for (const s of data.sessions) {
    parts.push(renderSession(s, offset));
    offset += answeredRounds(s).length;
  }
  for (const [i, r] of reports.entries()) parts.push(renderReport(r, i === 0 ? "第一轮之后的报告（只看第一轮）" : "两轮之后的报告"), "");
  parts.push(renderUsage(), "");
  writeFileSync(`${OUT}/data.json`, JSON.stringify(data, null, 2));
  for (const [i, r] of reports.entries()) writeFileSync(`${OUT}/report-${i + 1}.json`, JSON.stringify(r, null, 2));
  writeFileSync(`${OUT}/usage.json`, JSON.stringify(usage, null, 2));
  writeFileSync(`${OUT}/summary.md`, parts.join("\n"));
}

async function main() {
  await ensureKey();
  const reportCtx = ctxWith(SETUP.report.main, SETUP.report.auditor);
  const data = emptyData();
  data.profile.lifeStage = "middle";
  state.data = data;

  const s1 = await runSession(data, 0, 0);
  save();
  // 第一轮之后的报告用一份拷贝来整理（真实流程里做满之前不出报告，这份只是给你看第一轮的样子），和第二轮同时跑。
  log("\n开始整理第一轮之后的报告（和第二轮同时进行）");
  const pending1 = buildReport(reportCtx, structuredClone(data), { onProgress: (k, vars) => log(`  · [第一轮的报告] ${t(k, vars)}`) });
  pending1.catch(() => {});

  await runSession(data, 1, s1.plan.length);
  state.reports[0] = await pending1;
  save();
  log("\n看报告之前先猜一猜……");
  const guess = await subject(
    "predict",
    `看报告之前先猜一猜：下面八类取舍里，你觉得自己最常选哪两类、最少选哪两类？凭感觉，可以少选。\n${content.axes.map((a) => `${a.id} ${a.name}：${a.plain}`).join("\n")}\n只输出 JSON：{"most": ["A?"], "least": ["A?"]}`,
    SETUP.rotation[2],
    1,
  );
  data.profile.selfPrediction = { most: (guess.most ?? []).slice(0, 2), least: (guess.least ?? []).slice(0, 2), at: now() };
  log("整理两轮之后的报告……");
  state.reports[1] = await buildReport(reportCtx, data, { onProgress: (k, vars) => log(`  · ${t(k, vars)}`) });
  save();
  log(`\n完成。结果在 ${OUT}`);
  log(renderUsage());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n中途出错：${e?.name ?? ""} ${e?.message ?? e}`);
    try {
      save();
      if (state.data) console.error(`做完的部分存在 ${OUT}`);
    } catch {
      // 存不下就算了
    }
    console.error(renderUsage());
    process.exit(1);
  });
