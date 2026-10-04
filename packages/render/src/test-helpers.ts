// ピクセルのテスト（*.browser.test.ts）で使う道具。ブラウザの中だけで使う
import type { DeformedModel, DrawItem, Renderer } from '@app/contracts';
import { createWebGLRenderer, type WebGLRendererOptions } from './webgl-renderer';

export type Rgba = [number, number, number, number]; // 0..255

const cleanups: (() => void)[] = [];

// afterEach で呼ぶ。作った canvas とレンダラーを片付ける（コンテキストも失わせて、数の上限に当たらないようにする）
export function cleanupAll(): void {
  for (const c of cleanups.splice(0).reverse()) c();
}

export function setup(
  width: number,
  height: number,
  options: WebGLRendererOptions = {},
): { canvas: HTMLCanvasElement; renderer: Renderer; gl: WebGL2RenderingContext } {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.appendChild(canvas);
  const renderer = createWebGLRenderer(options);
  renderer.init(canvas);
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 が無い');
  cleanups.push(() => {
    renderer.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  });
  return { canvas, renderer, gl };
}

// 描画バッファの (x, y)（左上が原点）の乗算済み RGBA。render と同じタスクの中で呼ぶ（描画バッファは残さない設定）
export function readPixel(canvas: HTMLCanvasElement, x: number, y: number): Rgba {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 が無い');
  const out = new Uint8Array(4);
  gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

// 乗算していない色で ImageBitmap を作る（createAssetRepository と同じ設定）
export function bitmap(width: number, height: number, pixel: (x: number, y: number) => Rgba): Promise<ImageBitmap> {
  const data = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.data.set(pixel(x, y), (y * width + x) * 4);
  }
  return createImageBitmap(data, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
}

export const solid = (width: number, height: number, color: Rgba) => bitmap(width, height, () => color);

// キャンバス座標の矩形に画像全体を貼る品目
export function quad(
  partId: string,
  assetId: string,
  rect: [number, number, number, number],
  extra: Partial<DrawItem> = {},
): DrawItem {
  const [x0, y0, x1, y1] = rect;
  return {
    partId,
    assetId,
    positions: new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    opacity: 1,
    blendMode: 'normal',
    mask: null,
    ...extra,
  };
}

export function model(...items: DrawItem[]): DeformedModel {
  return { items, byPartId: Object.fromEntries(items.map((i) => [i.partId, i])) };
}

// 乗算していない色 × 不透明度 → 乗算済み（0..255）
export function premul(c: Rgba, opacity = 1): Rgba {
  const a = (c[3] / 255) * opacity;
  return [c[0] * a, c[1] * a, c[2] * a, c[3] * opacity];
}

// 乗算済みの src を dst の上に重ねる（ONE, ONE_MINUS_SRC_ALPHA）
export function over(src: Rgba, dst: Rgba): Rgba {
  const k = 1 - src[3] / 255;
  return [src[0] + dst[0] * k, src[1] + dst[1] * k, src[2] + dst[2] * k, src[3] + dst[3] * k];
}

export function scale(c: Rgba, k: number): Rgba {
  return [c[0] * k, c[1] * k, c[2] * k, c[3] * k];
}

export function lerp(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

// 各チャンネルの差が tolerance 以内か。合わなければ値を並べたメッセージを返す
export function mismatch(actual: Rgba, expected: Rgba, tolerance: number, label: string): string | null {
  if (actual.every((v, i) => Math.abs(v - expected[i]!) <= tolerance)) return null;
  return `${label}: 実際 [${actual.join(', ')}] / 期待 [${expected.map((v) => v.toFixed(1)).join(', ')}]（±${tolerance}）`;
}

export const RED: Rgba = [255, 0, 0, 255];
export const GREEN: Rgba = [0, 255, 0, 255];
export const BLUE: Rgba = [0, 0, 255, 255];
export const YELLOW: Rgba = [255, 255, 0, 255];
export const WHITE: Rgba = [255, 255, 255, 255];
export const CLEAR: Rgba = [0, 0, 0, 0];
