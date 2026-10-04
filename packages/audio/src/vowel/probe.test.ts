import { describe, expect, it } from 'vitest';
import { createVowelEstimator, dominantVowel } from './vowel';
import { SYNTH_VOWELS, synthFormants, synthVowel } from './synth';

describe('母音の推定', () => {
  for (const sampleRate of [48000, 44100, 16000]) {
    for (const voice of ['male', 'female'] as const) {
      it(`${sampleRate}Hz・${voice}: 合成した5母音を20msの窓で識別する`, () => {
        const est = createVowelEstimator();
        for (const vowel of ['a', 'i', 'u', 'e', 'o'] as const) {
          const [f1, f2] = SYNTH_VOWELS[voice][vowel];
          const samples = synthVowel({
            sampleRate,
            durationMs: 300,
            f0: SYNTH_VOWELS[voice].f0,
            formants: synthFormants(f1, f2),
            noiseDb: -70,
            rmsDb: -30,
          });
          const size = Math.round(sampleRate * 0.02);
          const results = [];
          for (let offset = size; offset + size <= samples.length; offset += size) {
            const p = est.estimate(samples.subarray(offset, offset + size), sampleRate);
            expect(Object.values(p).every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
            expect(Object.values(p).reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 10);
            results.push(dominantVowel(p));
          }
          expect(results.filter((v) => v === vowel).length / results.length, vowel).toBeGreaterThanOrEqual(0.85);
        }
      });
    }
  }
  it('無音・空・不正なレートは閉じる', () => {
    const est = createVowelEstimator();
    for (const rate of [48000, 0, NaN, Infinity]) {
      expect(est.estimate(new Float32Array(960), rate)).toEqual({ closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 });
    }
    expect(dominantVowel(est.estimate(new Float32Array(), 48000))).toBe('closed');
  });
});
