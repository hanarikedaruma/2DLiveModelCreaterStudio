// カード64（左右反転コピーの符号・I-006）のテスト。テストの担当は CL（実装の担当は CO）
import { describe, expect, it } from 'vitest';
import { createBindingEvaluator } from '@app/core';
import {
  createEmptyProject,
  standardParametersFor,
  type Binding,
  type Model,
  type Parameter,
  type TransformDelta,
} from '@app/schema';
import { mirrorBinding } from './mirrorCopy';

const evaluator = createBindingEvaluator();

function delta(x: number, rotation = 0): TransformDelta {
  return { position: { x, y: 0 }, rotation, scale: { x: 1, y: 1 }, opacity: 1 };
}

function model(bindings: Binding[], extra: Parameter[] = []): Model {
  const base = createEmptyProject('反転').model;
  const part = {
    id: 'p1',
    name: '瞳 R',
    kind: 'image' as const,
    standardType: 'irisR' as const,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  };
  return {
    ...base,
    parameters: [...standardParametersFor('step1'), ...extra],
    parts: [part],
    drawOrder: ['p1'],
    bindings,
  };
}

// 1つのパラメータのバインディング（キーは値 → 差分）
function binding(parameterId: string, keys: [number, TransformDelta][]): Binding {
  return {
    id: `b-${parameterId}`,
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [keys.map(([v]) => v)],
    keys: keys.map(([v, d]) => ({ coords: [v], delta: d, source: 'manual', locked: false })),
    generation: 'linear',
    divisions: null,
  };
}

// その値での位置の差分 x と回転（評価して確かめる）
function at(m: Model, b: Binding, values: Record<string, number>) {
  const out = evaluator.evaluate({ ...m, bindings: [b] }, values);
  const d = out.transforms['p1'];
  return { x: d?.position.x ?? 0, rotation: d?.rotation ?? 0 };
}

describe('カード64: 向きのあるパラメータは、反転したパーツが鏡像として同じ向きへ動く', () => {
  it('瞳（EyeBallX）: 右を見ると、反転した瞳も同じ右へ動く', () => {
    const original = binding('EyeBallX', [
      [-1, delta(-6)],
      [0, delta(0)],
      [1, delta(6)],
    ]);
    const m = model([original]);
    const mirrored = mirrorBinding(m, original);
    expect(mirrored.parameterIds).toEqual(['EyeBallX']);
    expect(at(m, original, { EyeBallX: 1 }).x).toBeCloseTo(6, 9);
    expect(at(m, mirrored, { EyeBallX: 1 }).x).toBeCloseTo(6, 9);
    expect(at(m, mirrored, { EyeBallX: -0.5 }).x).toBeCloseTo(-3, 9);
    for (const v of [-1, -0.5, 0.5, 1]) {
      expect(at(m, mirrored, { EyeBallX: v }).x).toBeCloseTo(at(m, original, { EyeBallX: v }).x, 9);
    }
  });

  it('非対称なキーでも鏡像になる（反転したパーツの v の動きは、元の −v の動きを左右反転したもの）', () => {
    const original = binding('FaceAngleX', [
      [-30, delta(-4)],
      [0, delta(0)],
      [30, delta(10)],
    ]);
    const m = model([original]);
    const mirrored = mirrorBinding(m, original);
    // 反転したパーツの +30 は、元の −30（−4）を左右反転した +4。元の +30 は 10
    expect(at(m, original, { FaceAngleX: 30 }).x).toBeCloseTo(10, 9);
    expect(at(m, mirrored, { FaceAngleX: 30 }).x).toBeCloseTo(4, 9);
    expect(at(m, mirrored, { FaceAngleX: -30 }).x).toBeCloseTo(-10, 9);
    for (const v of [-30, -15, 15, 30]) {
      expect(at(m, mirrored, { FaceAngleX: v }).x).toBeCloseTo(-at(m, original, { FaceAngleX: -v }).x, 9);
    }
    // キーの位置の並びは小さい順のまま
    expect(mirrored.keyValues[0]).toEqual([-30, 0, 30]);
  });

  it('傾き（FaceAngleZ・BodyAngleZ）と体の左右（BodyAngleX）も、反対側のキーを反転して使う', () => {
    for (const id of ['FaceAngleZ', 'BodyAngleZ', 'BodyAngleX']) {
      const original = binding(id, [
        [-10, delta(-2, -8)],
        [0, delta(0, 0)],
        [10, delta(5, 12)],
      ]);
      const m = model([original]);
      const mirrored = mirrorBinding(m, original);
      expect(at(m, original, { [id]: 10 }).rotation).toBeCloseTo(12, 9);
      expect(at(m, mirrored, { [id]: 10 }).rotation).toBeCloseTo(8, 9);
      for (const v of [-10, 10]) {
        const a = at(m, mirrored, { [id]: v });
        const b = at(m, original, { [id]: -v });
        expect(a.x).toBeCloseTo(-b.x, 9);
        expect(a.rotation).toBeCloseTo(-b.rotation, 9);
      }
    }
  });
});

describe('カード64: 組のある・向きの無いパラメータは前と同じ', () => {
  it('組のある EyeOpenR → EyeOpenL: id を入れ替え、キーの位置はそのまま、差分の x を反転する', () => {
    const original = binding('EyeOpenR', [
      [0, delta(3)],
      [1, delta(0)],
    ]);
    const mirrored = mirrorBinding(model([original]), original);
    expect(mirrored.parameterIds).toEqual(['EyeOpenL']);
    expect(mirrored.keys.map((k) => k.coords)).toEqual([[0], [1]]);
    expect((mirrored.keys[0]!.delta as TransformDelta).position.x).toBe(-3);
  });

  it('向きの無い MouthOpen: キーの位置はそのまま、差分の x と回転を反転する', () => {
    const original = binding('MouthOpen', [
      [0, delta(0)],
      [1, delta(2, 5)],
    ]);
    const mirrored = mirrorBinding(model([original]), original);
    expect(mirrored.keys.map((k) => k.coords)).toEqual([[0], [1]]);
    expect(mirrored.keys[1]!.delta).toMatchObject({ position: { x: -2 }, rotation: -5 });
  });
});

const userParam = (id: string): Parameter => ({
  id,
  name: id,
  groupId: 'other',
  min: -10,
  max: 10,
  default: 0,
  standard: false,
});

describe('カード64: ユーザー定義パラメータは前と同じ（名前が向きらしくても、キーの位置は反転しない）', () => {
  it('組の無いユーザー定義（TailAngleX）: キーの位置はそのまま、差分の x と回転を反転する', () => {
    const original = binding('TailAngleX', [
      [-10, delta(-2, -8)],
      [0, delta(0)],
      [10, delta(5, 12)],
    ]);
    const m = model([original], [userParam('TailAngleX')]);
    const mirrored = mirrorBinding(m, original);
    expect(mirrored.parameterIds).toEqual(['TailAngleX']);
    expect(mirrored.keyValues[0]).toEqual([-10, 0, 10]);
    // 反転したパーツの +10 は、元の +10（5・12）を左右反転した −5・−12
    expect(at(m, mirrored, { TailAngleX: 10 })).toEqual({ x: -5, rotation: -12 });
    expect(at(m, mirrored, { TailAngleX: -10 })).toEqual({ x: 2, rotation: 8 });
  });

  it('組のあるユーザー定義（WingL ↔ WingR）: 相手の id へ入れ替え、キーの位置はそのまま', () => {
    const original = binding('WingR', [
      [0, delta(0)],
      [10, delta(4, 6)],
    ]);
    const m = model([original], [userParam('WingL'), userParam('WingR')]);
    const mirrored = mirrorBinding(m, original);
    expect(mirrored.parameterIds).toEqual(['WingL']);
    expect(mirrored.keys.map((k) => k.coords)).toEqual([[0], [10]]);
    expect(mirrored.keys[1]!.delta).toMatchObject({ position: { x: -4 }, rotation: -6 });
  });
});
