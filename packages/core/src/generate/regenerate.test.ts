import {
  createEmptyProject,
  type Binding,
  type Model,
  type ParameterKey,
  type TransformDelta,
  type Vec2,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { generateBetweenKeys, linearInterpolator, normalizeWithin } from './between';
import { createKeyGenerator } from './keyGenerator';
import { transformDelta } from './keys';
import { generateSurfaceKeys } from './surface';

function key(coord: number, x: number, source: ParameterKey['source'] = 'auto', locked = false): ParameterKey {
  return { coords: [coord], delta: transformDelta({ x }), source, locked };
}

function binding(parameterId: string, keys: ParameterKey[], patch: Partial<Binding> = {}): Binding {
  return {
    id: 'b1',
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
    ...patch,
  };
}

const xs = (b: Binding) => b.keys.map((k) => [k.coords[0], (k.delta as TransformDelta).position.x]);
const model: Model = createEmptyProject('再補間のテスト').model;
const generator = createKeyGenerator();

// FaceAngleX（10 刻み）。-30・0・30 が代表状態、間は古い値（中間キーを手で直したものではない）の generated
function stale(): Binding {
  return binding('FaceAngleX', [
    key(-30, -30),
    key(-20, 0, 'generated'),
    key(-10, 0, 'generated', true),
    key(0, 0),
    key(10, 0, 'generated'),
    key(20, 0, 'generated'),
    key(30, 90, 'manual'),
  ]);
}

describe('KeyGenerator.regenerate', () => {
  it('範囲の中の未ロックの中間キーだけを作り直し、ロックされたキーと範囲外は変わらない', () => {
    const before = stale();
    const out = generator.regenerate(before, model, [5, 30]);
    expect(xs(out)).toEqual([
      [-30, -30],
      [-20, 0],
      [-10, 0],
      [0, 0],
      [10, 30],
      [20, 60],
      [30, 90],
    ]);
    // 範囲外（-30〜0）とロックされたキーは同じオブジェクトのまま
    [0, 1, 2, 3, 6].forEach((i) => expect(out.keys[i]).toBe(before.keys[i]));
    expect(out.keys[4]!.source).toBe('generated');
    expect(out.generation).toBe('linear');
  });

  it('範囲が無ければ全体。ロックされたキーは代表状態として使う', () => {
    const before = stale();
    const out = generator.regenerate(before, model);
    // -30 → -10（ロック、0）の間の -20 は -15、0 → 30 の間は 30・60
    expect(xs(out)).toEqual([
      [-30, -30],
      [-20, -15],
      [-10, 0],
      [0, 0],
      [10, 30],
      [20, 60],
      [30, 90],
    ]);
    expect(out.keys[2]).toBe(before.keys[2]);
    expect(generator.regenerate(out, model)).toBe(out);
  });

  it('範囲の両端は逆でもよく、端のキーも含む。範囲の中に作り直すものが無ければそのまま返す', () => {
    const before = stale();
    const out = generator.regenerate(before, model, [20, 10]);
    expect(xs(out).slice(4, 6)).toEqual([
      [10, 30],
      [20, 60],
    ]);
    expect(out.keys[1]).toBe(before.keys[1]);
    const done = generator.regenerate(before, model, [-10, -10]);
    expect(done).toBe(before);
  });

  it('バインディングの方式（なめらか）で作り直し、方式は変えない', () => {
    const before = { ...stale(), generation: 'ease' as const };
    const out = generator.regenerate(before, model, [0, 30]);
    expect(out.generation).toBe('ease');
    // 0 → 30（0 → 90）を smoothstep で: 1/3 → 0.259…、2/3 → 0.740…
    const s = (t: number) => t * t * (3 - 2 * t);
    expect((out.keys[4]!.delta as TransformDelta).position.x).toBeCloseTo(90 * s(1 / 3), 9);
    expect((out.keys[5]!.delta as TransformDelta).position.x).toBeCloseTo(90 * s(2 / 3), 9);
    expect(out.keys[1]).toBe(before.keys[1]);
  });

  it('depth のバインディングは線形で埋め、方式は depth のまま', () => {
    const before = { ...binding('FaceAngleY', [key(-30, 3), key(0, 0), key(30, -3)]), generation: 'depth' as const };
    const out = generator.regenerate(before, model);
    expect(out.generation).toBe('depth');
    expect(xs(out)).toEqual([
      [-30, 3],
      [-20, 2],
      [-10, 1],
      [0, 0],
      [10, -1],
      [20, -2],
      [30, -3],
    ]);
  });

  it('曲面のバインディングは球面で作り直す（範囲の外は変わらない）', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const warpModel: Model = {
      ...model,
      warps: [{ id: 'w', partId: 'head', columns: 2, rows: 0, bounds: { x: 0, y: 0, width: 200, height: 0 }, points }],
    };
    const surface = generator.surface(
      {
        ...binding('FaceAngleX', []),
        target: { type: 'warp', id: 'w' },
        channel: 'warpPoints',
      },
      warpModel,
    );
    // 中間キーを壊してから、正の側だけ作り直す
    const broken: Binding = {
      ...surface,
      keys: surface.keys.map((k) =>
        k.source === 'generated' ? { ...k, delta: points.map(() => ({ x: 0, y: 0 })) } : k,
      ),
    };
    const out = generator.regenerate(broken, warpModel, [0, 30]);
    const expected = generateSurfaceKeys(warpModel.warps[0]!, 'FaceAngleX', [10, 20]);
    expect(out.keys[4]!.delta as Vec2[]).toEqual(expected[0]!.map((d) => ({ x: expect.closeTo(d.x, 9), y: 0 })));
    expect(out.keys[5]!.delta as Vec2[]).toEqual(expected[1]!.map((d) => ({ x: expect.closeTo(d.x, 9), y: 0 })));
    expect(out.keys[1]).toBe(broken.keys[1]);
    expect(out.keys[2]).toBe(broken.keys[2]);
    expect(out.generation).toBe('surface');
  });

  it('分割数が変わっていたら、範囲の中だけ新しい位置で作り直す', () => {
    const before = { ...stale(), divisions: 2 };
    const out = generator.regenerate(before, model, [0, 30]);
    expect(xs(out)).toEqual([
      [-30, -30],
      [-20, 0],
      [-10, 0],
      [0, 0],
      [15, 45],
      [30, 90],
    ]);
    expect(out.keyValues).toEqual([[-30, -20, -10, 0, 15, 30]]);
  });

  it('2パラメータのバインディングはそのまま返す', () => {
    const two: Binding = {
      ...binding('FaceAngleX', [{ coords: [0, 0], delta: transformDelta(), source: 'auto', locked: false }]),
      parameterIds: ['FaceAngleX', 'FaceAngleY'],
      keyValues: [[0], [0]],
    };
    expect(generator.regenerate(two, model)).toBe(two);
    expect(generator.regenerate(two, model, [0, 30])).toBe(two);
  });
});

describe('generateBetweenKeys', () => {
  it('combined のキーは残し、その位置には作らない。作れない差分（形が合わない）は飛ばす', () => {
    const combined = key(10, 99, 'combined');
    const b = binding('FaceAngleX', [key(0, 0), combined, key(30, 30)]);
    const out = generateBetweenKeys(b, linearInterpolator, {
      divisions: null,
      step: 10,
      within: null,
      generation: 'linear',
    });
    expect(xs(out)).toEqual([
      [0, 0],
      [10, 99],
      [20, 20],
      [30, 30],
    ]);
    const mixed = binding('FaceAngleX', [
      key(0, 0),
      { coords: [30], delta: [{ x: 1, y: 1 }], source: 'auto', locked: false },
    ]);
    expect(
      generateBetweenKeys(mixed, linearInterpolator, { divisions: null, step: 10, within: null, generation: 'linear' })
        .keys,
    ).toHaveLength(2);
  });

  it('範囲の正規化', () => {
    expect(normalizeWithin(undefined)).toBeNull();
    expect(normalizeWithin([3, -1])).toEqual([-1, 3]);
    expect(normalizeWithin([Number.NaN, 1])).toBeNull();
  });
});
