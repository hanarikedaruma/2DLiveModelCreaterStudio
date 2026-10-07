// カード68（シーン・背景・ホットキーの後始末: I-023・I-024）のテスト。テストの担当は CL（実装の担当は CO）
// I-023: シーンを消すとき、そのシーンを対象にしたホットキーの扱いを確かめ、1回の Undo でシーンとホットキーの両方が戻る
// I-024: 背景の画像のプリセットを消せる。使っているシーンがあれば確かめる。キャンセルでは何も変わらない
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene, type Hotkey, type Project } from '@app/schema';
import { MemoryFileSystem, type Renderer, type Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { createBackgroundFiles, createBackgroundImages } from '../backgrounds';
import { register as registerStudio, setProjectDirResolver } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { activeScene } from '../scene';
import { removeBackgroundImage, removeBackgroundImageCommand } from './backgroundRemoval';
import { removeSceneCommand, renameSceneCommand } from './commands';
import { register as registerScenes, sceneWatcher } from './index';

const hk = (id: string, action: Hotkey['action'], targetId: string | null, mode: Hotkey['mode'] = 'toggle') => ({
  id,
  keys: `Ctrl+${id}`,
  action,
  targetId,
  mode,
});

// ---- シーンの削除（I-023） ----

// 雑談（chat）を対象にしたシーンのホットキーが2つ、ゲーム（game）を対象にしたものが1つ、ほかの動作が2つ
const SCENE_HOTKEYS: Hotkey[] = [
  hk('1', 'scene', 'chat'),
  hk('2', 'scene', 'game'),
  hk('3', 'scene', 'chat', 'hold'),
  hk('4', 'background', 'color:#00ff00'),
  hk('5', 'parameter', 'chat'), // 対象の id がたまたま同じでも、シーンのホットキーでなければ残す
];

function sceneProject(hotkeys: Hotkey[] = SCENE_HOTKEYS): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat' },
        { ...createEmptyScene('ゲーム'), id: 'game' },
      ],
      activeSceneId: 'chat',
      hotkeys,
    },
  };
}

function stubSize(width: number, height: number) {
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
    if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
  };
}

// 実際の Shell にスタジオとシーンの画面を出す。project は load するので、Undo の履歴は空から始まる
async function setupScreen(project: Project, prepare?: (services: Services) => Promise<void>) {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  await prepare?.(services);
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(createElement(Shell, { services, environment }));
  await act(async () => {
    services.store.load(project);
    services.editor.set({ mode: 'studio' });
  });
  return { services };
}

const panel = () => document.querySelector<HTMLElement>('[data-panel-id="scene"]')!;
const sceneNames = () =>
  within(within(panel()).getByRole('list', { name: 'シーンの一覧' }))
    .getAllByRole('button')
    .map((b) => b.textContent);
const sceneDeleteButton = () => within(panel()).getByRole('button', { name: '削除' });
const hotkeyIds = (services: Services) => services.store.get().studio.hotkeys.map((h) => h.id);
const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });
const answer = async (name: 'OK' | 'キャンセル') => {
  const dialog = await screen.findByRole('dialog');
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name }));
  });
};

let restoreSize: () => void;

beforeEach(() => {
  registry.reset();
  registerStudio();
  registerScenes();
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは手で進める
  restoreSize = stubSize(800, 600);
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // jsdom には createImageBitmap が無い
});

afterEach(() => {
  cleanup();
  sceneWatcher.unbind();
  restoreSize();
  setProjectDirResolver(() => null);
  studioRuntime.setScheduler(animationFrameScheduler());
  vi.restoreAllMocks();
});

describe('カード68 I-023: シーンを消すとき、そのシーンのホットキーの扱いを確かめる', () => {
  it('シーンの削除のコマンドは、そのシーンを対象にしたシーンのホットキーだけを一緒に消す', () => {
    const p = sceneProject();
    const next = removeSceneCommand('chat').apply(p);
    expect(next.studio.scenes.map((s) => s.id)).toEqual(['game']);
    expect(next.studio.activeSceneId).toBe('game');
    expect(next.studio.hotkeys.map((h) => h.id)).toEqual(['2', '4', '5']);
    // 消さなかったホットキーは中身もそのまま
    expect(next.studio.hotkeys).toEqual([SCENE_HOTKEYS[1], SCENE_HOTKEYS[3], SCENE_HOTKEYS[4]]);
    // 無いシーンなら何もしない（同じ参照）
    expect(removeSceneCommand('none').apply(p)).toBe(p);
  });

  it('シーンの画面で消すと、対象のホットキーの数を出して確かめる。キャンセルでは何も変わらない', async () => {
    const { services } = await setupScreen(sceneProject());
    const before = services.store.get();
    click(sceneDeleteButton());
    const dialog = await screen.findByRole('dialog');
    // 雑談を対象にしたホットキーは 2 個（ゲームを対象にしたもの・ほかの動作のものは数えない）
    expect(within(dialog).getByText(/ホットキー.*2 個/)).toBeTruthy();
    await answer('キャンセル');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.store.get()).toBe(before);
    expect(services.store.canUndo()).toBe(false);
    expect(sceneNames()).toEqual(['雑談', 'ゲーム']);
    expect(hotkeyIds(services)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('OK でシーンと対象のホットキーを一緒に消し、1回の Undo で両方戻り、Redo でまた両方消える', async () => {
    const { services } = await setupScreen(sceneProject());
    const before = services.store.get();
    click(sceneDeleteButton());
    await answer('OK');
    await waitFor(() => expect(sceneNames()).toEqual(['ゲーム']));
    expect(hotkeyIds(services)).toEqual(['2', '4', '5']);
    expect(activeScene(services.store.get())?.id).toBe('game');
    const after = services.store.get();

    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
    expect(services.store.canUndo()).toBe(false); // 1回の Undo で両方
    expect(sceneNames()).toEqual(['雑談', 'ゲーム']);
    expect(hotkeyIds(services)).toEqual(['1', '2', '3', '4', '5']);
    expect(activeScene(services.store.get())?.id).toBe('chat');

    act(() => services.store.redo());
    expect(services.store.get()).toBe(after);
    expect(sceneNames()).toEqual(['ゲーム']);
    expect(hotkeyIds(services)).toEqual(['2', '4', '5']);
  });

  it('対象のホットキーが無いシーンは確かめずに消し、ほかのシーンのホットキーは残す', async () => {
    const hotkeys = [hk('1', 'scene', 'chat'), hk('4', 'background', 'color:#00ff00')];
    const { services } = await setupScreen({
      ...sceneProject(hotkeys),
      studio: { ...sceneProject(hotkeys).studio, activeSceneId: 'game' },
    });
    const before = services.store.get();
    click(sceneDeleteButton());
    await waitFor(() => expect(sceneNames()).toEqual(['雑談']));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hotkeyIds(services)).toEqual(['1', '4']);
    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
  });

  it('確かめている間にプロジェクトが変わったら、OK でも消さずに知らせる', async () => {
    const { services } = await setupScreen(sceneProject());
    click(sceneDeleteButton());
    await screen.findByRole('dialog');
    act(() => services.store.dispatch(renameSceneCommand('game', '雑談2')));
    const changed = services.store.get();
    await answer('OK');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/変わった/));
    expect(services.store.get()).toBe(changed);
    expect(sceneNames()).toEqual(['雑談', '雑談2']);
    expect(hotkeyIds(services)).toEqual(['1', '2', '3', '4', '5']);
  });
});

// ---- 背景の画像の削除（I-024） ----

const ROOM = 'backgrounds/room.png';
const SKY = 'backgrounds/sky.webp';
const ROOM_BYTES = new Uint8Array([1, 2, 3]);

// 雑談とゲームは room.png、配信終わりは sky.webp、休憩は緑。
// room.png の背景のホットキーが2つ（toggle と hold）、ほかのホットキーが4つ
function imageProject(): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat', background: { type: 'image', path: ROOM } },
        { ...createEmptyScene('ゲーム'), id: 'game', background: { type: 'image', path: ROOM } },
        { ...createEmptyScene('配信終わり'), id: 'end', background: { type: 'image', path: SKY } },
        { ...createEmptyScene('休憩'), id: 'break', background: { type: 'color', color: '#00ff00' } },
      ],
      activeSceneId: 'chat',
      hotkeys: [
        hk('1', 'background', `image:${ROOM}`),
        hk('2', 'background', `image:${SKY}`),
        hk('3', 'background', `image:${ROOM}`, 'hold'),
        hk('4', 'background', 'color:#00ff00'),
        hk('5', 'scene', 'chat'),
        hk('6', 'parameter', 'MouthOpen'),
      ],
    },
  };
}

// フォルダ /p の backgrounds/ に room.png・sky.webp・unused.png がある（実際のディスクは使わない）
async function setupFiles(project: Project = imageProject()) {
  const { store } = createFakeServices();
  const fs = new MemoryFileSystem();
  const images = createBackgroundImages({ decode: async () => ({ close() {} }) as ImageBitmap });
  const files = createBackgroundFiles({ fs: () => fs, images });
  files.setProjectDirResolver(() => '/p');
  await fs.mkdir('/p/backgrounds');
  await fs.writeBinary(`/p/${ROOM}`, ROOM_BYTES);
  await fs.writeBinary(`/p/${SKY}`, new Uint8Array([4]));
  await fs.writeBinary('/p/backgrounds/unused.png', new Uint8Array([5]));
  store.load(project);
  const dialogs = { confirm: vi.fn(async (_message: string) => true), notify: vi.fn((_message: string) => {}) };
  return { store, fs, files, dialogs, before: store.get() };
}

describe('カード68 I-024: 背景の画像のプリセットを消す（使っているシーンがあれば確かめる）', () => {
  it('削除のコマンドは、その画像を使うシーンを透明にし、その画像の背景のホットキーだけ消す', () => {
    const p = imageProject();
    const next = removeBackgroundImageCommand(ROOM).apply(p);
    expect(next.studio.scenes.map((s) => [s.id, s.background])).toEqual([
      ['chat', { type: 'transparent' }],
      ['game', { type: 'transparent' }],
      ['end', { type: 'image', path: SKY }],
      ['break', { type: 'color', color: '#00ff00' }],
    ]);
    // 背景のほかは変えない
    expect(next.studio.scenes.map(({ background: _, ...rest }) => rest)).toEqual(
      p.studio.scenes.map(({ background: _, ...rest }) => rest),
    );
    expect(next.studio.activeSceneId).toBe('chat');
    expect(next.studio.hotkeys.map((h) => h.id)).toEqual(['2', '4', '5', '6']);
  });

  it('使っているシーンの名前とホットキーの数を出して確かめ、OK で画像を退避して一覧から外す', async () => {
    const { store, fs, files, dialogs } = await setupFiles();
    expect(await files.list()).toEqual([ROOM, SKY, 'backgrounds/unused.png']);
    expect(await removeBackgroundImage(store, files, dialogs, ROOM)).toBe(true);

    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    const message = dialogs.confirm.mock.calls[0]![0];
    expect(message).toContain('雑談');
    expect(message).toContain('ゲーム');
    expect(message).not.toContain('配信終わり'); // 使っていないシーンは出さない
    expect(message).not.toContain('休憩');
    expect(message).toMatch(/ホットキー.*2 個/);

    expect(store.get().studio.scenes.map((s) => s.background)).toEqual([
      { type: 'transparent' },
      { type: 'transparent' },
      { type: 'image', path: SKY },
      { type: 'color', color: '#00ff00' },
    ]);
    expect(store.get().studio.hotkeys.map((h) => h.id)).toEqual(['2', '4', '5', '6']);
    expect(await files.list()).toEqual([SKY, 'backgrounds/unused.png']);
    expect(await fs.exists(`/p/${ROOM}`)).toBe(false);
    expect(await fs.readBinary('/p/backgrounds/.removed/room.png')).toEqual(ROOM_BYTES);
    expect(dialogs.notify).not.toHaveBeenCalled();
  });

  it('1回の Undo で画像（同じバイト）とシーン・ホットキーが戻り、Redo でまた消える', async () => {
    const { store, fs, files, dialogs, before } = await setupFiles();
    expect(await removeBackgroundImage(store, files, dialogs, ROOM)).toBe(true);
    const after = store.get();

    store.undo();
    expect(store.get()).toBe(before);
    expect(store.canUndo()).toBe(false); // 1回の Undo で画像と設定の両方
    await vi.waitFor(async () => expect(await files.list()).toEqual([ROOM, SKY, 'backgrounds/unused.png']));
    expect(await fs.readBinary(`/p/${ROOM}`)).toEqual(ROOM_BYTES);
    expect(await files.load(ROOM)).toEqual(ROOM_BYTES);
    expect(await fs.exists('/p/backgrounds/.removed/room.png')).toBe(false);

    store.redo();
    expect(store.get()).toBe(after);
    await vi.waitFor(async () => expect(await files.list()).toEqual([SKY, 'backgrounds/unused.png']));
    expect(await fs.exists(`/p/${ROOM}`)).toBe(false);
    expect(store.get().studio.hotkeys.map((h) => h.id)).toEqual(['2', '4', '5', '6']);
    expect(dialogs.notify).not.toHaveBeenCalled();
  });

  it('キャンセルでは画像・シーン・ホットキー・Undo の履歴のどれも変わらない', async () => {
    const { store, fs, files, dialogs, before } = await setupFiles();
    dialogs.confirm.mockResolvedValueOnce(false);
    expect(await removeBackgroundImage(store, files, dialogs, ROOM)).toBe(false);
    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(before);
    expect(store.canUndo()).toBe(false);
    expect(await files.list()).toEqual([ROOM, SKY, 'backgrounds/unused.png']);
    expect(await fs.readBinary(`/p/${ROOM}`)).toEqual(ROOM_BYTES);
    expect(await fs.exists('/p/backgrounds/.removed')).toBe(false);
  });

  it('どのシーンでも使っていない画像も消せ、シーンの背景とホットキーは変わらない', async () => {
    const { store, fs, files, dialogs, before } = await setupFiles();
    expect(await removeBackgroundImage(store, files, dialogs, 'backgrounds/unused.png')).toBe(true);
    for (const name of ['雑談', 'ゲーム', '配信終わり', '休憩']) {
      expect(dialogs.confirm.mock.calls[0]![0]).not.toContain(name);
    }
    expect(store.get().studio.scenes).toEqual(before.studio.scenes);
    expect(store.get().studio.hotkeys).toEqual(before.studio.hotkeys);
    expect(await files.list()).toEqual([ROOM, SKY]);
    expect(await fs.exists('/p/backgrounds/unused.png')).toBe(false);

    store.undo();
    expect(store.get()).toBe(before);
    await vi.waitFor(async () => expect(await files.list()).toEqual([ROOM, SKY, 'backgrounds/unused.png']));
    expect(await fs.readBinary('/p/backgrounds/unused.png')).toEqual(new Uint8Array([5]));
  });

  it('画像を退避できなければ、シーン・ホットキーを変えずに知らせる', async () => {
    const { store, fs, files, dialogs, before } = await setupFiles();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('ディスクがいっぱい'));
    expect(await removeBackgroundImage(store, files, dialogs, ROOM)).toBe(false);
    expect(store.get()).toBe(before);
    expect(store.canUndo()).toBe(false);
    expect(await files.list()).toEqual([ROOM, SKY, 'backgrounds/unused.png']);
    expect(dialogs.notify).toHaveBeenCalledTimes(1);
    expect(dialogs.notify.mock.calls[0]![0]).toContain('ディスクがいっぱい');
  });

  it('シーンの画面の削除ボタン: 使っているシーンを出して確かめ、キャンセルでは残し、OK で消して Undo で戻す', async () => {
    const { services } = await setupScreen(imageProject(), async (s) => {
      setProjectDirResolver(() => '/projects/demo');
      await s.fs.mkdir('/projects/demo/backgrounds');
      await s.fs.writeBinary(`/projects/demo/${ROOM}`, ROOM_BYTES);
      await s.fs.writeBinary(`/projects/demo/${SKY}`, new Uint8Array([4]));
    });
    const before = services.store.get();
    const images = () => within(within(panel()).getByRole('group', { name: '背景の画像' }));
    const imagePaths = () =>
      images()
        .getAllByRole('button', { name: /^画像 \d+$/ })
        .map((b) => b.title);
    await waitFor(() => expect(imagePaths()).toEqual([ROOM, SKY]));
    const removeRoom = () => images().getByRole('button', { name: /room\.png.*を削除$/ });

    // キャンセル: 何も変わらない
    click(removeRoom());
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('雑談');
    expect(dialog.textContent).toContain('ゲーム');
    expect(dialog.textContent).not.toContain('配信終わり');
    await answer('キャンセル');
    expect(services.store.get()).toBe(before);
    expect(imagePaths()).toEqual([ROOM, SKY]);
    expect(await services.fs.exists(`/projects/demo/${ROOM}`)).toBe(true);

    // OK: 画像が一覧から消え、使っていたシーンは透明になる
    click(removeRoom());
    await answer('OK');
    await waitFor(() => expect(imagePaths()).toEqual([SKY]));
    expect(within(panel()).getByLabelText('いまの背景').textContent).toBe('いまの背景: 透明');
    expect(services.store.get().studio.hotkeys.map((h) => h.id)).toEqual(['2', '4', '5', '6']);
    expect(await services.fs.exists(`/projects/demo/${ROOM}`)).toBe(false);

    // 1回の Undo で画像とシーンの背景が戻る
    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
    await waitFor(() => expect(imagePaths()).toEqual([ROOM, SKY]));
    expect(within(panel()).getByLabelText('いまの背景').textContent).toBe('いまの背景: 画像（room.png）');
    expect(images().getByTitle(ROOM).getAttribute('aria-pressed')).toBe('true');
    expect(await services.fs.readBinary(`/projects/demo/${ROOM}`)).toEqual(ROOM_BYTES);
  });
});
