import { describe, expect, it, vi } from 'vitest';
import type { Mesh, Vec2 } from '@app/schema';
import { createBindingEvaluator, createDeformPipeline, transferMeshKeys } from '@app/core';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { createEnvSlot } from '../canvas/env';
import { makeAsset, makeBinding, makePart, makeProject } from '../structure/testing';
import { addVertex, basePointAt, removeVertices, type MeshShape, type Triangle } from './meshOps';
import { createMeshEditor, displayPositions } from './meshTool';

// (0,0) から 4×4 マスの格子（1マス 25）。UV は 0..1
function grid(): MeshShape {
  const vertices: Vec2[] = [];
  const uvs: Vec2[] = [];
  for (let r = 0; r <= 4; r++)
    for (let c = 0; c <= 4; c++) {
      vertices.push({ x: c * 25, y: r * 25 });
      uvs.push({ x: c / 4, y: r / 4 });
    }
  const triangles: Triangle[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const a = r * 5 + c;
      triangles.push([a, a + 1, a + 6], [a, a + 6, a + 5]);
    }
  return { vertices, uvs, triangles };
}

const key = (t: Triangle) => [...t].sort((a, b) => a - b).join(',');

// 頂点 6 と 12 だけを動かす、なめらかでないキー（三角形が変わると見た目も変わる）
const bumpy = (n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => (i === 6 ? { x: 9, y: -4 } : i === 12 ? { x: -6, y: 7 } : { x: 0, y: 0 }));

// UV の点が、そのキーの形でどこに描かれるか（三角形を UV で探して、重心座標で写す）
function drawn(shape: MeshShape, delta: Vec2[], uv: Vec2): Vec2 {
  for (const [i, j, k] of shape.triangles) {
    const [a, b, c] = [shape.uvs[i]!, shape.uvs[j]!, shape.uvs[k]!];
    const det = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const u = ((b.x - uv.x) * (c.y - uv.y) - (b.y - uv.y) * (c.x - uv.x)) / det;
    const v = ((c.x - uv.x) * (a.y - uv.y) - (c.y - uv.y) * (a.x - uv.x)) / det;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const at = (index: number) => ({
      x: shape.vertices[index]!.x + delta[index]!.x,
      y: shape.vertices[index]!.y + delta[index]!.y,
    });
    const [p, q, r] = [at(i), at(j), at(k)];
    return { x: u * p.x + v * q.x + w * r.x, y: u * p.y + v * q.y + w * r.y };
  }
  return { x: NaN, y: NaN };
}

// 細かい UV の点（5×5 マスの各マスを 6 等分）
const SAMPLES: Vec2[] = [];
for (let r = 0; r <= 24; r++) for (let c = 0; c <= 24; c++) SAMPLES.push({ x: c / 24, y: r / 24 });

// 形を変えたあと、キーの差を移して、キーの形の見た目がどれだけ変わったか（px）
function keyChange(before: MeshShape, after: MeshShape, skip: (uv: Vec2) => boolean = () => false): number {
  const delta = bumpy(before.vertices.length);
  const mesh: Mesh = { id: 'm', ...before, density: 'custom', edited: true };
  const model = makeProject({
    meshes: [mesh],
    bindings: [
      makeBinding('b', {
        target: { type: 'mesh', id: 'm' },
        channel: 'vertices',
        keyValues: [[0, 30]],
        keys: [
          { coords: [0], delta: before.vertices.map(() => ({ x: 0, y: 0 })), source: 'auto', locked: false },
          { coords: [30], delta, source: 'manual', locked: false },
        ],
      }),
    ],
  }).model;
  const moved = transferMeshKeys(model, 'm', after).bindings[0]!.keys[1]!.delta as Vec2[];
  let worst = 0;
  for (const uv of SAMPLES) {
    if (skip(uv)) continue;
    const p = drawn(before, delta, uv);
    const q = drawn(after, moved, uv);
    if (Number.isFinite(p.x) && Number.isFinite(q.x)) worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return worst;
}

function ok(result: ReturnType<typeof addVertex>) {
  if (!result.ok) throw new Error(result.error);
  return result.shape;
}

describe('I-073: 頂点を足す・消すとき、触らない所の三角形とキーの形を変えない', () => {
  it('三角形の中・内側の辺の上・輪郭の辺の上に足すと、その三角形だけを分け、ほかはそのまま', () => {
    const base = grid();
    for (const { p, split, grows } of [
      { p: { x: 30, y: 40 }, split: 1, grows: 2 }, // 三角形の中: 1つを3つに
      { p: { x: 37.5, y: 37.5 }, split: 2, grows: 2 }, // 内側の辺（斜め）の上: 両側を2つずつに
      { p: { x: 60, y: 0 }, split: 1, grows: 1 }, // 輪郭の辺の上: 1つを2つに
    ]) {
      const after = ok(addVertex(base, p));
      const kept = new Set(after.triangles.map(key));
      expect(base.triangles.filter((t) => !kept.has(key(t)))).toHaveLength(split);
      expect(after.triangles).toHaveLength(base.triangles.length + grows);
      expect(keyChange(base, after)).toBeLessThan(1e-9);
    }
  });

  it('輪郭の外に足すと、いちばん近い辺を広げる三角形を1つ足し、ほかはそのまま', () => {
    // 素材より小さいメッシュ（UV 0.1〜0.9）。上の辺の外も画像の中
    const full = grid();
    const base = { ...full, uvs: full.uvs.map((u) => ({ x: 0.1 + u.x * 0.8, y: 0.1 + u.y * 0.8 })) };
    const after = ok(addVertex(base, { x: 50, y: -10 }));
    const kept = new Set(after.triangles.map(key));
    expect(base.triangles.every((t) => kept.has(key(t)))).toBe(true);
    expect(after.triangles.length).toBe(base.triangles.length + 1);
    expect(keyChange(base, after)).toBeLessThan(1e-9);
  });

  it('内側の頂点を消すと、そのまわりの穴だけを分け直し、穴の外のキーの形は変わらない', () => {
    const base = grid();
    // 頂点 18（(75,75)）。まわりの6つの三角形が穴になる
    const after = removeVertices(base, [18]);
    if (!after.ok) throw new Error(after.error);
    const touching = base.triangles.filter((t) => t.includes(18));
    const kept = new Set(after.shape.triangles.map(key));
    const renumber = (t: Triangle): Triangle => t.map((i) => (i > 18 ? i - 1 : i)) as Triangle;
    for (const t of base.triangles) if (!t.includes(18)) expect(kept.has(key(renumber(t)))).toBe(true);
    expect(after.shape.triangles.length).toBe(base.triangles.length - touching.length + (touching.length - 2));
    // 穴（(50..100, 50..100) の中）の外は、キーの形が変わらない
    const inHole = (uv: Vec2) => uv.x > 0.5 - 1e-9 && uv.y > 0.5 - 1e-9 && uv.x < 1 + 1e-9 && uv.y < 1 + 1e-9;
    expect(keyChange(base, after.shape, inHole)).toBeLessThan(1e-9);
  });

  it('見えている形の上の点から、基準の形の位置を求める（キーで頂点が動いていても押した所に当たる）', () => {
    const base = grid();
    const delta = bumpy(base.vertices.length);
    const visible = base.vertices.map((v, i) => ({ x: v.x + delta[i]!.x, y: v.y + delta[i]!.y }));
    const click = { x: 31, y: 33 };
    const at = basePointAt(base, visible, click)!;
    const after = ok(addVertex(base, at));
    const moved = transferMeshKeys(
      makeProject({
        meshes: [{ id: 'm', ...base, density: 'custom', edited: true }],
        bindings: [
          makeBinding('b', {
            target: { type: 'mesh', id: 'm' },
            channel: 'vertices',
            keyValues: [[0, 30]],
            keys: [{ coords: [30], delta, source: 'manual', locked: false }],
          }),
        ],
      }).model,
      'm',
      after,
    ).bindings[0]!.keys[0]!.delta as Vec2[];
    const n = after.vertices.length - 1;
    expect(after.vertices[n]!.x + moved[n]!.x).toBeCloseTo(click.x, 6);
    expect(after.vertices[n]!.y + moved[n]!.y).toBeCloseTo(click.y, 6);
  });
});

describe('I-073: メッシュ編集で、キーの値のときにダブルクリックで頂点を足す', () => {
  it('足した頂点は押した所にでき、ほかのキーの形は変わらない', async () => {
    const shape = grid();
    const mesh: Mesh = { id: 'm', ...shape, density: 'custom', edited: true };
    const zero = shape.vertices.map(() => ({ x: 0, y: 0 }));
    const minus = bumpy(shape.vertices.length).map((d) => ({ x: -d.x, y: d.y }));
    const project = makeProject({
      assets: [makeAsset('a', { width: 100, height: 100 })],
      parts: [makePart('face', { assetId: 'a', meshId: 'm' })],
      meshes: [mesh],
      bindings: [
        makeBinding('b', {
          target: { type: 'mesh', id: 'm' },
          channel: 'vertices',
          keyValues: [[-30, 0, 30]],
          keys: [
            { coords: [-30], delta: minus, source: 'manual', locked: false },
            { coords: [0], delta: zero, source: 'auto', locked: false },
            { coords: [30], delta: bumpy(shape.vertices.length), source: 'manual', locked: false },
          ],
        }),
      ],
    });
    const base = createFakeServices();
    const services = {
      ...base,
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      keyEditor: createKeyEditor(),
    };
    services.store.load(project);
    services.editor.set({
      selectedPartIds: ['face'],
      activeParameterIds: ['FaceAngleX'],
      editorParamValues: { FaceAngleX: -30 },
    });
    const slot = createEnvSlot();
    const view = { scale: 1, offset: { x: 0, y: 0 } };
    slot.set({
      services,
      dialogs: { notify: vi.fn(), confirm: vi.fn(async () => true) },
      view: () => view,
      lastDeformed: () => null,
      requestRedraw: vi.fn(),
    });
    let clock = 0;
    const editor = createMeshEditor(slot, { now: () => clock });
    const shapeAt = (value: number) => {
      const p = services.store.get();
      const m = p.model.meshes[0]!;
      const deltas = services.evaluator.evaluate(p.model, { FaceAngleX: value });
      return { mesh: m, positions: displayPositions(p.model, deltas, null, p.model.parts[0]!, m) };
    };
    const before = shapeAt(30);

    const click = { x: 31, y: 33 };
    const ev = { canvasPoint: click, screenPoint: click, button: 0, shiftKey: false, ctrlKey: false, altKey: false };
    editor.tool.onPointerDown!(ev);
    editor.tool.onPointerUp!(ev);
    clock += 100;
    editor.tool.onPointerDown!(ev);
    editor.tool.onPointerUp!(ev);
    await editor.settled();

    const now = shapeAt(-30);
    expect(now.mesh.vertices).toHaveLength(shape.vertices.length + 1);
    const added = now.positions.at(-1)!;
    expect(added.x).toBeCloseTo(click.x, 6);
    expect(added.y).toBeCloseTo(click.y, 6);
    // +30 のキーの形: 元の頂点の位置は同じ（足した三角形の外の見た目も変わらない）
    const after = shapeAt(30);
    before.positions.forEach((p, i) => {
      expect(after.positions[i]!.x).toBeCloseTo(p.x, 9);
      expect(after.positions[i]!.y).toBeCloseTo(p.y, 9);
    });
  });
});
