import type { Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { findCrossingContours } from './intersect';
import { segmentDistanceSq, simplifyContour, simplifyContours, subdivideContour } from './simplify';

// 点から閉じた多角形の辺までの最短距離
function distanceToPolygon(p: Vec2, polygon: Vec2[]): number {
  let best = Infinity;
  polygon.forEach((a, i) => {
    best = Math.min(best, segmentDistanceSq(p, a, polygon[(i + 1) % polygon.length]!));
  });
  return Math.sqrt(best);
}

// 半径 r の円周上の n 点（画像の縁から離れた所）
function circle(cx: number, cy: number, r: number, n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }));
}

describe('segmentDistanceSq', () => {
  it('線分までの距離の2乗（端の外は端までの距離）', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(segmentDistanceSq({ x: 5, y: 3 }, a, b)).toBe(9);
    expect(segmentDistanceSq({ x: -3, y: 4 }, a, b)).toBe(25);
    expect(segmentDistanceSq({ x: 13, y: -4 }, a, b)).toBe(25);
    expect(segmentDistanceSq({ x: 2, y: 2 }, a, a)).toBe(8);
  });
});

describe('simplifyContour', () => {
  it('元の点はどれも単純化した輪郭から許容誤差以内にあり、点は減る', () => {
    const points = circle(500, 500, 200, 400);
    for (const tolerance of [6, 3, 1.5]) {
      const out = simplifyContour(points, tolerance, 1000, 1000);
      expect(out.length).toBeLessThan(points.length);
      expect(out.length).toBeGreaterThanOrEqual(3);
      for (const p of points) expect(distanceToPolygon(p, out)).toBeLessThanOrEqual(tolerance + 1e-9);
    }
  });

  it('許容誤差が小さいほど点が多い', () => {
    // 真円だと半分ずつに分かれて数がそろいやすいので、ゆがんだ円で見る
    const points = Array.from({ length: 2000 }, (_, i) => {
      const a = (2 * Math.PI * i) / 2000;
      const r = 300 + 40 * Math.sin(3 * a) + 15 * Math.sin(7 * a + 1);
      return { x: 500 + r * Math.cos(a), y: 500 + r * Math.sin(a) };
    });
    const counts = [6, 3, 1.5].map((t) => simplifyContour(points, t, 1000, 1000).length);
    expect(counts[0]).toBeLessThan(counts[1]!);
    expect(counts[1]).toBeLessThan(counts[2]!);
  });

  it('許容誤差 0 では一直線でない点をすべて残す', () => {
    const points = circle(50, 50, 20, 30);
    expect(simplifyContour(points, 0, 100, 100)).toHaveLength(30);
  });

  it('画像の縁に沿った辺とその端の点は動かさない', () => {
    // 左の縁（x = 0）に沿って下り、内側へ大きく回って戻る輪郭
    const points: Vec2[] = [
      { x: 0, y: 10 },
      { x: 0, y: 90 },
      ...Array.from({ length: 30 }, (_, i) => {
        const a = Math.PI / 2 - (Math.PI * (i + 1)) / 31;
        return { x: 40 * Math.cos(a), y: 50 + 40 * Math.sin(a) };
      }),
    ];
    const out = simplifyContour(points, 6, 100, 100);
    expect(out).toContainEqual({ x: 0, y: 10 });
    expect(out).toContainEqual({ x: 0, y: 90 });
    for (const p of points) expect(distanceToPolygon(p, out)).toBeLessThanOrEqual(6 + 1e-9);
  });
});

describe('simplifyContours', () => {
  it('単純化で輪郭どうしが交わるときは、許容誤差を下げてやり直す', () => {
    // A: 下の辺が振幅 4 のぎざぎざ（y=60 と、内側へへこんだ y=56 が交互）。許容誤差 6 だと y=60 の直線になる
    const zigzag: Vec2[] = Array.from({ length: 11 }, (_, i) => ({ x: 10 + i * 10, y: i % 2 === 0 ? 60 : 56 }));
    const a: Vec2[] = [{ x: 10, y: 10 }, ...zigzag, { x: 110, y: 10 }];
    // B: へこみ（x=60）の下にある台形。頂点 (62, 57.5) が A の直線化した辺をまたぐ
    const b: Vec2[] = [
      { x: 58, y: 57.5 },
      { x: 62, y: 57.5 },
      { x: 80, y: 100 },
      { x: 40, y: 100 },
    ];
    expect(findCrossingContours([a, b]).size).toBe(0);
    const naive = [simplifyContour(a, 6, 200, 200), simplifyContour(b, 6, 200, 200)];
    expect(findCrossingContours(naive).size).toBeGreaterThan(0);
    const out = simplifyContours([a, b], 6, 200, 200);
    expect(findCrossingContours(out).size).toBe(0);
    // B の上のへこみは残る
    expect(out[0]).toContainEqual({ x: 60, y: 56 });
  });

  it('3 点に満たなくなる輪郭は、許容誤差を下げて 3 点以上にする', () => {
    const tiny = circle(50, 50, 1, 8);
    const [out] = simplifyContours([tiny], 6, 100, 100);
    expect(out!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('subdivideContour', () => {
  it('長い辺を等分し、元の点と形は変えない', () => {
    const square: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 0, y: 30 },
    ];
    const out = subdivideContour(square, 28);
    for (const p of square) expect(out).toContainEqual(p);
    out.forEach((p, i) => {
      const q = out[(i + 1) % out.length]!;
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(28 + 1e-9);
      expect(distanceToPolygon(p, square)).toBeLessThan(1e-9);
    });
    // 100 → 4 等分、30 → 2 等分
    expect(out).toHaveLength(4 + 4 + 2 + 2);
  });
});
