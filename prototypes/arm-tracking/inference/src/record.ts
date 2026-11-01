// 点列の記録。映像は保存せず、推定器が返した点と左右・手形の候補だけを残す（回帰用の既定の形式）。
// 座標は推定器に渡した未反転の映像のもの。x は画像の左→右、y は上→下の 0..1。
// Pose の left/right と手の handedness は SDK の名前のまま。演者の実際の左右は steps[].truth に書く。
import type { HandObservation } from './protocol';

export type Side = 'left' | 'right'; // 演者自身の左右
export type Shape = 'open' | 'fist' | 'point' | 'peace';

export interface StepTruth {
  active: Side[]; // 上げている・動かしている手
  shape: Shape | null; // 演者が作っている手形
  pointing?: 'side' | 'diagonal' | 'up' | undefined;
  crossed?: boolean | undefined;
  faceCovered?: boolean | undefined;
  palmFlip?: boolean | undefined;
  edge?: boolean | undefined;
  outOfFrame?: boolean | undefined;
}

export interface StepInfo {
  id: string;
  label: string;
  truth: StepTruth;
  start: number;
  end: number;
  retries?: number | undefined; // R キーでやり直した回数（やり直す前の点列は残さない）
}

export interface RecHand {
  sdkSide: string | null; // SDK の handedness（Left/Right）。正解ではない
  sdkSideScore: number | null;
  gesture: string | null;
  gestureScore: number | null;
  lm: number[]; // 21 × [x, y, z, visibility]
  world: number[]; // 21 × [x, y, z, visibility]
}

export interface RecFrame {
  t: number; // 撮影時刻（ms、ページの時計）
  step: string | null;
  face: boolean | null; // null は顔を推定していない
  pose: number[] | null; // 33 × [x, y, z, visibility]。null は推定していない、空は見つからない
  poseWorld: number[] | null;
  hands: RecHand[] | null; // null は推定していない
}

export interface Recording {
  format: 'at01-points/1';
  createdAt: string;
  coordinates: string;
  environment: Record<string, unknown>;
  steps: StepInfo[];
  frames: RecFrame[];
}

export const COORDINATES =
  '未反転の映像の正規化座標（x 左→右、y 上→下、0..1）。pose は 33 点、hands は 21 点、各点 [x, y, z, visibility]。' +
  'visibility を SDK が返さない点は null。Pose の左右と handedness は SDK の名前のまま、演者の左右は steps[].truth。';

const round = (values: readonly number[], digits = 4): number[] => {
  const k = 10 ** digits;
  return values.map((v) => (Number.isFinite(v) ? Math.round(v * k) / k : Number.NaN));
};

export function toRecHand(hand: HandObservation): RecHand {
  const top = hand.gestures[0];
  return {
    sdkSide: hand.handedness?.categoryName ?? null,
    sdkSideScore: hand.handedness ? Math.round(hand.handedness.score * 1000) / 1000 : null,
    gesture: top?.categoryName ?? null,
    gestureScore: top ? Math.round(top.score * 1000) / 1000 : null,
    lm: round(hand.landmarks),
    world: round(hand.world, 5),
  };
}

export function roundPose(values: readonly number[] | undefined): number[] | null {
  return values ? round(values) : null;
}

// 決まった区間だけを切り出す（回帰用の短い点列の例）
export function clip(recording: Recording, stepIds: readonly string[]): Recording {
  const keep = new Set(stepIds);
  return {
    ...recording,
    steps: recording.steps.filter((s) => keep.has(s.id)),
    frames: recording.frames.filter((f) => f.step !== null && keep.has(f.step)),
  };
}
