import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type ParameterKey } from '@app/schema';
import { keyMarksFor, snapToKey } from './marks';

const identity = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
const key = (coords: number[], source: ParameterKey['source'], locked = false): ParameterKey => ({
  coords,
  delta: identity,
  source,
  locked,
});

function binding(id: string, parameterIds: string[], keys: ParameterKey[]): Binding {
  return {
    id,
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds,
    keyValues: parameterIds.map(() => []),
    keys,
    generation: 'linear',
    divisions: null,
  };
}

describe('キーの印', () => {
  it('そのパラメータを使うバインディングのキー位置を出す（● manual・auto、○ generated、■ locked）', () => {
    const project = createEmptyProject('テスト');
    const model = {
      ...project.model,
      bindings: [
        binding('a', ['FaceAngleX'], [key([0], 'auto'), key([15], 'generated'), key([30], 'manual')]),
        binding('b', ['FaceAngleX'], [key([0], 'auto'), key([15], 'manual'), key([-30], 'generated', true)]),
        // 複合キーはグリッド側で扱い、1軸スライダーには表示しない
        binding('c', ['FaceAngleY', 'FaceAngleX'], [key([10, 7.5], 'generated'), key([0, 0], 'auto')]),
        binding('d', ['MouthOpen'], [key([1], 'manual', true)]),
      ],
    };
    // 同じ値は locked > manual・auto > generated で1つにまとめ、値の順に並べる
    expect(keyMarksFor(model, 'FaceAngleX')).toEqual([
      { value: -30, kind: 'locked' },
      { value: 0, kind: 'key' },
      { value: 15, kind: 'key' },
      { value: 30, kind: 'key' },
    ]);
    expect(keyMarksFor(model, 'FaceAngleY')).toEqual([]);
    expect(keyMarksFor(model, 'EyeOpenL')).toEqual([]);
  });
});

describe('キーへの吸い付き', () => {
  it('範囲の 2% 以内なら最も近いキーに吸い付く', () => {
    const keys = [0, 15, 30];
    expect(snapToKey(29, keys, 60)).toBe(30); // 1 ≦ 1.2
    expect(snapToKey(28.7, keys, 60)).toBe(28.7); // 1.3 > 1.2
    expect(snapToKey(15.5, keys, 60)).toBe(15);
    expect(snapToKey(0.985, [0, 1], 1)).toBe(1);
    expect(snapToKey(0.97, [0, 1], 1)).toBe(0.97);
    // 近いほうに吸い付く
    expect(snapToKey(0.5, [0.49, 0.515], 1)).toBe(0.49);
  });
});
