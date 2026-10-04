import { describe, expect, it } from 'vitest';
import { createProjectStore } from '@app/core';
import { makePart, makeProject } from '../structure/testing';
import { BLEND_MODE_OPTIONS, blendTargets, currentBlendMode, isBlendMode, setBlendMode } from './commands';

function project() {
  return makeProject({
    parts: [
      makePart('a'),
      makePart('b', { blendMode: 'multiply' }),
      makePart('g', { kind: 'group' }),
      makePart('c', { blendMode: 'screen' }),
    ],
  });
}

describe('合成モードの選択肢', () => {
  it('通常・乗算・スクリーン・加算の4つ', () => {
    expect(BLEND_MODE_OPTIONS.map((o) => [o.mode, o.label])).toEqual([
      ['normal', '通常'],
      ['multiply', '乗算'],
      ['screen', 'スクリーン'],
      ['add', '加算'],
    ]);
    expect(isBlendMode('add')).toBe(true);
    expect(isBlendMode('overlay')).toBe(false);
    expect(isBlendMode('mixed')).toBe(false);
  });
});

describe('blendTargets と currentBlendMode', () => {
  it('対象は選んだ画像パーツだけ（グループと無い id は除く）', () => {
    const { model } = project();
    expect(blendTargets(model, ['g', 'b', 'nope', 'a']).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('そろっていればその値、ばらばらなら mixed、対象が無ければ null', () => {
    const { model } = project();
    expect(currentBlendMode(blendTargets(model, ['b']))).toBe('multiply');
    expect(currentBlendMode(blendTargets(model, ['a', 'b']))).toBe('mixed');
    expect(currentBlendMode(blendTargets(model, ['g']))).toBeNull();
  });
});

describe('setBlendMode', () => {
  it('選んだ画像パーツすべてを変え、グループは変えない', () => {
    const p = project();
    const next = setBlendMode(p.model, ['a', 'b', 'g'], 'add')!.apply(p);
    expect(next.model.parts.map((x) => [x.id, x.blendMode])).toEqual([
      ['a', 'add'],
      ['b', 'add'],
      ['g', 'normal'],
      ['c', 'screen'],
    ]);
    // 変わらないパーツは同じオブジェクトのまま
    expect(next.model.parts[3]).toBe(p.model.parts[3]);
  });

  it('変わるものが無ければ null', () => {
    const p = project();
    expect(setBlendMode(p.model, ['b'], 'multiply')).toBeNull();
    expect(setBlendMode(p.model, ['g'], 'add')).toBeNull();
    expect(setBlendMode(p.model, [], 'add')).toBeNull();
  });

  it('1回の Undo で全部戻る', () => {
    const p = project();
    const store = createProjectStore(p);
    store.dispatch(setBlendMode(p.model, ['a', 'b', 'c'], 'screen')!);
    expect(
      store
        .get()
        .model.parts.filter((x) => x.kind === 'image')
        .every((x) => x.blendMode === 'screen'),
    ).toBe(true);
    store.undo();
    expect(store.get()).toBe(p);
  });
});
