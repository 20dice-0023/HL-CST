// 调度：决定每组出哪三个轴、各在第几题、用什么情境包装（轴表第 5 节）。
// 规则：三个轴互不相同；题位随机；各轴累计出现次数之差不超过 1；
// 同一个轴尽量不连续用同一种情境；同一组的三道题尽量不同情境。

import { shuffle, weightedPick } from "./rng.js";

function combinations(items, k) {
  const out = [];
  const rec = (start, picked) => {
    if (picked.length === k) {
      out.push(picked.slice());
      return;
    }
    for (let i = start; i < items.length; i++) {
      picked.push(items[i]);
      rec(i + 1, picked);
      picked.pop();
    }
  };
  rec(0, []);
  return out;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * @param {object} p
 * @param {string[]} p.axes
 * @param {number} p.nRounds
 * @param {() => number} p.rng
 * @param {object} p.packages  content/zh/packages.json
 * @param {{axis: string, carrier?: string}[]} [p.history]  之前几轮里出现过的题，用来接着平衡
 */
export function planRounds({ axes, nRounds, rng, packages, history = [] }) {
  const counts = Object.fromEntries(axes.map((a) => [a, 0]));
  const pairCounts = {};
  const carrierUse = Object.fromEntries(axes.map((a) => [a, {}]));
  const lastCarrier = {};
  for (const h of history) {
    if (!(h.axis in counts)) continue;
    counts[h.axis]++;
    if (h.carrier) {
      carrierUse[h.axis][h.carrier] = (carrierUse[h.axis][h.carrier] ?? 0) + 1;
      lastCarrier[h.axis] = h.carrier;
    }
  }

  const triplets = combinations(axes, 3);
  const carriers = packages.carriers;
  const rounds = [];
  let previous = [];

  for (let r = 0; r < nRounds; r++) {
    // 出现次数少的轴优先（权重压倒一切，保证平衡）；其次让轴两两同场的次数均匀；
    // 再其次避免和上一组重复；最后随机打破平局。
    let best = null;
    let bestScore = Infinity;
    for (const t of triplets) {
      const score =
        t.reduce((s, a) => s + counts[a], 0) * 1000 +
        (pairCounts[pairKey(t[0], t[1])] ?? 0) +
        (pairCounts[pairKey(t[0], t[2])] ?? 0) +
        (pairCounts[pairKey(t[1], t[2])] ?? 0) +
        t.filter((a) => previous.includes(a)).length * 3 +
        rng();
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }

    const usedThisRound = new Set();
    const slots = shuffle(best, rng).map((axis, i) => {
      const carrier = pickCarrier(axis);
      usedThisRound.add(carrier);
      return { slot: i + 1, axis, position: i + 1, pkg: makePackage(carrier) };
    });

    for (const s of slots) {
      counts[s.axis]++;
      carrierUse[s.axis][s.pkg.carrier] = (carrierUse[s.axis][s.pkg.carrier] ?? 0) + 1;
      lastCarrier[s.axis] = s.pkg.carrier;
    }
    pairCounts[pairKey(best[0], best[1])] = (pairCounts[pairKey(best[0], best[1])] ?? 0) + 1;
    pairCounts[pairKey(best[0], best[2])] = (pairCounts[pairKey(best[0], best[2])] ?? 0) + 1;
    pairCounts[pairKey(best[1], best[2])] = (pairCounts[pairKey(best[1], best[2])] ?? 0) + 1;
    previous = best;
    rounds.push({ index: r + 1, slots });

    function pickCarrier(axis) {
      const tiers = [
        (c) => !usedThisRound.has(c) && c !== lastCarrier[axis],
        (c) => c !== lastCarrier[axis],
        () => true,
      ];
      for (const ok of tiers) {
        const pool = carriers.filter(ok);
        if (pool.length === 0) continue;
        const minUse = Math.min(...pool.map((c) => carrierUse[axis][c] ?? 0));
        const least = pool.filter((c) => (carrierUse[axis][c] ?? 0) === minUse);
        return least[Math.floor(rng() * least.length)];
      }
      return carriers[0];
    }
  }

  function makePackage(carrier) {
    const role = weightedPick(packages.roles.items, packages.roles.weights, rng);
    let stakes = weightedPick(packages.stakes.items, packages.stakes.weights, rng);
    if (packages.lightCarriers.includes(carrier) && stakes === packages.stakes.items[2]) stakes = packages.stakes.items[1];
    const abstraction =
      carrier === packages.abstraction.professionalCarrier && rng() < packages.abstraction.professionalRate
        ? packages.abstraction.items[1]
        : packages.abstraction.items[0];
    return { carrier, role, stakes, abstraction };
  }

  return rounds;
}
