// 标准题（修订记录第 16 轮，轴表第 9 节）：题面照写题规则，拆解齐全，样例回答的"应该编成什么"合乎编码的格式。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleLength } from "../src/text.js";
import { SCHEMAS } from "../src/schemas.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../content/zh/${p}`, import.meta.url), "utf8"));
const { questions, rules } = read("standard.json");
const axes = read("axes.json").axes;
const packages = read("packages.json");
const coder = SCHEMAS.coder.properties;
const LEANS = coder.lean.enum;
const DEFERRALS = coder.deferral.enum;
const DEFERRED_TO = coder.deferred_to.items.enum;
// 和中学例题同一套：标准题也要给中学生做。
const PRESUMES = /宿舍|室友|住校|走读|接送|送饭|手机|微信|群里|零花钱|生活费|打工|兼职|恋爱|对象|喝酒|公司|领导|工资|房子|积蓄/;

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
