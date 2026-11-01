import { z } from 'zod';
import type { Model, Parameter, Vec2 } from './types';

// AT-03 / CC-032。L/Rはモデル自身の左右。角度は度、位置・骨長は未変形モデルのpx。
export type ArmSide = 'L' | 'R';
export type HandShape = 'open' | 'fist' | 'point' | 'peace';
export const HAND_SHAPES = ['open', 'fist', 'point', 'peace'] as const; // 同点時もこの順
export interface ArmPose {
  shoulder: number;
  elbow: number;
  wrist: number;
}
export interface AngleRange {
  min: number;
  max: number;
}
export interface ArmLimits {
  shoulder: AngleRange;
  elbow: AngleRange;
  wrist: AngleRange;
  forearm: AngleRange; // shoulder + bendSign * elbow
  hand: AngleRange; // forearm + wrist
}
export interface ArmParameterIds {
  shoulder: string;
  elbow: string;
  wrist: string;
  shapes: Record<HandShape, string>;
}
export interface ArmHandAttachment {
  partIds: string[]; // 専用手首グループの下の画像。手形間の共有不可
  wrist: Vec2; // 素材の未変形モデル座標。リグの手首へ接続する
  fingerDirection: Vec2; // 同じ空間の方向ベクトル。ゼロ不可
}
export interface ArmRig {
  id: string;
  side: ArmSide;
  enabled: boolean; // カメラ追従とは独立。無効でも編集用データを残す
  parentPartId: string | null;
  groups: { shoulder: string; elbow: string; wrist: string }; // この順の直接の親子
  joints: { shoulder: Vec2; elbow: Vec2; wrist: Vec2 }; // 基準画像の関節位置
  lengths: { upper: number; lower: number };
  bendSign: 1 | -1; // 正規化した外向きの座標での固定した曲がる側
  referencePose: ArmPose;
  restPose: ArmPose;
  limits: ArmLimits;
  hands: Partial<Record<HandShape, ArmHandAttachment>>;
  restHand: HandShape;
  parameters: ArmParameterIds;
}
export interface ArmSideSettings {
  enabled: boolean;
  gain: number;
  smoothing: number; // 0..1。時間処理はAT-09
  handMode: 'auto' | HandShape;
  restHand: HandShape;
}
export interface ArmTrackingSettings {
  mode: 'normal' | 'light';
  sides: Record<ArmSide, ArmSideSettings>;
}
export interface ArmCalibration {
  version: 1;
  camera: { deviceId: string | null; width: number; height: number; fps: number };
  // 演者自身の左右。モデルの長さを入れない。px、未反転の画像から校正する
  shoulderCenter: Vec2;
  shoulderAxis: Vec2; // 画像右向きの単位ベクトル、y下向き
  shoulderWidth: number;
  arms: Record<'left' | 'right', { upper: number; lower: number; neutralWrist: Vec2 }>;
}

const num = z.number().finite();
const id = z.string().min(1);
const vec = z.object({ x: num, y: num });
const shape = z.enum(HAND_SHAPES);
const pose = z.object({ shoulder: num, elbow: num, wrist: num });
const range = z.object({ min: num, max: num });
// 意味上の不正（骨長、可動域、参照）はinspectArmRigsで分離し、その側だけ無効にする。
export const armRigSchema: z.ZodType<ArmRig> = z.object({
  id,
  side: z.enum(['L', 'R']),
  enabled: z.boolean(),
  parentPartId: id.nullable(),
  groups: z.object({ shoulder: id, elbow: id, wrist: id }),
  joints: z.object({ shoulder: vec, elbow: vec, wrist: vec }),
  lengths: z.object({ upper: num, lower: num }),
  bendSign: z.union([z.literal(1), z.literal(-1)]),
  referencePose: pose,
  restPose: pose,
  limits: z.object({ shoulder: range, elbow: range, wrist: range, forearm: range, hand: range }),
  hands: z.record(shape, z.object({ partIds: z.array(id), wrist: vec, fingerDirection: vec })),
  restHand: shape,
  parameters: z.object({
    shoulder: id,
    elbow: id,
    wrist: id,
    shapes: z.object({ open: id, fist: id, point: id, peace: id }),
  }),
});
const sideSettings = z.object({
  enabled: z.boolean(),
  gain: num.min(0).max(2),
  smoothing: num.min(0).max(1),
  handMode: z.enum(['auto', ...HAND_SHAPES]),
  restHand: shape,
});
export const armTrackingSettingsSchema: z.ZodType<ArmTrackingSettings> = z.object({
  mode: z.enum(['normal', 'light']),
  sides: z.object({ L: sideSettings, R: sideSettings }),
});
const calibrationArm = z.object({ upper: num.positive(), lower: num.positive(), neutralWrist: vec });
export const armCalibrationSchema: z.ZodType<ArmCalibration> = z.object({
  version: z.literal(1),
  camera: z.object({
    deviceId: z.string().nullable(),
    width: num.int().positive(),
    height: num.int().positive(),
    fps: num.positive(),
  }),
  shoulderCenter: vec,
  shoulderAxis: vec.refine(
    (v) => v.x > 0 && Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-4,
    '肩の軸は画像右向きの単位ベクトルにする',
  ),
  shoulderWidth: num.positive(),
  arms: z.object({ left: calibrationArm, right: calibrationArm }),
});

export function defaultArmTrackingSettings(): ArmTrackingSettings {
  const side = (): ArmSideSettings => ({ enabled: false, gain: 1, smoothing: 0.5, handMode: 'auto', restHand: 'open' });
  return { mode: 'normal', sides: { L: side(), R: side() } };
}
export function defaultArmLimits(): ArmLimits {
  return {
    shoulder: { min: -25, max: 160 },
    elbow: { min: 0, max: 145 },
    wrist: { min: -40, max: 40 },
    forearm: { min: -25, max: 300 },
    hand: { min: -55, max: 300 },
  };
}
export function armParameterIds(side: ArmSide): ArmParameterIds {
  return {
    shoulder: `ArmShoulder${side}`,
    elbow: `ArmElbow${side}`,
    wrist: `HandAngle${side}`,
    shapes: { open: `HandOpen${side}`, fist: `HandFist${side}`, point: `HandPoint${side}`, peace: `HandPeace${side}` },
  };
}
// 明示的なセットアップだけが呼ぶ。全モデルの標準パラメータ表には追加しない。
export function armParameters(rig: ArmRig): Parameter[] {
  const groupId = rig.side === 'L' ? 'armL' : 'armR';
  return [
    ...(['shoulder', 'elbow', 'wrist'] as const).map((key) => ({
      id: rig.parameters[key],
      name: `${{ shoulder: '肩', elbow: '肘', wrist: '手首' }[key]} ${rig.side}`,
      groupId,
      ...rig.limits[key],
      default: rig.restPose[key],
      standard: true,
    })),
    ...HAND_SHAPES.map((key) => ({
      id: rig.parameters.shapes[key],
      name: `手 ${key} ${rig.side}`,
      groupId,
      min: 0,
      max: 1,
      default: key === rig.restHand ? 1 : 0,
      standard: true,
    })),
  ] as Parameter[];
}
export type ArmRigIssueCode = 'length' | 'angle' | 'reference' | 'cycle' | 'ownership' | 'hand-missing' | 'transform';
export interface ArmRigIssue {
  rigId: string;
  side: ArmSide;
  code: ArmRigIssueCode;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}
export function armPoseAllowed(rig: Pick<ArmRig, 'limits' | 'bendSign'>, p: ArmPose): boolean {
  const values = {
    ...p,
    forearm: p.shoulder + rig.bendSign * p.elbow,
    hand: p.shoulder + rig.bendSign * p.elbow + p.wrist,
  };
  return (Object.keys(values) as (keyof typeof values)[]).every(
    (k) => Number.isFinite(values[k]) && values[k] >= rig.limits[k].min && values[k] <= rig.limits[k].max,
  );
}

// 保存されたモデルから決定的に診断する。enabled=falseも診断して、修正する理由を残す。
export function inspectArmRigs(model: Model): ArmRigIssue[] {
  const issues: ArmRigIssue[] = [];
  const rigs = model.armRigs ?? [];
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const owners = new Map<string, ArmRig[]>();
  const claim = (key: string, r: ArmRig) => owners.set(key, [...(owners.get(key) ?? []), r]);
  for (const r of rigs) {
    claim(`id:${r.id}`, r);
    claim(`side:${r.side}`, r);
    for (const p of Object.values(r.groups)) claim(`part:${p}`, r);
    for (const h of Object.values(r.hands)) for (const p of h.partIds) claim(`part:${p}`, r);
    for (const p of [
      r.parameters.shoulder,
      r.parameters.elbow,
      r.parameters.wrist,
      ...Object.values(r.parameters.shapes),
    ])
      claim(`parameter:${p}`, r);
  }
  for (const r of rigs) {
    const add = (code: ArmRigIssueCode, path: string, message: string, severity: 'error' | 'warning' = 'error') =>
      issues.push({ rigId: r.id, side: r.side, code, path, message, severity });
    for (const [key, own] of owners)
      if (own.length > 1 && own.includes(r)) add('ownership', key, '左右・関節・手形の所有が重複している');
    for (const [key, value] of Object.entries(r.lengths))
      if (!Number.isFinite(value) || value <= 0) add('length', `lengths.${key}`, '骨長は有限の正の値にする');
    for (const [key, v] of Object.entries(r.limits))
      if (!Number.isFinite(v.min) || !Number.isFinite(v.max) || v.min > v.max || v.max - v.min >= 360)
        add('angle', `limits.${key}`, '角度は順序の正しい360度未満の有限区間にする');
    if (r.limits.elbow.min < 0 || r.limits.elbow.max >= 180)
      add('angle', 'limits.elbow', '肘の曲げ量は0以上180度未満にする');
    for (const key of ['restPose', 'referencePose'] as const)
      if (!armPoseAllowed(r, r[key])) add('angle', key, '基準・休止姿勢を組合せ制約の内側にする');
    const chain = [r.groups.shoulder, r.groups.elbow, r.groups.wrist];
    const expected = [r.parentPartId, r.groups.shoulder, r.groups.elbow];
    const affected = new Set<string>();
    const ownedSubtree = new Set<string>();
    const ancestors = (start: string): string[] => {
      const seen = new Set<string>();
      let id: string | null = start;
      while (id !== null) {
        if (seen.has(id)) {
          add('cycle', start, '腕の親子が循環している');
          break;
        }
        seen.add(id);
        const part = parts.get(id);
        if (!part) {
          add('reference', start, `参照先のパーツが無い（${id}）`);
          break;
        }
        id = part.parentId;
      }
      return [...seen];
    };
    chain.forEach((id, i) => {
      const p = parts.get(id);
      if (!p || p.kind !== 'group' || p.parentId !== expected[i])
        add('reference', `groups.${i}`, '専用グループを肩→肘→手首の順に接続する');
      for (const a of ancestors(id)) affected.add(a);
    });
    for (const other of rigs) {
      if (other === r) continue;
      if (ancestors(r.groups.shoulder).some((id) => Object.values(other.groups).includes(id)))
        add('ownership', 'parentPartId', '別の腕の関節を親にできない');
    }
    // 専用グループの子孫にも、反転・ワープで制約を迂回させない。
    for (const p of model.parts) {
      const seen = new Set<string>();
      let at: string | null = p.id;
      while (at !== null && !seen.has(at)) {
        if (chain.includes(at)) {
          affected.add(p.id);
          ownedSubtree.add(p.id);
          break;
        }
        seen.add(at);
        at = parts.get(at)?.parentId ?? null;
      }
    }
    for (const id of affected) {
      const p = parts.get(id);
      if (!p) continue;
      if (ownedSubtree.has(id) && model.curveGuides?.some((g) => g.enabled && g.partId === id))
        add('transform', id, '腕の流れ線変形は初版の対象外');
      if (!(p.scale.x > 0 && p.scale.y > 0 && Math.abs(p.scale.x - p.scale.y) < 1e-6))
        add('transform', id, '腕と祖先の倍率は正の等倍率にする');
      if (
        chain.includes(id) &&
        (p.rotation !== 0 || p.position.x !== 0 || p.position.y !== 0 || p.scale.x !== 1 || p.scale.y !== 1)
      )
        add('transform', id, '専用関節グループの基礎変換は恒等にする');
      if (model.warps.some((w) => w.partId === id)) add('transform', id, '腕と祖先のワープは初版の対象外');
      for (const b of model.bindings.filter(
        (b) =>
          (b.target.type === 'part' && b.target.id === id) ||
          (p.meshId !== null && b.target.type === 'mesh' && b.target.id === p.meshId),
      )) {
        if (b.parameterIds.some((id) => id === 'ArmL' || id === 'ArmR'))
          add('ownership', b.id, '旧ArmL/Rの変形と専用の腕関節を同時に適用できない');
        if (b.channel !== 'transform') {
          // 祖先の画像自身の頂点キーは子へ伝播しない。腕の画像・関節配下だけを制限する。
          if (ownedSubtree.has(id)) add('transform', b.id, '腕の頂点変形は初版の対象外');
          continue;
        }
        for (const key of b.keys) {
          if (Array.isArray(key.delta)) continue;
          const d = key.delta;
          if (
            !(d.scale.x > 0 && Math.abs(d.scale.x - d.scale.y) < 1e-6) ||
            (chain.includes(id) &&
              (d.rotation !== 0 || d.position.x !== 0 || d.position.y !== 0 || d.scale.x !== 1 || d.scale.y !== 1))
          )
            add('transform', b.id, '専用関節への別の変形・反転は併用できない');
        }
      }
    }
    const paramIds = [
      r.parameters.shoulder,
      r.parameters.elbow,
      r.parameters.wrist,
      ...Object.values(r.parameters.shapes),
    ];
    for (const id of paramIds)
      if (!model.parameters.some((p) => p.id === id)) add('reference', id, '制御先のパラメータが無い');
    for (const id of paramIds)
      if (id === 'ArmL' || id === 'ArmR') add('ownership', id, '旧ArmL/Rを新しい関節の制御先にしない');
    for (const key of ['shoulder', 'elbow', 'wrist'] as const) {
      const p = model.parameters.find((p) => p.id === r.parameters[key]);
      if (p && (p.min > r.limits[key].min || p.max < r.limits[key].max))
        add('angle', p.id, 'パラメータの範囲が関節の可動域を含まない');
    }
    for (const id of Object.values(r.parameters.shapes)) {
      const p = model.parameters.find((p) => p.id === id);
      if (p && (p.min !== 0 || p.max !== 1)) add('angle', id, '手形の重みの範囲は0から1にする');
    }
    for (const h of HAND_SHAPES) {
      const hand = r.hands[h];
      if (!hand || hand.partIds.length === 0) {
        add('hand-missing', `hands.${h}`, '手形の素材が無い', h === r.restHand ? 'error' : 'warning');
        continue;
      }
      if (Math.hypot(hand.fingerDirection.x, hand.fingerDirection.y) < 1e-6)
        add('angle', `hands.${h}`, '指方向がゼロになっている');
      for (const id of hand.partIds)
        if (parts.get(id)?.kind !== 'image' || !ancestors(id).includes(r.groups.wrist))
          add('reference', `hands.${h}`, '手の画像を専用手首グループの下に置く');
    }
    const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
    if (
      Math.abs(distance(r.joints.shoulder, r.joints.elbow) - r.lengths.upper) > 1e-4 ||
      Math.abs(distance(r.joints.elbow, r.joints.wrist) - r.lengths.lower) > 1e-4
    )
      add('length', 'joints', '基準の関節位置と骨長が一致しない');
    const rad = Math.PI / 180,
      sign = r.side === 'L' ? 1 : -1;
    const a = r.referencePose.shoulder * rad,
      b = (r.referencePose.shoulder + r.bendSign * r.referencePose.elbow) * rad;
    const elbow = {
      x: r.joints.shoulder.x + sign * r.lengths.upper * Math.sin(a),
      y: r.joints.shoulder.y + r.lengths.upper * Math.cos(a),
    };
    const wrist = { x: elbow.x + sign * r.lengths.lower * Math.sin(b), y: elbow.y + r.lengths.lower * Math.cos(b) };
    if (distance(elbow, r.joints.elbow) > 1e-4 || distance(wrist, r.joints.wrist) > 1e-4)
      add('angle', 'referencePose', '基準角度と関節位置の向きが一致しない');
  }
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = JSON.stringify([i.rigId, i.side, i.code, i.path, i.message, i.severity]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
