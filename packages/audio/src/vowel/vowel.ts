// 母音の推定（カード51）。20ms の窓ごとに 8kHz くらいへ間引き、LPC（次数 10）で第1・第2フォルマントを求め、
// 母音ごとの代表値（成人の平均）との距離から確率に直す（合計 1）。無音（しきい値以下）とフォルマントが取れない窓は closed。
// 話者ごとのキャリブレーションはしない。音声はこの PC の中だけで扱う
import type { VowelEstimator } from '@app/contracts';
import type { LipSync } from '@app/schema';
import { levelDbOf } from '../source/level';
import {
  autocorrelation,
  decimate,
  levinsonDurbin,
  lpcEnvelopeDb,
  lpcResonances,
  prepareFrame,
  type Formant,
} from './lpc';

export type VowelId = LipSync['vowels'][number]['vowel'];
export type SpokenVowelId = Exclude<VowelId, 'closed'>;
export type VowelProbabilities = ReturnType<VowelEstimator['estimate']>;

export const VOWEL_IDS: readonly VowelId[] = ['closed', 'a', 'i', 'u', 'e', 'o'];
export const SPOKEN_VOWEL_IDS: readonly SpokenVowelId[] = ['a', 'i', 'u', 'e', 'o'];

export const VOWEL_WINDOW_MS = 20; // 1回の推定に使う長さ
export const VOWEL_LPC_ORDER = 10; // 間引いたあと 8kHz のときの次数
// 無音とみなす音量（dBFS）。リップシンクの「無音とみなす音量」のスライダーの下限と同じにして、
// それより上はリップシンクの側のしきい値で決める（ここを高くすると、小さい声で口が開かなくなる）
export const DEFAULT_VOWEL_SILENCE_DB = -80;

// 日本語の5母音の第1・第2フォルマント（Hz）。成人の男性と女性の平均くらい
export const ADULT_VOWEL_FORMANTS: Readonly<Record<SpokenVowelId, { f1: number; f2: number }>> = {
  a: { f1: 850, f2: 1300 },
  i: { f1: 320, f2: 2500 },
  u: { f1: 360, f2: 1400 },
  e: { f1: 540, f2: 2100 },
  o: { f1: 520, f2: 900 },
};
// 距離の目盛り（対数の周波数で、この幅を 1 とする）。話者による違い（2割くらい）を吸収する
export const VOWEL_FORMANT_SPREAD = { f1: 0.25, f2: 0.2 };

// 間引いたあとのサンプリング周波数（これ以上で、いちばん近いもの）。第1・第2フォルマントは 4kHz より下にある。
// それより上を残すと、声の弱い高い周波数で雑音（高域強調で持ち上がる）に LPC の極を取られる（I-045）
const TARGET_RATE = 8000;
const PRE_EMPHASIS_HZ = 50; // 高域強調（声の -6dB/oct の傾きを打ち消す）
// これより帯域幅の広い共振は第1フォルマントとみなさない。第2フォルマントは WIDE_BANDWIDTH までの広いものも
// 候補にする（「お」の第2フォルマントは弱く、雑音があると帯域幅が広く出る）が、強さを WIDE_PENALTY_DB だけ割り引く
const MAX_BANDWIDTH = 500;
const WIDE_BANDWIDTH = 900;
const WIDE_PENALTY_DB = 5;
// 第2フォルマントは候補のうち強いもの。いちばん強いものとの差がこれ以内の狭い共振が下にあれば、低い方を選ぶ（第3と取り違えない）
const LOWER_PEAK_DB = 2;
const F1_RANGE = [200, 1200] as const;
const F2_RANGE = [600, 3500] as const;

export const CLOSED_PROBABILITIES: Readonly<VowelProbabilities> = { closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 };
const closed = (): VowelProbabilities => ({ ...CLOSED_PROBABILITIES });

export interface VowelFrameAnalysis {
  levelDb: number;
  resonances: Formant[]; // 帯域幅で絞る前の共振（周波数の小さい順）
  f1: number | null;
  f2: number | null;
}

// 1つの窓を解析する（音量・共振・第1・第2フォルマント）。短すぎる窓はフォルマントを求めない
export function analyzeVowelFrame(
  samples: ArrayLike<number>,
  sampleRate: number,
  order = VOWEL_LPC_ORDER,
): VowelFrameAnalysis {
  const levelDb = levelDbOf(samples);
  const none: VowelFrameAnalysis = { levelDb, resonances: [], f1: null, f2: null };
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) return none;
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  const rate = sampleRate / factor;
  // 間引いたあとが 8kHz より高いとき（11.025kHz など）は、周波数の細かさが同じになるよう次数を増やす
  const lpcOrder = Math.max(order, Math.round((order * rate) / TARGET_RATE));
  const x = decimate(samples, factor);
  if (x.length < lpcOrder * 2 + 2) return none;
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i]!)) x[i] = 0;
  const preEmphasis = Math.exp((-2 * Math.PI * PRE_EMPHASIS_HZ) / rate);
  prepareFrame(x, preEmphasis);
  const r = autocorrelation(x, lpcOrder);
  r[0]! *= 1 + 1e-9; // 計算を安定させるためのわずかな白色雑音
  const a = levinsonDurbin(r, lpcOrder);
  if (!a) return none;
  const resonances = lpcResonances(a, rate);
  const first = resonances.find(
    (f) => f.bandwidth < MAX_BANDWIDTH && f.frequency >= F1_RANGE[0] && f.frequency <= F1_RANGE[1],
  );
  if (!first) return { ...none, resonances };
  const second = secondFormantOf(resonances, first, (f) => lpcEnvelopeDb(a, f, rate, preEmphasis), rate);
  return { levelDb, resonances, f1: first.frequency, f2: second ? second.frequency : null };
}

// 第2フォルマントを選ぶ。第1より上で範囲の中の共振を、高域強調を戻した LPC の包絡の強さ（envelopeDb）で比べる
// （帯域幅の広いものは割り引く）。低い順に選ぶと、雑音でできた弱い極（「い」の 1.5kHz くらいなど）や、
// 「お」で第2フォルマントが広がったときに上の雑音の極を拾うため（I-045）
function secondFormantOf(
  resonances: readonly Formant[],
  first: Formant,
  envelopeDb: (frequency: number) => number,
  rate: number,
): Formant | undefined {
  const top = Math.min(F2_RANGE[1], rate / 2 - 50);
  const candidates = resonances.filter(
    (f) =>
      f.frequency > first.frequency && f.frequency >= F2_RANGE[0] && f.frequency <= top && f.bandwidth < WIDE_BANDWIDTH,
  );
  const strengths = candidates.map(
    (f) => envelopeDb(f.frequency) - (f.bandwidth < MAX_BANDWIDTH ? 0 : WIDE_PENALTY_DB),
  );
  let best = -1;
  for (let k = 0; k < candidates.length; k++) if (best < 0 || strengths[k]! > strengths[best]!) best = k;
  if (best < 0) return undefined;
  // candidates は周波数の小さい順
  for (let k = 0; k < best; k++) {
    if (candidates[k]!.bandwidth < MAX_BANDWIDTH && strengths[k]! >= strengths[best]! - LOWER_PEAK_DB)
      return candidates[k];
  }
  return candidates[best];
}

// 第1・第2フォルマントから5母音の確率（合計 1）。代表値との対数の距離 d から exp(-d²/2) に比例させる
export function vowelProbabilitiesFromFormants(
  f1: number,
  f2: number,
  references: Readonly<Record<SpokenVowelId, { f1: number; f2: number }>> = ADULT_VOWEL_FORMANTS,
): Record<SpokenVowelId, number> {
  const d2 = SPOKEN_VOWEL_IDS.map((v) => {
    const ref = references[v];
    const x = Math.log(f1 / ref.f1) / VOWEL_FORMANT_SPREAD.f1;
    const y = Math.log(f2 / ref.f2) / VOWEL_FORMANT_SPREAD.f2;
    return x * x + y * y;
  });
  const min = Math.min(...d2);
  const scores = d2.map((d) => Math.exp(-(d - min) / 2));
  const sum = scores.reduce((s, v) => s + v, 0);
  return Object.fromEntries(SPOKEN_VOWEL_IDS.map((v, k) => [v, scores[k]! / sum])) as Record<SpokenVowelId, number>;
}

export interface VowelEstimatorOptions {
  silenceThresholdDb?: number; // 既定は DEFAULT_VOWEL_SILENCE_DB
  references?: Readonly<Record<SpokenVowelId, { f1: number; f2: number }>>; // 既定は ADULT_VOWEL_FORMANTS
}

export interface AudioVowelEstimator extends VowelEstimator {
  analyze(samples: Float32Array, sampleRate: number): VowelFrameAnalysis; // 最後の窓の解析（確かめる用）
}

// 渡された波形を、終わりから 20ms ずつの窓に分けて推定し、平均する（ふつうはちょうど 20ms を渡す）。
// 20ms に満たないときは全体を1つの窓とする
export function createVowelEstimator(options: VowelEstimatorOptions = {}): AudioVowelEstimator {
  const threshold = Number.isFinite(options.silenceThresholdDb)
    ? options.silenceThresholdDb!
    : DEFAULT_VOWEL_SILENCE_DB;
  const references = options.references ?? ADULT_VOWEL_FORMANTS;

  function estimateFrame(frame: ArrayLike<number>, sampleRate: number): VowelProbabilities {
    if (!(levelDbOf(frame) > threshold)) return closed();
    const { f1, f2 } = analyzeVowelFrame(frame, sampleRate);
    if (f1 === null || f2 === null) return closed();
    return { closed: 0, ...vowelProbabilitiesFromFormants(f1, f2, references) };
  }

  function windowsOf(samples: Float32Array, sampleRate: number): Float32Array[] {
    const size = Math.round((sampleRate * VOWEL_WINDOW_MS) / 1000);
    if (!(size > 0) || samples.length <= size) return [samples];
    const out: Float32Array[] = [];
    for (let end = samples.length; end - size >= 0; end -= size) out.push(samples.subarray(end - size, end));
    return out.reverse();
  }

  return {
    estimate(samples, sampleRate) {
      if (samples.length === 0 || !(sampleRate > 0) || !Number.isFinite(sampleRate)) return closed();
      const windows = windowsOf(samples, sampleRate);
      const sum = closed();
      sum.closed = 0;
      for (const w of windows) {
        const p = estimateFrame(w, sampleRate);
        for (const v of VOWEL_IDS) sum[v] += p[v];
      }
      for (const v of VOWEL_IDS) sum[v] /= windows.length;
      return sum;
    },
    analyze(samples, sampleRate) {
      const windows = samples.length === 0 || !(sampleRate > 0) ? [samples] : windowsOf(samples, sampleRate);
      return analyzeVowelFrame(windows[windows.length - 1]!, sampleRate);
    },
  };
}

// いちばん確率の大きい母音（同じなら VOWEL_IDS の順で先のもの）
export function dominantVowel(p: VowelProbabilities): VowelId {
  let best: VowelId = 'closed';
  for (const v of VOWEL_IDS) if (p[v] > p[best]) best = v;
  return best;
}
