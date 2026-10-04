import { describe, expect, it } from 'vitest';
import { presetOf } from './presets';

const presets = {
  stable: { minCutoff: 0.5, beta: 0.001, gain: 1 },
  standard: { minCutoff: 1, beta: 0.007, gain: 1 },
  large: { minCutoff: 1, beta: 0.007, gain: 1.5 },
};

describe('presetOf', () => {
  it('すべての項目が一致するプリセットの名前を返す', () => {
    expect(presetOf({ minCutoff: 1, beta: 0.007, gain: 1 }, presets)).toBe('standard');
    expect(presetOf({ minCutoff: 1, beta: 0.007, gain: 1.5 }, presets)).toBe('large');
    // 項目の順番は関係ない
    expect(presetOf({ gain: 1, beta: 0.001, minCutoff: 0.5 }, presets)).toBe('stable');
  });

  it('どれとも一致しなければ custom', () => {
    expect(presetOf({ minCutoff: 1, beta: 0.007, gain: 1.2 }, presets)).toBe('custom');
    expect(presetOf({ minCutoff: 2, beta: 0.007, gain: 1 }, presets)).toBe('custom');
    expect(presetOf({ minCutoff: 1, beta: 0.007, gain: 1 }, {})).toBe('custom');
  });

  it('既定の許容差は小数の計算の誤差だけを許す', () => {
    expect(presetOf({ minCutoff: 0.1 + 0.2, beta: 0, gain: 1 }, { a: { minCutoff: 0.3, beta: 0, gain: 1 } })).toBe('a');
    expect(presetOf({ minCutoff: 1.001, beta: 0.007, gain: 1 }, presets)).toBe('custom');
  });

  it('許容差を指定すると、その差までは一致とみなす（境目を含む）', () => {
    expect(presetOf({ minCutoff: 1.05, beta: 0.007, gain: 1 }, presets, 0.1)).toBe('standard');
    expect(presetOf({ minCutoff: 1.5, beta: 0.007, gain: 1 }, presets, 0.5)).toBe('standard');
    expect(presetOf({ minCutoff: 1.6, beta: 0.007, gain: 1 }, presets, 0.5)).toBe('custom');
  });

  it('複数に一致するときは先に書いたプリセット', () => {
    expect(presetOf({ minCutoff: 1, beta: 0.007, gain: 1.2 }, presets, 0.3)).toBe('standard');
  });

  it('片方にしか無い項目や NaN があれば一致しない', () => {
    const loose = { a: { x: 1 } } as Record<string, Record<string, number>>;
    expect(presetOf({ x: 1, y: 2 }, loose)).toBe('custom');
    expect(presetOf({ x: Number.NaN }, { a: { x: Number.NaN } })).toBe('custom');
  });
});
