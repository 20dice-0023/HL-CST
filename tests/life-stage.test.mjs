// 开始时问的身份：出题说明、包装的换说法、例题池够不够用。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIFE_STAGES, exampleRank, packageText, rankExamples, stageInfo } from "../src/life-stage.js";
import { visibleLength } from "../src/text.js";
import { QUESTION_LENGTH } from "../src/session.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../content/zh/${p}`, import.meta.url), "utf8"));
const packages = read("packages.json");
const axes = read("axes.json").axes;
const content = { packages };
const TAGS = ["middle", "college", "work", "adult", "any"];

test("every life stage has writer guidance in packages.json", () => {
  for (const id of LIFE_STAGES) {
    const info = packages.lifeStages[id];
    assert.ok(info, `missing lifeStages.${id}`);
    assert.ok(info.short && info.who, `lifeStages.${id} needs short and who`);
    for (const tag of [...info.examples, ...info.fallback]) assert.ok(TAGS.includes(tag), `unknown tag ${tag} in ${id}`);
    for (const carrier of Object.keys(info.carrierLabels ?? {})) assert.ok(packages.carriers.includes(carrier), `unknown carrier ${carrier} in ${id}`);
  }
});

test("records from before the school/college split keep their own guidance", () => {
  const legacy = stageInfo(content, "school");
  assert.notEqual(legacy, packages.lifeStages.unsaid);
  assert.ok(legacy.legacy && !LIFE_STAGES.includes("school"), "kept for old records only, not offered on the start page");
  for (const ax of axes) assert.ok(ax.examples.filter((e) => exampleRank(legacy, e) <= 1).length >= 2, `school / ${ax.id}`);
});

test("unknown or missing stages fall back to 'unsaid'", () => {
  assert.equal(stageInfo(content, undefined), packages.lifeStages.unsaid);
  assert.equal(stageInfo(content, "astronaut"), packages.lifeStages.unsaid);
});

test("packages are reworded for the stage but keep their values", () => {
  const pkg = { carrier: "工作或学习", role: "负责人", stakes: "大事", abstraction: "专业场景" };
  const middle = packageText(stageInfo(content, "middle"), pkg);
  assert.match(middle, /上课/);
  assert.match(middle, /课代表/);
  assert.match(middle, /不写人生大事/);
  assert.doesNotMatch(middle, /情境：工作或学习/);
  assert.match(packageText(stageInfo(content, "college"), pkg), /课程/);
  assert.match(packageText(stageInfo(content, "work"), pkg), /情境：工作；/);
  assert.match(packageText(stageInfo(content, "unsaid"), pkg), /不点明是公司还是学校/);
  assert.deepEqual(pkg, { carrier: "工作或学习", role: "负责人", stakes: "大事", abstraction: "专业场景" });
});

test("examples are ranked by how well they fit the stage", () => {
  const middle = stageInfo(content, "middle");
  assert.equal(exampleRank(middle, { for: "middle" }), 0);
  assert.equal(exampleRank(middle, { for: "any" }), 1);
  assert.equal(exampleRank(middle, {}), 1, "untagged counts as any");
  assert.equal(exampleRank(middle, { for: "work" }), 2);
  const ranked = rankExamples(middle, [{ for: "work", text: "w" }, { for: "any", text: "a" }, { for: "middle", text: "m" }]);
  assert.deepEqual(ranked.map((e) => e.text), ["m", "a", "w"]);
});

test("middle-school examples stay short and avoid adult or living-arrangement presuppositions", () => {
  const off = /宿舍|室友|住校|走读|接送|送饭|手机|微信|群里|零花钱|生活费|打工|兼职|恋爱|对象|喝酒|公司|领导|工资|房子|积蓄/;
  for (const ax of axes) {
    for (const e of ax.examples.filter((x) => x.for === "middle")) {
      assert.ok(visibleLength(e.text) <= 100, `${ax.id}: middle example is long`);
      assert.doesNotMatch(e.text, off, `${ax.id}: "${e.text.slice(0, 12)}" presumes something`);
    }
  }
});

test("every example is tagged, sized like a real question and uses a known carrier", () => {
  for (const ax of axes) {
    for (const e of ax.examples) {
      assert.ok(TAGS.includes(e.for), `${ax.id}: bad tag ${e.for}`);
      assert.ok(packages.carriers.includes(e.carrier), `${ax.id}: unknown carrier ${e.carrier}`);
      const len = visibleLength(e.text);
      assert.ok(len >= QUESTION_LENGTH.min && len <= QUESTION_LENGTH.max, `${ax.id}: length ${len}`);
      assert.doesNotMatch(e.text, /她|(?<!其)他/, `${ax.id}: gendered pronoun in "${e.text.slice(0, 12)}"`);
    }
  }
});

test("for every stage, each axis has at least two examples that fit", () => {
  // 试玩 5 组里一个轴最多出现两次，所以每个身份、每个轴至少要有两道合适或凑合的例题。
  for (const id of LIFE_STAGES) {
    const info = stageInfo(content, id);
    for (const ax of axes) {
      const fitting = ax.examples.filter((e) => exampleRank(info, e) <= 1).length;
      assert.ok(fitting >= 2, `${id} / ${ax.id}: only ${fitting} fitting examples`);
    }
  }
});
