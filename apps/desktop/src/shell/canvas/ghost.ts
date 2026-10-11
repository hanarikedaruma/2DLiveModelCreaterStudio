// 透かし（I-070）。［透かし］を押したときの形を止めて、青く染めて今の絵の上に薄く重ねる。
// renderer は1つのまま、透かしの形を先に描いてすぐ2Dの絵へ写し、そのあと今の形を描く
import type { DeformedModel, DrawItem, Renderer, ViewTransform } from '@app/contracts';

export const GHOST_OPACITY = 0.35;
const GHOST_TINT = 'rgba(70, 150, 255, 0.7)';

// 押したときの形を止める。頂点の配列は写す（あとで同じ配列に書き込まれても、透かしは変わらない）
export function freezeDeformed(model: DeformedModel): DeformedModel {
  const copies = new Map<DrawItem, DrawItem>(
    model.items.map((item) => [item, { ...item, positions: item.positions.slice() }]),
  );
  const byPartId: Record<string, DrawItem> = {};
  for (const [id, item] of Object.entries(model.byPartId)) byPartId[id] = copies.get(item) ?? item;
  return { items: model.items.map((item) => copies.get(item)!), byPartId };
}

export interface GhostImage {
  source: DeformedModel;
  view: ViewTransform;
  width: number;
  height: number;
  image: HTMLCanvasElement;
}

const sameView = (a: ViewTransform, b: ViewTransform) =>
  a.scale === b.scale && a.offset.x === b.offset.x && a.offset.y === b.offset.y;

// 透かしの絵。止めた形・表示・キャンバスの大きさが変わったときだけ main に描いて写す
// （WebGL の絵は、描いたのと同じタスクの中なら写せる）。呼んだあとは、今の形を描き直すこと
export function ghostImage(
  cache: GhostImage | null,
  ghost: DeformedModel,
  view: ViewTransform,
  main: HTMLCanvasElement,
  renderer: Renderer,
): GhostImage {
  if (
    cache &&
    cache.source === ghost &&
    sameView(cache.view, view) &&
    cache.width === main.width &&
    cache.height === main.height
  )
    return cache;
  renderer.render(ghost, view, { type: 'transparent' });
  const image = cache?.image ?? document.createElement('canvas');
  copyTinted(main, image);
  return { source: ghost, view, width: main.width, height: main.height, image };
}

// source の絵を target へ写し、絵のある所だけ青く染める（透明な所は透明のまま）
export function copyTinted(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
  if (target.width !== source.width) target.width = source.width;
  if (target.height !== source.height) target.height = source.height;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = GHOST_TINT;
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.restore();
}

// 重ね描きの最初に、透かしの絵を実ピクセルのまま薄く重ねる
export function drawGhost(ctx: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = GHOST_OPACITY;
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();
}
