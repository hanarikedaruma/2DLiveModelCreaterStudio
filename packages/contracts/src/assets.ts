import type { AssetRepository } from './index';

export interface DecodedImage {
  image: ImageBitmap;
  imageData: ImageData;
}

// PNG を createImageBitmap で画像にし、ImageData は OffscreenCanvas で取り出す。
// ImageBitmap は乗算済みアルファ（WebGL2 の描画に合わせる）。ImageData はふつうの（乗算していない）RGBA
export async function decodePng(png: Uint8Array): Promise<DecodedImage> {
  const blob = new Blob([png], { type: 'image/png' });
  const image = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas の 2D コンテキストを作れない');
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  return { image, imageData };
}

interface Entry {
  png: Uint8Array;
  image: ImageBitmap;
  imageData: ImageData;
}

// decode はテストで差し替えるためのもの。省略すると decodePng を使う
export function createAssetRepository(
  options: { decode?: (png: Uint8Array) => Promise<DecodedImage> } = {},
): AssetRepository {
  const decode = options.decode ?? decodePng;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  // 同じ id を続けて put したとき、後から呼んだほうを残す
  const latest = new Map<string, Uint8Array>();

  return {
    async put(assetId, png) {
      latest.set(assetId, png);
      const { image, imageData } = await decode(png);
      if (latest.get(assetId) !== png) {
        image.close?.();
        return;
      }
      latest.delete(assetId);
      entries.get(assetId)?.image.close?.();
      entries.set(assetId, { png, image, imageData });
      for (const l of [...listeners]) l();
    },
    getPng: (assetId) => entries.get(assetId)?.png,
    getImage: (assetId) => entries.get(assetId)?.image,
    getImageData: (assetId) => entries.get(assetId)?.imageData,
    all() {
      const out: Record<string, Uint8Array> = {};
      for (const [id, e] of entries) out[id] = e.png;
      return out;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
