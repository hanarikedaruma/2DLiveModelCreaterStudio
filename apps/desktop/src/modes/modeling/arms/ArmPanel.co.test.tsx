import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createArmTrackingFixture, createBindingEvaluator, createDeformPipeline, forwardArmInModel } from '@app/core';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { createCanvasController } from '../../../shell/canvas/controller';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register, armEditor } from './index';

beforeEach(() => registry.reset());
async function setup(unrig = false) {
  register();
  const services = {
    ...createFakeServices(),
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
  };
  const p = createArmTrackingFixture();
  if (unrig) {
    delete p.model.armRigs;
    p.model.parts = p.model.parts
      .filter((x) => !/^(shoulder|elbow|wrist)-/.test(x.id))
      .map((x) => (x.id === 'body-root' ? x : { ...x, parentId: 'body-root' }));
  }
  const canvas = createCanvasController(),
    environment = createEnvironmentStore(memoryEnvironmentStorage());
  render(<Shell services={services} environment={environment} canvas={canvas} />);
  await act(async () => {
    await environment.load();
    services.store.load(p);
    services.editor.set({ mode: 'modeling' });
    canvas.setActiveTool('modeling.arms');
  });
  const panel = () =>
    within(
      screen.getByRole('heading', { name: '腕・手の設定' }).closest('.panel') ??
        screen.getByText('肩・肘・手首と左右専用の手を設定する。キャンバスの点をドラッグして配置し、最後に保存する。')
          .parentElement!,
    );
  return { services, canvas, panel };
}
it('不足を表示し、素材と関節を揃えて専用リグを作りUndoできる', async () => {
  const s = await setup(true);
  expect(screen.getByRole('button', { name: '専用関節を作成' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('体側の親'), { target: { value: 'body-root' } });
  for (const [label, value] of [
    ['上腕の素材', 'upper-L'],
    ['前腕の素材', 'lower-L'],
  ]) {
    const select = screen.getByLabelText(label!) as HTMLSelectElement;
    for (const option of select.options) option.selected = option.value === value;
    fireEvent.change(select);
  }
  fireEvent.change(screen.getByLabelText('肩 X'), { target: { value: 378 } });
  fireEvent.change(screen.getByLabelText('肘 X'), { target: { value: 378 } });
  fireEvent.change(screen.getByLabelText('手首 X'), { target: { value: 378 } });
  for (const [label, value] of [
    ['パー', 'open-L'],
    ['グー', 'fist-L'],
    ['指さし', 'point-L'],
    ['ピース', 'peace-L'],
  ])
    fireEvent.change(screen.getByLabelText(`${label}の素材`), { target: { value } });
  const create = screen.getByRole('button', { name: '専用関節を作成' });
  expect(create).toHaveProperty('disabled', false);
  fireEvent.click(create);
  expect(s.services.store.get().model.armRigs).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
  expect(s.services.store.get().model.armRigs).toBeUndefined();
});
it('代表姿勢は保存データを変えず、ドラッグのプレビューでIKを使う', async () => {
  const s = await setup(),
    saved = JSON.stringify(s.services.store.get());
  fireEvent.click(screen.getByRole('button', { name: '顔の前でピース' }));
  expect(s.services.editor.get().editorParamValues.HandPeaceL).toBe(1);
  expect(JSON.stringify(s.services.store.get())).toBe(saved);
  act(() =>
    armEditor.tool.onPointerDown!({
      canvasPoint: { x: 570, y: 240 },
      screenPoint: { x: 570, y: 240 },
      button: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    }),
  );
  act(() =>
    armEditor.tool.onPointerUp!({
      canvasPoint: { x: 570, y: 240 },
      screenPoint: { x: 570, y: 240 },
      button: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    }),
  );
  expect(s.services.editor.get().editorParamValues.ArmShoulderL).toBeGreaterThan(0);
  expect(JSON.stringify(s.services.store.get())).toBe(saved);
});
it('手首の印を掴んで動かすとIKが変わり、空白のドラッグとクリックだけでは変わらない', async () => {
  const s = await setup();
  fireEvent.click(screen.getByRole('button', { name: '手首をドラッグして確認' }));
  const rig = s.services.store.get().model.armRigs![0]!;
  const wrist = forwardArmInModel(rig, rig.restPose).wrist;
  const view = s.canvas.getState().view;
  const event = (x: number, y: number) => ({
    canvasPoint: { x, y },
    screenPoint: { x: x * view.scale, y: y * view.scale },
    button: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
  });
  const move = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    act(() => {
      armEditor.tool.onPointerDown!(event(from.x, from.y));
      armEditor.tool.onPointerMove!(event(to.x, to.y));
      armEditor.tool.onPointerUp!(event(to.x, to.y));
    });
  const before = s.services.editor.get().editorParamValues;
  move(wrist, wrist);
  expect(s.services.editor.get().editorParamValues).toEqual(before);
  move({ x: -1000, y: -1000 }, { x: -900, y: -900 });
  expect(s.services.editor.get().editorParamValues).toEqual(before);
  move(wrist, { x: wrist.x + 40, y: wrist.y - 50 });
  expect(s.services.editor.get().editorParamValues.ArmShoulderL).not.toBe(before.ArmShoulderL);
  expect(s.services.store.canUndo()).toBe(false);
});
it('代表姿勢・解除・Undoで顔と反対側の確認値を維持し、基準手首角を保存できる', async () => {
  const s = await setup();
  act(() => s.services.editor.set({ editorParamValues: { FaceAngleX: 17, ArmShoulderR: 40 } }));
  fireEvent.click(screen.getByRole('button', { name: 'グー' }));
  expect(s.services.editor.get().editorParamValues.FaceAngleX).toBe(17);
  expect(s.services.editor.get().editorParamValues.ArmShoulderR).toBe(40);
  fireEvent.change(screen.getByLabelText('基準の手首'), { target: { value: 25 } });
  fireEvent.click(screen.getByRole('button', { name: '腕の設定を保存' }));
  expect(s.services.store.get().model.armRigs!.find((r) => r.side === 'L')!.referencePose.wrist).toBe(25);
  fireEvent.click(screen.getByRole('button', { name: '関節設定を解除（素材・キーを残す）' }));
  expect(s.services.editor.get().editorParamValues).toMatchObject({ FaceAngleX: 17, ArmShoulderR: 40 });
  fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
  expect(s.services.editor.get().editorParamValues).toMatchObject({ FaceAngleX: 17, ArmShoulderR: 40 });
});
