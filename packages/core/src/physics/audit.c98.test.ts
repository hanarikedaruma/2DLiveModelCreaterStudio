import { describe, expect, it } from 'vitest';
import { createBindingEvaluator } from '../eval/evaluator';
import { pointsBinding } from '../eval/testModel';
import { bounceFrame, bounceReason, chestDeformBindingIds, withChestPhysics } from './bounce';
import { chestEquilibrium } from './chestSession';
import { chestStaticParams } from './chestFrame';
import { createPhysicsEngine } from './engine';
import { chestFixture } from './testChest.c98';

describe('胸の追加監査：実際のメッシュの基底', () => {
  it.each(['part', 'model'] as const)('%s座標の胸の頂点キーによる伸びも重力の校正に反映する', (space) => {
    const p = chestFixture(),
      item = p.physics[0]!,
      mesh = p.model.meshes[1]!;
    const key = pointsBinding(
      'stretch',
      { type: 'mesh', id: mesh.id },
      ['BodyAngleY'],
      [[0, 10]],
      [
        [[0], mesh.vertices.map(() => ({ x: 0, y: 0 }))],
        [[10], mesh.vertices.map((v) => ({ x: 0, y: v.y }))],
      ],
    );
    key.vertexSpace = space;
    p.model.bindings.push(key);
    const owned = chestDeformBindingIds(p);
    const model = { ...p.model, bindings: p.model.bindings.filter((b) => !owned.has(b.id)) };
    const evaluator = createBindingEvaluator();
    for (const angle of [-45, 0, 45]) {
      const values = { BodyAngleY: 10, BodyAngleZ: angle };
      const frame = bounceFrame(p, item, evaluator.evaluate(model, values))!;
      const rad = (angle * Math.PI) / 180,
        sag = item.bounce!.gravityStrength * item.bounce!.amplitudes.y;
      const expected =
        space === 'part'
          ? { x: 2 * Math.sin(rad) * sag, y: (1 - 2 * Math.cos(rad)) * sag }
          : { x: Math.sin(rad) * sag, y: -Math.cos(rad) * sag };
      const equilibrium = chestEquilibrium(item.bounce!, frame.basis);
      expect(equilibrium.x).toBeCloseTo(expected.x, 5);
      expect(equilibrium.y).toBeCloseTo(expected.y, 5);
      const staticValues = chestStaticParams(p, values);
      const dynamicValues = createPhysicsEngine().produce({
        project: p,
        mixedSoFar: values,
        now: 0,
        dt: 0,
        flags: { lipSyncWeight: 1, physicsActive: true },
      })!.values;
      for (const actual of [staticValues, dynamicValues]) {
        expect(actual.BustX).toBeCloseTo(expected.x / item.bounce!.amplitudes.x, 5);
        expect(actual.BustY).toBeCloseTo(expected.y / item.bounce!.amplitudes.y, 5);
      }
    }
  });
  it('基準の頂点キーを変えたら保存した基底を勝手に更新せず、理由を出して再生成を待つ', () => {
    const p = chestFixture(),
      item = p.physics[0]!,
      mesh = p.model.meshes[1]!;
    const before = structuredClone(item.bounce!.referenceBasis);
    p.model.bindings.push(
      pointsBinding(
        'rest-shape',
        { type: 'mesh', id: mesh.id },
        ['BodyAngleY'],
        [[0, 10]],
        [
          [[0], mesh.vertices.map((v) => ({ x: 0, y: v.y }))],
          [[10], mesh.vertices.map((v) => ({ x: 0, y: v.y * 2 }))],
        ],
      ),
    );
    expect(bounceReason(p, item)).toMatch(/基準姿勢/);
    expect(item.bounce!.referenceBasis).toEqual(before);
    expect(chestStaticParams(p, {})).toMatchObject({ BustX: 0, BustY: 0 });
    const rebuilt = withChestPhysics(p, 'chest', { physics: item.id, horizontal: 'new-x', vertical: 'new-y' });
    expect(bounceReason(rebuilt, rebuilt.physics[0]!)).toBeUndefined();
    expect(rebuilt.physics[0]!.bounce!.referenceBasis[1].y).toBeCloseTo(2, 5);
    expect(chestStaticParams(rebuilt, {})).toMatchObject({ BustX: 0, BustY: 0 });
  });
});
