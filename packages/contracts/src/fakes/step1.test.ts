import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Binding, type Hotkey } from '@app/schema';
import type { AudioLevel, FrameContext, TrackingFrame } from '../index';
import { FAKE_SILENCE_DB, FakeAudioSource, FakeLipSync, fakeAudioLevel } from './audio';
import { FakeKeyGenerator } from './editing';
import { FakeAutoBlink, FakeBodyFollow, FakeExpressions } from './motion';
import { FakeCalibration, FakeHotkeys, FakeSpout } from './system';
import { FakeTrackingLayer } from './tracking';

afterEach(() => {
  vi.useRealTimers();
});

function context(patch: Partial<FrameContext> = {}): FrameContext {
  return {
    now: 0,
    dt: 16,
    project: createEmptyProject('テスト'),
    mixedSoFar: {},
    flags: { lipSyncWeight: 1, physicsActive: true },
    ...patch,
  };
}

function frame(patch: Partial<TrackingFrame>): TrackingFrame {
  return {
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
    ...patch,
  };
}

describe('FakeAudioSource', () => {
  it('10ms ごとに、話している音量と黙っている音量を一定間隔で出し、stop で止まる', async () => {
    vi.useFakeTimers();
    let now = 0;
    const source = new FakeAudioSource(() => now);
    const levels: AudioLevel[] = [];
    const chunks: { length: number; sampleRate: number }[] = [];
    source.onLevel((x) => levels.push(x));
    const offSamples = source.onSamples((s, sampleRate) => chunks.push({ length: s.length, sampleRate }));
    await source.start();
    for (let i = 0; i < 200; i++) {
      now += 10;
      vi.advanceTimersByTime(10);
    }
    expect(levels.length).toBeGreaterThanOrEqual(199);
    expect(levels.some((l) => l.rmsDb > -35)).toBe(true); // 話している
    expect(levels.some((l) => l.rmsDb === FAKE_SILENCE_DB)).toBe(true); // 黙っている
    expect(chunks[0]).toEqual({ length: 480, sampleRate: 48000 });
    offSamples();
    source.stop();
    const count = levels.length;
    vi.advanceTimersByTime(100);
    expect(levels.length).toBe(count);
    expect(await source.listDevices()).toHaveLength(1);
  });

  it('1秒のうち最初の0.6秒は話し、残りは黙る', () => {
    expect(fakeAudioLevel(0)).toBeCloseTo(-30);
    expect(fakeAudioLevel(75)).toBeCloseTo(-18);
    expect(fakeAudioLevel(599)).toBeGreaterThan(-31);
    expect(fakeAudioLevel(600)).toBe(FAKE_SILENCE_DB);
    expect(fakeAudioLevel(1000)).toBeCloseTo(-30);
  });
});

describe('FakeLipSync', () => {
  it('音量をそのまま MouthOpen にする（しきい値で 0、0dBFS で 1）', () => {
    const lipSync = new FakeLipSync();
    expect(lipSync.produce(context())).toBeNull(); // まだ音量が無い
    lipSync.configure({ mouthSource: 'max', strength: 'standard', silenceThresholdDb: -40 });
    lipSync.update({ time: 0, rmsDb: -20 });
    expect(lipSync.produce(context())).toEqual({
      id: 'lipSync',
      weight: 1,
      values: { MouthOpen: 0.5 },
      blend: { MouthOpen: 'max' },
    });
    lipSync.update({ time: 10, rmsDb: -60 });
    expect(lipSync.produce(context())!.values.MouthOpen).toBe(0);
  });

  it('micOnly は上書き、cameraOnly は何も出さない。weight は lipSyncWeight', () => {
    const lipSync = new FakeLipSync();
    lipSync.update({ time: 0, rmsDb: 0 });
    lipSync.configure({ mouthSource: 'micOnly', strength: 'standard', silenceThresholdDb: -50 });
    const layer = lipSync.produce(context({ flags: { lipSyncWeight: 0.25, physicsActive: true } }));
    expect(layer).toMatchObject({ weight: 0.25, values: { MouthOpen: 1 }, blend: { MouthOpen: 'override' } });
    lipSync.configure({ mouthSource: 'cameraOnly', strength: 'standard', silenceThresholdDb: -50 });
    expect(lipSync.produce(context())).toBeNull();
  });
});

describe('FakeAutoBlink', () => {
  it('4秒ごとに 150ms だけ両目を閉じる', () => {
    const blink = new FakeAutoBlink();
    expect(blink.tick(0)).toEqual({ EyeOpenL: 1, EyeOpenR: 1 });
    expect(blink.tick(3849)).toEqual({ EyeOpenL: 1, EyeOpenR: 1 });
    expect(blink.tick(3850)).toEqual({ EyeOpenL: 0, EyeOpenR: 0 });
    expect(blink.tick(3999)).toEqual({ EyeOpenL: 0, EyeOpenR: 0 });
    expect(blink.tick(4000)).toEqual({ EyeOpenL: 1, EyeOpenR: 1 });
    expect(blink.tick(7900)).toEqual({ EyeOpenL: 0, EyeOpenR: 0 });
  });
});

describe('FakeBodyFollow', () => {
  it('何も出さず、強さは覚えるだけ', () => {
    const body = new FakeBodyFollow();
    expect(body.id).toBe('bodyFollow');
    body.setStrength('high');
    expect(body.strength).toBe('high');
    expect(body.produce(context({ mixedSoFar: { FaceAngleX: 30 } }))).toBeNull();
  });
});

describe('FakeExpressions', () => {
  it('適用した表情の値をそのまま出し、null で解除する', () => {
    const project = {
      ...createEmptyProject('テスト'),
      expressions: [
        {
          id: 'smile',
          name: '笑顔',
          entries: [
            { parameterId: 'MouthForm', value: 1, blend: 'override' as const },
            { parameterId: 'EyeOpenL', value: 0.8, blend: 'multiply' as const },
          ],
          fadeIn: 0.3,
          fadeOut: 0.3,
        },
      ],
    };
    const expressions = new FakeExpressions();
    expect(expressions.produce(context({ project }))).toBeNull();
    expressions.apply('smile', 0);
    expect(expressions.active()).toBe('smile');
    expect(expressions.produce(context({ project }))).toEqual({
      id: 'expression',
      weight: 1,
      values: { MouthForm: 1, EyeOpenL: 0.8 },
      blend: { MouthForm: 'override', EyeOpenL: 'multiply' },
    });
    expressions.apply('missing', 0);
    expect(expressions.produce(context({ project }))).toBeNull();
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    expressions.apply(null, 0);
    expect(expressions.active()).toBeNull();
  });
});

describe('FakeCalibration', () => {
  it('正面を取るまでは null。検出できたフレームの平均と口の最大を返し、reset で消える', () => {
    const calibration = new FakeCalibration();
    expect(calibration.result()).toBeNull();
    calibration.capture('neutral', [
      frame({ faceYaw: 4, facePitch: -2, faceRoll: 1 }),
      frame({ faceYaw: 6, facePitch: -4, faceRoll: 3 }),
      frame({ detected: false, faceYaw: 100 }),
    ]);
    expect(calibration.result()).toEqual({
      neutral: { yaw: 5, pitch: -3, roll: 2 },
      eyeClosed: { l: 0, r: 0 },
      mouthOpenMax: 1,
    });
    calibration.capture('eyesClosed', [frame({ eyeOpenL: 0.1, eyeOpenR: 0.2 })]);
    calibration.capture('mouthOpen', [frame({ mouthOpen: 0.5 }), frame({ mouthOpen: 0.7 })]);
    expect(calibration.result()).toMatchObject({ eyeClosed: { l: 0.1, r: 0.2 }, mouthOpenMax: 0.7 });
    calibration.reset();
    expect(calibration.result()).toBeNull();
  });
});

describe('FakeHotkeys', () => {
  const hotkey = (id: string, keys: string): Hotkey => ({
    id,
    keys,
    action: 'expression',
    targetId: null,
    mode: 'toggle',
  });

  it('登録し、同じキーは conflict。press で handler を呼び、unregisterAll で消える', async () => {
    const hotkeys = new FakeHotkeys();
    const phases: string[] = [];
    expect(await hotkeys.register(hotkey('a', 'Ctrl+Shift+1'), (p) => phases.push(p))).toBe('ok');
    expect(await hotkeys.register(hotkey('b', 'ctrl+shift+1'), () => {})).toBe('conflict');
    expect(hotkeys.registered().map((h) => h.id)).toEqual(['a']);
    expect(hotkeys.press('Ctrl+Shift+1')).toBe(true);
    expect(hotkeys.press('Ctrl+Shift+1', 'up')).toBe(true);
    expect(phases).toEqual(['down', 'up']);
    expect(hotkeys.press('Ctrl+Shift+2')).toBe(false);
    await hotkeys.unregisterAll();
    expect(hotkeys.registered()).toEqual([]);
  });
});

describe('FakeSpout', () => {
  it('何もしない（開始している間に送った回数だけ数える）', async () => {
    const spout = new FakeSpout();
    const model = { items: [], byPartId: {} };
    const view = { scale: 1, offset: { x: 0, y: 0 } };
    spout.submit(model, view, { type: 'transparent' });
    await spout.start({ width: 1920, height: 1080, fps: 60 });
    await spout.setTextures({});
    spout.submit(model, view, { type: 'transparent' });
    await spout.stop();
    expect(spout.submitted).toBe(1);
    expect(spout.running).toBe(false);
  });
});

describe('STEP1 で足したメソッド（仮実装）', () => {
  it('FakeKeyGenerator の rotate・surface・ease・regenerate はバインディングをそのまま返す', () => {
    const generator = new FakeKeyGenerator();
    const model = createEmptyProject('テスト').model;
    const binding: Binding = {
      id: 'b',
      target: { type: 'part', id: 'p' },
      channel: 'transform',
      parameterIds: ['FaceAngleX'],
      keyValues: [[-30, 0, 30]],
      keys: [],
      generation: 'linear',
      divisions: null,
    };
    expect(generator.rotate(binding, model)).toBe(binding);
    expect(generator.surface(binding, model)).toBe(binding);
    expect(generator.ease(binding)).toBe(binding);
    expect(generator.regenerate(binding, model, [0, 30])).toBe(binding);
  });

  it('FakeTrackingLayer の setCalibration・setPreset・setEyeTracking は何もしない', () => {
    const layer = new FakeTrackingLayer();
    layer.update(frame({ faceYaw: 10 }));
    layer.setCalibration({ neutral: { yaw: 5, pitch: 0, roll: 0 }, eyeClosed: { l: 0, r: 0 }, mouthOpenMax: 1 });
    layer.setPreset('custom', { minCutoff: 1, beta: 0, gain: 1, deadZone: 0 });
    layer.setEyeTracking(false);
    expect(layer.tick(0).values.FaceAngleX).toBe(10);
  });
});
