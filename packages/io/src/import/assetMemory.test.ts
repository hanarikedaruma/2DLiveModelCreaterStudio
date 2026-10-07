// カード57の実装担当 CO の回帰テスト。既定の素材の置き場が画素を保持しないことを確かめる。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetRepository } from '@app/contracts';

afterEach(() => vi.unstubAllGlobals());
describe('素材の画素の寿命（カード57）', () => {
  it('put は ImageBitmap だけを作り、ImageData は要求するたびに取り出す', async () => {
    const bitmap = { width: 2, height: 1, close: vi.fn() };
    const read = vi.fn(() => ({ width: 2, height: 1, data: new Uint8ClampedArray(8) }));
    const canvas = vi.fn(function () {
      return { getContext: () => ({ drawImage: vi.fn(), getImageData: read }) };
    });
    vi.stubGlobal('OffscreenCanvas', canvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const repo = createAssetRepository();
    await repo.put('image', new Uint8Array([1]));
    expect(repo.getImage('image')).toBe(bitmap);
    expect(read).not.toHaveBeenCalled();
    expect(canvas).not.toHaveBeenCalled();
    const first = repo.getImageData('image');
    const second = repo.getImageData('image');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(read).toHaveBeenCalledTimes(2);
    expect(repo.getImageData('unknown')).toBeUndefined();
  });
});
