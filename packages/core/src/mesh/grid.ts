import type { Vec2 } from '@app/schema';
import { segmentDistanceSq } from './simplify';

// 0..size に間隔 spacing で並べた位置（両端の余りが同じになるよう中央に寄せる）
export function gridPositions(size: number, spacing: number): number[] {
  const count = Math.floor(size / spacing);
  const start = (size - (count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, i) => start + i * spacing);
}

// 輪郭（閉じた多角形。偶奇で内側を決める）の内側の格子点のうち、どの辺からも spacing/2 より離れたもの
export function interiorGridPoints(contours: Vec2[][], width: number, height: number, spacing: number): Vec2[] {
  const xs = gridPositions(width, spacing);
  const ys = gridPositions(height, spacing);
  if (xs.length === 0 || ys.length === 0) return [];
  const segments: [Vec2, Vec2][] = [];
  for (const points of contours) {
    for (let i = 0; i < points.length; i++) segments.push([points[i]!, points[(i + 1) % points.length]!]);
  }

  // 近さを調べるための、spacing 角のマスごとの辺の一覧
  const cols = Math.floor(width / spacing) + 1;
  const rows = Math.floor(height / spacing) + 1;
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const clampCol = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor(x / spacing)));
  const clampRow = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / spacing)));
  segments.forEach(([a, b], id) => {
    for (let r = clampRow(Math.min(a.y, b.y)); r <= clampRow(Math.max(a.y, b.y)); r++) {
      for (let c = clampCol(Math.min(a.x, b.x)); c <= clampCol(Math.max(a.x, b.x)); c++)
        buckets[r * cols + c]!.push(id);
    }
  });
  const limitSq = (spacing / 2) ** 2;
  // spacing/2 < マスの幅なので、まわりの 3×3 マスだけを見ればよい
  const farFromOutline = (p: Vec2): boolean => {
    const c0 = clampCol(p.x);
    const r0 = clampRow(p.y);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(rows - 1, r0 + 1); r++) {
      for (let c = Math.max(0, c0 - 1); c <= Math.min(cols - 1, c0 + 1); c++) {
        for (const id of buckets[r * cols + c]!) {
          const [a, b] = segments[id]!;
          if (segmentDistanceSq(p, a, b) <= limitSq) return false;
        }
      }
    }
    return true;
  };

  const out: Vec2[] = [];
  for (const y of ys) {
    // この行を横切る辺の x（左から数えた個数が奇数なら内側）
    const crossings: number[] = [];
    for (const [a, b] of segments) {
      if (a.y <= y !== b.y <= y) crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    crossings.sort((p, q) => p - q);
    let k = 0;
    for (const x of xs) {
      while (k < crossings.length && crossings[k]! < x) k++;
      if (k % 2 === 1 && farFromOutline({ x, y })) out.push({ x, y });
    }
  }
  return out;
}
