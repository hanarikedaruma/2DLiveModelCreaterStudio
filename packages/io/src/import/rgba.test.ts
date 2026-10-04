import { describe, expect, it } from 'vitest';
import { coversCanvas, crop, opaqueBounds } from './rgba';
import { makeImage, pixelAt } from './testImages';

describe('opaqueBounds', () => {
  it('アルファが 0 でない画素を囲む矩形を返す', () => {
    const image = makeImage(10, 8, [255, 0, 0, 1], { x: 2, y: 3, width: 4, height: 2 });
    expect(opaqueBounds(image)).toEqual({ x: 2, y: 3, width: 4, height: 2 });
  });

  it('離れた画素もまとめて囲む', () => {
    const image = makeImage(10, 10, [0, 0, 0, 0]);
    image.data[(1 * 10 + 7) * 4 + 3] = 255;
    image.data[(8 * 10 + 2) * 4 + 3] = 10;
    expect(opaqueBounds(image)).toEqual({ x: 2, y: 1, width: 6, height: 8 });
  });

  it('すべて透明なら null', () => {
    expect(opaqueBounds(makeImage(4, 4, [255, 255, 255, 0]))).toBeNull();
  });
});

describe('crop', () => {
  it('矩形の部分を切り出す', () => {
    const image = makeImage(6, 6, [0, 0, 0, 0]);
    image.data.set([1, 2, 3, 4], (2 * 6 + 3) * 4);
    const out = crop(image, { x: 3, y: 2, width: 2, height: 3 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(3);
    expect(pixelAt(out, 0, 0)).toEqual([1, 2, 3, 4]);
    expect(pixelAt(out, 1, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe('coversCanvas', () => {
  const canvas = { width: 100, height: 100 };

  it('全体が不透明なら true', () => {
    expect(coversCanvas(makeImage(100, 100, [9, 9, 9, 255]), { x: 0, y: 0 }, canvas)).toBe(true);
  });

  it('四隅の1つが透明なら false', () => {
    const image = makeImage(100, 100, [9, 9, 9, 255]);
    image.data[(99 * 100 + 99) * 4 + 3] = 0;
    expect(coversCanvas(image, { x: 0, y: 0 }, canvas)).toBe(false);
  });

  it('四隅が不透明でも 99% 未満なら false', () => {
    const image = makeImage(100, 100, [9, 9, 9, 255]);
    // 中の 2% を透明にする
    for (let i = 0; i < 200; i++) image.data[(5000 + i) * 4 + 3] = 0;
    expect(coversCanvas(image, { x: 0, y: 0 }, canvas)).toBe(false);
    // 1% なら true
    for (let i = 0; i < 100; i++) image.data[(5000 + i) * 4 + 3] = 255;
    expect(coversCanvas(image, { x: 0, y: 0 }, canvas)).toBe(true);
  });

  it('半透明の画素は不透明に数えない', () => {
    expect(coversCanvas(makeImage(100, 100, [9, 9, 9, 254]), { x: 0, y: 0 }, canvas)).toBe(false);
  });

  it('ずらして置いた画像はキャンバスに重なる部分で判定する', () => {
    const big = makeImage(120, 120, [9, 9, 9, 255]);
    expect(coversCanvas(big, { x: -10, y: -10 }, canvas)).toBe(true);
    expect(coversCanvas(makeImage(100, 100, [9, 9, 9, 255]), { x: 5, y: 0 }, canvas)).toBe(false);
  });
});
