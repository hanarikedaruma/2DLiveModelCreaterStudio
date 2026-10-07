// カード57の回帰テスト。多くのPNGのBlobを同じタスクで作らず、消えたサムネイルの準備を取り消す。
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetThumb } from './thumbnail';
import { pngBytes, testServices } from './testShell';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('サムネイルの準備（カード57）', () => {
  it('画像ごとに別のタスクでURLを作り、表示を終えたURLを解放する', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const services = testServices();
    await services.assets.put('a', pngBytes(8, 8));
    await services.assets.put('b', pngBytes(8, 8));
    const view = render(
      <>
        <AssetThumb repo={services.assets} assetId="a" alt="a" />
        <AssetThumb repo={services.assets} assetId="b" alt="b" />
      </>,
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(2);
    act(() => vi.runOnlyPendingTimers());
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(view.container.querySelectorAll('img')).toHaveLength(2);
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('準備が始まる前に消えたサムネイルはBlobやURLを作らない', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:test');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const services = testServices();
    await services.assets.put('a', pngBytes(8, 8));
    const view = render(<AssetThumb repo={services.assets} assetId="a" alt="a" />);
    view.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
