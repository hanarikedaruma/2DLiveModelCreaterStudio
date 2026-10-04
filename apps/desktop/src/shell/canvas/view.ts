// 表示の変換（画面座標（CSSピクセル）= キャンバス座標 × scale + offset）
import type { Vec2 } from '@app/schema';
import type { DeformedModel, ViewTransform } from '@app/contracts';

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;

export function screenToCanvas(view: ViewTransform, p: Vec2): Vec2 {
  return { x: (p.x - view.offset.x) / view.scale, y: (p.y - view.offset.y) / view.scale };
}

export function canvasToScreen(view: ViewTransform, p: Vec2): Vec2 {
  return { x: p.x * view.scale + view.offset.x, y: p.y * view.scale + view.offset.y };
}

// 画面上の点 at を動かさずに倍率を factor 倍する
export function zoomAt(view: ViewTransform, at: Vec2, factor: number): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const c = screenToCanvas(view, at);
  return { scale, offset: { x: at.x - c.x * scale, y: at.y - c.y * scale } };
}

export function pan(view: ViewTransform, d: Vec2): ViewTransform {
  return { scale: view.scale, offset: { x: view.offset.x + d.x, y: view.offset.y + d.y } };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// rect を画面（width × height）の中央に、margin の割合だけ余白を残して収める
export function fitRect(rect: Rect, width: number, height: number, margin = 0.05): ViewTransform {
  if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return { scale: 1, offset: { x: 0, y: 0 } };
  const scale = Math.min((width * (1 - 2 * margin)) / rect.width, (height * (1 - 2 * margin)) / rect.height);
  return {
    scale,
    offset: {
      x: (width - rect.width * scale) / 2 - rect.x * scale,
      y: (height - rect.height * scale) / 2 - rect.y * scale,
    },
  };
}

// 変形後の頂点を囲む矩形
export function boundsOf(model: DeformedModel): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of model.items) {
    for (let i = 0; i + 1 < item.positions.length; i += 2) {
      const x = item.positions[i]!;
      const y = item.positions[i + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
