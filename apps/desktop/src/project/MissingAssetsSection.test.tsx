import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@app/schema';
import type { ImportedAsset, Services } from '@app/contracts';
import { registry } from '../shell/registry';
import { registerPanelSection } from '../shell/api';
import { register as registerAssets } from '../modes/modeling/assets';
import { pngBytes, renderShell, testServices } from '../modes/modeling/assets/testShell';
import type { ProjectActions } from './actions';
import { MISSING_ASSETS_SECTION_ID, MissingAssetsSection, setMissingAssetsActions } from './MissingAssetsSection';

function asset(id: string, layerName: string): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: id,
    width: 10,
    height: 10,
    offset: { x: 0, y: 0 },
    canvasSize: { width: 100, height: 100 },
    source: { kind: 'psd', file: 'model.psd', layerName, layerPath: [] },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
  };
}

function fakeActions(missing: string[]): ProjectActions & { replaced: [string, ImportedAsset][] } {
  const listeners = new Set<() => void>();
  const replaced: [string, ImportedAsset][] = [];
  let ids = missing;
  return {
    replaced,
    dir: () => null,
    isDirty: () => false,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    newProject: async () => {},
    open: async () => {},
    save: async () => {},
    saveAs: async () => {},
    recoverOnStartup: async () => false,
    missingAssetIds: () => ids,
    async replaceMissingAsset(id, imported) {
      replaced.push([id, imported]);
      ids = ids.filter((x) => x !== id);
      listeners.forEach((l) => l());
    },
  };
}

function setup(missing: string[], importer?: Services['importer']) {
  const services = testServices(importer ? { importer } : {});
  services.store.load({
    ...services.store.get(),
    assets: [asset('a1', '前髪'), asset('a2', '後ろ髪')],
  });
  const actions = fakeActions(missing);
  setMissingAssetsActions(actions);
  renderShell(services);
  return { services, actions };
}

beforeEach(() => {
  registry.reset();
  registerAssets();
  registerPanelSection({
    id: MISSING_ASSETS_SECTION_ID,
    panelId: 'assets.tray',
    order: 5,
    component: MissingAssetsSection,
  });
});

describe('欠けた素材の一覧（カード58）', () => {
  it('欠けた素材が無ければ出さない', () => {
    setup([]);
    expect(screen.queryByRole('region', { name: '欠けた素材' })).toBeNull();
  });

  it('欠けた素材を並べ、PSD を選ぶと元と同じ名前のレイヤーで差し替える', async () => {
    const imported: ImportedAsset[] = [
      { asset: asset('n1', '後ろ髪'), png: pngBytes(10, 10, 1) },
      { asset: asset('n2', '前髪'), png: pngBytes(10, 10, 2) },
    ];
    const importer = { importFiles: vi.fn(async () => ({ assets: imported, warnings: [] })) };
    const { actions } = setup(['a1'], importer);
    const region = screen.getByRole('region', { name: '欠けた素材' });
    expect(region.textContent).toContain('model.psd の「前髪」');
    const input = screen.getByLabelText(/を差し替えるファイル$/) as HTMLInputElement;
    const file = new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], 'model.psd');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(actions.replaced).toHaveLength(1));
    expect(actions.replaced[0]![0]).toBe('a1');
    expect(actions.replaced[0]![1].asset.id).toBe('n2');
    await waitFor(() => expect(screen.queryByRole('region', { name: '欠けた素材' })).toBeNull());
  });
});
