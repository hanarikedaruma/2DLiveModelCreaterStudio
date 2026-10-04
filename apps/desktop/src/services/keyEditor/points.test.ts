import { describe, expect, it } from 'vitest';
import type { Binding, Mesh, Project, Vec2, Warp } from '@app/schema';
import type { Command } from '@app/contracts';
import { createKeyEditor } from './index';
import { DETAIL, deepFreeze, editorAt, expectSameLook, projectWith, range, referenceTarget, samples } from './testing';

const keyEditor = createKeyEditor();

function command(result: Command | 'needsKey'): Command {
  if (result === 'needsKey') throw new Error('needsKey が返った');
  return result;
}

const v = (x: number, y: number): Vec2 => ({ x, y });
const zeros = (n: number) => Array.from({ length: n }, () => v(0, 0));

const mesh: Mesh = {
  id: 'm1',
  vertices: [v(0, 0), v(10, 0), v(10, 10), v(0, 10)],
  uvs: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
  triangles: [
    [0, 1, 2],
    [0, 2, 3],
  ],
  density: 'standard',
  edited: false,
};
const warp: Warp = {
  id: 'w1',
  partId: 'g1',
  columns: 1,
  rows: 1,
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  points: [v(0, 0), v(100, 0), v(0, 100), v(100, 100)],
};

function baseProject(bindings: Binding[] = []): Project {
  return deepFreeze(projectWith({ meshes: [mesh], warps: [warp], bindings }));
}

function mouthBinding(keys: Binding['keys']): Binding {
  return {
    id: 'b-mouth',
    target: { type: 'mesh', id: 'm1' },
    channel: 'vertices',
    parameterIds: ['MouthOpen'],
    keyValues: [keys.map((k) => k.coords[0]!).sort((a, b) => a - b)],
    keys,
    generation: 'linear',
    divisions: null,
  };
}

describe('基準状態の編集', () => {
  it('編集中のパラメータが無ければメッシュの頂点・ワープの制御点を動かす（範囲外の番号は無視）', () => {
    const project = baseProject();
    const moves = [
      { index: 1, d: v(5, 1) },
      { index: 9, d: v(1, 1) },
    ];
    const moved = command(keyEditor.pointsEdit(project, editorAt({}), { kind: 'mesh', meshId: 'm1' }, moves)).apply(
      project,
    );
    expect(moved.model.meshes[0]!.vertices).toEqual([v(0, 0), v(15, 1), v(10, 10), v(0, 10)]);
    expect(moved.model.bindings).toEqual([]);

    const warped = command(
      keyEditor.pointsEdit(project, editorAt({ MouthOpen: 0 }), { kind: 'warp', warpId: 'w1' }, [
        { index: 3, d: v(-10, -20) },
      ]),
    ).apply(project);
    expect(warped.model.warps[0]!.points[3]).toEqual(v(90, 80));
  });

  it('対象が無い・動かす点が無いときは何もしない', () => {
    const project = baseProject();
    const none = keyEditor.pointsEdit(project, editorAt({ MouthOpen: 1 }), { kind: 'mesh', meshId: 'x' }, [
      { index: 0, d: v(1, 1) },
    ]);
    expect(command(none).apply(project)).toBe(project);
    const empty = keyEditor.pointsEdit(project, editorAt({}), { kind: 'warp', warpId: 'w1' }, []);
    expect(command(empty).apply(project)).toBe(project);
  });
});

describe('パラメータの編集中', () => {
  it.each(['mesh', 'warp'] as const)('%s の格子上の補正も確認なしで作り、単独の軸の見た目を保つ（I-017）', (kind) => {
    const target = kind === 'mesh' ? { kind, meshId: 'm1' } : { kind, warpId: 'w1' };
    const b: Binding = {
      id: 'pair',
      target: { type: kind, id: kind === 'mesh' ? 'm1' : 'w1' },
      channel: kind === 'mesh' ? 'vertices' : 'warpPoints',
      parameterIds: ['EyeBallX', 'EyeBallY'],
      keyValues: [
        [0, 1],
        [0, 1],
      ],
      keys: [
        { coords: [0, 0], delta: zeros(4), source: 'auto', locked: false },
        { coords: [1, 0], delta: [v(0, 0), v(4, 0), v(0, 0), v(0, 0)], source: 'manual', locked: false },
        { coords: [0, 1], delta: [v(0, 0), v(0, -2), v(0, 0), v(0, 0)], source: 'manual', locked: false },
      ],
      generation: 'linear',
      divisions: null,
    };
    const p = baseProject([b]);
    const editor = editorAt({ EyeBallY: 1, EyeBallX: 1 }, DETAIL);
    const out = command(keyEditor.pointsEdit(p, editor, target, [{ index: 1, d: v(2, 3) }])).apply(p);
    expect(out.model.bindings[0]!.keys.find((k) => k.coords.join() === '1,1')).toEqual({
      coords: [1, 1],
      delta: [v(0, 0), v(6, 1), v(0, 0), v(0, 0)],
      source: 'manual',
      locked: false,
    });
    expect(out.model.meshes).toBe(p.model.meshes);
    expect(out.model.warps).toBe(p.model.warps);
    for (const values of [
      { EyeBallX: 1, EyeBallY: 0 },
      { EyeBallX: 0, EyeBallY: 1 },
    ]) {
      expect(referenceTarget(out.model, b.target, values, 4)).toEqual(referenceTarget(p.model, b.target, values, 4));
    }
    const between = editorAt({ EyeBallX: 0.5, EyeBallY: 1 });
    expect(keyEditor.pointsEdit(p, between, target, [{ index: 1, d: v(1, 0) }])).toBe('needsKey');
  });

  it('頂点はメッシュの vertices バインディングに記録する（無ければ作る。差分は頂点の数の配列）', () => {
    const project = baseProject();
    const result = command(
      keyEditor.pointsEdit(project, editorAt({ MouthOpen: 1 }), { kind: 'mesh', meshId: 'm1' }, [
        { index: 2, d: v(0, 6) },
      ]),
    ).apply(project);
    expect(result.model.meshes).toEqual(project.model.meshes); // 基準の頂点は変えない
    const b = result.model.bindings[0]!;
    expect(b).toMatchObject({
      target: { type: 'mesh', id: 'm1' },
      channel: 'vertices',
      parameterIds: ['MouthOpen'],
      keyValues: [[0, 1]],
    });
    expect(b.keys).toEqual([
      { coords: [0], delta: zeros(4), source: 'auto', locked: false },
      { coords: [1], delta: [v(0, 0), v(0, 0), v(0, 6), v(0, 0)], source: 'manual', locked: true },
    ]);
  });

  it('制御点はワープの warpPoints バインディングに記録する', () => {
    const project = baseProject();
    const result = command(
      keyEditor.pointsEdit(project, editorAt({ EyeBallX: -1 }, DETAIL), { kind: 'warp', warpId: 'w1' }, [
        { index: 0, d: v(-3, 0) },
      ]),
    ).apply(project);
    expect(result.model.warps).toEqual(project.model.warps);
    const b = result.model.bindings[0]!;
    expect(b).toMatchObject({ target: { type: 'warp', id: 'w1' }, channel: 'warpPoints', keyValues: [[-1, 0]] });
    expect(b.keys[1]).toEqual({
      coords: [-1],
      delta: [v(-3, 0), v(0, 0), v(0, 0), v(0, 0)],
      source: 'manual',
      locked: false,
    });
  });

  it('キーのある値では、そのキーの差分に足す（短い差分は 0 で埋める）', () => {
    const project = baseProject([
      mouthBinding([
        { coords: [0], delta: zeros(4), source: 'auto', locked: false },
        { coords: [1], delta: [v(1, 1), v(2, 2)], source: 'generated', locked: false },
      ]),
    ]);
    const result = command(
      keyEditor.pointsEdit(project, editorAt({ MouthOpen: 1 }), { kind: 'mesh', meshId: 'm1' }, [
        { index: 0, d: v(1, 0) },
        { index: 3, d: v(0, -1) },
      ]),
    ).apply(project);
    expect(result.model.bindings[0]!.keys[1]).toEqual({
      coords: [1],
      delta: [v(2, 1), v(2, 2), v(0, 0), v(0, -1)],
      source: 'manual',
      locked: true,
    });
  });

  it('キーの無い値では needsKey、キーを足しても見た目が変わらない', () => {
    const project = baseProject([
      mouthBinding([
        { coords: [0], delta: zeros(4), source: 'auto', locked: false },
        { coords: [1], delta: [v(0, 0), v(0, 0), v(0, 10), v(4, 10)], source: 'manual', locked: false },
      ]),
    ]);
    const editor = editorAt({ MouthOpen: 0.25 });
    const target = { kind: 'mesh', meshId: 'm1' } as const;
    expect(keyEditor.pointsEdit(project, editor, target, [{ index: 2, d: v(0, 1) }])).toBe('needsKey');

    const added = keyEditor.addKeyAtCurrentValue(project, editor, target).apply(project);
    const b = added.model.bindings[0]!;
    expect(b.keyValues).toEqual([[0, 0.25, 1]]);
    expect(b.keys[1]).toEqual({
      coords: [0.25],
      delta: [v(0, 0), v(0, 0), v(0, 2.5), v(1, 2.5)],
      source: 'manual',
      locked: true,
    });
    const values = samples({ MouthOpen: range(0, 1, 0.05) });
    const look = (p: Project, x: Record<string, number>) => referenceTarget(p.model, { type: 'mesh', id: 'm1' }, x, 4);
    expectSameLook(
      values.map((x) => look(project, x)),
      values.map((x) => look(added, x)),
    );

    const edited = command(keyEditor.pointsEdit(added, editor, target, [{ index: 2, d: v(0, 1) }])).apply(added);
    expect(edited.model.bindings[0]!.keys[1]!.delta).toEqual([v(0, 0), v(0, 0), v(0, 3.5), v(1, 2.5)]);
  });

  it('2つのパラメータでも制御点を記録できる', () => {
    const project = baseProject();
    const editor = editorAt({ EyeBallX: 1, EyeBallY: 1 });
    const target = { kind: 'warp', warpId: 'w1' } as const;
    const result = command(keyEditor.pointsEdit(project, editor, target, [{ index: 1, d: v(2, -2) }])).apply(project);
    const b = result.model.bindings[0]!;
    expect(b).toMatchObject({
      parameterIds: ['EyeBallX', 'EyeBallY'],
      keyValues: [
        [0, 1],
        [0, 1],
      ],
    });
    expect(b.keys[1]).toMatchObject({ coords: [1, 1], delta: [v(0, 0), v(2, -2), v(0, 0), v(0, 0)] });

    // 間の値にキーを足しても見た目が変わらない
    const half = editorAt({ EyeBallX: 0.5, EyeBallY: 1 });
    expect(keyEditor.pointsEdit(result, half, target, [{ index: 1, d: v(1, 1) }])).toBe('needsKey');
    const added = keyEditor.addKeyAtCurrentValue(result, half, target).apply(result);
    const grid = samples({ EyeBallX: range(-1, 1, 0.25), EyeBallY: range(-1, 1, 0.25) });
    const look = (p: Project, x: Record<string, number>) => referenceTarget(p.model, { type: 'warp', id: 'w1' }, x, 4);
    expectSameLook(
      grid.map((x) => look(result, x)),
      grid.map((x) => look(added, x)),
    );
  });
});
