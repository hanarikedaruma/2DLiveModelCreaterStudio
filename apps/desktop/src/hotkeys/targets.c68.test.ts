// カード68（シーン・背景・ホットキーの後始末: I-021・I-022）のテスト。テストの担当は CL（実装の担当は CO）
// I-021: シーンで使っていない背景の画像も、ホットキーの背景の選択肢に出る
// I-022: 背景のプリセット・表示名・シーンの切り替えのコマンドの定義は scenes の1か所で、ホットキーもそれを使う
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene, type Hotkey, type Project } from '@app/schema';
import { FakeHotkeys, type Command, type Renderer, type Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { registry } from '../shell/registry';
import { Shell } from '../shell/Shell';
import { register as registerStudio, setProjectDirResolver } from '../modes/studio';
import { animationFrameScheduler, studioRuntime } from '../modes/studio/runtime';
import { sceneBackground, setBackgroundCommand, type SceneBackground } from '../modes/studio/scene';
import { register as registerScenes, sceneWatcher } from '../modes/studio/scenes';
import { selectSceneCommand } from '../modes/studio/scenes/commands';
import * as scenePresets from '../modes/studio/scenes/presets';
import { createHotkeyActions, type HotkeyActions } from './actions';
import { register as registerHotkeys } from './index';
import { hotkeyRuntime } from './runtime';
import {
  BACKGROUND_PRESETS,
  backgroundLabel,
  backgroundTargetId,
  describeHotkey,
  setActiveSceneCommand,
  targetOptions,
} from './targets';

// 雑談は room.png の画像、ゲームは色（#ff00ff）。sky.webp と unused.png はどのシーンでも使っていない
function project(): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    studio: {
      ...p.studio,
      scenes: [
        { ...p.studio.scenes[0]!, id: 's1', name: '雑談', background: { type: 'image', path: 'backgrounds/room.png' } },
        { ...createEmptyScene('ゲーム'), id: 's2', background: { type: 'color', color: '#ff00ff' } },
      ],
      activeSceneId: 's1',
      hotkeys: [],
    },
  };
}

// backgrounds/ の一覧（BackgroundFiles.list と同じく名前の順）
const LISTED = ['backgrounds/room.png', 'backgrounds/sky.webp', 'backgrounds/unused.png'];

const hk = (id: string, action: Hotkey['action'], targetId: string | null): Hotkey => ({
  id,
  keys: 'F1',
  action,
  targetId,
  mode: 'toggle',
});

function createActions(services: Services): HotkeyActions {
  const actions = createHotkeyActions();
  actions.setContext({
    services,
    now: () => 0,
    emit() {},
    trackingSessionActive: () => false,
    cameraDeviceId: () => null,
    expressionMode: () => 'stack',
    notify() {},
  });
  return actions;
}

const press = (actions: HotkeyActions, hotkey: Hotkey) => {
  actions.handle(hotkey, 'down');
  actions.handle(hotkey, 'up');
};

describe('カード68 I-021: 使っていない背景の画像もホットキーの背景の選択肢に出る', () => {
  it('backgrounds/ の画像はシーンで使っていなくても選択肢に出る。使っている画像と重ならない', () => {
    const options = targetOptions('background', project(), LISTED);
    expect(Object.fromEntries(options.map((o) => [o.value, o.label]))).toEqual({
      transparent: '透明',
      'color:#00ff00': '緑',
      'color:#0000ff': '青',
      'color:#ffffff': '白',
      'color:#000000': '黒',
      'image:backgrounds/room.png': '画像（room.png）',
      'color:#ff00ff': '色（#ff00ff）',
      'image:backgrounds/sky.webp': '画像（sky.webp）',
      'image:backgrounds/unused.png': '画像（unused.png）',
    });
    // シーンで使っていて一覧にもある room.png は1つだけ（9 = プリセット5 + シーンの2 + 使っていない画像2）
    expect(options).toHaveLength(9);
    expect(options.filter((o) => o.value === 'image:backgrounds/room.png')).toHaveLength(1);
  });

  it('一覧を渡さなければ、今までどおりシーンで使っている背景だけ', () => {
    expect(targetOptions('background', project()).map((o) => o.value)).toEqual([
      'transparent',
      'color:#00ff00',
      'color:#0000ff',
      'color:#ffffff',
      'color:#000000',
      'image:backgrounds/room.png',
      'color:#ff00ff',
    ]);
  });

  it('使っていない画像を対象にしたホットキーで、その画像の背景に切り替わり、もう一度で戻る', () => {
    const services = createFakeServices();
    services.store.load(project());
    const actions = createActions(services);
    const option = targetOptions('background', project(), LISTED).find((o) => o.label === '画像（unused.png）');
    expect(option?.value).toBe('image:backgrounds/unused.png');
    const hotkey = hk('h-unused', 'background', option!.value);
    expect(describeHotkey(hotkey, services.store.get())).toBe('背景: 画像（unused.png）');

    press(actions, hotkey);
    expect(sceneBackground(services.store.get())).toEqual({ type: 'image', path: 'backgrounds/unused.png' });
    press(actions, hotkey);
    expect(sceneBackground(services.store.get())).toEqual({ type: 'image', path: 'backgrounds/room.png' });
  });
});

describe('カード68 I-022: 背景・シーンの定義は scenes の1か所（ホットキーはそれを使う）', () => {
  it('背景のプリセット・表示名・シーンの切り替えのコマンドは scenes のものと同じもの', () => {
    expect(BACKGROUND_PRESETS).toBe(scenePresets.BACKGROUND_PRESETS);
    expect(backgroundLabel).toBe(scenePresets.backgroundLabel);
    expect(setActiveSceneCommand).toBe(selectSceneCommand);
    expect(BACKGROUND_PRESETS.map((p) => p.label)).toEqual(['透明', '緑', '青', '白', '黒']);
  });

  it('ホットキーの背景の選択肢の先頭は、scenes のプリセットを同じ順・同じ表示名で並べる', () => {
    const p = createEmptyProject('空'); // シーンは透明だけ
    const options = targetOptions('background', p);
    expect(options.map((o) => ({ value: o.value, label: o.label }))).toEqual(
      scenePresets.BACKGROUND_PRESETS.map((preset) => ({
        value: backgroundTargetId(preset.background),
        label: preset.label,
      })),
    );
    expect(options.map((o) => o.value)).toEqual([
      'transparent',
      'color:#00ff00',
      'color:#0000ff',
      'color:#ffffff',
      'color:#000000',
    ]);
  });

  it('ホットキーの一覧の背景の名前は、シーンの画面と同じ表示名', () => {
    const p = project();
    const backgrounds: SceneBackground[] = [
      ...scenePresets.BACKGROUND_PRESETS.map((preset) => preset.background),
      { type: 'image', path: 'backgrounds/unused.png' },
      { type: 'color', color: '#123456' },
    ];
    expect(backgrounds.map((bg, i) => describeHotkey(hk(`b${i}`, 'background', backgroundTargetId(bg)), p))).toEqual(
      backgrounds.map((bg) => `背景: ${scenePresets.backgroundLabel(bg)}`),
    );
    expect(backgrounds.map((bg) => scenePresets.backgroundLabel(bg))).toEqual([
      '透明',
      '緑',
      '青',
      '白',
      '黒',
      '画像（unused.png）',
      '色（#123456）',
    ]);
  });

  it('ホットキーのシーンの切り替えは、シーンの一覧と同じコマンド（同じラベル・同じ結果・同じ何もしない場合）', () => {
    const services = createFakeServices();
    services.store.load(project());
    const before = services.store.get();
    const actions = createActions(services);
    const dispatch = vi.spyOn(services.store, 'dispatch');

    press(actions, hk('h-scene', 'scene', 's2'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const command = dispatch.mock.calls[0]![0] as Command;
    expect(command.label).toBe('シーンを切り替える');
    expect(command.label).toBe(selectSceneCommand('s2').label);
    expect(services.store.get()).toEqual(selectSceneCommand('s2').apply(before));
    expect(services.store.get().studio.activeSceneId).toBe('s2');
    // いまのシーン・無いシーンでは、どちらのコマンドも同じ参照を返す（Undo に積まない）
    const now = services.store.get();
    expect(command.apply(now)).toBe(now);
    expect(selectSceneCommand('s2').apply(now)).toBe(now);
    expect(setActiveSceneCommand('none').apply(now)).toBe(now);
  });

  it('ホットキーの背景の切り替えは、シーンの画面の背景のボタンと同じコマンド（同じラベル・同じ結果）', () => {
    const services = createFakeServices();
    services.store.load(project());
    const before = services.store.get();
    const actions = createActions(services);
    const dispatch = vi.spyOn(services.store, 'dispatch');
    const green = scenePresets.BACKGROUND_PRESETS.find((p) => p.label === '緑')!.background;

    press(actions, hk('h-green', 'background', backgroundTargetId(green)));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const command = dispatch.mock.calls[0]![0] as Command;
    expect(command.label).toBe('背景を変える');
    expect(command.label).toBe(setBackgroundCommand(green).label);
    expect(services.store.get()).toEqual(setBackgroundCommand(green).apply(before));
    expect(sceneBackground(services.store.get())).toEqual({ type: 'color', color: '#00ff00' });
  });
});

// ---- シーンの画面とホットキーの画面（実際の Shell） ----

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

// 開いているプロジェクトのフォルダの backgrounds/ に、雑談で使う room.png と、どのシーンでも使っていない unused.png がある
async function setupScreens() {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  setProjectDirResolver(() => '/projects/demo');
  await services.fs.mkdir('/projects/demo/backgrounds');
  await services.fs.writeBinary('/projects/demo/backgrounds/room.png', new Uint8Array([1]));
  await services.fs.writeBinary('/projects/demo/backgrounds/unused.png', new Uint8Array([2]));
  await services.fs.writeBinary('/projects/demo/backgrounds/memo.txt', new Uint8Array([3]));
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(createElement(Shell, { services, environment }));
  await act(async () => {
    services.store.load(project());
    services.editor.set({ mode: 'studio' });
  });
  await idle();
  return { services };
}

const idle = () => act(() => hotkeyRuntime.whenIdle());
const scenePanel = () => document.querySelector<HTMLElement>('[data-panel-id="scene"]')!;
const sceneImages = () => within(scenePanel()).getByRole('group', { name: '背景の画像' });
const sceneImagePaths = () =>
  within(sceneImages())
    .getAllByRole('button', { name: /^画像 \d+$/ })
    .map((b) => b.title);
const hotkeySection = () => document.querySelector<HTMLElement>('[data-section-id="studio.hotkeys"]')!;
const targetSelect = () => within(hotkeySection()).getByRole<HTMLSelectElement>('combobox', { name: '対象' });
const imageTargets = () =>
  [...targetSelect().options].filter((o) => o.value.startsWith('image:')).map((o) => [o.value, o.textContent]);
const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });

function openBackgroundForm() {
  click(within(hotkeySection()).getByRole('button', { name: '追加' }));
  act(() => {
    fireEvent.change(within(hotkeySection()).getByRole('combobox', { name: '動作' }), {
      target: { value: 'background' },
    });
  });
}

let restoreSize: () => void;

beforeEach(() => {
  registry.reset();
  registerStudio();
  registerScenes();
  registerHotkeys();
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは手で進める
  restoreSize = stubSize(800, 600);
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // jsdom には createImageBitmap が無い
});

afterEach(async () => {
  cleanup();
  await hotkeyRuntime.whenIdle();
  sceneWatcher.unbind();
  restoreSize();
  setProjectDirResolver(() => null);
  studioRuntime.setScheduler(animationFrameScheduler());
  vi.restoreAllMocks();
});

describe('カード68 I-021・I-022: シーンの画面とホットキーの画面は同じ背景の画像の一覧を使う', () => {
  it('どのシーンでも使っていない画像も、両方の画面に同じように出て、ホットキーで切り替えられる', async () => {
    const { services } = await setupScreens();
    // シーンの画面（背景の画像のプリセット）
    await waitFor(() => expect(sceneImagePaths()).toEqual(['backgrounds/room.png', 'backgrounds/unused.png']));

    // ホットキーの画面（背景の対象）。画像でない memo.txt は出さない
    openBackgroundForm();
    await waitFor(() =>
      expect(imageTargets()).toEqual([
        ['image:backgrounds/room.png', '画像（room.png）'],
        ['image:backgrounds/unused.png', '画像（unused.png）'],
      ]),
    );
    expect(imageTargets().map(([value]) => value)).toEqual(sceneImagePaths().map((path) => `image:${path}`));
    // 背景のプリセットも、シーンの画面と同じ表示名で出る（あとはゲームのシーンで使っている色）
    const presetLabels = scenePresets.BACKGROUND_PRESETS.map((p) => p.label);
    expect([...targetSelect().options].filter((o) => !o.value.startsWith('image:')).map((o) => o.textContent)).toEqual([
      ...presetLabels,
      '色（#ff00ff）',
    ]);
    expect(
      within(scenePanel())
        .getAllByRole('button', { name: /^(透明|緑|青|白|黒)$/ })
        .map((b) => b.textContent),
    ).toEqual(presetLabels);

    // 使っていない画像を選んで F9 に登録する
    act(() => {
      fireEvent.change(targetSelect(), { target: { value: 'image:backgrounds/unused.png' } });
    });
    fireEvent.keyDown(within(hotkeySection()).getByLabelText('キー'), { key: 'F9', code: 'F9' });
    click(within(hotkeySection()).getByRole('button', { name: '登録' }));
    await idle();
    expect(services.store.get().studio.hotkeys).toMatchObject([
      { keys: 'F9', action: 'background', targetId: 'image:backgrounds/unused.png', mode: 'toggle' },
    ]);
    expect(within(hotkeySection()).getByText('背景: 画像（unused.png）')).toBeTruthy();

    // F9 を押すと、シーンの画面でもその画像が選ばれた状態になる
    const fake = services.hotkeys as FakeHotkeys;
    act(() => {
      fake.press('F9', 'down');
      fake.press('F9', 'up');
    });
    expect(sceneBackground(services.store.get())).toEqual({ type: 'image', path: 'backgrounds/unused.png' });
    expect(within(scenePanel()).getByLabelText('いまの背景').textContent).toBe('いまの背景: 画像（unused.png）');
    expect(within(sceneImages()).getByTitle('backgrounds/unused.png').getAttribute('aria-pressed')).toBe('true');
    expect(within(sceneImages()).getByTitle('backgrounds/room.png').getAttribute('aria-pressed')).toBe('false');
  });

  it('シーンの画面で画像を消すと、ホットキーの選択肢からも消え、Undo で両方に戻る', async () => {
    const { services } = await setupScreens();
    await waitFor(() => expect(sceneImagePaths()).toEqual(['backgrounds/room.png', 'backgrounds/unused.png']));
    openBackgroundForm();
    await waitFor(() => expect(imageTargets().map(([value]) => value)).toContain('image:backgrounds/unused.png'));

    click(within(sceneImages()).getByRole('button', { name: /unused\.png.*を削除$/ }));
    click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(sceneImagePaths()).toEqual(['backgrounds/room.png']));
    await waitFor(() => expect(imageTargets()).toEqual([['image:backgrounds/room.png', '画像（room.png）']]));

    act(() => services.store.undo());
    await waitFor(() => expect(sceneImagePaths()).toEqual(['backgrounds/room.png', 'backgrounds/unused.png']));
    await waitFor(() =>
      expect(imageTargets()).toEqual([
        ['image:backgrounds/room.png', '画像（room.png）'],
        ['image:backgrounds/unused.png', '画像（unused.png）'],
      ]),
    );
  });
});
