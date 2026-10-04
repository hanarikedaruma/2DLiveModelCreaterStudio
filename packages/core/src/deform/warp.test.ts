import type { Vec2, Warp } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBindingEvaluator } from '../eval';
import { pointsBinding, shift, testModel } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { groupPart, imagePart, meshOf, pairs } from './testParts';
import { applyWarp, isUsableWarp, regularWarpPoints } from './warp';

afterEach(() => {
  vi.restoreAllMocks();
});

function regularWarp(bounds: Warp['bounds'], columns: number, rows: number, id = 'w', partId = 'g'): Warp {
  return { id, partId, columns, rows, bounds, points: regularWarpPoints(bounds, columns, rows) };
}

function flat(points: Vec2[]): Float64Array {
  return new Float64Array(points.flatMap((p) => [p.x, p.y]));
}

function deltaOf(points: Vec2[]): Float32Array {
  return new Float32Array(points.flatMap((p) => [p.x, p.y]));
}

function warped(warp: Warp, points: Vec2[], delta?: Float32Array): Vec2[] {
  const buf = flat(points);
  applyWarp(buf, warp, delta);
  return points.map((_, i) => ({ x: buf[i * 2]!, y: buf[i * 2 + 1]! }));
}

function expectNear(actual: Vec2, expected: Vec2, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

// 格子の内側・辺の上・外側の点
const SAMPLES: Vec2[] = [
  { x: 10, y: 20 },
  { x: 37.5, y: 61.25 },
  { x: 110, y: 120 },
  { x: 60, y: 70 },
  { x: -40, y: 55 },
  { x: 300, y: -80 },
  { x: 75, y: 500 },
];

describe('regularWarpPoints', () => {
  it('(columns+1)×(rows+1) 個を行優先で、bounds を等分して並べる', () => {
    const points = regularWarpPoints({ x: 10, y: 20, width: 100, height: 50 }, 2, 1);
    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 20 },
      { x: 110, y: 20 },
      { x: 10, y: 70 },
      { x: 60, y: 70 },
      { x: 110, y: 70 },
    ]);
  });
});

describe('applyWarp: 恒等', () => {
  it.each([
    [1, 1],
    [4, 4],
    [3, 7],
    [8, 2],
  ])('規則的な格子（%i×%i）なら、内側も外側も点は動かない', (columns, rows) => {
    const warp = regularWarp({ x: 10, y: 20, width: 100, height: 100 }, columns, rows);
    const out = warped(warp, SAMPLES);
    out.forEach((p, i) => expectNear(p, SAMPLES[i]!, 9));
  });

  it('差分がすべて 0 でも恒等', () => {
    const warp = regularWarp({ x: -50, y: 5, width: 33, height: 270 }, 4, 4);
    const out = warped(warp, SAMPLES, new Float32Array(warp.points.length * 2));
    out.forEach((p, i) => expectNear(p, SAMPLES[i]!, 9));
  });

  it('Float32Array（変形パイプラインの頂点）もその場で変える', () => {
    const warp = regularWarp({ x: 0, y: 0, width: 40, height: 40 }, 4, 4);
    const points = new Float32Array([1, 2, 39, 41]);
    applyWarp(points, warp, deltaOf(shift(warp.points.length, 2, -1)));
    expect([...points]).toEqual([3, 1, 41, 40]);
  });
});

describe('applyWarp: 平行移動', () => {
  it('全制御点を同じだけ動かすと、内側も外側も点は同じだけ動く（差分でも基準の制御点でも）', () => {
    const warp = regularWarp({ x: 10, y: 20, width: 100, height: 100 }, 4, 3);
    const byDelta = warped(warp, SAMPLES, deltaOf(shift(warp.points.length, 7.5, -3.25)));
    byDelta.forEach((p, i) => expectNear(p, { x: SAMPLES[i]!.x + 7.5, y: SAMPLES[i]!.y - 3.25 }, 5));

    const moved: Warp = { ...warp, points: warp.points.map((p) => ({ x: p.x + 7.5, y: p.y - 3.25 })) };
    const byBase = warped(moved, SAMPLES);
    byBase.forEach((p, i) => expectNear(p, { x: SAMPLES[i]!.x + 7.5, y: SAMPLES[i]!.y - 3.25 }, 5));
  });

  it('基準の制御点と差分は足して使う', () => {
    const warp = regularWarp({ x: 0, y: 0, width: 10, height: 10 }, 1, 1);
    const moved: Warp = { ...warp, points: warp.points.map((p) => ({ x: p.x + 1, y: p.y })) };
    const out = warped(moved, [{ x: 5, y: 5 }], deltaOf(shift(4, 0, 2)));
    expectNear(out[0]!, { x: 6, y: 7 });
  });
});

describe('applyWarp: 双線形補間', () => {
  // 1×1 の格子で、4つの角を別々に動かす
  const skewed: Warp = {
    id: 'w',
    partId: 'g',
    columns: 1,
    rows: 1,
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 10 },
      { x: -20, y: 60 },
      { x: 90, y: 40 },
    ],
  };
  const bilinear = (s: number, t: number): Vec2 => {
    const [p00, p10, p01, p11] = skewed.points as [Vec2, Vec2, Vec2, Vec2];
    const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t] as const;
    return {
      x: w[0] * p00.x + w[1] * p10.x + w[2] * p01.x + w[3] * p11.x,
      y: w[0] * p00.y + w[1] * p10.y + w[2] * p01.y + w[3] * p11.y,
    };
  };

  it('角は制御点へ、内側は4つの角の双線形補間へ動く', () => {
    const out = warped(skewed, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 25, y: 25 },
      { x: 80, y: 10 },
    ]);
    skewed.points.forEach((p, i) => expectNear(out[i]!, p));
    expectNear(out[4]!, bilinear(0.25, 0.5));
    // (0.25, 0.5): x = 0.375·0 + 0.125·120 + 0.375·(−20) + 0.125·90 = 18.75
    expectNear(out[4]!, { x: 18.75, y: 0.375 * 0 + 0.125 * 10 + 0.375 * 60 + 0.125 * 40 });
    expectNear(out[5]!, bilinear(0.8, 0.2));
  });

  it('真ん中の制御点だけを動かすと、セルの中の点は重み（双線形の係数）の分だけ動く', () => {
    const warp = regularWarp({ x: 0, y: 0, width: 20, height: 20 }, 2, 2);
    const d = shift(9, 0, 0);
    d[4] = { x: 8, y: -4 }; // 真ん中 (10,10)
    const out = warped(
      warp,
      [
        { x: 10, y: 10 },
        { x: 5, y: 5 },
        { x: 15, y: 10 },
        { x: 0, y: 0 },
      ],
      deltaOf(d),
    );
    expectNear(out[0]!, { x: 18, y: 6 });
    expectNear(out[1]!, { x: 5 + 8 * 0.25, y: 5 - 4 * 0.25 });
    expectNear(out[2]!, { x: 15 + 8 * 0.5, y: 10 - 4 * 0.5 });
    expectNear(out[3]!, { x: 0, y: 0 });
  });

  it('範囲外では端のセルの式で外へ延び、境目で連続する', () => {
    // 外側（s = 1.5 や t = −0.5）は同じ式の延長
    const out = warped(skewed, [
      { x: 150, y: 25 },
      { x: 50, y: -25 },
      { x: -100, y: 100 },
    ]);
    expectNear(out[0]!, bilinear(1.5, 0.5));
    expectNear(out[1]!, bilinear(0.5, -0.5));
    expectNear(out[2]!, bilinear(-1, 2));

    // 境目の内と外のすぐ近くの点は、ほぼ同じ位置へ動く
    const warp = regularWarp({ x: 0, y: 0, width: 30, height: 30 }, 3, 3);
    const d = warp.points.map((_, k) => ({ x: Math.sin(k) * 5, y: Math.cos(k * 1.7) * 5 }));
    const eps = 1e-6;
    for (const edge of [
      [
        { x: 30 - eps, y: 12 },
        { x: 30 + eps, y: 12 },
      ],
      [
        { x: -eps, y: 27 },
        { x: eps, y: 27 },
      ],
      [
        { x: 7, y: 30 - eps },
        { x: 7, y: 30 + eps },
      ],
      [
        { x: 30 - eps, y: 30 - eps },
        { x: 30 + eps, y: 30 + eps },
      ],
      // 内側のセルの境目も連続
      [
        { x: 10 - eps, y: 15 },
        { x: 10 + eps, y: 15 },
      ],
    ] as const) {
      const [a, b] = warped(warp, [...edge], deltaOf(d));
      expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeLessThan(1e-4);
    }
  });
});

describe('applyWarp: 使えないもの', () => {
  const base = regularWarp({ x: 0, y: 0, width: 10, height: 10 }, 2, 2);

  it.each<[string, Warp]>([
    ['制御点の数が合わない', { ...base, points: base.points.slice(1) }],
    ['幅が 0', { ...base, bounds: { ...base.bounds, width: 0 } }],
    ['高さが 0', { ...base, bounds: { ...base.bounds, height: 0 } }],
    ['分割が 0', { ...base, columns: 0, points: base.points.slice(0, 3) }],
  ])('%s なら何もしない', (_, warp) => {
    expect(isUsableWarp(warp)).toBe(false);
    const points = new Float32Array([1, 2, 3, 4]);
    applyWarp(points, warp, deltaOf(shift(warp.points.length, 5, 5)));
    expect([...points]).toEqual([1, 2, 3, 4]);
  });

  it('差分の長さが合わなければ差分を使わない（差分も書き換えない）', () => {
    const moved: Warp = { ...base, points: base.points.map((p) => ({ x: p.x + 1, y: p.y })) };
    const delta = new Float32Array([5, 5, 5, 5]);
    const points = new Float32Array([1, 2]);
    applyWarp(points, moved, delta);
    expect([...points]).toEqual([2, 2]);
    expect([...delta]).toEqual([5, 5, 5, 5]);
  });
});

describe('変形パイプラインでのワープ', () => {
  // グループ g（ワープ付き）の子の画像パーツ c。c の頂点は格子の内側と外側
  const vertices = [
    { x: 10, y: 10 },
    { x: 90, y: 30 },
    { x: 50, y: 95 },
    { x: 130, y: -20 },
  ];
  const warp = regularWarp({ x: 0, y: 0, width: 100, height: 100 }, 4, 4, 'w', 'g');
  const model = testModel({
    parts: [
      groupPart('g', { pivot: { x: 50, y: 50 } }),
      imagePart('c', { parentId: 'g', meshId: 'm', pivot: { x: 50, y: 50 } }),
    ],
    meshes: [meshOf('m', vertices)],
    warps: [warp],
    drawOrder: ['c'],
  });
  const noDeltas = (): TargetDeltas => ({ transforms: {}, vertices: {}, warpPoints: {} });

  it('規則的な格子なら、子の頂点は変わらない', () => {
    const out = createDeformPipeline().deform(model, noDeltas());
    pairs(out.byPartId.c!.positions).forEach(([x, y], i) => expectNear({ x, y }, vertices[i]!, 4));
  });

  it('全制御点の平行移動（キーの評価から）で、子も同じだけ動く', () => {
    const withKey = {
      ...model,
      bindings: [
        pointsBinding(
          'b',
          { type: 'warp', id: 'w' },
          ['FaceAngleX'],
          [[0, 30]],
          [
            [[0], shift(25, 0, 0)],
            [[30], shift(25, 12, -6)],
          ],
        ),
      ],
    };
    const deltas = createBindingEvaluator().evaluate(withKey, { FaceAngleX: 15 });
    expect(deltas.warpPoints.w).toHaveLength(50);
    const out = createDeformPipeline().deform(withKey, deltas);
    pairs(out.byPartId.c!.positions).forEach(([x, y], i) =>
      expectNear({ x, y }, { x: vertices[i]!.x + 6, y: vertices[i]!.y - 3 }, 4),
    );
  });

  it('子の変形のあと、グループの変形の前に掛かる', () => {
    // 子を右へ 10 → ワープ（全体を下へ 5）→ グループを 90度
    const m = {
      ...model,
      parts: [
        groupPart('g', { pivot: { x: 0, y: 0 }, rotation: 90 }),
        imagePart('c', { parentId: 'g', meshId: 'm', position: { x: 10, y: 0 } }),
      ],
    };
    const out = createDeformPipeline().deform(m, { ...noDeltas(), warpPoints: { w: deltaOf(shift(25, 0, 5)) } });
    const [x, y] = out.byPartId.c!.positions;
    // (10,10) → (20,10) → (20,15) → 90度で (−15,20)
    expect(x).toBeCloseTo(-15, 4);
    expect(y).toBeCloseTo(20, 4);
  });

  it('使えない格子と長さの合わない差分は1回だけ知らせて飛ばす', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { ...model, warps: [{ ...warp, bounds: { ...warp.bounds, width: 0 } }] };
    const pipeline = createDeformPipeline();
    const shifted = { ...noDeltas(), warpPoints: { w: deltaOf(shift(25, 3, 3)) } };
    pipeline.deform(broken, shifted);
    pipeline.deform(broken, shifted);
    const out = pipeline.deform(broken, shifted);
    pairs(out.byPartId.c!.positions).forEach(([x, y], i) => expectNear({ x, y }, vertices[i]!, 4));

    const short = { ...noDeltas(), warpPoints: { w: new Float32Array(10).fill(3) } };
    const out2 = pipeline.deform(model, short);
    pipeline.deform(model, short);
    pairs(out2.byPartId.c!.positions).forEach(([x, y], i) => expectNear({ x, y }, vertices[i]!, 4));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
