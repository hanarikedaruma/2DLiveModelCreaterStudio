// 観測の正規化と、演者・左右の対応付け（AT-05 / CC-032 の BodyAssociation）。
// 演者の左右→モデルの左右（ミラー）はここだけで決め、後段（core）で反転し直さない。
// 画面の x の順・検出の配列の順・SDK の左右候補だけで所属を決めない。決められないときは ambiguous で返す。
import type {
  ArmObservation,
  AssociatedHand,
  BodyAssociation,
  BodySample,
  BodySampleTime,
  BodyTrackingFrame,
  HandObservation,
  NormalizedBodyFrame,
  ObservationValidity,
  ObservedPoint,
  PoseObservation,
} from '@app/contracts';
import type { ArmCalibration, ArmSide, Vec2 } from '@app/schema';
import { ARM_PER_SHOULDER_WIDTH } from './calibration';
import {
  HAND_WRIST,
  POSE_POINT,
  distance,
  finitePoint,
  normalize,
  normalizeHandPoint,
  poseVisible,
  shoulderFrame,
  toPx,
  type ActorSide,
  type Image,
  type ShoulderFrame,
} from './geometry';

// 試作の開始値。実測で調整するときは根拠を残す
export const ASSOCIATION = Object.freeze({
  poseHandMaxGapMs: 80, // 手と Pose の撮影時刻の差の上限（設計 §6）。超えたら手の所属を決めない
  shoulderHoldMs: 200, // 肩を見失ったとき、最後の肩の基準を使い続ける時間（新しい基準を推測し続けない）
  handGate: 0.35, // 手の手首と Pose の手首の距離の上限（腕の長さ比）。超えた手は本人の手としない
  ambiguousRatio: 1.25, // 次に良い割当のコストがこの倍以内なら所属を確定しない
  overlap: 0.12, // 両手首（Pose）がこれより近ければ、重なりとして所属を確定しない（腕の長さ比）
  spikePer50ms: 1.5, // 50ms あたり腕の長さ×これより動いた手首は飛びとして使わない
  identityJump: 0.5, // 肩の中心が肩幅×これより一度に動いた・肩幅が3割変わったら、別の人への乗り換えを疑う
  identitySettleMs: 100, // 乗り換えを疑った後、新しい位置で続けて安定したら受け入れる
  continuityWeight: 0.3, // 前回の同じ側の手の位置からの距離の重み
  continuityMs: 200,
  handednessPenalty: 0.05, // SDK の左右候補が逆のときの小さな罰則（位置の信頼性には使わない）
});

const SIDES: ActorSide[] = ['left', 'right'];
const missing = (validity: ObservationValidity = 'missing'): ObservedPoint => ({ position: null, validity });

interface PoseMemo {
  time: BodySampleTime;
  frame: ShoulderFrame | null; // この Pose で使った肩の基準（保持した基準も含む）
  wrists: Record<ActorSide, Vec2 | null>; // px
  armLength: Record<ActorSide, number>;
  ambiguous: boolean;
}

export interface BodyAssociationOptions {
  mirror?: boolean;
  calibration?: ArmCalibration | null;
}

export interface AssociationDiagnostics {
  calibrated: boolean;
  armLength: Record<ActorSide, number | null>; // px。校正が無ければ肩幅からの目安
  identity: 'tracking' | 'switching' | 'none';
  reasons: Partial<Record<ArmSide, string>>; // 腕・手を使えなかった理由（最後の通知）
}

export class BodyAssociationImpl implements BodyAssociation {
  private mirror: boolean;
  private calibration: ArmCalibration | null;
  private minGeneration = -Infinity;
  private generation = -Infinity;
  private poses: PoseMemo[] = [];
  private shoulder: { frame: ShoulderFrame; at: number } | null = null;
  private identity: { center: Vec2; width: number; at: number } | null = null;
  private pending: { center: Vec2; width: number; since: number } | null = null;
  private lastWrist: Partial<Record<ActorSide, { p: Vec2; at: number }>> = {};
  private lastHand: Partial<Record<ActorSide, { p: Vec2; at: number }>> = {};
  private reasons: Partial<Record<ArmSide, string>> = {};

  constructor(options: BodyAssociationOptions = {}) {
    this.mirror = options.mirror ?? true;
    this.calibration = options.calibration ?? null;
  }

  configure(options: { mirror: boolean; calibration: ArmCalibration | null }): void {
    // ミラーが変わると所属が入れ替わるので、連続性の記憶を捨てる（休止を経た再取得は AT-09）
    if (options.mirror !== this.mirror) this.clearContinuity();
    this.mirror = options.mirror;
    this.calibration = options.calibration;
  }

  reset(generation: number): void {
    this.minGeneration = generation;
    this.generation = generation;
    this.clearContinuity();
    this.shoulder = null;
    this.identity = null;
    this.pending = null;
    this.poses = [];
  }

  // 演者の左右 → モデルの左右。ミラー ON は演者の右腕をモデルの左腕へ（現行の目と同じ）
  modelSide(actor: ActorSide): ArmSide {
    return this.mirror ? (actor === 'right' ? 'L' : 'R') : actor === 'right' ? 'R' : 'L';
  }

  diagnostics(): AssociationDiagnostics {
    const last = this.poses.at(-1);
    return {
      calibrated: this.calibration !== null,
      armLength: { left: last?.armLength.left ?? null, right: last?.armLength.right ?? null },
      identity: this.pending ? 'switching' : this.identity ? 'tracking' : 'none',
      reasons: { ...this.reasons },
    };
  }

  update(frame: BodyTrackingFrame): NormalizedBodyFrame {
    const generation = (frame.pose ?? frame.hands)!.time.generation;
    // reset の世代より古い通知も、新しい世代の後に遅れて届いた古い世代の通知も、何も更新しない
    if (generation < this.minGeneration || generation < this.generation)
      return { generation: Math.max(this.minGeneration, this.generation), arms: {}, hands: {} };
    if (generation > this.generation) {
      // 推定元の新しい世代（停止・再開・設定変更）。前の世代の連続性を持ち込まない
      this.generation = generation;
      this.clearContinuity();
      this.shoulder = null;
      this.poses = [];
    }
    this.reasons = {};
    const out: NormalizedBodyFrame = { generation, arms: {}, hands: {} };
    if (frame.pose) this.updatePose(frame.pose, frame.image, out);
    if (frame.hands) this.updateHands(frame.hands, frame.image, out);
    return out;
  }

  // ---- 中身

  private clearContinuity(): void {
    this.lastWrist = {};
    this.lastHand = {};
  }

  private armLength(side: ActorSide, frame: ShoulderFrame, image: Image): number {
    const c = this.calibration;
    if (c) return (c.arms[side].upper + c.arms[side].lower) * (image.width / c.camera.width);
    return frame.width * ARM_PER_SHOULDER_WIDTH; // 未校正の目安（AT-11 で校正を案内する）
  }

  // 本人の保持：肩の中心と幅が一度に大きく変わったら、別の人への乗り換えを疑い、安定するまで確定しない
  private checkIdentity(frame: ShoulderFrame, at: number): boolean {
    const jumped = (ref: { center: Vec2; width: number }) =>
      distance(frame.center, ref.center) / ref.width > ASSOCIATION.identityJump ||
      Math.abs(frame.width / ref.width - 1) > 0.3;
    if (!this.identity || at - this.identity.at > 1000) {
      this.identity = { center: frame.center, width: frame.width, at };
      this.pending = null;
      return false;
    }
    if (!jumped(this.identity)) {
      this.identity = { center: frame.center, width: frame.width, at };
      this.pending = null;
      return false;
    }
    if (this.pending && !jumped(this.pending)) {
      if (at - this.pending.since >= ASSOCIATION.identitySettleMs) {
        this.identity = { center: frame.center, width: frame.width, at };
        this.pending = null;
        this.clearContinuity();
        return false;
      }
      return true;
    }
    this.pending = { center: frame.center, width: frame.width, since: at };
    return true;
  }

  private updatePose(sample: BodySample<PoseObservation>, image: Image, out: NormalizedBodyFrame): void {
    const at = sample.time.capturedAt;
    const points = sample.value.landmarks;
    const memo: PoseMemo = {
      time: sample.time,
      frame: null,
      wrists: { left: null, right: null },
      armLength: { left: 0, right: 0 },
      ambiguous: false,
    };
    const ls = points[POSE_POINT.shoulder.left];
    const rs = points[POSE_POINT.shoulder.right];
    let frame = poseVisible(ls) && poseVisible(rs) ? shoulderFrame(toPx(ls, image), toPx(rs, image)) : null;
    // 後ろ向き・映像の反転（演者の左肩が画像の左）は本人の正面の基準にしない
    if (frame && frame.axis.x <= 0) frame = null;
    if (frame) {
      memo.ambiguous = this.checkIdentity(frame, at);
      if (!memo.ambiguous) this.shoulder = { frame, at };
    }
    if (!frame && this.shoulder && at - this.shoulder.at <= ASSOCIATION.shoulderHoldMs) frame = this.shoulder.frame;
    memo.frame = memo.ambiguous ? null : frame;
    for (const actor of SIDES) {
      const side = this.modelSide(actor);
      const base = { side, actorSide: actor, time: sample.time };
      if (memo.ambiguous || !frame) {
        const validity: ObservationValidity = memo.ambiguous ? 'ambiguous' : 'missing';
        this.reasons[side] = memo.ambiguous
          ? '別の人に乗り換えた疑い'
          : points.length
            ? '肩が見えない'
            : '人が見つからない';
        out.arms[side] = { ...base, validity, elbow: missing(validity), wrist: missing(validity) };
        continue;
      }
      const armLength = this.armLength(actor, frame, image);
      memo.armLength[actor] = armLength;
      const wristRaw = points[POSE_POINT.wrist[actor]];
      const elbowRaw = points[POSE_POINT.elbow[actor]];
      let wrist = poseVisible(wristRaw) ? toPx(wristRaw, image) : null;
      const elbow = poseVisible(elbowRaw) ? toPx(elbowRaw, image) : null;
      const origin = actor === 'left' ? frame.left : frame.right;
      if (wrist && distance(wrist, origin) < armLength * 1e-3) wrist = null; // ゼロ長
      const last = this.lastWrist[actor];
      if (wrist && last && at > last.at && at - last.at <= ASSOCIATION.continuityMs) {
        const limit = armLength * ASSOCIATION.spikePer50ms * Math.max(1, (at - last.at) / 50);
        if (distance(wrist, last.p) > limit) {
          wrist = null; // 飛び
          this.reasons[side] = '手首の位置が飛んだ';
        }
      }
      if (wrist) {
        this.lastWrist[actor] = { p: wrist, at };
        memo.wrists[actor] = wrist;
      } else this.reasons[side] ??= '手首が見えない';
      const validity: ObservationValidity = wrist ? (elbow ? 'valid' : 'inferred') : 'missing';
      const point = (p: Vec2 | null): ObservedPoint =>
        p ? { position: normalize(p, frame!, actor, armLength), validity: 'valid' } : missing();
      const observation: ArmObservation = { ...base, validity, elbow: point(elbow), wrist: point(wrist) };
      out.arms[side] = observation;
    }
    this.poses = [...this.poses.slice(-5), memo];
  }

  private updateHands(sample: BodySample<HandObservation[]>, image: Image, out: NormalizedBodyFrame): void {
    const at = sample.time.capturedAt;
    const hands = sample.value.filter((h) => finitePoint(h.landmarks[HAND_WRIST]));
    // 同じ頃の Pose（撮影時刻の差が上限以内）が無ければ、肩の基準も手首も分からないので所属を決めない
    const pose = this.poses
      .filter((p) => p.frame && Math.abs(p.time.capturedAt - at) <= ASSOCIATION.poseHandMaxGapMs)
      .sort((a, b) => Math.abs(a.time.capturedAt - at) - Math.abs(b.time.capturedAt - at))[0];
    const result = (actor: ActorSide, validity: ObservationValidity, hand?: HandObservation): void => {
      const side = this.modelSide(actor);
      const entry: AssociatedHand = {
        time: sample.time,
        validity,
        landmarks:
          hand && pose
            ? hand.landmarks.map((p) => normalizeHandPoint(p, image, pose.frame!, actor, pose.armLength[actor]))
            : [],
        worldLandmarks: hand ? hand.worldLandmarks : [],
        gesture: hand ? hand.gesture : null,
      };
      out.hands[side] = entry;
    };
    if (!hands.length) {
      for (const actor of SIDES) result(actor, 'missing');
      return;
    }
    if (!pose) {
      for (const actor of SIDES) {
        result(actor, 'ambiguous');
        this.reasons[this.modelSide(actor)] = '同じ頃の肩が見つからず、手の所属を決めない';
      }
      return;
    }
    const wristOf = (h: HandObservation) => toPx(h.landmarks[HAND_WRIST]!, image);
    // 各手を各側へ割り当てるコスト。位置（Pose の手首）を主に、前回の手の位置を少し、SDK の左右候補はごく小さく使う
    const cost = (h: HandObservation, actor: ActorSide): number => {
      const length = pose.armLength[actor];
      const poseWrist = pose.wrists[actor];
      if (!poseWrist || !(length > 0)) return Infinity;
      const d = distance(wristOf(h), poseWrist) / length;
      if (d > ASSOCIATION.handGate) return Infinity; // 本人のその腕の手ではない（別の人の手を含む）
      const last = this.lastHand[actor];
      const continuity =
        last && at - last.at <= ASSOCIATION.continuityMs
          ? (distance(wristOf(h), last.p) / length) * ASSOCIATION.continuityWeight
          : 0;
      const handedness = h.handedness && h.handedness.side !== actor ? ASSOCIATION.handednessPenalty : 0;
      return d + continuity + handedness;
    };
    // 最大2手を重複なく割り当てる全ての組（割り当てない手も含む）を比べる
    type Plan = { pairs: [number, ActorSide][]; cost: number };
    const plans: Plan[] = [];
    const choose = (i: number, used: Set<ActorSide>, pairs: [number, ActorSide][], total: number): void => {
      if (i === hands.length) {
        plans.push({ pairs, cost: total });
        return;
      }
      choose(i + 1, used, pairs, total);
      for (const actor of SIDES) {
        if (used.has(actor)) continue;
        const c = cost(hands[i]!, actor);
        if (!Number.isFinite(c)) continue;
        choose(i + 1, new Set([...used, actor]), [...pairs, [i, actor]], total + c);
      }
    };
    choose(0, new Set(), [], 0);
    const most = Math.max(...plans.map((p) => p.pairs.length));
    const ranked = plans.filter((p) => p.pairs.length === most).sort((a, b) => a.cost - b.cost);
    const best = ranked[0]!;
    const second = ranked[1];
    // 割当の側が入れ替わる別案が同じくらい良い、または両手首が重なっている → 所属を確定しない
    const swapped =
      !!second &&
      second.pairs.some(([i, actor]) => best.pairs.some(([j, other]) => i === j && actor !== other)) &&
      second.cost <= best.cost * ASSOCIATION.ambiguousRatio + 0.02;
    const wl = pose.wrists.left;
    const wr = pose.wrists.right;
    const overlapped =
      !!wl && !!wr && distance(wl, wr) < ASSOCIATION.overlap * Math.min(pose.armLength.left, pose.armLength.right);
    for (const actor of SIDES) {
      const pair = best.pairs.find(([, a]) => a === actor);
      if (!pair) {
        result(actor, 'missing');
        continue;
      }
      if (swapped || overlapped) {
        result(actor, 'ambiguous');
        this.reasons[this.modelSide(actor)] = overlapped ? '両手が重なっている' : '手の所属を決められない（交差）';
        continue;
      }
      const hand = hands[pair[0]]!;
      this.lastHand[actor] = { p: wristOf(hand), at };
      result(actor, 'valid', hand);
    }
  }
}

export function createBodyAssociation(options: BodyAssociationOptions = {}): BodyAssociationImpl {
  return new BodyAssociationImpl(options);
}
