import { describe, expect, it } from 'vitest';
import {
  armParameterIds,
  armParameters,
  armPoseAllowed,
  defaultArmLimits,
  defaultArmTrackingSettings,
  inspectArmRigs,
  type ArmRig,
} from './arms';
import { createDefaultEnvironment, createEmptyProject, ensureStandardParameters } from './defaults';
import { loadProjectJson, SCHEMA_VERSION } from './migrate';
import { validateEnvironment, validateProject } from './validate';
import type { Model, Part } from './types';

function fixture(): { model: Model; rig: ArmRig } {
  const rig: ArmRig = {
    id: 'left-arm',
    side: 'L',
    enabled: true,
    parentPartId: null,
    groups: { shoulder: 's', elbow: 'e', wrist: 'w' },
    joints: { shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 100 }, wrist: { x: 0, y: 180 } },
    lengths: { upper: 100, lower: 80 },
    bendSign: 1,
    referencePose: { shoulder: 0, elbow: 0, wrist: 0 },
    restPose: { shoulder: 8, elbow: 12, wrist: 0 },
    limits: defaultArmLimits(),
    hands: { open: { partIds: ['palm'], wrist: { x: 0, y: 180 }, fingerDirection: { x: 0, y: -1 } } },
    restHand: 'open',
    parameters: armParameterIds('L'),
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
  const model = createEmptyProject('技術見本').model;
  model.parts = [
    part('s', null, 'group'),
    part('e', 's', 'group'),
    part('w', 'e', 'group'),
    part('palm', 'w', 'image'),
  ];
  model.armRigs = [rig];
  model.parameters.push(...armParameters(rig));
  model.drawOrder = ['palm'];
  return { model, rig };
}
describe('AT-03 実装者の保存契約確認', () => {
  it('旧版を読み、キー・描画順・パラメータを追加しない', () => {
    const old = createEmptyProject('旧');
    old.schemaVersion = 11;
    const loaded = loadProjectJson(JSON.stringify(old));
    expect(loaded).toEqual({ ...old, schemaVersion: SCHEMA_VERSION });
    expect(loaded.armTracking).toBeUndefined();
    expect(loaded.model.armRigs).toBeUndefined();
    expect(defaultArmTrackingSettings().sides.L.enabled).toBe(false);
    expect(defaultArmTrackingSettings().sides.R.enabled).toBe(false);
    expect(ensureStandardParameters(loaded.model, 'step2').parameters.some((p) => p.id === 'ArmShoulderL')).toBe(false);
  });
  it('リグと設定を往復し、欠けた非休止形は警告に分ける', () => {
    const { model } = fixture();
    const p = { ...createEmptyProject('腕'), model, armTracking: defaultArmTrackingSettings() };
    expect(loadProjectJson(JSON.stringify(p))).toEqual(p);
    expect(inspectArmRigs(model).filter((i) => i.severity === 'error')).toEqual([]);
    expect(inspectArmRigs(model).filter((i) => i.code === 'hand-missing')).toHaveLength(3);
  });
  it.each(['upper', 'lower'] as const)('不正な骨長 %s を診断する', (key) => {
    const { model, rig } = fixture();
    rig.lengths[key] = 0;
    expect(inspectArmRigs(model).some((i) => i.code === 'length')).toBe(true);
  });
  it('組合せの一周と休止姿勢の範囲外を別々に検出する', () => {
    const { model, rig } = fixture();
    rig.limits.hand = { min: -60, max: 300 };
    rig.restPose.elbow = 146;
    const issues = inspectArmRigs(model);
    expect(issues.some((i) => i.path === 'limits.hand')).toBe(true);
    expect(issues.some((i) => i.path === 'restPose')).toBe(true);
    expect(armPoseAllowed(rig, { shoulder: 160, elbow: 145, wrist: 40 })).toBe(false);
  });
  it('片側の手素材の参照切れと循環を区別する', () => {
    const { model } = fixture();
    model.parts[1]!.parentId = 'w';
    model.parts.pop();
    expect(inspectArmRigs(model).some((i) => i.code === 'cycle')).toBe(true);
    expect(inspectArmRigs(model).some((i) => i.code === 'reference' && i.path === 'hands.open')).toBe(true);
  });
  it('重複した手・パラメータの所有を拒否する', () => {
    const { model, rig } = fixture();
    model.armRigs!.push({ ...structuredClone(rig), id: 'right', side: 'R' });
    expect(
      new Set(
        inspectArmRigs(model)
          .filter((i) => i.code === 'ownership')
          .map((i) => i.side),
      ),
    ).toEqual(new Set(['L', 'R']));
  });
  it('祖先の負倍率・非等倍率を腕の問題として診断する', () => {
    const { model } = fixture();
    model.parts[0]!.scale = { x: -1, y: 1 };
    expect(inspectArmRigs(model).some((i) => i.code === 'transform')).toBe(true);
  });
  it('NaN・不正な設定・校正軸を構造検証で拒否する', () => {
    const { model, rig } = fixture();
    rig.lengths.upper = NaN;
    expect(() => validateProject({ ...createEmptyProject('不正'), model })).toThrow();
    const settings = defaultArmTrackingSettings();
    settings.sides.R.gain = Infinity;
    expect(() => validateProject({ ...createEmptyProject('不正'), armTracking: settings })).toThrow();
    expect(() => validateEnvironment({ ...createDefaultEnvironment(), armCalibration: { version: 1 } })).toThrow();
  });
  it('旧環境設定を変えず、腕の校正と顔の校正を分離する', () => {
    const env = createDefaultEnvironment();
    expect(validateEnvironment(env)).toEqual(env);
    const arm = {
      version: 1 as const,
      camera: { deviceId: 'camera', width: 640, height: 480, fps: 25 },
      shoulderCenter: { x: 320, y: 200 },
      shoulderAxis: { x: 1, y: 0 },
      shoulderWidth: 150,
      arms: {
        left: { upper: 100, lower: 80, neutralWrist: { x: 240, y: 380 } },
        right: { upper: 101, lower: 81, neutralWrist: { x: 400, y: 380 } },
      },
    };
    const loaded = validateEnvironment(JSON.parse(JSON.stringify({ ...env, armCalibration: arm })));
    expect(loaded.armCalibration).toEqual(arm);
    expect(loaded.calibration).toBeNull();
  });
});
