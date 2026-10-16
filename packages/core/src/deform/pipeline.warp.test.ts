import type { Warp } from '@app/schema';
import { describe, expect, it, vi } from 'vitest';
import { testModel } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { groupPart, imagePart, meshOf } from './testParts';

// 呼ばれた順と点を確かめるため、ワープを x を 1000 動かすものに差し替える（ワープの計算そのものは warp.test.ts）
const calls = vi.hoisted(() => [] as { warpId: string; points: number[]; delta: number[] | undefined }[]);
vi.mock('./warp', () => ({
  applyWarp: (points: Float32Array, warp: Warp, delta: Float32Array | undefined) => {
    calls.push({ warpId: warp.id, points: [...points], delta: delta ? [...delta] : undefined });
    for (let k = 0; k < points.length; k += 2) points[k] = points[k]! + 1000;
  },
}));

function warpOn(id: string, partId: string): Warp {
  return {
    id,
    partId,
    columns: 1,
    rows: 1,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ],
  };
}

describe('createDeformPipeline: ワープを呼ぶ順', () => {
  it('画像自身のワープ → 自身の変形 → 親のワープ → 親の変形 → 祖父のワープ → 祖父の変形', () => {
    calls.length = 0;
    const parts = [
      groupPart('grand', { rotation: 90 }),
      groupPart('parent', { parentId: 'grand', position: { x: 0, y: 5 } }),
      imagePart('child', { parentId: 'parent', meshId: 'm', rotation: 90 }),
    ];
    const model = testModel({
      parts,
      meshes: [meshOf('m', [{ x: 1, y: 0 }])],
      warps: [warpOn('wGrand', 'grand'), warpOn('wParent', 'parent'), warpOn('wChild', 'child')],
      drawOrder: ['child'],
    });
    const parentDelta = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = createDeformPipeline().deform(model, {
      transforms: {},
      vertices: {},
      warpPoints: { wParent: parentDelta },
    });

    expect(calls.map((c) => c.warpId)).toEqual(['wChild', 'wParent', 'wGrand']);
    expect(calls[0]!.points).toEqual([1, 0]);
    // (1,0) → 自身の 90度で (0,1) → 親のワープ
    expect(calls[1]!.points[0]).toBeCloseTo(0, 5);
    expect(calls[1]!.points[1]).toBeCloseTo(1001, 5);
    expect(calls[1]!.delta).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // ワープで (1000,1) → 親の +(0,5) で (1000,6) → 祖父のワープ（差分なし）
    expect(calls[2]!.points[0]).toBeCloseTo(1000, 4);
    expect(calls[2]!.points[1]).toBeCloseTo(1006, 4);
    expect(calls[2]!.delta).toBeUndefined();
    // ワープで (2000,6) → 祖父の 90度で (−6,2000)
    const [x, y] = out.byPartId.child!.positions;
    expect(x).toBeCloseTo(-1006, 3);
    expect(y).toBeCloseTo(2000, 3);
  });
});
