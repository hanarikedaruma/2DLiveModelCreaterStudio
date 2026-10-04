import type { TrackingFrame } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { applyCalibration, MAX_EYE_CLOSED, MIN_MOUTH_OPEN_MAX, normalizeCalibration } from './calibrate';

const frame: TrackingFrame = {
  time: 0,
  detected: true,
  faceYaw: 15,
  facePitch: -5,
  faceRoll: 8,
  eyeOpenL: 0.6,
  eyeOpenR: 0.2,
  eyeBallX: 0.3,
  eyeBallY: -0.2,
  mouthOpen: 0.3,
  mouthForm: 0.4,
};

const calibration = {
  neutral: { yaw: 5, pitch: -10, roll: 2 },
  eyeClosed: { l: 0.2, r: 0.3 },
  mouthOpenMax: 0.6,
};

describe('applyCalibration', () => {
  it('yaw・pitch・roll から neutral を引く', () => {
    const f = applyCalibration(frame, calibration);
    expect([f.faceYaw, f.facePitch, f.faceRoll]).toEqual([10, 5, 6]);
  });

  it('目は [eyeClosed, 1] を [0, 1] に写す（左右それぞれ）。下は 0 で丸める', () => {
    const f = applyCalibration(frame, calibration);
    expect(f.eyeOpenL).toBeCloseTo(0.5, 9); // (0.6 − 0.2) / 0.8
    expect(f.eyeOpenR).toBe(0); // 0.2 は右目の閉じた値 0.3 より小さい
    const open = applyCalibration({ ...frame, eyeOpenL: 1, eyeOpenR: 1 }, calibration);
    expect([open.eyeOpenL, open.eyeOpenR]).toEqual([1, 1]);
    const closed = applyCalibration({ ...frame, eyeOpenL: 0.2, eyeOpenR: 0.3 }, calibration);
    expect([closed.eyeOpenL, closed.eyeOpenR]).toEqual([0, 0]);
  });

  it('口は [0, mouthOpenMax] を [0, 1] に写す。上は 1 で丸める', () => {
    expect(applyCalibration(frame, calibration).mouthOpen).toBeCloseTo(0.5, 9);
    expect(applyCalibration({ ...frame, mouthOpen: 0.9 }, calibration).mouthOpen).toBe(1);
    expect(applyCalibration({ ...frame, mouthOpen: 0 }, calibration).mouthOpen).toBe(0);
  });

  it('視線・口の形・時刻などほかの値は変えない。null ならフレームをそのまま返す', () => {
    const f = applyCalibration(frame, calibration);
    expect([f.eyeBallX, f.eyeBallY, f.mouthForm, f.time, f.detected]).toEqual([0.3, -0.2, 0.4, 0, true]);
    expect(applyCalibration(frame, null)).toBe(frame);
  });

  it('写像を変えない値（neutral 0・eyeClosed 0・mouthOpenMax 1）なら同じ値', () => {
    const identity = { neutral: { yaw: 0, pitch: 0, roll: 0 }, eyeClosed: { l: 0, r: 0 }, mouthOpenMax: 1 };
    expect(applyCalibration(frame, identity)).toEqual(frame);
  });
});

describe('normalizeCalibration', () => {
  it('ふつうの値はそのまま。null は null', () => {
    expect(normalizeCalibration(calibration)).toEqual(calibration);
    expect(normalizeCalibration(null)).toBeNull();
  });

  it('目を閉じ切れていない値・口をほとんど開けていない値は、ゆるめる（わずかな動きで全部動かないように）', () => {
    const c = normalizeCalibration({ ...calibration, eyeClosed: { l: 0.98, r: -0.1 }, mouthOpenMax: 0.02 })!;
    expect(c.eyeClosed).toEqual({ l: MAX_EYE_CLOSED, r: 0 });
    expect(c.mouthOpenMax).toBe(MIN_MOUTH_OPEN_MAX);
  });

  it('有限でない値は写像を変えない値にする', () => {
    const c = normalizeCalibration({
      neutral: { yaw: Number.NaN, pitch: Number.POSITIVE_INFINITY, roll: 1 },
      eyeClosed: { l: Number.NaN, r: 0.1 },
      mouthOpenMax: Number.NaN,
    })!;
    expect(c).toEqual({ neutral: { yaw: 0, pitch: 0, roll: 1 }, eyeClosed: { l: 0, r: 0.1 }, mouthOpenMax: 1 });
  });
});
