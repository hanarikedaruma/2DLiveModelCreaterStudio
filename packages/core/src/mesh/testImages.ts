// テスト用の画像と、メッシュが点を覆うかの数え上げ（node で動くよう、ImageData は普通のオブジェクトで作る）
import type { Vec2 } from '@app/schema';

export type Shape = (x: number, y: number) => boolean;

// shape が真のピクセル（中心で判定）を alpha=255、それ以外を 0 にする
export function makeAlpha(width: number, height: number, shape: Shape): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (shape(x + 0.5, y + 0.5)) data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

// 縁がなめらかに薄くなる円（alpha は中心からの距離で 0..255）
export function makeSoftDisc(width: number, height: number, cx: number, cy: number, r: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      data[(y * width + x) * 4 + 3] = Math.round(Math.min(1, Math.max(0, r - d + 0.5)) * 255);
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

export const disc =
  (cx: number, cy: number, r: number): Shape =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

export const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

export const union =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((s) => s(x, y));

export const minus =
  (shape: Shape, ...holes: Shape[]): Shape =>
  (x, y) =>
    shape(x, y) && !holes.some((h) => h(x, y));

// 画像の中の位置の点 (x + sx, y + sy)（x = 0..width-1, y = 0..height-1）が、いくつの三角形に入るか。
// strict なら辺の上は数えない（重なりを調べる用）。vertices はキャンバス座標なので offset を引いて使う
export function countCoverage(
  mesh: { vertices: Vec2[]; triangles: [number, number, number][] },
  width: number,
  height: number,
  offset: Vec2,
  sx: number,
  sy: number,
  strict = false,
): Uint8Array {
  const counts = new Uint8Array(width * height);
  const eps = strict ? -1e-9 : 1e-9;
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.vertices[i]!;
    const b = mesh.vertices[j]!;
    const c = mesh.vertices[k]!;
    const ax = a.x - offset.x;
    const ay = a.y - offset.y;
    const bx = b.x - offset.x;
    const by = b.y - offset.y;
    const cx = c.x - offset.x;
    const cy = c.y - offset.y;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - sx - 1e-6));
    const x1 = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) - sx + 1e-6));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - sy - 1e-6));
    const y1 = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - sy + 1e-6));
    for (let y = y0; y <= y1; y++) {
      const py = y + sy;
      for (let x = x0; x <= x1; x++) {
        const px = x + sx;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -eps && w1 >= -eps && w2 >= -eps) counts[y * width + x]! += 1;
      }
    }
  }
  return counts;
}

// 不透明なピクセル（alpha ≥ 8）のうち、中心が三角形に入るものの割合
export function opaqueCoverage(
  mesh: { vertices: Vec2[]; triangles: [number, number, number][] },
  image: ImageData,
  offset: Vec2,
): { opaque: number; covered: number; ratio: number } {
  const counts = countCoverage(mesh, image.width, image.height, offset, 0.5, 0.5);
  let opaque = 0;
  let covered = 0;
  for (let i = 0; i < counts.length; i++) {
    if ((image.data[i * 4 + 3] ?? 0) < 8) continue;
    opaque++;
    if (counts[i]! > 0) covered++;
  }
  return { opaque, covered, ratio: opaque === 0 ? 1 : covered / opaque };
}
