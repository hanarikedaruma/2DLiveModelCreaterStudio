import type { TrackingFrame } from '@app/contracts';

// 推定の結果を TrackingFrame の値に直す純粋関数。符号と左右は TrackingFrame の約束（ユーザー自身から見た向き・左右）

// 顔の向き（度）
export interface FaceAngles {
  yaw: number; // ユーザーが自分の右を向くと正
  pitch: number; // 上を向くと正
  roll: number; // ユーザーが自分の右へ傾けると正
}

// MediaPipe の facialTransformationMatrixes[i].data。4×4 の列優先（three.js の Matrix4.fromArray と同じ並び）
// 空間はカメラの座標（右手系、cm）: x = 映像の右（= ユーザーの左）、y = 上、z = カメラへ向かう向き。
// 顔の座標（正準の顔モデル）も同じ向きで、顔がカメラの正面を向くと回転なし。顔の前が +z、頭の上が +y。
// 回転を R = Ry(a)·Rx(b)·Rz(c)（カメラの軸のまわりの右ねじ）に分けると、
//   ユーザーの右を向く = 顔の前が −x へ向く = a が負 → yaw = −a
//   上を向く = 顔の前が +y へ向く = b が負 → pitch = −b
//   ユーザーの右へ傾ける = 頭の上が −x へ倒れる = c が正 → roll = c
// 倍率が掛かっていても角度は変わらないように、atan2 だけで求める。16個に満たないときは null
export function matrixToAngles(data: ArrayLike<number>): FaceAngles | null {
  if (data.length < 16) return null;
  const m = (row: number, col: number): number => data[col * 4 + row] ?? 0;
  const yaw = Math.atan2(-m(0, 2), m(2, 2));
  const pitch = Math.atan2(m(1, 2), Math.hypot(m(1, 0), m(1, 1)));
  const roll = Math.atan2(m(1, 0), m(1, 1));
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(roll)) return null;
  return { yaw: toDegrees(yaw), pitch: toDegrees(pitch), roll: toDegrees(roll) };
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI + 0; // −0 を 0 にする
}

// faceBlendshapes[i].categories の1つ
export interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

// mouthForm・mouthWidth・browY は TrackingFrame では任意（STEP1）だが、ブレンドシェイプからは必ず求める
export type BlendshapeValues = Pick<TrackingFrame, 'eyeOpenL' | 'eyeOpenR' | 'eyeBallX' | 'eyeBallY' | 'mouthOpen'> &
  Required<Pick<TrackingFrame, 'mouthForm' | 'mouthWidth' | 'browY'>>;

// MediaPipe のブレンドシェイプ（ARKit と同じ名前）の Left / Right が、ユーザー自身のどちらの側か。
// 公式の説明では被写体自身の左右（eyeBlinkLeft = 被写体の左目）。実機で確かめること。
// 逆だったときは、ここの2行を入れ替えれば目の開きと視線の左右がそろって入れ替わる
export const BLENDSHAPE_SIDE_OF_USER = {
  left: 'Left',
  right: 'Right',
} as const satisfies Record<'left' | 'right', 'Left' | 'Right'>;

// ブレンドシェイプから目・視線・口・眉の値を求める。無い名前は 0 として扱う
//   eyeOpenL・R = 1 − eyeBlink（ユーザー自身の左目・右目）
//   eyeBallX = ユーザーの右を見る量 − 左を見る量。右を見るとき、左目は内（鼻の側）、右目は外を向く
//   eyeBallY = 上を見る量 − 下を見る量（両目の平均）
//   mouthOpen = jawOpen
//   mouthForm = (mouthSmileLeft + mouthSmileRight)/2 − (mouthFrownLeft + mouthFrownRight)/2（への字 −1 〜 笑顔 1）
//   mouthWidth = (mouthStretchLeft + mouthStretchRight)/2 − mouthPucker（すぼめ −1 〜 横に開く 1）
//   browY = browInnerUp − (browDownLeft + browDownRight)/2（下げる −1 〜 上げる 1）
//   いずれも左右の平均なので、Left / Right の取り違えに左右されない。−1..1 に丸める
export function blendshapesToFrame(categories: readonly BlendshapeCategory[]): BlendshapeValues {
  const scores = new Map<string, number>();
  for (const c of categories) scores.set(c.categoryName, clamp(c.score, 0, 1));
  const s = (name: string): number => scores.get(name) ?? 0;
  const L = BLENDSHAPE_SIDE_OF_USER.left;
  const R = BLENDSHAPE_SIDE_OF_USER.right;
  const both = (name: string): number => (s(`${name}${L}`) + s(`${name}${R}`)) / 2;
  const toUserRight = (s(`eyeLookIn${L}`) + s(`eyeLookOut${R}`)) / 2;
  const toUserLeft = (s(`eyeLookOut${L}`) + s(`eyeLookIn${R}`)) / 2;
  const up = both('eyeLookUp');
  const down = both('eyeLookDown');
  return {
    eyeOpenL: 1 - s(`eyeBlink${L}`),
    eyeOpenR: 1 - s(`eyeBlink${R}`),
    eyeBallX: clamp(toUserRight - toUserLeft, -1, 1) + 0,
    eyeBallY: clamp(up - down, -1, 1) + 0,
    mouthOpen: s('jawOpen'),
    mouthForm: clamp(both('mouthSmile') - both('mouthFrown'), -1, 1) + 0,
    mouthWidth: clamp(both('mouthStretch') - s('mouthPucker'), -1, 1) + 0,
    browY: clamp(s('browInnerUp') - both('browDown'), -1, 1) + 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

// FaceLandmarker の結果のうち使うところ（@mediapipe/tasks-vision の FaceLandmarkerResult と同じ形）
export interface LandmarkerResultLike {
  faceBlendshapes: readonly { categories: readonly BlendshapeCategory[] }[];
  facialTransformationMatrixes: readonly { data: ArrayLike<number> }[];
}

// まだ何も推定していないときの値（正面・目を開け・口を閉じた状態）
export const NEUTRAL_TRACKING_FRAME: Readonly<TrackingFrame> = Object.freeze({
  time: 0,
  detected: false,
  faceYaw: 0,
  facePitch: 0,
  faceRoll: 0,
  eyeOpenL: 1,
  eyeOpenR: 1,
  eyeBallX: 0,
  eyeBallY: 0,
  mouthOpen: 0,
});

// 推定の結果を1フレームにする。顔が無ければ detected false で、ほかの値は前回のまま。
// 顔があっても片方の出力が欠けたときは、その値だけ前回のまま
export function landmarkerResultToFrame(
  result: LandmarkerResultLike,
  time: number,
  previous: Readonly<TrackingFrame>,
): TrackingFrame {
  const blendshapes = result.faceBlendshapes[0];
  const matrix = result.facialTransformationMatrixes[0];
  if (!blendshapes && !matrix) return { ...previous, time, detected: false };
  const angles = matrix ? matrixToAngles(matrix.data) : null;
  const face = blendshapes ? blendshapesToFrame(blendshapes.categories) : null;
  return {
    ...previous,
    ...(face ?? {}),
    ...(angles ? { faceYaw: angles.yaw, facePitch: angles.pitch, faceRoll: angles.roll } : {}),
    time,
    detected: true,
  };
}
