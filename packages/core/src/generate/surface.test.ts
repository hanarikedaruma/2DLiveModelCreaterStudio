import { createEmptyProject, type Binding, type Model, type ParameterKey, type Vec2, type Warp } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createKeyGenerator } from './keyGenerator';
import { generateSurfaceKeys, SURFACE_RADIUS_RATIO, surfaceTarget } from './surface';

// bounds の中に等間隔の格子（行優先）
function gridWarp(columns: number, rows: number, bounds = { x: 0, y: 0, width: 400, height: 200 }): Warp {
  const points: Vec2[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      points.push({ x: bounds.x + (bounds.width * i) / columns, y: bounds.y + (bounds.height * j) / rows });
    }
  }
  return { id: 'w', partId: 'head', columns, rows, bounds, points };
}

const deg = (d: number) => (d / 180) * Math.PI;

describe('generateSurfaceKeys', () => {
  it('中央の点ほど大きく動き、端は小さく動く（FaceAngleX）', () => {
    const warp = gridWarp(4, 2);
    const [d] = generateSurfaceKeys(warp, 'FaceAngleX', [30]);
    // 真ん中の行の5点。x だけが動き、+30 は右へ
    const row = [5, 6, 7, 8, 9].map((i) => d![i]!);
    row.forEach((p) => {
      expect(p.y).toBe(0);
      expect(p.x).toBeGreaterThan(0);
    });
    const size = row.map((p) => Math.abs(p.x));
    expect(Math.max(...size)).toBe(size[2]);
    // 端は1つ内側より小さい
    expect(size[0]).toBeLessThan(size[1]!);
    expect(size[4]).toBeLessThan(size[3]!);
    // どの行も同じだけ動く
    expect([0, 1, 2, 3, 4].map((i) => d![i]!.x)).toEqual(row.map((p) => p.x));
  });

  it('式のとおり（中心 c、半径 0.6 × max(幅, 高さ)、30 で 20°）', () => {
    const warp = gridWarp(4, 2);
    const r = SURFACE_RADIUS_RATIO * 400;
    const [d] = generateSurfaceKeys(warp, 'FaceAngleX', [15]);
    // x = 300 の点（index 3）。c.x = 200
    const u = (300 - 200) / r;
    expect(300 + d![3]!.x).toBeCloseTo(200 + r * Math.sin(Math.asin(u) + deg(10)), 9);
    // 中心の点は r·sin(θ)
    expect(d![2]!.x).toBeCloseTo(r * Math.sin(deg(10)), 9);
  });

  it('FaceAngleY は上が正（+ で上へ動く）。中央の行ほど大きく動く', () => {
    const warp = gridWarp(2, 4, { x: 0, y: 0, width: 200, height: 400 });
    const [d] = generateSurfaceKeys(warp, 'FaceAngleY', [30]);
    // 真ん中の列（i = 1）の5点
    const column = [1, 4, 7, 10, 13].map((i) => d![i]!);
    column.forEach((p) => {
      expect(p.x).toBe(0);
      expect(p.y).toBeLessThan(0);
    });
    const size = column.map((p) => Math.abs(p.y));
    expect(Math.max(...size)).toBe(size[2]);
    expect(size[0]).toBeLessThan(size[1]!);
    expect(size[4]).toBeLessThan(size[3]!);
  });

  it('0 は差分 0。-30 は +30 を左右に裏返した動き', () => {
    const warp = gridWarp(4, 2);
    const [zero, minus, plus] = generateSurfaceKeys(warp, 'FaceAngleX', [0, -30, 30]);
    expect(zero!.every((p) => p.x === 0 && p.y === 0)).toBe(true);
    // index 5（左端）と 9（右端）は中心について対称
    expect(minus![5]!.x).toBeCloseTo(-plus![9]!.x, 9);
    expect(minus![7]!.x).toBeCloseTo(-plus![7]!.x, 9);
  });

  it('球の外の点は球の端と同じだけ動き、0 では動かない', () => {
    const warp: Warp = { ...gridWarp(1, 1), points: [{ x: 2000, y: 100 }] };
    const r = SURFACE_RADIUS_RATIO * 400;
    const [zero, plus] = generateSurfaceKeys(warp, 'FaceAngleX', [0, 30]);
    expect(zero![0]).toEqual({ x: 0, y: 0 });
    expect(plus![0]!.x).toBeCloseTo(r * (Math.sin(Math.PI / 2 + deg(20)) - 1), 9);
  });
});

function modelWith(warp: Warp): Model {
  return { ...createEmptyProject('曲面のテスト').model, warps: [warp] };
}

function warpBinding(parameterId: string, keys: ParameterKey[], patch: Partial<Binding> = {}): Binding {
  return {
    id: 'bw',
    target: { type: 'warp', id: 'w' },
    channel: 'warpPoints',
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
    ...patch,
  };
}

const generator = createKeyGenerator();

describe('KeyGenerator.surface', () => {
  const warp = gridWarp(4, 2);
  const model = modelWith(warp);
  const zeros = warp.points.map(() => ({ x: 0, y: 0 }));

  it('-30・0・30 と10刻みのキーを球面で作る（0 は差分 0）', () => {
    const out = generator.surface(
      warpBinding('FaceAngleX', [{ coords: [0], delta: zeros, source: 'auto', locked: false }]),
      model,
    );
    expect(out.generation).toBe('surface');
    expect(out.keys.map((k) => [k.coords[0], k.source])).toEqual([
      [-30, 'auto'],
      [-20, 'generated'],
      [-10, 'generated'],
      [0, 'auto'],
      [10, 'generated'],
      [20, 'generated'],
      [30, 'auto'],
    ]);
    expect(out.keyValues).toEqual([[-30, -20, -10, 0, 10, 20, 30]]);
    const expected = generateSurfaceKeys(warp, 'FaceAngleX', [-30, -20, -10, 0, 10, 20, 30]);
    out.keys.forEach((k, i) => {
      (k.delta as Vec2[]).forEach((d, j) => {
        expect(d.x).toBeCloseTo(expected[i]![j]!.x, 9);
        expect(d.y).toBeCloseTo(expected[i]![j]!.y, 9);
      });
    });
    expect((out.keys[3]!.delta as Vec2[]).every((d) => d.x === 0 && d.y === 0)).toBe(true);
    // 2回掛けても同じ
    expect(generator.surface(out, model)).toBe(out);
  });

  it('ロックされたキーは残し、間のキーはそのずれを引き継ぐ。ほかのキーは作り直す', () => {
    const shifted = generateSurfaceKeys(warp, 'FaceAngleX', [10])[0]!.map((d) => ({ x: d.x + 6, y: d.y }));
    const locked: ParameterKey = { coords: [10], delta: shifted, source: 'manual', locked: true };
    const manual: ParameterKey = { coords: [15], delta: zeros, source: 'manual', locked: false };
    const out = generator.surface(
      warpBinding('FaceAngleX', [{ coords: [0], delta: zeros, source: 'auto', locked: false }, locked, manual]),
      model,
    );
    expect(out.keys.map((k) => k.coords[0])).toEqual([-30, -20, -10, 0, 10, 20, 30]);
    expect(out.keys[4]).toBe(locked);
    // 20 は 10（ずれ +6）と 30（ずれ 0）の真ん中なので、球面より 3 だけ右
    const sphere20 = generateSurfaceKeys(warp, 'FaceAngleX', [20])[0]!;
    (out.keys[5]!.delta as Vec2[]).forEach((d, j) => expect(d.x).toBeCloseTo(sphere20[j]!.x + 3, 9));
  });

  it('FaceAngleY でも作れる。ワープでない・顔の向きでないバインディングはそのまま返す', () => {
    const y = generator.surface(warpBinding('FaceAngleY', []), model);
    expect(y.keys).toHaveLength(7);
    expect((y.keys[6]!.delta as Vec2[])[7]!.y).toBeLessThan(0);

    const other = warpBinding('MouthOpen', []);
    expect(generator.surface(other, model)).toBe(other);
    const vertices: Binding = {
      ...warpBinding('FaceAngleX', []),
      channel: 'vertices',
      target: { type: 'mesh', id: 'm' },
    };
    expect(generator.surface(vertices, model)).toBe(vertices);
    const missing: Binding = { ...warpBinding('FaceAngleX', []), target: { type: 'warp', id: 'none' } };
    expect(generator.surface(missing, model)).toBe(missing);
    expect(surfaceTarget(warpBinding('FaceAngleX', []), model)).toEqual({ warp, parameterId: 'FaceAngleX' });
  });
});
