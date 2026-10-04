import type { Vec2, Warp } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { delta, shift, testModel } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { pointsToAncestorSpace, pointsToModelSpace } from './space';
import { groupPart, imagePart, meshOf, pairs } from './testParts';
import { regularWarpPoints } from './warp';

function warpOn(id: string, partId: string, bounds: Warp['bounds'], columns: number, rows: number): Warp {
  return { id, partId, columns, rows, bounds, points: regularWarpPoints(bounds, columns, rows) };
}

function expectNear(actual: Vec2, expected: Vec2, digits = 3) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

// root（ワープ付き・回転）→ g（ワープ付き・拡縮）→ c（画像）
const vertices = [
  { x: 20, y: 30 },
  { x: 80, y: 30 },
  { x: 50, y: 90 },
  { x: 130, y: -10 },
];
const gWarp = warpOn('wg', 'g', { x: 0, y: 0, width: 100, height: 100 }, 2, 2);
const rootWarp = warpOn('wr', 'root', { x: -50, y: -50, width: 300, height: 300 }, 3, 3);
const model = testModel({
  parts: [
    groupPart('root', { pivot: { x: 100, y: 100 }, rotation: 20 }),
    groupPart('g', { parentId: 'root', pivot: { x: 50, y: 50 }, scale: { x: 1.2, y: 0.9 } }),
    imagePart('c', { parentId: 'g', meshId: 'm', pivot: { x: 40, y: 40 }, position: { x: 3, y: -2 } }),
  ],
  meshes: [meshOf('m', vertices)],
  warps: [gWarp, rootWarp],
  drawOrder: ['c'],
});

function bumps(n: number, k: number): Float32Array {
  return new Float32Array(Array.from({ length: n * 2 }, (_, i) => Math.sin(i * k) * 6));
}

const deltas: TargetDeltas = {
  transforms: { root: delta({ rot: 5, px: 4 }), g: delta({ sx: 1.1, py: 3 }), c: delta({ rot: -10 }) },
  vertices: { m: new Float32Array([1, 2, 0, 0, -1, 1, 0, 3]) },
  warpPoints: { wg: bumps(9, 0.7), wr: bumps(16, 1.3) },
};

describe('pointsToModelSpace', () => {
  it('画像パーツの頂点（基準 + 差分）は、変形パイプラインの最終頂点と同じ', () => {
    const expected = pairs(createDeformPipeline().deform(model, deltas).byPartId.c!.positions);
    const d = deltas.vertices.m!;
    const input = vertices.map((v, i) => ({ x: v.x + d[i * 2]!, y: v.y + d[i * 2 + 1]! }));
    const out = pointsToModelSpace(model, deltas, 'c', input);
    out.forEach((p, i) => expectNear(p, { x: expected[i]![0], y: expected[i]![1] }));
  });

  it('グループのワープの制御点は、格子の点にある子の頂点が動く先と同じ位置になる', () => {
    // 子の頂点を g の格子の点（規則的な位置）に置く。子の変形は無し
    const grid = regularWarpPoints(gWarp.bounds, 2, 2);
    const m = testModel({
      ...model,
      parts: [model.parts[0]!, model.parts[1]!, imagePart('c', { parentId: 'g', meshId: 'm' })],
      meshes: [meshOf('m', grid)],
    });
    const ds: TargetDeltas = {
      ...deltas,
      transforms: { root: deltas.transforms.root!, g: deltas.transforms.g! },
      vertices: {},
    };
    const expected = pairs(createDeformPipeline().deform(m, ds).byPartId.c!.positions);
    const wd = ds.warpPoints.wg!;
    const controls = gWarp.points.map((p, k) => ({ x: p.x + wd[k * 2]!, y: p.y + wd[k * 2 + 1]! }));
    const out = pointsToModelSpace(m, ds, 'g', controls);
    out.forEach((p, i) => expectNear(p, { x: expected[i]![0], y: expected[i]![1] }));
  });

  it('差分が無く祖先も変化なしなら、点はそのまま。入力の配列は書き換えない', () => {
    const plain = testModel({
      parts: [groupPart('root'), groupPart('g', { parentId: 'root' })],
      warps: [warpOn('w', 'root', { x: 0, y: 0, width: 10, height: 10 }, 2, 2)],
    });
    const input = [
      { x: 3, y: 4 },
      { x: -20, y: 50 },
    ];
    const out = pointsToModelSpace(plain, { transforms: {}, vertices: {}, warpPoints: {} }, 'g', input);
    out.forEach((p, i) => expectNear(p, input[i]!, 9));
    expect(out[0]).not.toBe(input[0]);
    expect(input[0]).toEqual({ x: 3, y: 4 });
  });

  it('自身のワープは掛けず、自身の変形から掛ける', () => {
    const m = testModel({
      parts: [groupPart('g', { position: { x: 10, y: 0 } })],
      warps: [warpOn('w', 'g', { x: 0, y: 0, width: 10, height: 10 }, 1, 1)],
    });
    const ds: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: { w: new Float32Array(8).fill(100) } };
    expectNear(pointsToModelSpace(m, ds, 'g', [{ x: 1, y: 1 }])[0]!, { x: 11, y: 1 });
  });

  it('無いパーツなら点をそのまま返し、親の参照の循環では止まる', () => {
    expect(pointsToModelSpace(model, deltas, 'none', [{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    const loop = testModel({
      parts: [
        groupPart('a', { parentId: 'b', position: { x: 1, y: 0 } }),
        groupPart('b', { parentId: 'a', position: { x: 0, y: 1 } }),
      ],
    });
    const out = pointsToModelSpace(loop, { transforms: {}, vertices: {}, warpPoints: {} }, 'a', [{ x: 0, y: 0 }]);
    expectNear(out[0]!, { x: 1, y: 1 });
  });
});

describe('pointsToAncestorSpace', () => {
  it('祖先のワープの入力の空間まで掛け、その祖先のワープと変形は掛けない', () => {
    const ds: TargetDeltas = { ...deltas, warpPoints: { wg: new Float32Array(18).fill(2), wr: bumps(16, 1.3) } };
    const p = { x: 30, y: 40 };
    // c → g の入力: c の変形だけ
    const toG = pointsToAncestorSpace(model, ds, 'c', 'g', [p])[0]!;
    const cOnly = pointsToModelSpace(testModel({ parts: [model.parts[2]!] }), ds, 'c', [p])[0]!;
    expectNear(toG, cOnly, 6);
    // c → root の入力: c の変形 → g のワープ（全体を (2,2)）→ g の変形
    const toRoot = pointsToAncestorSpace(model, ds, 'c', 'root', [p])[0]!;
    const gLocal = pointsToModelSpace(testModel({ parts: [groupPart('g', model.parts[1]!)] }), ds, 'g', [
      { x: cOnly.x + 2, y: cOnly.y + 2 },
    ])[0]!;
    expectNear(toRoot, gLocal, 4);
  });

  it('同じパーツなら点をそのまま、祖先でなければルートまで掛ける', () => {
    const p = [{ x: 5, y: 6 }];
    expect(pointsToAncestorSpace(model, deltas, 'g', 'g', p)).toEqual(p);
    const all = pointsToModelSpace(model, deltas, 'c', p);
    pointsToAncestorSpace(model, deltas, 'c', 'other', p).forEach((q, i) => expectNear(q, all[i]!, 9));
  });

  it('平行移動の差分は、ワープの入力の空間では変わらない（差分を使うのはワープより外側）', () => {
    const ds: TargetDeltas = {
      transforms: {},
      vertices: {},
      warpPoints: { wg: new Float32Array(shift(9, 9, 9).flatMap((v) => [v.x, v.y])) },
    };
    const out = pointsToAncestorSpace(model, ds, 'c', 'g', [{ x: 0, y: 0 }])[0]!;
    expectNear(out, { x: 3, y: -2 }, 6);
  });
});
