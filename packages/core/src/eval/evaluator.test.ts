import type { Binding, Parameter, Part, TransformDelta } from '@app/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator, parameterValue } from './evaluator';
import { delta, gridWarp, lineMesh, pointsBinding, shift, testModel, transformBinding } from './testModel';

afterEach(() => {
  vi.restoreAllMocks();
});

function expectDelta(actual: TransformDelta | undefined, expected: TransformDelta) {
  expect(actual).toBeDefined();
  expect(actual!.position.x).toBeCloseTo(expected.position.x, 5);
  expect(actual!.position.y).toBeCloseTo(expected.position.y, 5);
  expect(actual!.rotation).toBeCloseTo(expected.rotation, 5);
  expect(actual!.scale.x).toBeCloseTo(expected.scale.x, 5);
  expect(actual!.scale.y).toBeCloseTo(expected.scale.y, 5);
  // transform の opacity は使わない（1 のまま）。パーツの不透明度は opacities に出す（I-026）
  expect(actual!.opacity).toBe(1);
}

function evalOne(binding: Binding, params: Record<string, number>, patch = {}) {
  return createBindingEvaluator().evaluate(testModel({ bindings: [binding], ...patch }), params);
}

describe('parameterValue', () => {
  const p: Parameter = { id: 'P', name: 'P', groupId: 'other', min: -1, max: 2, default: 0.5, standard: false };

  it('params に無ければデフォルト値、範囲外は min..max に丸める', () => {
    expect(parameterValue(p, {})).toBe(0.5);
    expect(parameterValue(p, { P: 1.5 })).toBe(1.5);
    expect(parameterValue(p, { P: 10 })).toBe(2);
    expect(parameterValue(p, { P: -10 })).toBe(-1);
  });

  it('数でない値と、継承したプロパティはデフォルト値として扱う', () => {
    expect(parameterValue(p, { P: Number.NaN })).toBe(0.5);
    expect(parameterValue({ ...p, id: 'toString' }, {})).toBe(0.5);
  });
});

describe('createBindingEvaluator: 1パラメータ', () => {
  const b = transformBinding(
    'b',
    'part',
    ['FaceAngleX'],
    [[-10, 0, 10]],
    [
      [[-10], delta({ px: -20, rot: -10, sx: 0.5, op: 0.5 })],
      [[0], delta()],
      [[10], delta({ px: 40, py: 10, rot: 20, sx: 2, sy: 1.5, op: 0 })],
    ],
  );

  it('キーの間を成分ごとに線形補間する（拡縮は倍率のまま）', () => {
    expectDelta(
      evalOne(b, { FaceAngleX: 5 }).transforms.part,
      delta({ px: 20, py: 5, rot: 10, sx: 1.5, sy: 1.25, op: 0.5 }),
    );
    expectDelta(evalOne(b, { FaceAngleX: -2.5 }).transforms.part, delta({ px: -5, rot: -2.5, sx: 0.875, op: 0.875 }));
  });

  it('キーの上ではそのキーの差分になる', () => {
    expectDelta(
      evalOne(b, { FaceAngleX: 10 }).transforms.part,
      delta({ px: 40, py: 10, rot: 20, sx: 2, sy: 1.5, op: 0 }),
    );
    expectDelta(evalOne(b, { FaceAngleX: 0 }).transforms.part, delta());
  });

  it('キーの範囲外は端のキー（パラメータの範囲外は丸めてから）', () => {
    expectDelta(
      evalOne(b, { FaceAngleX: 25 }).transforms.part,
      delta({ px: 40, py: 10, rot: 20, sx: 2, sy: 1.5, op: 0 }),
    );
    expectDelta(evalOne(b, { FaceAngleX: -999 }).transforms.part, delta({ px: -20, rot: -10, sx: 0.5, op: 0.5 }));
  });

  it('params に無いパラメータはデフォルト値で評価する', () => {
    // EyeOpenL のデフォルトは 1
    const eye = pointsBinding(
      'e',
      { type: 'mesh', id: 'm' },
      ['EyeOpenL'],
      [[0, 1]],
      [
        [[0], shift(2, 0, 8)],
        [[1], shift(2, 0, 0)],
      ],
    );
    const model = testModel({ meshes: [lineMesh('m', 2)], bindings: [eye] });
    const evaluator = createBindingEvaluator();
    expect([...evaluator.evaluate(model, {}).vertices.m!]).toEqual([0, 0, 0, 0]);
    expect([...evaluator.evaluate(model, { EyeOpenL: 0.25 }).vertices.m!]).toEqual([0, 6, 0, 6]);
  });

  it('キーが1つならどの値でもその差分', () => {
    const single = transformBinding('s', 'part', ['FaceAngleX'], [[0]], [[[0], delta({ px: 3, rot: 4 })]]);
    for (const v of [-30, 0, 12, 30]) {
      expectDelta(evalOne(single, { FaceAngleX: v }).transforms.part, delta({ px: 3, rot: 4 }));
    }
    // keyValues にキーの無い位置があっても、キーのある位置だけで補間する
    const sparse = transformBinding('s2', 'part', ['FaceAngleX'], [[0, 30]], [[[30], delta({ py: 7 })]]);
    for (const v of [-30, 0, 30]) expectDelta(evalOne(sparse, { FaceAngleX: v }).transforms.part, delta({ py: 7 }));
  });

  it('keyValues が昇順でなくても並べ直して使う', () => {
    const unsorted = transformBinding(
      'u',
      'part',
      ['FaceAngleX'],
      [[30, 0]],
      [
        [[30], delta({ px: 30 })],
        [[0], delta()],
      ],
    );
    expectDelta(evalOne(unsorted, { FaceAngleX: 15 }).transforms.part, delta({ px: 15 }));
  });

  it('頂点の差分も要素ごとに補間する', () => {
    const v = pointsBinding(
      'v',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(3, 0, 0)],
        [
          [30],
          [
            { x: 3, y: -6 },
            { x: 0, y: 0 },
            { x: -9, y: 12 },
          ],
        ],
      ],
    );
    const out = evalOne(v, { FaceAngleX: 10 }, { meshes: [lineMesh('m', 3)] });
    expect([...out.vertices.m!].map((x) => +x.toFixed(5))).toEqual([1, -2, 0, 0, -3, 4]);
  });
});

describe('createBindingEvaluator: 2パラメータ', () => {
  const full = transformBinding(
    'g',
    'part',
    ['FaceAngleX', 'FaceAngleY'],
    [
      [0, 30],
      [0, 30],
    ],
    [
      [[0, 0], delta()],
      [[30, 0], delta({ px: 10 })],
      [[0, 30], delta({ py: 20 })],
      [[30, 30], delta({ px: 40, py: 40, rot: 8, sx: 3, op: 0.2 })],
    ],
  );

  it('格子の双線形補間', () => {
    // (15, 15): 4つの角の平均
    expectDelta(
      evalOne(full, { FaceAngleX: 15, FaceAngleY: 15 }).transforms.part,
      delta({ px: 12.5, py: 15, rot: 2, sx: 1.5, op: 0.8 }),
    );
    // (30, 15): 右の辺の中点
    expectDelta(
      evalOne(full, { FaceAngleX: 30, FaceAngleY: 15 }).transforms.part,
      delta({ px: 25, py: 20, rot: 4, sx: 2, op: 0.6 }),
    );
    // (7.5, 0): 下の辺（y はデフォルト値）
    expectDelta(evalOne(full, { FaceAngleX: 7.5 }).transforms.part, delta({ px: 2.5 }));
  });

  it('範囲外は格子の端に丸める', () => {
    expectDelta(evalOne(full, { FaceAngleX: -30, FaceAngleY: 30 }).transforms.part, delta({ py: 20 }));
  });

  it('格子に無い組み合わせは各軸の差分の和で代用する', () => {
    // (30, 30) が無い → (30, 0) + (0, 30)。拡縮・不透明度は掛ける
    const partial = transformBinding(
      'p',
      'part',
      ['FaceAngleX', 'FaceAngleY'],
      [
        [0, 30],
        [0, 30],
      ],
      [
        [[0, 0], delta()],
        [[30, 0], delta({ px: 10, rot: 5, sx: 2, op: 0.5 })],
        [[0, 30], delta({ py: 20, rot: 1, sx: 1.5, sy: 3, op: 0.5 })],
      ],
    );
    expectDelta(
      evalOne(partial, { FaceAngleX: 30, FaceAngleY: 30 }).transforms.part,
      delta({ px: 10, py: 20, rot: 6, sx: 3, sy: 3, op: 0.25 }),
    );
    // (15, 15) は 4つの角（代用した点を含む）の平均
    expectDelta(
      evalOne(partial, { FaceAngleX: 15, FaceAngleY: 15 }).transforms.part,
      delta({
        px: 5,
        py: 10,
        rot: 3,
        sx: (1 + 2 + 1.5 + 3) / 4,
        sy: (1 + 1 + 3 + 3) / 4,
        op: (1 + 0.5 + 0.5 + 0.25) / 4,
      }),
    );
  });

  it('代用する軸のキーがどちらも無ければ 0（変化なし）', () => {
    // (30, 30) だけがある。(30, 0) と (0, 30) と (0, 0) は 0
    const corner = pointsBinding(
      'c',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX', 'FaceAngleY'],
      [
        [0, 30],
        [0, 30],
      ],
      [[[30, 30], shift(2, 8, -4)]],
    );
    const model = testModel({ meshes: [lineMesh('m', 2)], bindings: [corner] });
    const evaluator = createBindingEvaluator();
    expect([...evaluator.evaluate(model, { FaceAngleX: 30 }).vertices.m!]).toEqual([0, 0, 0, 0]);
    expect([...evaluator.evaluate(model, { FaceAngleY: 30 }).vertices.m!]).toEqual([0, 0, 0, 0]);
    expect([...evaluator.evaluate(model, { FaceAngleX: 15, FaceAngleY: 15 }).vertices.m!]).toEqual([2, -1, 2, -1]);
    expect([...evaluator.evaluate(model, { FaceAngleX: 30, FaceAngleY: 30 }).vertices.m!]).toEqual([8, -4, 8, -4]);
  });

  it('頂点の格子でも代用する（3×3 で一部だけキーがある）', () => {
    const b = pointsBinding(
      'v',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX', 'FaceAngleY'],
      [
        [-30, 0, 30],
        [-30, 0, 30],
      ],
      [
        [[-30, 0], shift(1, -6, 0)],
        [[30, 0], shift(1, 6, 0)],
        [[0, -30], shift(1, 0, 4)],
        [[0, 30], shift(1, 0, -4)],
      ],
    );
    const model = testModel({ meshes: [lineMesh('m', 1)], bindings: [b] });
    const evaluator = createBindingEvaluator();
    expect([...evaluator.evaluate(model, { FaceAngleX: 30, FaceAngleY: 30 }).vertices.m!]).toEqual([6, -4]);
    expect([...evaluator.evaluate(model, { FaceAngleX: -30, FaceAngleY: 30 }).vertices.m!]).toEqual([-6, -4]);
    expect([...evaluator.evaluate(model, { FaceAngleX: 15, FaceAngleY: -15 }).vertices.m!]).toEqual([3, 2]);
    expect([...evaluator.evaluate(model, {}).vertices.m!]).toEqual([0, 0]);
  });

  it('重みの積が 0 に潰れても（角が3つでも）正しく足す', () => {
    const b = pointsBinding(
      'tiny',
      { type: 'mesh', id: 'm' },
      ['P', 'Q'],
      [
        [0, 1],
        [0, 1],
      ],
      [
        [[0, 0], shift(1, 2, 3)],
        [[1, 0], shift(1, 2, 3)],
        [[0, 1], shift(1, 2, 3)],
        [[1, 1], shift(1, 2, 3)],
      ],
    );
    const param = (id: string): Parameter => ({
      id,
      name: id,
      groupId: 'other',
      min: 0,
      max: 1,
      default: 0,
      standard: false,
    });
    const model = testModel({ meshes: [lineMesh('m', 1)], bindings: [b], parameters: [param('P'), param('Q')] });
    // tx・ty が小さすぎて tx × ty が 0 になる
    expect([...createBindingEvaluator().evaluate(model, { P: 1e-200, Q: 1e-200 }).vertices.m!]).toEqual([2, 3]);
  });

  it('パラメータのデフォルト値が変わったら代用をやり直す', () => {
    const b = pointsBinding(
      'd',
      { type: 'mesh', id: 'm' },
      ['P', 'Q'],
      [
        [0, 1],
        [0, 1],
      ],
      [
        [[1, 0], shift(1, 1, 0)],
        [[0, 1], shift(1, 0, 1)],
        [[1, 1], shift(1, 5, 5)],
      ],
    );
    const p = (def: number): Parameter => ({
      id: 'P',
      name: 'P',
      groupId: 'other',
      min: 0,
      max: 1,
      default: def,
      standard: false,
    });
    const q: Parameter = { id: 'Q', name: 'Q', groupId: 'other', min: 0, max: 1, default: 0, standard: false };
    const evaluator = createBindingEvaluator();
    const base = testModel({ meshes: [lineMesh('m', 1)], bindings: [b], parameters: [p(0), q] });
    // (0, 0) が無い。x0 = 0 なら (0, 0) = (0, 0) + (0, 0) → 0
    expect([...evaluator.evaluate(base, { P: 0, Q: 0 }).vertices.m!]).toEqual([0, 0]);
    // x0 = 1 なら (0, 0) = (0, y0=0) + (x0=1, 0) → (1, 0)
    const moved = { ...base, parameters: [p(1), q] };
    expect([...evaluator.evaluate(moved, { P: 0, Q: 0 }).vertices.m!]).toEqual([1, 0]);
  });
});

describe('createBindingEvaluator: 不透明度（絶対値のキー。I-026）', () => {
  const part = (id: string, opacity: number): Part => ({
    id,
    name: id,
    kind: 'group',
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  });
  const opacityBinding = (id: string, ids: string[], keyValues: number[][], keys: [number[], number][]): Binding => ({
    ...transformBinding(
      id,
      'p',
      ids,
      keyValues,
      keys.map(([coords, op]) => [coords, delta({ op })]),
    ),
    controlsOpacity: true,
  });
  const evalWith = (opacity: number, bindings: Binding[], params: Record<string, number>) =>
    createBindingEvaluator().evaluate(testModel({ parts: [part('p', opacity)], bindings }), params);

  it('キーの値がそのままパーツ自身の不透明度になり、キーの間は線形補間する', () => {
    const b = opacityBinding(
      'b',
      ['FaceAngleX'],
      [[-10, 0, 10]],
      [
        [[-10], 0],
        [[0], 0.5],
        [[10], 1],
      ],
    );
    expect(evalWith(0.5, [b], { FaceAngleX: 10 }).opacities?.p).toBeCloseTo(1);
    expect(evalWith(0.5, [b], { FaceAngleX: 5 }).opacities?.p).toBeCloseTo(0.75);
    expect(evalWith(0.5, [b], { FaceAngleX: -10 }).opacities?.p).toBeCloseTo(0);
    expect(evalWith(0.5, [b], { FaceAngleX: 0 }).opacities?.p).toBeCloseTo(0.5);
    // 不透明度のバインディングでなければ、キーの opacity は使わない
    const plain = { ...b, controlsOpacity: undefined };
    expect(evalWith(0.5, [plain], { FaceAngleX: 10 }).opacities).toBeUndefined();
  });

  it('基準の不透明度が 0 でも、キーで見せられる（頬染め）', () => {
    const cheek = opacityBinding(
      'c',
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], 0],
        [[30], 1],
      ],
    );
    expect(evalWith(0, [cheek], { FaceAngleX: 30 }).opacities?.p).toBeCloseTo(1);
    expect(evalWith(0, [cheek], { FaceAngleX: 15 }).opacities?.p).toBeCloseTo(0.5);
    expect(evalWith(0, [cheek], {}).opacities?.p).toBe(0);
  });

  it('同じパーツの複数のバインディングは、デフォルト値からの変化を足す（0..1 に収める）', () => {
    const a = opacityBinding(
      'a',
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], 0.8],
        [[30], 0.2],
      ],
    );
    const b = opacityBinding(
      'b',
      ['FaceAngleY'],
      [[0, 30]],
      [
        [[0], 0.8],
        [[30], 1],
      ],
    );
    expect(evalWith(0.8, [a, b], { FaceAngleX: 30, FaceAngleY: 30 }).opacities?.p).toBeCloseTo(0.8 - 0.6 + 0.2);
    expect(evalWith(0.8, [a, b], { FaceAngleY: 30 }).opacities?.p).toBeCloseTo(1);
    const c = opacityBinding(
      'c',
      ['FaceAngleZ'],
      [[0, 30]],
      [
        [[0], 0.8],
        [[30], 0],
      ],
    );
    expect(evalWith(0.8, [a, c], { FaceAngleX: 30, FaceAngleZ: 30 }).opacities?.p).toBe(0);
  });

  it('デフォルト値では Part.opacity（デフォルト値のキーが違っていても）', () => {
    const b = opacityBinding(
      'b',
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], 0.3],
        [[30], 0.6],
      ],
    );
    expect(evalWith(0.5, [b], {}).opacities?.p).toBeCloseTo(0.5);
    expect(evalWith(0.5, [b], { FaceAngleX: 30 }).opacities?.p).toBeCloseTo(0.8); // 0.5 + (0.6 − 0.3)
  });

  it('2パラメータの格子に無い組み合わせは (x, y0) + (x0, y) − (x0, y0) で代用する', () => {
    const b = opacityBinding(
      'b',
      ['FaceAngleX', 'FaceAngleY'],
      [
        [0, 30],
        [0, 30],
      ],
      [
        [[0, 0], 0.5],
        [[30, 0], 1],
        [[0, 30], 0.2],
      ],
    );
    expect(evalWith(0.5, [b], { FaceAngleX: 30, FaceAngleY: 30 }).opacities?.p).toBeCloseTo(0.7);
    expect(evalWith(0.5, [b], { FaceAngleX: 30 }).opacities?.p).toBeCloseTo(1);
  });
});

describe('createBindingEvaluator: 合成', () => {
  it('同じパーツの transform は位置・回転を加算、拡縮を乗算する', () => {
    const a = transformBinding(
      'a',
      'part',
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], delta()],
        [[30], delta({ px: 10, py: 2, rot: 15, sx: 2, sy: 0.5, op: 0.5 })],
      ],
    );
    const b = transformBinding(
      'b',
      'part',
      ['FaceAngleY'],
      [[0, 30]],
      [
        [[0], delta()],
        [[30], delta({ px: -4, py: 3, rot: 5, sx: 1.5, sy: 4, op: 0.8 })],
      ],
    );
    const other = transformBinding(
      'o',
      'other',
      ['FaceAngleY'],
      [[0, 30]],
      [
        [[0], delta()],
        [[30], delta({ px: 1 })],
      ],
    );
    const out = createBindingEvaluator().evaluate(testModel({ bindings: [a, b, other] }), {
      FaceAngleX: 30,
      FaceAngleY: 30,
    });
    expectDelta(out.transforms.part, delta({ px: 6, py: 5, rot: 20, sx: 3, sy: 2, op: 0.4 }));
    expectDelta(out.transforms.other, delta({ px: 1 }));
  });

  it('同じメッシュの頂点の差分は加算する', () => {
    const mk = (id: string, param: string, x: number) =>
      pointsBinding(
        id,
        { type: 'mesh', id: 'm' },
        [param],
        [[0, 30]],
        [
          [[0], shift(2, 0, 0)],
          [[30], shift(2, x, 1)],
        ],
      );
    const model = testModel({
      meshes: [lineMesh('m', 2), lineMesh('n', 2)],
      bindings: [mk('a', 'FaceAngleX', 2), mk('b', 'FaceAngleY', 10)],
    });
    const out = createBindingEvaluator().evaluate(model, { FaceAngleX: 30, FaceAngleY: 15 });
    expect([...out.vertices.m!]).toEqual([7, 1.5, 7, 1.5]);
    expect(out.vertices.n).toBeUndefined();
  });

  it('ワープの制御点の差分も加算する（メッシュとは別の場所に入る）', () => {
    const warp = gridWarp('w', 'group', 1, 1);
    const b = pointsBinding(
      'w1',
      { type: 'warp', id: 'w' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(4, 0, 0)],
        [[30], shift(4, 2, 0)],
      ],
    );
    const c = pointsBinding(
      'w2',
      { type: 'warp', id: 'w' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(4, 0, 0)],
        [[30], shift(4, 0, 2)],
      ],
    );
    const out = createBindingEvaluator().evaluate(testModel({ warps: [warp], bindings: [b, c] }), { FaceAngleX: 30 });
    expect([...out.warpPoints.w!]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(out.vertices).toEqual({});
  });

  it('バインディングが無い対象は結果に含めない', () => {
    expect(createBindingEvaluator().evaluate(testModel(), {})).toEqual({
      transforms: {},
      vertices: {},
      warpPoints: {},
    });
  });
});

describe('createBindingEvaluator: 無視するバインディング', () => {
  it('差分の長さが頂点数と違うバインディングは無視して console.warn（例外にしない）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = pointsBinding(
      'ok',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(3, 0, 0)],
        [[30], shift(3, 1, 1)],
      ],
    );
    const bad = pointsBinding(
      'bad',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(2, 0, 0)],
        [[30], shift(2, 9, 9)],
      ],
    );
    const model = testModel({ meshes: [lineMesh('m', 3)], bindings: [ok, bad] });
    const evaluator = createBindingEvaluator();
    const out = evaluator.evaluate(model, { FaceAngleX: 30 });
    expect([...out.vertices.m!]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('bad');
    // 毎フレーム呼ばれるので、同じ警告は2回目から出さない
    evaluator.evaluate(model, { FaceAngleX: 10 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('キーごとに長さがそろっていない・ワープの制御点数と違うものも無視する', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const uneven = pointsBinding(
      'uneven',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(2, 0, 0)],
        [[30], shift(3, 1, 1)],
      ],
    );
    const warpBad = pointsBinding(
      'warpBad',
      { type: 'warp', id: 'w' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(3, 0, 0)],
        [[30], shift(3, 1, 1)],
      ],
    );
    const out = createBindingEvaluator().evaluate(
      testModel({ meshes: [lineMesh('m', 2)], warps: [gridWarp('w', 'g', 1, 1)], bindings: [uneven, warpBad] }),
      { FaceAngleX: 30 },
    );
    expect(out).toEqual({ transforms: {}, vertices: {}, warpPoints: {} });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('対象が無い・チャンネルと対象の種類が合わない・知らないパラメータは無視して console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noMesh = pointsBinding(
      'noMesh',
      { type: 'mesh', id: 'missing' },
      ['FaceAngleX'],
      [[0]],
      [[[0], shift(1, 1, 1)]],
    );
    const mismatch: Binding = {
      ...transformBinding('mismatch', 'p', ['FaceAngleX'], [[0]], [[[0], delta({ px: 1 })]]),
      target: { type: 'mesh', id: 'm' },
    };
    const unknown = transformBinding('unknown', 'p', ['NoSuchParam'], [[0]], [[[0], delta({ px: 1 })]]);
    const out = createBindingEvaluator().evaluate(
      testModel({ meshes: [lineMesh('m', 1)], bindings: [noMesh, mismatch, unknown] }),
      {},
    );
    expect(out).toEqual({ transforms: {}, vertices: {}, warpPoints: {} });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('1つのバインディングに警告が2つあっても、毎フレームは出さない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 格子に乗らないキー（警告して続ける）と、頂点数の違い（警告して無視）
    const b = pointsBinding(
      'both',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX'],
      [[0]],
      [
        [[0], shift(2, 1, 1)],
        [[5], shift(2, 1, 1)],
      ],
    );
    const model = testModel({ meshes: [lineMesh('m', 3)], bindings: [b] });
    const evaluator = createBindingEvaluator();
    for (let i = 0; i < 3; i++) evaluator.evaluate(model, {});
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('パラメータが 0個・3個のバインディングは無視して console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const none = transformBinding('none', 'p', [], [], [[[], delta({ px: 1 })]]);
    const three = transformBinding(
      'three',
      'p',
      ['FaceAngleX', 'FaceAngleY', 'FaceAngleZ'],
      [[0], [0], [0]],
      [[[0, 0, 0], delta({ px: 1 })]],
    );
    const out = createBindingEvaluator().evaluate(testModel({ bindings: [none, three] }), {});
    expect(out.transforms).toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('格子に乗らないキーは無視して console.warn し、残りのキーで評価する', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = transformBinding(
      'off',
      'p',
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], delta()],
        [[30], delta({ px: 30 })],
        [[15], delta({ px: 999 })],
      ],
    );
    expectDelta(evalOne(b, { FaceAngleX: 15 }).transforms.p, delta({ px: 15 }));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('createBindingEvaluator: 入力を書き換えない', () => {
  it('モデルと params はそのまま', () => {
    const b = pointsBinding(
      'v',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX', 'FaceAngleY'],
      [
        [0, 30],
        [0, 30],
      ],
      [
        [[30, 0], shift(2, 1, 0)],
        [[0, 30], shift(2, 0, 1)],
      ],
    );
    const t = transformBinding('t', 'p', ['FaceAngleX'], [[0, 30]], [[[30], delta({ px: 1, sx: 2 })]]);
    const model = testModel({ meshes: [lineMesh('m', 2)], bindings: [b, t] });
    const params = { FaceAngleX: 99, FaceAngleY: 10 };
    const before = structuredClone({ model, params });
    const evaluator = createBindingEvaluator();
    evaluator.evaluate(model, params);
    evaluator.evaluate(model, params);
    expect({ model, params }).toEqual(before);
  });

  it('結果は呼ぶたびに新しいオブジェクト', () => {
    const b = pointsBinding(
      'v',
      { type: 'mesh', id: 'm' },
      ['FaceAngleX'],
      [[0, 30]],
      [
        [[0], shift(1, 0, 0)],
        [[30], shift(1, 3, 0)],
      ],
    );
    const model = testModel({ meshes: [lineMesh('m', 1)], bindings: [b] });
    const evaluator = createBindingEvaluator();
    const first = evaluator.evaluate(model, { FaceAngleX: 30 });
    const second = evaluator.evaluate(model, { FaceAngleX: 0 });
    expect([...first.vertices.m!]).toEqual([3, 0]);
    expect([...second.vertices.m!]).toEqual([0, 0]);
  });
});
