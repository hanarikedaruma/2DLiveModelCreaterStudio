import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Project } from '@app/schema';
import {
  FakeBodyFollow,
  FakeTrackingLayer,
  type FrameContext,
  type Services,
  type TrackingFrame,
  type TrackingSource,
} from '@app/contracts';
import { createBodyFollowProducer, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../../services';
import { createStudioRuntime } from '../runtime';
import { createBodyFollowBinding, memoryStrengthStorage } from './bodyFollow';

function ctx(project: Project, mixedSoFar: Record<string, number>): FrameContext {
  return { now: 0, dt: 0, project, mixedSoFar, flags: { lipSyncWeight: 1, physicsActive: true } };
}

function step1Project(): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step1') };
}

describe('createBodyFollowBinding', () => {
  it('つないでいなければ何も出さない。つなぐと services.bodyFollow に任せる', () => {
    const binding = createBodyFollowBinding(memoryStrengthStorage());
    expect(binding.producer.id).toBe('bodyFollow');
    expect(binding.producer.produce(ctx(step1Project(), { FaceAngleX: 20 }))).toBeNull();
    const body = createBodyFollowProducer();
    binding.bind(body);
    expect(binding.bound()).toBe(body);
    expect(binding.producer.produce(ctx(step1Project(), { FaceAngleX: 20, FaceAngleZ: 10 }))).toEqual({
      id: 'bodyFollow',
      weight: 1,
      values: { BodyAngleX: 6, BodyAngleZ: 3 },
    });
  });

  it('強さの初期値は標準。選んだ強さを保存し、つないでいるものへ渡し、知らせる', () => {
    const storage = memoryStrengthStorage();
    const binding = createBodyFollowBinding(storage);
    const body = new FakeBodyFollow();
    const setStrength = vi.spyOn(body, 'setStrength');
    binding.bind(body);
    expect(binding.strength()).toBe('standard');
    expect(setStrength).toHaveBeenLastCalledWith('standard');

    const listener = vi.fn();
    const off = binding.subscribe(listener);
    binding.setStrength('high');
    expect(binding.strength()).toBe('high');
    expect(body.strength).toBe('high');
    expect(storage.value).toBe('high');
    expect(listener).toHaveBeenCalledTimes(1);
    binding.setStrength('high'); // 同じなら何もしない
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    binding.setStrength('low');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(body.strength).toBe('low');
  });

  it('保存した強さを読み、あとからつないだものにも渡す。読めない値は標準', () => {
    const binding = createBodyFollowBinding(memoryStrengthStorage('low'));
    expect(binding.strength()).toBe('low');
    const first = new FakeBodyFollow();
    binding.bind(first);
    expect(first.strength).toBe('low');
    binding.setStrength('high');
    const second = new FakeBodyFollow(); // services が替わったとき
    binding.bind(second);
    expect(second.strength).toBe('high');
    expect(binding.bound()).toBe(second);

    expect(createBodyFollowBinding(memoryStrengthStorage('huge')).strength()).toBe('standard');
    expect(createBodyFollowBinding(memoryStrengthStorage(null)).strength()).toBe('standard');
  });

  it('同じものをつなぎ直しても強さを渡し直さない', () => {
    const binding = createBodyFollowBinding(memoryStrengthStorage());
    const body = new FakeBodyFollow();
    const setStrength = vi.spyOn(body, 'setStrength');
    binding.bind(body);
    binding.bind(body);
    expect(setStrength).toHaveBeenCalledTimes(1);
  });
});

// 手でフレームを出すトラッキング
function manualTracking(): TrackingSource & { emit(frame: Partial<TrackingFrame>): void } {
  const listeners = new Set<(frame: TrackingFrame) => void>();
  return {
    listDevices: async () => [{ id: 'cam', label: 'カメラ' }],
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

describe('スタジオの実行部での体の追従', () => {
  function setup(project: Project = step1Project()) {
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const tracking = manualTracking();
    const services: Services = {
      ...createFakeServices(),
      mixer: createParameterMixer(),
      tracking,
      trackingLayer: new FakeTrackingLayer(),
      bodyFollow: createBodyFollowProducer(), // カード44で入る本物
    };
    services.store.load(project);
    const binding = createBodyFollowBinding(memoryStrengthStorage());
    runtime.registerLayerProducer(binding.producer);
    binding.bind(services.bodyFollow);
    runtime.attach(services);
    return { runtime, tracking, services, binding };
  }

  it('トラッキングの顔の向きに合わせて BodyAngleX・BodyAngleZ が出る', async () => {
    const { runtime, tracking } = setup();
    expect(runtime.tick(0)!.params).toMatchObject({ BodyAngleX: 0, BodyAngleZ: 0 });
    await runtime.startTracking('cam');
    tracking.emit({ faceYaw: 20, faceRoll: -10, facePitch: 15 });
    const frame = runtime.tick(16)!;
    expect(frame.params.FaceAngleX).toBe(20);
    expect(frame.params.BodyAngleX).toBeCloseTo(6, 10);
    expect(frame.params.BodyAngleZ).toBeCloseTo(-3, 10);
    expect(frame.params.BodyAngleY).toBe(0); // 上下は追従しない
    tracking.emit({ faceYaw: -30, faceRoll: 30 });
    expect(runtime.tick(32)!.params).toMatchObject({ BodyAngleX: -9, BodyAngleZ: 9 });
  });

  it('強さを変えると率が変わる（控えめ 0.15・大きめ 0.45。範囲 ±10 に丸める）', async () => {
    const { runtime, tracking, binding } = setup();
    await runtime.startTracking('cam');
    tracking.emit({ faceYaw: 20, faceRoll: -10 });
    binding.setStrength('low');
    let params = runtime.tick(16)!.params;
    expect(params.BodyAngleX).toBeCloseTo(3, 10);
    expect(params.BodyAngleZ).toBeCloseTo(-1.5, 10);
    binding.setStrength('high');
    params = runtime.tick(32)!.params;
    expect(params.BodyAngleX).toBeCloseTo(9, 10);
    expect(params.BodyAngleZ).toBeCloseTo(-4.5, 10);
    tracking.emit({ faceYaw: 30, faceRoll: 0 });
    expect(runtime.tick(48)!.params.BodyAngleX).toBe(10);
  });

  it('プロジェクトに体のパラメータが無ければ何も足さない', async () => {
    const { runtime, tracking } = setup(createEmptyProject('MVP'));
    await runtime.startTracking('cam');
    tracking.emit({ faceYaw: 20, faceRoll: -10 });
    const params = runtime.tick(16)!.params;
    expect(params.FaceAngleX).toBe(20);
    expect('BodyAngleX' in params).toBe(false);
    expect('BodyAngleZ' in params).toBe(false);
  });
});
