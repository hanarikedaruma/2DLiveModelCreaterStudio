import { describe, expect, it } from 'vitest';
import { type MappingShape, applyDeadZone, mapTrackingValue, smoothstep } from './map';

const base: MappingShape = {
  inputRange: [-30, 30],
  outputRange: [-30, 30],
  invert: false,
  curve: 'linear',
  deadZone: 0,
};

describe('mapTrackingValue', () => {
  it('inputRange → outputRange の線形', () => {
    expect(mapTrackingValue(12, base)).toBeCloseTo(12, 9);
    const toUnit: MappingShape = { ...base, outputRange: [0, 1] };
    expect(mapTrackingValue(0, toUnit)).toBeCloseTo(0.5, 9);
    expect(mapTrackingValue(15, toUnit)).toBeCloseTo(0.75, 9);
    expect(mapTrackingValue(0.5, { ...base, inputRange: [0, 1], outputRange: [0.2, 0.8] })).toBeCloseTo(0.5, 9);
  });

  it('範囲の外は丸める', () => {
    expect(mapTrackingValue(45, base)).toBe(30);
    expect(mapTrackingValue(-100, base)).toBe(-30);
    expect(mapTrackingValue(2, { ...base, inputRange: [0, 1], outputRange: [0, 1] })).toBe(1);
  });

  it('invert は出力範囲の中で向きを逆にする', () => {
    const inv: MappingShape = { ...base, invert: true };
    expect(mapTrackingValue(10, inv)).toBeCloseTo(-10, 9);
    expect(mapTrackingValue(40, inv)).toBe(-30);
    expect(mapTrackingValue(0.2, { ...base, inputRange: [0, 1], outputRange: [0, 1], invert: true })).toBeCloseTo(
      0.8,
      9,
    );
  });

  it('逆向きの inputRange は invert と同じ', () => {
    expect(mapTrackingValue(10, { ...base, inputRange: [30, -30] })).toBeCloseTo(-10, 9);
    expect(mapTrackingValue(50, { ...base, inputRange: [30, -30] })).toBe(-30);
  });

  it('deadZone: 中央 ± deadZone は中央の値。外は端まで届き、境目で跳ばない', () => {
    const dz: MappingShape = { ...base, deadZone: 2 };
    expect(mapTrackingValue(1.5, dz)).toBe(0);
    expect(mapTrackingValue(-2, dz)).toBe(0);
    expect(mapTrackingValue(30, dz)).toBe(30);
    expect(mapTrackingValue(-30, dz)).toBe(-30);
    expect(mapTrackingValue(2.0001, dz)).toBeCloseTo(0, 3);
    expect(mapTrackingValue(16, dz)).toBeCloseTo(15, 9); // (16 − 2) × 30 / 28
    // 中央は入力範囲の真ん中
    const eye: MappingShape = { ...base, inputRange: [0, 1], outputRange: [0, 1], deadZone: 0.1 };
    expect(mapTrackingValue(0.45, eye)).toBeCloseTo(0.5, 9);
    expect(mapTrackingValue(1, eye)).toBe(1);
  });

  it("curve 'smooth' は smoothstep", () => {
    const sm: MappingShape = { ...base, inputRange: [0, 1], outputRange: [0, 1], curve: 'smooth' };
    expect(mapTrackingValue(0, sm)).toBe(0);
    expect(mapTrackingValue(0.25, sm)).toBeCloseTo(0.15625, 9);
    expect(mapTrackingValue(0.5, sm)).toBeCloseTo(0.5, 9);
    expect(mapTrackingValue(1, sm)).toBe(1);
    expect(mapTrackingValue(15, { ...base, curve: 'smooth' })).toBeCloseTo(-30 + 60 * smoothstep(0.75), 9);
  });

  it('幅の無い inputRange は段差（値より下なら出力の始め、以上なら終わり）', () => {
    const flat: MappingShape = { ...base, inputRange: [0, 0], outputRange: [0, 1] };
    expect(mapTrackingValue(-1, flat)).toBe(0);
    expect(mapTrackingValue(0, flat)).toBe(1);
  });
});

describe('applyDeadZone', () => {
  it('deadZone が 0 なら変えない', () => {
    expect(applyDeadZone(0.3, [-1, 1], 0)).toBe(0.3);
  });

  it('deadZone が範囲の半分以上なら常に中央', () => {
    expect(applyDeadZone(0.9, [-1, 1], 1)).toBe(0);
  });
});
