// 以前几轮出过的题：出题时摘给出题模型看（取舍、情境、开头一句），只摘这一组用到的那几类（修订记录第 14 轮）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPrompt } from "../src/text.js";
import { emptyData } from "../src/store.js";
import { normalizeSettings } from "../src/settings.js";
import { createSession, earlierQuestions, finishSession, opening, prepareRound, recordAnswer } from "../src/session.js";

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

test("the opening of a question is its first sentence, joined with the next when very short, and cut when long", () => {
  assert.equal(opening("考试规定不能互相借东西。考到一半，旁边同学的笔没水了。你会怎么做？"), "考试规定不能互相借东西。");
  // 不到 8 个字的第一句连上第二句
  assert.equal(opening("周末有雨。你们约好去公园野餐，朋友说雨不大。你会怎么做？"), "周末有雨。你们约好去公园野餐，朋友说雨不大。");
  const long = opening(`${"很长的一句话".repeat(10)}。你会怎么做？`);
  assert.ok(long.endsWith("……") && long.length <= 42, long);
});

test("from the second session on, the writer sees openings of earlier questions in the same categories", async () => {
  const c = content();
  const writerInputs = [];
  let plan = [];
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    let out;
    if (system.includes("写判断题")) {
      writerInputs.push(user);
      const slots = [...user.matchAll(/编号 (\d+)\n/g)].map((m) => Number(m[1]));
      out = { questions: slots.map((slot) => ({ slot, text: `第 ${++n} 道题的情境写在这里。后面是细节，照原样做要多花不少工夫，你不说就按原来的来。你会怎么做？` })) };
    } else if (system.includes("题目审计员")) {
      const items = [...user.matchAll(/编号 (\d+)：/g)].map((m) => Number(m[1]));
      out = { results: items.map((slot) => ({ slot, main_axis: plan.find((s) => s.slot === slot).axis, secondary_axes: [], problems: [], note: "" })) };
    } else throw new Error("unexpected role");
    return new Response(JSON.stringify({ model: "stub", choices: [{ message: { content: JSON.stringify(out) }, finish_reason: "stop" }] }), { status: 200 });
  };
  const settings = normalizeSettings({ main: { provider: "custom", model: "stub-main", baseURL: "http://stub.local/v1" }, auditor: { mode: "same", model: "stub-audit" } });
  const data = emptyData();
  const ctxFor = (session) => ({ content: c, demo: false, demoState: null, settings, secrets: { keys: { custom: "k" } }, earlier: session ? earlierQuestions(data, session) : [] });
  try {
    const first = createSession(ctxFor(null), data, "live", { lifeStage: "middle" });
    for (const p of first.plan.slice(0, 4)) {
      plan = p.slots;
      const round = await prepareRound(ctxFor(first), first, p.index);
      recordAnswer(round, { choice: round.offered[0].qid, answer: "照原样做。" });
    }
    finishSession(first, { reason: "ended", experience: { repeatRounds: [], pressure: "" } });
    assert.match(writerInputs[0], /以前几轮出过的同类题[^\n]*\n（暂无）/, "nothing earlier in the first session");

    const second = createSession(ctxFor(null), data, "live", { lifeStage: "middle" });
    const p = second.plan[0];
    plan = p.slots;
    writerInputs.length = 0;
    await prepareRound(ctxFor(second), second, p.index);
    const earlierBlock = writerInputs[0].split("以前几轮出过的同类题")[1].split("这一轮已经出过的题")[0];
    const firstQuestions = first.rounds.flatMap((r) => r.offered);
    const sameCategory = (o) => p.slots.some((s) => s.axis === o.axis);
    const expected = firstQuestions.filter(sameCategory);
    assert.ok(expected.length > 0, "four groups cover every category, so some must repeat");
    for (const o of expected) assert.ok(earlierBlock.includes(`${o.pkg.carrier}：${opening(o.text)}`), `missing ${o.axis}`);
    for (const o of firstQuestions.filter((q) => !sameCategory(q))) assert.ok(!earlierBlock.includes(opening(o.text)), "only this group's categories are listed");
    assert.ok(!earlierBlock.includes("你会怎么做"), "only openings, not the full questions");
  } finally {
    globalThis.fetch = realFetch;
  }
});
