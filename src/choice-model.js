// 选择模型：估计每个轴"被选的倾向"，同时扣掉题位的影响（输出规格 1.2）。
//
// 每组的选项是三道题加一个"都不选"：
//   P(选第 i 题) = exp(β[轴i] + γ[题位i]) / ( exp(β0) + Σj exp(β[轴j] + γ[题位j]) )
// β 各轴之和为 0（只估计 K-1 个自由参数），γ[第一题] = 0，β0 是整组都不选的倾向。
// 如果某组还记了"最不想答的一道"（worst），再加一次从剩下两道里选最差的观测：
//   P(最不想答 = k) ∝ exp(-β[轴k] + ω[题位k])，ω 是单独的题位习惯。
// 先验都是均值 0 的正态分布；用牛顿法求后验众数，再用拉普拉斯近似得到后验分布。
//
// 判断不直接用后验概率的固定门槛：八个轴、正反两个方向一起看，偶然出现的偏差很常见。
// calibrateAxes 用"完全随机选、但保留这个人的题位习惯"的模拟，算出每个结果在随机情况下
// 出现的概率（对八个轴一起校正），再按这个概率下判断。

import { dot, invert, matVec, normalCdf, quad } from "./stats.js";

export const MODEL_DEFAULTS = {
  delta: 0.5, // 后验概率 P(β < -0.5)、P(β > 0.5) 用作每个轴的统计量
  priorSdAxis: 1,
  priorSdPosition: 1,
  priorSdSkip: 1.5,
};

export const THRESHOLDS = {
  minExposure: 4, // 少于这个次数不谈
  strongExposure: 8, // 达到这个次数才可能说"明显"
  strong: 0.05, // 随机情况下出现概率不超过 5%：明显
  weak: 0.2, // 不超过 20%：可能
};

function makeDesign(axes) {
  const nB = axes.length - 1;
  const idx = { g2: nB, g3: nB + 1, s: nB + 2, w2: nB + 3, w3: nB + 4 };
  const P = nB + 5;
  const axisVec = (axis) => {
    const x = new Float64Array(P);
    const a = axes.indexOf(axis);
    if (a < 0) throw new Error(`unknown axis: ${axis}`);
    if (a < nB) x[a] = 1;
    else for (let j = 0; j < nB; j++) x[j] = -1;
    return x;
  };
  const optionVec = (opt) => {
    const x = axisVec(opt.axis);
    if (opt.position === 2) x[idx.g2] = 1;
    else if (opt.position === 3) x[idx.g3] = 1;
    return x;
  };
  const worstVec = (opt) => {
    const x = axisVec(opt.axis).map((v) => -v);
    if (opt.position === 2) x[idx.w2] = 1;
    else if (opt.position === 3) x[idx.w3] = 1;
    return x;
  };
  const skipVec = new Float64Array(P);
  skipVec[idx.s] = 1;
  return { axes, nB, P, idx, axisVec, optionVec, worstVec, skipVec };
}

// 每组变成一到两个"选择集"：{xs: 各选项的向量, y: 被选的下标}。
function prepare(rounds, d) {
  const sets = [];
  for (const r of rounds) {
    sets.push({ xs: [...r.options.map(d.optionVec), d.skipVec], y: r.choice >= 0 ? r.choice : r.options.length });
    if (r.choice >= 0 && Number.isInteger(r.worst) && r.worst >= 0 && r.worst !== r.choice) {
      const rest = r.options.map((o, i) => i).filter((i) => i !== r.choice);
      sets.push({ xs: rest.map((i) => d.worstVec(r.options[i])), y: rest.indexOf(r.worst) });
    }
  }
  return sets;
}

function softmax(u) {
  const m = Math.max(...u);
  const e = u.map((v) => Math.exp(v - m));
  const z = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / z);
}

function logPosterior(theta, sets, prec) {
  let lp = 0;
  for (let i = 0; i < theta.length; i++) lp -= 0.5 * prec[i] * theta[i] * theta[i];
  for (const r of sets) {
    const u = r.xs.map((x) => dot(x, theta));
    const m = Math.max(...u);
    const lse = m + Math.log(u.reduce((s, v) => s + Math.exp(v - m), 0));
    lp += u[r.y] - lse;
  }
  return lp;
}

function gradHess(theta, sets, prec) {
  const P = theta.length;
  const g = new Float64Array(P);
  const H = Array.from({ length: P }, () => new Float64Array(P));
  for (let i = 0; i < P; i++) {
    g[i] = -prec[i] * theta[i];
    H[i][i] = -prec[i];
  }
  for (const r of sets) {
    const p = softmax(r.xs.map((x) => dot(x, theta)));
    const xbar = new Float64Array(P);
    r.xs.forEach((x, k) => {
      for (let i = 0; i < P; i++) xbar[i] += p[k] * x[i];
    });
    const xy = r.xs[r.y];
    for (let i = 0; i < P; i++) g[i] += xy[i] - xbar[i];
    r.xs.forEach((x, k) => {
      for (let i = 0; i < P; i++) {
        const di = x[i] - xbar[i];
        if (di === 0) continue;
        for (let j = 0; j < P; j++) H[i][j] -= p[k] * di * (x[j] - xbar[j]);
      }
    });
  }
  return { g, H };
}

const negate = (H) => H.map((row) => Array.from(row, (v) => -v));

/**
 * @param {{options: {axis: string, position: number}[], choice: number, worst?: number}[]} rounds
 *   choice 是被选题在 options 里的下标，整组都不选记 -1；worst 是"最不想答"的下标（可选）。
 * @param {string[]} axes
 */
export function fitChoiceModel(rounds, axes, opts = {}) {
  const o = { ...MODEL_DEFAULTS, ...opts };
  const d = makeDesign(axes);
  const prec = Array.from({ length: d.P }, (_, i) => {
    if (i < d.nB) return 1 / o.priorSdAxis ** 2;
    if (i === d.idx.s) return 1 / o.priorSdSkip ** 2;
    return 1 / o.priorSdPosition ** 2;
  });
  const sets = prepare(rounds, d);

  let theta = new Float64Array(d.P);
  let lp = logPosterior(theta, sets, prec);
  for (let iter = 0; iter < 60; iter++) {
    const { g, H } = gradHess(theta, sets, prec);
    const step = matVec(invert(negate(H)), g);
    let t = 1;
    let next = theta;
    let nextLp = lp;
    for (let k = 0; k < 40; k++) {
      next = Float64Array.from(theta, (v, i) => v + t * step[i]);
      nextLp = logPosterior(next, sets, prec);
      if (nextLp >= lp - 1e-12) break;
      t /= 2;
    }
    const change = Math.max(...step.map(Math.abs)) * t;
    theta = next;
    lp = nextLp;
    if (change < 1e-9) break;
  }

  const cov = invert(negate(gradHess(theta, sets, prec).H));
  const thetaArr = Array.from(theta);
  const effects = {};
  for (const axis of axes) {
    const c = d.axisVec(axis);
    const mean = dot(c, thetaArr);
    const sd = Math.sqrt(Math.max(quad(cov, c), 1e-12));
    effects[axis] = {
      mean,
      sd,
      pAvoid: normalCdf((-o.delta - mean) / sd),
      pPrefer: 1 - normalCdf((o.delta - mean) / sd),
    };
  }
  return {
    theta: thetaArr,
    cov,
    effects,
    position: { 1: 0, 2: thetaArr[d.idx.g2], 3: thetaArr[d.idx.g3] },
    skip: thetaArr[d.idx.s],
    design: d,
    opts: o,
  };
}

// 每个选项（最后一个是"都不选"）的预测概率。
export function choiceProbabilities(model, options) {
  const d = model.design;
  return softmax([...options.map(d.optionVec), d.skipVec].map((x) => dot(x, model.theta)));
}

function worstProbabilities(model, options) {
  return softmax(options.map((o) => dot(model.design.worstVec(o), model.theta)));
}

function sample(probs, rng) {
  let x = rng();
  for (let i = 0; i < probs.length - 1; i++) {
    x -= probs[i];
    if (x < 0) return i;
  }
  return probs.length - 1;
}

/**
 * 校正：在"所有轴一样、只保留题位习惯和跳过倾向"的随机情况下，用同样的题和题位
 * 模拟 nSim 次，记录每次八个轴里最极端的统计量。某个轴的观察结果至少一样极端的模拟比例，
 * 就是它在随机情况下出现的概率（已经对八个轴、两个方向一起校正）。
 */
export function calibrateAxes(rounds, axes, model, { nSim = 300, rng = Math.random } = {}) {
  const d = model.design;
  const nullTheta = model.theta.map((v, i) => (i < d.nB ? 0 : v));
  const nullModel = { ...model, theta: nullTheta };
  const maxima = [];
  for (let s = 0; s < nSim; s++) {
    const simRounds = rounds.map((r) => {
      const p = choiceProbabilities(nullModel, r.options);
      const k = sample(p, rng);
      const choice = k === r.options.length ? -1 : k;
      const out = { options: r.options, choice };
      if (Number.isInteger(r.worst) && r.worst >= 0 && choice >= 0) {
        const rest = r.options.map((o, i) => i).filter((i) => i !== choice);
        out.worst = rest[sample(worstProbabilities(nullModel, rest.map((i) => r.options[i])), rng)];
      }
      return out;
    });
    const m = fitChoiceModel(simRounds, axes, model.opts);
    let max = 0;
    for (const a of axes) max = Math.max(max, m.effects[a].pAvoid, m.effects[a].pPrefer);
    maxima.push(max);
  }
  const chance = (stat) => (1 + maxima.filter((v) => v >= stat).length) / (nSim + 1);
  return Object.fromEntries(
    axes.map((a) => [a, { chanceAvoid: chance(model.effects[a].pAvoid), chancePrefer: chance(model.effects[a].pPrefer) }]),
  );
}

/** 把曝光次数和"随机情况下出现的概率"换成判断（键名对应界面文案 report.judgment.*）。 */
export function judgeAxis({ exposures, chanceAvoid, chancePrefer }, th = THRESHOLDS) {
  if (exposures < th.minExposure) return { key: "insufficient" };
  const strongOk = exposures >= th.strongExposure;
  if (strongOk && chanceAvoid <= th.strong) return { key: "avoid_strong", confidence: "高" };
  if (strongOk && chancePrefer <= th.strong) return { key: "prefer_strong", confidence: "高" };
  if (chanceAvoid <= th.weak) return { key: "avoid", confidence: "中" };
  if (chancePrefer <= th.weak) return { key: "prefer", confidence: "中" };
  return { key: "neutral" };
}

/** 每个轴的出现次数、被选次数、"最不想答"次数。 */
export function axisCounts(rounds, axes) {
  return Object.fromEntries(
    axes.map((axis) => {
      let exposures = 0;
      let chosen = 0;
      let expected = 0;
      let worst = 0;
      for (const r of rounds) {
        const k = r.options.findIndex((o) => o.axis === axis);
        if (k < 0) continue;
        exposures++;
        if (r.choice === k) chosen++;
        if (r.choice >= 0) expected += 1 / r.options.length;
        if (r.worst === k) worst++;
      }
      return [axis, { axis, exposures, chosen, expected, worst }];
    }),
  );
}

/** 汇总成报告用的表：计数 + 模型估计 + 校正后的判断。 */
export function axisTable(rounds, axes, model, calibration, th = THRESHOLDS) {
  const counts = axisCounts(rounds, axes);
  return axes.map((axis) => {
    const row = { ...counts[axis], ...model.effects[axis], ...calibration[axis] };
    return { ...row, judgment: judgeAxis(row, th) };
  });
}

/**
 * 留一法：每次拿掉一组，用其余各组估计，再预测被拿掉的那一组选哪道。
 * 题位基线：只按其余各组里最常选的题位来猜。整组跳过的不计分。
 */
export function leaveOneOut(rounds, axes, opts = {}) {
  let n = 0;
  let hits = 0;
  let posHits = 0;
  rounds.forEach((r, i) => {
    if (r.choice < 0) return;
    const train = rounds.filter((_, j) => j !== i);
    const model = fitChoiceModel(train, axes, opts);
    const probs = choiceProbabilities(model, r.options).slice(0, r.options.length);
    const predicted = probs.indexOf(Math.max(...probs));
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const t of train) if (t.choice >= 0) counts[t.options[t.choice].position]++;
    const favorite = [1, 2, 3].reduce((a, b) => (counts[b] > counts[a] ? b : a), 1);
    const posPredicted = r.options.findIndex((o) => o.position === favorite);
    n++;
    if (predicted === r.choice) hits++;
    if (posPredicted === r.choice) posHits++;
  });
  return { n, hits, posHits };
}
