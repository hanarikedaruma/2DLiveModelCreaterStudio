// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- cdt2d の型はリポジトリで1つだけ持つ（types/cdt2d.d.ts）
/// <reference path="../../../../types/cdt2d.d.ts" />
// 線に沿って頂点を足す（I-068）。線の上に step ごとと、線が今の辺と交わる所に頂点を置き、線に沿って辺でつなぐ。
// 今の辺をすべて制約にして三角形を作り直すので、新しい三角形はどれも元の三角形の中に収まり、絵の位置（UV）と
// キーの補間は、どの姿勢でも元と同じになる（キーは remeshCommand の転写で新しい頂点へ移す）。
// 線はどこでも、線の上の頂点を結んだ辺の上を通る。今の頂点は消さない。今の頂点のすぐそばでは、その頂点を使う。
// どれも純粋関数
import cdt2d from 'cdt2d';
import type { Mesh, Vec2 } from '@app/schema';
import { boundaryEdges, distanceToSegment, uvAt, type MeshShape, type Triangle } from './edit';

export const DENSIFY_STEP = 6; // 線の上の頂点の間隔（キャンバスの px）
export const DENSIFY_GAP = 3; // 頂点どうしをこれより近くに置かない（今の頂点が近ければ、それを使う）
const EDGE_GAP = 1; // 外周の辺にこれより近い所には置かない
const SNAP = 1.5; // 内側の辺にこれより近い点は、辺の上へ寄せる（とても細い三角形を作らない）

export type DensifyResult = { ok: true; shape: MeshShape; added: number } | { ok: false; error: string };

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const area2 = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export function lineLength(line: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1]!, line[i]!);
  return total;
}

// 折れ線を長さに沿って step ごとに置き直す（両端を含む）
export function resampleLine(line: readonly Vec2[], step: number): Vec2[] {
  if (line.length === 0) return [];
  const total = lineLength(line);
  const count = Math.max(1, Math.round(total / step));
  const out: Vec2[] = [];
  let seg = 0,
    walked = 0;
  for (let n = 0; n <= count; n++) {
    const target = (total * n) / count;
    while (seg < line.length - 2 && walked + dist(line[seg]!, line[seg + 1]!) < target) {
      walked += dist(line[seg]!, line[seg + 1]!);
      seg++;
    }
    const a = line[seg]!,
      b = line[Math.min(seg + 1, line.length - 1)]!;
    const len = dist(a, b);
    const t = len > 1e-12 ? Math.min(1, Math.max(0, (target - walked) / len)) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

// 線から tolerance 以内にある頂点の数（線の上の頂点の多さの目安）
export function verticesNearLine(vertices: readonly Vec2[], line: readonly Vec2[], tolerance = 2): number {
  let count = 0;
  for (const v of vertices) {
    for (let i = 1; i < line.length; i++) {
      if (distanceToSegment(v, line[i - 1]!, line[i]!) <= tolerance) {
        count++;
        break;
      }
    }
  }
  return count;
}

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2, eps = 1e-9): boolean {
  const s = area2(a, b, c);
  if (Math.abs(s) < 1e-12) return false;
  const u = area2(p, b, c) / s,
    v = area2(a, p, c) / s;
  return u >= -eps && v >= -eps && 1 - u - v >= -eps;
}

// 線分 pq と ab の交点の、pq の上の位置 s と ab の上の位置 t（どちらも 0..1）。交わらなければ null
function crossing(p: Vec2, q: Vec2, a: Vec2, b: Vec2): { s: number; t: number } | null {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const e = { x: b.x - a.x, y: b.y - a.y };
  const den = r.x * e.y - r.y * e.x;
  if (Math.abs(den) < 1e-12) return null;
  const s = ((a.x - p.x) * e.y - (a.y - p.y) * e.x) / den;
  const t = ((a.x - p.x) * r.y - (a.y - p.y) * r.x) / den;
  return s >= 0 && s <= 1 && t > 0 && t < 1 ? { s, t } : null;
}

// line は基準状態の頂点と同じ座標（メッシュの局所座標）の、細かい折れ線
export function verticesAlongLine(
  mesh: Pick<Mesh, 'vertices' | 'uvs' | 'triangles'>,
  line: readonly Vec2[],
  options: { step?: number; gap?: number } = {},
): DensifyResult {
  const step = options.step ?? DENSIFY_STEP;
  const gap = options.gap ?? DENSIFY_GAP;
  const shape: MeshShape = { vertices: mesh.vertices, uvs: mesh.uvs, triangles: mesh.triangles as Triangle[] };
  const outline = new Set(boundaryEdges(shape.triangles).map(([a, b]) => key(a, b)));
  const edges = new Map<string, [number, number]>();
  for (const [a, b, c] of mesh.triangles)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const)
      edges.set(key(p, q), [p, q]);
  const inner = [...edges.entries()].filter(([k]) => !outline.has(k)).map(([, e]) => e);
  const outer = [...edges.entries()].filter(([k]) => outline.has(k)).map(([, e]) => e);

  // 線の上の候補: step ごとの点と、内側の辺との交点（辺の上の点）。線に沿った長さの順に並べる
  type Candidate = { at: number; p: Vec2; edge: [number, number] | null };
  const candidates: Candidate[] = [];
  const total = lineLength(line);
  const regular = resampleLine(line, step);
  regular.forEach((p, i) => candidates.push({ at: (total * i) / Math.max(1, regular.length - 1), p, edge: null }));
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1]!,
      q = line[i]!;
    for (const [a, b] of inner) {
      const hit = crossing(p, q, mesh.vertices[a]!, mesh.vertices[b]!);
      if (!hit) continue;
      candidates.push({
        at: walked + dist(p, q) * hit.s,
        p: { x: p.x + (q.x - p.x) * hit.s, y: p.y + (q.y - p.y) * hit.s },
        edge: [a, b],
      });
    }
    walked += dist(p, q);
  }
  // 同じ位置なら辺の上の点を先にする（細かい点は後で間引く）
  candidates.sort((u, v) => u.at - v.at || (u.edge ? -1 : 0) - (v.edge ? -1 : 0));

  // 線に沿った頂点の並び（今の頂点か、足す頂点）。null は線が切れる所（メッシュの外・外周のすぐそば）
  const fresh: { p: Vec2; uv: Vec2; edge: [number, number] | null }[] = [];
  const chain: (number | null)[] = [];
  const n = mesh.vertices.length;
  const position = (index: number) => (index < n ? mesh.vertices[index]! : fresh[index - n]!.p);
  for (const c of candidates) {
    let p = c.p;
    let edge = c.edge;
    if (!edge) {
      // 内側の辺のすぐ近くの点は、その辺の上へ寄せる
      for (const [a, b] of inner) {
        const pa = mesh.vertices[a]!,
          pb = mesh.vertices[b]!;
        if (distanceToSegment(p, pa, pb) >= SNAP) continue;
        const dx = pb.x - pa.x,
          dy = pb.y - pa.y;
        const t = Math.min(1, Math.max(0, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / (dx * dx + dy * dy)));
        p = { x: pa.x + dx * t, y: pa.y + dy * t };
        edge = [a, b];
        break;
      }
    }
    const found = uvAt(shape, p);
    if (
      !found?.inside ||
      outer.some(([a, b]) => distanceToSegment(p, mesh.vertices[a]!, mesh.vertices[b]!) < EDGE_GAP)
    ) {
      if (chain.at(-1) !== null) chain.push(null);
      continue;
    }
    // 今の頂点のすぐそばなら、その頂点を使う
    const near = mesh.vertices.findIndex((v) => dist(v, p) < gap);
    if (near >= 0) {
      if (chain.at(-1) !== near) chain.push(near);
      continue;
    }
    const last = chain.at(-1);
    if (last !== null && last !== undefined && dist(position(last), p) < gap) {
      // 前の点に近すぎる。辺の上の点なら前の足した点と入れ替える（辺の上の点を残す）
      if (edge && last >= n && !fresh[last - n]!.edge) {
        fresh[last - n] = { p, uv: clampUv(found.uv), edge };
      }
      continue;
    }
    fresh.push({ p, uv: clampUv(found.uv), edge });
    chain.push(n + fresh.length - 1);
  }
  if (fresh.length === 0)
    return { ok: false, error: '足せる頂点がありません（線の上にすでに頂点があるか、線がメッシュの外にあります）' };

  const vertices = [...mesh.vertices, ...fresh.map((f) => f.p)];
  const uvs = [...mesh.uvs, ...fresh.map((f) => f.uv)];
  // 今の辺はすべて制約。辺の上の点があれば、その辺を点の所で分ける
  const onEdge = new Map<string, number[]>();
  fresh.forEach((f, k) => {
    if (!f.edge) return;
    const id = key(f.edge[0], f.edge[1]);
    onEdge.set(id, [...(onEdge.get(id) ?? []), n + k]);
  });
  const constraints: [number, number][] = [];
  for (const [id, [a, b]] of edges) {
    const middle = (onEdge.get(id) ?? []).sort(
      (i, j) => dist(vertices[a]!, vertices[i]!) - dist(vertices[a]!, vertices[j]!),
    );
    const path = [a, ...middle, b];
    for (let i = 1; i < path.length; i++) constraints.push([path[i - 1]!, path[i]!]);
  }
  // 線に沿った頂点を辺でつなぐ（同じ元の三角形の中にある2点だけ。元の辺と交わらない）
  const sameTriangle = (p: Vec2, q: Vec2) =>
    mesh.triangles.some(([i, j, k]) => {
      const a = mesh.vertices[i]!,
        b = mesh.vertices[j]!,
        c = mesh.vertices[k]!;
      return inTriangle(p, a, b, c, 1e-7) && inTriangle(q, a, b, c, 1e-7);
    });
  const linked = new Set(constraints.map(([a, b]) => key(a, b)));
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1],
      b = chain[i];
    if (a === null || b === null || a === undefined || b === undefined || a === b) continue;
    if (linked.has(key(a, b)) || !sameTriangle(vertices[a]!, vertices[b]!)) continue;
    linked.add(key(a, b));
    constraints.push([a, b]);
  }
  // 凸包の三角形分割（制約の辺は必ず残る）から、元のメッシュの中の三角形だけを残し、向きをそろえる
  const cells = cdt2d(
    vertices.map((v): [number, number] => [v.x, v.y]),
    constraints,
  );
  const triangles: Triangle[] = [];
  for (const [a, b, c] of cells) {
    const s = area2(vertices[a]!, vertices[b]!, vertices[c]!);
    if (Math.abs(s) < 1e-9) continue;
    const center = {
      x: (vertices[a]!.x + vertices[b]!.x + vertices[c]!.x) / 3,
      y: (vertices[a]!.y + vertices[b]!.y + vertices[c]!.y) / 3,
    };
    const inside = mesh.triangles.some(([i, j, k]) =>
      inTriangle(center, mesh.vertices[i]!, mesh.vertices[j]!, mesh.vertices[k]!),
    );
    if (!inside) continue;
    triangles.push(s > 0 ? [a, b, c] : [a, c, b]);
  }
  const used = new Set(triangles.flat());
  if (triangles.length === 0 || fresh.some((_, k) => !used.has(n + k)))
    return { ok: false, error: '線に沿って頂点を足せませんでした（三角形を作り直せない）' };
  return { ok: true, shape: { vertices, uvs, triangles }, added: fresh.length };
}

function clampUv(uv: Vec2): Vec2 {
  return { x: Math.min(1, Math.max(0, uv.x)), y: Math.min(1, Math.max(0, uv.y)) };
}
