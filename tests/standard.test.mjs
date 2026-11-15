// 标准题（修订记录第 16、17 轮，轴表第 9 节）：题面照写题规则，拆解齐全，样例回答的"应该编成什么"合乎编码的格式；
// 编码时只给标准题附拆解；离线检查工具的打分方式。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleLength } from "../src/text.js";
import { SCHEMAS } from "../src/schemas.js";
import { scoreCoding, standardCardText, tally } from "../src/standard.js";
import { codeRound } from "../src/session.js";
import { normalizeSettings } from "../src/settings.js";
import { loadContentFromDisk } from "../tools/lib.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(`../content/zh/${p}`, import.meta.url), "utf8"));
const { questions, rules } = read("standard.json");
const axes = read("axes.json").axes;
const packages = read("packages.json");
const coder = SCHEMAS.coder.properties;
const LEANS = coder.lean.enum;
const DEFERRALS = coder.deferral.enum;
const DEFERRED_TO = coder.deferred_to.items.enum;
// 和中学例题同一套：标准题也要给中学生做。
const PRESUMES = /宿舍|室友|住校|走读|接送|送饭|手机|微信|群里|零花钱|生活费|优秀线|打工|兼职|恋爱|对象|喝酒|公司|领导|工资|房子|积蓄/;

test("every category has a standard question, and ids are unique", () => {
  assert.ok(rules.length >= 5);
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
  for (const ax of axes) assert.ok(questions.some((q) => q.axis === ax.id), `${ax.id} has no standard question`);
});

test("standard questions follow the writing rules and suit every life stage", () => {
  const exampleTexts = new Set(axes.flatMap((a) => a.examples.map((e) => e.text)));
  for (const q of questions) {
    assert.equal(q.for, "any", `${q.id}: standard questions are for everyone`);
    assert.ok(packages.carriers.includes(q.carrier), `${q.id}: unknown carrier`);
    const len = visibleLength(q.text);
    assert.ok(len >= 50 && len <= 100, `${q.id}: length ${len}`);
    assert.doesNotMatch(q.text, /她|(?<!其)他/, `${q.id}: gendered pronoun`);
    assert.doesNotMatch(q.text, PRESUMES, `${q.id}: presumes something`);
    assert.ok(!exampleTexts.has(q.text), `${q.id}: same text as an example`);
  }
});

test("each card is complete and each sample says what it should be coded as", () => {
  for (const q of questions) {
    for (const k of ["left", "right", "stake", "gap"]) assert.ok(q.card[k]?.trim(), `${q.id}: card.${k}`);
    assert.ok(q.card.routes.length >= 2, `${q.id}: routes`);
    assert.ok(q.card.criteria.length >= 3, `${q.id}: criteria`);
    assert.ok(q.samples.length >= 4, `${q.id}: samples`);
    for (const s of q.samples) {
      const where = `${q.id}: "${s.answer.slice(0, 10)}"`;
      assert.ok(s.answer.trim(), where);
      assert.ok(LEANS.includes(s.expect.lean), `${where}: lean`);
      assert.ok(DEFERRALS.includes(s.expect.deferral), `${where}: deferral`);
      for (const d of s.expect.deferred_to) assert.ok(DEFERRED_TO.includes(d), `${where}: deferred_to ${d}`);
      // 判断标准统一用拆解里的说法，比对时才对得上。
      for (const c of s.expect.criteria) assert.ok(q.card.criteria.includes(c), `${where}: criteria ${c} is not on the card`);
      // 规则第二条：有条件和暂缓，两个字段要对得上。
      if (s.expect.lean === "conditional") assert.equal(s.expect.deferral, "conditional", where);
      if (s.expect.lean === "deferred") assert.equal(s.expect.deferral, "open", where);
    }
    const leans = new Set(q.samples.map((s) => s.expect.lean));
    assert.ok(leans.has("left") && leans.has("right"), `${q.id}: samples should cover both sides`);
  }
});

test("the card goes to the coder only for standard questions", () => {
  const content = loadContentFromDisk({ standard: true });
  const s = content.standard.questions[0];
  const card = standardCardText(content, { axis: s.axis, text: s.text, standardId: s.id });
  for (const part of [s.card.left, s.card.right, s.card.routes[0], s.card.criteria.join("、"), `1. ${content.standard.rules[0]}`]) assert.ok(card.includes(part), part);
  assert.doesNotMatch(card, /回答：/, "the mock server finds the answer by this label");
  assert.equal(standardCardText(content, { axis: s.axis, text: s.text }), "", "an ordinary question gets nothing");
  assert.equal(standardCardText(content, { standardId: "nope" }), "");
  assert.equal(standardCardText(loadContentFromDisk(), { standardId: s.id }), "", "the web page does not load standard.json yet");
});

test("scoring a coding against what it should be", () => {
  const expect = { lean: "right", deferral: "none", deferred_to: ["专家"], criteria: ["专业意见", "改的代价"] };
  const good = { lean: "right", deferral: "none", deferred_to: ["专家"], criteria: ["教练的专业意见"] };
  assert.deepEqual(scoreCoding(expect, good), { lean: true, deferral: true, deferredTo: true, criteria: true });
  const bad = { lean: "deferred", deferral: "open", deferred_to: [], criteria: ["自己的感受"] };
  assert.deepEqual(scoreCoding(expect, bad), { lean: false, deferral: false, deferredTo: false, criteria: false });
  assert.equal(scoreCoding({ ...expect, criteria: [] }, good).criteria, null, "no expected criteria: not counted");
  const sum = tally([scoreCoding(expect, good), scoreCoding({ ...expect, criteria: [] }, bad), null]);
  assert.deepEqual(sum.lean, { right: 1, total: 3 }, "a failed coding counts as wrong");
  assert.deepEqual(sum.criteria, { right: 1, total: 2 });
});

test("coding a standard question sends its card; an ordinary question does not", async () => {
  const content = loadContentFromDisk({ standard: true });
  const s = content.standard.questions.find((q) => q.id === "S-A3-1");
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(init.body).messages[1].content);
    const out = {
      lean: "right",
      deferral: "none",
      missing_info: [],
      criteria: ["专业意见"],
      flip_conditions: [],
      deferred_to: ["专家"],
      quotes: [],
      question_problem: "",
      probe_outcome: "none",
      reasoning: { basis: "none", weighing: "none", scope: "none", likelihood: "not_mentioned", certainty: "sure" },
    };
    return new Response(JSON.stringify({ model: "stub", choices: [{ message: { content: JSON.stringify(out) }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const ctx = {
      content,
      demo: false,
      demoState: null,
      settings: normalizeSettings({ main: { provider: "custom", model: "stub-main", baseURL: "http://stub.local/v1" }, auditor: { mode: "same", model: "stub-audit" } }),
      secrets: { keys: { custom: "test-key" } },
    };
    const round = (extra) => ({ index: 1, offered: [{ qid: "q", axis: s.axis, text: s.text, ...extra }], choice: "q", answer: s.samples[0].answer, followUp: null, probes: [] });
    const coding = await codeRound(ctx, round({ standardId: s.id }));
    await codeRound(ctx, round({}));
    assert.equal(coding.lean, "right");
    assert.ok(seen[0].includes("这道题事先拆过") && seen[0].includes(s.card.left));
    assert.ok(seen[0].indexOf("这道题事先拆过") < seen[0].indexOf("回答："), "the card sits between the question and the answer");
    assert.ok(!seen[1].includes("这道题事先拆过"));
  } finally {
    globalThis.fetch = realFetch;
  }
});
