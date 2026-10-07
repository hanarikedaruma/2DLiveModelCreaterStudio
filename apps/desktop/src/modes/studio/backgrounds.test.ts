import { describe, expect, it, vi } from 'vitest';
import { MemoryFileSystem } from '@app/contracts';
import { createBackgroundFiles, createBackgroundImages } from './backgrounds';

const fakeImage = (n: number) => ({ width: n }) as ImageBitmap;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('背景の画像', () => {
  it('色と透明はそのまま、画像は読めるまで透明', async () => {
    const decode = vi.fn(async (bytes: Uint8Array) => fakeImage(bytes[0]!));
    const images = createBackgroundImages({ decode });
    expect(images.resolve({ type: 'color', color: '#0000ff' })).toEqual({ type: 'color', color: '#0000ff' });
    images.put('backgrounds/a.png', new Uint8Array([7]));
    expect(images.status('backgrounds/a.png')).toBe('loading');
    expect(images.resolve({ type: 'image', path: 'backgrounds/a.png' })).toEqual({ type: 'transparent' });
    await flush();
    expect(images.status('backgrounds/a.png')).toBe('ready');
    expect(images.resolve({ type: 'image', path: 'backgrounds/a.png' })).toEqual({
      type: 'image',
      image: fakeImage(7),
    });
  });

  it('手元に無い画像は load で読み、無ければ missing にする', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn(async (path: string) => (path.endsWith('ok.png') ? new Uint8Array([3]) : null));
    const images = createBackgroundImages({ decode: async (b) => fakeImage(b[0]!), load });
    const changes = vi.fn();
    images.subscribe(changes);
    images.resolve({ type: 'image', path: 'backgrounds/ok.png' });
    images.resolve({ type: 'image', path: 'backgrounds/ok.png' }); // 読んでいる間に何度呼んでも1回だけ
    images.resolve({ type: 'image', path: 'backgrounds/none.png' });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(images.status('backgrounds/ok.png')).toBe('ready');
    expect(images.status('backgrounds/none.png')).toBe('missing');
    expect(changes).toHaveBeenCalled();
    // 読めなかったものは forgetMissing の後にもう一度読む
    images.forgetMissing();
    images.resolve({ type: 'image', path: 'backgrounds/none.png' });
    expect(load).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

it('画像として読めなければ broken にして透明のまま', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const images = createBackgroundImages({ decode: () => Promise.reject(new Error('壊れている')) });
  images.put('backgrounds/x.png', new Uint8Array([1]));
  await flush();
  expect(images.status('backgrounds/x.png')).toBe('broken');
  expect(images.resolve({ type: 'image', path: 'backgrounds/x.png' })).toEqual({ type: 'transparent' });
  warn.mockRestore();
});

describe('プロジェクトの backgrounds/', () => {
  const setup = () => {
    const fs = new MemoryFileSystem();
    const images = createBackgroundImages({ decode: async () => fakeImage(1) });
    const files = createBackgroundFiles({ fs: () => fs, images });
    return { fs, images, files };
  };
  it('画像をプリセットから外し、復元すると同じパスとバイトで一覧に戻る', async () => {
    const { fs, files } = setup();
    files.setProjectDirResolver(() => '/projects/a');
    const data = new Uint8Array([4, 5, 6]);
    const { path } = await files.importImage({ name: '部屋.png', data });
    await files.remove(path);
    expect(await files.list()).not.toContain(path);
    expect(await fs.exists(`/projects/a/${path}`)).toBe(false);
    await files.restore(path);
    expect(await files.list()).toContain(path);
    expect(await files.load(path)).toEqual(data);
  });
  it('未保存の画像も削除・復元でき、削除中には保存しない', async () => {
    const { fs, files } = setup();
    const { path } = await files.importImage({ name: 'bg.webp', data: new Uint8Array([7]) });
    await files.remove(path);
    expect(files.pending()).toEqual([]);
    expect(await files.writePending('/projects/a')).toEqual([]);
    await files.restore(path);
    expect(files.pending()).toEqual([path]);
    await files.writePending('/projects/a');
    expect(await fs.readBinary(`/projects/a/${path}`)).toEqual(new Uint8Array([7]));
    await expect(files.remove('../project.json')).rejects.toThrow();
  });
  it('削除してから別名で保存しても、Undoの復元先は現在のフォルダになる', async () => {
    const { fs, files } = setup();
    files.setProjectDirResolver(() => '/projects/a');
    const data = new Uint8Array([9]);
    const { path } = await files.importImage({ name: 'a.png', data });
    await files.remove(path);
    files.setProjectDirResolver(() => '/projects/b');
    await files.restore(path);
    expect(await fs.readBinary(`/projects/b/${path}`)).toEqual(data);
    expect(await fs.exists(`/projects/a/${path}`)).toBe(false);
  });

  it('フォルダがあれば、選んだ画像を backgrounds/ に写す', async () => {
    const { fs, images, files } = setup();
    files.setProjectDirResolver(() => '/projects/a');
    const data = new Uint8Array([1, 2, 3]);
    const { path, saved } = await files.importImage({ name: '部屋.PNG', data });
    expect(saved).toBe(true);
    expect(path).toMatch(/^backgrounds\/[0-9A-Z]{26}\.png$/);
    expect(await fs.readBinary(`/projects/a/${path}`)).toEqual(data);
    expect(images.bytes(path)).toBe(data);
    expect(files.pending()).toEqual([]);
    expect(await files.load(path)).toEqual(data);
  });

  it('フォルダがまだ無ければ手元に置き、保存するときに写す', async () => {
    const { fs, files } = setup();
    const data = new Uint8Array([9]);
    const { path, saved } = await files.importImage({ name: 'bg.jpg', data });
    expect(saved).toBe(false);
    expect(files.pending()).toEqual([path]);
    expect(await files.load(path)).toBe(data);
    expect(await files.writePending('/projects/b/')).toEqual([path]);
    expect(await fs.readBinary(`/projects/b/${path}`)).toEqual(data);
    expect(files.pending()).toEqual([]);
  });

  it('list は backgrounds/ の画像と、まだ写していない画像を名前の順に返す', async () => {
    const { fs, files } = setup();
    expect(await files.list()).toEqual([]); // フォルダがまだ無い
    const { path: kept } = await files.importImage({ name: 'a.png', data: new Uint8Array([1]) });
    expect(await files.list()).toEqual([kept]);
    files.setProjectDirResolver(() => '/projects/d');
    expect(await files.list()).toEqual([kept]); // backgrounds/ がまだ無い
    await fs.mkdir('/projects/d/backgrounds');
    await fs.writeBinary('/projects/d/backgrounds/room.webp', new Uint8Array([2]));
    await fs.writeBinary('/projects/d/backgrounds/memo.txt', new Uint8Array([3]));
    expect(await files.list()).toEqual([kept, 'backgrounds/room.webp'].sort());
  });

  it('画像でないファイルは断る。フォルダに無い画像は null', async () => {
    const { files } = setup();
    await expect(files.importImage({ name: 'memo.txt', data: new Uint8Array() })).rejects.toThrow('PNG');
    files.setProjectDirResolver(async () => '/projects/c');
    expect(await files.load('backgrounds/none.png')).toBeNull();
  });
});
