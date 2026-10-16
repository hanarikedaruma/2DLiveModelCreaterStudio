import type { Part, TransformDelta, Vec2 } from './types';

// 2×3 の行列。x' = a·x + c·y + e、y' = b·x + d·y + f
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Readonly<Affine> = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function isIdentity(m: Readonly<Affine>): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

// パーツの変形 p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot)) を行列にする。
// position・rotation は差分を足し、scale は差分を掛けた値を使う。R は y が下向きで正の角度が時計回り
export function partAffine(
  part: Pick<Part, 'position' | 'rotation' | 'scale' | 'pivot'>,
  delta: TransformDelta | undefined,
): Affine {
  const px = part.position.x + (delta ? delta.position.x : 0);
  const py = part.position.y + (delta ? delta.position.y : 0);
  const rotation = part.rotation + (delta ? delta.rotation : 0);
  const sx = part.scale.x * (delta ? delta.scale.x : 1);
  const sy = part.scale.y * (delta ? delta.scale.y : 1);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const { x: vx, y: vy } = part.pivot;
  return { a, b, c, d, e: px + vx - a * vx - c * vy, f: py + vy - b * vx - d * vy };
}

// outer ∘ inner（先に inner、次に outer を掛ける）
export function multiplyAffine(outer: Readonly<Affine>, inner: Readonly<Affine>): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function transformVec(m: Readonly<Affine>, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

// [x0, y0, x1, y1, ...] をその場で動かす
export function applyAffine(points: Float32Array, m: Readonly<Affine>): void {
  const { a, b, c, d, e, f } = m;
  for (let k = 0; k + 1 < points.length; k += 2) {
    const x = points[k]!;
    const y = points[k + 1]!;
    points[k] = a * x + c * y + e;
    points[k + 1] = b * x + d * y + f;
  }
}
