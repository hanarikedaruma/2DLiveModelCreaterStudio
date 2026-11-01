// 手形の切替の安定化（AT-07）。左右独立。待ち時間は撮影時刻で測り、フレーム数では数えない（15/30/60fpsで同じ時間）。
// 長く見失ったときの休止形への復帰はAT-09、固定指定はAT-12、絵の選択はAT-08。ここは確定した形を発行するだけ。
import { ARM_TIMING, type AssociatedHand, type HandShapeResult, type HandShapeTracker } from '@app/contracts';
import type { ArmSide, HandShape, Vec2 } from '@app/schema';
import { classifyHand } from './classifier';
import { FINGERS, indexDirection, palmAxis, type Finger, type FingerState } from './features';

export const SHAPE_TIMING = Object.freeze({
  stableMs: ARM_TIMING.shapeStableMs, // 新しい候補がこの時間続いたら切り替える
  maxGapMs: 200, // 観測の間がこれより空いたら、切替待ちの候補を続いたとみなさない
});

// CC-032 の HandShapeResult に、判定の理由と指さしの向きを足したもの（契約に指さしの向きの欄が無いため。AT-07 報告）
export interface HandShapeEstimate extends HandShapeResult {
  pointDirection: Vec2 | null; // 人さし指の向き（肩の座標の単位ベクトル）。候補が指さしでない・潰れているときnull
  fingers: Record<Finger, FingerState>;
  pending: { shape: HandShape; since: number } | null; // 切替待ちの候補と、続き始めた撮影時刻
  reason: string;
}

interface SideState {
  confirmed: HandShape | null;
  confirmedAt: number | null;
  axisObservedAt: number | null;
  pending: { shape: HandShape; since: number } | null;
  lastAt: number | null;
  last: HandShapeEstimate | null;
}
const emptyState = (): SideState => ({
  confirmed: null,
  confirmedAt: null,
  axisObservedAt: null,
  pending: null,
  lastAt: null,
  last: null,
});
const NO_FINGERS = Object.fromEntries(FINGERS.map((f) => [f, 'unknown'])) as Record<Finger, FingerState>;

export class HandShapeTrackerImpl implements HandShapeTracker {
  private generation = 0;
  private mirror: boolean | null = null;
  private sides: Record<ArmSide, SideState> = { L: emptyState(), R: emptyState() };

  // ミラーを変えると、モデルの各側に割り当たる演者の手が入れ替わるので、両側の履歴（確定した形も）を捨てる
  configure(options: { mirror: boolean }): void {
    if (this.mirror !== null && this.mirror !== options.mirror) this.clear();
    this.mirror = options.mirror;
  }

  reset(generation: number): void {
    this.generation = Math.max(this.generation, generation);
    this.clear();
  }

  result(side: ArmSide): HandShapeEstimate | null {
    return this.sides[side].last;
  }

  update(side: ArmSide, hand: AssociatedHand): HandShapeEstimate {
    const at = hand.time.capturedAt;
    if (hand.time.generation < this.generation) return this.sides[side].last ?? this.lost(side, hand, '古い世代の観測');
    if (hand.time.generation > this.generation) {
      this.generation = hand.time.generation;
      this.clear();
    }
    const state = this.sides[side];
    // 同じか古い撮影時刻（順の入れ替わり）は受け付けない
    if (state.lastAt !== null && !(at > state.lastAt)) return state.last ?? this.lost(side, hand, '古い撮影時刻');
    if (state.lastAt !== null && at - state.lastAt > SHAPE_TIMING.maxGapMs) state.pending = null;
    state.lastAt = at;

    const usable = (hand.validity === 'valid' || hand.validity === 'inferred') && hand.landmarks.length >= 21;
    if (!usable) {
      state.pending = null;
      return (state.last = this.lost(
        side,
        hand,
        hand.validity === 'ambiguous' ? '左右の所属が決まらない' : '手が見えない',
      ));
    }
    const guess = classifyHand(hand, state.confirmed);
    const axis = palmAxis(hand);
    if (axis) state.axisObservedAt = at;
    if (guess.shape === null) {
      state.pending = null; // unknown は新しい形にも、確定した形の観測にもならない
    } else if (guess.shape === state.confirmed) {
      state.confirmedAt = at;
      state.pending = null;
    } else if (state.pending?.shape !== guess.shape) {
      state.pending = { shape: guess.shape, since: at };
    }
    if (state.pending && at - state.pending.since >= SHAPE_TIMING.stableMs) {
      state.confirmed = state.pending.shape;
      state.confirmedAt = at;
      state.pending = null;
    }
    return (state.last = {
      side,
      time: hand.time,
      candidate: { shape: guess.shape, score: guess.score, palmAxis: axis },
      confirmed: state.confirmed,
      confirmedAt: state.confirmedAt,
      axisObservedAt: state.axisObservedAt,
      validity: hand.validity,
      pointDirection: guess.shape === 'point' ? indexDirection(hand) : null,
      fingers: guess.fingers,
      pending: state.pending,
      reason: guess.reason,
    });
  }

  private lost(side: ArmSide, hand: AssociatedHand, reason: string): HandShapeEstimate {
    const state = this.sides[side];
    return {
      side,
      time: hand.time,
      candidate: { shape: null, score: 0, palmAxis: null },
      confirmed: state.confirmed,
      confirmedAt: state.confirmedAt,
      axisObservedAt: state.axisObservedAt,
      validity: hand.validity === 'valid' || hand.validity === 'inferred' ? 'missing' : hand.validity,
      pointDirection: null,
      fingers: NO_FINGERS,
      pending: null,
      reason,
    };
  }

  private clear(): void {
    this.sides = { L: emptyState(), R: emptyState() };
  }
}

export function createHandShapeTracker(options: { mirror: boolean } = { mirror: true }): HandShapeTrackerImpl {
  const tracker = new HandShapeTrackerImpl();
  tracker.configure(options);
  return tracker;
}
