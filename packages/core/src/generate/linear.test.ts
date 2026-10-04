import type { Binding, ParameterKey, TransformDelta } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createKeyGenerator } from './keyGenerator';
import { transformDelta } from './keys';
import { generateLinearKeys, isRepresentativeKey, linearStep, normalizeDivisions } from './linear';

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
    generation: 'depth',
    divisions: null,
    ...patch,
  };
}

const xs = (b: Binding) => b.keys.map((k) => [k.coords[0], (k.delta as TransformDelta).position.x]);
const generator = createKeyGenerator();

describe('linear', () => {
  it('範囲が10以下のパラメータは 0.25 刻みで中間キーを作る', () => {
    const out = generator.linear(binding('EyeOpenL', [key(0, 10, 'manual'), key(1, 0)]));
    expect(xs(out)).toEqual([
      [0, 10],
      [0.25, 7.5],
      [0.5, 5],
      [0.75, 2.5],
      [1, 0],
    ]);
    expect(out.keyValues).toEqual([[0, 0.25, 0.5, 0.75, 1]]);
    const generated = out.keys.filter((k) => k.source === 'generated');
    expect(generated).toHaveLength(3);
    expect(generated.every((k) => !k.locked)).toBe(true);
    expect(out.generation).toBe('linear');
    expect(out.divisions).toBeNull();
  });

  it('範囲が10を超えるパラメータは10刻み', () => {
    const out = generator.linear(binding('FaceAngleX', [key(-30, -30), key(0, 0), key(30, 60)]));
    expect(xs(out)).toEqual([
      [-30, -30],
      [-20, -20],
      [-10, -10],
      [0, 0],
      [10, 20],
      [20, 40],
      [30, 60],
    ]);
    expect(out.keyValues).toEqual([[-30, -20, -10, 0, 10, 20, 30]]);
  });

  it('divisions があれば区間をその数に分け、バインディングに覚える', () => {
    const out = generator.linear(binding('FaceAngleX', [key(-30, -30), key(0, 0), key(30, 60)]), 2);
    expect(xs(out)).toEqual([
      [-30, -30],
      [-15, -15],
      [0, 0],
      [15, 30],
      [30, 60],
    ]);
    expect(out.divisions).toBe(2);
    // 引数を省くとバインディングの divisions を使う
    expect(generator.linear(out)).toBe(out);
  });

  it('分割数を変えると、使わなくなった中間キーの位置は keyValues からも消える', () => {
    const four = generator.linear(binding('EyeOpenL', [key(0, 4), key(1, 0)]), 4);
    expect(four.keyValues).toEqual([[0, 0.25, 0.5, 0.75, 1]]);
    const two = generator.linear(four, 2);
    expect(two.keyValues).toEqual([[0, 0.5, 1]]);
    expect(xs(two)).toEqual([
      [0, 4],
      [0.5, 2],
      [1, 0],
    ]);
  });

  it('ロックされたキーは残し、代表状態として使う', () => {
    const locked = key(0.5, 99, 'generated', true);
    const out = generator.linear(binding('EyeOpenL', [key(0, 0), locked, key(1, 10)]));
    expect(xs(out)).toEqual([
      [0, 0],
      [0.25, 49.5],
      [0.5, 99],
      [0.75, 54.5],
      [1, 10],
    ]);
    expect(out.keys[2]).toBe(locked);
  });

  it('作り直すと未ロックの generated だけが変わる', () => {
    const first = generator.linear(
      binding('EyeOpenL', [key(0, 0, 'manual'), key(0.25, 7, 'generated', true), key(0.5, 3, 'combined'), key(1, 8)]),
    );
    // 代表状態の値を変えて作り直す
    const changed: Binding = { ...first, keys: first.keys.map((k) => (k.coords[0] === 1 ? key(1, 16) : k)) };
    const second = generator.linear(changed);
    expect(second.keys.map((k) => k.coords[0])).toEqual(first.keys.map((k) => k.coords[0]));
    second.keys.forEach((k, i) => {
      const before = changed.keys[i]!;
      if (before.source === 'generated' && !before.locked) {
        expect(k).not.toEqual(before);
        expect(k.source).toBe('generated');
      } else {
        expect(k).toBe(before);
      }
    });
    // ロックされた 0.25 と 1 の間で補間し直す（combined の 0.5 はそのまま）
    expect(xs(second)).toEqual([
      [0, 0],
      [0.25, 7],
      [0.5, 3],
      [0.75, 13],
      [1, 16],
    ]);
  });

  it('2回実行しても結果が同じ（同じ参照を返す）', () => {
    const once = generator.linear(binding('FaceAngleY', [key(-30, 3), key(0, 0), key(30, -3)]));
    expect(generator.linear(once)).toBe(once);
  });

  it('2パラメータのバインディングはそのまま返す', () => {
    const two: Binding = {
      ...binding('FaceAngleX', []),
      parameterIds: ['FaceAngleX', 'FaceAngleY'],
      keyValues: [
        [-30, 0, 30],
        [-30, 0, 30],
      ],
      keys: [{ coords: [0, 0], delta: transformDelta(), source: 'auto', locked: false }],
    };
    expect(generator.linear(two)).toBe(two);
    expect(generator.linear(two, 3)).toBe(two);
  });

  it('代表状態が1つ以下なら未ロックの generated を消すだけ', () => {
    const out = generator.linear(binding('EyeOpenL', [key(0, 0), key(0.5, 2, 'generated')]));
    expect(xs(out)).toEqual([[0, 0]]);
    expect(out.keyValues).toEqual([[0]]);
  });

  it('頂点の差分も要素ごとに補間する', () => {
    const vertices: Binding = {
      id: 'v',
      target: { type: 'mesh', id: 'm' },
      channel: 'vertices',
      parameterIds: ['MouthOpen'],
      keyValues: [[0, 1]],
      keys: [
        {
          coords: [0],
          delta: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          source: 'auto',
          locked: false,
        },
        {
          coords: [1],
          delta: [
            { x: 4, y: 8 },
            { x: -4, y: 0 },
          ],
          source: 'manual',
          locked: false,
        },
      ],
      generation: 'linear',
      divisions: null,
    };
    const out = generator.linear(vertices, 2);
    expect(out.keys[1]).toEqual({
      coords: [0.5],
      delta: [
        { x: 2, y: 4 },
        { x: -2, y: 0 },
      ],
      source: 'generated',
      locked: false,
    });
  });

  it('標準外のパラメータは、渡されたパラメータの範囲で刻みを決める', () => {
    const b = binding('Custom', [key(0, 0), key(5, 5)]);
    // 範囲が分からなければキーの範囲（5）で 0.25 刻み
    expect(createKeyGenerator().linear(b).keys).toHaveLength(21);
    // 範囲 0..100 なら10刻みなので、0〜5 の間には作らない
    const withParams = createKeyGenerator({
      parameters: () => [
        { id: 'Custom', name: 'カスタム', groupId: 'other', min: 0, max: 100, default: 0, standard: false },
      ],
    });
    expect(withParams.linear(b).keys).toHaveLength(2);
  });
});

describe('linear の補助', () => {
  it('代表状態は manual・auto・ロックされたキー', () => {
    expect(isRepresentativeKey(key(0, 0, 'manual'))).toBe(true);
    expect(isRepresentativeKey(key(0, 0, 'auto'))).toBe(true);
    expect(isRepresentativeKey(key(0, 0, 'generated', true))).toBe(true);
    expect(isRepresentativeKey(key(0, 0, 'generated'))).toBe(false);
    expect(isRepresentativeKey(key(0, 0, 'combined'))).toBe(false);
  });

  it('刻みと分割数', () => {
    expect(linearStep(60)).toBe(10);
    expect(linearStep(10)).toBe(0.25);
    expect(normalizeDivisions(3.7)).toBe(3);
    expect(normalizeDivisions(0)).toBeNull();
    expect(normalizeDivisions(Number.NaN)).toBeNull();
    expect(normalizeDivisions(undefined)).toBeNull();
  });

  it('刻みで割り切れない区間は刻みを超えない等間隔にする', () => {
    const out = generateLinearKeys(binding('X', [key(0, 0), key(25, 25)]), { divisions: null, range: 60 });
    expect(out.keys.map((k) => k.coords[0])).toEqual([0, 8.333333333, 16.666666667, 25]);
  });
});
