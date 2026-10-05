import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Binding, type Project } from '@app/schema';
import { FakeKeyGenerator, type KeyGenerator } from '@app/contracts';
import { createKeyGenerator, createProjectStore } from '@app/core';
import {
  applyGeneration,
  bindingsUsing,
  generateBetween,
  generationOf,
  isDepthParameter,
  isLockedAt,
  lockRange,
  mergeBindings,
  rebuildDepth,
  regenerateKeys,
  setKeysLocked,
  toggleLockAt,
} from './generate';

function binding(id: string, parameterIds: string[]): Binding {
  return {
    id,
    target: { type: 'part', id: `part-${id}` },
    channel: 'transform',
    parameterIds,
    keyValues: parameterIds.map(() => [0]),
    keys: [],
    generation: 'linear',
    divisions: null,
  };
}

function projectWith(bindings: Binding[]): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: { ...p.model, bindings } };
}

const bindings = [
  binding('x', ['FaceAngleX']),
  binding('xy', ['FaceAngleY', 'FaceAngleX']),
  binding('m', ['MouthOpen']),
];

describe('間を生成', () => {
  it('どれかの編集中のパラメータを使うバインディングに linear を掛け、1回の Undo にする', () => {
    const store = createProjectStore(projectWith(bindings));
    const loaded = store.get();
    const linear = vi.fn((b: Binding) => (b.parameterIds.length === 1 ? { ...b, divisions: 3 } : b));
    const generator: KeyGenerator = Object.assign(new FakeKeyGenerator(), { linear, depthParallax: () => [] });
    expect(bindingsUsing(loaded.model, ['FaceAngleX']).map((b) => b.id)).toEqual(['x', 'xy']);

    expect(generateBetween(store, generator, ['FaceAngleX'])).toBe(2);
    expect(linear.mock.calls.map(([b]) => b.id)).toEqual(['x', 'xy']);
    expect(store.get().model.bindings.map((b) => b.divisions)).toEqual([3, null, null]);
    store.undo();
    expect(store.get()).toBe(loaded);
    expect(store.canUndo()).toBe(false);
  });

  it('使うバインディングが無ければ何もしない。仮実装（変えない）なら履歴も増えない', () => {
    const store = createProjectStore(projectWith(bindings));
    expect(generateBetween(store, new FakeKeyGenerator(), ['EyeOpenL'])).toBe(0);
    expect(generateBetween(store, new FakeKeyGenerator(), ['MouthOpen'])).toBe(1);
    expect(store.canUndo()).toBe(false);
  });
});

describe('奥行きで作り直す', () => {
  it('FaceAngleX と FaceAngleY だけが対象', () => {
    expect(['FaceAngleX', 'FaceAngleY', 'FaceAngleZ', 'MouthOpen'].filter(isDepthParameter)).toEqual([
      'FaceAngleX',
      'FaceAngleY',
    ]);
  });

  it('同じ id は置き換え、新しいものは末尾に足す。1回の Undo で戻る', () => {
    const store = createProjectStore(projectWith(bindings));
    const loaded = store.get();
    const rebuilt = { ...bindings[0]!, generation: 'depth' as const };
    const added = binding('new', ['FaceAngleX']);
    const depthParallax = vi.fn(() => [rebuilt, added]);
    rebuildDepth(store, Object.assign(new FakeKeyGenerator(), { depthParallax }), ['FaceAngleX']);
    expect(depthParallax).toHaveBeenCalledWith(loaded.model, 'FaceAngleX');
    expect(store.get().model.bindings.map((b) => [b.id, b.generation])).toEqual([
      ['x', 'depth'],
      ['xy', 'linear'],
      ['m', 'linear'],
      ['new', 'linear'],
    ]);
    store.undo();
    expect(store.get()).toBe(loaded);
  });

  it('変わらなければ同じモデルを返す', () => {
    const model = projectWith(bindings).model;
    expect(mergeBindings(model, [model.bindings[0]!])).toBe(model);
    expect(mergeBindings(model, [])).toBe(model);
  });
});

// ---- カード31 ----

type Key = Binding['keys'][number];

function keyed(id: string, parameterIds: string[], keys: Key[], generation: Binding['generation']): Binding {
  return { ...binding(id, parameterIds), keys, keyValues: parameterIds.map(() => []), generation };
}

const identity = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
const k = (coords: number[], locked = false, source: Key['source'] = 'generated'): Key => ({
  coords,
  delta: identity,
  source,
  locked,
});

describe('間を生成（方式ごと）', () => {
  it('奥行き方式を保持しながら中間キーを生成する。明示的な方式変更だけ linear に変える', () => {
    const b = keyed('d', ['FaceAngleX'], [k([-30], true, 'manual'), k([30], false, 'auto')], 'depth');
    b.keyValues = [[-30, 30]];
    b.divisions = 3;
    const store = createProjectStore(projectWith([b]));
    const original = store.get();
    const generator = createKeyGenerator();
    generateBetween(store, generator, ['FaceAngleX']);
    const next = store.get().model.bindings[0]!;
    expect(next.generation).toBe('depth');
    expect(next.keys.map((key) => key.coords)).toEqual([[-30], [-10], [10], [30]]);
    expect(next.keys[0]).toBe(b.keys[0]);
    store.undo();
    expect(store.get()).toBe(original);
    store.redo();
    const interpolated = store.get();
    generateBetween(store, generator, ['FaceAngleX']);
    expect(store.get()).toBe(interpolated);
    applyGeneration(store, generator, ['FaceAngleX'], 'linear');
    expect(store.get().model.bindings[0]!.generation).toBe('linear');
  });
  it('linear は linear、depth を含むほかの方式は方式を保持する regenerate で作る', () => {
    const store = createProjectStore(
      projectWith([
        keyed('l', ['FaceAngleX'], [], 'linear'),
        keyed('d', ['FaceAngleX'], [], 'depth'),
        keyed('r', ['FaceAngleX'], [], 'rotate'),
        keyed('e', ['FaceAngleX'], [], 'ease'),
      ]),
    );
    const linear = vi.fn((b: Binding) => b);
    const regenerate = vi.fn((b: Binding) => b);
    generateBetween(store, Object.assign(new FakeKeyGenerator(), { linear, regenerate }), ['FaceAngleX']);
    expect(linear.mock.calls.map(([b]) => b.id)).toEqual(['l']);
    expect(regenerate.mock.calls.map(([b]) => b.id)).toEqual(['d', 'r', 'e']);
  });
});

describe('すべて再補間・選択範囲だけ再補間', () => {
  it('パラメータを使う全バインディングに regenerate を掛け、1回の Undo にする。範囲を渡す', () => {
    const store = createProjectStore(projectWith(bindings));
    const loaded = store.get();
    const regenerate = vi.fn((b: Binding, _m: Project['model'], range?: [number, number]) =>
      b.parameterIds.length === 1 ? { ...b, divisions: range ? range[1] : 9 } : b,
    );
    const generator = Object.assign(new FakeKeyGenerator(), { regenerate });

    expect(regenerateKeys(store, generator, ['FaceAngleX'])).toBe(2);
    expect(regenerate.mock.calls.map(([b, m, r]) => [b.id, m.bindings.length, r])).toEqual([
      ['x', 3, undefined],
      ['xy', 3, undefined],
    ]);
    expect(store.get().model.bindings.map((b) => b.divisions)).toEqual([9, null, null]);
    store.undo();
    expect(store.get()).toBe(loaded);

    regenerate.mockClear();
    expect(regenerateKeys(store, generator, ['FaceAngleX'], [5, 20])).toBe(2);
    expect(regenerate.mock.calls.map(([, , r]) => r)).toEqual([
      [5, 20],
      [5, 20],
    ]);
    expect(store.get().model.bindings.map((b) => b.divisions)).toEqual([20, null, null]);
    store.undo();
    expect(store.get()).toBe(loaded);
    expect(store.canUndo()).toBe(false);
    expect(regenerateKeys(store, generator, ['EyeOpenL'])).toBe(0);
  });
});

describe('生成方式', () => {
  it('選んだ方式のメソッドを掛け、1回の Undo にする。変わった数を返す', () => {
    const store = createProjectStore(projectWith(bindings));
    const loaded = store.get();
    const mark = (generation: Binding['generation']) => (b: Binding) =>
      b.parameterIds.length === 1 ? { ...b, generation } : b;
    const generator = Object.assign(new FakeKeyGenerator(), {
      linear: vi.fn(mark('linear')),
      rotate: vi.fn(mark('rotate')),
      surface: vi.fn((b: Binding) => b),
      ease: vi.fn(mark('ease')),
    });
    expect(applyGeneration(store, generator, ['FaceAngleX'], 'rotate')).toBe(1);
    expect(generator.rotate).toHaveBeenCalledTimes(2);
    expect(generationOf(store.get().model, ['FaceAngleX'])).toBe('rotate');
    expect(applyGeneration(store, generator, ['FaceAngleX'], 'ease')).toBe(1);
    expect(generationOf(store.get().model, ['FaceAngleX'])).toBe('ease');
    // 変わらなければ履歴も増えない
    expect(applyGeneration(store, generator, ['FaceAngleX'], 'surface')).toBe(0);
    store.undo();
    expect(generationOf(store.get().model, ['FaceAngleX'])).toBe('rotate');
    store.undo();
    expect(store.get()).toBe(loaded);
    expect(store.canUndo()).toBe(false);
  });

  it('表示する方式。depth は線形、ばらばらなら mixed、1パラメータのバインディングが無ければ null', () => {
    const model = projectWith([
      keyed('a', ['FaceAngleX'], [], 'depth'),
      keyed('b', ['FaceAngleX'], [], 'linear'),
      keyed('c', ['FaceAngleY'], [], 'surface'),
      keyed('two', ['FaceAngleX', 'FaceAngleY'], [], 'ease'),
    ]).model;
    expect(generationOf(model, ['FaceAngleX'])).toBe('linear');
    expect(generationOf(model, ['FaceAngleY'])).toBe('surface');
    expect(generationOf(model, ['FaceAngleX', 'FaceAngleY'])).toBe('mixed');
    expect(generationOf(model, ['MouthOpen'])).toBeNull();
  });
});

describe('キーのロック', () => {
  it('複合キーだけがロックされていても1軸の印はロック扱いにしない', () => {
    const store = createProjectStore(
      projectWith([
        keyed('x', ['FaceAngleX'], [k([10])], 'linear'),
        keyed('xy', ['FaceAngleX', 'FaceAngleY'], [k([10, 30], true)], 'linear'),
      ]),
    );
    expect(isLockedAt(store.get().model, 'FaceAngleX', 10)).toBe(false);
    toggleLockAt(store, 'FaceAngleX', 10);
    expect(store.get().model.bindings.map((b) => b.keys[0]!.locked)).toEqual([true, true]);
    toggleLockAt(store, 'FaceAngleX', 10);
    expect(store.get().model.bindings.map((b) => b.keys[0]!.locked)).toEqual([false, true]);
  });
  const lockModel = () =>
    projectWith([
      keyed('x', ['FaceAngleX'], [k([-30], false, 'manual'), k([10]), k([20], true), k([30])], 'linear'),
      keyed('xy', ['FaceAngleY', 'FaceAngleX'], [k([0, 10]), k([5, 25])], 'linear'),
      keyed('m', ['MouthOpen'], [k([0.5])], 'linear'),
    ]);
  const lockedOf = (p: Project) => p.model.bindings.map((b) => b.keys.map((key) => key.locked));

  it('範囲（両端を含む）の1軸キーだけ locked を変え、複合キーは触らない', () => {
    const model = lockModel().model;
    const locked = setKeysLocked(model, 'FaceAngleX', [25, 10], true);
    expect(locked.bindings.map((b) => b.keys.map((key) => key.locked))).toEqual([
      [false, true, true, false],
      [false, false],
      [false],
    ]);
    // 変わらないバインディング・キーは同じオブジェクト
    expect(locked.bindings[2]).toBe(model.bindings[2]);
    expect(locked.bindings[0]!.keys[2]).toBe(model.bindings[0]!.keys[2]);
    expect(setKeysLocked(model, 'FaceAngleX', [20, 20], true)).toBe(model);
    expect(setKeysLocked(model, 'EyeOpenL', [0, 1], true)).toBe(model);
  });

  it('右クリックの切り替えと範囲のロックは、それぞれ1回の Undo', () => {
    const store = createProjectStore(lockModel());
    const loaded = store.get();
    expect(isLockedAt(loaded.model, 'FaceAngleX', 20)).toBe(true);
    toggleLockAt(store, 'FaceAngleX', 20);
    expect(lockedOf(store.get())[0]).toEqual([false, false, false, false]);
    toggleLockAt(store, 'FaceAngleX', 10);
    // 同じ値を含む xy のキーは変更しない
    expect(lockedOf(store.get()).slice(0, 2)).toEqual([
      [false, true, false, false],
      [false, false],
    ]);
    lockRange(store, 'FaceAngleX', [-30, 30], true);
    expect(lockedOf(store.get()).slice(0, 2)).toEqual([
      [true, true, true, true],
      [false, false],
    ]);
    lockRange(store, 'FaceAngleX', [0, 15], false);
    expect(lockedOf(store.get())[0]).toEqual([true, false, true, true]);
    store.undo();
    store.undo();
    store.undo();
    store.undo();
    expect(store.get()).toBe(loaded);
    expect(store.canUndo()).toBe(false);
  });
});
