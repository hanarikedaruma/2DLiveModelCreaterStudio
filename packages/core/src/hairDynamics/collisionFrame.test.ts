import { describe, expect, it } from 'vitest';
import { createEmptyProject, type CurveGuide, type Mesh, type ShoulderCollider } from '@app/schema';
import type { BindingEvaluator } from '@app/contracts';
import { imagePart } from '../deform/testParts';
import { curveMeshSignature } from '../deform/curveGuide';
import { createDeformPipeline } from '../deform/pipeline';
import { createHairFrameEvaluator } from './frame';
import { evaluateShoulders, meshContactsFit } from './colliders';
import { HairDynamicsSession } from './session';

function fixture(x = 44, width = 6) {
  const p = createEmptyProject('肩');
  const vertices = Array.from({ length: 21 }, (_, r) =>
    [-width / 2, 0, width / 2].map((dx) => ({ x: x + dx, y: r * 10 })),
  ).flat();
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 20; r++)
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c;
      triangles.push([a, a + 1, a + 3], [a + 1, a + 4, a + 3]);
    }
  const hair: Mesh = {
    id: 'hairMesh',
    vertices,
    triangles,
    uvs: vertices.map(() => ({ x: 0, y: 0 })),
    density: 'custom',
    edited: false,
  };
  const body: Mesh = {
    id: 'bodyMesh',
    vertices: [
      { x: -60, y: 0 },
      { x: 60, y: 0 },
      { x: -60, y: 200 },
      { x: 60, y: 200 },
    ],
    triangles: [
      [0, 1, 2],
      [1, 3, 2],
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    density: 'custom',
    edited: false,
  };
  const points: CurveGuide['points'] = [
    { x, y: 0 },
    { x, y: 100 },
    { x, y: 200 },
  ];
  const guide: CurveGuide = {
    id: 'g',
    partId: 'hair',
    meshId: hair.id,
    meshSignature: curveMeshSignature(hair),
    reference: points,
    points,
    radius: 200,
    rootFraction: 0.15,
    enabled: true,
    gravity: true,
    collision: { enabled: true, colliderIds: ['s'], thickness: 1 },
  };
  const collider: ShoulderCollider = {
    id: 's',
    name: '肩',
    partId: 'body',
    meshId: body.id,
    meshSignature: curveMeshSignature(body),
    points: [
      { x: -40, y: 100 },
      { x: 40, y: 100 },
    ],
    radius: 2,
    enabled: true,
  };
  p.model = {
    ...p.model,
    parts: [imagePart('hair', { meshId: hair.id }), imagePart('body', { meshId: body.id })],
    meshes: [hair, body],
    drawOrder: ['body', 'hair'],
    curveGuides: [guide],
    shoulderColliders: [collider],
  };
  const evaluator: BindingEvaluator = {
    evaluate: (_m, params) => ({
      transforms: {
        body: {
          position: { x: params.x ?? 0, y: params.y ?? 0 },
          rotation: 0,
          scale: { x: params.scale ?? 1, y: 1 },
          opacity: 1,
        },
      },
      vertices: {},
      warpPoints: {},
    }),
  };
  const pipeline = createDeformPipeline(),
    frames = createHairFrameEvaluator(evaluator, pipeline);
  return { p, guide, collider, hair, body, evaluator, pipeline, frames };
}
describe('肩を含む共通フレーム', () => {
  it.each([2, 4])('%s本の揺れと肩接触を同じフレームで有限に評価する', (count) => {
    const { p, guide, frames } = fixture(46);
    guide.dynamics = { enabled: true, preset: 'normal', strength: 0.5, damping: 0.2 };
    for (let n = 1; n < count; n++) {
      p.model.parts.push({ ...p.model.parts[0]!, id: `hair${n}` });
      p.model.drawOrder.push(`hair${n}`);
      p.model.curveGuides!.push({ ...guide, id: `g${n}`, partId: `hair${n}` });
    }
    const session = new HairDynamicsSession(),
      samples: number[] = [];
    const saved = JSON.stringify(p);
    for (let i = 0; i < 240; i++) {
      const start = performance.now();
      const out = frames.evaluate(
        p,
        { x: 2 * Math.sin(i / 25) },
        { now: (i * 1000) / 60, dt: 1000 / 60, frameId: i, active: true },
        session,
      );
      if (i >= 40) samples.push(performance.now() - start);
      expect(Object.keys(out.curveGuides!)).toHaveLength(count);
      expect(out.items.every((item) => item.positions.every(Number.isFinite))).toBe(true);
    }
    expect(JSON.stringify(p)).toBe(saved);
    if (process.env.C100_PERF) {
      samples.sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          guides: count,
          shoulders: 1,
          frames: samples.length,
          meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
          p95Ms: samples[Math.floor(samples.length * 0.95)],
        }),
      );
    }
  });
  it('揺れOFFでも接触を解く。衝突OFFにすると設定を残して元の形へ戻る', () => {
    const { p, guide, hair, frames } = fixture();
    const before = JSON.stringify(p);
    const out = frames.evaluate(p, {});
    expect(['ok', 'limited']).toContain(out.curveGuides!.g!.collision!.status);
    expect(out.byPartId.hair!.positions).not.toEqual(new Float32Array(hair.vertices.flatMap((p) => [p.x, p.y])));
    expect(JSON.stringify(p)).toBe(before);
    guide.collision!.enabled = false;
    expect(frames.evaluate(p, {}).byPartId.hair!.positions).toEqual(
      new Float32Array(hair.vertices.flatMap((p) => [p.x, p.y])),
    );
    expect(guide.collision!.colliderIds).toEqual(['s']);
    expect(guide.dynamics).toBeUndefined();
  });
  it('肩は通常の体の変形へ追従し、拡縮で帯も広がる。非表示の祖先では外し、透明度0では残す', () => {
    const { p, collider, evaluator, pipeline } = fixture();
    const raw = () =>
      pipeline.deform({ ...p.model, curveGuides: [] }, evaluator.evaluate(p.model, { x: 10, y: 5, scale: 2 }));
    const shoulder = evaluateShoulders(p, raw()).active.get('s')!;
    expect(shoulder.points[0]!.x).toBeCloseTo(-70);
    expect(shoulder.points[0]!.y).toBeCloseTo(105);
    expect(shoulder.points[1]!.x).toBeCloseTo(90);
    expect(shoulder.points[1]!.y).toBeCloseTo(105);
    expect(shoulder.radius).toBe(4);
    p.model.parts[1]!.opacity = 0;
    expect(evaluateShoulders(p, raw()).active.has('s')).toBe(true);
    p.model.parts[1]!.visible = false;
    expect(evaluateShoulders(p, raw()).active.has('s')).toBe(false);
    p.model.parts[1]!.visible = true;
    collider.meshSignature = 'stale';
    expect(evaluateShoulders(p, raw()).diagnostics.get('s')).toMatch(/描き直/);
  });
  it.each([0, 44])('太い毛束の最終三角形も接触なしと検査してから成功を返す（x=%s）', (x) => {
    const { p, frames, hair } = fixture(x, 10);
    const out = frames.evaluate(p, {});
    expect(['ok', 'limited']).toContain(out.curveGuides!.g!.collision!.status);
    expect(
      meshContactsFit(out.byPartId.hair!.positions, hair.triangles, {
        radius: 0,
        colliders: [
          {
            id: 's',
            radius: 2,
            points: [
              { x: -40, y: 100 },
              { x: 40, y: 100 },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
  it('影響幅が毛束を覆わない配置は未解決と説明し、片側の肩の失効は個別に診断する', () => {
    const { p, guide, frames, collider } = fixture();
    guide.radius = 3;
    expect(frames.evaluate(p, {}).curveGuides!.g!.collision!.reason).toMatch(/影響幅/);
    collider.meshSignature = 'old';
    const result = frames.evaluate(p, {}).curveGuides!.g!;
    expect(result.collision!.diagnostics![0]!.colliderId).toBe('s');
    expect(result.collision!.diagnostics![0]!.reason).toMatch(/描き直/);
  });
  it('動く肩で慣性のフレームを進めても有限な完成形を共有し、重力OFFで接触だけを停止する', () => {
    const { p, guide, frames } = fixture(46);
    guide.dynamics = { enabled: true, preset: 'normal', strength: 0.5, damping: 0.2 };
    const session = new HairDynamicsSession();
    for (let i = 0; i < 30; i++) {
      const params = { x: 3 * Math.sin(i / 20) };
      const context = { now: (i * 1000) / 60, dt: 1000 / 60, frameId: i, active: true };
      const out = frames.evaluate(p, params, context, session);
      expect(out.byPartId.hair!.positions.every(Number.isFinite)).toBe(true);
      expect(frames.evaluate(p, params, context, session).byPartId.hair!.positions).toEqual(
        out.byPartId.hair!.positions,
      );
      expect(out.curveGuides!.g!.collision!.status).not.toBe('unresolved');
    }
    guide.gravity = false;
    expect(frames.evaluate(p, {}).curveGuides!.g!.collision!.status).toBe('disabled');
    expect(guide.collision!.enabled).toBe(true);
  });
});
