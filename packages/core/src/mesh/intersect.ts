import type { Vec2 } from '@app/schema';

// 向き（正: abc が反時計回り。y 下向きの座標では画面上で時計回り）
function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// 一直線上にある r が線分 pq の範囲に入るか
function within(p: Vec2, q: Vec2, r: Vec2): boolean {
  return (
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  );
}

// 線分 ab と cd が交わるか（端が触れる・重なるのも含む）
export function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}

interface Segment {
  contour: number;
  index: number; // 輪郭の中の辺の番号（点 index → index+1）
  a: Vec2;
  b: Vec2;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// 自分やほかの輪郭と交わる・触れる・折り返す輪郭の番号を返す（閉じた多角形の集まり）
export function findCrossingContours(contours: Vec2[][]): Set<number> {
  const segments: Segment[] = [];
  contours.forEach((points, contour) => {
    const n = points.length;
    for (let index = 0; index < n; index++) {
      const a = points[index]!;
      const b = points[(index + 1) % n]!;
      segments.push({
        contour,
        index,
        a,
        b,
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      });
    }
  });
  const bad = new Set<number>();
  if (segments.length === 0) return bad;

  // 辺を一様な格子のマスに振り分け、同じマスの辺どうしだけを調べる
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.minX);
    minY = Math.min(minY, s.minY);
    maxX = Math.max(maxX, s.maxX);
    maxY = Math.max(maxY, s.maxY);
  }
  const cell = Math.max(4, 2 * Math.sqrt(((maxX - minX + 1) * (maxY - minY + 1)) / segments.length));
  const cols = Math.floor((maxX - minX) / cell) + 1;
  const buckets = new Map<number, number[]>();
  segments.forEach((s, id) => {
    const x0 = Math.floor((s.minX - minX) / cell);
    const x1 = Math.floor((s.maxX - minX) / cell);
    const y0 = Math.floor((s.minY - minY) / cell);
    const y1 = Math.floor((s.maxY - minY) / cell);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = y * cols + x;
        const list = buckets.get(key);
        if (list) list.push(id);
        else buckets.set(key, [id]);
      }
    }
  });

  for (const [key, list] of buckets) {
    const cx = key % cols;
    const cy = Math.floor(key / cols);
    for (let i = 0; i < list.length; i++) {
      const s = segments[list[i]!]!;
      for (let j = i + 1; j < list.length; j++) {
        const t = segments[list[j]!]!;
        if (s.maxX < t.minX || t.maxX < s.minX || s.maxY < t.minY || t.maxY < s.minY) continue;
        // 同じ組を何度も調べないよう、外接矩形の重なりの左上を含むマスでだけ調べる
        const rx = Math.floor((Math.max(s.minX, t.minX) - minX) / cell);
        const ry = Math.floor((Math.max(s.minY, t.minY) - minY) / cell);
        if (rx !== cx || ry !== cy) continue;
        if (pairIsBad(s, t, contours)) {
          bad.add(s.contour);
          bad.add(t.contour);
        }
      }
    }
  }
  return bad;
}

function pairIsBad(s: Segment, t: Segment, contours: Vec2[][]): boolean {
  if (s.contour === t.contour) {
    const n = contours[s.contour]!.length;
    const sNext = (s.index + 1) % n === t.index;
    const tNext = (t.index + 1) % n === s.index;
    if (sNext || tNext) {
      // 隣り合う辺は、共有する点で真後ろに折り返していないかだけを見る
      const [first, second] = sNext ? [s, t] : [t, s];
      const ux = first.b.x - first.a.x;
      const uy = first.b.y - first.a.y;
      const vx = second.b.x - second.a.x;
      const vy = second.b.y - second.a.y;
      return ux * vy - uy * vx === 0 && ux * vx + uy * vy < 0;
    }
  }
  return segmentsTouch(s.a, s.b, t.a, t.b);
}
