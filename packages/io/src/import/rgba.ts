// 8bit RGBA の画像の扱い（トリミングと不透明の判定）

// 左上から行優先、1画素4バイト（R, G, B, A）
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

// アルファが 0 でない画素を囲む最小の矩形。すべて透明なら null
export function opaqueBounds(image: RgbaImage): Rect | null {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// 矩形の部分を新しい画像として切り出す（矩形は画像の内側であること）
export function crop(image: RgbaImage, rect: Rect): RgbaImage {
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const start = ((rect.y + y) * image.width + rect.x) * 4;
    data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
  }
  return { width: rect.width, height: rect.height, data };
}

const OPAQUE_RATIO = 0.99;

// キャンバスに置いた画像が背景のように塗りつぶされているか。
// キャンバスの四隅の画素が不透明で、キャンバス全体の 99% 以上が不透明なら true
export function coversCanvas(image: RgbaImage, offset: { x: number; y: number }, canvas: Size): boolean {
  if (canvas.width <= 0 || canvas.height <= 0) return false;
  const alphaAt = (cx: number, cy: number): number => {
    const x = cx - offset.x;
    const y = cy - offset.y;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
    return image.data[(y * image.width + x) * 4 + 3] ?? 0;
  };
  const right = canvas.width - 1;
  const bottom = canvas.height - 1;
  const corners: [number, number][] = [
    [0, 0],
    [right, 0],
    [0, bottom],
    [right, bottom],
  ];
  if (!corners.every(([x, y]) => alphaAt(x, y) === 255)) return false;

  // 画像とキャンバスの重なりだけを数える
  const x0 = Math.max(0, offset.x);
  const y0 = Math.max(0, offset.y);
  const x1 = Math.min(canvas.width, offset.x + image.width);
  const y1 = Math.min(canvas.height, offset.y + image.height);
  let opaque = 0;
  for (let cy = y0; cy < y1; cy++) {
    const row = (cy - offset.y) * image.width;
    for (let cx = x0; cx < x1; cx++) {
      if (image.data[(row + cx - offset.x) * 4 + 3] === 255) opaque++;
    }
  }
  return opaque >= OPAQUE_RATIO * canvas.width * canvas.height;
}
