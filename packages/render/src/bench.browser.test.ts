// 60個・頂点 5,040 の描画の時間を測る（参考値。基準PCでの 60fps の確認は手動）。
// 1フレームごとに readPixels で GPU の完了を待つので、実際のフレームより重めに出る
import type { DrawItem, ViewTransform } from '@app/contracts';
import { afterEach, expect, it } from 'vitest';
import { bitmap, cleanupAll, model, readPixel, setup } from './test-helpers';

afterEach(cleanupAll);

const COLUMNS = 6;
const ROWS = 11; // 7 × 12 = 84 頂点。60 個で 5,040 頂点
const ITEMS = 60;

// 格子のメッシュ（キャンバス座標の矩形）
function gridItem(index: number, assetId: string, x: number, y: number, size: number): DrawItem {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c <= COLUMNS; c++) {
      positions.push(x + (c / COLUMNS) * size, y + (r / ROWS) * size);
      uvs.push(c / COLUMNS, r / ROWS);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS; c++) {
      const a = r * (COLUMNS + 1) + c;
      const b = a + COLUMNS + 1;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  return {
    partId: `p${index}`,
    assetId,
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    opacity: index % 7 === 0 ? 0.8 : 1,
    blendMode: 'normal',
    // 10 個はマスクあり（マスク元の組は 3 種類。1つは反転）
    mask: index >= 50 ? { sourcePartIds: [`p${index % 3}`, `p${(index % 3) + 3}`], inverted: index % 3 === 2 } : null,
  };
}

it('60個・頂点 5,040 の描画の時間（1920×1080。参考値）', async () => {
  const { canvas, renderer, gl } = setup(1920, 1080);
  const images: Record<string, ImageBitmap> = {};
  for (let i = 0; i < 8; i++) {
    // 512×512 の、縁がぼけた円
    images[`a${i}`] = await bitmap(512, 512, (x, y) => {
      const d = Math.hypot(x - 256, y - 256) / 256;
      return [(i * 40) % 256, 128, 255 - i * 30, Math.round(255 * Math.min(1, Math.max(0, (1 - d) * 4)))];
    });
  }
  renderer.setTextures(images);
  const items = Array.from({ length: ITEMS }, (_, i) =>
    gridItem(i, `a${i % 8}`, (i % 10) * 180, Math.floor(i / 10) * 170, 360),
  );
  expect(items.reduce((n, it) => n + it.positions.length / 2, 0)).toBe(5040);
  const frame = model(...items);
  const view: ViewTransform = { scale: 1, offset: { x: 0, y: 0 } };
  const base = items.map((it) => it.positions.slice());

  // 毎フレーム頂点を動かす（変形の結果が毎回変わる想定）
  const step = (t: number) => {
    for (const [k, it] of items.entries()) {
      const src = base[k]!;
      for (let i = 0; i < src.length; i += 2) {
        it.positions[i] = src[i]! + Math.sin(t * 0.1 + i) * 3;
        it.positions[i + 1] = src[i + 1]! + Math.cos(t * 0.1 + i) * 3;
      }
    }
  };

  for (let t = 0; t < 10; t++) {
    step(t);
    renderer.render(frame, view, { type: 'color', color: '#ffffff' });
    readPixel(canvas, 0, 0);
  }
  const FRAMES = 120;
  const total: number[] = [];
  const cpu: number[] = [];
  for (let t = 0; t < FRAMES; t++) {
    step(t);
    const t0 = performance.now();
    renderer.render(frame, view, { type: 'color', color: '#ffffff' });
    const t1 = performance.now();
    readPixel(canvas, 960, 540); // GPU の完了を待つ
    total.push(performance.now() - t0);
    cpu.push(t1 - t0);
  }
  const sorted = [...total].sort((a, b) => a - b);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  console.log(
    `[ベンチ] 60個・5,040頂点・マスク10個・${canvas.width}×${canvas.height}: ` +
      `1フレーム 平均 ${avg(total).toFixed(2)} ms / 中央値 ${sorted[FRAMES >> 1]!.toFixed(2)} ms / ` +
      `95% ${sorted[Math.floor(FRAMES * 0.95)]!.toFixed(2)} ms / 最大 ${sorted[FRAMES - 1]!.toFixed(2)} ms` +
      `（render の CPU 平均 ${avg(cpu).toFixed(2)} ms）GPU: ${gpu}`,
  );
  // 描けていること（中央は品目で覆われている）
  renderer.render(frame, view, { type: 'transparent' });
  expect(readPixel(canvas, 960, 540)[3]).toBeGreaterThan(0);
});
