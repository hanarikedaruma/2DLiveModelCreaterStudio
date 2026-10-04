// テスト用の画像を作る（テストからだけ使う）
import type { RgbaImage } from './rgba';

export type Rgba = [number, number, number, number];

// 透明な画像の中に、色を塗った矩形を置く（rect が無ければ全体を塗る）
export function makeImage(
  width: number,
  height: number,
  color: Rgba,
  rect: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width, height },
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      data.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

// ag-psd に渡す形（Uint8ClampedArray）にする
export function toPixelData(image: RgbaImage): { width: number; height: number; data: Uint8ClampedArray } {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

export function pixelAt(image: RgbaImage, x: number, y: number): Rgba {
  const i = (y * image.width + x) * 4;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, image.data[i + 3]!];
}
