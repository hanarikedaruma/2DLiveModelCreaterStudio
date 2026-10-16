import type { Binding, Model, Vec2, Warp } from '@app/schema';
import { IDENTITY, multiplyAffine, partAffine } from './affine';
import { applyWarp, isUsableWarp, regularWarpPoints } from './warp';
import { rectOfPoints } from '../generate/bounds';

// 基準の変形で画面の横向きになる入力方向。キーによる回転・祖先の非線形ワープは打ち消さない
export function baseWarpAngle(model: Model, partId: string): number {
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let matrix = IDENTITY,
    part = byId.get(partId);
  while (part && !seen.has(part.id)) {
    seen.add(part.id);
    matrix = multiplyAffine(partAffine(part, undefined), matrix);
    part = part.parentId === null ? undefined : byId.get(part.parentId);
  }
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12) return 0;
  const angle = Math.atan2(-matrix.b / determinant, matrix.d / determinant);
  return Math.abs(angle) < 1e-12 ? 0 : angle;
}

// 入力点を角度に沿った格子で囲む。boundsの中心はパーツ空間の位置、幅・高さは格子方向の長さ
export function warpFrameBounds(points: readonly Vec2[], angle: number, margin = 0): Warp['bounds'] | null {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const rect = rectOfPoints(points.map((p) => ({ x: c * p.x + s * p.y, y: -s * p.x + c * p.y })));
  if (!rect) return null;
  const mx = margin > 0 ? Math.max(rect.width * margin, 1) : 0;
  const my = margin > 0 ? Math.max(rect.height * margin, 1) : 0;
  const fx = rect.x + rect.width / 2,
    fy = rect.y + rect.height / 2;
  const width = Math.max(rect.width + 2 * mx, 1e-6),
    height = Math.max(rect.height + 2 * my, 1e-6);
  return { x: c * fx - s * fy - width / 2, y: s * fx + c * fy - height / 2, width, height };
}

// 格子の向きを変えて旧写像を新しい制御点へ移す。曲げた写像の近似誤差は呼び出し側で描画位置を比較する
export function reorientWarp(
  warp: Warp,
  angle: number,
  bindings: readonly Binding[],
): { warp: Warp; bindings: Binding[] } | null {
  if (
    !isUsableWarp(warp) ||
    !Number.isFinite(angle) ||
    !warp.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  if (Math.abs(angle - (warp.angle ?? 0)) < 1e-9) return { warp, bindings: [...bindings] };
  const bounds = warpFrameBounds(regularWarpPoints(warp.bounds, 1, 1, warp.angle ?? 0), angle);
  if (!bounds) return null;
  const grid = regularWarpPoints(bounds, warp.columns, warp.rows, angle);
  const transfer = (values: Vec2[]) => {
    const points = new Float64Array(grid.flatMap((p) => [p.x, p.y]));
    applyWarp(points, { ...warp, points: values }, undefined);
    return grid.map((_, i) => ({ x: points[i * 2]!, y: points[i * 2 + 1]! }));
  };
  const nextBindings: Binding[] = [];
  for (const binding of bindings) {
    if (binding.target.type !== 'warp' || binding.target.id !== warp.id || binding.channel !== 'warpPoints') {
      nextBindings.push(binding);
      continue;
    }
    const keys: Binding['keys'] = [];
    for (const key of binding.keys) {
      if (
        !Array.isArray(key.delta) ||
        key.delta.length !== warp.points.length ||
        !key.delta.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      )
        return null;
      keys.push({ ...key, delta: transfer(key.delta) });
    }
    nextBindings.push({ ...binding, keys });
  }
  return { warp: { ...warp, angle, bounds, points: transfer(warp.points) }, bindings: nextBindings };
}
