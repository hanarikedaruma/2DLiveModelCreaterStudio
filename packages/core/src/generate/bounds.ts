import type { Asset, Vec2 } from '@app/schema';

// キャンバス座標の矩形
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 素材の外接矩形（トリミング後の offset と幅・高さ）
export function rectOfAsset(asset: Asset): Rect {
  return { x: asset.offset.x, y: asset.offset.y, width: asset.width, height: asset.height };
}

// 点の外接矩形。点が無ければ null
export function rectOfPoints(points: readonly Vec2[]): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 矩形をまとめた外接矩形。null は飛ばす。1つも無ければ null
export function unionRects(rects: readonly (Rect | null | undefined)[]): Rect | null {
  const points: Vec2[] = [];
  for (const r of rects) {
    if (!r) continue;
    points.push({ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height });
  }
  return rectOfPoints(points);
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectTopCenter(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y };
}

export function rectBottomCenter(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y + r.height };
}
