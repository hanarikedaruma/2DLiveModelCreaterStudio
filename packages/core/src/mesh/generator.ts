import type { MeshGenerator } from '@app/contracts';
import type { Vec2 } from '@app/schema';
import { fillImageCorners, removeCollinear, traceContours } from './contour';
import { interiorGridPoints } from './grid';
import { dilatedOpaqueMask } from './mask';
import { simplifyContours, subdivideContour } from './simplify';
import { triangulateContours } from './triangulate';

export type MeshDensityLevel = 'light' | 'standard' | 'smooth';

export interface MeshDensitySettings {
  tolerance: number; // 輪郭の単純化の許容誤差（px）
  spacing: number; // 内部の格子点の間隔（px）。輪郭の辺もこの長さ以下に分ける
  // 単純化の前に不透明部分を広げる幅（px）。ceil(tolerance) + 1 にすると、単純化で輪郭が内へ寄っても
  // 不透明なピクセルは四角ごと輪郭の内側に残る（描くときに縁が欠けない）
  margin: number;
}

export const MESH_DENSITY_SETTINGS: Record<MeshDensityLevel, MeshDensitySettings> = {
  light: { tolerance: 6, spacing: 80, margin: 7 },
  standard: { tolerance: 3, spacing: 48, margin: 4 },
  smooth: { tolerance: 1.5, spacing: 28, margin: 3 },
};

type GeneratedMesh = ReturnType<MeshGenerator['generate']>;

// 画像全体を覆う四角形（三角形2枚）
function rectangleMesh(width: number, height: number, offset: Vec2): GeneratedMesh {
  return {
    vertices: [
      { x: offset.x, y: offset.y },
      { x: offset.x + width, y: offset.y },
      { x: offset.x + width, y: offset.y + height },
      { x: offset.x, y: offset.y + height },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

// 素材の不透明部分（alpha ≥ 8）を覆うメッシュを作る。頂点はキャンバス座標（画像の中の位置 + offset）、uvs は画像の中の位置 ÷ 画像サイズ
export function generateMesh(alpha: ImageData, offset: Vec2, density: MeshDensityLevel): GeneratedMesh {
  const { width, height } = alpha;
  const { tolerance, spacing, margin } = MESH_DENSITY_SETTINGS[density];
  // 不透明部分を margin だけ広げておく（単純化で削れても、元の不透明なピクセルは輪郭の内側に残る）
  const mask = width > 0 && height > 0 ? dilatedOpaqueMask(alpha, margin) : null;
  if (!mask) return rectangleMesh(width, height, offset);

  // 輪郭（外側・穴・島）→ 単純化（交わるものは許容誤差を下げてやり直す）→ 長い辺を分ける
  const traced = traceContours(mask).map((c) => removeCollinear(fillImageCorners(c, width, height)));
  const simplified = simplifyContours(traced, tolerance, width, height);
  const outlines = simplified.map((c) => subdivideContour(c, spacing));
  const inner = interiorGridPoints(simplified, width, height, spacing);
  const { points, triangles } = triangulateContours(outlines, inner);
  if (triangles.length === 0) return rectangleMesh(width, height, offset);

  return {
    vertices: points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
    uvs: points.map((p) => ({ x: p.x / width, y: p.y / height })),
    triangles,
  };
}

export function createMeshGenerator(): MeshGenerator {
  return { generate: generateMesh };
}
