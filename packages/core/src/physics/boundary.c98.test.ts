import { describe, expect, it } from 'vitest';
import type { Mesh, Vec2 } from '@app/schema';
import { bounceReason, bounceWeights, withChestPhysics } from './bounce';
import { chestFixture } from './testChest.c98';
import { chestStaticParams } from './chestFrame';
import { setupChest } from '../setup/chest';
import { createAutoSetup } from '../setup/autoSetup';
import { createBindingEvaluator } from '../eval/evaluator';
import { createDeformPipeline } from '../deform/pipeline';
import { delta, transformBinding } from '../eval/testModel';
import { axisNeutralParams } from '../hairDynamics/frame';
import { curveMeshSignature } from '../deform/curveGuide';
import { evaluateShoulders } from '../hairDynamics/colliders';

function curved(): Mesh {
  // 両脇が内側へ曲がる実輪郭。中段の脇は外接矩形の内側にある。
  const vertices: Vec2[] = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 20, y: 50 },
    { x: 50, y: 50 },
    { x: 80, y: 50 },
    { x: 0, y: 100 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
  ];
  return {
    id: 'curved',
    vertices,
    uvs: vertices,
    triangles: [
      [0, 1, 3],
      [1, 4, 3],
      [1, 2, 4],
      [2, 5, 4],
      [3, 4, 6],
      [4, 7, 6],
      [4, 5, 7],
      [5, 8, 7],
    ],
    density: 'custom',
    edited: false,
  };
}
describe('胸の固定範囲と生成の保護', () => {
  it('曲がった脇を固定し、穴の下端も動かさない', () => {
    const m = curved(),
      w = bounceWeights(m);
    expect(w[3]).toBe(0);
    expect(w[5]).toBe(0);
    expect(w[4]).toBeGreaterThan(0);
    expect(w[7]).toBe(1);
    const vertices = Array.from({ length: 25 }, (_, i) => ({ x: (i % 5) * 25, y: Math.floor(i / 5) * 25 }));
    const triangles: Mesh['triangles'] = [];
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        if ((x === 1 || x === 2) && (y === 1 || y === 2)) continue;
        const a = y * 5 + x;
        triangles.push([a, a + 1, a + 5], [a + 1, a + 6, a + 5]);
      }
    const hole = bounceWeights({ ...m, vertices, triangles });
    for (const i of [6, 7, 8, 11, 13, 16, 17, 18]) expect(hole[i]).toBe(0);
    expect(hole[22]).toBeGreaterThan(0);
  });
  it('離れた島でもそれぞれ上端と脇を固定する', () => {
    const m = curved();
    const other = m.vertices.map((v) => ({ x: v.x + 300, y: v.y + 200 }));
    const weights = bounceWeights({
      ...m,
      vertices: [...m.vertices, ...other],
      triangles: [...m.triangles, ...m.triangles.map((t) => t.map((i) => i + 9) as [number, number, number])],
    });
    expect(weights.slice(0, 9)).toEqual(weights.slice(9));
  });
  it('同じ頂点数でもメッシュ編集で停止し、再生成するまで勝手に揺らさない', () => {
    const p = chestFixture();
    p.model.meshes[1] = {
      ...p.model.meshes[1]!,
      vertices: p.model.meshes[1]!.vertices.map((v, i) => (i === 4 ? { ...v, x: v.x + 1 } : v)),
    };
    expect(bounceReason(p, p.physics[0]!)).toMatch(/メッシュ/);
    expect(chestStaticParams(p, { BodyAngleZ: 45 })).toMatchObject({ BustX: 0, BustY: 0 });
    const next = withChestPhysics(p, 'chest', { physics: 'chest-physics', horizontal: 'nx', vertical: 'ny' });
    expect(bounceReason(next, next.physics[0]!)).toBeUndefined();
  });
  it('胴体自身の頂点キーは対応外の理由を出し、全体を変更せず中止する', () => {
    const p = chestFixture();
    p.model.bindings.push({ ...p.model.bindings[1]!, id: 'torso-key', target: { type: 'mesh', id: 'torso-mesh' } });
    const before = JSON.stringify(p);
    expect(() => withChestPhysics(p, 'chest', { physics: 'p', horizontal: 'x', vertical: 'y' })).toThrow(/胴体の頂点/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('手編集・lockedのキーがあれば再生成と方式変更を部分適用しない', () => {
    for (const manual of [false, true]) {
      const p = chestFixture();
      const key = p.model.bindings[1]!.keys[2]!;
      if (manual) key.source = 'manual';
      else key.locked = true;
      const before = JSON.stringify(p);
      expect(() => withChestPhysics(p, 'chest', { physics: 'p', horizontal: 'x', vertical: 'y' })).toThrow(/手で編集/);
      expect(JSON.stringify(p)).toBe(before);
    }
  });
  it('追加の胸には独立した2出力を作り、再セットアップは重複させない', () => {
    const p = chestFixture();
    const chest = p.model.parts[2]!;
    p.model.parts.push({ ...chest, id: 'other', meshId: 'other-mesh', physicsId: null });
    p.model.meshes.push({ ...p.model.meshes[1]!, id: 'other-mesh' });
    p.model.drawOrder.push('other');
    let n = 0;
    const next = setupChest(p, () => `id${++n}`);
    const outputs = next.physics.flatMap((p) => [p.outputParameterId, p.verticalOutputParameterId]);
    expect(new Set(outputs).size).toBe(4);
    expect(setupChest(next, () => `id${++n}`)).toBe(next);
  });
  it('かんたんセットアップの計画には作れない理由を表示する', () => {
    const p = chestFixture();
    p.physics = [];
    p.model.parts[2]!.meshId = null;
    p.model.parts[2]!.physicsId = null;
    expect(
      createAutoSetup()
        .plan(p)
        .warnings.some((w) => w.includes('胸') && w.includes('メッシュ')),
    ).toBe(true);
  });
  it('静止編集で重力を反映し、明示したBustキーやお試しを上書きしない', () => {
    const p = chestFixture(),
      values = { BodyAngleZ: 45, BustX: 0.7, BustY: -0.2 };
    expect(chestStaticParams(p, values, ['BustY'])).toEqual(values);
    expect(chestStaticParams(p, { BodyAngleZ: 45 }).BustY).toBeGreaterThan(0);
  });
  it('体の回転と呼吸中も固定点の差は0で、流れ揺れの中立評価に胸の2出力を残す', () => {
    const p = chestFixture();
    p.model.bindings.push(
      transformBinding(
        'breath',
        'torso',
        ['Breath'],
        [[0, 1]],
        [
          [[0], delta()],
          [[1], delta({ sx: 1.02, sy: 1.04, py: -3 })],
        ],
      ),
    );
    const evaluator = createBindingEvaluator(),
      pipeline = createDeformPipeline();
    p.model.shoulderColliders = [
      {
        id: 'shoulder',
        name: '服の線',
        partId: 'chest',
        meshId: 'chest-mesh',
        meshSignature: curveMeshSignature(p.model.meshes[1]!),
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 100 },
        ],
        radius: 2,
        enabled: true,
      },
    ];
    for (const angle of [-90, -45, 0, 45, 90])
      for (const breath of [0, 0.5, 1]) {
        const values = { BodyAngleZ: angle, Breath: breath, BustX: 0.7, BustY: -0.6 };
        expect(axisNeutralParams(p, 'chest', values)).toEqual(values);
        const base = pipeline.deform(p.model, evaluator.evaluate(p.model, { ...values, BustX: 0, BustY: 0 })).byPartId
          .chest!;
        const completed = pipeline.deform(p.model, evaluator.evaluate(p.model, values));
        const moved = completed.byPartId.chest!;
        for (const [i, weight] of p.physics[0]!.bounce!.weights.entries())
          if (weight === 0) {
            expect(moved.positions[i * 2]).toBe(base.positions[i * 2]);
            expect(moved.positions[i * 2 + 1]).toBe(base.positions[i * 2 + 1]);
          }
        expect(Array.from(moved.positions)).not.toEqual(Array.from(base.positions));
        const shoulder = evaluateShoulders(p, completed).active.get('shoulder')!;
        expect(shoulder.points[0]!.x).toBeCloseTo(moved.positions[8]!, 4);
        expect(shoulder.points[0]!.y).toBeCloseTo(moved.positions[9]!, 4);
        expect(shoulder.points[1]!.x).toBeCloseTo(moved.positions[14]!, 4);
        expect(shoulder.points[1]!.y).toBeCloseTo(moved.positions[15]!, 4);
      }
  });
});
