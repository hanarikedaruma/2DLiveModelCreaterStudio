import { describe, expect, it } from 'vitest';
import { createEmptyProject, type CurveGuide, type Mesh, type Model } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { imagePart, groupPart } from './testParts';
import { createDeformPipeline } from './pipeline';
import { curveMeshSignature } from './curveGuide';

const empty: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };

function fixture() {
  const vertices = Array.from({ length: 21 }, (_, r) => [-10, 0, 10].map((x) => ({ x, y: r * 10 }))).flat();
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 20; r++)
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c;
      triangles.push([a, a + 1, a + 3], [a + 1, a + 4, a + 3]);
    }
  const mesh: Mesh = {
    id: 'hair-mesh',
    vertices,
    triangles,
    uvs: vertices.map((p) => ({ x: (p.x + 10) / 20, y: p.y / 200 })),
    density: 'custom',
    edited: false,
  };
  const guide: CurveGuide = {
    id: 'guide',
    partId: 'hair',
    meshId: mesh.id,
    meshSignature: curveMeshSignature(mesh),
    reference: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 200 },
    ],
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 200 },
    ],
    radius: 40,
    rootFraction: 0.15,
    gravity: true,
    enabled: true,
  };
  const model: Model = {
    ...createEmptyProject('髪').model,
    parts: [groupPart('head'), imagePart('hair', { parentId: 'head', meshId: mesh.id })],
    meshes: [mesh],
    drawOrder: ['hair'],
    curveGuides: [guide],
  };
  return { model, mesh, guide };
}

describe('カード99: 流れ線と重力の変形', () => {
  it('正面の同じ線は恒等で、根元と基準の長さを保つ', () => {
    const { model, mesh } = fixture();
    const out = createDeformPipeline().deform(model, empty);
    expect([...out.byPartId.hair!.positions]).toEqual(mesh.vertices.flatMap((p) => [p.x, p.y]));
    expect(out.curveGuides?.guide?.status).toBe('ok');
  });

  it('キー間の全角度で、根元は頭に追従し、毛先側は下向きになる', () => {
    const { model } = fixture();
    const pipeline = createDeformPipeline();
    for (let rotation = -30; rotation <= 30; rotation++) {
      const deltas: TargetDeltas = {
        ...empty,
        transforms: { head: { position: { x: 40, y: 20 }, rotation, scale: { x: 1, y: 1 }, opacity: 1 } },
      };
      const out = pipeline.deform(model, deltas);
      const g = out.curveGuides!.guide!;
      expect(g.status).toBe('ok');
      expect(g.handles[0]!.x).toBeCloseTo(40, 4);
      expect(g.handles[0]!.y).toBeCloseTo(20, 4);
      const end = g.curve.at(-1)!;
      const prev = g.curve.at(-2)!;
      expect(Math.abs((Math.atan2(end.x - prev.x, end.y - prev.y) * 180) / Math.PI)).toBeLessThan(5);
      const length = g.curve
        .slice(1)
        .reduce((sum, p, i) => sum + Math.hypot(p.x - g.curve[i]!.x, p.y - g.curve[i]!.y), 0);
      expect(length).toBeCloseTo(200, 3);
      const v = out.byPartId.hair!.positions;
      for (let row = 0; row <= 20; row++) {
        const a = row * 6;
        expect(Math.hypot(v[a + 4]! - v[a]!, v[a + 5]! - v[a + 1]!)).toBeCloseTo(20, 3);
      }
    }
  });

  it('一本の線の中間を編集し、根元は保ち、別パーツを変更しない', () => {
    const { model, guide } = fixture();
    guide.gravity = false;
    guide.points[1] = { x: 25, y: 100 };
    model.parts.push(imagePart('other', { meshId: 'hair-mesh', position: { x: 300, y: 0 } }));
    model.drawOrder.push('other');
    const out = createDeformPipeline().deform(model, empty);
    expect(out.curveGuides!.guide!.handles[1]!.x).toBeCloseTo(25, 3);
    expect(out.byPartId.hair!.positions[0]).toBe(-10);
    expect(out.byPartId.other!.positions[0]).toBe(290);
  });

  it('対応の失効を表示し、変更したメッシュへ古い線を適用しない', () => {
    const { model, mesh } = fixture();
    model.meshes = [{ ...mesh, vertices: mesh.vertices.map((p) => ({ x: p.x + 2, y: p.y })) }];
    const out = createDeformPipeline().deform(model, empty);
    expect(out.curveGuides!.guide!.status).toBe('stale');
    expect(out.byPartId.hair!.positions[0]).toBe(-8);
  });
  it('影響幅の外と近くの別の島を動かさない', () => {
    const { model, mesh, guide } = fixture();
    const n = mesh.vertices.length;
    const next: Mesh = {
      ...mesh,
      vertices: [...mesh.vertices, { x: 1, y: 100 }, { x: 2, y: 100 }, { x: 1, y: 110 }],
      triangles: [...mesh.triangles, [n, n + 1, n + 2]],
    };
    model.meshes = [next];
    guide.meshSignature = curveMeshSignature(next);
    guide.gravity = false;
    guide.radius = 5;
    guide.points[1] = { x: 5, y: 100 };
    const positions = createDeformPipeline().deform(model, empty).byPartId.hair!.positions;
    for (let i = 0; i < next.vertices.length; i++)
      if (i >= n || next.vertices[i]!.x !== 0) {
        expect(positions[i * 2]).toBe(next.vertices[i]!.x);
        expect(positions[i * 2 + 1]).toBe(next.vertices[i]!.y);
      }
    expect(positions[31 * 2]).not.toBe(0);
  });
  it('既存の頂点キーを保ち、親ワープ・反転・非等方スケールの後に適用する', () => {
    const { model, mesh, guide } = fixture();
    guide.gravity = false;
    model.parts[0]!.scale = { x: -1.2, y: 0.8 };
    model.warps = [
      {
        id: 'w',
        partId: 'head',
        columns: 1,
        rows: 1,
        bounds: { x: -10, y: 0, width: 20, height: 200 },
        points: [
          { x: -10, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 200 },
          { x: 30, y: 200 },
        ],
      },
    ];
    const deltas = {
      ...empty,
      vertices: { [mesh.id]: new Float32Array(mesh.vertices.flatMap((p) => [Math.sin((p.y / 200) * Math.PI) * 5, 0])) },
    };
    const pipeline = createDeformPipeline();
    const original = pipeline.deform({ ...model, curveGuides: [] }, deltas).byPartId.hair!.positions;
    expect([...pipeline.deform(model, deltas).byPartId.hair!.positions]).toEqual([...original]);
    guide.points = [
      { x: 0, y: 0 },
      { x: 10, y: 100 },
      { x: 0, y: 200 },
    ];
    const out = pipeline.deform(model, deltas);
    expect(out.curveGuides!.guide!.status).toBe('ok');
    expect(out.byPartId.hair!.positions[62]).not.toBe(original[62]);
    expect(out.byPartId.hair!.positions[0]).toBe(original[0]);
    expect([...deltas.vertices[mesh.id]!]).toEqual(
      mesh.vertices.flatMap((p) => [Math.fround(Math.sin((p.y / 200) * Math.PI) * 5), 0]),
    );
  });

  it('反転や極端な曲がりでは三角形を新しく反転させない', () => {
    const { model, mesh, guide } = fixture();
    guide.gravity = false;
    guide.points[1] = { x: 1000, y: -500 };
    const baseline = createDeformPipeline().deform({ ...model, curveGuides: [] }, empty).byPartId.hair!.positions;
    const out = createDeformPipeline().deform(model, empty);
    const positions = out.byPartId.hair!.positions;
    const area = (p: Float32Array, a: number, b: number, c: number) =>
      (p[b * 2]! - p[a * 2]!) * (p[c * 2 + 1]! - p[a * 2 + 1]!) -
      (p[b * 2 + 1]! - p[a * 2 + 1]!) * (p[c * 2]! - p[a * 2]!);
    for (const [a, b, c] of mesh.triangles)
      expect(area(positions, a, b, c) * area(baseline, a, b, c)).toBeGreaterThan(0);
    expect(out.curveGuides!.guide!.status).toBe('limited');
  });
});
