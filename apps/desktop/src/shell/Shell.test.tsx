import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProjectJson, type Vec2 } from '@app/schema';
import type { DeformedModel, Renderer, Services, ViewTransform } from '@app/contracts';
import { createFakeServices } from '../services';
import {
  PanelSections,
  registerCanvasTool,
  registerCenter,
  registerPanel,
  registerPanelSection,
  registerSetupScreen,
  useDialogs,
  type CanvasPointerEvent,
} from './api';
import { createCanvasController } from './canvas/controller';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { registry } from './registry';
import { Shell } from './Shell';

const sampleJson = Object.values(
  import.meta.glob<string>('../../../../fixtures/sample-model/project.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0]!;
const sampleProject = () => loadProjectJson(sampleJson);

class RecordingRenderer implements Renderer {
  renders: { model: DeformedModel; view: ViewTransform }[] = [];
  disposed = false;
  init() {}
  setTextures() {}
  render(model: DeformedModel, view: ViewTransform) {
    this.renders.push({ model, view });
  }
  dispose() {
    this.disposed = true;
  }
}

function setup(options: { environmentText?: string | null } = {}) {
  const renderer = new RecordingRenderer();
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const storage = memoryEnvironmentStorage(options.environmentText ?? null);
  const environment = createEnvironmentStore(storage);
  const canvas = createCanvasController();
  const utils = render(<Shell services={services} environment={environment} canvas={canvas} />);
  return { services, renderer, storage, environment, canvas, ...utils };
}

// jsdom は大きさを持たないので、キャンバスの領域を 800×600 にする
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

beforeEach(() => {
  registry.reset();
});

describe('モードとパネル', () => {
  beforeEach(() => {
    registerPanel({
      id: 't.left',
      mode: 'modeling',
      area: 'left',
      title: '左のパネル',
      component: () => (
        <div>
          左の中身
          <PanelSections panelId="t.left" />
        </div>
      ),
    });
    registerPanelSection({
      id: 't.sec2',
      panelId: 't.left',
      order: 2,
      component: () => <span>いつものセクション</span>,
    });
    registerPanelSection({
      id: 't.sec1',
      panelId: 't.left',
      order: 1,
      level: 'easy',
      component: () => <span>かんたんのセクション</span>,
    });
    registerPanelSection({
      id: 't.sec3',
      panelId: 't.left',
      order: 3,
      level: 'detail',
      component: () => <span>詳細のセクション</span>,
    });
    registerPanel({
      id: 't.right',
      mode: 'modeling',
      area: 'right',
      level: 'detail',
      title: '詳細だけのパネル',
      component: () => null,
    });
    registerPanel({
      id: 't.studio',
      mode: 'studio',
      area: 'bottom',
      title: 'スタジオの下',
      component: () => <p>下の中身</p>,
    });
    registerCenter('studio', () => <div>スタジオの中央</div>);
  });

  it('3つのモードを切り替えられ、テスト用のパネルとセクションが出る', () => {
    setup();
    expect(screen.getByText('左のパネル')).toBeTruthy();
    expect(screen.getByTestId('canvas-main')).toBeTruthy();
    expect(screen.queryByText('スタジオの下')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'スタジオ' }));
    expect(screen.getByText('スタジオの中央')).toBeTruthy();
    expect(screen.getByText('下の中身')).toBeTruthy();
    expect(screen.queryByText('左のパネル')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'アニメーション' }));
    expect(screen.queryByText('スタジオの中央')).toBeNull();
    expect(screen.getByRole('tab', { name: 'アニメーション' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'モデリング' }));
    expect(screen.getByText('左のパネル')).toBeTruthy();
  });

  it('セクションは order 順に並び、uiLevel で出し分けられる', () => {
    const { services } = setup();
    const sectionIds = () =>
      [...document.querySelectorAll('[data-section-id]')].map((el) => el.getAttribute('data-section-id'));
    expect(sectionIds()).toEqual(['t.sec1', 't.sec2']);
    expect(screen.queryByText('詳細だけのパネル')).toBeNull();

    act(() => services.editor.set({ uiLevel: { modeling: 'detail', animation: 'easy', studio: 'easy' } }));
    expect(sectionIds()).toEqual(['t.sec2', 't.sec3']);
    expect(screen.getByText('詳細だけのパネル')).toBeTruthy();

    // ほかのモードの uiLevel には影響されない
    act(() => services.editor.set({ uiLevel: { modeling: 'easy', animation: 'detail', studio: 'detail' } }));
    expect(screen.queryByText('詳細だけのパネル')).toBeNull();
  });

  it('パネルは見出しを押すとたため、中身は外さずに隠すだけ。たたんだことを覚える', () => {
    localStorage.removeItem('live2d-studio.collapsedPanels');
    let mounts = 0;
    registerPanel({
      id: 't.fold',
      mode: 'modeling',
      area: 'right',
      title: 'たためるパネル',
      component: function Fold() {
        useEffect(() => {
          mounts++;
        }, []);
        return <p>たためる中身</p>;
      },
    });
    setup();
    const header = screen.getByRole('button', { name: /たためるパネル/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('たためる中身', { selector: 'p' }).closest('.panel-body')!.hasAttribute('hidden')).toBe(
      true,
    );
    expect(mounts).toBe(1);
    expect(JSON.parse(localStorage.getItem('live2d-studio.collapsedPanels')!)).toEqual(['t.fold']);
    fireEvent.click(header);
    expect(screen.getByText('たためる中身').closest('.panel-body')!.hasAttribute('hidden')).toBe(false);
    expect(mounts).toBe(1);
  });

  it('かんたん/詳細の切り替えボタンを出す（カード27）', () => {
    setup();
    expect(screen.getByRole('group', { name: 'かんたん/詳細' }).hidden).toBe(false);
  });
});

describe('セットアップ画面', () => {
  it('素材が1つも無いときだけ中央に出す', () => {
    registerSetupScreen(() => <div>素材を読み込む</div>);
    const { services } = setup();
    expect(screen.getByText('素材を読み込む')).toBeTruthy();
    act(() => services.store.load(sampleProject()));
    expect(screen.queryByText('素材を読み込む')).toBeNull();
    expect(screen.getByTestId('canvas-main')).toBeTruthy();
  });
});

describe('キャンバス', () => {
  let restoreSize: () => void = () => {};
  afterEach(() => restoreSize());

  it('fixtures のモデルが（仮実装で）表示され、拡大・移動できる', async () => {
    restoreSize = stubSize(800, 600);
    const { services, renderer, canvas } = setup();
    act(() => services.store.load(sampleProject()));
    await waitFor(() => expect(renderer.renders.at(-1)?.model.items).toHaveLength(28));
    // 開いたら全体（1000×1500）を 800×600 に収める
    const fitted = canvas.getState().view;
    expect(fitted.scale).toBeCloseTo(0.36);
    expect(renderer.renders.at(-1)!.view).toEqual(fitted);
    expect(screen.getByLabelText('倍率').textContent).toBe('36%');

    const overlay = screen.getByTestId('canvas-overlay');
    fireEvent.wheel(overlay, { deltaY: -200, clientX: 400, clientY: 300 });
    const zoomed = canvas.getState().view;
    expect(zoomed.scale).toBeGreaterThan(fitted.scale);
    await waitFor(() => expect(renderer.renders.at(-1)!.view).toEqual(zoomed));

    // 中ボタンのドラッグで移動
    fireEvent.pointerDown(overlay, { button: 1, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(overlay, { button: 1, clientX: 130, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(overlay, { button: 1, clientX: 130, clientY: 80, pointerId: 1 });
    const panned = canvas.getState().view;
    expect(panned.scale).toBe(zoomed.scale);
    expect(panned.offset.x - zoomed.offset.x).toBeCloseTo(30);
    expect(panned.offset.y - zoomed.offset.y).toBeCloseTo(-20);

    // [全体を表示] で戻る
    fireEvent.click(screen.getByRole('button', { name: '全体を表示' }));
    expect(canvas.getState().view).toEqual(fitted);
  });

  it('スペース＋ドラッグでも移動する', () => {
    restoreSize = stubSize(800, 600);
    const { canvas } = setup();
    const overlay = screen.getByTestId('canvas-overlay');
    const before = canvas.getState().view;
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.pointerDown(overlay, { button: 0, clientX: 10, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(overlay, { button: 0, clientX: 15, clientY: 30, pointerId: 2 });
    fireEvent.pointerUp(overlay, { button: 0, clientX: 15, clientY: 30, pointerId: 2 });
    fireEvent.keyUp(window, { code: 'Space', key: ' ' });
    expect(canvas.getState().view.offset).toEqual({ x: before.offset.x + 5, y: before.offset.y + 20 });
  });

  it('テスト用のツールで、pointer のキャンバス座標が拡大・移動の後も正しい', async () => {
    restoreSize = stubSize(800, 600);
    const downs: CanvasPointerEvent[] = [];
    registerCanvasTool({ id: 'test.tool', label: 'テスト', onPointerDown: (e) => downs.push(e) });
    registerCanvasTool({ id: 'test.other', label: 'ほか' });
    const { services, canvas } = setup();
    act(() => services.store.load(sampleProject()));
    await waitFor(() => expect(canvas.getState().view.scale).toBeCloseTo(0.36));
    const overlay = screen.getByTestId('canvas-overlay');
    const click = (p: Vec2, extra: Record<string, unknown> = {}) => {
      fireEvent.pointerDown(overlay, { button: 0, clientX: p.x, clientY: p.y, pointerId: 3, ...extra });
      fireEvent.pointerUp(overlay, { button: 0, clientX: p.x, clientY: p.y, pointerId: 3 });
      return downs.at(-1)!.canvasPoint;
    };
    const near = (a: Vec2, b: Vec2) => {
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    };

    // 全体表示: キャンバスの左上 (0,0) は画面の (220,30)、右下 (1000,1500) は (580,570)
    near(click({ x: 220, y: 30 }), { x: 0, y: 0 });
    near(click({ x: 580, y: 570 }), { x: 1000, y: 1500 });
    expect(downs.at(-1)).toMatchObject({ screenPoint: { x: 580, y: 570 }, button: 0 });

    // 拡大しても、拡大の中心にあった点は同じキャンバス座標のまま
    const before = click({ x: 300, y: 200 });
    fireEvent.wheel(overlay, { deltaY: -300, clientX: 300, clientY: 200 });
    near(click({ x: 300, y: 200 }), before);
    // 移動した分だけずれた画面の点が、同じキャンバス座標になる
    fireEvent.pointerDown(overlay, { button: 1, clientX: 0, clientY: 0, pointerId: 4 });
    fireEvent.pointerMove(overlay, { button: 1, clientX: 40, clientY: -25, pointerId: 4 });
    fireEvent.pointerUp(overlay, { button: 1, clientX: 40, clientY: -25, pointerId: 4 });
    near(click({ x: 340, y: 175 }), before);
    // 修飾キーも渡す
    click({ x: 1, y: 1 }, { shiftKey: true, altKey: true, ctrlKey: true });
    expect(downs.at(-1)).toMatchObject({ shiftKey: true, altKey: true, ctrlKey: true });

    // ツールを切り替えると、前のツールには届かない
    const count = downs.length;
    fireEvent.click(screen.getByRole('button', { name: 'ほか' }));
    click({ x: 10, y: 10 });
    expect(downs.length).toBe(count);
  });

  it('ツールのオーバーレイとキー入力', () => {
    const drawOverlay = vi.fn();
    const onKeyDown = vi.fn();
    registerCanvasTool({ id: 'test.tool', label: 'テスト', drawOverlay, onKeyDown });
    setup();
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Delete' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]![0]).toMatchObject({ key: 'Delete' });
  });

  it('外したらレンダラーを片付ける', () => {
    const { renderer, unmount } = setup();
    unmount();
    expect(renderer.disposed).toBe(true);
  });
});

describe('Undo / Redo のキー', () => {
  it.each(['select', 'range', 'checkbox', 'radio', 'button'])('%s からもプロジェクトの Undo/Redo を使える', (type) => {
    const { services } = setup();
    act(() => services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '変更後' }) }));
    const control = document.createElement(type === 'select' ? 'select' : 'input');
    if (control instanceof HTMLInputElement) control.type = type;
    document.body.appendChild(control);
    fireEvent.keyDown(control, { key: 'z', ctrlKey: true });
    expect(services.store.get().name).toBe('新しいプロジェクト');
    fireEvent.keyDown(control, { key: 'y', ctrlKey: true });
    expect(services.store.get().name).toBe('変更後');
    control.remove();
  });

  it.each(['text', 'number', 'search', 'email', 'url', 'tel', 'password'])(
    '%s の入力中は Undo/Redo を横取りしない',
    (type) => {
      const { services } = setup();
      const undo = vi.spyOn(services.store, 'undo');
      const redo = vi.spyOn(services.store, 'redo');
      const input = document.createElement('input');
      input.type = type;
      document.body.appendChild(input);
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(input, { key: 'y', ctrlKey: true });
      expect(undo).not.toHaveBeenCalled();
      expect(redo).not.toHaveBeenCalled();
      input.remove();
    },
  );

  it('IME の変換中と contenteditable の子からの Undo は横取りしない', () => {
    const { services } = setup();
    const undo = vi.spyOn(services.store, 'undo');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, keyCode: 229 });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    document.body.appendChild(editable);
    fireEvent.keyDown(child, { key: 'z', ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
    editable.remove();
  });
  it('Ctrl+Z で store.undo、Ctrl+Shift+Z と Ctrl+Y で store.redo が呼ばれる', () => {
    const { services } = setup();
    const undo = vi.spyOn(services.store, 'undo');
    const redo = vi.spyOn(services.store, 'redo');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it('実際に元に戻る。入力欄の中では横取りしない', () => {
    const { services } = setup();
    act(() => services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '変えた' }) }));
    expect(screen.getByText('変えた')).toBeTruthy();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(services.store.get().name).toBe('変えた');
    input.remove();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(services.store.get().name).toBe('新しいプロジェクト');
  });
});

describe('環境設定とダイアログ', () => {
  it('environment.json の uiLevel を EditorState に反映し、変えたら保存する', async () => {
    const { services, storage, environment } = setup({
      environmentText: JSON.stringify({ uiLevel: { modeling: 'detail', animation: 'easy', studio: 'easy' } }),
    });
    await waitFor(() => expect(services.editor.get().uiLevel.modeling).toBe('detail'));
    act(() => services.editor.set({ uiLevel: { modeling: 'detail', animation: 'easy', studio: 'detail' } }));
    await environment.flush();
    expect(JSON.parse(storage.text!).uiLevel).toEqual({ modeling: 'detail', animation: 'easy', studio: 'detail' });
  });

  it('confirm・prompt・notify', async () => {
    let dialogs: ReturnType<typeof useDialogs> | null = null;
    registerCenter('studio', function Probe() {
      dialogs = useDialogs();
      return null;
    });
    const { services } = setup();
    act(() => services.editor.set({ mode: 'studio' }));
    let answer: Promise<boolean> | null = null;
    act(() => {
      answer = dialogs!.confirm('消してよい？');
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(answer).resolves.toBe(true);

    let name: Promise<string | null> | null = null;
    act(() => {
      name = dialogs!.prompt('名前', 'はじめ');
    });
    const input = screen.getByDisplayValue('はじめ');
    fireEvent.change(input, { target: { value: '笑顔' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(name).resolves.toBe('笑顔');

    act(() => {
      name = dialogs!.prompt('名前');
    });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await expect(name).resolves.toBeNull();

    act(() => dialogs!.notify('保存した'));
    expect(screen.getByText('保存した')).toBeTruthy();
  });
});
