import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Parameter, type TrackingMapping, type TrackingSetup } from '@app/schema';
import { createProjectStore } from '@app/core';
import type { TrackingFrame, TrackingLayerProducer } from '@app/contracts';
import { createTrackingLayerProducer } from '@app/tracking';
import { createProjectTrackingLayer } from './trackingLayer';

const frame = (time: number, faceYaw: number): TrackingFrame => ({
  time,
  detected: true,
  faceYaw,
  facePitch: 0,
  faceRoll: 0,
  eyeOpenL: 1,
  eyeOpenR: 1,
  eyeBallX: 0,
  eyeBallY: 0,
  mouthOpen: 0,
});

// 作った回数と、渡された設定を記録する
function recordingFactory() {
  const made: {
    parameters: Parameter[];
    mappings?: TrackingMapping[];
    combine?: TrackingSetup['combine'];
    calls: string[];
  }[] = [];
  const create = (
    parameters: Parameter[],
    mappings?: TrackingMapping[],
    combine?: TrackingSetup['combine'],
  ): TrackingLayerProducer => {
    const entry = { parameters, mappings, combine, calls: [] as string[] };
    made.push(entry);
    const real = createTrackingLayerProducer(parameters, mappings, { combine });
    return {
      update: (f) => real.update(f),
      tick: (now) => real.tick(now),
      status: () => real.status(),
      setMirror: (on) => {
        entry.calls.push(`mirror:${on}`);
        real.setMirror(on);
      },
      setLostBehavior: (b) => {
        entry.calls.push(`lost:${b}`);
        real.setLostBehavior(b);
      },
      setCalibration: (c) => {
        entry.calls.push(`calibration:${c ? c.neutral.yaw : 'null'}`);
        real.setCalibration(c);
      },
      setPreset: (p, custom) => {
        entry.calls.push(`preset:${p}${custom ? `:${custom.gain}` : ''}`);
        real.setPreset(p, custom);
      },
      setEyeTracking: (on) => {
        entry.calls.push(`eyes:${on}`);
        real.setEyeTracking(on);
      },
    };
  };
  return { made, create };
}

describe('createProjectTrackingLayer', () => {
  it('本物のレイヤーでフレームが FaceAngleX に写る', () => {
    const store = createProjectStore(createEmptyProject('t'));
    const layer = createProjectTrackingLayer(store, (parameters, mappings) =>
      createTrackingLayerProducer(parameters, mappings),
    );
    for (let t = 0; t <= 1000; t += 33) layer.update(frame(t, 20));
    const out = layer.tick(1000);
    expect(out.id).toBe('tracking');
    expect(out.values.FaceAngleX).toBeCloseTo(20, 0);
    expect(layer.status()).toBe('tracking');
  });

  it('parameters・trackingMappings が変わったら作り直し、ミラー・外れたときの動き・STEP1 の設定を引き継ぐ', () => {
    const store = createProjectStore(createEmptyProject('t'));
    const { made, create } = recordingFactory();
    const layer = createProjectTrackingLayer(store, create);
    expect(made).toHaveLength(1);
    expect(made[0]!.calls).toEqual([
      'mirror:true',
      'lost:returnToFront',
      'calibration:null',
      'preset:standard',
      'eyes:true',
    ]);
    layer.setMirror(false);
    layer.setLostBehavior('hold');
    layer.setCalibration({ neutral: { yaw: 5, pitch: 0, roll: 0 }, eyeClosed: { l: 0.1, r: 0.1 }, mouthOpenMax: 0.8 });
    layer.setPreset('custom', { minCutoff: 1, beta: 0.01, gain: 1.5, deadZone: 0 });
    layer.setEyeTracking(false);

    // パラメータと関係の無い変更では作り直さない
    store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '別' }) });
    expect(made).toHaveLength(1);

    const mapping: TrackingMapping = {
      input: 'faceYaw',
      parameterId: 'FaceAngleX',
      inputRange: [-30, 30],
      outputRange: [30, -30],
      invert: false,
      curve: 'linear',
      smoothing: 0.5,
      deadZone: 0,
      weight: 1,
    };
    // カスタムの一覧を使う設定にすると、その一覧で作り直す
    store.dispatch({
      label: 'マッピング',
      apply: (p) => ({ ...p, trackingMappings: [mapping], trackingSetup: { mode: 'custom', combine: [] } }),
    });
    expect(made).toHaveLength(2);
    expect(made[1]!.mappings).toEqual([mapping]);
    expect(made[1]!.calls).toEqual(['mirror:false', 'lost:hold', 'calibration:5', 'preset:custom:1.5', 'eyes:false']);

    store.dispatch({
      label: 'パラメータ',
      apply: (p) => ({ ...p, model: { ...p.model, parameters: p.model.parameters.slice(0, 3) } }),
    });
    expect(made).toHaveLength(3);
    expect(made[2]!.parameters).toHaveLength(3);
  });

  it('標準は既定のマッピング（undefined）、カスタムは一覧（空なら何も動かさない）、無効は空。合わせ方も渡す（I-042）', () => {
    const store = createProjectStore(createEmptyProject('t'));
    const { made, create } = recordingFactory();
    const layer = createProjectTrackingLayer(store, create);
    expect(made[0]!.mappings).toBeUndefined();
    const setup = (trackingSetup: TrackingSetup) =>
      store.dispatch({ label: '設定', apply: (p) => ({ ...p, trackingSetup }) });

    setup({ mode: 'custom', combine: [{ parameterId: 'FaceAngleX', method: 'average' }] });
    expect(made.at(-1)!.mappings).toEqual([]);
    expect(made.at(-1)!.combine).toEqual([{ parameterId: 'FaceAngleX', method: 'average' }]);
    setup({ mode: 'off', combine: [] });
    expect(made.at(-1)!.mappings).toEqual([]);
    for (let t = 0; t <= 1000; t += 33) layer.update(frame(t, 20));
    expect(layer.tick(1000).values.FaceAngleX).toBeUndefined();
    setup({ mode: 'standard', combine: [] });
    expect(made.at(-1)!.mappings).toBeUndefined();
  });
});
