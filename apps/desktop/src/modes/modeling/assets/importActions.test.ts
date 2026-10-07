// カード57の実装担当の回帰テスト。素材の復号の途中でも取り消したらプロジェクトへ足さない。
import { describe, expect, it, vi } from 'vitest';
import { FakeImporter } from '@app/contracts';
import { importAssetFiles } from './actions';
import { importSessionOf } from './importSession';
import { pngBytes, testServices } from './testShell';

describe('取り込みの確定（カード57）', () => {
  it('画像の準備中の取り消しは、Undo履歴にも素材にも残さない', async () => {
    const services = testServices({ importer: new FakeImporter() });
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    services.assets.put = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          started();
        }),
    );
    const before = services.store.get();
    const pending = importAssetFiles(services, [{ name: 'face.png', data: pngBytes(10, 10) }]);
    await waiting;
    importSessionOf(services).cancel();
    release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(services.store.get()).toBe(before);
    expect(importSessionOf(services).snapshot().busy).toBe(false);
  });
});
