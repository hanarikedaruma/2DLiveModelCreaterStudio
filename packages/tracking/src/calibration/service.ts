import type { CalibrationService, CalibrationStep, TrackingFrame } from '@app/contracts';
import type { Environment } from '@app/schema';

type Calibration = NonNullable<Environment['calibration']>;

// values の p（0..1）分位数。並べた値の間は線形に補う（p 0.5 で中央値。個数が偶数なら真ん中の2つの平均）。
// 空なら NaN
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

export const MOUTH_OPEN_PERCENTILE = 0.9;

// 検出できたフレームの、その項目の有限の値
function finite(frames: readonly TrackingFrame[], pick: (f: TrackingFrame) => number): number[] {
  return frames.map(pick).filter((v) => Number.isFinite(v));
}

// キャリブレーション（カード35）。手順ごとに、検出できたフレームから値を求める:
//   neutral（正面を向く）: yaw・pitch・roll の中央値
//   eyesClosed（目を閉じる）: 左目・右目の開きの中央値
//   mouthOpen（口を大きく開ける）: 口の開きの 90 パーセンタイル（いちばん大きな値は外れ値のことがあるので使わない）
// 使えるフレームが無い手順は、前に取った値のまま。何も取っていなければ result() は null。
// 取っていない手順は、写像を変えない値（neutral 0・eyeClosed 0・mouthOpenMax 1）で埋める
export function createCalibrationService(): CalibrationService {
  let neutral: Calibration['neutral'] | null = null;
  let eyeClosed: Calibration['eyeClosed'] | null = null;
  let mouthOpenMax: number | null = null;

  return {
    capture(step: CalibrationStep, frames: TrackingFrame[]): void {
      const detected = frames.filter((f) => f.detected);
      switch (step) {
        case 'neutral': {
          const yaw = finite(detected, (f) => f.faceYaw);
          const pitch = finite(detected, (f) => f.facePitch);
          const roll = finite(detected, (f) => f.faceRoll);
          if (yaw.length > 0 && pitch.length > 0 && roll.length > 0)
            neutral = { yaw: median(yaw), pitch: median(pitch), roll: median(roll) };
          return;
        }
        case 'eyesClosed': {
          const l = finite(detected, (f) => f.eyeOpenL);
          const r = finite(detected, (f) => f.eyeOpenR);
          if (l.length > 0 && r.length > 0) eyeClosed = { l: median(l), r: median(r) };
          return;
        }
        case 'mouthOpen': {
          const mouth = finite(detected, (f) => f.mouthOpen);
          if (mouth.length > 0) mouthOpenMax = percentile(mouth, MOUTH_OPEN_PERCENTILE);
          return;
        }
      }
    },
    result(): Environment['calibration'] {
      if (neutral === null && eyeClosed === null && mouthOpenMax === null) return null;
      return {
        neutral: neutral ? { ...neutral } : { yaw: 0, pitch: 0, roll: 0 },
        eyeClosed: eyeClosed ? { ...eyeClosed } : { l: 0, r: 0 },
        mouthOpenMax: mouthOpenMax ?? 1,
      };
    },
    reset(): void {
      neutral = null;
      eyeClosed = null;
      mouthOpenMax = null;
    },
  };
}
