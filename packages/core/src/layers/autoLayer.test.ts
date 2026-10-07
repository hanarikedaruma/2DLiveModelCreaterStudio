import { describe, expect, it } from 'vitest';
import type { AutoBlink, FrameContext, Layer } from '@app/contracts';
import { createEmptyProject, standardParametersFor } from '@app/schema';
import { createAutoLayerProducer } from './autoLayer';

function blink(value = { EyeOpenL: 0.25, EyeOpenR: 0.75 }): AutoBlink & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    tick(now) {
      calls.push(now);
      return value;
    },
  };
}

function ctx(layersSoFar: Layer[] | undefined, now = 100): FrameContext {
  const project = createEmptyProject('自動の層');
  const withParams = { ...project, model: { ...project.model, parameters: standardParametersFor('mvp') } };
  return {
    now,
    dt: 16,
    project: withParams,
    mixedSoFar: {},
    flags: { lipSyncWeight: 1, physicsActive: true },
    ...(layersSoFar ? { layersSoFar } : {}),
  };
}

describe('createAutoLayerProducer（STEP3 のカード66）', () => {
  it('トラッキングの層が無い（カメラ停止中）なら、自動まばたきの目の値を重み1で出す', () => {
    const b = blink();
    const auto = createAutoLayerProducer(b);
    expect(auto.produce(ctx([]))).toEqual({ id: 'auto', weight: 1, values: { EyeOpenL: 0.25, EyeOpenR: 0.75 } });
    expect(auto.produce(ctx(undefined, 200))).toEqual({
      id: 'auto',
      weight: 1,
      values: { EyeOpenL: 0.25, EyeOpenR: 0.75 },
    });
    expect(b.calls).toEqual([100, 200]);
  });

  it('トラッキングの層が目の値を持っていれば出さない（カメラの値と重ねない）', () => {
    const b = blink();
    const auto = createAutoLayerProducer(b);
    const tracking: Layer = { id: 'tracking', weight: 1, values: { EyeOpenL: 0.4, EyeOpenR: 0.6, FaceAngleX: 3 } };
    expect(auto.produce(ctx([tracking]))).toBeNull();
    expect(b.calls).toEqual([]);
  });

  it('トラッキングの層が目の値を持っていなければ（割り当てに目が無い・外れた・目のトラッキングがオフ）出す（I-055）', () => {
    const auto = createAutoLayerProducer(blink());
    const tracking: Layer = { id: 'tracking', weight: 1, values: { FaceAngleX: 3 } };
    expect(auto.produce(ctx([tracking]))?.values).toEqual({ EyeOpenL: 0.25, EyeOpenR: 0.75 });
    // 片目だけカメラから来ていれば、もう片目だけを出す
    const oneEye: Layer = { id: 'tracking', weight: 1, values: { EyeOpenL: 0.4 } };
    expect(auto.produce(ctx([oneEye]))?.values).toEqual({ EyeOpenR: 0.75 });
  });

  it('オフ（Environment.autoBlink）なら出さない。値はパラメータの範囲で丸める', () => {
    const auto = createAutoLayerProducer(blink({ EyeOpenL: 1.5, EyeOpenR: -1 }));
    auto.setBlinkEnabled(false);
    expect(auto.produce(ctx([]))).toBeNull();
    auto.setBlinkEnabled(true);
    expect(auto.produce(ctx([]))?.values).toEqual({ EyeOpenL: 1, EyeOpenR: 0 });
  });

  it('モデルに目のパラメータが無ければ出さない', () => {
    const auto = createAutoLayerProducer(blink());
    const c = ctx([]);
    const noEyes = c.project.model.parameters.filter((p) => !p.id.startsWith('EyeOpen'));
    expect(
      auto.produce({ ...c, project: { ...c.project, model: { ...c.project.model, parameters: noEyes } } }),
    ).toBeNull();
  });
});
