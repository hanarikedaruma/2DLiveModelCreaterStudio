import { describe, expect, it } from 'vitest';
import type { Binding, Mesh, Warp } from '@app/schema';
import type { Command } from '@app/contracts';
import { createBindingEvaluator } from '@app/core';
import { createKeyEditor } from './index';
import { delta, editorAt, part, projectWith } from './testing';
import { meshKeySpace } from './points';
import { hasDefaultKeyDifference, resetDefaultKeys } from '../../modes/modeling/parameters/generate';
import { editingLabel } from '../../modes/modeling/parameters/labels';

const editor = createKeyEditor();
const cmd = (c: Command | 'needsKey'): Command => {
  if (c === 'needsKey') throw new Error(c);
  return c;
};
const mesh: Mesh = {
  id: 'm',
  vertices: [{ x: 0, y: 0 }],
  uvs: [{ x: 0, y: 0 }],
  triangles: [],
  density: 'standard',
  edited: false,
};
const warp: Warp = {
  id: 'w',
  partId: 'g',
  columns: 1,
  rows: 1,
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
  ],
};
const binding = (kind: 'part' | 'mesh' | 'warp', parameterIds = ['FaceAngleX']): Binding => ({
  id: 'b',
  target: { type: kind, id: kind === 'part' ? 'p' : kind === 'mesh' ? 'm' : 'w' },
  channel: kind === 'part' ? 'transform' : kind === 'mesh' ? 'vertices' : 'warpPoints',
  parameterIds,
  keyValues: parameterIds.map(() => [-30, 0, 30]),
  generation: 'linear',
  divisions: null,
  keys: [-30, 0, 30].map((v) => ({
    coords: parameterIds.map(() => v),
    delta:
      kind === 'part'
        ? delta({ position: { x: v, y: 0 } })
        : Array.from({ length: kind === 'mesh' ? 1 : 4 }, () => ({ x: v, y: 0 })),
    source: 'auto',
    locked: false,
  })),
});
const project = (b?: Binding) =>
  projectWith({
    parts: [part('g', { kind: 'group' }), part('p', { meshId: 'm', parentId: 'g' })],
    meshes: [mesh],
    warps: [warp],
    bindings: b ? [b] : [],
  });

describe('既定値の形をキーに記録する（I-072）', () => {
  it.each(['part', 'mesh', 'warp'] as const)(
    '%s: 基準と端のキーを保ち、既定値だけを直す。途中の値は補間する',
    (kind) => {
      const p = project(binding(kind));
      const e = editorAt({ FaceAngleX: 0 });
      const c =
        kind === 'part'
          ? editor.transformEdit(p, e, ['p'], { dPosition: { x: 12, y: 3 } })
          : editor.pointsEdit(p, e, kind === 'mesh' ? { kind, meshId: 'm' } : { kind, warpId: 'w' }, [
              { index: 0, d: { x: 12, y: 3 } },
            ]);
      const next = cmd(c).apply(p);
      expect(next.model.parts).toBe(p.model.parts);
      expect(next.model.meshes).toBe(p.model.meshes);
      expect(next.model.warps).toBe(p.model.warps);
      const keys = next.model.bindings[0]!.keys;
      expect(keys[0]).toBe(p.model.bindings[0]!.keys[0]);
      expect(keys[2]).toBe(p.model.bindings[0]!.keys[2]);
      expect(keys[1]).toMatchObject({ source: 'manual', locked: true });
      const evaluator = createBindingEvaluator();
      const at = (v: number) => {
        const d = evaluator.evaluate(next.model, { FaceAngleX: v });
        return kind === 'part' ? d.transforms.p!.position.x : kind === 'mesh' ? d.vertices.m![0] : d.warpPoints.w![0];
      };
      expect(at(-30)).toBe(-30);
      expect(at(0)).toBe(12);
      expect(at(15)).toBe(21);
      expect(at(30)).toBe(30);
      // 1軸の既定値の補正は、別の軸のキーを表示するときも合成される
      const d = evaluator.evaluate(next.model, { FaceAngleY: 30 });
      expect(
        kind === 'part' ? d.transforms.p!.position.x : kind === 'mesh' ? d.vertices.m![0] : d.warpPoints.w![0],
      ).toBe(12);
    },
  );

  it('既定値2軸も同じ組のキーを直し、端の組と単独のキーを保つ', () => {
    const b = binding('part', ['FaceAngleY', 'FaceAngleX']);
    const p = project(b);
    const single = { ...binding('part'), id: 'single' };
    p.model.bindings.push(single);
    const next = cmd(
      editor.transformEdit(p, editorAt({ FaceAngleX: 0, FaceAngleY: 0 }), ['p'], { dRotation: 5 }),
    ).apply(p);
    expect(next.model.bindings).toHaveLength(2);
    expect(next.model.bindings[0]!.keys[0]).toBe(b.keys[0]);
    expect(next.model.bindings[0]!.keys[1]!.delta).toEqual(delta({ rotation: 5 }));
    expect(next.model.bindings[0]!.keys[2]).toBe(b.keys[2]);
    expect(next.model.bindings[1]).toBe(single);
    const fresh = project();
    const made = cmd(
      editor.transformEdit(fresh, editorAt({ FaceAngleX: 0, FaceAngleY: 0 }), ['p'], { dRotation: 5 }),
    ).apply(fresh);
    expect(made.model.bindings[0]!.keys).toHaveLength(1);
    expect(made.model.bindings[0]!.keys[0]!.coords).toEqual([0, 0]);
  });

  it.each(['mesh', 'warp'] as const)('%s: バインディングが無ければ既定値のキー1つだけを作る', (kind) => {
    const p = project();
    const next = cmd(
      editor.pointsEdit(
        p,
        editorAt({ FaceAngleX: 0 }),
        kind === 'mesh' ? { kind, meshId: 'm' } : { kind, warpId: 'w' },
        [{ index: 0, d: { x: 4, y: 5 } }],
      ),
    ).apply(p);
    expect(next.model.bindings[0]!.keys).toHaveLength(1);
    expect(next.model.bindings[0]!.keyValues).toEqual([[0]]);
    expect(next.model.bindings[0]!.keys[0]).toMatchObject({ coords: [0], source: 'manual', locked: true });
  });

  it('旧形式で既定値キーが無くても、その場でキーを足してから直せる', () => {
    const b = binding('part');
    b.keys = b.keys.filter((k) => k.coords[0] !== 0);
    const p = project(b);
    const next = cmd(editor.transformEdit(p, editorAt({ FaceAngleX: 0 }), ['p'], { dPosition: { x: 2, y: 0 } })).apply(
      p,
    );
    expect(next.model.bindings[0]!.keys).toHaveLength(3);
    expect(next.model.parts).toBe(p.model.parts);
  });

  it('モデル座標の頂点キーは、既定値でも同じ座標系で直す', () => {
    const p = project({ ...binding('mesh'), vertexSpace: 'model' });
    expect(meshKeySpace(p, editorAt({ FaceAngleX: 0 }), 'm')).toBe('model');
    const next = cmd(
      editor.pointsEdit(p, editorAt({ FaceAngleX: 0 }), { kind: 'mesh', meshId: 'm' }, [
        { index: 0, d: { x: 9, y: 1 } },
      ]),
    ).apply(p);
    expect(next.model.bindings).toHaveLength(1);
    expect(next.model.bindings[0]!.keys[1]!.delta).toEqual([{ x: 9, y: 1 }]);
  });

  it('既定値での位置変更と不透明度変更を1操作にしても、不透明度だけ基準へ反映する', () => {
    const b = { ...binding('part'), controlsOpacity: true };
    const p = project(b);
    const next = cmd(
      editor.transformEdit(p, editorAt({ FaceAngleX: 0 }), ['p'], { dPosition: { x: 8, y: 0 }, opacity: 0.4 }),
    ).apply(p);
    expect(next.model.parts[1]).toMatchObject({ position: { x: 0, y: 0 }, opacity: 0.4 });
    expect(next.model.bindings[0]!.keys[1]!.delta).toEqual(delta({ position: { x: 8, y: 0 }, opacity: 0.4 }));
    expect(next.model.bindings[0]!.keys[2]).toBe(b.keys[2]);
  });

  it('差を消す操作は選択したパーツの既定値の形だけを戻し、不透明度・キー位置・端を保つ', () => {
    const b = { ...binding('part'), controlsOpacity: true };
    b.keys[1] = {
      coords: [0],
      delta: delta({ position: { x: 12, y: 0 }, opacity: 0.4 }),
      source: 'manual',
      locked: true,
    };
    const m = project(b).model;
    expect(hasDefaultKeyDifference(m, 'FaceAngleX', ['g'])).toBe(true);
    expect(resetDefaultKeys(m, 'FaceAngleX', ['other'])).toBe(m);
    const out = resetDefaultKeys(m, 'FaceAngleX', ['g']);
    expect(out.bindings[0]!.keys[1]!.delta).toEqual(delta({ opacity: 0.4 }));
    expect(out.bindings[0]!.keyValues).toBe(b.keyValues);
    expect(out.bindings[0]!.keys[2]).toBe(b.keys[2]);
    expect(resetDefaultKeys(out, 'FaceAngleX')).toBe(out);
  });

  it('基準編集の表示は、パラメータ未選択でキーがあるパーツを選んだときに出る', () => {
    const p = project(binding('mesh'));
    expect(editingLabel(p, editorAt({}, { selectedPartIds: ['g'] }))).toBe(
      '基準の形を編集中（すべてのキーが一緒に動く）',
    );
    expect(editingLabel(p, editorAt({ FaceAngleX: 0 }, { selectedPartIds: ['p'] }))).toBe(
      '編集中: 顔 左右 ＝ 正面（0）',
    );
    expect(editingLabel(project(), editorAt({}, { selectedPartIds: ['p'] }))).toBeNull();
  });
});
