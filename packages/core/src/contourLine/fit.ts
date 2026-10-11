// 線が目標の動きになるように、線のすぐそばの頂点の動きを直す（I-068）。
// 線から広げた動き（prior）だけでは、線の通る三角形の頂点が線から少しずれている所で、線が目標に届かない。
// そこで、線のサンプルの動き（三角形の頂点の動きの重心座標での和）と目標との差の2乗の和を最小にする直しを求める。
// 直すのは adjustable の頂点（線のすぐそば）だけ。離れた頂点まで直すと、粗いメッシュで動きが波打つため。
// 直しには小さな重み lambda を掛けて、決まらない向きは prior のままにする
import type { MeshAttachment } from './attach';

// 対称正定値の行列 m（n×n、行優先）の連立方程式 m x = b（b は n×dims）を Cholesky 分解で解く。解けなければ null
function solveSpd(m: Float64Array, n: number, b: Float64Array, dims: number): Float64Array | null {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i * n + j]!;
      for (let k = 0; k < j; k++) s -= l[i * n + k]! * l[j * n + k]!;
      if (i === j) {
        if (!(s > 1e-12)) return null;
        l[i * n + i] = Math.sqrt(s);
      } else l[i * n + j] = s / l[j * n + j]!;
    }
  }
  const x = new Float64Array(n * dims);
  for (let d = 0; d < dims; d++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = b[i * dims + d]!;
      for (let k = 0; k < i; k++) s -= l[i * n + k]! * y[k]!;
      y[i] = s / l[i * n + i]!;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i]!;
      for (let k = i + 1; k < n; k++) s -= l[k * n + i]! * x[k * dims + d]!;
      x[i * dims + d] = s / l[i * n + i]!;
    }
  }
  return x;
}

// samples: 線のサンプルのつけ方。target: サンプルごとの目標の動き（dims 個ずつ）。
// prior: 頂点ごとの今の動き（dims 個ずつ）。直した動きを新しい配列で返す（解けなければ prior の写し）
export function fitLineMotion(
  samples: readonly MeshAttachment[],
  target: ArrayLike<number>,
  prior: Float64Array,
  dims: 1 | 2,
  adjustable: (vertex: number) => boolean = () => true,
  lambda = 0.05,
): Float64Array {
  const out = prior.slice();
  const slot = new Map<number, number>();
  for (const a of samples) for (const v of a.indices) if (!slot.has(v) && adjustable(v)) slot.set(v, slot.size);
  const n = slot.size;
  if (n === 0) return out;
  const m = new Float64Array(n * n);
  const b = new Float64Array(n * dims);
  for (let i = 0; i < n; i++) m[i * n + i] = lambda;
  samples.forEach((a, j) => {
    // 今の動きで、このサンプルが目標からどれだけ外れているか
    const rest = new Float64Array(dims);
    for (let d = 0; d < dims; d++) {
      let realized = 0;
      for (let k = 0; k < 3; k++) realized += a.weights[k]! * prior[a.indices[k]! * dims + d]!;
      rest[d] = target[j * dims + d]! - realized;
    }
    for (let p = 0; p < 3; p++) {
      const sp = slot.get(a.indices[p]!);
      if (sp === undefined) continue;
      for (let q = 0; q < 3; q++) {
        const sq = slot.get(a.indices[q]!);
        if (sq === undefined) continue;
        const at = sp * n + sq;
        m[at] = m[at]! + a.weights[p]! * a.weights[q]!;
      }
      for (let d = 0; d < dims; d++) b[sp * dims + d] = b[sp * dims + d]! + a.weights[p]! * rest[d]!;
    }
  });
  const x = solveSpd(m, n, b, dims);
  if (!x || x.some((v) => !Number.isFinite(v))) return out;
  for (const [v, i] of slot) for (let d = 0; d < dims; d++) out[v * dims + d] = out[v * dims + d]! + x[i * dims + d]!;
  return out;
}
