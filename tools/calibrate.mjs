// 用模拟数据检查回避判定（输出规格 1.2）。
// 运行：npm run calibrate            （可选参数：每种情形模拟的人数，默认 1000）
//
// 判断方法：对每个轴算 P(β < -0.5) 和 P(β > 0.5)，再和"完全随机选"时八个轴里最极端的值比较，
// 得到"随机情况下出现至少这么极端结果的概率"：≤5% 说"明显"（且出现 8 次以上），≤20% 说"可能"。
// 这里为了快，随机情况的分布按组数预先模拟一次；网页里是对每个人单独模拟（保留其题位习惯），
// 最后一段用少量样本核对两种做法在"有题位习惯"时是否一致。
//
// 两种做法对比：
//   只选一道：每组只记选了哪道。
//   选一道 + 标最不想答：每组再记一道"最不想答的"（best-worst scaling）。

import { readFileSync } from "node:fs";
import { fitChoiceModel, axisTable, calibrateAxes } from "../src/choice-model.js";
import { planRounds } from "../src/scheduler.js";
import { mulberry32 } from "../src/rng.js";

const AXES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
const packages = JSON.parse(readFileSync(new URL("../content/zh/packages.json", import.meta.url), "utf8"));
const N = Number(process.argv[2] ?? 1000);

function pick(weights, rng) {
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length - 1; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

function simulate(nRounds, seed, utility, withWorst) {
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

const maxStat = (model) => Math.max(...AXES.flatMap((a) => [model.effects[a].pAvoid, model.effects[a].pPrefer]));

function nullMaxima(nRounds, withWorst) {
  const out = [];
  for (let i = 0; i < N; i++) out.push(maxStat(fitChoiceModel(simulate(nRounds, 777 + i * 104729, () => 0, withWorst), AXES)));
  return out;
}

function evaluate(nRounds, withWorst, utility, target, maxima) {
  const chance = (stat) => (1 + maxima.filter((v) => v >= stat).length) / (maxima.length + 1);
  let anyStrong = 0;
  let anyFlag = 0;
  let targetStrong = 0;
  let targetAny = 0;
  for (let i = 0; i < N; i++) {
    const rounds = simulate(nRounds, 31337 + i * 7919, utility, withWorst);
    const model = fitChoiceModel(rounds, AXES);
    const calib = Object.fromEntries(
      AXES.map((a) => [a, { chanceAvoid: chance(model.effects[a].pAvoid), chancePrefer: chance(model.effects[a].pPrefer) }]),
    );
    const table = axisTable(rounds, AXES, model, calib);
    const others = table.filter((r) => r.axis !== target);
    if (others.some((r) => r.judgment.key.endsWith("_strong"))) anyStrong++;
    if (others.some((r) => !["neutral", "insufficient"].includes(r.judgment.key))) anyFlag++;
    if (target) {
      const t = table.find((r) => r.axis === target);
      if (t.judgment.key === "avoid_strong") targetStrong++;
      if (t.judgment.key.startsWith("avoid")) targetAny++;
    }
  }
  const pct = (k) => `${((100 * k) / N).toFixed(0)}%`.padStart(4);
  return { anyStrong: pct(anyStrong), anyFlag: pct(anyFlag), targetStrong: pct(targetStrong), targetAny: pct(targetAny) };
}

const scenarios = [
  { name: "随机选题", utility: () => 0, target: null },
  { name: "回避 A2（效用 -1）", utility: (o) => (o.axis === "A2" ? -1 : 0), target: "A2" },
  { name: "回避 A2（效用 -2）", utility: (o) => (o.axis === "A2" ? -2 : 0), target: "A2" },
];

console.log(`每种情形模拟 ${N} 人。误报只统计目标轴以外的轴。\n`);
for (const withWorst of [false, true]) {
  console.log(withWorst ? "### 选一道 + 标最不想答" : "### 只选一道");
  for (const nRounds of [12, 22, 33, 44]) {
    const maxima = nullMaxima(nRounds, withWorst);
    for (const s of scenarios) {
      const r = evaluate(nRounds, withWorst, s.utility, s.target, maxima);
      const parts = [`${String(nRounds).padStart(2)} 组`, s.name.padEnd(12, "　")];
      if (s.target) parts.push(`判为明显回避 ${r.targetStrong}`, `判为任一回避 ${r.targetAny}`);
      else parts.push(`误报"明显" ${r.anyStrong}`, `误报任一判断 ${r.anyFlag}`);
      console.log(parts.join(" | "));
    }
  }
  console.log("");
}

// 核对：有题位习惯的人，用网页里的逐人校正（保留题位习惯），误报率是否仍在目标附近。
const CHECK = Math.min(150, N);
let strongFP = 0;
let anyFP = 0;
for (let i = 0; i < CHECK; i++) {
  const rounds = simulate(22, 99991 + i * 13, (o) => (o.position === 1 ? 1 : 0), false);
  const model = fitChoiceModel(rounds, AXES);
  const calib = calibrateAxes(rounds, AXES, model, { nSim: 99, rng: mulberry32(i + 1) });
  const table = axisTable(rounds, AXES, model, calib);
  if (table.some((r) => r.judgment.key.endsWith("_strong"))) strongFP++;
  if (table.some((r) => !["neutral", "insufficient"].includes(r.judgment.key))) anyFP++;
}
console.log(
  `逐人校正核对（22 组，爱选第一题，${CHECK} 人）：误报"明显" ${((100 * strongFP) / CHECK).toFixed(0)}%，误报任一判断 ${((100 * anyFP) / CHECK).toFixed(0)}%`,
);
