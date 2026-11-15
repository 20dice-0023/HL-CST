// 假设的把关：证据不够两条的直接删；词表查出的问题交给审计员改写，改写后还带着那些词的不进报告。
// 用替身代替模型服务，走真实的请求路径。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPrompt } from "../src/text.js";
import { emptyData } from "../src/store.js";
import { normalizeSettings } from "../src/settings.js";
import { createSession, ensureCoding1, ensureCoding2, finishSession, prepareRound, recordAnswer } from "../src/session.js";
import { buildReport } from "../src/analysis.js";

const read = (p) => readFileSync(new URL(`../content/zh/${p}`, import.meta.url), "utf8");

function content() {
  const axesFile = JSON.parse(read("axes.json"));
  const names = ["writer", "auditor-questions", "coder", "probe", "analyst", "auditor-hypotheses", "auditor-recheck", "ping"];
  return {
    locale: "zh",
    axisTableVersion: axesFile.version,
    axes: axesFile.axes,
    axisIds: axesFile.axes.map((a) => a.id),
    axisById: Object.fromEntries(axesFile.axes.map((a) => [a.id, a])),
    packages: JSON.parse(read("packages.json")),
    wordlists: JSON.parse(read("wordlists.json")),
    ui: JSON.parse(read("ui.json")),
    prompts: Object.fromEntries(names.map((n) => [n, splitPrompt(read(`prompts/${n}.md`))])),
  };
}

const evidence = [
  { round: 1, channel: "回答", note: "说要照原样做" },
  { round: 2, channel: "选择", note: "选了这一类" },
];
const hyp = (statement, over = {}) => ({
  statement,
  evidence,
  counter: ["本次没有发现反例"],
  alternatives: ["样本小"],
  confidence: "低",
  confidence_reason: "样本小",
  prediction: "如果下次你先问别人再定，这条就不成立。",
  ...over,
});
const review = (index, over = {}) => ({ index, pass: true, problems: [], rewrite_statement: "", rewrite_prediction: "", ...over });

test("program checks go to the auditor for a rewrite; what still breaks the rules stays out of the report", async () => {
  const analystOut = {
    criteria: [],
    hypotheses: [
      hyp("碰到答应过别人的事，你倾向于照原样做完，再说明情况变了。"),
      // "更好"在词表里，可它就出现在"求稳 / 搏一把"自己的说明里：交给审计员改写，不直接删。
      hyp("在确定但一般、和不确定但可能更好的两条路之间，你倾向于选确定的那条。"),
      // 审计员没给改写：仍然不进报告。
      hyp("别人拿不定主意的时候，你倾向于先看对方的性格再开口。"),
      // 只有一条证据：审计员补不了证据，直接删，也不送审。
      hyp("只有一条证据的假设：你倾向于先做再说。", { evidence: [evidence[0]] }),
      // 审计员只改了陈述，原来的预测里还带着词表里的词：最终显示的两句话一起查，不进报告。
      hyp("拿不准的时候，你倾向于先找能拍板的人。", { prediction: "如果下次你自己定了，而且结果更好，这条就不成立。" }),
    ],
    prior_checks: [],
    moments: [],
  };
  const auditOut = {
    reviews: [
      review(1),
      review(2, { rewrite_statement: "在确定但一般、和不确定但可能有更大收获的两条路之间，你倾向于选确定的那条。", rewrite_prediction: "如果下次你选了不确定的那条，这条就不成立。" }),
      review(3),
      review(4, { rewrite_statement: "拿不准的时候，你倾向于先去问能拍板的人。" }),
    ],
  };

  let plan = [];
  let auditorSaw = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    let out;
    if (system.includes("写判断题")) {
      const slots = [...user.matchAll(/编号 (\d+)\n/g)].map((m) => Number(m[1]));
      out = { questions: slots.map((slot) => ({ slot, text: `第 ${slot} 道：你答应过同学的一件小事，现在情况变了，照原样做要多花不少工夫。你不说，就按原来说好的来。你会怎么做？` })) };
    } else if (system.includes("题目审计员")) {
      const items = [...user.matchAll(/编号 (\d+)：/g)].map((m) => Number(m[1]));
      out = { results: items.map((slot) => ({ slot, main_axis: plan.find((s) => s.slot === slot).axis, secondary_axes: [], problems: [], note: "" })) };
    } else if (system.includes("回答做编码")) {
      out = {
        lean: "left",
        deferral: "none",
        missing_info: [],
        criteria: ["会不会失信"],
        flip_conditions: [],
        deferred_to: [],
        quotes: ["我会照原样做"],
        question_problem: "",
        probe_outcome: "none",
        reasoning: { basis: "consequence", weighing: "none", scope: "none", likelihood: "not_mentioned", certainty: "sure" },
      };
    } else if (system.includes("写分析")) out = analystOut;
    else if (system.includes("分析审计员")) {
      auditorSaw = user;
      out = auditOut;
    } else throw new Error("unexpected role");
    return new Response(JSON.stringify({ model: "stub", choices: [{ message: { content: JSON.stringify(out) }, finish_reason: "stop" }] }), { status: 200 });
  };

  const ctx = {
    content: content(),
    demo: false,
    demoState: null,
    settings: normalizeSettings({ main: { provider: "custom", model: "stub-main", baseURL: "http://stub.local/v1" }, auditor: { mode: "same", model: "stub-audit" } }),
    secrets: { keys: { custom: "test-key" } },
  };
  const data = emptyData();
  let report;
  try {
    const session = createSession(ctx, data, "live", { lifeStage: "middle" });
    for (const p of session.plan.slice(0, 3)) {
      plan = p.slots;
      const round = await prepareRound(ctx, session, p.index);
      recordAnswer(round, { choice: round.offered[0].qid, answer: "我会照原样做，答应了就得做到。" });
      await ensureCoding1(ctx, session, round);
      await ensureCoding2(ctx, session, round);
    }
    finishSession(session, { reason: "ended", experience: { repeatRounds: [], pressure: "" } });
    report = await buildReport(ctx, data);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.match(auditorSaw, /2\. 在确定但一般[\s\S]*?程序检查：陈述或预测里用了评价或标签性的词（更好）/, "the auditor is told what the word list caught");
  assert.doesNotMatch(auditorSaw, /只有一条证据的假设/, "a hypothesis with too little evidence is not sent for audit");

  assert.equal(report.hypotheses.length, 2);
  assert.ok(report.hypotheses[0].statement.startsWith("碰到答应过别人的事"));
  assert.equal(report.hypotheses[0].rewritten, false);
  assert.match(report.hypotheses[1].statement, /更大收获/, "the auditor's rewrite replaces the flagged wording");
  assert.equal(report.hypotheses[1].rewritten, true);
  for (const h of report.hypotheses) assert.ok(h.evidence.length >= 2);

  // 披露里写实际用的模型：出题、审题按每轮记的，写报告、核对假设按这次调用的（替身回的模型名是 stub）。
  assert.deepEqual(report.disclosure.models, { writer: ["custom / stub-main"], auditor: ["custom / stub-audit"], analyst: "custom / stub", checker: "custom / stub" });

  const log = report.disclosure.auditLog;
  assert.deepEqual([log.kept, log.rewritten, log.dropped], [1, 1, 3]);
  const outcome = (start) => log.details.find((d) => d.statement.startsWith(start));
  assert.deepEqual(outcome("只有一条证据").problems, ["证据少于两条"]);
  assert.equal(outcome("别人拿不定主意").outcome, "dropped");
  assert.equal(outcome("拿不准的时候").outcome, "dropped", "the prediction that would be shown still has a flagged word");
});
