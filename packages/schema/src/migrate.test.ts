import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { ProjectVersionError, SCHEMA_VERSION, loadProjectJson, migrate, migrateWith } from './migrate';
import { ProjectValidationError } from './validate';
import type { Binding, Parameter, Part, TrackingMapping, TransformDelta } from './types';

describe('migrate', () => {
  it('現在の版は4', () => {
    expect(SCHEMA_VERSION).toBe(4);
  });

  it('現在の版は何も変えない', () => {
    const p = createEmptyProject('テスト');
    const before = JSON.stringify(p);
    expect(migrate(p)).toBe(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('このアプリより新しい版のファイルはエラーになる', () => {
    const p = { ...createEmptyProject('テスト'), schemaVersion: 5 };
    expect(() => migrate(p)).toThrow(ProjectVersionError);
    expect(() => migrate(p)).toThrow(/新しい版（5）/);
  });

  it('版が無い・数でないものはエラー', () => {
    expect(() => migrate({})).toThrow(/schemaVersion/);
    expect(() => migrate({ schemaVersion: '1' })).toThrow(/schemaVersion/);
    expect(() => migrate({ schemaVersion: 0 })).toThrow(/schemaVersion/);
    expect(() => migrate([])).toThrow(ProjectVersionError);
  });

  it('変換表で現在の版まで順に変換する', () => {
    const calls: number[] = [];
    const out = migrateWith(
      { schemaVersion: 1, a: 1 },
      {
        1: (j) => {
          calls.push(1);
          return { ...j, b: 2 };
        },
        2: (j) => {
          calls.push(2);
          return { ...j, c: 3 };
        },
      },
      3,
    );
    expect(calls).toEqual([1, 2]);
    expect(out).toEqual({ schemaVersion: 3, a: 1, b: 2, c: 3 });
  });

  it('途中の変換が無ければエラー', () => {
    expect(() => migrateWith({ schemaVersion: 1 }, {}, 2)).toThrow(/版 1 から 2/);
  });
});

describe('1 → 2: 不透明度のキーを倍率から絶対値にする（I-026）', () => {
  const group = (id: string, opacity: number): Part => ({
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
  const delta = (opacity: number, x = 0): TransformDelta => ({
    position: { x, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    opacity,
  });
  const binding = (id: string, partId: string, parameterId: string, keys: [number, TransformDelta][]): Binding => ({
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [keys.map(([c]) => c)],
    keys: keys.map(([c, d]) => ({ coords: [c], delta: d, source: 'manual', locked: false })),
    generation: 'linear',
    divisions: null,
  });
  const param = (id: string, def = 0): Parameter => ({
    id,
    name: id,
    groupId: 'other',
    min: 0,
    max: 1,
    default: def,
    standard: false,
  });
  const v1 = (parts: Part[], bindings: Binding[], parameters = [param('A'), param('B')]) => {
    const p = createEmptyProject('古い版');
    return { ...p, schemaVersion: 1, model: { ...p.model, parts, bindings, parameters } };
  };
  const migrated = (json: unknown) => loadProjectJson(JSON.stringify(json));
  const opacities = (b: Binding | undefined) => b!.keys.map((k) => (k.delta as TransformDelta).opacity);

  it('倍率のキーは「パーツ自身の不透明度」になり、見た目は変わらない', () => {
    const p = migrated(
      v1(
        [group('g', 0.5)],
        [
          binding('b', 'g', 'A', [
            [0, delta(1)],
            [1, delta(0.4)],
          ]),
        ],
      ),
    );
    expect(p.schemaVersion).toBe(4);
    expect(p.model.parts[0]!.opacity).toBe(0.5);
    const b = p.model.bindings[0];
    expect(b!.controlsOpacity).toBe(true);
    expect(opacities(b)[0]).toBeCloseTo(0.5);
    expect(opacities(b)[1]).toBeCloseTo(0.2);
  });

  it('0 の代わりの 0.001（頬染めなど）は 0 にする。デフォルト値で消えていれば Part.opacity を 0 にする', () => {
    const p = migrated(
      v1(
        [group('cheek', 1)],
        [
          binding('b', 'cheek', 'A', [
            [0, delta(0.001)],
            [1, delta(1)],
          ]),
        ],
      ),
    );
    expect(p.model.parts[0]!.opacity).toBe(0);
    expect(opacities(p.model.bindings[0])).toEqual([0, 1]);
  });

  it('不透明度の倍率を持たない transform のバインディングと、ほかのパーツは変えない', () => {
    const json = v1(
      [group('g', 0.5)],
      [
        binding('b', 'g', 'A', [
          [0, delta(1)],
          [1, delta(1, 20)],
        ]),
      ],
    );
    const p = migrated(json);
    expect(p.model.parts[0]!.opacity).toBe(0.5);
    expect(p.model.bindings[0]!.controlsOpacity).toBeUndefined();
    expect(p.model.bindings[0]).toEqual(json.model.bindings[0]);
  });

  it('同じパーツの複数のバインディング: デフォルト値の見た目と、1つずつ動かしたときの見た目を保つ', () => {
    const p = migrated(
      v1(
        [group('g', 1)],
        [
          binding('a', 'g', 'A', [
            [0, delta(1)],
            [1, delta(0.5)],
          ]),
          binding('b', 'g', 'B', [
            [0, delta(0.8)],
            [1, delta(1)],
          ]),
        ],
      ),
    );
    // デフォルト値で 1 × 1 × 0.8
    expect(p.model.parts[0]!.opacity).toBeCloseTo(0.8);
    const [a, b] = p.model.bindings;
    // A だけ 1 にすると 0.5 × 0.8 = 0.4、B だけ 1 にすると 1 × 1 = 1
    expect(opacities(a)).toEqual([expect.closeTo(0.8), expect.closeTo(0.4)]);
    expect(opacities(b)).toEqual([expect.closeTo(0.8), expect.closeTo(1)]);
  });

  it('デフォルト値にキーが無ければ、前後のキーから倍率を求める', () => {
    const p = migrated(
      v1(
        [group('g', 1)],
        [
          binding('b', 'g', 'A', [
            [0, delta(0.2)],
            [1, delta(0.6)],
          ]),
        ],
        [param('A', 0.5)],
      ),
    );
    expect(p.model.parts[0]!.opacity).toBeCloseTo(0.4);
    expect(opacities(p.model.bindings[0])).toEqual([expect.closeTo(0.2), expect.closeTo(0.6)]);
  });
});

describe('2 → 3: トラッキングの割り当ての設定（I-042）', () => {
  const mapping = (input: TrackingMapping['input'], parameterId: string) => ({
    input,
    parameterId,
    inputRange: [-30, 30],
    outputRange: [-30, 30],
    invert: false,
    curve: 'linear',
    smoothing: 0.5,
    deadZone: 0,
  });
  const v2 = (trackingMappings: unknown[]) => {
    const { trackingSetup: _setup, ...p } = createEmptyProject('版 2');
    return { ...p, schemaVersion: 2, trackingMappings };
  };
  const migrated = (json: unknown) => loadProjectJson(JSON.stringify(json));

  it('空の一覧は standard（既定のマッピング）のまま', () => {
    const p = migrated(v2([]));
    expect(p.trackingSetup).toEqual({ mode: 'standard', combine: [] });
    expect(p.trackingMappings).toEqual([]);
  });

  it('一覧があれば custom にし、各割り当てに重み 1 を足す', () => {
    const p = migrated(v2([mapping('faceYaw', 'FaceAngleX'), mapping('mouthOpen', 'MouthOpen')]));
    expect(p.trackingSetup).toEqual({ mode: 'custom', combine: [] });
    expect(p.trackingMappings.map((m) => [m.input, m.weight])).toEqual([
      ['faceYaw', 1],
      ['mouthOpen', 1],
    ]);
  });

  it('同じパラメータへの割り当ては priority にし、後の行（それまで効いていた方）を上にする', () => {
    const p = migrated(
      v2([mapping('faceYaw', 'FaceAngleX'), mapping('mouthOpen', 'MouthOpen'), mapping('eyeBallX', 'FaceAngleX')]),
    );
    expect(p.trackingSetup.combine).toEqual([{ parameterId: 'FaceAngleX', method: 'priority' }]);
    expect(p.trackingMappings.map((m) => m.input)).toEqual(['eyeBallX', 'mouthOpen', 'faceYaw']);
  });
});

describe('loadProjectJson', () => {
  it('解析 → migrate → validate', () => {
    const p = createEmptyProject('テスト');
    expect(loadProjectJson(JSON.stringify(p))).toEqual(p);
  });

  it('JSON でなければエラー', () => {
    expect(() => loadProjectJson('{')).toThrow(/JSON として読めない/);
  });

  it('形が違えば検証のエラー', () => {
    const p = { ...createEmptyProject('テスト'), name: 1 };
    expect(() => loadProjectJson(JSON.stringify(p))).toThrow(ProjectValidationError);
  });
});
