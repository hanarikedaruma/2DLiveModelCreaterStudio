import { expect, it } from 'vitest';
import { inspectArmRigs, loadProjectJson } from '@app/schema';
import { makeArmFixture } from '../../joint/evaluate/testing';
import { createProjectStore } from '../../store';
import { createAutoSetup } from '../autoSetup';
import { armInFront, armSetupPointMapper, planArmSetup, releaseArmRig } from './commands';

function unrig() {
  const p = makeArmFixture();
  delete p.model.armRigs;
  p.model.parts = p.model.parts
    .filter((x) => !/^(shoulder|elbow|wrist)-/.test(x.id))
    .map((x) => (x.id === 'body-root' ? x : { ...x, parentId: 'body-root' }));
  return p;
}
const input = () => ({
  side: 'L' as const,
  parentPartId: 'body-root',
  upperPartIds: ['upper-L'],
  forearmPartIds: ['lower-L'],
  joints: { shoulder: { x: 378, y: 240 }, elbow: { x: 378, y: 358 }, wrist: { x: 378, y: 466 } },
  hands: Object.fromEntries(
    (['open', 'fist', 'point', 'peace'] as const).map((shape) => [
      shape,
      { partIds: [`${shape}-L`], wrist: { x: 378, y: 466 }, fingerDirection: { x: 0, y: -1 } },
    ]),
  ),
});
it('素材を専用関節へ付け、保存とUndo/Redoが同じモデルになる', () => {
  const p = unrig(),
    before = JSON.stringify(p),
    plan = planArmSetup(p, input());
  expect(plan.errors).toEqual([]);
  expect(plan.command).not.toBeNull();
  expect(plan.command!.apply({ ...p, name: '計画後に変更した名前' }).name).toBe('計画後に変更した名前');
  const store = createProjectStore(p);
  store.dispatch(plan.command!);
  expect(inspectArmRigs(store.get().model).filter((i) => i.severity === 'error')).toEqual([]);
  expect(loadProjectJson(JSON.stringify(store.get()))).toEqual(store.get());
  const applied = store.get();
  store.undo();
  expect(store.get()).toEqual(p);
  store.redo();
  expect(store.get()).toEqual(applied);
  expect(JSON.stringify(p)).toBe(before);
});
it('不足・重複・既存の手動キーを変更せずに止める', () => {
  const p = unrig(),
    data = input();
  data.forearmPartIds = [];
  expect(planArmSetup(p, data).command).toBeNull();
  data.forearmPartIds = ['upper-L'];
  expect(planArmSetup(p, data).errors.join()).toContain('複数');
  data.forearmPartIds = ['lower-L'];
  p.model.bindings.push({
    id: 'manual',
    target: { type: 'part', id: 'upper-L' },
    channel: 'transform',
    parameterIds: ['ArmL'],
    keyValues: [[0]],
    keys: [],
    generation: 'linear',
    divisions: null,
  });
  const before = JSON.stringify(p);
  expect(planArmSetup(p, data).errors.join()).toContain('既存のキー');
  expect(JSON.stringify(p)).toBe(before);
});
it('確定済みの腕は全体の自動セットアップで作り直さない', () => {
  const p = unrig(),
    setup = planArmSetup(p, input());
  const installed = setup.command!.apply(p);
  const next = createAutoSetup().plan(installed).command.apply(installed);
  const rig = installed.model.armRigs![0]!;
  expect(next.model.armRigs).toEqual(installed.model.armRigs);
  for (const id of [...Object.values(rig.groups), 'upper-L', 'lower-L', 'open-L'])
    expect(next.model.parts.find((p) => p.id === id)).toEqual(installed.model.parts.find((p) => p.id === id));
  expect(next.model.drawOrder.slice(0, installed.model.drawOrder.length)).toEqual(installed.model.drawOrder);
});
it('前腕・手だけを明示的に前へ置き、解除しても素材とキーを残す', () => {
  const p = unrig(),
    installed = planArmSetup(p, input()).command!.apply(p),
    rig = installed.model.armRigs![0]!;
  const front = armInFront(rig.id).apply(installed);
  expect(front.model.drawOrder.indexOf('lower-L')).toBeGreaterThan(front.model.drawOrder.indexOf('face'));
  const cleared = releaseArmRig(rig.id).apply(front);
  expect(cleared.model.parts.some((p) => p.id === 'upper-L')).toBe(true);
  expect(cleared.model.bindings).toEqual(front.model.bindings);
  expect(cleared.model.armRigs).toEqual([]);
  expect(cleared.model.parts.find((p) => p.id === 'fist-L')!.visible).toBe(false);
  expect(cleared.model.parts.find((p) => p.id === 'open-L')!.visible).toBe(true);
  expect(planArmSetup(cleared, input()).command).not.toBeNull();
});
it('回転・等倍率の親の表示位置を既存の逆変換で基準座標へ戻す', () => {
  const p = unrig();
  p.model.parts[0]!.rotation = 90;
  p.model.parts[0]!.scale = { x: 2, y: 2 };
  const mapper = armSetupPointMapper(p.model, 'body-root', [{ x: 10, y: 20 }]);
  const result = mapper([{ x: -40, y: 20 }]);
  expect(result![0]!.x).toBeCloseTo(10, 6);
  expect(result![0]!.y).toBeCloseTo(20, 6);
});
it('基準画像の手首の曲がりを指定し、範囲外・非有限の角度は保存しない', () => {
  const p = unrig();
  const plan = planArmSetup(p, { ...input(), referenceWristAngle: 25 });
  expect(plan.errors).toEqual([]);
  const installed = plan.command!.apply(p);
  expect(installed.model.armRigs![0]!.referencePose.wrist).toBe(25);
  expect(loadProjectJson(JSON.stringify(installed)).model.armRigs![0]!.referencePose.wrist).toBe(25);
  for (const angle of [100, NaN, Infinity])
    expect(planArmSetup(p, { ...input(), referenceWristAngle: angle }).command).toBeNull();
});
