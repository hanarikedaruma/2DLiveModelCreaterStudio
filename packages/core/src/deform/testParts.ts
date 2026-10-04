// テスト用のパーツとメッシュ（テストからだけ使う）
import type { Mesh, Part, Vec2 } from '@app/schema';

export function imagePart(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: `asset-${id}`,
    meshId: `mesh-${id}`,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}

export function groupPart(id: string, patch: Partial<Part> = {}): Part {
  return imagePart(id, { kind: 'group', assetId: null, meshId: null, ...patch });
}

// 頂点を指定したメッシュ。uv は頂点の順に (i, i/10) のような値を入れ、三角形は扇形に張る
export function meshOf(id: string, vertices: Vec2[]): Mesh {
  const triangles: [number, number, number][] = [];
  for (let i = 1; i + 1 < vertices.length; i++) triangles.push([0, i, i + 1]);
  return {
    id,
    vertices,
    uvs: vertices.map((_, i) => ({ x: i / 10, y: 1 - i / 10 })),
    triangles,
    density: 'custom',
    edited: false,
  };
}

// 左上 (x, y)、幅 w・高さ h の四角形のメッシュ
export function rectMesh(id: string, x: number, y: number, w: number, h: number): Mesh {
  return meshOf(id, [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);
}

export function pairs(points: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < points.length; k += 2) out.push([points[k]!, points[k + 1]!]);
  return out;
}
