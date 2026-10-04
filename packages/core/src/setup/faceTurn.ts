// 曲面の顔の向き（カード42）。顔の変形グループ（faceGroup）のワープと、斜め方向の合成の補正
import type { Model, Part, Vec2, Warp } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { pointsToAncestorSpace } from '../deform/space';
import { regularWarpPoints } from '../deform/warp';
import { rectOfPoints } from '../generate/bounds';
import { clean } from '../generate/keys';
import { SURFACE_MAX_ANGLE, SURFACE_RADIUS_RATIO } from '../generate/surface';
import type { BoundsOf } from './pivots';
import { indexStandardParts } from './standardParts';

// 足すワープの分割（横・縦）と、子の外接矩形のまわりの余白（カード29の [ワープを追加] と同じ）
export const FACE_WARP_DIVISIONS = 4;
export const FACE_WARP_MARGIN = 0.05;

const NO_DELTAS: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };

// 画像パーツの基準の形（メッシュがあれば頂点、無ければ素材の矩形の四隅）
function basePoints(model: Model, part: Part, boundsOf: BoundsOf): Vec2[] {
  const mesh = part.meshId !== null ? model.meshes.find((m) => m.id === part.meshId) : undefined;
  if (mesh && mesh.vertices.length > 0) return mesh.vertices;
  const r = boundsOf(part);
  if (!r) return [];
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

function isDescendant(parts: ReadonlyMap<string, Part>, part: Part, ancestorId: string): boolean {
  const seen = new Set<string>();
  let id = part.parentId;
  while (id !== null && !seen.has(id)) {
    if (id === ancestorId) return true;
    seen.add(id);
    id = parts.get(id)?.parentId ?? null;
  }
  return false;
}

// faceGroup にワープが1つも無ければ、4×4 の規則的な格子を足す（見た目は変わらない）。
// 範囲は子孫の画像パーツの外接矩形（グループのワープを掛ける直前の空間で測る）+ 5%（最低 1px）の余白。
// すでにあるワープは形も範囲も変えない
export function withFaceWarp(model: Model, boundsOf: BoundsOf, newId: () => string): Model {
  const group = indexStandardParts(model.parts).group('faceGroup');
  if (!group || model.warps.some((w) => w.partId === group.id)) return model;
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const points: Vec2[] = [];
  for (const part of model.parts) {
    if (part.kind !== 'image' || !isDescendant(parts, part, group.id)) continue;
    const local = pointsToAncestorSpace(model, NO_DELTAS, part.id, group.id, basePoints(model, part, boundsOf));
    points.push(...local.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
  const rect = rectOfPoints(points);
  if (!rect) return model;
  const mx = Math.max(rect.width * FACE_WARP_MARGIN, 1);
  const my = Math.max(rect.height * FACE_WARP_MARGIN, 1);
  const bounds = { x: rect.x - mx, y: rect.y - my, width: rect.width + mx * 2, height: rect.height + my * 2 };
  const n = FACE_WARP_DIVISIONS;
  const warp: Warp = {
    id: newId(),
    partId: group.id,
    columns: n,
    rows: n,
    bounds,
    points: regularWarpPoints(bounds, n, n),
  };
  return { ...model, warps: [...model.warps, warp] };
}

// faceGroup の曲面に使うワープ（最初のワープ。カード29のツールが編集するもの）
export function faceWarpOf(model: Model): Warp | null {
  const group = indexStandardParts(model.parts).group('faceGroup');
  return group ? (model.warps.find((w) => w.partId === group.id) ?? null) : null;
}

// 球を回したときの制御点の差分。FaceAngleX は画面の右へ、FaceAngleY は上へ向く回転で、
// 2つを合わせた回転（軸 (−θy, θx)、角度 √(θx² + θy²)）を一度に掛ける。
// 中心・半径・角度は generateSurfaceKeys（カード31）と同じ（中心 = bounds の中心、半径 = 0.6 × max(幅, 高さ)、
// 角度 = 値 / 30 × 20°）。球の外の点は、中心から見て同じ向きの球の縁の点と同じだけ動かす
export function sphereTurn(warp: Warp, valueX: number, valueY: number): Vec2[] {
  const { x, y, width, height } = warp.bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const r = SURFACE_RADIUS_RATIO * Math.max(width, height);
  const toRadian = (value: number) => (((value / 30) * SURFACE_MAX_ANGLE) / 180) * Math.PI;
  const tx = toRadian(valueX);
  const ty = toRadian(valueY);
  const phi = Math.hypot(tx, ty);
  if (phi === 0 || !(r > 0)) return warp.points.map(() => ({ x: 0, y: 0 }));
  // 回転の軸 k = (kx, ky, 0)（u 右・v 上・w 手前）
  const kx = -ty / phi;
  const ky = tx / phi;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return warp.points.map((p) => {
    let u = (p.x - cx) / r;
    let v = (cy - p.y) / r;
    const rho = Math.hypot(u, v);
    if (rho > 1) {
      u /= rho;
      v /= rho;
    }
    const w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
    const dot = kx * u + ky * v;
    // ロドリゲスの回転の式: p cosφ + (k × p) sinφ + k (k·p)(1 − cosφ)
    const u2 = u * c + ky * w * s + kx * dot * (1 - c);
    const v2 = v * c - kx * w * s + ky * dot * (1 - c);
    return { x: clean(r * (u2 - u)), y: clean(-r * (v2 - v)) };
  });
}

// 斜め方向の合成の補正（FaceAngleX × FaceAngleY の2パラメータのバインディングのキー）。
// 左右・上下のキー（generateSurfaceKeys）の和に足すと、球を斜めに回したときの、左右だけ・上下だけの回転では
// 表せない分（球の回転から左右だけ・上下だけの回転を引いたもの）が加わる。軸の上（片方が 0）では 0
export function faceTurnCrossTerm(warp: Warp, valueX: number, valueY: number): Vec2[] {
  const both = sphereTurn(warp, valueX, valueY);
  const onlyX = sphereTurn(warp, valueX, 0);
  const onlyY = sphereTurn(warp, 0, valueY);
  return both.map((d, i) => ({
    x: clean(d.x - onlyX[i]!.x - onlyY[i]!.x),
    y: clean(d.y - onlyX[i]!.y - onlyY[i]!.y),
  }));
}
