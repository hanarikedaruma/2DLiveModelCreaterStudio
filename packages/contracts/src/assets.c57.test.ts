// カード57（素材のメモリ・I-003）のテスト。テストの担当は CL（実装の担当は CO）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetRepository, decodePng, type DecodedImage } from './assets';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('カード57: 素材の置き場は ImageData を持ち続けない', () => {
  it('put では画素（ImageData）を取り出さず、getImageData のときだけ取り出す', async () => {
    let reads = 0;
    const image = { width: 4, height: 2, close() {} } as unknown as ImageBitmap;
    const decode = async (): Promise<DecodedImage> => ({
      image,
      get imageData() {
        reads++;
        return { width: 4, height: 2, data: new Uint8ClampedArray(32) } as unknown as ImageData;
      },
    });
    const repo = createAssetRepository({ decode });
    await repo.put('a', new Uint8Array([1]));
    expect(reads).toBe(0);
    expect(repo.getImage('a')).toBe(image);
    expect(repo.getImageData('a')?.width).toBe(4);
    expect(reads).toBe(1);
  });

  it('既定の decodePng は、画素を要求されるまで OffscreenCanvas で取り出さない', async () => {
    const constructed: number[] = [];
    vi.stubGlobal('createImageBitmap', async () => ({ width: 3, height: 5, close() {} }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(w: number) {
          constructed.push(w);
        }
        getContext() {
          return {
            drawImage() {},
            getImageData: (_x: number, _y: number, w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4),
            }),
          };
        }
      },
    );
    const decoded = await decodePng(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(decoded.image.width).toBe(3);
    expect(constructed).toEqual([]);
    expect(decoded.imageData.height).toBe(5);
    expect(constructed).toEqual([3]);
  });
});
