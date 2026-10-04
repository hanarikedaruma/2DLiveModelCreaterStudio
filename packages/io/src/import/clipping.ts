// クリッピングの統合（カード32）。クリップ先の画像に、クリッピングされたレイヤーを合成モードと不透明度で重ねる
import type { BlendMode } from '@app/schema';
import type { RgbaImage } from './rgba';

// キャンバスに置いた画像（left・top は画像の左上のキャンバス座標）
export interface PlacedImage {
  left: number;
  top: number;
  image: RgbaImage;
}

export interface ClipLayer extends PlacedImage {
  opacity: number; // 0..1（レイヤーの不透明度 × 塗りの不透明度）
  blendMode: BlendMode;
}

// 分けられる合成の関数 B(下, 上)。値は 0..1 の乗算していない色
const BLEND: Record<BlendMode, (b: number, s: number) => number> = {
  normal: (_b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  add: (b, s) => Math.min(1, b + s), // 覆い焼き（リニア）- 加算
};

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

// クリップ先 base に、クリッピングされたレイヤーを背面から順に重ねて1枚にする。
// 結果はクリップ先と同じ位置・大きさで、アルファはクリップ先のまま（クリップ先のアルファで切り抜く）。
// 色は Photoshop（PDF の合成の定義）と同じく、下のアルファ αb・上のアルファ αs（× 不透明度）で:
//   Cs' = (1 − αb)·Cs + αb·B(Cb, Cs)
//   C   = αs·Cs' + (1 − αs)·Cb
export function mergeClipped(base: PlacedImage, layers: readonly ClipLayer[]): RgbaImage {
  const { width, height } = base.image;
  // 1枚ずつ 8bit に丸めて重ねる（大きなレイヤーでも画素ごとの浮動小数のバッファを持たない）
  const out = new Uint8Array(base.image.data);
  for (const layer of layers) {
    const k = clamp01(layer.opacity);
    if (k <= 0) continue;
    const blend = BLEND[layer.blendMode] ?? BLEND.normal;
    const src = layer.image;
    // 重なる範囲（クリップ先の画像の座標）
    const dx = layer.left - base.left;
    const dy = layer.top - base.top;
    const x0 = Math.max(0, dx);
    const y0 = Math.max(0, dy);
    const x1 = Math.min(width, dx + src.width);
    const y1 = Math.min(height, dy + src.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const bi = (y * width + x) * 4;
        const ab = out[bi + 3]! / 255;
        if (ab === 0) continue;
        const si = ((y - dy) * src.width + (x - dx)) * 4;
        const as = (src.data[si + 3]! / 255) * k;
        if (as === 0) continue;
        for (let c = 0; c < 3; c++) {
          const cb = out[bi + c]! / 255;
          const cs = src.data[si + c]! / 255;
          const mixed = (1 - ab) * cs + ab * blend(cb, cs);
          out[bi + c] = Math.round(clamp01(as * mixed + (1 - as) * cb) * 255);
        }
      }
    }
  }
  return { width, height, data: out };
}

// クリッピングされたレイヤーを、クリップ先のアルファで切り抜く（統合しない非表示のレイヤー用）。
// 結果はレイヤーと同じ位置・大きさで、色はそのまま、アルファ = レイヤーのアルファ × クリップ先のアルファ
export function clipToBase(base: PlacedImage, layer: PlacedImage): RgbaImage {
  const { width, height, data } = layer.image;
  const out = new Uint8Array(data);
  const dx = base.left - layer.left;
  const dy = base.top - layer.top;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 + 3;
      const bx = x - dx;
      const by = y - dy;
      const inside = bx >= 0 && by >= 0 && bx < base.image.width && by < base.image.height;
      const ab = inside ? base.image.data[(by * base.image.width + bx) * 4 + 3]! : 0;
      out[i] = Math.round((data[i]! * ab) / 255);
    }
  }
  return { width, height, data: out };
}
