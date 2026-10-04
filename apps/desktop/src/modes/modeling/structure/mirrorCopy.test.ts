import { describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '@app/core';
import { validateProject, type TransformDelta } from '@app/schema';
import { createAssetRepository } from '@app/contracts';
import {
  mirrorCenterX,
  mirrorCopy,
  mirrorParameterId,
  mirrorStandardType,
  mirroredAsset,
  prepareMirror,
  swapLR,
  type MirrorPrepared,
} from './mirrorCopy';
import { childrenOf } from './modelOps';
import { counterIds, makeAsset, makeBinding, makeMesh, makePart, makeProject } from './testing';

const ids = (parts: { id: string }[]) => parts.map((p) => p.id);

const delta = (x: number, y: number, rotation: number): TransformDelta => ({
  position: { x, y },
  rotation,
  scale: { x: 1.2, y: 1 },
  opacity: 0.5,
});

// 左目のグループ（白目は画像とメッシュ、瞳は画像だけ）。キャンバスの幅は 1000
function project() {
  return makeProject({
    assets: [
      makeAsset('W', {
        offset: { x: 600, y: 300 },
        width: 100,
        height: 40,
        canvasSize: { width: 1000, height: 1000 },
        source: { kind: 'psd', file: 'm.psd', layerName: '白目 L' },
      }),
      makeAsset('I', { offset: { x: 630, y: 300 }, width: 30, height: 40, canvasSize: { width: 1000, height: 1000 } }),
    ],
    parts: [
      makePart('eyeL', {
        kind: 'group',
        name: '目 L',
        standardType: 'eyeGroupL',
        pivot: { x: 650, y: 320 },
        position: { x: 5, y: 2 },
        rotation: 10,
      }),
      makePart('white', { parentId: 'eyeL', name: '白目 L', standardType: 'eyeWhiteL', assetId: 'W', meshId: 'mw' }),
      makePart('iris', { parentId: 'eyeL', name: '瞳', standardType: null, assetId: 'I', pivot: { x: 645, y: 320 } }),
    ],
    drawOrder: ['white', 'iris'],
    meshes: [
      makeMesh('mw', {
        vertices: [
          { x: 600, y: 300 },
          { x: 700, y: 300 },
          { x: 600, y: 340 },
        ],
        uvs: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        triangles: [[0, 1, 2]],
      }),
    ],
    bindings: [
      makeBinding('b-eye', {
        target: { type: 'part', id: 'eyeL' },
        parameterIds: ['EyeOpenL', 'FaceAngleX'],
        keyValues: [
          [0, 1],
          [-30, 0, 30],
        ],
        keys: [{ coords: [0, 30], delta: delta(4, -3, 12), source: 'manual', locked: false }],
      }),
      makeBinding('b-mesh', {
        target: { type: 'mesh', id: 'mw' },
        channel: 'vertices',
        parameterIds: ['EyeOpenL'],
        keyValues: [[0, 1]],
        keys: [
          {
            coords: [0],
            delta: [
              { x: 2, y: 5 },
              { x: -1, y: 5 },
              { x: 0, y: -2 },
            ],
            source: 'auto',
            locked: false,
          },
        ],
      }),
      makeBinding('b-other', { target: { type: 'part', id: 'iris' }, parameterIds: ['MyWinkL'] }),
    ],
  });
}

function prepared(): MirrorPrepared {
  const p = project();
  return {
    centerX: 500,
    assets: [mirroredAsset(p.assets[0]!, 'W2', 'h1', 500), mirroredAsset(p.assets[1]!, 'I2', 'h2', 500)],
    assetMap: { W: 'W2', I: 'I2' },
  };
}

describe('L / R の入れ替え', () => {
  it('末尾の L / R を入れ替える', () => {
    expect(swapLR('EyeOpenL')).toBe('EyeOpenR');
    expect(swapLR('白目 R')).toBe('白目 L');
    expect(swapLR('L')).toBe('R');
    expect(swapLR('BALL')).toBeNull();
    expect(swapLR('Hair')).toBeNull();
  });

  it('standardType とパラメータ id', () => {
    expect(mirrorStandardType('irisL')).toBe('irisR');
    expect(mirrorStandardType('armRootR')).toBe('armRootL');
    expect(mirrorStandardType('face')).toBeNull();
    const { model } = project();
    expect(mirrorParameterId(model, 'EyeOpenL')).toBe('EyeOpenR');
    expect(mirrorParameterId(model, 'FaceAngleX')).toBe('FaceAngleX');
    // 入れ替えた先のパラメータが無ければそのまま
    expect(mirrorParameterId(model, 'MyWinkL')).toBe('MyWinkL');
  });
});

describe('中心線', () => {
  it('bodyRoot があればそのピボットの x、無ければキャンバスの中央', () => {
    const p = project();
    expect(mirrorCenterX(p, ['W'])).toBe(500);
    const withRoot = {
      ...p,
      model: {
        ...p.model,
        parts: [
          ...p.model.parts,
          makePart('root', { kind: 'group', standardType: 'bodyRoot', pivot: { x: 480, y: 0 } }),
        ],
      },
    };
    expect(mirrorCenterX(withRoot, ['W'])).toBe(480);
    expect(mirrorCenterX(makeProject())).toBe(0);
  });

  it('素材の位置を中心線で反転する', () => {
    const a = mirroredAsset(project().assets[0]!, 'X', 'hash', 500);
    expect(a).toMatchObject({ id: 'X', path: 'assets/X.png', hash: 'hash', offset: { x: 300, y: 300 }, width: 100 });
    expect(a.source.layerName).toBe('白目 R');
  });
});

describe('mirrorCopy', () => {
  it('子孫ごと複製し、pivot・頂点・uv を反転、素材を反転した PNG の Asset にする', () => {
    const p = project();
    const next = mirrorCopy(['eyeL'], prepared(), { newId: counterIds('m') }).apply(p);
    const [group, white, iris] = ['m1', 'm2', 'm3'].map((id) => next.model.parts.find((x) => x.id === id)!);
    expect(group).toMatchObject({
      name: '目 R',
      standardType: 'eyeGroupR',
      pivot: { x: 350, y: 320 },
      position: { x: -5, y: 2 },
      rotation: -10,
      parentId: null,
    });
    expect(white).toMatchObject({
      name: '白目 R',
      standardType: 'eyeWhiteR',
      assetId: 'W2',
      meshId: 'm4',
      parentId: 'm1',
    });
    expect(iris).toMatchObject({ name: '瞳', standardType: null, assetId: 'I2', pivot: { x: 355, y: 320 } });
    expect(ids(childrenOf(next.model, null))).toEqual(['eyeL', 'm1']);
    expect(next.assets.map((a) => a.id)).toEqual(['W', 'I', 'W2', 'I2']);

    const mesh = next.model.meshes.find((m) => m.id === 'm4')!;
    expect(mesh.vertices).toEqual([
      { x: 400, y: 300 },
      { x: 300, y: 300 },
      { x: 400, y: 340 },
    ]);
    expect(mesh.uvs).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(mesh.triangles).toEqual([[0, 2, 1]]);
    // uv で反転した素材の中の位置を指すと、反転した頂点の位置と一致する
    const asset = next.assets.find((a) => a.id === 'W2')!;
    mesh.vertices.forEach((v, i) => expect(asset.offset.x + mesh.uvs[i]!.x * asset.width).toBe(v.x));
    expect(next.model.drawOrder).toEqual(['white', 'iris', 'm2', 'm3']);
    expect(() => validateProject(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it('バインディングを複製し、差分の x と回転の符号を反転、パラメータの L / R を入れ替える', () => {
    const next = mirrorCopy(['eyeL'], prepared(), { newId: counterIds('m') }).apply(project());
    const copies = next.model.bindings.filter((b) => !['b-eye', 'b-mesh', 'b-other'].includes(b.id));
    expect(copies).toHaveLength(3);
    const eye = copies.find((b) => b.target.id === 'm1')!;
    expect(eye.parameterIds).toEqual(['EyeOpenR', 'FaceAngleX']);
    expect(eye.keyValues).toEqual([
      [0, 1],
      [-30, 0, 30],
    ]);
    expect(eye.keys[0]).toEqual({ coords: [0, 30], delta: delta(-4, -3, -12), source: 'manual', locked: false });
    const mesh = copies.find((b) => b.target.id === 'm4')!;
    expect(mesh).toMatchObject({ channel: 'vertices', parameterIds: ['EyeOpenR'] });
    expect(mesh.keys[0]!.delta).toEqual([
      { x: -2, y: 5 },
      { x: 1, y: 5 },
      { x: 0, y: -2 },
    ]);
    expect(copies.find((b) => b.target.id === 'm3')!.parameterIds).toEqual(['MyWinkL']);
    // 元のバインディングはそのまま
    expect(next.model.bindings.find((b) => b.id === 'b-eye')!.parameterIds).toEqual(['EyeOpenL', 'FaceAngleX']);
  });

  it('Undo で素材の追加ごと戻る', () => {
    const p = project();
    const store = createProjectStore(p);
    store.dispatch(mirrorCopy(['white'], prepared()));
    expect(store.get().model.parts).toHaveLength(4);
    store.undo();
    expect(store.get()).toBe(p);
  });
});

describe('prepareMirror', () => {
  it('反転した PNG を assets.put し、ハッシュと位置を入れた Asset を作る', async () => {
    const p = project();
    const repo = createAssetRepository({
      decode: async () => ({ image: { close() {} } as unknown as ImageBitmap, imageData: {} as ImageData }),
    });
    await repo.put('W', new Uint8Array([1, 2, 3]));
    await repo.put('I', new Uint8Array([4, 5]));
    const flip = vi.fn(async (png: Uint8Array) => png.slice().reverse());
    const result = await prepareMirror({ store: createProjectStore(p), assets: repo }, ['eyeL'], {
      flip,
      newId: counterIds('a'),
    });
    expect(flip).toHaveBeenCalledTimes(2);
    expect(result.centerX).toBe(500);
    expect(result.assetMap).toEqual({ W: 'a1', I: 'a2' });
    expect([...repo.getPng('a1')!]).toEqual([3, 2, 1]);
    expect(result.assets[0]).toMatchObject({ id: 'a1', offset: { x: 300, y: 300 } });
    expect(result.assets[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PNG が無い素材があれば失敗する', async () => {
    const repo = createAssetRepository({
      decode: async () => ({ image: {} as ImageBitmap, imageData: {} as ImageData }),
    });
    await expect(
      prepareMirror({ store: createProjectStore(project()), assets: repo }, ['white'], { flip: async (x) => x }),
    ).rejects.toThrow('素材の画像が無い');
  });
});
