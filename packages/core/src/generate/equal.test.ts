import { describe, expect, it } from 'vitest';
import { deepEqual } from './equal';

describe('deepEqual', () => {
  it('入れ子の配列とオブジェクトを中身で比べる', () => {
    expect(deepEqual({ a: [1, { b: 'x' }], c: null }, { a: [1, { b: 'x' }], c: null })).toBe(true);
    expect(deepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
  });

  it('キーの順番は問わず、0 と -0 は同じ', () => {
    expect(deepEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(deepEqual({ x: -0 }, { x: 0 })).toBe(true);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('配列とオブジェクト、null とオブジェクトは違う', () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
  });
});
