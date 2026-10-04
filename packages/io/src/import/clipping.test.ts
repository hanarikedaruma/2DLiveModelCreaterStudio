import { describe, expect, it } from 'vitest';
import type { BlendMode } from '@app/schema';
import { clipToBase, mergeClipped } from './clipping';
import { makeImage, pixelAt, type Rgba } from './testImages';

// 1画素の重なり方を確かめるための参照の式（0..255、乗算していない色）
function expected(base: Rgba, layer: Rgba, opacity: number, mode: BlendMode): Rgba {
  const ab = base[3] / 255;
  const as = (layer[3] / 255) * opacity;
  const blend = (b: number, s: number) =>
    mode === 'multiply' ? b * s : mode === 'screen' ? b + s - b * s : mode === 'add' ? Math.min(1, b + s) : s;
  const c = (i: number) => {
    const b = base[i]! / 255;
    const s = layer[i]! / 255;
    return Math.round((as * ((1 - ab) * s + ab * blend(b, s)) + (1 - as) * b) * 255);
  };
  return [c(0), c(1), c(2), base[3]];
}

const BASE: Rgba = [200, 100, 50, 255];
const LAYER: Rgba = [40, 160, 220, 255];

describe('mergeClipped', () => {
  it('通常・乗算・スクリーン・加算で重ね、不透明度を掛ける', () => {
    for (const mode of ['normal', 'multiply', 'screen', 'add'] satisfies BlendMode[]) {
      for (const opacity of [1, 0.5]) {
        const out = mergeClipped({ left: 0, top: 0, image: makeImage(1, 1, BASE) }, [
          { left: 0, top: 0, image: makeImage(1, 1, LAYER), opacity, blendMode: mode },
        ]);
        expect(pixelAt(out, 0, 0), `${mode} × ${opacity}`).toEqual(expected(BASE, LAYER, opacity, mode));
      }
    }
    // 具体的な値（不透明）: 通常は上の色、乗算は 200·40/255 ≒ 31、スクリーンは 200 + 40 − 31 = 209、加算は 240
    const one = (mode: BlendMode) =>
      pixelAt(
        mergeClipped({ left: 0, top: 0, image: makeImage(1, 1, BASE) }, [
          { left: 0, top: 0, image: makeImage(1, 1, LAYER), opacity: 1, blendMode: mode },
        ]),
        0,
        0,
      );
    expect(one('normal')).toEqual([40, 160, 220, 255]);
    expect(one('multiply')).toEqual([31, 63, 43, 255]);
    expect(one('screen')).toEqual([209, 197, 227, 255]);
    expect(one('add')).toEqual([240, 255, 255, 255]);
  });

  it('アルファはクリップ先のまま。クリップ先の外（透明なところ）には重ねない', () => {
    // クリップ先は 3×1 の左2画素だけ。左は不透明、中は半透明
    const base = makeImage(3, 1, BASE, { x: 0, y: 0, width: 1, height: 1 });
    base.data.set([200, 100, 50, 128], 4);
    const out = mergeClipped({ left: 10, top: 5, image: base }, [
      { left: 10, top: 5, image: makeImage(3, 1, LAYER), opacity: 1, blendMode: 'multiply' },
    ]);
    expect([out.width, out.height]).toEqual([3, 1]);
    expect(pixelAt(out, 0, 0)).toEqual(expected(BASE, LAYER, 1, 'multiply'));
    // 半透明のクリップ先では、上の色と合成の結果をクリップ先のアルファで混ぜる
    expect(pixelAt(out, 1, 0)).toEqual(expected([200, 100, 50, 128], LAYER, 1, 'multiply'));
    expect(pixelAt(out, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('重なる範囲だけに重ねる（位置のずれ・はみ出し）。半透明の上のレイヤーはアルファも掛ける', () => {
    const base = makeImage(4, 4, BASE);
    const half: Rgba = [40, 160, 220, 128];
    // 上のレイヤーはクリップ先より左上に 2 ずれた 4×4。重なるのはクリップ先の左上 2×2
    const out = mergeClipped({ left: 100, top: 100, image: base }, [
      { left: 98, top: 98, image: makeImage(4, 4, half), opacity: 1, blendMode: 'normal' },
    ]);
    expect(pixelAt(out, 1, 1)).toEqual(expected(BASE, half, 1, 'normal'));
    expect(pixelAt(out, 2, 1)).toEqual(BASE);
    expect(pixelAt(out, 1, 2)).toEqual(BASE);
    expect(pixelAt(out, 3, 3)).toEqual(BASE);
  });

  it('複数のレイヤーを背面から順に重ねる', () => {
    const second: Rgba = [255, 255, 255, 255];
    const out = mergeClipped({ left: 0, top: 0, image: makeImage(1, 1, BASE) }, [
      { left: 0, top: 0, image: makeImage(1, 1, LAYER), opacity: 1, blendMode: 'normal' },
      { left: 0, top: 0, image: makeImage(1, 1, second), opacity: 0.5, blendMode: 'multiply' },
    ]);
    // 1枚目で LAYER になり、2枚目の白の乗算は色を変えない
    expect(pixelAt(out, 0, 0)).toEqual(LAYER);
    // 順を入れ替えると、白の乗算のあとに LAYER で覆われる
    const reversed = mergeClipped({ left: 0, top: 0, image: makeImage(1, 1, BASE) }, [
      { left: 0, top: 0, image: makeImage(1, 1, second), opacity: 0.5, blendMode: 'multiply' },
      { left: 0, top: 0, image: makeImage(1, 1, LAYER), opacity: 0.5, blendMode: 'normal' },
    ]);
    expect(pixelAt(reversed, 0, 0)).toEqual(expected(BASE, LAYER, 0.5, 'normal'));
  });

  it('元の画像を書き換えない', () => {
    const base = makeImage(1, 1, BASE);
    mergeClipped({ left: 0, top: 0, image: base }, [
      { left: 0, top: 0, image: makeImage(1, 1, LAYER), opacity: 1, blendMode: 'normal' },
    ]);
    expect(pixelAt(base, 0, 0)).toEqual(BASE);
  });
});

describe('clipToBase', () => {
  it('レイヤーのアルファにクリップ先のアルファを掛ける（クリップ先の外は透明）。位置と大きさはレイヤーのまま', () => {
    const base = makeImage(2, 1, [0, 0, 0, 255]);
    base.data[7] = 128; // 右の画素は半透明
    const layer = makeImage(4, 1, LAYER);
    const out = clipToBase({ left: 11, top: 0, image: base }, { left: 10, top: 0, image: layer });
    expect([out.width, out.height]).toEqual([4, 1]);
    expect(pixelAt(out, 0, 0)).toEqual([40, 160, 220, 0]);
    expect(pixelAt(out, 1, 0)).toEqual(LAYER);
    expect(pixelAt(out, 2, 0)).toEqual([40, 160, 220, 128]);
    expect(pixelAt(out, 3, 0)).toEqual([40, 160, 220, 0]);
    expect(pixelAt(layer, 0, 0)).toEqual(LAYER);
  });
});
