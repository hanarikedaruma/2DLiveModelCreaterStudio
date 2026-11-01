// 手の特徴量（AT-07）。指の伸びと曲がりは手基準の3D座標（worldLandmarks、m）で測り、手の向き（上・横・斜め）に依らない。
// 画面の上下の比較（指先が付け根より上か）では決めない。
import type { AssociatedHand, BodyPoint } from '@app/contracts';
import type { Vec2 } from '@app/schema';

export type Finger = 'index' | 'middle' | 'ring' | 'pinky';
export type FingerState = 'extended' | 'curled' | 'unknown';
export const FINGERS: Finger[] = ['index', 'middle', 'ring', 'pinky'];

// MediaPipe の手の点の番号
export const HAND = {
  wrist: 0,
  index: { mcp: 5, tip: 8 },
  middle: { mcp: 9, tip: 12 },
  ring: { mcp: 13, tip: 16 },
  pinky: { mcp: 17, tip: 20 },
} as const;

// 手首→指先 ÷ 手首→付け根。AT-01 の実カメラ（2回の収録）で、伸びた指はおおむね1.5以上、曲げた指は1.0以下。
// 間（1.15〜1.4）は決めない
export const EXTENSION = Object.freeze({ curledAtMost: 1.15, extendedAtLeast: 1.4 });
// 確定している形を保つときの緩い閾値（開始より境界の内側まで許す）
export const EXTENSION_KEEP = Object.freeze({ curledAtMost: 1.25, extendedAtLeast: 1.3 });

// 掌の軸・指の向きを使う条件。画面に対して奥行きへ60°より傾いた（画面上の長さが3Dの長さの半分未満）、
// または肩の座標（腕の長さ1）で短すぎるときは「潰れている」として null を返す。
// AT-01：手首→中指の付け根は0.15〜0.30。カメラへ向けた人さし指は3Dの長さの0.3〜0.6しか写らない
export const AXIS = Object.freeze({ minFlatRatio: 0.5, minLength: 0.05 });

const finite = (p: BodyPoint | undefined): p is BodyPoint =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const dist3 = (a: BodyPoint, b: BodyPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export interface FingerFeature {
  ratio: number | null;
  state: FingerState;
}

export function fingerFeatures(points: readonly BodyPoint[]): Record<Finger, FingerFeature> {
  const wrist = points[HAND.wrist];
  const out = {} as Record<Finger, FingerFeature>;
  for (const finger of FINGERS) {
    const mcp = points[HAND[finger].mcp];
    const tip = points[HAND[finger].tip];
    const base = finite(wrist) && finite(mcp) ? dist3(wrist, mcp) : 0;
    if (!finite(tip) || !(base > 1e-6)) {
      out[finger] = { ratio: null, state: 'unknown' };
      continue;
    }
    const ratio = dist3(wrist!, tip) / base;
    out[finger] = {
      ratio,
      state: ratio >= EXTENSION.extendedAtLeast ? 'extended' : ratio <= EXTENSION.curledAtMost ? 'curled' : 'unknown',
    };
  }
  return out;
}

type HandPoints = Pick<AssociatedHand, 'landmarks' | 'worldLandmarks'>;

// from→to の向き（肩の座標の単位ベクトル）。傾きは手基準3Dで見る（画像のzは奥行きの目安にならない：
// AT-01 でカメラへ向けた指も画像のzでは画面とほぼ平行だった）。3Dの点が無いときだけ画像のzで見る
function direction(hand: HandPoints, from: number, to: number): Vec2 | null {
  const a = hand.landmarks[from];
  const b = hand.landmarks[to];
  if (!finite(a) || !finite(b)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length >= AXIS.minLength)) return null;
  const world = hand.worldLandmarks.length > Math.max(from, to) ? hand.worldLandmarks : hand.landmarks;
  const wa = world[from];
  const wb = world[to];
  if (!finite(wa) || !finite(wb)) return null;
  const full = dist3(wa, wb);
  if (!(full > 0) || Math.hypot(wb.x - wa.x, wb.y - wa.y) < full * AXIS.minFlatRatio) return null;
  return { x: dx / length, y: dy / length };
}

// 掌の軸：手首→中指の付け根（指先ではない）。指先の細かい揺れを手全体の回転にしない。グーでも同じ点を使う
export function palmAxis(hand: HandPoints): Vec2 | null {
  return direction(hand, HAND.wrist, HAND.middle.mcp);
}

// 指さしの向き：人さし指の付け根→指先。掌の軸とは別の値
export function indexDirection(hand: HandPoints): Vec2 | null {
  return direction(hand, HAND.index.mcp, HAND.index.tip);
}
