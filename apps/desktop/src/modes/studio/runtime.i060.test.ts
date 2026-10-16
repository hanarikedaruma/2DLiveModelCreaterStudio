import { describe, expect, it } from 'vitest';
import { sampleProject } from '../modeling/canvas/testUtils';
import { ensureStandardParameters, type Animation, type Physics, type TransformDelta } from '@app/schema';
import { createAnimationPlayer, createBindingEvaluator, createDeformPipeline, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../services';
import { createStudioRuntime } from './runtime';

function setup() {
  const p = sampleProject();
  p.model = ensureStandardParameters(p.model, 'step2');
  const source = p.model.parts[0]!,
    part = {
      ...source,
      id: 'art',
      parentId: 'group',
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      pivot: { x: 50, y: 50 },
      assetId: p.assets[0]!.id,
      meshId: 'mesh',
      mask: null,
    };
  const group = { ...part, id: 'group', kind: 'group' as const, parentId: null, assetId: null, meshId: null };
  p.model.parts = [group, part];
  p.model.meshes = [
    {
      id: 'mesh',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      triangles: [
        [0, 1, 2],
        [1, 3, 2],
      ],
      density: 'custom',
      edited: false,
    },
  ];
  p.model.drawOrder = ['art'];
  p.model.bindings = [
    {
      id: 'turn',
      target: { type: 'part', id: 'group' },
      channel: 'transform',
      parameterIds: ['FaceAngleX'],
      keyValues: [[-30, 0, 30]],
      keys: [-30, 0, 30].map((v) => ({
        coords: [v],
        delta: { position: { x: 0, y: 0 }, rotation: v, scale: { x: 1, y: 1 }, opacity: 1 } satisfies TransformDelta,
        source: 'manual',
        locked: true,
      })),
      generation: 'linear',
      divisions: null,
    },
  ];
  const a: Animation = {
    id: 'a',
    name: 'test',
    duration: 2,
    speed: 1,
    loop: false,
    periodic: false,
    restart: 'restart',
    affectedGroups: [],
    tracks: [
      {
        parameterId: 'FaceAngleX',
        keyframes: [
          { time: 0, value: -10, curve: 'linear' },
          { time: 1, value: 0, curve: 'linear' },
        ],
      },
    ],
    transition: {
      preset: 'custom',
      blendIn: 0,
      blendOut: 0.4,
      curve: 'smooth',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
      startFromCurrent: true,
    },
  };
  p.animations = [a];
  p.physics = [];
  const services = {
    ...createFakeServices(),
    animations: createAnimationPlayer(),
    mixer: createParameterMixer(),
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
  };
  services.store.load(p);
  const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
  const detach = runtime.attach(services);
  runtime.setAutoBlink(false);
  runtime.registerLayerProducer(services.animations);
  return { p, a, services, runtime, detach };
}
describe('表示した姿勢からの実再生（I-060）', () => {
  it('表情とトラッキングを合成した実際の全頂点を開始フレームで保ち、記録した差を重ねる', () => {
    const s = setup();
    s.runtime.registerLayerProducer({
      id: 'tracking',
      produce: () => ({ id: 'tracking', weight: 1, values: { FaceAngleX: 12 } }),
    });
    s.runtime.registerLayerProducer({
      id: 'expression',
      produce: () => ({ id: 'expression', weight: 0.5, values: { FaceAngleX: 24 }, blend: { FaceAngleX: 'override' } }),
    });
    const before = s.runtime.tick(100)!,
      vertices = Array.from(before.model.byPartId.art!.positions),
      json = JSON.stringify(s.services.store.get());
    expect(before.params.FaceAngleX).toBe(18);
    s.services.animations.play('a', 100);
    const start = s.runtime.tick(100)!;
    expect(start.params.FaceAngleX).toBe(18);
    expect(Array.from(start.model.byPartId.art!.positions)).toEqual(vertices);
    expect(s.runtime.tick(600)!.params.FaceAngleX).toBe(23);
    expect(JSON.stringify(s.services.store.get())).toBe(json);
    s.detach();
  });
  it('停止するリップシンクと手動の物理値を、周期レイヤーと二重に加算しない', () => {
    const s = setup();
    s.a.transition.keepLipSync = false;
    s.a.tracks = [
      {
        parameterId: 'HairFront',
        keyframes: [
          { time: 0, value: 0.8, curve: 'linear' },
          { time: 1, value: 1, curve: 'linear' },
        ],
      },
    ];
    s.p.physics = [{ outputParameterId: 'HairFront' } as Physics];
    s.runtime.registerLayerProducer({
      id: 'tracking',
      produce: () => ({ id: 'tracking', weight: 1, values: { MouthOpen: 0.2 } }),
    });
    s.runtime.registerLayerProducer({
      id: 'lipSync',
      produce: (ctx) => ({ id: 'lipSync', weight: 0.5 * ctx.flags.lipSyncWeight, values: { MouthOpen: 0.6 } }),
    });
    s.runtime.registerLayerProducer({
      id: 'periodic',
      produce: () => ({ id: 'periodic', weight: 1, values: { HairFront: 0.05 }, blend: { HairFront: 'add' } }),
    });
    s.runtime.registerLayerProducer({
      id: 'physics',
      produce: (ctx) =>
        ctx.flags.manualPhysicsParameterIds?.includes('HairFront')
          ? null
          : { id: 'physics', weight: 1, values: { HairFront: 0.35 } },
    });
    const before = s.runtime.tick(100)!;
    expect(before.params.MouthOpen).toBeCloseTo(0.4);
    expect(before.params.HairFront).toBeCloseTo(0.35);
    s.services.animations.play('a', 100);
    const start = s.runtime.tick(100)!;
    expect(start.params.MouthOpen).toBeCloseTo(before.params.MouthOpen!);
    expect(start.params.HairFront).toBeCloseTo(before.params.HairFront!);
    expect(s.runtime.tick(600)!.params.HairFront).toBeCloseTo(0.45);
    s.detach();
  });
  it('読み込みや実行部の終了で、前の作品の姿勢を持ち越さない', () => {
    const s = setup();
    let value = 18;
    s.runtime.registerLayerProducer({
      id: 'tracking',
      produce: () => ({ id: 'tracking', weight: 1, values: { FaceAngleX: value } }),
    });
    s.runtime.tick(100);
    s.detach();
    value = 4;
    const detach = s.runtime.attach(s.services);
    s.services.animations.play('a', 200);
    expect(s.runtime.tick(200)!.params.FaceAngleX).toBe(4);
    detach();
  });
});
