import { createEmptyProject, validateProject } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { FakeAutoSaver, FakeImporter, FakeProjectIO, MemoryFileSystem, isPng, pngSize, sha256Hex } from './files';

// 幅・高さだけを持つ PNG の先頭（シグネチャ + IHDR）
function pngHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(33);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

describe('MemoryFileSystem', () => {
  it('書いて読める・一覧・存在', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/proj/assets');
    await fs.writeText('/proj/project.json', '{"a":1}');
    await fs.writeBinary('/proj/assets/a.png', new Uint8Array([1, 2, 3]));
    expect(await fs.readText('/proj/project.json')).toBe('{"a":1}');
    expect([...(await fs.readBinary('/proj/assets/a.png'))]).toEqual([1, 2, 3]);
    expect(await fs.list('/proj')).toEqual(['assets', 'project.json']);
    expect(await fs.list('/')).toEqual(['proj']);
    expect(await fs.exists('/proj/assets')).toBe(true);
    expect(await fs.exists('/proj/none')).toBe(false);
  });

  it('親フォルダが無いと書けない・無いファイルは読めない', async () => {
    const fs = new MemoryFileSystem();
    await expect(fs.writeText('/no/file.txt', 'x')).rejects.toThrow();
    await expect(fs.readText('/none')).rejects.toThrow();
  });

  it('書いたデータを外から変えても中身は変わらない', async () => {
    const fs = new MemoryFileSystem();
    const data = new Uint8Array([1]);
    await fs.writeBinary('/a', data);
    data[0] = 9;
    expect([...(await fs.readBinary('/a'))]).toEqual([1]);
  });

  it('rename はファイルを置き換え、フォルダは中身ごと動かす', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/d/sub');
    await fs.writeText('/d/sub/x.txt', 'x');
    await fs.writeText('/tmp.json', 'new');
    await fs.writeText('/p.json', 'old');
    await fs.rename('/tmp.json', '/p.json');
    expect(await fs.readText('/p.json')).toBe('new');
    expect(await fs.exists('/tmp.json')).toBe(false);
    await fs.rename('/d', '/e');
    expect(await fs.readText('/e/sub/x.txt')).toBe('x');
    expect(await fs.exists('/d')).toBe(false);
  });

  it('remove はフォルダを中身ごと消す', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/d/sub');
    await fs.writeText('/d/sub/x.txt', 'x');
    await fs.remove('/d');
    expect(await fs.exists('/d/sub/x.txt')).toBe(false);
    expect(await fs.list('/')).toEqual([]);
  });
});

describe('FakeImporter', () => {
  it('PNG だけを読み、トリミングせず offset (0,0) で返す', async () => {
    const png = pngHeader(120, 80);
    const { assets, warnings } = await new FakeImporter().importFiles([
      { name: 'face.png', data: png },
      { name: 'note.txt', data: new TextEncoder().encode('hello') },
    ]);
    expect(warnings).toEqual([]);
    expect(assets).toHaveLength(1);
    const { asset } = assets[0]!;
    expect(asset).toMatchObject({
      width: 120,
      height: 80,
      offset: { x: 0, y: 0 },
      canvasSize: { width: 120, height: 80 },
      source: { kind: 'png', file: 'face.png' },
      path: `assets/${asset.id}.png`,
    });
    expect(asset.hash).toBe(await sha256Hex(png));
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/);
    // 取り込んだ素材はそのままプロジェクトに入れられる形
    const p = createEmptyProject('t');
    expect(() => validateProject({ ...p, assets: [asset] })).not.toThrow();
  });

  it('PNG の判定と大きさ', () => {
    expect(isPng(pngHeader(1, 2))).toBe(true);
    expect(isPng(new Uint8Array(30))).toBe(false);
    expect(pngSize(pngHeader(3, 4))).toEqual({ width: 3, height: 4 });
  });
});

describe('FakeProjectIO', () => {
  it('メモリに保存して読み戻す（別のオブジェクトになる）', async () => {
    const io = new FakeProjectIO();
    const p = createEmptyProject('保存');
    const pngs = { a1: new Uint8Array([1, 2]) };
    await io.save('/proj', p, pngs);
    const loaded = await io.load('/proj/');
    expect(loaded.project).toEqual(p);
    expect(loaded.project).not.toBe(p);
    expect([...loaded.assetPngs.a1!]).toEqual([1, 2]);
    await expect(io.load('/other')).rejects.toThrow();
  });
});

describe('FakeAutoSaver', () => {
  it('何もしない', async () => {
    const saver = new FakeAutoSaver();
    saver.start('/proj');
    saver.stop();
    expect(await saver.findRecoverable('/proj')).toBeNull();
  });
});
