// 出力画面の中でのモデルの配置（ViewTransform の計算）。出力ウィンドウからも使う
import type { Project, Scene, Vec2 } from '@app/schema';
import type { ViewTransform } from '@app/contracts';

export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ModelTransform = Scene['modelTransform'];

export const DEFAULT_OUTPUT_SIZE: Size = { width: 1920, height: 1080 };
export const DEFAULT_MODEL_TRANSFORM: ModelTransform = { position: { x: 0, y: 0 }, scale: 1 };
export const MIN_MODEL_SCALE = 0.05;
export const MAX_MODEL_SCALE = 20;
const FIT_MARGIN = 0.05; // 収めるときに上下左右に残す余白の割合
const FALLBACK_RECT: Rect = { x: 0, y: 0, width: 1000, height: 1000 };

// モデルの外枠。素材の元のキャンバスの大きさ（素材が無ければ 1000×1000）
export function modelRect(project: Project): Rect {
  const size = project.assets[0]?.canvasSize;
  if (!size || size.width <= 0 || size.height <= 0) return FALLBACK_RECT;
  return { x: 0, y: 0, width: size.width, height: size.height };
}

// modelTransform の意味: 倍率 1・位置 (0, 0) のとき、モデルの外枠を出力画面に収めて中央に置く。
// scale はその大きさに掛ける倍率、position はモデルの中心を出力画面の中央から動かす量（出力画面の px）
export function outputView(rect: Rect, t: ModelTransform, size: Size): ViewTransform {
  const fit =
    rect.width > 0 && rect.height > 0
      ? Math.min(size.width / rect.width, size.height / rect.height) * (1 - 2 * FIT_MARGIN)
      : 1;
  const scale = fit * t.scale;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    scale,
    offset: { x: size.width / 2 + t.position.x - cx * scale, y: size.height / 2 + t.position.y - cy * scale },
  };
}

export function clampModelScale(scale: number): number {
  return Math.min(MAX_MODEL_SCALE, Math.max(MIN_MODEL_SCALE, scale));
}

// 出力画面の px で d だけ動かす
export function moveTransform(t: ModelTransform, d: Vec2): ModelTransform {
  return { position: { x: t.position.x + d.x, y: t.position.y + d.y }, scale: t.scale };
}

// 出力画面の点 at の下にあるモデルの点を動かさずに、倍率を factor 倍する
export function zoomTransformAt(t: ModelTransform, size: Size, at: Vec2, factor: number): ModelTransform {
  const scale = clampModelScale(t.scale * factor);
  const k = scale / t.scale;
  // モデルの中心の出力画面での位置を at を中心に k 倍する
  const center = { x: size.width / 2 + t.position.x, y: size.height / 2 + t.position.y };
  const next = { x: at.x + (center.x - at.x) * k, y: at.y + (center.y - at.y) * k };
  return { position: { x: next.x - size.width / 2, y: next.y - size.height / 2 }, scale };
}

// 出力画面（size）を領域（width × height）に縦横比を保って収めた矩形。scale は CSS ピクセル / 出力画面の px
export function fitFrame(size: Size, width: number, height: number): Rect & { scale: number } {
  if (size.width <= 0 || size.height <= 0 || width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  }
  const scale = Math.min(width / size.width, height / size.height);
  const w = size.width * scale;
  const h = size.height * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, scale };
}

// 出力画面の px の view を、k 倍した画面（プレビュー・出力ウィンドウの CSS ピクセル）の view にする
export function scaleView(view: ViewTransform, k: number): ViewTransform {
  return { scale: view.scale * k, offset: { x: view.offset.x * k, y: view.offset.y * k } };
}

export function sameTransform(a: ModelTransform, b: ModelTransform): boolean {
  return a.scale === b.scale && a.position.x === b.position.x && a.position.y === b.position.y;
}
