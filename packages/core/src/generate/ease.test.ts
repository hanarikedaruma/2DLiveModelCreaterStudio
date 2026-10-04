import type { Binding, ParameterKey, TransformDelta, Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { smoothstep } from './ease';
import { createKeyGenerator } from './keyGenerator';
import { transformDelta } from './keys';

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
const generator = createKeyGenerator();

describe('smoothstep', () => {
  it('0 → 0、0.5 → 0.5、1 → 1 で、両端の傾きが 0。範囲の外は端に丸める', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    const h = 1e-4;
    expect(smoothstep(h) / h).toBeLessThan(0.01);
    expect((1 - smoothstep(1 - h)) / h).toBeLessThan(0.01);
  });
});

describe('KeyGenerator.ease', () => {
  it('中間キーの値を代表状態の間の smoothstep で作る', () => {
    const out = generator.ease(binding('EyeOpenL', [key(0, 0, 'manual'), key(1, 64)]));
    expect(out.generation).toBe('ease');
    expect(xs(out)).toEqual([
      [0, 0],
      [0.25, 10],
      [0.5, 32],
      [0.75, 54],
      [1, 64],
    ]);
    expect(out.keys.filter((k) => k.source === 'generated')).toHaveLength(3);
    expect(generator.ease(out)).toBe(out);
  });

  it('両端で変化がゆるやか（隣のキーとの差が、両端で小さく真ん中で大きい）', () => {
    const out = generator.ease(binding('FaceAngleX', [key(0, 0), key(30, 100)]));
    const ten = generator.ease({ ...binding('FaceAngleX', [key(0, 0), key(30, 100)]), divisions: 10 });
    expect(out.keys).toHaveLength(4);
    const values = xs(ten).map(([, x]) => x!);
    const steps = values.slice(1).map((v, i) => v - values[i]!);
    // 線形なら 1 区間 10 ずつ
    expect(steps[0]).toBeLessThan(10 / 3);
    expect(steps[steps.length - 1]).toBeLessThan(10 / 3);
    expect(Math.max(...steps)).toBeCloseTo(steps[4]!, 9);
    expect(steps[4]).toBeGreaterThan(10);
    // 単調に増える（行き過ぎない）
    expect(steps.every((s) => s > 0)).toBe(true);
  });

  it('頂点の差分も smoothstep で補間し、ロックされたキーは代表状態として残す', () => {
    const locked: ParameterKey = { coords: [0.5], delta: [{ x: 10, y: 0 }], source: 'generated', locked: true };
    const out = generator.ease({
      id: 'v',
      target: { type: 'mesh', id: 'm' },
      channel: 'vertices',
      parameterIds: ['MouthOpen'],
      keyValues: [[0, 0.5, 1]],
      keys: [
        { coords: [0], delta: [{ x: 0, y: 0 }], source: 'auto', locked: false },
        locked,
        {
          coords: [1],
          delta: [{ x: 10, y: 20 }],
          source: 'manual',
          locked: false,
        },
      ],
      generation: 'linear',
      divisions: 2,
    });
    expect(out.keys.map((k) => k.coords[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(out.keys[2]).toBe(locked);
    expect(out.keys[1]!.delta as Vec2[]).toEqual([{ x: 5, y: 0 }]);
    expect(out.keys[3]!.delta as Vec2[]).toEqual([{ x: 10, y: 10 }]);
  });

  it('2パラメータのバインディングはそのまま返す', () => {
    const two: Binding = {
      ...binding('FaceAngleX', [{ coords: [0, 0], delta: transformDelta(), source: 'auto', locked: false }]),
      parameterIds: ['FaceAngleX', 'FaceAngleY'],
      keyValues: [[0], [0]],
    };
    expect(generator.ease(two)).toBe(two);
  });
});
