import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@app/contracts';
import { createEmptyProject, type Asset } from '@app/schema';
import {
  assetFilePath,
  canonicalJson,
  joinPath,
  projectToJson,
  timestamp,
  uniqueStampedPath,
  writeTextAtomic,
} from './files';

describe('joinPath', () => {
  it('/ でつなぎ、dir の末尾の / は取る', () => {
    expect(joinPath('/a/b', 'c', 'd.json')).toBe('/a/b/c/d.json');
    expect(joinPath('/a/b/', 'c')).toBe('/a/b/c');
    expect(joinPath('/', 'c')).toBe('/c');
    expect(joinPath('C:/Users/me/model', 'project.json')).toBe('C:/Users/me/model/project.json');
  });
});

describe('assetFilePath', () => {
  const asset = (path: string): Asset => ({ id: 'A1', path }) as Asset;

  it('プロジェクトのフォルダからの相対パスにする', () => {
    expect(assetFilePath('/p', asset('assets/A1.png'))).toBe('/p/assets/A1.png');
  });

  it('フォルダの外を指すパスはエラーにする', () => {
    for (const path of ['../x.png', '/abs.png', 'assets/../../x.png', 'C:/x.png', 'assets\\x.png', '', 'a//b.png']) {
      expect(() => assetFilePath('/p', asset(path))).toThrow('素材のパスがプロジェクトのフォルダの外を指している');
    }
  });
});

describe('timestamp', () => {
  it('UTC の日時をファイル名に使える形にする', () => {
    expect(timestamp(new Date('2026-10-03T01:02:03.004Z'))).toBe('2026-10-03T01-02-03-004Z');
  });

  it('名前の順が日時の順になる', () => {
    const a = timestamp(new Date('2026-01-02T03:04:05.006Z'));
    const b = timestamp(new Date('2026-01-02T03:04:05.010Z'));
    const c = timestamp(new Date('2026-11-02T00:00:00.000Z'));
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });
});

describe('uniqueStampedPath', () => {
  it('同じ名前があれば 1 ミリ秒ずつずらす', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/d');
    const date = new Date('2026-10-03T01:02:03.004Z');
    const name = (s: string) => `x-${s}.json`;
    await fs.writeText('/d/x-2026-10-03T01-02-03-004Z.json', '');
    await fs.writeText('/d/x-2026-10-03T01-02-03-005Z.json', '');
    expect(await uniqueStampedPath(fs, '/d', date, name)).toBe('/d/x-2026-10-03T01-02-03-006Z.json');
  });
});

describe('writeTextAtomic', () => {
  it('.tmp に書いてから rename し、.tmp は残らない', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/d');
    await fs.writeText('/d/a.json', '前');
    await writeTextAtomic(fs, '/d/a.json', '後');
    expect(await fs.readText('/d/a.json')).toBe('後');
    expect(await fs.list('/d')).toEqual(['a.json']);
  });
});

describe('projectToJson', () => {
  it('schemaVersion を先頭にして2字下げで整形する', () => {
    const project = createEmptyProject('モデル');
    // 先頭以外に schemaVersion を置いたオブジェクトでも先頭になる
    const { schemaVersion, name, ...rest } = project;
    const shuffled = { name, ...rest, schemaVersion };
    const text = projectToJson(shuffled);
    expect(text.startsWith('{\n  "schemaVersion": 7,\n  "name": "モデル",')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(project);
  });

  it('足す情報は最後に置く', () => {
    const text = projectToJson(createEmptyProject('m'), { autosave: { basedOn: null } });
    expect(Object.keys(JSON.parse(text)).at(-1)).toBe('autosave');
  });
});

describe('canonicalJson', () => {
  it('キーの順が違っても同じ文字列になる。配列の順は区別する', () => {
    expect(canonicalJson({ a: 1, b: { c: [1, 2], d: null } })).toBe(canonicalJson({ b: { d: null, c: [1, 2] }, a: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});
