import type { Asset } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { rectBottomCenter, rectCenter, rectOfAsset, rectOfPoints, rectTopCenter, unionRects } from './bounds';

const asset: Asset = {
  id: 'a',
  path: 'assets/a.png',
  hash: '',
  width: 40,
  height: 20,
  offset: { x: 10, y: 30 },
  canvasSize: { width: 100, height: 100 },
  source: { kind: 'png', file: 'a.png' },
  sourceBlendMode: 'normal',
  sourceOpacity: 1,
};

describe('矩形', () => {
  it('素材の外接矩形は offset と幅・高さ', () => {
    expect(rectOfAsset(asset)).toEqual({ x: 10, y: 30, width: 40, height: 20 });
  });

  it('点の外接矩形。点が無ければ null', () => {
    expect(
      rectOfPoints([
        { x: 3, y: 8 },
        { x: -1, y: 2 },
        { x: 5, y: 4 },
      ]),
    ).toEqual({ x: -1, y: 2, width: 6, height: 6 });
    expect(rectOfPoints([])).toBeNull();
  });

  it('矩形をまとめる。null は飛ばす', () => {
    expect(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, null, { x: 20, y: 5, width: 5, height: 20 }])).toEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });
    expect(unionRects([null, undefined])).toBeNull();
  });

  it('中心・上端中央・下端中央', () => {
    const r = { x: 10, y: 30, width: 40, height: 20 };
    expect(rectCenter(r)).toEqual({ x: 30, y: 40 });
    expect(rectTopCenter(r)).toEqual({ x: 30, y: 30 });
    expect(rectBottomCenter(r)).toEqual({ x: 30, y: 50 });
  });
});
