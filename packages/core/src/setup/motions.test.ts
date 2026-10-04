import { createEmptyProject, type Binding, type Model, type ParameterKey, type Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { transformDelta } from '../generate/keys';
import { newGroupPart } from './hierarchy';
import { applyMotionPlans, blinkMethod, keepOnRerun, mouthMethod, type BindingPlan } from './motions';
import { indexStandardParts } from './standardParts';

function image(id: string, patch: Partial<Part> = {}): Part {
  return { ...newGroupPart(id, 'bodyRoot'), kind: 'image', standardType: null, name: id, ...patch };
}
function model(bindings: Binding[]): Model {
  return { ...createEmptyProject('t').model, parts: [image('a'), image('b')], bindings };
}
function key(coord: number, x: number, source: ParameterKey['source'] = 'auto', locked = false): ParameterKey {
  return { coords: [coord], delta: transformDelta({ x }), source, locked };
}
function binding(id: string, partId: string, parameterId: string, keys: ParameterKey[]): Binding {
  return {
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
  };
}
const plan = (partId: string, parameterId: string, x: number): BindingPlan => ({
  partId,
  parameterId,
  generation: 'linear',
  keys: [
    { coord: 0, delta: transformDelta() },
    { coord: 1, delta: transformDelta({ x }) },
  ],
});
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('applyMotionPlans', () => {
  it('無ければ作り、あれば manual と locked のキーを残して作り直す', () => {
    const manual = key(1, 50, 'manual');
    const locked = key(0.5, 9, 'generated', true);
    const m = model([binding('old', 'a', 'MouthOpen', [key(0, 0), key(0.25, 3, 'generated'), locked, manual])]);
    const out = applyMotionPlans(m, [plan('a', 'MouthOpen', 10), plan('b', 'MouthOpen', 20)], ids());
    expect(out.bindings.map((b) => b.id)).toEqual(['old', 'n1']);
    expect(out.bindings[0]!.keys).toEqual([key(0, 0), locked, manual]);
    expect(out.bindings[0]!.keyValues).toEqual([[0, 0.5, 1]]);
    expect(out.bindings[1]!.keys).toEqual([key(0, 0), key(1, 20)]);
  });

  it('計画に無くなった自動のバインディングは消し、manual・locked のキーがあるものと対象外は残す', () => {
    const m = model([
      binding('staleAuto', 'a', 'EyeOpenL', [key(0, 1), key(1, 0)]),
      binding('userManual', 'a', 'EyeOpenR', [key(0, 0, 'manual'), key(1, 0)]),
      binding('userLocked', 'b', 'EyeBallX', [key(0, 0, 'auto', true)]),
      binding('otherParam', 'b', 'Custom', [key(0, 0)]),
    ]);
    const out = applyMotionPlans(m, [], ids());
    expect(out.bindings.map((b) => b.id)).toEqual(['userManual', 'userLocked', 'otherParam']);
  });

  it('作り直しても同じなら同じ参照', () => {
    const once = applyMotionPlans(model([]), [plan('a', 'MouthOpen', 10)], ids());
    expect(applyMotionPlans(once, [plan('a', 'MouthOpen', 10)], ids())).toBe(once);
  });

  it('再実行で残すのは manual と locked', () => {
    expect(keepOnRerun(key(0, 0, 'manual'))).toBe(true);
    expect(keepOnRerun(key(0, 0, 'combined', true))).toBe(true);
    expect(keepOnRerun(key(0, 0, 'auto'))).toBe(false);
    expect(keepOnRerun(key(0, 0, 'generated'))).toBe(false);
  });
});

describe('方式の選び方', () => {
  const index = (types: Part['standardType'][]) =>
    indexStandardParts(types.map((t, i) => image(`p${i}`, { standardType: t })));

  it('まばたきは上まぶたと白目があればまぶたを動かし、無ければ目全体を縮める', () => {
    expect(blinkMethod(index(['eyeWhiteL', 'upperLidL', 'irisL']), 'L')).toBe('lids');
    expect(blinkMethod(index(['eyeWhiteL', 'irisL']), 'L')).toBe('squash');
    expect(blinkMethod(index(['upperLidL']), 'L')).toBe('squash');
    expect(blinkMethod(index(['eyeWholeL']), 'L')).toBe('squash');
    expect(blinkMethod(index(['eyeWholeL']), 'R')).toBeNull();
  });

  it('口の開閉は口の中と下唇があれば唇を動かし、無ければ口全体を伸ばす', () => {
    expect(mouthMethod(index(['mouthInside', 'lowerLip']))).toBe('lips');
    expect(mouthMethod(index(['upperLip', 'lowerLip']))).toBe('stretch');
    expect(mouthMethod(index(['mouthWhole']))).toBe('stretch');
    expect(mouthMethod(index(['face']))).toBeNull();
  });
});
