import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { validateProject } from '@app/schema';
import { createBindingEvaluator, createDeformPipeline, createParameterMixer, createPhysicsEngine } from '@app/core';
import { createFakeServices } from '../../services';
import { createStudioRuntime, type StudioFrame } from './runtime';

describe('胸のスタジオと出力', () => {
  it('物理を1回だけ進め、2出力を含む同じ完成フレームを全sinkへ渡す', () => {
    const p = validateProject(
      JSON.parse(
        readFileSync(new NodeURL('../../../../../fixtures/chest-model/project.json', import.meta.url), 'utf8'),
      ),
    );
    const physics = createPhysicsEngine();
    const produce = vi.spyOn(physics, 'produce');
    const services = {
      ...createFakeServices(),
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      mixer: createParameterMixer(),
      physics,
    };
    services.store.load(p);
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } }),
      off = runtime.attach(services);
    runtime.registerLayerProducer({
      id: 'tracking',
      produce: (ctx) => ({
        id: 'tracking',
        values: { BodyAngleZ: 45, MoveX: ctx.now < 600 ? 16 * Math.sin(ctx.now / 180) : 0 },
        weight: 1,
      }),
    });
    const a: StudioFrame[] = [],
      b: StudioFrame[] = [];
    runtime.registerFrameSink((frame) => a.push(frame));
    runtime.registerFrameSink((frame) => b.push(frame));
    for (let i = 0; i < 120; i++) runtime.tick((i * 1000) / 60);
    expect(produce).toHaveBeenCalledTimes(120);
    expect(a).toHaveLength(120);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
      expect(a[i]!.params).toHaveProperty('BustX');
      expect(a[i]!.params).toHaveProperty('BustY');
    }
    expect(a[10]!.params.BustX).not.toBe(a[0]!.params.BustX);
    expect(a[0]!.params.BustY).toBeGreaterThan(0);
    // 同じIDの保存データを開き直しても、直前の揺れの速度を引き継がない。
    services.store.load(JSON.parse(JSON.stringify(p)));
    const reloaded = runtime.tick(2000)!;
    expect(reloaded.params.BustX).toBe(a[0]!.params.BustX);
    expect(reloaded.params.BustY).toBe(a[0]!.params.BustY);
    off();
    produce.mockRestore();
  });
});
