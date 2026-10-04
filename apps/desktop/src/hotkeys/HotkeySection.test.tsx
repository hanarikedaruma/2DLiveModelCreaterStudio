import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyScene, type Hotkey, type Project } from '@app/schema';
import { FakeHotkeys, type HotkeyService, type Renderer, type Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { registry } from '../shell/registry';
import { Shell } from '../shell/Shell';
import { register as registerStudio } from '../modes/studio';
import { animationFrameScheduler, studioRuntime } from '../modes/studio/runtime';
import { register } from './index';
import { hotkeyRuntime } from './runtime';
import { CONFLICT_MESSAGE, DUPLICATE_MESSAGE, NEEDS_MODIFIER_MESSAGE } from './HotkeySection';

function project(hotkeys: Hotkey[] = []): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    model: {
      ...p.model,
      parameters: [
        ...p.model.parameters,
        { id: 'Tears', name: '涙', groupId: 'other', min: 0, max: 1, default: 0, standard: false },
      ],
    },
    expressions: [
      { id: 'smile', name: '笑顔', entries: [], fadeIn: 0, fadeOut: 0 },
      { id: 'angry', name: '怒り', entries: [], fadeIn: 0, fadeOut: 0 },
    ],
    studio: {
      scenes: [
        { ...p.studio.scenes[0]!, id: 'scene-1', name: '雑談' },
        { ...createEmptyScene('ゲーム'), id: 'scene-2' },
      ],
      activeSceneId: 'scene-1',
      hotkeys,
    },
  };
}

// 「ほかのアプリ」が使っているキーは conflict を返す
class OtherAppHotkeys implements HotkeyService {
  readonly inner = new FakeHotkeys();
  constructor(public taken: string[]) {}
  async register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void) {
    if (this.taken.includes(hotkey.keys)) return 'conflict' as const;
    return this.inner.register(hotkey, handler);
  }
  async unregisterAll() {
    await this.inner.unregisterAll();
  }
}

async function setup(options: { hotkeys?: Hotkey[]; service?: HotkeyService } = {}) {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  if (options.service) services.hotkeys = options.service;
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    services.store.load(project(options.hotkeys));
    services.editor.set({ mode: 'studio' });
  });
  await idle();
  return { services };
}

const idle = () => act(() => hotkeyRuntime.whenIdle());

const keyInput = () => screen.getByLabelText<HTMLInputElement>('キー');

function pressKeys(init: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }) {
  fireEvent.keyDown(keyInput(), init);
  fireEvent.keyUp(keyInput(), { ...init, ctrlKey: false, shiftKey: false, altKey: false });
}

const fake = (services: Services) => services.hotkeys as FakeHotkeys;

beforeEach(() => {
  registry.reset();
  registerStudio();
  register();
  // フレームは手で進める（自動では回さない）
  studioRuntime.setScheduler({ request: () => () => {} });
});

afterEach(async () => {
  cleanup();
  await hotkeyRuntime.whenIdle();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('ホットキーの割り当ての画面', () => {
  it('スタジオの設定のパネルに出る', async () => {
    await setup();
    const section = document.querySelector('[data-section-id="studio.hotkeys"]');
    expect(section).toBeTruthy();
    expect(section!.closest('[data-panel-id="studioSettings"]')).toBeTruthy();
    expect(within(section as HTMLElement).getByText('まだ登録していない')).toBeTruthy();
  });

  it('[追加] でキーを押して記録し、対象と動作を選んで登録する。toggle は押すたびに適用 / 解除', async () => {
    const { services } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.keyDown(keyInput(), { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(keyInput().value).toBe('Ctrl+…');
    fireEvent.keyDown(keyInput(), { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true });
    expect(keyInput().value).toBe('Ctrl+Shift+…');
    fireEvent.keyDown(keyInput(), { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(keyInput().value).toBe('Ctrl+Shift+1');

    expect(screen.getByLabelText<HTMLSelectElement>('動作').value).toBe('expression');
    expect(screen.getByLabelText<HTMLSelectElement>('対象').value).toBe('smile');
    expect(screen.getByLabelText<HTMLSelectElement>('動き').value).toBe('toggle');
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    await idle();

    expect(services.store.get().studio.hotkeys).toMatchObject([
      { keys: 'Ctrl+Shift+1', action: 'expression', targetId: 'smile', mode: 'toggle' },
    ]);
    expect(
      fake(services)
        .registered()
        .map((h) => h.keys),
    ).toEqual(['Ctrl+Shift+1']);
    const list = screen.getByRole('list', { name: 'ホットキーの一覧' });
    expect(within(list).getByText('Ctrl+Shift+1')).toBeTruthy();
    expect(within(list).getByText('表情: 笑顔')).toBeTruthy();
    expect(within(list).getByText('切り替え')).toBeTruthy();

    act(() => {
      fake(services).press('Ctrl+Shift+1', 'down');
      fake(services).press('Ctrl+Shift+1', 'up');
    });
    expect(services.expressions.active()).toBe('smile');
    act(() => {
      fake(services).press('Ctrl+Shift+1', 'down');
      fake(services).press('Ctrl+Shift+1', 'up');
    });
    expect(services.expressions.active()).toBeNull();
  });

  it('hold は押している間だけ（シーン）', async () => {
    const { services } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    pressKeys({ key: 'F8', code: 'F8' });
    fireEvent.change(screen.getByLabelText('動作'), { target: { value: 'scene' } });
    fireEvent.change(screen.getByLabelText('対象'), { target: { value: 'scene-2' } });
    fireEvent.change(screen.getByLabelText('動き'), { target: { value: 'hold' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    await idle();
    expect(screen.getByText('シーン: ゲーム')).toBeTruthy();
    expect(screen.getByText('押している間')).toBeTruthy();

    act(() => {
      fake(services).press('F8', 'down');
    });
    expect(services.store.get().studio.activeSceneId).toBe('scene-2');
    act(() => {
      fake(services).press('F8', 'up');
    });
    expect(services.store.get().studio.activeSceneId).toBe('scene-1');
  });

  it('パラメータのホットキーはスタジオの実行部の producer で max を出す', async () => {
    const { services } = await setup({
      hotkeys: [{ id: 'p', keys: 'Alt+T', action: 'parameter', targetId: 'Tears', mode: 'toggle' }],
    });
    expect(screen.getByText('パラメータ: 涙')).toBeTruthy();
    expect(studioRuntime.tick(1)?.params.Tears).toBe(0);
    act(() => {
      fake(services).press('Alt+T', 'down');
      fake(services).press('Alt+T', 'up');
    });
    expect(studioRuntime.tick(2)?.params.Tears).toBe(1);
    act(() => {
      fake(services).press('Alt+T', 'down');
      fake(services).press('Alt+T', 'up');
    });
    expect(studioRuntime.tick(3)?.params.Tears).toBe(0);
  });

  it('ほかのアプリと重なって登録できないときは「ほかのアプリと重なっています」と出す', async () => {
    const service = new OtherAppHotkeys(['Ctrl+Alt+A']);
    await setup({
      service,
      hotkeys: [
        { id: 'a', keys: 'Ctrl+Alt+A', action: 'recalibrate', targetId: null, mode: 'toggle' },
        { id: 'b', keys: 'Ctrl+Alt+B', action: 'pauseTracking', targetId: null, mode: 'hold' },
      ],
    });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText(CONFLICT_MESSAGE)).toBeTruthy();
    expect(within(rows[0]!).getByText('キャリブレーションのやり直し')).toBeTruthy();
    expect(within(rows[1]!).queryByText(CONFLICT_MESSAGE)).toBeNull();
    expect(within(rows[1]!).getByText('トラッキングの一時停止')).toBeTruthy();

    // ほかのアプリを閉じたら、登録し直すと消える
    service.taken = [];
    fireEvent.click(screen.getByRole('button', { name: '登録し直す' }));
    await idle();
    expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
    expect(screen.queryByRole('button', { name: '登録し直す' })).toBeNull();
  });

  it('追加の画面で重なったキーを登録すると、一覧で重なっていると出る', async () => {
    await setup({ service: new OtherAppHotkeys(['Ctrl+Alt+A']) });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    pressKeys({ key: 'a', code: 'KeyA', ctrlKey: true, altKey: true });
    fireEvent.change(screen.getByLabelText('動作'), { target: { value: 'recalibrate' } });
    expect(screen.queryByLabelText('対象')).toBeNull();
    expect(screen.queryByLabelText('動き')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    await idle();
    expect(screen.getByText(CONFLICT_MESSAGE)).toBeTruthy();
  });

  it('同じキーが2つあると、あとのものに「ほかのホットキーと同じキー」と出す', async () => {
    await setup({
      hotkeys: [
        { id: 'a', keys: 'Ctrl+Shift+1', action: 'recalibrate', targetId: null, mode: 'toggle' },
        { id: 'b', keys: 'shift+ctrl+1', action: 'pauseTracking', targetId: null, mode: 'toggle' },
      ],
    });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).queryByText(DUPLICATE_MESSAGE)).toBeNull();
    expect(within(rows[1]!).getByText(DUPLICATE_MESSAGE)).toBeTruthy();
  });

  it('記録するときに、修飾キーの無い文字キーと、すでに使っているキーは断る', async () => {
    await setup({
      hotkeys: [{ id: 'a', keys: 'Ctrl+Shift+1', action: 'recalibrate', targetId: null, mode: 'toggle' }],
    });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    const add = screen.getByRole('button', { name: '登録' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    pressKeys({ key: 'a', code: 'KeyA' });
    expect(screen.getByText(NEEDS_MODIFIER_MESSAGE)).toBeTruthy();
    expect(add.disabled).toBe(true);
    pressKeys({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('すでに使っている（キャリブレーションのやり直し）')).toBeTruthy();
    expect(add.disabled).toBe(true);
    pressKeys({ key: '"', code: 'Digit2', ctrlKey: true, shiftKey: true });
    expect(keyInput().value).toBe('Ctrl+Shift+2');
    expect(add.disabled).toBe(false);
    // やめると何も足さない
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.queryByLabelText('キー')).toBeNull();
  });

  it('修飾キーだけを押している間は途中を出し、離しきると記録したキーに戻る', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    pressKeys({ key: 'F8', code: 'F8' });
    expect(keyInput().value).toBe('F8');
    fireEvent.keyDown(keyInput(), { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.keyDown(keyInput(), { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true });
    expect(keyInput().value).toBe('Ctrl+Shift+…');
    fireEvent.keyUp(keyInput(), { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    expect(keyInput().value).toBe('Ctrl+…');
    fireEvent.keyUp(keyInput(), { key: 'Control', code: 'ControlLeft' });
    expect(keyInput().value).toBe('F8');
  });

  it('記録中のキーはアプリのショートカット（Ctrl+Z の元に戻す）に渡さない', async () => {
    const { services } = await setup();
    act(() => services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '変えた' }) }));
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    pressKeys({ key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(keyInput().value).toBe('Ctrl+Z');
    expect(services.store.get().name).toBe('変えた');
  });

  it('削除すると一覧から消え、登録も外す', async () => {
    const { services } = await setup({
      hotkeys: [{ id: 'a', keys: 'F9', action: 'background', targetId: 'color:#00ff00', mode: 'toggle' }],
    });
    expect(screen.getByText('背景: 緑')).toBeTruthy();
    expect(fake(services).registered()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'F9（背景: 緑）を削除' }));
    await idle();
    expect(services.store.get().studio.hotkeys).toEqual([]);
    expect(fake(services).registered()).toEqual([]);
    expect(screen.getByText('まだ登録していない')).toBeTruthy();
  });

  it('スタジオから離れると登録を外し、戻ると登録し直す', async () => {
    const { services } = await setup({
      hotkeys: [{ id: 'a', keys: 'F9', action: 'recalibrate', targetId: null, mode: 'toggle' }],
    });
    expect(fake(services).registered()).toHaveLength(1);
    await act(async () => services.editor.set({ mode: 'modeling' }));
    await idle();
    expect(fake(services).registered()).toEqual([]);
    await act(async () => services.editor.set({ mode: 'studio' }));
    await idle();
    expect(fake(services).registered()).toHaveLength(1);
  });
});
