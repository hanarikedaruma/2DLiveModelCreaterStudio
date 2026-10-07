import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene } from '@app/schema';
import { MemoryFileSystem } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createBackgroundFiles, createBackgroundImages } from '../backgrounds';
import { removeBackgroundImage } from './backgroundRemoval';

async function setup() {
  const { store } = createFakeServices();
  const fs = new MemoryFileSystem();
  const images = createBackgroundImages({ decode: async () => ({ close() {} }) as ImageBitmap });
  const files = createBackgroundFiles({ fs: () => fs, images });
  files.setProjectDirResolver(() => '/p');
  const data = new Uint8Array([1, 2, 3]);
  const { path } = await files.importImage({ name: 'bg.png', data });
  const p = createEmptyProject('p');
  p.studio.scenes = [{ ...createEmptyScene('雑談'), id: 's', background: { type: 'image', path } }];
  p.studio.hotkeys = [
    { id: 'h', keys: 'Ctrl+1', action: 'background', targetId: `image:${path}`, mode: 'toggle' },
    { id: 'other', keys: 'Ctrl+2', action: 'parameter', targetId: 'MouthOpen', mode: 'toggle' },
  ];
  store.load(p);
  const dialogs = { confirm: vi.fn(async () => true), notify: vi.fn() };
  return { store, fs, files, path, data, dialogs, before: store.get() };
}

describe('背景プリセットを削除する', () => {
  it('使うシーンを確認し、画像・参照・ホットキーを1回のUndo/Redoで戻す', async () => {
    const { store, files, path, data, dialogs, before } = await setup();
    expect(await removeBackgroundImage(store, files, dialogs, path)).toBe(true);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.stringContaining('雑談'));
    expect(store.get().studio.scenes[0]!.background).toEqual({ type: 'transparent' });
    expect(store.get().studio.hotkeys.map((h) => h.id)).toEqual(['other']);
    expect(await files.list()).not.toContain(path);
    store.undo();
    expect(store.get()).toBe(before);
    await vi.waitFor(async () => expect(await files.list()).toContain(path));
    expect(await files.load(path)).toEqual(data);
    store.redo();
    await vi.waitFor(async () => expect(await files.list()).not.toContain(path));
    expect(store.get().studio.hotkeys.map((h) => h.id)).toEqual(['other']);
  });
  it('キャンセルと、確認中のモデル変更はファイルを消さない', async () => {
    const { store, files, path, dialogs, before } = await setup();
    dialogs.confirm.mockResolvedValueOnce(false);
    expect(await removeBackgroundImage(store, files, dialogs, path)).toBe(false);
    expect(store.get()).toBe(before);
    dialogs.confirm.mockImplementationOnce(async () => {
      store.dispatch({ label: '変更', apply: (p) => ({ ...p, name: '新しい名前' }) });
      return true;
    });
    expect(await removeBackgroundImage(store, files, dialogs, path)).toBe(false);
    expect(await files.list()).toContain(path);
    expect(store.get().studio.hotkeys).toHaveLength(2);
  });
  it('ディスクの退避に失敗したら参照とUndoを変えずに知らせる', async () => {
    const { store, fs, files, path, dialogs, before } = await setup();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('ディスクエラー'));
    expect(await removeBackgroundImage(store, files, dialogs, path)).toBe(false);
    expect(store.get()).toBe(before);
    expect(await files.list()).toContain(path);
    expect(dialogs.notify).toHaveBeenCalledWith(expect.stringContaining('ディスクエラー'));
  });
});
