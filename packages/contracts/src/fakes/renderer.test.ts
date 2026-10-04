import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../index';
import { FakeRenderer } from './renderer';

// 呼ばれた描画命令を記録する 2D コンテキストの代わり
function fakeCanvas(width: number, clientWidth: number) {
  const calls: unknown[][] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    setTransform: (...a: unknown[]) => calls.push(['setTransform', ...a]),
    clearRect: (...a: unknown[]) => calls.push(['clearRect', ...a]),
    fillRect: (...a: unknown[]) => calls.push(['fillRect', ctx.fillStyle, ...a]),
    drawImage: (...a: unknown[]) => calls.push(['drawImage', ctx.globalAlpha, ...a]),
  };
  const canvas = { width, height: width, clientWidth, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

function item(partId: string, assetId: string, positions: number[], opacity = 1): DrawItem {
  return {
    partId,
    assetId,
    positions: new Float32Array(positions),
    uvs: new Float32Array(8),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    opacity,
    blendMode: 'normal',
    mask: null,
  };
}

describe('FakeRenderer', () => {
  it('各 DrawItem の画像を頂点の外接矩形に drawImage する', () => {
    const { canvas, calls } = fakeCanvas(200, 100); // 実ピクセルは CSS の 2 倍
    const r = new FakeRenderer();
    r.init(canvas);
    const img = { width: 1 } as ImageBitmap;
    r.setTextures({ a1: img });
    const items = [item('p1', 'a1', [10, 20, 30, 20, 30, 60, 10, 60], 0.5), item('p2', 'none', [0, 0, 1, 1])];
    r.render({ items, byPartId: {} }, { scale: 2, offset: { x: 5, y: 6 } }, { type: 'color', color: '#00ff00' });
    expect(calls).toEqual([
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['clearRect', 0, 0, 200, 200],
      ['fillRect', '#00ff00', 0, 0, 200, 200],
      ['setTransform', 4, 0, 0, 4, 10, 12],
      ['drawImage', 0.5, img, 10, 20, 20, 40],
    ]);
  });

  it('init の前の render はエラー', () => {
    expect(() =>
      new FakeRenderer().render(
        { items: [], byPartId: {} },
        { scale: 1, offset: { x: 0, y: 0 } },
        { type: 'transparent' },
      ),
    ).toThrow();
  });
});
