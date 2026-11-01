// 試験だけが使う。AT-06（CO作業中）の確認済みの版が来るまでの、単純なIKと制約、腕のリグと観測の作り方。
// 角度は度、下向き0、外向きが正。前腕の向き = 肩 + bendSign × 肘、手 = 前腕 + 手首（CC-032）
import type {
  ArmConstraint,
  ArmIKSolver,
  ArmObservation,
  BodySampleTime,
  HandShapeResult,
  NormalizedBodyFrame,
  ObservationValidity,
} from '@app/contracts';
import {
  armParameterIds,
  createEmptyProject,
  defaultArmLimits,
  type ArmPose,
  type ArmRig,
  type ArmSide,
  type HandShape,
  type Model,
  type Vec2,
} from '@app/schema';
import type { ArmMotionDeps } from './session';

const RAD = Math.PI / 180;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function forward(rig: Pick<ArmRig, 'lengths' | 'bendSign'>, p: ArmPose): { elbow: Vec2; wrist: Vec2 } {
  const a = p.shoulder * RAD;
  const b = (p.shoulder + rig.bendSign * p.elbow) * RAD;
  const elbow = { x: rig.lengths.upper * Math.sin(a), y: rig.lengths.upper * Math.cos(a) };
  return {
    elbow,
    wrist: { x: elbow.x + rig.lengths.lower * Math.sin(b), y: elbow.y + rig.lengths.lower * Math.cos(b) },
  };
}

// 各関節を区間へ、前腕・手の合成角を区間へ収める（試験用の単純な制約）
export const testConstrain: ArmConstraint = (pose, l, sign, fallback) => {
  const src = [pose.shoulder, pose.elbow, pose.wrist].every(Number.isFinite) ? pose : fallback;
  const shoulder = clamp(src.shoulder, l.shoulder.min, l.shoulder.max);
  const fLo = sign === 1 ? l.forearm.min - shoulder : shoulder - l.forearm.max;
  const fHi = sign === 1 ? l.forearm.max - shoulder : shoulder - l.forearm.min;
  const elbow = clamp(src.elbow, Math.max(l.elbow.min, fLo), Math.min(l.elbow.max, fHi));
  const forearm = shoulder + sign * elbow;
  const wrist = clamp(
    src.wrist,
    Math.max(l.wrist.min, l.hand.min - forearm),
    Math.min(l.wrist.max, l.hand.max - forearm),
  );
  return { shoulder, elbow, wrist };
};

// 固定した肘の枝の解析解を、制約に収める（試験用）
export const testSolveIK: ArmIKSolver = (input) => {
  const { rig } = input;
  const u = rig.lengths.upper;
  const v = rig.lengths.lower;
  const rest = rig.restPose;
  if (!(u > 0 && v > 0))
    return {
      valid: false,
      pose: rest,
      elbow: { x: 0, y: 0 },
      wrist: { x: 0, y: 0 },
      wristError: 0,
      reasons: ['invalid-rig'],
    };
  const w = input.wrist;
  const d = clamp(Math.hypot(w.x, w.y), Math.abs(u - v) + 1e-6, u + v - 1e-6);
  const e = Math.acos(clamp((d * d - u * u - v * v) / (2 * u * v), -1, 1));
  const s = Math.atan2(w.x, w.y) - Math.atan2(rig.bendSign * v * Math.sin(e), u + v * Math.cos(e));
  const wrist = input.wristAngle ?? input.previous?.wrist ?? rest.wrist;
  const pose = testConstrain({ shoulder: s / RAD, elbow: e / RAD, wrist }, rig.limits, rig.bendSign, rest);
  const fk = forward(rig, pose);
  const wristError = Math.hypot(fk.wrist.x - w.x, fk.wrist.y - w.y);
  return { valid: true, pose, ...fk, wristError, reasons: wristError > 1 ? ['unreachable'] : [] };
};

export const testDeps: ArmMotionDeps = { solveIK: testSolveIK, constrain: testConstrain };

export const REST: ArmPose = { shoulder: 5, elbow: 10, wrist: 0 };

export function testRig(side: ArmSide, patch: Partial<ArmRig> = {}): ArmRig {
  return {
    id: `arm${side}`,
    side,
    enabled: true,
    parentPartId: null,
    groups: { shoulder: `shoulder${side}`, elbow: `elbow${side}`, wrist: `wrist${side}` },
    joints: { shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 100 }, wrist: { x: 0, y: 190 } },
    lengths: { upper: 100, lower: 90 },
    bendSign: side === 'L' ? 1 : -1,
    referencePose: { ...REST },
    restPose: { ...REST },
    limits: defaultArmLimits(),
    hands: {},
    restHand: 'open',
    parameters: armParameterIds(side),
    ...patch,
  };
}

export function testModel(rigs: ArmRig[] = [testRig('L'), testRig('R')]): Model {
  return { ...createEmptyProject('腕').model, armRigs: rigs };
}

export const sampleTime = (capturedAt: number, generation = 1): BodySampleTime => ({
  generation,
  frameId: 0,
  capturedAt,
  captureSource: 'captureTime',
  completedAt: capturedAt + 20,
  receivedAt: capturedAt + 25,
});

// 姿勢から、正規化した観測（肩原点・腕の長さ1）を作る。演者の腕の長さとモデルの長さの比は1とみなす
export function observation(
  side: ArmSide,
  pose: ArmPose,
  t: number,
  options: { validity?: ObservationValidity; elbow?: boolean; generation?: number; noise?: Vec2 } = {},
): ArmObservation {
  const rig = testRig(side);
  const fk = forward(rig, pose);
  const length = rig.lengths.upper + rig.lengths.lower;
  const validity = options.validity ?? 'valid';
  const ok = validity === 'valid' || validity === 'inferred';
  const n = options.noise ?? { x: 0, y: 0 };
  return {
    side,
    actorSide: side === 'L' ? 'right' : 'left',
    time: sampleTime(t, options.generation),
    validity,
    elbow:
      ok && options.elbow !== false
        ? { position: { x: fk.elbow.x / length, y: fk.elbow.y / length }, validity: 'valid' }
        : { position: null, validity: ok ? 'inferred' : validity },
    wrist: ok
      ? { position: { x: fk.wrist.x / length + n.x, y: fk.wrist.y / length + n.y }, validity: 'valid' }
      : { position: null, validity },
  };
}

// 世代は観測の世代（無ければ1）
export function frame(
  arms: Partial<Record<ArmSide, ArmObservation>>,
  generation = Object.values(arms)[0]?.time.generation ?? 1,
): NormalizedBodyFrame {
  return { generation, arms, hands: {} };
}

// 確定した手形（AT-07の結果の形）
export function shapeResult(
  side: ArmSide,
  t: number,
  confirmed: HandShape | null,
  options: { axis?: Vec2 | null; confirmedAt?: number | null; generation?: number } = {},
): HandShapeResult {
  const axis = options.axis === undefined ? { x: 0, y: 1 } : options.axis;
  return {
    side,
    time: sampleTime(t, options.generation),
    candidate: { shape: confirmed, score: 1, palmAxis: axis },
    confirmed,
    confirmedAt: options.confirmedAt === undefined ? (confirmed ? t : null) : options.confirmedAt,
    axisObservedAt: axis ? t : null,
    validity: 'valid',
  };
}
