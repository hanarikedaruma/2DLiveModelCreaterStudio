import { describe, expect, it, vi } from 'vitest';
import { createVowelSampler } from './sampler';

describe('母音の20ms窓', () => {
  it('10msの波形2つから推定し、入力を変更せず、100msを過ぎた推定は使わない', () => {
    const estimate = vi.fn((_samples: Float32Array, _rate: number) => ({ closed: 0, a: 1, i: 0, u: 0, e: 0, o: 0 }));
    const sampler = createVowelSampler({ estimate });
    const samples = new Float32Array(480).fill(0.2);
    sampler.update(samples, 48000, 10);
    expect(estimate).not.toHaveBeenCalled();
    sampler.update(samples, 48000, 20);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(estimate.mock.calls[0]?.[0]).toHaveLength(960);
    expect(sampler.current(20)?.a).toBe(1);
    expect(sampler.current(120)?.a).toBe(1);
    expect(sampler.current(121)).toBeNull();
    expect(sampler.current(0)).toBeNull();
    expect(samples[0]).toBeCloseTo(0.2);
  });
  it('再開・レート変更・時間の逆行では半分の古い窓を捨てる', () => {
    const estimate = vi.fn((_samples: Float32Array, _rate: number) => ({ closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 }));
    const sampler = createVowelSampler({ estimate });
    sampler.update(new Float32Array(480), 48000, 10);
    sampler.update(new Float32Array(480), 48000, 500);
    expect(estimate).not.toHaveBeenCalled();
    sampler.update(new Float32Array(160), 16000, 510);
    expect(estimate).not.toHaveBeenCalled();
    sampler.update(new Float32Array(160), 16000, 5);
    expect(estimate).not.toHaveBeenCalled();
    sampler.update(new Float32Array(160), 16000, 15);
    expect(estimate).toHaveBeenCalledTimes(1);
    sampler.clear();
    expect(sampler.current(15)).toBeNull();
  });
});
