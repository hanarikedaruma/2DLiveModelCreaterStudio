import { describe, expect, it } from 'vitest';
import { CENTERED_TRACKING_INPUTS, TRACKING_PRESETS, UNTUNED_TRACKING, resolveTrackingTuning } from './presets';

describe('動きのプリセット', () => {
  it('安定・標準・大きく動くの値（minCutoff・beta・gain・deadZone）', () => {
    expect(TRACKING_PRESETS).toEqual({
      stable: { minCutoff: 0.5, beta: 0.01, gain: 0.9, deadZone: 1.5 },
      standard: { minCutoff: 1.0, beta: 0.02, gain: 1.0, deadZone: 0.5 },
      large: { minCutoff: 1.5, beta: 0.05, gain: 1.2, deadZone: 0 },
    });
    expect(Object.isFrozen(TRACKING_PRESETS.standard)).toBe(true);
  });

  it('setPreset の前は MVP と同じ（minCutoff 1.0・beta 0.02、gain 1・deadZone 0）', () => {
    expect(UNTUNED_TRACKING).toEqual({ minCutoff: 1, beta: 0.02, gain: 1, deadZone: 0 });
  });

  it('resolveTrackingTuning: 名前ならそのプリセット（custom の値は使わない）、毎回新しいオブジェクト', () => {
    const custom = { minCutoff: 2, beta: 0.1, gain: 2, deadZone: 3 };
    for (const name of ['stable', 'standard', 'large'] as const) {
      const t = resolveTrackingTuning(name, custom);
      expect(t).toEqual(TRACKING_PRESETS[name]);
      expect(t).not.toBe(TRACKING_PRESETS[name]);
    }
  });

  it('custom は渡した値。値が無ければ標準', () => {
    const custom = { minCutoff: 2, beta: 0.1, gain: 1.5, deadZone: 3 };
    expect(resolveTrackingTuning('custom', custom)).toEqual(custom);
    expect(resolveTrackingTuning('custom')).toEqual(TRACKING_PRESETS.standard);
  });

  it('custom の壊れた値は、その項目だけ標準の値にする（minCutoff は正、ほかは 0 以上）', () => {
    expect(resolveTrackingTuning('custom', { minCutoff: 0, beta: -1, gain: Number.NaN, deadZone: 2 })).toEqual({
      minCutoff: 1.0,
      beta: 0.02,
      gain: 1.0,
      deadZone: 2,
    });
    expect(resolveTrackingTuning('custom', { minCutoff: 0.3, beta: 0, gain: 0, deadZone: 0 })).toEqual({
      minCutoff: 0.3,
      beta: 0,
      gain: 0,
      deadZone: 0,
    });
  });

  it('gain と deadZone は中央がふつうの状態の入力にだけ当てる（目の開き・口の開きには当てない）', () => {
    expect([...CENTERED_TRACKING_INPUTS].sort()).toEqual(
      ['browY', 'eyeBallX', 'eyeBallY', 'faceRoll', 'facePitch', 'faceYaw', 'mouthForm', 'mouthWidth'].sort(),
    );
  });
});
