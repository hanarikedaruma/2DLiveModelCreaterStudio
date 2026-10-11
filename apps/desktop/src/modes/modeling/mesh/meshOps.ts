// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- cdt2d の型はリポジトリで1つだけ持つ（types/cdt2d.d.ts）
/// <reference path="../../../../../../types/cdt2d.d.ts" />
// メッシュの形を変える計算（頂点の追加・削除と三角形の作り直し）と、メッシュを変えるコマンド。計算は純粋関数
import cdt2d from 'cdt2d';
import type { Binding, Mesh, Model, Vec2 } from '@app/schema';
import type { Command } from '@app/contracts';
import { modelCommand, transferMeshKeys } from '@app/core';

export type Triangle = [number, number, number];
export interface MeshShape {
  vertices: Vec2[];
  uvs: Vec2[];
  triangles: Triangle[];
}
export type ShapeResult = { ok: true; shape: MeshShape; added?: number } | { ok: false; error: string };

const EPS = 1e-9;

const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const cross = (p: Vec2, q: Vec2) => p.x * q.y - p.y * q.x;
const area2 = (a: Vec2, b: Vec2, c: Vec2) => cross(sub(b, a), sub(c, a));

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  const t = len2 < EPS ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

// 端点を共有しない2つの線分が交わるか（端の上で触れるのも交わるとみなす）
export function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = area2(q1, q2, p1);
  const d2 = area2(q1, q2, p2);
  const d3 = area2(p1, p2, q1);
  const d4 = area2(p1, p2, q2);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS)))
    return true;
  const on = (a: Vec2, b: Vec2, p: Vec2) => distanceToSegment(p, a, b) < 1e-7;
  return on(q1, q2, p1) || on(q1, q2, p2) || on(p1, p2, q1) || on(p1, p2, q2);
}

// 重心座標（三角形の外では負になる）。つぶれた三角形なら null
export function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] | null {
  const area = area2(a, b, c);
  if (Math.abs(area) < EPS) return null;
  const u = area2(p, b, c) / area;
  const v = area2(a, p, c) / area;
  return [u, v, 1 - u - v];
}

// 1つの三角形にだけ使われている辺（輪郭）
export function boundaryEdges(triangles: Triangle[]): [number, number][] {
  const count = new Map<string, { edge: [number, number]; n: number }>();
  for (const [a, b, c] of triangles) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const entry = count.get(key);
      if (entry) entry.n++;
      else count.set(key, { edge: [p, q], n: 1 });
    }
  }
  return [...count.values()].filter((e) => e.n === 1).map((e) => e.edge);
}

// 制約付きドロネー三角形分割。制約（輪郭）があればその内側だけを残し、無ければ凸包を埋める。
// 三角形の向きは (b-a)×(c-a) > 0 にそろえ、つぶれたものは除く
export function triangulate(vertices: Vec2[], constraints: [number, number][]): Triangle[] {
  if (vertices.length < 3) return [];
  const points = vertices.map((v): [number, number] => [v.x, v.y]);
  const cells = constraints.length > 0 ? cdt2d(points, constraints, { exterior: false }) : cdt2d(points);
  const out: Triangle[] = [];
  for (const [a, b, c] of cells) {
    const s = area2(vertices[a]!, vertices[b]!, vertices[c]!);
    if (Math.abs(s) < EPS) continue;
    out.push(s > 0 ? [a, b, c] : [a, c, b]);
  }
  return out;
}

function triangleDistance(p: Vec2, a: Vec2, b: Vec2, c: Vec2): number {
  const w = barycentric(p, a, b, c);
  if (w && w.every((x) => x >= -EPS)) return 0;
  return Math.min(distanceToSegment(p, a, b), distanceToSegment(p, b, c), distanceToSegment(p, c, a));
}

// p の UV。含む三角形（無ければいちばん近い三角形）の重心座標で求める
export function uvAt(shape: MeshShape, p: Vec2): { uv: Vec2; inside: boolean } | null {
  let best: { t: Triangle; d: number } | null = null;
  for (const t of shape.triangles) {
    const d = triangleDistance(p, shape.vertices[t[0]]!, shape.vertices[t[1]]!, shape.vertices[t[2]]!);
    if (!best || d < best.d) best = { t, d };
    if (d === 0) break;
  }
  if (!best) return null;
  const [i, j, k] = best.t;
  const w = barycentric(p, shape.vertices[i]!, shape.vertices[j]!, shape.vertices[k]!);
  if (!w) return null;
  const [ui, uj, uk] = [shape.uvs[i]!, shape.uvs[j]!, shape.uvs[k]!];
  return {
    uv: { x: w[0] * ui.x + w[1] * uj.x + w[2] * uk.x, y: w[0] * ui.y + w[1] * uj.y + w[2] * uk.y },
    inside: best.d === 0,
  };
}

// 新しい輪郭の辺が、ほかの輪郭の辺と交わらず、ほかの頂点の上も通らないか
function edgesValid(vertices: Vec2[], edges: [number, number][], added: [number, number][]): boolean {
  for (const [a, b] of added) {
    for (const [c, d] of edges) {
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(vertices[a]!, vertices[b]!, vertices[c]!, vertices[d]!)) return false;
    }
    for (let i = 0; i < vertices.length; i++) {
      if (i === a || i === b) continue;
      if (distanceToSegment(vertices[i]!, vertices[a]!, vertices[b]!) < 1e-7) return false;
    }
  }
  return true;
}

const sameEdge = (e: [number, number], a: number, b: number) =>
  (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a);

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
const triangleKey = (t: Triangle) => [...t].sort((x, y) => x - y).join(',');

// 点が輪郭（辺の集まり）の内側か（偶奇の規則）
function insideOutline(p: Vec2, vertices: Vec2[], outline: [number, number][]): boolean {
  let inside = false;
  for (const [i, j] of outline) {
    const a = vertices[i]!;
    const b = vertices[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

// 残す三角形の辺と輪郭をすべて制約にして三角形に分け、輪郭の内側だけを使う。残す三角形はそのまま残る
// （3辺が制約で中に頂点が無い）ので、作り直すのは穴や分けた所だけになり、ほかの所のキーの形は変わらない（I-073）。
// 残す三角形が出てこなければ null
function triangulateKeeping(
  vertices: Vec2[],
  outline: [number, number][],
  kept: Triangle[],
  extra: [number, number][] = [],
): Triangle[] | null {
  const seen = new Set<string>();
  const constraints: [number, number][] = [];
  const add = (a: number, b: number) => {
    if (a === b || seen.has(edgeKey(a, b))) return;
    seen.add(edgeKey(a, b));
    constraints.push([a, b]);
  };
  for (const [a, b] of [...outline, ...extra]) add(a, b);
  for (const [a, b, c] of kept) {
    add(a, b);
    add(b, c);
    add(c, a);
  }
  const keptKeys = new Set(kept.map(triangleKey));
  const found = new Set<string>();
  const fresh: Triangle[] = [];
  for (const [a, b, c] of cdt2d(
    vertices.map((v): [number, number] => [v.x, v.y]),
    constraints,
  )) {
    const s = area2(vertices[a]!, vertices[b]!, vertices[c]!);
    if (Math.abs(s) < EPS) continue;
    const key = triangleKey([a, b, c]);
    if (keptKeys.has(key)) {
      found.add(key);
      continue;
    }
    const center = {
      x: (vertices[a]!.x + vertices[b]!.x + vertices[c]!.x) / 3,
      y: (vertices[a]!.y + vertices[b]!.y + vertices[c]!.y) / 3,
    };
    if (insideOutline(center, vertices, outline)) fresh.push(s > 0 ? [a, b, c] : [a, c, b]);
  }
  if (found.size !== keptKeys.size) return null;
  return [...kept, ...fresh];
}

// 見えている形（visible: 頂点ごとの今の位置）の上の点 p が、基準の形のどこに当たるか。
// 見えている三角形のうち p を含むもの（無ければいちばん近いもの）の重心座標で、基準の頂点から求める（I-073）
export function basePointAt(shape: Pick<MeshShape, 'vertices' | 'triangles'>, visible: Vec2[], p: Vec2): Vec2 | null {
  let best: { t: Triangle; d: number } | null = null;
  for (const t of shape.triangles) {
    const a = visible[t[0]];
    const b = visible[t[1]];
    const c = visible[t[2]];
    if (!a || !b || !c || Math.abs(area2(a, b, c)) < EPS) continue;
    const d = triangleDistance(p, a, b, c);
    if (!best || d < best.d) best = { t, d };
    if (d === 0) break;
  }
  if (!best) return null;
  const [i, j, k] = best.t;
  const w = barycentric(p, visible[i]!, visible[j]!, visible[k]!);
  if (!w) return null;
  const [a, b, c] = [shape.vertices[i]!, shape.vertices[j]!, shape.vertices[k]!];
  return { x: w[0] * a.x + w[1] * b.x + w[2] * c.x, y: w[0] * a.y + w[1] * b.y + w[2] * c.y };
}

// 頂点 p を足す。p を含む三角形（辺の上なら、その辺の両側の三角形）だけを分け、ほかの三角形は変えない（I-073）。
// 輪郭の外なら、いちばん近い輪郭の辺を p まで広げる
export function addVertex(shape: MeshShape, p: Vec2, minDistance = 1e-6): ShapeResult {
  if (shape.vertices.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < minDistance))
    return { ok: false, error: '近くにすでに頂点がある' };
  const found = uvAt(shape, p);
  if (!found) return { ok: false, error: '三角形が無いので頂点を足せない。[自動生成] でメッシュを作る' };
  const { uv } = found;
  if (uv.x < -1e-6 || uv.x > 1 + 1e-6 || uv.y < -1e-6 || uv.y > 1 + 1e-6)
    return { ok: false, error: '画像の外には頂点を追加できない' };

  const n = shape.vertices.length;
  const vertices = [...shape.vertices, p];
  const uvs = [...shape.uvs, { x: Math.min(1, Math.max(0, uv.x)), y: Math.min(1, Math.max(0, uv.y)) }];
  let edges = boundaryEdges(shape.triangles);

  // 輪郭の辺の上か外なら、その辺を2つに分ける（内側なら輪郭はそのまま）
  let nearest: { edge: [number, number]; d: number } | null = null;
  for (const e of edges) {
    const d = distanceToSegment(p, shape.vertices[e[0]]!, shape.vertices[e[1]]!);
    if (!nearest || d < nearest.d) nearest = { edge: e, d };
  }
  if (nearest && (!found.inside || nearest.d < 1e-7)) {
    const [a, b] = nearest.edge;
    const rest = edges.filter((e) => e !== nearest.edge);
    const added: [number, number][] = [
      [a, n],
      [n, b],
    ];
    if (!found.inside && !edgesValid(vertices, rest, added))
      return { ok: false, error: 'ここには頂点を追加できない（輪郭が交差する）' };
    edges = [...rest, ...added];
  }

  // 分ける三角形: p を含むもの。内側の辺の上なら、その辺は分けた2本にする
  const ownTriangles = shape.triangles.filter(([i, j, k]) => {
    const a = shape.vertices[i]!;
    const b = shape.vertices[j]!;
    const c = shape.vertices[k]!;
    return triangleDistance(p, a, b, c) < 1e-7;
  });
  const extra: [number, number][] = [];
  if (found.inside) {
    for (const [i, j, k] of ownTriangles)
      for (const [a, b] of [
        [i, j],
        [j, k],
        [k, i],
      ] as const)
        if (distanceToSegment(p, shape.vertices[a]!, shape.vertices[b]!) < 1e-7) extra.push([a, n], [n, b]);
  }
  const split = new Set(ownTriangles.map(triangleKey));
  const kept = found.inside ? shape.triangles.filter((t) => !split.has(triangleKey(t))) : shape.triangles;
  const triangles = triangulateKeeping(vertices, edges, kept, extra);
  if (!triangles || !triangles.some((t) => t.includes(n))) return { ok: false, error: 'ここには頂点を追加できない' };
  return { ok: true, shape: { vertices, uvs, triangles }, added: n };
}

// 頂点を消して、消した頂点のまわりの穴だけを三角形に分け直す（ほかの三角形は変えない。I-073）。輪郭の頂点なら、両隣をつなぐ
export function removeVertices(shape: MeshShape, indices: number[]): ShapeResult {
  const remove = new Set(indices.filter((i) => i >= 0 && i < shape.vertices.length));
  if (remove.size === 0) return { ok: false, error: '消す頂点が選ばれていない' };
  if (shape.vertices.length - remove.size < 3) return { ok: false, error: '頂点は3つより少なくできない' };

  let edges = boundaryEdges(shape.triangles);
  const added: [number, number][] = [];
  for (const v of remove) {
    const incident = edges.filter((e) => e[0] === v || e[1] === v);
    if (incident.length === 0) continue;
    if (incident.length !== 2) return { ok: false, error: 'この頂点は消せない（輪郭が枝分かれしている）' };
    const other = (e: [number, number]) => (e[0] === v ? e[1] : e[0]);
    const u = other(incident[0]!);
    const w = other(incident[1]!);
    edges = edges.filter((e) => !incident.includes(e));
    // 3つの頂点だけの輪郭は、つなぐと潰れるので輪郭ごと無くす
    const existing = edges.find((e) => sameEdge(e, u, w));
    if (existing) edges = edges.filter((e) => e !== existing);
    else if (u !== w) {
      const edge: [number, number] = [u, w];
      edges.push(edge);
      added.push(edge);
    }
  }

  const keep = shape.vertices.map((_, i) => i).filter((i) => !remove.has(i));
  const map = new Map(keep.map((old, i) => [old, i]));
  const vertices = keep.map((i) => shape.vertices[i]!);
  const uvs = keep.map((i) => shape.uvs[i] ?? { x: 0, y: 0 });
  const mapped = (e: [number, number]): [number, number] => [map.get(e[0])!, map.get(e[1])!];
  const newEdges = edges.map(mapped);
  const newAdded = added.filter((e) => edges.includes(e)).map(mapped);
  if (!edgesValid(vertices, newEdges, newAdded)) return { ok: false, error: 'この頂点は消せない（輪郭が交差する）' };

  const kept = shape.triangles
    .filter((t) => t.every((i) => !remove.has(i)))
    .map((t): Triangle => [map.get(t[0])!, map.get(t[1])!, map.get(t[2])!]);
  const triangles = triangulateKeeping(vertices, newEdges, kept);
  if (!triangles) return { ok: false, error: 'この頂点は消せない（三角形を作り直せない）' };
  if (triangles.length === 0) return { ok: false, error: 'メッシュが無くなるので消せない' };
  return { ok: true, shape: { vertices, uvs, triangles } };
}

// ---- バインディングとコマンド ----

// このメッシュの vertices バインディング
export function vertexBindings(model: Model, meshId: string): Binding[] {
  return model.bindings.filter((b) => b.channel === 'vertices' && b.target.type === 'mesh' && b.target.id === meshId);
}

export function vertexKeyCount(model: Model, meshId: string): number {
  return vertexBindings(model, meshId).reduce((n, b) => n + b.keys.length, 0);
}

// メッシュの形を置き換え、そのメッシュの vertices バインディングの全キーを新しい頂点へ転写する（カード28。MVP のリセットを置き換える）
export function remeshCommand(
  label: string,
  meshId: string,
  shape: MeshShape,
  patch: Partial<Pick<Mesh, 'edited' | 'density'>>,
): Command {
  return modelCommand(label, (model) => {
    if (!model.meshes.some((m) => m.id === meshId)) return model;
    const transferred = transferMeshKeys(model, meshId, shape);
    return {
      ...transferred,
      meshes: transferred.meshes.map((m) =>
        m.id === meshId ? { ...m, vertices: shape.vertices, uvs: shape.uvs, triangles: shape.triangles, ...patch } : m,
      ),
    };
  });
}

// メッシュを作って画像パーツに付ける
export function attachNewMesh(label: string, partId: string, mesh: Mesh): Command {
  return modelCommand(label, (model) => {
    if (!model.parts.some((p) => p.id === partId)) return model;
    return {
      ...model,
      meshes: [...model.meshes, mesh],
      parts: model.parts.map((p) => (p.id === partId ? { ...p, meshId: mesh.id } : p)),
    };
  });
}

// 基準の頂点が変わったら edited を true にする（キーだけが変わったときはそのまま）
export function markEditedIfChanged(meshId: string, command: Command): Command {
  return {
    label: command.label,
    apply(project) {
      const next = command.apply(project);
      const before = project.model.meshes.find((m) => m.id === meshId);
      const after = next.model.meshes.find((m) => m.id === meshId);
      if (!before || !after || after.vertices === before.vertices || after.edited) return next;
      return {
        ...next,
        model: { ...next.model, meshes: next.model.meshes.map((m) => (m === after ? { ...m, edited: true } : m)) },
      };
    },
  };
}
