// WebGL2 のレンダラーのピクセルのテスト（Vitest のブラウザモード。ヘッドレスの Microsoft Edge）。
// 描画バッファは残さない設定なので、render と readPixels は同じタスクの中で続けて呼ぶ（間に await を挟まない）
import { createAssetRepository, type Background, type ViewTransform } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BLUE,
  bitmap,
  CLEAR,
  cleanupAll,
  GREEN,
  lerp,
  mismatch,
  model,
  over,
  premul,
  quad,
  readPixel,
  RED,
  type Rgba,
  scale,
  setup,
  solid,
  WHITE,
  YELLOW,
} from './test-helpers';

const VIEW: ViewTransform = { scale: 1, offset: { x: 0, y: 0 } };
const TRANSPARENT: Background = { type: 'transparent' };
const WHITE_BG: Background = { type: 'color', color: '#ffffff' };

afterEach(() => {
  cleanupAll();
  vi.restoreAllMocks();
});

function expectPixel(canvas: HTMLCanvasElement, x: number, y: number, expected: Rgba, tolerance = 1): void {
  expect(mismatch(readPixel(canvas, x, y), expected, tolerance, `(${x}, ${y})`)).toBeNull();
}

// 1行のピクセルをまとめて確かめる（合わないものをすべて並べる）
function expectRow(
  canvas: HTMLCanvasElement,
  y: number,
  xs: number[],
  expected: (x: number) => Rgba,
  tolerance: number,
): void {
  const errors = xs
    .map((x) => mismatch(readPixel(canvas, x, y), expected(x), tolerance, `(${x}, ${y})`))
    .filter((m) => m !== null);
  expect(errors).toEqual([]);
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('画像の位置と色', () => {
  it('1枚の画像が正しい位置・色で描かれる（uv の (0, 0) が画像の左上）', async () => {
    const { canvas, renderer } = setup(100, 80);
    // 4×4 の画像。左上 赤・右上 緑・左下 青・右下 黄
    const image = await bitmap(4, 4, (x, y) => (y < 2 ? (x < 2 ? RED : GREEN) : x < 2 ? BLUE : YELLOW));
    renderer.setTextures({ a: image });

    renderer.render(model(quad('p', 'a', [20, 10, 60, 50])), VIEW, TRANSPARENT);
    expect([canvas.width, canvas.height]).toEqual([100, 80]);
    expectPixel(canvas, 30, 20, RED);
    expectPixel(canvas, 50, 20, GREEN);
    expectPixel(canvas, 30, 40, BLUE);
    expectPixel(canvas, 50, 40, YELLOW);
    expectPixel(canvas, 20, 10, RED); // 左上の角のピクセルは中
    expectPixel(canvas, 59, 15, GREEN);
    expectPixel(canvas, 19, 30, CLEAR); // 外
    expectPixel(canvas, 60, 15, CLEAR);
    expectPixel(canvas, 30, 9, CLEAR);
    expectPixel(canvas, 30, 50, CLEAR);

    // 画面座標 = キャンバス座標 × 0.5 + (10, 20) → (20, 25)〜(40, 45)
    renderer.render(model(quad('p', 'a', [20, 10, 60, 50])), { scale: 0.5, offset: { x: 10, y: 20 } }, TRANSPARENT);
    expectPixel(canvas, 25, 30, RED);
    expectPixel(canvas, 35, 30, GREEN);
    expectPixel(canvas, 25, 40, BLUE);
    expectPixel(canvas, 35, 40, YELLOW);
    expectPixel(canvas, 19, 30, CLEAR);
    expectPixel(canvas, 40, 40, CLEAR);
    expectPixel(canvas, 30, 24, CLEAR);
    expectPixel(canvas, 30, 45, CLEAR);
  });

  it('メッシュの頂点と uv のとおりに描く（三角形が複数・頂点を共有）', async () => {
    const { canvas, renderer } = setup(60, 60);
    const image = await bitmap(2, 1, (x) => (x === 0 ? RED : BLUE));
    renderer.setTextures({ a: image });
    // 2つの四角形を横に並べたメッシュ。左の四角形には画像の左半分（赤）、右の四角形には右半分（青）を貼る
    const item = quad('p', 'a', [0, 0, 0, 0], {
      positions: new Float32Array([0, 0, 30, 0, 60, 0, 0, 60, 30, 60, 60, 60]),
      uvs: new Float32Array([0, 0, 0.25, 0, 1, 0, 0, 1, 0.25, 1, 1, 1]),
      indices: new Uint32Array([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]),
    });
    renderer.render(model(item), VIEW, TRANSPARENT);
    // ピクセル x の u。左の四角形は 0〜0.25、右の四角形は 0.25〜1。テクセルの中心は u = 0.25（赤）と 0.75（青）
    const u = (x: number) => (x < 30 ? ((x + 0.5) / 30) * 0.25 : 0.25 + ((x + 0.5 - 30) / 30) * 0.75);
    const expected = (x: number) => lerp(RED, BLUE, Math.min(1, Math.max(0, u(x) * 2 - 0.5)));
    expectRow(canvas, 30, range(60), expected, 2);
    expectRow(canvas, 1, [0, 15, 29, 30, 45, 59], expected, 2);
    expectRow(canvas, 58, [0, 15, 29, 30, 45, 59], expected, 2);
  });

  it('devicePixelRatio に合わせて描画バッファを大きくし、view は CSS ピクセルで扱う', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 2 });
    try {
      const { canvas, renderer } = setup(50, 40);
      renderer.setTextures({ a: await solid(2, 2, RED) });
      renderer.render(model(quad('p', 'a', [10, 10, 20, 20])), VIEW, TRANSPARENT);
      expect([canvas.width, canvas.height]).toEqual([100, 80]);
      // キャンバス (10, 10)〜(20, 20) → CSS (10, 10)〜(20, 20) → 描画バッファ (20, 20)〜(40, 40)
      expectPixel(canvas, 20, 20, RED);
      expectPixel(canvas, 39, 39, RED);
      expectPixel(canvas, 19, 30, CLEAR);
      expectPixel(canvas, 40, 30, CLEAR);

      // offset も CSS ピクセル。(5, 0) → 描画バッファで 10 ずれる
      renderer.render(model(quad('p', 'a', [10, 10, 20, 20])), { scale: 1, offset: { x: 5, y: 0 } }, TRANSPARENT);
      expectPixel(canvas, 30, 30, RED);
      expectPixel(canvas, 49, 30, RED);
      expectPixel(canvas, 29, 30, CLEAR);

      // CSS の大きさが変わったら描画バッファも合わせる
      canvas.style.width = '30px';
      renderer.render(model(), VIEW, TRANSPARENT);
      expect([canvas.width, canvas.height]).toEqual([60, 80]);
    } finally {
      if (original) Object.defineProperty(window, 'devicePixelRatio', original);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });
});

describe('半透明の縁（乗算済みアルファ）', () => {
  it('拡大して補間された縁を白背景に描いても黒ずまない（期待値との差 ±2）', async () => {
    const { canvas, renderer } = setup(100, 10);
    // 左は不透明な赤、右は色を持った透明（乗算すると 0）。補間は乗算済みの値で行われるべき
    const image = await bitmap(2, 1, (x) => (x === 0 ? RED : [0, 0, 255, 0]));
    renderer.setTextures({ a: image });
    renderer.render(model(quad('p', 'a', [0, 0, 100, 10])), VIEW, WHITE_BG);
    // ピクセル x の u = (x + 0.5) / 100。テクセルの中心は u = 0.25 と 0.75
    const expected = (x: number): Rgba => {
      const t = Math.min(1, Math.max(0, ((x + 0.5) / 100) * 2 - 0.5));
      return over(lerp(RED, CLEAR, t), WHITE);
    };
    expectRow(canvas, 5, range(100), expected, 2);
    // 乗算していない値で補間すると、まん中は (191, 64, 64) 付近まで暗くなる（このテストで見分けられる）
    expect(expected(49)[1]).toBeGreaterThan(120);
  });

  it('createAssetRepository の PNG（半透明の階調）を白背景に重ねても期待値との差 ±2', async () => {
    // 16 段の半透明の PNG をこのテストの中で作る
    const source = new OffscreenCanvas(16, 1);
    const ctx = source.getContext('2d')!;
    const data = new ImageData(16, 1);
    for (let x = 0; x < 16; x++) data.data.set([200, 100, 50, x * 17], x * 4);
    ctx.putImageData(data, 0, 0);
    const png = new Uint8Array(await (await source.convertToBlob({ type: 'image/png' })).arrayBuffer());
    const repo = createAssetRepository();
    await repo.put('a', png);
    const image = repo.getImage('a')!;
    const pixels = repo.getImageData('a')!.data; // 乗算していない RGBA

    const { canvas, renderer } = setup(16, 4);
    renderer.setTextures({ a: image });
    renderer.render(model(quad('p', 'a', [0, 0, 16, 4])), VIEW, WHITE_BG);
    const expected = (x: number): Rgba => {
      const c: Rgba = [pixels[x * 4]!, pixels[x * 4 + 1]!, pixels[x * 4 + 2]!, pixels[x * 4 + 3]!];
      return over(premul(c), WHITE);
    };
    expectRow(canvas, 2, range(16), expected, 2);
  });

  it('縮小（ミップマップ）しても縁が黒ずまない（白背景で赤のチャンネルが 255 のまま）', async () => {
    // 64×64 の赤。アルファが左から右へ 255 → 0
    const image = await bitmap(64, 64, (x) => [255, 0, 0, Math.round(255 - (x * 255) / 63)]);
    const { canvas, renderer } = setup(16, 16);
    renderer.setTextures({ a: image });
    renderer.render(model(quad('p', 'a', [0, 0, 16, 16])), VIEW, WHITE_BG);
    const row = range(16).map((x) => readPixel(canvas, x, 8));
    for (const [x, [r, g, b, a]] of row.entries()) {
      expect(Math.abs(r - 255), `x = ${x} の赤 ${r}`).toBeLessThanOrEqual(2);
      expect(Math.abs(g - b), `x = ${x} の緑 ${g} と青 ${b}`).toBeLessThanOrEqual(1);
      expect(a).toBe(255);
    }
    // 右へ行くほど透明なので白に近づく
    expect(row[0]![1]).toBeLessThan(40);
    expect(row[15]![1]).toBeGreaterThan(215);
  });
});

describe('不透明度と描画順', () => {
  it('不透明度を掛け、items の順（背面 → 前面）に描く', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({ red: await solid(2, 2, RED), green: await solid(2, 2, GREEN) });
    const back = quad('back', 'red', [0, 0, 60, 60]);
    const front = quad('front', 'green', [30, 30, 90, 90], { opacity: 0.5 });

    renderer.render(model(back, front), VIEW, TRANSPARENT);
    expectPixel(canvas, 15, 15, RED);
    expectPixel(canvas, 45, 45, over(premul(GREEN, 0.5), RED), 2);
    expectPixel(canvas, 75, 75, premul(GREEN, 0.5), 2);
    expectPixel(canvas, 95, 5, CLEAR);

    // 順を入れ替えると、不透明な赤が前になる
    renderer.render(model(front, back), VIEW, TRANSPARENT);
    expectPixel(canvas, 45, 45, RED);
    expectPixel(canvas, 75, 75, premul(GREEN, 0.5), 2);

    // 不透明度 0 は描かない
    renderer.render(model(back, { ...front, opacity: 0 }), VIEW, TRANSPARENT);
    expectPixel(canvas, 45, 45, RED);
    expectPixel(canvas, 75, 75, CLEAR);
  });
  // 乗算・スクリーン・加算のピクセルのテストは blend.browser.test.ts（カード32）
});

describe('マスク', () => {
  it('マスク元の範囲の外が消える', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({ red: await solid(2, 2, RED), blue: await solid(2, 2, BLUE) });
    const source = quad('s', 'red', [0, 0, 50, 100]);
    const target = quad('t', 'blue', [0, 0, 100, 100], { mask: { sourcePartIds: ['s'], inverted: false } });
    renderer.render(model(source, target), VIEW, TRANSPARENT);
    expectPixel(canvas, 25, 50, BLUE);
    expectPixel(canvas, 49, 50, BLUE);
    expectPixel(canvas, 50, 50, CLEAR);
    expectPixel(canvas, 75, 50, CLEAR);

    // マスク元が前面にあっても、形は同じ
    renderer.render(model(target, source), VIEW, TRANSPARENT);
    expectPixel(canvas, 25, 50, RED);
    expectPixel(canvas, 75, 50, CLEAR);
  });

  it('反転すると範囲の中が消える', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({ red: await solid(2, 2, RED), blue: await solid(2, 2, BLUE) });
    const source = quad('s', 'red', [0, 0, 50, 100]);
    const target = quad('t', 'blue', [0, 0, 100, 100], { mask: { sourcePartIds: ['s'], inverted: true } });
    renderer.render(model(source, target), VIEW, TRANSPARENT);
    expectPixel(canvas, 25, 50, RED);
    expectPixel(canvas, 75, 50, BLUE);
    expectPixel(canvas, 50, 50, BLUE);
  });

  it('複数のマスク元の範囲の和（重なりは最大値で、足し算ではない）', async () => {
    const { canvas, renderer } = setup(100, 100);
    const halfRed: Rgba = [255, 0, 0, 128];
    const halfGreen: Rgba = [0, 255, 0, 128];
    renderer.setTextures({
      red: await solid(2, 2, RED),
      green: await solid(2, 2, GREEN),
      blue: await solid(2, 2, BLUE),
      halfRed: await solid(2, 2, halfRed),
      halfGreen: await solid(2, 2, halfGreen),
    });
    // 離れた2つのマスク元
    const target = quad('t', 'blue', [0, 0, 100, 100], { mask: { sourcePartIds: ['s1', 's2'], inverted: false } });
    renderer.render(
      model(quad('s1', 'red', [0, 0, 30, 100]), quad('s2', 'green', [70, 0, 100, 100]), target),
      VIEW,
      TRANSPARENT,
    );
    expectPixel(canvas, 15, 50, BLUE);
    expectPixel(canvas, 85, 50, BLUE);
    expectPixel(canvas, 50, 50, CLEAR);

    // 半透明のマスク元が重なるところ。マスクの値は max(0.5, 0.5) = 0.5（足すと 1 になってしまう）
    const s1 = quad('s1', 'halfRed', [0, 0, 60, 100]);
    const s2 = quad('s2', 'halfGreen', [40, 0, 100, 100]);
    renderer.render(model(s1, s2, target), VIEW, TRANSPARENT);
    const m = 128 / 255;
    const under = over(premul(halfGreen), premul(halfRed));
    expectPixel(canvas, 50, 50, over(scale(BLUE, m), under), 2);
    expectPixel(canvas, 20, 50, over(scale(BLUE, m), premul(halfRed)), 2);
    expectPixel(canvas, 80, 50, over(scale(BLUE, m), premul(halfGreen)), 2);
  });

  it('マスク元の不透明度もマスクの値に入る', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({ red: await solid(2, 2, RED), blue: await solid(2, 2, BLUE) });
    const source = quad('s', 'red', [0, 0, 50, 100], { opacity: 0.5 });
    const target = quad('t', 'blue', [0, 0, 100, 100], { mask: { sourcePartIds: ['s'], inverted: false } });
    renderer.render(model(source, target), VIEW, TRANSPARENT);
    expectPixel(canvas, 25, 50, over(premul(BLUE, 0.5), premul(RED, 0.5)), 2);
    expectPixel(canvas, 75, 50, CLEAR);
  });

  it('マスク元の形には、マスク元自身のマスクを掛けない', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({ red: await solid(2, 2, RED), blue: await solid(2, 2, BLUE) });
    // マスク元 s は、無いパーツをマスク元にしているので自分は表示されない
    const source = quad('s', 'red', [0, 0, 50, 100], { mask: { sourcePartIds: ['ghost'], inverted: false } });
    const target = quad('t', 'blue', [0, 0, 100, 50], { mask: { sourcePartIds: ['s'], inverted: false } });
    renderer.render(model(source, target), VIEW, TRANSPARENT);
    expectPixel(canvas, 25, 25, BLUE); // s の形はそのまま使われる
    expectPixel(canvas, 75, 25, CLEAR);
    expectPixel(canvas, 25, 75, CLEAR); // s 自身は描かれない
  });

  it('マスク元が items に無い（非表示など）と空のマスクで、対象は表示されない（反転なら全体が表示される）', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({ blue: await solid(2, 2, BLUE) });
    const target = quad('t', 'blue', [0, 0, 100, 100], { mask: { sourcePartIds: ['hidden'], inverted: false } });
    renderer.render(model(target), VIEW, TRANSPARENT);
    expectPixel(canvas, 50, 50, CLEAR);
    renderer.render(model({ ...target, mask: { sourcePartIds: [], inverted: false } }), VIEW, TRANSPARENT);
    expectPixel(canvas, 50, 50, CLEAR);
    renderer.render(model({ ...target, mask: { sourcePartIds: ['hidden'], inverted: true } }), VIEW, TRANSPARENT);
    expectPixel(canvas, 50, 50, BLUE);
  });

  it('同じマスク元の組を複数の対象で使い、view の変換にも合う', async () => {
    const { canvas, renderer } = setup(100, 100);
    renderer.setTextures({
      red: await solid(2, 2, RED),
      green: await solid(2, 2, GREEN),
      blue: await solid(2, 2, BLUE),
    });
    // 画面 = キャンバス × 0.5 + (10, 10)
    const view: ViewTransform = { scale: 0.5, offset: { x: 10, y: 10 } };
    const source = quad('s', 'red', [0, 0, 100, 200]); // 画面 (10, 10)〜(60, 110)
    const t1 = quad('t1', 'blue', [0, 0, 180, 60], { mask: { sourcePartIds: ['s'], inverted: false } }); // 画面 y 10〜40
    const t2 = quad('t2', 'green', [0, 100, 180, 160], { mask: { sourcePartIds: ['s', 's'], inverted: true } }); // 画面 y 60〜90
    renderer.render(model(source, t1, t2), view, TRANSPARENT);
    expectPixel(canvas, 30, 25, BLUE);
    expectPixel(canvas, 59, 25, BLUE);
    expectPixel(canvas, 60, 25, CLEAR);
    expectPixel(canvas, 80, 25, CLEAR);
    expectPixel(canvas, 30, 75, RED);
    expectPixel(canvas, 60, 75, GREEN);
    expectPixel(canvas, 80, 75, GREEN);
    expectPixel(canvas, 5, 75, CLEAR); // 画面 x 10 より左はどれも無い
  });
});

describe('背景', () => {
  it('透明背景でアルファが 0 になる（前のフレームの色も残らない）', async () => {
    const { canvas, renderer } = setup(40, 40);
    renderer.setTextures({ half: await solid(2, 2, [0, 0, 255, 128]) });
    const item = quad('p', 'half', [10, 10, 30, 30]);
    renderer.render(model(item), VIEW, { type: 'color', color: '#ff0000' });
    expectPixel(canvas, 5, 5, RED);
    renderer.render(model(item), VIEW, TRANSPARENT);
    expectPixel(canvas, 5, 5, CLEAR, 0);
    expectPixel(canvas, 35, 35, CLEAR, 0);
    expectPixel(canvas, 20, 20, premul([0, 0, 255, 128]), 1); // 品目のところはそのアルファ
  });

  it('色の背景で塗る（乗算済みで書く）', async () => {
    const { canvas, renderer } = setup(20, 20);
    renderer.setTextures({ green: await solid(2, 2, GREEN) });
    renderer.render(model(), VIEW, { type: 'color', color: '#336699' });
    expectPixel(canvas, 10, 10, [51, 102, 153, 255], 0);
    renderer.render(model(), VIEW, { type: 'color', color: 'rgba(255, 0, 0, 0.5)' });
    expectPixel(canvas, 10, 10, [127.5, 0, 0, 127.5], 1);
    renderer.render(model(), VIEW, { type: 'color', color: 'white' }); // 名前の色はブラウザに読ませる
    expectPixel(canvas, 10, 10, WHITE, 0);
    renderer.render(model(quad('p', 'green', [0, 0, 10, 20], { opacity: 0.5 })), VIEW, WHITE_BG);
    expectPixel(canvas, 5, 10, over(premul(GREEN, 0.5), WHITE), 2);
    expectPixel(canvas, 15, 10, WHITE, 0);
  });

  it('画像の背景は縦横比を保って全体を覆う（横長は左右、縦長は上下を切る）', async () => {
    const { canvas, renderer } = setup(100, 50);
    renderer.setTextures({ half: await solid(2, 2, [255, 255, 255, 128]) });
    const colors = [RED, GREEN, BLUE];
    // テクセルの並び（端はそのまま伸ばす）を線形補間した色
    const sample = (s: number): Rgba => {
      const i = Math.floor(s);
      const pick = (k: number) => colors[Math.min(2, Math.max(0, k))]!;
      return lerp(pick(i), pick(i + 1), s - i);
    };

    // 3×1 の横長の画像を 100×50 に。見える u は 1/6〜5/6
    const wide = await bitmap(3, 1, (x) => colors[x]!);
    renderer.render(model(), VIEW, { type: 'image', image: wide });
    expectRow(canvas, 25, range(100), (x) => sample((1 / 6 + ((x + 0.5) / 100) * (2 / 3)) * 3 - 0.5), 2);
    expectRow(canvas, 0, [0, 50, 99], (x) => sample((1 / 6 + ((x + 0.5) / 100) * (2 / 3)) * 3 - 0.5), 2);

    // 1×3 の縦長の画像。見える v は 5/12〜7/12
    const tall = await bitmap(1, 3, (_, y) => colors[y]!);
    renderer.render(model(quad('p', 'half', [0, 0, 50, 50])), VIEW, { type: 'image', image: tall });
    const column = range(50).map((y) =>
      mismatch(readPixel(canvas, 75, y), sample((5 / 12 + ((y + 0.5) / 50) * (1 / 6)) * 3 - 0.5), 2, `(75, ${y})`),
    );
    expect(column.filter((m) => m !== null)).toEqual([]);
    // 品目は背景の上に重なる
    const behind = sample((5 / 12 + (25.5 / 50) * (1 / 6)) * 3 - 0.5);
    expectPixel(canvas, 25, 25, over(premul([255, 255, 255, 128]), behind), 2);
  });
});

describe('テクスチャ', () => {
  it('上限を超える画像は縮小して console.warn する（レンダラーの上限を小さくして試す）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas, renderer } = setup(20, 20, { maxTextureSize: 4 });
    renderer.setTextures({ a: await solid(8, 2, [0, 255, 0, 128]) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('8×2 → 4×1');
    renderer.render(model(quad('p', 'a', [0, 0, 20, 20])), VIEW, WHITE_BG);
    expectPixel(canvas, 10, 10, over(premul([0, 255, 0, 128]), WHITE), 2);
  });

  it('MAX_TEXTURE_SIZE を超える画像も縮小して描く', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas, renderer, gl } = setup(20, 20);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    renderer.setTextures({ a: await solid(max + 16, 2, BLUE) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(`${max + 16}×2 → ${max}×2`);
    renderer.render(model(quad('p', 'a', [0, 0, 20, 20])), VIEW, TRANSPARENT);
    expectPixel(canvas, 10, 10, BLUE);
  });

  it('同じ ImageBitmap は作り直さず、外した素材は消す', async () => {
    const { canvas, renderer, gl } = setup(20, 20);
    const red = await solid(2, 2, RED);
    const blue = await solid(2, 2, BLUE);
    const create = vi.spyOn(gl, 'createTexture');
    const remove = vi.spyOn(gl, 'deleteTexture');
    renderer.setTextures({ a: red, b: blue });
    renderer.setTextures({ a: red, b: blue });
    expect(create).toHaveBeenCalledTimes(2);
    renderer.setTextures({ a: blue });
    expect(create).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(2);
    renderer.render(model(quad('p', 'a', [0, 0, 20, 20]), quad('q', 'b', [0, 0, 10, 10])), VIEW, TRANSPARENT);
    expectPixel(canvas, 5, 5, BLUE); // b は無いので描かない
    expectPixel(canvas, 15, 15, BLUE);
  });

  it('画像の無い品目と、頂点の数を超える索引の品目は描かずに続ける', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas, renderer } = setup(20, 20);
    renderer.setTextures({ red: await solid(2, 2, RED) });
    const broken = quad('broken', 'red', [0, 0, 20, 20], { indices: new Uint32Array([0, 1, 9]) });
    const missing = quad('missing', 'nothing', [0, 0, 20, 20]);
    renderer.render(model(broken, missing, quad('ok', 'red', [10, 10, 20, 20])), VIEW, TRANSPARENT);
    renderer.render(model(broken, missing, quad('ok', 'red', [10, 10, 20, 20])), VIEW, TRANSPARENT);
    expectPixel(canvas, 5, 5, CLEAR);
    expectPixel(canvas, 15, 15, RED);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('閉じた ImageBitmap は描かずに警告する', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas, renderer } = setup(20, 20);
    const image = await solid(2, 2, RED);
    image.close();
    renderer.setTextures({ a: image });
    renderer.render(model(quad('p', 'a', [0, 0, 20, 20])), VIEW, TRANSPARENT);
    expectPixel(canvas, 10, 10, CLEAR);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('コンテキストと後片付け', () => {
  it('コンテキストを失って復帰したら、テクスチャを作り直して最後のフレームを描き直す', async () => {
    const { canvas, renderer, gl } = setup(40, 40);
    renderer.setTextures({ red: await solid(2, 2, RED), blue: await solid(2, 2, BLUE) });
    const frame = model(
      quad('s', 'red', [0, 0, 20, 40]),
      quad('t', 'blue', [0, 0, 40, 20], { mask: { sourcePartIds: ['s'], inverted: false } }),
    );
    renderer.render(frame, VIEW, TRANSPARENT);
    expectPixel(canvas, 10, 10, BLUE);

    const ext = gl.getExtension('WEBGL_lose_context')!;
    const lost = new Promise((resolve) => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
    ext.loseContext();
    await lost;
    expect(gl.isContextLost()).toBe(true);
    expect(() => renderer.render(frame, VIEW, TRANSPARENT)).not.toThrow(); // 失っている間は何もしない
    // 失ったイベントの配信が終わるまで restoreContext は効かない（同じタスクの中で呼ぶと無視される）
    await new Promise((resolve) => setTimeout(resolve, 0));

    // レンダラーの復帰の処理（init で登録）のあとに呼ばれるので、描き直したフレームが読める
    const restored = new Promise<Rgba[]>((resolve) =>
      canvas.addEventListener(
        'webglcontextrestored',
        () => resolve([readPixel(canvas, 10, 10), readPixel(canvas, 10, 30), readPixel(canvas, 30, 10)]),
        { once: true },
      ),
    );
    ext.restoreContext();
    const [masked, sourceOnly, outside] = await restored;
    expect(mismatch(masked!, BLUE, 1, '復帰後 (10, 10)')).toBeNull();
    expect(mismatch(sourceOnly!, RED, 1, '復帰後 (10, 30)')).toBeNull();
    expect(mismatch(outside!, CLEAR, 1, '復帰後 (30, 10)')).toBeNull();

    // そのあとの render もふつうに描ける
    renderer.render(model(quad('p', 'blue', [0, 0, 40, 40])), VIEW, TRANSPARENT);
    expectPixel(canvas, 30, 30, BLUE);
  });

  it('dispose で GL のものを消し、同じ canvas で init し直せる', async () => {
    const { canvas, renderer, gl } = setup(40, 40);
    const red = await solid(2, 2, RED);
    const blue = await solid(2, 2, BLUE);
    renderer.setTextures({ red, blue });
    renderer.render(
      model(
        quad('s', 'red', [0, 0, 20, 40]),
        quad('t', 'blue', [0, 0, 40, 40], { mask: { sourcePartIds: ['s'], inverted: false } }),
      ),
      VIEW,
      { type: 'image', image: blue },
    );
    const deleted = {
      texture: vi.spyOn(gl, 'deleteTexture'),
      program: vi.spyOn(gl, 'deleteProgram'),
      buffer: vi.spyOn(gl, 'deleteBuffer'),
      vertexArray: vi.spyOn(gl, 'deleteVertexArray'),
      framebuffer: vi.spyOn(gl, 'deleteFramebuffer'),
    };
    renderer.dispose();
    // 素材 2・背景 1・マスク 1・マスクなしの代わり 1
    expect(deleted.texture).toHaveBeenCalledTimes(5);
    expect(deleted.program).toHaveBeenCalledTimes(2);
    expect(deleted.buffer).toHaveBeenCalledTimes(2);
    expect(deleted.vertexArray).toHaveBeenCalledTimes(1);
    expect(deleted.framebuffer).toHaveBeenCalledTimes(1);
    expect(() => renderer.render(model(), VIEW, TRANSPARENT)).toThrow('init の前に render を呼んだ');

    renderer.init(canvas);
    renderer.setTextures({ red });
    renderer.render(model(quad('p', 'red', [0, 0, 40, 40])), VIEW, TRANSPARENT);
    expectPixel(canvas, 20, 20, RED);
  });
});
