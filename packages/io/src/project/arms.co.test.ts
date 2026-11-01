import { expect, it } from 'vitest';
import {
  armParameterIds,
  armParameters,
  createEmptyProject,
  defaultArmLimits,
  defaultArmTrackingSettings,
  type ArmRig,
  type Part,
} from '@app/schema';
import { MemoryFileSystem } from '@app/contracts';
import { createProjectIO } from './projectIO';
import { repairProject } from './repair';

function project() {
  const p = createEmptyProject('腕の保存');
  p.armTracking = defaultArmTrackingSettings();
  p.model.armRigs = [];
  for (const side of ['L', 'R'] as const) {
    const rig: ArmRig = {
      id: side,
      side,
      enabled: true,
      parentPartId: null,
      groups: { shoulder: `s${side}`, elbow: `e${side}`, wrist: `w${side}` },
      joints: { shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 100 }, wrist: { x: 0, y: 180 } },
      lengths: { upper: 100, lower: 80 },
      bendSign: 1,
      referencePose: { shoulder: 0, elbow: 0, wrist: 0 },
      restPose: { shoulder: 8, elbow: 12, wrist: 0 },
      limits: defaultArmLimits(),
      hands: { open: { partIds: [`h${side}`], wrist: { x: 0, y: 180 }, fingerDirection: { x: 0, y: -1 } } },
      restHand: 'open',
      parameters: armParameterIds(side),
    };
    const part = (id: string, parentId: string | null, kind: Part['kind']): Part => ({
      id,
      parentId,
      kind,
      name: id,
      standardType: null,
      assetId: null,
      meshId: null,
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      pivot: { x: 0, y: 0 },
      opacity: 1,
      blendMode: 'normal',
      depth: 0,
      mask: null,
      physicsId: null,
      visible: true,
      locked: false,
    });
    p.model.parts.push(
      part(`s${side}`, null, 'group'),
      part(`e${side}`, `s${side}`, 'group'),
      part(`w${side}`, `e${side}`, 'group'),
      part(`h${side}`, `w${side}`, 'image'),
    );
    p.model.parameters.push(...armParameters(rig));
    p.model.armRigs.push(rig);
    p.model.drawOrder.push(`h${side}`);
    p.armTracking.sides[side].enabled = true;
  }
  return p;
}
it('腕の保存と読込を往復し、設定と固定描画順を保持する', async () => {
  const p = project();
  const io = createProjectIO(new MemoryFileSystem());
  await io.save('/arms', p, {});
  const loaded = await io.load('/arms');
  expect(loaded.project).toEqual(p);
  expect(loaded.report.repairs).toEqual([]);
});
it('左の参照切れだけを無効にし、元データ・右腕・顔を残す', () => {
  const p = project();
  p.model.parts = p.model.parts.filter((x) => x.id !== 'hL');
  const before = structuredClone(p);
  const fixed = repairProject(p);
  expect(p).toEqual(before);
  expect(fixed.project.model.armRigs![0]!.enabled).toBe(false);
  expect(fixed.project.model.armRigs![0]!.hands).toEqual(p.model.armRigs![0]!.hands);
  expect(fixed.project.armTracking!.sides.L.enabled).toBe(false);
  expect(fixed.project.armTracking!.sides.R.enabled).toBe(true);
  expect(fixed.project.model.armRigs![1]).toEqual(p.model.armRigs![1]);
  expect(fixed.project.model.drawOrder).toEqual(p.model.drawOrder);
  expect(fixed.project.trackingSetup).toEqual(p.trackingSetup);
  expect(fixed.repairs.join()).toContain('手の画像');
  expect(repairProject(fixed.project).project).toBe(fixed.project);
});
it('有限だが不正な骨長でもファイルを開き、その側を無効にする', async () => {
  const p = project();
  p.model.armRigs![1]!.lengths.lower = -10;
  const io = createProjectIO(new MemoryFileSystem());
  await io.save('/bad', p, {});
  const loaded = await io.load('/bad');
  expect(loaded.project.model.armRigs![1]!.enabled).toBe(false);
  expect(loaded.project.model.armRigs![0]!.enabled).toBe(true);
  expect(loaded.report.repairs.join()).toContain('骨長');
});
it('リグを削除した側の追従をOFFにする', () => {
  const p = project();
  p.model.armRigs!.shift();
  const fixed = repairProject(p);
  expect(fixed.project.armTracking!.sides.L.enabled).toBe(false);
  expect(fixed.project.armTracking!.sides.R.enabled).toBe(true);
});
