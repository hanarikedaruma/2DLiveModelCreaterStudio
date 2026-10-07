import type { Binding, Vec2, Warp } from '@app/schema';
import { applyWarp, isUsableWarp, regularWarpPoints } from './warp';

// セルの境界を動かすと非一様な変形が変わる。元の間隔・境界を残し、
// 端のセルの双線形の式を外へ延ばすことで、元の格子外も含めて同じ写像を保つ。
export function refitWarp(
  warp: Warp,
  target: Warp['bounds'],
  bindings: readonly Binding[],
): { warp: Warp; bindings: Binding[] } | null {
  if (!isUsableWarp(warp) || !warp.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  if (!Object.values(target).every(Number.isFinite) || target.width < 0 || target.height < 0) return null;
  const { bounds } = warp;
  const dx = bounds.width / warp.columns;
  const dy = bounds.height / warp.rows;
  const left = Math.max(0, Math.ceil((bounds.x - target.x) / dx - 1e-9));
  const top = Math.max(0, Math.ceil((bounds.y - target.y) / dy - 1e-9));
  const right = Math.max(0, Math.ceil((target.x + target.width - bounds.x - bounds.width) / dx - 1e-9));
  const bottom = Math.max(0, Math.ceil((target.y + target.height - bounds.y - bounds.height) / dy - 1e-9));
  if (left + top + right + bottom === 0) return { warp, bindings: [...bindings] };
  const columns = warp.columns + left + right;
  const rows = warp.rows + top + bottom;
  // 誤った巨大な座標の読み込みでも、無制限にメモリを確保しない。
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || (columns + 1) * (rows + 1) > 65536) return null;
  const nextBounds = { x: bounds.x - left * dx, y: bounds.y - top * dy, width: columns * dx, height: rows * dy };
  const grid = regularWarpPoints(nextBounds, columns, rows);
  const transfer = (values: Vec2[]): Vec2[] => {
    const probes = new Float64Array(grid.flatMap((p) => [p.x, p.y]));
    applyWarp(probes, { ...warp, points: values }, undefined);
    return grid.map((_, i) => ({ x: probes[i * 2]!, y: probes[i * 2 + 1]! }));
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
  return {
    warp: { ...warp, columns, rows, bounds: nextBounds, points: transfer(warp.points) },
    bindings: nextBindings,
  };
}
