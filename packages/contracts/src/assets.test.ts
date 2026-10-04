import { describe, expect, it, vi } from 'vitest';
import { createAssetRepository, type DecodedImage } from './assets';

function fakeDecode(png: Uint8Array): Promise<DecodedImage> {
  const close = vi.fn();
  return Promise.resolve({
    image: { width: png.length, height: 1, close } as unknown as ImageBitmap,
    imageData: { width: png.length, height: 1, data: new Uint8ClampedArray(png.length * 4) } as unknown as ImageData,
  });
}

describe('createAssetRepository', () => {
  it('put で PNG・画像・ImageData を保持し、通知する', async () => {
    const repo = createAssetRepository({ decode: fakeDecode });
    const listener = vi.fn();
    const off = repo.subscribe(listener);
    const png = new Uint8Array([1, 2, 3]);
    await repo.put('a1', png);
    expect(repo.getPng('a1')).toBe(png);
    expect(repo.getImage('a1')!.width).toBe(3);
    expect(repo.getImageData('a1')!.width).toBe(3);
    expect(repo.all()).toEqual({ a1: png });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await repo.put('a2', new Uint8Array([1]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repo.getPng('none')).toBeUndefined();
  });

  it('同じ id の置き換えでは前の画像を閉じる', async () => {
    const repo = createAssetRepository({ decode: fakeDecode });
    await repo.put('a1', new Uint8Array([1]));
    const old = repo.getImage('a1')!;
    await repo.put('a1', new Uint8Array([1, 2]));
    expect(old.close).toHaveBeenCalled();
    expect(repo.getImage('a1')!.width).toBe(2);
  });

  it('続けて put したときは後から呼んだほうが残る', async () => {
    let release: () => void = () => {};
    const slow = (png: Uint8Array) =>
      new Promise<DecodedImage>((resolve) => {
        release = () => void fakeDecode(png).then(resolve);
      });
    const repo = createAssetRepository({
      decode: (png) => (png.length === 1 ? slow(png) : fakeDecode(png)),
    });
    const first = repo.put('a1', new Uint8Array([1]));
    await repo.put('a1', new Uint8Array([1, 2]));
    release();
    await first;
    expect(repo.getPng('a1')!.length).toBe(2);
  });
});
