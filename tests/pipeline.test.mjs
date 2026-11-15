// 端到端：用试玩模式（不调用任何模型）跑完一轮并整理报告。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPrompt } from "../src/text.js";
import { emptyData } from "../src/store.js";
import {
  createSession,
  prepareRound,
  nextRoundIndex,
  recordAnswer,
  codeRound,
  shouldProbe,
  makeProbe,
  recordProbe,
  finishSession,
  answeredRounds,
} from "../src/session.js";
import { buildReport } from "../src/analysis.js";
import { ensureCoding1, ensureCoding2, mayProbe } from "../src/session.js";

const read = (p) => readFileSync(new URL(`../content/zh/${p}`, import.meta.url), "utf8");

function loadContentFromDisk() {
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

test("a demo session runs from first round to report", async () => {
  const content = loadContentFromDisk();
  const data = emptyData();
  const ctx = { settings: null, secrets: null, content, demo: true, demoState: { usedExamples: new Set() } };
  const session = createSession(ctx, data, "demo");
  assert.equal(session.plan.length, 5);

  const answers = ["我会先看看情况再说，要看对方怎么想。", "直接说清楚，代价大也要说。", "", "先按规定来，问一下领导。", "去。"];
  let i = 0;
  for (let index = nextRoundIndex(session); index !== null; index = nextRoundIndex(session)) {
    const round = await prepareRound(ctx, session, index);
    assert.equal(round.offered.length, 3);
    assert.deepEqual(round.offered.map((o) => o.position), [1, 2, 3]);
    assert.ok(round.offered.every((o) => o.audit.verdict === "pass"));
    const answer = answers[i++];
    if (!answer) recordAnswer(round, { choice: "skip", answer: "" });
    else {
      recordAnswer(round, { choice: round.offered[0].qid, answer });
      await codeRound(ctx, round);
      if (shouldProbe(session, round)) {
        const prompt = await makeProbe(ctx, round);
        recordProbe(session, round, { prompt, response: "那我会做。" });
      }
    }
  }
  // 试玩的 15 道题都不重复
  const texts = session.rounds.flatMap((r) => r.offered.map((o) => o.text));
  assert.equal(new Set(texts).size, texts.length);

  finishSession(session, { reason: "completed", experience: { repeatRounds: [2], pressure: "" } });
  assert.equal(answeredRounds(session).length, 5);

  const progress = [];
  const report = await buildReport(ctx, data, { demoSession: session, onProgress: (k) => progress.push(k) });
  assert.equal(report.demo, true);
  assert.equal(report.roundsUsed, 5);
  assert.equal(report.overview.skips, 1);
  assert.equal(report.choiceMap.rows.length, 8);
  assert.ok(report.choiceMap.rows.every((r) => r.judgment.key === "insufficient"), "5 rounds should never be enough for a judgment");
  assert.ok(report.deferral.total >= 1);
  assert.ok(report.hypotheses.length >= 1);
  assert.ok(report.disclosure.rounds.length === 5);
  assert.ok(progress.includes("analysis.analyst"));
  assert.equal(session.report, report);
  assert.equal(data.profile.reports.length, 0, "demo reports never enter the live profile");
  assert.deepEqual(report.disclosure.lifeStages, ["unsaid"]);
  // 你凭什么选：四段回答都有两遍编码，推理方式按两遍对得上的算。
  assert.equal(report.reasoning.answered, 4);
  assert.ok(session.rounds.filter((r) => r.choice !== "skip").every((r) => r.coding1.version === 2 && r.coding2.version === 2));
  assert.ok(Array.isArray(report.reasoning.stability));
});

test("only answers that might be deferrals wait for coding", async () => {
  const content = loadContentFromDisk();
  const ctx = { settings: null, secrets: null, content, demo: true, demoState: { usedExamples: new Set() } };
  const session = createSession(ctx, emptyData(), "demo");
  const round = await prepareRound(ctx, session, nextRoundIndex(session));
  recordAnswer(round, { choice: round.offered[0].qid, answer: "直接去做，做完再说一声。" });
  assert.equal(mayProbe(ctx, session, round), true, "再说 is a hint word, so wait");
  recordAnswer(round, { choice: round.offered[0].qid, answer: "我会马上把这件事办了。" });
  assert.equal(mayProbe(ctx, session, round), false);
  session.probesUsed = 3;
  recordAnswer(round, { choice: round.offered[0].qid, answer: "看情况吧。" });
  assert.equal(mayProbe(ctx, session, round), false, "no probes left, never wait");
});

test("background coding runs once per round and the report fills in what never ran", async () => {
  const content = loadContentFromDisk();
  const data = emptyData();
  const ctx = { settings: null, secrets: null, content, demo: true, demoState: { usedExamples: new Set() } };
  const session = createSession(ctx, data, "demo");
  for (let index = nextRoundIndex(session); index !== null; index = nextRoundIndex(session)) {
    const round = await prepareRound(ctx, session, index);
    recordAnswer(round, { choice: round.offered[1].qid, answer: "先问问老师再决定。" });
  }
  const first = session.rounds[0];
  const [a, b] = [ensureCoding1(ctx, session, first), ensureCoding1(ctx, session, first)];
  assert.equal(a, b, "a second call while the first is running reuses it");
  await a;
  assert.ok(first.coding1);
  assert.ok(session.rounds.slice(1).every((r) => !r.coding1 && !r.coding2), "the other rounds were never coded");
  finishSession(session, { reason: "completed", experience: { repeatRounds: [], pressure: "" } });
  await buildReport(ctx, data, { demoSession: session });
  assert.ok(session.rounds.every((r) => r.coding1 && r.coding2), "the report codes every answered round twice");
  assert.equal(await ensureCoding2(ctx, session, first), first.coding2, "finished codings are not redone");
});

test("a middle-school student's demo session only uses middle-school examples", async () => {
  const content = loadContentFromDisk();
  const data = emptyData();
  const ctx = { settings: null, secrets: null, content, demo: true, demoState: { usedExamples: new Set() } };
  const session = createSession(ctx, data, "demo", { lifeStage: "middle" });
  assert.equal(session.lifeStage, "middle");
  const fits = new Map(content.axes.flatMap((a) => a.examples.map((e) => [e.text, e.for])));
  const carrierOf = new Map(content.axes.flatMap((a) => a.examples.map((e) => [e.text, e.carrier])));
  for (let index = nextRoundIndex(session); index !== null; index = nextRoundIndex(session)) {
    const round = await prepareRound(ctx, session, index);
    recordAnswer(round, { choice: "skip", answer: "" });
  }
  const texts = session.rounds.flatMap((r) => r.offered.map((o) => o.text));
  assert.equal(texts.length, 15);
  assert.equal(new Set(texts).size, 15);
  for (const text of texts) assert.equal(fits.get(text), "middle", `not a middle-school example: ${text.slice(0, 16)}`);
  // 披露里的情境要和题面对得上：试玩记的是例题自己的情境，不是调度原本排的。
  for (const o of session.rounds.flatMap((r) => r.offered)) assert.equal(o.pkg.carrier, carrierOf.get(o.text));
});
