import { describe, expect, it } from 'vitest';
import { createEmptyProject, type CurveGuide, type Mesh, type Physics } from '@app/schema';
import type { BindingEvaluator, ParamValues } from '@app/contracts';
import { imagePart, groupPart } from '../deform/testParts';
import { curveMeshSignature } from '../deform/curveGuide';
import { createDeformPipeline } from '../deform/pipeline';
import { createHairFrameEvaluator } from './frame';
import { HairDynamicsSession } from './session';

function fixture(curled = false, width = 20) {
  const p = createEmptyProject('流れ揺れ');
  const vertices = Array.from({ length: 21 }, (_, r) =>
    [-width / 2, 0, width / 2].map((x) => ({ x, y: r * 10 })),
  ).flat();
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 20; r++)
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c;
      triangles.push([a, a + 1, a + 3], [a + 1, a + 4, a + 3]);
    }
  const mesh: Mesh = {
    id: 'm',
    vertices,
    triangles,
    uvs: vertices.map(() => ({ x: 0, y: 0 })),
    density: 'custom',
    edited: false,
  };
  const guide: CurveGuide = {
    id: 'g',
    partId: 'hair',
    meshId: 'm',
    meshSignature: curveMeshSignature(mesh),
    reference: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 200 },
    ],
    points: [
      { x: 0, y: 0 },
      { x: curled ? 25 : 0, y: 100 },
      { x: 0, y: 200 },
    ],
    radius: 200,
    rootFraction: 0.15,
    gravity: true,
    enabled: true,
  };
  p.model = {
    ...p.model,
    parts: [
      groupPart('head'),
      imagePart('hair', { parentId: 'head', meshId: 'm' }),
      imagePart('other', { meshId: 'm', position: { x: 400, y: 0 } }),
    ],
    meshes: [mesh],
    drawOrder: ['hair', 'other'],
    curveGuides: [guide],
  };
  p.model.parameters.push({ id: 'axis', name: '軸', groupId: 'sway', min: -1, max: 1, default: 0, standard: false });
  const evaluator: BindingEvaluator = {
    evaluate: (_model, params) => ({
      transforms: {
        head: { position: { x: params.x ?? 0, y: 0 }, rotation: params.head ?? 0, scale: { x: 1, y: 1 }, opacity: 1 },
        hair: { position: { x: 0, y: 0 }, rotation: (params.axis ?? 0) * 15, scale: { x: 1, y: 1 }, opacity: 1 },
      },
      vertices: {},
      warpPoints: {},
    }),
  };
  const pipeline = createDeformPipeline();
  const frames = createHairFrameEvaluator(evaluator, pipeline);
  return { p, guide, mesh, evaluator, pipeline, frames };
}
describe('流れ揺れの共通フレーム', () => {
  it.each([false, true])('OFFでは既存の頂点と一致する（カール=%s）', (curled) => {
    const { p, frames, pipeline, evaluator } = fixture(curled);
    for (let head = -30; head <= 30; head += 5) {
      const params = { head };
      expect(frames.evaluate(p, params)).toEqual(pipeline.deform(p.model, evaluator.evaluate(p.model, params)));
    }
  });
  it.each([20, 60])('重力補正は頭の傾きを抑え、軸の意図した回転を残す（幅=%s）', (width) => {
    const { p, guide, frames } = fixture(false, width);
    const neutral = frames.evaluate(p, { head: 30 }).curveGuides!.g!.curve;
    p.physics = [{ partId: 'hair', outputParameterId: 'axis' } as Physics];
    const both = frames.evaluate(p, { head: 30, axis: 0.8 });
    const angle = (12 * Math.PI) / 180;
    const line = both.curveGuides!.g!.curve;
    line.forEach((at, i) => {
      expect(at.x).toBeCloseTo(neutral[i]!.x * Math.cos(angle) - neutral[i]!.y * Math.sin(angle), 3);
      expect(at.y).toBeCloseTo(neutral[i]!.x * Math.sin(angle) + neutral[i]!.y * Math.cos(angle), 3);
    });
    expect(both.curveGuides!.g!.strength).toBe(1);
    expect(guide.dynamics).toBeUndefined();
  });
  it('選んだ線だけが動き、再描画/別出力で同一フレームを二重更新しない。停止/失効で理由を返す', () => {
    const { p, guide, frames } = fixture();
    guide.dynamics = { enabled: true, preset: 'normal', strength: 0.5, damping: 0.2 };
    const session = new HairDynamicsSession();
    const before = JSON.stringify(p);
    const evaluate = (params: ParamValues, i: number, active = true) =>
      frames.evaluate(p, params, { now: (i * 1000) / 60, dt: i ? 1000 / 60 : 0, frameId: i, active }, session);
    evaluate({}, 0);
    const moving = evaluate({ x: 5 }, 1);
    const repeated = evaluate({ x: 5 }, 1);
    expect(repeated.byPartId.hair!.positions).toEqual(moving.byPartId.hair!.positions);
    expect(moving.byPartId.other!.positions[0]).toBe(390);
    expect(moving.curveGuides!.g!.curve.at(-1)!.x).toBeLessThan(5);
    expect(evaluate({ x: 5 }, 2, false).curveGuides!.g!.dynamics!.status).toBe('frozen');
    expect(JSON.stringify(p)).toBe(before);
    guide.gravity = false;
    expect(evaluate({}, 3).curveGuides!.g!.dynamics!.reason).toMatch(/重力/);
    guide.gravity = true;
    guide.meshSignature = 'stale';
    expect(evaluate({}, 4).curveGuides!.g!.dynamics!.reason).toMatch(/描き直/);
  });
  it('曲がりを制限しても新しい三角形の反転を作らず、左右反転された親でも有限値を保つ', () => {
    const { p, guide, frames, mesh } = fixture(true, 60);
    guide.dynamics = { enabled: true, preset: 'soft', strength: 1, damping: 0.1 };
    p.model.parts[0]!.scale.x = -1;
    const session = new HairDynamicsSession();
    for (let i = 0; i < 100; i++) {
      const out = frames.evaluate(
        p,
        { x: 30 * Math.sin(i / 15), head: 20 * Math.sin(i / 10) },
        { now: (i * 1000) / 60, dt: 1000 / 60, frameId: i, active: true },
        session,
      );
      const v = out.byPartId.hair!.positions;
      expect(v.every(Number.isFinite)).toBe(true);
      for (const [a, b, c] of mesh.triangles) {
        const area =
          (v[b * 2]! - v[a * 2]!) * (v[c * 2 + 1]! - v[a * 2 + 1]!) -
          (v[b * 2 + 1]! - v[a * 2 + 1]!) * (v[c * 2]! - v[a * 2]!);
        expect(area).toBeLessThan(0);
      }
    }
  });
});
