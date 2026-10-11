import { describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator, createDeformPipeline } from '@app/core';
import type { ProjectStoreWithHistory } from '@app/core';
import type { Mesh, Vec2 } from '@app/schema';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { canvasToScreen } from '../../../shell/canvas/view';
import { createEnvSlot } from '../canvas/env';
import { makeAsset, makePart, makeProject } from '../structure/testing';
import { SOFT_RADIUS_MAX, createMeshEditor, softSelection, softWeight } from './meshTool';

// (0,0) から 100×100 の格子（10px のマス）
function grid(): Mesh {
  const vertices: Vec2[] = [];
  const uvs: Vec2[] = [];
  for (let r = 0; r <= 10; r++)
    for (let c = 0; c <= 10; c++) {
      vertices.push({ x: c * 10, y: r * 10 });
      uvs.push({ x: c / 10, y: r / 10 });
    }
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) {
      const a = r * 11 + c;
      triangles.push([a, a + 1, a + 11], [a + 1, a + 12, a + 11]);
    }
  return { id: 'm', vertices, uvs, triangles, density: 'custom', edited: false };
}

function setup() {
  const base = createFakeServices();
  const services = {
    ...base,
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    keyEditor: createKeyEditor(),
  };
  services.store.load(
    makeProject({
      assets: [makeAsset('a', { width: 100, height: 100 })],
      parts: [makePart('p', { assetId: 'a', meshId: 'm' })],
      meshes: [grid()],
    }),
  );
  services.editor.set({ selectedPartIds: ['p'] });
  const slot = createEnvSlot();
  const view = { scale: 1, offset: { x: 0, y: 0 } };
  slot.set({
    services,
    dialogs: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    view: () => view,
    lastDeformed: () => null,
    requestRedraw: vi.fn(),
  });
  const editor = createMeshEditor(slot, { now: () => 0 });
  const ev = (p: Vec2) => ({
    canvasPoint: p,
    screenPoint: canvasToScreen(view, p),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  });
  const drag = (from: Vec2, to: Vec2) => {
    editor.tool.onPointerDown!(ev(from));
    for (let i = 1; i <= 4; i++)
      editor.tool.onPointerMove!(ev({ x: from.x + ((to.x - from.x) * i) / 4, y: from.y + ((to.y - from.y) * i) / 4 }));
    editor.tool.onPointerUp!(ev(to));
  };
  const store = services.store as ProjectStoreWithHistory;
  const vertex = (x: number, y: number) => store.get().model.meshes[0]!.vertices[(y / 10) * 11 + x / 10]!;
  return { editor, drag, store, vertex };
}

describe('I-068 D6: 頂点の移動の「まわりも動かす」幅', () => {
  it('割合は選んだ頂点で 1、幅の所で 0、その間は滑らかに下がる', () => {
    expect(softWeight(0, 20)).toBe(1);
    expect(softWeight(20, 20)).toBe(0);
    expect(softWeight(10, 20)).toBeCloseTo(0.5, 9);
    expect(softWeight(5, 0)).toBe(0);
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(softSelection(points, [0], 20)).toEqual({ indices: [0, 1], weights: [1, softWeight(5, 20)] });
    expect(softSelection(points, [0], 0)).toEqual({ indices: [0], weights: [1] });
  });

  it('幅 0（既定）では今までどおり選んだ頂点だけが動く', () => {
    const s = setup();
    expect(s.editor.softRadius.get()).toBe(0);
    s.drag({ x: 50, y: 50 }, { x: 60, y: 50 });
    expect(s.vertex(50, 50).x).toBeCloseTo(60, 6);
    expect(s.vertex(60, 50).x).toBe(60);
    expect(s.vertex(40, 50).x).toBe(40);
  });

  it('幅を広げると、まわりの頂点が距離に応じて滑らかについてくる。1回の Undo で戻る', () => {
    const s = setup();
    s.editor.softRadius.set(25);
    s.drag({ x: 50, y: 50 }, { x: 60, y: 50 });
    const dx = (x: number, y: number) => s.vertex(x, y).x - x;
    expect(dx(50, 50)).toBeCloseTo(10, 6);
    expect(dx(40, 50)).toBeCloseTo(10 * softWeight(10, 25), 6);
    expect(dx(30, 50)).toBeCloseTo(10 * softWeight(20, 25), 6);
    expect(dx(20, 50)).toBe(0);
    expect(dx(50, 60)).toBeCloseTo(dx(40, 50), 6);
    s.store.undo();
    expect(s.vertex(40, 50).x).toBe(40);
    expect(s.vertex(50, 50).x).toBe(50);
  });

  it('幅は 0〜上限に丸める', () => {
    const s = setup();
    s.editor.softRadius.set(-5);
    expect(s.editor.softRadius.get()).toBe(0);
    s.editor.softRadius.set(9999);
    expect(s.editor.softRadius.get()).toBe(SOFT_RADIUS_MAX);
  });
});
