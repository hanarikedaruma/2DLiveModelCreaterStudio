import { describe, expect, it } from 'vitest';
import { DEFAULT_SMOOTHING, ONE_EURO_DEFAULTS, OneEuroFilter, smoothingToMinCutoff } from './oneEuro';

const FRAME = 1000 / 30;

// 30fps で、k0 番目のフレームから from → to の段差を入れたときの出力
function stepResponse(filter: OneEuroFilter, from: number, to: number, k0: number, frames: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < frames; k++) out.push(filter.filter(k < k0 ? from : to, k * FRAME));
  return out;
}

// 段差から 150ms 以内の最後のフレームの出力が、段差の何割まで届いたか
function reachedWithin150ms(out: number[], from: number, to: number, k0: number): number {
  const k = k0 + Math.floor(150 / FRAME);
  return (out[k]! - from) / (to - from);
}

describe('OneEuroFilter', () => {
  it('最初の値はそのまま返す', () => {
    expect(new OneEuroFilter(ONE_EURO_DEFAULTS).filter(12, 0)).toBe(12);
  });

  it('初期値（minCutoff 1.0・beta 0.02・dCutoff 1.0）で、30fps の 30 の段差に 150ms 以内に 90% へ届く', () => {
    const out = stepResponse(new OneEuroFilter(ONE_EURO_DEFAULTS), 0, 30, 10, 30);
    expect(out[9]).toBe(0);
    expect(reachedWithin150ms(out, 0, 30, 10)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...out)).toBeLessThanOrEqual(30); // 行き過ぎない
  });

  it('60 の段差（範囲の端から端）も 150ms 以内に 90% へ届く', () => {
    const out = stepResponse(new OneEuroFilter(ONE_EURO_DEFAULTS), -30, 30, 5, 20);
    expect(reachedWithin150ms(out, -30, 30, 5)).toBeGreaterThanOrEqual(0.9);
  });

  it('小さな揺れはならす（±0.5 の揺れを半分より小さくする）', () => {
    const filter = new OneEuroFilter(ONE_EURO_DEFAULTS);
    const out: number[] = [];
    for (let k = 0; k < 120; k++) out.push(filter.filter(10 + (k % 2 === 0 ? 0.5 : -0.5), k * FRAME));
    const tail = out.slice(60);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.5);
  });

  it('minCutoff が小さいほど遅れる', () => {
    const fast = stepResponse(new OneEuroFilter({ ...ONE_EURO_DEFAULTS, minCutoff: 3 }), 0, 5, 1, 4);
    const slow = stepResponse(new OneEuroFilter({ ...ONE_EURO_DEFAULTS, minCutoff: 0.3 }), 0, 5, 1, 4);
    expect(fast[3]!).toBeGreaterThan(slow[3]!);
  });

  it('時刻が進まないときは前の出力のまま。reset で最初からやり直す', () => {
    const filter = new OneEuroFilter(ONE_EURO_DEFAULTS);
    filter.filter(0, 0);
    const a = filter.filter(10, FRAME);
    expect(filter.filter(20, FRAME)).toBe(a);
    filter.reset();
    expect(filter.filter(7, 2 * FRAME)).toBe(7);
  });
});

describe('smoothingToMinCutoff', () => {
  it('0 → 3.0、1 → 0.3。間は対数の上で等間隔', () => {
    expect(smoothingToMinCutoff(0)).toBeCloseTo(3.0, 9);
    expect(smoothingToMinCutoff(1)).toBeCloseTo(0.3, 9);
    expect(smoothingToMinCutoff(0.5)).toBeCloseTo(Math.sqrt(3.0 * 0.3), 9);
  });

  it('範囲の外は丸める', () => {
    expect(smoothingToMinCutoff(-1)).toBeCloseTo(3.0, 9);
    expect(smoothingToMinCutoff(2)).toBeCloseTo(0.3, 9);
    expect(smoothingToMinCutoff(Number.NaN)).toBeCloseTo(3.0, 9);
  });

  it('DEFAULT_SMOOTHING は初期値の minCutoff 1.0 になる', () => {
    expect(smoothingToMinCutoff(DEFAULT_SMOOTHING)).toBeCloseTo(1.0, 9);
  });
});
