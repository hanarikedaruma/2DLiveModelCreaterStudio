// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- cdt2d の型はリポジトリで1つだけ持つ（types/cdt2d.d.ts）
/// <reference path="../../../../types/cdt2d.d.ts" />
import cdt2d from 'cdt2d';
import type { Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { buildHalfEdges, classifyInside, flipToDelaunay, triangulateContours } from './triangulate';

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

function area(points: Vec2[], [i, j, k]: [number, number, number]): number {
  const a = points[i]!;
  const b = points[j]!;
  const c = points[k]!;
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

// 三角形を座標の文字列の集合にする（番号の振り方や向きによらず比べる）
function triangleKeys(points: Vec2[], triangles: [number, number, number][]): string[] {
  return triangles
    .map((t) =>
      t
        .map((i) => `${points[i]!.x},${points[i]!.y}`)
        .sort()
        .join('|'),
    )
    .sort();
}

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('triangulateContours', () => {
  it('穴のある四角を、穴を除いて隙間なく分割する', () => {
    const outer = square(0, 0, 30);
    const hole = square(10, 10, 10);
    const inner = [
      { x: 5, y: 5 },
      { x: 25, y: 25 },
      { x: 15, y: 15 }, // 穴の中の点は使われない
      { x: 50, y: 50 }, // 外の点も使われない
    ];
    const { points, triangles } = triangulateContours([outer, hole], inner);
    expect(points).toHaveLength(10);
    expect(points).not.toContainEqual({ x: 15, y: 15 });
    expect(points).not.toContainEqual({ x: 50, y: 50 });
    let total = 0;
    for (const t of triangles) {
      const a = area(points, t);
      expect(a).toBeGreaterThan(0);
      total += a;
      const cx = (points[t[0]]!.x + points[t[1]]!.x + points[t[2]]!.x) / 3;
      const cy = (points[t[0]]!.y + points[t[1]]!.y + points[t[2]]!.y) / 3;
      expect(cx > 10 && cx < 20 && cy > 10 && cy < 20).toBe(false);
    }
    expect(total).toBe(30 * 30 - 10 * 10);
  });

  it('輪郭の辺（縦の辺も）はすべて三角形の辺になる', () => {
    const outer = square(0, 0, 40);
    const hole = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 20, y: 20 },
      { x: 10, y: 30 },
    ];
    const { points, triangles } = triangulateContours([outer, hole], [{ x: 20, y: 35 }]);
    const edges = new Set<string>();
    const key = (a: Vec2, b: Vec2) => [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join('|');
    for (const [i, j, k] of triangles) {
      edges.add(key(points[i]!, points[j]!));
      edges.add(key(points[j]!, points[k]!));
      edges.add(key(points[k]!, points[i]!));
    }
    for (const c of [outer, hole]) {
      c.forEach((a, i) => expect(edges.has(key(a, c[(i + 1) % c.length]!))).toBe(true));
    }
  });

  it('cdt2d のドロネー込みの分割と同じ三角形になる（一般の位置の点）', () => {
    const rand = random(11);
    for (let trial = 0; trial < 5; trial++) {
      const outer = Array.from({ length: 40 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 40;
        const r = 100 + 20 * rand();
        return { x: 150 + r * Math.cos(a), y: 150 + r * Math.sin(a) };
      });
      const hole = Array.from({ length: 12 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 12;
        return { x: 150 + 30 * Math.cos(a), y: 150 + 30 * Math.sin(a) };
      });
      const inner: Vec2[] = [];
      while (inner.length < 150) {
        const p = { x: 40 + 220 * rand(), y: 40 + 220 * rand() };
        const d = Math.hypot(p.x - 150, p.y - 150);
        if (d > 40 && d < 90) inner.push(p);
      }
      const ours = triangulateContours([outer, hole], inner);

      const all = [...outer, ...hole, ...inner];
      const edges: [number, number][] = [];
      [outer, hole].reduce((base, c) => {
        c.forEach((_, i) => edges.push([base + i, base + ((i + 1) % c.length)]));
        return base + c.length;
      }, 0);
      const reference = cdt2d(
        all.map((p) => [p.x, p.y]),
        edges,
        { exterior: false },
      );
      expect(triangleKeys(ours.points, ours.triangles)).toEqual(triangleKeys(all, reference));
    }
  });
});

describe('classifyInside / flipToDelaunay', () => {
  it('制約をまたぐたびに内外が入れ替わる（入れ子の四角）', () => {
    const contours = [square(0, 0, 30), square(10, 10, 10)];
    const points = contours.flat();
    const edges: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
    ];
    const cells = cdt2d(
      points.map((p) => [p.x, p.y]),
      edges,
      { delaunay: false },
    );
    const mesh = buildHalfEdges(points, cells, edges);
    const inside = classifyInside(mesh);
    for (let t = 0; t < inside.length; t++) {
      const cx = (points[mesh.v[3 * t]!]!.x + points[mesh.v[3 * t + 1]!]!.x + points[mesh.v[3 * t + 2]!]!.x) / 3;
      const cy = (points[mesh.v[3 * t]!]!.y + points[mesh.v[3 * t + 1]!]!.y + points[mesh.v[3 * t + 2]!]!.y) / 3;
      expect(inside[t]).toBe(cx > 10 && cx < 20 && cy > 10 && cy < 20 ? 0 : 1);
    }
  });

  it('外接円の内側に向かいの点がある辺を入れ替える（制約の辺は入れ替えない）', () => {
    // 細長いひし形を、長い対角線で分けた2枚
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: -1 },
      { x: 20, y: 0 },
      { x: 10, y: 1 },
    ];
    const cells: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 3],
    ];
    const outline: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ];
    const free = buildHalfEdges(points, cells, outline);
    expect(flipToDelaunay(free, points, new Uint8Array([1, 1]))).toBe(1);
    const diagonals = new Set<string>();
    for (let e = 0; e < 6; e++) {
      const a = free.v[e]!;
      const b = free.v[e % 3 === 2 ? e - 2 : e + 1]!;
      diagonals.add([a, b].sort().join('-'));
    }
    expect(diagonals.has('1-3')).toBe(true);
    expect(diagonals.has('0-2')).toBe(false);

    // 対角線が制約なら入れ替えない
    const fixed = buildHalfEdges(points, cells, [...outline, [0, 2]]);
    expect(flipToDelaunay(fixed, points, new Uint8Array([1, 1]))).toBe(0);
  });
});
