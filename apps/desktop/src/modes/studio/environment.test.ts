import { describe, expect, it, vi } from 'vitest';
import { createDefaultEnvironment } from '@app/schema';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage, parseEnvironment } from '../../shell/environment';
import { bindStudioEnvironment } from './environment';
import { expressionBinding } from './expressions/binding';

const settings = {
  eyeTracking: false,
  trackingPreset: 'custom' as const,
  trackingCustom: { minCutoff: 0.8, beta: 0.03, gain: 1.3, deadZone: 0.2 },
  bodyFollowStrength: 'high' as const,
  expressionMode: 'single' as const,
};

describe('スタジオの PC 設定（I-033）', () => {
  it('一つの保存先から復元し、画面を開く前に実行部へ渡す', async () => {
    const storage = memoryEnvironmentStorage(JSON.stringify(settings));
    const environment = createEnvironmentStore(storage);
    const services = createFakeServices();
    const eyes = vi.spyOn(services.trackingLayer, 'setEyeTracking');
    const preset = vi.spyOn(services.trackingLayer, 'setPreset');
    const strength = vi.spyOn(services.bodyFollow, 'setStrength');
    const off = bindStudioEnvironment(services, environment);
    await environment.load();
    expect(environment.get()).toMatchObject(settings);
    expect(eyes).toHaveBeenLastCalledWith(false);
    expect(preset).toHaveBeenLastCalledWith('custom', settings.trackingCustom);
    expect(strength).toHaveBeenLastCalledWith('high');
    expect(expressionBinding.mode()).toBe('single');
    environment.set({ expressionMode: 'stack', eyeTracking: true });
    await environment.flush();
    expect(JSON.parse(storage.text!)).toMatchObject({ ...settings, expressionMode: 'stack', eyeTracking: true });
    const again = createEnvironmentStore(storage);
    await again.load();
    expect(again.get()).toEqual(environment.get());
    environment.set(createDefaultEnvironment());
    await environment.flush();
    expect(JSON.parse(storage.text!)).toEqual(createDefaultEnvironment());
    off();
    eyes.mockClear();
    environment.set({ eyeTracking: false });
    expect(eyes).not.toHaveBeenCalled();
  });

  it('不正な設定が一つあってもほかの正常な設定は失わない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = parseEnvironment(JSON.stringify({ ...settings, expressionMode: 'other' }));
    expect(env).toMatchObject({ ...settings, expressionMode: 'stack' });
    expect(parseEnvironment(JSON.stringify({ ...settings, trackingCustom: { minCutoff: 0 } })).trackingCustom).toEqual(
      createDefaultEnvironment().trackingCustom,
    );
    expect(
      parseEnvironment(JSON.stringify({ trackingCustom: { minCutoff: 0, beta: 0.1, gain: -1 } })).trackingCustom,
    ).toEqual({ ...createDefaultEnvironment().trackingCustom, beta: 0.1 });
    expect(
      parseEnvironment(JSON.stringify({ cameraCapture: { mode: 'manual', width: 1920, height: 1080, fps: 0 } }))
        .cameraCapture,
    ).toEqual({ mode: 'manual', width: 1920, height: 1080, fps: 60 });
    warn.mockRestore();
  });

  it('読み込み中の変更を保持し、ほかの保存済み設定を初期値で上書きしない', async () => {
    let finish!: (text: string) => void;
    const write = vi.fn(async (_text: string) => {});
    const environment = createEnvironmentStore({
      read: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      write,
    });
    const loading = environment.load();
    environment.set({ eyeTracking: false, expressionMode: 'single' });
    expect(write).not.toHaveBeenCalled();
    finish(JSON.stringify({ bodyFollowStrength: 'high', mirror: false, trackingCustom: settings.trackingCustom }));
    await loading;
    await environment.flush();
    expect(environment.get()).toMatchObject({
      eyeTracking: false,
      expressionMode: 'single',
      bodyFollowStrength: 'high',
      mirror: false,
      trackingCustom: settings.trackingCustom,
    });
    expect(JSON.parse(write.mock.calls.at(-1)![0])).toEqual(environment.get());
  });

  it('旧個別 localStorage は読み込まず、設定を書き込まない', async () => {
    localStorage.setItem('live2d-studio.trackingOptions', JSON.stringify({ eyeTracking: false }));
    localStorage.setItem('live2d-studio.expressionCardMode', 'single');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
    const off = bindStudioEnvironment(createFakeServices(), environment);
    await environment.load();
    expect(environment.get().eyeTracking).toBe(true);
    expect(environment.get().expressionMode).toBe('stack');
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    off();
    getItem.mockRestore();
    setItem.mockRestore();
    localStorage.clear();
  });

  it('読み込み前に明示した既定値も、保存済みの値に上書きされない', async () => {
    let finish!: (text: string) => void;
    const write = vi.fn(async (_text: string) => {});
    const environment = createEnvironmentStore({
      read: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      write,
    });
    environment.set({ eyeTracking: true });
    finish(JSON.stringify({ eyeTracking: false, bodyFollowStrength: 'high' }));
    await environment.flush();
    expect(environment.get()).toMatchObject({ eyeTracking: true, bodyFollowStrength: 'high' });
    expect(JSON.parse(write.mock.calls.at(-1)![0]).eyeTracking).toBe(true);
  });
});
