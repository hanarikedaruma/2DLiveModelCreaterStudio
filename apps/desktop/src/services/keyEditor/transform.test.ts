import { describe, expect, it } from 'vitest';
import type { Binding, Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { createKeyEditor } from './index';
import {
  DETAIL,
  deepFreeze,
  delta,
  editorAt,
  expectSameLook,
  part,
  projectWith,
  range,
  referenceTarget,
  samples,
} from './testing';

const keyEditor = createKeyEditor();

function command(result: Command | 'needsKey'): Command {
  if (result === 'needsKey') throw new Error('needsKey が返った');
  return result;
}

function faceXBinding(keys: Binding['keys'], patch: Partial<Binding> = {}): Binding {
  return {
    id: 'b-face',
    target: { type: 'part', id: 'face' },
    channel: 'transform',
    parameterIds: ['FaceAngleX'],
    keyValues: [[...new Set(keys.map((k) => k.coords[0]!))].sort((a, b) => a - b)],
    keys,
    generation: 'linear',
    divisions: null,
    ...patch,
  };
}

function baseProject(bindings: Binding[] = []): Project {
  return deepFreeze(projectWith({ parts: [part('face'), part('hair', { opacity: 0.5 })], bindings }));
}

const partLook = (p: Project, values: Record<string, number>) =>
  referenceTarget(p.model, { type: 'part', id: 'face' }, values);

describe('基準状態の編集', () => {
  it('編集中のパラメータが無いと Part の値を変える（位置・回転は加算、拡縮・不透明度は掛ける、ピボットも動かす）', () => {
    const project = baseProject();
    const result = command(
      keyEditor.transformEdit(project, editorAt({}), ['face', 'hair'], {
        dPosition: { x: 10, y: -5 },
        dRotation: 15,
        scaleFactor: { x: 2, y: 0.5 },
        opacityFactor: 4,
        dPivot: { x: 3, y: 4 },
      }),
    ).apply(project);
    // opacity は 0..1 に丸める
    expect(result.model.parts).toEqual([
      part('face', { position: { x: 10, y: -5 }, rotation: 15, scale: { x: 2, y: 0.5 }, pivot: { x: 53, y: 54 } }),
      part('hair', {
        position: { x: 10, y: -5 },
        rotation: 15,
        scale: { x: 2, y: 0.5 },
        pivot: { x: 53, y: 54 },
        opacity: 1,
      }),
    ]);
    expect(result.model.bindings).toEqual([]);
  });

  it('パラメータを選んでいてもデフォルト値なら基準状態を変える', () => {
    const project = baseProject();
    const cmd = keyEditor.transformEdit(project, editorAt({ FaceAngleX: 0 }), ['face'], { dPosition: { x: 1, y: 2 } });
    const result = command(cmd).apply(project);
    expect(result.model.parts[0]!.position).toEqual({ x: 1, y: 2 });
    expect(result.model.bindings).toEqual([]);
  });

  it('値が変わらない変更や、無いパーツへの変更では同じプロジェクトを返す', () => {
    const project = baseProject();
    expect(command(keyEditor.transformEdit(project, editorAt({}), ['face'], {})).apply(project)).toBe(project);
    expect(command(keyEditor.transformEdit(project, editorAt({}), ['nothing'], { dRotation: 5 })).apply(project)).toBe(
      project,
    );
  });
});

describe('1つのパラメータでの編集', () => {
  it('バインディングが無ければ作る（keyValues は [デフォルト値, 現在値] の昇順、デフォルト値のキーは差分 0）', () => {
    const project = baseProject();
    const result = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: 30 }), ['face'], { dPosition: { x: 12, y: 0 } }),
    ).apply(project);
    expect(result.model.parts).toEqual(project.model.parts); // 基準状態は変えない
    expect(result.model.bindings).toHaveLength(1);
    const b = result.model.bindings[0]!;
    expect(b).toMatchObject({
      target: { type: 'part', id: 'face' },
      channel: 'transform',
      parameterIds: ['FaceAngleX'],
      keyValues: [[0, 30]],
      generation: 'linear',
      divisions: null,
    });
    expect(b.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(b.keys).toEqual([
      { coords: [0], delta: delta(), source: 'auto', locked: false },
      { coords: [30], delta: delta({ position: { x: 12, y: 0 } }), source: 'manual', locked: true },
    ]);

    // 負の側でも昇順にする
    const left = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: -30 }), ['face'], { dRotation: -4 }),
    ).apply(project);
    expect(left.model.bindings[0]!.keyValues).toEqual([[-30, 0]]);
    expect(left.model.bindings[0]!.keys.map((k) => k.coords)).toEqual([[0], [-30]]);
  });

  it('キーのある値で編集すると、そのキーの差分が変わる（位置・回転は加算、拡縮・不透明度は掛ける）', () => {
    const original = faceXBinding([
      { coords: [0], delta: delta(), source: 'auto', locked: false },
      { coords: [15], delta: delta({ rotation: 1 }), source: 'generated', locked: false },
      {
        coords: [30],
        delta: delta({ position: { x: 10, y: 0 }, rotation: 5, scale: { x: 1.2, y: 1 }, opacity: 0.8 }),
        source: 'generated',
        locked: false,
      },
    ]);
    const project = baseProject([original]);
    const result = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: 30 }, DETAIL), ['face'], {
        dPosition: { x: 5, y: -2 },
        dRotation: 3,
        scaleFactor: { x: 0.5, y: 2 },
        opacityFactor: 0.5,
      }),
    ).apply(project);
    const b = result.model.bindings[0]!;
    expect(result.model.bindings).toHaveLength(1);
    expect(b.id).toBe('b-face');
    expect(b.keys[2]!.delta).toEqual(
      delta({ position: { x: 15, y: -2 }, rotation: 8, scale: { x: 0.6, y: 2 }, opacity: 0.4 }),
    );
    // source は manual にする。詳細モードでは locked を変えない
    expect(b.keys[2]).toMatchObject({ source: 'manual', locked: false });
    // ほかのキーはそのまま
    expect(b.keys.slice(0, 2)).toEqual(original.keys.slice(0, 2));
    expect(b.keyValues).toEqual([[0, 15, 30]]);
  });

  it('かんたんモードでは編集したキーを locked にする', () => {
    const project = baseProject([
      faceXBinding([
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [30], delta: delta(), source: 'generated', locked: false },
      ]),
    ]);
    const easy = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: 30 }), ['face'], { dRotation: 1 }),
    ).apply(project);
    expect(easy.model.bindings[0]!.keys[1]).toMatchObject({ source: 'manual', locked: true });
    // 新しいバインディングのキーも詳細モードではロックしない
    const empty = baseProject();
    const fresh = command(
      keyEditor.transformEdit(empty, editorAt({ FaceAngleX: 30 }, DETAIL), ['face'], { dRotation: 1 }),
    ).apply(empty);
    expect(fresh.model.bindings[0]!.keys[1]).toMatchObject({ source: 'manual', locked: false });
  });

  it('値は min..max に丸めてから探す', () => {
    const project = baseProject([
      faceXBinding([
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [30], delta: delta(), source: 'manual', locked: false },
      ]),
    ]);
    const result = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: 45 }), ['face'], { dRotation: 2 }),
    ).apply(project);
    expect(result.model.bindings[0]!.keys[1]!.delta).toEqual(delta({ rotation: 2 }));
  });

  it('dPivot は基準状態でだけ受け付ける', () => {
    const project = baseProject();
    const editor = editorAt({ FaceAngleX: 30 });
    const result = command(
      keyEditor.transformEdit(project, editor, ['face'], { dPivot: { x: 9, y: 9 }, dPosition: { x: 1, y: 0 } }),
    ).apply(project);
    expect(result.model.parts[0]!.pivot).toEqual({ x: 50, y: 50 });
    expect(result.model.bindings[0]!.keys[1]!.delta).toEqual(delta({ position: { x: 1, y: 0 } }));
    // ピボットだけなら何もしない（キーの無い値でも needsKey にしない）
    const withGap = baseProject([
      faceXBinding([
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [30], delta: delta(), source: 'manual', locked: false },
      ]),
    ]);
    const pivotOnly = keyEditor.transformEdit(withGap, editorAt({ FaceAngleX: 10 }), ['face'], {
      dPivot: { x: 1, y: 1 },
    });
    expect(command(pivotOnly).apply(withGap)).toBe(withGap);
  });

  it('複数のパーツはそれぞれのバインディングに記録し、1つでもキーが無ければ needsKey', () => {
    const project = baseProject();
    const result = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: 30 }), ['face', 'hair', 'face'], { dRotation: 3 }),
    ).apply(project);
    expect(result.model.bindings.map((b) => b.target.id)).toEqual(['face', 'hair']);
    expect(result.model.bindings.map((b) => b.keys[1]!.delta)).toEqual([
      delta({ rotation: 3 }),
      delta({ rotation: 3 }),
    ]);

    // face にはキーの無い値（15）。hair はバインディングが無いので作れるが、まとめて needsKey にする
    const gap = baseProject([
      faceXBinding([
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [30], delta: delta(), source: 'manual', locked: false },
      ]),
    ]);
    expect(keyEditor.transformEdit(gap, editorAt({ FaceAngleX: 15 }), ['hair', 'face'], { dRotation: 3 })).toBe(
      'needsKey',
    );
  });

  it('コマンドは純粋（同じ入力に同じ結果、入力を書き換えない）', () => {
    const project = baseProject();
    const cmd = command(keyEditor.transformEdit(project, editorAt({ FaceAngleX: 30 }), ['face'], { dRotation: 3 }));
    expect(cmd.apply(project)).toEqual(cmd.apply(project));
  });
});

describe('キーの無い値と addKeyAtCurrentValue', () => {
  const keys: Binding['keys'] = [
    { coords: [-30], delta: delta({ position: { x: -20, y: 0 } }), source: 'manual', locked: false },
    { coords: [0], delta: delta(), source: 'auto', locked: false },
    {
      coords: [30],
      delta: delta({ position: { x: 40, y: 8 }, rotation: 10, scale: { x: 1.5, y: 0.5 }, opacity: 0.5 }),
      source: 'manual',
      locked: true,
    },
  ];

  it('キーの無い値では needsKey', () => {
    const project = baseProject([faceXBinding(keys)]);
    expect(keyEditor.transformEdit(project, editorAt({ FaceAngleX: 15 }), ['face'], { dRotation: 1 })).toBe('needsKey');
  });

  it('キーを足すと前後のキーから補間した差分になり、見た目が変わらない', () => {
    const project = baseProject([faceXBinding(keys)]);
    const editor = editorAt({ FaceAngleX: 15 });
    const added = keyEditor.addKeyAtCurrentValue(project, editor, { partId: 'face' }).apply(project);
    const b = added.model.bindings[0]!;
    expect(b.keyValues).toEqual([[-30, 0, 15, 30]]);
    expect(b.keys.map((k) => k.coords[0])).toEqual([-30, 0, 15, 30]);
    expect(b.keys[2]).toEqual({
      coords: [15],
      delta: delta({ position: { x: 20, y: 4 }, rotation: 5, scale: { x: 1.25, y: 0.75 }, opacity: 0.75 }),
      source: 'manual',
      locked: true,
    });
    // 見た目（評価の結果）が全体で変わらない
    const values = samples({ FaceAngleX: range(-30, 30, 2.5) });
    expectSameLook(
      values.map((v) => partLook(project, v)),
      values.map((v) => partLook(added, v)),
    );
    // 足したキーは編集できる
    const edited = command(keyEditor.transformEdit(added, editor, ['face'], { dRotation: 1 })).apply(added);
    expect(edited.model.bindings[0]!.keys[2]!.delta).toMatchObject({ rotation: 6 });
  });

  it('キーの範囲の外に足しても見た目が変わらない（端のキーの差分になる）', () => {
    const project = baseProject([faceXBinding(keys.slice(1))]);
    const added = keyEditor
      .addKeyAtCurrentValue(project, editorAt({ FaceAngleX: -12 }, DETAIL), { partId: 'face' })
      .apply(project);
    const b = added.model.bindings[0]!;
    expect(b.keyValues).toEqual([[-12, 0, 30]]);
    expect(b.keys[0]).toEqual({ coords: [-12], delta: delta(), source: 'manual', locked: false });
    const values = samples({ FaceAngleX: range(-30, 30, 3) });
    expectSameLook(
      values.map((v) => partLook(project, v)),
      values.map((v) => partLook(added, v)),
    );
  });

  it('キーがすでにある値・基準状態・バインディングが無いとき', () => {
    const project = baseProject([faceXBinding(keys)]);
    expect(
      keyEditor.addKeyAtCurrentValue(project, editorAt({ FaceAngleX: 30 }), { partId: 'face' }).apply(project),
    ).toBe(project);
    expect(keyEditor.addKeyAtCurrentValue(project, editorAt({}), { partId: 'face' }).apply(project)).toBe(project);
    // バインディングが無ければ差分 0 のキーで作る（差分 0 なので見た目は変わらない）
    const fresh = keyEditor
      .addKeyAtCurrentValue(project, editorAt({ FaceAngleX: 10 }), { partId: 'hair' })
      .apply(project);
    const b = fresh.model.bindings[1]!;
    expect(b).toMatchObject({ target: { type: 'part', id: 'hair' }, keyValues: [[0, 10]] });
    expect(b.keys).toEqual([
      { coords: [0], delta: delta(), source: 'auto', locked: false },
      { coords: [10], delta: delta(), source: 'manual', locked: true },
    ]);
  });
});

describe('2つのパラメータでの編集', () => {
  const XY = { FaceAngleX: 30, FaceAngleY: -30 };

  it('バインディングを作り、パラメータの並びが逆でも同じバインディングを編集する', () => {
    const project = baseProject();
    const first = command(
      keyEditor.transformEdit(project, editorAt(XY), ['face'], { dPosition: { x: 4, y: 0 } }),
    ).apply(project);
    const b = first.model.bindings[0]!;
    expect(b).toMatchObject({
      parameterIds: ['FaceAngleX', 'FaceAngleY'],
      keyValues: [
        [0, 30],
        [-30, 0],
      ],
    });
    expect(b.keys).toEqual([
      { coords: [0, 0], delta: delta(), source: 'auto', locked: false },
      { coords: [30, -30], delta: delta({ position: { x: 4, y: 0 } }), source: 'manual', locked: true },
    ]);

    const reversed = editorAt({ FaceAngleY: -30, FaceAngleX: 30 });
    expect(reversed.activeParameterIds).toEqual(['FaceAngleY', 'FaceAngleX']);
    const second = command(
      keyEditor.transformEdit(first, reversed, ['face'], { dPosition: { x: 1, y: 2 }, scaleFactor: { x: 2, y: 2 } }),
    ).apply(first);
    expect(second.model.bindings).toHaveLength(1);
    expect(second.model.bindings[0]!.keys[1]!.delta).toEqual(
      delta({ position: { x: 5, y: 2 }, scale: { x: 2, y: 2 } }),
    );
    // 1パラメータのバインディングとは別のもの
    const single = command(
      keyEditor.transformEdit(second, editorAt({ FaceAngleX: 30 }), ['face'], { dRotation: 1 }),
    ).apply(second);
    expect(single.model.bindings.map((x) => x.parameterIds)).toEqual([['FaceAngleX', 'FaceAngleY'], ['FaceAngleX']]);
  });

  it('片方がデフォルト値でも2つの組のバインディングにする', () => {
    const project = baseProject();
    const result = command(
      keyEditor.transformEdit(project, editorAt({ FaceAngleX: 30, FaceAngleY: 0 }), ['face'], { dRotation: 2 }),
    ).apply(project);
    expect(result.model.bindings[0]).toMatchObject({ keyValues: [[0, 30], [0]] });
    expect(result.model.bindings[0]!.keys[1]!.coords).toEqual([30, 0]);
  });

  // 軸の上だけにキーがある格子（(30,30) はキーが無く、各軸の差分の和で代用される）
  const axisBinding = (): Binding => ({
    id: 'b-xy',
    target: { type: 'part', id: 'face' },
    channel: 'transform',
    parameterIds: ['FaceAngleX', 'FaceAngleY'],
    keyValues: [
      [0, 30],
      [0, 30],
    ],
    keys: [
      { coords: [0, 0], delta: delta(), source: 'auto', locked: false },
      { coords: [30, 0], delta: delta({ position: { x: 10, y: 0 }, rotation: 4 }), source: 'manual', locked: false },
      {
        coords: [0, 30],
        delta: delta({ position: { x: 0, y: -10 }, scale: { x: 1.2, y: 1 } }),
        source: 'manual',
        locked: false,
      },
    ],
    generation: 'linear',
    divisions: null,
  });
  const grid = samples({ FaceAngleX: range(-30, 30, 5), FaceAngleY: range(-30, 30, 5) });

  it('格子上の補正キーは確認なしで作り、代用の値（各軸の差分の和）に編集を足す', () => {
    const project = baseProject([axisBinding()]);
    const editor = editorAt({ FaceAngleX: 30, FaceAngleY: 30 });
    const edited = command(keyEditor.transformEdit(project, editor, ['face'], { dRotation: 1 })).apply(project);
    expect(edited.model.bindings[0]!.keys.find((k) => k.coords.join() === '30,30')).toEqual({
      coords: [30, 30],
      delta: delta({ position: { x: 10, y: -10 }, rotation: 5, scale: { x: 1.2, y: 1 } }),
      source: 'manual',
      locked: true,
    });
    for (const values of [
      { FaceAngleX: 0, FaceAngleY: 30 },
      { FaceAngleX: 30, FaceAngleY: 0 },
    ]) {
      expect(partLook(edited, values)).toEqual(partLook(project, values));
    }
    // 明示的にキーを足す操作は従来どおり、補間した見た目を変えない
    const added = keyEditor.addKeyAtCurrentValue(project, editor, { partId: 'face' }).apply(project);
    const b = added.model.bindings[0]!;
    expect(b.keyValues).toEqual([
      [0, 30],
      [0, 30],
    ]);
    expect(b.keys.find((k) => k.coords[0] === 30 && k.coords[1] === 30)).toEqual({
      coords: [30, 30],
      delta: delta({ position: { x: 10, y: -10 }, rotation: 4, scale: { x: 1.2, y: 1 } }),
      source: 'manual',
      locked: true,
    });
    expectSameLook(
      grid.map((v) => partLook(project, v)),
      grid.map((v) => partLook(added, v)),
    );
    expect(keyEditor.transformEdit(added, editor, ['face'], { dRotation: 1 })).not.toBe('needsKey');
  });

  it('格子の線が増えるときも見た目が変わらない（必要な点に補助のキーを足す）', () => {
    const project = baseProject([axisBinding()]);
    // x = 15 の列が増える。(15, 0) は代用だと 0 になってしまうので補助のキーが要る
    const editor = editorAt({ FaceAngleX: 15, FaceAngleY: 30 }, DETAIL);
    expect(keyEditor.transformEdit(project, editor, ['face'], { dRotation: 1 })).toBe('needsKey');
    const added = keyEditor.addKeyAtCurrentValue(project, editor, { partId: 'face' }).apply(project);
    const b = added.model.bindings[0]!;
    expect(b.keyValues).toEqual([
      [0, 15, 30],
      [0, 30],
    ]);
    expect(b.keys.find((k) => k.coords[0] === 15 && k.coords[1] === 30)).toMatchObject({
      source: 'manual',
      locked: false,
    });
    expect(b.keys.find((k) => k.coords[0] === 15 && k.coords[1] === 0)).toEqual({
      coords: [15, 0],
      delta: delta({ position: { x: 5, y: 0 }, rotation: 2 }),
      source: 'auto',
      locked: false,
    });
    expectSameLook(
      grid.map((v) => partLook(project, v)),
      grid.map((v) => partLook(added, v)),
    );

    // 両方の軸に線が増える場合
    const both = keyEditor
      .addKeyAtCurrentValue(project, editorAt({ FaceAngleX: 20, FaceAngleY: 10 }), { partId: 'face' })
      .apply(project);
    expect(both.model.bindings[0]!.keyValues).toEqual([
      [0, 20, 30],
      [0, 10, 30],
    ]);
    expectSameLook(
      grid.map((v) => partLook(project, v)),
      grid.map((v) => partLook(both, v)),
    );
    const edited = command(
      keyEditor.transformEdit(both, editorAt({ FaceAngleX: 20, FaceAngleY: 10 }), ['face'], { dRotation: 1 }),
    ).apply(both);
    expect(edited.model.bindings[0]!.keys.find((k) => k.coords[0] === 20 && k.coords[1] === 10)!.source).toBe('manual');
  });

  it('別対象の単独キーで増えた格子の列でも、他のマスを保ちながら補正を足す（順は逆でもよい）', () => {
    const global = faceXBinding(
      [
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [15], delta: delta(), source: 'manual', locked: false },
      ],
      { id: 'b-hair', target: { type: 'part', id: 'hair' } },
    );
    const project = baseProject([axisBinding(), global]);
    const state = editorAt({ FaceAngleY: 30, FaceAngleX: 15 }, DETAIL);
    const out = command(keyEditor.transformEdit(project, state, ['face'], { dRotation: 1 })).apply(project);
    const b = out.model.bindings[0]!;
    expect(b.keys.find((k) => k.coords.join() === '15,30')).toMatchObject({
      source: 'manual',
      locked: false,
      delta: delta({ position: { x: 5, y: -10 }, rotation: 3, scale: { x: 1.2, y: 1 } }),
    });
    expect(b.keys.find((k) => k.coords.join() === '15,0')).toMatchObject({
      source: 'auto',
      delta: delta({ position: { x: 5, y: 0 }, rotation: 2 }),
    });
    expect(out.model.bindings[1]).toBe(global);
    for (const values of [
      { FaceAngleX: 0, FaceAngleY: 30 },
      { FaceAngleX: 30, FaceAngleY: 30 },
      { FaceAngleX: 15, FaceAngleY: 0 },
    ]) {
      expect(partLook(out, values)).toEqual(partLook(project, values));
    }
    expect(command(keyEditor.transformEdit(project, state, ['face'], { dRotation: 1 })).apply(project)).toEqual(out);
  });
});
