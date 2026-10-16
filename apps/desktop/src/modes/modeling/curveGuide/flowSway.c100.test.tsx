import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBindingEvaluator, createDeformPipeline, curveMeshSignature } from '@app/core';
import { loadProjectJson, type CurveGuide } from '@app/schema';
import { registry } from '../../../shell/registry';
import { register as registerCanvas } from '../canvas';
import { renderShell, stubSize } from '../canvas/testUtils';
import { register as registerStructure } from '../structure';
import { copyParts, deleteParts } from '../structure/commands';
import { mirrorCopy } from '../structure/mirrorCopy';
import { disablePhysicsCommand, enablePhysicsCommand } from '../physics/commands';
import { register } from './index';
import { dynamicsGuideCommand, gravityGuideCommand, patchGuideCommand } from './commands';
import { hairProject } from './testing';
import { stopFlowPreview } from './preview';

let restore = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvas();
  registerStructure();
  register();
  restore = stubSize(800, 600);
});
afterEach(() => restore());
function fixture() {
  const p = hairProject();
  const points: CurveGuide['points'] = [
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
      points,
      reference: points.map((v) => ({ ...v })) as CurveGuide['reference'],
      radius: 70,
      rootFraction: 0.15,
      gravity: true,
      enabled: true,
    },
  ];
  return p;
}
async function setup() {
  const s = renderShell(() => ({ evaluator: createBindingEvaluator(), pipeline: createDeformPipeline() }));
  act(() => {
    s.services.store.load(fixture());
    s.services.editor.set({ selectedPartIds: ['hair'] });
  });
  fireEvent.click(screen.getByRole('button', { name: '流線で曲げる' }));
  await waitFor(() => expect(document.querySelector('[data-panel-id="curveGuide"]')).not.toBeNull());
  return s;
}
const axis = () => enablePhysicsCommand('hair', { physics: 'ph', transform: 't', vertices: 'v' });
describe('流れ線で揺らす', () => {
  it('線・重力・プリセットでは初期OFF。両方式の目印と保存を独立し、Undo/再読込でも追従する', async () => {
    const s = await setup();
    expect((screen.getByRole('checkbox', { name: '流れ線で揺らす' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: '流れ揺れのプリセット' }), { target: { value: 'soft' } });
    expect(s.services.store.get().model.curveGuides![0]!.dynamics!.enabled).toBe(false);
    expect(screen.queryByRole('img', { name: /流れ揺れ：ON/ })).toBeNull();
    act(() => s.services.store.dispatch(axis()));
    fireEvent.click(screen.getByRole('checkbox', { name: '流れ線で揺らす' }));
    const both = s.services.store.get();
    expect(both.physics).toHaveLength(1);
    expect(screen.getByRole('img', { name: /流れ揺れ：ON/ })).not.toBeNull();
    expect(screen.getByRole('img', { name: /軸揺れ：ON/ })).not.toBeNull();
    act(() => s.services.store.dispatch(disablePhysicsCommand('hair')));
    expect(s.services.store.get().model.curveGuides).toBe(both.model.curveGuides);
    expect(screen.queryByRole('img', { name: /軸揺れ：ON/ })).toBeNull();
    act(() => s.services.store.undo());
    expect(s.services.store.get()).toBe(both);
    act(() => s.services.store.load(loadProjectJson(JSON.stringify(both))));
    expect(screen.getAllByRole('img', { name: /揺れ：ON/ })).toHaveLength(2);
    act(() => s.services.store.dispatch(gravityGuideCommand('g', false)));
    expect(screen.getByRole('img', { name: /流れ揺れ：ON.*停止中/ }).classList.contains('is-paused')).toBe(true);
    expect(screen.getByRole('img', { name: /軸揺れ：ON/ }).classList.contains('is-paused')).toBe(false);
  });
  it('つまみは1操作1Undo、Escで取消。再生は保存を変更せず、パレットが隠れても続き、停止で静止形に戻る', async () => {
    const s = await setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '流れ線で揺らす' }));
    const before = s.services.store.get();
    const range = screen.getByRole('slider', { name: '流れ揺れの大きさ' });
    fireEvent.change(range, { target: { value: '65' } });
    fireEvent.change(range, { target: { value: '80' } });
    expect(s.services.store.get()).toBe(before);
    fireEvent.pointerUp(range);
    expect(s.services.store.get().model.curveGuides![0]!.dynamics!.strength).toBe(0.8);
    act(() => s.services.store.undo());
    expect(s.services.store.get()).toBe(before);
    fireEvent.change(range, { target: { value: '90' } });
    fireEvent.keyDown(range, { key: 'Escape' });
    fireEvent.keyUp(range, { key: 'Escape' });
    expect(s.services.store.get()).toBe(before);
    const editor = s.services.editor.get().editorParamValues;
    fireEvent.click(screen.getByRole('button', { name: '動きを試す' }));
    await waitFor(() => expect(s.canvas.getState().motionPreview).toBeTruthy());
    act(() => s.canvas.setActiveTool('modeling.select'));
    expect(document.querySelector('[data-panel-id="curveGuide"]')).toBeNull();
    expect(s.canvas.getState().motionPreview).toBeTruthy();
    expect(s.services.store.get()).toBe(before);
    expect(s.services.editor.get().editorParamValues).toBe(editor);
    act(() => stopFlowPreview(s.canvas));
    await waitFor(() => expect(s.canvas.lastDeformed()?.curveGuides?.g?.dynamics?.status).toBe('settled'));
    expect(s.canvas.getState().motionPreview).toBeNull();
  });
  it('複製・反転を深いコピーにし、OFF/削除は他方式を保ち、失効した対象はOFFだけ変更できる', async () => {
    const s = await setup();
    act(() => {
      s.services.store.dispatch(axis());
      s.services.store.dispatch(dynamicsGuideCommand('g', { enabled: true }));
      s.services.store.dispatch(copyParts(['hair']));
    });
    const guides = s.services.store.get().model.curveGuides!;
    expect(guides).toHaveLength(2);
    expect(guides[1]!.dynamics).toEqual(guides[0]!.dynamics);
    expect(guides[1]!.dynamics).not.toBe(guides[0]!.dynamics);
    act(() => s.services.store.dispatch(mirrorCopy(['hair'], { centerX: 300, assets: [], assetMap: {} })));
    expect(s.services.store.get().model.curveGuides!.at(-1)!.dynamics).toEqual(guides[0]!.dynamics);
    act(() => s.services.store.dispatch(deleteParts(['hair'])));
    expect(s.services.store.get().model.curveGuides).toHaveLength(2);
    act(() => s.services.store.undo());
    const p = s.services.store.get();
    act(() =>
      s.services.store.load({
        ...p,
        model: {
          ...p.model,
          curveGuides: p.model.curveGuides!.map((g) => (g.id === 'g' ? { ...g, meshSignature: 'stale' } : g)),
        },
      }),
    );
    const stale = s.services.store.get();
    act(() => s.services.store.dispatch(patchGuideCommand('g', { radius: 100 })));
    expect(s.services.store.get()).toBe(stale);
    act(() => s.services.store.dispatch(dynamicsGuideCommand('g', { enabled: false })));
    expect(s.services.store.get().physics).toBe(stale.physics);
    expect(s.services.store.get().model.curveGuides![0]!.dynamics!.enabled).toBe(false);
  });
  it('描画順でも両方式を示し、目印のクリックで設定を切り替えない', async () => {
    const s = await setup();
    act(() => {
      s.services.store.dispatch(axis());
      s.services.store.dispatch(dynamicsGuideCommand('g', { enabled: true }));
    });
    fireEvent.click(screen.getByRole('tab', { name: '描画順' }));
    const before = s.services.store.get();
    const row = document.querySelector('[data-part-id="hair"][role="option"]') as HTMLElement;
    const icons = within(row).getAllByRole('img');
    expect(icons.map((i) => i.getAttribute('aria-label'))).toEqual(['長い髪：軸揺れ：ON', '長い髪：流れ揺れ：ON']);
    fireEvent.click(icons[1]!);
    expect(s.services.store.get()).toBe(before);
  });
});
