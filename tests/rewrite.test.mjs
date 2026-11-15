// 出题后的审计：句式雷同只记录不退回；别的问题最多重写一次；每次审计查出的问题都留着。
// 用替身代替模型服务，走真实的请求路径（callRole → openaiCall → fetch）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPrompt } from "../src/text.js";
import { emptyData } from "../src/store.js";
import { normalizeSettings } from "../src/settings.js";
import { APP_VERSION, createSession, nextRoundIndex, prepareRound } from "../src/session.js";

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

test("template issues are only noted; other issues get one rewrite at most", async () => {
  const calls = { writer: 0, auditor: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    let out;
    if (system.includes("写判断题")) {
      calls.writer++;
      const slots = [...user.matchAll(/编号 (\d+)\n/g)].map((m) => Number(m[1]));
      out = { questions: slots.map((slot) => ({ slot, text: `第 ${calls.writer} 次写的第 ${slot} 道题：一件事有两条路，各有代价，有一处关键信息还不清楚，你不表态就会按默认的来。你会怎么做？` })) };
    } else if (system.includes("题目审计员")) {
      calls.auditor++;
      const items = [...user.matchAll(/编号 (\d+)：/g)].map((m) => Number(m[1]));
      // 第一次审计：第 1 题只是句式雷同，第 2 题有引导；之后一律通过。主轴照抄规格，免得算成主轴不符。
      out = {
        results: items.map((slot) => ({
          slot,
          main_axis: session.plan[0].slots.find((s) => s.slot === slot).axis,
          secondary_axes: [],
          problems: calls.auditor === 1 ? (slot === 1 ? ["template"] : slot === 2 ? ["leading"] : []) : [],
          note: "",
        })),
      };
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
  const session = createSession(ctx, emptyData(), "live", { lifeStage: "middle" });
  let round;
  try {
    round = await prepareRound(ctx, session, nextRoundIndex(session));
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.deepEqual(calls, { writer: 2, auditor: 2 }, "one rewrite pass, only for the slot with a real problem");
  const bySlot = Object.fromEntries(round.offered.map((o) => [o.slot, o.audit]));
  assert.equal(bySlot[1].verdict, "pass");
  assert.equal(bySlot[1].attempts, 1, "template alone is not rewritten");
  assert.deepEqual(bySlot[1].problems, ["template"], "but it is noted");
  assert.equal(bySlot[2].attempts, 2);
  assert.deepEqual(bySlot[2].history, [["leading"], []], "every audit attempt is kept");
  assert.equal(bySlot[3].attempts, 1);
  assert.equal(session.appVersion, APP_VERSION, "each session records which version of the rules produced it");
});
