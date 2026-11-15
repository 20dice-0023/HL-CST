// 试玩：没说身份的人，例题按中学七、成年人三抽；试玩报告里类别不写名字（修订记录第 14 轮）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPrompt } from "../src/text.js";
import { emptyData } from "../src/store.js";
import { mulberry32 } from "../src/rng.js";
import { stageInfo } from "../src/life-stage.js";
import { pickExample } from "../src/providers/demo.js";
import { createSession, finishSession, nextRoundIndex, prepareRound, recordAnswer, codeRound } from "../src/session.js";
import { buildReport } from "../src/analysis.js";
import { axisLabel } from "../src/content.js";

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

test("for someone who did not say who they are, demo examples come about 70% from the middle-school bank", () => {
  const c = content();
  const stage = stageInfo(c, "unsaid");
  const rng = mulberry32(2026);
  let middle = 0;
  const total = 2000;
  for (let i = 0; i < total; i++) {
    const ax = c.axes[i % c.axes.length];
    if (pickExample(stage, ax.examples, "朋友和社交", rng).for === "middle") middle++;
  }
  const share = middle / total;
  assert.ok(share > 0.66 && share < 0.74, `middle-school share ${share.toFixed(3)}`);
});

test("the adult part prefers general examples, and every category now has at least one", () => {
  const c = content();
  for (const ax of c.axes) assert.ok(ax.examples.some((e) => e.for === "any"), `${ax.id} has no general example`);
  const stage = stageInfo(c, "unsaid");
  const adultPart = () => 0.99; // 落在"成年人"那份
  // A3 原来没有通用例题，抽成年人那份时会抽到装修、买基金；现在先抽通用的。
  assert.equal(pickExample(stage, c.axisById.A3.examples, "钱", adultPart).for, "any");
  // 别的身份不受影响：在上中学的照旧只挑中学的。
  assert.equal(pickExample(stageInfo(c, "middle"), c.axisById.A3.examples, "钱", adultPart).for, "middle");
});

test("the demo report never shows category names", async () => {
  const c = content();
  const data = emptyData();
  const ctx = { settings: null, secrets: null, content: c, demo: true, demoState: { usedExamples: new Set(), rng: mulberry32(7) } };
  const session = createSession(ctx, data, "demo", { lifeStage: "unsaid" });
  const answers = ["我会先看看情况再说，要看对方怎么想。", "直接说清楚。", "先按规定来，问一下老师。", "去。", "看情况吧，万一出事就麻烦了。"];
  let i = 0;
  for (let index = nextRoundIndex(session); index !== null; index = nextRoundIndex(session)) {
    const round = await prepareRound(ctx, session, index);
    recordAnswer(round, { choice: round.offered[i % 3].qid, answer: answers[i++] });
    await codeRound(ctx, round);
  }
  finishSession(session, { reason: "completed", experience: { repeatRounds: [], pressure: "" } });
  const report = await buildReport(ctx, data, { demoSession: session });
  assert.equal(report.masked, true);
  const text = JSON.stringify(report);
  for (const ax of c.axes) {
    assert.ok(!text.includes(ax.name), `report mentions "${ax.name}"`);
    assert.ok(!text.includes(ax.left) && !text.includes(ax.right), `report mentions a side of ${ax.id}`);
  }
  assert.ok(report.hypotheses.some((h) => /在第[一二三四五六七八]类取舍上/.test(h.statement)), "the rule-made hypothesis uses the stand-in name");
  assert.equal(axisLabel(c, "A3", { masked: true }), "第三类");
  assert.equal(axisLabel(c, "A3"), c.axisById.A3.name);
});
