// カード35: 追加の入力・キャリブレーション・プリセット・目のトラッキング
import type { AutoBlink, TrackingFrame } from '@app/contracts';
import { standardParametersFor } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { applyDeadZone } from './map';
import { OneEuroFilter } from './oneEuro';
import { TRACKING_PRESETS } from './presets';
import { createTrackingLayerProducer } from './producer';

const FRAME = 1000 / 30;
const MVP = standardParametersFor('mvp');
const STEP1 = standardParametersFor('step1');

function frame(time: number, patch: Partial<TrackingFrame> = {}): TrackingFrame {
  return {
    time,
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

// 呼ばれた時刻を記録し、決まった値を返す自動まばたき
function fakeBlink(value = { EyeOpenL: 0.25, EyeOpenR: 0.75 }): AutoBlink & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    tick(now) {
      calls.push(now);
      return value;
    },
  };
}

describe('追加の入力（mouthForm・mouthWidth・browY）', () => {
  it('既定のマッピングで MouthForm・MouthWidth・BrowYL・BrowYR に写る', () => {
    const p = createTrackingLayerProducer(STEP1);
    p.update(frame(0, { mouthForm: 0.5, mouthWidth: -0.3, browY: 0.4 }));
    const v = p.tick(0).values;
    expect(v.MouthForm).toBeCloseTo(0.5, 9);
    expect(v.MouthWidth).toBeCloseTo(-0.3, 9);
    expect(v.BrowYL).toBeCloseTo(0.4, 9);
    expect(v.BrowYR).toBeCloseTo(0.4, 9);
  });

  it('ミラーをオフにしても左右は入れ替わらない（左右の平均の値なので）', () => {
    const p = createTrackingLayerProducer(STEP1);
    p.setMirror(false);
    p.update(frame(0, { mouthForm: -0.5, browY: -0.2 }));
    const v = p.tick(0).values;
    expect(v.MouthForm).toBeCloseTo(-0.5, 9);
    expect(v.BrowYL).toBeCloseTo(-0.2, 9);
    expect(v.BrowYR).toBeCloseTo(-0.2, 9);
  });

  it('フレームに無い（undefined の）ときは出さない。モデルにパラメータが無ければ出さない', () => {
    const step1 = createTrackingLayerProducer(STEP1);
    step1.update(frame(0));
    expect(Object.keys(step1.tick(0).values)).not.toContain('MouthForm');
    const mvp = createTrackingLayerProducer(MVP);
    mvp.update(frame(0, { mouthForm: 0.5, browY: 0.5 }));
    expect(Object.keys(mvp.tick(0).values)).not.toContain('MouthForm');
    expect(Object.keys(mvp.tick(0).values)).not.toContain('BrowYL');
  });
});

describe('setCalibration', () => {
  const calibration = {
    neutral: { yaw: 10, pitch: -6, roll: 4 },
    eyeClosed: { l: 0.2, r: 0.4 },
    mouthOpenMax: 0.5,
  };

  it('正面の向きが 0 になり、目は [eyeClosed, 1]、口は [0, mouthOpenMax] を [0, 1] に写す', () => {
    const p = createTrackingLayerProducer(MVP);
    p.setCalibration(calibration);
    p.update(frame(0, { faceYaw: 10, facePitch: -6, faceRoll: 4, eyeOpenL: 0.2, eyeOpenR: 0.4, mouthOpen: 0.5 }));
    const neutral = p.tick(0).values;
    expect([neutral.FaceAngleX, neutral.FaceAngleY, neutral.FaceAngleZ]).toEqual([0, 0, 0]);
    expect([neutral.EyeOpenL, neutral.EyeOpenR]).toEqual([0, 0]); // 目を閉じた値で閉じ切る
    expect(neutral.MouthOpen).toBe(1); // 口を大きく開けた値で開き切る

    const q = createTrackingLayerProducer(MVP);
    q.setCalibration(calibration);
    q.update(frame(0, { faceYaw: 30, eyeOpenL: 0.6, eyeOpenR: 0.7, mouthOpen: 0.25 }));
    const v = q.tick(0).values;
    expect(v.FaceAngleX).toBeCloseTo(20, 9);
    // ミラーのオン: ユーザーの右目（eyeOpenR、閉じた値 0.4）が EyeOpenL
    expect(v.EyeOpenL).toBeCloseTo(0.5, 9); // (0.7 − 0.4) / 0.6
    expect(v.EyeOpenR).toBeCloseTo(0.5, 9); // (0.6 − 0.2) / 0.8
    expect(v.MouthOpen).toBeCloseTo(0.5, 9);
  });

  it('ミラーのオフでは、引いたあとの yaw・roll の符号を反転する', () => {
    const p = createTrackingLayerProducer(MVP);
    p.setMirror(false);
    p.setCalibration(calibration);
    p.update(frame(0, { faceYaw: 25, faceRoll: 9 }));
    const v = p.tick(0).values;
    expect(v.FaceAngleX).toBeCloseTo(-15, 9);
    expect(v.FaceAngleZ).toBeCloseTo(-5, 9);
  });

  it('変えると次のフレームを待たずに当たり、null で元に戻る', () => {
    const p = createTrackingLayerProducer(MVP);
    p.update(frame(0, { faceYaw: 20 }));
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(20, 9);
    p.setCalibration(calibration);
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(10, 9);
    p.setCalibration(null);
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(20, 9);
  });

  it('目を閉じ切れていない・口をほとんど開けていないキャリブレーションでも、写像が極端にならない', () => {
    const p = createTrackingLayerProducer(MVP);
    p.setCalibration({ ...calibration, eyeClosed: { l: 1, r: 1 }, mouthOpenMax: 0 });
    p.update(frame(0, { eyeOpenL: 0.95, eyeOpenR: 0.95, mouthOpen: 0.05 }));
    const v = p.tick(0).values;
    expect(v.EyeOpenL).toBeCloseTo(0.5, 9); // 閉じた値は 0.9 として扱う
    expect(v.MouthOpen).toBeCloseTo(0.5, 9); // 開けた値は 0.1 として扱う
  });
});

describe('setPreset', () => {
  // 30fps で 0 から step へ段差を入れ、k フレーム目の FaceAngleX
  function stepResponse(setup: (p: ReturnType<typeof createTrackingLayerProducer>) => void, k = 4, step = 5): number {
    const p = createTrackingLayerProducer(MVP);
    setup(p);
    for (let i = 0; i <= k; i++) p.update(frame(i * FRAME, { faceYaw: i === 0 ? 0 : step }));
    return p.tick(k * FRAME).values.FaceAngleX!;
  }
  // 同じ段差を、決まった minCutoff・beta の One Euro でならした値（顔の角度は入力の幅が 60 なので単位はそのまま）
  function oneEuro(minCutoff: number, beta: number, k = 4, step = 5): number {
    const f = new OneEuroFilter({ minCutoff, beta, dCutoff: 1 });
    let out = 0;
    for (let i = 0; i <= k; i++) out = f.filter(i === 0 ? 0 : step, i * FRAME);
    return out;
  }

  it('プリセットごとのフィルタの値（minCutoff・beta）でならす', () => {
    for (const name of ['stable', 'standard', 'large'] as const) {
      const { minCutoff, beta } = TRACKING_PRESETS[name];
      // gain・deadZone の効きを除くため、同じ minCutoff・beta の custom で比べる
      const filtered = stepResponse((p) => p.setPreset('custom', { minCutoff, beta, gain: 1, deadZone: 0 }));
      expect(filtered).toBeCloseTo(oneEuro(minCutoff, beta), 9);
    }
    // 安定ほど遅れる
    const stable = stepResponse((p) => p.setPreset('custom', { ...TRACKING_PRESETS.stable, gain: 1, deadZone: 0 }));
    const standard = stepResponse((p) => p.setPreset('custom', { ...TRACKING_PRESETS.standard, gain: 1, deadZone: 0 }));
    const large = stepResponse((p) => p.setPreset('custom', { ...TRACKING_PRESETS.large, gain: 1, deadZone: 0 }));
    expect(stable).toBeLessThan(standard);
    expect(standard).toBeLessThan(large);
  });

  it('setPreset の前は MVP と同じならし（minCutoff 1.0・beta 0.02）', () => {
    expect(stepResponse(() => {})).toBeCloseTo(oneEuro(1.0, 0.02), 9);
  });

  it('マッピングの smoothing に対しては、標準の minCutoff 1.0 に対する倍率で効く', () => {
    const smoothing = 1; // minCutoff 0.3
    const p = createTrackingLayerProducer(MVP, [
      {
        input: 'faceYaw',
        parameterId: 'FaceAngleX',
        inputRange: [-30, 30],
        outputRange: [-30, 30],
        invert: false,
        curve: 'linear',
        smoothing,
        deadZone: 0,
        weight: 1,
      },
    ]);
    p.setPreset('custom', { minCutoff: 1.5, beta: 0.05, gain: 1, deadZone: 0 });
    for (let i = 0; i <= 4; i++) p.update(frame(i * FRAME, { faceYaw: i === 0 ? 0 : 5 }));
    expect(p.tick(4 * FRAME).values.FaceAngleX).toBeCloseTo(oneEuro(0.3 * 1.5, 0.05), 9);
  });

  it('gain は写像の後に中央からの差へ掛け、パラメータの範囲で丸める。deadZone はマッピングの不感帯に足す', () => {
    const at = (name: 'stable' | 'standard' | 'large', patch: Partial<TrackingFrame>) => {
      const p = createTrackingLayerProducer(MVP);
      p.setPreset(name);
      p.update(frame(0, patch)); // 最初のフレームはならさずにそのまま
      return p.tick(0).values;
    };
    const range = [-30, 30] as const;
    expect(at('stable', { faceYaw: 20 }).FaceAngleX).toBeCloseTo(applyDeadZone(20, range, 1.5) * 0.9, 9);
    expect(at('standard', { faceYaw: 20 }).FaceAngleX).toBeCloseTo(applyDeadZone(20, range, 0.5), 9);
    expect(at('large', { faceYaw: 20 }).FaceAngleX).toBeCloseTo(24, 9);
    expect(at('large', { faceYaw: -28 }).FaceAngleX).toBe(-30); // −33.6 → 丸める
    expect(at('stable', { faceYaw: 1.4 }).FaceAngleX).toBe(0); // 不感帯 1.5度の中
    expect(at('stable', { facePitch: -10 }).FaceAngleY).toBeCloseTo(applyDeadZone(-10, range, 1.5) * 0.9, 9);
    // 視線は入力の幅 2 を 60 にそろえた単位（1.5 → 0.05）
    expect(at('stable', { eyeBallX: 0.04 }).EyeBallX).toBe(0);
    expect(at('stable', { eyeBallX: 0.5 }).EyeBallX).toBeCloseTo(applyDeadZone(0.5, [-1, 1], 0.05) * 0.9, 9);
    expect(at('large', { eyeBallY: 0.5 }).EyeBallY).toBeCloseTo(0.6, 9);
  });

  it('目の開き・口の開きには gain・deadZone を当てない（安定でも閉じ切る・開き切る）', () => {
    const p = createTrackingLayerProducer(MVP);
    p.setPreset('stable');
    p.update(frame(0, { eyeOpenL: 0, eyeOpenR: 1, mouthOpen: 0 }));
    expect(p.tick(0).values).toMatchObject({ EyeOpenL: 1, EyeOpenR: 0, MouthOpen: 0 });
    const q = createTrackingLayerProducer(MVP);
    q.setPreset('large');
    q.update(frame(0, { eyeOpenL: 0.5, mouthOpen: 0.5 }));
    expect(q.tick(0).values).toMatchObject({ EyeOpenR: 0.5, MouthOpen: 0.5 });
  });

  it('口の形・眉にも当てる（中央がふつうの状態の入力）', () => {
    const p = createTrackingLayerProducer(STEP1);
    p.setPreset('large');
    p.update(frame(0, { mouthForm: 0.5, browY: -0.5, mouthWidth: 0.9 }));
    const v = p.tick(0).values;
    expect(v.MouthForm).toBeCloseTo(0.6, 9);
    expect(v.BrowYL).toBeCloseTo(-0.6, 9);
    expect(v.MouthWidth).toBe(1); // 1.08 → 丸める
  });

  it('custom は渡した値。変えると次のフレームを待たずに当たる', () => {
    const p = createTrackingLayerProducer(MVP);
    p.update(frame(0, { faceYaw: 10 }));
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(10, 9);
    p.setPreset('custom', { minCutoff: 1, beta: 0.02, gain: 2, deadZone: 0 });
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(20, 9);
    p.setPreset('custom', { minCutoff: 1, beta: 0.02, gain: 1, deadZone: 4 });
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(applyDeadZone(10, [-30, 30], 4), 9);
    p.setPreset('standard');
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(applyDeadZone(10, [-30, 30], 0.5), 9);
  });
});

describe('setEyeTracking', () => {
  const tracked = frame(0, { eyeOpenL: 0.4, eyeOpenR: 0.6, faceYaw: 12 });

  it('オフにすると EyeOpenL / R が autoBlink.tick(now) の値になる。ほかの値はトラッキングのまま', () => {
    const blink = fakeBlink();
    const p = createTrackingLayerProducer(MVP, undefined, { autoBlink: blink });
    p.update(tracked);
    expect(p.tick(0).values).toMatchObject({ EyeOpenL: 0.6, EyeOpenR: 0.4 });
    expect(blink.calls).toEqual([]); // オンで検出中なら呼ばない
    p.setEyeTracking(false);
    const v = p.tick(10).values;
    expect(v).toMatchObject({ EyeOpenL: 0.25, EyeOpenR: 0.75 });
    expect(v.FaceAngleX).toBeCloseTo(12, 9);
    expect(blink.calls).toEqual([10]);
    expect(p.status()).toBe('tracking');
  });

  it('オンに戻すと、すぐにトラッキングの目の値に戻る', () => {
    const p = createTrackingLayerProducer(MVP, undefined, { autoBlink: fakeBlink() });
    p.setEyeTracking(false);
    p.update(tracked);
    expect(p.tick(0).values).toMatchObject({ EyeOpenL: 0.25, EyeOpenR: 0.75 });
    p.setEyeTracking(true);
    expect(p.tick(0).values).toMatchObject({ EyeOpenL: 0.6, EyeOpenR: 0.4 });
  });

  it('外れたとき（status が lost）も autoBlink の値を使う', () => {
    const blink = fakeBlink();
    const p = createTrackingLayerProducer(MVP, undefined, { autoBlink: blink });
    p.setLostBehavior('hold');
    p.update(tracked);
    p.update(frame(FRAME, { detected: false, eyeOpenL: 0, eyeOpenR: 0 }));
    const layer = p.tick(FRAME);
    expect(p.status()).toBe('lost');
    expect(layer.values).toMatchObject({ EyeOpenL: 0.25, EyeOpenR: 0.75 });
    expect(layer.values.FaceAngleX).toBeCloseTo(12, 9); // ほかは最後の値のまま
    // 再び検出したらトラッキングの目に戻る
    p.update(frame(2 * FRAME, { eyeOpenL: 0.4, eyeOpenR: 0.6 }));
    expect(p.tick(2 * FRAME).values.EyeOpenL).toBeCloseTo(0.6, 2);
  });

  it('フレームが来なくなって 0.5秒を過ぎたときも lost として autoBlink の値を使う', () => {
    const p = createTrackingLayerProducer(MVP, undefined, { autoBlink: fakeBlink() });
    p.update(tracked);
    expect(p.tick(400).values.EyeOpenL).toBeCloseTo(0.6, 9);
    expect(p.tick(600).values).toMatchObject({ EyeOpenL: 0.25, EyeOpenR: 0.75 });
  });

  it('autoBlink を渡していなければ、オフのとき目を開けたまま（1）', () => {
    const p = createTrackingLayerProducer(MVP);
    p.update(tracked);
    p.setEyeTracking(false);
    expect(p.tick(0).values).toMatchObject({ EyeOpenL: 1, EyeOpenR: 1 });
  });

  it('autoBlink の値はパラメータの範囲で丸め、モデルに目のパラメータが無ければ出さない', () => {
    const p = createTrackingLayerProducer(MVP, undefined, { autoBlink: fakeBlink({ EyeOpenL: 1.5, EyeOpenR: -1 }) });
    p.update(tracked);
    p.setEyeTracking(false);
    expect(p.tick(0).values).toMatchObject({ EyeOpenL: 1, EyeOpenR: 0 });

    const noEyes = MVP.filter((x) => !x.id.startsWith('EyeOpen'));
    const q = createTrackingLayerProducer(noEyes, undefined, { autoBlink: fakeBlink() });
    q.update(tracked);
    q.setEyeTracking(false);
    expect(Object.keys(q.tick(0).values)).not.toContain('EyeOpenL');
  });

  it('まだ一度も検出していなくても、自動まばたきを独立した重みで出す', () => {
    const blink = fakeBlink();
    const p = createTrackingLayerProducer(MVP, undefined, { autoBlink: blink });
    p.setEyeTracking(false);
    expect(p.tick(0)).toEqual({
      id: 'tracking',
      weight: 0,
      values: { EyeOpenL: 0.25, EyeOpenR: 0.75 },
      parameterWeights: { EyeOpenL: 1, EyeOpenR: 1 },
    });
    expect(blink.calls).toEqual([0]);
  });
});
