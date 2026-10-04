import { describe, expect, it } from 'vitest';
import { createDeformPipeline, createProjectStore } from '@app/core';
import { loadProjectJson, type Project } from '@app/schema';
import { maskSourceState, setMaskInverted, setMaskSource, setMaskSources } from './maskCommands';
import { makeAsset, makeMesh, makePart, makeProject } from './testing';

// g ─┬ a ── a2（画像の子）
//    └ b
// c
function project() {
  return makeProject({
    assets: [makeAsset('A'), makeAsset('B'), makeAsset('C'), makeAsset('D')],
    parts: [
      makePart('g', { kind: 'group' }),
      makePart('a', { parentId: 'g', assetId: 'A', meshId: 'm1' }),
      makePart('a2', { parentId: 'a', assetId: 'D', meshId: 'm4' }),
      makePart('b', { parentId: 'g', assetId: 'B', meshId: 'm2' }),
      makePart('c', { assetId: 'C', meshId: 'm3' }),
    ],
    drawOrder: ['c', 'a', 'a2', 'b'],
    meshes: [makeMesh('m1'), makeMesh('m2'), makeMesh('m3'), makeMesh('m4')],
  });
}

const maskOf = (p: Project, id: string) => p.model.parts.find((x) => x.id === id)!.mask;

describe('複数のマスク元', () => {
  it('マスク元を足していくと和になり、最後の1つを外すと「なし」に戻る', () => {
    let p = project();
    p = setMaskSource('c', 'a', true).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['a'], inverted: false });
    p = setMaskSource('c', 'b', true).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['a', 'b'], inverted: false });
    p = setMaskSource('c', 'a', false).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['b'], inverted: false });
    p = setMaskSource('c', 'b', false).apply(p);
    expect(maskOf(p, 'c')).toBeNull();
  });

  it('選べないもの（自身・子孫・グループ・無いパーツ）は足せない。変わらなければ同じプロジェクトを返す', () => {
    const p = project();
    expect(setMaskSource('a', 'a', true).apply(p)).toBe(p);
    expect(setMaskSource('a', 'a2', true).apply(p)).toBe(p);
    expect(setMaskSource('a', 'g', true).apply(p)).toBe(p);
    expect(setMaskSource('a', 'zzz', true).apply(p)).toBe(p);
    expect(setMaskSource('zzz', 'a', true).apply(p)).toBe(p);
    // 入っているものを足す・入っていないものを外すのは何もしない
    const one = setMaskSource('c', 'a', true).apply(p);
    expect(setMaskSource('c', 'a', true).apply(one)).toBe(one);
    expect(setMaskSource('c', 'b', false).apply(one)).toBe(one);
  });

  it('まとめて決めるときは、選べないものと重なりを除く。空なら「なし」', () => {
    const p = project();
    const set = setMaskSources('a', ['b', 'a', 'a2', 'g', 'c', 'b', 'zzz']).apply(p);
    expect(maskOf(set, 'a')).toEqual({ sourcePartIds: ['b', 'c'], inverted: false });
    expect(setMaskSources('a', ['b', 'c']).apply(set)).toBe(set);
    expect(maskOf(setMaskSources('a', ['a', 'g']).apply(set), 'a')).toBeNull();
    expect(setMaskSources('a', []).apply(p)).toBe(p);
  });

  it('候補に無くなったマスク元（読み込んだファイルの古い参照など）は、次に変えたときに除く', () => {
    const p = project();
    const stale = {
      ...p,
      model: {
        ...p.model,
        parts: p.model.parts.map((x) =>
          x.id === 'c' ? { ...x, mask: { sourcePartIds: ['gone', 'a'], inverted: true } } : x,
        ),
      },
    };
    expect(maskOf(setMaskSource('c', 'b', true).apply(stale), 'c')).toEqual({
      sourcePartIds: ['a', 'b'],
      inverted: true,
    });
    expect(maskOf(setMaskSource('c', 'a', false).apply(stale), 'c')).toBeNull();
  });
});

describe('反転', () => {
  it('反転を切り替えても、マスク元を足し引きしても反転の設定は保つ', () => {
    let p = setMaskSource('c', 'a', true).apply(project());
    p = setMaskInverted('c', true).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['a'], inverted: true });
    p = setMaskSource('c', 'b', true).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['a', 'b'], inverted: true });
    p = setMaskSources('c', ['b']).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['b'], inverted: true });
    p = setMaskInverted('c', false).apply(p);
    expect(maskOf(p, 'c')).toEqual({ sourcePartIds: ['b'], inverted: false });
    expect(setMaskInverted('c', false).apply(p)).toBe(p);
  });

  it('マスクが無いときは反転できない', () => {
    const p = project();
    expect(setMaskInverted('c', true).apply(p)).toBe(p);
  });
});

describe('一覧の状態', () => {
  it('候補は画像パーツだけで自身と子孫を除き（前面から順）、選んでいるものは候補の順', () => {
    const p = setMaskSources('a', ['c', 'b']).apply(project());
    const a = p.model.parts.find((x) => x.id === 'a')!;
    const { options, selected } = maskSourceState(p.model, a);
    expect(options.map((x) => x.id)).toEqual(['b', 'c']);
    expect(selected.map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('保存・描画・Undo', () => {
  it('複数・反転の設定はプロジェクトの JSON に入り、読み直しても同じ', () => {
    let p = setMaskSources('c', ['a', 'b']).apply(project());
    p = setMaskInverted('c', true).apply(p);
    const loaded = loadProjectJson(JSON.stringify(p));
    expect(maskOf(loaded, 'c')).toEqual({ sourcePartIds: ['a', 'b'], inverted: true });
  });

  it('変形パイプラインの DrawItem.mask（レンダラーに渡すもの）に入る', () => {
    let p = setMaskSources('c', ['a', 'b']).apply(project());
    p = setMaskInverted('c', true).apply(p);
    const out = createDeformPipeline().deform(p.model, { transforms: {}, vertices: {}, warpPoints: {} });
    expect(out.byPartId.c!.mask).toEqual({ sourcePartIds: ['a', 'b'], inverted: true });
    expect(out.byPartId.a!.mask).toBeNull();
  });

  it('1回の操作ごとに Undo で戻る', () => {
    const p = project();
    const store = createProjectStore(p);
    store.dispatch(setMaskSource('c', 'a', true));
    const one = store.get();
    store.dispatch(setMaskSource('c', 'b', true));
    store.dispatch(setMaskInverted('c', true));
    store.dispatch(setMaskSources('c', ['b']));
    // 何も変えない操作は履歴に入れない
    store.dispatch(setMaskInverted('c', true));
    store.undo();
    expect(maskOf(store.get(), 'c')).toEqual({ sourcePartIds: ['a', 'b'], inverted: true });
    store.undo();
    store.undo();
    expect(store.get()).toBe(one);
    store.undo();
    expect(store.get()).toBe(p);
    expect(store.canUndo()).toBe(false);
  });
});
