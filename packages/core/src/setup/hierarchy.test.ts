import { createEmptyProject, type Model, type Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { buildHierarchy, newGroupPart } from './hierarchy';

function part(id: string, patch: Partial<Part> = {}): Part {
  return { ...newGroupPart(id, 'bodyRoot'), kind: 'image', standardType: null, name: id, ...patch };
}

function model(parts: Part[]): Model {
  return { ...createEmptyProject('t').model, parts };
}

function counter() {
  let n = 0;
  return () => `g${++n}`;
}

const parentType = (m: Model, id: string) => {
  const p = m.parts.find((q) => q.id === id)!;
  return p.parentId === null ? null : m.parts.find((q) => q.id === p.parentId)!.standardType;
};

describe('buildHierarchy', () => {
  it('子のある変形グループと、根から頭までのグループを作り、木のとおりにつなぐ', () => {
    const out = buildHierarchy(
      model([part('iris', { standardType: 'irisL' }), part('torso', { standardType: 'torso' })]),
      counter(),
    );
    const groups = out.parts.filter((p) => p.kind === 'group');
    expect(groups.map((g) => g.standardType)).toEqual(['bodyRoot', 'neckRoot', 'headRoot', 'faceGroup', 'eyeGroupL']);
    expect(groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    expect(groups.find((g) => g.standardType === 'eyeGroupL')).toMatchObject({ name: '目の変形 L', kind: 'group' });
    expect(parentType(out, 'iris')).toBe('eyeGroupL');
    expect(parentType(out, 'torso')).toBe('bodyRoot');
    expect(parentType(out, 'g5')).toBe('faceGroup');
    expect(parentType(out, 'g4')).toBe('headRoot');
    expect(parentType(out, 'g3')).toBe('neckRoot');
    expect(parentType(out, 'g2')).toBe('bodyRoot');
    expect(parentType(out, 'g1')).toBeNull();
  });

  it('あるグループは作らず、そのまま使う', () => {
    const existing = part('mine', { kind: 'group', standardType: 'headRoot', parentId: 'nowhere' });
    const out = buildHierarchy(model([existing, part('front', { standardType: 'frontHair' })]), counter());
    expect(out.parts.filter((p) => p.standardType === 'headRoot').map((p) => p.id)).toEqual(['mine']);
    expect(out.parts.find((p) => p.id === 'front')!.parentId).toBe('mine');
    expect(parentType(out, 'mine')).toBe('neckRoot');
  });

  it('親の無い自由パーツは headRoot の子にし、親のある自由パーツはそのまま', () => {
    const out = buildHierarchy(
      model([
        part('ribbon'),
        part('folder', { kind: 'group' }),
        part('charm', { parentId: 'folder' }),
        part('lost', { parentId: 'deleted' }),
      ]),
      counter(),
    );
    expect(parentType(out, 'ribbon')).toBe('headRoot');
    expect(parentType(out, 'folder')).toBe('headRoot');
    expect(out.parts.find((p) => p.id === 'charm')!.parentId).toBe('folder');
    expect(parentType(out, 'lost')).toBe('headRoot');
  });

  it('木の親のグループが無ければ、さらに上のグループの子にする', () => {
    // 既存の eyeGroupL（子なし）は faceGroup が無いので headRoot の子になる
    const out = buildHierarchy(model([part('eg', { kind: 'group', standardType: 'eyeGroupL' })]), counter());
    expect(out.parts.some((p) => p.standardType === 'faceGroup')).toBe(false);
    expect(parentType(out, 'eg')).toBe('headRoot');
  });

  it('もう木のとおりなら同じ参照を返す', () => {
    const once = buildHierarchy(model([part('face', { standardType: 'face' }), part('ribbon')]), counter());
    expect(buildHierarchy(once, counter())).toBe(once);
  });
});
