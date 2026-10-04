import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@app/schema';
import {
  FakeTrackingLayer,
  type Renderer,
  type Services,
  type TrackingFrame,
  type TrackingSource,
} from '@app/contracts';
import { createParameterMixer } from '@app/core';
import { TRACKING_PRESETS, createCalibrationService } from '@app/tracking';
import { createFakeServices } from '../../../services';
import { emitAppEvent } from '../../../shell/api';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { RECALIBRATE_EVENT } from '../../../hotkeys/actions';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { COLLECT_MS, COUNT_INTERVAL_MS } from './flow';
import { defaultTrackingOptions, trackingOptions } from './options';
import { register } from './index';

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

// フレームを手で流すカメラ
class ManualTrackingSource implements TrackingSource {
  started = false;
  failStart: Error | null = null;
  private readonly listeners = new Set<(f: TrackingFrame) => void>();
  async listDevices() {
    return [{ id: 'cam', label: 'テストのカメラ' }];
  }
  async start() {
    if (this.failStart) throw this.failStart;
    this.started = true;
  }
  stop() {
    this.started = false;
  }
  onFrame(listener: (f: TrackingFrame) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(patch: Partial<TrackingFrame>, count = 30) {
    for (let i = 0; i < count; i++) {
      const f: TrackingFrame = {
        time: Date.now(),
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
      for (const l of [...this.listeners]) l(f);
    }
  }
}

async function setup(options: { environment?: object } = {}) {
  const tracking = new ManualTrackingSource();
  const trackingLayer = new FakeTrackingLayer();
  const spies = {
    setCalibration: vi.spyOn(trackingLayer, 'setCalibration'),
    setPreset: vi.spyOn(trackingLayer, 'setPreset'),
    setEyeTracking: vi.spyOn(trackingLayer, 'setEyeTracking'),
  };
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    mixer: createParameterMixer(),
    tracking,
    trackingLayer,
    calibration: createCalibrationService(),
  };
  const environment = createEnvironmentStore(
    memoryEnvironmentStorage(options.environment ? JSON.stringify(options.environment) : null),
  );
  const utils = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.store.load(createEmptyProject('テスト'));
    services.editor.set({ mode: 'studio' });
  });
  return { services, environment, tracking, spies, ...utils };
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const section = () => within(screen.getByRole('heading', { name: 'キャリブレーション・動き' }).parentElement!);
const motion = () => within(section().getByRole('group', { name: '動き' }));
const dialog = () => within(screen.getByRole('dialog', { name: 'キャリブレーション' }));
const startCalibration = () =>
  act(async () => {
    fireEvent.click(section().getByRole('button', { name: 'キャリブレーション' }));
  });

// 3手順を、それぞれのフレームを流して終える
async function runAllSteps(tracking: ManualTrackingSource) {
  const patches: Partial<TrackingFrame>[] = [
    { faceYaw: 8, facePitch: -3, faceRoll: 2 },
    { eyeOpenL: 0.15, eyeOpenR: 0.25 },
    { mouthOpen: 0.6 },
  ];
  for (const patch of patches) {
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit(patch));
    await advance(COLLECT_MS);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  registry.reset();
  registerStudio();
  register();
  trackingOptions.set(defaultTrackingOptions());
  studioRuntime.setScheduler({
    request(cb) {
      const id = setTimeout(() => cb(Date.now()), 16);
      return () => clearTimeout(id);
    },
  });
});
afterEach(() => {
  studioRuntime.stopTracking();
  vi.useRealTimers();
  studioRuntime.setScheduler(animationFrameScheduler());
  trackingOptions.set(defaultTrackingOptions());
});

describe('スタジオの設定の「キャリブレーション・動き」', () => {
  it('キャリブレーション・動き（初期は標準）・目のトラッキングが出て、設定をトラッキングのレイヤーに渡す', async () => {
    const { spies } = await setup();
    const s = section();
    expect(s.getByRole('button', { name: 'キャリブレーション' })).toBeTruthy();
    expect(s.getByLabelText('キャリブレーションの状態').textContent).toContain('未設定');
    expect(motion().getByRole('button', { name: '安定' }).getAttribute('aria-pressed')).toBe('false');
    expect(motion().getByRole('button', { name: '標準' }).getAttribute('aria-pressed')).toBe('true');
    expect(motion().getByRole('button', { name: '大きく動く' }).getAttribute('aria-pressed')).toBe('false');
    expect(motion().queryByRole('button', { name: 'カスタム' })).toBeNull();
    expect(s.getByText('安定は動きの遅れが少し増えます')).toBeTruthy();
    expect((s.getByRole('checkbox', { name: '目のトラッキング' }) as HTMLInputElement).checked).toBe(true);
    expect(spies.setCalibration).toHaveBeenLastCalledWith(null);
    expect(spies.setPreset).toHaveBeenLastCalledWith('standard');
    expect(spies.setEyeTracking).toHaveBeenLastCalledWith(true);
  });

  it('[キャリブレーション] でカメラを開始し、3・2・1 のあと各手順のフレームを集め、結果を Environment に保存する', async () => {
    const { environment, tracking, spies } = await setup();
    await startCalibration();
    expect(tracking.started).toBe(true);
    expect(studioRuntime.getState().status).not.toBe('stopped');

    const d = dialog();
    expect(d.getByRole('listitem', { current: 'step' }).textContent).toContain('正面を向く');
    expect(d.getByLabelText('カウント').textContent).toBe('3');
    await advance(COUNT_INTERVAL_MS);
    expect(d.getByLabelText('カウント').textContent).toBe('2');
    await advance(COUNT_INTERVAL_MS);
    expect(d.getByLabelText('カウント').textContent).toBe('1');
    await advance(COUNT_INTERVAL_MS);
    expect(d.getByLabelText('カウント').textContent).toBe('そのまま');
    act(() => tracking.emit({ faceYaw: 8, facePitch: -3, faceRoll: 2 }));
    expect(d.getByText('読み取っている（30 フレーム）')).toBeTruthy();
    await advance(COLLECT_MS);
    expect(d.getByRole('listitem', { current: 'step' }).textContent).toContain('目を閉じる');
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ eyeOpenL: 0.15, eyeOpenR: 0.25 }));
    await advance(COLLECT_MS);
    expect(d.getByRole('listitem', { current: 'step' }).textContent).toContain('口を大きく開ける');
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ mouthOpen: 0.6 }));
    await advance(COLLECT_MS);

    const result = { neutral: { yaw: 8, pitch: -3, roll: 2 }, eyeClosed: { l: 0.15, r: 0.25 }, mouthOpenMax: 0.6 };
    expect(environment.get().calibration).toEqual(result);
    expect(spies.setCalibration).toHaveBeenLastCalledWith(result);
    expect(d.getByText('キャリブレーションを保存した')).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog', { name: 'キャリブレーション' })).toBeNull();
    expect(section().getByLabelText('キャリブレーションの状態').textContent).toContain('キャリブレーション済み');

    // 未設定に戻す
    fireEvent.click(section().getByRole('button', { name: '未設定に戻す' }));
    expect(environment.get().calibration).toBeNull();
    expect(spies.setCalibration).toHaveBeenLastCalledWith(null);
  });

  it("アプリイベント 'recalibrate'（ホットキー）でキャリブレーションを始める", async () => {
    const { environment, tracking } = await setup();
    await act(async () => {
      emitAppEvent(RECALIBRATE_EVENT);
    });
    expect(tracking.started).toBe(true);
    expect(dialog().getByLabelText('カウント').textContent).toBe('3');
    // 途中でもう一度来ても、やり直さない
    await advance(COUNT_INTERVAL_MS);
    await act(async () => {
      emitAppEvent(RECALIBRATE_EVENT);
    });
    expect(dialog().getByLabelText('カウント').textContent).toBe('2');
    await advance(2 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ faceYaw: 1 }));
    await advance(COLLECT_MS);
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ eyeOpenL: 0.2, eyeOpenR: 0.2 }));
    await advance(COLLECT_MS);
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ mouthOpen: 0.9 }));
    await advance(COLLECT_MS);
    expect(environment.get().calibration?.neutral.yaw).toBe(1);
    // 終わったあとならもう一度始められる
    fireEvent.click(dialog().getByRole('button', { name: '閉じる' }));
    await act(async () => {
      emitAppEvent(RECALIBRATE_EVENT);
    });
    expect(dialog().getByLabelText('カウント').textContent).toBe('3');
  });

  it('キャンセルすると保存せず、前のキャリブレーションのまま。Escape でもやめる', async () => {
    const previous = { neutral: { yaw: 3, pitch: 0, roll: 0 }, eyeClosed: { l: 0.1, r: 0.1 }, mouthOpenMax: 0.8 };
    const { environment, tracking } = await setup({ environment: { calibration: previous } });
    await startCalibration();
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ faceYaw: 20 }));
    fireEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog', { name: 'キャリブレーション' })).toBeNull();
    await advance(10_000);
    expect(environment.get().calibration).toEqual(previous);

    await startCalibration();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'キャリブレーション' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'キャリブレーション' })).toBeNull();
  });

  it('顔が映っていなければその手順を失敗にし、「もう一度」でやり直せる', async () => {
    const { environment, tracking } = await setup();
    await startCalibration();
    await advance(3 * COUNT_INTERVAL_MS);
    act(() => tracking.emit({ detected: false }));
    await advance(COLLECT_MS);
    expect(dialog().getByRole('alert').textContent).toContain('顔を見つけられなかった');
    fireEvent.click(dialog().getByRole('button', { name: 'もう一度' }));
    expect(dialog().getByLabelText('カウント').textContent).toBe('3');
    await runAllSteps(tracking);
    expect(environment.get().calibration?.mouthOpenMax).toBeCloseTo(0.6, 9);
  });

  it('カメラを開始できなければ知らせて、キャリブレーションを始めない', async () => {
    const { tracking } = await setup();
    tracking.failStart = new Error('使用中');
    await startCalibration();
    expect(screen.queryByRole('dialog', { name: 'キャリブレーション' })).toBeNull();
    expect(screen.getByText('カメラを開始できない: 使用中')).toBeTruthy();
  });

  it('動きのプリセットを選ぶと Environment.trackingPreset に保存し、レイヤーに渡す', async () => {
    const { environment, spies } = await setup();
    fireEvent.click(motion().getByRole('button', { name: '安定' }));
    await act(async () => {});
    expect(environment.get().trackingPreset).toBe('stable');
    expect(spies.setPreset).toHaveBeenLastCalledWith('stable');
    expect(motion().getByRole('button', { name: '安定' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(motion().getByRole('button', { name: '大きく動く' }));
    await act(async () => {});
    expect(environment.get().trackingPreset).toBe('large');
    expect(spies.setPreset).toHaveBeenLastCalledWith('large');
  });

  it('カスタムの値のときは「カスタム」を出し、プリセットを選び直すときに上書きを確かめる', async () => {
    const custom = { minCutoff: 0.8, beta: 0.02, gain: 1.3, deadZone: 0 };
    trackingOptions.set({ custom });
    const { environment, spies } = await setup({ environment: { trackingPreset: 'custom' } });
    expect(motion().getByRole('button', { name: 'カスタム' }).getAttribute('aria-pressed')).toBe('true');
    expect(spies.setPreset).toHaveBeenLastCalledWith('custom', custom);

    fireEvent.click(motion().getByRole('button', { name: '標準' }));
    await act(async () => {});
    const confirm = screen.getByRole('dialog', { name: '個別に調整した値を上書きします' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'キャンセル' }));
    await act(async () => {});
    expect(environment.get().trackingPreset).toBe('custom');

    fireEvent.click(motion().getByRole('button', { name: '標準' }));
    await act(async () => {});
    const confirmAgain = screen.getByRole('dialog', { name: '個別に調整した値を上書きします' });
    fireEvent.click(within(confirmAgain).getByRole('button', { name: 'OK' }));
    await act(async () => {});
    expect(environment.get().trackingPreset).toBe('standard');
    expect(motion().queryByRole('button', { name: 'カスタム' })).toBeNull();
  });

  it('詳細で数値を変えるとカスタムになり、プリセットと同じ値に戻すとそのプリセットになる', async () => {
    const { environment, spies } = await setup();
    fireEvent.click(section().getByRole('button', { name: /動きの数値/ }));
    const gain = section().getByLabelText('動きの大きさ（gain）') as HTMLInputElement;
    expect(gain.value).toBe('1');
    fireEvent.change(gain, { target: { value: '1.5' } });
    fireEvent.blur(gain);
    const custom = { ...TRACKING_PRESETS.standard, gain: 1.5 };
    expect(environment.get().trackingPreset).toBe('custom');
    expect(trackingOptions.get().custom).toEqual(custom);
    expect(spies.setPreset).toHaveBeenLastCalledWith('custom', custom);
    expect(motion().getByRole('button', { name: 'カスタム' })).toBeTruthy();

    fireEvent.change(gain, { target: { value: '1' } });
    fireEvent.keyDown(gain, { key: 'Enter' });
    expect(environment.get().trackingPreset).toBe('standard');
    expect(motion().queryByRole('button', { name: 'カスタム' })).toBeNull();

    // 使えない値は元に戻して知らせる
    const minCutoff = section().getByLabelText('ならしの強さ（minCutoff。小さいほどなめらか）') as HTMLInputElement;
    fireEvent.change(minCutoff, { target: { value: '0' } });
    fireEvent.blur(minCutoff);
    expect(minCutoff.value).toBe('1');
    expect(environment.get().trackingPreset).toBe('standard');
    expect(screen.getByText('minCutoff は 0 より大きい数にする')).toBeTruthy();
  });

  it('目のトラッキングをオフにするとレイヤーに渡し、自動のまばたきにすると添える', async () => {
    const { spies } = await setup();
    fireEvent.click(section().getByRole('checkbox', { name: '目のトラッキング' }));
    expect(spies.setEyeTracking).toHaveBeenLastCalledWith(false);
    expect(trackingOptions.get().eyeTracking).toBe(false);
    expect(section().getByText('目の開け閉めは自動のまばたきにする')).toBeTruthy();
    fireEvent.click(section().getByRole('checkbox', { name: '目のトラッキング' }));
    expect(spies.setEyeTracking).toHaveBeenLastCalledWith(true);
  });
});
