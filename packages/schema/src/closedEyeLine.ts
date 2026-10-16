import type { ClosedEyeLine, Mesh, Model, Vec2 } from './types';
import { partAffine, transformVec } from './geometryAffine';
import { applyWarp } from './geometryWarp';

// 三角形上の位置を別の座標（UV / 表示位置）へ移す。外側は最も近い三角形の平面で延長する。
export function mapMeshPoint(
  mesh: Pick<Mesh, 'triangles'>,
  from: readonly Vec2[],
  to: readonly Vec2[],
  point: Vec2,
): Vec2 | null {
  let best: Vec2 | null = null;
  let distance = Infinity;
  for (const [i, j, k] of mesh.triangles) {
    const a = from[i],
      b = from[j],
      c = from[k];
    if (!a || !b || !c || !to[i] || !to[j] || !to[k]) continue;
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / det;
    const v = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / det;
    const w = 1 - u - v;
    const mapped = { x: to[i]!.x * u + to[j]!.x * v + to[k]!.x * w, y: to[i]!.y * u + to[j]!.y * v + to[k]!.y * w };
    if (Math.min(u, v, w) >= -1e-9) return mapped;
    const d = Math.min(
      ...[
        [a, b],
        [b, c],
        [c, a],
      ].map(([p, q]) => {
        const dx = q!.x - p!.x,
          dy = q!.y - p!.y;
        const t = Math.max(
          0,
          Math.min(1, ((point.x - p!.x) * dx + (point.y - p!.y) * dy) / Math.max(1e-12, dx * dx + dy * dy)),
        );
        return Math.hypot(point.x - p!.x - t * dx, point.y - p!.y - t * dy);
      }),
    );
    if (d < distance) {
      distance = d;
      best = mapped;
    }
  }
  return best;
}

// 旧版の線は基準姿勢のモデル座標。キーを加える前の表示三角形からUVへ移す。
export function baseMeshPositions(model: Model, partId: string, vertices: readonly Vec2[]): Vec2[] {
  let points = vertices.map((p) => ({ ...p }));
  let part = model.parts.find((p) => p.id === partId);
  const seen = new Set<string>();
  while (part && !seen.has(part.id)) {
    seen.add(part.id);
    const buffer = new Float64Array(points.flatMap((p) => [p.x, p.y]));
    for (const warp of model.warps.filter((w) => w.partId === part!.id)) applyWarp(buffer, warp, undefined);
    const affine = partAffine(part, undefined);
    points = points.map((_, i) => transformVec(affine, { x: buffer[i * 2]!, y: buffer[i * 2 + 1]! }));
    part = model.parts.find((p) => p.id === part!.parentId);
  }
  return points;
}

export function attachClosedEyeLine(model: Model, side: 'L' | 'R', points: Vec2[]): ClosedEyeLine {
  for (const type of [`eyeWhite${side}`, `upperLid${side}`]) {
    const part = model.parts.find((p) => p.kind === 'image' && p.standardType === type && p.meshId !== null);
    const mesh = model.meshes.find((m) => m.id === part?.meshId);
    if (!part || !mesh) continue;
    const display = baseMeshPositions(model, part.id, mesh.vertices);
    const uvs = points.map((p) => mapMeshPoint(mesh, display, mesh.uvs, p));
    if (uvs.every((p): p is Vec2 => p !== null)) return { partId: part.id, points: uvs };
  }
  // メッシュ未生成でも旧データを捨てない。UIで理由を表示し、生成後に付け直す。
  return { partId: null, points };
}
