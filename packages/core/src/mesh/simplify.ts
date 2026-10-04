import type { Vec2 } from '@app/schema';
import { findCrossingContours } from './intersect';

// 点 p から線分 ab までの距離の2乗
export function segmentDistanceSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = a.x + dx * t - p.x;
  const ey = a.y + dy * t - p.y;
  return ex * ex + ey * ey;
}

// Douglas–Peucker。points[first..last] のうち残す点の keep に 1 を付ける（first・last は呼ぶ側で付ける）
function markDouglasPeucker(points: Vec2[], first: number, last: number, toleranceSq: number, keep: Uint8Array) {
  const stack = [first, last];
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    let worst = -1;
    let worstSq = toleranceSq;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistanceSq(points[i]!, points[a]!, points[b]!);
      if (d > worstSq) {
        worstSq = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push(a, worst, worst, b);
  }
}

// 両端が画像の同じ縁にある辺（画像の縁に沿った輪郭）。単純化で動かさない
export function isBorderSegment(a: Vec2, b: Vec2, width: number, height: number): boolean {
  return (
    (a.x === 0 && b.x === 0) ||
    (a.y === 0 && b.y === 0) ||
    (a.x === width && b.x === width) ||
    (a.y === height && b.y === height)
  );
}

// 閉じた輪郭を Douglas–Peucker で単純化する。画像の縁に沿った辺とその端の点はそのまま残す。
// 残した点のあいだの元の点は、どれも残した辺から tolerance 以内にある
export function simplifyContour(points: Vec2[], tolerance: number, width: number, height: number): Vec2[] {
  const n = points.length;
  if (n <= 3) return points.slice();
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    if (isBorderSegment(prev, cur, width, height) || isBorderSegment(cur, next, width, height)) anchors.push(i);
  }
  // 最初の分かれ目から始まるように並べ替え、終わりに始点をもう一度置く
  let start = 0;
  if (anchors.length === 0) {
    // 縁に触れない輪郭は、左上の点と、そこから最も遠い点で2つに分ける
    for (let i = 1; i < n; i++) {
      const p = points[i]!;
      const s = points[start]!;
      if (p.x < s.x || (p.x === s.x && p.y < s.y)) start = i;
    }
  } else {
    start = anchors[0]!;
  }
  const ring: Vec2[] = [];
  for (let i = 0; i <= n; i++) ring.push(points[(start + i) % n]!);
  const keep = new Uint8Array(n + 1);
  const toleranceSq = tolerance * tolerance;
  const cuts: number[] = [];
  if (anchors.length === 0) {
    const origin = ring[0]!;
    let far = 1;
    let farSq = -1;
    for (let i = 1; i < n; i++) {
      const p = ring[i]!;
      const d = (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2;
      if (d > farSq) {
        farSq = d;
        far = i;
      }
    }
    cuts.push(0, far, n);
  } else {
    for (const a of anchors) cuts.push((a - start + n) % n);
    cuts.sort((p, q) => p - q);
    cuts.push(n);
  }
  for (const c of cuts) keep[c] = 1;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k]!;
    const b = cuts[k + 1]!;
    if (b - a > 1) markDouglasPeucker(ring, a, b, toleranceSq, keep);
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]!);
  return out;
}

// すべての輪郭を単純化する。3点に満たない・自分やほかの輪郭と交わる（触れる）輪郭は、
// 許容誤差を半分ずつ下げてやり直す（最後は 0 = 元の輪郭なので、必ず交わらない）
export function simplifyContours(contours: Vec2[][], tolerance: number, width: number, height: number): Vec2[][] {
  const steps = [tolerance, tolerance / 2, tolerance / 4, 0];
  const level = contours.map(() => 0);
  const out = contours.map((c) => simplifyContour(c, tolerance, width, height));
  for (;;) {
    const bad = findCrossingContours(out);
    out.forEach((c, i) => {
      if (c.length < 3) bad.add(i);
    });
    let changed = false;
    for (const i of bad) {
      const next = (level[i] ?? 0) + 1;
      if (next >= steps.length) continue;
      level[i] = next;
      out[i] = simplifyContour(contours[i]!, steps[next]!, width, height);
      changed = true;
    }
    if (!changed) return out;
  }
}

// maxLength より長い辺を等分する点を足す（閉じた多角形。形は変わらない）
export function subdivideContour(points: Vec2[], maxLength: number): Vec2[] {
  const out: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    out.push(a);
    const pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxLength);
    for (let k = 1; k < pieces; k++) {
      const t = k / pieces;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
