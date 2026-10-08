import { describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator, createDeformPipeline, meshPointsToDisplay } from '@app/core';
import { loadProjectJson, type CurveGuide, type Vec2 } from '@app/schema';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { createEnvSlot } from '../canvas/env';
import { canvasToScreen } from '../../../shell/canvas/view';
import { copyParts, deleteParts } from '../structure/commands';
import { mirrorCopy } from '../structure/mirrorCopy';
import { dynamicsGuideCommand, gravityGuideCommand, patchGuideCommand } from './commands';
import { createCurveEditor } from './curveTool';
import { hairProject } from './testing';
import { enablePhysicsCommand } from '../physics/commands';

function setup() {
  const base = createFakeServices();
  const services = {
    ...base,
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
    keyEditor: createKeyEditor(),
  };
  services.store.load(hairProject());
  services.editor.set({ selectedPartIds: ['hair'] });
  const slot = createEnvSlot();
  const notify = vi.fn();
  const confirm = vi.fn(async () => true);
  const view = { scale: 1, offset: { x: 0, y: 0 } };
  slot.set({
    services,
    dialogs: { notify, confirm },
    view: () => view,
    lastDeformed: () => null,
    requestRedraw: vi.fn(),
  });
  const editor = createCurveEditor(slot);
  const event = (p: Vec2) => ({
    canvasPoint: p,
    screenPoint: canvasToScreen(view, p),
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  });
  const draw = () => {
    editor.tool.onPointerDown!(event({ x: 300, y: 200 }));
    editor.tool.onPointerMove!(event({ x: 300, y: 300 }));
    editor.tool.onPointerUp!(event({ x: 300, y: 400 }));
  };
  const drag = (x = 320) => {
    const start = editor.snapshot()!.evaluated!.result.handles[1]!;
    editor.tool.onPointerDown!(event(start));
    editor.tool.onPointerMove!(event({ x, y: start.y }));
    editor.tool.onPointerUp!(event({ x, y: start.y }));
  };
  return { services, editor, notify, confirm, event, draw, drag };
}

describe('カード99: 流れ線の操作・保護・履歴', () => {
  it('併用中のキー記録は軸の中立姿勢だけを記録し、軸の自動/手動キーと設定を保持する', async () => {
    const s = setup();
    s.draw();
    s.services.store.dispatch(enablePhysicsCommand('hair', { physics: 'ph', transform: 't', vertices: 'v' }));
    s.services.store.dispatch(gravityGuideCommand(s.services.store.get().model.curveGuides![0]!.id, true));
    const guide = s.services.store.get().model.curveGuides![0]!;
    s.services.store.dispatch(dynamicsGuideCommand(guide.id, { enabled: true }));
    const axis = s.services.store.get().physics[0]!.outputParameterId;
    s.services.editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 30 } });
    const neutral = s.editor.snapshot()!.evaluated!.positions;
    s.services.editor.set({ editorParamValues: { FaceAngleZ: 30, [axis]: 0.7 } });
    const before = s.services.store.get();
    const bindings = before.model.bindings.filter((b) => b.parameterIds.includes(axis));
    await s.editor.bake();
    const after = s.services.store.get();
    expect(after.physics).toBe(before.physics);
    expect(after.model.bindings.filter((b) => b.parameterIds.includes(axis))).toEqual(bindings);
    expect(after.model.curveGuides![0]!.enabled).toBe(false);
    expect(after.model.curveGuides![0]!.dynamics).toEqual(before.model.curveGuides![0]!.dynamics);
    const baked = s.services.pipeline.deform(
      after.model,
      s.services.evaluator.evaluate(after.model, { FaceAngleZ: 30, [axis]: 0 }),
    ).byPartId.hair!.positions;
    neutral.forEach((v, i) => expect(baked[i]).toBeCloseTo(v, 3));
    s.services.store.undo();
    expect(s.services.store.get()).toBe(before);
  });
  it('軸の出力キーへの流れ線の記録を拒否する', async () => {
    const s = setup();
    s.draw();
    s.drag();
    s.services.store.dispatch(enablePhysicsCommand('hair', { physics: 'ph', transform: 't', vertices: 'v' }));
    const before = s.services.store.get(),
      axis = before.physics[0]!.outputParameterId;
    s.services.editor.set({ activeParameterIds: [axis], editorParamValues: { [axis]: 0.5 } });
    await s.editor.bake();
    expect(s.services.store.get()).toBe(before);
    expect(s.notify).toHaveBeenCalledWith(expect.stringContaining('軸揺れの出力以外'));
  });
  it('一本なぞって作り、中間を曲げ、各操作を1回のUndo/Redoで戻せる', () => {
    const s = setup();
    const initial = s.services.store.get();
    s.draw();
    const created = s.services.store.get();
    expect(created.model.curveGuides).toHaveLength(1);
    s.drag();
    const edited = s.services.store.get();
    expect(s.editor.snapshot()!.evaluated!.result.handles[1]!.x).toBeCloseTo(320, 3);
    s.services.store.undo();
    expect(s.services.store.get()).toBe(created);
    s.services.store.redo();
    expect(s.services.store.get()).toBe(edited);
    s.services.store.undo();
    s.services.store.undo();
    expect(s.services.store.get()).toBe(initial);
  });
  it('根元と毛先を2回クリックしても線を作れる', () => {
    const s = setup();
    for (const p of [
      { x: 300, y: 200 },
      { x: 300, y: 400 },
    ]) {
      s.editor.tool.onPointerDown!(s.event(p));
      s.editor.tool.onPointerUp!(s.event(p));
    }
    expect(s.services.store.get().model.curveGuides).toHaveLength(1);
  });
  it('ドラッグ中のEscで戻し、ロック中は線も形も変えない', () => {
    const s = setup();
    s.draw();
    const before = s.services.store.get();
    const start = s.editor.snapshot()!.evaluated!.result.handles[1]!;
    s.editor.tool.onPointerDown!(s.event(start));
    s.editor.tool.onPointerMove!(s.event({ x: 315, y: 300 }));
    s.editor.tool.onKeyDown!(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(s.services.store.get()).toBe(before);
    s.services.store.load({
      ...before,
      model: { ...before.model, parts: before.model.parts.map((p) => ({ ...p, locked: true })) },
    });
    const locked = s.services.store.get();
    s.drag();
    expect(s.services.store.get()).toBe(locked);
    expect(s.notify).toHaveBeenCalled();
  });
  it('ドラッグ中に別のプロジェクトを開いても、古い操作を移さない', () => {
    const s = setup();
    s.draw();
    const start = s.editor.snapshot()!.evaluated!.result.handles[1]!;
    s.editor.tool.onPointerDown!(s.event(start));
    s.editor.tool.onPointerMove!(s.event({ x: 315, y: 300 }));
    const other = hairProject();
    s.services.store.load(other);
    s.editor.tool.onPointerMove!(s.event({ x: 320, y: 300 }));
    s.editor.tool.onPointerUp!(s.event({ x: 320, y: 300 }));
    expect(s.services.store.get()).toBe(other);
  });
  it('重力をONにしても対象の軸揺れを保ち、Undoで流れ線だけ戻す。軸を重複作成しない', () => {
    const s = setup();
    s.draw();
    s.services.store.dispatch(enablePhysicsCommand('hair', { physics: 'ph', transform: 't', vertices: 'v' }));
    const before = s.services.store.get();
    const guide = before.model.curveGuides![0]!;
    s.services.store.dispatch(gravityGuideCommand(guide.id, true));
    expect(s.services.store.get().physics).toBe(before.physics);
    const gravity = s.services.store.get();
    s.services.store.dispatch(enablePhysicsCommand('hair', { physics: 'ph2', transform: 't2', vertices: 'v2' }));
    expect(s.services.store.get()).toBe(gravity);
    s.services.store.undo();
    expect(s.services.store.get()).toBe(before);
  });
  it('無効にした重力線を再び使っても既存の軸揺れを保つ', () => {
    const s = setup();
    s.draw();
    const id = s.services.store.get().model.curveGuides![0]!.id;
    s.services.store.dispatch(gravityGuideCommand(id, true));
    s.services.store.dispatch(patchGuideCommand(id, { enabled: false }));
    s.services.store.dispatch(enablePhysicsCommand('hair', { physics: 'ph', transform: 't', vertices: 'v' }));
    expect(s.services.store.get().physics).toHaveLength(1);
    s.services.store.dispatch(patchGuideCommand(id, { enabled: true }));
    expect(s.services.store.get().physics).toHaveLength(1);
  });
  it('描画の途中で同じIDのプロジェクトを再読込しても古い線を入れない', () => {
    const s = setup();
    s.editor.tool.onPointerDown!(s.event({ x: 300, y: 200 }));
    const reloaded = loadProjectJson(JSON.stringify(s.services.store.get()));
    s.services.store.load(reloaded);
    s.editor.tool.onPointerUp!(s.event({ x: 300, y: 400 }));
    expect(s.services.store.get()).toBe(reloaded);
  });
  it('影響幅の連続変更を1回でUndoできる', () => {
    const s = setup();
    s.draw();
    const before = s.services.store.get();
    s.editor.beginOptions();
    s.editor.setOption({ radius: 80 });
    s.editor.setOption({ radius: 90 });
    s.editor.endOptions();
    expect(s.services.store.get().model.curveGuides![0]!.radius).toBe(90);
    s.services.store.undo();
    expect(s.services.store.get()).toBe(before);
  });
  it('保存して再編集でき、コピー・左右反転・削除で線の対象を保持する', () => {
    const s = setup();
    s.draw();
    s.drag();
    const before = s.services.store.get();
    s.services.store.load(loadProjectJson(JSON.stringify(before)));
    s.drag(325);
    let n = 0;
    const ids = () => `copy-${n++}`;
    s.services.store.dispatch(copyParts(['hair'], { newId: ids }));
    const copy = s.services.store.get().model.curveGuides!.find((g) => g.partId !== 'hair')!;
    expect(copy.id).not.toBe(before.model.curveGuides![0]!.id);
    expect(copy.meshId).not.toBe('m');
    s.services.store.dispatch(deleteParts([copy.partId]));
    expect(s.services.store.get().model.curveGuides).toHaveLength(1);
    s.services.store.dispatch(mirrorCopy(['hair'], { centerX: 300, assets: [], assetMap: {} }, { newId: ids }));
    const mirrored = s.services.store.get().model.curveGuides!.find((g) => g.partId !== 'hair')!;
    expect(mirrored.points[1].x).toBeCloseTo(275, 3);
    expect(
      s.services.pipeline.deform(s.services.store.get().model, { transforms: {}, vertices: {}, warpPoints: {} })
        .curveGuides![mirrored.id]!.status,
    ).toBe('ok');
  });
  it('現在のキーに記録し、他のキーを保持し、流れ線の二重適用を解除する', async () => {
    const s = setup();
    s.draw();
    s.drag();
    s.services.editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 30 } });
    const before = s.services.store.get();
    const target = s.editor.snapshot()!.evaluated!.positions.slice();
    await s.editor.bake();
    const after = s.services.store.get();
    expect(after.model.curveGuides![0]!.enabled).toBe(false);
    expect(after.model.bindings.find((b) => b.id === 'head-roll')).toEqual(
      before.model.bindings.find((b) => b.id === 'head-roll'),
    );
    const params = { FaceAngleZ: 30 };
    const result = s.services.pipeline.deform(after.model, s.services.evaluator.evaluate(after.model, params)).byPartId
      .hair!.positions;
    target.forEach((p, i) => expect(result[i]).toBeCloseTo(p, 3));
    s.services.store.undo();
    expect(s.services.store.get()).toBe(before);
  });
  it('lockedの頂点キーへは記録せず、線も解除しない', async () => {
    const s = setup();
    s.draw();
    s.drag();
    s.services.editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 30 } });
    const before = s.services.store.get();
    const meshKey = s.services.keyEditor
      .addKeyAtCurrentValue(before, s.services.editor.get(), { kind: 'mesh', meshId: 'm' })
      .apply(before);
    const locked = {
      ...meshKey,
      model: {
        ...meshKey.model,
        bindings: meshKey.model.bindings.map((b) =>
          b.channel === 'vertices' ? { ...b, keys: b.keys.map((k) => ({ ...k, locked: true })) } : b,
        ),
      },
    };
    s.services.store.load(locked);
    await s.editor.bake();
    expect(s.services.store.get()).toBe(locked);
  });
  it('親ワープと反転のある姿勢から描き、曲げた見た目をキーに記録できる', async () => {
    const s = setup();
    const project = s.services.store.get();
    project.model.parts[0]!.scale = { x: -1.2, y: 0.8 };
    project.model.warps = [
      {
        id: 'w',
        partId: 'head',
        columns: 1,
        rows: 1,
        bounds: { x: 290, y: 200, width: 20, height: 200 },
        points: [
          { x: 290, y: 200 },
          { x: 310, y: 200 },
          { x: 305, y: 400 },
          { x: 325, y: 400 },
        ],
      },
    ];
    s.services.store.load(project);
    s.services.editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 20 } });
    const raw = s.editor.snapshot()!.raw!;
    const visible = meshPointsToDisplay(project.model.meshes[0]!, raw.positions, [
      { x: 300, y: 200 },
      { x: 300, y: 300 },
      { x: 300, y: 400 },
    ]);
    s.editor.tool.onPointerDown!(s.event(visible[0]!));
    s.editor.tool.onPointerMove!(s.event(visible[1]!));
    s.editor.tool.onPointerUp!(s.event(visible[2]!));
    expect(s.services.store.get().model.curveGuides![0]!.reference[1].x).toBeCloseTo(300, 3);
    const middle = s.editor.snapshot()!.evaluated!.result.handles[1]!;
    s.editor.tool.onPointerDown!(s.event(middle));
    s.editor.tool.onPointerMove!(s.event({ ...middle, x: middle.x + 5 }));
    s.editor.tool.onPointerUp!(s.event({ ...middle, x: middle.x + 5 }));
    const before = s.services.store.get(),
      target = s.editor.snapshot()!.evaluated!.positions.slice();
    await s.editor.bake();
    const after = s.services.store.get();
    expect(after.model.curveGuides![0]!.enabled).toBe(false);
    const positions = s.services.pipeline.deform(
      after.model,
      s.services.evaluator.evaluate(after.model, { FaceAngleZ: 20 }),
    ).byPartId.hair!.positions;
    target.forEach((v, i) => expect(positions[i]).toBeCloseTo(v, 3));
    s.services.store.undo();
    expect(s.services.store.get()).toBe(before);
  });
  it('基準姿勢と別のパラメータのプレビュー中は記録を拒否する', async () => {
    const s = setup();
    s.draw();
    s.drag();
    const before = s.services.store.get();
    s.services.editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 0 } });
    await s.editor.bake();
    expect(s.services.store.get()).toBe(before);
    s.services.editor.set({
      activeParameterIds: ['FaceAngleZ'],
      editorParamValues: { FaceAngleZ: 30, FaceAngleX: 20 },
    });
    await s.editor.bake();
    expect(s.services.store.get()).toBe(before);
    expect(s.notify).toHaveBeenCalledTimes(2);
  });
  it.each(['cancel', 'reload', 'selection', 'approve'] as const)(
    '既存キーの間への記録: %s、古いキーと履歴を保つ',
    async (action) => {
      const s = setup();
      s.draw();
      s.drag();
      s.services.editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 30 } });
      const before = s.services.store.get();
      s.services.store.load(
        s.services.keyEditor
          .addKeyAtCurrentValue(before, s.services.editor.get(), { kind: 'mesh', meshId: 'm' })
          .apply(before),
      );
      s.services.editor.set({ editorParamValues: { FaceAngleZ: 15 } });
      const original = s.services.store.get();
      const oldKeys = original.model.bindings.find((b) => b.channel === 'vertices')!.keys;
      let answer!: (ok: boolean) => void;
      s.confirm.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          }),
      );
      const pending = s.editor.bake();
      expect(s.confirm).toHaveBeenCalledWith('この値にキーを追加して編集しますか？');
      let expected = original;
      if (action === 'reload') {
        expected = loadProjectJson(JSON.stringify(original));
        s.services.store.load(expected);
      }
      if (action === 'selection') s.services.editor.set({ selectedPartIds: ['head'] });
      answer(action !== 'cancel');
      await pending;
      if (action !== 'approve') {
        expect(s.services.store.get()).toBe(expected);
        return;
      }
      expect(s.services.store.get().model.curveGuides![0]!.enabled).toBe(false);
      const keys = s.services.store.get().model.bindings.find((b) => b.channel === 'vertices')!.keys;
      for (const key of oldKeys) expect(keys.find((k) => k.coords[0] === key.coords[0])).toEqual(key);
      s.services.store.undo();
      expect(s.services.store.get()).toBe(original);
    },
  );
  it('メッシュ変更後の線は失効し、設定の変更を拒否する', () => {
    const s = setup();
    s.draw();
    const before = s.services.store.get();
    const g = before.model.curveGuides![0] as CurveGuide;
    const next = {
      ...before,
      model: {
        ...before.model,
        meshes: before.model.meshes.map((m) => ({ ...m, vertices: m.vertices.map((p) => ({ ...p, x: p.x + 1 })) })),
      },
    };
    s.services.store.load(next);
    expect(s.editor.snapshot()!.evaluated!.result.status).toBe('stale');
    s.services.store.dispatch(patchGuideCommand(g.id, { gravity: true }));
    expect(s.services.store.get()).toBe(next);
  });
});
