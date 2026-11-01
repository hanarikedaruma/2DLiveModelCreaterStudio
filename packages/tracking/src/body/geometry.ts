// 観測の幾何（AT-05）。推定器の点は未反転の画像の 0..1 なので、幅・高さを掛けて px に戻してから距離と角度を求める。
// 縦横比の違う 0..1 の座標をそのまま角度に使わない。
import type { BodyPoint, PosePoint } from '@app/contracts';
import type { Vec2 } from '@app/schema';

export type ActorSide = 'left' | 'right'; // 演者自身の左右

// MediaPipe Pose の点の番号（演者自身の左右）
export const POSE_POINT = {
  nose: 0,
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
} as const;
export const HAND_WRIST = 0;

export const VISIBLE = 0.5; // Pose の visibility がこれ以上で、画面の中なら見えている

export interface Image {
  width: number;
  height: number;
}

export function toPx(p: Vec2, image: Image): Vec2 {
  return { x: p.x * image.width, y: p.y * image.height };
}

export function finitePoint(p: { x: number; y: number; z?: number } | undefined): boolean {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z));
}

// Pose の点が見えているか（visibility・画面の中・有限）
export function poseVisible(p: PosePoint | undefined): p is PosePoint {
  return (
    !!p &&
    finitePoint(p) &&
    Number.isFinite(p.visibility) &&
    p.visibility >= VISIBLE &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const length = (v: Vec2): number => Math.hypot(v.x, v.y);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

// 肩の線の座標系。axis は演者の右肩→左肩（未反転の画像では画面の右向き）、down は axis を時計回りに90°回した向き
export interface ShoulderFrame {
  left: Vec2; // 演者の左肩（px）
  right: Vec2;
  center: Vec2;
  axis: Vec2; // 単位ベクトル
  down: Vec2; // 単位ベクトル
  width: number; // 肩幅（px）
}

export function shoulderFrame(left: Vec2, right: Vec2): ShoulderFrame | null {
  const v = sub(left, right);
  const width = length(v);
  if (!(width > 1e-6)) return null;
  const axis = { x: v.x / width, y: v.y / width };
  return {
    left,
    right,
    center: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
    axis,
    down: { x: -axis.y, y: axis.x },
    width,
  };
}

// 演者のその側の外向き（右腕なら右肩の外＝ −axis、左腕なら +axis）
export function outward(frame: ShoulderFrame, side: ActorSide): Vec2 {
  return side === 'left' ? frame.axis : { x: -frame.axis.x, y: -frame.axis.y };
}

// 肩を原点に、外向き +x・下向き +y、腕の長さ（上腕＋前腕）を1にした座標へ直す
export function normalize(p: Vec2, frame: ShoulderFrame, side: ActorSide, armLength: number): Vec2 {
  const origin = side === 'left' ? frame.left : frame.right;
  const out = outward(frame, side);
  const d = sub(p, origin);
  return {
    x: (d.x * out.x + d.y * out.y) / armLength,
    y: (d.x * frame.down.x + d.y * frame.down.y) / armLength,
  };
}

// 手の点（0..1、z は x と同じ尺度）を同じ座標へ。z は奥行きの目安として x と同じ尺度で直す
export function normalizeHandPoint(
  p: BodyPoint,
  image: Image,
  frame: ShoulderFrame,
  side: ActorSide,
  armLength: number,
): BodyPoint {
  const xy = normalize(toPx(p, image), frame, side, armLength);
  return { ...xy, z: (p.z * image.width) / armLength };
}
