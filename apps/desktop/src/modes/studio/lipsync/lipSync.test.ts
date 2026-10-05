import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@app/schema';
import {
  FakeLipSync,
  FakeTrackingLayer,
  type AudioLevel,
  type AudioSource,
  type FrameContext,
  type Layer,
  type LayerProducer,
  type Services,
  type TrackingFrame,
  type TrackingSource,
} from '@app/contracts';
import { createParameterMixer } from '@app/core';
import { createLipSyncProducer } from '@app/audio';
import { createFakeServices } from '../../../services';
import { createStudioRuntime } from '../runtime';
import { createLipSyncBinding, setLipSyncCommand, type MouthSource } from './lipSync';

function withLipSync(
  mouthSource: MouthSource,
  strength: Project['model']['lipSync']['strength'] = 'standard',
): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: { ...p.model, lipSync: { ...p.model.lipSync, mouthSource, strength } } };
}

function ctx(project: Project, lipSyncWeight = 1): FrameContext {
  return { now: 0, dt: 16, project, mixedSoFar: {}, flags: { lipSyncWeight, physicsActive: true } };
}

// 手で音量を出すマイク
function manualAudio(): AudioSource & { emit(level: AudioLevel): void; starts: (string | undefined)[]; stops: number } {
  const listeners = new Set<(x: AudioLevel) => void>();
  const audio = {
    starts: [] as (string | undefined)[],
    stops: 0,
    fail: null as Error | null,
    listDevices: async () => [{ id: 'mic', label: 'マイク' }],
    async start(deviceId?: string) {
      audio.starts.push(deviceId);
    },
    stop() {
      audio.stops += 1;
    },
    onLevel(listener: (x: AudioLevel) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onSamples: () => () => {},
    emit(level: AudioLevel) {
      for (const l of [...listeners]) l(level);
    },
  };
  return audio;
}

// 同じ音量を ms ミリ秒続ける（10ms ごと）
function talk(audio: { emit(level: AudioLevel): void }, from: number, ms: number, rmsDb: number): number {
  for (let t = from + 10; t <= from + ms; t += 10) audio.emit({ time: t, rmsDb });
  return from + ms;
}

describe('setLipSyncCommand', () => {
  it('project.model.lipSync の口の動き・カメラの口との関係を変える。同じなら同じ参照を返す', () => {
    const p = createEmptyProject('テスト');
    const next = setLipSyncCommand('口の動きを変える', { strength: 'high' }).apply(p);
    expect(next.model.lipSync).toEqual({ mouthSource: 'max', strength: 'high', vowels: [] });
    expect(p.model.lipSync.strength).toBe('standard'); // 元は変えない
    const micOnly = setLipSyncCommand('カメラの口との関係を変える', { mouthSource: 'micOnly' }).apply(next);
    expect(micOnly.model.lipSync).toMatchObject({ mouthSource: 'micOnly', strength: 'high' });
    expect(setLipSyncCommand('同じ', { strength: 'high' }).apply(next)).toBe(next);
  });
});

describe('createLipSyncBinding', () => {
  it("つないでいなければ何も出さない。つなぐと services.lipSync に任せる（id 'lipSync'）", () => {
    const binding = createLipSyncBinding();
    expect(binding.producer.id).toBe('lipSync');
    expect(binding.producer.produce(ctx(withLipSync('max')))).toBeNull();
    const lipSync = createLipSyncProducer();
    binding.bind({ audio: manualAudio(), lipSync });
    expect(binding.bound()?.lipSync).toBe(lipSync);
    expect(binding.producer.produce(ctx(withLipSync('max')))).toEqual({
      id: 'lipSync',
      weight: 1,
      values: { MouthOpen: 0 },
      blend: { MouthOpen: 'max' },
    });
  });

  it('プロジェクトの設定と無音のしきい値を services.lipSync に渡す（変わったときだけ）', () => {
    const binding = createLipSyncBinding();
    const lipSync = new FakeLipSync();
    const configure = vi.spyOn(lipSync, 'configure');
    binding.bind({ audio: manualAudio(), lipSync });
    expect(configure).not.toHaveBeenCalled(); // プロジェクトの設定は最初のフレームで分かる

    const project = withLipSync('micOnly', 'high');
    binding.producer.produce(ctx(project));
    expect(configure).toHaveBeenLastCalledWith({ mouthSource: 'micOnly', strength: 'high', silenceThresholdDb: -50 });
    binding.producer.produce(ctx(project));
    expect(configure).toHaveBeenCalledTimes(1);

    binding.setSilenceThreshold(-42); // すぐに渡す
    expect(configure).toHaveBeenLastCalledWith({ mouthSource: 'micOnly', strength: 'high', silenceThresholdDb: -42 });
    expect(binding.silenceThreshold()).toBe(-42);
    binding.setSilenceThreshold(Number.NaN);
    expect(binding.silenceThreshold()).toBe(-42);

    binding.producer.produce(ctx(withLipSync('cameraOnly', 'high')));
    expect(configure).toHaveBeenLastCalledWith({
      mouthSource: 'cameraOnly',
      strength: 'high',
      silenceThresholdDb: -42,
    });
    expect(configure).toHaveBeenCalledTimes(3);

    const next = new FakeLipSync(); // services が替わったら、つなぎ直したものにも渡す
    const configureNext = vi.spyOn(next, 'configure');
    binding.bind({ audio: binding.bound()!.audio, lipSync: next });
    expect(configureNext).toHaveBeenLastCalledWith({
      mouthSource: 'cameraOnly',
      strength: 'high',
      silenceThresholdDb: -42,
    });
  });

  it('マイクの音量（onLevel）を services.lipSync.update に渡す', () => {
    const binding = createLipSyncBinding();
    const audio = manualAudio();
    const lipSync = createLipSyncProducer();
    const update = vi.spyOn(lipSync, 'update');
    binding.bind({ audio, lipSync });
    audio.emit({ time: 10, rmsDb: -20 });
    expect(update).toHaveBeenCalledWith({ time: 10, rmsDb: -20 });
    talk(audio, 10, 300, -20);
    expect((binding.producer.produce(ctx(withLipSync('max'))) as Layer).values.MouthOpen).toBeCloseTo(1, 3);
  });

  it('マイクを開始・停止する。状態と、今の音量（50ms ごと）を知らせる', async () => {
    const binding = createLipSyncBinding();
    const audio = manualAudio();
    binding.bind({ audio, lipSync: createLipSyncProducer() });
    const listener = vi.fn();
    binding.subscribe(listener);
    expect(binding.state()).toEqual({ status: 'stopped', level: null });

    const starting = binding.startMicrophone('mic');
    expect(binding.state().status).toBe('starting');
    await starting;
    expect(audio.starts).toEqual(['mic']);
    expect(binding.state()).toEqual({ status: 'running', level: null });

    listener.mockClear();
    talk(audio, 0, 100, -30); // 10ms ごとに 10 回
    expect(binding.state().level).toBe(-30);
    expect(listener).toHaveBeenCalledTimes(1); // 値が変わらなければ知らせない
    talk(audio, 100, 100, -25);
    expect(binding.state().level).toBe(-25);
    expect(listener).toHaveBeenCalledTimes(2);

    binding.stopMicrophone();
    expect(audio.stops).toBe(1);
    expect(binding.state()).toEqual({ status: 'stopped', level: null });
    binding.stopMicrophone(); // 2回止めても何もしない
    expect(audio.stops).toBe(1);

    await binding.startMicrophone(null); // 既定のマイク
    expect(audio.starts).toEqual(['mic', undefined]);
  });

  it('止めると口を閉じる（開いたまま止めない）', async () => {
    const binding = createLipSyncBinding();
    const audio = manualAudio();
    const lipSync = createLipSyncProducer();
    binding.bind({ audio, lipSync });
    await binding.startMicrophone();
    talk(audio, 0, 300, -20);
    expect(lipSync.mouthOpen()).toBeGreaterThan(0.99);
    binding.stopMicrophone();
    expect(lipSync.mouthOpen()).toBeLessThan(0.001);
  });

  it('開始に失敗したら止まった状態に戻り、失敗を返す', async () => {
    const binding = createLipSyncBinding();
    const audio = manualAudio();
    audio.start = async () => {
      throw new Error('NotAllowedError');
    };
    binding.bind({ audio, lipSync: createLipSyncProducer() });
    await expect(binding.startMicrophone()).rejects.toThrow('NotAllowedError');
    expect(binding.state().status).toBe('stopped');
    await expect(createLipSyncBinding().startMicrophone()).rejects.toThrow('マイクがまだつながっていない');
  });

  it('開始を待つ間に止めたら、止まったまま', async () => {
    const binding = createLipSyncBinding();
    const audio = manualAudio();
    let release!: () => void;
    audio.start = () => new Promise<void>((r) => (release = r));
    binding.bind({ audio, lipSync: createLipSyncProducer() });
    const starting = binding.startMicrophone();
    binding.stopMicrophone();
    release();
    await starting;
    expect(binding.state().status).toBe('stopped');
  });

  it('services が替わったら前のマイクを離し、新しいマイクの音量を受け取る', async () => {
    const binding = createLipSyncBinding();
    const first = manualAudio();
    const lipSync = createLipSyncProducer();
    const update = vi.spyOn(lipSync, 'update');
    binding.bind({ audio: first, lipSync });
    await binding.startMicrophone();
    const second = manualAudio();
    binding.bind({ audio: second, lipSync });
    expect(first.stops).toBe(1);
    expect(binding.state().status).toBe('stopped');
    update.mockClear();
    first.emit({ time: 10, rmsDb: -20 });
    expect(update).not.toHaveBeenCalled();
    second.emit({ time: 10, rmsDb: -20 });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

// ---- ミキサーと組み合わせる（3つの mouthSource） ----

describe('リップシンクとカメラの口の合成（ミキサー）', () => {
  const mixer = createParameterMixer();
  const project = createEmptyProject('テスト'); // MouthOpen（0..1）がある
  const camera = (mouthOpen: number): Layer => ({ id: 'tracking', weight: 1, values: { MouthOpen: mouthOpen } });

  // 音量を続けて、ならしきった開きにしたリップシンク
  function lipSyncAt(rmsDb: number, mouthSource: MouthSource) {
    const lipSync = createLipSyncProducer();
    lipSync.configure({ mouthSource, strength: 'standard', silenceThresholdDb: -50 });
    for (let t = 10; t <= 600; t += 10) lipSync.update({ time: t, rmsDb });
    return lipSync;
  }
  const mouth = (layers: Layer[]) => mixer.mix(project.model.parameters, layers).MouthOpen;

  it("'max' はカメラの口とマイクの口の大きい方", () => {
    const loud = lipSyncAt(-26, 'max'); // 開き 0.8
    expect(mouth([camera(0.3), loud.produce(ctx(project))])).toBeCloseTo(0.8, 3);
    expect(mouth([camera(0.9), loud.produce(ctx(project))])).toBeCloseTo(0.9, 3);
    const silent = lipSyncAt(-70, 'max'); // 黙っているときはカメラの口のまま
    expect(mouth([camera(0.45), silent.produce(ctx(project))])).toBe(0.45);
  });

  it("'micOnly' はカメラの口を使わずマイクの口にする（黙れば閉じる）", () => {
    expect(mouth([camera(0.3), lipSyncAt(-26, 'micOnly').produce(ctx(project))])).toBeCloseTo(0.8, 3);
    expect(mouth([camera(0.9), lipSyncAt(-26, 'micOnly').produce(ctx(project))])).toBeCloseTo(0.8, 3);
    expect(mouth([camera(0.6), lipSyncAt(-70, 'micOnly').produce(ctx(project))])).toBe(0);
  });

  it("'cameraOnly' はマイクの音量にかかわらずカメラの口のまま", () => {
    expect(mouth([camera(0.3), lipSyncAt(-26, 'cameraOnly').produce(ctx(project))])).toBe(0.3);
    expect(mouth([camera(0), lipSyncAt(-10, 'cameraOnly').produce(ctx(project))])).toBe(0);
  });

  it('lipSyncWeight で効き方を弱める（0 ならカメラの口のまま）', () => {
    const micOnly = lipSyncAt(-26, 'micOnly');
    expect(mouth([camera(0.3), micOnly.produce(ctx(project, 0.5))])).toBeCloseTo(0.55, 3); // 0.3 と 0.8 の中間
    expect(mouth([camera(0.3), micOnly.produce(ctx(project, 0))])).toBe(0.3);
    const max = lipSyncAt(-26, 'max');
    expect(mouth([camera(0.3), max.produce(ctx(project, 0.5))])).toBeCloseTo(0.55, 3);
  });

  it('表情・アニメーションの口のあとに合成する（LAYER_ORDER の lipSync の位置）', () => {
    const expression: Layer = { id: 'expression', weight: 1, values: { MouthOpen: 0.2 }, blend: { MouthOpen: 'add' } };
    // カメラ 0.3 + 表情 0.2 = 0.5 と、マイク 0.8 の大きい方
    expect(mouth([lipSyncAt(-26, 'max').produce(ctx(project)), expression, camera(0.3)])).toBeCloseTo(0.8, 3);
    // カメラ 0.5 + 表情 0.2 = 0.7 と、マイク 0.5 の大きい方
    expect(mouth([lipSyncAt(-35, 'max').produce(ctx(project)), expression, camera(0.5)])).toBeCloseTo(0.7, 3);
  });
});

// ---- スタジオの実行部で ----

function manualTracking(): TrackingSource & { emit(frame: Partial<TrackingFrame>): void } {
  const listeners = new Set<(frame: TrackingFrame) => void>();
  return {
    listDevices: async () => [{ id: 'cam', label: 'カメラ' }],
    configureCapture() {},
    captureStats: () => null,
    onCaptureStats: () => () => {},
    start: async () => {},
    stop: () => {},
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(frame) {
      const full: TrackingFrame = {
        time: 0,
        detected: true,
        faceYaw: 0,
        facePitch: 0,
        faceRoll: 0,
        eyeOpenL: 1,
        eyeOpenR: 1,
        eyeBallX: 0,
        eyeBallY: 0,
        mouthOpen: 0,
        ...frame,
      };
      for (const l of [...listeners]) l(full);
    },
  };
}

describe('スタジオの実行部でのリップシンク', () => {
  function setup(mouthSource: MouthSource) {
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const tracking = manualTracking();
    const audio = manualAudio();
    const services: Services = {
      ...createFakeServices(),
      mixer: createParameterMixer(),
      tracking,
      trackingLayer: new FakeTrackingLayer(),
      audio,
      lipSync: createLipSyncProducer(), // カード44で入る本物
    };
    services.store.load(withLipSync(mouthSource));
    const binding = createLipSyncBinding();
    runtime.registerLayerProducer(binding.producer);
    binding.bind({ audio: services.audio, lipSync: services.lipSync });
    runtime.attach(services);
    return { runtime, tracking, audio, services, binding };
  }

  it('話すと MouthOpen が動き、黙ると閉じる（カメラの口が閉じていても）', async () => {
    const { runtime, tracking, audio, binding } = setup('max');
    await runtime.startTracking('cam');
    await binding.startMicrophone();
    tracking.emit({ mouthOpen: 0 });
    expect(runtime.tick(0)!.params.MouthOpen).toBe(0);
    let t = talk(audio, 0, 30, -26); // 30ms 話す
    const early = runtime.tick(t)!.params.MouthOpen!;
    expect(early).toBeGreaterThan(0.8 * 0.6); // 30ms で目標（0.8）の 63%
    t = talk(audio, t, 300, -26);
    expect(runtime.tick(t)!.params.MouthOpen).toBeCloseTo(0.8, 3);
    t = talk(audio, t, 600, -70);
    expect(runtime.tick(t)!.params.MouthOpen).toBeLessThan(0.01);
  });

  it('3つの mouthSource で合成の結果が正しい（カメラの口 0.3、マイクの口 0.8 / 0）', async () => {
    const expected: Record<MouthSource, { talking: number; silent: number }> = {
      max: { talking: 0.8, silent: 0.3 },
      micOnly: { talking: 0.8, silent: 0 },
      cameraOnly: { talking: 0.3, silent: 0.3 },
    };
    for (const mouthSource of ['max', 'micOnly', 'cameraOnly'] as const) {
      const { runtime, tracking, audio, binding } = setup(mouthSource);
      await runtime.startTracking('cam');
      await binding.startMicrophone();
      tracking.emit({ mouthOpen: 0.3 });
      let t = talk(audio, 0, 600, -26);
      expect(runtime.tick(t)!.params.MouthOpen).toBeCloseTo(expected[mouthSource].talking, 3);
      t = talk(audio, t, 1500, -70);
      expect(runtime.tick(t)!.params.MouthOpen).toBeCloseTo(expected[mouthSource].silent, 3);
    }
  });

  it('プロジェクトの設定を変えると次のフレームから合成が変わる（元に戻す・やり直しも）', async () => {
    const { runtime, tracking, audio, binding, services } = setup('max');
    await runtime.startTracking('cam');
    await binding.startMicrophone();
    tracking.emit({ mouthOpen: 0.9 });
    const t = talk(audio, 0, 600, -26);
    expect(runtime.tick(t)!.params.MouthOpen).toBeCloseTo(0.9, 3);
    services.store.dispatch(setLipSyncCommand('カメラの口との関係を変える', { mouthSource: 'micOnly' }));
    expect(runtime.tick(t + 16)!.params.MouthOpen).toBeCloseTo(0.8, 3);
    services.store.undo();
    expect(runtime.tick(t + 32)!.params.MouthOpen).toBeCloseTo(0.9, 3);
  });

  it('口の動きの強さとしきい値が効く', async () => {
    const { runtime, audio, binding, services } = setup('micOnly');
    await binding.startMicrophone();
    services.store.dispatch(setLipSyncCommand('口の動きを変える', { strength: 'low' }));
    runtime.tick(0); // 設定はフレームで渡る
    let t = talk(audio, 0, 600, -35); // +15dB → 0.5 × 0.7
    expect(runtime.tick(t)!.params.MouthOpen).toBeCloseTo(0.35, 3);
    binding.setSilenceThreshold(-35); // しきい値ちょうどは 0
    t = talk(audio, t, 1500, -35);
    expect(runtime.tick(t)!.params.MouthOpen).toBeLessThan(0.001);
  });

  it('アニメーションが lipSyncWeight を 0 にすると、カメラの口のまま', async () => {
    const { runtime, tracking, audio, binding } = setup('micOnly');
    // アニメーションのレイヤー（カード39などで入る）の代わりに、flags だけ書き換える producer
    const animation: LayerProducer = {
      id: 'animation',
      produce(c) {
        c.flags.lipSyncWeight = 0;
        return null;
      },
    };
    const off = runtime.registerLayerProducer(animation);
    await runtime.startTracking('cam');
    await binding.startMicrophone();
    tracking.emit({ mouthOpen: 0.3 });
    const t = talk(audio, 0, 600, -26);
    expect(runtime.tick(t)!.params.MouthOpen).toBe(0.3);
    off();
    expect(runtime.tick(t + 16)!.params.MouthOpen).toBeCloseTo(0.8, 3);
  });

  it('プロジェクトに MouthOpen が無ければ何も足さない', async () => {
    const { runtime, audio, binding, services } = setup('micOnly');
    const p = withLipSync('micOnly');
    services.store.load({
      ...p,
      model: { ...p.model, parameters: p.model.parameters.filter((x) => x.id !== 'MouthOpen') },
    });
    await binding.startMicrophone();
    const t = talk(audio, 0, 300, -20);
    expect('MouthOpen' in runtime.tick(t)!.params).toBe(false);
  });
});
