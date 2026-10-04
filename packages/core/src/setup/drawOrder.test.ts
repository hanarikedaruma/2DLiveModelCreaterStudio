import { createEmptyProject, type Model, type Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { computeDrawOrder, withDrawOrder } from './drawOrder';
import { newGroupPart } from './hierarchy';

function image(id: string, patch: Partial<Part> = {}): Part {
  return { ...newGroupPart(id, 'bodyRoot'), kind: 'image', standardType: null, name: id, ...patch };
}
const group = (id: string, type: Part['standardType'], parentId: string | null = null): Part => ({
  ...newGroupPart(id, 'bodyRoot'),
  standardType: type,
  parentId,
});

function model(parts: Part[], drawOrder: string[]): Model {
  return { ...createEmptyProject('t').model, parts, drawOrder };
}

const standard = () => [
  group('head', 'headRoot'),
  group('faceG', 'faceGroup', 'head'),
  image('front', { standardType: 'frontHair', parentId: 'head' }),
  image('back', { standardType: 'backHair', parentId: 'head' }),
  image('face', { standardType: 'face', parentId: 'faceG' }),
  image('brow', { standardType: 'browL', parentId: 'faceG' }),
  image('side', { standardType: 'sideHairL', parentId: 'head' }),
];

describe('computeDrawOrder', () => {
  it('標準の画像パーツは STANDARD_DRAW_ORDER の順（グループは入れない）', () => {
    expect(computeDrawOrder(model(standard(), ['front', 'face', 'back', 'brow', 'side']))).toEqual([
      'back',
      'face',
      'brow',
      'side',
      'front',
    ]);
  });

  it('標準外の画像パーツは親の直前（手前）に入れ、同じ親の中では前の順を保つ', () => {
    const parts = [
      ...standard(),
      image('ribbon', { parentId: 'head' }),
      image('hat', { parentId: 'head' }),
      image('mole', { parentId: 'faceG' }),
      image('clip', { parentId: 'front' }),
    ];
    const out = computeDrawOrder(model(parts, ['hat', 'clip', 'front', 'ribbon', 'face', 'mole', 'back', 'brow']));
    // headRoot の部分木で最も手前は前髪（clip はその手前）。顔のグループで最も手前は眉
    expect(out).toEqual(['back', 'face', 'brow', 'mole', 'side', 'front', 'clip', 'hat', 'ribbon']);
  });

  it('親の部分木に画像が無ければ、さらに上の親の直前に入れる', () => {
    const parts = [...standard(), group('folder', null, 'head'), image('charm', { parentId: 'folder' })];
    expect(computeDrawOrder(model(parts, []))).toEqual(['back', 'face', 'brow', 'side', 'front', 'charm']);
  });

  it('withDrawOrder は並びが同じなら同じ参照', () => {
    const m = model(standard(), ['back', 'face', 'brow', 'side', 'front']);
    expect(withDrawOrder(m)).toBe(m);
    expect(withDrawOrder({ ...m, drawOrder: ['front'] }).drawOrder).toEqual(m.drawOrder);
  });
});
