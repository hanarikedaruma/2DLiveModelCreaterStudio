import type { VowelEstimator } from '@app/contracts';
import { VOWEL_WINDOW_MS, type VowelProbabilities } from './vowel';

// AudioSource の10ms刻みの波形を20msにまとめる。再開・機器変更時に古い波形を混ぜない。
export function createVowelSampler(estimator: VowelEstimator) {
  let buffer = new Float32Array(0);
  let filled = 0;
  let rate = 0;
  let frameStart = 0;
  let previous: number | null = null;
  let latest: { time: number; start: number; probabilities: VowelProbabilities } | null = null;
  return {
    update(samples: Float32Array, sampleRate: number, time: number) {
      if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(time)) return;
      if (rate !== sampleRate || previous === null || time < previous || time - previous > 100) {
        rate = sampleRate;
        buffer = new Float32Array(Math.round((rate * VOWEL_WINDOW_MS) / 1000));
        filled = 0;
        latest = null;
      }
      previous = time;
      for (let offset = 0; offset < samples.length;) {
        if (filled === 0) frameStart = time + (offset * 1000) / rate;
        const length = Math.min(buffer.length - filled, samples.length - offset);
        buffer.set(samples.subarray(offset, offset + length), filled);
        offset += length;
        filled += length;
        if (filled === buffer.length) {
          latest = { time, start: frameStart, probabilities: estimator.estimate(buffer, rate) };
          filled = 0;
        }
      }
    },
    current(now: number): VowelProbabilities | null {
      return latest && now >= latest.time && now - latest.time <= 100 ? latest.probabilities : null;
    },
    frameTime(): number | null {
      return latest?.start ?? null;
    },
    clear() {
      previous = null;
      latest = null;
      filled = 0;
    },
  };
}
