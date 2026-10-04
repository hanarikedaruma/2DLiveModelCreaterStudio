import { describe, expect, it } from 'vitest';
import { MemoryFileSystem, sha256Hex } from '@app/contracts';
import { ProjectValidationError, ProjectVersionError, createEmptyProject } from '@app/schema';
import { createProjectIO, type MissingAssetFilesError } from './projectIO';
import { projectToJson } from './files';
import { RecordingFileSystem, projectWithAssets } from './testing';

const DIR = '/projects/モデル';
const NOW = new Date('2026-10-03T01:02:03.004Z');

describe('保存と読み込み', () => {
  it('MemoryFileSystem で、保存 → 読み込みが同じ内容になる', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(3);
    await io.save(DIR, project, pngs);
    const loaded = await io.load(DIR);
    expect(loaded.project).toEqual(project);
    expect(loaded.assetPngs).toEqual(pngs);
  });

  it('フォルダは project.json・assets/・backups/ になる', async () => {
    const fs = new MemoryFileSystem();
    const { project, pngs } = await projectWithAssets(2);
    await createProjectIO(fs).save(DIR, project, pngs);
    expect(await fs.list(DIR)).toEqual(['assets', 'backups', 'project.json']);
    expect(await fs.list(`${DIR}/assets`)).toEqual(project.assets.map((a) => `${a.id}.png`).sort());
    const text = await fs.readText(`${DIR}/project.json`);
    expect(text).toBe(projectToJson(project));
    expect(text.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
  });

  it('保存先のフォルダが無ければ途中のフォルダも作る（unsaved/<id>/ など）', async () => {
    const fs = new MemoryFileSystem();
    const project = createEmptyProject('新規');
    const dir = `/appdata/unsaved/${project.id}`;
    await createProjectIO(fs).save(dir, project, {});
    expect((await createProjectIO(fs).load(dir)).project).toEqual(project);
  });
});

describe('.tmp → rename', () => {
  it('project.json も素材も .tmp に書いてから rename する', async () => {
    const fs = new RecordingFileSystem();
    const { project, pngs } = await projectWithAssets(2);
    await createProjectIO(fs).save(DIR, project, pngs);
    const [a, b] = project.assets.map((x) => `${DIR}/${x.path}`);
    expect(fs.calls).toEqual([
      `writeBinary ${a}.tmp`,
      `rename ${a}.tmp -> ${a}`,
      `writeBinary ${b}.tmp`,
      `rename ${b}.tmp -> ${b}`,
      `writeText ${DIR}/project.json.tmp`,
      `rename ${DIR}/project.json.tmp -> ${DIR}/project.json`,
    ]);
    // .tmp は残らない
    expect(await fs.list(DIR)).not.toContain('project.json.tmp');
  });

  it('書き込みに失敗しても前の project.json は壊れない', async () => {
    const fs = new RecordingFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(1);
    await io.save(DIR, project, pngs);
    fs.failOn = (path) => path.endsWith('project.json.tmp');
    await expect(io.save(DIR, { ...project, name: '新しい名前' }, pngs)).rejects.toThrow('書き込みに失敗した');
    fs.failOn = null;
    expect((await io.load(DIR)).project.name).toBe('テストのモデル');
  });
});

describe('素材は hash が変わったものだけ書く', () => {
  it('2回目の保存では変わっていない素材を書かない', async () => {
    const fs = new RecordingFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(3);
    await io.save(DIR, project, pngs);
    fs.calls.length = 0;
    await io.save(DIR, { ...project, name: '名前だけ変えた' }, pngs);
    expect(fs.writes()).toEqual([`writeText ${DIR}/project.json.tmp`]);
  });

  it('hash が変わった素材と、新しい素材だけを書く', async () => {
    const fs = new RecordingFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(2);
    await io.save(DIR, project, pngs);
    const [first, second] = project.assets;
    const { project: extra, pngs: extraPngs } = await projectWithAssets(1);
    const changedPng = new Uint8Array([1, 2, 3]);
    const next = {
      ...project,
      assets: [first!, { ...second!, hash: await sha256Hex(changedPng) }, extra.assets[0]!],
    };
    fs.calls.length = 0;
    await io.save(DIR, next, { ...pngs, [second!.id]: changedPng, ...extraPngs });
    expect(fs.writes()).toEqual([
      `writeBinary ${DIR}/${second!.path}.tmp`,
      `writeBinary ${DIR}/${extra.assets[0]!.path}.tmp`,
      `writeText ${DIR}/project.json.tmp`,
    ]);
    expect(await fs.readBinary(`${DIR}/${second!.path}`)).toEqual(changedPng);
  });

  it('消えた素材のファイルは hash が同じでも書き直す', async () => {
    const fs = new RecordingFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(1);
    await io.save(DIR, project, pngs);
    await fs.remove(`${DIR}/${project.assets[0]!.path}`);
    fs.calls.length = 0;
    await io.save(DIR, project, pngs);
    expect(fs.writes()).toEqual([
      `writeBinary ${DIR}/${project.assets[0]!.path}.tmp`,
      `writeText ${DIR}/project.json.tmp`,
    ]);
  });

  it('書く必要のある素材の画像が無ければ、何も書かずにエラーにする', async () => {
    const fs = new RecordingFileSystem();
    const { project, pngs } = await projectWithAssets(2);
    const missingId = project.assets[1]!.id;
    const { [missingId]: _, ...partial } = pngs;
    await expect(createProjectIO(fs).save(DIR, project, partial)).rejects.toThrow(
      `保存する素材の画像が無い: ${missingId}`,
    );
    expect(fs.writes()).toEqual([]);
  });
});

describe('古い版の読み込み', () => {
  // 版 1 → 2 で名前に印を付ける変換（テスト用）
  const options = {
    currentVersion: 2,
    migrations: { 1: (json: Record<string, unknown>) => ({ ...json, name: `${String(json.name)}（変換済み）` }) },
    now: () => NOW,
  };

  it('変換前のファイルを backups/project.v<版>.<日時>.json に残してから変換する', async () => {
    const fs = new MemoryFileSystem();
    const { project, pngs } = await projectWithAssets(1);
    await createProjectIO(fs).save(DIR, project, pngs);
    const original = await fs.readText(`${DIR}/project.json`);

    const loaded = await createProjectIO(fs, options).load(DIR);
    expect(loaded.project.schemaVersion).toBe(2);
    expect(loaded.project.name).toBe('テストのモデル（変換済み）');
    expect(await fs.list(`${DIR}/backups`)).toEqual(['project.v1.2026-10-03T01-02-03-004Z.json']);
    expect(await fs.readText(`${DIR}/backups/project.v1.2026-10-03T01-02-03-004Z.json`)).toBe(original);
    // project.json 自体は書き換えない（次の保存で新しい版になる）
    expect(await fs.readText(`${DIR}/project.json`)).toBe(original);
  });

  it('同じ日時に2回読んでもバックアップを上書きしない', async () => {
    const fs = new MemoryFileSystem();
    const { project, pngs } = await projectWithAssets(0);
    await createProjectIO(fs).save(DIR, project, pngs);
    const io = createProjectIO(fs, options);
    await io.load(DIR);
    await io.load(DIR);
    expect(await fs.list(`${DIR}/backups`)).toEqual([
      'project.v1.2026-10-03T01-02-03-004Z.json',
      'project.v1.2026-10-03T01-02-03-005Z.json',
    ]);
  });

  it('現在の版ならバックアップを作らない', async () => {
    const fs = new MemoryFileSystem();
    const { project, pngs } = await projectWithAssets(1);
    const io = createProjectIO(fs, { now: () => NOW });
    await io.save(DIR, project, pngs);
    await io.load(DIR);
    expect(await fs.list(`${DIR}/backups`)).toEqual([]);
  });

  it('新しすぎる版はエラーにし、バックアップも作らない', async () => {
    const fs = new MemoryFileSystem();
    const project = createEmptyProject('m');
    await fs.mkdir(DIR);
    await fs.writeText(`${DIR}/project.json`, projectToJson({ ...project, schemaVersion: 3 }));
    await expect(createProjectIO(fs, options).load(DIR)).rejects.toThrow(ProjectVersionError);
    expect(await fs.exists(`${DIR}/backups`)).toBe(false);
  });
});

describe('読み込みのエラー', () => {
  it('素材のファイルが無ければ、その id を並べたエラーにする', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(3);
    await io.save(DIR, project, pngs);
    const [a, , c] = project.assets;
    await fs.remove(`${DIR}/${a!.path}`);
    await fs.remove(`${DIR}/${c!.path}`);
    const error = (await io.load(DIR).catch((e: unknown) => e)) as MissingAssetFilesError;
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('MissingAssetFilesError');
    expect(error.message).toBe(`素材のファイルが無い: ${a!.id}, ${c!.id}`);
    expect(error.assetIds).toEqual([a!.id, c!.id]);
  });

  it('project.json が無ければエラーにする', async () => {
    await expect(createProjectIO(new MemoryFileSystem()).load(DIR)).rejects.toThrow('project.json が無い');
  });

  it('JSON として読めなければエラーにする', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(DIR);
    await fs.writeText(`${DIR}/project.json`, '{ 壊れている');
    await expect(createProjectIO(fs).load(DIR)).rejects.toThrow('project.json を JSON として読めない');
  });

  it('検証に通らなければ項目のパス付きのエラーにする', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(DIR);
    const project = createEmptyProject('m');
    await fs.writeText(`${DIR}/project.json`, projectToJson({ ...project, name: 3 as unknown as string }));
    const error = await createProjectIO(fs)
      .load(DIR)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectValidationError);
    expect(String(error)).toContain('name');
  });

  it('素材のパスがフォルダの外を指していればエラーにする', async () => {
    const fs = new MemoryFileSystem();
    const { project, pngs } = await projectWithAssets(1);
    const bad = { ...project, assets: [{ ...project.assets[0]!, path: '../outside.png' }] };
    await expect(createProjectIO(fs).save(DIR, bad, pngs)).rejects.toThrow('フォルダの外');
  });
});

describe('loadAutosave', () => {
  it('backups/ の中のファイルを読み、素材はプロジェクトの assets/ から読む', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(2);
    await io.save(DIR, project, pngs);
    const changed = { ...project, name: '自動保存の内容' };
    await fs.writeText(`${DIR}/backups/autosave-x.json`, projectToJson(changed, { autosave: { basedOn: null } }));
    const loaded = await io.loadAutosave(`${DIR}/backups/autosave-x.json`);
    expect(loaded.project).toEqual(changed);
    expect(loaded.assetPngs).toEqual(pngs);
  });

  it('backups/ の外のパスはエラーにする', async () => {
    await expect(createProjectIO(new MemoryFileSystem()).loadAutosave('/a/b.json')).rejects.toThrow('backups/');
  });
});
