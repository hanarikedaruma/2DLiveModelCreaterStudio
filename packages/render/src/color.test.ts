import { describe, expect, it } from 'vitest';
import { parseCssColor } from './color';

describe('parseCssColor', () => {
  it('16進の書き方を読む', () => {
    expect(parseCssColor('#336699')).toEqual([0.2, 0.4, 0.6, 1]);
    expect(parseCssColor('#FFF')).toEqual([1, 1, 1, 1]);
    expect(parseCssColor('#00000080')).toEqual([0, 0, 0, 128 / 255]);
    expect(parseCssColor('#f008')).toEqual([1, 0, 0, 0x88 / 255]);
  });

  it('rgb()・rgba() を読む（カンマ区切りと空白区切り）', () => {
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2, 1]);
    expect(parseCssColor('rgba(255, 255, 255, 0.5)')).toEqual([1, 1, 1, 0.5]);
    expect(parseCssColor('rgb(100% 0% 0% / 25%)')).toEqual([1, 0, 0, 0.25]);
  });

  it('transparent は透明', () => {
    expect(parseCssColor('transparent')).toEqual([0, 0, 0, 0]);
  });

  it('読めない書き方は null（ブラウザに任せる）', () => {
    expect(parseCssColor('white')).toBeNull();
    expect(parseCssColor('#12345')).toBeNull();
    expect(parseCssColor('rgb(1, 2)')).toBeNull();
  });
});
