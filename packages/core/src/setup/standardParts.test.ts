import { STANDARD_DRAW_ORDER, STANDARD_PART_TYPES, type Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import {
  GROUP_TYPES,
  TREE_PARENT,
  groupChain,
  groupTypeOf,
  imageTypeOf,
  indexStandardParts,
  isGroupType,
} from './standardParts';

function part(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}

describe('標準パーツの表', () => {
  it('変形グループは9種類で、画像パーツの種類は STANDARD_DRAW_ORDER と同じ', () => {
    expect(GROUP_TYPES).toHaveLength(9);
    const images = STANDARD_PART_TYPES.filter((t) => !isGroupType(t));
    expect([...images].sort()).toEqual([...STANDARD_DRAW_ORDER].sort());
  });

  it('木の親', () => {
    expect(groupChain('irisL')).toEqual(['eyeGroupL', 'faceGroup', 'headRoot', 'neckRoot', 'bodyRoot']);
    expect(groupChain('armR')).toEqual(['armRootR', 'bodyRoot']);
    expect(groupChain('frontHair')).toEqual(['headRoot', 'neckRoot', 'bodyRoot']);
    expect(groupChain('bodyRoot')).toEqual([]);
    expect(TREE_PARENT.lowerLip).toBe('mouthGroup');
    expect(TREE_PARENT.cheek).toBe('faceGroup');
    expect(TREE_PARENT.earL).toBe('headRoot');
    // bodyRoot 以外のすべての種類に親がある
    for (const t of STANDARD_PART_TYPES) if (t !== 'bodyRoot') expect(TREE_PARENT[t], t).toBeDefined();
  });

  it('画像パーツとグループの種類は kind と合うものだけ', () => {
    expect(imageTypeOf(part('a', { standardType: 'face' }))).toBe('face');
    expect(imageTypeOf(part('a', { standardType: 'headRoot' }))).toBeNull();
    expect(imageTypeOf(part('a', { kind: 'group', standardType: 'face' }))).toBeNull();
    expect(groupTypeOf(part('a', { kind: 'group', standardType: 'headRoot' }))).toBe('headRoot');
    expect(groupTypeOf(part('a', { standardType: 'headRoot' }))).toBeNull();
    expect(imageTypeOf(part('a'))).toBeNull();
  });

  it('indexStandardParts は種類ごとにまとめる（グループは最初の1つ）', () => {
    const index = indexStandardParts([
      part('h1', { standardType: 'frontHair' }),
      part('g1', { kind: 'group', standardType: 'headRoot' }),
      part('h2', { standardType: 'frontHair' }),
      part('g2', { kind: 'group', standardType: 'headRoot' }),
    ]);
    expect(index.images('frontHair').map((p) => p.id)).toEqual(['h1', 'h2']);
    expect(index.first('frontHair')?.id).toBe('h1');
    expect(index.group('headRoot')?.id).toBe('g1');
    expect(index.has('face')).toBe(false);
    expect(index.images('face')).toEqual([]);
  });
});
