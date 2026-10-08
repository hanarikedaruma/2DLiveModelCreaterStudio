import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { validateProject } from '@app/schema';
import {
  createAnimationPlayer,
  createBindingEvaluator,
  createDeformPipeline,
  createParameterMixer,
  createPhysicsEngine,
} from '@app/core';
import { createFakeServices } from '../../services';
import { createStudioRuntime } from './runtime';
import { copyParts } from '../modeling/structure/commands';

describe('胸の追加監査：本物のアニメーションとスタジオ', () => {
  it.each(['key', 'empty', 'outside'] as const)('胸の%sトラックを実行時の物理と区別する', (kind) => {
    let p = validateProject(
      JSON.parse(
        readFileSync(new NodeURL('../../../../../fixtures/chest-model/project.json', import.meta.url), 'utf8'),
      ),
    );
    let id = 0;
    p = copyParts(['chest'], { newId: () => `audit-${++id}` }).apply(p);
    const other = p.physics[1]!;
    const animation = p.animations[0]!;
    animation.transition = { ...animation.transition, blendIn: 0, blendOut: 0, keepPhysics: true };
    animation.affectedGroups = kind === 'outside' ? ['body'] : ['body', 'sway'];
    animation.tracks = [
      { parameterId: 'BodyAngleZ', keyframes: [{ time: 0, value: 45, curve: 'linear' }] },
      { parameterId: 'BustY', keyframes: kind === 'empty' ? [] : [{ time: 0, value: -0.7, curve: 'linear' }] },
    ];
    const animations = createAnimationPlayer();
    const services = {
      ...createFakeServices(),
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      mixer: createParameterMixer(),
      physics: createPhysicsEngine(),
      animations,
    };
    services.store.load(p);
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const off = runtime.attach(services);
    runtime.registerLayerProducer({
      id: 'tracking',
      produce: () => ({ id: 'tracking', weight: 1, values: { BodyAngleZ: 45 } }),
    });
    runtime.registerLayerProducer(animations);
    animations.play(animation.id, 0);
    const frame = runtime.tick(0)!;
    expect(frame.params.BodyAngleZ).toBe(45);
    // 一方の胸の手動トラックはもう一方の独立した物理を止めない。
    expect(frame.params[other.verticalOutputParameterId!]).toBeGreaterThan(0.05);
    if (kind === 'key') {
      expect(frame.params.BustY).toBe(-0.7);
      expect(frame.params.BustX).toBe(0);
      expect(frame.layers.find((l) => l.id === 'physics')!.values).not.toHaveProperty('BustY');
      animations.stopAll(10);
      expect(runtime.tick(10)!.params.BustY).toBeGreaterThan(0.05);
    } else expect(frame.params.BustY).toBeGreaterThan(0.05);
    off();
  });
});
