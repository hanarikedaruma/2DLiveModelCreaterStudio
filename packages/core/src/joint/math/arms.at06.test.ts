// AT-06 の独立確認（CL、2026-11-01）。実装（kinematics.ts・constraints.ts）とは別に、手計算・総当たり・AT-02の基準データで確かめる。
// 角度は度、下向き0、外向きが正。前腕 = 肩 + bendSign × 肘、手 = 前腕 + 手首（CC-032）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  armParameterIds,
  defaultArmLimits,
  type ArmLimits,
  type ArmPose,
  type ArmRig,
  type ArmSide,
  type Vec2,
} from '@app/schema';
import { armPoseInLimits, constrainArmPose, forwardArm, forwardArmInModel, solveArmIK } from './index';

const RAD = Math.PI / 180;
const REST: ArmPose = { shoulder: 8, elbow: 12, wrist: 0 };

function rig(side: ArmSide, patch: Partial<ArmRig> = {}): ArmRig {
  return {
    id: `arm${side}`,
    side,
    enabled: true,
    parentPartId: null,
    groups: { shoulder: 's', elbow: 'e', wrist: 'w' },
    joints: { shoulder: { x: side === 'L' ? 78 : -78, y: 240 }, elbow: { x: 0, y: 0 }, wrist: { x: 0, y: 0 } },
    lengths: { upper: 118, lower: 108 },
    bendSign: 1,
    referencePose: { ...REST },
    restPose: { ...REST },
    limits: defaultArmLimits(),
    hands: {},
    restHand: 'open',
    parameters: armParameterIds(side),
    ...patch,
  };
}
// 独立に書いた順運動学（肩原点・外向き+x・下+y）
function fk(u: number, v: number, sign: 1 | -1, p: ArmPose): { elbow: Vec2; wrist: Vec2 } {
  const elbow = { x: u * Math.sin(p.shoulder * RAD), y: u * Math.cos(p.shoulder * RAD) };
  const f = (p.shoulder + sign * p.elbow) * RAD;
  return { elbow, wrist: { x: elbow.x + v * Math.sin(f), y: elbow.y + v * Math.cos(f) } };
}
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const solve = (
  r: ArmRig,
  wrist: Vec2,
  extra: { elbow?: Vec2 | null; wristAngle?: number | null; previous?: ArmPose | null } = {},
) =>
  solveArmIK({
    rig: r,
    wrist,
    elbow: extra.elbow ?? null,
    wristAngle: extra.wristAngle ?? null,
    previous: extra.previous ?? null,
  });
const finitePose = (p: ArmPose) => [p.shoulder, p.elbow, p.wrist].every(Number.isFinite);

describe('AT-06 独立確認: 順運動学', () => {
  it('0・45・90°の手計算と一致する（曲がる側の両方）', () => {
    const r = rig('L', { lengths: { upper: 100, lower: 80 } });
    const s2 = Math.SQRT1_2;
    const cases: [ArmPose, 1 | -1, Vec2, Vec2][] = [
      [{ shoulder: 0, elbow: 0, wrist: 0 }, 1, { x: 0, y: 100 }, { x: 0, y: 180 }],
      [{ shoulder: 90, elbow: 0, wrist: 0 }, 1, { x: 100, y: 0 }, { x: 180, y: 0 }],
      [{ shoulder: 45, elbow: 45, wrist: 0 }, 1, { x: 100 * s2, y: 100 * s2 }, { x: 100 * s2 + 80, y: 100 * s2 }],
      [{ shoulder: 45, elbow: 45, wrist: 0 }, -1, { x: 100 * s2, y: 100 * s2 }, { x: 100 * s2, y: 100 * s2 + 80 }],
      [{ shoulder: 90, elbow: 90, wrist: 0 }, 1, { x: 100, y: 0 }, { x: 100, y: -80 }],
    ];
    for (const [pose, sign, elbow, wrist] of cases) {
      const got = forwardArm({ ...r, bendSign: sign }, pose);
      expect(dist(got.elbow, elbow)).toBeLessThan(1e-9);
      expect(dist(got.wrist, wrist)).toBeLessThan(1e-9);
    }
  });

  it('モデルへの配置は L が +x、R が −x の鏡映で、肩の位置を足すだけ', () => {
    const pose = { shoulder: 55, elbow: 45, wrist: 0 };
    const l = forwardArmInModel(rig('L'), pose);
    const r = forwardArmInModel(rig('R'), pose);
    const local = fk(118, 108, 1, pose);
    expect(dist(l.wrist, { x: 78 + local.wrist.x, y: 240 + local.wrist.y })).toBeLessThan(1e-9);
    expect(dist(r.wrist, { x: -78 - local.wrist.x, y: 240 + local.wrist.y })).toBeLessThan(1e-9);
    expect(l.shoulder).toEqual({ x: 78, y: 240 });
  });

  it('AT-02 の基準データ（16姿勢・左右）のモデル座標と一致する', () => {
    const path = fileURLToPath(new URL('../../../../../docs/arm-tracking/evidence/AT-02/poses.json', import.meta.url));
    const data = JSON.parse(readFileSync(path, 'utf8')) as {
      poses: {
        name: string;
        applied: { side: ArmSide; pose: ArmPose; model: Record<'shoulder' | 'elbow' | 'wrist', Vec2> }[];
      }[];
    };
    let n = 0;
    for (const p of data.poses)
      for (const a of p.applied) {
        const got = forwardArmInModel(rig(a.side), a.pose);
        for (const k of ['shoulder', 'elbow', 'wrist'] as const)
          expect(dist(got[k], a.model[k]), `${p.name} ${a.side} ${k}`).toBeLessThan(1e-6);
        n++;
      }
    expect(n).toBe(32);
  });

  it('AT-02 で制約に掛かった2姿勢：AT-06 の投影は可動域の中で、AT-02 の試作の結果より遠くない', () => {
    const cases: [ArmPose, ArmPose][] = [
      [
        { shoulder: 160, elbow: 145, wrist: 40 },
        { shoulder: 160, elbow: 140, wrist: 0 },
      ],
      [
        { shoulder: -25, elbow: 0, wrist: -40 },
        { shoulder: -25, elbow: 0, wrist: -30 },
      ],
    ];
    const d = (a: ArmPose, b: ArmPose) => Math.hypot(a.shoulder - b.shoulder, a.elbow - b.elbow, a.wrist - b.wrist);
    for (const [requested, at02] of cases) {
      const got = constrainArmPose(requested, defaultArmLimits(), 1, REST);
      expect(armPoseInLimits(got, defaultArmLimits(), 1)).toBe(true);
      expect(d(got, requested)).toBeLessThanOrEqual(d(at02, requested) + 1e-9);
    }
  });
});

describe('AT-06 独立確認: IK', () => {
  // 許可範囲の中の姿勢を前から解いて、同じ手首へ戻れるか（固定した肘の枝は一意）
  const reachable: ArmPose[] = [
    { shoulder: 0, elbow: 0, wrist: 0 },
    { shoulder: 45, elbow: 0, wrist: 0 },
    { shoulder: 90, elbow: 0, wrist: 0 },
    { shoulder: 45, elbow: 45, wrist: 0 },
    { shoulder: 90, elbow: 90, wrist: 0 },
    { shoulder: 55, elbow: 145, wrist: 0 },
    { shoulder: 110, elbow: 130, wrist: 0 },
    { shoulder: 160, elbow: 20, wrist: 0 },
  ];

  for (const side of ['L', 'R'] as const)
    for (const sign of [1, -1] as const)
      it(`手計算の姿勢へ戻る（${side}・曲がる側 ${sign}）`, () => {
        // 両方の曲がる側の姿勢が入るよう、前腕・手の合成角を広げる（区間の幅は360°未満の約束）
        const r = rig(side, {
          bendSign: sign,
          limits: { ...defaultArmLimits(), forearm: { min: -100, max: 250 }, hand: { min: -105, max: 254 } },
        });
        for (const pose of reachable) {
          if (pose.shoulder + sign * pose.elbow < -100) continue;
          const target = fk(118, 108, sign, pose);
          const res = solve(r, target.wrist, { elbow: target.elbow });
          expect(res.valid).toBe(true);
          expect(dist(fk(118, 108, sign, res.pose).wrist, target.wrist), JSON.stringify(pose)).toBeLessThan(0.5);
          expect(Math.abs(res.pose.elbow - pose.elbow), JSON.stringify(pose)).toBeLessThan(1);
          expect(Math.abs(res.pose.shoulder - pose.shoulder), JSON.stringify(pose)).toBeLessThan(1);
          // 返す肘・手首の位置は、返した姿勢の順運動学と同じ
          expect(dist(res.elbow, fk(118, 108, sign, res.pose).elbow)).toBeLessThan(1e-6);
          expect(dist(res.wrist, fk(118, 108, sign, res.pose).wrist)).toBeLessThan(1e-6);
        }
      });

  it('左右で同じ入力なら同じ角度（左右の差はモデルへの配置だけ）', () => {
    const target = fk(118, 108, 1, { shoulder: 70, elbow: 60, wrist: 0 }).wrist;
    expect(solve(rig('L'), target).pose).toEqual(solve(rig('R'), target).pose);
  });

  for (const lengths of [
    { upper: 60, lower: 140 },
    { upper: 150, lower: 50 },
    { upper: 1, lower: 1 },
  ])
    it(`骨の長さ ${lengths.upper}・${lengths.lower} でも手首へ届き、曲がる側を守る`, () => {
      const r = rig('L', { lengths });
      for (const pose of [
        { shoulder: 30, elbow: 40, wrist: 0 },
        { shoulder: 80, elbow: 100, wrist: 0 },
      ]) {
        const target = fk(lengths.upper, lengths.lower, 1, pose).wrist;
        const res = solve(r, target);
        expect(dist(fk(lengths.upper, lengths.lower, 1, res.pose).wrist, target)).toBeLessThan(
          0.01 * (lengths.upper + lengths.lower),
        );
        expect(res.pose.elbow).toBeGreaterThanOrEqual(0);
      }
    });

  it('届かない目標：有限で可動域の中、腕を伸ばして目標の向きへ、誤差と理由を返す', () => {
    const r = rig('L');
    const reach = 118 + 108;
    for (const angle of [30, 60, 90, 120]) {
      const target = { x: 2 * reach * Math.sin(angle * RAD), y: 2 * reach * Math.cos(angle * RAD) };
      const res = solve(r, target);
      expect(res.valid).toBe(true);
      expect(finitePose(res.pose)).toBe(true);
      expect(armPoseInLimits(res.pose, r.limits, 1)).toBe(true);
      expect(res.reasons).toContain('unreachable');
      expect(res.wristError).toBeGreaterThanOrEqual(reach - 1e-6);
      expect(res.wristError).toBeLessThan(reach + 1);
      // 伸ばした腕の手首が、目標の向き（±3°）を指す
      const w = fk(118, 108, 1, res.pose).wrist;
      expect(Math.abs(Math.atan2(w.x, w.y) / RAD - angle)).toBeLessThan(3);
    }
  });

  it('特異点：肩の上・伸び切り・内側の短すぎる目標でも有限で可動域の中', () => {
    const r = rig('L');
    for (const target of [
      { x: 0, y: 0 },
      { x: 0, y: 226 },
      { x: 226, y: 0 },
      { x: 0, y: 5 },
      { x: 1e-12, y: -1e-12 },
    ]) {
      const res = solve(r, target);
      expect(res.valid).toBe(true);
      expect(finitePose(res.pose)).toBe(true);
      expect(armPoseInLimits(res.pose, r.limits, 1)).toBe(true);
    }
    expect(dist(fk(118, 108, 1, solve(r, { x: 0, y: 226 }).pose).wrist, { x: 0, y: 226 })).toBeLessThan(0.5);
  });

  it('不正な入力は休止姿勢と invalid-input、壊れた骨・空の可動域は無効（invalid-rig）', () => {
    const r = rig('L');
    for (const input of [
      { x: Number.NaN, y: 1 },
      { x: Infinity, y: 0 },
    ])
      expect(solve(r, input)).toMatchObject({ valid: true, pose: REST, reasons: ['invalid-input'] });
    expect(solve(r, { x: 10, y: 100 }, { wristAngle: Number.NaN }).reasons).toContain('invalid-input');
    for (const lengths of [
      { upper: 0, lower: 108 },
      { upper: Number.NaN, lower: 108 },
      { upper: 1e10, lower: 1 },
    ])
      expect(solve(rig('L', { lengths }), { x: 10, y: 100 })).toMatchObject({ valid: false, reasons: ['invalid-rig'] });
    const empty: ArmLimits = { ...defaultArmLimits(), forearm: { min: 290, max: 300 }, shoulder: { min: -25, max: 0 } };
    expect(solve(rig('L', { limits: empty }), { x: 10, y: 100 })).toMatchObject({
      valid: false,
      reasons: ['invalid-rig'],
    });
  });

  it('連続した掃引（手振り）で、骨の長さ・可動域・曲がる側を守り、余分な一周・跳びが無い', () => {
    const r = rig('L');
    let previous: ArmPose | null = null;
    for (let i = 0; i <= 720; i++) {
      const t = i / 720;
      const pose = {
        shoulder: 80 + 60 * Math.sin(2 * Math.PI * 2 * t),
        elbow: 70 + 50 * Math.sin(2 * Math.PI * 3 * t + 1),
        wrist: 0,
      };
      const target = fk(118, 108, 1, pose);
      const res = solve(r, target.wrist, { elbow: target.elbow, previous });
      const got = fk(118, 108, 1, res.pose);
      expect(Math.abs(Math.hypot(got.elbow.x, got.elbow.y) - 118)).toBeLessThan(1e-6);
      expect(Math.abs(dist(got.wrist, got.elbow) - 108)).toBeLessThan(1e-6);
      expect(armPoseInLimits(res.pose, r.limits, 1)).toBe(true);
      expect(res.pose.elbow).toBeGreaterThanOrEqual(0);
      expect(dist(got.wrist, target.wrist)).toBeLessThan(0.5);
      if (previous) {
        expect(Math.abs(res.pose.shoulder - previous.shoulder)).toBeLessThan(5);
        expect(Math.abs(res.pose.elbow - previous.elbow)).toBeLessThan(5);
      }
      previous = res.pose;
    }
  });

  it('真上（atan2 の ±180°）を左右に横切る目標で、角度が一周分跳ばない', () => {
    const r = rig('L', {
      limits: { ...defaultArmLimits(), shoulder: { min: -25, max: 179 }, forearm: { min: -25, max: 330 } },
    });
    let previous: ArmPose | null = null;
    for (let x = 30; x >= -30; x -= 1) {
      const res = solve(r, { x, y: -200 }, { previous });
      expect(finitePose(res.pose)).toBe(true);
      expect(res.pose.shoulder).toBeGreaterThanOrEqual(-25 - 1e-9);
      expect(res.pose.shoulder).toBeLessThanOrEqual(179 + 1e-9);
      if (previous) expect(Math.abs(res.pose.shoulder - previous.shoulder)).toBeLessThan(20);
      previous = res.pose;
    }
  });

  it('手首の角度の要求は可動域と手の合成角の中へ収める', () => {
    const r = rig('L');
    const target = fk(118, 108, 1, { shoulder: 60, elbow: 30, wrist: 0 }).wrist;
    expect(solve(r, target, { wristAngle: 25 }).pose.wrist).toBeCloseTo(25, 6);
    expect(solve(r, target, { wristAngle: 90 }).pose.wrist).toBeCloseTo(40, 6);
    expect(solve(r, target, { wristAngle: -90 }).pose.wrist).toBeCloseTo(-40, 6);
  });
});

describe('AT-06 独立確認: 静的な制約', () => {
  const limits = defaultArmLimits();
  // 許可範囲を2°刻みで総当たりし、最も近い点までの距離（角度の空間）
  function nearestGrid(p: ArmPose, l: ArmLimits, sign: 1 | -1): number {
    let best = Infinity;
    for (let s = l.shoulder.min; s <= l.shoulder.max; s += 2)
      for (let e = l.elbow.min; e <= l.elbow.max; e += 2)
        for (let w = l.wrist.min; w <= l.wrist.max; w += 2) {
          const q = { shoulder: s, elbow: e, wrist: w };
          if (!armPoseInLimits(q, l, sign)) continue;
          const d = Math.hypot(s - p.shoulder, e - p.elbow, w - p.wrist);
          if (d < best) best = d;
        }
    return best;
  }

  it('中の姿勢はそのまま、外の姿勢は許可範囲の中で総当たりより遠くない点へ投影する', () => {
    expect(constrainArmPose({ shoulder: 50, elbow: 60, wrist: 10 }, limits, 1, REST)).toEqual({
      shoulder: 50,
      elbow: 60,
      wrist: 10,
    });
    const narrow: ArmLimits = { ...limits, forearm: { min: 40, max: 120 }, hand: { min: 30, max: 130 } };
    for (const [p, l] of [
      [{ shoulder: 160, elbow: 145, wrist: 40 }, limits],
      [{ shoulder: -25, elbow: 0, wrist: -40 }, limits],
      [{ shoulder: 200, elbow: -30, wrist: 90 }, limits],
      [{ shoulder: 10, elbow: 10, wrist: 0 }, narrow],
      [{ shoulder: 150, elbow: 120, wrist: 30 }, narrow],
    ] as [ArmPose, ArmLimits][]) {
      const got = constrainArmPose(p, l, 1, REST);
      expect(armPoseInLimits(got, l, 1)).toBe(true);
      const d = Math.hypot(got.shoulder - p.shoulder, got.elbow - p.elbow, got.wrist - p.wrist);
      expect(d, JSON.stringify(p)).toBeLessThanOrEqual(nearestGrid(p, l, 1) + 1e-6);
    }
  });

  it('同じ入力には呼ぶ順に関係なく同じ結果で、2回掛けても変わらない', () => {
    const inputs: ArmPose[] = [
      { shoulder: 170, elbow: 150, wrist: 50 },
      { shoulder: -40, elbow: 10, wrist: -60 },
      { shoulder: 100, elbow: 200, wrist: 0 },
    ];
    const first = inputs.map((p) => constrainArmPose(p, limits, 1, REST));
    const reversed = [...inputs]
      .reverse()
      .map((p) => constrainArmPose(p, limits, 1, REST))
      .reverse();
    expect(reversed).toEqual(first);
    for (const p of first) expect(constrainArmPose(p, limits, 1, REST)).toEqual(p);
  });

  it('非有限の入力は代わりの姿勢を使い、空の可動域は例外', () => {
    expect(
      armPoseInLimits(constrainArmPose({ shoulder: Number.NaN, elbow: 0, wrist: 0 }, limits, 1, REST), limits, 1),
    ).toBe(true);
    expect(constrainArmPose({ shoulder: Number.NaN, elbow: 0, wrist: 0 }, limits, 1, REST)).toEqual(REST);
    const empty: ArmLimits = { ...limits, forearm: { min: 290, max: 300 }, shoulder: { min: -25, max: 0 } };
    expect(() => constrainArmPose(REST, empty, 1, REST)).toThrow(RangeError);
  });
});
