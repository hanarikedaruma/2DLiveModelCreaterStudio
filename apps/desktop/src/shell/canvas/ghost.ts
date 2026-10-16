// 透かし（I-070）。［透かし］を押したときの形を止めて、色で染めて今の絵の上に薄く重ねる。
// renderer は1つのまま、透かしの形を先に描いてすぐ2Dの絵へ写し、そのあと今の形を描く。
// 濃さと色は透かしの横で選べる（I-082）。見ている人ごとの好みとして覚える（保存できない環境では覚えない）
import type { DeformedModel, DrawItem, Renderer, ViewTransform } from '@app/contracts';

// 色の選択肢。染める色の強さは同じ（絵の線が少し残る）
export const GHOST_COLORS = [
  { id: 'blue', label: '青', rgb: '70, 150, 255' },
  { id: 'red', label: '赤', rgb: '255, 70, 70' },
  { id: 'green', label: '緑', rgb: '40, 210, 110' },
  { id: 'yellow', label: '黄', rgb: '255, 210, 0' },
  { id: 'white', label: '白', rgb: '255, 255, 255' },
  { id: 'black', label: '黒', rgb: '0, 0, 0' },
] as const;
export type GhostColorId = (typeof GHOST_COLORS)[number]['id'];

export const GHOST_OPACITY = 0.5; // 濃さの既定
export const GHOST_OPACITY_MIN = 0.1;
export const GHOST_OPACITY_MAX = 0.9;
const TINT_STRENGTH = 0.75;

export interface GhostStyle {
  opacity: number;
  color: GhostColorId;
}

export const DEFAULT_GHOST_STYLE: GhostStyle = { opacity: GHOST_OPACITY, color: 'blue' };
const STYLE_KEY = 'live2d-studio.ghostStyle';

const clampOpacity = (v: number) => Math.min(GHOST_OPACITY_MAX, Math.max(GHOST_OPACITY_MIN, v));

export function readGhostStyle(): GhostStyle {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STYLE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULT_GHOST_STYLE;
    const { opacity, color } = raw as Partial<GhostStyle>;
    return {
      opacity: typeof opacity === 'number' && Number.isFinite(opacity) ? clampOpacity(opacity) : GHOST_OPACITY,
      color: GHOST_COLORS.some((c) => c.id === color) ? color! : DEFAULT_GHOST_STYLE.color,
    };
  } catch {
    return DEFAULT_GHOST_STYLE;
  }
}

export function saveGhostStyle(style: GhostStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    // 覚えられなくても動作は続ける
  }
}

export function ghostTint(color: GhostColorId): string {
  const rgb = GHOST_COLORS.find((c) => c.id === color)?.rgb ?? GHOST_COLORS[0].rgb;
  return `rgba(${rgb}, ${TINT_STRENGTH})`;
}

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
  tint: string;
  image: HTMLCanvasElement;
}

const sameView = (a: ViewTransform, b: ViewTransform) =>
  a.scale === b.scale && a.offset.x === b.offset.x && a.offset.y === b.offset.y;

// 透かしの絵。止めた形・表示・キャンバスの大きさ・色が変わったときだけ main に描いて写す
// （WebGL の絵は、描いたのと同じタスクの中なら写せる）。呼んだあとは、今の形を描き直すこと
export function ghostImage(
  cache: GhostImage | null,
  ghost: DeformedModel,
  view: ViewTransform,
  main: HTMLCanvasElement,
  renderer: Renderer,
  tint: string = ghostTint(DEFAULT_GHOST_STYLE.color),
): GhostImage {
  if (
    cache &&
    cache.source === ghost &&
    sameView(cache.view, view) &&
    cache.width === main.width &&
    cache.height === main.height &&
    cache.tint === tint
  )
    return cache;
  renderer.render(ghost, view, { type: 'transparent' });
  const image = cache?.image ?? document.createElement('canvas');
  copyTinted(main, image, tint);
  return { source: ghost, view, width: main.width, height: main.height, tint, image };
}

// source の絵を target へ写し、絵のある所だけ染める（透明な所は透明のまま）
export function copyTinted(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  tint: string = ghostTint(DEFAULT_GHOST_STYLE.color),
): void {
  if (target.width !== source.width) target.width = source.width;
  if (target.height !== source.height) target.height = source.height;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.restore();
}

// 重ね描きの最初に、透かしの絵を実ピクセルのまま薄く重ねる
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  opacity: number = GHOST_OPACITY,
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();
}
