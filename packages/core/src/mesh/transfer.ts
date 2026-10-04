// カード28: 変形の転写。メッシュを作り直したとき、旧いメッシュ（基準状態）の頂点の差分を新しい頂点へ移す
import type { Binding, Mesh, Model, Vec2 } from '@app/schema';

type Triangle = [number, number, number];

// 新しい点 1 つぶんの補間の重み（旧い頂点の番号と重み。重みの合計は 1）
type Weights = [index: number, weight: number][];

const EPS = 1e-9;

const area2 = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

// 重心座標（三角形の外では負になる）
function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2, area: number): [number, number, number] {
  const u = area2(p, b, c) / area;
  const v = area2(a, p, c) / area;
  return [u, v, 1 - u - v];
}

// 線分 ab の上で p にいちばん近い点の位置 t（0..1）と、その距離の2乗
function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; d2: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < EPS ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + dx * t - p.x;
  const y = a.y + dy * t - p.y;
  return { t, d2: x * x + y * y };
}

interface TriangleInfo {
  t: Triangle;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// 旧いメッシュの三角形を格子のマスに分けて、点を含む三角形を速く探す
interface TriangleIndex {
  infos: TriangleInfo[];
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  buckets: number[][];
}

function buildIndex(vertices: Vec2[], triangles: Triangle[]): TriangleIndex {
  const infos: TriangleInfo[] = [];
  for (const t of triangles) {
    const a = vertices[t[0]];
    const b = vertices[t[1]];
    const c = vertices[t[2]];
    if (!a || !b || !c) continue;
    const area = area2(a, b, c);
    if (Math.abs(area) < EPS) continue; // つぶれた三角形は使わない
    infos.push({
      t,
      area,
      minX: Math.min(a.x, b.x, c.x),
      minY: Math.min(a.y, b.y, c.y),
      maxX: Math.max(a.x, b.x, c.x),
      maxY: Math.max(a.y, b.y, c.y),
    });
  }
  if (infos.length === 0) return { infos, minX: 0, minY: 0, cell: 1, cols: 0, rows: 0, buckets: [] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of infos) {
    minX = Math.min(minX, f.minX);
    minY = Math.min(minY, f.minY);
    maxX = Math.max(maxX, f.maxX);
    maxY = Math.max(maxY, f.maxY);
  }
  const width = Math.max(maxX - minX, EPS);
  const height = Math.max(maxY - minY, EPS);
  // 1 マスに三角形が 2 つくらい入る大きさ
  const cell = Math.max(Math.sqrt((width * height * 2) / infos.length), EPS);
  const cols = Math.min(1024, Math.max(1, Math.ceil(width / cell)));
  const rows = Math.min(1024, Math.max(1, Math.ceil(height / cell)));
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
  infos.forEach((f, n) => {
    for (let r = row(f.minY); r <= row(f.maxY); r++) {
      for (let c = col(f.minX); c <= col(f.maxX); c++) buckets[r * cols + c]!.push(n);
    }
  });
  return { infos, minX, minY, cell, cols, rows, buckets };
}

// p を含む三角形の重心座標
function containing(index: TriangleIndex, vertices: Vec2[], p: Vec2): Weights | null {
  const c = Math.floor((p.x - index.minX) / index.cell);
  const r = Math.floor((p.y - index.minY) / index.cell);
  // 格子の縁の点は、外側のマスに入っても隣のマスで見つかるように 1 マスぶん広げて探す
  if (c < -1 || r < -1 || c > index.cols || r > index.rows) return null;
  const cc = Math.min(index.cols - 1, Math.max(0, c));
  const rr = Math.min(index.rows - 1, Math.max(0, r));
  for (const n of index.buckets[rr * index.cols + cc] ?? []) {
    const f = index.infos[n]!;
    if (p.x < f.minX - EPS || p.x > f.maxX + EPS || p.y < f.minY - EPS || p.y > f.maxY + EPS) continue;
    const [i, j, k] = f.t;
    const w = barycentric(p, vertices[i]!, vertices[j]!, vertices[k]!, f.area);
    if (w[0] >= -EPS && w[1] >= -EPS && w[2] >= -EPS) {
      return [
        [i, w[0]],
        [j, w[1]],
        [k, w[2]],
      ];
    }
  }
  return null;
}

// どの三角形にも入らない点: いちばん近い三角形の、p にいちばん近い点の重心座標（辺の上なので 0..1 に収まる）
function nearestTriangle(index: TriangleIndex, vertices: Vec2[], p: Vec2): Weights | null {
  let best: Weights | null = null;
  let bestD2 = Infinity;
  for (const f of index.infos) {
    // 外接矩形までの距離で、明らかに遠い三角形を飛ばす
    const bx = Math.max(f.minX - p.x, 0, p.x - f.maxX);
    const by = Math.max(f.minY - p.y, 0, p.y - f.maxY);
    if (bx * bx + by * by >= bestD2) continue;
    const [i, j, k] = f.t;
    for (const [a, b] of [
      [i, j],
      [j, k],
      [k, i],
    ] as const) {
      const { t, d2 } = nearestOnSegment(p, vertices[a]!, vertices[b]!);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = [
          [a, 1 - t],
          [b, t],
        ];
      }
    }
  }
  return best;
}

function nearestVertex(vertices: Vec2[], p: Vec2): Weights {
  let best = -1;
  let bestD2 = Infinity;
  vertices.forEach((v, i) => {
    const d2 = (v.x - p.x) ** 2 + (v.y - p.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  });
  return best < 0 ? [] : [[best, 1]];
}

const pointKey = (p: Vec2) => `${p.x},${p.y}`;

// 新しい頂点ごとの重み。旧い頂点と同じ位置なら、その頂点の差分をそのまま使う
function transferWeights(oldVertices: Vec2[], oldTriangles: Triangle[], newVertices: Vec2[]): Weights[] {
  const same = new Map<string, number>();
  oldVertices.forEach((v, i) => {
    const key = pointKey(v);
    if (!same.has(key)) same.set(key, i);
  });
  let index: TriangleIndex | null = null;
  return newVertices.map((p) => {
    const exact = same.get(pointKey(p));
    if (exact !== undefined) return [[exact, 1]];
    index ??= buildIndex(oldVertices, oldTriangles);
    if (index.infos.length === 0) return nearestVertex(oldVertices, p); // 使える三角形が無い
    return containing(index, oldVertices, p) ?? nearestTriangle(index, oldVertices, p) ?? [];
  });
}

// 足りない差分は 0 とみなす
function applyWeights(weights: Weights[], deltas: Vec2[]): Vec2[] {
  return weights.map((ws) => {
    let x = 0;
    let y = 0;
    for (const [i, w] of ws) {
      const d = deltas[i];
      if (!d || w === 0) continue;
      x += d.x * w;
      y += d.y * w;
    }
    return { x, y };
  });
}

// 新しい頂点ごとに、旧いメッシュ（基準状態）で含まれる三角形を探し、重心座標で旧い差分を補間する。
// どの三角形にも入らない点は、いちばん近い三角形の重心座標（0..1 に丸める）を使う
export function transferPointDeltas(
  oldVertices: Vec2[],
  oldTriangles: [number, number, number][],
  newVertices: Vec2[],
  deltas: Vec2[],
): Vec2[] {
  return applyWeights(transferWeights(oldVertices, oldTriangles, newVertices), deltas);
}

// そのメッシュを対象にする vertices バインディングの全キーを、新しいメッシュの頂点へ転写する。
// 旧いメッシュは model の中のもの。メッシュ自体は置き換えない（呼ぶ側が続けて置き換える）
export function transferMeshKeys(model: Model, meshId: string, newMesh: Pick<Mesh, 'vertices'>): Model {
  const oldMesh = model.meshes.find((m) => m.id === meshId);
  if (!oldMesh) return model;
  const targets = (b: Binding) => b.channel === 'vertices' && b.target.type === 'mesh' && b.target.id === meshId;
  if (!model.bindings.some((b) => targets(b) && b.keys.length > 0)) return model;
  const weights = transferWeights(oldMesh.vertices, oldMesh.triangles, newMesh.vertices);
  return {
    ...model,
    bindings: model.bindings.map((b) =>
      targets(b) && b.keys.length > 0
        ? {
            ...b,
            keys: b.keys.map((k) => (Array.isArray(k.delta) ? { ...k, delta: applyWeights(weights, k.delta) } : k)),
          }
        : b,
    ),
  };
}
