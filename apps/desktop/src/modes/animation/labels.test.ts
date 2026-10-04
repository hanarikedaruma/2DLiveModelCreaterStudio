import { describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters } from '@app/schema';
import { formatClock, formatTime, formatValue, groupNames, parameterGroupsOf, rulerStep, sliderStep } from './labels';

describe('アニメーション画面の表示', () => {
  it('時刻: 末尾の 0 を付けない表示と、小数2桁の表示', () => {
    expect([0, 0.5, 1.57, 2, -0.001].map(formatTime)).toEqual(['0', '0.5', '1.57', '2', '0']);
    expect([0, 0.5, 2].map(formatClock)).toEqual(['0.00', '0.50', '2.00']);
  });

  it('値: 幅が10以上（顔の角度など）は整数で刻み 1、ほかは小数2桁で刻みは幅の 1/100', () => {
    const angle = { min: -30, max: 30 };
    const open = { min: 0, max: 1 };
    expect(formatValue(angle, 12.4)).toBe('12');
    expect(formatValue(angle, -0.2)).toBe('0');
    expect(formatValue(open, 0.456)).toBe('0.46');
    expect(sliderStep(angle)).toBe(1);
    expect(sliderStep(open)).toBe(0.01);
  });

  it('目盛りは長さに対して10本くらいまで', () => {
    expect(rulerStep(1)).toBe(0.1);
    expect(rulerStep(2)).toBe(0.25);
    expect(rulerStep(5)).toBe(0.5);
    expect(rulerStep(30)).toBe(5);
    expect(rulerStep(600)).toBe(60);
  });

  it('パラメータはモデルのグループの順にまとめ、グループの名前を「・」でつなぐ', () => {
    const p = createEmptyProject('テスト');
    const model = ensureStandardParameters(p.model, 'step1');
    expect(parameterGroupsOf(model).map((g) => [g.group.id, g.parameters.length])).toEqual([
      ['face', 3],
      ['eye', 6],
      ['brow', 4],
      ['mouth', 3],
      ['cheek', 1],
      ['body', 3],
    ]);
    expect(groupNames(model, ['face', 'mouth', 'sway'])).toBe('顔・口・揺れもの');
  });
});
