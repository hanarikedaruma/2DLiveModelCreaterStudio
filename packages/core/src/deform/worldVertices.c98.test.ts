import { describe, expect, it } from 'vitest';
import type { TargetDeltas } from '@app/contracts';
import { pointsBinding, shift, testModel } from '../eval/testModel';
import { createBindingEvaluator } from '../eval/evaluator';
import { regularWarpPoints } from './warp';
import { createDeformPipeline } from './pipeline';
import { imagePart, groupPart, rectMesh } from './testParts';

describe('胸のモデル座標の頂点差分', () => {
  it.each([0, -30, 30, -45, 45, -90, 90])('体が%s度でも下向きの差分を回さず、固定点は体に付く', (rotation) => {
    const model = testModel({
      parts: [groupPart('body', { rotation, scale: { x: 1.5, y: 0.7 } }), imagePart('chest', { parentId: 'body' })],
      meshes: [rectMesh('mesh-chest', 0, 0, 100, 100)],
      drawOrder: ['chest'],
    });
    const pipeline = createDeformPipeline();
    const deltas: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };
    const base = pipeline.deform(model, deltas).byPartId.chest!.positions;
    const field = new Float32Array([0, 0, 0, 0, 0, 12, 0, 0]);
    const next = pipeline.deform(model, { ...deltas, modelVertices: { 'mesh-chest': field } } as TargetDeltas).byPartId
      .chest!.positions;
    expect(next[4]! - base[4]!).toBeCloseTo(0, 4);
    expect(next[5]! - base[5]!).toBeCloseTo(12, 4);
    expect(Array.from(next.slice(0, 4))).toEqual(Array.from(base.slice(0, 4)));
    expect(Array.from(next.slice(6, 8))).toEqual(Array.from(base.slice(6, 8)));
  });
  it.each([1, -1])('partのキーと祖先ワープを先に適用し、反転%sでもmodelの差分は最後に1回足す', (mirror) => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const local = pointsBinding(
      'local',
      { type: 'mesh', id: 'mesh-chest' },
      ['MouthOpen'],
      [[0, 1]],
      [
        [[0], shift(4, 0, 0)],
        [[1], shift(4, 0, 3)],
      ],
    );
    const global = {
      ...local,
      id: 'global',
      vertexSpace: 'model' as const,
      keys: [
        { ...local.keys[0]!, delta: shift(4, 0, 0) },
        { ...local.keys[1]!, delta: shift(4, 0, 12) },
      ],
    };
    const model = testModel({
      parts: [
        groupPart('body', { rotation: 45, scale: { x: mirror * 1.5, y: 0.7 } }),
        imagePart('chest', { parentId: 'body' }),
      ],
      meshes: [rectMesh('mesh-chest', 0, 0, 100, 100)],
      drawOrder: ['chest'],
      bindings: [local, global],
      warps: [
        {
          id: 'warp',
          partId: 'body',
          bounds,
          columns: 1,
          rows: 1,
          points: regularWarpPoints(bounds, 1, 1).map((p) => ({ x: p.x + p.y * 0.2, y: p.y * 1.1 })),
        },
      ],
    });
    const ev = createBindingEvaluator(),
      pipeline = createDeformPipeline();
    const before = pipeline.deform(
      { ...model, bindings: [local] },
      ev.evaluate({ ...model, bindings: [local] }, { MouthOpen: 1 }),
    ).byPartId.chest!.positions;
    const deltas = ev.evaluate(model, { MouthOpen: 1 });
    expect(deltas.vertices['mesh-chest']![1]).toBe(3);
    expect(deltas.modelVertices!['mesh-chest']![1]).toBe(12);
    const after = pipeline.deform(model, deltas).byPartId.chest!.positions;
    for (let i = 0; i < 4; i++) {
      expect(after[i * 2]! - before[i * 2]!).toBeCloseTo(0, 4);
      expect(after[i * 2 + 1]! - before[i * 2 + 1]!).toBeCloseTo(12, 4);
    }
  });
});
