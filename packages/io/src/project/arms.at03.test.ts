// AT-03 の独立確認（CL）。開くときの修復で、意味の壊れた片腕だけを無効にし、反対側・顔・他の設定を保つこと。
import { MemoryFileSystem } from '@app/contracts';
import {
  armParameterIds,
  armParameters,
  createEmptyProject,
  defaultArmLimits,
  type ArmRig,
  type ArmSide,
  type ArmTrackingSettings,
  type Part,
  type Project,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createProjectIO } from './projectIO';
import { repairProject } from './repair';

const D = Math.PI / 180;
const SHAPES = ['open', 'fist', 'point', 'peace'] as const;

function part(id: string, kind: Part['kind'], parentId: string | null): Part {
  return {
    id,
    name: id,
    kind,
    standardType: null,
    assetId: null,
    meshId: null,
    parentId,
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
  };
}

function rig(side: ArmSide): ArmRig {
  const s = side.toLowerCase();
  const k = side === 'L' ? 1 : -1;
  const shoulder = { x: 78 * k, y: 240 };
  const elbow = { x: shoulder.x + k * 118 * Math.sin(8 * D), y: 240 + 118 * Math.cos(8 * D) };
  const wrist = { x: elbow.x + k * 108 * Math.sin(20 * D), y: elbow.y + 108 * Math.cos(20 * D) };
  return {
    id: `rig-${s}`,
    side,
    enabled: true,
    parentPartId: 'body',
    groups: { shoulder: `sh-${s}`, elbow: `el-${s}`, wrist: `wr-${s}` },
    joints: { shoulder, elbow, wrist },
    lengths: { upper: 118, lower: 108 },
    bendSign: 1,
    referencePose: { shoulder: 8, elbow: 12, wrist: 0 },
    restPose: { shoulder: 8, elbow: 12, wrist: 0 },
    limits: defaultArmLimits(),
    hands: Object.fromEntries(
      SHAPES.map((shape) => [shape, { partIds: [`hand-${shape}-${s}`], wrist, fingerDirection: { x: 0, y: 1 } }]),
    ),
    restHand: 'open',
    parameters: armParameterIds(side),
  };
}

const tracking = (L: boolean, R: boolean): ArmTrackingSettings => ({
  mode: 'normal',
  sides: {
    L: { enabled: L, gain: 1.1, smoothing: 0.4, handMode: 'auto', restHand: 'open' },
    R: { enabled: R, gain: 0.9, smoothing: 0.6, handMode: 'point', restHand: 'fist' },
  },
});

function armProject(): Project {
  const project = createEmptyProject('腕');
  const parts: Part[] = [part('body', 'group', null)];
  for (const s of ['l', 'r']) {
    parts.push(
      part(`sh-${s}`, 'group', 'body'),
      part(`el-${s}`, 'group', `sh-${s}`),
      part(`wr-${s}`, 'group', `el-${s}`),
    );
    for (const shape of SHAPES) parts.push(part(`hand-${shape}-${s}`, 'image', `wr-${s}`));
  }
  const rigs = [rig('L'), rig('R')];
  return {
    ...project,
    model: {
      ...project.model,
      parts,
      drawOrder: parts.filter((p) => p.kind === 'image').map((p) => p.id),
      parameters: [...project.model.parameters, ...rigs.flatMap((r) => armParameters(r))],
      armRigs: rigs,
    },
    // 顔の割当（腕と無関係）が保たれることを見る
    trackingMappings: [
      {
        input: 'faceYaw',
        parameterId: 'FaceAngleX',
        inputRange: [-30, 30],
        outputRange: [-30, 30],
        invert: false,
        curve: 'linear',
        smoothing: 0.5,
        deadZone: 0,
        weight: 1,
      },
    ],
    armTracking: tracking(true, true),
  };
}

async function roundTrip(project: Project) {
  const fs = new MemoryFileSystem();
  const io = createProjectIO(fs);
  await io.save('/p', project, {});
  return { fs, io, loaded: await io.load('/p') };
}

describe('AT-03 独立確認: 開くときの片腕の修復', () => {
  it('正しい両腕は保存と読込で変わらず、修復も起きない', async () => {
    const project = armProject();
    const { loaded } = await roundTrip(project);
    expect(loaded.report.repairs).toEqual([]);
    expect(loaded.project.model.armRigs).toEqual(project.model.armRigs);
    expect(loaded.project.armTracking).toEqual(project.armTracking);
    expect(loaded.project.trackingMappings).toEqual(project.trackingMappings);
  });

  it('R の手首グループが無いと、R のリグを消さずに無効にし、R の追従を OFF。L・顔・描画順は保つ', async () => {
    const project = armProject();
    project.model.parts = project.model.parts.filter((p) => p.id !== 'wr-r');
    const { loaded } = await roundTrip(project);
    const [left, right] = loaded.project.model.armRigs!;
    expect(left).toEqual(project.model.armRigs![0]);
    expect(right).toEqual({ ...project.model.armRigs![1], enabled: false }); // 編集用のデータは残す
    expect(loaded.project.armTracking!.sides.L).toEqual(project.armTracking!.sides.L);
    expect(loaded.project.armTracking!.sides.R).toEqual({ ...project.armTracking!.sides.R, enabled: false });
    expect(loaded.project.armTracking!.mode).toBe(project.armTracking!.mode);
    expect(loaded.project.trackingMappings).toEqual(project.trackingMappings);
    expect(loaded.project.model.drawOrder).toEqual(project.model.drawOrder);
    expect(loaded.project.model.parameters).toEqual(project.model.parameters);
    expect(loaded.report.repairs.some((r) => r.includes('R'))).toBe(true);
    expect(loaded.report.repairs.some((r) => r.includes('腕 L'))).toBe(false);
    // 2度目は何も変えない
    const again = repairProject(loaded.project);
    expect(again.repairs).toEqual([]);
    expect(again.project).toEqual(loaded.project);
  });

  it('追従設定が無いプロジェクトでも、壊れた片腕は無効になり、追従設定を作らない', () => {
    const project = armProject();
    delete project.armTracking;
    project.model.parts = project.model.parts.filter((p) => p.id !== 'hand-open-l'); // 休止形の素材の画像が無い
    const repaired = repairProject(project);
    expect(repaired.project.model.armRigs!.map((r) => r.enabled)).toEqual([false, true]);
    expect(repaired.project.armTracking).toBeUndefined();
  });

  it('リグの無い側の追従を ON で保存していても OFF にする（反対側はそのまま）', () => {
    const project = armProject();
    project.model.armRigs = [project.model.armRigs![0]!];
    project.armTracking = tracking(true, true);
    const repaired = repairProject(project);
    expect(repaired.project.armTracking!.sides).toEqual({
      L: project.armTracking.sides.L,
      R: { ...project.armTracking.sides.R, enabled: false },
    });
    expect(repaired.repairs.length).toBe(1);
  });

  it('保存形式11のフォルダを開くと、変換前の写しを残し、腕のデータを足さない', async () => {
    const old = { ...createEmptyProject('旧'), schemaVersion: 11 };
    const fs = new MemoryFileSystem();
    await fs.mkdir('/old');
    await fs.writeText('/old/project.json', JSON.stringify(old));
    const loaded = await createProjectIO(fs).load('/old');
    expect(loaded.project.schemaVersion).toBe(12);
    expect(loaded.project.model.armRigs).toBeUndefined();
    expect(loaded.project.armTracking).toBeUndefined();
    expect(loaded.report.repairs).toEqual([]);
    const backups = await fs.list('/old/backups');
    expect(backups.some((name) => name.startsWith('project.v11.'))).toBe(true);
  });
});
