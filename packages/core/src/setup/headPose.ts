// I-039 頭の向き（根本改善の試作）。顔の向き（FaceAngleX・FaceAngleY）を、頭（headRoot）の共通の姿勢として
// 1つ決め、顔・目鼻口・髪・耳のそれぞれの頂点を、パーツの種類ごとの層で動かす（同じワープを全部に掛けない）。
//
// - 頭は楕円体とみなす（寸法は顔の素材の形から求める。長い髪は寸法に入れない）。
// - 顔の表面の層（顔・目・眉・口・頬・前髪・横髪）は、表面に沿って回す。中心ほど大きく動き、輪郭（楕円の縁）は
//   動かない。そのため横を向くと目鼻が輪郭に寄り、近い側は詰まり、遠い側は伸びる（向きが形で分かる）。
//   上下も同じで、あご（下端）と頭の上端は動かず、首とのつながりを保つ。
// - 後ろ髪・耳は頭の後ろ側の層で、向きと逆へ少し動く（視差）。
// - 動かせる角度は、目・眉・口が輪郭に寄りすぎない範囲をモデルごとに求める（一律の角度にしない）。
//
// キーは各画像パーツのメッシュの頂点の差分（source 'auto'）。左右・上下は −30〜30 を 10 刻み、斜めは ±30 の4隅と
// 基準の補正（左右だけ・上下だけの和からの差）。手で直したキー・ロックしたキーは、かんたんセットアップの再実行で残る
import type { Mesh, Model, Part, Vec2 } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { pointsToAncestorSpace } from '../deform/space';
import { clean, transformDelta } from '../generate/keys';
import type { BindingPlan } from './motions';
import type { BoundsOf } from './pivots';
import type { PointPlan } from './step1';
import { indexStandardParts, type ImageType } from './standardParts';

const NO_DELTAS: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };
const DEG = Math.PI / 180;

// 頭の楕円（headRoot の空間）。顔の素材の形から求める
export interface HeadShape {
  cx: number;
  cy: number;
  ax: number; // 横の半径
  ay: number; // 縦の半径（あごが下端、上は顔の上端より上まで）
}

// パラメータ ±30 のときの角度（度）。モデルごとに求める
export interface HeadLimits {
  yaw: number;
  pitch: number;
}

// 層。surface = 頭の表面に沿って回す（gain は表面からの浮き。前髪は少し大きく、横髪は小さく）、
// behind = 頭の後ろ側で、向きと逆へ平行に動く（後ろ髪・耳）
export type HeadLayer = { kind: 'surface'; gain: number } | { kind: 'behind'; gain: number };

// 頭の寸法の決め方（顔の素材の外接矩形に対する割合）
export const HEAD_SHAPE = {
  widthRatio: 1.05, // 横の半径 = 顔の幅 / 2 × これ
  topRatio: 0.3, // 顔の上端より、顔の高さ × これだけ上まで頭とみなす（前髪の付け根まで回す）
};
// 角度の上限を決める目安（目・眉・口の頂点が、回したあと楕円の中心からこの角度を超えない）と、上限・下限
export const HEAD_LIMIT = {
  featureYaw: 62,
  featurePitch: 55,
  maxYaw: 25,
  minYaw: 8,
  maxPitch: 14,
  minPitch: 4,
};
// 斜め（左右 ±30 と上下 ±30 を同時）は、左右・上下それぞれのこの割合の角度で回した形にする。
// そのまま足すと目鼻が四隅へ寄りすぎるため（左右と上下の和で回る量を抑える）
export const HEAD_DIAGONAL_SCALE = 0.75;
// 層の表（標準パーツの種類 → 層）
const SURFACE: ImageType[] = [
  'face',
  'cheek',
  'eyeWhiteL',
  'irisL',
  'highlightL',
  'upperLidL',
  'lowerLidL',
  'eyeWholeL',
  'eyeWhiteR',
  'irisR',
  'highlightR',
  'upperLidR',
  'lowerLidR',
  'eyeWholeR',
  'browL',
  'browR',
  'upperLip',
  'lowerLip',
  'mouthInside',
  'teeth',
  'tongue',
  'mouthWhole',
];
// 角度の上限を決める部品（目・眉・口）
const FEATURES: ImageType[] = SURFACE.filter((t) => t !== 'face' && t !== 'cheek');

export function layerOfType(type: ImageType | null, depth: number): HeadLayer {
  if (type === 'frontHair') return { kind: 'surface', gain: 1.05 };
  if (type === 'sideHairL' || type === 'sideHairR') return { kind: 'surface', gain: 0.55 };
  if (type === 'backHair') return { kind: 'behind', gain: 0.35 };
  if (type === 'earL' || type === 'earR') return { kind: 'behind', gain: 0.25 };
  if (type && SURFACE.includes(type)) return { kind: 'surface', gain: 1 };
  // 標準パーツでないもの: 手前（奥行きが 0 以上）なら表面、後ろなら後ろ側
  return depth >= 0 ? { kind: 'surface', gain: 1 } : { kind: 'behind', gain: 0.35 };
}

// ---- 1つの点の動き（headRoot の空間） ----

const clampUnit = (v: number, m = 0.999) => Math.min(m, Math.max(-m, v));

// 表面の層の点を、左右 yaw・上下 pitch（ラジアン。右・上が正）だけ回した位置
function turnOnSurface(p: Vec2, head: HeadShape, gain: number, yaw: number, pitch: number): Vec2 {
  const { cx, cy, ax, ay } = head;
  let x = p.x;
  let y = p.y;
  if (yaw !== 0) {
    const w = ax * Math.sqrt(1 - clampUnit((y - cy) / ay) ** 2);
    const u = (x - cx) / w;
    if (Math.abs(u) < 1) {
      const a = Math.asin(u);
      x = cx + w * Math.sin(a + yaw * gain * Math.cos(a));
    }
  }
  if (pitch !== 0) {
    const h = ay * Math.sqrt(1 - clampUnit((x - cx) / ax) ** 2);
    const v = (y - cy) / h;
    if (Math.abs(v) < 1) {
      const g = Math.asin(v); // 下が正
      y = cy + h * Math.sin(g - pitch * gain * Math.cos(g));
    }
  }
  return { x, y };
}

// 後ろ側の層: 向きと逆へ平行に動く（上を向くと下へ）
function turnBehind(p: Vec2, head: HeadShape, gain: number, yaw: number, pitch: number): Vec2 {
  return { x: p.x - gain * head.ax * Math.sin(yaw), y: p.y + gain * head.ay * Math.sin(pitch) * 0.5 };
}

export function turnPoint(p: Vec2, head: HeadShape, layer: HeadLayer, yaw: number, pitch: number): Vec2 {
  return layer.kind === 'surface'
    ? turnOnSurface(p, head, layer.gain, yaw, pitch)
    : turnBehind(p, head, layer.gain, yaw, pitch);
}

// ---- モデルから ----

interface HeadPart {
  part: Part;
  mesh: Mesh | null; // メッシュが無ければ素材の矩形の点で動かし、位置のキーにする
  type: ImageType | null;
  layer: HeadLayer;
  points: Vec2[]; // headRoot の空間の頂点
  // headRoot の空間の差分を、パーツの空間（頂点の差分の空間）へ戻す行列（2×2 の逆）
  back: [number, number, number, number];
}

function imageTypeOfPart(part: Part): ImageType | null {
  return part.kind === 'image' && part.standardType !== null ? (part.standardType as ImageType) : null;
}

// headRoot の子孫の画像パーツと層。標準パーツでないものは、いちばん近い標準の画像の祖先の層。
// メッシュが無いパーツは素材の矩形の 3×3 の点を使う（boundsOf が無いか矩形が無ければ除く）
function headParts(model: Model, headId: string, boundsOf?: BoundsOf): HeadPart[] {
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const meshes = new Map(model.meshes.map((m) => [m.id, m]));
  const out: HeadPart[] = [];
  for (const part of model.parts) {
    if (part.kind !== 'image') continue;
    const found = part.meshId !== null ? meshes.get(part.meshId) : undefined;
    const mesh = found && found.vertices.length > 0 ? found : null;
    const rect = mesh ? null : boundsOf?.(part);
    const vertices: Vec2[] = mesh
      ? mesh.vertices
      : rect
        ? // 素材の矩形の 3×3 の点（四隅だけだと楕円の縁に乗って動かないため、中ほどの点も入れる）
          [0, 0.5, 1].flatMap((fy) =>
            [0, 0.5, 1].map((fx) => ({ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy })),
          )
        : [];
    if (vertices.length === 0) continue;
    let type: ImageType | null = imageTypeOfPart(part);
    let underHead = false;
    const seen = new Set<string>();
    for (let id = part.parentId; id !== null && !seen.has(id); id = parts.get(id)?.parentId ?? null) {
      seen.add(id);
      if (id === headId) {
        underHead = true;
        break;
      }
      const ancestor = parts.get(id);
      if (!type && ancestor) type = imageTypeOfPart(ancestor);
    }
    if (!underHead) continue;
    const points = pointsToAncestorSpace(model, NO_DELTAS, part.id, headId, vertices);
    // 頂点の中心のまわりの小さな移動で、パーツの空間 → headRoot の空間の線形部分を求めて逆にする
    const c = vertices.reduce((s, v) => ({ x: s.x + v.x, y: s.y + v.y }), { x: 0, y: 0 });
    c.x /= vertices.length;
    c.y /= vertices.length;
    const [o, ex, ey] = pointsToAncestorSpace(model, NO_DELTAS, part.id, headId, [
      c,
      { x: c.x + 1, y: c.y },
      { x: c.x, y: c.y + 1 },
    ]);
    const a = ex!.x - o!.x;
    const b = ey!.x - o!.x;
    const cc = ex!.y - o!.y;
    const d = ey!.y - o!.y;
    const det = a * d - b * cc;
    const back: HeadPart['back'] = Math.abs(det) > 1e-12 ? [d / det, -b / det, -cc / det, a / det] : [1, 0, 0, 1];
    out.push({ part, mesh, type, layer: layerOfType(type, part.depth), points, back });
  }
  return out;
}

// 頭の楕円。顔（標準パーツ face）の頂点の外接矩形から求める。顔が無ければ null
export function headShapeOf(parts: readonly HeadPart[]): HeadShape | null {
  const face = parts.filter((p) => p.type === 'face').flatMap((p) => p.points);
  if (face.length === 0) return null;
  const xs = face.map((p) => p.x);
  const ys = face.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const height = bottom - top;
  if (!(right > left) || !(height > 0)) return null;
  const headTop = top - height * HEAD_SHAPE.topRatio;
  return {
    cx: (left + right) / 2,
    cy: (headTop + bottom) / 2,
    ax: ((right - left) / 2) * HEAD_SHAPE.widthRatio,
    ay: (bottom - headTop) / 2,
  };
}

// 角度の上限（度）。目・眉・口の頂点の、楕円の中心から見た角度 α が、回したあと目安の角度を超えない最大の角度
export function headLimitsOf(parts: readonly HeadPart[], head: HeadShape): HeadLimits {
  let yaw: number = HEAD_LIMIT.maxYaw;
  let pitch: number = HEAD_LIMIT.maxPitch;
  for (const p of parts) {
    if (!p.type || !FEATURES.includes(p.type) || p.layer.kind !== 'surface') continue;
    for (const v of p.points) {
      const w = head.ax * Math.sqrt(1 - clampUnit((v.y - head.cy) / head.ay) ** 2);
      const a = Math.asin(clampUnit((v.x - head.cx) / w));
      yaw = Math.min(yaw, (HEAD_LIMIT.featureYaw * DEG - Math.abs(a)) / (p.layer.gain * Math.cos(a)) / DEG);
      const h = head.ay * Math.sqrt(1 - clampUnit((v.x - head.cx) / head.ax) ** 2);
      const g = Math.asin(clampUnit((v.y - head.cy) / h));
      pitch = Math.min(pitch, (HEAD_LIMIT.featurePitch * DEG - Math.abs(g)) / (p.layer.gain * Math.cos(g)) / DEG);
    }
  }
  return {
    yaw: Math.max(HEAD_LIMIT.minYaw, yaw),
    pitch: Math.max(HEAD_LIMIT.minPitch, pitch),
  };
}

// 1つのパーツの、(値X, 値Y) での頂点の差分（パーツの空間）
function partDeltas(p: HeadPart, head: HeadShape, limits: HeadLimits, valueX: number, valueY: number): Vec2[] {
  const yaw = (valueX / 30) * limits.yaw * DEG;
  const pitch = (valueY / 30) * limits.pitch * DEG;
  const [a, b, c, d] = p.back;
  return p.points.map((q) => {
    const t = turnPoint(q, head, p.layer, yaw, pitch);
    const dx = t.x - q.x;
    const dy = t.y - q.y;
    return { x: clean(a * dx + b * dy), y: clean(c * dx + d * dy) };
  });
}

const VALUES = [-30, -20, -10, 0, 10, 20, 30];
const CORNERS = [-30, 0, 30];

export interface HeadPosePlan {
  points: PointPlan[];
  transforms: BindingPlan[]; // メッシュの無いパーツの位置のキー（左右・上下）
  head: HeadShape | null;
  limits: HeadLimits | null;
}

const mean = (deltas: Vec2[]) => ({
  x: clean(deltas.reduce((s, d) => s + d.x, 0) / deltas.length),
  y: clean(deltas.reduce((s, d) => s + d.y, 0) / deltas.length),
});

// 頭の向きの計画（headRoot の子孫の画像パーツのメッシュごとに、左右・上下・斜めの補正）
export function planHeadPose(model: Model, boundsOf?: BoundsOf): HeadPosePlan {
  const none: HeadPosePlan = { points: [], transforms: [], head: null, limits: null };
  const headRoot = indexStandardParts(model.parts).group('headRoot');
  if (!headRoot) return none;
  const parts = headParts(model, headRoot.id, boundsOf);
  const head = headShapeOf(parts);
  if (!head) return none;
  const limits = headLimitsOf(parts, head);
  const points: PointPlan[] = [];
  const transforms: BindingPlan[] = [];
  for (const p of parts) {
    if (!p.mesh) {
      // メッシュが無ければ、矩形の点の動きの平均だけパーツを動かす（形は変えられない）
      for (const parameterId of ['FaceAngleX', 'FaceAngleY'] as const) {
        transforms.push({
          partId: p.part.id,
          parameterId,
          generation: 'linear',
          keys: VALUES.map((v) => {
            const d = mean(
              partDeltas(p, head, limits, parameterId === 'FaceAngleX' ? v : 0, parameterId === 'FaceAngleY' ? v : 0),
            );
            return { coord: v, delta: transformDelta({ x: d.x, y: d.y }) };
          }),
        });
      }
      continue;
    }
    const target = { type: 'mesh' as const, id: p.mesh.id };
    points.push({
      target,
      parameterIds: ['FaceAngleX'],
      generation: 'linear',
      keys: VALUES.map((v) => ({ coords: [v], delta: partDeltas(p, head, limits, v, 0) })),
    });
    points.push({
      target,
      parameterIds: ['FaceAngleY'],
      generation: 'linear',
      keys: VALUES.map((v) => ({ coords: [v], delta: partDeltas(p, head, limits, 0, v) })),
    });
    const keys: PointPlan['keys'] = [];
    for (const x of CORNERS) {
      for (const y of CORNERS) {
        // 斜めの合計を HEAD_DIAGONAL_SCALE の角度の回転にする（軸の上では補正 0）
        const scale = x !== 0 && y !== 0 ? HEAD_DIAGONAL_SCALE : 1;
        const both = partDeltas(p, head, limits, x * scale, y * scale);
        const onlyX = partDeltas(p, head, limits, x, 0);
        const onlyY = partDeltas(p, head, limits, 0, y);
        keys.push({
          coords: [x, y],
          delta: both.map((q, i) => ({
            x: clean(q.x - onlyX[i]!.x - onlyY[i]!.x),
            y: clean(q.y - onlyX[i]!.y - onlyY[i]!.y),
          })),
        });
      }
    }
    points.push({ target, parameterIds: ['FaceAngleX', 'FaceAngleY'], generation: 'linear', keys });
  }
  return { points, transforms, head, limits };
}

// かんたんセットアップが作る、頭の向きの頂点のバインディングか（headRoot の子孫の画像のメッシュの FaceAngleX・Y）
export function isHeadPoseBinding(model: Model, meshIds: ReadonlySet<string>, b: Model['bindings'][number]): boolean {
  return (
    b.channel === 'vertices' &&
    meshIds.has(b.target.id) &&
    b.parameterIds.length >= 1 &&
    b.parameterIds.length <= 2 &&
    b.parameterIds.every((id) => id === 'FaceAngleX' || id === 'FaceAngleY') &&
    model.meshes.some((m) => m.id === b.target.id)
  );
}

// headRoot の子孫の画像パーツのメッシュの id
export function headMeshIds(model: Model): Set<string> {
  const headRoot = indexStandardParts(model.parts).group('headRoot');
  return new Set(headRoot ? headParts(model, headRoot.id).flatMap((p) => (p.mesh ? [p.mesh.id] : [])) : []);
}
