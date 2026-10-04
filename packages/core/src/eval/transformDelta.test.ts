import { describe, expect, it } from 'vitest';
import { delta } from './testModel';
import { composeDelta, identityDelta } from './transformDelta';

describe('composeDelta', () => {
  it('位置・回転は加算、拡縮・不透明度は乗算。入力は書き換えない', () => {
    const a = delta({ px: 1, py: 2, rot: 3, sx: 2, sy: 0.5, op: 0.5 });
    const b = delta({ px: -4, py: 1, rot: 10, sx: 1.5, sy: 4, op: 0.5 });
    const before = structuredClone({ a, b });
    expect(composeDelta(a, b)).toEqual(delta({ px: -3, py: 3, rot: 13, sx: 3, sy: 2, op: 0.25 }));
    expect({ a, b }).toEqual(before);
  });

  it('変化なしと合わせても変わらない', () => {
    const a = delta({ px: 1, rot: 3, sx: 2, op: 0.5 });
    expect(composeDelta(a, identityDelta())).toEqual(a);
    expect(identityDelta()).toEqual(delta());
  });
});
