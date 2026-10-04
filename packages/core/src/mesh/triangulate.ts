// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- cdt2d の型はリポジトリで1つだけ持つ（types/cdt2d.d.ts）
/// <reference path="../../../../types/cdt2d.d.ts" />
import cdt2d from 'cdt2d';
import type { Vec2 } from '@app/schema';

export interface Triangulation {
  points: Vec2[];
  triangles: [number, number, number][];
}

// 輪郭（閉じた多角形。互いに交わらない。偶奇で内側を決める）を制約にして三角形分割し、内側の三角形だけを返す。
// inner は内側に足す点。三角形の向きは (b-a)×(c-a) > 0 にそろえ、どの三角形にも使われない点は除く。
// cdt2d では制約付きの掃引（monotone）だけを使い、内側の判定とドロネーへの辺の入れ替えはここで行う
// （cdt2d の入れ替えは点の多い格子で遅いため）
export function triangulateContours(contours: Vec2[][], inner: Vec2[]): Triangulation {
  const all: Vec2[] = [];
  const edges: [number, number][] = [];
  for (const points of contours) {
    const base = all.length;
    points.forEach((p, i) => {
      all.push(p);
      edges.push([base + i, base + ((i + 1) % points.length)]);
    });
  }
  all.push(...inner);
  const cells = cdt2d(
    all.map((p) => [p.x, p.y]),
    edges,
    { delaunay: false },
  );
  const mesh = buildHalfEdges(all, cells, edges);
  const inside = classifyInside(mesh);
  flipToDelaunay(mesh, all, inside);
  return collectInside(mesh, all, inside);
}

// 三角形 t の角 i（0..2）は v[3t+i]。半辺 e = 3t+i は v[e] → v[next(e)]。twin は隣の三角形の逆向きの半辺（無ければ -1）
export interface HalfEdgeMesh {
  v: Int32Array;
  twin: Int32Array;
  constrained: Uint8Array; // 半辺が制約の辺か
}

const next = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function buildHalfEdges(
  points: Vec2[],
  cells: [number, number, number][],
  edges: [number, number][],
): HalfEdgeMesh {
  const n = points.length;
  const key = (a: number, b: number) => a * n + b;
  const constraintKeys = new Set<number>();
  for (const [a, b] of edges) {
    constraintKeys.add(key(a, b));
    constraintKeys.add(key(b, a));
  }
  const t = cells.length;
  const v = new Int32Array(3 * t);
  const twin = new Int32Array(3 * t).fill(-1);
  const constrained = new Uint8Array(3 * t);
  const open = new Map<number, number>(); // まだ相手の見つからない半辺
  cells.forEach(([a, b, c], i) => {
    // 向きをそろえる
    const [p, q, r] = cross(points[a]!, points[b]!, points[c]!) > 0 ? [a, b, c] : [a, c, b];
    v[3 * i] = p;
    v[3 * i + 1] = q;
    v[3 * i + 2] = r;
  });
  for (let e = 0; e < 3 * t; e++) {
    const a = v[e]!;
    const b = v[next(e)]!;
    if (constraintKeys.has(key(a, b))) constrained[e] = 1;
    const other = open.get(key(b, a));
    if (other === undefined) {
      open.set(key(a, b), e);
    } else {
      twin[e] = other;
      twin[other] = e;
      open.delete(key(b, a));
    }
  }
  return { v, twin, constrained };
}

// 制約の辺をまたぐたびに内外が入れ替わる。外周（相手の無い半辺）の外は外側
export function classifyInside(mesh: HalfEdgeMesh): Uint8Array {
  const { twin, constrained } = mesh;
  const count = twin.length / 3;
  const inside = new Uint8Array(count);
  const seen = new Uint8Array(count);
  const stack: number[] = [];
  for (let e = 0; e < twin.length; e++) {
    if (twin[e]! >= 0) continue;
    const t = Math.floor(e / 3);
    if (seen[t]) continue;
    seen[t] = 1;
    inside[t] = constrained[e]!;
    stack.push(t);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const h = 3 * cur + k;
        const o = twin[h]!;
        if (o < 0) continue;
        const nb = Math.floor(o / 3);
        if (seen[nb]) continue;
        seen[nb] = 1;
        inside[nb] = inside[cur]! ^ constrained[h]!;
        stack.push(nb);
      }
    }
  }
  return inside;
}

// d が三角形 abc（cross > 0）の外接円の内側なら正
function inCircle(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const adx = a.x - d.x;
  const ady = a.y - d.y;
  const bdx = b.x - d.x;
  const bdy = b.y - d.y;
  const cdx = c.x - d.x;
  const cdy = c.y - d.y;
  const al = adx * adx + ady * ady;
  const bl = bdx * bdx + bdy * bdy;
  const cl = cdx * cdx + cdy * cdy;
  const det = al * (bdx * cdy - cdx * bdy) + bl * (cdx * ady - adx * cdy) + cl * (adx * bdy - bdx * ady);
  // 丸め誤差で入れ替えを繰り返さないよう、ほぼ同じ円の上なら入れ替えない
  const scale =
    al * (Math.abs(bdx * cdy) + Math.abs(cdx * bdy)) +
    bl * (Math.abs(cdx * ady) + Math.abs(adx * cdy)) +
    cl * (Math.abs(adx * bdy) + Math.abs(bdx * ady));
  return det > scale * 1e-12 ? det : 0;
}

// 内側の三角形どうしの、制約でない辺を入れ替えてドロネーにする（Lawson の方法）
export function flipToDelaunay(mesh: HalfEdgeMesh, points: Vec2[], inside: Uint8Array): number {
  const { v, twin, constrained } = mesh;
  const stack: number[] = [];
  for (let e = 0; e < v.length; e++) {
    const o = twin[e]!;
    if (o > e && !constrained[e] && inside[Math.floor(e / 3)] && inside[Math.floor(o / 3)]) stack.push(e);
  }
  let flips = 0;
  const limit = 100 * v.length + 1000; // 念のための上限（誤差で止まらなくなるのを防ぐ）
  while (stack.length > 0 && flips < limit) {
    const e0 = stack.pop()!;
    const f0 = twin[e0]!;
    if (f0 < 0 || constrained[e0]) continue;
    const t = Math.floor(e0 / 3);
    const u = Math.floor(f0 / 3);
    if (!inside[t] || !inside[u]) continue;
    const e1 = next(e0);
    const e2 = next(e1);
    const f1 = next(f0);
    const f2 = next(f1);
    const ia = v[e0]!;
    const ib = v[e1]!;
    const ic = v[e2]!;
    const id = v[f2]!;
    const a = points[ia]!;
    const b = points[ib]!;
    const c = points[ic]!;
    const d = points[id]!;
    if (inCircle(a, b, c, d) <= 0) continue;
    // 入れ替えたあとの2つの三角形がつぶれない（四角形が凸）ときだけ
    if (cross(a, d, c) <= 0 || cross(d, b, c) <= 0) continue;
    // 外まわりの4辺（入れ替えの前に読む）
    const outer = [f1, e2, f2, e1].map((h) => ({ twin: twin[h]!, constrained: constrained[h]! }));
    // t = [a, d, c]、u = [d, b, c]
    const t0 = 3 * t;
    const u0 = 3 * u;
    v[t0] = ia;
    v[t0 + 1] = id;
    v[t0 + 2] = ic;
    v[u0] = id;
    v[u0 + 1] = ib;
    v[u0 + 2] = ic;
    // a→d（元 f1）、c→a（元 e2）、d→b（元 f2）、b→c（元 e1）
    const slots = [t0, t0 + 2, u0, u0 + 1];
    slots.forEach((h, k) => {
      const o = outer[k]!;
      twin[h] = o.twin;
      constrained[h] = o.constrained;
      if (o.twin >= 0) twin[o.twin] = h;
    });
    // 新しい対角線 d→c と c→d
    twin[t0 + 1] = u0 + 2;
    twin[u0 + 2] = t0 + 1;
    constrained[t0 + 1] = 0;
    constrained[u0 + 2] = 0;
    flips++;
    for (const h of slots) if (!constrained[h] && twin[h]! >= 0) stack.push(h);
  }
  return flips;
}

// 内側の三角形と、それが使う点だけを元の順のまま取り出す
function collectInside(mesh: HalfEdgeMesh, all: Vec2[], inside: Uint8Array): Triangulation {
  const { v } = mesh;
  const used = new Uint8Array(all.length);
  const kept: number[] = [];
  for (let t = 0; t < inside.length; t++) {
    if (!inside[t]) continue;
    const a = v[3 * t]!;
    const b = v[3 * t + 1]!;
    const c = v[3 * t + 2]!;
    if (cross(all[a]!, all[b]!, all[c]!) <= 0) continue;
    kept.push(a, b, c);
    used[a] = used[b] = used[c] = 1;
  }
  const remap = new Int32Array(all.length);
  const points: Vec2[] = [];
  all.forEach((p, i) => {
    if (!used[i]) return;
    remap[i] = points.length;
    points.push(p);
  });
  const triangles: [number, number, number][] = [];
  for (let k = 0; k < kept.length; k += 3) {
    triangles.push([remap[kept[k]!]!, remap[kept[k + 1]!]!, remap[kept[k + 2]!]!]);
  }
  return { points, triangles };
}
