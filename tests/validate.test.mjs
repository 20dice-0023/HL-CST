// 模型输出先按结构整理、检查，再用：能安全修正的修正，取值不对或缺字段的让模型重答。
// 只靠提示词约束的服务商（DeepSeek、本地模型）靠这一步把关。
import test from "node:test";
import assert from "node:assert/strict";
import { conform } from "../src/validate.js";
import { SCHEMAS } from "../src/schemas.js";
import { callRole } from "../src/llm.js";
import { normalizeSettings } from "../src/settings.js";
import { CODING_VERSION, needsCoding, repairCodings } from "../src/session.js";

const coding = (over = {}) => ({
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
  ...over,
});

test("harmless slips are repaired without asking again", () => {
  const { value, errors } = conform(
    coding({ criteria: null, quotes: "只有一句", deferral: " None ", lean: "LEFT", question_problem: null, extra: "不在结构里的字段" }),
    SCHEMAS.coder,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(value.criteria, [], "an empty value where a list belongs becomes an empty list");
  assert.deepEqual(value.quotes, ["只有一句"], "a single value where a list belongs is wrapped");
  assert.equal(value.deferral, "none", "case and spaces are forgiven");
  assert.equal(value.lean, "left");
  assert.equal(value.question_problem, "");
  assert.equal("extra" in value, false, "fields outside the structure are dropped");

  const audit = conform({ results: [{ slot: "2", main_axis: "A3", secondary_axes: null, problems: [], note: "" }] }, SCHEMAS.auditorQuestions);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.value.results[0].slot, 2, "a number written as text is read as a number");

  assert.equal(conform({ confirmed: "true", note: "" }, SCHEMAS.recheck).value.confirmed, true);
});

test("values outside the allowed set and missing fields are reported, with where and why", () => {
  const bad = conform(coding({ deferral: "无", reasoning: { basis: "consequence", weighing: "none", likelihood: "not_mentioned", certainty: "sure" } }), SCHEMAS.coder);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors.join("；"), /deferral 只能是 none、conditional、open 之一，不能是 "无"/);
  assert.match(bad.errors.join("；"), /缺少字段 reasoning\.scope/);

  assert.match(conform({ results: [{ slot: 1, main_axis: "A9", secondary_axes: [], problems: ["太长"], note: "" }] }, SCHEMAS.auditorQuestions).errors.join("；"), /results\[0\]\.main_axis/);
  assert.equal(conform([], SCHEMAS.ping).errors.length, 1, "the top level must be an object");
  assert.equal(conform({ ok: "也许" }, SCHEMAS.ping).errors.length, 1);
});

test("a bad reply is sent back once with the specific problem; a second bad reply is an error", async () => {
  const ctx = {
    content: { prompts: { coder: { system: "编码", user: "题目：{{question}}" } } },
    demo: false,
    demoState: null,
    settings: normalizeSettings({ main: { provider: "custom", model: "stub", baseURL: "http://stub.local/v1" }, auditor: { mode: "same", model: "stub" } }),
    secrets: { keys: { custom: "test-key" } },
  };
  const reply = (out) => new Response(JSON.stringify({ model: "stub", choices: [{ message: { content: JSON.stringify(out) }, finish_reason: "stop" }] }), { status: 200 });
  const realFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (_url, init) => {
      seen.push(JSON.parse(init.body).messages[1].content);
      return reply(seen.length === 1 ? coding({ deferral: "无" }) : coding({ deferral: "open" }));
    };
    const res = await callRole(ctx, "coder", { question: "题" });
    assert.equal(res.data.deferral, "open");
    assert.equal(seen.length, 2);
    assert.match(seen[1], /上一次的输出不能用：deferral 只能是 none、conditional、open 之一/, "the second request says exactly what was wrong");

    globalThis.fetch = async () => reply(coding({ lean: "偏左" }));
    await assert.rejects(callRole(ctx, "coder", { question: "题" }), (e) => e.kind === "bad_output" && /lean 只能是/.test(e.message));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("codings stored before this check are repaired in place, or dropped so they get redone", () => {
  const round = {
    choice: "q1",
    coding1: { ...coding({ criteria: null }), model: "old-model", version: CODING_VERSION },
    coding2: { ...coding({ deferral: "无" }), model: "old-model", version: CODING_VERSION },
  };
  repairCodings(round);
  assert.deepEqual(round.coding1.criteria, []);
  assert.equal(round.coding1.model, "old-model", "who coded it and under which rules is kept");
  assert.equal(round.coding1.version, CODING_VERSION);
  assert.equal(round.coding2, null, "a coding that cannot be repaired is dropped");
  assert.equal(needsCoding(round), true, "so the report codes that answer again");
});
