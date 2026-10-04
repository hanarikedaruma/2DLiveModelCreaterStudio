// 合成モードのピクセルのテスト（カード32。Vitest のブラウザモード）。
// 参照の式は、乗算していない色で書いた合成の定義（下 b が不透明なとき。上の色 s、a = 上のアルファ × 不透明度 × マスク）:
//   normal   = b(1 − a) + s·a
//   multiply = b(1 − a) + b·s·a
//   screen   = b(1 − a) + (b + s − b·s)·a
//   add      = min(1, b + s·a)   （Live2D の加算と同じく、不透明度は足す量に掛かる）
// 描画バッファは残さない設定なので、render と readPixels は同じタスクの中で続けて呼ぶ
import type { Background, ViewTransform } from '@app/contracts';
import type { BlendMode } from '@app/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLEAR,
  cleanupAll,
  GREEN,
  mismatch,
  model,
  over,
  premul,
  quad,
  readPixel,
  RED,
  type Rgba,
  setup,
  solid,
  WHITE,
} from './test-helpers';

const VIEW: ViewTransform = { scale: 1, offset: { x: 0, y: 0 } };
const TRANSPARENT: Background = { type: 'transparent' };
const TOLERANCE = 3;

afterEach(() => cleanupAll());

const REFERENCE: Record<BlendMode, (b: number, s: number, a: number) => number> = {
  normal: (b, s, a) => b * (1 - a) + s * a,
  multiply: (b, s, a) => b * (1 - a) + b * s * a,
  screen: (b, s, a) => b * (1 - a) + (b + s - b * s) * a,
  add: (b, s, a) => Math.min(1, b + s * a),
};

const MODES: { mode: BlendMode; label: string }[] = [
  { mode: 'normal', label: '通常' },
  { mode: 'multiply', label: '乗算' },
  { mode: 'screen', label: 'スクリーン' },
  { mode: 'add', label: '加算' },
];

// 不透明な下の色 backdrop に、乗算していない色 source を、不透明度 × マスク k で重ねた結果（0..255）
function reference(mode: BlendMode, backdrop: Rgba, source: Rgba, k = 1): Rgba {
  const a = (source[3] / 255) * k;
  const channel = (i: number) => {
    const b = backdrop[i]! / 255;
    const s = source[i]! / 255;
    return REFERENCE[mode](b, s, a) * 255;
  };
  return [channel(0), channel(1), channel(2), 255];
}

const BACKDROPS: Rgba[] = [
  [200, 100, 50, 255],
  [30, 180, 240, 255],
  [255, 255, 255, 255],
  [0, 0, 0, 255],
  [128, 128, 128, 255],
];
const SOURCES: Rgba[] = [
  [255, 0, 0, 255],
  [100, 200, 150, 255],
  [128, 64, 255, 128], // 半透明
  [255, 255, 255, 64],
];
const OPACITIES = [1, 0.5];

async function textures(): Promise<Record<string, ImageBitmap>> {
  const entries = await Promise.all([
    ...BACKDROPS.map(async (c, i) => [`b${i}`, await solid(2, 2, c)] as const),
    ...SOURCES.map(async (c, i) => [`s${i}`, await solid(2, 2, c)] as const),
  ]);
  return Object.fromEntries(entries);
}

describe('4つの合成モード（参照の式との差が ±3 以内）', () => {
  it.each(MODES)('$label: 不透明な下の色の上に、色・アルファ・不透明度を変えて重ねる', async ({ mode }) => {
    const { canvas, renderer } = setup(8, 8);
    renderer.setTextures(await textures());
    const errors: string[] = [];
    for (const [bi, backdrop] of BACKDROPS.entries()) {
      for (const [si, source] of SOURCES.entries()) {
        for (const opacity of OPACITIES) {
          const back = quad('back', `b${bi}`, [0, 0, 8, 8]);
          const front = quad('front', `s${si}`, [0, 0, 8, 8], { opacity, blendMode: mode });
          renderer.render(model(back, front), VIEW, TRANSPARENT);
          const label = `下 [${backdrop.join(', ')}] / 上 [${source.join(', ')}] × ${opacity}`;
          const m = mismatch(readPixel(canvas, 4, 4), reference(mode, backdrop, source, opacity), TOLERANCE, label);
          if (m) errors.push(m);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('参照の式は合成モードごとに違う結果になる（同じ式で描いていないことを見分けられる）', () => {
    const backdrop: Rgba = [200, 100, 50, 255];
    const source: Rgba = [100, 200, 150, 255];
    const results = MODES.map(({ mode }) => reference(mode, backdrop, source).join(','));
    expect(new Set(results).size).toBe(4);
  });

  it('透明・半透明の下の上では、乗算済みの係数のとおり（乗算は下のアルファのまま、加算はアルファも足す）', async () => {
    const { canvas, renderer } = setup(8, 8);
    const halfBack: Rgba = [200, 100, 50, 128];
    const source: Rgba = [100, 200, 150, 192];
    renderer.setTextures({ back: await solid(2, 2, halfBack), src: await solid(2, 2, source) });
    const s = premul(source, 0.5);
    const d = premul(halfBack);
    const sa = s[3] / 255;
    // 乗算済み（0..255）の d に s を重ねた期待値。係数はアルファにも同じものを使う
    const expected: Record<BlendMode, Rgba> = {
      normal: over(s, d),
      multiply: [0, 1, 2, 3].map((i) => (s[i]! * d[i]!) / 255 + d[i]! * (1 - sa)) as Rgba,
      screen: [0, 1, 2, 3].map((i) => s[i]! + d[i]! * (1 - (i === 3 ? sa : s[i]! / 255))) as Rgba,
      add: [0, 1, 2, 3].map((i) => Math.min(255, s[i]! + d[i]!)) as Rgba,
    };
    const errors: string[] = [];
    for (const { mode, label } of MODES) {
      // 何も無い透明な背景の上。乗算だけは描かれない（下のアルファ 0 のまま）
      renderer.render(model(quad('f', 'src', [0, 0, 8, 8], { opacity: 0.5, blendMode: mode })), VIEW, TRANSPARENT);
      const alone = mode === 'multiply' ? CLEAR : s;
      errors.push(mismatch(readPixel(canvas, 4, 4), alone, TOLERANCE, `${label}（透明の上）`) ?? '');
      // 半透明の下の上
      const back = quad('b', 'back', [0, 0, 8, 8]);
      renderer.render(
        model(back, quad('f', 'src', [0, 0, 8, 8], { opacity: 0.5, blendMode: mode })),
        VIEW,
        TRANSPARENT,
      );
      errors.push(mismatch(readPixel(canvas, 4, 4), expected[mode], TOLERANCE, `${label}（半透明の上）`) ?? '');
    }
    expect(errors.filter((e) => e !== '')).toEqual([]);
  });
});

describe('マスクと合成', () => {
  // マスク元（左半分）は先に描き、不透明な下の色で覆って見えなくする。マスクの形はマスク元のアルファで決まる
  const backdrop: Rgba = [200, 100, 50, 255];
  const source: Rgba = [100, 200, 150, 255];

  it.each(MODES)('$label: マスクのアルファを合成の前に掛ける（範囲の外は下の色のまま）', async ({ mode }) => {
    const { canvas, renderer } = setup(20, 10);
    renderer.setTextures({
      mask: await solid(2, 2, WHITE),
      back: await solid(2, 2, backdrop),
      src: await solid(2, 2, source),
    });
    const errors: string[] = [];
    const check = (x: number, expected: Rgba, label: string) => {
      const m = mismatch(readPixel(canvas, x, 5), expected, TOLERANCE, label);
      if (m) errors.push(m);
    };
    const draw = (maskOpacity: number, inverted: boolean, opacity: number) => {
      const maskSource = quad('m', 'mask', [0, 0, 10, 10], { opacity: maskOpacity });
      const back = quad('b', 'back', [0, 0, 20, 10]);
      const front = quad('f', 'src', [0, 0, 20, 10], {
        opacity,
        blendMode: mode,
        mask: { sourcePartIds: ['m'], inverted },
      });
      renderer.render(model(maskSource, back, front), VIEW, TRANSPARENT);
    };

    draw(1, false, 1);
    check(5, reference(mode, backdrop, source), '範囲の中');
    check(15, backdrop, '範囲の外');

    // マスクの値 0.5 × 不透明度 0.5 → a = 0.25
    draw(0.5, false, 0.5);
    check(5, reference(mode, backdrop, source, 0.25), '半分のマスク');
    check(15, backdrop, '半分のマスクの範囲の外');

    // 反転。範囲の中が 1 − 0.5、外が 1
    draw(0.5, true, 1);
    check(5, reference(mode, backdrop, source, 0.5), '反転の範囲の中');
    check(15, reference(mode, backdrop, source), '反転の範囲の外');
    expect(errors).toEqual([]);
  });
});

describe('品目ごとの切り替え', () => {
  it('合成モードは品目ごとに設定し、前の品目の合成が残らない', async () => {
    const { canvas, renderer } = setup(30, 10);
    const half: Rgba = [0, 0, 255, 128];
    renderer.setTextures({
      red: await solid(2, 2, RED),
      green: await solid(2, 2, GREEN),
      half: await solid(2, 2, half),
    });
    // 赤の上に緑を加算（黄）→ その右側に半透明の青を通常で重ねる
    const back = quad('back', 'red', [0, 0, 30, 10]);
    const added = quad('add', 'green', [0, 0, 20, 10], { blendMode: 'add' });
    const normal = quad('normal', 'half', [10, 0, 30, 10]);
    renderer.render(model(back, added, normal), VIEW, TRANSPARENT);
    const yellow: Rgba = [255, 255, 0, 255];
    const errors = [
      mismatch(readPixel(canvas, 5, 5), yellow, TOLERANCE, '加算だけ'),
      mismatch(readPixel(canvas, 15, 5), over(premul(half), yellow), TOLERANCE, '加算の上に通常'),
      mismatch(readPixel(canvas, 25, 5), over(premul(half), RED), TOLERANCE, '赤の上に通常'),
    ].filter((m) => m !== null);
    expect(errors).toEqual([]);

    // 乗算 → 通常。青は乗算で赤に掛けると黒になるが、続く通常の品目は通常で重なる
    const multiplied = quad('mul', 'half', [0, 0, 20, 10], { blendMode: 'multiply' });
    const blue = quad('blue', 'half', [10, 0, 30, 10]);
    renderer.render(model(back, multiplied, blue), VIEW, TRANSPARENT);
    const darkened = reference('multiply', RED, half);
    expect(
      [
        mismatch(readPixel(canvas, 5, 5), darkened, TOLERANCE, '乗算だけ'),
        mismatch(readPixel(canvas, 15, 5), over(premul(half), darkened), TOLERANCE, '乗算の上に通常'),
        mismatch(readPixel(canvas, 25, 5), over(premul(half), RED), TOLERANCE, '赤の上に通常'),
      ].filter((m) => m !== null),
    ).toEqual([]);
  });
});
