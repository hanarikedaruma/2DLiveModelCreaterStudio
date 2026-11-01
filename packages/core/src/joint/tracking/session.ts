// モデルへの腕の追従（AT-09）。対応付け済みの観測（AT-05）と確定した手形（AT-07）から、左右の腕のパラメータを作る。
// 左右は別々に、追従・肘を補う・保持・休止へ戻る・休止・復帰を管理する。時間は最後に有効だった観測の撮影時刻から測り、
// 古い観測の再通知で保持を延ばさない。IKと静的制約は外から受け取る（AT-06。数学モジュールに時計・フィルタを入れない）。
// 手形の約120msの確定待ちはAT-07が済ませているので、ここでは確定した形の長い見失いと休止形だけを扱う
import {
  ARM_TIMING,
  type ArmConstraint,
  type ArmFollowState,
  type ArmIKSolver,
  type ArmLimitReason,
  type ArmMotionInput,
  type ArmMotionSession,
  type ArmMotionStatus,
  type ArmObservation,
  type HandShapeResult,
  type Layer,
  type ParamValues,
} from '@app/contracts';
import {
  HAND_SHAPES,
  type ArmPose,
  type ArmRig,
  type ArmSide,
  type ArmSideSettings,
  type ArmTrackingSettings,
  type HandShape,
  type Model,
  type Vec2,
} from '@app/schema';
import { armSmoothingToMinCutoff, PointFilter } from './filter';
import { approachPose, ease, lerpPose, wrapDegrees, zeroPose } from './rate';

export const MOTION_TIMING = Object.freeze({
  holdMs: ARM_TIMING.holdMs, // 腕を見失ってから、最後の姿勢を保つ時間
  returnMs: ARM_TIMING.returnMs, // その後、休止姿勢へ戻る時間
  reacquireMs: 100, // 戻っている・休止の間に、同じ側の有効な観測がこれだけ続いたら復帰を始める
  recoverMs: ARM_TIMING.recoverMs, // 復帰で今の姿勢から追従へつなぐ時間
  handFreshMs: ARM_TIMING.resultMaxAgeMs, // 手形・掌の軸の観測がこれより新しければ「追従中」
  shapeHoldMs: ARM_TIMING.shapeHoldMs, // 確定した手形を見失ってから保つ時間。過ぎたら休止形
  maxTickDtMs: ARM_TIMING.maxTickDtMs, // 1回の描画で進める時間の上限（止まった後の大きな dt で一気に動かさない）
});

const SIDES: ArmSide[] = ['L', 'R'];
type Mode = 'follow' | 'hold' | 'return' | 'rest' | 'recover';

interface SideState {
  rig: ArmRig | null;
  rigKey: string;
  rigBroken: boolean; // IKが腕の設定を不正と返した
  settings: ArmSideSettings;
  // 観測（撮影時刻）
  lastObsAt: number | null;
  lastValidAt: number | null;
  lastObsValid: boolean;
  runStartAt: number | null; // 今続いている有効な観測の最初
  elbowKnown: boolean;
  wristFilter: PointFilter;
  elbowFilter: PointFilter;
  ikPose: ArmPose | null; // 最後の有効な観測から解いた肩・肘
  reasons: ArmLimitReason[];
  shape: HandShapeResult | null;
  lastWristRel: number | null; // 掌の軸から求めた、前腕に対する手首の角度
  // 出力
  mode: Mode;
  output: ArmPose;
  velocity: ArmPose;
  from: ArmPose; // 戻る・復帰の始まりの姿勢
  since: number | null; // 戻る・復帰の始まり（null は次の描画から）
  handState: ArmMotionStatus['handState'];
  hand: HandShape | null;
}

const finitePoint = (p: Vec2 | null | undefined): p is Vec2 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const usable = (validity: string) => validity === 'valid' || validity === 'inferred';
const restOf = (s: SideState): ArmPose => (s.rig ? { ...s.rig.restPose } : zeroPose());

function defaultSideSettings(): ArmSideSettings {
  return { enabled: false, gain: 1, smoothing: 0.5, handMode: 'auto', restHand: 'open' };
}

export interface ArmMotionDeps {
  solveIK: ArmIKSolver; // AT-06の solveArmIK
  constrain: ArmConstraint; // AT-06の constrainArmPose（静的な制約）
}

export class ArmMotionSessionImpl implements ArmMotionSession {
  private sides: Record<ArmSide, SideState>;
  private generation = 0;
  private minGeneration = 0;
  private lastTick: number | null = null;

  constructor(private readonly deps: ArmMotionDeps) {
    this.sides = { L: this.emptySide(), R: this.emptySide() };
  }

  configure(model: Model, settings: ArmTrackingSettings): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      const rig = (model.armRigs ?? []).find((r) => r.side === side) ?? null;
      const key = rig ? JSON.stringify(rig) : '';
      const wasEnabled = s.settings.enabled;
      s.settings = { ...(settings.sides[side] ?? defaultSideSettings()) };
      const cutoff = armSmoothingToMinCutoff(s.settings.smoothing);
      s.wristFilter.setMinCutoff(cutoff);
      s.elbowFilter.setMinCutoff(cutoff);
      // モデル（リグ）が変わった・追従を切った側は、休止姿勢から始め直す
      if (key !== s.rigKey || (wasEnabled && !s.settings.enabled)) {
        s.rig = rig;
        s.rigKey = key;
        s.rigBroken = false;
        this.clearHistory(s);
        s.mode = 'rest';
        s.output = restOf(s);
        s.velocity = zeroPose();
      }
    }
  }

  update(input: ArmMotionInput): void {
    const { body, shapes } = input;
    // reset の世代より古い観測も、新しい世代を受け取った後に遅れて届いた古い世代の観測も捨てる
    if (body.generation < this.minGeneration || body.generation < this.generation) return;
    if (body.generation > this.generation) {
      // 新しい世代：前の世代の連続性を捨て、休止へ戻り始める。新しい観測が続けば復帰でつなぐ（いきなり新しい位置へ跳ばない）
      this.generation = body.generation;
      for (const side of SIDES) {
        const s = this.sides[side];
        this.clearHistory(s);
        if (s.mode !== 'rest') this.startReturn(s, null);
      }
    }
    for (const side of SIDES) {
      const s = this.sides[side];
      const arm = body.arms[side];
      if (arm) this.observe(s, arm);
      const shape = shapes[side];
      if (
        shape &&
        shape.time.generation >= this.generation &&
        (!s.shape || shape.time.capturedAt >= s.shape.time.capturedAt)
      )
        s.shape = shape;
    }
  }

  tick(now: number): Layer | null {
    const t = this.lastTick === null ? now : Math.max(this.lastTick, now); // 時刻が戻っても進めない
    const dt = this.lastTick === null ? 0 : Math.min(t - this.lastTick, MOTION_TIMING.maxTickDtMs) / 1000;
    this.lastTick = t;
    const values: ParamValues = {};
    let any = false;
    for (const side of SIDES) {
      const s = this.sides[side];
      if (!s.settings.enabled || !s.rig || !s.rig.enabled || s.rigBroken) continue;
      this.advance(s, t, dt);
      const ids = s.rig.parameters;
      values[ids.shoulder] = s.output.shoulder;
      values[ids.elbow] = s.output.elbow;
      values[ids.wrist] = s.output.wrist;
      for (const shape of HAND_SHAPES) values[ids.shapes[shape]] = shape === s.hand ? 1 : 0;
      any = true;
    }
    return any ? { id: 'tracking', weight: 1, values } : null;
  }

  // 停止・ミラー・カメラ・モデルの変更や校正のやり直しで呼ぶ。履歴とフィルタを消し、
  // displayed（今表示している値）があればその姿勢から休止へ戻り始め、観測が続けば復帰でつなぐ
  reset(generation: number, displayed?: ParamValues): void {
    this.minGeneration = Math.max(this.minGeneration, generation);
    this.generation = Math.max(this.generation, generation);
    for (const side of SIDES) {
      const s = this.sides[side];
      this.clearHistory(s);
      if (displayed && s.rig) {
        const ids = s.rig.parameters;
        const pick = (id: string, fallback: number) =>
          Number.isFinite(displayed[id]) ? (displayed[id] as number) : fallback;
        s.output = this.constrain(s, {
          shoulder: pick(ids.shoulder, s.output.shoulder),
          elbow: pick(ids.elbow, s.output.elbow),
          wrist: pick(ids.wrist, s.output.wrist),
        });
      }
      s.velocity = zeroPose();
      if (s.mode !== 'rest' || displayed) this.startReturn(s, null);
    }
  }

  status(): Record<ArmSide, ArmMotionStatus> {
    const one = (s: SideState): ArmMotionStatus => {
      if (!s.settings.enabled) return { state: 'off', handState: 'rest', pose: null, hand: null, reasons: [] };
      if (!s.rig || !s.rig.enabled || s.rigBroken)
        return { state: 'unavailable', handState: 'rest', pose: null, hand: null, reasons: ['invalid-rig'] };
      return {
        state: this.stateOf(s),
        handState: s.handState,
        pose: { ...s.output },
        hand: s.hand,
        reasons: s.mode === 'follow' || s.mode === 'recover' ? [...s.reasons] : [],
      };
    };
    return { L: one(this.sides.L), R: one(this.sides.R) };
  }

  private stateOf(s: SideState): ArmFollowState {
    switch (s.mode) {
      case 'follow':
        return s.elbowKnown ? 'tracking' : 'inferred';
      case 'hold':
        return 'holding';
      case 'return':
        return 'returning';
      case 'rest':
        return 'rest';
      case 'recover':
        return 'recovering';
    }
  }

  private emptySide(): SideState {
    const cutoff = armSmoothingToMinCutoff(defaultSideSettings().smoothing);
    return {
      rig: null,
      rigKey: '',
      rigBroken: false,
      settings: defaultSideSettings(),
      lastObsAt: null,
      lastValidAt: null,
      lastObsValid: false,
      runStartAt: null,
      elbowKnown: false,
      wristFilter: new PointFilter(cutoff),
      elbowFilter: new PointFilter(cutoff),
      ikPose: null,
      reasons: [],
      shape: null,
      lastWristRel: null,
      mode: 'rest',
      output: zeroPose(),
      velocity: zeroPose(),
      from: zeroPose(),
      since: null,
      handState: 'rest',
      hand: null,
    };
  }

  private clearHistory(s: SideState): void {
    s.lastObsAt = null;
    s.lastValidAt = null;
    s.lastObsValid = false;
    s.runStartAt = null;
    s.elbowKnown = false;
    s.wristFilter.reset();
    s.elbowFilter.reset();
    s.ikPose = null;
    s.reasons = [];
    s.shape = null;
    s.lastWristRel = null;
  }

  private constrain(s: SideState, pose: ArmPose): ArmPose {
    if (!s.rig) return pose;
    return this.deps.constrain(pose, s.rig.limits, s.rig.bendSign, s.rig.restPose);
  }

  // 観測1つを受け取る。同じか古い撮影時刻は捨てる（再通知で保持を延ばさない）
  private observe(s: SideState, arm: ArmObservation): void {
    const t = arm.time.capturedAt;
    if (!Number.isFinite(t) || (s.lastObsAt !== null && !(t > s.lastObsAt))) return;
    s.lastObsAt = t;
    const rig = s.rig;
    const wrist = usable(arm.wrist.validity) ? arm.wrist.position : null;
    if (!rig || !usable(arm.validity) || !finitePoint(wrist)) {
      s.lastObsValid = false;
      s.runStartAt = null;
      return;
    }
    // 保持の時間より空いた後の観測は、前の位置からならさない
    const gap = s.lastValidAt === null || t - s.lastValidAt > MOTION_TIMING.holdMs;
    if (gap) {
      s.wristFilter.reset();
      s.elbowFilter.reset();
    }
    if (!s.lastObsValid || s.runStartAt === null || gap) s.runStartAt = t;
    // 校正した演者の腕の長さ1 → モデルの上腕＋前腕の長さ（px）。外向き+x・下+y のまま
    const length = rig.lengths.upper + rig.lengths.lower;
    const w = s.wristFilter.filter(wrist, t);
    const elbowSeen = arm.elbow.validity === 'valid' && finitePoint(arm.elbow.position);
    const e = elbowSeen ? s.elbowFilter.filter(arm.elbow.position!, t) : null;
    const result = this.deps.solveIK({
      rig,
      wrist: { x: w.x * length, y: w.y * length },
      elbow: e ? { x: e.x * length, y: e.y * length } : null,
      wristAngle: null,
      previous: s.ikPose,
    });
    if (!result.valid) {
      s.rigBroken = result.reasons.includes('invalid-rig');
      s.lastObsValid = false;
      s.runStartAt = null;
      return;
    }
    s.lastValidAt = t;
    s.lastObsValid = true;
    s.elbowKnown = elbowSeen && arm.validity === 'valid';
    s.ikPose = result.pose;
    s.reasons = [...result.reasons];
  }

  private startReturn(s: SideState, since: number | null): void {
    s.mode = 'return';
    s.from = { ...s.output };
    s.since = since;
  }

  // 描画の時刻 t（dt 秒）で1つの側を進める
  private advance(s: SideState, t: number, dt: number): void {
    const rest = restOf(s);
    const age = s.lastValidAt === null ? Infinity : t - s.lastValidAt;
    const valid = s.lastObsValid && s.ikPose !== null && age <= MOTION_TIMING.holdMs;
    const confirmed = valid && s.runStartAt !== null && s.lastValidAt! - s.runStartAt >= MOTION_TIMING.reacquireMs;
    const returnStart = s.lastValidAt === null ? t : s.lastValidAt + MOTION_TIMING.holdMs;

    switch (s.mode) {
      case 'follow':
      case 'recover':
        if (!valid) {
          if (age <= MOTION_TIMING.holdMs) s.mode = 'hold';
          else this.startReturn(s, Math.min(t, returnStart));
        }
        break;
      case 'hold':
        if (valid) s.mode = 'follow';
        else if (age > MOTION_TIMING.holdMs) this.startReturn(s, Math.min(t, returnStart));
        break;
      case 'return':
      case 'rest':
        if (confirmed) {
          s.mode = 'recover';
          s.from = { ...s.output };
          s.since = t;
        }
        break;
    }
    if (s.since === null) s.since = t;

    let next: ArmPose;
    switch (s.mode) {
      case 'follow':
        next = approachPose(s.output, this.desired(s, t), s.velocity, dt);
        break;
      case 'recover': {
        const u = (t - s.since) / MOTION_TIMING.recoverMs;
        next = approachPose(s.output, lerpPose(s.from, this.desired(s, t), ease(u)), s.velocity, dt);
        if (u >= 1) s.mode = 'follow';
        break;
      }
      case 'hold':
        next = { ...s.output }; // 最後の安全な姿勢を保つ。外挿しない
        s.velocity = zeroPose();
        break;
      case 'return': {
        const u = (t - s.since) / MOTION_TIMING.returnMs;
        next = approachPose(s.output, lerpPose(s.from, rest, ease(u)), s.velocity, dt);
        if (u >= 1) s.mode = 'rest';
        break;
      }
      case 'rest':
        next = approachPose(s.output, rest, s.velocity, dt);
        break;
    }
    s.output = this.constrain(s, next);
    this.updateHand(s, t);
  }

  // 追従の目標姿勢：IKの肩・肘、掌の軸から求めた手首、動きの大きさ（休止姿勢からの関節の量）を掛けて制約に収める
  private desired(s: SideState, t: number): ArmPose {
    const rig = s.rig!;
    const rest = rig.restPose;
    const base = s.ikPose ?? rest;
    const forearm = base.shoulder + rig.bendSign * base.elbow;
    const solved = this.constrain(s, {
      shoulder: base.shoulder,
      elbow: base.elbow,
      wrist: this.wristTarget(s, t, forearm, rest.wrist),
    });
    const gain = Math.min(2, Math.max(0, Number.isFinite(s.settings.gain) ? s.settings.gain : 1));
    return this.constrain(s, {
      shoulder: rest.shoulder + gain * (solved.shoulder - rest.shoulder),
      elbow: rest.elbow + gain * (solved.elbow - rest.elbow),
      wrist: rest.wrist + gain * (solved.wrist - rest.wrist),
    });
  }

  // 掌の軸（肩の座標）から、前腕に対する手首の角度。軸が無ければ前の角度を保ち、長く無ければ休止の角度へ戻す
  private wristTarget(s: SideState, t: number, forearm: number, restWrist: number): number {
    const shape = s.shape;
    const axis = shape && usable(shape.validity) ? shape.candidate.palmAxis : null;
    if (shape && finitePoint(axis) && t - shape.time.capturedAt <= MOTION_TIMING.handFreshMs) {
      const angle = (Math.atan2(axis.x, axis.y) * 180) / Math.PI; // 下向き0、外向きが正
      s.lastWristRel = wrapDegrees(angle - forearm);
      return s.lastWristRel;
    }
    const seenAt = shape?.axisObservedAt ?? null;
    if (s.lastWristRel === null || seenAt === null) return restWrist;
    const age = t - seenAt;
    if (age <= MOTION_TIMING.holdMs) return s.lastWristRel;
    const u = ease((age - MOTION_TIMING.holdMs) / MOTION_TIMING.returnMs);
    return s.lastWristRel + (restWrist - s.lastWristRel) * u;
  }

  private updateHand(s: SideState, t: number): void {
    const { handMode, restHand } = s.settings;
    if (handMode !== 'auto') {
      s.handState = 'fixed';
      s.hand = handMode;
      return;
    }
    const r = s.shape;
    if (s.mode !== 'return' && s.mode !== 'rest' && r?.confirmed && r.confirmedAt !== null) {
      const age = t - r.confirmedAt;
      if (age <= MOTION_TIMING.handFreshMs) {
        s.handState = 'tracking';
        s.hand = r.confirmed;
        return;
      }
      if (age <= MOTION_TIMING.shapeHoldMs) {
        s.handState = 'holding';
        s.hand = r.confirmed;
        return;
      }
    }
    s.handState = 'rest';
    s.hand = restHand;
  }
}

export function createArmMotionSession(deps: ArmMotionDeps): ArmMotionSessionImpl {
  return new ArmMotionSessionImpl(deps);
}
