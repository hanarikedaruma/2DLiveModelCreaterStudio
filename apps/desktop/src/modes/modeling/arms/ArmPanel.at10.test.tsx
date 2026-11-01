// AT-10 の独立確認（CL、2026-11-01）。モデリングの「腕・手の設定」の画面で、保存するまでプロジェクトを変えないこと、
// 保存・顔より前・解除が1回ずつのUndoで戻ること、素材が足りないと作成できないことを確かめる
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createArmTrackingFixture, createBindingEvaluator, createDeformPipeline, forwardArmInModel } from '@app/core';
import type { Project } from '@app/schema';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { createCanvasController } from '../../../shell/canvas/controller';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { armEditor, register } from './index';

beforeEach(() => registry.reset());

async function open(project: Project) {
  register();
  const services = {
    ...createFakeServices(),
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
  };
  const canvas = createCanvasController();
  const environment = createEnvironmentStore(memoryEnvironmentStorage());
  render(<Shell services={services} environment={environment} canvas={canvas} />);
  await act(async () => {
    await environment.load();
    services.store.load(project);
    services.editor.set({ mode: 'modeling' });
    canvas.setActiveTool('modeling.arms');
  });
  return services;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pointer = (x: number, y: number) => ({
  canvasPoint: { x, y },
  screenPoint: { x, y },
  button: 0,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
});

describe('AT-10 独立確認: 腕・手の設定の画面', () => {
  it('代表姿勢・手振りの再生・手首のドラッグ・数値の書きかけでは、プロジェクトを変えない（Undo も積まない）', async () => {
    const services = await open(createArmTrackingFixture());
    const saved = JSON.stringify(services.store.get());
    for (const name of ['休止', '手振り', '指さし', '顔の前でピース', 'グー']) {
      click(name);
      expect(JSON.stringify(services.store.get()), name).toBe(saved);
    }
    click('手振りを再生');
    click('手振りを停止');
    act(() => armEditor.tool.onPointerDown!(pointer(560, 260)));
    act(() => armEditor.tool.onPointerMove?.(pointer(540, 200)));
    act(() => armEditor.tool.onPointerUp!(pointer(540, 200)));
    fireEvent.change(screen.getByLabelText('肘 X'), { target: { value: 999 } });
    expect(JSON.stringify(services.store.get())).toBe(saved);
    expect(services.store.canUndo()).toBe(false);
  });

  it('キャンバスを押して離すだけ（ドラッグなし）では関節の数値が動かない', async () => {
    const services = await open(createArmTrackingFixture());
    click('手首をドラッグして確認');
    const before = { ...services.editor.get().editorParamValues };
    const rig = services.store.get().model.armRigs![0]!;
    const far = { x: rig.joints.shoulder.x + 1000, y: rig.joints.shoulder.y + 1000 };
    act(() => armEditor.tool.onPointerDown!(pointer(far.x, far.y)));
    act(() => armEditor.tool.onPointerUp!(pointer(far.x, far.y)));
    for (const id of [rig.parameters.shoulder, rig.parameters.elbow])
      expect(services.editor.get().editorParamValues[id] ?? null).toBe(before[id] ?? null);
  });

  it('顔より前・解除は、それぞれ1回の「元に戻す」で戻る', async () => {
    const services = await open(createArmTrackingFixture());
    const start = services.store.get();
    click('前腕・手を顔より前へ');
    const front = services.store.get();
    expect(front.model.drawOrder).not.toEqual(start.model.drawOrder);
    click('関節設定を解除（素材・キーを残す）');
    expect(services.store.get().model.armRigs?.length ?? 0).toBe(1); // 2本のうち選んでいる側だけ外す
    click('元に戻す');
    expect(services.store.get()).toEqual(front);
    click('元に戻す');
    expect(services.store.get()).toEqual(start);
  });

  it('リグの無いモデルでは、素材が足りない間は作成できず、足りない理由を出す', async () => {
    const p = createArmTrackingFixture();
    delete p.model.armRigs;
    p.model.parts = p.model.parts
      .filter((x) => !/^(shoulder|elbow|wrist)-/.test(x.id))
      .map((x) => (x.id === 'body-root' ? x : { ...x, parentId: 'body-root' }));
    const services = await open(p);
    expect(screen.getByRole('button', { name: '専用関節を作成' })).toHaveProperty('disabled', true);
    expect(screen.getByText('上腕と前腕の素材をそれぞれ選ぶ')).toBeTruthy();
    expect(screen.getByText('休止形に使うパーの素材を選ぶ')).toBeTruthy();
    expect(services.store.get().model.armRigs).toBeUndefined();
  });

  it('関節の配置中も、キャンバスを押して離すだけでは選んでいる関節（肩）の数値が動かない', async () => {
    const p = createArmTrackingFixture();
    delete p.model.armRigs;
    p.model.parts = p.model.parts
      .filter((x) => !/^(shoulder|elbow|wrist)-/.test(x.id))
      .map((x) => (x.id === 'body-root' ? x : { ...x, parentId: 'body-root' }));
    await open(p);
    const x = () => (screen.getByLabelText('肩 X') as HTMLInputElement).value;
    const before = x();
    act(() => armEditor.tool.onPointerDown!(pointer(5, 5)));
    act(() => armEditor.tool.onPointerUp!(pointer(5, 5)));
    expect(x()).toBe(before);
  });
});

// AT-10 CO v2 の再確認（CL、2026-11-01）。印の近くを押して動かしたときだけ動くこと、他の確認値を消さないこと、指方向の初期値
describe('AT-10 再確認（CO v2）: 画面', () => {
  async function openAt(project: Project) {
    register();
    const services = {
      ...createFakeServices(),
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    };
    const canvas = createCanvasController();
    const environment = createEnvironmentStore(memoryEnvironmentStorage());
    render(<Shell services={services} environment={environment} canvas={canvas} />);
    await act(async () => {
      await environment.load();
      services.store.load(project);
      services.editor.set({ mode: 'modeling' });
      canvas.setActiveTool('modeling.arms');
      canvas.setView({ scale: 2, offset: { x: 0, y: 0 } }); // 画面の1px = キャンバスの0.5
    });
    return services;
  }
  // canvasPoint はキャンバス座標、screen は画面の px（ドラッグの距離に使う）
  const at = (canvas: { x: number; y: number }, screen: { x: number; y: number }) => ({
    canvasPoint: canvas,
    screenPoint: screen,
    button: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
  });

  it('確認中の手首：印から10px以内を押して3px以上動かしたときだけIKが動き、2pxや印から離れた所からのドラッグでは動かない', async () => {
    const services = await openAt(createArmTrackingFixture());
    click('手首をドラッグして確認');
    const rig = services.store.get().model.armRigs!.find((r) => r.side === 'L')!;
    const wrist = forwardArmInModel(rig, rig.restPose).wrist; // 体（body-root）は恒等
    const shoulderOf = () => services.editor.get().editorParamValues[rig.parameters.shoulder] ?? null;
    const base = shoulderOf();
    // 2px だけ動かす → 動かない
    act(() => armEditor.tool.onPointerDown!(at({ x: wrist.x + 3, y: wrist.y }, { x: 100, y: 100 })));
    act(() => armEditor.tool.onPointerMove!(at({ x: wrist.x + 4, y: wrist.y }, { x: 102, y: 100 })));
    act(() => armEditor.tool.onPointerUp!(at({ x: wrist.x + 4, y: wrist.y }, { x: 102, y: 100 })));
    expect(shoulderOf()).toBe(base);
    // 印から 6 キャンバス単位（画面 12px）離れた所から大きくドラッグ → 動かない
    act(() => armEditor.tool.onPointerDown!(at({ x: wrist.x + 6, y: wrist.y }, { x: 100, y: 100 })));
    act(() => armEditor.tool.onPointerMove!(at({ x: wrist.x + 60, y: wrist.y - 80 }, { x: 208, y: -60 })));
    act(() => armEditor.tool.onPointerUp!(at({ x: wrist.x + 60, y: wrist.y - 80 }, { x: 208, y: -60 })));
    expect(shoulderOf()).toBe(base);
    // 印の上（画面4px以内）を押して大きく動かす → 動く
    act(() => armEditor.tool.onPointerDown!(at({ x: wrist.x + 2, y: wrist.y }, { x: 100, y: 100 })));
    act(() => armEditor.tool.onPointerMove!(at({ x: wrist.x + 60, y: wrist.y - 80 }, { x: 216, y: -60 })));
    act(() => armEditor.tool.onPointerUp!(at({ x: wrist.x + 60, y: wrist.y - 80 }, { x: 216, y: -60 })));
    expect(shoulderOf()).not.toBe(base);
    // 解いた姿勢の手首が、ドラッグした所（キャンバス座標）に来る
    const v = services.editor.get().editorParamValues;
    const solved = forwardArmInModel(rig, {
      shoulder: v[rig.parameters.shoulder]!,
      elbow: v[rig.parameters.elbow]!,
      wrist: v[rig.parameters.wrist] ?? rig.restPose.wrist,
    }).wrist;
    expect(Math.hypot(solved.x - (wrist.x + 60), solved.y - (wrist.y - 80))).toBeLessThan(1);
  });

  it('代表姿勢・解除・元に戻すで、顔と反対の腕の確認値を消さない', async () => {
    const services = await openAt(createArmTrackingFixture());
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 12, ArmShoulderR: 50 } }));
    const kept = () => {
      const v = services.editor.get().editorParamValues;
      return [v.FaceAngleX, v.ArmShoulderR];
    };
    click('顔の前でピース');
    expect(services.editor.get().editorParamValues.HandPeaceL).toBe(1);
    expect(kept()).toEqual([12, 50]);
    click('手振りを再生');
    click('手振りを停止');
    expect(kept()).toEqual([12, 50]);
    click('関節設定を解除（素材・キーを残す）');
    expect(kept()).toEqual([12, 50]);
    click('元に戻す');
    expect(kept()).toEqual([12, 50]);
  });

  it('リグの無いモデルで、手の指方向の初期値は前腕の向き', async () => {
    const p = createArmTrackingFixture();
    delete p.model.armRigs;
    p.model.parts = p.model.parts
      .filter((x) => !/^(shoulder|elbow|wrist)-/.test(x.id))
      .map((x) => (x.id === 'body-root' ? x : { ...x, parentId: 'body-root' }));
    await openAt(p);
    const set = (label: string, value: number) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set('肩 X', 300);
    set('肩 Y', 200);
    set('肘 X', 340);
    set('肘 Y', 300);
    set('手首 X', 340);
    set('手首 Y', 400);
    // 肘→手首は真下（画面の角度 90°）
    expect((screen.getByLabelText('パー 指方向') as HTMLInputElement).value).toBe('90');
  });
});
