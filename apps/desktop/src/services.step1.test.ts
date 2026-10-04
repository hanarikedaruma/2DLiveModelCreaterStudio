import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackingFrame } from '@app/contracts';
import { createServices, createFakeServices } from './services';
import { createStudioRuntime } from './modes/studio/runtime';
import { createBodyFollowBinding, memoryStrengthStorage } from './modes/studio/producers/bodyFollow';
import { createExpressionBinding } from './modes/studio/expressions/binding';
import { createLipSyncBinding, setLipSyncCommand } from './modes/studio/lipsync/lipSync';
import { applyStep1Parameters } from './project/step1Params';
import type { SpoutSink } from './output/spout/sink';

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('STEP1 の本物のサービスの組み立て', () => {
  it('8つのサービスを本物に替え、作っただけでは機器・ホットキー・出力を始めない', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('テストでは機器を開かない'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const listen = vi.spyOn(window, 'addEventListener');
    const services = createServices();
    const fakes = createFakeServices();
    for (const key of [
      'audio',
      'lipSync',
      'autoBlink',
      'bodyFollow',
      'expressions',
      'calibration',
      'hotkeys',
      'spout',
    ] as const) {
      expect(services[key]).not.toBeInstanceOf(fakes[key].constructor);
    }
    await Promise.resolve();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect((services.spout as SpoutSink).running()).toBe(false);
  });

  it('目の追従をオフにすると同じ自動まばたきを使い、プロジェクトを読み直してもつながる', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const services = createServices();
    services.trackingLayer.setEyeTracking(false);
    services.autoBlink.tick(0);
    services.trackingLayer.update(frame(2040));
    expect(services.autoBlink.tick(2040)).toEqual({ EyeOpenL: 0.5, EyeOpenR: 0.5 });
    expect(services.trackingLayer.tick(2040).values).toMatchObject({ EyeOpenL: 0.5, EyeOpenR: 0.5 });

    // 標準パラメータを足すとトラッキングのレイヤーが作り直される
    expect(applyStep1Parameters(services.store)).toBe(true);
    services.trackingLayer.update(frame(2080));
    expect(services.trackingLayer.tick(2080).values).toMatchObject({ EyeOpenL: 0, EyeOpenR: 0 });
    expect(services.autoBlink.tick(2080)).toEqual({ EyeOpenL: 0, EyeOpenR: 0 });
  });

  it('キャリブレーションの中央値を、本物のトラッキングへ反映する', () => {
    const services = createServices();
    services.calibration.capture(
      'neutral',
      [1, 2, 3, 4, 5, 6, 100].map((faceYaw) => frame(0, { faceYaw })),
    );
    const calibration = services.calibration.result();
    expect(calibration?.neutral.yaw).toBe(4);
    services.trackingLayer.setCalibration(calibration);
    services.trackingLayer.setMirror(false);
    services.trackingLayer.update(frame(0, { faceYaw: 4 }));
    expect(services.trackingLayer.tick(0).values.FaceAngleX).toBeCloseTo(0);
  });

  it('本物の追従・表情・リップシンクを、画面と同じ binding と実行部で合成する', () => {
    const services = createServices();
    applyStep1Parameters(services.store);
    services.store.dispatch({
      label: 'テストの表情',
      apply: (p) => ({
        ...p,
        expressions: [
          {
            id: 'smile',
            name: '笑顔',
            entries: [{ parameterId: 'MouthForm', value: 1, blend: 'override' }],
            fadeIn: 0.2,
            fadeOut: 0.2,
          },
        ],
      }),
    });
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const body = createBodyFollowBinding(memoryStrengthStorage());
    const expression = createExpressionBinding();
    const lip = createLipSyncBinding();
    body.bind(services.bodyFollow);
    expression.bind(services.expressions);
    lip.bind(services);
    runtime.registerLayerProducer({ id: 'tracking', produce: (ctx) => services.trackingLayer.tick(ctx.now) });
    runtime.registerLayerProducer(body.producer);
    runtime.registerLayerProducer(expression.producer);
    runtime.registerLayerProducer(lip.producer);
    const detach = runtime.attach(services);
    const tick = (time: number) => {
      services.trackingLayer.update(frame(time, { faceYaw: 20, faceRoll: -10, mouthOpen: 0.25 }));
      return runtime.tick(time)!.params;
    };
    try {
      for (let time = 0; time <= 1000; time += 10) {
        services.lipSync.update({ time, rmsDb: -20 });
        tick(time);
      }
      expression.toggle('smile', 1000);
      expect(tick(1000).MouthForm).toBeCloseTo(0);
      const half = tick(1100);
      expect(half.MouthForm).toBeCloseTo(0.5);
      expect(half.FaceAngleX).toBeGreaterThan(0);
      expect(half.FaceAngleZ).toBeLessThan(0);
      expect(half.BodyAngleX).toBeCloseTo(half.FaceAngleX! * 0.3);
      expect(half.BodyAngleZ).toBeCloseTo(half.FaceAngleZ! * 0.3);
      expect(half.MouthOpen).toBeGreaterThan(0.95);
      expect(tick(1200).MouthForm).toBeCloseTo(1);

      body.setStrength('low');
      services.store.dispatch(setLipSyncCommand('カメラのみ', { mouthSource: 'cameraOnly' }));
      const camera = tick(1300);
      expect(camera.BodyAngleX).toBeCloseTo(camera.FaceAngleX! * 0.15);
      expect(camera.MouthOpen).toBeCloseTo(0.25);
      services.store.dispatch(setLipSyncCommand('マイクのみ', { mouthSource: 'micOnly' }));
      expect(tick(1400).MouthOpen).toBeGreaterThan(0.95);

      expression.toggle('smile', 1500);
      tick(1500);
      expect(tick(1600).MouthForm).toBeCloseTo(0.5);
      expect(tick(1700).MouthForm).toBeCloseTo(0);
    } finally {
      detach();
    }
  });

  it('ブラウザ側のホットキーを登録・解除し、押した・離したが届く', async () => {
    const services = createServices();
    const phases = vi.fn();
    const press = () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, shiftKey: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyK', ctrlKey: true, shiftKey: true }));
    };
    try {
      expect(
        await services.hotkeys.register(
          { id: 'test', keys: 'Ctrl+Shift+K', action: 'pauseTracking', targetId: null, mode: 'toggle' },
          phases,
        ),
      ).toBe('ok');
      press();
      expect(phases.mock.calls).toEqual([['down'], ['up']]);
      await services.hotkeys.unregisterAll();
      press();
      expect(phases).toHaveBeenCalledTimes(2);
    } finally {
      await services.hotkeys.unregisterAll();
    }
  });

  it('Tauri のない環境では Spout2 を成功扱いにしない', async () => {
    const services = createServices();
    await expect(services.spout.start({ width: 1280, height: 720, fps: 30 })).rejects.toThrow('Windows のアプリ');
    expect((services.spout as SpoutSink).running()).toBe(false);
  });
});
