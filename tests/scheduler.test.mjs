import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planRounds } from "../src/scheduler.js";
import { mulberry32 } from "../src/rng.js";

const AXES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
const packages = JSON.parse(readFileSync(new URL("../content/zh/packages.json", import.meta.url), "utf8"));

const countAxes = (rounds, base = {}) => {
  const c = Object.fromEntries(AXES.map((a) => [a, base[a] ?? 0]));
  for (const r of rounds) for (const s of r.slots) c[s.axis]++;
  return c;
};

test("each round has three different axes and a shuffled 1-2-3 of positions", () => {
  const rounds = planRounds({ axes: AXES, nRounds: 12, rng: mulberry32(7), packages });
  assert.equal(rounds.length, 12);
  for (const r of rounds) {
    assert.equal(new Set(r.slots.map((s) => s.axis)).size, 3);
    assert.deepEqual(r.slots.map((s) => s.position).sort(), [1, 2, 3]);
  }
});

test("exposures stay balanced within one and across sessions", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const first = planRounds({ axes: AXES, nRounds: 12, rng: mulberry32(seed), packages });
    const c1 = Object.values(countAxes(first));
    assert.ok(Math.max(...c1) - Math.min(...c1) <= 1, `session 1 seed ${seed}: ${c1}`);
    const history = first.flatMap((r) => r.slots.map((s) => ({ axis: s.axis, carrier: s.pkg.carrier })));
    const second = planRounds({ axes: AXES, nRounds: 10, rng: mulberry32(seed + 100), packages, history });
    const total = Object.values(countAxes([...first, ...second]));
    assert.ok(Math.max(...total) - Math.min(...total) <= 1, `two sessions seed ${seed}: ${total}`);
    assert.ok(Math.min(...total) >= 8, `22 rounds should give every axis 8+ exposures: ${total}`);
  }
});

test("the same axis does not reuse its previous carrier when it can avoid it", () => {
  const rounds = planRounds({ axes: AXES, nRounds: 22, rng: mulberry32(11), packages });
  const last = {};
  let repeats = 0;
  for (const r of rounds)
    for (const s of r.slots) {
      if (last[s.axis] === s.pkg.carrier) repeats++;
      last[s.axis] = s.pkg.carrier;
    }
  assert.equal(repeats, 0);
});

test("light carriers never get heavy stakes", () => {
  const rounds = planRounds({ axes: AXES, nRounds: 60, rng: mulberry32(13), packages });
  for (const r of rounds)
    for (const s of r.slots)
      if (packages.lightCarriers.includes(s.pkg.carrier)) assert.notEqual(s.pkg.stakes, packages.stakes.items[2]);
});

test("same seed gives the same plan", () => {
  const a = planRounds({ axes: AXES, nRounds: 12, rng: mulberry32(42), packages });
  const b = planRounds({ axes: AXES, nRounds: 12, rng: mulberry32(42), packages });
  assert.deepEqual(a, b);
});
