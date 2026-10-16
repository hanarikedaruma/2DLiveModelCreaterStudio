import { describe, expect, it } from 'vitest';
import { createBindingEvaluator, createDeformPipeline, pointsToModelSpace, warpPointsToModelSpace } from '@app/core';
import type { Binding } from '@app/schema';
import { part, projectWith } from '../../../services/keyEditor/testing';
import { addWarpCommand, createWarp, pickWarpPart, straightenWarpCommand, warpPartChoices } from './warpOps';
import { canvasToWarpLinear, displayControlPoints } from './warpTool';
import { rectMesh, testAsset } from './testProject';
import { applyLinear } from '../canvas/geometry';
import { createMeshTargetMapper } from '../mesh/meshDrag';

const none = { transforms: {}, vertices: {}, warpPoints: {} };
function project() {
  const p = projectWith({
    parts: [
      part('g', { kind: 'group', rotation: 8 }),
      part('p', { parentId: 'g', meshId: 'm', assetId: 'a' }),
      part('other', { meshId: 'other', assetId: 'a' }),
    ],
    meshes: [rectMesh('m', 0, 0, 100, 100), rectMesh('other', 200, 0, 100, 100)],
    drawOrder: ['p', 'other'],
  });
  return { ...p, assets: [testAsset('a', { x: 0, y: 0 }, 100, 100)] };
}
const near = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThan(0.001);

describe('パーツへ直接ワープと向き調整（I-078/I-079）', () => {
  it('グループを増やさずに画像へ追加し、恒等の見た目と別パーツを保つ', () => {
    const p = project(),
      next = addWarpCommand('p', 4, 4, 'w').apply(p),
      pipeline = createDeformPipeline();
    expect(next.model.parts).toBe(p.model.parts);
    expect(next.model.warps[0]!.partId).toBe('p');
    const before = pipeline.deform(p.model, none),
      after = pipeline.deform(next.model, none);
    for (const id of ['p', 'other'])
      before.byPartId[id]!.positions.forEach((v, i) => near(v, after.byPartId[id]!.positions[i]!));
    const w = next.model.warps[0]!,
      controls = warpPointsToModelSpace(next.model, none, 'p', w.points);
    near(controls[0]!.y, controls[4]!.y);
    near(controls[0]!.x, controls[20]!.x);
  });

  it('自身の格子→最も近い親の格子→押した画像の順で選び、対象の候補に画像も含む', () => {
    const p = project();
    expect(pickWarpPart(p.model, 'p')).toBe('p');
    const parent = addWarpCommand('g', 4, 4, 'wg').apply(p);
    expect(pickWarpPart(parent.model, 'p')).toBe('g');
    const own = addWarpCommand('p', 4, 4, 'wp').apply(parent);
    expect(pickWarpPart(own.model, 'p')).toBe('p');
    expect(warpPartChoices(own, 'g').map((c) => c.part.id)).toEqual(['g', 'p']);
    expect(warpPartChoices(own, 'p').map((c) => c.part.id)).toEqual(['g', 'p']);
  });

  it('画像自身の制御点は二重にワープせず、ドラッグの移動とメッシュの逆算が画面位置に一致する', () => {
    const p = addWarpCommand('p', 2, 2, 'w').apply(project()),
      w = p.model.warps[0]!;
    w.points[4]!.x += 15;
    w.points[4]!.y -= 7;
    const target = { part: p.model.parts[1]!, warp: w };
    const displayed = displayControlPoints(p.model, none, target),
      linear = canvasToWarpLinear(p.model, none, target, [4])[0]!;
    const d = applyLinear(linear, { x: 12, y: -8 }),
      moved = { ...w, points: w.points.map((p, i) => (i === 4 ? { x: p.x + d.x, y: p.y + d.y } : p)) };
    const after = displayControlPoints({ ...p.model, warps: [moved] }, none, { ...target, warp: moved });
    near(after[4]!.x - displayed[4]!.x, 12);
    near(after[4]!.y - displayed[4]!.y, -8);
    const mesh = p.model.meshes[0]!,
      mapper = createMeshTargetMapper(p.model, none, 'p', mesh, [0]);
    const before = pointsToModelSpace(p.model, none, 'p', [mesh.vertices[0]!])[0]!;
    const move = mapper([{ x: before.x + 5, y: before.y + 3 }]);
    expect(move).not.toBeNull();
    const local = mesh.vertices[0]!,
      dVertex = move![0]!.d;
    const actual = pointsToModelSpace(p.model, none, 'p', [{ x: local.x + dVertex.x, y: local.y + dVertex.y }])[0]!;
    near(actual.x, before.x + 5);
    near(actual.y, before.y + 3);
  });

  it('一次の形と全キーを保って向きだけ調整し、1コマンドで元に戻せる入力を残す', () => {
    const p = project();
    p.model.parts[0]!.rotation = 0;
    const w = createWarp(p, 'g', 2, 2, 'w')!;
    w.points = w.points.map((v) => ({ x: v.x + 12, y: v.y - 4 }));
    const b: Binding = {
      id: 'b',
      target: { type: 'warp', id: 'w' },
      channel: 'warpPoints',
      parameterIds: ['FaceAngleX'],
      keyValues: [[0, 30]],
      generation: 'linear',
      divisions: null,
      keys: [0, 30].map((v) => ({
        coords: [v],
        delta: w.points.map(() => ({ x: v / 3, y: v / 4 })),
        source: 'manual',
        locked: true,
      })),
    };
    p.model.warps = [w];
    p.model.bindings = [b];
    p.model.parts[0]!.rotation = 8;
    const result = straightenWarpCommand(p, 'w')!;
    expect(result.maxError).toBeLessThan(0.001);
    expect(result.command.apply(p).model.warps[0]!.angle).toBeCloseTo((-8 * Math.PI) / 180);
    expect(result.command.apply({ ...p })).toEqual(p);
    expect(p.model.warps[0]).toBe(w);
    const evaluator = createBindingEvaluator(),
      pipeline = createDeformPipeline(),
      next = result.command.apply(p);
    for (const v of [0, 15, 30])
      pipeline
        .deform(p.model, evaluator.evaluate(p.model, { FaceAngleX: v }))
        .byPartId.p!.positions.forEach((a, i) =>
          near(
            a,
            pipeline.deform(next.model, evaluator.evaluate(next.model, { FaceAngleX: v })).byPartId.p!.positions[i]!,
          ),
        );
  });
});
