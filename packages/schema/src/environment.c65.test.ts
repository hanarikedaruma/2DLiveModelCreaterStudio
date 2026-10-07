// カード65 の受け入れテスト。受け入れテスト担当 CO。
import { describe, expect, it } from 'vitest';
import { createDefaultEnvironment } from './defaults';
import { validateEnvironment } from './validate';

describe('カード65: 自動まばたきと出力 GPU の保存形式', () => {
  it('既定値は自動まばたきオン、GPU 自動選択で、JSON にして読み直せる', () => {
    const defaults = createDefaultEnvironment();
    expect(defaults).toMatchObject({ autoBlink: true, output: { adapterId: null } });
    expect(validateEnvironment(JSON.parse(JSON.stringify(defaults)))).toEqual(defaults);
  });

  it('自動まばたきオフと選んだ GPU の識別子を保存する', () => {
    const defaults = createDefaultEnvironment();
    const changed = {
      ...defaults,
      autoBlink: false,
      output: { ...defaults.output, adapterId: 'luid:00000000:00001234' },
    };
    expect(validateEnvironment(JSON.parse(JSON.stringify(changed)))).toEqual(changed);
  });

  it.each([0, 1, 'false', null])('autoBlink の不正な値 %j を拒む', (autoBlink) => {
    expect(() => validateEnvironment({ ...createDefaultEnvironment(), autoBlink })).toThrow();
  });

  it.each([false, 123, {}])('GPU の不正な識別子 %j を拒む', (adapterId) => {
    const defaults = createDefaultEnvironment();
    expect(() => validateEnvironment({ ...defaults, output: { ...defaults.output, adapterId } })).toThrow();
  });
});
