import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene, type Project } from '@app/schema';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { onAppEvent } from '../../../shell/events';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio, setProjectDirResolver } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { activeScene } from '../scene';
import { register, SCENE_CHANGED_EVENT, sceneWatcher } from './index';

function project(): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    expressions: [
      { id: 'smile', name: '笑顔', entries: [], fadeIn: 0, fadeOut: 0 },
      { id: 'angry', name: '怒り', entries: [], fadeIn: 0, fadeOut: 0 },
    ],
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat' },
        { ...createEmptyScene('ゲーム'), id: 'game' },
      ],
      activeSceneId: 'chat',
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

let changed: unknown[];
let offEvent: () => void;
let restoreSize: () => void;

async function setup(prepare?: (services: Services) => Promise<void>) {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  await prepare?.(services);
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    services.store.load(project());
    services.editor.set({ mode: 'studio' });
  });
  changed = []; // 開いたとき（読み込み）の分は数えない
  return { services };
}

const panel = () => document.querySelector<HTMLElement>('[data-panel-id="scene"]')!;
const list = () => within(panel()).getByRole('list', { name: 'シーンの一覧' });
const names = () =>
  within(list())
    .getAllByRole('button')
    .map((b) => b.textContent);
const sceneButton = (name: string) => within(list()).getByRole('button', { name });
const action = (name: string) => within(panel()).getByRole('button', { name });
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const scene = (services: Services) => activeScene(services.store.get())!;
const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });

async function answerPrompt(text: string) {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: text } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  });
}

beforeEach(() => {
  registry.reset();
  registerStudio();
  register();
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは手で進める
  restoreSize = stubSize(800, 600);
  changed = [];
  offEvent = onAppEvent(SCENE_CHANGED_EVENT, (id) => changed.push(id));
});

afterEach(() => {
  cleanup();
  offEvent();
  sceneWatcher.unbind();
  restoreSize();
  setProjectDirResolver(() => null);
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('シーンの一覧', () => {
  it('シーンを消すと対象のホットキーの確認が出て、キャンセル・1回のUndo/Redoで両方を扱う', async () => {
    const { services } = await setup();
    const hotkeys = [{ id: 'h', keys: 'Ctrl+1', action: 'scene' as const, targetId: 'chat', mode: 'toggle' as const }];
    act(() =>
      services.store.dispatch({ label: '割り当て', apply: (p) => ({ ...p, studio: { ...p.studio, hotkeys } }) }),
    );
    const before = services.store.get();
    click(action('削除'));
    expect(await screen.findByText(/このシーンのホットキー.*1.*消/)).toBeTruthy();
    click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(services.store.get()).toBe(before);
    click(action('削除'));
    click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(services.store.get().studio.scenes.some((s) => s.id === 'chat')).toBe(false));
    expect(services.store.get().studio.hotkeys).toEqual([]);
    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
    act(() => services.store.redo());
    expect(services.store.get().studio.hotkeys).toEqual([]);
  });
  it('スタジオの left のパネルに出て、中に選んだシーンの編集のセクションが入る', async () => {
    await setup();
    expect(panel().closest('[data-area="left"]')).toBeTruthy();
    expect(within(panel()).getByText('シーン')).toBeTruthy();
    expect(names()).toEqual(['雑談', 'ゲーム']);
    expect(sceneButton('雑談').getAttribute('aria-pressed')).toBe('true');
    const sections = [...panel().querySelectorAll('[data-section-id]')].map((s) => s.getAttribute('data-section-id'));
    expect(sections).toEqual(['scene.background', 'scene.expression', 'scene.placement']);
    // 背景はシーンの編集に移したので、右のスタジオの設定には無い
    expect(document.querySelector('[data-panel-id="studioSettings"] [data-section-id="studio.background"]')).toBeNull();
  });

  it('追加・切り替え・削除と Undo。切り替わるたびに sceneChanged が1回出る', async () => {
    const { services } = await setup();
    click(action('追加'));
    expect(names()).toEqual(['雑談', 'ゲーム', 'シーン 3']);
    expect(sceneButton('シーン 3').getAttribute('aria-pressed')).toBe('true');
    const added = scene(services).id;
    expect(changed).toEqual([added]);

    click(sceneButton('ゲーム'));
    expect(services.store.get().studio.activeSceneId).toBe('game');
    click(sceneButton('ゲーム')); // いまのシーンを押しても何も起きない
    expect(changed).toEqual([added, 'game']);

    click(action('削除'));
    expect(names()).toEqual(['雑談', 'シーン 3']);
    expect(scene(services).id).toBe(added); // すぐ後ろのシーンに切り替わる
    expect(changed).toEqual([added, 'game', added]);

    act(() => services.store.undo()); // 削除を戻す
    expect(names()).toEqual(['雑談', 'ゲーム', 'シーン 3']);
    expect(scene(services).id).toBe('game');
    act(() => services.store.undo()); // 切り替えを戻す
    expect(scene(services).id).toBe(added);
    act(() => services.store.undo()); // 追加を戻す
    expect(names()).toEqual(['雑談', 'ゲーム']);
    expect(scene(services).id).toBe('chat');
    expect(changed).toEqual([added, 'game', added, 'game', added, 'chat']);
  });

  it('最後の1つは削除できない', async () => {
    await setup();
    click(action('削除'));
    expect(names()).toEqual(['ゲーム']);
    expect((action('削除') as HTMLButtonElement).disabled).toBe(true);
  });

  it('名前の変更（ボタンとダブルクリック）・複製・並べ替え', async () => {
    const { services } = await setup();
    click(action('名前の変更'));
    await answerPrompt('朝の雑談');
    expect(names()).toEqual(['朝の雑談', 'ゲーム']);

    fireEvent.doubleClick(sceneButton('ゲーム'));
    await answerPrompt('  FPS  ');
    expect(names()).toEqual(['朝の雑談', 'FPS']);

    click(sceneButton('朝の雑談'));
    click(action('複製'));
    expect(names()).toEqual(['朝の雑談', '朝の雑談 のコピー', 'FPS']);
    expect(scene(services).name).toBe('朝の雑談 のコピー');

    click(action('下へ'));
    expect(names()).toEqual(['朝の雑談', 'FPS', '朝の雑談 のコピー']);
    expect((action('下へ') as HTMLButtonElement).disabled).toBe(true);
    click(action('上へ'));
    click(action('上へ'));
    expect(names()).toEqual(['朝の雑談 のコピー', '朝の雑談', 'FPS']);
    expect((action('上へ') as HTMLButtonElement).disabled).toBe(true);
    expect(scene(services).name).toBe('朝の雑談 のコピー'); // 並べ替えではシーンは変わらない
  });
});

describe('シーンごとの背景と配置', () => {
  it('背景プリセットと配置はシーンごとに保たれ、実行部は使っているシーンのものを使う', async () => {
    const { services } = await setup();
    expect(screen.getAllByRole('button', { name: /^(透明|緑|青|白|黒)$/ }).map((b) => b.textContent)).toEqual([
      '透明',
      '緑',
      '青',
      '白',
      '黒',
    ]);
    click(screen.getByRole('button', { name: '緑' }));
    const x = screen.getByRole('spinbutton', { name: '横の位置' });
    fireEvent.change(x, { target: { value: '120' } });
    fireEvent.keyDown(x, { key: 'Enter' });
    const size = screen.getByRole('spinbutton', { name: '大きさ' });
    fireEvent.change(size, { target: { value: '150' } });
    fireEvent.blur(size);
    expect(scene(services).background).toEqual({ type: 'color', color: '#00ff00' });
    expect(scene(services).modelTransform).toEqual({ position: { x: 120, y: 0 }, scale: 1.5 });

    click(sceneButton('ゲーム'));
    expect(pressed('透明')).toBe('true');
    expect((screen.getByRole('spinbutton', { name: '横の位置' }) as HTMLInputElement).value).toBe('0');
    click(screen.getByRole('button', { name: '黒' }));
    expect(studioRuntime.tick(0)!.background).toEqual({ type: 'color', color: '#000000' });

    click(sceneButton('雑談'));
    expect(pressed('緑')).toBe('true');
    expect(screen.getByLabelText('いまの背景').textContent).toBe('いまの背景: 緑');
    expect((screen.getByRole('spinbutton', { name: '横の位置' }) as HTMLInputElement).value).toBe('120');
    expect((screen.getByRole('spinbutton', { name: '大きさ' }) as HTMLInputElement).value).toBe('150');
    expect(studioRuntime.tick(16)!.background).toEqual({ type: 'color', color: '#00ff00' });
    const chat = services.store.get().studio.scenes.find((s) => s.id === 'chat')!;
    const game = services.store.get().studio.scenes.find((s) => s.id === 'game')!;
    expect(game.background).toEqual({ type: 'color', color: '#000000' });
    expect(game.modelTransform).toEqual({ position: { x: 0, y: 0 }, scale: 1 });
    expect(chat.modelTransform.scale).toBe(1.5);
  });

  it('プレビューのドラッグは選んだシーンの配置に入る', async () => {
    const { services } = await setup();
    click(sceneButton('ゲーム'));
    const canvas = screen.getByTestId('studio-preview');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 140, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerUp(canvas, { button: 0, clientX: 140, clientY: 100, pointerId: 1 });
    });
    const k = 800 / 1920; // 1920×1080 の出力画面を 800×600 に収めた縮尺
    const byId = (id: string) => services.store.get().studio.scenes.find((s) => s.id === id)!;
    expect(byId('game').modelTransform.position.x).toBeCloseTo(40 / k);
    expect(byId('chat').modelTransform.position.x).toBe(0);
    expect(Number((screen.getByRole('spinbutton', { name: '横の位置' }) as HTMLInputElement).value)).toBe(
      Math.round(40 / k),
    );
  });

  it('backgrounds/ の画像と足した画像はプリセットになり、ほかのシーンでも選べる', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // jsdom には createImageBitmap が無い
    // 開いているプロジェクトのフォルダの backgrounds/ に画像が1枚ある
    const { services } = await setup(async (s) => {
      setProjectDirResolver(() => '/projects/demo');
      await s.fs.mkdir('/projects/demo/backgrounds');
      await s.fs.writeBinary('/projects/demo/backgrounds/room.png', new Uint8Array([1]));
      await s.fs.writeBinary('/projects/demo/backgrounds/memo.txt', new Uint8Array([2]));
    });
    const images = () => within(screen.getByRole('group', { name: '背景の画像' }));
    expect(await images().findByRole('button', { name: '画像 1' })).toBeTruthy();
    expect(images().getByRole('button', { name: '画像 1' }).title).toBe('backgrounds/room.png');
    expect(images().queryByRole('button', { name: '画像 2' })).toBeNull(); // 画像でないファイルは出さない

    const input = screen.getByTestId('studio-background-file') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([new Uint8Array([4, 5])], 'sky.png')] } });
    });
    await waitFor(() => expect(scene(services).background.type).toBe('image'));
    const bg = scene(services).background;
    const path = bg.type === 'image' ? bg.path : '';
    expect(path).toMatch(/^backgrounds\/.+\.png$/);
    expect(await services.fs.readBinary(`/projects/demo/${path}`)).toEqual(new Uint8Array([4, 5]));
    expect(await images().findByTitle(path)).toBeTruthy();
    expect(images().getByTitle(path).getAttribute('aria-pressed')).toBe('true');
    expect(images().getAllByRole('button', { name: /^画像 \d$/ })).toHaveLength(2);

    click(sceneButton('ゲーム'));
    expect(scene(services).background).toEqual({ type: 'transparent' });
    expect(images().getByTitle(path).getAttribute('aria-pressed')).toBe('false'); // ほかのシーンでもプリセットに残る
    click(images().getByTitle('backgrounds/room.png'));
    expect(scene(services).background).toEqual({ type: 'image', path: 'backgrounds/room.png' });
    expect(screen.getByLabelText('いまの背景').textContent).toBe('いまの背景: 画像（room.png）');
    click(sceneButton('雑談'));
    expect(scene(services).background).toEqual({ type: 'image', path });
    warn.mockRestore();
  });
});

describe('シーンの表情', () => {
  it('選んだ表情はシーンに切り替えたときに適用し、表情の無いシーンでは外す', async () => {
    const { services } = await setup();
    const select = screen.getByRole('combobox', { name: 'シーンの表情' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['（なし）', '笑顔', '怒り']);
    act(() => {
      fireEvent.change(select, { target: { value: 'smile' } });
    });
    expect(scene(services).expressionIds).toEqual(['smile']);
    expect(services.expressions.active()).toBe('smile'); // 使っているシーンなので、すぐに適用する

    click(sceneButton('ゲーム'));
    expect(services.expressions.active()).toBeNull();
    expect((screen.getByRole('combobox', { name: 'シーンの表情' }) as HTMLSelectElement).value).toBe('');
    click(sceneButton('雑談'));
    expect(services.expressions.active()).toBe('smile');
    expect(changed).toEqual(['game', 'chat']);
  });
});
