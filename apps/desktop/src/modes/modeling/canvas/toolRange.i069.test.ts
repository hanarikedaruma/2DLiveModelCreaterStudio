import { describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator, createDeformPipeline, regularWarpPoints } from '@app/core';
import type { Project, Vec2 } from '@app/schema';
import type { CanvasTool } from '../../../shell/api';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { canvasToScreen } from '../../../shell/canvas/view';
import { createContourEditor } from '../contourLine/contourTool';
import { createMeshEditor } from '../mesh/meshTool';
import { makePart, makeProject } from '../structure/testing';
import { createWarpEditor } from '../warp/warpTool';
import { rectMesh, testAsset } from '../warp/testProject';
import { createEnvSlot } from './env';
import { RecordingContext } from './testUtils';

// グループ g の中の画像 A（0..100）と、グループの外の画像 B（110..210。A の右に 10px 空けて手前にある）
function project(): Project {
  const bounds = { x: 0, y: 0, width: 100, height: 100 };
  return makeProject({
    assets: [testAsset('a', { x: 0, y: 0 }, 100, 100), testAsset('b', { x: 110, y: 0 }, 100, 100)],
    parts: [
      makePart('g', { kind: 'group', name: 'グループ' }),
      makePart('a', { assetId: 'a', meshId: 'm-a', parentId: 'g', name: 'A' }),
      makePart('b', { assetId: 'b', meshId: 'm-b', name: 'B' }),
    ],
    meshes: [rectMesh('m-a', 0, 0, 100, 100), rectMesh('m-b', 110, 0, 100, 100)],
    warps: [{ id: 'w', partId: 'g', columns: 2, rows: 2, bounds, points: regularWarpPoints(bounds, 2, 2) }],
  });
}

function setup(selected: string[]) {
  const base = createFakeServices();
  const services = {
    ...base,
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    keyEditor: createKeyEditor(),
  };
  services.store.load(project());
  services.editor.set({ selectedPartIds: selected });
  const slot = createEnvSlot();
  const view = { scale: 1, offset: { x: 0, y: 0 } };
  const deformed = () => {
    const model = services.store.get().model;
    return services.pipeline.deform(model, services.evaluator.evaluate(model, {}));
  };
  slot.set({
    services,
    dialogs: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    view: () => view,
    lastDeformed: deformed,
    requestRedraw: vi.fn(),
  });
  const ev = (p: Vec2) => ({
    canvasPoint: p,
    screenPoint: canvasToScreen(view, p),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  });
  const click = (tool: CanvasTool, p: Vec2) => {
    tool.onPointerDown!(ev(p));
    tool.onPointerUp!(ev(p));
  };
  const hintNames = (tool: CanvasTool, p: Vec2) => {
    tool.onPointerMove!(ev(p));
    const ctx = new RecordingContext();
    tool.drawOverlay!(ctx.asContext(), view);
    return ctx.texts;
  };
  return { slot, click, hintNames, selected: () => services.editor.get().selectedPartIds };
}

const NEAR = { x: 115, y: 50 }; // A の縁から 15px（余白の中）。B の上
const FAR = { x: 150, y: 50 }; // A の縁から 50px（余白の外）。B の上

describe('I-069: メッシュ編集・ワープ・輪郭線は、対象と余白の中では切り替えない', () => {
  it('メッシュ編集: A の縁から 15px の B を押しても A のまま。50px なら B に切り替わる。予告は外だけ', () => {
    const s = setup(['a']);
    let clock = 0;
    const tool = createMeshEditor(s.slot, { now: () => (clock += 1000) }).tool;
    expect(s.hintNames(tool, NEAR)).not.toContain('B');
    expect(s.hintNames(tool, FAR)).toContain('B');
    s.click(tool, NEAR);
    expect(s.selected()).toEqual(['a']);
    s.click(tool, FAR);
    expect(s.selected()).toEqual(['b']);
  });

  it('ワープ: 格子の縁から 15px の B を押してもグループのまま。50px なら B に切り替わる。予告は外だけ', () => {
    const s = setup(['g']);
    const tool = createWarpEditor(s.slot).tool;
    expect(s.hintNames(tool, NEAR)).not.toContain('B');
    expect(s.hintNames(tool, FAR)).toContain('B');
    s.click(tool, NEAR);
    expect(s.selected()).toEqual(['g']);
    s.click(tool, FAR);
    expect(s.selected()).toEqual(['b']);
  });

  it('輪郭線: A の縁から 15px の B を押しても A のまま。50px なら B に切り替わる。予告は外だけ', () => {
    const s = setup(['a']);
    let clock = 0;
    const tool = createContourEditor(s.slot, { now: () => (clock += 1000) }).tool;
    expect(s.hintNames(tool, NEAR)).not.toContain('B');
    expect(s.hintNames(tool, FAR)).toContain('B');
    s.click(tool, NEAR);
    expect(s.selected()).toEqual(['a']);
    s.click(tool, FAR);
    expect(s.selected()).toEqual(['b']);
  });
});
