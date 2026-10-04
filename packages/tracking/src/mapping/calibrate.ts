import type { TrackingFrame } from '@app/contracts';
import type { Environment } from '@app/schema';
import { clamp } from './map';

export type TrackingCalibration = NonNullable<Environment['calibration']>;

// 目を閉じたときの開きがこれより大きい（目を閉じ切れていない・推定が外れた）ときは、これとして扱う。
// 1 に近いと、目のわずかな動きで開閉が全部動いてしまうため
export const MAX_EYE_CLOSED = 0.9;
// 口を大きく開けたときの開きがこれより小さいときは、これとして扱う（同じ理由）
export const MIN_MOUTH_OPEN_MAX = 0.1;

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

// 壊れた値（NaN など）を、写像を変えない値に直したキャリブレーション。null はそのまま
export function normalizeCalibration(c: Environment['calibration']): TrackingCalibration | null {
  if (!c) return null;
  return {
    neutral: {
      yaw: finiteOr(c.neutral.yaw, 0),
      pitch: finiteOr(c.neutral.pitch, 0),
      roll: finiteOr(c.neutral.roll, 0),
    },
    eyeClosed: {
      l: clamp(finiteOr(c.eyeClosed.l, 0), 0, MAX_EYE_CLOSED),
      r: clamp(finiteOr(c.eyeClosed.r, 0), 0, MAX_EYE_CLOSED),
    },
    mouthOpenMax: clamp(finiteOr(c.mouthOpenMax, 1), MIN_MOUTH_OPEN_MAX, 1),
  };
}

export function sameCalibration(a: TrackingCalibration | null, b: TrackingCalibration | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.neutral.yaw === b.neutral.yaw &&
    a.neutral.pitch === b.neutral.pitch &&
    a.neutral.roll === b.neutral.roll &&
    a.eyeClosed.l === b.eyeClosed.l &&
    a.eyeClosed.r === b.eyeClosed.r &&
    a.mouthOpenMax === b.mouthOpenMax
  );
}

// [lo, hi] を [0, 1] に写して丸める
function remap01(x: number, lo: number, hi: number): number {
  return clamp((x - lo) / (hi - lo), 0, 1);
}

// キャリブレーションを推定のフレーム（ユーザー自身から見た向き・左右。ミラーの前）に当てる。
//   向き: yaw・pitch・roll から neutral を引く
//   目: [eyeClosed, 1] を [0, 1] に（ユーザー自身の左目・右目それぞれ）
//   口: [0, mouthOpenMax] を [0, 1] に
// c は normalizeCalibration を通したもの。null ならフレームをそのまま返す
export function applyCalibration(frame: TrackingFrame, c: TrackingCalibration | null): TrackingFrame {
  if (!c) return frame;
  return {
    ...frame,
    faceYaw: frame.faceYaw - c.neutral.yaw,
    facePitch: frame.facePitch - c.neutral.pitch,
    faceRoll: frame.faceRoll - c.neutral.roll,
    eyeOpenL: remap01(frame.eyeOpenL, c.eyeClosed.l, 1),
    eyeOpenR: remap01(frame.eyeOpenR, c.eyeClosed.r, 1),
    mouthOpen: remap01(frame.mouthOpen, 0, c.mouthOpenMax),
  };
}
