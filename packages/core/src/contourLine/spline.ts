// 輪郭線の曲線（I-068）。点を通る Catmull-Rom 曲線（centripetal）。
// 区間の長さ（ノット）は絵の上の点の配置（layout。素材のピクセル）から決めて固定するので、曲線は
// 「基底の重み × 点」の足し算で表せる。1つの点を動かして変わるのは、その点の両側2区間ずつだけ
import type { Vec2 } from '@app/schema';

export interface ContourBasis {
  count: number; // 点の数
  weights: Float64Array[]; // サンプルごとの点の重み（長さ count）。サンプル = Σ weights[k] × 点[k]
  segments: Int32Array; // サンプルが入る区間（点 s と s+1 の間なら s）
}

const MIN_KNOT = 1e-4;

// 端の外側に仮の点を足した並び（E_0 = 2P_0 − P_1、E_{n+1} = 2P_{n−1} − P_{n−2}）に沿ったノット
export function contourKnots(layout: readonly Vec2[]): Float64Array {
  const n = layout.length;
  const ext = [
    { x: 2 * layout[0]!.x - layout[1]!.x, y: 2 * layout[0]!.y - layout[1]!.y },
    ...layout,
    { x: 2 * layout[n - 1]!.x - layout[n - 2]!.x, y: 2 * layout[n - 1]!.y - layout[n - 2]!.y },
  ];
  const knots = new Float64Array(ext.length);
  for (let i = 1; i < ext.length; i++) {
    const d = Math.hypot(ext[i]!.x - ext[i - 1]!.x, ext[i]!.y - ext[i - 1]!.y);
    knots[i] = knots[i - 1]! + Math.max(MIN_KNOT, Math.sqrt(d));
  }
  return knots;
}

// 区間 seg（点 seg と seg+1 の間）の t での、仮の点を含む4点の重み（Barry–Goldman の段の重みを追う）
function segmentWeights(knots: Float64Array, seg: number, t: number): [number, number, number, number] {
  const t0 = knots[seg]!,
    t1 = knots[seg + 1]!,
    t2 = knots[seg + 2]!,
    t3 = knots[seg + 3]!;
  const a1 = [(t1 - t) / (t1 - t0), (t - t0) / (t1 - t0), 0, 0];
  const a2 = [0, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1), 0];
  const a3 = [0, 0, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2)];
  const lerp = (p: number[], q: number[], u: number, v: number) => p.map((x, i) => x * u + q[i]! * v);
  const b1 = lerp(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
  const b2 = lerp(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
  const c = lerp(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
  return c as [number, number, number, number];
}

// layout の点を通る曲線のサンプルの重み。区間ごとに、layout での長さ ÷ step 個（4 個以上）に分ける
export function contourBasis(layout: readonly Vec2[], step = 2): ContourBasis {
  const n = layout.length;
  if (n < 2) return { count: n, weights: [], segments: new Int32Array(0) };
  const knots = contourKnots(layout);
  const weights: Float64Array[] = [];
  const segments: number[] = [];
  // 仮の点を含む並びの番号 e（0..n+1）の重みを、本物の点の重みへ移す
  const add = (w: Float64Array, e: number, value: number) => {
    if (e === 0) {
      w[0] = w[0]! + 2 * value;
      w[1] = w[1]! - value;
    } else if (e === n + 1) {
      w[n - 1] = w[n - 1]! + 2 * value;
      w[n - 2] = w[n - 2]! - value;
    } else w[e - 1] = w[e - 1]! + value;
  };
  for (let s = 0; s < n - 1; s++) {
    const length = Math.hypot(layout[s + 1]!.x - layout[s]!.x, layout[s + 1]!.y - layout[s]!.y);
    const count = Math.max(4, Math.ceil(length / step));
    const last = s === n - 2;
    for (let i = 0; i < count + (last ? 1 : 0); i++) {
      const t = knots[s + 1]! + ((knots[s + 2]! - knots[s + 1]!) * i) / count;
      const c = segmentWeights(knots, s, t);
      const w = new Float64Array(n);
      for (let k = 0; k < 4; k++) add(w, s + k, c[k]!);
      weights.push(w);
      segments.push(s);
    }
  }
  return { count: n, weights, segments: Int32Array.from(segments) };
}

// サンプルの位置（点の位置の足し算）
export function contourSamples(basis: ContourBasis, points: readonly Vec2[]): Vec2[] {
  return basis.weights.map((w) => {
    let x = 0,
      y = 0;
    for (let k = 0; k < basis.count; k++) {
      x += w[k]! * points[k]!.x;
      y += w[k]! * points[k]!.y;
    }
    return { x, y };
  });
}
