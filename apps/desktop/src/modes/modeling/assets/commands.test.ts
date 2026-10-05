import { describe, expect, it } from 'vitest';
import { validateProject } from '@app/schema';
import { createProjectStore } from '@app/core';
import { counterIds, makeAsset, makeBinding, makePart, makeProject } from '../structure/testing';
import {
  addAssets,
  assign,
  findAssignment,
  freeSlotParts,
  layerNameOf,
  slotMembers,
  unassign,
  type AssignItem,
  type MeshData,
} from './commands';

const quad = (x: number, y: number): MeshData => ({
  vertices: [
    { x, y },
    { x: x + 1, y },
    { x, y: y + 1 },
  ],
  uvs: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ],
  triangles: [[0, 1, 2]],
});

const item = (assetId: string, mesh: MeshData | null = quad(0, 0)): AssignItem => ({ assetId, mesh });

function project() {
  return makeProject({
    assets: [
      makeAsset('A1', {
        offset: { x: 10, y: 20 },
        width: 40,
        height: 30,
        source: { kind: 'psd', file: 'a.psd', layerName: '白目', layerPath: ['目'] },
      }),
      makeAsset('A2', { offset: { x: 60, y: 20 }, width: 20, height: 10, source: { kind: 'png', file: 'eye2.png' } }),
      makeAsset('A3', { offset: { x: 0, y: 0 }, width: 10, height: 10 }),
    ],
    parts: [makePart('existing')],
  });
}

describe('addAssets', () => {
  it('project.assets に足し、同じ id は足さない', () => {
    const p = makeProject({ assets: [makeAsset('A')] });
    const next = addAssets([makeAsset('A'), makeAsset('B')]).apply(p);
    expect(next.assets.map((a) => a.id)).toEqual(['A', 'B']);
    expect(addAssets([makeAsset('A')]).apply(p)).toBe(p);
  });
});

describe('layerNameOf', () => {
  it('PSD はレイヤー名、PNG はファイル名から拡張子を除いたもの', () => {
    const p = project();
    expect(layerNameOf(p.assets[0]!)).toBe('白目');
    expect(layerNameOf(p.assets[1]!)).toBe('eye2');
  });
});

describe('assign', () => {
  it.each([0, 0.25, 0.5, 1])('素材の不透明度 %s を単一・自由・グループの画像に一度だけ引き継ぐ', (opacity) => {
    const p = project();
    p.assets[0] = { ...p.assets[0]!, sourceOpacity: opacity };
    const single = assign({ kind: 'standard', type: 'face' }, [item('A1')]).apply(p);
    expect(single.model.parts.at(-1)!.opacity).toBe(opacity);
    const free = assign({ kind: 'free', partId: null, name: '自由' }, [item('A1')]).apply(p);
    expect(free.model.parts.at(-1)!.opacity).toBe(opacity);
    const grouped = assign({ kind: 'standard', type: 'face' }, [item('A1'), item('A2')]).apply(p);
    const group = grouped.model.parts.find((part) => part.standardType === 'face')!;
    expect(group.opacity).toBe(1);
    expect(slotMembers(grouped.model, group).map((part) => part.opacity)).toEqual([opacity, 1]);
    const edited = {
      ...single,
      model: {
        ...single.model,
        parts: single.model.parts.map((part) => (part.assetId === 'A1' ? { ...part, opacity: 0.7 } : part)),
      },
    };
    const expanded = assign({ kind: 'standard', type: 'face' }, [item('A2')]).apply(edited);
    const expandedGroup = expanded.model.parts.find((part) => part.standardType === 'face')!;
    expect(expandedGroup.opacity).toBe(1);
    expect(slotMembers(expanded.model, expandedGroup).map((part) => part.opacity)).toEqual([0.7, 1]);
    expect(() => validateProject(JSON.parse(JSON.stringify(grouped)))).not.toThrow();
    const store = createProjectStore(p);
    store.dispatch(assign({ kind: 'standard', type: 'face' }, [item('A1')]));
    expect(store.get().model.parts.at(-1)!.opacity).toBe(opacity);
    store.undo();
    expect(store.get()).toBe(p);
    store.redo();
    expect(store.get().model.parts.at(-1)!.opacity).toBe(opacity);
  });
  it('画像パーツとメッシュを作り、drawOrder の最前面に足す', () => {
    const p = project();
    const next = assign({ kind: 'standard', type: 'eyeWhiteL' }, [item('A1', quad(10, 20))], {
      newId: counterIds(),
    }).apply(p);
    const part = next.model.parts.at(-1)!;
    expect(part).toMatchObject({
      name: '白目 L',
      kind: 'image',
      standardType: 'eyeWhiteL',
      assetId: 'A1',
      meshId: 'new1',
      parentId: null,
      pivot: { x: 30, y: 35 },
      depth: 0,
      visible: true,
      blendMode: 'normal',
    });
    expect(next.model.meshes).toEqual([{ id: 'new1', ...quad(10, 20), density: 'standard', edited: false }]);
    expect(next.model.drawOrder).toEqual(['existing', part.id]);
    expect(() => validateProject(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it('画像パーツの合成モードは素材の sourceBlendMode を引き継ぐ（グループは通常）', () => {
    const base = project();
    const p = {
      ...base,
      assets: base.assets.map((a) =>
        a.id === 'A1'
          ? { ...a, sourceBlendMode: 'multiply' as const }
          : a.id === 'A2'
            ? { ...a, sourceBlendMode: 'add' as const }
            : { ...a, sourceBlendMode: 'screen' as const },
      ),
    };
    // 1つの素材の枠
    const single = assign({ kind: 'standard', type: 'cheek' }, [item('A1')]).apply(p);
    expect(single.model.parts.at(-1)!.blendMode).toBe('multiply');
    // 複数の素材の枠はグループと子の画像パーツ
    const grouped = assign({ kind: 'standard', type: 'eyeWhiteL' }, [item('A1'), item('A2')]).apply(p);
    const group = grouped.model.parts.find((x) => x.standardType === 'eyeWhiteL')!;
    expect(group.blendMode).toBe('normal');
    const children = grouped.model.parts.filter((x) => x.parentId === group.id);
    expect(children.map((c) => [c.assetId, c.blendMode])).toEqual([
      ['A1', 'multiply'],
      ['A2', 'add'],
    ]);
    // 画像の枠に足すと、今の画像は合成モードを保ち、足したものは素材の合成モード
    const more = assign({ kind: 'standard', type: 'cheek' }, [item('A3')]).apply(single);
    const cheek = more.model.parts.find((x) => x.standardType === 'cheek')!;
    expect(slotMembers(more.model, cheek).map((m) => [m.assetId, m.blendMode])).toEqual([
      ['A1', 'multiply'],
      ['A3', 'screen'],
    ]);
    // 自由パーツも同じ
    const free = assign({ kind: 'free', partId: null, name: '光' }, [item('A2')]).apply(p);
    expect(free.model.parts.at(-1)!.blendMode).toBe('add');
    expect(() => validateProject(JSON.parse(JSON.stringify(more)))).not.toThrow();
  });

  it('メッシュが作れなかった素材は meshId を null にする', () => {
    const next = assign({ kind: 'standard', type: 'face' }, [item('A3', null)]).apply(project());
    expect(next.model.parts.at(-1)!.meshId).toBeNull();
    expect(next.model.meshes).toEqual([]);
  });

  it('同じ入力なら同じ結果になる（純粋）', () => {
    const p = project();
    const command = assign({ kind: 'standard', type: 'face' }, [item('A1'), item('A2')]);
    expect(command.apply(p)).toEqual(command.apply(p));
  });

  it('1つの枠に複数の素材を入れるとグループになり、子は standardType null・レイヤー名', () => {
    const next = assign({ kind: 'standard', type: 'eyeWhiteL' }, [item('A1'), item('A2')], {
      newId: counterIds(),
    }).apply(project());
    const group = next.model.parts.find((p) => p.standardType === 'eyeWhiteL')!;
    expect(group).toMatchObject({
      kind: 'group',
      name: '白目 L',
      assetId: null,
      meshId: null,
      pivot: { x: 45, y: 35 },
    });
    const children = next.model.parts.filter((p) => p.parentId === group.id);
    expect(children.map((c) => [c.name, c.standardType, c.assetId])).toEqual([
      ['白目', null, 'A1'],
      ['eye2', null, 'A2'],
    ]);
    expect(next.model.drawOrder).toEqual(['existing', ...children.map((c) => c.id)]);
    expect(next.model.meshes).toHaveLength(2);
  });

  it('画像の枠にもう1つ入れると、枠をグループにして今の画像を子にする', () => {
    const p1 = assign({ kind: 'standard', type: 'eyeWhiteL' }, [item('A1')]).apply(project());
    const first = p1.model.parts.at(-1)!;
    const p2 = assign({ kind: 'standard', type: 'eyeWhiteL' }, [item('A2')]).apply(p1);
    const group = p2.model.parts.find((p) => p.standardType === 'eyeWhiteL')!;
    expect(group.kind).toBe('group');
    const child = p2.model.parts.find((p) => p.id === first.id)!;
    expect(child).toMatchObject({ parentId: group.id, standardType: null, name: '白目', meshId: first.meshId });
    expect(slotMembers(p2.model, group).map((m) => m.assetId)).toEqual(['A1', 'A2']);
    // 今の画像の描画順は保ち、新しいものを最前面に足す
    expect(p2.model.drawOrder.slice(0, 2)).toEqual(['existing', first.id]);
    // グループの枠には子を足す
    const p3 = assign({ kind: 'standard', type: 'eyeWhiteL' }, [item('A3')]).apply(p2);
    expect(slotMembers(p3.model, group).map((m) => m.assetId)).toEqual(['A1', 'A2', 'A3']);
  });

  it('同じ枠に同じ素材を入れても変わらない', () => {
    const p1 = assign({ kind: 'standard', type: 'face' }, [item('A1')]).apply(project());
    expect(assign({ kind: 'standard', type: 'face' }, [item('A1')]).apply(p1)).toBe(p1);
  });

  it('ほかの枠に入っている素材は付け替える', () => {
    const p1 = assign({ kind: 'standard', type: 'irisL' }, [item('A1'), item('A2')]).apply(project());
    const p2 = assign({ kind: 'standard', type: 'irisR' }, [item('A2')]).apply(p1);
    expect(findAssignment(p2.model, 'A2')!.slot.standardType).toBe('irisR');
    expect(findAssignment(p2.model, 'A1')!.slot.standardType).toBe('irisL');
    // 最後の1つも付け替えると、空になったグループは消える
    const p3 = assign({ kind: 'standard', type: 'irisR' }, [item('A1')]).apply(p2);
    expect(p3.model.parts.some((p) => p.standardType === 'irisL')).toBe(false);
    expect(p3.model.parts.filter((p) => p.kind === 'image' && p.assetId).map((p) => p.assetId)).toEqual(['A2', 'A1']);
    expect(p3.model.meshes).toHaveLength(2);
  });

  it('自由パーツは名前を付けて作り、standardType は null', () => {
    const next = assign({ kind: 'free', partId: null, name: 'リボン' }, [item('A3')]).apply(project());
    const part = next.model.parts.at(-1)!;
    expect(part).toMatchObject({ name: 'リボン', standardType: null, assetId: 'A3' });
    // 素材の入っていないパーツ（existing）は「その他」に並べない
    expect(freeSlotParts(next.model).map((p) => p.id)).toEqual([part.id]);
    const more = assign({ kind: 'free', partId: part.id, name: 'リボン' }, [item('A2')]).apply(next);
    const group = more.model.parts.find((p) => p.name === 'リボン')!;
    expect(group.kind).toBe('group');
    expect(slotMembers(more.model, group)).toHaveLength(2);
  });

  it('無い素材は無視する', () => {
    const p = project();
    expect(assign({ kind: 'standard', type: 'face' }, [item('nope')]).apply(p)).toBe(p);
  });
});

describe('unassign', () => {
  it('枠ごと外すと、メッシュ・drawOrder・バインディングも消える', () => {
    const p1 = assign({ kind: 'standard', type: 'face' }, [item('A1')]).apply(project());
    const face = p1.model.parts.at(-1)!;
    const withBinding = {
      ...p1,
      model: { ...p1.model, bindings: [makeBinding('b', { target: { type: 'part', id: face.id } })] },
    };
    const next = unassign({ kind: 'standard', type: 'face' }).apply(withBinding);
    expect(next.model.parts.map((p) => p.id)).toEqual(['existing']);
    expect(next.model.meshes).toEqual([]);
    expect(next.model.drawOrder).toEqual(['existing']);
    expect(next.model.bindings).toEqual([]);
  });

  it('グループの枠から1つだけ外す。空になったらグループも消す', () => {
    const p1 = assign({ kind: 'standard', type: 'teeth' }, [item('A1'), item('A2')]).apply(project());
    const p2 = unassign({ kind: 'standard', type: 'teeth' }, 'A1').apply(p1);
    expect(findAssignment(p2.model, 'A1')).toBeNull();
    expect(findAssignment(p2.model, 'A2')!.slot.standardType).toBe('teeth');
    const p3 = unassign({ kind: 'standard', type: 'teeth' }, 'A2').apply(p2);
    expect(p3.model.parts.map((p) => p.id)).toEqual(['existing']);
  });

  it('画像の枠に違う素材を指定したら何もしない', () => {
    const p1 = assign({ kind: 'standard', type: 'face' }, [item('A1')]).apply(project());
    expect(unassign({ kind: 'standard', type: 'face' }, 'A2').apply(p1)).toBe(p1);
    expect(unassign({ kind: 'standard', type: 'neck' }).apply(p1)).toBe(p1);
  });
});

describe('Undo', () => {
  it('取り込み・割り当て・解除はどれもストアで元に戻せる', () => {
    const base = makeProject();
    const store = createProjectStore(base);
    store.dispatch(addAssets(project().assets));
    const afterImport = store.get();
    store.dispatch(assign({ kind: 'standard', type: 'face' }, [item('A1')]));
    const afterAssign = store.get();
    store.dispatch(assign({ kind: 'standard', type: 'face' }, [item('A2')]));
    store.dispatch(unassign({ kind: 'standard', type: 'face' }, 'A1'));
    store.undo();
    store.undo();
    expect(store.get()).toBe(afterAssign);
    store.undo();
    expect(store.get()).toBe(afterImport);
    store.undo();
    expect(store.get()).toBe(base);
  });
});
