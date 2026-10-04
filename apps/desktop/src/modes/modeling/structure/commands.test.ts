import { describe, expect, it } from 'vitest';
import { createProjectStore } from '@app/core';
import { validateProject } from '@app/schema';
import {
  addedRootIds,
  canMoveTo,
  copyParts,
  deleteParts,
  groupParts,
  maskSourceOptions,
  moveInDrawOrder,
  moveParts,
  renamePart,
  reorderDrawOrder,
  setMask,
  setPartLocked,
  setPartVisible,
  treeTargetFor,
} from './commands';
import { childrenOf } from './modelOps';
import { counterIds, makeAsset, makeBinding, makeMesh, makePart, makeProject } from './testing';

// g ─┬ a
//    └ b
// h（グループ・空）
// c
function project() {
  return makeProject({
    assets: [
      makeAsset('A', { offset: { x: 0, y: 0 }, width: 10, height: 10 }),
      makeAsset('B', { offset: { x: 20, y: 0 }, width: 10, height: 10 }),
      makeAsset('C', { offset: { x: 0, y: 40 }, width: 10, height: 20 }),
    ],
    parts: [
      makePart('g', { kind: 'group', standardType: 'faceGroup' }),
      makePart('a', { parentId: 'g', assetId: 'A', meshId: 'ma', standardType: 'face' }),
      makePart('b', { parentId: 'g', assetId: 'B', mask: { sourcePartIds: ['a'], inverted: true } }),
      makePart('h', { kind: 'group' }),
      makePart('c', { assetId: 'C' }),
    ],
    drawOrder: ['c', 'a', 'b'],
    meshes: [makeMesh('ma')],
    bindings: [
      makeBinding('bg', { target: { type: 'part', id: 'g' } }),
      makeBinding('bma', { target: { type: 'mesh', id: 'ma' }, channel: 'vertices' }),
    ],
  });
}

const ids = (parts: { id: string }[]) => parts.map((p) => p.id);

describe('親子と兄弟の順', () => {
  it('親を変えても描画順は変わらない', () => {
    const p = project();
    const next = moveParts(['c'], { parentId: 'g', beforeId: 'a' }).apply(p);
    expect(ids(childrenOf(next.model, 'g'))).toEqual(['c', 'a', 'b']);
    expect(next.model.parts.find((x) => x.id === 'c')!.parentId).toBe('g');
    expect(next.model.drawOrder).toBe(p.model.drawOrder);
  });

  it('兄弟の並び替えと、グループの中の末尾への移動', () => {
    const p = project();
    const swapped = moveParts(['b'], { parentId: 'g', beforeId: 'a' }).apply(p);
    expect(ids(childrenOf(swapped.model, 'g'))).toEqual(['b', 'a']);
    const into = moveParts(['a', 'b'], { parentId: 'h', beforeId: null }).apply(p);
    expect(ids(childrenOf(into.model, 'h'))).toEqual(['a', 'b']);
    expect(childrenOf(into.model, 'g')).toEqual([]);
    expect(into.model.drawOrder).toEqual(['c', 'a', 'b']);
  });

  it('自身や子孫の下、画像パーツの下には動かせない', () => {
    const p = project();
    expect(canMoveTo(p.model, ['g'], 'g')).toBe(false);
    expect(canMoveTo(p.model, ['g'], 'h')).toBe(true);
    expect(canMoveTo(p.model, ['c'], 'a')).toBe(false);
    expect(moveParts(['g'], { parentId: 'g', beforeId: null }).apply(p)).toBe(p);
    expect(moveParts(['c'], { parentId: 'a', beforeId: null }).apply(p)).toBe(p);
    // 同じ場所なら何もしない
    expect(moveParts(['a'], { parentId: 'g', beforeId: 'b' }).apply(p)).toBe(p);
  });

  it('行に落とした場所から置き場所を決める', () => {
    const { model } = project();
    expect(treeTargetFor(model, ['c'], 'h', 'into')).toEqual({ parentId: 'h', beforeId: null });
    expect(treeTargetFor(model, ['c'], 'a', 'before')).toEqual({ parentId: 'g', beforeId: 'a' });
    expect(treeTargetFor(model, ['c'], 'a', 'after')).toEqual({ parentId: 'g', beforeId: 'b' });
    expect(treeTargetFor(model, ['c'], 'b', 'after')).toEqual({ parentId: 'g', beforeId: null });
    expect(treeTargetFor(model, ['a'], 'g', 'after')).toEqual({ parentId: null, beforeId: 'h' });
    // 自身・子孫には落とせない
    expect(treeTargetFor(model, ['g'], 'a', 'before')).toBeNull();
    expect(treeTargetFor(model, ['g'], 'g', 'into')).toBeNull();
  });

  it('グループ化は親が同じならその下に作り、drawOrder を変えない', () => {
    const p = project();
    const next = groupParts(['b', 'a'], { newId: counterIds('grp') }).apply(p);
    const group = next.model.parts.find((x) => x.id === 'grp1')!;
    expect(group).toMatchObject({ kind: 'group', name: 'グループ', parentId: 'g', pivot: { x: 15, y: 5 } });
    expect(ids(childrenOf(next.model, 'g'))).toEqual(['grp1']);
    expect(ids(childrenOf(next.model, 'grp1'))).toEqual(['a', 'b']);
    expect(next.model.drawOrder).toBe(p.model.drawOrder);
    // 親が違えば根に作る
    const mixed = groupParts(['a', 'c'], { newId: counterIds('grp') }).apply(p);
    expect(mixed.model.parts.find((x) => x.id === 'grp1')!.parentId).toBeNull();
  });
});

describe('描画順', () => {
  it('ブロックを相対順のまま、目標の前面・背面へ動かす', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(moveInDrawOrder(order, ['d', 'b'], 'a', 'back')).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(moveInDrawOrder(order, ['a', 'c'], 'e', 'front')).toEqual(['b', 'd', 'e', 'a', 'c']);
    expect(moveInDrawOrder(order, ['b'], 'b', 'front')).toBe(order);
    expect(moveInDrawOrder(order, ['b'], 'a', 'front')).toBe(order);
  });

  it('コマンドは描画順だけを変え、親子は変えない', () => {
    const p = project();
    const next = reorderDrawOrder(['a', 'b'], 'c', 'back').apply(p);
    expect(next.model.drawOrder).toEqual(['a', 'b', 'c']);
    expect(next.model.parts).toBe(p.model.parts);
    expect(reorderDrawOrder(['a'], 'c', 'front').apply(p)).toBe(p);
  });
});

describe('表示・ロック・名前・削除', () => {
  it('patchPart で切り替える', () => {
    const p = project();
    const hidden = setPartVisible('a', false).apply(p);
    expect(hidden.model.parts.find((x) => x.id === 'a')!.visible).toBe(false);
    expect(
      setPartLocked('a', true)
        .apply(p)
        .model.parts.find((x) => x.id === 'a')!.locked,
    ).toBe(true);
    expect(
      renamePart('a', '顔')
        .apply(p)
        .model.parts.find((x) => x.id === 'a')!.name,
    ).toBe('顔');
  });

  it('削除は子孫ごと消し、バインディング・drawOrder・マスクの参照も消す', () => {
    const next = deleteParts(['g']).apply(project());
    expect(ids(next.model.parts)).toEqual(['h', 'c']);
    expect(next.model.bindings).toEqual([]);
    expect(next.model.meshes).toEqual([]);
    expect(next.model.drawOrder).toEqual(['c']);
    const onlyA = deleteParts(['a']).apply(project());
    expect(onlyA.model.parts.find((x) => x.id === 'b')!.mask).toBeNull();
  });
});

describe('マスク', () => {
  it('マスク元の候補は画像パーツだけで、自身と子孫を除く（前面から順）', () => {
    const { model } = project();
    expect(ids(maskSourceOptions(model, 'a'))).toEqual(['b', 'c']);
    expect(ids(maskSourceOptions(model, 'g'))).toEqual(['c']);
  });

  it('マスク元を1つ選ぶ・「なし」にする。反転の設定は保つ', () => {
    const p = project();
    const set = setMask('c', 'a').apply(p);
    expect(set.model.parts.find((x) => x.id === 'c')!.mask).toEqual({ sourcePartIds: ['a'], inverted: false });
    const changed = setMask('b', 'c').apply(p);
    expect(changed.model.parts.find((x) => x.id === 'b')!.mask).toEqual({ sourcePartIds: ['c'], inverted: true });
    const none = setMask('b', null).apply(p);
    expect(none.model.parts.find((x) => x.id === 'b')!.mask).toBeNull();
    // 同じなら何もしない。自身はマスク元にできない
    expect(setMask('b', 'a').apply(p)).toBe(p);
    expect(setMask('c', null).apply(p)).toBe(p);
    expect(setMask('c', 'c').apply(p)).toBe(p);
  });
});

describe('コピー', () => {
  it('グループは子孫ごと複製し、バインディング・メッシュも複製する', () => {
    const p = project();
    const next = copyParts(['g'], { newId: counterIds('cp') }).apply(p);
    // g の直後に g のコピー、その子は a・b の順
    expect(ids(childrenOf(next.model, null))).toEqual(['g', 'cp1', 'h', 'c']);
    const copyGroup = next.model.parts.find((x) => x.id === 'cp1')!;
    expect(copyGroup).toMatchObject({ name: 'gのコピー', standardType: null });
    expect(ids(childrenOf(next.model, 'cp1'))).toEqual(['cp2', 'cp3']);
    const copyA = next.model.parts.find((x) => x.id === 'cp2')!;
    expect(copyA).toMatchObject({ assetId: 'A', meshId: 'cp4', standardType: null, name: 'a' });
    // マスクは複製の中を指すように付け替える
    expect(next.model.parts.find((x) => x.id === 'cp3')!.mask).toEqual({ sourcePartIds: ['cp2'], inverted: true });
    expect(next.model.meshes.map((m) => m.id)).toEqual(['ma', 'cp4']);
    expect(next.model.bindings.map((b) => [b.id, b.target.id])).toEqual([
      ['bg', 'g'],
      ['bma', 'ma'],
      ['cp5', 'cp1'],
      ['cp6', 'cp4'],
    ]);
    // 描画順は元のいちばん前面のすぐ前に、相対順のまま
    expect(next.model.drawOrder).toEqual(['c', 'a', 'b', 'cp2', 'cp3']);
    expect(addedRootIds(p.model, next.model)).toEqual(['cp1']);
    expect(() => validateProject(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it('Undo で戻る', () => {
    const p = project();
    const store = createProjectStore(p);
    store.dispatch(copyParts(['c']));
    store.dispatch(moveParts(['c'], { parentId: 'h', beforeId: null }));
    store.dispatch(reorderDrawOrder(['c'], 'b', 'front'));
    store.dispatch(setMask('c', 'a'));
    store.dispatch(groupParts(['a']));
    store.dispatch(deleteParts(['g']));
    for (let i = 0; i < 6; i++) store.undo();
    expect(store.get()).toBe(p);
  });
});
