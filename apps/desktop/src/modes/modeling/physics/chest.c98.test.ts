import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { validateProject } from '@app/schema';
import { bounceReason, createBindingEvaluator, createDeformPipeline, createProjectStore } from '@app/core';
import {
  changePhysicsKindCommand,
  disablePhysicsCommand,
  enableChestCommand,
  isParameterUsed,
  rebuildSwayCommand,
} from './commands';
import { copyParts, canMoveTo } from '../structure/commands';
import { mirrorCopy } from '../structure/mirrorCopy';
import { treeRows } from '../structure/StructureTab';
import { removeParameterCommand, parameterUsage } from '../userParams/userParams';
import { simulateSwayPreview } from './preview';
import { createKeyEditor } from '../../../services/keyEditor';
import { meshKeySpace } from '../../../services/keyEditor/points';
import { editorAt } from '../../../services/keyEditor/testing';

const fixture = () =>
  validateProject(
    JSON.parse(
      readFileSync(new NodeURL('../../../../../../fixtures/chest-model/project.json', import.meta.url), 'utf8'),
    ),
  );
const ids = { physics: 'new-physics', transform: 'new-x', vertices: 'new-y' };
const counter = () => {
  let n = 0;
  return () => `copy-${++n}`;
};
describe('胸の設定・履歴・複製・編集', () => {
  it('OFF→ONでも空いた標準出力を再利用し、出力を増殖させない', () => {
    const p = fixture(),
      off = disablePhysicsCommand('chest').apply(p),
      on = enableChestCommand('chest', { physics: 'p', horizontal: 'x', vertical: 'y' }).apply(off);
    expect(on.physics[0]!.outputParameterId).toBe('BustX');
    expect(on.physics[0]!.verticalOutputParameterId).toBe('BustY');
    expect(on.model.parameters).toEqual(p.model.parameters);
  });
  it('方式変更は物理と2出力のキーを一括で変更し、Undo/Redoで戻る', () => {
    const p = fixture(),
      store = createProjectStore(p);
    store.dispatch(changePhysicsKindCommand('chest', 'cloth', ids));
    expect(store.get().physics[0]!.deform).toBe('swing');
    expect(store.get().model.bindings.some((b) => b.id === 'chest-x' || b.id === 'chest-y')).toBe(false);
    store.undo();
    expect(store.get()).toEqual(p);
    store.redo();
    store.dispatch(changePhysicsKindCommand('chest', 'chest', ids));
    const next = store.get();
    expect(next.physics[0]!.deform).toBe('bounce');
    expect(next.model.bindings.filter((b) => b.vertexSpace === 'model')).toHaveLength(2);
    expect(bounceReason(next, next.physics[0]!)).toBeUndefined();
  });
  it('lockedなら方式切替を中止し、OFFでも手編集と2出力の参照を残す', () => {
    const p = fixture();
    p.model.bindings.find((b) => b.id === 'chest-x')!.keys[2]!.locked = true;
    const before = JSON.stringify(p);
    expect(() => changePhysicsKindCommand('chest', 'hair', ids).apply(p)).toThrow(/ロック/);
    expect(JSON.stringify(p)).toBe(before);
    const off = disablePhysicsCommand('chest').apply(p);
    expect(off.physics).toEqual([]);
    expect(off.model.bindings.some((b) => b.id === 'chest-x')).toBe(true);
    expect(off.model.bindings.some((b) => b.id === 'chest-y')).toBe(false);
    expect(off.model.parts.find((p) => p.id === 'chest')!.parentId).toBe('torso');
    expect(isParameterUsed(p, 'BustY')).toBe(true);
  });
  it('再生成は保存した基準を使い、カスタム値はプリセットの選択で戻せる', () => {
    const p = fixture();
    p.physics[0]!.spring = 80;
    const rebuilt = rebuildSwayCommand('chest', ids).apply(p);
    expect(rebuilt.physics[0]!.spring).toBe(80);
    const preset = changePhysicsKindCommand('chest', 'chest', ids).apply(rebuilt);
    expect(preset.physics[0]!.spring).toBe(120);
  });
  it.each([false, true])('複製 (%s=反転) は独立した出力・所有キーを持ち、正のXは右へ動く', (mirror) => {
    const p = fixture();
    const next = (
      mirror
        ? mirrorCopy(['chest'], { centerX: 256, assets: [], assetMap: {} }, { newId: counter() })
        : copyParts(['chest'], { newId: counter() })
    ).apply(p);
    const item = next.physics[1]!;
    expect(item.outputParameterId).not.toBe('BustX');
    expect(item.verticalOutputParameterId).not.toBe('BustY');
    expect(item.bounce!.bindingIds).not.toEqual(p.physics[0]!.bounce!.bindingIds);
    expect(bounceReason(next, item)).toBeUndefined();
    const ev = createBindingEvaluator(),
      pipeline = createDeformPipeline();
    const base = pipeline.deform(next.model, ev.evaluate(next.model, {})).byPartId[item.partId]!.positions;
    const moved = pipeline.deform(
      next.model,
      ev.evaluate(next.model, { [item.outputParameterId]: 1, [item.verticalOutputParameterId!]: 1 }),
    ).byPartId[item.partId]!.positions;
    const free = item.bounce!.weights.indexOf(1);
    expect(moved[free * 2]! - base[free * 2]!).toBeGreaterThan(0);
    expect(moved[free * 2 + 1]! - base[free * 2 + 1]!).toBeGreaterThan(0);
    expect(validateProject(next)).toEqual(next);
  });
  it('手編集した胸の反転は中止し、通常複製はそのキーを保存する', () => {
    const p = fixture();
    p.model.bindings.find((b) => b.id === 'chest-y')!.keys[2]!.source = 'manual';
    expect(() =>
      mirrorCopy(['chest'], { centerX: 256, assets: [], assetMap: {} }, { newId: counter() }).apply(p),
    ).toThrow(/手編集/);
    const next = copyParts(['chest'], { newId: counter() }).apply(p);
    const owned = next.physics[1]!.bounce!.bindingIds[1];
    expect(next.model.bindings.find((b) => b.id === owned)!.keys[2]!.source).toBe('manual');
  });
  it('上下の専用出力の利用を数え、削除で物理とパーツの参照を外す', () => {
    const p = copyParts(['chest'], { newId: counter() }).apply(fixture()),
      item = p.physics[1]!,
      id = item.verticalOutputParameterId!;
    expect(parameterUsage(p, id).physicsOutputs).toBe(1);
    const next = removeParameterCommand(id).apply(p);
    expect(next.physics.some((p) => p.id === item.id)).toBe(false);
    expect(next.model.parts.find((p) => p.id === item.partId)!.physicsId).toBeNull();
  });
  it('胴体の画像を親にでき、胸はその子として一覧に表示する', () => {
    const p = fixture();
    expect(canMoveTo(p.model, ['chest'], 'torso')).toBe(true);
    expect(canMoveTo(p.model, ['armL'], 'torso')).toBe(false);
    const rows = treeRows(p.model, new Set());
    expect(rows.find((r) => r.part.id === 'chest')!.depth).toBe(2);
    expect(treeRows(p.model, new Set(['torso'])).some((r) => r.part.id === 'chest')).toBe(false);
  });
  it('モデル座標でキーを編集し、固定点の差分は0のままにする', () => {
    const p = fixture(),
      b = p.physics[0]!.bounce!,
      editor = editorAt({ BustY: 1 }),
      keyEditor = createKeyEditor();
    expect(meshKeySpace(p, editor, b.meshId)).toBe('model');
    const free = b.weights.indexOf(1),
      result = keyEditor.pointsEdit(p, editor, { kind: 'mesh', meshId: b.meshId }, [
        { index: 0, d: { x: 7, y: 9 } },
        { index: free, d: { x: 3, y: 5 } },
      ]);
    if (result === 'needsKey') throw new Error('既存のキー');
    const next = result.apply(p);
    const after = next.model.bindings.find((v) => v.id === b.bindingIds[1])!,
      before = p.model.bindings.find((v) => v.id === b.bindingIds[1])!;
    expect(after.vertexSpace).toBe('model');
    const delta = after.keys[2]!.delta;
    if (!Array.isArray(delta)) throw new Error('頂点の差分');
    expect(delta[0]).toEqual({ x: 0, y: 0 });
    expect(delta[free]!.x).toBe(3);
    expect(delta[free]!.y - (before.keys[2]!.delta as { x: number; y: number }[])[free]!.y).toBe(5);
    expect(bounceReason(next, next.physics[0]!)).toBeUndefined();
    expect(() => enableChestCommand('chest', { physics: 'p', horizontal: 'x', vertical: 'y' }).apply(next)).toThrow(
      /手で編集/,
    );
  });
  it('左右・上下のお試しは指定したモデル方向だけを動かす', () => {
    const p = fixture();
    const horizontal = simulateSwayPreview(p, p.physics[0]!.id, 3.2, 'horizontal')!.frames;
    const vertical = simulateSwayPreview(p, p.physics[0]!.id, 3.2, 'vertical')!.frames;
    expect(horizontal.some((p) => Math.abs(p.BustX ?? 0) > 0.01)).toBe(true);
    expect(horizontal.every((p) => Math.abs(p.BustY ?? 0) < 1e-8)).toBe(true);
    expect(vertical.some((p) => Math.abs(p.BustY ?? 0) > 0.01)).toBe(true);
    expect(vertical.every((p) => Math.abs(p.BustX ?? 0) < 1e-8)).toBe(true);
  });
});
