import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../../services';
import { PanelSections, presetOf, registerPanel, registerPanelSection, useDispatch, useProject } from '../api';
import { createEnvironmentStore, memoryEnvironmentStorage, type EnvironmentStorage } from '../environment';
import { registry } from '../registry';
import { Shell } from '../Shell';
import { useConfirmOverwriteCustom } from './confirmOverwriteCustom';

// jsdom には 2D コンテキストが無いので、何も描かない描画にする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

async function setup(storage: EnvironmentStorage & { text: string | null } = memoryEnvironmentStorage(null)) {
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const environment = createEnvironmentStore(storage);
  const utils = render(<Shell services={services} environment={environment} />);
  // environment.json を読み終えて EditorState に反映されるまで待つ
  await act(() => environment.load());
  return { services, environment, storage, ...utils };
}

const toggle = (name: 'かんたん' | '詳細') =>
  within(screen.getByRole('group', { name: 'かんたん/詳細' })).getByRole('button', { name });
const pressed = () => (toggle('詳細').getAttribute('aria-pressed') === 'true' ? '詳細' : 'かんたん');
const openMode = (label: 'モデリング' | 'アニメーション' | 'スタジオ') =>
  fireEvent.click(screen.getByRole('tab', { name: label }));
const sectionIds = () =>
  [...document.querySelectorAll('[data-section-id]')].map((el) => el.getAttribute('data-section-id'));

beforeEach(() => {
  registry.reset();
  // パネルの中にセクションを並べる
  for (const [id, mode, title] of [
    ['t.modeling', 'modeling', 'モデリングの設定'],
    ['t.studio', 'studio', 'スタジオの設定'],
  ] as const) {
    registerPanel({ id, mode, area: 'right', title, component: () => <PanelSections panelId={id} /> });
  }
  registerPanelSection({ id: 'm.easy', panelId: 't.modeling', level: 'easy', component: () => <p>m かんたん</p> });
  registerPanelSection({ id: 'm.detail', panelId: 't.modeling', level: 'detail', component: () => <p>m 詳細</p> });
  registerPanelSection({ id: 's.easy', panelId: 't.studio', level: 'easy', component: () => <p>s かんたん</p> });
  registerPanelSection({ id: 's.detail', panelId: 't.studio', level: 'detail', component: () => <p>s 詳細</p> });
});

afterEach(() => {
  registry.reset();
});

describe('かんたん/詳細の切り替え', () => {
  it('ボタンが出て、初期値はすべて「かんたん」', async () => {
    const { services } = await setup();
    expect(screen.getByRole('group', { name: 'かんたん/詳細' })).toBeTruthy();
    expect(toggle('かんたん').textContent).toBe('かんたん');
    expect(toggle('詳細').textContent).toBe('詳細');
    expect(pressed()).toBe('かんたん');
    expect(services.editor.get().uiLevel).toEqual({ modeling: 'easy', animation: 'easy', studio: 'easy' });
  });

  it('押すと今のモードの uiLevel だけが変わる', async () => {
    const { services } = await setup();
    fireEvent.click(toggle('詳細'));
    expect(services.editor.get().uiLevel).toEqual({ modeling: 'detail', animation: 'easy', studio: 'easy' });
    expect(pressed()).toBe('詳細');
    expect(sectionIds()).toEqual(['m.detail']);

    openMode('アニメーション');
    fireEvent.click(toggle('詳細'));
    expect(services.editor.get().uiLevel).toEqual({ modeling: 'detail', animation: 'detail', studio: 'easy' });
    fireEvent.click(toggle('かんたん'));
    expect(services.editor.get().uiLevel).toEqual({ modeling: 'detail', animation: 'easy', studio: 'easy' });
  });

  it('モデリングを詳細、スタジオをかんたんにしたまま、行き来しても保たれる', async () => {
    const { services, environment } = await setup();
    fireEvent.click(toggle('詳細'));
    expect(sectionIds()).toEqual(['m.detail']);

    for (let i = 0; i < 2; i++) {
      openMode('スタジオ');
      expect(pressed()).toBe('かんたん');
      expect(sectionIds()).toEqual(['s.easy']);
      openMode('アニメーション');
      expect(pressed()).toBe('かんたん');
      openMode('モデリング');
      expect(pressed()).toBe('詳細');
      expect(sectionIds()).toEqual(['m.detail']);
    }
    expect(services.editor.get().uiLevel).toEqual({ modeling: 'detail', animation: 'easy', studio: 'easy' });
    expect(environment.get().uiLevel).toEqual({ modeling: 'detail', animation: 'easy', studio: 'easy' });
  });

  it('Environment.uiLevel に保存し、再起動しても状態が戻る', async () => {
    const first = await setup();
    fireEvent.click(toggle('詳細'));
    openMode('スタジオ');
    fireEvent.click(toggle('詳細'));
    fireEvent.click(toggle('かんたん'));
    openMode('アニメーション');
    fireEvent.click(toggle('詳細'));
    await first.environment.flush();
    expect(JSON.parse(first.storage.text!).uiLevel).toEqual({
      modeling: 'detail',
      animation: 'detail',
      studio: 'easy',
    });
    first.unmount();

    // 同じ保存先から、サービスと環境設定を作り直して開く
    const second = await setup(first.storage);
    expect(second.services.editor.get().uiLevel).toEqual({ modeling: 'detail', animation: 'detail', studio: 'easy' });
    expect(pressed()).toBe('詳細');
    expect(sectionIds()).toEqual(['m.detail']);
    openMode('スタジオ');
    expect(pressed()).toBe('かんたん');
    expect(sectionIds()).toEqual(['s.easy']);
  });

  it('environment.json に uiLevel が無ければすべて「かんたん」で始まる', async () => {
    const { services } = await setup(memoryEnvironmentStorage(JSON.stringify({ mirror: false })));
    expect(services.editor.get().uiLevel).toEqual({ modeling: 'easy', animation: 'easy', studio: 'easy' });
    expect(pressed()).toBe('かんたん');
  });

  it.each(['detail', 'easy'] as const)(
    '読み込み中に %s へ変えたモードだけを優先し、ほかの設定を保つ',
    async (level) => {
      const saved = JSON.stringify({
        mirror: false,
        uiLevel: { modeling: level === 'detail' ? 'easy' : 'detail', animation: 'detail', studio: 'detail' },
        output: { width: 1280, height: 720, fps: 30, method: 'window' },
      });
      const storage = memoryEnvironmentStorage(saved);
      let finishRead!: (text: string) => void;
      storage.read = vi.fn(() => new Promise<string>((resolve) => (finishRead = resolve)));
      const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
      const environment = createEnvironmentStore(storage);
      const first = render(
        <StrictMode>
          <Shell services={services} environment={environment} />
        </StrictMode>,
      );
      fireEvent.click(toggle('詳細'));
      if (level === 'easy') fireEvent.click(toggle('かんたん'));
      expect(services.editor.get().uiLevel.modeling).toBe(level);
      await environment.flush();
      // 読み込み前の既定値で、ほかの保存済み設定を上書きしない
      expect(storage.text).toBe(saved);
      expect(storage.read).toHaveBeenCalledTimes(1);

      await act(async () => {
        finishRead(saved);
        await environment.load();
      });
      await environment.flush();
      const expected = { modeling: level, animation: 'detail', studio: 'detail' };
      expect(services.editor.get().uiLevel).toEqual(expected);
      expect(environment.get()).toMatchObject({ mirror: false, uiLevel: expected, output: { width: 1280, fps: 30 } });
      expect(JSON.parse(storage.text!)).toMatchObject({ mirror: false, uiLevel: expected });
      first.unmount();

      const second = await setup(memoryEnvironmentStorage(storage.text));
      expect(second.services.editor.get().uiLevel).toEqual(expected);
    },
  );

  it('読み込み中にモードや選択を変えても、操作していない uiLevel を保存済みの値から戻す', async () => {
    const saved = JSON.stringify({ uiLevel: { modeling: 'detail', animation: 'detail', studio: 'detail' } });
    const storage = memoryEnvironmentStorage(saved);
    let finishRead!: (text: string) => void;
    storage.read = () => new Promise<string>((resolve) => (finishRead = resolve));
    const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
    const environment = createEnvironmentStore(storage);
    render(<Shell services={services} environment={environment} />);
    openMode('スタジオ');
    act(() => services.editor.set({ selectedPartIds: ['part-1'] }));
    await act(async () => {
      finishRead(saved);
      await environment.load();
    });
    expect(services.editor.get()).toMatchObject({
      mode: 'studio',
      selectedPartIds: ['part-1'],
      uiLevel: { modeling: 'detail', animation: 'detail', studio: 'detail' },
    });
    expect(pressed()).toBe('詳細');
    await environment.flush();
    expect(storage.text).toBe(saved);
  });
});

describe('詳細からかんたんへ戻しても値を消さない', () => {
  it('詳細でだけ変えられる値はプロジェクトに残り、表示を隠すだけ。切り替えは Undo の履歴に入らない', async () => {
    registerPanelSection({
      id: 'm.detail',
      panelId: 't.modeling',
      level: 'detail',
      component: function DetailOnly() {
        const project = useProject();
        const dispatch = useDispatch();
        return (
          <div>
            <output aria-label="詳細の値">{project.name}</output>
            <button
              type="button"
              onClick={() => dispatch({ label: '詳細の値', apply: (p) => ({ ...p, name: '詳細で変えた' }) })}
            >
              詳細で変える
            </button>
          </div>
        );
      },
    });
    const { services, environment } = await setup();
    act(() => environment.set({ trackingPreset: 'custom', silenceThreshold: -42 }));
    fireEvent.click(toggle('詳細'));
    fireEvent.click(screen.getByRole('button', { name: '詳細で変える' }));
    expect(screen.getByLabelText('詳細の値').textContent).toBe('詳細で変えた');
    const project = services.store.get();

    fireEvent.click(toggle('かんたん'));
    expect(screen.queryByLabelText('詳細の値')).toBeNull();
    expect(services.store.get()).toBe(project);
    expect(environment.get()).toMatchObject({ trackingPreset: 'custom', silenceThreshold: -42 });

    fireEvent.click(toggle('詳細'));
    expect(screen.getByLabelText('詳細の値').textContent).toBe('詳細で変えた');
    expect(services.store.get()).toBe(project);

    // 切り替えは履歴に入らないので、1回の Undo で詳細で変える前に戻る
    act(() => services.store.undo());
    expect(services.store.get().name).toBe('新しいプロジェクト');
    expect(services.store.canUndo()).toBe(false);
  });
});

describe('confirmOverwriteCustom', () => {
  const PRESETS = {
    stable: { smoothing: 0.8, gain: 1 },
    standard: { smoothing: 0.5, gain: 1 },
  };

  beforeEach(() => {
    registerPanel({
      id: 't.studio',
      mode: 'studio',
      area: 'right',
      title: 'スタジオの設定',
      component: function PresetPicker() {
        const [values, setValues] = useState({ smoothing: 0.6, gain: 1.2 }); // 詳細で個別に調整した値
        const confirmOverwrite = useConfirmOverwriteCustom();
        const current = presetOf(values, PRESETS);
        const choose = async (name: keyof typeof PRESETS) => {
          if (await confirmOverwrite(current)) setValues(PRESETS[name]);
        };
        return (
          <div>
            <output aria-label="今のプリセット">{current}</output>
            <button type="button" onClick={() => void choose('stable')}>
              安定
            </button>
            <button type="button" onClick={() => void choose('standard')}>
              標準
            </button>
          </div>
        );
      },
    });
  });

  it("presetOf が 'custom' のときにプリセットを選び直すと確認が出て、キャンセルなら値を変えない", async () => {
    const { services } = await setup();
    act(() => services.editor.set({ mode: 'studio' }));
    const current = () => screen.getByLabelText('今のプリセット').textContent;
    expect(current()).toBe('custom');

    fireEvent.click(screen.getByRole('button', { name: '標準' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('個別に調整した値を上書きします');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current()).toBe('custom');

    fireEvent.click(screen.getByRole('button', { name: '標準' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(current()).toBe('standard'));

    // プリセットに一致しているあいだは確認しない
    fireEvent.click(screen.getByRole('button', { name: '安定' }));
    await waitFor(() => expect(current()).toBe('stable'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
