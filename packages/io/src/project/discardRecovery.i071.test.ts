import { describe, expect, it, vi } from 'vitest';
import { MemoryFileSystem } from '@app/contracts';
import { createAutoSaver, isAutosaveName } from './autoSaver';
import { createProjectIO } from './projectIO';
import { createTestStore, projectWithAssets, rename } from './testing';

const DIR = '/projects/recovery';
async function setup(saved = false) {
  const fs = new MemoryFileSystem();
  const io = createProjectIO(fs);
  const { project, pngs } = await projectWithAssets(1);
  const store = createTestStore(project);
  const saver = createAutoSaver(fs, io, store, () => pngs);
  if (saved) await io.save(DIR, project, pngs);
  saver.start(DIR);
  for (const name of ['古い作業', '最新の作業']) {
    store.dispatch(rename(name));
    await saver.flush();
  }
  saver.stop();
  const path = (await saver.findRecoverable(DIR))!;
  return { fs, io, project, store, saver, pngs, path };
}

describe('自動保存の破棄（I-071）', () => {
  it.each([false, true])(
    '保存済み=%s: 古い世代も消し、本体・素材・通常のバックアップ・別プロジェクトを残す',
    async (saved) => {
      const { fs, project, saver, path, store } = await setup(saved);
      const base = saved ? await fs.readBinary(`${DIR}/project.json`) : null;
      const assetPath = `${DIR}/${project.assets[0]!.path}`;
      const png = await fs.readBinary(assetPath);
      await fs.writeText(`${DIR}/backups/project.v7.keep.json`, '通常のバックアップ');
      await fs.writeText(`${DIR}/backups/readme.txt`, '残す');
      await fs.mkdir('/other/backups');
      await fs.writeText('/other/backups/autosave-other.json', '{}');
      expect(await saver.discardRecovery(DIR, path)).toBe('discarded');
      expect(await saver.findRecoverable(DIR)).toBeNull();
      expect((await fs.list(`${DIR}/backups`)).filter(isAutosaveName)).toEqual([]);
      expect(await fs.readBinary(assetPath)).toEqual(png);
      expect(await fs.readText(`${DIR}/backups/project.v7.keep.json`)).toBe('通常のバックアップ');
      expect(await fs.readText(`${DIR}/backups/readme.txt`)).toBe('残す');
      expect(await fs.exists('/other/backups/autosave-other.json')).toBe(true);
      if (base) expect(await fs.readBinary(`${DIR}/project.json`)).toEqual(base);
      else expect(await fs.exists(`${DIR}/project.json`)).toBe(false);
      // 後で作られた正常な自動保存まで無効にしない。
      saver.start(DIR);
      store.dispatch(rename('新しい作業'));
      await saver.flush();
      saver.stop();
      expect(await saver.findRecoverable(DIR)).not.toBeNull();
    },
  );

  it('確認していた世代より新しい候補があれば、古い確認への返答で何も消さない', async () => {
    const { fs, saver, path, store } = await setup();
    saver.start(DIR);
    store.dispatch(rename('確認中の新しい作業'));
    await saver.flush();
    saver.stop();
    const names = await fs.list(`${DIR}/backups`);
    expect(await saver.discardRecovery(DIR, path)).toBe('changed');
    expect(await fs.list(`${DIR}/backups`)).toEqual(names);
    await fs.remove((await saver.findRecoverable(DIR))!);
    await fs.remove(path);
    expect(await saver.discardRecovery(DIR, path)).toBe('changed');
  });

  it('削除中に新しい世代が追加されても残し、取り直しを求める', async () => {
    const { fs, saver, path } = await setup();
    const data = await fs.readText(path);
    const remove = fs.remove.bind(fs);
    let added = false;
    vi.spyOn(fs, 'remove').mockImplementation(async (target) => {
      if (!added) {
        added = true;
        await fs.writeText(`${DIR}/backups/autosave-2099-01-01T00-00-00-000Z.json`, data);
      }
      await remove(target);
    });
    expect(await saver.discardRecovery(DIR, path)).toBe('changed');
    expect(await fs.list(`${DIR}/backups`)).toEqual(['autosave-2099-01-01T00-00-00-000Z.json']);
    expect(await saver.findRecoverable(DIR)).toContain('2099');
  });

  it('削除の途中の失敗を成功にせず、最新の復元候補を残す', async () => {
    const { fs, saver, path } = await setup();
    const remove = fs.remove.bind(fs);
    vi.spyOn(fs, 'remove').mockImplementation(async (target) => {
      if (target === path) throw new Error('削除できない');
      await remove(target);
    });
    await expect(saver.discardRecovery(DIR, path)).rejects.toThrow('削除できない');
    expect(await saver.findRecoverable(DIR)).toBe(path);
    expect(await fs.list(`${DIR}/backups`)).toHaveLength(1);
  });

  it('対象フォルダの外のパスと、階層を含む自動保存名を受け付けない', async () => {
    const { fs, saver, path } = await setup();
    const names = await fs.list(`${DIR}/backups`);
    for (const wrong of [
      path.replace('/backups/', '/backups-other/'),
      `${DIR}/backups/../${path.split('/').at(-1)}`,
      path.replace(DIR, `${DIR}-other`),
    ]) {
      await expect(saver.discardRecovery(DIR, wrong)).rejects.toThrow('一致しない');
    }
    for (const name of ['autosave-../outside.json', 'autosave-a\\outside.json', 'autosave-C:outside.json'])
      expect(isAutosaveName(name)).toBe(false);
    expect(await fs.list(`${DIR}/backups`)).toEqual(names);
  });

  it('自動保存名のフォルダを再帰削除せず、破棄の前に失敗を返す', async () => {
    const { fs, saver, path } = await setup();
    const folder = `${DIR}/backups/autosave-2000-folder.json`;
    await fs.mkdir(folder);
    await fs.writeText(`${folder}/keep.txt`, '残す');
    await expect(saver.discardRecovery(DIR, path)).rejects.toThrow();
    expect(await fs.readText(`${folder}/keep.txt`)).toBe('残す');
    expect(await saver.findRecoverable(DIR)).toBe(path);
    expect((await fs.list(`${DIR}/backups`)).filter(isAutosaveName)).toHaveLength(3);
  });
});
