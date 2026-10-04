import {
  createEmptyProject,
  type Asset,
  type Binding,
  type Mesh,
  type Model,
  type Part,
  type TransformDelta,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { faceWidthOf, headImageParts } from './depth';
import type { Rect } from './bounds';
import { createKeyGenerator } from './keyGenerator';
import { transformDelta } from './keys';

function part(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: `asset-${id}`,
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

const group = (id: string, patch: Partial<Part> = {}) => part(id, { kind: 'group', assetId: null, ...patch });

function asset(id: string, x: number, y: number, width: number, height: number): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: '',
    width,
    height,
    offset: { x, y },
    canvasSize: { width: 1000, height: 1000 },
    source: { kind: 'png', file: `${id}.png` },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
  };
}

function rectMesh(id: string, x: number, y: number, width: number, height: number): Mesh {
  return {
    id,
    vertices: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    density: 'light',
    edited: false,
  };
}

// 頭の下に 顔（faceGroup の中）・前髪・後ろ髪・頭の中の自由パーツ、頭の外に胴体
function model(): Model {
  const base = createEmptyProject('t').model;
  return {
    ...base,
    parts: [
      group('body', { standardType: 'bodyRoot' }),
      group('head', { standardType: 'headRoot', parentId: 'body' }),
      group('faceG', { standardType: 'faceGroup', parentId: 'head' }),
      part('face', { standardType: 'face', parentId: 'faceG', depth: 0.2 }),
      part('front', { standardType: 'frontHair', parentId: 'head', depth: 1 }),
      part('back', { standardType: 'backHair', parentId: 'head', depth: -1 }),
      part('ribbon', { parentId: 'head', depth: 0 }),
      part('torso', { standardType: 'torso', parentId: 'body' }),
    ],
    drawOrder: ['back', 'torso', 'face', 'front', 'ribbon'],
  };
}

const assets = [asset('asset-face', 300, 200, 400, 500), asset('asset-front', 280, 150, 440, 200)];
const generator = createKeyGenerator({ assets: () => assets });

const deltaAt = (b: Binding | undefined, coord: number) =>
  b?.keys.find((k) => k.coords[0] === coord)?.delta as TransformDelta | undefined;
const of = (bindings: Binding[], partId: string) => bindings.find((b) => b.target.id === partId);

// 結果のバインディングをモデルに入れる（同じ id は置き換え、無ければ足す）
function merge(m: Model, bindings: Binding[]): Model {
  const ids = new Set(bindings.map((b) => b.id));
  return { ...m, bindings: [...m.bindings.filter((b) => !ids.has(b.id)), ...bindings] };
}

describe('depthParallax', () => {
  it('headRoot 配下の画像パーツごとに1つ作る（キーは −30・0・30、source auto、generation depth）', () => {
    const out = generator.depthParallax(model(), 'FaceAngleX');
    expect(out.map((b) => b.target.id)).toEqual(['face', 'front', 'back', 'ribbon']);
    for (const b of out) {
      expect(b).toMatchObject({
        channel: 'transform',
        target: { type: 'part' },
        parameterIds: ['FaceAngleX'],
        keyValues: [[-30, 0, 30]],
        generation: 'depth',
        divisions: null,
      });
      expect(b.keys.map((k) => [k.coords[0], k.source, k.locked])).toEqual([
        [-30, 'auto', false],
        [0, 'auto', false],
        [30, 'auto', false],
      ]);
      expect(deltaAt(b, 0)).toEqual(transformDelta());
    }
  });

  it('FaceAngleX 正で手前のパーツは右へ、奥のパーツは左へ（幅は顔の素材の幅）', () => {
    const out = generator.depthParallax(model(), 'FaceAngleX');
    // 1.0 × (30/30) × 400 × 0.08 = 32
    expect(deltaAt(of(out, 'front'), 30)!.position).toEqual({ x: 32, y: 0 });
    expect(deltaAt(of(out, 'back'), 30)!.position).toEqual({ x: -32, y: 0 });
    expect(deltaAt(of(out, 'front'), -30)!.position).toEqual({ x: -32, y: 0 });
    expect(deltaAt(of(out, 'back'), -30)!.position).toEqual({ x: 32, y: 0 });
    expect(deltaAt(of(out, 'face'), 30)!.position.x).toBeCloseTo(6.4);
    // 奥行き 0 のパーツは動かない
    expect(deltaAt(of(out, 'ribbon'), 30)).toEqual(transformDelta());
  });

  it('FaceAngleY 正（上を向く）で手前のパーツは上へ、奥のパーツは下へ', () => {
    const out = generator.depthParallax(model(), 'FaceAngleY');
    expect(deltaAt(of(out, 'front'), 30)!.position).toEqual({ x: 0, y: -32 });
    expect(deltaAt(of(out, 'back'), 30)!.position).toEqual({ x: 0, y: 32 });
    expect(deltaAt(of(out, 'front'), -30)!.position).toEqual({ x: 0, y: 32 });
    // 縦では顔を縮めない
    expect(deltaAt(of(out, 'face'), 30)!.scale).toEqual({ x: 1, y: 1 });
  });

  it('顔の輪郭は FaceAngleX のとき横に縮む（30度で 0.96）', () => {
    const out = generator.depthParallax(model(), 'FaceAngleX');
    const face = of(out, 'face');
    expect(deltaAt(face, 30)!.scale.x).toBeCloseTo(0.96);
    expect(deltaAt(face, -30)!.scale.x).toBeCloseTo(0.96);
    expect(deltaAt(face, 0)!.scale.x).toBe(1);
    expect(deltaAt(face, 30)!.scale.y).toBe(1);
    // 顔以外は縮めない
    expect(deltaAt(of(out, 'front'), 30)!.scale).toEqual({ x: 1, y: 1 });
  });

  it('2回実行しても結果が同じ', () => {
    const m = model();
    const first = generator.depthParallax(m, 'FaceAngleX');
    const applied = merge(m, first);
    const second = generator.depthParallax(applied, 'FaceAngleX');
    expect(second).toEqual(first);
    // 作り直しても同じなので、既存のバインディングをそのまま返す
    second.forEach((b, i) => expect(b).toBe(applied.bindings[i]));
    expect(merge(applied, second)).toEqual(applied);
  });

  it('あれば未ロックのキーだけ作り直す（ロックされたキーと id は残る）', () => {
    const m = model();
    const lockedKey = { coords: [30], delta: transformDelta({ x: 99 }), source: 'manual' as const, locked: true };
    const existing: Binding = {
      id: 'mine',
      target: { type: 'part', id: 'front' },
      channel: 'transform',
      parameterIds: ['FaceAngleX'],
      keyValues: [[-30, 0, 15, 30]],
      keys: [
        { coords: [-30], delta: transformDelta({ x: 1 }), source: 'manual', locked: false },
        { coords: [0], delta: transformDelta(), source: 'auto', locked: false },
        { coords: [15], delta: transformDelta({ x: 7 }), source: 'generated', locked: false },
        lockedKey,
      ],
      generation: 'linear',
      divisions: 3,
    };
    const out = generator.depthParallax({ ...m, bindings: [existing] }, 'FaceAngleX');
    const front = of(out, 'front')!;
    expect(front.id).toBe('mine');
    expect(front.generation).toBe('depth');
    expect(front.divisions).toBe(3);
    expect(front.keyValues).toEqual([[-30, 0, 30]]);
    expect(front.keys[2]).toBe(lockedKey);
    expect(front.keys[0]).toEqual({ coords: [-30], delta: transformDelta({ x: -32 }), source: 'auto', locked: false });
    expect(out.filter((b) => b.id === 'mine')).toHaveLength(1);
  });

  it('素材が無ければメッシュの外接矩形から顔の幅を求める', () => {
    const m = model();
    const withMesh: Model = {
      ...m,
      parts: m.parts.map((p) => (p.id === 'face' ? { ...p, meshId: 'mesh-face' } : p)),
      meshes: [rectMesh('mesh-face', 300, 200, 200, 300)],
    };
    const out = createKeyGenerator().depthParallax(withMesh, 'FaceAngleX');
    // 1.0 × 1 × 200 × 0.08 = 16
    expect(deltaAt(of(out, 'front'), 30)!.position.x).toBeCloseTo(16);
  });

  it('顔の幅が分からなければ何も作らない', () => {
    expect(createKeyGenerator().depthParallax(model(), 'FaceAngleX')).toEqual([]);
  });

  it('headRoot が無ければ何も作らない', () => {
    const m = model();
    const noHead = { ...m, parts: m.parts.filter((p) => p.standardType !== 'headRoot') };
    expect(generator.depthParallax(noHead, 'FaceAngleX')).toEqual([]);
  });

  it('入力のモデルを書き換えない', () => {
    const m = model();
    const before = structuredClone(m);
    generator.depthParallax(m, 'FaceAngleY');
    expect(m).toEqual(before);
  });
});

describe('奥行きの補助', () => {
  it('headImageParts は headRoot の子孫の画像パーツだけ（循環しても止まる）', () => {
    const m = model();
    expect(headImageParts(m).map((p) => p.id)).toEqual(['face', 'front', 'back', 'ribbon']);
    const loop: Model = {
      ...m,
      parts: [...m.parts, group('a', { parentId: 'b' }), group('b', { parentId: 'a' }), part('c', { parentId: 'a' })],
    };
    expect(headImageParts(loop).map((p) => p.id)).toEqual(['face', 'front', 'back', 'ribbon']);
  });

  it('faceWidthOf は顔が無ければ headRoot 配下の外接矩形の幅', () => {
    const m = model();
    const noFace: Model = { ...m, parts: m.parts.filter((p) => p.id !== 'face') };
    const rects: Record<string, Rect> = {
      front: { x: 100, y: 0, width: 50, height: 10 },
      back: { x: 120, y: 0, width: 100, height: 10 },
    };
    expect(faceWidthOf(noFace, (p) => rects[p.id] ?? null)).toBe(120);
    expect(faceWidthOf(noFace, () => null)).toBe(0);
  });
});
