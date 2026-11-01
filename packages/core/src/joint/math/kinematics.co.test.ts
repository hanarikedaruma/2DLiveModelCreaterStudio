import { describe, expect, it } from 'vitest';
import { armParameterIds, defaultArmLimits, type ArmRig, type ArmPose } from '@app/schema';
import type { ArmConstraint, ArmIKSolver } from '@app/contracts';
import { constrainArmPose, armPoseInLimits, forwardArm, forwardArmInModel, solveArmIK } from './index';

function rig(): ArmRig {
  return {
    id: 'test',
    side: 'L',
    enabled: true,
    parentPartId: null,
    groups: { shoulder: 's', elbow: 'e', wrist: 'w' },
    joints: { shoulder: { x: 78, y: 240 }, elbow: { x: 78, y: 358 }, wrist: { x: 78, y: 466 } },
    lengths: { upper: 118, lower: 108 },
    bendSign: 1,
    referencePose: { shoulder: 0, elbow: 0, wrist: 0 },
    restPose: { shoulder: 8, elbow: 12, wrist: 0 },
    limits: defaultArmLimits(),
    hands: {},
    restHand: 'open',
    parameters: armParameterIds('L'),
  };
}
const solver: ArmIKSolver = solveArmIK;
const constraint: ArmConstraint = constrainArmPose;
describe('AT-06 実装者の数値検証', () => {
  it.each([0, 45, 90])('直線の%d度を手計算と照合する', (angle) => {
    const r = rig(),
      p = { shoulder: angle, elbow: 0, wrist: 0 },
      out = forwardArmInModel(r, p);
    const unit = angle === 45 ? Math.SQRT1_2 : 1;
    expect(out.wrist.x).toBeCloseTo(78 + (angle === 0 ? 0 : 226 * unit), 10);
    expect(out.wrist.y).toBeCloseTo(240 + (angle === 90 ? 0 : 226 * unit), 10);
    const target = forwardArm(r, p).wrist;
    const solved = solver({ rig: r, wrist: target, elbow: null, wristAngle: 0, previous: null });
    expect(solved.valid).toBe(true);
    expect(solved.wristError).toBeLessThan(1e-5);
  });
  it('左右の骨を鏡映配置しても、角度規約と骨長を変えない', () => {
    const left = rig(),
      right = { ...rig(), side: 'R' as const, joints: { ...rig().joints, shoulder: { x: -78, y: 240 } } };
    for (const p of [
      { shoulder: 65, elbow: 100, wrist: 25 },
      { shoulder: 110, elbow: 130, wrist: -30 },
    ]) {
      const a = forwardArmInModel(left, p),
        b = forwardArmInModel(right, p);
      expect(a.wrist.x).toBeCloseTo(-b.wrist.x, 10);
      expect(a.wrist.y).toBeCloseTo(b.wrist.y, 10);
      expect(Math.hypot(a.wrist.x - a.elbow.x, a.wrist.y - a.elbow.y)).toBeCloseTo(108, 10);
    }
  });
  it('組合せ制約へ最短角度投影し、静的評価を繰り返しても累積しない', () => {
    const r = rig();
    r.limits.hand.max = 200;
    const p = constraint({ shoulder: 100, elbow: 100, wrist: 30 }, r.limits, 1, r.restPose);
    // 3つの角度を均等に10度ずつ戻すのが最短（ほかの制約に当たらない）。
    expect(p).toEqual({ shoulder: 90, elbow: 90, wrist: 20 });
    expect(constraint(p, r.limits, 1, r.restPose)).toEqual(p);
  });
  it('単独クランプでは不可能な狭い合成角度でも解を返す', () => {
    const r = rig();
    r.limits.forearm = { min: 100, max: 120 };
    r.limits.hand = { min: 110, max: 115 };
    for (const shoulder of [-1000, -25, 0, 90, 160, 1000])
      for (const elbow of [-1000, 0, 145, 1000]) {
        const p = constraint({ shoulder, elbow, wrist: 100 }, r.limits, 1, r.restPose);
        expect(armPoseInLimits(p, r.limits, 1)).toBe(true);
      }
  });
  it('曲げる側を反転するモデルでも解を固定し、解析できる点を追える', () => {
    const r = rig();
    r.bendSign = -1;
    r.limits.forearm = { min: -170, max: 170 };
    r.limits.hand = { min: -170, max: 170 };
    const p = { shoulder: 80, elbow: 90, wrist: 5 },
      target = forwardArm(r, p);
    const out = solver({ rig: r, wrist: target.wrist, elbow: target.elbow, wristAngle: 5, previous: null });
    expect(out.valid).toBe(true);
    expect(out.wristError).toBeLessThan(0.001);
    expect(out.pose.elbow).toBeGreaterThan(0);
  });
  it('無効入力は休止へ、壊れた骨・空の制約は明示的に無効へ戻す', () => {
    const r = rig();
    expect(solver({ rig: r, wrist: { x: NaN, y: 0 }, elbow: null, wristAngle: 0, previous: null }).reasons).toContain(
      'invalid-input',
    );
    r.lengths.upper = 1e-12;
    expect(solver({ rig: r, wrist: { x: 10, y: 20 }, elbow: null, wristAngle: 0, previous: null }).valid).toBe(false);
    r.lengths.upper = 118;
    r.limits.forearm = { min: 400, max: 410 };
    expect(() => constraint(r.restPose, r.limits, 1, r.restPose)).toThrow(RangeError);
    expect(solver({ rig: r, wrist: { x: 10, y: 20 }, elbow: null, wristAngle: 0, previous: null }).valid).toBe(false);
  });
  it('到達不能でも骨長と曲がる側を保つ', () => {
    const r = rig();
    for (const wrist of [
      { x: -500, y: -500 },
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ]) {
      const out = solver({ rig: r, wrist, elbow: null, wristAngle: 1000, previous: null });
      expect(out.valid).toBe(true);
      expect(armPoseInLimits(out.pose, r.limits, 1)).toBe(true);
      expect(Math.hypot(out.elbow.x, out.elbow.y)).toBeCloseTo(118, 8);
      expect(Math.hypot(out.wrist.x - out.elbow.x, out.wrist.y - out.elbow.y)).toBeCloseTo(108, 8);
      expect(out.reasons).toContain('unreachable');
    }
  });
  it('手振り600点の連続掃引で一周・逆曲がりを起こさない', () => {
    const r = rig();
    let previous: ArmPose | null = null,
      maxDelta = 0;
    for (let i = 0; i <= 600; i++) {
      const t = (i * Math.PI) / 30,
        p = { shoulder: 65 + 6 * Math.sin(t), elbow: 100 + 10 * Math.sin(t), wrist: 25 * Math.cos(t) },
        target = forwardArm(r, p);
      const out = solver({ rig: r, wrist: target.wrist, elbow: target.elbow, wristAngle: p.wrist, previous });
      expect(armPoseInLimits(out.pose, r.limits, 1)).toBe(true);
      expect(out.wristError).toBeLessThan(0.2);
      if (previous)
        maxDelta = Math.max(
          maxDelta,
          ...(['shoulder', 'elbow', 'wrist'] as const).map((k) => Math.abs(out.pose[k] - previous![k])),
        );
      previous = out.pose;
    }
    expect(maxDelta).toBeLessThan(3);
  });
  it('atan2の±180度を跨ぐ目標で不要な一周を足さない', () => {
    const r = rig();
    r.limits.shoulder = { min: -10, max: 190 };
    r.limits.forearm = { min: -10, max: 300 };
    let previous: ArmPose | null = null;
    for (let a = 175; a <= 185; a += 0.25) {
      const target = forwardArm(r, { shoulder: a, elbow: 0, wrist: 0 });
      const out = solver({ rig: r, wrist: target.wrist, elbow: null, wristAngle: 0, previous });
      expect(out.wristError).toBeLessThan(0.2);
      if (previous) expect(Math.abs(out.pose.shoulder - previous.shoulder)).toBeLessThan(1);
      previous = out.pose;
    }
  });
});
