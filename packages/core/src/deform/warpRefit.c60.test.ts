// カード60（ワープの導線と範囲・I-009）のテスト。テストの担当は CL（実装の担当は CO）
// 格子の範囲を合わせ直す前と後のモデルを、本物の評価（createBindingEvaluator）と変形パイプライン
// （createDeformPipeline）に通し、キーの値・キーの間・範囲の外の値で、すべての画像パーツの頂点の差が 0.01px 以内かを比べる。
// 比べる意味があるように、ワープが実際に頂点を動かしていること・キーごとに形が違うことも確かめる
import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  type Binding,
  type Mesh,
  type Model,
  type ParameterKey,
  type Part,
  type TransformDelta,
  type Vec2,
  type Warp,
} from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import {
  createBindingEvaluator,
  createDeformPipeline,
  pointsToAncestorSpace,
  refitWarp,
  regularWarpPoints,
} from '../index';

const TOLERANCE = 0.01; // px
const evaluator = createBindingEvaluator();
const pipeline = createDeformPipeline();
const NO_DELTAS: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };

// ---- モデルの部品 ----

function part(id: string, kind: 'image' | 'group', patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind,
    standardType: null,
    assetId: kind === 'image' ? `asset-${id}` : null,
    meshId: kind === 'image' ? `mesh-${id}` : null,
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

// (x0, y0)〜(x1, y1) に step ごとに並べた頂点と、extra の頂点のメッシュ（三角形は使わない）
function gridMesh(id: string, x0: number, y0: number, x1: number, y1: number, step: number, extra: Vec2[] = []): Mesh {
  const vertices: Vec2[] = [];
  for (let y = y0; y <= y1 + 1e-9; y += step) for (let x = x0; x <= x1 + 1e-9; x += step) vertices.push({ x, y });
  vertices.push(...extra);
  return {
    id,
    vertices,
    uvs: vertices.map(() => ({ x: 0, y: 0 })),
    triangles: [],
    density: 'custom',
    edited: false,
  };
}

// 基準の制御点を手で動かした（規則的でない）格子
function editedWarp(
  id: string,
  partId: string,
  bounds: Warp['bounds'],
  columns: number,
  rows: number,
  seed: number,
): Warp {
  const points = regularWarpPoints(bounds, columns, rows).map((p, k) => ({
    x: p.x + 9 * Math.sin(seed + 1.3 * k),
    y: p.y + 6 * Math.cos(seed + 0.7 * k),
  }));
  return { id, partId, columns, rows, bounds, points };
}

// 制御点ごとに違う差分
function wave(n: number, ax: number, ay: number, phase: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({
    x: ax * Math.sin(phase + i * 1.1),
    y: ay * Math.cos(phase + i * 0.6),
  }));
}
const zeros = (n: number): Vec2[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));

function key(
  coords: number[],
  delta: Vec2[] | TransformDelta,
  source: ParameterKey['source'] = 'manual',
  locked = false,
): ParameterKey {
  return { coords, delta, source, locked };
}

function warpBinding(
  id: string,
  warpId: string,
  parameterIds: string[],
  keyValues: number[][],
  keys: ParameterKey[],
): Binding {
  return {
    id,
    target: { type: 'warp', id: warpId },
    channel: 'warpPoints',
    parameterIds,
    keyValues,
    keys,
    generation: 'linear',
    divisions: null,
  };
}

function transformBinding(id: string, partId: string, parameterId: string, keys: [number, TransformDelta][]): Binding {
  return {
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [keys.map(([v]) => v)],
    keys: keys.map(([v, d]) => key([v], d)),
    generation: 'linear',
    divisions: null,
  };
}

const td = (px: number, py: number, rotation: number, sx: number, sy: number): TransformDelta => ({
  position: { x: px, y: py },
  rotation,
  scale: { x: sx, y: sy },
  opacity: 1,
});

function modelOf(patch: Partial<Model>): Model {
  return { ...createEmptyProject('カード60').model, ...patch };
}

// ---- 頂点を比べる ----

type Positions = Map<string, Float32Array>;

function positionsOf(model: Model, params: Record<string, number>): Positions {
  const out = pipeline.deform(model, evaluator.evaluate(model, params));
  return new Map(Object.entries(out.byPartId).map(([id, item]) => [id, item.positions]));
}

// ワープを外したモデル（評価はワープ付きのモデルで行い、差分はそのまま使う）
function positionsWithoutWarps(model: Model, params: Record<string, number>, warpIds: string[]): Positions {
  const deltas = evaluator.evaluate(model, params);
  const out = pipeline.deform({ ...model, warps: model.warps.filter((w) => !warpIds.includes(w.id)) }, deltas);
  return new Map(Object.entries(out.byPartId).map(([id, item]) => [id, item.positions]));
}

function vertexCount(p: Positions): number {
  let n = 0;
  for (const v of p.values()) n += v.length / 2;
  return n;
}

function maxDiff(a: Positions, b: Positions): number {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  let max = 0;
  for (const [id, pa] of a) {
    const pb = b.get(id)!;
    expect(pb.length).toBe(pa.length);
    for (let k = 0; k < pa.length; k++) max = Math.max(max, Math.abs(pa[k]! - pb[k]!));
  }
  return max;
}

// params のすべての組み合わせで、合わせ直す前と後の頂点を比べる。ワープを外した形とは違うことも確かめる
function expectSameAppearance(
  before: Model,
  after: Model,
  axes: Record<string, number[]>,
  warpIds: string[],
  minDeform = 1,
) {
  const ids = Object.keys(axes);
  const combos = ids.reduce<Record<string, number>[]>(
    (acc, id) => acc.flatMap((c) => axes[id]!.map((v) => ({ ...c, [id]: v }))),
    [{}],
  );
  expect(combos.length).toBe(ids.reduce((n, id) => n * axes[id]!.length, 1));
  for (const params of combos) {
    const label = JSON.stringify(params);
    const b = positionsOf(before, params);
    const a = positionsOf(after, params);
    expect(vertexCount(b), label).toBeGreaterThan(0);
    expect(maxDiff(a, b), label).toBeLessThan(TOLERANCE);
    // ワープが頂点を実際に動かしている（差が 0 になるのは当たり前、ではない）
    expect(maxDiff(b, positionsWithoutWarps(before, params, warpIds)), label).toBeGreaterThan(minDeform);
  }
}

// 境界が元の格子の線の上にある（元のセルの大きさの整数倍だけ外へ広げた）
function expectOnOriginalLines(original: Warp, next: Warp) {
  const dx = original.bounds.width / original.columns;
  const dy = original.bounds.height / original.rows;
  expect(next.bounds.width / next.columns).toBeCloseTo(dx, 9);
  expect(next.bounds.height / next.rows).toBeCloseTo(dy, 9);
  const left = (original.bounds.x - next.bounds.x) / dx;
  const top = (original.bounds.y - next.bounds.y) / dy;
  expect(left).toBeCloseTo(Math.round(left), 9);
  expect(top).toBeCloseTo(Math.round(top), 9);
  return { left: Math.round(left), top: Math.round(top) };
}

function expectContains(outer: Warp['bounds'], inner: Warp['bounds']) {
  expect(outer.x).toBeLessThanOrEqual(inner.x + 1e-9);
  expect(outer.y).toBeLessThanOrEqual(inner.y + 1e-9);
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(inner.x + inner.width - 1e-9);
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(inner.y + inner.height - 1e-9);
}

// ---- 1段のワープ ----

// g（グループ、変形なし）の子 p。格子 3×2（セル 100×100）は 100..400 × 80..280。
// p の頂点は -40..560 × -60..420 に並べ、格子の上下左右と斜めの外側、格子の線の上にも置く
const BOUNDS = { x: 100, y: 80, width: 300, height: 200 };

function singleLevel() {
  const warp = editedWarp('w', 'g', BOUNDS, 3, 2, 0.4);
  const n = warp.points.length;
  const bx = warpBinding(
    'bx',
    'w',
    ['FaceAngleX'],
    [[-30, -10, 0, 30]],
    [
      key([-30], wave(n, 18, 11, 1), 'manual', true),
      key([-10], wave(n, -9, 6, 2.5), 'generated'),
      key([0], zeros(n), 'auto'),
      key([30], wave(n, 25, -14, 4), 'combined'),
    ],
  );
  const onLines = [
    { x: 200, y: 180 },
    { x: 300, y: 80 },
    { x: 400, y: 280 },
    { x: 100, y: 180 },
  ];
  const model = modelOf({
    parts: [part('g', 'group'), part('p', 'image', { parentId: 'g' })],
    meshes: [gridMesh('mesh-p', -40, -60, 560, 420, 40, onLines)],
    warps: [warp],
    bindings: [bx],
    drawOrder: ['p'],
  });
  return { warp, bx, model };
}

describe('カード60: 範囲を合わせ直しても見た目を変えない（1段のワープ）', () => {
  it('上下左右に広げても、すべてのキー・キーの間・範囲外の値で頂点の差が 0.01px 以内', () => {
    const { warp, model } = singleLevel();
    const vertices = model.meshes[0]!.vertices;
    // 元の格子の外（上下左右と斜め）と内側の頂点がある
    const right = BOUNDS.x + BOUNDS.width;
    const bottom = BOUNDS.y + BOUNDS.height;
    expect(vertices.some((v) => v.x < BOUNDS.x && v.y < BOUNDS.y)).toBe(true);
    expect(vertices.some((v) => v.x > right && v.y > bottom)).toBe(true);
    expect(vertices.some((v) => v.x < BOUNDS.x && v.y > bottom)).toBe(true);
    expect(vertices.some((v) => v.x > right && v.y < BOUNDS.y)).toBe(true);
    expect(vertices.some((v) => v.x > BOUNDS.x && v.x < right && v.y > BOUNDS.y && v.y < bottom)).toBe(true);

    const target = { x: -50, y: -70, width: 620, height: 500 };
    const result = refitWarp(warp, target, model.bindings);
    expect(result).not.toBeNull();
    const next = result!.warp;
    // 格子は実際に作り直され、子の範囲と元の格子を囲む
    expect(next).not.toBe(warp);
    expect(next.columns).toBeGreaterThan(warp.columns);
    expect(next.rows).toBeGreaterThan(warp.rows);
    expect(next.points).toHaveLength((next.columns + 1) * (next.rows + 1));
    expectContains(next.bounds, target);
    expectContains(next.bounds, warp.bounds);
    const { left, top } = expectOnOriginalLines(warp, next);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    // 手で動かした元の制御点と、各キーに記録した差分は、新しい格子の同じ位置の制御点にそのまま残る
    const keysBefore = model.bindings[0]!.keys;
    const keysAfter = result!.bindings[0]!.keys;
    expect(keysAfter).toHaveLength(keysBefore.length);
    for (let j = 0; j <= warp.rows; j++)
      for (let i = 0; i <= warp.columns; i++) {
        const from = j * (warp.columns + 1) + i;
        const to = (j + top) * (next.columns + 1) + (i + left);
        expect(next.points[to]!.x).toBeCloseTo(warp.points[from]!.x, 6);
        expect(next.points[to]!.y).toBeCloseTo(warp.points[from]!.y, 6);
        keysBefore.forEach((k, n) => {
          const d0 = (k.delta as Vec2[])[from]!;
          const d1 = (keysAfter[n]!.delta as Vec2[])[to]!;
          expect(d1.x).toBeCloseTo(d0.x, 6);
          expect(d1.y).toBeCloseTo(d0.y, 6);
        });
      }

    const after: Model = { ...model, warps: [next], bindings: result!.bindings };
    // キーの位置（-30, -10, 0, 30）、キーの間、範囲（-30..30）の外
    const values = [-45, -30, -26.5, -20, -10, -3.3, 0, 0.5, 7.5, 15, 22.2, 30, 45];
    expectSameAppearance(model, after, { FaceAngleX: values }, ['w']);

    // キーごとに形が違い、キーの間は両側のキーと違う形になる（補間を通っている）
    const at = (v: number) => positionsOf(model, { FaceAngleX: v });
    expect(maxDiff(at(-30), at(30))).toBeGreaterThan(5);
    expect(maxDiff(at(-20), at(-30))).toBeGreaterThan(1);
    expect(maxDiff(at(-20), at(-10))).toBeGreaterThan(1);
    expect(maxDiff(at(15), at(30))).toBeGreaterThan(1);
  });

  it('2つのパラメータのキー（欠けた組み合わせあり）と、同じワープの複数のバインディングでも変わらない', () => {
    const warp = editedWarp('w', 'g', BOUNDS, 3, 2, 1.7);
    const n = warp.points.length;
    // 顔 左右 × 顔 上下。(-30,30) と (30,30) のキーは無く、評価では包除で代用される
    const xy = warpBinding(
      'xy',
      'w',
      ['FaceAngleX', 'FaceAngleY'],
      [
        [-30, 0, 30],
        [-30, 0, 30],
      ],
      [
        key([0, 0], zeros(n), 'auto'),
        key([-30, 0], wave(n, 15, 8, 0.3)),
        key([30, 0], wave(n, -12, 10, 1.9)),
        key([0, -30], wave(n, 7, -16, 2.2), 'manual', true),
        key([0, 30], wave(n, -6, 13, 3.1)),
        key([-30, -30], wave(n, 20, 4, 4.4), 'combined'),
        key([30, -30], wave(n, -17, -9, 5.6), 'generated'),
      ],
    );
    const mouth = warpBinding(
      'mouth',
      'w',
      ['MouthOpen'],
      [[0, 1]],
      [key([0], zeros(n), 'auto'), key([1], wave(n, 5, 19, 0.8))],
    );
    const model = modelOf({
      parts: [part('g', 'group'), part('p', 'image', { parentId: 'g' })],
      meshes: [gridMesh('mesh-p', 60, 40, 640, 440, 40)],
      warps: [warp],
      bindings: [xy, mouth],
      drawOrder: ['p'],
    });
    // 右と下だけ広げる（左と上は範囲が元の格子の内側なので縮めない）。
    // 左と上の外の頂点（x < 100、y < 80）は、新しい格子でも外へ延ばした式で動く
    const target = { x: 120, y: 100, width: 520, height: 330 };
    const result = refitWarp(warp, target, model.bindings)!;
    expect(result).not.toBeNull();
    expect(result.warp.bounds.x).toBeCloseTo(BOUNDS.x, 9);
    expect(result.warp.bounds.y).toBeCloseTo(BOUNDS.y, 9);
    expectContains(result.warp.bounds, target);
    expect(result.warp.columns).toBeGreaterThan(warp.columns);
    expect(result.warp.rows).toBeGreaterThan(warp.rows);
    expectOnOriginalLines(warp, result.warp);

    const after: Model = { ...model, warps: [result.warp], bindings: result.bindings };
    expectSameAppearance(
      model,
      after,
      { FaceAngleX: [-30, -12, 0, 17, 30], FaceAngleY: [-30, -5, 0, 21, 30], MouthOpen: [0, 0.4, 1] },
      ['w'],
    );
    // 欠けた組み合わせ (30,30) と、口を開けた形は、ほかの点と違う形になっている
    const at = (x: number, y: number, m: number) => positionsOf(model, { FaceAngleX: x, FaceAngleY: y, MouthOpen: m });
    expect(maxDiff(at(30, 30, 0), at(30, 0, 0))).toBeGreaterThan(1);
    expect(maxDiff(at(30, 30, 0), at(0, 30, 0))).toBeGreaterThan(1);
    expect(maxDiff(at(0, 0, 1), at(0, 0, 0))).toBeGreaterThan(1);
  });
});

// ---- 多段のワープ ----

// outer（ワープ Wo、顔 左右のキー）の子に inner（回転・拡縮あり、ワープ Wi、顔 上下のキー）と画像 q。
// inner の子に画像 p（頂点のキーもある）
function nested() {
  const inner = editedWarp('wi', 'inner', { x: 150, y: 100, width: 200, height: 160 }, 2, 2, 2.1);
  const outer = editedWarp('wo', 'outer', { x: 100, y: 50, width: 360, height: 300 }, 3, 3, 3.3);
  const ni = inner.points.length;
  const no = outer.points.length;
  const meshP = gridMesh('mesh-p', 100, 40, 420, 320, 20);
  const model = modelOf({
    parts: [
      part('outer', 'group', { position: { x: 20, y: -10 } }),
      part('inner', 'group', {
        parentId: 'outer',
        rotation: 12,
        scale: { x: 1.1, y: 0.9 },
        pivot: { x: 250, y: 180 },
      }),
      part('p', 'image', { parentId: 'inner' }),
      part('q', 'image', { parentId: 'outer' }),
    ],
    meshes: [meshP, gridMesh('mesh-q', 60, 0, 500, 400, 40)],
    warps: [inner, outer],
    bindings: [
      warpBinding(
        'bi',
        'wi',
        ['FaceAngleY'],
        [[-30, 0, 30]],
        [key([-30], wave(ni, 14, -9, 0.2)), key([0], zeros(ni), 'auto'), key([30], wave(ni, -11, 16, 1.4))],
      ),
      warpBinding(
        'bo',
        'wo',
        ['FaceAngleX'],
        [[-30, 0, 30]],
        [key([-30], wave(no, 21, 7, 2.6)), key([0], zeros(no), 'auto'), key([30], wave(no, -8, -18, 3.9))],
      ),
      {
        id: 'bv',
        target: { type: 'mesh', id: 'mesh-p' },
        channel: 'vertices',
        parameterIds: ['FaceAngleX'],
        keyValues: [[0, 30]],
        keys: [key([0], zeros(meshP.vertices.length), 'auto'), key([30], wave(meshP.vertices.length, 6, 4, 0.5))],
        generation: 'linear',
        divisions: null,
      },
    ],
    drawOrder: ['q', 'p'],
  });
  return { inner, outer, model };
}

const NESTED_AXES = { FaceAngleX: [-30, -13, 0, 8, 30], FaceAngleY: [-30, -21, 0, 4.5, 30] };

describe('カード60: 範囲を合わせ直しても見た目を変えない（多段のワープ）', () => {
  it('内側のワープを合わせ直しても、外側のワープを通した頂点が変わらない', () => {
    const { inner, model } = nested();
    // 内側の格子の外に出ている頂点がある（内側のワープの入力の空間で測る）
    const local = pointsToAncestorSpace(model, NO_DELTAS, 'p', 'inner', model.meshes[0]!.vertices);
    const b = inner.bounds;
    expect(local.some((v) => v.x < b.x || v.x > b.x + b.width || v.y < b.y || v.y > b.y + b.height)).toBe(true);

    const result = refitWarp(inner, { x: 80, y: 20, width: 360, height: 330 }, model.bindings)!;
    expect(result).not.toBeNull();
    expect(result.warp.columns).toBeGreaterThan(inner.columns);
    const after: Model = { ...model, warps: [result.warp, model.warps[1]!], bindings: result.bindings };
    expectSameAppearance(model, after, NESTED_AXES, ['wi']);
    // 外側のワープも頂点を動かしている（2段とも効いている）
    expect(
      maxDiff(positionsOf(model, { FaceAngleX: 30 }), positionsWithoutWarps(model, { FaceAngleX: 30 }, ['wo'])),
    ).toBeGreaterThan(1);
  });

  it('外側のワープを合わせ直しても、内側のワープを通った頂点が変わらない', () => {
    const { outer, model } = nested();
    const result = refitWarp(outer, { x: -20, y: -60, width: 600, height: 520 }, model.bindings)!;
    expect(result).not.toBeNull();
    expect(result.warp.columns).toBeGreaterThan(outer.columns);
    expect(result.warp.rows).toBeGreaterThan(outer.rows);
    const after: Model = { ...model, warps: [model.warps[0]!, result.warp], bindings: result.bindings };
    expectSameAppearance(model, after, NESTED_AXES, ['wo']);
  });

  it('内側、外側の順に両方を合わせ直しても変わらない', () => {
    const { inner, outer, model } = nested();
    const first = refitWarp(inner, { x: 80, y: 20, width: 360, height: 330 }, model.bindings)!;
    expect(first).not.toBeNull();
    const second = refitWarp(outer, { x: -20, y: -60, width: 600, height: 520 }, first.bindings)!;
    expect(second).not.toBeNull();
    const after: Model = { ...model, warps: [first.warp, second.warp], bindings: second.bindings };
    expect(first.warp.columns).toBeGreaterThan(inner.columns);
    expect(second.warp.columns).toBeGreaterThan(outer.columns);
    expectSameAppearance(model, after, NESTED_AXES, ['wi', 'wo']);
  });
});

// ---- 回転・拡縮・反転した親 ----

describe('カード60: 範囲を合わせ直しても見た目を変えない（回転・拡縮した親）', () => {
  it('回転・非一様な拡縮・反転した親と、キーで回転・拡縮が変わる親・自身でも変わらない', () => {
    const warp = editedWarp('w', 'g', BOUNDS, 3, 2, 5.2);
    const n = warp.points.length;
    const model = modelOf({
      parts: [
        part('root', 'group', {
          position: { x: 300, y: 200 },
          rotation: 37,
          scale: { x: 1.4, y: -0.7 },
          pivot: { x: 100, y: 50 },
        }),
        part('g', 'group', {
          parentId: 'root',
          position: { x: 15, y: -25 },
          rotation: -23,
          scale: { x: -1.2, y: 0.8 },
          pivot: { x: 200, y: 150 },
        }),
        part('p', 'image', {
          parentId: 'g',
          position: { x: 5, y: 5 },
          rotation: 9,
          scale: { x: 0.9, y: 1.1 },
          pivot: { x: 220, y: 160 },
        }),
      ],
      meshes: [gridMesh('mesh-p', 20, 0, 480, 360, 30)],
      warps: [warp],
      bindings: [
        warpBinding(
          'bx',
          'w',
          ['FaceAngleX'],
          [[-30, 0, 30]],
          [
            key([-30], wave(n, 16, 12, 0.9), 'manual', true),
            key([0], zeros(n), 'auto'),
            key([30], wave(n, -19, 8, 2.8)),
          ],
        ),
        transformBinding('tr-root', 'root', 'FaceAngleZ', [
          [-30, td(10, -5, -20, 0.8, 1.2)],
          [0, td(0, 0, 0, 1, 1)],
          [30, td(-12, 8, 25, 1.3, 0.9)],
        ]),
        transformBinding('tr-g', 'g', 'FaceAngleZ', [
          [-30, td(4, 6, 11, 1.1, 0.95)],
          [0, td(0, 0, 0, 1, 1)],
          [30, td(-7, 3, -14, 0.85, 1.15)],
        ]),
        transformBinding('tr-p', 'p', 'FaceAngleZ', [
          [-30, td(-3, 2, 6, 1.05, 0.9)],
          [0, td(0, 0, 0, 1, 1)],
          [30, td(5, -4, -8, 0.95, 1.1)],
        ]),
      ],
      drawOrder: ['p'],
    });
    // 画面と同じく、子の頂点をワープの入力の空間（g の変形の前）で囲んだ範囲に合わせる
    const local = pointsToAncestorSpace(model, NO_DELTAS, 'p', 'g', model.meshes[0]!.vertices);
    const xs = local.map((v) => v.x);
    const ys = local.map((v) => v.y);
    const target = {
      x: Math.min(...xs) - 10,
      y: Math.min(...ys) - 10,
      width: Math.max(...xs) - Math.min(...xs) + 20,
      height: Math.max(...ys) - Math.min(...ys) + 20,
    };
    // 子は元の格子の外にはみ出している（合わせ直す意味がある）
    expect(target.x).toBeLessThan(BOUNDS.x);
    expect(target.x + target.width).toBeGreaterThan(BOUNDS.x + BOUNDS.width);

    const result = refitWarp(warp, target, model.bindings)!;
    expect(result).not.toBeNull();
    expectContains(result.warp.bounds, target);
    expect(result.warp.columns).toBeGreaterThan(warp.columns);
    const after: Model = { ...model, warps: [result.warp], bindings: result.bindings };
    expectSameAppearance(model, after, { FaceAngleX: [-30, -7, 0, 19, 30], FaceAngleZ: [-30, -7, 0, 19, 30] }, ['w']);
  });
});

// ---- キーを作り直さない ----

describe('カード60: 範囲を合わせ直しても、キーは作り直さない', () => {
  it('キーの数・順・位置・自動/手動・ロックとバインディングの設定を保ち、ほかのバインディングは同じもののまま', () => {
    const { warp, bx, model } = singleLevel();
    const n = warp.points.length;
    // 別のワープ（w2、2×2）のバインディング
    const otherBinding = warpBinding(
      'b-other',
      'w2',
      ['FaceAngleX'],
      [[0, 30]],
      [key([0], zeros(9), 'auto'), key([30], wave(9, 3, 3, 0))],
    );
    const xy = warpBinding(
      'xy',
      'w',
      ['FaceAngleX', 'FaceAngleY'],
      [
        [0, 30],
        [0, 30],
      ],
      [key([0, 0], zeros(n), 'auto'), key([30, 30], wave(n, 4, 4, 1), 'combined', true)],
    );
    const vertexBinding: Binding = {
      id: 'b-mesh',
      target: { type: 'mesh', id: 'mesh-p' },
      channel: 'vertices',
      parameterIds: ['MouthOpen'],
      keyValues: [[0, 1]],
      keys: [key([0], zeros(model.meshes[0]!.vertices.length), 'auto')],
      generation: 'linear',
      divisions: null,
    };
    const transform = transformBinding('b-part', 'g', 'FaceAngleZ', [
      [0, td(0, 0, 0, 1, 1)],
      [30, td(3, 0, 5, 1, 1)],
    ]);
    const bindings = [
      transform,
      bx,
      otherBinding,
      { ...xy, generation: 'surface' as const, divisions: 3 },
      vertexBinding,
    ];
    const snapshot = structuredClone({ warp, bindings });

    const result = refitWarp(warp, { x: -50, y: -70, width: 620, height: 500 }, bindings)!;
    expect(result).not.toBeNull();
    // 入力は書き換えない
    expect({ warp, bindings }).toEqual(snapshot);
    // 格子の id と付け先は同じ
    expect(result.warp.id).toBe('w');
    expect(result.warp.partId).toBe('g');
    // 順も数も同じ。このワープ以外のバインディングは同じオブジェクト
    expect(result.bindings.map((b) => b.id)).toEqual(['b-part', 'bx', 'b-other', 'xy', 'b-mesh']);
    expect(result.bindings[0]).toBe(bindings[0]);
    expect(result.bindings[2]).toBe(bindings[2]);
    expect(result.bindings[4]).toBe(bindings[4]);
    // このワープのバインディングは、差分のほかは何も変えない（生成方法・分割数・キーの並びも保つ）
    for (const index of [1, 3]) {
      const { keys: nextKeys, ...nextMeta } = result.bindings[index]!;
      const { keys: prevKeys, ...prevMeta } = bindings[index]!;
      expect(nextMeta).toEqual(prevMeta);
      expect(nextKeys.map(({ delta: _, ...meta }) => meta)).toEqual(prevKeys.map(({ delta: _, ...meta }) => meta));
      for (const k of nextKeys) expect(k.delta as Vec2[]).toHaveLength(result.warp.points.length);
    }
    expect(result.bindings[1]!.keys.map((k) => [k.source, k.locked])).toEqual([
      ['manual', true],
      ['generated', false],
      ['auto', false],
      ['combined', false],
    ]);
    expect(result.bindings[3]).toMatchObject({ generation: 'surface', divisions: 3 });
    // 差分 0 のキー（デフォルト値）は 0 のまま。ほかのキーは 0 にされていない
    for (const d of result.bindings[1]!.keys[2]!.delta as Vec2[]) {
      expect(Math.abs(d.x)).toBeLessThan(1e-9);
      expect(Math.abs(d.y)).toBeLessThan(1e-9);
    }
    const moved = (result.bindings[1]!.keys[0]!.delta as Vec2[]).filter((d) => Math.hypot(d.x, d.y) > 1);
    expect(moved.length).toBeGreaterThan(result.warp.points.length / 2);
  });

  it('子の範囲が今の格子の内側なら、格子もキーも同じもののまま（縮めない）', () => {
    const { warp, model } = singleLevel();
    const result = refitWarp(warp, { x: 130, y: 110, width: 200, height: 120 }, model.bindings)!;
    expect(result).not.toBeNull();
    expect(result.warp).toBe(warp);
    expect(result.bindings).toHaveLength(model.bindings.length);
    result.bindings.forEach((b, i) => expect(b).toBe(model.bindings[i]));
    // ちょうど同じ範囲でも同じ
    const same = refitWarp(warp, { ...BOUNDS }, model.bindings)!;
    expect(same.warp).toBe(warp);
  });
});

// ---- 置き換えない場合 ----

describe('カード60: 置き換えられない格子やキーは置き換えない', () => {
  it('制御点が 65,536 個までなら広げ、超えるなら置き換えない', () => {
    const small = editedWarp('w', 'g', { x: 0, y: 0, width: 10, height: 10 }, 1, 1, 0);
    const binding = warpBinding(
      'b',
      'w',
      ['FaceAngleX'],
      [[0, 30]],
      [key([0], zeros(4), 'auto'), key([30], wave(4, 3, 2, 0))],
    );
    // 256 × 256 = 65,536 個
    const limit = refitWarp(small, { x: 0, y: 0, width: 2550, height: 2550 }, [binding]);
    expect(limit).not.toBeNull();
    expect(limit!.warp.points).toHaveLength(65536);
    expect((limit!.bindings[0]!.keys[1]!.delta as Vec2[]).length).toBe(65536);
    // 257 × 256 = 65,792 個
    expect(refitWarp(small, { x: 0, y: 0, width: 2560, height: 2550 }, [binding])).toBeNull();
    expect(refitWarp(small, { x: -1e9, y: -1e9, width: 2e9, height: 2e9 }, [binding])).toBeNull();
  });

  it('このワープのキーの差分が壊れていれば置き換えない', () => {
    const { warp, bx } = singleLevel();
    const target = { x: -50, y: -70, width: 620, height: 500 };
    const n = warp.points.length;
    const broken = (delta: ParameterKey['delta']): Binding => ({ ...bx, keys: [...bx.keys, key([20], delta)] });
    expect(refitWarp(warp, target, [broken(zeros(n - 1))])).toBeNull();
    expect(refitWarp(warp, target, [broken([...zeros(n - 1), { x: Number.NaN, y: 0 }])])).toBeNull();
    expect(refitWarp(warp, target, [broken(td(0, 0, 0, 1, 1))])).toBeNull();
    // 壊れていなければ置き換える（上の null はキーのせい）
    expect(refitWarp(warp, target, [bx])).not.toBeNull();
  });

  it('使えない格子や範囲なら置き換えない', () => {
    const { warp, model } = singleLevel();
    const target = { x: -50, y: -70, width: 620, height: 500 };
    expect(refitWarp({ ...warp, columns: 0 }, target, model.bindings)).toBeNull();
    expect(refitWarp({ ...warp, points: warp.points.slice(1) }, target, model.bindings)).toBeNull();
    expect(refitWarp({ ...warp, bounds: { ...warp.bounds, width: 0 } }, target, model.bindings)).toBeNull();
    expect(
      refitWarp({ ...warp, points: [{ x: Number.NaN, y: 0 }, ...warp.points.slice(1)] }, target, model.bindings),
    ).toBeNull();
    expect(refitWarp(warp, { ...target, width: Number.POSITIVE_INFINITY }, model.bindings)).toBeNull();
    expect(refitWarp(warp, { ...target, x: Number.NaN }, model.bindings)).toBeNull();
  });
});
