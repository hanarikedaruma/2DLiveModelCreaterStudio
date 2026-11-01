import type { AngleRange, ArmLimits, ArmPose, Vec2 } from '@app/schema';

const EPS = 1e-8;
const finitePose = (p: ArmPose) => [p.shoulder, p.elbow, p.wrist].every((n) => Number.isFinite(n) && Math.abs(n) < 1e9);
export const clampArmNumber = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

// 手首に解がある前腕角度へ絞る。これで肩・肘の許可領域は凸多角形になる。
export function armFeasibleRanges(l: ArmLimits, sign: 1 | -1): { shoulder: AngleRange; forearm: AngleRange } {
  if (
    (sign !== 1 && sign !== -1) ||
    Object.values(l).some(
      (r) => !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min > r.max || r.max - r.min >= 360,
    ) ||
    l.elbow.min < 0 ||
    l.elbow.max >= 180
  )
    throw new RangeError('腕の角度区間が不正');
  const forearm = {
    min: Math.max(l.forearm.min, l.hand.min - l.wrist.max),
    max: Math.min(l.forearm.max, l.hand.max - l.wrist.min),
  };
  const a = sign * l.elbow.min,
    b = sign * l.elbow.max;
  const shoulder = {
    min: Math.max(l.shoulder.min, forearm.min - Math.max(a, b)),
    max: Math.min(l.shoulder.max, forearm.max - Math.min(a, b)),
  };
  if (forearm.min > forearm.max || shoulder.min > shoulder.max) throw new RangeError('腕の許可姿勢が空');
  return { shoulder, forearm };
}

export function armPoseInLimits(p: ArmPose, l: ArmLimits, sign: 1 | -1): boolean {
  if (!finitePose(p)) return false;
  const v = { ...p, forearm: p.shoulder + sign * p.elbow, hand: p.shoulder + sign * p.elbow + p.wrist };
  return (Object.keys(v) as (keyof ArmLimits)[]).every((k) => v[k] >= l[k].min - EPS && v[k] <= l[k].max + EPS);
}

// 3変数の凸多面体へ最短距離で投影する。各面・辺・頂点の候補を列挙し、解のない制約は例外。
// 時刻・前フレーム・モデルの変形結果を参照しない。
export function constrainArmPose(input: ArmPose, l: ArmLimits, sign: 1 | -1, fallback: ArmPose): ArmPose {
  const ranges = armFeasibleRanges(l, sign);
  const source = finitePose(input) ? input : finitePose(fallback) ? fallback : { shoulder: 0, elbow: 0, wrist: 0 };
  if (armPoseInLimits(source, l, sign)) return { ...source };
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, sign, 0],
    [1, sign, 1],
  ];
  const limits = [l.shoulder, l.elbow, l.wrist, l.forearm, l.hand];
  const planes = axes.flatMap((a, i) => [
    { a, b: limits[i]!.max },
    { a: a.map((n) => -n), b: -limits[i]!.min },
  ]);
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
  const x = [source.shoulder, source.elbow, source.wrist];
  let best: number[] | null = null,
    cost = Infinity;
  const consider = (indexes: number[]) => {
    const ps = indexes.map((i) => planes[i]!);
    const m = ps.map((p) => [...ps.map((q) => dot(p.a, q.a)), dot(p.a, x) - p.b]);
    // 小さい連立方程式。平行・従属の面は飛ばす。
    for (let i = 0; i < m.length; i++) {
      let pivot = i;
      for (let j = i + 1; j < m.length; j++) if (Math.abs(m[j]![i]!) > Math.abs(m[pivot]![i]!)) pivot = j;
      if (Math.abs(m[pivot]![i]!) < 1e-10) return;
      [m[i], m[pivot]] = [m[pivot]!, m[i]!];
      const d = m[i]![i]!;
      for (let k = i; k <= m.length; k++) m[i]![k] = m[i]![k]! / d;
      for (let j = 0; j < m.length; j++)
        if (j !== i) {
          const f = m[j]![i]!;
          for (let k = i; k <= m.length; k++) m[j]![k] = m[j]![k]! - f * m[i]![k]!;
        }
    }
    const y = x.map((v, j) => v - ps.reduce((sum, p, i) => sum + p.a[j]! * m[i]![m.length]!, 0));
    if (planes.some((p) => dot(p.a, y) > p.b + EPS)) return;
    const c = y.reduce((sum, v, i) => sum + (v - x[i]!) ** 2, 0);
    if (c < cost) {
      cost = c;
      best = y;
    }
  };
  for (let i = 0; i < planes.length; i++) {
    consider([i]);
    for (let j = i + 1; j < planes.length; j++) {
      consider([i, j]);
      for (let k = j + 1; k < planes.length; k++) consider([i, j, k]);
    }
  }
  if (best === null) throw new RangeError('腕の許可姿勢を求められない');
  // 連立方程式の丸め誤差だけを境界へ戻す。許可領域を変えない。
  const shoulder = clampArmNumber(best[0]!, ranges.shoulder.min, ranges.shoulder.max);
  const emin = Math.max(l.elbow.min, sign === 1 ? ranges.forearm.min - shoulder : shoulder - ranges.forearm.max);
  const emax = Math.min(l.elbow.max, sign === 1 ? ranges.forearm.max - shoulder : shoulder - ranges.forearm.min);
  const elbow = clampArmNumber(best[1]!, emin, emax);
  const f = shoulder + sign * elbow;
  const wrist = clampArmNumber(best[2]!, Math.max(l.wrist.min, l.hand.min - f), Math.min(l.wrist.max, l.hand.max - f));
  return { shoulder, elbow, wrist };
}

// x=肩角度、y=肘曲げ量。IKの探索用。角度の単独クランプで境界候補を失わない。
export function armFeasiblePolygon(l: ArmLimits, sign: 1 | -1): Vec2[] {
  const { shoulder: s, forearm: f } = armFeasibleRanges(l, sign);
  let polygon: Vec2[] = [
    { x: s.min, y: l.elbow.min },
    { x: s.max, y: l.elbow.min },
    { x: s.max, y: l.elbow.max },
    { x: s.min, y: l.elbow.max },
  ];
  for (const [a, b, c] of [
    [1, sign, f.max],
    [-1, -sign, -f.min],
  ]) {
    const out: Vec2[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!,
        q = polygon[(i + 1) % polygon.length]!;
      const dp = a! * p.x + b! * p.y - c!,
        dq = a! * q.x + b! * q.y - c!;
      if (dp <= EPS) out.push(p);
      if (dp <= 0 !== dq <= 0) {
        const t = dp / (dp - dq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    polygon = out;
  }
  if (!polygon.length) throw new RangeError('腕の許可姿勢が空');
  return polygon;
}
