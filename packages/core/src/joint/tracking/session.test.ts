import { describe, expect, it } from 'vitest';
import type { ArmMotionStatus, ArmObservation, HandShapeResult, Layer } from '@app/contracts';
import {
  armPoseAllowed,
  defaultArmTrackingSettings,
  type ArmPose,
  type ArmSide,
  type ArmSideSettings,
  type ArmTrackingSettings,
} from '@app/schema';
import { ARM_RATE } from './rate';
import { constrainArmPose, solveArmIK } from '../math';
import { createArmMotionSession, MOTION_TIMING, type ArmMotionDeps, type ArmMotionSessionImpl } from './session';
import { frame, observation, REST, shapeResult, testDeps, testModel, testRig } from './testing';

const POSE: ArmPose = { shoulder: 60, elbow: 40, wrist: 0 };

function settings(patch: Partial<Record<ArmSide, Partial<ArmSideSettings>>> = {}): ArmTrackingSettings {
  const s = defaultArmTrackingSettings();
  for (const side of ['L', 'R'] as const) s.sides[side] = { ...s.sides[side], enabled: true, ...patch[side] };
  return s;
}

type ObsFn = (t: number) => Partial<Record<ArmSide, ArmObservation | null>>;
interface Sample {
  t: number;
  status: Record<ArmSide, ArmMotionStatus>;
  layer: Layer | null;
}
// 観測（撮影時刻 obsFps、届くのは latency 後）と描画（tickFps）を時刻の順に流す
function run(
  s: ArmMotionSessionImpl,
  options: {
    from?: number;
    to: number;
    obsFps?: number;
    tickFps?: number;
    latency?: number;
    obs: ObsFn;
    shapes?: (t: number) => Partial<Record<ArmSide, HandShapeResult>>;
  },
): Sample[] {
  const { from = 0, to, obsFps = 30, tickFps = 60, latency = 40 } = options;
  const events: { at: number; kind: 'obs' | 'tick'; t: number }[] = [];
  for (let k = Math.ceil((from * obsFps) / 1000); (k * 1000) / obsFps < to; k++) {
    const t = (k * 1000) / obsFps;
    events.push({ at: t + latency, kind: 'obs', t });
  }
  for (let k = Math.ceil((from * tickFps) / 1000); (k * 1000) / tickFps < to; k++)
    events.push({ at: (k * 1000) / tickFps, kind: 'tick', t: (k * 1000) / tickFps });
  events.sort((a, b) => a.at - b.at || (a.kind === 'obs' ? -1 : 1));
  const out: Sample[] = [];
  for (const e of events) {
    if (e.kind === 'obs') {
      const arms = Object.fromEntries(Object.entries(options.obs(e.t)).filter(([, v]) => v)) as Partial<
        Record<ArmSide, ArmObservation>
      >;
      s.update({ body: frame(arms), shapes: options.shapes?.(e.t) ?? {} });
    } else {
      const layer = s.tick(e.t);
      out.push({ t: e.t, status: s.status(), layer });
    }
  }
  return out;
}
const near = (a: ArmPose, b: ArmPose, tol: number) =>
  Math.abs(a.shoulder - b.shoulder) <= tol && Math.abs(a.elbow - b.elbow) <= tol && Math.abs(a.wrist - b.wrist) <= tol;
const firstAt = (samples: Sample[], side: ArmSide, state: string) =>
  samples.find((x) => x.status[side].state === state)?.t ?? null;

// 試験用の単純なIK・制約と、AT-06（CO v1）の solveArmIK・constrainArmPose の両方で同じ試験を流す
const DEPS: [string, ArmMotionDeps][] = [
  ['試験用のIK', testDeps],
  ['AT-06のIK', { solveIK: solveArmIK, constrain: constrainArmPose }],
];
for (const [label, deps] of DEPS) {
  function session(patch?: Parameters<typeof settings>[0]): ArmMotionSessionImpl {
    const s = createArmMotionSession(deps);
    s.configure(testModel(), settings(patch));
    return s;
  }
  describe(`腕の追従（AT-09・${label}）`, () => {
    it('同じ姿勢の観測に追従し、左右のパラメータと手形の重み（1つだけ1）を出す', () => {
      const s = session();
      const samples = run(s, {
        to: 1000,
        obs: (t) => ({ L: observation('L', POSE, t), R: observation('R', POSE, t) }),
        shapes: (t) => ({ L: shapeResult('L', t, 'peace') }),
      });
      const last = samples.at(-1)!;
      expect(last.status.L.state).toBe('tracking');
      // 掌の軸は下向き（0°）なので、手首は前腕（100°）から戻す向き。可動域の端（-40°）で止まる
      expect(near(last.status.L.pose!, { ...POSE, wrist: -40 }, 0.5)).toBe(true);
      expect(near(last.status.R.pose!, POSE, 0.5)).toBe(true); // 掌の軸が無い側は休止の手首の角度
      expect(last.status.L).toMatchObject({ handState: 'tracking', hand: 'peace' });
      expect(last.layer!.values).toMatchObject({
        ArmShoulderL: expect.any(Number),
        HandPeaceL: 1,
        HandOpenL: 0,
        HandFistL: 0,
      });
      expect(last.status.R).toMatchObject({ handState: 'rest', hand: 'open' }); // 手形の観測が無い側は休止形
      expect(last.layer!.values.HandOpenR).toBe(1);
    });

    it('肘だけ見えなければ「肘を補う」で追従を続ける', () => {
      const s = session();
      const samples = run(s, {
        to: 600,
        obs: (t) => ({ L: observation('L', POSE, t, { validity: 'inferred', elbow: false }) }),
      });
      expect(samples.at(-1)!.status.L.state).toBe('inferred');
      expect(near(samples.at(-1)!.status.L.pose!, POSE, 1)).toBe(true);
    });

    for (const obsFps of [15, 30, 60])
      it(`片側を見失うと200ms保持・500msで休止へ戻り、反対側は追従を続ける（観測 ${obsFps}fps）`, () => {
        const s = session();
        const lost = 1000;
        let lastValid = 0;
        const samples = run(s, {
          to: 2200,
          obsFps,
          obs: (t) => {
            if (t < lost) lastValid = t;
            return {
              L: t < lost ? observation('L', POSE, t) : observation('L', POSE, t, { validity: 'missing' }),
              R: observation('R', POSE, t),
            };
          },
        });
        const after = samples.filter((x) => x.t >= lost);
        const holding = firstAt(after, 'L', 'holding')!;
        const returning = firstAt(after, 'L', 'returning')!;
        const rest = firstAt(after, 'L', 'rest')!;
        const tick = 1000 / 60;
        expect(returning - lastValid).toBeGreaterThanOrEqual(MOTION_TIMING.holdMs);
        expect(returning - lastValid).toBeLessThanOrEqual(MOTION_TIMING.holdMs + tick);
        expect(rest - lastValid).toBeGreaterThanOrEqual(MOTION_TIMING.holdMs + MOTION_TIMING.returnMs);
        expect(rest - lastValid).toBeLessThanOrEqual(MOTION_TIMING.holdMs + MOTION_TIMING.returnMs + tick);
        // 保持の間は動かない（外挿しない）
        const held = samples.filter((x) => x.t >= holding && x.t < returning).map((x) => x.status.L.pose!);
        expect(held.every((p) => near(p, held[0]!, 1e-9))).toBe(true);
        expect(near(samples.at(-1)!.status.L.pose!, REST, 1e-6)).toBe(true);
        // 休止でも重みを0にせず、休止姿勢の値と休止形を出す
        expect(samples.at(-1)!.layer!.values).toMatchObject({
          ArmShoulderL: REST.shoulder,
          ArmElbowL: REST.elbow,
          HandOpenL: 1,
        });
        // 反対側は影響を受けない（最初の休止からの復帰が済んだ後は、ずっと追従）
        expect(samples.every((x) => x.t < 500 || x.status.R.state === 'tracking')).toBe(true);
      });

    it('古い観測の再通知では保持を延ばさない', () => {
      const s = session();
      run(s, { to: 1000, obs: (t) => ({ L: observation('L', POSE, t) }) });
      s.update({ body: frame({ L: observation('L', POSE, 1000, { validity: 'missing' }) }), shapes: {} });
      s.tick(1100);
      s.update({ body: frame({ L: observation('L', POSE, 990) }), shapes: {} }); // 古い有効な観測が遅れて届いた
      s.tick(1200);
      expect(s.status().L.state).toBe('returning'); // 最後の有効（約967ms）から200msを過ぎた
    });

    it('戻っている・休止の間は、有効な観測が100ms続いてから200msで追従へつなぐ（跳ばない）', () => {
      const s = session();
      const back = 3000;
      const samples = run(s, {
        to: 4000,
        obs: (t) => ({
          L: t < 500 || t >= back ? observation('L', POSE, t) : observation('L', POSE, t, { validity: 'missing' }),
        }),
      });
      const recovering = firstAt(
        samples.filter((x) => x.t > back),
        'L',
        'recovering',
      )!;
      const tracking = firstAt(
        samples.filter((x) => x.t > back),
        'L',
        'tracking',
      )!;
      // 撮影時刻 back から100ms続いたことが分かるのは、その観測が届いた後
      expect(recovering).toBeGreaterThanOrEqual(back + MOTION_TIMING.reacquireMs);
      expect(tracking - recovering).toBeGreaterThanOrEqual(MOTION_TIMING.recoverMs - 1e-6);
      expect(tracking - recovering).toBeLessThanOrEqual(MOTION_TIMING.recoverMs + 1000 / 60);
      const states = samples.filter((x) => x.t > back && x.t < recovering).map((x) => x.status.L.state);
      expect(new Set(states)).toEqual(new Set(['rest']));
      // 1回の描画（1/60秒）で動く量は角速度の上限まで
      const step = ARM_RATE.maxSpeed / 60 + 1e-6;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!.status.L.pose!;
        const b = samples[i]!.status.L.pose!;
        expect(Math.abs(b.shoulder - a.shoulder)).toBeLessThanOrEqual(step);
        expect(Math.abs(b.elbow - a.elbow)).toBeLessThanOrEqual(step);
      }
    });

    it('保持の間に観測が戻れば、確認を待たずにそのまま追従する', () => {
      const s = session();
      const samples = run(s, {
        to: 1500,
        obs: (t) => ({
          L: t >= 1000 && t < 1100 ? observation('L', POSE, t, { validity: 'ambiguous' }) : observation('L', POSE, t),
        }),
      });
      const states = samples.filter((x) => x.t > 1000).map((x) => x.status.L.state);
      expect(states).toContain('holding');
      expect(states).not.toContain('returning');
      expect(states).not.toContain('recovering');
      expect(states.at(-1)).toBe('tracking');
    });

    it('止まった後の大きな dt で一気に動かさず、戻った時刻では進めない', () => {
      const s = session();
      s.tick(0);
      s.update({ body: frame({ L: observation('L', POSE, 0) }), shapes: {} });
      s.tick(10);
      const before = s.status().L.pose!;
      s.tick(5000);
      const after = s.status().L.pose!;
      expect(Math.abs(after.shoulder - before.shoulder)).toBeLessThanOrEqual(
        (ARM_RATE.maxSpeed * MOTION_TIMING.maxTickDtMs) / 1000 + 1e-6,
      );
      s.tick(4000);
      expect(s.status().L.pose).toEqual(after);
    });

    it('手だけ見失っても腕は追従を続け、手形は500ms保持してから休止形、手首は200ms保持してから休止の角度へ戻る', () => {
      const s = session();
      const handLost = 1000;
      const samples = run(s, {
        to: 2500,
        obs: (t) => ({ L: observation('L', POSE, t) }),
        // 掌の軸は外向き（水平）。手形はピース
        shapes: (t) => (t < handLost ? { L: shapeResult('L', t, 'peace', { axis: { x: 1, y: 0 } }) } : {}),
      });
      const at = (t: number) => samples.find((x) => x.t >= t)!.status.L;
      expect(samples.every((x) => x.t < 500 || x.status.L.state === 'tracking')).toBe(true);
      const tracked = at(900);
      expect(tracked).toMatchObject({ handState: 'tracking', hand: 'peace' });
      // 手の向き（前腕＋手首）が掌の軸（外向き＝90°）に合う。手首の可動域（±40°）の中で
      expect(tracked.pose!.wrist).toBeCloseTo(Math.max(-40, Math.min(40, 90 - (POSE.shoulder + POSE.elbow))), 0);
      expect(at(handLost + 350)).toMatchObject({ handState: 'holding', hand: 'peace' });
      expect(at(handLost + 700)).toMatchObject({ handState: 'rest', hand: 'open' });
      expect(at(handLost + 100).pose!.wrist).toBeCloseTo(tracked.pose!.wrist, 1);
      expect(at(handLost + 1400).pose!.wrist).toBeCloseTo(REST.wrist, 1);
    });

    it('手形を固定しても腕は追従し、固定した形の重みだけ1', () => {
      const s = session({ L: { handMode: 'fist' } });
      const samples = run(s, {
        to: 600,
        obs: (t) => ({ L: observation('L', POSE, t) }),
        shapes: (t) => ({ L: shapeResult('L', t, 'peace') }),
      });
      const last = samples.at(-1)!;
      expect(last.status.L).toMatchObject({ state: 'tracking', handState: 'fixed', hand: 'fist' });
      expect(last.layer!.values).toMatchObject({ HandFistL: 1, HandPeaceL: 0 });
    });

    it('動きの大きさ：0なら休止姿勢、2なら休止からの関節の量が2倍（可動域の中）', () => {
      const target: ArmPose = { shoulder: 40, elbow: 30, wrist: 0 };
      for (const [gain, expected] of [
        [0, REST],
        [1, target],
        [2, { shoulder: 75, elbow: 50, wrist: 0 }],
      ] as const) {
        const s = session({ L: { gain } });
        const samples = run(s, { to: 1000, obs: (t) => ({ L: observation('L', target, t) }) });
        expect(near(samples.at(-1)!.status.L.pose!, expected, 0.5)).toBe(true);
      }
    });

    it('reset（世代・表示中の姿勢）：その姿勢から休止へ戻り始め、古い世代の観測を受け付けず、新しい観測でつなぐ', () => {
      const s = session();
      run(s, { to: 600, obs: (t) => ({ L: observation('L', POSE, t) }) });
      const displayed = { ArmShoulderL: 100, ArmElbowL: 20, HandAngleL: 10 };
      s.reset(2, displayed);
      s.tick(700);
      expect(s.status().L.state).toBe('returning');
      expect(near(s.status().L.pose!, { shoulder: 100, elbow: 20, wrist: 10 }, 0.1)).toBe(true);
      s.update({ body: frame({ L: observation('L', POSE, 710) }, 1), shapes: {} }); // 古い世代
      s.tick(1400);
      s.tick(1500);
      expect(s.status().L.state).toBe('rest');
      const samples = run(s, {
        from: 1500,
        to: 2400,
        obs: (t) => ({ L: observation('L', POSE, t, { generation: 2 }) }),
      });
      expect(samples.map((x) => x.status.L.state)).toContain('recovering');
      expect(near(samples.at(-1)!.status.L.pose!, POSE, 0.5)).toBe(true);
    });

    it('観測の世代が上がると、前の連続性を捨てて休止を経てつなぎ直す', () => {
      const s = session();
      run(s, { to: 600, obs: (t) => ({ L: observation('L', POSE, t) }) });
      const samples = run(s, {
        from: 600,
        to: 1600,
        obs: (t) => ({ L: observation('L', POSE, t, { generation: 2 }) }),
      });
      s.update({ body: frame({ L: observation('L', POSE, 1700, { generation: 1 }) }, 1), shapes: {} });
      const states = samples.map((x) => x.status.L.state);
      expect(states).toContain('returning');
      expect(states).toContain('recovering');
      expect(states.at(-1)).toBe('tracking');
    });

    it('届かない・不正な目標でも、全ての出力が可動域の中（制約違反0）', () => {
      const s = session();
      const rig = testRig('L');
      let seed = 7;
      const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const samples = run(s, {
        to: 3000,
        obs: (t) => {
          const o = observation('L', POSE, t);
          const k = Math.floor(t / 33) % 5;
          if (k === 0) o.wrist.position = { x: random() * 3, y: random() * 3 }; // 届かない
          if (k === 1) o.wrist.position = { x: Number.NaN, y: 0.5 };
          if (k === 2) o.wrist.position = { x: 0, y: 0 }; // 肩の上
          return { L: o };
        },
      });
      for (const x of samples) expect(armPoseAllowed(rig, x.status.L.pose!)).toBe(true);
    });

    it('切った側は値を出さず、リグが無効なら「使えない」。どちらも無ければレイヤーを出さない', () => {
      const s = createArmMotionSession(deps);
      s.configure(testModel([testRig('L'), testRig('R', { enabled: false })]), settings({ R: {} }));
      s.tick(0);
      expect(s.status().R.state).toBe('unavailable');
      expect(Object.keys(s.tick(16)!.values).every((k) => k.endsWith('L'))).toBe(true);
      s.configure(testModel(), settings({ L: { enabled: false }, R: { enabled: false } }));
      expect(s.tick(32)).toBeNull();
      expect(s.status().L.state).toBe('off');
    });

    it('リグが変わったら、その側は休止姿勢から始め直す', () => {
      const s = session();
      run(s, { to: 600, obs: (t) => ({ L: observation('L', POSE, t) }) });
      s.configure(testModel([testRig('L', { lengths: { upper: 120, lower: 90 } }), testRig('R')]), settings());
      s.tick(620);
      expect(s.status().L.state).toBe('rest');
      expect(near(s.status().L.pose!, REST, 1e-9)).toBe(true);
    });
  });

  describe(`ならしと遅れ（${label}）`, () => {
    // 出力が目標の何ms後を追っているか（二乗誤差が最小になる遅れ）
    function lagOf(samples: Sample[], target: (t: number) => number, skip = 500): number {
      let best = 0;
      let bestErr = Infinity;
      for (let lag = 0; lag <= 300; lag += 5) {
        let err = 0;
        for (const x of samples.filter((y) => y.t > skip)) err += (x.status.L.pose!.shoulder - target(x.t - lag)) ** 2;
        if (err < bestErr) {
          bestErr = err;
          best = lag;
        }
      }
      return best;
    }

    for (const hz of [1, 2])
      it(`${hz}Hzの手振り（肩 ±30°）：観測が届いてからの遅れ60ms以下、振幅を8割以上保つ`, () => {
        const s = session();
        const shoulder = (t: number) => 60 + 30 * Math.sin((2 * Math.PI * hz * t) / 1000);
        const samples = run(s, {
          to: 3000,
          obs: (t) => ({ L: observation('L', { shoulder: shoulder(t), elbow: 30, wrist: 0 }, t) }),
        });
        // 撮影から届くまでの40ms（推定の時間の見立て）を除いた、このセッションの遅れ
        const lag = lagOf(samples, shoulder) - 40;
        expect(lag).toBeLessThanOrEqual(60);
        const tail = samples.filter((x) => x.t > 1000).map((x) => x.status.L.pose!.shoulder);
        expect((Math.max(...tail) - Math.min(...tail)) / 60).toBeGreaterThanOrEqual(0.8);
      });

    it('静止中の観測の揺れを、なめらかさに応じて小さくする', () => {
      const jitter = (smoothing: number) => {
        const s = session({ L: { smoothing } });
        let seed = 3;
        const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
        const samples = run(s, {
          to: 3000,
          obs: (t) => ({ L: observation('L', POSE, t, { noise: { x: noise(), y: noise() } }) }),
        });
        const v = samples.filter((x) => x.t > 1000).map((x) => x.status.L.pose!.shoulder);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      };
      const raw = jitter(0);
      const standard = jitter(0.5);
      const strong = jitter(1);
      expect(standard).toBeLessThan(raw * 0.7);
      expect(strong).toBeLessThan(standard);
    });
  });
}
