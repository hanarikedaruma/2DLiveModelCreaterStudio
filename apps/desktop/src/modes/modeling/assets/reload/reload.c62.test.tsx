// カード62（PSD の再読み込みの回転中心・I-035）のテスト。テストの担当は CL（実装の担当は CO）
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newId, type Binding, type Vec2 } from '@app/schema';
import {
  createAssetRepository,
  pngSize,
  type ImportedAsset,
  type Importer,
  type MeshGenerator,
  type Services,
} from '@app/contracts';
import { registry } from '../../../../shell/registry';
import { register as registerAssets } from '../index';
import { assignAssets, importAssetFiles } from '../actions';
import { pngBytes, renderShell, testServices } from '../testShell';
import { register as registerReload } from './index';
import { importWarningsOf } from '../warnings';
import { rebuildReloadMeshes, reloadPsd } from './actions';

interface Layer {
  name: string;
  rect: [x: number, y: number, width: number, height: number];
  hash: string;
  opaque?: 'left' | 'all'; // 画素の不透明な所（描き足しのテスト用。無ければ透明）
}

const psd = () => new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1]);

function importer(files: Record<string, Layer[]>): Importer {
  return {
    async importFiles(list) {
      const assets: ImportedAsset[] = [];
      for (const file of list) {
        for (const [i, l] of (files[file.name] ?? []).entries()) {
          const id = newId();
          const [x, y, width, height] = l.rect;
          assets.push({
            asset: {
              id,
              path: `assets/${id}.png`,
              hash: l.hash,
              width,
              height,
              offset: { x, y },
              canvasSize: { width: 1200, height: 1000 },
              source: { kind: 'psd', file: file.name, layerName: l.name, layerPath: ['顔'], hidden: false },
              sourceBlendMode: 'normal',
              sourceOpacity: 1,
            },
            png: pngBytes(width, height, l.opaque === 'left' ? 1 : l.opaque === 'all' ? 2 : 10 + i),
          });
        }
      }
      return { assets, warnings: [] };
    },
  };
}

// 瞳は大きさも絵も同じで、位置だけ右へ 15・下へ 5 ずらした
const V1: Layer[] = [{ name: '瞳', rect: [600, 300, 20, 20], hash: 'iris' }];
const V2: Layer[] = [{ name: '瞳', rect: [615, 305, 20, 20], hash: 'iris' }];

async function setup(): Promise<Services> {
  const services = testServices({ importer: importer({ 'model.psd': V1, 'model_v2.psd': V2 }) });
  await importAssetFiles(services, [{ name: 'model.psd', data: psd() }]);
  importWarningsOf(services).set([]);
  const asset = services.store.get().assets[0]!;
  assignAssets(services, { kind: 'standard', type: 'irisL' }, [asset.id]);
  return services;
}

const iris = (s: Services) => s.store.get().model.parts.find((p) => p.standardType === 'irisL')!;
const meshOf = (s: Services) => s.store.get().model.meshes.find((m) => m.id === iris(s).meshId)!;

describe('カード62: 位置だけ変わった素材のパーツは、回転中心も同じだけずらす（I-035）', () => {
  it('メッシュと回転中心が同じだけずれ、回転中心から見た頂点の位置（回転の見た目）が変わらない', async () => {
    const services = await setup();
    const before = iris(services);
    const beforeMesh = meshOf(services);
    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psd() }, 'model.psd');
    expect(outcome.ok).toBe(true);
    const after = iris(services);
    const afterMesh = meshOf(services);
    expect(after.pivot).toEqual({ x: before.pivot.x + 15, y: before.pivot.y + 5 });
    afterMesh.vertices.forEach((v, i) => {
      const b = beforeMesh.vertices[i]!;
      expect({ x: v.x - after.pivot.x, y: v.y - after.pivot.y }).toEqual({
        x: b.x - before.pivot.x,
        y: b.y - before.pivot.y,
      });
    });
  });

  it('1回の Undo で、回転中心もメッシュも元に戻る', async () => {
    const services = await setup();
    const loaded = services.store.get();
    await reloadPsd(services, { name: 'model_v2.psd', data: psd() }, 'model.psd');
    services.store.undo();
    expect(services.store.get()).toBe(loaded);
  });
});

describe('カード62: 結果の一覧は Undo で閉じる（I-036）', () => {
  it('読み込み直したあと Ctrl+Z で Undo すると、結果の一覧が残らない', async () => {
    registry.reset();
    registerAssets();
    registerReload();
    const services = await setup();
    renderShell(services);
    const input = screen.getByLabelText('読み込み直す PSD ファイル') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([psd()], 'model_v2.psd')] } });
    });
    expect(await screen.findByRole('status', { name: '再読み込みの結果' })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    await waitFor(() => expect(screen.queryByRole('status', { name: '再読み込みの結果' })).toBeNull());
  });
});

// pngBytes の seed（33 バイト目）で不透明な所を決める: 1 は左半分だけ、2 は全体、それ以外は透明
const opaqueDecode: NonNullable<NonNullable<Parameters<typeof createAssetRepository>[0]>['decode']> = async (png) => {
  const { width, height } = pngSize(png);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (png[32] === 2 || (png[32] === 1 && x < width / 2)) data[(y * width + x) * 4 + 3] = 255;
  const image = { width, height, close() {} } as unknown as ImageBitmap;
  return { image, imageData: { width, height, data, colorSpace: 'srgb' } as ImageData };
};

// 不透明な所の外接矩形を覆うメッシュ（本物の生成と同じく、透明な余白には頂点を置かない）
const opaqueBoundsMesh: MeshGenerator = {
  generate(alpha, offset) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < alpha.height; y++)
      for (let x = 0; x < alpha.width; x++)
        if (alpha.data[(y * alpha.width + x) * 4 + 3]! > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x + 1);
        }
    const [x0, x1, y0, y1] = [offset.x + minX, offset.x + maxX, offset.y, offset.y + alpha.height];
    return {
      vertices: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      uvs: [
        { x: minX / alpha.width, y: 0 },
        { x: maxX / alpha.width, y: 0 },
        { x: maxX / alpha.width, y: 1 },
        { x: minX / alpha.width, y: 1 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    };
  },
};

// 位置も大きさも同じで、絵だけ右半分に描き足した（V1 は左半分だけ不透明）
const LEFT: Layer[] = [{ name: '瞳', rect: [600, 300, 20, 20], hash: 'iris-left', opaque: 'left' }];
const FULL: Layer[] = [{ name: '瞳', rect: [600, 300, 20, 20], hash: 'iris-full', opaque: 'all' }];
// 絵は変わったが（ハッシュが違う）、不透明な所は前と同じ左半分
const REPAINTED: Layer[] = [{ name: '瞳', rect: [600, 300, 20, 20], hash: 'iris-left-2', opaque: 'left' }];

// 頂点の差分は y だけで決まる（上端 0・下端 10 の右向き）。重心座標の補間で、どの点でも同じ式になる
const shear = (v: Vec2): Vec2 => ({ x: (v.y - 300) * 0.5, y: 0 });

describe('カード62: 描き足した素材を知らせ、メッシュを作り直してもキーの見た目が保たれる（I-034）', () => {
  async function drawnOut() {
    const services = testServices({
      importer: importer({ 'model.psd': LEFT, 'model_v2.psd': FULL, 'model_v3.psd': REPAINTED }),
      assets: createAssetRepository({ decode: opaqueDecode }),
      meshGenerator: opaqueBoundsMesh,
    });
    await importAssetFiles(services, [{ name: 'model.psd', data: psd() }]);
    importWarningsOf(services).set([]);
    assignAssets(services, { kind: 'standard', type: 'irisL' }, [services.store.get().assets[0]!.id]);
    // 前のメッシュ（左半分）に、EyeBallX ＝ 1 の変形のキーを付ける
    const mesh = meshOf(services);
    const binding: Binding = {
      id: 'b-shear',
      target: { type: 'mesh', id: mesh.id },
      channel: 'vertices',
      parameterIds: ['EyeBallX'],
      keyValues: [[0, 1]],
      keys: [
        { coords: [0], delta: mesh.vertices.map(() => ({ x: 0, y: 0 })), source: 'manual', locked: false },
        { coords: [1], delta: mesh.vertices.map(shear), source: 'manual', locked: true },
      ],
      generation: 'linear',
      divisions: null,
    };
    services.store.load({
      ...services.store.get(),
      model: { ...services.store.get().model, bindings: [...services.store.get().model.bindings, binding] },
    });
    return services;
  }

  it('前のメッシュの外に描き足した素材が、結果の uncovered に出る', async () => {
    const services = await drawnOut();
    expect(Math.max(...meshOf(services).vertices.map((v) => v.x))).toBe(610);
    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psd() }, 'model.psd');
    expect(outcome.ok && outcome.summary.uncovered?.map((u) => u.name)).toEqual(['瞳']);
  });

  it('絵が変わっても、不透明な所が前のメッシュの中だけなら uncovered は出ない', async () => {
    const services = await drawnOut();
    const outcome = await reloadPsd(services, { name: 'model_v3.psd', data: psd() }, 'model.psd');
    expect(outcome.ok && outcome.summary.updated.map((u) => u.change)).toEqual(['image']);
    expect(outcome.ok && outcome.summary.uncovered).toBeFalsy();
  });

  it('まとめて作り直すと描き足した所まで覆い、キーの差分は同じ式のまま（手動・ロックも保つ）。1回の Undo で戻る', async () => {
    const services = await drawnOut();
    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psd() }, 'model.psd');
    if (!outcome.ok) throw new Error(outcome.error);
    const reloaded = services.store.get();
    const messages: string[] = [];
    const done = await rebuildReloadMeshes(
      services,
      { confirm: async (m) => (messages.push(m), true), notify: (m) => messages.push(m) },
      outcome.summary.uncovered!.map((u) => u.assetId),
    );
    expect(done).toBe(true);
    expect(messages[0]).toContain('変形のキーを新しいメッシュへ移します');
    const mesh = meshOf(services);
    expect(Math.max(...mesh.vertices.map((v) => v.x))).toBe(620);
    const b = services.store.get().model.bindings.find((x) => x.id === 'b-shear')!;
    const key = b.keys.find((k) => k.coords[0] === 1)!;
    expect(key.source).toBe('manual');
    expect(key.locked).toBe(true);
    (key.delta as Vec2[]).forEach((d, i) => {
      const want = shear(mesh.vertices[i]!);
      expect(d.x).toBeCloseTo(want.x, 9);
      expect(d.y).toBeCloseTo(want.y, 9);
    });
    services.store.undo();
    expect(services.store.get()).toBe(reloaded);
  });

  it('確認で取り消すと何も変えない', async () => {
    const services = await drawnOut();
    const outcome = await reloadPsd(services, { name: 'model_v2.psd', data: psd() }, 'model.psd');
    if (!outcome.ok) throw new Error(outcome.error);
    const reloaded = services.store.get();
    const done = await rebuildReloadMeshes(
      services,
      { confirm: async () => false, notify: () => {} },
      outcome.summary.uncovered!.map((u) => u.assetId),
    );
    expect(done).toBe(false);
    expect(services.store.get()).toBe(reloaded);
  });
});
