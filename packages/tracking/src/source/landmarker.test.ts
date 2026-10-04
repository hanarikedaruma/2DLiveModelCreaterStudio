import { describe, expect, it, vi } from 'vitest';
import { createWithGpuFallback, defaultMediaPipeAssetUrls } from './landmarker';

describe('createWithGpuFallback', () => {
  it('GPU で作れればそれを使う', async () => {
    const create = vi.fn(async (delegate: 'GPU' | 'CPU') => delegate);
    expect(await createWithGpuFallback(create)).toBe('GPU');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('GPU で失敗したら CPU で作り直す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const create = vi.fn(async (delegate: 'GPU' | 'CPU') => {
      if (delegate === 'GPU') throw new Error('WebGL が無い');
      return delegate;
    });
    expect(await createWithGpuFallback(create)).toBe('CPU');
    expect(create.mock.calls.map((c) => c[0])).toEqual(['GPU', 'CPU']);
  });

  it('CPU でも失敗したら CPU の失敗を返す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const create = vi.fn(async (delegate: 'GPU' | 'CPU'): Promise<string> => {
      throw new Error(`${delegate} で失敗`);
    });
    await expect(createWithGpuFallback(create)).rejects.toThrow('CPU で失敗');
  });
});

describe('defaultMediaPipeAssetUrls', () => {
  it('同梱するファイル（WASM とモデル）を指す', async () => {
    // このパッケージは Node の型を入れていないので、fs は型なしで読み込む
    const fsName: string = 'node:fs';
    const urlName: string = 'node:url';
    const fs = (await import(fsName)) as { statSync(p: string): { size: number } };
    const { fileURLToPath } = (await import(urlName)) as { fileURLToPath(u: string): string };
    const urls = defaultMediaPipeAssetUrls();
    expect(urls.wasmLoaderUrl).toMatch(/vision_wasm_internal\.js$/);
    expect(urls.wasmBinaryUrl).toMatch(/vision_wasm_internal\.wasm$/);
    expect(urls.modelAssetUrl).toMatch(/face_landmarker\.task$/);
    for (const url of Object.values(urls)) {
      expect(fs.statSync(fileURLToPath(url)).size).toBeGreaterThan(100_000);
    }
  });
});
