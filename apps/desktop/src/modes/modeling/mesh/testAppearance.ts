// テスト用の道具（カード28）: 変形したメッシュの見た目を比べる。テストからだけ使う
import type { Mesh, Vec2 } from '@app/schema';

type Shape = Pick<Mesh, 'vertices' | 'uvs' | 'triangles'>;

// 素材の中の位置 uv が、変形後にキャンバスのどこへ行くか（uv で三角形を探して重心座標で補間）。覆っていなければ null
export function deformedAt(mesh: Shape, deltas: Vec2[] | undefined, uv: Vec2): Vec2 | null {
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.uvs[i]!;
    const b = mesh.uvs[j]!;
    const c = mesh.uvs[k]!;
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-12) continue;
    const u = ((b.x - uv.x) * (c.y - uv.y) - (b.y - uv.y) * (c.x - uv.x)) / area;
    const v = ((c.x - uv.x) * (a.y - uv.y) - (c.y - uv.y) * (a.x - uv.x)) / area;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const at = (n: number) => {
      const p = mesh.vertices[n]!;
      const d = deltas?.[n] ?? { x: 0, y: 0 };
      return { x: p.x + d.x, y: p.y + d.y };
    };
    const [pa, pb, pc] = [at(i), at(j), at(k)];
    return { x: u * pa.x + v * pb.x + w * pc.x, y: u * pa.y + v * pb.y + w * pc.y };
  }
  return null;
}

// uv の格子（n×n）のうち両方のメッシュが覆う点で、変形後の位置のずれの最大
export function appearanceError(
  before: { mesh: Shape; deltas: Vec2[] | undefined },
  after: { mesh: Shape; deltas: Vec2[] | undefined },
  n = 24,
): { max: number; samples: number } {
  let max = 0;
  let samples = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const uv = { x: (x + 0.5) / n, y: (y + 0.5) / n };
      const p = deformedAt(before.mesh, before.deltas, uv);
      const q = deformedAt(after.mesh, after.deltas, uv);
      if (!p || !q) continue;
      samples++;
      max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  return { max, samples };
}

// 素材の大きさの ImageData（node と jsdom で動くよう、普通のオブジェクトで作る）。shape が真のピクセルを不透明にする
export function alphaImage(width: number, height: number, shape: (x: number, y: number) => boolean): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (shape(x + 0.5, y + 0.5)) data[(y * width + x) * 4 + 3] = 255;
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}
