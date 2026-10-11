// 線の上の動きを、まわりの頂点へ広げる（I-068）。
// 頂点ごとに、線の上の各サンプルの動きを「受け持つ長さ ÷ (距離² + 0.01)²」の重みで混ぜる。線の真上では線の動きと
// 一致し、離れるほど広い範囲の平均になる。いちばん近い位置だけを使わないので、曲がった線の内側でも途切れない。
// 重みを距離の4乗で下げるので、線の端の近くの頂点に、線の遠い所の動きはほとんど入らない。
// これに、線からの距離による弱め方（影響幅の 1/4 までは 1、影響幅で 0、その間は滑らかに下げる）を掛ける
import type { Vec2 } from '@app/schema';

export function contourFalloff(distance: number, radius: number): number {
  const plateau = radius / 4;
  if (distance <= plateau) return 1;
  if (distance >= radius) return 0;
  const t = (distance - plateau) / (radius - plateau);
  return 1 - t * t * (3 - 2 * t);
}

function segmentDistance2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy;
  const t = len < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  const x = p.x - (a.x + dx * t),
    y = p.y - (a.y + dy * t);
  return x * x + y * y;
}

// 線（サンプルを結んだ折れ線）までの距離
export function distanceToLine(p: Vec2, samples: readonly Vec2[]): number {
  if (samples.length === 0) return Infinity;
  if (samples.length === 1) return Math.hypot(p.x - samples[0]!.x, p.y - samples[0]!.y);
  let best = Infinity;
  for (let j = 0; j + 1 < samples.length; j++) best = Math.min(best, segmentDistance2(p, samples[j]!, samples[j + 1]!));
  return Math.sqrt(best);
}

// サンプルごとの値（dims 個ずつ並べたもの）を points へ広げる。結果も dims 個ずつ。線から radius 以上の点は 0
export function spreadAlongLine(
  points: readonly Vec2[],
  samples: readonly Vec2[],
  values: ArrayLike<number>,
  dims: 1 | 2,
  radius: number,
): Float64Array {
  const out = new Float64Array(points.length * dims);
  const m = samples.length;
  if (m === 0 || !(radius > 0)) return out;
  // 各サンプルが受け持つ線の長さ（隣との間の半分ずつ）。サンプルの粗密で重みが偏らないようにする
  const share = new Float64Array(m).fill(m === 1 ? 1 : 0);
  for (let j = 0; j + 1 < m; j++) {
    const d = Math.hypot(samples[j + 1]!.x - samples[j]!.x, samples[j + 1]!.y - samples[j]!.y) / 2;
    share[j] = share[j]! + d;
    share[j + 1] = share[j + 1]! + d;
  }
  points.forEach((p, i) => {
    const r = distanceToLine(p, samples);
    if (r >= radius) return;
    const f = contourFalloff(r, radius);
    let sum = 0,
      a = 0,
      b = 0;
    for (let j = 0; j < m; j++) {
      const dx = p.x - samples[j]!.x,
        dy = p.y - samples[j]!.y;
      const q = dx * dx + dy * dy + 0.01;
      const w = (share[j]! + 1e-6) / (q * q);
      sum += w;
      a += w * values[j * dims]!;
      if (dims === 2) b += w * values[j * dims + 1]!;
    }
    out[i * dims] = (f * a) / sum;
    if (dims === 2) out[i * dims + 1] = (f * b) / sum;
  });
  return out;
}

function area(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// 動かした形で三角形が裏返らず、潰れない（面積が元の 2% 以上）か。元からほぼ潰れている三角形は見ない
export function contourShapeValid(
  triangles: readonly (readonly [number, number, number])[],
  before: readonly Vec2[],
  after: readonly Vec2[],
): boolean {
  for (const [i, j, k] of triangles) {
    const a0 = before[i],
      b0 = before[j],
      c0 = before[k],
      a1 = after[i],
      b1 = after[j],
      c1 = after[k];
    if (!a0 || !b0 || !c0 || !a1 || !b1 || !c1) continue;
    if (![a1.x, a1.y, b1.x, b1.y, c1.x, c1.y].every(Number.isFinite)) return false;
    const s0 = area(a0, b0, c0);
    if (Math.abs(s0) < 1e-6) continue;
    const s1 = area(a1, b1, c1);
    if (s0 * s1 <= 0 || Math.abs(s1) < Math.abs(s0) * 0.02) return false;
  }
  return true;
}
