import { describe, expect, it } from 'vitest';
import sample from '@app/fixtures/sample-model/project.json';
import {
  attachClosedEyeLine,
  baseMeshPositions,
  loadProjectJson,
  mapMeshPoint,
  regularWarpPoints,
  validateProject,
  type Project,
  type Vec2,
} from '@app/schema';
import { createBindingEvaluator } from '../eval';
import { createDeformPipeline } from '../deform';
import { createProjectStore } from '../store';
import { distanceToSegment } from '../mesh/edit';
import { planBlink, suggestClosedEyeLine } from './blink';

export function eyeFixture(): Project {
  const p = loadProjectJson(JSON.stringify(sample));
  for (const part of p.model.parts) {
    const a = p.assets.find((a) => a.id === part.assetId);
    if (!a) continue;
    part.meshId = `mesh-${part.id}`;
    const uvs = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));
    p.model.meshes.push({
      id: part.meshId,
      uvs,
      vertices: uvs.map((uv) => ({ x: a.offset.x + uv.x * a.width, y: a.offset.y + uv.y * a.height })),
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
    });
  }
  const upper = p.model.parts.find((q) => q.standardType === 'upperLidL')!;
  p.model.parts.push({
    ...upper,
    id: 'eye-parent',
    kind: 'group',
    standardType: 'eyeGroupL',
    assetId: null,
    meshId: null,
    rotation: 8,
    pivot: { x: 595, y: 470 },
  });
  for (const q of p.model.parts.filter((q) => ['upperLidL', 'lowerLidL', 'eyeWhiteL'].includes(q.standardType ?? '')))
    q.parentId = 'eye-parent';
  const white = p.model.parts.find((q) => q.standardType === 'eyeWhiteL')!;
  const bounds = { x: 520, y: 405, width: 160, height: 130 };
  p.model.warps.push({
    id: 'own',
    partId: white.id,
    columns: 1,
    rows: 1,
    bounds,
    angle: -0.1,
    points: regularWarpPoints(bounds, 1, 1, -0.1).map((p) => ({ x: p.x + (p.y - 405) * 0.06, y: p.y })),
  });
  p.model.setupHints.closedLineL = suggestClosedEyeLine(p, 'L');
  return p;
}
const part = (p: Project, type: string) => p.model.parts.find((q) => q.standardType === type)!;
const evaluate = (p: Project, value: number, x = 0) =>
  createDeformPipeline().deform(
    p.model,
    createBindingEvaluator().evaluate(p.model, { EyeOpenL: value, FaceAngleX: x }),
  );

describe('その目だけのまばたき（I-090）', () => {
  it('回転と画像自身のワープの中でも線へ閉じ、途中の値を逆算して白目が完全に消える', () => {
    const p = eyeFixture(),
      plan = planBlink(p, 'L');
    expect(plan.reason).toBeNull();
    const out = plan.command!.apply(p);
    expect(validateProject(out)).toEqual(out);
    const upper = part(out, 'upperLidL'),
      upperMesh = out.model.meshes.find((m) => m.id === upper.meshId)!;
    const line = p.model.setupHints.closedLineL!,
      white = part(p, 'eyeWhiteL'),
      wm = p.model.meshes.find((m) => m.id === white.meshId)!;
    const targetLine = line.points.map((uv) =>
      mapMeshPoint(wm, wm.uvs, baseMeshPositions(p.model, white.id, wm.vertices), uv)!,
    );
    const closed = evaluate(out, 0).byPartId[upper.id]!;
    for (const i of upperMesh.uvs.flatMap((uv, i) => (uv.y === 1 ? [i] : []))) {
      const x = closed.positions[2 * i]!,
        y = closed.positions[2 * i + 1]!;
      if (x < targetLine[0]!.x || x > targetLine.at(-1)!.x) continue;
      expect(
        Math.min(...targetLine.slice(1).map((p, i) => distanceToSegment({ x, y }, targetLine[i]!, p))),
      ).toBeLessThan(0.01);
    }
    for (const faceX of [-30, 0, 30])
      for (let n = 0; n <= 20; n++) {
        const items = evaluate(out, n / 20, faceX);
        expect([...items.byPartId[upper.id]!.positions].every(Number.isFinite)).toBe(true);
        if (n === 0) expect(items.byPartId[white.id]!.opacity).toBe(0);
      }
    expect(out.model.bindings.find((b) => b.target.id === upper.meshId && b.channel === 'vertices')!.keyValues).toEqual(
      [[0, 0.25, 0.5, 0.75, 1]],
    );
  });

  it('他の目・口・階層・ピボット・マスク・物理を変えず、追加頂点へ別のパラメータを転写し1回でUndoできる', () => {
    const p = eyeFixture(),
      white = part(p, 'eyeWhiteL'),
      wm = p.model.meshes.find((m) => m.id === white.meshId)!;
    p.model.bindings.push({
      id: 'gaze',
      target: { type: 'mesh', id: wm.id },
      channel: 'vertices',
      parameterIds: ['EyeBallX'],
      keyValues: [[-1, 0, 1]],
      keys: [-1, 0, 1].map((v) => ({
        coords: [v],
        delta: wm.vertices.map((p) => ({ x: (v * p.x) / 100, y: (v * p.y) / 100 })),
        source: 'manual',
        locked: true,
      })),
      generation: 'linear',
      divisions: null,
    });
    const store = createProjectStore(p),
      plan = planBlink(p, 'L');
    expect(plan.replacesCustom).toBe(false);
    store.dispatch(plan.command!);
    const out = store.get();
    expect(out.model.parts).toBe(p.model.parts);
    expect(out.model.warps).toBe(p.model.warps);
    expect(out.model.drawOrder).toBe(p.model.drawOrder);
    expect(out.physics).toBe(p.physics);
    const newMesh = out.model.meshes.find((m) => m.id === wm.id)!;
    expect(newMesh.vertices.length).toBeGreaterThan(wm.vertices.length);
    const gaze = out.model.bindings.find((b) => b.id === 'gaze')!;
    (gaze.keys[2]!.delta as Vec2[]).forEach((v, i) => {
      expect(v.x).toBeCloseTo(newMesh.vertices[i]!.x / 100, 10);
      expect(v.y).toBeCloseTo(newMesh.vertices[i]!.y / 100, 10);
    });
    for (const old of p.model.meshes.filter(
      (m) => ![white.meshId, part(p, 'upperLidL').meshId, part(p, 'lowerLidL').meshId].includes(m.id),
    ))
      expect(out.model.meshes.find((m) => m.id === old.id)).toBe(old);
    store.undo();
    expect(store.get()).toBe(p);
    expect(plan.command!.apply(out)).toBe(out);
  });

  it('手修正・ロック・笑顔との組み合わせの置き換えを報告し、同じ範囲に重ねない', () => {
    let p = eyeFixture();
    p = planBlink(p, 'L').command!.apply(p);
    const b = p.model.bindings.find((b) => b.channel === 'vertices')!;
    b.parameterIds = ['EyeOpenL', 'EyeSmileL'];
    b.keyValues = [
      [0, 1],
      [0, 1],
    ];
    b.keys = b.keys.slice(0, 2).map((k) => ({ ...k, coords: [k.coords[0]!, 0], source: 'manual', locked: true }));
    const plan = planBlink(p, 'L');
    expect(plan.replacesCustom).toBe(true);
    const out = plan.command!.apply(p);
    expect(
      out.model.bindings.some((b) => b.parameterIds.includes('EyeOpenL') && b.parameterIds.includes('EyeSmileL')),
    ).toBe(false);
    expect(
      out.model.bindings.filter((b) => b.channel === 'vertices' && b.target.id === part(out, 'upperLidL').meshId),
    ).toHaveLength(1);
  });

  it('メッシュ・線・ロック・範囲の問題を理由付きで止める', () => {
    const p = eyeFixture();
    p.model.setupHints.closedLineL = null;
    expect(planBlink(p, 'L').reason).toMatch(/線/);
    p.model.setupHints.closedLineL = {
      partId: null,
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    };
    expect(planBlink(p, 'L').reason).toMatch(/重なって/);
    part(p, 'upperLidL').locked = true;
    expect(planBlink(p, 'L').reason).toMatch(/ロック/);
    part(p, 'upperLidL').locked = false;
    part(p, 'eyeWhiteL').meshId = null;
    expect(planBlink(p, 'L').reason).toMatch(/メッシュ/);
  });

  it('素材の列を使った線の案と細い閉じた帯を作る', () => {
    const p = eyeFixture();
    const images = Object.fromEntries(
      p.assets.map((a) => {
        const data = new Uint8ClampedArray(a.width * a.height * 4);
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) data[(y * a.width + x) * 4 + 3] = 255;
        return [a.id, { width: a.width, height: a.height, data }];
      }),
    );
    p.model.setupHints.closedLineL = suggestClosedEyeLine(p, 'L', images);
    const plan = planBlink(p, 'L', images);
    expect(plan.reason).toBeNull();
    const out = plan.command!.apply(p),
      upper = part(out, 'upperLidL'),
      m = out.model.meshes.find((m) => m.id === upper.meshId)!;
    const item = evaluate(out, 0).byPartId[upper.id]!;
    const first = m.uvs.findIndex((p) => p.x === 0.5 && p.y === 0),
      last = m.uvs.findIndex((p) => p.x === 0.5 && p.y === 1);
    expect(
      Math.hypot(
        item.positions[2 * last]! - item.positions[2 * first]!,
        item.positions[2 * last + 1]! - item.positions[2 * first + 1]!,
      ),
    ).toBeLessThan(20);
  });
});

describe('閉じた線の旧版移行', () => {
  it('旧版にメッシュが無かった場合も線を捨てず、メッシュ生成後の片目反映でUVへ付ける', () => {
    const p = eyeFixture(),
      white = part(p, 'eyeWhiteL'),
      mesh = p.model.meshes.find((m) => m.id === white.meshId)!;
    const line = p.model.setupHints.closedLineL!;
    const points = line.points.map((uv) =>
      mapMeshPoint(mesh, mesh.uvs, baseMeshPositions(p.model, white.id, mesh.vertices), uv)!,
    );
    const noMeshes = {
      ...p,
      schemaVersion: 8,
      model: {
        ...p.model,
        meshes: [],
        parts: p.model.parts.map((p) => ({ ...p, meshId: null })),
        setupHints: { closedLineL: points, closedLineR: null },
      },
    };
    const loaded = loadProjectJson(JSON.stringify(noMeshes));
    expect(loaded.model.setupHints.closedLineL).toEqual({ partId: null, points });
    const restored = { ...loaded, model: { ...loaded.model, parts: p.model.parts, meshes: p.model.meshes } };
    const plan = planBlink(restored, 'L');
    expect(plan.reason).toBeNull();
    expect(plan.command!.apply(restored).model.setupHints.closedLineL!.partId).toBe(white.id);
  });
  it('基準表示三角形からUVへ移し、回転と自身のワープを二重に掛けない', () => {
    const p = eyeFixture(),
      white = part(p, 'eyeWhiteL'),
      mesh = p.model.meshes.find((m) => m.id === white.meshId)!;
    const display = baseMeshPositions(p.model, white.id, mesh.vertices);
    const points = [
      { x: 0.05, y: 0.82 },
      { x: 0.5, y: 0.82 },
      { x: 0.95, y: 0.82 },
    ].map((uv) => mapMeshPoint(mesh, mesh.uvs, display, uv)!);
    const old = {
      ...p,
      schemaVersion: 8,
      model: { ...p.model, setupHints: { closedLineL: points, closedLineR: null } },
    };
    const next = loadProjectJson(JSON.stringify(old)),
      line = next.model.setupHints.closedLineL!;
    expect(line.partId).toBe(white.id);
    line.points.forEach((uv, i) => {
      expect(mapMeshPoint(mesh, mesh.uvs, display, uv)!.x).toBeCloseTo(points[i]!.x, 6);
      expect(mapMeshPoint(mesh, mesh.uvs, display, uv)!.y).toBeCloseTo(points[i]!.y, 6);
    });
    expect(attachClosedEyeLine(p.model, 'L', points)).toEqual(line);
  });
});
