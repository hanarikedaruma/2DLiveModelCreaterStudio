import { createEmptyProject, type Part, type Project } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { FakeEvaluator, FakeMixer, FakePipeline, transformPoint } from './evaluate';
import type { Layer } from '../index';

function imagePart(id: string, assetId: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId,
    meshId: null,
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

function projectWith(parts: Part[], drawOrder: string[]): Project {
  const p = createEmptyProject('t');
  return { ...p, model: { ...p.model, parts, drawOrder } };
}

const assets = [
  { id: 'a1', offset: { x: 10, y: 20 }, width: 100, height: 50 },
  { id: 'a2', offset: { x: 0, y: 0 }, width: 10, height: 10 },
];

describe('FakeEvaluator', () => {
  it('差分なし（すべて空）を返す', () => {
    const p = createEmptyProject('t');
    expect(new FakeEvaluator().evaluate(p.model, { FaceAngleX: 30 })).toEqual({
      transforms: {},
      vertices: {},
      warpPoints: {},
    });
  });
});

describe('transformPoint', () => {
  it('pivot を中心に拡縮・回転し、position だけ動かす（時計回りが正）', () => {
    const part = { position: { x: 5, y: 0 }, rotation: 90, scale: { x: 2, y: 2 }, pivot: { x: 10, y: 10 } };
    // pivot から右に 1 の点 → 2 倍で右に 2 → 時計回りに 90 度で下に 2 → x を 5 動かす
    const p = transformPoint(part, { x: 11, y: 10 });
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(12);
  });
});

describe('FakePipeline', () => {
  it('表示中の画像パーツを素材の矩形の三角形2枚にし、drawOrder の順に並べる', () => {
    const p = projectWith(
      [
        imagePart('p1', 'a1', { position: { x: 1, y: 2 }, opacity: 0.5, blendMode: 'multiply' }),
        imagePart('p2', 'a2', { mask: { sourcePartIds: ['p1'], inverted: true } }),
        imagePart('hidden', 'a2', { visible: false }),
        { ...imagePart('group', 'a2'), kind: 'group', assetId: null },
      ],
      ['p2', 'hidden', 'p1', 'missing'],
    );
    const out = new FakePipeline(() => assets).deform(p.model, { transforms: {}, vertices: {}, warpPoints: {} });
    expect(out.items.map((i) => i.partId)).toEqual(['p2', 'p1']);
    const p1 = out.byPartId.p1!;
    expect([...p1.positions]).toEqual([11, 22, 111, 22, 111, 72, 11, 72]);
    expect([...p1.uvs]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect([...p1.indices]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(p1).toMatchObject({ assetId: 'a1', opacity: 0.5, blendMode: 'multiply', mask: null });
    expect(out.byPartId.p2!.mask).toEqual({ sourcePartIds: ['p1'], inverted: true });
  });
});

describe('FakeMixer', () => {
  it('パラメータ別の重みで目だけを継続できる', () => {
    const { parameters } = createEmptyProject('t').model;
    const out = new FakeMixer().mix(parameters, [
      { id: 'tracking', weight: 0, parameterWeights: { EyeOpenL: 1 }, values: { FaceAngleX: 20, EyeOpenL: 0.25 } },
    ]);
    expect(out.FaceAngleX).toBe(0);
    expect(out.EyeOpenL).toBe(0.25);
  });
  it('デフォルト値に、各レイヤーの値を重みで上書きする', () => {
    const { parameters } = createEmptyProject('t').model;
    const out = new FakeMixer().mix(parameters, [
      { id: 'tracking', weight: 1, values: { FaceAngleX: 20, EyeOpenL: 0, Unknown: 5 } },
      { id: 'expression', weight: 0.5, values: { FaceAngleX: 0 } },
    ]);
    expect(out.FaceAngleX).toBe(10);
    expect(out.EyeOpenL).toBe(0);
    expect(out.EyeOpenR).toBe(1);
    expect(out.MouthOpen).toBe(0);
    expect(out).not.toHaveProperty('Unknown');
  });
});

describe('FakeMixer の層の順（STEP3 のカード65）', () => {
  it('配列の順ではなく LAYER_ORDER の順に上書きする', () => {
    const p = { id: 'A', name: 'A', groupId: 'other' as const, min: 0, max: 1, default: 0, standard: false };
    const out = new FakeMixer().mix(
      [p],
      [
        { id: 'hotkey', weight: 1, values: { A: 0.7 } },
        { id: 'auto', weight: 1, values: { A: 0.2 } },
        { id: 'tracking', weight: 1, values: { A: 0.9 } },
      ],
    );
    expect(out.A).toBe(0.7);
  });

  it('合成の方法（add・multiply・max）と範囲への丸めも本物と同じ規則', () => {
    const p = { id: 'A', name: 'A', groupId: 'other' as const, min: -5, max: 5, default: 1, standard: false };
    const mix = (layers: Layer[]) => new FakeMixer().mix([p], layers).A;
    expect(mix([{ id: 'tracking', weight: 0.5, values: { A: 2 }, blend: { A: 'add' } }])).toBe(2); // 1 + 2×0.5
    expect(mix([{ id: 'tracking', weight: 1, values: { A: 3 }, blend: { A: 'multiply' } }])).toBe(3); // 1 × 3
    expect(mix([{ id: 'tracking', weight: 1, values: { A: 0 }, blend: { A: 'max' } }])).toBe(1); // 小さい値では変えない
    expect(mix([{ id: 'tracking', weight: 1, values: { A: 4 }, blend: { A: 'max' } }])).toBe(4);
    expect(mix([{ id: 'tracking', weight: 1, values: { A: 9 }, blend: { A: 'add' } }])).toBe(5); // 1 + 9 を max 5 に丸める
    expect(mix([{ id: 'tracking', weight: 1, values: { A: Number.NaN } }])).toBe(1); // 数でない値は使わない
  });
});
