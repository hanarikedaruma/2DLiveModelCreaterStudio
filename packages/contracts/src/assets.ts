import type { AssetRepository } from './index';

export interface DecodedImage {
  image: ImageBitmap;
  imageData: ImageData;
}

// PNG を createImageBitmap で画像にする。ImageData は要求されたときだけ OffscreenCanvas で取り出す。
// ImageBitmap は乗算済みアルファ（WebGL2 の描画に合わせる）。ImageData はふつうの（乗算していない）RGBA
export async function decodePng(png: Uint8Array): Promise<DecodedImage> {
  const blob = new Blob([png], { type: 'image/png' });
  const image = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
  return {
    image,
    get imageData() {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('OffscreenCanvas の 2D コンテキストを作れない');
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height);
    },
  };
}

interface Entry {
  png: Uint8Array;
  decoded: DecodedImage; // 既定の decoded は画素を持たない getter。テストの decode もそのまま使える。
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
      const decoded = await decode(png);
      const { image } = decoded;
      if (latest.get(assetId) !== png) {
        image.close?.();
        return;
      }
      latest.delete(assetId);
      entries.get(assetId)?.decoded.image.close?.();
      entries.set(assetId, { png, decoded });
      for (const l of [...listeners]) l();
    },
    getPng: (assetId) => entries.get(assetId)?.png,
    getImage: (assetId) => entries.get(assetId)?.decoded.image,
    getImageData: (assetId) => entries.get(assetId)?.decoded.imageData,
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
