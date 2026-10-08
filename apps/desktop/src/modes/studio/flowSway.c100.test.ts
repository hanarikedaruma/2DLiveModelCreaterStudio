import { describe, expect, it } from 'vitest';
import {
  HairDynamicsSession,
  createBindingEvaluator,
  createDeformPipeline,
  createHairFrameEvaluator,
  createParameterMixer,
  createPhysicsEngine,
  curveMeshSignature,
} from '@app/core';
import type { CurveGuide } from '@app/schema';
import { createFakeServices } from '../../services';
import { hairProject } from '../modeling/curveGuide/testing';
import { enablePhysicsCommand } from '../modeling/physics/commands';
import { createStudioRuntime, type StudioFrame } from './runtime';

describe('スタジオの流れ揺れ', () => {
  it('物理を一度進めて共通の完成フレームを全sinkへ渡し、物理停止と再開を保護する', () => {
    const base = hairProject();
    const points: CurveGuide['points'] = [
      { x: 300, y: 200 },
      { x: 300, y: 300 },
      { x: 300, y: 400 },
    ];
    base.model.curveGuides = [
      {
        id: 'g',
        partId: 'hair',
        meshId: 'm',
        meshSignature: curveMeshSignature(base.model.meshes[0]!),
        reference: points,
        points,
        radius: 70,
        rootFraction: 0.15,
        enabled: true,
        gravity: true,
        dynamics: { enabled: true, preset: 'normal', strength: 0.5, damping: 0.2 },
      },
    ];
    const project = enablePhysicsCommand('hair', { physics: 'ph', transform: 't', vertices: 'v' }).apply(base);
    const services = {
      ...createFakeServices(),
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      mixer: createParameterMixer(),
      physics: createPhysicsEngine(),
    };
    services.store.load(project);
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const off = runtime.attach(services);
    let active = true;
    runtime.registerLayerProducer({
      id: 'tracking',
      produce: (ctx) => ({
        id: 'tracking',
        values: { FaceAngleZ: ctx.now < 1000 ? 20 * Math.sin(ctx.now / 250) : 0 },
        weight: 1,
      }),
    });
    runtime.registerLayerProducer({
      id: 'periodic',
      produce: (ctx) => {
        ctx.flags.physicsActive = active;
        return null;
      },
    });
    const a: StudioFrame[] = [],
      b: StudioFrame[] = [];
    runtime.registerFrameSink((f) => a.push(f));
    runtime.registerFrameSink((f) => b.push(f));
    const evaluator = createHairFrameEvaluator(services.evaluator, services.pipeline);
    const session = new HairDynamicsSession();
    const original = JSON.stringify(project);
    for (let i = 0; i < 120; i++) {
      const frame = runtime.tick((i * 1000) / 60)!;
      const reference = evaluator.evaluate(
        project,
        frame.params,
        { now: frame.now, dt: i ? 1000 / 60 : 0, frameId: i, active: true },
        session,
      );
      expect(frame.model.byPartId.hair!.positions).toEqual(reference.byPartId.hair!.positions);
      expect(a[i]).toBe(b[i]);
    }
    expect(a.some((f) => f.model.curveGuides!.g!.dynamics!.status === 'running')).toBe(true);
    active = false;
    const frozen = runtime.tick(2000)!;
    expect(frozen.model.curveGuides!.g!.dynamics!.status).toBe('frozen');
    active = true;
    expect(runtime.tick(4000)!.model.byPartId.hair!.positions.every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(services.store.get())).toBe(original);
    off();
  });
});
