import { describe, expect, it } from 'vitest';
import { lpcEnvelopeDb, lpcResonances } from './lpc';

// 周波数 f・帯域幅 bw の共振を1つだけ持つ A(z) = 1 - 2r cosθ z^-1 + r² z^-2
function resonator(f: number, bw: number, rate: number): number[] {
  const r = Math.exp((-Math.PI * bw) / rate);
  const theta = (2 * Math.PI * f) / rate;
  return [1, -2 * r * Math.cos(theta), r * r];
}

describe('LPC の包絡', () => {
  it('共振の周波数でいちばん強く、根から同じ周波数と帯域幅が求まる', () => {
    const a = resonator(1000, 100, 8000);
    const peak = lpcEnvelopeDb(a, 1000, 8000);
    for (const f of [300, 700, 1300, 2000, 3500]) expect(peak).toBeGreaterThan(lpcEnvelopeDb(a, f, 8000) + 6);
    const [res] = lpcResonances(a, 8000);
    expect(res?.frequency).toBeCloseTo(1000, 0);
    expect(res?.bandwidth).toBeCloseTo(100, 0);
  });

  it('高域強調の係数を渡すと、強調で持ち上げた分を戻す', () => {
    const alpha = 0.96;
    const flat = [1];
    expect(lpcEnvelopeDb(flat, 1000, 8000)).toBeCloseTo(0, 10);
    // 1 - α z^-1 は低い周波数で弱め、高い周波数で強める。戻すとその逆になる
    expect(lpcEnvelopeDb(flat, 4000, 8000, alpha)).toBeCloseTo(-20 * Math.log10(1 + alpha), 10);
    expect(lpcEnvelopeDb(flat, 100, 8000, alpha)).toBeGreaterThan(lpcEnvelopeDb(flat, 3000, 8000, alpha) + 15);
    // 共振の包絡に足し合わせになる
    const a = resonator(1000, 100, 8000);
    const w = (2 * Math.PI * 2500) / 8000;
    const emphasisDb = 10 * Math.log10(1 + alpha * alpha - 2 * alpha * Math.cos(w));
    expect(lpcEnvelopeDb(a, 2500, 8000, alpha)).toBeCloseTo(lpcEnvelopeDb(a, 2500, 8000) - emphasisDb, 10);
  });
});
