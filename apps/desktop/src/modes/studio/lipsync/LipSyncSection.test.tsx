import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@app/schema';
import {
  FakeAudioSource,
  FakeLipSync,
  FakeTrackingLayer,
  FakeTrackingSource,
  type Renderer,
  type Services,
} from '@app/contracts';
import { createParameterMixer } from '@app/core';
import { createLipSyncProducer } from '@app/audio';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { lipSyncBinding } from './lipSync';
import { register } from './index';

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

async function setup(options: { services?: Partial<Services>; project?: Project; environment?: string } = {}) {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    mixer: createParameterMixer(),
    tracking: new FakeTrackingSource(() => Date.now()),
    trackingLayer: new FakeTrackingLayer(),
    audio: new FakeAudioSource(() => Date.now()), // 一定間隔で話している音量
    lipSync: new FakeLipSync(),
    ...options.services,
  };
  const storage = memoryEnvironmentStorage(options.environment ?? null);
  const environment = createEnvironmentStore(storage);
  const utils = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.store.load(options.project ?? createEmptyProject('テスト'));
    services.editor.set({ mode: 'studio' });
  });
  return { services, environment, storage, ...utils };
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const section = () => within(screen.getByRole('heading', { name: 'リップシンク' }).parentElement!);
const pressed = (group: string, name: string) =>
  within(screen.getByRole('group', { name: group }))
    .getByRole('button', { name })
    .getAttribute('aria-pressed');
const click = (group: string, name: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name }));
const startMic = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'マイクをオン' }));
  });

beforeEach(() => {
  vi.useFakeTimers();
  registry.reset();
  registerStudio();
  register();
  studioRuntime.setScheduler({
    request(cb) {
      const id = setTimeout(() => cb(Date.now()), 16);
      return () => clearTimeout(id);
    },
  });
});
afterEach(() => {
  lipSyncBinding.stopMicrophone();
  studioRuntime.stopTracking();
  vi.useRealTimers();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('スタジオの設定の「リップシンク」', () => {
  it('マイク・無音とみなす音量・口の動き・カメラの口との関係が出る（初期値は 標準・大きい方・-50dB）', async () => {
    const { services } = await setup();
    expect(lipSyncBinding.bound()?.audio).toBe(services.audio);
    expect(lipSyncBinding.bound()?.lipSync).toBe(services.lipSync);
    const s = section();
    expect(s.getByRole('combobox', { name: 'マイク' })).toBeTruthy();
    expect(s.getByRole('option', { name: '既定のマイク' })).toBeTruthy();
    expect(s.getByRole('option', { name: '仮のマイク' })).toBeTruthy();
    expect(s.getByRole('slider', { name: '無音とみなす音量' })).toHaveProperty('value', '-50');
    expect(s.getByLabelText('無音とみなす音量の値').textContent).toBe('-50 dB');
    expect(s.getByRole('meter', { name: '今の音量' }).getAttribute('aria-valuetext')).toBe('マイクを止めている');
    expect(s.getByLabelText('マイクの状態').textContent).toBe('停止中');
    expect(pressed('口の動き', '標準')).toBe('true');
    expect(pressed('口の動き', '控えめ')).toBe('false');
    expect(pressed('カメラの口との関係', '大きい方')).toBe('true');
    // トラッキングの「開始」「停止」と名前の一部が重ならない（名前の一部で探す e2e が取り違えないように）
    const names = s.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.filter((n) => /開始|停止/.test(n))).toEqual([]);
  });

  it('口の動きとカメラの口との関係は project.model.lipSync に保存する（元に戻せる）', async () => {
    const { services } = await setup();
    click('口の動き', '大きめ');
    expect(services.store.get().model.lipSync.strength).toBe('high');
    expect(pressed('口の動き', '大きめ')).toBe('true');
    expect(pressed('口の動き', '標準')).toBe('false');
    click('カメラの口との関係', 'マイクのみ');
    expect(services.store.get().model.lipSync.mouthSource).toBe('micOnly');
    expect(pressed('カメラの口との関係', 'マイクのみ')).toBe('true');
    click('カメラの口との関係', 'カメラのみ');
    expect(services.store.get().model.lipSync.mouthSource).toBe('cameraOnly');
    expect(screen.getByText('カメラのみのときは、マイクの音量を口に使わない')).toBeTruthy();
    act(() => services.store.undo());
    expect(pressed('カメラの口との関係', 'マイクのみ')).toBe('true');
    expect(screen.queryByText('カメラのみのときは、マイクの音量を口に使わない')).toBeNull();
  });

  it('設定はフレームごとに services.lipSync へ渡る（しきい値は Environment から）', async () => {
    const lipSync = new FakeLipSync();
    const configure = vi.spyOn(lipSync, 'configure');
    const environment = JSON.stringify({ silenceThreshold: -44 });
    await setup({ services: { lipSync }, environment });
    await advance(50);
    expect(configure).toHaveBeenLastCalledWith({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -44 });
    click('口の動き', '控えめ');
    click('カメラの口との関係', 'マイクのみ');
    await advance(50);
    expect(configure).toHaveBeenLastCalledWith({ mouthSource: 'micOnly', strength: 'low', silenceThresholdDb: -44 });
  });

  it('しきい値のスライダーは動かしている間すぐに効き、離したときに Environment に保存する', async () => {
    const { environment, storage } = await setup();
    const slider = section().getByRole('slider', { name: '無音とみなす音量' });
    fireEvent.input(slider, { target: { value: '-38' } });
    expect(lipSyncBinding.silenceThreshold()).toBe(-38);
    expect(section().getByLabelText('無音とみなす音量の値').textContent).toBe('-38 dB');
    expect(environment.get().silenceThreshold).toBe(-50); // まだ保存しない
    fireEvent.change(slider, { target: { value: '-36' } });
    expect(environment.get().silenceThreshold).toBe(-36);
    expect(lipSyncBinding.silenceThreshold()).toBe(-36);
    await act(() => environment.flush());
    expect(JSON.parse(storage.text!).silenceThreshold).toBe(-36);
    // ほかから Environment が変わったらスライダーも合わせる
    act(() => environment.set({ silenceThreshold: -60 }));
    expect(slider).toHaveProperty('value', '-60');
    expect(lipSyncBinding.silenceThreshold()).toBe(-60);
  });

  it('マイクをオンにすると今の音量が出て、しきい値を超えると「話している」と出る。オフで止まる', async () => {
    const { services } = await setup();
    const start = vi.spyOn(services.audio, 'start');
    const stop = vi.spyOn(services.audio, 'stop');
    await startMic();
    expect(start).toHaveBeenCalledWith(undefined); // 既定のマイク
    expect(section().getByLabelText('マイクの状態').textContent).toBe('入力中');
    // 仮のマイクは 0.6 秒話して 0.4 秒黙る（話している間は -30〜-18dB、黙っている間は -70dB）
    await advance(300);
    const meter = section().getByRole('meter', { name: '今の音量' });
    const talking = Number(meter.getAttribute('aria-valuenow'));
    expect(talking).toBeGreaterThanOrEqual(-30);
    expect(talking).toBeLessThanOrEqual(-18);
    expect(screen.getByText(/（話している）/)).toBeTruthy();
    await advance(400); // 黙っている間
    expect(meter.getAttribute('aria-valuenow')).toBe('-70');
    expect(screen.queryByText(/（話している）/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'マイクをオフ' }));
    expect(stop).toHaveBeenCalled();
    expect(section().getByLabelText('マイクの状態').textContent).toBe('停止中');
    expect(meter.getAttribute('aria-valuetext')).toBe('マイクを止めている');
  });

  it('マイクを選ぶと Environment に保存し、動いていればそのマイクで開始し直す', async () => {
    const { services, environment } = await setup();
    const start = vi.spyOn(services.audio, 'start');
    const select = section().getByRole('combobox', { name: 'マイク' });
    fireEvent.change(select, { target: { value: 'fake-microphone' } });
    expect(environment.get().microphoneDeviceId).toBe('fake-microphone');
    expect(start).not.toHaveBeenCalled(); // 止まっていれば開始しない
    await startMic();
    expect(start).toHaveBeenLastCalledWith('fake-microphone');
    await act(async () => {
      fireEvent.change(select, { target: { value: '' } });
    });
    expect(environment.get().microphoneDeviceId).toBeNull();
    expect(start).toHaveBeenLastCalledWith(undefined);
    expect(section().getByLabelText('マイクの状態').textContent).toBe('入力中');
  });

  it('前に使ったマイクが見つからなくても選んだままにする', async () => {
    await setup({ environment: JSON.stringify({ microphoneDeviceId: 'usb-mic' }) });
    const select = section().getByRole('combobox', { name: 'マイク' }) as HTMLSelectElement;
    expect(select.value).toBe('usb-mic');
    expect(section().getByRole('option', { name: '（前に使ったマイク）' })).toBeTruthy();
  });

  it('マイクを開始できなければ知らせて、止まった状態に戻る', async () => {
    const audio = new FakeAudioSource(() => Date.now());
    audio.start = async () => {
      throw new Error('マイクの使用が許可されていない');
    };
    await setup({ services: { audio } });
    await startMic();
    expect(screen.getByText('マイクを開始できない: マイクの使用が許可されていない')).toBeTruthy();
    expect(section().getByLabelText('マイクの状態').textContent).toBe('停止中');
  });

  it('スタジオで話すと MouthOpen が動く（仮のマイクと仮のリップシンク）', async () => {
    await setup();
    await advance(50);
    expect(studioRuntime.lastFrame()!.params.MouthOpen).toBe(0);
    await startMic();
    const opens: number[] = [];
    for (let i = 0; i < 100; i++) {
      await advance(20);
      opens.push(studioRuntime.lastFrame()!.params.MouthOpen!);
    }
    expect(Math.max(...opens)).toBeGreaterThan(0.3); // 話している間は開く
    expect(Math.min(...opens)).toBe(0); // 黙っている間は閉じる
  });

  it('スタジオで話すと MouthOpen が動く（本物のリップシンクをつないだとき。止めると閉じる）', async () => {
    await setup({ services: { lipSync: createLipSyncProducer() } });
    await startMic();
    const opens: number[] = [];
    for (let i = 0; i < 50; i++) {
      await advance(20);
      opens.push(studioRuntime.lastFrame()!.params.MouthOpen!);
    }
    // -50dB のしきい値に対して -30〜-18dB → 0.67〜1
    expect(Math.max(...opens)).toBeGreaterThan(0.6);
    expect(Math.min(...opens)).toBeLessThan(0.1);
    await advance(220); // 話している途中で止める
    fireEvent.click(screen.getByRole('button', { name: 'マイクをオフ' }));
    await advance(50);
    expect(studioRuntime.lastFrame()!.params.MouthOpen).toBeLessThan(0.001);
  });

  it('モデルに MouthOpen が無ければ、口が動かないことを知らせる', async () => {
    const p = createEmptyProject('テスト');
    await setup({
      project: { ...p, model: { ...p.model, parameters: p.model.parameters.filter((x) => x.id !== 'MouthOpen') } },
    });
    expect(screen.getByText('モデルに口のパラメータ（MouthOpen）が無いので、口は動かない')).toBeTruthy();
  });

  it('register を何度呼んでも、実行部には1つだけ入る', async () => {
    register();
    register();
    const lipSync = new FakeLipSync();
    const produce = vi.spyOn(lipSync, 'produce');
    await setup({ services: { lipSync } });
    produce.mockClear();
    studioRuntime.tick(Date.now());
    expect(produce).toHaveBeenCalledTimes(1);
  });
});
