import { describe, expect, it } from 'vitest';
import {
  assetsCenter,
  childrenOf,
  descendantIds,
  drawOrderBlock,
  idSequence,
  isInside,
  partsCenter,
  removeParts,
  subtreeIds,
  topMost,
} from './modelOps';
import { counterIds, makeAsset, makeBinding, makeMesh, makePart, makeProject } from './testing';

// g ─┬ a
//    └ h ─ b
// c
function tree() {
  return makeProject({
    assets: [
      makeAsset('A', { offset: { x: 0, y: 0 }, width: 10, height: 10 }),
      makeAsset('B', { offset: { x: 30, y: 20 }, width: 10, height: 20 }),
    ],
    parts: [
      makePart('g', { kind: 'group' }),
      makePart('a', { parentId: 'g', assetId: 'A', meshId: 'm-a' }),
      makePart('h', { kind: 'group', parentId: 'g' }),
      makePart('b', { parentId: 'h', assetId: 'B' }),
      makePart('c', { mask: { sourcePartIds: ['a', 'b'], inverted: false } }),
    ],
    drawOrder: ['b', 'c', 'a'],
    meshes: [makeMesh('m-a'), makeMesh('m-c')],
    warps: [{ id: 'w-h', partId: 'h', columns: 1, rows: 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, points: [] }],
    bindings: [
      makeBinding('bd-a', { target: { type: 'part', id: 'a' } }),
      makeBinding('bd-ma', { target: { type: 'mesh', id: 'm-a' }, channel: 'vertices' }),
      makeBinding('bd-w', { target: { type: 'warp', id: 'w-h' }, channel: 'warpPoints' }),
      makeBinding('bd-c', { target: { type: 'part', id: 'c' } }),
    ],
  });
}

describe('木のたどり方', () => {
  it('子は parts の順、根には親が見つからないものも入る', () => {
    const p = tree();
    expect(childrenOf(p.model, 'g').map((x) => x.id)).toEqual(['a', 'h']);
    const orphan = { ...p.model, parts: [...p.model.parts, makePart('o', { parentId: 'missing' })] };
    expect(childrenOf(orphan, null).map((x) => x.id)).toEqual(['g', 'c', 'o']);
  });

  it('子孫・部分木・内側の判定', () => {
    const { model } = tree();
    expect(descendantIds(model, 'g').sort()).toEqual(['a', 'b', 'h']);
    expect([...subtreeIds(model, ['h', 'c', 'nope'])].sort()).toEqual(['b', 'c', 'h']);
    expect(isInside(model, 'b', 'g')).toBe(true);
    expect(isInside(model, 'g', 'g')).toBe(true);
    expect(isInside(model, 'c', 'g')).toBe(false);
  });

  it('親子が輪になっていても止まる', () => {
    const model = makeProject({
      parts: [makePart('x', { kind: 'group', parentId: 'y' }), makePart('y', { kind: 'group', parentId: 'x' })],
    }).model;
    expect(descendantIds(model, 'x')).toEqual(['y']);
    expect(topMost(model, ['x', 'y'])).toEqual([]);
  });

  it('topMost は祖先も選ばれているものを除く', () => {
    const { model } = tree();
    expect(topMost(model, ['b', 'g', 'c'])).toEqual(['g', 'c']);
  });

  it('drawOrderBlock はグループの子孫の画像パーツを描画順で返す', () => {
    const { model } = tree();
    expect(drawOrderBlock(model, ['g'])).toEqual(['b', 'a']);
    expect(drawOrderBlock(model, ['c', 'a'])).toEqual(['c', 'a']);
  });

  it('素材の外接矩形の中心', () => {
    const p = tree();
    expect(assetsCenter(p.assets)).toEqual({ x: 20, y: 20 });
    expect(assetsCenter([])).toBeNull();
    expect(partsCenter(p, ['h'])).toEqual({ x: 35, y: 30 });
  });
});

describe('removeParts', () => {
  it('子孫ごと消し、メッシュ・ワープ・バインディング・drawOrder・マスクの参照も消す', () => {
    const next = removeParts(tree(), ['g']);
    expect(next.model.parts.map((p) => p.id)).toEqual(['c']);
    expect(next.model.parts[0]!.mask).toBeNull();
    expect(next.model.meshes.map((m) => m.id)).toEqual(['m-c']);
    expect(next.model.warps).toEqual([]);
    expect(next.model.bindings.map((b) => b.id)).toEqual(['bd-c']);
    expect(next.model.drawOrder).toEqual(['c']);
  });

  it('マスク元が一部だけ消えたら残りを保つ', () => {
    const next = removeParts(tree(), ['b']);
    expect(next.model.parts.find((p) => p.id === 'c')!.mask).toEqual({ sourcePartIds: ['a'], inverted: false });
    expect(next.model.warps).toHaveLength(1);
  });

  it('パーツの物理も消す', () => {
    const p = tree();
    const physics = {
      id: 'ph',
      partId: 'a',
      preset: 'hair' as const,
      strength: 0.5,
      direction: 'horizontal' as const,
      length: 10,
      spring: 1,
      damping: 1,
      gravity: 1,
      inertia: 1,
      range: 1,
      inputs: [],
      outputParameterId: 'HairFront',
    };
    const next = removeParts({ ...p, physics: [physics] }, ['a']);
    expect(next.physics).toEqual([]);
  });

  it('無いパーツなら同じ参照を返す', () => {
    const p = tree();
    expect(removeParts(p, ['nope'])).toBe(p);
  });
});

describe('idSequence', () => {
  it('同じ順に呼ぶと同じ id を返す', () => {
    const seq = idSequence(counterIds('x'));
    const first = seq();
    expect([first(), first()]).toEqual(['x1', 'x2']);
    const second = seq();
    expect([second(), second(), second()]).toEqual(['x1', 'x2', 'x3']);
  });
});
