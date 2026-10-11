// 操作中の対象を固定する（I-069）。選んでいるものの操作範囲（枠・メッシュ・格子）と、そのまわりの余白の中では、
// 押しても別のパーツへ切り替えない。余白は画面のピクセルで決める（拡大縮小しても指で押す感覚は同じ）。
// 余白より外で別のパーツの上にマウスがあるときは、押すと切り替わる先を点線で囲んで名前を出す（対象を選ぶ段と同じ見た目）
import type { Model, Vec2 } from '@app/schema';
import type { DeformedModel, ViewTransform } from '@app/contracts';
import { drawPickOutline, partOutline } from '../../../shell/canvas/banner';
import { canvasToScreen } from '../../../shell/canvas/view';

export const RANGE_MARGIN = 24; // 画面のピクセル

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy;
  const t = len < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// 多角形の中か（向きは問わない。偶奇で数える）
function insidePolygon(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 点 p（画面座標）が多角形 poly（画面座標）の中か、縁から margin 以内か
export function nearPolygon(poly: readonly Vec2[], p: Vec2, margin = RANGE_MARGIN): boolean {
  if (poly.length === 0) return false;
  if (poly.length >= 3 && insidePolygon(poly, p)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (segmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!) <= margin) return true;
  }
  return false;
}

// 点 p（画面座標）が三角形の集まり（頂点は画面座標）の中か、どれかの三角形から margin 以内か
export function nearTriangles(
  points: readonly Vec2[],
  triangles: readonly (readonly [number, number, number])[],
  p: Vec2,
  margin = RANGE_MARGIN,
): boolean {
  for (const [i, j, k] of triangles) {
    const a = points[i],
      b = points[j],
      c = points[k];
    if (!a || !b || !c) continue;
    const s1 = cross(a, b, p),
      s2 = cross(b, c, p),
      s3 = cross(c, a, p);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
  }
  for (const [i, j, k] of triangles) {
    const a = points[i],
      b = points[j],
      c = points[k];
    if (!a || !b || !c) continue;
    if (segmentDistance(p, a, b) <= margin || segmentDistance(p, b, c) <= margin || segmentDistance(p, c, a) <= margin)
      return true;
  }
  return false;
}

// 点 p（画面座標）が矩形（画面座標）の中か、縁から margin 以内か
export function nearRect(min: Vec2, max: Vec2, p: Vec2, margin = RANGE_MARGIN): boolean {
  return p.x >= min.x - margin && p.x <= max.x + margin && p.y >= min.y - margin && p.y <= max.y + margin;
}

// キャンバス座標の点を画面座標へ
export function toScreen(view: ViewTransform, points: readonly Vec2[]): Vec2[] {
  return points.map((p) => canvasToScreen(view, p));
}

// 押すと切り替わる先の予告。パーツ（グループなら子孫ごと）を点線で囲み、名前を出す
export function drawSwitchHint(
  ctx: CanvasRenderingContext2D,
  model: Model,
  deformed: DeformedModel | null,
  view: ViewTransform,
  partId: string,
): void {
  if (!deformed) return;
  const outline = partOutline(model, deformed, view, partId);
  const name = model.parts.find((p) => p.id === partId)?.name;
  if (outline && name !== undefined) drawPickOutline(ctx, outline.min, outline.max, name);
}
