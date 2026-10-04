import type { TrackingFrame } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { createCalibrationService, median, percentile } from './service';

function frame(patch: Partial<TrackingFrame> = {}): TrackingFrame {
  return {
    time: 0,
    detected: true,
    faceYaw: 0,
    facePitch: 0,
    faceRoll: 0,
    eyeOpenL: 1,
    eyeOpenR: 1,
    eyeBallX: 0,
    eyeBallY: 0,
    mouthOpen: 0,
    ...patch,
  };
}

describe('percentile・median', () => {
  it('中央値: 奇数個は真ん中、偶数個は真ん中の2つの平均（並べ替えてから）', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('90 パーセンタイルは並べた値の間を線形に補う', () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.9)).toBeCloseTo(9, 9);
    expect(percentile([0, 10], 0.9)).toBeCloseTo(9, 9);
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 1)).toBe(3);
  });

  it('空なら NaN。渡した配列は並べ替えない', () => {
    expect(percentile([], 0.5)).toBeNaN();
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('createCalibrationService', () => {
  it('何も取っていなければ null', () => {
    expect(createCalibrationService().result()).toBeNull();
  });

  it('neutral は yaw・pitch・roll それぞれの中央値（外れ値に引きずられない）', () => {
    const c = createCalibrationService();
    c.capture('neutral', [
      frame({ faceYaw: 4, facePitch: -2, faceRoll: 1 }),
      frame({ faceYaw: 5, facePitch: -3, faceRoll: 2 }),
      frame({ faceYaw: 6, facePitch: -4, faceRoll: 3 }),
      frame({ faceYaw: 40, facePitch: 30, faceRoll: -20 }), // 一瞬だけ大きく外れた
      frame({ faceYaw: 5.5, facePitch: -3.5, faceRoll: 2.5 }),
    ]);
    expect(c.result()?.neutral).toEqual({ yaw: 5.5, pitch: -3, roll: 2 });
  });

  it('eyesClosed は左目・右目の開きの中央値', () => {
    const c = createCalibrationService();
    c.capture('eyesClosed', [
      frame({ eyeOpenL: 0.1, eyeOpenR: 0.2 }),
      frame({ eyeOpenL: 0.15, eyeOpenR: 0.25 }),
      frame({ eyeOpenL: 0.9, eyeOpenR: 0.9 }), // まばたきの戻りなど
    ]);
    expect(c.result()?.eyeClosed).toEqual({ l: 0.15, r: 0.25 });
  });

  it('mouthOpen は口の開きの 90 パーセンタイル', () => {
    const c = createCalibrationService();
    // 0.0, 0.1, …, 1.0 の 11 フレーム → 0.9
    c.capture('mouthOpen', Array.from({ length: 11 }, (_, i) => frame({ mouthOpen: i / 10 })).reverse());
    expect(c.result()?.mouthOpenMax).toBeCloseTo(0.9, 9);
  });

  it('3つの手順を取ると、すべての値が入る。取っていない手順は写像を変えない値', () => {
    const c = createCalibrationService();
    c.capture('neutral', [frame({ faceYaw: 3, facePitch: 1, faceRoll: -2 })]);
    expect(c.result()).toEqual({
      neutral: { yaw: 3, pitch: 1, roll: -2 },
      eyeClosed: { l: 0, r: 0 },
      mouthOpenMax: 1,
    });
    c.capture('eyesClosed', [frame({ eyeOpenL: 0.2, eyeOpenR: 0.3 })]);
    c.capture('mouthOpen', [frame({ mouthOpen: 0.7 })]);
    expect(c.result()).toEqual({
      neutral: { yaw: 3, pitch: 1, roll: -2 },
      eyeClosed: { l: 0.2, r: 0.3 },
      mouthOpenMax: 0.7,
    });
  });

  it('検出できなかったフレームと有限でない値は使わない。使えるフレームが無ければ前の値のまま', () => {
    const c = createCalibrationService();
    c.capture('neutral', [
      frame({ faceYaw: 2 }),
      frame({ detected: false, faceYaw: 50 }),
      frame({ faceYaw: Number.NaN }),
      frame({ faceYaw: 4 }),
    ]);
    expect(c.result()?.neutral.yaw).toBe(3);
    c.capture('neutral', [frame({ detected: false, faceYaw: 20 })]);
    c.capture('neutral', []);
    expect(c.result()?.neutral.yaw).toBe(3);
  });

  it('同じ手順を取り直すと上書きする。reset で何も無い状態に戻る', () => {
    const c = createCalibrationService();
    c.capture('mouthOpen', [frame({ mouthOpen: 0.5 })]);
    c.capture('mouthOpen', [frame({ mouthOpen: 0.8 })]);
    expect(c.result()?.mouthOpenMax).toBe(0.8);
    c.reset();
    expect(c.result()).toBeNull();
  });

  it('result は毎回新しいオブジェクト（書き換えても中に残らない）', () => {
    const c = createCalibrationService();
    c.capture('neutral', [frame({ faceYaw: 1 })]);
    const r = c.result()!;
    r.neutral.yaw = 99;
    expect(c.result()?.neutral.yaw).toBe(1);
  });
});
