import type { TrackingInput } from '@app/schema';
import { ONE_EURO_DEFAULTS } from './oneEuro';

// 動きの簡易設定（カード35）。TrackingLayerProducer.setPreset の値
//   minCutoff: One Euro の minCutoff（Hz）。マッピングの smoothing の既定（minCutoff 1.0）に対する倍率として掛ける
//   beta: One Euro の beta（入力の幅を FILTER_SPAN = 60 にそろえた単位）
//   gain: 写像の後に、出力の中央からの差へ掛ける
//   deadZone: マッピングの deadZone に足す不感帯。入力の幅を 60 にそろえた単位（顔の角度 [−30, 30] では度）
// presetOf（画面）に渡せるように interface ではなく type にする（Record<string, number> に代入できる）
export type TrackingTuning = { minCutoff: number; beta: number; gain: number; deadZone: number };
export type TrackingPresetName = 'stable' | 'standard' | 'large';
export type TrackingPreset = TrackingPresetName | 'custom';

export const TRACKING_PRESETS: Readonly<Record<TrackingPresetName, Readonly<TrackingTuning>>> = Object.freeze({
  stable: Object.freeze({ minCutoff: 0.5, beta: 0.01, gain: 0.9, deadZone: 1.5 }),
  standard: Object.freeze({ minCutoff: 1.0, beta: 0.02, gain: 1.0, deadZone: 0.5 }),
  large: Object.freeze({ minCutoff: 1.5, beta: 0.05, gain: 1.2, deadZone: 0 }),
});

// setPreset を呼ぶ前の値（MVP と同じ: minCutoff 1.0・beta 0.02、gain・deadZone なし）。
// アプリでは作った直後に Environment.trackingPreset を渡す（既定は 'standard'）
export const UNTUNED_TRACKING: Readonly<TrackingTuning> = Object.freeze({
  minCutoff: ONE_EURO_DEFAULTS.minCutoff,
  beta: ONE_EURO_DEFAULTS.beta,
  gain: 1,
  deadZone: 0,
});

// gain と preset の deadZone を当てる入力（中央が「ふつう」の状態の入力）。
// 目の開き・口の開き（0..1）は端がふつうの状態なので当てない（当てると、安定で目が閉じ切らず口が少し開いたままになる）
export const CENTERED_TRACKING_INPUTS: ReadonlySet<TrackingInput> = new Set<TrackingInput>([
  'faceYaw',
  'facePitch',
  'faceRoll',
  'eyeBallX',
  'eyeBallY',
  'mouthForm',
  'mouthWidth',
  'browY',
]);

function finiteAtLeast(v: unknown, min: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback;
}

// プリセットの名前（と custom の値）から使う値を決める。毎回新しいオブジェクトを返す。
// custom の値が無いときは標準。custom の壊れた値（NaN・負など）は、その項目だけ標準の値にする
// （minCutoff は正、beta・gain・deadZone は 0 以上）
export function resolveTrackingTuning(p: TrackingPreset, custom?: Partial<TrackingTuning>): TrackingTuning {
  const standard = TRACKING_PRESETS.standard;
  if (p !== 'custom') return { ...(TRACKING_PRESETS[p] ?? standard) };
  if (!custom) return { ...standard };
  return {
    minCutoff: finiteAtLeast(custom.minCutoff, Number.MIN_VALUE, standard.minCutoff),
    beta: finiteAtLeast(custom.beta, 0, standard.beta),
    gain: finiteAtLeast(custom.gain, 0, standard.gain),
    deadZone: finiteAtLeast(custom.deadZone, 0, standard.deadZone),
  };
}

export function sameTuning(a: Readonly<TrackingTuning>, b: Readonly<TrackingTuning>): boolean {
  return a.minCutoff === b.minCutoff && a.beta === b.beta && a.gain === b.gain && a.deadZone === b.deadZone;
}
