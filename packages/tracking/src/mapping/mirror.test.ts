import type { TrackingFrame } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { trackingInputs } from './mirror';

const frame: TrackingFrame = {
  time: 0,
  detected: true,
  faceYaw: 20, // ユーザーが自分の右を向いた
  facePitch: 5,
  faceRoll: 10, // ユーザーが自分の右へ傾けた
  eyeOpenL: 0.9, // ユーザーの左目
  eyeOpenR: 0.2, // ユーザーの右目
  eyeBallX: 0.5, // ユーザーが自分の右を見た
  eyeBallY: -0.3,
  mouthOpen: 0.4,
};

describe('trackingInputs', () => {
  it('ミラーのオン: yaw・roll・eyeBallX はそのまま、左右の目を入れ替える（ユーザーの右目 → eyeOpenL）', () => {
    expect(trackingInputs(frame, true)).toEqual({
      faceYaw: 20,
      facePitch: 5,
      faceRoll: 10,
      eyeOpenL: 0.2,
      eyeOpenR: 0.9,
      eyeBallX: 0.5,
      eyeBallY: -0.3,
      mouthOpen: 0.4,
    });
  });

  it('ミラーのオフ: yaw・roll・eyeBallX の符号を反転し、目は入れ替えない', () => {
    expect(trackingInputs(frame, false)).toEqual({
      faceYaw: -20,
      facePitch: 5,
      faceRoll: -10,
      eyeOpenL: 0.9,
      eyeOpenR: 0.2,
      eyeBallX: -0.5,
      eyeBallY: -0.3,
      mouthOpen: 0.4,
    });
  });

  it('口の形・口の横幅・眉はミラーによらずそのまま。フレームに無ければ入れない', () => {
    const step1 = { ...frame, mouthForm: 0.5, mouthWidth: -0.25, browY: 0.75 };
    for (const mirror of [true, false]) {
      const inputs = trackingInputs(step1, mirror);
      expect([inputs.mouthForm, inputs.mouthWidth, inputs.browY]).toEqual([0.5, -0.25, 0.75]);
    }
    const inputs = trackingInputs(frame, true);
    expect('mouthForm' in inputs || 'mouthWidth' in inputs || 'browY' in inputs).toBe(false);
  });

  it('オフで 0 を反転しても −0 にならない', () => {
    const zero = { ...frame, faceYaw: 0, faceRoll: 0, eyeBallX: 0 };
    const inputs = trackingInputs(zero, false);
    expect(Object.is(inputs.faceYaw, 0)).toBe(true);
    expect(Object.is(inputs.eyeBallX, 0)).toBe(true);
  });
});
