// 輪郭線を絵につける（I-068）。線の点は素材の画像の中の位置（UV）なので、UV の上でその点を含む三角形と
// 重心座標を求め、その姿勢の頂点の位置から表示の位置を出す。キーで形が変わっても、メッシュを作り直しても、
// 線は絵の同じ所について動く。どの三角形にも入らない点は、いちばん近い三角形の重心座標（外では負になる）を
// そのまま使い、その三角形を外へ平らに延ばした位置にする
import type { Mesh, Vec2 } from '@app/schema';
import { contourBasis, type ContourBasis } from './spline';

export interface MeshAttachment {
  indices: [number, number, number];
  weights: [number, number, number];
}

const EPS = 1e-12;

function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] | null {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < EPS) return null;
  const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
  const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
  return [u, v, 1 - u - v];
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy;
  const t = len < EPS ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// points（UV か表示の位置）の上で p を含む三角形。無ければいちばん近い三角形。三角形が無ければ null
export function attachPoint(
  points: readonly Vec2[],
  triangles: readonly (readonly [number, number, number])[],
  p: Vec2,
): MeshAttachment | null {
  let best: MeshAttachment | null = null;
  let bestDistance = Infinity;
  for (const t of triangles) {
    const a = points[t[0]],
      b = points[t[1]],
      c = points[t[2]];
    if (!a || !b || !c) continue;
    const w = barycentric(p, a, b, c);
    if (!w) continue;
    if (w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9) return { indices: [t[0], t[1], t[2]], weights: w };
    const d = Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
    if (d < bestDistance) {
      bestDistance = d;
      best = { indices: [t[0], t[1], t[2]], weights: w };
    }
  }
  return best;
}

// つけた点のその姿勢での位置。positions は頂点の位置（Vec2 の配列か [x0, y0, …]）
export function attachedPoint(a: MeshAttachment, positions: readonly Vec2[] | ArrayLike<number>): Vec2 {
  let x = 0,
    y = 0;
  for (let k = 0; k < 3; k++) {
    const i = a.indices[k]!,
      w = a.weights[k]!;
    if (isVecArray(positions)) {
      x += positions[i]!.x * w;
      y += positions[i]!.y * w;
    } else {
      x += positions[i * 2]! * w;
      y += positions[i * 2 + 1]! * w;
    }
  }
  return { x, y };
}

function isVecArray(p: readonly Vec2[] | ArrayLike<number>): p is readonly Vec2[] {
  return p.length > 0 && typeof p[0] === 'object';
}

export interface ContourOnMesh {
  basis: ContourBasis; // 曲線のサンプルの重み（点の UV に掛ける）
  sampleUvs: Vec2[]; // 絵の上の線（サンプルの UV）
  samples: MeshAttachment[]; // サンプルのつけ方
  handles: MeshAttachment[]; // 点のつけ方
}

const cache = new WeakMap<object, WeakMap<object, ContourOnMesh | null>>();

// 線をメッシュにつける。size は素材のピクセルの大きさ（区間の長さとサンプルの間隔を絵の上で決める）。
// メッシュと点の配列が同じなら前の結果を使う。三角形が無ければ null
export function contourOnMesh(
  mesh: Pick<Mesh, 'uvs' | 'triangles'>,
  points: readonly Vec2[],
  size: { width: number; height: number },
): ContourOnMesh | null {
  let byPoints = cache.get(mesh);
  if (!byPoints) cache.set(mesh, (byPoints = new WeakMap()));
  const known = byPoints.get(points);
  if (known !== undefined && (known === null || sameSize(known, size))) return known;
  const result = build(mesh, points, size);
  byPoints.set(points, result);
  return result;
}

const sizes = new WeakMap<ContourOnMesh, string>();
const sameSize = (c: ContourOnMesh, size: { width: number; height: number }) =>
  sizes.get(c) === `${size.width}x${size.height}`;

function build(
  mesh: Pick<Mesh, 'uvs' | 'triangles'>,
  points: readonly Vec2[],
  size: { width: number; height: number },
): ContourOnMesh | null {
  if (points.length < 2 || mesh.triangles.length === 0) return null;
  const layout = points.map((p) => ({ x: p.x * size.width, y: p.y * size.height }));
  const basis = contourBasis(layout);
  const sampleUvs = basis.weights.map((w) => {
    let x = 0,
      y = 0;
    for (let k = 0; k < basis.count; k++) {
      x += w[k]! * points[k]!.x;
      y += w[k]! * points[k]!.y;
    }
    return { x, y };
  });
  const samples: MeshAttachment[] = [];
  for (const uv of sampleUvs) {
    const a = attachPoint(mesh.uvs, mesh.triangles, uv);
    if (!a) return null;
    samples.push(a);
  }
  const handles: MeshAttachment[] = [];
  for (const uv of points) {
    const a = attachPoint(mesh.uvs, mesh.triangles, uv);
    if (!a) return null;
    handles.push(a);
  }
  const result = { basis, sampleUvs, samples, handles };
  sizes.set(result, `${size.width}x${size.height}`);
  return result;
}
