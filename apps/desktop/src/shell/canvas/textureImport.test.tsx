// カード57の回帰テスト。取り込んだだけの画像をGPUへ上げず、割り当て・Undo・差し替えへ追従する。
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '@app/contracts';
import { assignAssets, importAssetFiles } from '../../modes/modeling/assets/actions';
import { pngBytes, renderShell, testServices } from '../../modes/modeling/assets/testShell';
import { registry } from '../registry';

afterEach(() => registry.reset());

describe('取り込んだ素材とキャンバスの画像（カード57）', () => {
  it('未割り当ては渡さず、割り当て・画像の差し替え・Undo・別プロジェクトで更新する', async () => {
    const setTextures = vi.fn();
    const renderer: Renderer = { init() {}, setTextures, render() {}, dispose() {} };
    const services = testServices({ createRenderer: () => renderer });
    await importAssetFiles(services, [
      { name: 'a.png', data: pngBytes(8, 8) },
      { name: 'b.png', data: pngBytes(8, 8, 1) },
    ]);
    const asset = services.store.get().assets[0]!;
    renderShell(services);
    expect(setTextures).toHaveBeenLastCalledWith({});

    act(() => assignAssets(services, { kind: 'free', partId: null, name: '画像' }, [asset.id]));
    expect(setTextures).toHaveBeenLastCalledWith({ [asset.id]: services.assets.getImage(asset.id) });
    const previous = services.assets.getImage(asset.id);
    await act(() => services.assets.put(asset.id, pngBytes(9, 9)));
    expect(services.assets.getImage(asset.id)).not.toBe(previous);
    expect(setTextures).toHaveBeenLastCalledWith({ [asset.id]: services.assets.getImage(asset.id) });

    act(() => services.store.undo());
    expect(setTextures).toHaveBeenLastCalledWith({});
    act(() => services.store.redo());
    expect(setTextures).toHaveBeenLastCalledWith({ [asset.id]: services.assets.getImage(asset.id) });
    const other = testServices().store.get();
    act(() => services.store.load(other));
    expect(setTextures).toHaveBeenLastCalledWith({});
    expect(services.assets.getImage(asset.id)).toBeDefined();
  });
});
