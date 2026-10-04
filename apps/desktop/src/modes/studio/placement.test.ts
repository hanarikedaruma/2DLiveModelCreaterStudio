import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@app/schema';
import type { ViewTransform } from '@app/contracts';
import { fitFrame, modelRect, moveTransform, outputView, scaleView, zoomTransformAt } from './placement';

const toScreen = (v: ViewTransform, p: { x: number; y: number }) => ({
  x: p.x * v.scale + v.offset.x,
  y: p.y * v.scale + v.offset.y,
});

describe('出力画面での配置', () => {
  const rect = { x: 0, y: 0, width: 1000, height: 1500 };
  const size = { width: 1920, height: 1080 };

  it('倍率1・位置0では、モデルの外枠を余白 5% で収めて中央に置く', () => {
    const v = outputView(rect, { position: { x: 0, y: 0 }, scale: 1 }, size);
    expect(v.scale).toBeCloseTo((1080 / 1500) * 0.9);
    const center = toScreen(v, { x: 500, y: 750 });
    expect(center.x).toBeCloseTo(960);
    expect(center.y).toBeCloseTo(540);
    expect(toScreen(v, { x: 500, y: 0 }).y).toBeCloseTo(54);
  });

  it('position は中心を動かす量（px）、scale は大きさの倍率', () => {
    const v = outputView(rect, { position: { x: 100, y: -20 }, scale: 2 }, size);
    expect(v.scale).toBeCloseTo((1080 / 1500) * 0.9 * 2);
    const center = toScreen(v, { x: 500, y: 750 });
    expect(center.x).toBeCloseTo(1060);
    expect(center.y).toBeCloseTo(520);
  });

  it('ホイールの拡大縮小では、カーソルの下のモデルの点が動かない', () => {
    const t = { position: { x: 30, y: 40 }, scale: 1.2 };
    const at = { x: 1500, y: 300 };
    const before = outputView(rect, t, size);
    const modelPoint = { x: (at.x - before.offset.x) / before.scale, y: (at.y - before.offset.y) / before.scale };
    const zoomed = zoomTransformAt(t, size, at, 1.5);
    expect(zoomed.scale).toBeCloseTo(1.8);
    const after = toScreen(outputView(rect, zoomed, size), modelPoint);
    expect(after.x).toBeCloseTo(at.x);
    expect(after.y).toBeCloseTo(at.y);
    // 倍率には上限・下限がある
    expect(zoomTransformAt(t, size, at, 1000).scale).toBe(20);
    expect(zoomTransformAt(t, size, at, 0.0001).scale).toBe(0.05);
  });

  it('moveTransform は位置だけを足す', () => {
    expect(moveTransform({ position: { x: 1, y: 2 }, scale: 3 }, { x: 10, y: -5 })).toEqual({
      position: { x: 11, y: -3 },
      scale: 3,
    });
  });

  it('モデルの外枠は素材の元のキャンバス。素材が無ければ 1000×1000', () => {
    expect(modelRect(createEmptyProject('空'))).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });
});

describe('プレビュー・出力ウィンドウへの収め方', () => {
  it('縦横比を保って中央に収める', () => {
    expect(fitFrame({ width: 1920, height: 1080 }, 960, 1000)).toEqual({
      x: 0,
      y: 230,
      width: 960,
      height: 540,
      scale: 0.5,
    });
    expect(fitFrame({ width: 1280, height: 720 }, 0, 100).scale).toBe(0);
  });

  it('scaleView は出力画面の px の view を k 倍の画面に写す', () => {
    expect(scaleView({ scale: 2, offset: { x: 10, y: 20 } }, 0.5)).toEqual({ scale: 1, offset: { x: 5, y: 10 } });
  });
});
