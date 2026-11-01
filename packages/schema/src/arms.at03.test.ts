// AT-03 の独立確認（CL）。期待値は AT-03 報告・CC-032 の約束から計算し、CO の補助試験と実装の式は写さない。
// 対象の版は docs/arm-tracking/evidence/AT-03/manifest.json（AT-03 CO v1）。
import { describe, expect, it } from 'vitest';
import {
  armParameterIds,
  armParameters,
  createDefaultEnvironment,
  createEmptyProject,
  defaultArmLimits,
  defaultArmTrackingSettings,
  ensureStandardParameters,
  inspectArmRigs,
  loadProjectJson,
  SCHEMA_VERSION,
  validateEnvironment,
  validateProject,
  type ArmCalibration,
  type ArmRig,
  type ArmSide,
  type HandShape,
  type Model,
  type Part,
  type Project,
} from './index';

const D = Math.PI / 180;
const SHAPES: HandShape[] = ['open', 'fist', 'point', 'peace'];

function part(id: string, kind: Part['kind'], parentId: string | null, patch: Partial<Part> = {}): Part {
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
    ...patch,
  };
}

// 報告の約束から別に計算した基準の関節位置。L の肩は +x、R は −x、下向き 0、外へ上げる向きが正。
// 前腕の合成角は shoulder + bendSign * elbow
function joints(side: ArmSide, pose: ArmRig['referencePose'], bendSign: 1 | -1, upper: number, lower: number) {
  const k = side === 'L' ? 1 : -1;
  const shoulder = { x: 78 * k, y: 240 };
  const a = pose.shoulder * D;
  const b = (pose.shoulder + bendSign * pose.elbow) * D;
  const elbow = { x: shoulder.x + k * upper * Math.sin(a), y: shoulder.y + upper * Math.cos(a) };
  const wrist = { x: elbow.x + k * lower * Math.sin(b), y: elbow.y + lower * Math.cos(b) };
  return { shoulder, elbow, wrist };
}

function rig(side: ArmSide, patch: Partial<ArmRig> = {}): ArmRig {
  const s = side.toLowerCase();
  const referencePose = { shoulder: 8, elbow: 12, wrist: 0 };
  const j = joints(side, referencePose, 1, 118, 108);
  return {
    id: `rig-${s}`,
    side,
    enabled: true,
    parentPartId: 'body',
    groups: { shoulder: `sh-${s}`, elbow: `el-${s}`, wrist: `wr-${s}` },
    joints: j,
    lengths: { upper: 118, lower: 108 },
    bendSign: 1,
    referencePose,
    restPose: { shoulder: 8, elbow: 12, wrist: 0 },
    limits: defaultArmLimits(),
    hands: Object.fromEntries(
      SHAPES.map((shape) => [
        shape,
        { partIds: [`hand-${shape}-${s}`], wrist: j.wrist, fingerDirection: { x: 0, y: 1 } },
      ]),
    ),
    restHand: 'open',
    parameters: armParameterIds(side),
    ...patch,
  };
}

// 両腕のそろった、診断の無いはずのプロジェクト
function armProject(rigs: ArmRig[] = [rig('L'), rig('R')]): Project {
  const project = createEmptyProject('腕');
  const parts: Part[] = [part('body', 'group', null)];
  for (const side of ['l', 'r']) {
    parts.push(part(`sh-${side}`, 'group', 'body'), part(`el-${side}`, 'group', `sh-${side}`));
    parts.push(part(`wr-${side}`, 'group', `el-${side}`));
    for (const shape of SHAPES) parts.push(part(`hand-${shape}-${side}`, 'image', `wr-${side}`));
  }
  const model: Model = {
    ...project.model,
    parts,
    drawOrder: parts.filter((p) => p.kind === 'image').map((p) => p.id),
    parameters: [...project.model.parameters, ...rigs.flatMap((r) => armParameters(r))],
    armRigs: rigs,
  };
  return { ...project, model, armTracking: defaultArmTrackingSettings() };
}

const errors = (model: Model) => inspectArmRigs(model).filter((i) => i.severity === 'error');
const codes = (model: Model, side: ArmSide) =>
  new Set(
    inspectArmRigs(model)
      .filter((i) => i.side === side && i.severity === 'error')
      .map((i) => i.code),
  );

describe('AT-03 独立確認: 旧版と既定値', () => {
  it('保存形式は12。11のファイルは版だけ上がり、腕のリグ・パラメータ・追従設定・描画順を足さない', () => {
    expect(SCHEMA_VERSION).toBe(12);
    const old = { ...createEmptyProject('旧'), schemaVersion: 11 };
    old.model = ensureStandardParameters(old.model, 'step2');
    const loaded = loadProjectJson(JSON.stringify(old));
    expect(loaded.schemaVersion).toBe(12);
    expect(loaded.model.armRigs).toBeUndefined();
    expect(loaded.armTracking).toBeUndefined();
    expect(loaded.model.parameters.map((p) => p.id)).toEqual(old.model.parameters.map((p) => p.id));
    expect(loaded.model.drawOrder).toEqual(old.model.drawOrder);
    // 旧 ArmL/R はそのままの意味（−1..1）で残る
    const armL = loaded.model.parameters.find((p) => p.id === 'ArmL');
    expect(armL && [armL.min, armL.max, armL.default]).toEqual([-1, 1, 0]);
  });

  it('知らない新しい版は読まない', () => {
    expect(() => loadProjectJson(JSON.stringify({ ...createEmptyProject('新'), schemaVersion: 13 }))).toThrow();
  });

  it('標準パラメータの表（MVP・STEP2）に新しい腕のパラメータは入らない。新しいプロジェクトにも腕は無い', () => {
    const fresh = createEmptyProject('新');
    const all = ensureStandardParameters(fresh.model, 'step2').parameters.map((p) => p.id);
    const armIds = (['L', 'R'] as const).flatMap((side) => {
      const ids = armParameterIds(side);
      return [ids.shoulder, ids.elbow, ids.wrist, ...Object.values(ids.shapes)];
    });
    expect(all.filter((id) => armIds.includes(id))).toEqual([]);
    expect(fresh.model.armRigs).toBeUndefined();
    expect(fresh.armTracking).toBeUndefined();
  });

  it('追従設定の既定値は両側 OFF', () => {
    const settings = defaultArmTrackingSettings();
    expect(settings.sides.L.enabled).toBe(false);
    expect(settings.sides.R.enabled).toBe(false);
  });
});

describe('AT-03 独立確認: 保存の往復', () => {
  it('両腕のリグと追従設定は JSON の往復で同じになり、診断は無い', () => {
    const project = armProject();
    project.armTracking = {
      mode: 'light',
      sides: {
        L: { enabled: true, gain: 1.2, smoothing: 0.3, handMode: 'auto', restHand: 'fist' },
        R: { enabled: false, gain: 0.8, smoothing: 0.7, handMode: 'peace', restHand: 'open' },
      },
    };
    const loaded = loadProjectJson(JSON.stringify(project));
    expect(loaded).toEqual(validateProject(project));
    expect(loaded.model.armRigs).toEqual(project.model.armRigs);
    expect(loaded.armTracking).toEqual(project.armTracking);
    expect(inspectArmRigs(loaded.model)).toEqual([]);
  });

  it('構造の壊れた値（NaN・必須の欠落）は従来どおり型の検証で止まる', () => {
    const nan = armProject([rig('L', { lengths: { upper: Number.NaN, lower: 108 } }), rig('R')]);
    expect(() => validateProject(nan)).toThrow();
    const missing = armProject();
    delete (missing.model.armRigs![0] as Partial<ArmRig>).groups;
    expect(() => validateProject(missing)).toThrow();
    // JSON の往復では NaN は null になる。これも型の検証で止まる
    expect(() => loadProjectJson(JSON.stringify(nan))).toThrow();
  });
});

describe('AT-03 独立確認: 意味の診断（片側だけ）', () => {
  it('骨長が0以下・関節位置と骨長の不一致は length', () => {
    const zero = armProject([rig('L', { lengths: { upper: 0, lower: 108 } }), rig('R')]).model;
    expect(codes(zero, 'L').has('length')).toBe(true);
    expect(codes(zero, 'R').size).toBe(0);
    const moved = rig('R');
    moved.joints = { ...moved.joints, wrist: { x: moved.joints.wrist.x - 5, y: moved.joints.wrist.y } };
    expect(codes(armProject([rig('L'), moved]).model, 'R').has('length')).toBe(true);
  });

  it('角度：区間の幅360以上・逆順、肘の180以上、組合せ制約の外の休止姿勢、基準角と関節位置の食い違い', () => {
    const wide = rig('L');
    wide.limits = { ...wide.limits, forearm: { min: -100, max: 260 } }; // 幅 360
    expect(codes(armProject([wide, rig('R')]).model, 'L').has('angle')).toBe(true);
    const reversed = rig('L');
    reversed.limits = { ...reversed.limits, wrist: { min: 10, max: -10 } };
    expect(codes(armProject([reversed, rig('R')]).model, 'L').has('angle')).toBe(true);
    const elbow = rig('L');
    elbow.limits = { ...elbow.limits, elbow: { min: 0, max: 180 } };
    expect(codes(armProject([elbow, rig('R')]).model, 'L').has('angle')).toBe(true);
    // 肩・肘・手首は単独では範囲内だが、手の合成角（160+145+40）が上限300を超える
    const rest = rig('L', { restPose: { shoulder: 160, elbow: 145, wrist: 40 } });
    expect(codes(armProject([rest, rig('R')]).model, 'L').has('angle')).toBe(true);
    // 関節位置は休止の向きのまま、基準角だけを変える
    const reference = rig('R', { referencePose: { shoulder: 30, elbow: 12, wrist: 0 } });
    expect(codes(armProject([rig('L'), reference]).model, 'R').has('angle')).toBe(true);
  });

  it('bendSign −1 は基準姿勢から求めた関節位置と一致すれば診断しない', () => {
    const pose = { shoulder: 40, elbow: 30, wrist: 0 };
    const minus = rig('L', {
      bendSign: -1,
      referencePose: pose,
      restPose: pose,
      joints: joints('L', pose, -1, 118, 108),
    });
    minus.hands = Object.fromEntries(
      Object.entries(minus.hands).map(([k, h]) => [k, { ...h!, wrist: minus.joints.wrist }]),
    );
    expect(errors(armProject([minus, rig('R')]).model)).toEqual([]);
  });

  it('循環：L の肩→肘→手首の親子が輪になっても、R は無傷', () => {
    const project = armProject();
    project.model.parts = project.model.parts.map((p) => (p.id === 'sh-l' ? { ...p, parentId: 'wr-l' } : p));
    expect(codes(project.model, 'L').has('cycle')).toBe(true);
    expect(codes(project.model, 'R').size).toBe(0);
  });

  it('参照：手首グループが無い・手の画像が手首の下に無い・制御先のパラメータが無い', () => {
    const noWrist = armProject();
    noWrist.model.parts = noWrist.model.parts.filter((p) => p.id !== 'wr-r');
    expect(codes(noWrist.model, 'R').has('reference')).toBe(true);
    expect(codes(noWrist.model, 'L').size).toBe(0);
    const outside = armProject();
    outside.model.parts = outside.model.parts.map((p) => (p.id === 'hand-open-l' ? { ...p, parentId: 'body' } : p));
    expect(codes(outside.model, 'L').has('reference')).toBe(true);
    const noParam = armProject();
    noParam.model.parameters = noParam.model.parameters.filter((p) => p.id !== 'ArmElbowL');
    expect(codes(noParam.model, 'L').has('reference')).toBe(true);
  });

  it('所有の重複：同じ側の2つのリグ・手の画像の共有・パラメータの共有・旧 ArmL/R を制御先にする', () => {
    const twoLeft = armProject([rig('L'), rig('L', { id: 'rig-l2' })]).model;
    expect(codes(twoLeft, 'L').has('ownership')).toBe(true);
    const shared = rig('R');
    shared.hands = { ...shared.hands, fist: { ...shared.hands.fist!, partIds: ['hand-fist-l'] } };
    const sharedModel = armProject([rig('L'), shared]).model;
    expect(codes(sharedModel, 'L').has('ownership')).toBe(true);
    expect(codes(sharedModel, 'R').has('ownership')).toBe(true);
    const sameParam = rig('R');
    sameParam.parameters = { ...sameParam.parameters, wrist: 'HandAngleL' };
    expect(codes(armProject([rig('L'), sameParam]).model, 'R').has('ownership')).toBe(true);
    const legacy = rig('L');
    legacy.parameters = { ...legacy.parameters, shoulder: 'ArmL' };
    const legacyProject = armProject([legacy, rig('R')]);
    legacyProject.model = ensureStandardParameters(legacyProject.model, 'step2'); // ArmL がある
    expect(codes(legacyProject.model, 'L').has('ownership')).toBe(true);
  });

  it('手形の素材：休止形でない形の欠けは警告、休止形の欠けはエラー', () => {
    const noPeace = rig('L');
    delete noPeace.hands.peace;
    const warn = inspectArmRigs(armProject([noPeace, rig('R')]).model).filter((i) => i.code === 'hand-missing');
    expect(warn.map((i) => i.severity)).toEqual(['warning']);
    const noRest = rig('L', { restHand: 'peace' });
    delete noRest.hands.peace;
    expect(codes(armProject([noRest, rig('R')]).model, 'L').has('hand-missing')).toBe(true);
  });

  it('変形：祖先の回転・正の等倍率は許す。祖先の非等倍率・ワープと、専用関節の基礎変換は診断する', () => {
    const allowed = armProject();
    allowed.model.parts = allowed.model.parts.map((p) =>
      p.id === 'body' ? { ...p, rotation: 12, scale: { x: 1.3, y: 1.3 } } : p,
    );
    expect(errors(allowed.model)).toEqual([]);
    const squash = armProject();
    squash.model.parts = squash.model.parts.map((p) => (p.id === 'body' ? { ...p, scale: { x: 1, y: 0.8 } } : p));
    expect(codes(squash.model, 'L').has('transform')).toBe(true);
    const warp = armProject();
    warp.model.warps = [
      {
        id: 'w',
        partId: 'body',
        columns: 1,
        rows: 1,
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
      },
    ];
    expect(codes(warp.model, 'L').has('transform')).toBe(true);
    const joint = armProject();
    joint.model.parts = joint.model.parts.map((p) => (p.id === 'el-r' ? { ...p, rotation: 5 } : p));
    expect(codes(joint.model, 'R').has('transform')).toBe(true);
    expect(codes(joint.model, 'L').size).toBe(0);
  });
});

describe('AT-03 独立確認: Environment の腕の校正', () => {
  const calibration: ArmCalibration = {
    version: 1,
    camera: { deviceId: 'cam', width: 640, height: 480, fps: 30 },
    shoulderCenter: { x: 320, y: 300 },
    shoulderAxis: { x: 1, y: 0 },
    shoulderWidth: 160,
    arms: {
      left: { upper: 120, lower: 110, neutralWrist: { x: 420, y: 470 } },
      right: { upper: 118, lower: 112, neutralWrist: { x: 220, y: 470 } },
    },
  };

  it('省略・null は未校正として通り、正しい校正は往復で同じ', () => {
    const base = createDefaultEnvironment();
    expect(validateEnvironment(base).armCalibration ?? null).toBeNull();
    expect(validateEnvironment({ ...base, armCalibration: null }).armCalibration).toBeNull();
    const env = validateEnvironment(JSON.parse(JSON.stringify({ ...base, armCalibration: calibration })));
    expect(env.armCalibration).toEqual(calibration);
    // 顔の校正とは独立
    expect(env.calibration).toEqual(base.calibration);
  });

  it('肩の軸が単位ベクトルでない・左向き、骨長が0の校正は通さない', () => {
    const base = createDefaultEnvironment();
    for (const bad of [
      { ...calibration, shoulderAxis: { x: 2, y: 0 } },
      { ...calibration, shoulderAxis: { x: -1, y: 0 } },
      { ...calibration, arms: { ...calibration.arms, left: { ...calibration.arms.left, upper: 0 } } },
    ])
      expect(() => validateEnvironment({ ...base, armCalibration: bad })).toThrow();
  });
});
