import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureStandardParameters, loadProjectJson } from '@app/schema';
import * as audio from '@app/audio';
import type { AudioSource, FrameContext, Layer } from '@app/contracts';
import { createServices, createFakeServices } from './services';
import { createStudioRuntime } from './modes/studio/runtime';
import { createAnimation } from './modes/animation/commands';
import { physicsProject } from './modes/modeling/physics/testModel';
import { enablePhysicsCommand } from './modes/modeling/physics/commands';
import { STANDARD_VOWELS } from './modes/modeling/vowels/commands';
import { createStandardBreathAnimation } from '@app/core';

const sampleJson = Object.values(
  import.meta.glob<string>('../../../fixtures/sample-model/project.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0]!;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('STEP2 の結合', () => {
  it('I-039・I-067: 共通の姿勢から顔・髪を個別に動かす（頭全体のワープは作らない。メッシュの無い fixture は位置のキー）', () => {
    const s = createServices();
    const before = loadProjectJson(sampleJson);
    const p = s.autoSetup.plan(before).command.apply(before);
    // ワープは目のグループの遠近のものだけ（I-067）
    const groupType = (id: string) => p.model.parts.find((q) => q.id === id)?.standardType;
    expect(p.model.warps.map((w) => groupType(w.partId)).sort()).toEqual(['eyeGroupL', 'eyeGroupR']);
    const shiftAt30 = (type: string) => {
      const part = p.model.parts.find((q) => q.standardType === type)!;
      const turn = p.model.bindings.find((b) => b.target.id === part.id && b.parameterIds[0] === 'FaceAngleX')!;
      const key = turn.keys.find((k) => k.coords[0] === 30)!;
      return (key.delta as { position: { x: number } }).position.x;
    };
    // 目（目のグループ）や前髪は向きへ、後ろ髪は逆へ
    expect(shiftAt30('eyeGroupL')).toBeGreaterThan(0);
    expect(shiftAt30('frontHair')).toBeGreaterThan(0);
    expect(shiftAt30('backHair')).toBeLessThan(0);
  });

  it('4つのサービスは本物で、構築時には機器を開かない', () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const services = createServices();
    const fakes = createFakeServices();
    for (const key of ['animations', 'periodic', 'physics', 'vowels'] as const)
      expect(services[key]).not.toBeInstanceOf(fakes[key].constructor);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('表情・通常アニメーション・音量・呼吸・物理を本物の実行部で合成する', () => {
    const s = createServices();
    const p = physicsProject();
    const base = { ...p, model: ensureStandardParameters(p.model, 'step2') };
    const project = enablePhysicsCommand('hair', { physics: 'ph', transform: 'tr', vertices: 've' }).apply(base);
    const animation = createAnimation('うなずき', 'nod');
    animation.tracks = [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: -10, curve: 'linear' }] }];
    animation.duration = 10;
    animation.transition = {
      ...animation.transition,
      blendIn: 0.4,
      blendOut: 0.4,
      curve: 'linear',
      keepLipSync: false,
      keepPhysics: false,
    };
    project.animations = [animation, createStandardBreathAnimation()];
    project.expressions = [
      {
        id: 'a',
        name: '笑顔',
        fadeIn: 0,
        fadeOut: 0,
        entries: [{ parameterId: 'FaceAngleX', value: 3, blend: 'add' }],
      },
      {
        id: 'b',
        name: '照れ',
        fadeIn: 0,
        fadeOut: 0,
        entries: [{ parameterId: 'FaceAngleX', value: 2, blend: 'add' }],
      },
    ];
    s.store.load(project);
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    runtime.registerLayerProducer({
      id: 'tracking',
      produce: () => ({ id: 'tracking', weight: 1, values: { FaceAngleX: 10, MouthOpen: 0.2 } }),
    });
    for (const producer of [s.expressions, s.animations, s.lipSync, s.periodic])
      runtime.registerLayerProducer(producer);
    const physical = vi.spyOn(s.physics, 'produce');
    const detach = runtime.attach(s);
    s.expressions.toggle('a', 0);
    s.expressions.toggle('b', 0);
    s.periodic.setActive(['standard-breath']);
    runtime.tick(0);
    expect(runtime.tick(1000)!.params.FaceAngleX).toBe(15);
    s.animations.play('nod', 1000);
    expect(runtime.tick(1000)!.params.FaceAngleX).toBe(15);
    const half = runtime.tick(1200)!.params;
    expect(half.FaceAngleX).toBeCloseTo(2.5);
    expect(half.Breath).toBeGreaterThan(0);
    expect(physical.mock.calls.at(-1)![0].flags).toEqual({ lipSyncWeight: 0.5, physicsActive: false });
    expect(physical.mock.results.at(-1)!.value).toBeNull();
    s.animations.stop('nod', 1400);
    runtime.tick(1400);
    const end = runtime.tick(1800)!.params;
    expect(end.FaceAngleX).toBe(15);
    expect(end.Breath).toBeGreaterThan(half.Breath!);
    expect(physical.mock.calls.at(-1)![0].flags).toEqual({ lipSyncWeight: 1, physicsActive: true });
    expect(end.Sway_hair).toBeDefined();
    detach();
  });

  it('サービスで購読した音声を本物の母音推定から口の形へ反映する', () => {
    let send: Parameters<AudioSource['onSamples']>[0] = () => {};
    const source: AudioSource = {
      listDevices: async () => [],
      start: async () => {},
      stop() {},
      onLevel: () => () => {},
      onSamples: (listener) => {
        send = listener;
        return () => {};
      },
    };
    vi.spyOn(audio, 'createAudioSource').mockReturnValue(source);
    const services = createServices();
    const p = services.store.get();
    const project = { ...p, model: ensureStandardParameters(p.model, 'step2') };
    project.model.lipSync.vowels = STANDARD_VOWELS;
    const estimate = vi.spyOn(services.vowels, 'estimate');
    // 成熟した「い」の合成波形を2つの10ms窓で送り、サービスの購読と口形への合成を確認する。
    const synthesized = audio.synthVowel({
      sampleRate: 48000,
      durationMs: 100,
      f0: 130,
      formants: [
        { frequency: 300, bandwidth: 80 },
        { frequency: 2300, bandwidth: 100 },
        { frequency: 3000, bandwidth: 140 },
      ],
    });
    services.lipSync.update({ time: 0, rmsDb: -20 });
    send(synthesized.subarray(3840, 4320), 48000, 0);
    expect(estimate).not.toHaveBeenCalled();
    send(synthesized.subarray(4320, 4800), 48000, 10);
    expect(estimate).toHaveBeenCalledTimes(1);
    const ctx: FrameContext = {
      now: 20,
      dt: 16,
      project,
      mixedSoFar: {},
      flags: { lipSyncWeight: 1, physicsActive: true },
    };
    const layer = services.lipSync.produce(ctx) as Layer;
    expect(layer.values.MouthOpen).toBeGreaterThan(0);
    expect(layer.blend?.MouthWidth).toBe('override');
    expect((services.lipSync as audio.AudioLipSyncProducer).vowelFrameTime()).toBe(0);
  });
});
