import { describe, expect, it } from 'vitest';
import { coverUv, cssToPixelRatio, drawingBufferSize, fitTextureSize, maskKey, viewToClip } from './geometry';

describe('drawingBufferSize', () => {
  it('CSS の大きさ × devicePixelRatio にする（端数は四捨五入）', () => {
    expect(drawingBufferSize({ width: 100, height: 50 }, 2, { width: 300, height: 150 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(drawingBufferSize({ width: 101, height: 33 }, 1.25, { width: 1, height: 1 })).toEqual({
      width: 126,
      height: 41,
    });
  });

  it('CSS の大きさが 0 なら今の大きさのまま', () => {
    expect(drawingBufferSize({ width: 0, height: 0 }, 2, { width: 64, height: 32 })).toEqual({ width: 64, height: 32 });
  });

  it('devicePixelRatio が変な値なら 1 として扱う', () => {
    expect(drawingBufferSize({ width: 10, height: 20 }, NaN, { width: 1, height: 1 })).toEqual({
      width: 10,
      height: 20,
    });
  });
});

describe('viewToClip', () => {
  const expectClip = (c: ReturnType<typeof viewToClip>, x: number, y: number, expected: [number, number]) => {
    expect(x * c.scale[0] + c.offset[0]).toBeCloseTo(expected[0], 12);
    expect(y * c.scale[1] + c.offset[1]).toBeCloseTo(expected[1], 12);
  };

  it('画面座標（CSS ピクセル）= キャンバス座標 × scale + offset をクリップ座標にする', () => {
    const c = viewToClip({ scale: 2, offset: { x: 10, y: 20 } }, { x: 1, y: 1 }, { width: 200, height: 100 });
    // キャンバス (0, 0) → 画面 (10, 20)
    expectClip(c, 0, 0, [10 / 100 - 1, 1 - 20 / 50]);
    // キャンバス (95, 40) → 画面 (200, 100) = 右下
    expectClip(c, 95, 40, [1, -1]);
  });

  it('CSS ピクセルと描画バッファの比を掛ける', () => {
    // CSS 100×50、描画バッファ 200×100（devicePixelRatio 2）。キャンバス (100, 50) → 画面の右下
    const ratio = cssToPixelRatio({ width: 100, height: 50 }, { width: 200, height: 100 });
    expect(ratio).toEqual({ x: 2, y: 2 });
    const c = viewToClip({ scale: 1, offset: { x: 0, y: 0 } }, ratio, { width: 200, height: 100 });
    expectClip(c, 100, 50, [1, -1]);
    expectClip(c, 50, 25, [0, 0]);
  });

  it('CSS の大きさが 0 なら比は 1', () => {
    expect(cssToPixelRatio({ width: 0, height: 0 }, { width: 64, height: 32 })).toEqual({ x: 1, y: 1 });
  });
});

describe('coverUv', () => {
  it('横長の画像は左右を同じだけ切る', () => {
    expect(coverUv({ width: 400, height: 100 }, { width: 200, height: 100 })).toEqual({
      u0: 0.25,
      v0: 0,
      u1: 0.75,
      v1: 1,
    });
  });

  it('縦長の画像は上下を同じだけ切る', () => {
    expect(coverUv({ width: 100, height: 400 }, { width: 100, height: 100 })).toEqual({
      u0: 0,
      v0: 0.375,
      u1: 1,
      v1: 0.625,
    });
  });

  it('縦横比が同じならそのまま', () => {
    expect(coverUv({ width: 50, height: 25 }, { width: 200, height: 100 })).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
  });

  it('大きさが 0 なら全体', () => {
    expect(coverUv({ width: 0, height: 0 }, { width: 200, height: 100 })).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
  });
});

describe('fitTextureSize', () => {
  it('上限に収まるならそのまま', () => {
    expect(fitTextureSize({ width: 4096, height: 100 }, 4096)).toEqual({ width: 4096, height: 100 });
  });

  it('超えるなら縦横比を保って縮める', () => {
    expect(fitTextureSize({ width: 8192, height: 2048 }, 4096)).toEqual({ width: 4096, height: 1024 });
    expect(fitTextureSize({ width: 3000, height: 9000 }, 4096)).toEqual({ width: 1365, height: 4096 });
  });

  it('細い画像でも 1 ピクセルは残す', () => {
    expect(fitTextureSize({ width: 100000, height: 1 }, 16384)).toEqual({ width: 16384, height: 1 });
  });
});

describe('maskKey', () => {
  it('並びと重複によらず同じ組なら同じ値', () => {
    expect(maskKey(['b', 'a', 'b'])).toBe(maskKey(['a', 'b']));
    expect(maskKey(['a'])).not.toBe(maskKey(['a', 'b']));
  });
});
