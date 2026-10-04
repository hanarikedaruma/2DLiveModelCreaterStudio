import type { Binding, ParameterKey } from '@app/schema';
import { describe, expect, it } from 'vitest';
import {
  findTransformBindingIndex,
  lerpDelta,
  rebuildTransformBinding,
  roundCoord,
  sortedUnique,
  transformDelta,
} from './keys';

function key(coord: number, x: number, source: ParameterKey['source'] = 'auto', locked = false): ParameterKey {
  return { coords: [coord], delta: transformDelta({ x }), source, locked };
}

function binding(keys: ParameterKey[], patch: Partial<Binding> = {}): Binding {
  return {
    id: 'b1',
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds: ['P'],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
    ...patch,
  };
}

describe('差分の補助', () => {
  it('transformDelta は指定の無い成分を変化なしにし、-0 を 0 にする', () => {
    expect(transformDelta()).toEqual({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 });
    expect(Object.is(transformDelta({ y: -0 }).position.y, 0)).toBe(true);
    expect(transformDelta({ x: 2, scaleY: 0.5 })).toEqual({
      position: { x: 2, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 0.5 },
      opacity: 1,
    });
  });

  it('lerpDelta は成分ごとに線形補間する', () => {
    const a = transformDelta({ x: 0, rotation: 0, scaleX: 1, opacity: 1 });
    const b = transformDelta({ x: 10, rotation: 20, scaleX: 0.5, opacity: 0 });
    expect(lerpDelta(a, b, 0.25)).toEqual({
      position: { x: 2.5, y: 0 },
      rotation: 5,
      scale: { x: 0.875, y: 1 },
      opacity: 0.75,
    });
    expect(
      lerpDelta(
        [
          { x: 0, y: 0 },
          { x: 4, y: 8 },
        ],
        [
          { x: 2, y: 2 },
          { x: 0, y: 0 },
        ],
        0.5,
      ),
    ).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 4 },
    ]);
  });

  it('lerpDelta は形が合わなければ null', () => {
    expect(lerpDelta([{ x: 0, y: 0 }], [], 0.5)).toBeNull();
    expect(lerpDelta([{ x: 0, y: 0 }], transformDelta(), 0.5)).toBeNull();
  });

  it('roundCoord は計算の端数を落とす', () => {
    expect(roundCoord(0.1 + 0.2)).toBe(0.3);
    expect(roundCoord(-30 + 60 * (1 / 6))).toBe(-20);
    expect(Object.is(roundCoord(-0), 0)).toBe(true);
  });

  it('sortedUnique は昇順にして重なりを除く', () => {
    expect(sortedUnique([1, -1, 0, 1, 0.5])).toEqual([-1, 0, 0.5, 1]);
  });
});

describe('findTransformBindingIndex', () => {
  it('パーツと1パラメータが合う transform バインディングを探す', () => {
    const list = [
      binding([], { id: 'two', parameterIds: ['P', 'Q'], keyValues: [[], []] }),
      binding([], { id: 'other', target: { type: 'part', id: 'p2' } }),
      binding([], { id: 'hit' }),
    ];
    expect(findTransformBindingIndex(list, 'p1', 'P')).toBe(2);
    expect(findTransformBindingIndex(list, 'p1', 'Q')).toBe(-1);
  });
});

describe('rebuildTransformBinding', () => {
  const specs = [
    { coord: -1, delta: transformDelta({ x: -5 }) },
    { coord: 0, delta: transformDelta() },
    { coord: 1, delta: transformDelta({ x: 5 }) },
  ];

  it('無ければ新しく作る（source auto・未ロック・keyValues 昇順）', () => {
    const b = rebuildTransformBinding({
      existing: undefined,
      partId: 'p1',
      parameterId: 'P',
      keys: specs,
      keep: () => false,
      generation: 'depth',
      newId: () => 'new',
    });
    expect(b).toEqual({
      id: 'new',
      target: { type: 'part', id: 'p1' },
      channel: 'transform',
      parameterIds: ['P'],
      keyValues: [[-1, 0, 1]],
      keys: [key(-1, -5), key(0, 0), key(1, 5)],
      generation: 'depth',
      divisions: null,
    });
  });

  it('残すキーはそのままで、同じ位置にはキーを作らない。ほかの既存のキーは消える', () => {
    const existing = binding([key(-1, -1), key(0.5, 3, 'generated'), key(1, 99, 'manual')], { divisions: 4 });
    const b = rebuildTransformBinding({
      existing,
      partId: 'p1',
      parameterId: 'P',
      keys: specs,
      keep: (k) => k.source === 'manual',
      generation: 'linear',
      newId: () => 'never',
    });
    expect(b.id).toBe('b1');
    expect(b.divisions).toBe(4);
    expect(b.keys).toEqual([key(-1, -5), key(0, 0), key(1, 99, 'manual')]);
    expect(b.keyValues).toEqual([[-1, 0, 1]]);
  });

  it('作り直しても同じ内容なら既存をそのまま返す', () => {
    const existing = binding([key(-1, -5), key(0, 0), key(1, 5)]);
    const b = rebuildTransformBinding({
      existing,
      partId: 'p1',
      parameterId: 'P',
      keys: specs,
      keep: () => false,
      generation: 'linear',
      newId: () => 'never',
    });
    expect(b).toBe(existing);
  });
});
