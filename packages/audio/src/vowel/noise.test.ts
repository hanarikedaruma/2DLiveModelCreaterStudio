// I-045: 雑音のある入力での母音の推定（合成音声。声の実効値 -30dBFS に白色雑音を足す）
import { describe, expect, it } from 'vitest';
import { createVowelEstimator, dominantVowel, SPOKEN_VOWEL_IDS, type SpokenVowelId } from './vowel';
import { SYNTH_VOWELS, synthFormants, synthVowel } from './synth';

type Voice = keyof typeof SYNTH_VOWELS;

const RATES = [48000, 44100, 16000];
const VOICES: readonly Voice[] = ['male', 'female'];
// 基本周波数は代表値（男性 120Hz・女性 220Hz）の前後も見る
const F0S: Record<Voice, number[]> = { male: [90, 105, 120, 140, 160], female: [180, 200, 220, 250, 280] };
const SEEDS = [1, 2, 3];

// 300ms の合成音声を 20ms の窓ごとに推定し、正しい母音になった窓の割合を返す（最初の窓は使わない）
function hitRate(o: {
  sampleRate: number;
  voice: Voice;
  vowel: SpokenVowelId;
  noiseDb: number;
  f0?: number;
  seed?: number;
}): number {
  const est = createVowelEstimator();
  const [f1, f2] = SYNTH_VOWELS[o.voice][o.vowel];
  const samples = synthVowel({
    sampleRate: o.sampleRate,
    durationMs: 300,
    f0: o.f0 ?? SYNTH_VOWELS[o.voice].f0,
    formants: synthFormants(f1, f2),
    rmsDb: -30,
    noiseDb: o.noiseDb,
    seed: o.seed ?? 1,
  });
  const size = Math.round(o.sampleRate * 0.02);
  let hits = 0;
  let count = 0;
  for (let offset = size; offset + size <= samples.length; offset += size) {
    const p = est.estimate(samples.subarray(offset, offset + size), o.sampleRate);
    expect(Object.values(p).every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(Object.values(p).reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 10);
    if (dominantVowel(p) === o.vowel) hits += 1;
    count += 1;
  }
  return hits / count;
}

describe('母音の推定（雑音のある入力・I-045）', () => {
  it('16kHz・男性の「お」は、雑音 -50dBFS でも「え」などに寄らない', () => {
    for (const seed of SEEDS) {
      expect(
        hitRate({ sampleRate: 16000, voice: 'male', vowel: 'o', noiseDb: -50, seed }),
        `seed=${seed}`,
      ).toBeGreaterThanOrEqual(0.85);
    }
  });

  for (const sampleRate of RATES) {
    for (const voice of VOICES) {
      it(`${sampleRate}Hz・${voice}: 雑音 -50dBFS で、基本周波数や雑音を変えても5母音を識別する`, () => {
        for (const vowel of SPOKEN_VOWEL_IDS) {
          for (const f0 of F0S[voice]) {
            for (const seed of SEEDS) {
              expect(
                hitRate({ sampleRate, voice, vowel, noiseDb: -50, f0, seed }),
                `${vowel} f0=${f0} seed=${seed}`,
              ).toBeGreaterThanOrEqual(0.85);
            }
          }
        }
      });

      it(`${sampleRate}Hz・${voice}: 雑音 -45dBFS でも、母音ごとの平均で9割の窓を識別する`, () => {
        for (const vowel of SPOKEN_VOWEL_IDS) {
          let sum = 0;
          let count = 0;
          for (const f0 of F0S[voice]) {
            for (const seed of SEEDS) {
              sum += hitRate({ sampleRate, voice, vowel, noiseDb: -45, f0, seed });
              count += 1;
            }
          }
          expect(sum / count, vowel).toBeGreaterThanOrEqual(0.9);
        }
      });
    }
  }

  it('雑音だけの入力でも、確率は 0〜1 で合計 1', () => {
    const est = createVowelEstimator();
    for (const sampleRate of RATES) {
      const noise = synthVowel({
        sampleRate,
        durationMs: 20,
        f0: 100,
        formants: [],
        rmsDb: -200,
        noiseDb: -50,
        seed: 7,
      });
      const p = est.estimate(noise, sampleRate);
      expect(Object.values(p).every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(Object.values(p).reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 10);
    }
  });
});
