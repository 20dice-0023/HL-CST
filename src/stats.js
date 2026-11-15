// 选择模型用到的少量数值工具。

// 标准正态分布的累积分布函数（Abramowitz & Stegun 26.2.17，误差小于 7.5e-8）。
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function matVec(m, v) {
  return m.map((row) => dot(row, v));
}

// cᵀ M c
export function quad(m, c) {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === 0) continue;
    for (let j = 0; j < c.length; j++) s += c[i] * m[i][j] * c[j];
  }
  return s;
}

// 高斯-约旦消元求逆，带部分主元。矩阵很小（十来维），够用。
export function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error("matrix is singular");
    [a[c], a[p]] = [a[p], a[c]];
    const piv = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row) => row.slice(n));
}
