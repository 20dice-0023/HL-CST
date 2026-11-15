import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fitChoiceModel,
  choiceProbabilities,
  calibrateAxes,
  judgeAxis,
  axisTable,
  leaveOneOut,
} from "../src/choice-model.js";
import { planRounds } from "../src/scheduler.js";
import { mulberry32 } from "../src/rng.js";

const AXES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
const packages = JSON.parse(readFileSync(new URL("../content/zh/packages.json", import.meta.url), "utf8"));

function pick(weights, rng) {
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length - 1; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

function simulate({ nRounds, seed, utility, withWorst = false }) {
  const rng = mulberry32(seed);
  return planRounds({ axes: AXES, nRounds, rng, packages }).map((r) => {
    const options = r.slots.map((s) => ({ axis: s.axis, position: s.position }));
    const u = options.map(utility);
    const choice = pick(u.map(Math.exp), rng);
    const round = { options, choice };
    if (withWorst) {
      const rest = [0, 1, 2].filter((i) => i !== choice);
      round.worst = rest[pick(rest.map((i) => Math.exp(-u[i])), rng)];
    }
    return round;
  });
}

const judge = (rounds, seed = 1) => {
  const model = fitChoiceModel(rounds, AXES);
  return axisTable(rounds, AXES, model, calibrateAxes(rounds, AXES, model, { nSim: 199, rng: mulberry32(seed) }));
};

test("probabilities sum to one and include the skip option", () => {
  const rounds = simulate({ nRounds: 12, seed: 1, utility: () => 0 });
  const p = choiceProbabilities(fitChoiceModel(rounds, AXES), rounds[0].options);
  assert.equal(p.length, 4);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("axis effects sum to zero", () => {
  const rounds = simulate({ nRounds: 22, seed: 2, utility: (o) => (o.axis === "A3" ? 1 : 0) });
  const model = fitChoiceModel(rounds, AXES);
  const total = AXES.reduce((s, a) => s + model.effects[a].mean, 0);
  assert.ok(Math.abs(total) < 1e-9, `sum was ${total}`);
});

test("a never-chosen axis over four sessions is flagged as avoided", () => {
  const rounds = simulate({ nRounds: 44, seed: 3, utility: (o) => (o.axis === "A2" ? -8 : 0) });
  const a2 = judge(rounds).find((r) => r.axis === "A2");
  assert.equal(a2.chosen, 0);
  assert.ok(a2.judgment.key.startsWith("avoid"), `got ${a2.judgment.key} (chance ${a2.chanceAvoid})`);
});

test("marking the least-wanted question makes avoidance visible within two sessions", () => {
  const rounds = simulate({ nRounds: 22, seed: 4, utility: (o) => (o.axis === "A2" ? -3 : 0), withWorst: true });
  const a2 = judge(rounds).find((r) => r.axis === "A2");
  assert.ok(a2.worst >= 4, `A2 marked least-wanted only ${a2.worst} times`);
  assert.ok(a2.judgment.key.startsWith("avoid"), `got ${a2.judgment.key} (chance ${a2.chanceAvoid})`);
});

test("pure position habit is absorbed by position terms, not axis terms", () => {
  const rounds = simulate({ nRounds: 22, seed: 5, utility: (o) => (o.position === 1 ? 4 : 0) });
  const model = fitChoiceModel(rounds, AXES);
  assert.ok(model.position[2] < -1 && model.position[3] < -1);
  const strong = judge(rounds).filter((r) => r.judgment.key.endsWith("_strong"));
  assert.equal(strong.length, 0, `unexpected strong flags: ${strong.map((r) => r.axis)}`);
  const loo = leaveOneOut(rounds, AXES);
  assert.ok(loo.posHits >= loo.n - 3);
});

test("judgeAxis uses chance levels and exposure thresholds", () => {
  assert.equal(judgeAxis({ exposures: 3, chanceAvoid: 0.001, chancePrefer: 1 }).key, "insufficient");
  assert.equal(judgeAxis({ exposures: 6, chanceAvoid: 0.01, chancePrefer: 1 }).key, "avoid");
  assert.equal(judgeAxis({ exposures: 8, chanceAvoid: 0.04, chancePrefer: 1 }).key, "avoid_strong");
  assert.equal(judgeAxis({ exposures: 8, chanceAvoid: 0.15, chancePrefer: 1 }).key, "avoid");
  assert.equal(judgeAxis({ exposures: 9, chanceAvoid: 1, chancePrefer: 0.03 }).key, "prefer_strong");
  assert.equal(judgeAxis({ exposures: 9, chanceAvoid: 0.5, chancePrefer: 0.5 }).key, "neutral");
});

test("skipped rounds are handled", () => {
  const rounds = simulate({ nRounds: 12, seed: 6, utility: () => 0 });
  rounds[0].choice = -1;
  rounds[5].choice = -1;
  const model = fitChoiceModel(rounds, AXES);
  assert.ok(Number.isFinite(model.skip));
  assert.equal(leaveOneOut(rounds, AXES).n, 10);
});
