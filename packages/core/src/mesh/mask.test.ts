import { describe, expect, it } from 'vitest';
import { dilatedOpaqueMask, orFollowingRows } from './mask';
import { makeAlpha } from './testImages';

// 0/1 の値を行ごとの文字列にする
function rowsOf(mask: { data: Uint8Array; width: number; height: number; stride: number }): string[] {
  const out: string[] = [];
  for (let y = 0; y < mask.height; y++) {
    let s = '';
    for (let x = 0; x < mask.width; x++) s += mask.data[y * mask.stride + x] ? '#' : '.';
    out.push(s);
  }
  return out;
}

// 決まった値の疑似乱数（線形合同法）
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('dilatedOpaqueMask', () => {
  it('alpha 8 以上を不透明とみなす（7 は透明）', () => {
    const image = makeAlpha(3, 1, () => false);
    image.data[3] = 7;
    image.data[7] = 8;
    image.data[11] = 255;
    expect(rowsOf(dilatedOpaqueMask(image, 0)!)).toEqual(['.##']);
  });

  it('不透明なピクセルが無ければ null', () => {
    const image = makeAlpha(4, 4, () => false);
    image.data[3] = 7;
    expect(dilatedOpaqueMask(image, 3)).toBeNull();
  });

  it('1 ピクセルを半径 2 の正方形に広げ、画像の外へは出さない', () => {
    const image = makeAlpha(6, 5, (x, y) => Math.floor(x) === 1 && Math.floor(y) === 1);
    expect(rowsOf(dilatedOpaqueMask(image, 2)!)).toEqual(['####..', '####..', '####..', '####..', '......']);
  });

  it('行の幅は 4 の倍数で、幅より右は 0', () => {
    const image = makeAlpha(5, 2, () => true);
    const mask = dilatedOpaqueMask(image, 1)!;
    expect(mask.stride).toBe(8);
    expect(Array.from(mask.data.subarray(0, 8))).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('ばらばらの画像で、総当たりの膨張と一致する', () => {
    const rand = random(7);
    for (const [w, h, r] of [
      [23, 17, 1],
      [31, 9, 3],
      [8, 40, 4],
      [50, 50, 7],
    ] as const) {
      const image = makeAlpha(w, h, () => rand() < 0.04);
      const mask = dilatedOpaqueMask(image, r);
      const expected: string[] = [];
      for (let y = 0; y < h; y++) {
        let s = '';
        for (let x = 0; x < w; x++) {
          let hit = false;
          for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r) && !hit; yy++) {
            for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r) && !hit; xx++) {
              hit = (image.data[(yy * w + xx) * 4 + 3] ?? 0) >= 8;
            }
          }
          s += hit ? '#' : '.';
        }
        expected.push(s);
      }
      if (expected.join('').includes('#')) expect(rowsOf(mask!)).toEqual(expected);
      else expect(mask).toBeNull();
    }
  });
});

describe('orFollowingRows', () => {
  it('行 p を行 p..p+count-1 の OR にする（範囲の外は 0）', () => {
    const rows = 9;
    const stride = 4;
    for (const count of [1, 2, 3, 5, 7, 8, 9]) {
      const buf = new Uint8Array(rows * stride);
      buf[2 * stride] = 1; // 行 2 の先頭
      buf[6 * stride + 3] = 1; // 行 6 の末尾
      orFollowingRows(buf, rows, stride, count);
      for (let p = 0; p < rows; p++) {
        expect(buf[p * stride]).toBe(p <= 2 && 2 <= p + count - 1 ? 1 : 0);
        expect(buf[p * stride + 3]).toBe(p <= 6 && 6 <= p + count - 1 ? 1 : 0);
      }
    }
  });
});
