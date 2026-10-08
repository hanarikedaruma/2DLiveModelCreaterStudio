import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator, createDeformPipeline, curveMeshSignature } from '@app/core';
import { loadProjectJson, type CurveGuide, type Vec2 } from '@app/schema';
import { createFakeServices } from '../../../services';
import { registry } from '../../../shell/registry';
import { register as registerCanvas } from '../canvas';
import { createEnvSlot } from '../canvas/env';
import { renderShell, stubSize } from '../canvas/testUtils';
import { makePart } from '../structure/testing';
import { copyParts, deleteParts } from '../structure/commands';
import { mirrorCopy } from '../structure/mirrorCopy';
import { register } from './index';
import { createCurveEditor } from './curveTool';
import { collisionGuideCommand, patchColliderCommand, removeColliderCommand } from './collisionCommands';
import { dynamicsGuideCommand } from './commands';
import { hairProject } from './testing';

function fixture() {
  const p = hairProject(),
    points: CurveGuide['points'] = [
      { x: 300, y: 200 },
      { x: 300, y: 300 },
      { x: 300, y: 400 },
    ];
  p.model.curveGuides = [
    {
      id: 'g',
      partId: 'hair',
      meshId: 'm',
      meshSignature: curveMeshSignature(p.model.meshes[0]!),
      reference: points,
      points,
      radius: 70,
      rootFraction: 0.15,
      enabled: true,
      gravity: true,
    },
  ];
  const mesh = {
    ...p.model.meshes[0]!,
    id: 'bodyMesh',
    vertices: [
      { x: 200, y: 200 },
      { x: 400, y: 200 },
      { x: 200, y: 400 },
      { x: 400, y: 400 },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    triangles: [
      [0, 1, 2],
      [1, 3, 2],
    ] as [number, number, number][],
  };
  p.model.meshes.push(mesh);
  p.model.parts.push(makePart('body', { meshId: mesh.id, assetId: 'a', name: '体' }));
  p.model.drawOrder.push('body');
  return p;
}
let restore = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvas();
  register();
  restore = stubSize(800, 600);
});
afterEach(() => restore());
describe('髪ごとの肩の設定と編集', () => {
  it('肩は2クリック/なぞりで作り、流れ揺れ/衝突は自動でONにしない。点のドラッグとEscは1Undo', () => {
    const services = { ...createFakeServices(), evaluator: createBindingEvaluator(), pipeline: createDeformPipeline() };
    services.store.load(fixture());
    services.editor.set({ selectedPartIds: ['hair'] });
    const slot = createEnvSlot();
    slot.set({
      services,
      dialogs: { notify: vi.fn(), confirm: vi.fn(async () => true) },
      view: () => ({ scale: 1, offset: { x: 0, y: 0 } }),
      lastDeformed: () => null,
      requestRedraw: vi.fn(),
    });
    const editor = createCurveEditor(slot),
      event = (p: Vec2) => ({
        canvasPoint: p,
        screenPoint: p,
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
      });
    const initial = services.store.get();
    editor.shoulder.draw('body', 'g');
    for (const p of [
      { x: 250, y: 330 },
      { x: 290, y: 340 },
    ]) {
      editor.tool.onPointerDown!(event(p));
      editor.tool.onPointerUp!(event(p));
    }
    const created = services.store.get(),
      collider = created.model.shoulderColliders![0]!;
    expect(collider.points).toHaveLength(2);
    expect(created.model.curveGuides![0]!.collision).toEqual({
      enabled: false,
      colliderIds: [collider.id],
      thickness: 1,
    });
    expect(created.model.curveGuides![0]!.dynamics).toBeUndefined();
    editor.tool.onPointerDown!(event(collider.points[0]!));
    editor.tool.onPointerMove!(event({ x: 260, y: 335 }));
    editor.tool.onPointerUp!(event({ x: 260, y: 335 }));
    const moved = services.store.get();
    expect(moved.model.shoulderColliders![0]!.points[0]!.x).toBeCloseTo(260);
    services.store.undo();
    expect(services.store.get()).toBe(created);
    services.store.redo();
    expect(services.store.get()).toBe(moved);
    editor.tool.onPointerDown!(event({ x: 260, y: 335 }));
    editor.tool.onPointerMove!(event({ x: 265, y: 336 }));
    editor.tool.onKeyDown!(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(services.store.get()).toBe(moved);
    services.store.undo();
    services.store.undo();
    expect(services.store.get()).toBe(initial);
    editor.shoulder.draw('body', 'g');
    editor.tool.onPointerDown!(event({ x: 250, y: 330 }));
    editor.tool.onPointerMove!(event({ x: 290, y: 340 }));
    editor.tool.onKeyDown!(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(services.store.get()).toBe(initial);
  });
  it('パレットに独立スイッチを出し、衝突OFFでも肩/太さ/流れ揺れを保存する', async () => {
    const p = fixture(),
      mesh = p.model.meshes[1]!;
    p.model.shoulderColliders = [
      {
        id: 's',
        name: '左肩',
        partId: 'body',
        meshId: mesh.id,
        meshSignature: curveMeshSignature(mesh),
        points: [
          { x: 250, y: 330 },
          { x: 290, y: 340 },
        ],
        radius: 5,
        enabled: true,
      },
    ];
    const s = renderShell(() => ({ evaluator: createBindingEvaluator(), pipeline: createDeformPipeline() }));
    act(() => {
      s.services.store.load(p);
      s.services.editor.set({ selectedPartIds: ['hair'] });
    });
    fireEvent.click(screen.getByRole('button', { name: '線で曲げる' }));
    const toggle = await screen.findByRole('checkbox', { name: '肩に当てる（衝突判定）' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: '左肩に当てる' }));
    fireEvent.click(toggle);
    expect(s.services.store.get().model.curveGuides![0]!.dynamics).toBeUndefined();
    fireEvent.click(screen.getByRole('checkbox', { name: '流れ線で揺らす' }));
    fireEvent.click(toggle);
    const saved = s.services.store.get();
    expect(saved.model.curveGuides![0]!.collision).toEqual({ enabled: false, colliderIds: ['s'], thickness: 1 });
    expect(saved.model.curveGuides![0]!.dynamics!.enabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '左肩を編集' }));
    const radius = screen.getByRole('slider', { name: '肩の帯の太さ' });
    fireEvent.change(radius, { target: { value: '12' } });
    expect(s.services.store.get()).toBe(saved);
    fireEvent.pointerUp(radius);
    expect(s.services.store.get().model.shoulderColliders![0]!.radius).toBe(12);
    act(() => s.services.store.undo());
    expect(s.services.store.get()).toBe(saved);
    expect(loadProjectJson(JSON.stringify(saved))).toEqual(saved);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '流れ線で揺らす' })).not.toBeNull());
  });
  it('髪だけの複製は同じ肩を保ち、肩ごとの複製/反転はコピー先へ指定し、削除とUndoで一括復元する', () => {
    const services = createFakeServices(),
      p = fixture(),
      mesh = p.model.meshes[1]!;
    p.model.shoulderColliders = [
      {
        id: 's',
        name: '肩',
        partId: 'body',
        meshId: mesh.id,
        meshSignature: curveMeshSignature(mesh),
        points: [
          { x: 250, y: 330 },
          { x: 290, y: 340 },
        ],
        radius: 5,
        enabled: true,
      },
    ];
    services.store.load(p);
    services.store.dispatch(collisionGuideCommand('g', { enabled: true, colliderIds: ['s'] }));
    services.store.dispatch(dynamicsGuideCommand('g', { enabled: true }));
    services.store.dispatch(copyParts(['hair']));
    let copy = services.store.get().model.curveGuides!.at(-1)!;
    expect(copy.collision!.colliderIds).toEqual(['s']);
    expect(copy.collision!.colliderIds).not.toBe(services.store.get().model.curveGuides![0]!.collision!.colliderIds);
    services.store.undo();
    services.store.dispatch(mirrorCopy(['head', 'body'], { centerX: 300, assets: [], assetMap: {} }));
    const both = services.store.get(),
      copiedShoulder = both.model.shoulderColliders!.at(-1)!;
    copy = both.model.curveGuides!.at(-1)!;
    expect(copy.collision!.colliderIds).toEqual([copiedShoulder.id]);
    expect(copiedShoulder.points[0]!.x).toBe(350);
    expect(copiedShoulder.meshSignature).toBe(
      curveMeshSignature(both.model.meshes.find((m) => m.id === copiedShoulder.meshId)!),
    );
    services.store.dispatch(removeColliderCommand('s'));
    expect(services.store.get().model.curveGuides![0]!.collision!.colliderIds).toEqual([]);
    expect(services.store.get().model.curveGuides!.at(-1)!.collision!.colliderIds).toEqual([copiedShoulder.id]);
    services.store.undo();
    expect(services.store.get()).toBe(both);
    services.store.dispatch(deleteParts(['body']));
    expect(services.store.get().model.shoulderColliders!.some((c) => c.id === 's')).toBe(false);
    expect(services.store.get().model.curveGuides![0]!.collision!.colliderIds).toEqual([]);
    services.store.undo();
    expect(services.store.get()).toBe(both);
    services.store.dispatch(patchColliderCommand('s', { radius: 0 }));
    expect(services.store.get()).toBe(both);
  });
});
