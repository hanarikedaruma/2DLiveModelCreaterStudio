import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryFileSystem, sha256Hex } from '@app/contracts';
import { createEmptyProject, loadProjectJson } from '@app/schema';
import { createAutoSaver, findRecoverable, isAutosaveName, type AutosaveInfo } from './autoSaver';
import { createProjectIO } from './projectIO';
import { projectToJson } from './files';
import { RecordingFileSystem, createTestStore, projectWithAssets, rename } from './testing';

const DIR = '/projects/モデル';
const START = new Date('2026-10-03T01:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

async function autosaves(fs: MemoryFileSystem, dir = DIR): Promise<string[]> {
  if (!(await fs.exists(`${dir}/backups`))) return [];
  return (await fs.list(`${dir}/backups`)).filter(isAutosaveName);
}

async function setup(assetCount = 0) {
  const fs = new RecordingFileSystem();
  const io = createProjectIO(fs);
  const { project, pngs } = await projectWithAssets(assetCount);
  const store = createTestStore(project);
  const onError = vi.fn();
  const saver = createAutoSaver(fs, io, store, () => pngs, { onError });
  return { fs, io, project, pngs, store, saver, onError };
}

describe('自動保存', () => {
  it('最後の変更から5秒後に backups/autosave-<日時>.json を書く', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.dispatch(rename('1回目'));
    await vi.advanceTimersByTimeAsync(3000);
    store.dispatch(rename('2回目')); // ここから数え直す
    await vi.advanceTimersByTimeAsync(4999);
    expect(await autosaves(fs)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await saver.flush();
    // 書いたのは最初から 3000 + 5000 ミリ秒後
    expect(await autosaves(fs)).toEqual(['autosave-2026-10-03T01-00-08-000Z.json']);
    const text = await fs.readText(`${DIR}/backups/autosave-2026-10-03T01-00-08-000Z.json`);
    expect(text.startsWith('{\n  "schemaVersion": 4,')).toBe(true);
    // そのままプロジェクトとして読める（足した情報は検証で捨てられる）
    expect(loadProjectJson(text)).toEqual(store.get());
    expect(store.get().name).toBe('2回目');
  });

  it('自動保存も .tmp に書いてから rename する', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.dispatch(rename('x'));
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    const path = `${DIR}/backups/autosave-2026-10-03T01-00-05-000Z.json`;
    expect(fs.writes()).toEqual([`writeText ${path}.tmp`]);
    expect(fs.calls).toContain(`rename ${path}.tmp -> ${path}`);
  });

  it('素材は assets/ に無いものだけ書く', async () => {
    const { fs, project, store, saver } = await setup(2);
    const [kept, missing] = project.assets;
    await fs.mkdir(`${DIR}/assets`);
    const existing = new Uint8Array([7, 7, 7]);
    await fs.writeBinary(`${DIR}/${kept!.path}`, existing);
    fs.calls.length = 0;
    saver.start(DIR);
    store.dispatch(rename('x'));
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(fs.writes().filter((c) => c.includes('/assets/'))).toEqual([`writeBinary ${DIR}/${missing!.path}.tmp`]);
    expect(await fs.readBinary(`${DIR}/${kept!.path}`)).toEqual(existing);
    expect(await fs.exists(`${DIR}/${missing!.path}`)).toBe(true);
  });

  it('10世代を超えないように古いものから消す', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    const written: string[] = [];
    for (let i = 0; i < 13; i++) {
      store.dispatch(rename(`変更${i}`));
      await vi.advanceTimersByTimeAsync(5000);
      await saver.flush();
      written.push(...(await autosaves(fs)).filter((n) => !written.includes(n)));
      expect((await autosaves(fs)).length).toBeLessThanOrEqual(10);
    }
    expect(written).toHaveLength(13);
    expect(await autosaves(fs)).toEqual(written.slice(3));
    // いちばん新しいものが最後の変更
    const newest = await fs.readText(`${DIR}/backups/${written.at(-1)}`);
    expect(loadProjectJson(newest).name).toBe('変更12');
  });

  it('自動保存でないファイルは消さない', async () => {
    const { fs, store, saver } = await setup();
    await fs.mkdir(`${DIR}/backups`);
    await fs.writeText(`${DIR}/backups/project.v1.2026-01-01T00-00-00-000Z.json`, '{}');
    saver.start(DIR);
    for (let i = 0; i < 11; i++) {
      store.dispatch(rename(`変更${i}`));
      await vi.advanceTimersByTimeAsync(5000);
    }
    await saver.flush();
    expect(await autosaves(fs)).toHaveLength(10);
    expect(await fs.exists(`${DIR}/backups/project.v1.2026-01-01T00-00-00-000Z.json`)).toBe(true);
  });

  it('stop() で止める。待っている自動保存も書かない', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.dispatch(rename('x'));
    await vi.advanceTimersByTimeAsync(2000);
    saver.stop();
    await vi.advanceTimersByTimeAsync(10000);
    store.dispatch(rename('y'));
    await vi.advanceTimersByTimeAsync(10000);
    await saver.flush();
    expect(await autosaves(fs)).toEqual([]);
  });

  it('start(dir) し直すと前のフォルダには書かない', async () => {
    const { fs, store, saver } = await setup();
    saver.start('/a');
    store.dispatch(rename('x'));
    saver.start('/b');
    store.dispatch(rename('y'));
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(await autosaves(fs, '/a')).toEqual([]);
    expect(await autosaves(fs, '/b')).toHaveLength(1);
  });

  it('別のプロジェクトに入れ替わったら、そのフォルダには書かない', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.load(createEmptyProject('別のプロジェクト'));
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(await autosaves(fs)).toEqual([]);
  });

  it('flush() は待っている自動保存をすぐに書く', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.dispatch(rename('x'));
    await saver.flush();
    expect(await autosaves(fs)).toEqual(['autosave-2026-10-03T01-00-00-000Z.json']);
  });

  it('書き込みに失敗したら onError に渡し、次の自動保存は続ける', async () => {
    const { fs, store, saver, onError } = await setup();
    fs.failOn = (path) => path.includes('autosave-');
    saver.start(DIR);
    store.dispatch(rename('x'));
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    fs.failOn = null;
    store.dispatch(rename('y'));
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(await autosaves(fs)).toHaveLength(1);
  });

  it('未保存のプロジェクトは呼び出し側が渡す unsaved/<id>/ に書く', async () => {
    const { fs, store, saver } = await setup();
    const dir = `/appdata/unsaved/${store.get().id}`;
    saver.start(dir);
    store.dispatch(rename('x'));
    await saver.flush();
    expect(await autosaves(fs, dir)).toHaveLength(1);
  });
});

describe('findRecoverable', () => {
  async function autosaveOnce(saver: ReturnType<typeof createAutoSaver>): Promise<void> {
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
  }

  it('自動保存が無ければ null', async () => {
    const { saver } = await setup();
    expect(await saver.findRecoverable(DIR)).toBeNull();
  });

  it('project.json が無い（まだ保存していない）なら、いちばん新しい自動保存を返す', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.dispatch(rename('1'));
    await autosaveOnce(saver);
    store.dispatch(rename('2'));
    await autosaveOnce(saver);
    const names = await autosaves(fs);
    expect(await saver.findRecoverable(DIR)).toBe(`${DIR}/backups/${names.at(-1)}`);
  });

  it('保存の後に変更して自動保存された（異常終了した）なら、その自動保存を返す', async () => {
    const { io, pngs, store, saver } = await setup(1);
    await io.save(DIR, store.get(), pngs);
    saver.start(DIR);
    store.dispatch(rename('保存していない変更'));
    await autosaveOnce(saver);
    const path = await saver.findRecoverable(DIR);
    expect(path).toBe(`${DIR}/backups/autosave-2026-10-03T01-00-05-000Z.json`);
    // 戻すと保存していない変更が入っている
    const recovered = await io.loadAutosave(path!);
    expect(recovered.project).toEqual(store.get());
    expect(recovered.assetPngs).toEqual(pngs);
  });

  it('自動保存の後に保存したなら null（project.json のほうが新しい）', async () => {
    const { io, pngs, store, saver } = await setup(1);
    await io.save(DIR, store.get(), pngs);
    saver.start(DIR);
    store.dispatch(rename('変更'));
    await autosaveOnce(saver);
    store.dispatch(rename('さらに変更'));
    await io.save(DIR, store.get(), pngs);
    saver.stop();
    expect(await saver.findRecoverable(DIR)).toBeNull();
  });

  it('自動保存が project.json と同じ内容なら null', async () => {
    const { io, pngs, store, saver, project } = await setup(1);
    await io.save(DIR, project, pngs);
    saver.start(DIR);
    store.dispatch(rename('変更'));
    store.dispatch(rename(project.name)); // 元に戻した
    await autosaveOnce(saver);
    expect(await saver.findRecoverable(DIR)).toBeNull();
  });

  it('最初の保存より前の自動保存は使わない', async () => {
    const { io, pngs, store, saver } = await setup(1);
    saver.start(DIR);
    store.dispatch(rename('変更'));
    await autosaveOnce(saver);
    await io.save(DIR, store.get(), pngs);
    expect(await saver.findRecoverable(DIR)).toBeNull();
  });

  it('壊れた自動保存と .tmp は飛ばして1つ前を見る', async () => {
    const { fs, store, saver } = await setup();
    saver.start(DIR);
    store.dispatch(rename('1'));
    await autosaveOnce(saver);
    const good = (await autosaves(fs))[0]!;
    await fs.writeText(`${DIR}/backups/autosave-2099-01-01T00-00-00-000Z.json`, '{ 途中で切れた');
    await fs.writeText(`${DIR}/backups/autosave-2099-01-02T00-00-00-000Z.json.tmp`, '{}');
    expect(await findRecoverable(fs, DIR)).toBe(`${DIR}/backups/${good}`);
  });

  it('basedOn は書いたときの project.json の SHA-256', async () => {
    const { fs, io, pngs, store, saver } = await setup();
    await io.save(DIR, store.get(), pngs);
    saver.start(DIR);
    store.dispatch(rename('x'));
    await autosaveOnce(saver);
    const name = (await autosaves(fs))[0]!;
    const json = JSON.parse(await fs.readText(`${DIR}/backups/${name}`)) as { autosave: AutosaveInfo };
    expect(json.autosave.basedOn).toBe(await sha256Hex(await fs.readBinary(`${DIR}/project.json`)));
    expect(json.autosave.savedAt).toBe('2026-10-03T01:00:05.000Z');
  });

  it('手で作った自動保存のファイルでも判定できる', async () => {
    const fs = new MemoryFileSystem();
    const project = createEmptyProject('m');
    await createProjectIO(fs).save(DIR, project, {});
    await fs.writeText(
      `${DIR}/backups/autosave-2026-10-03T02-00-00-000Z.json`,
      projectToJson({ ...project, name: '別' }, { autosave: { basedOn: 'ちがう', savedAt: '' } }),
    );
    expect(await findRecoverable(fs, DIR)).toBeNull();
  });
});
