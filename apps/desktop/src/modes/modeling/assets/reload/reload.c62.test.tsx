// カード62（PSD の再読み込みの回転中心・I-035）のテスト。テストの担当は CL（実装の担当は CO）
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newId } from '@app/schema';
import type { ImportedAsset, Importer, Services } from '@app/contracts';
import { registry } from '../../../../shell/registry';
import { register as registerAssets } from '../index';
import { assignAssets, importAssetFiles } from '../actions';
import { pngBytes, renderShell, testServices } from '../testShell';
import { register as registerReload } from './index';
import { importWarningsOf } from '../warnings';
import { reloadPsd } from './actions';

interface Layer {
  name: string;
  rect: [x: number, y: number, width: number, height: number];
  hash: string;
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
            png: pngBytes(width, height, i),
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
