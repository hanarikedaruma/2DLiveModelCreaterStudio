import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset, Project } from '@app/schema';
import { MemoryFileSystem, createAssetRepository, type Services } from '@app/contracts';
import { createAutoSaver, createProjectIO } from '@app/io';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { onAppEvent } from '../shell/events';
import { createProjectActions, PROJECT_LOADED, type ProjectPlatform } from './actions';

// jsdom には createImageBitmap が無いので、画像の代わりに大きさだけを持つものを作る
const decode = async (png: Uint8Array) => ({
  image: { width: png.length, height: 1, close() {} } as unknown as ImageBitmap,
  imageData: { width: png.length, height: 1, data: new Uint8ClampedArray(png.length * 4) } as unknown as ImageData,
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function asset(id: string): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: 'x',
    width: 10,
    height: 10,
    offset: { x: 0, y: 0 },
    canvasSize: { width: 100, height: 100 },
    source: { kind: 'png', file: `${id}.png` },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
  };
}

function setup(options: { fs?: MemoryFileSystem; answers?: { confirm?: boolean; prompt?: string | null } } = {}) {
  const fs = options.fs ?? new MemoryFileSystem();
  const base = createFakeServices();
  const io = createProjectIO(fs);
  const assets = createAssetRepository({ decode });
  const services: Services = {
    ...base,
    fs,
    io,
    assets,
    autoSaver: createAutoSaver(fs, io, base.store, () => assets.all(), { delayMs: 10 }),
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage());
  const dialogs = {
    confirm: vi.fn(async () => options.answers?.confirm ?? true),
    prompt: vi.fn(async () => (options.answers && 'prompt' in options.answers ? options.answers.prompt! : 'テスト')),
    notify: vi.fn(),
  };
  const picked: (string | null)[] = [];
  const platform: ProjectPlatform = {
    pickFolder: vi.fn(async () => picked.shift() ?? null),
    unsavedRoot: async () => '/appdata/unsaved',
    writePendingBackgrounds: vi.fn(async () => []),
  };
  const actions = createProjectActions({ services, environment, dialogs, platform });
  return { fs, services, environment, dialogs, platform, actions, picked };
}

const rename = (name: string) => ({ label: '名前', apply: (p: Project) => ({ ...p, name }) });

afterEach(() => {
  vi.useRealTimers();
});

describe('保存と名前を付けて保存', () => {
  it('保存先が無ければフォルダを選んで保存し、変更なしの状態になる', async () => {
    const { actions, services, picked, fs, environment, platform } = setup();
    await services.assets.put('a1', PNG);
    services.store.dispatch({ label: '素材', apply: (p) => ({ ...p, assets: [asset('a1')] }) });
    expect(actions.isDirty()).toBe(true);
    picked.push('/work/proj');
    await actions.save();
    expect(platform.pickFolder).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readText('/work/proj/project.json')).assets[0].id).toBe('a1');
    expect([...(await fs.readBinary('/work/proj/assets/a1.png'))]).toEqual([...PNG]);
    expect(actions.dir()).toBe('/work/proj');
    expect(actions.isDirty()).toBe(false);
    expect(environment.get().lastProjectDir).toBe('/work/proj');
    expect(platform.writePendingBackgrounds).toHaveBeenCalledWith('/work/proj');

    // 2回目からはそのフォルダに上書きする（フォルダを選ばない）
    services.store.dispatch(rename('二番'));
    await actions.save();
    expect(platform.pickFolder).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readText('/work/proj/project.json')).name).toBe('二番');
  });

  it('保存先ができたら、保存先の無かったときの自動保存のフォルダを消す', async () => {
    const { actions, services, picked, fs } = setup();
    await actions.recoverOnStartup(); // 自動保存を unsaved/<id> で始める
    services.store.dispatch(rename('変えた'));
    await (services.autoSaver as unknown as { flush(): Promise<void> }).flush();
    const unsaved = `/appdata/unsaved/${services.store.get().id}`;
    expect(await fs.exists(unsaved)).toBe(true);
    picked.push('/work/p');
    await actions.save();
    expect(await fs.exists(unsaved)).toBe(false);
  });

  it('ほかのプロジェクトのあるフォルダには、確かめてから上書きする', async () => {
    const { actions, picked, fs, dialogs } = setup({ answers: { confirm: false } });
    await fs.mkdir('/work/other');
    await fs.writeText('/work/other/project.json', '{}');
    picked.push('/work/other');
    await actions.saveAs();
    expect(dialogs.confirm).toHaveBeenCalled();
    expect(await fs.readText('/work/other/project.json')).toBe('{}');
    expect(actions.dir()).toBeNull();
  });

  it('保存に失敗したら知らせて、状態は変えない', async () => {
    const { actions, services, dialogs } = setup();
    services.store.dispatch(rename('x'));
    vi.spyOn(services.io, 'save').mockRejectedValue(new Error('書けない'));
    await actions.saveAs('/work/p');
    expect(dialogs.notify).toHaveBeenCalledWith(expect.stringContaining('書けない'));
    expect(actions.dir()).toBeNull();
    expect(actions.isDirty()).toBe(true);
  });
});

describe('開く', () => {
  it('フォルダを読み、素材を置き場に入れ、projectLoaded を出し、編集の状態を戻す', async () => {
    const fs = new MemoryFileSystem();
    const first = setup({ fs });
    await first.services.assets.put('a1', PNG);
    first.services.store.dispatch({ label: '素材', apply: (p) => ({ ...p, name: '保存した', assets: [asset('a1')] }) });
    await first.actions.saveAs('/work/proj');

    const second = setup({ fs });
    second.services.editor.set({ selectedPartIds: ['x'], editorParamValues: { FaceAngleX: 30 } });
    const loaded: unknown[] = [];
    const off = onAppEvent(PROJECT_LOADED, (p) => loaded.push(p));
    await second.actions.open('/work/proj');
    off();
    const project = second.services.store.get();
    expect(project.name).toBe('保存した');
    expect(second.services.assets.getPng('a1')).toBeDefined();
    expect(loaded).toEqual([project]);
    expect(second.services.editor.get()).toMatchObject({ selectedPartIds: [], editorParamValues: {} });
    expect(second.actions.dir()).toBe('/work/proj');
    expect(second.actions.isDirty()).toBe(false);
    expect(second.services.store.canUndo()).toBe(false);
    expect(second.environment.get().lastProjectDir).toBe('/work/proj');
  });

  it('保存していない変更があれば確かめ、断ったら開かない', async () => {
    const { actions, services, dialogs, platform } = setup({ answers: { confirm: false } });
    services.store.dispatch(rename('変更'));
    await actions.open();
    expect(dialogs.confirm).toHaveBeenCalled();
    expect(platform.pickFolder).not.toHaveBeenCalled();
    expect(services.store.get().name).toBe('変更');
  });

  it('開けないフォルダは知らせて、いまのプロジェクトのまま', async () => {
    const { actions, services, dialogs } = setup();
    const before = services.store.get();
    await actions.open('/none');
    expect(dialogs.notify).toHaveBeenCalledWith(expect.stringContaining('開けなかった'));
    expect(services.store.get()).toBe(before);
  });
});

describe('新規', () => {
  it('名前を入れて空のプロジェクトを作る。キャンセルなら何もしない', async () => {
    const { actions, services, dialogs } = setup({ answers: { prompt: null } });
    const before = services.store.get();
    await actions.newProject();
    expect(services.store.get()).toBe(before);
    dialogs.prompt.mockResolvedValueOnce('新しいモデル');
    await actions.newProject();
    expect(services.store.get().name).toBe('新しいモデル');
    expect(services.store.get().id).not.toBe(before.id);
    expect(actions.dir()).toBeNull();
    expect(actions.isDirty()).toBe(false);
  });
});

describe('起動時の復元', () => {
  it('保存先の無いまま異常終了した作業を、確かめてから復元する（変更ありの状態）', async () => {
    const fs = new MemoryFileSystem();
    const crashed = setup({ fs });
    await crashed.actions.recoverOnStartup();
    await crashed.services.assets.put('a1', PNG);
    crashed.services.store.dispatch({
      label: '素材',
      apply: (p) => ({ ...p, name: '作業中', assets: [asset('a1')] }),
    });
    await (crashed.services.autoSaver as unknown as { flush(): Promise<void> }).flush();
    crashed.services.autoSaver.stop(); // ここで異常終了したことにする

    const next = setup({ fs });
    expect(await next.actions.recoverOnStartup()).toBe(true);
    expect(next.dialogs.confirm).toHaveBeenCalledWith(expect.stringContaining('復元'));
    expect(next.services.store.get().name).toBe('作業中');
    expect(next.services.assets.getPng('a1')).toBeDefined();
    expect(next.actions.dir()).toBeNull();
    expect(next.actions.isDirty()).toBe(true);
  });

  it('前回のプロジェクトのフォルダに、保存より新しい自動保存があれば復元を提案する', async () => {
    const fs = new MemoryFileSystem();
    const crashed = setup({ fs });
    await crashed.actions.saveAs('/work/proj');
    crashed.services.store.dispatch(rename('保存の後の変更'));
    await (crashed.services.autoSaver as unknown as { flush(): Promise<void> }).flush();
    crashed.services.autoSaver.stop();

    const next = setup({ fs });
    next.environment.set({ lastProjectDir: '/work/proj' });
    expect(await next.actions.recoverOnStartup()).toBe(true);
    expect(next.services.store.get().name).toBe('保存の後の変更');
    expect(next.actions.dir()).toBe('/work/proj');
    expect(next.actions.isDirty()).toBe(true);
  });

  it('残っていなければ何も聞かず、断ったらいまの空のプロジェクトのまま', async () => {
    const empty = setup();
    expect(await empty.actions.recoverOnStartup()).toBe(false);
    expect(empty.dialogs.confirm).not.toHaveBeenCalled();

    const fs = new MemoryFileSystem();
    const crashed = setup({ fs });
    await crashed.actions.recoverOnStartup();
    crashed.services.store.dispatch(rename('作業中'));
    await (crashed.services.autoSaver as unknown as { flush(): Promise<void> }).flush();
    crashed.services.autoSaver.stop();
    const declined = setup({ fs, answers: { confirm: false } });
    const before = declined.services.store.get();
    expect(await declined.actions.recoverOnStartup()).toBe(false);
    expect(declined.services.store.get()).toBe(before);
  });
});
