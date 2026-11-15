// "你凭什么选"：推理方式的次数，和同一类取舍里做法、理由各自稳不稳。
import test from "node:test";
import assert from "node:assert/strict";
import { REASONING_NONE, REASONING_SHOW_MIN, agreedTag, reasoningCounts, stabilityRows } from "../src/reasoning.js";
import { CODING_VERSION, needsCoding } from "../src/session.js";
import { SCHEMAS } from "../src/schemas.js";

const tags = (over = {}) => ({ ...REASONING_NONE, ...over });
const round = (lean, r1, r2 = r1, lean2 = lean) => ({
  choice: "q",
  coding1: { lean, reasoning: tags(r1), version: CODING_VERSION },
  coding2: { lean: lean2, reasoning: tags(r2), version: CODING_VERSION },
});

test("a tag counts only when both codings agree", () => {
  const r = round("left", { basis: "consequence", weighing: "overall" }, { basis: "consequence", weighing: "worst_case" });
  assert.equal(agreedTag(r, "basis"), "consequence");
  assert.equal(agreedTag(r, "weighing"), null);
  assert.equal(agreedTag({ coding1: r.coding1 }, "basis"), null, "one coding alone is not enough");
});

test("a dimension shows only once it has enough tags", () => {
  const rounds = [
    round("left", { basis: "consequence", likelihood: "mentioned" }),
    round("left", { basis: "consequence" }),
    round("right", { basis: "experience" }),
    round("left", {}),
  ];
  const { dims, answered } = reasoningCounts(rounds);
  assert.equal(answered, 4);
  assert.deepEqual(dims.basis.counts, { consequence: 2, experience: 1, none: 1, disagree: 0 });
  assert.equal(dims.basis.show, false, `needs ${REASONING_SHOW_MIN} tagged answers`);
  assert.equal(dims.likelihood.show, true, "not mentioning likelihood is itself an answer, so 4 agreed rounds are enough");
  rounds.push(round("left", { basis: "experience" }));
  assert.equal(reasoningCounts(rounds).dims.basis.show, true);
});

test("stability compares what people did with why they did it", () => {
  const A2 = (lean, basis) => ({ axis: "A2", round: round(lean, { basis }) });
  const rows = stabilityRows(
    [
      // A2：做法一致（都偏变通），理由在变
      A2("right", "consequence"),
      A2("right", "experience"),
      A2("right", "consequence"),
      A2("right", "experience"),
      // A5：只答过两次，不够
      { axis: "A5", round: round("left", { basis: "consequence" }) },
      { axis: "A5", round: round("left", { basis: "consequence" }) },
      // A7：做法在变，理由一致
      { axis: "A7", round: round("left", { scope: "as_a_rule" }) },
      { axis: "A7", round: round("right", { scope: "as_a_rule" }) },
      { axis: "A7", round: round("conditional", { scope: "as_a_rule" }) },
    ],
    ["A2", "A5", "A7"],
  );
  assert.deepEqual(rows.map((r) => r.axis), ["A2", "A7"]);
  const [a2, a7] = rows;
  assert.equal(a2.action.status, "stable");
  assert.equal(a2.action.value, "right");
  assert.equal(a2.reason.status, "varies");
  assert.equal(a7.action.status, "varies");
  assert.equal(a7.reason.status, "stable");
  assert.equal(a7.reason.dims[0].value, "as_a_rule");
});

test("answers without any stated reason make the reason column 'unclear'", () => {
  const rows = stabilityRows([1, 2, 3].map(() => ({ axis: "A1", round: round("left", {}) })), ["A1"]);
  assert.equal(rows[0].action.status, "stable");
  assert.equal(rows[0].reason.status, "unclear");
});

test("codings from before the reasoning tags get redone once", () => {
  const old = { choice: "q", coding1: { lean: "left" }, coding2: { lean: "left" } };
  assert.equal(needsCoding(old), true);
  assert.equal(needsCoding(round("left", {})), false);
  assert.equal(needsCoding({ choice: "skip" }), false);
});

test("the coder must return every reasoning dimension", () => {
  const schema = SCHEMAS.coder.properties.reasoning;
  assert.deepEqual(schema.required.sort(), ["basis", "certainty", "likelihood", "scope", "weighing"]);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.basis.enum.includes("none"));
});
