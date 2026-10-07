// カード66 の受け入れテスト担当 CO。
import { describe, expect, it, vi } from 'vitest';
import type { Layer, TrackingFrame } from '@app/contracts';
import { createAutoBlink, createParameterMixer } from '@app/core';
import { createTrackingLayerProducer, createDefaultTrackingMappings } from '@app/tracking';
import { createFakeServices } from '../../services';
import { createStudioRuntime } from './runtime';

const camera: TrackingFrame = {
  time: 0,
  detected: true,
  faceYaw: 20,
  facePitch: 0,
  faceRoll: 0,
  eyeOpenL: 0.4,
  eyeOpenR: 0.7,
  eyeBallX: 0,
  eyeBallY: 0,
  mouthOpen: 0,
};
function setup() {
  const services = createFakeServices();
  services.mixer = createParameterMixer();
  services.autoBlink = createAutoBlink(() => 0);
  const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
  return { services, runtime };
}

describe('カード66: 最後の目の値と層の出どころ', () => {
  it.each(['目の割り当てなし', '割り当て無効', '顔が外れた', '目のトラッキングオフ', 'カメラ停止中'])(
    '%s でも自動の層から最後の値が開く・閉じる',
    async (scenario) => {
      const { services, runtime } = setup();
      let mappings = createDefaultTrackingMappings();
      if (scenario === '目の割り当てなし')
        mappings = mappings.filter((mapping) => !mapping.parameterId.startsWith('EyeOpen'));
      if (scenario === '割り当て無効') mappings = [];
      services.trackingLayer = createTrackingLayerProducer(services.store.get().model.parameters, mappings);
      if (scenario === '目のトラッキングオフ') services.trackingLayer.setEyeTracking(false);
      vi.spyOn(services.tracking, 'start').mockResolvedValue();
      const detach = runtime.attach(services);
      try {
        if (scenario !== 'カメラ停止中') await runtime.startTracking();
        services.trackingLayer.update({ ...camera, detected: scenario !== '顔が外れた' });
        expect(runtime.tick(0)!.params).toMatchObject({ EyeOpenL: 1, EyeOpenR: 1 });
        const closed = runtime.tick(2080)!;
        expect(closed.params).toMatchObject({ EyeOpenL: 0, EyeOpenR: 0 });
        expect(closed.layers.filter((layer) => layer.id === 'auto')).toHaveLength(1);
        expect(closed.layers.find((layer) => layer.id === 'auto')!.values).toMatchObject({ EyeOpenL: 0, EyeOpenR: 0 });
        expect(closed.layers.find((layer) => layer.id === 'tracking')?.values.EyeOpenL).toBeUndefined();
        expect(runtime.tick(2240)!.params).toMatchObject({ EyeOpenL: 1, EyeOpenR: 1 });
      } finally {
        runtime.stopTracking();
        detach();
      }
    },
  );

  it('カメラの目の値には重ならず、目のトラッキングを切ると自動に戻る', async () => {
    const { services, runtime } = setup();
    services.trackingLayer = createTrackingLayerProducer(services.store.get().model.parameters);
    services.trackingLayer.setMirror(false);
    vi.spyOn(services.tracking, 'start').mockResolvedValue();
    const detach = runtime.attach(services);
    try {
      await runtime.startTracking();
      services.trackingLayer.update(camera);
      const tracked = runtime.tick(300)!;
      expect(tracked.params).toMatchObject({ EyeOpenL: 0.4, EyeOpenR: 0.7 });
      expect(tracked.layers.some((layer) => layer.id === 'auto')).toBe(false);
      services.trackingLayer.setEyeTracking(false);
      runtime.tick(100);
      expect(runtime.tick(2180)!.params).toMatchObject({ EyeOpenL: 0, EyeOpenR: 0 });
    } finally {
      runtime.stopTracking();
      detach();
    }
  });

  it('自動をオフにすると値を出さず、表情とアニメーションが自動より優先する', () => {
    const { services, runtime } = setup();
    const detach = runtime.attach(services);
    try {
      runtime.tick(0);
      runtime.setAutoBlink(false);
      expect(runtime.tick(2080)!.params).toMatchObject({ EyeOpenL: 1, EyeOpenR: 1 });
      expect(runtime.lastFrame()!.layers.some((layer) => layer.id === 'auto')).toBe(false);
      runtime.setAutoBlink(true);
      const expression: Layer = { id: 'expression', weight: 1, values: { EyeOpenL: 0.6, EyeOpenR: 0 } };
      const off = runtime.registerLayerProducer({ id: 'expression', produce: () => expression });
      const frame = runtime.tick(2080)!;
      expect(frame.params).toMatchObject({ EyeOpenL: 0.6, EyeOpenR: 0 });
      expect(frame.layers.map((layer) => layer.id)).toEqual(['auto', 'expression']);
      let preceding: readonly Layer[] = [];
      runtime.registerLayerProducer({
        id: 'animation',
        produce(ctx) {
          preceding = ctx.layersSoFar ?? [];
          return { id: 'animation', weight: 1, values: { EyeOpenL: 0.2, EyeOpenR: 0.3 } };
        },
      });
      expect(runtime.tick(2090)!.params).toMatchObject({ EyeOpenL: 0.2, EyeOpenR: 0.3 });
      expect(preceding.map((layer) => layer.id)).toEqual(['auto', 'expression']);
      expect(frame.layers).toHaveLength(2); // 次のフレームで前の層の一覧を増やさない。
      off();
    } finally {
      detach();
    }
  });
});
