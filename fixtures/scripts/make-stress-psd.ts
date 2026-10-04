// ストレステスト用の大きな PSD（カード25）を作る。キャンバス 4000×6000px、100レイヤー。
// `pnpm --filter @app/fixtures generate:stress [出力先]`。既定の出力先は fixtures/stress/stress-4000x6000-100.psd（git には入れない）。
// 同じ種から作るので、何度作っても同じ中身になる。レイヤーはグラデーションの図形（圧縮が効きにくい）
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { initializeCanvas, writePsdUint8Array, type Layer, type Psd } from 'ag-psd';

const WIDTH = 4000;
const HEIGHT = 6000;
const LAYERS = 100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'stress');

type PsdCanvas = NonNullable<Layer['canvas']>;
type CreateCanvas = Parameters<typeof initializeCanvas>[0];

// 再現できる乱数（mulberry32）
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeStressPsd(seed = 25): { data: Uint8Array; layers: number } {
  initializeCanvas(((w: number, h: number) => createCanvas(w, h)) as unknown as CreateCanvas);
  const rnd = random(seed);
  const children: Layer[] = [];
  for (let i = 0; i < LAYERS; i++) {
    const w = Math.round(300 + rnd() * 1300);
    const h = Math.round(300 + rnd() * 1300);
    const left = Math.round(rnd() * (WIDTH - w));
    const top = Math.round(rnd() * (HEIGHT - h));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    const hue = Math.round(rnd() * 360);
    g.addColorStop(0, `hsla(${hue}, 70%, 55%, 1)`);
    g.addColorStop(1, `hsla(${(hue + 120) % 360}, 70%, 35%, 0.85)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    if (i % 2 === 0) {
      ctx.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
    } else {
      // ぎざぎざの多角形（髪の束のような形）
      const n = 12 + Math.floor(rnd() * 12);
      for (let k = 0; k < n; k++) {
        const angle = (k / n) * Math.PI * 2;
        const r = 0.35 + rnd() * 0.15;
        const x = w / 2 + Math.cos(angle) * w * r;
        const y = h / 2 + Math.sin(angle) * h * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fill();
    // 細かい模様（ノイズ）を足して圧縮を効きにくくする
    const image = ctx.getImageData(0, 0, w, h);
    for (let p = 0; p < image.data.length; p += 4) {
      if (image.data[p + 3]! === 0) continue;
      const n = Math.floor(rnd() * 24) - 12;
      image.data[p] = Math.min(255, Math.max(0, image.data[p]! + n));
      image.data[p + 1] = Math.min(255, Math.max(0, image.data[p + 1]! + n));
    }
    ctx.putImageData(image, 0, 0);
    children.push({
      name: `layer-${String(i + 1).padStart(3, '0')}`,
      left,
      top,
      canvas: canvas as unknown as PsdCanvas,
    });
  }
  const psd: Psd = { width: WIDTH, height: HEIGHT, children };
  return { data: writePsdUint8Array(psd, { generateThumbnail: false }), layers: LAYERS };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : join(OUT_DIR, 'stress-4000x6000-100.psd');
  mkdirSync(dirname(out), { recursive: true });
  const started = Date.now();
  const { data, layers } = makeStressPsd();
  writeFileSync(out, data);
  console.log(
    `PSD を書き出した: ${out}（${layers} レイヤー、${(data.length / 1024 / 1024).toFixed(1)} MB、${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
  );
}
