// キャンバス編集の計算（行列・当たり判定・ハンドル・回転・拡縮・ピボット）。すべて純粋関数
import type { Vec2 } from '@app/schema';
import type { DeformedModel, DrawItem, TransformChange } from '@app/contracts';

// ---- 2次元のアフィン変換 ----

// x' = a·x + c·y + e、y' = b·x + d·y + f
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const EPS = 1e-9;

export function add(p: Vec2, q: Vec2): Vec2 {
  return { x: p.x + q.x, y: p.y + q.y };
}
export function sub(p: Vec2, q: Vec2): Vec2 {
  return { x: p.x - q.x, y: p.y - q.y };
}
export function dot(p: Vec2, q: Vec2): number {
  return p.x * q.x + p.y * q.y;
}
export function cross(p: Vec2, q: Vec2): number {
  return p.x * q.y - p.y * q.x;
}
export function length(p: Vec2): number {
  return Math.hypot(p.x, p.y);
}
export function distance(p: Vec2, q: Vec2): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// m ∘ n（n を先に掛ける）
export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function applyAffine(m: Affine, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

// 平行移動を除いた部分だけを掛ける（移動量の変換に使う）
export function applyLinear(m: Affine, v: Vec2): Vec2 {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}

export function determinant(m: Affine): number {
  return m.a * m.d - m.b * m.c;
}

// 逆にできない（拡縮が 0 など）なら null
export function invert(m: Affine): Affine | null {
  const det = determinant(m);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export function translation(v: Vec2): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: v.x, f: v.y };
}

// 度。y が下向きの座標で、正の角度は時計回り
export function rotation(degrees: number): Affine {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function scaling(s: Vec2): Affine {
  return { a: s.x, b: 0, c: 0, d: s.y, e: 0, f: 0 };
}

export function linearOnly(m: Affine): Affine {
  return { ...m, e: 0, f: 0 };
}

// ---- パーツの変形 ----

export interface Pose {
  position: Vec2;
  rotation: number;
  scale: Vec2;
  pivot: Vec2;
}

// p' = position + pivot + R(rotation)·(scale ⊙ (p − pivot))
export function poseMatrix(pose: Pose): Affine {
  return multiply(
    translation(add(pose.position, pose.pivot)),
    multiply(
      rotation(pose.rotation),
      multiply(scaling(pose.scale), translation({ x: -pose.pivot.x, y: -pose.pivot.y })),
    ),
  );
}

// 選択枠の座標系: 原点がピボット、軸はパーツの回転に沿う（拡縮は含めない）
export function boxFrame(parent: Affine, pose: Pose): Affine {
  return multiply(parent, multiply(translation(add(pose.position, pose.pivot)), rotation(pose.rotation)));
}

// ---- 当たり判定 ----

// 辺の上も内側とする。面積が 0 の三角形は当たらない
export function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const area = cross(sub(b, a), sub(c, a));
  if (Math.abs(area) < EPS) return false;
  const d1 = cross(sub(b, a), sub(p, a));
  const d2 = cross(sub(c, b), sub(p, b));
  const d3 = cross(sub(a, c), sub(p, c));
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export function itemVertex(item: DrawItem, i: number): Vec2 {
  return { x: item.positions[i * 2] ?? 0, y: item.positions[i * 2 + 1] ?? 0 };
}

export function itemPoints(item: DrawItem): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < item.positions.length; i += 2) out.push({ x: item.positions[i]!, y: item.positions[i + 1]! });
  return out;
}

export function itemContains(item: DrawItem, p: Vec2): boolean {
  for (let t = 0; t + 2 < item.indices.length; t += 3) {
    const a = itemVertex(item, item.indices[t]!);
    const b = itemVertex(item, item.indices[t + 1]!);
    const c = itemVertex(item, item.indices[t + 2]!);
    if (pointInTriangle(p, a, b, c)) return true;
  }
  return false;
}

// 手前から見て最初に当たる DrawItem のパーツ。selectable が false のものは素通りする
export function hitTestItems(
  model: DeformedModel,
  p: Vec2,
  selectable: (partId: string) => boolean = () => true,
): string | null {
  for (let i = model.items.length - 1; i >= 0; i--) {
    const item = model.items[i]!;
    if (!selectable(item.partId)) continue;
    if (itemContains(item, p)) return item.partId;
  }
  return null;
}

// ---- 選択枠とハンドル ----

export interface SelectionBox {
  frame: Affine; // 枠の座標 → キャンバス座標
  min: Vec2;
  max: Vec2; // 枠の座標での範囲
}

export function selectionBox(frame: Affine, points: Vec2[]): SelectionBox | null {
  const inv = invert(frame);
  if (!inv || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const q = applyAffine(inv, p);
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  return { frame, min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function boxContains(box: SelectionBox, p: Vec2): boolean {
  const inv = invert(box.frame);
  if (!inv) return false;
  const q = applyAffine(inv, p);
  return q.x >= box.min.x - EPS && q.x <= box.max.x + EPS && q.y >= box.min.y - EPS && q.y <= box.max.y + EPS;
}

export type ScaleHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const SCALE_HANDLES: ScaleHandle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];

// 枠の座標でのハンドルの位置
export function handlePoint(box: SelectionBox, h: ScaleHandle): Vec2 {
  const midX = (box.min.x + box.max.x) / 2;
  const midY = (box.min.y + box.max.y) / 2;
  const x = h.includes('w') ? box.min.x : h.includes('e') ? box.max.x : midX;
  const y = h.includes('n') ? box.min.y : h.includes('s') ? box.max.y : midY;
  return { x, y };
}

// 枠の四隅（キャンバス座標。左上から時計回り）
export function boxCorners(box: SelectionBox): Vec2[] {
  return (['nw', 'ne', 'se', 'sw'] as const).map((h) => applyAffine(box.frame, handlePoint(box, h)));
}

// 回転ハンドル: 上の辺の中央から、枠の上向きに distance（キャンバス座標の長さ）だけ離れた点
export function rotateHandlePoint(box: SelectionBox, distance: number): Vec2 {
  const top = applyAffine(box.frame, handlePoint(box, 'n'));
  const down = applyLinear(box.frame, { x: 0, y: 1 });
  const len = length(down);
  const up = len < EPS ? { x: 0, y: -1 } : { x: -down.x / len, y: -down.y / len };
  return { x: top.x + up.x * distance, y: top.y + up.y * distance };
}

// ---- ドラッグの量 ----

export const MIN_SCALE_FACTOR = 0.01;

// 拡縮ハンドルのドラッグの倍率。枠の座標（ピボットが原点）で、つかんだ点の座標の比にする。keepAspect で縦横比を固定する
export function scaleFactorFor(handle: ScaleHandle, start: Vec2, current: Vec2, keepAspect: boolean): Vec2 {
  const ax = handle.includes('e') || handle.includes('w');
  const ay = handle.includes('n') || handle.includes('s');
  const ratio = (c: number, s: number) => (Math.abs(s) < EPS ? 1 : Math.max(MIN_SCALE_FACTOR, c / s));
  let fx = ax ? ratio(current.x, start.x) : 1;
  let fy = ay ? ratio(current.y, start.y) : 1;
  if (keepAspect) {
    if (ax && ay) {
      const ss = dot(start, start);
      const f = ss < EPS ? 1 : Math.max(MIN_SCALE_FACTOR, dot(current, start) / ss);
      fx = f;
      fy = f;
    } else if (ax) fy = fx;
    else fx = fy;
  }
  return { x: fx, y: fy };
}

// center のまわりで from から to へ回した角度（度。時計回りが正）
export function angleBetween(center: Vec2, from: Vec2, to: Vec2): number {
  const a = sub(from, center);
  const b = sub(to, center);
  if (length(a) < EPS || length(b) < EPS) return 0;
  return (Math.atan2(cross(a, b), dot(a, b)) * 180) / Math.PI;
}

export function snapAngle(degrees: number, step = 15): number {
  return Math.round(degrees / step) * step;
}

// キャンバス上の移動量 d を、親の座標での position の差分にする
export function moveDelta(parent: Affine, d: Vec2): Vec2 {
  const inv = invert(linearOnly(parent));
  return inv ? applyLinear(inv, d) : d;
}

// ピボットをキャンバス上で d だけ動かす変更。見た目が動かないように position も直す
// （pivot が δ 動くと点は (I − R·S)·δ ずれるので、position に (R·S − I)·δ を足す）
export function pivotChange(parent: Affine, pose: Pose, d: Vec2): TransformChange | null {
  const lin = multiply(linearOnly(parent), multiply(rotation(pose.rotation), scaling(pose.scale)));
  const inv = invert(lin);
  if (!inv) return null;
  const dPivot = applyLinear(inv, d);
  const dPosition = sub(moveDelta(parent, d), dPivot);
  return { dPivot, dPosition };
}

// 何も変えない変更か
export function isIdentityChange(c: TransformChange): boolean {
  const zero = (v?: Vec2) => !v || (Math.abs(v.x) < EPS && Math.abs(v.y) < EPS);
  const one = (v?: Vec2) => !v || (Math.abs(v.x - 1) < EPS && Math.abs(v.y - 1) < EPS);
  return (
    zero(c.dPosition) &&
    zero(c.dPivot) &&
    one(c.scaleFactor) &&
    Math.abs(c.dRotation ?? 0) < EPS &&
    Math.abs((c.opacityFactor ?? 1) - 1) < EPS
  );
}
