// 1つの観測から手形の候補を決める（AT-07）。指の伸び・曲がり（3D）を主に使い、SDK の既成手形は補助にする。
// Pointing_Up という名前は上向きの指さししか表さない（AT-01：横向きでは0〜1%）ので、横・斜めの指さしは指の状態で決める。
import type { HandObservation } from '@app/contracts';
import { HAND_SHAPES, type HandShape } from '@app/schema';
import { EXTENSION, EXTENSION_KEEP, FINGERS, fingerFeatures, type Finger, type FingerState } from './features';

// 4種類の指の形（人さし指・中指・薬指・小指。親指は使わない）
export const SHAPE_FINGERS: Record<HandShape, Record<Finger, 'extended' | 'curled'>> = {
  open: { index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended' },
  fist: { index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' },
  point: { index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' },
  peace: { index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' },
};
const SDK_SHAPE: Record<string, HandShape> = {
  Open_Palm: 'open',
  Closed_Fist: 'fist',
  Pointing_Up: 'point',
  Victory: 'peace',
};
export const SDK_MIN_SCORE = 0.7;

export interface ShapeGuess {
  shape: HandShape | null;
  score: number; // 0..1。4本のうち一番あいまいな指の確かさ。既成の手形が一致すれば少し上げる
  fingers: Record<Finger, FingerState>;
  reason: string;
}

// 指1本の確かさ（0..1）。境界（開始の閾値）で0.45、はっきり伸びた（1.7）・曲がった（0.85）指で1
function confidence(ratio: number | null, want: 'extended' | 'curled'): number {
  if (ratio === null) return 0;
  const t =
    want === 'extended'
      ? (ratio - EXTENSION.curledAtMost) / (1.7 - EXTENSION.curledAtMost)
      : (EXTENSION.extendedAtLeast - ratio) / (EXTENSION.extendedAtLeast - 0.85);
  return Math.max(0, Math.min(1, t));
}

// keep は今確定している形。その形のままかどうかは、緩い維持の閾値（EXTENSION_KEEP）で見る。
// 境界の揺れで候補が別の形やunknownへ跳ばないようにする（開始と維持の閾値の差）
export function classifyHand(
  hand: Pick<HandObservation, 'worldLandmarks' | 'landmarks' | 'gesture'>,
  keep: HandShape | null = null,
): ShapeGuess {
  // 手基準の3D点が無いとき（SDK が返さないとき）は、肩の座標の点（奥行きは目安）で代わりに測る
  const points = hand.worldLandmarks.length >= 21 ? hand.worldLandmarks : hand.landmarks;
  const features = fingerFeatures(points);
  const fingers = Object.fromEntries(FINGERS.map((f) => [f, features[f].state])) as Record<Finger, FingerState>;
  const sdk = hand.gesture && hand.gesture.score >= SDK_MIN_SCORE ? SDK_SHAPE[hand.gesture.name] : undefined;
  const scoreOf = (shape: HandShape) => {
    const base = Math.min(...FINGERS.map((f) => confidence(features[f].ratio, SHAPE_FINGERS[shape][f])));
    return sdk === shape ? Math.min(1, base + 0.2) : base;
  };
  if (keep) {
    const kept = FINGERS.every((f) => {
      const ratio = features[f].ratio;
      if (ratio === null) return false;
      return SHAPE_FINGERS[keep][f] === 'extended'
        ? ratio >= EXTENSION_KEEP.extendedAtLeast
        : ratio <= EXTENSION_KEEP.curledAtMost;
    });
    if (kept) return { shape: keep, score: scoreOf(keep), fingers, reason: '指の形（維持の閾値）' };
  }
  // 4本とも決まっていれば、指の形で決める
  if (FINGERS.every((f) => fingers[f] !== 'unknown')) {
    const match = HAND_SHAPES.find((shape) => FINGERS.every((f) => SHAPE_FINGERS[shape][f] === fingers[f]));
    if (!match) return { shape: null, score: 0, fingers, reason: '4種類のどれでもない指の形' };
    return {
      shape: match,
      score: scoreOf(match),
      fingers,
      reason: sdk === match ? '指の形（既成の手形も一致）' : '指の形',
    };
  }
  // 決まらない指があるときは、既成の手形が決まった指と矛盾しない場合だけ使う
  // （カメラへ向けた指さしは人さし指が短く写り、伸びが決まらないことがある）
  if (sdk) {
    const consistent = FINGERS.every((f) => fingers[f] === 'unknown' || fingers[f] === SHAPE_FINGERS[sdk][f]);
    if (consistent)
      return { shape: sdk, score: hand.gesture!.score * 0.6, fingers, reason: '既成の手形（決まらない指がある）' };
  }
  return { shape: null, score: 0, fingers, reason: '指の伸び・曲がりが決まらない' };
}
