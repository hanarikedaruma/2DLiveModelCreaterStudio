import { describe, expect, it } from 'vitest';
import { writePsdUint8Array, type Layer } from 'ag-psd';
import { hasPsdSignature, mergeReasons, readPsdDocument, toBlendMode, toRgba8 } from './psd';
import { makeImage, pixelAt, toPixelData, type Rgba } from './testImages';

describe('toBlendMode', () => {
  it('normal・multiply・screen・linear dodge を対応させ、ほかは normal にする', () => {
    expect(toBlendMode('normal')).toBe('normal');
    expect(toBlendMode('multiply')).toBe('multiply');
    expect(toBlendMode('screen')).toBe('screen');
    expect(toBlendMode('linear dodge')).toBe('add');
    expect(toBlendMode('overlay')).toBe('normal');
    expect(toBlendMode('color dodge')).toBe('normal');
    expect(toBlendMode(undefined)).toBe('normal');
  });
});

describe('mergeReasons', () => {
  it('普通のレイヤーには理由が無い', () => {
    expect(mergeReasons({ blendMode: 'normal' }, false)).toEqual([]);
    expect(mergeReasons({ blendMode: 'pass through' }, true)).toEqual([]);
  });

  it('対応していない合成モード・調整レイヤー・レイヤー効果・スマートオブジェクトを挙げる', () => {
    expect(mergeReasons({ blendMode: 'overlay' }, false)).toEqual(['合成モード: overlay']);
    expect(mergeReasons({ blendMode: 'color dodge' }, false)).toEqual(['合成モード: color dodge']);
    expect(mergeReasons({ adjustment: { type: 'brightness/contrast' } }, false)).toEqual(['調整レイヤー']);
    expect(mergeReasons({ effects: { stroke: [{ enabled: true }] } } as Layer, false)).toEqual(['レイヤー効果']);
    expect(mergeReasons({ placedLayer: { id: 'x', placed: 'x', type: 'raster', transform: [] } }, false)).toEqual([
      'スマートオブジェクト',
    ]);
  });

  it('乗算・スクリーン・覆い焼き（リニア）とクリッピングは挙げない（取り込みで引き継ぐ・統合する）', () => {
    expect(mergeReasons({ blendMode: 'multiply' }, false)).toEqual([]);
    expect(mergeReasons({ blendMode: 'screen' }, false)).toEqual([]);
    expect(mergeReasons({ blendMode: 'linear dodge' }, false)).toEqual([]);
    expect(mergeReasons({ clipping: true }, false)).toEqual([]);
  });

  it('グループの合成モードは、通常・通過のほかはすべて挙げる（中のレイヤーに分けると引き継げない）', () => {
    expect(mergeReasons({ blendMode: 'normal' }, true)).toEqual([]);
    expect(mergeReasons({ blendMode: 'multiply' }, true)).toEqual(['合成モード: 乗算']);
    expect(mergeReasons({ blendMode: 'linear dodge' }, true)).toEqual(['合成モード: 覆い焼き（リニア）- 加算']);
  });

  it('無効になったレイヤー効果は数えない', () => {
    expect(mergeReasons({ effects: { disabled: true, stroke: [{ enabled: true }] } } as Layer, false)).toEqual([]);
    expect(mergeReasons({ effects: { stroke: [{ enabled: false }] } } as Layer, false)).toEqual([]);
  });

  it('有効なレイヤーマスクを挙げる', () => {
    expect(mergeReasons({ mask: { left: 0, top: 0, right: 2, bottom: 2, defaultColor: 0 } }, false)).toEqual([
      'レイヤーマスク',
    ]);
    expect(mergeReasons({ mask: { left: 0, top: 0, right: 2, bottom: 2, disabled: true } }, false)).toEqual([]);
    // グループのマスクも中のレイヤーに反映していないので挙げる（I-048）
    expect(mergeReasons({ mask: { left: 0, top: 0, right: 2, bottom: 2, defaultColor: 0 } }, true)).toEqual([
      'レイヤーマスク',
    ]);
    expect(mergeReasons({ mask: { left: 0, top: 0, right: 2, bottom: 2, disabled: true } }, true)).toEqual([]);
  });
});

describe('toRgba8', () => {
  it('16bit を 8bit にする', () => {
    const out = toRgba8({ width: 1, height: 1, data: new Uint16Array([65535, 0, 32768, 65535]) });
    expect(out && pixelAt(out, 0, 0)).toEqual([255, 0, 128, 255]);
  });

  it('32bit はガンマを戻して 8bit にする（アルファはそのまま）', () => {
    const out = toRgba8({ width: 1, height: 1, data: new Float32Array([1, 0, 0.5, 0.5]) });
    expect(out && pixelAt(out, 0, 0)).toEqual([255, 0, Math.round(Math.pow(0.5, 1 / 2.2) * 255), 128]);
  });

  it('画素が無ければ null', () => {
    expect(toRgba8(undefined)).toBeNull();
    expect(toRgba8({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });
});

describe('readPsdDocument', () => {
  it('グループの中のレイヤーを背面から順に、グループ名の並びと一緒に読む', () => {
    const data = writePsdUint8Array({
      width: 64,
      height: 48,
      children: [
        { name: '体', left: 1, top: 2, right: 5, bottom: 6, imageData: toPixelData(makeImage(4, 4, [1, 1, 1, 255])) },
        {
          name: '頭',
          opacity: 0.5,
          children: [
            {
              name: '目',
              hidden: true,
              children: [
                {
                  name: '左目',
                  opacity: 0.5,
                  left: 10,
                  top: 10,
                  right: 12,
                  bottom: 12,
                  imageData: toPixelData(makeImage(2, 2, [2, 2, 2, 255])),
                },
              ],
            },
            {
              name: '口',
              left: 20,
              top: 30,
              right: 23,
              bottom: 31,
              imageData: toPixelData(makeImage(3, 1, [3, 3, 3, 255])),
            },
          ],
        },
      ],
    });
    expect(hasPsdSignature(data)).toBe(true);
    const doc = readPsdDocument(data);
    expect(doc.canvas).toEqual({ width: 64, height: 48 });
    expect(doc.layers.map((l) => [l.name, l.path, l.left, l.top, l.hidden])).toEqual([
      ['体', [], 1, 2, false],
      ['左目', ['頭', '目'], 10, 10, true],
      ['口', ['頭'], 20, 30, false],
    ]);
    // グループの不透明度も掛ける（PSD の中では 1/255 単位）
    expect(doc.layers[1]!.opacity).toBeCloseTo(0.25, 2);
    expect(doc.layers[2]!.opacity).toBeCloseTo(0.5, 2);
    expect(doc.layers[2]!.image && pixelAt(doc.layers[2]!.image, 2, 0)).toEqual([3, 3, 3, 255]);
    expect(doc.mergeTargets).toEqual([]);
  });

  it('合成モードを持つグループは中のレイヤーをまとめて統合の対象にする', () => {
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        {
          name: '影グループ',
          blendMode: 'multiply',
          children: [
            {
              name: 'a',
              left: 0,
              top: 0,
              right: 1,
              bottom: 1,
              imageData: toPixelData(makeImage(1, 1, [0, 0, 0, 255])),
            },
            {
              name: 'b',
              left: 1,
              top: 1,
              right: 2,
              bottom: 2,
              imageData: toPixelData(makeImage(1, 1, [0, 0, 0, 255])),
            },
          ],
        },
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.mergeTargets).toEqual([{ name: '影グループ', reasons: ['合成モード: 乗算'], layerIndexes: [0, 1] }]);
  });

  it('レイヤーマスクだけを持つグループも、中のレイヤーをまとめて統合の対象にする（I-048）', () => {
    const pixel = () => toPixelData(makeImage(1, 1, [0, 0, 0, 255]));
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        {
          name: 'マスクのグループ',
          mask: {
            left: 0,
            top: 0,
            right: 2,
            bottom: 2,
            defaultColor: 0,
            imageData: toPixelData(makeImage(2, 2, [255, 255, 255, 255])),
          },
          children: [
            { name: 'a', left: 0, top: 0, right: 1, bottom: 1, imageData: pixel() },
            { name: 'b', left: 1, top: 1, right: 2, bottom: 2, imageData: pixel() },
          ],
        },
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.mergeTargets).toEqual([{ name: 'マスクのグループ', reasons: ['レイヤーマスク'], layerIndexes: [0, 1] }]);
  });

  it('レイヤーの無い PSD は統合画像を1枚として読む', () => {
    const data = writePsdUint8Array({ width: 3, height: 2, imageData: toPixelData(makeImage(3, 2, [5, 6, 7, 255])) });
    const doc = readPsdDocument(data);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]!.name).toBeNull();
    expect(doc.layers[0]!.image && pixelAt(doc.layers[0]!.image, 2, 1)).toEqual([5, 6, 7, 255]);
  });
});

// クリッピングの統合（カード32）。PSD はテストの中で ag-psd で作る
describe('readPsdDocument のクリッピング', () => {
  const SKIN: Rgba = [200, 100, 50, 255];
  const SHADOW: Rgba = [40, 160, 220, 255];
  const WHITE: Rgba = [255, 255, 255, 255];
  // PSD の中の不透明度は 1/255 単位
  const stored = (opacity: number) => Math.round(opacity * 255) / 255;

  // 1画素の参照の式（0..255）。下 base に上 layer を不透明度 opacity・合成 blend で重ね、アルファは下のまま
  function over(base: Rgba, layer: Rgba, opacity: number, blend: (b: number, s: number) => number): Rgba {
    const ab = base[3] / 255;
    const as = (layer[3] / 255) * opacity;
    const c = (i: number) => {
      const b = base[i]! / 255;
      const s = layer[i]! / 255;
      return (as * ((1 - ab) * s + ab * blend(b, s)) + (1 - as) * b) * 255;
    };
    return [c(0), c(1), c(2), base[3]];
  }
  const normal = (_b: number, s: number) => s;
  const multiply = (b: number, s: number) => b * s;
  const screen = (b: number, s: number) => b + s - b * s;
  const add = (b: number, s: number) => Math.min(1, b + s);

  function expectClose(actual: Rgba, expected: Rgba, label: string) {
    const diff = Math.max(...actual.map((v, i) => Math.abs(v - expected[i]!)));
    const text = `${label}: [${actual.join(', ')}] / [${expected.map((v) => v.toFixed(1)).join(', ')}]`;
    expect(diff, text).toBeLessThanOrEqual(1);
  }

  function layer(name: string, rect: [number, number, number, number], color: Rgba, extra: Partial<Layer> = {}): Layer {
    const [left, top, width, height] = rect;
    return {
      name,
      left,
      top,
      right: left + width,
      bottom: top + height,
      imageData: toPixelData(makeImage(width, height, color)),
      ...extra,
    };
  }

  it('クリッピングされたレイヤーを、それぞれの合成モードと不透明度でクリップ先に重ね、クリップ先のアルファで切り抜く', () => {
    // クリップ先は (2, 1) の 4×2。右の列は半透明
    const base = layer('肌', [2, 1, 4, 2], SKIN);
    const semi: Rgba = [200, 100, 50, 128];
    const pixels = base.imageData!.data;
    pixels.set(semi, 3 * 4);
    pixels.set(semi, 7 * 4);
    const data = writePsdUint8Array({
      width: 20,
      height: 10,
      children: [
        layer('背景', [0, 0, 1, 1], WHITE),
        base,
        // クリップ先より大きく、はみ出す
        layer('影', [0, 0, 10, 5], SHADOW, { clipping: true, blendMode: 'multiply', opacity: 0.5 }),
        layer('光', [4, 1, 1, 1], WHITE, { clipping: true, blendMode: 'screen' }),
        layer('足し', [5, 2, 3, 1], [30, 30, 30, 255], { clipping: true, blendMode: 'linear dodge' }),
        layer('上', [0, 0, 2, 2], SHADOW),
      ],
    });
    const doc = readPsdDocument(data);
    // クリッピングされたレイヤーは別のレイヤーにならず、クリップ先の名前の1枚になる
    expect(doc.layers.map((l) => l.name)).toEqual(['背景', '肌', '上']);
    expect(doc.mergeTargets).toEqual([]);
    const merged = doc.layers[1]!;
    expect([merged.left, merged.top, merged.blendMode, merged.opacity, merged.hidden]).toEqual([
      2,
      1,
      'normal',
      1,
      false,
    ]);
    const image = merged.image!;
    expect([image.width, image.height]).toEqual([4, 2]);

    const shaded = over(SKIN, SHADOW, stored(0.5), multiply);
    // (0, 0): 影（乗算）だけ
    expectClose(pixelAt(image, 0, 0), shaded, '影');
    // (2, 0): 影のあとに光（スクリーン）
    expectClose(pixelAt(image, 2, 0), over(shaded, WHITE, 1, screen), '影と光');
    // (3, 1): 半透明のクリップ先。影のあとに足し（加算）。アルファはクリップ先のまま
    const semiShaded = over(semi, SHADOW, stored(0.5), multiply);
    expectClose(pixelAt(image, 3, 1), over(semiShaded, [30, 30, 30, 255], 1, add), '半透明のクリップ先');
    expect(pixelAt(image, 3, 1)[3]).toBe(128);
    // 上のレイヤーは統合しない
    expect(doc.layers[2]!.image && pixelAt(doc.layers[2]!.image, 0, 0)).toEqual(SHADOW);
  });

  it('クリップ先の合成モード・不透明度・非表示・グループの不透明度を、統合した1枚に引き継ぐ', () => {
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        {
          name: '頭',
          opacity: 0.5,
          hidden: true,
          children: [
            layer('頬', [0, 0, 2, 2], SKIN, { blendMode: 'multiply', opacity: 0.8 }),
            layer('頬の影', [0, 0, 2, 2], SHADOW, { clipping: true, opacity: 0.4 }),
          ],
        },
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.layers).toHaveLength(1);
    const merged = doc.layers[0]!;
    expect([merged.name, merged.path, merged.blendMode, merged.hidden]).toEqual(['頬', ['頭'], 'multiply', true]);
    expect(merged.opacity).toBeCloseTo(stored(0.5) * stored(0.8), 5);
    // クリッピングされたレイヤーの不透明度は色に入る（グループの不透明度は入らない）
    expectClose(pixelAt(merged.image!, 1, 1), over(SKIN, SHADOW, stored(0.4), normal), '頬の影');
    expect(doc.mergeTargets).toEqual([]);
  });

  it('非表示のクリッピングレイヤーは統合せず、クリップ先のアルファで切り抜いた別のレイヤー（非表示）にする', () => {
    const base = layer('服', [0, 0, 2, 1], SKIN);
    base.imageData!.data[7] = 0; // 右は透明
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        base,
        layer('柄', [0, 0, 3, 1], SHADOW, { clipping: true, hidden: true, blendMode: 'screen' }),
        layer('しわ', [0, 0, 1, 1], WHITE, { clipping: true }),
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.layers.map((l) => [l.name, l.hidden, l.blendMode])).toEqual([
      ['服', false, 'normal'],
      ['柄', true, 'screen'],
    ]);
    // 表示しているものだけが統合される
    expect(pixelAt(doc.layers[0]!.image!, 0, 0)).toEqual(WHITE);
    // 非表示のものは位置・大きさはそのままで、クリップ先の外が透明になる
    const cut = doc.layers[1]!.image!;
    expect([doc.layers[1]!.left, cut.width]).toEqual([0, 3]);
    expect(pixelAt(cut, 0, 0)).toEqual(SHADOW);
    expect(pixelAt(cut, 1, 0)[3]).toBe(0);
    expect(pixelAt(cut, 2, 0)[3]).toBe(0);
  });

  it('対応していない合成モード・調整レイヤー・レイヤー効果は、統合した1枚を needsMerge の対象にする（対応していない合成モードは通常で重ねる）', () => {
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        layer('髪', [0, 0, 1, 1], SKIN),
        layer('模様', [0, 0, 1, 1], SHADOW, { clipping: true, blendMode: 'overlay', opacity: 0.5 }),
        { name: '色調', clipping: true, adjustment: { type: 'brightness/contrast', brightness: 10, contrast: 0 } },
        layer('縁', [0, 0, 1, 1], WHITE, {
          clipping: true,
          opacity: 0,
          effects: { stroke: [{ enabled: true, size: { units: 'Pixels', value: 2 } }] },
        }),
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.layers.map((l) => l.name)).toEqual(['髪']);
    expect(doc.mergeTargets).toEqual([
      { name: '模様', reasons: ['合成モード: overlay'], layerIndexes: [0] },
      { name: '色調', reasons: ['調整レイヤー'], layerIndexes: [0] },
      { name: '縁', reasons: ['レイヤー効果'], layerIndexes: [0] },
    ]);
    expectClose(pixelAt(doc.layers[0]!.image!, 0, 0), over(SKIN, SHADOW, stored(0.5), normal), '模様');
  });

  it('クリップ先がグループ・グループをクリッピングしているときは統合せず、別々に読んで needsMerge にする', () => {
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        { name: '体', children: [layer('胴', [0, 0, 1, 1], SKIN)] },
        layer('体の影', [0, 0, 1, 1], SHADOW, { clipping: true }),
        layer('腕', [2, 2, 1, 1], SKIN),
        { name: '腕の飾り', clipping: true, children: [layer('輪', [2, 2, 1, 1], WHITE)] },
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.layers.map((l) => [l.name, l.path])).toEqual([
      ['胴', ['体']],
      ['体の影', []],
      ['腕', []],
      ['輪', ['腕の飾り']],
    ]);
    expect(doc.mergeTargets).toEqual([
      { name: '体の影', reasons: ['クリッピング'], layerIndexes: [1] },
      { name: '腕の飾り', reasons: ['クリッピング'], layerIndexes: [3] },
    ]);
    expect(pixelAt(doc.layers[1]!.image!, 0, 0)).toEqual(SHADOW);
  });

  it('いちばん下のレイヤーの clipping は無視する', () => {
    const data = writePsdUint8Array({
      width: 10,
      height: 10,
      children: [
        layer('下', [0, 0, 1, 1], SKIN, { clipping: true }),
        layer('上', [0, 0, 1, 1], SHADOW, { clipping: true }),
      ],
    });
    const doc = readPsdDocument(data);
    expect(doc.layers.map((l) => l.name)).toEqual(['下']);
    expect(pixelAt(doc.layers[0]!.image!, 0, 0)).toEqual(SHADOW);
    expect(doc.mergeTargets).toEqual([]);
  });
});
