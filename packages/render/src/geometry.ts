import type { ViewTransform } from '@app/contracts';
import type { Vec2 } from '@app/schema';

// 描画の計算のうち、GL を使わない部分（node でテストする）

export interface Size {
  width: number;
  height: number;
}

// 描画バッファの大きさ = CSS の大きさ × devicePixelRatio。CSS の大きさが 0（DOM に無い・非表示）なら今の大きさのまま
export function drawingBufferSize(css: Size, devicePixelRatio: number, current: Size): Size {
  if (!(css.width > 0) || !(css.height > 0)) return current;
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return { width: Math.max(1, Math.round(css.width * dpr)), height: Math.max(1, Math.round(css.height * dpr)) };
}

// CSS ピクセル → 描画バッファのピクセルの比（縦横それぞれ）。CSS の大きさが 0 なら 1
export function cssToPixelRatio(css: Size, buffer: Size): Vec2 {
  return {
    x: css.width > 0 ? buffer.width / css.width : 1,
    y: css.height > 0 ? buffer.height / css.height : 1,
  };
}

// キャンバス座標 → クリップ座標の一次式（clip = p × scale + offset）。画面の y は下向き、クリップ座標の y は上向き
export function viewToClip(
  view: ViewTransform,
  ratio: Vec2,
  buffer: Size,
): { scale: [number, number]; offset: [number, number] } {
  return {
    scale: [(2 * view.scale * ratio.x) / buffer.width, (-2 * view.scale * ratio.y) / buffer.height],
    offset: [(2 * view.offset.x * ratio.x) / buffer.width - 1, 1 - (2 * view.offset.y * ratio.y) / buffer.height],
  };
}

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

// 縦横比を保って全体を覆うときに見える、画像の中の範囲（uv）。はみ出した分は上下か左右を同じだけ切る
export function coverUv(image: Size, target: Size): UvRect {
  if (!(image.width > 0 && image.height > 0 && target.width > 0 && target.height > 0)) {
    return { u0: 0, v0: 0, u1: 1, v1: 1 };
  }
  const imageAspect = image.width / image.height;
  const targetAspect = target.width / target.height;
  if (imageAspect > targetAspect) {
    const w = targetAspect / imageAspect;
    return { u0: (1 - w) / 2, v0: 0, u1: (1 + w) / 2, v1: 1 };
  }
  const h = imageAspect / targetAspect;
  return { u0: 0, v0: (1 - h) / 2, u1: 1, v1: (1 + h) / 2 };
}

// テクスチャの上限に収まる大きさ。収まるならそのまま。超えるなら縦横比を保って縮める
export function fitTextureSize(size: Size, max: number): Size {
  if (size.width <= max && size.height <= max) return size;
  const s = max / Math.max(size.width, size.height);
  const fit = (n: number) => Math.min(max, Math.max(1, Math.round(n * s)));
  return { width: fit(size.width), height: fit(size.height) };
}

// マスク元の組を表すキー。並びと重複によらず同じ組なら同じ値
export function maskKey(sourcePartIds: readonly string[]): string {
  return JSON.stringify([...new Set(sourcePartIds)].sort());
}
